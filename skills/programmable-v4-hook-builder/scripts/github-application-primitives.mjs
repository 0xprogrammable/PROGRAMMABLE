import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { canonicalJson } from "./submission-core.mjs";
import { hasForbiddenInvisibleOrBidi } from "./metadata-core.mjs";

import {
  APPLICATION_ID_PATTERN,
  BRANCH_PATTERN,
  COMMIT_PATTERN,
  DIGEST_PATTERN,
  GITHUB_LOGIN_PATTERN,
  OPAQUE_DECIMAL_PATTERN,
  REPOSITORY_SLUG_PATTERN
} from "./github-application-constants.mjs";
import { SUBMIT_LAUNCH_REPOSITORY_URL } from "./registry-intake-contract.mjs";

const submitLaunchPullUrl = new RegExp(
  `^${escapeRegex(SUBMIT_LAUNCH_REPOSITORY_URL)}/pull/[1-9][0-9]*$`,
  "u"
);
const submitLaunchCheckUrl = new RegExp(
  `^${escapeRegex(SUBMIT_LAUNCH_REPOSITORY_URL)}/actions/runs/[1-9][0-9]{0,63}(?:/job/[1-9][0-9]{0,63})?$`,
  "u"
);

export class GitHubApplicationError extends Error {
  constructor(code, message, { exitCode = 1, details = null } = {}) {
    super(sanitizeMessage(message));
    this.name = "GitHubApplicationError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function normalizeApiId(value, label) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) fail("GITHUB_OUTPUT_INVALID", `${label} is not a lossless positive integer`);
    return String(value);
  }
  if (typeof value === "string" && OPAQUE_DECIMAL_PATTERN.test(value)) return value;
  fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
}

export function normalizeOptionalPullNumber(value) {
  return value === null || value === undefined ? null : Number(apiPullNumber(value));
}

export function normalizeNullableRevision(value) {
  return value === null || value === undefined ? null : requireRevision(value, "prior application revision");
}

export function requireRevision(value, label) {
  return requireBoundedInteger(value, label, 1, 1_000_000);
}

export function requireBoundedInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) invalidPrepared(`${label} is outside its allowed range`);
  return value;
}

export function requireOpaqueDecimal(value, label) {
  if (typeof value !== "string" || !OPAQUE_DECIMAL_PATTERN.test(value)) invalidPrepared(`${label} is malformed`);
  return value;
}

export function requireApplicationId(value, label) {
  if (typeof value !== "string" || value.length > 80 || !APPLICATION_ID_PATTERN.test(value)) invalidPrepared(`${label} is malformed`);
  return value;
}

export function requireRepositorySlug(value, label) {
  if (typeof value !== "string" || !REPOSITORY_SLUG_PATTERN.test(value) || hasForbiddenInvisibleOrBidi(value)) {
    fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  }
  return value;
}

