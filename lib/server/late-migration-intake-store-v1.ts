import "server-only";

import { getAddress, isAddress, type Address, type Hex } from "viem";

import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "./projection-target/canonical-json";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresPoolV1,
} from "./projection-target/postgres-store";
import {
  createProductionProjectionTargetPostgresPoolV1,
} from "./projection-target/website-target";

const PREFIX = "late-migration-intake:v1";
const SAFE_RELEASE_ID = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const SIGNATURE = /^0x[0-9a-f]{130}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const SAFE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,255}$/u;

export const LATE_MIGRATION_INTAKE_STAGES_V1 = Object.freeze([
  "signature_reserved",
  "deposit_submitted",
  "deposit_confirmed",
  "deposit_finalized",
] as const);

export type LateMigrationIntakeStageV1 =
  (typeof LATE_MIGRATION_INTAKE_STAGES_V1)[number];

export type LateMigrationIntakeIntentV1 = Readonly<{
  schema: "programmable-late-migration-intake-intent/v1";
  releaseId: string;
  sourceAddress: Address;
  offerIndex: number;
  grossAmountRaw: string;
  manualPayoutAmountRaw: string;
  sourceContractAddress: Address;
  relayerAddress: Address;
  permitNonce: string;
  permitDeadline: string;
  permitSignature: Hex;
  depositGasLimit: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  reservationWei: string;
  totalBudgetWei: string;
  principalBindingHash: `sha256:${string}`;
  idempotencyBindingHash: `sha256:${string}`;
  requestBindingHash: `sha256:${string}`;
  transactionBindingHash: `sha256:${string}`;
  providerIdempotencyKey: string;
  providerReferenceId: string;
  reservedAt: string;
}>;

export type LateMigrationIntakeTransitionV1 =
  | Readonly<{
      schema: "programmable-late-migration-intake-transition/v1";
      stage: "deposit_submitted";
      transactionHash: Hex;
    }>
  | Readonly<{
      schema: "programmable-late-migration-intake-transition/v1";
      stage: "deposit_confirmed";
      transactionHash: Hex;
      blockNumber: string;
      blockHash: Hex;
      depositId: Hex;
      logIndex: number;
    }>
  | Readonly<{
      schema: "programmable-late-migration-intake-transition/v1";
      stage: "deposit_finalized";
      transactionHash: Hex;
      blockNumber: string;
      blockHash: Hex;
      depositId: Hex;
      logIndex: number;
      finalizedBlockNumberA: string;
      finalizedBlockNumberB: string;
    }>;

export type LateMigrationIntakeSupportV1 = Readonly<{
  schema: "programmable-late-migration-intake-support/v1";
  reason:
    | "provider_terminal_failure"
    | "provider_replacement_unresolved"
    | "permit_expired_before_submission"
    | "submission_outcome_unknown"
    | "confirmation_reorged";
  markedAt: string;
}>;

export type LateMigrationIntakeSendClaimV1 = Readonly<{
  schema: "programmable-late-migration-intake-send-claim/v1";
  transactionBindingHash: `sha256:${string}`;
  providerReferenceId: string;
  claimedAt: string;
}>;

export type LateMigrationIntakeRecordV1 = Readonly<{
  intent: LateMigrationIntakeIntentV1;
  stage: LateMigrationIntakeStageV1;
  transitions: readonly LateMigrationIntakeTransitionV1[];
  sendClaim: LateMigrationIntakeSendClaimV1 | null;
  support: LateMigrationIntakeSupportV1 | null;
}>;

export type LateMigrationIntakeLookupV1 = Readonly<{
  releaseId: string;
  sourceAddress: Address;
}>;

