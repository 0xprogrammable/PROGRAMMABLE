import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  isAddress,
  keccak256,
  parseAbiParameters,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";

import {
  PREDICTION_V2_CHECKPOINT_ABI,
  PREDICTION_V2_POOL_MANAGER_STATE_ABI,
  PREDICTION_V2_VAULT_ABI,
  type PredictionV2PoolKey,
} from "./abi";
import type { PredictionBytes32V2 } from "../prediction-market-assets-v2";
import {
  PREDICTION_V2_BPS_DENOMINATOR,
  PREDICTION_V2_FACE_SCALE,
  PREDICTION_V2_LP_FEE_PIPS,
  PREDICTION_V2_MAX_SQRT_PRICE_X96,
  PREDICTION_V2_MIN_SQRT_PRICE_X96,
  PREDICTION_V2_TICK_SPACING,
  type PredictionV2BuyQuote,
  type PredictionV2SellQuote,
} from "./codec";

export type PredictionV2Outcome = "YES" | "NO";

export type PredictionV2PriceImpact = Readonly<{
  currentProbabilityBps: number;
  postTradeProbabilityBps: number;
  /** Signed change where 100 bps equals one percentage point. */
  probabilityPointDeltaBps: number;
  probabilityPointMagnitudeBps: number;
  /** Relative percentage change in basis points; null at a zero starting probability. */
  relativeImpactBps: number | null;
}>;

export type PredictionV2LiquidityWarning = Readonly<{
  code: "backstop-only";
  message: string;
}> | null;

export type PredictionV2LiquidityAssessment = Readonly<{
  depth: "thin" | "low" | "moderate";
  riskState: "normal" | "warning" | "explicit-confirmation-required";
  priceImpactRiskState: "normal" | "warning" | "explicit-confirmation-required";
  partialFill: boolean;
  warning: PredictionV2LiquidityWarning;
}>;

export type PredictionV2OutcomeTokens = Readonly<{
  yesToken: Address;
  noToken: Address;
}>;

export type PredictionV2BoundMarketState = Readonly<{
  chainId: 4_663;
  vault: Address;
  poolManager: Address;
  poolKey: PredictionV2PoolKey;
  poolId: PredictionBytes32V2;
  poolStateSlot: PredictionBytes32V2;
  checkpoint: Address;
  checkpointTradingHealthy: boolean;
  yesToken: Address;
  noToken: Address;
  currentSqrtPriceX96: bigint;
  currentTick: number;
  poolManagerProtocolFee: number;
  lpFee: number;
  observedBlockNumber: bigint;
  observedBlockHash: PredictionBytes32V2;
  checkpointCall: Readonly<{ to: Address; data: Hex }>;
  checkpointResult: Hex;
  checkpointTradingHealthCall: Readonly<{ to: Address; data: Hex }>;
  checkpointTradingHealthResult: Hex;
  yesTokenCall: Readonly<{ to: Address; data: Hex }>;
  yesTokenResult: Hex;
  noTokenCall: Readonly<{ to: Address; data: Hex }>;
  noTokenResult: Hex;
  slot0Call: Readonly<{ to: Address; data: Hex }>;
  slot0Result: Hex;
}>;

type PredictionV2BoundBuyPreviewQuote = Readonly<{
  chainId: 4_663;
  vault: Address;
  poolKey: PredictionV2PoolKey;
  buyYes: boolean;
  observedBlockNumber: bigint;
  observedBlockHash: PredictionBytes32V2;
  marketState: PredictionV2BoundMarketState;
  quote: PredictionV2BuyQuote;
}>;

type PredictionV2BoundSellPreviewQuote = Readonly<{
  chainId: 4_663;
  vault: Address;
  poolKey: PredictionV2PoolKey;
  sellYes: boolean;
  observedBlockNumber: bigint;
  observedBlockHash: PredictionBytes32V2;
  marketState: PredictionV2BoundMarketState;
  quote: PredictionV2SellQuote;
}>;

