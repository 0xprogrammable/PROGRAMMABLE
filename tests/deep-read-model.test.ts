import { describe, expect, it } from "vitest";

import {
  deepAtomicEventKey,
  mergeDeepExploreModel,
  readDeepExploreModel,
} from "../lib/onchain/deep-read-model";
import type {
  ExploreReadModel,
  OnchainDeployment,
} from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const snapshot = {
  chainId: 1,
  blockNumber: "123",
  blockHash: `0x${"11".repeat(32)}` as const,
  confirmations: 12,
};
const classicToken = {
  id: "1:0x1111111111111111111111111111111111111111",
  name: "Classic",
  symbol: "CLASSIC",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"22".repeat(32)}`,
  launchedAt: "2026-07-28T00:00:00.000Z",
  totalSwapFeeBps: 100,
  launchModel: "classic",
  liquidityPath: "meme",
} satisfies LauncherToken;
const deepToken = {
  id: "1:0x3333333333333333333333333333333333333333",
  name: "Deep",
  symbol: "DEEP",
  tokenAddress: "0x3333333333333333333333333333333333333333",
  hookAddress: "0x4444444444444444444444444444444444444444",
  poolId: `0x${"33".repeat(32)}`,
  launchedAt: "2026-07-28T00:01:00.000Z",
  totalSwapFeeBps: 300,
  launchModel: "deep",
  growthVaultAddress:
    "0x5555555555555555555555555555555555555555",
  automationGuaranteed: false,
  liquidityPath: "meme",
} satisfies LauncherToken;

function readyModel(
  tokens: LauncherToken[],
  launcherFeesAccruedWei: string,
): ExploreReadModel {
  return {
    status: "ready",
    tokens,
    snapshot,
    creatorClaims: [],
    launcherFeesAccruedWei,
    launcherFeesAccruedEth:
      launcherFeesAccruedWei === "1000000000000000"
        ? "0.001"
        : "0.002",
  };
}

describe("Deep Explore read model", () => {
  it("does not touch RPC before an exact eligible release exists", async () => {
    const config: OnchainDeployment = {
      environment: "production",
      releaseVersion: "classic-v2",
      chainId: 1,
      status: "ready",
      launcher: "0x1111111111111111111111111111111111111111",
      feeHook: "0x2222222222222222222222222222222222222222",
      launcherRuntimeCodeHash: `0x${"44".repeat(32)}`,
      feeHookRuntimeCodeHash: `0x${"55".repeat(32)}`,
      deploymentBlock: 1n,
      stateView: "0x3333333333333333333333333333333333333333",
      stateViewRuntimeCodeHash: `0x${"66".repeat(32)}`,
      rpcUrl: "https://this-must-not-be-called.invalid",
      rpcUrlSecondary: null,
      confirmations: 12n,
      logBlockRange: 10_000n,
    };

    await expect(readDeepExploreModel(config)).resolves.toBeNull();
  });

  it("merges a confirmed Deep registry into the same Explore snapshot", () => {
    const merged = mergeDeepExploreModel(
      readyModel([classicToken], "1000000000000000"),
      readyModel([deepToken], "2000000000000000"),
    );

    expect(merged.status).toBe("ready");
    expect(merged.tokens).toEqual([classicToken, deepToken]);
    expect(merged.launcherFeesAccruedWei).toBe("3000000000000000");
    expect(merged.launcherFeesAccruedEth).toBe("0.003");
  });

  it("keys atomic launch records by transaction, token and launch hash", () => {
    expect(
      deepAtomicEventKey(
        `0x${"AA".repeat(32)}`,
        "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        `0x${"CC".repeat(32)}`,
      ),
    ).toBe(
      `${`0x${"aa".repeat(32)}`}:0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:${`0x${"cc".repeat(32)}`}`,
    );
  });
});
