import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCandidateFence,
  checkpointRequestsFromRows,
  runFencedRawBackfill,
  runPostAttestationStagedGates,
} from "./cutover-phases.mjs";

const PROVIDER = "123e4567-e89b-42d3-a456-426614174000";
const HASH = `0x${"1".repeat(64)}`;
const ATTESTATION = `0x${"2".repeat(64)}`;
const RELEASES = [
  ["classic-v2", "classic"],
  ["classic-v3", "classic"],
  ["stock-paired-v1", "stock-paired"],
  ["stock-paired-v2", "stock-paired"],
  ["stock-paired-v3", "stock-paired"],
];

function fence(promoted = false) {
  return {
    databaseMode: "candidate-only",
    envioProviderDeploymentId: PROVIDER,
    promoted,
    publicationCount: promoted ? 5 : 0,
    promotionAttestationCommitment: promoted ? ATTESTATION : null,
  };
}

function checkpointRows() {
  return RELEASES.map(([releaseId, modelId], index) => ({
    chain_id: 1,
    release_id: releaseId,
    model_id: modelId,
    source_group: "core",
    epoch_id: `123e4567-e89b-42d3-a456-42661417400${index}`,
    pointer_generation: 1,
    checkpoint_id: `223e4567-e89b-42d3-a456-42661417400${index}`,
    block_number: 25_657_000 + index,
    block_hash: HASH,
  }));
}

test("candidate fence rejects any pre-attestation publication", () => {
  assert.equal(assertCandidateFence(fence()).promoted, false);
  assert.throws(
    () => assertCandidateFence({ ...fence(), publicationCount: 1 }),
    /fence is not closed/u,
  );
  assert.throws(
    () => assertCandidateFence(fence(), "attested"),
    /not attested/u,
  );
});

test("raw backfill reaches idle without opening the publication fence", async () => {
  const results = [
    { status: "committed", candidateCount: 200, snapshotBlock: "25657000", generation: "1" },
    { status: "committed", candidateCount: 65, snapshotBlock: "25657100", generation: "2" },
    { status: "idle", candidateCount: 0, snapshotBlock: "25657100" },
  ];
  const output = await runFencedRawBackfill({
    candidateEndpointIdentity: "envio:d7a39a2",
    inspectFence: async () => fence(),
    runRawCycle: async () => results.shift(),
    startedAt: "2026-08-01T08:00:00.000Z",
    completedAt: () => "2026-08-01T08:01:00.000Z",
  });
  assert.equal(output.candidateCount, 265);
  assert.equal(output.cycleCount, 3);
  assert.match(output.evidenceSha256, /^0x[0-9a-f]{64}$/u);
});

test("raw backfill fails on an unbounded run or a fence transition", async () => {
  await assert.rejects(
    runFencedRawBackfill({
      candidateEndpointIdentity: "envio:d7a39a2",
      inspectFence: async () => fence(),
      runRawCycle: async () => ({
        status: "committed",
        candidateCount: 1,
        snapshotBlock: "1",
        generation: "1",
      }),
      maximumCycles: 2,
      startedAt: "2026-08-01T08:00:00.000Z",
      completedAt: () => "2026-08-01T08:01:00.000Z",
    }),
    /did not reach an idle/u,
  );
  let inspections = 0;
  await assert.rejects(
    runFencedRawBackfill({
      candidateEndpointIdentity: "envio:d7a39a2",
      inspectFence: async () => (++inspections === 1 ? fence() : fence(true)),
      runRawCycle: async () => ({ status: "idle", candidateCount: 0, snapshotBlock: "1" }),
      startedAt: "2026-08-01T08:00:00.000Z",
      completedAt: () => "2026-08-01T08:01:00.000Z",
    }),
    /publication fence is not closed/u,
  );
});

test("checkpoint payloads cover each exact supported release once", () => {
  const requests = checkpointRequestsFromRows(checkpointRows());
  assert.deepEqual(requests.map(({ releaseId }) => releaseId), RELEASES.map(([id]) => id));
  assert.equal(requests[0].maximumEntityCount, 10_000);
  assert.throws(
    () => checkpointRequestsFromRows([...checkpointRows(), checkpointRows()[0]]),
    /incomplete or duplicated/u,
  );
  assert.throws(
    () => checkpointRequestsFromRows(checkpointRows().slice(1)),
    /incomplete or duplicated/u,
  );
});

test("post-attestation gates require source, market, every parity and load evidence", async () => {
  let sourceCalls = 0;
  let marketCalls = 0;
  const output = await runPostAttestationStagedGates({
    candidateEndpointIdentity: "envio:d7a39a2",
    stagedDeploymentId: "dpl_12345678901234567890",
    productCommit: "a".repeat(40),
    inspectFence: async () => fence(true),
    runSourceProjector: async () => {
      sourceCalls += 1;
      return sourceCalls === 1
        ? { ok: true, readiness: { status: "progressed", activationReady: false, lagging: true } }
        : { ok: true, readiness: { status: "caught-up", activationReady: true, lagging: false } };
    },
    runMarketProjector: async () => {
      marketCalls += 1;
      return marketCalls === 1
        ? { status: "committed", caughtUp: false, lagBlocks: "1" }
        : { status: "idle", caughtUp: true, lagBlocks: "0" };
    },
    readCheckpoints: async () => checkpointRows(),
    runReconciler: async (request) => ({
      ok: true,
      status: "succeeded",
      mismatchCount: 0,
      routeCount: request.releaseId === "classic-v2" ? 4 : request.releaseId === "classic-v3" ? 6 : 5,
      checkpointId: request.checkpointId,
      checkpointBlockNumber: request.checkpointBlockNumber,
      checkpointBlockHash: request.checkpointBlockHash,
    }),
    runLoadGate: async () => ({
      status: "accepted",
      releaseEvidenceAccepted: true,
      evidenceSha256: HASH,
    }),
    completedAt: () => "2026-08-01T08:10:00.000Z",
  });
  assert.equal(output.reconciliations.length, 5);
  assert.equal(output.sourceProjectorCycles, 2);
  assert.equal(output.marketProjectorCycles, 2);
});

test("post-attestation gates reject one mismatched release", async () => {
  await assert.rejects(
    runPostAttestationStagedGates({
      candidateEndpointIdentity: "envio:d7a39a2",
      stagedDeploymentId: "dpl_12345678901234567890",
      productCommit: "a".repeat(40),
      inspectFence: async () => fence(true),
      runSourceProjector: async () => ({
        ok: true,
        readiness: { status: "caught-up", activationReady: true, lagging: false },
      }),
      runMarketProjector: async () => ({ status: "idle", caughtUp: true, lagBlocks: "0" }),
      readCheckpoints: async () => checkpointRows(),
      runReconciler: async (request) => ({
        ok: true,
        status: "succeeded",
        mismatchCount: request.releaseId === "stock-paired-v2" ? 1 : 0,
        routeCount: 5,
        checkpointId: request.checkpointId,
        checkpointBlockNumber: request.checkpointBlockNumber,
        checkpointBlockHash: request.checkpointBlockHash,
      }),
      runLoadGate: async () => ({ status: "accepted", releaseEvidenceAccepted: true, evidenceSha256: HASH }),
      completedAt: () => "2026-08-01T08:10:00.000Z",
    }),
    /stock-paired-v2/u,
  );
});
