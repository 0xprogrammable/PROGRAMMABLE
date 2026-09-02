import { appendFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { readBoundedResponseText } from "./read-bounded-response.mjs";

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CATALOG_SOURCES = new Set(["envio-classic-v3"]);
const NATIVE_CURRENCY_ADDRESS =
  "0x0000000000000000000000000000000000000000";
const CLASSIC_V4_POLICY = Object.freeze({
  minimumTotalSwapFeeBps: 10,
  maximumTotalSwapFeeBps: 1_000,
  totalSwapFeeStepBps: 10,
  initialTick: 204_200,
  liquidityTickLower: 174_800,
  liquidityTickUpper: 204_200,
  lpFeePips: 0,
});
const PROGRAMMABLE_MAIN_ASSET_ADDRESS =
  "0x7987f03462200b3d8a072e02c89a8a41dcb124ee";
const CANONICAL_POOL_MANAGER_ADDRESS =
  "0x000000000004444c5dc75cb358380d2e3de08a90";
const SHARD_TOKEN_ADDRESS = [
  "0xface73b63787960282f2",
  "d4682d3752beb25271ad",
].join("");
const SHARD_POOL_ID =
  "0x9c74d6183b1ee526a62db562a81da3bf579b5bd6bff5066ae985265a7028e010";
const SHARD_ROUTER_TRADE_PROJECT_ID =
  "sha256:98f170ed0fa4e98f5b7e1901905132c24082f54f37f6176133be54fd039959a3";
const SHARD_ROUTER_TRADE_CAPABILITY_HASH =
  "sha256:6c562e4c2f52829d6c5fdf806ab7deb5a9a37ac549e8137a17160d0dd8436e6a";
const CATALOG_STATUSES = new Set([
  "current",
  "last-known-good",
]);
const MARKET_READ_STATUSES = new Set([
  "complete",
  "partial",
  "unavailable",
]);
const EXPLORE_MARKET_PROVIDERS = new Set([
  "dexscreener",
  "gmgn",
  "gmgn+dexscreener",
]);
const EXPLORE_SNAPSHOT_ATTEMPTS = 3;
const EXPLORE_SNAPSHOT_RETRY_DELAY_MS = 16_000;
const STAGED_503_RETRY_AFTER_MAXIMUM_MS = 5_000;
const GMGN_ANALYTICS_ATTEMPTS = 2;
// New multiflight reservations expire after 15 seconds. The extra second keeps
// the retry beyond the lease boundary even with timer and scheduling skew.
const GMGN_ANALYTICS_RECOVERY_DELAY_MS = 16_000;
// A partial summary may be served for 15 seconds and stale-revalidated for a
// further 30 seconds. Retry only after that entire public cache window.
const GMGN_ANALYTICS_PARTIAL_SUMMARY_RECOVERY_DELAY_MS = 46_000;
const VISIBLE_EXPLORE_PAGE_SIZE = 9;
const TRENDING_EXPLORE_PAGE_SIZE = 100;
const TRENDING_EXPLORE_MAXIMUM_PAGES = 100;
const TRENDING_SNAPSHOT_ATTEMPTS = 2;
const TRENDING_DISCOVERY_VOLATILE_KEYS = new Set([
  "asOfTime",
]);
const MARKET_CAP_RANKING_SEPARATE_KEYS = new Set([
  "asOfTime",
  "rankingCommitment",
]);
const GMGN_CANONICAL_SCAN_MAXIMUM_PAGES = 8;
const PROVIDER_RECENT_MAXIMUM_AGE_MS = 5 * 60_000;
const MINIMUM_FDV_LIQUIDITY_USD_WAD = 10_000n * 10n ** 18n;
const ANALYTICS_STATUSES = new Set(["ready", "partial", "unavailable"]);

class ExploreCatalogBoundaryDriftError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExploreCatalogBoundaryDriftError";
  }
}

class ExploreMarketCapSnapshotDriftError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExploreMarketCapSnapshotDriftError";
  }
}

class ExploreDiscoverySnapshotDriftError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExploreDiscoverySnapshotDriftError";
  }
}

function exactOrigin(value, targetKind) {
  const target = new URL(value);
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== "" ||
    (targetKind === "staged"
      ? !target.hostname.endsWith(".vercel.app")
      : target.origin !== "https://programmable.market")
  ) {
    throw new Error("Public API smoke target is not an exact Vercel origin");
  }
  return target;
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

function exactObjectKeys(value, expected) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function exactIsoTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function currentProviderTimestamp(value, nowMs) {
  if (!exactIsoTimestamp(value) || !Number.isFinite(nowMs)) return false;
  const observedAtMs = Date.parse(value);
  return observedAtMs <= nowMs &&
    nowMs - observedAtMs <= PROVIDER_RECENT_MAXIMUM_AGE_MS;
}

function boundedStagedRetryAfterMs(response) {
  const retryAfter = response.headers.get("retry-after")?.trim() ?? "";
  if (!/^(?:0|[1-9][0-9]{0,2})$/u.test(retryAfter)) {
    return STAGED_503_RETRY_AFTER_MAXIMUM_MS;
  }
  return Math.min(
    Number(retryAfter) * 1_000,
    STAGED_503_RETRY_AFTER_MAXIMUM_MS,
  );
}

async function requestJson(
  target,
  headers,
  path,
  fetchImpl,
  acceptedStatuses = new Set([200]),
  waitForStagedRetryAfter = null,
) {
  const requestUrl = new URL(path, target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(requestUrl, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 503 && attempt === 0) {
      await response.body?.cancel();
      if (waitForStagedRetryAfter !== null) {
        await waitForStagedRetryAfter(boundedStagedRetryAfterMs(response));
      }
      continue;
    }
    const text = await readBoundedResponseText(response, {
      maximumBytes: 4 * 1024 * 1024,
      label: `public API ${path}`,
    });
    if (!acceptedStatuses.has(response.status)) {
      throw new Error(`Public API ${path} returned HTTP ${response.status}`);
    }
    return {
      status: response.status,
      body: parseJson(text, `public API ${path}`),
      headers: response.headers,
    };
  }
  throw new Error("Public API retry contract is unreachable");
}

function exactExplorePage(response, tokens, expected = { page: 1, pageSize: 20 }) {
  const total = response.body?.total;
  const totalPages = response.body?.totalPages;
  const offset = (expected.page - 1) * expected.pageSize;
  return response.body?.page === expected.page &&
    response.body?.pageSize === expected.pageSize &&
    Number.isSafeInteger(total) &&
    total >= tokens.length &&
    tokens.length === Math.min(expected.pageSize, Math.max(0, total - offset)) &&
    Number.isSafeInteger(totalPages) &&
    totalPages === Math.ceil(total / expected.pageSize);
}

function exactShardRouterTradeDetail(response) {
  const project = response.body?.routerTradeProject;
  const market = Array.isArray(project?.markets) && project.markets.length === 1
    ? project.markets[0]
    : null;
  const capability = market?.tradeCapability;
  return response.status === 200 &&
    response.body?.status === "ready" &&
    response.body?.customProject === null &&
    String(response.body?.token?.tokenAddress ?? "").toLowerCase() ===
      SHARD_TOKEN_ADDRESS &&
    project?.customProjectId === SHARD_ROUTER_TRADE_PROJECT_ID &&
    market?.marketId === "shard-eth-v4" &&
    market?.kind === "uniswap-v4-hooked-pool" &&
    market?.status === "active" &&
    String(market?.poolId ?? "").toLowerCase() === SHARD_POOL_ID &&
    market?.baseAsset?.symbol === "SHARD" &&
    String(market?.baseAsset?.identity?.value ?? "").toLowerCase() ===
      SHARD_TOKEN_ADDRESS &&
    market?.quoteAsset?.symbol === "ETH" &&
    String(market?.quoteAsset?.identity?.value ?? "").toLowerCase() ===
      "0x0000000000000000000000000000000000000000" &&
    JSON.stringify(capability?.supportedSides) ===
      JSON.stringify(["base-to-quote", "quote-to-base"]) &&
    capability?.hookDataPolicy?.kind === "empty" &&
    capability?.hookDataPolicy?.data === "0x" &&
    capability?.tradeCapabilityBindingHash ===
      SHARD_ROUTER_TRADE_CAPABILITY_HASH;
}

function unsignedInteger(value) {
  return typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value);
}

function exactClassicV4Custody(custody, launchedAt) {
  if (
    !exactObjectKeys(custody, [
      "cliffDays",
      "cliffTimestamp",
      "configurationHash",
      "custodyAddress",
      "durationDays",
      "mode",
      "releaseTimestamp",
    ]) ||
    !BYTES32.test(String(custody.configurationHash ?? "").toLowerCase()) ||
    BigInt(custody.configurationHash) === 0n
  ) return false;
  const launchTimestamp = Date.parse(launchedAt);
  if (!Number.isFinite(launchTimestamp)) return false;
  const timestampAfterDays = (days) =>
    new Date(launchTimestamp + days * 86_400_000).toISOString();
  if (custody.mode === "unlocked") {
    return custody.custodyAddress === null &&
      custody.durationDays === 0 &&
      custody.cliffDays === 0 &&
      custody.cliffTimestamp === launchedAt &&
      custody.releaseTimestamp === launchedAt;
  }
  const custodyAddress = String(custody.custodyAddress ?? "").toLowerCase();
  if (
    !ADDRESS.test(custodyAddress) ||
    BigInt(custodyAddress) === 0n ||
    !Number.isSafeInteger(custody.durationDays) ||
    custody.durationDays < 1 ||
    custody.durationDays > 3_650 ||
    !Number.isSafeInteger(custody.cliffDays)
  ) return false;
  const releaseTimestamp = timestampAfterDays(custody.durationDays);
  if (
    custody.mode === "fixed-lock" ||
    custody.mode === "linear"
  ) {
    const cliffTimestamp = custody.mode === "fixed-lock"
      ? releaseTimestamp
      : launchedAt;
    return custody.cliffDays === 0 &&
      custody.cliffTimestamp === cliffTimestamp &&
      custody.releaseTimestamp === releaseTimestamp;
  }
  if (custody.mode !== "cliff-linear") return false;
  return custody.cliffDays >= 1 &&
    custody.cliffDays < custody.durationDays &&
    custody.cliffTimestamp === timestampAfterDays(custody.cliffDays) &&
    custody.releaseTimestamp === releaseTimestamp;
}

function exactClassicV4Identity(token, tokenAddress, poolId) {
  const category = token.launchCategoryProvenance;
  const hookAddress = String(token.hookAddress ?? "").toLowerCase();
  const creatorAddress = String(token.creatorAddress ?? "").toLowerCase();
  const rewardVaultAddress = String(
    token.rewardVaultAddress ?? "",
  ).toLowerCase();
  const positionRecipient = String(
    token.positionRecipient ?? "",
  ).toLowerCase();
  const launchHash = String(token.launchHash ?? "").toLowerCase();
  const launchTransactionHash = String(
    token.launchTransactionHash ?? "",
  ).toLowerCase();
  const custody = token.initialBuyCustody;
  const buyFee = token.buyHookFeeBps;
  const sellFee = token.sellHookFeeBps;
  const totalSupplyRaw = token.totalSupplyRaw;
  const tokenLiquidityAmountRaw = token.tokenLiquidityAmountRaw;
  const lockedTokenDustRaw = token.lockedTokenDustRaw;
  if (
    token.id !== `1:${tokenAddress}` ||
    BigInt(tokenAddress) === 0n ||
    BigInt(poolId) === 0n ||
    token.launchModel !== "classic" ||
    token.launchModelVersion !== "classic-v4" ||
    token.launchStampProvenance !== undefined ||
    token.liquidityPath !== "meme" ||
    !exactObjectKeys(category, [
      "category",
      "modelId",
      "modelVersion",
      "recordId",
      "schemaVersion",
      "source",
    ]) ||
    category.schemaVersion !==
      "programmable.explore-launch-category-provenance.v1" ||
    category.category !== "classic" ||
    category.source !== "canonical-launch-read-model" ||
    category.recordId !== token.id ||
    category.modelId !== "classic" ||
    category.modelVersion !== "classic-v4" ||
    !ADDRESS.test(hookAddress) ||
    BigInt(hookAddress) === 0n ||
    !ADDRESS.test(creatorAddress) ||
    BigInt(creatorAddress) === 0n ||
    !ADDRESS.test(rewardVaultAddress) ||
    BigInt(rewardVaultAddress) === 0n ||
    !ADDRESS.test(positionRecipient) ||
    BigInt(positionRecipient) === 0n ||
    !BYTES32.test(launchHash) ||
    BigInt(launchHash) === 0n ||
    !BYTES32.test(launchTransactionHash) ||
    BigInt(launchTransactionHash) === 0n ||
    !POSITIVE_INTEGER.test(String(token.launchBlockNumber ?? "")) ||
    !Number.isSafeInteger(token.launchTransactionIndex) ||
    token.launchTransactionIndex < 0 ||
    !Number.isSafeInteger(token.launchLogIndex) ||
    token.launchLogIndex < 0 ||
    !POSITIVE_INTEGER.test(String(token.positionTokenId ?? "")) ||
    !ISO_TIMESTAMP.test(String(token.launchedAt ?? "")) ||
    new Date(Date.parse(token.launchedAt)).toISOString() !== token.launchedAt ||
    token.tokenDecimals !== 18 ||
    !POSITIVE_INTEGER.test(String(totalSupplyRaw ?? "")) ||
    !POSITIVE_INTEGER.test(String(tokenLiquidityAmountRaw ?? "")) ||
    !unsignedInteger(lockedTokenDustRaw) ||
    BigInt(tokenLiquidityAmountRaw) + BigInt(lockedTokenDustRaw) !==
      BigInt(totalSupplyRaw) ||
    !POSITIVE_INTEGER.test(String(token.initialBuyEthAmountWei ?? "")) ||
    !POSITIVE_INTEGER.test(String(token.initialBuyTokenAmountRaw ?? "")) ||
    String(token.quoteAssetAddress ?? "").toLowerCase() !==
      NATIVE_CURRENCY_ADDRESS ||
    token.quoteAssetSymbol !== "ETH" ||
    token.quoteAssetName !== "Ether" ||
    !Number.isSafeInteger(buyFee) ||
    !Number.isSafeInteger(sellFee) ||
    buyFee < CLASSIC_V4_POLICY.minimumTotalSwapFeeBps ||
    buyFee > CLASSIC_V4_POLICY.maximumTotalSwapFeeBps ||
    sellFee < CLASSIC_V4_POLICY.minimumTotalSwapFeeBps ||
    sellFee > CLASSIC_V4_POLICY.maximumTotalSwapFeeBps ||
    buyFee % CLASSIC_V4_POLICY.totalSwapFeeStepBps !== 0 ||
    sellFee % CLASSIC_V4_POLICY.totalSwapFeeStepBps !== 0 ||
    token.totalSwapFeeBps !== Math.max(buyFee, sellFee) ||
    token.initialTick !== CLASSIC_V4_POLICY.initialTick ||
    token.tickLower !== CLASSIC_V4_POLICY.liquidityTickLower ||
    token.tickUpper !== CLASSIC_V4_POLICY.liquidityTickUpper ||
    token.lpFeePips !== CLASSIC_V4_POLICY.lpFeePips ||
    !exactClassicV4Custody(custody, token.launchedAt)
  ) return null;
  return JSON.stringify([
    "classic-v4-token",
    token.id,
    tokenAddress,
    poolId,
    hookAddress,
    creatorAddress,
    rewardVaultAddress,
    positionRecipient,
    token.positionTokenId,
    launchHash,
    token.launchBlockNumber,
    launchTransactionHash,
    token.launchTransactionIndex,
    token.launchLogIndex,
    buyFee,
    sellFee,
    token.initialTick,
    token.tickLower,
    token.tickUpper,
  ]);
}

