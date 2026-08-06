import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  BACKEND_RELEASE_BINDING_PATH,
  BACKEND_RELEASE_REPOSITORY,
  verifyCrossRepositoryReleaseBindingFromGitHubV1,
} from "../verify-custom-launch-cross-repository-attestation.mjs";

const commits = Object.freeze({
  attestation: "1".repeat(40),
  backend: "2".repeat(40),
  website: "3".repeat(40),
  builder: "4".repeat(40),
  registry: "5".repeat(40),
  authority: "6".repeat(40),
});
const digest = (character) => `sha256:${character.repeat(64)}`;

function releaseBinding() {
  return {
    schemaVersion: "programmable.cross-repository-release-binding.v1",
    recordType: "candidate_binding",
    materializationState: "materialized",
    activationAllowed: false,
    disabledReason: null,
    pendingCandidates: null,
    backend: {
      repositoryUrl: `https://github.com/${BACKEND_RELEASE_REPOSITORY}.git`,
      candidateCommitSha: commits.backend,
      candidateTreeSha: "7".repeat(40),
      packedAttestationPath: "services/autonomous-approval-v1/release/production-packed-artifact.json",
      packageArtifactHash: digest("a"),
      packedTarballSha256: digest("b"),
    },
    website: {
      repositoryUrl: "https://github.com/0xprogrammable/programmable.git",
      candidateCommitSha: commits.website,
      candidateTreeSha: "8".repeat(40),
    },
    builderSkill: {
      repositoryUrl: "https://github.com/0xprogrammable/programmable-v4-builder.git",
      candidateCommitSha: commits.builder,
      candidateTreeSha: "9".repeat(40),
      packageRootPath: "skills/programmable-v4-hook-builder",
      packageTreeManifestSha256: digest("c"),
      verifierPath: "skills/programmable-v4-hook-builder/scripts/verify-skill.mjs",
      verifierSha256: digest("d"),
    },
    registrySecurityChecker: {
      repositoryUrl: "https://github.com/0xprogrammable/programmable-registry.git",
      candidateCommitSha: commits.registry,
      candidateTreeSha: "a".repeat(40),
      verifierRootPath: "scripts",
      verifierTreeManifestSha256: digest("e"),
      verifierEntrypointPath: "scripts/verify-public-hook-application.mjs",
      verifierEntrypointSha256: digest("f"),
      builderVendorReceiptPath: "vendor/receipt.json",
      builderVendorReceiptSha256: digest("0"),
    },
    productionAuthority: {
      repositoryUrl: `https://github.com/${BACKEND_RELEASE_REPOSITORY}.git`,
      candidateCommitSha: commits.authority,
      candidateTreeSha: "b".repeat(40),
      subjectAgentPath: "services/production-authorities-v1/deploy/fly/fly-oidc-subject-agent.mjs",
      subjectAgentSha256: digest("1"),
      vendoredSubjectAgentPath: "services/autonomous-approval-v1/deploy/fly/fly-oidc-subject-agent.mjs",
      vendoredSubjectAgentSha256: digest("2"),
      compatibilityArtifactPath: "services/autonomous-approval-v1/release/fly-oidc-subject-agent-compatibility-v1.json",
      compatibilityArtifactSha256: digest("3"),
    },
    compatibility: {
      applicationV3: "verified",
      evidencePath: "services/autonomous-approval-v1/release/application-v3-compatibility-evidence.json",
      evidenceSha256: digest("4"),
    },
    deploymentEvidence: null,
  };
}

