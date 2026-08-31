import "server-only";

import { getAddress, isAddress, type Address, type Hex } from "viem";

import { MAIN_TOKEN_TOTAL_SUPPLY_RAW } from "@/lib/main-token-migration";
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

export const MAIN_TOKEN_MIGRATION_GASLESS_PREFIX_V1 =
  "main-token-migration-gasless-transfer:v1";
const PREFIX = MAIN_TOKEN_MIGRATION_GASLESS_PREFIX_V1;
const SHARED_BUDGET_PREFIX = "main-token-migration-gas-sponsor:v1";
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const SIGNATURE = /^0x[0-9a-f]{130}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const SAFE_RELEASE_ID = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const SAFE_REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
export const MAIN_TOKEN_MIGRATION_GASLESS_MAX_RECOVERIES_V1 = 2;

type Row = Readonly<{
  credential_id: string;
  request_binding_hash: string;
  canonical_use: string;
}> & Record<string, unknown>;

type AttestedPool = ProjectionTargetPostgresPoolV1 & Readonly<{
  assertProductionReadiness(): Promise<void>;
}>;

export type MainTokenMigrationGaslessIntentV1 = Readonly<{
  schema: "programmable-main-token-migration-gasless-intent/v1";
  releaseId: string;
  walletAddress: Address;
  rootWalletAddress: Address;
  sponsorAddress: Address;
  amountRaw: string;
  nonce: string;
  permitDeadline: string;
  permitSignature: Hex;
  permitGasLimit: string;
  transferGasLimit: string;
  maxFeePerGasWei: string;
  maxPriorityFeePerGasWei: string;
  reservedTotalWei: string;
  totalBudgetWei: string;
  requestBindingHash: `sha256:${string}`;
  providerPermitIdempotencyKey: string;
  providerPermitReferenceId: string;
  providerTransferIdempotencyKey: string;
  providerTransferReferenceId: string;
  reservedAt: string;
}>;

export type MainTokenMigrationGaslessRecordV1 = Readonly<{
  intent: MainTokenMigrationGaslessIntentV1;
  permitTransactionHash: Hex | null;
  transferTransactionHash: Hex | null;
  recoveryAttempt?: number;
  previousRequestBindingHash?: `sha256:${string}`;
}>;

type CompletionKind = "permit" | "transfer";
type CompletionV1 = Readonly<{
  schema: "programmable-main-token-migration-gasless-completion/v1";
  kind: CompletionKind;
  providerReferenceId: string;
  transactionHash: Hex;
}>;

type AliasV1 = Readonly<{
  schema: "programmable-main-token-migration-gasless-idempotency/v1";
  holderCredentialId: string;
  requestBindingHash: `sha256:${string}`;
}>;

type RootGuardV1 = Readonly<{
  schema: "programmable-main-token-migration-gasless-root-guard/v1";
  holderCredentialId: string;
  rootWalletAddress: Address;
  walletAddress: Address;
  requestBindingHash: `sha256:${string}`;
}>;

type RecoveryEdgeV1 = Readonly<{
  schema: "programmable-main-token-migration-gasless-recovery/v1";
  recoveryAttempt: number;
  previousHolderCredentialId: string;
  holderCredentialId: string;
  previousRequestBindingHash: `sha256:${string}`;
  requestBindingHash: `sha256:${string}`;
  idempotencyBindingHash: `sha256:${string}`;
  recoveryProof: MainTokenMigrationGaslessRecoveryProofV1;
}>;

export type MainTokenMigrationGaslessRecoveryProofV1 = Readonly<{
  finalizedBlockNumber: string;
  finalizedBlockHash: Hex;
  finalizedBlockTimestamp: string;
  nonce: string;
  allowanceRaw: "0";
}>;

type Lookup = Readonly<{ releaseId: string; walletAddress: Address }>;
type ReserveInput = Readonly<{
  lookup: Lookup;
  idempotencyBindingHash: `sha256:${string}`;
  intent: MainTokenMigrationGaslessIntentV1;
}>;
type RecoverInput = ReserveInput & Readonly<{
  previousRequestBindingHash: `sha256:${string}`;
  recoveryProof: MainTokenMigrationGaslessRecoveryProofV1;
}>;
type CompleteInput = Readonly<{
  lookup: Lookup;
  kind: CompletionKind;
  providerReferenceId: string;
  transactionHash: Hex;
}>;

