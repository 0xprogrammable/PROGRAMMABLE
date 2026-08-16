import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const mocks = vi.hoisted(() => ({ readCatalog: vi.fn(), readDex: vi.fn() }));

vi.mock("../lib/market-data/last-good-launch-catalog.server", () => ({
  readLastGoodLaunchCatalogV1: mocks.readCatalog,
}));
vi.mock("../lib/market-data/dexscreener-explore.server", () => ({
  readDexscreenerExploreEntriesV1: mocks.readDex,
}));

import { GET } from "../app/api/explore/token/route";

const NOW = "2026-08-16T08:00:00.000Z";

function token(): ExploreEntry {
  const value = {
    id: "1:0x1111111111111111111111111111111111111111",
    name: "Known Token",
    symbol: "KNOWN",
    tokenAddress: "0x1111111111111111111111111111111111111111",
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${"44".repeat(32)}` as const,
    launchedAt: NOW,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
    launchModelVersion: "classic-v3",
  } satisfies LauncherToken;
  return {
    ...value,
    exploreKind: "token",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: value.id,
      modelId: "classic",
      modelVersion: "classic-v3",
    },
  };
}

const entry = token();

function catalog() {
  return {
    source: "durable-blob",
    status: "last-known-good",
    generatedAt: NOW,
    asOfBlock: "25740000",
    asOfBlockHash: `0x${"ab".repeat(32)}`,
    entries: [entry],
    completeness: {
      classic: "last-known-good",
      stock: "unavailable",
      custom: "unavailable",
    },
    evidence: { kind: "durable-envelope", commitment: `0x${"cd".repeat(32)}` },
  };
}

function marketRead(status: "complete" | "partial" | "unavailable") {
  const available = status === "complete";
  return {
    provider: "dexscreener",
    status,
    currency: "USD",
    requestedCount: 1,
    observedCount: available ? 1 : 0,
    qualifiedCount: available ? 1 : 0,
    unavailableCount: available ? 0 : 1,
    oldestFetchedAt: available ? NOW : null,
    newestFetchedAt: available ? NOW : null,
  };
}

function request(address: string = entry.tokenAddress!, extra = "") {
  return new NextRequest(
    `http://localhost/api/explore/token?address=${address}${extra}`,
  );
}

async function json(response: Response) {
  // Test fixtures intentionally inspect several public response variants.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await response.json() as Record<string, any>;
}

describe("Token detail static identity and Dexscreener market contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readCatalog.mockResolvedValue(catalog());
    mocks.readDex.mockResolvedValue({
      entries: [{
        ...entry,
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          currency: "usd",
          valueWad: "9000000000000000000000",
          freshness: "current",
          source: "dexscreener",
          asOfTime: NOW,
        },
      }],
      marketRead: marketRead("complete"),
    });
  });

  it("serves a known identity with Dexscreener FDV", async () => {
    const response = await GET(request());
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      token: {
        id: entry.id,
        tokenAddress: entry.tokenAddress,
        valuation: {
          status: "available",
          source: "dexscreener",
          valueWad: "9000000000000000000000",
        },
      },
      customProject: null,
      snapshot: { chainId: 1 },
    });
    expect(response.headers.get("x-programmable-read-source")).toBe(
      "durable-blob+dexscreener",
    );
    expect(response.headers.get("x-programmable-price-source")).toBe(
      "dexscreener",
    );
  });

  it("retains the requested identity when Dexscreener has no exact pair", async () => {
    mocks.readDex.mockResolvedValueOnce({
      entries: [{
        ...entry,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }],
      marketRead: marketRead("unavailable"),
    });
    const response = await GET(request());
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.token).toMatchObject({
      id: entry.id,
      tokenAddress: entry.tokenAddress,
      valuation: { status: "unavailable", reason: "source-unavailable" },
    });
    expect(response.headers.get("x-programmable-market-source")).toBeNull();
    expect(response.headers.get("x-programmable-price-source")).toBeNull();
    expect(response.headers.get("x-programmable-market-read-status")).toBe(
      "unavailable",
    );
  });

  it("retains the identity when the market adapter unexpectedly throws", async () => {
    mocks.readDex.mockRejectedValueOnce(new Error("Dex outage"));
    const response = await GET(request());
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body.token.id).toBe(entry.id);
    expect(body.token.valuation).toEqual({
      status: "unavailable",
      reason: "source-unavailable",
    });
  });

  it("returns 404 without invoking Dex for an unknown identity", async () => {
    const response = await GET(
      request("0x9999999999999999999999999999999999999999"),
    );
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ token: null, customProject: null });
    expect(mocks.readDex).not.toHaveBeenCalled();
  });

  it.each([
    ["0x1234", ""],
    [entry.tokenAddress!, "&unexpected=true"],
    [entry.tokenAddress!, `&address=${entry.tokenAddress}`],
  ])("rejects malformed or repeated input", async (address, extra) => {
    const response = await GET(request(address, extra));
    expect(response.status).toBe(400);
    expect(mocks.readCatalog).not.toHaveBeenCalled();
    expect(mocks.readDex).not.toHaveBeenCalled();
  });

  it("returns 503 only when no validated identity catalog can be read", async () => {
    mocks.readCatalog.mockRejectedValueOnce(new Error("catalog unavailable"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({
      error: "Token data is temporarily unavailable",
    });
    expect(mocks.readDex).not.toHaveBeenCalled();
  });
});
