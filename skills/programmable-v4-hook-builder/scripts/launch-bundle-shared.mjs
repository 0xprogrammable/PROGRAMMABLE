import crypto from "node:crypto";

import fs from "node:fs";

import path from "node:path";

import {
  DYNAMIC_FEE_FLAG,
  normalizeBytes20,
  normalizeBytes32
} from "./evm-encoding-core.mjs";

import { assertInsideRepository, spawnSafeGitSync } from "./repository-root.mjs";

import { canonicalJson } from "./submission-core.mjs";

import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

export const LAUNCH_BUNDLE_SCHEMA_VERSION = "1.0.0";
export const PROGRAMMABLE_FEE_RECIPIENT = "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
export const PROGRAMMABLE_FEE_POLICY_HASH = "0x72fea66c0711467846f805d8dbe08e5243460ef604cbf3c2626c011c0c0fdac6";
export const PROGRAMMABLE_PLATFORM_FEE_HUNDREDTHS_OF_BIP = 1000;
export const MAX_CALLDATA_BYTES = 128 * 1024;
export const MAX_CONFIGURATION_BYTES = 64 * 1024;
export const MAX_BOUND_FILE_BYTES = 100 * 1024 * 1024;

export const APPLICATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const COMPONENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const ACCEPTANCE_PATH = /^registry\/acceptances\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.-]*\.json$/u;
export const GITHUB_REPOSITORY = /^https:\/\/github\.com\/(?![^/]*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/(?!\.{1,2}$)(?!.*\.git$)(?=[a-z0-9._-]*[a-z0-9])[a-z0-9._-]{1,100}$/u;
export const OPAQUE_DECIMAL = /^[1-9][0-9]{0,63}$/u;
export const SHA1 = /^[0-9a-f]{40}$/u;
export const SHA256 = /^sha256:[0-9a-f]{64}$/u;
export const UTC_TIMESTAMP = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?Z$/u;
// Historical Launch Bundle V1 replay identity. Current Applicant transport is
// owned by registry-intake-contract.mjs and must not rewrite V1 receipts.
export const CANONICAL_REGISTRY_REPOSITORY = "https://github.com/0xprogrammable/programmable-registry";
export const submissionSchema = Object.freeze(JSON.parse(fs.readFileSync(new URL("../references/submission.schema.json", import.meta.url), "utf8")));

export class LaunchBundleError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "LaunchBundleError";
    this.code = code;
    this.details = details;
  }
}
export function readBoundFile(fileRef, label, roots, files, { tracked = fileRef.root === "source" || fileRef.root === "registry" } = {}) {
  const root = roots[fileRef.root];
  if (!root) invalid("FILE_ROOT_INVALID", `${label} selects an unavailable root`);
  let target;
  try {
    target = assertInsideRepository(root, path.resolve(root, fileRef.path));
  } catch (error) {
    invalid("FILE_PATH_INVALID", `${label}: ${error.message}`);
  }
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > MAX_BOUND_FILE_BYTES) invalid("FILE_INVALID", `${label} must be a nonempty bounded regular file`);
  const bytes = fs.readFileSync(target);
  const actualSha256 = sha256Bytes(bytes);
  if (actualSha256 !== fileRef.sha256) invalid("FILE_DIGEST_MISMATCH", `${label} bytes differ from ${fileRef.sha256}`);
  if (tracked) assertTrackedBytes(root, fileRef.path, bytes, label);
  files.push({ label, root: fileRef.root, path: fileRef.path, bytes: bytes.length, sha256: actualSha256, trackedAtBoundCommit: tracked });
  return { root: fileRef.root, path: fileRef.path, sha256: actualSha256, bytes, absolutePath: target };
}

export function parseFileRef(value, label, requiredRoot = null) {
  const input = exactObject(value, label, ["root", "path", "sha256"]);
  if (!new Set(["source", "evidence"]).has(input.root) && input.root !== "registry") invalid("FILE_ROOT_INVALID", `${label}.root is invalid`);
  if (requiredRoot !== null && input.root !== requiredRoot) invalid("FILE_ROOT_INVALID", `${label}.root must equal ${requiredRoot}`);
  const relativePath = canonicalRelativePath(input.path, `${label}.path`);
  const sha256 = requirePattern(input.sha256, `${label}.sha256`, SHA256, "a canonical lowercase SHA-256 label");
  return { root: input.root, path: relativePath, sha256 };
}

