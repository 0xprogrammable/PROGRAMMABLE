import { canonicalJson } from "./submission-core.mjs";

import { parseBoundedStrictJson } from "./strict-json-core.mjs";

import {
  LAUNCH_ELIGIBLE_PROJECT_STATUSES,
  MAX_ACCEPTANCE_BYTES,
  MAX_API_JSON_BYTES,
  MAX_PACKAGE_FILE_BYTES,
  MAX_REGISTRY_INDEX_BYTES,
  MAX_REGISTRY_PROJECT_BYTES,
  MAX_REGISTRY_RECORDS,
  PROGRAMMABLE_FEE_OWNER,
  PROGRAMMABLE_FEE_POLICY_HASH,
  PROGRAMMABLE_FEE_POLICY_ID,
  PROGRAMMABLE_FEE_POLICY_VERSION,
  REGISTRY_INDEX_RECORD_KEYS,
  REGISTRY_INDEX_SCHEMA_VERSION,
  REGISTRY_PROJECT_KEYS,
  REGISTRY_PROJECT_SCHEMA_VERSION,
  sha1Pattern,
  slugPattern
} from "./registry-acceptance-v3-github-constants.mjs";

import {
  decodeGithubBlob,
  resolveTreePath
} from "./registry-acceptance-v3-github-git-core.mjs";

import {
  compareUtf8,
  fail,
  isObject,
  safeRepositoryPath,
  sha256Bytes,
  sha256Utf8
} from "./registry-acceptance-v3-github-primitives.mjs";

import { githubJson } from "./registry-acceptance-v3-github-transport-core.mjs";

export async function replayCurrentRegistrySelection({
  context,
  currentMain,
  github,
  registryRepository
}) {
  const repositoryApiName = registryRepository.fullName;
  const commit = await githubJson(
    `/repos/${repositoryApiName}/git/commits/${currentMain.commitObjectId}`,
    github
  );
  if (
    commit?.sha !== currentMain.commitObjectId
    || !sha1Pattern.test(commit?.tree?.sha ?? "")
  ) fail("REGISTRY_MAIN_RAW_GIT_INVALID", "Central Registry main commit or root tree is invalid");

  const acceptanceBinding = context.acceptanceBinding;
  const acceptanceBlob = await replayBoundedCurrentMainBlob({
    github,
    maximumBytes: MAX_ACCEPTANCE_BYTES,
    missingCode: "REGISTRY_ACCEPTANCE_NOT_ON_CURRENT_MAIN",
    missingMessage: "Exact Registry acceptance is absent from the current central main commit",
    path: acceptanceBinding.path,
    repositoryApiName,
    rootTreeObjectId: commit.tree.sha
  });
  const expectedBytes = Buffer.from(acceptanceBinding.content, "utf8");
  if (
    !acceptanceBlob.bytes.equals(expectedBytes)
    || acceptanceBlob.bytes.length !== Buffer.byteLength(acceptanceBinding.content, "utf8")
    || sha256Bytes(acceptanceBlob.bytes) !== acceptanceBinding.sha256
  ) fail("REGISTRY_ACCEPTANCE_NOT_ON_CURRENT_MAIN", "Current central main does not contain the exact bound Registry acceptance bytes");

  const indexBlob = await replayBoundedCurrentMainBlob({
    github,
    maximumBytes: MAX_REGISTRY_INDEX_BYTES,
    missingCode: "REGISTRY_INDEX_NOT_ON_CURRENT_MAIN",
    missingMessage: "Canonical Registry index is absent from the current central main commit",
    path: "registry/index.json",
    repositoryApiName,
    rootTreeObjectId: commit.tree.sha
  });
  const index = parseCanonicalCurrentMainJson(
    indexBlob.bytes,
    MAX_REGISTRY_INDEX_BYTES,
    "REGISTRY_INDEX_CURRENT_MAIN_INVALID",
    "Current-main Registry index"
  );
  const indexSelection = validateCurrentRegistryIndexSelection({
    acceptanceBinding,
    applicationId: context.application.applicationId,
    index
  });

  const projectBlob = await replayBoundedCurrentMainBlob({
    github,
    maximumBytes: MAX_REGISTRY_PROJECT_BYTES,
    missingCode: "REGISTRY_PROJECT_NOT_ON_CURRENT_MAIN",
    missingMessage: "Active Registry project is absent from the current central main commit",
    path: indexSelection.projectRecord.path,
    repositoryApiName,
    rootTreeObjectId: commit.tree.sha
  });
  if (sha256Bytes(projectBlob.bytes) !== indexSelection.projectRecord.sha256) {
    fail("REGISTRY_PROJECT_CURRENT_MAIN_INVALID", "Current-main Registry project bytes do not match the active index digest");
  }
  const project = parseCanonicalCurrentMainJson(
    projectBlob.bytes,
    MAX_REGISTRY_PROJECT_BYTES,
    "REGISTRY_PROJECT_CURRENT_MAIN_INVALID",
    "Current-main Registry project"
  );
  const projectSelection = validateCurrentRegistryProjectSelection({
    acceptance: context.acceptance,
    acceptanceBinding,
    application: context.application,
    indexRecord: indexSelection.projectRecord,
    project
  });

  return {
    acceptance: {
      blobObjectId: acceptanceBlob.blobObjectId,
      byteLength: acceptanceBlob.bytes.length,
      path: acceptanceBinding.path,
      sha256: acceptanceBinding.sha256
    },
    commitObjectId: currentMain.commitObjectId,
    index: {
      blobObjectId: indexBlob.blobObjectId,
      byteLength: indexBlob.bytes.length,
      path: "registry/index.json",
      projectRecord: indexSelection.projectRecord,
      registryDigest: index.registryDigest,
      schemaVersion: index.schemaVersion,
      sha256: sha256Bytes(indexBlob.bytes)
    },
    project: {
      blobObjectId: projectBlob.blobObjectId,
      byteLength: projectBlob.bytes.length,
      ...projectSelection,
      path: indexSelection.projectRecord.path,
      schemaVersion: project.schemaVersion,
      sha256: indexSelection.projectRecord.sha256
    },
    ref: currentMain.ref,
    repository: registryRepository,
    repositoryTreeObjectId: commit.tree.sha
  };
}

