import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertAttestationMatchesIdentity,
  assertProjectorDrainEvidence,
  assertStagedGateMatchesDrain,
  backupSchemas,
  credentialsFromEnvironment,
  evidenceCommitment,
  parseArguments,
  reserveRuntimeEnableOutput,
  runRuntimeEnableWithReservedOutput,
} from "./cutover-operator.mjs";
import {
  BACKUP_SCHEMAS,
  FINAL_BACKUP_SCHEMAS,
} from "./cutover-credentials.mjs";
import {
  createEnvioPromotionAttestation,
  loadEnvioCutoverIdentity,
} from "./cutover-envio.mjs";
import { canonicalJson, sha256 } from "./hosted-db-operator-core.mjs";

const WORKSPACE = path.resolve(import.meta.dirname, "../..");
const PLAN_SHA256 = `0x${"a".repeat(64)}`;
const CONFIRMATION_SHA256 = `0x${"b".repeat(64)}`;

async function runtimeOutputFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runtime-enable-output-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return {
    directory,
    outputPath: path.join(directory, "runtime-enable.json"),
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

test("operator parser rejects positional, duplicate and value-less arguments", () => {
  assert.deepEqual(parseArguments(["roles-provision", "--output", "/tmp/result"]), {
    command: "roles-provision",
    flags: new Map([["--output", "/tmp/result"]]),
  });
  assert.throws(
    () => parseArguments(["roles-provision", "output", "/tmp/result"]),
    /arguments/u,
  );
  assert.throws(
    () => parseArguments(["roles-provision", "--output"]),
    /arguments/u,
  );
  assert.throws(
    () => parseArguments(["roles-provision", "--output", "a", "--output", "b"]),
    /arguments/u,
  );
});

test("backup schema stage is exact and fail-closed", () => {
  assert.equal(backupSchemas(), BACKUP_SCHEMAS);
  assert.equal(backupSchemas("initial"), BACKUP_SCHEMAS);
  assert.equal(backupSchemas("final"), FINAL_BACKUP_SCHEMAS);
  assert.throws(() => backupSchemas("partial"), /schema stage/u);
});

test("credentials are read from five environment-only names", () => {
  const environment = {
    PROGRAMMABLE_API_READER_DATABASE_PASSWORD: "a".repeat(32),
    PROGRAMMABLE_PROJECTOR_DATABASE_PASSWORD: "b".repeat(32),
    PROGRAMMABLE_PROJECTOR_RUNTIME_DATABASE_PASSWORD: "c".repeat(32),
    PROGRAMMABLE_RECONCILER_DATABASE_PASSWORD: "d".repeat(32),
    PROGRAMMABLE_RELEASE_PROBE_DATABASE_PASSWORD: "e".repeat(32),
  };
  assert.deepEqual(credentialsFromEnvironment(environment), {
    apiReader: "a".repeat(32),
    projector: "b".repeat(32),
    projectorRuntime: "c".repeat(32),
    reconciler: "d".repeat(32),
    releaseProbe: "e".repeat(32),
  });
});

test("runtime enable output reservation is private, durable and exactly resumable", async (t) => {
  const { outputPath } = await runtimeOutputFixture(t);
  const options = {
    outputPath,
    planSha256: PLAN_SHA256,
    confirmationSha256: CONFIRMATION_SHA256,
    environment: {},
  };

  const first = await reserveRuntimeEnableOutput(options);
  assert.deepEqual(await readJson(outputPath), first.reservation);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);

  const resumed = await reserveRuntimeEnableOutput(options);
  assert.deepEqual(resumed, first);
  assert.deepEqual(await readJson(outputPath), first.reservation);

  await assert.rejects(
    reserveRuntimeEnableOutput({
      ...options,
      planSha256: `0x${"c".repeat(64)}`,
    }),
    /not resumable/u,
  );
  assert.deepEqual(await readJson(outputPath), first.reservation);
});

test("runtime enable apply failure preserves the pre-mutation reservation", async (t) => {
  const { outputPath } = await runtimeOutputFixture(t);
  let applyCalls = 0;

  await assert.rejects(
    runRuntimeEnableWithReservedOutput({
      outputPath,
      planSha256: PLAN_SHA256,
      confirmationSha256: CONFIRMATION_SHA256,
      environment: {},
      apply: async () => {
        applyCalls += 1;
        assert.deepEqual(await readJson(outputPath), {
          kind: "programmable-candidate-runtime-enable-output-reservation",
          schemaVersion: 1,
          planSha256: PLAN_SHA256,
          confirmationSha256: CONFIRMATION_SHA256,
          status: "in-progress-or-resumable",
        });
        throw new Error("simulated runtime enable failure");
      },
    }),
    /simulated runtime enable failure/u,
  );

  assert.equal(applyCalls, 1);
  assert.equal((await readJson(outputPath)).status, "in-progress-or-resumable");
});

