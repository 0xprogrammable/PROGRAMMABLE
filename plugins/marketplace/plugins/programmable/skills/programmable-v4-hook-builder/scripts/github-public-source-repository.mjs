import { GitHubPublicSourceError } from "./github-public-source-contract.mjs";
import { requestGitHubJson } from "./github-public-source-api.mjs";
import { validateTree } from "./github-public-source-tree.mjs";
import {
  assertPlainObject,
  deepFreeze,
  normalizeDisplayText,
  normalizeGitObjectId,
  normalizeOpaqueId,
  normalizeSafeCode,
  normalizeWorkflowPath,
  parseCanonicalRepositoryUri,
  validateActionsHtmlUrl,
  validateCommitHtmlUrl,
  validateRepositoryHtmlUrl
} from "./github-public-source-shared.mjs";

export async function resolveRepository(repositoryRequest, role, state) {
  const { owner, repository } = parseCanonicalRepositoryUri(repositoryRequest.repositoryUri);
  const repositoryPrefix = `/repos/${owner}/${repository}`;
  const metadata = await requestGitHubJson(`${repositoryPrefix}`, "repository", state);
  validateRepositoryMetadata(metadata, repositoryRequest, owner, repository);

  const commit = await requestGitHubJson(
    `${repositoryPrefix}/git/commits/${repositoryRequest.revisionObjectId}`,
    "commit",
    state,
  );
  validateCommit(commit, repositoryRequest, owner, repository);

  const githubActionsEvidence = [];
  for (const runId of repositoryRequest.githubActionsRunIds) {
    const run = await requestGitHubJson(`${repositoryPrefix}/actions/runs/${runId}`, "actions-run", state);
    githubActionsEvidence.push(validateActionsRun(run, repositoryRequest, owner, repository, runId));
  }

  const declaredPaths = [
    ...repositoryRequest.sourcePaths,
    ...repositoryRequest.contractPaths,
    ...githubActionsEvidence.map((entry) => entry.workflowPath),
  ];
  // When remote bytes are required, the exact-object resolver already proves
  // every declared path against the REST-verified commit and root tree. A
  // recursive REST tree would repeat that walk. Complete local bytes instead
  // need REST metadata for their path, mode, object-id, and size comparison.
  const hasCompleteLocalBytes = declaredPaths.length > 0 && declaredPaths.every(
    (filePath) => state.localBlobBytes.has(`${repositoryPrefix}\0${filePath}`),
  );
  const recursive = declaredPaths.length > 0
    && (state.exactObjectResolver === null || hasCompleteLocalBytes);
  const tree = await requestGitHubJson(
    `${repositoryPrefix}/git/trees/${repositoryRequest.treeObjectId}${recursive ? "?recursive=1" : ""}`,
    "tree",
    state,
  );
  await validateTree(tree, repositoryPrefix, repositoryRequest, githubActionsEvidence, state, { recursive });

  const defaultBranch = normalizeDisplayText(metadata.default_branch, 255, "repository default branch");
  return deepFreeze({
    role,
    authority: {
      numericRepositoryId: repositoryRequest.numericRepositoryId,
      revisionObjectId: repositoryRequest.revisionObjectId,
      treeObjectId: repositoryRequest.treeObjectId,
    },
    display: {
      repositoryUri: repositoryRequest.repositoryUri,
      owner,
      repository,
      defaultBranch,
    },
    visibility: "public",
    sourcePaths: repositoryRequest.sourcePaths,
    contractPaths: repositoryRequest.contractPaths,
    githubActionsEvidence,
  });
}


function validateRepositoryMetadata(metadata, request, owner, repository) {
  const observedId = normalizeOpaqueId(metadata.id, "repository id", "GITHUB_PROTOCOL_ERROR", true);
  if (observedId !== request.numericRepositoryId) {
    throw new GitHubPublicSourceError("GITHUB_REPOSITORY_ID_MISMATCH", "GitHub repository identity did not match");
  }
  if (metadata.private !== false || metadata.visibility !== "public") {
    throw new GitHubPublicSourceError(
      "GITHUB_PUBLIC_REPOSITORY_UNAVAILABLE",
      "GitHub public repository is unavailable",
      { status: 404 },
    );
  }
  if (typeof metadata.full_name !== "string" || metadata.full_name.toLowerCase() !== `${owner}/${repository}`) {
    throw new GitHubPublicSourceError("GITHUB_REPOSITORY_LOCATOR_MISMATCH", "GitHub repository locator did not match");
  }
  validateRepositoryHtmlUrl(metadata.html_url, owner, repository);
  normalizeDisplayText(metadata.default_branch, 255, "repository default branch");
}

