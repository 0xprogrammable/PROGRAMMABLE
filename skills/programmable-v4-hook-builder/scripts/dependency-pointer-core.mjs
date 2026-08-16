import crypto from "node:crypto";
import fs from "node:fs";
import { TextDecoder } from "node:util";

export const DEPENDENCY_POINTER_COVERAGE_VERSION = "1.0.0";

const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });
const gitObjectIdPattern = /^[0-9a-f]{40}$/u;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const currentLfsMarker = "version https://git-lfs.github.com/spec/v1";
const legacyLfsMarker = "version https://hawser.github.com/spec/v1";
const unsafeTargetText = /[\\\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const sourceRoleIds = new Set([
  "build",
  "contract",
  "deployment",
  "launch",
  "library",
  "primary-hook",
  "script",
  "source",
  "symlink",
  "test",
  "toolchain"
]);
const sourcePathPattern = /(?:^|\/)(?:contracts?|lib|libraries|packages?|scripts?|src|source|tests?)(?:\/|$)/u;
const sourceFilePattern = /(?:^|\/)(?:\.github\/workflows\/[^/]+|Cargo\.(?:lock|toml)|Dockerfile|Makefile|bun\.lockb|deno\.jsonc?|flake\.lock|foundry\.toml|hardhat\.config\.[^/]+|package-lock\.json|package\.json|pnpm-lock\.yaml|remappings\.txt|tsconfig(?:\.[^/]+)?\.json|yarn\.lock)$/u;

/**
 * Classify raw bytes conservatively. Once a current or legacy marker is
 * present, malformed, extended, mixed-line-ending, or undecodable data stays
 * inside the Git-LFS class and can never fall back to ordinary source.
 */
export function parseGitLfsPointer(bytes) {
  if (!Buffer.isBuffer(bytes)) return Object.freeze({ kind: "ordinary" });
  const marker = detectLfsMarker(bytes);
  if (marker === null) return Object.freeze({ kind: "ordinary" });
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return malformedLfsPointer();
  }

  let text;
  try {
    text = fatalUtf8.decode(bytes);
  } catch {
    return malformedLfsPointer();
  }
  if (text.startsWith("\uFEFF")) return malformedLfsPointer();

  const hasCrlf = text.includes("\r\n");
  const withoutCrlf = text.replaceAll("\r\n", "");
  const hasLf = withoutCrlf.includes("\n");
  const hasBareCr = withoutCrlf.includes("\r");
  if (hasBareCr || (hasCrlf && hasLf)) return malformedLfsPointer();
  const lineEnding = hasCrlf ? "CRLF" : "LF";
  const separator = hasCrlf ? "\r\n" : "\n";
  const finalLineFeed = text.endsWith("\n");
  const lines = text.split(separator);
  if (finalLineFeed) lines.pop();
  if (lines.length < 3 || lines[0] !== marker.text) return malformedLfsPointer();

  let oidSha256 = null;
  let size = null;
  let extensionCount = 0;
  let sawIdentity = false;
  const extensionPriorities = new Set();
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    const extension = /^ext-([0-9]+)-([A-Za-z0-9](?:[A-Za-z0-9.-]{0,127})) ([^\u0000-\u001f\u007f]+)$/u.exec(line);
    if (extension && !sawIdentity) {
      const priority = extension[1];
      if (extensionPriorities.has(priority)) return malformedLfsPointer();
      extensionPriorities.add(priority);
      extensionCount += 1;
      continue;
    }
    const oidMatch = /^oid sha256:([0-9a-f]{64})$/u.exec(line);
    if (oidMatch && oidSha256 === null && size === null) {
      oidSha256 = `sha256:${oidMatch[1]}`;
      sawIdentity = true;
      continue;
    }
    const sizeMatch = /^size (0|[1-9][0-9]*)$/u.exec(line);
    if (sizeMatch && oidSha256 !== null && size === null) {
      const parsedSize = Number(sizeMatch[1]);
      if (!Number.isSafeInteger(parsedSize) || parsedSize < 0) return malformedLfsPointer();
      size = parsedSize;
      continue;
    }
    return malformedLfsPointer();
  }
  if (oidSha256 === null || size === null) return malformedLfsPointer();
  return Object.freeze({
    kind: "git-lfs",
    parseState: "VALID",
    representation: marker.representation,
    lineEnding,
    finalLineFeed,
    extensionCount,
    oidSha256,
    size
  });
}

