import crypto from "node:crypto";
import path from "node:path";
import { TextDecoder } from "node:util";
import { canonicalJson } from "./submission-core.mjs";

export const SOURCE_MANIFEST_CLI_VERSION = "1.0.0";
export const SOURCE_MANIFEST_CLI_SCHEMA_ID = "urn:programmable:source-manifest-cli-report:1.0.0";
export const SOURCE_MANIFEST_EXIT = Object.freeze({
  READY: 0,
  HELD: 1,
  USAGE_OR_INPUT: 2
});

export const ROOT_MANIFEST_NAME = "source-closure-manifest.v1.json";
export const FRAGMENT_NAME_PREFIX = "source-fragment-";
export const FRAGMENT_NAME_SUFFIX = ".jsonl";
export const DEFAULT_ROLE_ID = "source";
export const SAFE_REPOSITORY_PATH = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*(?:^|\/)\.git(?:\/|$))(?!.*\\)(?!.*(?:%2[fF]|%5[cC]))(?!.*\/$)[^\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+$/u;
export const ROLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const GITHUB_REPOSITORY_URI = /^https:\/\/github\.com\/(?![^/]*--)[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/(?!\.{1,2}$)(?!.*\.git$)(?=[a-z0-9._-]*[a-z0-9])[a-z0-9._-]{1,100}$/u;
export const NUMERIC_REPOSITORY_ID = /^[1-9][0-9]{0,63}$/u;
export const FULL_SHA1_OBJECT_ID = /^[0-9a-f]{40}$/u;
export const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });

export const DEFAULT_LIMITS = Object.freeze({
  maxEntries: 1_000_000,
  maxTreeInstances: 1_000_000,
  maxTreeObjectBytes: 64 * 1024 * 1024,
  maxRepositoryPathBytes: 16 * 1024,
  maxSourceBlobBytes: 64 * 1024 * 1024,
  maxTotalSourceBytes: 16 * 1024 * 1024 * 1024,
  maxGitBatchOutputBytes: 96 * 1024 * 1024,
  maxRootManifestBytes: 64 * 1024 * 1024,
  maxOutputBytes: 2 * 1024 * 1024 * 1024,
  maxWallTimeMs: 15 * 60 * 1000,
  gitTimeoutMs: 30 * 1000,
  blobBatchSize: 256,
  chunkMaxEntries: 2048,
  chunkMaxBytes: 4 * 1024 * 1024
});

export class SourceManifestError extends Error {
  constructor(code, message, { exitCode = SOURCE_MANIFEST_EXIT.USAGE_OR_INPUT, details = null } = {}) {
    super(safeMessage(message));
    this.name = "SourceManifestError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function sourceManifestHelp() {
  return `Programmable source-closure manifest v1 generator

Usage:
  open-world source-manifest \\
    --repo-root <exact-git-root> \\
    --output-dir <new-repository-relative-directory> \\
    --repository-uri <https://github.com/owner/repository> \\
    --numeric-repository-id <github-numeric-id> \\
    [--required-role <repository-path>=<role-id>]... \\
    [--chunk-max-entries <count>] \\
    [--chunk-max-bytes <bytes>] \\
    [--write | --dry-run]

The default is a read-only dry run. It reads only raw objects from the exact
current HEAD, never reads candidate worktree file contents, never applies Git
attributes or LFS filters, and never runs hooks, submodules, project code, or
network commands. --write atomically creates one previously absent directory
inside the selected repository; it never overwrites an existing path.

Every regular blob receives the neutral role "source". Repeat --required-role
to add exact, open role IDs such as contract, frontend, game-server, or proof.
The mapped path must exist as a blob in the pinned tree. Gitlinks stay outside
the blob-entry schema and are retained separately with their exact path, mode,
and commit object ID so the application can bind a companion closure.

Manifest v1 currently binds 40-hex SHA-1 Git objects and UTF-8 repository paths.
Another object format or path encoding is reported as integration pending and
never rejects the product idea. Repository size and path-byte budgets produce a
split-review hold; they are tooling limits, not category or idea filters.

Workflow after --write:
  1. Review the generated metadata and keep source files unchanged.
  2. Commit the new metadata directory.
  3. Bind the new commit/tree and root-manifest blob in Application V3.
  4. Run the raw-Git source-closure verifier at that exact new commit.

Options:
  --repo-root <path>                 Exact local non-bare Git worktree root.
  --output-dir <path>                New safe repository-relative directory with an existing real parent.
  --repository-uri <uri>             Canonical lowercase public GitHub repository URI.
  --numeric-repository-id <digits>   Stable GitHub numeric repository ID; never inferred via network.
  --required-role <path>=<role-id>   Add a required role to an exact source path; repeat as needed.
  --chunk-max-entries <count>        Deterministic positive fragment entry ceiling (default 2048).
  --chunk-max-bytes <bytes>          Deterministic fragment byte ceiling (default 4194304).
  --write                             Materialize the verified plan through an atomic directory rename.
  --dry-run                           State the default read-only mode explicitly.
  --version                           Print the generator version.
  -h, --help                          Show this help.
`;
}

export function parseSourceManifestCliArgs(argvValue) {
  const argv = Array.isArray(argvValue) ? argvValue : [];
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    if (argv.length > 0 && argv.some((argument) => !["--help", "-h"].includes(argument))) {
      throw usageError("HELP_ARGUMENT_CONFLICT", "--help cannot be combined with another argument");
    }
    return { action: "help" };
  }
  if (argv.length === 1 && argv[0] === "--version") return { action: "version" };

