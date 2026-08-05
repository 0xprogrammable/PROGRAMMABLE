import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { TextDecoder, TextEncoder } from "node:util";
import {
  isCanonicalReviewTargetPath,
  isGitLfsPointer,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";

export const GITHUB_PUBLIC_SOURCE_CONTRACT_V1 = Object.freeze({
  name: "GitHubPublicSourceContractV1",
  schemaVersion: "1.0.0",
  kind: "github-public-source",
  canonicalProviderOrigin: "https://github.com",
  apiOrigin: "https://api.github.com",
  githubApiVersion: "2026-03-10",
  userAgent: "programmable-github-public-source-v1",
  limits: Object.freeze({
    companions: 15,
    pathsPerKind: REVIEW_TARGET_CONTRACT_V1.maximumFiles,
    pathsTotal: REVIEW_TARGET_CONTRACT_V1.maximumFiles,
    actionsRunsPerRepository: 16,
    pathBytes: REVIEW_TARGET_CONTRACT_V1.maximumPathBytes,
    opaqueIdDigits: 64,
    defaultTimeoutMs: 10_000,
    minimumTimeoutMs: 10,
    maximumTimeoutMs: 30_000,
    anonymousRestRequests: 48,
    reviewFileBytes: REVIEW_TARGET_CONTRACT_V1.maximumFileBytes,
    reviewTotalBytes: REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes,
    defaultTotalResponseBytes: 16_777_216,
    minimumTotalResponseBytes: 1_024,
    maximumTotalResponseBytes: 67_108_864,
  }),
});

export const GITHUB_PUBLIC_SOURCE_ERROR_CODES_V1 = Object.freeze([
  "GITHUB_ACTIONS_RUN_MISMATCH",
  "GITHUB_ACTIONS_RUN_NOT_REACHABLE",
  "GITHUB_ACTIONS_WORKFLOW_NOT_IN_TREE",
  "GITHUB_COMMIT_MISMATCH",
  "GITHUB_COMMIT_NOT_REACHABLE",
  "GITHUB_DECLARED_PATH_NOT_FOUND",
  "GITHUB_NETWORK_ERROR",
  "GITHUB_PROTOCOL_ERROR",
  "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE",
  "GITHUB_RATE_LIMITED",
  "GITHUB_REDIRECT_REJECTED",
  "GITHUB_REPOSITORY_ID_MISMATCH",
  "GITHUB_REPOSITORY_LOCATOR_MISMATCH",
  "GITHUB_RESPONSE_TOO_LARGE",
  "GITHUB_TIMEOUT",
  "GITHUB_TREE_MISMATCH",
  "GITHUB_TREE_NOT_REACHABLE",
  "GITHUB_TREE_TRUNCATED",
  "GITHUB_UNAVAILABLE",
  "GITHUB_UPSTREAM_REJECTED",
  "INVALID_OPTIONS",
  "INVALID_REQUEST",
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const lowerHex40 = /^[0-9a-f]{40}$/;
const opaqueDecimal = /^[1-9][0-9]{0,63}$/;
const ownerPattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const repositoryPattern = /^[a-z0-9._-]{1,100}$/;
const safeCodePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const allowedRequestKeys = new Set(["schemaVersion", "primary", "companions"]);
const allowedRepositoryKeys = new Set([
  "repositoryUri",
  "numericRepositoryId",
  "revisionObjectId",
  "treeObjectId",
  "sourcePaths",
  "contractPaths",
  "githubActionsRunIds",
]);
const allowedOptionKeys = new Set([
  "transport",
  "timeoutMs",
  "maxResponseBytes",
  "localBlobBytes",
  "exactObjectResolver",
]);
const errorCodeSet = new Set(GITHUB_PUBLIC_SOURCE_ERROR_CODES_V1);
const maximumJsonDepth = 128;
const maximumJsonNodes = 2_000_000;
const maximumJsonNumberCharacters = 128;
// Sixteen repositories need the full 48-request anonymous budget even without
// Actions evidence. Three-wide deterministic batches keep the deadline bounded
// without creating an unbounded request fan-out.
const maximumConcurrentRepositories = 3;
// A GitHub recursive tree response is bounded at roughly 7 MB. Two tree slots
// preserve the resolver's aggregate byte limit while other repositories wait.
const maximumConcurrentTreeRequests = 2;
const maximumTreeResponseBytes = 8_388_608;
const maximumOtherResponseBytes = 1_048_576;
// GitHub's JSON blob envelope base64-expands the canonical two-megabyte
// review-file ceiling. Production uses the batched exact-object resolver, but
// the bounded REST fallback still needs room for one valid canonical blob.
const maximumBlobResponseBytes = 3_000_000;
const maximumDeclaredBlobBytes = REVIEW_TARGET_CONTRACT_V1.maximumFileBytes;
const maximumDeclaredAggregateBytes = REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes;
const maximumGitHubRequests = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.anonymousRestRequests;
// The fallback follows only declared paths. These independent caps prevent a
// malicious or unusually broad tree from turning path validation into a crawl.
const maximumTreeWalkRequestsPerRepository =
  REVIEW_TARGET_CONTRACT_V1.maximumFiles * REVIEW_TARGET_CONTRACT_V1.maximumPathDepth;
const maximumTreeWalkDepth = REVIEW_TARGET_CONTRACT_V1.maximumPathDepth;

class LosslessJsonNumber {
  constructor(source) {
    this.source = source;
    Object.freeze(this);
  }
}

export class GitHubPublicSourceError extends Error {
  constructor(code, message, options = {}) {
    if (!errorCodeSet.has(code)) {
      throw new TypeError("unsupported GitHub public source error code");
    }
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GitHubPublicSourceError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.status = options.status ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }

  toJSON() {
    return {
      schemaVersion: "1.0.0",
      error: this.code,
      message: this.message,
      retryable: this.retryable,
      status: this.status,
      retryAfterSeconds: this.retryAfterSeconds,
    };
  }
}

export function validateGitHubPublicSourceRequestV1(input) {
  assertPlainObject(input, "INVALID_REQUEST", "request must be an object");
  assertExactKeys(input, allowedRequestKeys, "INVALID_REQUEST");
  if (input.schemaVersion !== GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion) {
    invalidRequest("request schemaVersion is unsupported");
  }

  const primary = normalizeRepositoryRequest(input.primary);
  if (!Array.isArray(input.companions)) {
    invalidRequest("companions must be an array");
  }
  if (input.companions.length > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.companions) {
    invalidRequest("too many companion repositories");
  }

  const companions = input.companions.map(normalizeRepositoryRequest);
  companions.sort(compareRepositoryRequests);

  const repositoryIds = new Set([primary.numericRepositoryId]);
  const repositoryUris = new Set([primary.repositoryUri]);
  for (const companion of companions) {
    if (repositoryIds.has(companion.numericRepositoryId)) {
      invalidRequest("repository identities must be unique");
    }
    if (repositoryUris.has(companion.repositoryUri)) {
      invalidRequest("repository locators must be unique");
    }
    repositoryIds.add(companion.numericRepositoryId);
    repositoryUris.add(companion.repositoryUri);
  }

  const repositories = [primary, ...companions];
  const minimumApiRequests = (repositories.length * 3)
    + repositories.reduce((total, repository) => total + repository.githubActionsRunIds.length, 0);
  if (minimumApiRequests > maximumGitHubRequests) {
    invalidRequest("repository and GitHub Actions breadth exceeds the anonymous request budget");
  }

  return deepFreeze({
    schemaVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion,
    primary,
    companions,
  });
}

export function isCanonicalGitHubRepositoryPathV1(value) {
  return isCanonicalReviewTargetPath(value);
}

export async function resolveGitHubPublicSourceV1(input, options = {}) {
  const request = validateGitHubPublicSourceRequestV1(input);
  const resolverOptions = normalizeOptions(options, request);
  const state = {
    deadline: performance.now() + resolverOptions.timeoutMs,
    requestsRemaining: maximumGitHubRequests,
    responseBytesRemaining: resolverOptions.maxResponseBytes,
    treeRequestSemaphore: createBoundedSemaphore(maximumConcurrentTreeRequests),
    transport: resolverOptions.transport,
    localBlobBytes: resolverOptions.localBlobBytes,
    exactObjectResolver: resolverOptions.exactObjectResolver,
  };

  const repositories = [
    { request: request.primary, role: "primary" },
    ...request.companions.map((companion) => ({ request: companion, role: "companion" })),
  ];
  const resolvedRepositories = await resolveRepositoryBatches(repositories, state);
  const [primary, ...companions] = resolvedRepositories;

  return deepFreeze({
    schemaVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion,
    kind: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.kind,
    canonicalProviderOrigin: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.canonicalProviderOrigin,
    githubApiVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion,
    primary,
    companions,
  });
}

async function resolveRepositoryBatches(repositories, state) {
  const resolved = new Array(repositories.length);
  for (let offset = 0; offset < repositories.length; offset += maximumConcurrentRepositories) {
    const batch = repositories.slice(offset, offset + maximumConcurrentRepositories);
    const settled = await Promise.allSettled(
      batch.map(({ request, role }) => resolveRepository(request, role, state)),
    );
    // Inspect in canonical request order so simultaneous failures do not make
    // the resolver's observable result depend on network completion order.
    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index];
      if (outcome.status === "rejected") throw outcome.reason;
      resolved[offset + index] = outcome.value;
    }
  }
  return resolved;
}

export function serializeGitHubPublicSourceV1(value) {
  return stableStringify(value);
}

export function createGitHubPublicFetchTransportV1(fetchImplementation = globalThis.fetch, options = {}) {
  if (typeof fetchImplementation !== "function") {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "fetch implementation must be a function");
  }
  if (
    options === null
    || typeof options !== "object"
    || Array.isArray(options)
    || Object.keys(options).some((key) => key !== "allowPublicUserLookups")
    || (options.allowPublicUserLookups !== undefined && typeof options.allowPublicUserLookups !== "boolean")
  ) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "public GitHub transport options are invalid");
  }
  const allowPublicUserLookups = options.allowPublicUserLookups === true;

  return async function githubPublicFetchTransport(request) {
    assertPublicFetchRequest(request, allowPublicUserLookups);
    const response = await fetchImplementation(request.url, {
      method: "GET",
      headers: request.headers,
      redirect: "error",
      signal: request.signal,
    });

    if (response.redirected) {
      throw new GitHubPublicSourceError("GITHUB_REDIRECT_REJECTED", "GitHub redirect was rejected");
    }

    const contentLength = normalizeContentLength(response.headers?.get?.("content-length"));
    if (contentLength !== null && contentLength > request.maxResponseBytes) {
      throw new GitHubPublicSourceError("GITHUB_RESPONSE_TOO_LARGE", "GitHub response exceeded the byte limit");
    }

    const body = await readBoundedResponseBody(response, request.maxResponseBytes);
    return {
      status: response.status,
      headers: {
        "content-type": response.headers?.get?.("content-type") ?? null,
        "retry-after": response.headers?.get?.("retry-after") ?? null,
        "x-ratelimit-remaining": response.headers?.get?.("x-ratelimit-remaining") ?? null,
      },
      body,
      redirected: response.redirected,
      responseUrl: response.url,
    };
  };
}

