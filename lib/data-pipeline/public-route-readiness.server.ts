import "server-only";

import { after } from "next/server";

import {
  ALL_REVIEWED_ROUTE_SCOPES,
  authorizeRouteReleaseProbe,
  coordinateRouteRead,
  validatedRecordScopeEvidence,
  type CoordinatedRouteRead,
  type IndexedRouteResult,
  type IndexedProjectionVersion,
  type IndexedRouteKey,
  type IndexedRouteSnapshot,
  type ReviewedRouteScope,
  type RouteCheckpoint,
  type RouteComparisonSchema,
  type RouteReadiness,
} from "./route-coordinator.server";
import type { PostgresTransaction } from "./postgres";
import {
  createPostgresPublicRouteSnapshotAdapters,
  type AdaptedIndexedRouteSnapshotV2,
} from "./postgres-read-model.server";
import { postgresPublicRouteQueries } from "./public-route-queries.server";
import type {
  IndexedRowSourceV2,
  IndexedSnapshotIdentityV2,
} from "./route-adapters.server";

const SHADOW_PROBE_QUERY_PARAMETER = "__read_model_probe";
const SHADOW_PROBE_NONCE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Removes the cache-busting nonce only after the secret request headers have
 * been converted into the coordinator's unforgeable capability. Invalid,
 * duplicated and unauthenticated values remain visible to normal route query
 * validation.
 */
export function publicRouteSearchParams(
  search: URLSearchParams,
  headers: Headers,
): URLSearchParams {
  const canonical = new URLSearchParams(search);
  const nonces = canonical.getAll(SHADOW_PROBE_QUERY_PARAMETER);
  if (
    nonces.length === 1 &&
    SHADOW_PROBE_NONCE.test(nonces[0]!) &&
    authorizeRouteReleaseProbe(headers)
  ) {
    canonical.delete(SHADOW_PROBE_QUERY_PARAMETER);
  }
  return canonical;
}

export const PUBLIC_INDEXED_ROUTE_READS =
  createPostgresPublicRouteSnapshotAdapters({
    queries: postgresPublicRouteQueries,
  });

export const CLASSIC_V3_ROUTE_SCOPE = Object.freeze([
  Object.freeze({ model: "classic", releaseVersion: "classic-v3" }),
]) satisfies readonly ReviewedRouteScope[];

export const STOCK_PAIRED_ROUTE_SCOPES = Object.freeze(
  ALL_REVIEWED_ROUTE_SCOPES.filter(
    (scope) => scope.model === "stock-paired",
  ),
);

export const PUBLIC_DISCOVERY_ROUTE_SCOPES = ALL_REVIEWED_ROUTE_SCOPES;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._+:/-]{0,127}$/;

type ReadinessRow = Record<string, unknown>;

function text(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`Invalid route readiness ${field}`);
  }
  return value;
}

function uuid(value: unknown, field: string): string {
  const parsed = text(value, field).toLowerCase();
  if (!UUID.test(parsed)) throw new Error(`Invalid route readiness ${field}`);
  return parsed;
}

function nullableUuid(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : uuid(value, "uuid");
}

function integer(value: unknown, field: string): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw new Error(`Invalid route readiness ${field}`);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid route readiness ${field}`);
    }
    return String(value);
  }
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/.test(value) ||
    value.length > 78
  ) {
    throw new Error(`Invalid route readiness ${field}`);
  }
  return value;
}

function nullableInteger(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : integer(value, "integer");
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Invalid route readiness ${field}`);
  }
  return value;
}

function nullableBoolean(value: unknown): boolean | null {
  return value === null || value === undefined
    ? null
    : boolean(value, "boolean");
}

