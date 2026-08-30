import { Actions, URVersion, V4Planner } from "@uniswap/v4-sdk";
import {
  CommandType,
  RoutePlanner,
  UniversalRouterVersion,
} from "@uniswap/universal-router-sdk";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

import { computeOfficialV4PoolId } from "../uniswap/liquidity-launcher-sdk";
import {
  type PreparedTradeTransaction,
  parsePreparedTransaction,
} from "../prepared-transaction";
import type {
  DiscoverableMarketTradeCapabilityV1,
  DiscoverableMarketTradeDependencyRoleV1,
  DiscoverableMarketTradeSideBindingV1,
  DiscoverableMarketTradeSideV1,
} from "./contract-v2";

export const CUSTOM_TRADE_REQUEST_SCHEMA_V1 =
  "programmable.custom-market-trade-prepare-request.v1" as const;
export const CUSTOM_TRADE_RESPONSE_SCHEMA_V1 =
  "programmable.custom-market-trade-preparation.v1" as const;
export const CUSTOM_TRADE_ROUTER_GENERATION_V1 =
  "universal-router:v2.2" as const;

const UINT128_MAX = (1n << 128n) - 1n;
const UINT48_MAX = (1n << 48n) - 1n;
const BPS_DENOMINATOR = 10_000n;
const PERMIT2_SAFETY_SECONDS = 600n;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

export const customTradeQuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
export const customTradeStateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);
export const customTradeRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);
export const customTradeTokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
export const customTradePermit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);

export type CustomMarketTradeRequestV1 = Readonly<{
  schemaVersion: typeof CUSTOM_TRADE_REQUEST_SCHEMA_V1;
  projectId: `sha256:${string}`;
  marketId: string;
  tradeCapabilityBindingHash: `sha256:${string}`;
  chainId: 1 | 11_155_111;
  owner: Address;
  recipient: Address;
  side: DiscoverableMarketTradeSideV1;
  amountIn: string;
  slippageBps: number;
  deadline: string;
}>;

export type CustomMarketTradePreparationV1 = Readonly<{
  schemaVersion: typeof CUSTOM_TRADE_RESPONSE_SCHEMA_V1;
  status: "ready" | "approval-required";
  projectId: `sha256:${string}`;
  marketId: string;
  tradeCapabilityBindingHash: `sha256:${string}`;
  chainId: 1 | 11_155_111;
  owner: Address;
  recipient: Address;
  side: DiscoverableMarketTradeSideV1;
  inputAssetId: string;
  outputAssetId: string;
  inputCurrencyKind: "native" | "erc20";
  approvalState?: "erc20-to-permit2" | "permit2-to-router" | "ready";
  quote: Readonly<{
    amountIn: string;
    amountOut: string;
    amountOutMinimum: string;
    gasEstimate: string;
    slippageBps: number;
    deadline: string;
    observedAtBlock: string;
    observedAtTimestamp: string;
    validUntil: string;
    stateView: Readonly<{
      sqrtPriceX96: string;
      tick: string;
      liquidity: string;
    }>;
  }>;
  transaction: PreparedTradeTransaction;
}>;

export class CustomMarketTradeInputErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomMarketTradeInputErrorV1";
  }
}

export class CustomMarketTradeUnavailableErrorV1 extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomMarketTradeUnavailableErrorV1";
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CustomMarketTradeInputErrorV1("Send a valid Custom trade request");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label = "Custom trade request",
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) {
    throw new CustomMarketTradeInputErrorV1(`The ${label} shape is invalid`);
  }
}

function requestAddress(value: unknown, label: string): Address {
  if (typeof value !== "string" || !ADDRESS.test(value.toLowerCase())) {
    throw new CustomMarketTradeInputErrorV1(`${label} must be an Ethereum address`);
  }
  return getAddress(value);
}

function positiveBaseUnit(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,77}$/u.test(value)) {
    throw new CustomMarketTradeInputErrorV1(`${label} must be a positive base-unit integer`);
  }
  const parsed = BigInt(value);
  if (parsed > UINT128_MAX) {
    throw new CustomMarketTradeInputErrorV1(`${label} exceeds the supported uint128 limit`);
  }
  return parsed;
}

