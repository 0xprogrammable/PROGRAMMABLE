import {
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_INTAKE_STATUS_PATH,
  SUBMIT_LAUNCH_REPOSITORY,
  SUBMIT_LAUNCH_REPOSITORY_ID,
  SUBMIT_LAUNCH_REPOSITORY_NAME
} from "./registry-intake-contract.mjs";

export const GITHUB_APPLICATION_CLIENT_VERSION = "1.0.0-beta.1";
export const CENTRAL_REPOSITORY = SUBMIT_LAUNCH_REPOSITORY;
export const CENTRAL_REPOSITORY_ID = SUBMIT_LAUNCH_REPOSITORY_ID;
export const CENTRAL_REPOSITORY_NAME = SUBMIT_LAUNCH_REPOSITORY_NAME;
export const CENTRAL_BASE_BRANCH = SUBMIT_LAUNCH_BASE_BRANCH;
export const INTAKE_STATUS_PATH = SUBMIT_LAUNCH_INTAKE_STATUS_PATH;
export const PROGRAMMABLE_GITHUB_ACTIONS_APP_ID = "15368";
export const PROGRAMMABLE_GITHUB_ACTIONS_APP_SLUG = "github-actions";
export const PROGRAMMABLE_MAINTAINER_GITHUB_USER_ID = "309941960";
export const PROGRAMMABLE_MAINTAINER_GITHUB_LOGIN = "0xprogrammable";
export const REQUIRED_APPLICATION_CHECKS = Object.freeze(["public-intake", "Node 20", "Node 22"]);
export const CENTRAL_APPLICATION_FILES = Object.freeze([
  "application.json",
  "PROPOSAL.md",
  "TEST_PLAN.md",
  "THREAT_MODEL.md",
  "compatibility-report.json",
  "evidence-index.json"
]);
export const REQUIRED_UPDATE_APPLICATION_FILES = Object.freeze([
  "application.json",
  "compatibility-report.json",
  "evidence-index.json"
]);
export const GITHUB_APPLICATION_STATUSES = Object.freeze([
  "submitted",
  "checks-running",
  "changes-requested",
  "architecture-review",
  "review-in-progress",
  "waiting-review",
  "review-record-merged",
  "closed"
]);
export const APPLICATION_COMPATIBILITY_RESULTS = Object.freeze([
  "prototype-ready",
  "changes-required",
  "architecture-review-required",
  "tooling-blocked"
]);

export const APPLICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const BRANCH_PATTERN = /^(?!\/)(?!.*(?:\.\.|\/\/|@\{|\\|[\u0000-\u0020\u007f~^:?*\[]))[A-Za-z0-9._/-]{1,255}(?<![\/.])$/u;
export const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const GITHUB_LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
export const OPAQUE_DECIMAL_PATTERN = /^[1-9][0-9]{0,63}$/u;
export const REPOSITORY_SLUG_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/u;
export const MAX_PREPARED_BYTES = 2_000_000;
export const MAX_CENTRAL_PACKAGE_BYTES = 512 * 1024;
export const MAX_CENTRAL_FILE_BYTES = Object.freeze({
  "application.json": 64 * 1024,
  "compatibility-report.json": 160 * 1024,
  "evidence-index.json": 160 * 1024,
  "PROPOSAL.md": 64 * 1024,
  "THREAT_MODEL.md": 64 * 1024,
  "TEST_PLAN.md": 64 * 1024
});
export const MAX_API_OUTPUT_BYTES = 4_000_000;
export const MAX_API_INPUT_BYTES = 1_000_000;
export const MAX_API_RESPONSE_HEADER_BYTES = 64 * 1024;
export const DEFAULT_GET_ATTEMPTS = 3;
export const MAX_GET_ATTEMPTS = 5;
export const DEFAULT_GET_BACKOFF_MS = 100;
export const MAX_GET_BACKOFF_MS = 2_000;
export const MAX_GET_BACKOFF_TOTAL_MS = 4_000;
export const MAX_INTAKE_BYTES = 32_768;
export const MAX_RECEIPT_BYTES = 65_536;
export const MAX_SEARCH_RESULTS = 20;
export const PULL_FILES_PER_PAGE = 100;
export const MAX_PULL_FILES = 3000;
export const MAX_PULL_FILE_METADATA_BYTES = 4_000_000;
export const CHECK_RUNS_PER_PAGE = 100;
export const MAX_CHECK_RUNS = 1_000;
export const REVIEWS_PER_PAGE = 100;
export const MAX_REVIEWS = 1_000;
