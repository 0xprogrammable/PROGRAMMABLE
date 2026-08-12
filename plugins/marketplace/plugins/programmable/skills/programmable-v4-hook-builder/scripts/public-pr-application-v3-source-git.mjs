import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonicalJson } from "./submission-core.mjs";
import {
  safeGitEnvironment,
  safeRawGitArguments,
  spawnSafeRawGitSync
} from "./repository-root.mjs";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";
import {
  compareUtf8,
  fatalUtf8Decoder,
  gitObjectPattern,
  isObject,
  safeRepositoryPath,
  sha256Pattern
} from "./public-pr-application-v3-shared.mjs";

export class CanonicalSourceEntryJsonlParser {
  constructor({ maxJsonLineBytes, fragmentPath, onEntry, add }) {
    this.maxJsonLineBytes = maxJsonLineBytes;
    this.fragmentPath = fragmentPath;
    this.onEntry = onEntry;
    this.add = add;
    this.pending = Buffer.alloc(0);
    this.entryCount = 0;
    this.firstPath = null;
    this.lastPath = null;
  }

  async consume(chunk) {
    if (!Buffer.isBuffer(chunk)) throw verifierFailure("SOURCE_MANIFEST_STREAM_INVALID", "Git blob stream yielded non-buffer data");
    this.pending = this.pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.pending, chunk]);
    if (this.pending.length > this.maxJsonLineBytes && this.pending.indexOf(0x0a) === -1) {
      throw verifierFailure("SOURCE_MANIFEST_JSONL_LINE_LIMIT", "canonical JSONL entry exceeds the bounded line size");
    }
    let newlineIndex = this.pending.indexOf(0x0a);
    while (newlineIndex !== -1) {
      const line = this.pending.subarray(0, newlineIndex);
      this.pending = this.pending.subarray(newlineIndex + 1);
      if (line.length > this.maxJsonLineBytes) {
        throw verifierFailure("SOURCE_MANIFEST_JSONL_LINE_LIMIT", "canonical JSONL entry exceeds the bounded line size");
      }
      await this.processLine(line);
      newlineIndex = this.pending.indexOf(0x0a);
    }
  }

  async finish() {
    if (this.pending.length !== 0) {
      this.add("blocker", "SOURCE_MANIFEST_JSONL_FINAL_LF_MISSING", this.fragmentPath, "Fragment does not end with exactly one LF after its final canonical entry.", "Regenerate canonical JSONL without BOM, CRLF, blank lines, or a missing final LF.", "source-closure-binding");
    }
    this.pending = Buffer.alloc(0);
  }

  async processLine(line) {
    const entryIndex = this.entryCount;
    const instancePath = `${this.fragmentPath}.entries[${entryIndex}]`;
    this.entryCount += 1;
    if (line.length === 0) {
      this.add("blocker", "SOURCE_MANIFEST_JSONL_BLANK_LINE", instancePath, "Blank JSONL lines are forbidden.", "Emit exactly canonicalJson(sourceEntry) plus LF for every entry.", "source-closure-binding");
      return;
    }
    if (line[line.length - 1] === 0x0d) {
      this.add("blocker", "SOURCE_MANIFEST_JSONL_CRLF_FORBIDDEN", instancePath, "CRLF is forbidden in canonical JSONL fragments.", "Use one LF byte after each canonical JSON object.", "source-closure-binding");
      return;
    }
    let text;
    let entry;
    try {
      text = fatalUtf8Decoder.decode(line);
      entry = parseBoundedStrictJson(text, {
        maxSourceBytes: this.maxJsonLineBytes,
        maxDepth: 128,
        maxNodes: 65_536,
        maxNumberCharacters: this.maxJsonLineBytes
      });
    } catch {
      this.add("blocker", "SOURCE_MANIFEST_JSONL_INVALID", instancePath, "Fragment entry is not valid fatal UTF-8 JSON.", "Regenerate the exact canonical JSONL entry.", "source-closure-binding");
      return;
    }
    if (text !== canonicalJson(entry)) {
      this.add("blocker", "SOURCE_MANIFEST_JSONL_NOT_CANONICAL", instancePath, "Fragment entry bytes are not canonical JSON.", "Emit canonicalJson(sourceEntry) followed by one LF and no other bytes.", "source-closure-binding");
      return;
    }
    if (!validateSourceClosureEntry(entry, instancePath, this.add)) return;
    if (this.firstPath === null) this.firstPath = entry.path;
    this.lastPath = entry.path;
    await this.onEntry(entry, entryIndex, instancePath);
  }
}