async function resolveRepository(repositoryRequest, role, state) {
  const { owner, repository } = parseCanonicalRepositoryUri(repositoryRequest.repositoryUri);
  const repositoryPrefix = `/repos/${owner}/${repository}`;
  const metadata = await requestGitHubJson(`${repositoryPrefix}`, "repository", state);
  validateRepositoryMetadata(metadata, repositoryRequest, owner, repository);

  const commit = await requestGitHubJson(
    `${repositoryPrefix}/git/commits/${repositoryRequest.revisionObjectId}`,
    "commit",
    state,
  );
  validateCommit(commit, repositoryRequest, owner, repository);

  const githubActionsEvidence = [];
  for (const runId of repositoryRequest.githubActionsRunIds) {
    const run = await requestGitHubJson(`${repositoryPrefix}/actions/runs/${runId}`, "actions-run", state);
    githubActionsEvidence.push(validateActionsRun(run, repositoryRequest, owner, repository, runId));
  }

  const declaredPaths = [
    ...repositoryRequest.sourcePaths,
    ...repositoryRequest.contractPaths,
    ...githubActionsEvidence.map((entry) => entry.workflowPath),
  ];
  // When remote bytes are required, the exact-object resolver already proves
  // every declared path against the REST-verified commit and root tree. A
  // recursive REST tree would repeat that walk. Complete local bytes instead
  // need REST metadata for their path, mode, object-id, and size comparison.
  const hasCompleteLocalBytes = declaredPaths.length > 0 && declaredPaths.every(
    (filePath) => state.localBlobBytes.has(`${repositoryPrefix}\0${filePath}`),
  );
  const recursive = declaredPaths.length > 0
    && (state.exactObjectResolver === null || hasCompleteLocalBytes);
  const tree = await requestGitHubJson(
    `${repositoryPrefix}/git/trees/${repositoryRequest.treeObjectId}${recursive ? "?recursive=1" : ""}`,
    "tree",
    state,
  );
  await validateTree(tree, repositoryPrefix, repositoryRequest, githubActionsEvidence, state, { recursive });

  const defaultBranch = normalizeDisplayText(metadata.default_branch, 255, "repository default branch");
  return deepFreeze({
    role,
    authority: {
      numericRepositoryId: repositoryRequest.numericRepositoryId,
      revisionObjectId: repositoryRequest.revisionObjectId,
      treeObjectId: repositoryRequest.treeObjectId,
    },
    display: {
      repositoryUri: repositoryRequest.repositoryUri,
      owner,
      repository,
      defaultBranch,
    },
    visibility: "public",
    sourcePaths: repositoryRequest.sourcePaths,
    contractPaths: repositoryRequest.contractPaths,
    githubActionsEvidence,
  });
}

