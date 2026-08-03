import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPromotionLeaseRowsDrained,
  attestCandidateDatabasePromotion,
  buildDatabasePromotionInput,
  waitForProjectorLeaseDrain,
} from "./cutover-database.mjs";

const HASH = `0x${"1".repeat(64)}`;

test("database promotion binds Envio, inventory, product and staged deployment", () => {
  const input = buildDatabasePromotionInput({
    candidateEndpointIdentity: "envio:d7a39a2",
    envioProviderDeploymentId: "123e4567-e89b-42d3-a456-426614174000",
    baselineCommitment: HASH,
    candidateInventoryParityCommitment: `0x${"2".repeat(64)}`,
    envioPromotionAttestationCommitment: `0x${"3".repeat(64)}`,
    productCommit: "a".repeat(40),
    stagedDeploymentId: "dpl_12345678901234567890",
    promotedAt: "2026-08-01T08:00:00.000Z",
  });
  assert.match(input.inputCommitment, /^0x[0-9a-f]{64}$/u);
  const changed = buildDatabasePromotionInput({
    ...input,
    productCommit: "b".repeat(40),
  });
  assert.notEqual(changed.inputCommitment, input.inputCommitment);
});

test("database promotion rejects zero evidence and mutable deployment aliases", () => {
  assert.throws(
    () => buildDatabasePromotionInput({
      candidateEndpointIdentity: "envio:d7a39a2",
      envioProviderDeploymentId: "123e4567-e89b-42d3-a456-426614174000",
      baselineCommitment: `0x${"0".repeat(64)}`,
      candidateInventoryParityCommitment: HASH,
      envioPromotionAttestationCommitment: HASH,
      productCommit: "a".repeat(40),
      stagedDeploymentId: "production",
      promotedAt: "2026-08-01T08:00:00.000Z",
    }),
    /identity|baseline/u,
  );
});

test("lease drain waits for both projectors and returns the exact drained observation", async () => {
  let clock = 0;
  let calls = 0;
  const result = await waitForProjectorLeaseDrain({
    maximumWaitMs: 2_000,
    intervalMs: 100,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
    inspect: async () => {
      calls += 1;
      return {
        observedAt: "2026-08-01T08:00:00.000Z",
        drained: calls === 2,
        leases: [],
      };
    },
  });
  assert.equal(result.drained, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.waitedMs, 100);
});

test("lease drain fails closed when an active lease survives the deadline", async () => {
  let clock = 0;
  await assert.rejects(
    waitForProjectorLeaseDrain({
      maximumWaitMs: 1_000,
      intervalMs: 500,
      now: () => clock,
      sleep: async (milliseconds) => {
        clock += milliseconds;
      },
      inspect: async () => ({ drained: false }),
    }),
    /did not drain/u,
  );
});

test("lease drain proves scheduler isolation across a full stability window", async () => {
  let clock = 0;
  let generation = "0";
  const result = await waitForProjectorLeaseDrain({
    maximumWaitMs: 2_000,
    intervalMs: 100,
    stabilityWindowMs: 500,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
      if (clock === 300) generation = "1";
    },
    inspect: async () => ({
      observedAt: "2026-08-01T08:00:00.000Z",
      drained: true,
      leases: [
        {
          projector: "source",
          leaseGeneration: generation,
          expiresAt: null,
          releasedAt: generation === "0" ? null : "2026-08-01T08:00:00.000Z",
        },
      ],
    }),
  });
  assert.equal(result.stabilityWindowMs, 500);
  assert.equal(result.stableForMs, 500);
  assert.equal(result.waitedMs, 800);
});

