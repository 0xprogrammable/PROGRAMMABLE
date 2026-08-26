import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  parseDeterministicCustomLaunchApiReleaseBindingV1,
  verifyCustomLaunchApiReleaseBindingV1,
} from "../verify-custom-launch-api-release-binding-v1.mjs";
import {
  canonicalize,
  computeReleaseSubjectSha256,
  verifyCustomLaunchReleaseRecordV2,
} from "../verify-custom-launch-release-record-v2.mjs";
import {
  probeCustomLaunchV3Release,
} from "../probe-custom-launch-v3-release.mjs";
import {
  verifyCustomLaunchApiFlyRelease,
} from "../verify-custom-launch-api-fly-release.mjs";

const hashes = Object.freeze({
  a: "a".repeat(40),
  b: "b".repeat(40),
  c: "c".repeat(40),
  d: "d".repeat(40),
  one: `sha256:${"1".repeat(64)}`,
  two: `sha256:${"2".repeat(64)}`,
  three: `sha256:${"3".repeat(64)}`,
  four: `sha256:${"4".repeat(64)}`,
  five: `sha256:${"5".repeat(64)}`,
  six: `sha256:${"6".repeat(64)}`,
  seven: `sha256:${"7".repeat(64)}`,
  eight: `sha256:${"8".repeat(64)}`,
  nine: `sha256:${"9".repeat(64)}`,
});
const at = "2026-08-26T12:00:00Z";

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function gitBlob(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function clone(value) {
  return structuredClone(value);
}

async function template() {
  return JSON.parse(await readFile(new URL(
    "../../docs/operations/releases/custom-launch-v2/release-record.template.json",
    import.meta.url,
  ), "utf8"));
}

async function stagingFixture() {
  const record = await template();
  record.recordStatus = "staging_approved";
  record.createdAt = at;
  record.releaseIntent.releaseId = "custom-launch-api-v3-20260826-001";
  Object.assign(record.subject.website, {
    commitSha: hashes.a,
    treeSha: hashes.b,
    reviewedDiffBaseSha: hashes.c,
    reviewedDiffSha256: hashes.one,
    publicOpenApiSha256: hashes.two,
    launchPackageManifestSha256: hashes.three,
  });
  Object.assign(record.subject.apiService, {
    bindingAttestationCommitSha: hashes.d,
    bindingDocumentSha256: hashes.four,
    candidateCommitSha: hashes.b,
    candidateTreeSha: hashes.c,
    imageDigest: hashes.five,
    flyReleaseVersion: 9,
    migrationInventorySha256: hashes.six,
    apiContractSha256: hashes.seven,
    readinessIdentitySha256: hashes.eight,
  });
  record.subject.releaseSubjectSha256 = computeReleaseSubjectSha256(record);
  Object.assign(record.releaseApproval, {
    status: "approved",
    decisionId: "release-owner-approval-001",
    immutableReference: "https://github.com/0xprogrammable/programmable/issues/1",
    decidedAt: at,
    statementSha256: hashes.nine,
    releaseSubjectSha256: record.subject.releaseSubjectSha256,
  });
  for (const gate of record.validation.gates) Object.assign(gate, {
    result: "passed",
    evidenceSha256: hashes.one,
    evidenceLocator: `artifact://custom-launch-v3/${gate.id}`,
    completedAt: at,
  });
  Object.assign(record.rollback.website, {
    deploymentId: "dpl_previousProduction123456789",
    immutableDeploymentUrl: "https://launcher-old.vercel.app",
    commitSha: hashes.c,
    configurationSnapshotSha256: hashes.two,
    capturedAt: at,
  });
  Object.assign(record.rollback.apiService, {
    flyReleaseVersion: 8,
    imageDigest: hashes.three,
    candidateCommitSha: hashes.d,
    capturedAt: at,
  });
  const observation = {
    schemaVersion: "programmable.custom-launch-api-release-observation.v1",
    repository: record.subject.apiService.repository,
    attestationCommitSha: record.subject.apiService.bindingAttestationCommitSha,
    bindingDocumentPath: record.subject.apiService.bindingDocumentPath,
    bindingDocumentSha256: record.subject.apiService.bindingDocumentSha256,
    backendCandidateCommitSha: record.subject.apiService.candidateCommitSha,
    backendCandidateTreeSha: record.subject.apiService.candidateTreeSha,
    websiteCandidateCommitSha: record.subject.website.commitSha,
    websiteCandidateTreeSha: record.subject.website.treeSha,
    website: {
      publicOpenApiSha256: record.subject.website.publicOpenApiSha256,
      launchPackageManifestSha256:
        record.subject.website.launchPackageManifestSha256,
    },
    fly: {
      app: "programmable-custom-launch-api",
      origin: "https://programmable-custom-launch-api.fly.dev",
      region: "fra",
      releaseVersion: record.subject.apiService.flyReleaseVersion,
      imageDigest: record.subject.apiService.imageDigest,
      imageTag: `main-${record.subject.apiService.candidateCommitSha.slice(0, 12)}`,
      machineCount: 2,
    },
    database: {
      migrationInventorySha256: record.subject.apiService.migrationInventorySha256,
      lastMigration: "migrations/0008_direct_native_platform_admission_v3.sql",
      schemaEvidenceSha256: hashes.nine,
    },
    api: {
      readinessSchemaVersion: "programmable.custom-launch-api-readiness.v2",
      readinessIdentitySha256: record.subject.apiService.readinessIdentitySha256,
      apiContractSha256: record.subject.apiService.apiContractSha256,
      profileId: "programmable.direct-native-hook-graph.v1",
      profileVersion: "3.0.0",
      publicProfilePath:
        "services/custom-launch-api-v1/release/direct-native-hook-graph-admission-profile.v3.json",
      publicProfileSha256: hashes.nine,
    },
    chain: clone(record.subject.chain),
    commitSignatureVerified: true,
  };
  return { record, observation };
}

function options(record, observation, require) {
  return {
    require,
    apiReleaseObservation: observation,
    expectedWebsiteCommitSha: record.subject.website.commitSha,
    expectedWebsiteTreeSha: record.subject.website.treeSha,
    expectedApiAttestationCommitSha:
      record.subject.apiService.bindingAttestationCommitSha,
    expectedApiBindingDocumentSha256:
      record.subject.apiService.bindingDocumentSha256,
    expectedRollbackDeploymentId: record.rollback.website.deploymentId,
    expectedRollbackDeploymentUrl: record.rollback.website.immutableDeploymentUrl,
    expectedRollbackWebsiteCommitSha: record.rollback.website.commitSha,
  };
}

test("V2 template validates without granting staging authority", async () => {
  const record = await template();
  const result = verifyCustomLaunchReleaseRecordV2(record, { require: "template" });
  assert.equal(result.ok, true, result.errors.join("\n"));
  assert.equal(record.recordStatus, "draft");
});

test("backend binding schema pairs current revision 3 and historical revision 2 evidence", async () => {
  const currentBytes = await readFile(new URL(
    "../../docs/operations/releases/custom-launch-v2/backend-release-binding.template.json",
    import.meta.url,
  ));
  const current = parseDeterministicCustomLaunchApiReleaseBindingV1(currentBytes);
  assert.equal(current.api.profileVersion, "3.0.0");
  assert.match(current.api.publicProfilePath, /admission-profile\.v3\.json$/u);
  assert.match(current.database.lastMigration, /0008_direct_native_platform_admission_v3/u);

  const historical = clone(current);
  historical.api.profileVersion = "2.0.0";
  historical.api.publicProfilePath =
    "services/custom-launch-api-v1/release/direct-native-hook-graph-admission-profile.v2.json";
  historical.database.lastMigration = "migrations/0007_direct_native_hook_profile_v3.sql";
  const historicalBytes = Buffer.from(`${JSON.stringify(historical, null, 2)}\n`);
  assert.equal(
    parseDeterministicCustomLaunchApiReleaseBindingV1(historicalBytes).api.profileVersion,
    "2.0.0",
  );

  const mixed = clone(current);
  mixed.api.publicProfilePath = historical.api.publicProfilePath;
  const mixedBytes = Buffer.from(`${JSON.stringify(mixed, null, 2)}\n`);
  assert.throws(
    () => parseDeterministicCustomLaunchApiReleaseBindingV1(mixedBytes),
    /binding schema is invalid/u,
  );
});

test("V2 record advances through exact staging, candidate, promotion and live states", async () => {
  const { record, observation } = await stagingFixture();
  let result = verifyCustomLaunchReleaseRecordV2(record, options(record, observation, "staging"));
  assert.equal(result.ok, true, result.errors.join("\n"));

  record.recordStatus = "candidate_verified";
  Object.assign(record.candidate, {
    workflowRunId: 123,
    workflowRunAttempt: 1,
    workflowRunUrl: "https://github.com/0xprogrammable/programmable/actions/runs/123",
    websiteDeploymentId: "dpl_candidateProduction123456789",
    immutableWebsiteUrl: "https://launcher-candidate.vercel.app",
    websiteCommitSha: record.subject.website.commitSha,
    apiOrigin: "https://programmable-custom-launch-api.fly.dev",
    apiReadinessIdentitySha256: record.subject.apiService.readinessIdentitySha256,
    verificationEvidenceSha256: hashes.nine,
    verifiedAt: at,
  });
  result = verifyCustomLaunchReleaseRecordV2(record, options(record, observation, "candidate"));
  assert.equal(result.ok, true, result.errors.join("\n"));

  record.recordStatus = "promotion_approved";
  Object.assign(record.promotionApproval, {
    status: "approved",
    decisionId: "release-owner-promotion-001",
    immutableReference: "https://github.com/0xprogrammable/programmable/issues/2",
    decidedAt: at,
    statementSha256: hashes.one,
    releaseSubjectSha256: record.subject.releaseSubjectSha256,
    candidateEvidenceSha256: record.candidate.verificationEvidenceSha256,
  });
  result = verifyCustomLaunchReleaseRecordV2(record, options(record, observation, "promotion"));
  assert.equal(result.ok, true, result.errors.join("\n"));

  record.recordStatus = "live";
  Object.assign(record.promoted, {
    websiteDeploymentId: record.candidate.websiteDeploymentId,
    immutableWebsiteUrl: record.candidate.immutableWebsiteUrl,
    productionAlias: "https://programmable.market",
    evidenceSha256: hashes.two,
    promotedAt: at,
  });
  Object.assign(record.canary, {
    status: "passed",
    evidenceSha256: hashes.three,
    evidenceLocator: "artifact://custom-launch-v3/live-canary",
    completedAt: at,
  });
  Object.assign(record.liveDeclaration, {
    status: "declared_live",
    decisionId: "release-owner-live-001",
    immutableReference: "https://github.com/0xprogrammable/programmable/issues/3",
    decidedAt: at,
    statementSha256: hashes.four,
    releaseSubjectSha256: record.subject.releaseSubjectSha256,
  });
  result = verifyCustomLaunchReleaseRecordV2(record, options(record, observation, "live"));
  assert.equal(result.ok, true, result.errors.join("\n"));
});

test("V2 staging fails closed on API drift, secrets and per-state overclaim", async () => {
  const { record, observation } = await stagingFixture();
  const drift = clone(observation);
  drift.api.readinessIdentitySha256 = hashes.one;
  let result = verifyCustomLaunchReleaseRecordV2(record, options(record, drift, "staging"));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /readinessIdentitySha256/u);

  const secret = clone(record);
  secret.apiKey = "must-never-be-recorded";
  result = verifyCustomLaunchReleaseRecordV2(secret, options(secret, observation, "staging"));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /unexpected field apiKey/u);

  const overclaim = clone(record);
  overclaim.recordStatus = "live";
  result = verifyCustomLaunchReleaseRecordV2(overclaim, options(overclaim, observation, "live"));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /candidate/u);
});