export class GitCatFileBatch {
  constructor(repositoryRoot, { deadlineAt }) {
    this.deadlineAt = deadlineAt;
    this.process = childProcess.spawn("git", safeRawGitArguments(["-C", repositoryRoot, "cat-file", "--batch"]), {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      env: safeGitEnvironment()
    });
    this.iterator = this.process.stdout[Symbol.asyncIterator]();
    this.current = Buffer.alloc(0);
    this.offset = 0;
    this.closed = false;
    this.spawnError = null;
    this.stderr = "";
    this.process.on("error", (error) => { this.spawnError = error; });
    this.process.stderr.on("data", (chunk) => {
      if (this.stderr.length < 4096) this.stderr += chunk.toString("utf8", 0, Math.max(0, 4096 - this.stderr.length));
    });
  }

  async readBlob(objectId, onChunk, { maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
    if (this.closed || !gitObjectPattern.test(objectId ?? "")) throw verifierFailure("SOURCE_MANIFEST_GIT_OBJECT_INVALID", "invalid raw Git blob request");
    if (this.spawnError) throw this.spawnError;
    assertBeforeDeadline(this.deadlineAt);
    await withDeadline(writeWithBackpressure(this.process.stdin, `${objectId}\n`), this.deadlineAt, this);
    const header = (await withDeadline(this.readLine(1024), this.deadlineAt, this)).toString("ascii");
    if (header.endsWith(" missing")) throw verifierFailure("SOURCE_MANIFEST_GIT_OBJECT_MISSING", "raw Git object is missing");
    const match = /^([0-9a-f]{40}) ([a-z]+) ([0-9]+)$/u.exec(header);
    if (!match) throw verifierFailure("SOURCE_MANIFEST_GIT_BATCH_PROTOCOL", "invalid git cat-file batch header");
    const [, observedObjectId, type, sizeText] = match;
    const size = Number(sizeText);
    if (observedObjectId !== objectId || type !== "blob" || !Number.isSafeInteger(size) || size < 0) {
      throw verifierFailure("SOURCE_MANIFEST_GIT_OBJECT_TYPE", "requested Git object is not the exact expected blob");
    }
    if (size > maxBytes) throw resourceLimitFailure("raw Git blob exceeds this verifier run's byte budget");
    await withDeadline(this.consumeBytes(size, onChunk), this.deadlineAt, this);
    const delimiter = await withDeadline(this.readExact(1), this.deadlineAt, this);
    if (delimiter[0] !== 0x0a) throw verifierFailure("SOURCE_MANIFEST_GIT_BATCH_PROTOCOL", "git cat-file blob delimiter is invalid");
    return { objectId: observedObjectId, type, size };
  }

  async readLine(maxBytes) {
    const parts = [];
    let total = 0;
    while (true) {
      await this.ensureData();
      const newline = this.current.indexOf(0x0a, this.offset);
      const end = newline === -1 ? this.current.length : newline;
      const part = this.current.subarray(this.offset, end);
      parts.push(part);
      total += part.length;
      if (total > maxBytes) throw verifierFailure("SOURCE_MANIFEST_GIT_BATCH_PROTOCOL", "git cat-file header exceeds bound");
      this.offset = newline === -1 ? this.current.length : newline + 1;
      if (newline !== -1) return parts.length === 1 ? Buffer.from(parts[0]) : Buffer.concat(parts, total);
    }
  }

  async consumeBytes(byteLength, onChunk) {
    let remaining = byteLength;
    while (remaining > 0) {
      await this.ensureData();
      const available = this.current.length - this.offset;
      const take = Math.min(available, remaining);
      const part = this.current.subarray(this.offset, this.offset + take);
      this.offset += take;
      remaining -= take;
      await onChunk(part);
    }
  }

  async readExact(byteLength) {
    const parts = [];
    let total = 0;
    await this.consumeBytes(byteLength, async (part) => {
      parts.push(Buffer.from(part));
      total += part.length;
    });
    return parts.length === 1 ? parts[0] : Buffer.concat(parts, total);
  }

  async ensureData() {
    if (this.offset < this.current.length) return;
    const next = await this.iterator.next();
    if (next.done) throw verifierFailure("SOURCE_MANIFEST_GIT_BATCH_EOF", "git cat-file ended unexpectedly");
    this.current = Buffer.from(next.value);
    this.offset = 0;
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const closed = new Promise((resolve) => {
      if (this.process.exitCode !== null || this.process.signalCode !== null) return resolve();
      this.process.once("close", resolve);
    });
    this.process.stdin.end();
    let killTimer;
    const timeout = new Promise((resolve) => {
      killTimer = setTimeout(() => {
        this.process.kill("SIGKILL");
        resolve();
      }, 1000);
    });
    await Promise.race([closed, timeout]);
    clearTimeout(killTimer);
  }
}

function validateSourceClosureEntry(entry, instancePath, add) {
  const requiredKeys = ["blobObjectId", "byteLength", "gitMode", "path", "roleIds", "sha256"];
  if (!isObject(entry) || canonicalJson(Object.keys(entry).sort()) !== canonicalJson(requiredKeys)) {
    add("blocker", "SOURCE_MANIFEST_ENTRY_SHAPE_INVALID", instancePath, "Source entry must use exactly the closed v1 fields.", "Regenerate the source entry from the versioned schema.", "source-closure-binding");
    return false;
  }
  let valid = true;
  const invalid = (code, field, message) => {
    valid = false;
    add("blocker", code, `${instancePath}.${field}`, message, "Regenerate the entry from the exact pinned Git blob.", "source-closure-binding");
  };
  if (!safeRepositoryPath(entry.path)) invalid("SOURCE_MANIFEST_ENTRY_PATH_INVALID", "path", "Entry path is not one safe canonical repository path.");
  if (!gitObjectPattern.test(entry.blobObjectId ?? "")) invalid("SOURCE_MANIFEST_ENTRY_BLOB_INVALID", "blobObjectId", "Entry blobObjectId is invalid.");
  if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) invalid("SOURCE_MANIFEST_ENTRY_SIZE_INVALID", "byteLength", "Entry byteLength must be a non-negative safe integer.");
  if (!sha256Pattern.test(entry.sha256 ?? "")) invalid("SOURCE_MANIFEST_ENTRY_SHA256_INVALID", "sha256", "Entry SHA-256 is invalid.");
  if (!["100644", "100755", "120000"].includes(entry.gitMode)) invalid("SOURCE_MANIFEST_ENTRY_MODE_INVALID", "gitMode", "Entry Git mode is not a supported raw blob mode.");
  if (
    !Array.isArray(entry.roleIds)
    || entry.roleIds.length < 1
    || new Set(entry.roleIds).size !== entry.roleIds.length
    || entry.roleIds.some((roleId) => typeof roleId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(roleId))
    || entry.roleIds.some((roleId, index) => index > 0 && compareUtf8(entry.roleIds[index - 1], roleId) >= 0)
  ) invalid("SOURCE_MANIFEST_ENTRY_ROLES_INVALID", "roleIds", "Entry roleIds must be a non-empty unique list of open slug IDs.");
  if (entry.gitMode === "120000" && !entry.roleIds?.includes("symlink")) invalid("SOURCE_MANIFEST_SYMLINK_ROLE_MISSING", "roleIds", "Symlink entries must explicitly include the symlink role.");
  return valid;
}