export function verifyGitIdentity(root, expectedCommit, expectedTree, expectedRepositoryUri, label) {
  const commit = git(root, ["rev-parse", "--verify", "HEAD^{commit}"], `${label} commit`);
  const tree = git(root, ["rev-parse", "--verify", "HEAD^{tree}"], `${label} tree`);
  if (commit !== expectedCommit || tree !== expectedTree) invalid("GIT_IDENTITY_MISMATCH", `${label} checkout does not match the bound commit and tree`);
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=no"], `${label} tracked status`, { allowEmpty: true });
  if (status !== "") invalid("GIT_TRACKED_CHANGES_PRESENT", `${label} checkout contains tracked changes`);
  const remote = canonicalGithubRemote(git(root, ["config", "--get", "remote.origin.url"], `${label} origin`));
  if (remote !== expectedRepositoryUri) invalid("GIT_ORIGIN_MISMATCH", `${label} origin ${remote} differs from ${expectedRepositoryUri}`);
  return { repositoryUri: remote, commit, tree, trackedWorktreeClean: true };
}

export function assertTrackedBytes(root, relativePath, bytes, label) {
  const result = spawnSafeGitSync(["-C", root, "show", `HEAD:${relativePath}`], { encoding: null, timeout: 10_000, maxBuffer: MAX_BOUND_FILE_BYTES + 1 });
  if (result.status !== 0 || result.error || !Buffer.isBuffer(result.stdout)) invalid("GIT_BLOB_MISSING", `${label} is not a readable blob at the bound commit`);
  if (!result.stdout.equals(bytes)) invalid("GIT_BLOB_MISMATCH", `${label} worktree bytes differ from the bound commit blob`);
}

export function git(root, args, label, { allowEmpty = false } = {}) {
  const result = spawnSafeGitSync(["-C", root, ...args], { encoding: "utf8", timeout: 10_000, maxBuffer: 1_000_000 });
  if (result.status !== 0 || result.error) invalid("GIT_COMMAND_FAILED", `${label} could not be read with inert local Git configuration`);
  const output = result.stdout.trim();
  if (!allowEmpty && output.length === 0) invalid("GIT_COMMAND_FAILED", `${label} returned no value`);
  return output;
}

export function canonicalGithubRemote(value) {
  let match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/iu.exec(value);
  if (!match) match = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/iu.exec(value);
  if (!match) match = /^ssh:\/\/git@github\.com\/([^/]+)\/(.+?)(?:\.git)?$/iu.exec(value);
  if (!match) invalid("GIT_ORIGIN_INVALID", "origin must identify one GitHub repository over HTTPS or SSH");
  const canonical = `https://github.com/${match[1].toLowerCase()}/${match[2].toLowerCase()}`;
  if (!GITHUB_REPOSITORY.test(canonical)) invalid("GIT_ORIGIN_INVALID", "origin is not a canonical GitHub repository identity");
  return canonical;
}

export function resolvePoolAsset(assetId, assets, role) {
  if (typeof assetId !== "string" || !assets.has(assetId)) invalid("POOL_ASSET_BINDING_MISSING", `${role} asset ${String(assetId)} has no exact post-acceptance address binding`);
  return assets.get(assetId);
}

export function derivePoolFee(lpFee) {
  const fee = requireObject(lpFee, "submission.pool.lpFee");
  if (fee.mode === "static" && Number.isInteger(fee.hundredthsOfBip) && fee.hundredthsOfBip >= 0 && fee.hundredthsOfBip <= 1_000_000) return fee.hundredthsOfBip;
  if (fee.mode === "dynamic") return DYNAMIC_FEE_FLAG;
  invalid("POOL_FEE_UNRESOLVED", "submission.pool.lpFee must bind a valid static fee or dynamic fee flag");
}

export function stripRegistry(value) {
  return {
    registryCommit: value.registryCommit,
    acceptancePath: value.acceptancePath,
    acceptanceSha256: value.acceptanceSha256,
    applicationId: value.applicationId,
    applicationRevision: value.applicationRevision,
    packageSha256: value.packageSha256
  };
}

export function stripSource(value) {
  return {
    numericRepositoryId: value.numericRepositoryId,
    repositoryUri: value.repositoryUri,
    revisionObjectId: value.revisionObjectId,
    treeObjectId: value.treeObjectId,
    reviewedSourceClosureHash: value.reviewedSourceClosureHash
  };
}

export function stripArtifact(value) {
  return {
    component: value.component,
    codeMode: value.codeMode,
    address: value.address,
    constructorArgsHash: value.constructorArgsHash,
    initCodeHash: value.initCodeHash,
    runtimeCodeHash: value.runtimeCodeHash
  };
}

export function jsonPointer(value, label) {
  if (typeof value !== "string" || !/^\/(?:[^~/]|~[01])+(?:\/(?:[^~/]|~[01])+)*$/u.test(value) || Buffer.byteLength(value, "utf8") > 1024) {
    invalid("JSON_POINTER_INVALID", `${label} must be a bounded RFC 6901 object pointer`);
  }
  return value;
}

export function resolveJsonPointer(value, pointer, label) {
  let current = value;
  for (const encoded of pointer.slice(1).split("/")) {
    const key = encoded.replace(/~1/gu, "/").replace(/~0/gu, "~");
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, key)) invalid("JSON_POINTER_MISSING", `${label} is missing at ${pointer}`);
    current = current[key];
  }
  if (typeof current !== "string") invalid("JSON_POINTER_VALUE_INVALID", `${label} at ${pointer} must be a hexadecimal string`);
  return current;
}

