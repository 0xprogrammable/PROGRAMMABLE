import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const address = "0x1111111111111111111111111111111111111111";
const token = {
  exploreKind: "token",
  id: `1:${address}`,
  name: "Test",
  symbol: "TEST",
  tokenAddress: address,
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
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

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(),
  customEnabled: vi.fn(),
  customDirectory: vi.fn(),
}));
vi.mock("../lib/market-data/last-good-launch-catalog.server", () => ({
  readLastGoodLaunchCatalogV1: mocks.catalog,
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

describe("provider-free interim token chart API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.catalog.mockResolvedValue({
      source: "durable-blob",
      status: "last-known-good",
      generatedAt: "2026-08-14T00:00:00.000Z",
      entries: [token],
    });
    mocks.customEnabled.mockReturnValue(false);
    mocks.customDirectory.mockResolvedValue([]);
  });

  it("returns an explicit neutral unavailable contract for a known identity", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "durable-blob",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "durable-blob",
    );
    expect(response.headers.get("x-programmable-data-quality")).toBe(
      "unavailable",
    );
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    expect(response.headers.get("x-programmable-market-source")).toBeNull();
    expect(response.headers.get("x-programmable-price-source")).toBeNull();
    expect(response.headers.get("x-programmable-market-as-of")).toBeNull();
    expect(response.headers.get("x-programmable-valuation-block")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      schemaVersion: "programmable.market-chart-unavailable.v1",
      source: null,
      status: "unavailable",
      reason: "history-provider-unavailable",
      address,
      range: "1d",
    });
  });

  it("returns 404 for an address outside the committed identity catalog", async () => {
    mocks.catalog.mockResolvedValue({ source: "durable-blob", entries: [] });
    expect((await GET(request())).status).toBe(404);
  });

  it("labels a successful Custom Registry boundary explicitly", async () => {
    const customAddress = "0x9999999999999999999999999999999999999999";
    mocks.customEnabled.mockReturnValue(true);
    mocks.customDirectory.mockResolvedValue([{
      exploreKind: "custom-project",
      id: `custom:sha256:${"99".repeat(32)}`,
      tokenAddress: customAddress,
      markets: [],
    }]);

    const response = await GET(request(`address=${customAddress}&range=1d`));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-launch-source")).toBe(
      "durable-blob+registry.custom-launched",
    );
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "durable-blob+registry.custom-launched",
    );
  });

  it("returns 503 only when the identity catalog cannot be read", async () => {
    mocks.catalog.mockRejectedValue(new Error("blob unavailable"));
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

  it("contains no dRPC, Bitquery or historical reader dependency", () => {
    const source = readFileSync(
      new URL("../app/api/explore/token/chart/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/bitquery|readPrimaryRpc|readTokenChartSeries/iu);
    expect(source).toContain("readLastGoodLaunchCatalogV1");
  });

  it("keeps the browser chart request disabled outside preview fixtures", () => {
    const chart = readFileSync(
      new URL("../components/token-price-chart.tsx", import.meta.url),
      "utf8",
    );
    const detail = readFileSync(
      new URL("../components/token-detail-view.tsx", import.meta.url),
      "utf8",
    );
    expect(chart).toContain("const historyEnabled = preview;");
    expect(chart).not.toContain("historyAvailable");
    expect(detail).not.toContain("preloadTokenChart");
  });
});
