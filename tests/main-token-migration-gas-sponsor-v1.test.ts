import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MainTokenMigrationGasSponsorErrorV1,
  assertMainTokenMigrationPrivySponsorWalletV1,
  calculateMainTokenMigrationTopUpWeiV1,
  createMainTokenMigrationGasSponsorV1,
  deriveMainTokenMigrationSponsorBindingsV1,
  deriveMainTokenMigrationSponsorPrincipalBindingV1,
  parseMainTokenMigrationSponsorRequestV1,
  type MainTokenMigrationGasSponsorChainV1,
  type MainTokenMigrationGasSponsorConfigurationV1,
  type MainTokenMigrationGasSponsorSenderV1,
} from "../lib/server/main-token-migration-gas-sponsor-v1";
import {
  MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1,
  MainTokenMigrationGasSponsorStoreErrorV1,
  createMainTokenMigrationGasSponsorPostgresStoreV1,
  type MainTokenMigrationGasSponsorIntentV1,
  type MainTokenMigrationGasSponsorRecordV1,
  type MainTokenMigrationGasSponsorStoreV1,
} from "../lib/server/main-token-migration-gas-sponsor-store-v1";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const SECOND_WALLET = "0x3333333333333333333333333333333333333333" as const;
const SPONSOR = "0x2222222222222222222222222222222222222222" as const;
const TX_HASH = `0x${"ab".repeat(32)}` as const;
const NOW = new Date("2026-08-30T12:00:00.000Z");
const IDEMPOTENCY_KEY = "migration-request-00000001";
const CONFIGURATION: MainTokenMigrationGasSponsorConfigurationV1 = {
  releaseId: "v4-ethereum-to-robinhood-48h-2026-v1",
  startBlockNumber: 100n,
  startBlockHash: `0x${"12".repeat(32)}`,
  deadlineTimestampExclusive: 1_900_000_000,
  sponsorWalletId: "sponsor-wallet-id",
  sponsorPolicyId: "sponsor-policy-id",
  sponsorAddress: SPONSOR,
  maximumTopUpWei: 2_000_000_000_000_000n,
  totalBudgetWei: 172_000_000_000_000n,
};

function key(releaseId: string, walletAddress: string) {
  return `${releaseId}:${walletAddress.toLowerCase()}`;
}

class MemoryStore implements MainTokenMigrationGasSponsorStoreV1 {
  readonly records = new Map<string, MainTokenMigrationGasSponsorRecordV1>();
  readonly aliases = new Map<string, string>();
  readonly admissions:
    Parameters<MainTokenMigrationGasSponsorStoreV1["admit"]>[0][] = [];
  rateLimited = false;
  private gate: Promise<void> = Promise.resolve();

  async admit(input: Parameters<MainTokenMigrationGasSponsorStoreV1["admit"]>[0]) {
    this.admissions.push(input);
    if (this.rateLimited) {
      throw new MainTokenMigrationGasSponsorStoreErrorV1("rate_limited", 17);
    }
  }

  async get(input: { releaseId: string; walletAddress: `0x${string}` }) {
    return this.records.get(key(input.releaseId, input.walletAddress)) ?? null;
  }

  async reserve(input: Parameters<MainTokenMigrationGasSponsorStoreV1["reserve"]>[0]) {
    let unlock: () => void = () => {};
    const previous = this.gate;
    this.gate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    try {
      const recordKey = key(input.lookup.releaseId, input.lookup.walletAddress);
      const alias = this.aliases.get(input.idempotencyBindingHash);
      if (alias !== undefined && alias !== input.requestBindingHash) {
        throw new MainTokenMigrationGasSponsorStoreErrorV1("conflict");
      }
      const existing = this.records.get(recordKey);
      if (existing) {
        return { kind: "existing" as const, record: existing };
      }
      const reservedWei = [...this.records.values()]
        .filter((record) => record.intent.releaseId === input.lookup.releaseId)
        .reduce(
          (total, record) => total + BigInt(record.intent.reservedTotalWei),
          0n,
        );
      if (reservedWei + BigInt(input.intent.reservedTotalWei)
        > BigInt(input.intent.totalBudgetWei)) {
        throw new MainTokenMigrationGasSponsorStoreErrorV1("budget_exhausted");
      }
      this.aliases.set(
        input.idempotencyBindingHash,
        input.requestBindingHash,
      );
      const record = Object.freeze({
        intent: input.intent,
        transactionHash: null,
      });
      this.records.set(recordKey, record);
      return { kind: "created" as const, record };
    } finally {
      unlock();
    }
  }

