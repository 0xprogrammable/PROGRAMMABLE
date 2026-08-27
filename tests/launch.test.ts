import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  buildLaunchSummary,
  buildPlainTextPlan,
  createClassicV3Draft,
  createEmptyDraft,
  getClassicInitialBuyCurveQuote,
  getClassicInitialBuyPreview,
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
  parseClassicFeePercentToBps,
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

  it("awaits asynchronous launch preparation inside the error boundary", () => {
    const preflightSource = readFileSync(
      new URL("../app/api/launch/preflight/route.ts", import.meta.url),
      "utf8",
    );

    expect(preflightSource).toContain(
      "return await prepareAdaptiveLaunch(",
    );
    expect(preflightSource).toContain(
      "return await prepareClassicV3Launch(",
    );
    expect(preflightSource).toContain(
      "return await prepareMemeLaunch(",
    );
  });

  it("bounds the immutable Classic preflight reads without weakening them", () => {
    const preflightSource = readFileSync(
      new URL("../app/api/launch/preflight/route.ts", import.meta.url),
      "utf8",
    );

    expect(preflightSource).toContain(
      "const LAUNCH_RPC_MULTICALL_BATCH_BYTES = 16_384;",
    );
    expect(preflightSource).toContain(
      "batchSize: LAUNCH_RPC_MULTICALL_BATCH_BYTES",
    );
    expect(preflightSource).not.toContain("LAUNCH_RPC_JSON_BATCH_SIZE");
    expect(preflightSource).toContain(
      "for (const [address, expected, label] of runtimeCodeBindings)",
    );
    expect(preflightSource).toContain(
      "await assertClassicV3Infrastructure(",
    );
  });

  it("routes V4 through the manifest gate and complete call simulation", () => {
    const preflightSource = readFileSync(
      new URL("../app/api/launch/preflight/route.ts", import.meta.url),
      "utf8",
    );

    expect(preflightSource).toContain(
      'draft.classicContractRelease === "classic-v4"',
    );
    expect(preflightSource).toContain(
      "getConfiguredClassicV4PublicRelease(",
    );
    expect(preflightSource).toContain(
      "if (!isClassicV4PublicActionRelease(release))",
    );
    expect(preflightSource).toContain("prepareClassicV4Launch(");
    expect(preflightSource).toContain("const simulation = await rpcClient.call({");
    expect(preflightSource).toContain(
      'functionName: "launch",\n    data: simulation.data,',
    );
    expect(preflightSource).toContain(
      "releaseManifestDigest: release.manifestDigest",
    );
  });

  it("starts every new draft on the single supported launch path", () => {
    const draft = createEmptyDraft();

    expect(draft.assetMode).toBe("new");
    expect(draft.liquidityMode).toBe("meme");
    expect(draft.tokenSupply).toBe("1000000000");
    expect(draft.selectedBehaviors).toEqual(["fixed-fee"]);
    expect(draft.lpFeePercent).toBe("0");
    expect(draft.initialBuyEth).toBe(MEME_MIN_INITIAL_BUY_ETH);
    expect(draft.classicLiquidityPreset).toBe("standard");
    expect(createClassicV3Draft()).toMatchObject({
      launchModel: "classic-v3",
      classicLiquidityPreset: "standard",
    });
  });

  it("parses Classic fee decimals exactly in 0.1% steps", () => {
    for (const [value, expected] of [
      ["0.1", 10],
      ["0.10", 10],
      [" 1 ", 100],
      ["1.0", 100],
      ["1.00", 100],
      ["1.5", 150],
      ["3.7", 370],
      ["9.9", 990],
      ["10", 1_000],
      ["10.00", 1_000],
    ] as const) {
      expect(parseClassicFeePercentToBps(value)).toBe(expected);
    }

    for (const value of [
      "",
      "0",
      "0.01",
      "0.11",
      ".1",
      "01",
      "1.",
      "1.01",
      "1e0",
      "1,0",
      "+1",
      "-1",
      "10.1",
      "11",
    ]) {
      expect(parseClassicFeePercentToBps(value)).toBeNull();
    }
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

  it("previews the initial buy output and share of the fixed supply", () => {
    const minimumBuy = getClassicInitialBuyPreview("0.0006", "1");
    const largerBuy = getClassicInitialBuyPreview("0.03", "1");

    expect(minimumBuy).not.toBeNull();
    expect(minimumBuy?.poolEthAmount).toBeCloseTo(0.000594, 12);
    expect(minimumBuy?.tokenAmount).toBeCloseTo(437_971.7816, 3);
    expect(minimumBuy?.supplyPercent).toBeCloseTo(0.043797, 5);
    expect(largerBuy?.tokenAmount).toBeCloseTo(21_438_505.518, 2);
    expect(largerBuy?.supplyPercent).toBeCloseTo(2.143851, 5);
  });

  it("accounts for the selected buy fee in the initial buy preview", () => {
    const minimumFee = getClassicInitialBuyPreview("0.03", "0.1");
    const onePercentFee = getClassicInitialBuyPreview("0.03", "1");
    const tenPercentFee = getClassicInitialBuyPreview("0.03", "10");

    expect(minimumFee?.poolEthAmount).toBeCloseTo(0.02997, 12);
    expect(minimumFee?.tokenAmount).toBeGreaterThan(
      onePercentFee?.tokenAmount ?? Number.POSITIVE_INFINITY,
    );
    expect(tenPercentFee?.tokenAmount).toBeLessThan(
      onePercentFee?.tokenAmount ?? 0,
    );
    expect(getClassicInitialBuyPreview("0.0005", "1")).toBeNull();
    expect(getClassicInitialBuyPreview("0.03", "1.01")).toBeNull();
    expect(getClassicInitialBuyPreview("0.03", "11")).toBeNull();
  });

  it("makes the initial-buy preview aware of the bounded Deeper preset", () => {
    const standard = getClassicInitialBuyPreview("0.03", "1", "standard");
    const deeper = getClassicInitialBuyPreview("0.03", "1", "deep-30");

    expect(standard?.tokenAmount).toBeCloseTo(21_438_505.518, 2);
    expect(deeper?.tokenAmount).toBeCloseTo(21_544_712.788, 2);
    expect(deeper?.tokenAmount).toBeGreaterThan(standard?.tokenAmount ?? 0);
    expect(deeper?.poolEthAmount).toBe(standard?.poolEthAmount);
    expect(deeper?.curveCapacityWei).toBe(5_895_641_055_945_908_140n);
    expect(deeper?.remainingCurveCapacityWei).toBe(
      5_865_941_055_945_908_140n,
    );
    expect(deeper?.endPriceMultipleWad).toBe(
      18_913_066_072_547_532_342n,
    );
  });

  it("uses exact fee rounding and rejects rather than clamps over-capacity Deeper buys", () => {
    const exact = getClassicInitialBuyCurveQuote(
      "5.901542598544452592",
      "0.1",
      "deep-30",
    );
    const over = getClassicInitialBuyCurveQuote(
      "5.901542598544452593",
      "0.1",
      "deep-30",
    );

    expect(exact.status).toBe("ready");
    if (exact.status === "ready") {
      expect(exact.preview.poolEthWei).toBeLessThanOrEqual(
        exact.preview.curveCapacityWei ?? 0n,
      );
      expect(exact.preview.tokenAmountWei).toBeLessThanOrEqual(
        1_000_000_000n * 10n ** 18n,
      );
    }
    expect(over.status).toBe("over-capacity");
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