function normalizeRepositoryRequest(input) {
  assertPlainObject(input, "INVALID_REQUEST", "repository request must be an object");
  assertExactKeys(input, allowedRepositoryKeys, "INVALID_REQUEST");
  const parsedUri = parseCanonicalRepositoryUri(input.repositoryUri);
  const numericRepositoryId = normalizeOpaqueId(input.numericRepositoryId, "repository id", "INVALID_REQUEST");
  const revisionObjectId = normalizeGitObjectId(input.revisionObjectId, "revision", "INVALID_REQUEST");
  const treeObjectId = normalizeGitObjectId(input.treeObjectId, "tree", "INVALID_REQUEST");

  const sourcePaths = normalizeUniqueArray(
    input.sourcePaths ?? [],
    GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.pathsPerKind,
    normalizeRepositoryPath,
    "source paths",
  );
  const contractPaths = normalizeUniqueArray(
    input.contractPaths ?? [],
    GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.pathsPerKind,
    normalizeRepositoryPath,
    "contract paths",
  );
  const githubActionsRunIds = normalizeUniqueArray(
    input.githubActionsRunIds ?? [],
    GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.actionsRunsPerRepository,
    (value) => normalizeOpaqueId(value, "GitHub Actions run id", "INVALID_REQUEST"),
    "GitHub Actions run ids",
  );

  const allDeclaredPaths = [...sourcePaths, ...contractPaths].sort(compareUtf8);
  if (allDeclaredPaths.length > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.pathsTotal) {
    invalidRequest("declared paths exceed the total contract limit");
  }
  assertNoDuplicateSortedValues(allDeclaredPaths, "declared paths");

  return deepFreeze({
    repositoryUri: `https://github.com/${parsedUri.owner}/${parsedUri.repository}`,
    numericRepositoryId,
    revisionObjectId,
    treeObjectId,
    sourcePaths,
    contractPaths,
    githubActionsRunIds,
  });
}

