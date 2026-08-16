import {
  classifyPublicPrApplicationV3RawGitFailure
} from "./public-pr-application-v3-core.mjs";
import { verifyRawGitCommitTreeIntegrity } from "./raw-git-integrity-core.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { parseBoundedStrictJson } from "./strict-json-core.mjs";
import {
  FULL_SHA1_OBJECT_ID,
  SourceManifestError,
  SOURCE_MANIFEST_EXIT,
  assertPortableCommittedRepositoryPath,
  assertRepositoryPathBudget,
  batches,
  checkDeadline,
  compareUtf8,
  fatalUtf8,
  gitObjectId,
  internalError,
  resourceError,
  sha256,
  sumSafe
} from "./source-manifest-shared.mjs";

export function enumerateCommittedTree({ repositoryRoot, treeObjectId, deadlineAt, limits, gitRunner }) {
  const treeCache = new Map();
  const entries = [];
  const gitlinks = [];
  const seenPaths = new Set();
  let queue = [{ objectId: treeObjectId, prefix: "" }];
  let treeInstances = 0;
  while (queue.length > 0) {
    checkDeadline(deadlineAt);
    const missingIds = [...new Set(queue.map(({ objectId }) => objectId).filter((objectId) => !treeCache.has(objectId)))];
    for (const batch of batches(missingIds, limits.blobBatchSize)) {
      const objects = readRawGitObjects({
        repositoryRoot,
        objectIds: batch,
        expectedType: "tree",
        maximumObjectBytes: limits.maxTreeObjectBytes,
        deadlineAt,
        limits,
        gitRunner
      });
      for (const object of objects) {
        treeCache.set(object.objectId, parseRawTreeObject(object.bytes));
      }
    }
    const next = [];
    for (const treeInstance of queue) {
      treeInstances += 1;
      if (treeInstances > limits.maxTreeInstances) {
        throw resourceError("the pinned tree exceeds the configured tree-instance budget", {
          maximum: limits.maxTreeInstances
        });
      }
      const children = treeCache.get(treeInstance.objectId);
      if (!children) throw internalError("SOURCE_TREE_METADATA_MISSING", "source tree metadata is incomplete");
      for (const child of children) {
        const repositoryPath = treeInstance.prefix === "" ? child.name : `${treeInstance.prefix}/${child.name}`;
        assertPortableCommittedRepositoryPath(repositoryPath);
        assertRepositoryPathBudget(repositoryPath, limits);
        if (seenPaths.has(repositoryPath)) {
          throw new SourceManifestError("SOURCE_PATH_DUPLICATE", "the raw Git tree resolves the same repository path more than once", {
            details: { path: repositoryPath }
          });
        }
        seenPaths.add(repositoryPath);
        if (child.mode === "40000") {
          next.push({ objectId: child.objectId, prefix: repositoryPath });
          continue;
        }
        if (child.mode === "160000") {
          gitlinks.push({ path: repositoryPath, objectId: child.objectId });
          continue;
        }
        if (!["100644", "100755", "120000"].includes(child.mode)) {
          throw new SourceManifestError("SOURCE_GIT_MODE_UNSUPPORTED", "the pinned tree contains an unsupported Git mode", {
            details: { path: repositoryPath, gitMode: child.mode }
          });
        }
        entries.push({ path: repositoryPath, mode: child.mode, objectId: child.objectId });
        if (entries.length > limits.maxEntries) {
          throw resourceError("the pinned tree exceeds the configured source entry budget", {
            maximum: limits.maxEntries
          });
        }
      }
    }
    queue = next;
  }
  entries.sort((left, right) => compareUtf8(left.path, right.path));
  gitlinks.sort((left, right) => compareUtf8(left.path, right.path));
  return { entries, gitlinks };
}

