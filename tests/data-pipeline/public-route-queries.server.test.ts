import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { postgresPublicRouteQueries } from "../../lib/data-pipeline/public-route-queries.server";
import type { PostgresTransaction } from "../../lib/data-pipeline/postgres";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const HASH = `0x${"22".repeat(32)}`;
const COMMITMENT = `0x${"33".repeat(32)}`;
const CLASSIC = [
  { model: "classic", releaseVersion: "classic-v3" },
] as const;
const STOCK = [
  { model: "stock-paired", releaseVersion: "stock-paired-v1" },
  { model: "stock-paired", releaseVersion: "stock-paired-v2" },
  { model: "stock-paired", releaseVersion: "stock-paired-v3" },
] as const;
const DISCOVERY = [
  { model: "classic", releaseVersion: "classic-v2" },
  ...CLASSIC,
  ...STOCK,
] as const;

function routeKeyFor(kind: string) {
  if (kind === "explore") return "explore-list";
  if (kind === "token") return "explore-token";
  if (kind === "chart") return "explore-chart";
  if (kind === "classic-profile") return "classic-v3-profile";
  if (kind === "launch") return "launch-lookup";
  return "creator-profile";
}

function snapshot(kind: string, scope: readonly (typeof DISCOVERY)[number][]) {
  const routeKey = routeKeyFor(kind);
  return {
    adapterVersion: "indexed-route-adapters-v2",
    snapshotCommitment: COMMITMENT,
    chainId: 1,
    blockNumber: "100",
    blockHash: HASH,
    confirmations: 12,
    capturedAt: "2026-07-31T10:00:00.000Z",
    releasePointers: scope.map((member, index) => ({
      routeKey,
      chainId: 1,
      releaseVersion: member.releaseVersion,
      modelVersion: member.model,
      sourceGroup: `source-${index}`,
      projectorVersion: "projector-v2",
      epochId: `00000000-0000-4000-8000-00000000000${index + 1}`,
      pointerGeneration: String(index + 1),
      checkpointId: `10000000-0000-4000-8000-00000000000${index + 1}`,
      checkpointGeneration: "2",
      reorgGeneration: "0",
      checkpointBlockNumber: "100",
      checkpointBlockHash: HASH,
    })),
  };
}

function evidence(scope: readonly (typeof DISCOVERY)[number][]) {
  return scope.map((member, index) => ({
    modelVersion: member.model,
    releaseVersion: member.releaseVersion,
    parityRecordId: `20000000-0000-4000-8000-00000000000${index + 1}`,
    reconciliationId: `30000000-0000-4000-8000-00000000000${index + 1}`,
    parityEvidenceCommitment: COMMITMENT,
    parityBindingId: `40000000-0000-4000-8000-00000000000${index + 1}`,
    parityBindingCommitment: COMMITMENT,
  }));
}

function row(input: {
  kind: string;
  scope: readonly (typeof DISCOVERY)[number][];
  data: Record<string, unknown>;
  status?: number;
  recordScopes?: readonly Record<string, unknown>[];
}) {
  return {
    http_status: input.status ?? 200,
    payload: {
      status: "ready",
      snapshot: snapshot(input.kind, input.scope),
      data: input.data,
    },
    payload_complete: true,
    record_count: input.recordScopes?.length ?? 0,
    record_scopes: input.recordScopes ?? [],
    comparison_checkpoint_block_number: "100",
    comparison_checkpoint_block_hash: HASH,
    route_evidence: evidence(input.scope),
  };
}

function transaction(rows: readonly Record<string, unknown>[]) {
  const query = vi.fn(async () => rows);
  return { query, transaction: { query } as PostgresTransaction };
}

