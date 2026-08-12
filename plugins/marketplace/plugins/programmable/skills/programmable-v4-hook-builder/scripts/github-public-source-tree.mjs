import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  isGitLfsPointer,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";
import { GitHubPublicSourceError } from "./github-public-source-contract.mjs";
import { requestGitHubJson } from "./github-public-source-api.mjs";
import {
  assertPlainObject,
  compareUtf8,
  lowerHex40,
  normalizeGitObjectId,
  normalizeRepositoryPath,
  normalizeTreeBlobSize,
  normalizeTreeEntryMode
} from "./github-public-source-shared.mjs";

const maximumDeclaredBlobBytes = REVIEW_TARGET_CONTRACT_V1.maximumFileBytes;
const maximumDeclaredAggregateBytes = REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes;
// The fallback follows only declared paths. These independent caps prevent a
// malicious or unusually broad tree from turning path validation into a crawl.
const maximumTreeWalkRequestsPerRepository =
  REVIEW_TARGET_CONTRACT_V1.maximumFiles * REVIEW_TARGET_CONTRACT_V1.maximumPathDepth;
const maximumTreeWalkDepth = REVIEW_TARGET_CONTRACT_V1.maximumPathDepth;

export async function validateTree(tree, repositoryPrefix, request, actionsEvidence, state, { recursive }) {
  const hasDeclaredPaths =
    request.sourcePaths.length > 0 || request.contractPaths.length > 0 || actionsEvidence.length > 0;
  const entries = indexTreeResponse(tree, request.treeObjectId, recursive ? "recursive" : "direct", {
    allowTruncated: recursive && hasDeclaredPaths,
  });

  if (hasDeclaredPaths && state.exactObjectResolver !== null && !recursive) {
    await validateDeclaredPathsWithExactObjectResolver({
      repositoryPrefix,
      request,
      actionsEvidence,
      state,
      // A direct root-tree response establishes the REST control-plane object
      // but cannot describe nested paths. The exact Git resolver supplies the
      // path, mode, object-id, size, and byte proof in one bounded batch.
      expectedEntries: null,
    });
    return;
  }

  if (entries !== null) {
    await validateIndexedDeclaredPaths(entries, repositoryPrefix, request, actionsEvidence, state);
    return;
  }

  if (state.exactObjectResolver !== null) {
    await validateDeclaredPathsWithExactObjectResolver({
      repositoryPrefix,
      request,
      actionsEvidence,
      state,
      expectedEntries: null,
    });
    return;
  }

  // Never infer absence or presence from GitHub's partial recursive response.
  // Re-open the exact root object non-recursively and traverse only declared
  // paths by content-addressed tree SHA. Declared blobs are read only as
  // bounded inert bytes to reject symlinks, gitlinks and Git LFS pointers.
  await validateDeclaredPathsByTreeWalk(repositoryPrefix, request, actionsEvidence, state);
}

function indexTreeResponse(tree, expectedTreeObjectId, mode, options = {}) {
  const observedTree = normalizeGitObjectId(tree.sha, "tree", "GITHUB_PROTOCOL_ERROR");
  if (observedTree !== expectedTreeObjectId) {
    throw new GitHubPublicSourceError("GITHUB_TREE_MISMATCH", "GitHub tree response did not match the expected tree");
  }
  if (tree.truncated !== false && tree.truncated !== true) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub tree truncation state was invalid");
  }
  if (!Array.isArray(tree.tree)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub tree entries must be an array");
  }
  if (tree.truncated) {
    if (options.allowTruncated === true) return null;
    throw new GitHubPublicSourceError("GITHUB_TREE_TRUNCATED", "GitHub tree response was truncated");
  }

  const entries = new Map();
  for (const entry of tree.tree) {
    assertPlainObject(entry, "GITHUB_PROTOCOL_ERROR", "GitHub tree entry must be an object");
    let path;
    try {
      path = normalizeRepositoryPath(entry.path);
    } catch (error) {
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub tree contained an invalid path", {
        cause: error,
      });
    }
    if (mode === "direct" && path.includes("/")) {
      throw new GitHubPublicSourceError(
        "GITHUB_PROTOCOL_ERROR",
        "GitHub non-recursive tree contained a nested path",
      );
    }
    if (entries.has(path)) {
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub tree contained a duplicate path");
    }
    if (entry.type !== "blob" && entry.type !== "tree" && entry.type !== "commit") {
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub tree contained an invalid entry type");
    }
    const sha = normalizeGitObjectId(entry.sha, "tree entry", "GITHUB_PROTOCOL_ERROR");
    const entryMode = normalizeTreeEntryMode(entry.mode, entry.type);
    const size = entry.type === "blob" ? normalizeTreeBlobSize(entry.size) : null;
    entries.set(path, { type: entry.type, sha, mode: entryMode, size });
  }
  return entries;
}

