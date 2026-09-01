import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GmgnMarketChartV1 } from
  "../lib/market-data/gmgn-chart-data-v1";
import {
  isMarketChartError,
  type MarketChartV1,
} from "../lib/market-data/market-data-v1";

vi.mock("server-only", () => ({}));

const address = "0x1111111111111111111111111111111111111111";
const poolId = `0x${"33".repeat(32)}` as const;
const nativeEth = "0x0000000000000000000000000000000000000000" as const;
const token = {
  exploreKind: "token",
  id: `1:${address}`,
  name: "Test",
  symbol: "TEST",
  tokenAddress: address,
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId,
  launchedAt: "2026-08-11T00:00:00.000Z",
  totalSwapFeeBps: 100,
  launchModel: "classic",
  liquidityPath: "meme",
  launchCategoryProvenance: {
    schemaVersion: "programmable.explore-launch-category-provenance.v1",
    category: "classic",
    source: "canonical-launch-read-model",
    recordId: `1:${address}`,
    modelId: "classic",
    modelVersion: null,
  },
} as const;

const chart = {
  schemaVersion: "programmable.market-chart.v1",
  source: "bitquery",
  readStatus: "live",
  status: "ready",
  generatedAt: "2026-08-17T12:00:00.000Z",
  identity: {
    chainId: "1",
    tokenAddress: address,
    poolId,
    quoteAddress: nativeEth,
    protocol: "uniswap_v4",
  },
  range: "1d",
  points: [
    {
      blockNumber: "25740000",
      time: "2026-08-17T11:00:00.000Z",
      bucketStart: "2026-08-17T10:40:00.000Z",
      bucketEnd: "2026-08-17T11:00:00.000Z",
      observedAt: "2026-08-17T11:00:00.000Z",
      valueSemantics: "period-median",
      priceQuote: "0.00001",
      quoteSymbol: "ETH",
      tradeCount: 1,
    },
    {
      blockNumber: "25740001",
      time: "2026-08-17T11:20:00.000Z",
      bucketStart: "2026-08-17T11:00:00.000Z",
      bucketEnd: "2026-08-17T11:20:00.000Z",
      observedAt: "2026-08-17T11:20:00.000Z",
      valueSemantics: "period-median",
      priceQuote: "0.000011",
      quoteSymbol: "ETH",
      tradeCount: 1,
    },
  ],
  swapCount: 2,
  valuation: { status: "unavailable", reason: "source-unavailable" },
  asOfTime: "2026-08-17T11:20:00.000Z",
  truncated: false,
} as const satisfies MarketChartV1;