export type PredictionV2BuyPreview = Readonly<{
  requestedCollateralAtoms: bigint;
  maximumPaymentAtoms: bigint;
  actualPaymentAtoms: bigint;
  protocolFeeAtoms: bigint;
  totalRefundAtoms: bigint;
  outcomeAtoms: bigint;
  minimumOutcomeAtoms: bigint;
  averageExecutablePriceBps: number;
  maximumSlippagePriceBps: number;
  winningGrossPayoutAtoms: bigint;
  minimumWinningGrossPayoutAtoms: bigint;
  potentialNetProfitAtoms: bigint;
  minimumNetProfitAtoms: bigint;
  maximumLossAtoms: bigint;
  neutralPayoutAtoms: bigint;
  lpFeePips: number;
  poolManagerProtocolFeePips: number;
  priceImpact: PredictionV2PriceImpact;
  liquidity: PredictionV2LiquidityAssessment;
}>;

export type PredictionV2SellPreview = Readonly<{
  outcomeInAtoms: bigint;
  requestedSwapAtoms: bigint;
  grossProceedsAtoms: bigint;
  protocolFeeAtoms: bigint;
  netProceedsAtoms: bigint;
  minimumNetProceedsAtoms: bigint;
  soldOutcomeRefundAtoms: bigint;
  complementOutcomeRefundAtoms: bigint;
  /** Null when complement-token refunds make a cash-only average misleading. */
  averageNetCashExitPriceBps: number | null;
  lpFeePips: number;
  poolManagerProtocolFeePips: number;
  priceImpact: PredictionV2PriceImpact;
  liquidity: PredictionV2LiquidityAssessment;
}>;

function assertSqrtPrice(sqrtPriceX96: bigint) {
  if (
    sqrtPriceX96 < PREDICTION_V2_MIN_SQRT_PRICE_X96 ||
    sqrtPriceX96 > PREDICTION_V2_MAX_SQRT_PRICE_X96
  ) throw new Error("Protocol V2 pool price is outside Uniswap v4 bounds.");
}

function nonzeroAddress(value: unknown, label: string): Address {
  if (
    typeof value !== "string" || !isAddress(value, { strict: false }) ||
    value.toLowerCase() === zeroAddress
  ) throw new Error(`Invalid Protocol V2 ${label}.`);
  return value as Address;
}

function nonzeroBytes32(value: unknown, label: string): PredictionBytes32V2 {
  if (
    typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(value) ||
    /^0x0{64}$/u.test(value)
  ) throw new Error(`Invalid Protocol V2 ${label}.`);
  return value.toLowerCase() as PredictionBytes32V2;
}

function samePoolKey(left: PredictionV2PoolKey, right: PredictionV2PoolKey) {
  return left.currency0.toLowerCase() === right.currency0.toLowerCase() &&
    left.currency1.toLowerCase() === right.currency1.toLowerCase() &&
    left.fee === right.fee && left.tickSpacing === right.tickSpacing &&
    left.hooks.toLowerCase() === right.hooks.toLowerCase();
}

function validatePoolKey(poolKey: PredictionV2PoolKey): PredictionV2PoolKey {
  const currency0 = nonzeroAddress(poolKey.currency0, "currency0");
  const currency1 = nonzeroAddress(poolKey.currency1, "currency1");
  const hooks = nonzeroAddress(poolKey.hooks, "hook");
  if (currency0.toLowerCase() === currency1.toLowerCase()) {
    throw new Error("Invalid Protocol V2 pool currencies.");
  }
  if (
    poolKey.fee !== PREDICTION_V2_LP_FEE_PIPS ||
    poolKey.tickSpacing !== PREDICTION_V2_TICK_SPACING
  ) {
    throw new Error("Invalid Protocol V2 pool configuration.");
  }
  return { currency0, currency1, fee: poolKey.fee, tickSpacing: poolKey.tickSpacing, hooks };
}

