import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CENTRAL_APPLICATION_FILES } from "./cli-central-package.mjs";
import { validateLocalDraftReplacement } from "./cli-local-draft.mjs";
import { CliFailure, sanitizeMessage } from "./cli-runtime.mjs";

const APPLICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CONTROL_OR_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const MAX_APPLICATION_ID_LENGTH = 80;
const MAX_PACKAGE_BYTES = 512 * 1024;

export function preflightCentralPackageOutput({
  outputDirectory,
  baseDirectory,
  applicationId,
  replaceExisting = false,
  replaceDraft = false
}) {
  validateApplicationId(applicationId);
  if (typeof replaceExisting !== "boolean" || typeof replaceDraft !== "boolean" || (replaceExisting && replaceDraft)) {
    throw new CliFailure(
      "OUTPUT_PATH_INVALID",
      "replace-existing and replace-draft must be explicit, mutually exclusive booleans",
      { exitCode: 1 }
    );
  }
  const replacing = replaceExisting || replaceDraft;
  if (
    typeof outputDirectory !== "string"
    || outputDirectory.length === 0
    || outputDirectory.includes("\\")
    || CONTROL_OR_BIDI_PATTERN.test(outputDirectory)
  ) {
    invalidPath("output directory contains unsafe characters");
  }
  const rawSegments = outputDirectory.split("/");
  if (rawSegments.some((segment) => segment === "." || segment === ".." || segment.toLowerCase() === ".git")) {
    invalidPath("output directory contains a traversal or Git-control segment");
  }

  let base;
  try {
    base = fs.realpathSync(baseDirectory);
  } catch {
    invalidPath("output base directory is unavailable");
  }
  const lexicalTarget = path.resolve(base, outputDirectory);
  const directoryName = path.basename(lexicalTarget);
  if (
    directoryName.length > MAX_APPLICATION_ID_LENGTH
    || !APPLICATION_ID_PATTERN.test(directoryName)
    || directoryName.toLowerCase() === ".git"
  ) {
    invalidPath("output application directory name is not canonical");
  }
  if (directoryName !== applicationId) {
    invalidPath("output application directory name must exactly equal the application id");
  }
  rejectGitControlPath(lexicalTarget);

  const lexicalParent = path.dirname(lexicalTarget);
  const filesystemRoot = path.parse(lexicalTarget).root;
  const home = canonicalExistingDirectory(os.homedir());
  const temporaryRoot = canonicalExistingDirectory(os.tmpdir());
  const broadTargets = new Set([filesystemRoot, home, temporaryRoot, base].filter(Boolean));
  if (broadTargets.has(lexicalTarget) || new Set([filesystemRoot, home, temporaryRoot, base]).has(lexicalParent)) {
    invalidPath("output directory is a root, home, repository, or other broad target");
  }

  let parentStat;
  try {
    parentStat = fs.lstatSync(lexicalParent);
  } catch {
    throw new CliFailure("OUTPUT_PARENT_INVALID", "output parent must already exist", { exitCode: 1 });
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new CliFailure("OUTPUT_PARENT_INVALID", "output parent must be a real directory, not a symbolic link", { exitCode: 1 });
  }
  assertNoSymlinkComponents(lexicalParent);

  let canonicalParent;
  try {
    canonicalParent = fs.realpathSync(lexicalParent);
  } catch {
    throw new CliFailure("OUTPUT_PARENT_INVALID", "output parent cannot be resolved", { exitCode: 1 });
  }
  rejectGitControlPath(canonicalParent);
  if (new Set([filesystemRoot, home, temporaryRoot, base]).has(canonicalParent)) {
    invalidPath("output parent is a root, home, repository, or other broad directory");
  }

  const targetDirectory = path.join(canonicalParent, directoryName);
  const targetStat = lstatOrNull(targetDirectory);
  if (targetStat !== null && !replacing) {
    throw new CliFailure("OUTPUT_TARGET_EXISTS", "output application directory already exists", { exitCode: 1 });
  }
  if (targetStat === null && replacing) {
    throw new CliFailure("OUTPUT_REPLACE_TARGET_MISSING", "replacement requires an existing application directory", { exitCode: 1 });
  }
  if (targetStat !== null && (targetStat.isSymbolicLink() || !targetStat.isDirectory())) {
    throw new CliFailure("OUTPUT_REPLACE_TARGET_INVALID", "replacement requires a real application directory", { exitCode: 1 });
  }
  if (targetStat !== null) assertNoSymlinkComponents(targetDirectory);
  const canonicalParentStat = fs.statSync(canonicalParent);
  return {
    targetDirectory,
    parentDirectory: canonicalParent,
    parentDevice: canonicalParentStat.dev,
    parentInode: canonicalParentStat.ino,
    directoryName,
    applicationId,
    targetExists: targetStat !== null,
    targetDevice: targetStat?.dev ?? null,
    targetInode: targetStat?.ino ?? null
  };
}

