import { readFile } from "node:fs/promises";

import {
  canonicalJson,
  sha256,
} from "./hosted-db-operator-core.mjs";
import {
  closeHostedDatabase,
  openHostedDatabase,
} from "./hosted-db-postgres.mjs";

const BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;

function integer(value, label) {
  const normalized = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function bytes(value, label) {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (!BYTES32.test(normalized)) throw new Error(`${label} is invalid`);
  return Buffer.from(normalized.slice(2), "hex");
}

function rowBytes(value, label) {
  if (!Buffer.isBuffer(value) || value.length !== 32) {
    throw new Error(`${label} is invalid`);
  }
  return `0x${value.toString("hex")}`;
}

function timestamp(value, label) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.valueOf())) throw new Error(`${label} is invalid`);
  return date.toISOString();
}

export function buildDatabasePromotionInput(input) {
  if (
    typeof input.envioProviderDeploymentId !== "string" ||
    !/^[0-9a-f-]{36}$/u.test(input.envioProviderDeploymentId) ||
    !COMMIT.test(input.productCommit ?? "") ||
    !DEPLOYMENT_ID.test(input.stagedDeploymentId ?? "")
  ) {
    throw new Error("database promotion identity is invalid");
  }
  const promotedAt = timestamp(input.promotedAt, "database promotion timestamp");
  const payload = Object.freeze({
    schemaVersion: 1,
    candidateEndpointIdentity: input.candidateEndpointIdentity,
    envioProviderDeploymentId: input.envioProviderDeploymentId,
    baselineCommitment: input.baselineCommitment,
    candidateInventoryParityCommitment: input.candidateInventoryParityCommitment,
    envioPromotionAttestationCommitment: input.envioPromotionAttestationCommitment,
    productCommit: input.productCommit,
    stagedDeploymentId: input.stagedDeploymentId,
    promotedAt,
  });
  const normalized = Object.freeze({
    ...payload,
    baselineCommitment: `0x${bytes(payload.baselineCommitment, "baseline commitment").toString("hex")}`,
    candidateInventoryParityCommitment:
      `0x${bytes(payload.candidateInventoryParityCommitment, "candidate inventory parity commitment").toString("hex")}`,
    envioPromotionAttestationCommitment:
      `0x${bytes(payload.envioPromotionAttestationCommitment, "Envio promotion attestation").toString("hex")}`,
  });
  return Object.freeze({
    ...normalized,
    inputCommitment: sha256(
      `programmable:candidate-database-promotion:v1\0${canonicalJson(normalized)}`,
    ),
  });
}

export async function inspectCandidateDatabase(sql) {
  const rows = await sql.unsafe(`
    select control.database_mode::text as database_mode,
           control.envio_provider_deployment_id::text as envio_provider_deployment_id,
           control.promotion_attestation_commitment,
           control.promoted_at,
           (select pg_catalog.count(*)::text
              from programmable_private.projection_publications) as publication_count
      from programmable_private.candidate_database_control as control
     where control.singleton
  `);
  if (rows.length !== 1) throw new Error("candidate database control is unavailable");
  const row = rows[0];
  return Object.freeze({
    databaseMode: row.database_mode,
    envioProviderDeploymentId: row.envio_provider_deployment_id,
    promoted: row.promoted_at !== null,
    promotedAt: row.promoted_at === null ? null : timestamp(row.promoted_at, "database promotion timestamp"),
    publicationCount: Number(row.publication_count),
    promotionAttestationCommitment:
      row.promotion_attestation_commitment === null
        ? null
        : rowBytes(row.promotion_attestation_commitment, "database promotion attestation"),
  });
}

export async function attestCandidateDatabasePromotion({ sql, promotion }) {
  return sql.begin(async (transaction) => {
    await transaction.unsafe(
      "set local role programmable_operator; set local lock_timeout = '4s'; set local statement_timeout = '30s'",
    ).simple();
    const [lock] = await transaction.unsafe(`
      select pg_catalog.pg_try_advisory_xact_lock(
        pg_catalog.hashtextextended('programmable:candidate-cutover:v1', 0)
      ) as acquired
    `);
    if (lock?.acquired !== true) {
      throw new Error("another candidate cutover operator holds the database lock");
    }
    const [result] = await transaction`
      select programmable_private.attest_candidate_database_promotion(
        ${promotion.envioProviderDeploymentId}::uuid,
        ${bytes(promotion.baselineCommitment, "baseline commitment")}::bytea,
        ${bytes(promotion.candidateInventoryParityCommitment, "candidate inventory parity commitment")}::bytea,
        ${bytes(promotion.envioPromotionAttestationCommitment, "Envio promotion attestation")}::bytea,
        ${bytes(promotion.inputCommitment, "database promotion input commitment")}::bytea,
        ${promotion.promotedAt}::timestamptz
      ) as changed
    `;
    if (typeof result?.changed !== "boolean") {
      throw new Error("database promotion attestation returned an invalid result");
    }
    return Object.freeze({ changed: result.changed });
  });
}