export function gitTreeEntriesForPaths(repositoryRoot, commit, repositoryPaths, deadlineAt) {
  if (!Array.isArray(repositoryPaths) || repositoryPaths.length === 0) return [];
  for (const repositoryPath of repositoryPaths) {
    if (!safeRepositoryPath(repositoryPath)) throw verifierFailure("SOURCE_MANIFEST_GIT_PATH_INVALID", "unsafe path in git tree request");
  }
  assertBeforeDeadline(deadlineAt);
  const result = spawnSafeRawGitSync([
    "-C",
    repositoryRoot,
    "ls-tree",
    "-z",
    "--full-tree",
    commit,
    "--",
    ...repositoryPaths
  ], {
    encoding: null,
    maxBuffer: Math.max(1024 * 1024, repositoryPaths.length * 4096),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: remainingTimeout(deadlineAt, 10_000)
  });
  if (result.error?.code === "ENOBUFS") {
    throw resourceLimitFailure("pinned Git tree output exceeds this verifier run's byte budget");
  }
  if (result.error?.code === "ETIMEDOUT") {
    throw verifierFailure("SOURCE_MANIFEST_WALL_TIME_LIMIT", "pinned Git tree inspection exceeded this verifier run's wall-time budget");
  }
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw verifierFailure("SOURCE_MANIFEST_GIT_TREE_READ_FAILED", "unable to read pinned Git tree entries");
  }
  const records = [];
  let offset = 0;
  while (offset < result.stdout.length) {
    const nul = result.stdout.indexOf(0x00, offset);
    if (nul === -1) throw verifierFailure("SOURCE_MANIFEST_GIT_TREE_PROTOCOL", "git ls-tree output is not NUL terminated");
    const record = result.stdout.subarray(offset, nul);
    offset = nul + 1;
    const tab = record.indexOf(0x09);
    if (tab === -1) throw verifierFailure("SOURCE_MANIFEST_GIT_TREE_PROTOCOL", "git ls-tree record has no path separator");
    const header = record.subarray(0, tab).toString("ascii");
    const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40})$/u.exec(header);
    if (!match) throw verifierFailure("SOURCE_MANIFEST_GIT_TREE_PROTOCOL", "git ls-tree record identity is invalid");
    let repositoryPath;
    try {
      repositoryPath = fatalUtf8Decoder.decode(record.subarray(tab + 1));
    } catch {
      throw verifierFailure("SOURCE_MANIFEST_GIT_PATH_UTF8_INVALID", "git tree path is not valid UTF-8");
    }
    records.push({ mode: match[1], type: match[2], objectId: match[3], path: repositoryPath });
  }
  return records;
}

