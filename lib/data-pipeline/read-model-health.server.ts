import "server-only";

import {
  assertCandidateDatabasePromotedState,
  type CandidateDatabasePromotionBinding,
  type DatabasePhysicalIdentity,
} from "./candidate-projector-runtime-binding.server";
import { INDEXED_ROUTE_FLAG_NAMES } from "./config";
import {
  createPostgresExecutor,
  type PostgresExecutor,
} from "./postgres";
import { validatedPostgresConnectionTarget } from "./postgres-connection.server";
import { loadProjectorRuntimeConfig } from "./projector-runtime-config.server";
import {
  readExactRouteSnapshotReadiness,
} from "./public-route-readiness.server";
import { reconcilerRouteKeysForScope } from "./reconciler-preparity";
import { getServerReadModel } from "./read-model.server";
import {
  ALL_REVIEWED_ROUTE_SCOPES,
  INDEXED_ROUTE_KEYS,
  type IndexedRouteKey,
  type ReviewedRouteScope,
} from "./route-coordinator.server";

type Environment = Readonly<Record<string, string | undefined>>;
type ServerReadModel = NonNullable<
  Awaited<ReturnType<typeof getServerReadModel>>
>;

type IndexedReadModelHealthDependencies = Readonly<{
  getServerReadModel: typeof getServerReadModel;
  loadProjectorRuntimeConfig: typeof loadProjectorRuntimeConfig;
  createPostgresExecutor: typeof createPostgresExecutor;
  assertCandidateDatabasePromotedState: typeof assertCandidateDatabasePromotedState;
  readExactRouteSnapshotReadiness: typeof readExactRouteSnapshotReadiness;
  nowMs: () => number;
}>;

type CheckpointHealthRow = Readonly<{
  chain_id: unknown;
  release_id: unknown;
  model_id: unknown;
  source_group: unknown;
  block_number: unknown;
  created_at: unknown;
}>;

type IndexedHealthResult = Readonly<{
  chainId: 1;
  index: Readonly<{
    ageSeconds: number;
    blockNumber: string;
    tokenCount: number;
  }>;
}>;

const MAXIMUM_CHECKPOINT_AGE_MS = 15 * 60 * 1_000;
const MAXIMUM_CLOCK_SKEW_MS = 60 * 1_000;
const DATABASE_IDENTITY_SINGLETON = Symbol.for(
  "programmable.read-model-health.promoted-database-identity.v1",
);

type IdentityRegistry = {
  [DATABASE_IDENTITY_SINGLETON]?: Readonly<{
    key: string;
    promise: Promise<DatabasePhysicalIdentity>;
  }>;
};

function identityRegistry(): IdentityRegistry {
  return globalThis as typeof globalThis & IdentityRegistry;
}

const DEFAULT_DEPENDENCIES: IndexedReadModelHealthDependencies = Object.freeze({
  getServerReadModel,
  loadProjectorRuntimeConfig,
  createPostgresExecutor,
  assertCandidateDatabasePromotedState,
  readExactRouteSnapshotReadiness,
  nowMs: Date.now,
});

function fail(): never {
  throw new Error("Indexed read-model health is unavailable");
}

function canonicalInteger(value: unknown): string {
  if (typeof value === "bigint") {
    if (value < 0n) return fail();
    return value.toString();
  }
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return fail();
  }
  return value;
}

function bytes32(value: unknown): string {
  if (value instanceof Uint8Array && value.byteLength === 32) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  if (typeof value === "string" && /^(?:0x|\\x)[0-9a-fA-F]{64}$/u.test(value)) {
    return value.slice(2).toLowerCase();
  }
  return fail();
}

function timestampMs(value: unknown): number {
  const parsed = value instanceof Date ? value.valueOf() :
    typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fail();
  return parsed;
}

function nullableTimestampMs(value: unknown): number | null {
  return value === null || value === undefined ? null : timestampMs(value);
}

