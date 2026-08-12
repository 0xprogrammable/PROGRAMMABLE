import crypto from "node:crypto";
import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError,
  isCanonicalGitHubRepositoryPathV1
} from "./github-public-source-core.mjs";
import {
  ContractResolutionError,
  LOWER_HEX_40,
  OPAQUE_DECIMAL
} from "./resolve-contract-definitions.mjs";

export function artifactEvidence({ role, entry, bytes, selection, expectedSha256, manifestBound }) {
  return {
    role,
    path: entry.path,
    gitObjectId: entry.objectId,
    gitMode: entry.mode,
    byteLength: bytes.length,
    sha256: sha256(bytes),
    expectedSha256,
    digestMatched: expectedSha256 === null ? null : expectedSha256 === sha256(bytes),
    selection,
    manifestBound,
    activeAuthorityInferred: false
  };
}

export function treeDiscovery(entry) {
  return {
    path: entry.path,
    gitObjectId: entry.objectId,
    gitMode: entry.mode,
    byteLength: entry.size
  };
}

export function normalizeFailure(error) {
  if (error instanceof ContractResolutionError) {
    return failure(error.code, error.message, {
      kind: error.kind,
      retryable: error.retryable,
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds
    });
  }
  if (error instanceof GitHubPublicSourceError) {
    return failure(error.code, safeGitHubErrorMessage(error.code), {
      kind: "transport",
      retryable: error.retryable,
      status: error.status,
      retryAfterSeconds: error.retryAfterSeconds
    });
  }
  return failure("RESOLVER_INTERNAL_ERROR", "The contract resolver failed without a safe external diagnostic.", {
    kind: "tooling",
    retryable: false
  });
}

export function safeGitHubErrorMessage(code) {
  const messages = {
    GITHUB_REDIRECT_REJECTED: "GitHub redirects are not followed.",
    GITHUB_RATE_LIMITED: "GitHub anonymous API rate limiting blocked resolution.",
    GITHUB_RESPONSE_TOO_LARGE: "GitHub response exceeded its byte limit.",
    GITHUB_TIMEOUT: "GitHub contract resolution timed out."
  };
  return messages[code] ?? "The anonymous GitHub request failed.";
}

export function failure(code, message, options = {}) {
  return {
    kind: options.kind ?? "transport",
    code,
    message,
    retryable: options.retryable === true,
    status: options.status ?? null,
    retryAfterSeconds: options.retryAfterSeconds ?? null
  };
}

export function unresolved(code, message, details = {}) {
  return { code, message, ...details };
}

export function apiPrefix(target) {
  return `${GITHUB_PUBLIC_SOURCE_CONTRACT_V1.apiOrigin}/repos/${target.owner}/${target.repository}`;
}

export function normalizeRepositoryHtmlUrl(value, target) {
  if (typeof value !== "string") throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub repository URL is invalid.", { kind: "transport" });
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub repository URL is invalid.", { kind: "transport" });
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "https:"
    || url.hostname !== "github.com"
    || url.port !== ""
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || segments.length !== 2
    || segments[0].toLowerCase() !== target.owner
    || segments[1].toLowerCase() !== target.repository
  ) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub repository URL is invalid.", { kind: "transport" });
  }
  return target.repositoryUri;
}

export function normalizeRemotePath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 1024
    || unsafeText(value)
    || !isCanonicalGitHubRepositoryPathV1(value)
  ) {
    throw new TypeError(`${label} must be a canonical bounded repository path`);
  }
  return value;
}

export function normalizeDefaultBranch(value, { source = "manifest" } = {}) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 255
    || unsafeText(value)
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("//")
    || value.includes("..")
    || /[\\ ~^:?*[\]]/u.test(value)
    || value.endsWith(".")
    || value.endsWith(".lock")
  ) {
    if (source === "github") {
      throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub repository default branch is invalid.", {
        kind: "transport"
      });
    }
    throw new TypeError("repository default branch is invalid");
  }
  return value;
}

export function normalizeObjectId(value, label) {
  if (!LOWER_HEX_40.test(value ?? "")) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", `${label} is not a lowercase 40-hex Git object id.`, {
      kind: "transport"
    });
  }
  return value;
}

export function normalizeOpaqueDecimal(value, label) {
  const source = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string"
      ? value
      : isLosslessNumber(value)
        ? value.source
        : null;
  if (source === null || !OPAQUE_DECIMAL.test(source)) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", `${label} is not a bounded decimal id.`, {
      kind: "transport"
    });
  }
  return source;
}

export function normalizeSafeInteger(value, label, maximum) {
  const source = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string"
      ? value
      : isLosslessNumber(value)
        ? value.source
        : null;
  if (source === null || !/^(?:0|[1-9][0-9]{0,15})$/u.test(source)) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", `${label} is invalid.`, { kind: "transport" });
  }
  const normalized = Number(source);
  if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > maximum) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", `${label} is invalid.`, { kind: "transport" });
  }
  return normalized;
}

export function decodeStrictBase64(value, maximumBytes) {
  if (typeof value !== "string") throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub blob encoding is invalid.", { kind: "transport" });
  const compact = value.replace(/[\r\n]/gu, "");
  if (
    compact.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(compact)
  ) {
    throw new ContractResolutionError("GITHUB_PROTOCOL_ERROR", "GitHub blob base64 is invalid.", { kind: "transport" });
  }
  const bytes = Buffer.from(compact, "base64");
  if (bytes.length > maximumBytes) throw new ContractResolutionError("GITHUB_RESPONSE_TOO_LARGE", "GitHub blob exceeded its byte limit.", { kind: "transport" });
  return bytes;
}

export function gitBlobObjectId(bytes) {
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`, "utf8").update(bytes).digest("hex");
}

export function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function normalizeRetryAfter(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,5})$/u.test(value)) return null;
  return Number(value);
}

export function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has unexpected fields`);
  }
}

export function unsafeText(value) {
  return /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function isLosslessNumber(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === 1
    && Object.hasOwn(value, "source")
    && typeof value.source === "string";
}

export function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
