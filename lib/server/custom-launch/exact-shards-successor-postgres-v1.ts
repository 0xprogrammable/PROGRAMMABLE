import "server-only";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../projection-target/canonical-json";
import { canonicalSha256 } from "../projection-target/hashing";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresPoolV1,
} from "../projection-target/postgres-store";
import {
  assertProjectedExactShardsRevocationV1,
  assertProjectedFinalizedExactShardsRecordV1,
  parseExactShardsSuccessorDescriptorV1,
  validateExactShardsPublicRecordV1,
  type BoundExactShardsSuccessorDescriptorV1,
  type ExactShardsPublicRecordV1,
  type ExactShardsRevocationRecordV1,
  type ExactShardsSuccessorPublicReadStoreV1,
} from "./exact-shards-successor-projection-v1";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const MAXIMUM_PUBLIC_EXACT_SHARDS = 100;
const CANONICAL_HISTORY_LOCK = "registry.exact-shards-v2.canonical-history.v1";

interface CurrentRow extends Record<string, unknown> {
  website_project_id: string;
  launch_id: string;
  lifecycle_state: string;
  latest_event_sequence: string | number | bigint | null;
  record_binding_sha256: string | null;
  canonical_public_record: string | null;
}

interface EventRow extends Record<string, unknown> {
  event_sequence: string | number | bigint;
  event_kind: string;
  record_binding_sha256: string | null;
  canonical_public_record: string | null;
}

interface CanonicalHistoryRow extends Record<string, unknown> {
  canonical_generation: string | number | bigint;
}

export type ExactShardsCanonicalProjectionPermitV1 = Readonly<{
  sourceLane: "registry.exact-shards-v2";
  canonicalGeneration: string;
}>;

export type ExactShardsPersistenceResultV1 = Readonly<{
  kind: "created" | "updated" | "existing" | "conflict";
}>;

/**
 * Durable successor fold. Only opaque outputs minted by the authenticated
 * dual-RPC projector can enter the event ledger. Public reads revalidate the
 * full immutable record and current release descriptor after JSON round-trip.
 */
