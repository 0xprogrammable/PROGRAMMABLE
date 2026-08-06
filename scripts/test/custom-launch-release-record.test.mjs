import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  computeDetachedRecordSha256,
  computeReleaseSubjectSha256,
  verifyReleaseRecord,
} from "../verify-custom-launch-release-record.mjs";

const TEMPLATE_URL = new URL(
  "../../docs/operations/releases/custom-launch-v1/release-record.template.json",
  import.meta.url,
);
const SCHEMA_URL = new URL(
  "../../docs/operations/releases/custom-launch-v1/release-record.schema.json",
  import.meta.url,
);

const commits = {
  website: "1".repeat(40),
  base: "2".repeat(40),
  other: "3".repeat(40),
};
const hashes = Object.freeze({
  a: `sha256:${"a".repeat(64)}`,
  b: `sha256:${"b".repeat(64)}`,
  c: `sha256:${"c".repeat(64)}`,
  d: `sha256:${"d".repeat(64)}`,
  e: `sha256:${"e".repeat(64)}`,
  f: `sha256:${"f".repeat(64)}`,
  zero: `sha256:${"0".repeat(64)}`,
});

async function readTemplate() {
  return JSON.parse(await readFile(TEMPLATE_URL, "utf8"));
}

function decision(status, subjectHash, suffix) {
  const decidedAt = suffix === "freeze"
    ? "2026-08-06T12:00:00Z"
    : suffix === "promotion"
      ? "2026-08-06T13:30:00Z"
      : "2026-08-06T16:00:00Z";
  return {
    authority: "command_center",
    status,
    decisionId: `cc-20260806-${suffix}`,
    immutableReference: `command-center://decision/cc-20260806-${suffix}`,
    decidedAt,
    statementSha256: hashes.f,
    releaseSubjectSha256: subjectHash,
  };
}

