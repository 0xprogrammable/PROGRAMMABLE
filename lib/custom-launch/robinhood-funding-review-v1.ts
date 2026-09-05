import { formatEther, getAddress, type Address } from "viem";

import { canonicalBrowserSha256V2 } from "./browser-authority-v2";
import type { CustomLaunchEip1193ProviderV4, CustomLaunchWalletReviewV4 } from "./wallet-handoff-v4";

const UINT256_MAX = (1n << 256n) - 1n;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MODELS = {
  "none-empty-pool": "Empty pool",
  "project-provided-liquidity": "Project supplied liquidity",
  "hook-owned-liquidity": "Hook owned liquidity",
  "externally-managed-position": "Externally managed position",
  "custom-bonding-or-curve": "Custom bonding or pricing curve",
} as const;
const STATES = {
  "pool-not-initialized": "Pool not initialized",
  "pool-initialized-empty": "Pool initialized without liquidity",
  "liquidity-required": "Liquidity still required",
  "liquidity-provided-by-launch": "Liquidity declared in launch",
  "custom-settlement": "Custom settlement",
} as const;

export type RobinhoodFundingReviewV1 = Readonly<{
  binding: `sha256:${string}`;
  account: Address;
  transactionPreimageHash: `sha256:${string}` | null;
  valueWei: string;
  modelLabel: string;
  stateLabel: string;
}>;

/** These fields are declared in the immutable request, not a liquidity proof. */
export function parseRobinhoodFundingReviewV1(value: unknown): RobinhoodFundingReviewV1 | null {
  try {
    const resource = record(value);
    const controller = record(resource.controller);
    const commitments = record(resource.commitments);
    const funding = exactRecord(resource.funding, ["schemaVersion", "mode", "valueWei"]);
    const liquidity = exactRecord(resource.liquidityModel, ["schemaVersion", "model", "declaredLaunchState", "targetIds"]);
    const account = getAddress(String(controller.address));
    const amount = uint(funding.valueWei);
    if (resource.schemaVersion !== "programmable.custom-launch.v4"
      || resource.routeId !== "custom-launch:create:v4" || resource.apiVersion !== "v4"
      || resource.chainId !== "4663" || resource.caip2 !== "eip155:4663"
      || controller.namespace !== "eip155:4663"
      || typeof resource.requestHash !== "string" || !SHA256.test(resource.requestHash)
      || typeof commitments.launchIntent !== "string" || !SHA256.test(commitments.launchIntent)
      || funding.schemaVersion !== "programmable.custom-launch-funding-intent.v2"
      || !["none", "wallet-transaction-value"].includes(String(funding.mode))
      || ((funding.mode === "none") !== (amount === 0n))
      || liquidity.schemaVersion !== "programmable.custom-launch-liquidity-model.v1"
      || typeof liquidity.model !== "string" || !Object.hasOwn(MODELS, liquidity.model)
      || typeof liquidity.declaredLaunchState !== "string" || !Object.hasOwn(STATES, liquidity.declaredLaunchState)
      || !Array.isArray(liquidity.targetIds) || liquidity.targetIds.length > 16
      || liquidity.targetIds.some((id, index, ids) => typeof id !== "string"
        || !/^[a-z][a-z0-9._:-]{0,127}$/u.test(id)
        || (index > 0 && String(ids[index - 1]) >= id))
      || (liquidity.model === "none-empty-pool" && liquidity.targetIds.length !== 0)) return null;
    let transactionPreimageHash: `sha256:${string}` | null = null;
    if (resource.walletTransaction !== null && resource.walletTransaction !== undefined) {
      const transaction = record(resource.walletTransaction);
      const artifact = record(resource.preparedArtifact);
      const permit = record(artifact.permit);
      if (transaction.chainId !== "4663" || getAddress(String(transaction.from)) !== account
        || uint(transaction.valueWei) !== amount || uint(permit.valueWei) !== amount
        || typeof transaction.transactionPreimageHash !== "string"
        || !SHA256.test(transaction.transactionPreimageHash)
        || resource.walletTransactionPreimageHash !== transaction.transactionPreimageHash) return null;
      transactionPreimageHash = transaction.transactionPreimageHash as `sha256:${string}`;
    }
    return Object.freeze({
      binding: canonicalBrowserSha256V2("programmable.robinhood-funding-review.v1", {
        requestHash: resource.requestHash, launchIntent: commitments.launchIntent,
        account, funding, liquidityModel: liquidity, transactionPreimageHash,
      }),
      account, transactionPreimageHash, valueWei: amount.toString(),
      modelLabel: MODELS[liquidity.model as keyof typeof MODELS],
      stateLabel: STATES[liquidity.declaredLaunchState as keyof typeof STATES],
    });
  } catch { return null; }
}

export type RobinhoodLaunchCostV1 = Readonly<{
  kind: "robinhood-launch-cost";
  fundingBinding: `sha256:${string}`;
  transactionPreimageHash: `sha256:${string}`;
  account: Address;
  chainId: "4663";
  observedAt: string;
  valueWei: string;
  estimatedGasUnits: string;
  gasPriceWei: string;
  estimatedNetworkFeeWei: string;
  estimatedTotalWei: string;
  balanceWei: string;
  shortfallWei: string;
}>;

