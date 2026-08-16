import crypto from "node:crypto";
import { TextDecoder } from "node:util";
import { spawnSafeRawGitSync } from "./repository-root.mjs";

const gitObjectIdPattern = /^[0-9a-f]{40}$/u;
const safePathPattern = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!.*(?:^|\/)\.git(?:\/|$))(?!.*\\)(?!.*(?:%2[fF]|%5[cC]))(?!.*\/$)[^\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+$/u;
const fatalUtf8 = new TextDecoder("utf-8", { fatal: true });
const defaults = Object.freeze({
  maxObjectBytes: 64 * 1024 * 1024,
  maxTotalObjectBytes: 1024 * 1024 * 1024,
  maxTreeObjects: 1_000_000,
  maxTreeInstances: 1_000_000,
  maxEntries: 1_100_000,
  maxPathBytes: 16 * 1024,
  maxBatchOutputBytes: 96 * 1024 * 1024,
  batchSize: 256,
  gitTimeoutMs: 30_000,
  maxWallTimeMs: 15 * 60 * 1000
});

/**
 * Verify the raw commit object, its declared root tree, and every recursive raw
 * tree object by recomputing Git SHA-1 identities. Blob payloads remain the
 * caller's streaming responsibility; their exact tree identities are returned.
 */
export function verifyRawGitCommitTreeIntegrity({
  repositoryRoot,
  revisionObjectId,
  treeObjectId,
  deadlineAt,
  limits = {},
  gitRunner = spawnSafeRawGitSync
} = {}) {
  if (
    typeof repositoryRoot !== "string"
    || repositoryRoot.length === 0
    || !gitObjectIdPattern.test(revisionObjectId ?? "")
    || !gitObjectIdPattern.test(treeObjectId ?? "")
    || typeof gitRunner !== "function"
  ) throw rawGitFailure("RAW_GIT_INPUT_INVALID", "raw Git commit/tree integrity input is invalid");
  const effective = normalizeLimits(limits);
  const finalDeadline = deadlineAt ?? Date.now() + effective.maxWallTimeMs;
  assertDeadline(finalDeadline);
  const budget = { consumedBytes: 0 };
  const [commitObject] = readRawObjects({
    repositoryRoot,
    objectIds: [revisionObjectId],
    expectedType: "commit",
    deadlineAt: finalDeadline,
    limits: effective,
    budget,
    gitRunner
  });
  const commitTree = parseCommitTree(commitObject.bytes);
  if (commitTree !== treeObjectId) {
    throw rawGitFailure("RAW_GIT_COMMIT_TREE_MISMATCH", "raw commit does not bind the declared root tree", {
      objectType: "commit",
      objectId: revisionObjectId
    });
  }

  const treeCache = new Map();
  const entries = [];
  const seenPaths = new Set();
  let queue = [{ objectId: treeObjectId, prefix: "" }];
  let treeInstances = 0;
  while (queue.length > 0) {
    assertDeadline(finalDeadline);
    const missing = [];
    const queuedIds = new Set();
    for (const instance of queue) {
      if (!treeCache.has(instance.objectId) && !queuedIds.has(instance.objectId)) {
        missing.push(instance.objectId);
        queuedIds.add(instance.objectId);
      }
    }
    for (let offset = 0; offset < missing.length; offset += effective.batchSize) {
      const batch = missing.slice(offset, offset + effective.batchSize);
      const objects = readRawObjects({
        repositoryRoot,
        objectIds: batch,
        expectedType: "tree",
        deadlineAt: finalDeadline,
        limits: effective,
        budget,
        gitRunner
      });
      for (const object of objects) {
        treeCache.set(object.objectId, parseTree(object.bytes));
        if (treeCache.size > effective.maxTreeObjects) {
          throw resourceFailure("raw Git tree object count exceeds the aggregate budget");
        }
      }
    }
    const next = [];
    for (const instance of queue) {
      treeInstances += 1;
      if (treeInstances > effective.maxTreeInstances) {
        throw resourceFailure("raw Git tree instance count exceeds the aggregate budget");
      }
      const children = treeCache.get(instance.objectId);
      if (!children) throw rawGitFailure("RAW_GIT_TREE_MISSING", "raw Git tree cache is incomplete");
      for (const child of children) {
        const repositoryPath = instance.prefix === "" ? child.name : `${instance.prefix}/${child.name}`;
        if (!safePathPattern.test(repositoryPath)) {
          throw rawGitFailure("RAW_GIT_PATH_NONPORTABLE", "raw Git tree contains a nonportable repository path");
        }
        if (Buffer.byteLength(repositoryPath, "utf8") > effective.maxPathBytes) {
          throw resourceFailure("raw Git repository path exceeds the byte budget");
        }
        if (seenPaths.has(repositoryPath)) {
          throw rawGitFailure("RAW_GIT_PATH_DUPLICATE", "raw Git tree resolves one repository path more than once");
        }
        seenPaths.add(repositoryPath);
        if (child.mode === "40000") {
          next.push({ objectId: child.objectId, prefix: repositoryPath });
          continue;
        }
        entries.push({
          path: repositoryPath,
          mode: child.mode,
          type: child.mode === "160000" ? "commit" : "blob",
          objectId: child.objectId
        });
        if (entries.length > effective.maxEntries) {
          throw resourceFailure("raw Git tree entry count exceeds the aggregate budget");
        }
      }
    }
    queue = next;
  }
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  return Object.freeze({
    revisionObjectId,
    treeObjectId,
    commitObjectVerified: true,
    treeObjectsVerified: treeCache.size,
    treeInstancesVerified: treeInstances,
    objectBytesVerified: budget.consumedBytes,
    entries: Object.freeze(entries.map(Object.freeze))
  });
}

export function computeRawGitObjectId(type, bytes) {
  if (!new Set(["blob", "tree", "commit"]).has(type) || !Buffer.isBuffer(bytes)) {
    throw rawGitFailure("RAW_GIT_INPUT_INVALID", "raw Git object identity input is invalid");
  }
  return crypto.createHash("sha1")
    .update(Buffer.from(`${type} ${bytes.length}\0`, "ascii"))
    .update(bytes)
    .digest("hex");
}

function readRawObjects({ repositoryRoot, objectIds, expectedType, deadlineAt, limits, budget, gitRunner }) {
  if (objectIds.length === 0) return [];
  assertDeadline(deadlineAt);
  const result = gitRunner(["-C", repositoryRoot, "cat-file", "--batch"], {
    input: Buffer.from(`${objectIds.join("\n")}\n`, "ascii"),
    encoding: null,
    stdio: ["pipe", "pipe", "pipe"],
    timeout: remainingTimeout(deadlineAt, limits.gitTimeoutMs),
    maxBuffer: limits.maxBatchOutputBytes
  });
  if (result?.error?.code === "ENOBUFS" && objectIds.length > 1) {
    const middle = Math.ceil(objectIds.length / 2);
    const combined = [];
    for (const object of readRawObjects({
      repositoryRoot,
      objectIds: objectIds.slice(0, middle),
      expectedType,
      deadlineAt,
      limits,
      budget,
      gitRunner
    })) combined.push(object);
    for (const object of readRawObjects({
      repositoryRoot,
      objectIds: objectIds.slice(middle),
      expectedType,
      deadlineAt,
      limits,
      budget,
      gitRunner
    })) combined.push(object);
    return combined;
  }
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result?.stdout)) {
    if (result?.error?.code === "ENOBUFS") throw resourceFailure("raw Git object batch exceeds the transport budget");
    throw rawGitFailure("RAW_GIT_OBJECT_READ_FAILED", "raw Git object database is unavailable or inconsistent");
  }
  const objects = parseBatch(result.stdout, objectIds, expectedType, limits.maxObjectBytes);
  for (const object of objects) {
    const nextBytes = budget.consumedBytes + object.bytes.length;
    if (!Number.isSafeInteger(nextBytes) || nextBytes > limits.maxTotalObjectBytes) {
      throw resourceFailure("raw Git objects exceed the aggregate byte budget");
    }
    budget.consumedBytes = nextBytes;
    const observedObjectId = computeRawGitObjectId(expectedType, object.bytes);
    if (observedObjectId !== object.objectId) {
      throw rawGitFailure("RAW_GIT_OBJECT_HASH_MISMATCH", "raw Git object bytes do not hash to the requested identity", {
        objectType: expectedType,
        objectId: object.objectId
      });
    }
  }
  assertDeadline(deadlineAt);
  return objects;
}

