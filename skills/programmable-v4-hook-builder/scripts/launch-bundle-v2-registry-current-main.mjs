import { canonicalJson } from "./submission-core.mjs";
import {
  FEE_POLICY_V2_HASH,
  FEE_POLICY_V2_ID,
  FEE_POLICY_V2_VERSION,
  PROGRAMMABLE_FEE_V2_OWNER
} from "./fee-policy-v2-core.mjs";
import { validateRegistryAcceptanceV3RepositoryIdentity } from "./launch-bundle-v2-registry-review-projection.mjs";
import {
  hasExactKeys,
  registryAcceptanceV3ReviewFailure
} from "./launch-bundle-v2-registry-review-shared.mjs";
import {
  GIT_OBJECT_PATTERN,
  SHA256_PATTERN,
  exact,
  isObject
} from "./launch-bundle-v2-shared.mjs";

export function validateRegistryAcceptanceV3CurrentMain({
  acceptanceBinding,
  application,
  projection,
  registryAcceptance,
  registryMain,
  runtimePath
}) {
  const mainPath = `${runtimePath}.registryMain`;
  if (
    !isObject(registryMain)
    || !hasExactKeys(registryMain, [
      "acceptance",
      "commitObjectId",
      "index",
      "project",
      "ref",
      "repository",
      "repositoryTreeObjectId"
    ])
    || registryMain.ref !== "refs/heads/main"
    || !GIT_OBJECT_PATTERN.test(registryMain.commitObjectId ?? "")
    || !GIT_OBJECT_PATTERN.test(registryMain.repositoryTreeObjectId ?? "")
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_CURRENT_MAIN_INVALID",
      mainPath,
      "Trusted Registry review verification lacks one exact current central main commit binding."
    );
  }
  validateRegistryAcceptanceV3RepositoryIdentity(registryMain.repository, {
    exact: true,
    label: "current-main Registry repository",
    path: `${mainPath}.repository`
  });
  if (canonicalJson(registryMain.repository) !== canonicalJson(projection.repository)) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_CURRENT_MAIN_REPOSITORY_MISMATCH",
      `${mainPath}.repository`,
      "Current-main acceptance replay does not use the same live numeric Registry identity and observed name."
    );
  }

  const acceptance = registryMain.acceptance;
  const expectedByteLength = typeof acceptanceBinding?.content === "string"
    ? Buffer.byteLength(acceptanceBinding.content, "utf8")
    : null;
  if (
    !isObject(acceptance)
    || !hasExactKeys(acceptance, ["blobObjectId", "byteLength", "path", "sha256"])
    || !GIT_OBJECT_PATTERN.test(acceptance.blobObjectId ?? "")
    || !Number.isSafeInteger(acceptance.byteLength)
    || acceptance.byteLength < 1
    || acceptance.byteLength > 256 * 1024
    || acceptance.byteLength !== expectedByteLength
    || acceptance.path !== acceptanceBinding?.path
    || acceptance.sha256 !== acceptanceBinding?.sha256
    || !SHA256_PATTERN.test(acceptance.sha256 ?? "")
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_NOT_ON_CURRENT_MAIN",
      `${mainPath}.acceptance`,
      "Current central Registry main does not bind the exact acceptance path, bytes, Git blob, and SHA-256 supplied to Launch V2."
    );
  }

  const index = registryMain.index;
  const projectRecord = index?.projectRecord;
  if (
    !isObject(index)
    || !hasExactKeys(index, [
      "blobObjectId",
      "byteLength",
      "path",
      "projectRecord",
      "registryDigest",
      "schemaVersion",
      "sha256"
    ])
    || !GIT_OBJECT_PATTERN.test(index.blobObjectId ?? "")
    || !Number.isSafeInteger(index.byteLength)
    || index.byteLength < 2
    || index.byteLength > 2 * 1024 * 1024
    || index.path !== "registry/index.json"
    || index.schemaVersion !== "1.1.0"
    || !SHA256_PATTERN.test(index.sha256 ?? "")
    || !SHA256_PATTERN.test(index.registryDigest ?? "")
    || !isObject(projectRecord)
    || !hasExactKeys(projectRecord, ["acceptancePath", "acceptanceSha256", "id", "path", "sha256", "status"])
    || projectRecord.id !== application?.applicationId
    || projectRecord.path !== `registry/projects/${application?.applicationId}/project.json`
    || projectRecord.acceptancePath !== acceptanceBinding?.path
    || projectRecord.acceptanceSha256 !== acceptanceBinding?.sha256
    || !SHA256_PATTERN.test(projectRecord.sha256 ?? "")
    || !new Set(["accepted", "deployed", "available"]).has(projectRecord.status)
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_CURRENT_MAIN_INDEX_INVALID",
      `${mainPath}.index`,
      "Current central Registry main does not bind one unique active index record to the exact acceptance and project."
    );
  }

  const project = registryMain.project;
  const expectedSource = application?.source?.primary;
  const expectedFeeInstance = registryAcceptance?.application?.feePolicyInstanceSha256;
  if (
    !isObject(project)
    || !hasExactKeys(project, [
      "applicationId",
      "blobObjectId",
      "byteLength",
      "path",
      "programmableFee",
      "review",
      "schemaVersion",
      "sha256",
      "source",
      "status"
    ])
    || project.applicationId !== application?.applicationId
    || !GIT_OBJECT_PATTERN.test(project.blobObjectId ?? "")
    || !Number.isSafeInteger(project.byteLength)
    || project.byteLength < 2
    || project.byteLength > 128 * 1024
    || project.path !== projectRecord.path
    || project.sha256 !== projectRecord.sha256
    || project.schemaVersion !== "1.1.0"
    || project.status !== projectRecord.status
    || !isObject(project.review)
    || !hasExactKeys(project.review, ["acceptancePath", "applicationPullRequest", "state"])
    || project.review.acceptancePath !== acceptanceBinding?.path
    || project.review.applicationPullRequest !== registryAcceptance?.reviewEvidence?.pullRequest?.url
    || project.review.state !== "accepted"
    || !isObject(project.source)
    || !hasExactKeys(project.source, ["numericRepositoryId", "repositoryUri", "revisionObjectId", "treeObjectId"])
    || project.source.numericRepositoryId !== expectedSource?.numericRepositoryId
    || project.source.repositoryUri !== expectedSource?.repositoryUri
    || project.source.revisionObjectId !== expectedSource?.revisionObjectId
    || project.source.treeObjectId !== expectedSource?.treeObjectId
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_CURRENT_MAIN_PROJECT_INVALID",
      `${mainPath}.project`,
      "Current central Registry main does not keep the exact acceptance active on one launch-eligible source-bound project."
    );
  }

  const fee = project.programmableFee;
  if (
    !isObject(fee)
    || !hasExactKeys(fee, [
      "claimOwner",
      "feeApplicability",
      "feePolicyInstanceSha256",
      "inclusiveBps",
      "policyHash",
      "policyId",
      "policyVersion",
      "requiredForLaunch"
    ])
    || fee.claimOwner !== PROGRAMMABLE_FEE_V2_OWNER
    || fee.feeApplicability !== "applicable"
    || fee.feeApplicability !== registryAcceptance?.application?.feeApplicability
    || fee.feePolicyInstanceSha256 !== expectedFeeInstance
    || !SHA256_PATTERN.test(fee.feePolicyInstanceSha256 ?? "")
    || fee.inclusiveBps !== 10
    || fee.policyHash !== FEE_POLICY_V2_HASH
    || fee.policyHash !== registryAcceptance?.application?.feePolicyHash
    || fee.policyId !== FEE_POLICY_V2_ID
    || fee.policyVersion !== FEE_POLICY_V2_VERSION
    || fee.requiredForLaunch !== true
  ) {
    registryAcceptanceV3ReviewFailure(
      "REGISTRY_ACCEPTANCE_CURRENT_MAIN_FEE_INVALID",
      `${mainPath}.project.programmableFee`,
      "Current central Registry main does not preserve the exact applicable Fee V2 launch projection."
    );
  }
  return registryMain;
}