export function predictionV2PoolId(poolKeyInput: PredictionV2PoolKey): PredictionBytes32V2 {
  const poolKey = validatePoolKey(poolKeyInput);
  return keccak256(encodeAbiParameters(
    parseAbiParameters("address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks"),
    [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
  )) as PredictionBytes32V2;
}

export function predictionV2PoolStateSlot(
  poolKey: PredictionV2PoolKey,
): PredictionBytes32V2 {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("bytes32 poolId, uint256 poolsSlot"),
    [predictionV2PoolId(poolKey), 6n],
  )) as PredictionBytes32V2;
}

export function encodePredictionV2VaultYesTokenCall(): Hex {
  return encodeFunctionData({ abi: PREDICTION_V2_VAULT_ABI, functionName: "yesToken" });
}

export function encodePredictionV2VaultNoTokenCall(): Hex {
  return encodeFunctionData({ abi: PREDICTION_V2_VAULT_ABI, functionName: "noToken" });
}

export function encodePredictionV2VaultCheckpointCall(): Hex {
  return encodeFunctionData({ abi: PREDICTION_V2_VAULT_ABI, functionName: "checkpoint" });
}

export function encodePredictionV2CheckpointTradingHealthCall(): Hex {
  return encodeFunctionData({ abi: PREDICTION_V2_CHECKPOINT_ABI, functionName: "isTradingHealthy" });
}

export function encodePredictionV2PoolSlot0Call(poolKey: PredictionV2PoolKey): Hex {
  return encodeFunctionData({
    abi: PREDICTION_V2_POOL_MANAGER_STATE_ABI,
    functionName: "extsload",
    args: [predictionV2PoolStateSlot(poolKey)],
  });
}

function decodeVaultAddressResult(
  data: Hex,
  functionName: "checkpoint" | "yesToken" | "noToken",
) {
  if (!/^0x0{24}[0-9a-fA-F]{40}$/u.test(data)) {
    throw new Error(`Invalid Protocol V2 Vault ${functionName} result.`);
  }
  try {
    return nonzeroAddress(decodeFunctionResult({
      abi: PREDICTION_V2_VAULT_ABI,
      functionName,
      data,
    }), `Vault ${functionName} result`);
  } catch {
    throw new Error(`Invalid Protocol V2 Vault ${functionName} result.`);
  }
}

function decodeCheckpointTradingHealthResult(data: Hex) {
  if (!/^0x(?:0{64}|0{63}1)$/u.test(data)) {
    throw new Error("Invalid Protocol V2 checkpoint trading-health result.");
  }
  try {
    return decodeFunctionResult({
      abi: PREDICTION_V2_CHECKPOINT_ABI,
      functionName: "isTradingHealthy",
      data,
    });
  } catch {
    throw new Error("Invalid Protocol V2 checkpoint trading-health result.");
  }
}

function decodePoolSlot0Result(data: Hex) {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(data)) {
    throw new Error("Invalid Protocol V2 slot0 result.");
  }
  let rawWord: Hex;
  try {
    rawWord = decodeFunctionResult({
      abi: PREDICTION_V2_POOL_MANAGER_STATE_ABI,
      functionName: "extsload",
      data,
    });
  } catch {
    throw new Error("Invalid Protocol V2 slot0 result.");
  }
  const packed = BigInt(rawWord);
  if (packed >> 232n !== 0n) {
    throw new Error("Invalid Protocol V2 slot0 reserved bits.");
  }
  const currentSqrtPriceX96 = packed & ((1n << 160n) - 1n);
  const unsignedTick = Number((packed >> 160n) & 0xff_ffffn);
  const currentTick = unsignedTick >= 0x80_0000 ? unsignedTick - 0x100_0000 : unsignedTick;
  const poolManagerProtocolFee = Number((packed >> 184n) & 0xff_ffffn);
  const lpFee = Number((packed >> 208n) & 0xff_ffffn);
  assertSqrtPrice(currentSqrtPriceX96);
  predictionV2DirectionalPoolManagerFeePips(poolManagerProtocolFee, true);
  predictionV2DirectionalPoolManagerFeePips(poolManagerProtocolFee, false);
  if (lpFee !== PREDICTION_V2_LP_FEE_PIPS) {
    throw new Error("Invalid Protocol V2 slot0 LP fee.");
  }
  return { currentSqrtPriceX96, currentTick, poolManagerProtocolFee, lpFee };
}

