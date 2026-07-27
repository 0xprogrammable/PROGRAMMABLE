import {
  getAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import mainnetDeployments from "../../contracts/dependencies/ethereum-mainnet.json";
import sepoliaDeployments from "../../contracts/dependencies/ethereum-sepolia.json";
import {
  amountOutMinimum,
  buildClassicPermit2ApprovalTransaction,
  buildClassicSwapTransaction,
  buildClassicTokenApprovalTransaction,
  createClassicPoolKey,
  getClassicPoolId,
  type ClassicPoolKey,
  type ClassicTradeDeployment,
  type ClassicTradeSide,
} from "./classic";
import {
  parsePreparedTransaction,
  type PreparedTradeTransaction,
} from "../prepared-transaction";

export type PreparedTokenTrade = {
  status: "ready" | "approval-required";
  chainId: 1 | 11_155_111;
  owner: Address;
  token: Address;
  side: ClassicTradeSide;
  poolKey: ClassicPoolKey;
  approvalState?:
    | "token-to-permit2"
    | "permit2-to-router"
    | "ready";
  quote: {
    amountIn: string;
    amountOut: string;
    amountOutMinimum: string;
    gasEstimate: string;
    slippageBps: number;
    deadline: string;
  };
  transaction: PreparedTradeTransaction;
};

export type PreparedTradeValidationContext = {
  chainId: 1 | 11_155_111;
  owner: Address;
  token: Address;
  hook: Address;
  poolId: Hex;
  side: ClassicTradeSide;
  amountIn: string;
  slippageBps: number;
  deadline: string;
};

type CanonicalTradeTransaction = {
  kind: "swap" | "token-to-permit2" | "permit2-to-router";
  chainId: 1 | 11_155_111;
  to: Address;
  data: Hex;
  value: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function address(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`The prepared trade has an invalid ${label}`);
  }
  try {
    return getAddress(value);
  } catch {
    throw new Error(`The prepared trade has an invalid ${label}`);
  }
}

function positiveIntegerString(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^[1-9]\d*$/.test(value)
  ) {
    throw new Error(`The prepared trade has an invalid ${label}`);
  }
  return value;
}

function sameAddress(left: Address, right: Address) {
  return left.toLowerCase() === right.toLowerCase();
}

function deploymentForChain(
  chainId: 1 | 11_155_111,
  hook: Address,
): ClassicTradeDeployment {
  const deployments =
    chainId === 1 ? mainnetDeployments : sepoliaDeployments;
  return {
    chainId,
    poolManager: getAddress(
      deployments.contracts.poolManager.address,
    ),
    v4Quoter: getAddress(
      deployments.contracts.v4Quoter.address,
    ),
    universalRouter: getAddress(
      deployments.contracts.universalRouter.address,
    ),
    universalRouterVersion: "2.0",
    permit2: getAddress(
      deployments.contracts.permit2.address,
    ),
    hook,
  };
}

function assertCanonicalTransaction(
  actual: PreparedTradeTransaction,
  expected: CanonicalTradeTransaction,
) {
  if (
    actual.kind !== expected.kind ||
    actual.chainId !== expected.chainId ||
    !sameAddress(actual.to, expected.to) ||
    actual.data.toLowerCase() !== expected.data.toLowerCase() ||
    actual.value !== expected.value
  ) {
    throw new Error(
      "The trade API did not return the canonical transaction",
    );
  }
  if (
    (actual.kind === "swap" && actual.gasLimit === undefined) ||
    (actual.kind !== "swap" && actual.gasLimit !== undefined)
  ) {
    throw new Error(
      "The trade API did not return the canonical transaction gas limit",
    );
  }
}

function tradeEnvelope(transaction: {
  kind: "swap" | "token-to-permit2" | "permit2-to-router";
  chainId: number;
  to: Address;
  data: Hex;
  value: string;
}, expectedChainId: 1 | 11_155_111): CanonicalTradeTransaction {
  if (transaction.chainId !== expectedChainId) {
    throw new Error("The canonical transaction has the wrong chain");
  }
  return {
    kind: transaction.kind,
    chainId: expectedChainId,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  };
}

