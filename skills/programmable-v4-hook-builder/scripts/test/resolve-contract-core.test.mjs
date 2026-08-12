import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  ACTIVE_CONTRACT_MANIFEST_V1,
  RESOLVE_CONTRACT_V1,
  normalizeContractRepositoryV1,
  resolveActiveContractV1,
  validateActiveContractManifestV1
} from "../resolve-contract-core.mjs";

const API = "https://api.github.com/repos/example/registry";
const REPOSITORY = "example/registry";
const REPOSITORY_URI = "https://github.com/example/registry";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);

test("offline mode emits a deterministic plan without touching a transport", async () => {
  let calls = 0;
  const report = await resolveActiveContractV1({
    repository: "https://github.com/Example/Registry",
    network: false,
    transport: async () => {
      calls += 1;
      throw new Error("must not run");
    }
  });
  assert.equal(calls, 0);
  assert.equal(report.outcome, "network-disabled");
  assert.equal(report.target.repositoryUri, REPOSITORY_URI);
  assert.equal(report.transport.networkAccessed, false);
  assert.equal(report.transport.credentialsUsed, false);
  assert.equal(report.transport.redirectsFollowed, 0);
  assert.deepEqual(report.unresolved.map(({ code }) => code), ["NETWORK_MODE_NOT_ENABLED"]);
  assert.equal(report.authority.githubReviewsUsed, false);
  assert.equal(report.authority.githubLabelsUsed, false);
  assert.equal(report.authority.launchAuthorityInferred, false);
});