async function completeRecord(level = "live") {
  const record = await readTemplate();
  record.createdAt = "2026-08-06T11:00:00Z";
  record.releaseIntent.releaseId = "custom-launch-v1-20260806-001";
  record.releaseIntent.targetMode = "enabled";
  record.subject.website.commitSha = commits.website;
  record.subject.website.reviewedDiffBaseSha = commits.base;
  record.subject.website.reviewedDiffHeadSha = commits.website;
  record.subject.website.reviewedDiffSha256 = hashes.a;
  record.subject.approvalService.packageArtifactHash = hashes.b;
  record.subject.approvalService.detachedPackedArtifactFileSha256 = hashes.c;
  record.subject.approvalService.productionContentManifestSha256 = hashes.d;
  const subjectHash = computeReleaseSubjectSha256(record);
  record.subject.releaseSubjectSha256 = subjectHash;
  record.commandCenter.freezeClearance = decision("cleared", subjectHash, "freeze");
  record.recordStatus = "freeze_cleared";
  if (level === "clearance") return record;

  record.validation.gates = record.validation.gates.map((gate, index) => ({
    ...gate,
    result: "passed",
    evidenceSha256: [hashes.a, hashes.b, hashes.c, hashes.d, hashes.e, hashes.f, hashes.zero, hashes.a][index],
    evidenceLocator: `https://github.com/0xprogrammable/programmable/actions/runs/${1000 + index}`,
    completedAt: "2026-08-06T13:00:00Z",
  }));
  record.productionDependencies = {
    websiteProjection: {
      databaseIdentity: "supabase:mnnvlrqwhfoppogslsje",
      migrationDigest: hashes.a,
      runtimeRoleAttestationSha256: hashes.b,
      backupId: "backup-20260806-001",
      restoreDrillEvidenceSha256: hashes.c,
    },
    approvalService: {
      releaseIdentity: "programmable-approval-v1-20260806-001",
      migrationInventorySha256: hashes.d,
      signerKeyId: "manual-review-ed25519-20260806",
      signerEpoch: 1,
      signerComponentBindingSha256: hashes.e,
      controlAxisGenerationsSha256: hashes.f,
      readyzEvidenceSha256: hashes.zero,
    },
    identity: {
      privyApplicationId: "cm123publicappid",
      githubOauthEnabled: true,
      identityTokensEnabled: true,
    },
    ethereum: {
      chainId: "1",
      chainProfileSha256: hashes.a,
      finalizedRpcBindings: [
        { providerId: "alchemy", bindingSha256: hashes.b },
        { providerId: "quicknode", bindingSha256: hashes.c },
      ],
    },
    targets: {
      registryBindingSha256: hashes.d,
      websiteProjectionBindingSha256: hashes.e,
    },
  };
  record.deployment.rollback = {
    deploymentId: "dpl_previous",
    immutableDeploymentUrl: "https://launcher-v4-previous.vercel.app",
    websiteCommitSha: commits.base,
    productionAlias: "https://programmable.family",
    configurationSnapshotSha256: hashes.f,
    capturedAt: "2026-08-06T13:10:00Z",
  };
  if (level === "staging") return record;
  record.deployment.candidate = {
    deploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    websiteCommitSha: commits.website,
    approvalServicePackageArtifactHash: hashes.b,
    verified: true,
    verificationEvidenceSha256: hashes.zero,
    verifiedAt: "2026-08-06T13:20:00Z",
  };
  record.promotionGate.status = "candidate_verified";
  record.promotionGate.workflow = {
    repository: "0xprogrammable/programmable",
    workflowFile: ".github/workflows/deploy-production.yml",
    eventName: "workflow_dispatch",
    ref: "refs/heads/production",
    environment: "production",
    runId: 123456789,
    runAttempt: 1,
    runUrl: "https://github.com/0xprogrammable/programmable/actions/runs/123456789",
    commitSha: commits.website,
    verifiedCommitSha: commits.website,
    conclusion: "success",
    candidateDeploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    approvalServicePackageArtifactHash: hashes.b,
    candidateVerified: true,
    verificationEvidenceSha256: hashes.zero,
  };
  record.recordStatus = "candidate_verified";
  if (level === "candidate") return record;

  record.commandCenter.promotionApproval = {
    ...decision("approved", subjectHash, "promotion"),
    candidateDeploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    websiteCommitSha: commits.website,
    approvalServicePackageArtifactHash: hashes.b,
  };
  record.promotionGate.status = "promotion_authorized";
  record.recordStatus = "promotion_approved";
  if (level === "promotion") return record;

  record.deployment.promoted = {
    deploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    productionAlias: "https://programmable.family",
    postPromotionEvidenceSha256: hashes.a,
    promotedAt: "2026-08-06T14:00:00Z",
  };
  record.promotionGate.status = "promoted";
  record.canary = {
    status: "passed",
    evidenceSha256: hashes.b,
    evidenceLocator: "https://github.com/0xprogrammable/programmable/actions/runs/123456789",
    completedAt: "2026-08-06T15:00:00Z",
  };
  record.commandCenter.liveDeclaration = {
    ...decision("declared_live", subjectHash, "live"),
    candidateDeploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    websiteCommitSha: commits.website,
    approvalServicePackageArtifactHash: hashes.b,
  };
  record.recordStatus = "live";
  return record;
}

test("template and schema are valid JSON and the template is not clearance", async () => {
  const [template, schema] = await Promise.all([
    readTemplate(),
    readFile(SCHEMA_URL, "utf8").then(JSON.parse),
  ]);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(verifyReleaseRecord(template, { require: "template" }).ok, true);
  const clearance = verifyReleaseRecord(template, { require: "clearance" });
  assert.equal(clearance.ok, false);
  assert.match(clearance.errors.join("\n"), /freezeClearance/);
});

