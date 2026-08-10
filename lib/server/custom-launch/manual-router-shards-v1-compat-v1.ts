import "server-only";

import type {
  ManualRouterCompleteSignedArtifactViewAnyV2,
} from "@/lib/server/custom-launch/manual-router-service-v1";
import type {
  ManualRouterApplicantPointerAnyV2,
} from "@/lib/server/custom-launch/manual-router-state-v2";

type UnknownRecord = Readonly<Record<string, unknown>>;

export const MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1 = Object.freeze({
  approvedGitHubUserId: "155705664",
  approvedLaunchWallet: "0xceebb3a6543cebeb2ed66963897a0abea52a50cc",
  repositoryId: "1320085947",
  headRepositoryId: "1329074393",
  sourceRepositoryId: "1329073878",
  sourceRepositoryUrl: "https://github.com/jesse-stahl/shards-v1",
  sourceCommitSha: "91b38f3de64d96cac7e29f127c004f128fc1da59",
  sourceTreeSha: "92d6def8609e829487adea66c13901734e43c8c7",
  applicantGitHubLogin: "jesse-stahl",
  pullRequestNumber: 6,
  subjectHash:
    "sha256:c818b79c99277b878b2e0be70f1479fa8a864f111fbe0579bf9e2b8cf95524ee",
  headSha: "1aa5017154d227e639cfe6256f39bf3916352124",
  treeSha: "48149d436bf222c440980e1fc31a71899b833af7",
  approvalBindingHash:
    "sha256:a036d02141ae96c178691ceb9aac9390260e4caf71acb37fe427c0803bdc0b03",
  compileInputHash:
    "sha256:1d7c191dc3e16ba9967be76622b76269b6ac1673637212fab41594ff1665394a",
  planHash:
    "sha256:fe2a675dda7460d93d5c5cce562fdbf98b13b362fef79918ad8122539d3db864",
  applicationId: "shards-v1",
  applicationManifestSha256:
    "sha256:e069926d380e56bee001dd7cfeda591db56164b1acf7478b478dd62a6e119ec2",
  sourceRevisionBindingHash:
    "sha256:01e34d7212326bf2e7ac5e446b127a5f994c335dc0126501fe73954cffe2f008",
  compilerProfileBindingHash:
    "sha256:c47c175cf867633adae778c507264b79a6c366f0a425eadba13e625c6a0977f7",
  compilerEvidenceDigest:
    "sha256:f128b69f184a5f79c79badc7b59669548d9bd11d63253088d126377ea2aed98a",
  routeNonce:
    "0xfcd4ff3393a669e5bb9f21a97f9adaad624bcfad67c9ef3763ec5e4488d6df9f",
  rootPointerHash:
    "sha256:40d807312362e9edec84a26581620e809d9f16e6d62ac1b2a87bd0138b2fb30c",
  rootSignedArtifactHash:
    "sha256:93d2e1fe8cd5d20a043ba93dd0f5e45ccd3b91abd8e335bd511e39aa287e3aa5",
  approvalRevision: Object.freeze({
    schemaVersion: "programmable.router-approval-revision.v2",
    approvalId:
      "0xbf5df8e728d6a7ab6fa513ccc1fef8d5ee8ffabd3bbc24085a7867ee66651cfc",
    approvalVersion: "2",
    authorizedPrincipalHash:
      "0x8691c76e94073ea9f97cd02d03a893b81d5b1af841da909c29206dae82aecc5e",
    configurationHash:
      "0x4ff6f93e65be0388696bdc1d8f5c1729111b7c2d581e337693cc3b7466637c31",
    evidenceDigest:
      "0x83af1e346c417c28a6f9b2e72ded1421d605795da40de28557c5ff2dfaeb2283",
    headSha: "0x1aa5017154d227e639cfe6256f39bf3916352124",
    policyHash:
      "0xa70e57eba9d86a3ec068d36ddd023b5a4021d3ee0a158ee3239ca26a9edc28ef",
    repositoryId: "1320085947",
    reviewArtifactHash:
      "0x6ee28349e1353e714b33eb6d2f9eefd75f1e98880a27d7b2f5f8094dac6d14c5",
    treeSha: "0x48149d436bf222c440980e1fc31a71899b833af7",
  }),
} as const);