export function materializeCentralPackage({
  outputDirectory,
  baseDirectory,
  applicationId,
  centralPackage,
  replaceExisting = false,
  replaceDraft = false,
  priorCentralPackage = null,
  priorDraftSnapshot = null,
  centralBaseCommit = null,
  centralBaseExistingApplication = null,
  centralBasePriorApplication = null,
  writeFileImplementation = fs.writeFileSync,
  renameImplementation = fs.renameSync
}) {
  if (typeof replaceExisting !== "boolean" || typeof replaceDraft !== "boolean" || (replaceExisting && replaceDraft)) {
    throw new CliFailure("OUTPUT_PACKAGE_INVALID", "replacement modes must be explicit and mutually exclusive", { exitCode: 1 });
  }
  const replacing = replaceExisting || replaceDraft;
  const records = validateCentralPackageBytes(centralPackage);
  const draftValidation = replaceDraft
    ? validateLocalDraftReplacement({
      draftSnapshot: priorDraftSnapshot,
      nextCentralPackage: centralPackage,
      applicationId,
      centralBaseCommit,
      centralBaseExistingApplication,
      centralBasePriorApplication
    })
    : null;
  const priorRecords = replaceExisting
    ? validateCentralPackageBytes(priorCentralPackage)
    : draftValidation?.priorRecords ?? null;
  const priorDirectoryIdentity = draftValidation?.priorDirectoryIdentity ?? null;
  const priorFileIdentities = draftValidation?.priorFileIdentities ?? null;
  if (replaceExisting && !/^[0-9a-f]{40}$/u.test(centralBaseCommit ?? "")) {
    throw new CliFailure("OUTPUT_PACKAGE_INVALID", "replace-existing requires the immutable central base commit", { exitCode: 1 });
  }
  const plan = preflightCentralPackageOutput({
    outputDirectory,
    baseDirectory,
    applicationId,
    replaceExisting,
    replaceDraft
  });
  if (replacing) {
    verifyMaterializedFiles(
      plan.targetDirectory,
      priorRecords,
      priorDirectoryIdentity ?? targetIdentity(plan),
      priorFileIdentities
    );
  }
  let temporaryDirectory = null;
  let transactionDirectory = null;
  let transactionIdentity = null;
  try {
    if (replacing) {
      transactionDirectory = fs.mkdtempSync(
        path.join(plan.parentDirectory, `.${plan.directoryName}.replace-`),
        { encoding: "utf8" }
      );
      fs.chmodSync(transactionDirectory, 0o700);
      transactionIdentity = directoryIdentity(transactionDirectory);
      temporaryDirectory = path.join(transactionDirectory, "next");
      fs.mkdirSync(temporaryDirectory, { mode: 0o700 });
    } else {
      temporaryDirectory = fs.mkdtempSync(
        path.join(plan.parentDirectory, `.${plan.directoryName}.tmp-`),
        { encoding: "utf8" }
      );
    }
    fs.chmodSync(temporaryDirectory, 0o700);
    for (const record of records) {
      const target = path.join(temporaryDirectory, record.path);
      writeFileImplementation(target, record.bytes, { flag: "wx", mode: 0o600 });
    }
    verifyMaterializedFiles(temporaryDirectory, records);
    assertOutputPlanStillValid(plan, baseDirectory, replaceExisting, replaceDraft);
    verifyMaterializedFiles(temporaryDirectory, records);
    if (replacing) {
      replaceVerifiedDirectory({
        plan,
        records,
        priorRecords,
        temporaryDirectory,
        transactionDirectory,
        transactionIdentity,
        priorDirectoryIdentity: priorDirectoryIdentity ?? targetIdentity(plan),
        priorFileIdentities,
        renameImplementation
      });
      temporaryDirectory = null;
      transactionDirectory = null;
    } else {
      try {
        renameImplementation(temporaryDirectory, plan.targetDirectory);
      } catch (error) {
        if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) {
          throw new CliFailure("OUTPUT_TARGET_EXISTS", "output application directory appeared before the atomic rename", { exitCode: 1 });
        }
        throw error;
      }
      temporaryDirectory = null;
    }
  } catch (error) {
    if (error instanceof CliFailure && error.code === "OUTPUT_REPLACE_ROLLBACK_BLOCKED") {
      transactionDirectory = null;
    }
    if (transactionDirectory !== null && lstatOrNull(transactionDirectory) !== null) {
      cleanupOwnedDirectory(transactionDirectory, transactionIdentity);
    }
    else if (temporaryDirectory !== null) cleanupTemporaryDirectory(temporaryDirectory);
    if (error instanceof CliFailure) throw error;
    throw new CliFailure(
      "OUTPUT_WRITE_FAILED",
      `central package materialization failed: ${sanitizeMessage(error?.message ?? "local write failed")}`,
      { exitCode: 1 }
    );
  }

  return {
    type: "central-application-package",
    directory: plan.targetDirectory,
    applicationId,
    recommendedDirectoryName: applicationId,
    directoryNameMatchesApplicationId: true,
    atomicDirectoryRename: !replacing,
    atomicRenameSteps: true,
    wholeSwapAtomic: false,
    rollbackCapable: replacing,
    overwritten: replacing,
    replacedExisting: replacing,
    replacedCentralBase: replaceExisting,
    replacedDraft: replaceDraft,
    priorPackageAuthority: replaceExisting
      ? "immutable-central-base"
      : replaceDraft
        ? "local-unmerged-draft-self-consistent"
        : null,
    centralBaseCommit: /^[0-9a-f]{40}$/u.test(centralBaseCommit ?? "") ? centralBaseCommit : null,
    fileCount: records.length,
    files: records.map(({ path: filePath, byteLength, sha256 }) => ({
      path: filePath,
      byteLength,
      sha256
    }))
  };
}