test("each release level is independently fail closed", async () => {
  const clearance = await completeRecord("clearance");
  assert.equal(verifyReleaseRecord(clearance, { require: "clearance" }).ok, true);
  assert.equal(verifyReleaseRecord(clearance, { require: "staging" }).ok, false);

  const staging = await completeRecord("staging");
  assert.equal(verifyReleaseRecord(staging, { require: "staging" }).ok, true);
  assert.equal(verifyReleaseRecord(staging, { require: "candidate" }).ok, false);

  const candidate = await completeRecord("candidate");
  assert.equal(verifyReleaseRecord(candidate, { require: "candidate" }).ok, true);
  assert.equal(verifyReleaseRecord(candidate, { require: "promotion" }).ok, false);

  const promotion = await completeRecord("promotion");
  assert.equal(verifyReleaseRecord(promotion, { require: "promotion" }).ok, true);
  assert.equal(verifyReleaseRecord(promotion, { require: "live" }).ok, false);

  const live = await completeRecord("live");
  assert.equal(verifyReleaseRecord(live, { require: "live" }).ok, true);
});

test("staging expectations bind the exact external workflow observations", async () => {
  const record = await completeRecord("staging");
  const expected = {
    websiteCommitSha: commits.website,
    packageArtifactHash: hashes.b,
    rollbackDeploymentId: "dpl_previous",
    rollbackDeploymentUrl: "https://launcher-v4-previous.vercel.app",
    rollbackWebsiteCommitSha: commits.base,
    detachedRecordSha256: computeDetachedRecordSha256(record),
  };
  assert.equal(verifyReleaseRecord(record, { require: "staging", expected }).ok, true);
  const substituted = verifyReleaseRecord(record, {
    require: "staging",
    expected: { ...expected, websiteCommitSha: commits.other },
  });
  assert.equal(substituted.ok, false);
  assert.match(substituted.errors.join("\n"), /subject\.website\.commitSha/);
});

test("candidate workflow cannot substitute the Website commit", async () => {
  const record = await completeRecord("candidate");
  record.promotionGate.workflow.commitSha = commits.other;
  const result = verifyReleaseRecord(record, { require: "candidate" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /promotionGate\.workflow\.commitSha/);
});

test("candidate cannot substitute the approval-service package", async () => {
  const record = await completeRecord("candidate");
  record.deployment.candidate.approvalServicePackageArtifactHash = hashes.c;
  const result = verifyReleaseRecord(record, { require: "candidate" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /approvalServicePackageArtifactHash/);
});

test("tampering with a bound subject invalidates Command Center clearance", async () => {
  const record = await completeRecord("clearance");
  record.subject.website.reviewedDiffSha256 = hashes.e;
  const result = verifyReleaseRecord(record, { require: "clearance" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /releaseSubjectSha256/);
});

test("freeze clearance never substitutes for candidate-specific promotion approval", async () => {
  const record = await completeRecord("candidate");
  record.recordStatus = "promotion_approved";
  record.promotionGate.status = "promotion_authorized";
  const result = verifyReleaseRecord(record, { require: "promotion" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /promotionApproval/);
});

test("a general user-message URL cannot masquerade as Command Center clearance", async () => {
  const record = await completeRecord("clearance");
  record.commandCenter.freezeClearance.immutableReference =
    "https://github.com/0xprogrammable/programmable/issues/1";
  const result = verifyReleaseRecord(record, { require: "clearance" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /command-center:\/\/decision/);
});

test("secret-bearing fields are rejected even when all gates otherwise pass", async () => {
  const record = await completeRecord("live");
  record.productionDependencies.identity.access_token = "must-not-be-recorded";
  const result = verifyReleaseRecord(record, { require: "live" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /secret-bearing keys are forbidden/);
});

test("an unfilled release id placeholder is rejected after template stage", async () => {
  const record = await completeRecord("clearance");
  record.releaseIntent.releaseId = "custom-launch-v1-YYYYMMDD-NNN";
  const result = verifyReleaseRecord(record, { require: "clearance" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /contains a placeholder/);
});

test("detached record digest is stable and changes under mutation", async () => {
  const record = await completeRecord("live");
  const first = computeDetachedRecordSha256(record);
  const second = computeDetachedRecordSha256(structuredClone(record));
  assert.equal(first, second);
  record.canary.completedAt = "2026-08-06T15:00:01Z";
  assert.notEqual(computeDetachedRecordSha256(record), first);
});