function normalizeOptions(options, request) {
  assertPlainObject(options, "INVALID_OPTIONS", "resolver options must be an object");
  assertExactKeys(options, allowedOptionKeys, "INVALID_OPTIONS");
  const timeoutMs = options.timeoutMs ?? GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs ||
    timeoutMs > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs
  ) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "timeoutMs is outside the contract bounds");
  }

  const maxResponseBytes =
    options.maxResponseBytes ?? GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTotalResponseBytes;
  if (
    !Number.isSafeInteger(maxResponseBytes) ||
    maxResponseBytes < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTotalResponseBytes ||
    maxResponseBytes > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTotalResponseBytes
  ) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "maxResponseBytes is outside the contract bounds");
  }

  const transport = options.transport ?? createGitHubPublicFetchTransportV1();
  if (typeof transport !== "function") {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "transport must be a function");
  }
  const exactObjectResolver = options.exactObjectResolver ?? null;
  if (exactObjectResolver !== null && typeof exactObjectResolver !== "function") {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "exactObjectResolver must be a function");
  }
  const localBlobBytes = normalizeLocalBlobBytes(options.localBlobBytes, request);
  return { timeoutMs, maxResponseBytes, transport, localBlobBytes, exactObjectResolver };
}

function normalizeLocalBlobBytes(input, request) {
  if (input === undefined) return new Map();
  if (!(input instanceof Map)) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes must be a repository Map");
  }

  const repositories = new Map(
    [request.primary, ...request.companions].map((repository) => [repository.repositoryUri, repository])
  );
  const normalized = new Map();
  let aggregateBytes = 0;
  for (const [repositoryUri, files] of input) {
    const repository = repositories.get(repositoryUri);
    if (repository === undefined || !(files instanceof Map)) {
      throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes referenced an undeclared repository");
    }
    const declaredPaths = new Set([...repository.sourcePaths, ...repository.contractPaths]);
    for (const [filePath, value] of files) {
      if (!declaredPaths.has(filePath) || !(value instanceof Uint8Array)) {
        throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes referenced an undeclared path");
      }
      const bytes = Buffer.from(value);
      if (bytes.length > maximumDeclaredBlobBytes) {
        throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes exceeded the per-file limit");
      }
      aggregateBytes += bytes.length;
      if (aggregateBytes > maximumDeclaredAggregateBytes) {
        throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes exceeded the aggregate limit");
      }
      const parsed = parseCanonicalRepositoryUri(repositoryUri);
      normalized.set(`/repos/${parsed.owner}/${parsed.repository}\0${filePath}`, bytes);
    }
  }
  return normalized;
}

async function requestGitHubJson(pathAndQuery, resourceKind, state) {
  const url = `${GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin}${pathAndQuery}`;
  assertCanonicalApiUrl(url);
  if (state.requestsRemaining <= 0) {
    throw new GitHubPublicSourceError(
      "GITHUB_UPSTREAM_REJECTED",
      "GitHub public source request budget was exhausted; reduce companion or declared-path breadth"
    );
  }
  state.requestsRemaining -= 1;
  const releaseTreeSlot = resourceKind === "tree" ? await state.treeRequestSemaphore.acquire() : null;
  let reservedResponseBytes = 0;
  try {
    const remainingMs = state.deadline - performance.now();
    if (remainingMs <= 0) {
      throw new GitHubPublicSourceError("GITHUB_TIMEOUT", "GitHub resolution timed out", { retryable: true });
    }
    reservedResponseBytes = reserveResponseBytes(resourceKind, state);

    const controller = new AbortController();
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new GitHubPublicSourceError("GITHUB_TIMEOUT", "GitHub resolution timed out", { retryable: true }));
      }, remainingMs);
    });

    let response;
    try {
      response = await Promise.race([
        Promise.resolve(
          state.transport({
            method: "GET",
            url,
            headers: Object.freeze({
              Accept: "application/vnd.github+json",
              "User-Agent": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.userAgent,
              "X-GitHub-Api-Version": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion,
            }),
            redirect: "error",
            signal: controller.signal,
            maxResponseBytes: reservedResponseBytes,
          }),
        ),
        timeoutPromise,
      ]);
    } catch (error) {
      if (error instanceof GitHubPublicSourceError) throw error;
      throw new GitHubPublicSourceError("GITHUB_NETWORK_ERROR", "GitHub request failed", {
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }

    const normalized = normalizeTransportResponse(response, url);
    if (normalized.body.byteLength > reservedResponseBytes) {
      reservedResponseBytes = 0;
      throw new GitHubPublicSourceError(
        "GITHUB_RESPONSE_TOO_LARGE",
        "GitHub responses exceeded the total byte limit",
      );
    }
    state.responseBytesRemaining += reservedResponseBytes - normalized.body.byteLength;
    reservedResponseBytes = 0;

    const status = normalized.status;
    const retryAfterSeconds = normalizeRetryAfter(normalized.headers["retry-after"]);
    if (status >= 300 && status < 400) {
      throw new GitHubPublicSourceError("GITHUB_REDIRECT_REJECTED", "GitHub redirect was rejected", { status });
    }
    if (status === 429 || status === 403) {
      throw new GitHubPublicSourceError("GITHUB_RATE_LIMITED", "GitHub public API rate limit was reached", {
        retryable: true,
        status,
        retryAfterSeconds,
      });
    }
    if (status === 404) {
      const codeByResource = {
        repository: "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE",
        commit: "GITHUB_COMMIT_NOT_REACHABLE",
        tree: "GITHUB_TREE_NOT_REACHABLE",
        blob: "GITHUB_DECLARED_PATH_NOT_FOUND",
        "actions-run": "GITHUB_ACTIONS_RUN_NOT_REACHABLE",
      };
      throw new GitHubPublicSourceError(codeByResource[resourceKind], githubUnavailableMessage(resourceKind), {
        status,
      });
    }
    if (status >= 500) {
      throw new GitHubPublicSourceError("GITHUB_UNAVAILABLE", "GitHub public API is unavailable", {
        retryable: true,
        status,
        retryAfterSeconds,
      });
    }
    if (status < 200 || status >= 300) {
      throw new GitHubPublicSourceError("GITHUB_UPSTREAM_REJECTED", "GitHub public API rejected the request", {
        status,
      });
    }

    try {
      const text = decoder.decode(normalized.body);
      const parsed = parseBoundedLosslessJson(text);
      assertPlainObject(parsed, "GITHUB_PROTOCOL_ERROR", "GitHub response must be a JSON object");
      return parsed;
    } catch (error) {
      if (error instanceof GitHubPublicSourceError) throw error;
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub returned invalid JSON", { cause: error });
    }
  } finally {
    if (reservedResponseBytes > 0) state.responseBytesRemaining += reservedResponseBytes;
    releaseTreeSlot?.();
  }
}

