import { describe, expect, it } from "vitest";

import { predictionPreviewMarkets } from "../components/prediction-market-preview";
import { predictionPortfolioPositionViewModelV1 } from
  "../components/prediction-market-portfolio";
import type { PredictionMarketView } from "../lib/prediction-market-trading";

const now = 1_800_000_000;
const baseMarket = predictionPreviewMarkets(now)[0];

function market(overrides: Partial<PredictionMarketView>) {
  return { ...baseMarket, ...overrides } satisfies PredictionMarketView;
}

describe("prediction portfolio position view model", () => {
  it("shows an open side, shares, probability, time and trade action", () => {
    const view = predictionPortfolioPositionViewModelV1(baseMarket);

    expect(view.statusLabel).toBe("Trading open");
    expect(view.timeLabel).toMatch(/^Closes in /u);
    expect(view.probabilityLabel).toBe("64% YES");
    expect(view.sides).toEqual([
      { outcome: "YES", shares: "0.824" },
      { outcome: "NO", shares: "0.375" },
    ]);
    expect(view.payoutLabel).toBe("Not settled");
    expect(view.actionLabel).toBe("Trade");
  });

  it("closes trading at the cutoff without offering an early payout", () => {
    const view = predictionPortfolioPositionViewModelV1(market({
      blockTimestamp: baseMarket.cutoff,
    }));

    expect(view.statusLabel).toBe("Awaiting result");
    expect(view.payoutLabel).toBe("Awaiting result");
    expect(view.actionLabel).toBe("View market");
    expect(view.actionTone).toBe("quiet");
  });

  it("labels winning outcome shares as won and redeemable", () => {
    const view = predictionPortfolioPositionViewModelV1(market({
      checkpointStatus: "FINAL",
      noBalanceAtoms: 0n,
      state: "FINAL_YES",
      yesBalanceAtoms: 125_000n,
    }));

    expect(view.statusLabel).toBe("Won");
    expect(view.payoutLabel).toBe("Redeemable");
    expect(view.payoutDetail).toContain("1 USDG per share");
    expect(view.actionLabel).toBe("Redeem payout");
    expect(view.actionTone).toBe("primary");
  });

  it("labels a losing held side without inventing profit or loss", () => {
    const view = predictionPortfolioPositionViewModelV1(market({
      checkpointStatus: "FINAL",
      noBalanceAtoms: 75_000n,
      state: "FINAL_YES",
      yesBalanceAtoms: 0n,
    }));

    expect(view.statusLabel).toBe("Lost");
    expect(view.payoutLabel).toBe("Settled");
    expect(view.actionLabel).toBe("View market");
    expect(view.payoutDetail).toContain("settles at zero");
    expect(`${view.payoutLabel} ${view.payoutDetail}`).not.toMatch(/profit|P&L/iu);
  });

  it("keeps a neutral result distinct and redeemable", () => {
    const view = predictionPortfolioPositionViewModelV1(market({
      checkpointStatus: "INVALID",
      noBalanceAtoms: 50_000n,
      state: "FINAL_INVALID",
      yesBalanceAtoms: 25_000n,
    }));

    expect(view.statusLabel).toBe("Neutral");
    expect(view.payoutLabel).toBe("Redeemable");
    expect(view.payoutDetail).toContain("0.50 USDG per share");
    expect(view.actionLabel).toBe("Redeem payout");
  });

  it("accepts the data API position shape as its stable adapter boundary", () => {
    const view = predictionPortfolioPositionViewModelV1({
      finalOutcome: "YES",
      lifecycle: "final_yes",
      market: market({ state: "FINAL_YES" }),
      noAtoms: 0n,
      redeemableAtoms: 1_250_000n,
      result: "won",
      tradingClosed: true,
      yesAtoms: 125_000n,
    });

    expect(view).toMatchObject({
      actionLabel: "Redeem payout",
      payoutLabel: "Redeemable",
      statusLabel: "Won",
    });
  });
});
