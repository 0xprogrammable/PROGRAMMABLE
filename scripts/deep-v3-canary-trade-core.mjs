import { createRequire } from "node:module";

import {
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  parseAbi,
  stringToHex,
} from "viem";

import {
  DEEP_V3_MAX_FEE_PER_GAS_WEI,
  DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI,
  deepV3Quantity,
  normalizeDeepV3Hex,
} from "./deep-v3-mainnet-operator-core.mjs";

const require = createRequire(import.meta.url);
const {
  Actions,
  URVersion,
  V4Planner,
} = require("@uniswap/v4-sdk");
const {
  CommandType,
  RoutePlanner,
  UniversalRouterVersion,
} = require("@uniswap/universal-router-sdk");
const {
  computeLbpPoolId,
} = require("@uniswap/liquidity-launcher-sdk");

export const DEEP_V3_TRADE_NATIVE =
  "0x0000000000000000000000000000000000000000";
export const DEEP_V3_TRADE_POOL_FEE = 0;
export const DEEP_V3_TRADE_TICK_SPACING = 200;
export const DEEP_V3_TRADE_TOTAL_FEE_BPS = 100n;
export const DEEP_V3_TRADE_GROWTH_FEE_BPS = 90n;
export const DEEP_V3_TRADE_PROGRAMMABLE_FEE_BPS = 10n;
export const DEEP_V3_TRADE_MIN_COMPOUND_WEI =
  2_000_000_000_000_000n;
export const DEEP_V3_TRADE_MIN_NATIVE_VOLUME_WEI =
  100_000_000_000_000n;
export const DEEP_V3_TRADE_MAX_NATIVE_VOLUME_WEI =
  25_000_000_000_000_000n;
export const DEEP_V3_TRADE_SLIPPAGE_BPS = 100;
export const DEEP_V3_TRADE_MAX_QUOTE_IMPACT_BPS = 500;
export const DEEP_V3_TRADE_QUOTE_TTL_MS = 45_000;
export const DEEP_V3_TRADE_DEADLINE_SECONDS = 300n;
export const DEEP_V3_TRADE_PERMIT2_EXPIRY_SECONDS = 900n;
export const DEEP_V3_TRADE_PERMIT2_SAFETY_SECONDS = 600n;
export const DEEP_V3_TRADE_ORACLE_MATURITY_SECONDS = 1_800n;

export const DEEP_V3_TRADE_GAS_CEILINGS = Object.freeze({
  "token-to-permit2": 100_000n,
  "permit2-to-router": 150_000n,
  swap: 1_500_000n,
});

const BPS = 10_000n;
const Q192 = 1n << 192n;
const UINT128_MAX = (1n << 128n) - 1n;
const HASH_PATTERN = /^0x[0-9a-f]{64}$/;
const TRADE_RUNTIME_FIELDS = Object.freeze([
  "poolManager",
  "stateView",
  "v4Quoter",
  "universalRouter",
  "permit2",
  "feeHook",
  "launcher",
]);

export const deepV3TradeQuoterAbi = parseAbi([
  "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)",
]);

export const deepV3TradeUniversalRouterAbi = parseAbi([
  "function execute(bytes commands,bytes[] inputs,uint256 deadline) payable",
]);

export const deepV3TradeTokenAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);

export const deepV3TradePermit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);

export const deepV3TradeStateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
]);

export const deepV3TradeHookAbi = parseAbi([
  "function poolFeeConfig(bytes32 poolId) view returns (address growthVault,address registrar,uint8 lifecycle,uint256 growthFeesAccrued)",
  "function feeDisclosure(bytes32 poolId) view returns (uint16 totalHookFeeBps,uint16 growthFeeBps,uint16 programmableFeeBps,uint16 transferTaxBps,uint24 lpFeePips,address growthVault)",
  "function quoteGrossFees(uint256 grossNativeAmount) pure returns (uint256 growthFee,uint256 programmableFee)",
  "function quoteExactOutputFees(uint256 netNativeAmount) pure returns (uint256 growthFee,uint256 programmableFee)",
]);

