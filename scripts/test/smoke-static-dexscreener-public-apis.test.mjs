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
  return {
    status: "ready",
    tokens,
    page: 1,
    pageSize,
    total: 2,
    totalPages: 1,
    sort,
    sortMetric: "fdv",
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
    ...(sort === "market-cap"
      ? {
          ranking: {
            status: "unavailable",
            requested: "fdv",
            applied: "launch-order",
            qualifiedCount: 0,
            totalCount: 2,
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
        provider: { name: "bitquery", configured: true },
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
    const transformed = transform({ body, url });
    const observed = transformed?.marketRead?.observedCount ?? 0;
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
          }
        : {}),
      ...(url.pathname === "/api/explore/profile"
        ? {
            "x-programmable-launch-source": "envio-classic-v3",
            "x-programmable-read-source": "envio-classic-v3",
            "x-programmable-rpc-provider": "envio-indexer-state",
          }
        : {}),
      ...(observed > 0
        ? {
            "x-programmable-market-source": "dexscreener",
            "x-programmable-price-source": "dexscreener",
          }
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
    return response(
      transformed,
      transformedHeaders.extraHeaders,
      transformedHeaders.omittedHeaders,
    );
  };
}

function gmgnStagedFetch(options = {}) {
  const visibleToken = options.visibleToken ?? gmgnValuedEntry();
  const detailToken = options.detailToken ?? visibleToken;
  const detailReadStatus = options.detailReadStatus ?? "complete";
  const detailProvider = options.detailProvider ?? "gmgn";
  const visibleOldestFetchedAt = options.visibleOldestFetchedAt ?? NOW;
  const visibleNewestFetchedAt = options.visibleNewestFetchedAt ?? NOW;
  return stagedFetch(
    ({ body, url }) => {
      if (
        url.pathname === "/api/explore" &&
        url.searchParams.get("sort") === "newest"
      ) {
        return {
          ...body,
          tokens: [visibleToken, entry(1)],
          marketRead: {
            provider: "gmgn",
            fallbackProvider: "dexscreener",
            status: "partial",
            currency: "USD",
            requestedCount: 2,
            observedCount: 1,
            qualifiedCount: 1,
            unavailableCount: 1,
            gmgnObservedCount: 1,
            gmgnQualifiedCount: 1,
            fallbackRequestedCount: 1,
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
      return body;
    },
    ({ extraHeaders, omittedHeaders, url }) => {
      const newest = url.pathname === "/api/explore" &&
        url.searchParams.get("sort") === "newest";
      const detail = url.pathname === "/api/explore/token";
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
                "x-programmable-market-source": "gmgn",
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
  return stagedFetch(
    (input) => {
      const { url } = input;
      const transformed = pagedTransform(input);
      if (url.pathname === "/api/explore") {
        const sort = url.searchParams.get("sort");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        if (
          sort === "market-cap" &&
          (marketCapProof || marketCapObservedFallback)
        ) {
          const tokens = [...transformed.tokens];
          tokens[0] = dexscreenerValuedEntry(allEntries[0]);
          return {
            ...transformed,
            tokens,
            marketRead: {
              ...marketRead(entryCount),
              status: "partial",
              observedCount: 1,
              qualifiedCount: 1,
              unavailableCount: entryCount - 1,
              oldestFetchedAt: NOW,
              newestFetchedAt: NOW,
            },
            ranking: {
              status: "partial",
              requested: "fdv",
              applied: "qualified-fdv-then-launch-order",
              qualifiedCount: 1,
              totalCount: entryCount,
            },
            dataQuality: {
              ...transformed.dataQuality,
              valuation: {
                ...transformed.dataQuality.valuation,
                status: "provider-recent",
                available: 1,
                unavailable: entryCount - 1,
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
      const qualifiedCount = options.duplicateHighest && sort === "market-cap"
        ? allEntries.length
        : options.phantomHighest && sort === "market-cap"
          ? 1
          : 0;
      const requestedCount = sort === "market-cap"
        ? allEntries.length
        : tokens.length;
      return {
        ...body,
        tokens,
        page,
        pageSize,
        total: allEntries.length,
        totalPages: Math.ceil(allEntries.length / pageSize),
        marketRead: {
          ...marketRead(requestedCount),
          ...(qualifiedCount === 0
            ? {}
            : {
                status: "complete",
                observedCount: qualifiedCount,
                qualifiedCount,
                unavailableCount: requestedCount - qualifiedCount,
                oldestFetchedAt: NOW,
                newestFetchedAt: NOW,
              }),
        },
        dataQuality: {
          ...body.dataQuality,
          valuation: {
            ...body.dataQuality.valuation,
            ...(qualifiedCount === 0
              ? {}
              : {
                  status: "provider-recent",
                  available: qualifiedCount,
                  unavailable: allEntries.length - qualifiedCount,
                  asOfTime: NOW,
                }),
          },
        },
        catalog: {
          ...body.catalog,
          identityCount: allEntries.length,
        },
        ...(sort === "market-cap"
          ? {
              ranking: options.duplicateHighest
                ? {
                    status: "complete",
                    requested: "fdv",
                    applied: "fdv",
                    qualifiedCount,
                    totalCount: allEntries.length,
                  }
                : qualifiedCount === 0
                ? { ...body.ranking, totalCount: allEntries.length }
                : {
                    status: "partial",
                    requested: "fdv",
                    applied: "qualified-fdv-then-launch-order",
                    qualifiedCount,
                    totalCount: allEntries.length,
                  },
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
  assert.equal(output.length, 1);
  assert.match(output[0][1], /market_provider=dexscreener/u);
  assert.match(output[0][1], /market_read_status=unavailable/u);
  assert.match(output[0][1], /detail_market_provider=dexscreener/u);
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
  assert.match(output[0][1], /market_provider=gmgn\+dexscreener/u);
  assert.match(output[0][1], /detail_market_provider=gmgn/u);
  assert.match(output[0][1], /detail_status=verified-gmgn-market/u);
  assert.ok(requests.some((url) =>
    url.pathname === "/api/explore" &&
    url.searchParams.get("limit") === "9" &&
    url.searchParams.get("sort") === "newest" &&
    url.searchParams.get("model") === null
  ));
  assert.ok(requests.some((url) =>
    url.pathname === "/api/explore" &&
    url.searchParams.get("limit") === "9" &&
    url.searchParams.get("sort") === "newest" &&
    url.searchParams.get("model") === "classic"
  ));
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
    /Highest FDV response contract is invalid/u,
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
  assert.equal(exploreReads, 4);
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
  assert.equal(exploreReads, 4);
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
  assert.equal(exploreReads, 4);
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
  assert.equal(exploreReads, 2);
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
    assert.equal(exploreReads, 2);
    assert.equal(detailReads, 1);
    assert.deepEqual(waits, []);
  }
});

test("staged smoke rejects a partial ranking with no qualified first-page row", async () => {
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
              marketRead: {
                ...body.marketRead,
                status: "complete",
                observedCount: 1,
                qualifiedCount: 1,
                unavailableCount: 1,
              },
              ranking: {
                status: "partial",
                requested: "fdv",
                applied: "qualified-fdv-then-launch-order",
                qualifiedCount: 1,
                totalCount: 2,
              },
            }
          : body),
      appendOutput: () => undefined,
    }),
    /Highest FDV response contract is invalid/u,
  );
});

test("staged smoke rejects ranking qualification without market evidence", async () => {
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
              tokens: [
                {
                  ...body.tokens[0],
                  valuation: {
                    status: "available",
                    metric: "fdv",
                    supplyBasis: "total",
                    currency: "usd",
                    freshness: "provider-recent",
                    source: "dexscreener",
                    valueWad: "1000000000000000000",
                  },
                },
                body.tokens[1],
              ],
              marketRead: {
                ...body.marketRead,
                status: "complete",
                observedCount: 1,
                qualifiedCount: 0,
              },
              ranking: {
                status: "partial",
                requested: "fdv",
                applied: "qualified-fdv-then-launch-order",
                qualifiedCount: 1,
                totalCount: 2,
              },
            }
          : body),
      appendOutput: () => undefined,
    }),
    /Highest FDV response contract is invalid/u,
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

test("staged smoke binds Highest FDV to the complete paged identity set", async () => {
  const allEntries = Array.from({ length: 21 }, (_, index) => entry(index));
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

test("staged smoke rejects a phantom on the Highest FDV page", async () => {
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
    /Highest FDV page is outside the paged catalog/u,
  );
});

test("staged smoke rejects duplicate identities on the Highest FDV page", async () => {
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
    /Highest FDV page is outside the paged catalog/u,
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
            }
          : body),
      appendOutput: () => undefined,
    });
  assert.equal(result.healthStatus, "degraded");
  assert.equal(result.healthAuthority, "informational-only");
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
    /chart pool-bound contract is invalid/u,
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
    /exactDexscreenerMarketRead\(\s*highest,\s*completeCatalogTokens,/u,
  );
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