describe("atomic public route queries", () => {
  it.each([
    {
      name: "Explore",
      call: (tx: PostgresTransaction) =>
        postgresPublicRouteQueries.explore(tx, {
          chainId: 1,
          query: "v4",
          sort: "newest",
          page: 2,
          pageSize: 12,
          socials: "yes",
        }),
      functionName: "get_public_explore_page_v2",
      values: [1, "v4", "newest", 2, 12, "yes"],
      kind: "explore",
      scope: DISCOVERY,
      data: {
        request: {
          query: "v4",
          socials: "yes",
          sort: "newest",
          requestedPage: 2,
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
    },
    {
      name: "token detail",
      call: (tx: PostgresTransaction) =>
        postgresPublicRouteQueries.tokenDetail(tx, { chainId: 1, address: ADDRESS }),
      functionName: "get_public_explore_token_v1",
      values: [1, ADDRESS],
      kind: "token",
      scope: DISCOVERY,
      status: 404,
      data: { address: ADDRESS, token: null },
    },
    {
      name: "creator profile",
      call: (tx: PostgresTransaction) =>
        postgresPublicRouteQueries.creatorProfile(tx, { chainId: 1, account: ADDRESS }),
      functionName: "get_public_creator_profile_v1",
      values: [1, ADDRESS],
      kind: "creator",
      scope: DISCOVERY,
      data: { account: ADDRESS, tokens: [], claims: [] },
    },
    {
      name: "Classic profile",
      call: (tx: PostgresTransaction) =>
        postgresPublicRouteQueries.classicV3Profile(tx, { chainId: 1, account: ADDRESS }),
      functionName: "get_public_classic_v3_profile_v1",
      values: [1, ADDRESS],
      kind: "classic-profile",
      scope: CLASSIC,
      data: { account: ADDRESS, chainId: 1, rewards: [] },
    },
    {
      name: "Stock profile",
      call: (tx: PostgresTransaction) =>
        postgresPublicRouteQueries.stockPairedProfile(tx, { chainId: 1, account: ADDRESS }),
      functionName: "get_public_stock_paired_profile_v1",
      values: [1, ADDRESS],
      kind: "stock-profile",
      scope: STOCK,
      data: { account: ADDRESS, chainId: 1, rewards: [] },
    },
    {
      name: "Classic lookup",
      call: (tx: PostgresTransaction) =>
        postgresPublicRouteQueries.launchLookup(tx, {
          chainId: 1,
          surface: "classic-v3",
          account: ADDRESS,
          transactionHash: HASH,
        }),
      functionName: "get_public_launch_lookup_v1",
      values: [1, "classic-v3", ADDRESS, HASH],
      kind: "launch",
      scope: CLASSIC,
      data: {
        surface: "classic-v3",
        account: ADDRESS,
        transactionHash: HASH,
        resolution: "not-found",
        token: null,
      },
    },
    {
      name: "Stock lookup pending",
      call: (tx: PostgresTransaction) =>
        postgresPublicRouteQueries.launchLookup(tx, {
          chainId: 1,
          surface: "stock-paired",
          account: ADDRESS,
          transactionHash: HASH,
        }),
      functionName: "get_public_launch_lookup_v1",
      values: [1, "stock-paired", ADDRESS, HASH],
      kind: "launch",
      scope: STOCK,
      status: 202,
      data: {
        surface: "stock-paired",
        account: ADDRESS,
        transactionHash: HASH,
        resolution: "pending",
        token: null,
      },
    },
  ])("binds the exact $name reader", async (fixture) => {
    const mock = transaction([
      row({
        kind: fixture.kind,
        scope: fixture.scope,
        data: fixture.data,
        ...(fixture.status ? { status: fixture.status } : {}),
      }),
    ]);

    const result = await fixture.call(mock.transaction);

    expect(result.status).toBe("ready");
    expect(mock.query).toHaveBeenCalledWith(
      expect.stringContaining(fixture.functionName),
      fixture.values,
    );
  });

  it("binds chart evidence to its one returned source", async () => {
    const source = {
      ...snapshot("chart", DISCOVERY).releasePointers[0],
      snapshotCommitment: COMMITMENT,
      projectionRunId: "50000000-0000-4000-8000-000000000001",
      publicationCommitment: COMMITMENT,
      promotedBlockNumber: "100",
      promotedBlockHash: HASH,
    };
    const mock = transaction([
      row({
        kind: "chart",
        scope: DISCOVERY,
        recordScopes: [
          { model: "classic", releaseVersion: "classic-v2" },
        ],
        data: {
          address: ADDRESS,
          range: "1d",
          source,
          poolId: HASH,
          points: [],
          swapCount: "0",
          volumeNativeWei: "0",
          volumeUsdWad: null,
        },
      }),
    ]);

    await expect(
      postgresPublicRouteQueries.tokenChart(mock.transaction, {
        chainId: 1,
        address: ADDRESS,
        range: "1d",
      }),
    ).resolves.toMatchObject({ status: "ready" });
  });

  it("fails closed on absent, incomplete or inconsistent evidence", async () => {
    const absent = transaction([]);
    await expect(
      postgresPublicRouteQueries.tokenDetail(absent.transaction, {
        chainId: 1,
        address: ADDRESS,
      }),
    ).resolves.toEqual({
      status: "not-ready",
      reason: "reconciliation-incomplete",
    });

    const mismatched = row({
      kind: "token",
      scope: DISCOVERY,
      status: 404,
      data: { address: ADDRESS, token: null },
    });
    mismatched.record_count = 1;
    const invalid = transaction([mismatched]);
    await expect(
      postgresPublicRouteQueries.tokenDetail(invalid.transaction, {
        chainId: 1,
        address: ADDRESS,
      }),
    ).rejects.toThrow("record count evidence");
  });
});
