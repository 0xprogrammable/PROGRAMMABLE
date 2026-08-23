import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
}));

vi.mock("../lib/market-data/prediction-asset-discovery-v2.server", () => ({
  readPredictionAssetDiscoveryV2: mocks.read,
}));

import { NextRequest } from "next/server";

import { GET } from "../app/api/prediction/asset-discovery/route";

const EVM_ADDRESS = `0x${"ab".repeat(20)}`;
const OBSERVED_AT = "2026-08-23T16:30:00.000Z";

function request(query: string) {
  return new NextRequest(
    `http://localhost/api/prediction/asset-discovery?${query}`,
  );
}

describe("prediction asset discovery route", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    "",
    `network=base&locator=${EVM_ADDRESS}&extra=true`,
    `network=base&network=ethereum&locator=${EVM_ADDRESS}`,
    `network=unknown&locator=${EVM_ADDRESS}`,
    "network=solana&locator=",
  ])("rejects a non-canonical query without a provider read: %s", async (query) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("returns an informational snapshot for one exact selection", async () => {
    mocks.read.mockResolvedValue({
      schemaVersion: 2,
      selectionKey: `evm:8453:${EVM_ADDRESS}`,
      status: "available",
      source: "dexscreener",
      observedAt: OBSERVED_AT,
      usage: "informational-only",
      currentPriceUsd: 2.5,
      marketCapUsd: 2_500_000,
      pair: {
        providerChainId: "base",
        dexId: "uniswap",
        pairAddress: "0xpair",
        liquidityUsd: 50_000,
      },
    });
    const input = request(`network=base&locator=${EVM_ADDRESS}`);

    const response = await GET(input);
    const body = await response.json();

    expect(mocks.read).toHaveBeenCalledWith(
      {
        mode: "custom",
        sourceNetwork: "base",
        assetLocator: EVM_ADDRESS,
      },
      { signal: input.signal },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=15");
    expect(response.headers.get("x-programmable-market-provider"))
      .toBe("dexscreener");
    expect(response.headers.get("x-programmable-read-purpose"))
      .toBe("informational-only");
    expect(body).toMatchObject({
      selectionKey: `evm:8453:${EVM_ADDRESS}`,
      status: "available",
      source: "dexscreener",
      observedAt: OBSERVED_AT,
      usage: "informational-only",
    });
    expect(body).not.toHaveProperty("assetKey");
    expect(body).not.toHaveProperty("oracleStatus");
  });

  it.each([
    ["not-found", 404],
    ["market-data-unavailable", 503],
    ["timeout", 503],
    ["response-invalid", 503],
  ] as const)("maps %s to a fail-closed HTTP response", async (
    reason,
    expectedStatus,
  ) => {
    mocks.read.mockResolvedValue({
      schemaVersion: 2,
      selectionKey: `evm:1:${EVM_ADDRESS}`,
      status: "unavailable",
      reason,
      source: "dexscreener",
      observedAt: OBSERVED_AT,
      usage: "informational-only",
    });

    const response = await GET(request(
      `network=ethereum&locator=${EVM_ADDRESS}`,
    ));

    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe(
      expectedStatus === 503 ? "5" : null,
    );
    await expect(response.json()).resolves.toMatchObject({
      status: "unavailable",
      reason,
      source: "dexscreener",
      observedAt: OBSERVED_AT,
      usage: "informational-only",
    });
  });
});
