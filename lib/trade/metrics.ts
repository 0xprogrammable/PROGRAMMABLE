import { parseUnits } from "viem";

const BASIS_POINTS = 10_000n;
const ETH_DECIMALS = 18;
const MAX_NATIVE_HOOK_SWAP_FEE_BPS = 1_000;

export type NativeHookTradeCostBreakdown = Readonly<{
  hookSwapFeeBps: bigint;
  curvePriceImpactBps: bigint;
  totalExecutionCostBps: bigint;
}>;

function positiveInteger(value: string) {
  return /^[1-9]\d*$/.test(value) ? BigInt(value) : null;
}

function roundedBasisPoints(numerator: bigint, denominator: bigint) {
  if (numerator <= 0n || denominator <= 0n) return 0n;
  return (numerator * BASIS_POINTS + denominator / 2n) / denominator;
}

function positiveDifference(left: bigint, right: bigint) {
  return left > right ? left - right : 0n;
}

/**
 * Splits execution cost from the native-asset return-delta hook fee without
 * converting any amount or price through floating-point numbers.
 */
export function calculateNativeHookTradeCosts(input: {
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  tokenDecimals: number;
  tokenPriceEth?: string;
  hookSwapFeeBps: number;
}): NativeHookTradeCostBreakdown | null {
  if (
    !Number.isInteger(input.tokenDecimals) ||
    input.tokenDecimals < 0 ||
    input.tokenDecimals > 255 ||
    !Number.isInteger(input.hookSwapFeeBps) ||
    input.hookSwapFeeBps < 0 ||
    input.hookSwapFeeBps > MAX_NATIVE_HOOK_SWAP_FEE_BPS ||
    !input.tokenPriceEth ||
    !/^\d+(?:\.\d+)?$/.test(input.tokenPriceEth)
  ) {
    return null;
  }

  const amountIn = positiveInteger(input.amountIn);
  const amountOut = positiveInteger(input.amountOut);
  if (amountIn === null || amountOut === null) return null;

  let spotPriceWei: bigint;
  try {
    spotPriceWei = parseUnits(input.tokenPriceEth, ETH_DECIMALS);
  } catch {
    return null;
  }
  if (spotPriceWei <= 0n) return null;

  const tokenScale = 10n ** BigInt(input.tokenDecimals);
  const feeBps = BigInt(input.hookSwapFeeBps);

  if (input.side === "buy") {
    const hookFeeWei = (amountIn * feeBps) / BASIS_POINTS;
    const curveInputWei = amountIn - hookFeeWei;
    const spotOutputValue = amountOut * spotPriceWei;
    const curveInputValue = curveInputWei * tokenScale;
    const totalInputValue = amountIn * tokenScale;

    return {
      hookSwapFeeBps: feeBps,
      curvePriceImpactBps: roundedBasisPoints(
        positiveDifference(curveInputValue, spotOutputValue),
        spotOutputValue,
      ),
      totalExecutionCostBps: roundedBasisPoints(
        positiveDifference(totalInputValue, spotOutputValue),
        spotOutputValue,
      ),
    };
  }

  const feeAdjustedBps = BASIS_POINTS - feeBps;
  if (feeAdjustedBps <= 0n) return null;

  // The sell quote is net of the hook fee. Keeping the fee ratio as a
  // fraction avoids inventing a rounded gross-output wei amount.
  const spotOutputValueWithFeeScale =
    amountIn * spotPriceWei * feeAdjustedBps;
  const curveOutputValueWithFeeScale =
    amountOut * BASIS_POINTS * tokenScale;
  const spotOutputValue = amountIn * spotPriceWei;
  const netOutputValue = amountOut * tokenScale;

  return {
    hookSwapFeeBps: feeBps,
    curvePriceImpactBps: roundedBasisPoints(
      positiveDifference(
        spotOutputValueWithFeeScale,
        curveOutputValueWithFeeScale,
      ),
      spotOutputValueWithFeeScale,
    ),
    totalExecutionCostBps: roundedBasisPoints(
      positiveDifference(spotOutputValue, netOutputValue),
      spotOutputValue,
    ),
  };
}

export function formatFixedBasisPoints(value: bigint | number) {
  const basisPoints = typeof value === "bigint" ? value : BigInt(value);
  if (basisPoints < 0n) throw new Error("Basis points cannot be negative");
  const whole = basisPoints / 100n;
  const fraction = basisPoints % 100n;
  return fraction === 0n
    ? `${whole}%`
    : `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}%`;
}