function validatePhysicalIdentity(value: unknown): DatabasePhysicalIdentity {
  if (typeof value !== "object" || value === null) return fail();
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.databaseName !== "string" ||
    !/^[a-z][a-z0-9_]{0,62}$/u.test(candidate.databaseName) ||
    typeof candidate.systemIdentifier !== "string" ||
    !/^[1-9]\d{0,19}$/u.test(candidate.systemIdentifier) ||
    BigInt(candidate.systemIdentifier) > 18_446_744_073_709_551_615n
  ) {
    return fail();
  }
  return Object.freeze({
    databaseName: candidate.databaseName,
    systemIdentifier: candidate.systemIdentifier,
  });
}

function physicalIdentityFromRows(
  rows: readonly Record<string, unknown>[],
): DatabasePhysicalIdentity {
  if (rows.length !== 1) return fail();
  return validatePhysicalIdentity({
    databaseName: rows[0]?.database_name,
    systemIdentifier: rows[0]?.system_identifier,
  });
}

function indexedActivationState(env: Environment): "indexed" | "legacy" {
  const values = INDEXED_ROUTE_FLAG_NAMES.map((name) => env[name]);
  const shadow = env.INDEXED_READ_SHADOW_COMPARE_ENABLED;
  const shadowOff = shadow === undefined || shadow === "" || shadow === "false";
  const shadowOn = shadow === "true";
  if (!shadowOff && !shadowOn) return fail();
  const routeOff = (value: string | undefined) =>
    value === undefined || value === "" || value === "false";
  if (values.some((value) => !routeOff(value) && value !== "true")) return fail();
  if (shadowOff && values.every(routeOff)) return "legacy";
  return "indexed";
}

function promotionCacheKey(
  binding: CandidateDatabasePromotionBinding,
  connectionString: string,
): string {
  const target = validatedPostgresConnectionTarget(connectionString);
  const url = new URL(target.connectionString);
  return JSON.stringify([
    target.hostname,
    target.port,
    url.pathname,
    decodeURIComponent(url.username),
    binding.providerDeploymentId,
    binding.deploymentCommitment,
    binding.schemaCommitment,
    binding.initializationInputCommitment,
    binding.initializedAt,
    binding.productCommit,
    binding.stagedDeploymentId,
  ]);
}

async function readPromotedDatabaseIdentity(input: Readonly<{
  binding: CandidateDatabasePromotionBinding;
  connectionString: string;
  sslCaPem: string;
  dependencies: IndexedReadModelHealthDependencies;
}>): Promise<DatabasePhysicalIdentity> {
  const key = promotionCacheKey(input.binding, input.connectionString);
  const registry = identityRegistry();
  const existing = registry[DATABASE_IDENTITY_SINGLETON];
  if (existing?.key === key) return existing.promise;

  const target = validatedPostgresConnectionTarget(input.connectionString);
  const executor: PostgresExecutor = input.dependencies.createPostgresExecutor({
    connectionString: input.connectionString,
    sslCaPem: input.sslCaPem,
    allowInsecureLoopback: target.isLoopback,
    maxConnections: 1,
    connectTimeoutMs: 2_000,
    idleTimeoutMs: 15_000,
  });
  const promise = input.dependencies.assertCandidateDatabasePromotedState({
    executor,
    binding: input.binding,
  }).then(validatePhysicalIdentity).finally(() => executor.close());
  registry[DATABASE_IDENTITY_SINGLETON] = Object.freeze({ key, promise });
  try {
    return await promise;
  } finally {
    if (registry[DATABASE_IDENTITY_SINGLETON]?.promise === promise) {
      delete registry[DATABASE_IDENTITY_SINGLETON];
    }
  }
}

