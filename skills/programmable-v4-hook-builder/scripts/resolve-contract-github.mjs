import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";
import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError,
  parseBoundedLosslessJson
} from "./github-public-source-core.mjs";
import {
  ContractResolutionError,
  REGULAR_BLOB_MODES,
  RESOLVE_CONTRACT_V1
} from "./resolve-contract-definitions.mjs";
import {
  apiPrefix,
  decodeStrictBase64,
  gitBlobObjectId,
  isPlainObject,
  normalizeDefaultBranch,
  normalizeObjectId,
  normalizeOpaqueDecimal,
  normalizeRemotePath,
  normalizeRepositoryHtmlUrl,
  normalizeRetryAfter,
  normalizeSafeInteger
} from "./resolve-contract-shared.mjs";

const decoder = new TextDecoder("utf-8", { fatal: true });

export async function resolveDefaultBranchHead(state, target, defaultBranch) {
  const encodedBranch = defaultBranch.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const reference = await requestJson(
    state,
    `${apiPrefix(target)}/git/ref/heads/${encodedBranch}`,
    "default-branch-ref",
    RESOLVE_CONTRACT_V1.maximumJsonResponseBytes
  );
  if (
    reference.ref !== `refs/heads/${defaultBranch}`
    || reference?.object?.type !== "commit"
  ) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub default-branch ref did not match the repository metadata.", {
      kind: "transport"
    });
  }
  const revisionObjectId = normalizeObjectId(reference.object.sha, "default-branch commit");
  const exactCommit = await requestJson(
    state,
    `${apiPrefix(target)}/git/commits/${revisionObjectId}`,
    "commit",
    RESOLVE_CONTRACT_V1.maximumJsonResponseBytes
  );
  const treeObjectId = normalizeObjectId(exactCommit?.tree?.sha, "default-branch tree");
  validateExactCommit(exactCommit, { revisionObjectId, treeObjectId }, target);
  return { revisionObjectId, treeObjectId };
}

export async function resolveBlob(state, target, entry, maximumBytes) {
  if (entry.type !== "blob" || !REGULAR_BLOB_MODES.has(entry.mode)) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "selected artifact is not a regular Git blob");
  }
  if (entry.size > maximumBytes) {
    throw new ContractResolutionError("GITHUB_RESPONSE_TOO_LARGE", "selected artifact exceeds its byte limit");
  }
  const response = await requestJson(
    state,
    `${apiPrefix(target)}/git/blobs/${entry.objectId}`,
    "blob",
    Math.min(RESOLVE_CONTRACT_V1.maximumJsonResponseBytes + (maximumBytes * 2), 5_000_000)
  );
  const responseSize = normalizeSafeInteger(response.size, "GitHub blob size", 100_000_000);
  if (response.sha !== entry.objectId || response.encoding !== "base64" || responseSize !== entry.size) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub blob metadata did not match the exact tree entry", {
      kind: "transport"
    });
  }
  const bytes = decodeStrictBase64(response.content, maximumBytes);
  if (bytes.length !== entry.size || gitBlobObjectId(bytes) !== entry.objectId) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub blob bytes did not match the exact Git object id", {
      kind: "transport"
    });
  }
  return { bytes };
}

