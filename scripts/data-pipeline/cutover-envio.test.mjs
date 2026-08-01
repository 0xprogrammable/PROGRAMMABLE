import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createEnvioPromotionAttestation,
  createRollbackPlan,
  loadEnvioCutoverIdentity,
  validateEnvioPromotionAttestation,
  validateRollbackEvidence,
} from "./cutover-envio.mjs";

const WORKSPACE = path.resolve(import.meta.dirname, "../..");
const PRODUCT_COMMIT = "a".repeat(40);
const PRE_CUTOVER_VERCEL_COMMIT = "9".repeat(40);
const GATE_SHA = `0x${"b".repeat(64)}`;
const OBSERVED_AT = "2026-08-01T08:00:00.000Z";
const CREATED_AT = "2026-08-01T08:01:00.000Z";
const COMPLETED_AT = "2026-08-01T08:02:00.000Z";
const VERCEL_DEPLOYMENT_ID = "dpl_programmable_candidate_123";

function clone(value) {
  return structuredClone(value);
}

function candidateControlPlane(identity) {
  return {
    owner: identity.controlPlane.owner,
    project: identity.controlPlane.project,
    status: "prod",
    mirrorCommit: identity.candidate.mirrorCommit,
    deploymentLabel: identity.candidate.deploymentLabel,
  };
}

function runtimeObservation(target) {
  return {
    endpoint: target.endpoint,
    endpointId: target.endpointId,
    deploymentLabel: target.deploymentLabel,
    identity: target.runtimeIdentity,
  };
}

function inventoryObservation(target) {
  return {
    artifactPath: target.inventory.artifactPath,
    artifactFileSha256: target.inventory.artifactFileSha256,
    artifactDigest: target.inventory.artifactDigest,
    count: target.inventory.count,
    perRelease: target.inventory.perRelease,
    sha256: target.inventory.sha256,
  };
}

function createPromotion(identity, overrides = {}) {
  return createEnvioPromotionAttestation({
    identity,
    observedAt: OBSERVED_AT,
    productGitCommit: PRODUCT_COMMIT,
    releaseGateEvidenceSha256: GATE_SHA,
    controlPlane: candidateControlPlane(identity),
    runtime: runtimeObservation(identity.candidate),
    auditedInventory: inventoryObservation(identity.candidate),
    existingAttestation: null,
    ...overrides,
  });
}

function createPlan(identity, promotion, overrides = {}) {
  return createRollbackPlan({
    identity,
    promotionAttestation: promotion,
    createdAt: CREATED_AT,
    databaseRecovery: {
      mode: "restore-pre-attestation-snapshot",
      evidenceId: "supabase:pre-envio-promotion",
      evidenceSha256: `0x${"c".repeat(64)}`,
    },
    vercelProduction: {
      deploymentId: VERCEL_DEPLOYMENT_ID,
      productGitCommit: PRE_CUTOVER_VERCEL_COMMIT,
    },
    existingPlan: null,
    ...overrides,
  });
}

function rollbackControlPlane(identity) {
  return {
    owner: identity.controlPlane.owner,
    project: identity.controlPlane.project,
    status: "prod",
    mirrorCommit: identity.rollback.mirrorCommit,
    deploymentLabel: identity.rollback.deploymentLabel,
  };
}

function successfulRollbackEvidence(identity, plan, overrides = {}) {
  const input = {
    identity,
    plan,
    completedAt: COMPLETED_AT,
    controls: {
      publicReadFlagsEnabled: false,
      sourceProjectorRunning: false,
      marketProjectorRunning: false,
      reconcilerRunning: false,
    },
    controlPlane: rollbackControlPlane(identity),
    runtime: runtimeObservation(identity.rollback),
    inventory: inventoryObservation(identity.rollback),
    databaseRecovery: {
      ...plan.databaseRecovery,
      status: "restored",
    },
    vercelProduction: {
      ...plan.vercelProductionMustRemain,
      changed: false,
    },
    stepReceipts: plan.steps.map((step) => ({
      ordinal: step.ordinal,
      stepId: step.id,
      status: "succeeded",
      evidenceSha256: `0x${String(step.ordinal).repeat(64)}`,
    })),
    existingEvidence: null,
    ...overrides,
  };
  return validateRollbackEvidence(input);
}

async function fixtureWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "envio-cutover-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = [
    "config/data-pipeline-envio-candidate.v1.json",
    "config/data-pipeline-release.v1.json",
    "docs/data-pipeline/envio-candidate-7f24e63-deployment-7ffd15c.json",
    "docs/data-pipeline/envio-candidate-7f24e63-audit-20260801T042059Z.json",
    "docs/data-pipeline/envio-candidate-7f24e63-baseline-20260801T042058Z.json",
    "docs/data-pipeline/envio-candidate-identity-7f24e63.json",
  ];
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await cp(path.join(WORKSPACE, file), path.join(root, file));
  }
  return root;
}