function exactRouteScopes(
  releaseScopes: ReturnType<typeof loadProjectorRuntimeConfig>["releaseScopes"],
): readonly Readonly<{
  route: IndexedRouteKey;
  scopes: readonly ReviewedRouteScope[];
}>[] {
  const reviewed = ALL_REVIEWED_ROUTE_SCOPES.filter((scope) =>
    releaseScopes.some(
      (release) =>
        release.releaseId === scope.releaseVersion &&
        release.modelId === scope.model,
    ),
  );
  if (reviewed.length !== releaseScopes.length) return fail();
  return INDEXED_ROUTE_KEYS.map((route) => {
    const scopes = reviewed.filter((scope) =>
      reconcilerRouteKeysForScope(
        scope.releaseVersion,
        scope.model,
      ).includes(route),
    );
    if (scopes.length === 0) return fail();
    return Object.freeze({ route, scopes: Object.freeze(scopes) });
  });
}

function checkpointHealth(input: Readonly<{
  rows: readonly CheckpointHealthRow[];
  releaseScopes: ReturnType<typeof loadProjectorRuntimeConfig>["releaseScopes"];
  nowMs: number;
}>): Readonly<{ ageSeconds: number; blockNumber: string }> {
  const matched = input.releaseScopes.map((scope) => {
    const rows = input.rows.filter(
      (row) =>
        canonicalInteger(row.chain_id) === "1" &&
        row.release_id === scope.releaseId &&
        row.model_id === scope.modelId &&
        row.source_group === scope.sourceGroup,
    );
    if (rows.length !== 1) return fail();
    const blockNumber = canonicalInteger(rows[0]!.block_number);
    const createdAtMs = timestampMs(rows[0]!.created_at);
    if (
      BigInt(blockNumber) < 1n ||
      createdAtMs > input.nowMs + MAXIMUM_CLOCK_SKEW_MS ||
      input.nowMs - createdAtMs > MAXIMUM_CHECKPOINT_AGE_MS
    ) {
      return fail();
    }
    return Object.freeze({ blockNumber, createdAtMs });
  });
  const minimumBlock = matched.reduce(
    (minimum, row) =>
      BigInt(row.blockNumber) < BigInt(minimum) ? row.blockNumber : minimum,
    matched[0]!.blockNumber,
  );
  const oldestCreatedAt = Math.min(...matched.map((row) => row.createdAtMs));
  return Object.freeze({
    ageSeconds: Math.max(0, Math.floor((input.nowMs - oldestCreatedAt) / 1_000)),
    blockNumber: minimumBlock,
  });
}

async function readApiDatabaseHealth(input: Readonly<{
  readModel: ServerReadModel;
  releaseScopes: ReturnType<typeof loadProjectorRuntimeConfig>["releaseScopes"];
  nowMs: number;
  dependencies: IndexedReadModelHealthDependencies;
}>): Promise<Readonly<{
  identity: DatabasePhysicalIdentity;
  index: IndexedHealthResult["index"];
}>> {
  const routeScopes = exactRouteScopes(input.releaseScopes);
  return input.readModel.repeatableReadSnapshot(async (transaction) => {
    const [
      identityRows,
      checkpointRows,
      circuitRows,
      corpusRows,
      marketRows,
      ...readiness
    ] = await Promise.all([
      transaction.query<Record<string, unknown>>(
        `select
           pg_catalog.current_database()::text as database_name,
           ((pg_catalog.pg_control_system()).system_identifier)::text
             as system_identifier`,
      ),
      transaction.query<CheckpointHealthRow>(
        `select chain_id, release_id, model_id, source_group,
                block_number, created_at
         from programmable_private.checkpoint_summary_v1
         order by chain_id, release_id, model_id, source_group`,
      ),
      transaction.query<Record<string, unknown>>(
        `select dependency, circuit_status
         from programmable_private.health_summary_v1
         order by dependency`,
      ),
      transaction.query<Record<string, unknown>>(
        `select release_id, model_id, source_group,
                '0x' || pg_catalog.encode(pool_id, 'hex') as pool_id
         from programmable_private.launch_by_token_v2
         where chain_id = $1
         order by release_id, model_id, source_group, pool_id`,
        ["1"],
      ),
      transaction.query<Record<string, unknown>>(
        `select *
         from programmable_private.market_projector_health_v1
         where chain_id = $1
         order by release_id, model_id, source_group, pool_id`,
        ["1"],
      ),
      ...routeScopes.map(({ route, scopes }) =>
        input.dependencies.readExactRouteSnapshotReadiness({
          transaction,
          route,
          chainId: 1,
          scope: scopes,
        }),
      ),
    ]);

    if (
      circuitRows.some((row) => row.circuit_status !== "closed") ||
      readiness.length !== routeScopes.length ||
      readiness.some((snapshot, index) =>
        snapshot.readiness.length !== routeScopes[index]!.scopes.length ||
        snapshot.readiness.some(
          (member) =>
            member.eligibility !== "eligible" ||
            member.parity !== "current" ||
            member.version === undefined,
        ),
      )
    ) {
      return fail();
    }
    if (corpusRows.length < 1 || corpusRows.length > 1_000_000) return fail();
    const expectedMarkets = new Set(
      corpusRows.map(marketScopeKey),
    );
    if (expectedMarkets.size !== corpusRows.length) return fail();
    validateMarketHealth({
      rows: marketRows,
      expectedMarkets,
      releaseScopes: input.releaseScopes,
      nowMs: input.nowMs,
    });
    const checkpoint = checkpointHealth({
      rows: checkpointRows,
      releaseScopes: input.releaseScopes,
      nowMs: input.nowMs,
    });
    return Object.freeze({
      identity: physicalIdentityFromRows(identityRows),
      index: Object.freeze({
        ...checkpoint,
        tokenCount: corpusRows.length,
      }),
    });
  });
}

