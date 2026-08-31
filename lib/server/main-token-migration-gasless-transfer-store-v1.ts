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

type Lookup = Readonly<{ releaseId: string; walletAddress: Address }>;
type ReserveInput = Readonly<{
  lookup: Lookup;
  idempotencyBindingHash: `sha256:${string}`;
  intent: MainTokenMigrationGaslessIntentV1;
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
      `, [[holderId(input), completionId(input, "permit"),
        completionId(input, "transfer")]]);
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
          holder,
          alias,
          root,
          completionId(input.lookup, "permit"),
          completionId(input.lookup, "transfer"),
        ]);
        const existingRecord = recordFromRows(existing, input.lookup);
        const aliasRow = existing.find((row) => row.credential_id === alias);
        const rootRow = existing.find((row) => row.credential_id === root);
        if (existingRecord) {
          if (existingRecord.intent.requestBindingHash !==
            intent.requestBindingHash || !aliasRow || !rootRow) throw conflict();
          const parsedAlias = parseAlias(aliasRow);
          const parsedRoot = parseRootGuard(rootRow);
          if (parsedAlias.holderCredentialId !== holder ||
            parsedRoot.holderCredentialId !== holder) throw conflict();
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

    async complete(input: CompleteInput) {
      validateLookup(input.lookup);
      if ((input.kind !== "permit" && input.kind !== "transfer") ||
        !SAFE_REFERENCE_ID.test(input.providerReferenceId) ||
        !HASH.test(input.transactionHash)) {
        throw new TypeError("Gasless migration completion is invalid");
      }
      await pool.assertProductionReadiness();
      return transaction(pool, input.lookup.releaseId, async (client) => {
        const rows = await selectRows(client, [
          holderId(input.lookup),
          completionId(input.lookup, "permit"),
          completionId(input.lookup, "transfer"),
        ]);
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
          completionId(input.lookup, input.kind),
          record.intent.requestBindingHash,
          completion,
        );
        return Object.freeze({
          intent: record.intent,
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
  const holder = rows.find((row) => row.credential_id === holderId(lookup));
  if (!holder) return null;
  const intent = parseIntent(holder);
  if (intent.releaseId !== lookup.releaseId ||
    intent.walletAddress.toLowerCase() !== lookup.walletAddress.toLowerCase() ||
    holder.request_binding_hash !== intent.requestBindingHash) throw unavailable();
  const permit = completionFromRows(rows, lookup, "permit", intent);
  const transfer = completionFromRows(rows, lookup, "transfer", intent);
  if (transfer && !permit) throw unavailable();
  return Object.freeze({
    intent,
    permitTransactionHash: permit?.transactionHash ?? null,
    transferTransactionHash: transfer?.transactionHash ?? null,
  });
}

function completionFromRows(
  rows: readonly Row[],
  lookup: Lookup,
  kind: CompletionKind,
  intent: MainTokenMigrationGaslessIntentV1,
) {
  const row = rows.find((candidate) =>
    candidate.credential_id === completionId(lookup, kind));
  if (!row) return null;
  const completion = parseCompletion(row);
  const reference = kind === "permit"
    ? intent.providerPermitReferenceId
    : intent.providerTransferReferenceId;
  if (completion.kind !== kind || completion.providerReferenceId !== reference ||
    row.request_binding_hash !== intent.requestBindingHash) throw unavailable();
  return completion;
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

function holderId(input: Lookup) {
  return `${PREFIX}:holder:${input.releaseId}:${input.walletAddress.toLowerCase()}`;
}

function completionId(input: Lookup, kind: CompletionKind) {
  return `${PREFIX}:${kind}:${input.releaseId}:${input.walletAddress.toLowerCase()}`;
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
