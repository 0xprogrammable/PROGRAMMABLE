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
  MAX_TRADE_SLIPPAGE_BPS,
  TRADE_QUOTE_VALIDITY_SECONDS,
} from "./policy";

export const NATIVE_ETH =
  "0x0000000000000000000000000000000000000000" as Address;
export const CLASSIC_POOL_FEE = 0;
export const CLASSIC_TICK_SPACING = 200;
export const CLASSIC_MIN_DEADLINE_SECONDS = 60n;
export const CLASSIC_MAX_DEADLINE_SECONDS = 3_600n;
export const CLASSIC_DEADLINE_CLOCK_SKEW_SECONDS = 30n;
export const CLASSIC_V4_MAX_DEADLINE_SECONDS =
  BigInt(TRADE_QUOTE_VALIDITY_SECONDS) +
  CLASSIC_DEADLINE_CLOCK_SKEW_SECONDS;
export const CLASSIC_PERMIT2_SAFETY_SECONDS = 300n;
export const CLASSIC_GAS_PRICE_BUFFER_BPS = 12_500n;

const UINT128_MAX = (1n << 128n) - 1n;
const UINT48_MAX = (1n << 48n) - 1n;
const BPS_DENOMINATOR = 10_000n;

export const classicQuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);

export const classicUniversalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);

export const classicTokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

export const classicPermit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);

export type ClassicTradeSide = "buy" | "sell";

export type ClassicTradeDeployment = {
  chainId: number;
  poolManager: Address;
  v4Quoter: Address;
  universalRouter: Address;
  universalRouterVersion: "2.0";
  permit2: Address;
  hook: Address;
};

export type ClassicPoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type PreparedClassicSwapTransaction = {
  kind: "swap";
  side: ClassicTradeSide;
  chainId: number;
  to: Address;
  data: Hex;
  value: string;
  amountIn: string;
  quotedAmountOut: string;
  amountOutMinimum: string;
  slippageBps: number;
  deadline: string;
};

export type PreparedClassicApprovalTransaction = {
  kind: "token-to-permit2" | "permit2-to-router";
  chainId: number;
  to: Address;
  data: Hex;
  value: "0";
};

export type ClassicSellApprovalState =
  | "token-to-permit2"
  | "permit2-to-router"
  | "ready";

export type ClassicQuoteClient = {
  getChainId(): Promise<number>;
  call(args: {
    to: Address;
    data: Hex;
    account?: Address;
  }): Promise<{ data?: Hex }>;
};

export class ClassicTradeInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClassicTradeInputError";
  }
}

function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function checkedAddress(value: string, label: string) {
  try {
    return getAddress(value);
  } catch {
    throw new ClassicTradeInputError(`${label} is not a valid address`);
  }
}

function assertPositiveAmount(
  value: bigint,
  label: string,
  maximum = UINT128_MAX,
) {
  if (value <= 0n) {
    throw new ClassicTradeInputError(`${label} must be greater than zero`);
  }
  if (value > maximum) {
    throw new ClassicTradeInputError(`${label} exceeds the supported limit`);
  }
}

export function assertClassicTradeDeployment(
  deployment: ClassicTradeDeployment,
) {
  if (
    !Number.isSafeInteger(deployment.chainId) ||
    deployment.chainId <= 0
  ) {
    throw new ClassicTradeInputError("The deployment chain is invalid");
  }
  if (deployment.universalRouterVersion !== "2.0") {
    throw new ClassicTradeInputError(
      "The Universal Router calldata version is not supported",
    );
  }

  const addresses = [
    ["PoolManager", deployment.poolManager],
    ["V4Quoter", deployment.v4Quoter],
    ["Universal Router", deployment.universalRouter],
    ["Permit2", deployment.permit2],
    ["Classic hook", deployment.hook],
  ] as const;

  for (const [label, value] of addresses) {
    const address = checkedAddress(value, label);
    if (sameAddress(address, NATIVE_ETH)) {
      throw new ClassicTradeInputError(`${label} cannot be the zero address`);
    }
  }
}