async function validateIndexedDeclaredPaths(entries, repositoryPrefix, request, actionsEvidence, state) {
  const requirements = declaredPathRequirements(request, actionsEvidence);
  let aggregateBytes = 0;
  for (const requirement of requirements) {
    const entry = entries.get(requirement.path);
    if (!isRegularBlob(entry)) throwMissingDeclaredPath(requirement.kind);
    aggregateBytes = addDeclaredBytesToAggregate(aggregateBytes, entry.size);
  }
  if (state.exactObjectResolver !== null) {
    await validateDeclaredPathsWithExactObjectResolver({
      repositoryPrefix,
      request,
      actionsEvidence,
      state,
      expectedEntries: entries,
    });
    return;
  }
  const blobCache = new Map();
  for (const requirement of requirements) {
    await validateDeclaredBlob(
      repositoryPrefix,
      requirement.path,
      entries.get(requirement.path),
      state,
      blobCache,
      requirement.kind,
    );
  }
}

function declaredPathRequirements(request, actionsEvidence) {
  const requirementsByPath = new Map();
  for (const path of [...request.sourcePaths, ...request.contractPaths]) {
    requirementsByPath.set(path, { path, kind: "declared" });
  }
  for (const evidence of actionsEvidence) {
    if (!requirementsByPath.has(evidence.workflowPath)) {
      requirementsByPath.set(evidence.workflowPath, { path: evidence.workflowPath, kind: "workflow" });
    }
  }
  return [...requirementsByPath.values()].sort(
    (left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.kind, right.kind),
  );
}

