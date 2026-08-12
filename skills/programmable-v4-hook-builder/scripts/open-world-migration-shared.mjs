import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./submission-core.mjs";
import { spawnSafeRawGitSync } from "./repository-root.mjs";
import {
  ApplicationRecheckError,
  HISTORICAL_APPLICATION_FILES,
  sha256Bytes
} from "./open-world-migration-contract.mjs";

export const REVIEW_FILES = Object.freeze(HISTORICAL_APPLICATION_FILES.slice(1));
export const CANONICAL_JSON_FILES = new Set([
  "application.json",
  "compatibility-report.json",
  "evidence-index.json"
]);
export const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
export const FULL_GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
export const APPLICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const SAFE_REPOSITORY_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)[^\u0000]+$/u;
export const MAX_PACKAGE_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = 12 * 1024 * 1024;
export const MAX_SUBMISSION_BYTES = 4 * 1024 * 1024;
export const MAX_UINT256 = (1n << 256n) - 1n;

export function normalizeMigrationSourceRef(sourceRef, legacySubmission, canonicalDocumentSha256) {
  if (!isPlainObject(sourceRef)) {
    fail("MIGRATION_SOURCE_REF_INVALID", "sourceRef must be one exact source-binding object");
  }
  const repositoryPath = requireSafeRepositoryPath(sourceRef.path, "legacy submission path");
  const digest = requireSha256(sourceRef.sha256, "legacy submission SHA-256");
  if (!Number.isInteger(sourceRef.byteLength) || sourceRef.byteLength < 1 || sourceRef.byteLength > MAX_SUBMISSION_BYTES) {
    fail("MIGRATION_SOURCE_REF_INVALID", "sourceRef.byteLength is outside the bounded source contract");
  }
  const commit = sourceRef.commit ?? sourceRef.revisionObjectId;
  const tree = sourceRef.tree ?? sourceRef.treeObjectId;
  if (!FULL_GIT_OBJECT_PATTERN.test(commit ?? "") || !FULL_GIT_OBJECT_PATTERN.test(tree ?? "")) {
    fail("MIGRATION_SOURCE_REF_INVALID", "sourceRef must bind the exact full Git commit and tree");
  }
  if (
    sourceRef.canonicalDocumentSha256 !== undefined
    && sourceRef.canonicalDocumentSha256 !== canonicalDocumentSha256
  ) {
    fail("MIGRATION_SOURCE_REF_INVALID", "sourceRef canonical document SHA-256 does not match legacySubmission");
  }
  if (
    sourceRef.standardVersion !== undefined
    && sourceRef.standardVersion !== legacySubmission.standardVersion
  ) {
    fail("MIGRATION_SOURCE_REF_INVALID", "sourceRef standardVersion does not match legacySubmission");
  }
  const schemaId = sourceRef.schemaId ?? (
    typeof legacySubmission.$schema === "string" && legacySubmission.$schema.length > 0
      ? legacySubmission.$schema
      : null
  );
  if (schemaId !== null && (typeof schemaId !== "string" || schemaId.length > 500)) {
    fail("MIGRATION_SOURCE_REF_INVALID", "sourceRef.schemaId is invalid");
  }
  const repositoryUri = sourceRef.repositoryUri ?? null;
  if (repositoryUri !== null && (typeof repositoryUri !== "string" || repositoryUri.length < 1 || repositoryUri.length > 2048)) {
    fail("MIGRATION_SOURCE_REF_INVALID", "sourceRef.repositoryUri is invalid");
  }
  const numericRepositoryId = sourceRef.numericRepositoryId ?? null;
  if (numericRepositoryId !== null && !/^[1-9][0-9]{0,63}$/u.test(numericRepositoryId)) {
    fail("MIGRATION_SOURCE_REF_INVALID", "sourceRef.numericRepositoryId is invalid");
  }
  const applicationPackageSha256 = sourceRef.applicationPackageSha256 ?? null;
  if (applicationPackageSha256 !== null) {
    requireSha256(applicationPackageSha256, "historical application package SHA-256");
  }
  return Object.freeze({
    path: repositoryPath,
    sha256: digest,
    byteLength: sourceRef.byteLength,
    commit,
    tree,
    schemaId,
    repositoryUri,
    numericRepositoryId,
    applicationPackageSha256
  });
}

