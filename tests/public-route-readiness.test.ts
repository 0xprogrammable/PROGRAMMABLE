import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const nonceConsumerMocks = vi.hoisted(() => {
  const consumed = new Set<string>();
  return {
    consumed,
    consumeReleaseProbeNonce: vi.fn(async (input: { route: string; nonce: string }) => {
      const key = `${input.route}:${input.nonce}`;
      if (consumed.has(key)) return false;
      consumed.add(key);
      return true;
    }),
  };
});

vi.mock("@/lib/data-pipeline/release-probe-nonce.server", () => ({
  consumeReleaseProbeNonce: nonceConsumerMocks.consumeReleaseProbeNonce,
}));

import {
  CLASSIC_V3_ROUTE_SCOPE,
  PUBLIC_DISCOVERY_ROUTE_SCOPES,
  preparePublicRouteRequest,
  readExactPublicRouteSnapshot,
  readExactRouteSnapshotReadiness,
} from "@/lib/data-pipeline/public-route-readiness.server";
import type { PostgresTransaction } from "@/lib/data-pipeline/postgres";
import { signRouteReleaseProbe } from "@/lib/data-pipeline/route-coordinator.server";

const HASH_A = `0x${"11".repeat(32)}` as const;
const HASH_B = `0x${"22".repeat(32)}` as const;
const COMMITMENT = `0x${"33".repeat(32)}` as const;
const ADDRESS = "0x1111111111111111111111111111111111111111";

function readinessRow(
  input: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    route_key: "classic-v3-profile",
    chain_id: "1",
    release_id: "classic-v3",
    model_id: "classic",
    source_group: "classic-mainnet",
    route_status: "eligible",
    eligibility_status: "eligible",
    route_mode: "indexed",
    projector_version: "projection-v3.1",
    epoch_id: "00000000-0000-4000-8000-000000000001",
    pointer_generation: "7",
    checkpoint_id: "00000000-0000-4000-8000-000000000002",
    checkpoint_generation: "11",
    reorg_generation: "2",
    checkpoint_block_number: "25650000",
    checkpoint_block_hash: HASH_A,
    safe_block_number: "25650012",
    checkpoint_confirmations: "12",
    parity_status: "current",
    parity_record_id: "00000000-0000-4000-8000-000000000003",
    reconciliation_id: "00000000-0000-4000-8000-000000000004",
    parity_is_match: true,
    parity_source_from_block: "25649900",
    parity_source_to_block: "25650000",
    parity_evidence_commitment: COMMITMENT,
    reconciliation_mismatch_count: "0",
    parity_checkpoint_id: "00000000-0000-4000-8000-000000000002",
    parity_checkpoint_generation: "11",
    parity_reorg_generation: "2",
    parity_block_number: "25650000",
    parity_block_hash: HASH_A,
    parity_binding_id: "00000000-0000-4000-8000-000000000005",
    parity_binding_commitment: COMMITMENT,
    ...input,
  };
}

function transaction(rows: readonly Record<string, unknown>[]) {
  const query = vi.fn(async () => rows);
  return {
    query,
    transaction: { query } as PostgresTransaction,
  };
}