/** Resolve every committed symlink inside an inert raw-Git logical tree. */
export function resolveRawGitSymlinks({ entries, maxHops = 256 } = {}) {
  if (!Array.isArray(entries) || !Number.isSafeInteger(maxHops) || maxHops < 1) {
    throw new TypeError("raw Git symlink resolution inputs are invalid");
  }
  const byPath = new Map();
  for (const entry of entries) {
    if (
      !entry
      || typeof entry.path !== "string"
      || !["100644", "100755", "120000", "160000"].includes(entry.mode)
      || !gitObjectIdPattern.test(entry.objectId ?? "")
      || byPath.has(entry.path)
    ) throw new TypeError("raw Git symlink tree contains an invalid or duplicate entry");
    if (
      entry.mode === "120000"
      && !Buffer.isBuffer(entry.bytes)
      && !(
        sha256Pattern.test(entry.targetSha256 ?? "")
        && typeof entry.unavailableReason === "string"
        && entry.unavailableReason.length > 0
      )
    ) {
      throw new TypeError("raw Git symlink entries require exact link blob bytes or a bounded unavailable record");
    }
    byPath.set(entry.path, entry);
  }
  const allPaths = [...byPath.keys()];
  const results = [];
  for (const entry of [...byPath.values()].filter(({ mode }) => mode === "120000").sort(pathRecordCompare)) {
    results.push(resolveOneSymlink(entry, byPath, allPaths, maxHops));
  }
  return Object.freeze(results.map(Object.freeze));
}

/** Match a parent Gitlink only to one declared, exact, independently verified companion. */
export function matchGitlinkCompanions({ gitlinks, repositories, verifiedRepositoryRefs } = {}) {
  if (!Array.isArray(gitlinks) || !Array.isArray(repositories) || !Array.isArray(verifiedRepositoryRefs)) {
    throw new TypeError("Gitlink companion matching inputs are invalid");
  }
  const verified = new Set(verifiedRepositoryRefs);
  const results = [];
  for (const gitlink of [...gitlinks].sort(pathRecordCompare)) {
    if (
      !gitlink
      || typeof gitlink.repositoryRef !== "string"
      || typeof gitlink.path !== "string"
      || !gitObjectIdPattern.test(gitlink.objectId ?? "")
    ) throw new TypeError("Gitlink identity is invalid");
    const matches = repositories.filter((repository) => (
      repository
      && typeof repository.id === "string"
      && repository.id !== gitlink.repositoryRef
      && repository.revisionObjectId === gitlink.objectId
    ));
    const base = {
      repositoryRef: gitlink.repositoryRef,
      path: gitlink.path,
      pointerType: "gitlink",
      pointerIdentity: `git-commit:${gitlink.objectId}`
    };
    if (matches.length === 0) {
      results.push(Object.freeze({ ...base, resolution: "UNRESOLVED", reasonCode: "COMPANION_MISSING" }));
    } else if (matches.length > 1) {
      results.push(Object.freeze({ ...base, resolution: "UNRESOLVED", reasonCode: "COMPANION_AMBIGUOUS" }));
    } else if (!verified.has(matches[0].id)) {
      results.push(Object.freeze({
        ...base,
        resolution: "UNRESOLVED",
        reasonCode: "COMPANION_CLOSURE_UNVERIFIED",
        companionRepositoryRef: matches[0].id
      }));
    } else {
      results.push(Object.freeze({
        ...base,
        resolution: "TARGET_VERIFIED",
        reasonCode: "EXACT_COMPANION_VERIFIED",
        companionRepositoryRef: matches[0].id,
        terminalIdentity: `git-commit:${gitlink.objectId}`
      }));
    }
  }
  return Object.freeze(results);
}