export function requireLegacyApplicationId(legacySubmission) {
  const applicationId = legacySubmission?.model?.id;
  if (!APPLICATION_ID_PATTERN.test(applicationId ?? "") || applicationId.length > 120) {
    fail("LEGACY_SUBMISSION_INVALID", "legacySubmission.model.id is not a canonical application id");
  }
  return applicationId;
}

export function legacyMigrationChainId(legacySubmission) {
  const chainId = legacySubmission?.target?.chainId;
  if (chainId === undefined || chainId === null) return "1";
  if (typeof chainId === "number") {
    if (!Number.isSafeInteger(chainId) || chainId < 1) {
      fail("LEGACY_SUBMISSION_INVALID", "legacy target.chainId is not an exact positive safe integer and cannot be migrated without rounding");
    }
    return String(chainId);
  }
  if (typeof chainId === "string" && /^(?:0|[1-9][0-9]*)$/u.test(chainId)) {
    const parsed = BigInt(chainId);
    if (parsed >= 1n && parsed <= MAX_UINT256) return chainId;
  }
  fail("LEGACY_SUBMISSION_INVALID", "legacy target.chainId is outside the canonical positive uint256 decimal-string domain");
}

export function normalizeLegacyPathList(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 4096) {
    fail("LEGACY_SUBMISSION_INVALID", `${label} is not a bounded path list`);
  }
  const normalized = value.map((entry) => requireSafeRepositoryPath(entry, label));
  if (new Set(normalized).size !== normalized.length) {
    fail("LEGACY_SUBMISSION_INVALID", `${label} contains duplicate paths`);
  }
  return normalized;
}

export function canonicalFileRecord(filePath, document) {
  const content = `${canonicalJson(document)}\n`;
  const bytes = Buffer.from(content, "utf8");
  return Object.freeze({
    path: filePath,
    content,
    byteLength: bytes.length,
    sha256: sha256Bytes(bytes)
  });
}

export function requireDirectory(value, label) {
  if (typeof value !== "string" || value.length < 1) fail("USAGE_ERROR", `${label} path is required`);
  const absolutePath = path.resolve(value);
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch {
    fail("PATH_INVALID", `${label} path is unavailable`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("PATH_INVALID", `${label} path must be a non-symlink directory`);
  }
  return absolutePath;
}

export function requireSafeRepositoryPath(value, label) {
  if (
    typeof value !== "string"
    || value.length < 1
    || !SAFE_REPOSITORY_PATH_PATTERN.test(value)
    || value !== path.posix.normalize(value)
    || value === "."
  ) {
    fail("SOURCE_BINDING_INVALID", `${label} is not a safe canonical repository-relative path`);
  }
  return value;
}

export function requireSha256(value, label) {
  if (!SHA256_PATTERN.test(value ?? "")) fail("DIGEST_INVALID", `${label} is invalid`);
  return value;
}

export function requireNonEmptyString(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > maxLength) {
    fail("APPLICATION_INVALID", `${label} must be a bounded non-empty string`);
  }
  return value;
}

export function runGitText(repositoryRoot, argumentsList, label) {
  const bytes = runGitBytes(repositoryRoot, argumentsList, label);
  const result = bytes.toString("utf8").trim();
  if (result.length < 1) fail("SOURCE_GIT_INVALID", `Git returned no ${label}`);
  return result;
}

export function runGitBytes(repositoryRoot, argumentsList, label) {
  const result = spawnSafeRawGitSync(["-C", repositoryRoot, ...argumentsList], {
    encoding: null,
    maxBuffer: MAX_SUBMISSION_BYTES + 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    fail("SOURCE_GIT_INVALID", `unable to read the exact ${label} from the local Git checkout`);
  }
  return result.stdout;
}

export function assertInside(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === "" || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    fail("SOURCE_BINDING_INVALID", `${label} escapes the source repository`);
  }
}

export function fileIdentity(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs ?? BigInt(Math.trunc(stat.mtimeMs * 1_000_000))}`;
}

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export function fail(code, message, details = null) {
  throw new ApplicationRecheckError(code, message, details);
}
