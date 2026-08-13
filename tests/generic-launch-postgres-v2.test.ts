import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalizeJson, type JsonValue } from
  "../lib/server/projection-target/canonical-json";
import { canonicalSha256 } from
  "../lib/server/projection-target/hashing";
import type {
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresPoolV1,
  ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";
import { createGenericLaunchRecordV2 } from
  "../lib/server/custom-launch/generic-launch-contract-v2";
import {
  assertPostgresGenericLaunchReadStoreReadyV2,
  createPostgresGenericLaunchMaterializationStoreV2,
  createPostgresGenericLaunchReadStoreV2,
  listStaleGenericLaunchApprovalsV2,
} from "../lib/server/custom-launch/generic-launch-postgres-v2";

const sha = (value: string) => `sha256:${value.repeat(64)}` as const;
const hash = (value: string) => `0x${value.repeat(64)}` as const;
const address = (value: string) => `0x${value.repeat(40)}` as const;
const APPROVAL_ID = hash("1");
const LAUNCH_ID = hash("4");
const DESCRIPTOR_HASH = hash("3");

describe("Generic launch V2 Postgres materialization/read store", () => {
  it("appends lifecycle generations and hides finalized bytes after revocation", async () => {
    const database = new PGlite();
    try {
      await migrate(database);
      const pool = new TestPool(database);
      await insertApproval(pool);
      const store = createPostgresGenericLaunchMaterializationStoreV2(pool);
      const record = launchRecord();
      const signal = new AbortController().signal;

      expect(await store.getApprovalAuthorization({ approvalId: APPROVAL_ID, signal }))
        .toMatchObject({
          authorization: { artifact: { accepted: true } },
          receivedAt: expect.any(Date),
        });
      expect((await store.putIfNewLifecycle({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        lifecycleEvidenceHash: sha("a"),
        state: "finalized",
        record,
        signal,
      })).kind).toBe("created");
      expect((await store.putIfNewLifecycle({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        lifecycleEvidenceHash: sha("a"),
        state: "finalized",
        record,
        signal,
      })).kind).toBe("existing");
      await store.putApprovalReconciliation({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        outcome: "consumed",
        observationCommonHead: "112",
        observationCommonHeadHash: hash("e"),
        signal,
      });
      await expect(assertPostgresGenericLaunchReadStoreReadyV2(pool, 180_000))
        .resolves.toBeUndefined();

      const signedPayloads: JsonValue[] = [];
      const readStore = createPostgresGenericLaunchReadStoreV2({
        pool,
        maximumLifecycleAgeMs: 180_000,
        signer: {
          binding: {} as never,
          async sign({ payload }) {
            signedPayloads.push(payload);
            return canonicalizeJson(payload);
          },
        },
        readModelContract: readContract(),
      });
      await readStore.findFinalizedLaunches({
        limit: 10, requestBindingHash: sha("b"), signal,
      });
      await readStore.findFinalizedLaunchByRecordHash({
        recordHash: record.recordHash, requestBindingHash: sha("c"), signal,
      });
      expect(signedPayloads[0]).toMatchObject({ records: [record], total: "1" });
      expect(signedPayloads[1]).toEqual(record);

      await expect(store.putIfNewLifecycle({
        approvalId: hash("f"),
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        lifecycleEvidenceHash: sha("f"),
        state: "revoked",
        record: null,
        signal,
      })).rejects.toThrow(/canonical lifecycle identity/u);

      expect((await store.putIfNewLifecycle({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        lifecycleEvidenceHash: sha("d"),
        state: "revoked",
        record: null,
        signal,
      })).kind).toBe("created");
      await store.putApprovalReconciliation({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        outcome: "consumed",
        observationCommonHead: "120",
        observationCommonHeadHash: hash("f"),
        signal,
      });
      signedPayloads.length = 0;
      await readStore.findFinalizedLaunches({
        limit: 10, requestBindingHash: sha("e"), signal,
      });
      await readStore.findFinalizedLaunchByRecordHash({
        recordHash: record.recordHash, requestBindingHash: sha("f"), signal,
      });
      expect(signedPayloads).toEqual([
        { records: [], nextCursor: null, total: "0" },
        null,
      ]);
      expect((await store.putIfNewLifecycle({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        lifecycleEvidenceHash: sha("a"),
        state: "finalized",
        record,
        signal,
      })).kind).toBe("created");
      await store.putApprovalReconciliation({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        outcome: "consumed",
        observationCommonHead: "124",
        observationCommonHeadHash: hash("9"),
        signal,
      });
      signedPayloads.length = 0;
      await readStore.findFinalizedLaunchByRecordHash({
        recordHash: record.recordHash, requestBindingHash: sha("9"), signal,
      });
      expect(signedPayloads).toEqual([record]);
      await expect(pool.query(`
        UPDATE programmable_website_projection_v1.generic_launch_materializations_v2
           SET lifecycle_state = 'finalized'
      `)).rejects.toThrow();
    } finally {
      await database.close();
    }
  }, 20_000);

  it("rejects hosted RLS, policy or grant drift", async () => {
    const database = new PGlite();
    try {
      await migrate(database);
      const pool = new TestPool(database);
      await insertApproval(pool);
      const store = createPostgresGenericLaunchMaterializationStoreV2(pool);
      await store.putIfNewLifecycle({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        lifecycleEvidenceHash: sha("a"),
        state: "finalized",
        record: launchRecord(),
        signal: new AbortController().signal,
      });
      await store.putApprovalReconciliation({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        outcome: "consumed",
        observationCommonHead: "112",
        observationCommonHeadHash: hash("e"),
        signal: new AbortController().signal,
      });
      await expect(assertPostgresGenericLaunchReadStoreReadyV2(pool, 180_000))
        .resolves.toBeUndefined();
      await database.exec(`
        RESET ROLE;
        GRANT TRUNCATE
          ON programmable_website_projection_v1.generic_launch_materializations_v2
          TO PUBLIC;
        SET ROLE programmable_website_projection_runtime;
      `);
      await expect(assertPostgresGenericLaunchReadStoreReadyV2(pool, 180_000))
        .rejects.toThrow(/storage posture/u);
      await database.exec(`
        RESET ROLE;
        REVOKE TRUNCATE
          ON programmable_website_projection_v1.generic_launch_materializations_v2
          FROM PUBLIC;
        DROP POLICY generic_launch_materializations_v2_runtime_insert
          ON programmable_website_projection_v1.generic_launch_materializations_v2;
        SET ROLE programmable_website_projection_runtime;
      `);
      await expect(assertPostgresGenericLaunchReadStoreReadyV2(pool, 180_000))
        .rejects.toThrow(/storage posture/u);
    } finally {
      await database.close();
    }
  }, 20_000);

  it("fails closed on an old delivered Approval with no materialization", async () => {
    const database = new PGlite();
    try {
      await migrate(database);
      const pool = new TestPool(database);
      await insertApproval(pool);
      await database.exec(`
        RESET ROLE;
        UPDATE programmable_website_projection_v1.projection_records
           SET created_at = clock_timestamp() - interval '4 minutes'
         WHERE lane = 'website.approval-v3';
        SET ROLE programmable_website_projection_runtime;
      `);
      await expect(assertPostgresGenericLaunchReadStoreReadyV2(pool, 180_000))
        .rejects.toThrow(/stale/u);
    } finally {
      await database.close();
    }
  }, 20_000);

  it("claims due Approvals fairly even when the first attempt fails", async () => {
    const database = new PGlite();
    try {
      await migrate(database);
      const pool = new TestPool(database);
      const secondApprovalId = hash("2");
      await insertApproval(pool);
      await insertApproval(pool, secondApprovalId, "5");
      const signal = new AbortController().signal;
      expect(await listStaleGenericLaunchApprovalsV2(pool, {
        refreshAfterMs: 60_000,
        leaseMs: 55_000,
        limit: 1,
        signal,
      })).toEqual([APPROVAL_ID]);
      expect(await listStaleGenericLaunchApprovalsV2(pool, {
        refreshAfterMs: 60_000,
        leaseMs: 55_000,
        limit: 1,
        signal,
      })).toEqual([secondApprovalId]);
    } finally {
      await database.close();
    }
  }, 20_000);

  it("fails closed on a stale lifecycle until the approval is reconciled", async () => {
    const database = new PGlite();
    try {
      await migrate(database);
      const pool = new TestPool(database);
      await insertApproval(pool);
      const store = createPostgresGenericLaunchMaterializationStoreV2(pool);
      const record = launchRecord();
      const signal = new AbortController().signal;
      await store.putIfNewLifecycle({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        lifecycleEvidenceHash: sha("a"),
        state: "finalized",
        record,
        signal,
      });
      await store.putApprovalReconciliation({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        outcome: "consumed",
        observationCommonHead: "112",
        observationCommonHeadHash: hash("e"),
        signal,
      });
      await database.exec(`
        RESET ROLE;
        UPDATE programmable_website_projection_v1.generic_launch_reconciliations_v2
           SET observed_at = clock_timestamp() - interval '4 minutes';
        SET ROLE programmable_website_projection_runtime;
      `);
      const readStore = createPostgresGenericLaunchReadStoreV2({
        pool,
        maximumLifecycleAgeMs: 180_000,
        signer: {
          binding: {} as never,
          async sign({ payload }) { return canonicalizeJson(payload); },
        },
        readModelContract: readContract(),
      });

      await expect(readStore.findFinalizedLaunches({
        limit: 10, requestBindingHash: sha("b"), signal,
      })).rejects.toThrow(/stale/u);
      await expect(readStore.findFinalizedLaunchByRecordHash({
        recordHash: record.recordHash, requestBindingHash: sha("c"), signal,
      })).rejects.toThrow(/stale/u);
      expect(await listStaleGenericLaunchApprovalsV2(pool, {
        refreshAfterMs: 60_000,
        leaseMs: 55_000,
        limit: 8,
        signal,
      })).toEqual([APPROVAL_ID]);

      await store.putIfNewLifecycle({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        lifecycleEvidenceHash: sha("d"),
        state: "revoked",
        record: null,
        signal,
      });
      await store.putApprovalReconciliation({
        approvalId: APPROVAL_ID,
        launchId: LAUNCH_ID,
        descriptorHash: DESCRIPTOR_HASH,
        outcome: "consumed",
        observationCommonHead: "120",
        observationCommonHeadHash: hash("f"),
        signal,
      });
      expect(await listStaleGenericLaunchApprovalsV2(pool, {
        refreshAfterMs: 60_000,
        leaseMs: 55_000,
        limit: 8,
        signal,
      })).toEqual([]);
      await expect(readStore.findFinalizedLaunches({
        limit: 10, requestBindingHash: sha("e"), signal,
      })).resolves.toBe(canonicalizeJson({
        records: [], nextCursor: null, total: "0",
      }));
    } finally {
      await database.close();
    }
  }, 20_000);
});

function launchRecord() {
  return createGenericLaunchRecordV2({
    readModelBindingHash: canonicalSha256(
      "programmable.generic-launch-read-model-contract.v2",
      readContract(),
    ),
    sourceProjection: {
      schemaVersion: "programmable.generic-launch-source-projection.v2",
      sourceRevision: {
        repositoryId: "123", repositoryFullName: "alice/example-hook",
        commitObjectId: "3".repeat(40), treeObjectId: "4".repeat(40),
      },
      approval: {
        approvalRevision: "7", approvalId: APPROVAL_ID,
        approvalEvidenceHash: hash("2"), signedReceiptArtifactHash: sha("2"),
      },
      descriptor: {
        descriptorHash: DESCRIPTOR_HASH, launchId: LAUNCH_ID,
        launchWallet: address("5"), primaryContract: address("7"),
        primaryRuntimeCodeHash: hash("8"), componentSetHash: hash("9"),
        sourceArtifactHash: hash("a"), configurationHash: hash("b"),
        launchPlanHash: hash("c"), projectCommitment: hash("d"),
        marketMode: "Standard10", marketModeValue: 1, protocolFeeBps: 10,
      },
      lifecycle: {
        chainId: "1", generation: "2", registryAddress: address("6"),
        registryRuntimeCodeKeccak256: hash("7"),
        registryPolicyCommitment: hash("8"), minimumFinalityBlocks: "12",
        primaryLaunch: {
          transactionHash: hash("9"), sender: address("5"), blockHash: hash("a"),
          blockNumber: "88", transactionIndex: "2", status: "success",
        },
        authorization: event("CustomLaunchApprovalAuthorizedV2", "a", "b", "90", "3", "4"),
        registration: [
          event("CustomLaunchRegisteredV2", "b", "c", "95", "4", "5"),
          event("CustomLaunchDescriptorCommittedV2", "b", "c", "95", "4", "6"),
          event("CustomLaunchDescriptorEvidenceCommittedV2", "b", "c", "95", "4", "7"),
        ],
        finalization: event("CustomLaunchFinalizedV2", "c", "d", "100", "5", "8"),
        latestCommonHead: "112", latestCommonHeadHash: hash("e"),
        latestStatus: "finalized", revokedAtBlock: "0",
        revocationEvidenceHash: hash("0"),
      },
    },
  });
}

function event<Name extends string>(
  eventName: Name,
  transaction: string,
  block: string,
  blockNumber: string,
  transactionIndex: string,
  logIndex: string,
) {
  return {
    eventName, transactionHash: hash(transaction), blockHash: hash(block),
    blockNumber, transactionIndex, logIndex, removed: false as const,
  };
}

function readContract() {
  return {
    schemaVersion: "programmable.generic-launch-read-model-contract.v2" as const,
    sourceLane: "generic.finalized-launch-v2" as const,
    implementationBindingHash: sha("1"), persistenceBindingHash: sha("2"),
    queryContractBindingHash: sha("3"),
    approvalArtifactSchemaBindingHash: sha("4"),
    approvalReleaseBindingHash: sha("5"),
    registryProjectionBindingHash: sha("6"),
  };
}

async function insertApproval(
  pool: TestPool,
  approvalId: `0x${string}` = APPROVAL_ID,
  salt = "2",
) {
  const readback = canonicalizeJson({
    schemaVersion: "programmable.approval-v3-artifact-projection-readback.v1",
    approvalId,
    authorization: { artifact: { accepted: true } },
  });
  const acknowledgement = canonicalizeJson({ acknowledged: true });
  const write = canonicalizeJson({ write: true });
  await pool.query(`
    INSERT INTO programmable_website_projection_v1.projection_records
      (lane, target_binding_hash, audience, projection_key, idempotency_key,
       request_digest, canonical_write, canonical_acknowledgement,
       canonical_readback, record_binding_hash)
    VALUES ('website.approval-v3', $1, 'approval', $2, $3, $4, $5, $6, $7, $8)
  `, [sha("1"), `approval:${approvalId}`, sha(salt), sha(`${Number(salt) + 1}`), write,
    acknowledgement, readback, sha(`${Number(salt) + 2}`)]);
}

async function migrate(database: PGlite) {
  await database.exec(`
    CREATE ROLE programmable_website_projection_runtime NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  for (const path of [
    "../ops/website-projection-target/migrations/0001_projection_records_v1.sql",
    "../ops/website-projection-target/migrations/0002_custom_launch_wallet_profile_v2.sql",
    "../ops/website-projection-target/migrations/0003_registry_custom_public_read_v1.sql",
    "../ops/website-projection-target/migrations/0004_approval_v3_artifacts_v1.sql",
    "../ops/website-projection-target/migrations/0005_generic_launch_materializations_v2.sql",
  ]) await database.exec(await readFile(new URL(path, import.meta.url), "utf8"));
  await database.exec(`
    GRANT USAGE ON SCHEMA programmable_website_projection_v1
      TO programmable_website_projection_runtime;
    GRANT SELECT, INSERT
      ON programmable_website_projection_v1.projection_records
      TO programmable_website_projection_runtime;
    SET ROLE programmable_website_projection_runtime;
  `);
}

class TestPool implements ProjectionTargetPostgresPoolV1 {
  constructor(private readonly database: PGlite) {}
  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    return {
      query: <Row extends Record<string, unknown>>(
        text: string, values: readonly unknown[] = [],
      ) => this.query<Row>(text, values),
      release() {},
    };
  }
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const result = await this.database.query<Row>(text, [...values]);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  }
}
