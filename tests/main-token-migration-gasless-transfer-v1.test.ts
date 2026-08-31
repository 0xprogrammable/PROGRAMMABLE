import { PGlite } from "@electric-sql/pglite";
import { keccak256, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildMainTokenMigrationPermitTypedData,
  MAIN_TOKEN_MIGRATION_RELEASE_ID,
  MAIN_TOKEN_MIGRATION_WALLET,
} from "../lib/main-token-migration";
import {
  createMainTokenMigrationGaslessTransferV1,
  deriveMainTokenMigrationGaslessBindingV1,
} from "../lib/server/main-token-migration-gasless-transfer-v1";
import type {
  MainTokenMigrationGaslessRecordV1,
} from "../lib/server/main-token-migration-gasless-transfer-store-v1";
import {
  createMainTokenMigrationGaslessPostgresStoreV1,
} from "../lib/server/main-token-migration-gasless-transfer-store-v1";
import {
  deriveMainTokenMigrationSponsorBindingsV1,
} from "../lib/server/main-token-migration-gas-sponsor-v1";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";

const account = privateKeyToAccount(
  keccak256(stringToHex("programmable gasless migration test account")),
);
const sponsorAddress = "0x0060f9E57FCcc0611ef44809B257919e78Aa99Ac";
const permitHash = `0x${"11".repeat(32)}` as const;
const transferHash = `0x${"22".repeat(32)}` as const;
const now = new Date("2026-08-31T10:00:00.000Z");
const idempotencyKey = "gasless-test-request-0001";

const configuration = {
  releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
  windowStartTimestamp: 1_788_159_300,
  startBlockNumber: 25_873_498n,
  startBlockHash: `0x${"33".repeat(32)}` as const,
  deadlineTimestampExclusive: 1_788_418_500,
  sponsorWalletId: "wallet-test-0001",
  sponsorPolicyId: "policy-test-0001",
  sponsorAddress,
  maximumTopUpWei: 2_000_000_000_000_000n,
  totalBudgetWei: 1_000_000_000_000_000_000n,
} as const;