/** Derive pointer criticality from closed evidence; caller labels are ignored. */
export function deriveDependencyPointerCriticality({
  path,
  roleIds = [],
  required = false,
  sourceReachable = false,
  runtimeAssetDeclared = false
} = {}) {
  const roles = Array.isArray(roleIds) ? roleIds : [];
  const sourceRole = roles.some((roleId) => sourceRoleIds.has(roleId));
  const sourcePath = typeof path === "string" && (sourcePathPattern.test(path) || sourceFilePattern.test(path));
  if (required === true || sourceReachable === true || sourceRole || sourcePath) return "SOURCE_CRITICAL";
  if (runtimeAssetDeclared === true) return "RUNTIME_ASSET";
  return "UNCLASSIFIED";
}

/** Canonicalize and hash the complete pointer set, while deriving closed counts and launch state. */
export function summarizeDependencyPointers(pointers) {
  if (!Array.isArray(pointers)) throw new TypeError("dependency pointers must be an array");
  const canonicalRecords = pointers.map((pointer) => {
    if (
      !pointer
      || typeof pointer.repositoryRef !== "string"
      || typeof pointer.path !== "string"
      || !["symlink", "gitlink", "git-lfs"].includes(pointer.pointerType)
      || typeof pointer.pointerIdentity !== "string"
      || !["INTERNAL_VERIFIED", "TARGET_VERIFIED", "UNRESOLVED"].includes(pointer.resolution)
      || !(pointer.targetIdentity === null || pointer.targetIdentity === undefined || typeof pointer.targetIdentity === "string")
    ) throw new TypeError("dependency pointer record is invalid");
    const criticality = deriveDependencyPointerCriticality({
      path: pointer.path,
      ...(pointer.criticalityInput && typeof pointer.criticalityInput === "object" ? pointer.criticalityInput : {})
    });
    return Object.freeze({
      repositoryRef: pointer.repositoryRef,
      path: pointer.path,
      pointerType: pointer.pointerType,
      pointerIdentity: pointer.pointerIdentity,
      targetIdentity: pointer.targetIdentity ?? null,
      resolution: pointer.resolution,
      criticality,
      runtimeAssetDelegated: false
    });
  }).sort(pointerRecordCompare);
  for (let index = 1; index < canonicalRecords.length; index += 1) {
    const left = canonicalRecords[index - 1];
    const right = canonicalRecords[index];
    if (left.repositoryRef === right.repositoryRef && left.path === right.path && left.pointerType === right.pointerType) {
      throw new TypeError("dependency pointer record is duplicated");
    }
  }

  const counts = {
    symlink: 0,
    gitlink: 0,
    gitLfs: 0,
    internalVerified: 0,
    targetVerified: 0,
    unresolved: 0,
    sourceCritical: 0,
    runtimeAssetDelegated: 0,
    unclassified: 0
  };
  let criticalPointers = 0;
  let criticalVerified = 0;
  const hash = crypto.createHash("sha256");
  for (const record of canonicalRecords) {
    if (record.pointerType === "symlink") counts.symlink += 1;
    else if (record.pointerType === "gitlink") counts.gitlink += 1;
    else counts.gitLfs += 1;
    if (record.resolution === "INTERNAL_VERIFIED") counts.internalVerified += 1;
    else if (record.resolution === "TARGET_VERIFIED") counts.targetVerified += 1;
    else counts.unresolved += 1;
    if (record.runtimeAssetDelegated) counts.runtimeAssetDelegated += 1;
    if (record.criticality === "UNCLASSIFIED") counts.unclassified += 1;
    if (!record.runtimeAssetDelegated) {
      counts.sourceCritical += 1;
      criticalPointers += 1;
      if (["INTERNAL_VERIFIED", "TARGET_VERIFIED"].includes(record.resolution)) criticalVerified += 1;
    }
    hash.update(`${canonicalJson(record)}\n`, "utf8");
  }
  const sourceCriticalDereferenceState = criticalPointers === 0
    ? "NONE"
    : criticalVerified === criticalPointers
      ? "VERIFIED"
      : "UNRESOLVED";
  return Object.freeze({
    schemaVersion: DEPENDENCY_POINTER_COVERAGE_VERSION,
    pointerCount: canonicalRecords.length,
    pointerRecordsSha256: `sha256:${hash.digest("hex")}`,
    sourceCriticalDereferenceState,
    counts: Object.freeze(counts),
    canonicalRecords: Object.freeze(canonicalRecords)
  });
}

