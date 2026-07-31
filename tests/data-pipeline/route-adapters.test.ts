import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  IndexedRouteAdapterError,
  adaptIndexedChartV2,
  adaptIndexedClassicV3ProfileV2,
  adaptIndexedCreatorProfileV2,
  adaptIndexedExploreListV2,
  adaptIndexedLaunchLookupV2,
  adaptIndexedStockPairedProfileV2,
  adaptIndexedTokenDetailV2,
  assertSupportedIndexedReleaseV2,
  indexedRouteCacheHeaders,
  type IndexedExploreCursorV2,
  type IndexedRouteEnvelopeV2,
  type IndexedRouteKeyV2,
  type IndexedRowSourceV2,
  type IndexedSnapshotIdentityV2,
  type IndexedTokenProjectionV2,
} from "../../lib/data-pipeline/route-adapters.server";

const TOKEN_A = "0x1111111111111111111111111111111111111111";
const TOKEN_B = "0x2222222222222222222222222222222222222222";
const TOKEN_C = "0x3333333333333333333333333333333333333333";
const TOKEN_D = "0x4444444444444444444444444444444444444444";
const TOKEN_E = "0x5555555555555555555555555555555555555555";
const CREATOR = "0x6666666666666666666666666666666666666666";
const OTHER = "0x7777777777777777777777777777777777777777";
const HOOK = "0x8888888888888888888888888888888888888888";
const VAULT = "0x9999999999999999999999999999999999999999";
const QUOTE = "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa";
const POSITION = "0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB";
const POOL_ID = `0x${"aa".repeat(32)}` as const;
const LAUNCH_HASH = `0x${"bb".repeat(32)}` as const;
const TRANSACTION_HASH = `0x${"cc".repeat(32)}` as const;
const BLOCK_HASH = `0x${"dd".repeat(32)}` as const;
const SNAPSHOT_COMMITMENT = `0x${"ee".repeat(32)}` as const;
const PUBLICATION_COMMITMENT = `0x${"12".repeat(32)}` as const;

type Release =
  | "classic-v2"
  | "classic-v3"
  | "stock-paired-v1"
  | "stock-paired-v2"
  | "stock-paired-v3";

function modelFor(release: Release) {
  return release.startsWith("stock-paired")
    ? ("stock-paired" as const)
    : ("classic" as const);
}

function epochFor(release: Release) {
  const suffix = {
    "classic-v2": "0001",
    "classic-v3": "0002",
    "stock-paired-v1": "0003",
    "stock-paired-v2": "0004",
    "stock-paired-v3": "0005",
  }[release];
  return `10000000-0000-4000-8000-00000000${suffix}`;
}