function parseRawTreeObject(bytes) {
  const children = [];
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    const nul = space === -1 ? -1 : bytes.indexOf(0x00, space + 1);
    if (space <= offset || nul <= space + 1 || nul + 21 > bytes.length) {
      throw new SourceManifestError("SOURCE_GIT_TREE_PROTOCOL", "a raw Git tree object has an invalid binary entry");
    }
    const mode = bytes.subarray(offset, space).toString("ascii");
    if (!["40000", "100644", "100755", "120000", "160000"].includes(mode)) {
      throw new SourceManifestError("SOURCE_GIT_MODE_UNSUPPORTED", "a raw Git tree object contains an unsupported mode", {
        details: { gitMode: mode }
      });
    }
    const nameBytes = bytes.subarray(space + 1, nul);
    let name;
    try {
      name = fatalUtf8.decode(nameBytes);
    } catch {
      throw new SourceManifestError(
        "SOURCE_PATH_UTF8_INVALID",
        "a committed Git path is not valid UTF-8 and cannot be represented by source-closure manifest v1",
        { exitCode: SOURCE_MANIFEST_EXIT.HELD }
      );
    }
    if (name.length === 0 || name.includes("/")) {
      throw new SourceManifestError("SOURCE_GIT_TREE_PROTOCOL", "a raw Git tree object contains an invalid path segment");
    }
    const objectId = bytes.subarray(nul + 1, nul + 21).toString("hex");
    children.push({ mode, name, objectId });
    offset = nul + 21;
  }
  return children;
}

export function readAndHashSourceBlobs({ repositoryRoot, entries, deadlineAt, limits, gitRunner }) {
  const uniqueIds = [...new Set(entries.map(({ objectId }) => objectId))];
  const metadata = new Map();
  for (const batch of batches(uniqueIds, limits.blobBatchSize)) {
    checkDeadline(deadlineAt);
    const objects = readRawGitObjects({
      repositoryRoot,
      objectIds: batch,
      expectedType: "blob",
      maximumObjectBytes: limits.maxSourceBlobBytes,
      deadlineAt,
      limits,
      gitRunner
    });
    for (const object of objects) {
      metadata.set(object.objectId, {
        byteLength: object.bytes.length,
        sha256: sha256(object.bytes)
      });
    }
  }
  const totalSourceBytes = sumSafe(entries.map(({ objectId }) => metadata.get(objectId)?.byteLength ?? 0), "source byte count");
  if (totalSourceBytes > limits.maxTotalSourceBytes) {
    throw resourceError("the pinned source blobs exceed the configured aggregate byte budget", {
      observed: totalSourceBytes,
      maximum: limits.maxTotalSourceBytes
    });
  }
  return metadata;
}

