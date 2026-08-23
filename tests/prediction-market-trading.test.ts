import { describe, expect, it } from "vitest";

import {
  applyPredictionSlippageFloor,
  assertPredictionConfirmedBlocksMatch,
  isPredictionMarketLoadRequestCurrent,
  parsePredictionBuyAmount,
  parsePredictionSellAmount,
  preparePredictionRedeem,
  predictionBuyPayoutSummary,
  predictionMarketInternal,
  predictionMarketRedeemableAtoms,
  predictionMarketPageIndices,
  predictionDirectionalProtocolFee,
  predictionYesProbabilityBps,
  type PredictionMarketView,
} from "../lib/prediction-market-trading";

const Q96 = 1n << 96n;
const MIN_SQRT_PRICE = 4_295_128_739n;
const MAX_SQRT_PRICE =
  1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n;

describe("prediction market trading math", () => {
  it("rejects stale market reads after a wallet, market, or generation change", () => {
    const request = {
      accountKey: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      generation: 7,
      semanticKey: `0x${"11".repeat(32)}`,
    } as const;

    expect(isPredictionMarketLoadRequestCurrent(request, { ...request })).toBe(true);
    expect(isPredictionMarketLoadRequestCurrent(request, {
      ...request,
      accountKey: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    })).toBe(false);
    expect(isPredictionMarketLoadRequestCurrent(request, {
      ...request,
      generation: 8,
    })).toBe(false);
    expect(isPredictionMarketLoadRequestCurrent(request, {
      ...request,
      semanticKey: `0x${"22".repeat(32)}`,
    })).toBe(false);
    expect(isPredictionMarketLoadRequestCurrent(request, null)).toBe(false);
  });

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

  it("derives payout, profit, max loss, and neutral value from the executable buy quote", () => {
    expect(
      predictionBuyPayoutSummary({
        collateralInAtoms: 100_000n,
        collateralRefundAtoms: 0n,
        minOutcomeAtoms: 19_423n,
        outcomeAtoms: 19_521n,
      }),
    ).toEqual({
      estimatedCostAtoms: 100_000n,
      maximumLossAtoms: 100_000n,
      minimumNeutralPayoutAtoms: 97_115n,
      minimumWinningProfitAtoms: 94_230n,
      minimumWinningPayoutAtoms: 194_230n,
      neutralPayoutAtoms: 97_605n,
      potentialProfitAtoms: 95_210n,
      winningPayoutAtoms: 195_210n,
    });
  });

  it("uses a quoted refund for estimated profit without understating max loss", () => {
    expect(
      predictionBuyPayoutSummary({
        collateralInAtoms: 1_000_000n,
        collateralRefundAtoms: 100_000n,
        minOutcomeAtoms: 190_000n,
        outcomeAtoms: 200_000n,
      }),
    ).toEqual({
      estimatedCostAtoms: 900_000n,
      maximumLossAtoms: 1_000_000n,
      minimumNeutralPayoutAtoms: 950_000n,
      minimumWinningProfitAtoms: 900_000n,
      minimumWinningPayoutAtoms: 1_900_000n,
      neutralPayoutAtoms: 1_000_000n,
      potentialProfitAtoms: 1_100_000n,
      winningPayoutAtoms: 2_000_000n,
    });
  });

  it("enables redemption only for outcome balances with a positive payout", () => {
    expect(predictionMarketRedeemableAtoms({
      noBalanceAtoms: 25n,
      state: "FINAL_YES",
      yesBalanceAtoms: 10n,
    })).toBe(100n);
    expect(predictionMarketRedeemableAtoms({
      noBalanceAtoms: 25n,
      state: "FINAL_YES",
      yesBalanceAtoms: 0n,
    })).toBe(0n);
    expect(predictionMarketRedeemableAtoms({
      noBalanceAtoms: 25n,
      state: "FINAL_NO",
      yesBalanceAtoms: 10n,
    })).toBe(250n);
    expect(predictionMarketRedeemableAtoms({
      noBalanceAtoms: 25n,
      state: "FINAL_INVALID",
      yesBalanceAtoms: 10n,
    })).toBe(175n);
    expect(predictionMarketRedeemableAtoms({
      noBalanceAtoms: 25n,
      state: "OPEN",
      yesBalanceAtoms: 10n,
    })).toBe(0n);
  });

  it("stops a loser-only zero-payout redemption before RPC or wallet work", async () => {
    await expect(preparePredictionRedeem({
      client: null as never,
      market: {
        noBalanceAtoms: 25n,
        state: "FINAL_YES",
        yesBalanceAtoms: 0n,
      } as PredictionMarketView,
      owner: "0x1111111111111111111111111111111111111111",
    })).rejects.toThrow("no payout");
  });

  it("rejects payout summaries that could misstate a malformed quote", () => {
    expect(() =>
      predictionBuyPayoutSummary({
        collateralInAtoms: 1_000_000n,
        collateralRefundAtoms: 1_000_001n,
        minOutcomeAtoms: 100_000n,
        outcomeAtoms: 100_000n,
      }),
    ).toThrow("payout quote");
    expect(() =>
      predictionBuyPayoutSummary({
        collateralInAtoms: 1_000_000n,
        collateralRefundAtoms: 0n,
        minOutcomeAtoms: 100_001n,
        outcomeAtoms: 100_000n,
      }),
    ).toThrow("payout quote");
    expect(() =>
      predictionBuyPayoutSummary({
        collateralInAtoms: 1_000_001n,
        collateralRefundAtoms: 0n,
        minOutcomeAtoms: 100_000n,
        outcomeAtoms: 100_000n,
      }),
    ).toThrow("payout quote");
    expect(() =>
      predictionBuyPayoutSummary({
        collateralInAtoms: 1_000_000n,
        collateralRefundAtoms: 1_000_000n,
        minOutcomeAtoms: 100_000n,
        outcomeAtoms: 100_000n,
      }),
    ).toThrow("payout quote");
    expect(() =>
      predictionBuyPayoutSummary({
        collateralInAtoms: 1_000_000n,
        collateralRefundAtoms: 0n,
        minOutcomeAtoms: 100_000n,
        outcomeAtoms: 1n << 128n,
      }),
    ).toThrow("payout quote");
  });

  it("keeps conservative minimum profit signed when slippage crosses cost", () => {
    expect(
      predictionBuyPayoutSummary({
        collateralInAtoms: 1_000_000n,
        collateralRefundAtoms: 0n,
        minOutcomeAtoms: 90_000n,
        outcomeAtoms: 105_000n,
      }).minimumWinningProfitAtoms,
    ).toBe(-100_000n);
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