export async function requestJson(state, url, resourceKind, maxResponseBytes) {
  if (state.requests >= RESOLVE_CONTRACT_V1.maximumRequests) {
    throw new ContractResolutionError(
      "GITHUB_REQUEST_BUDGET_EXHAUSTED",
      "The anonymous GitHub request budget was exhausted.",
      { kind: "transport" }
    );
  }
  if (state.responseBytes >= RESOLVE_CONTRACT_V1.maximumResponseBytes) {
    throw new ContractResolutionError(
      "GITHUB_RESPONSE_TOO_LARGE",
      "The anonymous GitHub response budget was exhausted.",
      { kind: "transport" }
    );
  }
  const remainingBytes = RESOLVE_CONTRACT_V1.maximumResponseBytes - state.responseBytes;
  const boundedResponseBytes = Math.min(maxResponseBytes, remainingBytes);
  const remainingMs = Math.floor(state.deadline - performance.now());
  if (remainingMs <= 0) {
    throw new ContractResolutionError("GITHUB_TIMEOUT", "GitHub contract resolution timed out.", {
      kind: "transport",
      retryable: true
    });
  }
  state.requests += 1;
  const controller = new AbortController();
  let timer;
  let response;
  try {
    response = await Promise.race([
      Promise.resolve(state.transport({
        method: "GET",
        url,
        headers: Object.freeze({
          Accept: "application/vnd.github+json",
          "User-Agent": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.userAgent,
          "X-GitHub-Api-Version": GITHUB_PUBLIC_SOURCE_CONTRACT_V1.githubApiVersion
        }),
        redirect: "error",
        signal: controller.signal,
        maxResponseBytes: boundedResponseBytes
      })),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ContractResolutionError("GITHUB_TIMEOUT", "GitHub contract resolution timed out.", {
            kind: "transport",
            retryable: true
          }));
        }, remainingMs);
      })
    ]);
  } catch (error) {
    if (error instanceof ContractResolutionError || error instanceof GitHubPublicSourceError) throw error;
    throw new ContractResolutionError("GITHUB_NETWORK_ERROR", "The anonymous GitHub request failed.", {
      kind: "transport",
      retryable: true
    });
  } finally {
    clearTimeout(timer);
  }
  const normalized = normalizeTransportResponse(response, url, boundedResponseBytes);
  state.responseBytes += normalized.body.length;
  if (normalized.status === 403 || normalized.status === 429) {
    throw new ContractResolutionError("GITHUB_RATE_LIMITED", "GitHub anonymous API rate limiting blocked resolution.", {
      kind: "transport",
      retryable: true,
      status: normalized.status,
      retryAfterSeconds: normalizeRetryAfter(normalized.headers["retry-after"])
    });
  }
  if (normalized.status === 404) {
    throw new ContractResolutionError(
      "GITHUB_PUBLIC_OBJECT_NOT_FOUND",
      `The requested public GitHub ${resourceKind} object was not found.`,
      { kind: "transport", status: 404 }
    );
  }
  if (normalized.status >= 500) {
    throw new ContractResolutionError("GITHUB_UNAVAILABLE", "GitHub public API is unavailable.", {
      kind: "transport",
      retryable: true,
      status: normalized.status,
      retryAfterSeconds: normalizeRetryAfter(normalized.headers["retry-after"])
    });
  }
  if (normalized.status < 200 || normalized.status >= 300) {
    throw new ContractResolutionError("GITHUB_UPSTREAM_REJECTED", "GitHub public API rejected the request.", {
      kind: "transport",
      status: normalized.status
    });
  }
  try {
    const source = decoder.decode(normalized.body);
    const value = parseBoundedLosslessJson(source);
    if (!isPlainObject(value)) throw new TypeError("response must be an object");
    return value;
  } catch {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub returned invalid bounded JSON.", {
      kind: "transport"
    });
  }
}

export function validateRepositoryMetadata(metadata, target) {
  const numericRepositoryId = normalizeOpaqueDecimal(metadata.id, "repository id");
  if (metadata.private !== false || (metadata.visibility !== undefined && metadata.visibility !== "public")) {
    throw new ContractResolutionError("GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE", "The GitHub repository is not public.", {
      kind: "transport"
    });
  }
  if (typeof metadata.full_name !== "string" || metadata.full_name.toLowerCase() !== target.slug) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub repository identity did not match the request.", {
      kind: "transport"
    });
  }
  const canonicalHtmlUrl = normalizeRepositoryHtmlUrl(metadata.html_url, target);
  return {
    numericRepositoryId,
    repositoryUri: canonicalHtmlUrl,
    defaultBranch: normalizeDefaultBranch(metadata.default_branch, { source: "github" })
  };
}

export function validateExactCommit(commit, head, target) {
  if (
    normalizeObjectId(commit.sha, "exact commit") !== head.revisionObjectId
    || normalizeObjectId(commit?.tree?.sha, "exact commit tree") !== head.treeObjectId
  ) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub exact commit metadata did not match the default-branch head.", {
      kind: "transport"
    });
  }
  if (!matchesCommitHtmlUrl(commit.html_url, target, head.revisionObjectId)) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub exact commit URL did not match the requested repository.", {
      kind: "transport"
    });
  }
}