export interface MainTokenMigrationGaslessStoreV1 {
  get(input: Lookup): Promise<MainTokenMigrationGaslessRecordV1 | null>;
  reserve(input: Readonly<{
    lookup: Lookup;
    idempotencyBindingHash: `sha256:${string}`;
    intent: MainTokenMigrationGaslessIntentV1;
  }>): Promise<Readonly<{
    kind: "created" | "existing";
    record: MainTokenMigrationGaslessRecordV1;
  }>>;
  recover(input: RecoverInput): Promise<Readonly<{
    kind: "created" | "existing";
    record: MainTokenMigrationGaslessRecordV1;
  }>>;
  complete(input: Readonly<{
    lookup: Lookup;
    kind: CompletionKind;
    providerReferenceId: string;
    transactionHash: Hex;
  }>): Promise<MainTokenMigrationGaslessRecordV1>;
}

export class MainTokenMigrationGaslessStoreErrorV1 extends Error {
  constructor(readonly code: "budget_exhausted" | "conflict" | "unavailable") {
    super("Main token migration gasless transfer store failed closed");
    this.name = "MainTokenMigrationGaslessStoreErrorV1";
  }
}

export function parseMainTokenMigrationGaslessBudgetReservationV1(
  source: string,
) {
  const intent = parseIntentValue(parseCanonical(source));
  return Object.freeze({
    releaseId: intent.releaseId,
    reservedTotalWei: intent.reservedTotalWei,
    totalBudgetWei: intent.totalBudgetWei,
  });
}

export function mainTokenMigrationGaslessRootGuardIdV1(
  releaseId: string,
  rootWalletAddress: Address,
) {
  if (!SAFE_RELEASE_ID.test(releaseId) ||
    !isAddress(rootWalletAddress, { strict: true })) {
    throw new TypeError("Gasless migration root guard is invalid");
  }
  return rootId(releaseId, getAddress(rootWalletAddress));
}

