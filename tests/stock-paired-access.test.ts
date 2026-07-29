import { describe, expect, it } from "vitest";

import { isStockPairedDevAccount } from "../lib/stock-paired-access";

describe("Stock-Paired dev access", () => {
  it("allows only the approved launch wallet", () => {
    expect(
      isStockPairedDevAccount(
        "0x2Bb333d48DFAF1596D9036671d2E43168994249E",
      ),
    ).toBe(true);
    expect(
      isStockPairedDevAccount(
        "0x2bb333d48dfaf1596d9036671d2e43168994249e",
      ),
    ).toBe(true);
    expect(
      isStockPairedDevAccount(
        "0x1111111111111111111111111111111111111111",
      ),
    ).toBe(false);
    expect(isStockPairedDevAccount("not-a-wallet")).toBe(false);
    expect(isStockPairedDevAccount(null)).toBe(false);
  });
});
