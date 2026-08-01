import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";
import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError,
  createGitHubPublicFetchTransportV1,
  parseBoundedLosslessJson,
  resolveGitHubPublicSourceV1,
  serializeGitHubPublicSourceV1,
  validateGitHubPublicSourceRequestV1
} from "./github-public-source-core.mjs";
import { createAnonymousGitHubExactObjectResolverV1 } from "./github-exact-object-resolver.mjs";
import {
  normalizeCompanionManifest,
  verifyCompanionManifestV2Closure
} from "./companion-manifest-contract.mjs";
import { CliFailure } from "./cli-runtime.mjs";
import { isCanonicalReviewTargetPath } from "./review-target-contract.mjs";
import { canonicalJson } from "./submission-core.mjs";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MAX_BOOTSTRAP_RESPONSE_BYTES = 1_048_576;
const MAX_TOTAL_RESPONSE_BYTES = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTotalResponseBytes;
const DEFAULT_ATTEMPTS = 3;
const MAX_BOOTSTRAP_CONCURRENCY = 3;
const MAX_PUBLIC_REQUESTS = 48;
const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
const decoder = new TextDecoder("utf-8", { fatal: true });

export function parseGitHubRemote(remoteUrl) {
  if (containsUnsafeText(remoteUrl)) {
    throw new CliFailure("GITHUB_REMOTE_REQUIRED", "the upstream remote is not a supported github.com URL", { exitCode: 1 });
  }
  let owner;
  let repository;
  if (remoteUrl.startsWith("git@github.com:")) {
    const match = remoteUrl.match(/^git@github\.com:([^/]+)\/([^/]+)$/u);
    if (match) [, owner, repository] = match;
  } else {
    let parsed;
    try {
      parsed = new URL(remoteUrl);
    } catch {
      parsed = null;
    }
    if (
      parsed
      && ["https:", "ssh:"].includes(parsed.protocol)
      && parsed.hostname.toLowerCase() === "github.com"
      && parsed.port === ""
      && parsed.search === ""
      && parsed.hash === ""
      && parsed.password === ""
      && ((parsed.protocol === "https:" && parsed.username === "") || (parsed.protocol === "ssh:" && parsed.username === "git"))
    ) {
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length === 2) [owner, repository] = segments;
    }
  }
  if (repository?.endsWith(".git")) repository = repository.slice(0, -4);
  if (!validGitHubOwner(owner) || !validGitHubRepository(repository)) {
    throw new CliFailure("GITHUB_REMOTE_REQUIRED", "the upstream remote is not a supported github.com repository", { exitCode: 1 });
  }
  return {
    owner: owner.toLowerCase(),
    repository: repository.toLowerCase(),
    repositorySlug: `${owner.toLowerCase()}/${repository.toLowerCase()}`,
    configuredRemoteUrl: remoteUrl,
    repositoryUrl: `https://github.com/${owner.toLowerCase()}/${repository.toLowerCase()}`
  };
}

export async function resolvePublicGitHubUser({
  login,
  fetchImplementation = globalThis.fetch,
  sleepImplementation = sleep,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs
}) {
  if (typeof login !== "string" || !GITHUB_LOGIN_PATTERN.test(login)) {
    throw new CliFailure("BUILDER_GITHUB_IDENTITY_INVALID", "the builder GitHub login is invalid", { exitCode: 1 });
  }
  if (
    typeof fetchImplementation !== "function"
    || typeof sleepImplementation !== "function"
    || !Number.isInteger(attempts)
    || attempts < 1
    || attempts > 5
    || !Number.isInteger(timeoutMs)
    || timeoutMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs
    || timeoutMs > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs
  ) {
    throw new CliFailure("INTERNAL_ERROR", "builder GitHub resolver options are outside the supported bounds");
  }

  const url = `${GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin}/users/${encodeURIComponent(login)}`;
  const deadline = performance.now() + timeoutMs;
  const transport = createGitHubPublicFetchTransportV1(fetchImplementation, {
    allowPublicUserLookups: true
  });
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await requestBootstrapResponse({
        transport,
        url,
        deadline,
        resourceKind: "user"
      });
      let source;
      let metadata;
      try {
        source = decoder.decode(response.body);
        metadata = parseBoundedLosslessJson(source);
      } catch (error) {
        throw new GitHubPublicSourceError(
          "GITHUB_PROTOCOL_ERROR",
          "GitHub returned invalid builder user metadata",
          { cause: error }
        );
      }
      const githubUserId = extractTopLevelDecimal(source, "id");
      const githubLogin = metadata?.login;
      if (
        githubUserId === null
        || githubUserId.length > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.opaqueIdDigits
        || typeof githubLogin !== "string"
        || !GITHUB_LOGIN_PATTERN.test(githubLogin)
        || githubLogin.toLowerCase() !== login.toLowerCase()
        || metadata?.html_url !== `https://github.com/${githubLogin}`
      ) {
        throw new GitHubPublicSourceError(
          "GITHUB_PROTOCOL_ERROR",
          "GitHub builder user identity did not match the requested login"
        );
      }
      return Object.freeze({
        githubUserId,
        githubLogin,
        profileUrl: `https://github.com/${githubLogin}`
      });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw translateBuilderUserError(error);
    }
    await sleepImplementation(250 * (2 ** (attempt - 1)));
  }
  throw translateBuilderUserError(lastError);
}