export function parseCustomMarketTradeRequestV1(
  value: unknown,
): CustomMarketTradeRequestV1 {
  const input = record(value);
  exactKeys(input, [
    "amountIn", "chainId", "deadline", "marketId", "owner", "projectId",
    "recipient", "schemaVersion", "side", "slippageBps",
    "tradeCapabilityBindingHash",
  ]);
  const owner = requestAddress(input.owner, "Owner");
  const recipient = requestAddress(input.recipient, "Recipient");
  if (owner.toLowerCase() !== recipient.toLowerCase()) {
    throw new CustomMarketTradeInputErrorV1(
      "The Custom trade recipient must be the connected wallet",
    );
  }
  if (input.schemaVersion !== CUSTOM_TRADE_REQUEST_SCHEMA_V1
    || (input.chainId !== 1 && input.chainId !== 11_155_111)
    || typeof input.projectId !== "string" || !DIGEST.test(input.projectId)
    || typeof input.marketId !== "string" || !SAFE_ID.test(input.marketId)
    || typeof input.tradeCapabilityBindingHash !== "string"
    || !DIGEST.test(input.tradeCapabilityBindingHash)
    || (input.side !== "base-to-quote" && input.side !== "quote-to-base")
    || !Number.isSafeInteger(input.slippageBps) || Number(input.slippageBps) < 1
    || Number(input.slippageBps) > 5_000) {
    throw new CustomMarketTradeInputErrorV1("The Custom trade request is invalid");
  }
  const amountIn = positiveBaseUnit(input.amountIn, "Input amount");
  const deadline = positiveBaseUnit(input.deadline, "Deadline");
  return Object.freeze({
    schemaVersion: CUSTOM_TRADE_REQUEST_SCHEMA_V1,
    projectId: input.projectId as `sha256:${string}`,
    marketId: input.marketId,
    tradeCapabilityBindingHash:
      input.tradeCapabilityBindingHash as `sha256:${string}`,
    chainId: input.chainId,
    owner,
    recipient,
    side: input.side,
    amountIn: amountIn.toString(),
    slippageBps: Number(input.slippageBps),
    deadline: deadline.toString(),
  });
}

export function customTradeDependencyV1(
  capability: DiscoverableMarketTradeCapabilityV1,
  role: DiscoverableMarketTradeDependencyRoleV1,
) {
  const dependency = capability.dependencies.find((candidate) => candidate.role === role);
  if (dependency === undefined) {
    throw new CustomMarketTradeUnavailableErrorV1(
      `The verified Custom route is missing ${role}`,
    );
  }
  return dependency;
}

export function customTradeSideBindingV1(
  capability: DiscoverableMarketTradeCapabilityV1,
  side: DiscoverableMarketTradeSideV1,
): DiscoverableMarketTradeSideBindingV1 {
  const binding = capability.sideBindings.find((candidate) => candidate.side === side);
  if (!capability.supportedSides.includes(side) || binding === undefined) {
    throw new CustomMarketTradeInputErrorV1("This Custom market does not support that side");
  }
  return binding;
}

export function customTradePoolKeyV1(
  capability: DiscoverableMarketTradeCapabilityV1,
) {
  if (capability.routerGeneration !== CUSTOM_TRADE_ROUTER_GENERATION_V1) {
    throw new CustomMarketTradeUnavailableErrorV1(
      "This verified Universal Router generation is not supported by the website",
    );
  }
  const poolKey = {
    currency0: getAddress(capability.poolKey.currency0.value),
    currency1: getAddress(capability.poolKey.currency1.value),
    fee: Number(capability.poolKey.feeRaw),
    tickSpacing: Number(capability.poolKey.tickSpacing),
    hooks: getAddress(capability.poolKey.hooks.value),
  };
  if (!Number.isSafeInteger(poolKey.fee) || poolKey.fee < 0 || poolKey.fee > 0xffffff
    || !Number.isSafeInteger(poolKey.tickSpacing)
    || poolKey.tickSpacing < -0x800000 || poolKey.tickSpacing > 0x7fffff
    || computeOfficialV4PoolId(poolKey).toLowerCase()
      !== capability.poolKey.poolId.toLowerCase()) {
    throw new CustomMarketTradeUnavailableErrorV1(
      "The verified Custom PoolKey is invalid",
    );
  }
  return poolKey;
}

