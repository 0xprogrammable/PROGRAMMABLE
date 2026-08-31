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
import { canonicalSha256 } from "./projection-target/hashing";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HASH = /^0x[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SAFE_RELEASE_ID = /^[a-z0-9][a-z0-9.-]{0,127}$/u;
const SAFE_REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const PREFIX = "main-token-migration-gas-sponsor:v1";
const ADMISSION_WINDOW_SECONDS = 60;
const ADMISSION_LIMITS = Object.freeze({
  read: Object.freeze({ holder: 8, principal: 12 }),
  submit: Object.freeze({ holder: 2, principal: 3 }),
});
const ROOT_GUARD_TOP_UP_WEI = 1n;
const ROOT_GUARD_FEE_PER_GAS_WEI = 1n;

export const MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1 = 21_000n;
export const MAIN_TOKEN_MIGRATION_GAS_SPONSOR_MAX_GAS_LIMIT_V1 = 100_000n;

export type MainTokenMigrationGasSponsorIntentV1 = Readonly<{
  schema: "programmable-main-token-migration-gas-sponsorship-intent/v1";
  releaseId: string;
  walletAddress: Address;
  sponsorAddress: Address;
  amountRaw: string;
  topUpWei: string;
  totalBudgetWei: string;
  sponsorGasLimit: string;
  sponsorMaxFeePerGasWei: string;
  sponsorMaxPriorityFeePerGasWei: string;
  reservedTotalWei: string;
  estimatedTransferGas: string;
  feePerGasWei: string;
  requestBindingHash: `sha256:${string}`;
  providerIdempotencyKey: string;
  providerReferenceId: string;
  reservedAt: string;
}>;

export type MainTokenMigrationGasSponsorRecordV1 = Readonly<{
  intent: MainTokenMigrationGasSponsorIntentV1;
  transactionHash: Hex | null;
}>;

export type MainTokenMigrationGasSponsorEligibilityV1 = Readonly<{
  rootWalletAddress: Address;
  walletAddress: Address;
  transferHash: Hex | null;
  transferBlockNumber: string | null;
  transferLogIndex: string | null;
}>;

type CompletionV1 = Readonly<{
  schema: "programmable-main-token-migration-gas-sponsorship-completion/v1";
  providerReferenceId: string;
  transactionHash: Hex;
}>;

type AliasV1 = Readonly<{
  schema: "programmable-main-token-migration-gas-sponsorship-idempotency/v1";
  holderCredentialId: string;
  requestBindingHash: `sha256:${string}`;
}>;

type EligibilityAliasV1 = Readonly<{
  schema: "programmable-main-token-migration-gas-sponsorship-eligibility/v1";
  holderCredentialId: string;
  requestBindingHash: `sha256:${string}`;
  rootWalletAddress: Address;
  walletAddress: Address;
  transferHash: Hex | null;
  transferBlockNumber: string | null;
  transferLogIndex: string | null;
}>;

type AdmissionOperation = "read" | "submit";
type AdmissionInput = Readonly<{
  releaseId: string;
  principalBindingHash: `sha256:${string}`;
  walletAddress: Address;
  operation: AdmissionOperation;
}>;

type AdmissionV1 = Readonly<{
  schema: "programmable-main-token-migration-gas-sponsorship-admission/v1";
  holderAddress: Address;
  operation: AdmissionOperation;
  principalBindingHash: `sha256:${string}`;
  releaseId: string;
  scope: "holder" | "principal";
  slot: string;
  windowId: string;
}>;

type Row = Readonly<{
  credential_id: string;
  request_binding_hash: string;
  canonical_use: string;
}> & Record<string, unknown>;

type AttestedPool = ProjectionTargetPostgresPoolV1 & Readonly<{
  assertProductionReadiness(): Promise<void>;
}>;

export interface MainTokenMigrationGasSponsorStoreV1 {
  admit(input: AdmissionInput): Promise<void>;
  get(input: Lookup): Promise<MainTokenMigrationGasSponsorRecordV1 | null>;
  reserve(input: Readonly<{
    lookup: Lookup;
    idempotencyBindingHash: `sha256:${string}`;
    requestBindingHash: `sha256:${string}`;
    eligibility: MainTokenMigrationGasSponsorEligibilityV1;
    intent: MainTokenMigrationGasSponsorIntentV1;
  }>): Promise<Readonly<{
    kind: "created" | "existing";
    record: MainTokenMigrationGasSponsorRecordV1;
  }>>;
  complete(input: Readonly<{
    lookup: Lookup;
    providerReferenceId: string;
    transactionHash: Hex;
  }>): Promise<MainTokenMigrationGasSponsorRecordV1>;
}

type Lookup = Readonly<{ releaseId: string; walletAddress: Address }>;
type ReserveInput = Readonly<{
  lookup: Lookup;
  idempotencyBindingHash: `sha256:${string}`;
  requestBindingHash: `sha256:${string}`;
  eligibility: MainTokenMigrationGasSponsorEligibilityV1;
  intent: MainTokenMigrationGasSponsorIntentV1;
}>;
type CompleteInput = Readonly<{
  lookup: Lookup;
  providerReferenceId: string;
  transactionHash: Hex;
}>;

export class MainTokenMigrationGasSponsorStoreErrorV1 extends Error {
  constructor(
    readonly code:
      | "budget_exhausted"
      | "conflict"
      | "rate_limited"
      | "unavailable",
    readonly retryAfterSeconds?: number,
  ) {
    super("Main token migration gas sponsor store failed closed");
    this.name = "MainTokenMigrationGasSponsorStoreErrorV1";
  }
}

export function createMainTokenMigrationGasSponsorPostgresStoreV1(
  pool: AttestedPool,
): MainTokenMigrationGasSponsorStoreV1 {
  if (!pool || typeof pool.connect !== "function"
    || typeof pool.assertProductionReadiness !== "function") {
    throw new TypeError("Gas sponsor PostgreSQL pool is invalid");
  }
  return Object.freeze({
    async admit(input: AdmissionInput) {
      validateAdmission(input);
      await pool.assertProductionReadiness();
      await transaction(pool, input.releaseId, async (client) => {
        const window = await admissionWindow(client);
        const limits = ADMISSION_LIMITS[input.operation];
        const principalPrefix = admissionPrefix({
          ...input,
          scope: "principal",
          windowId: window.windowId,
        });
        const holderPrefix = admissionPrefix({
          ...input,
          scope: "holder",
          windowId: window.windowId,
        });
        const [principalCount, holderCount] = await Promise.all([
          admissionCount(client, principalPrefix),
          admissionCount(client, holderPrefix),
        ]);
        if (principalCount >= limits.principal || holderCount >= limits.holder) {
          throw rateLimited(window.retryAfterSeconds);
        }
        await insertAdmission(client, {
          ...input,
          scope: "principal",
          slot: String(principalCount + 1),
          windowId: window.windowId,
        });
        await insertAdmission(client, {
          ...input,
          scope: "holder",
          slot: String(holderCount + 1),
          windowId: window.windowId,
        });
      });
    },

    async get(input: Lookup) {
      validateLookup(input);
      await pool.assertProductionReadiness();
      const rows = await pool.query<Row>(`
        SELECT credential_id, request_binding_hash, canonical_use
          FROM programmable_website_projection_v1.credential_uses
         WHERE credential_id = ANY($1::text[])
         ORDER BY credential_id
      `, [[holderId(input), completionId(input)]]);
      return recordFromRows(rows.rows, input);
    },

    async reserve(input: ReserveInput) {
      validateLookup(input.lookup);
      if (!DIGEST.test(input.idempotencyBindingHash)
        || !DIGEST.test(input.requestBindingHash)) {
        throw new TypeError("Gas sponsor reservation is invalid");
      }
      const eligibility = validateEligibility(input.eligibility, input.lookup);
      const intent = validateIntent(input.intent, input.lookup);
      if (intent.requestBindingHash !== input.requestBindingHash) {
        throw new TypeError("Gas sponsor reservation binding is invalid");
      }
      await pool.assertProductionReadiness();
      return transaction(pool, input.lookup.releaseId, async (client) => {
        const holder = holderId(input.lookup);
        const alias = aliasId(input.lookup.releaseId, input.idempotencyBindingHash);
        const eligibilityAlias = eligibilityId(
          input.lookup.releaseId,
          eligibility.rootWalletAddress,
        );
        const rootHolder = holderId({
          releaseId: input.lookup.releaseId,
          walletAddress: eligibility.rootWalletAddress,
        });
        const ids = [
          holder,
          rootHolder,
          completionId(input.lookup),
          alias,
          eligibilityAlias,
        ];
        const existing = await selectRows(client, ids);
        const aliasRow = existing.find((row) => row.credential_id === alias);
        const eligibilityRow = existing.find(
          (row) => row.credential_id === eligibilityAlias,
        );
        const holderRow = existing.find((row) => row.credential_id === holder);
        const rootHolderRow = existing.find(
          (row) => row.credential_id === rootHolder,
        );
        if (rootHolder !== holder && rootHolderRow) throw conflict();
        if (aliasRow) {
          const value = parseAlias(aliasRow);
          if (value.holderCredentialId !== holder
            || value.requestBindingHash !== input.requestBindingHash
            || !holderRow) throw conflict();
        }
        if (eligibilityRow) {
          const value = parseEligibilityAlias(eligibilityRow);
          if (value.holderCredentialId !== holder
            || !holderRow) throw conflict();
        }
        const existingRecord = recordFromRows(existing, input.lookup);
        if (existingRecord) {
          return Object.freeze({ kind: "existing" as const, record: existingRecord });
        }
        if (aliasRow || eligibilityRow) throw conflict();
        const releaseIntents = await selectReleaseIntents(
          client,
          input.lookup.releaseId,
        );
        const rootGuard = rootHolder === holder
          ? null
          : createRootGuardIntent(intent, eligibility);
        const reservedWei = releaseIntents.reduce((total, row) => {
          const existingIntent = parseIntent(row);
          if (existingIntent.releaseId !== input.lookup.releaseId
            || existingIntent.totalBudgetWei !== intent.totalBudgetWei) {
            throw unavailable();
          }
          return total + BigInt(existingIntent.reservedTotalWei);
        }, 0n);
        const requestedReservationWei = BigInt(intent.reservedTotalWei)
          + (rootGuard ? BigInt(rootGuard.reservedTotalWei) : 0n);
        if (reservedWei + requestedReservationWei
          > BigInt(intent.totalBudgetWei)) {
          throw budgetExhausted();
        }
        await insertRow(client, holder, input.requestBindingHash, intent);
        await insertAlias(client, alias, holder, input.requestBindingHash);
        await insertEligibilityAlias(
          client,
          eligibilityAlias,
          holder,
          input.requestBindingHash,
          eligibility,
        );
        if (rootGuard) {
          await insertRow(
            client,
            rootHolder,
            rootGuard.requestBindingHash,
            rootGuard,
          );
        }
        return Object.freeze({
          kind: "created" as const,
          record: Object.freeze({ intent, transactionHash: null }),
        });
      });
    },

    async complete(input: CompleteInput) {
      validateLookup(input.lookup);
      if (!SAFE_REFERENCE_ID.test(input.providerReferenceId)
        || !HASH.test(input.transactionHash)) {
        throw new TypeError("Gas sponsor completion is invalid");
      }
      await pool.assertProductionReadiness();
      return transaction(pool, input.lookup.releaseId, async (client) => {
        const existing = await selectRows(client, [
          holderId(input.lookup),
          completionId(input.lookup),
        ]);
        const current = recordFromRows(existing, input.lookup);
        if (!current
          || current.intent.providerReferenceId !== input.providerReferenceId) {
          throw unavailable();
        }
        if (current.transactionHash !== null) {
          if (current.transactionHash !== input.transactionHash) throw conflict();
          return current;
        }
        const completion: CompletionV1 = Object.freeze({
          schema:
            "programmable-main-token-migration-gas-sponsorship-completion/v1",
          providerReferenceId: input.providerReferenceId,
          transactionHash: input.transactionHash,
        });
        await insertRow(
          client,
          completionId(input.lookup),
          current.intent.requestBindingHash,
          completion,
        );
        return Object.freeze({
          intent: current.intent,
          transactionHash: input.transactionHash,
        });
      });
    },
  });
}

async function admissionWindow(client: ProjectionTargetPostgresClientV1) {
  const result = await client.query<{
    retry_after_seconds: string;
    window_id: string;
  }>(`
    SELECT (floor(observed.epoch_seconds / $1)::bigint)::text AS window_id,
           (greatest(
             1,
             ceil($1 - mod(observed.epoch_seconds, $1))
           )::integer)::text AS retry_after_seconds
      FROM (
        SELECT extract(epoch FROM clock_timestamp()) AS epoch_seconds
      ) AS observed
  `, [ADMISSION_WINDOW_SECONDS]);
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row
    || !DECIMAL.test(row.window_id)
    || !DECIMAL.test(row.retry_after_seconds)) throw unavailable();
  const retryAfterSeconds = Number(row.retry_after_seconds);
  if (!Number.isSafeInteger(retryAfterSeconds)
    || retryAfterSeconds < 1
    || retryAfterSeconds > ADMISSION_WINDOW_SECONDS) throw unavailable();
  return Object.freeze({
    retryAfterSeconds,
    windowId: row.window_id,
  });
}