const ALL_RELEASES = [
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const;

function pointer(release: Release, routeKey: IndexedRouteKeyV2) {
  const index = ALL_RELEASES.indexOf(release);
  return {
    routeKey,
    chainId: 1 as const,
    releaseVersion: release,
    modelVersion: modelFor(release),
    sourceGroup: `source-${release}`,
    projectorVersion: "public-route-projector-v2",
    epochId: epochFor(release),
    pointerGeneration: String(index + 1),
    checkpointId: `20000000-0000-4000-8000-00000000000${index + 1}`,
    checkpointGeneration: "7",
    reorgGeneration: "0",
    checkpointBlockNumber: "25660000",
    checkpointBlockHash: BLOCK_HASH,
  };
}

function snapshotFor(
  routeKey: IndexedRouteKeyV2,
  releases: readonly Release[] = ALL_RELEASES,
): IndexedSnapshotIdentityV2 {
  return {
    adapterVersion: "indexed-route-adapters-v2",
    snapshotCommitment: SNAPSHOT_COMMITMENT,
    chainId: 1,
    blockNumber: "25660000",
    blockHash: BLOCK_HASH,
    confirmations: 12,
    capturedAt: "2026-07-31T10:00:00.000Z",
    releasePointers: releases.map((release) => pointer(release, routeKey)),
    ethUsdQuote: {
      feedAddress: QUOTE,
      roundId: "200",
      answer: "350000000000",
      decimals: 8,
      updatedAt: "2026-07-31T09:59:00.000Z",
    },
  };
}

const snapshot = snapshotFor("explore-list");

function source(
  release: Release,
  routeKey: IndexedRouteKeyV2,
  blockNumber = "25650000",
): IndexedRowSourceV2 {
  return {
    ...pointer(release, routeKey),
    snapshotCommitment: SNAPSHOT_COMMITMENT,
    projectionRunId: `30000000-0000-4000-8000-00000000000${ALL_RELEASES.indexOf(release) + 1}`,
    publicationCommitment: PUBLICATION_COMMITMENT,
    promotedBlockNumber: blockNumber,
    promotedBlockHash: BLOCK_HASH,
  };
}

function token(
  release: Release,
  tokenAddress: `0x${string}`,
  routeKey: IndexedRouteKeyV2,
  blockNumber = "25650000",
): IndexedTokenProjectionV2 {
  const stock = release.startsWith("stock-paired");
  return {
    source: source(release, routeKey, blockNumber),
    tokenAddress,
    hookAddress: HOOK,
    poolId: POOL_ID,
    creatorAddress: CREATOR,
    positionRecipient: POSITION,
    positionTokenId: "42",
    rewardVaultAddress: release === "classic-v2" ? null : VAULT,
    launchHash: LAUNCH_HASH,
    launchBlockNumber: blockNumber,
    launchTransactionHash: TRANSACTION_HASH,
    launchTransactionIndex: 3,
    launchLogIndex: 9,
    launchedAt: "2026-07-31T08:00:00.000Z",
    name: `Token ${release}`,
    symbol: release === "classic-v2" ? "C2" : release.toUpperCase(),
    decimals: 18,
    totalSupplyRaw: "1000000000000000000000000000",
    metadata: {
      revision: "2",
      createdAt: "2026-07-31T08:00:10.000Z",
      description: "  A verified indexed token  ",
      imageUrl: "https://programmable.family/token.png",
      links: [
        {
          kind: "website",
          url: "https://programmable.family/",
          displayOrder: 0,
        },
        {
          kind: "x",
          url: "https://x.com/0xProgrammable",
          displayOrder: 1,
        },
      ],
      extraData: "0x",
    },
    liquidity: {
      tokenLiquidityAmountRaw: "900000000000000000000000000",
      lockedTokenDustRaw: "1",
      currentTick: 120,
      initialTick: 100,
      tickLower: -887200,
      tickUpper: 887200,
      activeLiquidity: "123456789012345678901234567890",
    },
    fees: stock
      ? {
          totalSwapFeeBps: 100,
          buySwapFeeBps: 100,
          sellSwapFeeBps: 100,
          buyCreatorFeeBps: 90,
          sellCreatorFeeBps: 90,
          launcherFeeBps: 10,
          transferTaxBps: 0,
          lpFeePips: 0,
          protocolFeePips: 0,
        }
      : {
          totalSwapFeeBps: release === "classic-v3" ? 300 : 200,
          buySwapFeeBps: release === "classic-v3" ? 300 : 200,
          sellSwapFeeBps: release === "classic-v3" ? 100 : 200,
          buyCreatorFeeBps: release === "classic-v3" ? 290 : 190,
          sellCreatorFeeBps: release === "classic-v3" ? 90 : 190,
          launcherFeeBps: 10,
          transferTaxBps: 0,
          lpFeePips: 0,
          protocolFeePips: 0,
        },
    market: {
      tokenPriceNativeWei: stock ? null : "2500000000000",
      marketCapNativeWei: stock ? null : "2500000000000000000",
      indexedMarketCapNativeWei: stock ? null : "2600000000000000000",
      indexedMarketCapUsdWad: stock
        ? "1200000000000000000000000"
        : "9100000000000000000000",
      indexedValuationBlockNumber: "25659999",
      fdvUsdWad: stock ? "1200000000000000000000000" : null,
      grossVolumeNativeWei: stock ? null : "1234500000000000000",
      creatorFeesGeneratedNativeWei: stock ? null : "100000000000000000",
      launcherFeesGeneratedNativeWei: stock ? null : "10000000000000000",
      creatorFeesAccruedNativeWei: stock ? null : "40000000000000000",
      swapCount: 123,
    },
    quote: stock
      ? {
          address: QUOTE,
          symbol: "SPYON",
          name: "Tokenized S&P 500",
          decimals: 18,
          isCurrency0: true,
          tokenPriceQuoteWad: "2500000000000000000",
          marketCapQuoteWad: "2500000000000000000000000",
          grossVolumeQuoteRaw: "700000000000000000000",
          creatorFeesGeneratedQuoteRaw: "6300000000000000000",
          programmableFeesGeneratedQuoteRaw: "700000000000000000",
          creatorFeesAccruedQuoteRaw: "1100000000000000000",
        }
      : null,
    initialBuy: stock
      ? {
          nativeWei: "600000000000000",
          quoteRaw: "1500000000000000000",
          tokenRaw: "240000000000000000000000",
        }
      : {
          nativeWei: "600000000000000",
          quoteRaw: null,
          tokenRaw: "240000000000000000000000",
        },
    uniswapV4Pool: {
      source: "official-uniswap-v4-subgraph",
      indexedBlockNumber: "25659999",
      indexedBlockHash: BLOCK_HASH,
      volumeUsdWad: "4321000000000000000000",
      tvlUsdWad: "9876000000000000000000",
      transactionCount: "123",
      liquidity: "456",
      sqrtPriceX96: "79228162514264337593543950336",
      tick: 120,
      feeTierPips: "0",
    },
  };
}

function ready<T>(data: T): IndexedRouteEnvelopeV2<T> {
  const value = data as Record<string, unknown>;
  let routeKey: IndexedRouteKeyV2;
  let releases: readonly Release[] = ALL_RELEASES;
  if ("request" in value) {
    routeKey = "explore-list";
  } else if ("range" in value) {
    routeKey = "explore-chart";
  } else if ("address" in value && !("surface" in value)) {
    routeKey = "explore-token";
  } else if ("surface" in value) {
    routeKey = "launch-lookup";
    releases = value.surface === "classic-v3"
      ? ["classic-v3"]
      : ["stock-paired-v1", "stock-paired-v2", "stock-paired-v3"];
  } else if ("tokens" in value) {
    routeKey = "creator-profile";
  } else {
    const firstReward = (value.rewards as { source?: IndexedRowSourceV2 }[] | undefined)?.[0];
    routeKey = firstReward?.source?.routeKey ?? "classic-v3-profile";
    releases = routeKey === "classic-v3-profile"
      ? ["classic-v3"]
      : ["stock-paired-v1", "stock-paired-v2", "stock-paired-v3"];
  }
  return { status: "ready", snapshot: snapshotFor(routeKey, releases), data };
}

function expectAdapterError(
  operation: () => unknown,
  code: IndexedRouteAdapterError["code"],
) {
  try {
    operation();
    throw new Error("expected adapter failure");
  } catch (error) {
    expect(error).toBeInstanceOf(IndexedRouteAdapterError);
    expect((error as IndexedRouteAdapterError).code).toBe(code);
  }
}

describe("indexed route adapter v2 release boundary", () => {
  it.each([
    ["classic-v2", "classic", "classic", undefined],
    ["classic-v3", "classic", "classic", "classic-v3"],
    ["stock-paired-v1", "stock-paired", "stock-paired", "stock-paired-v1"],
    ["stock-paired-v2", "stock-paired", "stock-paired", "stock-paired-v2"],
    ["stock-paired-v3", "stock-paired", "stock-paired", "stock-paired-v3"],
  ] as const)(
    "maps %s only with its exact indexed model",
    (releaseVersion, modelVersion, launchModel, launchModelVersion) => {
      expect(
        assertSupportedIndexedReleaseV2({ releaseVersion, modelVersion }),
      ).toEqual({
        releaseVersion,
        modelVersion,
        launchModel,
        ...(launchModelVersion ? { launchModelVersion } : {}),
      });
    },
  );

  it.each([
    ["classic-v3", "stock-paired"],
    ["stock-paired-v2", "classic"],
    ["deep-full-range-v3", "deep"],
    ["unresolved", "unresolved"],
  ])("rejects unsupported or relabelled source %s/%s", (releaseVersion, modelVersion) => {
    expectAdapterError(
      () => assertSupportedIndexedReleaseV2({ releaseVersion, modelVersion }),
      "unsupported-release",
    );
  });

  it("rejects checkpoint, projector and reorg evidence that is not snapshot-bound", () => {
    const wrongCheckpoint = snapshotFor("explore-token");
    wrongCheckpoint.releasePointers[0]!.checkpointBlockHash =
      `0x${"01".repeat(32)}`;
    expectAdapterError(
      () =>
        adaptIndexedTokenDetailV2({
          status: "ready",
          snapshot: wrongCheckpoint,
          data: { address: TOKEN_A, token: null },
        }),
      "snapshot-mismatch",
    );

    const wrongGeneration = token(
      "classic-v3",
      TOKEN_A,
      "explore-token",
    );
    wrongGeneration.source.reorgGeneration = "1";
    expectAdapterError(
      () =>
        adaptIndexedTokenDetailV2(
          ready({ address: TOKEN_A, token: wrongGeneration }),
        ),
      "snapshot-mismatch",
    );
  });
});

describe("indexed route cache policy", () => {
  it("uses short shared cache windows only for public immutable snapshots", () => {
    expect(indexedRouteCacheHeaders("explore-list")).toEqual({
      "Cache-Control":
        "public, max-age=0, s-maxage=10, stale-while-revalidate=10",
    });
    expect(indexedRouteCacheHeaders("token-detail")).toEqual({
      "Cache-Control":
        "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
    });
    expect(indexedRouteCacheHeaders("token-chart")).toEqual({
      "Cache-Control":
        "public, max-age=0, s-maxage=15, stale-while-revalidate=15",
    });
    expect(indexedRouteCacheHeaders("creator-profile")).toEqual({
      "Cache-Control": "private, max-age=0, s-maxage=15",
    });
    expect(indexedRouteCacheHeaders("launch-lookup")).toEqual({
      "Cache-Control": "no-store",
    });
    expect(indexedRouteCacheHeaders("token-detail", "not-found")).toEqual({
      "Cache-Control": "no-store",
    });
  });
});

describe("indexed Explore list adapter v2", () => {
  it("preserves the public page shape for all supported release generations", () => {
    const tokens = [
      token("stock-paired-v3", TOKEN_E, "explore-list", "25650005"),
      token("stock-paired-v2", TOKEN_D, "explore-list", "25650004"),
      token("stock-paired-v1", TOKEN_C, "explore-list", "25650003"),
      token("classic-v3", TOKEN_B, "explore-list", "25650002"),
      token("classic-v2", TOKEN_A, "explore-list", "25650001"),
    ];
    const endAt: IndexedExploreCursorV2 = {
      adapterVersion: "indexed-route-adapters-v2",
      snapshotCommitment: SNAPSHOT_COMMITMENT,
      normalizedQuery: "",
      sort: "newest",
      pageSize: 5,
      valuationUnit: null,
      position: {
        marketCapAtomic: null,
        launchBlockNumber: "25650001",
        launchTransactionIndex: 3,
        launchLogIndex: 9,
        launchTransactionHash: TRANSACTION_HASH,
        tokenAddress: TOKEN_A,
      },
    };

    const response = adaptIndexedExploreListV2(
      ready({
        request: {
          query: "",
          sort: "newest",
          requestedPage: 1,
          pageSize: 5,
        },
        page: {
          resolvedPage: 1,
          totalCount: "5",
          valuationUnit: null,
          startAfter: null,
          endAt,
        },
        launcherFeesAccruedWei: "123456789012345678901234567890",
        tokens,
      }),
    );

    expect(response).toMatchObject({
      status: "ready",
      page: 1,
      pageSize: 5,
      total: 5,
      totalPages: 1,
      sort: "newest",
      query: "",
      snapshot: {
        chainId: 1,
        blockNumber: snapshot.blockNumber,
        blockHash: snapshot.blockHash,
        confirmations: 12,
      },
      launcherFeesAccruedWei: "123456789012345678901234567890",
      launcherFeesAccruedEth: "123456789012.34567890123456789",
    });
    expect(response.tokens.map((entry) => entry.launchModelVersion)).toEqual([
      "stock-paired-v3",
      "stock-paired-v2",
      "stock-paired-v1",
      "classic-v3",
      undefined,
    ]);
    expect(response.tokens[0]).toMatchObject({
      id: `1:${TOKEN_E}`,
      description: "A verified indexed token",
      imageUrl: "https://programmable.family/token.png",
      links: [
        { kind: "website", url: "https://programmable.family/" },
        { kind: "x", url: "https://x.com/0xProgrammable" },
      ],
      totalSupply: "1000000000",
      totalSupplyRaw: "1000000000000000000000000000",
      quoteAssetAddress: QUOTE,
      grossVolumeQuote: "700",
      grossVolumeQuoteRaw: "700000000000000000000",
      marketCapQuote: "2500000",
      marketCapQuoteWad: "2500000000000000000000000",
      launchModel: "stock-paired",
      liquidityPath: "meme",
    });
    expect(response.tokens[3]).toMatchObject({
      totalSwapFeeBps: 300,
      buyHookFeeBps: 300,
      sellHookFeeBps: 100,
      buyCreatorFeeBps: 290,
      sellCreatorFeeBps: 90,
      launcherFeeBps: 10,
      launchModel: "classic",
      launchModelVersion: "classic-v3",
    });
    expect(JSON.stringify(response)).not.toContain("pointerGeneration");
    expect(JSON.stringify(response)).not.toContain("snapshotCommitment");
    expect(() => JSON.stringify(response)).not.toThrow();
  });

  it("binds a later page to the complete market-cap cursor and immutable snapshot", () => {
    const first = token("classic-v3", TOKEN_B, "explore-list", "25650002");
    first.market.indexedMarketCapUsdWad = "900";
    const second = token("classic-v2", TOKEN_A, "explore-list", "25650001");
    second.market.indexedMarketCapUsdWad = "800";
    const startAfter: IndexedExploreCursorV2 = {
      adapterVersion: "indexed-route-adapters-v2",
      snapshotCommitment: SNAPSHOT_COMMITMENT,
      normalizedQuery: "token",
      sort: "market-cap",
      pageSize: 2,
      valuationUnit: "usd-wad",
      position: {
        marketCapAtomic: "1000",
        launchBlockNumber: "25650003",
        launchTransactionIndex: 3,
        launchLogIndex: 9,
        launchTransactionHash: TRANSACTION_HASH,
        tokenAddress: TOKEN_C,
      },
    };
    const endAt: IndexedExploreCursorV2 = {
      ...startAfter,
      position: {
        marketCapAtomic: "800",
        launchBlockNumber: "25650001",
        launchTransactionIndex: 3,
        launchLogIndex: 9,
        launchTransactionHash: TRANSACTION_HASH,
        tokenAddress: TOKEN_A,
      },
    };

    const response = adaptIndexedExploreListV2(
      ready({
        request: {
          query: "$token",
          sort: "market-cap",
          requestedPage: 2,
          pageSize: 2,
        },
        page: {
          resolvedPage: 2,
          totalCount: "4",
          valuationUnit: "usd-wad",
          startAfter,
          endAt,
        },
        launcherFeesAccruedWei: "0",
        tokens: [first, second],
      }),
    );

    expect(response.page).toBe(2);
    expect(response.tokens.map((entry) => entry.tokenAddress)).toEqual([
      TOKEN_B,
      TOKEN_A,
    ]);

    expectAdapterError(
      () =>
        adaptIndexedExploreListV2(
          ready({
            request: {
              query: "$token",
              sort: "market-cap",
              requestedPage: 2,
              pageSize: 2,
            },
            page: {
              resolvedPage: 2,
              totalCount: "4",
              valuationUnit: "usd-wad",
              startAfter: {
                ...startAfter,
                snapshotCommitment: `0x${"ff".repeat(32)}`,
              },
              endAt,
            },
            launcherFeesAccruedWei: "0",
            tokens: [first, second],
          }),
        ),
      "cursor-mismatch",
    );
  });

  it("rejects rows from another route or unstable page order instead of partial output", () => {
    const first = token("classic-v3", TOKEN_A, "explore-list", "25650001");
    const later = token("classic-v2", TOKEN_B, "explore-list", "25650002");
    const badRoute = token("classic-v2", TOKEN_B, "creator-profile", "25650000");
    const page = {
      request: { query: "", sort: "newest" as const, requestedPage: 1, pageSize: 2 },
      page: {
        resolvedPage: 1,
        totalCount: "2",
        valuationUnit: null,
        startAfter: null,
        endAt: {
          adapterVersion: "indexed-route-adapters-v2" as const,
          snapshotCommitment: SNAPSHOT_COMMITMENT,
          normalizedQuery: "",
          sort: "newest" as const,
          pageSize: 2,
          valuationUnit: null,
          position: {
            marketCapAtomic: null,
            launchBlockNumber: "25650002",
            launchTransactionIndex: 3,
            launchLogIndex: 9,
            launchTransactionHash: TRANSACTION_HASH,
            tokenAddress: TOKEN_B,
          },
        },
      },
      launcherFeesAccruedWei: "0",
    };

    expectAdapterError(
      () =>
        adaptIndexedExploreListV2(
          ready({
            ...page,
            page: {
              ...page.page,
              endAt: page.page.endAt as IndexedExploreCursorV2,
            },
            tokens: [first, later],
          }),
        ),
      "cursor-mismatch",
    );
    expectAdapterError(
      () =>
        adaptIndexedExploreListV2(
          ready({
            ...page,
            page: {
              ...page.page,
              endAt: page.page.endAt as IndexedExploreCursorV2,
            },
            tokens: [later, badRoute],
          }),
        ),
      "scope-mismatch",
    );
  });
});

describe("indexed token-detail adapter v2", () => {
  it("returns exactly the existing ready token-detail body", () => {
    const projection = token("classic-v3", TOKEN_A, "explore-token");
    expect(
      adaptIndexedTokenDetailV2(
        ready({ address: TOKEN_A, token: projection }),
      ),
    ).toEqual({
      status: "ready",
      token: expect.objectContaining({
        tokenAddress: TOKEN_A,
        name: "Token classic-v3",
        launchModelVersion: "classic-v3",
      }),
      snapshot: {
        chainId: 1,
        blockNumber: snapshot.blockNumber,
        blockHash: snapshot.blockHash,
        confirmations: 12,
        ethUsdQuote: snapshot.ethUsdQuote,
      },
    });
  });

  it("keeps a verified empty lookup distinct from a not-ready index", () => {
    expect(
      adaptIndexedTokenDetailV2(ready({ address: TOKEN_A, token: null })),
    ).toEqual({
      status: "ready",
      token: null,
      snapshot: expect.objectContaining({ blockNumber: snapshot.blockNumber }),
    });
    expectAdapterError(
      () =>
        adaptIndexedTokenDetailV2({
          status: "not-ready",
          reason: "projection-lag",
        }),
      "not-ready",
    );
  });
});

describe("indexed chart adapter v2", () => {
  it("maps exact atomic native and USD values without Number conversion", () => {
    const response = adaptIndexedChartV2(
      ready({
        address: TOKEN_A,
        range: "1d",
        source: source("classic-v3", "explore-chart"),
        poolId: POOL_ID,
        points: [
          {
            blockNumber: "25650001",
            priceNativeWei: "123456789012345678901234567890",
            priceUsdWad: "432109876543210987654321098765",
          },
          {
            blockNumber: "25650002",
            priceNativeWei: "223456789012345678901234567890",
            priceUsdWad: null,
          },
        ],
        swapCount: "9007199254740991",
        volumeNativeWei: "987654321098765432109876543210",
        volumeUsdWad: "345678901234567890123456789012",
      }),
    );

    expect(response).toEqual({
      status: "ready",
      points: [
        {
          blockNumber: "25650001",
          priceEth: "123456789012.34567890123456789",
          priceUsd: "432109876543.210987654321098765",
        },
        {
          blockNumber: "25650002",
          priceEth: "223456789012.34567890123456789",
        },
      ],
      swapCount: 9_007_199_254_740_991,
      volumeWei: "987654321098765432109876543210",
      volumeEth: "987654321098.76543210987654321",
      volumeUsdWad: "345678901234567890123456789012",
      range: "1d",
      snapshotBlock: snapshot.blockNumber,
    });
  });

  it.each(["stock-paired-v1", "stock-paired-v2", "stock-paired-v3"] as const)(
    "preserves the current insufficient-history behavior for %s",
    (release) => {
      expect(
        adaptIndexedChartV2(
          ready({
            address: TOKEN_A,
            range: "all",
            source: source(release, "explore-chart"),
            poolId: POOL_ID,
            points: [],
            swapCount: "0",
            volumeNativeWei: "0",
            volumeUsdWad: null,
          }),
        ),
      ).toEqual({
        status: "insufficient-history",
        points: [],
        swapCount: 0,
        volumeWei: "0",
        volumeEth: "0",
        range: "all",
        snapshotBlock: snapshot.blockNumber,
      });
    },
  );

  it("rejects an unsafe count instead of losing precision", () => {
    expectAdapterError(
      () =>
        adaptIndexedChartV2(
          ready({
            address: TOKEN_A,
            range: "all",
            source: source("classic-v2", "explore-chart"),
            poolId: POOL_ID,
            points: [],
            swapCount: "9007199254740992",
            volumeNativeWei: "0",
            volumeUsdWad: null,
          }),
        ),
      "precision-loss",
    );
  });
});

describe("indexed creator-profile adapter v2", () => {
  it("keeps Stock launches in tokens, excludes them from native pools, and sums bigint totals", () => {
    const classicV2 = token("classic-v2", TOKEN_A, "creator-profile", "25650001");
    const classicV3 = token("classic-v3", TOKEN_B, "creator-profile", "25650002");
    const stock = token("stock-paired-v3", TOKEN_C, "creator-profile", "25650003");
    classicV2.market.creatorFeesAccruedNativeWei = "100000000000000000000000000000";
    classicV2.market.creatorFeesGeneratedNativeWei = "300000000000000000000000000000";
    classicV3.market.creatorFeesAccruedNativeWei = "200000000000000000000000000000";
    classicV3.market.creatorFeesGeneratedNativeWei = "400000000000000000000000000000";

    const response = adaptIndexedCreatorProfileV2(
      ready({
        account: CREATOR,
        tokens: [classicV2, classicV3, stock],
        claims: [
          {
            source: source("classic-v2", "creator-profile", "25650010"),
            poolId: POOL_ID,
            tokenAddress: TOKEN_A,
            creatorAddress: CREATOR,
            recipientAddress: CREATOR,
            callerAddress: OTHER,
            amountWei: "90000000000000000000000000000",
            blockNumber: "25650010",
            transactionHash: TRANSACTION_HASH,
            transactionIndex: 2,
            logIndex: 4,
            claimedAt: "2026-07-31T09:00:00.000Z",
          },
        ],
      }),
    );

    expect(response.tokens).toHaveLength(3);
    expect(response.pools).toHaveLength(2);
    expect(response.pools.map((entry) => entry.launchModel)).toEqual([
      "classic",
      "classic",
    ]);
    expect(response.totals).toEqual({
      claimableWei: "300000000000000000000000000000",
      claimableEth: "300000000000",
      generatedWei: "700000000000000000000000000000",
      generatedEth: "700000000000",
      claimedWei: "90000000000000000000000000000",
      claimedEth: "90000000000",
    });
    expect(response.claims[0]).toMatchObject({
      amountWei: "90000000000000000000000000000",
      amountEth: "90000000000",
      creatorAddress: CREATOR,
    });
  });

  it("rejects a profile row scoped to another creator", () => {
    const foreign = token("classic-v2", TOKEN_A, "creator-profile");
    foreign.creatorAddress = OTHER;
    expectAdapterError(
      () =>
        adaptIndexedCreatorProfileV2(
          ready({ account: CREATOR, tokens: [foreign], claims: [] }),
        ),
      "scope-mismatch",
    );
  });
});

describe("indexed Classic V3 profile adapter v2", () => {
  it("preserves the existing rewards DTO and exact ETH formatting", () => {
    const response = adaptIndexedClassicV3ProfileV2(
      ready({
        account: CREATOR,
        chainId: 1,
        rewards: [
          {
            source: source("classic-v3", "classic-v3-profile"),
            tokenAddress: TOKEN_A,
            tokenName: "Classic reward",
            tokenSymbol: "CRW",
            poolId: POOL_ID,
            vaultAddress: VAULT,
            claimableWei: "123456789012345678901234567890",
            claimedWei: "98765432109876543210987654321",
            buySwapFeeBps: 300,
            sellSwapFeeBps: 100,
            platformFeeBps: 10,
            allocations: [
              {
                allocationIndex: 0,
                beneficiary: CREATOR,
                payoutAddress: CREATOR,
                shareBps: 6000,
              },
              {
                allocationIndex: 1,
                beneficiary: OTHER,
                payoutAddress: OTHER,
                shareBps: 4000,
              },
            ],
            launchTransactionHash: TRANSACTION_HASH,
          },
        ],
      }),
    );

    expect(response).toEqual({
      status: "ready",
      account: CREATOR,
      chainId: 1,
      rewards: [
        {
          tokenAddress: TOKEN_A,
          tokenName: "Classic reward",
          tokenSymbol: "CRW",
          poolId: POOL_ID,
          vaultAddress: VAULT,
          beneficiary: CREATOR,
          payoutAddress: CREATOR,
          shareBps: 6000,
          ownedAllocations: [
            {
              allocationIndex: 0,
              beneficiary: CREATOR,
              payoutAddress: CREATOR,
              shareBps: 6000,
            },
          ],
          claimableWei: "123456789012345678901234567890",
          claimableEth: "123456789012.34567890123456789",
          claimedWei: "98765432109876543210987654321",
          claimedEth: "98765432109.876543210987654321",
          buySwapFeeBps: 300,
          sellSwapFeeBps: 100,
          platformFeeBps: 10,
          beneficiaries: [
            {
              allocationIndex: 0,
              beneficiary: CREATOR,
              payoutAddress: CREATOR,
              shareBps: 6000,
            },
            {
              allocationIndex: 1,
              beneficiary: OTHER,
              payoutAddress: OTHER,
              shareBps: 4000,
            },
          ],
          launchTransactionHash: TRANSACTION_HASH,
        },
      ],
    });
  });

  it("fails closed on payout semantics the current client cannot represent", () => {
    expectAdapterError(
      () =>
        adaptIndexedClassicV3ProfileV2(
          ready({
            account: CREATOR,
            chainId: 1,
            rewards: [
              {
                source: source("classic-v3", "classic-v3-profile"),
                tokenAddress: TOKEN_A,
                tokenName: "Classic reward",
                tokenSymbol: "CRW",
                poolId: POOL_ID,
                vaultAddress: VAULT,
                claimableWei: "1",
                claimedWei: "0",
                buySwapFeeBps: 100,
                sellSwapFeeBps: 100,
                platformFeeBps: 10,
                allocations: [
                  {
                    allocationIndex: 0,
                    beneficiary: OTHER,
                    payoutAddress: CREATOR,
                    shareBps: 10_000,
                  },
                ],
                launchTransactionHash: TRANSACTION_HASH,
              },
            ],
          }),
        ),
      "not-ready",
    );
  });
});

describe("indexed Stock-Paired profile adapter v2", () => {
  it("preserves beneficiary rewards and quote-denominated estimates", () => {
    const response = adaptIndexedStockPairedProfileV2(
      ready({
        account: CREATOR,
        chainId: 1,
        rewards: [
          {
            source: source("stock-paired-v3", "creator-profile"),
            tokenAddress: TOKEN_A,
            tokenName: "Stock reward",
            tokenSymbol: "STK",
            imageUrl: "https://programmable.family/token.png",
            hookAddress: HOOK,
            poolId: POOL_ID,
            vaultAddress: VAULT,
            quoteAsset: QUOTE,
            quoteAssetSymbol: "SPYON",
            beneficiary: CREATOR,
            payoutAddress: CREATOR,
            shareBps: 6000,
            claimableRaw: "1000000000000000000",
            claimedRaw: "2000000000000000000",
            generatedRaw: "3000000000000000000",
            creatorFeesPendingRaw: "4000000000000000000",
            beneficiaries: [
              {
                beneficiary: CREATOR,
                payoutAddress: CREATOR,
                shareBps: 6000,
              },
              {
                beneficiary: OTHER,
                payoutAddress: OTHER,
                shareBps: 4000,
              },
            ],
            buySwapFeeBps: 100,
            sellSwapFeeBps: 100,
            programmableFeeBps: 10,
            launchTransactionHash: TRANSACTION_HASH,
            estimate: {
              ethRaw: "5000000000000000000",
              usdRaw: "17500000000",
            },
          },
        ],
      }),
    );

    expect(response).toEqual({
      status: "ready",
      account: CREATOR,
      chainId: 1,
      snapshotBlock: "25660000",
      rewards: [
        expect.objectContaining({
          model: "stock-paired",
          tokenAddress: TOKEN_A,
          poolId: POOL_ID,
          beneficiary: CREATOR,
          shareBps: 6000,
          claimable: "1",
          claimed: "2",
          generated: "3",
          estimatedEth: "5",
          estimatedUsd: "17500",
          buySwapFeeBps: 100,
          sellSwapFeeBps: 100,
          programmableFeeBps: 10,
        }),
      ],
    });
  });
});

describe("indexed launch-lookup adapter v2", () => {
  it("preserves the current compact Classic V3 launch body", () => {
    expect(
      adaptIndexedLaunchLookupV2(
        ready({
          surface: "classic-v3",
          account: CREATOR,
          transactionHash: TRANSACTION_HASH,
          resolution: "found",
          token: token("classic-v3", TOKEN_A, "launch-lookup"),
        }),
      ),
    ).toEqual({
      status: "ready",
      launch: {
        tokenAddress: TOKEN_A,
        name: "Token classic-v3",
        symbol: "CLASSIC-V3",
        launchTransactionHash: TRANSACTION_HASH,
      },
    });
  });

  it.each(["stock-paired-v1", "stock-paired-v2", "stock-paired-v3"] as const)(
    "preserves the current Stock-Paired launch body for %s",
    (release) => {
      expect(
        adaptIndexedLaunchLookupV2(
          ready({
            surface: "stock-paired",
            account: CREATOR,
            transactionHash: TRANSACTION_HASH,
            resolution: "found",
            token: token(release, TOKEN_A, "launch-lookup"),
          }),
        ),
      ).toEqual({
        status: "ready",
        launch: {
          tokenAddress: TOKEN_A,
          name: `Token ${release}`,
          symbol: release.toUpperCase(),
          quoteAsset: QUOTE,
          poolId: POOL_ID,
          rewardVault: VAULT,
          positionRecipient: POSITION,
          positionTokenId: "42",
          creator: CREATOR,
          initialBuyEthAmount: "600000000000000",
          initialBuyQuoteAmount: "1500000000000000000",
          initialBuyTokenAmount: "240000000000000000000000",
          transactionHash: TRANSACTION_HASH,
        },
      });
    },
  );

  it("keeps pending Stock indexing distinct from a verified empty Classic lookup", () => {
    expect(
      adaptIndexedLaunchLookupV2(
        ready({
          surface: "stock-paired",
          account: CREATOR,
          transactionHash: TRANSACTION_HASH,
          resolution: "pending",
          token: null,
        }),
      ),
    ).toEqual({ status: "pending", launch: null });
    expect(
      adaptIndexedLaunchLookupV2(
        ready({
          surface: "classic-v3",
          account: CREATOR,
          transactionHash: TRANSACTION_HASH,
          resolution: "not-found",
          token: null,
        }),
      ),
    ).toEqual({ status: "ready", launch: null });
  });

  it("rejects account, transaction, or release relabelling", () => {
    const foreign = token("stock-paired-v3", TOKEN_A, "launch-lookup");
    foreign.creatorAddress = OTHER;
    expectAdapterError(
      () =>
        adaptIndexedLaunchLookupV2(
          ready({
            surface: "stock-paired",
            account: CREATOR,
            transactionHash: TRANSACTION_HASH,
            resolution: "found",
            token: foreign,
          }),
        ),
      "scope-mismatch",
    );
    expectAdapterError(
      () =>
        adaptIndexedLaunchLookupV2(
          ready({
            surface: "classic-v3",
            account: CREATOR,
            transactionHash: TRANSACTION_HASH,
            resolution: "found",
            token: token("classic-v2", TOKEN_A, "launch-lookup"),
          }),
        ),
      "snapshot-mismatch",
    );
  });
});