function parseBatch(output, requestedObjectIds, expectedType, maxObjectBytes) {
  const objects = [];
  let offset = 0;
  for (const requestedObjectId of requestedObjectIds) {
    const newline = output.indexOf(0x0a, offset);
    if (newline === -1 || newline - offset > 1024) {
      throw rawGitFailure("RAW_GIT_BATCH_PROTOCOL", "raw Git batch header is invalid");
    }
    const header = output.subarray(offset, newline).toString("ascii");
    if (header === `${requestedObjectId} missing`) {
      throw rawGitFailure("RAW_GIT_OBJECT_MISSING", "raw Git object is absent from the selected object database", {
        objectType: expectedType,
        objectId: requestedObjectId
      });
    }
    const match = /^([0-9a-f]{40}) ([a-z]+) ([0-9]+)$/u.exec(header);
    if (!match || match[1] !== requestedObjectId || match[2] !== expectedType) {
      throw rawGitFailure("RAW_GIT_OBJECT_IDENTITY_INVALID", "raw Git returned a missing or unexpected object identity", {
        objectType: expectedType,
        objectId: requestedObjectId
      });
    }
    const byteLength = Number(match[3]);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maxObjectBytes) {
      throw resourceFailure("one raw Git object exceeds the per-object byte budget");
    }
    const start = newline + 1;
    const end = start + byteLength;
    if (end >= output.length || output[end] !== 0x0a) {
      throw rawGitFailure("RAW_GIT_BATCH_PROTOCOL", "raw Git batch object is truncated or lacks its delimiter");
    }
    objects.push({ objectId: requestedObjectId, bytes: Buffer.from(output.subarray(start, end)) });
    offset = end + 1;
  }
  if (offset !== output.length) throw rawGitFailure("RAW_GIT_BATCH_PROTOCOL", "raw Git batch contains trailing bytes");
  return objects;
}

