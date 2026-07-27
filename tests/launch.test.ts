import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  buildLaunchSummary,
  buildPlainTextPlan,
  createEmptyDraft,
  getDraftAssetLabel,
  getInitialBuyEthLabel,
  getMemeFeeBreakdown,
  maximumClassicDevBuyWei,
  MEME_INITIAL_TICK,
  MEME_MIN_INITIAL_BUY_ETH,
  MEME_MIN_INITIAL_BUY_WEI,
  MEME_STARTING_FDV_ETH,
  MEME_STARTING_FDV_ETH_LABEL,
  MEME_TOKEN_SUPPLY_WHOLE,
  parseInitialBuyWei,
  parseTotalSwapFeeBps,
} from "../lib/launch";

describe("Classic launch plan", () => {
  it("keeps the internal contract label out of user-facing preflight copy", () => {
    const preflightSource = readFileSync(
      new URL("../app/api/launch/preflight/route.ts", import.meta.url),
      "utf8",
    );

    expect(preflightSource).not.toContain('"Meme Launch"');
    expect(preflightSource).not.toContain("The Meme Launch");
  });

  it("starts every new draft on the single supported launch path", () => {
    const draft = createEmptyDraft();

    expect(draft.assetMode).toBe("new");
    expect(draft.liquidityMode).toBe("meme");
    expect(draft.tokenSupply).toBe("1000000000");
    expect(draft.selectedBehaviors).toEqual(["fixed-fee"]);
    expect(draft.lpFeePercent).toBe("0");
    expect(draft.initialBuyEth).toBe(MEME_MIN_INITIAL_BUY_ETH);
  });

  it("accepts a creator-selected Dev Buy at or above the minimum", () => {
    expect(parseInitialBuyWei("0.0006")).toBe(
      MEME_MIN_INITIAL_BUY_WEI,
    );
    expect(parseInitialBuyWei("0.002")).toBe(
      2_000_000_000_000_000n,
    );
    expect(parseInitialBuyWei("0.000599999999999999")).toBeNull();
    expect(parseInitialBuyWei("1e-3")).toBeNull();
    expect(parseInitialBuyWei("1.")).toBeNull();
    expect(
      getInitialBuyEthLabel({
        ...createEmptyDraft(),
        initialBuyEth: "0.002",
      }),
    ).toBe("0.002 ETH");
  });

  it("keeps a 50 percent network-fee buffer when Max is selected", () => {
    expect(
      maximumClassicDevBuyWei({
        nativeBalanceWei: 10_000n,
        gasLimit: 1_000n,
        gasPriceWei: 2n,
      }),
    ).toBe(7_000n);
    expect(
      maximumClassicDevBuyWei({
        nativeBalanceWei: 3_000n,
        gasLimit: 1_000n,
        gasPriceWei: 2n,
      }),
    ).toBe(0n);
  });

  it("copies the selected Dev Buy into the launch summary", () => {
    const setup = buildPlainTextPlan({
      ...createEmptyDraft(),
      initialBuyEth: "0.002",
    });

    expect(setup).toContain("Creator initial buy: 0.002 ETH");
  });

  it("describes the one-sided locked launch without a liquidity deposit", () => {
    const draft = {
      ...createEmptyDraft(),
      tokenName: "Clear",
      tokenSymbol: "CLEAR",
    };

    expect(getDraftAssetLabel(draft)).toBe("CLEAR");
    expect(buildLaunchSummary(draft)).toContain("complete supply");
    expect(buildLaunchSummary(draft)).toContain("1.36 ETH starting FDV");
    expect(buildLaunchSummary(draft)).toContain(
      "one-sided Uniswap v4 position",
    );
    expect(buildLaunchSummary(draft)).not.toMatch(/[.!?]$/);
  });

  it("keeps the copied setup focused on the launch configuration", () => {
    const setup = buildPlainTextPlan(createEmptyDraft());

    expect(setup).not.toContain("Status:");
    expect(setup).toContain(
      "Launch cost: no launch fee or liquidity deposit; the creator pays the initial buy and network gas",
    );
    expect(setup).toContain("Creator initial buy: 0.0006 ETH");
    expect(setup).toContain(
      "Programmable share: 0.10% in native ETH, deducted from the fixed total",
    );
    expect(setup).toContain("Uniswap LP fee: 0.00%");
    expect(setup).toContain(
      `Starting FDV: ${MEME_STARTING_FDV_ETH_LABEL}`,
    );
    expect(setup).not.toContain("Auction");
    expect(setup).not.toContain("Direct v4 pool");
  });

  it("derives the starting FDV from the fixed supply and initial tick", () => {
    expect(MEME_STARTING_FDV_ETH).toBe(1.3556577608171038);
    expect(
      MEME_TOKEN_SUPPLY_WHOLE / 1.0001 ** MEME_INITIAL_TICK,
    ).toBeCloseTo(MEME_STARTING_FDV_ETH, 9);
    expect(MEME_STARTING_FDV_ETH_LABEL).toBe("1.36 ETH");
  });

  it("deducts the fixed Programmable share from the fixed total", () => {
    const onePercent = getMemeFeeBreakdown(createEmptyDraft());
    const changedFee = getMemeFeeBreakdown({
      ...createEmptyDraft(),
      totalSwapFeePercent: "2",
    });

    expect(onePercent).toEqual({
      totalSwapFeeBps: 100,
      creatorFeeBps: 90,
      launcherFeeBps: 10,
    });
    expect(changedFee).toBeNull();
  });

  it("accepts only the fixed one percent Classic fee", () => {
    expect(parseTotalSwapFeeBps("1")).toBe(100);
    expect(parseTotalSwapFeeBps(" 1 ")).toBe(100);
    expect(parseTotalSwapFeeBps("0")).toBeNull();
    expect(parseTotalSwapFeeBps("1.1")).toBeNull();
    expect(parseTotalSwapFeeBps("2")).toBeNull();
    expect(parseTotalSwapFeeBps("10")).toBeNull();
    expect(parseTotalSwapFeeBps("11")).toBeNull();
  });
});
