import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { runStagedStaticDexscreenerSmokeV1 } from
  "../smoke-static-dexscreener-public-apis.mjs";
import { parsePostPromotionArguments, verifyPostPromotion } from
  "../perf/read-model-post-promotion.mjs";

const NOW = new Date().toISOString();
const TOKEN = "0x1111111111111111111111111111111111111111";
const CREATOR = "0x2222222222222222222222222222222222222222";
const POOL = `0x${"33".repeat(32)}`;
const NATIVE_CURRENCY_ADDRESS =
  "0x0000000000000000000000000000000000000000";
const CLASSIC_V4_HOOK = "0x6666666666666666666666666666666666666666";
const CLASSIC_V4_REWARD_VAULT =
  "0x7777777777777777777777777777777777777777";
const CLASSIC_V4_POSITION_RECIPIENT =
  "0x8888888888888888888888888888888888888888";
const CLASSIC_V4_CUSTODY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CLASSIC_V4_LAUNCH_HASH = `0x${"de".repeat(32)}`;
const CLASSIC_V4_TRANSACTION_HASH = `0x${"ef".repeat(32)}`;
const CLASSIC_V4_CUSTODY_HASH = `0x${"12".repeat(32)}`;
const CLASSIC_V4_TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
const CUSTOM_TOKEN = "0x9999999999999999999999999999999999999999";
const ROUTER_TOKEN = "0x6969696969696969696969696969696969696969";
const ROUTER_LAUNCH_ID = `0x${"ab".repeat(32)}`;
const ROUTER_STAMP_HASH = `0x${"cd".repeat(32)}`;
const POOL_MANAGER = "0x000000000004444c5dc75cb358380d2e3de08a90";
const SHARD_TOKEN = [
  "0xface73b63787960282f2",
  "d4682d3752beb25271ad",
].join("");
const SHARD_POOL =
  "0x9c74d6183b1ee526a62db562a81da3bf579b5bd6bff5066ae985265a7028e010";
const SHARD_PROJECT =
  "sha256:98f170ed0fa4e98f5b7e1901905132c24082f54f37f6176133be54fd039959a3";
const SHARD_CAPABILITY =
  "sha256:6c562e4c2f52829d6c5fdf806ab7deb5a9a37ac549e8137a17160d0dd8436e6a";

function entry(index) {
  const tokenAddress = index === 0
    ? TOKEN
    : index === 1
      ? "0x4444444444444444444444444444444444444444"
      : `0x${(index + 1).toString(16).padStart(40, "0")}`;
  return {
    exploreKind: "token",
    id: `1:${tokenAddress}`,
    tokenAddress,
    poolId: index === 0
      ? POOL
      : index === 1
        ? `0x${"55".repeat(32)}`
        : `0x${(index + 1).toString(16).padStart(64, "0")}`,
    creatorAddress: CREATOR,
    launchedAt: new Date(Date.parse(NOW) - index * 1_000).toISOString(),
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: `1:${tokenAddress}`,
      modelId: "classic",
      modelVersion: "classic-v3",
    },
    totalSupplyRaw: (1_000_000n * 10n ** 18n).toString(),
    tokenDecimals: 18,
    quoteAssetAddress: NATIVE_CURRENCY_ADDRESS,
    valuation: { status: "unavailable", reason: "source-unavailable" },
  };
}

function classicV4Custody(mode) {
  if (mode === "unlocked") {
    return {
      custodyAddress: null,
      mode,
      durationDays: 0,
      cliffDays: 0,
      configurationHash: CLASSIC_V4_CUSTODY_HASH,
      cliffTimestamp: NOW,
      releaseTimestamp: NOW,
    };
  }
  const durationDays = 30;
  const cliffDays = mode === "cliff-linear" ? 7 : 0;
  const timestampAfterDays = (days) =>
    new Date(Date.parse(NOW) + days * 86_400_000).toISOString();
  return {
    custodyAddress: CLASSIC_V4_CUSTODY,
    mode,
    durationDays,
    cliffDays,
    configurationHash: CLASSIC_V4_CUSTODY_HASH,
    cliffTimestamp: mode === "fixed-lock"
      ? timestampAfterDays(durationDays)
      : timestampAfterDays(cliffDays),
    releaseTimestamp: timestampAfterDays(durationDays),
  };
}

function classicV4Entry({ custodyMode = "unlocked" } = {}) {
  const token = entry(0);
  return {
    ...token,
    launchCategoryProvenance: {
      ...token.launchCategoryProvenance,
      modelVersion: "classic-v4",
    },
    hookAddress: CLASSIC_V4_HOOK,
    creatorAddress: CREATOR,
    rewardVaultAddress: CLASSIC_V4_REWARD_VAULT,
    positionRecipient: CLASSIC_V4_POSITION_RECIPIENT,
    positionTokenId: "1",
    launchHash: CLASSIC_V4_LAUNCH_HASH,
    launchBlockNumber: "25740000",
    launchTransactionHash: CLASSIC_V4_TRANSACTION_HASH,
    launchTransactionIndex: 2,
    launchLogIndex: 7,
    totalSupplyRaw: CLASSIC_V4_TOTAL_SUPPLY.toString(),
    tokenDecimals: 18,
    tokenLiquidityAmountRaw: (CLASSIC_V4_TOTAL_SUPPLY - 1n).toString(),
    lockedTokenDustRaw: "1",
    initialBuyEthAmountWei: "600000000000000",
    initialBuyTokenAmountRaw: "1000000000000000000",
    initialBuyCustody: classicV4Custody(custodyMode),
    quoteAssetAddress: "0x0000000000000000000000000000000000000000",
    quoteAssetSymbol: "ETH",
    quoteAssetName: "Ether",
    buyHookFeeBps: 10,
    sellHookFeeBps: 1_000,
    totalSwapFeeBps: 1_000,
    initialTick: 204_200,
    tickLower: 174_800,
    tickUpper: 204_200,
    lpFeePips: 0,
    launchModel: "classic",
    launchModelVersion: "classic-v4",
    liquidityPath: "meme",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: token.id,
      modelId: "classic",
      modelVersion: "classic-v4",
    },
  };
}

function customProject() {
  return {
    exploreKind: "custom-project",
    id: `custom:sha256:${"66".repeat(32)}`,
    name: "Custom Current",
    symbol: "CUSTOM",
    links: [],
    launchedAt: NOW,
    finalizedAt: NOW,
    chainId: "1",
    modelId: "custom-contract-graph-v2",
    customProjectId: `sha256:${"66".repeat(32)}`,
    customLaunchId: `sha256:${"77".repeat(32)}`,
    tokenAddress: CUSTOM_TOKEN,
    launchingWallet: {
      namespace: "eip155:1",
      value: CREATOR,
    },
    postLaunchAuthorityInventory: {},
    postLaunchAuthorityInventoryHash: `sha256:${"88".repeat(32)}`,
    markets: [
      {
        marketId: "market-b",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"99".repeat(32)}`,
        baseAsset: {
          assetId: "custom-token",
          identity: { namespace: "eip155:1/erc20", value: CUSTOM_TOKEN },
        },
        quoteAsset: {
          assetId: "native-eth",
          identity: {
            namespace: "eip155:1/erc20",
            value: "0x0000000000000000000000000000000000000000",
          },
        },
      },
      {
        marketId: "market-a",
        kind: "uniswap-v4",
        status: "active",
        poolId: `0x${"98".repeat(32)}`,
        baseAsset: {
          assetId: "custom-token",
          identity: { namespace: "eip155:1/erc20", value: CUSTOM_TOKEN },
        },
        quoteAsset: {
          assetId: "native-eth",
          identity: {
            namespace: "eip155:1/erc20",
            value: "0x0000000000000000000000000000000000000000",
          },
        },
      },
    ],
    launchCategoryProvenance: {},
    valuation: { status: "unavailable", reason: "source-unavailable" },
  };
}

function routerCustomEntry() {
  return {
    ...entry(0),
    id: `1:${ROUTER_TOKEN}`,
    tokenAddress: ROUTER_TOKEN,
    launchModel: "custom-graph",
    launchModelVersion: "programmable-launch-stamp-router-v1",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "custom",
      source: "canonical-launch-stamp-router",
      launchId: ROUTER_LAUNCH_ID,
      stampHash: ROUTER_STAMP_HASH,
    },
    launchStampProvenance: {
      schemaVersion: "programmable.launch-stamp-provenance.v1",
      chainId: 1,
      kind: "custom-graph",
      launchId: ROUTER_LAUNCH_ID,
      stampHash: ROUTER_STAMP_HASH,
      poolManagerAddress: POOL_MANAGER,
      poolId: POOL,
      poolKey: {
        currency0: "0x0000000000000000000000000000000000000000",
        currency1: ROUTER_TOKEN,
        fee: 8_388_608,
        tickSpacing: 10,
        hooks: "0xd7451a039373f54e493deE42A751fEcBfAFBa0cc",
      },
      tokenProof: {
        tokenAddress: ROUTER_TOKEN,
        launchId: ROUTER_LAUNCH_ID,
        stampHash: ROUTER_STAMP_HASH,
      },
      poolProof: {
        poolManagerAddress: POOL_MANAGER,
        poolId: POOL,
        launchId: ROUTER_LAUNCH_ID,
        stampHash: ROUTER_STAMP_HASH,
      },
    },
  };
}

function catalog() {
  return {
    source: "envio-classic-v3",
    launchSource: "envio-classic-v3",
    status: "last-known-good",
    lastIndexedAt: NOW,
    asOfBlock: "25740000",
    asOfBlockHash: `0x${"aa".repeat(32)}`,
    identityCount: 2,
    identityCommitment: `sha256:${"bb".repeat(32)}`,
    completeness: {
      classic: "last-known-good",
      stock: "excluded",
      custom: "unavailable",
      registryCustom: "unavailable",
      routerCustom: "unavailable",
    },
    scope: {
      included: [
        "classic-v3",
        "official-main-token",
        "registry.custom-launched",
      ],
      excluded: [
        "classic-v1",
        "classic-v2",
        "stock-paired-v1",
        "stock-paired-v2",
        "stock-paired-v3",
      ],
      publicCategories: ["classic", "custom"],
    },
    evidence: {
      kind: "envio-indexer-state",
      deployment: "production-92f6373",
      sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
      progressBlock: "25740000",
      progressOccurrenceId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:0`,
      commitment: `sha256:${"cc".repeat(32)}`,
    },
  };
}

function marketRead(requestedCount) {
  return {
    provider: "dexscreener",
    status: "unavailable",
    currency: "USD",
    requestedCount,
    observedCount: 0,
    qualifiedCount: 0,
    unavailableCount: requestedCount,
    oldestFetchedAt: null,
    newestFetchedAt: null,
  };
}

function marketCapRanking(sort, totalCount, overrides = {}) {
  const direction = sort === "market-cap-asc" ? "asc" : "desc";
  const matchedTokenCount = overrides.matchedTokenCount ?? 0;
  const unobservedCanonicalEntryCount =
    overrides.unobservedCanonicalEntryCount ?? totalCount - matchedTokenCount;
  const gmgnHydrationEligibleCount =
    overrides.gmgnHydrationEligibleCount ?? unobservedCanonicalEntryCount;
  const gmgnHydrationRequestedCount =
    overrides.gmgnHydrationRequestedCount ??
      Math.min(gmgnHydrationEligibleCount, 100);
  const gmgnHydrationQualifiedCount =
    overrides.gmgnHydrationQualifiedCount ?? 0;
  const fallbackRequestedCount = overrides.fallbackRequestedCount ??
    unobservedCanonicalEntryCount - gmgnHydrationQualifiedCount;
  const fallbackQualifiedCount = overrides.fallbackQualifiedCount ?? 0;
  const qualifiedCount = overrides.qualifiedCount ??
    matchedTokenCount + gmgnHydrationQualifiedCount + fallbackQualifiedCount;
  return {
    schemaVersion: "programmable.explore-market-cap-ranking.v1",
    requested: "market-cap",
    direction,
    primaryProvider: "gmgn",
    source: "canonical-launch-order",
    fallbackProvider: "dexscreener",
    rankingCommitment: direction === "asc"
      ? `sha256:${"ab".repeat(32)}`
      : `sha256:${"cd".repeat(32)}`,
    status: "unavailable",
    gmgnStatus: "unavailable",
    applied: "launch-order",
    metricOrder:
      "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order",
    rankInterval: "1h",
    rankLimit: 100,
    observedTokenCount: 0,
    matchedTokenCount,
    matchedUniqueTokenCount: 0,
    canonicalEntryCount: totalCount,
    canonicalTokenCount: totalCount,
    unobservedCanonicalEntryCount,
    canonicalAddressCoverageBps: 0,
    foreignTokenCount: 0,
    discardedProviderItemCount: 0,
    gmgnHydrationLimit: 100,
    gmgnHydrationEligibleCount,
    gmgnHydrationRequestedCount,
    gmgnHydrationObservedCount: 0,
    gmgnHydrationQualifiedCount,
    gmgnHydrationDeferredCount:
      gmgnHydrationEligibleCount - gmgnHydrationRequestedCount,
    fallbackRequestedCount,
    fallbackQualifiedCount,
    canonicalTailCount: totalCount - qualifiedCount,
    qualifiedCount,
    totalCount,
    asOfTime: null,
    ...overrides,
  };
}

function gmgnMatchedMarketCapRanking(
  sort,
  totalCount,
  { fallbackQualifiedCount = 0 } = {},
) {
  const matchedTokenCount = Math.min(1, totalCount);
  const fallbackRequestedCount = totalCount - matchedTokenCount;
  const acceptedFallbackCount = Math.min(
    fallbackQualifiedCount,
    fallbackRequestedCount,
  );
  const qualifiedCount = matchedTokenCount + acceptedFallbackCount;
  const complete = totalCount > 0 && qualifiedCount === totalCount;
  return marketCapRanking(sort, totalCount, {
    source: acceptedFallbackCount > 0 ? "gmgn+dexscreener" : "gmgn",
    status: complete ? "complete" : "partial",
    gmgnStatus: matchedTokenCount === totalCount ? "complete" : "partial",
    applied: matchedTokenCount === totalCount
      ? "gmgn-market-cap"
      : acceptedFallbackCount === fallbackRequestedCount &&
          fallbackRequestedCount > 0
        ? "gmgn-market-cap-then-dexscreener-fdv"
        : acceptedFallbackCount > 0
          ? "gmgn-market-cap-then-dexscreener-fdv-then-launch-order"
          : "gmgn-market-cap-then-launch-order",
    observedTokenCount: matchedTokenCount,
    matchedTokenCount,
    matchedUniqueTokenCount: matchedTokenCount,
    unobservedCanonicalEntryCount: fallbackRequestedCount,
    canonicalAddressCoverageBps: totalCount === 0
      ? 0
      : Math.floor(matchedTokenCount * 10_000 / totalCount),
    gmgnHydrationEligibleCount: fallbackRequestedCount,
    gmgnHydrationRequestedCount: Math.min(fallbackRequestedCount, 100),
    gmgnHydrationDeferredCount: Math.max(0, fallbackRequestedCount - 100),
    fallbackRequestedCount,
    fallbackQualifiedCount: acceptedFallbackCount,
    canonicalTailCount: totalCount - qualifiedCount,
    qualifiedCount,
    asOfTime: NOW,
  });
}

function searchRanking(tokens, overrides = {}) {
  const addresses = new Set(tokens.map((token) =>
    token.tokenAddress.toLowerCase()
  ));
  const matchedTokenCount = overrides.matchedTokenCount ?? addresses.size;
  return {
    schemaVersion: "programmable.explore-search-ranking.v1",
    provider: "gmgn",
    requested: "search",
    orderBy: "weight",
    rankingCommitment: `sha256:${"ef".repeat(32)}`,
    status: matchedTokenCount === tokens.length ? "complete" : "partial",
    applied: matchedTokenCount > 0
      ? "gmgn-canonical-search-with-local-match-fallback"
      : "local-match-order",
    observedTokenCount: matchedTokenCount,
    matchedTokenCount,
    matchedUniqueTokenCount: matchedTokenCount,
    canonicalMatchCount: tokens.length,
    canonicalMatchTokenCount: addresses.size,
    unobservedCanonicalMatchCount: tokens.length - matchedTokenCount,
    providerOnlyCanonicalTokenCount: 0,
    foreignTokenCount: 0,
    discardedProviderItemCount: 0,
    duplicateProviderItemCount: 0,
    canonicalAddressCoverageBps: addresses.size === 0
      ? 0
      : Math.floor(matchedTokenCount * 10_000 / addresses.size),
    asOfTime: NOW,
    ...overrides,
  };
}