export function manualRouterClaimsShardsV1ArtifactV1(
  artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
): boolean {
  if (artifact.schemaVersion
    !== "programmable.manual-router-complete-signed-artifact.v1") return false;
  const preparation = record(artifact.preparationArtifact);
  const subject = record(preparation?.subject);
  const approvalClaim = record(preparation?.approvalClaim);
  const reviewed = record(preparation?.reviewedCompileInput);
  const compilation = record(preparation?.compilation);
  const signatureRequest = record(preparation?.signatureRequest);
  const verifiedApproval = record(signatureRequest?.approval);
  const exact = MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1;
  return subject?.approvedGitHubUserId === exact.approvedGitHubUserId
    || subject?.subjectHash === exact.subjectHash
    || reviewed?.applicationId === exact.applicationId
    || reviewed?.compileInputHash === exact.compileInputHash
    || reviewed?.sourceRevisionBindingHash === exact.sourceRevisionBindingHash
    || approvalClaim?.compileInputHash === exact.compileInputHash
    || compilation?.compileInputHash === exact.compileInputHash
    || verifiedApproval?.sourceCommitSha === exact.sourceCommitSha;
}

export function manualRouterIsExactShardsV1ArtifactV1(
  artifact: ManualRouterCompleteSignedArtifactViewAnyV2,
): boolean {
  if (artifact.schemaVersion
    !== "programmable.manual-router-complete-signed-artifact.v1") return false;
  const preparation = record(artifact.preparationArtifact);
  const subject = record(preparation?.subject);
  const approvalClaim = record(preparation?.approvalClaim);
  const reviewed = record(preparation?.reviewedCompileInput);
  const compilation = record(preparation?.compilation);
  const descriptor = record(artifact.descriptor);
  const signatureRequest = record(preparation?.signatureRequest);
  const verifiedApproval = record(signatureRequest?.approval);
  const verifiedClaim = record(verifiedApproval?.claim);
  const submissionMetadata = record(reviewed?.submissionMetadata);
  const submissionSource = record(submissionMetadata?.source);
  const submissionApplicant = record(submissionMetadata?.applicant);
  const exact = MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1;
  return subject?.schemaVersion
      === "programmable.manual-router-applicant-subject.v1"
    && preparation?.schemaVersion
      === "programmable.manual-router-authority-preparation-artifact.v1"
    && subject.repositoryId === exact.repositoryId
    && subject.pullRequestNumber === exact.pullRequestNumber
    && subject.approvedGitHubUserId === exact.approvedGitHubUserId
    && normalizedAddress(subject.approvedLaunchWallet)
      === exact.approvedLaunchWallet
    && subject.subjectHash === exact.subjectHash
    && exactApprovalClaim(approvalClaim)
    && exactApprovalClaim(verifiedClaim)
    && exactApprovalRevision(record(approvalClaim?.approvalRevision))
    && exactApprovalRevision(record(verifiedClaim?.approvalRevision))
    && approvalClaim?.schemaVersion
      === "programmable.github-router-launch-approval-claim.v3"
    && reviewed?.applicationId === exact.applicationId
    && reviewed.schemaVersion
      === "programmable.stored-router-custom-graph-reviewed-compile-input.v1"
    && reviewed.applicationManifestSha256
      === exact.applicationManifestSha256
    && reviewed.sourceRevisionBindingHash
      === exact.sourceRevisionBindingHash
    && reviewed.compilerProfileBindingHash
      === exact.compilerProfileBindingHash
    && reviewed.compileInputHash === exact.compileInputHash
    && reviewed.compilerEvidenceDigest === exact.compilerEvidenceDigest
    && submissionSource?.repositoryId === exact.sourceRepositoryId
    && submissionSource.repositoryUrl === exact.sourceRepositoryUrl
    && submissionSource.commitSha === exact.sourceCommitSha
    && submissionSource.treeSha === exact.sourceTreeSha
    && submissionApplicant?.githubLogin === exact.applicantGitHubLogin
    && normalizedAddress(submissionApplicant.launchWallet)
      === exact.approvedLaunchWallet
    && compilation?.compileInputHash === exact.compileInputHash
    && compilation.schemaVersion
      === "programmable.router-custom-graph-compilation.v1"
    && compilation.planHash === exact.planHash
    && compilation.production === true
    && descriptor?.schemaVersion
      === "programmable.manual-router-signed-artifact-descriptor.v1"
    && descriptor.approvalBindingHash === exact.approvalBindingHash
    && descriptor.subjectHash === exact.subjectHash
    && descriptor.preparationArtifactHash
      === preparation?.preparationArtifactHash
    && descriptor.signatureRequestHash === signatureRequest?.requestHash
    && descriptor.routeNonce === exact.routeNonce
    && signatureRequest?.schemaVersion
      === "programmable.manual-github-router-signature-request.v1"
    && signatureRequest.compileInputHash === exact.compileInputHash
    && signatureRequest.planHash === exact.planHash
    && verifiedApproval?.schemaVersion
      === "programmable.verified-github-router-launch-approval.v6"
    && verifiedApproval.approvalBindingHash === exact.approvalBindingHash
    && verifiedApproval.pullRequestAuthorGitHubLogin
      === exact.applicantGitHubLogin
    && verifiedApproval.pullRequestAuthorGitHubUserId
      === exact.approvedGitHubUserId
    && verifiedApproval.pullRequestHeadRepositoryUrl
      === "https://github.com/jesse-stahl/hookbuilder"
    && verifiedApproval.pullRequestState === "merged"
    && verifiedApproval.sourceRepositoryId === exact.sourceRepositoryId
    && verifiedApproval.sourceRepositoryUrl === exact.sourceRepositoryUrl
    && verifiedApproval.sourceCommitSha === exact.sourceCommitSha
    && verifiedApproval.sourceTreeSha === exact.sourceTreeSha;
}