function request(body: unknown) {
  return new Request("https://programmable.market/api/main-token-migration/gasless-transfer", {
    method: "POST",
    headers: {
      authorization: "Bearer test",
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      origin: "https://programmable.market",
      "sec-fetch-site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe("main token migration gasless permit transfer", () => {
  it("binds the signature and relays only the exact fixed-destination transfer", async () => {
    let record: MainTokenMigrationGaslessRecordV1 | null = null;
    const store = {
      async get() {
        return record;
      },
      async reserve(input: { intent: MainTokenMigrationGaslessRecordV1["intent"] }) {
        record = {
          intent: input.intent,
          permitTransactionHash: null,
          transferTransactionHash: null,
        };
        return { kind: "created" as const, record };
      },
      async complete(input: {
        kind: "permit" | "transfer";
        transactionHash: typeof permitHash | typeof transferHash;
      }) {
        if (!record) throw new Error("missing intent");
        record = {
          ...record,
          permitTransactionHash: input.kind === "permit"
            ? input.transactionHash
            : record.permitTransactionHash,
          transferTransactionHash: input.kind === "transfer"
            ? input.transactionHash
            : record.transferTransactionHash,
        };
        return record;
      },
    };
    const sender = {
      async assertReady() {},
      async lookup() {
        return null;
      },
      async send(kind: "permit" | "transfer") {
        return kind === "permit" ? permitHash : transferHash;
      },
    };
    const handler = createMainTokenMigrationGaslessTransferV1({
      configuration,
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:test",
            privySessionId: "session-test",
            wallets: [account.address],
          };
        },
      },
      admissionStore: { async admit() {} } as never,
      store: store as never,
      chain: {
        async prepare() {
          return {
            nonce: 0n,
            feePerGasWei: 1_000_000_000n,
            maxPriorityFeePerGasWei: 100_000_000n,
            sponsorBalanceWei: 1_000_000_000_000_000_000n,
            rootWalletAddress: account.address,
          };
        },
        async assertPermitEffect() {},
        async transactionStatus(kind: "permit" | "transfer") {
          return kind === "permit"
            ? ({ status: "confirmed", blockNumber: 25_900_001n } as const)
            : ({ status: "confirmed", blockNumber: 25_900_002n } as const);
        },
      } as never,
      sender: sender as never,
      now: () => now,
    });

    const preparedResponse = await handler.post(request({
      action: "prepare",
      amountRaw: "100",
      walletAddress: account.address,
    }));
    expect(preparedResponse.status).toBe(200);
    const prepared = await preparedResponse.json() as {
      nonce: string;
      permitDeadline: string;
      requestBindingHash: `sha256:${string}`;
      sponsorAddress: `0x${string}`;
      status: string;
      transferBlockNumber: string | null;
    };
    expect(prepared).toMatchObject({
      status: "signature_required",
      nonce: "0",
      sponsorAddress,
      transferBlockNumber: null,
    });
    const signature = await account.signTypedData(
      buildMainTokenMigrationPermitTypedData({
        owner: account.address,
        spender: sponsorAddress,
        value: 100n,
        nonce: BigInt(prepared.nonce),
        deadline: BigInt(prepared.permitDeadline),
      }),
    );
    const submitBody = {
      action: "submit",
      amountRaw: "100",
      nonce: prepared.nonce,
      permitDeadline: prepared.permitDeadline,
      permitSignature: signature,
      requestBindingHash: prepared.requestBindingHash,
      walletAddress: account.address,
    };
    const permitResponse = await handler.post(request(submitBody));
    expect(await permitResponse.json()).toMatchObject({
      status: "permit_submitted",
      permitTransactionHash: permitHash,
      transferTransactionHash: null,
    });
    const transferResponse = await handler.post(request(submitBody));
    expect(await transferResponse.json()).toMatchObject({
      status: "transfer_submitted",
      permitTransactionHash: permitHash,
      transferTransactionHash: transferHash,
      transferBlockNumber: null,
    });
    const confirmedResponse = await handler.post(request(submitBody));
    expect(await confirmedResponse.json()).toMatchObject({
      status: "confirmed",
      permitTransactionHash: permitHash,
      transferTransactionHash: transferHash,
      transferBlockNumber: "25900002",
    });
    const finalRecord = record as MainTokenMigrationGaslessRecordV1 | null;
    expect(finalRecord?.intent.walletAddress).toBe(account.address);
    expect(finalRecord?.intent.amountRaw).toBe("100");
    expect(MAIN_TOKEN_MIGRATION_WALLET).not.toBe(account.address);
  });

  it("rejects a permit signed by a different wallet", async () => {
    const other = privateKeyToAccount(
      keccak256(stringToHex("programmable gasless migration other account")),
    );
    const handler = createMainTokenMigrationGaslessTransferV1({
      configuration,
      authenticator: {
        async authenticate() {
          return {
            privyUserId: "did:privy:test",
            privySessionId: "session-test",
            wallets: [account.address],
          };
        },
      },
      admissionStore: { async admit() {} } as never,
      store: { async get() { return null; } } as never,
      chain: {
        async prepare() {
          return {
            nonce: 0n,
            feePerGasWei: 1n,
            maxPriorityFeePerGasWei: 0n,
            sponsorBalanceWei: 1_000_000n,
            rootWalletAddress: account.address,
          };
        },
      } as never,
      sender: {} as never,
      now: () => now,
    });
    const preparedResponse = await handler.post(request({
      action: "prepare",
      amountRaw: "100",
      walletAddress: account.address,
    }));
    const prepared = await preparedResponse.json() as {
      nonce: string;
      permitDeadline: string;
      requestBindingHash: `sha256:${string}`;
    };
    const signature = await other.signTypedData(
      buildMainTokenMigrationPermitTypedData({
        owner: account.address,
        spender: sponsorAddress,
        value: 100n,
        nonce: 0n,
        deadline: BigInt(prepared.permitDeadline),
      }),
    );
    const response = await handler.post(request({
      action: "submit",
      amountRaw: "100",
      nonce: "0",
      permitDeadline: prepared.permitDeadline,
      permitSignature: signature,
      requestBindingHash: prepared.requestBindingHash,
      walletAddress: account.address,
    }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "signature_invalid" },
    });
  });

  it("durably binds one root wallet and both exact relayer transactions", async () => {
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
      const store = createMainTokenMigrationGaslessPostgresStoreV1(
        new GaslessTestPool(database) as never,
      );
      const base = deriveMainTokenMigrationSponsorBindingsV1({
        releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
        walletAddress: account.address,
        amountRaw: 100n,
        idempotencyKey,
      });
      const binding = deriveMainTokenMigrationGaslessBindingV1({
        baseRequestBindingHash: base.requestBindingHash,
        nonce: 0n,
        permitDeadline: 1_788_169_000n,
      });
      const signature = await account.signTypedData(
        buildMainTokenMigrationPermitTypedData({
          owner: account.address,
          spender: sponsorAddress,
          value: 100n,
          nonce: 0n,
          deadline: 1_788_169_000n,
        }),
      );
      const lookup = {
        releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
        walletAddress: account.address,
      };
      const reserved = await store.reserve({
        lookup,
        idempotencyBindingHash: base.idempotencyBindingHash,
        intent: {
          schema: "programmable-main-token-migration-gasless-intent/v1",
          releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
          walletAddress: account.address,
          rootWalletAddress: account.address,
          sponsorAddress,
          amountRaw: "100",
          nonce: "0",
          permitDeadline: "1788169000",
          permitSignature: signature,
          permitGasLimit: "100000",
          transferGasLimit: "100000",
          maxFeePerGasWei: "1000000000",
          maxPriorityFeePerGasWei: "100000000",
          reservedTotalWei: "200000000000000",
          totalBudgetWei: "1000000000000000000",
          requestBindingHash: binding,
          providerPermitIdempotencyKey: "mtmgp-store-test-0001",
          providerPermitReferenceId: "mtmgp-store-test-0001",
          providerTransferIdempotencyKey: "mtmgt-store-test-0001",
          providerTransferReferenceId: "mtmgt-store-test-0001",
          reservedAt: now.toISOString(),
        },
      });
      expect(reserved.kind).toBe("created");
      await store.complete({
        lookup,
        kind: "permit",
        providerReferenceId: "mtmgp-store-test-0001",
        transactionHash: permitHash,
      });
      const completed = await store.complete({
        lookup,
        kind: "transfer",
        providerReferenceId: "mtmgt-store-test-0001",
        transactionHash: transferHash,
      });
      expect(completed).toMatchObject({
        permitTransactionHash: permitHash,
        transferTransactionHash: transferHash,
        intent: {
          walletAddress: account.address,
          rootWalletAddress: account.address,
          amountRaw: "100",
        },
      });
      await expect(store.reserve({
        lookup: {
          releaseId: MAIN_TOKEN_MIGRATION_RELEASE_ID,
          walletAddress: "0x1111111111111111111111111111111111111111",
        },
        idempotencyBindingHash: base.idempotencyBindingHash,
        intent: {
          ...reserved.record.intent,
          walletAddress: "0x1111111111111111111111111111111111111111",
        },
      })).rejects.toMatchObject({ code: "conflict" });
    } finally {
      await database.close();
    }
  }, 10_000);
});

class GaslessTestPool {
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