export function customAmountOutMinimumV1(amountOut: bigint, slippageBps: number) {
  if (amountOut <= 0n || amountOut > UINT128_MAX
    || !Number.isSafeInteger(slippageBps) || slippageBps < 1 || slippageBps > 5_000) {
    throw new CustomMarketTradeInputErrorV1("The Custom quote minimum is invalid");
  }
  const minimum = amountOut * (BPS_DENOMINATOR - BigInt(slippageBps))
    / BPS_DENOMINATOR;
  if (minimum <= 0n || minimum > UINT128_MAX) {
    throw new CustomMarketTradeInputErrorV1("The Custom quote minimum rounds to zero");
  }
  return minimum;
}

export function buildCustomMarketSwapTransactionV1(input: Readonly<{
  capability: DiscoverableMarketTradeCapabilityV1;
  side: DiscoverableMarketTradeSideV1;
  amountIn: bigint;
  quotedAmountOut: bigint;
  slippageBps: number;
  deadline: bigint;
}>): PreparedTradeTransaction {
  const binding = customTradeSideBindingV1(input.capability, input.side);
  const poolKey = customTradePoolKeyV1(input.capability);
  const minimum = customAmountOutMinimumV1(input.quotedAmountOut, input.slippageBps);
  const inputCurrency = binding.zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = binding.zeroForOne ? poolKey.currency1 : poolKey.currency0;
  const planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{
    poolKey,
    zeroForOne: binding.zeroForOne,
    amountIn: input.amountIn.toString(),
    amountOutMinimum: minimum.toString(),
    hookData: input.capability.hookDataPolicy.data,
  }], URVersion.V2_0);
  planner.addAction(Actions.SETTLE_ALL, [inputCurrency, input.amountIn.toString()], URVersion.V2_0);
  planner.addAction(Actions.TAKE_ALL, [outputCurrency, minimum.toString()], URVersion.V2_0);
  const route = new RoutePlanner();
  route.addCommand(
    CommandType.V4_SWAP,
    [planner.finalize()],
    false,
    UniversalRouterVersion.V2_0,
  );
  const router = customTradeDependencyV1(
    input.capability,
    "uniswap-v4-universal-router",
  );
  return {
    kind: "swap",
    chainId: Number(input.capability.chainId) as 1 | 11_155_111,
    to: getAddress(router.identity.value),
    data: encodeFunctionData({
      abi: customTradeRouterAbi,
      functionName: "execute",
      args: [route.commands as Hex, route.inputs as Hex[], input.deadline],
    }),
    value: binding.inputCurrencyKind === "native" ? input.amountIn.toString() : "0",
    gasLimit: "1",
  };
}

export function buildCustomTokenApprovalTransactionV1(input: Readonly<{
  capability: DiscoverableMarketTradeCapabilityV1;
  token: Address;
  amountIn: bigint;
}>): PreparedTradeTransaction {
  const permit2 = customTradeDependencyV1(input.capability, "uniswap-permit2");
  return {
    kind: "token-to-permit2",
    chainId: Number(input.capability.chainId) as 1 | 11_155_111,
    to: getAddress(input.token),
    data: encodeFunctionData({
      abi: customTradeTokenAbi,
      functionName: "approve",
      args: [getAddress(permit2.identity.value), input.amountIn],
    }),
    value: "0",
  };
}