  const definitions = new Map([
    ["--repo-root", { key: "repositoryRoot", repeatable: false }],
    ["--output-dir", { key: "outputDirectory", repeatable: false }],
    ["--repository-uri", { key: "repositoryUri", repeatable: false }],
    ["--numeric-repository-id", { key: "numericRepositoryId", repeatable: false }],
    ["--required-role", { key: "requiredRoles", repeatable: true }],
    ["--chunk-max-entries", { key: "chunkMaxEntries", repeatable: false }],
    ["--chunk-max-bytes", { key: "chunkMaxBytes", repeatable: false }]
  ]);
  const options = {
    action: "generate",
    repositoryRoot: null,
    outputDirectory: null,
    repositoryUri: null,
    numericRepositoryId: null,
    requiredRoles: [],
    chunkMaxEntries: null,
    chunkMaxBytes: null,
    write: false,
    dryRun: false
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--write" || token === "--dry-run") {
      if (seen.has(token)) throw usageError("ARGUMENT_DUPLICATE", `${token} may be supplied only once`);
      seen.add(token);
      options[token === "--write" ? "write" : "dryRun"] = true;
      continue;
    }
    const separator = typeof token === "string" ? token.indexOf("=") : -1;
    const name = separator === -1 ? token : token.slice(0, separator);
    const definition = definitions.get(name);
    if (!definition) throw usageError("ARGUMENT_UNKNOWN", `unknown argument ${String(name)}`);
    if (!definition.repeatable && seen.has(name)) {
      throw usageError("ARGUMENT_DUPLICATE", `${name} may be supplied only once`);
    }
    seen.add(name);
    const value = separator === -1 ? argv[index + 1] : token.slice(separator + 1);
    if (separator === -1) index += 1;
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw usageError("ARGUMENT_VALUE_MISSING", `${name} requires a value`);
    }
    if (definition.repeatable) options[definition.key].push(value);
    else options[definition.key] = value;
  }
  for (const [flag, key] of [
    ["--repo-root", "repositoryRoot"],
    ["--output-dir", "outputDirectory"],
    ["--repository-uri", "repositoryUri"],
    ["--numeric-repository-id", "numericRepositoryId"]
  ]) {
    if (options[key] === null) throw usageError("ARGUMENT_REQUIRED", `missing required argument ${flag}`);
  }
  if (options.write && options.dryRun) {
    throw usageError("WRITE_MODE_CONFLICT", "--write and --dry-run are mutually exclusive");
  }
  options.requiredRoleMappings = options.requiredRoles.map(parseRequiredRoleMapping);
  options.chunkMaxEntries = options.chunkMaxEntries === null
    ? DEFAULT_LIMITS.chunkMaxEntries
    : parsePositiveInteger(options.chunkMaxEntries, "--chunk-max-entries", 1_000_000);
  options.chunkMaxBytes = options.chunkMaxBytes === null
    ? DEFAULT_LIMITS.chunkMaxBytes
    : parsePositiveInteger(options.chunkMaxBytes, "--chunk-max-bytes", 64 * 1024 * 1024);
  delete options.requiredRoles;
  return options;
}