export interface LateMigrationIntakeStoreV1 {
  admit(input: Readonly<{
    releaseId: string;
    sourceAddress: Address;
    principalBindingHash: `sha256:${string}`;
    operation: "get" | "prepare" | "submit";
    nowMs: number;
  }>): Promise<void>;
  get(input: LateMigrationIntakeLookupV1):
    Promise<LateMigrationIntakeRecordV1 | null>;
  reserve(input: Readonly<{
    lookup: LateMigrationIntakeLookupV1;
    intent: LateMigrationIntakeIntentV1;
  }>): Promise<Readonly<{
    kind: "created" | "existing";
    record: LateMigrationIntakeRecordV1;
  }>>;
  claimSend(input: Readonly<{
    lookup: LateMigrationIntakeLookupV1;
    expectedRequestBindingHash: `sha256:${string}`;
    claim: LateMigrationIntakeSendClaimV1;
  }>): Promise<Readonly<{
    kind: "created" | "existing";
    record: LateMigrationIntakeRecordV1;
  }>>;
  advance(input: Readonly<{
    lookup: LateMigrationIntakeLookupV1;
    expectedRequestBindingHash: `sha256:${string}`;
    transition: LateMigrationIntakeTransitionV1;
  }>): Promise<LateMigrationIntakeRecordV1>;
  markSupport(input: Readonly<{
    lookup: LateMigrationIntakeLookupV1;
    expectedRequestBindingHash: `sha256:${string}`;
    support: LateMigrationIntakeSupportV1;
  }>): Promise<LateMigrationIntakeRecordV1>;
}

export class LateMigrationIntakeStoreErrorV1 extends Error {
  constructor(
    readonly code:
      | "budget_exhausted"
      | "conflict"
      | "rate_limited"
      | "unavailable",
    readonly retryAfterSeconds?: number,
  ) {
    super("Late migration intake store failed closed");
    this.name = "LateMigrationIntakeStoreErrorV1";
  }
}

type Row = Readonly<{
  credential_id: string;
  request_binding_hash: string;
  canonical_use: string;
}> & Record<string, unknown>;

type AttestedPool = ProjectionTargetPostgresPoolV1 & Readonly<{
  assertProductionReadiness(): Promise<void>;
}>;

export function createLateMigrationIntakeMemoryStoreV1():
LateMigrationIntakeStoreV1 {
  const records = new Map<string, LateMigrationIntakeRecordV1>();
  const admissions = new Map<string, number>();
  const dailyAdmissions = new Map<string, number>();
  const reservedTotals = new Map<string, bigint>();
  return Object.freeze({
    async admit(input) {
      validateAdmission(input);
      const prefix = admissionPrefix(input);
      const day = Math.floor(input.nowMs / 86_400_000);
      const dailyKey = `${prefix}day:${day}`;
      const dailyNext = (dailyAdmissions.get(dailyKey) ?? 0) + 1;
      if (dailyNext > dailyAdmissionLimit(input.operation)) {
        throw new LateMigrationIntakeStoreErrorV1("rate_limited", 86_400);
      }
      const bucket = Math.floor(input.nowMs / 60_000);
      const bucketKey = `${prefix}${bucket}`;
      const next = (admissions.get(bucketKey) ?? 0) + 1;
      if (next > admissionLimit(input.operation)) {
        throw new LateMigrationIntakeStoreErrorV1("rate_limited", 60);
      }
      admissions.set(bucketKey, next);
      dailyAdmissions.set(dailyKey, dailyNext);
    },
    async get(input) {
      validateLookup(input);
      return records.get(memoryKey(input)) ?? null;
    },
    async reserve(input) {
      validateLookup(input.lookup);
      const intent = validateIntent(input.intent, input.lookup);
      const key = memoryKey(input.lookup);
      const existing = records.get(key);
      if (existing) {
        assertSameIntent(existing.intent, intent);
        return Object.freeze({ kind: "existing" as const, record: existing });
      }
      const reservation = BigInt(intent.reservationWei);
      const reservedTotal = reservedTotals.get(intent.releaseId) ?? 0n;
      if (reservedTotal + reservation > BigInt(intent.totalBudgetWei)) {
        throw new LateMigrationIntakeStoreErrorV1("budget_exhausted");
      }
      const record = emptyRecord(intent);
      records.set(key, record);
      reservedTotals.set(intent.releaseId, reservedTotal + reservation);
      return Object.freeze({ kind: "created" as const, record });
    },
    async claimSend(input) {
      validateLookup(input.lookup);
      const record = requiredRecord(records.get(memoryKey(input.lookup)));
      assertExpected(record, input.expectedRequestBindingHash);
      const claim = validateSendClaim(input.claim);
      assertSendClaim(record, claim);
      if (record.sendClaim) {
        return Object.freeze({ kind: "existing" as const, record });
      }
      if (record.stage !== "signature_reserved" || record.support) {
        throw conflict();
      }
      const next = Object.freeze({ ...record, sendClaim: claim });
      records.set(memoryKey(input.lookup), next);
      return Object.freeze({ kind: "created" as const, record: next });
    },
    async advance(input) {
      validateLookup(input.lookup);
      const record = requiredRecord(records.get(memoryKey(input.lookup)));
      assertExpected(record, input.expectedRequestBindingHash);
      const next = appendTransition(record, validateTransition(input.transition));
      records.set(memoryKey(input.lookup), next);
      return next;
    },
    async markSupport(input) {
      validateLookup(input.lookup);
      const record = requiredRecord(records.get(memoryKey(input.lookup)));
      assertExpected(record, input.expectedRequestBindingHash);
      const next = appendSupport(record, validateSupport(input.support));
      records.set(memoryKey(input.lookup), next);
      return next;
    },
  } satisfies LateMigrationIntakeStoreV1);
}

