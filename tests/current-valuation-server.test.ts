import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readOfficialV4LiquidityEvidence: vi.fn(),
  withSameBlockEthUsdQuote: vi.fn(),
  enrichTokensWithAlchemyPoolState: vi.fn(),
}));

vi.mock("../lib/onchain/uniswap-v4-subgraph", () => ({
  readOfficialV4LiquidityEvidence:
    mocks.readOfficialV4LiquidityEvidence,
}));
vi.mock("../lib/alchemy/live-market.server", () => ({
  withSameBlockEthUsdQuote: mocks.withSameBlockEthUsdQuote,
  enrichTokensWithAlchemyPoolState: mocks.enrichTokensWithAlchemyPoolState,
}));

import {
  attachBitqueryMarketDataToValuedEntries,
  valueExploreEntriesWithCurrentEvidence,
} from
  "../lib/market-data/current-valuation.server";
import type { TokenMarketDataV1 } from
  "../lib/market-data/market-data-v1";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const tokenAddress = "0x1111111111111111111111111111111111111111";
const poolId = `0x${"22".repeat(32)}` as const;
const token = {
  exploreKind: "token",
  id: `1:${tokenAddress}`,
  name: "Current",
  symbol: "CUR",
  tokenAddress,
  hookAddress: "0x3333333333333333333333333333333333333333",
  poolId,
  launchedAt: "2026-08-13T00:00:00.000Z",
  totalSupplyRaw: "1000000000000000000000000",
  tokenDecimals: 18,
  launchModel: "classic",
  totalSwapFeeBps: 100,
  liquidityPath: "meme",
  launchCategoryProvenance: {
    source: "meme-launcher",
    category: "classic",
    reference: "meme-launcher-v1",
  },
} as unknown as ExploreEntry;

const marketData = {
  schemaVersion: "programmable.market-data.v1",
  source: "bitquery",
  generatedAt: "2026-08-13T00:02:00.000Z",
  status: "current",
  primaryPoolId: poolId,
  pools: [{
    identity: {
      chainId: "1",
      tokenAddress,
      poolId,
      protocol: "uniswap_v4",
    },
    source: "bitquery",
    status: "current",
    quality: "complete",
    asOfTime: "2026-08-13T00:02:00.000Z",
    latestTrade: {
      transactionHash: `0x${"44".repeat(32)}`,
      logIndex: 1,
      blockNumber: "25750000",
      time: "2026-08-13T00:02:00.000Z",
      tokenSide: "buy",
      priceUsdWad: "2000000000000000000",
      rawPriceUsdWad: "2000000000000000000",
      priceUsdSource: "bitquery-token-price-index-v1",
      priceUsdAsOfTime: "2026-08-13T00:02:00.000Z",
    },
    liquidity: {
      asOfTime: "2026-08-13T00:02:00.000Z",
      asOfBlock: "25750000",
      valueUsdWad: "10000000000000000000000",
      freshness: "current",
    },
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      valueUsdWad: "2000000000000000000000000",
      fdvUsdWad: "2000000000000000000000000",
      totalSupply: "1000000",
      asOfTime: "2026-08-13T00:02:00.000Z",
      freshness: "current",
    },
  }],
} satisfies TokenMarketDataV1;

const deployment = {
  status: "ready",
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  stateView: "0x4444444444444444444444444444444444444444",
  stateViewRuntimeCodeHash: `0x${"55".repeat(32)}`,
  rpcUrl: "https://primary.example",
  rpcUrlSecondary: "https://secondary.example",
  confirmations: 12n,
  logBlockRange: 5_000n,
  launcher: "0x6666666666666666666666666666666666666666",
  feeHook: "0x7777777777777777777777777777777777777777",
  launcherRuntimeCodeHash: `0x${"88".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"99".repeat(32)}`,
  deploymentBlock: 1n,
} as const;
const snapshot = {
  chainId: 1,
  blockNumber: "25750000",
  blockHash: `0x${"aa".repeat(32)}`,
  confirmations: 12,
} as const;

