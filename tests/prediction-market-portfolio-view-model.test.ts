import { describe, expect, it } from "vitest";

import { predictionPreviewMarkets } from "../components/prediction-market-preview";
import {
  predictionPortfolioHistoryViewModelV1,
  predictionPortfolioPositionViewModelV1,
} from "../components/prediction-market-portfolio";
import type { PredictionPortfolioHistoryEntry } from
  "../lib/prediction-market-portfolio";
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
    expect(view.metricLabel).toBe("Potential payout");
    expect(view.payoutLabel).toBe("0.824 USDG");
    expect(view.actionLabel).toBe("Trade");
  });

  it("closes trading at the cutoff without offering an early payout", () => {
    const view = predictionPortfolioPositionViewModelV1(market({
      blockTimestamp: baseMarket.cutoff,
    }));

    expect(view.statusLabel).toBe("Awaiting result");
    expect(view.metricLabel).toBe("Potential payout");
    expect(view.payoutLabel).toBe("0.824 USDG");
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
    expect(view.probabilityMetricLabel).toBe("Result");
    expect(view.probabilityLabel).toBe("YES won");
    expect(view.probabilityYesPercent).toBe(100);
    expect(view.metricLabel).toBe("Final payout");
    expect(view.payoutLabel).toBe("1.25 USDG");
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
    expect(view.payoutLabel).toBe("0 USDG");
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
    expect(view.probabilityMetricLabel).toBe("Result");
    expect(view.probabilityLabel).toBe("Neutral");
    expect(view.probabilityYesPercent).toBe(50);
    expect(view.payoutLabel).toBe("0.375 USDG");
    expect(view.payoutDetail).toContain("0.50 USDG per share");
    expect(view.actionLabel).toBe("Redeem payout");
  });

  it("shows a final NO result at zero instead of freezing the closing probability", () => {
    const view = predictionPortfolioPositionViewModelV1(market({
      checkpointStatus: "FINAL",
      noBalanceAtoms: 125_000n,
      probabilityYesBps: 8_700,
      state: "FINAL_NO",
      yesBalanceAtoms: 0n,
    }));

    expect(view).toMatchObject({
      probabilityLabel: "NO won",
      probabilityMetricLabel: "Result",
      probabilityYesPercent: 0,
      statusLabel: "Won",
    });
  });

  it("states the winning side factually when the wallet holds winning and losing shares", () => {
    const view = predictionPortfolioPositionViewModelV1({
      finalOutcome: "YES",
      lifecycle: "final_yes",
      market: market({ state: "FINAL_YES" }),
      noAtoms: 1_000_000n,
      redeemableAtoms: 1_000_000n,
      result: "mixed",
      tradingClosed: true,
      yesAtoms: 100_000n,
    });

    expect(view).toMatchObject({
      payoutLabel: "1 USDG",
      probabilityLabel: "YES won",
      probabilityYesPercent: 100,
      statusLabel: "YES won",
    });
    expect(view.sides).toEqual([
      { outcome: "YES", shares: "1" },
      { outcome: "NO", shares: "10" },
    ]);
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
      payoutLabel: "1.25 USDG",
      statusLabel: "Won",
    });
  });
});

const historyBase = {
  blockNumber: 101n,
  logIndex: 4,
  market: baseMarket,
  semanticKey: baseMarket.semanticKey,
  transactionHash: `0x${"ab".repeat(32)}`,
  transactionIndex: 2,
  vault: baseMarket.vault,
} as const;

describe("prediction portfolio history view model", () => {
  it("shows a sell as the net original-side debit plus its complement refund", () => {
    const entry = {
      ...historyBase,
      collateralAtoms: 500_000n,
      complementRefundAtoms: 10_000n,
      kind: "sold",
      outcome: "YES",
      outcomeAtoms: 100_000n,
      soldRefundAtoms: 25_000n,
    } satisfies PredictionPortfolioHistoryEntry;

    const view = predictionPortfolioHistoryViewModelV1(entry);

    expect(view.sides).toEqual([
      { outcome: "YES", shares: "-0.75" },
      { outcome: "NO", shares: "+0.1" },
    ]);
    expect(view.payoutDetail).toBe(
      "0.75 YES sold. 0.25 YES and 0.1 NO returned.",
    );
    expect(view.timeLabel).toBe("Observed onchain");
  });

  it("presents direct split and merge legs without hiding share movement", () => {
    const split = predictionPortfolioHistoryViewModelV1({
      ...historyBase,
      accountRole: "self",
      collateralAtoms: 1_000_000n,
      kind: "split",
      outcomeAtoms: 100_000n,
      payer: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      recipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    } satisfies PredictionPortfolioHistoryEntry);
    const merged = predictionPortfolioHistoryViewModelV1({
      ...historyBase,
      accountRole: "holder",
      collateralAtoms: 1_000_000n,
      holder: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      kind: "merged",
      outcomeAtoms: 100_000n,
      recipient: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    } satisfies PredictionPortfolioHistoryEntry);

    expect(split).toMatchObject({
      payoutDetail: "Created 1 YES and 1 NO shares.",
      statusLabel: "Split USDG",
    });
    expect(split.sides).toEqual([
      { outcome: "YES", shares: "+1" },
      { outcome: "NO", shares: "+1" },
    ]);
    expect(merged).toMatchObject({
      payoutDetail: "Merged 1 YES and 1 NO; USDG went to another wallet.",
      statusLabel: "Merged YES + NO",
    });
    expect(merged.sides).toEqual([
      { outcome: "YES", shares: "-1" },
      { outcome: "NO", shares: "-1" },
    ]);
  });

  it("distinguishes redemption by the holder from payout-only receipt", () => {
    const self = predictionPortfolioHistoryViewModelV1({
      ...historyBase,
      accountRole: "self",
      collateralAtoms: 1_250_000n,
      holder: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      kind: "redeemed",
      noAtoms: 0n,
      recipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      yesAtoms: 125_000n,
    } satisfies PredictionPortfolioHistoryEntry);
    const recipient = predictionPortfolioHistoryViewModelV1({
      ...historyBase,
      accountRole: "recipient",
      collateralAtoms: 1_250_000n,
      holder: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      kind: "redeemed",
      noAtoms: 0n,
      recipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      yesAtoms: 125_000n,
    } satisfies PredictionPortfolioHistoryEntry);

    expect(self).toMatchObject({
      payoutDetail: "Outcome shares redeemed to this wallet.",
      payoutLabel: "1.25 USDG",
      statusLabel: "Payout redeemed",
    });
    expect(self.sides).toEqual([{ outcome: "YES", shares: "-1.25" }]);
    expect(recipient).toMatchObject({
      payoutDetail: "Payout received from another wallet's redemption.",
      payoutLabel: "1.25 USDG",
      statusLabel: "Payout redeemed",
    });
    expect(recipient.sides).toEqual([]);
  });
});
