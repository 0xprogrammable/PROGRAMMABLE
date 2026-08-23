import { describe, expect, it } from "vitest";

import {
  predictionV2BuyPreview,
  predictionV2DirectionalPoolManagerFeePips,
  predictionV2PriceImpact,
  predictionV2PriceImpactRiskState,
  predictionV2SellPreview,
  predictionV2SlippageFloor,
  predictionV2YesProbabilityBps,
  requirePredictionV2PriceImpactConfirmation,
} from "../lib/prediction-v2/accounting";
import {
  PREDICTION_V2_MAX_SQRT_PRICE_X96,
  PREDICTION_V2_MIN_SQRT_PRICE_X96,
  validatePredictionV2SellQuote,
} from "../lib/prediction-v2/codec";
import {
  ADDRESS_1,
  ADDRESS_2,
  BUY_QUOTE,
  POOL_KEY,
  Q96,
  SELL_QUOTE,
  boundPredictionV2MarketState,
} from "./prediction-v2-fixtures";

function boundBuy(
  quote = BUY_QUOTE,
  buyYes = true,
  marketState = boundPredictionV2MarketState(),
) {
  return {
    chainId: 4_663 as const,
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    buyYes,
    observedBlockNumber: marketState.observedBlockNumber,
    observedBlockHash: marketState.observedBlockHash,
    marketState,
    quote,
  } as const;
}

function boundSell(
  quote = SELL_QUOTE,
  sellYes = true,
  marketState = boundPredictionV2MarketState(),
) {
  return {
    chainId: 4_663 as const,
    vault: ADDRESS_1,
    poolKey: POOL_KEY,
    sellYes,
    observedBlockNumber: marketState.observedBlockNumber,
    observedBlockHash: marketState.observedBlockHash,
    marketState,
    quote,
  } as const;
}