export function buildCustomPermit2ApprovalTransactionV1(input: Readonly<{
  capability: DiscoverableMarketTradeCapabilityV1;
  token: Address;
  amountIn: bigint;
  now: bigint;
  deadline: bigint;
}>): PreparedTradeTransaction {
  const permit2 = customTradeDependencyV1(input.capability, "uniswap-permit2");
  const router = customTradeDependencyV1(
    input.capability,
    "uniswap-v4-universal-router",
  );
  const expiration = input.deadline > input.now + PERMIT2_SAFETY_SECONDS
    ? input.deadline
    : input.now + PERMIT2_SAFETY_SECONDS + 1n;
  if (expiration > UINT48_MAX || input.amountIn > (1n << 160n) - 1n) {
    throw new CustomMarketTradeInputErrorV1("The Permit2 approval exceeds its supported limit");
  }
  return {
    kind: "permit2-to-router",
    chainId: Number(input.capability.chainId) as 1 | 11_155_111,
    to: getAddress(permit2.identity.value),
    data: encodeFunctionData({
      abi: customTradePermit2Abi,
      functionName: "approve",
      args: [input.token, getAddress(router.identity.value), input.amountIn, Number(expiration)],
    }),
    value: "0",
  };
}

export function decodeCustomQuoteV1(data: Hex) {
  const [amountOut, gasEstimate] = decodeFunctionResult({
    abi: customTradeQuoterAbi,
    functionName: "quoteExactInputSingle",
    data,
  });
  if (amountOut <= 0n || amountOut > UINT128_MAX || gasEstimate <= 0n) {
    throw new CustomMarketTradeUnavailableErrorV1("The V4Quoter returned an invalid quote");
  }
  return { amountOut, gasEstimate };
}

export function assertCustomTradeDeadlineV1(
  now: bigint,
  deadline: bigint,
  capability: DiscoverableMarketTradeCapabilityV1,
) {
  if (deadline <= now
    || deadline > now + BigInt(capability.deadlinePolicy.maximumHorizonSeconds)) {
    throw new CustomMarketTradeInputErrorV1(
      "The Custom trade deadline is outside the verified capability bound",
    );
  }
}

