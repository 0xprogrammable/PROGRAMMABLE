import {
  encodeFunctionData,
  formatUnits,
  getAddress,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import {
  stockFeeSplitVaultAbi,
} from "../stock-paired";
import {
  getConfiguredStockPairedRelease,
} from "../stock-paired-release";
import {
  parsePreparedTransaction,
  type PreparedTransaction,
} from "../prepared-transaction";

export type StockPairedBeneficiary = {
  beneficiary: Address;
  payoutAddress: Address;
  shareBps: number;
};

export type StockPairedReward = {
  model: "stock-paired";
  tokenAddress: Address;
  tokenName: string;
  tokenSymbol: string;
  imageUrl?: string;
  poolId: Hex;
  vaultAddress: Address;
  quoteAsset: Address;
  quoteAssetSymbol: string;
  beneficiary: Address;
  payoutAddress: Address;
  shareBps: number;
  claimableRaw: string;
  claimable: string;
  claimedRaw: string;
  claimed: string;
  generatedRaw: string;
  generated: string;
  creatorFeesPendingRaw: string;
  beneficiaries: readonly StockPairedBeneficiary[];
  buySwapFeeBps: 100;
  sellSwapFeeBps: 100;
  programmableFeeBps: 10;
  launchTransactionHash: Hex;
};

export type StockPairedProfileRewards =
  | {
      status: "not-deployed" | "loading" | "error";
      account?: Address;
      chainId?: 1;
      rewards: readonly [];
      errorMessage?: string;
    }
  | {
      status: "ready";
      account: Address;
      chainId: 1;
      snapshotBlock: string;
      rewards: readonly StockPairedReward[];
    };

export const EMPTY_STOCK_PAIRED_PROFILE: StockPairedProfileRewards = {
  status: "not-deployed",
  rewards: [],
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

function record(value: unknown, label: string) {
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

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function bps(value: unknown, expected?: number) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 10_000 ||
    (expected !== undefined && value !== expected)
  ) {
    throw new Error("Invalid Stock-Paired reward basis points");
  }
  return value;
}

function optionalImage(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("Invalid Stock-Paired token image");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !url.hostname
  ) {
    throw new Error("Invalid Stock-Paired token image");
  }
  return value;
}

function exactAmount(
  reward: Record<string, unknown>,
  rawKey: string,
  displayKey: string,
) {
  const raw = uintString(reward[rawKey], rawKey);
  if (reward[displayKey] !== formatUnits(BigInt(raw), 18)) {
    throw new Error(`Invalid ${displayKey}`);
  }
  return { raw, display: reward[displayKey] as string };
}

export function isConfiguredStockPairedRewardsReady() {
  return getConfiguredStockPairedRelease() !== null;
}

export function parseStockPairedProfileRewards(
  value: unknown,
  requestedAccount: string,
): StockPairedProfileRewards {
  if (!isAddress(requestedAccount)) {
    throw new Error("Connect a valid Ethereum wallet");
  }
  const account = getAddress(requestedAccount);
  const response = record(value, "Stock-Paired profile response");
  if (response.status === "not-deployed") {
    return { status: "not-deployed", account, chainId: 1, rewards: [] };
  }
  if (
    response.status !== "ready" ||
    response.chainId !== 1 ||
    address(response.account, "profile account").toLowerCase() !==
      account.toLowerCase() ||
    !Array.isArray(response.rewards)
  ) {
    throw new Error("Invalid Stock-Paired profile response");
  }
  const snapshotBlock = uintString(
    response.snapshotBlock,
    "snapshot block",
  );
  const rewards = response.rewards.map((value, index) => {
    const reward = record(value, `Stock-Paired reward ${index + 1}`);
    if (reward.model !== "stock-paired") {
      throw new Error("Invalid Stock-Paired reward model");
    }
    const beneficiary = address(
      reward.beneficiary,
      "reward beneficiary",
    );
    if (beneficiary.toLowerCase() !== account.toLowerCase()) {
      throw new Error("Stock-Paired reward belongs to another wallet");
    }
    if (!Array.isArray(reward.beneficiaries)) {
      throw new Error("Invalid Stock-Paired reward split");
    }
    const beneficiaries = reward.beneficiaries.map((value, splitIndex) => {
      const item = record(
        value,
        `Stock-Paired beneficiary ${splitIndex + 1}`,
      );
      return {
        beneficiary: address(item.beneficiary, "beneficiary"),
        payoutAddress: address(item.payoutAddress, "payout address"),
        shareBps: bps(item.shareBps),
      };
    });
    if (
      beneficiaries.length < 1 ||
      beneficiaries.length > 8 ||
      new Set(
        beneficiaries.map((item) => item.beneficiary.toLowerCase()),
      ).size !== beneficiaries.length ||
      beneficiaries.reduce((sum, item) => sum + item.shareBps, 0) !==
        10_000
    ) {
      throw new Error("Invalid Stock-Paired reward split");
    }
    const shareBps = bps(reward.shareBps);
    if (
      !beneficiaries.some(
        (item) =>
          item.beneficiary.toLowerCase() === account.toLowerCase() &&
          item.shareBps === shareBps,
      )
    ) {
      throw new Error("Stock-Paired beneficiary share does not match");
    }
    const claimable = exactAmount(reward, "claimableRaw", "claimable");
    const claimed = exactAmount(reward, "claimedRaw", "claimed");
    const generated = exactAmount(reward, "generatedRaw", "generated");
    const imageUrl = optionalImage(reward.imageUrl);
    return {
      model: "stock-paired" as const,
      tokenAddress: address(reward.tokenAddress, "reward token"),
      tokenName: text(reward.tokenName, "reward token name"),
      tokenSymbol: text(reward.tokenSymbol, "reward token symbol"),
      ...(imageUrl ? { imageUrl } : {}),
      poolId: bytes32(reward.poolId, "reward pool"),
      vaultAddress: address(reward.vaultAddress, "reward vault"),
      quoteAsset: address(reward.quoteAsset, "quote asset"),
      quoteAssetSymbol: text(
        reward.quoteAssetSymbol,
        "quote asset symbol",
      ),
      beneficiary,
      payoutAddress: address(reward.payoutAddress, "reward payout"),
      shareBps,
      claimableRaw: claimable.raw,
      claimable: claimable.display,
      claimedRaw: claimed.raw,
      claimed: claimed.display,
      generatedRaw: generated.raw,
      generated: generated.display,
      creatorFeesPendingRaw: uintString(
        reward.creatorFeesPendingRaw,
        "pending creator fees",
      ),
      beneficiaries,
      buySwapFeeBps: bps(reward.buySwapFeeBps, 100) as 100,
      sellSwapFeeBps: bps(reward.sellSwapFeeBps, 100) as 100,
      programmableFeeBps: bps(
        reward.programmableFeeBps,
        10,
      ) as 10,
      launchTransactionHash: bytes32(
        reward.launchTransactionHash,
        "launch transaction",
      ),
    };
  });
  return {
    status: "ready",
    account,
    chainId: 1,
    snapshotBlock,
    rewards,
  };
}

