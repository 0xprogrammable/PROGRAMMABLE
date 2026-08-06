import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";

import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError
} from "./github-public-source-core.mjs";
import {
  isCanonicalReviewTargetPath,
  isGitLfsPointer,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";

export const GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1 = Object.freeze({
  name: "GitHubPublicGitObjectResolverV1",
  minimumGitVersion: "2.49.0",
  maximumFiles: REVIEW_TARGET_CONTRACT_V1.maximumFiles,
  maximumFileBytes: REVIEW_TARGET_CONTRACT_V1.maximumFileBytes,
  maximumTotalBytes: REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes,
  maximumPathDepth: REVIEW_TARGET_CONTRACT_V1.maximumPathDepth,
  maximumTemporaryRepositoryBytes: 67_108_864,
  maximumTemporaryFileBytes: 67_108_864,
  maximumAddressSpaceBytes: 536_870_912,
  maximumCpuSeconds: 20,
  minimumTimeoutMs: 1,
  maximumTimeoutMs: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.maximumTimeoutMs
});

const REQUEST_KEYS = new Set([
  "repositoryUri",
  "revisionObjectId",
  "treeObjectId",
  "paths",
  "timeoutMs",
  "maximumFileBytes",
  "maximumTotalBytes"
]);
const LOWER_HEX_40 = /^[0-9a-f]{40}$/u;
const GITHUB_OWNER = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/u;
const GITHUB_REPOSITORY = /^[a-z0-9._-]{1,100}$/u;
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });
const TEMPORARY_PREFIX = "programmable-github-objects-";
const SMALL_COMMAND_OUTPUT_BYTES = 65_536;
const COMMIT_OUTPUT_BYTES = 1_048_576;
const TREE_LIST_OUTPUT_BYTES = 1_048_576;
const BATCH_PROTOCOL_OVERHEAD_BYTES = 1_048_576;
const KILL_GRACE_MS = 250;
const TEMPORARY_SIZE_POLL_MS = 25;
const MAXIMUM_TEMPORARY_ENTRIES = 65_536;
const SAFE_GIT_CONFIG = Object.freeze([
  "-c", "credential.helper=",
  "-c", "credential.interactive=never",
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.attributesFile=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "core.untrackedCache=false",
  "-c", "protocol.allow=never",
  "-c", "protocol.version=2",
  "-c", "protocol.https.allow=always",
  "-c", "protocol.file.allow=never",
  "-c", "protocol.ext.allow=never",
  "-c", "protocol.ssh.allow=never",
  "-c", "http.followRedirects=false",
  "-c", "submodule.recurse=false",
  "-c", "fetch.recurseSubmodules=false",
  "-c", "fetch.fsckObjects=true",
  "-c", "transfer.fsckObjects=true",
  "-c", "core.deltaBaseCacheLimit=16m",
  "-c", "core.packedGitWindowSize=16m",
  "-c", "core.packedGitLimit=64m",
  "-c", "pack.deltaCacheLimit=16m",
  "-c", "pack.windowMemory=32m",
  "-c", "pack.threads=1",
  "-c", "index.threads=1",
  "-c", "maintenance.auto=false",
  "-c", "gc.auto=0"
]);

class GitCommandExecutionError extends Error {
  constructor(reason, message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "GitCommandExecutionError";
    this.reason = reason;
  }
}

/**
 * Creates an anonymous exact-object resolver. Factory options are trusted
 * process dependencies; repository content and every resolver request remain
 * untrusted data.
 */
export function createAnonymousGitHubExactObjectResolverV1(options = {}) {
  assertFactoryOptions(options);
  const runGit = options.runGit ?? runBoundedExactGitProcessV1;
  const gitExecutable = options.gitExecutable ?? "git";
  const temporaryDirectoryRoot = path.resolve(options.temporaryDirectoryRoot ?? os.tmpdir());
  const platform = options.platform ?? process.platform;

  return async function resolveAnonymousGitHubExactObjectsV1(input) {
    const request = validateRequest(input);
    if (platform !== "darwin" && platform !== "linux") {
      throw toolingBlocked("this resolver supports macOS and Linux only");
    }

    const state = {
      deadline: performance.now() + request.timeoutMs,
      gitExecutable,
      runGit
    };
    let temporaryDirectory = null;
    let operationFailed = false;

    try {
      await requireBackfillCapability(state);
      temporaryDirectory = await fs.promises.mkdtemp(path.join(temporaryDirectoryRoot, TEMPORARY_PREFIX));
      const gitDirectory = path.join(temporaryDirectory, "repository.git");
      await initializeBareRepository(state, gitDirectory, request.repositoryUri);
      await fetchExactCommit(state, gitDirectory, request.revisionObjectId);
      await validateCommitAndTree(state, gitDirectory, request.revisionObjectId, request.treeObjectId);

      if (request.paths.length === 0) {
        return { records: new Map() };
      }

      const treeRecords = await resolveTreeRecords(state, gitDirectory, request.treeObjectId, request.paths);
      await writeSparseSelection(gitDirectory, request.paths);
      await backfillSparseBlobs(state, gitDirectory);
      const objectSizes = await readObjectSizes(state, gitDirectory, treeRecords);
      enforceContentLimits(request, treeRecords, objectSizes);
      const objectBytes = await readBlobObjects(
        state,
        gitDirectory,
        treeRecords,
        request.maximumTotalBytes
      );
      return { records: buildResultRecords(treeRecords, objectSizes, objectBytes) };
    } catch (error) {
      operationFailed = true;
      throw normalizeResolverError(error);
    } finally {
      if (temporaryDirectory !== null) {
        try {
          await removeExactTemporaryDirectory(temporaryDirectory, temporaryDirectoryRoot);
        } catch (error) {
          if (!operationFailed) {
            throw toolingBlocked("temporary repository cleanup failed", error);
          }
        }
      }
    }
  };
}

