import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { TextDecoder } from "node:util";
import {
  assertInsideRepository,
  resolveRepositoryRoot,
  spawnSafeGitSync
} from "./repository-root.mjs";
import {
  assertCentralBaseUnchanged,
  deriveApplicationRevision,
  resolveCentralApplicationBase
} from "./cli-central-base.mjs";
import { normalizeCompanionManifest } from "./companion-manifest-contract.mjs";
import { buildCentralApplicationPackage } from "./cli-central-package.mjs";
import {
  normalizeCompanionDescriptors,
  parseGitHubRemote,
  resolvePublicGitHubUser,
  resolvePublicGitHubSource
} from "./cli-github-source.mjs";
import { materializeCentralPackage, preflightCentralPackageOutput } from "./cli-output-dir.mjs";
import {
  CliFailure,
  requireJsonResult,
  runBundledCommand,
  sanitizeMessage
} from "./cli-runtime.mjs";
import {
  isCanonicalGitHubRepositoryPathV1
} from "./github-public-source-core.mjs";
import {
  GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1
} from "./github-exact-object-resolver.mjs";
import { snapshotLocalDraftPackage } from "./cli-local-draft.mjs";
import { canonicalJson, STANDARD_VERSION, submissionHash } from "./submission-core.mjs";
import {
  appendReviewTargetClosureDiagnostics,
  calculateReviewTargetHash
} from "./review-target-core.mjs";
import {
  EXTERNAL_PACKAGE_SOURCE_CLASS,
  isExternalPackageReviewRecord
} from "./package-dependency-contract.mjs";
import {
  isCanonicalReviewTargetPath,
  isClosedReviewTargetClosure,
  isGitLfsPointer,
  isSourceOrTestReviewKind,
  REVIEW_TARGET_CLOSURE_METHOD_V1,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";
import { isClosedRuntimeAssetReview } from "./runtime-assets-core.mjs";

export { CliFailure } from "./cli-runtime.mjs";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MODEL_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REMOTE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_BRANCH_PATTERN = /^(?!\/)(?!.*(?:\.\.|\/\/|@\{|\\|[\u0000-\u0020\u007f~^:?*\[]))[A-Za-z0-9._/-]{1,255}(?<![\/.])$/;
const REVIEW_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_COMPANION_MANIFESTS = 8;
const MAX_COMPANION_MANIFEST_BYTES = 65_536;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

export function inspectLocalGitReadiness(repositoryRoot, gitImplementation = runGit) {
  const blocked = (status, reason) => ({ status, reason });
  const exactObjectTooling = inspectExactObjectGitTooling();
  let topLevel;
  try {
    topLevel = fs.realpathSync(git(repositoryRoot, ["rev-parse", "--show-toplevel"], gitImplementation));
  } catch (error) {
    const toolingBlocked = error instanceof CliFailure && error.code === "TOOLING_BLOCKED";
    const unavailableReason = toolingBlocked
      ? error.message
      : "selected directory is not a Git worktree";
    return {
      gitRepository: blocked(toolingBlocked ? "toolingBlocked" : "missing", unavailableReason),
      exactObjectTooling,
      cleanWorktree: blocked("notChecked", unavailableReason),
      namedBranch: blocked("notChecked", unavailableReason),
      upstream: blocked("notChecked", unavailableReason),
      pushedRevision: blocked("notChecked", unavailableReason),
      githubRemote: blocked("notChecked", unavailableReason),
      publicReachability: blocked("notChecked", "live anonymous GitHub resolution runs only in prepare-pr"),
      readyForPreparePrLocal: false,
      readyForPublicBeta: false
    };
  }
  if (topLevel !== repositoryRoot) {
    return {
      gitRepository: blocked("wrongRoot", "selected directory is not the Git worktree root"),
      exactObjectTooling,
      cleanWorktree: blocked("notChecked", "select the exact worktree root"),
      namedBranch: blocked("notChecked", "select the exact worktree root"),
      upstream: blocked("notChecked", "select the exact worktree root"),
      pushedRevision: blocked("notChecked", "select the exact worktree root"),
      githubRemote: blocked("notChecked", "select the exact worktree root"),
      publicReachability: blocked("notChecked", "live anonymous GitHub resolution runs only in prepare-pr"),
      readyForPreparePrLocal: false,
      readyForPublicBeta: false
    };
  }

  const status = git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"], gitImplementation);
  const clean = status.length === 0;
  let branch = null;
  try {
    branch = requireSafeBranch(git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], gitImplementation), "head branch");
  } catch {
    // Detached and unborn branches are explicit blocked states below.
  }
  let upstreamCommit = null;
  let headCommit = null;
  let remoteName = null;
  let remoteUrl = null;
  let github = null;
  if (branch !== null) {
    try {
      headCommit = requireCommit(git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"], gitImplementation), "HEAD");
      upstreamCommit = requireCommit(git(repositoryRoot, ["rev-parse", "--verify", "@{upstream}^{commit}"], gitImplementation), "upstream");
      remoteName = git(repositoryRoot, ["config", "--get", `branch.${branch}.remote`], gitImplementation);
      remoteUrl = git(repositoryRoot, ["config", "--get", `remote.${remoteName}.url`], gitImplementation);
      github = parseGitHubRemote(remoteUrl);
    } catch {
      // The individual blocked states below remain deterministic and read-only.
    }
  }
  const upstreamReady = upstreamCommit !== null && remoteName !== null;
  const pushed = upstreamReady && headCommit === upstreamCommit;
  const githubReady = github !== null;
  const localReady = clean
    && branch !== null
    && upstreamReady
    && pushed
    && githubReady
    && exactObjectTooling.status === "ready";
  return {
    gitRepository: { status: "ready", root: topLevel },
    exactObjectTooling,
    cleanWorktree: clean
      ? { status: "ready" }
      : blocked("dirty", "commit or remove every tracked, untracked and ignored package change before prepare-pr"),
    namedBranch: branch === null
      ? blocked("missing", "prepare-pr requires a named branch with a commit")
      : { status: "ready", branch },
    upstream: upstreamReady
      ? { status: "ready", remote: remoteName }
      : blocked("missing", "the current branch has no resolvable upstream"),
    pushedRevision: !upstreamReady
      ? blocked("notChecked", "the upstream revision is unavailable")
      : pushed
        ? { status: "ready", commit: headCommit }
        : blocked("unpushed", "HEAD does not equal the configured upstream revision"),
    githubRemote: githubReady
      ? { status: "ready", repository: github.repositorySlug, configuredRemoteUrl: remoteUrl }
      : blocked("unsupported", "the upstream remote must be an uncredentialed github.com repository URL"),
    publicReachability: blocked("notChecked", "live anonymous repository, commit and tree resolution runs only in prepare-pr"),
    readyForPreparePrLocal: localReady,
    readyForPublicBeta: false
  };
}

export function inspectExactObjectGitTooling(gitProbe = spawnSafeGitSync) {
  const minimum = GITHUB_PUBLIC_GIT_OBJECT_RESOLVER_V1.minimumGitVersion;
  const versionResult = gitProbe(["--version"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65_536
  });
  const version = parseGitVersion(versionResult?.stdout);
  if (versionResult?.status !== 0 || version === null || compareVersion(version, minimum) < 0) {
    return {
      status: "toolingBlocked",
      version,
      reason: `Git ${minimum} or newer is required for exact public-source verification`
    };
  }

  const backfillResult = gitProbe(["backfill", "-h"], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65_536
  });
  const backfillOutput = `${backfillResult?.stdout ?? ""}\n${backfillResult?.stderr ?? ""}`;
  if (!/(?:^|\n)usage: git backfill(?: |\n)/u.test(backfillOutput)) {
    return {
      status: "toolingBlocked",
      version,
      reason: "git backfill --sparse is required for exact public-source verification"
    };
  }

  return {
    status: "ready",
    version,
    capability: "git backfill --sparse"
  };
}

function parseGitVersion(output) {
  if (typeof output !== "string") return null;
  const match = /^git version ([0-9]+\.[0-9]+\.[0-9]+)(?:[^0-9.]|$)/u.exec(output.trim());
  return match?.[1] ?? null;
}

function compareVersion(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

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
  const repositoryRoot = resolveRoot(repositoryRootInput);
  const packageRoot = resolvePackage(repositoryRoot, packageInput);
  const normalizedBase = requireSafeBranch(baseBranch, "base branch");
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
    primaryBlobBytes: selectDeclaredHeadBytes({
      repositoryRoot,
      commit,
      headFiles: headSnapshot.files,
      declaredPaths,
      gitBinaryImplementation
    }),
    companions: companionManifestBindings.map((binding) => ({
      ...binding.source,
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

function selectDeclaredHeadBytes({
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

export function buildPullRequestDocument({
  repositoryRoot,
  packageRoot,
  baseBranch,
  branch,
  upstreamBranch,
  remoteName,
  github,
  commit,
  tree,
  submission,
  builderIdentity,
  packageResult,
  reviewTargetHash,
  centralBase,
  applicationRevision,
  centralPackage
}) {
  const modelId = submission?.model?.id;
  const stage = submission?.stage;
  if (!MODEL_ID_PATTERN.test(modelId ?? "")) {
    throw new CliFailure("PACKAGE_INVALID", "submission.model.id is not canonical");
  }
  if (!new Set(["proposal", "prototype"]).has(stage)) {
    throw new CliFailure("PACKAGE_INVALID", "submission.stage is not a public builder stage");
  }
  const relativePackage = relativeRepositoryPath(repositoryRoot, packageRoot);
  if (
    centralBase?.repositorySlug !== "0xprogrammable/programmable"
    || centralBase.applicationPath !== `submissions/${modelId}/application.json`
    || !COMMIT_PATTERN.test(centralBase.baseCommit ?? "")
    || !COMMIT_PATTERN.test(centralBase.baseTree ?? "")
    || !Number.isInteger(applicationRevision)
  ) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the fixed central pull-request target is unavailable", { exitCode: 1 });
  }
  const centralApplicationPath = centralBase.applicationPath;
  const title = `[Builder Beta] ${modelId}`;
  const checklist = [
    { id: "clean-worktree", checked: true, label: "The exact revision was prepared from a clean Git worktree." },
    { id: "pushed-revision", checked: true, label: "HEAD equals the configured upstream revision." },
    { id: "public-github", checked: true, label: "GitHub independently resolved the numeric repository id, commit and tree." },
    { id: "package-gate", checked: true, label: "The deterministic public intake package gate passed." },
    { id: "human-review", checked: false, label: "I reviewed the generated title, body, source and evidence." },
    { id: "open-draft-pr", checked: false, label: "I explicitly authorize opening the draft pull request." }
  ];
  const body = [
    "## Builder submission",
    "",
    `- Model: \`${modelId}\``,
    `- Stage: \`${stage}\``,
    `- Source repository: \`${github.repositorySlug}\` (${github.repositoryUrl})`,
    `- Builder GitHub identity: \`${builderIdentity.githubLogin}\` (immutable user id \`${builderIdentity.githubUserId}\`)`,
    `- GitHub repository id: \`${github.repositoryId}\``,
    `- Companion repositories: \`${github.sourceRequest.companions.length}\` exact public bindings`,
    `- Package: \`${relativePackage}\``,
    `- Central target: \`${centralBase.repositorySlug}:${baseBranch}\` at \`${centralBase.baseCommit}\``,
    `- Central application target: \`${centralApplicationPath}\``,
    `- Application revision: \`${applicationRevision}\``,
    `- Source head commit: \`${commit}\``,
    `- Source head tree: \`${tree}\``,
    `- Source-resolution hash: \`${github.sourceResolutionHash}\``,
    `- Submission hash: \`${packageResult.submissionHash}\``,
    `- Review-target hash: \`${reviewTargetHash}\``,
    `- Compatibility: \`${packageResult.preflightDecision}\``,
    `- Central package: \`${centralPackage.fileCount}\` files in frozen validator order`,
    "",
    "## Confirmation checklist",
    "",
    ...checklist.map(({ checked, label }) => `- [${checked ? "x" : " "}] ${label}`),
    "",
    "The complete six-file central package is embedded in the machine-readable output and was not written to the central repository.",
    "This body was prepared locally. No branch was pushed and no pull request was opened by `prepare-pr`.",
    "Passing intake checks is not acceptance, an audit, deployment evidence, routing approval, or availability."
  ].join("\n");

  return {
    title,
    body,
    checklist,
    sourceHead: {
      repositorySlug: github.repositorySlug,
      repositoryUrl: github.repositoryUrl,
      branch,
      upstreamBranch,
      remote: remoteName,
      commit,
      tree
    },
    centralPullRequestTarget: {
      repositorySlug: centralBase.repositorySlug,
      repositoryUrl: centralBase.repositoryUrl,
      baseBranch,
      baseCommit: centralBase.baseCommit,
      baseTree: centralBase.baseTree,
      applicationDirectory: centralBase.applicationDirectory,
      applicationPath: centralApplicationPath,
      priorApplicationRevision: centralBase.priorApplicationRevision,
      nextApplicationRevision: applicationRevision,
      pullRequestHeadCreated: false
    },
    github: {
      owner: github.owner,
      repository: github.repository,
      repositorySlug: github.repositorySlug,
      repositoryId: github.repositoryId,
      repositoryUrl: github.repositoryUrl,
      configuredRemoteUrl: github.configuredRemoteUrl,
      commitUrl: `${github.repositoryUrl}/commit/${commit}`,
      publicCommitReachable: true,
      sourceRequest: github.sourceRequest,
      sourceResolutionHash: github.sourceResolutionHash,
      sourceResolution: github.sourceResolution,
      companionClosure: github.companionClosure ?? []
    },
    submission: {
      package: relativePackage,
      modelId,
      stage,
      hash: packageResult.submissionHash,
      reviewTargetHash,
      preflightDecision: packageResult.preflightDecision,
      intakeValidated: true
    },
    applicationAdapter: {
      targetPath: centralApplicationPath,
      applicationRevision,
      builder: {
        githubUserId: builderIdentity.githubUserId,
        githubLogin: builderIdentity.githubLogin,
        contact: builderIdentity.profileUrl
      },
      schemaStatus: "validator-compatible-six-file-package",
      source: {
        repositoryUri: github.repositoryUrl,
        numericRepositoryId: github.repositoryId,
        revisionObjectId: commit,
        treeObjectId: tree,
        sourcePaths: [...github.sourceRequest.primary.sourcePaths],
        contractPaths: [...github.sourceRequest.primary.contractPaths],
        githubActionsRunIds: []
      },
      sourceRequest: github.sourceRequest,
      display: {
        repository: github.repositorySlug,
        configuredRemoteUrl: github.configuredRemoteUrl,
        package: relativePackage
      },
      evidencePackage: {
        boundedBy: "scripts/verify-package.mjs",
        intakeValidated: true,
        sourceResolutionHash: github.sourceResolutionHash,
        sourceResolutionHashHex32: toHex32(github.sourceResolutionHash),
        submissionHash: packageResult.submissionHash,
        submissionHashHex32: toHex32(packageResult.submissionHash),
        reviewTargetHash,
        reviewTargetHashHex32: toHex32(reviewTargetHash),
        preflightDecision: packageResult.preflightDecision
      },
      publicGitHubApplicationReady: true
    },
    centralPackage,
    requiresHumanConfirmation: true,
    localWritesPerformed: [],
    externalReadChecksPerformed: [
      "github-builder-identity-resolution",
      "github-public-source-resolution",
      "central-github-base-and-prior-resolution",
      "central-github-base-stability-check"
    ],
    externalActionsPerformed: []
  };
}

function resolveRoot(input) {
  try {
    return resolveRepositoryRoot(input);
  } catch (error) {
    throw new CliFailure("REPOSITORY_REQUIRED", error.message);
  }
}

function resolvePackage(repositoryRoot, input) {
  if (typeof input !== "string" || input.length === 0 || containsUnsafeText(input)) {
    throw new CliFailure("INVALID_PATH", "submission package path is invalid");
  }
  try {
    const target = assertInsideRepository(repositoryRoot, path.resolve(repositoryRoot, input));
    if (!fs.statSync(target).isDirectory()) throw new Error("submission package is not a directory");
    return target;
  } catch (error) {
    throw new CliFailure("INVALID_PATH", error.message);
  }
}

function assertOutputOutsideRepository(repositoryRoot, targetDirectory) {
  const contains = (parent, child) => {
    const relative = path.relative(parent, child);
    return relative === ""
      || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  if (contains(repositoryRoot, targetDirectory) || contains(targetDirectory, repositoryRoot)) {
    throw new CliFailure(
      "OUTPUT_PATH_INVALID",
      "prepare-pr output must be completely outside the builder source repository",
      { exitCode: 1 }
    );
  }
}

function resolveCompanionManifestPaths(repositoryRoot, inputs) {
  if (!Array.isArray(inputs) || inputs.length > MAX_COMPANION_MANIFESTS) {
    throw new CliFailure("COMPANION_MANIFEST_INVALID", "prepare-pr accepts at most eight companion manifests", {
      exitCode: 1
    });
  }
  const paths = [];
  const seen = new Set();
  for (const input of inputs) {
    if (typeof input !== "string" || input.length === 0 || containsUnsafeText(input)) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest path is invalid", { exitCode: 1 });
    }
    const unresolved = path.resolve(repositoryRoot, input);
    let resolved;
    try {
      resolved = assertInsideRepository(repositoryRoot, unresolved);
    } catch (error) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", error.message, { exitCode: 1 });
    }
    if (resolved !== unresolved) {
      throw new CliFailure(
        "COMPANION_MANIFEST_INVALID",
        "companion manifest paths cannot use symbolic aliases",
        { exitCode: 1 }
      );
    }
    const repositoryPath = relativeRepositoryPath(repositoryRoot, resolved);
    if (
      !isCanonicalGitHubRepositoryPathV1(repositoryPath)
      || seen.has(repositoryPath)
    ) {
      throw new CliFailure(
        "COMPANION_MANIFEST_INVALID",
        "companion manifest paths must be unique canonical repository paths",
        { exitCode: 1 }
      );
    }
    seen.add(repositoryPath);
    paths.push(repositoryPath);
  }
  return Object.freeze(paths.sort(compareUtf8));
}

function readCompanionManifestsFromHead({
  repositoryRoot,
  commit,
  manifestPaths,
  gitImplementation,
  gitBinaryImplementation
}) {
  const parsed = [];
  for (const manifestPath of manifestPaths) {
    const treeRecord = git(
      repositoryRoot,
      ["ls-tree", "--full-tree", commit, "--", manifestPath],
      gitImplementation,
      { code: "COMPANION_MANIFEST_NOT_HEAD", message: "companion manifest is absent from the exact primary HEAD" }
    );
    const match = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/u.exec(treeRecord);
    if (!match || match[3] !== manifestPath) {
      throw new CliFailure(
        "COMPANION_MANIFEST_NOT_HEAD",
        "every companion manifest must be a regular blob in the exact primary HEAD",
        { exitCode: 1 }
      );
    }
    const indexRecord = git(
      repositoryRoot,
      ["ls-files", "-v", "--", manifestPath],
      gitImplementation,
      { code: "COMPANION_MANIFEST_NOT_HEAD", message: "companion manifest index state is unavailable" }
    );
    if (indexRecord !== `H ${manifestPath}`) {
      throw new CliFailure(
        "COMPANION_MANIFEST_NOT_HEAD",
        "companion manifests cannot use assume-unchanged, skip-worktree, symlink, or gitlink state",
        { exitCode: 1 }
      );
    }
    const bytes = gitBinary(
      repositoryRoot,
      ["cat-file", "blob", `${commit}:${manifestPath}`],
      gitBinaryImplementation
    );
    if (bytes.length < 2 || bytes.length > MAX_COMPANION_MANIFEST_BYTES) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest exceeds the bounded byte limit", {
        exitCode: 1
      });
    }
    let source;
    let value;
    try {
      source = utf8Decoder.decode(bytes);
      value = JSON.parse(source);
    } catch {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest must be valid UTF-8 JSON", {
        exitCode: 1
      });
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new CliFailure("COMPANION_MANIFEST_INVALID", "companion manifest must be a JSON object", {
        exitCode: 1
      });
    }
    const canonicalBytes = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    if (!bytes.equals(canonicalBytes)) {
      throw new CliFailure(
        "COMPANION_MANIFEST_INVALID",
        "companion manifest must use canonical JSON with one trailing newline",
        { exitCode: 1 }
      );
    }
    let normalized;
    try {
      normalized = normalizeCompanionManifest(value);
    } catch (error) {
      throw new CliFailure(
        "COMPANION_MANIFEST_INVALID",
        sanitizeMessage(error?.message ?? "companion manifest is invalid"),
        { exitCode: 1 }
      );
    }
    parsed.push({ path: manifestPath, ...normalized });
  }
  const normalized = normalizeCompanionDescriptors(parsed.map((binding) => ({
    ...binding.source,
    ...(binding.manifestV2 === null ? {} : { companionManifestV2: binding.manifestV2 })
  })));
  return parsed.map((binding, index) => Object.freeze({
    path: binding.path,
    schemaVersion: binding.schemaVersion,
    source: Object.freeze({
      repositoryUri: normalized[index].repositoryUri,
      revisionObjectId: normalized[index].revisionObjectId,
      sourcePaths: normalized[index].sourcePaths,
      contractPaths: normalized[index].contractPaths,
      ...(normalized[index].numericRepositoryId === null ? {} : {
        numericRepositoryId: normalized[index].numericRepositoryId,
        treeObjectId: normalized[index].treeObjectId,
        githubActionsRunIds: normalized[index].githubActionsRunIds
      })
    }),
    manifestV2: binding.manifestV2,
    closureStatus: binding.closureStatus
  }));
}