export function createClassicPoolKey(
  tokenInput: string,
  deployment: ClassicTradeDeployment,
): ClassicPoolKey {
  assertClassicTradeDeployment(deployment);
  const token = checkedAddress(tokenInput, "Token");
  if (sameAddress(token, NATIVE_ETH)) {
    throw new ClassicTradeInputError("Token cannot be the native ETH address");
  }
  if (
    [
      deployment.poolManager,
      deployment.v4Quoter,
      deployment.universalRouter,
      deployment.permit2,
      deployment.hook,
    ].some((address) => sameAddress(token, address))
  ) {
    throw new ClassicTradeInputError(
      "Token cannot be a protocol contract address",
    );
  }

  return {
    currency0: NATIVE_ETH,
    currency1: token,
    fee: CLASSIC_POOL_FEE,
    tickSpacing: CLASSIC_TICK_SPACING,
    hooks: getAddress(deployment.hook),
  };
}

export function getClassicPoolId(
  poolKey: ClassicPoolKey,
  deployment: ClassicTradeDeployment,
) {
  assertCanonicalClassicPoolKey(poolKey, deployment);
  return computeOfficialV4PoolId(poolKey);
}

export function assertCanonicalClassicPoolKey(
  poolKey: ClassicPoolKey,
  deployment: ClassicTradeDeployment,
) {
  assertClassicTradeDeployment(deployment);

  const currency0 = checkedAddress(poolKey.currency0, "Pool currency0");
  const currency1 = checkedAddress(poolKey.currency1, "Pool currency1");
  const hooks = checkedAddress(poolKey.hooks, "Pool hook");

  if (!sameAddress(currency0, NATIVE_ETH)) {
    throw new ClassicTradeInputError(
      "The Classic pool currency0 must be native ETH",
    );
  }
  if (sameAddress(currency1, NATIVE_ETH)) {
    throw new ClassicTradeInputError(
      "The Classic pool currency1 must be the launched token",
    );
  }
  if (!sameAddress(hooks, deployment.hook)) {
    throw new ClassicTradeInputError(
      "The pool hook does not match the Classic deployment",
    );
  }
  if (poolKey.fee !== CLASSIC_POOL_FEE) {
    throw new ClassicTradeInputError(
      "The Classic pool fee must be exactly 0",
    );
  }
  if (poolKey.tickSpacing !== CLASSIC_TICK_SPACING) {
    throw new ClassicTradeInputError(
      `The Classic tick spacing must be exactly ${CLASSIC_TICK_SPACING}`,
    );
  }
}

export function amountOutMinimum(
  quotedAmountOut: bigint,
  slippageBps: number,
) {
  assertPositiveAmount(quotedAmountOut, "Quoted output");
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 1 ||
    slippageBps > MAX_TRADE_SLIPPAGE_BPS
  ) {
    throw new ClassicTradeInputError(
      "Slippage must be an integer from 1 to 1000 basis points",
    );
  }

  const minimum =
    (quotedAmountOut *
      (BPS_DENOMINATOR - BigInt(slippageBps))) /
    BPS_DENOMINATOR;
  if (minimum === 0n) {
    throw new ClassicTradeInputError(
      "The minimum output rounds down to zero",
    );
  }
  if (minimum > UINT128_MAX) {
    throw new ClassicTradeInputError(
      "The minimum output exceeds the Universal Router limit",
    );
  }
  return minimum;
}

export function classicGasReserve(input: {
  gasLimit: bigint;
  gasPrice: bigint;
  transactionCount?: number;
}) {
  const { gasLimit, gasPrice, transactionCount = 1 } = input;
  if (gasLimit <= 0n || gasPrice <= 0n) {
    throw new ClassicTradeInputError(
      "The network gas estimate is invalid",
    );
  }
  if (
    !Number.isSafeInteger(transactionCount) ||
    transactionCount < 1 ||
    transactionCount > 2
  ) {
    throw new ClassicTradeInputError(
      "The gas reserve transaction count is invalid",
    );
  }

  const singleTransactionReserve =
    (gasLimit * gasPrice * CLASSIC_GAS_PRICE_BUFFER_BPS +
      BPS_DENOMINATOR -
      1n) /
    BPS_DENOMINATOR;
  return singleTransactionReserve * BigInt(transactionCount);
}

