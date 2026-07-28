import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";

import {
  deepGrowthVaultReadAbi,
  DEEP_COMPLETION_TOLERANCE_WEI,
  DEEP_MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI,
} from "../lib/deep-v1";
import { DEEP_GROWTH_TARGET_WEI } from "../lib/launch";
import {
  parseDeepProfileRewards,
  validatePreparedDeepRewardAction,
} from "../lib/profile/deep-rewards";

const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const payout = "0x3333333333333333333333333333333333333333";
const vault = "0x4444444444444444444444444444444444444444";
const token = "0x5555555555555555555555555555555555555555";
const oracle = "0x6666666666666666666666666666666666666666";
const upstreamVault =
  "0x7777777777777777777777777777777777777777";
const poolId = `0x${"88".repeat(32)}`;
const transactionHash = `0x${"99".repeat(32)}`;

function rewardResponse() {
  return {
    status: "ready",
    account,
    chainId: 1,
    rewards: [
      {
        model: "deep",
        tokenAddress: token,
        tokenName: "Deep Token",
        tokenSymbol: "DEEP",
        imageUrl: "https://programmable.family/deep.png",
        poolId,
        vaultAddress: vault,
        oracleGuardAddress: oracle,
        upstreamRewardVaultAddress: upstreamVault,
        beneficiary: account,
        payoutAddress: payout,
        shareBps: 6000,
        claimableWei: "100000000000000000",
        claimableEth: "0.1",
        claimedWei: "200000000000000000",
        claimedEth: "0.2",
        buySwapFeeBps: 300,
        sellSwapFeeBps: 700,
        platformFeeBps: 10,
        beneficiaries: [
          {
            beneficiary: account,
            payoutAddress: payout,
            shareBps: 6000,
          },
          {
            beneficiary: other,
            payoutAddress: other,
            shareBps: 4000,
          },
        ],
        growthTargetWei: DEEP_GROWTH_TARGET_WEI.toString(),
        growthTargetEth: "0.05",
        completionToleranceWei:
          DEEP_COMPLETION_TOLERANCE_WEI.toString(),
        minimumNativeLiquidityForCompletionWei:
          DEEP_MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI.toString(),
        nativeAllocatedToGrowthWei: "20000000000000000",
        nativeAllocatedToGrowthEth: "0.02",
        nativeAddedToLiquidityWei: "15000000000000000",
        nativeAddedToLiquidityEth: "0.015",
        pendingGrowthNativeWei: "5000000000000000",
        pendingGrowthNativeEth: "0.005",
        deferredRewardFeesWei: "3000000000000000",
        deferredRewardFeesEth: "0.003",
        tokenReserveRaw: "150000000000000000000000000",
        growthTargetReached: false,
        oracleReady: true,
        automationAction: 2,
        nextCompoundTimestamp: "1770000000",
        trustedNativeDepthWei: "100000000000000000",
        depthCapNativeWei: "250000000000000",
        automationGuaranteed: false,
        launchTransactionHash: transactionHash,
      },
    ],
  };
}

describe("Deep profile rewards", () => {
  it("accepts a complete beneficiary-owned growth reward record", () => {
    const profile = parseDeepProfileRewards(rewardResponse(), account);
    expect(profile.status).toBe("ready");
    if (profile.status !== "ready") return;
    expect(profile.rewards[0]).toMatchObject({
      model: "deep",
      beneficiary: account,
      payoutAddress: payout,
      shareBps: 6000,
      buySwapFeeBps: 300,
      sellSwapFeeBps: 700,
      platformFeeBps: 10,
      growthTargetReached: false,
      oracleReady: true,
      automationAction: 2,
      automationGuaranteed: false,
    });
  });

  it("keeps reward ownership separate from the mutable payout address", () => {
    expect(() =>
      parseDeepProfileRewards(rewardResponse(), other),
    ).toThrow("does not match");

    const invalid = rewardResponse();
    invalid.rewards[0].beneficiaries[0].shareBps = 5000;
    expect(() =>
      parseDeepProfileRewards(invalid, account),
    ).toThrow("immutable reward split");
  });

  it("accepts only the beneficiary's canonical claim transaction", () => {
    const transaction = {
      kind: "claim-deep-rewards" as const,
      chainId: 1 as const,
      from: account,
      to: vault,
      data: encodeFunctionData({
        abi: deepGrowthVaultReadAbi,
        functionName: "claimRewards",
      }),
      value: "0",
      gasLimit: "160000",
    };
    expect(
      validatePreparedDeepRewardAction(
        {
          status: "ready",
          action: "claim",
          account,
          vaultAddress: vault,
          transaction,
        },
        {
          action: "claim",
          account,
          vaultAddress: vault,
          chainId: 1,
        },
      ).transaction,
    ).toEqual(transaction);

    expect(() =>
      validatePreparedDeepRewardAction(
        {
          status: "ready",
          action: "claim",
          account,
          vaultAddress: vault,
          transaction: { ...transaction, from: other },
        },
        {
          action: "claim",
          account,
          vaultAddress: vault,
          chainId: 1,
        },
      ),
    ).toThrow("not canonical");
  });

  it("binds a payout update to the selected destination", () => {
    const transaction = {
      kind: "update-deep-payout" as const,
      chainId: 1 as const,
      from: account,
      to: vault,
      data: encodeFunctionData({
        abi: deepGrowthVaultReadAbi,
        functionName: "setPayoutAddress",
        args: [payout],
      }),
      value: "0",
      gasLimit: "100000",
    };
    expect(
      validatePreparedDeepRewardAction(
        {
          status: "ready",
          action: "update-payout",
          account,
          vaultAddress: vault,
          transaction,
        },
        {
          action: "update-payout",
          account,
          vaultAddress: vault,
          newPayoutAddress: payout,
          chainId: 1,
        },
      ).transaction,
    ).toEqual(transaction);
  });
});