function commitResponse(sha, tree) {
  return {
    sha,
    author: { login: "0xprogrammable" },
    committer: { login: "0xprogrammable" },
    commit: { tree: { sha: tree }, verification: { verified: true } },
  };
}

test("backend binding preserves historical revision 2 profile evidence", async () => {
  const publicProfile = {
    schemaVersion: "programmable.direct-native-hook-graph-admission-profile.v2",
    profileId: "programmable.direct-native-hook-graph.v1",
    profileVersion: "2.0.0",
  };
  const publicProfileBytes = Buffer.from(`${JSON.stringify(publicProfile, null, 2)}\n`);
  const publicProfileSha256 = digest(Buffer.from(canonicalize(publicProfile)));
  const publicOpenApiBytes = Buffer.from('{"openapi":"3.1.0"}\n');
  const launchPackageManifestBytes = Buffer.from('{"name":"@programmable/launch"}\n');
  const binding = {
    schemaVersion: "programmable.custom-launch-api-release-binding.v1",
    materializationState: "materialized",
    backend: {
      repository: "0xprogrammable/programmable-open-hook-v2-internal",
      servicePath: "services/custom-launch-api-v1",
      candidateCommitSha: hashes.a,
      candidateTreeSha: hashes.b,
    },
    website: {
      repository: "0xprogrammable/programmable",
      candidateCommitSha: hashes.c,
      candidateTreeSha: hashes.d,
      publicOpenApiSha256: digest(publicOpenApiBytes),
      launchPackageManifestSha256: digest(launchPackageManifestBytes),
    },
    fly: {
      app: "programmable-custom-launch-api",
      origin: "https://programmable-custom-launch-api.fly.dev",
      region: "fra",
      releaseVersion: 9,
      imageDigest: hashes.three,
      imageTag: `main-${hashes.a.slice(0, 12)}`,
      machineCount: 2,
    },
    database: {
      migrationInventorySha256: hashes.four,
      lastMigration: "migrations/0007_direct_native_hook_profile_v3.sql",
      schemaEvidenceSha256: hashes.five,
    },
    api: {
      readinessSchemaVersion: "programmable.custom-launch-api-readiness.v2",
      readinessIdentitySha256: hashes.six,
      apiContractSha256: hashes.seven,
      profileId: "programmable.direct-native-hook-graph.v1",
      profileVersion: "2.0.0",
      publicProfilePath:
        "services/custom-launch-api-v1/release/direct-native-hook-graph-admission-profile.v2.json",
      publicProfileSha256,
    },
    chain: (await stagingFixture()).record.subject.chain,
  };
  const bindingBytes = Buffer.from(`${JSON.stringify(binding, null, 2)}\n`);
  const bindingBlob = gitBlob(bindingBytes);
  const profileBlob = gitBlob(publicProfileBytes);
  const publicOpenApiBlob = gitBlob(publicOpenApiBytes);
  const launchPackageManifestBlob = gitBlob(launchPackageManifestBytes);
  const attestation = {
    ...commitResponse(hashes.d, hashes.c),
    parents: [{ sha: hashes.a }],
    files: [{
      filename: "services/custom-launch-api-v1/release/public-v3-release-binding-v1.json",
      status: "added",
      sha: bindingBlob,
    }],
  };
  const fetchImpl = async (input) => {
    const url = new URL(input);
    let body;
    if (url.pathname.endsWith(`/commits/${hashes.d}`)) body = attestation;
    else if (url.pathname.endsWith(`/commits/${hashes.a}`)) body = commitResponse(hashes.a, hashes.b);
    else if (url.pathname.endsWith(`/commits/${hashes.c}`)) body = commitResponse(hashes.c, hashes.d);
    else if (url.pathname.includes("public-v3-release-binding-v1.json")) body = {
      type: "file", path: attestation.files[0].filename, encoding: "base64",
      content: bindingBytes.toString("base64"), size: bindingBytes.length, sha: bindingBlob,
    };
    else if (url.pathname.includes("direct-native-hook-graph-admission-profile.v2.json")) body = {
      type: "file", path: binding.api.publicProfilePath, encoding: "base64",
      content: publicProfileBytes.toString("base64"), size: publicProfileBytes.length,
      sha: profileBlob,
    };
    else if (url.pathname.endsWith("/contents/public/openapi/custom-launch-v3.json")) body = {
      type: "file", path: "public/openapi/custom-launch-v3.json", encoding: "base64",
      content: publicOpenApiBytes.toString("base64"), size: publicOpenApiBytes.length,
      sha: publicOpenApiBlob,
    };
    else if (url.pathname.endsWith("/contents/packages/launch/package.json")) body = {
      type: "file", path: "packages/launch/package.json", encoding: "base64",
      content: launchPackageManifestBytes.toString("base64"), size: launchPackageManifestBytes.length,
      sha: launchPackageManifestBlob,
    };
    else return new Response("not found", { status: 404 });
    return Response.json(body);
  };
  const result = await verifyCustomLaunchApiReleaseBindingV1({
    attestationCommitSha: hashes.d,
    expectedDocumentSha256: digest(bindingBytes),
    expectedWebsiteCommitSha: hashes.c,
    expectedWebsiteTreeSha: hashes.d,
    expectedPublicOpenApiSha256: digest(publicOpenApiBytes),
    expectedLaunchPackageManifestSha256: digest(launchPackageManifestBytes),
    githubToken: "read-only-token",
    fetchImpl,
  });
  assert.equal(result.api.publicProfileSha256, publicProfileSha256);
  assert.equal(result.commitSignatureVerified, true);
});