/**
 * Reconstructs and decodes every raw eth_call. The orchestrator must execute
 * all five calls at observedBlockNumber and verify observedBlockHash.
 */
export function bindPredictionV2MarketState(
  input: PredictionV2BoundMarketState,
): PredictionV2BoundMarketState {
  if (input.chainId !== 4_663) throw new Error("Invalid Protocol V2 market-state chain.");
  const vault = nonzeroAddress(input.vault, "market-state Vault");
  const poolManager = nonzeroAddress(input.poolManager, "market-state PoolManager");
  const poolKey = validatePoolKey(input.poolKey);
  if (input.observedBlockNumber <= 0n) {
    throw new Error("Invalid Protocol V2 market-state block number.");
  }
  const observedBlockHash = nonzeroBytes32(input.observedBlockHash, "market-state block hash");
  const checkpointTarget = nonzeroAddress(input.checkpointCall.to, "checkpoint call target");
  const yesTarget = nonzeroAddress(input.yesTokenCall.to, "yesToken call target");
  const noTarget = nonzeroAddress(input.noTokenCall.to, "noToken call target");
  const slot0Target = nonzeroAddress(input.slot0Call.to, "slot0 call target");
  if (
    checkpointTarget.toLowerCase() !== vault.toLowerCase() ||
    input.checkpointCall.data !== encodePredictionV2VaultCheckpointCall() ||
    yesTarget.toLowerCase() !== vault.toLowerCase() ||
    noTarget.toLowerCase() !== vault.toLowerCase() ||
    input.yesTokenCall.data !== encodePredictionV2VaultYesTokenCall() ||
    input.noTokenCall.data !== encodePredictionV2VaultNoTokenCall()
  ) throw new Error("Invalid Protocol V2 outcome-token call binding.");
  const checkpoint = decodeVaultAddressResult(input.checkpointResult, "checkpoint");
  const checkpointHealthTarget = nonzeroAddress(
    input.checkpointTradingHealthCall.to,
    "checkpoint trading-health call target",
  );
  if (
    checkpointHealthTarget.toLowerCase() !== checkpoint.toLowerCase() ||
    input.checkpointTradingHealthCall.data !== encodePredictionV2CheckpointTradingHealthCall()
  ) throw new Error("Invalid Protocol V2 checkpoint trading-health call binding.");
  const checkpointTradingHealthy = decodeCheckpointTradingHealthResult(
    input.checkpointTradingHealthResult,
  );
  const yesToken = decodeVaultAddressResult(input.yesTokenResult, "yesToken");
  const noToken = decodeVaultAddressResult(input.noTokenResult, "noToken");
  tradeOrientation(poolKey, { yesToken, noToken }, "YES", "BUY");

  const poolId = predictionV2PoolId(poolKey);
  const poolStateSlot = predictionV2PoolStateSlot(poolKey);
  const suppliedPoolId = nonzeroBytes32(input.poolId, "supplied pool id");
  const suppliedPoolStateSlot = nonzeroBytes32(
    input.poolStateSlot,
    "supplied pool state slot",
  );
  const suppliedYesToken = nonzeroAddress(input.yesToken, "supplied yesToken");
  const suppliedNoToken = nonzeroAddress(input.noToken, "supplied noToken");
  const suppliedCheckpoint = nonzeroAddress(input.checkpoint, "supplied checkpoint");
  if (
    slot0Target.toLowerCase() !== poolManager.toLowerCase() ||
    input.slot0Call.data !== encodePredictionV2PoolSlot0Call(poolKey)
  ) throw new Error("Invalid Protocol V2 slot0 call binding.");
  const slot0 = decodePoolSlot0Result(input.slot0Result);
  if (
    suppliedPoolId !== poolId ||
    suppliedPoolStateSlot !== poolStateSlot ||
    suppliedCheckpoint.toLowerCase() !== checkpoint.toLowerCase() ||
    input.checkpointTradingHealthy !== checkpointTradingHealthy ||
    suppliedYesToken.toLowerCase() !== yesToken.toLowerCase() ||
    suppliedNoToken.toLowerCase() !== noToken.toLowerCase() ||
    input.currentSqrtPriceX96 !== slot0.currentSqrtPriceX96 ||
    input.currentTick !== slot0.currentTick ||
    input.poolManagerProtocolFee !== slot0.poolManagerProtocolFee ||
    input.lpFee !== slot0.lpFee
  ) throw new Error("Invalid Protocol V2 decoded market-state binding.");
  return {
    chainId: 4_663,
    vault,
    poolManager,
    poolKey,
    poolId,
    poolStateSlot,
    checkpoint,
    checkpointTradingHealthy,
    yesToken,
    noToken,
    currentSqrtPriceX96: slot0.currentSqrtPriceX96,
    currentTick: slot0.currentTick,
    poolManagerProtocolFee: slot0.poolManagerProtocolFee,
    lpFee: slot0.lpFee,
    observedBlockNumber: input.observedBlockNumber,
    observedBlockHash,
    checkpointCall: { to: checkpointTarget, data: input.checkpointCall.data },
    checkpointResult: input.checkpointResult,
    checkpointTradingHealthCall: {
      to: checkpointHealthTarget,
      data: input.checkpointTradingHealthCall.data,
    },
    checkpointTradingHealthResult: input.checkpointTradingHealthResult,
    yesTokenCall: { to: yesTarget, data: input.yesTokenCall.data },
    yesTokenResult: input.yesTokenResult,
    noTokenCall: { to: noTarget, data: input.noTokenCall.data },
    noTokenResult: input.noTokenResult,
    slot0Call: { to: slot0Target, data: input.slot0Call.data },
    slot0Result: input.slot0Result,
  };
}

function roundedRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) {
    throw new Error("Invalid Protocol V2 ratio.");
  }
  return (numerator + denominator / 2n) / denominator;
}

export function predictionV2YesProbabilityBps(
  sqrtPriceX96: bigint,
  yesIsCurrency0: boolean,
): number {
  assertSqrtPrice(sqrtPriceX96);
  const q192 = 1n << 192n;
  const squared = sqrtPriceX96 * sqrtPriceX96;
  const denominator = q192 + squared;
  const numerator = yesIsCurrency0 ? squared : q192;
  return Number(roundedRatio(numerator * PREDICTION_V2_BPS_DENOMINATOR, denominator));
}

export function predictionV2DirectionalPoolManagerFeePips(
  packedProtocolFee: number,
  zeroForOne: boolean,
): number {
  if (!Number.isInteger(packedProtocolFee) || packedProtocolFee < 0 || packedProtocolFee > 0xff_ffff) {
    throw new Error("Invalid Protocol V2 PoolManager fee.");
  }
  const fee = zeroForOne ? packedProtocolFee & 0xfff : packedProtocolFee >> 12;
  if (fee > 1_000) throw new Error("Invalid Protocol V2 directional PoolManager fee.");
  return fee;
}

export function predictionV2SlippageFloor(amount: bigint, slippageBps: number): bigint {
  if (amount <= 0n || !Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 1_000) {
    throw new Error("Invalid Protocol V2 slippage boundary.");
  }
  const result = (amount * (PREDICTION_V2_BPS_DENOMINATOR - BigInt(slippageBps))) /
    PREDICTION_V2_BPS_DENOMINATOR;
  return result > 0n ? result : 1n;
}

function outcomeProbability(yesProbabilityBps: number, outcome: PredictionV2Outcome) {
  return outcome === "YES" ? yesProbabilityBps : 10_000 - yesProbabilityBps;
}

