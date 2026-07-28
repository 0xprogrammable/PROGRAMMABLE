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

import { feeSplitVaultAbi } from "../classic-v3";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "../prepared-transaction";

export type ClassicV3Beneficiary = {
  beneficiary: Address;
  payoutAddress: Address;
  shareBps: number;
};

export type ClassicV3Reward = {
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  poolId: Hex;
  vaultAddress: Address;
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
  beneficiaries: readonly ClassicV3Beneficiary[];
  launchTransactionHash: Hex;
};

export type ClassicV3ProfileRewards =
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
      rewards: readonly ClassicV3Reward[];
    };

export const EMPTY_CLASSIC_V3_PROFILE: ClassicV3ProfileRewards = {
  status: "not-deployed",
  rewards: [],
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

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

export function parseClassicV3ProfileRewards(
  value: unknown,
  requestedAccount: string,
): ClassicV3ProfileRewards {
  if (!isAddress(requestedAccount)) {
    throw new Error("Connect a valid Ethereum wallet");
  }
  const account = getAddress(requestedAccount);
  const record = asRecord(value, "Classic V3 profile response");
  if (record.status === "not-deployed") {
    return { status: "not-deployed", account, rewards: [] };
  }
  if (record.status !== "ready") {
    throw new Error("Classic V3 rewards are temporarily unavailable");
  }
  const responseAccount = address(record.account, "profile account");
  if (responseAccount.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Classic V3 profile does not match the connected wallet");
  }
  if (record.chainId !== 1 && record.chainId !== 11_155_111) {
    throw new Error("Invalid Classic V3 profile network");
  }
  if (!Array.isArray(record.rewards)) {
    throw new Error("Invalid Classic V3 rewards");
  }

  const rewards = record.rewards.map((entry, rewardIndex) => {
    const reward = asRecord(entry, `Classic V3 reward ${rewardIndex + 1}`);
    const beneficiary = address(reward.beneficiary, "reward beneficiary");
    if (beneficiary.toLowerCase() !== account.toLowerCase()) {
      throw new Error("Classic V3 reward belongs to another beneficiary");
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
    if (
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
      throw new Error("Classic V3 beneficiary share does not match");
    }
    const claimableWei = uintString(reward.claimableWei, "claimable rewards");
    const claimedWei = uintString(reward.claimedWei, "claimed rewards");
    if (
      reward.claimableEth !== formatUnits(BigInt(claimableWei), 18) ||
      reward.claimedEth !== formatUnits(BigInt(claimedWei), 18)
    ) {
      throw new Error("Classic V3 reward ETH values do not match");
    }
    return {
      tokenAddress: address(reward.tokenAddress, "reward token"),
      tokenName:
        typeof reward.tokenName === "string" && reward.tokenName.trim()
          ? reward.tokenName
          : (() => {
              throw new Error("Invalid reward token name");
            })(),
      tokenSymbol:
        typeof reward.tokenSymbol === "string" && reward.tokenSymbol.trim()
          ? reward.tokenSymbol
          : (() => {
              throw new Error("Invalid reward token symbol");
            })(),
      poolId: bytes32(reward.poolId, "reward pool"),
      vaultAddress: address(reward.vaultAddress, "reward vault"),
      beneficiary,
      payoutAddress: address(reward.payoutAddress, "reward payout address"),
      shareBps,
      claimableWei,
      claimableEth: reward.claimableEth as string,
      claimedWei,
      claimedEth: reward.claimedEth as string,
      buySwapFeeBps: bps(reward.buySwapFeeBps, "buy fee"),
      sellSwapFeeBps: bps(reward.sellSwapFeeBps, "sell fee"),
      platformFeeBps:
        bps(reward.platformFeeBps, "platform fee") === 10
          ? 10
          : (() => {
              throw new Error("Invalid platform fee");
            })(),
      beneficiaries,
      launchTransactionHash: bytes32(
        reward.launchTransactionHash,
        "launch transaction",
      ),
    } satisfies ClassicV3Reward;
  });

  return {
    status: "ready",
    account,
    chainId: record.chainId,
    rewards,
  };
}

export async function fetchClassicV3ProfileRewards(
  account: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher(
    `/api/profile/classic-v3?account=${encodeURIComponent(account)}`,
    {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const body = await response.json();
  if (!response.ok) {
    throw new Error("Classic V3 rewards could not be loaded");
  }
  return parseClassicV3ProfileRewards(body, account);
}

type ClassicV3Action = "claim" | "update-payout";

export type PreparedClassicV3RewardAction = {
  action: ClassicV3Action;
  account: Address;
  vaultAddress: Address;
  transaction: Extract<
    PreparedTransaction,
    { kind: "claim-classic-v3-rewards" | "update-classic-v3-payout" }
  >;
};

export function validatePreparedClassicV3RewardAction(
  value: unknown,
  expected: {
    action: ClassicV3Action;
    account: string;
    vaultAddress: string;
    newPayoutAddress?: string;
    chainId: number;
  },
): PreparedClassicV3RewardAction {
  const response = asRecord(value, "Classic V3 reward action");
  if (response.status !== "ready" || response.action !== expected.action) {
    throw new Error("Classic V3 reward action is not ready");
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
    throw new Error("Classic V3 reward action does not match the selection");
  }
  const transaction = parsePreparedTransaction(response.transaction);
  const expectedKind =
    expected.action === "claim"
      ? "claim-classic-v3-rewards"
      : "update-classic-v3-payout";
  if (
    transaction.kind !== expectedKind ||
    transaction.chainId !== expected.chainId ||
    transaction.from.toLowerCase() !== account.toLowerCase() ||
    transaction.to.toLowerCase() !== vaultAddress.toLowerCase() ||
    transaction.value !== "0"
  ) {
    throw new Error("Classic V3 reward transaction is not canonical");
  }
  const decoded = decodeFunctionData({
    abi: feeSplitVaultAbi,
    data: transaction.data,
  });
  if (expected.action === "claim") {
    if (decoded.functionName !== "claim") {
      throw new Error("Classic V3 reward transaction is not a claim");
    }
  } else {
    if (
      decoded.functionName !== "setPayoutAddress" ||
      !expected.newPayoutAddress ||
      !isAddress(expected.newPayoutAddress) ||
      decoded.args[0].toLowerCase() !==
        getAddress(expected.newPayoutAddress).toLowerCase()
    ) {
      throw new Error("Classic V3 payout update does not match the new address");
    }
  }
  return { action: expected.action, account, vaultAddress, transaction };
}

export async function prepareClassicV3RewardAction(
  input: {
    action: ClassicV3Action;
    account: string;
    vaultAddress: string;
    newPayoutAddress?: string;
    chainId: number;
  },
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
) {
  const response = await fetcher("/api/profile/classic-v3", {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      action: input.action,
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
        : "Classic V3 reward action could not be prepared",
    );
  }
  return validatePreparedClassicV3RewardAction(body, input);
}

export function encodeClassicV3RewardAction(input: {
  action: ClassicV3Action;
  newPayoutAddress?: Address;
}) {
  return input.action === "claim"
    ? encodeFunctionData({
        abi: feeSplitVaultAbi,
        functionName: "claim",
      })
    : encodeFunctionData({
        abi: feeSplitVaultAbi,
        functionName: "setPayoutAddress",
        args: [input.newPayoutAddress as Address],
      });
}