  async complete(input: Parameters<MainTokenMigrationGasSponsorStoreV1["complete"]>[0]) {
    const recordKey = key(input.lookup.releaseId, input.lookup.walletAddress);
    const current = this.records.get(recordKey);
    if (!current || current.intent.providerReferenceId !== input.providerReferenceId) {
      throw new MainTokenMigrationGasSponsorStoreErrorV1("unavailable");
    }
    if (current.transactionHash !== null &&
      current.transactionHash !== input.transactionHash) {
      throw new MainTokenMigrationGasSponsorStoreErrorV1("conflict");
    }
    const completed = Object.freeze({
      intent: current.intent,
      transactionHash: input.transactionHash,
    });
    this.records.set(recordKey, completed);
    return completed;
  }
}

class IdempotentSender implements MainTokenMigrationGasSponsorSenderV1 {
  readonly calls: MainTokenMigrationGasSponsorIntentV1[] = [];
  readonly hashes = new Map<string, typeof TX_HASH>();
  actualTransfers = 0;
  throwAfterFirstBroadcast = false;
  private threwAmbiguous = false;

  async assertReady() {}

  async send(intent: MainTokenMigrationGasSponsorIntentV1) {
    this.calls.push(intent);
    let hash = this.hashes.get(intent.providerIdempotencyKey);
    if (!hash) {
      hash = TX_HASH;
      this.hashes.set(intent.providerIdempotencyKey, hash);
      this.actualTransfers += 1;
    }
    await Promise.resolve();
    if (this.throwAfterFirstBroadcast && !this.threwAmbiguous) {
      this.threwAmbiguous = true;
      throw new Error("provider response lost after broadcast");
    }
    return hash;
  }
}

function chain(): MainTokenMigrationGasSponsorChainV1 {
  return {
    async observe({ request }) {
      return {
        walletAddress: request.walletAddress,
        amountRaw: request.amountRaw,
        estimatedTransferGas: 52_000n,
        feePerGasWei: 2_000_000_000n,
        maxPriorityFeePerGasWei: 1_000_000_000n,
        nativeBalanceWei: 0n,
        sponsorBalanceWei: 1_000_000_000_000_000_000n,
      };
    },
    async status() {
      return "confirmed";
    },
  };
}