test("manifest resolution pins and hashes exact default-branch workflow, validator, package and policy bytes", async () => {
  const artifactBytes = {
    workflow: Buffer.from("name: intake\n", "utf8"),
    validator: Buffer.from("export const validate = true;\n", "utf8"),
    package: Buffer.from('{"schemaVersion":"3.0.0"}\n', "utf8"),
    policy: Buffer.from("# Approval criteria\n", "utf8")
  };
  const artifactPaths = {
    workflow: ".github/workflows/verify-hook-builder.yml",
    validator: "scripts/verify-public-hook-application.mjs",
    package: "contracts/public-pr-application-v3/3.0.0/contract.json",
    policy: "references/approval-criteria.md"
  };
  const manifest = {
    $schema: ACTIVE_CONTRACT_MANIFEST_V1.schema,
    schemaVersion: ACTIVE_CONTRACT_MANIFEST_V1.schemaVersion,
    kind: ACTIVE_CONTRACT_MANIFEST_V1.kind,
    contractId: "application-v3-main",
    defaultBranch: "main",
    artifacts: Object.fromEntries(ACTIVE_CONTRACT_MANIFEST_V1.roles.map((role) => [role, [{
      path: artifactPaths[role],
      sha256: sha256(artifactBytes[role])
    }]]))
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");
  const blobs = new Map([
    [RESOLVE_CONTRACT_V1.manifestCandidates[0], manifestBytes],
    ...ACTIVE_CONTRACT_MANIFEST_V1.roles.map((role) => [artifactPaths[role], artifactBytes[role]])
  ]);
  const fixture = createGitHubFixture(blobs);

  const report = await resolveActiveContractV1({
    repository: REPOSITORY,
    network: true,
    transport: fixture.transport
  });

  assert.equal(report.outcome, "manifest-bound", JSON.stringify(report));
  assert.equal(report.discovered.selectionBasis, "manifest");
  assert.equal(report.verified.repository.numericRepositoryId, "900719925474099312345");
  assert.equal(report.verified.repository.revisionObjectId, COMMIT);
  assert.equal(report.verified.repository.treeObjectId, TREE);
  assert.equal(report.verified.repository.stableDuringResolution, true);
  assert.equal(report.verified.manifest.path, RESOLVE_CONTRACT_V1.manifestCandidates[0]);
  assert.equal(report.verified.manifest.sha256, sha256(manifestBytes));
  assert.deepEqual(report.verified.artifacts.map(({ role }) => role), ACTIVE_CONTRACT_MANIFEST_V1.roles);
  for (const artifact of report.verified.artifacts) {
    assert.equal(artifact.sha256, sha256(artifactBytes[artifact.role]));
    assert.equal(artifact.digestMatched, true);
    assert.equal(artifact.manifestBound, true);
    assert.equal(artifact.activeAuthorityInferred, false);
  }
  assert.deepEqual(report.unresolved, []);
  assert.ok(report.transport.requestsMade <= RESOLVE_CONTRACT_V1.maximumRequests);
  assert.equal(report.transport.credentialsUsed, false);
  assert.equal(report.transport.redirectsFollowed, 0);
  assert.ok(fixture.requests.every(({ request }) => request.method === "GET"));
  assert.ok(fixture.requests.every(({ request }) => request.redirect === "error"));
  assert.ok(fixture.requests.every(({ request }) => !Object.keys(request.headers).some((name) => /auth|cookie|token/iu.test(name))));
  assert.ok(fixture.requests.every(({ url }) => !/labels|reviews|pulls/iu.test(url)));
});

test("conventions remain hash-verified discovery hints and never become authority", async () => {
  const blobs = new Map([
    [RESOLVE_CONTRACT_V1.conventionCandidates.workflow[0], Buffer.from("name: intake\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.validator[0], Buffer.from("export const validate = true;\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.validator[1], Buffer.from("export function validate() {}\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.package[0], Buffer.from("{}\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.policy[0], Buffer.from("# Policy\n")]
  ]);
  const fixture = createGitHubFixture(blobs);
  const report = await resolveActiveContractV1({ repository: REPOSITORY, network: true, transport: fixture.transport });

  assert.equal(report.outcome, "convention-evidence-only");
  assert.equal(report.discovered.selectionBasis, "convention-hints");
  assert.equal(report.verified.manifest, null);
  assert.equal(report.verified.artifacts.length, 4);
  assert.ok(report.verified.artifacts.every(({ selection }) => selection === "bounded-convention-hint"));
  assert.ok(report.verified.artifacts.every(({ manifestBound }) => manifestBound === false));
  assert.ok(report.verified.artifacts.every(({ activeAuthorityInferred }) => activeAuthorityInferred === false));
  assert.deepEqual(
    report.discovered.conventions.validator.map(({ path }) => path),
    RESOLVE_CONTRACT_V1.conventionCandidates.validator.slice(0, 2)
  );
  assert.equal(report.unresolved.filter(({ code }) => code === "CONVENTION_HINT_NOT_AUTHORITY").length, 4);
});

test("partial convention discovery is unresolved rather than a successful evidence outcome", async () => {
  const fixture = createGitHubFixture(new Map([
    [RESOLVE_CONTRACT_V1.conventionCandidates.policy[0], Buffer.from("# Policy only\n")]
  ]));
  const report = await resolveActiveContractV1({ repository: REPOSITORY, network: true, transport: fixture.transport });
  assert.equal(report.outcome, "unresolved");
  assert.deepEqual(report.verified.artifacts.map(({ role }) => role), ["policy"]);
  assert.equal(report.unresolved.filter(({ code }) => code === "CONVENTION_ARTIFACT_NOT_DISCOVERED").length, 3);
});

test("manifest presence fails closed on a digest mismatch and never falls back to conventions", async () => {
  const workflowPath = RESOLVE_CONTRACT_V1.conventionCandidates.workflow[0];
  const records = Object.fromEntries(ACTIVE_CONTRACT_MANIFEST_V1.roles.map((role) => [role, [{
    path: role === "workflow" ? workflowPath : `contracts/${role}.json`,
    sha256: `sha256:${"1".repeat(64)}`
  }]]));
  const manifest = {
    $schema: ACTIVE_CONTRACT_MANIFEST_V1.schema,
    schemaVersion: ACTIVE_CONTRACT_MANIFEST_V1.schemaVersion,
    kind: ACTIVE_CONTRACT_MANIFEST_V1.kind,
    contractId: "mismatch",
    defaultBranch: "main",
    artifacts: records
  };
  const blobs = new Map([
    [RESOLVE_CONTRACT_V1.manifestCandidates[0], Buffer.from(`${JSON.stringify(manifest)}\n`)],
    [workflowPath, Buffer.from("name: changed\n")],
    ["contracts/validator.json", Buffer.from("{}\n")],
    ["contracts/package.json", Buffer.from("{}\n")],
    ["contracts/policy.json", Buffer.from("{}\n")]
  ]);
  const fixture = createGitHubFixture(blobs);
  const report = await resolveActiveContractV1({ repository: REPOSITORY, network: true, transport: fixture.transport });

  assert.equal(report.outcome, "unresolved");
  assert.equal(report.discovered.selectionBasis, "manifest");
  assert.equal(report.verified.artifacts.length, 0);
  assert.equal(report.unresolved.filter(({ code }) => code === "MANIFEST_ARTIFACT_DIGEST_MISMATCH").length, 4);
  assert.deepEqual(report.discovered.conventions, { workflow: [], validator: [], package: [], policy: [] });
});

test("default-branch movement invalidates current-branch resolution but preserves exact evidence", async () => {
  const blobs = new Map([
    [RESOLVE_CONTRACT_V1.conventionCandidates.workflow[0], Buffer.from("name: intake\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.validator[0], Buffer.from("export const validate = true;\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.package[0], Buffer.from("{}\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.policy[0], Buffer.from("# Policy\n")]
  ]);
  const fixture = createGitHubFixture(blobs, {
    secondHead: { revisionObjectId: "c".repeat(40), treeObjectId: "d".repeat(40) }
  });
  const report = await resolveActiveContractV1({ repository: REPOSITORY, network: true, transport: fixture.transport });
  assert.equal(report.outcome, "unresolved");
  assert.equal(report.verified.repository.stableDuringResolution, false);
  assert.equal(report.verified.artifacts.length, 4);
  assert.ok(report.unresolved.some(({ code }) => code === "DEFAULT_BRANCH_MOVED_DURING_RESOLUTION"));
});

test("a default-branch name change is detected even when the original ref remains unchanged", async () => {
  const blobs = new Map([
    [RESOLVE_CONTRACT_V1.conventionCandidates.workflow[0], Buffer.from("name: intake\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.validator[0], Buffer.from("export const validate = true;\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.package[0], Buffer.from("{}\n")],
    [RESOLVE_CONTRACT_V1.conventionCandidates.policy[0], Buffer.from("# Policy\n")]
  ]);
  const fixture = createGitHubFixture(blobs, {
    secondRepository: {
      defaultBranch: "develop",
      head: { revisionObjectId: "c".repeat(40), treeObjectId: "d".repeat(40) }
    }
  });
  const report = await resolveActiveContractV1({ repository: REPOSITORY, network: true, transport: fixture.transport });
  assert.equal(report.outcome, "unresolved");
  assert.equal(report.verified.repository.stableDuringResolution, false);
  const movement = report.unresolved.find(({ code }) => code === "DEFAULT_BRANCH_MOVED_DURING_RESOLUTION");
  assert.equal(movement.firstDefaultBranch, "main");
  assert.equal(movement.finalDefaultBranch, "develop");
  assert.equal(fixture.requests.filter(({ url }) => url === API).length, 2);
});

test("maximum manifest artifact count fits the aggregate request and response budgets", async () => {
  const oneMiB = Buffer.alloc(1_048_576, 0x61);
  const artifacts = Object.fromEntries(ACTIVE_CONTRACT_MANIFEST_V1.roles.map((role) => [
    role,
    Array.from({ length: ACTIVE_CONTRACT_MANIFEST_V1.maximumArtifactsPerRole }, (_, index) => ({
      path: `contracts/${role}-${index}.bin`,
      sha256: sha256(oneMiB)
    }))
  ]));
  const manifest = {
    $schema: ACTIVE_CONTRACT_MANIFEST_V1.schema,
    schemaVersion: ACTIVE_CONTRACT_MANIFEST_V1.schemaVersion,
    kind: ACTIVE_CONTRACT_MANIFEST_V1.kind,
    contractId: "maximum-artifacts",
    defaultBranch: "main",
    artifacts
  };
  const blobs = new Map([[RESOLVE_CONTRACT_V1.manifestCandidates[0], Buffer.from(`${JSON.stringify(manifest)}\n`)]]);
  for (const role of ACTIVE_CONTRACT_MANIFEST_V1.roles) {
    for (const artifact of artifacts[role]) blobs.set(artifact.path, oneMiB);
  }
  const fixture = createGitHubFixture(blobs);
  const report = await resolveActiveContractV1({ repository: REPOSITORY, network: true, transport: fixture.transport });
  assert.equal(report.outcome, "manifest-bound", JSON.stringify(report.transport));
  assert.equal(report.verified.artifacts.length, ACTIVE_CONTRACT_MANIFEST_V1.maximumArtifacts);
  assert.equal(report.transport.requestsMade, RESOLVE_CONTRACT_V1.maximumRequests);
  assert.ok(report.transport.responseBytesRead < RESOLVE_CONTRACT_V1.maximumResponseBytes);
});

test("rate limits and arbitrary transport errors are safe, typed and credential-free", async () => {
  const rateLimited = await resolveActiveContractV1({
    repository: REPOSITORY,
    network: true,
    transport: async ({ url }) => ({
      status: 429,
      headers: { "retry-after": "60" },
      body: "{}",
      redirected: false,
      responseUrl: url
    })
  });
  assert.equal(rateLimited.outcome, "transport-failed");
  assert.equal(rateLimited.transport.failure.code, "GITHUB_RATE_LIMITED");
  assert.equal(rateLimited.transport.failure.retryAfterSeconds, 60);

  const secret = "Bearer fixture-secret-never-emit";
  const failed = await resolveActiveContractV1({
    repository: REPOSITORY,
    network: true,
    transport: async () => {
      throw new Error(`Authorization: ${secret}`);
    }
  });
  assert.equal(failed.transport.failure.code, "GITHUB_NETWORK_ERROR");
  assert.doesNotMatch(JSON.stringify(failed), /fixture-secret|Authorization/iu);
});

test("timeouts and redirects fail within explicit transport bounds", async () => {
  const timedOut = await resolveActiveContractV1({
    repository: REPOSITORY,
    network: true,
    timeoutMs: RESOLVE_CONTRACT_V1.minimumTimeoutMs,
    transport: async () => new Promise(() => {})
  });
  assert.equal(timedOut.outcome, "transport-failed");
  assert.equal(timedOut.transport.failure.code, "GITHUB_TIMEOUT");
  assert.equal(timedOut.transport.failure.retryable, true);
  assert.equal(timedOut.transport.requestsMade, 1);

  const redirected = await resolveActiveContractV1({
    repository: REPOSITORY,
    network: true,
    transport: async ({ url }) => ({
      status: 301,
      headers: {},
      body: "{}",
      redirected: true,
      responseUrl: `${url}/changed`
    })
  });
  assert.equal(redirected.outcome, "transport-failed");
  assert.equal(redirected.transport.failure.code, "GITHUB_REDIRECT_REJECTED");
  assert.equal(redirected.transport.redirectsFollowed, 0);
});

test("Git blob integrity mismatches remain typed transport failures", async () => {
  const bytes = Buffer.from("# Policy\n");
  const manifest = {
    $schema: ACTIVE_CONTRACT_MANIFEST_V1.schema,
    schemaVersion: ACTIVE_CONTRACT_MANIFEST_V1.schemaVersion,
    kind: ACTIVE_CONTRACT_MANIFEST_V1.kind,
    contractId: "integrity-mismatch",
    defaultBranch: "main",
    artifacts: Object.fromEntries(ACTIVE_CONTRACT_MANIFEST_V1.roles.map((role) => [role, [{
      path: `contracts/${role}.json`,
      sha256: sha256(bytes)
    }]]))
  };
  const blobs = new Map([[RESOLVE_CONTRACT_V1.manifestCandidates[0], Buffer.from(`${JSON.stringify(manifest)}\n`)]]);
  for (const role of ACTIVE_CONTRACT_MANIFEST_V1.roles) blobs.set(`contracts/${role}.json`, bytes);
  const fixture = createGitHubFixture(blobs);
  let corrupted = false;
  const report = await resolveActiveContractV1({
    repository: REPOSITORY,
    network: true,
    transport: async (request) => {
      const response = await fixture.transport(request);
      if (!corrupted && request.url.includes("/git/blobs/") && request.url !== `${API}/git/blobs/${gitBlobObjectId(blobs.get(RESOLVE_CONTRACT_V1.manifestCandidates[0]))}`) {
        corrupted = true;
        const body = JSON.parse(response.body);
        body.sha = "f".repeat(40);
        return { ...response, body: JSON.stringify(body) };
      }
      return response;
    }
  });
  assert.equal(corrupted, true);
  assert.equal(report.outcome, "transport-failed");
  assert.equal(report.transport.failure.code, "GITHUB_PROTOCOL_ERROR");
  assert.notEqual(report.transport.failure.code, "ACTIVE_CONTRACT_MANIFEST_INVALID");
});

test("manifest and repository inputs are closed and reject hidden authority fields or credentials", () => {
  assert.throws(
    () => normalizeContractRepositoryV1("https://token@github.com/example/registry"),
    /owner\/name slug/u
  );
  const base = {
    $schema: ACTIVE_CONTRACT_MANIFEST_V1.schema,
    schemaVersion: ACTIVE_CONTRACT_MANIFEST_V1.schemaVersion,
    kind: ACTIVE_CONTRACT_MANIFEST_V1.kind,
    contractId: "closed",
    defaultBranch: "main",
    artifacts: Object.fromEntries(ACTIVE_CONTRACT_MANIFEST_V1.roles.map((role) => [role, [{
      path: `contracts/${role}.json`,
      sha256: `sha256:${"a".repeat(64)}`
    }]])),
    githubApproval: true
  };
  assert.throws(() => validateActiveContractManifestV1(base), /unexpected fields/u);
});

function createGitHubFixture(blobs, options = {}) {
  const requests = [];
  const entries = [...blobs].map(([path, bytes]) => ({
    path,
    type: "blob",
    mode: "100644",
    sha: gitBlobObjectId(bytes),
    size: bytes.length
  }));
  const blobBySha = new Map(entries.map((entry) => [entry.sha, blobs.get(entry.path)]));
  let headRequestCount = 0;
  let metadataRequestCount = 0;
  const transport = async (request) => {
    requests.push({ url: request.url, request });
    const response = route(request.url);
    return { ...response, redirected: false, responseUrl: request.url };
  };
  function route(url) {
    if (url === API) {
      metadataRequestCount += 1;
      const defaultBranch = metadataRequestCount > 1 && options.secondRepository
        ? options.secondRepository.defaultBranch
        : "main";
      return jsonResponse({
      id: "900719925474099312345",
      private: false,
      visibility: "public",
      full_name: "Example/Registry",
      default_branch: defaultBranch,
      html_url: REPOSITORY_URI
      });
    }
    if (url === `${API}/git/ref/heads/main`) {
      headRequestCount += 1;
      const head = headRequestCount > 1 && options.secondHead ? options.secondHead : {
        revisionObjectId: COMMIT,
        treeObjectId: TREE
      };
      return jsonResponse({
        ref: "refs/heads/main",
        object: { type: "commit", sha: head.revisionObjectId }
      });
    }
    if (url === `${API}/git/commits/${COMMIT}`) return jsonResponse({
      sha: COMMIT,
      tree: { sha: TREE },
      html_url: `${REPOSITORY_URI}/commit/${COMMIT}`
    });
    if (options.secondHead && url === `${API}/git/commits/${options.secondHead.revisionObjectId}`) return jsonResponse({
      sha: options.secondHead.revisionObjectId,
      tree: { sha: options.secondHead.treeObjectId },
      html_url: `${REPOSITORY_URI}/commit/${options.secondHead.revisionObjectId}`
    });
    if (options.secondRepository && url === `${API}/git/ref/heads/${options.secondRepository.defaultBranch}`) return jsonResponse({
      ref: `refs/heads/${options.secondRepository.defaultBranch}`,
      object: { type: "commit", sha: options.secondRepository.head.revisionObjectId }
    });
    if (options.secondRepository && url === `${API}/git/commits/${options.secondRepository.head.revisionObjectId}`) return jsonResponse({
      sha: options.secondRepository.head.revisionObjectId,
      tree: { sha: options.secondRepository.head.treeObjectId },
      html_url: `${REPOSITORY_URI}/commit/${options.secondRepository.head.revisionObjectId}`
    });
    if (url === `${API}/git/trees/${TREE}?recursive=1`) return jsonResponse({
      sha: TREE,
      truncated: false,
      tree: entries
    });
    const blobPrefix = `${API}/git/blobs/`;
    if (url.startsWith(blobPrefix)) {
      const objectId = url.slice(blobPrefix.length);
      const bytes = blobBySha.get(objectId);
      if (bytes === undefined) return jsonResponse({}, 404);
      return jsonResponse({
        sha: objectId,
        size: bytes.length,
        encoding: "base64",
        content: bytes.toString("base64")
      });
    }
    return jsonResponse({}, 404);
  }
  return { transport, requests };
}

function jsonResponse(value, status = 200) {
  return { status, headers: {}, body: JSON.stringify(value) };
}

function gitBlobObjectId(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}
