import "server-only";

import { canonicalizeJson, parseStrictJson, type JsonValue } from
  "../projection-target/canonical-json";
import type { ProjectionTargetPostgresPoolV1 } from
  "../projection-target/postgres-store";
import type { Sha256Digest } from "../projection-target/hashing";
import {
  parseGenericLaunchRecordV2,
  type GenericLaunchRecordV2,
} from "./generic-launch-contract-v2";
import type { GenericLaunchReadSignerV2 } from
  "./generic-launch-read-signer-v2";
import type {
  GenericLaunchReadModelContractV2,
  GenericLaunchReadStoreV2,
} from "./generic-launch-read-v2";
import type { GenericLaunchMaterializationStoreV2 } from
  "./generic-launch-projector-v2";

const HASH32 = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]{0,77})$/u;
const MAXIMUM_CANONICAL_RECORD_BYTES = 2_097_152;

interface ApprovalRow extends Record<string, unknown> {
  canonical_readback: unknown;
}

interface LifecycleRow extends Record<string, unknown> {
  lifecycle_generation: unknown;
  lifecycle_evidence_hash: unknown;
  lifecycle_state: unknown;
  record_hash: unknown;
}

interface ApprovalIdRow extends Record<string, unknown> {
  approval_id: unknown;
}

interface ReadRow extends Record<string, unknown> {
  canonical_record: unknown;
  finalization_block: unknown;
  record_hash: unknown;
}

interface StoragePostureRow extends Record<string, unknown> {
  relrowsecurity: unknown;
  relforcerowsecurity: unknown;
  policies: unknown;
  privileges: unknown;
}

