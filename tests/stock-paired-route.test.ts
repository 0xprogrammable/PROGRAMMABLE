import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { STOCK_QUOTE_ASSETS } from "../lib/stock-paired";
import { STOCK_PAIRED_V2_QUOTE_ASSETS } from "../lib/stock-paired-v2";
import {
  encodeStockPairedV3Path,
  getStockPairedEthRoute,
  getStockPairedEthRouteRuntimeCodeHashes,
  STOCK_PAIRED_USDC,
  STOCK_PAIRED_WETH,
} from "../lib/trade/stock-paired-route";

describe("Stock-Paired ETH routes", () => {
  it.each(STOCK_PAIRED_V2_QUOTE_ASSETS)(
    "pins a contiguous ETH route for $symbol",
    ({ address }) => {
      const route = getStockPairedEthRoute(address);
      expect(route.buyHops).toHaveLength(2);
      expect(route.buyHops[0].tokenIn).toBe(STOCK_PAIRED_WETH);
      expect(route.buyHops[0].tokenOut).toBe(STOCK_PAIRED_USDC);
      expect(route.buyHops[1].tokenIn).toBe(STOCK_PAIRED_USDC);
      expect(route.buyHops[1].tokenOut).toBe(getAddress(address));
      expect(route.sellHops.map((hop) => hop.tokenIn)).toEqual([
        getAddress(address),
        STOCK_PAIRED_USDC,
      ]);
      expect(route.sellHops.at(-1)?.tokenOut).toBe(STOCK_PAIRED_WETH);

      const buyPath = encodeStockPairedV3Path(route.buyHops);
      const sellPath = encodeStockPairedV3Path(route.sellHops);
      expect(buyPath.slice(2, 42).toLowerCase()).toBe(
        STOCK_PAIRED_WETH.slice(2).toLowerCase(),
      );
      expect(buyPath.slice(-40).toLowerCase()).toBe(
        address.slice(2).toLowerCase(),
      );
      expect(sellPath.slice(2, 42).toLowerCase()).toBe(
        address.slice(2).toLowerCase(),
      );
      expect(sellPath.slice(-40).toLowerCase()).toBe(
        STOCK_PAIRED_WETH.slice(2).toLowerCase(),
      );

      const runtime = getStockPairedEthRouteRuntimeCodeHashes(address);
      expect(Object.keys(runtime.pools)).toHaveLength(2);
      expect(
        route.buyHops.every(
          (hop) => runtime.pools[hop.pool.toLowerCase()] !== undefined,
        ),
      ).toBe(true);
    },
  );

  it("rejects an unreviewed quote asset", () => {
    expect(() =>
      getStockPairedEthRoute("0x9999999999999999999999999999999999999999"),
    ).toThrow(/reviewed ETH route/);
  });

  it("fails closed for QQQ until its ETH route is liquid enough", () => {
    const qqq = STOCK_QUOTE_ASSETS.find((asset) => asset.symbol === "QQQon");
    expect(qqq).toBeDefined();
    expect(() => getStockPairedEthRoute(qqq!.address)).toThrow(
      /reviewed ETH route/,
    );
  });
});
