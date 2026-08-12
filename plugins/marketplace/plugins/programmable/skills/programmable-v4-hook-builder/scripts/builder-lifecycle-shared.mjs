import crypto from "node:crypto";
import { canonicalJson } from "./submission-core.mjs";

export const BUILDER_LIFECYCLE_SCHEMA_VERSION = "1.0.0";
export const BUNDLED_BUILDER_VERSION = "0.5.1";
export const BUNDLED_BUILDER_PUBLICATION_STATE = "unpublished-candidate";
export const NORMAL_RELEASE_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const SEMVER_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
export const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
export const FULL_GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
export const RELEASE_CHANNELS = new Set(["stable", "canary"]);
export const RELEASE_CHANGE_KINDS = new Set([
  "breaking-change",
  "bug-fix",
  "documentation",
  "feature",
  "maintenance",
  "security-advisory",
  "security-fix"
]);
export const SECURITY_CHANGE_KINDS = new Set(["security-advisory", "security-fix"]);
export const HOTFIX_SEVERITIES = new Set(["low", "medium", "high", "critical"]);
export const SEMANTIC_CLASSIFICATIONS = new Set(["major", "minor", "patch"]);
export const TEST_ONLY_PIN_PREFIX = "TEST-ONLY-";
export const TEST_ONLY_KEY_IDS = new Set([
  "56475aa75463474c0285df5dbf2bcab73da651358839e9b77481b2eab107708c"
]);
export const EXTERNAL_W5_REQUIREMENTS = Object.freeze([
  Object.freeze({
    id: "w5-candidate-bytes-and-visibility",
    statement: "Independently bind the exact candidate, source commit/tree/tag, artifact, and release-manifest bytes and verify repository visibility and publication state."
  }),
  Object.freeze({
    id: "w5-release-history-and-time",
    statement: "Authenticate complete public release history and obtain trusted time before deciding cadence."
  }),
  Object.freeze({
    id: "w5-artifact-bytes-and-digests",
    statement: "Read every referenced package, evidence, and communication artifact and verify its content digest."
  }),
  Object.freeze({
    id: "w5-owner-authority",
    statement: "Authenticate owner identity, release authority, candidate-intent approval, and any security-hotfix exception."
  }),
  Object.freeze({
    id: "w5-independent-release-review",
    statement: "Complete independent W5 reproducibility, review, canary, and exact external-action authorization gates."
  })
]);
export const PROTECTED_MIGRATION_SEGMENTS = Object.freeze({
  economics: new Set(["economics", "economic", "fee", "fees", "programmablefee", "rate", "rates", "tax", "taxes"]),
  wallet: new Set(["wallet", "wallets", "recipient", "recipients", "beneficiary", "beneficiaries", "owner", "owners"]),
  authority: new Set(["authority", "authorities", "role", "roles", "permission", "permissions", "admin", "admins"]),
  risk: new Set(["risk", "risks", "risktier", "riskdimensions", "threat", "threats"]),
  evidence: new Set(["evidence", "evidences", "receipt", "receipts", "proof", "proofs", "finding", "findings"])
});

export class BuilderLifecycleError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "BuilderLifecycleError";
    this.code = code;
    this.details = details;
  }
}

export function digestCanonical(value) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function parseSemver(value, location) {
  if (typeof value !== "string") invalid("VERSION_INVALID", `${location} must be semantic version text`);
  const match = SEMVER_PATTERN.exec(value);
  if (!match) invalid("VERSION_INVALID", `${location} must be a strict semantic version`);
  const prerelease = match[4] === undefined ? [] : match[4].split(".");
  for (const identifier of prerelease) {
    if (/^[0-9]+$/u.test(identifier) && identifier.length > 1 && identifier.startsWith("0")) invalid("VERSION_INVALID", `${location} contains a noncanonical prerelease number`);
  }
  return {
    text: value,
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease
  };
}

export function compareSemver(left, right) {
  for (const field of ["major", "minor", "patch"]) if (left[field] !== right[field]) return left[field] < right[field] ? -1 : 1;
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    if (left.prerelease[index] === right.prerelease[index]) continue;
    const leftNumeric = /^[0-9]+$/u.test(left.prerelease[index]);
    const rightNumeric = /^[0-9]+$/u.test(right.prerelease[index]);
    if (leftNumeric && rightNumeric) return BigInt(left.prerelease[index]) < BigInt(right.prerelease[index]) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return compareText(left.prerelease[index], right.prerelease[index]);
  }
  return 0;
}

