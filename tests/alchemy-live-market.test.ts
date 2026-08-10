import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  multicall: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({ multicall: mocks.multicall })),
  };
});

import { enrichTokensWithAlchemyPoolState } from "../lib/alchemy/live-market.server";
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
    expect(mocks.multicall).toHaveBeenCalledTimes(2);
    expect(mocks.multicall.mock.calls.every(
      ([request]) => request.blockNumber === 25_680_000n,
    )).toBe(true);
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
});
