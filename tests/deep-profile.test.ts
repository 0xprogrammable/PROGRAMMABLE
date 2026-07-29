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
import {
  authorizeDeepRewardVault,
  deepCandidatesFromDurableTokens,
  deepConfirmedTailScanStart,
  deepFallbackScanStart,
  paginateDeepCandidates,
  resolveDeepProfileRpcUrls,
  resolveDeepProfileSnapshot,
  validateCanonicalDeepLaunchIdentities,
  validateDeepCandidates,
  type DeepLaunchCandidate,
} from "../lib/profile/deep-profile-server";
import type { LauncherToken } from "../lib/tokens";

const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const payout = "0x3333333333333333333333333333333333333333";
const vault = "0x4444444444444444444444444444444444444444";
const token = "0x5555555555555555555555555555555555555555";
const oracle = "0x6666666666666666666666666666666666666666";
const upstreamVault = "0x7777777777777777777777777777777777777777";
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
        deepReleaseVersion: "deep-full-range-v1",
        tokenAddress: token,
        tokenName: "Deep Token",
        tokenSymbol: "DEEP",
        imageUrl: "https://programmable.family/deep.png",
        poolId: poolId as `0x${string}`,
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
        completionToleranceWei: DEEP_COMPLETION_TOLERANCE_WEI.toString(),
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
        launchTransactionHash: transactionHash as `0x${string}`,
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
    expect(() => parseDeepProfileRewards(rewardResponse(), other)).toThrow(
      "does not match",
    );

    const invalid = rewardResponse();
    invalid.rewards[0].beneficiaries[0].shareBps = 5000;
    expect(() => parseDeepProfileRewards(invalid, account)).toThrow(
      "immutable reward split",
    );
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
          deepReleaseVersion: "deep-full-range-v1",
          account,
          vaultAddress: vault,
          transaction,
        },
        {
          action: "claim",
          deepReleaseVersion: "deep-full-range-v1",
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
          deepReleaseVersion: "deep-full-range-v2",
          account,
          vaultAddress: vault,
          transaction,
        },
        {
          action: "claim",
          deepReleaseVersion: "deep-full-range-v1",
          account,
          vaultAddress: vault,
          chainId: 1,
        },
      ),
    ).toThrow("not ready");

    expect(() =>
      validatePreparedDeepRewardAction(
        {
          status: "ready",
          action: "claim",
          deepReleaseVersion: "deep-full-range-v1",
          account,
          vaultAddress: vault,
          transaction: { ...transaction, from: other },
        },
        {
          action: "claim",
          deepReleaseVersion: "deep-full-range-v1",
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
          deepReleaseVersion: "deep-full-range-v1",
          account,
          vaultAddress: vault,
          transaction,
        },
        {
          action: "update-payout",
          deepReleaseVersion: "deep-full-range-v1",
          account,
          vaultAddress: vault,
          newPayoutAddress: payout,
          chainId: 1,
        },
      ).transaction,
    ).toEqual(transaction);
  });
});