export function readRecursiveGitTreeEntries({
  repositoryRoot,
  commit,
  deadlineAt,
  maxEntries,
  maxListingBytes,
  maxRecordBytes
}) {
  if (!gitObjectPattern.test(commit ?? "")) {
    throw verifierFailure("SOURCE_MANIFEST_GIT_REVISION_INVALID", "recursive tree listing requires one exact full commit object ID");
  }
  assertBeforeDeadline(deadlineAt);
  const processHandle = childProcess.spawn("git", safeRawGitArguments([
    "-C",
    repositoryRoot,
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    commit,
    "--",
    "."
  ]), {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    env: safeGitEnvironment()
  });
  const readPromise = new Promise((resolve, reject) => {
    const entries = [];
    const seenPaths = new Set();
    let pending = Buffer.alloc(0);
    let listingBytes = 0;
    let stderr = "";
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      processHandle.kill("SIGKILL");
      reject(error);
    };
    processHandle.stderr.on("data", (chunk) => {
      if (stderr.length < 4096) stderr += chunk.toString("utf8", 0, Math.max(0, 4096 - stderr.length));
    });
    processHandle.stdout.on("data", (chunk) => {
      if (settled) return;
      try {
        if (!Buffer.isBuffer(chunk)) throw verifierFailure("SOURCE_MANIFEST_GIT_TREE_PROTOCOL", "recursive Git tree output is not a byte buffer");
        listingBytes += chunk.length;
        if (!Number.isSafeInteger(listingBytes) || listingBytes > maxListingBytes) {
          throw resourceLimitFailure("recursive Git tree listing exceeds this verifier run's byte budget");
        }
        pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
        let nul = pending.indexOf(0x00);
        while (nul !== -1) {
          const record = pending.subarray(0, nul);
          pending = pending.subarray(nul + 1);
          if (record.length > maxRecordBytes) {
            throw resourceLimitFailure("one recursive Git tree record exceeds this verifier run's byte budget");
          }
          const entry = parseRecursiveGitTreeRecord(record);
          if (seenPaths.has(entry.path)) {
            throw verifierFailure("SOURCE_MANIFEST_GIT_TREE_PROTOCOL", "recursive Git tree listing contains one path more than once");
          }
          seenPaths.add(entry.path);
          entries.push(entry);
          if (entries.length > maxEntries) {
            throw resourceLimitFailure("recursive Git tree listing exceeds this verifier run's entry budget");
          }
          nul = pending.indexOf(0x00);
        }
        if (pending.length > maxRecordBytes) {
          throw resourceLimitFailure("one recursive Git tree record exceeds this verifier run's byte budget");
        }
      } catch (error) {
        fail(error);
      }
    });
    processHandle.once("error", fail);
    processHandle.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (code !== 0 || signal !== null) {
        reject(verifierFailure("SOURCE_MANIFEST_GIT_TREE_READ_FAILED", "unable to enumerate the exact pinned Git tree"));
      } else if (pending.length !== 0) {
        reject(verifierFailure("SOURCE_MANIFEST_GIT_TREE_PROTOCOL", "recursive Git tree output is not NUL terminated"));
      } else {
        resolve(entries);
      }
    });
  });
  return withDeadline(readPromise, deadlineAt, { process: processHandle });
}