function assertCompanionClosureVerification(bindings, attestations) {
  const required = bindings.filter(({ manifestV2 }) => manifestV2 !== null);
  if (required.length === 0) return;
  if (!Array.isArray(attestations)) {
    throw new CliFailure(
      "TOOLING_BLOCKED",
      "companion manifest v2 requires exact remote closure verification",
      { exitCode: 1 }
    );
  }
  const verifiedByRepository = new Map(attestations.map((entry) => [entry?.repositoryUri, entry]));
  for (const binding of required) {
    const verified = verifiedByRepository.get(binding.manifestV2.repositoryUri);
    if (
      verified?.status !== "verified"
      || verified.numericRepositoryId !== binding.manifestV2.numericRepositoryId
      || verified.revisionObjectId !== binding.manifestV2.revisionObjectId
      || verified.treeObjectId !== binding.manifestV2.treeObjectId
    ) {
      throw new CliFailure(
        "PACKAGE_INVALID",
        "companion manifest v2 did not verify the exact repository, commit, tree, source, test, build, and dependency closure",
        { exitCode: 1, details: { path: binding.path } }
      );
    }
  }
}

function buildReviewTargetDocument(repositoryRoot, packageRoot, additionalClosureDiagnostics = []) {
  let reviewTarget;
  try {
    reviewTarget = requireJsonResult(
      runBundledCommand(
        "cli-review-target.mjs",
        [repositoryRoot, packageRoot],
        { cwd: repositoryRoot, failureCode: "REVIEW_TARGET_INVALID" }
      ),
      "cli-review-target.mjs"
    );
    reviewTarget = appendReviewTargetClosureDiagnostics(reviewTarget, additionalClosureDiagnostics);
  } catch (error) {
    if (error instanceof CliFailure && /Git LFS pointer/u.test(error.message)) {
      throw new CliFailure(
        "TOOLING_BLOCKED",
        "declared source/test Git LFS content must be materialized before prepare-pr",
        { exitCode: 1, details: error.details }
      );
    }
    throw error;
  }
  return validatePreparePrReviewTarget(reviewTarget);
}