/**
 * Optionally verify explicitly supplied, materialized Git-LFS bytes through one
 * stable file descriptor. This function does not invoke Git, LFS, hooks,
 * filters, project code, or the network.
 */
export function verifyStreamedGitLfsObject({
  filePath,
  pointer,
  aggregateBudget = { maximumBytes: Number.MAX_SAFE_INTEGER, consumedBytes: 0 },
  deadlineAt,
  chunkBytes = 1024 * 1024,
  fsApi = fs
} = {}) {
  if (
    typeof filePath !== "string"
    || filePath.length === 0
    || pointer?.kind !== "git-lfs"
    || pointer?.parseState !== "VALID"
    || !sha256Pattern.test(pointer.oidSha256 ?? "")
    || !Number.isSafeInteger(pointer.size)
    || pointer.size < 0
    || !Number.isSafeInteger(chunkBytes)
    || chunkBytes < 1
  ) throw lfsFailure("LFS_MATERIALIZED_INPUT_INVALID", "materialized Git LFS verification input is invalid");
  assertLfsDeadline(deadlineAt);
  const maximumBytes = aggregateBudget?.maximumBytes;
  const consumedBytes = aggregateBudget?.consumedBytes;
  if (
    !Number.isSafeInteger(maximumBytes)
    || maximumBytes < 0
    || !Number.isSafeInteger(consumedBytes)
    || consumedBytes < 0
    || !Number.isSafeInteger(consumedBytes + pointer.size)
    || consumedBytes + pointer.size > maximumBytes
  ) throw lfsFailure("LFS_MATERIALIZED_AGGREGATE_LIMIT", "materialized Git LFS bytes exceed the aggregate verification budget");

  let pathStat;
  try {
    pathStat = fsApi.lstatSync(filePath, { bigint: true });
  } catch {
    throw lfsFailure("LFS_MATERIALIZED_PATH_UNAVAILABLE", "materialized Git LFS path is unavailable");
  }
  if (pathStat.isSymbolicLink()) throw lfsFailure("LFS_MATERIALIZED_PATH_SYMLINK", "materialized Git LFS path must not be a symbolic link");
  if (!pathStat.isFile()) throw lfsFailure("LFS_MATERIALIZED_PATH_NOT_FILE", "materialized Git LFS path must be a regular file");

  const noFollow = Number.isInteger(fsApi.constants?.O_NOFOLLOW) ? fsApi.constants.O_NOFOLLOW : 0;
  const readOnly = Number.isInteger(fsApi.constants?.O_RDONLY) ? fsApi.constants.O_RDONLY : 0;
  let descriptor = null;
  try {
    descriptor = fsApi.openSync(filePath, readOnly | noFollow);
  } catch {
    throw lfsFailure("LFS_MATERIALIZED_OPEN_FAILED", "materialized Git LFS file could not be opened without following links");
  }
  try {
    const before = fsApi.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || !sameFileIdentity(pathStat, before)) {
      throw lfsFailure("LFS_MATERIALIZED_IDENTITY_CHANGED", "materialized Git LFS file identity changed before verification");
    }
    if (before.size !== BigInt(pointer.size)) {
      throw lfsFailure("LFS_MATERIALIZED_SIZE_MISMATCH", "materialized Git LFS size differs from its pointer");
    }
    const hash = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, Math.max(1, pointer.size)));
    let observedBytes = 0;
    while (observedBytes < pointer.size) {
      assertLfsDeadline(deadlineAt);
      const requested = Math.min(buffer.length, pointer.size - observedBytes);
      const read = fsApi.readSync(descriptor, buffer, 0, requested, observedBytes);
      if (!Number.isSafeInteger(read) || read < 1) {
        throw lfsFailure("LFS_MATERIALIZED_READ_TRUNCATED", "materialized Git LFS file ended before its declared size");
      }
      hash.update(buffer.subarray(0, read));
      observedBytes += read;
    }
    const after = fsApi.fstatSync(descriptor, { bigint: true });
    let finalPathStat;
    try {
      finalPathStat = fsApi.lstatSync(filePath, { bigint: true });
    } catch {
      throw lfsFailure("LFS_MATERIALIZED_IDENTITY_CHANGED", "materialized Git LFS path changed during verification");
    }
    if (!sameStableFile(before, after) || !sameFileIdentity(after, finalPathStat) || finalPathStat.isSymbolicLink()) {
      throw lfsFailure("LFS_MATERIALIZED_IDENTITY_CHANGED", "materialized Git LFS file changed during verification");
    }
    assertLfsDeadline(deadlineAt);
    const observedSha256 = `sha256:${hash.digest("hex")}`;
    if (observedSha256 !== pointer.oidSha256) {
      throw lfsFailure("LFS_MATERIALIZED_SHA256_MISMATCH", "materialized Git LFS SHA-256 differs from its pointer");
    }
    return Object.freeze({
      status: "VERIFIED",
      oidSha256: observedSha256,
      byteLength: observedBytes,
      aggregateConsumedBytes: consumedBytes + observedBytes
    });
  } finally {
    if (descriptor !== null) fsApi.closeSync(descriptor);
  }
}