function gmgnReadyChart(
  marketIdentity: MarketChartV1["identity"] = chart.identity,
  range: GmgnMarketChartV1["range"] = "1d",
): GmgnMarketChartV1 {
  const generatedAt = new Date();
  const requestedToMs = Math.floor(generatedAt.getTime() / 60_000) * 60_000;
  const requestedFromMs = requestedToMs - 2 * 60_000;
  const points = [
    {
      time: new Date(requestedFromMs + 60_000).toISOString(),
      bucketStart: new Date(requestedFromMs).toISOString(),
      bucketEnd: new Date(requestedFromMs + 60_000).toISOString(),
      valueSemantics: "period-close" as const,
      priceUsd: "0.00001",
      ohlcUsd: {
        open: "0.000009",
        high: "0.000011",
        low: "0.000008",
        close: "0.00001",
      },
      volumeUsdWad: "1000000000000000000",
    },
    {
      time: new Date(requestedToMs).toISOString(),
      bucketStart: new Date(requestedToMs - 60_000).toISOString(),
      bucketEnd: new Date(requestedToMs).toISOString(),
      valueSemantics: "period-close" as const,
      priceUsd: "0.000012",
      ohlcUsd: {
        open: "0.00001",
        high: "0.000013",
        low: "0.000009",
        close: "0.000012",
      },
      volumeUsdWad: "2000000000000000000",
    },
  ];
  return {
    schemaVersion: "programmable.gmgn-market-chart.v1",
    source: "gmgn",
    seriesScope: "token",
    poolAttribution: "unavailable",
    readStatus: "live",
    status: "ready",
    generatedAt: generatedAt.toISOString(),
    identity: marketIdentity,
    identityProof: {
      schemaVersion: "programmable.gmgn-chart-identity-proof.v1",
      source: "gmgn-token-info",
      verifiedAt: generatedAt.toISOString(),
      identity: marketIdentity,
      poolAttribution: "unavailable",
      canonicalSupply: {
        totalSupplyRaw: "1000000000000000000000000",
        tokenDecimals: 18,
      },
    },
    range,
    resolution: "1m",
    requestedFrom: new Date(requestedFromMs).toISOString(),
    requestedTo: new Date(requestedToMs).toISOString(),
    points,
    candleCount: points.length,
    volumeUsdWad: "3000000000000000000",
    asOfTime: points.at(-1)!.bucketEnd,
    truncated: false,
  };
}

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  mergeEntries: vi.fn(),
  customEnabled: vi.fn(),
  customDirectory: vi.fn(),
  readRouter: vi.fn(),
  hydrateSupply: vi.fn(),
  readGmgnChart: vi.fn(),
  readChart: vi.fn(),
}));
vi.mock("../lib/market-data/envio-classic-v3-catalog.server", () => ({
  readEnvioClassicV3CatalogV1: mocks.catalog,
  mergeEnvioClassicV3CatalogEntriesV1: mocks.mergeEntries,
}));
vi.mock("../lib/market-data/bitquery.server", () => ({
  readBitqueryMarketChartV1: mocks.readChart,
}));
vi.mock("../lib/market-data/gmgn-chart.server", () => ({
  readGmgnMarketChartV1: mocks.readGmgnChart,
}));
vi.mock("../lib/market-data/canonical-token-supply.server", () => ({
  hydrateMissingCanonicalTokenSupplyBoundedV1: mocks.hydrateSupply,
}));
vi.mock("../lib/server/custom-launch/public-readiness", () => ({
  isCustomLaunchRegistryPublicReadEnabled: mocks.customEnabled,
}));
vi.mock("../lib/server/custom-launch/explore-directory-v1", () => ({
  readProductionCustomExploreDirectoryV1: mocks.customDirectory,
}));
vi.mock("../lib/alchemy/router-custom-public.server", () => ({
  readFinalizedRouterCustomIdentitySnapshotV1: mocks.readRouter,
  ROUTER_CUSTOM_LAUNCH_SOURCE: "canonical-launch-stamp-router",
  routerCustomEntriesAtOrBeforeBlockV1: (entries: readonly unknown[]) => entries,
  mergeRouterCustomExploreEntriesV1: (
    existing: readonly unknown[],
    router: readonly unknown[],
  ) => [...existing, ...router],
  publicLaunchSourceV1: (input: Readonly<{
    envioAvailable?: boolean;
    registryCustomCurrent: boolean;
    routerCustomCurrent: boolean;
  }>) => [
    ...(input.envioAvailable === false ? [] : ["envio-classic-v3"]),
    ...(input.registryCustomCurrent ? ["registry.custom-launched"] : []),
    ...(input.routerCustomCurrent ? ["canonical-launch-stamp-router"] : []),
  ].join("+"),
}));

import { GET } from "../app/api/explore/token/chart/route";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";

function routerSnapshot(
  entries: readonly unknown[],
  status: "current" | "last-known-good" = "current",
) {
  return {
    schemaVersion: "programmable.router-custom-identity-snapshot.v1",
    source: "canonical-launch-stamp-router",
    status,
    generatedAt: "2026-08-17T12:00:00.000Z",
    asOfBlock: "25740000",
    asOfBlockHash: `0x${"44".repeat(32)}`,
    finalityConfirmations: 64,
    identityCommitment: `sha256:${"55".repeat(32)}`,
    entries,
  };
}

