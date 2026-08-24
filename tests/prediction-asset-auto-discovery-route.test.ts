import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  releaseEnabled: false,
  releaseError: false,
  loaded: vi.fn(),
  read: vi.fn(),
}));

vi.mock("../lib/prediction-v2/release-binding.server", () => ({
  isPredictionV2ReleaseEnabled: () => {
    if (mocks.releaseError) throw new Error("invalid release binding");
    return mocks.releaseEnabled;
  },
}));

vi.mock(
  "../lib/market-data/prediction-asset-auto-discovery-request-control-v2.server",
  () => {
    mocks.loaded();
    return { readControlledPredictionAssetAutoDiscoveryV2: mocks.read };
  },
);

import { NextRequest } from "next/server";

import { GET } from "../app/api/prediction/asset-auto-discovery/route";

const EVM_ADDRESS = `0x${"ab".repeat(20)}`;

function request(query: string) {
  return new NextRequest(
    `http://localhost/api/prediction/asset-auto-discovery?${query}`,
  );
}

function result(status: string) {
  return {
    schemaVersion: 2,
    locator: EVM_ADDRESS,
    status,
    source: status === "unique" || status === "ambiguous"
      ? "dexscreener"
      : null,
    observedAt: "2026-08-23T18:00:00.000Z",
    usage: "informational-only",
  };
}

describe("Prediction V2 asset auto-discovery route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.releaseEnabled = false;
    mocks.releaseError = false;
  });

  it("keeps a malformed release binding dark", async () => {
    mocks.releaseError = true;

    const response = await GET(request(`locator=${EVM_ADDRESS}`));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([
    "",
    `locator=${EVM_ADDRESS}`,
    `locator=${EVM_ADDRESS}&extra=true`,
  ] as const)("returns a dark, non-cacheable 404 before inspecting query %s", async (
    query,
  ) => {
    const response = await GET(request(query));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([
    "",
    `locator=${EVM_ADDRESS}&locator=${EVM_ADDRESS}`,
    `locator=${EVM_ADDRESS}&network=base`,
    `locator=${"a".repeat(129)}`,
  ])("rejects an invalid enabled query before loading the provider: %s", async (
    query,
  ) => {
    mocks.releaseEnabled = true;

    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-identity-source")).toBeNull();
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    expect(response.headers.get("x-programmable-read-purpose")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Enter one exact token address",
    });
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("returns a cacheable informational unique result and forwards cancellation", async () => {
    mocks.releaseEnabled = true;
    mocks.read.mockResolvedValueOnce({
      status: "ok",
      source: "reader",
      result: {
        ...result("unique"),
        candidate: { selection: { sourceNetwork: "base" } },
      },
    });
    const input = request(`locator=%20${EVM_ADDRESS}%20`);

    const response = await GET(input);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    expect(response.headers.get("x-programmable-market-provider"))
      .toBe("dexscreener");
    expect(response.headers.get("x-programmable-identity-source"))
      .toBe("onchain-rpc");
    expect(response.headers.get("x-programmable-read-purpose"))
      .toBe("informational-only");
    expect(mocks.read).toHaveBeenCalledWith(EVM_ADDRESS, {
      signal: input.signal,
    });
    await expect(response.json()).resolves.toMatchObject({ status: "unique" });
  });

  it("attributes an identity-only result to RPC without inventing DEX enrichment", async () => {
    mocks.releaseEnabled = true;
    mocks.read.mockResolvedValueOnce({
      status: "ok",
      source: "reader",
      result: {
        ...result("unique"),
        source: null,
        candidate: { selection: { sourceNetwork: "base" } },
      },
    });

    const response = await GET(request(`locator=${EVM_ADDRESS}`));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-programmable-identity-source"))
      .toBe("onchain-rpc");
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    expect(response.headers.get("x-programmable-read-purpose"))
      .toBe("informational-only");
  });

  it.each([
    ["ambiguous", 200, false],
    ["invalid", 400, false],
    ["not-found", 404, false],
    ["inconclusive", 503, true],
  ] as const)("maps %s to HTTP %i", async (
    discoveryStatus,
    expectedStatus,
    retryable,
  ) => {
    mocks.releaseEnabled = true;
    mocks.read.mockResolvedValueOnce({
      status: "ok",
      source: "reader",
      result: result(discoveryStatus),
    });

    const response = await GET(request(`locator=${EVM_ADDRESS}`));

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("retry-after")).toBe(retryable ? "5" : null);
    expect(response.headers.get("cache-control")).toBe(
      discoveryStatus === "ambiguous"
        ? "public, max-age=0, s-maxage=15, stale-while-revalidate=30"
        : "no-store",
    );
    expect(response.headers.get("x-programmable-identity-source")).toBe(
      discoveryStatus === "invalid" ? null : "onchain-rpc",
    );
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      discoveryStatus === "ambiguous" ? "dexscreener" : null,
    );
  });

  it("maps the local provider budget to a non-cacheable HTTP 429", async () => {
    mocks.releaseEnabled = true;
    mocks.read.mockResolvedValueOnce({
      status: "rate-limited",
      retryAfterSeconds: 7,
    });

    const response = await GET(request(`locator=${EVM_ADDRESS}`));

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("x-programmable-identity-source")).toBeNull();
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    expect(response.headers.get("x-programmable-read-purpose")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: "Too many token lookups. Try again shortly.",
    });
  });
});
