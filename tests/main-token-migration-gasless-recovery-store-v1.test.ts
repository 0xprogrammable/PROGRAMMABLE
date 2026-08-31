import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildMainTokenMigrationPermitTypedData } from "../lib/main-token-migration";
import {
  createMainTokenMigrationGaslessPostgresStoreV1,
  MAIN_TOKEN_MIGRATION_GASLESS_PREFIX_V1,
  type MainTokenMigrationGaslessIntentV1,
  type MainTokenMigrationGaslessRecoveryProofV1,
  type MainTokenMigrationGaslessStoreV1,
} from "../lib/server/main-token-migration-gasless-transfer-store-v1";
import {
  createMainTokenMigrationGasSponsorPostgresStoreV1,
  type MainTokenMigrationGasSponsorIntentV1,
} from "../lib/server/main-token-migration-gas-sponsor-store-v1";
import { canonicalizeJson } from "../lib/server/projection-target/canonical-json";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";

const account = privateKeyToAccount(keccak256(stringToHex("gasless recovery store fixture")));
const sponsorAddress = "0x0060f9E57FCcc0611ef44809B257919e78Aa99Ac";
const otherWallet = "0x1111111111111111111111111111111111111111";
const releaseId = "recovery-store-test-v1";
const lookup = { releaseId, walletAddress: account.address };
const prefix = MAIN_TOKEN_MIGRATION_GASLESS_PREFIX_V1;
const walletKey = `${releaseId}:${account.address.toLowerCase()}`;
const holder = `${prefix}:holder:${walletKey}`;
const reservedTotalWei = "200000000000000";
const totalBudgetWei = "600000000000000";

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function transactionHash(value: string): Hex {
  return keccak256(stringToHex(value));
}

async function intent(attempt = 0): Promise<MainTokenMigrationGaslessIntentV1> {
  const deadline = 1_788_169_000n + BigInt(attempt) * 1_200n;
  const signature = await account.signTypedData(buildMainTokenMigrationPermitTypedData({
    owner: account.address, spender: sponsorAddress, value: 100n, nonce: 0n, deadline,
  }));
  return {
    schema: "programmable-main-token-migration-gasless-intent/v1",
    releaseId,
    walletAddress: account.address,
    rootWalletAddress: account.address,
    sponsorAddress,
    amountRaw: "100",
    nonce: "0",
    permitDeadline: deadline.toString(),
    permitSignature: signature,
    permitGasLimit: "100000",
    transferGasLimit: "100000",
    maxFeePerGasWei: "1000000000",
    maxPriorityFeePerGasWei: "100000000",
    reservedTotalWei,
    totalBudgetWei,
    requestBindingHash: digest(`request-${attempt}`),
    providerPermitIdempotencyKey: `permit-key-${attempt}`,
    providerPermitReferenceId: `permit-reference-${attempt}`,
    providerTransferIdempotencyKey: `transfer-key-${attempt}`,
    providerTransferReferenceId: `transfer-reference-${attempt}`,
    reservedAt: new Date((1_788_168_000 + attempt * 1_200) * 1_000).toISOString(),
  };
}

function proof(previous: MainTokenMigrationGaslessIntentV1): MainTokenMigrationGaslessRecoveryProofV1 {
  return {
    finalizedBlockNumber: "25876000",
    finalizedBlockHash: transactionHash(`finalized-${previous.requestBindingHash}`),
    finalizedBlockTimestamp: (BigInt(previous.permitDeadline) + 1n).toString(),
    nonce: previous.nonce,
    allowanceRaw: "0",
  };
}