async function admissionCount(
  client: ProjectionTargetPostgresClientV1,
  prefix: string,
) {
  const result = await client.query<{ count: string }>(`
    SELECT count(*)::text AS count
      FROM programmable_website_projection_v1.credential_uses
     WHERE credential_id LIKE $1
  `, [`${prefix}%`]);
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row || !DECIMAL.test(row.count)) {
    throw unavailable();
  }
  const count = Number(row.count);
  if (!Number.isSafeInteger(count) || count < 0) throw unavailable();
  return count;
}

async function insertAdmission(
  client: ProjectionTargetPostgresClientV1,
  input: Readonly<{
    releaseId: string;
    principalBindingHash: `sha256:${string}`;
    walletAddress: Address;
    operation: AdmissionOperation;
    scope: "holder" | "principal";
    slot: string;
    windowId: string;
  }>,
) {
  const prefix = admissionPrefix(input);
  const admission: AdmissionV1 = Object.freeze({
    schema:
      "programmable-main-token-migration-gas-sponsorship-admission/v1",
    holderAddress: getAddress(input.walletAddress),
    operation: input.operation,
    principalBindingHash: input.principalBindingHash,
    releaseId: input.releaseId,
    scope: input.scope,
    slot: input.slot,
    windowId: input.windowId,
  });
  const binding = canonicalSha256(
    "programmable.main-token-migration.gas-sponsor.admission.v1",
    admission,
  );
  await insertRow(client, `${prefix}${input.slot}`, binding, admission);
}