export function maximumClassicBuyAmount(input: {
  nativeBalance: bigint;
  gasLimit: bigint;
  gasPrice: bigint;
}) {
  if (input.nativeBalance < 0n) {
    throw new ClassicTradeInputError(
      "The wallet ETH balance is invalid",
    );
  }
  const reserve = classicGasReserve({
    gasLimit: input.gasLimit,
    gasPrice: input.gasPrice,
    transactionCount: 2,
  });
  return input.nativeBalance > reserve
    ? input.nativeBalance - reserve
    : 0n;
}

export function assertClassicDeadline(
  now: bigint,
  deadline: bigint,
) {
  if (now < 0n) {
    throw new ClassicTradeInputError("The current timestamp is invalid");
  }
  if (deadline < now + CLASSIC_MIN_DEADLINE_SECONDS) {
    throw new ClassicTradeInputError(
      "The deadline must be at least 60 seconds in the future",
    );
  }
  if (deadline > now + CLASSIC_MAX_DEADLINE_SECONDS) {
    throw new ClassicTradeInputError(
      "The deadline must be within 1 hour",
    );
  }
}

export function assertClassicV4Deadline(
  now: bigint,
  deadline: bigint,
) {
  assertClassicDeadline(now, deadline);
  if (deadline > now + CLASSIC_V4_MAX_DEADLINE_SECONDS) {
    throw new ClassicTradeInputError(
      "The deadline must be within the 5 minute quote window",
    );
  }
}

export function buildClassicSwapTransaction(input: {
  deployment: ClassicTradeDeployment;
  poolKey: ClassicPoolKey;
  side: ClassicTradeSide;
  amountIn: bigint;
  quotedAmountOut: bigint;
  slippageBps: number;
  now: bigint;
  deadline: bigint;
}): PreparedClassicSwapTransaction {
  const {
    deployment,
    poolKey,
    side,
    amountIn,
    quotedAmountOut,
    slippageBps,
    now,
    deadline,
  } = input;
  assertCanonicalClassicPoolKey(poolKey, deployment);
  assertPositiveAmount(amountIn, "Input amount");
  assertClassicDeadline(now, deadline);
  if (side !== "buy" && side !== "sell") {
    throw new ClassicTradeInputError("Trade side must be buy or sell");
  }

  const minimum = amountOutMinimum(quotedAmountOut, slippageBps);
  const zeroForOne = side === "buy";
  const inputCurrency = zeroForOne
    ? poolKey.currency0
    : poolKey.currency1;
  const outputCurrency = zeroForOne
    ? poolKey.currency1
    : poolKey.currency0;

  const planner = new V4Planner();
  planner.addAction(
    Actions.SWAP_EXACT_IN_SINGLE,
    [
      {
        poolKey,
        zeroForOne,
        amountIn: amountIn.toString(),
        amountOutMinimum: minimum.toString(),
        hookData: "0x",
      },
    ],
    URVersion.V2_0,
  );
  planner.addAction(
    Actions.SETTLE_ALL,
    [inputCurrency, amountIn.toString()],
    URVersion.V2_0,
  );
  planner.addAction(
    Actions.TAKE_ALL,
    [outputCurrency, minimum.toString()],
    URVersion.V2_0,
  );

  const route = new RoutePlanner();
  route.addCommand(
    CommandType.V4_SWAP,
    [planner.finalize()],
    false,
    UniversalRouterVersion.V2_0,
  );

  return {
    kind: "swap",
    side,
    chainId: deployment.chainId,
    to: getAddress(deployment.universalRouter),
    data: encodeFunctionData({
      abi: classicUniversalRouterAbi,
      functionName: "execute",
      args: [route.commands as Hex, route.inputs as Hex[], deadline],
    }),
    value: zeroForOne ? amountIn.toString() : "0",
    amountIn: amountIn.toString(),
    quotedAmountOut: quotedAmountOut.toString(),
    amountOutMinimum: minimum.toString(),
    slippageBps,
    deadline: deadline.toString(),
  };
}