export function predictionV2PriceImpact(
  currentSqrtPriceX96: bigint,
  postTradeSqrtPriceX96: bigint,
  yesIsCurrency0: boolean,
  outcome: PredictionV2Outcome,
): PredictionV2PriceImpact {
  const currentProbabilityBps = outcomeProbability(
    predictionV2YesProbabilityBps(currentSqrtPriceX96, yesIsCurrency0),
    outcome,
  );
  const postTradeProbabilityBps = outcomeProbability(
    predictionV2YesProbabilityBps(postTradeSqrtPriceX96, yesIsCurrency0),
    outcome,
  );
  const probabilityPointDeltaBps = postTradeProbabilityBps - currentProbabilityBps;
  const probabilityPointMagnitudeBps = Math.abs(probabilityPointDeltaBps);
  const relativeImpactBps = currentProbabilityBps === 0
    ? null
    : Math.round(probabilityPointMagnitudeBps * 10_000 / currentProbabilityBps);
  return {
    currentProbabilityBps,
    postTradeProbabilityBps,
    probabilityPointDeltaBps,
    probabilityPointMagnitudeBps,
    relativeImpactBps,
  };
}

function executablePriceBps(paymentAtoms: bigint, outcomeAtoms: bigint): number {
  const facePayoutAtoms = outcomeAtoms * PREDICTION_V2_FACE_SCALE;
  if (paymentAtoms <= 0n || facePayoutAtoms <= 0n) {
    throw new Error("Invalid Protocol V2 executable price.");
  }
  return Number(roundedRatio(
    paymentAtoms * PREDICTION_V2_BPS_DENOMINATOR,
    facePayoutAtoms,
  ));
}

function tradeOrientation(
  poolKey: PredictionV2PoolKey,
  outcomeTokens: PredictionV2OutcomeTokens,
  outcome: PredictionV2Outcome,
  action: "BUY" | "SELL",
) {
  const yesToken = outcomeTokens.yesToken;
  const noToken = outcomeTokens.noToken;
  if (
    !isAddress(yesToken, { strict: false }) || !isAddress(noToken, { strict: false }) ||
    yesToken.toLowerCase() === zeroAddress || noToken.toLowerCase() === zeroAddress ||
    yesToken.toLowerCase() === noToken.toLowerCase()
  ) throw new Error("Invalid Protocol V2 outcome-token binding.");

  const currency0 = poolKey.currency0.toLowerCase();
  const currency1 = poolKey.currency1.toLowerCase();
  const yes = yesToken.toLowerCase();
  const no = noToken.toLowerCase();
  if (!((currency0 === yes && currency1 === no) || (currency0 === no && currency1 === yes))) {
    throw new Error("Protocol V2 outcome tokens do not match the bound pool.");
  }

  const yesIsCurrency0 = currency0 === yes;
  const selectedIsCurrency0 = outcome === "YES" ? yesIsCurrency0 : !yesIsCurrency0;
  return {
    yesIsCurrency0,
    selectedIsCurrency0,
    // BUY swaps the unwanted complement into the selected outcome. SELL swaps the selected outcome out.
    zeroForOne: action === "BUY" ? !selectedIsCurrency0 : selectedIsCurrency0,
  };
}

export function predictionV2PriceImpactRiskState(
  probabilityPointMagnitudeBps: number,
): PredictionV2LiquidityAssessment["priceImpactRiskState"] {
  if (!Number.isInteger(probabilityPointMagnitudeBps) || probabilityPointMagnitudeBps < 0) {
    throw new Error("Invalid Protocol V2 price-impact magnitude.");
  }
  return probabilityPointMagnitudeBps >= 500
    ? "explicit-confirmation-required"
    : probabilityPointMagnitudeBps >= 200
    ? "warning"
    : "normal";
}

export function requirePredictionV2PriceImpactConfirmation(
  probabilityPointMagnitudeBps: number,
  explicitlyConfirmed: boolean,
) {
  const riskState = predictionV2PriceImpactRiskState(probabilityPointMagnitudeBps);
  if (riskState === "explicit-confirmation-required" && explicitlyConfirmed !== true) {
    throw new Error("Invalid Protocol V2 explicit price-impact confirmation.");
  }
}

