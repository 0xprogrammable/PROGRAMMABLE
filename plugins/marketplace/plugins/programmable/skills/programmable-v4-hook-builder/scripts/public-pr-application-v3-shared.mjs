import fs from "node:fs";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./submission-core.mjs";

export const PUBLIC_PR_APPLICATION_V3_REPORT_VERSION = "1.0.0";
export const PUBLIC_PR_APPLICATION_V3_REQUIRED_REVIEW_KINDS = Object.freeze([
  "proposal",
  "test-plan",
  "threat-model",
  "compatibility-report",
  "evidence-index",
  "idea-source",
  "intent-contract",
  "architecture-decisions",
  "intent-fidelity",
  "fee-policy-schema",
  "security-assessment-schema",
  "security-assessment"
]);
export const PUBLIC_PR_APPLICATION_V3_CAPTURE_STATUSES = Object.freeze([
  "captured-verbatim-public-safe",
  "redacted-sensitive",
  "unavailable-legacy"
]);
export const SOURCE_CLOSURE_MANIFEST_SCHEMA_ID = "urn:programmable:source-closure-manifest:1.0.0";
export const SOURCE_CLOSURE_MANIFEST_VERSION = "1.0.0";

export const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
export const sha256Pattern = /^sha256:(?!0{64}$)[0-9a-f]{64}$/u;
export const gitObjectPattern = /^[0-9a-f]{40}$/u;
export const positiveDecimalPattern = /^[1-9][0-9]*$/u;
export const githubRepositoryPattern = /^https:\/\/github\.com\/(?![^/]*--)[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}$)(?!.*\.git$)(?=[A-Za-z0-9._-]*[A-Za-z0-9])[A-Za-z0-9._-]{1,100}$/u;
const safeRepositoryPathPattern = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*(?:^|\/)\.git(?:\/|$))(?!.*\\)(?!.*(?:%2[fF]|%5[cC]))(?!.*\/$)[^\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+$/u;
const severityOrder = Object.freeze({ blocker: 0, review: 1 });
export const GIT_LFS_POINTER_INSPECTION_BYTES = 4096;

const rawGitSplitReviewCodes = new Set([
  "RAW_GIT_DEADLINE",
  "RAW_GIT_LIMIT_INVALID",
  "RAW_GIT_RESOURCE_LIMIT"
]);
const rawGitAvailabilityCodes = new Set([
  "RAW_GIT_OBJECT_MISSING",
  "RAW_GIT_OBJECT_READ_FAILED"
]);
const sourceManifestSplitReviewCodes = new Set([
  "SOURCE_MANIFEST_RESOURCE_LIMIT",
  "SOURCE_MANIFEST_WALL_TIME_LIMIT",
  "ENOBUFS",
  "ETIMEDOUT"
]);
const sourceManifestAvailabilityCodes = new Set([
  "SOURCE_MANIFEST_GIT_BATCH_EOF",
  "SOURCE_MANIFEST_GIT_OBJECT_MISSING",
  "SOURCE_MANIFEST_GIT_OBJECT_READ_FAILED",
  "SOURCE_MANIFEST_GIT_TREE_READ_FAILED",
  "EACCES",
  "ENOENT",
  "EPIPE",
  "EPERM"
]);

/** Keep bounded-tooling failures separate from integrity invalidity. */
export function classifyPublicPrApplicationV3RawGitFailure(error) {
  const integrityCode = typeof error?.code === "string" && /^RAW_GIT_[A-Z0-9_]+$/u.test(error.code)
    ? error.code
    : "RAW_GIT_INTEGRITY_FAILED";
  return Object.freeze({
    disposition: rawGitSplitReviewCodes.has(integrityCode)
      ? "split-review"
      : rawGitAvailabilityCodes.has(integrityCode)
        ? "availability"
        : "integrity-invalid",
    integrityCode
  });
}

export function classifyPublicPrApplicationV3SourceManifestFailure(error) {
  if (typeof error?.code === "string" && /^RAW_GIT_[A-Z0-9_]+$/u.test(error.code)) {
    return classifyPublicPrApplicationV3RawGitFailure(error);
  }
  const integrityCode = typeof error?.code === "string"
    ? error.code
    : "SOURCE_MANIFEST_LOCAL_VERIFICATION_FAILED";
  return Object.freeze({
    disposition: sourceManifestSplitReviewCodes.has(integrityCode)
      ? "split-review"
      : sourceManifestAvailabilityCodes.has(integrityCode)
        ? "availability"
        : "integrity-invalid",
    integrityCode
  });
}

export function sourceManifestReport(findings) {
  return finalizeReport("source-closure-manifest-v1-validation", findings, {
    schemaId: SOURCE_CLOSURE_MANIFEST_SCHEMA_ID,
    ideaEligibility: "ELIGIBLE_FOR_REVIEW",
    approvalGranted: false
  });
}

export function finalizeReport(kind, findings, fields) {
  findings.sort((left, right) => (
    severityOrder[left.severity] - severityOrder[right.severity]
    || left.code.localeCompare(right.code)
    || left.path.localeCompare(right.path)
    || left.message.localeCompare(right.message)
  ));
  const blockerCount = findings.filter(({ severity }) => severity === "blocker").length;
  const reviewCount = findings.filter(({ severity }) => severity === "review").length;
  return {
    kind,
    reportVersion: PUBLIC_PR_APPLICATION_V3_REPORT_VERSION,
    valid: blockerCount === 0,
    status: blockerCount === 0 ? "VALID" : "INVALID",
    counts: { blocker: blockerCount, review: reviewCount },
    findings,
    ...fields
  };
}

export function createFindingAdder(findings, seen) {
  return (severity, code, findingPath, message, remediation, classification, metadata = {}) => {
    const key = `${code}:${findingPath}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ severity, code, path: findingPath, message, remediation, classification, ...metadata });
  };
}

export function addFindingCopy(add, finding) {
  const { severity, code, path: findingPath, message, remediation, classification, ...metadata } = finding;
  add(
    severity,
    code,
    findingPath,
    message,
    remediation ?? "Correct the exact source-closure evidence and retry.",
    classification ?? "source-closure-binding",
    metadata
  );
}

export function cloneCanonicalJson(value) {
  try {
    return JSON.parse(canonicalJson(value));
  } catch {
    return null;
  }
}

export function safeRepositoryPath(value) {
  return typeof value === "string" && safeRepositoryPathPattern.test(value);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