/**
 * Read-only current provider estimate. Never a fee cap or authority to send.
 * Robinhood bundles L2 execution and L1 data fees in eth_estimateGas:
 * https://docs.robinhood.com/chain/gas-and-fees/
 */
export async function estimateRobinhoodLaunchCostV1(input: Readonly<{
  provider: CustomLaunchEip1193ProviderV4;
  review: CustomLaunchWalletReviewV4;
  funding: RobinhoodFundingReviewV1;
  now?: () => Date;
}>): Promise<RobinhoodLaunchCostV1> {
  const { provider, review, funding } = input;
  const transaction = review.walletRequest;
  if (review.chainId !== "4663" || transaction.chainId !== "0x1237"
    || funding.account !== transaction.from || funding.valueWei !== review.valueWei
    || BigInt(transaction.value) !== uint(review.valueWei)
    || funding.transactionPreimageHash !== review.transactionPreimageHash) {
    throw new Error("The Robinhood funding review changed. Load the exact launch review again.");
  }
  try {
    await assertIdentity(provider, transaction.from);
    const [estimatedGas, gasPrice, balance] = await Promise.all([
      rpc(provider, { method: "eth_estimateGas", params: [{ from: transaction.from,
        to: transaction.to, data: transaction.data, value: transaction.value }] }),
      rpc(provider, { method: "eth_gasPrice" }),
      rpc(provider, { method: "eth_getBalance", params: [transaction.from, "pending"] }),
    ]);
    await assertIdentity(provider, transaction.from);
    const gasUnits = quantity(estimatedGas);
    const price = quantity(gasPrice);
    if (gasUnits === 0n || price === 0n) throw new Error("Unavailable gas estimate");
    const nativeBalance = quantity(balance);
    const fee = gasUnits * price;
    const total = uint(review.valueWei) + fee;
    if (total > UINT256_MAX) throw new Error("Estimate exceeds supported amount");
    return Object.freeze({
      kind: "robinhood-launch-cost", fundingBinding: funding.binding,
      transactionPreimageHash: review.transactionPreimageHash,
      account: transaction.from, chainId: "4663",
      observedAt: (input.now?.() ?? new Date()).toISOString(),
      valueWei: review.valueWei, estimatedGasUnits: gasUnits.toString(),
      gasPriceWei: price.toString(), estimatedNetworkFeeWei: fee.toString(),
      estimatedTotalWei: total.toString(), balanceWei: nativeBalance.toString(),
      shortfallWei: (total > nativeBalance ? total - nativeBalance : 0n).toString(),
    });
  } catch {
    throw new Error("Unable to estimate this launch on Robinhood Chain. Check the network, wallet balance and transaction, then estimate again. No transaction was requested.");
  }
}

export function robinhoodCostMatchesReviewV1(cost: RobinhoodLaunchCostV1 | undefined,
  funding: RobinhoodFundingReviewV1 | null, now = Date.now()) {
  if (!cost || !funding) return false;
  const age = now - Date.parse(cost.observedAt);
  return cost.kind === "robinhood-launch-cost" && cost.chainId === "4663"
    && cost.account === funding.account && cost.fundingBinding === funding.binding
    && cost.transactionPreimageHash === funding.transactionPreimageHash
    && cost.valueWei === funding.valueWei && Number.isFinite(age) && age >= 0 && age <= 60_000;
}

export function robinhoodCostRequiresReviewV1(reviewed: RobinhoodLaunchCostV1,
  fresh: RobinhoodLaunchCostV1, funding: RobinhoodFundingReviewV1, now = Date.now()) {
  if (!robinhoodCostMatchesReviewV1(reviewed, funding, now)
    || !robinhoodCostMatchesReviewV1(fresh, funding, now)) return true;
  return uint(fresh.shortfallWei) > 0n
    || uint(fresh.estimatedTotalWei) > uint(reviewed.estimatedTotalWei);
}

export function formatRobinhoodWeiV1(value: string) { return `${formatEther(uint(value))} ETH`; }

async function assertIdentity(provider: CustomLaunchEip1193ProviderV4, account: Address) {
  const [chain, accounts] = await Promise.all([
    rpc(provider, { method: "eth_chainId" }), rpc(provider, { method: "eth_accounts" }),
  ]);
  if (chain !== "0x1237" || !Array.isArray(accounts) || getAddress(String(accounts[0])) !== account) {
    throw new Error("Robinhood wallet changed");
  }
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid object");
  return value as Record<string, unknown>;
}
function exactRecord(value: unknown, keys: readonly string[]) {
  const result = record(value);
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) throw new TypeError("Invalid fields");
  return result;
}
function uint(value: unknown) {
  if (typeof value !== "string" || value.length > 78 || !/^(0|[1-9][0-9]*)$/u.test(value)) throw new TypeError("Invalid amount");
  const parsed = BigInt(value);
  if (parsed > UINT256_MAX) throw new TypeError("Amount too large");
  return parsed;
}
function quantity(value: unknown) {
  if (typeof value !== "string" || value.length > 66 || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u.test(value)) throw new TypeError("Invalid RPC quantity");
  return BigInt(value);
}

async function rpc(provider: CustomLaunchEip1193ProviderV4,
  input: Parameters<CustomLaunchEip1193ProviderV4["request"]>[0]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.request(input),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Robinhood estimate timed out")), 15_000);
      }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
