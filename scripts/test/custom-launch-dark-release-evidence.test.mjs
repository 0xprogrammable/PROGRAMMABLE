import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createCustomLaunchDarkReleaseEvidence,
  writeCustomLaunchDarkReleaseEvidence,
} from "../custom-launch-dark-release-evidence.mjs";

const input = Object.freeze({
  probeResult: Object.freeze({
    baseUrl: "https://launcher-v4-dark.vercel.app",
    status: "disabled",
    authenticatedCanary: "not_requested",
  }),
  targetUrl: "https://launcher-v4-dark.vercel.app",
  deploymentId: "dpl_12345678",
  websiteCommitSha: "1".repeat(40),
  approvalServicePackageArtifactHash: `sha256:${"2".repeat(64)}`,
  reviewAuthorityMode: "manual_review",
  releaseSubjectSha256: `sha256:${"3".repeat(64)}`,
  detachedRecordSha256: `sha256:${"4".repeat(64)}`,
  crossRepositoryAttestationCommitSha: "5".repeat(40),
  crossRepositoryBindingDocumentSha256: `sha256:${"6".repeat(64)}`,
});

test("dark release evidence binds the disabled probe and exact release record", () => {
  const evidence = createCustomLaunchDarkReleaseEvidence(input);
  assert.deepEqual(evidence, {
    schemaVersion: "programmable.custom-launch-dark-release-evidence.v1",
    result: "passed",
    candidate: {
      deploymentId: input.deploymentId,
      targetUrl: input.targetUrl,
      websiteCommitSha: input.websiteCommitSha,
    },
    releaseRecord: {
      verificationLevel: "dark-staging",
      releaseSubjectSha256: input.releaseSubjectSha256,
      detachedRecordSha256: input.detachedRecordSha256,
      crossRepositoryAttestationCommitSha:
        input.crossRepositoryAttestationCommitSha,
      crossRepositoryBindingDocumentSha256:
        input.crossRepositoryBindingDocumentSha256,
    },
    approvalService: {
      packageArtifactHash: input.approvalServicePackageArtifactHash,
      reviewAuthorityMode: input.reviewAuthorityMode,
    },
    readiness: {
      status: "disabled",
      publicEnabled: false,
      authenticatedCanary: "not_requested",
      requiredComponents: {
        approvalService: "ready",
        permitSignerKeyring: "ready",
        publicConfiguration: "ready",
        websiteProjectionDatabase: "ready",
      },
    },
  });
});

test("dark release evidence rejects enabled, incomplete, and mutable targets", () => {
  assert.throws(
    () => createCustomLaunchDarkReleaseEvidence({
      ...input,
      probeResult: { ...input.probeResult, status: "ready" },
    }),
    /readiness did not pass/,
  );
  assert.throws(
    () => createCustomLaunchDarkReleaseEvidence({
      ...input,
      targetUrl: "https://programmable.market",
      probeResult: { ...input.probeResult, baseUrl: "https://programmable.market" },
    }),
    /immutable Vercel origin/,
  );
  assert.throws(
    () => createCustomLaunchDarkReleaseEvidence({
      ...input,
      detachedRecordSha256: undefined,
    }),
    /detached record identity/,
  );
});

test("dark release evidence is written once as canonical private JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "custom-launch-dark-release-"));
  try {
    const path = join(directory, "evidence.json");
    const evidence = createCustomLaunchDarkReleaseEvidence(input);
    await writeCustomLaunchDarkReleaseEvidence(path, evidence);
    assert.equal(await readFile(path, "utf8"), `${JSON.stringify(evidence)}\n`);
    await assert.rejects(
      writeCustomLaunchDarkReleaseEvidence(path, evidence),
      /EEXIST/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