export async function fetchStockPairedProfileRewards(
  account: string,
  signal?: AbortSignal,
  fetcher: FetchLike = fetch,
) {
  if (!isConfiguredStockPairedRewardsReady()) {
    return {
      status: "not-deployed",
      account: getAddress(account),
      chainId: 1,
      rewards: [],
    } satisfies StockPairedProfileRewards;
  }
  const response = await fetcher(
    `/api/profile/stock-paired?account=${encodeURIComponent(account)}`,
    {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    },
  );
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "Stock-Paired rewards could not be loaded";
    throw new Error(message);
  }
  return parseStockPairedProfileRewards(body, account);
}

export async function prepareStockPairedRewardAction(input: {
  action: "claim" | "update-payout";
  account: string;
  vaultAddress: string;
  newPayoutAddress?: string;
  chainId: number;
  fetcher?: FetchLike;
}): Promise<{ transaction: PreparedTransaction }> {
  if (
    input.chainId !== 1 ||
    !isAddress(input.account) ||
    !isAddress(input.vaultAddress)
  ) {
    throw new Error("Invalid Stock-Paired reward action");
  }
  const account = getAddress(input.account);
  const vaultAddress = getAddress(input.vaultAddress);
  const newPayoutAddress =
    input.action === "update-payout"
      ? address(input.newPayoutAddress, "new payout address")
      : undefined;
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("/api/profile/stock-paired", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      action: input.action,
      account,
      vaultAddress,
      ...(newPayoutAddress ? { newPayoutAddress } : {}),
      chainId: 1,
    }),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "The Stock-Paired reward action could not be prepared";
    throw new Error(message);
  }
  const prepared = record(body, "prepared Stock-Paired reward");
  if (
    prepared.status !== "ready" ||
    prepared.action !== input.action ||
    address(prepared.account, "prepared account").toLowerCase() !==
      account.toLowerCase() ||
    address(prepared.vaultAddress, "prepared vault").toLowerCase() !==
      vaultAddress.toLowerCase()
  ) {
    throw new Error("Invalid prepared Stock-Paired reward action");
  }
  const transaction = parsePreparedTransaction(prepared.transaction);
  const expectedKind =
    input.action === "claim"
      ? "claim-stock-paired-rewards"
      : "update-stock-paired-payout";
  const expectedData =
    input.action === "claim"
      ? encodeFunctionData({
          abi: stockFeeSplitVaultAbi,
          functionName: "claim",
        })
      : encodeFunctionData({
          abi: stockFeeSplitVaultAbi,
          functionName: "setPayoutAddress",
          args: [newPayoutAddress!],
        });
  if (
    transaction.kind !== expectedKind ||
    transaction.chainId !== 1 ||
    transaction.from.toLowerCase() !== account.toLowerCase() ||
    transaction.to.toLowerCase() !== vaultAddress.toLowerCase() ||
    transaction.data.toLowerCase() !== expectedData.toLowerCase() ||
    transaction.value !== "0"
  ) {
    throw new Error(
      "The Stock-Paired reward transaction is not canonical",
    );
  }
  return { transaction };
}
