import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreReadModel } from "../../lib/onchain/types";
import type { LauncherToken } from "../../lib/tokens";
import {
  OPTIMISTIC_PUBLIC_API_SNAPSHOT_VERSION,
  appendOrReplaceOptimisticChartPoint,
  applyPersistedOptimisticCorpus,
  buildOptimisticClassicChart,
  buildOptimisticExplorePage,
  buildOptimisticTokenDetail,
  overlayClassicChartCanonicalResponse,
  responseWithOptimisticOverlay,
  type PersistedOptimisticPublicSnapshot,
} from "../../lib/data-pipeline/optimistic-public-api-overlay.server";
import type { IndexedFeedSnapshot } from "../../app/api/indexers/v1/response";
import type {
  OptimisticMarketRow,
  OptimisticLaunchRow,
  OptimisticOverlayDisclosure,
} from "../../lib/data-pipeline/optimistic-read-overlay.server";

const NOW = Date.parse("2026-08-02T10:00:00.000Z");
const CANONICAL_BLOCK = "25630000";
const HEAD_BLOCK = "25630003";
const HEAD_HASH = `0x${"11".repeat(32)}` as const;
const CANONICAL_HASH = `0x${"aa".repeat(32)}` as const;
const BLOCK_ONE_HASH = `0x${"a1".repeat(32)}` as const;
const BLOCK_TWO_HASH = `0x${"a2".repeat(32)}` as const;
const TX_HASH = `0x${"22".repeat(32)}` as const;
const EVIDENCE_COMMITMENT = `0x${"23".repeat(32)}` as const;
const MARKET_STATE_ID = "20000000-0000-4000-8000-000000000001";
const HOOK = "0x3333333333333333333333333333333333333333" as const;
const TOKEN_A = "0x4444444444444444444444444444444444444444" as const;
const TOKEN_B = "0x5555555555555555555555555555555555555555" as const;
const TOKEN_C = "0x6666666666666666666666666666666666666666" as const;
const POOL_A = `0x${"66".repeat(32)}` as const;
const POOL_B = `0x${"77".repeat(32)}` as const;
const POOL_C = `0x${"ab".repeat(32)}` as const;
const ETH_USD_QUOTE = {
  feedAddress: "0x7777777777777777777777777777777777777777" as const,
  roundId: "42",
  answer: "350000000000",
  decimals: 8,
  updatedAt: "2026-08-02T09:59:00.000Z",
};

function token(input: Readonly<{
  address: `0x${string}`;
  poolId: `0x${string}`;
  marketCapUsd: string;
  launchModel?: LauncherToken["launchModel"];
}>): LauncherToken {
  return {
    id: `1:${input.address}`,
    name: input.address === TOKEN_A ? "Alpha" : "Beta",
    symbol: input.address === TOKEN_A ? "ALPHA" : "BETA",
    tokenAddress: input.address,
    hookAddress: HOOK,
    poolId: input.poolId,
    launchBlockNumber:
      input.address === TOKEN_A ? "25629990" : "25629991",
    launchTransactionHash:
      input.address === TOKEN_A
        ? (`0x${"88".repeat(32)}` as const)
        : (`0x${"99".repeat(32)}` as const),
    launchTransactionIndex: 0,
    launchLogIndex: 1,
    launchedAt: "2026-08-02T09:55:00.000Z",
    totalSupplyRaw: "1000000000000000000000000000",
    tokenDecimals: 18,
    indexedMarketCapUsdWad: input.marketCapUsd,
    indexedMarketCapEthWei: input.marketCapUsd,
    indexedValuationBlockNumber: CANONICAL_BLOCK,
    totalSwapFeeBps: 100,
    launchModel: input.launchModel ?? "classic",
    liquidityPath: "meme",
  };
}

const canonicalTokens = [
  token({ address: TOKEN_A, poolId: POOL_A, marketCapUsd: "100" }),
  token({ address: TOKEN_B, poolId: POOL_B, marketCapUsd: "90" }),
];

