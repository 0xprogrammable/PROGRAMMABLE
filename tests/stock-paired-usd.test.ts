import { getAddress, type Hex, type PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  createStockQuoteUsdCache,
  enrichStockPairedTokenWithUsd,
  readStockQuoteAssetUsdWad,
  STOCK_QUOTE_USD_CACHE_TTL_MS,
  stockQuoteAssetUsdWadFromSqrtPriceX96,
  validateStockQuoteUsdSnapshot,
  type StockQuoteUsdSnapshot,
} from "../lib/onchain/stock-paired-usd";
import { STOCK_QUOTE_ASSETS } from "../lib/stock-paired";
import {
  getStockPairedEthRoute,
  STOCK_PAIRED_ROUTE_RUNTIME_HASHES,
  STOCK_PAIRED_USDC,
} from "../lib/trade/stock-paired-route";
import type { LauncherToken } from "../lib/tokens";

const Q96 = 1n << 96n;
const WAD = 10n ** 18n;
const QUOTE_ASSET = STOCK_QUOTE_ASSETS[0].address;
const STOCK_HOP = getStockPairedEthRoute(QUOTE_ASSET).buyHops[1];
const QUOTE_RUNTIME_HASH = `0x${"11".repeat(32)}` as Hex;
const OTHER_ADDRESS = getAddress(
  "0x1111111111111111111111111111111111111111",
);

function validSnapshot(
  overrides: Partial<StockQuoteUsdSnapshot> = {},
): StockQuoteUsdSnapshot {
  return {
    factoryRuntimeCodeHash: STOCK_PAIRED_ROUTE_RUNTIME_HASHES.v3Factory,
    usdcRuntimeCodeHash: STOCK_PAIRED_ROUTE_RUNTIME_HASHES.usdc,
    quoteAssetRuntimeCodeHash: QUOTE_RUNTIME_HASH,
    poolRuntimeCodeHash: STOCK_HOP.poolRuntimeCodeHash,
    canonicalPool: STOCK_HOP.pool,
    token0: QUOTE_ASSET,
    token1: STOCK_PAIRED_USDC,
    fee: STOCK_HOP.fee,
    liquidity: 1n,
    sqrtPriceX96: Q96 / 1_000_000n,
    ...overrides,
  };
}

function validate(snapshot = validSnapshot()) {
  return validateStockQuoteUsdSnapshot({
    quoteAsset: QUOTE_ASSET,
    expectedQuoteAssetRuntimeCodeHash: QUOTE_RUNTIME_HASH,
    stockHop: STOCK_HOP,
    snapshot,
  });
}

function stockToken(
  overrides: Partial<LauncherToken> = {},
): LauncherToken {
  return {
    id: "1:stock",
    name: "Stock Pair",
    symbol: "PAIR",
    tokenAddress: getAddress(
      "0x2222222222222222222222222222222222222222",
    ),
    hookAddress: getAddress(
      "0x3333333333333333333333333333333333333333",
    ),
    poolId: `0x${"44".repeat(32)}`,
    launchedAt: "2026-07-29T00:00:00.000Z",
    quoteAssetAddress: QUOTE_ASSET,
    quoteAssetSymbol: STOCK_QUOTE_ASSETS[0].symbol,
    tokenPriceQuoteWad: (2n * 10n ** 16n).toString(),
    marketCapQuoteWad: (183n * 10n ** 17n).toString(),
    totalSwapFeeBps: 100,
    launchModel: "stock-paired",
    liquidityPath: "meme",
    ...overrides,
  };
}