export function publicRecord(record) {
  return {
    path: record.repositoryPath,
    byteLength: record.byteLength,
    sha256: record.sha256,
    blobObjectId: record.blobObjectId,
    mediaType: record.mediaType
  };
}

export function resolveExactRepositoryRoot(value, cwd, fsApi) {
  if (typeof value !== "string" || value.length === 0) throw usageError("REPOSITORY_ROOT_REQUIRED", "--repo-root is required");
  const candidate = path.resolve(cwd, value);
  let stat;
  try {
    stat = fsApi.lstatSync(candidate);
  } catch {
    throw new SourceManifestError("REPOSITORY_ROOT_UNAVAILABLE", "the explicit repository root does not exist");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new SourceManifestError("REPOSITORY_ROOT_INVALID", "the explicit repository root must be one real directory");
  }
  const root = fsApi.realpathSync(candidate);
  const gitMarker = path.join(root, ".git");
  let gitMarkerStat;
  try {
    gitMarkerStat = fsApi.lstatSync(gitMarker);
  } catch {
    throw new SourceManifestError("REPOSITORY_ROOT_NOT_EXACT", "--repo-root must name the exact non-bare Git worktree root containing .git");
  }
  if (gitMarkerStat.isSymbolicLink() || (!gitMarkerStat.isDirectory() && !gitMarkerStat.isFile())) {
    throw new SourceManifestError("REPOSITORY_GIT_MARKER_INVALID", "the repository .git marker must be a real file or directory");
  }
  return root;
}

export function planOutputDirectory(repositoryRoot, repositoryPath, fsApi) {
  assertSafeRepositoryPath(repositoryPath, "output directory");
  const target = path.resolve(repositoryRoot, ...repositoryPath.split("/"));
  assertContained(repositoryRoot, target, "output directory");
  if (pathEntryExists(target, fsApi)) {
    const stat = fsApi.lstatSync(target);
    throw new SourceManifestError(
      stat.isSymbolicLink() ? "OUTPUT_TARGET_SYMLINK" : "OUTPUT_TARGET_EXISTS",
      "the output directory already exists; source-manifest never overwrites a path",
      { exitCode: SOURCE_MANIFEST_EXIT.HELD }
    );
  }
  const parent = path.dirname(target);
  let parentStat;
  try {
    parentStat = fsApi.lstatSync(parent);
  } catch {
    throw new SourceManifestError("OUTPUT_PARENT_MISSING", "the output directory parent must already exist as a real in-repository directory");
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new SourceManifestError("OUTPUT_PARENT_INVALID", "the output directory parent must be one real directory");
  }
  const realParent = fsApi.realpathSync(parent);
  assertContained(repositoryRoot, realParent, "output directory parent");
  assertNoSymlinkComponents(repositoryRoot, parent, fsApi);
  return {
    repositoryRoot,
    repositoryPath,
    target,
    parent,
    name: path.basename(target)
  };
}

export function normalizeRequiredRoleMappings(mappings) {
  if (!Array.isArray(mappings)) throw usageError("REQUIRED_ROLE_MAPPING_INVALID", "required role mappings must be an array");
  const roleMap = new Map();
  for (const mapping of mappings) {
    if (!mapping || typeof mapping.path !== "string" || typeof mapping.roleId !== "string") {
      throw usageError("REQUIRED_ROLE_MAPPING_INVALID", "each required role mapping needs path and roleId");
    }
    assertSafeRepositoryPath(mapping.path, "required role path");
    if (!ROLE_ID_PATTERN.test(mapping.roleId) || mapping.roleId.length > 120) {
      throw usageError("REQUIRED_ROLE_ID_INVALID", `invalid required role ID for ${mapping.path}`);
    }
    const roles = roleMap.get(mapping.path) ?? new Set();
    roles.add(mapping.roleId);
    roleMap.set(mapping.path, roles);
  }
  return roleMap;
}