function detectLfsMarker(bytes) {
  const textPrefix = bytes.subarray(0, Math.min(bytes.length, 256)).toString("utf8");
  const withoutBom = textPrefix.startsWith("\uFEFF") ? textPrefix.slice(1) : textPrefix;
  if (withoutBom.startsWith(currentLfsMarker)) return { text: currentLfsMarker, representation: "CURRENT" };
  if (withoutBom.startsWith(legacyLfsMarker)) return { text: legacyLfsMarker, representation: "LEGACY" };
  return null;
}

function malformedLfsPointer() {
  return Object.freeze({ kind: "git-lfs", parseState: "MALFORMED" });
}

function resolveOneSymlink(entry, byPath, allPaths, maxHops) {
  const base = {
    path: entry.path,
    pointerType: "symlink",
    pointerIdentity: `git-blob:${entry.objectId}`,
    targetSha256: Buffer.isBuffer(entry.bytes) ? sha256(entry.bytes) : entry.targetSha256
  };
  let current = entry.path.split("/");
  const visited = new Set();
  const traversed = [];
  for (let hops = 0; hops < maxHops; hops += 1) {
    const component = firstSymlinkComponent(current, byPath);
    if (component !== null) {
      const symlink = byPath.get(component.path);
      if (visited.has(component.path)) {
        return { ...base, resolution: "UNRESOLVED", reasonCode: "SYMLINK_CYCLE", traversedSymlinkPaths: traversed };
      }
      visited.add(component.path);
      traversed.push(component.path);
      if (!Buffer.isBuffer(symlink.bytes)) {
        return {
          ...base,
          resolution: "UNRESOLVED",
          reasonCode: symlink.unavailableReason,
          traversedSymlinkPaths: traversed
        };
      }
      const target = decodePortableTarget(symlink.bytes);
      if (target.state !== "VALID") {
        return { ...base, resolution: "UNRESOLVED", reasonCode: target.reasonCode, traversedSymlinkPaths: traversed };
      }
      const normalized = lexicalTarget(component.path, target.segments);
      if (normalized === null) {
        return { ...base, resolution: "UNRESOLVED", reasonCode: "TARGET_ESCAPES_REPOSITORY", traversedSymlinkPaths: traversed };
      }
      current = [...normalized, ...current.slice(component.length)];
      continue;
    }
    const terminalPath = current.join("/");
    const terminal = byPath.get(terminalPath);
    if (terminal) {
      if (["100644", "100755"].includes(terminal.mode)) {
        return {
          ...base,
          resolution: "INTERNAL_VERIFIED",
          reasonCode: "INTERNAL_BLOB_RESOLVED",
          terminalPath,
          terminalMode: terminal.mode,
          terminalIdentity: `git-blob:${terminal.objectId}`,
          traversedSymlinkPaths: traversed
        };
      }
      if (terminal.mode === "160000") {
        return {
          ...base,
          resolution: "UNRESOLVED",
          reasonCode: "TARGET_IS_GITLINK",
          terminalPath,
          terminalMode: terminal.mode,
          terminalIdentity: `git-commit:${terminal.objectId}`,
          traversedSymlinkPaths: traversed
        };
      }
    }
    if (allPaths.some((candidate) => candidate.startsWith(`${terminalPath}/`))) {
      return {
        ...base,
        resolution: "INTERNAL_VERIFIED",
        reasonCode: "INTERNAL_TREE_RESOLVED",
        terminalPath,
        terminalMode: "040000",
        terminalIdentity: `git-tree-path:${sha256(Buffer.from(terminalPath, "utf8"))}`,
        traversedSymlinkPaths: traversed
      };
    }
    return { ...base, resolution: "UNRESOLVED", reasonCode: "TARGET_MISSING", traversedSymlinkPaths: traversed };
  }
  return { ...base, resolution: "UNRESOLVED", reasonCode: "SYMLINK_HOP_LIMIT", traversedSymlinkPaths: traversed };
}

