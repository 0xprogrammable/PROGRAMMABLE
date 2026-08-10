import { describe, expect, it } from "vitest";
import { parseEther } from "viem";

import {
  buildChartVolumeMetric,
  buildTokenDetailMetrics,
  formatPreparedMinimum,
  formatStockPairedGrossVolume,
  parseDetailPayload,
} from "../components/token-detail-view";
import type { PreparedTokenTrade } from "../components/token-trade";
import type { CanonicalTokenExploreEntry, LauncherToken } from "../lib/tokens";

const token = {
  id: "programmable",
  name: "Programmable",
  symbol: "V4",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  launchedAt: "Jul 28, 2026",
  tokenPriceEth: "0.002",
  tokenPriceUsdWad: parseEther("6").toString(),
  fdvUsdWad: parseEther("168560").toString(),
  totalSupplyRaw: parseEther("1000000").toString(),
  tokenDecimals: 18,
  activeLiquidity: "1",
  grossVolumeEth: "300",
  creatorFeesGeneratedEth: "3",
  launcherFeesGeneratedEth: "0.3",
  totalSwapFeeBps: 100,
  liquidityPath: "meme",
} satisfies LauncherToken;

const canonicalToken = {
  ...token,
  exploreKind: "token",
  launchCategoryProvenance: {
    schemaVersion: "programmable.explore-launch-category-provenance.v1",
    category: "classic",
    source: "canonical-launch-read-model",
    recordId: token.id,
    modelId: null,
    modelVersion: null,
  },
} satisfies CanonicalTokenExploreEntry;