test("runtime enable success atomically replaces the reservation without pending output", async (t) => {
  const { directory, outputPath } = await runtimeOutputFixture(t);
  const result = {
    kind: "programmable-candidate-runtime-enable-result",
    schemaVersion: 1,
    evidenceSha256: `0x${"d".repeat(64)}`,
  };

  assert.equal(
    await runRuntimeEnableWithReservedOutput({
      outputPath,
      planSha256: PLAN_SHA256,
      confirmationSha256: CONFIRMATION_SHA256,
      environment: {},
      apply: async () => {
        assert.equal(
          (await readJson(outputPath)).status,
          "in-progress-or-resumable",
        );
        return result;
      },
    }),
    result,
  );

  assert.deepEqual(await readJson(outputPath), result);
  assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
  assert.deepEqual(
    (await readdir(directory)).filter((name) => name.includes(".pending-")),
    [],
  );
});

test("evidence commitment prefers one canonical embedded commitment", () => {
  const commitment = `0x${"a".repeat(64)}`;
  assert.equal(evidenceCommitment({ evidenceSha256: commitment }), commitment);
  assert.match(evidenceCommitment({ kind: "plain", value: 1 }), /^0x[0-9a-f]{64}$/u);
  assert.throws(
    () => evidenceCommitment({ evidenceSha256: commitment, attestationSha256: commitment }),
    /commitment/u,
  );
  assert.throws(
    () => evidenceCommitment({ evidenceSha256: `0x${"0".repeat(64)}` }),
    /commitment/u,
  );
});

test("promotion attestation must match the checked-in candidate and rollback", async () => {
  const identity = await loadEnvioCutoverIdentity({ workspace: WORKSPACE });
  const attestation = createEnvioPromotionAttestation({
    identity,
    observedAt: "2026-08-01T08:00:00.000Z",
    productGitCommit: "a".repeat(40),
    releaseGateEvidenceSha256: `0x${"b".repeat(64)}`,
    controlPlane: {
      owner: identity.controlPlane.owner,
      project: identity.controlPlane.project,
      status: "prod",
      mirrorCommit: identity.candidate.mirrorCommit,
      deploymentLabel: identity.candidate.deploymentLabel,
    },
    runtime: {
      endpoint: identity.candidate.endpoint,
      endpointId: identity.candidate.endpointId,
      deploymentLabel: identity.candidate.deploymentLabel,
      identity: identity.candidate.runtimeIdentity,
    },
    auditedInventory: identity.candidate.inventory,
    existingAttestation: null,
  });
  assert.equal(assertAttestationMatchesIdentity(attestation, identity), attestation);

  const changedIdentity = structuredClone(identity);
  changedIdentity.rollback.inventory.sha256 = `0x${"c".repeat(64)}`;
  assert.throws(
    () => assertAttestationMatchesIdentity(attestation, changedIdentity),
    /checked-in cutover identity/u,
  );
});

test("projector drain evidence binds stopped schedulers, drained leases and stage", () => {
  const commit = "a".repeat(40);
  const payload = {
    kind: "programmable-projector-drain-evidence",
    schemaVersion: 1,
    productCommit: commit,
    stagedDeploymentId: "dpl_12345678901234567890",
    stagedTarget: "https://launcher-abc.vercel.app/",
    publicationFence: "closed",
    stageExposure: {
      stagedDeploymentId: "dpl_12345678901234567890",
      stagedTarget: "https://launcher-abc.vercel.app/",
      productCommit: commit,
      productionDomainAssigned: false,
      schedulerExposure: false,
      assignedAliases: [],
    },
    leaseDrain: {
      drained: true,
      stabilityWindowMs: 65_000,
      stableForMs: 65_000,
    },
    releaseGateEvidenceSha256: `0x${"b".repeat(64)}`,
  };
  const evidence = {
    ...payload,
    evidenceSha256: sha256(canonicalJson(payload)),
  };
  assert.equal(
    assertProjectorDrainEvidence(
      evidence,
      commit,
      "dpl_12345678901234567890",
    ),
    evidence,
  );
  assert.equal(
    assertStagedGateMatchesDrain(
      evidence,
      commit,
      "dpl_12345678901234567890",
      "https://launcher-abc.vercel.app/",
    ),
    evidence,
  );
  assert.throws(
    () => assertProjectorDrainEvidence(
      { ...evidence, leaseDrain: { drained: false } },
      commit,
      "dpl_12345678901234567890",
    ),
    /drain evidence/u,
  );
  assert.throws(
    () => assertProjectorDrainEvidence(
      evidence,
      commit,
      "dpl_09876543210987654321",
    ),
    /drain evidence/u,
  );
  assert.throws(
    () => assertStagedGateMatchesDrain(
      evidence,
      commit,
      "dpl_12345678901234567890",
      "https://other.vercel.app/",
    ),
    /differs from the drained deployment/u,
  );
});