function exactIdentity(token) {
  if (typeof token?.id !== "string" || token.id.trim() === "") return null;
  if (token.exploreKind === "token") {
    const tokenAddress = String(token.tokenAddress ?? "").toLowerCase();
    const poolId = String(token.poolId ?? "").toLowerCase();
    if (!ADDRESS.test(tokenAddress) || !BYTES32.test(poolId)) return null;

    if (token.launchModel === "custom-graph") {
      const stamp = token.launchStampProvenance;
      const category = token.launchCategoryProvenance;
      const launchId = String(stamp?.launchId ?? "").toLowerCase();
      const stampHash = String(stamp?.stampHash ?? "").toLowerCase();
      const poolManagerAddress = String(
        stamp?.poolManagerAddress ?? "",
      ).toLowerCase();
      if (
        token.launchModelVersion !== "programmable-launch-stamp-router-v1" ||
        stamp?.schemaVersion !== "programmable.launch-stamp-provenance.v1" ||
        stamp.chainId !== 1 ||
        stamp.kind !== "custom-graph" ||
        !BYTES32.test(launchId) ||
        !BYTES32.test(stampHash) ||
        String(stamp.poolId ?? "").toLowerCase() !== poolId ||
        category?.schemaVersion !==
          "programmable.explore-launch-category-provenance.v1" ||
        category.category !== "custom" ||
        category.source !== "canonical-launch-stamp-router" ||
        String(category.launchId ?? "").toLowerCase() !== launchId ||
        String(category.stampHash ?? "").toLowerCase() !== stampHash ||
        !ADDRESS.test(poolManagerAddress) ||
        String(stamp.tokenProof?.tokenAddress ?? "").toLowerCase() !==
          tokenAddress ||
        String(stamp.tokenProof?.launchId ?? "").toLowerCase() !== launchId ||
        String(stamp.tokenProof?.stampHash ?? "").toLowerCase() !== stampHash ||
        String(stamp.poolProof?.poolManagerAddress ?? "").toLowerCase() !==
          poolManagerAddress ||
        String(stamp.poolProof?.poolId ?? "").toLowerCase() !== poolId ||
        String(stamp.poolProof?.launchId ?? "").toLowerCase() !== launchId ||
        String(stamp.poolProof?.stampHash ?? "").toLowerCase() !== stampHash
      ) return null;
      return JSON.stringify([
        "router-custom-token",
        token.id,
        tokenAddress,
        poolId,
        launchId,
        stampHash,
      ]);
    }

    const exactOfficialException =
      tokenAddress === PROGRAMMABLE_MAIN_ASSET_ADDRESS &&
      token.launchModelVersion === "classic-v2";
    if (token.launchModelVersion === "classic-v4") {
      return exactClassicV4Identity(token, tokenAddress, poolId);
    }
    if (
      token.launchModel !== "classic" ||
      (token.launchModelVersion !== "classic-v3" && !exactOfficialException) ||
      token.launchStampProvenance !== undefined
    ) return null;
    return JSON.stringify([
      "token",
      token.id,
      tokenAddress,
      poolId,
    ]);
  }
  if (
    token.exploreKind !== "custom-project" ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(token.customProjectId ?? "")) ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(token.customLaunchId ?? "")) ||
    (token.tokenAddress !== undefined &&
      !ADDRESS.test(String(token.tokenAddress).toLowerCase())) ||
    !Array.isArray(token.markets)
  ) return null;
  const markets = token.markets.map((market) => {
    const poolId = market?.poolId === undefined
      ? null
      : String(market.poolId).toLowerCase();
    if (
      typeof market?.marketId !== "string" || market.marketId.trim() === "" ||
      typeof market.kind !== "string" || market.kind.trim() === "" ||
      !["active", "paused", "closed", "verification_pending"].includes(
        market.status,
      ) ||
      (poolId !== null && !/^0x[0-9a-f]{64}$/u.test(poolId)) ||
      typeof market.baseAsset?.assetId !== "string" ||
      typeof market.baseAsset?.identity?.namespace !== "string" ||
      typeof market.baseAsset?.identity?.value !== "string" ||
      typeof market.quoteAsset?.assetId !== "string" ||
      typeof market.quoteAsset?.identity?.namespace !== "string" ||
      typeof market.quoteAsset?.identity?.value !== "string"
    ) return null;
    return [
      market.marketId,
      market.kind,
      market.status,
      poolId,
      market.baseAsset.assetId,
      market.baseAsset.identity.namespace,
      market.baseAsset.identity.value,
      market.quoteAsset.assetId,
      market.quoteAsset.identity.namespace,
      market.quoteAsset.identity.value,
    ];
  });
  if (markets.some((market) => market === null)) return null;
  const deterministicMarkets = markets
    .map((market) => JSON.stringify(market))
    .sort();
  if (new Set(deterministicMarkets).size !== deterministicMarkets.length) {
    return null;
  }
  return JSON.stringify([
    "custom-project",
    token.id,
    token.customProjectId,
    token.customLaunchId,
    token.tokenAddress?.toLowerCase() ?? null,
    deterministicMarkets,
  ]);
}

function canonicalMarketAddress(value) {
  const normalized = String(value ?? "").toLowerCase();
  return ADDRESS.test(normalized) ? normalized : null;
}

function canonicalMarketPool(value) {
  const normalized = String(value ?? "").toLowerCase();
  return /^0x[0-9a-f]{64}$/u.test(normalized) ? normalized : null;
}

function entryMarketIdentities(token) {
  const tokenAddress = canonicalMarketAddress(token?.tokenAddress);
  if (tokenAddress === null) return [];
  if (token.exploreKind === "token") {
    const poolId = canonicalMarketPool(token.poolId);
    const chainId = token.launchStampProvenance?.chainId ??
      Number(String(token.id).split(":", 1)[0]);
    if (chainId !== 1 || poolId === null) return [];
    let quoteAddress = canonicalMarketAddress(token.quoteAssetAddress);
    const stampPoolKey = token.launchStampProvenance?.poolKey;
    if (stampPoolKey) {
      const currency0 = canonicalMarketAddress(stampPoolKey.currency0);
      const currency1 = canonicalMarketAddress(stampPoolKey.currency1);
      quoteAddress = currency0 === tokenAddress && currency1 !== tokenAddress
        ? currency1
        : currency1 === tokenAddress && currency0 !== tokenAddress
          ? currency0
          : null;
    } else if (quoteAddress === null) {
      quoteAddress = token.launchModel === "stock-paired" ||
          token.launchModel === "custom-graph"
        ? null
        : "0x0000000000000000000000000000000000000000";
    }
    return quoteAddress === null || quoteAddress === tokenAddress
      ? []
      : [{ tokenAddress, poolId, quoteAddress }];
  }
  if (token.exploreKind !== "custom-project" || token.chainId !== "1") {
    return [];
  }
  const byPool = new Map();
  for (const market of token.markets) {
    const poolId = canonicalMarketPool(market?.poolId);
    if (poolId === null || market.status === "verification_pending") continue;
    const base = canonicalMarketAddress(market.baseAsset?.identity?.value);
    const quote = canonicalMarketAddress(market.quoteAsset?.identity?.value);
    if (base !== tokenAddress && quote !== tokenAddress) continue;
    const opposite = base === tokenAddress ? quote : base;
    if (opposite === null || opposite === tokenAddress) continue;
    byPool.set(poolId, { tokenAddress, poolId, quoteAddress: opposite });
  }
  return [...byPool.values()];
}

function exactMarketIdentityCount(tokens) {
  const byPool = new Map();
  const conflicted = new Set();
  for (const token of tokens) {
    for (const identity of entryMarketIdentities(token)) {
      if (conflicted.has(identity.poolId)) continue;
      const existing = byPool.get(identity.poolId);
      if (
        existing &&
        (existing.tokenAddress !== identity.tokenAddress ||
          existing.quoteAddress !== identity.quoteAddress)
      ) {
        byPool.delete(identity.poolId);
        conflicted.add(identity.poolId);
        continue;
      }
      byPool.set(identity.poolId, identity);
    }
  }
  return byPool.size;
}

function exactGmgnEligibleCanonicalToken(token) {
  if (
    token?.exploreKind !== "token" ||
    exactIdentity(token) === null ||
    entryMarketIdentities(token).length !== 1 ||
    typeof token.totalSupplyRaw !== "string" ||
    !/^[1-9][0-9]{0,77}$/u.test(token.totalSupplyRaw) ||
    !Number.isSafeInteger(token.tokenDecimals) ||
    token.tokenDecimals < 0 ||
    token.tokenDecimals > 255
  ) return false;
  const provenance = token.launchCategoryProvenance;
  if (provenance?.source === "canonical-launch-read-model") return true;
  const stamp = token.launchStampProvenance;
  return provenance?.source === "canonical-launch-stamp-router" &&
    canonicalMarketAddress(stamp?.poolManagerAddress) ===
      CANONICAL_POOL_MANAGER_ADDRESS &&
    canonicalMarketAddress(stamp?.poolProof?.poolManagerAddress) ===
      CANONICAL_POOL_MANAGER_ADDRESS;
}

function healthHasSensitiveData(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) {
    return value.some((entry) => healthHasSensitiveData(entry, depth + 1));
  }
  return Object.entries(value).some(([key, entry]) =>
    /(?:url|endpoint|secret|token|credential)/iu.test(key) ||
    (typeof entry === "string" && /:\/\//u.test(entry)) ||
    healthHasSensitiveData(entry, depth + 1)
  );
}

function exactInformationalHealth(response) {
  const checkedAt = response.body?.checkedAt;
  const primaryProvider = response.body?.provider;
  const providers = response.body?.providers;
  const gmgn = providers?.[0];
  const bitquery = providers?.[1];
  const dexscreener = providers?.[2];
  const gmgnRequestsPerSecond = gmgn?.requestsPerSecond;
  const gmgnAccountGateMode = gmgn?.accountGateMode;
  const gmgnAccountGateReady = gmgnAccountGateMode === "multiflight-v1" ||
    (gmgnAccountGateMode === "legacy-singleflight-v1" &&
      Number.isSafeInteger(gmgnRequestsPerSecond) &&
      gmgnRequestsPerSecond < 20);
  const providerStackReady = gmgn?.configured === true &&
    bitquery?.configured === true && dexscreener?.configured === true &&
    gmgnAccountGateReady;
  return response.status === 200 &&
    response.body?.status === (providerStackReady ? "ready" : "degraded") &&
    primaryProvider?.name === "gmgn" &&
    typeof primaryProvider.configured === "boolean" &&
    Array.isArray(providers) &&
    providers.length === 3 &&
    gmgn?.name === "gmgn" &&
    gmgn.role === "primary-token-market" &&
    typeof gmgn.configured === "boolean" &&
    gmgn.configured === primaryProvider.configured &&
    Number.isSafeInteger(gmgnRequestsPerSecond) &&
    gmgnRequestsPerSecond >= 1 &&
    gmgnRequestsPerSecond <= 20 &&
    [
      "multiflight-v1",
      "legacy-singleflight-v1",
      "unavailable",
    ].includes(gmgnAccountGateMode) &&
    bitquery?.name === "bitquery" &&
    bitquery.role === "exact-pool-chart-fallback" &&
    typeof bitquery.configured === "boolean" &&
    dexscreener?.name === "dexscreener" &&
    dexscreener.role === "batch-fail-soft-fallback" &&
    dexscreener.configured === true &&
    ISO_TIMESTAMP.test(String(checkedAt ?? "")) &&
    new Date(Date.parse(checkedAt)).toISOString() === checkedAt &&
    !healthHasSensitiveData(response.body);
}

function qualifiedDexscreenerFdv(token, nowMs) {
  const valuation = token?.valuation;
  return valuation?.status === "available" &&
    valuation.metric === "fdv" &&
    valuation.supplyBasis === "total" &&
    valuation.currency === "usd" &&
    valuation.freshness === "provider-recent" &&
    valuation.source === "dexscreener" &&
    POSITIVE_INTEGER.test(String(valuation.valueWad ?? "")) &&
    token.fdvUsdWad === valuation.valueWad &&
    currentProviderTimestamp(valuation.asOfTime, nowMs);
}

function exactUnavailableValuation(token) {
  return token?.valuation?.status === "unavailable" &&
    ["no-market", "source-unavailable"].includes(token.valuation.reason) &&
    token.fdvUsdWad === undefined &&
    token.marketCapUsdWad === undefined &&
    token.priceUsdWad === undefined &&
    token.marketData === undefined;
}

function exactVisibleUnavailableValuation(token) {
  return token?.valuation?.status === "unavailable" &&
    [
      "no-market",
      "source-unavailable",
      "liquidity-unavailable",
    ].includes(token.valuation.reason) &&
    token.fdvUsdWad === undefined &&
    token.marketCapUsdWad === undefined &&
    token.priceUsdWad === undefined &&
    token.marketData === undefined;
}

function exactGmgnSnapshot(token, nowMs) {
  const snapshot = token?.gmgnMarketData;
  if (
    !exactObjectKeys(snapshot, [
      "currency",
      "fdvUsdWad",
      "fetchedAt",
      "identity",
      "liquidityUsdWad",
      "marketScope",
      "poolAttribution",
      "priceUsdWad",
      "schemaVersion",
      "source",
      "swapCount24h",
      "volume24hUsdWad",
    ]) ||
    !exactObjectKeys(snapshot.identity, [
      "chainId",
      "poolId",
      "protocol",
      "quoteAddress",
      "tokenAddress",
    ]) ||
    snapshot.schemaVersion !== "programmable.gmgn-market-snapshot.v1" ||
    snapshot.source !== "gmgn" ||
    snapshot.marketScope !== "token" ||
    !["exact", "unavailable"].includes(snapshot.poolAttribution) ||
    snapshot.currency !== "USD" ||
    !currentProviderTimestamp(snapshot.fetchedAt, nowMs) ||
    !POSITIVE_INTEGER.test(String(snapshot.priceUsdWad ?? "")) ||
    !POSITIVE_INTEGER.test(String(snapshot.fdvUsdWad ?? "")) ||
    !POSITIVE_INTEGER.test(String(snapshot.liquidityUsdWad ?? "")) ||
    BigInt(snapshot.liquidityUsdWad) < MINIMUM_FDV_LIQUIDITY_USD_WAD ||
    !unsignedInteger(snapshot.volume24hUsdWad) ||
    !Number.isSafeInteger(snapshot.swapCount24h) ||
    snapshot.swapCount24h < 0 ||
    snapshot.identity.chainId !== "1" ||
    snapshot.identity.protocol !== "uniswap_v4"
  ) return false;
  const identity = {
    tokenAddress: canonicalMarketAddress(snapshot.identity.tokenAddress),
    poolId: canonicalMarketPool(snapshot.identity.poolId),
    quoteAddress: canonicalMarketAddress(snapshot.identity.quoteAddress),
  };
  if (
    identity.tokenAddress !== snapshot.identity.tokenAddress ||
    identity.poolId !== snapshot.identity.poolId ||
    identity.quoteAddress !== snapshot.identity.quoteAddress ||
    !entryMarketIdentities(token).some((candidate) =>
      candidate.tokenAddress === identity.tokenAddress &&
      candidate.poolId === identity.poolId &&
      candidate.quoteAddress === identity.quoteAddress
    ) ||
    !unsignedInteger(token.totalSupplyRaw) ||
    BigInt(token.totalSupplyRaw) <= 0n ||
    !Number.isSafeInteger(token.tokenDecimals) ||
    token.tokenDecimals < 0 ||
    token.tokenDecimals > 255
  ) return false;
  const expectedFdvUsdWad = (
    BigInt(snapshot.priceUsdWad) * BigInt(token.totalSupplyRaw)
  ) / (10n ** BigInt(token.tokenDecimals));
  return expectedFdvUsdWad > 0n &&
    BigInt(snapshot.fdvUsdWad) === expectedFdvUsdWad &&
    token.fdvUsdWad === snapshot.fdvUsdWad;
}

function qualifiedGmgnFdv(token, nowMs) {
  const valuation = token?.valuation;
  return exactGmgnSnapshot(token, nowMs) &&
    valuation?.status === "available" &&
    valuation.metric === "fdv" &&
    valuation.supplyBasis === "total" &&
    valuation.currency === "usd" &&
    valuation.freshness === "provider-recent" &&
    valuation.source === "gmgn" &&
    valuation.valueWad === token.gmgnMarketData.fdvUsdWad &&
    valuation.asOfTime === token.gmgnMarketData.fetchedAt;
}

function exactSourceHeader(response, name, sources) {
  return response.headers.get(name) ===
    (sources.length > 0 ? sources.join("+") : null);
}