function validateCentralPackageBytes(centralPackage) {
  if (
    centralPackage === null
    || typeof centralPackage !== "object"
    || centralPackage.generated !== true
    || centralPackage.encoding !== "utf8"
    || centralPackage.fileCount !== CENTRAL_APPLICATION_FILES.length
    || !arraysEqual(centralPackage.fileOrder, CENTRAL_APPLICATION_FILES)
    || !Array.isArray(centralPackage.files)
    || centralPackage.files.length !== CENTRAL_APPLICATION_FILES.length
  ) {
    throw new CliFailure("OUTPUT_PACKAGE_INVALID", "central package does not use the frozen six-file contract", { exitCode: 1 });
  }
  let totalBytes = 0;
  return CENTRAL_APPLICATION_FILES.map((expectedPath, index) => {
    const record = centralPackage.files[index];
    if (
      record === null
      || typeof record !== "object"
      || record.path !== expectedPath
      || typeof record.content !== "string"
      || !Number.isInteger(record.byteLength)
      || record.byteLength < 1
      || !DIGEST_PATTERN.test(record.sha256 ?? "")
    ) {
      throw new CliFailure("OUTPUT_PACKAGE_INVALID", "central package contains an invalid frozen file record", { exitCode: 1 });
    }
    const bytes = Buffer.from(record.content, "utf8");
    const observedDigest = digest(bytes);
    if (bytes.length !== record.byteLength || observedDigest !== record.sha256) {
      throw new CliFailure("OUTPUT_PACKAGE_INVALID", "central package byte length or SHA-256 identity does not match its content", { exitCode: 1 });
    }
    totalBytes += bytes.length;
    if (totalBytes > MAX_PACKAGE_BYTES) {
      throw new CliFailure("OUTPUT_PACKAGE_INVALID", "central package exceeds the frozen aggregate byte limit", { exitCode: 1 });
    }
    return {
      path: expectedPath,
      bytes,
      byteLength: bytes.length,
      sha256: observedDigest
    };
  });
}

