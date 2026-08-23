import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  loaded: vi.fn(),
  read: vi.fn(),
}));

vi.mock("../lib/market-data/prediction-asset-discovery-v2.server", () => {
  mocks.loaded();
  return { readPredictionAssetDiscoveryV2: mocks.read };
});

import { NextRequest } from "next/server";

import { GET } from "../app/api/prediction/asset-discovery/route";

const EVM_ADDRESS = `0x${"ab".repeat(20)}`;

function request(query: string) {
  return new NextRequest(
    `http://localhost/api/prediction/asset-discovery?${query}`,
  );
}

describe("disabled Prediction V2 asset-discovery route", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    "",
    `network=base&locator=${EVM_ADDRESS}`,
    `network=base&locator=${EVM_ADDRESS}&extra=true`,
  ])("returns a non-cacheable 404 before any provider read: %s", async (query) => {
    const response = await GET(request(query));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