function validateCommit(commit, request, owner, repository) {
  const observedCommit = normalizeGitObjectId(commit.sha, "commit", "GITHUB_PROTOCOL_ERROR");
  if (observedCommit !== request.revisionObjectId) {
    throw new GitHubPublicSourceError("GITHUB_COMMIT_MISMATCH", "GitHub commit did not match the requested revision");
  }
  assertPlainObject(commit.tree, "GITHUB_PROTOCOL_ERROR", "GitHub commit tree must be an object");
  const observedTree = normalizeGitObjectId(commit.tree.sha, "commit tree", "GITHUB_PROTOCOL_ERROR");
  if (observedTree !== request.treeObjectId) {
    throw new GitHubPublicSourceError("GITHUB_TREE_MISMATCH", "GitHub commit tree did not match the expected tree");
  }
  if (commit.html_url !== undefined) {
    validateCommitHtmlUrl(commit.html_url, owner, repository, request.revisionObjectId);
  }
}

function validateActionsRun(run, request, owner, repository, expectedRunId) {
  const runId = normalizeOpaqueId(run.id, "GitHub Actions run id", "GITHUB_PROTOCOL_ERROR", true);
  if (runId !== expectedRunId) {
    throw new GitHubPublicSourceError("GITHUB_ACTIONS_RUN_MISMATCH", "GitHub Actions run id did not match");
  }
  assertPlainObject(run.repository, "GITHUB_PROTOCOL_ERROR", "GitHub Actions repository must be an object");
  const repositoryId = normalizeOpaqueId(run.repository.id, "repository id", "GITHUB_PROTOCOL_ERROR", true);
  if (repositoryId !== request.numericRepositoryId) {
    throw new GitHubPublicSourceError("GITHUB_ACTIONS_RUN_MISMATCH", "GitHub Actions repository did not match");
  }
  const headRevision = normalizeGitObjectId(run.head_sha, "GitHub Actions head commit", "GITHUB_PROTOCOL_ERROR");
  if (headRevision !== request.revisionObjectId) {
    throw new GitHubPublicSourceError("GITHUB_ACTIONS_RUN_MISMATCH", "GitHub Actions head commit did not match");
  }
  assertPlainObject(run.head_commit, "GITHUB_PROTOCOL_ERROR", "GitHub Actions head commit must be an object");
  const headCommitId = normalizeGitObjectId(run.head_commit.id, "GitHub Actions head commit", "GITHUB_PROTOCOL_ERROR");
  const headTree = normalizeGitObjectId(run.head_commit.tree_id, "GitHub Actions head tree", "GITHUB_PROTOCOL_ERROR");
  if (headCommitId !== request.revisionObjectId || headTree !== request.treeObjectId) {
    throw new GitHubPublicSourceError("GITHUB_ACTIONS_RUN_MISMATCH", "GitHub Actions source identity did not match");
  }

  const workflowPath = normalizeWorkflowPath(run.path);
  const workflowId = normalizeOpaqueId(
    run.workflow_id,
    "GitHub Actions workflow id",
    "GITHUB_PROTOCOL_ERROR",
    true,
  );
  const runAttempt = normalizeOpaqueId(
    run.run_attempt,
    "GitHub Actions run attempt",
    "GITHUB_PROTOCOL_ERROR",
    true,
  );
  const event = normalizeSafeCode(run.event, "GitHub Actions event");
  const status = normalizeSafeCode(run.status, "GitHub Actions status");
  const conclusion = run.conclusion === null ? null : normalizeSafeCode(run.conclusion, "GitHub Actions conclusion");
  if (status !== "completed" || conclusion !== "success") {
    throw new GitHubPublicSourceError(
      "GITHUB_ACTIONS_RUN_NOT_SUCCESSFUL",
      "GitHub Actions evidence must be a completed successful run for the exact source revision",
    );
  }
  validateActionsHtmlUrl(run.html_url, owner, repository, runId);

  return deepFreeze({
    runId,
    runAttempt,
    workflowId,
    workflowPath,
    headRevision,
    headTree,
    event,
    status,
    conclusion,
    htmlUrl: `https://github.com/${owner}/${repository}/actions/runs/${runId}`,
  });
}