describe("Stock-Paired USD pricing", () => {
  it("deduplicates in-flight reads and expires cached prices before thirty seconds", async () => {
    let now = 0;
    const cache = createStockQuoteUsdCache({
      ttlMs: STOCK_QUOTE_USD_CACHE_TTL_MS,
      now: () => now,
    });
    const readPrice = vi.fn(async () => 50n * WAD);

    const first = cache.read("quote:runtime", readPrice);
    const second = cache.read("quote:runtime", readPrice);

    expect(second).toBe(first);
    await expect(first).resolves.toBe(50n * WAD);
    expect(readPrice).toHaveBeenCalledTimes(1);

    now = STOCK_QUOTE_USD_CACHE_TTL_MS - 1;
    await expect(cache.read("quote:runtime", readPrice)).resolves.toBe(
      50n * WAD,
    );
    expect(readPrice).toHaveBeenCalledTimes(1);

    now = STOCK_QUOTE_USD_CACHE_TTL_MS;
    await expect(cache.read("quote:runtime", readPrice)).resolves.toBe(
      50n * WAD,
    );
    expect(readPrice).toHaveBeenCalledTimes(2);
    expect(STOCK_QUOTE_USD_CACHE_TTL_MS).toBeLessThan(30_000);
  });

  it("fails closed instead of serving an expired USD price", async () => {
    let now = 0;
    const cache = createStockQuoteUsdCache({
      ttlMs: STOCK_QUOTE_USD_CACHE_TTL_MS,
      now: () => now,
    });
    const readPrice = vi
      .fn<() => Promise<bigint | null>>()
      .mockResolvedValueOnce(50n * WAD)
      .mockResolvedValueOnce(null);

    await expect(cache.read("quote:runtime", readPrice)).resolves.toBe(
      50n * WAD,
    );
    now = STOCK_QUOTE_USD_CACHE_TTL_MS;
    await expect(cache.read("quote:runtime", readPrice)).resolves.toBeNull();
    expect(readPrice).toHaveBeenCalledTimes(2);
  });

  it("handles either v3 token ordering", () => {
    expect(
      stockQuoteAssetUsdWadFromSqrtPriceX96({
        sqrtPriceX96: Q96,
        stockIsToken0: true,
        stockDecimals: 18,
        usdcDecimals: 18,
      }),
    ).toBe(WAD);
    expect(
      stockQuoteAssetUsdWadFromSqrtPriceX96({
        sqrtPriceX96: Q96,
        stockIsToken0: false,
        stockDecimals: 18,
        usdcDecimals: 18,
      }),
    ).toBe(WAD);
  });

  it("accounts for the stock and USDC decimal difference", () => {
    const stockToken0 = stockQuoteAssetUsdWadFromSqrtPriceX96({
      sqrtPriceX96: Q96 / 1_000_000n,
      stockIsToken0: true,
    });
    const stockToken1 = stockQuoteAssetUsdWadFromSqrtPriceX96({
      sqrtPriceX96: Q96 * 1_000_000n,
      stockIsToken0: false,
    });

    expect(stockToken0).toBeGreaterThan(WAD - 100_000_000n);
    expect(stockToken0).toBeLessThanOrEqual(WAD);
    expect(stockToken1).toBe(WAD);
  });

  it("rejects invalid prices and decimal domains", () => {
    expect(() =>
      stockQuoteAssetUsdWadFromSqrtPriceX96({
        sqrtPriceX96: 0n,
        stockIsToken0: true,
      }),
    ).toThrow(/invalid/);
    expect(() =>
      stockQuoteAssetUsdWadFromSqrtPriceX96({
        sqrtPriceX96: Q96,
        stockIsToken0: true,
        stockDecimals: 37,
      }),
    ).toThrow(/invalid/);
  });

  it("requires the pinned runtimes, factory pool, currencies, fee and liquidity", () => {
    expect(validate()).toBeGreaterThan(0n);

    expect(() =>
      validate(
        validSnapshot({
          poolRuntimeCodeHash: `0x${"ff".repeat(32)}`,
        }),
      ),
    ).toThrow(/route is invalid/);
    expect(() =>
      validate(
        validSnapshot({
          quoteAssetRuntimeCodeHash: `0x${"ff".repeat(32)}`,
        }),
      ),
    ).toThrow(/route is invalid/);
    expect(() =>
      validate(validSnapshot({ canonicalPool: OTHER_ADDRESS })),
    ).toThrow(/route is invalid/);
    expect(() =>
      validate(validSnapshot({ token1: OTHER_ADDRESS })),
    ).toThrow(/route is invalid/);
    expect(() => validate(validSnapshot({ fee: STOCK_HOP.fee + 1 }))).toThrow(
      /route is invalid/,
    );
    expect(() => validate(validSnapshot({ liquidity: 0n }))).toThrow(
      /route is invalid/,
    );
  });

  it("requires two agreeing RPC snapshots", async () => {
    const first = {} as PublicClient;
    const second = {} as PublicClient;
    const readSnapshot = vi.fn(async () => validSnapshot());

    await expect(
      readStockQuoteAssetUsdWad({
        clients: [first, second],
        quoteAsset: QUOTE_ASSET,
        expectedQuoteAssetRuntimeCodeHash: QUOTE_RUNTIME_HASH,
        blockNumber: 123n,
        readSnapshot,
      }),
    ).resolves.toBe(validate());
    expect(readSnapshot).toHaveBeenCalledTimes(2);
    expect(readSnapshot).toHaveBeenCalledWith(
      first,
      expect.objectContaining({
        quoteAsset: QUOTE_ASSET,
        blockNumber: 123n,
      }),
    );
  });

  it("falls back when RPCs disagree or route validation fails", async () => {
    const first = {} as PublicClient;
    const second = {} as PublicClient;

    await expect(
      readStockQuoteAssetUsdWad({
        clients: [first, second],
        quoteAsset: QUOTE_ASSET,
        expectedQuoteAssetRuntimeCodeHash: QUOTE_RUNTIME_HASH,
        blockNumber: 123n,
        readSnapshot: async (client) =>
          client === first
            ? validSnapshot()
            : validSnapshot({ sqrtPriceX96: Q96 / 999_999n }),
      }),
    ).resolves.toBeNull();
    await expect(
      readStockQuoteAssetUsdWad({
        clients: [first, second],
        quoteAsset: QUOTE_ASSET,
        expectedQuoteAssetRuntimeCodeHash: QUOTE_RUNTIME_HASH,
        blockNumber: 123n,
        readSnapshot: async (client) =>
          validSnapshot({ liquidity: client === first ? 1n : 2n }),
      }),
    ).resolves.toBeNull();
    await expect(
      readStockQuoteAssetUsdWad({
        clients: [first, second],
        quoteAsset: QUOTE_ASSET,
        expectedQuoteAssetRuntimeCodeHash: QUOTE_RUNTIME_HASH,
        blockNumber: 123n,
        readSnapshot: async () => validSnapshot({ liquidity: 0n }),
      }),
    ).resolves.toBeNull();
    await expect(
      readStockQuoteAssetUsdWad({
        clients: [first],
        quoteAsset: QUOTE_ASSET,
        expectedQuoteAssetRuntimeCodeHash: QUOTE_RUNTIME_HASH,
        blockNumber: 123n,
      }),
    ).resolves.toBeNull();
  });

  it("adds USD price and market cap without replacing quote truth", () => {
    const token = stockToken();
    const enriched = enrichStockPairedTokenWithUsd(token, 50n * WAD);

    expect(enriched.tokenPriceUsdWad).toBe(WAD.toString());
    expect(enriched.fdvUsdWad).toBe((915n * WAD).toString());
    expect(enriched.tokenPriceQuoteWad).toBe(token.tokenPriceQuoteWad);
    expect(enriched.marketCapQuoteWad).toBe(token.marketCapQuoteWad);
  });

  it("leaves the quote-denominated token unchanged without a trusted price", () => {
    const token = stockToken();

    expect(enrichStockPairedTokenWithUsd(token, null)).toBe(token);
    expect(
      enrichStockPairedTokenWithUsd(
        stockToken({ marketCapQuoteWad: "18.3" }),
        50n * WAD,
      ),
    ).not.toHaveProperty("fdvUsdWad");
  });
});
