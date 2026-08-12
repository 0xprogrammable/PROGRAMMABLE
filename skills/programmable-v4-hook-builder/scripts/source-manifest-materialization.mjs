import fs from "node:fs";
import path from "node:path";
import { spawnSafeRawGitSync } from "./repository-root.mjs";
import { canonicalJson } from "./submission-core.mjs";
import {
  DEFAULT_LIMITS,
  SOURCE_MANIFEST_EXIT,
  SourceManifestError,
  assertOutputStillAbsent,
  bestEffortFsyncDirectory,
  checkDeadline,
  cleanupOwnedDirectory,
  compareUtf8,
  inodeIdentity,
  normalizeLimits,
  planOutputDirectory,
  safeMessage,
  sameSnapshot,
  unlinkOwnedPath
} from "./source-manifest-shared.mjs";
import {
  readHeadSnapshot,
  verifyPlannedSourceObjects
} from "./source-manifest-git.mjs";
import { validateGeneratedPlan } from "./source-manifest-plan.mjs";

export function materializeSourceClosureManifestV1(plan, {
  fsApi = fs,
  gitRunner = spawnSafeRawGitSync,
  limits = {}
} = {}) {
  const effectiveLimits = normalizeLimits(limits, {
    chunkMaxEntries: DEFAULT_LIMITS.chunkMaxEntries,
    chunkMaxBytes: DEFAULT_LIMITS.chunkMaxBytes
  });
  validateGeneratedPlan(plan, effectiveLimits);
  const deadlineAt = Date.now() + effectiveLimits.maxWallTimeMs;
  const observedSnapshot = readHeadSnapshot(plan.repositoryRoot, gitRunner, deadlineAt, effectiveLimits);
  if (!sameSnapshot(plan.sourceSnapshot, observedSnapshot)) {
    throw new SourceManifestError(
      "SOURCE_SNAPSHOT_CHANGED",
      "HEAD changed after planning; no metadata was written",
      { exitCode: SOURCE_MANIFEST_EXIT.HELD }
    );
  }
  verifyPlannedSourceObjects(plan, gitRunner, deadlineAt, effectiveLimits);
  const output = planOutputDirectory(plan.repositoryRoot, plan.output.repositoryPath, fsApi);
  if (output.target !== plan.output.target || output.parent !== plan.output.parent) {
    throw new SourceManifestError("OUTPUT_PLAN_CHANGED", "the output directory no longer resolves to the planned location");
  }

  const lockPath = path.join(output.parent, `.${output.name}.source-manifest.lock`);
  let lockDescriptor = null;
  let lockIdentity = null;
  let staging = null;
  let stagingIdentity = null;
  try {
    try {
      lockDescriptor = fsApi.openSync(lockPath, "wx", 0o600);
      lockIdentity = inodeIdentity(fsApi.fstatSync(lockDescriptor, { bigint: true }));
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new SourceManifestError("OUTPUT_LOCKED", "another source-manifest operation is using this destination", {
          exitCode: SOURCE_MANIFEST_EXIT.HELD
        });
      }
      throw error;
    }
    assertOutputStillAbsent(output, fsApi);
    staging = fsApi.mkdtempSync(path.join(output.parent, `.${output.name}.source-manifest-staging-`));
    fsApi.chmodSync(staging, 0o700);
    stagingIdentity = inodeIdentity(fsApi.lstatSync(staging, { bigint: true }));
    for (const record of [...plan.records].sort((left, right) => compareUtf8(left.name, right.name))) {
      checkDeadline(deadlineAt);
      fsApi.writeFileSync(path.join(staging, record.name), record.bytes, { flag: "wx", mode: 0o600 });
    }
    verifyStagedRecords(staging, stagingIdentity, plan.records, fsApi);
    const finalSnapshot = readHeadSnapshot(plan.repositoryRoot, gitRunner, deadlineAt, effectiveLimits);
    if (!sameSnapshot(plan.sourceSnapshot, finalSnapshot)) {
      throw new SourceManifestError(
        "SOURCE_SNAPSHOT_CHANGED",
        "HEAD changed before the atomic metadata rename; no output directory was created",
        { exitCode: SOURCE_MANIFEST_EXIT.HELD }
      );
    }
    verifyPlannedSourceObjects(plan, gitRunner, deadlineAt, effectiveLimits);
    assertOutputStillAbsent(output, fsApi);
    fsApi.renameSync(staging, output.target);
    staging = null;
    bestEffortFsyncDirectory(output.parent, fsApi);
  } catch (error) {
    if (error instanceof SourceManifestError) throw error;
    throw new SourceManifestError("OUTPUT_WRITE_FAILED", `source-manifest materialization failed: ${safeMessage(error?.message)}`, {
      exitCode: SOURCE_MANIFEST_EXIT.HELD
    });
  } finally {
    if (staging !== null && stagingIdentity !== null) cleanupOwnedDirectory(staging, stagingIdentity, fsApi);
    if (lockDescriptor !== null) fsApi.closeSync(lockDescriptor);
    if (lockIdentity !== null) unlinkOwnedPath(lockPath, lockIdentity, fsApi);
  }
  return {
    writePerformed: true,
    directory: output.repositoryPath,
    atomicDirectoryRename: true,
    overwritten: false,
    fileCount: plan.records.length
  };
}

/** Host-neutral command runner suitable for the standalone file or open-world dispatch. */

function verifyStagedRecords(staging, expectedIdentity, records, fsApi) {
  const stat = fsApi.lstatSync(staging, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || inodeIdentity(stat) !== expectedIdentity) {
    throw new SourceManifestError("OUTPUT_STAGING_CHANGED", "the staging directory identity changed during materialization", {
      exitCode: SOURCE_MANIFEST_EXIT.HELD
    });
  }
  const observedNames = fsApi.readdirSync(staging).sort(compareUtf8);
  const expectedNames = records.map(({ name }) => name).sort(compareUtf8);
  if (canonicalJson(observedNames) !== canonicalJson(expectedNames)) {
    throw new SourceManifestError("OUTPUT_STAGING_CHANGED", "the staging directory file set changed during materialization", {
      exitCode: SOURCE_MANIFEST_EXIT.HELD
    });
  }
  for (const record of records) {
    const candidate = path.join(staging, record.name);
    const candidateStat = fsApi.lstatSync(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
      throw new SourceManifestError("OUTPUT_STAGING_CHANGED", "a staged manifest record is not a regular file", {
        exitCode: SOURCE_MANIFEST_EXIT.HELD
      });
    }
    const bytes = fsApi.readFileSync(candidate);
    if (!bytes.equals(record.bytes)) {
      throw new SourceManifestError("OUTPUT_STAGING_CHANGED", "staged manifest record bytes changed during materialization", {
        exitCode: SOURCE_MANIFEST_EXIT.HELD
      });
    }
    const descriptor = fsApi.openSync(candidate, "r");
    try {
      fsApi.fsyncSync(descriptor);
    } finally {
      fsApi.closeSync(descriptor);
    }
  }
  bestEffortFsyncDirectory(staging, fsApi);
}
