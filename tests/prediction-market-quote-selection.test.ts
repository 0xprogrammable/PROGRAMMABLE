import { describe, expect, it } from "vitest";

import {
  predictionQuoteSelectionKey,
  type PredictionQuoteSelection,
} from "@/lib/prediction-market-quote-selection";

const selection = {
  amount: "10",
  marketIdentity: "0xMARKET:0xPOOL:0xVAULT",
  mode: "BUY",
  outcome: "YES",
} satisfies PredictionQuoteSelection;

describe("prediction quote selection binding", () => {
  it("is deterministic and normalizes the market identity", () => {
    expect(predictionQuoteSelectionKey(selection)).toBe(
      predictionQuoteSelectionKey({
        ...selection,
        marketIdentity: selection.marketIdentity.toLowerCase(),
      }),
    );
  });

  it.each([
    ["market", { marketIdentity: "0xOTHER:0xPOOL:0xVAULT" }],
    ["mode", { mode: "SELL" }],
    ["outcome", { outcome: "NO" }],
    ["amount", { amount: "11" }],
    ["raw amount representation", { amount: "10.0" }],
  ] as const)("invalidates a quote after a %s change", (_label, change) => {
    expect(predictionQuoteSelectionKey({ ...selection, ...change })).not.toBe(
      predictionQuoteSelectionKey(selection),
    );
  });
});