function tokenWithState(
  activeLiquidity: string,
  activeVirtualLiquidityUsdWad?: string,
): LauncherToken {
  const blockTimestamp = "1786579320";
  const blockTime = new Date(Number(blockTimestamp) * 1_000).toISOString();
  return {
    ...token,
    liveMarketStateEvidence: {
      source: "uniswap-v4-stateview-v1",
      blockNumber: snapshot.blockNumber,
      blockHash: snapshot.blockHash,
      sqrtPriceX96: (1n << 96n).toString(),
      activeLiquidity,
    },
    ...(activeVirtualLiquidityUsdWad === undefined
      ? {}
      : {
          liveMarketPriceEvidence: {
            schemaVersion:
              "programmable.stateview-chainlink-price-evidence.v1",
            source: "uniswap-v4-stateview-chainlink-v1",
            chainId: "1",
            poolId,
            tokenAddress,
            quoteAddress: "0x0000000000000000000000000000000000000000",
            stateViewAddress: deployment.stateView,
            stateViewRuntimeCodeHash: deployment.stateViewRuntimeCodeHash,
            blockNumber: snapshot.blockNumber,
            blockHash: snapshot.blockHash,
            blockTimestamp,
            blockTime,
            sqrtPriceX96: (1n << 96n).toString(),
            activeLiquidity,
            activeVirtualToken0Wei: activeLiquidity,
            activeVirtualLiquidityUsdWad,
            activeVirtualLiquidityValueBasis:
              "stateview-active-liquidity-virtual-depth-usd",
            tokenPriceEthWei: "1000000000000000000",
            tokenPriceUsdWad: "2500000000000000000000",
            totalSupplyRaw: "1000000000000000000000000",
            tokenDecimals: 18,
            fdvUsdWad: "2500000000000000000000000000",
            ethUsdQuote: {
              feedAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
              roundId: "1",
              answeredInRound: "1",
              answer: "250000000000",
              decimals: 8,
              updatedAt: blockTimestamp,
              updatedAtTime: blockTime,
            },
          },
        }),
  } as LauncherToken;
}

