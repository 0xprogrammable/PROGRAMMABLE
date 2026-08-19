import { SUBMIT_LAUNCH_REPOSITORY_ID } from "./registry-intake-contract.mjs";

export {
  CANONICAL_POSITIVE_UINT256_DECIMAL_PATTERN_V2 as positiveDecimalPattern,
  FEE_POLICY_V2_HASH as PROGRAMMABLE_FEE_POLICY_HASH,
  FEE_POLICY_V2_ID as PROGRAMMABLE_FEE_POLICY_ID,
  FEE_POLICY_V2_VERSION as PROGRAMMABLE_FEE_POLICY_VERSION,
  PROGRAMMABLE_FEE_V2_OWNER as PROGRAMMABLE_FEE_OWNER
} from "./fee-policy-v2-contract.mjs";

export const REGISTRY_ACCEPTANCE_V3_GITHUB_VERIFIER = "builder-github-rest-raw-git-v1";
export const REGISTRY_ACCEPTANCE_V3_GITHUB_INSPECTOR = "builder-github-rest-raw-git-v1-inspection-only";
export const REGISTRY_ACCEPTANCE_V3_TRUST_MAX_AGE_MS = 5 * 60 * 1000;
export const REGISTRY_ACCEPTANCE_V3_GITHUB_DEADLINE_MS = 120_000;

export const REGISTRY_NUMERIC_ID = SUBMIT_LAUNCH_REPOSITORY_ID;
export const REGISTRY_BASE_REF = "main";
export const MAINTAINER_USER_ID = "309941960";
export const API_ORIGIN = "https://api.github.com";
export const MAX_API_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_PACKAGE_FILES = 512;
export const MAX_PACKAGE_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_TREE_NODES = 4096;
export const MAX_CHANGE_SET_TREE_NODES = 8192;
export const MAX_REVIEW_PAGES = 10;
export const MAX_GITHUB_REQUESTS = 1100;
export const MAX_GITHUB_RESPONSE_BYTES = 96 * 1024 * 1024;
export const MAX_PACKAGE_TOTAL_BYTES = 16 * 1024 * 1024;
export const MAX_ACCEPTANCE_BYTES = 256 * 1024;
export const MAX_REGISTRY_INDEX_BYTES = 2 * 1024 * 1024;
export const MAX_REGISTRY_PROJECT_BYTES = 128 * 1024;
export const MAX_REGISTRY_RECORDS = 10_000;
export const REGISTRY_INDEX_SCHEMA_VERSION = "1.1.0";
export const REGISTRY_PROJECT_SCHEMA_VERSION = "1.1.0";
export const LAUNCH_ELIGIBLE_PROJECT_STATUSES = new Set(["accepted", "deployed", "available"]);
export const REGISTRY_INDEX_RECORD_KEYS = Object.freeze([
  "acceptancePath",
  "acceptanceSha256",
  "capabilities",
  "id",
  "kind",
  "name",
  "path",
  "sha256",
  "status",
  "summary",
  "surfaces",
  "tags"
]);
export const REGISTRY_PROJECT_KEYS = Object.freeze([
  "capabilities",
  "chains",
  "discovery",
  "economics",
  "hook",
  "id",
  "kind",
  "name",
  "provenance",
  "relations",
  "review",
  "schemaVersion",
  "source",
  "status",
  "statusUpdatedAt",
  "summary",
  "surfaces",
  "warnings"
]);
export const GITHUB_API_VERSION = "2026-03-10";
export const REGISTRY_ACCEPTANCE_V3_GITHUB_LIMITS = Object.freeze({
  githubApiVersion: GITHUB_API_VERSION,
  maxApiJsonBytes: MAX_API_JSON_BYTES,
  maxDeadlineMs: REGISTRY_ACCEPTANCE_V3_GITHUB_DEADLINE_MS,
  maxPackageFileBytes: MAX_PACKAGE_FILE_BYTES,
  maxPackageFiles: MAX_PACKAGE_FILES,
  maxPackageTotalBytes: MAX_PACKAGE_TOTAL_BYTES,
  maxRequests: MAX_GITHUB_REQUESTS,
  maxResponseBytes: MAX_GITHUB_RESPONSE_BYTES,
  maxReviewBodyBytes: 64 * 1024
});

export const sha1Pattern = /^[0-9a-f]{40}$/u;
export const pullNumberPattern = /^[1-9][0-9]{0,9}$/u;
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const safePathPattern = /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*\\)[^\u0000-\u001f\u007f-\u009f]+$/u;