export async function replayBoundedCurrentMainBlob({
  github,
  maximumBytes,
  missingCode,
  missingMessage,
  path: relativePath,
  repositoryApiName,
  rootTreeObjectId
}) {
  if (!safeRepositoryPath(relativePath) || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_PACKAGE_FILE_BYTES) {
    fail("REGISTRY_MAIN_RAW_GIT_INVALID", "Current-main Registry blob request is not closed and bounded");
  }
  const segments = relativePath.split("/");
  const fileName = segments.pop();
  const parentTreeObjectId = await resolveTreePath({
    github,
    missingCode,
    missingMessage,
    repositoryApiName,
    rootTreeObjectId,
    segments
  });
  const parentTree = await githubJson(`/repos/${repositoryApiName}/git/trees/${parentTreeObjectId}`, github);
  if (parentTree?.sha !== parentTreeObjectId || parentTree.truncated === true || !Array.isArray(parentTree.tree)) {
    fail("REGISTRY_MAIN_RAW_GIT_INVALID", "Current-main Registry parent tree is invalid or truncated");
  }
  const matches = parentTree.tree.filter((entry) => entry?.path === fileName);
  if (
    matches.length !== 1
    || matches[0]?.type !== "blob"
    || matches[0]?.mode !== "100644"
    || !sha1Pattern.test(matches[0]?.sha ?? "")
  ) fail(missingCode, missingMessage);
  const blobObjectId = matches[0].sha;
  const blob = await githubJson(`/repos/${repositoryApiName}/git/blobs/${blobObjectId}`, {
    ...github,
    maxBytes: Math.min(MAX_API_JSON_BYTES, maximumBytes * 2 + 4096)
  });
  if (!Number.isSafeInteger(blob?.size) || blob.size < 1 || blob.size > maximumBytes) fail(missingCode, `${missingMessage}; blob exceeds its closed byte bound`);
  return { blobObjectId, bytes: decodeGithubBlob(blob, blobObjectId) };
}

