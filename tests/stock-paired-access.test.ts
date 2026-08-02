import { describe, expect, it } from "vitest";

import {
  STOCK_PAIRED_NEW_LAUNCHES_ENABLED,
  isStockPairedDevAccount,
  isStockPairedPublicLaunchEnabled,
} from "../lib/stock-paired-access";

describe("Stock-Paired access", () => {
  it("keeps new launches closed for every environment and release", () => {
    const release = {
      internalContractRelease: "stock-paired-v3",
      chainId: 1,
    };
    expect(STOCK_PAIRED_NEW_LAUNCHES_ENABLED).toBe(false);
    expect(
      isStockPairedPublicLaunchEnabled("production", release),
    ).toBe(false);
    expect(
      isStockPairedPublicLaunchEnabled("rehearsal", release),
    ).toBe(false);
    expect(
      isStockPairedPublicLaunchEnabled("production", {
        ...release,
        chainId: 8453,
      }),
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

  it("does not retain a privileged launch wallet", () => {
    expect(
      isStockPairedDevAccount(
        "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
      ),
    ).toBe(false);
    expect(
      isStockPairedDevAccount(
        "0x1111111111111111111111111111111111111111",
      ),
    ).toBe(false);
  });
});