export async function resolvePublicGitHubSource({
  owner,
  repository,
  commit,
  tree,
  sourcePaths = [],
  contractPaths = [],
  primaryBlobBytes = null,
  companions = [],
  exactObjectResolver = undefined,
  fetchImplementation = globalThis.fetch,
  sleepImplementation = sleep,
  attempts = DEFAULT_ATTEMPTS,
  timeoutMs = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.defaultTimeoutMs
}) {
  if (!validGitHubOwner(owner) || !validGitHubRepository(repository)) {
    throw new CliFailure("GITHUB_REMOTE_REQUIRED", "the GitHub source identity is invalid", { exitCode: 1 });
  }
  if (!COMMIT_PATTERN.test(commit ?? "") || !COMMIT_PATTERN.test(tree ?? "")) {
    throw new CliFailure("GIT_STATE_INVALID", "the GitHub source requires exact commit and tree object ids", { exitCode: 1 });
  }
  const normalizedCompanions = normalizeCompanionDescriptors(companions);
  const primaryRepositoryUri = `https://github.com/${owner.toLowerCase()}/${repository.toLowerCase()}`;
  if (normalizedCompanions.some((entry) => entry.repositoryUri === primaryRepositoryUri)) {
    throw new CliFailure("COMPANION_MANIFEST_INVALID", "a companion cannot duplicate the primary repository", {
      exitCode: 1
    });
  }
  if (
    typeof fetchImplementation !== "function"
    || typeof sleepImplementation !== "function"
    || !Number.isInteger(attempts)
    || attempts < 1
    || attempts > 5
    || !Number.isInteger(timeoutMs)
    || timeoutMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs
    || timeoutMs > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs
  ) {
    throw new CliFailure("INTERNAL_ERROR", "public GitHub resolver options are outside the supported bounds");
  }
  if (exactObjectResolver !== undefined && typeof exactObjectResolver !== "function") {
    throw new CliFailure("INTERNAL_ERROR", "the exact Git object resolver is unavailable");
  }
  const trustedExactObjectResolver = exactObjectResolver
    ?? (fetchImplementation === globalThis.fetch ? createAnonymousGitHubExactObjectResolverV1() : null);
  const companionV2 = normalizedCompanions.filter(({ companionManifestV2 }) => companionManifestV2 !== null);
  if (companionV2.length > 0 && trustedExactObjectResolver === null) {
    throw new CliFailure(
      "TOOLING_BLOCKED",
      "companion manifest v2 requires the bounded exact Git object resolver",
      { exitCode: 1, details: { validationState: "TOOLING_BLOCKED" } }
    );
  }
  const capturedCompanionRecords = new Map();
  const closureAwareExactObjectResolver = companionV2.length === 0
    ? trustedExactObjectResolver
    : async (request) => {
        const result = await trustedExactObjectResolver(request);
        const records = result instanceof Map ? result : result?.records;
        if (records instanceof Map) {
          const prior = capturedCompanionRecords.get(request.repositoryUri) ?? new Map();
          for (const [filePath, record] of records) prior.set(filePath, record);
          capturedCompanionRecords.set(request.repositoryUri, prior);
        }
        return result;
      };
  const requestBudget = { remaining: MAX_PUBLIC_REQUESTS };
  const budgetedFetchImplementation = async (...args) => {
    if (requestBudget.remaining <= 0) {
      throw new GitHubPublicSourceError(
        "GITHUB_UPSTREAM_REJECTED",
        "GitHub public source request budget was exhausted; reduce companion or declared-path breadth"
      );
    }
    requestBudget.remaining -= 1;
    return fetchImplementation(...args);
  };

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await resolveOnce({
        owner,
        repository,
        commit,
        tree,
        sourcePaths,
        contractPaths,
        primaryBlobBytes,
        exactObjectResolver: closureAwareExactObjectResolver,
        companions: normalizedCompanions,
        capturedCompanionRecords,
        fetchImplementation: budgetedFetchImplementation,
        timeoutMs
      });
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts) throw translateResolverError(error);
    }
    await sleepImplementation(250 * (2 ** (attempt - 1)));
  }
  throw translateResolverError(lastError);
}