function bytes32(value: unknown, field: string): `0x${string}` {
  if (value instanceof Uint8Array) {
    if (value.byteLength !== 32) {
      throw new Error(`Invalid route readiness ${field}`);
    }
    return `0x${Array.from(value, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")}`;
  }
  if (typeof value === "string") {
    if (/^\\x[0-9a-fA-F]{64}$/.test(value)) {
      return `0x${value.slice(2).toLowerCase()}`;
    }
    if (/^0x[0-9a-fA-F]{64}$/.test(value)) {
      return value.toLowerCase() as `0x${string}`;
    }
  }
  throw new Error(`Invalid route readiness ${field}`);
}

function nullableBytes32(value: unknown): `0x${string}` | null {
  return value === null || value === undefined
    ? null
    : bytes32(value, "bytes32");
}

function releaseModel(scope: ReviewedRouteScope): string {
  return scope.model;
}

function scopeKey(scope: ReviewedRouteScope): string {
  return `${scope.model}:${scope.releaseVersion}`;
}

function exactProjectionVersion(row: ReadinessRow): IndexedProjectionVersion {
  const projectorVersion = text(row.projector_version, "projector version");
  const sourceGroup = text(row.source_group, "source group");
  if (!IDENTIFIER.test(projectorVersion) || !IDENTIFIER.test(sourceGroup)) {
    throw new Error("Invalid route readiness identifiers");
  }
  const pointerGeneration = integer(
    row.pointer_generation,
    "pointer generation",
  );
  const checkpointGeneration = integer(
    row.checkpoint_generation,
    "checkpoint generation",
  );
  if (pointerGeneration === "0" || checkpointGeneration === "0") {
    throw new Error("Invalid route readiness generation");
  }
  const blockNumber = integer(
    row.checkpoint_block_number,
    "checkpoint block number",
  );
  const safeBlockNumber = integer(row.safe_block_number, "safe block number");
  const confirmations = integer(
    row.checkpoint_confirmations,
    "checkpoint confirmations",
  );
  if (
    BigInt(safeBlockNumber) < BigInt(blockNumber) ||
    BigInt(confirmations) > 1_024n
  ) {
    throw new Error("Invalid route readiness safe checkpoint");
  }
  return Object.freeze({
    checkpointId: uuid(row.checkpoint_id, "checkpoint id"),
    sourceGroup,
    projectorVersion,
    epochId: uuid(row.epoch_id, "epoch id"),
    pointerGeneration,
    checkpointGeneration,
    reorgGeneration: integer(row.reorg_generation, "reorg generation"),
    blockNumber,
    blockHash: bytes32(row.checkpoint_block_hash, "checkpoint block hash"),
  });
}

function exactParityStatus(
  row: ReadinessRow,
  version: IndexedProjectionVersion,
): "current" | "pending" | "stale" | "mismatch" | "missing" {
  const parityRecordId = nullableUuid(row.parity_record_id);
  const parityStatus = text(row.parity_status, "parity status").toLowerCase();
  if (
    !["current", "pending", "stale", "mismatch", "missing"].includes(
      parityStatus,
    )
  ) {
    throw new Error("Invalid route readiness parity status");
  }
  const parityIsMatch = nullableBoolean(row.parity_is_match);
  const mismatchCount = nullableInteger(row.reconciliation_mismatch_count);

  if (parityStatus === "missing") {
    if (parityRecordId !== null) {
      throw new Error("Invalid missing route parity record");
    }
    return "missing";
  }
  if (!parityRecordId) {
    throw new Error("Invalid route parity record");
  }
  if (
    parityIsMatch === false ||
    (mismatchCount !== null && mismatchCount !== "0") ||
    parityStatus === "mismatch"
  ) {
    return "mismatch";
  }
  if (parityStatus === "pending") {
    return "pending";
  }
  if (parityStatus === "stale") return "stale";

  const parityCheckpointId = nullableUuid(row.parity_checkpoint_id);
  const parityCheckpointGeneration = nullableInteger(
    row.parity_checkpoint_generation,
  );
  const parityReorgGeneration = nullableInteger(row.parity_reorg_generation);
  const parityBlockNumber = nullableInteger(row.parity_block_number);
  const parityBlockHash = nullableBytes32(row.parity_block_hash);
  const parityBindingId = nullableUuid(row.parity_binding_id);
  const parityBindingCommitment = nullableBytes32(
    row.parity_binding_commitment,
  );
  const parityEvidenceCommitment = nullableBytes32(
    row.parity_evidence_commitment,
  );
  const reconciliationId = nullableUuid(row.reconciliation_id);
  const sourceFromBlock = nullableInteger(row.parity_source_from_block);
  const sourceToBlock = nullableInteger(row.parity_source_to_block);
  const sourceContainsCheckpoint =
    sourceFromBlock !== null &&
    sourceToBlock !== null &&
    BigInt(sourceFromBlock) <= BigInt(version.blockNumber) &&
    BigInt(sourceToBlock) >= BigInt(version.blockNumber);

  if (
    parityIsMatch === true &&
    mismatchCount === "0" &&
    parityCheckpointId === version.checkpointId &&
    parityCheckpointGeneration === version.checkpointGeneration &&
    parityReorgGeneration === version.reorgGeneration &&
    parityBlockNumber === version.blockNumber &&
    parityBlockHash === version.blockHash &&
    parityBindingId !== null &&
    parityBindingCommitment !== null &&
    parityEvidenceCommitment !== null &&
    reconciliationId !== null &&
    sourceContainsCheckpoint &&
    parityStatus === "current"
  ) {
    return "current";
  }
  return "stale";
}