export function verifyPlannedSourceObjects(plan, gitRunner, deadlineAt, limits) {
  let rawIntegrity;
  try {
    rawIntegrity = verifyRawGitCommitTreeIntegrity({
      repositoryRoot: plan.repositoryRoot,
      revisionObjectId: plan.sourceSnapshot.revisionObjectId,
      treeObjectId: plan.sourceSnapshot.treeObjectId,
      deadlineAt,
      limits: {
        maxObjectBytes: limits.maxTreeObjectBytes,
        maxTotalObjectBytes: limits.maxTotalSourceBytes,
        maxTreeObjects: limits.maxTreeInstances,
        maxTreeInstances: limits.maxTreeInstances,
        maxEntries: limits.maxEntries + (plan.dependencyPointers?.gitlinks?.length ?? 0),
        maxPathBytes: limits.maxRepositoryPathBytes,
        maxBatchOutputBytes: limits.maxGitBatchOutputBytes,
        batchSize: limits.blobBatchSize,
        gitTimeoutMs: limits.gitTimeoutMs,
        maxWallTimeMs: limits.maxWallTimeMs
      },
      gitRunner
    });
  } catch (error) {
    const failure = classifyPublicPrApplicationV3RawGitFailure(error);
    const code = failure.disposition === "split-review"
      ? "SOURCE_MANIFEST_RESOURCE_LIMIT"
      : failure.disposition === "availability"
        ? "SOURCE_GIT_OBJECTS_UNAVAILABLE"
        : error?.code === "RAW_GIT_OBJECT_HASH_MISMATCH"
          ? "SOURCE_GIT_OBJECT_HASH_MISMATCH"
          : "SOURCE_GIT_INTEGRITY_INVALID";
    const message = failure.disposition === "availability"
      ? "the selected local Git object store is shallow, pruned, or temporarily unable to provide the exact pinned objects"
      : failure.disposition === "split-review"
        ? "the bounded raw-Git verifier reached a tooling resource limit"
        : "the raw commit or recursive source tree changed or failed exact identity verification";
    throw new SourceManifestError(code, message, {
      exitCode: SOURCE_MANIFEST_EXIT.HELD,
      details: { integrityCode: failure.integrityCode }
    });
  }
  const expectedEntries = [];
  for (const record of plan.records.filter(({ mediaType }) => mediaType === "application/x-ndjson")) {
    for (const line of record.bytes.toString("utf8").split("\n")) {
      if (line.length === 0) continue;
      const entry = parseBoundedStrictJson(line, {
        maxSourceBytes: limits.maxSourceBlobBytes,
        maxDepth: 64,
        maxNodes: 1_024,
        maxNumberCharacters: 1_024
      });
      expectedEntries.push({
        path: entry.path,
        mode: entry.gitMode,
        type: "blob",
        objectId: entry.blobObjectId,
        byteLength: entry.byteLength,
        sha256: entry.sha256
      });
    }
  }
  for (const gitlink of plan.dependencyPointers?.gitlinks ?? []) {
    expectedEntries.push({
      path: gitlink.path,
      mode: "160000",
      type: "commit",
      objectId: gitlink.commitObjectId,
      byteLength: null,
      sha256: null
    });
  }
  expectedEntries.sort((left, right) => compareUtf8(left.path, right.path));
  const observedIdentities = rawIntegrity.entries.map(({ path: repositoryPath, mode, type, objectId }) => ({
    path: repositoryPath,
    mode,
    type,
    objectId
  }));
  const expectedIdentities = expectedEntries.map(({ path: repositoryPath, mode, type, objectId }) => ({
    path: repositoryPath,
    mode,
    type,
    objectId
  }));
  if (canonicalJson(observedIdentities) !== canonicalJson(expectedIdentities)) {
    throw new SourceManifestError("SOURCE_SNAPSHOT_CHANGED", "the recursive raw source tree no longer equals the exact planned closure", {
      exitCode: SOURCE_MANIFEST_EXIT.HELD
    });
  }
  const blobEntries = rawIntegrity.entries.filter(({ type }) => type === "blob");
  const blobMetadata = readAndHashSourceBlobs({
    repositoryRoot: plan.repositoryRoot,
    entries: blobEntries,
    deadlineAt,
    limits,
    gitRunner
  });
  for (const expected of expectedEntries.filter(({ type }) => type === "blob")) {
    const observed = blobMetadata.get(expected.objectId);
    if (observed?.byteLength !== expected.byteLength || observed?.sha256 !== expected.sha256) {
      throw new SourceManifestError("SOURCE_GIT_OBJECT_HASH_MISMATCH", "a raw source blob no longer matches the exact planned closure bytes", {
        exitCode: SOURCE_MANIFEST_EXIT.HELD,
        details: { objectId: expected.objectId, objectType: "blob" }
      });
    }
  }
}

function readRawGitObjects({
  repositoryRoot,
  objectIds,
  expectedType,
  maximumObjectBytes,
  deadlineAt,
  limits,
  gitRunner
}) {
  if (objectIds.length === 0) return [];
  checkDeadline(deadlineAt);
  const timeout = Math.max(1, Math.min(limits.gitTimeoutMs, deadlineAt - Date.now()));
  const result = gitRunner(["-C", repositoryRoot, "cat-file", "--batch"], {
    input: Buffer.from(`${objectIds.join("\n")}\n`, "ascii"),
    encoding: null,
    stdio: ["pipe", "pipe", "pipe"],
    timeout,
    maxBuffer: limits.maxGitBatchOutputBytes
  });
  if (result?.error?.code === "ENOBUFS" && objectIds.length > 1) {
    const middle = Math.ceil(objectIds.length / 2);
    return [
      ...readRawGitObjects({ repositoryRoot, objectIds: objectIds.slice(0, middle), expectedType, maximumObjectBytes, deadlineAt, limits, gitRunner }),
      ...readRawGitObjects({ repositoryRoot, objectIds: objectIds.slice(middle), expectedType, maximumObjectBytes, deadlineAt, limits, gitRunner })
    ];
  }
  if (result?.error || result?.status !== 0 || !Buffer.isBuffer(result?.stdout)) {
    if (result?.error?.code === "ENOBUFS") {
      throw resourceError("one raw Git object exceeds the bounded batch transport", {
        maximumBatchOutputBytes: limits.maxGitBatchOutputBytes
      });
    }
    throw new SourceManifestError("SOURCE_GIT_OBJECT_READ_FAILED", "unable to read raw objects from the pinned local Git database", {
      exitCode: SOURCE_MANIFEST_EXIT.HELD
    });
  }
  checkDeadline(deadlineAt);
  const parsed = parseCatFileBatch(result.stdout, objectIds, expectedType, maximumObjectBytes);
  for (const object of parsed) {
    if (gitObjectId(expectedType, object.bytes) !== object.objectId) {
      throw new SourceManifestError("SOURCE_GIT_OBJECT_HASH_MISMATCH", "a raw Git object does not match its declared object ID", {
        exitCode: SOURCE_MANIFEST_EXIT.HELD,
        details: { objectId: object.objectId, objectType: expectedType }
      });
    }
  }
  return parsed;
}