async function resolveOnce({
  owner,
  repository,
  commit,
  tree,
  sourcePaths,
  contractPaths,
  primaryBlobBytes,
  exactObjectResolver,
  companions,
  capturedCompanionRecords,
  fetchImplementation,
  timeoutMs
}) {
  const deadline = performance.now() + timeoutMs;
  const repositoryUri = `https://github.com/${owner}/${repository}`;
  const repositoryApiUrl = `${GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin}/repos/${owner}/${repository}`;
  const transport = createGitHubPublicFetchTransportV1(fetchImplementation);
  const cachedResponses = new Map();
  const bootstrapResponse = await requestBootstrapResponse({
    transport,
    url: repositoryApiUrl,
    deadline,
    resourceKind: "repository"
  });
  const metadataSource = decoder.decode(bootstrapResponse.body);
  const numericRepositoryId = extractTopLevelDecimal(metadataSource, "id");
  if (
    numericRepositoryId === null
    || numericRepositoryId.length > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.opaqueIdDigits
  ) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub repository id was not a canonical decimal integer");
  }
  cachedResponses.set(repositoryApiUrl, bootstrapResponse);

  const companionRequests = await mapInBatches(companions, MAX_BOOTSTRAP_CONCURRENCY, async (companion) => {
    const parsed = new URL(companion.repositoryUri);
    const [companionOwner, companionRepository] = parsed.pathname.slice(1).split("/");
    const companionApiUrl = `${GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin}/repos/${companionOwner}/${companionRepository}`;
    const commitApiUrl = `${companionApiUrl}/git/commits/${companion.revisionObjectId}`;
    const metadataResponse = await requestBootstrapResponse({
      transport,
      url: companionApiUrl,
      deadline,
      resourceKind: "repository"
    });
    const companionRepositoryId = extractTopLevelDecimal(decoder.decode(metadataResponse.body), "id");
    if (
      companionRepositoryId === null
      || companionRepositoryId.length > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.opaqueIdDigits
    ) {
      throw new GitHubPublicSourceError(
        "GITHUB_PROTOCOL_ERROR",
        "GitHub repository id was not a canonical decimal integer"
      );
    }
    const commitResponse = await requestBootstrapResponse({
      transport,
      url: commitApiUrl,
      deadline,
      resourceKind: "commit"
    });
    const observedCompanionTreeObjectId = extractCommitTreeObjectId(commitResponse.body);
    if (
      companion.numericRepositoryId !== null
      && companion.numericRepositoryId !== companionRepositoryId
    ) {
      throw new GitHubPublicSourceError(
        "GITHUB_REPOSITORY_ID_MISMATCH",
        "GitHub companion repository identity did not match manifest v2"
      );
    }
    if (
      companion.treeObjectId !== null
      && companion.treeObjectId !== observedCompanionTreeObjectId
    ) {
      throw new GitHubPublicSourceError(
        "GITHUB_TREE_MISMATCH",
        "GitHub companion root tree did not match manifest v2"
      );
    }
    cachedResponses.set(companionApiUrl, metadataResponse);
    cachedResponses.set(commitApiUrl, commitResponse);
    return {
      repositoryUri: companion.repositoryUri,
      numericRepositoryId: companion.numericRepositoryId ?? companionRepositoryId,
      revisionObjectId: companion.revisionObjectId,
      treeObjectId: companion.treeObjectId ?? observedCompanionTreeObjectId,
      sourcePaths: companion.sourcePaths,
      contractPaths: companion.contractPaths,
      githubActionsRunIds: companion.githubActionsRunIds
    };
  });

  const cachedTransport = async (request) => {
    const cached = cachedResponses.get(request.url);
    if (cached !== undefined) {
      cachedResponses.delete(request.url);
      return cached;
    }
    return transport(request);
  };
  const remainingMs = Math.floor(deadline - performance.now());
  if (remainingMs < GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.minimumTimeoutMs) {
    throw new GitHubPublicSourceError("GITHUB_TIMEOUT", "GitHub resolution timed out", { retryable: true });
  }
  const sourceRequest = validateGitHubPublicSourceRequestV1({
    schemaVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion,
    primary: {
      repositoryUri,
      numericRepositoryId,
      revisionObjectId: commit,
      treeObjectId: tree,
      sourcePaths,
      contractPaths,
      githubActionsRunIds: []
    },
    companions: companionRequests
  });
  const localBlobBytes = normalizePrimaryBlobBytes(primaryBlobBytes, sourceRequest.primary);
  const resolution = await resolveGitHubPublicSourceV1(
    sourceRequest,
    {
      transport: cachedTransport,
      timeoutMs: remainingMs,
      maxResponseBytes: MAX_TOTAL_RESPONSE_BYTES,
      ...(localBlobBytes === null
        ? {}
        : { localBlobBytes: new Map([[sourceRequest.primary.repositoryUri, localBlobBytes]]) }),
      ...(exactObjectResolver === null ? {} : { exactObjectResolver })
    }
  );
  const primary = resolution.primary;
  const canonicalSourceRequest = sourceRequestFromResolution(resolution);
  const companionClosure = companions
    .filter(({ companionManifestV2 }) => companionManifestV2 !== null)
    .map((companion) => {
      const resolved = resolution.companions.find(
        ({ display }) => display.repositoryUri === companion.repositoryUri
      );
      if (resolved === undefined) {
        throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion v2 public source result is missing", { exitCode: 1 });
      }
      try {
        return verifyCompanionManifestV2Closure(
          companion.companionManifestV2,
          capturedCompanionRecords.get(companion.repositoryUri),
          resolved.githubActionsEvidence,
          { manifestPath: companion.manifestPath }
        );
      } catch (error) {
        throw new CliFailure(
          error?.code === "COMPANION_STATIC_CLOSURE_UNSUPPORTED"
            ? "COMPANION_CLOSURE_REVIEW_REQUIRED"
            : "COMPANION_MANIFEST_INVALID",
          error?.message ?? "companion v2 closure verification failed",
          { exitCode: 1 }
        );
      }
    });
  const sourceResolutionHash = `sha256:${crypto
    .createHash("sha256")
    .update(serializeGitHubPublicSourceV1(resolution))
    .digest("hex")}`;
  return {
    owner: primary.display.owner,
    repository: primary.display.repository,
    repositorySlug: `${primary.display.owner}/${primary.display.repository}`,
    repositoryId: primary.authority.numericRepositoryId,
    repositoryUrl: primary.display.repositoryUri,
    commit: primary.authority.revisionObjectId,
    tree: primary.authority.treeObjectId,
    publicRepositoryReachable: true,
    publicCommitReachable: true,
    sourceRequest: canonicalSourceRequest,
    sourceResolutionHash,
    sourceResolution: resolution,
    companionClosure
  };
}