function searchFixtureMarketRead(tokens) {
  const requestedCount = tokens.length;
  const gmgnObservedCount = tokens.filter((token) =>
    token.gmgnMarketData !== undefined
  ).length;
  const gmgnQualifiedCount = tokens.filter((token) =>
    token.valuation?.status === "available" &&
    token.valuation.source === "gmgn"
  ).length;
  const fallbackRequestedCount = requestedCount - gmgnQualifiedCount;
  const fallbackQualifiedCount = tokens.filter((token) =>
    token.valuation?.status === "available" &&
    token.valuation.source === "dexscreener"
  ).length;
  const fallbackObservedCount = fallbackQualifiedCount;
  const observedCount = Math.min(
    requestedCount,
    gmgnObservedCount + fallbackObservedCount,
  );
  const qualifiedCount = gmgnQualifiedCount + fallbackQualifiedCount;
  const status = observedCount === 0
    ? "unavailable"
    : observedCount === requestedCount
      ? "complete"
      : "partial";
  const window = observedCount === 0
    ? { oldestFetchedAt: null, newestFetchedAt: null }
    : { oldestFetchedAt: NOW, newestFetchedAt: NOW };
  return gmgnObservedCount > 0
    ? {
        provider: "gmgn",
        fallbackProvider: "dexscreener",
        status,
        currency: "USD",
        requestedCount,
        observedCount,
        qualifiedCount,
        unavailableCount: requestedCount - qualifiedCount,
        gmgnObservedCount,
        gmgnQualifiedCount,
        fallbackRequestedCount,
        fallbackObservedCount,
        fallbackQualifiedCount,
        ...window,
      }
    : {
        provider: "dexscreener",
        status,
        currency: "USD",
        requestedCount,
        observedCount,
        qualifiedCount,
        unavailableCount: requestedCount - qualifiedCount,
        ...window,
      };
}

function applySearchFixture(body, url) {
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  if (url.pathname !== "/api/explore" || query === "") return body;
  const tokens = (Array.isArray(body?.tokens) ? body.tokens : []).filter(
    (token) => token?.tokenAddress?.toLowerCase() === query,
  );
  const read = searchFixtureMarketRead(tokens);
  const qualifiedTimes = tokens.flatMap((token) =>
    token.valuation?.status === "available" ? [token.valuation.asOfTime] : []
  );
  const asOfTime = qualifiedTimes.sort().at(-1) ?? null;
  return {
    ...body,
    tokens,
    page: 1,
    pageSize: Number(url.searchParams.get("limit") ?? "100"),
    total: tokens.length,
    totalPages: tokens.length === 0 ? 0 : 1,
    sort: url.searchParams.get("sort") ?? "newest",
    sortMetric: "fdv",
    query,
    marketRead: read,
    dataQuality: {
      ...body.dataQuality,
      valuation: {
        ...body.dataQuality.valuation,
        status: read.qualifiedCount > 0 ? "provider-recent" : "unavailable",
        available: read.qualifiedCount,
        unavailable: tokens.length - read.qualifiedCount,
        asOfTime,
      },
    },
    ranking: undefined,
    discovery: undefined,
    search: body.search ?? searchRanking(tokens),
  };
}

function gmgnValuedEntry(baseEntry = entry(0)) {
  const totalSupplyRaw = (1_000_000n * 10n ** 18n).toString();
  const tokenDecimals = 18;
  const priceUsdWad = "1000000000000000000";
  const fdvUsdWad = (
    BigInt(priceUsdWad) * BigInt(totalSupplyRaw) /
    (10n ** BigInt(tokenDecimals))
  ).toString();
  return {
    ...baseEntry,
    totalSupplyRaw,
    tokenDecimals,
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      freshness: "provider-recent",
      source: "gmgn",
      valueWad: fdvUsdWad,
      asOfTime: NOW,
    },
    fdvUsdWad,
    gmgnMarketData: {
      schemaVersion: "programmable.gmgn-market-snapshot.v1",
      source: "gmgn",
      marketScope: "token",
      poolAttribution: "unavailable",
      currency: "USD",
      fetchedAt: NOW,
      identity: {
        chainId: "1",
        tokenAddress: baseEntry.tokenAddress,
        poolId: baseEntry.poolId,
        quoteAddress: NATIVE_CURRENCY_ADDRESS,
        protocol: "uniswap_v4",
      },
      priceUsdWad,
      fdvUsdWad,
      liquidityUsdWad: "10000000000000000000000",
      volume24hUsdWad: "0",
      swapCount24h: 0,
    },
  };
}

function dexscreenerValuedEntry(baseEntry = entry(0)) {
  const fdvUsdWad = "1000000000000000000000000";
  return {
    ...baseEntry,
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      freshness: "provider-recent",
      source: "dexscreener",
      valueWad: fdvUsdWad,
      asOfTime: NOW,
    },
    fdvUsdWad,
  };
}

function explore(sort, pageSize = 20) {
  const tokens = [entry(0), entry(1)];
  const marketCapSort = sort === "market-cap" || sort === "market-cap-asc";
  return {
    status: "ready",
    tokens,
    page: 1,
    pageSize,
    total: 2,
    totalPages: 1,
    sort,
    sortMetric: sort === "trending"
      ? "gmgn-trending"
      : marketCapSort
        ? "gmgn-market-cap+gmgn-token-info-fdv+dexscreener-fdv-fallback"
        : "fdv",
    dataQuality: {
      launchIdentity: {
        status: "partial",
        canonical: "last-known-good",
        custom: "unavailable",
        ageMs: 1_000,
      },
      valuation: {
        status: "unavailable",
        metric: "fdv",
        available: 0,
        unavailable: 2,
        stale: 0,
        unknown: 0,
        asOfBlock: null,
        asOfTime: null,
      },
    },
    catalog: catalog(),
    marketRead: marketRead(2),
    ...(marketCapSort
      ? { ranking: marketCapRanking(sort, tokens.length) }
      : {}),
    ...(sort === "trending"
      ? {
          discovery: {
            schemaVersion: "programmable.explore-discovery-ranking.v1",
            provider: "gmgn",
            requested: "trending",
            rankingCommitment: `sha256:${"dd".repeat(32)}`,
            status: "unavailable",
            applied: "launch-order",
            rankInterval: "1h",
            hotSearchInterval: "24h",
            snapshotCount: 0,
            observedTokenCount: 0,
            matchedTokenCount: 0,
            matchedUniqueTokenCount: 0,
            canonicalEntryCount: 2,
            canonicalTokenCount: 2,
            unobservedCanonicalEntryCount: 2,
            canonicalAddressCoverageBps: 0,
            foreignTokenCount: 0,
            discardedProviderItemCount: 0,
            asOfTime: null,
          },
        }
      : {}),
  };
}

function shardTradeDetail() {
  return {
    status: "ready",
    token: { tokenAddress: SHARD_TOKEN },
    customProject: null,
    routerTradeProject: {
      customProjectId: SHARD_PROJECT,
      markets: [{
        marketId: "shard-eth-v4",
        kind: "uniswap-v4-hooked-pool",
        status: "active",
        poolId: SHARD_POOL,
        baseAsset: {
          symbol: "SHARD",
          identity: { value: SHARD_TOKEN },
        },
        quoteAsset: {
          symbol: "ETH",
          identity: {
            value: "0x0000000000000000000000000000000000000000",
          },
        },
        tradeCapability: {
          supportedSides: ["base-to-quote", "quote-to-base"],
          hookDataPolicy: { kind: "empty", data: "0x" },
          tradeCapabilityBindingHash: SHARD_CAPABILITY,
        },
      }],
    },
    catalog: catalog(),
  };
}

function response(body, extraHeaders = {}, omittedHeaders = []) {
  const headers = new Headers({
    "content-type": "application/json",
    "x-programmable-launch-source": "envio-classic-v3",
    "x-programmable-read-source": "envio-classic-v3+dexscreener",
    "x-programmable-market-provider": "dexscreener",
    "x-programmable-market-read-status": "unavailable",
    "x-programmable-canonical-read-status": "last-known-good",
    "x-programmable-router-read-status": "unavailable",
    "x-programmable-identity-last-indexed-at": NOW,
    ...extraHeaders,
  });
  for (const name of omittedHeaders) headers.delete(name);
  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
  });
}

function stagedFetch(
  transform = ({ body }) => body,
  transformHeaders = ({ extraHeaders, omittedHeaders }) => ({
    extraHeaders,
    omittedHeaders,
  }),
) {
  return async (url) => {
    let body;
    if (url.pathname === "/api/ops/health") {
      body = {
        status: "ready",
        provider: { name: "gmgn", configured: true },
        providers: [
          {
            name: "gmgn",
            role: "primary-token-market",
            configured: true,
            requestsPerSecond: 20,
            accountGateMode: "multiflight-v1",
          },
          {
            name: "bitquery",
            role: "exact-pool-chart-fallback",
            configured: true,
          },
          {
            name: "dexscreener",
            role: "batch-fail-soft-fallback",
            configured: true,
          },
        ],
        checkedAt: NOW,
      };
    } else if (url.pathname === "/api/explore") {
      body = explore(
        url.searchParams.get("sort"),
        Number(url.searchParams.get("limit") ?? "20"),
      );
    } else if (url.pathname === "/api/explore/token") {
      body = url.searchParams.get("address")?.toLowerCase() === SHARD_TOKEN
        ? shardTradeDetail()
        : {
            status: "ready",
            token: entry(0),
            customProject: null,
            catalog: catalog(),
          };
    } else if (url.pathname === "/api/explore/token/chart") {
      body = {
        schemaVersion: "programmable.market-chart.v1",
        source: "bitquery",
        readStatus: "cache-fallback",
        status: "unavailable",
        generatedAt: NOW,
        identity: {
          chainId: "1",
          tokenAddress: url.searchParams.get("address"),
          poolId: POOL,
          quoteAddress: "0x0000000000000000000000000000000000000000",
          protocol: "uniswap_v4",
        },
        range: "1d",
        points: [],
        swapCount: 0,
        valuation: { status: "unavailable", reason: "source-unavailable" },
        truncated: false,
      };
    } else if (url.pathname === "/api/explore/token/analytics") {
      const section = url.searchParams.get("section") ?? "summary";
      body = {
        schemaVersion: "programmable.token-analytics.v1",
        status: "unavailable",
        provider: "gmgn",
        analyticsScope: "token",
        poolAttribution: "unavailable",
        section,
        identity: {
          chainId: "1",
          tokenAddress: url.searchParams.get("address"),
          poolId: POOL,
          quoteAddress: NATIVE_CURRENCY_ADDRESS,
          protocol: "uniswap_v4",
        },
        analytics: section === "summary"
          ? { security: null, pool: null }
          : { ranking: null },
      };
    } else if (url.pathname === "/api/explore/profile") {
      body = {
        status: "ready",
        account: CREATOR,
        tokens: [],
        pools: [],
        claims: [],
        totals: { claimableWei: "0" },
      };
    } else {
      throw new Error(`unexpected ${url}`);
    }
    const transformed = applySearchFixture(transform({ body, url }), url);
    const observed = transformed?.marketRead?.observedCount ?? 0;
    const qualified = transformed?.marketRead?.qualifiedCount ?? 0;
    const visibleEntries = Array.isArray(transformed?.tokens)
      ? transformed.tokens
      : [transformed?.token ?? transformed?.customProject].filter(Boolean);
    const marketAsOf = visibleEntries
      .map((token) => token?.valuation?.asOfTime)
      .filter((value) => typeof value === "string")
      .sort()
      .at(-1) ?? null;
    const extraHeaders = {
      ...(transformed?.marketRead?.status
        ? {
            "x-programmable-market-read-status":
              transformed.marketRead.status,
          }
        : {}),
      ...(url.pathname === "/api/explore/token/chart"
        ? {
            "cache-control": "public, max-age=0",
            "x-programmable-data-quality": "unavailable",
            "x-programmable-read-source": "envio-classic-v3+bitquery",
            "x-programmable-market-provider": "bitquery",
            "x-programmable-market-read-status": "cache-fallback",
            "x-programmable-chart-scope": "pool",
            "x-programmable-chart-pool-attribution": "exact",
          }
        : {}),
      ...(url.pathname === "/api/explore/profile"
        ? {
            "x-programmable-launch-source": "envio-classic-v3",
            "x-programmable-read-source": "envio-classic-v3",
            "x-programmable-rpc-provider": "envio-indexer-state",
          }
        : {}),
      ...(url.pathname === "/api/explore" && transformed?.discovery
        ? {
            "x-programmable-discovery-provider": "gmgn",
            "x-programmable-discovery-read-status": transformed.discovery.status,
            "x-programmable-discovery-matched-count":
              String(transformed.discovery.matchedTokenCount),
            "x-programmable-discovery-matched-unique-count":
              String(transformed.discovery.matchedUniqueTokenCount),
            "x-programmable-discovery-ranking-commitment":
              transformed.discovery.rankingCommitment,
          }
        : {}),
      ...(url.pathname === "/api/explore" && transformed?.ranking
        ? {
            "x-programmable-ranking-primary-provider":
              transformed.ranking.primaryProvider,
            "x-programmable-ranking-source": transformed.ranking.source,
            "x-programmable-ranking-read-status": transformed.ranking.status,
            "x-programmable-ranking-gmgn-status":
              transformed.ranking.gmgnStatus,
            "x-programmable-ranking-commitment":
              transformed.ranking.rankingCommitment,
            ...(transformed.ranking.gmgnStatus === "unavailable"
              ? {}
              : {
                  "x-programmable-read-source":
                    "envio-classic-v3+dexscreener+gmgn-ranking",
                }),
          }
        : {}),
      ...(observed > 0
        ? { "x-programmable-market-source": "dexscreener" }
        : {}),
      ...(qualified > 0
        ? { "x-programmable-price-source": "dexscreener" }
        : {}),
      ...(marketAsOf === null
        ? {}
        : { "x-programmable-market-as-of": marketAsOf }),
    };
    const omittedHeaders = url.pathname === "/api/explore/token/chart"
      ? [
          "x-programmable-market-source",
          "x-programmable-price-source",
          "x-programmable-market-as-of",
          "x-programmable-valuation-block",
        ]
      : [];
    const transformedHeaders = transformHeaders({
      extraHeaders,
      omittedHeaders,
      url,
    });
    const search = url.pathname === "/api/explore" ? transformed.search : null;
    if (search !== null && search !== undefined) {
      const read = transformed.marketRead;
      const provider = read.provider === "gmgn"
        ? read.fallbackRequestedCount > 0 ? "gmgn+dexscreener" : "gmgn"
        : "dexscreener";
      const marketSources = read.provider === "gmgn"
        ? [
            ...(read.gmgnObservedCount > 0 ? ["gmgn"] : []),
            ...(read.fallbackObservedCount > 0 ? ["dexscreener"] : []),
          ]
        : read.observedCount > 0 ? ["dexscreener"] : [];
      const priceSources = read.provider === "gmgn"
        ? [
            ...(read.gmgnQualifiedCount > 0 ? ["gmgn"] : []),
            ...(read.fallbackQualifiedCount > 0 ? ["dexscreener"] : []),
          ]
        : read.qualifiedCount > 0 ? ["dexscreener"] : [];
      const launchSource = transformed.catalog.launchSource;
      transformedHeaders.extraHeaders = {
        ...transformedHeaders.extraHeaders,
        "x-programmable-read-source": `${launchSource}+${provider}${
          search.asOfTime === null ? "" : "+gmgn-search"
        }`,
        "x-programmable-market-provider": provider,
        "x-programmable-market-read-status": read.status,
        "x-programmable-search-provider": "gmgn",
        "x-programmable-search-read-status": search.status,
        "x-programmable-search-matched-count":
          String(search.matchedTokenCount),
        "x-programmable-search-matched-unique-count":
          String(search.matchedUniqueTokenCount),
        "x-programmable-search-ranking-commitment":
          search.rankingCommitment,
        ...(marketSources.length === 0
          ? {}
          : { "x-programmable-market-source": marketSources.join("+") }),
        ...(priceSources.length === 0
          ? {}
          : { "x-programmable-price-source": priceSources.join("+") }),
        ...(marketAsOf === null
          ? {}
          : { "x-programmable-market-as-of": marketAsOf }),
      };
      const conditionalHeaders = [
        ["x-programmable-market-source", marketSources.length > 0],
        ["x-programmable-price-source", priceSources.length > 0],
        ["x-programmable-market-as-of", marketAsOf !== null],
      ];
      transformedHeaders.omittedHeaders = [
        ...transformedHeaders.omittedHeaders.filter((name) =>
          !conditionalHeaders.some(([header]) => header === name)
        ),
        ...conditionalHeaders.flatMap(([header, present]) =>
          present ? [] : [header]
        ),
      ];
    }
    return response(
      transformed,
      transformedHeaders.extraHeaders,
      transformedHeaders.omittedHeaders,
    );
  };
}

