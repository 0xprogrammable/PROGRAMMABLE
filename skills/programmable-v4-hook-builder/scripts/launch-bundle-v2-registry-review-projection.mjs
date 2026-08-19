import { canonicalJson } from "./submission-core.mjs";
import { registryApplicationPackageProjection } from "./launch-bundle-v2-registry-projections.mjs";
import {
  hasExactKeys,
  registryAcceptanceV3ReviewFailure,
  safeRegistryAcceptanceV3GitRef,
  validRegistryAcceptanceV3Timestamp
} from "./launch-bundle-v2-registry-review-shared.mjs";
import {
  GIT_OBJECT_PATTERN,
  PROGRAMMABLE_REGISTRY_NUMERIC_REPOSITORY_ID,
  REGISTRY_ACCEPTANCE_V3_GITHUB_LOGIN_PATTERN,
  REGISTRY_ACCEPTANCE_V3_GITHUB_REPOSITORY_PATTERN,
  REGISTRY_ACCEPTANCE_V3_MAINTAINER_USER_ID,
  REGISTRY_ACCEPTANCE_V3_MAX_REVIEW_BODY_BYTES,
  REGISTRY_ACCEPTANCE_V3_OPAQUE_ID_PATTERN,
  REGISTRY_ACCEPTANCE_V3_PULL_NUMBER_PATTERN,
  REGISTRY_ACCEPTANCE_V3_REVIEW_BODY_CANONICALIZATION,
  REGISTRY_ACCEPTANCE_V3_REVIEW_SELECTION_RULE,
  SHA256_PATTERN,
  exact,
  isObject
} from "./launch-bundle-v2-shared.mjs";