test("database promotion rechecks current leases under its transaction before mutation", async () => {
  const observedAt = "2026-08-01T08:00:00.000Z";
  assert.throws(
    () => assertPromotionLeaseRowsDrained([
      {
        projector: "source",
        lease_generation: "3",
        expires_at: "2026-08-01T08:01:00.000Z",
        released_at: null,
        observed_at: observedAt,
      },
      {
        projector: "market",
        lease_generation: "0",
        expires_at: null,
        released_at: null,
        observed_at: observedAt,
      },
    ]),
    /active source projector lease/u,
  );

  let promotionMutationCalls = 0;
  const transaction = async () => {
    promotionMutationCalls += 1;
    return [{ changed: true }];
  };
  transaction.unsafe = (query) => {
    if (query.startsWith("set local")) {
      return { simple: async () => undefined };
    }
    if (query.includes("pg_try_advisory_xact_lock")) {
      return Promise.resolve([{ acquired: true }]);
    }
    if (query.includes("projector_runtime_lease_current")) {
      return Promise.resolve([{
        lease_generation: "4",
        expires_at: "2026-08-01T08:01:00.000Z",
        released_at: null,
        observed_at: observedAt,
      }]);
    }
    return Promise.resolve([{
      lease_generation: "0",
      expires_at: null,
      released_at: null,
      observed_at: observedAt,
    }]);
  };
  const sql = { begin: async (operation) => operation(transaction) };
  await assert.rejects(
    attestCandidateDatabasePromotion({
      sql,
      promotion: buildDatabasePromotionInput({
        candidateEndpointIdentity: "envio:d7a39a2",
        envioProviderDeploymentId: "123e4567-e89b-42d3-a456-426614174000",
        baselineCommitment: HASH,
        candidateInventoryParityCommitment: `0x${"2".repeat(64)}`,
        envioPromotionAttestationCommitment: `0x${"3".repeat(64)}`,
        productCommit: "a".repeat(40),
        stagedDeploymentId: "dpl_12345678901234567890",
        promotedAt: observedAt,
      }),
    }),
    /active source projector lease/u,
  );
  assert.equal(promotionMutationCalls, 0);
});

test("database promotion atomically persists the reviewed commit and deployment", async () => {
  const observedAt = "2026-08-01T08:00:00.000Z";
  const productCommit = "a".repeat(40);
  const stagedDeploymentId = "dpl_12345678901234567890";
  let mutationValues;
  const statements = [];
  const transaction = async (_strings, ...values) => {
    statements.push("tagged promotion mutation");
    mutationValues = values;
    return [{ changed: true }];
  };
  transaction.unsafe = (query) => {
    statements.push(query.trim());
    if (query.startsWith("set local")) {
      return { simple: async () => undefined };
    }
    if (query.includes("pg_try_advisory_xact_lock")) {
      return Promise.resolve([{ acquired: true }]);
    }
    return Promise.resolve([{
      lease_generation: "0",
      expires_at: null,
      released_at: null,
      observed_at: observedAt,
    }]);
  };
  const sql = { begin: async (operation) => operation(transaction) };
  const result = await attestCandidateDatabasePromotion({
    sql,
    promotion: buildDatabasePromotionInput({
      candidateEndpointIdentity: "envio:d7a39a2",
      envioProviderDeploymentId: "123e4567-e89b-42d3-a456-426614174000",
      baselineCommitment: HASH,
      candidateInventoryParityCommitment: `0x${"2".repeat(64)}`,
      envioPromotionAttestationCommitment: `0x${"3".repeat(64)}`,
      productCommit,
      stagedDeploymentId,
      promotedAt: observedAt,
    }),
  });
  assert.equal(result.changed, true);
  assert.equal(mutationValues[5], productCommit);
  assert.equal(mutationValues[6], stagedDeploymentId);
  assert.equal(mutationValues.length, 8);
  const advisoryLock = statements.findIndex((statement) =>
    statement.includes("pg_try_advisory_xact_lock"),
  );
  const migratorRole = statements.indexOf("set local role programmable_migrator");
  const sourceLease = statements.findIndex((statement) =>
    statement.includes("from programmable_private.projector_runtime_lease_current"),
  );
  const marketLease = statements.findIndex((statement) =>
    statement.includes(
      "from programmable_private.market_projector_runtime_lease_current",
    ),
  );
  const operatorRole = statements.indexOf("set local role programmable_operator");
  const promotionMutation = statements.indexOf("tagged promotion mutation");
  assert.ok(advisoryLock >= 0);
  assert.ok(migratorRole > advisoryLock);
  assert.ok(sourceLease > migratorRole);
  assert.ok(marketLease > sourceLease);
  assert.ok(operatorRole > marketLease);
  assert.ok(promotionMutation > operatorRole);
});