function validateRequest(input) {
  if (!isPlainObject(input)) invalidRequest("exact-object request must be an object");
  const keys = Object.keys(input);
  if (keys.length !== REQUEST_KEYS.size || keys.some((key) => !REQUEST_KEYS.has(key))) {
    invalidRequest("exact-object request fields did not match the closed contract");
  }

  const repositoryUri = normalizeRepositoryUri(input.repositoryUri);
  if (!LOWER_HEX_40.test(input.revisionObjectId ?? "")) {
    invalidRequest("revisionObjectId must be a lowercase 40-hex Git object id");
  }
  if (!LOWER_HEX_40.test(input.treeObjectId ?? "")) {
    invalidRequest("treeObjectId must be a lowercase 40-hex Git object id");
  }
  if (!Array.isArray(input.paths) || input.paths.length > GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumFiles) {
    invalidRequest("paths must be an array within the file-count limit");
  }
  const paths = [...input.paths];
  if (paths.some((entry) => !isCanonicalReviewTargetPath(entry))) {
    invalidRequest("every path must satisfy the canonical review-target path contract");
  }
  if (new Set(paths).size !== paths.length) {
    invalidRequest("paths must not contain duplicates");
  }
  paths.sort(compareUtf8);

  const timeoutMs = boundedPositiveInteger(
    input.timeoutMs,
    GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTimeoutMs,
    "timeoutMs"
  );
  const maximumFileBytes = boundedPositiveInteger(
    input.maximumFileBytes,
    GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumFileBytes,
    "maximumFileBytes"
  );
  const maximumTotalBytes = boundedPositiveInteger(
    input.maximumTotalBytes,
    GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTotalBytes,
    "maximumTotalBytes"
  );
  if (maximumFileBytes > maximumTotalBytes) {
    invalidRequest("maximumFileBytes cannot exceed maximumTotalBytes");
  }

  return Object.freeze({
    repositoryUri,
    revisionObjectId: input.revisionObjectId,
    treeObjectId: input.treeObjectId,
    paths: Object.freeze(paths),
    timeoutMs,
    maximumFileBytes,
    maximumTotalBytes
  });
}

function normalizeRepositoryUri(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f-\u009f]/u.test(value)) {
    invalidRequest("repositoryUri must be a canonical public github.com URL");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    invalidRequest("repositoryUri must be a canonical public github.com URL");
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (
    parsed.protocol !== "https:"
    || parsed.hostname !== "github.com"
    || parsed.port !== ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.search !== ""
    || parsed.hash !== ""
    || segments.length !== 2
    || !GITHUB_OWNER.test(segments[0])
    || !GITHUB_REPOSITORY.test(segments[1])
    || segments[1].endsWith(".git")
    || value !== `https://github.com/${segments[0]}/${segments[1]}`
  ) {
    invalidRequest("repositoryUri must be a canonical lowercase https://github.com/owner/repository URL");
  }
  return value;
}

async function requireBackfillCapability(state) {
  const versionResult = await invokeGit(state, ["--version"], {
    maximumOutputBytes: SMALL_COMMAND_OUTPUT_BYTES,
    phase: "capability"
  });
  if (versionResult.status !== 0) {
    throw toolingBlocked(`Git ${GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.minimumGitVersion} or newer is required`);
  }
  const version = parseGitVersion(versionResult.stdout);
  if (
    version === null
    || compareNumericVersion(version, GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.minimumGitVersion) < 0
  ) {
    throw toolingBlocked(`Git ${GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.minimumGitVersion} or newer is required`);
  }
  const result = await invokeGit(state, ["backfill", "-h"], {
    acceptedStatuses: null,
    maximumOutputBytes: SMALL_COMMAND_OUTPUT_BYTES,
    phase: "capability"
  });
  const output = Buffer.concat([result.stdout, result.stderr]).toString("utf8");
  if (!/(?:^|\n)usage: git backfill(?: |\n)/u.test(output)) {
    throw toolingBlocked("git backfill --sparse is required");
  }
}

