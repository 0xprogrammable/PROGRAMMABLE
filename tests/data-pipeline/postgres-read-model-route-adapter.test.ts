import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPostgresPublicRouteSnapshotAdapters,
  type IndexedRouteSnapshotQueries,
} from "../../lib/data-pipeline/postgres-read-model.server";
import type { PostgresTransaction } from "../../lib/data-pipeline/postgres";
import type {
  IndexedExploreListDataV2,
  IndexedRouteEnvelopeV2,
  IndexedSnapshotIdentityV2,
  SupportedIndexedReleaseVersionV2,
} from "../../lib/data-pipeline/route-adapters.server";

const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const SNAPSHOT_COMMITMENT = `0x${"22".repeat(32)}` as const;
const RELEASES = [
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const;

function modelFor(release: SupportedIndexedReleaseVersionV2) {
  return release.startsWith("stock-paired")
    ? ("stock-paired" as const)
    : ("classic" as const);
}

function snapshot(routeKey: "explore-list" | "explore-token"):
  IndexedSnapshotIdentityV2 {
  return {
    adapterVersion: "indexed-route-adapters-v2",
    snapshotCommitment: SNAPSHOT_COMMITMENT,
    chainId: 1,
    blockNumber: "25660000",
    blockHash: BLOCK_HASH,
    confirmations: 12,
    capturedAt: "2026-07-31T10:00:00.000Z",
    releasePointers: RELEASES.map((release, index) => ({
      routeKey,
      chainId: 1,
      releaseVersion: release,
      modelVersion: modelFor(release),
      sourceGroup: `source-${release}`,
      projectorVersion: "public-route-projector-v2",
      epochId: `10000000-0000-4000-8000-00000000000${index + 1}`,
      pointerGeneration: String(index + 1),
      checkpointId: `20000000-0000-4000-8000-00000000000${index + 1}`,
      checkpointGeneration: "9",
      reorgGeneration: "0",
      checkpointBlockNumber: "25660000",
      checkpointBlockHash: BLOCK_HASH,
    })),
  };
}

function exploreEnvelope(): IndexedRouteEnvelopeV2<IndexedExploreListDataV2> {
  return {
    status: "ready",
    snapshot: snapshot("explore-list"),
    data: {
      request: {
        query: "",
        sort: "newest",
        requestedPage: 1,
        pageSize: 12,
      },
      page: {
        resolvedPage: 1,
        totalCount: "0",
        valuationUnit: null,
        startAfter: null,
        endAt: null,
      },
      launcherFeesAccruedWei: "0",
      tokens: [],
    },
  };
}

function harness() {
  const transaction: PostgresTransaction = {
    async query() {
      throw new Error("adapter must not issue boundary queries");
    },
  };
  const unsupported = async () => {
    throw new Error("unexpected route query");
  };
  const explore = vi.fn(async () => exploreEnvelope());
  const tokenDetail = vi.fn(async () => ({
    status: "ready" as const,
    snapshot: snapshot("explore-token"),
    data: {
      address: "0x1111111111111111111111111111111111111111",
      token: null,
    },
  }));
  const queries = {
    explore,
    tokenDetail,
    tokenChart: unsupported,
    creatorProfile: unsupported,
    classicV3Profile: unsupported,
    stockPairedProfile: unsupported,
    launchLookup: unsupported,
  } as unknown as IndexedRouteSnapshotQueries;
  return { transaction, queries, explore, tokenDetail };
}

describe("Postgres public route snapshot adapters", () => {
  it("uses the coordinator-owned transaction and returns evidence inputs", async () => {
    const test = harness();
    const adapters = createPostgresPublicRouteSnapshotAdapters({
      queries: test.queries,
    });
    const request = {
      chainId: 1 as const,
      query: "",
      sort: "newest" as const,
      page: 1,
      pageSize: 12,
    };

    const result = await adapters.explore(test.transaction, request);

    expect(test.explore).toHaveBeenCalledTimes(1);
    expect(test.explore).toHaveBeenCalledWith(test.transaction, request);
    expect(result).toEqual({
      status: "ready",
      routeKey: "explore-list",
      snapshot: expect.objectContaining({
        adapterVersion: "indexed-route-adapters-v2",
        releasePointers: expect.arrayContaining([
          expect.objectContaining({
            projectorVersion: "public-route-projector-v2",
            reorgGeneration: "0",
          }),
        ]),
      }),
      recordSources: [],
      response: {
        status: 200,
        body: expect.objectContaining({
          status: "ready",
          total: 0,
          page: 1,
          tokens: [],
        }),
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=10, stale-while-revalidate=10",
        },
      },
    });
  });

  it("keeps a verified empty token lookup non-cacheable", async () => {
    const test = harness();
    const adapters = createPostgresPublicRouteSnapshotAdapters({
      queries: test.queries,
    });
    const request = {
      chainId: 1 as const,
      address: "0x1111111111111111111111111111111111111111",
    };

    const result = await adapters.tokenDetail(test.transaction, request);

    expect(test.tokenDetail).toHaveBeenCalledWith(test.transaction, request);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready result");
    expect(result.response.status).toBe(404);
    expect(result.response.headers).toEqual({ "Cache-Control": "no-store" });
    expect(result.recordSources).toEqual([]);
  });

  it("returns not-ready without fabricating payload or evidence", async () => {
    const test = harness();
    test.explore.mockResolvedValueOnce({
      status: "not-ready",
      reason: "reconciliation-incomplete",
    } as never);
    const adapters = createPostgresPublicRouteSnapshotAdapters({
      queries: test.queries,
    });

    await expect(
      adapters.explore(test.transaction, {
        chainId: 1,
        query: "",
        sort: "newest",
        page: 1,
        pageSize: 12,
      }),
    ).resolves.toEqual({
      status: "not-ready",
      routeKey: "explore-list",
      reason: "reconciliation-incomplete",
    });
  });
});