export function validatePreparePrReviewTarget(reviewTarget) {
  const topLevelKeys = [
    "closure",
    "closureMethod",
    "externalImports",
    "files",
    "importResolutions",
    "javascriptImportResolutions",
    "reviewTargetHash",
    "schemaVersion",
    "standardVersion",
    "submissionHash",
    ...(Object.hasOwn(reviewTarget ?? {}, "runtimeAssets") ? ["runtimeAssets"] : [])
  ];
  if (
    !isPlainObject(reviewTarget)
    || !hasExactKeys(reviewTarget, topLevelKeys)
    || reviewTarget.schemaVersion !== 1
    || reviewTarget.standardVersion !== STANDARD_VERSION
    || reviewTarget.closureMethod !== REVIEW_TARGET_CLOSURE_METHOD_V1
    || !isClosedReviewTargetClosure(reviewTarget.closure)
    || !DIGEST_PATTERN.test(reviewTarget.reviewTargetHash ?? "")
    || !DIGEST_PATTERN.test(reviewTarget.submissionHash ?? "")
    || !Array.isArray(reviewTarget.files)
    || reviewTarget.files.length === 0
    || reviewTarget.files.length > REVIEW_TARGET_CONTRACT_V1.maximumFiles
    || !Array.isArray(reviewTarget.externalImports)
    || !Array.isArray(reviewTarget.importResolutions)
    || !Array.isArray(reviewTarget.javascriptImportResolutions)
    || (Object.hasOwn(reviewTarget, "runtimeAssets") && !isClosedRuntimeAssetReview(reviewTarget.runtimeAssets))
    || reviewTarget.reviewTargetHash !== calculateReviewTargetHash(reviewTarget)
  ) {
    throw new CliFailure("REVIEW_TARGET_INVALID", "the review target did not produce a bounded exact identity", { exitCode: 1 });
  }
  const paths = new Set();
  let totalBytes = 0;
  let previousPath = null;
  for (const record of reviewTarget.files) {
    const declaresExternalPackage = Object.hasOwn(record ?? {}, "sourceClass")
      || Object.hasOwn(record ?? {}, "packageDependency");
    const expectedRecordKeys = declaresExternalPackage
      ? ["bytes", "kind", "packageDependency", "path", "sha256", "sourceClass"]
      : ["bytes", "kind", "path", "sha256"];
    if (
      !isPlainObject(record)
      || !hasExactKeys(record, expectedRecordKeys)
      || !isCanonicalReviewTargetPath(record.path)
      || !isBoundedReviewText(record.kind, 200)
      || !Number.isInteger(record.bytes)
      || record.bytes < 0
      || record.bytes > REVIEW_TARGET_CONTRACT_V1.maximumFileBytes
      || !REVIEW_DIGEST_PATTERN.test(record.sha256 ?? "")
      || paths.has(record.path)
      || (previousPath !== null && compareUtf8(previousPath, record.path) >= 0)
      || (declaresExternalPackage && !isExternalPackageReviewRecord(record))
      || (declaresExternalPackage && !hasExactKeys(record.packageDependency, [
        "centralSourceVerified",
        "evidenceState",
        "integrity",
        "integrityVerified",
        "packageName",
        "repository",
        "revision",
        "version"
      ]))
    ) {
      throw new CliFailure("REVIEW_TARGET_INVALID", "the review target contains an unpublishable file record", { exitCode: 1 });
    }
    previousPath = record.path;
    paths.add(record.path);
    totalBytes += record.bytes;
    if (totalBytes > REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes) {
      throw new CliFailure("REVIEW_TARGET_INVALID", "the review target exceeds the canonical total byte limit", { exitCode: 1 });
    }
  }
  validateClosedStringSet(reviewTarget.externalImports, "external import");
  validateClosedImportResolutions(reviewTarget.importResolutions, { javascript: false });
  validateClosedImportResolutions(reviewTarget.javascriptImportResolutions, { javascript: true });
  return reviewTarget;
}