function parseGitVersion(output) {
  let source;
  try {
    source = STRICT_UTF8.decode(output);
  } catch {
    return null;
  }
  const match = /^git version ([0-9]+\.[0-9]+\.[0-9]+)(?:[^0-9.]|$)/u.exec(source.trim());
  return match?.[1] ?? null;
}

function compareNumericVersion(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

async function initializeBareRepository(state, gitDirectory, repositoryUri) {
  const init = await invokeGit(state, ["init", "--quiet", "--bare", "--object-format=sha1", gitDirectory], {
    maximumOutputBytes: SMALL_COMMAND_OUTPUT_BYTES,
    phase: "init"
  });
  requireSuccess(init, "cannot initialize the isolated bare repository");

  const remoteUrl = `${repositoryUri}.git`;
  const config = [
    "[core]",
    "\trepositoryformatversion = 0",
    "\tfilemode = true",
    "\tbare = true",
    "\thooksPath = /dev/null",
    "\tattributesFile = /dev/null",
    "\tsparseCheckout = true",
    "\tsparseCheckoutCone = false",
    "[credential]",
    "\thelper =",
    "\tinteractive = never",
    "[protocol]",
    "\tallow = never",
    "\tversion = 2",
    "[protocol \"https\"]",
    "\tallow = always",
    "[http]",
    "\tfollowRedirects = false",
    "[fetch]",
    "\trecurseSubmodules = false",
    "\tfsckObjects = true",
    "[transfer]",
    "\tfsckObjects = true",
    "[maintenance]",
    "\tauto = false",
    "[gc]",
    "\tauto = 0",
    "[remote \"origin\"]",
    `\turl = ${remoteUrl}`,
    "\tpromisor = true",
    "\tpartialclonefilter = blob:none",
    ""
  ].join("\n");
  try {
    await fs.promises.mkdir(path.join(gitDirectory, "info"), { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(path.join(gitDirectory, "config"), config, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    throw toolingBlocked("cannot configure the isolated bare repository", error);
  }
}

async function fetchExactCommit(state, gitDirectory, revisionObjectId) {
  const result = await invokeRepositoryGit(state, gitDirectory, [
    "fetch",
    "--quiet",
    "--no-tags",
    "--no-write-fetch-head",
    "--no-recurse-submodules",
    "--depth=1",
    "--filter=blob:none",
    "origin",
    revisionObjectId
  ], {
    maximumOutputBytes: SMALL_COMMAND_OUTPUT_BYTES,
    phase: "fetch",
    monitoredDirectory: gitDirectory
  });
  if (result.status !== 0) {
    throw new GitHubPublicSourceError(
      "GITHUB_UNAVAILABLE",
      "GitHub anonymous smart HTTP was unavailable while reading the REST-verified exact commit",
      { retryable: true }
    );
  }
  try {
    await fs.promises.writeFile(path.join(gitDirectory, "HEAD"), `${revisionObjectId}\n`, {
      encoding: "ascii",
      mode: 0o600
    });
  } catch (error) {
    throw toolingBlocked("cannot bind HEAD to the exact fetched commit", error);
  }
}

async function validateCommitAndTree(state, gitDirectory, revisionObjectId, treeObjectId) {
  const commitResult = await invokeRepositoryGit(state, gitDirectory, ["cat-file", "--batch"], {
    input: Buffer.from(`${revisionObjectId}\n`, "ascii"),
    maximumOutputBytes: COMMIT_OUTPUT_BYTES,
    phase: "commit",
    disableLazyFetch: true
  });
  requireSuccess(commitResult, "cannot read the exact fetched commit object");
  const commitObjects = parseBatchObjects(commitResult.stdout, [revisionObjectId]);
  const commit = commitObjects.get(revisionObjectId);
  if (commit?.type !== "commit") {
    throw new GitHubPublicSourceError("GITHUB_COMMIT_MISMATCH", "the requested revision was not an exact commit object");
  }
  verifyGitObjectId("commit", commit.bytes, revisionObjectId, "GITHUB_COMMIT_MISMATCH");
  const firstLineEnd = commit.bytes.indexOf(0x0a);
  const firstLine = firstLineEnd === -1 ? "" : commit.bytes.subarray(0, firstLineEnd).toString("ascii");
  if (firstLine !== `tree ${treeObjectId}`) {
    throw new GitHubPublicSourceError("GITHUB_TREE_MISMATCH", "the exact commit did not bind the expected root tree");
  }

  const treeResult = await invokeRepositoryGit(state, gitDirectory, [
    "cat-file",
    "--batch-check=%(objectname) %(objecttype) %(objectsize)"
  ], {
    input: Buffer.from(`${treeObjectId}\n`, "ascii"),
    maximumOutputBytes: SMALL_COMMAND_OUTPUT_BYTES,
    phase: "tree",
    disableLazyFetch: true
  });
  requireSuccess(treeResult, "cannot inspect the expected root tree object");
  const headers = parseBatchCheck(treeResult.stdout, [treeObjectId]);
  if (headers.get(treeObjectId)?.type !== "tree") {
    throw new GitHubPublicSourceError("GITHUB_TREE_NOT_REACHABLE", "the expected root tree object was unavailable");
  }
}

async function resolveTreeRecords(state, gitDirectory, treeObjectId, requestedPaths) {
  const result = await invokeRepositoryGit(state, gitDirectory, [
    "ls-tree",
    "-z",
    "--full-tree",
    treeObjectId,
    "--",
    ...requestedPaths
  ], {
    maximumOutputBytes: TREE_LIST_OUTPUT_BYTES,
    phase: "tree-paths",
    disableLazyFetch: true
  });
  requireSuccess(result, "cannot resolve declared paths in the exact root tree");
  return parseTreeRecords(result.stdout, requestedPaths);
}

async function writeSparseSelection(gitDirectory, paths) {
  const contents = `${paths.map((entry) => `/${escapeSparsePattern(entry)}`).join("\n")}\n`;
  try {
    await fs.promises.writeFile(path.join(gitDirectory, "info", "sparse-checkout"), contents, {
      encoding: "utf8",
      mode: 0o600
    });
  } catch (error) {
    throw toolingBlocked("cannot create the literal sparse object selection", error);
  }
}

async function backfillSparseBlobs(state, gitDirectory) {
  const result = await invokeRepositoryGit(state, gitDirectory, ["backfill", "--sparse"], {
    maximumOutputBytes: SMALL_COMMAND_OUTPUT_BYTES,
    phase: "backfill",
    monitoredDirectory: gitDirectory
  });
  if (result.status !== 0) {
    const output = Buffer.concat([result.stdout, result.stderr]).toString("utf8");
    if (/not a git command|unknown (?:command|option)|usage: git backfill/iu.test(output)) {
      throw toolingBlocked("git backfill --sparse is required");
    }
    throw new GitHubPublicSourceError(
      "GITHUB_UPSTREAM_REJECTED",
      "GitHub did not provide the declared blobs through anonymous sparse backfill",
      { retryable: true }
    );
  }
}

async function readObjectSizes(state, gitDirectory, treeRecords) {
  const objectIds = uniqueObjectIds(treeRecords);
  const result = await invokeRepositoryGit(state, gitDirectory, [
    "cat-file",
    "--batch-check=%(objectname) %(objecttype) %(objectsize)"
  ], {
    input: Buffer.from(`${objectIds.join("\n")}\n`, "ascii"),
    maximumOutputBytes: SMALL_COMMAND_OUTPUT_BYTES,
    phase: "blob-sizes",
    disableLazyFetch: true
  });
  requireSuccess(result, "cannot inspect the backfilled blob objects");
  return parseBatchCheck(result.stdout, objectIds);
}

function enforceContentLimits(request, treeRecords, objectSizes) {
  let totalBytes = 0;
  for (const record of treeRecords.values()) {
    const header = objectSizes.get(record.objectId);
    if (header?.type !== "blob") {
      throw new GitHubPublicSourceError(
        "GITHUB_DECLARED_PATH_NOT_FOUND",
        "A declared source blob was unavailable after sparse backfill"
      );
    }
    if (header.size > request.maximumFileBytes) {
      throw new GitHubPublicSourceError(
        "GITHUB_RESPONSE_TOO_LARGE",
        "A declared source blob exceeds the bounded inert-content limit"
      );
    }
    totalBytes += header.size;
    if (totalBytes > request.maximumTotalBytes) {
      throw new GitHubPublicSourceError(
        "GITHUB_RESPONSE_TOO_LARGE",
        "Declared source blobs exceed the aggregate inert-content limit"
      );
    }
  }
}

async function readBlobObjects(state, gitDirectory, treeRecords, maximumTotalBytes) {
  const objectIds = uniqueObjectIds(treeRecords);
  const result = await invokeRepositoryGit(state, gitDirectory, ["cat-file", "--batch"], {
    input: Buffer.from(`${objectIds.join("\n")}\n`, "ascii"),
    maximumOutputBytes: maximumTotalBytes + BATCH_PROTOCOL_OVERHEAD_BYTES,
    phase: "blobs",
    disableLazyFetch: true
  });
  requireSuccess(result, "cannot read the backfilled blob objects");
  const objects = parseBatchObjects(result.stdout, objectIds);
  for (const [objectId, object] of objects) {
    if (object.type !== "blob") {
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "a declared Git object was not a blob");
    }
    verifyGitObjectId("blob", object.bytes, objectId, "GITHUB_PROTOCOL_ERROR");
    if (isGitLfsPointer(object.bytes)) {
      throw new GitHubPublicSourceError(
        "GITHUB_DECLARED_PATH_NOT_FOUND",
        "A declared source path is a Git LFS pointer, not source bytes"
      );
    }
  }
  return objects;
}

function buildResultRecords(treeRecords, objectSizes, objectBytes) {
  const records = new Map();
  for (const [filePath, treeRecord] of treeRecords) {
    const bytes = objectBytes.get(treeRecord.objectId)?.bytes;
    const expectedSize = objectSizes.get(treeRecord.objectId)?.size;
    if (!(bytes instanceof Buffer) || bytes.length !== expectedSize) {
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "Git blob bytes did not match declared object metadata");
    }
    records.set(filePath, {
      mode: treeRecord.mode,
      objectId: treeRecord.objectId,
      bytes: Buffer.from(bytes)
    });
  }
  return records;
}

function parseTreeRecords(output, requestedPaths) {
  const requested = new Set(requestedPaths);
  const records = new Map();
  const entries = splitNulRecords(output);
  for (const entry of entries) {
    const tab = entry.indexOf(0x09);
    if (tab < 0) protocolError("Git tree output did not contain a path separator");
    const header = entry.subarray(0, tab).toString("ascii");
    const match = header.match(/^([0-7]{6}) ([a-z]+) ([0-9a-f]{40})$/u);
    if (!match) protocolError("Git tree output contained invalid object metadata");
    let filePath;
    try {
      filePath = STRICT_UTF8.decode(entry.subarray(tab + 1));
    } catch (error) {
      throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "Git tree output contained a non-UTF-8 path", {
        cause: error
      });
    }
    if (!requested.has(filePath) || records.has(filePath)) {
      protocolError("Git tree output did not match the exact declared paths");
    }
    if (match[2] !== "blob" || !REGULAR_BLOB_MODES.has(match[1])) {
      throw new GitHubPublicSourceError(
        "GITHUB_DECLARED_PATH_NOT_FOUND",
        "A declared source path was not found as a regular blob in the exact tree"
      );
    }
    records.set(filePath, { mode: match[1], objectId: match[3] });
  }
  if (records.size !== requested.size) {
    throw new GitHubPublicSourceError(
      "GITHUB_DECLARED_PATH_NOT_FOUND",
      "A declared source path was not found as a regular blob in the exact tree"
    );
  }
  return new Map([...records].sort(([left], [right]) => compareUtf8(left, right)));
}

function parseBatchCheck(output, requestedObjectIds) {
  let text;
  try {
    text = STRICT_UTF8.decode(output);
  } catch (error) {
    throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", "Git object metadata was not valid UTF-8", {
      cause: error
    });
  }
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : [];
  if (lines.length !== requestedObjectIds.length) {
    protocolError("Git object metadata count did not match the request");
  }
  const records = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const objectId = requestedObjectIds[index];
    const match = lines[index].match(/^([0-9a-f]{40}) ([a-z]+) (0|[1-9][0-9]*)$/u);
    if (!match || match[1] !== objectId) {
      protocolError("Git object metadata did not match the exact requested object");
    }
    const size = Number(match[3]);
    if (!Number.isSafeInteger(size)) protocolError("Git object size was outside the supported integer range");
    records.set(objectId, { type: match[2], size });
  }
  return records;
}