export function createPostgresGenericLaunchMaterializationStoreV2(
  pool: ProjectionTargetPostgresPoolV1,
): GenericLaunchMaterializationStoreV2 {
  return Object.freeze({
    async getApprovalAuthorization(
      input: Parameters<GenericLaunchMaterializationStoreV2["getApprovalAuthorization"]>[0],
    ) {
      input.signal.throwIfAborted();
      const approvalId = hash32(input.approvalId, "Approval ID");
      const result = await pool.query<ApprovalRow>(`
        SELECT canonical_readback
          FROM programmable_website_projection_v1.projection_records
         WHERE lane = 'website.approval-v3'
           AND projection_key = $1
         LIMIT 1
      `, [`approval:${approvalId}`]);
      input.signal.throwIfAborted();
      const row = result.rows[0];
      if (row === undefined) return null;
      const readback = canonicalObject(
        row.canonical_readback,
        "stored Approval readback",
      );
      if (readback.schemaVersion
        !== "programmable.approval-v3-artifact-projection-readback.v1"
        || readback.approvalId !== approvalId) {
        throw new TypeError("stored Approval readback identity is invalid");
      }
      return readback.authorization ?? null;
    },

    async getLatestLifecycle(
      input: Parameters<GenericLaunchMaterializationStoreV2["getLatestLifecycle"]>[0],
    ) {
      input.signal.throwIfAborted();
      const result = await pool.query<LifecycleRow>(`
        SELECT lifecycle_generation::text, lifecycle_evidence_hash,
               lifecycle_state, record_hash
          FROM programmable_website_projection_v1.generic_launch_materializations_v2
         WHERE launch_id = $1
         ORDER BY lifecycle_generation DESC
         LIMIT 1
      `, [hash32(input.launchId, "launch ID")]);
      input.signal.throwIfAborted();
      return result.rows[0] === undefined ? null : lifecycleRow(result.rows[0]);
    },
    async putIfNewLifecycle(
      input: Parameters<GenericLaunchMaterializationStoreV2["putIfNewLifecycle"]>[0],
    ) {
      input.signal.throwIfAborted();
      const approvalId = hash32(input.approvalId, "Approval ID");
      const launchId = hash32(input.launchId, "launch ID");
      const descriptorHash = hash32(input.descriptorHash, "descriptor hash");
      const lifecycleEvidenceHash = digest(
        input.lifecycleEvidenceHash,
        "lifecycle evidence",
      );
      const record = input.record === null
        ? null
        : parseGenericLaunchRecordV2(input.record);
      if ((input.state === "finalized") !== (record !== null)) {
        throw new TypeError("Generic launch lifecycle record/state is invalid");
      }
      if (record !== null
        && (record.sourceProjection.approval.approvalId !== approvalId
          || record.sourceProjection.descriptor.launchId !== launchId
          || record.sourceProjection.descriptor.descriptorHash !== descriptorHash)) {
        throw new TypeError("Generic launch materialization identity is invalid");
      }
      const canonicalRecord = record === null
        ? null
        : canonicalizeJson(record as unknown as JsonValue);
      if (canonicalRecord !== null
        && Buffer.byteLength(canonicalRecord, "utf8")
          > MAXIMUM_CANONICAL_RECORD_BYTES) {
        throw new TypeError("Generic launch materialization is too large");
      }
      const client = await pool.connect();
      let open = false;
      try {
        await client.query("BEGIN");
        open = true;
        await client.query(`
          SELECT pg_advisory_xact_lock(hashtextextended($1, 0))
        `, [launchId]);
        const already = await client.query<LifecycleRow>(`
          SELECT lifecycle_generation::text, lifecycle_evidence_hash,
                 lifecycle_state, record_hash
            FROM programmable_website_projection_v1.generic_launch_materializations_v2
           WHERE launch_id = $1 AND lifecycle_evidence_hash = $2
           LIMIT 1
        `, [launchId, lifecycleEvidenceHash]);
        const alreadyRow = already.rows[0];
        if (alreadyRow !== undefined) {
          const parsed = lifecycleRow(alreadyRow);
          if (parsed.state !== input.state
            || parsed.recordHash !== (record?.recordHash ?? null)) {
            throw new TypeError("Generic launch lifecycle idempotency conflicted");
          }
          await client.query("COMMIT");
          open = false;
          return Object.freeze({ kind: "existing" as const });
        }
        const next = await client.query<{ generation: unknown }>(`
          SELECT (COALESCE(MAX(lifecycle_generation), 0) + 1)::text AS generation
            FROM programmable_website_projection_v1.generic_launch_materializations_v2
           WHERE launch_id = $1
        `, [launchId]);
        const generation = decimal(
          next.rows[0]?.generation,
          "next lifecycle generation",
        );
        const inserted = await client.query(`
          INSERT INTO programmable_website_projection_v1.generic_launch_materializations_v2
            (approval_id, launch_id, descriptor_hash, lifecycle_generation,
             lifecycle_state, lifecycle_evidence_hash, canonical_record,
             record_hash, source_projection_hash, finalization_block)
          VALUES ($1, $2, $3, $4::numeric, $5, $6, $7, $8, $9, $10::numeric)
          RETURNING lifecycle_generation
        `, [
          approvalId,
          launchId,
          descriptorHash,
          generation,
          input.state,
          lifecycleEvidenceHash,
          canonicalRecord,
          record?.recordHash ?? null,
          record?.sourceProjectionHash ?? null,
          record?.sourceProjection.lifecycle.finalization.blockNumber ?? null,
        ]);
        if (inserted.rowCount === 1) {
          await client.query("COMMIT");
          open = false;
          return Object.freeze({ kind: "created" as const });
        }
        throw new TypeError("Generic launch lifecycle insert failed");
      } catch (error) {
        if (open) await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  });
}

export function createPostgresGenericLaunchReadStoreV2(input: Readonly<{
  pool: ProjectionTargetPostgresPoolV1;
  signer: GenericLaunchReadSignerV2;
  readModelContract: GenericLaunchReadModelContractV2;
  maximumLifecycleAgeMs: number;
}>): GenericLaunchReadStoreV2 {
  const maximumLifecycleAgeMs = lifecycleAge(input.maximumLifecycleAgeMs);
  const readModelContract = Object.freeze({ ...input.readModelContract });
  const findFinalizedLaunches: GenericLaunchReadStoreV2["findFinalizedLaunches"] =
    async ({ limit, cursor, requestBindingHash, signal }) => {
      signal.throwIfAborted();
      await assertFreshGenericLaunchLifecyclesV2(
        input.pool,
        maximumLifecycleAgeMs,
        signal,
      );
      const after = cursor === undefined ? null : decodeCursor(cursor);
      const rows = await input.pool.query<ReadRow>(`
        WITH latest AS (
          SELECT DISTINCT ON (launch_id)
                 launch_id, lifecycle_generation, lifecycle_state,
                 canonical_record, finalization_block, record_hash
            FROM programmable_website_projection_v1.generic_launch_materializations_v2
           ORDER BY launch_id, lifecycle_generation DESC
        )
        SELECT canonical_record, finalization_block::text, record_hash
          FROM latest
         WHERE lifecycle_state = 'finalized'
           AND ($1::numeric IS NULL
             OR (finalization_block, record_hash) < ($1::numeric, $2))
         ORDER BY finalization_block DESC, record_hash DESC
         LIMIT $3
      `, [after?.finalizationBlock ?? null, after?.recordHash ?? null, limit + 1]);
      const count = await input.pool.query<{ total: unknown }>(`
        WITH latest AS (
          SELECT DISTINCT ON (launch_id) launch_id, lifecycle_state
            FROM programmable_website_projection_v1.generic_launch_materializations_v2
           ORDER BY launch_id, lifecycle_generation DESC
        )
        SELECT count(*)::text AS total FROM latest
         WHERE lifecycle_state = 'finalized'
      `);
      signal.throwIfAborted();
      const hasNext = rows.rows.length > limit;
      const page = rows.rows.slice(0, limit).map(readRecord);
      const tail = rows.rows[Math.min(limit, rows.rows.length) - 1];
      const payload = Object.freeze({
        records: Object.freeze(page),
        nextCursor: hasNext && tail !== undefined
          ? encodeCursor({
            finalizationBlock: decimal(tail.finalization_block, "cursor block"),
            recordHash: digest(tail.record_hash, "cursor record"),
          })
          : null,
        total: decimal(count.rows[0]?.total, "Generic launch total"),
      });
      return await input.signer.sign({
        requestBindingHash,
        payload: payload as unknown as JsonValue,
        signal,
      });
    };
  const findFinalizedLaunchByRecordHash:
    GenericLaunchReadStoreV2["findFinalizedLaunchByRecordHash"] =
    async ({ recordHash, requestBindingHash, signal }) => {
      signal.throwIfAborted();
      await assertFreshGenericLaunchLifecyclesV2(
        input.pool,
        maximumLifecycleAgeMs,
        signal,
      );
      const result = await input.pool.query<ReadRow>(`
        SELECT candidate.canonical_record, candidate.finalization_block::text,
               candidate.record_hash
          FROM programmable_website_projection_v1.generic_launch_materializations_v2 candidate
         WHERE candidate.record_hash = $1
           AND candidate.lifecycle_state = 'finalized'
           AND NOT EXISTS (
             SELECT 1
               FROM programmable_website_projection_v1.generic_launch_materializations_v2 newer
              WHERE newer.launch_id = candidate.launch_id
                AND newer.lifecycle_generation > candidate.lifecycle_generation
           )
         LIMIT 1
      `, [digest(recordHash, "Generic launch record hash")]);
      signal.throwIfAborted();
      const payload = result.rows[0] === undefined ? null : readRecord(result.rows[0]);
      return await input.signer.sign({
        requestBindingHash,
        payload: payload as unknown as JsonValue,
        signal,
      });
    };
  return Object.freeze({
    sourceLane: "generic.finalized-launch-v2" as const,
    readModelContract,
    findFinalizedLaunches,
    findFinalizedLaunchByRecordHash,
  });
}

export async function assertPostgresGenericLaunchReadStoreReadyV2(
  pool: ProjectionTargetPostgresPoolV1,
  maximumLifecycleAgeMs: number,
): Promise<void> {
  await assertGenericLaunchMaterializationStorageV2(pool);
  await assertFreshGenericLaunchLifecyclesV2(
    pool,
    lifecycleAge(maximumLifecycleAgeMs),
    new AbortController().signal,
  );
  const result = await pool.query<{ total: unknown }>(`
    WITH latest AS (
      SELECT DISTINCT ON (launch_id) launch_id, lifecycle_state
        FROM programmable_website_projection_v1.generic_launch_materializations_v2
       ORDER BY launch_id, lifecycle_generation DESC
    )
    SELECT count(*)::text AS total FROM latest
     WHERE lifecycle_state = 'finalized'
  `);
  if (decimal(result.rows[0]?.total, "Generic launch ready count") === "0") {
    throw new TypeError("Generic launch read store has no finalized record");
  }
}

async function assertGenericLaunchMaterializationStorageV2(
  pool: ProjectionTargetPostgresPoolV1,
): Promise<void> {
  const result = await pool.query<StoragePostureRow>(`
    SELECT c.relrowsecurity, c.relforcerowsecurity,
           COALESCE((
             SELECT string_agg(p.policyname || ':' || p.cmd, ',' ORDER BY p.policyname)
               FROM pg_policies p
              WHERE p.schemaname = 'programmable_website_projection_v1'
                AND p.tablename = 'generic_launch_materializations_v2'
           ), '') AS policies,
           COALESCE((
             SELECT string_agg(g.privilege_type, ',' ORDER BY g.privilege_type)
               FROM information_schema.role_table_grants g
              WHERE g.table_schema = 'programmable_website_projection_v1'
                AND g.table_name = 'generic_launch_materializations_v2'
                AND g.grantee = 'programmable_website_projection_runtime'
           ), '') AS privileges
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'programmable_website_projection_v1'
       AND c.relname = 'generic_launch_materializations_v2'
       AND c.relkind = 'r'
  `);
  const row = result.rows[0];
  if (result.rows.length !== 1 || row?.relrowsecurity !== true
    || row.relforcerowsecurity !== true
    || row.policies !== "generic_launch_materializations_v2_runtime_insert:INSERT,generic_launch_materializations_v2_runtime_select:SELECT"
    || row.privileges !== "INSERT,SELECT") {
    throw new TypeError("Generic launch materialization storage posture is invalid");
  }
}

export async function listStaleGenericLaunchApprovalsV2(
  pool: ProjectionTargetPostgresPoolV1,
  input: Readonly<{
    maximumLifecycleAgeMs: number;
    limit: number;
    signal: AbortSignal;
  }>,
): Promise<readonly `0x${string}`[]> {
  input.signal.throwIfAborted();
  const maximumLifecycleAgeMs = lifecycleAge(input.maximumLifecycleAgeMs);
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 32) {
    throw new TypeError("Generic launch reconciliation limit is invalid");
  }
  const result = await pool.query<ApprovalIdRow>(`
    WITH latest AS (
      SELECT DISTINCT ON (launch_id)
             approval_id, launch_id, lifecycle_generation, created_at
        FROM programmable_website_projection_v1.generic_launch_materializations_v2
       ORDER BY launch_id, lifecycle_generation DESC
    )
    SELECT substring(p.projection_key FROM 10) AS approval_id
      FROM programmable_website_projection_v1.projection_records p
      LEFT JOIN latest l
        ON l.approval_id = substring(p.projection_key FROM 10)
     WHERE p.lane = 'website.approval-v3'
       AND (l.approval_id IS NULL OR l.created_at < clock_timestamp()
         - ($1::bigint * interval '1 millisecond'))
     ORDER BY l.created_at ASC NULLS FIRST, p.projection_key ASC
     LIMIT $2
  `, [maximumLifecycleAgeMs, input.limit]);
  input.signal.throwIfAborted();
  return Object.freeze(result.rows.map((row) =>
    hash32(row.approval_id, "stale Generic launch Approval ID")));
}

async function assertFreshGenericLaunchLifecyclesV2(
  pool: ProjectionTargetPostgresPoolV1,
  maximumLifecycleAgeMs: number,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const result = await pool.query<{ stale: unknown }>(`
    WITH latest AS (
      SELECT DISTINCT ON (launch_id)
             launch_id, lifecycle_generation, created_at
        FROM programmable_website_projection_v1.generic_launch_materializations_v2
       ORDER BY launch_id, lifecycle_generation DESC
    )
    SELECT count(*)::text AS stale
      FROM latest
     WHERE created_at < clock_timestamp()
       - ($1::bigint * interval '1 millisecond')
  `, [maximumLifecycleAgeMs]);
  signal.throwIfAborted();
  if (decimal(result.rows[0]?.stale, "stale Generic launch count") !== "0") {
    throw new TypeError("Generic launch lifecycle snapshot is stale");
  }
}

function lifecycleRow(row: LifecycleRow) {
  const state = row.lifecycle_state;
  if (state !== "finalized" && state !== "revoked" && state !== "invalidated") {
    throw new TypeError("stored lifecycle state is invalid");
  }
  return Object.freeze({
    lifecycleGeneration: decimal(row.lifecycle_generation, "lifecycle generation"),
    lifecycleEvidenceHash: digest(row.lifecycle_evidence_hash, "lifecycle evidence"),
    state,
    recordHash: row.record_hash === null
      ? null
      : digest(row.record_hash, "lifecycle record hash"),
  });
}

function readRecord(row: ReadRow): GenericLaunchRecordV2 {
  const value = canonicalObject(row.canonical_record, "Generic launch record");
  const record = parseGenericLaunchRecordV2(value);
  if (record.recordHash !== digest(row.record_hash, "Generic launch record hash")
    || record.sourceProjection.lifecycle.finalization.blockNumber
      !== decimal(row.finalization_block, "Generic launch finalization block")) {
    throw new TypeError("Generic launch row index is inconsistent");
  }
  return record;
}

function canonicalObject(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "string"
    || Buffer.byteLength(value, "utf8") > MAXIMUM_CANONICAL_RECORD_BYTES) {
    throw new TypeError(`${label} is invalid`);
  }
  const parsed = parseStrictJson(value, {
    maximumBytes: MAXIMUM_CANONICAL_RECORD_BYTES,
    maximumDepth: 128,
  });
  if (canonicalizeJson(parsed) !== value || parsed === null
    || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} is not canonical`);
  }
  return parsed as Readonly<Record<string, unknown>>;
}

function encodeCursor(value: Readonly<{
  finalizationBlock: string;
  recordHash: Sha256Digest;
}>): string {
  return Buffer.from(canonicalizeJson(value as unknown as JsonValue), "utf8")
    .toString("base64url");
}

function decodeCursor(value: string): Readonly<{
  finalizationBlock: string;
  recordHash: Sha256Digest;
}> {
  if (!/^[A-Za-z0-9_-]{1,1024}$/u.test(value)) {
    throw new TypeError("Generic launch cursor is invalid");
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value) {
    throw new TypeError("Generic launch cursor is not canonical");
  }
  const parsed = parseStrictJson(bytes.toString("utf8"), {
    maximumBytes: 1024,
    maximumDepth: 4,
  });
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Generic launch cursor is invalid");
  }
  const source = parsed as Readonly<Record<string, unknown>>;
  if (Object.keys(source).sort().join(",") !== "finalizationBlock,recordHash") {
    throw new TypeError("Generic launch cursor keys are invalid");
  }
  return Object.freeze({
    finalizationBlock: decimal(source.finalizationBlock, "cursor block"),
    recordHash: digest(source.recordHash, "cursor record hash"),
  });
}

function hash32(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !HASH32.test(value)
    || value === `0x${"00".repeat(32)}`) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as `0x${string}`;
}

function digest(value: unknown, label: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Sha256Digest;
}

function decimal(value: unknown, label: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function lifecycleAge(value: number): number {
  if (!Number.isSafeInteger(value) || value < 30_000 || value > 900_000) {
    throw new TypeError("Generic launch lifecycle maximum age is invalid");
  }
  return value;
}
