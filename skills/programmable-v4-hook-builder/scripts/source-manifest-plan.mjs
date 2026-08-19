import crypto from "node:crypto";
import fs from "node:fs";
import process from "node:process";
import {
  SOURCE_CLOSURE_MANIFEST_SCHEMA_ID,
  SOURCE_CLOSURE_MANIFEST_VERSION,
  validateSourceClosureManifestV1
} from "./public-pr-application-v3-core.mjs";
import { spawnSafeRawGitSync } from "./repository-root.mjs";
import { canonicalJson } from "./submission-core.mjs";
import {
  DEFAULT_LIMITS,
  DEFAULT_ROLE_ID,
  FRAGMENT_NAME_PREFIX,
  FRAGMENT_NAME_SUFFIX,
  FULL_SHA1_OBJECT_ID,
  ROOT_MANIFEST_NAME,
  SAFE_REPOSITORY_PATH,
  SOURCE_MANIFEST_EXIT,
  SourceManifestError,
  assertSafeRepositoryPath,
  canonicalRoleMappings,
  compareUtf8,
  gitObjectId,
  internalError,
  normalizeLimits,
  normalizeRequiredRoleMappings,
  planDigest,
  planOutputDirectory,
  resolveExactRepositoryRoot,
  resourceError,
  sameSnapshot,
  sha256,
  sumSafe,
  validateRepositoryIdentity
} from "./source-manifest-shared.mjs";
import {
  enumerateCommittedTree,
  readAndHashSourceBlobs,
  readHeadSnapshot,
  verifyPlannedSourceObjects
} from "./source-manifest-git.mjs";

/**
 * Generate a deterministic, read-only plan from the exact raw Git objects at
 * HEAD. The returned root manifest intentionally contains no commit or tree ID:
 * those belong to the post-metadata application binding, not this root schema.
 */
