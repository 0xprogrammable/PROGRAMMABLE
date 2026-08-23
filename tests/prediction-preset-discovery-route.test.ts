import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  loaded: vi.fn(),
  read: vi.fn(),
}));

vi.mock(
  "../lib/market-data/prediction-preset-discovery-v2.server",
  () => {
    mocks.loaded();
    return { readPredictionPresetDiscoveryV2: mocks.read };
  },
);

import { NextRequest } from "next/server";

import { GET } from "../app/api/prediction/preset-discovery/route";

function request(query = "") {
  return new NextRequest(
    `http://localhost/api/prediction/preset-discovery${query}`,
  );
}

describe("disabled Prediction V2 preset-discovery route", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(["", "?ids=dogecoin"])(
    "returns a non-cacheable 404 before any provider read: %s",
    async (query) => {
      const response = await GET(request(query));

      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-programmable-market-provider")).toBeNull();
      await expect(response.json()).resolves.toEqual({ error: "Not found" });
      expect(mocks.loaded).not.toHaveBeenCalled();
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
});