function firstSymlinkComponent(segments, byPath) {
  for (let length = 1; length <= segments.length; length += 1) {
    const candidate = segments.slice(0, length).join("/");
    if (byPath.get(candidate)?.mode === "120000") return { path: candidate, length };
  }
  return null;
}

function decodePortableTarget(bytes) {
  let target;
  try {
    target = fatalUtf8.decode(bytes);
  } catch {
    return { state: "INVALID", reasonCode: "TARGET_ENCODING_INVALID" };
  }
  if (
    target.length === 0
    || target.startsWith("/")
    || target.endsWith("/")
    || target.includes("//")
    || unsafeTargetText.test(target)
  ) return { state: "INVALID", reasonCode: target.startsWith("/") ? "TARGET_ABSOLUTE" : "TARGET_ENCODING_INVALID" };
  return { state: "VALID", segments: target.split("/") };
}

function lexicalTarget(symlinkPath, targetSegments) {
  const resolved = symlinkPath.split("/").slice(0, -1);
  for (const segment of targetSegments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (resolved.length === 0) return null;
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  }
  return resolved.length === 0 ? null : resolved;
}

function sameFileIdentity(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function sameStableFile(left, right) {
  return sameFileIdentity(left, right)
    && String(left.size) === String(right.size)
    && statTime(left, "mtime") === statTime(right, "mtime")
    && statTime(left, "ctime") === statTime(right, "ctime");
}

function statTime(stat, name) {
  const nanoseconds = stat[`${name}Ns`];
  return nanoseconds === undefined ? String(stat[`${name}Ms`]) : String(nanoseconds);
}

function assertLfsDeadline(deadlineAt) {
  if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt) {
    throw lfsFailure("LFS_MATERIALIZED_DEADLINE", "materialized Git LFS verification exceeded its deadline");
  }
}

function lfsFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function pathRecordCompare(left, right) {
  return compareUtf8(left.path, right.path);
}

function pointerRecordCompare(left, right) {
  for (const key of ["repositoryRef", "path", "pointerType", "pointerIdentity"]) {
    const comparison = compareUtf8(left[key], right[key]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