test("Fly readback accepts the real tag-only release ref and exact machine digest", () => {
  const result = verifyCustomLaunchApiFlyRelease({
    releases: [{ Version: 9, Status: "succeeded", ImageRef: "registry.fly.io/programmable-custom-launch-api:main-aaaaaaaaaaaa" }],
    machines: [
      { id: "one", state: "started", region: "fra", host_status: "ok", image_ref: { registry: "registry.fly.io", repository: "programmable-custom-launch-api", tag: "main-aaaaaaaaaaaa", digest: hashes.one } },
      { id: "two", state: "started", region: "fra", host_status: "ok", image_ref: { registry: "registry.fly.io", repository: "programmable-custom-launch-api", tag: "main-aaaaaaaaaaaa", digest: hashes.one } },
    ],
    images: [
      { MachineID: "one", Registry: "registry.fly.io", Repository: "programmable-custom-launch-api", Tag: "main-aaaaaaaaaaaa", Digest: hashes.one },
      { MachineID: "two", Registry: "registry.fly.io", Repository: "programmable-custom-launch-api", Tag: "main-aaaaaaaaaaaa", Digest: hashes.one },
    ],
    expectedReleaseVersion: 9,
    expectedImageDigest: hashes.one,
    expectedImageTag: "main-aaaaaaaaaaaa",
    expectedMachineCount: 2,
  });
  assert.equal(result.status, "passed");
  assert.throws(() => verifyCustomLaunchApiFlyRelease({
    releases: [{ Version: 9, Status: "succeeded", ImageRef: "registry.fly.io/programmable-custom-launch-api:main-aaaaaaaaaaaa" }],
    machines: [{ id: "one", state: "stopped", region: "fra", host_status: "ok", image_ref: { registry: "registry.fly.io", repository: "programmable-custom-launch-api", tag: "main-aaaaaaaaaaaa", digest: hashes.one } }],
    images: [{ MachineID: "one", Registry: "registry.fly.io", Repository: "programmable-custom-launch-api", Tag: "main-aaaaaaaaaaaa", Digest: hashes.one }],
    expectedReleaseVersion: 9,
    expectedImageDigest: hashes.one,
    expectedImageTag: "main-aaaaaaaaaaaa",
    expectedMachineCount: 1,
  }), /machine differs/u);
  assert.throws(() => verifyCustomLaunchApiFlyRelease({
    releases: [{ Version: 9, Status: "succeeded", ImageRef: "registry.fly.io/programmable-custom-launch-api:main-bbbbbbbbbbbb" }],
    machines: [{ id: "one", state: "started", region: "fra", host_status: "ok", image_ref: { registry: "registry.fly.io", repository: "programmable-custom-launch-api", tag: "main-aaaaaaaaaaaa", digest: hashes.one } }],
    images: [{ MachineID: "one", Registry: "registry.fly.io", Repository: "programmable-custom-launch-api", Tag: "main-aaaaaaaaaaaa", Digest: hashes.one }],
    expectedReleaseVersion: 9,
    expectedImageDigest: hashes.one,
    expectedImageTag: "main-aaaaaaaaaaaa",
    expectedMachineCount: 1,
  }), /release image differs/u);
  assert.throws(() => verifyCustomLaunchApiFlyRelease({
    releases: [{ Version: 9, Status: "succeeded", ImageRef: "registry.fly.io/programmable-custom-launch-api:main-aaaaaaaaaaaa" }],
    machines: [{ id: "one", state: "started", region: "fra", host_status: "ok", image_ref: { registry: "registry.fly.io", repository: "programmable-custom-launch-api", tag: "main-aaaaaaaaaaaa", digest: hashes.one } }],
    images: [{ MachineID: "one", Registry: "registry.fly.io", Repository: "programmable-custom-launch-api", Tag: "main-aaaaaaaaaaaa", Digest: hashes.two }],
    expectedReleaseVersion: 9,
    expectedImageDigest: hashes.one,
    expectedImageTag: "main-aaaaaaaaaaaa",
    expectedMachineCount: 1,
  }), /machine differs/u);
});

