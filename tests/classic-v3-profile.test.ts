import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";

import { feeSplitVaultAbi } from "../lib/classic-v3";
import {
  parseClassicV3ProfileRewards,
  validatePreparedClassicV3RewardAction,
} from "../lib/profile/classic-v3-rewards";

const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const payout = "0x3333333333333333333333333333333333333333";
const vault = "0x4444444444444444444444444444444444444444";
const token = "0x5555555555555555555555555555555555555555";
const poolId = `0x${"66".repeat(32)}`;
const transactionHash = `0x${"77".repeat(32)}`;

function rewardResponse() {
  return {
    status: "ready",
    account,
    chainId: 1,
    rewards: [
      {
        tokenAddress: token,
        tokenName: "Directional",
        tokenSymbol: "DIR",
        poolId,
        vaultAddress: vault,
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
        launchTransactionHash: transactionHash,
      },
    ],
  };
}

describe("Classic V3 profile rewards", () => {
  it("accepts only rewards owned by the connected immutable beneficiary", () => {
    const profile = parseClassicV3ProfileRewards(rewardResponse(), account);
    expect(profile.status).toBe("ready");
    if (profile.status !== "ready") return;
    expect(profile.rewards[0]).toMatchObject({
      beneficiary: account,
      payoutAddress: payout,
      shareBps: 6000,
      buySwapFeeBps: 300,
      sellSwapFeeBps: 700,
      platformFeeBps: 10,
    });
    expect(() =>
      parseClassicV3ProfileRewards(rewardResponse(), other),
    ).toThrow("does not match");
  });

  it("rejects duplicate immutable beneficiaries and invalid totals", () => {
    const duplicated = rewardResponse();
    duplicated.rewards[0].beneficiaries[1].beneficiary = account;
    expect(() =>
      parseClassicV3ProfileRewards(duplicated, account),
    ).toThrow("immutable reward split");
  });

  it("accepts only beneficiary-originated claim calldata", () => {
    const transaction = {
      kind: "claim-classic-v3-rewards" as const,
      chainId: 1 as const,
      from: account,
      to: vault,
      data: encodeFunctionData({
        abi: feeSplitVaultAbi,
        functionName: "claim",
      }),
      value: "0",
      gasLimit: "120000",
    };
    expect(
      validatePreparedClassicV3RewardAction(
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
      validatePreparedClassicV3RewardAction(
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

  it("updates payout in one step without changing claim authority", () => {
    const transaction = {
      kind: "update-classic-v3-payout" as const,
      chainId: 1 as const,
      from: account,
      to: vault,
      data: encodeFunctionData({
        abi: feeSplitVaultAbi,
        functionName: "setPayoutAddress",
        args: [payout],
      }),
      value: "0",
      gasLimit: "80000",
    };
    expect(
      validatePreparedClassicV3RewardAction(
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
      ).transaction.from,
    ).toBe(account);
  });
});
