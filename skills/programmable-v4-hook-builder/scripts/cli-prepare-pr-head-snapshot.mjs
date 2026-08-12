import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assertInsideRepository } from "./repository-root.mjs";
import {
  CliFailure,
  sanitizeMessage
} from "./cli-runtime.mjs";
import { canonicalJson, submissionHash } from "./submission-core.mjs";
import { isExternalPackageReviewRecord } from "./package-dependency-contract.mjs";
import {
  isCanonicalReviewTargetPath,
  isGitLfsPointer,
  isSourceOrTestReviewKind,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";
import { git, gitBinary } from "./cli-prepare-pr-transport.mjs";
import { compareUtf8 } from "./cli-prepare-pr-values.mjs";

export function selectDeclaredHeadBytes({
  repositoryRoot,
  commit,
  headFiles,
  declaredPaths,
  gitBinaryImplementation
}) {
  const selected = new Map();
  for (const filePath of [...declaredPaths.sourcePaths, ...declaredPaths.contractPaths]) {
    const bytes = headFiles.get(filePath) ?? gitBinary(
      repositoryRoot,
      ["cat-file", "blob", `${commit}:${filePath}`],
      gitBinaryImplementation,
      { code: "GIT_STATE_INVALID", message: "declared source bytes were absent from the exact HEAD snapshot" }
    );
    if (!(bytes instanceof Uint8Array)) {
      throw new CliFailure("GIT_STATE_INVALID", "declared source bytes were absent from the exact HEAD snapshot", {
        exitCode: 1
      });
    }
    selected.set(filePath, bytes);
  }
  return selected;
}

export function assertReviewTargetBoundToHead({
  repositoryRoot,
  commit,
  reviewTarget,
  gitImplementation,
  gitBinaryImplementation
}) {
  const files = new Map();
  for (const record of reviewTarget.files) {
    if (isExternalPackageReviewRecord(record)) continue;
    const treeRecord = git(
      repositoryRoot,
      ["ls-tree", "--full-tree", commit, "--", record.path],
      gitImplementation,
      { code: "GIT_STATE_INVALID", message: "review target tree entry is unavailable" }
    );
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(treeRecord);
    if (!match || match[3] !== record.path) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "every review target entry must be a regular blob in the exact HEAD tree",
        { exitCode: 1 }
      );
    }
    const indexRecord = git(
      repositoryRoot,
      ["ls-files", "-v", "--", record.path],
      gitImplementation,
      { code: "GIT_STATE_INVALID", message: "review target index state is unavailable" }
    );
    if (indexRecord !== `H ${record.path}`) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "prepare-pr rejects review files with hidden index flags or noncanonical index state",
        { exitCode: 1 }
      );
    }
    const bytes = gitBinary(
      repositoryRoot,
      ["cat-file", "blob", `${commit}:${record.path}`],
      gitBinaryImplementation
    );
    if (
      (isSourceOrTestReviewKind(record.kind) || record.path.toLowerCase().endsWith(".sol"))
      && isGitLfsPointer(bytes)
    ) {
      throw new CliFailure(
        "TOOLING_BLOCKED",
        `declared source/test Git LFS content is not materialized in HEAD: ${record.path}`,
        { exitCode: 1 }
      );
    }
    const observed = crypto.createHash("sha256").update(bytes).digest("hex");
    if (bytes.length !== record.bytes || observed !== record.sha256) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "review target bytes differ from the exact HEAD revision",
        { exitCode: 1 }
      );
    }
    files.set(record.path, bytes);
  }
  return { files };
}

export function resolvePrimaryAuthorityPaths(submission, reviewTarget) {
  const declared = [
    ["gate-status", submission?.implementation?.gateStatusPath],
    ["review-target", submission?.implementation?.reviewTargetPath]
  ];
  if (
    submission?.stage === "prototype"
    && declared.some(([, repositoryPath]) => typeof repositoryPath !== "string")
  ) {
    throw new CliFailure(
      "PACKAGE_INVALID",
      "prototype preparation requires exact gate-status and review-target authority paths",
      { exitCode: 1 }
    );
  }
  const reviewPaths = new Set(reviewTarget.files.map((record) => record.path));
  const authorityPaths = [];
  const seen = new Set();
  for (const [label, repositoryPath] of declared) {
    if (repositoryPath === null || repositoryPath === undefined) continue;
    if (
      !isCanonicalReviewTargetPath(repositoryPath)
      || seen.has(repositoryPath)
      || reviewPaths.has(repositoryPath)
    ) {
      throw new CliFailure(
        "REVIEW_TARGET_INVALID",
        `${label} must be one unique primary authority path outside the review-target subject`,
        { exitCode: 1 }
      );
    }
    seen.add(repositoryPath);
    authorityPaths.push(repositoryPath);
  }
  return Object.freeze(authorityPaths.sort(compareUtf8));
}