export function parseCanonicalCurrentMainJson(bytes, maximumBytes, code, label) {
  let value;
  try {
    value = parseBoundedStrictJson(bytes.toString("utf8"), {
      maxSourceBytes: maximumBytes,
      maxDepth: 64,
      maxNodes: 100_000,
      maxNumberCharacters: maximumBytes
    });
  } catch {
    fail(code, `${label} is not bounded duplicate-free JSON`);
  }
  if (!bytes.equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) fail(code, `${label} bytes are not canonical JSON plus LF`);
  return value;
}

export function validateCurrentRegistryIndexSelection({ acceptanceBinding, applicationId, index }) {
  if (
    !hasExactKeys(index, ["activeIntake", "generatedAt", "legacyIntake", "records", "registryDigest", "schemaVersion"])
    || index.schemaVersion !== REGISTRY_INDEX_SCHEMA_VERSION
    || !/^sha256:[0-9a-f]{64}$/u.test(index.registryDigest ?? "")
    || !Array.isArray(index.records)
    || index.records.length < 1
    || index.records.length > MAX_REGISTRY_RECORDS
  ) fail("REGISTRY_INDEX_CURRENT_MAIN_INVALID", "Current-main Registry index has an unsupported closed shape");
  const ids = [];
  const acceptancePaths = [];
  for (const record of index.records) {
    if (
      !hasExactKeys(record, REGISTRY_INDEX_RECORD_KEYS)
      || !slugPattern.test(record.id ?? "")
      || record.path !== `registry/projects/${record.id}/project.json`
      || !/^sha256:[0-9a-f]{64}$/u.test(record.sha256 ?? "")
    ) fail("REGISTRY_INDEX_CURRENT_MAIN_INVALID", "Current-main Registry index contains an invalid project source binding");
    const bothNull = record.acceptancePath === null && record.acceptanceSha256 === null;
    const bothBound = typeof record.acceptancePath === "string"
      && record.acceptancePath.startsWith(`registry/acceptances/${record.id}/`)
      && /^registry\/acceptances\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9][a-z0-9.-]*\.json$/u.test(record.acceptancePath)
      && /^sha256:[0-9a-f]{64}$/u.test(record.acceptanceSha256 ?? "");
    if (!bothNull && !bothBound) fail("REGISTRY_INDEX_CURRENT_MAIN_INVALID", "Current-main Registry index contains an invalid acceptance binding");
    ids.push(record.id);
    if (bothBound) acceptancePaths.push(record.acceptancePath);
  }
  if (!isSortedUnique(ids) || !isSortedUnique(acceptancePaths)) {
    fail("REGISTRY_INDEX_CURRENT_MAIN_INVALID", "Current-main Registry index identities are duplicated or noncanonical");
  }
  const acceptances = index.records
    .filter(({ acceptancePath }) => acceptancePath !== null)
    .map(({ acceptancePath, acceptanceSha256 }) => ({ path: acceptancePath, sha256: acceptanceSha256 }))
    .sort((left, right) => compareUtf8(left.path, right.path));
  if (index.registryDigest !== sha256Utf8(canonicalJson({ acceptances, records: index.records }))) {
    fail("REGISTRY_INDEX_CURRENT_MAIN_INVALID", "Current-main Registry digest does not bind its exact records and acceptances");
  }
  const matches = index.records.filter(({ id }) => id === applicationId);
  if (matches.length !== 1) fail("REGISTRY_PROJECT_NOT_ACTIVE_ON_CURRENT_MAIN", "Current Registry index does not contain one unique project for the accepted application");
  const projectRecord = matches[0];
  if (
    projectRecord.acceptancePath !== acceptanceBinding.path
    || projectRecord.acceptanceSha256 !== acceptanceBinding.sha256
    || !LAUNCH_ELIGIBLE_PROJECT_STATUSES.has(projectRecord.status)
  ) fail("REGISTRY_PROJECT_NOT_ACTIVE_ON_CURRENT_MAIN", "Current Registry index does not select this exact acceptance as launch-eligible");
  return { projectRecord: projectCurrentMainIndexProjection(projectRecord) };
}