describe("current Explore valuation orchestration", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("keeps current Bitquery nested but unavailable at top level when dual evidence fails", async () => {
    mocks.readOfficialV4LiquidityEvidence.mockResolvedValue([]);
    mocks.withSameBlockEthUsdQuote.mockResolvedValue(snapshot);
    mocks.enrichTokensWithAlchemyPoolState.mockResolvedValue([
      tokenWithState("2000000000000000000", "10000000000000000000000"),
    ]);

    const [valued] = await valueExploreEntriesWithCurrentEvidence({
      entries: [token],
      marketByToken: new Map([[tokenAddress, marketData]]),
      deployment,
      operationalSnapshot: snapshot,
      now: new Date("2026-08-13T00:02:00.000Z"),
    });

    expect(valued?.valuation).toEqual({
      status: "unavailable",
      reason: "liquidity-unavailable",
    });
    expect(valued?.marketData?.pools[0]?.latestTrade).toBeDefined();
    expect(valued?.marketData?.pools[0]?.valuation).toEqual({
      status: "unavailable",
      reason: "inconsistent-market-data",
    });
  });

  it("degrades on its deadline for discovery but fails closed for global ranking", async () => {
    mocks.readOfficialV4LiquidityEvidence.mockImplementation(
      () => new Promise(() => undefined),
    );
    mocks.withSameBlockEthUsdQuote.mockImplementation(
      () => new Promise(() => undefined),
    );
    const input = {
      entries: [token],
      marketByToken: new Map([[tokenAddress, marketData]]),
      deployment,
      operationalSnapshot: snapshot,
      now: new Date("2026-08-13T00:02:00.000Z"),
      timeoutMs: 1,
    } as const;

    await expect(valueExploreEntriesWithCurrentEvidence(input)).resolves
      .toMatchObject([{
        valuation: { status: "unavailable", reason: "source-unavailable" },
        marketData: {
          pools: [{
            valuation: {
              status: "unavailable",
              reason: "source-unavailable",
            },
          }],
        },
      }]);
    await expect(valueExploreEntriesWithCurrentEvidence({
      ...input,
      requireCompleteLiquidityCoverage: true,
    })).rejects.toThrow("deadline exceeded");
  });

  it("actively aborts pending StateView and Chainlink work at the deadline", async () => {
    const observedSignals: AbortSignal[] = [];
    const pendingUntilAbort = ({ signal }: { signal?: AbortSignal }) => {
      expect(signal).toBeInstanceOf(AbortSignal);
      observedSignals.push(signal!);
      return new Promise<never>((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        });
      });
    };
    mocks.withSameBlockEthUsdQuote.mockImplementation(pendingUntilAbort);
    mocks.enrichTokensWithAlchemyPoolState.mockImplementation(pendingUntilAbort);

    await expect(valueExploreEntriesWithCurrentEvidence({
      entries: [token],
      marketByToken: new Map([[tokenAddress, marketData]]),
      deployment,
      operationalSnapshot: snapshot,
      now: new Date("2026-08-13T00:02:00.000Z"),
      timeoutMs: 5,
    })).resolves.toMatchObject([{
      valuation: { status: "unavailable", reason: "source-unavailable" },
    }]);

    expect(observedSignals).toHaveLength(2);
    expect(observedSignals.every((signal) => signal.aborted)).toBe(true);
    expect(mocks.readOfficialV4LiquidityEvidence).not.toHaveBeenCalled();
  });

  it("actively aborts a pending official subgraph read at the deadline", async () => {
    let subgraphSignal: AbortSignal | undefined;
    mocks.withSameBlockEthUsdQuote.mockResolvedValue(snapshot);
    mocks.enrichTokensWithAlchemyPoolState.mockResolvedValue([
      tokenWithState("2000000000000000000", "10000000000000000000000"),
    ]);
    mocks.readOfficialV4LiquidityEvidence.mockImplementation(
      (_input: unknown, options?: { signal?: AbortSignal }) => {
        subgraphSignal = options?.signal;
        return new Promise<never>((_resolve, reject) => {
          subgraphSignal?.addEventListener(
            "abort",
            () => reject(subgraphSignal?.reason),
            { once: true },
          );
        });
      },
    );

    await expect(valueExploreEntriesWithCurrentEvidence({
      entries: [token],
      marketByToken: new Map([[tokenAddress, marketData]]),
      deployment,
      operationalSnapshot: snapshot,
      now: new Date("2026-08-13T00:02:00.000Z"),
      timeoutMs: 5,
    })).resolves.toMatchObject([{
      valuation: { status: "unavailable", reason: "source-unavailable" },
    }]);

    expect(subgraphSignal).toBeInstanceOf(AbortSignal);
    expect(subgraphSignal?.aborted).toBe(true);
  });

  it("bounds an unresolved operational snapshot and never starts downstream reads", async () => {
    const unresolvedSnapshot = new Promise<null>(() => undefined);
    const input = {
      entries: [token],
      marketByToken: Promise.resolve(new Map([[tokenAddress, marketData]])),
      deployment,
      operationalSnapshot: unresolvedSnapshot,
      now: new Date("2026-08-13T00:02:00.000Z"),
      timeoutMs: 1,
    } as const;

    await expect(valueExploreEntriesWithCurrentEvidence(input)).resolves
      .toMatchObject([{
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }]);
    await expect(valueExploreEntriesWithCurrentEvidence({
      ...input,
      requireCompleteLiquidityCoverage: true,
    })).rejects.toThrow("deadline exceeded");
    expect(mocks.readOfficialV4LiquidityEvidence).not.toHaveBeenCalled();
    expect(mocks.withSameBlockEthUsdQuote).not.toHaveBeenCalled();
  });

  it("fails closed for global ranking when the same-block quote is unavailable", async () => {
    mocks.readOfficialV4LiquidityEvidence.mockResolvedValue([]);
    mocks.withSameBlockEthUsdQuote.mockRejectedValue(
      new Error("quote unavailable"),
    );

    await expect(valueExploreEntriesWithCurrentEvidence({
      entries: [token],
      marketByToken: new Map([[tokenAddress, marketData]]),
      deployment,
      operationalSnapshot: snapshot,
      now: new Date("2026-08-13T00:02:00.000Z"),
      requireCompleteLiquidityCoverage: true,
    })).rejects.toThrow("quote unavailable");
  });

  it("starts current evidence while the Bitquery market read is still pending", async () => {
    let resolveMarket!: (value: ReadonlyMap<string, TokenMarketDataV1>) => void;
    const pendingMarket = new Promise<ReadonlyMap<string, TokenMarketDataV1>>(
      (resolve) => {
        resolveMarket = resolve;
      },
    );
    mocks.readOfficialV4LiquidityEvidence.mockResolvedValue([]);
    mocks.withSameBlockEthUsdQuote.mockResolvedValue(snapshot);
    mocks.enrichTokensWithAlchemyPoolState.mockResolvedValue([
      tokenWithState("2000000000000000000", "10000000000000000000000"),
    ]);

    const read = valueExploreEntriesWithCurrentEvidence({
      entries: [token],
      marketByToken: pendingMarket,
      deployment,
      operationalSnapshot: Promise.resolve(snapshot),
      now: new Date("2026-08-13T00:02:00.000Z"),
    });
    await vi.waitFor(() => {
      expect(mocks.withSameBlockEthUsdQuote).toHaveBeenCalledOnce();
      expect(mocks.enrichTokensWithAlchemyPoolState).toHaveBeenCalled();
    });
    resolveMarket(new Map([[tokenAddress, marketData]]));

    await expect(read).resolves.toHaveLength(1);
    expect(mocks.readOfficialV4LiquidityEvidence).toHaveBeenCalledOnce();
  });

  it("treats exact zero active liquidity as known ineligibility, not missing coverage", async () => {
    mocks.withSameBlockEthUsdQuote.mockResolvedValue(snapshot);
    mocks.enrichTokensWithAlchemyPoolState.mockResolvedValue([
      tokenWithState("0"),
    ]);

    const [valued] = await valueExploreEntriesWithCurrentEvidence({
      entries: [token],
      marketByToken: new Map([[tokenAddress, marketData]]),
      deployment,
      operationalSnapshot: snapshot,
      now: new Date("2026-08-13T00:02:00.000Z"),
      requireCompleteLiquidityCoverage: true,
    });

    expect(mocks.enrichTokensWithAlchemyPoolState).toHaveBeenCalledTimes(2);
    expect(mocks.readOfficialV4LiquidityEvidence).not.toHaveBeenCalled();
    expect(valued?.exploreKind === "token" && valued.liveMarketStateEvidence)
      .toMatchObject({
      activeLiquidity: "0",
    });
    expect(valued?.valuation).toEqual({
      status: "unavailable",
      reason: "liquidity-unavailable",
    });
  });

  it("fails global ranking when positive active liquidity lacks price evidence", async () => {
    const blockTimestamp = "1786579320";
    mocks.readOfficialV4LiquidityEvidence.mockResolvedValue([{
      source: "official-uniswap-v4-subgraph",
      identity: {
        chainId: "1",
        protocol: "uniswap_v4",
        poolId,
        tokenAddress,
        quoteAddress: "0x0000000000000000000000000000000000000000",
      },
      valueBasis: "official-subgraph-pool-tvl-usd",
      tvlUsdWad: "10000000000000000000000",
      reportedPoolBalances: {
        token0: {
          address: "0x0000000000000000000000000000000000000000",
          decimals: 18,
          amountDecimal: "10",
        },
        token1: { address: tokenAddress, decimals: 18, amountDecimal: "10" },
      },
      freshness: "current",
      provenance: {
        subgraphId: "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G",
        deployment: "QmZsgJLiLQKpb8hxTmQ5LWyrFVvfWzVaL4WK8dfFBn7EeK",
        indexedBlockNumber: snapshot.blockNumber,
        indexedBlockHash: snapshot.blockHash,
        indexedBlockTimestamp: blockTimestamp,
        indexedBlockTime: new Date(Number(blockTimestamp) * 1_000).toISOString(),
        referenceHeadBlockNumber: snapshot.blockNumber,
        referenceHeadBlockHash: snapshot.blockHash,
        lagBlocks: "0",
      },
    }]);
    mocks.withSameBlockEthUsdQuote.mockResolvedValue(snapshot);
    mocks.enrichTokensWithAlchemyPoolState.mockResolvedValue([{
      ...token,
      liveMarketStateEvidence: {
        source: "uniswap-v4-stateview-v1",
        blockNumber: snapshot.blockNumber,
        blockHash: snapshot.blockHash,
        sqrtPriceX96: (1n << 96n).toString(),
        activeLiquidity: "1",
      },
    }]);

    await expect(valueExploreEntriesWithCurrentEvidence({
      entries: [token],
      marketByToken: new Map([[tokenAddress, marketData]]),
      deployment,
      operationalSnapshot: snapshot,
      now: new Date("2026-08-13T00:02:00.000Z"),
      requireCompleteLiquidityCoverage: true,
    })).rejects.toThrow("StateView market evidence is incomplete");
    expect(mocks.readOfficialV4LiquidityEvidence).not.toHaveBeenCalled();
  });

  it("does not query the subgraph for exact active depth below the floor", async () => {
    mocks.withSameBlockEthUsdQuote.mockResolvedValue(snapshot);
    mocks.enrichTokensWithAlchemyPoolState.mockResolvedValue([
      tokenWithState("1", "9999999999999999999999"),
    ]);

    const [valued] = await valueExploreEntriesWithCurrentEvidence({
      entries: [token],
      marketByToken: new Map([[tokenAddress, marketData]]),
      deployment,
      operationalSnapshot: snapshot,
      now: new Date("2026-08-13T00:02:00.000Z"),
      requireCompleteLiquidityCoverage: true,
    });

    expect(mocks.readOfficialV4LiquidityEvidence).not.toHaveBeenCalled();
    expect(valued?.valuation).toEqual({
      status: "unavailable",
      reason: "liquidity-unavailable",
    });
  });

  it("attaches page market data without replacing the exact sort valuation", async () => {
    const currentEntry = {
      ...token,
      valuation: {
        status: "unavailable" as const,
        reason: "liquidity-unavailable" as const,
      },
    };

    const [attached] = await attachBitqueryMarketDataToValuedEntries({
      entries: [currentEntry],
      marketByToken: new Map([[tokenAddress, marketData]]),
      now: new Date("2026-08-13T00:02:00.000Z"),
    });

    expect(attached?.valuation).toEqual(currentEntry.valuation);
    expect(attached?.marketData?.pools[0]?.latestTrade).toBeDefined();
    expect(attached?.marketData?.pools[0]?.valuation).toEqual({
      status: "unavailable",
      reason: "inconsistent-market-data",
    });
  });

  it("preserves only the exact stale historical PCAN detail valuation", async () => {
    const historicalAddress =
      "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce";
    const historicalToken = {
      ...token,
      id: `1:${historicalAddress}`,
      tokenAddress: historicalAddress,
    } as ExploreEntry;
    const historicalMarketData = {
      ...marketData,
      status: "stale",
      pools: marketData.pools.map((pool) => ({
        ...pool,
        identity: { ...pool.identity, tokenAddress: historicalAddress },
        status: "stale" as const,
        liquidity: { ...pool.liquidity, freshness: "stale" as const },
        valuation: { ...pool.valuation, freshness: "stale" as const },
      })),
    } satisfies TokenMarketDataV1;

    const [valued] = await valueExploreEntriesWithCurrentEvidence({
      entries: [historicalToken],
      marketByToken: new Map([[historicalAddress, historicalMarketData]]),
      deployment: null,
      operationalSnapshot: null,
      now: new Date("2026-08-13T00:02:00.000Z"),
      allowHistoricalBitqueryFallback: true,
    });

    expect(valued?.valuation).toMatchObject({
      status: "available",
      source: "bitquery",
      freshness: "stale",
    });
  });

  it("removes stale Bitquery FDV from ordinary public entries", async () => {
    const staleMarketData = {
      ...marketData,
      status: "stale",
      pools: marketData.pools.map((pool) => ({
        ...pool,
        status: "stale" as const,
        liquidity: { ...pool.liquidity, freshness: "stale" as const },
        valuation: { ...pool.valuation, freshness: "stale" as const },
      })),
    } satisfies TokenMarketDataV1;

    const [valued] = await valueExploreEntriesWithCurrentEvidence({
      entries: [token],
      marketByToken: new Map([[tokenAddress, staleMarketData]]),
      deployment: null,
      operationalSnapshot: null,
      now: new Date("2026-08-13T00:02:00.000Z"),
    });

    expect(valued?.valuation).toEqual({
      status: "unavailable",
      reason: "source-unavailable",
    });
    expect(valued?.marketData?.pools[0]?.valuation).toEqual({
      status: "unavailable",
      reason: "source-unavailable",
    });
  });
});
