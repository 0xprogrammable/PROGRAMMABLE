import {
  decodeFunctionData,
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import appDeployments from "../../contracts/config/app-deployments.v1.json";
import {
  deepGrowthVaultReadAbi,
  DEEP_COMPLETION_TOLERANCE_WEI,
  DEEP_MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI,
} from "../deep-v1";
import {
  isHistoricalDeepV1ManifestEligible,
  isFutureLaunchModelManifestEligible,
  type LaunchModelReleaseManifest,
} from "../launch-model-gating";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "../prepared-transaction";

export type DeepBeneficiary = {
  beneficiary: Address;
  payoutAddress: Address;
  shareBps: number;
};

export type DeepReward = {
  model: "deep";
  deepReleaseVersion: "deep-full-range-v1" | "deep-full-range-v2";
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  imageUrl?: string;
  poolId: Hex;
  vaultAddress: Address;
  oracleGuardAddress: Address;
  upstreamRewardVaultAddress: Address;
  beneficiary: Address;
  payoutAddress: Address;
  shareBps: number;
  claimableWei: string;
  claimableEth: string;
  claimedWei: string;
  claimedEth: string;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  platformFeeBps: 10;
  beneficiaries: readonly DeepBeneficiary[];
  growthTargetWei: string;
  growthTargetEth: string;
  completionToleranceWei: string;
  minimumNativeLiquidityForCompletionWei: string;
  nativeAllocatedToGrowthWei: string;
  nativeAllocatedToGrowthEth: string;
  nativeAddedToLiquidityWei: string;
  nativeAddedToLiquidityEth: string;
  pendingGrowthNativeWei: string;
  pendingGrowthNativeEth: string;
  deferredRewardFeesWei: string;
  deferredRewardFeesEth: string;
  tokenReserveRaw: string;
  growthTargetReached: boolean;
  oracleReady: boolean;
  automationAction: 0 | 1 | 2 | 3;
  nextCompoundTimestamp: string;
  trustedNativeDepthWei: string;
  depthCapNativeWei: string;
  automationGuaranteed: false;
  launchTransactionHash: Hex;
};

export type DeepProfileRewards =
  | {
      status: "not-deployed" | "loading" | "error";
      account?: Address;
      chainId?: number;
      rewards: readonly [];
      errorMessage?: string;
    }
  | {
      status: "ready";
      account: Address;
      chainId: 1 | 11_155_111;
      rewards: readonly DeepReward[];
    };

export const EMPTY_DEEP_PROFILE: DeepProfileRewards = {
  status: "not-deployed",
  rewards: [],
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

function configuredEnvironment() {
  return process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK === "rehearsal"
    ? ("rehearsal" as const)
    : ("production" as const);
}

export function isConfiguredDeepReleaseReady(expectedChainId?: number) {
  const environment = configuredEnvironment();
  const chainId = environment === "rehearsal" ? 11_155_111 : 1;
  return (
    (expectedChainId === undefined || expectedChainId === chainId) &&
    (isHistoricalDeepV1ManifestEligible(
      "deep",
      appDeployments[environment] as unknown as LaunchModelReleaseManifest,
      chainId,
    ) ||
      isFutureLaunchModelManifestEligible(
        "deep",
        appDeployments[environment] as unknown as LaunchModelReleaseManifest,
        chainId,
      ))
  );
}

function assertDeepReleaseAvailable(expectedChainId?: number) {
  if (!isConfiguredDeepReleaseReady(expectedChainId)) {
    throw new Error("Deep rewards are not enabled by the verified release");
  }
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function address(value: unknown, label: string) {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return getAddress(value);
}

function bytes32(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !isHex(value, { strict: true }) ||
    value.length !== 66
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value as Hex;
}

function uintString(value: unknown, label: string) {
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function bps(value: unknown, label: string, allowZero = false) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > 10_000
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new Error(`Invalid ${label}`);
  return value;
}

function tokenText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function optionalHttpsUrl(value: unknown, label: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`Invalid ${label}`);
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function exactEth(record: Record<string, unknown>, key: string, wei: string) {
  const value = record[key];
  if (value !== formatUnits(BigInt(wei), 18)) {
    throw new Error(`Invalid ${key}`);
  }
  return value;
}

export function parseDeepProfileRewards(
  value: unknown,
  requestedAccount: string,
): DeepProfileRewards {
  if (!isAddress(requestedAccount)) {
    throw new Error("Connect a valid Ethereum wallet");
  }
  const account = getAddress(requestedAccount);
  const record = asRecord(value, "Deep profile response");
  if (record.status === "not-deployed") {
    return { status: "not-deployed", account, rewards: [] };
  }
  if (record.status !== "ready") {
    throw new Error("Deep rewards are temporarily unavailable");
  }
  const responseAccount = address(record.account, "profile account");
  if (responseAccount.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Deep profile does not match the connected wallet");
  }
  if (record.chainId !== 1 && record.chainId !== 11_155_111) {
    throw new Error("Invalid Deep profile network");
  }
  if (!Array.isArray(record.rewards)) {
    throw new Error("Invalid Deep rewards");
  }

  const rewards = record.rewards.map((entry, rewardIndex) => {
    const reward = asRecord(entry, `Deep reward ${rewardIndex + 1}`);
    const deepReleaseVersion = reward.deepReleaseVersion;
    if (
      deepReleaseVersion !== "deep-full-range-v1" &&
      deepReleaseVersion !== "deep-full-range-v2"
    ) {
      throw new Error("Invalid Deep reward release version");
    }
    const beneficiary = address(reward.beneficiary, "reward beneficiary");
    if (beneficiary.toLowerCase() !== account.toLowerCase()) {
      throw new Error("Deep reward belongs to another beneficiary");
    }
    if (!Array.isArray(reward.beneficiaries)) {
      throw new Error("Invalid immutable reward split");
    }
    const beneficiaries = reward.beneficiaries.map((entry, index) => {
      const item = asRecord(entry, `reward recipient ${index + 1}`);
      return {
        beneficiary: address(item.beneficiary, "immutable beneficiary"),
        payoutAddress: address(item.payoutAddress, "payout address"),
        shareBps: bps(item.shareBps, "reward share"),
      };
    });
    const unique = new Set(
      beneficiaries.map((item) => item.beneficiary.toLowerCase()),
    );
    const validBeneficiaryCount =
      deepReleaseVersion === "deep-full-range-v2"
        ? beneficiaries.length === 1
        : beneficiaries.length >= 1 && beneficiaries.length <= 8;
    if (
      !validBeneficiaryCount ||
      unique.size !== beneficiaries.length ||
      beneficiaries.reduce((sum, item) => sum + item.shareBps, 0) !== 10_000
    ) {
      throw new Error("Invalid immutable reward split");
    }
    const shareBps = bps(reward.shareBps, "beneficiary share");
    const ownEntry = beneficiaries.find(
      (item) => item.beneficiary.toLowerCase() === account.toLowerCase(),
    );
    if (!ownEntry || ownEntry.shareBps !== shareBps) {
      throw new Error("Deep beneficiary share does not match");
    }

    const claimableWei = uintString(reward.claimableWei, "claimable rewards");
    const claimedWei = uintString(reward.claimedWei, "claimed rewards");
    const growthTargetWei = uintString(
      reward.growthTargetWei,
      "growth target",
    );
    const nativeAllocatedToGrowthWei = uintString(
      reward.nativeAllocatedToGrowthWei,
      "growth allocation",
    );
    const nativeAddedToLiquidityWei = uintString(
      reward.nativeAddedToLiquidityWei,
      "liquidity growth",
    );
    const pendingGrowthNativeWei = uintString(
      reward.pendingGrowthNativeWei,
      "pending growth",
    );
    const completionToleranceWei = uintString(
      reward.completionToleranceWei,
      "completion tolerance",
    );
    const minimumNativeLiquidityForCompletionWei = uintString(
      reward.minimumNativeLiquidityForCompletionWei,
      "minimum liquidity for completion",
    );
    const deferredRewardFeesWei = uintString(
      reward.deferredRewardFeesWei,
      "deferred rewards",
    );
    if (
      BigInt(completionToleranceWei) !==
        DEEP_COMPLETION_TOLERANCE_WEI ||
      BigInt(minimumNativeLiquidityForCompletionWei) !==
        DEEP_MINIMUM_NATIVE_LIQUIDITY_FOR_COMPLETION_WEI ||
      BigInt(minimumNativeLiquidityForCompletionWei) +
          BigInt(completionToleranceWei) !==
        BigInt(growthTargetWei)
    ) {
      throw new Error("Invalid Deep completion policy");
    }
    const automationAction = reward.automationAction;
    if (
      typeof automationAction !== "number" ||
      !Number.isInteger(automationAction) ||
      automationAction < 0 ||
      automationAction >
        (deepReleaseVersion === "deep-full-range-v2" ? 2 : 3)
    ) {
      throw new Error("Invalid Deep automation action");
    }
    if (
      reward.automationGuaranteed !== false ||
      reward.model !== "deep"
    ) {
      throw new Error("Invalid Deep model disclosure");
    }

    return {
      model: "deep",
      deepReleaseVersion,
      tokenAddress: address(reward.tokenAddress, "reward token"),
      tokenName: tokenText(reward.tokenName, "reward token name"),
      tokenSymbol: tokenText(reward.tokenSymbol, "reward token symbol"),
      ...(optionalHttpsUrl(reward.imageUrl, "reward token image")
        ? { imageUrl: reward.imageUrl as string }
        : {}),
      poolId: bytes32(reward.poolId, "reward pool"),
      vaultAddress: address(reward.vaultAddress, "growth vault"),
      oracleGuardAddress: address(reward.oracleGuardAddress, "oracle guard"),
      upstreamRewardVaultAddress: address(
        reward.upstreamRewardVaultAddress,
        "upstream reward vault",
      ),
      beneficiary,
      payoutAddress: address(reward.payoutAddress, "reward payout address"),
      shareBps,
      claimableWei,
      claimableEth: exactEth(reward, "claimableEth", claimableWei),
      claimedWei,
      claimedEth: exactEth(reward, "claimedEth", claimedWei),
      buySwapFeeBps: bps(reward.buySwapFeeBps, "buy fee"),
      sellSwapFeeBps: bps(reward.sellSwapFeeBps, "sell fee"),
      platformFeeBps:
        bps(reward.platformFeeBps, "platform fee") === 10
          ? 10
          : (() => {
              throw new Error("Invalid platform fee");
            })(),
      beneficiaries,
      growthTargetWei,
      growthTargetEth: exactEth(reward, "growthTargetEth", growthTargetWei),
      completionToleranceWei,
      minimumNativeLiquidityForCompletionWei,
      nativeAllocatedToGrowthWei,
      nativeAllocatedToGrowthEth: exactEth(
        reward,
        "nativeAllocatedToGrowthEth",
        nativeAllocatedToGrowthWei,
      ),
      nativeAddedToLiquidityWei,
      nativeAddedToLiquidityEth: exactEth(
        reward,
        "nativeAddedToLiquidityEth",
        nativeAddedToLiquidityWei,
      ),
      pendingGrowthNativeWei,
      pendingGrowthNativeEth: exactEth(
        reward,
        "pendingGrowthNativeEth",
        pendingGrowthNativeWei,
      ),
      deferredRewardFeesWei,
      deferredRewardFeesEth: exactEth(
        reward,
        "deferredRewardFeesEth",
        deferredRewardFeesWei,
      ),
      tokenReserveRaw: uintString(reward.tokenReserveRaw, "locked reserve"),
      growthTargetReached: boolean(
        reward.growthTargetReached,
        "growth status",
      ),
      oracleReady: boolean(reward.oracleReady, "oracle status"),
      automationAction: automationAction as 0 | 1 | 2 | 3,
      nextCompoundTimestamp: uintString(
        reward.nextCompoundTimestamp,
        "next compound timestamp",
      ),
      trustedNativeDepthWei: uintString(
        reward.trustedNativeDepthWei,
        "trusted native depth",
      ),
      depthCapNativeWei: uintString(
        reward.depthCapNativeWei,
        "depth cap",
      ),
      automationGuaranteed: false,
      launchTransactionHash: bytes32(
        reward.launchTransactionHash,
        "launch transaction",
      ),
    } satisfies DeepReward;
  });

  return {
    status: "ready",
    account,
    chainId: record.chainId,
    rewards,
  };
}

export async function fetchDeepProfileRewards(
  account: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
) {
  assertDeepReleaseAvailable();
  const response = await fetcher(
    `/api/profile/deep?account=${encodeURIComponent(account)}`,
    {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error("Deep rewards could not be loaded");
  }
  return parseDeepProfileRewards(body, account);
}

type DeepAction = "claim" | "update-payout";

export type PreparedDeepRewardAction = {
  action: DeepAction;
  deepReleaseVersion: "deep-full-range-v1" | "deep-full-range-v2";
  account: Address;
  vaultAddress: Address;
  transaction: Extract<
    PreparedTransaction,
    { kind: "claim-deep-rewards" | "update-deep-payout" }
  >;
};

export function validatePreparedDeepRewardAction(
  value: unknown,
  expected: {
    action: DeepAction;
    deepReleaseVersion: "deep-full-range-v1" | "deep-full-range-v2";
    account: string;
    vaultAddress: string;
    newPayoutAddress?: string;
    chainId: number;
  },
): PreparedDeepRewardAction {
  const response = asRecord(value, "Deep reward action");
  if (
    response.status !== "ready" ||
    response.action !== expected.action ||
    response.deepReleaseVersion !== expected.deepReleaseVersion
  ) {
    throw new Error("Deep reward action is not ready");
  }
  const account = address(response.account, "reward action account");
  const vaultAddress = address(response.vaultAddress, "reward action vault");
  if (
    !isAddress(expected.account) ||
    account.toLowerCase() !== getAddress(expected.account).toLowerCase() ||
    !isAddress(expected.vaultAddress) ||
    vaultAddress.toLowerCase() !==
      getAddress(expected.vaultAddress).toLowerCase()
  ) {
    throw new Error("Deep reward action does not match the selection");
  }
  const transaction = parsePreparedTransaction(response.transaction);
  const expectedKind =
    expected.action === "claim"
      ? "claim-deep-rewards"
      : "update-deep-payout";
  if (
    transaction.kind !== expectedKind ||
    transaction.chainId !== expected.chainId ||
    transaction.from.toLowerCase() !== account.toLowerCase() ||
    transaction.to.toLowerCase() !== vaultAddress.toLowerCase() ||
    transaction.value !== "0"
  ) {
    throw new Error("Deep reward transaction is not canonical");
  }
  const decoded = decodeFunctionData({
    abi: deepGrowthVaultReadAbi,
    data: transaction.data,
  });
  if (expected.action === "claim") {
    if (decoded.functionName !== "claimRewards") {
      throw new Error("Deep reward transaction is not a claim");
    }
  } else if (
    decoded.functionName !== "setPayoutAddress" ||
    !expected.newPayoutAddress ||
    !isAddress(expected.newPayoutAddress) ||
    decoded.args[0].toLowerCase() !==
      getAddress(expected.newPayoutAddress).toLowerCase()
  ) {
    throw new Error("Deep payout update does not match the new address");
  }
  return {
    action: expected.action,
    deepReleaseVersion: expected.deepReleaseVersion,
    account,
    vaultAddress,
    transaction,
  };
}

export async function prepareDeepRewardAction(
  input: {
    action: DeepAction;
    deepReleaseVersion: "deep-full-range-v1" | "deep-full-range-v2";
    account: string;
    vaultAddress: string;
    newPayoutAddress?: string;
    chainId: number;
  },
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
) {
  assertDeepReleaseAvailable(input.chainId);
  const response = await fetcher("/api/profile/deep", {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: input.action,
      deepReleaseVersion: input.deepReleaseVersion,
      account: input.account,
      vaultAddress: input.vaultAddress,
      ...(input.action === "update-payout"
        ? { newPayoutAddress: input.newPayoutAddress }
        : {}),
      chainId: input.chainId,
    }),
    signal,
  });
  const body = await response.json();
  if (!response.ok) {
    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    throw new Error(
      typeof record.error === "string"
        ? record.error
        : "Deep reward action could not be prepared",
    );
  }
  return validatePreparedDeepRewardAction(body, input);
}

export function encodeDeepRewardAction(input: {
  action: DeepAction;
  newPayoutAddress?: Address;
}) {
  return input.action === "claim"
    ? encodeFunctionData({
        abi: deepGrowthVaultReadAbi,
        functionName: "claimRewards",
      })
    : encodeFunctionData({
        abi: deepGrowthVaultReadAbi,
        functionName: "setPayoutAddress",
        args: [input.newPayoutAddress as Address],
      });
}