describe("Deep profile server trust boundary", () => {
  const candidate: DeepLaunchCandidate = {
    tokenAddress: token as `0x${string}`,
    vaultAddress: vault as `0x${string}`,
    blockNumber: 100n,
    transactionHash: transactionHash as `0x${string}`,
  };

  function snapshotClient(input: {
    chainId?: number;
    head?: bigint;
    hash?: `0x${string}`;
  }) {
    return {
      getChainId: async () => input.chainId ?? 1,
      getBlockNumber: async () => input.head ?? 120n,
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({
        number: blockNumber,
        hash: input.hash ?? (`0x${"ab".repeat(32)}` as const),
      }),
    };
  }

  it("requires two distinct configured RPC providers", () => {
    expect(
      resolveDeepProfileRpcUrls("production", {
        ETHEREUM_RPC_URL: "https://rpc-a.example",
        ETHEREUM_RPC_URL_B: "https://rpc-b.example",
      }),
    ).toEqual(["https://rpc-a.example", "https://rpc-b.example"]);
    expect(() =>
      resolveDeepProfileRpcUrls("production", {
        ETHEREUM_RPC_URL: "https://rpc-a.example",
        ETHEREUM_RPC_URL_B: "https://rpc-a.example",
      }),
    ).toThrow("two distinct");
  });

  it("uses one 12-confirmation block only when both providers agree", async () => {
    const agreedHash = `0x${"ab".repeat(32)}` as const;
    await expect(
      resolveDeepProfileSnapshot(
        [
          snapshotClient({ head: 125n, hash: agreedHash }),
          snapshotClient({ head: 120n, hash: agreedHash }),
        ] as never,
        1,
      ),
    ).resolves.toEqual({
      blockNumber: 108n,
      blockHash: agreedHash,
    });

    await expect(
      resolveDeepProfileSnapshot(
        [
          snapshotClient({ hash: agreedHash }),
          snapshotClient({ hash: `0x${"cd".repeat(32)}` }),
        ] as never,
        1,
      ),
    ).rejects.toThrow("disagree");
  });

  it("rejects stale, removed, or provider-divergent launch provenance", () => {
    const identity = {
      ...candidate,
      blockHash: `0x${"ab".repeat(32)}` as const,
      removed: false,
    };
    expect(
      validateCanonicalDeepLaunchIdentities(candidate, 112n, [
        identity,
        identity,
      ]),
    ).toEqual(identity);
    expect(() =>
      validateCanonicalDeepLaunchIdentities(candidate, 99n, [
        identity,
        identity,
      ]),
    ).toThrow("newer");
    expect(() =>
      validateCanonicalDeepLaunchIdentities(candidate, 112n, [
        identity,
        { ...identity, removed: true },
      ]),
    ).toThrow("disagree");
    expect(() =>
      validateCanonicalDeepLaunchIdentities(candidate, 112n, [
        { ...identity, removed: true },
        { ...identity, removed: true },
      ]),
    ).toThrow("stale or noncanonical");
  });

  it("bounds candidate hydration and the fallback scan range", () => {
    const candidates = Array.from({ length: 70 }, (_, index) => ({
      ...candidate,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}` as const,
      vaultAddress:
        `0x${(index + 101).toString(16).padStart(40, "0")}` as const,
      blockNumber: 100n + BigInt(index),
      transactionHash:
        `0x${(index + 1).toString(16).padStart(64, "0")}` as const,
    }));
    expect(
      paginateDeepCandidates(validateDeepCandidates(candidates)),
    ).toHaveLength(3);
    expect(
      paginateDeepCandidates(validateDeepCandidates(candidates)).map(
        (page) => page.length,
      ),
    ).toEqual([32, 32, 6]);
    expect(() =>
      validateDeepCandidates(
        Array.from({ length: 257 }, (_, index) => ({
          ...candidate,
          tokenAddress:
            `0x${(index + 1).toString(16).padStart(40, "0")}` as const,
          vaultAddress:
            `0x${(index + 1001).toString(16).padStart(40, "0")}` as const,
          transactionHash:
            `0x${(index + 1).toString(16).padStart(64, "0")}` as const,
        })),
      ),
    ).toThrow("bounded read limit");
    expect(deepFallbackScanStart(100n, 200n)).toBe(100n);
    expect(() => deepFallbackScanStart(1n, 100_001n)).toThrow(
      "durable Deep launch catalog",
    );
    expect(deepConfirmedTailScanStart(100n, 120n)).toBe(101n);
    expect(deepConfirmedTailScanStart(120n, 120n)).toBe(121n);
    expect(() => deepConfirmedTailScanStart(121n, 120n)).toThrow(
      "ahead of the snapshot",
    );
    expect(() => deepConfirmedTailScanStart(1n, 100_002n)).toThrow(
      "too far behind",
    );
  });

  it("keeps only complete, confirmed Deep records from the durable model", () => {
    const tokens: LauncherToken[] = [
      {
        id: "1:deep",
        name: "Deep",
        symbol: "DEEP",
        tokenAddress: token,
        hookAddress: other,
        poolId: poolId as `0x${string}`,
        launchedAt: new Date(0).toISOString(),
        totalSwapFeeBps: 100,
        launchModel: "deep" as const,
        growthVaultAddress: vault,
        launchBlockNumber: "100",
        launchTransactionHash: transactionHash as `0x${string}`,
        liquidityPath: "meme" as const,
      },
      {
        id: "1:future",
        name: "Future",
        symbol: "FUT",
        tokenAddress: other,
        hookAddress: other,
        poolId: poolId as `0x${string}`,
        launchedAt: new Date(0).toISOString(),
        totalSwapFeeBps: 100,
        launchModel: "deep" as const,
        growthVaultAddress: payout,
        launchBlockNumber: "121",
        launchTransactionHash: `0x${"aa".repeat(32)}`,
        liquidityPath: "meme" as const,
      },
    ];
    expect(deepCandidatesFromDurableTokens(tokens, 120n)).toEqual([candidate]);
    expect(() =>
      deepCandidatesFromDurableTokens(
        [{ ...tokens[0], growthVaultAddress: undefined }],
        120n,
      ),
    ).toThrow("incomplete provenance");
  });

  it("authorizes only the exact connected beneficiary and canonical vault", () => {
    expect(
      authorizeDeepRewardVault(account, vault, candidate, [6000, 6000]),
    ).toEqual(candidate);
    expect(() =>
      authorizeDeepRewardVault(account, vault, candidate, [6000, 5000]),
    ).toThrow("disagree");
    expect(() =>
      authorizeDeepRewardVault(account, vault, candidate, [0, 0]),
    ).toThrow("does not own");
    expect(() =>
      authorizeDeepRewardVault(account, vault, undefined, [6000, 6000]),
    ).toThrow("not a canonical");
  });
});