export function matchesCommitHtmlUrl(value, target, revisionObjectId) {
  if (typeof value !== "string") return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  return url.protocol === "https:"
    && url.hostname === "github.com"
    && url.port === ""
    && url.username === ""
    && url.password === ""
    && url.search === ""
    && url.hash === ""
    && segments.length === 4
    && segments[0].toLowerCase() === target.owner
    && segments[1].toLowerCase() === target.repository
    && segments[2] === "commit"
    && segments[3] === revisionObjectId;
}

export function validateRecursiveTree(tree, expectedTreeObjectId) {
  if (normalizeObjectId(tree.sha, "recursive tree") !== expectedTreeObjectId || tree.truncated !== false) {
    throw new ContractResolutionError("GITHUB_TREE_INCOMPLETE", "GitHub did not return the complete exact default-branch tree.", {
      kind: "transport"
    });
  }
  if (!Array.isArray(tree.tree) || tree.tree.length > 100_000) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub recursive tree inventory is invalid.", {
      kind: "transport"
    });
  }
  const seen = new Set();
  return tree.tree.map((entry) => {
    if (!isPlainObject(entry)) throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub tree entry is invalid.", { kind: "transport" });
    let entryPath;
    try {
      entryPath = normalizeRemotePath(entry.path, "GitHub tree path");
    } catch {
      throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub tree path is invalid.", { kind: "transport" });
    }
    if (seen.has(entryPath)) throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub tree paths are duplicated.", { kind: "transport" });
    seen.add(entryPath);
    const type = entry.type;
    if (!new Set(["blob", "tree", "commit"]).has(type)) {
      throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub tree entry type is invalid.", { kind: "transport" });
    }
    const mode = entry.mode;
    if (typeof mode !== "string" || !/^[0-7]{6}$/u.test(mode)) {
      throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub tree entry mode is invalid.", { kind: "transport" });
    }
    const objectId = normalizeObjectId(entry.sha, "GitHub tree object");
    const size = type === "blob" ? normalizeSafeInteger(entry.size, "GitHub blob size", 100_000_000) : null;
    return Object.freeze({ path: entryPath, type, mode, objectId, size });
  });
}

export function normalizeTransportResponse(response, expectedUrl, maximumBytes) {
  if (!isPlainObject(response) || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub transport returned an invalid response.", { kind: "transport" });
  }
  if (response.redirected === true || (response.responseUrl && response.responseUrl !== expectedUrl)) {
    throw new ContractResolutionError("GITHUB_REDIRECT_REJECTED", "GitHub redirects are not followed.", {
      kind: "transport",
      status: response.status
    });
  }
  const body = typeof response.body === "string"
    ? Buffer.from(response.body, "utf8")
    : response.body instanceof Uint8Array
      ? Buffer.from(response.body)
      : response.body instanceof ArrayBuffer
        ? Buffer.from(response.body)
        : null;
  if (body === null) throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub transport body is invalid.", { kind: "transport" });
  if (body.length > maximumBytes) throw new ContractResolutionError("GITHUB_RESPONSE_TOO_LARGE", "GitHub response exceeded its byte limit.", { kind: "transport" });
  const headers = normalizeHeaders(response.headers);
  return { status: response.status, body, headers };
}

export function normalizeHeaders(headers) {
  const output = Object.create(null);
  if (headers?.get) {
    for (const name of ["retry-after", "x-ratelimit-remaining", "content-type"]) output[name] = headers.get(name);
    return output;
  }
  if (headers === undefined || headers === null) return output;
  if (!isPlainObject(headers)) throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub transport headers are invalid.", { kind: "transport" });
  for (const name of ["retry-after", "x-ratelimit-remaining", "content-type"]) {
    const value = headers[name] ?? headers[name.toUpperCase()] ?? null;
    output[name] = typeof value === "string" ? value : null;
  }
  return output;
}