export function assertPrimaryAuthorityPathsBoundToHead({
  repositoryRoot,
  commit,
  authorityPaths,
  gitImplementation,
  gitBinaryImplementation
}) {
  const files = new Map();
  for (const repositoryPath of authorityPaths) {
    let worktreePath;
    try {
      const lexicalPath = path.resolve(repositoryRoot, repositoryPath);
      worktreePath = assertInsideRepository(repositoryRoot, lexicalPath);
      if (worktreePath !== lexicalPath) throw new Error("symbolic aliases are not allowed");
    } catch {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "primary authority path is not one regular in-repository file",
        { exitCode: 1 }
      );
    }
    const worktreeBytes = readStableAuthorityFile(worktreePath, repositoryPath);
    const treeRecord = git(
      repositoryRoot,
      ["ls-tree", "--full-tree", commit, "--", repositoryPath],
      gitImplementation,
      { code: "GIT_STATE_INVALID", message: "primary authority tree entry is unavailable" }
    );
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(treeRecord);
    if (!match || match[3] !== repositoryPath) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "every primary authority file must be one regular blob in the exact HEAD tree",
        { exitCode: 1 }
      );
    }
    const indexRecord = git(
      repositoryRoot,
      ["ls-files", "-v", "--", repositoryPath],
      gitImplementation,
      { code: "GIT_STATE_INVALID", message: "primary authority index state is unavailable" }
    );
    if (indexRecord !== `H ${repositoryPath}`) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "prepare-pr rejects primary authority files with hidden index flags or noncanonical index state",
        { exitCode: 1 }
      );
    }
    const headBytes = gitBinary(
      repositoryRoot,
      ["cat-file", "blob", `${commit}:${repositoryPath}`],
      gitBinaryImplementation
    );
    if (!headBytes.equals(worktreeBytes)) {
      throw new CliFailure(
        "WORKTREE_NOT_HEAD",
        "primary authority bytes differ from the exact HEAD revision",
        { exitCode: 1 }
      );
    }
    files.set(repositoryPath, headBytes);
  }
  return { files };
}