function parseRecursiveGitTreeRecord(record) {
  const tab = record.indexOf(0x09);
  if (tab === -1) throw verifierFailure("SOURCE_MANIFEST_GIT_TREE_PROTOCOL", "recursive Git tree record has no path separator");
  const header = record.subarray(0, tab).toString("ascii");
  const match = /^(\d{6}) ([a-z]+) ([0-9a-f]{40})$/u.exec(header);
  if (!match) throw verifierFailure("SOURCE_MANIFEST_GIT_TREE_PROTOCOL", "recursive Git tree record identity is invalid");
  let repositoryPath;
  try {
    repositoryPath = fatalUtf8Decoder.decode(record.subarray(tab + 1));
  } catch {
    throw verifierFailure("SOURCE_MANIFEST_GIT_PATH_UTF8_INVALID", "recursive Git tree path is not valid UTF-8");
  }
  if (!safeRepositoryPath(repositoryPath)) {
    throw verifierFailure("SOURCE_MANIFEST_GIT_PATH_INVALID", "recursive Git tree path is not one safe canonical repository path");
  }
  const [mode, type, objectId] = match.slice(1);
  const blobMode = ["100644", "100755", "120000"].includes(mode) && type === "blob";
  const gitlinkMode = mode === "160000" && type === "commit";
  if (!blobMode && !gitlinkMode) {
    throw verifierFailure("SOURCE_MANIFEST_GIT_TREE_PROTOCOL", "recursive Git tree contains an unsupported mode/type pair");
  }
  return { mode, type, objectId, path: repositoryPath };
}

export function verifyExactCommittedTreeClosure({
  committedTreeEntries,
  manifestEntriesByPath,
  metadataPaths,
  add,
  stats
}) {
  const sourceTreeByPath = new Map();
  for (const treeEntry of committedTreeEntries) {
    if (metadataPaths.has(treeEntry.path)) {
      stats.metadataEntriesExcluded += 1;
      continue;
    }
    if (treeEntry.mode === "160000") {
      stats.gitlinkEntries += 1;
      continue;
    }
    sourceTreeByPath.set(treeEntry.path, treeEntry);
  }

  const unlistedPaths = [];
  const missingOrChangedPaths = [];
  for (const [repositoryPath, treeEntry] of sourceTreeByPath) {
    const declared = manifestEntriesByPath.get(repositoryPath);
    if (!declared) {
      unlistedPaths.push(repositoryPath);
    } else if (declared.mode !== treeEntry.mode || declared.objectId !== treeEntry.objectId) {
      missingOrChangedPaths.push(repositoryPath);
    }
  }
  for (const [repositoryPath, declared] of manifestEntriesByPath) {
    const treeEntry = sourceTreeByPath.get(repositoryPath);
    if (!treeEntry || declared.mode !== treeEntry.mode || declared.objectId !== treeEntry.objectId) {
      if (!missingOrChangedPaths.includes(repositoryPath)) missingOrChangedPaths.push(repositoryPath);
    }
  }
  unlistedPaths.sort(compareUtf8);
  missingOrChangedPaths.sort(compareUtf8);
  if (unlistedPaths.length > 0 || missingOrChangedPaths.length > 0) {
    add(
      "blocker",
      "SOURCE_MANIFEST_TREE_CLOSURE_MISMATCH",
      "$.entries",
      "The manifest entry set is not exactly equal to the bound commit's blob/symlink tree after excluding only the exact root manifest and declared fragment paths.",
      "Regenerate the manifest from the exact final source tree and commit only those bound metadata files; never leave added, changed, or omitted source blobs outside the closure.",
      "source-closure-binding",
      {
        unlistedCount: unlistedPaths.length,
        missingOrChangedCount: missingOrChangedPaths.length,
        unlistedPaths: unlistedPaths.slice(0, 32),
        missingOrChangedPaths: missingOrChangedPaths.slice(0, 32),
        pathsTruncated: unlistedPaths.length > 32 || missingOrChangedPaths.length > 32
      }
    );
  }
}

