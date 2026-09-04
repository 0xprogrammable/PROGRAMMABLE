import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  coordinatePublicRouteRead: vi.fn(),
  preparePublicRouteRequest: vi.fn(
    async (value: URLSearchParams, headers: Headers, _route: string) => {
      void _route;
      const search = new URLSearchParams(value);
      if (headers.get("x-programmable-shadow-probe") === "error") {
        return {
          searchParams: search,
          probeFailure: Response.json(
            { error: "release_probe_temporarily_unavailable" },
            {
              status: 503,
              headers: { "Cache-Control": "private, no-store" },
            },
          ),
        };
      }
      const authorized = headers.get("x-programmable-shadow-probe") === "1";
      if (authorized) search.delete("__read_model_probe");
      return {
        searchParams: search,
        ...(authorized ? { releaseProbe: Object.freeze({}) } : {}),
      };
    },
  ),
}));

const fixtures = vi.hoisted(() => {
  const discoveryScope = [
    { model: "classic", releaseVersion: "classic-v2" },
    { model: "classic", releaseVersion: "classic-v3" },
    { model: "stock-paired", releaseVersion: "stock-paired-v1" },
    { model: "stock-paired", releaseVersion: "stock-paired-v2" },
    { model: "stock-paired", releaseVersion: "stock-paired-v3" },
  ] as const;
  return {
    discoveryScope,
    stockScope: discoveryScope.filter(
      (scope) => scope.model === "stock-paired",
    ),
  };
});

vi.mock("../lib/data-pipeline/public-route-readiness.server", () => ({
  coordinatePublicRouteRead: mocks.coordinatePublicRouteRead,
  PUBLIC_DISCOVERY_ROUTE_SCOPES: fixtures.discoveryScope,
  STOCK_PAIRED_ROUTE_SCOPES: fixtures.stockScope,
  preparePublicRouteRequest: mocks.preparePublicRouteRequest,
  publicSnapshotCheckpoint: (value: unknown) => value ?? undefined,
}));

import { GET as creatorProfile } from "../app/api/explore/profile/route";
import { GET as stockLaunchLookup } from
  "../app/api/explore/launch/stock-paired/route";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TRANSACTION = `0x${"22".repeat(32)}`;

describe("public route coordinator wiring", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns the creator-profile reset contract without identity or RPC work", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Outbound fetch must not run"),
    );

    const response = await creatorProfile(new NextRequest(
      `http://localhost/api/explore/profile?account=${ACCOUNT}`,
    ));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: "error",
      error: {
        kind: "temporary",
        code: "creator_profile_temporarily_unavailable",
        message: "Onchain creator data is temporarily unavailable",
      },
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("3600");
    expect(response.headers.get("x-programmable-indexing-status")).toBe("reset");
    expect(response.headers.get("x-programmable-read-source")).toBeNull();
    expect(response.headers.get("x-programmable-rpc-provider")).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.coordinatePublicRouteRead).not.toHaveBeenCalled();
  });

  it.each([
    ["account=bad", "Enter a valid Ethereum account address"],
    [`account=${ACCOUNT}&unexpected=1`, "Unsupported query parameters"],
    [`account=${ACCOUNT}&account=${ACCOUNT}`, "Unsupported query parameters"],
  ])("preserves creator-profile request validation for %s", async (query, error) => {
    const response = await creatorProfile(new NextRequest(
      `http://localhost/api/explore/profile?${query}`,
    ));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error });
    expect(response.headers.get("x-programmable-indexing-status")).toBeNull();
  });

  it("keeps the creator-profile route free of identity, RPC, and index imports", () => {
    const source = readFileSync(
      new URL("../app/api/explore/profile/route.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/gmgn|dexscreener|bitquery|envio|alchemy|registry/iu);
    expect(source).not.toMatch(/createPublicClient|readFinalized|\bfetch\s*\(/u);
  });

  it("wires Stock-Paired confirmation through the shared launch lookup gate", async () => {
    mocks.coordinatePublicRouteRead.mockResolvedValue(
      Response.json({ status: "coordinated" }),
    );

    const response = await stockLaunchLookup(new NextRequest(
      `http://localhost/api/explore/launch/stock-paired?account=${ACCOUNT}&transaction=${TRANSACTION}`,
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "coordinated" });
    expect(mocks.coordinatePublicRouteRead).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "launch-lookup",
        scope: fixtures.stockScope,
      }),
    );
  });

  it("strips an authorized probe nonce before validating Stock-Paired lookup input", async () => {
    mocks.coordinatePublicRouteRead.mockResolvedValue(
      Response.json({ status: "coordinated" }),
    );

    const response = await stockLaunchLookup(new NextRequest(
      `http://localhost/api/explore/launch/stock-paired?account=${ACCOUNT}&transaction=${TRANSACTION}&__read_model_probe=release-1`,
      { headers: { "x-programmable-shadow-probe": "1" } },
    ));

    expect(response.status).toBe(200);
    expect(mocks.preparePublicRouteRequest).toHaveBeenCalledTimes(1);
    expect(mocks.coordinatePublicRouteRead).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "launch-lookup",
        releaseProbe: expect.any(Object),
      }),
    );
  });

  it("rejects invalid Stock-Paired lookup input before coordination", async () => {
    const response = await stockLaunchLookup(new NextRequest(
      "http://localhost/api/explore/launch/stock-paired?account=bad&transaction=bad",
    ));

    expect(response.status).toBe(400);
    expect(mocks.coordinatePublicRouteRead).not.toHaveBeenCalled();
  });

  it("returns the private probe failure before route validation or coordination", async () => {
    const response = await stockLaunchLookup(new NextRequest(
      "http://localhost/api/explore/launch/stock-paired?__read_model_probe=release-1",
      { headers: { "x-programmable-shadow-probe": "error" } },
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.coordinatePublicRouteRead).not.toHaveBeenCalled();
  });
});