describe("exact public route readiness", () => {
  beforeEach(() => {
    nonceConsumerMocks.consumed.clear();
    nonceConsumerMocks.consumeReleaseProbeNonce.mockClear();
  });

  it("removes an internal cache nonce only for the authorized probe", async () => {
    const token = "p".repeat(48);
    const nonce = `${Date.now()}-${"ab".repeat(32)}-1`;
    vi.stubEnv("PROGRAMMABLE_SHADOW_PROBE_TOKEN", token);
    try {
      const input = new URLSearchParams(
        `address=${ADDRESS}&__read_model_probe=${nonce}`,
      );
      const authorized = await preparePublicRouteRequest(
        input,
        new Headers({
          "x-programmable-shadow-probe": "1",
          "x-programmable-shadow-probe-signature": signRouteReleaseProbe({
            route: "explore-token",
            nonce,
            secret: token,
          }),
        }),
        "explore-token",
      );
      const unauthenticated = await preparePublicRouteRequest(
        input,
        new Headers(),
        "explore-token",
      );

      expect(authorized.searchParams.has("__read_model_probe")).toBe(false);
      expect(authorized.searchParams.get("address")).toBe(ADDRESS);
      expect(authorized.releaseProbe).toBeDefined();
      expect(
        unauthenticated.searchParams.get("__read_model_probe"),
      ).toBe(nonce);
      expect(unauthenticated.releaseProbe).toBeUndefined();
      expect(input.get("__read_model_probe")).toBe(nonce);
      expect(nonceConsumerMocks.consumeReleaseProbeNonce).toHaveBeenCalledTimes(
        1,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("returns a private fail-closed response when distributed nonce consumption is unavailable", async () => {
    const token = "r".repeat(48);
    const nonce = `${Date.now()}-${"ef".repeat(32)}-5`;
    vi.stubEnv("PROGRAMMABLE_SHADOW_PROBE_TOKEN", token);
    nonceConsumerMocks.consumeReleaseProbeNonce.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    const prepared = await preparePublicRouteRequest(
      new URLSearchParams(`__read_model_probe=${nonce}`),
      new Headers({
        "x-programmable-shadow-probe": "1",
        "x-programmable-shadow-probe-signature": signRouteReleaseProbe({
          route: "explore-token",
          nonce,
          secret: token,
        }),
      }),
      "explore-token",
    );

    expect(prepared.releaseProbe).toBeUndefined();
    expect(prepared.searchParams.get("__read_model_probe")).toBe(nonce);
    expect(prepared.probeFailure?.status).toBe(503);
    expect(prepared.probeFailure?.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
  });

  it("leaves malformed probe parameters to ordinary route validation without a database read", async () => {
    const prepared = await preparePublicRouteRequest(
      new URLSearchParams("__read_model_probe=malformed"),
      new Headers({
        "x-programmable-shadow-probe": "1",
        "x-programmable-shadow-probe-signature": "a".repeat(64),
      }),
      "explore-token",
    );

    expect(prepared.releaseProbe).toBeUndefined();
    expect(prepared.probeFailure).toBeUndefined();
    expect(prepared.searchParams.get("__read_model_probe")).toBe("malformed");
    expect(nonceConsumerMocks.consumeReleaseProbeNonce).not.toHaveBeenCalled();
  });

  it("rejects duplicated reserved nonces without a database read", async () => {
    const nonce = `${Date.now()}-${"fa".repeat(32)}-6`;
    const prepared = await preparePublicRouteRequest(
      new URLSearchParams(
        `__read_model_probe=${nonce}&__read_model_probe=${nonce}`,
      ),
      new Headers({
        "x-programmable-shadow-probe": "1",
        "x-programmable-shadow-probe-signature": "a".repeat(64),
      }),
      "explore-token",
    );

    expect(prepared.releaseProbe).toBeUndefined();
    expect(prepared.searchParams.getAll("__read_model_probe")).toEqual([
      nonce,
      nonce,
    ]);
    expect(nonceConsumerMocks.consumeReleaseProbeNonce).not.toHaveBeenCalled();
  });

  it("rejects stale, globally replayed and incorrectly authenticated probe nonces", async () => {
    const token = "q".repeat(48);
    const now = Date.now();
    const freshNonce = `${now}-${"bc".repeat(32)}-2`;
    const staleNonce = `${now - 5 * 60 * 1_000 - 1}-${"cd".repeat(32)}-3`;
    vi.stubEnv("PROGRAMMABLE_SHADOW_PROBE_TOKEN", token);
    try {
      const signedHeaders = (nonce: string, secret = token) =>
        new Headers({
          "x-programmable-shadow-probe": "1",
          "x-programmable-shadow-probe-signature": signRouteReleaseProbe({
            route: "explore-token",
            nonce,
            secret,
          }),
        });
      const prepare = (
        nonce: string,
        requestHeaders = signedHeaders(nonce),
      ) =>
        preparePublicRouteRequest(
          new URLSearchParams(`__read_model_probe=${nonce}`),
          requestHeaders,
          "explore-token",
        );

      expect((await prepare(freshNonce)).releaseProbe).toBeDefined();
      expect((await prepare(freshNonce)).releaseProbe).toBeUndefined();
      expect((await prepare(freshNonce)).searchParams.get("__read_model_probe")).toBe(
        freshNonce,
      );
      expect((await prepare(staleNonce)).releaseProbe).toBeUndefined();
      expect(
        (await prepare(
          `${now}-${"de".repeat(32)}-4`,
          signedHeaders(
            `${now}-${"de".repeat(32)}-4`,
            "x".repeat(48),
          ),
        )).releaseProbe,
      ).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("binds one adapted payload to the exact readiness generation", async () => {
    const mock = transaction([readinessRow()]);
    const indexed = vi.fn(async () => ({
      status: "ready" as const,
      routeKey: "classic-v3-profile" as const,
      snapshot: {
        adapterVersion: "indexed-route-adapters-v2" as const,
        snapshotCommitment: COMMITMENT,
        chainId: 1 as const,
        blockNumber: "25650000",
        blockHash: HASH_A,
        confirmations: 12,
        capturedAt: "2026-07-31T10:00:00.000Z",
        releasePointers: [
          {
            routeKey: "classic-v3-profile" as const,
            chainId: 1 as const,
            releaseVersion: "classic-v3" as const,
            modelVersion: "classic" as const,
            sourceGroup: "classic-mainnet",
            projectorVersion: "projection-v3.1",
            epochId: "00000000-0000-4000-8000-000000000001",
            pointerGeneration: "7",
            checkpointId: "00000000-0000-4000-8000-000000000002",
            checkpointGeneration: "11",
            reorgGeneration: "2",
            checkpointBlockNumber: "25650000",
            checkpointBlockHash: HASH_A,
          },
        ],
      },
      recordSources: [],
      response: {
        status: 200,
        body: {
          status: "ready",
          account: "0x1111111111111111111111111111111111111111",
          chainId: 1,
          snapshotBlock: "25650000",
          rewards: [],
        },
        headers: { "Cache-Control": "no-store" },
      },
    }));

    const result = await readExactPublicRouteSnapshot({
      transaction: mock.transaction,
      route: "classic-v3-profile",
      scope: CLASSIC_V3_ROUTE_SCOPE,
      indexed,
    });

    expect(indexed).toHaveBeenCalledWith(mock.transaction);
    expect(result.indexed).toMatchObject({
      source: "indexed",
      scopeEvidence: { recordCount: 0, recordScopes: [] },
      comparisonCheckpoint: {
        blockNumber: "25650000",
        blockHash: HASH_A,
      },
      versions: [
        {
          model: "classic",
          releaseVersion: "classic-v3",
          version: { checkpointGeneration: "11", reorgGeneration: "2" },
        },
      ],
    });
    expect(result.indexed?.response.status).toBe(200);
    await expect(result.indexed?.response.json()).resolves.toMatchObject({
      status: "ready",
      rewards: [],
    });
  });

  it("does not query a payload unless every exact scope has current parity", async () => {
    const mock = transaction([readinessRow({ parity_status: "pending" })]);
    const indexed = vi.fn();

    const result = await readExactPublicRouteSnapshot({
      transaction: mock.transaction,
      route: "classic-v3-profile",
      scope: CLASSIC_V3_ROUTE_SCOPE,
      indexed,
    });

    expect(indexed).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("indexed");
    expect(result.readiness[0]?.parity).toBe("pending");
  });

  it("uses the API-reader-only exact readiness view and binds parameters", async () => {
    const mock = transaction([readinessRow()]);
    const result = await readExactRouteSnapshotReadiness({
      transaction: mock.transaction,
      route: "classic-v3-profile",
      chainId: 1,
      scope: CLASSIC_V3_ROUTE_SCOPE,
    });

    expect(mock.query).toHaveBeenCalledTimes(1);
    const [sql, values] = mock.query.mock.calls[0] as unknown as [
      string,
      unknown[],
    ];
    expect(sql).toContain(
      "from programmable_private.route_snapshot_readiness_v1",
    );
    expect(sql).toContain("checkpoint_confirmations");
    expect(sql).not.toMatch(/\b(insert|update|delete|call)\b/i);
    expect(values).toEqual([
      "classic-v3-profile",
      1,
      ["classic-v3"],
      ["classic"],
    ]);
    expect(result).toEqual({
      readiness: [
        {
          model: "classic",
          releaseVersion: "classic-v3",
          eligibility: "eligible",
          parity: "current",
          version: {
            checkpointId: "00000000-0000-4000-8000-000000000002",
            sourceGroup: "classic-mainnet",
            projectorVersion: "projection-v3.1",
            epochId: "00000000-0000-4000-8000-000000000001",
            pointerGeneration: "7",
            checkpointGeneration: "11",
            reorgGeneration: "2",
            blockNumber: "25650000",
            blockHash: HASH_A,
          },
        },
      ],
    });
    expect(result).not.toHaveProperty("indexed");
  });

  it("returns missing/ineligible members for absent reviewed releases", async () => {
    const mock = transaction([]);
    const result = await readExactRouteSnapshotReadiness({
      transaction: mock.transaction,
      route: "explore-list",
      chainId: 1,
      scope: PUBLIC_DISCOVERY_ROUTE_SCOPES,
    });

    expect(result.readiness).toHaveLength(5);
    expect(result.readiness).toEqual(
      PUBLIC_DISCOVERY_ROUTE_SCOPES.map((scope) => ({
        ...scope,
        eligibility: "ineligible",
        parity: "missing",
      })),
    );
  });

  it("treats parity bound to a different checkpoint as stale", async () => {
    const mock = transaction([
      readinessRow({ parity_block_hash: HASH_B }),
    ]);
    const result = await readExactRouteSnapshotReadiness({
      transaction: mock.transaction,
      route: "classic-v3-profile",
      chainId: 1,
      scope: CLASSIC_V3_ROUTE_SCOPE,
    });

    expect(result.readiness[0]).toEqual({
      model: "classic",
      releaseVersion: "classic-v3",
      eligibility: "eligible",
      parity: "stale",
    });
  });

  it("keeps a recorded mismatch distinct from stale parity", async () => {
    const mock = transaction([
      readinessRow({
        parity_status: "mismatch",
        parity_is_match: false,
        reconciliation_mismatch_count: "1",
      }),
    ]);
    const result = await readExactRouteSnapshotReadiness({
      transaction: mock.transaction,
      route: "classic-v3-profile",
      chainId: 1,
      scope: CLASSIC_V3_ROUTE_SCOPE,
    });

    expect(result.readiness[0]?.parity).toBe("mismatch");
    expect(result.readiness[0]).not.toHaveProperty("version");
  });

  it("rejects ambiguous current source groups", async () => {
    const mock = transaction([
      readinessRow(),
      readinessRow({ source_group: "classic-mainnet-b" }),
    ]);
    await expect(
      readExactRouteSnapshotReadiness({
        transaction: mock.transaction,
        route: "classic-v3-profile",
        chainId: 1,
        scope: CLASSIC_V3_ROUTE_SCOPE,
      }),
    ).rejects.toThrow("Ambiguous route readiness source group");
  });

  it("rejects unsupported Deep or Adaptive rows returned by the database", async () => {
    const mock = transaction([
      readinessRow({
        release_id: "deep-v3",
        model_id: "deep",
      }),
    ]);
    await expect(
      readExactRouteSnapshotReadiness({
        transaction: mock.transaction,
        route: "classic-v3-profile",
        chainId: 1,
        scope: CLASSIC_V3_ROUTE_SCOPE,
      }),
    ).rejects.toThrow("Unsupported route readiness release");
  });

  it("propagates database unavailability for coordinator fallback", async () => {
    const query = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    await expect(
      readExactRouteSnapshotReadiness({
        transaction: { query },
        route: "classic-v3-profile",
        chainId: 1,
        scope: CLASSIC_V3_ROUTE_SCOPE,
      }),
    ).rejects.toThrow("database unavailable");
  });
});