function admissionPrefix(input: Readonly<{
  releaseId: string;
  principalBindingHash: `sha256:${string}`;
  walletAddress: Address;
  operation: AdmissionOperation;
  scope: "holder" | "principal";
  windowId: string;
}>) {
  const subject = input.scope === "principal"
    ? input.principalBindingHash.slice("sha256:".length)
    : input.walletAddress.toLowerCase().slice(2);
  return `${PREFIX}:admission:${input.releaseId}:${input.operation}:` +
    `${input.windowId}:${input.scope}:${subject}:`;
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
      [`${PREFIX}:lock:${releaseId}`],
    );
    const value = await work(client);
    await client.query("COMMIT");
    open = false;
    return value;
  } catch (error) {
    if (open) await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof MainTokenMigrationGasSponsorStoreErrorV1) throw error;
    throw unavailable();
  } finally {
    client.release();
  }
}

async function selectRows(client: ProjectionTargetPostgresClientV1, ids: string[]) {
  const result = await client.query<Row>(`
    SELECT credential_id, request_binding_hash, canonical_use
      FROM programmable_website_projection_v1.credential_uses
     WHERE credential_id = ANY($1::text[])
     ORDER BY credential_id
  `, [ids]);
  return result.rows;
}

async function selectReleaseIntents(
  client: ProjectionTargetPostgresClientV1,
  releaseId: string,
) {
  const result = await client.query<Row>(`
    SELECT credential_id, request_binding_hash, canonical_use
      FROM programmable_website_projection_v1.credential_uses
     WHERE credential_id LIKE $1
     ORDER BY credential_id
  `, [`${PREFIX}:holder:${releaseId}:%`]);
  return result.rows;
}

