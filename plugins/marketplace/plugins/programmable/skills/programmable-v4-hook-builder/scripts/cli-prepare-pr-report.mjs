import { buildCanonicalApplicationPullRequestBody } from "./github-application-core.mjs";
import { CliFailure } from "./cli-runtime.mjs";
import {
  COMMIT_PATTERN,
  MODEL_ID_PATTERN,
  relativeRepositoryPath,
  toHex32
} from "./cli-prepare-pr-values.mjs";
import { SUBMIT_LAUNCH_REPOSITORY } from "./registry-intake-contract.mjs";

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
    centralBase?.repositorySlug !== SUBMIT_LAUNCH_REPOSITORY
    || centralBase.applicationPath !== `submissions/${modelId}/application.json`
    || !COMMIT_PATTERN.test(centralBase.baseCommit ?? "")
    || !COMMIT_PATTERN.test(centralBase.baseTree ?? "")
    || !Number.isInteger(applicationRevision)
  ) {
    throw new CliFailure("CENTRAL_BASE_INVALID", "the fixed central pull-request target is unavailable", { exitCode: 1 });
  }
  const centralApplicationPath = centralBase.applicationPath;
  const title = `[Builder Beta] ${modelId}`;
  const { body, checklist } = buildCanonicalApplicationPullRequestBody({
    applicationId: modelId,
    stage,
    sourceRepositorySlug: github.repositorySlug,
    sourceRepositoryUrl: github.repositoryUrl,
    builderGitHubLogin: builderIdentity.githubLogin,
    builderGitHubUserId: builderIdentity.githubUserId,
    sourceRepositoryId: github.repositoryId,
    companionCount: github.sourceRequest.companions.length,
    centralBaseCommit: centralBase.baseCommit,
    applicationRevision,
    sourceCommit: commit,
    sourceTree: tree,
    compatibilityResult: centralPackage.compatibilityResult,
    centralFileCount: centralPackage.fileCount
  });

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
        githubActionsRunIds: [...github.sourceRequest.primary.githubActionsRunIds]
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
        preflightDecision: packageResult.preflightDecision,
        compatibilityResult: centralPackage.compatibilityResult
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
