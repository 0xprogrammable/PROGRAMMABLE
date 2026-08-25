import { describe, expect, it } from "vitest";
import { parseEther } from "viem";

import {
  buildChartVolumeMetric,
  buildTokenDetailMetrics,
  createTokenDetailInitialState,
  formatPreparedMinimum,
  formatStockPairedGrossVolume,
  getValuationMetricLabel,
  parseDetailPayload,
  TOKEN_DETAIL_REQUEST_TIMEOUT_MS,
} from "../components/token-detail-view";
import type { PreparedTokenTrade } from "../components/token-trade";
import type { TokenMarketDataV1 } from "../lib/market-data/market-data-v1";
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
  indexedValuationBlockNumber: "25630000",
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
  it("keeps client retries bounded beyond the route provider budget", () => {
    expect(TOKEN_DETAIL_REQUEST_TIMEOUT_MS).toBeGreaterThan(8_000);
    expect(TOKEN_DETAIL_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it("hydrates a verified server response without a duplicate client request", () => {
    const state = createTokenDetailInitialState(
      {
        status: 200,
        body: {
          status: "ready",
          token: canonicalToken,
          customProject: null,
          snapshot: { chainId: 1 },
        },
      },
      canonicalToken.tokenAddress,
      "initial-request",
    );

    expect(state).toMatchObject({
      phase: "ready",
      token: canonicalToken,
      chainId: 1,
      requestKey: "initial-request",
    });
  });

  it("surfaces unavailable or mismatched server responses with explicit retry", () => {
    expect(createTokenDetailInitialState(
      { status: 503, body: { error: "temporarily unavailable" } },
      canonicalToken.tokenAddress,
      "unavailable-request",
    )).toEqual({
      phase: "error",
      message: "temporarily unavailable",
      requestKey: "unavailable-request",
    });
    expect(createTokenDetailInitialState(
      {
        status: 200,
        body: {
          status: "ready",
          token: canonicalToken,
          customProject: null,
          snapshot: { chainId: 1 },
        },
      },
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "mismatched-request",
    )).toEqual({
      phase: "error",
      message: "The token registry returned the wrong token",
      requestKey: "mismatched-request",
    });
  });

  it("hydrates a verified not-found response as a terminal empty state", () => {
    expect(createTokenDetailInitialState(
      { status: 404, body: { status: "ready" } },
      canonicalToken.tokenAddress,
      "missing-request",
    )).toEqual({ phase: "not-found", requestKey: "missing-request" });
  });

  it("uses the public market cap label for every valuation state", () => {
    expect(getValuationMetricLabel({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      valueWad: "1",
      freshness: "current",
    })).toBe("Market cap");
    expect(getValuationMetricLabel({
      status: "available",
      metric: "market-cap",
      supplyBasis: "circulating",
      currency: "usd",
      valueWad: "1",
      freshness: "current",
    })).toBe("Market cap");
    expect(getValuationMetricLabel({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      valueWad: "1",
      freshness: "stale",
    })).toBe("Market cap");
    expect(getValuationMetricLabel({
      status: "available",
      metric: "market-cap",
      supplyBasis: "circulating",
      currency: "usd",
      valueWad: "1",
      freshness: "unknown",
    })).toBe("Market cap");
  });

  it("ignores legacy market volume without Bitquery provenance", () => {
    expect(buildTokenDetailMetrics(token)).toEqual([
      { label: "Market cap", value: "$168.56K" },
      { label: "Category", value: "Classic" },
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
      label: "Market cap",
      value: "Not available yet",
    });
    expect(buildTokenDetailMetrics(withoutLiquidity, "$999M")[0]).toEqual({
      label: "Market cap",
      value: "Not available yet",
    });
  });

  it("uses the chart-point FDV while the chart is inspected", () => {
    expect(buildTokenDetailMetrics(token, "$212.4K")[0]).toEqual({
      label: "Market cap",
      value: "$212.4K",
    });
  });

  it("ignores an unavailable historical override", () => {
    expect(buildTokenDetailMetrics(token, "Unavailable")[0]).toEqual({
      label: "Market cap",
      value: "$168.56K",
    });
  });

  it("labels a stale value as last verified instead of current FDV", () => {
    expect(buildTokenDetailMetrics({
      ...token,
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        currency: "usd",
        valueWad: parseEther("168560").toString(),
        freshness: "stale",
        source: "bitquery",
        asOfTime: "2026-08-10T11:50:47.000Z",
      },
    })[0]).toEqual({
      label: "Market cap",
      value: "$168.56K",
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
      label: "Market cap",
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
      { label: "Market cap", value: "$168.56K" },
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
    ).toEqual({ label: "Volume 1W", value: "Loading…" });
    expect(buildChartVolumeMetric({
      range: "1d",
      pending: false,
    })).toEqual({ label: "Volume 1D", value: "Not available yet" });
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

  it("ignores legacy subgraph market analytics", () => {
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
      { label: "Market cap", value: "$168.56K" },
      { label: "Category", value: "Classic" },
      { label: "Swap fee", value: "1%" },
    ]);
  });

  it("shows only typed Bitquery market cap, volume, and liquidity", () => {
    const marketData = {
      schemaVersion: "programmable.market-data.v1",
      source: "bitquery",
      generatedAt: "2026-08-11T14:00:00.000Z",
      status: "current",
      primaryPoolId: token.poolId,
      pools: [{
        identity: {
          chainId: "1",
          tokenAddress: token.tokenAddress,
          poolId: token.poolId,
          protocol: "uniswap_v4",
        },
        source: "bitquery",
        status: "current",
        quality: "complete",
        asOfTime: "2026-08-11T14:00:00.000Z",
        latestTrade: {
          transactionHash: `0x${"55".repeat(32)}`,
          logIndex: 1,
          blockNumber: "25740000",
          time: "2026-08-11T14:00:00.000Z",
          tokenSide: "buy",
          priceUsdWad: parseEther("2").toString(),
        },
        liquidity: {
          asOfTime: "2026-08-11T14:00:00.000Z",
          asOfBlock: "25740000",
          valueUsdWad: parseEther("98765").toString(),
          freshness: "current",
        },
        volume24hUsdWad: parseEther("1234567").toString(),
        tradeCount24h: 42,
        valuation: {
          status: "available",
          metric: "market-cap",
          supplyBasis: "circulating",
          valueUsdWad: parseEther("140000").toString(),
          marketCapUsdWad: parseEther("140000").toString(),
          fdvUsdWad: parseEther("168560").toString(),
          totalSupply: "1000000",
          circulatingSupply: "830565",
          asOfTime: "2026-08-11T14:00:00.000Z",
          freshness: "current",
        },
      }],
    } as const satisfies TokenMarketDataV1;

    expect(buildTokenDetailMetrics({
      ...token,
      valuation: {
        status: "available",
        metric: "market-cap",
        supplyBasis: "circulating",
        currency: "usd",
        valueWad: parseEther("140000").toString(),
        freshness: "current",
        source: "bitquery",
        asOfTime: "2026-08-11T14:00:00.000Z",
      },
      marketData,
    })).toEqual([
      { label: "Market cap", value: "$140K" },
      { label: "Category", value: "Classic" },
      { label: "24h volume", value: "$1.2M" },
      { label: "Liquidity", value: "$98.8K" },
      { label: "Swap fee", value: "1%" },
    ]);

    const staleLiquidity = {
      ...marketData,
      pools: [{
        ...marketData.pools[0],
        liquidity: {
          ...marketData.pools[0].liquidity,
          freshness: "stale" as const,
        },
      }],
    } satisfies TokenMarketDataV1;
    expect(buildTokenDetailMetrics({
      ...token,
      marketData: staleLiquidity,
    })).not.toContainEqual(expect.objectContaining({ label: "Liquidity" }));
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
    ).toBeUndefined();
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
    ).toBeUndefined();
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
