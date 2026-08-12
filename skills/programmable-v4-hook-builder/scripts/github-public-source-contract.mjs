import { REVIEW_TARGET_CONTRACT_V1 } from "./review-target-contract.mjs";

export const GITHUB_PUBLIC_SOURCE_CONTRACT_V1 = Object.freeze({
  name: "GitHubPublicSourceContractV1",
  schemaVersion: "1.0.0",
  kind: "github-public-source",
  canonicalProviderOrigin: "https://github.com",
  apiOrigin: "https://api.github.com",
  githubApiVersion: "2026-03-10",
  userAgent: "programmable-github-public-source-v1",
  limits: Object.freeze({
    companions: 8,
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
  "GITHUB_ACTIONS_RUN_NOT_SUCCESSFUL",
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

const errorCodeSet = new Set(GITHUB_PUBLIC_SOURCE_ERROR_CODES_V1);

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