function normalizePrimaryBlobBytes(input, primaryRequest) {
  if (input === null) return null;
  if (!(input instanceof Map)) {
    throw new CliFailure("GIT_STATE_INVALID", "primary source bytes must be an exact immutable Git snapshot", {
      exitCode: 1
    });
  }
  const expectedPaths = [...primaryRequest.sourcePaths, ...primaryRequest.contractPaths];
  if (input.size !== expectedPaths.length) {
    throw new CliFailure("GIT_STATE_INVALID", "primary source bytes did not cover every declared path", {
      exitCode: 1
    });
  }
  const normalized = new Map();
  for (const filePath of expectedPaths) {
    const bytes = input.get(filePath);
    if (!(bytes instanceof Uint8Array)) {
      throw new CliFailure("GIT_STATE_INVALID", "primary source bytes did not cover every declared path", {
        exitCode: 1
      });
    }
    normalized.set(filePath, Buffer.from(bytes));
  }
  return normalized;
}

export function normalizeCompanionDescriptors(companions) {
  if (!Array.isArray(companions) || companions.length > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.companions) {
    throw new CliFailure("COMPANION_MANIFEST_INVALID", "prepare-pr accepts at most eight companion manifests", {
      exitCode: 1
    });
  }
  const normalized = [];
  const repositoryUris = new Set();
  for (const companion of companions) {
    try {
      const manifestV2 = companion?.companionManifestV2 ?? null;
      const manifestPath = companion?.manifestPath ?? null;
      if (manifestV2 !== null && !isCanonicalReviewTargetPath(manifestPath)) {
        throw new Error("companion v2 descriptor is missing its exact primary manifest path");
      }
      let expected;
      if (manifestV2 !== null) {
        expected = normalizeCompanionManifest(manifestV2);
        const receivedSource = {
          repositoryUri: companion?.repositoryUri,
          numericRepositoryId: companion?.numericRepositoryId,
          revisionObjectId: companion?.revisionObjectId,
          treeObjectId: companion?.treeObjectId,
          sourcePaths: companion?.sourcePaths,
          contractPaths: companion?.contractPaths,
          githubActionsRunIds: companion?.githubActionsRunIds
        };
        if (canonicalJson(receivedSource) !== canonicalJson(expected.source)) {
          throw new Error("companion v2 descriptor does not match its manifest");
        }
      }
      const request = validateGitHubPublicSourceRequestV1({
        schemaVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion,
        primary: {
          repositoryUri: companion?.repositoryUri,
          numericRepositoryId: companion?.numericRepositoryId ?? "1",
          revisionObjectId: companion?.revisionObjectId,
          treeObjectId: companion?.treeObjectId ?? "0".repeat(40),
          sourcePaths: companion?.sourcePaths,
          contractPaths: companion?.contractPaths,
          githubActionsRunIds: companion?.githubActionsRunIds ?? []
        },
        companions: []
      }).primary;
      if (repositoryUris.has(request.repositoryUri)) {
        throw new Error("companion repositories must be unique");
      }
      repositoryUris.add(request.repositoryUri);
      normalized.push(Object.freeze({
        repositoryUri: request.repositoryUri,
        numericRepositoryId: manifestV2 === null ? null : request.numericRepositoryId,
        revisionObjectId: request.revisionObjectId,
        treeObjectId: manifestV2 === null ? null : request.treeObjectId,
        sourcePaths: request.sourcePaths,
        contractPaths: request.contractPaths,
        githubActionsRunIds: request.githubActionsRunIds,
        manifestPath,
        companionManifestV2: manifestV2 === null ? null : expected.manifestV2
      }));
    } catch (error) {
      if (error instanceof CliFailure) throw error;
      throw new CliFailure(
        "COMPANION_MANIFEST_INVALID",
        error?.message === "companion repositories must be unique"
          ? error.message
          : "a companion manifest does not satisfy GitHubPublicSourceContractV1",
        { exitCode: 1 }
      );
    }
  }
  return Object.freeze(normalized);
}

