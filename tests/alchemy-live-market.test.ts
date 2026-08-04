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
    mocks.multicall.mockResolvedValue([
      {
        status: "success",
        result: [1n << 96n, 0, 0, 10_000],
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
    });
    expect(second).toEqual(first);
    expect(mocks.multicall).toHaveBeenCalledTimes(1);
  });
});