function exactCatalogSnapshot(
  response,
  options = { requireLaunchIdentity: true },
) {
  const readSourceSuffix = options.readSourceSuffix ?? "";
  const catalog = response.body?.catalog;
  const source = catalog?.source;
  const generatedAt = catalog?.lastIndexedAt;
  const launchIdentity = response.body?.dataQuality?.launchIdentity;
  const customStatus = catalog?.completeness?.custom;
  const registryCustomStatus = catalog?.completeness?.registryCustom;
  const routerCustomStatus = catalog?.completeness?.routerCustom;
  const routerCustomAvailable =
    routerCustomStatus === "current" ||
    routerCustomStatus === "last-known-good";
  const routerOnlyFallback =
    catalog?.launchSource === "canonical-launch-stamp-router";
  const marketProvider = response.headers.get(
    "x-programmable-market-provider",
  );
  if (routerOnlyFallback) {
    const routerStamp = catalog?.routerStamp;
    if (!(
      source === "envio-classic-v3" &&
      catalog?.status === "last-known-good" &&
      ISO_TIMESTAMP.test(String(generatedAt ?? "")) &&
      new Date(Date.parse(generatedAt)).toISOString() === generatedAt &&
      Number.isSafeInteger(catalog.identityCount) &&
      catalog.identityCount > 0 &&
      catalog.identityCount === response.body?.total &&
      catalog.completeness?.classic === "unavailable" &&
      catalog.completeness?.stock === "excluded" &&
      customStatus === "unavailable" &&
      registryCustomStatus === "unavailable" &&
      routerCustomAvailable &&
      JSON.stringify(catalog.scope?.included) === JSON.stringify([
        "canonical-launch-stamp-router",
      ]) &&
      JSON.stringify(catalog.scope?.excluded) === JSON.stringify([
        "classic-v1",
        "classic-v2",
        "stock-paired-v1",
        "stock-paired-v2",
        "stock-paired-v3",
      ]) &&
      JSON.stringify(catalog.scope?.publicCategories) ===
        JSON.stringify(["classic", "custom"]) &&
      /^sha256:[0-9a-f]{64}$/u.test(
        String(catalog.identityCommitment ?? ""),
      ) &&
      catalog.evidence === undefined &&
      POSITIVE_INTEGER.test(String(catalog.asOfBlock ?? "")) &&
      /^0x[0-9a-f]{64}$/u.test(String(catalog.asOfBlockHash ?? "")) &&
      routerStamp?.source === "canonical-launch-stamp-router" &&
      routerStamp.status === routerCustomStatus &&
      routerStamp.finalityConfirmations === 64 &&
      Number.isSafeInteger(routerStamp.verifiedIdentityCount) &&
      routerStamp.verifiedIdentityCount >= catalog.identityCount &&
      routerStamp.projectedIdentityCount === catalog.identityCount &&
      routerStamp.generatedAt === generatedAt &&
      routerStamp.asOfBlock === catalog.asOfBlock &&
      routerStamp.asOfBlockHash === catalog.asOfBlockHash &&
      /^sha256:[0-9a-f]{64}$/u.test(
        String(routerStamp.identityCommitment ?? ""),
      ) &&
      response.headers.get("x-programmable-launch-source") ===
        "canonical-launch-stamp-router" &&
      EXPLORE_MARKET_PROVIDERS.has(marketProvider) &&
      response.headers.get("x-programmable-read-source") ===
        `canonical-launch-stamp-router+${marketProvider}${readSourceSuffix}` &&
      response.headers.get("x-programmable-canonical-read-status") ===
        "unavailable" &&
      response.headers.get("x-programmable-router-read-status") ===
        routerCustomStatus &&
      response.headers.get("x-programmable-identity-last-indexed-at") ===
        generatedAt &&
      (
        options.requireLaunchIdentity === false ||
        (
          launchIdentity?.custom === "unavailable" &&
          launchIdentity?.canonical === "unavailable" &&
          launchIdentity?.status === "partial" &&
          Number.isSafeInteger(launchIdentity.ageMs) &&
          launchIdentity.ageMs >= 0
        )
      )
    )) return null;
    // Delivery freshness is validated above with its matching headers. Bind
    // pagination to identity fields so current and last-known-good delivery
    // of the same exact identity set do not create a false catalog drift.
    return JSON.stringify({
      source,
      identityCount: catalog.identityCount,
      identityCommitment: catalog.identityCommitment,
      scope: catalog.scope,
      evidenceDeployment: null,
      evidenceSourceCommit: null,
      classicV4Bound: false,
      routerEvidence: {
        identityCommitment: routerStamp.identityCommitment,
      },
      launchSource: catalog.launchSource,
    });
  }
  const launchSource = [
    source,
    ...(registryCustomStatus === "current"
      ? ["registry.custom-launched"]
      : []),
    ...(routerCustomAvailable
      ? ["canonical-launch-stamp-router"]
      : []),
  ].join("+");
  const expectedCustomStatus =
    registryCustomStatus === "current" &&
      routerCustomStatus === "current"
      ? "current"
      : registryCustomStatus === "current" &&
          routerCustomStatus === "last-known-good"
        ? "last-known-good"
        : "unavailable";
  const baseIncluded = [
    "classic-v3",
    "official-main-token",
    "registry.custom-launched",
    ...(routerCustomAvailable
      ? ["canonical-launch-stamp-router"]
      : []),
  ];
  const classicV4Included = [
    "classic-v3",
    "classic-v4",
    "official-main-token",
    "registry.custom-launched",
    ...(routerCustomAvailable
      ? ["canonical-launch-stamp-router"]
      : []),
  ];
  const included = JSON.stringify(catalog.scope?.included);
  const classicV4Bound = included === JSON.stringify(classicV4Included);
  if (!(
    CATALOG_SOURCES.has(source) &&
    CATALOG_STATUSES.has(catalog?.status) &&
    ISO_TIMESTAMP.test(String(generatedAt ?? "")) &&
    new Date(Date.parse(generatedAt)).toISOString() === generatedAt &&
    catalog.identityCount === response.body?.total &&
    catalog.launchSource === launchSource &&
    ["current", "last-known-good"].includes(catalog.completeness?.classic) &&
    catalog.completeness?.stock === "excluded" &&
    customStatus === expectedCustomStatus &&
    ["current", "unavailable"].includes(registryCustomStatus) &&
    ["current", "last-known-good", "unavailable"].includes(
      routerCustomStatus,
    ) &&
    (included === JSON.stringify(baseIncluded) || classicV4Bound) &&
    JSON.stringify(catalog.scope?.excluded) === JSON.stringify([
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ]) &&
    JSON.stringify(catalog.scope?.publicCategories) ===
      JSON.stringify(["classic", "custom"]) &&
    /^sha256:[0-9a-f]{64}$/u.test(String(catalog.identityCommitment ?? "")) &&
    catalog.evidence?.kind === "envio-indexer-state" &&
    /^[a-z0-9][a-z0-9-]{0,127}$/u.test(
      String(catalog.evidence.deployment ?? ""),
    ) &&
    /^[0-9a-f]{40}$/u.test(String(catalog.evidence.sourceCommit ?? "")) &&
    catalog.evidence.progressBlock === catalog.asOfBlock &&
    /^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:[0-9]+$/u.test(
      String(catalog.evidence.progressOccurrenceId ?? ""),
    ) &&
    /^sha256:[0-9a-f]{64}$/u.test(
      String(catalog.evidence.commitment ?? ""),
    ) &&
    POSITIVE_INTEGER.test(String(catalog.asOfBlock ?? "")) &&
    /^0x[0-9a-f]{64}$/u.test(String(catalog.asOfBlockHash ?? "")) &&
    response.headers.get("x-programmable-launch-source") ===
      launchSource &&
    EXPLORE_MARKET_PROVIDERS.has(marketProvider) &&
    response.headers.get("x-programmable-read-source") ===
      `${launchSource}+${marketProvider}${readSourceSuffix}` &&
    response.headers.get("x-programmable-canonical-read-status") ===
      catalog.completeness.classic &&
    response.headers.get("x-programmable-router-read-status") ===
      routerCustomStatus &&
    response.headers.get("x-programmable-identity-last-indexed-at") ===
      generatedAt &&
    (
      options.requireLaunchIdentity === false ||
      (
        launchIdentity?.custom === customStatus &&
        ["current", "last-known-good"].includes(launchIdentity?.canonical) &&
        ["current", "last-known-good", "partial"].includes(
          launchIdentity?.status,
        ) &&
        Number.isSafeInteger(launchIdentity.ageMs) &&
        launchIdentity.ageMs >= 0
      )
    )
  )) return null;
  // Completeness is operational metadata and was validated above. It is not
  // part of the cross-request identity boundary.
  return JSON.stringify({
    source,
    identityCount: catalog.identityCount,
    identityCommitment: catalog.identityCommitment,
    scope: catalog.scope,
    evidenceDeployment: catalog.evidence.deployment,
    evidenceSourceCommit: catalog.evidence.sourceCommit,
    classicV4Bound,
    launchSource,
  });
}

function exactMarketReadCounters(read, expectedRequestedCount, nowMs) {
  const exactReadWindow = read?.observedCount === 0
    ? read.oldestFetchedAt === null && read.newestFetchedAt === null
    : currentProviderTimestamp(read?.oldestFetchedAt, nowMs) &&
      currentProviderTimestamp(read?.newestFetchedAt, nowMs) &&
      Date.parse(read.oldestFetchedAt) <= Date.parse(read.newestFetchedAt);
  return MARKET_READ_STATUSES.has(read?.status) &&
    read.currency === "USD" &&
    Number.isSafeInteger(read.requestedCount) &&
    read.requestedCount === expectedRequestedCount &&
    Number.isSafeInteger(read.observedCount) &&
    Number.isSafeInteger(read.qualifiedCount) &&
    Number.isSafeInteger(read.unavailableCount) &&
    read.requestedCount >= 0 &&
    read.observedCount >= 0 &&
    read.observedCount <= read.requestedCount &&
    read.qualifiedCount >= 0 &&
    read.qualifiedCount <= read.observedCount &&
    read.unavailableCount === read.requestedCount - read.qualifiedCount &&
    (read.status !== "unavailable" || read.observedCount === 0) &&
    exactReadWindow;
}

function exactMarketAsOfBinding(response, tokens, read, nowMs) {
  const qualifiedTimes = tokens.flatMap((token) => {
    const valuation = token?.valuation;
    return valuation?.status === "available" &&
        valuation.freshness === "provider-recent" &&
        (valuation.source === "dexscreener" || valuation.source === "gmgn") &&
        currentProviderTimestamp(valuation.asOfTime, nowMs)
      ? [valuation.asOfTime]
      : [];
  });
  const expectedAsOf = qualifiedTimes.length === 0
    ? null
    : qualifiedTimes.reduce((latest, value) =>
        Date.parse(value) > Date.parse(latest) ? value : latest
      );
  if (
    response.body?.dataQuality?.valuation?.asOfTime !== expectedAsOf ||
    response.headers.get("x-programmable-market-as-of") !== expectedAsOf
  ) return false;
  if (qualifiedTimes.length === 0) return true;
  return read.oldestFetchedAt !== null &&
    read.newestFetchedAt !== null &&
    qualifiedTimes.every((value) =>
      Date.parse(value) >= Date.parse(read.oldestFetchedAt) &&
      Date.parse(value) <= Date.parse(read.newestFetchedAt)
    );
}

function exactDexscreenerMarketRead(
  response,
  requestedTokens,
  nowMs,
  visibleTokens = requestedTokens,
) {
  const read = response.body?.marketRead;
  const expectedRequestedCount = exactMarketIdentityCount(requestedTokens);
  if (
    read?.provider !== "dexscreener" ||
    !exactMarketReadCounters(read, expectedRequestedCount, nowMs) ||
    response.headers.get("x-programmable-market-provider") !== "dexscreener" ||
    response.headers.get("x-programmable-market-read-status") !== read.status ||
    !exactMarketAsOfBinding(response, visibleTokens, read, nowMs)
  ) return false;
  return exactSourceHeader(
    response,
    "x-programmable-market-source",
    read.observedCount > 0 ? ["dexscreener"] : [],
  ) && exactSourceHeader(
    response,
    "x-programmable-price-source",
    read.qualifiedCount > 0 ? ["dexscreener"] : [],
  );
}

function exactVisibleMarketRead(response, tokens, nowMs) {
  const read = response.body?.marketRead;
  if (read?.provider === "dexscreener") {
    return exactDexscreenerMarketRead(response, tokens, nowMs) &&
      tokens.every((token) => token?.gmgnMarketData === undefined);
  }
  const expectedRequestedCount = exactMarketIdentityCount(tokens);
  if (
    read?.provider !== "gmgn" ||
    read.fallbackProvider !== "dexscreener" ||
    !exactMarketReadCounters(read, expectedRequestedCount, nowMs) ||
    !Number.isSafeInteger(read.gmgnObservedCount) ||
    !Number.isSafeInteger(read.gmgnQualifiedCount) ||
    !Number.isSafeInteger(read.fallbackRequestedCount) ||
    !Number.isSafeInteger(read.fallbackObservedCount) ||
    !Number.isSafeInteger(read.fallbackQualifiedCount) ||
    read.gmgnObservedCount < 0 ||
    read.gmgnObservedCount > read.requestedCount ||
    read.gmgnQualifiedCount < 0 ||
    read.gmgnQualifiedCount > read.gmgnObservedCount ||
    read.fallbackRequestedCount >
      read.requestedCount - read.gmgnQualifiedCount ||
    (
      read.fallbackRequestedCount <
        read.requestedCount - read.gmgnQualifiedCount &&
      read.status === "complete"
    ) ||
    read.fallbackObservedCount < 0 ||
    read.fallbackObservedCount > read.fallbackRequestedCount ||
    read.fallbackQualifiedCount < 0 ||
    read.fallbackQualifiedCount > read.fallbackObservedCount ||
    read.qualifiedCount !==
      read.gmgnQualifiedCount + read.fallbackQualifiedCount ||
    read.observedCount <
      Math.max(read.gmgnObservedCount, read.fallbackObservedCount) ||
    read.observedCount > Math.min(
      read.requestedCount,
      read.gmgnObservedCount + read.fallbackObservedCount,
    ) ||
    response.headers.get("x-programmable-market-provider") !==
      (read.fallbackRequestedCount > 0 ? "gmgn+dexscreener" : "gmgn") ||
    response.headers.get("x-programmable-market-read-status") !== read.status ||
    !exactMarketAsOfBinding(response, tokens, read, nowMs)
  ) return false;
  const gmgnObserved = tokens.filter((token) =>
    token?.gmgnMarketData !== undefined
  );
  const gmgnQualified = tokens.filter((token) => qualifiedGmgnFdv(token, nowMs));
  const fallbackQualified = tokens.filter((token) =>
    qualifiedDexscreenerFdv(token, nowMs)
  );
  const unavailable = tokens.filter(exactVisibleUnavailableValuation);
  if (
    gmgnObserved.length !== read.gmgnObservedCount ||
    gmgnObserved.some((token) => !exactGmgnSnapshot(token, nowMs)) ||
    gmgnQualified.length !== read.gmgnQualifiedCount ||
    fallbackQualified.length !== read.fallbackQualifiedCount ||
    gmgnQualified.length + fallbackQualified.length + unavailable.length !==
      tokens.length
  ) return false;
  const marketSources = [
    ...(read.gmgnObservedCount > 0 ? ["gmgn"] : []),
    ...(read.fallbackObservedCount > 0 ? ["dexscreener"] : []),
  ];
  const priceSources = [
    ...(read.gmgnQualifiedCount > 0 ? ["gmgn"] : []),
    ...(read.fallbackQualifiedCount > 0 ? ["dexscreener"] : []),
  ];
  return exactSourceHeader(
    response,
    "x-programmable-market-source",
    marketSources,
  ) && exactSourceHeader(
    response,
    "x-programmable-price-source",
    priceSources,
  );
}

function exactDetailMarketRead(response, token, launchSource, nowMs) {
  const provider = response.headers.get("x-programmable-market-provider");
  const marketStatus = response.headers.get(
    "x-programmable-market-read-status",
  );
  const hasGmgn = token?.gmgnMarketData !== undefined;
  const gmgnQualified = qualifiedGmgnFdv(token, nowMs);
  const dexscreenerQualified = qualifiedDexscreenerFdv(token, nowMs);
  const unavailable = exactVisibleUnavailableValuation(token);
  const marketAsOf = gmgnQualified || dexscreenerQualified
    ? token.valuation.asOfTime
    : null;
  if (
    !EXPLORE_MARKET_PROVIDERS.has(provider) ||
    response.headers.get("x-programmable-launch-source") !== launchSource ||
    response.headers.get("x-programmable-read-source") !==
      `${launchSource}+${provider}` ||
    !MARKET_READ_STATUSES.has(marketStatus) ||
    response.headers.get("x-programmable-market-as-of") !== marketAsOf ||
    ![gmgnQualified, dexscreenerQualified, unavailable].includes(true) ||
    (hasGmgn && !exactGmgnSnapshot(token, nowMs)) ||
    (provider === "dexscreener" && hasGmgn) ||
    (provider === "gmgn" && (!gmgnQualified || hasGmgn === false)) ||
    (provider === "gmgn+dexscreener" && gmgnQualified)
  ) return false;
  const marketSource = response.headers.get("x-programmable-market-source");
  const allowedMarketSources = provider === "dexscreener"
    ? new Set([null, "dexscreener"])
    : provider === "gmgn"
    ? new Set(["gmgn"])
    : new Set([null, "gmgn", "dexscreener", "gmgn+dexscreener"]);
  const priceSources = gmgnQualified
    ? ["gmgn"]
    : dexscreenerQualified
    ? ["dexscreener"]
    : [];
  return (marketStatus !== "unavailable" || marketSource === null) &&
    allowedMarketSources.has(marketSource) &&
    (
      priceSources.length === 0 ||
      marketSource?.split("+").includes(priceSources[0]) === true
    ) && exactSourceHeader(
    response,
    "x-programmable-price-source",
    priceSources,
  );
}

const MARKET_CAP_RANKING_KEYS = [
  "applied",
  "asOfTime",
  "canonicalAddressCoverageBps",
  "canonicalEntryCount",
  "canonicalTailCount",
  "canonicalTokenCount",
  "direction",
  "discardedProviderItemCount",
  "fallbackProvider",
  "fallbackQualifiedCount",
  "fallbackRequestedCount",
  "foreignTokenCount",
  "gmgnHydrationDeferredCount",
  "gmgnHydrationEligibleCount",
  "gmgnHydrationLimit",
  "gmgnHydrationObservedCount",
  "gmgnHydrationQualifiedCount",
  "gmgnHydrationRequestedCount",
  "gmgnStatus",
  "matchedTokenCount",
  "matchedUniqueTokenCount",
  "metricOrder",
  "observedTokenCount",
  "primaryProvider",
  "qualifiedCount",
  "rankInterval",
  "rankLimit",
  "rankingCommitment",
  "requested",
  "schemaVersion",
  "source",
  "status",
  "totalCount",
  "unobservedCanonicalEntryCount",
].sort();