function readinessMember(
  scope: ReviewedRouteScope,
  row: ReadinessRow | undefined,
): RouteReadiness[number] {
  if (!row) {
    return Object.freeze({
      ...scope,
      eligibility: "ineligible" as const,
      parity: "missing" as const,
    });
  }
  if (
    row.release_id !== scope.releaseVersion ||
    row.model_id !== releaseModel(scope)
  ) {
    throw new Error("Route readiness scope does not match");
  }
  const eligible =
    row.route_status === "eligible" &&
    row.eligibility_status === "eligible" &&
    row.route_mode === "indexed";
  if (!eligible) {
    return Object.freeze({
      ...scope,
      eligibility: "ineligible" as const,
      parity: "missing" as const,
    });
  }
  const version = exactProjectionVersion(row);
  const parity = exactParityStatus(row, version);
  return Object.freeze({
    ...scope,
    eligibility: "eligible" as const,
    parity,
    ...(parity === "current" ? { version } : {}),
  });
}

/** Reads immutable activation evidence for the exact requested route scope. */
export async function readExactRouteSnapshotReadiness(input: {
  transaction: PostgresTransaction;
  route: IndexedRouteKey;
  chainId: 1;
  scope: readonly ReviewedRouteScope[];
}): Promise<IndexedRouteSnapshot> {
  const releases = input.scope.map((scope) => scope.releaseVersion);
  const models = input.scope.map((scope) => scope.model);
  const rows = await input.transaction.query<ReadinessRow>(
    `select
       route_key, chain_id, release_id, model_id, source_group,
       route_status, eligibility_status, route_mode,
       projector_version, epoch_id, pointer_generation,
       checkpoint_id, checkpoint_generation, reorg_generation,
       checkpoint_block_number, checkpoint_block_hash,
       safe_block_number, checkpoint_confirmations,
       parity_status, parity_record_id, reconciliation_id, parity_is_match,
       parity_source_from_block, parity_source_to_block,
       parity_evidence_commitment, reconciliation_mismatch_count,
       parity_checkpoint_id, parity_checkpoint_generation,
       parity_reorg_generation, parity_block_number, parity_block_hash,
       parity_binding_id, parity_binding_commitment
     from programmable_private.route_snapshot_readiness_v1
     where route_key = $1
       and chain_id = $2
       and release_id = any($3::text[])
       and model_id = any($4::text[])
     order by release_id, model_id, source_group`,
    [input.route, input.chainId, releases, models],
  );

  const selected = new Map<string, ReadinessRow>();
  for (const row of rows) {
    if (row.route_key !== input.route || integer(row.chain_id, "chain") !== "1") {
      throw new Error("Route readiness identity does not match");
    }
    const key = `${text(row.model_id, "model")}:${text(
      row.release_id,
      "release",
    )}`;
    if (!input.scope.some((scope) => scopeKey(scope) === key)) {
      throw new Error("Unsupported route readiness release");
    }
    if (selected.has(key)) {
      // More than one current source group is ambiguous and cannot be served.
      throw new Error("Ambiguous route readiness source group");
    }
    selected.set(key, row);
  }

  const readiness = Object.freeze(
    input.scope.map((scope) =>
      readinessMember(scope, selected.get(scopeKey(scope))),
    ),
  );
  return Object.freeze({ readiness });
}