export function parseRequiredRoleMapping(value) {
  const separator = value.lastIndexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw usageError("REQUIRED_ROLE_MAPPING_INVALID", "--required-role requires <repository-path>=<role-id>");
  }
  const mapping = { path: value.slice(0, separator), roleId: value.slice(separator + 1) };
  normalizeRequiredRoleMappings([mapping]);
  return mapping;
}

export function canonicalRoleMappings(roleMap) {
  const mappings = [];
  for (const [repositoryPath, roles] of roleMap.entries()) {
    for (const roleId of [...roles].sort(compareUtf8)) mappings.push({ path: repositoryPath, roleId });
  }
  return mappings.sort((left, right) => compareUtf8(left.path, right.path) || compareUtf8(left.roleId, right.roleId));
}

export function validateRepositoryIdentity(repositoryUri, numericRepositoryId) {
  if (!GITHUB_REPOSITORY_URI.test(repositoryUri ?? "")) {
    throw usageError("REPOSITORY_URI_INVALID", "--repository-uri must be a canonical lowercase https://github.com/owner/repository URI");
  }
  if (!NUMERIC_REPOSITORY_ID.test(numericRepositoryId ?? "")) {
    throw usageError("NUMERIC_REPOSITORY_ID_INVALID", "--numeric-repository-id must be a positive decimal GitHub repository ID");
  }
}

export function normalizeLimits(limits, chunking) {
  const source = limits && typeof limits === "object" ? limits : {};
  const normalized = {};
  for (const [name, defaultValue] of Object.entries(DEFAULT_LIMITS)) {
    const candidate = name === "chunkMaxEntries"
      ? chunking.chunkMaxEntries
      : name === "chunkMaxBytes"
        ? chunking.chunkMaxBytes
        : source[name];
    const value = candidate ?? defaultValue;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw usageError("RESOURCE_LIMIT_INVALID", `${name} must be a positive safe integer`);
    }
    normalized[name] = value;
  }
  if (normalized.chunkMaxEntries > normalized.maxEntries) {
    normalized.chunkMaxEntries = normalized.maxEntries;
  }
  if (normalized.chunkMaxBytes > 64 * 1024 * 1024) {
    throw usageError("CHUNK_BYTE_LIMIT_INVALID", "chunkMaxBytes cannot exceed 67108864 bytes");
  }
  if (normalized.blobBatchSize > 4096) {
    throw usageError("GIT_BATCH_SIZE_INVALID", "blobBatchSize cannot exceed 4096 objects");
  }
  return Object.freeze(normalized);
}

export function planDigest({ sourceSnapshot, outputDirectory, repository, dependencyPointers, requiredRoleMappings, records }) {
  return sha256(Buffer.from(canonicalJson({
    contract: "source-closure-manifest-v1-plan",
    sourceSnapshot,
    outputDirectory,
    repository,
    dependencyPointers,
    requiredRoleMappings,
    records: records.map(publicRecord)
  }), "utf8"));
}