function expectedMarketCapApplied(ranking) {
  if (ranking.totalCount === 0) return "launch-order";
  const hasRank = ranking.matchedTokenCount > 0;
  const hasHydration = ranking.gmgnHydrationQualifiedCount > 0;
  const hasFallback = ranking.fallbackQualifiedCount > 0;
  const hasTail = ranking.canonicalTailCount > 0;
  if (hasRank && hasHydration && hasFallback) {
    return hasTail
      ? "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
      : "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv";
  }
  if (hasRank && hasHydration) {
    return hasTail
      ? "gmgn-market-cap-then-gmgn-token-info-fdv-then-launch-order"
      : "gmgn-market-cap-then-gmgn-token-info-fdv";
  }
  if (hasRank && hasFallback) {
    return hasTail
      ? "gmgn-market-cap-then-dexscreener-fdv-then-launch-order"
      : "gmgn-market-cap-then-dexscreener-fdv";
  }
  if (hasRank) {
    return ranking.matchedTokenCount === ranking.totalCount
      ? "gmgn-market-cap"
      : "gmgn-market-cap-then-launch-order";
  }
  if (hasHydration && hasFallback) {
    return hasTail
      ? "gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
      : "gmgn-token-info-fdv-then-dexscreener-fdv";
  }
  if (hasHydration) {
    return hasTail
      ? "gmgn-token-info-fdv-then-launch-order"
      : "gmgn-token-info-fdv";
  }
  if (hasFallback) {
    return hasTail ? "qualified-fdv-then-launch-order" : "fdv";
  }
  return "launch-order";
}

function expectedMarketCapSource(ranking) {
  const gmgnQualifiedCount = ranking.matchedTokenCount +
    ranking.gmgnHydrationQualifiedCount;
  if (gmgnQualifiedCount > 0) {
    return ranking.fallbackQualifiedCount > 0
      ? "gmgn+dexscreener"
      : "gmgn";
  }
  return ranking.fallbackQualifiedCount > 0
    ? "dexscreener"
    : "canonical-launch-order";
}

function marketCapReadSourceSuffix(response) {
  return response.body?.ranking?.gmgnStatus === "unavailable"
    ? ""
    : "+gmgn-ranking";
}

function exactMarketCapRanking(response, canonicalTokens, direction, nowMs) {
  const ranking = response.body?.ranking;
  const canonicalAddresses = new Set(canonicalTokens.flatMap((token) => {
    const address = canonicalMarketAddress(token?.tokenAddress);
    return address === null ? [] : [address];
  }));
  if (!exactObjectKeys(ranking, MARKET_CAP_RANKING_KEYS)) return false;
  const integerFields = [
    "observedTokenCount",
    "matchedTokenCount",
    "matchedUniqueTokenCount",
    "canonicalEntryCount",
    "canonicalTokenCount",
    "unobservedCanonicalEntryCount",
    "canonicalAddressCoverageBps",
    "foreignTokenCount",
    "discardedProviderItemCount",
    "gmgnHydrationLimit",
    "gmgnHydrationEligibleCount",
    "gmgnHydrationRequestedCount",
    "gmgnHydrationObservedCount",
    "gmgnHydrationQualifiedCount",
    "gmgnHydrationDeferredCount",
    "fallbackRequestedCount",
    "fallbackQualifiedCount",
    "canonicalTailCount",
    "qualifiedCount",
    "totalCount",
  ];
  if (
    integerFields.some((field) =>
      !Number.isSafeInteger(ranking[field]) || ranking[field] < 0
    ) ||
    ranking.schemaVersion !== "programmable.explore-market-cap-ranking.v1" ||
    ranking.requested !== "market-cap" ||
    ranking.direction !== direction ||
    ranking.primaryProvider !== "gmgn" ||
    ranking.fallbackProvider !== "dexscreener" ||
    ranking.metricOrder !==
      "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order" ||
    ranking.rankInterval !== "1h" ||
    ranking.rankLimit !== 100 ||
    ranking.gmgnHydrationLimit !== 100 ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(ranking.rankingCommitment ?? "")) ||
    ranking.canonicalEntryCount !== canonicalTokens.length ||
    ranking.totalCount !== canonicalTokens.length ||
    ranking.totalCount !== response.body?.total ||
    ranking.canonicalTokenCount !== canonicalAddresses.size ||
    ranking.observedTokenCount > 100 ||
    ranking.foreignTokenCount > ranking.observedTokenCount ||
    ranking.matchedTokenCount > ranking.canonicalEntryCount ||
    ranking.matchedUniqueTokenCount > ranking.matchedTokenCount ||
    ranking.matchedUniqueTokenCount > ranking.canonicalTokenCount ||
    ranking.observedTokenCount !==
      ranking.matchedUniqueTokenCount + ranking.foreignTokenCount ||
    ranking.unobservedCanonicalEntryCount !==
      ranking.canonicalEntryCount - ranking.matchedTokenCount ||
    ranking.gmgnHydrationEligibleCount >
      ranking.unobservedCanonicalEntryCount ||
    ranking.gmgnHydrationRequestedCount !==
      Math.min(
        ranking.gmgnHydrationEligibleCount,
        ranking.gmgnHydrationLimit,
      ) ||
    ranking.gmgnHydrationObservedCount >
      ranking.gmgnHydrationRequestedCount ||
    ranking.gmgnHydrationQualifiedCount >
      ranking.gmgnHydrationObservedCount ||
    ranking.gmgnHydrationDeferredCount !==
      ranking.gmgnHydrationEligibleCount -
        ranking.gmgnHydrationRequestedCount ||
    ranking.fallbackRequestedCount !==
      ranking.unobservedCanonicalEntryCount -
        ranking.gmgnHydrationQualifiedCount ||
    ranking.fallbackQualifiedCount > ranking.fallbackRequestedCount ||
    ranking.qualifiedCount !==
      ranking.matchedTokenCount + ranking.gmgnHydrationQualifiedCount +
        ranking.fallbackQualifiedCount ||
    ranking.canonicalTailCount !==
      ranking.totalCount - ranking.qualifiedCount ||
    ranking.qualifiedCount > ranking.totalCount ||
    ranking.canonicalAddressCoverageBps > 10_000 ||
    ranking.canonicalAddressCoverageBps !==
      (ranking.canonicalTokenCount === 0
        ? 0
        : Math.floor(
            ranking.matchedUniqueTokenCount * 10_000 /
              ranking.canonicalTokenCount,
          )) ||
    ranking.source !== expectedMarketCapSource(ranking) ||
    ranking.applied !== expectedMarketCapApplied(ranking)
  ) return false;
  const expectedStatus = ranking.qualifiedCount === 0 || ranking.totalCount === 0
    ? "unavailable"
    : ranking.qualifiedCount === ranking.totalCount
      ? "complete"
      : "partial";
  const gmgnQualifiedCount = ranking.matchedTokenCount +
    ranking.gmgnHydrationQualifiedCount;
  const expectedGmgnStatus = gmgnQualifiedCount === 0 ||
      ranking.totalCount === 0
    ? "unavailable"
    : gmgnQualifiedCount === ranking.totalCount
      ? "complete"
      : "partial";
  const exactAsOfTime = ranking.observedTokenCount === 0 &&
      ranking.qualifiedCount === 0
    ? ranking.asOfTime === null
    : currentProviderTimestamp(ranking.asOfTime, nowMs);
  return ranking.status === expectedStatus &&
    ranking.gmgnStatus === expectedGmgnStatus &&
    exactAsOfTime &&
    (ranking.gmgnStatus === "unavailable" || ranking.asOfTime !== null) &&
    response.headers.get("x-programmable-ranking-primary-provider") ===
      "gmgn" &&
    response.headers.get("x-programmable-ranking-source") === ranking.source &&
    response.headers.get("x-programmable-ranking-read-status") ===
      ranking.status &&
    response.headers.get("x-programmable-ranking-gmgn-status") ===
      ranking.gmgnStatus &&
    response.headers.get("x-programmable-ranking-commitment") ===
      ranking.rankingCommitment;
}

function stableMarketCapRankingMetadata(ranking) {
  return JSON.stringify(Object.fromEntries(
    MARKET_CAP_RANKING_KEYS
      .filter((key) => !MARKET_CAP_RANKING_SEPARATE_KEYS.has(key))
      .map((key) => [key, ranking[key]]),
  ));
}

function exactRequiredGmgnMarketCapRanking(response, nowMs) {
  const ranking = response.body?.ranking;
  const gmgnQualifiedCount = ranking?.matchedUniqueTokenCount +
    ranking?.gmgnHydrationQualifiedCount;
  return ranking?.gmgnStatus !== "unavailable" &&
    Number.isSafeInteger(gmgnQualifiedCount) &&
    gmgnQualifiedCount > 0 &&
    ranking?.observedTokenCount > 0 &&
    currentProviderTimestamp(ranking?.asOfTime, nowMs) &&
    /^sha256:[0-9a-f]{64}$/u.test(String(ranking?.rankingCommitment ?? ""));
}

function exactRequiredGmgnMarketCapLiveness(response, direction, nowMs) {
  const ranking = response.body?.ranking;
  const gmgnQualifiedCount = ranking?.matchedUniqueTokenCount +
    ranking?.gmgnHydrationQualifiedCount;
  return ranking?.primaryProvider === "gmgn" &&
    ranking?.direction === direction &&
    ranking?.gmgnStatus !== "unavailable" &&
    Number.isSafeInteger(gmgnQualifiedCount) &&
    gmgnQualifiedCount > 0 &&
    Number.isSafeInteger(ranking?.observedTokenCount) &&
    ranking.observedTokenCount > 0 &&
    ranking.observedTokenCount ===
      ranking.matchedUniqueTokenCount + ranking.foreignTokenCount &&
    currentProviderTimestamp(ranking?.asOfTime, nowMs) &&
    /^sha256:[0-9a-f]{64}$/u.test(String(ranking?.rankingCommitment ?? ""));
}

const SEARCH_RANKING_KEYS = [
  "applied",
  "asOfTime",
  "canonicalAddressCoverageBps",
  "canonicalMatchCount",
  "canonicalMatchTokenCount",
  "discardedProviderItemCount",
  "duplicateProviderItemCount",
  "foreignTokenCount",
  "matchedTokenCount",
  "matchedUniqueTokenCount",
  "observedTokenCount",
  "orderBy",
  "provider",
  "providerOnlyCanonicalTokenCount",
  "rankingCommitment",
  "requested",
  "schemaVersion",
  "status",
  "unobservedCanonicalMatchCount",
].sort();

function searchReadSourceSuffix(response) {
  return response.body?.search?.asOfTime === null ? "" : "+gmgn-search";
}

function exactSearchRanking(response, canonicalMatches, query, nowMs) {
  const search = response.body?.search;
  const canonicalAddresses = new Set(canonicalMatches.flatMap((token) => {
    const address = canonicalMarketAddress(token?.tokenAddress);
    return address === null ? [] : [address];
  }));
  if (!exactObjectKeys(search, SEARCH_RANKING_KEYS)) return false;
  const integerFields = [
    "observedTokenCount",
    "matchedTokenCount",
    "matchedUniqueTokenCount",
    "canonicalMatchCount",
    "canonicalMatchTokenCount",
    "unobservedCanonicalMatchCount",
    "providerOnlyCanonicalTokenCount",
    "foreignTokenCount",
    "discardedProviderItemCount",
    "duplicateProviderItemCount",
    "canonicalAddressCoverageBps",
  ];
  if (
    integerFields.some((field) =>
      !Number.isSafeInteger(search[field]) || search[field] < 0
    ) ||
    search.schemaVersion !== "programmable.explore-search-ranking.v1" ||
    search.provider !== "gmgn" ||
    search.requested !== "search" ||
    search.orderBy !== "weight" ||
    response.body?.query !== query ||
    search.canonicalMatchCount !== canonicalMatches.length ||
    search.canonicalMatchCount !== response.body?.total ||
    search.canonicalMatchTokenCount !== canonicalAddresses.size ||
    search.matchedTokenCount > search.canonicalMatchCount ||
    search.matchedUniqueTokenCount > search.matchedTokenCount ||
    search.matchedUniqueTokenCount > search.canonicalMatchTokenCount ||
    search.unobservedCanonicalMatchCount !==
      search.canonicalMatchCount - search.matchedTokenCount ||
    search.providerOnlyCanonicalTokenCount > search.matchedUniqueTokenCount ||
    search.foreignTokenCount > search.observedTokenCount ||
    search.observedTokenCount !==
      search.matchedUniqueTokenCount + search.foreignTokenCount ||
    search.canonicalAddressCoverageBps > 10_000 ||
    search.canonicalAddressCoverageBps !==
      (search.canonicalMatchTokenCount === 0
        ? 0
        : Math.floor(
            search.matchedUniqueTokenCount * 10_000 /
              search.canonicalMatchTokenCount,
          )) ||
    search.applied !== (search.matchedTokenCount > 0
      ? "gmgn-canonical-search-with-local-match-fallback"
      : "local-match-order") ||
    !/^sha256:[0-9a-f]{64}$/u.test(String(search.rankingCommitment ?? ""))
  ) return false;
  const providerUsable = currentProviderTimestamp(search.asOfTime, nowMs);
  const expectedStatus = providerUsable
    ? search.matchedTokenCount === search.canonicalMatchCount
      ? "complete"
      : "partial"
    : "unavailable";
  return (search.asOfTime === null || providerUsable) &&
    search.status === expectedStatus &&
    response.headers.get("x-programmable-search-provider") === "gmgn" &&
    response.headers.get("x-programmable-search-read-status") ===
      search.status &&
    response.headers.get("x-programmable-search-matched-count") ===
      String(search.matchedTokenCount) &&
    response.headers.get("x-programmable-search-matched-unique-count") ===
      String(search.matchedUniqueTokenCount) &&
    response.headers.get("x-programmable-search-ranking-commitment") ===
      search.rankingCommitment;
}

function exactRequiredGmgnSearch(response, nowMs) {
  const search = response.body?.search;
  return currentProviderTimestamp(search?.asOfTime, nowMs) &&
    search?.matchedTokenCount > 0 &&
    search?.matchedUniqueTokenCount > 0 &&
    /^sha256:[0-9a-f]{64}$/u.test(String(search?.rankingCommitment ?? ""));
}

async function readBoundSearchSnapshot({
  request,
  canonicalTokens,
  catalogSnapshot,
  requireGmgnMarket,
  now,
}) {
  const searchable = (token) =>
    canonicalMarketAddress(token?.tokenAddress) !== null &&
    exactIdentity(token) !== null;
  const searchTarget = canonicalTokens.find((token) =>
    token?.exploreKind === "token" && searchable(token)
  ) ?? canonicalTokens.find(searchable);
  const query = canonicalMarketAddress(searchTarget?.tokenAddress);
  const targetIdentity = exactIdentity(searchTarget);
  if (query === null || targetIdentity === null) {
    throw new Error("Explore returned no canonical search identity");
  }

  const responses = [];
  const matchedTokens = [];
  let totalPages = null;
  let expectedTotal = null;
  let expectedSearch = null;
  for (let page = 1; page <= (totalPages ?? 1); page += 1) {
    const response = await request(
      `/api/explore?limit=100&page=${page}&sort=newest&q=${
        encodeURIComponent(query)
      }`,
    );
    const pageTokens = Array.isArray(response.body?.tokens)
      ? response.body.tokens
      : [];
    const searchCatalog = exactCatalogSnapshot(
      {
        ...response,
        body: {
          ...response.body,
          total: response.body?.catalog?.identityCount,
        },
      },
      {
        requireLaunchIdentity: true,
        readSourceSuffix: searchReadSourceSuffix(response),
      },
    );
    if (
      response.status !== 200 ||
      response.body?.status !== "ready" ||
      response.body?.sort !== "newest" ||
      response.body?.sortMetric !== "fdv" ||
      response.body?.query !== query ||
      response.body?.ranking !== undefined ||
      response.body?.discovery !== undefined ||
      response.body?.search === undefined ||
      searchCatalog === null ||
      !exactExplorePage(response, pageTokens, { page, pageSize: 100 }) ||
      !exactVisibleMarketRead(response, pageTokens, now().getTime())
    ) throw new Error("Canonical search response contract is invalid");
    if (searchCatalog !== catalogSnapshot) {
      throw new ExploreCatalogBoundaryDriftError(
        "Explore catalog changed during canonical search",
      );
    }

    if (page === 1) {
      totalPages = response.body.totalPages;
      expectedTotal = response.body.total;
      expectedSearch = JSON.stringify(response.body.search);
      if (
        !Number.isSafeInteger(totalPages) ||
        totalPages < 1 ||
        totalPages > 100
      ) throw new Error("Canonical search exceeds bounded smoke pagination");
    } else if (
      response.body.total !== expectedTotal ||
      response.body.totalPages !== totalPages ||
      JSON.stringify(response.body.search) !== expectedSearch
    ) {
      throw new ExploreCatalogBoundaryDriftError(
        "Canonical search snapshot changed during pagination",
      );
    }
    responses.push(response);
    matchedTokens.push(...pageTokens);
  }

  const matchedIdentities = matchedTokens.map(exactIdentity);
  const canonicalIdentitySet = new Set(canonicalTokens.map(exactIdentity));
  if (
    responses.length === 0 ||
    matchedTokens.length !== expectedTotal ||
    matchedIdentities.some((identity) => identity === null) ||
    new Set(matchedIdentities).size !== matchedIdentities.length ||
    matchedIdentities.some((identity) => !canonicalIdentitySet.has(identity)) ||
    !matchedIdentities.includes(targetIdentity) ||
    responses.some((response) =>
      !exactSearchRanking(response, matchedTokens, query, now().getTime())
    )
  ) throw new Error("Canonical search ranking contract is invalid");
  if (
    requireGmgnMarket &&
    !exactRequiredGmgnSearch(responses[0], now().getTime())
  ) throw new Error("GMGN canonical search match is required");
  return Object.freeze({
    query,
    search: responses[0].body.search,
  });
}

