import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { INDEXED_ROUTE_FLAG_NAMES } from "../../lib/data-pipeline/config";
import {
  readIndexedReadModelHealth,
  resetReadModelHealthForTests,
} from "../../lib/data-pipeline/read-model-health.server";

const NOW = Date.parse("2026-08-03T04:00:00.000Z");
const PHYSICAL_IDENTITY: Readonly<{
  databaseName: string;
  systemIdentifier: string;
}> = Object.freeze({
  databaseName: "postgres",
  systemIdentifier: "7666007964130682852",
});
const RELEASE_SCOPES = Object.freeze([
  Object.freeze({ releaseId: "classic-v2", modelId: "classic", sourceGroup: "core" }),
  Object.freeze({ releaseId: "classic-v3", modelId: "classic", sourceGroup: "core" }),
  Object.freeze({ releaseId: "stock-paired-v1", modelId: "stock-paired", sourceGroup: "core" }),
  Object.freeze({ releaseId: "stock-paired-v2", modelId: "stock-paired", sourceGroup: "core" }),
  Object.freeze({ releaseId: "stock-paired-v3", modelId: "stock-paired", sourceGroup: "core" }),
]);

function indexedEnvironment() {
  return Object.fromEntries(
    INDEXED_ROUTE_FLAG_NAMES.map((name) => [name, "true"]),
  );
}

function checkpointRows(createdAt = "2026-08-03T03:59:00.000Z") {
  return RELEASE_SCOPES.map((scope, index) => ({
    chain_id: "1",
    release_id: scope.releaseId,
    model_id: scope.modelId,
    source_group: scope.sourceGroup,
    block_number: String(25_600_000 + index),
    created_at: createdAt,
  }));
}