async function mapInBatches(values, concurrency, operation) {
  const output = new Array(values.length);
  for (let offset = 0; offset < values.length; offset += concurrency) {
    const batch = values.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(batch.map(operation));
    for (let index = 0; index < settled.length; index += 1) {
      const outcome = settled[index];
      if (outcome.status === "rejected") throw outcome.reason;
      output[offset + index] = outcome.value;
    }
  }
  return output;
}

function extractCommitTreeObjectId(body) {
  let parsed;
  try {
    parsed = JSON.parse(decoder.decode(body));
  } catch (error) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub returned invalid commit metadata", {
      cause: error
    });
  }
  const treeObjectId = parsed?.tree?.sha;
  if (!COMMIT_PATTERN.test(treeObjectId ?? "")) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub commit tree object id was invalid");
  }
  return treeObjectId;
}

function sourceRequestFromResolution(resolution) {
  const project = (repository) => ({
    repositoryUri: repository.display.repositoryUri,
    numericRepositoryId: repository.authority.numericRepositoryId,
    revisionObjectId: repository.authority.revisionObjectId,
    treeObjectId: repository.authority.treeObjectId,
    sourcePaths: [...repository.sourcePaths],
    contractPaths: [...repository.contractPaths],
    githubActionsRunIds: repository.githubActionsEvidence.map((entry) => entry.runId)
  });
  return validateGitHubPublicSourceRequestV1({
    schemaVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion,
    primary: project(resolution.primary),
    companions: resolution.companions.map(project)
  });
}