function sameAddress(left, right) {
  return normalizeDeepV3Hex(left) === normalizeDeepV3Hex(right);
}

function validHash(value) {
  return (
    typeof value === "string" &&
    HASH_PATTERN.test(value.toLowerCase())
  );
}

function positiveBigInt(value, label, maximum = UINT128_MAX) {
  const amount = BigInt(value);
  if (amount <= 0n || amount > maximum) {
    throw new Error(`${label} is outside the supported range`);
  }
  return amount;
}

function ceilDiv(numerator, denominator) {
  return (numerator + denominator - 1n) / denominator;
}

export function buildDeepV3CanaryTradePoolKey(token, hook) {
  if (
    !isAddress(token ?? "") ||
    !isAddress(hook ?? "") ||
    sameAddress(token, DEEP_V3_TRADE_NATIVE) ||
    sameAddress(hook, DEEP_V3_TRADE_NATIVE)
  ) {
    throw new Error("The Deep V3 canary pool addresses are invalid");
  }
  return {
    currency0: DEEP_V3_TRADE_NATIVE,
    currency1: getAddress(token),
    fee: DEEP_V3_TRADE_POOL_FEE,
    tickSpacing: DEEP_V3_TRADE_TICK_SPACING,
    hooks: getAddress(hook),
  };
}

export function getDeepV3CanaryTradePoolId(poolKey) {
  const expected = buildDeepV3CanaryTradePoolKey(
    poolKey.currency1,
    poolKey.hooks,
  );
  if (
    !sameAddress(poolKey.currency0, expected.currency0) ||
    !sameAddress(poolKey.currency1, expected.currency1) ||
    !sameAddress(poolKey.hooks, expected.hooks) ||
    poolKey.fee !== expected.fee ||
    poolKey.tickSpacing !== expected.tickSpacing
  ) {
    throw new Error("The Deep V3 canary PoolKey is not canonical");
  }
  return computeLbpPoolId(
    expected.currency0,
    expected.currency1,
    expected.fee,
    expected.tickSpacing,
    expected.hooks,
  );
}

function expectedRuntime(manifest, field) {
  if (field === "feeHook" || field === "launcher") {
    return {
      address: manifest.addresses?.[field],
      codeHash: manifest.runtimeCodeHashes?.[field],
    };
  }
  return {
    address: manifest.officialDependencies?.[field]?.address,
    codeHash:
      manifest.officialDependencies?.[field]?.runtimeCodeHash,
  };
}

