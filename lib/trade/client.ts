import {
  encodeFunctionData,
  getAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";

import mainnetDeployments from "../../contracts/dependencies/ethereum-mainnet.json";
import sepoliaDeployments from "../../contracts/dependencies/ethereum-sepolia.json";
import { computeOfficialV4PoolId } from "../uniswap/liquidity-launcher-sdk";
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
import { MAX_TRADE_SLIPPAGE_BPS, TRADE_QUOTE_VALIDITY_SECONDS } from "./policy";
import { getConfiguredStockPairedReleaseByHook } from "../stock-paired-release";
import {
  buildStockPairedPermit2ApprovalTransaction,
  buildStockPairedSwapTransaction,
  buildStockPairedTokenApprovalTransaction,
  createStockPairedPoolKey,
  type StockPairedTradeDeployment,
} from "./stock-paired";
import {
  getStockPairedEthRouteRuntimeCodeHashes,
  STOCK_PAIRED_NATIVE_ETH,
} from "./stock-paired-route";
import {
  parsePreparedTransaction,
  type PreparedBondingGraduationTransaction,
  type PreparedBondingMaxBuyTransaction,
  type PreparedTradeTransaction,
} from "../prepared-transaction";
import {
  CLASSIC_V4_PUBLIC_RELEASE_BINDING,
  isClassicV4PublicActionBinding,
  type ClassicV4PublicReleaseBinding,
} from "../classic-v4-public-release";
import { classicV4LaunchAbi } from "../classic-v4";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export type PreparedStandardTokenTrade = {
  status: "ready" | "approval-required";
  launchModel?: "classic" | "adaptive" | "deep" | "stock-paired";
  chainId: 1 | 11_155_111;
  owner: Address;
  token: Address;
  quoteAsset?: Address;
  inputAsset?: Address;
  side: ClassicTradeSide;
  poolKey: ClassicPoolKey;
  approvalState?: "token-to-permit2" | "permit2-to-router" | "ready";
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

export type PreparedBondingGraduation = {
  status: "ready";
  launchModel: "classic";
  launchModelVersion: "classic-v4";
  chainId: 1;
  owner: Address;
  token: Address;
  hook: Address;
  poolId: Hex;
  vault: Address;
  side: "buy";
  poolKey: ClassicPoolKey;
  bonding: {
    state: "bonding" | "ready";
    progressBps: number;
    samePool: true;
    finalLiquidityLocked: true;
  };
  quote: {
    amountIn: string;
    amountOut: string;
    amountOutMinimum: string;
    gasEstimate: string;
    slippageBps: 0;
    deadline: string;
  };
  transaction:
    PreparedBondingMaxBuyTransaction | PreparedBondingGraduationTransaction;
};

export type PreparedTokenTrade =
  PreparedStandardTokenTrade | PreparedBondingGraduation;

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
  launchModel?: "classic" | "adaptive" | "deep" | "stock-paired";
  launchModelVersion?: string;
  quoteAsset?: Address;
};

type CanonicalTradeTransaction = {
  kind: "swap" | "token-to-permit2" | "permit2-to-router";
  chainId: 1 | 11_155_111;
  to: Address;
  data: Hex;
  value: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function nonNegativeIntegerString(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !/^(0|[1-9]\d*)$/.test(value)
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
  const deployments = chainId === 1 ? mainnetDeployments : sepoliaDeployments;
  return {
    chainId,
    poolManager: getAddress(deployments.contracts.poolManager.address),
    v4Quoter: getAddress(deployments.contracts.v4Quoter.address),
    universalRouter: getAddress(deployments.contracts.universalRouter.address),
    universalRouterVersion: "2.0",
    permit2: getAddress(deployments.contracts.permit2.address),
    hook,
  };
}

function stockPairedDeploymentForContext(input: {
  chainId: 1 | 11_155_111;
  token: Address;
  hook: Address;
  poolId: Hex;
  quoteAsset: Address;
}) {
  if (input.chainId !== 1) {
    throw new Error("Stock-Paired trading is limited to Ethereum Mainnet");
  }
  const release = getConfiguredStockPairedReleaseByHook(input.hook);
  if (!release) {
    throw new Error(
      "Stock-Paired trading is not enabled by a verified release",
    );
  }
  if (release.addresses.feeHook.toLowerCase() !== input.hook.toLowerCase()) {
    throw new Error("The Stock-Paired hook does not match the release");
  }
  const dependencies = release.officialDependencies;
  const deployment: StockPairedTradeDeployment = {
    chainId: 1,
    poolManager: dependencies.poolManager.address,
    poolManagerRuntimeCodeHash: dependencies.poolManager.runtimeCodeHash,
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
    quoteRegistryRuntimeCodeHash: release.runtimeCodeHashes.quoteRegistry,
    quoteAsset: input.quoteAsset,
    quoteAssetRuntimeCodeHash: release.issuerRuntime.tokenRuntimeCodeHash,
    ethRouteRuntimeCodeHashes: getStockPairedEthRouteRuntimeCodeHashes(
      input.quoteAsset,
    ),
    token: input.token,
    poolId: input.poolId,
    release,
  };
  return deployment;
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
    throw new Error("The trade API did not return the canonical transaction");
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

function tradeEnvelope(
  transaction: {
    kind: "swap" | "token-to-permit2" | "permit2-to-router";
    chainId: number;
    to: Address;
    data: Hex;
    value: string;
  },
  expectedChainId: 1 | 11_155_111,
): CanonicalTradeTransaction {
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
  classicV4PublicRelease: ClassicV4PublicReleaseBinding | null = CLASSIC_V4_PUBLIC_RELEASE_BINDING,
): PreparedStandardTokenTrade {
  if (context.chainId !== 1 && context.chainId !== 11_155_111) {
    throw new Error("The prepared trade has an unsupported chain");
  }
  const expectedOwner = address(context.owner, "wallet");
  const expectedToken = address(context.token, "token");
  const expectedHook = address(context.hook, "hook");
  if (!isHex(context.poolId) || context.poolId.length !== 66) {
    throw new Error("The prepared trade has an invalid pool ID");
  }
  if (context.side !== "buy" && context.side !== "sell") {
    throw new Error("The prepared trade has an invalid side");
  }
  if (context.launchModel === "adaptive") {
    throw new Error("Adaptive trading is not supported by this trade path");
  }
  if (
    context.launchModelVersion === "classic-v4" &&
    !isClassicV4PublicActionBinding(classicV4PublicRelease)
  ) {
    throw new Error(
      "Classic V4 trading is not enabled by the browser release binding",
    );
  }
  const expectedAmountIn = positiveIntegerString(
    context.amountIn,
    "input amount",
  );
  const expectedDeadline = positiveIntegerString(context.deadline, "deadline");
  if (
    !Number.isInteger(context.slippageBps) ||
    context.slippageBps < 1 ||
    context.slippageBps > MAX_TRADE_SLIPPAGE_BPS
  ) {
    throw new Error("The prepared trade has invalid slippage");
  }
  if (!isRecord(input)) {
    throw new Error("The trade API returned an invalid response");
  }
  if (input.status !== "ready" && input.status !== "approval-required") {
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

  const isStockPaired = context.launchModel === "stock-paired";
  const expectedQuoteAsset = isStockPaired
    ? address(context.quoteAsset, "quote asset")
    : undefined;
  const classicDeployment = isStockPaired
    ? null
    : deploymentForChain(context.chainId, expectedHook);
  const stockDeployment =
    isStockPaired && expectedQuoteAsset
      ? stockPairedDeploymentForContext({
          chainId: context.chainId,
          token: expectedToken,
          hook: expectedHook,
          poolId: context.poolId,
          quoteAsset: expectedQuoteAsset,
        })
      : null;
  const canonicalPoolKey =
    stockDeployment && expectedQuoteAsset
      ? createStockPairedPoolKey({
          token: expectedToken,
          quoteAsset: expectedQuoteAsset,
          hook: expectedHook,
        })
      : createClassicPoolKey(expectedToken, classicDeployment!);
  const canonicalPoolId = stockDeployment
    ? computeOfficialV4PoolId(canonicalPoolKey)
    : getClassicPoolId(canonicalPoolKey, classicDeployment!);
  if (canonicalPoolId.toLowerCase() !== context.poolId.toLowerCase()) {
    throw new Error("The token does not match its canonical Programmable pool");
  }
  const expectedInputAsset = isStockPaired
    ? context.side === "buy"
      ? STOCK_PAIRED_NATIVE_ETH
      : expectedToken
    : context.side === "sell"
      ? expectedToken
      : undefined;
  if (isStockPaired) {
    if (
      input.launchModel !== "stock-paired" ||
      !sameAddress(
        address(input.quoteAsset, "quote asset"),
        expectedQuoteAsset!,
      ) ||
      !sameAddress(
        address(input.inputAsset, "trade input asset"),
        expectedInputAsset!,
      )
    ) {
      throw new Error(
        "The prepared trade does not match the Stock-Paired assets",
      );
    }
  } else if (
    input.launchModel === "stock-paired" ||
    input.quoteAsset !== undefined ||
    input.inputAsset !== undefined
  ) {
    throw new Error(
      "The prepared trade contains unexpected Stock-Paired fields",
    );
  }
  if (!isRecord(input.poolKey)) {
    throw new Error("The trade API returned an invalid pool");
  }
  const responsePoolKey: ClassicPoolKey = {
    currency0: address(input.poolKey.currency0, "pool currency0"),
    currency1: address(input.poolKey.currency1, "pool currency1"),
    fee: typeof input.poolKey.fee === "number" ? input.poolKey.fee : Number.NaN,
    tickSpacing:
      typeof input.poolKey.tickSpacing === "number"
        ? input.poolKey.tickSpacing
        : Number.NaN,
    hooks: address(input.poolKey.hooks, "pool hook"),
  };
  if (
    !sameAddress(responsePoolKey.currency0, canonicalPoolKey.currency0) ||
    !sameAddress(responsePoolKey.currency1, canonicalPoolKey.currency1) ||
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
    amountIn: positiveIntegerString(input.quote.amountIn, "quote input"),
    amountOut: positiveIntegerString(input.quote.amountOut, "quote output"),
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
    deadline: positiveIntegerString(input.quote.deadline, "quote deadline"),
  };
  if (
    quote.amountIn !== expectedAmountIn ||
    quote.slippageBps !== context.slippageBps ||
    quote.deadline !== expectedDeadline
  ) {
    throw new Error("The prepared trade does not match the requested quote");
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
  const referenceNow = deadline - BigInt(TRADE_QUOTE_VALIDITY_SECONDS);
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
      stockDeployment && expectedInputAsset
        ? buildStockPairedTokenApprovalTransaction({
            deployment: stockDeployment,
            inputAsset: expectedInputAsset,
            amountIn,
          })
        : buildClassicTokenApprovalTransaction({
            deployment: classicDeployment!,
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
      stockDeployment && expectedInputAsset
        ? buildStockPairedPermit2ApprovalTransaction({
            deployment: stockDeployment,
            inputAsset: expectedInputAsset,
            amountIn,
            now: referenceNow,
            deadline,
          })
        : buildClassicPermit2ApprovalTransaction({
            deployment: classicDeployment!,
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
      (isStockPaired
        ? input.approvalState !== "ready"
        : context.side === "sell"
          ? input.approvalState !== "ready"
          : input.approvalState !== undefined)
    ) {
      throw new Error("The swap approval state is inconsistent");
    }
    expectedTransaction = tradeEnvelope(
      stockDeployment
        ? buildStockPairedSwapTransaction({
            deployment: stockDeployment,
            side: context.side,
            amountIn,
            quotedAmountOut: BigInt(quote.amountOut),
            slippageBps: quote.slippageBps,
            now: referenceNow,
            deadline,
          })
        : buildClassicSwapTransaction({
            deployment: classicDeployment!,
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
    ...(isStockPaired
      ? {
          launchModel: "stock-paired" as const,
          quoteAsset: expectedQuoteAsset,
          inputAsset: expectedInputAsset,
        }
      : {}),
    chainId: context.chainId,
    owner,
    token,
    side: context.side,
    poolKey: canonicalPoolKey,
    ...(input.approvalState === undefined
      ? {}
      : {
          approvalState: input.approvalState as
            "token-to-permit2" | "permit2-to-router" | "ready",
        }),
    quote,
    transaction,
  };
}

export type PreparedBondingGraduationValidationContext = {
  chainId: 1;
  owner: Address;
  token: Address;
  hook: Address;
  poolId: Hex;
};

export function validatePreparedBondingGraduationResponse(
  input: unknown,
  context: PreparedBondingGraduationValidationContext,
  classicV4PublicRelease: ClassicV4PublicReleaseBinding | null = CLASSIC_V4_PUBLIC_RELEASE_BINDING,
): PreparedBondingGraduation {
  if (!isClassicV4PublicActionBinding(classicV4PublicRelease)) {
    throw new Error(
      "Classic V4 Bonding is not enabled by the browser release binding",
    );
  }
  if (!isRecord(input)) {
    throw new Error("The Bonding API returned an invalid response");
  }

  const owner = address(input.owner, "wallet");
  const token = address(input.token, "token");
  const hook = address(input.hook, "hook");
  const vault = address(input.vault, "graduation vault");
  if (sameAddress(vault, ZERO_ADDRESS)) {
    throw new Error("The Bonding API returned an invalid graduation vault");
  }
  if (
    input.status !== "ready" ||
    input.launchModel !== "classic" ||
    input.launchModelVersion !== "classic-v4" ||
    input.chainId !== 1 ||
    context.chainId !== 1 ||
    input.side !== "buy" ||
    !sameAddress(owner, address(context.owner, "wallet")) ||
    !sameAddress(token, address(context.token, "token")) ||
    !sameAddress(hook, address(context.hook, "hook")) ||
    typeof input.poolId !== "string" ||
    input.poolId.toLowerCase() !== context.poolId.toLowerCase()
  ) {
    throw new Error("The prepared Bonding action does not match this token");
  }
  if (!isHex(input.poolId) || input.poolId.length !== 66) {
    throw new Error("The prepared Bonding action has an invalid pool ID");
  }

  const canonicalPoolKey: ClassicPoolKey = {
    currency0: ZERO_ADDRESS,
    currency1: token,
    fee: 0,
    tickSpacing: 200,
    hooks: hook,
  };
  const canonicalPoolId = computeOfficialV4PoolId(canonicalPoolKey);
  if (canonicalPoolId.toLowerCase() !== context.poolId.toLowerCase()) {
    throw new Error("The Bonding action does not match the canonical pool");
  }
  if (!isRecord(input.poolKey)) {
    throw new Error("The Bonding API returned an invalid pool");
  }
  const responsePoolKey: ClassicPoolKey = {
    currency0: address(input.poolKey.currency0, "pool currency0"),
    currency1: address(input.poolKey.currency1, "pool currency1"),
    fee: typeof input.poolKey.fee === "number" ? input.poolKey.fee : Number.NaN,
    tickSpacing:
      typeof input.poolKey.tickSpacing === "number"
        ? input.poolKey.tickSpacing
        : Number.NaN,
    hooks: address(input.poolKey.hooks, "pool hook"),
  };
  if (
    responsePoolKey.currency0 !== canonicalPoolKey.currency0 ||
    !sameAddress(responsePoolKey.currency1, canonicalPoolKey.currency1) ||
    responsePoolKey.fee !== canonicalPoolKey.fee ||
    responsePoolKey.tickSpacing !== canonicalPoolKey.tickSpacing ||
    !sameAddress(responsePoolKey.hooks, canonicalPoolKey.hooks)
  ) {
    throw new Error("The Bonding API returned a noncanonical pool");
  }

  if (!isRecord(input.bonding)) {
    throw new Error("The Bonding API returned invalid lifecycle state");
  }
  const progressBps =
    typeof input.bonding.progressBps === "number"
      ? input.bonding.progressBps
      : Number.NaN;
  const bondingState = input.bonding.state;
  if (
    (bondingState !== "bonding" && bondingState !== "ready") ||
    !Number.isInteger(progressBps) ||
    (bondingState === "bonding" &&
      (progressBps < 0 || progressBps >= 10_000)) ||
    (bondingState === "ready" && progressBps !== 10_000) ||
    input.bonding.samePool !== true ||
    input.bonding.finalLiquidityLocked !== true
  ) {
    throw new Error("The Bonding API returned invalid lifecycle state");
  }

  if (!isRecord(input.quote)) {
    throw new Error("The Bonding API returned an invalid quote");
  }
  const isReadyGraduation = bondingState === "ready";
  const quote = {
    amountIn: isReadyGraduation
      ? nonNegativeIntegerString(input.quote.amountIn, "quote input")
      : positiveIntegerString(input.quote.amountIn, "quote input"),
    amountOut: isReadyGraduation
      ? nonNegativeIntegerString(input.quote.amountOut, "quote output")
      : positiveIntegerString(input.quote.amountOut, "quote output"),
    amountOutMinimum: isReadyGraduation
      ? nonNegativeIntegerString(input.quote.amountOutMinimum, "minimum output")
      : positiveIntegerString(input.quote.amountOutMinimum, "minimum output"),
    gasEstimate: positiveIntegerString(
      input.quote.gasEstimate,
      "quote gas estimate",
    ),
    slippageBps: input.quote.slippageBps,
    deadline: positiveIntegerString(input.quote.deadline, "quote deadline"),
  };
  if (
    quote.amountOutMinimum !== quote.amountOut ||
    quote.slippageBps !== 0 ||
    (isReadyGraduation &&
      (quote.amountIn !== "0" ||
        quote.amountOut !== "0" ||
        quote.amountOutMinimum !== "0"))
  ) {
    throw new Error("The Bonding quote must use the exact remaining curve");
  }

  const transaction = parsePreparedTransaction(input.transaction);
  const expectedGasLimit = (
    (BigInt(quote.gasEstimate) * 120n + 99n) /
    100n
  ).toString();
  const expectedData = isReadyGraduation
    ? encodeFunctionData({
        abi: classicV4LaunchAbi,
        functionName: "graduate",
        args: [token],
      })
    : encodeFunctionData({
        abi: classicV4LaunchAbi,
        functionName: "maxBuyAndGraduate",
        args: [token, owner],
      });
  if (
    transaction.kind !==
      (isReadyGraduation ? "bonding-graduate" : "bonding-max-buy") ||
    transaction.chainId !== 1 ||
    !sameAddress(transaction.to, classicV4PublicRelease.launcher) ||
    transaction.data.toLowerCase() !== expectedData.toLowerCase() ||
    transaction.value !== quote.amountIn ||
    transaction.gasLimit !== expectedGasLimit
  ) {
    throw new Error("The Bonding API did not return the canonical action");
  }

  return {
    status: "ready",
    launchModel: "classic",
    launchModelVersion: "classic-v4",
    chainId: 1,
    owner,
    token,
    hook,
    poolId: context.poolId,
    vault,
    side: "buy",
    poolKey: canonicalPoolKey,
    bonding: {
      state: bondingState,
      progressBps,
      samePool: true,
      finalLiquidityLocked: true,
    },
    quote: {
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      amountOutMinimum: quote.amountOutMinimum,
      gasEstimate: quote.gasEstimate,
      slippageBps: 0,
      deadline: quote.deadline,
    },
    transaction,
  };
}