async function requestBootstrapResponse({ transport, url, deadline, resourceKind }) {
  const remainingMs = deadline - performance.now();
  if (remainingMs <= 0) {
    throw new GitHubPublicSourceError("GITHUB_TIMEOUT", "GitHub resolution timed out", { retryable: true });
  }
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
      transport({
        method: "GET",
        url,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.userAgent,
          "X-GitHub-Api-Version": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion
        },
        redirect: "error",
        signal: controller.signal,
        maxResponseBytes: MAX_BOOTSTRAP_RESPONSE_BYTES
      }),
      timeoutPromise
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }
  if (response.responseUrl && response.responseUrl !== url) {
    throw new GitHubPublicSourceError("GITHUB_REDIRECT_REJECTED", "GitHub response URL changed");
  }
  if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub transport status was invalid");
  }
  if (response.status === 404) {
    if (resourceKind === "user") {
      throw new GitHubPublicSourceError(
        "GITHUB_UPSTREAM_REJECTED",
        "GitHub builder user is unavailable",
        { status: response.status }
      );
    }
    const code = resourceKind === "commit" ? "GITHUB_COMMIT_NOT_REACHABLE" : "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE";
    const message = resourceKind === "commit"
      ? "GitHub commit is not reachable from the public repository"
      : "GitHub public repository is unavailable";
    throw new GitHubPublicSourceError(code, message);
  }
  if ([403, 429].includes(response.status)) {
    throw new GitHubPublicSourceError("GITHUB_RATE_LIMITED", "GitHub public API rate limit was reached", { retryable: true, status: response.status });
  }
  if (response.status >= 500) {
    throw new GitHubPublicSourceError("GITHUB_UNAVAILABLE", "GitHub public API is unavailable", { retryable: true, status: response.status });
  }
  if (response.status < 200 || response.status >= 300) {
    throw new GitHubPublicSourceError("GITHUB_UPSTREAM_REJECTED", "GitHub public API rejected the request", { status: response.status });
  }
  return response;
}

function extractTopLevelDecimal(source, wantedKey) {
  let cursor = skipWhitespace(source, 0);
  if (source[cursor] !== "{") return null;
  cursor += 1;
  let found = null;
  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] === "}") return found;
    const keyToken = readJsonString(source, cursor);
    if (keyToken === null) return null;
    cursor = skipWhitespace(source, keyToken.end);
    if (source[cursor] !== ":") return null;
    cursor = skipWhitespace(source, cursor + 1);
    const valueStart = cursor;
    const valueEnd = skipJsonValue(source, cursor);
    if (valueEnd === null) return null;
    if (keyToken.value === wantedKey) {
      const token = source.slice(valueStart, valueEnd).trim();
      const candidate = /^[1-9][0-9]*$/u.test(token) ? token : null;
      if (candidate === null || found !== null) return null;
      found = candidate;
    }
    cursor = skipWhitespace(source, valueEnd);
    if (source[cursor] === ",") {
      cursor += 1;
      continue;
    }
    if (source[cursor] === "}") return found;
    return null;
  }
  return null;
}