function canonicalSnapshot(snapshot) {
  return {
    chainId: Number(snapshot.chainId),
    account: normalizeDeepV3Hex(snapshot.account),
    blockNumber: Number(snapshot.blockNumber),
    blockHash: normalizeDeepV3Hex(snapshot.blockHash),
    timestamp: Number(snapshot.timestamp),
    confirmedNonce: Number(snapshot.confirmedNonce),
    pendingNonce: Number(snapshot.pendingNonce),
    balance: BigInt(snapshot.balance).toString(),
    token: normalizeDeepV3Hex(snapshot.token),
    vault: normalizeDeepV3Hex(snapshot.vault),
    poolId: normalizeDeepV3Hex(snapshot.poolId),
    sqrtPriceX96: BigInt(snapshot.sqrtPriceX96).toString(),
    cardinalityNext: Number(snapshot.cardinalityNext),
    oracleGrowthTimestamp: Number(snapshot.oracleGrowthTimestamp),
    hookGrowthFees: BigInt(snapshot.hookGrowthFees).toString(),
    pendingNative: BigInt(snapshot.pendingNative).toString(),
    action: Number(snapshot.action),
    compounded: Boolean(snapshot.compounded),
    tokenCodePresent: Boolean(snapshot.tokenCodePresent),
    vaultCodePresent: Boolean(snapshot.vaultCodePresent),
    vaultPoolId: normalizeDeepV3Hex(snapshot.vaultPoolId),
    vaultToken: normalizeDeepV3Hex(snapshot.vaultToken),
    vaultHook: normalizeDeepV3Hex(snapshot.vaultHook),
    hookVault: normalizeDeepV3Hex(snapshot.hookVault),
    hookRegistrar: normalizeDeepV3Hex(snapshot.hookRegistrar),
    hookLifecycle: Number(snapshot.hookLifecycle),
    totalHookFeeBps: Number(snapshot.totalHookFeeBps),
    growthFeeBps: Number(snapshot.growthFeeBps),
    programmableFeeBps: Number(snapshot.programmableFeeBps),
    transferTaxBps: Number(snapshot.transferTaxBps),
    lpFeePips: Number(snapshot.lpFeePips),
    runtimes: Object.fromEntries(
      TRADE_RUNTIME_FIELDS.map((field) => [
        field,
        {
          address: normalizeDeepV3Hex(
            snapshot.runtimes?.[field]?.address,
          ),
          codeHash: normalizeDeepV3Hex(
            snapshot.runtimes?.[field]?.codeHash,
          ),
        },
      ]),
    ),
  };
}

export function reconcileDeepV3CanaryTradeSnapshots({
  manifest,
  expectedAccount,
  snapshots,
}) {
  if (
    !isAddress(expectedAccount ?? "") ||
    !Array.isArray(snapshots) ||
    snapshots.length !== 2
  ) {
    throw new Error(
      "The Deep V3 canary trade requires one account and two RPC snapshots",
    );
  }
  const canonical = snapshots.map(canonicalSnapshot);
  if (JSON.stringify(canonical[0]) !== JSON.stringify(canonical[1])) {
    throw new Error(
      "Independent RPCs disagree on the Deep V3 canary trade state",
    );
  }
  const state = canonical[0];
  if (
    state.chainId !== 1 ||
    !sameAddress(state.account, expectedAccount) ||
    !Number.isSafeInteger(state.blockNumber) ||
    state.blockNumber <= 0 ||
    !validHash(state.blockHash) ||
    !Number.isSafeInteger(state.timestamp) ||
    state.timestamp <= 0 ||
    !Number.isSafeInteger(state.confirmedNonce) ||
    state.confirmedNonce < 0 ||
    state.confirmedNonce !== state.pendingNonce ||
    BigInt(state.balance) < 0n
  ) {
    throw new Error("The Deep V3 canary account state is invalid");
  }
  if (
    !isAddress(state.token) ||
    !isAddress(state.vault) ||
    !isAddress(state.vaultToken) ||
    !isAddress(state.vaultHook) ||
    !isAddress(state.hookVault) ||
    !isAddress(state.hookRegistrar) ||
    !validHash(state.poolId) ||
    !validHash(state.vaultPoolId) ||
    BigInt(state.sqrtPriceX96) <= 0n ||
    !state.tokenCodePresent ||
    !state.vaultCodePresent
  ) {
    throw new Error("The Deep V3 canary trade topology is incomplete");
  }
  const poolKey = buildDeepV3CanaryTradePoolKey(
    state.token,
    manifest.addresses?.feeHook,
  );
  const expectedPoolId = getDeepV3CanaryTradePoolId(poolKey);
  if (
    !sameAddress(state.vaultToken, state.token) ||
    !sameAddress(state.vaultHook, manifest.addresses?.feeHook) ||
    !sameAddress(state.hookVault, state.vault) ||
    !sameAddress(state.hookRegistrar, manifest.addresses?.launcher) ||
    normalizeDeepV3Hex(state.poolId) !==
      normalizeDeepV3Hex(expectedPoolId) ||
    normalizeDeepV3Hex(state.vaultPoolId) !==
      normalizeDeepV3Hex(expectedPoolId) ||
    state.hookLifecycle !== 5
  ) {
    throw new Error(
      "The Deep V3 canary trade is not bound to the original PoolId",
    );
  }
  if (
    state.totalHookFeeBps !== Number(DEEP_V3_TRADE_TOTAL_FEE_BPS) ||
    state.growthFeeBps !== Number(DEEP_V3_TRADE_GROWTH_FEE_BPS) ||
    state.programmableFeeBps !==
      Number(DEEP_V3_TRADE_PROGRAMMABLE_FEE_BPS) ||
    state.transferTaxBps !== 0 ||
    state.lpFeePips !== 0
  ) {
    throw new Error("The Deep V3 canary fee disclosure drifted");
  }
  for (const field of TRADE_RUNTIME_FIELDS) {
    const expected = expectedRuntime(manifest, field);
    const observed = state.runtimes[field];
    if (
      !isAddress(expected.address ?? "") ||
      !validHash(expected.codeHash) ||
      !sameAddress(observed.address, expected.address) ||
      normalizeDeepV3Hex(observed.codeHash) !==
        normalizeDeepV3Hex(expected.codeHash)
    ) {
      throw new Error(`The Deep V3 ${field} runtime drifted`);
    }
  }
  if (
    state.cardinalityNext !== 192 ||
    state.oracleGrowthTimestamp <= 0 ||
    BigInt(state.timestamp) <
      BigInt(state.oracleGrowthTimestamp) +
        DEEP_V3_TRADE_ORACLE_MATURITY_SECONDS
  ) {
    throw new Error("The Deep V3 canary oracle is not mature");
  }
  return {
    ...state,
    account: getAddress(state.account),
    token: getAddress(state.token),
    vault: getAddress(state.vault),
    poolId: expectedPoolId,
    poolKey,
  };
}

