import fs from "node:fs";

import {
  assertCentralBaseUnchanged,
  deriveApplicationRevision,
  resolveCentralApplicationBase
} from "./cli-central-base.mjs";
import { buildCentralApplicationPackage } from "./cli-central-package.mjs";
import {
  parseGitHubRemote,
  resolvePublicGitHubUser,
  resolvePublicGitHubSource
} from "./cli-github-source.mjs";
import { materializeCentralPackage, preflightCentralPackageOutput } from "./cli-output-dir.mjs";
import {
  CliFailure,
  requireJsonResult,
  runBundledCommand
} from "./cli-runtime.mjs";
import { snapshotLocalDraftPackage } from "./cli-local-draft.mjs";
import { canonicalJson } from "./submission-core.mjs";
import { buildReviewTargetDocument } from "./cli-prepare-pr-review-target.mjs";
import {
  assertCleanWorktree,
  assertCompanionClosureVerification,
  assertGitSnapshotUnchanged,
  assertOutputOutsideRepository,
  readCompanionManifestsFromHead,
  resolveCompanionManifestPaths,
  resolvePackage,
  resolveRoot
} from "./cli-prepare-pr-preflight.mjs";
import {
  assertPrimaryAuthorityDocuments,
  assertPrimaryAuthorityPathsBoundToHead,
  assertReviewTargetBoundToHead,
  assertSameHeadFileSnapshot,
  assertSameReviewTarget,
  assertSubmissionIdentity,
  mergeHeadFileSnapshots,
  parseHeadSubmission,
  partitionDeclaredPaths,
  resolvePrimaryAuthorityPaths,
  selectDeclaredHeadBytes
} from "./cli-prepare-pr-head-snapshot.mjs";
import { buildPullRequestDocument } from "./cli-prepare-pr-report.mjs";
import {
  git,
  runGit,
  runGitBinary
} from "./cli-prepare-pr-transport.mjs";
import {
  DIGEST_PATTERN,
  REMOTE_NAME_PATTERN,
  relativeRepositoryPath,
  requireCommit,
  requireSafeBranch
} from "./cli-prepare-pr-values.mjs";
import {
  SUBMIT_LAUNCH_BASE_BRANCH,
  SUBMIT_LAUNCH_REPOSITORY
} from "./registry-intake-contract.mjs";