function verifyMaterializedFiles(
  directory,
  records,
  expectedDirectoryIdentity = null,
  expectedFileIdentities = null
) {
  const observedDirectoryIdentity = directoryIdentity(directory);
  if (expectedDirectoryIdentity !== null && !sameIdentity(observedDirectoryIdentity, expectedDirectoryIdentity)) {
    throw new CliFailure("OUTPUT_TARGET_CHANGED", "the output application directory changed during materialization", { exitCode: 1 });
  }
  const observedNames = fs.readdirSync(directory).sort(compareUtf8);
  const expectedNames = [...CENTRAL_APPLICATION_FILES].sort(compareUtf8);
  if (!arraysEqual(observedNames, expectedNames)) {
    throw new CliFailure("OUTPUT_WRITE_FAILED", "temporary output does not contain exactly the frozen six files", { exitCode: 1 });
  }
  if (expectedFileIdentities !== null && expectedFileIdentities.length !== records.length) {
    throw new CliFailure("OUTPUT_TARGET_CHANGED", "the frozen output file identities are incomplete", { exitCode: 1 });
  }
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const target = path.join(directory, record.path);
    const { bytes, stat } = readRegularFileNoFollow(target, record.byteLength);
    const expectedFileIdentity = expectedFileIdentities?.[index] ?? null;
    if (
      expectedFileIdentity !== null
      && (
        expectedFileIdentity.path !== record.path
        || !sameIdentity(stat, expectedFileIdentity)
      )
    ) {
      throw new CliFailure("OUTPUT_TARGET_CHANGED", "a frozen output file identity changed before replacement", { exitCode: 1 });
    }
    if (stat.size !== record.byteLength) {
      throw new CliFailure("OUTPUT_WRITE_FAILED", "a temporary output file is not an exact regular file", { exitCode: 1 });
    }
    if (bytes.length !== record.byteLength || digest(bytes) !== record.sha256) {
      throw new CliFailure("OUTPUT_WRITE_FAILED", "a temporary output file failed byte-length or SHA-256 verification", { exitCode: 1 });
    }
  }
  if (!sameIdentity(directoryIdentity(directory), observedDirectoryIdentity)) {
    throw new CliFailure("OUTPUT_TARGET_CHANGED", "the output application directory changed during verification", { exitCode: 1 });
  }
  return observedDirectoryIdentity;
}

function assertOutputPlanStillValid(plan, baseDirectory, replaceExisting, replaceDraft) {
  const observed = preflightCentralPackageOutput({
    outputDirectory: plan.targetDirectory,
    baseDirectory,
    applicationId: plan.applicationId,
    replaceExisting,
    replaceDraft
  });
  if (
    observed.targetDirectory !== plan.targetDirectory
    || observed.parentDirectory !== plan.parentDirectory
    || observed.parentDevice !== plan.parentDevice
    || observed.parentInode !== plan.parentInode
    || observed.targetDevice !== plan.targetDevice
    || observed.targetInode !== plan.targetInode
  ) {
    throw new CliFailure("OUTPUT_PARENT_CHANGED", "output parent changed during package materialization", { exitCode: 1 });
  }
}

function replaceVerifiedDirectory({
  plan,
  records,
  priorRecords,
  temporaryDirectory,
  transactionDirectory,
  transactionIdentity,
  priorDirectoryIdentity,
  priorFileIdentities,
  renameImplementation
}) {
  const previousDirectory = path.join(transactionDirectory, "previous");
  const failedNextDirectory = path.join(transactionDirectory, "failed-next");
  const priorIdentity = priorDirectoryIdentity;
  const nextIdentity = verifyMaterializedFiles(temporaryDirectory, records);
  let previousMoved = false;
  let nextInstalled = false;
  try {
    verifyMaterializedFiles(plan.targetDirectory, priorRecords, priorIdentity, priorFileIdentities);
    renameImplementation(plan.targetDirectory, previousDirectory);
    previousMoved = true;
    verifyMaterializedFiles(previousDirectory, priorRecords, priorIdentity, priorFileIdentities);
    renameImplementation(temporaryDirectory, plan.targetDirectory);
    nextInstalled = true;
    verifyMaterializedFiles(plan.targetDirectory, records, nextIdentity);
  } catch (error) {
    rollbackReplacement({
      error,
      plan,
      records,
      priorRecords,
      priorIdentity,
      priorFileIdentities,
      nextIdentity,
      previousDirectory,
      failedNextDirectory,
      previousMoved,
      nextInstalled,
      transactionDirectory,
      renameImplementation
    });
    throw error;
  }

  cleanupOwnedDirectory(previousDirectory, priorIdentity);
  try {
    fs.rmdirSync(transactionDirectory);
  } catch (error) {
    throw new CliFailure(
      "OUTPUT_CLEANUP_FAILED",
      `replacement transaction cleanup failed: ${sanitizeMessage(error?.message ?? "cleanup failed")}`,
      { exitCode: 1 }
    );
  }
  if (lstatOrNull(transactionDirectory) !== null || !sameIdentity(directoryIdentity(plan.targetDirectory), nextIdentity)) {
    throw new CliFailure("OUTPUT_WRITE_FAILED", "replacement completion could not be verified", { exitCode: 1 });
  }
  if (transactionIdentity === null) {
    throw new CliFailure("OUTPUT_WRITE_FAILED", "replacement transaction identity was unavailable", { exitCode: 1 });
  }
}