export function canonicalRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > 1024 || path.isAbsolute(value) || value.includes("\\") || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    invalid("FILE_PATH_INVALID", `${label} must be a bounded relative POSIX path`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..") || path.posix.normalize(value) !== value) invalid("FILE_PATH_INVALID", `${label} must be canonical and may not escape its root`);
  return value;
}

export function realDirectory(value, label) {
  try {
    const target = fs.realpathSync(path.resolve(value));
    if (!fs.statSync(target).isDirectory()) invalid("INVALID_ROOT", `${label} must be a real directory`);
    return target;
  } catch (error) {
    if (error instanceof LaunchBundleError) throw error;
    invalid("INVALID_ROOT", `${label} is unavailable`);
  }
}

export function rootsOverlap(left, right) {
  const leftToRight = path.relative(left, right);
  const rightToLeft = path.relative(right, left);
  return leftToRight === "" || (!leftToRight.startsWith(`..${path.sep}`) && leftToRight !== ".." && !path.isAbsolute(leftToRight))
    || (!rightToLeft.startsWith(`..${path.sep}`) && rightToLeft !== ".." && !path.isAbsolute(rightToLeft));
}

export function realFile(value, label, maximumBytes) {
  try {
    const target = fs.realpathSync(path.resolve(value));
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > maximumBytes) invalid("INVALID_PATH", `${label} must be a bounded regular file`);
    return target;
  } catch (error) {
    if (error instanceof LaunchBundleError) throw error;
    invalid("INVALID_PATH", `${label} is unavailable`);
  }
}

export function parseJson(bytes, label) {
  try {
    return parseBoundedStrictJsonBytes(bytes, {
      maxSourceBytes: MAX_BOUND_FILE_BYTES,
      maxDepth: 256,
      maxNodes: 250_000,
      maxNumberCharacters: MAX_BOUND_FILE_BYTES
    });
  } catch {
    invalid("JSON_INVALID", `${label} must be duplicate-free UTF-8 JSON`);
  }
}

export function digest32(value, label, { allowZero = false } = {}) {
  if (typeof value === "string" && SHA256.test(value)) value = `0x${value.slice(7)}`;
  try {
    return normalizeBytes32(value, label, { allowZero });
  } catch (error) {
    invalid("DIGEST_INVALID", error.message);
  }
}

export function shaLabelToBytes32(value) {
  return `0x${value.slice(7)}`;
}

export function gitBytes20(value, label) {
  requirePattern(value, label, SHA1, "a lowercase 40-character Git object id");
  return normalizeBytes20(`0x${value}`, label);
}

export function requirePattern(value, label, pattern, description) {
  if (typeof value !== "string" || !pattern.test(value)) invalid("BINDING_VALUE_INVALID", `${label} must be ${description}`);
  return value;
}

export function requireCanonicalTimestamp(value, label) {
  requirePattern(value, label, UTC_TIMESTAMP, "a canonical UTC timestamp");
  const epochMs = Date.parse(value);
  const seconds = value.slice(0, 19);
  if (!Number.isFinite(epochMs) || new Date(epochMs).toISOString().slice(0, 19) !== seconds) {
    invalid("BINDING_VALUE_INVALID", `${label} must be a real canonical UTC timestamp`);
  }
  return value;
}

export function requireBindingText(value, label, maximum) {
  if (typeof value !== "string" || value.trim().length < 12 || value.length > maximum) {
    invalid("LAUNCH_PLAN_INCOMPLETE", `${label} must contain a concrete reviewed rule from 12 through ${maximum} characters`);
  }
  return value;
}

export function requireBindingPaths(value, label, allowEmpty) {
  if (!Array.isArray(value) || value.length > 512 || (!allowEmpty && value.length === 0)) {
    invalid("LAUNCH_PLAN_INCOMPLETE", `${label} must contain ${allowEmpty ? "zero through 512" : "one through 512"} declared repository paths`);
  }
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 1_024 || seen.has(entry)) {
      invalid("LAUNCH_PLAN_INCOMPLETE", `${label}[${index}] must be a unique non-empty repository path`);
    }
    seen.add(entry);
  }
  return value;
}

export function exactObject(value, label, keys) {
  const input = requireObject(value, label);
  assertExactKeys(input, label, keys);
  return input;
}

export function requireObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid("BINDING_SHAPE_INVALID", `${label} must be a plain object`);
  return value;
}

export function assertExactKeys(value, label, expected) {
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) invalid("BINDING_SHAPE_INVALID", `${label} must contain exactly ${wanted.join(", ")}`);
}

export function sha256Bytes(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function invalid(code, message, details = null) {
  throw new LaunchBundleError(code, message, details);
}