export async function quoteClassicExactInput(
  client: ClassicQuoteClient,
  input: {
    deployment: ClassicTradeDeployment;
    poolKey: ClassicPoolKey;
    owner: Address;
    side: ClassicTradeSide;
    amountIn: bigint;
  },
) {
  const { deployment, poolKey, side, amountIn } = input;
  assertCanonicalClassicPoolKey(poolKey, deployment);
  assertPositiveAmount(amountIn, "Input amount");
  if (side !== "buy" && side !== "sell") {
    throw new ClassicTradeInputError("Trade side must be buy or sell");
  }
  const owner = checkedAddress(input.owner, "Wallet");

  const actualChainId = await client.getChainId();
  if (actualChainId !== deployment.chainId) {
    throw new ClassicTradeInputError(
      `RPC chain ${actualChainId} does not match deployment chain ${deployment.chainId}`,
    );
  }

  const data = encodeFunctionData({
    abi: classicQuoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey,
        zeroForOne: side === "buy",
        exactAmount: amountIn,
        hookData: "0x",
      },
    ],
  });
  const result = await client.call({
    to: getAddress(deployment.v4Quoter),
    data,
    account: owner,
  });
  if (!result.data || result.data === "0x") {
    throw new Error("The V4Quoter returned no quote data");
  }

  const [amountOut, gasEstimate] = decodeFunctionResult({
    abi: classicQuoterAbi,
    functionName: "quoteExactInputSingle",
    data: result.data,
  });
  assertPositiveAmount(amountOut, "Quoted output");

  return { amountOut, gasEstimate };
}

export function getClassicSellApprovalState(input: {
  amountIn: bigint;
  tokenAllowance: bigint;
  permit2Allowance: bigint;
  permit2Expiration: bigint;
  now: bigint;
}): ClassicSellApprovalState {
  const {
    amountIn,
    tokenAllowance,
    permit2Allowance,
    permit2Expiration,
    now,
  } = input;
  assertPositiveAmount(amountIn, "Input amount");
  if (
    tokenAllowance < 0n ||
    permit2Allowance < 0n ||
    permit2Expiration < 0n ||
    now < 0n
  ) {
    throw new ClassicTradeInputError("Approval state is invalid");
  }

  if (tokenAllowance < amountIn) return "token-to-permit2";
  if (
    permit2Allowance < amountIn ||
    permit2Expiration <= now + CLASSIC_PERMIT2_SAFETY_SECONDS
  ) {
    return "permit2-to-router";
  }
  return "ready";
}

export function buildClassicTokenApprovalTransaction(input: {
  deployment: ClassicTradeDeployment;
  token: Address;
  amountIn: bigint;
}): PreparedClassicApprovalTransaction {
  assertClassicTradeDeployment(input.deployment);
  assertPositiveAmount(input.amountIn, "Approval amount");
  const token = createClassicPoolKey(
    input.token,
    input.deployment,
  ).currency1;

  return {
    kind: "token-to-permit2",
    chainId: input.deployment.chainId,
    to: token,
    data: encodeFunctionData({
      abi: classicTokenAbi,
      functionName: "approve",
      args: [getAddress(input.deployment.permit2), input.amountIn],
    }),
    value: "0",
  };
}

export function buildClassicPermit2ApprovalTransaction(input: {
  deployment: ClassicTradeDeployment;
  token: Address;
  amountIn: bigint;
  now: bigint;
  deadline: bigint;
}): PreparedClassicApprovalTransaction {
  assertClassicTradeDeployment(input.deployment);
  assertPositiveAmount(input.amountIn, "Approval amount");
  const token = createClassicPoolKey(
    input.token,
    input.deployment,
  ).currency1;
  assertClassicDeadline(input.now, input.deadline);
  const expiration = input.deadline + CLASSIC_PERMIT2_SAFETY_SECONDS;
  if (expiration > UINT48_MAX) {
    throw new ClassicTradeInputError(
      "The Permit2 expiration exceeds the supported limit",
    );
  }

  return {
    kind: "permit2-to-router",
    chainId: input.deployment.chainId,
    to: getAddress(input.deployment.permit2),
    data: encodeFunctionData({
      abi: classicPermit2Abi,
      functionName: "approve",
      args: [
        token,
        getAddress(input.deployment.universalRouter),
        input.amountIn,
        Number(expiration),
      ],
    }),
    value: "0",
  };
}
