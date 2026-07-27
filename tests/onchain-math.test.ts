import { describe, expect, it } from "vitest";

import {
  marketCapNativeWad,
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "../lib/onchain/math";

const Q96 = 1n << 96n;
const WAD = 10n ** 18n;

describe("Uniswap v4 native/token price math", () => {
  it("inverts currency1 per currency0 into ETH per token", () => {
    expect(nativePriceWadFromSqrtPriceX96(Q96, 18)).toBe(WAD);
    expect(nativePriceWadFromSqrtPriceX96(2n * Q96, 18)).toBe(
      WAD / 4n,
    );
  });

  it("accounts for token decimals without floating point math", () => {
    expect(nativePriceWadFromSqrtPriceX96(Q96, 6)).toBe(1_000_000n);
  });

  it("calculates ETH-denominated fully diluted market cap", () => {
    const supply = 1_000_000_000n * WAD;
    expect(marketCapNativeWad(supply, 18, WAD / 4n)).toBe(
      250_000_000n * WAD,
    );
    expect(
      marketCapNativeWadFromSqrtPriceX96(supply, 2n * Q96),
    ).toBe(250_000_000n * WAD);
  });

  it("retains market-cap precision below one wei per token", () => {
    const supply = 1_000_000_000n * WAD;
    const sqrtPriceX96 = 10n ** 10n * Q96;
    expect(nativePriceWadFromSqrtPriceX96(sqrtPriceX96, 18)).toBe(0n);
    expect(
      marketCapNativeWadFromSqrtPriceX96(supply, sqrtPriceX96),
    ).toBe(10_000_000n);
  });

  it("rejects an uninitialized pool price", () => {
    expect(() => nativePriceWadFromSqrtPriceX96(0n, 18)).toThrow(
      "not initialized",
    );
  });
});