async function validateDeclaredPathsWithExactObjectResolver({
  repositoryPrefix,
  request,
  actionsEvidence,
  state,
  expectedEntries,
}) {
  const requirements = declaredPathRequirements(request, actionsEvidence);
  const unresolved = [];
  let aggregateBytes = 0;

  if (expectedEntries !== null) {
    for (const requirement of requirements) {
      const entry = expectedEntries.get(requirement.path);
      if (!isRegularBlob(entry)) throwMissingDeclaredPath(requirement.kind);
      const localBytes = state.localBlobBytes.get(`${repositoryPrefix}\0${requirement.path}`);
      if (localBytes === undefined) {
        unresolved.push(requirement);
        continue;
      }
      aggregateBytes = addDeclaredBytesToAggregate(aggregateBytes, localBytes.length);
      validateDeclaredBlobBytes(entry, localBytes, requirement.kind);
    }
  } else {
    unresolved.push(...requirements);
  }

  if (unresolved.length === 0) return;
  const remainingMs = Math.floor(state.deadline - performance.now());
  if (remainingMs <= 0) {
    throw new GitHubPublicSourceError("GITHUB_TIMEOUT", "GitHub exact-object resolution timed out", {
      retryable: true,
    });
  }

  let resolved;
  try {
    resolved = await state.exactObjectResolver(Object.freeze({
      repositoryUri: request.repositoryUri,
      revisionObjectId: request.revisionObjectId,
      treeObjectId: request.treeObjectId,
      paths: Object.freeze(unresolved.map(({ path }) => path)),
      timeoutMs: remainingMs,
      maximumFileBytes: maximumDeclaredBlobBytes,
      maximumTotalBytes: maximumDeclaredAggregateBytes - aggregateBytes,
    }));
  } catch (error) {
    if (error instanceof GitHubPublicSourceError) throw error;
    throw new GitHubPublicSourceError(
      "GITHUB_PROTOCOL_ERROR",
      "The trusted exact Git object resolver failed unexpectedly",
      { cause: error },
    );
  }

  const records = resolved instanceof Map ? resolved : resolved?.records;
  if (!(records instanceof Map) || records.size !== unresolved.length) {
    throw new GitHubPublicSourceError(
      "GITHUB_PROTOCOL_ERROR",
      "The trusted exact Git object resolver returned an invalid path set",
    );
  }
  const unresolvedPaths = new Set(unresolved.map(({ path }) => path));
  for (const path of records.keys()) {
    if (!unresolvedPaths.has(path)) {
      throw new GitHubPublicSourceError(
        "GITHUB_PROTOCOL_ERROR",
        "The trusted exact Git object resolver returned an undeclared path",
      );
    }
  }

  for (const requirement of unresolved) {
    const record = records.get(requirement.path);
    if (!isPlainExactObjectRecord(record)) throwMissingDeclaredPath(requirement.kind);
    const bytes = Buffer.from(record.bytes);
    aggregateBytes = addDeclaredBytesToAggregate(aggregateBytes, bytes.length);
    const resolvedEntry = {
      type: "blob",
      mode: record.mode,
      sha: record.objectId,
      size: bytes.length,
    };
    if (!isRegularBlob(resolvedEntry)) throwMissingDeclaredPath(requirement.kind);
    const expected = expectedEntries?.get(requirement.path) ?? null;
    if (
      expected !== null
      && (
        expected.type !== resolvedEntry.type
        || expected.mode !== resolvedEntry.mode
        || expected.sha !== resolvedEntry.sha
        || expected.size !== resolvedEntry.size
      )
    ) {
      throw new GitHubPublicSourceError(
        "GITHUB_PROTOCOL_ERROR",
        "The exact Git object did not match GitHub tree metadata",
      );
    }
    validateDeclaredBlobBytes(resolvedEntry, bytes, requirement.kind);
  }
}

function isPlainExactObjectRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === 3
    && keys[0] === "bytes"
    && keys[1] === "mode"
    && keys[2] === "objectId"
    && (value.mode === "100644" || value.mode === "100755")
    && lowerHex40.test(value.objectId)
    && value.bytes instanceof Uint8Array;
}

function addDeclaredBytesToAggregate(current, additional) {
  if (!Number.isSafeInteger(additional) || additional < 0 || additional > maximumDeclaredBlobBytes) {
    throw new GitHubPublicSourceError(
      "GITHUB_RESPONSE_TOO_LARGE",
      "A declared source blob exceeds the canonical review limit",
    );
  }
  const next = current + additional;
  if (next > maximumDeclaredAggregateBytes) {
    throw new GitHubPublicSourceError(
      "GITHUB_RESPONSE_TOO_LARGE",
      "Declared source blobs exceed the canonical aggregate review limit",
    );
  }
  return next;
}

async function validateDeclaredPathsByTreeWalk(repositoryPrefix, request, actionsEvidence, state) {
  const treeCache = new Map();
  const blobCache = new Map();
  const walkBudget = { requestsRemaining: maximumTreeWalkRequestsPerRepository };
  const requirements = declaredPathRequirements(request, actionsEvidence);
  let aggregateBytes = 0;

  const loadTree = async (treeObjectId) => {
    const cached = treeCache.get(treeObjectId);
    if (cached !== undefined) return cached;
    if (walkBudget.requestsRemaining <= 0) {
      throw new GitHubPublicSourceError(
        "GITHUB_TREE_TRUNCATED",
        "GitHub tree could not be resolved within the bounded walk request limit",
      );
    }
    walkBudget.requestsRemaining -= 1;
    const response = await requestGitHubJson(
      `${repositoryPrefix}/git/trees/${treeObjectId}`,
      "tree",
      state,
    );
    const indexed = indexTreeResponse(response, treeObjectId, "direct");
    treeCache.set(treeObjectId, indexed);
    return indexed;
  };

  for (const requirement of requirements) {
    const parts = requirement.path.split("/");
    if (parts.length > maximumTreeWalkDepth) {
      throw new GitHubPublicSourceError(
        "GITHUB_TREE_TRUNCATED",
        "GitHub tree could not be resolved within the bounded walk depth",
      );
    }
    let currentTreeObjectId = request.treeObjectId;
    for (let index = 0; index < parts.length; index += 1) {
      const entries = await loadTree(currentTreeObjectId);
      const entry = entries.get(parts[index]);
      const isLeaf = index === parts.length - 1;
      if (isLeaf) {
        if (!isRegularBlob(entry)) throwMissingDeclaredPath(requirement.kind);
        aggregateBytes = addDeclaredBytesToAggregate(aggregateBytes, entry.size);
        await validateDeclaredBlob(repositoryPrefix, requirement.path, entry, state, blobCache, requirement.kind);
      } else {
        if (entry?.type !== "tree" || entry.mode !== "040000") throwMissingDeclaredPath(requirement.kind);
        currentTreeObjectId = entry.sha;
      }
    }
  }
}

