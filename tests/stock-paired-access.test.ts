import { describe, expect, it } from "vitest";

import {
  STOCK_PAIRED_NEW_LAUNCHES_ENABLED,
  isStockPairedDevAccount,
  isStockPairedPublicLaunchEnabled,
} from "../lib/stock-paired-access";

describe("Stock-Paired access", () => {
  it("binds the reviewed switch to V3 on Ethereum Mainnet only", () => {
    const release = {
      internalContractRelease: "stock-paired-v3",
      chainId: 1,
    };
    expect(
      isStockPairedPublicLaunchEnabled("production", release),
    ).toBe(STOCK_PAIRED_NEW_LAUNCHES_ENABLED);
    expect(
      isStockPairedPublicLaunchEnabled("rehearsal", release),
    ).toBe(false);
  });

  it("fails closed for missing and historical releases", () => {
    expect(
      isStockPairedPublicLaunchEnabled("production", null),
    ).toBe(false);
    for (const internalContractRelease of [
      "stock-paired-v1",
      "stock-paired-v2",
    ]) {
      expect(
        isStockPairedPublicLaunchEnabled("production", {
          internalContractRelease,
          chainId: 1,
        }),
      ).toBe(false);
    }
  });

  it("never gives an unreviewed wallet privileged access", () => {
    expect(
      isStockPairedDevAccount(
        "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
      ),
    ).toBe(STOCK_PAIRED_NEW_LAUNCHES_ENABLED);
    expect(
      isStockPairedDevAccount(
        "0x1111111111111111111111111111111111111111",
      ),
    ).toBe(false);
  });
});