export function validateRegistryAcceptanceV3ReviewProjection({ application, applicationBinding, projection, runtimePath }) {
  if (
    !isObject(projection)
    || !hasExactKeys(projection, ["application", "packageAtHead", "pullRequest", "repository", "review", "schemaVersion"])
    || projection.schemaVersion !== "1.0.0"
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_PROJECTION_INVALID",
      `${runtimePath}.projection`,
      "Trusted Registry review projection has an unsupported root shape."
    );
  }

  validateRegistryAcceptanceV3RepositoryIdentity(projection.repository, {
    exact: true,
    label: "Registry repository",
    path: `${runtimePath}.projection.repository`
  });
  const registryRepository = projection.repository;

  const applicationPackage = registryApplicationPackageProjection(application);
  const expectedApplication = applicationPackage === null ? null : {
    applicationId: application?.applicationId,
    applicationPath: applicationBinding?.path,
    applicationRevision: application?.applicationRevision,
    applicationSha256: applicationBinding?.sha256,
    packageSha256: applicationPackage.packageSha256
  };
  if (
    !isObject(projection.application)
    || !hasExactKeys(projection.application, [
      "applicationId",
      "applicationPath",
      "applicationRevision",
      "applicationSha256",
      "packageSha256"
    ])
    || expectedApplication === null
    || canonicalJson(projection.application) !== canonicalJson(expectedApplication)
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_APPLICATION_MISMATCH",
      `${runtimePath}.projection.application`,
      "Trusted Registry review projection does not bind the exact canonical Application V3 package."
    );
  }

  const pullRequest = projection.pullRequest;
  if (
    !isObject(pullRequest)
    || !hasExactKeys(pullRequest, ["author", "base", "changeSet", "head", "merge", "number", "state", "url"])
    || !REGISTRY_ACCEPTANCE_V3_PULL_NUMBER_PATTERN.test(pullRequest.number ?? "")
    || pullRequest.state !== "MERGED"
    || pullRequest.url !== `${registryRepository.repositoryUri}/pull/${pullRequest.number}`
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_PULL_INVALID",
      `${runtimePath}.projection.pullRequest`,
      "Trusted Registry review projection does not identify one canonical Registry pull request."
    );
  }
  if (
    !isObject(pullRequest.author)
    || !hasExactKeys(pullRequest.author, ["githubLogin", "githubUserId"])
    || !REGISTRY_ACCEPTANCE_V3_GITHUB_LOGIN_PATTERN.test(pullRequest.author.githubLogin ?? "")
    || pullRequest.author.githubUserId !== application?.builder?.githubUserId
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_PULL_AUTHOR_MISMATCH",
      `${runtimePath}.projection.pullRequest.author`,
      "Trusted Registry Application PR author does not match the immutable Application V3 builder GitHub user ID."
    );
  }
  validateRegistryAcceptanceV3GitHeadEndpoint(pullRequest.head, `${runtimePath}.projection.pullRequest.head`);
  if (pullRequest.head.pullRef !== `refs/pull/${pullRequest.number}/head`) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_PULL_REF_MISMATCH",
      `${runtimePath}.projection.pullRequest.head.pullRef`,
      "Trusted Registry Application PR head does not bind the exact central refs/pull/N/head namespace."
    );
  }
  validateRegistryAcceptanceV3GitEndpoint(pullRequest.base, `${runtimePath}.projection.pullRequest.base`);
  validateRegistryAcceptanceV3RepositoryIdentity(pullRequest.base.repository, {
    exact: true,
    label: "Registry base repository",
    path: `${runtimePath}.projection.pullRequest.base.repository`
  });
  if (canonicalJson(pullRequest.base.repository) !== canonicalJson(registryRepository)) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_REPOSITORY_MISMATCH",
      `${runtimePath}.projection.pullRequest.base.repository`,
      "Trusted Registry PR base repository does not match the same observed numeric Registry identity and current name."
    );
  }
  if (pullRequest.base.ref !== "main") {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_BASE_INVALID",
      `${runtimePath}.projection.pullRequest.base.ref`,
      "Trusted Registry review projection must target the exact Registry main branch."
    );
  }
  if (
    !isObject(pullRequest.merge)
    || !hasExactKeys(pullRequest.merge, ["commitId", "mergedAt"])
    || !GIT_OBJECT_PATTERN.test(pullRequest.merge.commitId ?? "")
    || !validRegistryAcceptanceV3Timestamp(pullRequest.merge.mergedAt)
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_PULL_NOT_MERGED",
      `${runtimePath}.projection.pullRequest.merge`,
      "Trusted Registry Application PR lacks an exact merged lifecycle binding."
    );
  }
  validateRegistryAcceptanceV3PackageAtHead({
    applicationPackage,
    applicationPath: applicationBinding?.path,
    packageAtHead: projection.packageAtHead,
    pullRequest,
    registryRepository,
    runtimePath
  });
  validateRegistryAcceptanceV3ChangeSet({
    applicationPackage,
    changeSet: pullRequest.changeSet,
    runtimePath
  });

  const review = projection.review;
  if (
    !isObject(review)
    || !hasExactKeys(review, [
      "authorAssociation",
      "bodyByteLength",
      "bodyCanonicalization",
      "bodySha256",
      "commitId",
      "id",
      "reviewer",
      "selectionRule",
      "state",
      "submittedAt",
      "url"
    ])
    || review.authorAssociation !== "OWNER"
    || review.state !== "APPROVED"
    || review.selectionRule !== REGISTRY_ACCEPTANCE_V3_REVIEW_SELECTION_RULE
    || review.bodyCanonicalization !== REGISTRY_ACCEPTANCE_V3_REVIEW_BODY_CANONICALIZATION
    || !REGISTRY_ACCEPTANCE_V3_OPAQUE_ID_PATTERN.test(review.id ?? "")
    || !GIT_OBJECT_PATTERN.test(review.commitId ?? "")
    || review.commitId !== pullRequest.head.sha
    || review.url !== `${pullRequest.url}#pullrequestreview-${review.id}`
    || !validRegistryAcceptanceV3Timestamp(review.submittedAt)
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_NOT_CURRENT_OWNER_APPROVAL",
      `${runtimePath}.projection.review`,
      "Trusted Registry review must be the latest OWNER approval for the exact current pull-request head."
    );
  }
  if (
    !isObject(review.reviewer)
    || !hasExactKeys(review.reviewer, ["githubLogin", "githubUserId"])
    || !REGISTRY_ACCEPTANCE_V3_GITHUB_LOGIN_PATTERN.test(review.reviewer.githubLogin ?? "")
    || review.reviewer.githubUserId !== REGISTRY_ACCEPTANCE_V3_MAINTAINER_USER_ID
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEWER_AUTHORITY_INVALID",
      `${runtimePath}.projection.review.reviewer`,
      "Trusted Registry review is not owned by the exact maintainer identity."
    );
  }
  if (review.reviewer.githubUserId === application?.builder?.githubUserId) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_SELF_REVIEW_FORBIDDEN",
      `${runtimePath}.projection.review.reviewer.githubUserId`,
      "Builder and accepting Registry maintainer must be different GitHub users."
    );
  }
  if (
    !Number.isSafeInteger(review.bodyByteLength)
    || review.bodyByteLength < 0
    || review.bodyByteLength > REGISTRY_ACCEPTANCE_V3_MAX_REVIEW_BODY_BYTES
    || !SHA256_PATTERN.test(review.bodySha256 ?? "")
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_BODY_INVALID",
      `${runtimePath}.projection.review.body`,
      "Trusted Registry review metadata must bind one bounded exact UTF-8 GitHub body."
    );
  }
  if (Date.parse(pullRequest.merge.mergedAt) < Date.parse(review.submittedAt)) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_PULL_NOT_MERGED",
      `${runtimePath}.projection.pullRequest.merge.mergedAt`,
      "Trusted Registry Application PR merge cannot predate its selected current-head approval."
    );
  }
  return projection;
}

