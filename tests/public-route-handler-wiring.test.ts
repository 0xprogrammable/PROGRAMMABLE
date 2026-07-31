import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  buildCreatorProfile: vi.fn(),
  coordinatePublicRouteRead: vi.fn(),
  publicRouteSearchParams: vi.fn(
    (value: URLSearchParams, headers: Headers) => {
      const search = new URLSearchParams(value);
      if (headers.get("x-programmable-shadow-probe") === "1") {
        search.delete("__read_model_probe");
      }
      return search;
    },
  ),
  readExploreModel: vi.fn(),
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
  publicRouteSearchParams: mocks.publicRouteSearchParams,
  publicSnapshotCheckpoint: (value: unknown) => value ?? undefined,
}));

vi.mock("../lib/onchain", () => ({
  buildCreatorProfile: mocks.buildCreatorProfile,
  readExploreModel: mocks.readExploreModel,
}));

import { GET as creatorProfile } from "../app/api/explore/profile/route";
import { GET as stockLaunchLookup } from "../app/api/explore/launch/stock-paired/route";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TRANSACTION = `0x${"22".repeat(32)}`;

describe("public route coordinator wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wires creator profile through the aggregate reviewed scope", async () => {
    const snapshot = {
      blockNumber: "25650000",
      blockHash: `0x${"33".repeat(32)}`,
    };
    mocks.readExploreModel.mockResolvedValue({ status: "ready", snapshot });
    mocks.buildCreatorProfile.mockReturnValue({
      status: "ready",
      account: ACCOUNT,
      tokens: [],
    });
    mocks.coordinatePublicRouteRead.mockImplementation(
      async (input: { legacy: () => Promise<{ response: Response }> }) =>
        (await input.legacy()).response,
    );

    const response = await creatorProfile(
      new NextRequest(
        `http://localhost/api/explore/profile?account=${ACCOUNT}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.coordinatePublicRouteRead).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "creator-profile",
        scope: fixtures.discoveryScope,
      }),
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=0, s-maxage=15",
    );
  });

  it("wires Stock-Paired confirmation through the shared launch lookup gate", async () => {
    mocks.coordinatePublicRouteRead.mockResolvedValue(
      Response.json({ status: "coordinated" }),
    );

    const response = await stockLaunchLookup(
      new NextRequest(
        `http://localhost/api/explore/launch/stock-paired?account=${ACCOUNT}&transaction=${TRANSACTION}`,
      ),
    );

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

    const response = await stockLaunchLookup(
      new NextRequest(
        `http://localhost/api/explore/launch/stock-paired?account=${ACCOUNT}&transaction=${TRANSACTION}&__read_model_probe=release-1`,
        { headers: { "x-programmable-shadow-probe": "1" } },
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.publicRouteSearchParams).toHaveBeenCalledTimes(1);
    expect(mocks.coordinatePublicRouteRead).toHaveBeenCalledWith(
      expect.objectContaining({ route: "launch-lookup" }),
    );
  });

  it("rejects invalid Stock-Paired lookup input before coordination", async () => {
    const response = await stockLaunchLookup(
      new NextRequest(
        "http://localhost/api/explore/launch/stock-paired?account=bad&transaction=bad",
      ),
    );

    expect(response.status).toBe(400);
    expect(mocks.coordinatePublicRouteRead).not.toHaveBeenCalled();
  });
});