export function validatePreparedTradeResponse(
  input: unknown,
  context: PreparedTradeValidationContext,
): PreparedTokenTrade {
  if (context.chainId !== 1 && context.chainId !== 11_155_111) {
    throw new Error("The prepared trade has an unsupported chain");
  }
  const expectedOwner = address(context.owner, "wallet");
  const expectedToken = address(context.token, "token");
  const expectedHook = address(context.hook, "hook");
  if (
    !isHex(context.poolId) ||
    context.poolId.length !== 66
  ) {
    throw new Error("The prepared trade has an invalid pool ID");
  }
  if (context.side !== "buy" && context.side !== "sell") {
    throw new Error("The prepared trade has an invalid side");
  }
  const expectedAmountIn = positiveIntegerString(
    context.amountIn,
    "input amount",
  );
  const expectedDeadline = positiveIntegerString(
    context.deadline,
    "deadline",
  );
  if (
    !Number.isInteger(context.slippageBps) ||
    context.slippageBps < 1 ||
    context.slippageBps > 1_000
  ) {
    throw new Error("The prepared trade has invalid slippage");
  }
  if (!isRecord(input)) {
    throw new Error("The trade API returned an invalid response");
  }
  if (
    input.status !== "ready" &&
    input.status !== "approval-required"
  ) {
    throw new Error("The trade API returned an invalid status");
  }
  if (input.chainId !== context.chainId) {
    throw new Error("The prepared trade does not match the requested chain");
  }

  const owner = address(input.owner, "wallet");
  const token = address(input.token, "token");
  if (!sameAddress(owner, expectedOwner)) {
    throw new Error("The prepared trade does not match the wallet");
  }
  if (!sameAddress(token, expectedToken)) {
    throw new Error("The prepared trade does not match the token");
  }
  if (input.side !== context.side) {
    throw new Error("The prepared trade does not match the requested side");
  }

  const deployment = deploymentForChain(context.chainId, expectedHook);
  const canonicalPoolKey = createClassicPoolKey(
    expectedToken,
    deployment,
  );
  if (
    getClassicPoolId(canonicalPoolKey, deployment).toLowerCase() !==
    context.poolId.toLowerCase()
  ) {
    throw new Error(
      "The token does not match its canonical Programmable pool",
    );
  }
  if (!isRecord(input.poolKey)) {
    throw new Error("The trade API returned an invalid pool");
  }
  const responsePoolKey: ClassicPoolKey = {
    currency0: address(input.poolKey.currency0, "pool currency0"),
    currency1: address(input.poolKey.currency1, "pool currency1"),
    fee:
      typeof input.poolKey.fee === "number"
        ? input.poolKey.fee
        : Number.NaN,
    tickSpacing:
      typeof input.poolKey.tickSpacing === "number"
        ? input.poolKey.tickSpacing
        : Number.NaN,
    hooks: address(input.poolKey.hooks, "pool hook"),
  };
  if (
    !sameAddress(
      responsePoolKey.currency0,
      canonicalPoolKey.currency0,
    ) ||
    !sameAddress(
      responsePoolKey.currency1,
      canonicalPoolKey.currency1,
    ) ||
    responsePoolKey.fee !== canonicalPoolKey.fee ||
    responsePoolKey.tickSpacing !== canonicalPoolKey.tickSpacing ||
    !sameAddress(responsePoolKey.hooks, canonicalPoolKey.hooks)
  ) {
    throw new Error("The trade API returned a noncanonical pool");
  }

  if (!isRecord(input.quote)) {
    throw new Error("The trade API returned an invalid quote");
  }
  const quote = {
    amountIn: positiveIntegerString(
      input.quote.amountIn,
      "quote input",
    ),
    amountOut: positiveIntegerString(
      input.quote.amountOut,
      "quote output",
    ),
    amountOutMinimum: positiveIntegerString(
      input.quote.amountOutMinimum,
      "minimum output",
    ),
    gasEstimate: positiveIntegerString(
      input.quote.gasEstimate,
      "quote gas estimate",
    ),
    slippageBps:
      typeof input.quote.slippageBps === "number"
        ? input.quote.slippageBps
        : Number.NaN,
    deadline: positiveIntegerString(
      input.quote.deadline,
      "quote deadline",
    ),
  };
  if (
    quote.amountIn !== expectedAmountIn ||
    quote.slippageBps !== context.slippageBps ||
    quote.deadline !== expectedDeadline
  ) {
    throw new Error(
      "The prepared trade does not match the requested quote",
    );
  }
  const minimum = amountOutMinimum(
    BigInt(quote.amountOut),
    quote.slippageBps,
  ).toString();
  if (quote.amountOutMinimum !== minimum) {
    throw new Error(
      "The prepared trade minimum output does not match its quote",
    );
  }

  const transaction = parsePreparedTransaction(input.transaction);
  if (
    transaction.kind !== "swap" &&
    transaction.kind !== "token-to-permit2" &&
    transaction.kind !== "permit2-to-router"
  ) {
    throw new Error("The trade API returned a non-trade transaction");
  }
  const amountIn = BigInt(expectedAmountIn);
  const deadline = BigInt(expectedDeadline);
  const referenceNow = deadline - 1_200n;
  if (referenceNow < 0n) {
    throw new Error("The prepared trade deadline is invalid");
  }

  let expectedTransaction: CanonicalTradeTransaction;
  if (transaction.kind === "token-to-permit2") {
    if (
      input.status !== "approval-required" ||
      input.approvalState !== transaction.kind ||
      context.side !== "sell"
    ) {
      throw new Error("The token approval state is inconsistent");
    }
    expectedTransaction = tradeEnvelope(
      buildClassicTokenApprovalTransaction({
        deployment,
        token: expectedToken,
        amountIn,
      }),
      context.chainId,
    );
  } else if (transaction.kind === "permit2-to-router") {
    if (
      input.status !== "approval-required" ||
      input.approvalState !== transaction.kind ||
      context.side !== "sell"
    ) {
      throw new Error("The Permit2 approval state is inconsistent");
    }
    expectedTransaction = tradeEnvelope(
      buildClassicPermit2ApprovalTransaction({
        deployment,
        token: expectedToken,
        amountIn,
        now: referenceNow,
        deadline,
      }),
      context.chainId,
    );
  } else {
    if (
      input.status !== "ready" ||
      (context.side === "sell"
        ? input.approvalState !== "ready"
        : input.approvalState !== undefined)
    ) {
      throw new Error("The swap approval state is inconsistent");
    }
    expectedTransaction = tradeEnvelope(
      buildClassicSwapTransaction({
        deployment,
        poolKey: canonicalPoolKey,
        side: context.side,
        amountIn,
        quotedAmountOut: BigInt(quote.amountOut),
        slippageBps: quote.slippageBps,
        now: referenceNow,
        deadline,
      }),
      context.chainId,
    );
  }
  assertCanonicalTransaction(transaction, expectedTransaction);

  return {
    status: input.status,
    chainId: context.chainId,
    owner,
    token,
    side: context.side,
    poolKey: canonicalPoolKey,
    ...(input.approvalState === undefined
      ? {}
      : {
          approvalState: input.approvalState as
            | "token-to-permit2"
            | "permit2-to-router"
            | "ready",
        }),
    quote,
    transaction,
  };
}
