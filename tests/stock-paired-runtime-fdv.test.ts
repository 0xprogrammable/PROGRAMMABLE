import { describe, expect, it } from "vitest";

import {
  assessStockPairedRuntimeFdv,
  STOCK_PAIRED_MAXIMUM_RUNTIME_FDV_DEVIATION_BPS,
  STOCK_PAIRED_RUNTIME_FDV_PROBE_WEI,
  STOCK_PAIRED_TARGET_INITIAL_FDV_WEI,
} from "../lib/stock-paired-runtime-fdv";

const TARGET_QUOTE_AMOUNT_WAD = 13_522_423_984_475_316_997n;

function quoteAmountForFdv(fdvEthWei: bigint) {
  return (
    TARGET_QUOTE_AMOUNT_WAD * STOCK_PAIRED_RUNTIME_FDV_PROBE_WEI
  ) / fdvEthWei;
}

describe("Stock-Paired runtime FDV policy", () => {
  it("uses the fixed 0.005 ETH route probe and reviewed 500 bps policy", () => {
    expect(STOCK_PAIRED_RUNTIME_FDV_PROBE_WEI).toBe(
      5_000_000_000_000_000n,
    );
    expect(STOCK_PAIRED_MAXIMUM_RUNTIME_FDV_DEVIATION_BPS).toBe(500n);
  });

  it("recomputes the target ETH FDV from route output", () => {
    const routeQuoteAmount = quoteAmountForFdv(
      STOCK_PAIRED_TARGET_INITIAL_FDV_WEI,
    );
    const result = assessStockPairedRuntimeFdv({
      targetQuoteAmountWad: TARGET_QUOTE_AMOUNT_WAD,
      routeQuoteAmount,
    });

    expect(result.withinPolicy).toBe(true);
    expect(result.deviationBps).toBeLessThanOrEqual(1n);
    const absoluteDifference =
      result.impliedFdvEthWei >= STOCK_PAIRED_TARGET_INITIAL_FDV_WEI
        ? result.impliedFdvEthWei - STOCK_PAIRED_TARGET_INITIAL_FDV_WEI
        : STOCK_PAIRED_TARGET_INITIAL_FDV_WEI -
          result.impliedFdvEthWei;
    expect(absoluteDifference).toBeLessThan(1_000n);
  });

  it("accepts the exact upper 500 bps boundary", () => {
    const upperBoundary =
      STOCK_PAIRED_TARGET_INITIAL_FDV_WEI +
      (STOCK_PAIRED_TARGET_INITIAL_FDV_WEI * 500n) / 10_000n;
    const result = assessStockPairedRuntimeFdv({
      targetQuoteAmountWad: upperBoundary,
      routeQuoteAmount: 1n,
      probeAmountWei: 1n,
    });

    expect(result.withinPolicy).toBe(true);
    expect(result.deviationBps).toBeLessThanOrEqual(500n);
  });

  it("rejects the first wei outside the reviewed range", () => {
    const outsidePolicy =
      STOCK_PAIRED_TARGET_INITIAL_FDV_WEI +
      (STOCK_PAIRED_TARGET_INITIAL_FDV_WEI * 500n) / 10_000n +
      1n;
    const result = assessStockPairedRuntimeFdv({
      targetQuoteAmountWad: outsidePolicy,
      routeQuoteAmount: 1n,
      probeAmountWei: 1n,
    });

    expect(result.withinPolicy).toBe(false);
    expect(result.deviationBps).toBeGreaterThan(500n);
  });

  it("fails closed for missing route data", () => {
    expect(() =>
      assessStockPairedRuntimeFdv({
        targetQuoteAmountWad: TARGET_QUOTE_AMOUNT_WAD,
        routeQuoteAmount: 0n,
      }),
    ).toThrow(/inputs are invalid/);
  });

  it("fails closed for a missing target quote amount", () => {
    expect(() =>
      assessStockPairedRuntimeFdv({
        targetQuoteAmountWad: undefined,
        routeQuoteAmount: 1n,
      }),
    ).toThrow(/inputs are invalid/);
  });
});
