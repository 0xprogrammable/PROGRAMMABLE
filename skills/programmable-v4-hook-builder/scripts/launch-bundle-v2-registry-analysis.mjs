import { canonicalJson, validateAgainstSchema } from "./submission-core.mjs";
import { FEE_POLICY_V2_HASH } from "./fee-policy-v2-core.mjs";
import {
  registryAcceptanceContractForPath,
  registryAcceptanceContractForSchemaId
} from "./launch-bundle-v2-artifacts.mjs";
import {
  analyzeRegistryAcceptanceV3TrustedReview
} from "./launch-bundle-v2-registry-trusted.mjs";
import {
  registryApplicationPackageProjection,
  registryTrustedSourceVerificationProjection,
  registryVerificationDigestProjection
} from "./launch-bundle-v2-registry-projections.mjs";
import {
  PROGRAMMABLE_REGISTRY_NUMERIC_REPOSITORY_ID,
  REGISTRY_ACCEPTANCE_V3_SCHEMA_ID,
  addConflict,
  addUnresolved,
  canonicalPositiveDecimal,
  exact,
  isObject,
  registryAcceptanceV3Schema,
  requireEqual,
  validSlug
} from "./launch-bundle-v2-shared.mjs";

export function analyzeRegistryAcceptance({
  input,
  application,
  registryAcceptance,
  artifacts,
  sourceSnapshots,
  conflicts,
  unresolved,
  reviewItems,
  registryTracker,
  trustedReviewVerification
}) {
  if (input?.artifacts?.registryAcceptance === null) {
    addUnresolved(
      unresolved,
      registryTracker,
      "REGISTRY_ACCEPTANCE_UNRESOLVED",
      "$.artifacts.registryAcceptance",
      "No trusted Registry maintainer acceptance is bound yet. The pre-acceptance dry-run remains NOT_AUTHORIZED."
    );
    return;
  }

  const binding = artifacts.rawRecordsByRole.get("registry-acceptance");
  const applicationBinding = artifacts.rawRecordsByRole.get("application");
  const submissionBinding = artifacts.rawRecordsByRole.get("submission");
  const feePolicyBinding = artifacts.rawRecordsByRole.get("fee-policy");
  const securityBinding = artifacts.rawRecordsByRole.get("security");
  const executionSurfaceBinding = artifacts.rawRecordsByRole.get("execution-surface-coverage");
  if (!binding || !isObject(registryAcceptance)) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_BINDING_MISSING",
      "$.artifacts.registryAcceptance",
      "A non-null Registry acceptance must be one parseable exact content binding."
    );
    return;
  }

  const pathContract = registryAcceptanceContractForPath(binding.path);
  const schemaContract = registryAcceptanceContractForSchemaId(binding.schemaId);
  const acceptanceContract = pathContract ?? schemaContract ?? {
    fileVersion: "v3",
    schema: registryAcceptanceV3Schema,
    schemaId: REGISTRY_ACCEPTANCE_V3_SCHEMA_ID
  };
  if (
    pathContract === null
    || schemaContract === null
    || pathContract.schemaId !== schemaContract.schemaId
  ) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_CONTRACT_DISPATCH_MISMATCH",
      "$.artifacts.registryAcceptance",
      "Registry acceptance path generation and external schema binding must select the same supported acceptance contract."
    );
  }

  const schemaFindings = validateAgainstSchema(registryAcceptance, acceptanceContract.schema);
  for (const finding of schemaFindings) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_SCHEMA_INVALID",
      `$.artifacts.registryAcceptance.content#${String(finding.path ?? "$").slice(1)}`,
      finding.message ?? `Registry acceptance does not match its closed ${acceptanceContract.fileVersion} contract.`
    );
  }
  if (binding.contentMatched !== true) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_CONTENT_BINDING_MISMATCH",
      "$.artifacts.registryAcceptance",
      "Registry acceptance path, Git blob, SHA-256, byte length and inline bytes must all describe the same exact file."
    );
  }

  const registrySource = (Array.isArray(sourceSnapshots) ? sourceSnapshots : [])
    .find(({ id }) => id === binding.sourceRef);
  const recordedRegistryRepository = registryAcceptance?.reviewEvidence?.repository;
  if (
    !registrySource
    || registrySource.numericRepositoryId !== PROGRAMMABLE_REGISTRY_NUMERIC_REPOSITORY_ID
    || !isObject(recordedRegistryRepository)
    || recordedRegistryRepository.numericRepositoryId !== PROGRAMMABLE_REGISTRY_NUMERIC_REPOSITORY_ID
    || registrySource.repositoryUri !== recordedRegistryRepository.repositoryUri
  ) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_REGISTRY_IDENTITY_MISMATCH",
      "$.artifacts.registryAcceptance.sourceRef",
      "A Registry acceptance must come from the immutable Programmable Registry numeric repository ID and the same observed repository URI recorded by its review evidence."
    );
  }
  if (binding.sourceRef !== applicationBinding?.sourceRef) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_APPLICATION_PACKAGE_SOURCE_MISMATCH",
      "$.artifacts.registryAcceptance.sourceRef",
      "Registry acceptance and the exact Application V3 package must be bound to the same canonical Registry snapshot."
    );
  }
  const expectedAcceptancePath = canonicalPositiveDecimal(application?.applicationRevision)
    && validSlug(application?.applicationId)
    ? `registry/acceptances/${application.applicationId}/${application.applicationRevision}.${acceptanceContract.fileVersion}.json`
    : null;
  if (
    pathContract === null
    || pathContract.applicationId !== application?.applicationId
    || pathContract.applicationRevision !== application?.applicationRevision
    || binding.path !== expectedAcceptancePath
  ) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_PATH_MISMATCH",
      "$.artifacts.registryAcceptance.path",
      "Registry acceptance must use the canonical application id and revision path in the exact Registry snapshot."
    );
  }

  const accepted = registryAcceptance.application;
  requireEqual(accepted?.applicationId, application?.applicationId, "REGISTRY_ACCEPTANCE_APPLICATION_ID_MISMATCH", "$.artifacts.registryAcceptance.content#/application/applicationId", "Acceptance application id does not match Application V3.", conflicts, registryTracker);
  requireEqual(accepted?.applicationRevision, application?.applicationRevision, "REGISTRY_ACCEPTANCE_APPLICATION_REVISION_MISMATCH", "$.artifacts.registryAcceptance.content#/application/applicationRevision", "Acceptance revision does not match the exact Application V3 revision.", conflicts, registryTracker);
  requireEqual(accepted?.applicationPath, applicationBinding?.path, "REGISTRY_ACCEPTANCE_APPLICATION_PATH_MISMATCH", "$.artifacts.registryAcceptance.content#/application/applicationPath", "Acceptance application path does not match the exact bound Application V3 file.", conflicts, registryTracker);
  requireEqual(accepted?.applicationSha256, applicationBinding?.sha256, "REGISTRY_ACCEPTANCE_APPLICATION_SHA256_MISMATCH", "$.artifacts.registryAcceptance.content#/application/applicationSha256", "Acceptance does not bind the exact Application V3 bytes.", conflicts, registryTracker);
  requireEqual(accepted?.submissionPath, submissionBinding?.path, "REGISTRY_ACCEPTANCE_SUBMISSION_PATH_MISMATCH", "$.artifacts.registryAcceptance.content#/application/submissionPath", "Acceptance submission path does not match the exact V2 submission.", conflicts, registryTracker);
  requireEqual(accepted?.submissionSha256, submissionBinding?.sha256, "REGISTRY_ACCEPTANCE_SUBMISSION_SHA256_MISMATCH", "$.artifacts.registryAcceptance.content#/application/submissionSha256", "Acceptance does not bind the exact V2 submission bytes.", conflicts, registryTracker);
  requireEqual(accepted?.feeApplicability, application?.policyBindings?.feeApplicability, "REGISTRY_ACCEPTANCE_FEE_APPLICABILITY_MISMATCH", "$.artifacts.registryAcceptance.content#/application/feeApplicability", "Acceptance feeApplicability does not match the exact Application V3 review state.", conflicts, registryTracker);
  if (accepted?.feeApplicability === "applicable") {
    requireEqual(accepted?.feePolicyInstancePath, feePolicyBinding?.path, "REGISTRY_ACCEPTANCE_FEE_POLICY_PATH_MISMATCH", "$.artifacts.registryAcceptance.content#/application/feePolicyInstancePath", "Acceptance fee-policy instance path does not match the exact Fee V2 instance.", conflicts, registryTracker);
    requireEqual(accepted?.feePolicyInstanceSha256, feePolicyBinding?.sha256, "REGISTRY_ACCEPTANCE_FEE_POLICY_SHA256_MISMATCH", "$.artifacts.registryAcceptance.content#/application/feePolicyInstanceSha256", "Acceptance does not bind the exact Fee V2 instance bytes.", conflicts, registryTracker);
  } else if (accepted?.feeApplicability === "not-applicable") {
    requireEqual(accepted?.feePolicyInstancePath, null, "REGISTRY_ACCEPTANCE_FEE_NOT_APPLICABLE_PATH_FORBIDDEN", "$.artifacts.registryAcceptance.content#/application/feePolicyInstancePath", "A fee-not-applicable acceptance must keep the instance path null.", conflicts, registryTracker);
    requireEqual(accepted?.feePolicyInstanceSha256, null, "REGISTRY_ACCEPTANCE_FEE_NOT_APPLICABLE_SHA256_FORBIDDEN", "$.artifacts.registryAcceptance.content#/application/feePolicyInstanceSha256", "A fee-not-applicable acceptance must keep the instance digest null.", conflicts, registryTracker);
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_FEE_NOT_APPLICABLE_NOT_LAUNCHABLE",
      "$.artifacts.registryAcceptance.content#/application/feeApplicability",
      "Registry review may accept an exact zero-scope Application, but that N/A acceptance is never Launch V2 authorization and cannot bypass the Fee V2 instance gate."
    );
  }
  requireEqual(accepted?.feePolicyHash, FEE_POLICY_V2_HASH, "REGISTRY_ACCEPTANCE_FEE_POLICY_HASH_MISMATCH", "$.artifacts.registryAcceptance.content#/application/feePolicyHash", "Acceptance does not bind the immutable Fee V2 policy hash.", conflicts, registryTracker);
  requireEqual(accepted?.securityAssessmentPath, securityBinding?.path, "REGISTRY_ACCEPTANCE_SECURITY_PATH_MISMATCH", "$.artifacts.registryAcceptance.content#/application/securityAssessmentPath", "Acceptance security path does not match the derived Application V3 security assessment.", conflicts, registryTracker);
  requireEqual(accepted?.securityAssessmentSha256, securityBinding?.sha256, "REGISTRY_ACCEPTANCE_SECURITY_SHA256_MISMATCH", "$.artifacts.registryAcceptance.content#/application/securityAssessmentSha256", "Acceptance does not bind the exact derived security assessment bytes.", conflicts, registryTracker);
  requireEqual(accepted?.executionSurfaceCoveragePath, executionSurfaceBinding?.path, "REGISTRY_ACCEPTANCE_EXECUTION_SURFACE_PATH_MISMATCH", "$.artifacts.registryAcceptance.content#/application/executionSurfaceCoveragePath", "Acceptance execution-surface path does not match the exact derived coverage artifact.", conflicts, registryTracker);
  requireEqual(accepted?.executionSurfaceCoverageSha256, executionSurfaceBinding?.sha256, "REGISTRY_ACCEPTANCE_EXECUTION_SURFACE_SHA256_MISMATCH", "$.artifacts.registryAcceptance.content#/application/executionSurfaceCoverageSha256", "Acceptance does not bind the exact execution-surface coverage bytes.", conflicts, registryTracker);

  const expectedVerificationBindings = registryVerificationDigestProjection(application?.source?.verificationReports);
  requireEqual(
    registryAcceptance.verificationBindings?.aggregateSha256,
    expectedVerificationBindings.aggregateSha256,
    "REGISTRY_ACCEPTANCE_VERIFICATION_AGGREGATE_MISMATCH",
    "$.artifacts.registryAcceptance.content#/verificationBindings/aggregateSha256",
    "Acceptance verification aggregate does not bind the exact per-repository Application V3 report associations.",
    conflicts,
    registryTracker
  );
  if (canonicalJson(registryAcceptance.verificationBindings?.repositories ?? null) !== canonicalJson(expectedVerificationBindings.repositories)) {
    addConflict(
      conflicts,
      registryTracker,
      "REGISTRY_ACCEPTANCE_VERIFICATION_REPOSITORIES_MISMATCH",
      "$.artifacts.registryAcceptance.content#/verificationBindings/repositories",
      "Acceptance per-repository verification digests are stale, incomplete, duplicated or reordered."
    );
  }
  if (acceptanceContract.schemaId === REGISTRY_ACCEPTANCE_V3_SCHEMA_ID) {
    const applicationPackage = registryApplicationPackageProjection(application);
    const expectedApplicationPath = canonicalPositiveDecimal(application?.applicationRevision)
      && validSlug(application?.applicationId)
      ? `submissions/${application.applicationId}/v3/revisions/${application.applicationRevision}/application.v3.json`
      : null;
    if (
      applicationPackage === null
      || applicationBinding?.content !== applicationPackage.applicationBytes
      || applicationBinding?.path !== expectedApplicationPath
    ) {
      addConflict(
        conflicts,
        registryTracker,
        "REGISTRY_ACCEPTANCE_APPLICATION_PACKAGE_MISMATCH",
        "$.artifacts.application",
        "Registry acceptance v3 requires the canonical Application V3 package path and bytes used by the trusted Registry verifier."
      );
    }
    requireEqual(
      accepted?.packageSha256,
      applicationPackage?.packageSha256,
      "REGISTRY_ACCEPTANCE_APPLICATION_PACKAGE_SHA256_MISMATCH",
      "$.artifacts.registryAcceptance.content#/application/packageSha256",
      "Registry acceptance package digest does not match the exact canonical Application V3 package projection.",
      conflicts,
      registryTracker
    );
    if (binding.content !== `${canonicalJson(registryAcceptance)}\n`) {
      addConflict(
        conflicts,
        registryTracker,
        "REGISTRY_ACCEPTANCE_V3_BYTES_NONCANONICAL",
        "$.artifacts.registryAcceptance.content",
        "Registry acceptance v3 must use the exact canonical JSON plus LF bytes emitted and read by the Registry contract."
      );
    }
    const expectedTrustedSourceVerification = registryTrustedSourceVerificationProjection(application?.source);
    if (
      expectedTrustedSourceVerification === null
      || canonicalJson(registryAcceptance.trustedSourceVerification ?? null) !== canonicalJson(expectedTrustedSourceVerification)
    ) {
      addConflict(
        conflicts,
        registryTracker,
        "REGISTRY_ACCEPTANCE_TRUSTED_SOURCE_MISMATCH",
        "$.artifacts.registryAcceptance.content#/trustedSourceVerification",
        "Registry acceptance trusted source evidence does not match the exact Application V3 repository authorities and verified report bindings."
      );
    }
    analyzeRegistryAcceptanceV3TrustedReview({
      acceptanceBinding: binding,
      application,
      applicationBinding,
      conflicts,
      registryAcceptance,
      registryTracker,
      trustedReviewVerification
    });
  }
  reviewItems.add(
    "REGISTRY_ACCEPTANCE_NOT_ADMIN_AUTHORIZATION",
    "$.artifacts.registryAcceptance",
    "Trusted Registry maintainer acceptance binds review evidence only; the separate platform admin has not authorized a launch.",
    []
  );
}