function readJsonString(source, start) {
  if (source[start] !== "\"") return null;
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") cursor += 1;
    else if (source[cursor] === "\"") {
      const token = source.slice(start, cursor + 1);
      try {
        return { value: JSON.parse(token), end: cursor + 1 };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function skipJsonValue(source, start) {
  if (source[start] === "\"") return readJsonString(source, start)?.end ?? null;
  if (["{", "["].includes(source[start])) {
    const stack = [source[start] === "{" ? "}" : "]"];
    for (let cursor = start + 1; cursor < source.length; cursor += 1) {
      if (source[cursor] === "\"") {
        const token = readJsonString(source, cursor);
        if (token === null) return null;
        cursor = token.end - 1;
      } else if (["{", "["].includes(source[cursor])) {
        stack.push(source[cursor] === "{" ? "}" : "]");
      } else if (source[cursor] === stack.at(-1)) {
        stack.pop();
        if (stack.length === 0) return cursor + 1;
      }
    }
    return null;
  }
  let cursor = start;
  while (cursor < source.length && ![",", "}"].includes(source[cursor])) cursor += 1;
  return cursor;
}

function skipWhitespace(source, start) {
  let cursor = start;
  while (/[\t\n\r ]/u.test(source[cursor] ?? "")) cursor += 1;
  return cursor;
}

function isRetryable(error) {
  if (error instanceof CliFailure) return false;
  return !(error instanceof GitHubPublicSourceError) || error.retryable === true;
}

function translateResolverError(error) {
  if (error instanceof CliFailure) return error;
  if (error instanceof GitHubPublicSourceError) {
    if (error.code === "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE") {
      return new CliFailure("GITHUB_REPOSITORY_NOT_PUBLIC", error.message, { exitCode: 1 });
    }
    if (error.code === "GITHUB_COMMIT_NOT_REACHABLE") {
      return new CliFailure("GITHUB_COMMIT_NOT_PUBLIC", error.message, { exitCode: 1 });
    }
    if (
      error.code === "GITHUB_UPSTREAM_REJECTED"
      && error.message.startsWith("Exact Git object tooling is unavailable:")
    ) {
      return new CliFailure("TOOLING_BLOCKED", error.message, {
        exitCode: 1,
        details: { validationState: "TOOLING_BLOCKED" },
      });
    }
    if (
      error.code === "GITHUB_UPSTREAM_REJECTED"
      && error.message.startsWith("GitHub public source request budget was exhausted")
    ) {
      return new CliFailure("GITHUB_REQUEST_BUDGET_EXHAUSTED", error.message, { exitCode: 1 });
    }
    if ([
      "GITHUB_REPOSITORY_ID_MISMATCH",
      "GITHUB_REPOSITORY_LOCATOR_MISMATCH",
      "GITHUB_COMMIT_MISMATCH",
      "GITHUB_TREE_MISMATCH"
    ].includes(error.code)) {
      return new CliFailure("GITHUB_SOURCE_MISMATCH", error.message, { exitCode: 1 });
    }
    return new CliFailure("GITHUB_PUBLIC_CHECK_FAILED", error.message, { exitCode: 1 });
  }
  return new CliFailure("GITHUB_PUBLIC_CHECK_FAILED", "public GitHub reachability failed after bounded retries", { exitCode: 1 });
}

function translateBuilderUserError(error) {
  if (error instanceof CliFailure) return error;
  if (error instanceof GitHubPublicSourceError) {
    if (error.code === "GITHUB_UPSTREAM_REJECTED" && error.status === 404) {
      return new CliFailure("BUILDER_GITHUB_IDENTITY_UNAVAILABLE", error.message, { exitCode: 1 });
    }
    if (error.code === "GITHUB_PROTOCOL_ERROR" || error.code === "GITHUB_REDIRECT_REJECTED") {
      return new CliFailure("BUILDER_GITHUB_IDENTITY_MISMATCH", error.message, { exitCode: 1 });
    }
    return new CliFailure("BUILDER_GITHUB_CHECK_FAILED", error.message, { exitCode: 1 });
  }
  return new CliFailure(
    "BUILDER_GITHUB_CHECK_FAILED",
    "public GitHub builder identity resolution failed after bounded retries",
    { exitCode: 1 }
  );
}

function validGitHubOwner(value) {
  return typeof value === "string"
    && /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/u.test(value);
}

function validGitHubRepository(value) {
  return typeof value === "string"
    && /^(?!\.\.?$)[A-Za-z0-9._-]{1,100}$/u.test(value)
    && /[A-Za-z0-9]/u.test(value);
}

function containsUnsafeText(value) {
  return typeof value !== "string"
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