async function insertRow(
  client: ProjectionTargetPostgresClientV1,
  credentialId: string,
  requestBindingHash: string,
  value: JsonValue,
) {
  const inserted = await client.query<Row>(`
    INSERT INTO programmable_website_projection_v1.credential_uses
      (credential_id, request_binding_hash, canonical_use)
    VALUES ($1, $2, $3)
    ON CONFLICT DO NOTHING
    RETURNING credential_id, request_binding_hash, canonical_use
  `, [credentialId, requestBindingHash, canonicalizeJson(value)]);
  if (inserted.rowCount !== 1) throw conflict();
}

async function insertAlias(
  client: ProjectionTargetPostgresClientV1,
  credentialId: string,
  holderCredentialId: string,
  requestBindingHash: `sha256:${string}`,
) {
  const alias: AliasV1 = Object.freeze({
    schema: "programmable-main-token-migration-gas-sponsorship-idempotency/v1",
    holderCredentialId,
    requestBindingHash,
  });
  await insertRow(client, credentialId, requestBindingHash, alias);
}

async function insertEligibilityAlias(
  client: ProjectionTargetPostgresClientV1,
  credentialId: string,
  holderCredentialId: string,
  requestBindingHash: `sha256:${string}`,
  eligibility: MainTokenMigrationGasSponsorEligibilityV1,
) {
  const alias: EligibilityAliasV1 = Object.freeze({
    schema: "programmable-main-token-migration-gas-sponsorship-eligibility/v1",
    holderCredentialId,
    requestBindingHash,
    ...eligibility,
  });
  await insertRow(client, credentialId, requestBindingHash, alias);
}

