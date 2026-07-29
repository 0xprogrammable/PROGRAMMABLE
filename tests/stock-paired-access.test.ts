import { describe, expect, it } from "vitest";

import { isStockPairedPublicLaunchEnabled } from "../lib/stock-paired-access";

describe("Stock-Paired public access", () => {
  it("allows a verified Mainnet V2 release without a wallet allowlist", () => {
    const release = {
      internalContractRelease: "stock-paired-v2",
      chainId: 1,
    };

    expect(
      isStockPairedPublicLaunchEnabled("production", release),
    ).toBe(true);
    expect(
      isStockPairedPublicLaunchEnabled("rehearsal", release),
    ).toBe(false);
  });

  it("fails closed without the verified V2 release", () => {
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
        chainId: 11_155_111,
      }),
    ).toBe(false);
  });
});