function marketScopeKey(row: Record<string, unknown>): string {
  if (
    typeof row.release_id !== "string" ||
    typeof row.model_id !== "string" ||
    typeof row.source_group !== "string"
  ) return fail();
  return JSON.stringify([
    row.release_id,
    row.model_id,
    row.source_group,
    bytes32(row.pool_id),
  ]);
}

function validateMarketHealth(input: Readonly<{
  rows: readonly Record<string, unknown>[];
  expectedMarkets: ReadonlySet<string>;
  releaseScopes: ReturnType<typeof loadProjectorRuntimeConfig>["releaseScopes"];
  nowMs: number;
}>): void {
  if (input.rows.length !== input.expectedMarkets.size) return fail();
  const markets = new Set<string>();
  for (const row of input.rows) {
    if (canonicalInteger(row.chain_id) !== "1") return fail();
    const release = input.releaseScopes.find(
      (scope) =>
        scope.releaseId === row.release_id &&
        scope.modelId === row.model_id &&
        scope.sourceGroup === row.source_group,
    );
    if (!release) return fail();
    const market = marketScopeKey(row);
    if (!input.expectedMarkets.has(market) || markets.has(market)) return fail();
    markets.add(market);
    if (
      typeof row.market_projector_version !== "string" ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(row.market_projector_version) ||
      typeof row.source_projector_version !== "string" ||
      !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(row.source_projector_version) ||
      row.cursor_epoch_id !== row.source_checkpoint_epoch_id ||
      canonicalInteger(row.cursor_pointer_generation) !==
        canonicalInteger(row.source_checkpoint_pointer_generation) ||
      BigInt(canonicalInteger(row.cursor_block_number)) >
        BigInt(canonicalInteger(row.source_checkpoint_block_number)) ||
      BigInt(canonicalInteger(row.cursor_source_reorg_generation)) <
        BigInt(canonicalInteger(row.source_checkpoint_reorg_generation)) ||
      canonicalInteger(row.source_checkpoint_cursor_block_global_log_index) !==
        "4294967295" ||
      row.source_checkpoint_cursor_candidate_id !== "empty-page" ||
      BigInt(canonicalInteger(row.cursor_generation)) < 1n ||
      BigInt(canonicalInteger(row.source_checkpoint_generation)) < 1n
    ) {
      return fail();
    }
    canonicalInteger(row.cursor_reorg_generation);
    canonicalInteger(row.source_checkpoint_reorg_generation);

    const cursorAdvancedAt = timestampMs(row.cursor_advanced_at);
    const sourceCreatedAt = timestampMs(row.source_checkpoint_created_at);
    if (
      cursorAdvancedAt > input.nowMs + MAXIMUM_CLOCK_SKEW_MS ||
      sourceCreatedAt > input.nowMs + MAXIMUM_CLOCK_SKEW_MS ||
      input.nowMs - sourceCreatedAt > MAXIMUM_CHECKPOINT_AGE_MS
    ) {
      return fail();
    }
    if (
      BigInt(canonicalInteger(row.latest_snapshot_block_number)) < 1n ||
      BigInt(canonicalInteger(row.latest_snapshot_block_number)) >
        BigInt(canonicalInteger(row.cursor_block_number))
    ) {
      return fail();
    }
    const hourCoverageEnd = nullableTimestampMs(row.hour_coverage_end);
    const dayCoverageEnd = nullableTimestampMs(row.day_coverage_end);
    const latestSnapshotObservedAt = timestampMs(row.latest_snapshot_observed_at);
    const latestSnapshotAttachedAt = timestampMs(row.latest_snapshot_attached_at);
    const latestSnapshotReconciledAt = timestampMs(
      row.latest_snapshot_reconciled_at,
    );
    if (
      (hourCoverageEnd !== null &&
        hourCoverageEnd > input.nowMs + MAXIMUM_CLOCK_SKEW_MS) ||
      (dayCoverageEnd !== null &&
        dayCoverageEnd > input.nowMs + 24 * 60 * 60 * 1_000) ||
      latestSnapshotObservedAt > input.nowMs + MAXIMUM_CLOCK_SKEW_MS ||
      latestSnapshotAttachedAt > input.nowMs + MAXIMUM_CLOCK_SKEW_MS ||
      latestSnapshotReconciledAt > input.nowMs + MAXIMUM_CLOCK_SKEW_MS
    ) {
      return fail();
    }
  }
  if (markets.size !== input.expectedMarkets.size) return fail();
}