function request(query = `address=${address}&range=1d`) {
  return new NextRequest(`http://localhost/api/explore/token/chart?${query}`);
}

describe("scoped token chart API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.catalog.mockResolvedValue({
      source: "envio-classic-v3",
      status: "last-known-good",
      generatedAt: "2026-08-14T00:00:00.000Z",
      asOfBlock: "25740000",
      entries: [token],
    });
    mocks.customEnabled.mockReturnValue(false);
    mocks.customDirectory.mockResolvedValue([]);
    mocks.mergeEntries.mockImplementation((canonical, custom) => [
      ...canonical,
      ...custom,
    ]);
    mocks.readRouter.mockResolvedValue(routerSnapshot([]));
    mocks.hydrateSupply.mockImplementation(async (entries) => [...entries]);
    mocks.readGmgnChart.mockResolvedValue(null);
    mocks.readChart.mockResolvedValue(chart);
  });

  it("returns a fresh token-level GMGN chart without waiting for Bitquery", async () => {
    const gmgn = gmgnReadyChart();
    mocks.readGmgnChart.mockResolvedValue(gmgn);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+canonical-launch-stamp-router+gmgn",
    );
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      "gmgn",
    );
    expect(response.headers.get("x-programmable-market-read-status")).toBe(
      "live",
    );
    expect(response.headers.get("x-programmable-chart-scope")).toBe("token");
    expect(response.headers.get("x-programmable-chart-pool-attribution")).toBe(
      "unavailable",
    );
    expect(response.headers.get("x-programmable-market-source")).toBe(
      "gmgn",
    );
    expect(response.headers.get("x-programmable-price-source")).toBe("gmgn");
    expect(response.headers.get("x-programmable-market-as-of")).toBe(
      gmgn.asOfTime,
    );
    await expect(response.json()).resolves.toEqual(gmgn);
    expect(mocks.readGmgnChart).toHaveBeenCalledWith({
      entry: token,
      identity: chart.identity,
      range: "1d",
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.readChart).not.toHaveBeenCalled();
  });

  it("falls back to exact-pool Bitquery when GMGN has no admitted series", async () => {
    const response = await GET(request());

    await expect(response.json()).resolves.toEqual(chart);
    expect(response.headers.get("x-programmable-chart-scope")).toBe("pool");
    expect(response.headers.get("x-programmable-chart-pool-attribution")).toBe(
      "exact",
    );
    expect(mocks.readGmgnChart).toHaveBeenCalledTimes(1);
    expect(mocks.readChart).toHaveBeenCalledTimes(1);
    expect(mocks.readGmgnChart.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readChart.mock.invocationCallOrder[0],
    );
  });

  it("fails soft to Bitquery when the GMGN reader throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readGmgnChart.mockRejectedValue(new Error("provider failed"));

    const response = await GET(request());

    await expect(response.json()).resolves.toEqual(chart);
    expect(mocks.readChart).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      "Token chart GMGN read unavailable",
      { name: "GmgnChartReadError" },
    );
    log.mockRestore();
  });

  it("keeps a complete Bitquery chart over a partial GMGN candidate", async () => {
    const gmgn = gmgnReadyChart();
    mocks.readGmgnChart.mockResolvedValue({
      ...gmgn,
      status: "partial",
      truncated: true,
    });

    const response = await GET(request());

    await expect(response.json()).resolves.toEqual(chart);
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      "bitquery",
    );
    expect(mocks.readChart).toHaveBeenCalledTimes(1);
  });

  it("uses an admitted one-candle GMGN token series over an unavailable fallback", async () => {
    const gmgn = gmgnReadyChart();
    const point = gmgn.points[0]!;
    mocks.readGmgnChart.mockResolvedValue({
      ...gmgn,
      status: "insufficient-history",
      points: [point],
      candleCount: 1,
      volumeUsdWad: point.volumeUsdWad,
      asOfTime: point.bucketEnd,
    });
    mocks.readChart.mockResolvedValue({
      ...chart,
      readStatus: "cache-fallback",
      status: "unavailable",
      points: [],
      swapCount: 0,
      asOfTime: undefined,
    });

    const response = await GET(request());
    const payload = await response.json();

    expect(payload).toMatchObject({
      source: "gmgn",
      status: "insufficient-history",
      candleCount: 1,
    });
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      "gmgn",
    );
    expect(mocks.readChart).toHaveBeenCalledTimes(1);
  });

  it("rejects a GMGN chart for the wrong canonical identity", async () => {
    const gmgn = gmgnReadyChart();
    const wrongIdentity = {
      ...gmgn.identity,
      tokenAddress: "0x9999999999999999999999999999999999999999" as const,
    };
    mocks.readGmgnChart.mockResolvedValue({
      ...gmgn,
      identity: wrongIdentity,
      identityProof: {
        ...gmgn.identityProof,
        identity: wrongIdentity,
      },
    });

    const response = await GET(request());

    await expect(response.json()).resolves.toEqual(chart);
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      "bitquery",
    );
    expect(mocks.readChart).toHaveBeenCalledTimes(1);
  });

  it("reads a known Classic token through its exact quote-bound pool", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
    );
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3+canonical-launch-stamp-router",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+canonical-launch-stamp-router+bitquery",
    );
    expect(response.headers.get("x-programmable-router-read-status")).toBe(
      "current",
    );
    expect(response.headers.get("x-programmable-data-quality")).toBe("current");
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      "bitquery",
    );
    expect(response.headers.get("x-programmable-market-read-status")).toBe(
      "live",
    );
    expect(response.headers.get("x-programmable-market-source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("x-programmable-price-source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("x-programmable-market-as-of")).toBe(
      "2026-08-17T11:20:00.000Z",
    );
    await expect(response.json()).resolves.toEqual(chart);
    expect(mocks.readGmgnChart).toHaveBeenCalledTimes(1);
    expect(mocks.readChart).toHaveBeenCalledWith(expect.objectContaining({
      identity: chart.identity,
      range: "1d",
    }));
  });

  it("binds an all-time chart to the verified launch timestamp", async () => {
    mocks.readChart.mockResolvedValue({ ...chart, range: "all" });

    const response = await GET(request(`address=${address}&range=all`));

    expect(response.status).toBe(200);
    expect(mocks.readChart).toHaveBeenCalledWith(expect.objectContaining({
      identity: chart.identity,
      range: "all",
      historyStart: token.launchedAt,
    }));
  });

  it("labels a successful Custom Registry boundary and reads one verified pool", async () => {
    const customAddress =
      "0x9999999999999999999999999999999999999999" as const;
    const customPoolId = `0x${"99".repeat(32)}`;
    mocks.customEnabled.mockReturnValue(true);
    mocks.customDirectory.mockResolvedValue([{
      exploreKind: "custom-project",
      id: `custom:sha256:${"99".repeat(32)}`,
      tokenAddress: customAddress,
      launchedAt: "2026-08-17T00:00:00.000Z",
      chainId: "1",
      markets: [{
        status: "active",
        poolId: customPoolId,
        baseAsset: { identity: { value: customAddress } },
        quoteAsset: { identity: { value: nativeEth } },
      }],
    }]);
    mocks.readChart.mockResolvedValue({
      ...chart,
      identity: {
        ...chart.identity,
        tokenAddress: customAddress,
        poolId: customPoolId,
      },
    });

    const response = await GET(request(`address=${customAddress}&range=1d`));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router+bitquery",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.readChart).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({
        tokenAddress: customAddress,
        poolId: customPoolId,
        quoteAddress: nativeEth,
      }),
    }));
  });

  it("serves a hydrated Registry Custom token from GMGN", async () => {
    const customAddress =
      "0x9999999999999999999999999999999999999999" as const;
    const customPoolId = `0x${"99".repeat(32)}` as const;
    const customEntry = {
      exploreKind: "custom-project",
      id: `custom:sha256:${"99".repeat(32)}`,
      tokenAddress: customAddress,
      launchedAt: "2026-08-17T00:00:00.000Z",
      chainId: "1",
      markets: [{
        status: "active",
        poolId: customPoolId,
        baseAsset: { identity: { value: customAddress } },
        quoteAsset: { identity: { value: nativeEth } },
      }],
    };
    const hydratedEntry = {
      ...customEntry,
      tokenDecimals: 18,
      totalSupplyRaw: "1000000000000000000000000",
    };
    const customIdentity = {
      ...chart.identity,
      tokenAddress: customAddress,
      poolId: customPoolId,
    } satisfies MarketChartV1["identity"];
    mocks.customEnabled.mockReturnValue(true);
    mocks.customDirectory.mockResolvedValue([customEntry]);
    mocks.hydrateSupply.mockResolvedValue([hydratedEntry]);
    mocks.readGmgnChart.mockResolvedValue(gmgnReadyChart(customIdentity));

    const response = await GET(request(`address=${customAddress}&range=1d`));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-market-provider")).toBe("gmgn");
    expect(response.headers.get("x-programmable-chart-scope")).toBe("token");
    expect(response.headers.get("x-programmable-chart-pool-attribution")).toBe(
      "unavailable",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.hydrateSupply).toHaveBeenCalledWith(
      [customEntry],
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        deadlineMs: expect.any(Number),
      }),
    );
    expect(mocks.readGmgnChart).toHaveBeenCalledWith({
      entry: hydratedEntry,
      identity: customIdentity,
      range: "1d",
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(mocks.readChart).not.toHaveBeenCalled();
  });

  it("accepts the provider market only when it is in the canonical multi-market set", async () => {
    const customAddress =
      "0x9999999999999999999999999999999999999999" as const;
    const deterministicPoolId = `0x${"98".repeat(32)}` as const;
    const otherPoolId = `0x${"99".repeat(32)}` as const;
    const otherQuote =
      "0x7777777777777777777777777777777777777777" as const;
    const customEntry = {
      exploreKind: "custom-project",
      id: `custom:sha256:${"99".repeat(32)}`,
      tokenAddress: customAddress,
      launchedAt: "2026-08-17T00:00:00.000Z",
      chainId: "1",
      markets: [
        {
          status: "active",
          poolId: otherPoolId,
          baseAsset: { identity: { value: customAddress } },
          quoteAsset: { identity: { value: otherQuote } },
        },
        {
          status: "active",
          poolId: deterministicPoolId,
          baseAsset: { identity: { value: customAddress } },
          quoteAsset: { identity: { value: nativeEth } },
        },
      ],
    };
    const hydratedEntry = {
      ...customEntry,
      tokenDecimals: 18,
      totalSupplyRaw: "1000000000000000000000000",
    };
    const deterministicIdentity = {
      ...chart.identity,
      tokenAddress: customAddress,
      poolId: deterministicPoolId,
    } satisfies MarketChartV1["identity"];
    const providerMatchedIdentity = {
      ...chart.identity,
      tokenAddress: customAddress,
      poolId: otherPoolId,
      quoteAddress: otherQuote,
    } satisfies MarketChartV1["identity"];
    mocks.customEnabled.mockReturnValue(true);
    mocks.customDirectory.mockResolvedValue([customEntry]);
    mocks.hydrateSupply.mockResolvedValue([hydratedEntry]);
    mocks.readGmgnChart.mockResolvedValue(
      gmgnReadyChart(providerMatchedIdentity),
    );

    const response = await GET(request(`address=${customAddress}&range=1d`));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-data-quality")).toBe("current");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-market-provider")).toBe("gmgn");
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "programmable.gmgn-market-chart.v1",
      source: "gmgn",
      identity: providerMatchedIdentity,
    });
    expect(mocks.readChart).not.toHaveBeenCalled();
    expect(mocks.readGmgnChart).toHaveBeenCalledWith(expect.objectContaining({
      identity: deterministicIdentity,
    }), expect.any(Object));
  });

  it("preserves a known token identity when the market provider is unavailable", async () => {
    mocks.readChart.mockResolvedValue({
      ...chart,
      readStatus: "cache-fallback",
      status: "unavailable",
      points: [],
      swapCount: 0,
      asOfTime: undefined,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3+canonical-launch-stamp-router",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+canonical-launch-stamp-router+bitquery",
    );
    expect(response.headers.get("x-programmable-data-quality")).toBe(
      "unavailable",
    );
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      "bitquery",
    );
    expect(response.headers.get("x-programmable-market-source")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "programmable.market-chart.v1",
      identity: chart.identity,
      status: "unavailable",
      points: [],
    });
  });

  it("binds a Router-only Custom launch to its canonical provenance", async () => {
    mocks.catalog.mockResolvedValue({
      source: "envio-classic-v3",
      asOfBlock: "25740000",
      entries: [],
    });
    mocks.customEnabled.mockReturnValue(true);
    mocks.readRouter.mockResolvedValue(routerSnapshot([
      customGraphExploreEntry,
    ]));
    mocks.readChart.mockResolvedValue({
      ...chart,
      identity: {
        ...chart.identity,
        tokenAddress: customGraphExploreEntry.tokenAddress,
        poolId: customGraphExploreEntry.poolId,
      },
    });

    const response = await GET(request(
      `address=${customGraphExploreEntry.tokenAddress}&range=1d`,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router+bitquery",
    );
    expect(response.headers.get("x-programmable-router-read-status")).toBe(
      "current",
    );
    expect(mocks.readChart).toHaveBeenCalledWith(expect.objectContaining({
      identity: expect.objectContaining({
        tokenAddress: customGraphExploreEntry.tokenAddress,
        poolId: customGraphExploreEntry.poolId,
      }),
      range: "1d",
    }));
  });

  it.each(["current", "last-known-good"] as const)(
    "serves an all-range Router chart from the %s durable snapshot when Envio is unavailable",
    async (routerStatus) => {
      const routerIdentity = {
        chainId: "1",
        protocol: "uniswap_v4",
        tokenAddress:
          customGraphExploreEntry.tokenAddress!.toLowerCase() as `0x${string}`,
        poolId:
          customGraphExploreEntry.poolId.toLowerCase() as `0x${string}`,
        quoteAddress: nativeEth,
      } as const satisfies MarketChartV1["identity"];
      const gmgn = gmgnReadyChart(routerIdentity, "all");
      mocks.catalog.mockRejectedValue(new Error("envio unavailable"));
      mocks.readRouter.mockResolvedValue(routerSnapshot(
        [customGraphExploreEntry],
        routerStatus,
      ));
      mocks.readGmgnChart.mockResolvedValue(gmgn);

      const response = await GET(request(
        `address=${customGraphExploreEntry.tokenAddress}&range=all`,
      ));

      expect(response.status).toBe(200);
      expect(response.headers.get("x-programmable-launch-source")).toBe(
        "canonical-launch-stamp-router",
      );
      expect(response.headers.get("x-programmable-read-source")).toBe(
        "canonical-launch-stamp-router+gmgn",
      );
      expect(response.headers.get("x-programmable-router-read-status")).toBe(
        routerStatus,
      );
      await expect(response.json()).resolves.toEqual(gmgn);
      expect(mocks.readGmgnChart).toHaveBeenCalledWith({
        entry: customGraphExploreEntry,
        identity: routerIdentity,
        range: "all",
      }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(mocks.readChart).not.toHaveBeenCalled();
    },
  );

  it("returns 503 when Envio and the Router snapshot are unavailable", async () => {
    mocks.catalog.mockRejectedValue(new Error("envio unavailable"));
    mocks.readRouter.mockRejectedValue(new Error("router unavailable"));

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "canonical-launch-stamp-router",
    );
    expect(response.headers.get("x-programmable-router-read-status")).toBe(
      "unavailable",
    );
    expect(mocks.readGmgnChart).not.toHaveBeenCalled();
  });

  it("returns 503 for an unrelated address when only the Router snapshot is available", async () => {
    const unrelatedAddress =
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
    mocks.catalog.mockRejectedValue(new Error("envio unavailable"));
    mocks.readRouter.mockResolvedValue(routerSnapshot([
      customGraphExploreEntry,
    ]));

    const response = await GET(request(
      `address=${unrelatedAddress}&range=1d`,
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "canonical-launch-stamp-router",
    );
    expect(response.headers.get("x-programmable-router-read-status")).toBe(
      "current",
    );
    expect(mocks.readGmgnChart).not.toHaveBeenCalled();
  });

  it("returns 404 for an address outside the committed identity catalog", async () => {
    mocks.catalog.mockResolvedValue({
      source: "envio-classic-v3",
      status: "current",
      asOfBlock: "25740000",
      entries: [],
    });
    expect((await GET(request())).status).toBe(404);
  });

  it("fails closed when Custom identities collide with the catalog", async () => {
    mocks.customEnabled.mockReturnValue(true);
    mocks.customDirectory.mockResolvedValue([{
      exploreKind: "custom-project",
      id: `custom:sha256:${"99".repeat(32)}`,
      tokenAddress: address,
      markets: [],
    }]);
    mocks.mergeEntries.mockImplementationOnce(() => {
      throw new Error("Launch catalog contains duplicate identities");
    });

    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3",
    );
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "programmable.market-chart-error.v2",
      source: "programmable",
      reason: "market-data-unavailable",
    });
  });

  it("returns 503 only when the identity catalog cannot be read", async () => {
    mocks.catalog.mockRejectedValue(new Error("catalog unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("x-programmable-market-source")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "programmable.market-chart-error.v2",
      source: "programmable",
      reason: "market-data-unavailable",
    });
  });

  it("parses provider-neutral v2 errors and legacy v1 client payloads", () => {
    const common = {
      status: "unavailable",
      generatedAt: "2026-09-01T12:00:00.000Z",
      address,
      range: "1d",
      reason: "identity-unavailable",
      error: "Price history is temporarily unavailable",
    } as const;
    expect(isMarketChartError({
      ...common,
      schemaVersion: "programmable.market-chart-error.v2",
      source: "programmable",
    })).toBe(true);
    expect(isMarketChartError({
      ...common,
      schemaVersion: "programmable.market-chart-error.v1",
      source: "bitquery",
    })).toBe(true);
    expect(isMarketChartError({
      ...common,
      schemaVersion: "programmable.market-chart-error.v2",
      source: "bitquery",
    })).toBe(false);
  });

  it.each([
    "address=bad",
    `address=${address}&range=bad`,
    `address=${address}&range=1d&fallback=true`,
  ])("rejects unsupported input %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("uses bounded GMGN and Bitquery readers without an RPC or historical scan", () => {
    const source = readFileSync(
      new URL("../app/api/explore/token/chart/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("readBitqueryMarketChartV1");
    expect(source).toContain("readGmgnMarketChartV1");
    expect(source).toContain("exploreEntryMarketIdentitiesV1");
    expect(source).not.toMatch(/readPrimaryRpc|readTokenChartSeries/iu);
    expect(source).toContain("readEnvioClassicV3CatalogV1");
  });

  it("enables browser chart requests outside preview fixtures", () => {
    const chartSource = readFileSync(
      new URL("../components/token-price-chart.tsx", import.meta.url),
      "utf8",
    );
    const detail = readFileSync(
      new URL("../components/token-detail-view.tsx", import.meta.url),
      "utf8",
    );
    expect(chartSource).toContain(
      "const historyEnabled = shouldEnablePriceHistory(launchModel);",
    );
    expect(chartSource).not.toContain("historyAvailable");
    expect(detail).not.toContain("preloadTokenChart");
  });
});
