import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  coordinatePublicRouteRead: vi.fn(),
  configuredReader: vi.fn(),
  overlayExploreCanonicalResponse: vi.fn(),
  readIndexedFeedSnapshot: vi.fn(),
}));

vi.mock("../lib/data-pipeline/public-route-readiness.server", () => ({
  coordinatePublicRouteRead: mocks.coordinatePublicRouteRead,
  PUBLIC_DISCOVERY_ROUTE_SCOPES: [],
  PUBLIC_INDEXED_ROUTE_READS: { explore: vi.fn() },
  publicSnapshotCheckpoint: (value: unknown) => value,
  async preparePublicRouteRequest(
    search: URLSearchParams,
    headers: Headers,
  ) {
    const canonical = new URLSearchParams(search);
    const releaseProbe = headers.get("x-test-release-probe") === "1"
      ? Object.freeze({})
      : undefined;
    if (releaseProbe) canonical.delete("__read_model_probe");
    return {
      searchParams: canonical,
      ...(releaseProbe ? { releaseProbe } : {}),
    };
  },
}));

vi.mock("../lib/data-pipeline/optimistic-public-api-reader.server", () => ({
  CONFIGURED_OPTIMISTIC_PUBLIC_API_READER: Object.freeze({
    read: mocks.configuredReader,
  }),
}));

vi.mock("../lib/data-pipeline/optimistic-public-api-overlay.server", () => ({
  overlayExploreCanonicalResponse: mocks.overlayExploreCanonicalResponse,
}));

vi.mock("../app/api/indexers/v1/read-indexed-feed.server", () => ({
  readIndexedFeedSnapshot: mocks.readIndexedFeedSnapshot,
}));

import { GET } from "../app/api/explore/route";

describe("optimistic public route wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configuredReader.mockResolvedValue({ materialize: vi.fn() });
  });

  it("returns an authorized release probe byte-for-byte without overlay reads", async () => {
    const canonical = Response.json(
      { status: "canonical-probe" },
      {
        headers: {
          "Cache-Control": "private, no-store",
          "x-programmable-shadow-parity": "match",
        },
      },
    );
    mocks.coordinatePublicRouteRead.mockResolvedValue(canonical);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/explore?__read_model_probe=nonce",
        { headers: { "x-test-release-probe": "1" } },
      ),
    );

    expect(response).toBe(canonical);
    expect(response.headers.get("x-programmable-shadow-parity")).toBe("match");
    expect(mocks.configuredReader).not.toHaveBeenCalled();
    expect(mocks.readIndexedFeedSnapshot).not.toHaveBeenCalled();
    expect(mocks.overlayExploreCanonicalResponse).not.toHaveBeenCalled();
  });

  it("attempts the overlay only after the canonical non-probe response exists", async () => {
    const canonical = Response.json({ status: "ready" });
    const feed = { model: { status: "ready", tokens: [] } };
    const overlaid = Response.json({ status: "ready", optimistic: true });
    mocks.coordinatePublicRouteRead.mockResolvedValue(canonical);
    mocks.readIndexedFeedSnapshot.mockResolvedValue(feed);
    mocks.overlayExploreCanonicalResponse.mockResolvedValue(overlaid);

    const response = await GET(
      new NextRequest("http://localhost/api/explore?page=1&limit=6"),
    );

    expect(response).toBe(overlaid);
    expect(mocks.readIndexedFeedSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.configuredReader).toHaveBeenCalledWith(1);
    expect(mocks.overlayExploreCanonicalResponse).toHaveBeenCalledWith(
      expect.objectContaining({ canonical, feed }),
    );
  });

  it("fails open to the canonical response when the full feed is unavailable", async () => {
    const canonical = Response.json({ status: "ready" });
    mocks.coordinatePublicRouteRead.mockResolvedValue(canonical);
    mocks.readIndexedFeedSnapshot.mockRejectedValue(new Error("database down"));

    const response = await GET(
      new NextRequest("http://localhost/api/explore?page=1&limit=6"),
    );

    expect(response).toBe(canonical);
    expect(mocks.overlayExploreCanonicalResponse).not.toHaveBeenCalled();
  });
});