export function inspectMaterializedLfsPath(repositoryRoot, repositoryPath) {
  if (!safeRepositoryPath(repositoryPath)) {
    throw lfsMaterializationFailure("LFS_MATERIALIZED_PATH_INVALID", "materialized Git LFS path is invalid");
  }
  const segments = repositoryPath.split("/");
  const parentSnapshots = [];
  let cursor = repositoryRoot;
  for (const segment of segments.slice(0, -1)) {
    cursor = path.join(cursor, segment);
    let stat;
    try {
      stat = fs.lstatSync(cursor, { bigint: true });
    } catch {
      throw lfsMaterializationFailure("LFS_MATERIALIZED_PARENT_UNAVAILABLE", "materialized Git LFS parent is unavailable");
    }
    if (stat.isSymbolicLink()) {
      throw lfsMaterializationFailure("LFS_MATERIALIZED_PARENT_SYMLINK", "materialized Git LFS parents must not be symbolic links");
    }
    if (!stat.isDirectory()) {
      throw lfsMaterializationFailure("LFS_MATERIALIZED_PARENT_NOT_DIRECTORY", "materialized Git LFS parent is not a directory");
    }
    parentSnapshots.push(Object.freeze({
      path: cursor,
      device: String(stat.dev),
      inode: String(stat.ino)
    }));
  }
  return Object.freeze({
    filePath: path.join(repositoryRoot, ...segments),
    parentSnapshots: Object.freeze(parentSnapshots)
  });
}

export function assertMaterializedLfsParentsStable(materialized) {
  for (const snapshot of materialized.parentSnapshots) {
    let stat;
    try {
      stat = fs.lstatSync(snapshot.path, { bigint: true });
    } catch {
      throw lfsMaterializationFailure("LFS_MATERIALIZED_PARENT_CHANGED", "materialized Git LFS parent changed during verification");
    }
    if (
      stat.isSymbolicLink()
      || !stat.isDirectory()
      || String(stat.dev) !== snapshot.device
      || String(stat.ino) !== snapshot.inode
    ) {
      throw lfsMaterializationFailure("LFS_MATERIALIZED_PARENT_CHANGED", "materialized Git LFS parent changed during verification");
    }
  }
}

function lfsMaterializationFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function requireReadOnlyGitDirectory(value) {
  if (typeof value !== "string" || value.length === 0) throw verifierFailure("SOURCE_MANIFEST_REPOSITORY_PATH_INVALID", "repositoryRoot is required");
  const absolutePath = path.resolve(value);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw verifierFailure("SOURCE_MANIFEST_REPOSITORY_PATH_INVALID", "repositoryRoot must be a non-symlink directory");
  runGitTextReadOnly(absolutePath, ["rev-parse", "--git-dir"], Date.now() + 10_000);
  return absolutePath;
}