test("stage probe is GET-only and returns redacted no-broadcast evidence", async () => {
  const { observation } = await stagingFixture();
  const openApi = {
    info: { version: "3.2.0" },
    "x-programmable-profile": {
      profileId: "programmable.direct-native-hook-graph.v1",
      profileVersion: "3.0.0",
      profileRevision: 3,
      productionLaunchAuthorized: true,
      platformAdmissionReceiptRequired: true,
      routerSimulationRequiredBeforeAuthorization: true,
      safetyClaim: false,
      feeBehaviorClaim: false,
    },
    "x-programmable-availability": {
      status: "live",
      publicAuthorized: true,
    },
    paths: { "/v3/custom-launches": { get: {}, post: {} } },
  };
  const openApiBytes = Buffer.from(JSON.stringify(openApi));
  observation.website.publicOpenApiSha256 = digest(openApiBytes);
  const readiness = {
    schemaVersion: "programmable.custom-launch-api-readiness.v2",
    status: "ready",
    service: "custom-launch-api-v1",
    sourceCommit: observation.backendCandidateCommitSha,
    sourceTree: observation.backendCandidateTreeSha,
    migrationInventorySha256: observation.database.migrationInventorySha256,
    apiContractSha256: observation.api.apiContractSha256,
    publicProfile: {
      profileId: observation.api.profileId,
      profileVersion: observation.api.profileVersion,
      profileSha256: observation.api.publicProfileSha256,
      productionLaunchAuthorized: true,
    },
    chain: observation.chain,
  };
  observation.api.readinessIdentitySha256 = digest(Buffer.from(canonicalize(readiness)));
  const calls = [];
  let listBody = {
    schemaVersion: "programmable.custom-launch-list.v3",
    launches: [],
    nextCursor: null,
  };
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url: url.href, method: init.method, authorization: init.headers.authorization });
    if (url.pathname === "/openapi/custom-launch-v3.json") return new Response(openApiBytes, { status: 200 });
    if (url.pathname === "/.well-known/programmable.json") return Response.json({
      customLaunchApi: {
        versions: { v3: { status: "live", publicAuthorization: true } },
        legacyIntake: { registry: "closed", github: "closed" },
      },
    });
    if (url.pathname === "/readyz") return Response.json(readiness, {
      headers: { "cache-control": "no-store" },
    });
    if (url.pathname === "/v3/custom-launches") return Response.json(listBody);
    return new Response("not found", { status: 404 });
  };
  const evidence = await probeCustomLaunchV3Release({
    websiteUrl: "https://launcher-candidate.vercel.app",
    websiteDeploymentId: "dpl_candidateProduction123456789",
    expectedWebsiteCommitSha: hashes.a,
    apiReleaseObservation: observation,
    apiKey: "canary-secret-value",
    vercelBypassSecret: "bypass-secret-value",
    fetchImpl,
  });
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.safety.walletSignatureObserved, false);
  assert.equal(evidence.safety.transactionBroadcastObserved, false);
  assert.equal(JSON.stringify(evidence).includes("canary-secret-value"), false);
  assert.deepEqual(new Set(calls.map((call) => call.method)), new Set(["GET"]));
  assert.equal(calls.at(-1).authorization, "Bearer canary-secret-value");

  listBody = {
    schemaVersion: "programmable.custom-launch-list.v3",
    items: [],
    nextCursor: null,
  };
  await assert.rejects(() => probeCustomLaunchV3Release({
    websiteUrl: "https://launcher-candidate.vercel.app",
    websiteDeploymentId: "dpl_candidateProduction123456789",
    expectedWebsiteCommitSha: hashes.a,
    apiReleaseObservation: observation,
    apiKey: "canary-secret-value",
    vercelBypassSecret: "bypass-secret-value",
    fetchImpl,
  }), /Custom Launch API V3 list has an unexpected shape/u);
});