export function generateSourceClosureManifestV1({
  repositoryRoot,
  outputDirectory,
  repositoryUri,
  numericRepositoryId,
  requiredRoleMappings = [],
  chunkMaxEntries = DEFAULT_LIMITS.chunkMaxEntries,
  chunkMaxBytes = DEFAULT_LIMITS.chunkMaxBytes,
  limits = {},
  cwd = process.cwd(),
  fsApi = fs,
  gitRunner = spawnSafeRawGitSync
}) {
  const effectiveLimits = normalizeLimits(limits, { chunkMaxEntries, chunkMaxBytes });
  const deadlineAt = Date.now() + effectiveLimits.maxWallTimeMs;
  const root = resolveExactRepositoryRoot(repositoryRoot, cwd, fsApi);
  const output = planOutputDirectory(root, outputDirectory, fsApi);
  validateRepositoryIdentity(repositoryUri, numericRepositoryId);
  const roleMap = normalizeRequiredRoleMappings(requiredRoleMappings);
  const initialSnapshot = readHeadSnapshot(root, gitRunner, deadlineAt, effectiveLimits);
  const enumerated = enumerateCommittedTree({
    repositoryRoot: root,
    treeObjectId: initialSnapshot.treeObjectId,
    deadlineAt,
    limits: effectiveLimits,
    gitRunner
  });

  const trackedOutputPaths = enumerated.entries
    .map(({ path: repositoryPath }) => repositoryPath)
    .filter((repositoryPath) => repositoryPath === output.repositoryPath || repositoryPath.startsWith(`${output.repositoryPath}/`));
  if (trackedOutputPaths.length > 0) {
    throw new SourceManifestError(
      "OUTPUT_DIRECTORY_TRACKED",
      "the output directory already exists in the pinned Git tree; choose a new versioned directory",
      { details: { paths: trackedOutputPaths.slice(0, 32), truncated: trackedOutputPaths.length > 32 } }
    );
  }

  const outputGitlink = enumerated.gitlinks.find(({ path: gitlinkPath }) => (
    output.repositoryPath === gitlinkPath || output.repositoryPath.startsWith(`${gitlinkPath}/`)
  ));
  if (outputGitlink) {
    throw new SourceManifestError(
      "OUTPUT_DIRECTORY_INSIDE_GITLINK",
      "the output directory is inside a Gitlink namespace and cannot be written by the parent-repository manifest generator",
      { exitCode: SOURCE_MANIFEST_EXIT.HELD }
    );
  }

  const dependencyPointers = Object.freeze({
    gitlinks: Object.freeze(enumerated.gitlinks.map(({ path: repositoryPath, objectId }) => Object.freeze({
      path: repositoryPath,
      gitMode: "160000",
      commitObjectId: objectId
    })))
  });

  if (enumerated.entries.length === 0) {
    throw new SourceManifestError("SOURCE_CLOSURE_EMPTY", "the pinned Git tree contains no supported source blobs");
  }
  if (enumerated.entries.length > effectiveLimits.maxEntries) {
    throw resourceError("the pinned tree exceeds the configured source entry budget", {
      observed: enumerated.entries.length,
      maximum: effectiveLimits.maxEntries
    });
  }

  const blobMetadata = readAndHashSourceBlobs({
    repositoryRoot: root,
    entries: enumerated.entries,
    deadlineAt,
    limits: effectiveLimits,
    gitRunner
  });
  const logicalEntries = enumerated.entries.map((treeEntry) => {
    const blob = blobMetadata.get(treeEntry.objectId);
    if (!blob) throw internalError("SOURCE_BLOB_METADATA_MISSING", "source blob metadata is incomplete");
    const roles = new Set([DEFAULT_ROLE_ID]);
    if (treeEntry.mode === "120000") roles.add("symlink");
    for (const roleId of roleMap.get(treeEntry.path) ?? []) roles.add(roleId);
    return Object.freeze({
      path: treeEntry.path,
      gitMode: treeEntry.mode,
      blobObjectId: treeEntry.objectId,
      byteLength: blob.byteLength,
      sha256: blob.sha256,
      roleIds: [...roles].sort(compareUtf8)
    });
  }).sort((left, right) => compareUtf8(left.path, right.path));

  const availablePaths = new Set(logicalEntries.map(({ path: repositoryPath }) => repositoryPath));
  const missingRolePaths = [...roleMap.keys()].filter((repositoryPath) => !availablePaths.has(repositoryPath));
  if (missingRolePaths.length > 0) {
    throw new SourceManifestError(
      "REQUIRED_ROLE_PATH_MISSING",
      "one or more required role mappings do not resolve to a regular blob in the pinned tree",
      { details: { paths: missingRolePaths } }
    );
  }

  const built = buildManifestRecords({
    entries: logicalEntries,
    outputRepositoryPath: output.repositoryPath,
    repositoryUri,
    numericRepositoryId,
    chunkMaxEntries: effectiveLimits.chunkMaxEntries,
    chunkMaxBytes: effectiveLimits.chunkMaxBytes,
    limits: effectiveLimits
  });
  const finalSnapshot = readHeadSnapshot(root, gitRunner, deadlineAt, effectiveLimits);
  if (!sameSnapshot(initialSnapshot, finalSnapshot)) {
    throw new SourceManifestError(
      "SOURCE_SNAPSHOT_CHANGED",
      "HEAD changed while the source-closure plan was being generated; retry against one stable commit",
      { exitCode: SOURCE_MANIFEST_EXIT.HELD }
    );
  }

  const plan = {
    kind: "source-closure-manifest-v1-plan",
    schemaVersion: "1.0.0",
    repositoryRoot: root,
    output,
    sourceSnapshot: initialSnapshot,
    repository: { numericRepositoryId, repositoryUri },
    dependencyPointers,
    requiredRoleMappings: canonicalRoleMappings(roleMap),
    records: built.records,
    manifest: built.manifest,
    manifestBindingTemplate: built.manifestBindingTemplate,
    stats: {
      entryCount: logicalEntries.length,
      fragmentCount: built.fragments.length,
      sourceBytes: sumSafe(logicalEntries.map(({ byteLength }) => byteLength), "source byte count"),
      outputBytes: sumSafe(built.records.map(({ byteLength }) => byteLength), "output byte count"),
      symlinkEntries: logicalEntries.filter(({ gitMode }) => gitMode === "120000").length,
      gitlinkEntries: dependencyPointers.gitlinks.length
    },
    deterministicPlanSha256: planDigest({
      sourceSnapshot: initialSnapshot,
      outputDirectory: output.repositoryPath,
      repository: { numericRepositoryId, repositoryUri },
      dependencyPointers,
      requiredRoleMappings: canonicalRoleMappings(roleMap),
      records: built.records
    }),
    safety: {
      rawCommittedGitObjectsOnly: true,
      worktreeSourceBytesRead: false,
      candidateCodeExecuted: false,
      gitFiltersOrLfsExecuted: false,
      hooksExecuted: false,
      submodulesExecuted: false,
      networkAccessed: false,
      gitlinksBoundByParentTree: true,
      reservedManifestPathsExcludedFromEntryClosure: true
    }
  };
  validateGeneratedPlan(plan, effectiveLimits);
  verifyPlannedSourceObjects(plan, gitRunner, deadlineAt, effectiveLimits);
  return plan;
}

/** Materialize a previously generated plan without replacing any destination. */