function request(
  walletAddress: `0x${string}` = WALLET,
  idempotencyKey = IDEMPOTENCY_KEY,
) {
  return new Request(
    "https://programmable.market/api/main-token-migration/gas-sponsorship",
    {
      method: "POST",
      headers: {
        authorization: "Bearer privy-access-token",
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
        origin: "https://programmable.market",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({ walletAddress, amountRaw: "100" }),
    },
  );
}

function sponsor(
  store: MemoryStore,
  sender: IdempotentSender,
  now: () => Date = () => NOW,
) {
  return createMainTokenMigrationGasSponsorV1({
    configuration: CONFIGURATION,
    authenticator: {
      async authenticate() {
        return {
          privyUserId: "did:privy:test-user",
          privySessionId: "session-1",
          wallets: [WALLET, SECOND_WALLET],
        };
      },
    },
    store,
    chain: chain(),
    sender,
    now,
  });
}

describe("main token migration gas sponsor", () => {
  it("strictly binds the request, deficit quote, and provider idempotency", () => {
    expect(parseMainTokenMigrationSponsorRequestV1({
      walletAddress: WALLET,
      amountRaw: "100",
    })).toEqual({ walletAddress: WALLET, amountRaw: 100n });
    expect(() => parseMainTokenMigrationSponsorRequestV1({
      walletAddress: WALLET,
      amountRaw: "100",
      extra: true,
    })).toThrow(MainTokenMigrationGasSponsorErrorV1);

    expect(calculateMainTokenMigrationTopUpWeiV1({
      estimatedGas: 52_000n,
      feePerGas: 2_000_000_000n,
      hardCapWei: CONFIGURATION.maximumTopUpWei,
      nativeBalanceWei: 30_000_000_000_000n,
    })).toEqual({
      requiredWei: 130_000_000_000_000n,
      topUpWei: 100_000_000_000_000n,
    });

    const first = deriveMainTokenMigrationSponsorBindingsV1({
      releaseId: CONFIGURATION.releaseId,
      walletAddress: WALLET,
      amountRaw: 100n,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    const replayWithDifferentClientKey =
      deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: WALLET,
        amountRaw: 100n,
        idempotencyKey: "migration-request-00000002",
      });
    expect(first.requestBindingHash).not.toBe(
      replayWithDifferentClientKey.requestBindingHash,
    );
    expect(first.providerIdempotencyKey).toBe(
      replayWithDifferentClientKey.providerIdempotencyKey,
    );
    expect(first.providerReferenceId).toBe(
      replayWithDifferentClientKey.providerReferenceId,
    );
    expect(deriveMainTokenMigrationSponsorPrincipalBindingV1(
      "did:privy:test-user",
    )).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("attests the exact Privy wallet, chain, address, and sole policy", () => {
    const wallet = {
      id: CONFIGURATION.sponsorWalletId,
      chain_type: "ethereum",
      address: CONFIGURATION.sponsorAddress,
      policy_ids: [CONFIGURATION.sponsorPolicyId],
    };
    expect(() => assertMainTokenMigrationPrivySponsorWalletV1(
      wallet,
      CONFIGURATION,
    )).not.toThrow();
    for (const policy_ids of [
      [],
      [CONFIGURATION.sponsorPolicyId, "unexpected-policy-id"],
      ["unexpected-policy-id"],
      undefined,
    ]) {
      expect(() => assertMainTokenMigrationPrivySponsorWalletV1(
        { ...wallet, policy_ids },
        CONFIGURATION,
      )).toThrowError(MainTokenMigrationGasSponsorErrorV1);
    }
    for (const mismatch of [
      { id: "unexpected-wallet-id" },
      { chain_type: "solana" },
      { address: SECOND_WALLET },
    ]) {
      expect(() => assertMainTokenMigrationPrivySponsorWalletV1(
        { ...wallet, ...mismatch },
        CONFIGURATION,
      )).toThrowError(MainTokenMigrationGasSponsorErrorV1);
    }
  });

  it("durably admits the authenticated principal before sender or RPC work", async () => {
    const store = new MemoryStore();
    store.rateLimited = true;
    const sender = new IdempotentSender();
    sender.assertReady = vi.fn();
    const observed = vi.fn();
    const handler = createMainTokenMigrationGasSponsorV1({
      configuration: CONFIGURATION,
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:test-user",
            privySessionId: "session-1",
            wallets: [WALLET],
          };
        },
      },
      store,
      chain: {
        async observe(input) {
          observed(input);
          return chain().observe(input);
        },
        async status() {
          return "confirmed";
        },
      },
      sender,
      now: () => NOW,
    });

    const blocked = await handler.post(request());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("17");
    expect((await blocked.json()).error.code).toBe("rate_limited");
    expect(store.admissions).toHaveLength(1);
    expect(store.admissions[0]).toMatchObject({
      operation: "submit",
      releaseId: CONFIGURATION.releaseId,
      walletAddress: WALLET,
    });
    expect(sender.assertReady).not.toHaveBeenCalled();
    expect(observed).not.toHaveBeenCalled();
  });

  it("persists bounded principal and holder admission slots in PostgreSQL", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE SCHEMA programmable_website_projection_v1;
        CREATE TABLE programmable_website_projection_v1.credential_uses (
          credential_id text PRIMARY KEY,
          request_binding_hash text NOT NULL,
          canonical_use text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT clock_timestamp()
        );
      `);
      const store = createMainTokenMigrationGasSponsorPostgresStoreV1(
        new SponsorTestPool(database),
      );
      const principalBindingHash =
        deriveMainTokenMigrationSponsorPrincipalBindingV1(
          "did:privy:persistent-rate-test",
        );
      for (let index = 0; index < 8; index += 1) {
        await store.admit({
          releaseId: CONFIGURATION.releaseId,
          principalBindingHash,
          walletAddress: WALLET,
          operation: "read",
        });
      }
      await expect(store.admit({
        releaseId: CONFIGURATION.releaseId,
        principalBindingHash,
        walletAddress: WALLET,
        operation: "read",
      })).rejects.toMatchObject({
        code: "rate_limited",
      });

      const rows = await database.query<{ count: string }>(`
        SELECT count(*)::text AS count
          FROM programmable_website_projection_v1.credential_uses
         WHERE credential_id LIKE '%:admission:%'
      `);
      expect(rows.rows[0]?.count).toBe("16");

      const firstBindings = deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: WALLET,
        amountRaw: 100n,
        idempotencyKey: "migration-request-00000011",
      });
      const firstIntent = testIntent(firstBindings.requestBindingHash);
      expect((await store.reserve({
        lookup: {
          releaseId: CONFIGURATION.releaseId,
          walletAddress: WALLET,
        },
        idempotencyBindingHash: firstBindings.idempotencyBindingHash,
        requestBindingHash: firstBindings.requestBindingHash,
        intent: firstIntent,
      })).kind).toBe("created");

      const replayBindings = deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: CONFIGURATION.releaseId,
        walletAddress: WALLET,
        amountRaw: 100n,
        idempotencyKey: "migration-request-00000012",
      });
      expect((await store.reserve({
        lookup: {
          releaseId: CONFIGURATION.releaseId,
          walletAddress: WALLET,
        },
        idempotencyBindingHash: replayBindings.idempotencyBindingHash,
        requestBindingHash: replayBindings.requestBindingHash,
        intent: testIntent(replayBindings.requestBindingHash),
      })).kind).toBe("existing");
      const aliases = await database.query<{ count: string }>(`
        SELECT count(*)::text AS count
          FROM programmable_website_projection_v1.credential_uses
         WHERE credential_id LIKE '%:idempotency:%'
      `);
      expect(aliases.rows[0]?.count).toBe("1");
    } finally {
      await database.close();
    }
  });

  it("reserves concurrent duplicates once and never broadcasts twice", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    const handler = sponsor(store, sender);

    const [left, right] = await Promise.all([
      handler.post(request()),
      handler.post(request()),
    ]);

    expect([left.status, right.status].sort()).toEqual([200, 503]);
    const bodies = await Promise.all([left.json(), right.json()]);
    expect(bodies.some((body) => body.transactionHash === TX_HASH)).toBe(true);
    expect(bodies.some(
      (body) => body.error?.code === "submission_unknown",
    )).toBe(true);
    expect([left, right].find((response) => response.status === 200)
      ?.headers.get("retry-after")).toBe("10");
    expect(sender.actualTransfers).toBe(1);
    expect(sender.calls).toHaveLength(1);
    expect([...store.records.values()][0]?.transactionHash).toBe(TX_HASH);
  });

  it("returns the holder record without growing aliases for fresh client keys", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    const handler = sponsor(store, sender);

    expect((await handler.post(request())).status).toBe(200);
    expect((await handler.post(request(
      WALLET,
      "migration-request-00000002",
    ))).status).toBe(200);

    expect(store.aliases.size).toBe(1);
    expect(sender.calls).toHaveLength(1);
    expect(sender.actualTransfers).toBe(1);
  });

  it("atomically refuses a second holder once the release budget is reserved", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    const handler = sponsor(store, sender);

    const responses = await Promise.all([
      handler.post(request(WALLET, "migration-request-00000001")),
      handler.post(request(SECOND_WALLET, "migration-request-00000002")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200,
      503,
    ]);
    const bodies = await Promise.all(responses.map((response) => response.json()));
    expect(bodies.some(
      (body) => body.error?.code === "sponsor_budget_exhausted",
    )).toBe(true);
    expect(sender.calls).toHaveLength(1);
    expect(sender.actualTransfers).toBe(1);
    expect(store.records.size).toBe(1);
    expect(sender.calls[0]).toMatchObject({
      topUpWei: "130000000000000",
      sponsorGasLimit:
        MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1.toString(),
      sponsorMaxFeePerGasWei: "2000000000",
      sponsorMaxPriorityFeePerGasWei: "1000000000",
      reservedTotalWei: "172000000000000",
      totalBudgetWei: "172000000000000",
    });
  });

  it("never resends after an ambiguous provider outcome", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    sender.throwAfterFirstBroadcast = true;
    const handler = sponsor(store, sender);

    const unknown = await handler.post(request());
    expect(unknown.status).toBe(503);
    expect((await unknown.json()).error.code).toBe("submission_unknown");
    expect(sender.actualTransfers).toBe(1);
    expect([...store.records.values()][0]?.transactionHash).toBeNull();

    const duplicate = await handler.post(request());
    expect(duplicate.status).toBe(503);
    expect((await duplicate.json()).error.code).toBe("submission_unknown");
    expect(sender.actualTransfers).toBe(1);
    expect(sender.calls).toHaveLength(1);
    expect([...store.records.values()][0]?.transactionHash).toBeNull();
  });

  it("rechecks the deadline on every request from a cached handler", async () => {
    const store = new MemoryStore();
    const sender = new IdempotentSender();
    let current = NOW;
    const handler = sponsor(store, sender, () => current);

    current = new Date(CONFIGURATION.deadlineTimestampExclusive * 1_000);
    const expired = await handler.post(request());

    expect(expired.status).toBe(503);
    expect(sender.calls).toHaveLength(0);
    expect(store.records.size).toBe(0);
  });
});

function testIntent(
  requestBindingHash: `sha256:${string}`,
): MainTokenMigrationGasSponsorIntentV1 {
  return Object.freeze({
    schema: "programmable-main-token-migration-gas-sponsorship-intent/v1",
    releaseId: CONFIGURATION.releaseId,
    walletAddress: WALLET,
    sponsorAddress: SPONSOR,
    amountRaw: "100",
    topUpWei: "130000000000000",
    totalBudgetWei: CONFIGURATION.totalBudgetWei.toString(),
    sponsorGasLimit:
      MAIN_TOKEN_MIGRATION_GAS_SPONSOR_GAS_LIMIT_V1.toString(),
    sponsorMaxFeePerGasWei: "2000000000",
    sponsorMaxPriorityFeePerGasWei: "1000000000",
    reservedTotalWei: "172000000000000",
    estimatedTransferGas: "52000",
    feePerGasWei: "2000000000",
    requestBindingHash,
    providerIdempotencyKey: "mtmgs-test-provider-idempotency",
    providerReferenceId: "mtmgs-test-provider-reference",
    reservedAt: NOW.toISOString(),
  });
}

class SponsorTestPool {
  constructor(private readonly database: PGlite) {}

  async assertProductionReadiness() {}

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    return Object.freeze({
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => this.query<Row>(text, values),
      release() {},
    });
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const result = await this.database.query<Row>(text, [...values]);
    return Object.freeze({
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    });
  }
}
