import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../app/api/explore/token/chart/route";
import { isMarketChartError } from "../lib/market-data/market-data-v1";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function request(query: string) {
  return new NextRequest(`http://localhost/api/explore/token/chart?${query}`);
}

describe("Explore token chart index reset API", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [`address=${ADDRESS}`, "all"],
    [`address=${ADDRESS}&range=1d`, "1d"],
    [`address=${ADDRESS}&range=1W`, "1w"],
  ])("returns a provider-neutral v2 reset for %s", async (query, range) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Outbound fetch must not run"),
    );

    const response = await GET(request(query));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      schemaVersion: "programmable.market-chart-error.v2",
      source: "programmable",
      status: "unavailable",
      address: ADDRESS,
      range,
      reason: "identity-unavailable",
      error: "Price history is temporarily unavailable",
    });
    expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
    expect(isMarketChartError(body)).toBe(true);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(response.headers.get("x-programmable-indexing-status")).toBe("reset");
    expect(response.headers.get("x-programmable-read-source")).toBeNull();
    expect(response.headers.get("x-programmable-market-provider")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["address=bad", "Enter a valid Ethereum token address"],
    [`address=${ADDRESS}&range=bad`, "Choose a supported chart range"],
    [`address=${ADDRESS}&range=1d&fallback=true`, "Unsupported query parameters"],
    [`address=${ADDRESS}&address=${ADDRESS}`, "Unsupported query parameters"],
  ])("preserves request validation for %s", async (query, error) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(response.headers.get("x-programmable-indexing-status")).toBeNull();
  });

  it("contains no identity, chart-provider, RPC, or fetch dependency", () => {
    const source = readFileSync(
      new URL("../app/api/explore/token/chart/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/gmgn|dexscreener|bitquery|envio|alchemy|registry/iu);
    expect(source).not.toMatch(/createPublicClient|readFinalized|\bfetch\s*\(/u);
  });
});