function recordFromRows(rows: readonly Row[], lookup: Lookup) {
  const holder = rows.find((row) => row.credential_id === holderId(lookup));
  if (!holder) return null;
  const intent = parseIntent(holder);
  if (intent.releaseId !== lookup.releaseId
    || intent.walletAddress.toLowerCase() !== lookup.walletAddress.toLowerCase()
    || holder.request_binding_hash !== intent.requestBindingHash) {
    throw unavailable();
  }
  const completionRow = rows.find(
    (row) => row.credential_id === completionId(lookup),
  );
  if (!completionRow) return Object.freeze({ intent, transactionHash: null });
  const completion = parseCompletion(completionRow);
  if (completion.providerReferenceId !== intent.providerReferenceId
    || completionRow.request_binding_hash !== intent.requestBindingHash) {
    throw unavailable();
  }
  return Object.freeze({ intent, transactionHash: completion.transactionHash });
}

function validateIntent(value: MainTokenMigrationGasSponsorIntentV1, lookup: Lookup) {
  const parsed = parseIntentValue(parseCanonical(canonicalizeJson(value)));
  if (parsed.releaseId !== lookup.releaseId
    || parsed.walletAddress.toLowerCase() !== lookup.walletAddress.toLowerCase()) {
    throw new TypeError("Gas sponsor intent lookup is invalid");
  }
  return parsed;
}

function validateEligibility(
  input: MainTokenMigrationGasSponsorEligibilityV1,
  lookup: Lookup,
) {
  if (!input || typeof input !== "object"
    || !isAddress(input.rootWalletAddress, { strict: true })
    || !isAddress(input.walletAddress, { strict: true })
    || input.walletAddress.toLowerCase() !== lookup.walletAddress.toLowerCase()) {
    throw new TypeError("Gas sponsor eligibility is invalid");
  }
  const rootWalletAddress = getAddress(input.rootWalletAddress);
  const walletAddress = getAddress(input.walletAddress);
  const direct = rootWalletAddress.toLowerCase() === walletAddress.toLowerCase();
  if (direct) {
    if (input.transferHash !== null
      || input.transferBlockNumber !== null
      || input.transferLogIndex !== null) {
      throw new TypeError("Gas sponsor eligibility is invalid");
    }
  } else if (input.transferHash === null || !HASH.test(input.transferHash)
    || input.transferBlockNumber === null
    || !positiveDecimal(input.transferBlockNumber)
    || input.transferLogIndex === null
    || !decimal(input.transferLogIndex)) {
    throw new TypeError("Gas sponsor eligibility is invalid");
  }
  return Object.freeze({
    rootWalletAddress,
    walletAddress,
    transferHash: input.transferHash,
    transferBlockNumber: input.transferBlockNumber,
    transferLogIndex: input.transferLogIndex,
  });
}

