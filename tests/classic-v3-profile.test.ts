import { describe, expect, it, vi } from "vitest";
import { encodeFunctionData } from "viem";

import { classicRewardVaultAbi } from "../lib/classic-v3";
import { CLASSIC_V4_PUBLIC_RELEASE_BINDING } from "../lib/classic-v4-public-release";
import {
  ClassicV3ProfileReadError,
  classicV3ProfileApiError,
  fetchClassicV3ProfileRewards,
  parseClassicV3ProfileRewards,
  prepareClassicV3RewardAction,
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
        releaseVersion: "classic-v3",
        tokenAddress: token,
        tokenName: "Directional",
        tokenSymbol: "DIR",
        poolId,
        vaultAddress: vault,
        beneficiary: account,
        payoutAddress: account,
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
            allocationIndex: 0,
            beneficiary: account,
            payoutAddress: account,
            shareBps: 6000,
          },
          {
            allocationIndex: 1,
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
  it("treats a verified empty reward list as a healthy empty account", async () => {
    const response = { ...rewardResponse(), rewards: [] };
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    await expect(
      fetchClassicV3ProfileRewards(account, undefined, fetcher),
    ).resolves.toMatchObject({ status: "ready", account, rewards: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries one temporary read failure and recovers with verified rewards", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          error: "Classic rewards are temporarily unavailable",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json" },
        },
      ),
      new Response(JSON.stringify(rewardResponse()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);
    const wait = vi.fn(async () => undefined);

    await expect(
      fetchClassicV3ProfileRewards(account, undefined, fetcher, { wait }),
    ).resolves.toMatchObject({ status: "ready", account });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("bounds temporary retries and exposes only a calm classified error", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error:
              "RPC https://provider.example/secret failed with an internal stack",
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          },
        ),
    );

    const failure = await fetchClassicV3ProfileRewards(
      account,
      undefined,
      fetcher,
      { wait: async () => undefined },
    ).catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(ClassicV3ProfileReadError);
    expect(failure).toMatchObject({
      kind: "temporary",
      message: "Classic rewards are temporarily unavailable",
    });
    expect(String(failure)).not.toContain("provider.example");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("classifies a non-JSON 503 as temporary without exposing its body", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("provider gateway secret", {
          status: 503,
          headers: { "Content-Type": "text/html" },
        }),
    );

    const failure = await fetchClassicV3ProfileRewards(
      account,
      undefined,
      fetcher,
      { wait: async () => undefined },
    ).catch((caught: unknown) => caught);

    expect(failure).toMatchObject({
      kind: "temporary",
      message: "Classic rewards are temporarily unavailable",
    });
    expect(String(failure)).not.toContain("gateway secret");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops retrying when a wallet change aborts the active read", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "temporarily unavailable" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const wait = vi.fn(async (_delayMs: number, signal?: AbortSignal) => {
      controller.abort(new DOMException("Wallet changed", "AbortError"));
      throw signal?.reason;
    });

    await expect(
      fetchClassicV3ProfileRewards(account, controller.signal, fetcher, {
        wait,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("does not retry or turn an invalid accounting response into an empty state", async () => {
    const mismatched = rewardResponse();
    mismatched.rewards[0].claimableEth = "0";
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(mismatched), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const failure = await fetchClassicV3ProfileRewards(
      account,
      undefined,
      fetcher,
      { wait: async () => undefined },
    ).catch((caught: unknown) => caught);

    expect(failure).toBeInstanceOf(ClassicV3ProfileReadError);
    expect(failure).toMatchObject({
      kind: "integrity",
      message: "Classic reward data could not be verified",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("never retries a typed API accounting or integrity conflict", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify(classicV3ProfileApiError("integrity")), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const wait = vi.fn(async () => undefined);

    await expect(
      fetchClassicV3ProfileRewards(account, undefined, fetcher, { wait }),
    ).rejects.toMatchObject({
      kind: "integrity",
      message: "Classic reward data could not be verified",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("classifies a non-JSON success response as an integrity failure", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("upstream gateway page", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
    );

    await expect(
      fetchClassicV3ProfileRewards(account, undefined, fetcher, {
        wait: async () => undefined,
      }),
    ).rejects.toMatchObject({ kind: "integrity" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("accepts only rewards owned by the connected immutable beneficiary", () => {
    const profile = parseClassicV3ProfileRewards(rewardResponse(), account);
    expect(profile.status).toBe("ready");
    if (profile.status !== "ready") return;
    expect(profile.rewards[0]).toMatchObject({
      beneficiary: account,
      payoutAddress: account,
      shareBps: 6000,
      buySwapFeeBps: 300,
      sellSwapFeeBps: 700,
      platformFeeBps: 10,
    });
    expect(() => parseClassicV3ProfileRewards(rewardResponse(), other)).toThrow(
      "does not match",
    );
  });

  it("accepts consolidated wallets but rejects invalid allocation indexes", () => {
    const consolidated = rewardResponse();
    consolidated.rewards[0].beneficiaries[1].beneficiary = account;
    consolidated.rewards[0].beneficiaries[1].payoutAddress = account;
    consolidated.rewards[0].shareBps = 10_000;
    expect(parseClassicV3ProfileRewards(consolidated, account)).toMatchObject({
      status: "ready",
    });

    const invalid = rewardResponse();
    invalid.rewards[0].beneficiaries[1].allocationIndex = 0;
    expect(() => parseClassicV3ProfileRewards(invalid, account)).toThrow(
      "current reward allocation",
    );
  });

  it("accepts only beneficiary-originated claim calldata", () => {
    const transaction = {
      kind: "claim-classic-v3-rewards" as const,
      chainId: 1 as const,
      from: account,
      to: vault,
      data: encodeFunctionData({
        abi: classicRewardVaultAbi,
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
          releaseVersion: "classic-v3",
          account,
          vaultAddress: vault,
          transaction,
        },
        {
          action: "claim",
          account,
          vaultAddress: vault,
          chainId: 1,
          releaseVersion: "classic-v3",
        },
      ).transaction,
    ).toEqual(transaction);
    expect(() =>
      validatePreparedClassicV3RewardAction(
        {
          status: "ready",
          action: "claim",
          releaseVersion: "classic-v3",
          account,
          vaultAddress: vault,
          transaction: { ...transaction, from: other },
        },
        {
          action: "claim",
          account,
          vaultAddress: vault,
          chainId: 1,
          releaseVersion: "classic-v3",
        },
      ),
    ).toThrow("not canonical");
  });

  it("retries one transient claim-preparation failure before opening the wallet", async () => {
    const transaction = {
      kind: "claim-classic-v3-rewards" as const,
      chainId: 1 as const,
      from: account,
      to: vault,
      data: encodeFunctionData({
        abi: classicRewardVaultAbi,
        functionName: "claim",
      }),
      value: "0",
      gasLimit: "120000",
    };
    const responses = [
      new Response(JSON.stringify({ error: "temporarily unavailable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      }),
      new Response(
        JSON.stringify({
          status: "ready",
          action: "claim",
          releaseVersion: "classic-v3",
          account,
          vaultAddress: vault,
          transaction,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    ];
    const fetcher = vi.fn(async () => responses.shift()!);
    const wait = vi.fn(async () => undefined);

    await expect(
      prepareClassicV3RewardAction(
        {
          action: "claim",
          account,
          vaultAddress: vault,
          chainId: 1,
          releaseVersion: "classic-v3",
        },
        undefined,
        fetcher,
        { wait },
      ),
    ).resolves.toMatchObject({
      action: "claim",
      account,
      vaultAddress: vault,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("uses the active public binding for Classic V4 rewards and fails closed without it", () => {
    const transaction = {
      kind: "claim-classic-v3-rewards" as const,
      chainId: 1 as const,
      from: account,
      to: vault,
      data: encodeFunctionData({
        abi: classicRewardVaultAbi,
        functionName: "claim",
      }),
      value: "0",
      gasLimit: "120000",
    };
    const response = {
      status: "ready",
      action: "claim",
      releaseVersion: "classic-v4",
      account,
      vaultAddress: vault,
      transaction,
    };
    const expected = {
      action: "claim" as const,
      account,
      vaultAddress: vault,
      chainId: 1,
      releaseVersion: "classic-v4" as const,
    };
    const publicBinding = CLASSIC_V4_PUBLIC_RELEASE_BINDING;
    expect(publicBinding).toMatchObject({
      chainId: 1,
      launcher: "0xBBDF30a2fE1394e4AA864aC269C6cF09b518E699",
      manifestDigest:
        "0xb08e7032c801ddc3d5ba958eb389d2728bb439e4105aef4e7706969f7426ee00",
      releaseStatus: "publicly-available",
      publicAvailable: true,
    });
    if (!publicBinding) throw new Error("Classic V4 public binding fixture");

    expect(
      validatePreparedClassicV3RewardAction(response, expected).transaction,
    ).toEqual(transaction);
    expect(() =>
      validatePreparedClassicV3RewardAction(response, expected, null),
    ).toThrow("browser release binding");
    expect(() =>
      validatePreparedClassicV3RewardAction(response, expected, {
        ...publicBinding,
        releaseStatus: "indexer-activated",
        publicAvailable: false,
      }),
    ).toThrow("browser release binding");
    expect(() =>
      validatePreparedClassicV3RewardAction(response, expected, {
        ...publicBinding,
        blockNumber: 0,
      }),
    ).toThrow("browser release binding");
  });

  it("updates payout in one step without changing claim authority", () => {
    const transaction = {
      kind: "update-classic-v3-payout" as const,
      chainId: 1 as const,
      from: account,
      to: vault,
      data: encodeFunctionData({
        abi: classicRewardVaultAbi,
        functionName: "changePayoutWallet",
        args: [0n, payout],
      }),
      value: "0",
      gasLimit: "80000",
    };
    expect(
      validatePreparedClassicV3RewardAction(
        {
          status: "ready",
          action: "update-payout",
          releaseVersion: "classic-v3",
          account,
          vaultAddress: vault,
          transaction,
        },
        {
          action: "update-payout",
          account,
          vaultAddress: vault,
          newPayoutAddress: payout,
          allocationIndex: 0,
          chainId: 1,
          releaseVersion: "classic-v3",
        },
      ).transaction.from,
    ).toBe(account);
  });
});