test("loads exact candidate and rollback targets only from committed evidence", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });

  assert.equal(identity.candidate.endpointId, "d7a39a2");
  assert.equal(
    identity.candidate.mirrorCommit,
    "7ffd15c2a28c481a2d3632e30b315262c2471b2e",
  );
  assert.equal(identity.rollback.endpointId, "f6714ef");
  assert.equal(
    identity.rollback.mirrorCommit,
    "2cb1c35c7738fea63e656ad11589664dc93d785d",
  );
  assert.equal(identity.candidate.inventory.count, 265);
  assert.equal(identity.rollback.inventory.count, 265);
  assert.equal(Object.isFrozen(identity.candidate.runtimeIdentity), true);
});

test("fails closed when checked-in candidate evidence is altered", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const manifestPath = path.join(
    workspace,
    "config/data-pipeline-envio-candidate.v1.json",
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.graphqlEndpoint =
    "https://indexer.hyperindex.xyz/aaaaaaa/v1/graphql";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  await assert.rejects(
    loadEnvioCutoverIdentity({ workspace }),
    /endpoint|diverge/u,
  );
});

test("fails closed when an audited inventory artifact no longer matches its file commitment", async (t) => {
  const workspace = await fixtureWorkspace(t);
  const auditPath = path.join(
    workspace,
    "docs/data-pipeline/envio-candidate-7f24e63-audit-20260801T042059Z.json",
  );
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  audit.inventory.count += 1;
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`);

  await assert.rejects(
    loadEnvioCutoverIdentity({ workspace }),
    /artifact hash/u,
  );
});

test("promotion attestation binds control plane, runtime, inventory, product and rollback", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const attestation = createPromotion(identity);

  assert.equal(attestation.kind, "programmable-envio-promotion-attestation");
  assert.equal(attestation.productGitCommit, PRODUCT_COMMIT);
  assert.equal(attestation.controlPlane.mirrorCommit, identity.candidate.mirrorCommit);
  assert.deepEqual(attestation.runtime.identity, identity.candidate.runtimeIdentity);
  assert.equal(
    attestation.auditedInventory.sha256,
    identity.candidate.inventory.sha256,
  );
  assert.equal(attestation.rollbackTarget.mirrorCommit, identity.rollback.mirrorCommit);
  assert.match(attestation.attestationSha256, /^0x[0-9a-f]{64}$/u);
  assert.equal(validateEnvioPromotionAttestation(attestation), attestation);
});

test("promotion rejects a different mirror, runtime, inventory or secret-shaped input", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const wrongControl = candidateControlPlane(identity);
  wrongControl.mirrorCommit = "d".repeat(40);
  assert.throws(
    () => createPromotion(identity, { controlPlane: wrongControl }),
    /control-plane observation mismatch/u,
  );

  const wrongRuntime = runtimeObservation(identity.candidate);
  wrongRuntime.endpoint = "https://indexer.hyperindex.xyz/aaaaaaa/v1/graphql";
  wrongRuntime.endpointId = "aaaaaaa";
  assert.throws(
    () => createPromotion(identity, { runtime: wrongRuntime }),
    /runtime observation mismatch/u,
  );

  const wrongInventory = inventoryObservation(identity.candidate);
  wrongInventory.sha256 = `0x${"e".repeat(64)}`;
  assert.throws(
    () => createPromotion(identity, { auditedInventory: wrongInventory }),
    /audited inventory mismatch/u,
  );

  assert.throws(
    () =>
      createEnvioPromotionAttestation({
        identity,
        observedAt: OBSERVED_AT,
        productGitCommit: PRODUCT_COMMIT,
        releaseGateEvidenceSha256: GATE_SHA,
        controlPlane: candidateControlPlane(identity),
        runtime: runtimeObservation(identity.candidate),
        auditedInventory: inventoryObservation(identity.candidate),
        existingAttestation: null,
        apiToken: "must-not-be-accepted",
      }),
    /must contain exactly/u,
  );
});

test("promotion validation rejects mutation even when the shape remains valid", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const attestation = clone(createPromotion(identity));
  attestation.productGitCommit = "f".repeat(40);

  assert.throws(
    () => validateEnvioPromotionAttestation(attestation),
    /digest mismatch/u,
  );
});

test("promotion replay is idempotent and rejects conflicting evidence", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const first = createPromotion(identity);
  const replay = createPromotion(identity, { existingAttestation: first });
  assert.deepEqual(replay, first);

  const conflict = clone(first);
  conflict.observedAt = "2026-08-01T08:00:01.000Z";
  assert.throws(
    () => createPromotion(identity, { existingAttestation: conflict }),
    /digest mismatch|conflicting/u,
  );
});

test("rollback plan fixes the safety order and leaves Vercel unchanged", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const promotion = createPromotion(identity);
  const plan = createPlan(identity, promotion);

  assert.deepEqual(
    plan.steps.map(({ id }) => id),
    [
      "freeze-publication-and-stop-projectors",
      "promote-exact-rollback-envio",
      "restore-or-discard-pre-attestation-database",
      "verify-exact-rollback-runtime-and-inventory",
      "verify-vercel-production-unchanged",
    ],
  );
  assert.equal(plan.rollbackTarget.mirrorCommit, identity.rollback.mirrorCommit);
  assert.deepEqual(plan.vercelProductionMustRemain, {
    deploymentId: VERCEL_DEPLOYMENT_ID,
    productGitCommit: PRE_CUTOVER_VERCEL_COMMIT,
  });
  assert.notEqual(
    plan.vercelProductionMustRemain.productGitCommit,
    plan.productGitCommit,
  );
  assert.equal(JSON.stringify(plan).includes("argv"), false);
  assert.equal(JSON.stringify(plan).includes("token"), false);
});

test("rollback plan replay is idempotent and rejects a conflicting plan", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const promotion = createPromotion(identity);
  const first = createPlan(identity, promotion);
  assert.deepEqual(createPlan(identity, promotion, { existingPlan: first }), first);

  const conflict = clone(first);
  conflict.createdAt = "2026-08-01T08:01:01.000Z";
  assert.throws(
    () => createPlan(identity, promotion, { existingPlan: conflict }),
    /digest mismatch|conflicting/u,
  );
});

test("accepts complete exact rollback evidence and supports exact replay", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const promotion = createPromotion(identity);
  const plan = createPlan(identity, promotion);
  const evidence = successfulRollbackEvidence(identity, plan);

  assert.equal(evidence.controlPlane.mirrorCommit, identity.rollback.mirrorCommit);
  assert.equal(evidence.runtime.endpointId, "f6714ef");
  assert.equal(evidence.vercelProduction.changed, false);
  assert.match(evidence.rollbackEvidenceSha256, /^0x[0-9a-f]{64}$/u);

  const replay = successfulRollbackEvidence(identity, plan, {
    existingEvidence: evidence,
  });
  assert.deepEqual(replay, evidence);
});

test("rollback evidence fails closed on live reads, wrong runtime, wrong inventory, DB failure or Vercel change", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const plan = createPlan(identity, createPromotion(identity));
  const baseControls = {
    publicReadFlagsEnabled: false,
    sourceProjectorRunning: false,
    marketProjectorRunning: false,
    reconcilerRunning: false,
  };

  assert.throws(
    () =>
      successfulRollbackEvidence(identity, plan, {
        controls: { ...baseControls, publicReadFlagsEnabled: true },
      }),
    /must be stopped first/u,
  );

  const candidateRuntime = runtimeObservation(identity.candidate);
  assert.throws(
    () => successfulRollbackEvidence(identity, plan, { runtime: candidateRuntime }),
    /runtime observation mismatch/u,
  );

  const wrongInventory = inventoryObservation(identity.rollback);
  wrongInventory.sha256 = `0x${"f".repeat(64)}`;
  assert.throws(
    () => successfulRollbackEvidence(identity, plan, { inventory: wrongInventory }),
    /audited inventory mismatch/u,
  );

  assert.throws(
    () =>
      successfulRollbackEvidence(identity, plan, {
        databaseRecovery: { ...plan.databaseRecovery, status: "failed" },
      }),
    /not completed/u,
  );

  assert.throws(
    () =>
      successfulRollbackEvidence(identity, plan, {
        vercelProduction: {
          ...plan.vercelProductionMustRemain,
          changed: true,
        },
      }),
    /Vercel production changed/u,
  );
});

test("rollback evidence rejects missing, reordered, failed and conflicting receipts", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const plan = createPlan(identity, createPromotion(identity));
  const receipts = plan.steps.map((step) => ({
    ordinal: step.ordinal,
    stepId: step.id,
    status: "succeeded",
    evidenceSha256: `0x${String(step.ordinal).repeat(64)}`,
  }));

  assert.throws(
    () => successfulRollbackEvidence(identity, plan, { stepReceipts: receipts.slice(1) }),
    /incomplete/u,
  );
  const reordered = clone(receipts);
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(
    () => successfulRollbackEvidence(identity, plan, { stepReceipts: reordered }),
    /order or status/u,
  );
  const failed = clone(receipts);
  failed[2].status = "failed";
  assert.throws(
    () => successfulRollbackEvidence(identity, plan, { stepReceipts: failed }),
    /order or status/u,
  );

  const evidence = successfulRollbackEvidence(identity, plan);
  const conflict = clone(evidence);
  conflict.completedAt = "2026-08-01T08:02:01.000Z";
  assert.throws(
    () => successfulRollbackEvidence(identity, plan, { existingEvidence: conflict }),
    /conflicting/u,
  );
});