function isRegularBlob(entry) {
  return entry?.type === "blob" && (entry.mode === "100644" || entry.mode === "100755");
}

async function validateDeclaredBlob(repositoryPrefix, filePath, entry, state, cache, kind) {
  const localBytes = state.localBlobBytes.get(`${repositoryPrefix}\0${filePath}`);
  if (localBytes !== undefined) {
    validateDeclaredBlobBytes(entry, localBytes, kind);
    cache.set(entry.sha, entry.size);
    return;
  }
  const cached = cache.get(entry.sha);
  if (cached !== undefined) {
    if (cached !== entry.size) throwMissingDeclaredPath(kind);
    return;
  }
  if (entry.size > maximumDeclaredBlobBytes) {
    throw new GitHubPublicSourceError(
      "GITHUB_RESPONSE_TOO_LARGE",
      "A declared source blob exceeds the bounded inert-content limit"
    );
  }
  const response = await requestGitHubJson(`${repositoryPrefix}/git/blobs/${entry.sha}`, "blob", state);
  const observedSha = normalizeGitObjectId(response.sha, "blob", "GITHUB_PROTOCOL_ERROR");
  const observedSize = normalizeTreeBlobSize(response.size);
  if (observedSha !== entry.sha || observedSize !== entry.size || response.encoding !== "base64") {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub declared blob metadata did not match the tree");
  }
  if (typeof response.content !== "string" || /[^A-Za-z0-9+/=\n]/u.test(response.content)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub declared blob content encoding was invalid");
  }
  const compactBase64 = response.content.replaceAll("\n", "");
  if (compactBase64.length % 4 !== 0) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub declared blob content encoding was invalid");
  }
  const bytes = Buffer.from(compactBase64, "base64");
  if (bytes.toString("base64") !== compactBase64 || bytes.length !== entry.size) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub declared blob bytes did not match metadata");
  }
  validateDeclaredBlobBytes(entry, bytes, kind);
  cache.set(entry.sha, entry.size);
}

function validateDeclaredBlobBytes(entry, bytes, kind) {
  if (bytes.length > maximumDeclaredBlobBytes) {
    throw new GitHubPublicSourceError(
      "GITHUB_RESPONSE_TOO_LARGE",
      "A declared source blob exceeds the canonical review limit",
    );
  }
  if (bytes.length !== entry.size) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub declared blob bytes did not match metadata");
  }
  const gitObjectSha = createHash("sha1")
    .update(`blob ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
  if (gitObjectSha !== entry.sha) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub declared blob bytes did not match its object id");
  }
  if (isGitLfsPointer(bytes)) {
    throwMissingDeclaredPath(kind, "A declared source path is a Git LFS pointer, not source bytes");
  }
}

function throwMissingDeclaredPath(kind, detail = null) {
  if (kind === "workflow") {
    throw new GitHubPublicSourceError(
      "GITHUB_ACTIONS_WORKFLOW_NOT_IN_TREE",
      detail ?? "GitHub Actions workflow was not found as a regular blob in the exact tree",
    );
  }
  throw new GitHubPublicSourceError(
    "GITHUB_DECLARED_PATH_NOT_FOUND",
    detail ?? "A declared source path was not found as a regular blob in the exact tree"
  );
}