const canonicalModel: ExploreReadModel & { status: "ready" } = {
  status: "ready",
  tokens: canonicalTokens,
  snapshot: {
    chainId: 1,
    blockNumber: CANONICAL_BLOCK,
    blockHash: CANONICAL_HASH,
    confirmations: 12,
    ethUsdQuote: ETH_USD_QUOTE,
  },
  creatorClaims: [],
  launcherFeesAccruedWei: "5",
  launcherFeesAccruedEth: "0.000000000000000005",
};

const indexedFeed = {
  chainId: 1,
  model: canonicalModel,
  capturedAt: "2026-08-02T09:59:59.000Z",
  snapshotCommitment: `0x${"cd".repeat(32)}`,
  sourceCommitment: `0x${"de".repeat(32)}`,
  projectionLag: 12,
  reconciledAt: "2026-08-02T09:59:59.000Z",
  releaseVersions: ["classic-v3"],
} as const satisfies IndexedFeedSnapshot;

function indexedHeaders(blockHash = canonicalModel.snapshot.blockHash) {
  return {
    "X-Programmable-Projection-Block": CANONICAL_BLOCK,
    "X-Programmable-Projection-Hash": blockHash,
  };
}

function marketRow(
  overrides: Partial<OptimisticMarketRow> = {},
): OptimisticMarketRow {
  return {
    kind: "market",
    evidenceCommitment: EVIDENCE_COMMITMENT,
    evidence: {
      eligibility: "optimistic",
      source: "dual-rpc-head",
      finality: "optimistic",
      chainId: 1,
      blockNumber: HEAD_BLOCK,
      blockHash: HEAD_HASH,
      primaryBlockNumber: HEAD_BLOCK,
      primaryBlockHash: HEAD_HASH,
      secondaryBlockNumber: HEAD_BLOCK,
      secondaryBlockHash: HEAD_HASH,
      confirmations: 0,
      finalityDepth: 12,
      observedAt: "2026-08-02T09:59:59.000Z",
    },
    event: { transactionHash: TX_HASH, logIndex: 8 },
    poolId: POOL_B,
    tokenAddress: TOKEN_B,
    market: {
      tokenPriceEthWei: "2000000000000000",
      tokenPriceEth: "0.002",
      tokenPriceUsdWad: "7000000000000000000",
      marketCapEthWei: "200",
      marketCapEth: "0.0000000000000002",
      indexedMarketCapEthWei: "200",
      indexedMarketCapEth: "0.0000000000000002",
      indexedValuationBlockNumber: HEAD_BLOCK,
      grossVolumeWei: "2000000000000000000",
      grossVolumeEth: "2",
      swapCount: 9,
      currentTick: 10,
      activeLiquidity: "123",
    },
    ...overrides,
  };
}

function persistedSnapshot(
  overrides: Partial<PersistedOptimisticPublicSnapshot> = {},
): PersistedOptimisticPublicSnapshot {
  return {
    version: OPTIMISTIC_PUBLIC_API_SNAPSHOT_VERSION,
    source: "postgres-current-optimistic-chain",
    chainId: 1,
    head: {
      blockNumber: HEAD_BLOCK,
      blockHash: HEAD_HASH,
      providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
      reorgGeneration: "4",
      observedAt: "2026-08-02T09:59:59.000Z",
      canonicalAt: "2026-08-02T09:59:59.500Z",
    },
    blocks: [
      {
        blockNumber: "25630001",
        blockHash: BLOCK_ONE_HASH,
        parentHash: CANONICAL_HASH,
        reorgGeneration: "4",
      },
      {
        blockNumber: "25630002",
        blockHash: BLOCK_TWO_HASH,
        parentHash: BLOCK_ONE_HASH,
        reorgGeneration: "4",
      },
      {
        blockNumber: HEAD_BLOCK,
        blockHash: HEAD_HASH,
        parentHash: BLOCK_TWO_HASH,
        reorgGeneration: "4",
      },
    ],
    rows: [{
      reorgGeneration: "4",
      providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
      releaseVersion: "classic-v2",
      optimisticMarketStateId: MARKET_STATE_ID,
      row: marketRow(),
    }],
    ...overrides,
  };
}