function exactSamePageOrder(first, second) {
  if (
    first.body?.total !== second.body?.total ||
    first.body?.totalPages !== second.body?.totalPages
  ) return false;
  const firstIds = first.body.tokens.map(exactIdentity);
  const secondIds = second.body.tokens.map(exactIdentity);
  return firstIds.every((identity) => identity !== null) &&
    secondIds.every((identity) => identity !== null) &&
    new Set(firstIds).size === firstIds.length &&
    new Set(secondIds).size === secondIds.length &&
    firstIds.length === secondIds.length &&
    firstIds.every((identity, index) => identity === secondIds[index]);
}

const DISCOVERY_KEYS = [
  "applied",
  "asOfTime",
  "canonicalAddressCoverageBps",
  "canonicalEntryCount",
  "canonicalTokenCount",
  "discardedProviderItemCount",
  "foreignTokenCount",
  "hotSearchInterval",
  "matchedTokenCount",
  "matchedUniqueTokenCount",
  "observedTokenCount",
  "provider",
  "rankInterval",
  "rankingCommitment",
  "requested",
  "schemaVersion",
  "snapshotCount",
  "status",
  "unobservedCanonicalEntryCount",
].sort();

function exactTrendingDiscovery(response, canonicalTokens, nowMs) {
  const discovery = response.body?.discovery;
  const canonicalAddresses = new Set(canonicalTokens.flatMap((token) => {
    const address = canonicalMarketAddress(token?.tokenAddress);
    return address === null ? [] : [address];
  }));
  const live = discovery?.status === "complete" || discovery?.status === "partial";
  const timestampIsExact = discovery?.snapshotCount === 0
    ? discovery?.asOfTime === null
    : currentProviderTimestamp(discovery?.asOfTime, nowMs);
  return exactObjectKeys(discovery, DISCOVERY_KEYS) &&
    discovery.schemaVersion === "programmable.explore-discovery-ranking.v1" &&
    discovery.provider === "gmgn" &&
    discovery.requested === "trending" &&
    /^sha256:[0-9a-f]{64}$/u.test(String(discovery.rankingCommitment ?? "")) &&
    ["complete", "partial", "unavailable"].includes(discovery.status) &&
    discovery.applied === (live
      ? "gmgn-ranked-with-launch-order-fallback"
      : "launch-order") &&
    discovery.rankInterval === "1h" &&
    discovery.hotSearchInterval === "24h" &&
    Number.isSafeInteger(discovery.snapshotCount) &&
    discovery.snapshotCount >= 0 && discovery.snapshotCount <= 2 &&
    Number.isSafeInteger(discovery.observedTokenCount) &&
    Number.isSafeInteger(discovery.matchedTokenCount) &&
    Number.isSafeInteger(discovery.matchedUniqueTokenCount) &&
    Number.isSafeInteger(discovery.foreignTokenCount) &&
    Number.isSafeInteger(discovery.discardedProviderItemCount) &&
    discovery.observedTokenCount >= 0 &&
    discovery.matchedTokenCount >= 0 &&
    discovery.matchedUniqueTokenCount >= 0 &&
    discovery.matchedUniqueTokenCount <= discovery.matchedTokenCount &&
    discovery.foreignTokenCount >= 0 &&
    discovery.discardedProviderItemCount >= 0 &&
    discovery.canonicalEntryCount === canonicalTokens.length &&
    discovery.canonicalTokenCount === canonicalAddresses.size &&
    discovery.matchedTokenCount <= discovery.canonicalEntryCount &&
    discovery.unobservedCanonicalEntryCount ===
      discovery.canonicalEntryCount - discovery.matchedTokenCount &&
    (discovery.status !== "complete" ||
      discovery.matchedTokenCount === discovery.canonicalEntryCount) &&
    (discovery.status !== "partial" ||
      (discovery.matchedTokenCount > 0 &&
       discovery.matchedTokenCount < discovery.canonicalEntryCount)) &&
    (discovery.status !== "unavailable" || discovery.matchedTokenCount === 0) &&
    timestampIsExact &&
    response.headers.get("x-programmable-discovery-provider") === "gmgn" &&
    response.headers.get("x-programmable-discovery-read-status") ===
      discovery.status &&
    response.headers.get("x-programmable-discovery-matched-count") ===
      String(discovery.matchedTokenCount) &&
    response.headers.get("x-programmable-discovery-matched-unique-count") ===
      String(discovery.matchedUniqueTokenCount) &&
    response.headers.get("x-programmable-discovery-ranking-commitment") ===
      discovery.rankingCommitment;
}

function stableTrendingDiscoveryMetadata(discovery) {
  return JSON.stringify(Object.fromEntries(
    DISCOVERY_KEYS
      .filter((key) => !TRENDING_DISCOVERY_VOLATILE_KEYS.has(key))
      .map((key) => [key, discovery[key]]),
  ));
}

async function readBoundTrendingSnapshot({
  request,
  canonicalTokens,
  catalogSnapshot,
  requireGmgnMarket,
  now,
}) {
  const totalPages = Math.ceil(canonicalTokens.length / TRENDING_EXPLORE_PAGE_SIZE);
  if (totalPages > TRENDING_EXPLORE_MAXIMUM_PAGES) {
    throw new Error("Trending catalog exceeds bounded smoke pagination");
  }
  let lastDrift = null;
  for (let attempt = 0; attempt < TRENDING_SNAPSHOT_ATTEMPTS; attempt += 1) {
    try {
      const tokens = [];
      let metadata = null;
      let stableMetadata = null;
      let commitment = null;
      let freshnessMs = null;
      for (let page = 1; page <= totalPages; page += 1) {
        const response = await request(
          `/api/explore?limit=${TRENDING_EXPLORE_PAGE_SIZE}&page=${page}&sort=trending`,
        );
        const pageTokens = Array.isArray(response.body?.tokens)
          ? response.body.tokens
          : [];
        const discovery = response.body?.discovery;
        const suffix = discovery?.status === "unavailable" ? "" : "+gmgn-discovery";
        const pageCatalog = exactCatalogSnapshot(response, {
          requireLaunchIdentity: true,
          readSourceSuffix: suffix,
        });
        if (
          response.status !== 200 || response.body?.status !== "ready" ||
          response.body?.sort !== "trending" ||
          response.body?.sortMetric !== "gmgn-trending" ||
          response.body?.ranking !== undefined ||
          response.body?.total !== canonicalTokens.length ||
          pageCatalog === null
        ) throw new Error("Trending discovery response contract is invalid");
        if (pageCatalog !== catalogSnapshot) {
          throw new ExploreCatalogBoundaryDriftError(
            "Explore catalog changed during Trending pagination",
          );
        }
        if (
          !exactExplorePage(response, pageTokens, {
            page,
            pageSize: TRENDING_EXPLORE_PAGE_SIZE,
          }) ||
          !exactVisibleMarketRead(response, pageTokens, now().getTime()) ||
          !exactTrendingDiscovery(response, canonicalTokens, now().getTime())
        ) throw new Error("Trending discovery response contract is invalid");
        const serialized = JSON.stringify(discovery);
        const stableSerialized = stableTrendingDiscoveryMetadata(discovery);
        const nextFreshnessMs = discovery.asOfTime === null
          ? null
          : Date.parse(discovery.asOfTime);
        if (metadata === null) {
          metadata = serialized;
          stableMetadata = stableSerialized;
          commitment = discovery.rankingCommitment;
          freshnessMs = nextFreshnessMs;
        } else if (discovery.rankingCommitment !== commitment) {
          throw new ExploreDiscoverySnapshotDriftError(
            "Trending discovery ranking identity changed during pagination",
          );
        } else if (stableSerialized !== stableMetadata) {
          throw new ExploreDiscoverySnapshotDriftError(
            "Trending discovery invariants changed during pagination",
          );
        } else if (
          (freshnessMs === null && nextFreshnessMs !== null) ||
          (freshnessMs !== null && (
            nextFreshnessMs === null || nextFreshnessMs < freshnessMs
          ))
        ) {
          throw new ExploreDiscoverySnapshotDriftError(
            "Trending discovery freshness regressed during pagination",
          );
        } else {
          metadata = serialized;
          freshnessMs = nextFreshnessMs;
        }
        tokens.push(...pageTokens);
      }
      const canonicalIds = canonicalTokens.map(exactIdentity);
      const trendingIds = tokens.map(exactIdentity);
      const canonicalIdSet = new Set(canonicalIds);
      if (
        tokens.length !== canonicalTokens.length ||
        trendingIds.some((identity) => identity === null) ||
        new Set(trendingIds).size !== trendingIds.length ||
        trendingIds.some((identity) => !canonicalIdSet.has(identity))
      ) throw new Error("Trending result is not the exact canonical set");
      const discovery = JSON.parse(metadata);
      const matchedCount = discovery.matchedTokenCount;
      const prefix = trendingIds.slice(0, matchedCount);
      const prefixSet = new Set(prefix);
      const stableTail = canonicalIds.filter((identity) => !prefixSet.has(identity));
      const matchedUniqueCanonicalAddresses = new Set(
        tokens.slice(0, matchedCount).flatMap((token) => {
          const address = canonicalMarketAddress(token?.tokenAddress);
          return address === null ? [] : [address];
        }),
      );
      if (
        prefix.some((identity) => !canonicalIdSet.has(identity)) ||
        JSON.stringify(trendingIds.slice(matchedCount)) !== JSON.stringify(stableTail) ||
        discovery.observedTokenCount !==
          matchedUniqueCanonicalAddresses.size + discovery.foreignTokenCount ||
        discovery.matchedUniqueTokenCount !==
          matchedUniqueCanonicalAddresses.size ||
        discovery.canonicalAddressCoverageBps !==
          (discovery.canonicalTokenCount === 0
            ? 0
            : Math.floor(
                matchedUniqueCanonicalAddresses.size * 10_000 /
                  discovery.canonicalTokenCount,
              ))
      ) throw new Error("Trending canonical prefix or stable tail is invalid");
      if (
        requireGmgnMarket &&
        (discovery.status === "unavailable" ||
          discovery.matchedTokenCount <= 0 ||
          discovery.snapshotCount <= 0 ||
          !currentProviderTimestamp(discovery.asOfTime, now().getTime()) ||
          discovery.applied !== "gmgn-ranked-with-launch-order-fallback")
      ) throw new Error("GMGN Trending discovery is required");
      return {
        consistency: "ranking-identity+monotonic-current-freshness",
        discovery,
        tokens,
      };
    } catch (error) {
      if (!(error instanceof ExploreDiscoverySnapshotDriftError)) throw error;
      lastDrift = error;
    }
  }
  throw new Error("Trending discovery snapshot drifted across both bounded attempts", {
    cause: lastDrift,
  });
}

const ANALYTICS_SECURITY_KEYS = [
  "averageTaxRatio", "bundlerTraderAmountRatio", "burnRatio", "burnStatus",
  "buyTaxRatio", "canSellCount", "cannotSellCount", "creatorBalanceRatio",
  "creatorTokenStatus", "developerTeamHoldRatio", "developerTokenBurnAmount",
  "developerTokenBurnRatio", "fetchedAt", "flags", "hideRisk", "highTaxRatio",
  "identity", "isBlacklisted", "isFreezeAccountRenounced", "isHoneypot",
  "isMintRenounced", "isOpenSource", "isOwnerRenounced", "isShowAlert",
  "isWashTrading", "lockSummary", "ratTraderAmountRatio", "rugRatio",
  "schemaVersion", "sellTaxRatio", "sniperCount", "source",
  "suspectedInsiderHoldRatio", "tokenAddress", "top10HolderRatio", // gitleaks:allow -- GMGN response field names, not credentials
].sort();
const ANALYTICS_POOL_KEYS = [
  "baseAddress", "baseReserve", "baseReserveValueUsd", "creationTimestamp",
  "currency", "exchange", "feeRatio", "fetchedAt", "identity",
  "initialBaseReserve", "initialLiquidityUsd", "initialQuoteReserve",
  "liquidityUsd", "marketScope", "poolAttribution", "priceUsd",
  "providerAddress", "quoteAddress", "quoteReserve", "quoteReserveValueUsd",
  "quoteSymbol", "schemaVersion", "source",
  "token0Address", "token1Address", "tokenAddress",
].sort();
const ANALYTICS_WALLET_KEYS = [
  "address", "amountRatio", "buyVolumeUsd", "profitRatio", "profitUsd",
  "sellVolumeUsd", "usdValue",
].sort();

function sameAnalyticsIdentity(value, expected) {
  return exactObjectKeys(value, [
    "chainId", "poolId", "protocol", "quoteAddress", "tokenAddress",
  ]) && value.chainId === "1" && value.protocol === "uniswap_v4" &&
    canonicalMarketAddress(value.tokenAddress) === value.tokenAddress &&
    value.tokenAddress === expected.tokenAddress &&
    canonicalMarketPool(value.poolId) === value.poolId &&
    value.poolId === expected.poolId &&
    canonicalMarketAddress(value.quoteAddress) === value.quoteAddress &&
    value.quoteAddress === expected.quoteAddress;
}

function acceptableAnalyticsIdentity(value, expected, status) {
  if (sameAnalyticsIdentity(value, expected)) return true;
  return status === "unavailable" && value === null;
}

function exactAnalyticsHeaders(
  response, status, section, launchSource, minimumLastIndexedAt,
) {
  const cache = response.headers.get("cache-control");
  const unavailable = status === "unavailable";
  const expectedCache = unavailable
    ? new Set(["no-store"])
    : section === "summary"
      ? new Set([
          "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
          "public, max-age=0",
        ])
      : new Set(["private, max-age=0, no-store"]);
  const lastIndexedAt = response.headers.get(
    "x-programmable-identity-last-indexed-at",
  );
  const canonicalReadStatus = response.headers.get(
    "x-programmable-canonical-read-status",
  );
  const routerReadStatus = response.headers.get(
    "x-programmable-router-read-status",
  );
  const launchSources = new Set(launchSource.split("+"));
  const operationalReadStatusesAreValid =
    (launchSources.has("envio-classic-v3")
      ? CATALOG_STATUSES.has(canonicalReadStatus)
      : canonicalReadStatus === "unavailable") &&
    (launchSources.has("canonical-launch-stamp-router")
      ? CATALOG_STATUSES.has(routerReadStatus)
      : routerReadStatus === "unavailable");
  return expectedCache.has(cache) &&
    response.headers.get("x-content-type-options") === "nosniff" &&
    response.headers.get("referrer-policy") === "no-referrer" &&
    response.headers.get("x-programmable-chain-id") === "1" &&
    response.headers.get("x-programmable-launch-source") === launchSource &&
    response.headers.get("x-programmable-read-source") === `${launchSource}+gmgn` &&
    exactIsoTimestamp(lastIndexedAt) &&
    exactIsoTimestamp(minimumLastIndexedAt) &&
    Date.parse(lastIndexedAt) >= Date.parse(minimumLastIndexedAt) &&
    operationalReadStatusesAreValid &&
    response.headers.get("x-programmable-analytics-provider") === "gmgn" &&
    response.headers.get("x-programmable-analytics-scope") === "token" &&
    response.headers.get("x-programmable-analytics-pool-attribution") ===
      "unavailable" &&
    response.headers.get("x-programmable-analytics-read-status") === status &&
    response.headers.get("x-programmable-market-provider") === "gmgn" &&
    response.headers.get("x-programmable-market-read-status") ===
      (status === "ready" ? "complete" : status) &&
    response.headers.get("x-programmable-data-quality") ===
      (status === "ready" ? "current" : status) &&
    response.headers.get("x-programmable-market-source") ===
      (unavailable ? null : "gmgn") &&
    response.headers.get("x-programmable-market-as-of") === null &&
    response.headers.get("x-programmable-price-source") === null &&
    response.headers.get("x-programmable-valuation-block") === null &&
    response.headers.get("set-cookie") === null &&
    response.headers.get("location") === null;
}

function finiteNullable(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function publicDecimal(value) {
  return typeof value === "string" && value.length <= 160 &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value);
}

