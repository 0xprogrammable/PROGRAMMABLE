import {
  PREDICTION_V2_BPS_DENOMINATOR,
  PREDICTION_V2_FACE_SCALE,
  PREDICTION_V2_MAX_SQRT_PRICE_X96,
  PREDICTION_V2_MIN_SQRT_PRICE_X96,
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
  code:
    | "backstop-only"
    | "partial-fill"
    | "price-impact-warning"
    | "large-price-impact";
  message: string;
}> | null;

export type PredictionV2LiquidityAssessment = Readonly<{
  depth: "thin" | "low" | "moderate";
  riskState: "normal" | "warning" | "explicit-confirmation-required";
  warning: PredictionV2LiquidityWarning;
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

function liquidityAssessment(
  liquidityEvidence: "factory-backstop-only" | "verified-live-depth",
  partialFill: boolean,
  priceImpact: PredictionV2PriceImpact,
): PredictionV2LiquidityAssessment {
  if (
    liquidityEvidence !== "factory-backstop-only" &&
    liquidityEvidence !== "verified-live-depth"
  ) throw new Error("Invalid Protocol V2 liquidity evidence.");
  const requiresExplicitConfirmation =
    priceImpact.probabilityPointMagnitudeBps >= 500;
  if (liquidityEvidence === "factory-backstop-only") {
    return {
      depth: "thin",
      riskState: requiresExplicitConfirmation
        ? "explicit-confirmation-required"
        : "warning",
      warning: {
        code: "backstop-only",
        message: "Only the 2 USDG protocol backstop is currently evidenced for this market.",
      },
    };
  }
  if (partialFill) {
    return {
      depth: "thin",
      riskState: requiresExplicitConfirmation
        ? "explicit-confirmation-required"
        : "warning",
      warning: {
        code: "partial-fill",
        message: "The price boundary limits this quote; the unused amount is refunded.",
      },
    };
  }
  if (priceImpact.probabilityPointMagnitudeBps >= 500) {
    return {
      depth: "thin",
      riskState: "explicit-confirmation-required",
      warning: {
        code: "large-price-impact",
        message: "This trade moves the quoted probability by at least 5 percentage points.",
      },
    };
  }
  if (priceImpact.probabilityPointMagnitudeBps >= 200) {
    return {
      depth: "low",
      riskState: "warning",
      warning: {
        code: "price-impact-warning",
        message: "This trade moves the quoted probability by at least 2 percentage points.",
      },
    };
  }
  return {
    depth: "moderate",
    riskState: "normal",
    warning: null,
  };
}

export function predictionV2BuyPreview(input: Readonly<{
  quote: PredictionV2BuyQuote;
  slippageBps: number;
  currentSqrtPriceX96: bigint;
  yesIsCurrency0: boolean;
  zeroForOne: boolean;
  outcome: PredictionV2Outcome;
  /** Defaults must remain backstop-only until an exact live-depth read is integrated. */
  liquidityEvidence: "factory-backstop-only" | "verified-live-depth";
}>): PredictionV2BuyPreview {
  const minimumOutcomeAtoms = predictionV2SlippageFloor(
    input.quote.outcomeAtoms,
    input.slippageBps,
  );
  const priceImpact = predictionV2PriceImpact(
    input.currentSqrtPriceX96,
    input.quote.swap.sqrtPriceX96After,
    input.yesIsCurrency0,
    input.outcome,
  );
  const winningGrossPayoutAtoms = input.quote.outcomeAtoms * PREDICTION_V2_FACE_SCALE;
  const minimumWinningGrossPayoutAtoms = minimumOutcomeAtoms * PREDICTION_V2_FACE_SCALE;
  const totalRefundAtoms = input.quote.collateralRefundAtoms +
    input.quote.feeReserveRefundAtoms;
  return {
    requestedCollateralAtoms: input.quote.requestedCollateralAtoms,
    maximumPaymentAtoms: input.quote.maximumPaymentAtoms,
    actualPaymentAtoms: input.quote.actualPaymentAtoms,
    protocolFeeAtoms: input.quote.protocolFeeAtoms,
    totalRefundAtoms,
    outcomeAtoms: input.quote.outcomeAtoms,
    minimumOutcomeAtoms,
    averageExecutablePriceBps: executablePriceBps(
      input.quote.actualPaymentAtoms,
      input.quote.outcomeAtoms,
    ),
    maximumSlippagePriceBps: executablePriceBps(
      input.quote.maximumPaymentAtoms,
      minimumOutcomeAtoms,
    ),
    winningGrossPayoutAtoms,
    minimumWinningGrossPayoutAtoms,
    potentialNetProfitAtoms: winningGrossPayoutAtoms - input.quote.actualPaymentAtoms,
    minimumNetProfitAtoms: minimumWinningGrossPayoutAtoms - input.quote.maximumPaymentAtoms,
    maximumLossAtoms: input.quote.maximumPaymentAtoms,
    neutralPayoutAtoms: winningGrossPayoutAtoms / 2n,
    lpFeePips: input.quote.swap.lpFee,
    poolManagerProtocolFeePips: predictionV2DirectionalPoolManagerFeePips(
      input.quote.swap.poolManagerProtocolFee,
      input.zeroForOne,
    ),
    priceImpact,
    liquidity: liquidityAssessment(
      input.liquidityEvidence,
      input.quote.executedCollateralAtoms < input.quote.requestedCollateralAtoms,
      priceImpact,
    ),
  };
}

export function predictionV2SellPreview(input: Readonly<{
  quote: PredictionV2SellQuote;
  slippageBps: number;
  currentSqrtPriceX96: bigint;
  yesIsCurrency0: boolean;
  zeroForOne: boolean;
  outcome: PredictionV2Outcome;
  /** Defaults must remain backstop-only until an exact live-depth read is integrated. */
  liquidityEvidence: "factory-backstop-only" | "verified-live-depth";
}>): PredictionV2SellPreview {
  const minimumNetProceedsAtoms = predictionV2SlippageFloor(
    input.quote.netCollateralAtoms,
    input.slippageBps,
  );
  const priceImpact = predictionV2PriceImpact(
    input.currentSqrtPriceX96,
    input.quote.swap.sqrtPriceX96After,
    input.yesIsCurrency0,
    input.outcome,
  );
  const consumedSelectedOutcomeAtoms = input.quote.outcomeInAtoms -
    input.quote.soldRefundAtoms;
  if (consumedSelectedOutcomeAtoms <= 0n) {
    throw new Error("Invalid Protocol V2 sell consumption.");
  }
  return {
    outcomeInAtoms: input.quote.outcomeInAtoms,
    requestedSwapAtoms: input.quote.requestedSwapAtoms,
    grossProceedsAtoms: input.quote.grossCollateralAtoms,
    protocolFeeAtoms: input.quote.protocolFeeAtoms,
    netProceedsAtoms: input.quote.netCollateralAtoms,
    minimumNetProceedsAtoms,
    soldOutcomeRefundAtoms: input.quote.soldRefundAtoms,
    complementOutcomeRefundAtoms: input.quote.complementRefundAtoms,
    averageNetCashExitPriceBps: input.quote.complementRefundAtoms === 0n
      ? executablePriceBps(
        input.quote.netCollateralAtoms,
        consumedSelectedOutcomeAtoms,
      )
      : null,
    lpFeePips: input.quote.swap.lpFee,
    poolManagerProtocolFeePips: predictionV2DirectionalPoolManagerFeePips(
      input.quote.swap.poolManagerProtocolFee,
      input.zeroForOne,
    ),
    priceImpact,
    liquidity: liquidityAssessment(
      input.liquidityEvidence,
      input.quote.swap.actualInput < input.quote.requestedSwapAtoms,
      priceImpact,
    ),
  };
}