export function requireGitHubLogin(value, label) {
  if (typeof value !== "string" || !GITHUB_LOGIN_PATTERN.test(value)) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

export function requireBranch(value, label) {
  if (typeof value !== "string" || !BRANCH_PATTERN.test(value)) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

export function requireCommit(value, label) {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

export function requireDigest(value, label) {
  if (typeof value !== "string" || !DIGEST_PATTERN.test(value)) fail("RECEIPT_INVALID", `${label} is malformed`);
  return value;
}

export function requireBoolean(value, label) {
  if (typeof value !== "boolean") fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

export function requireBoundedText(value, label, maximumBytes, { allowEmpty = false } = {}) {
  if (
    typeof value !== "string"
    || (!allowEmpty && value.length === 0)
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || hasForbiddenInvisibleOrBidi(value)
    || value.normalize("NFC") !== value
  ) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

export function requireBoundedMultilineText(value, label, maximumBytes, { allowEmpty = false } = {}) {
  if (
    typeof value !== "string"
    || (!allowEmpty && value.length === 0)
    || Buffer.byteLength(value, "utf8") > maximumBytes
    || hasForbiddenInvisibleOrBidi(value.replaceAll("\n", ""))
    || value.includes("\r")
    || value.normalize("NFC") !== value
  ) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

export function requireApiInteger(value, label, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail("GITHUB_OUTPUT_INVALID", `${label} is outside its allowed range`);
  }
  return value;
}

export function requireApiObject(value, label) {
  if (!isPlainObject(value)) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

export function requireIsoTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value)) {
    fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  }
  return value;
}

export function requireGitHubRepositoryUrl(value, slug) {
  if (value !== `https://github.com/${slug}`) fail("GITHUB_OUTPUT_INVALID", "GitHub repository URL is noncanonical");
  return value;
}

export function requireGitHubUserUrl(value, login) {
  if (value !== `https://github.com/${login}`) fail("GITHUB_OUTPUT_INVALID", "GitHub user URL is noncanonical");
  return value;
}

export function requirePullUrl(value) {
  if (typeof value !== "string" || !submitLaunchPullUrl.test(value)) {
    fail("GITHUB_OUTPUT_INVALID", "pull-request URL is noncanonical");
  }
  return value;
}

export function requireCheckDetailsUrl(value) {
  if (
    typeof value !== "string"
    || !submitLaunchCheckUrl.test(value)
  ) {
    fail("GITHUB_OUTPUT_INVALID", "check-run details URL is noncanonical");
  }
  return value;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function requireRepositoryPath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.startsWith("/")
    || value.endsWith("/")
    || value.includes("\\")
    || value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
    || hasForbiddenInvisibleOrBidi(value)
    || value.normalize("NFC") !== value
  ) fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  return value;
}

export function requireObject(value, label) {
  if (!isPlainObject(value)) invalidPrepared(`${label} is malformed`);
  return value;
}

export function resolveRegularFile(value, label) {
  if (typeof value !== "string" || value.length === 0 || hasForbiddenInvisibleOrBidi(value)) {
    fail("INVALID_PATH", `${label} path is invalid`, { exitCode: 2 });
  }
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isFile()) {
    fail("INVALID_PATH", `${label} must be an existing regular file`, { exitCode: 2 });
  }
  const real = fs.realpathSync(absolute);
  assertNoSymlinkComponents(real);
  return real;
}

export function resolveDirectory(value, label) {
  if (typeof value !== "string" || value.length === 0 || hasForbiddenInvisibleOrBidi(value)) {
    fail("INVALID_PATH", `${label} path is invalid`, { exitCode: 2 });
  }
  const absolute = path.resolve(value);
  if (!fs.existsSync(absolute) || fs.lstatSync(absolute).isSymbolicLink() || !fs.statSync(absolute).isDirectory()) {
    fail("INVALID_PATH", `${label} must be an existing directory`, { exitCode: 2 });
  }
  const real = fs.realpathSync(absolute);
  assertNoSymlinkComponents(real);
  return real;
}

export function assertNoSymlinkComponents(target) {
  const parsed = path.parse(target);
  let current = parsed.root;
  for (const segment of target.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) fail("INVALID_PATH", "symbolic path components are not allowed");
  }
}

export function pathsOverlap(left, right) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  const contains = (relative) => relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  return contains(leftToRight) || contains(rightToLeft);
}

export function apiSlug(value) {
  return requireRepositorySlug(value, "GitHub repository").split("/").map(encodeURIComponent).join("/");
}

export function apiCommit(value) {
  return requireCommit(value, "GitHub commit");
}

export function apiOpaqueDecimal(value, label) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,63}$/u.test(value)) {
    fail("GITHUB_OUTPUT_INVALID", `${label} is malformed`);
  }
  return value;
}

export function apiRepositoryPath(value) {
  return requireRepositoryPath(value, "GitHub repository path").split("/").map(encodeURIComponent).join("/");
}

export function apiPullNumber(value) {
  const string = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof string !== "string" || !/^[1-9][0-9]{0,9}$/u.test(string)) {
    fail("GITHUB_OUTPUT_INVALID", "pull-request number is malformed");
  }
  return string;
}

export function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  return arraysEqual(Object.keys(value).sort(compareUtf8), [...keys].sort(compareUtf8));
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function arraysEqual(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export function uniqueStrings(values) {
  return [...new Set(values)];
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

export function sanitizeMessage(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1_000);
}

export function invalidPrepared(message) {
  fail("PREPARED_RESULT_INVALID", message);
}

export function fail(code, message, options = {}) {
  throw new GitHubApplicationError(code, message, options);
}

export function assertTransport(transport) {
  const methods = [
    "getViewer", "getRepository", "getGitCommit", "getRef", "getContent",
    "listPullsByHead", "searchOpenPulls", "getPull", "getPullFiles",
    "getPullReviews", "getCheckRuns", "compareBranch", "createFork", "createTree", "createCommit",
    "createRef", "updateRef", "createDraftPull", "updatePull"
  ];
  if (!isPlainObject(transport) || methods.some((method) => typeof transport[method] !== "function")) {
    throw new TypeError("transport does not implement the GitHub application contract");
  }
}

export function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
