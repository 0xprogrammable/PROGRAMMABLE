import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  coordinatePublicRouteRead: vi.fn(),
  getAlchemyOnchainDeployment: vi.fn(),
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
      const authorized =
        headers.get("x-programmable-shadow-probe") === "1";
      if (authorized) {
        search.delete("__read_model_probe");
      }
      return {
        searchParams: search,
        ...(authorized ? { releaseProbe: Object.freeze({}) } : {}),
      };
    },
  ),
  readAlchemyCreatorProfile: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
  safeAlchemyError: vi.fn((error) => error),
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

vi.mock("../lib/alchemy/explore.server", () => ({
  getAlchemyOnchainDeployment: mocks.getAlchemyOnchainDeployment,
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  safeAlchemyError: mocks.safeAlchemyError,
}));

vi.mock("../lib/alchemy/profile.server", () => ({
  readAlchemyCreatorProfile: mocks.readAlchemyCreatorProfile,
}));

import { GET as creatorProfile } from "../app/api/explore/profile/route";
import { GET as stockLaunchLookup } from "../app/api/explore/launch/stock-paired/route";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const TRANSACTION = `0x${"22".repeat(32)}`;

describe("public route coordinator wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports the indexed model and operational RPC profile sources", async () => {
    const snapshot = {
      blockNumber: "25650000",
      blockHash: `0x${"33".repeat(32)}`,
    };
    const model = { status: "ready", snapshot };
    const deployment = { status: "ready", chainId: 1 };
    mocks.readAlchemyExploreModel.mockResolvedValue(model);
    mocks.getAlchemyOnchainDeployment.mockReturnValue(deployment);
    mocks.readAlchemyCreatorProfile.mockResolvedValue({
      status: "ready",
      account: ACCOUNT,
      tokens: [],
    });

    const response = await creatorProfile(
      new NextRequest(
        `http://localhost/api/explore/profile?account=${ACCOUNT}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.readAlchemyCreatorProfile).toHaveBeenCalledWith({
      account: ACCOUNT,
      deployment,
      model,
    });
    expect(response.headers.get("Cache-Control")).toBe(
      "private, max-age=0, s-maxage=15",
    );
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "indexed-read-model+operational-rpc",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "operational-dual",
    );
    expect(response.headers.get("X-Programmable-Launch-Source")).not.toBe(
      "alchemy",
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
    expect(mocks.preparePublicRouteRequest).toHaveBeenCalledTimes(1);
    expect(mocks.coordinatePublicRouteRead).toHaveBeenCalledWith(
      expect.objectContaining({
        route: "launch-lookup",
        releaseProbe: expect.any(Object),
      }),
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

  it("returns the private probe failure before route validation or coordination", async () => {
    const response = await stockLaunchLookup(
      new NextRequest(
        `http://localhost/api/explore/launch/stock-paired?__read_model_probe=release-1`,
        { headers: { "x-programmable-shadow-probe": "error" } },
      ),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.coordinatePublicRouteRead).not.toHaveBeenCalled();
  });
});