function buildManifestRecords({
  entries,
  outputRepositoryPath,
  repositoryUri,
  numericRepositoryId,
  chunkMaxEntries,
  chunkMaxBytes,
  limits
}) {
  const fragments = [];
  let currentEntries = [];
  let currentLines = [];
  let currentBytes = 0;
  const finalize = () => {
    if (currentEntries.length === 0) return;
    const sequence = fragments.length;
    const name = `${FRAGMENT_NAME_PREFIX}${String(sequence).padStart(6, "0")}${FRAGMENT_NAME_SUFFIX}`;
    const repositoryPath = `${outputRepositoryPath}/${name}`;
    assertSafeRepositoryPath(repositoryPath, "generated fragment path");
    const bytes = Buffer.concat(currentLines, currentBytes);
    fragments.push({
      name,
      repositoryPath,
      bytes,
      sequence,
      entries: currentEntries,
      sha256: sha256(bytes),
      blobObjectId: gitObjectId("blob", bytes)
    });
    currentEntries = [];
    currentLines = [];
    currentBytes = 0;
  };
  for (const entry of entries) {
    const line = Buffer.from(`${canonicalJson(entry)}\n`, "utf8");
    if (line.length > chunkMaxBytes) {
      throw resourceError("one canonical source entry exceeds the configured fragment byte ceiling", {
        path: entry.path,
        observed: line.length,
        maximum: chunkMaxBytes
      });
    }
    if (currentEntries.length > 0 && (currentEntries.length >= chunkMaxEntries || currentBytes + line.length > chunkMaxBytes)) {
      finalize();
    }
    currentEntries.push(entry);
    currentLines.push(line);
    currentBytes += line.length;
  }
  finalize();

  const closureHash = crypto.createHash("sha256");
  for (const fragment of fragments) closureHash.update(fragment.bytes);
  const manifest = {
    schemaVersion: SOURCE_CLOSURE_MANIFEST_VERSION,
    repository: { numericRepositoryId, repositoryUri },
    ordering: "repository-path-utf8-bytewise-ascending",
    fragmentEncoding: "canonical-json-lines-v1",
    entrySchemaId: `${SOURCE_CLOSURE_MANIFEST_SCHEMA_ID}#/$defs/sourceEntry`,
    entryCount: entries.length,
    fragmentCount: fragments.length,
    closureSha256: `sha256:${closureHash.digest("hex")}`,
    fragments: fragments.map((fragment) => ({
      id: `${FRAGMENT_NAME_PREFIX}${String(fragment.sequence).padStart(6, "0")}`,
      sequence: fragment.sequence,
      path: fragment.repositoryPath,
      sha256: fragment.sha256,
      byteLength: fragment.bytes.length,
      blobObjectId: fragment.blobObjectId,
      entryCount: fragment.entries.length,
      firstPath: fragment.entries[0].path,
      lastPath: fragment.entries.at(-1).path
    }))
  };
  const validation = validateSourceClosureManifestV1(manifest);
  if (!validation.valid) {
    throw internalError("GENERATED_MANIFEST_INVALID", "the generated root manifest failed its authoritative validator", {
      findings: validation.findings
    });
  }
  const rootRepositoryPath = `${outputRepositoryPath}/${ROOT_MANIFEST_NAME}`;
  assertSafeRepositoryPath(rootRepositoryPath, "generated root manifest path");
  const rootBytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  if (rootBytes.length > limits.maxRootManifestBytes) {
    throw resourceError("the generated root manifest exceeds its configured byte budget", {
      observed: rootBytes.length,
      maximum: limits.maxRootManifestBytes
    });
  }
  const records = [
    {
      name: ROOT_MANIFEST_NAME,
      repositoryPath: rootRepositoryPath,
      bytes: rootBytes,
      byteLength: rootBytes.length,
      sha256: sha256(rootBytes),
      blobObjectId: gitObjectId("blob", rootBytes),
      mediaType: "application/json"
    },
    ...fragments.map((fragment) => ({
      name: fragment.name,
      repositoryPath: fragment.repositoryPath,
      bytes: fragment.bytes,
      byteLength: fragment.bytes.length,
      sha256: fragment.sha256,
      blobObjectId: fragment.blobObjectId,
      mediaType: "application/x-ndjson"
    }))
  ].sort((left, right) => compareUtf8(left.name, right.name));
  const outputBytes = sumSafe(records.map(({ byteLength }) => byteLength), "generated output byte count");
  if (outputBytes > limits.maxOutputBytes) {
    throw resourceError("the generated metadata exceeds its configured aggregate byte budget", {
      observed: outputBytes,
      maximum: limits.maxOutputBytes
    });
  }
  return {
    fragments,
    manifest,
    records,
    manifestBindingTemplate: {
      schemaId: SOURCE_CLOSURE_MANIFEST_SCHEMA_ID,
      schemaVersion: SOURCE_CLOSURE_MANIFEST_VERSION,
      path: rootRepositoryPath,
      sha256: sha256(rootBytes),
      byteLength: rootBytes.length,
      blobObjectId: gitObjectId("blob", rootBytes),
      entryCount: entries.length,
      fragmentCount: fragments.length
    }
  };
}

