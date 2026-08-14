import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const address = "0x1111111111111111111111111111111111111111";
const poolId = `0x${"33".repeat(32)}`;
const identity = {
  chainId: "1",
  tokenAddress: address,
  quoteAddress: "0x0000000000000000000000000000000000000000",
  poolId,
  protocol: "uniswap_v4",
} as const;
const token = {
  exploreKind: "token",
  id: `1:${address}`,
  name: "Test",
  symbol: "TEST",
  tokenAddress: address,
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId,
  launchedAt: "2026-08-11T00:00:00.000Z",
  totalSupplyRaw: "1000000000000000000000000",
  tokenDecimals: 18,
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

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  chart: vi.fn(),
  market: vi.fn(),
}));

vi.mock("../lib/market-data/primary-rpc-launches.server", () => ({
  readPrimaryRpcExploreEntriesV1: mocks.catalog,
  safePrimaryRpcLaunchCatalogError: vi.fn(() => ({
    name: "PrimaryRpcLaunchCatalogError",
    category: "unexpected",
  })),
}));
vi.mock("../lib/market-data/bitquery.server", () => ({
  readBitqueryMarketChartStrictV1: mocks.chart,
  readBitqueryTokenMarketDataStrictV1: mocks.market,
  safeBitqueryMarketDataError: vi.fn(() => ({
    name: "MarketDataError",
    category: "unexpected",
  })),
}));

import { GET } from "../app/api/explore/token/chart/route";

function request(query = `address=${address}&range=1d`) {
  return new NextRequest(`http://localhost/api/explore/token/chart?${query}`);
}

function readyChart() {
  return {
    schemaVersion: "programmable.market-chart.v1",
    source: "bitquery",
    readStatus: "live",
    status: "ready",
    generatedAt: "2026-08-14T00:00:00.000Z",
    identity,
    range: "1d",
    points: [{
      blockNumber: "25740002",
      time: "2026-08-14T00:00:00.000Z",
      bucketStart: "2026-08-13T23:59:00.000Z",
      bucketEnd: "2026-08-14T00:00:00.000Z",
      observedAt: "2026-08-14T00:00:00.000Z",
      valueSemantics: "period-median",
      priceUsd: "2",
      tradeCount: 1,
    }],
    swapCount: 1,
    valuation: { status: "unavailable", reason: "source-unavailable" },
    asOfTime: "2026-08-14T00:00:00.000Z",
    truncated: false,
  } as const;
}

describe("dRPC identity and strict Bitquery token chart API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.catalog.mockResolvedValue({
      source: "drpc",
      generatedAt: "2026-08-14T00:00:00.000Z",
      asOfBlock: "25740002",
      asOfBlockHash: `0x${"44".repeat(32)}`,
      entries: [token],
    });
    mocks.chart.mockResolvedValue(readyChart());
  });

  it("reads identity from dRPC and history directly from Bitquery", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-market-source")).toBe("bitquery");
    expect(response.headers.get("x-programmable-launch-source")).toBe("drpc");
    expect(response.headers.get("x-programmable-read-source")).toBe("drpc+bitquery");
    expect(mocks.catalog).toHaveBeenCalledWith({
      requestedTokenAddress: address,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.chart).toHaveBeenCalledWith(expect.objectContaining({
      identity,
      range: "1d",
      historyStart: token.launchedAt,
    }));
    await expect(response.json()).resolves.toMatchObject({
      source: "bitquery",
      status: "ready",
      address,
    });
  });

  it("returns 404 when the dRPC catalog has no token", async () => {
    mocks.catalog.mockResolvedValue({
      source: "drpc",
      generatedAt: "2026-08-14T00:00:00.000Z",
      asOfBlock: null,
      asOfBlockHash: null,
      entries: [],
    });
    const response = await GET(request());
    expect(response.status).toBe(404);
    expect(mocks.chart).not.toHaveBeenCalled();
  });

  it("returns 503 instead of cached history when Bitquery fails", async () => {
    mocks.chart.mockRejectedValue(new Error("provider unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      source: "bitquery",
      status: "unavailable",
    });
  });

  it("returns 503 when the primary dRPC identity read fails", async () => {
    mocks.catalog.mockRejectedValue(new Error("drpc unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("x-programmable-launch-source")).toBe("drpc");
    expect(response.headers.get("x-programmable-market-source")).toBe("bitquery");
    expect(mocks.chart).not.toHaveBeenCalled();
  });

  it.each([
    "address=bad",
    `address=${address}&range=bad`,
    `address=${address}&range=1d&fallback=true`,
  ])("rejects unsupported input %s", async (query) => {
    expect((await GET(request(query))).status).toBe(400);
    expect(mocks.catalog).not.toHaveBeenCalled();
  });
});