function gmgnStagedFetch(options = {}) {
  const chartPoolAttribution = options.chartPoolAttribution ?? "unavailable";
  const visibleToken = options.visibleToken ?? gmgnValuedEntry();
  const detailToken = options.detailToken ?? visibleToken;
  const detailReadStatus = options.detailReadStatus ?? "complete";
  const detailProvider = options.detailProvider ?? "gmgn";
  const visibleOldestFetchedAt = options.visibleOldestFetchedAt ?? NOW;
  const visibleNewestFetchedAt = options.visibleNewestFetchedAt ?? NOW;
  const visibleFallbackObservedCount =
    options.visibleFallbackObservedCount ?? 0;
  return stagedFetch(
    ({ body, url }) => {
      if (
        url.pathname === "/api/explore" &&
        url.searchParams.get("sort") === "trending"
      ) {
        if (options.discoveryUnavailable) return body;
        return {
          ...body,
          discovery: {
            ...body.discovery,
            status: "complete",
            applied: "gmgn-ranked-with-launch-order-fallback",
            snapshotCount: 1,
            observedTokenCount: 2,
            matchedTokenCount: 2,
            matchedUniqueTokenCount: 2,
            unobservedCanonicalEntryCount: 0,
            canonicalAddressCoverageBps: 10_000,
            asOfTime: NOW,
          },
        };
      }
      if (
        url.pathname === "/api/explore" &&
        ["market-cap", "market-cap-asc"].includes(
          url.searchParams.get("sort"),
        )
      ) {
        const sort = url.searchParams.get("sort");
        return {
          ...body,
          ranking: sort === "market-cap-asc" && options.ascendingRanking
            ? options.ascendingRanking
            : gmgnMatchedMarketCapRanking(sort, 2),
        };
      }
      if (
        url.pathname === "/api/explore" &&
        url.searchParams.get("sort") === "newest"
      ) {
        const searchUnavailable = options.searchUnavailable &&
            url.searchParams.get("q") !== null
          ? {
              search: searchRanking([visibleToken], {
                status: "unavailable",
                applied: "local-match-order",
                observedTokenCount: 0,
                matchedTokenCount: 0,
                matchedUniqueTokenCount: 0,
                unobservedCanonicalMatchCount: 1,
                canonicalAddressCoverageBps: 0,
                asOfTime: null,
              }),
            }
          : {};
        return {
          ...body,
          ...searchUnavailable,
          tokens: [visibleToken, entry(1)],
          marketRead: {
            provider: "gmgn",
            fallbackProvider: "dexscreener",
            status: "partial",
            currency: "USD",
            requestedCount: 2,
            observedCount: 1 + visibleFallbackObservedCount,
            qualifiedCount: 1,
            unavailableCount: 1,
            gmgnObservedCount: 1,
            gmgnQualifiedCount: 1,
            fallbackRequestedCount: 1,
            fallbackObservedCount: visibleFallbackObservedCount,
            fallbackQualifiedCount: 0,
            oldestFetchedAt: visibleOldestFetchedAt,
            newestFetchedAt: visibleNewestFetchedAt,
          },
          dataQuality: {
            ...body.dataQuality,
            valuation: {
              ...body.dataQuality.valuation,
              status: "provider-recent",
              available: 1,
              unavailable: 1,
              asOfTime: NOW,
            },
          },
        };
      }
      if (url.pathname === "/api/explore/token") {
        if (body.routerTradeProject) return body;
        return { ...body, token: detailToken };
      }
      if (url.pathname === "/api/explore/token/analytics") {
        const section = url.searchParams.get("section") ?? "summary";
        const identity = body.identity;
        if (section !== "summary") {
          const value = {
            ...body,
            status: "ready",
            analytics: {
              ranking: {
                fetchedAt: NOW,
                wallets: [{
                  address: "0x3333333333333333333333333333333333333333",
                  usdValue: 1,
                  amountRatio: 0.1,
                  buyVolumeUsd: null,
                  sellVolumeUsd: 1,
                  profitUsd: 0,
                  profitRatio: 0,
                }],
              },
            },
          };
          return typeof options.mutateGmgnAnalytics === "function"
            ? options.mutateGmgnAnalytics(value, section)
            : value;
        }
        const value = {
          ...body,
          status: "ready",
          analytics: {
            security: {
              schemaVersion: "programmable.gmgn-token-security.v1",
              source: "gmgn", fetchedAt: NOW, identity,
              tokenAddress: identity.tokenAddress,
              isShowAlert: null, isOpenSource: null, isBlacklisted: null,
              isHoneypot: null, isOwnerRenounced: null, isMintRenounced: null,
              isFreezeAccountRenounced: null, isWashTrading: null,
              top10HolderRatio: null, developerTeamHoldRatio: null,
              creatorBalanceRatio: null, suspectedInsiderHoldRatio: null,
              rugRatio: null, ratTraderAmountRatio: null,
              bundlerTraderAmountRatio: null, buyTaxRatio: null,
              sellTaxRatio: null, averageTaxRatio: null, highTaxRatio: null,
              burnRatio: null, developerTokenBurnAmount: null,
              developerTokenBurnRatio: null, burnStatus: null,
              creatorTokenStatus: null, sniperCount: null, canSellCount: null,
              cannotSellCount: null, hideRisk: null, flags: [], lockSummary: null,
            },
            pool: {
              schemaVersion: "programmable.gmgn-token-pool-info.v1",
              source: "gmgn", marketScope: "token",
              poolAttribution: "unavailable", currency: "USD",
              fetchedAt: NOW, identity,
              tokenAddress: identity.tokenAddress,
              providerAddress: identity.tokenAddress,
              baseAddress: identity.tokenAddress,
              quoteAddress: identity.quoteAddress,
              token0Address: identity.quoteAddress,
              token1Address: identity.tokenAddress, quoteSymbol: "ETH",
              exchange: "uniswap_v4", liquidityUsd: "0", baseReserve: "0",
              quoteReserve: "0", baseReserveValueUsd: null,
              quoteReserveValueUsd: null, initialLiquidityUsd: null,
              initialBaseReserve: null, initialQuoteReserve: null,
              priceUsd: null, feeRatio: null, creationTimestamp: 0,
            },
          },
        };
        return typeof options.mutateGmgnAnalytics === "function"
          ? options.mutateGmgnAnalytics(value, section)
          : value;
      }
      if (
        url.pathname === "/api/explore/token/chart" &&
        options.gmgnChart !== false
      ) {
        const identity = {
          chainId: "1",
          tokenAddress: url.searchParams.get("address"),
          poolId: POOL,
          quoteAddress: "0x0000000000000000000000000000000000000000",
          protocol: "uniswap_v4",
        };
        const chart = {
          schemaVersion: "programmable.gmgn-market-chart.v1",
          source: "gmgn",
          seriesScope: "token",
          poolAttribution: chartPoolAttribution,
          readStatus: "live",
          status: "ready",
          generatedAt: NOW,
          identity,
          identityProof: {
            schemaVersion: "programmable.gmgn-chart-identity-proof.v1",
            source: "gmgn-token-info",
            verifiedAt: NOW,
            identity,
            poolAttribution: chartPoolAttribution,
            canonicalSupply: {
              totalSupplyRaw: (1_000_000n * 10n ** 18n).toString(),
              tokenDecimals: 18,
            },
          },
          range: "1d",
          resolution: "15m",
          requestedFrom: "2026-08-31T12:00:00.000Z",
          requestedTo: NOW,
          points: [{
            time: NOW,
            bucketStart: "2026-09-01T11:45:00.000Z",
            bucketEnd: NOW,
            valueSemantics: "period-close",
            priceUsd: "1",
            ohlcUsd: { open: "1", high: "1", low: "1", close: "1" },
            volumeUsdWad: "0",
          }],
          candleCount: 1,
          volumeUsdWad: "0",
          asOfTime: NOW,
          truncated: false,
        };
        return typeof options.mutateGmgnChart === "function"
          ? options.mutateGmgnChart(chart)
          : chart;
      }
      return body;
    },
    ({ extraHeaders, omittedHeaders, url }) => {
      const newest = url.pathname === "/api/explore" &&
        url.searchParams.get("sort") === "newest";
      const trending = url.pathname === "/api/explore" &&
        url.searchParams.get("sort") === "trending";
      const detail = url.pathname === "/api/explore/token";
      const analytics = url.pathname === "/api/explore/token/analytics";
      const chart = url.pathname === "/api/explore/token/chart" &&
        options.gmgnChart !== false;
      if (chart) {
        return {
          extraHeaders: {
            ...extraHeaders,
            "cache-control": "public, max-age=0",
            "x-programmable-data-quality": "current",
            "x-programmable-read-source": "envio-classic-v3+gmgn",
            "x-programmable-market-provider": "gmgn",
            "x-programmable-market-read-status": "live",
            "x-programmable-chart-scope": "token",
            "x-programmable-chart-pool-attribution": chartPoolAttribution,
            "x-programmable-market-source": "gmgn",
            "x-programmable-price-source": "gmgn",
            "x-programmable-market-as-of": NOW,
          },
          omittedHeaders: omittedHeaders.filter((name) => ![
            "x-programmable-market-source",
            "x-programmable-price-source",
            "x-programmable-market-as-of",
          ].includes(name)),
        };
      }
      if (analytics) {
        const section = url.searchParams.get("section") ?? "summary";
        return {
          extraHeaders: {
            ...extraHeaders,
            "cache-control": section === "summary"
              ? "public, max-age=0"
              : "private, max-age=0, no-store",
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer",
            "x-programmable-chain-id": "1",
            "x-programmable-canonical-read-status": "last-known-good",
            "x-programmable-router-read-status": "unavailable",
            "x-programmable-read-source": "envio-classic-v3+gmgn",
            "x-programmable-analytics-provider": "gmgn",
            "x-programmable-analytics-scope": "token",
            "x-programmable-analytics-pool-attribution": "unavailable",
            "x-programmable-analytics-read-status": "ready",
            "x-programmable-market-provider": "gmgn",
            "x-programmable-market-read-status": "complete",
            "x-programmable-data-quality": "current",
            "x-programmable-market-source": "gmgn",
          },
          omittedHeaders: [
            ...omittedHeaders,
            "x-programmable-price-source",
            "x-programmable-market-as-of",
            "x-programmable-valuation-block",
          ],
        };
      }
      if (trending) {
        if (options.discoveryUnavailable) {
          return { extraHeaders, omittedHeaders };
        }
        return {
          extraHeaders: {
            ...extraHeaders,
            "x-programmable-read-source":
              "envio-classic-v3+dexscreener+gmgn-discovery",
          },
          omittedHeaders,
        };
      }
      if (!newest && !detail) return { extraHeaders, omittedHeaders };
      const provider = newest ? "gmgn+dexscreener" : detailProvider;
      const detailUsesGmgn = newest || detailProvider === "gmgn";
      return {
        extraHeaders: {
          ...extraHeaders,
          "x-programmable-read-source": `envio-classic-v3+${provider}`,
          "x-programmable-market-provider": provider,
          "x-programmable-market-read-status": newest
            ? "partial"
            : detailReadStatus,
          ...(detailUsesGmgn
            ? {
                "x-programmable-market-source": newest &&
                    visibleFallbackObservedCount > 0
                  ? "gmgn+dexscreener"
                  : "gmgn",
                "x-programmable-price-source": "gmgn",
              }
            : {}),
          "x-programmable-market-as-of": NOW,
        },
        omittedHeaders: detailUsesGmgn
          ? omittedHeaders
          : [
              ...omittedHeaders,
              "x-programmable-market-source",
              "x-programmable-price-source",
              "x-programmable-market-as-of",
            ],
      };
    },
  );
}

