import path from "node:path";

import { CliFailure } from "./cli-runtime.mjs";

export const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const MODEL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const REMOTE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
export const SAFE_BRANCH_PATTERN = /^(?!\/)(?!.*(?:\.\.|\/\/|@\{|\\|[\u0000-\u0020\u007f~^:?*\[]))[A-Za-z0-9._\/-]{1,255}(?<![\/.])$/;
export const REVIEW_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
export const MAX_COMPANION_MANIFESTS = 8;
export const MAX_COMPANION_MANIFEST_BYTES = 65_536;

export function relativeRepositoryPath(repositoryRoot, target) {
  const relative = path.relative(repositoryRoot, target).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative) || containsUnsafeText(relative)) {
    throw new CliFailure("INVALID_PATH", "submission package path is not repository-relative");
  }
  return relative;
}

export function toHex32(digest) {
  if (!DIGEST_PATTERN.test(digest ?? "")) {
    throw new CliFailure("PACKAGE_INVALID", "application adapter requires an exact SHA-256 digest");
  }
  return `0x${digest.slice("sha256:".length)}`;
}

export function requireCommit(value, label) {
  if (!COMMIT_PATTERN.test(value)) {
    throw new CliFailure("GIT_STATE_INVALID", `${label} is not an exact 40-character Git object id`, { exitCode: 1 });
  }
  return value;
}

export function requireSafeBranch(value, label) {
  if (!SAFE_BRANCH_PATTERN.test(value ?? "") || value.endsWith(".lock")) {
    throw new CliFailure("GIT_STATE_INVALID", `${label} is not a supported Git branch name`, { exitCode: 1 });
  }
  return value;
}

export function containsUnsafeText(value) {
  return typeof value !== "string"
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