function fixture(options = {}) {
  const document = releaseBinding();
  options.mutateDocument?.(document);
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`);
  const blobSha = gitBlobSha1(bytes);
  const commit = {
    sha: commits.attestation,
    author: { login: "0xprogrammable" },
    committer: { login: "0xprogrammable" },
    commit: { verification: { verified: true } },
    parents: [{ sha: commits.backend }],
    files: [{
      filename: BACKEND_RELEASE_BINDING_PATH,
      status: "added",
      sha: blobSha,
    }],
  };
  options.mutateCommit?.(commit);
  const contents = {
    type: "file",
    path: BACKEND_RELEASE_BINDING_PATH,
    encoding: "base64",
    sha: blobSha,
    size: bytes.length,
    content: bytes.toString("base64"),
  };
  options.mutateContents?.(contents);
  const fetchImpl = async (url, request) => {
    assert.equal(request.method, "GET");
    assert.equal(request.redirect, "error");
    assert.equal(request.headers.authorization, "Bearer test-token");
    return Response.json(
      url.pathname.includes("/commits/") ? commit : contents,
    );
  };
  return {
    document,
    documentSha256: sha256(bytes),
    fetchImpl,
  };
}

function verify(candidate) {
  return verifyCrossRepositoryReleaseBindingFromGitHubV1({
    attestationCommitSha: commits.attestation,
    expectedDocumentSha256: candidate.documentSha256,
    expectedWebsiteCommitSha: commits.website,
    expectedBackendPackageArtifactHash: digest("a"),
    githubToken: "test-token",
    fetchImpl: candidate.fetchImpl,
  });
}

test("reads the exact signed Git blob and closes the five-component release set", async () => {
  const result = await verify(fixture());
  assert.deepEqual(result, {
    schemaVersion: "programmable.website-observed-cross-repository-release-binding.v1",
    repository: BACKEND_RELEASE_REPOSITORY,
    attestationCommitSha: commits.attestation,
    parentCommitSha: commits.backend,
    documentPath: BACKEND_RELEASE_BINDING_PATH,
    documentBlobSha: result.documentBlobSha,
    documentSha256: result.documentSha256,
    backendCandidateCommitSha: commits.backend,
    backendPackageArtifactHash: digest("a"),
    websiteCandidateCommitSha: commits.website,
    builderCandidateCommitSha: commits.builder,
    registryCandidateCommitSha: commits.registry,
    productionAuthorityCandidateCommitSha: commits.authority,
    applicationV3CompatibilityEvidenceSha256: digest("4"),
    commitSignatureVerified: true,
  });
  assert.match(result.documentBlobSha, /^[0-9a-f]{40}$/u);
});

test("rejects an attestation commit that changes more than the binding", async () => {
  const candidate = fixture({
    mutateCommit(commit) {
      commit.files.push({ filename: "src/runtime.ts", status: "modified", sha: "f".repeat(40) });
    },
  });
  await assert.rejects(verify(candidate), /may change only the binding document/u);
});

test("rejects a non-parent backend candidate and unverified provenance", async () => {
  const wrongParent = fixture({
    mutateDocument(document) {
      document.backend.candidateCommitSha = "f".repeat(40);
    },
  });
  await assert.rejects(verify(wrongParent), /parent is not the bound backend candidate/u);

  const unsigned = fixture({
    mutateCommit(commit) {
      commit.commit.verification.verified = false;
    },
  });
  await assert.rejects(verify(unsigned), /verified Programmable provenance/u);
});

test("rejects substituted Website and backend package bindings", async () => {
  const wrongWebsite = fixture({
    mutateDocument(document) {
      document.website.candidateCommitSha = "e".repeat(40);
    },
  });
  await assert.rejects(verify(wrongWebsite), /exact Website commit/u);

  const wrongPackage = fixture({
    mutateDocument(document) {
      document.backend.packageArtifactHash = digest("f");
    },
  });
  await assert.rejects(verify(wrongPackage), /exact backend package artifact/u);
});

test("rejects unknown nested fields and Git blob byte substitution", async () => {
  const openDocument = fixture({
    mutateDocument(document) {
      document.builderSkill.unexpected = true;
    },
  });
  await assert.rejects(verify(openDocument), /schema validation failed/u);

  const wrongBytes = fixture({
    mutateContents(contents) {
      contents.content = Buffer.from("{}\n").toString("base64");
      contents.size = 3;
    },
  });
  await assert.rejects(verify(wrongBytes), /Git blob bytes do not match/u);
});

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function gitBlobSha1(bytes) {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
}