function parseCatFileBatch(output, requestedObjectIds, expectedType, maximumObjectBytes) {
  const objects = [];
  let offset = 0;
  for (const requestedObjectId of requestedObjectIds) {
    const newline = output.indexOf(0x0a, offset);
    if (newline === -1 || newline - offset > 1024) {
      throw new SourceManifestError("SOURCE_GIT_BATCH_PROTOCOL", "raw Git object output has an invalid header");
    }
    const header = output.subarray(offset, newline).toString("ascii");
    const match = /^([0-9a-f]{40}) ([a-z]+) ([0-9]+)$/u.exec(header);
    if (!match || match[1] !== requestedObjectId || match[2] !== expectedType) {
      throw new SourceManifestError("SOURCE_GIT_OBJECT_IDENTITY_INVALID", "raw Git returned a missing or unexpected object identity", {
        details: { requestedObjectId, expectedType }
      });
    }
    const byteLength = Number(match[3]);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maximumObjectBytes) {
      throw resourceError("one raw Git object exceeds its configured byte budget", {
        objectId: requestedObjectId,
        observed: match[3],
        maximum: maximumObjectBytes
      });
    }
    const start = newline + 1;
    const end = start + byteLength;
    if (end >= output.length || output[end] !== 0x0a) {
      throw new SourceManifestError("SOURCE_GIT_BATCH_PROTOCOL", "raw Git object output is truncated or has an invalid delimiter");
    }
    objects.push({ objectId: requestedObjectId, bytes: Buffer.from(output.subarray(start, end)) });
    offset = end + 1;
  }
  if (offset !== output.length) {
    throw new SourceManifestError("SOURCE_GIT_BATCH_PROTOCOL", "raw Git object output contains unexpected trailing bytes");
  }
  return objects;
}

export function readHeadSnapshot(repositoryRoot, gitRunner, deadlineAt, limits) {
  checkDeadline(deadlineAt);
  const revisionObjectId = runRawGitText(
    repositoryRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    gitRunner,
    deadlineAt,
    limits
  );
  if (!FULL_SHA1_OBJECT_ID.test(revisionObjectId)) {
    throw new SourceManifestError(
      "SOURCE_GIT_OBJECT_FORMAT_UNSUPPORTED",
      "source-closure manifest v1 currently requires a 40-hex SHA-1 Git object database; use a versioned multi-hash transport when available",
      { exitCode: SOURCE_MANIFEST_EXIT.HELD }
    );
  }
  const treeObjectId = runRawGitText(
    repositoryRoot,
    ["rev-parse", "--verify", `${revisionObjectId}^{tree}`],
    gitRunner,
    deadlineAt,
    limits
  );
  if (!FULL_SHA1_OBJECT_ID.test(treeObjectId)) {
    throw new SourceManifestError("SOURCE_GIT_TREE_INVALID", "HEAD does not resolve to one full SHA-1 tree object");
  }
  return { revisionObjectId, treeObjectId };
}

function runRawGitText(repositoryRoot, argumentsList, gitRunner, deadlineAt, limits) {
  const timeout = Math.max(1, Math.min(limits.gitTimeoutMs, deadlineAt - Date.now()));
  const result = gitRunner(["-C", repositoryRoot, ...argumentsList], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
    maxBuffer: 1024 * 1024
  });
  if (result?.error || result?.status !== 0 || typeof result?.stdout !== "string") {
    throw new SourceManifestError("SOURCE_GIT_SNAPSHOT_UNAVAILABLE", "the exact local HEAD snapshot is unavailable", {
      exitCode: SOURCE_MANIFEST_EXIT.HELD
    });
  }
  checkDeadline(deadlineAt);
  return result.stdout.trim();
}