export function parsePositiveInteger(value, flag, maximum) {
  if (!/^[1-9][0-9]*$/u.test(value)) throw usageError("ARGUMENT_INTEGER_INVALID", `${flag} requires a positive decimal integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw usageError("ARGUMENT_INTEGER_INVALID", `${flag} exceeds its supported maximum of ${maximum}`);
  }
  return parsed;
}

export function assertSafeRepositoryPath(value, label) {
  if (typeof value !== "string" || value.length === 0 || !SAFE_REPOSITORY_PATH.test(value)) {
    throw new SourceManifestError("REPOSITORY_PATH_UNSAFE", `${label} is not a safe canonical repository-relative path`);
  }
}

export function assertPortableCommittedRepositoryPath(value) {
  if (typeof value !== "string" || value.length === 0 || !SAFE_REPOSITORY_PATH.test(value)) {
    throw new SourceManifestError(
      "SOURCE_PATH_NONPORTABLE",
      "a committed Git path cannot be represented by the portable source-closure manifest transport",
      { exitCode: SOURCE_MANIFEST_EXIT.HELD }
    );
  }
}

export function assertRepositoryPathBudget(value, limits) {
  const observed = Buffer.byteLength(value, "utf8");
  if (observed > limits.maxRepositoryPathBytes) {
    throw resourceError("one committed Git path exceeds this generator run's UTF-8 byte budget", {
      observed,
      maximum: limits.maxRepositoryPathBytes
    });
  }
}

export function assertContained(root, target, label) {
  const relativePath = path.relative(root, target);
  if (relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))) return;
  throw new SourceManifestError("PATH_ESCAPE", `${label} resolves outside the exact repository root`);
}

export function assertNoSymlinkComponents(root, target, fsApi) {
  const relativePath = path.relative(root, target);
  assertContained(root, target, "output path");
  let current = root;
  for (const segment of relativePath.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fsApi.lstatSync(current);
    if (stat.isSymbolicLink()) throw new SourceManifestError("OUTPUT_PATH_SYMLINK", "output path contains a symbolic-link component");
  }
}

export function assertOutputStillAbsent(output, fsApi) {
  assertNoSymlinkComponents(output.repositoryRoot, output.parent, fsApi);
  if (pathEntryExists(output.target, fsApi)) {
    throw new SourceManifestError("OUTPUT_TARGET_EXISTS", "the output target appeared before materialization; nothing was overwritten", {
      exitCode: SOURCE_MANIFEST_EXIT.HELD
    });
  }
}

export function pathEntryExists(candidate, fsApi) {
  try {
    fsApi.lstatSync(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function cleanupOwnedDirectory(candidate, identity, fsApi) {
  try {
    const stat = fsApi.lstatSync(candidate, { bigint: true });
    if (stat.isDirectory() && !stat.isSymbolicLink() && inodeIdentity(stat) === identity) {
      fsApi.rmSync(candidate, { recursive: true, force: false });
    }
  } catch {
    // Do not widen cleanup after an identity mismatch or filesystem race.
  }
}

export function unlinkOwnedPath(candidate, identity, fsApi) {
  try {
    const stat = fsApi.lstatSync(candidate, { bigint: true });
    if (stat.isFile() && !stat.isSymbolicLink() && inodeIdentity(stat) === identity) fsApi.unlinkSync(candidate);
  } catch {
    // A replaced or already removed lock is deliberately left untouched.
  }
}

export function inodeIdentity(stat) {
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

export function bestEffortFsyncDirectory(directory, fsApi) {
  let descriptor = null;
  try {
    descriptor = fsApi.openSync(directory, "r");
    fsApi.fsyncSync(descriptor);
  } catch (error) {
    if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error?.code)) throw error;
  } finally {
    if (descriptor !== null) fsApi.closeSync(descriptor);
  }
}

export function gitObjectId(type, bytes) {
  const header = Buffer.from(`${type} ${bytes.length}\0`, "ascii");
  return crypto.createHash("sha1").update(header).update(bytes).digest("hex");
}

export function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

export function sumSafe(values, label) {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) {
      throw resourceError(`${label} exceeds safe integer precision`);
    }
    total += value;
  }
  return total;
}

export function sameSnapshot(left, right) {
  return left?.revisionObjectId === right?.revisionObjectId && left?.treeObjectId === right?.treeObjectId;
}

export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function* batches(values, size) {
  for (let offset = 0; offset < values.length; offset += size) yield values.slice(offset, offset + size);
}

export function checkDeadline(deadlineAt) {
  if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt) {
    throw resourceError("source-manifest generation exceeded its configured wall-time budget");
  }
}

export function resourceError(message, details = null) {
  return new SourceManifestError("SOURCE_MANIFEST_RESOURCE_LIMIT", message, {
    exitCode: SOURCE_MANIFEST_EXIT.HELD,
    details
  });
}

export function usageError(code, message) {
  return new SourceManifestError(code, message, { exitCode: SOURCE_MANIFEST_EXIT.USAGE_OR_INPUT });
}

export function internalError(code, message, details = null) {
  return new SourceManifestError(code, message, { exitCode: SOURCE_MANIFEST_EXIT.HELD, details });
}

export function normalizeError(error) {
  if (error instanceof SourceManifestError) return error;
  return new SourceManifestError("SOURCE_MANIFEST_FAILED", "source-manifest generation failed without a safe diagnostic", {
    exitCode: SOURCE_MANIFEST_EXIT.HELD
  });
}

export function safeMessage(value) {
  return String(value ?? "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 1000);
}