export function readStableAuthorityFile(target, repositoryPath) {
  let expectedStat;
  try {
    expectedStat = fs.lstatSync(target);
  } catch {
    throw new CliFailure("WORKTREE_NOT_HEAD", "primary authority file is unavailable", { exitCode: 1 });
  }
  if (
    !expectedStat.isFile()
    || expectedStat.isSymbolicLink()
    || expectedStat.size > REVIEW_TARGET_CONTRACT_V1.maximumFileBytes
  ) {
    throw new CliFailure(
      "WORKTREE_NOT_HEAD",
      "primary authority file is not one bounded regular file",
      { exitCode: 1 }
    );
  }
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor;
  try {
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
    const openedStat = fs.fstatSync(descriptor);
    if (
      !openedStat.isFile()
      || openedStat.dev !== expectedStat.dev
      || openedStat.ino !== expectedStat.ino
      || openedStat.size !== expectedStat.size
    ) {
      throw new Error("identity changed");
    }
    const bytes = fs.readFileSync(descriptor);
    const finalStat = fs.fstatSync(descriptor);
    if (bytes.length !== openedStat.size || finalStat.size !== openedStat.size) {
      throw new Error("bytes changed");
    }
    return bytes;
  } catch {
    throw new CliFailure(
      "WORKTREE_NOT_HEAD",
      `primary authority file changed while it was read: ${repositoryPath}`,
      { exitCode: 1 }
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function assertPrimaryAuthorityDocuments({ submission, reviewTarget, files }) {
  const gateStatusPath = submission?.implementation?.gateStatusPath;
  if (typeof gateStatusPath === "string") {
    const gateStatus = parsePrimaryAuthorityJson(files.get(gateStatusPath), "gate status");
    if (gateStatus.reviewTargetHash !== reviewTarget.reviewTargetHash || !Array.isArray(gateStatus.gates)) {
      throw new CliFailure(
        "PACKAGE_INVALID",
        "the exact HEAD gate status does not bind the current review-target hash",
        { exitCode: 1 }
      );
    }
    for (const gate of gateStatus.gates) {
      if (gate?.status !== "completed") continue;
      if (
        !Array.isArray(gate.evidence)
        || gate.evidence.length === 0
        || gate.evidence.some((evidence) => evidence?.reviewTargetHash !== reviewTarget.reviewTargetHash)
      ) {
        throw new CliFailure(
          "PACKAGE_INVALID",
          "every completed gate evidence record in exact HEAD must bind the current review-target hash",
          { exitCode: 1 }
        );
      }
    }
  }

  const reviewTargetPath = submission?.implementation?.reviewTargetPath;
  if (typeof reviewTargetPath === "string") {
    const recorded = parsePrimaryAuthorityJson(files.get(reviewTargetPath), "review target");
    if (canonicalJson(recorded) !== canonicalJson(reviewTarget)) {
      throw new CliFailure(
        "PACKAGE_INVALID",
        "the exact HEAD review-target record differs from the current review subject",
        { exitCode: 1 }
      );
    }
  }
}

export function parsePrimaryAuthorityJson(bytes, label) {
  if (!Buffer.isBuffer(bytes)) {
    throw new CliFailure("PACKAGE_INVALID", `${label} is absent from the exact HEAD authority snapshot`, {
      exitCode: 1
    });
  }
  try {
    return parseBoundedStrictJsonBytes(bytes);
  } catch {
    throw new CliFailure("PACKAGE_INVALID", `${label} must be exact UTF-8 JSON in HEAD`, { exitCode: 1 });
  }
}

export function mergeHeadFileSnapshots(...snapshots) {
  const files = new Map();
  for (const snapshot of snapshots) {
    for (const [repositoryPath, bytes] of snapshot.files) {
      const previous = files.get(repositoryPath);
      if (previous !== undefined && !previous.equals(bytes)) {
        throw new CliFailure("GIT_STATE_CHANGED", "exact HEAD file snapshots disagree", { exitCode: 1 });
      }
      files.set(repositoryPath, bytes);
    }
  }
  return { files };
}

export function assertSameHeadFileSnapshot(expected, observed) {
  if (
    expected.files.size !== observed.files.size
    || [...expected.files].some(([repositoryPath, bytes]) => !observed.files.get(repositoryPath)?.equals(bytes))
  ) {
    throw new CliFailure(
      "GIT_STATE_CHANGED",
      "primary authority bytes changed while prepare-pr was building the bundle",
      { exitCode: 1 }
    );
  }
}

export function parseHeadSubmission(headFiles, submissionPath) {
  const bytes = headFiles.get(submissionPath);
  if (!Buffer.isBuffer(bytes)) {
    throw new CliFailure("PACKAGE_INVALID", "submission.json is absent from the exact HEAD review target", { exitCode: 1 });
  }
  try {
    return parseBoundedStrictJsonBytes(bytes);
  } catch {
    throw new CliFailure("PACKAGE_INVALID", "submission.json must be bounded duplicate-free UTF-8 JSON in HEAD", { exitCode: 1 });
  }
}

export function assertSubmissionIdentity(submission, reviewTarget) {
  let observed;
  try {
    observed = submissionHash(submission);
  } catch (error) {
    throw new CliFailure("PACKAGE_INVALID", `submission.json: ${sanitizeMessage(error.message)}`, { exitCode: 1 });
  }
  if (observed !== reviewTarget.submissionHash) {
    throw new CliFailure("GIT_STATE_CHANGED", "review target and exact HEAD submission identities differ", { exitCode: 1 });
  }
}

export function assertSameReviewTarget(expected, observed) {
  if (canonicalJson(expected) !== canonicalJson(observed)) {
    throw new CliFailure("GIT_STATE_CHANGED", "the review target changed while prepare-pr was building the bundle", { exitCode: 1 });
  }
}

export function partitionDeclaredPaths(files, additionalSourcePaths = []) {
  const sourcePaths = [];
  const contractPaths = [];
  for (const record of files) {
    if (isExternalPackageReviewRecord(record)) continue;
    const repositoryPath = record.path;
    (repositoryPath.endsWith(".sol") ? contractPaths : sourcePaths).push(repositoryPath);
  }
  sourcePaths.push(...additionalSourcePaths);
  sourcePaths.sort(compareUtf8);
  contractPaths.sort(compareUtf8);
  for (let index = 1; index < sourcePaths.length; index += 1) {
    if (sourcePaths[index - 1] === sourcePaths[index]) sourcePaths.splice(index--, 1);
  }
  if (sourcePaths.length + contractPaths.length > REVIEW_TARGET_CONTRACT_V1.maximumFiles) {
    throw new CliFailure(
      "REVIEW_TARGET_INVALID",
      `the public beta supports at most ${REVIEW_TARGET_CONTRACT_V1.maximumFiles} total review paths per exact revision`,
      { exitCode: 1 }
    );
  }
  return { sourcePaths, contractPaths };
}