export function createLateMigrationIntakePostgresStoreV1(
  pool: AttestedPool,
): LateMigrationIntakeStoreV1 {
  if (!pool || typeof pool.connect !== "function" ||
    typeof pool.assertProductionReadiness !== "function") {
    throw new TypeError("Late migration intake PostgreSQL pool is invalid");
  }
  return Object.freeze({
    async admit(input) {
      validateAdmission(input);
      await pool.assertProductionReadiness();
      await inTransaction(pool, walletLock(input), async (client) => {
        const dayStartBucket = Math.floor(input.nowMs / 86_400_000) * 1_440;
        const daily = await client.query<{ admission_count: string }>(
          `SELECT count(*)::text AS admission_count
             FROM programmable_website_projection_v1.credential_uses
            WHERE credential_id LIKE $1
              AND (canonical_use::jsonb ->> 'minuteBucket')::bigint >= $2
              AND (canonical_use::jsonb ->> 'minuteBucket')::bigint < $3`,
          [`${admissionPrefix(input)}%`, dayStartBucket, dayStartBucket + 1_440],
        );
        const count = daily.rows[0]?.admission_count;
        if (daily.rows.length !== 1 || !decimal(count) ||
          BigInt(count) >= BigInt(dailyAdmissionLimit(input.operation))) {
          throw new LateMigrationIntakeStoreErrorV1("rate_limited", 86_400);
        }
        const bucket = Math.floor(input.nowMs / 60_000);
        const ids = Array.from({ length: admissionLimit(input.operation) },
          (_unused, slot) => admissionId(input, bucket, slot));
        const occupied = new Set((await selectRows(client, ids))
          .map((row) => row.credential_id));
        const available = ids.find((id) => !occupied.has(id));
        if (!available) {
          throw new LateMigrationIntakeStoreErrorV1("rate_limited", 60);
        }
        await insertRow(client, available, input.principalBindingHash, {
          schema: "programmable-late-migration-intake-admission/v1",
          releaseId: input.releaseId,
          sourceAddress: input.sourceAddress,
          principalBindingHash: input.principalBindingHash,
          operation: input.operation,
          minuteBucket: String(bucket),
        });
      });
    },
    async get(input) {
      validateLookup(input);
      await pool.assertProductionReadiness();
      return recordFromRows(await selectRecordRows(pool, input), input);
    },
    async reserve(input) {
      validateLookup(input.lookup);
      const intent = validateIntent(input.intent, input.lookup);
      await pool.assertProductionReadiness();
      return inTransaction(pool, [budgetLock(input.lookup.releaseId),
        walletLock(input.lookup)], async (client) => {
        const existing = recordFromRows(
          await selectRecordRows(client, input.lookup), input.lookup);
        if (existing) {
          assertSameIntent(existing.intent, intent);
          return Object.freeze({ kind: "existing" as const, record: existing });
        }
        if ((await selectRows(client, [
          idempotencyId(input.lookup.releaseId,
            intent.idempotencyBindingHash),
        ])).length !== 0) throw conflict();
        const budget = await readReservedBudget(client, input.lookup.releaseId);
        if (budget + BigInt(intent.reservationWei) >
          BigInt(intent.totalBudgetWei)) {
          throw new LateMigrationIntakeStoreErrorV1("budget_exhausted");
        }
        await insertRow(client, intentId(input.lookup),
          intent.requestBindingHash, intent);
        await insertRow(client, idempotencyId(input.lookup.releaseId,
          intent.idempotencyBindingHash), intent.requestBindingHash, {
          schema: "programmable-late-migration-intake-idempotency/v1",
          sourceAddress: intent.sourceAddress,
          requestBindingHash: intent.requestBindingHash,
        });
        return Object.freeze({
          kind: "created" as const,
          record: emptyRecord(intent),
        });
      });
    },
    async claimSend(input) {
      validateLookup(input.lookup);
      const claim = validateSendClaim(input.claim);
      await pool.assertProductionReadiness();
      return inTransaction(pool, walletLock(input.lookup), async (client) => {
        const record = requiredRecord(recordFromRows(
          await selectRecordRows(client, input.lookup), input.lookup));
        assertExpected(record, input.expectedRequestBindingHash);
        assertSendClaim(record, claim);
        if (record.sendClaim) {
          return Object.freeze({ kind: "existing" as const, record });
        }
        if (record.stage !== "signature_reserved" || record.support) {
          throw conflict();
        }
        await insertRow(client, sendClaimId(input.lookup),
          record.intent.requestBindingHash, claim);
        return Object.freeze({ kind: "created" as const,
          record: Object.freeze({ ...record, sendClaim: claim }) });
      });
    },
    async advance(input) {
      validateLookup(input.lookup);
      const transition = validateTransition(input.transition);
      await pool.assertProductionReadiness();
      return inTransaction(pool, walletLock(input.lookup), async (client) => {
        const record = requiredRecord(recordFromRows(
          await selectRecordRows(client, input.lookup), input.lookup));
        assertExpected(record, input.expectedRequestBindingHash);
        const existing = record.transitions.find(
          (candidate) => candidate.stage === transition.stage);
        if (existing) {
          if (canonicalizeJson(existing) !== canonicalizeJson(transition)) {
            throw conflict();
          }
          return record;
        }
        const next = appendTransition(record, transition);
        await insertRow(client, transitionId(input.lookup, transition.stage),
          record.intent.requestBindingHash, transition);
        return next;
      });
    },
    async markSupport(input) {
      validateLookup(input.lookup);
      const support = validateSupport(input.support);
      await pool.assertProductionReadiness();
      return inTransaction(pool, walletLock(input.lookup), async (client) => {
        const record = requiredRecord(recordFromRows(
          await selectRecordRows(client, input.lookup), input.lookup));
        assertExpected(record, input.expectedRequestBindingHash);
        if (record.support) {
          if (canonicalizeJson(record.support) !== canonicalizeJson(support)) {
            throw conflict();
          }
          return record;
        }
        const next = appendSupport(record, support);
        await insertRow(client, supportId(input.lookup),
          record.intent.requestBindingHash, support);
        return next;
      });
    },
  } satisfies LateMigrationIntakeStoreV1);
}

