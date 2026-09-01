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
const VISIBLE_EXPLORE_PAGE_SIZE = 9;
const GMGN_CANONICAL_SCAN_MAXIMUM_PAGES = 8;
const PROVIDER_RECENT_MAXIMUM_AGE_MS = 5 * 60_000;
const MINIMUM_FDV_LIQUIDITY_USD_WAD = 10_000n * 10n ** 18n;

class ExploreCatalogBoundaryDriftError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExploreCatalogBoundaryDriftError";
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

async function requestJson(
  target,
  headers,
  path,
  fetchImpl,
  acceptedStatuses = new Set([200]),
) {
  const requestUrl = new URL(path, target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchImpl(requestUrl, {
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 503 && attempt === 0) continue;
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
  return response.status === 200 &&
    ["ready", "degraded"].includes(response.body?.status) &&
    typeof response.body?.provider?.name === "string" &&
    response.body.provider.name.trim() !== "" &&
    typeof response.body.provider.configured === "boolean" &&
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
        `canonical-launch-stamp-router+${marketProvider}` &&
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
    return JSON.stringify({
      source,
      identityCount: catalog.identityCount,
      identityCommitment: catalog.identityCommitment,
      completeness: catalog.completeness,
      scope: catalog.scope,
      evidenceDeployment: null,
      evidenceSourceCommit: null,
      classicV4Bound: false,
      routerEvidence: {
        asOfBlock: routerStamp.asOfBlock,
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
      `${launchSource}+${marketProvider}` &&
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
  return JSON.stringify({
    source,
    identityCount: catalog.identityCount,
    identityCommitment: catalog.identityCommitment,
    completeness: catalog.completeness,
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
    !Number.isSafeInteger(read.fallbackQualifiedCount) ||
    read.gmgnObservedCount < 0 ||
    read.gmgnObservedCount > read.requestedCount ||
    read.gmgnQualifiedCount < 0 ||
    read.gmgnQualifiedCount > read.gmgnObservedCount ||
    read.fallbackRequestedCount !==
      read.requestedCount - read.gmgnQualifiedCount ||
    read.fallbackQualifiedCount < 0 ||
    read.fallbackQualifiedCount > read.fallbackRequestedCount ||
    read.qualifiedCount !==
      read.gmgnQualifiedCount + read.fallbackQualifiedCount ||
    read.observedCount <
      Math.max(read.gmgnObservedCount, read.fallbackQualifiedCount) ||
    read.observedCount > Math.min(
      read.requestedCount,
      read.gmgnObservedCount + read.fallbackQualifiedCount,
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
    ...(read.fallbackQualifiedCount > 0 ? ["dexscreener"] : []),
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

function exactFdvRanking(response, tokens, nowMs) {
  const ranking = response.body?.ranking;
  if (
    !["complete", "partial", "unavailable"].includes(ranking?.status) ||
    ranking.requested !== "fdv" ||
    ranking.totalCount !== response.body?.total ||
    !Number.isSafeInteger(ranking.qualifiedCount) ||
    ranking.qualifiedCount < 0 ||
    ranking.qualifiedCount > response.body?.marketRead?.qualifiedCount ||
    ranking.qualifiedCount > ranking.totalCount
  ) return false;
  const qualified = tokens.filter((token) =>
    qualifiedDexscreenerFdv(token, nowMs)
  );
  const unavailable = tokens.filter(exactUnavailableValuation);
  if (qualified.length + unavailable.length !== tokens.length) return false;
  let encounteredUnavailable = false;
  for (const token of tokens) {
    if (qualifiedDexscreenerFdv(token, nowMs)) {
      if (encounteredUnavailable) return false;
    } else {
      encounteredUnavailable = true;
    }
  }
  for (let index = 1; index < qualified.length; index += 1) {
    if (
      BigInt(qualified[index - 1].valuation.valueWad) <
        BigInt(qualified[index].valuation.valueWad)
    ) return false;
  }
  if (ranking.status === "complete") {
    return ranking.applied === "fdv" &&
      ranking.qualifiedCount === ranking.totalCount &&
      qualified.length === tokens.length;
  }
  if (ranking.status === "partial") {
    return ranking.applied === "qualified-fdv-then-launch-order" &&
      ranking.qualifiedCount > 0 &&
      ranking.qualifiedCount < ranking.totalCount &&
      qualified.length === Math.min(tokens.length, ranking.qualifiedCount);
  }
  return ranking.applied === "launch-order" &&
    ranking.qualifiedCount === 0 &&
    qualified.length === 0;
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

export async function runStagedStaticDexscreenerSmokeV1(input = {}) {
  const environment = input.environment ?? process.env;
  const fetchImpl = input.fetchImpl ?? fetch;
  const appendOutput = input.appendOutput ?? appendFileSync;
  const waitForCatalogConvergence = input.waitForCatalogConvergence ?? sleep;
  const now = input.now ?? (() => new Date());
  if (typeof waitForCatalogConvergence !== "function") {
    throw new Error("Explore catalog convergence wait is invalid");
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
    requestJson(target, headers, path, fetchImpl, acceptedStatuses);
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
      if (
        highest.status !== 200 ||
        highest.body?.status !== "ready" ||
        highest.body?.sort !== "market-cap" ||
        highest.body?.sortMetric !== "fdv" ||
        highestTokens.length < 1 ||
        !exactExplorePage(highest, highestTokens, {
          page: 1,
          pageSize: VISIBLE_EXPLORE_PAGE_SIZE,
        }) ||
        exactCatalogSnapshot(highest) === null ||
        !exactFdvRanking(highest, highestTokens, validationNowMs)
      ) throw new Error("Highest FDV response contract is invalid");
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
      const highestCatalog = exactCatalogSnapshot(highest);
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
            !exactExplorePage(catalogPage, pageTokens, {
              page,
              pageSize: catalogPageSize,
            }) ||
            pageCatalog === null ||
            !exactDexscreenerMarketRead(
              catalogPage,
              pageTokens,
              now().getTime(),
            )
          ) throw new Error("Explore catalog pagination contract is invalid");
          if (pageCatalog !== newestCatalog) {
            throw new ExploreCatalogBoundaryDriftError(
              "Explore catalog changed during pagination",
            );
          }
          completeCatalogTokens.push(...pageTokens);
        }
      }
      if (
        completeCatalogTokens.length !== newest.body.total ||
        !exactDexscreenerMarketRead(
          highest,
          completeCatalogTokens,
          now().getTime(),
          highestTokens,
        )
      ) throw new Error("Highest FDV market request set is invalid");
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
      ) throw new Error("Highest FDV page is outside the paged catalog");
      for (let index = 1; index < completeCatalogTokens.length; index += 1) {
        if (
          Date.parse(completeCatalogTokens[index - 1].launchedAt) <
            Date.parse(completeCatalogTokens[index].launchedAt)
        ) throw new Error("Newest launches are not ordered descending");
      }
      if (
        highest.body.ranking.status === "unavailable" &&
        !exactSamePageOrder(highest, newest)
      ) throw new Error("Unavailable FDV did not preserve launch order");

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

        // The already-bound market-cap page is the strongest deterministic
        // candidate set: every candidate passed the same $10k Dexscreener
        // liquidity gate before an independent GMGN detail proof is accepted.
        const marketCapCandidates = highestTokens.filter((token) =>
          qualifiedDexscreenerFdv(token, now().getTime())
        );
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
              !exactExplorePage(gmgnCanonical, gmgnCanonicalTokens, {
                page,
                pageSize: VISIBLE_EXPLORE_PAGE_SIZE,
              }) ||
              gmgnCanonicalCatalog !== highestCatalog ||
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
        marketProvider: newest.headers.get("x-programmable-market-provider"),
        marketReadStatus: newest.body.marketRead.status,
        newestTokens,
        shardTradeStatus,
        tokenAddress,
      };
      break;
    } catch (error) {
      if (!(error instanceof ExploreCatalogBoundaryDriftError)) throw error;
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
    marketProvider,
    marketReadStatus,
    newestTokens,
    shardTradeStatus,
    tokenAddress,
  } = exploreSnapshot;

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
    chart.body?.status === "ready" &&
    chart.body?.readStatus === "live" &&
    chartHasHistory &&
    chart.body?.identityProof?.schemaVersion ===
      "programmable.gmgn-chart-identity-proof.v1" &&
    chart.body?.identityProof?.source === "gmgn-token-info" &&
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
      "Token chart pool-bound contract is invalid: " + JSON.stringify({
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
        `market_provider=${marketProvider}`,
        `market_read_status=${marketReadStatus}`,
        `detail_market_provider=${detailMarketProvider}`,
        `detail_status=${detailStatus}`,
        `shard_trade_status=${shardTradeStatus}`,
        `chart_provider=${chartProvider}`,
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
    marketProvider,
    marketReadStatus,
    tokenAddress,
    profileAccount,
    profileStatus,
    detailMarketProvider,
    detailStatus,
    shardTradeStatus,
    chartProvider,
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