function rollbackReplacement({
  error,
  plan,
  records,
  priorRecords,
  priorIdentity,
  priorFileIdentities,
  nextIdentity,
  previousDirectory,
  failedNextDirectory,
  previousMoved,
  nextInstalled,
  transactionDirectory,
  renameImplementation
}) {
  if (!previousMoved) return;
  try {
    if (nextInstalled) {
      verifyMaterializedFiles(plan.targetDirectory, records, nextIdentity);
      renameImplementation(plan.targetDirectory, failedNextDirectory);
    } else if (lstatOrNull(plan.targetDirectory) !== null) {
      rollbackBlocked(transactionDirectory, error);
    }
    verifyMaterializedFiles(previousDirectory, priorRecords, priorIdentity, priorFileIdentities);
    renameImplementation(previousDirectory, plan.targetDirectory);
    verifyMaterializedFiles(plan.targetDirectory, priorRecords, priorIdentity, priorFileIdentities);
    if (nextInstalled) cleanupOwnedDirectory(failedNextDirectory, nextIdentity);
  } catch (rollbackError) {
    if (rollbackError instanceof CliFailure && rollbackError.code === "OUTPUT_REPLACE_ROLLBACK_BLOCKED") {
      throw rollbackError;
    }
    rollbackBlocked(transactionDirectory, rollbackError);
  }
}

function rollbackBlocked(transactionDirectory, error) {
  throw new CliFailure(
    "OUTPUT_REPLACE_ROLLBACK_BLOCKED",
    "replacement rollback was blocked; the verified prior package remains in the private recovery directory",
    {
      exitCode: 1,
      details: {
        recoveryDirectory: transactionDirectory,
        reason: sanitizeMessage(error?.message ?? "rollback blocked")
      }
    }
  );
}

function readRegularFileNoFollow(target, maximumBytes) {
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
    const before = fs.fstatSync(descriptor);
    if (
      !before.isFile()
      || before.isSymbolicLink()
      || before.nlink !== 1
      || (before.mode & 0o111) !== 0
      || before.size > maximumBytes
    ) {
      throw new CliFailure("OUTPUT_WRITE_FAILED", "an output file is not a bounded non-executable regular file", { exitCode: 1 });
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (
      !sameIdentity(before, after)
      || before.mode !== after.mode
      || (after.mode & 0o111) !== 0
      || before.size !== after.size
      || bytes.length !== after.size
    ) {
      throw new CliFailure("OUTPUT_TARGET_CHANGED", "an output file changed while it was being verified", { exitCode: 1 });
    }
    return { bytes, stat: after };
  } catch (error) {
    if (error instanceof CliFailure) throw error;
    throw new CliFailure(
      "OUTPUT_WRITE_FAILED",
      `an output file could not be read safely: ${sanitizeMessage(error?.message ?? "read failed")}`,
      { exitCode: 1 }
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function directoryIdentity(target) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new CliFailure("OUTPUT_TARGET_CHANGED", "an output directory is no longer a real directory", { exitCode: 1 });
  }
  return { dev: stat.dev, ino: stat.ino };
}

function targetIdentity(plan) {
  return { dev: plan.targetDevice, ino: plan.targetInode };
}

function sameIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function assertNoSymlinkComponents(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new CliFailure("OUTPUT_PARENT_INVALID", "output parent path contains a symbolic link", { exitCode: 1 });
    }
  }
}

function rejectGitControlPath(target) {
  const segments = path.resolve(target).split(path.sep).filter(Boolean);
  if (segments.some((segment) => segment.toLowerCase() === ".git")) {
    invalidPath("output directory cannot target Git control data");
  }
}

function validateApplicationId(applicationId) {
  if (
    typeof applicationId !== "string"
    || applicationId.length > MAX_APPLICATION_ID_LENGTH
    || !APPLICATION_ID_PATTERN.test(applicationId)
  ) {
    throw new CliFailure("OUTPUT_PACKAGE_INVALID", "central package application id is not canonical", { exitCode: 1 });
  }
}

function canonicalExistingDirectory(target) {
  try {
    const resolved = fs.realpathSync(target);
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

function cleanupTemporaryDirectory(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (error) {
    throw new CliFailure(
      "OUTPUT_CLEANUP_FAILED",
      `temporary output cleanup failed: ${sanitizeMessage(error?.message ?? "cleanup failed")}`,
      { exitCode: 1 }
    );
  }
}

function cleanupOwnedDirectory(target, expectedIdentity) {
  if (expectedIdentity === null || !sameIdentity(directoryIdentity(target), expectedIdentity)) {
    throw new CliFailure("OUTPUT_CLEANUP_FAILED", "refusing to clean a replacement directory with a changed identity", { exitCode: 1 });
  }
  cleanupTemporaryDirectory(target);
}

function digest(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function invalidPath(message) {
  throw new CliFailure("OUTPUT_PATH_INVALID", message, { exitCode: 1 });
}