function emptyRecord(intent: LateMigrationIntakeIntentV1):
LateMigrationIntakeRecordV1 {
  return Object.freeze({
    intent,
    stage: "signature_reserved" as const,
    transitions: Object.freeze([] as LateMigrationIntakeTransitionV1[]),
    sendClaim: null,
    support: null,
  });
}

function appendTransition(
  record: LateMigrationIntakeRecordV1,
  transition: LateMigrationIntakeTransitionV1,
) {
  const existing = record.transitions.find(
    (candidate) => candidate.stage === transition.stage);
  if (existing) {
    if (canonicalizeJson(existing) !== canonicalizeJson(transition)) {
      throw conflict();
    }
    return record;
  }
  const current = LATE_MIGRATION_INTAKE_STAGES_V1.indexOf(record.stage);
  const next = LATE_MIGRATION_INTAKE_STAGES_V1.indexOf(transition.stage);
  if (next !== current + 1) throw conflict();
  const previous = record.transitions.at(-1);
  if (transition.stage === "deposit_finalized") {
    const confirmed = previous?.stage === "deposit_confirmed" ? previous : null;
    // A pre-finality confirmation can be orphaned and later included elsewhere.
    // Keep that historical observation, but let freshly verified canonical
    // finality bind the same deposit identity to its actual final block/hash.
    if (!confirmed || confirmed.depositId !== transition.depositId) throw conflict();
  }
  return Object.freeze({
    ...record,
    stage: transition.stage,
    transitions: Object.freeze([...record.transitions, transition]),
  });
}

