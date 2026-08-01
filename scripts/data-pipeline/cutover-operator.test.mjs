import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  assertAttestationMatchesIdentity,
  assertProjectorDrainEvidence,
  assertStagedGateMatchesDrain,
  credentialsFromEnvironment,
  evidenceCommitment,
  parseArguments,
} from "./cutover-operator.mjs";
import {
  createEnvioPromotionAttestation,
  loadEnvioCutoverIdentity,
} from "./cutover-envio.mjs";
import { canonicalJson, sha256 } from "./hosted-db-operator-core.mjs";

const WORKSPACE = path.resolve(import.meta.dirname, "../..");

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
    leaseDrain: { drained: true },
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
