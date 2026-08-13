import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getBlock: vi.fn(),
  multicall: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBlock: mocks.getBlock,
      multicall: mocks.multicall,
      readContract: mocks.readContract,
    })),
  };
});

import {
  enrichTokensWithAlchemyPoolState,
  withSameBlockEthUsdQuote,
  withoutUnboundEthUsdQuote,
} from "../lib/alchemy/live-market.server";
import { exploreValuation } from "../lib/explore-financial-data";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";
import {
  customGraphToken,
  stampedClassicToken,
} from "./launch-stamp-surface-fixture";

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 1n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/redacted",
  rpcUrlSecondary: null,
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

describe("Alchemy live pool market state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const hashes = new Map<bigint, `0x${string}`>([
      [25_680_000n, `0x${"77".repeat(32)}`],
      [25_730_555n, "0x88e3bc3a2ffed82bf413cd16c2bad04d8e5482306b55398ceb791285ff5248b1"],
      [25_680_001n, `0x${"88".repeat(32)}`],
      [25_680_002n, `0x${"dd".repeat(32)}`],
      [25_680_003n, `0x${"78".repeat(32)}`],
    ]);
    mocks.getBlock.mockImplementation(
      async ({ blockNumber }: { blockNumber: bigint }) => ({
        hash: hashes.get(blockNumber) ?? `0x${"00".repeat(32)}`,
        timestamp: 1_786_400_100n,
      }),
    );
  });

  it("replaces an older ETH/USD quote with a verified same-block quote", async () => {
    const blockHash = `0x${"77".repeat(32)}` as const;
    mocks.readContract
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce([
        12n,
        300_000_000_000n,
        0n,
        1_786_400_000n,
        12n,
      ]);
    mocks.getBlock.mockResolvedValue({
      hash: blockHash,
      timestamp: 1_786_400_100n,
    });

    const snapshot = await withSameBlockEthUsdQuote({
      deployment,
      snapshot: {
        chainId: 1,
        blockNumber: "25680000",
        blockHash,
        confirmations: 0,
        ethUsdQuote: {
          feedAddress: "0x8888888888888888888888888888888888888888",
          roundId: "1",
          answer: "1",
          decimals: 8,
          updatedAt: "1",
        },
      },
    });

    expect(snapshot.ethUsdQuote).toEqual({
      feedAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      roundId: "12",
      answeredInRound: "12",
      answer: "300000000000",
      decimals: 8,
      updatedAt: "1786400000",
    });
    expect(mocks.readContract.mock.calls.every(
      ([request]) => request.blockNumber === 25_680_000n,
    )).toBe(true);
    expect(mocks.getBlock).toHaveBeenCalledWith({
      blockNumber: 25_680_000n,
    });
  });

  it("removes a quote that is not bound to the live snapshot", () => {
    expect(withoutUnboundEthUsdQuote({
      chainId: 1,
      blockNumber: "25680000",
      blockHash: `0x${"77".repeat(32)}`,
      confirmations: 0,
      ethUsdQuote: {
        feedAddress: "0x8888888888888888888888888888888888888888",
        roundId: "1",
        answer: "1",
        decimals: 8,
        updatedAt: "1",
      },
    })).not.toHaveProperty("ethUsdQuote");
  });

  it("derives current token price and market cap from StateView and reuses the five-second read", async () => {
    mocks.multicall.mockResolvedValueOnce([
      {
        status: "success",
        result: [1n << 96n, 0, 0, 10_000],
      },
    ]).mockResolvedValueOnce([
      {
        status: "success",
        result: 1_000_000n,
      },
    ]);
    const token = {
      id: "1:live",
      name: "Live",
      symbol: "LIVE",
      tokenAddress: "0x4444444444444444444444444444444444444444",
      hookAddress: "0x5555555555555555555555555555555555555555",
      poolId: `0x${"66".repeat(32)}`,
      launchedAt: "2026-08-04T00:00:00.000Z",
      totalSupplyRaw: (1_000n * 10n ** 18n).toString(),
      tokenDecimals: 18,
      indexedMarketCapEthWei: (900n * 10n ** 18n).toString(),
      indexedMarketCapUsdWad: (2_700_000n * 10n ** 18n).toString(),
      indexedValuationBlockNumber: "25670000",
      launchModel: "classic",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;
    const snapshot = {
      chainId: 1,
      blockNumber: "25680000",
      blockHash: `0x${"77".repeat(32)}` as `0x${string}`,
      confirmations: 0,
      ethUsdQuote: {
        feedAddress: "0x8888888888888888888888888888888888888888" as const,
        roundId: "1",
        answer: "300000000000",
        decimals: 8,
        updatedAt: "2026-08-04T00:00:00.000Z",
      },
    };

    const first = await enrichTokensWithAlchemyPoolState({
      deployment,
      snapshot,
      tokens: [token],
    });
    const second = await enrichTokensWithAlchemyPoolState({
      deployment,
      snapshot,
      tokens: [token],
    });

    expect(first[0]).toMatchObject({
      tokenPriceEthWei: (10n ** 18n).toString(),
      marketCapEthWei: (1_000n * 10n ** 18n).toString(),
      fdvUsdWad: (3_000_000n * 10n ** 18n).toString(),
      indexedValuationBlockNumber: "25680000",
      activeLiquidity: "1000000",
    });
    expect(second).toEqual(first);
    expect(first[0]).not.toHaveProperty("indexedMarketCapEthWei");
    expect(first[0]).not.toHaveProperty("indexedMarketCapUsdWad");
    expect(exploreValuation(first[0], {
      referenceBlock: "25680000",
    })).toEqual({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      valueWad: (3_000_000n * 10n ** 18n).toString(),
      freshness: "current",
      asOfBlock: "25680000",
      lagBlocks: "0",
    });
    expect(mocks.multicall).toHaveBeenCalledTimes(2);
    expect(mocks.multicall.mock.calls.every(
      ([request]) => request.blockNumber === 25_680_000n,
    )).toBe(true);
  });

  it("matches the public Programmable V4 StateView and Chainlink golden sample", async () => {
    mocks.multicall.mockResolvedValueOnce([
      {
        status: "success",
        result: [71_024_877_262_306_743_364_511_803_610_105n, 135_975, 0, 0],
      },
    ]).mockResolvedValueOnce([
      {
        status: "success",
        result: 41_873_636_805_959_591_033_727n,
      },
    ]);
    const token = {
      id: "1:0x7987f03462200b3d8a072e02c89a8a41dcb124ee",
      name: "Programmable",
      symbol: "V4",
      tokenAddress: "0x7987f03462200b3D8A072E02C89A8A41dCB124EE",
      hookAddress: "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC",
      poolId: "0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0",
      launchedAt: "2026-07-27T22:12:23.000Z",
      totalSupplyRaw: "1000000000000000000000000000",
      tokenDecimals: 18,
      activeLiquidity: "41873636805959591033727",
      launchModel: "classic",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;

    const [enriched] = await enrichTokensWithAlchemyPoolState({
      deployment,
      snapshot: {
        chainId: 1,
        blockNumber: "25730555",
        blockHash: "0x88e3bc3a2ffed82bf413cd16c2bad04d8e5482306b55398ceb791285ff5248b1",
        confirmations: 0,
        ethUsdQuote: {
          feedAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
          roundId: "129127208515966893693",
          answer: "187594280000",
          decimals: 8,
          updatedAt: "1786435217",
        },
      },
      tokens: [token],
    });

    expect(enriched).toMatchObject({
      currentTick: 135_975,
      tokenPriceEthWei: "1244337483530",
      marketCapEthWei: "1244337483530407886719",
      tokenPriceUsdWad: "2334305942998222",
      fdvUsdWad: "2334305942998987256153723",
      indexedValuationBlockNumber: "25730555",
    });
  });

  it("reads every valid stamped PoolId at one block and separates state from valuation", async () => {
    const nonNativePoolId = `0x${"aa".repeat(32)}` as const;
    const zeroLiquidityPoolId = `0x${"bb".repeat(32)}` as const;
    const staleValuation = {
      tokenPriceEth: "999",
      tokenPriceEthWei: "999",
      tokenPriceUsdWad: "999",
      tokenPriceQuote: "999",
      tokenPriceQuoteWad: "999",
      marketCapEth: "999",
      marketCapEthWei: "999",
      marketCapQuote: "999",
      marketCapQuoteWad: "999",
      indexedMarketCapEth: "999",
      indexedMarketCapEthWei: "999",
      indexedMarketCapUsdWad: "999",
      indexedValuationBlockNumber: "1",
      fdvUsdWad: "999",
    } as const;
    const nonNativeClassic = {
      ...stampedClassicToken,
      ...staleValuation,
      poolId: nonNativePoolId,
      launchStampProvenance: {
        ...stampedClassicToken.launchStampProvenance,
        poolId: nonNativePoolId,
        poolKey: {
          ...stampedClassicToken.launchStampProvenance.poolKey,
          currency0: "0x0101010101010101010101010101010101010101",
        },
        poolProof: {
          ...stampedClassicToken.launchStampProvenance.poolProof,
          poolId: nonNativePoolId,
        },
      },
    } satisfies LauncherToken;
    const zeroLiquidityCustom = {
      ...customGraphToken,
      ...staleValuation,
      poolId: zeroLiquidityPoolId,
      launchStampProvenance: {
        ...customGraphToken.launchStampProvenance,
        poolId: zeroLiquidityPoolId,
        poolProof: {
          ...customGraphToken.launchStampProvenance.poolProof,
          poolId: zeroLiquidityPoolId,
        },
      },
    } satisfies LauncherToken;
    const stampedTokens = [
      customGraphToken,
      nonNativeClassic,
      zeroLiquidityCustom,
    ];
    const samePoolIneligible = {
      id: "1:same-pool-ineligible",
      name: "Stock paired collision",
      symbol: "COLLIDE",
      tokenAddress: customGraphToken.tokenAddress,
      hookAddress: customGraphToken.hookAddress,
      poolId: customGraphToken.poolId,
      launchedAt: customGraphToken.launchedAt,
      totalSupplyRaw: customGraphToken.totalSupplyRaw,
      tokenDecimals: customGraphToken.tokenDecimals,
      totalSwapFeeBps: 100,
      launchModel: "stock-paired",
      launchModelVersion: "stock-paired-v3",
      liquidityPath: "meme",
    } as const satisfies LauncherToken;
    mocks.multicall.mockResolvedValueOnce([
      { status: "success", result: [1n << 96n, 10, 11, 12] },
      { status: "success", result: [1n << 96n, 20, 21, 22] },
      { status: "success", result: [1n << 96n, 30, 31, 32] },
    ]).mockResolvedValueOnce([
      { status: "success", result: 1_000_000n },
      { status: "success", result: 2_000_000n },
      { status: "success", result: 0n },
    ]);
    const snapshot = {
      chainId: 1,
      blockNumber: "25680001",
      blockHash: `0x${"88".repeat(32)}` as `0x${string}`,
      confirmations: 0,
      ethUsdQuote: {
        feedAddress: "0x8888888888888888888888888888888888888888" as const,
        roundId: "1",
        answer: "300000000000",
        decimals: 8,
        updatedAt: "2026-08-09T12:00:00.000Z",
      },
    };

    const enriched = await enrichTokensWithAlchemyPoolState({
      deployment,
      snapshot,
      tokens: [...stampedTokens, samePoolIneligible],
    });

    expect(mocks.multicall).toHaveBeenCalledTimes(2);
    const [slot0Request] = mocks.multicall.mock.calls[0];
    const [liquidityRequest] = mocks.multicall.mock.calls[1];
    expect(slot0Request).toMatchObject({
      blockNumber: 25_680_001n,
      contracts: stampedTokens.map((candidate) => ({
        functionName: "getSlot0",
        args: [candidate.poolId],
      })),
    });
    expect(liquidityRequest).toMatchObject({
      blockNumber: 25_680_001n,
      contracts: stampedTokens.map((candidate) => ({
        functionName: "getLiquidity",
        args: [candidate.poolId],
      })),
    });

    expect(enriched[0]).toMatchObject({
      currentTick: 10,
      activeLiquidity: "1000000",
      protocolFeePips: 11,
      lpFeePips: 12,
      tokenPriceEthWei: (10n ** 18n).toString(),
      marketCapEthWei: (1_000n * 10n ** 18n).toString(),
      fdvUsdWad: (3_000_000n * 10n ** 18n).toString(),
      indexedValuationBlockNumber: "25680001",
    });
    expect(enriched[1]).toMatchObject({
      currentTick: 20,
      activeLiquidity: "2000000",
      protocolFeePips: 21,
      lpFeePips: 22,
    });
    expect(enriched[1]).not.toHaveProperty("indexedValuationBlockNumber");
    expect(enriched[1]).not.toHaveProperty("tokenPriceEthWei");
    expect(enriched[1]).not.toHaveProperty("marketCapEthWei");
    expect(enriched[1]).not.toHaveProperty("fdvUsdWad");
    expect(enriched[1]).not.toHaveProperty("indexedMarketCapEth");
    expect(enriched[1]).not.toHaveProperty("indexedMarketCapEthWei");
    expect(enriched[1]).not.toHaveProperty("indexedMarketCapUsdWad");
    for (const field of Object.keys(staleValuation)) {
      expect(enriched[1]).not.toHaveProperty(field);
    }
    expect(enriched[2]).toMatchObject({
      currentTick: 30,
      activeLiquidity: "0",
      protocolFeePips: 31,
      lpFeePips: 32,
    });
    expect(enriched[2]).not.toHaveProperty("indexedValuationBlockNumber");
    expect(enriched[2]).not.toHaveProperty("tokenPriceEthWei");
    expect(enriched[2]).not.toHaveProperty("marketCapEthWei");
    expect(enriched[2]).not.toHaveProperty("fdvUsdWad");
    expect(enriched[2]).not.toHaveProperty("indexedMarketCapEth");
    expect(enriched[2]).not.toHaveProperty("indexedMarketCapEthWei");
    expect(enriched[2]).not.toHaveProperty("indexedMarketCapUsdWad");
    for (const field of Object.keys(staleValuation)) {
      expect(enriched[2]).not.toHaveProperty(field);
    }
    expect(enriched[3]).toEqual(samePoolIneligible);
    expect(enriched[3]).not.toHaveProperty("currentTick");
    expect(enriched[3]).not.toHaveProperty("activeLiquidity");
  });

  it("does not relabel stale USD as current when the live snapshot has no USD quote", async () => {
    mocks.multicall.mockResolvedValueOnce([
      {
        status: "success",
        result: [1n << 96n, 0, 0, 10_000],
      },
    ]).mockResolvedValueOnce([
      {
        status: "success",
        result: 1_000_000n,
      },
    ]);
    const token = {
      id: "1:live-without-usd",
      name: "Live without USD",
      symbol: "NOUSD",
      tokenAddress: "0x1212121212121212121212121212121212121212",
      hookAddress: "0x3434343434343434343434343434343434343434",
      poolId: `0x${"56".repeat(32)}`,
      launchedAt: "2026-08-04T00:00:00.000Z",
      totalSupplyRaw: (1_000n * 10n ** 18n).toString(),
      tokenDecimals: 18,
      indexedMarketCapUsdWad: (2_700_000n * 10n ** 18n).toString(),
      indexedValuationBlockNumber: "25670000",
      launchModel: "classic",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;

    const [enriched] = await enrichTokensWithAlchemyPoolState({
      deployment,
      snapshot: {
        chainId: 1,
        blockNumber: "25680003",
        blockHash: `0x${"78".repeat(32)}` as `0x${string}`,
        confirmations: 0,
      },
      tokens: [token],
    });

    expect(enriched).not.toHaveProperty("indexedMarketCapUsdWad");
    expect(enriched).not.toHaveProperty("fdvUsdWad");
    expect(exploreValuation(enriched, {
      referenceBlock: "25680003",
    })).toEqual({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "eth",
      valueWad: (1_000n * 10n ** 18n).toString(),
      freshness: "current",
      asOfBlock: "25680003",
      lagBlocks: "0",
    });
  });

  it("keeps last-known valuation provenance when the live pool state read is unavailable", async () => {
    mocks.multicall.mockRejectedValue(
      new Error("temporary StateView read failure"),
    );
    const staleToken = {
      id: "1:stale-live",
      name: "Stale live",
      symbol: "STALE",
      tokenAddress: "0x9999999999999999999999999999999999999999",
      hookAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      poolId: `0x${"cc".repeat(32)}`,
      launchedAt: "2026-08-10T00:00:00.000Z",
      totalSupplyRaw: (1_000n * 10n ** 18n).toString(),
      tokenDecimals: 18,
      tokenPriceEth: "999",
      tokenPriceEthWei: "999",
      tokenPriceUsdWad: "999",
      marketCapEth: "999",
      marketCapEthWei: "999",
      indexedMarketCapEth: "999",
      indexedMarketCapEthWei: "999",
      indexedMarketCapUsdWad: "999",
      indexedValuationBlockNumber: "25680001",
      fdvUsdWad: "999",
      launchModel: "classic",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;
    const snapshot = {
      chainId: 1,
      blockNumber: "25680002",
      blockHash: `0x${"dd".repeat(32)}` as `0x${string}`,
      confirmations: 0,
    };

    const [enriched] = await enrichTokensWithAlchemyPoolState({
      deployment,
      snapshot,
      tokens: [staleToken],
    });

    expect(enriched).toEqual(staleToken);
    expect(enriched?.indexedValuationBlockNumber).toBe("25680001");
    expect(mocks.multicall).toHaveBeenCalledTimes(2);
  });

  it("does not reuse same-height pool state across a block-hash change", async () => {
    const token = {
      id: "1:reorg-cache",
      name: "Reorg cache",
      symbol: "REORG",
      tokenAddress: "0x1313131313131313131313131313131313131313",
      hookAddress: "0x2424242424242424242424242424242424242424",
      poolId: `0x${"35".repeat(32)}`,
      launchedAt: "2026-08-13T00:00:00.000Z",
      totalSupplyRaw: "1000000000000000000000",
      tokenDecimals: 18,
      launchModel: "classic",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;
    const firstHash = `0x${"41".repeat(32)}` as const;
    const secondHash = `0x${"42".repeat(32)}` as const;
    mocks.multicall
      .mockResolvedValueOnce([{ status: "success", result: [1n << 96n, 1, 0, 0] }])
      .mockResolvedValueOnce([{ status: "success", result: 1_000_000n }])
      .mockResolvedValueOnce([{ status: "success", result: [1n << 96n, 2, 0, 0] }])
      .mockResolvedValueOnce([{ status: "success", result: 2_000_000n }]);
    mocks.getBlock
      .mockResolvedValueOnce({ hash: firstHash, timestamp: 1_786_400_100n })
      .mockResolvedValueOnce({ hash: secondHash, timestamp: 1_786_400_101n });

    const [first] = await enrichTokensWithAlchemyPoolState({
      deployment,
      snapshot: {
        chainId: 1,
        blockNumber: "25690000",
        blockHash: firstHash,
        confirmations: 12,
      },
      tokens: [token],
    });
    const [second] = await enrichTokensWithAlchemyPoolState({
      deployment,
      snapshot: {
        chainId: 1,
        blockNumber: "25690000",
        blockHash: secondHash,
        confirmations: 12,
      },
      tokens: [token],
    });

    expect(first).toMatchObject({
      currentTick: 1,
      liveMarketStateEvidence: { blockHash: firstHash },
    });
    expect(second).toMatchObject({
      currentTick: 2,
      liveMarketStateEvidence: { blockHash: secondHash },
    });
    expect(mocks.multicall).toHaveBeenCalledTimes(4);
  });

  it("replays StateView on the secondary when the primary block hash mismatches", async () => {
    const expectedHash = `0x${"51".repeat(32)}` as const;
    const token = {
      id: "1:hash-failover",
      name: "Hash failover",
      symbol: "HASH",
      tokenAddress: "0x1414141414141414141414141414141414141414",
      hookAddress: "0x2525252525252525252525252525252525252525",
      poolId: `0x${"36".repeat(32)}`,
      launchedAt: "2026-08-13T00:00:00.000Z",
      totalSupplyRaw: "1000000000000000000000",
      tokenDecimals: 18,
      launchModel: "classic",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;
    mocks.multicall
      .mockResolvedValueOnce([{ status: "success", result: [1n << 96n, 1, 0, 0] }])
      .mockResolvedValueOnce([{ status: "success", result: 10n }])
      .mockResolvedValueOnce([{ status: "success", result: [1n << 96n, 2, 0, 0] }])
      .mockResolvedValueOnce([{ status: "success", result: 20n }]);
    mocks.getBlock
      .mockResolvedValueOnce({
        hash: `0x${"52".repeat(32)}`,
        timestamp: 1_786_400_100n,
      })
      .mockResolvedValueOnce({ hash: expectedHash, timestamp: 1_786_400_100n });

    const [enriched] = await enrichTokensWithAlchemyPoolState({
      deployment: {
        ...deployment,
        rpcUrlSecondary: "https://secondary.example",
      },
      snapshot: {
        chainId: 1,
        blockNumber: "25690001",
        blockHash: expectedHash,
        confirmations: 12,
      },
      tokens: [token],
    });

    expect(enriched).toMatchObject({
      currentTick: 2,
      activeLiquidity: "20",
      liveMarketStateEvidence: { blockHash: expectedHash },
    });
    expect(mocks.multicall).toHaveBeenCalledTimes(4);
  });

  it("publishes no evidence when both StateView providers disagree on the hash", async () => {
    const expectedHash = `0x${"61".repeat(32)}` as const;
    const token = {
      id: "1:hash-fail-closed",
      name: "Hash fail closed",
      symbol: "CLOSED",
      tokenAddress: "0x1515151515151515151515151515151515151515",
      hookAddress: "0x2626262626262626262626262626262626262626",
      poolId: `0x${"37".repeat(32)}`,
      launchedAt: "2026-08-13T00:00:00.000Z",
      totalSupplyRaw: "1000000000000000000000",
      tokenDecimals: 18,
      launchModel: "classic",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;
    mocks.multicall
      .mockResolvedValueOnce([{ status: "success", result: [1n << 96n, 1, 0, 0] }])
      .mockResolvedValueOnce([{ status: "success", result: 10n }])
      .mockResolvedValueOnce([{ status: "success", result: [1n << 96n, 2, 0, 0] }])
      .mockResolvedValueOnce([{ status: "success", result: 20n }]);
    mocks.getBlock
      .mockResolvedValueOnce({
        hash: `0x${"62".repeat(32)}`,
        timestamp: 1_786_400_100n,
      })
      .mockResolvedValueOnce({
        hash: `0x${"63".repeat(32)}`,
        timestamp: 1_786_400_100n,
      });

    const [enriched] = await enrichTokensWithAlchemyPoolState({
      deployment: {
        ...deployment,
        rpcUrlSecondary: "https://secondary.example",
      },
      snapshot: {
        chainId: 1,
        blockNumber: "25690002",
        blockHash: expectedHash,
        confirmations: 12,
      },
      tokens: [token],
    });

    expect(enriched).not.toHaveProperty("liveMarketStateEvidence");
    expect(enriched).not.toHaveProperty("liveMarketPriceEvidence");
    expect(mocks.multicall).toHaveBeenCalledTimes(4);
  });
});
