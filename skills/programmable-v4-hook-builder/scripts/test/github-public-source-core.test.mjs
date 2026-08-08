import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";

import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GITHUB_PUBLIC_SOURCE_ERROR_CODES_V1,
  GitHubPublicSourceError,
  createGitHubPublicFetchTransportV1,
  resolveGitHubPublicSourceV1,
  serializeGitHubPublicSourceV1,
  validateGitHubPublicSourceRequestV1,
} from "../github-public-source-core.mjs";

const API = "https://api.github.com";
const COMMIT_A = "a".repeat(40);
const TREE_A = "b".repeat(40);
const COMMIT_B = "c".repeat(40);
const TREE_B = "d".repeat(40);
const WRONG_TREE = "e".repeat(40);

function fixtureObjectId(label) {
  return createHash("sha1").update(label).digest("hex");
}

function fixtureTreeEntry(entry) {
  const mode = entry.mode ?? (entry.type === "blob" ? "100644" : entry.type === "tree" ? "040000" : "160000");
  if (entry.type !== "blob") return {
    path: entry.path,
    type: entry.type,
    mode,
    sha: entry.sha ?? fixtureObjectId(`${entry.type}:${entry.path}`)
  };
  const content = Buffer.from(entry.content ?? `fixture blob for ${entry.path}\n`, "utf8");
  const sha = entry.sha ?? gitBlobObjectId(content);
  if (sha === gitBlobObjectId(content)) fixtureBlobBodies.set(sha, content);
  return {
    path: entry.path,
    type: "blob",
    mode,
    sha,
    size: entry.size ?? content.length
  };
}

const fixtureBlobBodies = new Map();

function gitBlobObjectId(bytes) {
  return createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

function addFixtureBlobRoutes(routes, prefix, entries) {
  for (const entry of entries) {
    if (entry.type !== "blob") continue;
    const content = fixtureBlobBodies.get(entry.sha);
    if (content === undefined) continue;
    routes.set(`${prefix}/git/blobs/${entry.sha}`, jsonResponse(200, {
      sha: entry.sha,
      size: content.length,
      encoding: "base64",
      content: content.toString("base64")
    }));
  }
}

function exactObjectRecord(entry, overrides = {}) {
  const bytes = overrides.bytes ?? fixtureBlobBodies.get(entry.sha);
  if (!(bytes instanceof Uint8Array)) throw new Error(`fixture bytes unavailable for ${entry.path}`);
  return {
    bytes: Buffer.from(bytes),
    mode: overrides.mode ?? entry.mode,
    objectId: overrides.objectId ?? entry.sha,
  };
}

function exactObjectResolverFor(repositoryUri, entries, overrides = new Map(), calls = []) {
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  return async (request) => {
    calls.push(request);
    assert.equal(request.repositoryUri, repositoryUri);
    const records = new Map();
    for (const path of request.paths) {
      const entry = entriesByPath.get(path);
      if (entry === undefined) continue;
      records.set(path, exactObjectRecord(entry, overrides.get(path)));
    }
    return { records };
  };
}

class RawJsonNumber {
  constructor(source) {
    this.source = String(source);
  }
}

function repositoryRequest(overrides = {}) {
  return {
    repositoryUri: "https://github.com/example/project",
    numericRepositoryId: "900719925474099312345",
    revisionObjectId: COMMIT_A,
    treeObjectId: TREE_A,
    sourcePaths: [],
    contractPaths: [],
    githubActionsRunIds: [],
    ...overrides,
  };
}

function sourceRequest(primary = repositoryRequest(), companions = []) {
  return {
    schemaVersion: "1.0.0",
    primary,
    companions,
  };
}

function addRepositoryRoutes(routes, request, options = {}) {
  const url = new URL(request.repositoryUri);
  const [owner, repository] = url.pathname.slice(1).split("/");
  const prefix = `${API}/repos/${owner}/${repository}`;
  const defaultBranch = options.defaultBranch ?? "main";
  const metadataId = options.metadataId ?? request.numericRepositoryId;
  const treeInCommit = options.treeInCommit ?? request.treeObjectId;
  const treeInResponse = options.treeInResponse ?? request.treeObjectId;
  const treeEntries = (options.treeEntries ?? [
    ...request.sourcePaths.map((path) => ({ path, type: path.includes(".") ? "blob" : "tree" })),
    ...request.contractPaths.map((path) => ({ path, type: "blob" })),
    ...request.githubActionsRunIds.map(() => ({ path: ".github/workflows/ci.yml", type: "blob" })),
  ]).map(fixtureTreeEntry);

  routes.set(prefix, jsonResponse(options.metadataStatus ?? 200, {
    id: new RawJsonNumber(metadataId),
    private: options.private ?? false,
    visibility: options.visibility ?? "public",
    full_name: options.fullName ?? `${owner}/${repository}`,
    default_branch: defaultBranch,
    html_url: options.repositoryHtmlUrl ?? request.repositoryUri,
  }, options.metadataHeaders));

  routes.set(`${prefix}/git/commits/${request.revisionObjectId}`, jsonResponse(options.commitStatus ?? 200, {
    sha: options.commitSha ?? request.revisionObjectId,
    tree: { sha: treeInCommit },
    html_url: `${request.repositoryUri}/commit/${request.revisionObjectId}`,
  }));

  for (const runId of request.githubActionsRunIds) {
    routes.set(`${prefix}/actions/runs/${runId}`, jsonResponse(200, {
      id: new RawJsonNumber(options.actionsRunId ?? runId),
      workflow_id: new RawJsonNumber(options.workflowId ?? "777777777777777777777"),
      run_attempt: new RawJsonNumber(options.runAttempt ?? 1),
      path: options.workflowPath ?? ".github/workflows/ci.yml@refs/heads/main",
      head_sha: options.actionsHeadSha ?? request.revisionObjectId,
      head_commit: {
        id: options.actionsHeadCommitId ?? request.revisionObjectId,
        tree_id: options.actionsHeadTree ?? request.treeObjectId,
      },
      repository: { id: new RawJsonNumber(options.actionsRepositoryId ?? metadataId) },
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      html_url: `${request.repositoryUri}/actions/runs/${runId}`,
    }));
  }

  const recursive =
    request.sourcePaths.length > 0 ||
    request.contractPaths.length > 0 ||
    request.githubActionsRunIds.length > 0;
  routes.set(
    `${prefix}/git/trees/${request.treeObjectId}${recursive ? "?recursive=1" : ""}`,
    jsonResponse(options.treeStatus ?? 200, {
      sha: treeInResponse,
      truncated: options.truncated ?? false,
      tree: treeEntries,
    }),
  );
  if (recursive) {
    routes.set(`${prefix}/git/trees/${request.treeObjectId}`, jsonResponse(options.treeStatus ?? 200, {
      sha: treeInResponse,
      truncated: false,
      tree: [],
    }));
  }
  addFixtureBlobRoutes(routes, prefix, treeEntries);
}

function addTargetedTreeRoutes(routes, request, requirements = null) {
  const url = new URL(request.repositoryUri);
  const [owner, repository] = url.pathname.slice(1).split("/");
  const prefix = `${API}/repos/${owner}/${repository}`;
  const requestedEntries = requirements ?? [
    ...request.sourcePaths.map((path) => ({ path, type: path.includes(".") ? "blob" : "tree" })),
    ...request.contractPaths.map((path) => ({ path, type: "blob" })),
    ...request.githubActionsRunIds.map(() => ({ path: ".github/workflows/ci.yml", type: "blob" })),
  ];
  const nodes = new Map([["", new Map()]]);
  const treeObjectIdForPath = (path) =>
    path === "" ? request.treeObjectId : fixtureObjectId(`tree:${request.treeObjectId}:${path}`);

  for (const requirement of requestedEntries) {
    const parts = requirement.path.split("/");
    let parentPath = "";
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const path = parentPath === "" ? part : `${parentPath}/${part}`;
      const isLeaf = index === parts.length - 1;
      const type = isLeaf ? requirement.type : "tree";
      const parent = nodes.get(parentPath);
      const entry = fixtureTreeEntry({
        path: part,
        type,
        ...(type === "tree" ? { sha: treeObjectIdForPath(path) } : {})
      });
      const existing = parent.get(part);
      if (existing === undefined || existing.type !== "tree") parent.set(part, entry);
      if (type === "tree" && !nodes.has(path)) nodes.set(path, new Map());
      parentPath = path;
    }
  }

  for (const [path, entries] of nodes) {
    const treeObjectId = treeObjectIdForPath(path);
    routes.set(`${prefix}/git/trees/${treeObjectId}`, jsonResponse(200, {
      sha: treeObjectId,
      truncated: false,
      tree: [...entries.values()],
    }));
    addFixtureBlobRoutes(routes, prefix, [...entries.values()]);
  }
  return { prefix, nodes, treeObjectIdForPath };
}