function pagedGmgnStagedFetch({
  entryCount = 10,
  gmgnPage = 2,
  marketCapProof = false,
  marketCapObservedFallback = false,
  gmgnLiquidityUsdWad,
} = {}) {
  const allEntries = Array.from({ length: entryCount }, (_, index) => entry(index));
  const qualifiedIndex = marketCapProof
    ? 0
    : (gmgnPage - 1) * 9;
  const qualifiedBase = allEntries[qualifiedIndex] ?? allEntries[0];
  const qualifiedGmgn = gmgnValuedEntry(qualifiedBase);
  if (gmgnLiquidityUsdWad !== undefined) {
    qualifiedGmgn.gmgnMarketData = {
      ...qualifiedGmgn.gmgnMarketData,
      liquidityUsdWad: gmgnLiquidityUsdWad,
    };
  }
  const pagedTransform = pagedCatalogTransform(allEntries);
  const pagedFetch = stagedFetch(
    (input) => {
      const { url } = input;
      const transformed = pagedTransform(input);
      if (url.pathname === "/api/explore") {
        const sort = url.searchParams.get("sort");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        if (sort === "trending") {
          return {
            ...transformed,
            discovery: {
              ...transformed.discovery,
              status: "partial",
              applied: "gmgn-ranked-with-launch-order-fallback",
              snapshotCount: 1,
              observedTokenCount: 1,
              matchedTokenCount: 1,
              matchedUniqueTokenCount: 1,
              unobservedCanonicalEntryCount: entryCount - 1,
              canonicalAddressCoverageBps: Math.floor(10_000 / entryCount),
              asOfTime: NOW,
            },
          };
        }
        if (sort === "market-cap-asc") {
          return {
            ...transformed,
            ranking: gmgnMatchedMarketCapRanking(sort, entryCount),
          };
        }
        if (
          sort === "market-cap" &&
          !marketCapProof &&
          !marketCapObservedFallback
        ) {
          return {
            ...transformed,
            ranking: gmgnMatchedMarketCapRanking(sort, entryCount),
          };
        }
        if (
          sort === "market-cap" &&
          (marketCapProof || marketCapObservedFallback)
        ) {
          const ranking = gmgnMatchedMarketCapRanking(sort, entryCount, {
            fallbackQualifiedCount: marketCapObservedFallback ? 1 : 0,
          });
          if (page !== 1) return { ...transformed, ranking };
          const tokens = [...transformed.tokens];
          tokens[0] = marketCapProof
            ? qualifiedGmgn
            : dexscreenerValuedEntry(allEntries[0]);
          const visibleCount = tokens.length;
          return {
            ...transformed,
            tokens,
            marketRead: marketCapProof
              ? {
                  provider: "gmgn",
                  fallbackProvider: "dexscreener",
                  status: visibleCount === 1 ? "complete" : "partial",
                  currency: "USD",
                  requestedCount: visibleCount,
                  observedCount: 1,
                  qualifiedCount: 1,
                  unavailableCount: visibleCount - 1,
                  gmgnObservedCount: 1,
                  gmgnQualifiedCount: 1,
                  fallbackRequestedCount: visibleCount - 1,
                  fallbackObservedCount: 0,
                  fallbackQualifiedCount: 0,
                  oldestFetchedAt: NOW,
                  newestFetchedAt: NOW,
                }
              : {
                  ...marketRead(visibleCount),
                  status: "partial",
                  observedCount: 1,
                  qualifiedCount: 1,
                  unavailableCount: visibleCount - 1,
                  oldestFetchedAt: NOW,
                  newestFetchedAt: NOW,
                },
            ranking,
            dataQuality: {
              ...transformed.dataQuality,
              valuation: {
                ...transformed.dataQuality.valuation,
                status: "provider-recent",
                available: 1,
                unavailable: visibleCount - 1,
                asOfTime: NOW,
              },
            },
          };
        }
        if (sort === "newest" && pageSize === 9) {
          const pageHasGmgn = !marketCapProof && page === gmgnPage;
          const tokens = transformed.tokens.map((token) =>
            pageHasGmgn && token.tokenAddress === qualifiedBase.tokenAddress
              ? qualifiedGmgn
              : token
          );
          const qualifiedCount = pageHasGmgn ? 1 : 0;
          const fallbackRequestedCount = tokens.length - qualifiedCount;
          return {
            ...transformed,
            tokens,
            marketRead: {
              provider: "gmgn",
              fallbackProvider: "dexscreener",
              status: qualifiedCount === 0
                ? "unavailable"
                : fallbackRequestedCount === 0
                  ? "complete"
                  : "partial",
              currency: "USD",
              requestedCount: tokens.length,
              observedCount: qualifiedCount,
              qualifiedCount,
              unavailableCount: tokens.length - qualifiedCount,
              gmgnObservedCount: qualifiedCount,
              gmgnQualifiedCount: qualifiedCount,
              fallbackRequestedCount,
              fallbackObservedCount: 0,
              fallbackQualifiedCount: 0,
              oldestFetchedAt: qualifiedCount > 0 ? NOW : null,
              newestFetchedAt: qualifiedCount > 0 ? NOW : null,
            },
            dataQuality: {
              ...transformed.dataQuality,
              valuation: {
                ...transformed.dataQuality.valuation,
                status: qualifiedCount > 0
                  ? "provider-recent"
                  : "unavailable",
                available: qualifiedCount,
                unavailable: tokens.length - qualifiedCount,
                asOfTime: qualifiedCount > 0 ? NOW : null,
              },
            },
          };
        }
        return transformed;
      }
      if (url.pathname === "/api/explore/token") {
        const address = url.searchParams.get("address")?.toLowerCase();
        const token = address === qualifiedBase.tokenAddress.toLowerCase()
          ? qualifiedGmgn
          : allEntries.find((candidate) =>
              candidate.tokenAddress.toLowerCase() === address
            ) ?? transformed.token;
        return { ...transformed, token };
      }
      if (url.pathname === "/api/explore/token/chart") {
        return {
          ...transformed,
          identity: {
            ...transformed.identity,
            poolId: qualifiedBase.poolId,
          },
        };
      }
      return transformed;
    },
    ({ extraHeaders, omittedHeaders, url }) => {
      const sort = url.searchParams.get("sort");
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("limit"));
      if (url.pathname === "/api/explore" && sort === "trending") {
        return {
          extraHeaders: {
            ...extraHeaders,
            "x-programmable-read-source":
              "envio-classic-v3+dexscreener+gmgn-discovery",
          },
          omittedHeaders,
        };
      }
      if (
        url.pathname === "/api/explore" &&
        sort === "market-cap" &&
        marketCapProof &&
        page === 1
      ) {
        const visibleCount = Math.min(pageSize, entryCount);
        const provider = visibleCount > 1 ? "gmgn+dexscreener" : "gmgn";
        return {
          extraHeaders: {
            ...extraHeaders,
            "x-programmable-read-source":
              `envio-classic-v3+${provider}+gmgn-ranking`,
            "x-programmable-market-provider": provider,
            "x-programmable-market-read-status": visibleCount > 1
              ? "partial"
              : "complete",
            "x-programmable-market-source": "gmgn",
            "x-programmable-price-source": "gmgn",
            "x-programmable-market-as-of": NOW,
          },
          omittedHeaders,
        };
      }
      if (
        url.pathname === "/api/explore" &&
        sort === "newest" &&
        pageSize === 9
      ) {
        const pageHasGmgn = !marketCapProof && page === gmgnPage;
        const pageTokenCount = Math.min(
          pageSize,
          Math.max(0, entryCount - (page - 1) * pageSize),
        );
        const fallbackRequestedCount = pageTokenCount - (pageHasGmgn ? 1 : 0);
        const provider = fallbackRequestedCount > 0
          ? "gmgn+dexscreener"
          : "gmgn";
        return {
          extraHeaders: {
            ...extraHeaders,
            "x-programmable-read-source": `envio-classic-v3+${provider}`,
            "x-programmable-market-provider": provider,
            "x-programmable-market-read-status": pageHasGmgn
              ? fallbackRequestedCount === 0 ? "complete" : "partial"
              : "unavailable",
            ...(pageHasGmgn
              ? {
                  "x-programmable-market-source": "gmgn",
                  "x-programmable-price-source": "gmgn",
                  "x-programmable-market-as-of": NOW,
                }
              : {}),
          },
          omittedHeaders: pageHasGmgn
            ? omittedHeaders
            : [
                ...omittedHeaders,
                "x-programmable-market-source",
                "x-programmable-price-source",
                "x-programmable-market-as-of",
              ],
        };
      }
      const detailAddress = url.pathname === "/api/explore/token"
        ? url.searchParams.get("address")?.toLowerCase()
        : null;
      if (
        marketCapObservedFallback &&
        detailAddress === allEntries[0].tokenAddress.toLowerCase()
      ) {
        return {
          extraHeaders: {
            ...extraHeaders,
            "x-programmable-market-read-status": "partial",
            "x-programmable-market-source": "dexscreener",
          },
          omittedHeaders: [
            ...omittedHeaders,
            "x-programmable-price-source",
            "x-programmable-market-as-of",
          ],
        };
      }
      if (detailAddress === qualifiedBase.tokenAddress.toLowerCase()) {
        return {
          extraHeaders: {
            ...extraHeaders,
            "x-programmable-read-source": "envio-classic-v3+gmgn",
            "x-programmable-market-provider": "gmgn",
            "x-programmable-market-read-status": "complete",
            "x-programmable-market-source": "gmgn",
            "x-programmable-price-source": "gmgn",
            "x-programmable-market-as-of": NOW,
          },
          omittedHeaders,
        };
      }
      return { extraHeaders, omittedHeaders };
    },
  );
  const analyticsFetch = gmgnStagedFetch();
  return async (url) => {
    if (url.pathname === "/api/explore/token/chart") {
      const generated = await analyticsFetch(url);
      const body = await generated.json();
      const identity = { ...body.identity, poolId: qualifiedBase.poolId };
      return new Response(JSON.stringify({
        ...body,
        identity,
        identityProof: {
          ...body.identityProof,
          identity,
        },
      }), { status: generated.status, headers: generated.headers });
    }
    if (url.pathname !== "/api/explore/token/analytics") {
      return pagedFetch(url);
    }
    const generated = await analyticsFetch(url);
    const body = await generated.json();
    const identity = {
      ...body.identity,
      tokenAddress: url.searchParams.get("address"),
      poolId: qualifiedBase.poolId,
    };
    const analytics = body.section === "summary"
      ? {
          security: {
            ...body.analytics.security,
            identity,
            tokenAddress: identity.tokenAddress,
          },
          pool: {
            ...body.analytics.pool,
            identity,
            tokenAddress: identity.tokenAddress,
            providerAddress: identity.tokenAddress,
            baseAddress: identity.tokenAddress,
            token0Address: identity.quoteAddress,
            token1Address: identity.tokenAddress,
          },
        }
      : body.analytics;
    return new Response(JSON.stringify({ ...body, identity, analytics }), {
      status: generated.status,
      headers: generated.headers,
    });
  };
}

function classicV4StagedFetch({
  token = classicV4Entry(),
  classicV4Bound = true,
  includeClassicV4Identity = true,
  scopeIncluded,
} = {}) {
  const selectedToken = includeClassicV4Identity ? token : entry(0);
  const included = scopeIncluded ?? [
    "classic-v3",
    ...(classicV4Bound ? ["classic-v4"] : []),
    "official-main-token",
    "registry.custom-launched",
  ];
  return stagedFetch(({ body, url }) => {
    if (url.pathname === "/api/explore") {
      return {
        ...body,
        tokens: [selectedToken, entry(1)],
        catalog: {
          ...body.catalog,
          scope: {
            ...body.catalog.scope,
            included,
          },
        },
      };
    }
    if (url.pathname === "/api/explore/token") {
      return {
        ...body,
        token: selectedToken,
        catalog: {
          ...body.catalog,
          scope: {
            ...body.catalog.scope,
            included,
          },
        },
      };
    }
    return body;
  });
}

function routerCustomStagedFetch(
  mutate = (value) => value,
  {
    registryCustomStatus = "unavailable",
    routerCustomStatus = "current",
    routerHeaderStatus = routerCustomStatus,
  } = {},
) {
  const routerCustomAvailable =
    routerCustomStatus === "current" ||
    routerCustomStatus === "last-known-good";
  const launchSource = [
    "envio-classic-v3",
    ...(registryCustomStatus === "current"
      ? ["registry.custom-launched"]
      : []),
    ...(routerCustomAvailable
      ? ["canonical-launch-stamp-router"]
      : []),
  ].join("+");
  const customStatus =
    registryCustomStatus === "current" && routerCustomStatus === "current"
      ? "current"
      : registryCustomStatus === "current" &&
          routerCustomStatus === "last-known-good"
        ? "last-known-good"
        : "unavailable";
  return stagedFetch(
    ({ body, url }) => {
      if (url.pathname === "/api/explore") {
        return {
          ...body,
          tokens: [mutate(routerCustomEntry()), entry(1)],
          dataQuality: {
            ...body.dataQuality,
            launchIdentity: {
              ...body.dataQuality.launchIdentity,
              status: customStatus === "last-known-good"
                ? "last-known-good"
                : body.dataQuality.launchIdentity.status,
              custom: customStatus,
            },
          },
          catalog: {
            ...body.catalog,
            launchSource,
            completeness: {
              ...body.catalog.completeness,
              custom: customStatus,
              registryCustom: registryCustomStatus,
              routerCustom: routerCustomStatus,
            },
            scope: {
              ...body.catalog.scope,
              included: [
                ...body.catalog.scope.included,
                "canonical-launch-stamp-router",
              ],
            },
          },
        };
      }
      if (url.pathname === "/api/explore/token") {
        return {
          ...body,
          token: mutate(routerCustomEntry()),
          catalog: {
            ...body.catalog,
            launchSource,
            completeness: {
              ...body.catalog.completeness,
              custom: customStatus,
              registryCustom: registryCustomStatus,
              routerCustom: routerCustomStatus,
            },
            scope: {
              ...body.catalog.scope,
              included: [
                ...body.catalog.scope.included,
                "canonical-launch-stamp-router",
              ],
            },
          },
        };
      }
      return body;
    },
    ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: [
        "/api/explore",
        "/api/explore/token",
        "/api/explore/token/chart",
      ].includes(url.pathname)
        ? {
            ...extraHeaders,
            "x-programmable-launch-source": launchSource,
            "x-programmable-read-source": url.pathname.endsWith("/chart")
              ? `${launchSource}+bitquery`
              : `${launchSource}+dexscreener`,
            "x-programmable-router-read-status": routerHeaderStatus,
          }
        : extraHeaders,
      omittedHeaders,
    }),
  );
}

function pagedCatalogTransform(allEntries, options = {}) {
  return ({ body, url }) => {
    if (url.pathname === "/api/explore") {
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("limit"));
      const sort = url.searchParams.get("sort");
      const marketCapSort = sort === "market-cap" ||
        sort === "market-cap-asc";
      const tokens = allEntries.slice(
        (page - 1) * pageSize,
        page * pageSize,
      );
      if (options.phantomNewest && sort === "newest" && pageSize === 9) {
        tokens[0] = entry(98);
      }
      if (options.phantomHighest && sort === "market-cap") {
        tokens[0] = {
          ...entry(99),
          valuation: {
            status: "available",
            metric: "fdv",
            supplyBasis: "total",
            currency: "usd",
            freshness: "provider-recent",
            source: "dexscreener",
            valueWad: "1000000000000000000",
            asOfTime: NOW,
          },
          fdvUsdWad: "1000000000000000000",
        };
      }
      if (options.duplicateHighest && sort === "market-cap") {
        for (let index = 0; index < tokens.length; index += 1) {
          tokens[index] = {
            ...tokens[index],
            valuation: {
              status: "available",
              metric: "fdv",
              supplyBasis: "total",
              currency: "usd",
              freshness: "provider-recent",
              source: "dexscreener",
              valueWad: String(1_000 - index),
              asOfTime: NOW,
            },
            fdvUsdWad: String(1_000 - index),
          };
        }
        tokens[1] = tokens[0];
      }
      const rankingQualifiedCount = options.duplicateHighest &&
          sort === "market-cap"
        ? allEntries.length
        : options.phantomHighest && sort === "market-cap"
          ? 1
          : 0;
      const visibleQualifiedCount = options.duplicateHighest &&
          sort === "market-cap"
        ? tokens.length
        : rankingQualifiedCount;
      const requestedCount = tokens.length;
      return {
        ...body,
        tokens,
        page,
        pageSize,
        total: allEntries.length,
        totalPages: Math.ceil(allEntries.length / pageSize),
        marketRead: {
          ...marketRead(requestedCount),
          ...(visibleQualifiedCount === 0
            ? {}
            : {
                status: "complete",
                observedCount: visibleQualifiedCount,
                qualifiedCount: visibleQualifiedCount,
                unavailableCount: requestedCount - visibleQualifiedCount,
                oldestFetchedAt: NOW,
                newestFetchedAt: NOW,
              }),
        },
        dataQuality: {
          ...body.dataQuality,
          valuation: {
            ...body.dataQuality.valuation,
            ...(visibleQualifiedCount === 0
              ? {}
              : {
                  status: "provider-recent",
                  available: visibleQualifiedCount,
                  unavailable: tokens.length - visibleQualifiedCount,
                  asOfTime: NOW,
                }),
          },
        },
        catalog: {
          ...body.catalog,
          identityCount: allEntries.length,
        },
        ...(sort === "trending"
          ? {
              sortMetric: "gmgn-trending",
              discovery: {
                ...body.discovery,
                canonicalEntryCount: allEntries.length,
                canonicalTokenCount: allEntries.length,
                unobservedCanonicalEntryCount: allEntries.length,
              },
            }
          : {}),
        ...(marketCapSort
          ? {
              ranking: rankingQualifiedCount === 0
                ? marketCapRanking(sort, allEntries.length)
                : marketCapRanking(sort, allEntries.length, {
                    source: "dexscreener",
                    status: rankingQualifiedCount === allEntries.length
                      ? "complete"
                      : "partial",
                    applied: rankingQualifiedCount === allEntries.length
                      ? "fdv"
                      : "qualified-fdv-then-launch-order",
                    fallbackQualifiedCount: rankingQualifiedCount,
                    qualifiedCount: rankingQualifiedCount,
                  }),
            }
          : { ranking: undefined }),
      };
    }
    if (url.pathname === "/api/explore/token") {
      return {
        ...body,
        catalog: {
          ...body.catalog,
          identityCount: allEntries.length,
        },
      };
    }
    return body;
  };
}

function liveTrendingDiscovery(
  discovery,
  totalCount,
  asOfTime,
  rankingCommitment = discovery.rankingCommitment,
) {
  return {
    ...discovery,
    rankingCommitment,
    status: "partial",
    applied: "gmgn-ranked-with-launch-order-fallback",
    snapshotCount: 1,
    observedTokenCount: 1,
    matchedTokenCount: 1,
    matchedUniqueTokenCount: 1,
    canonicalEntryCount: totalCount,
    canonicalTokenCount: totalCount,
    unobservedCanonicalEntryCount: totalCount - 1,
    canonicalAddressCoverageBps: Math.floor(10_000 / totalCount),
    foreignTokenCount: 0,
    discardedProviderItemCount: 0,
    asOfTime,
  };
}

function liveTrendingHeaders({ extraHeaders, omittedHeaders, url }) {
  return url.pathname === "/api/explore" &&
      url.searchParams.get("sort") === "trending"
    ? {
        extraHeaders: {
          ...extraHeaders,
          "x-programmable-read-source":
            "envio-classic-v3+dexscreener+gmgn-discovery",
        },
        omittedHeaders,
      }
    : { extraHeaders, omittedHeaders };
}

test("staged smoke accepts identity-only Explore and token responses", async () => {
  const output = [];
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "false",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(),
    appendOutput: (...args) => output.push(args),
  });
  assert.equal(result.marketProvider, "dexscreener");
  assert.equal(result.detailMarketProvider, "dexscreener");
  assert.equal(result.marketReadStatus, "unavailable");
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
  assert.equal(result.searchStatus, "complete");
  assert.equal(result.searchMatchedCount, 1);
  assert.equal(output.length, 1);
  assert.match(output[0][1], /gmgn_account_gate_mode=multiflight-v1/u);
  assert.match(output[0][1], /gmgn_requests_per_second=20/u);
  assert.match(output[0][1], /market_provider=dexscreener/u);
  assert.match(output[0][1], /market_read_status=unavailable/u);
  assert.match(output[0][1], /detail_market_provider=dexscreener/u);
  assert.match(output[0][1], /search_status=complete/u);
  assert.match(output[0][1], /search_matched_count=1/u);
  assert.match(output[0][1], /search_ranking_commitment=sha256:[0-9a-f]{64}/u);
});