function createRootGuardIntent(
  intent: MainTokenMigrationGasSponsorIntentV1,
  eligibility: MainTokenMigrationGasSponsorEligibilityV1,
) {
  const rootWalletAddress = getAddress(eligibility.rootWalletAddress);
  const requestBindingHash = canonicalSha256(
    "programmable.main-token-migration.gas-sponsor.root-guard.v1",
    {
      releaseId: intent.releaseId,
      rootWalletAddress,
      walletAddress: eligibility.walletAddress,
    },
  );
  const identity = rootWalletAddress.toLowerCase().slice(2);
  const reservedTotalWei = ROOT_GUARD_TOP_UP_WEI
    + MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1
      * ROOT_GUARD_FEE_PER_GAS_WEI;
  return validateIntent({
    schema: "programmable-main-token-migration-gas-sponsorship-intent/v1",
    releaseId: intent.releaseId,
    walletAddress: rootWalletAddress,
    sponsorAddress: intent.sponsorAddress,
    amountRaw: "1",
    topUpWei: ROOT_GUARD_TOP_UP_WEI.toString(),
    totalBudgetWei: intent.totalBudgetWei,
    sponsorGasLimit:
      MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1.toString(),
    sponsorMaxFeePerGasWei: ROOT_GUARD_FEE_PER_GAS_WEI.toString(),
    sponsorMaxPriorityFeePerGasWei: "0",
    reservedTotalWei: reservedTotalWei.toString(),
    estimatedTransferGas: "1",
    feePerGasWei: ROOT_GUARD_FEE_PER_GAS_WEI.toString(),
    requestBindingHash,
    providerIdempotencyKey: `mtmgs-root-guard-${identity}`,
    providerReferenceId: `mtmgs-root-guard-${identity}`,
    reservedAt: intent.reservedAt,
  }, {
    releaseId: intent.releaseId,
    walletAddress: rootWalletAddress,
  });
}

function parseIntent(row: Row) {
  return parseIntentValue(parseCanonical(row.canonical_use));
}