function parseBatchObjects(output, requestedObjectIds) {
  const records = new Map();
  let cursor = 0;
  for (const requestedObjectId of requestedObjectIds) {
    const headerEnd = output.indexOf(0x0a, cursor);
    if (headerEnd < cursor || headerEnd - cursor > 256) {
      protocolError("Git batch output contained an invalid object header");
    }
    const header = output.subarray(cursor, headerEnd).toString("ascii");
    const match = header.match(/^([0-9a-f]{40}) ([a-z]+) (0|[1-9][0-9]*)$/u);
    if (!match || match[1] !== requestedObjectId) {
      protocolError("Git batch output did not match the exact requested object");
    }
    const size = Number(match[3]);
    if (!Number.isSafeInteger(size)) protocolError("Git object size was outside the supported integer range");
    const bodyStart = headerEnd + 1;
    const bodyEnd = bodyStart + size;
    if (bodyEnd >= output.length || output[bodyEnd] !== 0x0a) {
      protocolError("Git batch output contained truncated object bytes");
    }
    records.set(requestedObjectId, {
      type: match[2],
      bytes: Buffer.from(output.subarray(bodyStart, bodyEnd))
    });
    cursor = bodyEnd + 1;
  }
  if (cursor !== output.length) protocolError("Git batch output contained unexpected trailing bytes");
  return records;
}