test("staged smoke counts duplicate-address canonical matches once for discovery coverage", async () => {
  const first = entry(0);
  const second = { ...entry(1), tokenAddress: first.tokenAddress };
  const makeFetch = (observedTokenCount) => stagedFetch(
    ({ body, url }) => {
      if (url.pathname === "/api/explore") {
        const tokens = [first, second];
        const sort = url.searchParams.get("sort");
        return {
          ...body,
          tokens,
          ...(sort === "market-cap" || sort === "market-cap-asc"
            ? {
                ranking: {
                  ...body.ranking,
                  canonicalTokenCount: 1,
                },
              }
            : {}),
          ...(sort === "trending"
            ? {
                discovery: {
                  ...body.discovery,
                  status: "complete",
                  applied: "gmgn-ranked-with-launch-order-fallback",
                  snapshotCount: 1,
                  observedTokenCount,
                  matchedTokenCount: 2,
                  matchedUniqueTokenCount: 1,
                  canonicalTokenCount: 1,
                  unobservedCanonicalEntryCount: 0,
                  canonicalAddressCoverageBps: 10_000,
                  asOfTime: NOW,
                },
              }
            : {}),
        };
      }
      if (url.pathname === "/api/explore/token") {
        return { ...body, token: first };
      }
      return body;
    },
    ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: url.pathname === "/api/explore" &&
          url.searchParams.get("sort") === "trending"
        ? {
            ...extraHeaders,
            "x-programmable-read-source":
              "envio-classic-v3+dexscreener+gmgn-discovery",
          }
        : extraHeaders,
      omittedHeaders,
    }),
  );
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "false",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: makeFetch(1),
    appendOutput: () => {},
  });
  assert.equal(result.discoveryMatchedCount, 2);
  assert.equal(result.discoveryStatus, "complete");
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "false",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: makeFetch(2),
      appendOutput: () => {},
    }),
    /canonical prefix or stable tail is invalid/u,
  );
});

test("staged smoke accepts an exact detail observation without a qualified valuation", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "false",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(
      undefined,
      ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore/token"
          ? {
              ...extraHeaders,
              "x-programmable-market-read-status": "complete",
              "x-programmable-market-source": "dexscreener",
            }
          : extraHeaders,
        omittedHeaders,
      }),
    ),
    appendOutput: () => undefined,
  });

  assert.equal(result.detailMarketProvider, "dexscreener");
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke accepts a partial Dex observation below the liquidity gate", async () => {
  const observedButUnqualified = {
    ...entry(0),
    valuation: {
      status: "unavailable",
      reason: "liquidity-unavailable",
    },
  };
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "false",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(
      ({ body, url }) => url.pathname === "/api/explore/token"
        ? { ...body, token: observedButUnqualified }
        : body,
      ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore/token"
          ? {
              ...extraHeaders,
              "x-programmable-market-read-status": "partial",
              "x-programmable-market-source": "dexscreener",
            }
          : extraHeaders,
        omittedHeaders: url.pathname === "/api/explore/token"
          ? [...omittedHeaders, "x-programmable-price-source"]
          : omittedHeaders,
      }),
    ),
    appendOutput: () => undefined,
  });

  assert.equal(result.detailMarketProvider, "dexscreener");
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke rejects a detail observation outside the selected provider", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "false",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(
        undefined,
        ({ extraHeaders, omittedHeaders, url }) => ({
          extraHeaders: url.pathname === "/api/explore/token"
            ? {
                ...extraHeaders,
                "x-programmable-market-read-status": "complete",
                "x-programmable-market-source": "gmgn",
              }
            : extraHeaders,
          omittedHeaders,
        }),
      ),
      appendOutput: () => undefined,
    }),
    /Token detail identity or market contract is invalid/u,
  );
});

test("staged smoke rejects a detail observation on an unavailable market read", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "false",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(
        undefined,
        ({ extraHeaders, omittedHeaders, url }) => ({
          extraHeaders: url.pathname === "/api/explore/token"
            ? {
                ...extraHeaders,
                "x-programmable-market-read-status": "unavailable",
                "x-programmable-market-source": "dexscreener",
              }
            : extraHeaders,
          omittedHeaders,
        }),
      ),
      appendOutput: () => undefined,
    }),
    /Token detail identity or market contract is invalid/u,
  );
});

test("staged smoke reports GMGN visible and detail providers dynamically", async () => {
  const output = [];
  const requests = [];
  const gmgnToken = gmgnValuedEntry();
  const fetchImpl = gmgnStagedFetch({ visibleToken: gmgnToken });
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: (url, init) => {
      requests.push(new URL(String(url)));
      return fetchImpl(url, init);
    },
    appendOutput: (...args) => output.push(args),
  });

  assert.equal(result.marketProvider, "gmgn+dexscreener");
  assert.equal(result.detailMarketProvider, "gmgn");
  assert.equal(result.marketReadStatus, "partial");
  assert.equal(result.detailStatus, "verified-gmgn-market");
  assert.equal(result.gmgnAccountGateMode, "multiflight-v1");
  assert.equal(result.gmgnRequestsPerSecond, 20);
  assert.match(output[0][1], /gmgn_account_gate_mode=multiflight-v1/u);
  assert.match(output[0][1], /gmgn_requests_per_second=20/u);
  assert.match(output[0][1], /market_provider=gmgn\+dexscreener/u);
  assert.match(output[0][1], /detail_market_provider=gmgn/u);
  assert.match(output[0][1], /detail_status=verified-gmgn-market/u);
  assert.ok(requests.some((url) =>
    url.pathname === "/api/explore" &&
    url.searchParams.get("limit") === "9" &&
    url.searchParams.get("sort") === "newest" &&
    url.searchParams.get("model") === null
  ));
  assert.equal(requests.some((url) =>
    url.pathname === "/api/explore" &&
    url.searchParams.get("limit") === "9" &&
    url.searchParams.get("sort") === "newest" &&
    url.searchParams.get("model") === "classic"
  ), false);
});

test("staged smoke binds an observed unqualified fallback to GMGN market sources", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: gmgnStagedFetch({ visibleFallbackObservedCount: 1 }),
    appendOutput: () => undefined,
  });

  assert.equal(result.marketProvider, "gmgn+dexscreener");
  assert.equal(result.marketReadStatus, "partial");
  assert.equal(result.detailMarketProvider, "gmgn");
});

test("staged smoke rejects malformed public GMGN analytics projections", async () => {
  const cases = [
    (value, section) => section === "summary"
      ? {
          ...value,
          status: "partial",
          analytics: { ...value.analytics, pool: null },
        }
      : value,
    (value, section) => section === "summary"
      ? {
          ...value,
          analytics: {
            ...value.analytics,
            security: {
              ...value.analytics.security,
              lockSummary: {
                isLocked: true,
                lockRatio: "1",
                remainingLockRatio: "1",
                details: [{
                  ratio: "1",
                  poolAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                  isBlackhole: false,
                }],
              },
            },
          },
        }
      : value,
    (value, section) => section === "summary"
      ? {
          ...value,
          analytics: {
            ...value.analytics,
            security: { ...value.analytics.security, isHoneypot: "false" },
          },
        }
      : value,
    (value, section) => section === "summary"
      ? {
          ...value,
          analytics: {
            ...value.analytics,
            pool: { ...value.analytics.pool, exchange: "uniswap_v3" },
          },
        }
      : value,
    (value, section) => section === "summary"
      ? {
          ...value,
          analytics: {
            ...value.analytics,
            pool: {
              ...value.analytics.pool,
              token0Address: value.analytics.pool.tokenAddress,
            },
          },
        }
      : value,
    (value, section) => section === "holders"
      ? {
          ...value,
          analytics: {
            ranking: {
              ...value.analytics.ranking,
              wallets: [{
                ...value.analytics.ranking.wallets[0],
                address: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
              }],
            },
          },
        }
      : value,
  ];
  for (const mutateGmgnAnalytics of cases) {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: gmgnStagedFetch({ mutateGmgnAnalytics }),
        appendOutput: () => {},
      }),
      /GMGN (?:summary analytics (?:envelope|projection)|holders ranking projection) is invalid/u,
    );
  }
});

test("staged smoke requires live GMGN discovery when GMGN is release-required", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({ discoveryUnavailable: true }),
      appendOutput: () => {},
    }),
    /GMGN Trending discovery is required/u,
  );
});

test("staged smoke requires a live canonical GMGN search match in required mode", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({ searchUnavailable: true }),
      appendOutput: () => {},
    }),
    /GMGN canonical search match is required/u,
  );
});

test("staged smoke rejects a foreign-only descending GMGN market-cap rank", async () => {
  const foreignOnly = (sort, totalCount) => marketCapRanking(sort, totalCount, {
    observedTokenCount: 1,
    foreignTokenCount: 1,
    asOfTime: NOW,
  });
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) => {
        if (url.pathname !== "/api/explore") return body;
        const sort = url.searchParams.get("sort");
        if (sort !== "market-cap" && sort !== "market-cap-asc") return body;
        return {
          ...body,
          ranking: sort === "market-cap"
            ? foreignOnly(sort, body.total)
            : gmgnMatchedMarketCapRanking(sort, body.total),
        };
      }),
      appendOutput: () => undefined,
    }),
    /GMGN descending market-cap rank match is required/u,
  );
});

test("staged smoke accepts a live foreign-only ascending GMGN bottom rank", async () => {
  const output = [];
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: gmgnStagedFetch({
      ascendingRanking: marketCapRanking("market-cap-asc", 2, {
        observedTokenCount: 2,
        foreignTokenCount: 2,
        asOfTime: NOW,
      }),
    }),
    appendOutput: (...args) => output.push(args),
  });

  assert.equal(result.marketCapAscMatchedCount, 0);
  assert.equal(result.marketCapAscGmgnStatus, "unavailable");
  assert.match(output[0][1], /market_cap_asc_gmgn_status=unavailable/u);
});

test("staged smoke rejects a stale foreign-only ascending GMGN bottom rank", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({
        ascendingRanking: marketCapRanking("market-cap-asc", 2, {
          observedTokenCount: 2,
          foreignTokenCount: 2,
          asOfTime: new Date(
            Date.parse(NOW) - 5 * 60_000 - 1,
          ).toISOString(),
        }),
      }),
      appendOutput: () => undefined,
    }),
    /Lowest market-cap ranking contract is invalid/u,
  );
});

test("staged smoke rejects an unavailable ascending GMGN market-cap read", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({
        ascendingRanking: marketCapRanking("market-cap-asc", 2),
      }),
      appendOutput: () => undefined,
    }),
    /GMGN ascending market-cap liveness is required/u,
  );
});

test("staged smoke accepts a token-address GMGN-primary chart", async () => {
  const output = [];
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: gmgnStagedFetch({ gmgnChart: true }),
    appendOutput: (...args) => output.push(args),
  });

  assert.equal(result.chartProvider, "gmgn");
  assert.equal(result.chartScope, "token");
  assert.equal(result.chartPoolAttribution, "unavailable");
  assert.equal(result.chartStatus, "ready");
  assert.match(output[0][1], /chart_provider=gmgn/u);
  assert.match(output[0][1], /chart_scope=token/u);
  assert.match(output[0][1], /chart_pool_attribution=unavailable/u);
  assert.match(output[0][1], /chart_status=ready/u);
});

test("staged smoke accepts exact current PoolId attribution on a token-address GMGN chart", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: gmgnStagedFetch({
      gmgnChart: true,
      chartPoolAttribution: "exact",
    }),
    appendOutput: () => undefined,
  });

  assert.equal(result.chartProvider, "gmgn");
  assert.equal(result.chartScope, "token");
  assert.equal(result.chartPoolAttribution, "exact");
});

test("staged smoke rejects Bitquery chart fallback when GMGN is release-required", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({ gmgnChart: false }),
      appendOutput: () => {},
    }),
    /chart scope contract is invalid/u,
  );
});

for (const [label, mutateScope] of [
  ["missing token series scope", (chart) => ({
    ...chart,
    seriesScope: undefined,
  })],
  ["inconsistent exact-pool attribution", (chart) => ({
    ...chart,
    poolAttribution: "exact",
  })],
]) {
  test(`staged smoke rejects a GMGN chart with ${label}`, async () => {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: gmgnStagedFetch({
          gmgnChart: true,
          mutateGmgnChart: mutateScope,
        }),
        appendOutput: () => undefined,
      }),
      /chart scope contract is invalid/u,
    );
  });
}

test("staged smoke rejects a GMGN chart without its exact token-info proof", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({
        gmgnChart: true,
        mutateGmgnChart: (chart) => ({ ...chart, identityProof: null }),
      }),
      appendOutput: () => undefined,
    }),
    /chart scope contract is invalid/u,
  );
});

for (const [label, mutateCanonicalSupply] of [
  ["missing canonical supply", () => undefined],
  ["wrong raw supply", (supply) => ({
    ...supply,
    totalSupplyRaw: (BigInt(supply.totalSupplyRaw) + 1n).toString(),
  })],
  ["wrong token decimals", (supply) => ({
    ...supply,
    tokenDecimals: supply.tokenDecimals + 1,
  })],
]) {
  test(`staged smoke rejects a GMGN chart with ${label}`, async () => {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: gmgnStagedFetch({
          gmgnChart: true,
          mutateGmgnChart: (chart) => ({
            ...chart,
            identityProof: {
              ...chart.identityProof,
              canonicalSupply: mutateCanonicalSupply(
                chart.identityProof.canonicalSupply,
              ),
            },
          }),
        }),
        appendOutput: () => undefined,
      }),
      /chart scope contract is invalid/u,
    );
  });
}

test("staged smoke rejects a GMGN chart bound to another canonical pool", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({
        gmgnChart: true,
        mutateGmgnChart: (chart) => ({
          ...chart,
          identity: { ...chart.identity, poolId: `0x${"44".repeat(32)}` },
        }),
      }),
      appendOutput: () => undefined,
    }),
    /chart scope contract is invalid/u,
  );
});

test("staged smoke proves GMGN from the canonical market-cap candidates first", async () => {
  const requests = [];
  const fetchImpl = pagedGmgnStagedFetch({ marketCapProof: true });
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: (url, init) => {
      requests.push(new URL(String(url)));
      return fetchImpl(url, init);
    },
    appendOutput: () => undefined,
  });

  assert.equal(result.tokenAddress, TOKEN);
  assert.equal(result.detailMarketProvider, "gmgn");
  assert.equal(result.detailStatus, "verified-gmgn-market");
  assert.equal(requests.filter((url) =>
    url.pathname === "/api/explore" &&
    url.searchParams.get("model") === "classic"
  ).length, 0);
});

test("staged smoke finds an exact GMGN proof after the newest nine Classic tokens", async () => {
  const requests = [];
  const fetchImpl = pagedGmgnStagedFetch({
    entryCount: 10,
    gmgnPage: 2,
    marketCapObservedFallback: true,
  });
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: (url, init) => {
      requests.push(new URL(String(url)));
      return fetchImpl(url, init);
    },
    appendOutput: () => undefined,
  });

  assert.equal(result.tokenAddress, entry(9).tokenAddress);
  assert.equal(result.detailMarketProvider, "gmgn");
  assert.equal(result.detailStatus, "verified-gmgn-market");
  assert.deepEqual(requests.filter((url) =>
    url.pathname === "/api/explore" &&
    url.searchParams.get("model") === "classic"
  ).map((url) => url.searchParams.get("page")), ["1", "2"]);
  assert.deepEqual(requests.filter((url) =>
    url.pathname === "/api/explore/token"
  ).map((url) => url.searchParams.get("address")), [
    TOKEN,
    entry(9).tokenAddress,
  ]);
});

test("staged smoke bounds the fallback GMGN Classic scan to eight pages", async () => {
  const requests = [];
  const fetchImpl = pagedGmgnStagedFetch({ entryCount: 73, gmgnPage: 9 });
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: (url, init) => {
        requests.push(new URL(String(url)));
        return fetchImpl(url, init);
      },
      appendOutput: () => undefined,
    }),
    /Explore returned no GMGN-qualified canonical token/u,
  );

  assert.deepEqual(requests.filter((url) =>
    url.pathname === "/api/explore" &&
    url.searchParams.get("model") === "classic"
  ).map((url) => url.searchParams.get("page")), [
    "1", "2", "3", "4", "5", "6", "7", "8",
  ]);
});

test("staged smoke keeps the exact $10k GMGN liquidity qualification gate", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: pagedGmgnStagedFetch({
        entryCount: 10,
        gmgnPage: 2,
        gmgnLiquidityUsdWad: "9999999999999999999999",
      }),
      appendOutput: () => undefined,
    }),
    /Canonical GMGN list response contract is invalid/u,
  );
});

test("staged smoke requires a complete GMGN detail runtime read", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({ detailReadStatus: "partial" }),
      appendOutput: () => undefined,
    }),
    /Token detail GMGN market contract is required/u,
  );
});

test("staged smoke rejects Dexscreener detail fallback when GMGN is required", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({
        detailToken: entry(0),
        detailProvider: "dexscreener",
        detailReadStatus: "unavailable",
      }),
      appendOutput: () => undefined,
    }),
    /Token detail GMGN market contract is required/u,
  );
});

test("staged smoke rejects a GMGN detail snapshot bound to another pool", async () => {
  const detailToken = gmgnValuedEntry();
  detailToken.gmgnMarketData = {
    ...detailToken.gmgnMarketData,
    identity: {
      ...detailToken.gmgnMarketData.identity,
      poolId: `0x${"56".repeat(32)}`,
    },
  };
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({ detailToken }),
      appendOutput: () => undefined,
    }),
    /Token detail identity or market contract is invalid/u,
  );
});