function launchRow(): OptimisticLaunchRow {
  const transactionHash = `0x${"bc".repeat(32)}` as const;
  return {
    kind: "launch",
    evidenceCommitment: EVIDENCE_COMMITMENT,
    evidence: {
      ...marketRow().evidence,
      blockNumber: HEAD_BLOCK,
      blockHash: HEAD_HASH,
      primaryBlockNumber: HEAD_BLOCK,
      primaryBlockHash: HEAD_HASH,
      secondaryBlockNumber: HEAD_BLOCK,
      secondaryBlockHash: HEAD_HASH,
      confirmations: 0,
    },
    event: { transactionHash, logIndex: 12 },
    poolId: POOL_C,
    tokenAddress: TOKEN_C,
    token: {
      id: `1:${TOKEN_C}`,
      name: "Gamma",
      symbol: "GAMMA",
      tokenAddress: TOKEN_C,
      hookAddress: HOOK,
      poolId: POOL_C,
      launchBlockNumber: HEAD_BLOCK,
      launchTransactionHash: transactionHash,
      launchTransactionIndex: 2,
      launchLogIndex: 12,
      launchedAt: "2026-08-02T09:59:59.000Z",
      totalSupplyRaw: "1000000000000000000000000000",
      tokenDecimals: 18,
      totalSwapFeeBps: 100,
      launchModel: "classic",
      liquidityPath: "meme",
    },
  };
}