function reserveResponseBytes(resourceKind, state) {
  if (state.responseBytesRemaining <= 0) {
    throw new GitHubPublicSourceError("GITHUB_RESPONSE_TOO_LARGE", "GitHub responses exceeded the total byte limit");
  }
  const perResponseLimit = resourceKind === "tree"
    ? maximumTreeResponseBytes
    : resourceKind === "blob"
      ? maximumBlobResponseBytes
      : maximumOtherResponseBytes;
  const reserved = Math.min(perResponseLimit, state.responseBytesRemaining);
  state.responseBytesRemaining -= reserved;
  return reserved;
}

function createBoundedSemaphore(limit) {
  let active = 0;
  const waiters = [];

  return Object.freeze({
    acquire() {
      return new Promise((resolve) => {
        const grant = () => {
          active += 1;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active -= 1;
            waiters.shift()?.();
          });
        };
        if (active < limit) grant();
        else waiters.push(grant);
      });
    },
  });
}

function validateRepositoryMetadata(metadata, request, owner, repository) {
  const observedId = normalizeOpaqueId(metadata.id, "repository id", "GITHUB_PROTOCOL_ERROR", true);
  if (observedId !== request.numericRepositoryId) {
    throw new GitHubPublicSourceError("GITHUB_REPOSITORY_ID_MISMATCH", "GitHub repository identity did not match");
  }
  if (metadata.private !== false || metadata.visibility !== "public") {
    throw new GitHubPublicSourceError(
      "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE",
      "GitHub public repository is unavailable",
      { status: 404 },
    );
  }
  if (typeof metadata.full_name !== "string" || metadata.full_name.toLowerCase() !== `${owner}/${repository}`) {
    throw new GitHubPublicSourceError("GITHUB_REPOSITORY_LOCATOR_MISMATCH", "GitHub repository locator did not match");
  }
  validateRepositoryHtmlUrl(metadata.html_url, owner, repository);
  normalizeDisplayText(metadata.default_branch, 255, "repository default branch");
}

function validateCommit(commit, request, owner, repository) {
  const observedCommit = normalizeGitObjectId(commit.sha, "commit", "GITHUB_PROTOCOL_ERROR");
  if (observedCommit !== request.revisionObjectId) {
    throw new GitHubPublicSourceError("GITHUB_COMMIT_MISMATCH", "GitHub commit did not match the requested revision");
  }
  assertPlainObject(commit.tree, "GITHUB_PROTOCOL_ERROR", "GitHub commit tree must be an object");
  const observedTree = normalizeGitObjectId(commit.tree.sha, "commit tree", "GITHUB_PROTOCOL_ERROR");
  if (observedTree !== request.treeObjectId) {
    throw new GitHubPublicSourceError("GITHUB_TREE_MISMATCH", "GitHub commit tree did not match the expected tree");
  }
  if (commit.html_url !== undefined) {
    validateCommitHtmlUrl(commit.html_url, owner, repository, request.revisionObjectId);
  }
}

