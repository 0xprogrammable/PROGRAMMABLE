import { writeFile } from "node:fs/promises";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GIT_COMMIT_OID = /^[0-9a-f]{40}$/u;
const VERCEL_DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{8,128}$/u;
const REVIEW_AUTHORITY_MODES = new Set(["manual_review", "autonomous_ai"]);
const REQUIRED_COMPONENTS = Object.freeze([
  "approvalService",
  "permitSignerKeyring",
  "publicConfiguration",
  "websiteProjectionDatabase",
]);

export function createCustomLaunchDarkReleaseEvidence(input) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Custom Launch dark release evidence input is invalid");
  }
  const targetUrl = exactImmutableCandidateOrigin(input.targetUrl);
  if (
    input.probeResult?.baseUrl !== targetUrl
    || input.probeResult?.status !== "disabled"
    || input.probeResult?.authenticatedCanary !== "not_requested"
  ) throw new TypeError("Custom Launch dark release readiness did not pass");
  if (
    typeof input.deploymentId !== "string"
    || !VERCEL_DEPLOYMENT_ID.test(input.deploymentId)
  ) throw new TypeError("Custom Launch dark deployment id is invalid");
  if (
    typeof input.websiteCommitSha !== "string"
    || !GIT_COMMIT_OID.test(input.websiteCommitSha)
  ) throw new TypeError("Custom Launch dark release commit is invalid");
  if (
    typeof input.approvalServicePackageArtifactHash !== "string"
    || !SHA256_DIGEST.test(input.approvalServicePackageArtifactHash)
  ) throw new TypeError("Custom Launch approval package identity is invalid");
  if (!REVIEW_AUTHORITY_MODES.has(input.reviewAuthorityMode)) {
    throw new TypeError("Custom Launch review authority mode is invalid");
  }
  for (const [name, value] of [
    ["release subject", input.releaseSubjectSha256],
    ["detached record", input.detachedRecordSha256],
    ["cross-repository binding document", input.crossRepositoryBindingDocumentSha256],
  ]) {
    if (typeof value !== "string" || !SHA256_DIGEST.test(value)) {
      throw new TypeError(`Custom Launch ${name} identity is invalid`);
    }
  }
  if (
    typeof input.crossRepositoryAttestationCommitSha !== "string"
    || !GIT_COMMIT_OID.test(input.crossRepositoryAttestationCommitSha)
  ) throw new TypeError("Custom Launch cross-repository attestation commit is invalid");

  return Object.freeze({
    schemaVersion: "programmable.custom-launch-dark-release-evidence.v1",
    result: "passed",
    candidate: Object.freeze({
      deploymentId: input.deploymentId,
      targetUrl,
      websiteCommitSha: input.websiteCommitSha,
    }),
    releaseRecord: Object.freeze({
      verificationLevel: "dark-staging",
      releaseSubjectSha256: input.releaseSubjectSha256,
      detachedRecordSha256: input.detachedRecordSha256,
      crossRepositoryAttestationCommitSha:
        input.crossRepositoryAttestationCommitSha,
      crossRepositoryBindingDocumentSha256:
        input.crossRepositoryBindingDocumentSha256,
    }),
    approvalService: Object.freeze({
      packageArtifactHash: input.approvalServicePackageArtifactHash,
      reviewAuthorityMode: input.reviewAuthorityMode,
    }),
    readiness: Object.freeze({
      status: "disabled",
      publicEnabled: false,
      authenticatedCanary: "not_requested",
      requiredComponents: Object.freeze(Object.fromEntries(
        REQUIRED_COMPONENTS.map((component) => [component, "ready"]),
      )),
    }),
  });
}

export async function writeCustomLaunchDarkReleaseEvidence(path, evidence) {
  if (
    typeof path !== "string"
    || path.trim() !== path
    || path.length === 0
    || path.length > 4_096
    || /[\r\n\0]/u.test(path)
  ) throw new TypeError("Custom Launch dark release evidence path is invalid");
  await writeFile(path, `${JSON.stringify(evidence)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function exactImmutableCandidateOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError("Custom Launch dark candidate URL is invalid");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
    || !url.hostname.endsWith(".vercel.app")
  ) throw new TypeError("Custom Launch dark candidate URL must be an immutable Vercel origin");
  return url.origin;
}
