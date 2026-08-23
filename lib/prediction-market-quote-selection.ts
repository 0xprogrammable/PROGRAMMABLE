import type { PredictionOutcome } from "@/lib/prediction-market-trading";

export type PredictionTradeMode = "BUY" | "SELL";

export type PredictionQuoteSelection = Readonly<{
  amount: string;
  marketIdentity: string;
  mode: PredictionTradeMode;
  outcome: PredictionOutcome;
}>;

/**
 * Binds a reviewed quote to the exact market and controls that produced it.
 * The JSON tuple is unambiguous and intentionally preserves the raw amount so
 * every edit invalidates the previous quote, even when two strings parse to the
 * same numeric value.
 */
export function predictionQuoteSelectionKey(
  selection: PredictionQuoteSelection,
) {
  return JSON.stringify([
    selection.marketIdentity.toLowerCase(),
    selection.mode,
    selection.outcome,
    selection.amount,
  ]);
}