function parseCommitTree(bytes) {
  const separator = bytes.indexOf(Buffer.from("\n\n", "ascii"));
  if (separator < 0) {
    throw rawGitFailure("RAW_GIT_COMMIT_PROTOCOL", "raw Git commit lacks one exact header and body separator");
  }
  const headerLines = bytes.subarray(0, separator).toString("ascii").split("\n");
  const treeHeaders = headerLines.filter((line) => line.startsWith("tree "));
  const match = /^tree ([0-9a-f]{40})$/u.exec(headerLines[0] ?? "");
  if (!match || treeHeaders.length !== 1 || treeHeaders[0] !== headerLines[0]) {
    throw rawGitFailure("RAW_GIT_COMMIT_PROTOCOL", "raw Git commit must contain exactly one leading tree identity");
  }
  return match[1];
}

function parseTree(bytes) {
  const entries = [];
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    const nul = space === -1 ? -1 : bytes.indexOf(0x00, space + 1);
    if (space <= offset || nul <= space + 1 || nul + 21 > bytes.length) {
      throw rawGitFailure("RAW_GIT_TREE_PROTOCOL", "raw Git tree contains a malformed binary entry");
    }
    const mode = bytes.subarray(offset, space).toString("ascii");
    if (!["40000", "100644", "100755", "120000", "160000"].includes(mode)) {
      throw rawGitFailure("RAW_GIT_TREE_MODE_UNSUPPORTED", "raw Git tree contains an unsupported mode");
    }
    let name;
    try {
      name = fatalUtf8.decode(bytes.subarray(space + 1, nul));
    } catch {
      throw rawGitFailure("RAW_GIT_PATH_UTF8_INVALID", "raw Git tree path is not valid UTF-8");
    }
    if (name.length === 0 || name.includes("/")) {
      throw rawGitFailure("RAW_GIT_TREE_PROTOCOL", "raw Git tree contains an invalid path segment");
    }
    entries.push({
      mode,
      name,
      objectId: bytes.subarray(nul + 1, nul + 21).toString("hex")
    });
    offset = nul + 21;
  }
  return entries;
}

function normalizeLimits(input) {
  const source = input && typeof input === "object" ? input : {};
  const result = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const value = source[key] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw rawGitFailure("RAW_GIT_LIMIT_INVALID", "raw Git integrity limit is invalid");
    }
    result[key] = value;
  }
  if (result.batchSize > 4096) throw rawGitFailure("RAW_GIT_LIMIT_INVALID", "raw Git integrity batch size is invalid");
  return Object.freeze(result);
}

function assertDeadline(deadlineAt) {
  if (!Number.isFinite(deadlineAt) || Date.now() >= deadlineAt) {
    throw rawGitFailure("RAW_GIT_DEADLINE", "raw Git integrity verification exceeded its global deadline");
  }
}

function remainingTimeout(deadlineAt, maximum) {
  assertDeadline(deadlineAt);
  return Math.max(1, Math.min(maximum, deadlineAt - Date.now()));
}

function resourceFailure(message) {
  return rawGitFailure("RAW_GIT_RESOURCE_LIMIT", message);
}

function rawGitFailure(code, message, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, metadata);
  return error;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