test("staged smoke rejects non-ISO market-read timestamps", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({
        visibleOldestFetchedAt: new Date(NOW).toUTCString(),
      }),
      appendOutput: () => undefined,
    }),
    /Newest launches response contract is invalid/u,
  );
});

test("staged smoke rejects stale GMGN valuation and snapshot evidence", async () => {
  const staleTime = new Date(Date.parse(NOW) - 5 * 60_000 - 1).toISOString();
  const staleToken = gmgnValuedEntry();
  staleToken.valuation = { ...staleToken.valuation, asOfTime: staleTime };
  staleToken.gmgnMarketData = {
    ...staleToken.gmgnMarketData,
    fetchedAt: staleTime,
  };
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({
        visibleToken: staleToken,
        detailToken: staleToken,
        visibleOldestFetchedAt: staleTime,
        visibleNewestFetchedAt: staleTime,
      }),
      appendOutput: () => undefined,
    }),
    /Newest launches response contract is invalid/u,
  );
});

test("staged smoke rejects GMGN compatibility FDV drift", async () => {
  const drifted = gmgnValuedEntry();
  drifted.fdvUsdWad = (BigInt(drifted.fdvUsdWad) + 1n).toString();
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: gmgnStagedFetch({ visibleToken: drifted, detailToken: drifted }),
      appendOutput: () => undefined,
    }),
    /Newest launches response contract is invalid/u,
  );
});

test("staged smoke rejects an invalid GMGN requirement flag before fetching", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "enabled",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
      appendOutput: () => undefined,
    }),
    /GMGN market requirement is invalid/u,
  );
});

test("staged smoke accepts exact canonical Classic V4 custody shapes", async () => {
  for (const custodyMode of [
    "unlocked",
    "fixed-lock",
    "linear",
    "cliff-linear",
  ]) {
    const result = await runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: classicV4StagedFetch({
        token: classicV4Entry({ custodyMode }),
      }),
      appendOutput: () => undefined,
    });

    assert.equal(result.tokenAddress, TOKEN);
    assert.equal(result.detailStatus, "verified-identity-market-unavailable");
  }
});

test("staged smoke rejects malformed Classic V4 identity and policy fields", async () => {
  const scenarios = [
    (value) => ({ ...value, hookAddress: NATIVE_CURRENCY_ADDRESS }),
    (value) => ({ ...value, launchHash: `0x${"00".repeat(32)}` }),
    (value) => ({ ...value, buyHookFeeBps: 11 }),
    (value) => ({ ...value, tickLower: 174_600 }),
    (value) => ({ ...value, initialBuyEthAmountWei: "0" }),
    (value) => ({ ...value, launchStampProvenance: {} }),
    (value) => ({
      ...value,
      launchCategoryProvenance: {
        ...value.launchCategoryProvenance,
        source: "registry.custom-launched",
      },
    }),
    (value) => ({
      ...value,
      launchCategoryProvenance: {
        ...value.launchCategoryProvenance,
        recordId: `1:${CUSTOM_TOKEN}`,
      },
    }),
    (value) => ({
      ...value,
      initialBuyCustody: classicV4Custody("unsupported"),
    }),
    (value) => ({
      ...value,
      initialBuyCustody: {
        ...classicV4Custody("fixed-lock"),
        cliffTimestamp: NOW,
      },
    }),
    (value) => ({
      ...value,
      initialBuyCustody: {
        ...classicV4Custody("cliff-linear"),
        cliffDays: 30,
      },
    }),
  ];

  for (const mutate of scenarios) {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: classicV4StagedFetch({ token: mutate(classicV4Entry()) }),
        appendOutput: () => undefined,
      }),
      /Explore identity set is malformed or duplicated/u,
    );
  }
});

test("staged smoke does not generically admit another Classic release", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: classicV4StagedFetch({
        token: {
          ...classicV4Entry(),
          launchModelVersion: "classic-v5",
        },
      }),
      appendOutput: () => undefined,
    }),
    /Explore identity set is malformed or duplicated/u,
  );

  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: classicV4StagedFetch({
        scopeIncluded: [
          "classic-v3",
          "classic-v4",
          "classic-v5",
          "official-main-token",
          "registry.custom-launched",
        ],
      }),
      appendOutput: () => undefined,
    }),
    /Highest market-cap response contract is invalid/u,
  );
});

test("staged smoke fail-closes Classic V4 catalog release binding", async () => {
  for (const options of [
    { classicV4Bound: false },
    { classicV4Bound: true, includeClassicV4Identity: false },
  ]) {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: classicV4StagedFetch(options),
        appendOutput: () => undefined,
      }),
      /Classic V4 identities are not bound to the exact catalog release/u,
    );
  }
});

test("staged smoke accepts an exact Router Custom token identity", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: routerCustomStagedFetch(),
    appendOutput: () => undefined,
  });

  assert.equal(result.tokenAddress, ROUTER_TOKEN);
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke requires the exact SHARD Router trade project", async () => {
  const output = [];
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      PROGRAMMABLE_REQUIRE_SHARD_ROUTER_TRADE: "true",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(),
    appendOutput: (...args) => output.push(args),
  });

  assert.equal(result.shardTradeStatus, "verified");
  assert.match(output[0][1], /shard_trade_status=verified/u);
});

test("staged smoke accepts a bounded Router last-known-good identity", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: routerCustomStagedFetch(
      (value) => value,
      {
        registryCustomStatus: "current",
        routerCustomStatus: "last-known-good",
      },
    ),
    appendOutput: () => undefined,
  });

  assert.equal(result.tokenAddress, ROUTER_TOKEN);
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke rejects malformed Router Custom identity provenance", async () => {
  const scenarios = [
    (value) => ({ ...value, launchModelVersion: "classic-v3" }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        schemaVersion: "programmable.launch-stamp-provenance.v2",
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        poolId: `0x${"fe".repeat(32)}`,
      },
    }),
    (value) => ({
      ...value,
      launchCategoryProvenance: {
        ...value.launchCategoryProvenance,
        source: "registry.custom-launched",
      },
    }),
    (value) => ({
      ...value,
      launchCategoryProvenance: {
        ...value.launchCategoryProvenance,
        launchId: `0x${"fe".repeat(32)}`,
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        tokenProof: {
          ...value.launchStampProvenance.tokenProof,
          tokenAddress: TOKEN,
        },
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        tokenProof: {
          ...value.launchStampProvenance.tokenProof,
          stampHash: `0x${"fe".repeat(32)}`,
        },
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        poolProof: {
          ...value.launchStampProvenance.poolProof,
          poolManagerAddress: TOKEN,
        },
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        poolProof: {
          ...value.launchStampProvenance.poolProof,
          poolId: `0x${"fe".repeat(32)}`,
        },
      },
    }),
    (value) => ({
      ...value,
      launchStampProvenance: {
        ...value.launchStampProvenance,
        poolProof: {
          ...value.launchStampProvenance.poolProof,
          launchId: `0x${"fe".repeat(32)}`,
        },
      },
    }),
  ];

  for (const mutate of scenarios) {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: routerCustomStagedFetch(mutate),
        appendOutput: () => undefined,
      }),
      /Explore identity set is malformed or duplicated/u,
    );
  }
});

test("staged smoke accepts monotonic Envio progress with stable identities", async () => {
  const advancedAt = "2026-08-16T08:00:12.000Z";
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(
      ({ body, url }) =>
        url.pathname === "/api/explore" &&
          url.searchParams.get("sort") === "newest"
          ? {
              ...body,
              catalog: {
                ...body.catalog,
                lastIndexedAt: advancedAt,
                asOfBlock: "25740012",
                asOfBlockHash: `0x${"ab".repeat(32)}`,
                evidence: {
                  ...body.catalog.evidence,
                  progressBlock: "25740012",
                  commitment: `sha256:${"cd".repeat(32)}`,
                },
              },
            }
          : body,
      ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore" &&
            url.searchParams.get("sort") === "newest"
          ? {
              ...extraHeaders,
              "x-programmable-identity-last-indexed-at": advancedAt,
            }
          : extraHeaders,
        omittedHeaders,
      }),
    ),
    appendOutput: () => undefined,
  });

  assert.equal(result.catalogSource, "envio-classic-v3");
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke restarts the full Explore snapshot after ranking-boundary drift", async () => {
  let exploreReads = 0;
  let detailReads = 0;
  const waits = [];
  const advancedCommitment = `sha256:${"dd".repeat(32)}`;
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(({ body, url }) => {
      if (url.pathname === "/api/explore") {
        exploreReads += 1;
        return exploreReads >= 2
          ? {
              ...body,
              catalog: {
                ...body.catalog,
                identityCommitment: advancedCommitment,
              },
            }
          : body;
      }
      if (url.pathname === "/api/explore/token") {
        detailReads += 1;
        return {
          ...body,
          catalog: {
            ...body.catalog,
            identityCommitment: advancedCommitment,
          },
        };
      }
      return body;
    }),
    appendOutput: () => undefined,
    waitForCatalogConvergence: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
  assert.equal(exploreReads, 7);
  assert.equal(detailReads, 1);
  assert.deepEqual(waits, [16_000]);
});

test("staged smoke retries a valid Router-only fallback after Envio drops", async () => {
  let exploreReads = 0;
  const waits = [];
  const routerOnlyCatalog = {
    source: "envio-classic-v3",
    launchSource: "canonical-launch-stamp-router",
    status: "last-known-good",
    lastIndexedAt: NOW,
    asOfBlock: "25740001",
    asOfBlockHash: `0x${"ab".repeat(32)}`,
    identityCount: 1,
    identityCommitment: `sha256:${"de".repeat(32)}`,
    completeness: {
      classic: "unavailable",
      stock: "excluded",
      custom: "unavailable",
      registryCustom: "unavailable",
      routerCustom: "last-known-good",
    },
    scope: {
      included: ["canonical-launch-stamp-router"],
      excluded: [
        "classic-v1",
        "classic-v2",
        "stock-paired-v1",
        "stock-paired-v2",
        "stock-paired-v3",
      ],
      publicCategories: ["classic", "custom"],
    },
    routerStamp: {
      source: "canonical-launch-stamp-router",
      status: "last-known-good",
      finalityConfirmations: 64,
      verifiedIdentityCount: 1,
      projectedIdentityCount: 1,
      generatedAt: NOW,
      asOfBlock: "25740001",
      asOfBlockHash: `0x${"ab".repeat(32)}`,
      identityCommitment: `sha256:${"ac".repeat(32)}`,
    },
  };
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(
      ({ body, url }) => {
        if (url.pathname !== "/api/explore") return body;
        exploreReads += 1;
        if (exploreReads !== 2) return body;
        return {
          ...body,
          tokens: [routerCustomEntry()],
          page: 1,
          pageSize: Number(url.searchParams.get("limit")),
          total: 1,
          totalPages: 1,
          dataQuality: {
            ...body.dataQuality,
            launchIdentity: {
              status: "partial",
              canonical: "unavailable",
              custom: "unavailable",
              ageMs: 1_000,
            },
          },
          catalog: routerOnlyCatalog,
          marketRead: marketRead(1),
          ranking: undefined,
        };
      },
      ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore" && exploreReads === 2
          ? {
              ...extraHeaders,
              "x-programmable-launch-source":
                "canonical-launch-stamp-router",
              "x-programmable-read-source":
                "canonical-launch-stamp-router+dexscreener",
              "x-programmable-canonical-read-status": "unavailable",
              "x-programmable-router-read-status": "last-known-good",
            }
          : extraHeaders,
        omittedHeaders,
      }),
    ),
    appendOutput: () => undefined,
    waitForCatalogConvergence: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
  assert.equal(exploreReads, 7);
  assert.deepEqual(waits, [16_000]);
});

test("staged smoke restarts list and detail after detail-boundary drift", async () => {
  let advanced = false;
  let exploreReads = 0;
  let detailReads = 0;
  const waits = [];
  const advancedCommitment = `sha256:${"dd".repeat(32)}`;
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(({ body, url }) => {
      if (url.pathname === "/api/explore") {
        exploreReads += 1;
        return advanced
          ? {
              ...body,
              catalog: {
                ...body.catalog,
                identityCommitment: advancedCommitment,
              },
            }
          : body;
      }
      if (url.pathname === "/api/explore/token") {
        detailReads += 1;
        advanced = true;
        return {
          ...body,
          catalog: {
            ...body.catalog,
            identityCommitment: advancedCommitment,
          },
        };
      }
      return body;
    }),
    appendOutput: () => undefined,
    waitForCatalogConvergence: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
  assert.equal(exploreReads, 10);
  assert.equal(detailReads, 2);
  assert.deepEqual(waits, [16_000]);
});

test("staged smoke rejects a mixed Explore identity commitment", async () => {
  let exploreReads = 0;
  const waits = [];
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) => {
        if (url.pathname === "/api/explore") exploreReads += 1;
        return url.pathname === "/api/explore" &&
            url.searchParams.get("sort") === "newest"
          ? {
              ...body,
              catalog: {
                ...body.catalog,
                identityCommitment: `sha256:${"dd".repeat(32)}`,
              },
            }
          : body;
      }),
      appendOutput: () => undefined,
      waitForCatalogConvergence: async (milliseconds) => {
        waits.push(milliseconds);
      },
    }),
    /catalog changed.*3 bounded attempts/u,
  );
  assert.equal(exploreReads, 6);
  assert.deepEqual(waits, [16_000, 16_000]);
});

test("staged smoke rejects a token detail bound to the wrong pool", async () => {
  let exploreReads = 0;
  let detailReads = 0;
  const waits = [];
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) => {
        if (url.pathname === "/api/explore") exploreReads += 1;
        if (url.pathname === "/api/explore/token") detailReads += 1;
        return url.pathname === "/api/explore/token"
          ? {
              ...body,
              token: { ...body.token, poolId: `0x${"ee".repeat(32)}` },
            }
          : body;
      }),
      appendOutput: () => undefined,
      waitForCatalogConvergence: async (milliseconds) => {
        waits.push(milliseconds);
      },
    }),
    /detail identity or market contract/u,
  );
  assert.equal(exploreReads, 5);
  assert.equal(detailReads, 1);
  assert.deepEqual(waits, []);
});

test("staged smoke never retries malformed detail headers or valuation", async () => {
  const scenarios = [
    {
      transform: ({ body, url }) => url.pathname === "/api/explore/token"
        ? {
            ...body,
            token: {
              ...body.token,
              valuation: {
                status: "available",
                metric: "fdv",
                valueWad: "1",
              },
            },
          }
        : body,
      transformHeaders: ({ extraHeaders, omittedHeaders }) => ({
        extraHeaders,
        omittedHeaders,
      }),
    },
    {
      transform: ({ body }) => body,
      transformHeaders: ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore/token"
          ? { ...extraHeaders, "x-programmable-read-source": "invalid" }
          : extraHeaders,
        omittedHeaders,
      }),
    },
  ];

  for (const scenario of scenarios) {
    let exploreReads = 0;
    let detailReads = 0;
    const waits = [];
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: stagedFetch(
          (input) => {
            if (input.url.pathname === "/api/explore") exploreReads += 1;
            if (input.url.pathname === "/api/explore/token") detailReads += 1;
            return scenario.transform(input);
          },
          scenario.transformHeaders,
        ),
        appendOutput: () => undefined,
        waitForCatalogConvergence: async (milliseconds) => {
          waits.push(milliseconds);
        },
      }),
      /detail identity or market contract/u,
    );
    assert.equal(exploreReads, 5);
    assert.equal(detailReads, 1);
    assert.deepEqual(waits, []);
  }
});

test("staged smoke keeps GMGN market-cap rank independent from visible FDV", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(({ body, url }) =>
      url.pathname === "/api/explore" &&
        url.searchParams.get("sort") === "market-cap"
        ? {
            ...body,
            ranking: marketCapRanking("market-cap", 2, {
              source: "gmgn",
              status: "partial",
              gmgnStatus: "partial",
              applied: "gmgn-market-cap-then-launch-order",
              observedTokenCount: 1,
              matchedTokenCount: 1,
              matchedUniqueTokenCount: 1,
              unobservedCanonicalEntryCount: 1,
              canonicalAddressCoverageBps: 5_000,
              fallbackRequestedCount: 1,
              qualifiedCount: 1,
              asOfTime: NOW,
            }),
          }
        : body),
    appendOutput: () => undefined,
  });
  assert.equal(result.marketCapDescSource, "gmgn");
  assert.equal(result.marketCapDescGmgnStatus, "partial");
  assert.equal(result.marketCapDescMatchedCount, 1);
  assert.equal(result.marketReadStatus, "unavailable");
});