export function runGitTextReadOnly(repositoryRoot, argumentsList, deadlineAt) {
  assertBeforeDeadline(deadlineAt);
  const result = spawnSafeRawGitSync(["-C", repositoryRoot, ...argumentsList], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: remainingTimeout(deadlineAt, 10_000)
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") throw verifierFailure("SOURCE_MANIFEST_GIT_READ_FAILED", "unable to read pinned Git metadata");
  const value = result.stdout.trim();
  if (value.length === 0) throw verifierFailure("SOURCE_MANIFEST_GIT_READ_FAILED", "Git returned no metadata");
  return value;
}

function writeWithBackpressure(stream, value) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      stream.off("error", onError);
      stream.off("drain", onDrain);
    };
    stream.once("error", onError);
    if (stream.write(value)) {
      cleanup();
      resolve();
    } else {
      stream.once("drain", onDrain);
    }
  });
}

export function positiveLimit(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw verifierFailure("SOURCE_MANIFEST_LIMIT_INVALID", "verification limit is invalid");
  return value;
}

export function normalizeRequiredSourceEntries(requiredEntries, requiredPaths) {
  const normalized = new Map();
  const addRequired = (repositoryPath, roleIds) => {
    if (!safeRepositoryPath(repositoryPath)) throw verifierFailure("SOURCE_MANIFEST_REQUIRED_PATH_INVALID", "required source path is unsafe");
    if (
      !Array.isArray(roleIds)
      || roleIds.some((roleId) => typeof roleId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(roleId))
    ) throw verifierFailure("SOURCE_MANIFEST_REQUIRED_ROLE_INVALID", "required source roles are invalid");
    const current = normalized.get(repositoryPath) ?? [];
    normalized.set(repositoryPath, [...new Set([...current, ...roleIds])].sort(compareUtf8));
  };
  if (!Array.isArray(requiredEntries) || !Array.isArray(requiredPaths)) {
    throw verifierFailure("SOURCE_MANIFEST_REQUIRED_ENTRY_INVALID", "required source entries must be arrays");
  }
  for (const required of requiredEntries) {
    if (!isObject(required) || Object.keys(required).some((key) => !["path", "roleIds"].includes(key))) {
      throw verifierFailure("SOURCE_MANIFEST_REQUIRED_ENTRY_INVALID", "required source entry shape is invalid");
    }
    addRequired(required.path, required.roleIds ?? []);
  }
  for (const repositoryPath of requiredPaths) addRequired(repositoryPath, []);
  return normalized;
}

export function safeIntegerSum(values) {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total + value)) return null;
    total += value;
  }
  return total;
}

export function gitBlobObjectHash(byteLength) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw verifierFailure("SOURCE_MANIFEST_GIT_OBJECT_SIZE_INVALID", "Git blob byte length is invalid");
  }
  return crypto.createHash("sha1").update(Buffer.from(`blob ${byteLength}\0`, "ascii"));
}

export function gitBlobObjectId(bytes) {
  if (!Buffer.isBuffer(bytes)) throw verifierFailure("SOURCE_MANIFEST_GIT_OBJECT_BYTES_INVALID", "Git blob bytes are invalid");
  return gitBlobObjectHash(bytes.length).update(bytes).digest("hex");
}

export function addResourceLimitFinding(add, findingPath, message, metadata = {}) {
  add(
    "blocker",
    "SOURCE_MANIFEST_SPLIT_REVIEW_REQUIRED",
    findingPath,
    message,
    "Split verification into bounded, independently content-addressed review runs or raise an explicitly reviewed local budget. The product idea remains eligible.",
    "tooling-split-review",
    metadata
  );
}

export function resourceLimitFailure(message) {
  return verifierFailure("SOURCE_MANIFEST_RESOURCE_LIMIT", message);
}

export function assertBeforeDeadline(deadlineAt) {
  if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt) {
    throw verifierFailure("SOURCE_MANIFEST_WALL_TIME_LIMIT", "source closure verification exceeded this run's wall-time budget");
  }
}

function remainingTimeout(deadlineAt, maximum) {
  assertBeforeDeadline(deadlineAt);
  return Math.max(1, Math.min(maximum, deadlineAt - Date.now()));
}

function withDeadline(promise, deadlineAt, processOwner) {
  const delay = remainingTimeout(deadlineAt, Number.MAX_SAFE_INTEGER);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      processOwner?.process?.kill("SIGKILL");
      reject(verifierFailure("SOURCE_MANIFEST_WALL_TIME_LIMIT", "source closure verification exceeded this run's wall-time budget"));
    }, delay);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function verifierFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
