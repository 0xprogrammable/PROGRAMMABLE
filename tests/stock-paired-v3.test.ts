import { describe, expect, it } from "vitest";

import {
  STOCK_PAIRED_V3_CONFIG,
  STOCK_PAIRED_V3_QUOTE_ASSETS,
} from "../lib/stock-paired-v3";

describe("Stock-Paired V3 price configuration", () => {
  it("binds exactly the six reviewed quote assets and ticks", () => {
    expect(
      STOCK_PAIRED_V3_QUOTE_ASSETS.map(
        ({ symbol, initialAbsoluteTick }) => [
          symbol,
          initialAbsoluteTick,
        ],
      ),
    ).toEqual([
      ["NVDAon", 181_200],
      ["SPYon", 194_600],
      ["GOOGLon", 186_800],
      ["SLVon", 168_200],
      ["TSLAon", 185_600],
      ["AAPLon", 187_000],
    ]);
    expect(
      STOCK_PAIRED_V3_QUOTE_ASSETS.some(
        ({ symbol }) => symbol === "QQQon",
      ),
    ).toBe(false);
  });

  it("pins calibration evidence and the pre-release drift thresholds", () => {
    expect(STOCK_PAIRED_V3_CONFIG).toMatchObject({
      targetInitialFdvEth: "1.355657760817103798",
      tickSpacing: 200,
      calibration: {
        blockNumber: 25_642_460,
        blockHash:
          "0xefb6c45e3523ffc588d4c498cd6fd5ab528371f293eebc70375857a53fe12718",
        maximumInitialFdvDeviationBps: 500,
        maximumReferenceDriftBps: 300,
        maximumTickRoundingDeviationBps: 100,
        maximumActivationEvidenceAgeSeconds: 900,
        oracleClaim: false,
      },
    });
  });
});
