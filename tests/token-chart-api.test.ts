import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MarketChartV1 } from "../lib/market-data/market-data-v1";

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

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  mergeEntries: vi.fn(),
  customEnabled: vi.fn(),
  customDirectory: vi.fn(),
  readChart: vi.fn(),
}));
vi.mock("../lib/market-data/envio-classic-v3-catalog.server", () => ({
  readEnvioClassicV3CatalogV1: mocks.catalog,
  mergeEnvioClassicV3CatalogEntriesV1: mocks.mergeEntries,
}));
vi.mock("../lib/market-data/bitquery.server", () => ({
  readBitqueryMarketChartV1: mocks.readChart,
}));
vi.mock("../lib/server/custom-launch/public-readiness", () => ({
  isCustomLaunchRegistryPublicReadEnabled: mocks.customEnabled,
}));
vi.mock("../lib/server/custom-launch/explore-directory-v1", () => ({
  readProductionCustomExploreDirectoryV1: mocks.customDirectory,
}));

import { GET } from "../app/api/explore/token/chart/route";

function request(query = `address=${address}&range=1d`) {
  return new NextRequest(`http://localhost/api/explore/token/chart?${query}`);
}

describe("pool-bound token chart API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.catalog.mockResolvedValue({
      source: "envio-classic-v3",
      status: "last-known-good",
      generatedAt: "2026-08-14T00:00:00.000Z",
      entries: [token],
    });
    mocks.customEnabled.mockReturnValue(false);
    mocks.customDirectory.mockResolvedValue([]);
    mocks.mergeEntries.mockImplementation((canonical, custom) => [
      ...canonical,
      ...custom,
    ]);
    mocks.readChart.mockResolvedValue(chart);
  });

  it("reads a known Classic token through its exact quote-bound pool", async () => {
    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=0, s-maxage=60, stale-while-revalidate=60",
    );
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "envio-classic-v3",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+bitquery",
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
    const customAddress = "0x9999999999999999999999999999999999999999";
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
      "envio-classic-v3+registry.custom-launched",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+registry.custom-launched+bitquery",
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

  it("fails closed instead of choosing between multiple verified Custom pools", async () => {
    const customAddress = "0x9999999999999999999999999999999999999999";
    mocks.customEnabled.mockReturnValue(true);
    mocks.customDirectory.mockResolvedValue([{
      exploreKind: "custom-project",
      id: `custom:sha256:${"99".repeat(32)}`,
      tokenAddress: customAddress,
      launchedAt: "2026-08-17T00:00:00.000Z",
      chainId: "1",
      markets: [
        {
          status: "active",
          poolId: `0x${"98".repeat(32)}`,
          baseAsset: { identity: { value: customAddress } },
          quoteAsset: { identity: { value: nativeEth } },
        },
        {
          status: "active",
          poolId: `0x${"99".repeat(32)}`,
          baseAsset: { identity: { value: customAddress } },
          quoteAsset: { identity: { value: nativeEth } },
        },
      ],
    }]);

    const response = await GET(request(`address=${customAddress}&range=1d`));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-data-quality")).toBe(
      "unavailable",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "programmable.market-chart-error.v1",
      source: "bitquery",
      status: "unavailable",
      reason: "identity-unavailable",
      address: customAddress,
      range: "1d",
    });
    expect(mocks.readChart).not.toHaveBeenCalled();
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
      "envio-classic-v3",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "envio-classic-v3+bitquery",
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

  it("returns 404 for an address outside the committed identity catalog", async () => {
    mocks.catalog.mockResolvedValue({ source: "envio-classic-v3", entries: [] });
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
  });

  it("returns 503 only when the identity catalog cannot be read", async () => {
    mocks.catalog.mockRejectedValue(new Error("catalog unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
    expect(response.headers.get("x-programmable-market-source")).toBeNull();
  });

  it.each([
    "address=bad",
    `address=${address}&range=bad`,
    `address=${address}&range=1d&fallback=true`,
  ])("rejects unsupported input %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("uses the bounded Bitquery reader without an RPC or historical scan", () => {
    const source = readFileSync(
      new URL("../app/api/explore/token/chart/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("readBitqueryMarketChartV1");
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