function nullablePublicDecimal(value) {
  return value === null || publicDecimal(value);
}

function nullablePublicRatio(value) {
  return value === null ||
    (publicDecimal(value) && Number(value) >= 0 && Number(value) <= 1);
}

function publicRatio(value) {
  return publicDecimal(value) && Number(value) >= 0 && Number(value) <= 1;
}

function nullableBoolean(value) {
  return value === null || typeof value === "boolean";
}

function nullableUnsignedSafeInteger(value) {
  return value === null ||
    (Number.isSafeInteger(value) && value >= 0);
}

function exactPublicSecurityTypes(security) {
  const booleans = [
    "isShowAlert", "isOpenSource", "isBlacklisted", "isHoneypot",
    "isOwnerRenounced", "isMintRenounced", "isFreezeAccountRenounced",
    "isWashTrading", "hideRisk",
  ];
  const ratios = [
    "top10HolderRatio", "developerTeamHoldRatio", "creatorBalanceRatio",
    "suspectedInsiderHoldRatio", "rugRatio", "ratTraderAmountRatio",
    "bundlerTraderAmountRatio", "buyTaxRatio", "sellTaxRatio",
    "averageTaxRatio", "highTaxRatio", "burnRatio", "developerTokenBurnRatio",
  ];
  const counts = ["sniperCount", "canSellCount", "cannotSellCount"];
  return booleans.every((key) => nullableBoolean(security[key])) &&
    ratios.every((key) => nullablePublicRatio(security[key])) &&
    nullablePublicDecimal(security.developerTokenBurnAmount) &&
    ["burnStatus", "creatorTokenStatus"].every((key) =>
      security[key] === null ||
      (typeof security[key] === "string" && security[key].length <= 128)
    ) &&
    counts.every((key) => nullableUnsignedSafeInteger(security[key])) &&
    security.flags.every((flag) =>
      typeof flag === "string" && flag.length <= 128
    );
}

function exactSummaryAnalyticsProjection(body, identity, nowMs) {
  const security = body.analytics?.security;
  const pool = body.analytics?.pool;
  const count = Number(security !== null) + Number(pool !== null);
  const expectedCount = body.status === "ready"
    ? 2
    : body.status === "partial"
      ? 1
      : 0;
  return exactObjectKeys(body.analytics, ["pool", "security"]) &&
    count === expectedCount &&
    (security === null || (
      exactObjectKeys(security, ANALYTICS_SECURITY_KEYS) &&
      security.schemaVersion === "programmable.gmgn-token-security.v1" &&
      security.source === "gmgn" &&
      currentProviderTimestamp(security.fetchedAt, nowMs) &&
      canonicalMarketAddress(security.tokenAddress) === security.tokenAddress &&
      security.tokenAddress === identity.tokenAddress &&
      sameAnalyticsIdentity(security.identity, identity) &&
      Array.isArray(security.flags) && security.flags.length <= 64 &&
      exactPublicSecurityTypes(security) &&
      (security.lockSummary === null || (
        exactObjectKeys(security.lockSummary, [
          "details", "isLocked", "lockRatio", "remainingLockRatio",
        ]) && Array.isArray(security.lockSummary.details) &&
        typeof security.lockSummary.isLocked === "boolean" &&
        publicRatio(security.lockSummary.lockRatio) &&
        publicRatio(security.lockSummary.remainingLockRatio) &&
        security.lockSummary.details.length <= 256 &&
        security.lockSummary.details.every((detail) =>
          exactObjectKeys(detail, ["isBlackhole", "poolAddress", "ratio"]) &&
          typeof detail.isBlackhole === "boolean" &&
          canonicalMarketAddress(detail.poolAddress) === detail.poolAddress &&
          publicRatio(detail.ratio)
        )
      ))
    )) &&
    (pool === null || (
      exactObjectKeys(pool, ANALYTICS_POOL_KEYS) &&
      pool.schemaVersion === "programmable.gmgn-token-pool-info.v1" &&
      pool.source === "gmgn" && pool.currency === "USD" &&
      pool.marketScope === "token" &&
      pool.poolAttribution === "unavailable" &&
      currentProviderTimestamp(pool.fetchedAt, nowMs) &&
      sameAnalyticsIdentity(pool.identity, identity) &&
      canonicalMarketAddress(pool.tokenAddress) === pool.tokenAddress &&
      pool.tokenAddress === identity.tokenAddress &&
      canonicalMarketAddress(pool.providerAddress) === pool.providerAddress &&
      pool.providerAddress === identity.tokenAddress &&
      canonicalMarketAddress(pool.baseAddress) === pool.baseAddress &&
      pool.baseAddress === identity.tokenAddress &&
      canonicalMarketAddress(pool.quoteAddress) === pool.quoteAddress &&
      pool.quoteAddress === identity.quoteAddress &&
      pool.exchange === "uniswap_v4" &&
      [pool.token0Address, pool.token1Address].every((value) =>
        canonicalMarketAddress(value) === value
      ) &&
      new Set([pool.token0Address, pool.token1Address]).size === 2 &&
      [pool.token0Address, pool.token1Address].includes(identity.tokenAddress) &&
      [pool.token0Address, pool.token1Address].includes(identity.quoteAddress) &&
      [pool.liquidityUsd, pool.baseReserve, pool.quoteReserve].every(publicDecimal) &&
      [
        pool.baseReserveValueUsd, pool.quoteReserveValueUsd,
        pool.initialLiquidityUsd, pool.initialBaseReserve,
        pool.initialQuoteReserve, pool.priceUsd,
      ].every(nullablePublicDecimal) &&
      nullablePublicRatio(pool.feeRatio) &&
      Number.isSafeInteger(pool.creationTimestamp) &&
      pool.creationTimestamp >= 0 &&
      (pool.quoteSymbol === null ||
        (typeof pool.quoteSymbol === "string" && pool.quoteSymbol.length <= 64))
    ));
}

function exactRankingAnalyticsProjection(body, nowMs) {
  if (!exactObjectKeys(body.analytics, ["ranking"])) return false;
  const ranking = body.analytics.ranking;
  if (body.status === "unavailable") return ranking === null;
  if (body.status !== "ready") return false;
  return exactObjectKeys(ranking, ["fetchedAt", "wallets"]) &&
    currentProviderTimestamp(ranking.fetchedAt, nowMs) &&
    Array.isArray(ranking.wallets) && ranking.wallets.length <= 20 &&
    ranking.wallets.every((wallet) =>
      exactObjectKeys(wallet, ANALYTICS_WALLET_KEYS) &&
      canonicalMarketAddress(wallet.address) === wallet.address &&
      Object.entries(wallet).every(([key, value]) =>
        key === "address" || finiteNullable(value)
      )
    );
}

async function readRequiredGmgnAnalytics({
  request, tokenAddress, identity, catalogBoundary, lastIndexedAt,
  waitForGmgnAnalyticsRecovery, now,
}) {
  const reads = {};
  let minimumAnalyticsLastIndexedAt = lastIndexedAt;
  for (const section of ["summary", "holders", "traders"]) {
    const suffix = section === "summary" ? "" : "&limit=20";
    let body = null;
    for (let attempt = 0; attempt < GMGN_ANALYTICS_ATTEMPTS; attempt += 1) {
      const response = await request(
        `/api/explore/token/analytics?chain=1&address=${encodeURIComponent(tokenAddress)}` +
          `&section=${section}${suffix}`,
      );
      body = response.body;
      if (
        response.status !== 200 ||
        !exactObjectKeys(body, [
          "analytics", "analyticsScope", "identity", "poolAttribution",
          "provider", "schemaVersion", "section", "status",
        ]) ||
        body.schemaVersion !== "programmable.token-analytics.v1" ||
        body.provider !== "gmgn" || body.analyticsScope !== "token" ||
        body.poolAttribution !== "unavailable" || body.section !== section ||
        !ANALYTICS_STATUSES.has(body.status) ||
        !acceptableAnalyticsIdentity(body.identity, identity, body.status) ||
        !exactAnalyticsHeaders(
          response, body.status, section, catalogBoundary.launchSource,
          minimumAnalyticsLastIndexedAt,
        )
      ) throw new Error(`GMGN ${section} analytics envelope is invalid`);
      minimumAnalyticsLastIndexedAt = response.headers.get(
        "x-programmable-identity-last-indexed-at",
      );
      if (section === "summary") {
        if (!exactSummaryAnalyticsProjection(body, identity, now().getTime())) {
          throw new Error("GMGN summary analytics projection is invalid");
        }
      } else if (!exactRankingAnalyticsProjection(body, now().getTime())) {
        throw new Error(`GMGN ${section} ranking projection is invalid`);
      }
      if (body.status === "ready") break;
      if (attempt === GMGN_ANALYTICS_ATTEMPTS - 1) {
        throw new Error(`GMGN ${section} analytics is required`);
      }
      const recoveryDelayMs = section === "summary" && body.status === "partial"
        ? GMGN_ANALYTICS_PARTIAL_SUMMARY_RECOVERY_DELAY_MS
        : GMGN_ANALYTICS_RECOVERY_DELAY_MS;
      await waitForGmgnAnalyticsRecovery(recoveryDelayMs);
    }
    if (body === null || body.status !== "ready") {
      throw new Error(`GMGN ${section} analytics retry contract is unreachable`);
    }

    reads[section] = body.status;
  }
  return reads;
}