export function createMainTokenMigrationGaslessPostgresStoreV1(
  pool: AttestedPool,
): MainTokenMigrationGaslessStoreV1 {
  if (!pool || typeof pool.connect !== "function" ||
    typeof pool.assertProductionReadiness !== "function") {
    throw new TypeError("Gasless migration PostgreSQL pool is invalid");
  }
  return Object.freeze({
    async get(input: Lookup) {
      validateLookup(input);
      await pool.assertProductionReadiness();
      const result = await pool.query<Row>(`
        SELECT credential_id, request_binding_hash, canonical_use
          FROM programmable_website_projection_v1.credential_uses
         WHERE credential_id = ANY($1::text[])
         ORDER BY credential_id
      `, [recordIds(input)]);
      return recordFromRows(result.rows, input);
    },

    async reserve(input: ReserveInput) {
      validateLookup(input.lookup);
      if (!DIGEST.test(input.idempotencyBindingHash)) {
        throw new TypeError("Gasless migration idempotency binding is invalid");
      }
      const intent = validateIntent(input.intent, input.lookup);
      await pool.assertProductionReadiness();
      return transaction(pool, input.lookup.releaseId, async (client) => {
        const holder = holderId(input.lookup);
        const alias = aliasId(input.lookup.releaseId, input.idempotencyBindingHash);
        const root = rootId(input.lookup.releaseId, intent.rootWalletAddress);
        const existing = await selectRows(client, [
          ...recordIds(input.lookup),
          alias,
          root,
        ]);
        const existingRecord = recordFromRows(existing, input.lookup);
        const aliasRow = existing.find((row) => row.credential_id === alias);
        const rootRow = existing.find((row) => row.credential_id === root);
        if (existingRecord) {
          if (existingRecord.recoveryAttempt || existingRecord.intent.requestBindingHash !==
            intent.requestBindingHash || !aliasRow || !rootRow) throw conflict();
          const parsedAlias = parseAlias(aliasRow);
          const parsedRoot = parseRootGuard(rootRow);
          if (parsedAlias.holderCredentialId !== holder ||
            parsedAlias.requestBindingHash !== intent.requestBindingHash ||
            !rootGuardMatches(parsedRoot, intent, holder)) throw conflict();
          return Object.freeze({
            kind: "existing" as const,
            record: existingRecord,
          });
        }
        if (aliasRow || rootRow) throw conflict();
        const reserved = await readSharedReservedBudget(client, input.lookup.releaseId);
        if (reserved + BigInt(intent.reservedTotalWei) >
          BigInt(intent.totalBudgetWei)) throw budgetExhausted();
        await insertRow(client, holder, intent.requestBindingHash, intent);
        await insertRow(client, alias, intent.requestBindingHash, {
          schema: "programmable-main-token-migration-gasless-idempotency/v1",
          holderCredentialId: holder,
          requestBindingHash: intent.requestBindingHash,
        } satisfies AliasV1);
        await insertRow(client, root, intent.requestBindingHash, {
          schema: "programmable-main-token-migration-gasless-root-guard/v1",
          holderCredentialId: holder,
          rootWalletAddress: intent.rootWalletAddress,
          walletAddress: intent.walletAddress,
          requestBindingHash: intent.requestBindingHash,
        } satisfies RootGuardV1);
        return Object.freeze({
          kind: "created" as const,
          record: Object.freeze({
            intent,
            permitTransactionHash: null,
            transferTransactionHash: null,
          }),
        });
      });
    },

    async recover(input: RecoverInput) {
      validateLookup(input.lookup);
      if (!DIGEST.test(input.idempotencyBindingHash) ||
        !DIGEST.test(input.previousRequestBindingHash)) {
        throw new TypeError("Gasless migration recovery binding is invalid");
      }
      const intent = validateIntent(input.intent, input.lookup);
      await pool.assertProductionReadiness();
      return transaction(pool, input.lookup.releaseId, async (client) => {
        const alias = aliasId(input.lookup.releaseId, input.idempotencyBindingHash);
        const root = rootId(input.lookup.releaseId, intent.rootWalletAddress);
        const rows = await selectRows(client, [...recordIds(input.lookup), alias, root]);
        const current = recordFromRows(rows, input.lookup);
        if (!current) throw conflict();
        const base = rows.find((row) => row.credential_id === holderId(input.lookup));
        const rootRow = rows.find((row) => row.credential_id === root);
        if (!base || !rootRow ||
          !rootGuardMatches(parseRootGuard(rootRow), parseIntent(base), holderId(input.lookup))) {
          throw unavailable();
        }
        const aliasRow = rows.find((row) => row.credential_id === alias);
        const attempt = current.recoveryAttempt ?? 0;
        if (current.intent.requestBindingHash === intent.requestBindingHash) {
          const edgeRow = rows.find((row) => row.credential_id === recoveryId(input.lookup, attempt));
          if (!attempt || !edgeRow || !aliasRow ||
            current.previousRequestBindingHash !== input.previousRequestBindingHash) throw conflict();
          const edge = parseRecoveryEdge(edgeRow);
          const parsedAlias = parseAlias(aliasRow);
          if (edge.idempotencyBindingHash !== input.idempotencyBindingHash ||
            parsedAlias.holderCredentialId !== holderId(input.lookup, attempt) ||
            parsedAlias.requestBindingHash !== intent.requestBindingHash ||
            canonicalizeJson(current.intent) !== canonicalizeJson(intent)) throw conflict();
          return Object.freeze({ kind: "existing" as const, record: current });
        }
        if (aliasRow || current.intent.requestBindingHash !== input.previousRequestBindingHash ||
          current.transferTransactionHash || attempt >= MAIN_TOKEN_MIGRATION_GASLESS_MAX_RECOVERIES_V1) {
          throw conflict();
        }
        assertRecoveryIntent(current.intent, intent);
        const recoveryProof = validateRecoveryProof(input.recoveryProof, current.intent, intent);
        const reserved = await readSharedReservedBudget(client, input.lookup.releaseId);
        if (reserved + BigInt(intent.reservedTotalWei) > BigInt(intent.totalBudgetWei)) {
          throw budgetExhausted();
        }
        const nextAttempt = attempt + 1;
        const holder = holderId(input.lookup, nextAttempt);
        const edge: RecoveryEdgeV1 = {
          schema: "programmable-main-token-migration-gasless-recovery/v1",
          recoveryAttempt: nextAttempt,
          previousHolderCredentialId: holderId(input.lookup, attempt),
          holderCredentialId: holder,
          previousRequestBindingHash: current.intent.requestBindingHash,
          requestBindingHash: intent.requestBindingHash,
          idempotencyBindingHash: input.idempotencyBindingHash,
          recoveryProof,
        };
        await insertRow(client, holder, intent.requestBindingHash, intent);
        await insertRow(client, recoveryId(input.lookup, nextAttempt), intent.requestBindingHash, edge);
        await insertRow(client, alias, intent.requestBindingHash, {
          schema: "programmable-main-token-migration-gasless-idempotency/v1",
          holderCredentialId: holder,
          requestBindingHash: intent.requestBindingHash,
        } satisfies AliasV1);
        return Object.freeze({
          kind: "created" as const,
          record: Object.freeze({
            intent,
            permitTransactionHash: null,
            transferTransactionHash: null,
            recoveryAttempt: nextAttempt,
            previousRequestBindingHash: current.intent.requestBindingHash,
          }),
        });
      });
    },

    async complete(input: CompleteInput) {
      validateLookup(input.lookup);
      if ((input.kind !== "permit" && input.kind !== "transfer") ||
        !SAFE_REFERENCE_ID.test(input.providerReferenceId) ||
        !HASH.test(input.transactionHash)) {
        throw new TypeError("Gasless migration completion is invalid");
      }
      await pool.assertProductionReadiness();
      return transaction(pool, input.lookup.releaseId, async (client) => {
        const rows = await selectRows(client, recordIds(input.lookup));
        const record = recordFromRows(rows, input.lookup);
        if (!record) throw unavailable();
        const expectedReference = input.kind === "permit"
          ? record.intent.providerPermitReferenceId
          : record.intent.providerTransferReferenceId;
        if (expectedReference !== input.providerReferenceId ||
          (input.kind === "transfer" && !record.permitTransactionHash)) {
          throw unavailable();
        }
        const currentHash = input.kind === "permit"
          ? record.permitTransactionHash
          : record.transferTransactionHash;
        if (currentHash) {
          if (currentHash !== input.transactionHash) throw conflict();
          return record;
        }
        const completion: CompletionV1 = {
          schema: "programmable-main-token-migration-gasless-completion/v1",
          kind: input.kind,
          providerReferenceId: input.providerReferenceId,
          transactionHash: input.transactionHash,
        };
        await insertRow(
          client,
          completionId(input.lookup, input.kind, record.recoveryAttempt),
          record.intent.requestBindingHash,
          completion,
        );
        return Object.freeze({
          ...record,
          permitTransactionHash: input.kind === "permit"
            ? input.transactionHash
            : record.permitTransactionHash,
          transferTransactionHash: input.kind === "transfer"
            ? input.transactionHash
            : record.transferTransactionHash,
        });
      });
    },
  });
}