function validateClosedStringSet(values, label) {
  if (values.length > REVIEW_TARGET_CONTRACT_V1.maximumImportResolutions) {
    throw new CliFailure("REVIEW_TARGET_INVALID", `the review target contains too many ${label} records`, { exitCode: 1 });
  }
  const seen = new Set();
  let previous = null;
  for (const value of values) {
    if (
      !isBoundedReviewText(value, 1_024)
      || seen.has(value)
      || (previous !== null && compareUtf8(previous, value) >= 0)
    ) {
      throw new CliFailure("REVIEW_TARGET_INVALID", `the review target contains an invalid ${label} record`, { exitCode: 1 });
    }
    seen.add(value);
    previous = value;
  }
}

function validateClosedImportResolutions(records, { javascript }) {
  if (records.length > REVIEW_TARGET_CONTRACT_V1.maximumImportResolutions) {
    throw new CliFailure("REVIEW_TARGET_INVALID", "the review target contains too many import resolution records", { exitCode: 1 });
  }
  const identities = new Set();
  let previous = null;
  for (const record of records) {
    const keys = javascript
      ? ["importer", "kind", "resolvedPath", "specifier"]
      : Object.hasOwn(record ?? {}, "packageName")
        ? ["importer", "kind", "packageName", "remappingPrefix", "remappingTarget", "resolvedPath", "specifier"]
        : ["importer", "kind", "remappingPrefix", "remappingTarget", "resolvedPath", "specifier"];
    if (
      !isPlainObject(record)
      || !hasExactKeys(record, keys)
      || !isCanonicalReviewTargetPath(record.importer)
      || !isCanonicalReviewTargetPath(record.resolvedPath)
      || !isBoundedReviewText(record.kind, 200)
      || !isBoundedReviewText(record.specifier, 1_024)
      || (!javascript && !isNullableBoundedReviewText(record.remappingPrefix, 1_024))
      || (!javascript && !isNullableBoundedReviewText(record.remappingTarget, 1_024))
      || (Object.hasOwn(record, "packageName") && !isBoundedReviewText(record.packageName, 214))
    ) {
      throw new CliFailure("REVIEW_TARGET_INVALID", "the review target contains an invalid import resolution record", { exitCode: 1 });
    }
    const identity = canonicalJson(record);
    if (
      identities.has(identity)
      || (previous !== null && compareImportResolutionRecords(previous, record) >= 0)
    ) {
      throw new CliFailure("REVIEW_TARGET_INVALID", "the review target contains duplicate or noncanonically ordered import resolution records", { exitCode: 1 });
    }
    identities.add(identity);
    previous = record;
  }
}