export async function runStagedStaticDexscreenerSmokeV1(input = {}) {
  const environment = input.environment ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const appendOutput = input.appendOutput ?? appendFileSync;
  const waitForCatalogConvergence = input.waitForCatalogConvergence ?? sleep;
  const waitForStagedRetryAfter = input.waitForStagedRetryAfter ?? sleep;
  const waitForGmgnAnalyticsRecovery =
    input.waitForGmgnAnalyticsRecovery ?? sleep;
  const now = input.now ?? (() => new Date());
  if (typeof waitForCatalogConvergence !== "function") {
    throw new Error("Explore catalog convergence wait is invalid");
  }
  if (typeof waitForStagedRetryAfter !== "function") {
    throw new Error("Public API staged Retry-After wait is invalid");
  }
  if (typeof waitForGmgnAnalyticsRecovery !== "function") {
    throw new Error("GMGN analytics recovery wait is invalid");
  }
  if (typeof now !== "function" || !Number.isFinite(now().getTime())) {
    throw new Error("Public API smoke clock is invalid");
  }
  const targetKind = input.targetKind ?? "staged";
  if (targetKind !== "staged" && targetKind !== "production") {
    throw new Error("Public API smoke target kind is invalid");
  }
  const target = exactOrigin(environment.STAGED_TARGET_URL, targetKind);
  const bypass = (environment.VERCEL_AUTOMATION_BYPASS_SECRET ?? "").trim();
  if (targetKind === "staged" && bypass.length < 16) {
    throw new Error("Public API smoke automation bypass is unavailable");
  }
  const headers = targetKind === "staged"
    ? {
        "x-vercel-protection-bypass": bypass,
        "x-vercel-set-bypass-cookie": "false",
      }
    : {};
  const request = (path, acceptedStatuses) =>
    requestJson(
      target,
      headers,
      path,
      fetchImpl,
      acceptedStatuses,
      targetKind === "staged" ? waitForStagedRetryAfter : null,
    );
  const gmgnMarketRequirement =
    environment.PROGRAMMABLE_REQUIRE_GMGN_MARKET;
  if (
    gmgnMarketRequirement !== undefined &&
    !["true", "false"].includes(gmgnMarketRequirement)
  ) throw new Error("GMGN market requirement is invalid");
  const requireGmgnMarket = gmgnMarketRequirement === "true";
  const requireShardRouterTrade =
    environment.PROGRAMMABLE_REQUIRE_SHARD_ROUTER_TRADE === "true";

  const health = await request("/api/ops/health");
  if (!exactInformationalHealth(health)) {
    throw new Error("Informational health response is malformed");
  }
  const gmgnRequestsPerSecond = health.body.providers[0].requestsPerSecond;
  const gmgnAccountGateMode = health.body.providers[0].accountGateMode;
  if (
    requireGmgnMarket &&
    (gmgnRequestsPerSecond !== 20 || gmgnAccountGateMode !== "multiflight-v1")
  ) {
    throw new Error(
      "Required GMGN Production throughput lacks exact RPS 20 multiflight-v1 proof",
    );
  }

  let exploreSnapshot = null;
  for (
    let snapshotAttempt = 0;
    snapshotAttempt < EXPLORE_SNAPSHOT_ATTEMPTS;
    snapshotAttempt += 1
  ) {
    try {
      const highest = await request(
        `/api/explore?limit=${VISIBLE_EXPLORE_PAGE_SIZE}&page=1&sort=market-cap`,
      );
      const newest = await request(
        `/api/explore?limit=${VISIBLE_EXPLORE_PAGE_SIZE}&page=1&sort=newest`,
      );
      const highestTokens = Array.isArray(highest.body?.tokens)
        ? highest.body.tokens
        : [];
      const newestTokens = Array.isArray(newest.body?.tokens)
        ? newest.body.tokens
        : [];
      const validationNowMs = now().getTime();
      const highestReadSourceSuffix = marketCapReadSourceSuffix(highest);
      if (
        highest.status !== 200 ||
        highest.body?.status !== "ready" ||
        highest.body?.sort !== "market-cap" ||
        highest.body?.sortMetric !==
          "gmgn-market-cap+gmgn-token-info-fdv+dexscreener-fdv-fallback" ||
        highestTokens.length < 1 ||
        !exactExplorePage(highest, highestTokens, {
          page: 1,
          pageSize: VISIBLE_EXPLORE_PAGE_SIZE,
        }) ||
        exactCatalogSnapshot(highest, {
          requireLaunchIdentity: true,
          readSourceSuffix: highestReadSourceSuffix,
        }) === null ||
        !exactVisibleMarketRead(highest, highestTokens, validationNowMs)
      ) throw new Error("Highest market-cap response contract is invalid");
      if (
        newest.status !== 200 ||
        newest.body?.status !== "ready" ||
        newest.body?.sort !== "newest" ||
        newest.body?.ranking !== undefined ||
        newestTokens.length < 1 ||
        !exactExplorePage(newest, newestTokens, {
          page: 1,
          pageSize: VISIBLE_EXPLORE_PAGE_SIZE,
        }) ||
        exactCatalogSnapshot(newest) === null ||
        !exactVisibleMarketRead(newest, newestTokens, validationNowMs)
      ) throw new Error("Newest launches response contract is invalid");
      const highestCatalog = exactCatalogSnapshot(highest, {
        requireLaunchIdentity: true,
        readSourceSuffix: highestReadSourceSuffix,
      });
      const newestCatalog = exactCatalogSnapshot(newest);
      if (highestCatalog === null || highestCatalog !== newestCatalog) {
        throw new ExploreCatalogBoundaryDriftError(
          "Explore catalog changed between ranking reads",
        );
      }
      const completeCatalogTokens = [...newestTokens];
      if (newest.body.total > newestTokens.length) {
        const catalogPageSize = 100;
        const catalogTotalPages = Math.ceil(
          newest.body.total / catalogPageSize,
        );
        if (catalogTotalPages > 100) {
          throw new Error("Explore catalog exceeds bounded smoke pagination");
        }
        completeCatalogTokens.length = 0;
        for (let page = 1; page <= catalogTotalPages; page += 1) {
          const catalogPage = await request(
            `/api/explore?limit=${catalogPageSize}&page=${page}&sort=newest`,
          );
          const pageTokens = Array.isArray(catalogPage.body?.tokens)
            ? catalogPage.body.tokens
            : [];
          const pageCatalog = exactCatalogSnapshot(catalogPage);
          if (
            catalogPage.status !== 200 ||
            catalogPage.body?.status !== "ready" ||
            catalogPage.body?.sort !== "newest" ||
            catalogPage.body?.ranking !== undefined ||
            pageCatalog === null
          ) throw new Error("Explore catalog pagination contract is invalid");
          if (pageCatalog !== newestCatalog) {
            throw new ExploreCatalogBoundaryDriftError(
              "Explore catalog changed during pagination",
            );
          }
          if (
            !exactExplorePage(catalogPage, pageTokens, {
              page,
              pageSize: catalogPageSize,
            }) ||
            !exactVisibleMarketRead(
              catalogPage,
              pageTokens,
              now().getTime(),
            )
          ) throw new Error("Explore catalog pagination contract is invalid");
          completeCatalogTokens.push(...pageTokens);
        }
      }
      if (
        completeCatalogTokens.length !== newest.body.total ||
        !exactMarketCapRanking(
          highest,
          completeCatalogTokens,
          "desc",
          now().getTime(),
        )
      ) throw new Error("Highest market-cap ranking contract is invalid");
      if (
        requireGmgnMarket &&
        !exactRequiredGmgnMarketCapRanking(highest, now().getTime())
      ) {
        throw new Error(
          "GMGN descending market-cap canonical qualification is required",
        );
      }
      const identities = completeCatalogTokens.map(exactIdentity);
      if (
        identities.some((identity) => identity === null) ||
        new Set(identities).size !== identities.length
      ) throw new Error("Explore identity set is malformed or duplicated");
      const catalogBoundary = JSON.parse(highestCatalog);
      const classicV4IdentityCount = completeCatalogTokens.filter(
        (token) =>
          token?.exploreKind === "token" &&
          token.launchModel === "classic" &&
          token.launchModelVersion === "classic-v4",
      ).length;
      if (
        catalogBoundary.classicV4Bound !== (classicV4IdentityCount > 0)
      ) {
        throw new Error(
          "Classic V4 identities are not bound to the exact catalog release",
        );
      }
      const initialNewestIdentities = newestTokens.map(exactIdentity);
      if (
        initialNewestIdentities.some((identity) => identity === null) ||
        initialNewestIdentities.some((identity, index) =>
          identity !== identities[index]
        )
      ) throw new Error("Initial Newest page is outside the paged catalog");
      const completeIdentitySet = new Set(identities);
      const highestIdentities = highestTokens.map(exactIdentity);
      if (
        highestIdentities.some((identity) => identity === null) ||
        new Set(highestIdentities).size !== highestIdentities.length ||
        highestIdentities.some((identity) => !completeIdentitySet.has(identity))
      ) throw new Error("Highest market-cap page is outside the paged catalog");
      if (highest.body.totalPages > 1) {
        const highestSecondPage = await request(
          `/api/explore?limit=${VISIBLE_EXPLORE_PAGE_SIZE}` +
            "&page=2&sort=market-cap" +
            `&rankingCommitment=${encodeURIComponent(
              highest.body.ranking.rankingCommitment,
            )}`,
        );
        const highestSecondPageTokens = Array.isArray(
          highestSecondPage.body?.tokens,
        ) ? highestSecondPage.body.tokens : [];
        const highestSecondPageCatalog = exactCatalogSnapshot(
          highestSecondPage,
          {
            requireLaunchIdentity: true,
            readSourceSuffix: marketCapReadSourceSuffix(highestSecondPage),
          },
        );
        const secondPageIdentities = highestSecondPageTokens.map(exactIdentity);
        if (
          highestSecondPage.status !== 200 ||
          highestSecondPage.body?.status !== "ready" ||
          highestSecondPage.body?.sort !== "market-cap" ||
          highestSecondPage.body?.sortMetric !==
            "gmgn-market-cap+gmgn-token-info-fdv+dexscreener-fdv-fallback" ||
          highestSecondPageCatalog === null
        ) throw new Error("Market-cap pagination commitment is invalid");
        if (highestSecondPageCatalog !== highestCatalog) {
          throw new ExploreCatalogBoundaryDriftError(
            "Explore catalog changed during market-cap pagination",
          );
        }
        if (
          !exactExplorePage(highestSecondPage, highestSecondPageTokens, {
            page: 2,
            pageSize: VISIBLE_EXPLORE_PAGE_SIZE,
          }) ||
          !exactVisibleMarketRead(
            highestSecondPage,
            highestSecondPageTokens,
            now().getTime(),
          ) ||
          !exactMarketCapRanking(
            highestSecondPage,
            completeCatalogTokens,
            "desc",
            now().getTime(),
          ) ||
          secondPageIdentities.some((identity) => identity === null) ||
          new Set(secondPageIdentities).size !== secondPageIdentities.length ||
          secondPageIdentities.some((identity) =>
            !completeIdentitySet.has(identity)
          )
        ) throw new Error("Market-cap pagination commitment is invalid");
        if (
          highestSecondPage.body.ranking.rankingCommitment !==
            highest.body.ranking.rankingCommitment
        ) {
          throw new ExploreMarketCapSnapshotDriftError(
            "Market-cap ranking changed during pagination",
          );
        }
        if (
          stableMarketCapRankingMetadata(highestSecondPage.body.ranking) !==
            stableMarketCapRankingMetadata(highest.body.ranking)
        ) {
          throw new ExploreMarketCapSnapshotDriftError(
            "Market-cap ranking invariants changed during pagination",
          );
        }
        if (
          secondPageIdentities.some((identity) =>
            highestIdentities.includes(identity)
          )
        ) {
          throw new ExploreMarketCapSnapshotDriftError(
            "Market-cap ranking order overlapped during pagination",
          );
        }
      }
      const lowest = await request(
        `/api/explore?limit=${VISIBLE_EXPLORE_PAGE_SIZE}` +
          "&page=1&sort=market-cap-asc",
      );
      const lowestTokens = Array.isArray(lowest.body?.tokens)
        ? lowest.body.tokens
        : [];
      const lowestCatalog = exactCatalogSnapshot(lowest, {
        requireLaunchIdentity: true,
        readSourceSuffix: marketCapReadSourceSuffix(lowest),
      });
      const lowestIdentities = lowestTokens.map(exactIdentity);
      if (
        lowest.status !== 200 ||
        lowest.body?.status !== "ready" ||
        lowest.body?.sort !== "market-cap-asc" ||
        lowest.body?.sortMetric !==
          "gmgn-market-cap+gmgn-token-info-fdv+dexscreener-fdv-fallback" ||
        lowestCatalog === null
      ) throw new Error("Lowest market-cap ranking contract is invalid");
      if (lowestCatalog !== highestCatalog) {
        throw new ExploreCatalogBoundaryDriftError(
          "Explore catalog changed before ascending market-cap read",
        );
      }
      if (
        !exactExplorePage(lowest, lowestTokens, {
          page: 1,
          pageSize: VISIBLE_EXPLORE_PAGE_SIZE,
        }) ||
        !exactVisibleMarketRead(lowest, lowestTokens, now().getTime()) ||
        !exactMarketCapRanking(
          lowest,
          completeCatalogTokens,
          "asc",
          now().getTime(),
        ) ||
        lowestIdentities.some((identity) => identity === null) ||
        new Set(lowestIdentities).size !== lowestIdentities.length ||
        lowestIdentities.some((identity) => !completeIdentitySet.has(identity)) ||
        lowest.body.ranking.rankingCommitment ===
          highest.body.ranking.rankingCommitment
      ) throw new Error("Lowest market-cap ranking contract is invalid");
      if (
        requireGmgnMarket &&
        !exactRequiredGmgnMarketCapLiveness(
          lowest,
          "asc",
          now().getTime(),
        )
      ) {
        throw new Error(
          "GMGN ascending market-cap canonical qualification is required",
        );
      }
      for (let index = 1; index < completeCatalogTokens.length; index += 1) {
        if (
          Date.parse(completeCatalogTokens[index - 1].launchedAt) <
            Date.parse(completeCatalogTokens[index].launchedAt)
        ) throw new Error("Newest launches are not ordered descending");
      }
      if (
        highest.body.ranking.status === "unavailable" &&
        !exactSamePageOrder(highest, newest)
      ) throw new Error("Unavailable market-cap ranking did not preserve launch order");
      if (
        lowest.body.ranking.status === "unavailable" &&
        !exactSamePageOrder(lowest, newest)
      ) throw new Error("Unavailable ascending market-cap ranking did not preserve launch order");

      const trendingSnapshot = await readBoundTrendingSnapshot({
        request,
        canonicalTokens: completeCatalogTokens,
        catalogSnapshot: highestCatalog,
        requireGmgnMarket,
        now,
      });
      const searchSnapshot = await readBoundSearchSnapshot({
        request,
        canonicalTokens: completeCatalogTokens,
        catalogSnapshot: highestCatalog,
        requireGmgnMarket,
        now,
      });

      const readValidatedTokenDetail = async (selectedToken) => {
        const tokenAddress = selectedToken?.tokenAddress;
        if (!tokenAddress || !selectedToken) {
          throw new Error("Explore returned no token identity");
        }
        const detail = await request(
          "/api/explore/token?address=" + encodeURIComponent(tokenAddress),
        );
        const detailToken = detail.body?.token ?? detail.body?.customProject;
        const detailCatalog = exactCatalogSnapshot(
          { ...detail, body: {
            ...detail.body,
            total: detail.body?.catalog?.identityCount,
          } },
          { requireLaunchIdentity: false },
        );
        if (detailCatalog === null) {
          throw new Error("Token detail identity or market contract is invalid");
        }
        if (detailCatalog !== highestCatalog) {
          throw new ExploreCatalogBoundaryDriftError(
            "Explore catalog changed before token detail read",
          );
        }
        if (
          detail.status !== 200 ||
          detail.body?.status !== "ready" ||
          exactIdentity(detailToken) !== exactIdentity(selectedToken) ||
          !exactDetailMarketRead(
            detail,
            detailToken,
            catalogBoundary.launchSource,
            now().getTime(),
          )
        ) throw new Error("Token detail identity or market contract is invalid");
        return { detail, detailToken, selectedToken, tokenAddress };
      };
      const exactGmgnDetailProof = (candidate) =>
        candidate.detail.headers.get("x-programmable-market-provider") ===
          "gmgn" &&
        candidate.detail.headers.get("x-programmable-market-read-status") ===
          "complete" &&
        qualifiedGmgnFdv(candidate.detailToken, now().getTime());

      let selectedDetail = null;
      if (requireGmgnMarket) {
        const attemptedDetailIdentities = new Set();
        const tryDetailCandidate = async (candidate) => {
          const identity = exactIdentity(candidate);
          if (
            identity === null ||
            attemptedDetailIdentities.has(identity) ||
            !completeIdentitySet.has(identity) ||
            candidate?.exploreKind !== "token" ||
            candidate.launchModel !== "classic" ||
            !exactGmgnEligibleCanonicalToken(candidate)
          ) return null;
          attemptedDetailIdentities.add(identity);
          const detailCandidate = await readValidatedTokenDetail(candidate);
          return exactGmgnDetailProof(detailCandidate) ? detailCandidate : null;
        };

        // The already-bound GMGN market-cap plus token_info prefix is the
        // strongest bounded candidate set. Rank entries passed the fresh
        // market-cap/liquidity gate and hydrated entries independently passed
        // the canonical token_info FDV/liquidity gate.
        const marketCapCandidates = highestTokens.slice(
          0,
          Math.min(
            highest.body.ranking.matchedTokenCount +
              highest.body.ranking.gmgnHydrationQualifiedCount,
            highestTokens.length,
          ),
        ).filter(exactGmgnEligibleCanonicalToken);
        for (const candidate of marketCapCandidates) {
          selectedDetail = await tryDetailCandidate(candidate);
          if (selectedDetail !== null) break;
        }

        let sawQualifiedGmgnListCandidate = false;
        if (selectedDetail === null) {
          const completeClassicTokens = completeCatalogTokens.filter((token) =>
            token?.exploreKind === "token" && token.launchModel === "classic"
          );
          const classicTotalPages = Math.ceil(
            completeClassicTokens.length / VISIBLE_EXPLORE_PAGE_SIZE,
          );
          const scanPages = Math.min(
            classicTotalPages,
            GMGN_CANONICAL_SCAN_MAXIMUM_PAGES,
          );
          for (let page = 1; page <= scanPages; page += 1) {
            const gmgnCanonical = await request(
              `/api/explore?limit=${VISIBLE_EXPLORE_PAGE_SIZE}` +
                `&page=${page}&sort=newest&model=classic`,
            );
            const gmgnCanonicalTokens = Array.isArray(
              gmgnCanonical.body?.tokens,
            ) ? gmgnCanonical.body.tokens : [];
            const gmgnCanonicalCatalog = exactCatalogSnapshot(
              { ...gmgnCanonical, body: {
                ...gmgnCanonical.body,
                total: gmgnCanonical.body?.catalog?.identityCount,
              } },
            );
            const expectedIdentities = completeClassicTokens.slice(
              (page - 1) * VISIBLE_EXPLORE_PAGE_SIZE,
              page * VISIBLE_EXPLORE_PAGE_SIZE,
            ).map(exactIdentity);
            const actualIdentities = gmgnCanonicalTokens.map(exactIdentity);
            if (
              gmgnCanonical.status !== 200 ||
              gmgnCanonical.body?.status !== "ready" ||
              gmgnCanonical.body?.sort !== "newest" ||
              gmgnCanonical.body?.ranking !== undefined ||
              gmgnCanonical.body?.total !== completeClassicTokens.length ||
              gmgnCanonicalCatalog === null
            ) {
              throw new Error("Canonical GMGN list response contract is invalid");
            }
            if (gmgnCanonicalCatalog !== highestCatalog) {
              throw new ExploreCatalogBoundaryDriftError(
                "Explore catalog changed during canonical GMGN pagination",
              );
            }
            if (
              !exactExplorePage(gmgnCanonical, gmgnCanonicalTokens, {
                page,
                pageSize: VISIBLE_EXPLORE_PAGE_SIZE,
              }) ||
              !exactVisibleMarketRead(
                gmgnCanonical,
                gmgnCanonicalTokens,
                now().getTime(),
              ) ||
              gmgnCanonicalTokens.some((token) =>
                token?.exploreKind !== "token" || token.launchModel !== "classic"
              ) ||
              actualIdentities.some((identity) => identity === null) ||
              actualIdentities.some((identity, index) =>
                identity !== expectedIdentities[index]
              )
            ) {
              throw new Error("Canonical GMGN list response contract is invalid");
            }
            const qualifiedCandidates = gmgnCanonicalTokens.filter((token) =>
              exactGmgnEligibleCanonicalToken(token) &&
              qualifiedGmgnFdv(token, now().getTime())
            );
            if (qualifiedCandidates.length > 0) {
              sawQualifiedGmgnListCandidate = true;
            }
            for (const candidate of qualifiedCandidates) {
              selectedDetail = await tryDetailCandidate(candidate);
              if (selectedDetail !== null) break;
            }
            if (selectedDetail !== null) break;
          }
        }
        if (selectedDetail === null) {
          if (sawQualifiedGmgnListCandidate) {
            throw new Error("Token detail GMGN market contract is required");
          }
          throw new Error("Explore returned no GMGN-qualified canonical token");
        }
      } else {
        const selectedToken =
          completeCatalogTokens.find(exactGmgnEligibleCanonicalToken) ??
          completeCatalogTokens.find((token) => token?.exploreKind === "token");
        selectedDetail = await readValidatedTokenDetail(selectedToken);
      }

      const { detail, detailToken, tokenAddress } = selectedDetail;
      const detailMarketProvider = detail.headers.get(
        "x-programmable-market-provider",
      );
      const detailStatus = qualifiedGmgnFdv(detailToken, now().getTime())
        ? "verified-gmgn-market"
        : qualifiedDexscreenerFdv(detailToken, now().getTime())
          ? "verified-dexscreener-market"
          : "verified-identity-market-unavailable";
      const chartIdentities = entryMarketIdentities(detailToken);
      if (chartIdentities.length !== 1) {
        throw new Error("Token detail has no unique chart market identity");
      }
      const chartIdentity = chartIdentities[0];
      const chartCanonicalSupply = {
        totalSupplyRaw: detailToken?.totalSupplyRaw,
        tokenDecimals: detailToken?.tokenDecimals,
      };
      let shardTradeStatus = "not-required";
      if (requireShardRouterTrade) {
        const shardDetail = await request(
          "/api/explore/token?address=" +
            encodeURIComponent(SHARD_TOKEN_ADDRESS),
        );
        const shardCatalog = exactCatalogSnapshot(
          { ...shardDetail, body: {
            ...shardDetail.body,
            total: shardDetail.body?.catalog?.identityCount,
          } },
          { requireLaunchIdentity: false },
        );
        if (shardCatalog === null) {
          throw new Error("SHARD trade detail catalog is invalid");
        }
        if (shardCatalog !== highestCatalog) {
          throw new ExploreCatalogBoundaryDriftError(
            "Explore catalog changed before SHARD trade detail read",
          );
        }
        if (!exactShardRouterTradeDetail(shardDetail)) {
          throw new Error("SHARD Router trade project is unavailable or invalid");
        }
        shardTradeStatus = "verified";
      }

      exploreSnapshot = {
        catalogBoundary,
        chartCanonicalSupply,
        chartIdentity,
        detailMarketProvider,
        detailStatus,
        highest,
        marketCapAscRanking: lowest.body.ranking,
        marketCapDescRanking: highest.body.ranking,
        marketProvider: newest.headers.get("x-programmable-market-provider"),
        marketReadStatus: newest.body.marketRead.status,
        newestTokens,
        searchRanking: searchSnapshot.search,
        shardTradeStatus,
        tokenAddress,
        trendingDiscoveryConsistency: trendingSnapshot.consistency,
        trendingDiscovery: trendingSnapshot.discovery,
      };
      break;
    } catch (error) {
      if (
        !(error instanceof ExploreCatalogBoundaryDriftError) &&
        !(error instanceof ExploreMarketCapSnapshotDriftError)
      ) throw error;
      if (snapshotAttempt === EXPLORE_SNAPSHOT_ATTEMPTS - 1) {
        throw new Error(
          `${error.message} after ${EXPLORE_SNAPSHOT_ATTEMPTS} bounded attempts`,
          { cause: error },
        );
      }
      await waitForCatalogConvergence(EXPLORE_SNAPSHOT_RETRY_DELAY_MS);
    }
  }
  if (exploreSnapshot === null) {
    throw new Error("Explore snapshot retry contract is unreachable");
  }
  const {
    catalogBoundary,
    chartCanonicalSupply,
    chartIdentity,
    detailMarketProvider,
    detailStatus,
    highest,
    marketCapAscRanking,
    marketCapDescRanking,
    marketProvider,
    marketReadStatus,
    newestTokens,
    searchRanking,
    shardTradeStatus,
    tokenAddress,
    trendingDiscoveryConsistency,
    trendingDiscovery,
  } = exploreSnapshot;

  let analyticsSummaryStatus = "not-required";
  let analyticsHoldersStatus = "not-required";
  let analyticsTradersStatus = "not-required";
  if (requireGmgnMarket) {
    const analytics = await readRequiredGmgnAnalytics({
      request,
      tokenAddress,
      identity: chartIdentity,
      catalogBoundary,
      lastIndexedAt: highest.body.catalog.lastIndexedAt,
      waitForGmgnAnalyticsRecovery,
      now,
    });
    analyticsSummaryStatus = analytics.summary;
    analyticsHoldersStatus = analytics.holders;
    analyticsTradersStatus = analytics.traders;
  }

  const profileToken = newestTokens.find((token) =>
    ADDRESS.test(String(token?.creatorAddress ?? "").toLowerCase())
  );
  if (!profileToken) throw new Error("Explore returned no creator identity");
  const profileAccount = profileToken.creatorAddress;
  const profile = await request(
    "/api/explore/profile?account=" + encodeURIComponent(profileAccount),
    new Set([200, 503]),
  );
  const profileRpcProvider = profile.headers.get(
    "x-programmable-rpc-provider",
  );
  const profileRouterReadStatus = profile.headers.get(
    "x-programmable-router-read-status",
  );
  const profileRpcProviderReady =
    profileRpcProvider === "drpc-primary" ||
    profileRpcProvider === "quicknode-secondary";
  const profileRouterReadReady =
    profileRouterReadStatus === "current" ||
    profileRouterReadStatus === "last-known-good";
  const profileSourceReady =
    (
      profile.headers.get("x-programmable-launch-source") === "rpc" &&
      profile.headers.get("x-programmable-read-source") === "rpc" &&
      profileRpcProviderReady
    ) ||
    (
      profile.headers.get("x-programmable-launch-source") ===
        "envio-classic-v3" &&
      profile.headers.get("x-programmable-read-source") ===
        "envio-classic-v3" &&
      profileRpcProvider === "envio-indexer-state"
    ) ||
    (
      profile.headers.get("x-programmable-launch-source") ===
        "envio-classic-v3+canonical-launch-stamp-router" &&
      profile.headers.get("x-programmable-read-source") ===
        "envio-classic-v3+canonical-launch-stamp-router" &&
      profileRpcProvider === "envio-indexer-state" &&
      profileRouterReadReady
    ) ||
    (
      profile.headers.get("x-programmable-launch-source") ===
        "envio-classic-v3+canonical-launch-stamp-router" &&
      profile.headers.get("x-programmable-read-source") ===
        "envio-classic-v3+canonical-launch-stamp-router+rpc" &&
      profileRpcProviderReady &&
      profileRouterReadReady
    ) ||
    (
      profile.headers.get("x-programmable-launch-source") ===
        "envio-classic-v3" &&
      profile.headers.get("x-programmable-read-source") ===
        "envio-classic-v3+rpc" &&
      profileRpcProviderReady
    );
  const profileReady =
    profile.status === 200 &&
    profile.body?.status === "ready" &&
    profile.body?.account?.toLowerCase() === profileAccount.toLowerCase() &&
    Array.isArray(profile.body?.tokens) &&
    Array.isArray(profile.body?.pools) &&
    Array.isArray(profile.body?.claims) &&
    /^(?:0|[1-9][0-9]*)$/u.test(
      String(profile.body?.totals?.claimableWei ?? ""),
    ) &&
    profileSourceReady;
  const profileFailClosed =
    profile.status === 503 &&
    exactObjectKeys(profile.body, ["error", "status"]) &&
    exactObjectKeys(profile.body?.error, ["code", "kind", "message"]) &&
    profile.body?.status === "error" &&
    profile.body?.error?.kind === "temporary" &&
    profile.body?.error?.code === "creator_profile_temporarily_unavailable" &&
    profile.body?.error?.message ===
      "Onchain creator data is temporarily unavailable" &&
    profile.headers.get("cache-control") === "no-store" &&
    profile.headers.get("x-programmable-launch-source") === null &&
    profile.headers.get("x-programmable-read-source") === null &&
    profile.headers.get("x-programmable-rpc-provider") === null;
  if (!profileReady && !profileFailClosed) {
    throw new Error("Creator profile response is neither ready nor fail-closed");
  }
  const profileStatus = profileReady ? "ready" : "fail-closed-unavailable";

  const githubOutput = environment.GITHUB_OUTPUT;
  if (targetKind === "staged" && !githubOutput) {
    throw new Error("GitHub output path is unavailable");
  }
  const chart = await request(
    "/api/explore/token/chart?address=" + encodeURIComponent(tokenAddress) +
      "&range=1d",
  );
  const chartHasHistory = Array.isArray(chart.body?.points) &&
    chart.body.points.length > 0;
  const chartProvider = chart.body?.source;
  const chartScope = chart.headers.get("x-programmable-chart-scope");
  const chartPoolAttribution = chart.headers.get(
    "x-programmable-chart-pool-attribution",
  );
  const expectedChartScope = chartProvider === "gmgn" ? "token" : "pool";
  const expectedChartPoolAttribution = chartProvider === "gmgn"
    ? chart.body?.poolAttribution
    : "exact";
  const chartIdentityMatches =
    chart.body?.identity?.chainId === "1" &&
    canonicalMarketAddress(chart.body?.identity?.tokenAddress) ===
      chartIdentity.tokenAddress &&
    canonicalMarketPool(chart.body?.identity?.poolId) ===
      chartIdentity.poolId &&
    canonicalMarketAddress(chart.body?.identity?.quoteAddress) ===
      chartIdentity.quoteAddress &&
    chart.body?.identity?.protocol === "uniswap_v4";
  const gmgnProofIdentityMatches =
    chart.body?.identityProof?.identity?.chainId === "1" &&
    canonicalMarketAddress(
      chart.body?.identityProof?.identity?.tokenAddress,
    ) === chartIdentity.tokenAddress &&
    canonicalMarketPool(chart.body?.identityProof?.identity?.poolId) ===
      chartIdentity.poolId &&
    canonicalMarketAddress(
      chart.body?.identityProof?.identity?.quoteAddress,
    ) === chartIdentity.quoteAddress &&
    chart.body?.identityProof?.identity?.protocol === "uniswap_v4";
  const gmgnChartReady =
    chartProvider === "gmgn" &&
    chart.body?.schemaVersion === "programmable.gmgn-market-chart.v1" &&
    chart.body?.seriesScope === "token" &&
    ["exact", "unavailable"].includes(chart.body?.poolAttribution) &&
    chart.body?.status === "ready" &&
    chart.body?.readStatus === "live" &&
    chartHasHistory &&
    chart.body?.identityProof?.schemaVersion ===
      "programmable.gmgn-chart-identity-proof.v1" &&
    chart.body?.identityProof?.source === "gmgn-token-info" &&
    chart.body?.identityProof?.poolAttribution ===
      chart.body?.poolAttribution &&
    gmgnProofIdentityMatches &&
    exactObjectKeys(chart.body?.identityProof?.canonicalSupply, [
      "tokenDecimals",
      "totalSupplyRaw",
    ]) &&
    typeof chartCanonicalSupply.totalSupplyRaw === "string" &&
    chart.body?.identityProof?.canonicalSupply?.totalSupplyRaw ===
      chartCanonicalSupply.totalSupplyRaw &&
    Number.isSafeInteger(chartCanonicalSupply.tokenDecimals) &&
    chart.body?.identityProof?.canonicalSupply?.tokenDecimals ===
      chartCanonicalSupply.tokenDecimals &&
    chart.body?.points.every((point) =>
      point?.valueSemantics === "period-close"
    );
  const bitqueryChartFallback =
    chartProvider === "bitquery" &&
    chart.body?.schemaVersion === "programmable.market-chart.v1" &&
    [
      "ready",
      "insufficient-history",
      "partial",
      "waiting-for-first-trade",
      "unavailable",
    ].includes(chart.body?.status) &&
    ["live", "cache-fallback"].includes(chart.body?.readStatus) &&
    chart.body?.valuation?.status === "unavailable" &&
    chart.body?.valuation?.reason === "source-unavailable";
  const chartContractInvalid =
    chart.status !== 200 ||
    (!gmgnChartReady && !bitqueryChartFallback) ||
    (requireGmgnMarket && !gmgnChartReady) ||
    !chartIdentityMatches ||
    chart.body?.range !== "1d" ||
    // Vercel normalizes shared-cache directives on dynamic route responses to
    // this publicly observable fresh-response policy. The route-level policy
    // remains accepted for direct runtime tests; the stage probe must accept
    // the exact header a browser receives.
    (chart.headers.get("cache-control") !==
      "public, max-age=0, s-maxage=2, stale-while-revalidate=2" &&
      chart.headers.get("cache-control") !== "public, max-age=0") ||
    !["current", "partial", "unavailable"].includes(
      chart.headers.get("x-programmable-data-quality"),
    ) ||
    chart.headers.get("x-programmable-launch-source") !==
      catalogBoundary.launchSource ||
    chart.headers.get("x-programmable-read-source") !==
      `${catalogBoundary.launchSource}+${chartProvider}` ||
    chart.headers.get("x-programmable-market-provider") !== chartProvider ||
    chartScope !== expectedChartScope ||
    chartPoolAttribution !== expectedChartPoolAttribution ||
    !["live", "cache-fallback"].includes(
      chart.headers.get("x-programmable-market-read-status"),
    ) ||
    chart.headers.get("x-programmable-market-read-status") !==
      chart.body?.readStatus ||
    (chartHasHistory && (
      chart.headers.get("x-programmable-market-source") !== chartProvider ||
      chart.headers.get("x-programmable-price-source") !== chartProvider ||
      chart.headers.get("x-programmable-market-as-of") !== chart.body?.asOfTime
    )) ||
    (!chartHasHistory && (
      chart.headers.get("x-programmable-market-source") !== null ||
      chart.headers.get("x-programmable-price-source") !== null ||
      chart.headers.get("x-programmable-market-as-of") !== null
    )) ||
    chart.headers.get("x-programmable-valuation-block") !== null;
  if (chartContractInvalid) {
    throw new Error(
      "Token chart scope contract is invalid: " + JSON.stringify({
        status: chart.status,
        schemaVersion: chart.body?.schemaVersion ?? null,
        source: chart.body?.source ?? null,
        readStatus: chart.body?.readStatus ?? null,
        identityMatches: chartIdentityMatches,
        range: chart.body?.range ?? null,
        valuationStatus: chart.body?.valuation?.status ?? null,
        valuationReason: chart.body?.valuation?.reason ?? null,
        cacheControl: chart.headers.get("cache-control"),
        dataQuality: chart.headers.get("x-programmable-data-quality"),
        launchSource: chart.headers.get("x-programmable-launch-source"),
        readSource: chart.headers.get("x-programmable-read-source"),
        marketProvider: chart.headers.get("x-programmable-market-provider"),
        marketReadStatus: chart.headers.get(
          "x-programmable-market-read-status",
        ),
        chartScope,
        chartPoolAttribution,
        hasHistory: chartHasHistory,
        marketSource: chart.headers.get("x-programmable-market-source"),
        priceSource: chart.headers.get("x-programmable-price-source"),
        hasMarketAsOf: chart.headers.get("x-programmable-market-as-of") !== null,
        hasValuationBlock:
          chart.headers.get("x-programmable-valuation-block") !== null,
      }),
    );
  }
  const chartStatus = chart.body.status;
  if (githubOutput) {
    appendOutput(
      githubOutput,
      [
        `gmgn_account_gate_mode=${gmgnAccountGateMode}`,
        `gmgn_requests_per_second=${gmgnRequestsPerSecond}`,
        `market_provider=${marketProvider}`,
        `market_read_status=${marketReadStatus}`,
        `detail_market_provider=${detailMarketProvider}`,
        `detail_status=${detailStatus}`,
        `market_cap_desc_source=${marketCapDescRanking.source}`,
        `market_cap_desc_status=${marketCapDescRanking.status}`,
        `market_cap_desc_gmgn_status=${marketCapDescRanking.gmgnStatus}`,
        `market_cap_desc_matched_count=${marketCapDescRanking.matchedTokenCount}`,
        `market_cap_desc_gmgn_hydration_qualified_count=${marketCapDescRanking.gmgnHydrationQualifiedCount}`,
        `market_cap_desc_ranking_commitment=${marketCapDescRanking.rankingCommitment}`,
        `market_cap_asc_source=${marketCapAscRanking.source}`,
        `market_cap_asc_status=${marketCapAscRanking.status}`,
        `market_cap_asc_gmgn_status=${marketCapAscRanking.gmgnStatus}`,
        `market_cap_asc_matched_count=${marketCapAscRanking.matchedTokenCount}`,
        `market_cap_asc_gmgn_hydration_qualified_count=${marketCapAscRanking.gmgnHydrationQualifiedCount}`,
        `market_cap_asc_ranking_commitment=${marketCapAscRanking.rankingCommitment}`,
        `discovery_status=${trendingDiscovery.status}`,
        `discovery_matched_count=${trendingDiscovery.matchedTokenCount}`,
        `discovery_ranking_commitment=${trendingDiscovery.rankingCommitment}`,
        `discovery_consistency=${trendingDiscoveryConsistency}`,
        `search_status=${searchRanking.status}`,
        `search_matched_count=${searchRanking.matchedTokenCount}`,
        `search_ranking_commitment=${searchRanking.rankingCommitment}`,
        `analytics_summary_status=${analyticsSummaryStatus}`,
        `analytics_holders_status=${analyticsHoldersStatus}`,
        `analytics_traders_status=${analyticsTradersStatus}`,
        `shard_trade_status=${shardTradeStatus}`,
        `chart_provider=${chartProvider}`,
        `chart_scope=${chartScope}`,
        `chart_pool_attribution=${chartPoolAttribution}`,
        `chart_status=${chartStatus}`,
      ].join("\n") + "\n",
      "utf8",
    );
  }
  const result = {
    status: "verified-staged-static-identity-dexscreener-public-apis",
    catalogSource: highest.body.catalog.source,
    catalogStatus: highest.body.catalog.status,
    lastIndexedAt: highest.body.catalog.lastIndexedAt,
    healthStatus: health.body.status,
    healthAuthority: "informational-only",
    gmgnAccountGateMode,
    gmgnRequestsPerSecond,
    marketProvider,
    marketReadStatus,
    tokenAddress,
    profileAccount,
    profileStatus,
    detailMarketProvider,
    detailStatus,
    marketCapDescSource: marketCapDescRanking.source,
    marketCapDescStatus: marketCapDescRanking.status,
    marketCapDescGmgnStatus: marketCapDescRanking.gmgnStatus,
    marketCapDescMatchedCount: marketCapDescRanking.matchedTokenCount,
    marketCapDescGmgnHydrationQualifiedCount:
      marketCapDescRanking.gmgnHydrationQualifiedCount,
    marketCapDescRankingCommitment: marketCapDescRanking.rankingCommitment,
    marketCapAscSource: marketCapAscRanking.source,
    marketCapAscStatus: marketCapAscRanking.status,
    marketCapAscGmgnStatus: marketCapAscRanking.gmgnStatus,
    marketCapAscMatchedCount: marketCapAscRanking.matchedTokenCount,
    marketCapAscGmgnHydrationQualifiedCount:
      marketCapAscRanking.gmgnHydrationQualifiedCount,
    marketCapAscRankingCommitment: marketCapAscRanking.rankingCommitment,
    discoveryStatus: trendingDiscovery.status,
    discoveryMatchedCount: trendingDiscovery.matchedTokenCount,
    discoveryRankingCommitment: trendingDiscovery.rankingCommitment,
    discoveryConsistency: trendingDiscoveryConsistency,
    searchStatus: searchRanking.status,
    searchMatchedCount: searchRanking.matchedTokenCount,
    searchRankingCommitment: searchRanking.rankingCommitment,
    analyticsSummaryStatus,
    analyticsHoldersStatus,
    analyticsTradersStatus,
    shardTradeStatus,
    chartProvider,
    chartScope,
    chartPoolAttribution,
    chartStatus,
    creatorClaimPrepare: "separate-live-probe-required",
    tradePrepare: "separate-live-probe-required",
  };
  process.stdout.write(JSON.stringify(result) + "\n");
  return result;
}

export function runProductionStaticDexscreenerSmokeV1(input = {}) {
  return runStagedStaticDexscreenerSmokeV1({
    ...input,
    targetKind: "production",
    environment: {
      ...(input.environment ?? process.env),
      STAGED_TARGET_URL: "https://programmable.market/",
      PROGRAMMABLE_REQUIRE_SHARD_ROUTER_TRADE: "true",
    },
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStagedStaticDexscreenerSmokeV1();
}
