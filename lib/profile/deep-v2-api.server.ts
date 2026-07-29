import "server-only";

import { formatUnits, getAddress, type Address } from "viem";

import { DEEP_V2_FIXED_POLICY } from "../deep-v2";
import {
  getVerifiedDeepV2Release,
  type LaunchModelReleaseManifest,
} from "../launch-model-gating";
import { sanitizeImageUrl } from "../onchain/metadata";
import type { ExploreReadModel } from "../onchain/types";
import type { LauncherToken } from "../tokens";
import {
  prepareDeepV2RewardAction,
  readDeepV2RewardProfile,
  type DeepV2ProfileClient,
} from "./deep-v2-profile.server";
import { requireDeepV2IndexedCandidate } from "./deep-v2-indexed-candidate";

const COMPLETION_TOLERANCE_NATIVE = 1_000_000_000_000n;
const MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION =
  DEEP_V2_FIXED_POLICY.growthTargetNativeWei -
  COMPLETION_TOLERANCE_NATIVE;

type DeepV2ProfileApiInput = {
  manifest: LaunchModelReleaseManifest;
  chainId: number;
  account: Address;
  model: ExploreReadModel;
  clients: readonly DeepV2ProfileClient[];
};

function assertEligibleManifest(
  manifest: LaunchModelReleaseManifest,
  chainId: number,
) {
  if (!getVerifiedDeepV2Release(manifest, chainId)) {
    throw new Error(
      "Deep V2 profiles require an eligible verified Deep V2 release",
    );
  }
}

function verifiedModel(
  model: ExploreReadModel,
  chainId: number,
): Extract<ExploreReadModel, { status: "ready" }> {
  if (model.status !== "ready" || model.snapshot.chainId !== chainId) {
    throw new Error("The verified Deep V2 launch registry is unavailable");
  }
  return model;
}

export function deepV2IndexedTokensForAccount(
  model: ExploreReadModel,
  chainId: number,
  account: Address,
) {
  const normalized = getAddress(account);
  return verifiedModel(model, chainId).tokens.filter((token) => {
    if (!token.deepV2Provenance) return false;
    const candidate = requireDeepV2IndexedCandidate(token);
    return candidate.creator.toLowerCase() === normalized.toLowerCase();
  });
}

export function requireDeepV2IndexedTokenByVault(
  model: ExploreReadModel,
  chainId: number,
  account: Address,
  vaultAddress: Address,
) {
  const token = deepV2IndexedTokensForAccount(
    model,
    chainId,
    account,
  ).find(
    (candidate) =>
      candidate.deepV2Provenance?.vaultAddress.toLowerCase() ===
      vaultAddress.toLowerCase(),
  );
  if (!token) {
    throw new Error(
      "The selected vault is not an indexed Deep V2 reward for this account",
    );
  }
  return token;
}

function eth(wei: string) {
  return formatUnits(BigInt(wei), 18);
}

function formatReward(
  token: LauncherToken,
  profile: Awaited<ReturnType<typeof readDeepV2RewardProfile>>,
) {
  const reward = profile.reward;
  const imageUrl = sanitizeImageUrl(token.imageUrl);
  return {
    model: "deep" as const,
    deepReleaseVersion: "deep-full-range-v2" as const,
    tokenAddress: reward.tokenAddress,
    tokenName: token.name,
    tokenSymbol: token.symbol,
    ...(imageUrl ? { imageUrl } : {}),
    poolId: reward.poolId,
    vaultAddress: reward.vaultAddress,
    oracleGuardAddress: reward.oracleGuardAddress,
    upstreamRewardVaultAddress: reward.upstreamRewardVaultAddress,
    beneficiary: profile.account,
    payoutAddress: reward.payoutAddress,
    shareBps: 10_000,
    claimableWei: reward.claimableWei,
    claimableEth: eth(reward.claimableWei),
    claimedWei: reward.claimedWei,
    claimedEth: eth(reward.claimedWei),
    buySwapFeeBps: 100,
    sellSwapFeeBps: 100,
    platformFeeBps: 10 as const,
    beneficiaries: [
      {
        beneficiary: profile.account,
        payoutAddress: reward.payoutAddress,
        shareBps: 10_000,
      },
    ],
    growthTargetWei: reward.growthTargetWei,
    growthTargetEth: eth(reward.growthTargetWei),
    completionToleranceWei: COMPLETION_TOLERANCE_NATIVE.toString(),
    minimumNativeLiquidityForCompletionWei:
      MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION.toString(),
    nativeAllocatedToGrowthWei: reward.nativeAllocatedToGrowthWei,
    nativeAllocatedToGrowthEth: eth(
      reward.nativeAllocatedToGrowthWei,
    ),
    nativeAddedToLiquidityWei: reward.nativeAddedToLiquidityWei,
    nativeAddedToLiquidityEth: eth(reward.nativeAddedToLiquidityWei),
    pendingGrowthNativeWei: reward.pendingGrowthNativeWei,
    pendingGrowthNativeEth: eth(reward.pendingGrowthNativeWei),
    deferredRewardFeesWei: reward.deferredRewardFeesWei,
    deferredRewardFeesEth: eth(reward.deferredRewardFeesWei),
    tokenReserveRaw: reward.tokenReserveRaw,
    growthTargetReached: reward.growthTargetReached,
    oracleReady: reward.oracleReady,
    automationAction: reward.automationAction,
    nextCompoundTimestamp: reward.nextCompoundTimestamp,
    trustedNativeDepthWei: reward.trustedNativeDepthWei,
    depthCapNativeWei: reward.depthCapNativeWei,
    automationGuaranteed: false as const,
    launchTransactionHash: reward.launchTransactionHash,
  };
}

export async function readDeepV2ProfileRewards(
  input: DeepV2ProfileApiInput,
) {
  assertEligibleManifest(input.manifest, input.chainId);
  const tokens = deepV2IndexedTokensForAccount(
    input.model,
    input.chainId,
    input.account,
  );
  const rewards = await Promise.all(
    tokens.map(async (token) => {
      const profile = await readDeepV2RewardProfile({
        manifest: input.manifest,
        chainId: input.chainId,
        account: input.account,
        candidate: requireDeepV2IndexedCandidate(token),
        clients: input.clients,
      });
      return formatReward(token, profile);
    }),
  );
  return rewards;
}

export async function prepareIndexedDeepV2RewardAction(
  input: DeepV2ProfileApiInput & {
    vaultAddress: Address;
    action: "claim" | "update-payout";
    newPayoutAddress?: Address;
  },
) {
  assertEligibleManifest(input.manifest, input.chainId);
  const token = requireDeepV2IndexedTokenByVault(
    input.model,
    input.chainId,
    input.account,
    input.vaultAddress,
  );
  return prepareDeepV2RewardAction({
    manifest: input.manifest,
    chainId: input.chainId,
    account: input.account,
    candidate: requireDeepV2IndexedCandidate(token),
    clients: input.clients,
    action: input.action,
    newPayoutAddress: input.newPayoutAddress,
  });
}