async function validateTree(tree, repositoryPrefix, request, actionsEvidence, state, { recursive }) {
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

function validateActionsRun(run, request, owner, repository, expectedRunId) {
  const runId = normalizeOpaqueId(run.id, "GitHub Actions run id", "GITHUB_PROTOCOL_ERROR", true);
  if (runId !== expectedRunId) {
    throw new GitHubPublicSourceError("GITHUB_ACTIONS_RUN_MISMATCH", "GitHub Actions run id did not match");
  }
  assertPlainObject(run.repository, "GITHUB_PROTOCOL_ERROR", "GitHub Actions repository must be an object");
  const repositoryId = normalizeOpaqueId(run.repository.id, "repository id", "GITHUB_PROTOCOL_ERROR", true);
  if (repositoryId !== request.numericRepositoryId) {
    throw new GitHubPublicSourceError("GITHUB_ACTIONS_RUN_MISMATCH", "GitHub Actions repository did not match");
  }
  const headRevision = normalizeGitObjectId(run.head_sha, "GitHub Actions head commit", "GITHUB_PROTOCOL_ERROR");
  if (headRevision !== request.revisionObjectId) {
    throw new GitHubPublicSourceError("GITHUB_ACTIONS_RUN_MISMATCH", "GitHub Actions head commit did not match");
  }
  assertPlainObject(run.head_commit, "GITHUB_PROTOCOL_ERROR", "GitHub Actions head commit must be an object");
  const headCommitId = normalizeGitObjectId(run.head_commit.id, "GitHub Actions head commit", "GITHUB_PROTOCOL_ERROR");
  const headTree = normalizeGitObjectId(run.head_commit.tree_id, "GitHub Actions head tree", "GITHUB_PROTOCOL_ERROR");
  if (headCommitId !== request.revisionObjectId || headTree !== request.treeObjectId) {
    throw new GitHubPublicSourceError("GITHUB_ACTIONS_RUN_MISMATCH", "GitHub Actions source identity did not match");
  }

  const workflowPath = normalizeWorkflowPath(run.path);
  const workflowId = normalizeOpaqueId(
    run.workflow_id,
    "GitHub Actions workflow id",
    "GITHUB_PROTOCOL_ERROR",
    true,
  );
  const runAttempt = normalizeOpaqueId(
    run.run_attempt,
    "GitHub Actions run attempt",
    "GITHUB_PROTOCOL_ERROR",
    true,
  );
  const event = normalizeSafeCode(run.event, "GitHub Actions event");
  const status = normalizeSafeCode(run.status, "GitHub Actions status");
  const conclusion = run.conclusion === null ? null : normalizeSafeCode(run.conclusion, "GitHub Actions conclusion");
  validateActionsHtmlUrl(run.html_url, owner, repository, runId);

  return deepFreeze({
    runId,
    runAttempt,
    workflowId,
    workflowPath,
    headRevision,
    headTree,
    event,
    status,
    conclusion,
    htmlUrl: `https://github.com/${owner}/${repository}/actions/runs/${runId}`,
  });
}

function normalizeTransportResponse(response, expectedUrl) {
  assertPlainObject(response, "GITHUB_PROTOCOL_ERROR", "transport response must be an object");
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "transport status was invalid");
  }
  if (response.redirected === true) {
    throw new GitHubPublicSourceError("GITHUB_REDIRECT_REJECTED", "GitHub redirect was rejected", {
      status: response.status,
    });
  }
  if (response.responseUrl !== undefined && response.responseUrl !== "" && response.responseUrl !== expectedUrl) {
    throw new GitHubPublicSourceError("GITHUB_REDIRECT_REJECTED", "GitHub response URL changed");
  }

  let body;
  if (typeof response.body === "string") {
    body = encoder.encode(response.body);
  } else if (response.body instanceof Uint8Array) {
    body = response.body;
  } else if (response.body instanceof ArrayBuffer) {
    body = new Uint8Array(response.body);
  } else {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "transport body must be bytes or text");
  }

  return {
    status: response.status,
    headers: normalizeHeaders(response.headers),
    body,
  };
}

function normalizeHeaders(headers) {
  if (headers === undefined || headers === null) return Object.create(null);
  const output = Object.create(null);
  if (typeof headers.get === "function") {
    for (const name of ["retry-after", "x-ratelimit-remaining", "content-type"]) {
      output[name] = headers.get(name);
    }
    return output;
  }
  assertPlainObject(headers, "GITHUB_PROTOCOL_ERROR", "transport headers must be an object");
  for (const [name, value] of Object.entries(headers)) {
    output[name.toLowerCase()] = normalizeTransportHeaderValue(value);
  }
  return output;
}

async function readBoundedResponseBody(response, maxBytes) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size violation remains authoritative even if a hostile stream rejects cancellation.
        }
        throw new GitHubPublicSourceError("GITHUB_RESPONSE_TOO_LARGE", "GitHub response exceeded the byte limit");
      }
      chunks.push(value);
    }
    const output = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new GitHubPublicSourceError("GITHUB_RESPONSE_TOO_LARGE", "GitHub response exceeded the byte limit");
  }
  return bytes;
}

function parseCanonicalRepositoryUri(value) {
  if (typeof value !== "string") invalidRequest("repositoryUri must be a canonical GitHub URL");
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(value);
  if (!match) invalidRequest("repositoryUri must be a canonical GitHub URL");
  const [, owner, repository] = match;
  if (
    !ownerPattern.test(owner) ||
    owner.includes("--") ||
    !repositoryPattern.test(repository) ||
    !/[a-z0-9]/.test(repository) ||
    repository === "." ||
    repository === ".." ||
    repository.endsWith(".git")
  ) {
    invalidRequest("repositoryUri must use canonical lowercase GitHub owner and repository names");
  }
  const canonical = `https://github.com/${owner}/${repository}`;
  if (value !== canonical) invalidRequest("repositoryUri must be canonical and lowercase");
  return { owner, repository };
}

function assertPublicFetchRequest(request, allowPublicUserLookups) {
  assertPlainObject(request, "INVALID_OPTIONS", "public GitHub transport request must be an object");
  assertCanonicalApiUrl(request.url, allowPublicUserLookups);
  if (request.method !== "GET" || request.redirect !== "error") {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "public GitHub transport is read-only and redirect-free");
  }
  if (!Number.isSafeInteger(request.maxResponseBytes) || request.maxResponseBytes < 1) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "public GitHub transport requires a byte limit");
  }
  assertPlainObject(request.headers, "INVALID_OPTIONS", "public GitHub transport headers must be an object");
  const headerNames = Object.keys(request.headers).sort(compareUtf8);
  const expectedNames = ["Accept", "User-Agent", "X-GitHub-Api-Version"].sort(compareUtf8);
  if (
    headerNames.length !== expectedNames.length ||
    headerNames.some((name, index) => name !== expectedNames[index]) ||
    request.headers.Accept !== "application/vnd.github+json" ||
    request.headers["User-Agent"] !== GITHUB_PUBLIC_SOURCE_CONTRACT_V1.userAgent ||
    request.headers["X-GitHub-Api-Version"] !== GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion
  ) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "public GitHub transport accepts only pinned public headers");
  }
}

