import { describe, expect, it } from "vitest";

import {
  applyPredictionSlippageFloor,
  assertPredictionConfirmedBlocksMatch,
  parsePredictionBuyAmount,
  parsePredictionSellAmount,
  predictionMarketInternal,
  predictionMarketPageIndices,
  predictionDirectionalProtocolFee,
  predictionYesProbabilityBps,
} from "../lib/prediction-market-trading";

const Q96 = 1n << 96n;
const MIN_SQRT_PRICE = 4_295_128_739n;
const MAX_SQRT_PRICE =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;

describe("prediction market trading math", () => {
  it("maps the v4 YES/NO ratio to a stable binary probability", () => {
    expect(predictionYesProbabilityBps(Q96, true)).toBe(5_000);
    expect(predictionYesProbabilityBps(Q96, false)).toBe(5_000);

    const higherRatio = Q96 * 2n;
    expect(predictionYesProbabilityBps(higherRatio, true)).toBe(8_000);
    expect(predictionYesProbabilityBps(higherRatio, false)).toBe(2_000);
  });

  it("rejects pool prices outside the actual Uniswap v4 TickMath range", () => {
    expect(() => predictionYesProbabilityBps(MIN_SQRT_PRICE - 1n, true)).toThrow(
      "outside supported bounds",
    );
    expect(() => predictionYesProbabilityBps(MAX_SQRT_PRICE + 1n, false)).toThrow(
      "outside supported bounds",
    );
    expect(predictionYesProbabilityBps(MIN_SQRT_PRICE, true)).toBe(0);
    expect(predictionYesProbabilityBps(MAX_SQRT_PRICE, true)).toBe(10_000);
  });

  it("floors minimum output and rejects unsafe slippage", () => {
    expect(applyPredictionSlippageFloor(10_000n, 50)).toBe(9_950n);
    expect(applyPredictionSlippageFloor(1n, 50)).toBe(1n);
    expect(() => applyPredictionSlippageFloor(10_000n, 0)).toThrow(
      "slippage",
    );
    expect(() => applyPredictionSlippageFloor(10_000n, 1_001)).toThrow(
      "slippage",
    );
  });

  it("accepts only representable buy and sell amounts", () => {
    expect(parsePredictionBuyAmount("1")).toBe(1_000_000n);
    expect(parsePredictionBuyAmount("0.00001")).toBe(10n);
    expect(parsePredictionBuyAmount("0.000001")).toBeNull();
    expect(parsePredictionSellAmount("1.23456")).toBe(123_456n);
    expect(parsePredictionSellAmount("1.234567")).toBeNull();
  });

  it("decodes directional Uniswap v4 protocol fees", () => {
    const packed = (321 << 12) | 123;
    expect(predictionDirectionalProtocolFee(packed, true)).toBe(123);
    expect(predictionDirectionalProtocolFee(packed, false)).toBe(321);
  });

  it("pages newest-first with a stable cursor and no gaps", () => {
    const first = predictionMarketPageIndices({ limit: 12, marketCount: 25n });
    const second = predictionMarketPageIndices({
      cursor: first.nextCursor,
      limit: 12,
      marketCount: 26n,
    });
    const last = predictionMarketPageIndices({
      cursor: second.nextCursor,
      limit: 12,
      marketCount: 26n,
    });

    expect(first.indices).toEqual([
      24n, 23n, 22n, 21n, 20n, 19n, 18n, 17n, 16n, 15n, 14n, 13n,
    ]);
    expect(second.indices).toEqual([
      12n, 11n, 10n, 9n, 8n, 7n, 6n, 5n, 4n, 3n, 2n, 1n,
    ]);
    expect(last).toEqual({ indices: [0n], nextCursor: 0n });
  });

  it("reconciles canonical block identity without comparing provider-shaped transaction fields", () => {
    const canonical = {
      hash: `0x${"11".repeat(32)}`,
      number: 43_457_445n,
      parentHash: `0x${"22".repeat(32)}`,
      timestamp: 1_787_433_219n,
    } as const;
    const official = {
      ...canonical,
      transactions: [`0x${"33".repeat(32)}`],
      l1BlockNumber: 25_813_295n,
    };
    const independent = {
      ...canonical,
      blobGasUsed: null,
      transactions: [],
    };

    expect(() =>
      assertPredictionConfirmedBlocksMatch(official, independent),
    ).not.toThrow();
    expect(() =>
      assertPredictionConfirmedBlocksMatch(official, {
        ...independent,
        hash: `0x${"44".repeat(32)}`,
      }),
    ).toThrow("confirmed block");
  });

  it("bounds concurrent market reads while preserving directory order", async () => {
    let active = 0;
    let maximumActive = 0;
    const values = Array.from({ length: 11 }, (_, index) => index);

    const result = await predictionMarketInternal.mapPredictionMarketsInBatches(
      values,
      async (value) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return value * 2;
      },
    );

    expect(maximumActive).toBe(4);
    expect(result).toEqual(values.map((value) => value * 2));
  });
});