type PublicAdaptedSnapshot = AdaptedIndexedRouteSnapshotV2<unknown>;

function sameScope(
  left: ReviewedRouteScope,
  right: ReviewedRouteScope,
) {
  return (
    left.model === right.model &&
    left.releaseVersion === right.releaseVersion
  );
}

function sourceScope(source: IndexedRowSourceV2): ReviewedRouteScope {
  if (
    (source.modelVersion !== "classic" &&
      source.modelVersion !== "stock-paired") ||
    ![
      "classic-v2",
      "classic-v3",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ].includes(source.releaseVersion)
  ) {
    throw new Error("Invalid indexed record scope");
  }
  return Object.freeze({
    model: source.modelVersion,
    releaseVersion: source.releaseVersion,
  });
}

function exactPointerVersion(
  snapshot: IndexedSnapshotIdentityV2,
  scope: ReviewedRouteScope,
) {
  const candidates = snapshot.releasePointers.filter(
    (pointer) =>
      pointer.modelVersion === scope.model &&
      pointer.releaseVersion === scope.releaseVersion,
  );
  if (candidates.length !== 1) {
    throw new Error("Indexed snapshot scope is incomplete");
  }
  const pointer = candidates[0]!;
  return Object.freeze({
    checkpointId: pointer.checkpointId,
    sourceGroup: pointer.sourceGroup,
    projectorVersion: pointer.projectorVersion,
    epochId: pointer.epochId,
    pointerGeneration: pointer.pointerGeneration,
    checkpointGeneration: pointer.checkpointGeneration,
    reorgGeneration: pointer.reorgGeneration,
    blockNumber: pointer.checkpointBlockNumber,
    blockHash: pointer.checkpointBlockHash,
  });
}

function sameVersion(
  left: IndexedProjectionVersion,
  right: IndexedProjectionVersion,
) {
  return (
    left.checkpointId === right.checkpointId &&
    left.sourceGroup === right.sourceGroup &&
    left.projectorVersion === right.projectorVersion &&
    left.epochId === right.epochId &&
    left.pointerGeneration === right.pointerGeneration &&
    left.checkpointGeneration === right.checkpointGeneration &&
    left.reorgGeneration === right.reorgGeneration &&
    left.blockNumber === right.blockNumber &&
    left.blockHash.toLowerCase() === right.blockHash.toLowerCase()
  );
}

