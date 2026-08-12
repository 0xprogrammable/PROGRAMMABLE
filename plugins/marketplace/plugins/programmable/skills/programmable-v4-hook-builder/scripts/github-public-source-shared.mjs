import { TextEncoder } from "node:util";
import { isCanonicalReviewTargetPath } from "./review-target-contract.mjs";
import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError
} from "./github-public-source-contract.mjs";
import { LosslessJsonNumber } from "./github-public-source-lossless-json.mjs";

const encoder = new TextEncoder();
export const lowerHex40 = /^[0-9a-f]{40}$/;
const opaqueDecimal = /^[1-9][0-9]{0,63}$/;
const ownerPattern = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;
const repositoryPattern = /^[a-z0-9._-]{1,100}$/;
const safeCodePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;

export function parseCanonicalRepositoryUri(value) {
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

export function assertPublicFetchRequest(request, allowPublicUserLookups) {
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

export function validateRepositoryHtmlUrl(value, expectedOwner, expectedRepository) {
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

export function validateCommitHtmlUrl(value, owner, repository, commit) {
  validateStructuredGitHubUrl(value, [owner, repository, "commit", commit], "GitHub commit URL was invalid");
}

export function validateActionsHtmlUrl(value, owner, repository, runId) {
  validateStructuredGitHubUrl(
    value,
    [owner, repository, "actions", "runs", runId],
    "GitHub Actions URL was invalid",
  );
}

export function validateStructuredGitHubUrl(value, expectedParts, message) {
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

export function assertCanonicalApiUrl(value, allowPublicUserLookups) {
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

export function normalizeWorkflowPath(value) {
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

export function normalizeRepositoryPath(value) {
  if (!isCanonicalReviewTargetPath(value)) invalidRequest("repository path is not canonical");
  return value;
}

export function isWellFormedUnicode(value) {
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

export function normalizeUniqueArray(value, limit, normalizer, label) {
  if (!Array.isArray(value)) invalidRequest(`${label} must be an array`);
  if (value.length > limit) invalidRequest(`${label} exceed the contract limit`);
  const normalized = value.map(normalizer).sort(compareUtf8);
  assertNoDuplicateSortedValues(normalized, label);
  return deepFreeze(normalized);
}

export function assertNoDuplicateSortedValues(values, label) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index - 1] === values[index]) invalidRequest(`${label} must be unique`);
  }
}

export function normalizeOpaqueId(value, label, errorCode, requireLosslessJsonNumber = false) {
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

export function normalizeGitObjectId(value, label, errorCode) {
  if (typeof value !== "string" || !lowerHex40.test(value)) {
    throw new GitHubPublicSourceError(errorCode, `${label} must be an exact lowercase 40-hex Git object id`);
  }
  return value;
}

export function normalizeTreeEntryMode(value, type) {
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

export function normalizeTreeBlobSize(value) {
  if (!(value instanceof LosslessJsonNumber) || !/^(?:0|[1-9][0-9]*)$/u.test(value.source)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub blob size was invalid");
  }
  const size = BigInt(value.source);
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "GitHub blob size exceeded the supported range");
  }
  return Number(size);
}

export function normalizeDisplayText(value, maximumBytes, label) {
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

export function normalizeSafeCode(value, label) {
  if (typeof value !== "string" || !safeCodePattern.test(value)) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", `${label} was invalid`);
  }
  return value;
}

export function normalizeContentLength(value) {
  if (value === null || value === undefined || value === "") return null;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

export function normalizeRetryAfter(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,4})$/.test(value)) return null;
  const seconds = Number(value);
  return seconds <= 86_400 ? String(seconds) : null;
}

export function normalizeTransportHeaderValue(value) {
  if (value === null || value === undefined) return null;
  return typeof value === "string" ? value : String(value);
}

export function compareRepositoryRequests(left, right) {
  return compareUtf8(left.numericRepositoryId, right.numericRepositoryId);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function stableStringify(value) {
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

export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function assertPlainObject(value, code, message) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubPublicSourceError(code, message);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new GitHubPublicSourceError(code, message);
  }
}

export function assertExactKeys(value, allowed, code) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new GitHubPublicSourceError(code, "object contains an unsupported field");
    }
  }
}

export function invalidRequest(message) {
  throw new GitHubPublicSourceError("INVALID_REQUEST", message);
}

export function githubUnavailableMessage(resourceKind) {
  if (resourceKind === "repository") return "GitHub public repository is unavailable";
  if (resourceKind === "commit") return "GitHub commit is not reachable from the public repository";
  if (resourceKind === "tree") return "GitHub tree is not reachable from the public repository";
  if (resourceKind === "blob") return "GitHub declared blob is not reachable from the public repository";
  return "GitHub Actions run is not reachable from the public repository";
}