function liquidityAssessment(
  partialFill: boolean,
  priceImpact: PredictionV2PriceImpact,
): PredictionV2LiquidityAssessment {
  const priceImpactRiskState = predictionV2PriceImpactRiskState(
    priceImpact.probabilityPointMagnitudeBps,
  );
  return {
    // Exact live-depth evidence needs a future reviewed binder; callers cannot upgrade this label.
    depth: "thin",
    riskState: priceImpactRiskState === "explicit-confirmation-required"
      ? "explicit-confirmation-required"
      : "warning",
    priceImpactRiskState,
    partialFill,
    warning: {
      code: "backstop-only",
      message: "Only the 2 USDG protocol backstop is currently evidenced for this market.",
    },
  };
}

function previewMarketState(
  boundQuote: PredictionV2BoundBuyPreviewQuote | PredictionV2BoundSellPreviewQuote,
) {
  const state = bindPredictionV2MarketState(boundQuote.marketState);
  const quoteVault = nonzeroAddress(boundQuote.vault, "preview Vault");
  const quotePoolKey = validatePoolKey(boundQuote.poolKey);
  const quoteBlockHash = nonzeroBytes32(boundQuote.observedBlockHash, "preview block hash");
  if (
    boundQuote.chainId !== 4_663 ||
    state.chainId !== boundQuote.chainId ||
    state.vault.toLowerCase() !== quoteVault.toLowerCase() ||
    !samePoolKey(state.poolKey, quotePoolKey) ||
    state.observedBlockNumber !== boundQuote.observedBlockNumber ||
    state.observedBlockHash !== quoteBlockHash
  ) throw new Error("Invalid Protocol V2 quote/market-state binding.");
  if (
    boundQuote.quote.swap.lpFee !== state.lpFee ||
    boundQuote.quote.swap.poolManagerProtocolFee !== state.poolManagerProtocolFee
  ) throw new Error("Invalid Protocol V2 quote/slot0 fee binding.");
  return state;
}

function assertSelectedProbabilityDirection(
  action: "BUY" | "SELL",
  zeroForOne: boolean,
  currentSqrtPriceX96: bigint,
  postTradeSqrtPriceX96: bigint,
  priceImpact: PredictionV2PriceImpact,
) {
  const sqrtDirectionIsValid = zeroForOne
    ? postTradeSqrtPriceX96 <= currentSqrtPriceX96
    : postTradeSqrtPriceX96 >= currentSqrtPriceX96;
  const probabilityDirectionIsValid = action === "BUY"
    ? priceImpact.probabilityPointDeltaBps >= 0
    : priceImpact.probabilityPointDeltaBps <= 0;
  if (!sqrtDirectionIsValid || !probabilityDirectionIsValid) {
    throw new Error(`Invalid Protocol V2 ${action.toLowerCase()} selected-probability direction.`);
  }
}

export function predictionV2BuyPreview(input: Readonly<{
  boundQuote: PredictionV2BoundBuyPreviewQuote;
  slippageBps: number;
}>): PredictionV2BuyPreview {
  const quote = input.boundQuote.quote;
  const marketState = previewMarketState(input.boundQuote);
  const outcome: PredictionV2Outcome = input.boundQuote.buyYes ? "YES" : "NO";
  const orientation = tradeOrientation(
    input.boundQuote.poolKey,
    { yesToken: marketState.yesToken, noToken: marketState.noToken },
    outcome,
    "BUY",
  );
  const minimumOutcomeAtoms = predictionV2SlippageFloor(quote.outcomeAtoms, input.slippageBps);
  const priceImpact = predictionV2PriceImpact(
    marketState.currentSqrtPriceX96,
    quote.swap.sqrtPriceX96After,
    orientation.yesIsCurrency0,
    outcome,
  );
  assertSelectedProbabilityDirection(
    "BUY",
    orientation.zeroForOne,
    marketState.currentSqrtPriceX96,
    quote.swap.sqrtPriceX96After,
    priceImpact,
  );
  const winningGrossPayoutAtoms = quote.outcomeAtoms * PREDICTION_V2_FACE_SCALE;
  const minimumWinningGrossPayoutAtoms = minimumOutcomeAtoms * PREDICTION_V2_FACE_SCALE;
  const totalRefundAtoms = quote.collateralRefundAtoms + quote.feeReserveRefundAtoms;
  return {
    requestedCollateralAtoms: quote.requestedCollateralAtoms,
    maximumPaymentAtoms: quote.maximumPaymentAtoms,
    actualPaymentAtoms: quote.actualPaymentAtoms,
    protocolFeeAtoms: quote.protocolFeeAtoms,
    totalRefundAtoms,
    outcomeAtoms: quote.outcomeAtoms,
    minimumOutcomeAtoms,
    averageExecutablePriceBps: executablePriceBps(quote.actualPaymentAtoms, quote.outcomeAtoms),
    maximumSlippagePriceBps: executablePriceBps(quote.maximumPaymentAtoms, minimumOutcomeAtoms),
    winningGrossPayoutAtoms,
    minimumWinningGrossPayoutAtoms,
    potentialNetProfitAtoms: winningGrossPayoutAtoms - quote.actualPaymentAtoms,
    minimumNetProfitAtoms: minimumWinningGrossPayoutAtoms - quote.maximumPaymentAtoms,
    maximumLossAtoms: quote.maximumPaymentAtoms,
    neutralPayoutAtoms: winningGrossPayoutAtoms / 2n,
    lpFeePips: quote.swap.lpFee,
    poolManagerProtocolFeePips: predictionV2DirectionalPoolManagerFeePips(
      quote.swap.poolManagerProtocolFee,
      orientation.zeroForOne,
    ),
    priceImpact,
    liquidity: liquidityAssessment(
      quote.executedCollateralAtoms < quote.requestedCollateralAtoms,
      priceImpact,
    ),
  };
}