function parseIntentValue(input: JsonValue): MainTokenMigrationGasSponsorIntentV1 {
  const value = object(input);
  exactKeys(value, [
    "amountRaw", "estimatedTransferGas", "feePerGasWei", "providerIdempotencyKey",
    "providerReferenceId", "releaseId", "requestBindingHash", "reservedAt",
    "reservedTotalWei", "schema", "sponsorAddress", "sponsorGasLimit",
    "sponsorMaxFeePerGasWei", "sponsorMaxPriorityFeePerGasWei", "topUpWei",
    "totalBudgetWei", "walletAddress",
  ]);
  if (value.schema !== "programmable-main-token-migration-gas-sponsorship-intent/v1"
    || typeof value.releaseId !== "string" || !SAFE_RELEASE_ID.test(value.releaseId)
    || typeof value.walletAddress !== "string" || !isAddress(value.walletAddress, { strict: true })
    || typeof value.sponsorAddress !== "string" || !isAddress(value.sponsorAddress, { strict: true })
    || !positiveDecimal(value.amountRaw) || !positiveDecimal(value.topUpWei)
    || !positiveDecimal(value.totalBudgetWei)
    || !positiveDecimal(value.sponsorGasLimit)
    || !positiveDecimal(value.sponsorMaxFeePerGasWei)
    || !decimal(value.sponsorMaxPriorityFeePerGasWei)
    || !positiveDecimal(value.reservedTotalWei)
    || !positiveDecimal(value.estimatedTransferGas) || !positiveDecimal(value.feePerGasWei)
    || typeof value.requestBindingHash !== "string" || !DIGEST.test(value.requestBindingHash)
    || typeof value.providerIdempotencyKey !== "string" || !SAFE_REFERENCE_ID.test(value.providerIdempotencyKey)
    || typeof value.providerReferenceId !== "string" || !SAFE_REFERENCE_ID.test(value.providerReferenceId)
    || typeof value.reservedAt !== "string"
    || new Date(value.reservedAt).toISOString() !== value.reservedAt) throw unavailable();
  const sponsorGasLimit = BigInt(value.sponsorGasLimit);
  const sponsorMaxFeePerGasWei = BigInt(value.sponsorMaxFeePerGasWei);
  const sponsorMaxPriorityFeePerGasWei = BigInt(value.sponsorMaxPriorityFeePerGasWei);
  if (sponsorGasLimit < MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1
    || sponsorGasLimit > MAIN_TOKEN_MIGRATION_GAS_SPONSOR_MAX_GAS_LIMIT_V1
    || sponsorMaxPriorityFeePerGasWei > sponsorMaxFeePerGasWei
    || BigInt(value.reservedTotalWei)
      !== BigInt(value.topUpWei) + sponsorGasLimit * sponsorMaxFeePerGasWei
    || BigInt(value.reservedTotalWei) > BigInt(value.totalBudgetWei)) {
    throw unavailable();
  }
  return Object.freeze({
    schema: value.schema,
    releaseId: value.releaseId,
    walletAddress: getAddress(value.walletAddress),
    sponsorAddress: getAddress(value.sponsorAddress),
    amountRaw: value.amountRaw as string,
    topUpWei: value.topUpWei as string,
    totalBudgetWei: value.totalBudgetWei as string,
    sponsorGasLimit: value.sponsorGasLimit as string,
    sponsorMaxFeePerGasWei: value.sponsorMaxFeePerGasWei as string,
    sponsorMaxPriorityFeePerGasWei:
      value.sponsorMaxPriorityFeePerGasWei as string,
    reservedTotalWei: value.reservedTotalWei as string,
    estimatedTransferGas: value.estimatedTransferGas as string,
    feePerGasWei: value.feePerGasWei as string,
    requestBindingHash: value.requestBindingHash as `sha256:${string}`,
    providerIdempotencyKey: value.providerIdempotencyKey,
    providerReferenceId: value.providerReferenceId,
    reservedAt: value.reservedAt,
  });
}

function parseCompletion(row: Row): CompletionV1 {
  const value = object(parseCanonical(row.canonical_use));
  exactKeys(value, ["providerReferenceId", "schema", "transactionHash"]);
  if (value.schema !== "programmable-main-token-migration-gas-sponsorship-completion/v1"
    || typeof value.providerReferenceId !== "string" || !SAFE_REFERENCE_ID.test(value.providerReferenceId)
    || typeof value.transactionHash !== "string" || !HASH.test(value.transactionHash)) throw unavailable();
  return Object.freeze({
    schema: value.schema,
    providerReferenceId: value.providerReferenceId,
    transactionHash: value.transactionHash as Hex,
  });
}

function parseAlias(row: Row): AliasV1 {
  const value = object(parseCanonical(row.canonical_use));
  exactKeys(value, ["holderCredentialId", "requestBindingHash", "schema"]);
  if (value.schema !== "programmable-main-token-migration-gas-sponsorship-idempotency/v1"
    || typeof value.holderCredentialId !== "string"
    || typeof value.requestBindingHash !== "string" || !DIGEST.test(value.requestBindingHash)
    || row.request_binding_hash !== value.requestBindingHash) throw unavailable();
  return Object.freeze({
    schema: value.schema,
    holderCredentialId: value.holderCredentialId,
    requestBindingHash: value.requestBindingHash as `sha256:${string}`,
  });
}

