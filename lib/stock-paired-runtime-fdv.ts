import { parseEther } from "viem";

import { STOCK_PAIRED_V3_CONFIG } from "./stock-paired-v3";

const BASIS_POINTS = 10_000n;

export const STOCK_PAIRED_RUNTIME_FDV_PROBE_WEI = parseEther("0.005");
export const STOCK_PAIRED_TARGET_INITIAL_FDV_WEI = parseEther(
  STOCK_PAIRED_V3_CONFIG.targetInitialFdvEth,
);
export const STOCK_PAIRED_MAXIMUM_RUNTIME_FDV_DEVIATION_BPS = BigInt(
  STOCK_PAIRED_V3_CONFIG.calibration.maximumInitialFdvDeviationBps,
);

export type StockPairedRuntimeFdvAssessment = {
  impliedFdvEthWei: bigint;
  deviationBps: bigint;
  withinPolicy: boolean;
};

export function assessStockPairedRuntimeFdv({
  targetQuoteAmountWad,
  routeQuoteAmount,
  probeAmountWei = STOCK_PAIRED_RUNTIME_FDV_PROBE_WEI,
}: {
  targetQuoteAmountWad: unknown;
  routeQuoteAmount: bigint;
  probeAmountWei?: bigint;
}): StockPairedRuntimeFdvAssessment {
  const targetQuoteAmount =
    typeof targetQuoteAmountWad === "bigint"
      ? targetQuoteAmountWad
      : typeof targetQuoteAmountWad === "string" &&
          /^[1-9]\d*$/.test(targetQuoteAmountWad)
        ? BigInt(targetQuoteAmountWad)
        : 0n;
  if (
    targetQuoteAmount <= 0n ||
    routeQuoteAmount <= 0n ||
    probeAmountWei <= 0n
  ) {
    throw new Error("The Stock-Paired runtime FDV inputs are invalid");
  }

  const impliedFdvEthWei =
    (targetQuoteAmount * probeAmountWei) / routeQuoteAmount;
  const absoluteDeviation =
    impliedFdvEthWei >= STOCK_PAIRED_TARGET_INITIAL_FDV_WEI
      ? impliedFdvEthWei - STOCK_PAIRED_TARGET_INITIAL_FDV_WEI
      : STOCK_PAIRED_TARGET_INITIAL_FDV_WEI - impliedFdvEthWei;
  const deviationBps =
    (absoluteDeviation * BASIS_POINTS +
      STOCK_PAIRED_TARGET_INITIAL_FDV_WEI -
      1n) /
    STOCK_PAIRED_TARGET_INITIAL_FDV_WEI;

  return {
    impliedFdvEthWei,
    deviationBps,
    withinPolicy:
      absoluteDeviation * BASIS_POINTS <=
      STOCK_PAIRED_TARGET_INITIAL_FDV_WEI *
        STOCK_PAIRED_MAXIMUM_RUNTIME_FDV_DEVIATION_BPS,
  };
}