test("staged smoke rejects an inconsistent market-cap fallback count", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/explore" &&
          url.searchParams.get("sort") === "market-cap"
          ? {
              ...body,
              ranking: {
                ...body.ranking,
                fallbackRequestedCount: 1,
              },
            }
          : body),
      appendOutput: () => undefined,
    }),
    /Highest market-cap ranking contract is invalid/u,
  );
});

test("staged smoke rejects a zero or undercounted Dex request set", async () => {
  for (const requestedCount of [0, 1]) {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: stagedFetch(({ body, url }) =>
          url.pathname === "/api/explore"
            ? {
                ...body,
                marketRead: {
                  ...body.marketRead,
                  requestedCount,
                  unavailableCount: requestedCount,
                },
              }
            : body),
        appendOutput: () => undefined,
      }),
      /response contract is invalid/u,
    );
  }
});

test("staged smoke binds market-cap ranking to the complete paged identity set", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(pagedCatalogTransform(allEntries)),
    appendOutput: () => undefined,
  });

  assert.equal(result.marketReadStatus, "unavailable");
  assert.equal(result.discoveryMatchedCount, 0);
});

test("staged smoke accepts current and last-known-good Router reads for one paged identity snapshot", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  const launchSource =
    "envio-classic-v3+canonical-launch-stamp-router";
  let sawLastKnownGoodPage = false;
  const routerStatusFor = (url) => {
    const lastKnownGood = url.pathname === "/api/explore" &&
      url.searchParams.get("sort") === "market-cap" &&
      url.searchParams.get("page") === "2";
    if (lastKnownGood) sawLastKnownGoodPage = true;
    return lastKnownGood ? "last-known-good" : "current";
  };
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(
      (input) => {
        const body = paged(input);
        if (![
          "/api/explore",
          "/api/explore/token",
        ].includes(input.url.pathname)) return body;
        return {
          ...body,
          catalog: {
            ...body.catalog,
            launchSource,
            completeness: {
              ...body.catalog.completeness,
              routerCustom: routerStatusFor(input.url),
            },
            scope: {
              ...body.catalog.scope,
              included: [
                ...body.catalog.scope.included,
                "canonical-launch-stamp-router",
              ],
            },
          },
        };
      },
      ({ extraHeaders, omittedHeaders, url }) => {
        if (![
          "/api/explore",
          "/api/explore/token",
          "/api/explore/token/chart",
        ].includes(url.pathname)) return { extraHeaders, omittedHeaders };
        const provider = url.pathname.endsWith("/chart")
          ? "bitquery"
          : "dexscreener";
        return {
          extraHeaders: {
            ...extraHeaders,
            "x-programmable-launch-source": launchSource,
            "x-programmable-read-source": `${launchSource}+${provider}`,
            "x-programmable-router-read-status": routerStatusFor(url),
          },
          omittedHeaders,
        };
      },
    ),
    appendOutput: () => undefined,
  });

  assert.equal(sawLastKnownGoodPage, true);
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke keeps Router body and header status validation strict", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: routerCustomStagedFetch(
        (value) => value,
        {
          routerCustomStatus: "current",
          routerHeaderStatus: "last-known-good",
        },
      ),
      appendOutput: () => undefined,
    }),
    /Highest market-cap response contract is invalid/u,
  );
});

test("staged smoke retries identity drift before clamped page validation", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  const waits = [];
  let snapshotAttempt = 0;
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch((input) => {
      const body = paged(input);
      if (
        input.url.pathname === "/api/explore" &&
        input.url.searchParams.get("sort") === "market-cap" &&
        input.url.searchParams.get("page") === "1"
      ) snapshotAttempt += 1;
      if (
        snapshotAttempt === 1 &&
        input.url.pathname === "/api/explore" &&
        input.url.searchParams.get("sort") === "market-cap" &&
        input.url.searchParams.get("page") === "2"
      ) {
        return {
          ...body,
          page: 1,
          catalog: {
            ...body.catalog,
            identityCommitment: `sha256:${"ef".repeat(32)}`,
          },
        };
      }
      return body;
    }),
    appendOutput: () => undefined,
    waitForCatalogConvergence: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
  assert.equal(snapshotAttempt, 2);
  assert.deepEqual(waits, [16_000]);
});

test("staged smoke retries one full market-cap ranking drift", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  const waits = [];
  let snapshotAttempt = 0;
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch((input) => {
      const body = paged(input);
      if (
        input.url.pathname === "/api/explore" &&
        input.url.searchParams.get("sort") === "market-cap" &&
        input.url.searchParams.get("page") === "1"
      ) snapshotAttempt += 1;
      if (
        snapshotAttempt === 1 &&
        input.url.pathname === "/api/explore" &&
        input.url.searchParams.get("sort") === "market-cap" &&
        input.url.searchParams.get("page") === "2"
      ) {
        return {
          ...body,
          ranking: {
            ...body.ranking,
            rankingCommitment: `sha256:${"ef".repeat(32)}`,
          },
        };
      }
      return body;
    }),
    appendOutput: () => undefined,
    waitForCatalogConvergence: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
  assert.equal(snapshotAttempt, 2);
  assert.deepEqual(waits, [16_000]);
});

test("staged smoke fails closed after bounded market-cap ranking drift", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  const waits = [];
  let snapshotAttempt = 0;
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch((input) => {
        const body = paged(input);
        if (
          input.url.pathname === "/api/explore" &&
          input.url.searchParams.get("sort") === "market-cap" &&
          input.url.searchParams.get("page") === "1"
        ) snapshotAttempt += 1;
        if (
          input.url.pathname === "/api/explore" &&
          input.url.searchParams.get("sort") === "market-cap" &&
          input.url.searchParams.get("page") === "2"
        ) {
          return {
            ...body,
            ranking: {
              ...body.ranking,
              rankingCommitment:
                `sha256:${snapshotAttempt.toString(16).padStart(64, "0")}`,
            },
          };
        }
        return body;
      }),
      appendOutput: () => undefined,
      waitForCatalogConvergence: async (milliseconds) => {
        waits.push(milliseconds);
      },
    }),
    /Market-cap ranking changed during pagination after 3 bounded attempts/u,
  );

  assert.equal(snapshotAttempt, 3);
  assert.deepEqual(waits, [16_000, 16_000]);
});

test("staged smoke does not retry a malformed market-cap page contract", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  const waits = [];
  let snapshotAttempt = 0;
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch((input) => {
        const body = paged(input);
        if (
          input.url.pathname === "/api/explore" &&
          input.url.searchParams.get("sort") === "market-cap" &&
          input.url.searchParams.get("page") === "1"
        ) snapshotAttempt += 1;
        if (
          input.url.pathname === "/api/explore" &&
          input.url.searchParams.get("sort") === "market-cap" &&
          input.url.searchParams.get("page") === "2"
        ) {
          return {
            ...body,
            ranking: { ...body.ranking, schemaVersion: "invalid" },
          };
        }
        return body;
      }),
      appendOutput: () => undefined,
      waitForCatalogConvergence: async (milliseconds) => {
        waits.push(milliseconds);
      },
    }),
    /Market-cap pagination commitment is invalid/u,
  );

  assert.equal(snapshotAttempt, 1);
  assert.deepEqual(waits, []);
});

test("staged smoke separates one Trending rank identity from monotonic freshness", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  const freshnessBaseMs = Date.parse(NOW) - 1_000;
  const output = [];
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch((input) => {
      const body = paged(input);
      if (
        input.url.pathname !== "/api/explore" ||
        input.url.searchParams.get("sort") !== "trending"
      ) return body;
      const page = Number(input.url.searchParams.get("page"));
      return {
        ...body,
        discovery: liveTrendingDiscovery(
          body.discovery,
          allEntries.length,
          new Date(freshnessBaseMs + page).toISOString(),
        ),
      };
    }, liveTrendingHeaders),
    appendOutput: (...args) => output.push(args),
  });
  assert.equal(
    result.discoveryConsistency,
    "ranking-identity+monotonic-current-freshness",
  );
  assert.match(
    output[0][1],
    /discovery_consistency=ranking-identity\+monotonic-current-freshness/u,
  );
});

test("staged smoke retries the whole bounded Trending pagination once on freshness regression", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  let attempt = 0;
  const pages = new Map();
  const freshnessBaseMs = Date.parse(NOW) - 1_000;
  const fetchImpl = stagedFetch((input) => {
    const body = paged(input);
    if (
      input.url.pathname !== "/api/explore" ||
      input.url.searchParams.get("sort") !== "trending"
    ) return body;
    const page = Number(input.url.searchParams.get("page"));
    if (page === 1) attempt += 1;
    pages.set(page, (pages.get(page) ?? 0) + 1);
    const freshnessOffset = attempt === 1 && page === 2
      ? 1
      : attempt * 10 + page;
    return {
      ...body,
      discovery: liveTrendingDiscovery(
        body.discovery,
        allEntries.length,
        new Date(freshnessBaseMs + freshnessOffset).toISOString(),
      ),
    };
  }, liveTrendingHeaders);
  await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl,
    appendOutput: () => {},
  });
  assert.deepEqual(Object.fromEntries(pages), { 1: 2, 2: 2, 3: 1 });
});

test("staged smoke fails closed after two Trending ranking identity drifts", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  const pages = new Map();
  const fetchImpl = stagedFetch((input) => {
    const body = paged(input);
    if (
      input.url.pathname !== "/api/explore" ||
      input.url.searchParams.get("sort") !== "trending"
    ) return body;
    const page = Number(input.url.searchParams.get("page"));
    pages.set(page, (pages.get(page) ?? 0) + 1);
    return page === 2
      ? {
          ...body,
          discovery: {
            ...body.discovery,
            rankingCommitment: `sha256:${"ee".repeat(32)}`,
          },
        }
      : body;
  });
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl,
      appendOutput: () => {},
    }),
    /drifted across both bounded attempts/u,
  );
  assert.deepEqual(Object.fromEntries(pages), { 1: 2, 2: 2 });
});

test("staged smoke fails closed on Trending coverage drift under one commitment", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  const pages = new Map();
  const fetchImpl = stagedFetch((input) => {
    const body = paged(input);
    if (
      input.url.pathname !== "/api/explore" ||
      input.url.searchParams.get("sort") !== "trending"
    ) return body;
    const page = Number(input.url.searchParams.get("page"));
    pages.set(page, (pages.get(page) ?? 0) + 1);
    return page === 2
      ? {
          ...body,
          discovery: {
            ...body.discovery,
            canonicalAddressCoverageBps:
              body.discovery.canonicalAddressCoverageBps + 1,
          },
        }
      : body;
  });
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl,
      appendOutput: () => {},
    }),
    /drifted across both bounded attempts/u,
  );
  assert.deepEqual(Object.fromEntries(pages), { 1: 2, 2: 2 });
});

test("staged smoke proves the GMGN prefix and rejects a reordered canonical tail", async () => {
  const allEntries = Array.from({ length: 299 }, (_, index) => entry(index));
  const paged = pagedCatalogTransform(allEntries);
  const makeFetch = (reorderTail) => stagedFetch(
    (input) => {
      const body = paged(input);
      if (
        input.url.pathname !== "/api/explore" ||
        input.url.searchParams.get("sort") !== "trending"
      ) return body;
      const prefix = [allEntries[2], allEntries[1]];
      const prefixIds = new Set(prefix.map((token) => token.id));
      const tail = allEntries.filter((token) => !prefixIds.has(token.id));
      if (reorderTail) [tail[0], tail[1]] = [tail[1], tail[0]];
      const ordered = [...prefix, ...tail];
      const page = Number(input.url.searchParams.get("page"));
      const pageSize = Number(input.url.searchParams.get("limit"));
      return {
        ...body,
        tokens: ordered.slice((page - 1) * pageSize, page * pageSize),
        discovery: {
          ...body.discovery,
          status: "partial",
          applied: "gmgn-ranked-with-launch-order-fallback",
          snapshotCount: 1,
          observedTokenCount: 2,
          matchedTokenCount: 2,
          matchedUniqueTokenCount: 2,
          unobservedCanonicalEntryCount: 297,
          canonicalAddressCoverageBps: Math.floor(2 * 10_000 / 299),
          asOfTime: NOW,
        },
      };
    },
    ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: url.pathname === "/api/explore" &&
          url.searchParams.get("sort") === "trending"
        ? {
            ...extraHeaders,
            "x-programmable-read-source":
              "envio-classic-v3+dexscreener+gmgn-discovery",
          }
        : extraHeaders,
      omittedHeaders,
    }),
  );
  const environment = {
    STAGED_TARGET_URL: "https://candidate.vercel.app/",
    VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
    GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
  };
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment,
    fetchImpl: makeFetch(false),
    appendOutput: () => {},
  });
  assert.equal(result.discoveryMatchedCount, 2);
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment,
      fetchImpl: makeFetch(true),
      appendOutput: () => {},
    }),
    /canonical prefix or stable tail is invalid/u,
  );
});

test("staged smoke rejects a phantom on the initial Newest page", async () => {
  const allEntries = Array.from({ length: 21 }, (_, index) => entry(index));
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(pagedCatalogTransform(allEntries, {
        phantomNewest: true,
      })),
      appendOutput: () => undefined,
    }),
    /Initial Newest page is outside the paged catalog/u,
  );
});

test("staged smoke rejects a phantom on the highest market-cap page", async () => {
  const allEntries = Array.from({ length: 21 }, (_, index) => entry(index));
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(pagedCatalogTransform(allEntries, {
        phantomHighest: true,
      })),
      appendOutput: () => undefined,
    }),
    /Highest market-cap (?:response contract is invalid|ranking contract is invalid|page is outside the paged catalog)/u,
  );
});

test("staged smoke rejects duplicate identities on the highest market-cap page", async () => {
  const allEntries = Array.from({ length: 21 }, (_, index) => entry(index));
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(pagedCatalogTransform(allEntries, {
        duplicateHighest: true,
      })),
      appendOutput: () => undefined,
    }),
    /Highest market-cap (?:response contract is invalid|page is outside the paged catalog)/u,
  );
});

test("staged smoke treats configured provider health as informational", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/ops/health"
          ? {
              ...body,
              status: "degraded",
              provider: { ...body.provider, configured: false },
              providers: body.providers.map((provider) =>
                provider.name === "gmgn"
                  ? { ...provider, configured: false }
                  : provider
              ),
            }
          : body),
      appendOutput: () => undefined,
    });
  assert.equal(result.healthStatus, "degraded");
  assert.equal(result.healthAuthority, "informational-only");
  assert.equal(result.gmgnAccountGateMode, "multiflight-v1");
  assert.equal(result.gmgnRequestsPerSecond, 20);
});

test("staged smoke accepts a conservative GMGN rate when GMGN is optional", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(({ body, url }) =>
      url.pathname === "/api/ops/health"
        ? {
            ...body,
            providers: body.providers.map((provider) =>
              provider.name === "gmgn"
                ? { ...provider, requestsPerSecond: 1 }
                : provider
            ),
          }
        : body),
    appendOutput: () => undefined,
  });
  assert.equal(result.gmgnRequestsPerSecond, 1);
});

test("staged smoke accepts conservative RPS on the legacy account gate", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(({ body, url }) =>
      url.pathname === "/api/ops/health"
        ? {
            ...body,
            providers: body.providers.map((provider) =>
              provider.name === "gmgn"
                ? {
                    ...provider,
                    requestsPerSecond: 1,
                    accountGateMode: "legacy-singleflight-v1",
                  }
                : provider
            ),
          }
        : body),
    appendOutput: () => undefined,
  });
  assert.equal(result.gmgnRequestsPerSecond, 1);
  assert.equal(result.gmgnAccountGateMode, "legacy-singleflight-v1");
});

test("staged smoke requires the exact GMGN Pro rate when GMGN is required", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/ops/health"
          ? {
              ...body,
              providers: body.providers.map((provider) =>
                provider.name === "gmgn"
                  ? { ...provider, requestsPerSecond: 19 }
                  : provider
              ),
            }
          : body),
      appendOutput: () => undefined,
    }),
    /lacks exact RPS 20 multiflight-v1 proof/u,
  );
});

for (const mode of ["legacy-singleflight-v1", "unavailable"]) {
  test(`staged smoke rejects required GMGN on ${mode}`, async () => {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
          PROGRAMMABLE_REQUIRE_GMGN_MARKET: "true",
        },
        fetchImpl: stagedFetch(({ body, url }) =>
          url.pathname === "/api/ops/health"
            ? {
                ...body,
                status: "degraded",
                providers: body.providers.map((provider) =>
                  provider.name === "gmgn"
                    ? { ...provider, accountGateMode: mode }
                    : provider
                ),
              }
            : body),
        appendOutput: () => undefined,
      }),
      /lacks exact RPS 20 multiflight-v1 proof/u,
    );
  });
}