function setDirectTreeRoute(routes, prefix, requestedTreeObjectId, entries, options = {}) {
  const normalizedEntries = entries.map(fixtureTreeEntry);
  routes.set(`${prefix}/git/trees/${requestedTreeObjectId}`, jsonResponse(options.status ?? 200, {
    sha: options.responseTreeObjectId ?? requestedTreeObjectId,
    truncated: options.truncated ?? false,
    tree: normalizedEntries,
  }));
  addFixtureBlobRoutes(routes, prefix, normalizedEntries);
}

function jsonResponse(status, value, headers = {}) {
  return {
    status,
    headers,
    body: stringifyFixtureJson(value),
  };
}

function stringifyFixtureJson(value) {
  if (value instanceof RawJsonNumber) return value.source;
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stringifyFixtureJson).join(",")}]`;
  return `{${Object.entries(value)
    .map(([key, nested]) => `${JSON.stringify(key)}:${stringifyFixtureJson(nested)}`)
    .join(",")}}`;
}

function rawRepositoryMetadataBody(request, idMembers, additionalMembers = "") {
  const url = new URL(request.repositoryUri);
  const fullName = url.pathname.slice(1);
  return `{${idMembers},"private":false,"visibility":"public","full_name":${JSON.stringify(fullName)},"default_branch":"main","html_url":${JSON.stringify(request.repositoryUri)}${additionalMembers}}`;
}

function createFakeTransport(routes, seen = []) {
  return async (request) => {
    seen.push(request);
    const route = routes.get(request.url);
    if (route === undefined) {
      throw new Error(`unexpected fake route: ${request.url}`);
    }
    return typeof route === "function" ? route(request) : route;
  };
}

async function expectCode(promise, expectedCode) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof GitHubPublicSourceError);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

async function captureError(promise) {
  try {
    await promise;
    assert.fail("expected GitHubPublicSourceError");
  } catch (error) {
    assert.ok(error instanceof GitHubPublicSourceError);
    return error;
  }
}

test("resolves exact public source, sorts companions and paths, and emits deterministic JSON", async () => {
  const primary = repositoryRequest({
    sourcePaths: ["src/Z.sol", "README.md"],
    contractPaths: ["src/Hook.sol"],
    githubActionsRunIds: ["900719925474099355555"],
  });
  const companion300 = repositoryRequest({
    repositoryUri: "https://github.com/example/companion-z",
    numericRepositoryId: "300",
    revisionObjectId: COMMIT_B,
    treeObjectId: TREE_B,
  });
  const companion200 = repositoryRequest({
    repositoryUri: "https://github.com/example/companion-a",
    numericRepositoryId: "200",
    revisionObjectId: COMMIT_B,
    treeObjectId: TREE_B,
  });
  const request = sourceRequest(primary, [companion300, companion200]);
  const routes = new Map();
  addRepositoryRoutes(routes, primary);
  addRepositoryRoutes(routes, companion200);
  addRepositoryRoutes(routes, companion300);
  const seen = [];

  const result = await resolveGitHubPublicSourceV1(request, {
    transport: createFakeTransport(routes, seen),
  });

  assert.equal(result.kind, "github-public-source");
  assert.equal(result.githubApiVersion, "2026-03-10");
  assert.equal(result.primary.authority.numericRepositoryId, "900719925474099312345");
  assert.deepEqual(result.primary.sourcePaths, ["README.md", "src/Z.sol"]);
  assert.deepEqual(result.primary.contractPaths, ["src/Hook.sol"]);
  assert.deepEqual(result.companions.map((entry) => entry.authority.numericRepositoryId), ["200", "300"]);
  assert.deepEqual(result.primary.githubActionsEvidence[0], {
    runId: "900719925474099355555",
    runAttempt: "1",
    workflowId: "777777777777777777777",
    workflowPath: ".github/workflows/ci.yml",
    headRevision: COMMIT_A,
    headTree: TREE_A,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    htmlUrl: "https://github.com/example/project/actions/runs/900719925474099355555",
  });
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.primary.authority));

  for (const call of seen) {
    assert.equal(call.method, "GET");
    assert.equal(call.redirect, "error");
    assert.equal(call.headers.Accept, "application/vnd.github+json");
    assert.equal(call.headers["X-GitHub-Api-Version"], "2026-03-10");
    assert.equal(Object.keys(call.headers).some((key) => key.toLowerCase() === "authorization"), false);
    assert.ok(call.url.startsWith(`${API}/repos/`));
  }

  const canonical = serializeGitHubPublicSourceV1(result);
  assert.equal(canonical, serializeGitHubPublicSourceV1(result));
  assert.equal(canonical.includes("resolvedAt"), false);
  assert.ok(canonical.indexOf('"canonicalProviderOrigin"') < canonical.indexOf('"companions"'));
});

test("production fetch adapter sends only pinned public headers and reads a real streamed Response", async () => {
  const request = repositoryRequest();
  const routes = new Map();
  addRepositoryRoutes(routes, request);
  const seen = [];
  const transport = createGitHubPublicFetchTransportV1(async (url, options) => {
    seen.push({ url, options });
    const route = routes.get(url);
    assert.ok(route, `missing fetch fixture for ${url}`);
    return new Response(route.body, {
      status: route.status,
      headers: {
        ...route.headers,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(route.body)),
      },
    });
  });

  const result = await resolveGitHubPublicSourceV1(sourceRequest(request), { transport });
  assert.equal(result.primary.visibility, "public");
  assert.equal(seen.length, 3);
  for (const call of seen) {
    assert.equal(call.options.method, "GET");
    assert.equal(call.options.redirect, "error");
    assert.equal(call.options.headers["X-GitHub-Api-Version"], "2026-03-10");
    assert.equal(Object.hasOwn(call.options.headers, "Authorization"), false);
  }

  let credentialedFetchCalled = false;
  const guardedTransport = createGitHubPublicFetchTransportV1(async () => {
    credentialedFetchCalled = true;
    throw new Error("guard failed");
  });
  await expectCode(
    guardedTransport({
      method: "GET",
      url: `${API}/repos/example/project`,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.userAgent,
        "X-GitHub-Api-Version": "2026-03-10",
        Authorization: "Bearer never-accepted",
      },
      redirect: "error",
      signal: new AbortController().signal,
      maxResponseBytes: 1_024,
    }),
    "INVALID_OPTIONS",
  );
  assert.equal(credentialedFetchCalled, false);
});

test("repository rename changes only display locator when numeric identity and exact objects stay fixed", async () => {
  const oldRequest = repositoryRequest({ repositoryUri: "https://github.com/old-owner/old-name" });
  const renamedRequest = repositoryRequest({ repositoryUri: "https://github.com/new-owner/new-name" });
  const oldRoutes = new Map();
  const renamedRoutes = new Map();
  addRepositoryRoutes(oldRoutes, oldRequest);
  addRepositoryRoutes(renamedRoutes, renamedRequest);

  const oldResult = await resolveGitHubPublicSourceV1(sourceRequest(oldRequest), {
    transport: createFakeTransport(oldRoutes),
  });
  const renamedResult = await resolveGitHubPublicSourceV1(sourceRequest(renamedRequest), {
    transport: createFakeTransport(renamedRoutes),
  });

  assert.deepEqual(oldResult.primary.authority, renamedResult.primary.authority);
  assert.notDeepEqual(oldResult.primary.display, renamedResult.primary.display);
});

test("force-push and default-branch changes cannot move an exact source identity", async () => {
  const request = repositoryRequest();
  const beforeRoutes = new Map();
  const afterRoutes = new Map();
  addRepositoryRoutes(beforeRoutes, request, { defaultBranch: "main" });
  addRepositoryRoutes(afterRoutes, request, { defaultBranch: "release-after-force-push" });

  const before = await resolveGitHubPublicSourceV1(sourceRequest(request), {
    transport: createFakeTransport(beforeRoutes),
  });
  const after = await resolveGitHubPublicSourceV1(sourceRequest(request), {
    transport: createFakeTransport(afterRoutes),
  });

  assert.deepEqual(before.primary.authority, after.primary.authority);
  assert.equal(before.primary.display.defaultBranch, "main");
  assert.equal(after.primary.display.defaultBranch, "release-after-force-push");
});

test("rejects an exact commit that is no longer reachable from the public repository", async () => {
  const request = repositoryRequest();
  const routes = new Map();
  addRepositoryRoutes(routes, request, { commitStatus: 404 });
  await expectCode(
    resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
    "GITHUB_COMMIT_NOT_REACHABLE",
  );
});

test("rejects a commit tree mismatch and an independently wrong tree response", async (t) => {
  await t.test("commit points at another tree", async () => {
    const request = repositoryRequest();
    const routes = new Map();
    addRepositoryRoutes(routes, request, { treeInCommit: WRONG_TREE });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_TREE_MISMATCH",
    );
  });

  await t.test("tree endpoint returns another object", async () => {
    const request = repositoryRequest();
    const routes = new Map();
    addRepositoryRoutes(routes, request, { treeInResponse: WRONG_TREE });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_TREE_MISMATCH",
    );
  });
});

test("private and not-found repositories expose the same public-unavailable result", async (t) => {
  const request = repositoryRequest();
  let privateError;
  let notFoundError;

  await t.test("private metadata", async () => {
    const routes = new Map();
    addRepositoryRoutes(routes, request, { private: true, visibility: "private" });
    privateError = await captureError(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
    );
    assert.equal(privateError.code, "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE");
  });

  await t.test("404 metadata", async () => {
    const prefix = `${API}/repos/example/project`;
    const routes = new Map([[prefix, jsonResponse(404, { message: "Not Found" })]]);
    notFoundError = await captureError(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
    );
    assert.equal(notFoundError.code, "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE");
  });

  assert.deepEqual(privateError.toJSON(), notFoundError.toJSON());
});

test("classifies public API rate limits as retryable without accepting a token", async () => {
  const request = repositoryRequest();
  const prefix = `${API}/repos/example/project`;
  const routes = new Map([
    [prefix, {
      status: 403,
      headers: { "retry-after": "12", "x-ratelimit-remaining": "0" },
      body: "{malformed-rate-limit-body",
    }],
  ]);

  await assert.rejects(
    resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
    (error) => {
      assert.equal(error.code, "GITHUB_RATE_LIMITED");
      assert.equal(error.retryable, true);
      assert.equal(error.retryAfterSeconds, "12");
      return true;
    },
  );
  await expectCode(
    resolveGitHubPublicSourceV1({ ...sourceRequest(request), token: "never-accepted" }, {
      transport: createFakeTransport(routes),
    }),
    "INVALID_REQUEST",
  );
  await expectCode(
    resolveGitHubPublicSourceV1(sourceRequest(request), {
      transport: createFakeTransport(routes),
      token: "never-accepted",
    }),
    "INVALID_OPTIONS",
  );
});

test("extracts >2^53 repository and Actions identifiers losslessly from raw JSON numbers", async () => {
  const request = repositoryRequest({
    numericRepositoryId: "9".repeat(64),
    githubActionsRunIds: ["8".repeat(64)],
  });
  const routes = new Map();
  addRepositoryRoutes(routes, request, {
    metadataId: request.numericRepositoryId,
    workflowId: "7".repeat(64),
  });

  const result = await resolveGitHubPublicSourceV1(sourceRequest(request), {
    transport: createFakeTransport(routes),
  });
  assert.ok(BigInt(request.numericRepositoryId) > BigInt(Number.MAX_SAFE_INTEGER));
  assert.match(routes.get(`${API}/repos/example/project`).body, new RegExp(`"id":${request.numericRepositoryId},`));
  assert.equal(result.primary.authority.numericRepositoryId, request.numericRepositoryId);
  assert.equal(result.primary.githubActionsEvidence[0].runId, request.githubActionsRunIds[0]);
  assert.equal(result.primary.githubActionsEvidence[0].workflowId, "7".repeat(64));
  assert.throws(
    () => validateGitHubPublicSourceRequestV1(sourceRequest(repositoryRequest({ numericRepositoryId: 123 }))),
    (error) => error.code === "INVALID_REQUEST",
  );
});

test("does not collapse distinct repository ids that map to the same JavaScript Number", async () => {
  const expectedId = "9007199254740993";
  const observedId = "9007199254740992";
  assert.equal(Number(expectedId), Number(observedId));
  const request = repositoryRequest({ numericRepositoryId: expectedId });
  const routes = new Map();
  addRepositoryRoutes(routes, request, { metadataId: observedId });

  await expectCode(
    resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
    "GITHUB_REPOSITORY_ID_MISMATCH",
  );
});

test("rejects string, exponent, duplicate-id, and malformed repository metadata", async (t) => {
  const repositoryId = "9".repeat(64);
  const request = repositoryRequest({ numericRepositoryId: repositoryId });
  const prefix = `${API}/repos/example/project`;
  const deeplyNested = `${"[".repeat(130)}null${"]".repeat(130)}`;
  const validBody = rawRepositoryMetadataBody(request, `"id":${repositoryId}`);
  const cases = [
    ["quoted id string", rawRepositoryMetadataBody(request, `"id":${JSON.stringify(repositoryId)}`)],
    ["exponent id", rawRepositoryMetadataBody(request, '"id":9e63')],
    [
      "duplicate id",
      rawRepositoryMetadataBody(request, `"id":${repositoryId},"i\\u0064":${"8".repeat(64)}`),
    ],
    ["leading-zero number", rawRepositoryMetadataBody(request, `"id":0${repositoryId}`)],
    ["oversized number", rawRepositoryMetadataBody(request, `"id":${"1".repeat(129)}`)],
    ["unterminated object", validBody.slice(0, -1)],
    ["excessive nesting", rawRepositoryMetadataBody(request, `"id":${repositoryId}`, `,"padding":${deeplyNested}`)],
  ];

  for (const [name, body] of cases) {
    await t.test(name, async () => {
      const routes = new Map();
      addRepositoryRoutes(routes, request);
      routes.set(prefix, { status: 200, headers: {}, body });
      const seen = [];
      await expectCode(
        resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes, seen) }),
        "GITHUB_PROTOCOL_ERROR",
      );
      assert.equal(seen.length, 1);
    });
  }
});

test("rejects duplicate repositories, paths, and Actions ids before transport", async (t) => {
  const neverTransport = async () => {
    assert.fail("transport must not run for invalid input");
  };

  await t.test("duplicate repository identity", async () => {
    const companion = repositoryRequest({ repositoryUri: "https://github.com/example/another" });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(repositoryRequest(), [companion]), { transport: neverTransport }),
      "INVALID_REQUEST",
    );
  });

  await t.test("duplicate path across source and contract declarations", async () => {
    const request = repositoryRequest({ sourcePaths: ["src/Hook.sol"], contractPaths: ["src/Hook.sol"] });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: neverTransport }),
      "INVALID_REQUEST",
    );
  });

  await t.test("duplicate Actions run id", async () => {
    const request = repositoryRequest({ githubActionsRunIds: ["12", "12"] });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: neverTransport }),
      "INVALID_REQUEST",
    );
  });
});

test("rejects path traversal and encoded separator injection", async () => {
  const invalidPaths = [
    "../secret",
    "src/../secret",
    "/absolute",
    "src\\secret",
    "src/%2f/secret",
    "src//secret",
    "src/.git/config",
    "src/.GIT/config",
    "src/tab\tname.sol",
    "src/bidi\u202ename.sol",
    "src/cafe\u0301.sol",
    `src/${String.fromCharCode(0xd800)}.sol`,
  ];
  for (const path of invalidPaths) {
    assert.throws(
      () => validateGitHubPublicSourceRequestV1(sourceRequest(repositoryRequest({ sourcePaths: [path] }))),
      (error) => error.code === "INVALID_REQUEST",
    );
  }
});

test("accepts NFC UTF-8 repository paths with spaces through the exact 1024-byte bound", () => {
  const exactBound = `a/${"x".repeat(1_022)}`;
  assert.equal(Buffer.byteLength(exactBound, "utf8"), 1_024);
  const normalized = validateGitHubPublicSourceRequestV1(sourceRequest(repositoryRequest({
    sourcePaths: [exactBound, "src/échange hook.sol"],
  })));
  assert.deepEqual(normalized.primary.sourcePaths, [exactBound, "src/échange hook.sol"]);

  const oversized = `a/${"x".repeat(1_023)}`;
  assert.equal(Buffer.byteLength(oversized, "utf8"), 1_025);
  assert.throws(
    () => validateGitHubPublicSourceRequestV1(sourceRequest(repositoryRequest({ sourcePaths: [oversized] }))),
    (error) => error.code === "INVALID_REQUEST",
  );
});

test("accepts 512 total declared paths and rejects the 513th before transport", () => {
  const sourcePaths = Array.from({ length: 256 }, (_, index) => `src/file-${String(index).padStart(3, "0")}.ts`);
  const contractPaths = Array.from({ length: 256 }, (_, index) => `contracts/Hook${String(index).padStart(3, "0")}.sol`);
  const normalized = validateGitHubPublicSourceRequestV1(sourceRequest(repositoryRequest({ sourcePaths, contractPaths })));
  assert.equal(normalized.primary.sourcePaths.length, 256);
  assert.equal(normalized.primary.contractPaths.length, 256);

  assert.throws(
    () => validateGitHubPublicSourceRequestV1(sourceRequest(repositoryRequest({
      sourcePaths: [...sourcePaths, "src/overflow.ts"],
      contractPaths,
    }))),
    (error) => error.code === "INVALID_REQUEST",
  );
});

test("rejects host, case, suffix, query, and SHA injection", async () => {
  const invalidUris = [
    "http://github.com/example/project",
    "https://github.com.evil.example/example/project",
    "https://GitHub.com/example/project",
    "https://github.com/Example/project",
    "https://github.com/example/project/",
    "https://github.com/example/project.git",
    "https://github.com/example/project?ref=main",
  ];
  for (const repositoryUri of invalidUris) {
    assert.throws(
      () => validateGitHubPublicSourceRequestV1(sourceRequest(repositoryRequest({ repositoryUri }))),
      (error) => error.code === "INVALID_REQUEST",
    );
  }

  const invalidShas = ["A".repeat(40), "a".repeat(39), `${COMMIT_A}/heads/main`, `${COMMIT_A}?ref=main`];
  for (const revisionObjectId of invalidShas) {
    assert.throws(
      () => validateGitHubPublicSourceRequestV1(sourceRequest(repositoryRequest({ revisionObjectId }))),
      (error) => error.code === "INVALID_REQUEST",
    );
  }
});

test("rejects redirects, oversized aggregate responses, and timeouts", async (t) => {
  const request = repositoryRequest();
  const prefix = `${API}/repos/example/project`;

  await t.test("redirect", async () => {
    const routes = new Map([[prefix, { status: 301, headers: { location: "https://evil.example" }, body: "" }]]);
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_REDIRECT_REJECTED",
    );
  });

  await t.test("response bytes", async () => {
    const routes = new Map([[prefix, { status: 200, headers: {}, body: "x".repeat(1_025) }]]);
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), {
        transport: createFakeTransport(routes),
        maxResponseBytes: 1_024,
      }),
      "GITHUB_RESPONSE_TOO_LARGE",
    );
  });

  await t.test("deadline", async () => {
    const stalledTransport = async () => new Promise(() => {});
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: stalledTransport, timeoutMs: 10 }),
      "GITHUB_TIMEOUT",
    );
  });
});

test("binds GitHub Actions evidence to repository, commit, tree, workflow path, and exact tree", async (t) => {
  const request = repositoryRequest({ githubActionsRunIds: ["42"] });

  await t.test("wrong repository", async () => {
    const routes = new Map();
    addRepositoryRoutes(routes, request, { actionsRepositoryId: "123" });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_ACTIONS_RUN_MISMATCH",
    );
  });

  await t.test("wrong commit tree", async () => {
    const routes = new Map();
    addRepositoryRoutes(routes, request, { actionsHeadTree: WRONG_TREE });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_ACTIONS_RUN_MISMATCH",
    );
  });

  await t.test("workflow absent from exact tree", async () => {
    const routes = new Map();
    addRepositoryRoutes(routes, request, { treeEntries: [] });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_ACTIONS_WORKFLOW_NOT_IN_TREE",
    );
  });

  await t.test("truncated recursive evidence is re-resolved through the exact workflow path", async () => {
    const routes = new Map();
    addRepositoryRoutes(routes, request, { truncated: true });
    addTargetedTreeRoutes(routes, request);
    const seen = [];
    const result = await resolveGitHubPublicSourceV1(sourceRequest(request), {
      transport: createFakeTransport(routes, seen),
    });
    assert.equal(result.primary.githubActionsEvidence[0].workflowPath, ".github/workflows/ci.yml");
    assert.equal(seen.filter((entry) => entry.url.includes("/git/blobs/")).length, 1);
  });
});

test("resolves declared monorepo paths from a huge truncated tree and reads only bounded declared blobs", async () => {
  const request = repositoryRequest({
    sourcePaths: ["packages/game/src/index.ts"],
    contractPaths: ["contracts/Hook.sol"],
  });
  const partialEntries = Array.from({ length: 5_000 }, (_, index) => ({
    path: `irrelevant/generated-${String(index).padStart(4, "0")}.js`,
    type: "blob",
  }));
  const routes = new Map();
  addRepositoryRoutes(routes, request, { truncated: true, treeEntries: partialEntries });
  addTargetedTreeRoutes(routes, request);
  const seen = [];

  const result = await resolveGitHubPublicSourceV1(sourceRequest(request), {
    transport: createFakeTransport(routes, seen),
  });

  assert.deepEqual(result.primary.sourcePaths, ["packages/game/src/index.ts"]);
  assert.deepEqual(result.primary.contractPaths, ["contracts/Hook.sol"]);
  const requestedUrls = seen.map((entry) => entry.url);
  assert.ok(requestedUrls.some((url) => url.endsWith(`${request.treeObjectId}?recursive=1`)));
  assert.ok(requestedUrls.some((url) => url.endsWith(`/git/trees/${request.treeObjectId}`)));
  assert.equal(requestedUrls.filter((url) => url.includes("/git/blobs/")).length, 2);
  assert.equal(requestedUrls.some((url) => url.includes("/contents/")), false);
  assert.equal(requestedUrls.some((url) => url.includes("irrelevant/generated-")), false);
});

test("a batched exact-object resolver supports 512 tiny public files without REST blob requests", async () => {
  const sourcePaths = Array.from({ length: 512 }, (_, index) =>
    `app/generated/file-${String(index).padStart(3, "0")}.ts`);
  const request = repositoryRequest({ sourcePaths });
  const entries = sourcePaths.map((path, index) => fixtureTreeEntry({
    path,
    type: "blob",
    content: `export const value${index} = ${index};\n`,
  }));
  const routes = new Map();
  addRepositoryRoutes(routes, request, { treeEntries: entries });
  const seen = [];
  const resolverCalls = [];

  const result = await resolveGitHubPublicSourceV1(sourceRequest(request), {
    transport: createFakeTransport(routes, seen),
    exactObjectResolver: exactObjectResolverFor(request.repositoryUri, entries, new Map(), resolverCalls),
  });

  assert.equal(result.primary.sourcePaths.length, 512);
  assert.equal(resolverCalls.length, 1);
  assert.equal(resolverCalls[0].paths.length, 512);
  assert.equal(seen.length, 3);
  assert.equal(seen.some(({ url }) => url.includes("/git/blobs/")), false);
});

test("an exact-object batch uses one direct REST root object instead of a recursive REST tree crawl", async () => {
  const sourcePaths = Array.from({ length: 128 }, (_, index) =>
    `directory-${String(index).padStart(3, "0")}/Hook.sol`);
  const request = repositoryRequest({ sourcePaths });
  const entries = sourcePaths.map((path, index) => fixtureTreeEntry({
    path,
    type: "blob",
    content: `contract Hook${index} {}\n`,
  }));
  const routes = new Map();
  addRepositoryRoutes(routes, request, {
    truncated: true,
    treeEntries: [{ path: "irrelevant/partial.txt", type: "blob" }],
  });
  const seen = [];
  const resolverCalls = [];

  const result = await resolveGitHubPublicSourceV1(sourceRequest(request), {
    transport: createFakeTransport(routes, seen),
    exactObjectResolver: exactObjectResolverFor(request.repositoryUri, entries, new Map(), resolverCalls),
  });

  assert.equal(result.primary.sourcePaths.length, 128);
  assert.equal(resolverCalls.length, 1);
  assert.equal(seen.length, 3);
  assert.equal(seen.some(({ url }) => url.includes("/git/blobs/")), false);
  assert.equal(seen.some(({ url }) => url.endsWith(`/git/trees/${request.treeObjectId}`)), true);
  assert.equal(seen.some(({ url }) => url.endsWith(`/git/trees/${request.treeObjectId}?recursive=1`)), false);
});

test("exact-object batches fail closed on identity, mode, LFS, and resource violations", async (t) => {
  const path = "src/Hook.sol";
  const request = repositoryRequest({ sourcePaths: [path] });
  const regular = fixtureTreeEntry({ path, type: "blob", content: "contract Hook {}\n" });

  for (const [name, treeOptions, override, code] of [
    ["wrong object id", { treeEntries: [regular] }, { objectId: "f".repeat(40) }, "GITHUB_PROTOCOL_ERROR"],
    ["invalid blob mode", { treeEntries: [regular] }, { mode: "120000" }, "GITHUB_DECLARED_PATH_NOT_FOUND"],
    [
      "Git LFS pointer including CRLF",
      { truncated: true, treeEntries: [] },
      {
        bytes: Buffer.from(
          "version https://git-lfs.github.com/spec/v1\r\noid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\r\nsize 12\r\n",
        ),
      },
      "GITHUB_DECLARED_PATH_NOT_FOUND",
    ],
    [
      "oversized exact object",
      { truncated: true, treeEntries: [] },
      { bytes: Buffer.alloc(2_000_001, 1) },
      "GITHUB_RESPONSE_TOO_LARGE",
    ],
  ]) {
    await t.test(name, async () => {
      const routes = new Map();
      addRepositoryRoutes(routes, request, treeOptions);
      const bytes = override.bytes ?? fixtureBlobBodies.get(regular.sha);
      const objectId = override.objectId
        ?? (override.bytes === undefined ? regular.sha : gitBlobObjectId(bytes));
      const records = new Map([[path, {
        bytes,
        mode: override.mode ?? regular.mode,
        objectId,
      }]]);
      await expectCode(
        resolveGitHubPublicSourceV1(sourceRequest(request), {
          transport: createFakeTransport(routes),
          exactObjectResolver: async () => ({ records }),
        }),
        code,
      );
    });
  }

  await t.test("undeclared record", async () => {
    const routes = new Map();
    addRepositoryRoutes(routes, request, { treeEntries: [regular] });
    const bytes = fixtureBlobBodies.get(regular.sha);
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), {
        transport: createFakeTransport(routes),
        exactObjectResolver: async () => ({ records: new Map([
          [path, { bytes, mode: regular.mode, objectId: regular.sha }],
          ["src/Other.sol", { bytes, mode: regular.mode, objectId: regular.sha }],
        ]) }),
      }),
      "GITHUB_PROTOCOL_ERROR",
    );
  });
});

test("canonical two-megabyte file and twenty-megabyte repository boundaries are exact", async () => {
  const fullBlob = Buffer.alloc(2_000_000, 0x61);
  const fullObjectId = gitBlobObjectId(fullBlob);
  const exactPaths = Array.from({ length: 10 }, (_, index) => `src/full-${index}.bin`);
  const exactRequest = repositoryRequest({ sourcePaths: exactPaths });
  const exactRoutes = new Map();
  addRepositoryRoutes(exactRoutes, exactRequest, { truncated: true, treeEntries: [] });
  const exactRecords = new Map(exactPaths.map((filePath) => [filePath, {
    bytes: fullBlob,
    mode: "100644",
    objectId: fullObjectId,
  }]));
  const resolved = await resolveGitHubPublicSourceV1(sourceRequest(exactRequest), {
    transport: createFakeTransport(exactRoutes),
    exactObjectResolver: async (request) => {
      assert.equal(request.maximumFileBytes, 2_000_000);
      assert.equal(request.maximumTotalBytes, 20_000_000);
      return { records: exactRecords };
    },
  });
  assert.equal(resolved.primary.sourcePaths.length, 10);

  const overPaths = [...exactPaths, "src/one-more-byte.bin"];
  const overRequest = repositoryRequest({ sourcePaths: overPaths });
  const overRoutes = new Map();
  addRepositoryRoutes(overRoutes, overRequest, { truncated: true, treeEntries: [] });
  const oneByte = Buffer.from([0x61]);
  const overRecords = new Map([
    ...exactRecords,
    ["src/one-more-byte.bin", {
      bytes: oneByte,
      mode: "100644",
      objectId: gitBlobObjectId(oneByte),
    }],
  ]);
  await expectCode(
    resolveGitHubPublicSourceV1(sourceRequest(overRequest), {
      transport: createFakeTransport(overRoutes),
      exactObjectResolver: async () => ({ records: overRecords }),
    }),
    "GITHUB_RESPONSE_TOO_LARGE",
  );
});

test("twenty megabytes of exact local HEAD bytes do not consume the REST response budget", async () => {
  const fullBlob = Buffer.alloc(2_000_000, 0x62);
  const fullObjectId = gitBlobObjectId(fullBlob);
  const sourcePaths = Array.from({ length: 10 }, (_, index) => `src/local-${index}.bin`);
  const request = repositoryRequest({ sourcePaths });
  const routes = new Map();
  addRepositoryRoutes(routes, request, {
    treeEntries: sourcePaths.map((filePath) => ({
      path: filePath,
      type: "blob",
      sha: fullObjectId,
      size: fullBlob.length,
      content: "metadata-only fixture",
    })),
  });
  const seen = [];
  const result = await resolveGitHubPublicSourceV1(sourceRequest(request), {
    transport: createFakeTransport(routes, seen),
    maxResponseBytes: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTotalResponseBytes,
    localBlobBytes: new Map([[request.repositoryUri, new Map(
      sourcePaths.map((filePath) => [filePath, fullBlob]),
    )]]),
  });
  assert.equal(result.primary.sourcePaths.length, 10);
  assert.equal(seen.length, 3);
  assert.equal(seen.some(({ url }) => url.includes("/git/blobs/")), false);
});

test("fails closed on adversarial non-recursive tree walking", async (t) => {
  const request = repositoryRequest({ sourcePaths: ["src/Hook.sol"] });
  const setup = () => {
    const routes = new Map();
    addRepositoryRoutes(routes, request, { truncated: true });
    return { routes, prefix: `${API}/repos/example/project` };
  };

  await t.test("missing declared path", async () => {
    const { routes, prefix } = setup();
    setDirectTreeRoute(routes, prefix, request.treeObjectId, []);
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_DECLARED_PATH_NOT_FOUND",
    );
  });

  await t.test("deceptive nested path in a direct tree", async () => {
    const { routes, prefix } = setup();
    setDirectTreeRoute(routes, prefix, request.treeObjectId, [{ path: "src/Hook.sol", type: "blob" }]);
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_PROTOCOL_ERROR",
    );
  });

  await t.test("blob cannot impersonate an intermediate directory", async () => {
    const { routes, prefix } = setup();
    setDirectTreeRoute(routes, prefix, request.treeObjectId, [{ path: "src", type: "blob" }]);
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_DECLARED_PATH_NOT_FOUND",
    );
  });

  await t.test("duplicate direct entries", async () => {
    const { routes, prefix } = setup();
    setDirectTreeRoute(routes, prefix, request.treeObjectId, [
      { path: "src", type: "tree" },
      { path: "src", type: "tree", sha: fixtureObjectId("different-src-tree") },
    ]);
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_PROTOCOL_ERROR",
    );
  });

  await t.test("malformed child tree SHA", async () => {
    const { routes, prefix } = setup();
    setDirectTreeRoute(routes, prefix, request.treeObjectId, [
      { path: "src", type: "tree", sha: "f".repeat(39) },
    ]);
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_PROTOCOL_ERROR",
    );
  });

  await t.test("child endpoint returns a different checked SHA", async () => {
    const { routes, prefix } = setup();
    const childTreeObjectId = fixtureObjectId("src-tree");
    setDirectTreeRoute(routes, prefix, request.treeObjectId, [
      { path: "src", type: "tree", sha: childTreeObjectId },
    ]);
    setDirectTreeRoute(routes, prefix, childTreeObjectId, [{ path: "Hook.sol", type: "blob" }], {
      responseTreeObjectId: WRONG_TREE,
    });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_TREE_MISMATCH",
    );
  });
});

test("declared source identity requires regular Git blobs and rejects Git LFS indirection", async (t) => {
  await t.test("regular non-executable and executable blobs", async () => {
    const request = repositoryRequest({ sourcePaths: ["src/a.ts", "src/tool.sh"] });
    const routes = new Map();
    addRepositoryRoutes(routes, request, {
      treeEntries: [
        { path: "src/a.ts", type: "blob", mode: "100644" },
        { path: "src/tool.sh", type: "blob", mode: "100755" }
      ]
    });
    const result = await resolveGitHubPublicSourceV1(sourceRequest(request), {
      transport: createFakeTransport(routes)
    });
    assert.deepEqual(result.primary.sourcePaths, ["src/a.ts", "src/tool.sh"]);
  });

  for (const [name, entry, code] of [
    ["symbolic link", { path: "src/Hook.sol", type: "blob", mode: "120000", content: "../secret" }, "GITHUB_DECLARED_PATH_NOT_FOUND"],
    ["gitlink", { path: "src/Hook.sol", type: "commit", mode: "160000" }, "GITHUB_DECLARED_PATH_NOT_FOUND"],
    ["directory", { path: "src/Hook.sol", type: "tree", mode: "040000" }, "GITHUB_DECLARED_PATH_NOT_FOUND"],
    ["mode and type mismatch", { path: "src/Hook.sol", type: "blob", mode: "040000" }, "GITHUB_PROTOCOL_ERROR"]
  ]) {
    await t.test(name, async () => {
      const request = repositoryRequest({ sourcePaths: ["src/Hook.sol"] });
      const routes = new Map();
      addRepositoryRoutes(routes, request, { treeEntries: [entry] });
      await expectCode(
        resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
        code
      );
    });
  }

  await t.test("Git LFS pointer", async () => {
    const request = repositoryRequest({ sourcePaths: ["src/Hook.sol"] });
    const routes = new Map();
    addRepositoryRoutes(routes, request, {
      treeEntries: [{
        path: "src/Hook.sol",
        type: "blob",
        content: "version https://git-lfs.github.com/spec/v1\noid sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nsize 12345\n"
      }]
    });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes) }),
      "GITHUB_DECLARED_PATH_NOT_FOUND"
    );
  });
});

test("recursive tree parsing covers GitHub's documented envelope and rejects larger responses", async (t) => {
  await t.test("seven-megabyte response", async () => {
    const request = repositoryRequest({ sourcePaths: ["src/Hook.sol"] });
    const routes = new Map();
    addRepositoryRoutes(routes, request);
    const treeUrl = `${API}/repos/example/project/git/trees/${request.treeObjectId}?recursive=1`;
    const parsed = JSON.parse(routes.get(treeUrl).body);
    routes.set(treeUrl, jsonResponse(200, { ...parsed, ignoredPadding: "x".repeat(7_000_000) }));
    const result = await resolveGitHubPublicSourceV1(sourceRequest(request), {
      transport: createFakeTransport(routes),
      maxResponseBytes: 16_777_216
    });
    assert.deepEqual(result.primary.sourcePaths, ["src/Hook.sol"]);
  });

  await t.test("response beyond eight MiB", async () => {
    const request = repositoryRequest({ sourcePaths: ["src/Hook.sol"] });
    const routes = new Map();
    addRepositoryRoutes(routes, request);
    const prefix = `${API}/repos/example/project`;
    routes.set(`${prefix}/git/trees/${request.treeObjectId}?recursive=1`, {
      status: 200,
      headers: {},
      body: "x".repeat(8_388_609)
    });
    await expectCode(
      resolveGitHubPublicSourceV1(sourceRequest(request), {
        transport: createFakeTransport(routes),
        maxResponseBytes: 16_777_216
      }),
      "GITHUB_RESPONSE_TOO_LARGE"
    );
  });
});

test("caps targeted tree walking even when every declared path uses a unique subtree", async () => {
  const sourcePaths = Array.from({ length: 128 }, (_, index) =>
    `directory-${String(index).padStart(3, "0")}/Hook.sol`);
  const request = repositoryRequest({ sourcePaths });
  const routes = new Map();
  addRepositoryRoutes(routes, request, { truncated: true });
  const prefix = `${API}/repos/example/project`;
  const rootEntries = sourcePaths.map((path) => {
    const directory = path.split("/")[0];
    return { path: directory, type: "tree", sha: fixtureObjectId(`walk-budget:${directory}`) };
  });
  setDirectTreeRoute(routes, prefix, request.treeObjectId, rootEntries);
  for (const entry of rootEntries) {
    setDirectTreeRoute(routes, prefix, entry.sha, [{
      path: "Hook.sol",
      type: "blob",
      content: `source from ${entry.path}\n`
    }]);
  }
  const seen = [];

  await expectCode(
    resolveGitHubPublicSourceV1(sourceRequest(request), { transport: createFakeTransport(routes, seen) }),
    "GITHUB_UPSTREAM_REJECTED",
  );
  assert.equal(seen.length, 48);
  const targetedTreeRequests = seen.filter(
    (entry) => entry.url.includes("/git/trees/") && !entry.url.endsWith("?recursive=1"),
  );
  assert.equal(targetedTreeRequests.length, 23);
});

test("resolves the primary and all eight companions in bounded deterministic batches", async () => {
  const repositories = Array.from({ length: 9 }, (_, index) => repositoryRequest({
    repositoryUri: `https://github.com/example/project-${index}`,
    numericRepositoryId: String(1_000 + index),
    revisionObjectId: fixtureObjectId(`commit:${index}`),
    treeObjectId: fixtureObjectId(`tree:${index}`),
  }));
  const routes = new Map();
  for (const repository of repositories) addRepositoryRoutes(routes, repository);
  let metadataGroup = [];
  let releasedGroups = 0;
  let activeMetadata = 0;
  let maximumActiveMetadata = 0;
  const transport = async (request) => {
    const route = routes.get(request.url);
    if (route === undefined) throw new Error(`unexpected fake route: ${request.url}`);
    if (/\/repos\/[^/]+\/[^/]+$/.test(new URL(request.url).pathname)) {
      activeMetadata += 1;
      maximumActiveMetadata = Math.max(maximumActiveMetadata, activeMetadata);
      return new Promise((resolve) => {
        metadataGroup.push(() => {
          activeMetadata -= 1;
          resolve(route);
        });
        if (metadataGroup.length === 3) {
          const group = metadataGroup;
          metadataGroup = [];
          releasedGroups += 1;
          queueMicrotask(() => group.forEach((release) => release()));
        }
      });
    }
    return route;
  };

  const result = await resolveGitHubPublicSourceV1(sourceRequest(repositories[0], repositories.slice(1)), {
    transport,
    timeoutMs: 500,
  });
  assert.equal(result.companions.length, 8);
  assert.equal(releasedGroups, 3);
  assert.equal(maximumActiveMetadata, 3);
  assert.deepEqual(
    result.companions.map((entry) => entry.authority.numericRepositoryId),
    repositories.slice(1).map((entry) => entry.numericRepositoryId),
  );
});

