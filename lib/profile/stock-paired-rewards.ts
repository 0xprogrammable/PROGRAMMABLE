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
  type PreparedTradeTransaction,
  type PreparedTransaction,
} from "../prepared-transaction";
import { amountOutMinimum } from "../trade/classic";
import {
  buildStockPairedPermit2ApprovalTransaction,
  buildStockPairedQuoteAssetToEthSwapTransaction,
  buildStockPairedTokenApprovalTransaction,
  type StockPairedTradeDeployment,
} from "../trade/stock-paired";
import {
  getStockPairedEthRouteRuntimeCodeHashes,
} from "../trade/stock-paired-route";

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
  estimatedEthRaw?: string;
  estimatedEth?: string;
  estimatedUsdRaw?: string;
  estimatedUsd?: string;
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

function optionalEstimate(reward: Record<string, unknown>) {
  const fields = [
    reward.estimatedEthRaw,
    reward.estimatedEth,
    reward.estimatedUsdRaw,
    reward.estimatedUsd,
  ];
  if (fields.every((value) => value === undefined)) return {};
  if (fields.some((value) => value === undefined)) {
    throw new Error("Invalid Stock-Paired reward estimate");
  }
  const estimatedEthRaw = uintString(
    reward.estimatedEthRaw,
    "estimated ETH",
  );
  const estimatedUsdRaw = uintString(
    reward.estimatedUsdRaw,
    "estimated USD",
  );
  if (
    BigInt(estimatedEthRaw) <= 0n ||
    BigInt(estimatedUsdRaw) <= 0n ||
    reward.estimatedEth !== formatUnits(BigInt(estimatedEthRaw), 18) ||
    reward.estimatedUsd !== formatUnits(BigInt(estimatedUsdRaw), 6)
  ) {
    throw new Error("Invalid Stock-Paired reward estimate");
  }
  return {
    estimatedEthRaw,
    estimatedEth: reward.estimatedEth as string,
    estimatedUsdRaw,
    estimatedUsd: reward.estimatedUsd as string,
  };
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
    const estimate = optionalEstimate(reward);
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
      ...estimate,
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

export type PreparedStockPairedRewardConversion = {
  status: "ready" | "approval-required";
  approvalState:
    | "token-to-permit2"
    | "permit2-to-router"
    | "ready";
  quote: {
    amountIn: string;
    amountOut: string;
    usdAmountOut: string;
    amountOutMinimum: string;
    gasEstimate: string;
    slippageBps: 100;
    deadline: string;
  };
  transaction: PreparedTradeTransaction;
};

function stockPairedTradeDeployment(
  reward: StockPairedReward,
): StockPairedTradeDeployment {
  const release = getConfiguredStockPairedRelease();
  if (!release) {
    throw new Error(
      "Stock-Paired conversion is not enabled by a verified release",
    );
  }
  const dependencies = release.officialDependencies;
  return {
    chainId: 1,
    poolManager: dependencies.poolManager.address,
    poolManagerRuntimeCodeHash:
      dependencies.poolManager.runtimeCodeHash,
    v4Quoter: dependencies.v4Quoter.address,
    v4QuoterRuntimeCodeHash: dependencies.v4Quoter.runtimeCodeHash,
    universalRouter: dependencies.universalRouter.address,
    universalRouterRuntimeCodeHash:
      dependencies.universalRouter.runtimeCodeHash,
    permit2: dependencies.permit2.address,
    permit2RuntimeCodeHash: dependencies.permit2.runtimeCodeHash,
    hook: release.addresses.feeHook,
    hookRuntimeCodeHash: release.runtimeCodeHashes.feeHook,
    quoteRegistry: release.addresses.quoteRegistry,
    quoteRegistryRuntimeCodeHash:
      release.runtimeCodeHashes.quoteRegistry,
    quoteAsset: reward.quoteAsset,
    quoteAssetRuntimeCodeHash:
      release.issuerRuntime.tokenRuntimeCodeHash,
    ethRouteRuntimeCodeHashes:
      getStockPairedEthRouteRuntimeCodeHashes(reward.quoteAsset),
    token: reward.tokenAddress,
    poolId: reward.poolId,
    release,
  };
}

function canonicalTradeEnvelope(transaction: {
  kind: "swap" | "token-to-permit2" | "permit2-to-router";
  chainId: number;
  to: Address;
  data: Hex;
  value: string;
}) {
  if (transaction.chainId !== 1) {
    throw new Error("The canonical conversion has the wrong chain");
  }
  return {
    kind: transaction.kind,
    chainId: 1,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  } as const;
}

export async function prepareStockPairedRewardConversion(input: {
  account: string;
  reward: StockPairedReward;
  claimTransactionHash: Hex;
  amountIn: string;
  deadline: string;
  chainId: number;
  fetcher?: FetchLike;
}): Promise<PreparedStockPairedRewardConversion> {
  if (
    input.chainId !== 1 ||
    !isAddress(input.account) ||
    !isHex(input.claimTransactionHash, { strict: true }) ||
    input.claimTransactionHash.length !== 66 ||
    !/^[1-9]\d{0,77}$/.test(input.amountIn) ||
    !/^[1-9]\d{0,77}$/.test(input.deadline)
  ) {
    throw new Error("Invalid Stock-Paired reward conversion");
  }
  const account = getAddress(input.account);
  if (
    input.reward.beneficiary.toLowerCase() !== account.toLowerCase() ||
    input.reward.payoutAddress.toLowerCase() !== account.toLowerCase()
  ) {
    throw new Error(
      "Claim as ETH requires this wallet to receive the stock reward",
    );
  }
  const amountIn = BigInt(input.amountIn);
  const deadline = BigInt(input.deadline);
  const fetcher = input.fetcher ?? fetch;
  const response = await fetcher("/api/profile/stock-paired", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      action: "convert-to-eth",
      account,
      vaultAddress: input.reward.vaultAddress,
      claimTransactionHash: input.claimTransactionHash,
      amountIn: input.amountIn,
      slippageBps: 100,
      deadline: input.deadline,
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
        : "The stock reward could not be converted";
    throw new Error(message);
  }
  const prepared = record(body, "prepared Stock-Paired conversion");
  const claimedAmount = BigInt(
    uintString(prepared.claimedAmount, "claimed amount"),
  );
  if (
    prepared.action !== "convert-to-eth" ||
    prepared.launchModel !== "stock-paired" ||
    prepared.conversion !== "quote-asset-to-eth" ||
    prepared.chainId !== 1 ||
    (prepared.status !== "ready" &&
      prepared.status !== "approval-required") ||
    address(prepared.owner, "conversion owner").toLowerCase() !==
      account.toLowerCase() ||
    address(prepared.token, "conversion token").toLowerCase() !==
      input.reward.tokenAddress.toLowerCase() ||
    address(prepared.quoteAsset, "conversion quote asset").toLowerCase() !==
      input.reward.quoteAsset.toLowerCase() ||
    address(prepared.inputAsset, "conversion input asset").toLowerCase() !==
      input.reward.quoteAsset.toLowerCase() ||
    address(prepared.vaultAddress, "conversion vault").toLowerCase() !==
      input.reward.vaultAddress.toLowerCase() ||
    bytes32(prepared.poolId, "conversion pool").toLowerCase() !==
      input.reward.poolId.toLowerCase() ||
    bytes32(
      prepared.claimTransactionHash,
      "claim transaction",
    ).toLowerCase() !== input.claimTransactionHash.toLowerCase() ||
    claimedAmount < amountIn
  ) {
    throw new Error("Invalid prepared Stock-Paired conversion");
  }
  const quoteRecord = record(prepared.quote, "conversion quote");
  const quote = {
    amountIn: uintString(quoteRecord.amountIn, "conversion input"),
    amountOut: uintString(quoteRecord.amountOut, "conversion output"),
    usdAmountOut: uintString(
      quoteRecord.usdAmountOut,
      "conversion USD output",
    ),
    amountOutMinimum: uintString(
      quoteRecord.amountOutMinimum,
      "conversion minimum output",
    ),
    gasEstimate: uintString(
      quoteRecord.gasEstimate,
      "conversion gas estimate",
    ),
    slippageBps: quoteRecord.slippageBps,
    deadline: uintString(
      quoteRecord.deadline,
      "conversion deadline",
    ),
  };
  if (
    quote.amountIn !== claimedAmount.toString() ||
    BigInt(quote.amountOut) <= 0n ||
    BigInt(quote.usdAmountOut) <= 0n ||
    BigInt(quote.gasEstimate) <= 0n ||
    quote.slippageBps !== 100 ||
    quote.deadline !== input.deadline ||
    quote.amountOutMinimum !==
      amountOutMinimum(BigInt(quote.amountOut), 100).toString()
  ) {
    throw new Error("The Stock-Paired conversion quote is invalid");
  }
  const transaction = parsePreparedTransaction(prepared.transaction);
  if (
    transaction.kind !== "token-to-permit2" &&
    transaction.kind !== "permit2-to-router" &&
    transaction.kind !== "swap"
  ) {
    throw new Error("The conversion API returned a non-trade transaction");
  }
  const approvalState = prepared.approvalState;
  if (
    (prepared.status === "approval-required" &&
      approvalState !== transaction.kind) ||
    (prepared.status === "ready" &&
      (transaction.kind !== "swap" || approvalState !== "ready"))
  ) {
    throw new Error("The conversion approval state is inconsistent");
  }

  const deployment = stockPairedTradeDeployment(input.reward);
  const referenceNow = deadline - 1_200n;
  if (referenceNow < 0n) {
    throw new Error("The conversion deadline is invalid");
  }
  const expected =
    transaction.kind === "token-to-permit2"
      ? canonicalTradeEnvelope(
          buildStockPairedTokenApprovalTransaction({
            deployment,
            inputAsset: input.reward.quoteAsset,
            amountIn: claimedAmount,
          }),
        )
      : transaction.kind === "permit2-to-router"
        ? canonicalTradeEnvelope(
            buildStockPairedPermit2ApprovalTransaction({
            deployment,
            inputAsset: input.reward.quoteAsset,
            amountIn: claimedAmount,
              now: referenceNow,
              deadline,
            }),
          )
        : canonicalTradeEnvelope(
            buildStockPairedQuoteAssetToEthSwapTransaction({
              deployment,
              amountIn: claimedAmount,
              quotedAmountOut: BigInt(quote.amountOut),
              slippageBps: 100,
              now: referenceNow,
              deadline,
            }),
          );
  if (
    transaction.kind !== expected.kind ||
    transaction.chainId !== expected.chainId ||
    transaction.to.toLowerCase() !== expected.to.toLowerCase() ||
    transaction.data.toLowerCase() !== expected.data.toLowerCase() ||
    transaction.value !== expected.value ||
    (transaction.kind === "swap" && transaction.gasLimit === undefined) ||
    (transaction.kind !== "swap" && transaction.gasLimit !== undefined)
  ) {
    throw new Error(
      "The conversion API did not return the canonical transaction",
    );
  }
  return {
    status: prepared.status,
    approvalState: approvalState as
      | "token-to-permit2"
      | "permit2-to-router"
      | "ready",
    quote: {
      ...quote,
      slippageBps: 100,
    },
    transaction,
  };
}
