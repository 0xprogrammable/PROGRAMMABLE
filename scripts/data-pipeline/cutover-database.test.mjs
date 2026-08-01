import assert from "node:assert/strict";
import test from "node:test";

import {
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