describe("append-only gasless recovery store", () => {
  let database: PGlite;
  let pool: TestPool;
  let store: MainTokenMigrationGaslessStoreV1;
  let base: MainTokenMigrationGaslessIntentV1;
  let next: MainTokenMigrationGaslessIntentV1;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(`
      CREATE SCHEMA programmable_website_projection_v1;
      CREATE TABLE programmable_website_projection_v1.credential_uses (
        credential_id text PRIMARY KEY,
        request_binding_hash text NOT NULL,
        canonical_use text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
    `);
    pool = new TestPool(database);
    store = createMainTokenMigrationGaslessPostgresStoreV1(pool);
    base = await intent();
    next = await intent(1);
    await store.reserve({ lookup, idempotencyBindingHash: digest("alias-0"), intent: base });
  });

  afterEach(async () => database.close());

  const recover = (store: MainTokenMigrationGaslessStoreV1,
    previous: MainTokenMigrationGaslessIntentV1, next: MainTokenMigrationGaslessIntentV1,
    alias = "alias-1") => store.recover({
    lookup, idempotencyBindingHash: digest(alias), previousRequestBindingHash: previous.requestBindingHash,
    recoveryProof: proof(previous), intent: next,
  });

  it("appends a new attempt without changing the old intent, alias, root or permit completion", async () => {
    await store.complete({ lookup, kind: "permit", providerReferenceId: base.providerPermitReferenceId,
      transactionHash: transactionHash("old-permit") });
    const before = await rows(database);
    const result = await recover(store, base, next);
    expect(result.kind).toBe("created");
    expect(result.record).toMatchObject({ intent: next, recoveryAttempt: 1,
      previousRequestBindingHash: base.requestBindingHash,
      permitTransactionHash: null, transferTransactionHash: null });
    expect(await store.get(lookup)).toEqual(result.record);
    const after = await rows(database);
    for (const row of before) expect(after.find((value) => value.credential_id === row.credential_id)).toEqual(row);
    expect(after).toHaveLength(before.length + 3);
    expect(after.some((row) => row.credential_id === `${holder}:attempt:1`)).toBe(true);
    const edge = after.find((row) => row.credential_id === `${prefix}:recovery:${walletKey}:attempt:1`)!;
    expect(JSON.parse(edge.canonical_use)).toMatchObject({ recoveryProof: proof(base) });
    const duplicate = await recover(store, base, next);
    expect(duplicate).toEqual({ kind: "existing", record: result.record });
    expect(await rows(database)).toEqual(after);
  });

  it("rejects an original reservation and stale predecessor after recovery", async () => {
    await recover(store, base, next);
    await expect(store.reserve({ lookup, idempotencyBindingHash: digest("alias-0"), intent: base }))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(recover(store, base, await intent(2), "stale-alias"))
      .rejects.toMatchObject({ code: "conflict" });
    await expect(recover(store, base, { ...next, reservedAt: base.reservedAt }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(await rows(database)).toHaveLength(6);
  });

  it("requires a fresh idempotency alias and serializes against an existing successor", async () => {
    await expect(recover(store, base, next, "alias-0")).rejects.toMatchObject({ code: "conflict" });
    await recover(store, base, next);
    await expect(recover(store, base, next, "different-alias")).rejects.toMatchObject({ code: "conflict" });
    expect(await rows(database)).toHaveLength(6);
  });

  it("rolls back the new holder when a later append fails", async () => {
    const before = await rows(database);
    pool.failOnceOnInsertId = `${prefix}:recovery:${walletKey}:attempt:1`;
    await expect(recover(store, base, next)).rejects.toMatchObject({ code: "unavailable" });
    expect(await rows(database)).toEqual(before);
    expect(await store.get(lookup)).toMatchObject({ intent: base });
    expect((await recover(store, base, next)).kind).toBe("created");
  });

  it("bounds recovery to two attempts without releasing prior reservations", async () => {
    await recover(store, base, next);
    const second = await intent(2);
    await recover(store, next, second, "alias-2");
    expect(await store.get(lookup)).toMatchObject({ recoveryAttempt: 2, intent: second });
    await expect(recover(store, second, await intent(3), "alias-3"))
      .rejects.toMatchObject({ code: "conflict" });
    expect(await rows(database)).toHaveLength(9);
  });

  it("rejects changed identities, amount, nonce and stale signed/provider bindings atomically", async () => {
    const mutations: Partial<MainTokenMigrationGaslessIntentV1>[] = [
      { rootWalletAddress: otherWallet }, { sponsorAddress: otherWallet }, { amountRaw: "101" },
      { nonce: "1" }, { permitDeadline: base.permitDeadline }, { permitSignature: base.permitSignature },
      { requestBindingHash: base.requestBindingHash },
      { providerPermitReferenceId: base.providerTransferReferenceId },
      { providerTransferIdempotencyKey: base.providerPermitIdempotencyKey },
      { providerTransferReferenceId: next.providerPermitReferenceId },
    ];
    for (const mutation of mutations) {
      await expect(recover(store, base, { ...next, ...mutation })).rejects.toBeInstanceOf(Error);
      expect(await rows(database)).toHaveLength(3);
    }
    await expect(store.recover({ lookup: { ...lookup, walletAddress: otherWallet },
      idempotencyBindingHash: digest("other-wallet"), previousRequestBindingHash: base.requestBindingHash,
      recoveryProof: proof(base), intent: { ...next, walletAddress: otherWallet } }))
      .rejects.toMatchObject({ code: "conflict" });
  });

  it("requires finalized expiry, unchanged nonce and zero allowance in durable proof", async () => {
    const mutations = [
      { finalizedBlockTimestamp: base.permitDeadline },
      { finalizedBlockTimestamp: next.permitDeadline },
      { finalizedBlockNumber: "0" }, { finalizedBlockHash: "0x1234" },
      { nonce: "1" }, { allowanceRaw: "1" },
    ];
    for (const mutation of mutations) {
      await expect(store.recover({ lookup, idempotencyBindingHash: digest("alias-1"),
        previousRequestBindingHash: base.requestBindingHash, intent: next,
        recoveryProof: { ...proof(base), ...mutation } as MainTokenMigrationGaslessRecoveryProofV1,
      })).rejects.toMatchObject({ code: "conflict" });
      expect(await rows(database)).toHaveLength(3);
    }
  });

  it("never recovers after a known transfer and never completes a superseded provider reference", async () => {
    await recover(store, base, next);
    await expect(store.complete({ lookup, kind: "permit", providerReferenceId: base.providerPermitReferenceId,
      transactionHash: transactionHash("old-permit") })).rejects.toMatchObject({ code: "unavailable" });
    await expect(store.complete({ lookup, kind: "transfer", providerReferenceId: next.providerTransferReferenceId,
      transactionHash: transactionHash("new-transfer") })).rejects.toMatchObject({ code: "unavailable" });
    await store.complete({ lookup, kind: "permit", providerReferenceId: next.providerPermitReferenceId,
      transactionHash: transactionHash("new-permit") });
    const completed = await store.complete({ lookup, kind: "transfer", providerReferenceId: next.providerTransferReferenceId,
      transactionHash: transactionHash("new-transfer") });
    expect(completed).toMatchObject({ recoveryAttempt: 1, transferTransactionHash: transactionHash("new-transfer") });
    expect((await rows(database)).some((row) => row.credential_id === `${prefix}:transfer:${walletKey}:attempt:1`)).toBe(true);
    await expect(recover(store, next, await intent(2), "alias-2")).rejects.toMatchObject({ code: "conflict" });
  });

  it("fails closed on missing or tampered recovery edges and orphan completions", async () => {
    await recover(store, base, next);
    const edgeId = `${prefix}:recovery:${walletKey}:attempt:1`;
    const edge = (await rows(database)).find((row) => row.credential_id === edgeId)!;
    await database.query("DELETE FROM programmable_website_projection_v1.credential_uses WHERE credential_id = $1", [edgeId]);
    await expect(store.get(lookup)).rejects.toBeInstanceOf(Error);
    await database.query("INSERT INTO programmable_website_projection_v1.credential_uses VALUES ($1,$2,$3)",
      [edge.credential_id, edge.request_binding_hash, edge.canonical_use]);
    const bad = { ...JSON.parse(edge.canonical_use), previousRequestBindingHash: digest("not-parent") };
    await database.query("UPDATE programmable_website_projection_v1.credential_uses SET canonical_use = $2 WHERE credential_id = $1",
      [edgeId, canonicalizeJson(bad)]);
    await expect(store.get(lookup)).rejects.toBeInstanceOf(Error);
    await database.query("UPDATE programmable_website_projection_v1.credential_uses SET canonical_use = $2 WHERE credential_id = $1",
      [edgeId, edge.canonical_use]);
    await database.query("INSERT INTO programmable_website_projection_v1.credential_uses VALUES ($1,$2,$3)",
      [`${prefix}:permit:${walletKey}:attempt:2`, next.requestBindingHash, canonicalizeJson({
        schema: "programmable-main-token-migration-gasless-completion/v1", kind: "permit",
        providerReferenceId: next.providerPermitReferenceId, transactionHash: transactionHash("orphan"),
      })]);
    await expect(store.get(lookup)).rejects.toBeInstanceOf(Error);
  });

  it("counts every attempt against the unchanged native sponsor shared budget", async () => {
    await recover(store, base, next);
    await recover(store, next, await intent(2), "alias-2");
    const native = createMainTokenMigrationGasSponsorPostgresStoreV1(pool);
    await expect(native.reserve(nativeReservation(totalBudgetWei)))
      .rejects.toMatchObject({ code: "budget_exhausted" });
    expect(await rows(database)).toHaveLength(9);
  });

  it("counts a native sponsorship when reserving a fresh gasless attempt", async () => {
    const native = createMainTokenMigrationGasSponsorPostgresStoreV1(pool);
    await native.reserve(nativeReservation(totalBudgetWei));
    await recover(store, base, next);
    const before = await rows(database);
    await expect(recover(store, next, await intent(2), "alias-2"))
      .rejects.toMatchObject({ code: "budget_exhausted" });
    expect(await rows(database)).toEqual(before);
  });
});