export function validateRegistryAcceptanceV3PackageAtHead({
  applicationPackage,
  applicationPath,
  packageAtHead,
  pullRequest,
  registryRepository,
  runtimePath
}) {
  const packagePath = `${runtimePath}.projection.packageAtHead`;
  if (
    !isObject(packageAtHead)
    || !hasExactKeys(packageAtHead, [
      "commitObjectId",
      "fileCount",
      "inventoryRule",
      "inventorySha256",
      "packageRoot",
      "packageSha256",
      "packageTreeObjectId",
      "repository",
      "repositoryTreeObjectId",
      "totalBytes"
    ])
    || packageAtHead.inventoryRule !== "exact-recursive-regular-files-at-reviewed-head-v1"
    || packageAtHead.commitObjectId !== pullRequest.head.sha
    || !GIT_OBJECT_PATTERN.test(packageAtHead.repositoryTreeObjectId ?? "")
    || !GIT_OBJECT_PATTERN.test(packageAtHead.packageTreeObjectId ?? "")
    || !SHA256_PATTERN.test(packageAtHead.inventorySha256 ?? "")
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_PACKAGE_AT_HEAD_INVALID",
      packagePath,
      "Trusted Registry review projection lacks one exact raw-Git package inventory at the reviewed head."
    );
  }
  validateRegistryAcceptanceV3RepositoryIdentity(packageAtHead.repository, {
    exact: true,
    label: "raw-Git Registry object namespace",
    path: `${packagePath}.repository`
  });
  if (canonicalJson(packageAtHead.repository) !== canonicalJson(registryRepository)) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_REPOSITORY_MISMATCH",
      `${packagePath}.repository`,
      "Reviewed package objects do not use the same observed numeric Registry identity and current name."
    );
  }
  const separator = typeof applicationPath === "string" ? applicationPath.lastIndexOf("/") : -1;
  const expectedPackageRoot = separator > 0 ? applicationPath.slice(0, separator) : null;
  if (
    applicationPackage === null
    || packageAtHead.packageRoot !== expectedPackageRoot
    || packageAtHead.packageSha256 !== applicationPackage.packageSha256
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_PACKAGE_AT_HEAD_MISMATCH",
      packagePath,
      "Reviewed-head package root or digest does not match the exact local Application V3 package."
    );
  }
  const expectedTotalBytes = applicationPackage.files.reduce((total, file) => total + file.byteLength, 0);
  if (
    !Number.isSafeInteger(packageAtHead.fileCount)
    || packageAtHead.fileCount < 1
    || packageAtHead.fileCount > 512
    || packageAtHead.fileCount !== applicationPackage.files.length
    || !Number.isSafeInteger(packageAtHead.totalBytes)
    || packageAtHead.totalBytes < 1
    || packageAtHead.totalBytes > 16 * 1024 * 1024
    || packageAtHead.totalBytes !== expectedTotalBytes
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_PACKAGE_AT_HEAD_MISMATCH",
      packagePath,
      "Reviewed-head package count or aggregate bytes do not match the exact local Application V3 package inventory."
    );
  }
}