function validateRepositoryHtmlUrl(value, expectedOwner, expectedRepository) {
  if (typeof value !== "string") {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub repository URL was invalid");
  }
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub repository URL was invalid", { cause: error });
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname.toLowerCase() !== "github.com" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    parts.length !== 2 ||
    parts[0].toLowerCase() !== expectedOwner ||
    parts[1].toLowerCase() !== expectedRepository
  ) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub repository URL was invalid");
  }
}

function validateCommitHtmlUrl(value, owner, repository, commit) {
  validateStructuredGitHubUrl(value, [owner, repository, "commit", commit], "GitHub commit URL was invalid");
}

function validateActionsHtmlUrl(value, owner, repository, runId) {
  validateStructuredGitHubUrl(
    value,
    [owner, repository, "actions", "runs", runId],
    "GitHub Actions URL was invalid",
  );
}

function validateStructuredGitHubUrl(value, expectedParts, message) {
  if (typeof value !== "string") {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", message);
  }
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", message, { cause: error });
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    parts.length !== expectedParts.length ||
    parts.some((part, index) =>
      index < 2 ? part.toLowerCase() !== expectedParts[index] : part !== expectedParts[index],
    )
  ) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", message);
  }
}

function assertCanonicalApiUrl(value, allowPublicUserLookups) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub API URL was invalid", { cause: error });
  }
  const repositoryPath = url.pathname.startsWith("/repos/");
  const publicUserPath = /^\/users\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(url.pathname);
  if (
    url.origin !== GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (!repositoryPath && !(allowPublicUserLookups && publicUserPath)) ||
    (publicUserPath && url.search !== "") ||
    (repositoryPath && url.search !== "" && url.search !== "?recursive=1")
  ) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub API URL escaped the public source contract");
  }
}

function normalizeWorkflowPath(value) {
  if (typeof value !== "string") {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub Actions workflow path was invalid");
  }
  const separator = value.lastIndexOf("@");
  const candidate = separator === -1 ? value : value.slice(0, separator);
  let path;
  try {
    path = normalizeRepositoryPath(candidate);
  } catch (error) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub Actions workflow path was invalid", {
      cause: error,
    });
  }
  if (!path.startsWith(".github/workflows/") || !/\.ya?ml$/.test(path)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub Actions workflow path was invalid");
  }
  return path;
}

function normalizeRepositoryPath(value) {
  if (!isCanonicalReviewTargetPath(value)) invalidRequest("repository path is not canonical");
  return value;
}

function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function normalizeUniqueArray(value, limit, normalizer, label) {
  if (!Array.isArray(value)) invalidRequest(`${label} must be an array`);
  if (value.length > limit) invalidRequest(`${label} exceed the contract limit`);
  const normalized = value.map(normalizer).sort(compareUtf8);
  assertNoDuplicateSortedValues(normalized, label);
  return deepFreeze(normalized);
}

function assertNoDuplicateSortedValues(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === values[index]) invalidRequest(`${label} must be unique`);
  }
}

function normalizeOpaqueId(value, label, errorCode, requireLosslessJsonNumber = false) {
  let normalized;
  if (requireLosslessJsonNumber && value instanceof LosslessJsonNumber) {
    normalized = value.source;
  } else if (!requireLosslessJsonNumber && typeof value === "string") {
    normalized = value;
  } else {
    throw new GitHubPublicSourceError(errorCode, `${label} must be a canonical opaque decimal string`);
  }
  if (!opaqueDecimal.test(normalized)) {
    throw new GitHubPublicSourceError(errorCode, `${label} must be a canonical opaque decimal string`);
  }
  return normalized;
}

