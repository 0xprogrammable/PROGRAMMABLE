import {
  GITHUB_PUBLIC_SOURCE_CONTRACT_V1,
  GitHubPublicSourceError
} from "./github-public-source-contract.mjs";
import {
  isCanonicalReviewTargetPath,
  REVIEW_TARGET_CONTRACT_V1
} from "./review-target-contract.mjs";
import {
  assertExactKeys,
  assertNoDuplicateSortedValues,
  assertPlainObject,
  compareRepositoryRequests,
  compareUtf8,
  deepFreeze,
  invalidRequest,
  normalizeGitObjectId,
  normalizeOpaqueId,
  normalizeRepositoryPath,
  normalizeUniqueArray,
  parseCanonicalRepositoryUri
} from "./github-public-source-shared.mjs";

const allowedRequestKeys = new Set(["schemaVersion", "primary", "companions"]);
const allowedRepositoryKeys = new Set([
  "repositoryUri",
  "numericRepositoryId",
  "revisionObjectId",
  "treeObjectId",
  "sourcePaths",
  "contractPaths",
  "githubActionsRunIds",
]);
const maximumDeclaredBlobBytes = REVIEW_TARGET_CONTRACT_V1.maximumFileBytes;
const maximumDeclaredAggregateBytes = REVIEW_TARGET_CONTRACT_V1.maximumTotalBytes;
const maximumGitHubRequests = GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.anonymousRestRequests;

export function validateGitHubPublicSourceRequestV1(input) {
  assertPlainObject(input, "INVALID_REQUEST", "request must be an object");
  assertExactKeys(input, allowedRequestKeys, "INVALID_REQUEST");
  if (input.schemaVersion !== GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion) {
    invalidRequest("request schemaVersion is unsupported");
  }

  const primary = normalizeRepositoryRequest(input.primary);
  if (!Array.isArray(input.companions)) {
    invalidRequest("companions must be an array");
  }
  if (input.companions.length > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.companions) {
    invalidRequest("too many companion repositories");
  }

  const companions = input.companions.map(normalizeRepositoryRequest);
  companions.sort(compareRepositoryRequests);

  const repositoryIds = new Set([primary.numericRepositoryId]);
  const repositoryUris = new Set([primary.repositoryUri]);
  for (const companion of companions) {
    if (repositoryIds.has(companion.numericRepositoryId)) {
      invalidRequest("repository identities must be unique");
    }
    if (repositoryUris.has(companion.repositoryUri)) {
      invalidRequest("repository locators must be unique");
    }
    repositoryIds.add(companion.numericRepositoryId);
    repositoryUris.add(companion.repositoryUri);
  }

  const repositories = [primary, ...companions];
  const minimumApiRequests = (repositories.length * 3)
    + repositories.reduce((total, repository) => total + repository.githubActionsRunIds.length, 0);
  if (minimumApiRequests > maximumGitHubRequests) {
    invalidRequest("repository and GitHub Actions breadth exceeds the anonymous request budget");
  }

  return deepFreeze({
    schemaVersion: GITHUB_PUBLIC_SOURCE_CONTRACT_V1.schemaVersion,
    primary,
    companions,
  });
}

export function isCanonicalGitHubRepositoryPathV1(value) {
  return isCanonicalReviewTargetPath(value);
}

export function normalizeRepositoryRequest(input) {
  assertPlainObject(input, "INVALID_REQUEST", "repository request must be an object");
  assertExactKeys(input, allowedRepositoryKeys, "INVALID_REQUEST");
  const parsedUri = parseCanonicalRepositoryUri(input.repositoryUri);
  const numericRepositoryId = normalizeOpaqueId(input.numericRepositoryId, "repository id", "INVALID_REQUEST");
  const revisionObjectId = normalizeGitObjectId(input.revisionObjectId, "revision", "INVALID_REQUEST");
  const treeObjectId = normalizeGitObjectId(input.treeObjectId, "tree", "INVALID_REQUEST");

  const sourcePaths = normalizeUniqueArray(
    input.sourcePaths ?? [],
    GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.pathsPerKind,
    normalizeRepositoryPath,
    "source paths",
  );
  const contractPaths = normalizeUniqueArray(
    input.contractPaths ?? [],
    GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.pathsPerKind,
    normalizeRepositoryPath,
    "contract paths",
  );
  const githubActionsRunIds = normalizeUniqueArray(
    input.githubActionsRunIds ?? [],
    GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.actionsRunsPerRepository,
    (value) => normalizeOpaqueId(value, "GitHub Actions run id", "INVALID_REQUEST"),
    "GitHub Actions run ids",
  );

  const allDeclaredPaths = [...sourcePaths, ...contractPaths].sort(compareUtf8);
  if (allDeclaredPaths.length > GITHUB_PUBLIC_SOURCE_CONTRACT_V1.limits.pathsTotal) {
    invalidRequest("declared paths exceed the total contract limit");
  }
  assertNoDuplicateSortedValues(allDeclaredPaths, "declared paths");

  return deepFreeze({
    repositoryUri: `https://github.com/${parsedUri.owner}/${parsedUri.repository}`,
    numericRepositoryId,
    revisionObjectId,
    treeObjectId,
    sourcePaths,
    contractPaths,
    githubActionsRunIds,
  });
}

export function normalizeLocalBlobBytes(input, request) {
  if (input === undefined) return new Map();
  if (!(input instanceof Map)) {
    throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes must be a repository Map");
  }

  const repositories = new Map(
    [request.primary, ...request.companions].map((repository) => [repository.repositoryUri, repository])
  );
  const normalized = new Map();
  let aggregateBytes = 0;
  for (const [repositoryUri, files] of input) {
    const repository = repositories.get(repositoryUri);
    if (repository === undefined || !(files instanceof Map)) {
      throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes referenced an undeclared repository");
    }
    const declaredPaths = new Set([...repository.sourcePaths, ...repository.contractPaths]);
    for (const [filePath, value] of files) {
      if (!declaredPaths.has(filePath) || !(value instanceof Uint8Array)) {
        throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes referenced an undeclared path");
      }
      const bytes = Buffer.from(value);
      if (bytes.length > maximumDeclaredBlobBytes) {
        throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes exceeded the per-file limit");
      }
      aggregateBytes += bytes.length;
      if (aggregateBytes > maximumDeclaredAggregateBytes) {
        throw new GitHubPublicSourceError("INVALID_OPTIONS", "local blob bytes exceeded the aggregate limit");
      }
      const parsed = parseCanonicalRepositoryUri(repositoryUri);
      normalized.set(`/repos/${parsed.owner}/${parsed.repository}\0${filePath}`, bytes);
    }
  }
  return normalized;
}