export function manualRouterClaimsShardsV1PointerV1(
  pointer: ManualRouterApplicantPointerAnyV2,
): boolean {
  if (pointer.schemaVersion
    !== "programmable.manual-router-applicant-pointer.v1") return false;
  const exact = MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1;
  return pointer.subject.approvedGitHubUserId === exact.approvedGitHubUserId
    || pointer.subject.subjectHash === exact.subjectHash
    || pointer.approvalBindingHash === exact.approvalBindingHash
    || pointer.routeNonce === exact.routeNonce
    || (
      pointer.headSha === exact.headSha
      && pointer.treeSha === exact.treeSha
    );
}

export function manualRouterIsExactShardsV1PointerV1(
  pointer: ManualRouterApplicantPointerAnyV2,
): boolean {
  if (pointer.schemaVersion
    !== "programmable.manual-router-applicant-pointer.v1") return false;
  const exact = MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1;
  return pointer.subject.schemaVersion
      === "programmable.manual-router-applicant-subject.v1"
    && pointer.subject.repositoryId === exact.repositoryId
    && pointer.subject.pullRequestNumber === exact.pullRequestNumber
    && pointer.subject.approvedGitHubUserId === exact.approvedGitHubUserId
    && normalizedAddress(pointer.subject.approvedLaunchWallet)
      === exact.approvedLaunchWallet
    && pointer.subject.subjectHash === exact.subjectHash
    && pointer.approvalBindingHash === exact.approvalBindingHash
    && pointer.headSha === exact.headSha
    && pointer.treeSha === exact.treeSha
    && pointer.routeNonce === exact.routeNonce;
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function normalizedAddress(value: unknown): string | null {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/u.test(value)
    ? value.toLowerCase()
    : null;
}

function exactApprovalClaim(value: UnknownRecord | null): boolean {
  const exact = MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1;
  return value?.repositoryId === exact.repositoryId
    && value.headRepositoryId === exact.headRepositoryId
    && value.pullRequestNumber === exact.pullRequestNumber
    && value.approvedGitHubUserId === exact.approvedGitHubUserId
    && normalizedAddress(value.approvedLaunchWallet)
      === exact.approvedLaunchWallet
    && value.headSha === exact.headSha
    && value.treeSha === exact.treeSha
    && value.compileInputHash === exact.compileInputHash
    && value.planHash === exact.planHash;
}

function exactApprovalRevision(value: UnknownRecord | null): boolean {
  const expected = MANUAL_ROUTER_SHARDS_V1_COMPATIBILITY_V1.approvalRevision;
  return value?.schemaVersion === expected.schemaVersion
    && value.approvalId === expected.approvalId
    && value.approvalVersion === expected.approvalVersion
    && value.authorizedPrincipalHash === expected.authorizedPrincipalHash
    && value.configurationHash === expected.configurationHash
    && value.evidenceDigest === expected.evidenceDigest
    && value.headSha === expected.headSha
    && value.policyHash === expected.policyHash
    && value.repositoryId === expected.repositoryId
    && value.reviewArtifactHash === expected.reviewArtifactHash
    && value.treeSha === expected.treeSha;
}