function nativeReservation(budget: string) {
  const requestBindingHash = digest("native-request");
  const nativeIntent: MainTokenMigrationGasSponsorIntentV1 = {
    schema: "programmable-main-token-migration-gas-sponsorship-intent/v1", releaseId,
    walletAddress: otherWallet, sponsorAddress, amountRaw: "100", topUpWei: "130000000000000",
    totalBudgetWei: budget, sponsorGasLimit: "21000", sponsorMaxFeePerGasWei: "2000000000",
    sponsorMaxPriorityFeePerGasWei: "1000000000", reservedTotalWei: "172000000000000",
    estimatedTransferGas: "52000", feePerGasWei: "2000000000", requestBindingHash,
    providerIdempotencyKey: "native-key", providerReferenceId: "native-reference",
    reservedAt: new Date(1_788_168_000_000).toISOString(),
  };
  return { lookup: { releaseId, walletAddress: otherWallet as Address },
    idempotencyBindingHash: digest("native-alias"), requestBindingHash,
    eligibility: { rootWalletAddress: otherWallet as Address, walletAddress: otherWallet as Address,
      transferHash: null, transferBlockNumber: null, transferLogIndex: null }, intent: nativeIntent };
}

async function rows(database: PGlite) {
  const result = await database.query<{ credential_id: string; request_binding_hash: string; canonical_use: string }>(
    "SELECT credential_id, request_binding_hash, canonical_use FROM programmable_website_projection_v1.credential_uses ORDER BY credential_id",
  );
  return result.rows;
}

class TestPool {
  failOnceOnInsertId: string | null = null;
  constructor(private readonly database: PGlite) {}
  async assertProductionReadiness() {}
  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    return { query: <Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []) =>
      this.query<Row>(text, values), release() {} };
  }
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    if (text.includes("INSERT INTO") && values[0] === this.failOnceOnInsertId) {
      this.failOnceOnInsertId = null;
      throw new Error("Injected append failure");
    }
    const result = await this.database.query<Row>(text, [...values]);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }
}