describe("Protocol V2 fee-aware payout and price-impact preview", () => {
  it("maps the live v4 price to YES/NO probabilities and both impact units", () => {
    expect(predictionV2YesProbabilityBps(Q96, true)).toBe(5_000);
    expect(predictionV2YesProbabilityBps(Q96 * 2n, true)).toBe(8_000);
    expect(predictionV2YesProbabilityBps(Q96 * 2n, false)).toBe(2_000);
    expect(predictionV2PriceImpact(Q96, Q96 * 2n, true, "YES")).toEqual({
      currentProbabilityBps: 5_000,
      postTradeProbabilityBps: 8_000,
      probabilityPointDeltaBps: 3_000,
      probabilityPointMagnitudeBps: 3_000,
      relativeImpactBps: 6_000,
    });
    expect(predictionV2PriceImpact(Q96, Q96 * 2n, true, "NO"))
      .toMatchObject({ probabilityPointDeltaBps: -3_000 });
    expect(() => predictionV2YesProbabilityBps(
      PREDICTION_V2_MIN_SQRT_PRICE_X96 - 1n,
      true,
    )).toThrow("outside Uniswap v4 bounds");
    expect(() => predictionV2YesProbabilityBps(
      PREDICTION_V2_MAX_SQRT_PRICE_X96 + 1n,
      true,
    )).toThrow("outside Uniswap v4 bounds");
  });

  it("uses a strict slippage floor and decodes directional live PoolManager fees", () => {
    expect(predictionV2SlippageFloor(10_000n, 50)).toBe(9_950n);
    expect(predictionV2SlippageFloor(1n, 1_000)).toBe(1n);
    expect(() => predictionV2SlippageFloor(10_000n, 0)).toThrow("slippage");
    expect(() => predictionV2SlippageFloor(10_000n, 1_001)).toThrow("slippage");
    const packed = (321 << 12) | 123;
    expect(predictionV2DirectionalPoolManagerFeePips(packed, true)).toBe(123);
    expect(predictionV2DirectionalPoolManagerFeePips(packed, false)).toBe(321);
  });

  it("shows maximum and actual fee-inclusive payment, receive bounds, payout and signed profit", () => {
    const preview = predictionV2BuyPreview({
      boundQuote: boundBuy(),
      slippageBps: 50,
    });
    expect(preview).toMatchObject({
      requestedCollateralAtoms: 1_000_000n,
      maximumPaymentAtoms: 1_001_000n,
      actualPaymentAtoms: 800_800n,
      protocolFeeAtoms: 800n,
      totalRefundAtoms: 200_200n,
      outcomeAtoms: 190_000n,
      minimumOutcomeAtoms: 189_050n,
      winningGrossPayoutAtoms: 1_900_000n,
      minimumWinningGrossPayoutAtoms: 1_890_500n,
      potentialNetProfitAtoms: 1_099_200n,
      minimumNetProfitAtoms: 889_500n,
      maximumLossAtoms: 1_001_000n,
      neutralPayoutAtoms: 950_000n,
      lpFeePips: 200,
      poolManagerProtocolFeePips: 321,
      liquidity: {
        depth: "thin",
        riskState: "explicit-confirmation-required",
        priceImpactRiskState: "explicit-confirmation-required",
        partialFill: true,
        warning: { code: "backstop-only" },
      },
    });
    expect(preview.averageExecutablePriceBps).toBe(4_215);
    expect(preview.maximumSlippagePriceBps).toBe(5_295);
  });

  it("keeps a conservative minimum profit signed when slippage can make it negative", () => {
    const expensiveQuote = {
      requestedCollateralAtoms: 1_000_000n,
      maximumPaymentAtoms: 1_001_000n,
      executedCollateralAtoms: 1_000_000n,
      collateralRefundAtoms: 0n,
      protocolFeeAtoms: 1_000n,
      feeReserveRefundAtoms: 0n,
      actualPaymentAtoms: 1_001_000n,
      outcomeAtoms: 100_001n,
      swap: {
        ...BUY_QUOTE.swap,
        actualInput: 100_000n,
        amountOut: 1n,
      },
    } as const;
    const preview = predictionV2BuyPreview({
      boundQuote: boundBuy(expensiveQuote),
      slippageBps: 1_000,
    });
    expect(preview.minimumOutcomeAtoms).toBe(90_000n);
    expect(preview.minimumNetProfitAtoms).toBe(-101_000n);
    expect(typeof preview.minimumNetProfitAtoms).toBe("bigint");
  });

  it("never suppresses the genesis-only backstop warning for a small low-impact quote", () => {
    const smallQuote = {
      requestedCollateralAtoms: 100_000n,
      maximumPaymentAtoms: 100_100n,
      executedCollateralAtoms: 100_000n,
      collateralRefundAtoms: 0n,
      protocolFeeAtoms: 100n,
      feeReserveRefundAtoms: 0n,
      actualPaymentAtoms: 100_100n,
      outcomeAtoms: 20_000n,
      swap: {
        ...BUY_QUOTE.swap,
        actualInput: 10_000n,
        amountOut: 10_000n,
        sqrtPriceX96After: Q96 + 1n,
      },
    } as const;
    const preview = predictionV2BuyPreview({
      boundQuote: boundBuy(smallQuote),
      slippageBps: 50,
    });
    expect(preview.priceImpact.probabilityPointMagnitudeBps).toBe(0);
    expect(preview.liquidity).toEqual({
      depth: "thin",
      riskState: "warning",
      priceImpactRiskState: "normal",
      partialFill: false,
      warning: {
        code: "backstop-only",
        message: "Only the 2 USDG protocol backstop is currently evidenced for this market.",
      },
    });
  });

  it("classifies exact 199/200/499/500 bps boundaries and requires confirmation at 500", () => {
    expect(predictionV2PriceImpactRiskState(199)).toBe("normal");
    expect(predictionV2PriceImpactRiskState(200)).toBe("warning");
    expect(predictionV2PriceImpactRiskState(499)).toBe("warning");
    expect(predictionV2PriceImpactRiskState(500)).toBe("explicit-confirmation-required");
    expect(() => requirePredictionV2PriceImpactConfirmation(499, false)).not.toThrow();
    expect(() => requirePredictionV2PriceImpactConfirmation(500, false))
      .toThrow("explicit price-impact confirmation");
    expect(() => requirePredictionV2PriceImpactConfirmation(
      500,
      "yes" as unknown as boolean,
    )).toThrow("explicit price-impact confirmation");
    expect(() => requirePredictionV2PriceImpactConfirmation(500, true)).not.toThrow();
  });

  it("warns from 2pp and reports explicit confirmation from 5pp", () => {
    const fullQuote = {
      requestedCollateralAtoms: 100_000n,
      maximumPaymentAtoms: 100_100n,
      executedCollateralAtoms: 100_000n,
      collateralRefundAtoms: 0n,
      protocolFeeAtoms: 100n,
      feeReserveRefundAtoms: 0n,
      actualPaymentAtoms: 100_100n,
      outcomeAtoms: 20_000n,
      swap: {
        ...BUY_QUOTE.swap,
        actualInput: 10_000n,
        amountOut: 10_000n,
      },
    } as const;
    const warning = predictionV2BuyPreview({
      boundQuote: boundBuy({
        ...fullQuote,
        swap: { ...fullQuote.swap, sqrtPriceX96After: Q96 * 105n / 100n },
      }),
      slippageBps: 50,
    });
    expect(warning.priceImpact.probabilityPointMagnitudeBps).toBeGreaterThanOrEqual(200);
    expect(warning.priceImpact.probabilityPointMagnitudeBps).toBeLessThan(500);
    expect(warning.liquidity).toEqual({
      depth: "thin",
      riskState: "warning",
      priceImpactRiskState: "warning",
      partialFill: false,
      warning: {
        code: "backstop-only",
        message: "Only the 2 USDG protocol backstop is currently evidenced for this market.",
      },
    });

    const explicit = predictionV2BuyPreview({
      boundQuote: boundBuy({
        ...fullQuote,
        swap: { ...fullQuote.swap, sqrtPriceX96After: Q96 * 111n / 100n },
      }),
      slippageBps: 50,
    });
    expect(explicit.priceImpact.probabilityPointMagnitudeBps).toBeGreaterThanOrEqual(500);
    expect(explicit.liquidity).toEqual({
      depth: "thin",
      riskState: "explicit-confirmation-required",
      priceImpactRiskState: "explicit-confirmation-required",
      partialFill: false,
      warning: {
        code: "backstop-only",
        message: "Only the 2 USDG protocol backstop is currently evidenced for this market.",
      },
    });

    const backstopExplicit = predictionV2BuyPreview({
      boundQuote: boundBuy({
        ...fullQuote,
        swap: { ...fullQuote.swap, sqrtPriceX96After: Q96 * 111n / 100n },
      }),
      slippageBps: 50,
    });
    expect(backstopExplicit.liquidity).toMatchObject({
      depth: "thin",
      riskState: "explicit-confirmation-required",
      warning: { code: "backstop-only" },
    });
  });

  it("uses net sell proceeds for the minimum and avoids a misleading refund-adjusted average", () => {
    const preview = predictionV2SellPreview({
      boundQuote: boundSell(),
      slippageBps: 100,
    });
    expect(preview).toMatchObject({
      grossProceedsAtoms: 520_000n,
      protocolFeeAtoms: 520n,
      netProceedsAtoms: 519_480n,
      minimumNetProceedsAtoms: 514_285n,
      averageNetCashExitPriceBps: 5_195,
      poolManagerProtocolFeePips: 123,
    });

    const quoteWithSoldRefund = validatePredictionV2SellQuote({
      outcomeInAtoms: 100_000n,
      requestedSwapAtoms: 40_000n,
      grossCollateralAtoms: 500_000n,
      protocolFeeAtoms: 500n,
      netCollateralAtoms: 499_500n,
      soldRefundAtoms: 10_000n,
      complementRefundAtoms: 0n,
      swap: {
        ...SELL_QUOTE.swap,
        actualInput: 40_000n,
        amountOut: 50_000n,
      },
    });
    const soldRefundPreview = predictionV2SellPreview({
      boundQuote: boundSell(quoteWithSoldRefund),
      slippageBps: 50,
    });
    expect(soldRefundPreview.soldOutcomeRefundAtoms).toBe(10_000n);
    expect(soldRefundPreview.averageNetCashExitPriceBps).toBe(5_550);

    const quoteWithComplementRefund = validatePredictionV2SellQuote({
      outcomeInAtoms: 100_000n,
      requestedSwapAtoms: 40_000n,
      grossCollateralAtoms: 600_000n,
      protocolFeeAtoms: 600n,
      netCollateralAtoms: 599_400n,
      soldRefundAtoms: 0n,
      complementRefundAtoms: 10_000n,
      swap: {
        ...SELL_QUOTE.swap,
        actualInput: 40_000n,
        amountOut: 70_000n,
      },
    });
    const complementRefundPreview = predictionV2SellPreview({
      boundQuote: boundSell(quoteWithComplementRefund),
      slippageBps: 50,
    });
    expect(complementRefundPreview.complementOutcomeRefundAtoms).toBe(10_000n);
    expect(complementRefundPreview.averageNetCashExitPriceBps).toBeNull();
  });

  it("derives side and direction from the bound pool and cannot accept unverified depth", () => {
    const noBuyQuote = {
      ...BUY_QUOTE,
      swap: {
        ...BUY_QUOTE.swap,
        sqrtPriceX96After: Q96 / 2n,
        tickAfter: -13_864,
      },
    } as const;
    const noBuy = predictionV2BuyPreview({
      boundQuote: boundBuy(noBuyQuote, false),
      slippageBps: 50,
    });
    expect(noBuy.poolManagerProtocolFeePips).toBe(123);

    const marketState = boundPredictionV2MarketState();
    expect(() => predictionV2BuyPreview({
      boundQuote: boundBuy(BUY_QUOTE, true, {
        ...marketState,
        yesToken: ADDRESS_2,
        noToken: ADDRESS_1,
      }),
      slippageBps: 50,
    })).toThrow("decoded market-state binding");
    expect(() => predictionV2SellPreview({
      boundQuote: boundSell(SELL_QUOTE, true, {
        ...marketState,
        currentSqrtPriceX96: Q96 * 2n,
      }),
      slippageBps: 50,
    })).toThrow("decoded market-state binding");

    expect(() => predictionV2BuyPreview({
      boundQuote: boundBuy({
        ...BUY_QUOTE,
        swap: { ...BUY_QUOTE.swap, sqrtPriceX96After: Q96 / 2n },
      }),
      slippageBps: 50,
    })).toThrow("buy selected-probability direction");
    expect(() => predictionV2SellPreview({
      boundQuote: boundSell({
        ...SELL_QUOTE,
        swap: { ...SELL_QUOTE.swap, sqrtPriceX96After: Q96 * 2n },
      }),
      slippageBps: 50,
    })).toThrow("sell selected-probability direction");

    const spoofedInput = {
      boundQuote: boundBuy(),
      slippageBps: 50,
      liquidityEvidence: "verified-live-depth",
    } as Parameters<typeof predictionV2BuyPreview>[0] & {
      liquidityEvidence: "verified-live-depth";
    };
    expect(predictionV2BuyPreview(spoofedInput).liquidity).toMatchObject({
      depth: "thin",
      warning: { code: "backstop-only" },
    });
  });
});