describe("token detail metrics", () => {
  it("shows only user-facing market stats and converts volume to USD", () => {
    expect(buildTokenDetailMetrics(token)).toEqual([
      { label: "FDV", value: "$168.56K" },
      { label: "Category", value: "Classic" },
      { label: "Volume", value: "$900K" },
      { label: "Swap fee", value: "1%" },
    ]);
  });

  it("never exposes internal fee accounting in the detail metrics", () => {
    const labels = buildTokenDetailMetrics(token).map((metric) => metric.label);

    expect(labels).not.toContain("Creator fees");
    expect(labels).not.toContain("Launcher fees");
    expect(labels).not.toContain("Network fee");
  });

  it("shows unavailable instead of inventing FDV without reliable supply or liquidity", () => {
    const withoutSupply = {
      ...token,
      totalSupplyRaw: undefined,
    } satisfies LauncherToken;
    const withoutLiquidity = {
      ...token,
      activeLiquidity: "0",
    } satisfies LauncherToken;

    expect(buildTokenDetailMetrics(withoutSupply)[0]).toEqual({
      label: "FDV",
      value: "Unavailable",
    });
    expect(buildTokenDetailMetrics(withoutLiquidity, "$999M")[0]).toEqual({
      label: "FDV",
      value: "Unavailable",
    });
  });

  it("uses the chart-point FDV while the chart is inspected", () => {
    expect(buildTokenDetailMetrics(token, "$212.4K")[0]).toEqual({
      label: "FDV",
      value: "$212.4K",
    });
  });

  it("uses the same total-supply FDV shown on Explore", () => {
    expect(
      buildTokenDetailMetrics({
        ...token,
        indexedMarketCapEth: "12.5",
        indexedMarketCapUsdWad: parseEther("43750").toString(),
      })[0],
    ).toEqual({
      label: "FDV",
      value: "$43.75K",
    });
  });

  it("replaces all-time volume with the selected chart range", () => {
    const volume = buildChartVolumeMetric({
      range: "1h",
      pending: false,
      volumeEth: "12.5",
      volumeUsdWad: parseEther("43750").toString(),
    });

    expect(buildTokenDetailMetrics(token, null, volume)).toEqual([
      { label: "FDV", value: "$168.56K" },
      { label: "Category", value: "Classic" },
      { label: "Volume 1H", value: "$43.8K" },
      { label: "Swap fee", value: "1%" },
    ]);
  });

  it("never presents all-time volume while a shorter range is loading", () => {
    const volume = buildChartVolumeMetric({
      range: "1w",
      pending: true,
    });

    expect(
      buildTokenDetailMetrics(token, null, volume).find((metric) =>
        metric.label.startsWith("Volume"),
      ),
    ).toEqual({ label: "Volume 1W", value: "—" });
    expect(buildChartVolumeMetric(null)).toBeUndefined();
    expect(
      buildChartVolumeMetric({
        range: "all",
        pending: false,
        volumeEth: "1",
      }),
    ).toBeUndefined();
  });

  it("labels the fixed Deep V3 hook charge without implying it includes protocol fees", () => {
    expect(
      buildTokenDetailMetrics({
        ...token,
        launchModel: "deep",
        deepReleaseVersion: "deep-full-range-v3",
      }).at(-1),
    ).toEqual({ label: "Deep fee", value: "1%" });
  });

  it("prefers official Uniswap v4 USD volume and shows pool liquidity", () => {
    const enriched = {
      ...token,
      uniswapV4Pool: {
        source: "official-uniswap-v4-subgraph",
        indexedBlockNumber: "25630000",
        indexedBlockHash: `0x${"44".repeat(32)}`,
        volumeUsdWad: parseEther("1234567").toString(),
        tvlUsdWad: parseEther("98765").toString(),
        transactionCount: "42",
        liquidity: "123456789",
        sqrtPriceX96: "79228162514264337593543950336",
        tick: -120,
        feeTierPips: "0",
      },
    } satisfies LauncherToken;

    expect(buildTokenDetailMetrics(enriched)).toEqual([
      { label: "FDV", value: "$168.56K" },
      { label: "Category", value: "Classic" },
      { label: "Volume", value: "$1.2M" },
      { label: "Liquidity now", value: "$98.8K" },
      { label: "Swap fee", value: "1%" },
    ]);
  });

  it("strictly validates optional official Uniswap v4 pool analytics", () => {
    const validPool = {
      source: "official-uniswap-v4-subgraph",
      indexedBlockNumber: "25630000",
      indexedBlockHash: `0x${"44".repeat(32)}`,
      volumeUsdWad: parseEther("1234").toString(),
      tvlUsdWad: parseEther("98.7").toString(),
      transactionCount: "42",
      liquidity: "123456789",
      sqrtPriceX96: "79228162514264337593543950336",
      tick: -120,
      feeTierPips: "0",
    };
    const payload = {
      status: "ready",
      token: { ...canonicalToken, uniswapV4Pool: validPool },
      snapshot: { chainId: 1 },
    };

    expect(parseDetailPayload(payload).token?.uniswapV4Pool).toEqual(validPool);
    expect(() =>
      parseDetailPayload({
        ...payload,
        token: {
          ...canonicalToken,
          valuation: {
            status: "available",
            metric: "market-cap",
            valueWad: "1",
          },
        },
      }),
    ).toThrow("invalid token record");
    expect(() =>
      parseDetailPayload({
        ...payload,
        token: {
          ...token,
          uniswapV4Pool: {
            ...validPool,
            volumeUsdWad: "1234.5",
          },
        },
      }),
    ).toThrow("invalid token record");
    expect(() =>
      parseDetailPayload({
        ...payload,
        token: {
          ...token,
          uniswapV4Pool: {
            ...validPool,
            unexpected: "not trusted",
          },
        },
      }),
    ).toThrow("invalid token record");
  });

  it("uses the validated Stock-Paired USD rate for gross volume and ignores mislabeled subgraph USD", () => {
    const stockToken = {
      ...token,
      launchModel: "stock-paired",
      quoteAssetSymbol: "SVON",
      tokenPriceQuoteWad: parseEther("2").toString(),
      tokenPriceUsdWad: parseEther("6").toString(),
      grossVolumeEth: undefined,
      grossVolumeQuote: "18.3",
      grossVolumeQuoteRaw: parseEther("18.3").toString(),
      uniswapV4Pool: {
        source: "official-uniswap-v4-subgraph",
        indexedBlockNumber: "25630000",
        indexedBlockHash: `0x${"44".repeat(32)}`,
        volumeUsdWad: "0",
        tvlUsdWad: "0",
        transactionCount: "2",
        liquidity: "123456789",
        sqrtPriceX96: "79228162514264337593543950336",
        feeTierPips: "0",
      },
    } satisfies LauncherToken;

    expect(formatStockPairedGrossVolume(stockToken)).toBe("$54.90");
    expect(
      buildTokenDetailMetrics(stockToken).find(
        (metric) => metric.label === "Volume",
      ),
    ).toEqual({ label: "Volume", value: "$54.90" });
  });

  it("shows Stock-Paired gross volume in its quote unit when no validated USD rate is available", () => {
    const stockToken = {
      ...token,
      launchModel: "stock-paired",
      quoteAssetSymbol: "SVON",
      tokenPriceQuoteWad: parseEther("2").toString(),
      tokenPriceUsdWad: undefined,
      grossVolumeEth: undefined,
      grossVolumeQuote: "18.3",
      grossVolumeQuoteRaw: parseEther("18.3").toString(),
    } satisfies LauncherToken;

    expect(formatStockPairedGrossVolume(stockToken)).toBe("18.3 SVON");
    expect(
      buildTokenDetailMetrics(stockToken).find(
        (metric) => metric.label === "Volume",
      ),
    ).toEqual({ label: "Volume", value: "18.3 SVON" });
  });

  it("labels the canonical Stock-Paired sell output as ETH after unwrap", () => {
    const prepared = {
      side: "sell",
      quote: {
        amountOutMinimum: parseEther("0.25").toString(),
      },
    } as PreparedTokenTrade;

    expect(formatPreparedMinimum(prepared, "STOCK", 18)).toBe("0.25 ETH");
  });
});