function appendSupport(
  record: LateMigrationIntakeRecordV1,
  support: LateMigrationIntakeSupportV1,
) {
  if (record.support) {
    if (canonicalizeJson(record.support) !== canonicalizeJson(support)) {
      throw conflict();
    }
    return record;
  }
  return Object.freeze({ ...record, support });
}

function validateIntent(
  input: LateMigrationIntakeIntentV1,
  lookup: LateMigrationIntakeLookupV1,
) {
  if (!input || input.schema !==
    "programmable-late-migration-intake-intent/v1" ||
    input.releaseId !== lookup.releaseId ||
    !sameAddress(input.sourceAddress, lookup.sourceAddress) ||
    !Number.isSafeInteger(input.offerIndex) || input.offerIndex < 0 ||
    !POSITIVE_DECIMAL.test(input.grossAmountRaw) ||
    !POSITIVE_DECIMAL.test(input.manualPayoutAmountRaw) ||
    !isAddress(input.sourceContractAddress, { strict: true }) ||
    !isAddress(input.relayerAddress, { strict: true }) ||
    !DECIMAL.test(input.permitNonce) ||
    !POSITIVE_DECIMAL.test(input.permitDeadline) ||
    !SIGNATURE.test(input.permitSignature) ||
    !POSITIVE_DECIMAL.test(input.depositGasLimit) ||
    !POSITIVE_DECIMAL.test(input.maxFeePerGasWei) ||
    !DECIMAL.test(input.maxPriorityFeePerGasWei) ||
    !POSITIVE_DECIMAL.test(input.reservationWei) ||
    !POSITIVE_DECIMAL.test(input.totalBudgetWei) ||
    !DIGEST.test(input.principalBindingHash) ||
    !DIGEST.test(input.idempotencyBindingHash) ||
    !DIGEST.test(input.requestBindingHash) ||
    !DIGEST.test(input.transactionBindingHash) ||
    !SAFE_REFERENCE.test(input.providerIdempotencyKey) ||
    !SAFE_REFERENCE.test(input.providerReferenceId) ||
    !validIso(input.reservedAt) ||
    BigInt(input.manualPayoutAmountRaw) !==
      BigInt(input.grossAmountRaw) * 8_000n / 10_000n ||
    BigInt(input.maxPriorityFeePerGasWei) > BigInt(input.maxFeePerGasWei) ||
    BigInt(input.reservationWei) !== BigInt(input.depositGasLimit) *
      BigInt(input.maxFeePerGasWei) ||
    BigInt(input.reservationWei) > BigInt(input.totalBudgetWei)) {
    throw conflict();
  }
  exactKeys(input, ["schema", "releaseId", "sourceAddress", "offerIndex",
    "grossAmountRaw", "manualPayoutAmountRaw", "sourceContractAddress",
    "relayerAddress", "permitNonce", "permitDeadline", "permitSignature",
    "depositGasLimit", "maxFeePerGasWei", "maxPriorityFeePerGasWei",
    "reservationWei", "totalBudgetWei", "principalBindingHash",
    "idempotencyBindingHash", "requestBindingHash", "transactionBindingHash",
    "providerIdempotencyKey", "providerReferenceId", "reservedAt"]);
  return Object.freeze({ ...input,
    sourceAddress: getAddress(input.sourceAddress),
    sourceContractAddress: getAddress(input.sourceContractAddress),
    relayerAddress: getAddress(input.relayerAddress),
  });
}

