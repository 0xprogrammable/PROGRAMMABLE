import { describe, expect, it } from "vitest";

import { isStockPairedPublicLaunchEnabled } from "../lib/stock-paired-access";

describe("Stock-Paired public access", () => {
  it("keeps public launches closed while the V3 release is being prepared", () => {
    const release = {
      internalContractRelease: "stock-paired-v3",
      chainId: 1,
    };

    expect(
      isStockPairedPublicLaunchEnabled("production", release),
    ).toBe(false);
    expect(
      isStockPairedPublicLaunchEnabled("rehearsal", release),
    ).toBe(false);
  });

  it("fails closed for missing and historical releases", () => {
    expect(
      isStockPairedPublicLaunchEnabled("production", null),
    ).toBe(false);
    expect(
      isStockPairedPublicLaunchEnabled("production", {
        internalContractRelease: "stock-paired-v1",
        chainId: 1,
      }),
    ).toBe(false);
    expect(
      isStockPairedPublicLaunchEnabled("production", {
        internalContractRelease: "stock-paired-v2",
        chainId: 1,
      }),
    ).toBe(false);
  });
});