test("a stalled companion shares the one total deadline", async () => {
  const primary = repositoryRequest({ numericRepositoryId: "100" });
  const stalled = repositoryRequest({
    repositoryUri: "https://github.com/example/stalled",
    numericRepositoryId: "101",
    revisionObjectId: COMMIT_B,
    treeObjectId: TREE_B,
  });
  const healthy = repositoryRequest({
    repositoryUri: "https://github.com/example/healthy",
    numericRepositoryId: "102",
    revisionObjectId: fixtureObjectId("healthy-commit"),
    treeObjectId: fixtureObjectId("healthy-tree"),
  });
  const routes = new Map();
  addRepositoryRoutes(routes, primary);
  addRepositoryRoutes(routes, healthy);
  const stalledMetadataUrl = `${API}/repos/example/stalled`;
  const transport = async (request) => {
    if (request.url === stalledMetadataUrl) return new Promise(() => {});
    const route = routes.get(request.url);
    if (route === undefined) throw new Error(`unexpected fake route: ${request.url}`);
    return route;
  };
  const started = performance.now();

  await expectCode(
    resolveGitHubPublicSourceV1(sourceRequest(primary, [healthy, stalled]), { transport, timeoutMs: 20 }),
    "GITHUB_TIMEOUT",
  );
  assert.ok(performance.now() - started < 250);
});