function validateTransition(input: LateMigrationIntakeTransitionV1) {
  if (!input || input.schema !==
    "programmable-late-migration-intake-transition/v1" ||
    !LATE_MIGRATION_INTAKE_STAGES_V1.includes(input.stage) ||
    !HASH.test(input.transactionHash)) {
    throw conflict();
  }
  if (input.stage === "deposit_submitted") {
    exactKeys(input, ["schema", "stage", "transactionHash"]);
  } else if (input.stage === "deposit_confirmed") {
    exactKeys(input, ["schema", "stage", "transactionHash", "blockNumber",
      "blockHash", "depositId", "logIndex"]);
    if (!POSITIVE_DECIMAL.test(input.blockNumber) ||
      !HASH.test(input.blockHash) || !HASH.test(input.depositId) ||
      !Number.isSafeInteger(input.logIndex) || input.logIndex < 0) throw conflict();
  } else {
    exactKeys(input, ["schema", "stage", "transactionHash", "blockNumber",
      "blockHash", "depositId", "logIndex", "finalizedBlockNumberA",
      "finalizedBlockNumberB"]);
    if (!POSITIVE_DECIMAL.test(input.blockNumber) ||
      !HASH.test(input.blockHash) || !HASH.test(input.depositId) ||
      !Number.isSafeInteger(input.logIndex) || input.logIndex < 0 ||
      !POSITIVE_DECIMAL.test(input.finalizedBlockNumberA) ||
      !POSITIVE_DECIMAL.test(input.finalizedBlockNumberB) ||
      BigInt(input.finalizedBlockNumberA) < BigInt(input.blockNumber) ||
      BigInt(input.finalizedBlockNumberB) < BigInt(input.blockNumber)) {
      throw conflict();
    }
  }
  return Object.freeze(input);
}

function validateSendClaim(input: LateMigrationIntakeSendClaimV1) {
  if (!input || input.schema !==
    "programmable-late-migration-intake-send-claim/v1" ||
    !DIGEST.test(input.transactionBindingHash) ||
    !SAFE_REFERENCE.test(input.providerReferenceId) ||
    !validIso(input.claimedAt)) throw conflict();
  exactKeys(input, ["schema", "transactionBindingHash",
    "providerReferenceId", "claimedAt"]);
  return Object.freeze(input);
}

function validateSupport(input: LateMigrationIntakeSupportV1) {
  if (!input || input.schema !==
    "programmable-late-migration-intake-support/v1" ||
    !["provider_terminal_failure", "provider_replacement_unresolved",
      "permit_expired_before_submission", "submission_outcome_unknown",
      "confirmation_reorged"].includes(input.reason) ||
    !validIso(input.markedAt)) throw conflict();
  exactKeys(input, ["schema", "reason", "markedAt"]);
  return Object.freeze(input);
}

function recordFromRows(
  rows: readonly Row[], lookup: LateMigrationIntakeLookupV1,
): LateMigrationIntakeRecordV1 | null {
  const intents = rows.filter((row) => row.credential_id === intentId(lookup));
  if (intents.length === 0) {
    if (rows.length !== 0) throw unavailable();
    return null;
  }
  if (intents.length !== 1) throw unavailable();
  const intent = validateIntent(parseJson(intents[0].canonical_use) as
    LateMigrationIntakeIntentV1, lookup);
  if (intents[0].request_binding_hash !== intent.requestBindingHash) {
    throw unavailable();
  }
  const transitions = rows
    .filter((row) => row.credential_id.startsWith(`${transitionPrefix(lookup)}`))
    .map((row) => {
      const transition = validateTransition(parseJson(row.canonical_use) as
        LateMigrationIntakeTransitionV1);
      if (row.credential_id !== transitionId(lookup, transition.stage) ||
        row.request_binding_hash !== intent.requestBindingHash) {
        throw unavailable();
      }
      return transition;
    })
    .sort((left, right) => LATE_MIGRATION_INTAKE_STAGES_V1.indexOf(left.stage) -
      LATE_MIGRATION_INTAKE_STAGES_V1.indexOf(right.stage));
  const sendRows = rows.filter((row) => row.credential_id === sendClaimId(lookup));
  const supportRows = rows.filter((row) => row.credential_id === supportId(lookup));
  if (sendRows.length > 1 || supportRows.length > 1) throw unavailable();
  if ((sendRows[0] && sendRows[0].request_binding_hash !==
      intent.requestBindingHash) ||
    (supportRows[0] && supportRows[0].request_binding_hash !==
      intent.requestBindingHash)) throw unavailable();
  let record = emptyRecord(intent);
  if (sendRows[0]) record = Object.freeze({ ...record,
    sendClaim: validateSendClaim(parseJson(sendRows[0].canonical_use) as
      LateMigrationIntakeSendClaimV1) });
  if (record.sendClaim) assertSendClaim(record, record.sendClaim);
  for (const transition of transitions) record = appendTransition(record, transition);
  if (supportRows[0]) record = appendSupport(record,
    validateSupport(parseJson(supportRows[0].canonical_use) as
      LateMigrationIntakeSupportV1));
  return record;
}