function splitNulRecords(output) {
  if (output.length === 0) return [];
  if (output.at(-1) !== 0) protocolError("Git tree output was not NUL terminated");
  const records = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index === start) protocolError("Git tree output contained an empty record");
    records.push(output.subarray(start, index));
    start = index + 1;
  }
  return records;
}

function escapeSparsePattern(value) {
  return value.replace(/[\\!#*?\[\] ]/gu, (character) => `\\${character}`);
}

function uniqueObjectIds(treeRecords) {
  return [...new Set([...treeRecords.values()].map((entry) => entry.objectId))].sort();
}

function verifyGitObjectId(type, bytes, expectedObjectId, errorCode) {
  const observedObjectId = createHash("sha1")
    .update(`${type} ${bytes.length}\0`, "utf8")
    .update(bytes)
    .digest("hex");
  if (observedObjectId !== expectedObjectId) {
    throw new GitHubPublicSourceError(errorCode, `Git ${type} bytes did not match the exact object id`);
  }
}

async function invokeRepositoryGit(state, gitDirectory, args, options) {
  return invokeGit(state, ["-C", gitDirectory, ...args], options);
}

async function invokeGit(state, args, options) {
  const remainingMs = Math.floor(state.deadline - performance.now());
  if (remainingMs < 1) {
    throw new GitHubPublicSourceError("GITHUB_TIMEOUT", "anonymous Git object resolution exceeded its deadline", {
      retryable: true
    });
  }
  let result;
  try {
    result = await state.runGit({
      gitExecutable: state.gitExecutable,
      args: [...SAFE_GIT_CONFIG, ...args],
      cwd: null,
      env: safeGitEnvironment(options.disableLazyFetch === true),
      input: options.input ?? null,
      timeoutMs: remainingMs,
      maximumOutputBytes: options.maximumOutputBytes,
      monitoredDirectory: options.monitoredDirectory ?? null,
      maximumTemporaryBytes: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTemporaryRepositoryBytes,
      maximumFileSizeBytes: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTemporaryFileBytes,
      maximumAddressSpaceBytes: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumAddressSpaceBytes,
      maximumCpuSeconds: GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumCpuSeconds
    });
  } catch (error) {
    throw toolingBlocked(`cannot execute git during ${options.phase}`, error);
  }
  if (!isGitResult(result)) {
    throw toolingBlocked(`git returned an invalid process result during ${options.phase}`);
  }
  if (result.timedOut) {
    throw new GitHubPublicSourceError("GITHUB_TIMEOUT", "anonymous Git object resolution exceeded its deadline", {
      retryable: true
    });
  }
  if (result.outputExceeded) {
    throw new GitHubPublicSourceError("GITHUB_RESPONSE_TOO_LARGE", "Git process output exceeded its byte limit");
  }
  if (result.temporaryBytesExceeded) {
    throw new GitHubPublicSourceError(
      "GITHUB_RESPONSE_TOO_LARGE",
      "Git temporary object storage exceeded its byte limit"
    );
  }
  if (result.fileSizeExceeded || result.addressSpaceExceeded || result.cpuExceeded) {
    throw new GitHubPublicSourceError(
      "GITHUB_RESPONSE_TOO_LARGE",
      "Git object resolution exceeded its bounded process resources"
    );
  }
  if (options.monitoredDirectory !== undefined) {
    let temporaryBytes;
    try {
      temporaryBytes = measureDirectoryBytes(options.monitoredDirectory);
    } catch (error) {
      throw toolingBlocked(`cannot measure temporary Git storage during ${options.phase}`, error);
    }
    if (temporaryBytes > GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTemporaryRepositoryBytes) {
      throw new GitHubPublicSourceError(
        "GITHUB_RESPONSE_TOO_LARGE",
        "Git temporary object storage exceeded its byte limit"
      );
    }
  }
  if (options.acceptedStatuses === null || (options.acceptedStatuses ?? [0]).includes(result.status)) return result;
  return result;
}

function requireSuccess(result, message) {
  if (result.status !== 0) throw toolingBlocked(message);
}

function safeGitEnvironment(disableLazyFetch) {
  const environment = Object.create(null);
  for (const name of ["PATH", "TMPDIR", "TMP", "TEMP"]) {
    if (typeof process.env[name] === "string") environment[name] = process.env[name];
  }
  environment.LANG = "C";
  environment.LC_ALL = "C";
  environment.LC_CTYPE = "C";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_LFS_SKIP_SMUDGE = "1";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_LITERAL_PATHSPECS = "1";
  environment.GIT_PROTOCOL_FROM_USER = "0";
  environment.GIT_PAGER = "cat";
  environment.GCM_INTERACTIVE = "Never";
  if (disableLazyFetch) environment.GIT_NO_LAZY_FETCH = "1";
  return environment;
}

export async function runBoundedExactGitProcessV1({
  gitExecutable,
  args,
  cwd,
  env,
  input,
  timeoutMs,
  maximumOutputBytes,
  monitoredDirectory,
  maximumTemporaryBytes,
  maximumFileSizeBytes = GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTemporaryFileBytes,
  maximumAddressSpaceBytes = GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumAddressSpaceBytes,
  maximumCpuSeconds = GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumCpuSeconds
}) {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new GitCommandExecutionError("platform", "bounded Git execution supports macOS and Linux only");
  }
  const fileLimitBlocks = Math.floor(maximumFileSizeBytes / 1024);
  const addressSpaceLimitKilobytes = process.platform === "linux"
    ? Math.floor(maximumAddressSpaceBytes / 1024)
    : 0;
  if (
    typeof gitExecutable !== "string"
    || gitExecutable.length < 1
    || /[\u0000\r\n]/u.test(gitExecutable)
    || !Array.isArray(args)
    || args.some((entry) => typeof entry !== "string" || /\u0000/u.test(entry))
    || (cwd !== null && cwd !== undefined && (typeof cwd !== "string" || cwd.length < 1 || /\u0000/u.test(cwd)))
    || !isPlainObject(env)
    || (input !== null && !(input instanceof Uint8Array))
    || !Number.isInteger(timeoutMs)
    || timeoutMs < GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.minimumTimeoutMs
    || timeoutMs > GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTimeoutMs
    || !Number.isInteger(maximumOutputBytes)
    || maximumOutputBytes < 1
    || !Number.isInteger(maximumTemporaryBytes)
    || maximumTemporaryBytes < 1
    || maximumTemporaryBytes > GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTemporaryRepositoryBytes
    || !Number.isInteger(maximumFileSizeBytes)
    || maximumFileSizeBytes < 1024
    || maximumFileSizeBytes > GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumTemporaryFileBytes
    || !Number.isInteger(maximumAddressSpaceBytes)
    || maximumAddressSpaceBytes < 64 * 1024 * 1024
    || maximumAddressSpaceBytes > GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumAddressSpaceBytes
    || !Number.isInteger(maximumCpuSeconds)
    || maximumCpuSeconds < 1
    || maximumCpuSeconds > GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.maximumCpuSeconds
    || fileLimitBlocks < 1
    || (monitoredDirectory !== null
      && (typeof monitoredDirectory !== "string" || monitoredDirectory.length < 1 || /\u0000/u.test(monitoredDirectory)))
  ) {
    throw new GitCommandExecutionError("options", "bounded Git execution received invalid trusted process options");
  }

  return new Promise((resolve, reject) => {
    // GitHub's production runner is Linux. RLIMIT_AS constrains pack expansion
    // there; macOS has no settable RLIMIT_AS, but retains the inherited file,
    // CPU, output, storage and wall-clock limits. Positional parameters keep
    // every Git argument out of shell evaluation.
    const launcher = [
      'ulimit -f "$1" || exit 125',
      'ulimit -t "$2" || exit 125',
      'if [[ "$3" != "0" ]]; then ulimit -v "$3" || exit 125; fi',
      'shift 3',
      'exec "$@"'
    ].join("; ");
    let child;
    try {
      child = childProcess.spawn("/bin/bash", [
        "--noprofile",
        "--norc",
        "-c",
        launcher,
        "bounded-exact-git",
        String(fileLimitBlocks),
        String(maximumCpuSeconds),
        String(addressSpaceLimitKilobytes),
        gitExecutable,
        ...args
      ], {
        cwd: cwd ?? undefined,
        detached: true,
        env,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      reject(new GitCommandExecutionError("spawn", "cannot spawn git", { cause: error }));
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let outputBytes = 0;
    let outputExceeded = false;
    let temporaryBytesExceeded = false;
    let timedOut = false;
    let terminated = false;
    let settled = false;
    let forceKillTimer = null;

    const killGroup = (signal) => {
      if (!Number.isInteger(child.pid)) return;
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error?.code === "ESRCH") return;
        try {
          child.kill(signal);
        } catch {
          // The process may have exited between the group and direct kill.
        }
      }
    };
    const terminate = () => {
      if (terminated) return;
      terminated = true;
      killGroup("SIGTERM");
      forceKillTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
      forceKillTimer.unref?.();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timeout.unref?.();
    const sizePoll = monitoredDirectory === null ? null : setInterval(() => {
      if (temporaryBytesExceeded || settled) return;
      try {
        if (measureDirectoryBytes(monitoredDirectory) > maximumTemporaryBytes) {
          temporaryBytesExceeded = true;
          terminate();
        }
      } catch {
        temporaryBytesExceeded = true;
        terminate();
      }
    }, TEMPORARY_SIZE_POLL_MS);
    sizePoll?.unref?.();

    const collect = (target) => (chunk) => {
      if (outputExceeded) return;
      const bytes = Buffer.from(chunk);
      outputBytes += bytes.length;
      if (outputBytes > maximumOutputBytes) {
        outputExceeded = true;
        terminate();
        return;
      }
      target.push(bytes);
    };
    child.stdout.on("data", collect(stdoutChunks));
    child.stderr.on("data", collect(stderrChunks));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (sizePoll !== null) clearInterval(sizePoll);
      killGroup("SIGKILL");
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      reject(new GitCommandExecutionError("spawn", "git process failed", { cause: error }));
    });
    child.on("close", (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (sizePoll !== null) clearInterval(sizePoll);
      // A leader that exits successfully must not leave git-remote, index-pack
      // or another helper alive outside the bounded operation.
      killGroup("SIGKILL");
      if (forceKillTimer !== null) clearTimeout(forceKillTimer);
      if (monitoredDirectory !== null) {
        try {
          if (measureDirectoryBytes(monitoredDirectory) > maximumTemporaryBytes) {
            temporaryBytesExceeded = true;
          }
        } catch {
          temporaryBytesExceeded = true;
        }
      }
      const stderr = Buffer.concat(stderrChunks);
      const stderrText = stderr.toString("utf8");
      const fileSizeExceeded = signal === "SIGXFSZ"
        || status === 153
        || /File size limit exceeded/iu.test(stderrText);
      const addressSpaceExceeded = /(?:out of memory|cannot allocate memory|memory exhausted|failed to allocate memory|bad_alloc)/iu
        .test(stderrText);
      // Bash applies the same soft and hard RLIMIT_CPU value. Linux may report
      // that hard-limit termination as SIGKILL instead of SIGXCPU. Only treat
      // an otherwise unexplained SIGKILL as a resource kill: every SIGKILL
      // initiated by our timeout/output/storage/input handling follows terminate().
      const cpuExceeded = signal === "SIGXCPU"
        || status === 152
        || (signal === "SIGKILL" && !terminated && !fileSizeExceeded && !addressSpaceExceeded);
      resolve({
        status: Number.isInteger(status) ? status : 1,
        signal,
        stdout: Buffer.concat(stdoutChunks),
        stderr,
        timedOut,
        outputExceeded,
        temporaryBytesExceeded,
        fileSizeExceeded,
        addressSpaceExceeded,
        cpuExceeded
      });
    });

    child.stdin.on("error", (error) => {
      if (error?.code !== "EPIPE" && !settled) terminate();
    });
    if (input === null) child.stdin.end();
    else child.stdin.end(input);
  });
}

async function removeExactTemporaryDirectory(directory, expectedParent) {
  const resolvedDirectory = path.resolve(directory);
  if (
    path.dirname(resolvedDirectory) !== expectedParent
    || !path.basename(resolvedDirectory).startsWith(TEMPORARY_PREFIX)
  ) {
    throw new Error("temporary directory identity changed");
  }
  await fs.promises.rm(resolvedDirectory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 20
  });
}