describe("optimistic public API overlay", () => {
  it("merges before pagination without mixing native and USD market-cap ranks", () => {
    const page = buildOptimisticExplorePage({
      canonicalModel,
      options: { query: "", sort: "market-cap", page: 1, pageSize: 1 },
      snapshot: persistedSnapshot(),
      nowMs: NOW,
    });

    expect(page).not.toBeNull();
    expect(page?.total).toBe(2);
    expect(page?.tokens.map(({ tokenAddress }) => tokenAddress)).toEqual([
      TOKEN_B,
    ]);
    expect(page?.optimisticOverlay.applied).toHaveLength(1);
    expect(page?.optimisticOverlay.applied[0]?.tokenAddress).toBe(TOKEN_B);
    expect(page?.optimisticOverlay.applied[0]?.evidenceCommitment).toBe(
      EVIDENCE_COMMITMENT,
    );
    expect(page?.optimisticOverlay.applied[0]).toMatchObject({
      optimisticMarketStateId: MARKET_STATE_ID,
      releaseVersion: "classic-v2",
      reorgGeneration: "4",
    });
  });

  it("preserves comparable USD ordering when Stock-Paired and native rows mix", () => {
    const stock = {
      ...canonicalTokens[0]!,
      launchModel: "stock-paired" as const,
      indexedMarketCapUsdWad: "1000000",
      indexedMarketCapEthWei: undefined,
      marketCapEthWei: undefined,
    };
    const classic = {
      ...canonicalTokens[1]!,
      indexedMarketCapUsdWad: "90",
    };
    const page = buildOptimisticExplorePage({
      canonicalModel: {
        ...canonicalModel,
        tokens: [stock, classic],
      },
      options: { query: "", sort: "market-cap", page: 1, pageSize: 1 },
      snapshot: persistedSnapshot(),
      nowMs: NOW,
    });

    expect(page?.tokens[0]?.tokenAddress).toBe(TOKEN_A);
    expect(page?.optimisticOverlay.applied[0]?.tokenAddress).toBe(TOKEN_B);
  });

  it("serves a fully folded optimistic launch through token detail", () => {
    const snapshot = persistedSnapshot({
      rows: [{
        reorgGeneration: "4",
        providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
        releaseVersion: "classic-v2",
        optimisticMarketStateId: null,
        row: launchRow(),
      }],
    });
    const detail = buildOptimisticTokenDetail({
      canonicalModel,
      address: TOKEN_C,
      snapshot,
      nowMs: NOW,
    });

    expect(detail).toMatchObject({
      status: "ready",
      token: {
        tokenAddress: TOKEN_C,
        poolId: POOL_C,
        launchBlockNumber: HEAD_BLOCK,
      },
      optimisticOverlay: {
        active: true,
        applied: [{ kind: "launch", confirmations: 0 }],
      },
    });
  });

  it("validates market confirmations against the row's persisted provider heads", () => {
    const nextProviderHead = (BigInt(HEAD_BLOCK) + 1n).toString();
    const row = marketRow({
      evidence: {
        ...marketRow().evidence,
        confirmations: 1,
      },
    });
    const result = applyPersistedOptimisticCorpus({
      canonicalTokens,
      canonicalBlockNumber: CANONICAL_BLOCK,
      canonicalBlockHash: CANONICAL_HASH,
      canonicalEthUsdQuote: ETH_USD_QUOTE,
      snapshot: persistedSnapshot({
        rows: [{
          reorgGeneration: "4",
          providerHeads: [nextProviderHead, nextProviderHead],
          releaseVersion: "classic-v2",
          optimisticMarketStateId: MARKET_STATE_ID,
          row,
        }],
      }),
      nowMs: NOW,
    });

    expect(result?.disclosure.applied).toMatchObject([
      { kind: "market", confirmations: 1 },
    ]);
  });

  it("keeps an older row in the current fresh chain segment eligible", () => {
    const row = launchRow();
    const result = applyPersistedOptimisticCorpus({
      canonicalTokens,
      canonicalBlockNumber: CANONICAL_BLOCK,
      canonicalBlockHash: CANONICAL_HASH,
      canonicalEthUsdQuote: ETH_USD_QUOTE,
      snapshot: persistedSnapshot({
        rows: [{
          reorgGeneration: "4",
          providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
          releaseVersion: "classic-v2",
          optimisticMarketStateId: null,
          row: {
            ...row,
            evidence: {
              ...row.evidence,
              observedAt: "2026-08-02T09:57:00.000Z",
            },
          },
        }],
      }),
      nowMs: NOW,
    });

    expect(result?.tokens.some(
      ({ tokenAddress }) => tokenAddress === TOKEN_C,
    )).toBe(true);
  });

  it("requires exact canonical hash ancestry through the contiguous block path", () => {
    const wrongHash = applyPersistedOptimisticCorpus({
      canonicalTokens,
      canonicalBlockNumber: CANONICAL_BLOCK,
      canonicalBlockHash: `0x${"ff".repeat(32)}`,
      canonicalEthUsdQuote: ETH_USD_QUOTE,
      snapshot: persistedSnapshot(),
      nowMs: NOW,
    });
    const brokenParent = applyPersistedOptimisticCorpus({
      canonicalTokens,
      canonicalBlockNumber: CANONICAL_BLOCK,
      canonicalBlockHash: CANONICAL_HASH,
      canonicalEthUsdQuote: ETH_USD_QUOTE,
      snapshot: persistedSnapshot({
        blocks: persistedSnapshot().blocks.map((block, index) =>
          index === 1
            ? { ...block, parentHash: `0x${"fe".repeat(32)}` }
            : block),
      }),
      nowMs: NOW,
    });
    const inSegment = applyPersistedOptimisticCorpus({
      canonicalTokens,
      canonicalBlockNumber: "25630001",
      canonicalBlockHash: BLOCK_ONE_HASH,
      canonicalEthUsdQuote: ETH_USD_QUOTE,
      snapshot: persistedSnapshot(),
      nowMs: NOW,
    });
    const wrongIntermediateRow = marketRow({
      evidence: {
        ...marketRow().evidence,
        blockNumber: "25630002",
        blockHash: `0x${"fd".repeat(32)}`,
        primaryBlockNumber: "25630002",
        primaryBlockHash: `0x${"fd".repeat(32)}`,
        secondaryBlockNumber: "25630002",
        secondaryBlockHash: `0x${"fd".repeat(32)}`,
        confirmations: 1,
      },
      market: {
        ...marketRow().market,
        indexedValuationBlockNumber: "25630002",
      },
    });
    const wrongRowHash = applyPersistedOptimisticCorpus({
      canonicalTokens,
      canonicalBlockNumber: CANONICAL_BLOCK,
      canonicalBlockHash: CANONICAL_HASH,
      canonicalEthUsdQuote: ETH_USD_QUOTE,
      snapshot: persistedSnapshot({
        rows: [{
          reorgGeneration: "4",
          providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
          releaseVersion: "classic-v2",
          optimisticMarketStateId: MARKET_STATE_ID,
          row: wrongIntermediateRow,
        }],
      }),
      nowMs: NOW,
    });

    expect(wrongHash).toBeNull();
    expect(brokenParent).toBeNull();
    expect(wrongRowHash).toBeNull();
    expect(inSegment?.disclosure.active).toBe(true);
  });

  it("binds token and chart disclosures to the same persisted market state", () => {
    const snapshot = persistedSnapshot();
    const detail = buildOptimisticTokenDetail({
      canonicalModel,
      address: TOKEN_B,
      snapshot,
      nowMs: NOW,
    });
    const chart = buildOptimisticClassicChart({
      canonicalTokens,
      canonicalBlockNumber: CANONICAL_BLOCK,
      canonicalBlockHash: CANONICAL_HASH,
      canonicalEthUsdQuote: ETH_USD_QUOTE,
      canonicalBody: {
        status: "insufficient-history",
        address: TOKEN_B,
        points: [],
        swapCount: 0,
        volumeWei: "0",
        volumeEth: "0",
        range: "all",
        snapshotBlock: CANONICAL_BLOCK,
        snapshotHash: CANONICAL_HASH,
      },
      address: TOKEN_B,
      snapshot,
      nowMs: NOW,
    });
    const expected = {
      kind: "market",
      optimisticMarketStateId: MARKET_STATE_ID,
      evidenceCommitment: EVIDENCE_COMMITMENT,
      releaseVersion: "classic-v2",
      reorgGeneration: "4",
      poolId: POOL_B,
      tokenAddress: TOKEN_B,
      blockHash: HEAD_HASH,
    };

    expect(detail?.optimisticOverlay.applied[0]).toMatchObject(expected);
    expect(chart?.optimisticOverlay.applied[0]).toMatchObject(expected);
  });

  it.each([
    [
      "stale head",
      persistedSnapshot({
        head: {
          ...persistedSnapshot().head,
          observedAt: "2026-08-02T09:58:59.000Z",
        },
      }),
    ],
    [
      "future head",
      persistedSnapshot({
        head: {
          ...persistedSnapshot().head,
          canonicalAt: "2026-08-02T10:00:31.000Z",
        },
      }),
    ],
    [
      "reorg generation mismatch",
      persistedSnapshot({
        rows: [{
          reorgGeneration: "5",
          providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
          releaseVersion: "classic-v2",
          optimisticMarketStateId: MARKET_STATE_ID,
          row: marketRow(),
        }],
      }),
    ],
    [
      "missing market state id",
      persistedSnapshot({
        rows: [{
          reorgGeneration: "4",
          providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
          releaseVersion: "classic-v2",
          optimisticMarketStateId: null,
          row: marketRow(),
        }],
      }),
    ],
    [
      "release mismatch",
      persistedSnapshot({
        rows: [{
          reorgGeneration: "4",
          providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
          releaseVersion: "stock-paired-v1",
          optimisticMarketStateId: MARKET_STATE_ID,
          row: marketRow(),
        }],
      }),
    ],
    ["no optimistic rows", persistedSnapshot({ rows: [] })],
  ])("keeps canonical reads unchanged for %s", (_label, snapshot) => {
    expect(
      applyPersistedOptimisticCorpus({
        canonicalTokens,
        canonicalBlockNumber: CANONICAL_BLOCK,
        canonicalBlockHash: CANONICAL_HASH,
        canonicalEthUsdQuote: ETH_USD_QUOTE,
        snapshot,
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("appends the newest exact Classic market point and cumulative fields", () => {
    const result = buildOptimisticClassicChart({
      canonicalTokens,
      canonicalBlockNumber: CANONICAL_BLOCK,
      canonicalBlockHash: CANONICAL_HASH,
      canonicalEthUsdQuote: ETH_USD_QUOTE,
      canonicalBody: {
        status: "ready",
        address: TOKEN_B,
        points: [
          { blockNumber: "25629990", priceEth: "0.0005" },
          { blockNumber: CANONICAL_BLOCK, priceEth: "0.001" },
        ],
        swapCount: 4,
        volumeWei: "1000000000000000000",
        volumeEth: "1",
        range: "1h",
        snapshotBlock: CANONICAL_BLOCK,
        snapshotHash: CANONICAL_HASH,
      },
      address: TOKEN_B,
      snapshot: persistedSnapshot(),
      nowMs: NOW,
    });

    expect(result).toMatchObject({
      status: "ready",
      snapshotBlock: HEAD_BLOCK,
      snapshotHash: HEAD_HASH,
      swapCount: 9,
      volumeWei: "2000000000000000000",
      volumeEth: "2",
      points: [
        { blockNumber: "25629990", priceEth: "0.0005" },
        { blockNumber: CANONICAL_BLOCK, priceEth: "0.001" },
        {
          blockNumber: HEAD_BLOCK,
          priceEth: "0.002",
          priceUsd: "7",
        },
      ],
    });
  });

  it("does not label a stale canonical USD cap as an active live market cap", () => {
    expect(buildOptimisticExplorePage({
      canonicalModel: {
        ...canonicalModel,
        snapshot: {
          ...canonicalModel.snapshot,
          ethUsdQuote: undefined,
        },
      },
      options: { query: "", sort: "market-cap", page: 1, pageSize: 2 },
      snapshot: persistedSnapshot(),
      nowMs: NOW,
    })).toBeNull();
  });

  it("derives live USD price from the exact canonical ETH/USD quote", () => {
    const {
      tokenPriceUsdWad: _removedPriceUsd,
      ...nativeMarket
    } = marketRow().market;
    const result = buildOptimisticClassicChart({
      canonicalTokens: canonicalTokens.map((candidate) =>
        candidate.tokenAddress === TOKEN_B
          ? { ...candidate, tokenPriceUsdWad: "99000000000000000000" }
          : candidate),
      canonicalBlockNumber: CANONICAL_BLOCK,
      canonicalBlockHash: CANONICAL_HASH,
      canonicalEthUsdQuote: ETH_USD_QUOTE,
      canonicalBody: {
        status: "ready",
        address: TOKEN_B,
        points: [{
          blockNumber: CANONICAL_BLOCK,
          priceEth: "0.001",
          priceUsd: "99",
        }],
        swapCount: 4,
        volumeWei: "1000000000000000000",
        volumeEth: "1",
        volumeUsdWad: "99000000000000000000",
        range: "1h",
        snapshotBlock: CANONICAL_BLOCK,
        snapshotHash: CANONICAL_HASH,
      },
      address: TOKEN_B,
      snapshot: persistedSnapshot({
        rows: [{
          reorgGeneration: "4",
          providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
          releaseVersion: "classic-v2",
          optimisticMarketStateId: MARKET_STATE_ID,
          row: marketRow({ market: nativeMarket }),
        }],
      }),
      nowMs: NOW,
    });

    expect(result?.points.at(-1)).toEqual({
      blockNumber: HEAD_BLOCK,
      priceEth: "0.002",
      priceUsd: "7",
    });
    expect(result?.volumeUsdWad).toBeUndefined();
    expect(_removedPriceUsd).toBeDefined();
  });

  it("replaces a same-block chart close and never duplicates it", () => {
    expect(
      appendOrReplaceOptimisticChartPoint(
        [
          { blockNumber: "10", priceEth: "1" },
          { blockNumber: "11", priceEth: "2" },
        ],
        { blockNumber: "11", priceEth: "3" },
      ),
    ).toEqual([
      { blockNumber: "10", priceEth: "1" },
      { blockNumber: "11", priceEth: "3" },
    ]);
  });

  it("does not manufacture Stock-Paired chart history", () => {
    const stockTokens = [
      token({
        address: TOKEN_B,
        poolId: POOL_B,
        marketCapUsd: "90",
        launchModel: "stock-paired",
      }),
    ];
    expect(
      buildOptimisticClassicChart({
        canonicalTokens: stockTokens,
        canonicalBlockNumber: CANONICAL_BLOCK,
        canonicalBlockHash: CANONICAL_HASH,
        canonicalEthUsdQuote: ETH_USD_QUOTE,
        canonicalBody: {
          status: "insufficient-history",
          address: TOKEN_B,
          points: [],
          swapCount: 0,
          volumeWei: "0",
          volumeEth: "0",
          range: "all",
          snapshotBlock: CANONICAL_BLOCK,
          snapshotHash: CANONICAL_HASH,
        },
        address: TOKEN_B,
        snapshot: persistedSnapshot(),
        nowMs: NOW,
      }),
    ).toBeNull();
  });

  it("never replaces a malformed or hash-mismatched canonical chart 200", async () => {
    const malformed = Response.json(
      { status: "ready", address: TOKEN_B, points: "invalid" },
      { headers: indexedHeaders() },
    );
    const wrongHash = Response.json(
      {
        status: "insufficient-history",
        address: TOKEN_B,
        points: [],
        swapCount: 0,
        volumeWei: "0",
        volumeEth: "0",
        range: "all",
        snapshotBlock: CANONICAL_BLOCK,
        snapshotHash: `0x${"ef".repeat(32)}`,
      },
      { headers: indexedHeaders(`0x${"ef".repeat(32)}`) },
    );
    const source = { materialize: () => persistedSnapshot() };

    await expect(overlayClassicChartCanonicalResponse({
      canonical: malformed,
      feed: indexedFeed,
      source,
      address: TOKEN_B,
      range: "all",
      nowMs: NOW,
    })).resolves.toBe(malformed);
    await expect(overlayClassicChartCanonicalResponse({
      canonical: wrongHash,
      feed: indexedFeed,
      source,
      address: TOKEN_B,
      range: "all",
      nowMs: NOW,
    })).resolves.toBe(wrongHash);
  });

  it("creates chart history from an exact canonical 404 only for a folded launch", async () => {
    const launch = launchRow();
    const market = marketRow({ poolId: POOL_C, tokenAddress: TOKEN_C });
    const canonical = Response.json(
      {
        error: "Token not found",
        snapshotBlock: CANONICAL_BLOCK,
        snapshotHash: CANONICAL_HASH,
      },
      { status: 404 },
    );
    const response = await overlayClassicChartCanonicalResponse({
      canonical,
      feed: indexedFeed,
      source: {
        materialize: () => persistedSnapshot({
          rows: [launch, market].map((row) => ({
            reorgGeneration: "4",
            providerHeads: [HEAD_BLOCK, HEAD_BLOCK],
            releaseVersion: "classic-v2" as const,
            optimisticMarketStateId:
              row.kind === "market" ? MARKET_STATE_ID : null,
            row,
          })),
        }),
      },
      address: TOKEN_C,
      range: "all",
      nowMs: NOW,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "insufficient-history",
      address: TOKEN_C,
      points: [{ blockNumber: HEAD_BLOCK, priceEth: "0.002" }],
      optimisticOverlay: { active: true },
    });
  });

  it("sets no-store and exact disclosure headers only for an active overlay", () => {
    const disclosure = buildOptimisticExplorePage({
      canonicalModel,
      options: { query: "", sort: "market-cap", page: 1, pageSize: 1 },
      snapshot: persistedSnapshot(),
      nowMs: NOW,
    })!.optimisticOverlay;
    const canonical = Response.json(
      { status: "ready" },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
        },
      },
    );
    const active = responseWithOptimisticOverlay(canonical, {
      status: "ready",
      optimisticOverlay: disclosure,
    });

    expect(active.headers.get("Cache-Control")).toBe("no-store");
    expect(active.headers.get("x-programmable-overlay-source")).toBe(
      "dual-rpc-head",
    );
    expect(active.headers.get("x-programmable-overlay-finality")).toBe(
      "optimistic",
    );
    expect(active.headers.get("x-programmable-overlay-block")).toBe(
      HEAD_BLOCK,
    );
    expect(active.headers.get("x-programmable-overlay-confirmations")).toBe(
      "0",
    );

    const inactiveDisclosure: OptimisticOverlayDisclosure = {
      ...disclosure,
      active: false,
      applied: [],
    };
    const untouched = responseWithOptimisticOverlay(canonical, {
      status: "ready",
      optimisticOverlay: inactiveDisclosure,
    });
    expect(untouched).toBe(canonical);
    expect(untouched.headers.get("Cache-Control")).toContain("s-maxage=2");
  });
});