async function selectRecordRows(
  queryable: Pick<ProjectionTargetPostgresClientV1, "query">,
  lookup: LateMigrationIntakeLookupV1,
) {
  const result = await queryable.query<Row>(
    `SELECT credential_id, request_binding_hash, canonical_use
       FROM programmable_website_projection_v1.credential_uses
      WHERE credential_id = $1 OR credential_id LIKE $2 OR
            credential_id = $3 OR credential_id = $4
      ORDER BY credential_id`,
    [intentId(lookup), `${transitionPrefix(lookup)}%`, sendClaimId(lookup),
      supportId(lookup)],
  );
  return result.rows;
}

async function readReservedBudget(
  client: ProjectionTargetPostgresClientV1, releaseId: string,
) {
  const result = await client.query<{ reserved: string }>(
    `SELECT COALESCE(sum((canonical_use::jsonb ->> 'reservationWei')::numeric),
                    0)::text AS reserved
       FROM programmable_website_projection_v1.credential_uses
      WHERE credential_id LIKE $1`,
    [`${PREFIX}:intent:${releaseId}:%`],
  );
  const value = result.rows[0]?.reserved;
  if (result.rows.length !== 1 || !DECIMAL.test(value ?? "")) {
    throw unavailable();
  }
  return BigInt(value!);
}

async function selectRows(
  client: ProjectionTargetPostgresClientV1, ids: readonly string[],
) {
  if (ids.length === 0) return [] as Row[];
  const result = await client.query<Row>(
    `SELECT credential_id, request_binding_hash, canonical_use
       FROM programmable_website_projection_v1.credential_uses
      WHERE credential_id = ANY($1::text[])`, [ids]);
  return result.rows;
}

async function insertRow(
  client: ProjectionTargetPostgresClientV1,
  credentialId: string,
  requestBindingHash: string,
  value: JsonValue,
) {
  const result = await client.query<Row>(
    `INSERT INTO programmable_website_projection_v1.credential_uses
       (credential_id, request_binding_hash, canonical_use)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING credential_id, request_binding_hash, canonical_use`,
    [credentialId, requestBindingHash, canonicalizeJson(value)],
  );
  if (result.rowCount !== 1) throw conflict();
}

async function inTransaction<T>(
  pool: ProjectionTargetPostgresPoolV1,
  lockNames: string | readonly string[],
  work: (client: ProjectionTargetPostgresClientV1) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const name of [...new Set(typeof lockNames === "string"
      ? [lockNames] : lockNames)].sort()) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [name]);
    }
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof LateMigrationIntakeStoreErrorV1) throw error;
    throw unavailable();
  } finally {
    client.release();
  }
}

function parseJson(source: string): JsonValue {
  try {
    return parseStrictJson(source, { maximumBytes: 131_072, maximumDepth: 8 });
  } catch {
    throw unavailable();
  }
}

function requiredRecord(record: LateMigrationIntakeRecordV1 | null | undefined) {
  if (!record) throw unavailable();
  return record;
}

function assertExpected(
  record: LateMigrationIntakeRecordV1,
  requestBindingHash: `sha256:${string}`,
) {
  if (record.intent.requestBindingHash !== requestBindingHash) throw conflict();
}

function assertSendClaim(record: LateMigrationIntakeRecordV1,
  claim: LateMigrationIntakeSendClaimV1) {
  if (claim.transactionBindingHash !== record.intent.transactionBindingHash ||
    claim.providerReferenceId !== record.intent.providerReferenceId) {
    throw conflict();
  }
}

function assertSameIntent(
  left: LateMigrationIntakeIntentV1,
  right: LateMigrationIntakeIntentV1,
) {
  if (left.requestBindingHash !== right.requestBindingHash ||
    left.idempotencyBindingHash !== right.idempotencyBindingHash ||
    canonicalizeJson({ ...left, reservedAt: right.reservedAt }) !==
      canonicalizeJson(right)) throw conflict();
}