export function validateRegistryAcceptanceV3ChangeSet({ applicationPackage, changeSet, runtimePath }) {
  const changeSetPath = `${runtimePath}.projection.pullRequest.changeSet`;
  if (
    !isObject(changeSet)
    || !hasExactKeys(changeSet, ["changeSetSha256", "fileCount", "rule"])
    || changeSet.rule !== "exact-added-package-files-base-to-head-v1"
    || !Number.isSafeInteger(changeSet.fileCount)
    || changeSet.fileCount < 1
    || changeSet.fileCount > 512
    || changeSet.fileCount !== applicationPackage?.files?.length
    || !SHA256_PATTERN.test(changeSet.changeSetSha256 ?? "")
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_CHANGE_SET_INVALID",
      changeSetPath,
      "Trusted Registry Application PR change set is absent or outside the exact V3 revision-package added-only contract."
    );
  }
}

export function validateRegistryAcceptanceV3GitHeadEndpoint(value, path) {
  if (
    !isObject(value)
    || !hasExactKeys(value, ["pullRef", "sha"])
    || !GIT_OBJECT_PATTERN.test(value.sha ?? "")
    || typeof value.pullRef !== "string"
    || !/^refs\/pull\/[1-9][0-9]{0,9}\/head$/u.test(value.pullRef)
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_GIT_ENDPOINT_INVALID",
      path,
      "Trusted Registry pull-request head endpoint is invalid."
    );
  }
}

export function validateRegistryAcceptanceV3GitEndpoint(value, path) {
  if (
    !isObject(value)
    || !hasExactKeys(value, ["ref", "repository", "sha"])
    || !GIT_OBJECT_PATTERN.test(value.sha ?? "")
    || !safeRegistryAcceptanceV3GitRef(value.ref)
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_GIT_ENDPOINT_INVALID",
      path,
      "Trusted Registry pull-request endpoint is invalid."
    );
  }
  validateRegistryAcceptanceV3RepositoryIdentity(value.repository, {
    exact: false,
    label: "Pull-request repository",
    path: `${path}.repository`
  });
}

export function validateRegistryAcceptanceV3RepositoryIdentity(value, { exact, label, path }) {
  if (
    !isObject(value)
    || !hasExactKeys(value, ["fullName", "numericRepositoryId", "repositoryUri"])
    || !REGISTRY_ACCEPTANCE_V3_GITHUB_REPOSITORY_PATTERN.test(value.fullName ?? "")
    || value.fullName.endsWith(".git")
    || !REGISTRY_ACCEPTANCE_V3_OPAQUE_ID_PATTERN.test(value.numericRepositoryId ?? "")
    || value.repositoryUri !== `https://github.com/${value.fullName}`
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_REPOSITORY_INVALID",
      path,
      `${label} is not one exact canonical public GitHub repository identity.`
    );
  }
  if (exact && (
    value.numericRepositoryId !== PROGRAMMABLE_REGISTRY_NUMERIC_REPOSITORY_ID
  )) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_REVIEW_REPOSITORY_MISMATCH",
      path,
      `${label} does not match the exact trusted Registry repository identity.`
    );
  }
}
