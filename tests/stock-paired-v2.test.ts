import { describe, expect, it } from "vitest";

import {
  getStockPairedV2QuoteAsset,
  STOCK_PAIRED_V2_ASSET_COUNT,
  STOCK_PAIRED_V2_MIN_ROUTE_ROUND_TRIP_BPS,
  STOCK_PAIRED_V2_QUOTE_ASSETS,
  STOCK_PAIRED_V2_ROUTE_POLICY,
} from "../lib/stock-paired-v2";

const expectedSymbols = [
  "NVDAon",
  "SPYon",
  "GOOGLon",
  "SLVon",
  "TSLAon",
  "AAPLon",
  "BABAon",
  "COPXon",
  "CRCLon",
  "TLTon",
  "USOon",
] as const;

describe("Stock-Paired V2 quote assets", () => {
  it("pins exactly the eleven route-reviewed assets", () => {
    expect(STOCK_PAIRED_V2_QUOTE_ASSETS).toHaveLength(
      STOCK_PAIRED_V2_ASSET_COUNT,
    );
    expect(STOCK_PAIRED_V2_QUOTE_ASSETS.map(({ symbol }) => symbol)).toEqual(
      expectedSymbols,
    );
  });

  it("keeps official asset records, logos, routes, and route quality together", () => {
    for (const asset of STOCK_PAIRED_V2_QUOTE_ASSETS) {
      expect(asset.ondoAssetUrl).toBe(
        `https://app.ondo.finance/assets/${asset.symbol.toLowerCase()}`,
      );
      expect(asset.logoUrl).toBe(
        `https://cdn.ondo.finance/tokens/logos/${asset.symbol.toLowerCase()}_160x160.png`,
      );
      expect(asset.route.snapshotRoundTripBps).toBeGreaterThanOrEqual(
        STOCK_PAIRED_V2_MIN_ROUTE_ROUND_TRIP_BPS,
      );
      expect(getStockPairedV2QuoteAsset(asset.address)).toBe(asset);
    }
  });

  it("does not expose popular assets that failed the reviewed ETH route", () => {
    const symbols = new Set(
      STOCK_PAIRED_V2_QUOTE_ASSETS.map(({ symbol }) => symbol),
    );
    expect(symbols.has("GMEon")).toBe(false);
    expect(symbols.has("RDDTon")).toBe(false);
    expect(symbols.has("SPCXon")).toBe(false);
  });

  it("pins the complete Uniswap V3 route dependency set", () => {
    expect(STOCK_PAIRED_V2_ROUTE_POLICY).toMatchObject({
      wethUsdcFee: 500,
      minimumRoundTripBps: 9_000,
      snapshotInputWei: "10000000000000000",
    });
    expect(STOCK_PAIRED_V2_ROUTE_POLICY.v3Factory).not.toBe(
      STOCK_PAIRED_V2_ROUTE_POLICY.v3Quoter,
    );
    expect(STOCK_PAIRED_V2_ROUTE_POLICY.weth).not.toBe(
      STOCK_PAIRED_V2_ROUTE_POLICY.usdc,
    );
  });
});