export class PostgresExactShardsSuccessorStoreV1
implements ExactShardsSuccessorPublicReadStoreV1 {
  readonly sourceLane = "registry.exact-shards-v2" as const;
  readonly #pool: ProjectionTargetPostgresPoolV1;
  readonly #descriptor: BoundExactShardsSuccessorDescriptorV1;
  readonly #canonicalProjectionPermits = new WeakSet<object>();

  constructor(input: Readonly<{
    pool: ProjectionTargetPostgresPoolV1;
    descriptor: unknown;
  }>) {
    if (input.pool === null || typeof input.pool !== "object"
      || typeof input.pool.connect !== "function"
      || typeof input.pool.query !== "function") {
      throw new TypeError("ExactShards PostgreSQL pool is invalid");
    }
    const descriptor = parseExactShardsSuccessorDescriptorV1(input.descriptor);
    if (descriptor.status !== "bound") {
      throw new TypeError("ExactShards PostgreSQL store requires a bound descriptor");
    }
    this.#pool = input.pool;
    this.#descriptor = descriptor;
  }

  /**
   * Mint a process-local permit bound to the durable canonical generation.
   * The caller obtains this before authenticated RPC projection. A rollback
   * advances the generation, so work projected from the old canonical view
   * cannot be persisted after the reorg transaction commits.
   */
  async authorizeCanonicalProjection(input: Readonly<{
    signal: AbortSignal;
  }>): Promise<ExactShardsCanonicalProjectionPermitV1> {
    input.signal.throwIfAborted();
    const result = await this.#pool.query<CanonicalHistoryRow>(`
      SELECT canonical_generation
        FROM programmable_website_projection_v1.registry_exact_shards_canonical_history
       WHERE singleton = true
    `);
    input.signal.throwIfAborted();
    if (result.rows.length !== 1) {
      throw new TypeError("ExactShards canonical history checkpoint is invalid");
    }
    const permit = Object.freeze({
      sourceLane: "registry.exact-shards-v2" as const,
      canonicalGeneration: canonicalGeneration(
        result.rows[0]?.canonical_generation,
      ).toString(),
    });
    this.#canonicalProjectionPermits.add(permit);
    return permit;
  }

  async materializeFinalized(input: Readonly<{
    record: ExactShardsPublicRecordV1;
    canonicalProjection: ExactShardsCanonicalProjectionPermitV1;
    signal: AbortSignal;
  }>): Promise<ExactShardsPersistenceResultV1> {
    input.signal.throwIfAborted();
    this.#assertCanonicalProjectionPermit(input.canonicalProjection);
    assertProjectedFinalizedExactShardsRecordV1(input.record);
    validateExactShardsPublicRecordV1(input.record, this.#descriptor);
    const record = input.record;
    const canonicalRecord = canonicalizeJson(record as unknown as JsonValue);
    const eventBinding = canonicalSha256(
      "programmable.exact-shards-projection-event.v1",
      {
        kind: "finalized",
        recordBindingSha256: record.recordBindingSha256,
        launchBlockHash: record.launch.blockHash,
        finalizationBlockHash: record.finality.finalizedBlockHash,
      },
    );
    const client = await this.#pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 841103204))",
        [CANONICAL_HISTORY_LOCK],
      );
      if (!await this.#canonicalProjectionIsCurrent(
        client,
        input.canonicalProjection,
        [record.launch.blockHash, record.finality.finalizedBlockHash],
      )) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "conflict" as const });
      }
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 841103204))",
        [record.publicIdentity.registryLaunchId],
      );
      const current = await client.query<CurrentRow>(`
        SELECT website_project_id, launch_id, lifecycle_state,
               latest_event_sequence, record_binding_sha256,
               canonical_public_record
          FROM programmable_website_projection_v1.registry_exact_shards_records
         WHERE launch_id = $1
         FOR UPDATE
      `, [record.publicIdentity.registryLaunchId]);
      const existing = current.rows[0];
      if (existing?.lifecycle_state === "revoked"
        || (existing?.lifecycle_state === "finalized"
          && existing.record_binding_sha256 !== record.recordBindingSha256)) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "conflict" as const });
      }
      if (existing?.lifecycle_state === "finalized") {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "existing" as const });
      }
      const event = await client.query<{ event_sequence: string | number | bigint }>(`
        INSERT INTO programmable_website_projection_v1.registry_exact_shards_events
          (event_binding_sha256, website_project_id, launch_id, event_kind,
           launch_block_hash, finalization_block_hash, event_block_hash,
           canonical, record_binding_sha256, canonical_public_record)
        VALUES ($1, $2, $3, 'finalized', $4, $5, $5, true, $6, $7)
        ON CONFLICT (event_binding_sha256) DO UPDATE SET canonical = true
        RETURNING event_sequence
      `, [
        eventBinding,
        record.publicIdentity.websiteProjectId,
        record.publicIdentity.registryLaunchId,
        record.launch.blockHash,
        record.finality.finalizedBlockHash,
        record.recordBindingSha256,
        canonicalRecord,
      ]);
      const eventSequence = event.rows[0]?.event_sequence;
      if (eventSequence === undefined) {
        throw new TypeError("ExactShards finalized event persistence failed");
      }
      await client.query(`
        INSERT INTO programmable_website_projection_v1.registry_exact_shards_records
          (website_project_id, launch_id, lifecycle_state,
           latest_event_sequence, record_binding_sha256, canonical_public_record)
        VALUES ($1, $2, 'finalized', $3::bigint, $4, $5)
        ON CONFLICT (launch_id) DO UPDATE SET
          website_project_id = EXCLUDED.website_project_id,
          lifecycle_state = 'finalized',
          latest_event_sequence = EXCLUDED.latest_event_sequence,
          record_binding_sha256 = EXCLUDED.record_binding_sha256,
          canonical_public_record = EXCLUDED.canonical_public_record,
          updated_at = clock_timestamp()
      `, [
        record.publicIdentity.websiteProjectId,
        record.publicIdentity.registryLaunchId,
        eventSequence,
        record.recordBindingSha256,
        canonicalRecord,
      ]);
      await client.query("COMMIT");
      transactionOpen = false;
      return Object.freeze({ kind: existing === undefined ? "created" : "updated" });
    } catch (error) {
      if (transactionOpen) await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async materializeRevocation(input: Readonly<{
    record: ExactShardsRevocationRecordV1;
    canonicalProjection: ExactShardsCanonicalProjectionPermitV1;
    signal: AbortSignal;
  }>): Promise<ExactShardsPersistenceResultV1> {
    input.signal.throwIfAborted();
    this.#assertCanonicalProjectionPermit(input.canonicalProjection);
    assertProjectedExactShardsRevocationV1(input.record);
    const record = input.record;
    const eventBinding = canonicalSha256(
      "programmable.exact-shards-projection-event.v1",
      record as unknown as JsonValue,
    );
    const client = await this.#pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 841103204))",
        [CANONICAL_HISTORY_LOCK],
      );
      if (!await this.#canonicalProjectionIsCurrent(
        client,
        input.canonicalProjection,
        [record.blockHash, record.blockHash],
      )) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "conflict" as const });
      }
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 841103204))",
        [record.launchId],
      );
      const current = await client.query<CurrentRow>(`
        SELECT website_project_id, launch_id, lifecycle_state,
               latest_event_sequence, record_binding_sha256,
               canonical_public_record
          FROM programmable_website_projection_v1.registry_exact_shards_records
         WHERE launch_id = $1
         FOR UPDATE
      `, [record.launchId]);
      const existing = current.rows[0];
      if (existing?.lifecycle_state === "revoked") {
        const duplicate = await client.query(`
          SELECT event_sequence
            FROM programmable_website_projection_v1.registry_exact_shards_events
           WHERE event_binding_sha256 = $1 AND canonical = true
        `, [eventBinding]);
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({
          kind: duplicate.rows[0] === undefined ? "conflict" as const : "existing" as const,
        });
      }
      if (existing?.lifecycle_state !== "finalized"
        || existing.canonical_public_record === null) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "conflict" as const });
      }
      const finalized = parseStoredRecord(
        existing.canonical_public_record,
        this.#descriptor,
      );
      if (finalized.launch.registeredRecordCommitment !== record.latestRecordHash
        || finalized.publicIdentity.registryLaunchId !== record.launchId) {
        await client.query("COMMIT");
        transactionOpen = false;
        return Object.freeze({ kind: "conflict" as const });
      }
      const event = await client.query<{ event_sequence: string | number | bigint }>(`
        INSERT INTO programmable_website_projection_v1.registry_exact_shards_events
          (event_binding_sha256, website_project_id, launch_id, event_kind,
           event_block_hash, canonical)
        VALUES ($1, $2, $3, 'revoked', $4, true)
        ON CONFLICT (event_binding_sha256) DO UPDATE SET canonical = true
        RETURNING event_sequence
      `, [eventBinding, existing.website_project_id, record.launchId, record.blockHash]);
      const eventSequence = event.rows[0]?.event_sequence;
      if (eventSequence === undefined) {
        throw new TypeError("ExactShards revocation persistence failed");
      }
      await client.query(`
        UPDATE programmable_website_projection_v1.registry_exact_shards_records
           SET lifecycle_state = 'revoked', latest_event_sequence = $2::bigint,
               record_binding_sha256 = NULL, canonical_public_record = NULL,
               updated_at = clock_timestamp()
         WHERE launch_id = $1
      `, [record.launchId, eventSequence]);
      await client.query("COMMIT");
      transactionOpen = false;
      return Object.freeze({ kind: "updated" as const });
    } catch (error) {
      if (transactionOpen) await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async rollbackCanonicalBlock(input: Readonly<{
    blockHash: string;
    signal: AbortSignal;
  }>): Promise<Readonly<{ affectedLaunches: number }>> {
    input.signal.throwIfAborted();
    if (!HASH32.test(input.blockHash)) {
      throw new TypeError("ExactShards orphaned block hash is invalid");
    }
    const client = await this.#pool.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      // Serialize with both materializers before discovering affected rows.
      // Otherwise an event can become canonical immediately after discovery
      // and escape this rollback forever.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 841103204))",
        [CANONICAL_HISTORY_LOCK],
      );
      const alreadyOrphaned = await client.query(`
        SELECT block_hash
          FROM programmable_website_projection_v1.registry_exact_shards_orphaned_blocks
         WHERE block_hash = $1
      `, [input.blockHash]);
      if (alreadyOrphaned.rows[0] === undefined) {
        const advanced = await client.query<CanonicalHistoryRow>(`
          UPDATE programmable_website_projection_v1.registry_exact_shards_canonical_history
             SET canonical_generation = canonical_generation + 1,
                 updated_at = clock_timestamp()
           WHERE singleton = true
          RETURNING canonical_generation
        `);
        if (advanced.rows.length !== 1) {
          throw new TypeError("ExactShards canonical history checkpoint is invalid");
        }
        const orphanedGeneration = canonicalGeneration(
          advanced.rows[0]?.canonical_generation,
        );
        await client.query(`
          INSERT INTO programmable_website_projection_v1.registry_exact_shards_orphaned_blocks
            (block_hash, orphaned_generation)
          VALUES ($1, $2::bigint)
        `, [input.blockHash, orphanedGeneration.toString()]);
      }
      const affected = await client.query<{ launch_id: string }>(`
        SELECT DISTINCT launch_id
          FROM programmable_website_projection_v1.registry_exact_shards_events
         WHERE canonical = true
           AND ($1 = launch_block_hash OR $1 = finalization_block_hash
             OR $1 = event_block_hash)
         ORDER BY launch_id
      `, [input.blockHash]);
      for (const { launch_id: launchId } of affected.rows) {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 841103204))",
          [launchId],
        );
        await client.query(`
          SELECT launch_id
            FROM programmable_website_projection_v1.registry_exact_shards_records
           WHERE launch_id = $1
           FOR UPDATE
        `, [launchId]);
      }
      await client.query(`
        UPDATE programmable_website_projection_v1.registry_exact_shards_events
           SET canonical = false
         WHERE canonical = true
           AND ($1 = launch_block_hash OR $1 = finalization_block_hash
             OR $1 = event_block_hash)
      `, [input.blockHash]);
      for (const { launch_id: launchId } of affected.rows) {
        const latest = await client.query<EventRow>(`
          SELECT event_sequence, event_kind, record_binding_sha256,
                 canonical_public_record
            FROM programmable_website_projection_v1.registry_exact_shards_events
           WHERE launch_id = $1 AND canonical = true
           ORDER BY event_sequence DESC
           LIMIT 1
        `, [launchId]);
        const event = latest.rows[0];
        if (event === undefined) {
          await client.query(`
            UPDATE programmable_website_projection_v1.registry_exact_shards_records
               SET lifecycle_state = 'reorged', latest_event_sequence = NULL,
                   record_binding_sha256 = NULL, canonical_public_record = NULL,
                   updated_at = clock_timestamp()
             WHERE launch_id = $1
          `, [launchId]);
        } else if (event.event_kind === "revoked") {
          await client.query(`
            UPDATE programmable_website_projection_v1.registry_exact_shards_records
               SET lifecycle_state = 'revoked', latest_event_sequence = $2::bigint,
                   record_binding_sha256 = NULL, canonical_public_record = NULL,
                   updated_at = clock_timestamp()
             WHERE launch_id = $1
          `, [launchId, event.event_sequence]);
        } else if (event.event_kind === "finalized"
          && event.record_binding_sha256 !== null
          && event.canonical_public_record !== null) {
          parseStoredRecord(event.canonical_public_record, this.#descriptor);
          await client.query(`
            UPDATE programmable_website_projection_v1.registry_exact_shards_records
               SET lifecycle_state = 'finalized', latest_event_sequence = $2::bigint,
                   record_binding_sha256 = $3, canonical_public_record = $4,
                   updated_at = clock_timestamp()
             WHERE launch_id = $1
          `, [
            launchId,
            event.event_sequence,
            event.record_binding_sha256,
            event.canonical_public_record,
          ]);
        } else {
          throw new TypeError("ExactShards canonical history is invalid");
        }
      }
      await client.query("COMMIT");
      transactionOpen = false;
      return Object.freeze({ affectedLaunches: affected.rows.length });
    } catch (error) {
      if (transactionOpen) await rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  #assertCanonicalProjectionPermit(
    permit: ExactShardsCanonicalProjectionPermitV1,
  ): void {
    if (permit === null || typeof permit !== "object"
      || !this.#canonicalProjectionPermits.has(permit)) {
      throw new TypeError("ExactShards canonical projection permit is invalid");
    }
  }

  async #canonicalProjectionIsCurrent(
    client: ProjectionTargetPostgresClientV1,
    permit: ExactShardsCanonicalProjectionPermitV1,
    blockHashes: readonly [string, string],
  ): Promise<boolean> {
    const checkpoint = await client.query<CanonicalHistoryRow>(`
      SELECT canonical_generation
        FROM programmable_website_projection_v1.registry_exact_shards_canonical_history
       WHERE singleton = true
       FOR UPDATE
    `);
    if (checkpoint.rows.length !== 1
      || canonicalGeneration(checkpoint.rows[0]?.canonical_generation).toString()
        !== permit.canonicalGeneration) {
      return false;
    }
    const orphaned = await client.query(`
      SELECT block_hash
        FROM programmable_website_projection_v1.registry_exact_shards_orphaned_blocks
       WHERE block_hash = $1 OR block_hash = $2
       LIMIT 1
    `, blockHashes);
    return orphaned.rows[0] === undefined;
  }

  async findByWebsiteProjectId(input: Readonly<{
    projectId: `sha256:${string}`;
    signal: AbortSignal;
  }>): Promise<ExactShardsPublicRecordV1 | null> {
    input.signal.throwIfAborted();
    if (!SHA256.test(input.projectId)) {
      throw new TypeError("ExactShards Website project ID is invalid");
    }
    const result = await this.#pool.query<CurrentRow>(`
      SELECT website_project_id, launch_id, lifecycle_state,
             latest_event_sequence, record_binding_sha256,
             canonical_public_record
        FROM programmable_website_projection_v1.registry_exact_shards_records
       WHERE website_project_id = $1 AND lifecycle_state = 'finalized'
         AND canonical_public_record IS NOT NULL
       LIMIT 1
    `, [input.projectId]);
    input.signal.throwIfAborted();
    const row = result.rows[0];
    return row?.canonical_public_record === null || row === undefined
      ? null
      : parseStoredRecord(row.canonical_public_record, this.#descriptor);
  }

  async findPublic(input: Readonly<{
    signal: AbortSignal;
  }>): Promise<readonly ExactShardsPublicRecordV1[]> {
    input.signal.throwIfAborted();
    const result = await this.#pool.query<CurrentRow>(`
      SELECT website_project_id, launch_id, lifecycle_state,
             latest_event_sequence, record_binding_sha256,
             canonical_public_record
        FROM programmable_website_projection_v1.registry_exact_shards_records
       WHERE lifecycle_state = 'finalized' AND canonical_public_record IS NOT NULL
       ORDER BY latest_event_sequence DESC, website_project_id ASC
       LIMIT ${MAXIMUM_PUBLIC_EXACT_SHARDS}
    `);
    input.signal.throwIfAborted();
    return Object.freeze(result.rows.map((row) => {
      if (row.canonical_public_record === null) {
        throw new TypeError("ExactShards finalized row lacks a public record");
      }
      return parseStoredRecord(row.canonical_public_record, this.#descriptor);
    }));
  }
}

function parseStoredRecord(
  canonicalRecord: string,
  descriptor: BoundExactShardsSuccessorDescriptorV1,
): ExactShardsPublicRecordV1 {
  const value: unknown = parseStrictJson(canonicalRecord, {
    maximumDepth: 32,
    maximumBytes: 1_048_576,
  });
  validateExactShardsPublicRecordV1(value, descriptor);
  return freezeDeep(value);
}

function canonicalGeneration(value: unknown): bigint {
  if (typeof value !== "string" && typeof value !== "number"
    && typeof value !== "bigint") {
    throw new TypeError("ExactShards canonical generation is invalid");
  }
  let parsed: bigint;
  try {
    parsed = BigInt(value);
  } catch {
    throw new TypeError("ExactShards canonical generation is invalid");
  }
  if (parsed <= 0n || (typeof value === "number" && !Number.isSafeInteger(value))) {
    throw new TypeError("ExactShards canonical generation is invalid");
  }
  return parsed;
}

async function rollback(client: Readonly<{
  query(text: string, values?: readonly unknown[]): Promise<unknown>;
}>): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch {
    // The original persistence error remains authoritative.
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      freezeDeep(nested);
    }
  }
  return value;
}