export function deepV3GrowthFeeForGross(grossNativeAmount) {
  const gross = BigInt(grossNativeAmount);
  if (gross < 0n) {
    throw new Error("Gross native volume cannot be negative");
  }
  const total = (gross * DEEP_V3_TRADE_TOTAL_FEE_BPS) / BPS;
  const programmable =
    (gross * DEEP_V3_TRADE_PROGRAMMABLE_FEE_BPS) / BPS;
  return {
    grossNative: gross,
    growthFee: total - (programmable > total ? total : programmable),
    programmableFee:
      programmable > total ? total : programmable,
    totalFee: total,
  };
}

export function deepV3GrowthFeeForNetOutput(netNativeAmount) {
  const net = BigInt(netNativeAmount);
  if (net < 0n) {
    throw new Error("Net native output cannot be negative");
  }
  const gross = ceilDiv(
    net * BPS,
    BPS - DEEP_V3_TRADE_TOTAL_FEE_BPS,
  );
  const total = gross - net;
  const programmable =
    (gross * DEEP_V3_TRADE_PROGRAMMABLE_FEE_BPS) / BPS;
  return {
    grossNative: gross,
    growthFee: total - (programmable > total ? total : programmable),
    programmableFee:
      programmable > total ? total : programmable,
    totalFee: total,
  };
}