function parseEligibilityAlias(row: Row): EligibilityAliasV1 {
  const value = object(parseCanonical(row.canonical_use));
  exactKeys(value, [
    "holderCredentialId", "requestBindingHash", "rootWalletAddress", "schema",
    "transferBlockNumber", "transferHash", "transferLogIndex", "walletAddress",
  ]);
  if (value.schema
      !== "programmable-main-token-migration-gas-sponsorship-eligibility/v1"
    || typeof value.holderCredentialId !== "string"
    || typeof value.requestBindingHash !== "string"
    || !DIGEST.test(value.requestBindingHash)
    || row.request_binding_hash !== value.requestBindingHash
    || typeof value.rootWalletAddress !== "string"
    || !isAddress(value.rootWalletAddress, { strict: true })
    || typeof value.walletAddress !== "string"
    || !isAddress(value.walletAddress, { strict: true })) throw unavailable();
  const eligibility = validateEligibility({
    rootWalletAddress: getAddress(value.rootWalletAddress),
    walletAddress: getAddress(value.walletAddress),
    transferHash: value.transferHash as Hex | null,
    transferBlockNumber: value.transferBlockNumber as string | null,
    transferLogIndex: value.transferLogIndex as string | null,
  }, {
    releaseId: "validation-only",
    walletAddress: getAddress(value.walletAddress),
  });
  return Object.freeze({
    schema: value.schema,
    holderCredentialId: value.holderCredentialId,
    requestBindingHash: value.requestBindingHash as `sha256:${string}`,
    ...eligibility,
  });
}

function parseCanonical(source: string) {
  const value = parseStrictJson(source, { maximumBytes: 16_384, maximumDepth: 8 });
  if (canonicalizeJson(value) !== source) throw unavailable();
  return value;
}

function object(value: JsonValue): Readonly<Record<string, JsonValue>> {
  if (!value || Array.isArray(value) || typeof value !== "object") throw unavailable();
  return value;
}

function exactKeys(value: Readonly<Record<string, JsonValue>>, keys: string[]) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) throw unavailable();
}

function positiveDecimal(value: JsonValue): value is string {
  return typeof value === "string" && DECIMAL.test(value) && BigInt(value) > 0n;
}

function decimal(value: JsonValue): value is string {
  return typeof value === "string" && DECIMAL.test(value);
}

function validateLookup(input: Lookup) {
  if (!SAFE_RELEASE_ID.test(input.releaseId)
    || !isAddress(input.walletAddress, { strict: true })) {
    throw new TypeError("Gas sponsor lookup is invalid");
  }
}

function validateAdmission(input: AdmissionInput) {
  validateLookup({
    releaseId: input.releaseId,
    walletAddress: input.walletAddress,
  });
  if (!DIGEST.test(input.principalBindingHash)
    || (input.operation !== "read" && input.operation !== "submit")) {
    throw new TypeError("Gas sponsor admission is invalid");
  }
}

function holderId(input: Lookup) {
  return `${PREFIX}:holder:${input.releaseId}:${input.walletAddress.toLowerCase()}`;
}

function completionId(input: Lookup) {
  return `${PREFIX}:completion:${input.releaseId}:${input.walletAddress.toLowerCase()}`;
}

function aliasId(releaseId: string, binding: string) {
  return `${PREFIX}:idempotency:${releaseId}:${binding.slice("sha256:".length)}`;
}

function eligibilityId(releaseId: string, rootWalletAddress: Address) {
  return `${PREFIX}:eligibility:${releaseId}:${rootWalletAddress.toLowerCase()}`;
}

function conflict() {
  return new MainTokenMigrationGasSponsorStoreErrorV1("conflict");
}

function budgetExhausted() {
  return new MainTokenMigrationGasSponsorStoreErrorV1("budget_exhausted");
}

function rateLimited(retryAfterSeconds: number) {
  return new MainTokenMigrationGasSponsorStoreErrorV1(
    "rate_limited",
    retryAfterSeconds,
  );
}

function unavailable() {
  return new MainTokenMigrationGasSponsorStoreErrorV1("unavailable");
}

let productionStore: MainTokenMigrationGasSponsorStoreV1 | null = null;

export function getProductionMainTokenMigrationGasSponsorStoreV1():
MainTokenMigrationGasSponsorStoreV1 {
  if (productionStore) return productionStore;
  const pool = createProductionProjectionTargetPostgresPoolV1(
    requiredEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL"),
    requiredEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_CA_PEM").replaceAll("\\n", "\n"),
    requiredEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_ROLE"),
  );
  productionStore = createMainTokenMigrationGasSponsorPostgresStoreV1(pool);
  return productionStore;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is not configured`);
  return value;
}