async function transaction<T>(
  pool: AttestedPool,
  releaseId: string,
  work: (client: ProjectionTargetPostgresClientV1) => Promise<T>,
) {
  const client = await pool.connect();
  let open = false;
  try {
    await client.query("BEGIN");
    open = true;
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${SHARED_BUDGET_PREFIX}:lock:${releaseId}`],
    );
    const result = await work(client);
    await client.query("COMMIT");
    open = false;
    return result;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof MainTokenMigrationGaslessStoreErrorV1) throw error;
    throw unavailable();
  } finally {
    client.release();
  }
}

async function readSharedReservedBudget(
  client: ProjectionTargetPostgresClientV1,
  releaseId: string,
) {
  const result = await client.query<{ reserved_wei: string }>(`
    SELECT coalesce(sum(
      (canonical_use::jsonb ->> 'reservedTotalWei')::numeric
    ), 0)::text AS reserved_wei
      FROM programmable_website_projection_v1.credential_uses
     WHERE credential_id LIKE $1 OR credential_id LIKE $2
  `, [
    `${SHARED_BUDGET_PREFIX}:holder:${releaseId}:%`,
    `${PREFIX}:holder:${releaseId}:%`,
  ]);
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row || !DECIMAL.test(row.reserved_wei)) {
    throw unavailable();
  }
  return BigInt(row.reserved_wei);
}

async function selectRows(
  client: ProjectionTargetPostgresClientV1,
  ids: string[],
) {
  const result = await client.query<Row>(`
    SELECT credential_id, request_binding_hash, canonical_use
      FROM programmable_website_projection_v1.credential_uses
     WHERE credential_id = ANY($1::text[])
     ORDER BY credential_id
  `, [ids]);
  return result.rows;
}

async function insertRow(
  client: ProjectionTargetPostgresClientV1,
  credentialId: string,
  requestBindingHash: string,
  value: JsonValue,
) {
  const result = await client.query<Row>(`
    INSERT INTO programmable_website_projection_v1.credential_uses
      (credential_id, request_binding_hash, canonical_use)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
    RETURNING credential_id, request_binding_hash, canonical_use
  `, [credentialId, requestBindingHash, canonicalizeJson(value)]);
  if (result.rowCount !== 1) throw conflict();
}

function recordFromRows(rows: readonly Row[], lookup: Lookup) {
  let record: MainTokenMigrationGaslessRecordV1 | null = null;
  let chainEnded = false;
  for (let attempt = 0; attempt <= MAIN_TOKEN_MIGRATION_GASLESS_MAX_RECOVERIES_V1; attempt++) {
    const holder = rows.find((row) => row.credential_id === holderId(lookup, attempt));
    const edgeRow = attempt
      ? rows.find((row) => row.credential_id === recoveryId(lookup, attempt))
      : undefined;
    const hasCompletion = ["permit", "transfer"].some((kind) => rows.some((row) =>
      row.credential_id === completionId(lookup, kind as CompletionKind, attempt)));
    if (!holder) {
      if (edgeRow || hasCompletion) throw unavailable();
      chainEnded = true;
      continue;
    }
    if (chainEnded) throw unavailable();
    const intent = parseIntent(holder);
    if (intent.releaseId !== lookup.releaseId ||
      intent.walletAddress.toLowerCase() !== lookup.walletAddress.toLowerCase() ||
      holder.request_binding_hash !== intent.requestBindingHash) throw unavailable();
    let previousRequestBindingHash: `sha256:${string}` | undefined;
    if (attempt) {
      if (!record || !edgeRow || record.transferTransactionHash) throw unavailable();
      const edge = parseRecoveryEdge(edgeRow);
      if (edge.recoveryAttempt !== attempt ||
        edge.holderCredentialId !== holderId(lookup, attempt) ||
        edge.previousHolderCredentialId !== holderId(lookup, attempt - 1) ||
        edge.previousRequestBindingHash !== record.intent.requestBindingHash ||
        edge.requestBindingHash !== intent.requestBindingHash) throw unavailable();
      assertRecoveryIntent(record.intent, intent);
      validateRecoveryProof(edge.recoveryProof, record.intent, intent);
      previousRequestBindingHash = record.intent.requestBindingHash;
    }
    const permit = completionFromRows(rows, lookup, "permit", intent, attempt);
    const transfer = completionFromRows(rows, lookup, "transfer", intent, attempt);
    if (transfer && !permit) throw unavailable();
    record = Object.freeze({
      intent,
      permitTransactionHash: permit?.transactionHash ?? null,
      transferTransactionHash: transfer?.transactionHash ?? null,
      ...(attempt ? { recoveryAttempt: attempt, previousRequestBindingHash } : {}),
    });
  }
  return record;
}

function completionFromRows(
  rows: readonly Row[],
  lookup: Lookup,
  kind: CompletionKind,
  intent: MainTokenMigrationGaslessIntentV1,
  attempt = 0,
) {
  const row = rows.find((candidate) =>
    candidate.credential_id === completionId(lookup, kind, attempt));
  if (!row) return null;
  const completion = parseCompletion(row);
  const reference = kind === "permit"
    ? intent.providerPermitReferenceId
    : intent.providerTransferReferenceId;
  if (completion.kind !== kind || completion.providerReferenceId !== reference ||
    row.request_binding_hash !== intent.requestBindingHash) throw unavailable();
  return completion;
}

function assertRecoveryIntent(
  previous: MainTokenMigrationGaslessIntentV1,
  next: MainTokenMigrationGaslessIntentV1,
) {
  for (const key of ["releaseId", "walletAddress", "rootWalletAddress", "sponsorAddress",
    "amountRaw", "nonce", "totalBudgetWei"] as const) {
    if (previous[key] !== next[key]) throw conflict();
  }
  const oldReferences = new Set([
    previous.providerPermitIdempotencyKey, previous.providerPermitReferenceId,
    previous.providerTransferIdempotencyKey, previous.providerTransferReferenceId,
  ]);
  const newReferences = [next.providerPermitIdempotencyKey, next.providerPermitReferenceId,
    next.providerTransferIdempotencyKey, next.providerTransferReferenceId];
  if (BigInt(next.permitDeadline) <= BigInt(previous.permitDeadline) ||
    next.requestBindingHash === previous.requestBindingHash ||
    next.permitSignature === previous.permitSignature ||
    newReferences.some((reference) => oldReferences.has(reference)) ||
    next.providerPermitIdempotencyKey === next.providerTransferIdempotencyKey ||
    next.providerPermitReferenceId === next.providerTransferReferenceId ||
    Date.parse(next.reservedAt) < Date.parse(previous.reservedAt)) throw conflict();
}

function validateRecoveryProof(
  input: MainTokenMigrationGaslessRecoveryProofV1,
  previous: MainTokenMigrationGaslessIntentV1,
  next: MainTokenMigrationGaslessIntentV1,
): MainTokenMigrationGaslessRecoveryProofV1 {
  const value = object(parseCanonical(canonicalizeJson(input)));
  exactKeys(value, ["finalizedBlockNumber", "finalizedBlockHash", "finalizedBlockTimestamp",
    "nonce", "allowanceRaw"]);
  if (!positiveDecimal(value.finalizedBlockNumber) ||
    typeof value.finalizedBlockHash !== "string" || !HASH.test(value.finalizedBlockHash) ||
    !positiveDecimal(value.finalizedBlockTimestamp) || !decimal(value.nonce) ||
    value.allowanceRaw !== "0" || value.nonce !== previous.nonce ||
    BigInt(value.finalizedBlockTimestamp) <= BigInt(previous.permitDeadline) ||
    BigInt(value.finalizedBlockTimestamp) >= BigInt(next.permitDeadline)) throw conflict();
  return Object.freeze({
    finalizedBlockNumber: value.finalizedBlockNumber,
    finalizedBlockHash: value.finalizedBlockHash as Hex,
    finalizedBlockTimestamp: value.finalizedBlockTimestamp,
    nonce: value.nonce,
    allowanceRaw: "0",
  });
}

function rootGuardMatches(
  guard: RootGuardV1,
  intent: MainTokenMigrationGaslessIntentV1,
  holder: string,
) {
  return guard.holderCredentialId === holder &&
    guard.requestBindingHash === intent.requestBindingHash &&
    guard.walletAddress === intent.walletAddress &&
    guard.rootWalletAddress === intent.rootWalletAddress;
}

function validateIntent(value: MainTokenMigrationGaslessIntentV1, lookup: Lookup) {
  const parsed = parseIntentValue(parseCanonical(canonicalizeJson(value)));
  if (parsed.releaseId !== lookup.releaseId ||
    parsed.walletAddress.toLowerCase() !== lookup.walletAddress.toLowerCase()) {
    throw new TypeError("Gasless migration intent lookup is invalid");
  }
  return parsed;
}

function parseIntent(row: Row) {
  return parseIntentValue(parseCanonical(row.canonical_use));
}

function parseIntentValue(input: JsonValue): MainTokenMigrationGaslessIntentV1 {
  const value = object(input);
  exactKeys(value, [
    "amountRaw", "maxFeePerGasWei", "maxPriorityFeePerGasWei", "nonce",
    "permitDeadline", "permitGasLimit", "permitSignature",
    "providerPermitIdempotencyKey", "providerPermitReferenceId",
    "providerTransferIdempotencyKey", "providerTransferReferenceId",
    "releaseId", "requestBindingHash", "reservedAt", "reservedTotalWei",
    "rootWalletAddress", "schema", "sponsorAddress", "totalBudgetWei",
    "transferGasLimit", "walletAddress",
  ]);
  if (value.schema !== "programmable-main-token-migration-gasless-intent/v1" ||
    typeof value.releaseId !== "string" || !SAFE_RELEASE_ID.test(value.releaseId) ||
    typeof value.walletAddress !== "string" ||
    !isAddress(value.walletAddress, { strict: true }) ||
    typeof value.rootWalletAddress !== "string" ||
    !isAddress(value.rootWalletAddress, { strict: true }) ||
    typeof value.sponsorAddress !== "string" ||
    !isAddress(value.sponsorAddress, { strict: true }) ||
    typeof value.permitSignature !== "string" || !SIGNATURE.test(value.permitSignature) ||
    !positiveDecimal(value.amountRaw) || !decimal(value.nonce) ||
    !positiveDecimal(value.permitDeadline) || !positiveDecimal(value.permitGasLimit) ||
    !positiveDecimal(value.transferGasLimit) || !positiveDecimal(value.maxFeePerGasWei) ||
    !decimal(value.maxPriorityFeePerGasWei) || !positiveDecimal(value.reservedTotalWei) ||
    !positiveDecimal(value.totalBudgetWei) ||
    typeof value.requestBindingHash !== "string" || !DIGEST.test(value.requestBindingHash) ||
    !reference(value.providerPermitIdempotencyKey) ||
    !reference(value.providerPermitReferenceId) ||
    !reference(value.providerTransferIdempotencyKey) ||
    !reference(value.providerTransferReferenceId) ||
    typeof value.reservedAt !== "string" ||
    new Date(value.reservedAt).toISOString() !== value.reservedAt) throw unavailable();
  const amountRaw = BigInt(value.amountRaw);
  const maxFee = BigInt(value.maxFeePerGasWei);
  const priority = BigInt(value.maxPriorityFeePerGasWei);
  const expectedReservation = (BigInt(value.permitGasLimit) +
    BigInt(value.transferGasLimit)) * maxFee;
  if (amountRaw > MAIN_TOKEN_TOTAL_SUPPLY_RAW || priority > maxFee ||
    expectedReservation !== BigInt(value.reservedTotalWei) ||
    expectedReservation > BigInt(value.totalBudgetWei)) throw unavailable();
  return Object.freeze({
    schema: value.schema,
    releaseId: value.releaseId,
    walletAddress: getAddress(value.walletAddress),
    rootWalletAddress: getAddress(value.rootWalletAddress),
    sponsorAddress: getAddress(value.sponsorAddress),
    amountRaw: value.amountRaw,
    nonce: value.nonce,
    permitDeadline: value.permitDeadline,
    permitSignature: value.permitSignature as Hex,
    permitGasLimit: value.permitGasLimit,
    transferGasLimit: value.transferGasLimit,
    maxFeePerGasWei: value.maxFeePerGasWei,
    maxPriorityFeePerGasWei: value.maxPriorityFeePerGasWei,
    reservedTotalWei: value.reservedTotalWei,
    totalBudgetWei: value.totalBudgetWei,
    requestBindingHash: value.requestBindingHash as `sha256:${string}`,
    providerPermitIdempotencyKey: value.providerPermitIdempotencyKey,
    providerPermitReferenceId: value.providerPermitReferenceId,
    providerTransferIdempotencyKey: value.providerTransferIdempotencyKey,
    providerTransferReferenceId: value.providerTransferReferenceId,
    reservedAt: value.reservedAt,
  });
}

function parseCompletion(row: Row): CompletionV1 {
  const value = object(parseCanonical(row.canonical_use));
  exactKeys(value, ["kind", "providerReferenceId", "schema", "transactionHash"]);
  if (value.schema !== "programmable-main-token-migration-gasless-completion/v1" ||
    (value.kind !== "permit" && value.kind !== "transfer") ||
    !reference(value.providerReferenceId) ||
    typeof value.transactionHash !== "string" || !HASH.test(value.transactionHash)) {
    throw unavailable();
  }
  return Object.freeze({
    schema: value.schema,
    kind: value.kind,
    providerReferenceId: value.providerReferenceId,
    transactionHash: value.transactionHash as Hex,
  });
}

function parseAlias(row: Row): AliasV1 {
  const value = object(parseCanonical(row.canonical_use));
  exactKeys(value, ["holderCredentialId", "requestBindingHash", "schema"]);
  if (value.schema !== "programmable-main-token-migration-gasless-idempotency/v1" ||
    typeof value.holderCredentialId !== "string" ||
    typeof value.requestBindingHash !== "string" ||
    !DIGEST.test(value.requestBindingHash) ||
    row.request_binding_hash !== value.requestBindingHash) throw unavailable();
  return value as AliasV1;
}

function parseRootGuard(row: Row): RootGuardV1 {
  const value = object(parseCanonical(row.canonical_use));
  exactKeys(value, ["holderCredentialId", "requestBindingHash",
    "rootWalletAddress", "schema", "walletAddress"]);
  if (value.schema !== "programmable-main-token-migration-gasless-root-guard/v1" ||
    typeof value.holderCredentialId !== "string" ||
    typeof value.requestBindingHash !== "string" ||
    !DIGEST.test(value.requestBindingHash) ||
    typeof value.rootWalletAddress !== "string" ||
    !isAddress(value.rootWalletAddress, { strict: true }) ||
    typeof value.walletAddress !== "string" ||
    !isAddress(value.walletAddress, { strict: true }) ||
    row.request_binding_hash !== value.requestBindingHash) throw unavailable();
  return Object.freeze({
    schema: value.schema,
    holderCredentialId: value.holderCredentialId,
    requestBindingHash: value.requestBindingHash as `sha256:${string}`,
    rootWalletAddress: getAddress(value.rootWalletAddress),
    walletAddress: getAddress(value.walletAddress),
  });
}

function parseRecoveryEdge(row: Row): RecoveryEdgeV1 {
  const value = object(parseCanonical(row.canonical_use));
  exactKeys(value, ["schema", "recoveryAttempt", "previousHolderCredentialId",
    "holderCredentialId", "previousRequestBindingHash", "requestBindingHash",
    "idempotencyBindingHash", "recoveryProof"]);
  if (value.schema !== "programmable-main-token-migration-gasless-recovery/v1" ||
    typeof value.recoveryAttempt !== "number" || !Number.isInteger(value.recoveryAttempt) ||
    value.recoveryAttempt < 1 || value.recoveryAttempt > MAIN_TOKEN_MIGRATION_GASLESS_MAX_RECOVERIES_V1 ||
    typeof value.previousHolderCredentialId !== "string" ||
    typeof value.holderCredentialId !== "string" ||
    typeof value.previousRequestBindingHash !== "string" || !DIGEST.test(value.previousRequestBindingHash) ||
    typeof value.requestBindingHash !== "string" || !DIGEST.test(value.requestBindingHash) ||
    typeof value.idempotencyBindingHash !== "string" || !DIGEST.test(value.idempotencyBindingHash) ||
    row.request_binding_hash !== value.requestBindingHash) throw unavailable();
  // The proof's exact shape and temporal binding are checked against both intents.
  object(value.recoveryProof);
  return value as RecoveryEdgeV1;
}

function parseCanonical(source: string) {
  const value = parseStrictJson(source, { maximumBytes: 24_576, maximumDepth: 8 });
  if (canonicalizeJson(value) !== source) throw unavailable();
  return value;
}

function object(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (!value || Array.isArray(value) || typeof value !== "object") throw unavailable();
  return value;
}

function exactKeys(value: Readonly<Record<string, JsonValue>>, keys: string[]) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw unavailable();
  }
}

function positiveDecimal(value: JsonValue): value is string {
  return typeof value === "string" && POSITIVE_DECIMAL.test(value);
}

function decimal(value: JsonValue): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}

function reference(value: JsonValue): value is string {
  return typeof value === "string" && SAFE_REFERENCE_ID.test(value);
}

function validateLookup(input: Lookup) {
  if (!SAFE_RELEASE_ID.test(input.releaseId) ||
    !isAddress(input.walletAddress, { strict: true })) {
    throw new TypeError("Gasless migration lookup is invalid");
  }
}

function holderId(input: Lookup, attempt = 0) {
  return `${PREFIX}:holder:${input.releaseId}:${input.walletAddress.toLowerCase()}${attemptSuffix(attempt)}`;
}

function completionId(input: Lookup, kind: CompletionKind, attempt = 0) {
  return `${PREFIX}:${kind}:${input.releaseId}:${input.walletAddress.toLowerCase()}${attemptSuffix(attempt)}`;
}

function recoveryId(input: Lookup, attempt: number) {
  return `${PREFIX}:recovery:${input.releaseId}:${input.walletAddress.toLowerCase()}:attempt:${attempt}`;
}

function attemptSuffix(attempt: number) {
  return attempt ? `:attempt:${attempt}` : "";
}

function recordIds(input: Lookup) {
  const ids: string[] = [];
  for (let attempt = 0; attempt <= MAIN_TOKEN_MIGRATION_GASLESS_MAX_RECOVERIES_V1; attempt++) {
    ids.push(holderId(input, attempt), completionId(input, "permit", attempt),
      completionId(input, "transfer", attempt));
    if (attempt) ids.push(recoveryId(input, attempt));
  }
  return ids;
}

function aliasId(releaseId: string, binding: string) {
  return `${PREFIX}:idempotency:${releaseId}:${binding.slice("sha256:".length)}`;
}

function rootId(releaseId: string, rootWalletAddress: Address) {
  return `${PREFIX}:root:${releaseId}:${rootWalletAddress.toLowerCase()}`;
}

function conflict() {
  return new MainTokenMigrationGaslessStoreErrorV1("conflict");
}

function budgetExhausted() {
  return new MainTokenMigrationGaslessStoreErrorV1("budget_exhausted");
}

function unavailable() {
  return new MainTokenMigrationGaslessStoreErrorV1("unavailable");
}

let productionStore: MainTokenMigrationGaslessStoreV1 | null = null;

export function getProductionMainTokenMigrationGaslessStoreV1() {
  if (productionStore) return productionStore;
  const pool = createProductionProjectionTargetPostgresPoolV1(
    requiredEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"),
    requiredEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM")
      .replaceAll("\\n", "\n"),
    requiredEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE"),
  );
  productionStore = createMainTokenMigrationGaslessPostgresStoreV1(pool);
  return productionStore;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}