export function deepV3MinimumGrossVolumeForGrowth(growthNeeded) {
  const target = BigInt(growthNeeded);
  if (target <= 0n) return 0n;
  let low = 0n;
  let high = ceilDiv(target * BPS, DEEP_V3_TRADE_GROWTH_FEE_BPS);
  while (deepV3GrowthFeeForGross(high).growthFee < target) {
    high = high * 2n + 1n;
  }
  while (low + 1n < high) {
    const middle = (low + high) / 2n;
    if (deepV3GrowthFeeForGross(middle).growthFee >= target) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

export function deepV3CanaryFeeProgress(state) {
  const available =
    BigInt(state.hookGrowthFees) + BigInt(state.pendingNative);
  const remaining =
    available >= DEEP_V3_TRADE_MIN_COMPOUND_WEI
      ? 0n
      : DEEP_V3_TRADE_MIN_COMPOUND_WEI - available;
  return {
    availableGrowthWei: available,
    remainingGrowthWei: remaining,
    minimumRemainingGrossVolumeWei:
      deepV3MinimumGrossVolumeForGrowth(remaining),
    readyToCompound: remaining === 0n,
  };
}

export function deepV3QuoteImpactBps({
  side,
  amountIn,
  quotedAmountOut,
  sqrtPriceX96,
}) {
  const input = positiveBigInt(amountIn, "Trade input");
  const output = positiveBigInt(quotedAmountOut, "Quoted output");
  const sqrt = positiveBigInt(
    sqrtPriceX96,
    "Pool square-root price",
    (1n << 160n) - 1n,
  );
  const price = sqrt * sqrt;
  const spotOutput =
    side === "buy"
      ? (input * price) / Q192
      : side === "sell"
        ? (input * Q192) / price
        : 0n;
  if (spotOutput <= 0n || output > spotOutput) {
    throw new Error("The Deep V3 quote is inconsistent with spot");
  }
  return {
    spotAmountOut: spotOutput,
    impactBps: Number(
      ceilDiv((spotOutput - output) * BPS, spotOutput),
    ),
  };
}

function amountOutMinimum(quotedAmountOut) {
  const output = positiveBigInt(quotedAmountOut, "Quoted output");
  const minimum =
    (output * (BPS - BigInt(DEEP_V3_TRADE_SLIPPAGE_BPS))) / BPS;
  if (minimum <= 0n || minimum > UINT128_MAX) {
    throw new Error("The Deep V3 minimum output is invalid");
  }
  return minimum;
}

function buildSwapTransaction({
  manifest,
  poolKey,
  side,
  amountIn,
  quotedAmountOut,
  deadline,
}) {
  const minimum = amountOutMinimum(quotedAmountOut);
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
    to: getAddress(
      manifest.officialDependencies.universalRouter.address,
    ),
    data: encodeFunctionData({
      abi: deepV3TradeUniversalRouterAbi,
      functionName: "execute",
      args: [route.commands, route.inputs, deadline],
    }),
    value: side === "buy" ? amountIn : 0n,
    amountOutMinimum: minimum,
  };
}

function approvalState({
  side,
  amountIn,
  tokenAllowance,
  permit2Allowance,
  permit2Expiration,
  now,
}) {
  if (side === "buy") return "ready";
  if (BigInt(tokenAllowance) < amountIn) {
    return "token-to-permit2";
  }
  if (
    BigInt(permit2Allowance) < amountIn ||
    BigInt(permit2Expiration) <=
      now + DEEP_V3_TRADE_PERMIT2_SAFETY_SECONDS
  ) {
    return "permit2-to-router";
  }
  return "ready";
}

function buildApprovalTransaction({
  manifest,
  state,
  amountIn,
  approval,
}) {
  if (approval === "token-to-permit2") {
    return {
      kind: approval,
      to: state.token,
      data: encodeFunctionData({
        abi: deepV3TradeTokenAbi,
        functionName: "approve",
        args: [
          getAddress(manifest.officialDependencies.permit2.address),
          amountIn,
        ],
      }),
      value: 0n,
    };
  }
  const expiration =
    BigInt(state.timestamp) + DEEP_V3_TRADE_PERMIT2_EXPIRY_SECONDS;
  return {
    kind: "permit2-to-router",
    to: getAddress(manifest.officialDependencies.permit2.address),
    data: encodeFunctionData({
      abi: deepV3TradePermit2Abi,
      functionName: "approve",
      args: [
        state.token,
        getAddress(
          manifest.officialDependencies.universalRouter.address,
        ),
        amountIn,
        Number(expiration),
      ],
    }),
    value: 0n,
  };
}

export function prepareDeepV3CanaryTradeCandidate({
  manifest,
  state,
  side,
  amountIn: amountInValue,
  quotedAmountOut: quotedAmountOutValue,
  quoterGasEstimate,
  tokenAllowance = 0n,
  permit2Allowance = 0n,
  permit2Expiration = 0n,
  capturedAtMs,
  nowMs,
}) {
  if (side !== "buy" && side !== "sell") {
    throw new Error("The Deep V3 trade side is invalid");
  }
  const amountIn = positiveBigInt(amountInValue, "Trade input");
  const quotedAmountOut = positiveBigInt(
    quotedAmountOutValue,
    "Quoted output",
  );
  positiveBigInt(quoterGasEstimate, "Quoter gas estimate");
  if (
    !Number.isSafeInteger(capturedAtMs) ||
    !Number.isSafeInteger(nowMs) ||
    capturedAtMs > nowMs ||
    nowMs - capturedAtMs > DEEP_V3_TRADE_QUOTE_TTL_MS
  ) {
    throw new Error("The Deep V3 canary quote is stale");
  }
  const progress = deepV3CanaryFeeProgress(state);
  if (progress.readyToCompound || state.action === 1) {
    throw new Error(
      "The Deep V3 canary is ready to compound; further test volume is blocked",
    );
  }
  if (state.compounded) {
    throw new Error("The Deep V3 canary already compounded");
  }
  if (
    side === "buy" &&
    (amountIn < DEEP_V3_TRADE_MIN_NATIVE_VOLUME_WEI ||
      amountIn > DEEP_V3_TRADE_MAX_NATIVE_VOLUME_WEI)
  ) {
    throw new Error("The Deep V3 buy exceeds the canary volume bounds");
  }
  const quoteImpact = deepV3QuoteImpactBps({
    side,
    amountIn,
    quotedAmountOut,
    sqrtPriceX96: state.sqrtPriceX96,
  });
  if (quoteImpact.impactBps > DEEP_V3_TRADE_MAX_QUOTE_IMPACT_BPS) {
    throw new Error("The Deep V3 quote exceeds the price-impact cap");
  }
  const expectedFees =
    side === "buy"
      ? deepV3GrowthFeeForGross(amountIn)
      : deepV3GrowthFeeForNetOutput(quotedAmountOut);
  if (
    expectedFees.grossNative < DEEP_V3_TRADE_MIN_NATIVE_VOLUME_WEI ||
    expectedFees.grossNative > DEEP_V3_TRADE_MAX_NATIVE_VOLUME_WEI
  ) {
    throw new Error("The Deep V3 trade exceeds the canary volume bounds");
  }
  const approval = approvalState({
    side,
    amountIn,
    tokenAllowance,
    permit2Allowance,
    permit2Expiration,
    now: BigInt(state.timestamp),
  });
  const deadline =
    BigInt(state.timestamp) + DEEP_V3_TRADE_DEADLINE_SECONDS;
  const transaction =
    approval === "ready"
      ? buildSwapTransaction({
          manifest,
          poolKey: state.poolKey,
          side,
          amountIn,
          quotedAmountOut,
          deadline,
        })
      : buildApprovalTransaction({
          manifest,
          state,
          amountIn,
          approval,
        });
  const remainingAfter =
    expectedFees.growthFee >= progress.remainingGrowthWei
      ? 0n
      : progress.remainingGrowthWei - expectedFees.growthFee;
  return {
    account: state.account,
    token: state.token,
    vault: state.vault,
    poolId: state.poolId,
    poolKey: state.poolKey,
    side,
    amountIn,
    quotedAmountOut,
    quoterGasEstimate: BigInt(quoterGasEstimate),
    quoteBlockNumber: state.blockNumber,
    quoteBlockHash: state.blockHash,
    capturedAtMs,
    deadline,
    approvalState: approval,
    transaction,
    quote: {
      amountOutMinimum:
        transaction.kind === "swap"
          ? transaction.amountOutMinimum
          : amountOutMinimum(quotedAmountOut),
      spotAmountOut: quoteImpact.spotAmountOut,
      impactBps: quoteImpact.impactBps,
    },
    expectedFees,
    progress: {
      ...progress,
      remainingGrowthAfterWei: remainingAfter,
      minimumRemainingGrossVolumeAfterWei:
        deepV3MinimumGrossVolumeForGrowth(remainingAfter),
    },
  };
}

export function assertDeepV3CanaryRequote({
  prepared,
  refreshed,
  nowMs,
}) {
  if (
    !Number.isSafeInteger(nowMs) ||
    nowMs - prepared.capturedAtMs > DEEP_V3_TRADE_QUOTE_TTL_MS
  ) {
    throw new Error("The Deep V3 canary quote is stale");
  }
  if (
    !sameAddress(prepared.account, refreshed.account) ||
    !sameAddress(prepared.token, refreshed.token) ||
    !sameAddress(prepared.vault, refreshed.vault) ||
    normalizeDeepV3Hex(prepared.poolId) !==
      normalizeDeepV3Hex(refreshed.poolId) ||
    prepared.side !== refreshed.side ||
    prepared.amountIn !== refreshed.amountIn ||
    prepared.transaction.kind !== refreshed.transaction.kind
  ) {
    throw new Error("The Deep V3 canary action changed after review");
  }
  if (
    refreshed.quoteBlockNumber < prepared.quoteBlockNumber ||
    refreshed.quotedAmountOut < prepared.quotedAmountOut
  ) {
    throw new Error(
      "The latest Deep V3 quote is worse than the reviewed quote",
    );
  }
  if (
    prepared.transaction.kind !== "swap" &&
    (normalizeDeepV3Hex(prepared.transaction.to) !==
      normalizeDeepV3Hex(refreshed.transaction.to) ||
      normalizeDeepV3Hex(prepared.transaction.data) !==
        normalizeDeepV3Hex(refreshed.transaction.data) ||
      prepared.transaction.value !== refreshed.transaction.value)
  ) {
    throw new Error("The Deep V3 approval changed after review");
  }
}

export function finalizeDeepV3CanaryTradeAction({
  candidate,
  state,
  simulations,
  feePolicy,
}) {
  if (
    !Array.isArray(simulations) ||
    simulations.length !== 2 ||
    simulations.some(
      (simulation) =>
        typeof simulation.callResult !== "string" ||
        !/^0x[0-9a-f]*$/i.test(simulation.callResult),
    ) ||
    normalizeDeepV3Hex(simulations[0].callResult) !==
      normalizeDeepV3Hex(simulations[1].callResult)
  ) {
    throw new Error("Independent Deep V3 trade simulations disagree");
  }
  const estimate = simulations
    .map((simulation) => BigInt(simulation.estimatedGas))
    .reduce((left, right) => (left > right ? left : right));
  if (estimate <= 0n) {
    throw new Error("The Deep V3 trade gas estimate is invalid");
  }
  const gas = ceilDiv(estimate * 120n, 100n);
  if (gas > DEEP_V3_TRADE_GAS_CEILINGS[candidate.transaction.kind]) {
    throw new Error("The Deep V3 trade exceeds its gas ceiling");
  }
  const maxFeePerGas = BigInt(feePolicy.maxFeePerGas);
  const maxPriorityFeePerGas = BigInt(
    feePolicy.maxPriorityFeePerGas,
  );
  if (
    maxFeePerGas <= 0n ||
    maxFeePerGas > DEEP_V3_MAX_FEE_PER_GAS_WEI ||
    maxPriorityFeePerGas < 0n ||
    maxPriorityFeePerGas >
      DEEP_V3_MAX_PRIORITY_FEE_PER_GAS_WEI ||
    maxPriorityFeePerGas > maxFeePerGas
  ) {
    throw new Error("The Deep V3 trade fee envelope is outside policy");
  }
  const maximumDebit =
    gas * maxFeePerGas + candidate.transaction.value;
  const futureGasReserve =
    candidate.side === "buy" &&
    candidate.transaction.kind === "swap"
      ? gas * maxFeePerGas
      : 0n;
  const minimumBalanceRequired = maximumDebit + futureGasReserve;
  if (BigInt(state.balance) < minimumBalanceRequired) {
    throw new Error(
      "The Deep V3 canary wallet balance is below the exact trade envelope",
    );
  }
  const request = {
    from: getAddress(candidate.account),
    to: getAddress(candidate.transaction.to),
    nonce: deepV3Quantity(state.confirmedNonce),
    value: deepV3Quantity(candidate.transaction.value),
    data: candidate.transaction.data,
    gas: deepV3Quantity(gas),
    maxFeePerGas: deepV3Quantity(maxFeePerGas),
    maxPriorityFeePerGas: deepV3Quantity(
      maxPriorityFeePerGas,
    ),
  };
  const preparedDigest = keccak256(
    stringToHex(
      JSON.stringify({
        account: candidate.account,
        token: candidate.token,
        vault: candidate.vault,
        poolId: candidate.poolId,
        side: candidate.side,
        amountIn: candidate.amountIn.toString(),
        quotedAmountOut: candidate.quotedAmountOut.toString(),
        quoteBlockHash: candidate.quoteBlockHash,
        quoteBlockNumber: candidate.quoteBlockNumber,
        capturedAtMs: candidate.capturedAtMs,
        kind: candidate.transaction.kind,
        calldataHash: keccak256(candidate.transaction.data),
        request,
        maximumDebit: maximumDebit.toString(),
        futureGasReserve: futureGasReserve.toString(),
      }),
    ),
  );
  return {
    ...candidate,
    request,
    calldataHash: keccak256(candidate.transaction.data),
    liveEstimatedGas: estimate,
    gasLimit: gas,
    maximumDebit,
    futureGasReserve,
    minimumBalanceRequired,
    preparedDigest,
  };
}

export function publicDeepV3CanaryTradeAction(action) {
  if (!action) return null;
  return {
    action: action.transaction.kind,
    side: action.side,
    account: action.account,
    token: action.token,
    vault: action.vault,
    poolId: action.poolId,
    amountIn: action.amountIn.toString(),
    quotedAmountOut: action.quotedAmountOut.toString(),
    amountOutMinimum: action.quote.amountOutMinimum.toString(),
    quoteImpactBps: action.quote.impactBps,
    quoteBlockNumber: action.quoteBlockNumber,
    quoteBlockHash: action.quoteBlockHash,
    deadline: action.deadline.toString(),
    expectedGrowthFeeWei:
      action.expectedFees.growthFee.toString(),
    expectedProgrammableFeeWei:
      action.expectedFees.programmableFee.toString(),
    expectedGrossNativeVolumeWei:
      action.expectedFees.grossNative.toString(),
    availableGrowthWei:
      action.progress.availableGrowthWei.toString(),
    remainingGrowthWei:
      action.progress.remainingGrowthWei.toString(),
    remainingGrowthAfterWei:
      action.progress.remainingGrowthAfterWei.toString(),
    minimumRemainingGrossVolumeWei:
      action.progress.minimumRemainingGrossVolumeWei.toString(),
    minimumRemainingGrossVolumeAfterWei:
      action.progress.minimumRemainingGrossVolumeAfterWei.toString(),
    calldataHash: action.calldataHash,
    gasLimit: action.gasLimit.toString(),
    maximumDebitWei: action.maximumDebit.toString(),
    futureGasReserveWei: action.futureGasReserve.toString(),
    minimumBalanceRequiredWei:
      action.minimumBalanceRequired.toString(),
    preparedDigest: action.preparedDigest,
    request: action.request,
  };
}