function indexedResult(
  adapted: Extract<PublicAdaptedSnapshot, { status: "ready" }>,
  route: IndexedRouteKey,
  scope: readonly ReviewedRouteScope[],
  readiness: RouteReadiness,
): IndexedRouteResult {
  if (adapted.routeKey !== route) {
    throw new Error("Indexed adapter route does not match");
  }
  if (
    adapted.snapshot.releasePointers.length !== scope.length ||
    scope.some(
      (expected) =>
        !adapted.snapshot.releasePointers.some(
          (pointer) =>
            pointer.modelVersion === expected.model &&
            pointer.releaseVersion === expected.releaseVersion,
        ),
    )
  ) {
    throw new Error("Indexed adapter scope does not match");
  }
  const versions = Object.freeze(
    scope.map((member) => {
      const pointerVersion = exactPointerVersion(adapted.snapshot, member);
      const readyMember = readiness.find((candidate) =>
        sameScope(candidate, member),
      );
      if (
        !readyMember ||
        readyMember.eligibility !== "eligible" ||
        readyMember.parity !== "current" ||
        !readyMember.version ||
        !sameVersion(pointerVersion, readyMember.version)
      ) {
        throw new Error("Indexed payload checkpoint does not match readiness");
      }
      return Object.freeze({
        ...member,
        version: pointerVersion,
      });
    }),
  );
  const scopeEvidence = validatedRecordScopeEvidence(
    adapted.recordSources,
    (source) => sourceScope(source),
  );
  const headers = new Headers(adapted.response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return Object.freeze({
    source: "indexed" as const,
    scope,
    scopeEvidence,
    versions,
    comparisonCheckpoint: Object.freeze({
      blockNumber: adapted.snapshot.blockNumber,
      blockHash: adapted.snapshot.blockHash,
    }),
    response: new Response(JSON.stringify(adapted.response.body), {
      status: adapted.response.status,
      headers,
    }),
  });
}

export async function readExactPublicRouteSnapshot(input: {
  transaction: PostgresTransaction;
  route: IndexedRouteKey;
  scope: readonly ReviewedRouteScope[];
  indexed: (transaction: PostgresTransaction) => Promise<PublicAdaptedSnapshot>;
}): Promise<IndexedRouteSnapshot> {
  const readinessSnapshot = await readExactRouteSnapshotReadiness({
    transaction: input.transaction,
    route: input.route,
    chainId: 1,
    scope: input.scope,
  });
  if (
    readinessSnapshot.readiness.some(
      (member) =>
        member.eligibility !== "eligible" ||
        member.parity !== "current" ||
        !member.version,
    )
  ) {
    return readinessSnapshot;
  }
  const adapted = await input.indexed(input.transaction);
  if (adapted.status !== "ready") return readinessSnapshot;
  return Object.freeze({
    readiness: readinessSnapshot.readiness,
    indexed: indexedResult(
      adapted,
      input.route,
      input.scope,
      readinessSnapshot.readiness,
    ),
  });
}

export type PublicRouteReadInput = Readonly<{
  route: IndexedRouteKey;
  scope: readonly ReviewedRouteScope[];
  requestHeaders?: Headers;
  legacy: CoordinatedRouteRead["legacy"];
  indexed: (
    transaction: PostgresTransaction,
  ) => Promise<PublicAdaptedSnapshot>;
  comparisonSchema?: RouteComparisonSchema;
}>;

export function publicSnapshotCheckpoint(
  value: RouteCheckpoint | null | undefined,
): RouteCheckpoint | undefined {
  return value
    ? Object.freeze({
        blockNumber: value.blockNumber,
        blockHash: value.blockHash,
      })
    : undefined;
}

/**
 * Central route wiring. Readiness and the route payload are read in one
 * repeatable-read transaction. Route flags stay off until parity, load and
 * production lifecycle evidence pass the release gate.
 */
export async function coordinatePublicRouteRead(
  input: PublicRouteReadInput,
): Promise<Response> {
  const releaseProbe = input.requestHeaders
    ? authorizeRouteReleaseProbe(input.requestHeaders)
    : null;
  return coordinateRouteRead({
    route: input.route,
    scope: input.scope,
    ...(releaseProbe ? { releaseProbe } : {}),
    legacy: input.legacy,
    indexedSnapshot: (transaction) =>
      readExactPublicRouteSnapshot({
        transaction,
        route: input.route,
        scope: input.scope,
        indexed: input.indexed,
      }),
    ...(input.comparisonSchema
      ? { comparisonSchema: input.comparisonSchema }
      : {}),
    scheduleShadowComparison(task) {
      after(task);
    },
  });
}