function marketRows(options: Readonly<{
  cursorAdvancedAt?: string;
  sourceBlockOffset?: number;
  sourceCreatedAt?: string;
}> = {}) {
  return RELEASE_SCOPES.map((scope, index) => {
    const blockNumber = String(25_600_000 + index);
    const sourceBlockNumber = String(
      25_600_000 + index + (options.sourceBlockOffset ?? 0),
    );
    const blockHash = `0x${String(index + 1).padStart(64, "0")}`;
    const epochId = `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    return {
      chain_id: "1",
      release_id: scope.releaseId,
      model_id: scope.modelId,
      source_group: scope.sourceGroup,
      market_projector_version: "market-projector-v1",
      pool_id: `0x${String(index + 11).padStart(64, "0")}`,
      cursor_epoch_id: epochId,
      cursor_pointer_generation: "1",
      cursor_generation: "2",
      cursor_reorg_generation: "0",
      cursor_source_reorg_generation: "0",
      cursor_block_number: blockNumber,
      cursor_block_hash: blockHash,
      cursor_advanced_at:
        options.cursorAdvancedAt ?? "2026-08-03T03:59:00.000Z",
      hour_coverage_end: "2026-08-03T04:00:00.000Z",
      day_coverage_end: "2026-08-03T00:00:00.000Z",
      source_projector_version: "projector-v1",
      source_checkpoint_epoch_id: epochId,
      source_checkpoint_pointer_generation: "1",
      source_checkpoint_generation: "3",
      source_checkpoint_reorg_generation: "0",
      source_checkpoint_block_number: sourceBlockNumber,
      source_checkpoint_block_hash: blockHash,
      source_checkpoint_cursor_block_global_log_index: "4294967295",
      source_checkpoint_cursor_candidate_id: "empty-page",
      source_checkpoint_created_at:
        options.sourceCreatedAt ?? "2026-08-03T03:59:00.000Z",
      latest_snapshot_block_number: blockNumber,
      latest_snapshot_observed_at: "2026-08-03T03:59:00.000Z",
      latest_snapshot_attached_at: "2026-08-03T03:59:00.000Z",
      latest_snapshot_reconciled_at: "2026-08-03T03:59:00.000Z",
    };
  });
}

function fixture(options: Readonly<{
  projectorIdentity?: typeof PHYSICAL_IDENTITY;
  apiIdentity?: typeof PHYSICAL_IDENTITY;
  bindingError?: Error;
  checkpointRows?: readonly Record<string, unknown>[];
  marketRows?: readonly Record<string, unknown>[];
  circuitState?: "closed" | "open";
  readinessParity?: "current" | "pending" | "stale" | "mismatch" | "missing";
}> = {}) {
  const close = vi.fn(async () => undefined);
  const query = vi.fn(async (text: string) => {
    if (text.includes("pg_control_system")) {
      const identity = options.apiIdentity ?? PHYSICAL_IDENTITY;
      return [{
        database_name: identity.databaseName,
        system_identifier: identity.systemIdentifier,
      }];
    }
    if (text.includes("checkpoint_summary_v1")) {
      return options.checkpointRows ?? checkpointRows();
    }
    if (text.includes("health_summary_v1")) {
      return options.circuitState
        ? [{ dependency: "postgres", circuit_status: options.circuitState }]
        : [];
    }
    if (text.includes("launch_by_token_v2")) {
      return marketRows().map((row) => ({
        release_id: row.release_id,
        model_id: row.model_id,
        source_group: row.source_group,
        pool_id: row.pool_id,
      }));
    }
    if (text.includes("market_projector_health_v1")) {
      return options.marketRows ?? marketRows();
    }
    throw new Error(`unexpected query: ${text}`);
  });
  const assertCandidateDatabasePromotedState = options.bindingError
    ? vi.fn(async () => {
        throw options.bindingError;
      })
    : vi.fn(async () => options.projectorIdentity ?? PHYSICAL_IDENTITY);
  const readExactRouteSnapshotReadiness = vi.fn(async (input: {
    scope: readonly Readonly<{ model: string; releaseVersion: string }>[];
  }) => ({
    readiness: input.scope.map((scope, index) => ({
      ...scope,
      eligibility: "eligible" as const,
      parity: options.readinessParity ?? ("current" as const),
      version: {
        checkpointId: `00000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
        sourceGroup: "core",
        projectorVersion: "projector-v1",
        epochId: `00000000-0000-4000-8000-${String(index + 30).padStart(12, "0")}`,
        pointerGeneration: "1",
        checkpointGeneration: "1",
        reorgGeneration: "0",
        blockNumber: "25600000",
        blockHash: `0x${"11".repeat(32)}`,
      },
    })),
  }));
  const dependencies = {
    getServerReadModel: vi.fn(async () => ({
      repeatableReadSnapshot: async (work: (transaction: { query: typeof query }) => Promise<unknown>) =>
        work({ query }),
    })),
    loadProjectorRuntimeConfig: vi.fn(() => ({
      binding: {
        mode: "release",
        candidate: null,
        promotedDatabase: {
          providerDeploymentId: "d08b62a6-74fb-5e0a-a698-dc6877150db4",
          deploymentCommitment: `0x${"11".repeat(32)}`,
          schemaCommitment: `0x${"22".repeat(32)}`,
          initializationInputCommitment: `0x${"33".repeat(32)}`,
          initializedAt: "2026-08-01T09:00:00.000Z",
          productCommit: "a".repeat(40),
          stagedDeploymentId: "dpl_aaaaaaaaaaaaaaaaaaaaaaaa",
        },
      },
      database: {
        projectorConnectionString:
          "postgresql://programmable_projector_login:password@127.0.0.1:5432/postgres?sslmode=disable",
        runtimeConnectionString:
          "postgresql://programmable_projector_runtime_login:password@127.0.0.1:5432/postgres?sslmode=disable",
        sslCaPem: "unused-in-loopback-test",
      },
      releaseScopes: RELEASE_SCOPES,
    })),
    createPostgresExecutor: vi.fn(() => ({ close })),
    assertCandidateDatabasePromotedState,
    readExactRouteSnapshotReadiness,
    nowMs: vi.fn(() => NOW),
  };
  return {
    dependencies,
    close,
    query,
    assertCandidateDatabasePromotedState,
    readExactRouteSnapshotReadiness,
  };
}