export function validateCustomMarketTradePreparationV1(input: Readonly<{
  value: unknown;
  request: CustomMarketTradeRequestV1;
  capability: DiscoverableMarketTradeCapabilityV1;
  nowSeconds: number;
}>): CustomMarketTradePreparationV1 {
  const value = record(input.value);
  exactKeys(value, [
    "chainId", "inputAssetId", "inputCurrencyKind", "marketId", "outputAssetId",
    "owner", "projectId", "quote", "recipient", "schemaVersion", "side", "status",
    "tradeCapabilityBindingHash", "transaction",
    ...(Object.hasOwn(value, "approvalState") ? ["approvalState"] : []),
  ], "Custom trade preparation");
  const transaction = parsePreparedTransaction(value.transaction);
  const binding = customTradeSideBindingV1(input.capability, input.request.side);
  if (value.schemaVersion !== CUSTOM_TRADE_RESPONSE_SCHEMA_V1
    || value.projectId !== input.request.projectId
    || value.marketId !== input.request.marketId
    || value.tradeCapabilityBindingHash !== input.request.tradeCapabilityBindingHash
    || value.chainId !== input.request.chainId
    || typeof value.owner !== "string"
    || value.owner.toLowerCase() !== input.request.owner.toLowerCase()
    || typeof value.recipient !== "string"
    || value.recipient.toLowerCase() !== input.request.recipient.toLowerCase()
    || value.side !== input.request.side
    || value.inputAssetId !== binding.inputAssetId
    || value.outputAssetId !== binding.outputAssetId
    || value.inputCurrencyKind !== binding.inputCurrencyKind
    || (value.status !== "ready" && value.status !== "approval-required")
    || typeof value.quote !== "object" || value.quote === null
    || Array.isArray(value.quote)) {
    throw new Error("The Custom trade preparation does not match the verified capability");
  }
  const quote = value.quote as Record<string, unknown>;
  exactKeys(quote, [
    "amountIn", "amountOut", "amountOutMinimum", "deadline", "gasEstimate",
    "observedAtBlock", "observedAtTimestamp", "slippageBps", "stateView",
    "validUntil",
  ], "Custom trade quote");
  const stateView = record(quote.stateView);
  exactKeys(stateView, ["liquidity", "sqrtPriceX96", "tick"], "Custom trade state view");
  if (quote.amountIn !== input.request.amountIn
    || quote.slippageBps !== input.request.slippageBps
    || quote.deadline !== input.request.deadline
    || typeof quote.amountOut !== "string" || !/^[1-9][0-9]{0,77}$/u.test(quote.amountOut)
    || typeof quote.amountOutMinimum !== "string"
    || quote.amountOutMinimum !== customAmountOutMinimumV1(
      BigInt(quote.amountOut),
      input.request.slippageBps,
    ).toString()
    || typeof quote.gasEstimate !== "string" || !/^[1-9][0-9]*$/u.test(quote.gasEstimate)
    || typeof quote.observedAtBlock !== "string" || !DECIMAL.test(quote.observedAtBlock)
    || typeof quote.observedAtTimestamp !== "string"
    || !DECIMAL.test(quote.observedAtTimestamp)
    || typeof stateView.sqrtPriceX96 !== "string"
    || !/^[1-9][0-9]*$/u.test(stateView.sqrtPriceX96)
    || typeof stateView.tick !== "string" || !/^-?(?:0|[1-9][0-9]*)$/u.test(stateView.tick)
    || typeof stateView.liquidity !== "string" || !/^[1-9][0-9]*$/u.test(stateView.liquidity)
    || typeof quote.validUntil !== "string"
    || !DECIMAL.test(quote.validUntil)
    || BigInt(quote.validUntil) < BigInt(input.nowSeconds)
    || BigInt(quote.validUntil) > BigInt(input.nowSeconds)
      + BigInt(input.capability.quotePolicy.maximumQuoteAgeSeconds)
    || BigInt(quote.observedAtTimestamp) > BigInt(input.nowSeconds)
    || BigInt(quote.validUntil) < BigInt(quote.observedAtTimestamp)) {
    throw new Error("The Custom trade quote is invalid or stale");
  }
  const amountIn = BigInt(input.request.amountIn);
  const expectedInputCurrency = binding.zeroForOne
    ? input.capability.poolKey.currency0.value
    : input.capability.poolKey.currency1.value;
  let expectedTransaction: PreparedTradeTransaction;
  if (value.approvalState === "erc20-to-permit2") {
    if (binding.inputCurrencyKind !== "erc20" || value.status !== "approval-required") {
      throw new Error("The Custom trade approval state is invalid");
    }
    expectedTransaction = buildCustomTokenApprovalTransactionV1({
      capability: input.capability,
      token: getAddress(expectedInputCurrency),
      amountIn,
    });
  } else if (value.approvalState === "permit2-to-router") {
    if (binding.inputCurrencyKind !== "erc20" || value.status !== "approval-required") {
      throw new Error("The Custom trade approval state is invalid");
    }
    expectedTransaction = buildCustomPermit2ApprovalTransactionV1({
      capability: input.capability,
      token: getAddress(expectedInputCurrency),
      amountIn,
      now: BigInt(String(quote.observedAtTimestamp)),
      deadline: BigInt(input.request.deadline),
    });
  } else if (value.approvalState === "ready" || value.approvalState === undefined) {
    if (value.status !== "ready") throw new Error("The Custom trade status is invalid");
    expectedTransaction = buildCustomMarketSwapTransactionV1({
      capability: input.capability,
      side: input.request.side,
      amountIn,
      quotedAmountOut: BigInt(quote.amountOut),
      slippageBps: input.request.slippageBps,
      deadline: BigInt(input.request.deadline),
    });
  } else {
    throw new Error("The Custom trade approval state is invalid");
  }
  if (transaction.kind !== expectedTransaction.kind
    || transaction.chainId !== expectedTransaction.chainId
    || transaction.to.toLowerCase() !== expectedTransaction.to.toLowerCase()
    || transaction.data.toLowerCase() !== expectedTransaction.data.toLowerCase()
    || transaction.value !== expectedTransaction.value
    || (transaction.kind === "swap" && (!transaction.gasLimit
      || BigInt(transaction.gasLimit) <= 0n))) {
    throw new Error("The Custom trade transaction is not canonical");
  }
  return input.value as CustomMarketTradePreparationV1;
}