/**
 * Returns null without parsing unrelated data-pipeline configuration only for
 * the exact legacy-off activation state. Indexed mode proves one promoted
 * physical database, current route parity, source checkpoints and market data.
 */
export async function readIndexedReadModelHealth(
  env: Environment = process.env,
  dependencies: IndexedReadModelHealthDependencies = DEFAULT_DEPENDENCIES,
): Promise<IndexedHealthResult | null> {
  if (indexedActivationState(env) === "legacy") return null;
  const nowMs = dependencies.nowMs();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) return fail();

  const runtimeConfig = dependencies.loadProjectorRuntimeConfig(env);
  if (
    runtimeConfig.binding.mode !== "release" ||
    runtimeConfig.binding.promotedDatabase === null
  ) {
    return fail();
  }
  const readModel = await dependencies.getServerReadModel({ required: true });
  if (!readModel) return fail();

  const [projectorIdentity, apiHealth] = await Promise.all([
    readPromotedDatabaseIdentity({
      binding: runtimeConfig.binding.promotedDatabase,
      connectionString: runtimeConfig.database.projectorConnectionString,
      sslCaPem: runtimeConfig.database.sslCaPem,
      dependencies,
    }),
    readApiDatabaseHealth({
      readModel,
      releaseScopes: runtimeConfig.releaseScopes,
      nowMs,
      dependencies,
    }),
  ]);
  if (
    projectorIdentity.databaseName !== apiHealth.identity.databaseName ||
    projectorIdentity.systemIdentifier !== apiHealth.identity.systemIdentifier
  ) {
    return fail();
  }
  return Object.freeze({ chainId: 1 as const, index: apiHealth.index });
}

/** Test isolation only; production promotion verification is deduped in-flight. */
export function resetReadModelHealthForTests(): void {
  if (process.env.NODE_ENV !== "test") return fail();
  delete identityRegistry()[DATABASE_IDENTITY_SINGLETON];
}