export function predictionV2SellPreview(input: Readonly<{
  boundQuote: PredictionV2BoundSellPreviewQuote;
  slippageBps: number;
}>): PredictionV2SellPreview {
  const quote = input.boundQuote.quote;
  const marketState = previewMarketState(input.boundQuote);
  const outcome: PredictionV2Outcome = input.boundQuote.sellYes ? "YES" : "NO";
  const orientation = tradeOrientation(
    input.boundQuote.poolKey,
    { yesToken: marketState.yesToken, noToken: marketState.noToken },
    outcome,
    "SELL",
  );
  const minimumNetProceedsAtoms = predictionV2SlippageFloor(
    quote.netCollateralAtoms,
    input.slippageBps,
  );
  const priceImpact = predictionV2PriceImpact(
    marketState.currentSqrtPriceX96,
    quote.swap.sqrtPriceX96After,
    orientation.yesIsCurrency0,
    outcome,
  );
  assertSelectedProbabilityDirection(
    "SELL",
    orientation.zeroForOne,
    marketState.currentSqrtPriceX96,
    quote.swap.sqrtPriceX96After,
    priceImpact,
  );
  const consumedSelectedOutcomeAtoms = quote.outcomeInAtoms - quote.soldRefundAtoms;
  if (consumedSelectedOutcomeAtoms <= 0n) {
    throw new Error("Invalid Protocol V2 sell consumption.");
  }
  return {
    outcomeInAtoms: quote.outcomeInAtoms,
    requestedSwapAtoms: quote.requestedSwapAtoms,
    grossProceedsAtoms: quote.grossCollateralAtoms,
    protocolFeeAtoms: quote.protocolFeeAtoms,
    netProceedsAtoms: quote.netCollateralAtoms,
    minimumNetProceedsAtoms,
    soldOutcomeRefundAtoms: quote.soldRefundAtoms,
    complementOutcomeRefundAtoms: quote.complementRefundAtoms,
    averageNetCashExitPriceBps: quote.complementRefundAtoms === 0n
      ? executablePriceBps(quote.netCollateralAtoms, consumedSelectedOutcomeAtoms)
      : null,
    lpFeePips: quote.swap.lpFee,
    poolManagerProtocolFeePips: predictionV2DirectionalPoolManagerFeePips(
      quote.swap.poolManagerProtocolFee,
      orientation.zeroForOne,
    ),
    priceImpact,
    liquidity: liquidityAssessment(
      quote.swap.actualInput < quote.requestedSwapAtoms,
      priceImpact,
    ),
  };
}