test("frozen machine reference matches implementation constants and authority boundary", () => {
  const schemaBytes = fs.readFileSync(
    new URL("../../references/github-public-source-contract-v1.schema.json", import.meta.url),
  );
  const contract = JSON.parse(
    fs.readFileSync(new URL("../../references/github-public-source-contract-v1.json", import.meta.url), "utf8"),
  );
  const schema = JSON.parse(schemaBytes.toString("utf8"));

  assert.equal(contract.contract, GITHUB_PUBLIC_SOURCE_CONTRACT_V1.name);
  assert.equal(contract.schemaVersion, GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion);
  assert.equal(contract.githubApiVersion, GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion);
  assert.equal(contract.schemaSha256, `sha256:${createHash("sha256").update(schemaBytes).digest("hex")}`);
  assert.deepEqual(contract.limits, GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits);
  assert.deepEqual(contract.errors, GITHUB_PUBLIC_SOURCE_ERROR_CODES_V1);
  assert.deepEqual(schema.$defs.GitHubPublicSourceErrorV1.properties.error.enum, GITHUB_PUBLIC_SOURCE_ERROR_CODES_V1);
  assert.deepEqual(contract.authority, ["numericRepositoryId", "revisionObjectId", "treeObjectId"]);
  assert.deepEqual(contract.displayOnly, ["repositoryUri", "owner", "repository", "defaultBranch"]);
  assert.equal(contract.invariants.acceptsCredentials, false);
  assert.equal(contract.invariants.pullRequestTextIsAuthority, false);
  assert.equal(contract.invariants.branchIsAuthority, false);
  assert.equal(contract.invariants.slugIsAuthority, false);
  assert.equal(schema.$defs.GitHubPublicSourceRequestV1.properties.schemaVersion.const, "1.0.0");
  assert.equal(schema.$defs.GitHubPublicRepositoryRequestV1.properties.sourcePaths.maxItems, 512);
  assert.equal(schema.$defs.GitHubPublicRepositoryRequestV1.properties.contractPaths.maxItems, 512);
});