for (const mode of [undefined, "unknown-v1"]) {
  test(`staged smoke rejects malformed GMGN account gate mode ${mode}`, async () => {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: stagedFetch(({ body, url }) => {
          if (url.pathname !== "/api/ops/health") return body;
          return {
            ...body,
            status: "degraded",
            providers: body.providers.map((provider) => {
              if (provider.name !== "gmgn") return provider;
              const next = { ...provider };
              if (mode === undefined) delete next.accountGateMode;
              else next.accountGateMode = mode;
              return next;
            }),
          };
        }),
        appendOutput: () => undefined,
      }),
      /health response is malformed/u,
    );
  });
}

for (const [label, value] of [
  ["missing", undefined],
  ["zero", 0],
  ["fractional", 1.5],
  ["above provider maximum", 21],
]) {
  test(`staged smoke rejects ${label} GMGN health throughput`, async () => {
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: stagedFetch(({ body, url }) => {
          if (url.pathname !== "/api/ops/health") return body;
          return {
            ...body,
            providers: body.providers.map((provider) => {
              if (provider.name !== "gmgn") return provider;
              const next = { ...provider };
              if (value === undefined) delete next.requestsPerSecond;
              else next.requestsPerSecond = value;
              return next;
            }),
          };
        }),
        appendOutput: () => undefined,
      }),
      /health response is malformed/u,
    );
  });
}

test("staged smoke rejects ready health without primary GMGN", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/ops/health"
          ? {
              ...body,
              provider: { ...body.provider, configured: false },
              providers: body.providers.map((provider) =>
                provider.name === "gmgn"
                  ? { ...provider, configured: false }
                  : provider
              ),
            }
          : body),
      appendOutput: () => undefined,
    }),
    /health response is malformed/u,
  );
});

test("staged smoke rejects the legacy Bitquery-only health shape", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/ops/health"
          ? {
              status: "ready",
              provider: { name: "bitquery", configured: true },
              checkedAt: body.checkedAt,
            }
          : body),
      appendOutput: () => undefined,
    }),
    /health response is malformed/u,
  );
});

test("staged smoke rejects health output containing provider secrets", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(({ body, url }) =>
        url.pathname === "/api/ops/health"
          ? { ...body, endpoint: "https://provider.invalid/secret" }
          : body),
      appendOutput: () => undefined,
    }),
    /health response is malformed/u,
  );
});

test("staged smoke accepts Registry-current and Router-unavailable catalog", async () => {
  const project = customProject();
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(
      ({ body, url }) => {
        if (url.pathname === "/api/explore") {
          return {
            ...body,
            tokens: [project, entry(1)],
            marketRead: {
              ...body.marketRead,
              status: "complete",
              requestedCount: 3,
              observedCount: 2,
              qualifiedCount: 2,
              unavailableCount: 1,
              oldestFetchedAt: NOW,
              newestFetchedAt: NOW,
            },
            catalog: {
              ...body.catalog,
              launchSource: "envio-classic-v3+registry.custom-launched",
              completeness: {
                ...body.catalog.completeness,
                registryCustom: "current",
              },
              identityCommitment: `sha256:${"de".repeat(32)}`,
            },
            dataQuality: {
              ...body.dataQuality,
              launchIdentity: {
                ...body.dataQuality.launchIdentity,
                status: "partial",
                custom: "unavailable",
              },
            },
          };
        }
        if (url.pathname === "/api/explore/token") {
          const customSelected =
            url.searchParams.get("address")?.toLowerCase() === CUSTOM_TOKEN;
          return {
            ...body,
            ...(customSelected
              ? { token: null, customProject: project }
              : { token: entry(1), customProject: null }),
            catalog: {
              ...body.catalog,
              launchSource: "envio-classic-v3+registry.custom-launched",
              completeness: {
                ...body.catalog.completeness,
                registryCustom: "current",
              },
              identityCommitment: `sha256:${"de".repeat(32)}`,
            },
          };
        }
        if (url.pathname === "/api/explore/token/chart") {
          return {
            ...body,
            identity: { ...body.identity, poolId: entry(1).poolId },
          };
        }
        return body;
      },
      ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: [
          "/api/explore",
          "/api/explore/token",
          "/api/explore/token/chart",
        ].includes(
            url.pathname,
          )
          ? {
              ...extraHeaders,
              "x-programmable-launch-source":
                "envio-classic-v3+registry.custom-launched",
              "x-programmable-read-source": url.pathname.endsWith("/chart")
                ? "envio-classic-v3+registry.custom-launched+bitquery"
                : "envio-classic-v3+registry.custom-launched+dexscreener",
            }
          : extraHeaders,
        omittedHeaders,
      }),
    ),
    appendOutput: () => undefined,
  });
  assert.equal(result.catalogSource, "envio-classic-v3");
  assert.equal(result.tokenAddress, entry(1).tokenAddress);
  assert.equal(result.detailStatus, "verified-identity-market-unavailable");
});

test("staged smoke rejects creator profile provider-header drift", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore/profile"
          ? { ...extraHeaders, "x-programmable-rpc-provider": "unknown" }
          : extraHeaders,
        omittedHeaders,
      })),
      appendOutput: () => undefined,
    }),
    /profile response is neither ready nor fail-closed/u,
  );
});

test("staged smoke accepts the exact Envio plus RPC creator profile source", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: url.pathname === "/api/explore/profile"
        ? {
            ...extraHeaders,
            "x-programmable-read-source": "envio-classic-v3+rpc",
            "x-programmable-rpc-provider": "quicknode-secondary",
          }
        : extraHeaders,
      omittedHeaders,
    })),
    appendOutput: () => undefined,
  });
  assert.equal(result.profileStatus, "ready");
});

test("staged smoke accepts the bounded last-good Router-combined Envio creator profile source", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: url.pathname === "/api/explore/profile"
        ? {
            ...extraHeaders,
            "x-programmable-launch-source":
              "envio-classic-v3+canonical-launch-stamp-router",
            "x-programmable-read-source":
              "envio-classic-v3+canonical-launch-stamp-router",
            "x-programmable-router-read-status": "last-known-good",
            "x-programmable-rpc-provider": "envio-indexer-state",
          }
        : extraHeaders,
      omittedHeaders,
    })),
    appendOutput: () => undefined,
  });
  assert.equal(result.profileStatus, "ready");
});

test("staged smoke accepts the exact Router-combined Envio plus RPC creator profile source", async () => {
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
      extraHeaders: url.pathname === "/api/explore/profile"
        ? {
            ...extraHeaders,
            "x-programmable-launch-source":
              "envio-classic-v3+canonical-launch-stamp-router",
            "x-programmable-read-source":
              "envio-classic-v3+canonical-launch-stamp-router+rpc",
            "x-programmable-router-read-status": "current",
            "x-programmable-rpc-provider": "quicknode-secondary",
          }
        : extraHeaders,
      omittedHeaders,
    })),
    appendOutput: () => undefined,
  });
  assert.equal(result.profileStatus, "ready");
});

test("staged smoke accepts the unchanged fail-closed creator profile boundary", async () => {
  const baseFetch = stagedFetch();
  const result = await runStagedStaticDexscreenerSmokeV1({
    environment: {
      STAGED_TARGET_URL: "https://candidate.vercel.app/",
      VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
      GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
    },
    fetchImpl: async (url) => {
      if (url.pathname !== "/api/explore/profile") return baseFetch(url);
      return new Response(JSON.stringify({
        status: "error",
        error: {
          kind: "temporary",
          code: "creator_profile_temporarily_unavailable",
          message: "Onchain creator data is temporarily unavailable",
        },
      }), {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
        },
      });
    },
    appendOutput: () => undefined,
  });
  assert.equal(result.profileStatus, "fail-closed-unavailable");
});

test("staged smoke rejects drift or disclosure in a fail-closed profile response", async () => {
  const scenarios = [
    {
      body: {
        status: "error",
        error: {
          kind: "temporary",
          code: "creator_profile_temporarily_unavailable",
          message: "different",
        },
      },
      headers: {},
    },
    {
      body: {
        status: "error",
        error: {
          kind: "temporary",
          code: "creator_profile_temporarily_unavailable",
          message: "Onchain creator data is temporarily unavailable",
          rpcUrl: "https://secret.invalid",
        },
      },
      headers: {},
    },
    {
      body: {
        status: "error",
        error: {
          kind: "temporary",
          code: "creator_profile_temporarily_unavailable",
          message: "Onchain creator data is temporarily unavailable",
        },
      },
      headers: { "x-programmable-rpc-provider": "alchemy" },
    },
  ];
  for (const scenario of scenarios) {
    const baseFetch = stagedFetch();
    await assert.rejects(
      runStagedStaticDexscreenerSmokeV1({
        environment: {
          STAGED_TARGET_URL: "https://candidate.vercel.app/",
          VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
          GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
        },
        fetchImpl: async (url) => {
          if (url.pathname !== "/api/explore/profile") return baseFetch(url);
          return new Response(JSON.stringify(scenario.body), {
            status: 503,
            headers: {
              "cache-control": "no-store",
              "content-type": "application/json",
              ...scenario.headers,
            },
          });
        },
        appendOutput: () => undefined,
      }),
      /profile response is neither ready nor fail-closed/u,
    );
  }
});

test("staged smoke rejects chart market provenance leakage", async () => {
  await assert.rejects(
    runStagedStaticDexscreenerSmokeV1({
      environment: {
        STAGED_TARGET_URL: "https://candidate.vercel.app/",
        VERCEL_AUTOMATION_BYPASS_SECRET: "0123456789abcdef",
        GITHUB_OUTPUT: "/tmp/unused-public-smoke-output",
      },
      fetchImpl: stagedFetch(undefined, ({ extraHeaders, omittedHeaders, url }) => ({
        extraHeaders: url.pathname === "/api/explore/token/chart"
          ? { ...extraHeaders, "x-programmable-market-provider": "dexscreener" }
          : extraHeaders,
        omittedHeaders: url.pathname === "/api/explore/token/chart"
          ? omittedHeaders.filter((name) => name !== "x-programmable-market-provider")
          : omittedHeaders,
      })),
      appendOutput: () => undefined,
    }),
    /chart scope contract is invalid/u,
  );
});

test("post-promotion binds the exact deployment to the same public fast lane", async () => {
  const routeFetch = stagedFetch();
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === "api.vercel.com") {
      return Response.json({
        id: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
        projectId: "prj_programmable_test",
        readyState: "READY",
        meta: { githubCommitSha: "b".repeat(40) },
      });
    }
    return routeFetch(target, init);
  };
  const result = await verifyPostPromotion({
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    requireGmgnMarket: false,
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
  assert.equal(
    result.checks.at(-1)?.id,
    "production-static-identity-dexscreener-public-apis",
  );
});

test("post-promotion fails an exact deployment-id mismatch", async () => {
  const routeFetch = stagedFetch();
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === "api.vercel.com") {
      return Response.json({
        id: "dpl_bbbbbbbbbbbbbbbbbbbbbbbb",
        projectId: "prj_programmable_test",
        readyState: "READY",
        meta: { githubCommitSha: "b".repeat(40) },
      });
    }
    return routeFetch(target, init);
  };
  const result = await verifyPostPromotion({
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    requireGmgnMarket: false,
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(({ id }) => id === "production-deployment-id"));
});

test("post-promotion rejects a non-production origin before fetching", async () => {
  await assert.rejects(
    verifyPostPromotion({
      targetUrl: "https://programmable.market/untrusted",
      expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
      expectedGitHead: "b".repeat(40),
      token: "vercel-test-token",
      teamId: "team_programmable_test",
      projectId: "prj_programmable_test",
      requireGmgnMarket: false,
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
    }),
    /production origin/u,
  );
});

test("post-promotion enforces an explicit production GMGN requirement", async () => {
  const routeFetch = gmgnStagedFetch();
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === "api.vercel.com") {
      return Response.json({
        id: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
        projectId: "prj_programmable_test",
        readyState: "READY",
        meta: { githubCommitSha: "b".repeat(40) },
      });
    }
    return routeFetch(target, init);
  };
  const result = await verifyPostPromotion({
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    requireGmgnMarket: true,
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.failures, []);
});

test("post-promotion fails Dexscreener-only detail when GMGN is required", async () => {
  const routeFetch = stagedFetch();
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    if (target.hostname === "api.vercel.com") {
      return Response.json({
        id: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
        projectId: "prj_programmable_test",
        readyState: "READY",
        meta: { githubCommitSha: "b".repeat(40) },
      });
    }
    return routeFetch(target, init);
  };
  const result = await verifyPostPromotion({
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    requireGmgnMarket: true,
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(({ id }) =>
    id === "production-static-identity-dexscreener-public-apis"
  ));
});

test("post-promotion rejects an omitted or non-Boolean GMGN requirement", async () => {
  const base = {
    targetUrl: "https://programmable.market/",
    expectedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    expectedGitHead: "b".repeat(40),
    token: "vercel-test-token",
    teamId: "team_programmable_test",
    projectId: "prj_programmable_test",
    fetchImpl: async () => {
      throw new Error("fetch must not run");
    },
  };
  await assert.rejects(
    verifyPostPromotion(base),
    /explicit GMGN market requirement boolean/u,
  );
  await assert.rejects(
    verifyPostPromotion({ ...base, requireGmgnMarket: "false" }),
    /explicit GMGN market requirement boolean/u,
  );
});

test("post-promotion has no local GMGN requirement source", () => {
  const source = readFileSync(
    "scripts/perf/read-model-post-promotion.mjs",
    "utf8",
  );
  assert.doesNotMatch(source, /GMGN_API_KEY|input\.environment/u);
  assert.match(source, /String\(input\.requireGmgnMarket\)/u);
});

test("post-promotion CLI requires one exact GMGN Boolean argument", () => {
  const base = [
    "--target-url",
    "https://programmable.market",
    "--deployment-id",
    "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
    "--git-head",
    "b".repeat(40),
  ];
  assert.throws(
    () => parsePostPromotionArguments(base),
    /--require-gmgn-market are required/u,
  );
  assert.throws(
    () => parsePostPromotionArguments([
      ...base,
      "--require-gmgn-market",
      "enabled",
    ]),
    /must be exactly true or false/u,
  );
  assert.equal(
    parsePostPromotionArguments([
      ...base,
      "--require-gmgn-market",
      "true",
    ]).requireGmgnMarket,
    true,
  );
  assert.equal(
    parsePostPromotionArguments([
      ...base,
      "--require-gmgn-market",
      "false",
    ]).requireGmgnMarket,
    false,
  );
});

test("the executable smoke contains no direct RPC or Bitquery reader", () => {
  const source = readFileSync(
    "scripts/smoke-static-dexscreener-public-apis.mjs",
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /PROGRAMMABLE_WEBSITE_MAINNET_RPC|readPrimaryRpc|readBitquery|https?:\/\/[^"'\s]+rpc/iu,
  );
  assert.match(source, /catalogSource/u);
  assert.match(
    source,
    /exactVisibleMarketRead\(newest, newestTokens, validationNowMs\)/u,
  );
  assert.match(
    source,
    /exactMarketCapRanking\(\s*highest,\s*completeCatalogTokens,\s*"desc",/u,
  );
  assert.match(source, /sort=market-cap-asc/u);
  assert.match(source, /x-programmable-ranking-commitment/u);
  assert.match(source, /exactDetailMarketRead\(/u);
  assert.match(source, /environment\.PROGRAMMABLE_REQUIRE_GMGN_MARKET/u);
  assert.match(source, /if \(requireGmgnMarket\)/u);
  assert.match(source, /exactGmgnDetailProof/u);
  assert.match(
    source,
    /qualifiedGmgnFdv\(candidate\.detailToken, now\(\)\.getTime\(\)\)/u,
  );
  assert.match(source, /VISIBLE_EXPLORE_PAGE_SIZE = 9/u);
  assert.match(source, /GMGN_CANONICAL_SCAN_MAXIMUM_PAGES = 8/u);
  assert.match(source, /MINIMUM_FDV_LIQUIDITY_USD_WAD = 10_000n/u);
  assert.match(source, /model=classic/u);
  assert.match(source, /exactGmgnEligibleCanonicalToken/u);
  assert.match(
    source,
    /x-programmable-market-read-status"\) ===\s*"complete"/u,
  );
  assert.match(
    source,
    /marketProvider: newest\.headers\.get\("x-programmable-market-provider"\)/u,
  );
  assert.match(source, /marketReadStatus: newest\.body\.marketRead\.status/u);
  assert.match(source, /verified-identity-market-unavailable/u);
});