export function parseBoundedLosslessJson(source) {
  if (typeof source !== "string") throw new SyntaxError("JSON source must be text");
  let cursor = 0;
  let nodes = 0;
  const numberPattern = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

  const value = parseValue(0);
  skipWhitespace();
  if (cursor !== source.length) throw new SyntaxError("JSON contains trailing data");
  return value;

  function parseValue(depth) {
    if (depth > maximumJsonDepth) throw new SyntaxError("JSON nesting exceeds the limit");
    consumeNode();
    skipWhitespace();
    const character = source[cursor];
    if (character === "{") return parseObject(depth);
    if (character === "[") return parseArray(depth);
    if (character === '"') return parseString();
    if (character === "t" && source.startsWith("true", cursor)) {
      cursor += 4;
      return true;
    }
    if (character === "f" && source.startsWith("false", cursor)) {
      cursor += 5;
      return false;
    }
    if (character === "n" && source.startsWith("null", cursor)) {
      cursor += 4;
      return null;
    }
    if (character === "-" || (character >= "0" && character <= "9")) return parseNumber();
    throw new SyntaxError("JSON value is invalid");
  }

  function parseObject(depth) {
    cursor += 1;
    const output = Object.create(null);
    const keys = new Set();
    skipWhitespace();
    if (source[cursor] === "}") {
      cursor += 1;
      return output;
    }
    while (cursor < source.length) {
      skipWhitespace();
      if (source[cursor] !== '"') throw new SyntaxError("JSON object key is invalid");
      consumeNode();
      const key = parseString();
      if (keys.has(key)) throw new SyntaxError("JSON object contains a duplicate key");
      keys.add(key);
      skipWhitespace();
      if (source[cursor] !== ":") throw new SyntaxError("JSON object separator is invalid");
      cursor += 1;
      output[key] = parseValue(depth + 1);
      skipWhitespace();
      if (source[cursor] === "}") {
        cursor += 1;
        return output;
      }
      if (source[cursor] !== ",") throw new SyntaxError("JSON object delimiter is invalid");
      cursor += 1;
    }
    throw new SyntaxError("JSON object is unterminated");
  }

  function parseArray(depth) {
    cursor += 1;
    const output = [];
    skipWhitespace();
    if (source[cursor] === "]") {
      cursor += 1;
      return output;
    }
    while (cursor < source.length) {
      output.push(parseValue(depth + 1));
      skipWhitespace();
      if (source[cursor] === "]") {
        cursor += 1;
        return output;
      }
      if (source[cursor] !== ",") throw new SyntaxError("JSON array delimiter is invalid");
      cursor += 1;
    }
    throw new SyntaxError("JSON array is unterminated");
  }

  function parseString() {
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      const code = source.charCodeAt(cursor);
      if (code === 0x22) {
        cursor += 1;
        // Only an isolated quoted token reaches JSON.parse; numeric tokens never do.
        return JSON.parse(source.slice(start, cursor));
      }
      if (code === 0x5c) {
        cursor += 2;
        continue;
      }
      if (code <= 0x1f) throw new SyntaxError("JSON string contains a control character");
      cursor += 1;
    }
    throw new SyntaxError("JSON string is unterminated");
  }

  function parseNumber() {
    numberPattern.lastIndex = cursor;
    const match = numberPattern.exec(source);
    if (match === null) throw new SyntaxError("JSON number is invalid");
    if (match[0].length > maximumJsonNumberCharacters) throw new SyntaxError("JSON number exceeds the limit");
    cursor = numberPattern.lastIndex;
    return new LosslessJsonNumber(match[0]);
  }

  function skipWhitespace() {
    while (
      source[cursor] === " " ||
      source[cursor] === "\t" ||
      source[cursor] === "\n" ||
      source[cursor] === "\r"
    ) {
      cursor += 1;
    }
  }

  function consumeNode() {
    nodes += 1;
    if (nodes > maximumJsonNodes) throw new SyntaxError("JSON node count exceeds the limit");
  }
}

function normalizeGitObjectId(value, label, errorCode) {
  if (typeof value !== "string" || !lowerHex40.test(value)) {
    throw new GitHubPublicSourceError(errorCode, `${label} must be an exact lowercase 40-hex Git object id`);
  }
  return value;
}

function normalizeTreeEntryMode(value, type) {
  const allowedByType = {
    blob: new Set(["100644", "100755", "120000"]),
    tree: new Set(["040000"]),
    commit: new Set(["160000"]),
  };
  if (typeof value !== "string" || !allowedByType[type]?.has(value)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub tree entry mode did not match its type");
  }
  return value;
}

function normalizeTreeBlobSize(value) {
  if (!(value instanceof LosslessJsonNumber) || !/^(?:0|[1-9][0-9]*)$/u.test(value.source)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub blob size was invalid");
  }
  const size = BigInt(value.source);
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub blob size exceeded the supported range");
  }
  return Number(size);
}

function normalizeDisplayText(value, maximumBytes, label) {
  if (
    typeof value !== "string" ||
    encoder.encode(value).byteLength < 1 ||
    encoder.encode(value).byteLength > maximumBytes ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", `${label} was invalid`);
  }
  return value;
}

function normalizeSafeCode(value, label) {
  if (typeof value !== "string" || !safeCodePattern.test(value)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", `${label} was invalid`);
  }
  return value;
}

function normalizeContentLength(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function normalizeRetryAfter(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,4})$/.test(value)) return null;
  const seconds = Number(value);
  return seconds <= 86_400 ? String(seconds) : null;
}

function normalizeTransportHeaderValue(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

function compareRepositoryRequests(left, right) {
  return compareUtf8(left.numericRepositoryId, right.numericRepositoryId);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function stableStringify(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite numbers are not canonical JSON");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("value is not canonical JSON");
  const keys = Object.keys(value).sort(compareUtf8);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

function assertPlainObject(value, code, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubPublicSourceError(code, message);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new GitHubPublicSourceError(code, message);
  }
}

function assertExactKeys(value, allowed, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new GitHubPublicSourceError(code, "object contains an unsupported field");
    }
  }
}

function invalidRequest(message) {
  throw new GitHubPublicSourceError("INVALID_REQUEST", message);
}

function githubUnavailableMessage(resourceKind) {
  if (resourceKind === "repository") return "GitHub public repository is unavailable";
  if (resourceKind === "commit") return "GitHub commit is not reachable from the public repository";
  if (resourceKind === "tree") return "GitHub tree is not reachable from the public repository";
  if (resourceKind === "blob") return "GitHub declared blob is not reachable from the public repository";
  return "GitHub Actions run is not reachable from the public repository";
}