describe("indexed read-model operations health", () => {
  beforeEach(() => resetReadModelHealthForTests());

  it("preserves legacy health without parsing unrelated pipeline configuration", async () => {
    const input = fixture();
    await expect(readIndexedReadModelHealth(
      { PROGRAMMABLE_ENVIO_GRAPHQL_URL: "not-a-url" },
      input.dependencies as never,
    )).resolves.toBeNull();
    expect(input.dependencies.loadProjectorRuntimeConfig).not.toHaveBeenCalled();
    expect(input.dependencies.getServerReadModel).not.toHaveBeenCalled();
    expect(input.dependencies.createPostgresExecutor).not.toHaveBeenCalled();
  });

  it("treats partial indexed activation as a Postgres-backed rollout", async () => {
    const input = fixture();
    await expect(readIndexedReadModelHealth(
      { [INDEXED_ROUTE_FLAG_NAMES[0]]: "true" },
      input.dependencies as never,
    )).resolves.toMatchObject({ chainId: 1 });
    expect(input.dependencies.loadProjectorRuntimeConfig).toHaveBeenCalledOnce();
  });

  it("rejects non-canonical activation values before opening a database", async () => {
    const input = fixture();
    await expect(readIndexedReadModelHealth(
      { [INDEXED_ROUTE_FLAG_NAMES[0]]: "1" },
      input.dependencies as never,
    )).rejects.toThrow("Indexed read-model health is unavailable");
    expect(input.dependencies.loadProjectorRuntimeConfig).not.toHaveBeenCalled();
  });

  it("revalidates the promoted physical database and current routes on each health request", async () => {
    const input = fixture({ circuitState: "closed" });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      input.dependencies as never,
    )).resolves.toEqual({
      chainId: 1,
      index: { ageSeconds: 60, blockNumber: "25600000", tokenCount: 5 },
    });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      input.dependencies as never,
    )).resolves.toMatchObject({ chainId: 1 });
    expect(input.assertCandidateDatabasePromotedState).toHaveBeenCalledTimes(2);
    expect(input.dependencies.createPostgresExecutor).toHaveBeenCalledTimes(2);
    expect(input.close).toHaveBeenCalledTimes(2);
    expect(input.readExactRouteSnapshotReadiness).toHaveBeenCalledTimes(12);
  });

  it("closes and retries after a failed immutable promotion binding", async () => {
    const input = fixture({ bindingError: new Error("not promoted") });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      input.dependencies as never,
    )).rejects.toThrow("not promoted");
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      input.dependencies as never,
    )).rejects.toThrow("not promoted");
    expect(input.assertCandidateDatabasePromotedState).toHaveBeenCalledTimes(2);
    expect(input.close).toHaveBeenCalledTimes(2);
  });

  it("rejects a promoted projector and API reader on different clusters", async () => {
    const input = fixture({
      apiIdentity: {
        databaseName: "postgres",
        systemIdentifier: "7666007964130682853",
      },
    });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      input.dependencies as never,
    )).rejects.toThrow("Indexed read-model health is unavailable");
  });

  it("rejects non-current route parity and an open circuit", async () => {
    const parity = fixture({ readinessParity: "stale" });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      parity.dependencies as never,
    )).rejects.toThrow("Indexed read-model health is unavailable");

    resetReadModelHealthForTests();
    const circuit = fixture({ circuitState: "open" });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      circuit.dependencies as never,
    )).rejects.toThrow("Indexed read-model health is unavailable");
  });

  it("rejects missing market-projector coverage", async () => {
    const missing = fixture({ marketRows: [] });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      missing.dependencies as never,
    )).rejects.toThrow("Indexed read-model health is unavailable");

  });

  it("accepts an inactive caught-up market cursor after empty source checkpoints", async () => {
    const input = fixture({
      marketRows: marketRows({
        cursorAdvancedAt: "2026-08-01T04:00:00.000Z",
        sourceBlockOffset: 500,
      }),
    });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      input.dependencies as never,
    )).resolves.toMatchObject({ chainId: 1 });
  });

  it("accepts null candle coverage for an inactive pool with no completed trades", async () => {
    const rows = marketRows().map((row, index) => index === 0 ? {
      ...row,
      hour_coverage_end: null,
      day_coverage_end: null,
    } : row);
    const input = fixture({ marketRows: rows });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      input.dependencies as never,
    )).resolves.toMatchObject({ chainId: 1 });
  });

  it("treats shadow comparison as a Postgres-backed health mode", async () => {
    const input = fixture();
    await expect(readIndexedReadModelHealth(
      { INDEXED_READ_SHADOW_COMPARE_ENABLED: "true" },
      input.dependencies as never,
    )).resolves.toMatchObject({ chainId: 1 });
    expect(input.dependencies.loadProjectorRuntimeConfig).toHaveBeenCalledOnce();
  });

  it("rejects stale or implausibly future-dated source checkpoints", async () => {
    const stale = fixture({
      checkpointRows: checkpointRows("2026-08-03T03:44:59.999Z"),
    });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      stale.dependencies as never,
    )).rejects.toThrow("Indexed read-model health is unavailable");

    resetReadModelHealthForTests();
    const future = fixture({
      checkpointRows: checkpointRows("2026-08-03T04:01:00.001Z"),
    });
    await expect(readIndexedReadModelHealth(
      indexedEnvironment(),
      future.dependencies as never,
    )).rejects.toThrow("Indexed read-model health is unavailable");
  });
});