function compareImportResolutionRecords(left, right) {
  return compareUtf8(left.specifier, right.specifier)
    || compareUtf8(left.importer, right.importer)
    || compareUtf8(left.resolvedPath, right.resolvedPath)
    || compareUtf8(canonicalJson(left), canonicalJson(right));
}

function isNullableBoundedReviewText(value, maximumBytes) {
  return value === null || isBoundedReviewText(value, maximumBytes);
}

function isBoundedReviewText(value, maximumBytes) {
  return typeof value === "string"
    && value.length > 0
    && Buffer.byteLength(value, "utf8") <= maximumBytes
    && value.normalize("NFC") === value
    && !containsUnsafeText(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value).sort(compareUtf8);
  const sortedExpected = [...expected].sort(compareUtf8);
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

function assertReviewTargetBoundToHead({
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

function resolvePrimaryAuthorityPaths(submission, reviewTarget) {
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

function assertPrimaryAuthorityPathsBoundToHead({
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

function readStableAuthorityFile(target, repositoryPath) {
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

function assertPrimaryAuthorityDocuments({ submission, reviewTarget, files }) {
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

function parsePrimaryAuthorityJson(bytes, label) {
  if (!Buffer.isBuffer(bytes)) {
    throw new CliFailure("PACKAGE_INVALID", `${label} is absent from the exact HEAD authority snapshot`, {
      exitCode: 1
    });
  }
  try {
    return JSON.parse(utf8Decoder.decode(bytes));
  } catch {
    throw new CliFailure("PACKAGE_INVALID", `${label} must be exact UTF-8 JSON in HEAD`, { exitCode: 1 });
  }
}

function mergeHeadFileSnapshots(...snapshots) {
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

function assertSameHeadFileSnapshot(expected, observed) {
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

function parseHeadSubmission(headFiles, submissionPath) {
  const bytes = headFiles.get(submissionPath);
  if (!Buffer.isBuffer(bytes)) {
    throw new CliFailure("PACKAGE_INVALID", "submission.json is absent from the exact HEAD review target", { exitCode: 1 });
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new CliFailure("PACKAGE_INVALID", `submission.json: ${sanitizeMessage(error.message)}`, { exitCode: 1 });
  }
}

function assertSubmissionIdentity(submission, reviewTarget) {
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

function assertSameReviewTarget(expected, observed) {
  if (canonicalJson(expected) !== canonicalJson(observed)) {
    throw new CliFailure("GIT_STATE_CHANGED", "the review target changed while prepare-pr was building the bundle", { exitCode: 1 });
  }
}

function partitionDeclaredPaths(files, additionalSourcePaths = []) {
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

function assertCleanWorktree(repositoryRoot, packageRoot, gitImplementation) {
  const status = git(
    repositoryRoot,
    ["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"],
    gitImplementation
  );
  const packageRelative = relativeRepositoryPath(repositoryRoot, packageRoot);
  const packageStatus = git(
    repositoryRoot,
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored=matching",
      "--ignore-submodules=none",
      "--",
      packageRelative
    ],
    gitImplementation
  );
  if (status.length > 0 || packageStatus.length > 0) {
    throw new CliFailure(
      "WORKTREE_DIRTY",
      "prepare-pr requires a clean worktree and a fully tracked submission package",
      { exitCode: 1 }
    );
  }
}

function assertGitSnapshotUnchanged({
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
}) {
  assertCleanWorktree(repositoryRoot, packageRoot, gitImplementation);
  const failure = {
    code: "GIT_STATE_CHANGED",
    message: "the Git identity changed while prepare-pr was building the bundle"
  };
  const observed = {
    branch: git(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], gitImplementation, failure),
    commit: git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{commit}"], gitImplementation, failure),
    tree: git(repositoryRoot, ["rev-parse", "--verify", "HEAD^{tree}"], gitImplementation, failure),
    remoteName: git(repositoryRoot, ["config", "--get", `branch.${branch}.remote`], gitImplementation, failure),
    mergeRef: git(repositoryRoot, ["config", "--get", `branch.${branch}.merge`], gitImplementation, failure),
    upstreamCommit: git(repositoryRoot, ["rev-parse", "--verify", "@{upstream}^{commit}"], gitImplementation, failure),
    remoteUrl: git(repositoryRoot, ["config", "--get", `remote.${remoteName}.url`], gitImplementation, failure)
  };
  const expected = { branch, commit, tree, remoteName, mergeRef, upstreamCommit, remoteUrl };
  if (Object.keys(expected).some((key) => observed[key] !== expected[key])) {
    throw new CliFailure(failure.code, failure.message, { exitCode: 1 });
  }
}

function relativeRepositoryPath(repositoryRoot, target) {
  const relative = path.relative(repositoryRoot, target).split(path.sep).join("/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative) || containsUnsafeText(relative)) {
    throw new CliFailure("INVALID_PATH", "submission package path is not repository-relative");
  }
  return relative;
}

function toHex32(digest) {
  if (!DIGEST_PATTERN.test(digest ?? "")) {
    throw new CliFailure("PACKAGE_INVALID", "application adapter requires an exact SHA-256 digest");
  }
  return `0x${digest.slice("sha256:".length)}`;
}

function runGit(repositoryRoot, args) {
  return spawnSafeGitSync(["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 2_000_000
  });
}

function runGitBinary(repositoryRoot, args) {
  return spawnSafeGitSync(["-C", repositoryRoot, ...args], {
    encoding: null,
    timeout: 5_000,
    maxBuffer: 2_000_001
  });
}

function git(repositoryRoot, args, implementation, failure = {}) {
  const result = implementation(repositoryRoot, args);
  if (result?.status !== 0) {
    if (typeof result?.safeGitBlocker === "string") {
      throw new CliFailure("TOOLING_BLOCKED", result.safeGitBlocker, { exitCode: 1 });
    }
    throw new CliFailure(
      failure.code ?? "GIT_STATE_INVALID",
      failure.message ?? `Git command failed: ${args[0]}`,
      { exitCode: 1 }
    );
  }
  return String(result.stdout ?? "").trim();
}

function gitBinary(repositoryRoot, args, implementation) {
  const result = implementation(repositoryRoot, args);
  if (result?.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    if (typeof result?.safeGitBlocker === "string") {
      throw new CliFailure("TOOLING_BLOCKED", result.safeGitBlocker, { exitCode: 1 });
    }
    throw new CliFailure("GIT_STATE_INVALID", "Git could not read an exact review-target blob", { exitCode: 1 });
  }
  return result.stdout;
}

function requireCommit(value, label) {
  if (!COMMIT_PATTERN.test(value)) {
    throw new CliFailure("GIT_STATE_INVALID", `${label} is not an exact 40-character Git object id`, { exitCode: 1 });
  }
  return value;
}

function requireSafeBranch(value, label) {
  if (!SAFE_BRANCH_PATTERN.test(value ?? "") || value.endsWith(".lock")) {
    throw new CliFailure("GIT_STATE_INVALID", `${label} is not a supported Git branch name`, { exitCode: 1 });
  }
  return value;
}

function containsUnsafeText(value) {
  return typeof value !== "string"
    || /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}