test("production workflow has an additive V3 stage lane and no promotion mutation", async () => {
  const workflow = await readFile(new URL(
    "../../.github/workflows/deploy-production.yml",
    import.meta.url,
  ), "utf8");
  for (const required of [
    "custom_launch_v3_release:",
    'record_path="release-records/custom-launch-v2/release-record.json"',
    "verify-custom-launch-release-record-v2.mjs",
    "PROGRAMMABLE_CUSTOM_LAUNCH_API_RELEASE_ATTESTATION_COMMIT_SHA",
    "PROGRAMMABLE_CUSTOM_LAUNCH_API_RELEASE_BINDING_DOCUMENT_SHA256",
    "PROGRAMMABLE_CUSTOM_LAUNCH_API_RELEASE_READ_TOKEN",
    "PROGRAMMABLE_CUSTOM_LAUNCH_API_FLY_READ_TOKEN",
    "PROGRAMMABLE_CUSTOM_LAUNCH_V3_CANARY_API_KEY",
    "superfly/flyctl-actions/setup-flyctl@ed8efb33836e8b2096c7fd3ba1c8afe303ebbff1",
    "probe-custom-launch-v3-release.mjs",
    '--expect-detached-record-sha256 "$EXPECTED_RECORD_SHA256"',
    "Stage-only: no production promotion was attempted.",
  ]) assert.ok(workflow.includes(required), `missing ${required}`);
  assert.equal(
    workflow.includes('--expect-detached-record-sha256="$EXPECTED_RECORD_SHA256"'),
    false,
  );
  const v3RecordStart = workflow.indexOf(
    "      - name: Verify detached Custom Launch V3 release record",
  );
  const v3RecordEnd = workflow.indexOf(
    "      - name: Set up Fly CLI for read-only release verification",
  );
  assert.ok(v3RecordStart >= 0 && v3RecordEnd > v3RecordStart);
  assert.ok(workflow.slice(v3RecordStart, v3RecordEnd).includes(
    '--expect-detached-record-sha256 "$EXPECTED_RECORD_SHA256"',
  ));
  assert.equal(workflow.includes("vercel promote"), false);
  assert.equal(workflow.includes("vercel rollback"), false);
  assert.equal(workflow.includes("flyctl deploy"), false);
});