export async function readCheckpointInventory(sql) {
  const rows = await sql.begin(async (transaction) => {
    await transaction.unsafe(
      "set local role programmable_reconciler; set local statement_timeout = '15s'; set local transaction read only",
    ).simple();
    return transaction.unsafe(`
      select chain_id::text, release_id::text, model_id::text,
             source_group::text, epoch_id::text,
             pointer_generation::text, checkpoint_id::text,
             block_number::text,
             '0x' || pg_catalog.encode(block_hash, 'hex') as block_hash
        from programmable_private.checkpoint_summary_v1
       order by release_id
    `);
  });
  return Object.freeze([...rows]);
}

export async function inspectProjectorLeaseDrain(sql) {
  const rows = await sql.begin(async (transaction) => {
    await transaction.unsafe(
      "set local transaction read only; set local statement_timeout = '10s'",
    ).simple();
    return transaction.unsafe(`
      with observed as (
        select pg_catalog.clock_timestamp() as observed_at
      )
      select 'source'::text as projector,
             lease.lease_generation::text as lease_generation,
             lease.expires_at,
             lease.released_at,
             observed.observed_at,
             (
               lease.lease_generation = 0
               or lease.released_at is not null
               or lease.expires_at <= observed.observed_at
             ) as drained
        from programmable_private.projector_runtime_lease_current as lease
        cross join observed
      union all
      select 'market'::text as projector,
             lease.lease_generation::text as lease_generation,
             lease.expires_at,
             lease.released_at,
             observed.observed_at,
             (
               lease.lease_generation = 0
               or lease.released_at is not null
               or lease.expires_at <= observed.observed_at
             ) as drained
        from programmable_private.market_projector_runtime_lease_current as lease
        cross join observed
       order by projector
    `);
  });
  if (
    rows.length !== 2 ||
    rows[0]?.projector !== "market" ||
    rows[1]?.projector !== "source" ||
    rows.some((row) => typeof row.drained !== "boolean")
  ) {
    throw new Error("projector lease state is unavailable");
  }
  const observedAt = timestamp(rows[0].observed_at, "lease observation timestamp");
  if (timestamp(rows[1].observed_at, "lease observation timestamp") !== observedAt) {
    throw new Error("projector leases were not observed atomically");
  }
  const leases = rows.map((row) => Object.freeze({
    projector: row.projector,
    leaseGeneration: integer(row.lease_generation, "lease generation"),
    expiresAt:
      row.expires_at === null
        ? null
        : timestamp(row.expires_at, "lease expiry timestamp"),
    releasedAt:
      row.released_at === null
        ? null
        : timestamp(row.released_at, "lease release timestamp"),
    drained: row.drained,
  }));
  return Object.freeze({
    observedAt,
    drained: leases.every((lease) => lease.drained),
    leases: Object.freeze(leases),
  });
}

export async function waitForProjectorLeaseDrain(input) {
  const maximumWaitMs = input.maximumWaitMs ?? 120_000;
  const intervalMs = input.intervalMs ?? 1_000;
  if (
    !Number.isSafeInteger(maximumWaitMs) ||
    maximumWaitMs < 1_000 ||
    maximumWaitMs > 180_000 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 100 ||
    intervalMs > 5_000
  ) {
    throw new Error("projector lease drain bound is invalid");
  }
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const startedAt = now();
  let attempts = 0;
  while (now() - startedAt <= maximumWaitMs) {
    attempts += 1;
    const state = await input.inspect();
    if (state?.drained === true) {
      return Object.freeze({ ...state, attempts, waitedMs: now() - startedAt });
    }
    await sleep(intervalMs);
  }
  throw new Error("projector leases did not drain before the cutover deadline");
}

export async function withDirectOperatorDatabase(input, operation) {
  const connection = await openHostedDatabase({
    databaseUrl: input.databaseUrl,
    expectedProjectRef: input.expectedProjectRef,
    sslCaPem: input.sslCaPem,
  });
  try {
    return await operation(connection.sql);
  } finally {
    await closeHostedDatabase(connection.sql);
  }
}

export async function readJsonEvidence(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("evidence file is invalid");
  }
  return parsed;
}