export function validateGeneratedPlan(plan, limits) {
  if (
    !plan
    || plan.kind !== "source-closure-manifest-v1-plan"
    || !Array.isArray(plan.records)
    || plan.records.length < 2
    || !FULL_SHA1_OBJECT_ID.test(plan.sourceSnapshot?.revisionObjectId ?? "")
    || !FULL_SHA1_OBJECT_ID.test(plan.sourceSnapshot?.treeObjectId ?? "")
  ) {
    throw internalError("SOURCE_MANIFEST_PLAN_INVALID", "source-manifest plan has an invalid closed shape");
  }
  if (
    !plan.dependencyPointers
    || canonicalJson(Object.keys(plan.dependencyPointers).sort()) !== canonicalJson(["gitlinks"])
    || !Array.isArray(plan.dependencyPointers.gitlinks)
  ) {
    throw internalError("SOURCE_MANIFEST_PLAN_TAMPERED", "source-manifest dependency pointer summary is invalid");
  }
  let previousGitlinkPath = null;
  for (const gitlink of plan.dependencyPointers.gitlinks) {
    if (
      !gitlink
      || canonicalJson(Object.keys(gitlink).sort()) !== canonicalJson(["commitObjectId", "gitMode", "path"])
      || gitlink.gitMode !== "160000"
      || !FULL_SHA1_OBJECT_ID.test(gitlink.commitObjectId ?? "")
      || typeof gitlink.path !== "string"
      || !SAFE_REPOSITORY_PATH.test(gitlink.path)
      || (previousGitlinkPath !== null && compareUtf8(previousGitlinkPath, gitlink.path) >= 0)
    ) {
      throw internalError("SOURCE_MANIFEST_PLAN_TAMPERED", "source-manifest Gitlink pointer identities are invalid");
    }
    previousGitlinkPath = gitlink.path;
  }
  const names = new Set();
  let outputBytes = 0;
  for (const record of plan.records) {
    if (
      !record
      || typeof record.name !== "string"
      || record.name.includes("/")
      || !Buffer.isBuffer(record.bytes)
      || record.byteLength !== record.bytes.length
      || record.sha256 !== sha256(record.bytes)
      || record.blobObjectId !== gitObjectId("blob", record.bytes)
      || names.has(record.name)
    ) {
      throw internalError("SOURCE_MANIFEST_PLAN_TAMPERED", "source-manifest record bytes or identities changed after planning");
    }
    names.add(record.name);
    outputBytes += record.byteLength;
    if (!Number.isSafeInteger(outputBytes) || outputBytes > limits.maxOutputBytes) {
      throw resourceError("source-manifest records exceed the configured output budget", {
        maximum: limits.maxOutputBytes
      });
    }
  }
  const rootRecord = plan.records.find(({ name }) => name === ROOT_MANIFEST_NAME);
  if (!rootRecord || rootRecord.bytes.toString("utf8") !== `${canonicalJson(plan.manifest)}\n`) {
    throw internalError("SOURCE_MANIFEST_PLAN_TAMPERED", "root-manifest bytes changed after planning");
  }
  const validation = validateSourceClosureManifestV1(plan.manifest);
  if (!validation.valid) {
    throw internalError("SOURCE_MANIFEST_PLAN_TAMPERED", "root manifest no longer passes its authoritative validator");
  }
  const expectedManifestBinding = {
    schemaId: SOURCE_CLOSURE_MANIFEST_SCHEMA_ID,
    schemaVersion: SOURCE_CLOSURE_MANIFEST_VERSION,
    path: `${plan.output.repositoryPath}/${ROOT_MANIFEST_NAME}`,
    sha256: rootRecord.sha256,
    byteLength: rootRecord.byteLength,
    blobObjectId: rootRecord.blobObjectId,
    entryCount: plan.manifest.entryCount,
    fragmentCount: plan.manifest.fragmentCount
  };
  if (canonicalJson(plan.manifestBindingTemplate) !== canonicalJson(expectedManifestBinding)) {
    throw internalError("SOURCE_MANIFEST_PLAN_TAMPERED", "root-manifest application binding changed after planning");
  }
  const expectedPlanDigest = planDigest({
    sourceSnapshot: plan.sourceSnapshot,
    outputDirectory: plan.output.repositoryPath,
    repository: plan.repository,
    dependencyPointers: plan.dependencyPointers,
    requiredRoleMappings: plan.requiredRoleMappings,
    records: plan.records
  });
  if (expectedPlanDigest !== plan.deterministicPlanSha256) {
    throw internalError("SOURCE_MANIFEST_PLAN_TAMPERED", "source-manifest plan digest changed after planning");
  }
}