export async function preparePullRequest({
  repositoryRoot: repositoryRootInput = null,
  packageInput,
  baseBranch = "main",
  companionManifestInputs = [],
  fetchImplementation = globalThis.fetch,
  sleepImplementation,
  gitImplementation = runGit,
  gitBinaryImplementation = runGitBinary,
  outputDirectory = null,
  replaceExisting = false,
  replaceDraft = false,
  outputMaterializer = materializeCentralPackage,
  centralBaseResolver = resolveCentralApplicationBase,
  centralBaseStabilityChecker = assertCentralBaseUnchanged,
  publicBuilderResolver = resolvePublicGitHubUser,
  publicSourceResolver = resolvePublicGitHubSource,
  exactObjectResolver,
  publicAttempts,
  publicTimeoutMs,
  centralAttempts,
  centralTimeoutMs
}) {
  const normalizedBase = requireSafeBranch(baseBranch, "base branch");
  if (normalizedBase !== SUBMIT_LAUNCH_BASE_BRANCH) {
    throw new CliFailure(
      "USAGE_ERROR",
      `prepare-pr supports only ${SUBMIT_LAUNCH_REPOSITORY}:${SUBMIT_LAUNCH_BASE_BRANCH}; omit baseBranch or set it to ${SUBMIT_LAUNCH_BASE_BRANCH}`,
      { exitCode: 2 }
    );
  }
  const repositoryRoot = resolveRoot(repositoryRootInput);
  const packageRoot = resolvePackage(repositoryRoot, packageInput);
  const companionManifestPaths = resolveCompanionManifestPaths(repositoryRoot, companionManifestInputs);
  if (
    typeof replaceExisting !== "boolean"
    || typeof replaceDraft !== "boolean"
    || (replaceExisting && replaceDraft)
  ) {
    throw new CliFailure("USAGE_ERROR", "replace-existing and replace-draft must be explicit and mutually exclusive", { exitCode: 2 });
  }
  if ((replaceExisting || replaceDraft) && outputDirectory === null) {
    throw new CliFailure("USAGE_ERROR", "replacement requires --output-dir", { exitCode: 2 });
  }

  const gitTopLevel = git(
    repositoryRoot,
    ["rev-parse", "--show-toplevel"],
    gitImplementation,
    { code: "REPOSITORY_REQUIRED", message: "prepare-pr requires the selected Git worktree root" }
  );
  let canonicalGitTopLevel;
  try {
    canonicalGitTopLevel = fs.realpathSync(gitTopLevel);
  } catch {
    canonicalGitTopLevel = null;
  }
  if (canonicalGitTopLevel !== repositoryRoot) {
    throw new CliFailure("REPOSITORY_REQUIRED", "prepare-pr requires the selected Git worktree root", { exitCode: 1 });
  }

  assertCleanWorktree(repositoryRoot, packageRoot, gitImplementation);

  const branch = requireSafeBranch(
    git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], gitImplementation, {
      code: "BRANCH_REQUIRED",
      message: "prepare-pr requires a named local branch"
    }),
    "head branch"
  );
  const commit = requireCommit(
    git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"], gitImplementation),
    "HEAD"
  );
  const tree = requireCommit(
    git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"], gitImplementation),
    "HEAD tree"
  );
  const remoteName = git(
    repositoryRoot,
    ["config", "--get", `branch.${branch}.remote`],
    gitImplementation,
    { code: "UPSTREAM_REQUIRED", message: "the current branch has no upstream remote" }
  );
  if (!REMOTE_NAME_PATTERN.test(remoteName) || remoteName === ".") {
    throw new CliFailure("UPSTREAM_REQUIRED", "the current branch has no supported upstream remote", { exitCode: 1 });
  }
  const mergeRef = git(
    repositoryRoot,
    ["config", "--get", `branch.${branch}.merge`],
    gitImplementation,
    { code: "UPSTREAM_REQUIRED", message: "the current branch has no upstream branch" }
  );
  if (!mergeRef.startsWith("refs/heads/")) {
    throw new CliFailure("UPSTREAM_REQUIRED", "the upstream branch is not a Git branch", { exitCode: 1 });
  }
  const upstreamBranch = requireSafeBranch(mergeRef.slice("refs/heads/".length), "upstream branch");
  const upstreamCommit = requireCommit(
    git(
      repositoryRoot,
      ["rev-parse", "--verify", "@{upstream}^{commit}"],
      gitImplementation,
      { code: "UPSTREAM_REQUIRED", message: "the upstream revision is unavailable" }
    ),
    "upstream commit"
  );
  if (upstreamCommit !== commit) {
    throw new CliFailure("HEAD_NOT_PUSHED", "HEAD does not equal the configured upstream revision", { exitCode: 1 });
  }

  const remoteUrl = git(
    repositoryRoot,
    ["config", "--get", `remote.${remoteName}.url`],
    gitImplementation,
    { code: "UPSTREAM_REQUIRED", message: "the upstream remote URL is unavailable" }
  );
  const configuredGithub = parseGitHubRemote(remoteUrl);
  const companionManifestBindings = readCompanionManifestsFromHead({
    repositoryRoot,
    commit,
    manifestPaths: companionManifestPaths,
    gitImplementation,
    gitBinaryImplementation
  });
  const companionClosureDiagnostics = companionManifestBindings
    .filter((binding) => binding.closureStatus === "incomplete")
    .map((binding) => ({
      code: "COMPANION_CLOSURE_REVIEW_REQUIRED",
      detail: "The exact companion revision and declared files are bound, but companion manifest v1 does not prove semantic dependency, test, and build closure.",
      path: binding.path
    }));

  const relativePackage = relativeRepositoryPath(repositoryRoot, packageRoot);
  const reviewTarget = buildReviewTargetDocument(
    repositoryRoot,
    packageRoot,
    companionClosureDiagnostics
  );
  const reviewHeadSnapshot = assertReviewTargetBoundToHead({
    repositoryRoot,
    commit,
    reviewTarget,
    gitImplementation,
    gitBinaryImplementation
  });
  const submission = parseHeadSubmission(reviewHeadSnapshot.files, `${relativePackage}/submission.json`);
  assertSubmissionIdentity(submission, reviewTarget);
  if (submission.stage === "prototype" && reviewTarget.closure.status !== "complete") {
    throw new CliFailure(
      "PACKAGE_INVALID",
      "prototype preparation requires complete primary and companion source, dependency and build closure",
      { exitCode: 1, details: { closure: reviewTarget.closure } }
    );
  }
  const primaryAuthorityPaths = resolvePrimaryAuthorityPaths(submission, reviewTarget);
  const authoritySnapshot = assertPrimaryAuthorityPathsBoundToHead({
    repositoryRoot,
    commit,
    authorityPaths: primaryAuthorityPaths,
    gitImplementation,
    gitBinaryImplementation
  });
  assertPrimaryAuthorityDocuments({ submission, reviewTarget, files: authoritySnapshot.files });
  const headSnapshot = mergeHeadFileSnapshots(reviewHeadSnapshot, authoritySnapshot);
  const outputPlan = outputDirectory === null
    ? null
    : preflightCentralPackageOutput({
      outputDirectory,
      baseDirectory: repositoryRoot,
      applicationId: submission.model.id,
      replaceExisting,
      replaceDraft
    });
  if (outputPlan !== null) assertOutputOutsideRepository(repositoryRoot, outputPlan.targetDirectory);
  const priorDraftSnapshot = replaceDraft
    ? snapshotLocalDraftPackage({
      targetDirectory: outputPlan.targetDirectory,
      applicationId: submission.model.id,
      expectedDirectoryIdentity: {
        dev: outputPlan.targetDevice,
        ino: outputPlan.targetInode
      }
    })
    : null;
  const declaredPaths = partitionDeclaredPaths(
    reviewTarget.files,
    [
      ...companionManifestBindings.map((binding) => binding.path),
      ...primaryAuthorityPaths
    ]
  );

  let packageResult;
  try {
    packageResult = requireJsonResult(
      runBundledCommand(
        "verify-package.mjs",
        ["--repository-root", repositoryRoot, packageRoot],
        { cwd: repositoryRoot, failureCode: "PACKAGE_INVALID" }
      ),
      "verify-package.mjs"
    );
  } catch (error) {
    if (error instanceof CliFailure && error.details?.validationState === "TOOLING_BLOCKED") {
      throw new CliFailure(
        "TOOLING_BLOCKED",
        "declared source/test content requires materialization or supported tooling before prepare-pr",
        { exitCode: 1, details: error.details }
      );
    }
    if (error instanceof CliFailure) throw error;
    throw new CliFailure("PACKAGE_INVALID", "the submission package could not be validated", { exitCode: 1 });
  }
  if (packageResult.intakeValidated !== true || !DIGEST_PATTERN.test(packageResult.submissionHash ?? "")) {
    throw new CliFailure("PACKAGE_INVALID", "the submission package is not intake-validated", {
      exitCode: 1,
      details: packageResult
    });
  }
  if (packageResult.submissionHash !== reviewTarget.submissionHash) {
    throw new CliFailure("GIT_STATE_CHANGED", "package validation did not bind the exact HEAD submission", { exitCode: 1 });
  }
  const postVerificationTarget = buildReviewTargetDocument(
    repositoryRoot,
    packageRoot,
    companionClosureDiagnostics
  );
  assertSameReviewTarget(reviewTarget, postVerificationTarget);
  const postReviewHeadSnapshot = assertReviewTargetBoundToHead({
    repositoryRoot,
    commit,
    reviewTarget: postVerificationTarget,
    gitImplementation,
    gitBinaryImplementation
  });
  const postAuthoritySnapshot = assertPrimaryAuthorityPathsBoundToHead({
    repositoryRoot,
    commit,
    authorityPaths: primaryAuthorityPaths,
    gitImplementation,
    gitBinaryImplementation
  });
  assertPrimaryAuthorityDocuments({ submission, reviewTarget: postVerificationTarget, files: postAuthoritySnapshot.files });
  assertSameHeadFileSnapshot(authoritySnapshot, postAuthoritySnapshot);
  mergeHeadFileSnapshots(postReviewHeadSnapshot, postAuthoritySnapshot);

  const publicGithub = await publicSourceResolver({
    ...configuredGithub,
    commit,
    tree,
    sourcePaths: declaredPaths.sourcePaths,
    contractPaths: declaredPaths.contractPaths,
    githubActionsRunIds: submission.implementation?.githubActionsRunIds ?? [],
    primaryBlobBytes: selectDeclaredHeadBytes({
      repositoryRoot,
      commit,
      headFiles: headSnapshot.files,
      declaredPaths,
      gitBinaryImplementation
    }),
    companions: companionManifestBindings.map((binding) => ({
      ...binding.source,
      manifestPath: binding.path,
      ...(binding.manifestV2 === null ? {} : { companionManifestV2: binding.manifestV2 })
    })),
    exactObjectResolver,
    fetchImplementation,
    sleepImplementation,
    attempts: publicAttempts,
    timeoutMs: publicTimeoutMs
  });
  const github = { ...configuredGithub, ...publicGithub };
  assertCompanionClosureVerification(companionManifestBindings, github.companionClosure);
  const builderIdentity = await publicBuilderResolver({
    login: submission.builder.github,
    fetchImplementation,
    sleepImplementation,
    attempts: publicAttempts,
    timeoutMs: publicTimeoutMs
  });

  const centralBase = await centralBaseResolver({
    baseBranch: normalizedBase,
    applicationId: submission.model.id,
    fetchImplementation,
    sleepImplementation,
    attempts: centralAttempts,
    timeoutMs: centralTimeoutMs
  });
  const applicationRevision = deriveApplicationRevision({
    applicationId: submission.model.id,
    priorApplication: centralBase.priorApplication,
    nextBuilder: {
      githubUserId: builderIdentity.githubUserId,
      githubLogin: builderIdentity.githubLogin
    },
    nextSource: github.sourceRequest
  });

  await centralBaseStabilityChecker({
    observation: centralBase,
    fetchImplementation,
    sleepImplementation,
    attempts: centralAttempts,
    timeoutMs: centralTimeoutMs
  });

  const finalReviewTarget = buildReviewTargetDocument(
    repositoryRoot,
    packageRoot,
    companionClosureDiagnostics
  );
  assertSameReviewTarget(reviewTarget, finalReviewTarget);
  const finalReviewHeadSnapshot = assertReviewTargetBoundToHead({
    repositoryRoot,
    commit,
    reviewTarget: finalReviewTarget,
    gitImplementation,
    gitBinaryImplementation
  });
  const finalAuthoritySnapshot = assertPrimaryAuthorityPathsBoundToHead({
    repositoryRoot,
    commit,
    authorityPaths: primaryAuthorityPaths,
    gitImplementation,
    gitBinaryImplementation
  });
  assertPrimaryAuthorityDocuments({ submission, reviewTarget: finalReviewTarget, files: finalAuthoritySnapshot.files });
  assertSameHeadFileSnapshot(authoritySnapshot, finalAuthoritySnapshot);
  const finalHeadSnapshot = mergeHeadFileSnapshots(finalReviewHeadSnapshot, finalAuthoritySnapshot);
  const finalCompanionManifestBindings = readCompanionManifestsFromHead({
    repositoryRoot,
    commit,
    manifestPaths: companionManifestPaths,
    gitImplementation,
    gitBinaryImplementation
  });
  if (canonicalJson(finalCompanionManifestBindings) !== canonicalJson(companionManifestBindings)) {
    throw new CliFailure(
      "GIT_STATE_CHANGED",
      "companion manifest bindings changed while prepare-pr was resolving public sources",
      { exitCode: 1 }
    );
  }

  assertGitSnapshotUnchanged({
    repositoryRoot,
    packageRoot,
    branch,
    commit,
    tree,
    remoteName,
    mergeRef,
    upstreamCommit,
    remoteUrl,
    gitImplementation
  });

  const centralPackage = buildCentralApplicationPackage({
    packagePath: relativePackage,
    submission,
    builderIdentity,
    source: github.sourceRequest,
    companionClosure: github.companionClosure,
    applicationRevision,
    packageResult,
    reviewTarget,
    headFiles: finalHeadSnapshot.files
  });

  const document = buildPullRequestDocument({
    repositoryRoot,
    packageRoot,
    baseBranch: normalizedBase,
    branch,
    upstreamBranch,
    remoteName,
    github,
    commit,
    tree,
    submission,
    builderIdentity,
    packageResult,
    reviewTargetHash: reviewTarget.reviewTargetHash,
    centralBase,
    applicationRevision,
    centralPackage
  });
  if (outputPlan === null) return document;
  const localWrite = await outputMaterializer({
    outputDirectory: outputPlan.targetDirectory,
    baseDirectory: repositoryRoot,
    applicationId: submission.model.id,
    centralPackage,
    replaceExisting,
    replaceDraft,
    priorCentralPackage: centralBase.priorCentralPackage,
    priorDraftSnapshot,
    centralBaseCommit: centralBase.baseCommit,
    centralBaseExistingApplication: centralBase.existingApplication,
    centralBasePriorApplication: centralBase.priorApplication
  });
  return {
    ...document,
    localWritesPerformed: [localWrite]
  };
}