function validateLookup(input: LateMigrationIntakeLookupV1) {
  if (!input || !SAFE_RELEASE_ID.test(input.releaseId) ||
    !isAddress(input.sourceAddress, { strict: true })) {
    throw new TypeError("Late migration intake lookup is invalid");
  }
}

function validateAdmission(input: Readonly<{
  releaseId: string;
  sourceAddress: Address;
  principalBindingHash: `sha256:${string}`;
  operation: "get" | "prepare" | "submit";
  nowMs: number;
}>) {
  if (!SAFE_RELEASE_ID.test(input.releaseId) ||
    !isAddress(input.sourceAddress, { strict: true }) ||
    !DIGEST.test(input.principalBindingHash) ||
    !["get", "prepare", "submit"].includes(input.operation) ||
    !Number.isSafeInteger(input.nowMs) || input.nowMs <= 0) {
    throw new TypeError("Late migration intake admission is invalid");
  }
}

function admissionLimit(operation: "get" | "prepare" | "submit") {
  return operation === "get" ? 30 : operation === "prepare" ? 5 : 3;
}

function dailyAdmissionLimit(operation: "get" | "prepare" | "submit") {
  return operation === "get" ? 20_000 : operation === "prepare" ? 128 : 32;
}

function baseAddress(input: LateMigrationIntakeLookupV1) {
  return input.sourceAddress.toLowerCase().slice(2);
}
function memoryKey(input: LateMigrationIntakeLookupV1) {
  return `${input.releaseId}:${input.sourceAddress.toLowerCase()}`;
}
function intentId(input: LateMigrationIntakeLookupV1) {
  return `${PREFIX}:intent:${input.releaseId}:${baseAddress(input)}`;
}
function transitionPrefix(input: LateMigrationIntakeLookupV1) {
  return `${PREFIX}:transition:${input.releaseId}:${baseAddress(input)}:`;
}
function transitionId(input: LateMigrationIntakeLookupV1,
  stage: LateMigrationIntakeTransitionV1["stage"]) {
  return `${transitionPrefix(input)}${stage}`;
}
function sendClaimId(input: LateMigrationIntakeLookupV1) {
  return `${PREFIX}:send:${input.releaseId}:${baseAddress(input)}`;
}
function supportId(input: LateMigrationIntakeLookupV1) {
  return `${PREFIX}:support:${input.releaseId}:${baseAddress(input)}`;
}
function walletLock(input: LateMigrationIntakeLookupV1) {
  return `${PREFIX}:wallet:${input.releaseId}:${baseAddress(input)}`;
}
function budgetLock(releaseId: string) {
  return `${PREFIX}:budget:${releaseId}`;
}
function idempotencyId(releaseId: string, digest: `sha256:${string}`) {
  return `${PREFIX}:idempotency:${releaseId}:${digest.slice(7)}`;
}
function admissionPrefix(input: Readonly<{
  releaseId: string; sourceAddress: Address;
  operation: "get" | "prepare" | "submit";
}>) {
  return `${PREFIX}:admit:${input.releaseId}:` +
    `${input.sourceAddress.toLowerCase().slice(2)}:${input.operation}:`;
}
function admissionId(input: Parameters<LateMigrationIntakeStoreV1["admit"]>[0],
  bucket: number, slot: number) {
  return `${admissionPrefix(input)}${bucket}:${slot}`;
}

function exactKeys(value: object, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length ||
    actual.some((key, index) => key !== sorted[index])) throw conflict();
}
function sameAddress(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}
function validIso(value: string) {
  if (typeof value !== "string" || value.length > 64) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value;
}
function decimal(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}
function conflict(): LateMigrationIntakeStoreErrorV1 {
  return new LateMigrationIntakeStoreErrorV1("conflict");
}
function unavailable(): LateMigrationIntakeStoreErrorV1 {
  return new LateMigrationIntakeStoreErrorV1("unavailable");
}

let productionStore: LateMigrationIntakeStoreV1 | null = null;

export function getProductionLateMigrationIntakeStoreV1() {
  if (productionStore) return productionStore;
  const pool = createProductionProjectionTargetPostgresPoolV1(
    requiredEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"),
    requiredEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM")
      .replaceAll("\\n", "\n"),
    requiredEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE"),
  );
  productionStore = createLateMigrationIntakePostgresStoreV1(pool);
  return productionStore;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}