export function validateCurrentRegistryProjectSelection({ acceptance, acceptanceBinding, application, indexRecord, project }) {
  if (
    !hasExactKeys(project, REGISTRY_PROJECT_KEYS)
    || project.schemaVersion !== REGISTRY_PROJECT_SCHEMA_VERSION
    || project.id !== application.applicationId
    || project.id !== indexRecord.id
    || project.status !== indexRecord.status
    || !LAUNCH_ELIGIBLE_PROJECT_STATUSES.has(project.status)
    || !hasExactKeys(project.review, ["acceptancePath", "applicationPullRequest", "independentAudit", "limitations", "state"])
    || project.review.state !== "accepted"
    || project.review.acceptancePath !== acceptanceBinding.path
    || project.review.applicationPullRequest !== acceptance.reviewEvidence?.pullRequest?.url
  ) fail("REGISTRY_PROJECT_NOT_ACTIVE_ON_CURRENT_MAIN", "Current Registry project does not actively select this exact accepted review");

  const fee = project.economics?.programmableFee;
  if (
    !hasExactKeys(fee, ["claimOwner", "feeApplicability", "feePolicyInstanceSha256", "inclusiveBps", "policyHash", "policyId", "policyVersion", "requiredForLaunch"])
    || fee.claimOwner !== PROGRAMMABLE_FEE_OWNER
    || fee.feeApplicability !== "applicable"
    || fee.feeApplicability !== acceptance.application?.feeApplicability
    || fee.feePolicyInstanceSha256 !== acceptance.application?.feePolicyInstanceSha256
    || !/^sha256:[0-9a-f]{64}$/u.test(fee.feePolicyInstanceSha256 ?? "")
    || fee.inclusiveBps !== 10
    || fee.policyHash !== PROGRAMMABLE_FEE_POLICY_HASH
    || fee.policyHash !== acceptance.application?.feePolicyHash
    || fee.policyId !== PROGRAMMABLE_FEE_POLICY_ID
    || fee.policyVersion !== PROGRAMMABLE_FEE_POLICY_VERSION
    || fee.requiredForLaunch !== true
  ) fail("REGISTRY_PROJECT_FEE_NOT_LAUNCHABLE", "Current Registry project does not preserve the exact applicable Fee V2 launch projection");

  const source = project.source;
  const primary = application.source?.primary;
  if (
    !hasExactKeys(source, ["manifestPath", "numericRepositoryId", "repositoryUri", "revisionObjectId", "treeObjectId"])
    || source.numericRepositoryId !== primary?.numericRepositoryId
    || source.repositoryUri !== primary?.repositoryUri
    || source.revisionObjectId !== primary?.revisionObjectId
    || source.treeObjectId !== primary?.treeObjectId
  ) fail("REGISTRY_PROJECT_SOURCE_MISMATCH", "Current Registry project source does not match the exact accepted Application V3 source");

  return {
    applicationId: project.id,
    programmableFee: { ...fee },
    review: {
      acceptancePath: project.review.acceptancePath,
      applicationPullRequest: project.review.applicationPullRequest,
      state: project.review.state
    },
    source: {
      numericRepositoryId: source.numericRepositoryId,
      repositoryUri: source.repositoryUri,
      revisionObjectId: source.revisionObjectId,
      treeObjectId: source.treeObjectId
    },
    status: project.status
  };
}

export function projectCurrentMainIndexProjection(record) {
  return {
    acceptancePath: record.acceptancePath,
    acceptanceSha256: record.acceptanceSha256,
    id: record.id,
    path: record.path,
    sha256: record.sha256,
    status: record.status
  };
}

export function hasExactKeys(value, keys) {
  return isObject(value)
    && canonicalJson(Object.keys(value).sort(compareUtf8)) === canonicalJson([...keys].sort(compareUtf8));
}

export function isSortedUnique(values) {
  return Array.isArray(values)
    && new Set(values).size === values.length
    && values.every((value, index) => typeof value === "string" && (index === 0 || compareUtf8(values[index - 1], value) < 0));
}
