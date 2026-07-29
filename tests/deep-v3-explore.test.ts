import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  deepV3ProfileToLauncherToken,
  isDeepV3ExploreReleaseReady,
  readDeepV3ExploreModel,
} from "../lib/onchain/deep-v3-explore";
import {
  DEEP_V3_FIXED_POLICY,
  type DeepV3LaunchBundle,
} from "../lib/onchain/deep-v3-read-model";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import type { DeepV3ProfileToken } from "../lib/profile/deep-v3-profile.server";
import {
  DEEP_V3_TEST_ADDRESSES,
  DEEP_V3_TEST_CREATOR,
  DEEP_V3_TEST_LAUNCH_HASH,
  DEEP_V3_TEST_POOL_ID,
  DEEP_V3_TEST_POSITION_RECIPIENT,
  DEEP_V3_TEST_TOKEN,
  DEEP_V3_TEST_TRANSACTION_HASH,
  DEEP_V3_TEST_VAULT,
  deepV3TestProvenance,
} from "./deep-v3-fixture";

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 100n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://primary.example",
  rpcUrlSecondary: "https://secondary.example",
  confirmations: 12n,
  logBlockRange: 10_000n,
} satisfies ReadyOnchainDeployment;

function bundle(): DeepV3LaunchBundle {
  return {
    provenance: deepV3TestProvenance(),
    configuration: {
      token: DEEP_V3_TEST_TOKEN,
      totalSupply: BigInt(DEEP_V3_FIXED_POLICY.tokenSupplyWei),
      initialLockedTokenDust: 1n,
      totalHookFeeBps: 100,
      growthFeeBps: 90,
      programmableFeeBps: 10,
      initialTick: DEEP_V3_FIXED_POLICY.initialTick,
      fullRangeTickLower: DEEP_V3_FIXED_POLICY.fullRangeTickLower,
      fullRangeTickUpper: DEEP_V3_FIXED_POLICY.fullRangeTickUpper,
      launchHash: DEEP_V3_TEST_LAUNCH_HASH,
    },
    initialBuy: {
      deployer: DEEP_V3_TEST_CREATOR,
      token: DEEP_V3_TEST_TOKEN,
      poolId: DEEP_V3_TEST_POOL_ID,
      nativeAmount: BigInt(DEEP_V3_FIXED_POLICY.minimumInitialBuyWei),
      tokenAmount: 100n,
      sqrtPriceLimitX96: 1n,
      launchHash: DEEP_V3_TEST_LAUNCH_HASH,
    },
    registryIndex: 0n,
  };
}

function profile(): DeepV3ProfileToken {
  return {
    deepReleaseVersion: "deep-full-range-v3",
    launchModel: "deep",
    tokenAddress: DEEP_V3_TEST_TOKEN,
    tokenName: "Deep",
    tokenSymbol: "DEEP",
    description: "Permanent same-pool liquidity growth",
    imageUrl: "https://programmable.family/deep.png",
    links: [
      { kind: "website", url: "https://programmable.family/" },
    ],
    creator: DEEP_V3_TEST_CREATOR,
    launcher: DEEP_V3_TEST_ADDRESSES.launcher,
    hookAddress: DEEP_V3_TEST_ADDRESSES.feeHook,
    vaultAddress: DEEP_V3_TEST_VAULT,
    poolId: DEEP_V3_TEST_POOL_ID,
    positionRecipient: DEEP_V3_TEST_POSITION_RECIPIENT,
    positionTokenId: "77",
    launchHash: DEEP_V3_TEST_LAUNCH_HASH,
    launchTransactionHash: DEEP_V3_TEST_TRANSACTION_HASH,
    launchBlockNumber: "123",
    launchedAt: "2026-07-29T00:00:00.000Z",
    totalSupplyRaw: DEEP_V3_FIXED_POLICY.tokenSupplyWei,
    tokenDecimals: 18,
    totalHookFeeBps: 100,
    growthFeeBps: 90,
    programmableFeeBps: 10,
    transferTaxBps: 0,
    lpFeePips: 0,
    sqrtPriceX96: "100",
    currentTick: 1,
    protocolFeePips: 0,
    activeLiquidity: "1000",
    nativePriceWad: "1000000000000000",
    marketCapNativeWad: "1000000000000000000",
    pendingGrowthNativeWei: "10",
    accruedGrowthFeesWei: "90",
    totalGrowthEthReceivedWei: "810",
    totalNativeSwappedWei: "100",
    totalTokenAcquiredRaw: "200",
    totalNativeAddedWei: "700",
    totalTokenAddedRaw: "300",
    lockedLiquidity: "400",
    trustedNativeDepthWei: "500",
    rollingExposureWei: "50",
    compoundCount: "2",
    lastCompoundTimestamp: "1000",
    automationAction: 1,
    nextEligibleTimestamp: "1300",
    rollingCapacityWei: "450",
    blockedReason: "0x00000000",
  };
}

describe("Deep V3 Explore integration", () => {
  it("keeps the checked-in non-live release out of Explore", async () => {
    expect(isDeepV3ExploreReleaseReady(deployment)).toBe(false);
    await expect(
      readDeepV3ExploreModel(deployment, "123"),
    ).resolves.toBeNull();
  });

  it("serializes canonical V3 state without creator rewards", () => {
    const token = deepV3ProfileToLauncherToken({
      chainId: 1,
      profile: profile(),
      bundle: bundle(),
      volume: {
        grossNativeAmount: 90_000n,
        growthFees: 900n,
        programmableFees: 100n,
        swapCount: 2,
      },
    });

    expect(token).toMatchObject({
      launchModel: "deep",
      deepReleaseVersion: "deep-full-range-v3",
      deepV3Provenance: deepV3TestProvenance(),
      creatorFeesGeneratedWei: "0",
      creatorFeesAccruedWei: "0",
      growthFeesGeneratedWei: "900",
      growthFeesAccruedWei: "90",
      growthFeeBps: 90,
      programmableFeeBps: 10,
      launcherFeeBps: 10,
      growthVaultAddress: DEEP_V3_TEST_VAULT,
    });
    expect(token.creatorFeeBps).toBeUndefined();
    expect(token.deepV2Provenance).toBeUndefined();
  });

  it("rejects growth accounting that does not match fee events", () => {
    expect(() =>
      deepV3ProfileToLauncherToken({
        chainId: 1,
        profile: profile(),
        bundle: bundle(),
        volume: {
          grossNativeAmount: 90_000n,
          growthFees: 899n,
          programmableFees: 100n,
          swapCount: 2,
        },
      }),
    ).toThrow(/does not match launch provenance/);
  });
});