export function compareSemverText(left, right) {
  const order = compareSemver(parseSemver(left, "semantic version"), parseSemver(right, "semantic version"));
  return order === 0 ? compareText(left, right) : order;
}

export function semanticClassification(from, to) {
  if (from.major !== to.major) return "major";
  if (from.minor !== to.minor) return "minor";
  return "patch";
}

export function compareDecimal(left, right) {
  requireDecimal(left, "left decimal");
  requireDecimal(right, "right decimal");
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
}

export function normalizeTimestamp(value, location) {
  const milliseconds = timestampMs(value, location);
  return new Date(milliseconds).toISOString().replace(".000Z", "Z");
}

export function timestampMs(value, location) {
  if (typeof value !== "string") {
    invalid("TIMESTAMP_INVALID", `${location} must be second-precision RFC 3339 with an explicit offset`);
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+-])(\d{2}):(\d{2}))$/u.exec(value);
  if (match === null) invalid("TIMESTAMP_INVALID", `${location} must be second-precision RFC 3339 with an explicit offset`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === "Z" ? 0 : Number(match[9]);
  const offsetMinute = match[7] === "Z" ? 0 : Number(match[10]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) {
    invalid("TIMESTAMP_INVALID", `${location} is not a real RFC 3339 instant`);
  }
  const localAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const localDate = new Date(localAsUtc);
  if (
    localDate.getUTCFullYear() !== year
    || localDate.getUTCMonth() !== month - 1
    || localDate.getUTCDate() !== day
    || localDate.getUTCHours() !== hour
    || localDate.getUTCMinutes() !== minute
    || localDate.getUTCSeconds() !== second
  ) invalid("TIMESTAMP_INVALID", `${location} is not a real RFC 3339 instant`);
  const offsetSign = match[8] === "-" ? -1 : 1;
  const offsetMs = offsetSign * ((offsetHour * 60) + offsetMinute) * 60 * 1_000;
  const milliseconds = localAsUtc - offsetMs;
  if (!Number.isFinite(milliseconds)) invalid("TIMESTAMP_INVALID", `${location} is not a real RFC 3339 instant`);
  return milliseconds;
}

export function requireSafeRelativePath(value, location) {
  requireText(value, location);
  if (
    value.startsWith("/")
    || value.includes("\\")
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) invalid("PATH_INVALID", `${location} must be a safe relative POSIX path`);
}

export function requireSafeGitTag(value, location) {
  requireText(value, location);
  if (
    value.length > 256
    || value === "@"
    || value.startsWith("/")
    || value.endsWith("/")
    || value.endsWith(".")
    || value.includes("..")
    || value.includes("@{")
    || /[\u0000-\u0020\u007f~^:?*\[\]\\]/u.test(value)
    || value.split("/").some((segment) => segment.length === 0 || segment.startsWith(".") || segment.endsWith(".lock"))
  ) invalid("RELEASE_CANDIDATE_INVALID", `${location} must be a canonical planned Git tag name`);
}

export function decodeCanonicalBase64Url(value, expectedBytes, location) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) invalid("BASE64URL_INVALID", `${location} must be unpadded base64url`);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== expectedBytes || bytes.toString("base64url") !== value) invalid("BASE64URL_INVALID", `${location} is not canonical ${expectedBytes}-byte base64url`);
  return bytes;
}

export function requireDecimal(value, location) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value)) invalid("DECIMAL_INVALID", `${location} must be a canonical unsigned decimal string`);
}

export function requireKeyId(value, location) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/u.test(value)) invalid("KEY_ID_INVALID", `${location} must be 64 lowercase hexadecimal characters`);
}

export function requireText(value, location) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 8_192) invalid("TEXT_INVALID", `${location} must be nonempty bounded text`);
}

export function requireOptionalText(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 8_192;
}

export function isJsonPointer(value) {
  return typeof value === "string" && (value === "" || /^(?:\/(?:[^~/]|~[01])*)+$/u.test(value));
}

export function assertPlainObject(value, location) {
  if (!isPlainObject(value)) invalid("OBJECT_INVALID", `${location} must be a plain JSON object`);
}

export function assertExactKeys(value, keys, location) {
  const actual = Object.keys(value).sort(compareText);
  const expected = [...keys].sort(compareText);
  if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) {
    invalid("OBJECT_KEYS_INVALID", `${location} has unsupported or missing fields`);
  }
}

export function invalid(code, message) {
  throw new BuilderLifecycleError(code, message);
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

export function deepEqual(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return canonicalJson(left) === canonicalJson(right);
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function escapePointer(value) {
  return value.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

export function compareText(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}