function normalizeResolverError(error) {
  if (error instanceof GitHubPublicSourceError) return error;
  if (error instanceof GitCommandExecutionError) return toolingBlocked("git command execution failed", error);
  return toolingBlocked("exact Git object resolution failed locally", error);
}

function measureDirectoryBytes(directory) {
  const pending = [directory];
  let entries = 0;
  let totalBytes = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      entries += 1;
      if (entries > MAXIMUM_TEMPORARY_ENTRIES) return Number.POSITIVE_INFINITY;
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        totalBytes += fs.statSync(entryPath).size;
      }
    }
  }
  return totalBytes;
}

function toolingBlocked(detail, cause = undefined) {
  return new GitHubPublicSourceError(
    "GITHUB_UPSTREAM_REJECTED",
    `Exact Git object tooling is unavailable: ${detail}`,
    cause === undefined ? {} : { cause }
  );
}

function protocolError(message) {
  throw new GitHubPublicSourceError("GITHUB_PROTOCOL_ERROR", message);
}

function invalidRequest(message) {
  throw new GitHubPublicSourceError("INVALID_REQUEST", message);
}

function boundedPositiveInteger(value, maximum, name) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    invalidRequest(`${name} must be a positive integer within the supported bound`);
  }
  return value;
}

function assertFactoryOptions(options) {
  if (!isPlainObject(options)) throw new TypeError("resolver factory options must be an object");
  const allowed = new Set(["gitExecutable", "platform", "runGit", "temporaryDirectoryRoot"]);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw new TypeError("resolver factory options contained an unsupported field");
  }
  if (
    (options.gitExecutable !== undefined
      && (typeof options.gitExecutable !== "string" || options.gitExecutable.length === 0 || /[\u0000\r\n]/u.test(options.gitExecutable)))
    || (options.runGit !== undefined && typeof options.runGit !== "function")
    || (options.platform !== undefined
      && (typeof options.platform !== "string" || options.platform.length === 0 || /[\u0000\r\n]/u.test(options.platform)))
    || (options.temporaryDirectoryRoot !== undefined
      && (typeof options.temporaryDirectoryRoot !== "string" || !path.isAbsolute(options.temporaryDirectoryRoot)))
  ) {
    throw new TypeError("resolver factory options were invalid");
  }
}

function isGitResult(value) {
  return isPlainObject(value)
    && Number.isInteger(value.status)
    && value.stdout instanceof Uint8Array
    && value.stderr instanceof Uint8Array
    && typeof value.timedOut === "boolean"
    && typeof value.outputExceeded === "boolean"
    && typeof value.temporaryBytesExceeded === "boolean"
    && typeof value.fileSizeExceeded === "boolean"
    && typeof value.addressSpaceExceeded === "boolean"
    && typeof value.cpuExceeded === "boolean";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
