import { canonicalJson } from "./submission-core.mjs";
import {
  analyzeApplicationAndSubmission,
  analyzeAuthoritativeContracts,
  collectArtifacts,
  collectSourceSnapshots
} from "./launch-bundle-v2-artifacts.mjs";
import { analyzeRegistryAcceptance } from "./launch-bundle-v2-registry-analysis.mjs";
import { validateRegistryAcceptanceV3CurrentMain } from "./launch-bundle-v2-registry-current-main.mjs";
import { projectRegistryAcceptanceV3ImmutableReviewAuthority } from "./launch-bundle-v2-registry-review-shared.mjs";
import { analyzeFeeConformanceReceipts, analyzeLaunchExecutionEvidence } from "./launch-bundle-v2-execution.mjs";
import { analyzeFeeScopes, analyzeIntentChain, analyzeProtocolContexts } from "./launch-bundle-v2-domain-analysis.mjs";
import { analyzeReviewRequirements, analyzeSecurityEnvelope } from "./launch-bundle-v2-security-analysis.mjs";
import {
  LAUNCH_BUNDLE_INPUT_V2_SCHEMA_ID,
  LAUNCH_BUNDLE_OUTPUT_V2_SCHEMA_ID,
  LAUNCH_BUNDLE_V2_STATUS,
  LAUNCH_BUNDLE_V2_VERSION,
  PROGRAMMABLE_ADMIN_AUTHORIZER,
  PROGRAMMABLE_FEE_RECIPIENT,
  SHA256_PATTERN,
  addConflict,
  bindingState,
  deduplicateIssues,
  deepFreeze,
  exact,
  isObject,
  issueCollector,
  rejectUnknown,
  sha256Utf8,
  tracker,
  validSlug,
  validateArray,
  validateArtifactShape,
  validateFeeScopeBindingShapes,
  validateProtocolContextShapes,
  validateReviewRequirementShapes,
  validateSlug,
  validateSourceSnapshots
} from "./launch-bundle-v2-shared.mjs";

export {
  APPLICATION_V3_SCHEMA_ID,
  ARCHITECTURE_DECISIONS_V1_SCHEMA_ID,
  EXECUTION_SURFACE_COVERAGE_V1_SCHEMA_ID,
  FEE_POLICY_V2_SCHEMA_ID,
  IDEA_SOURCE_V1_SCHEMA_ID,
  INTENT_CONTRACT_V1_SCHEMA_ID,
  INTENT_FIDELITY_V1_SCHEMA_ID,
  LAUNCH_BUNDLE_INPUT_V2_SCHEMA_ID,
  LAUNCH_BUNDLE_OUTPUT_V2_SCHEMA_ID,
  LAUNCH_BUNDLE_V2_STATUS,
  LAUNCH_BUNDLE_V2_VERSION,
  PROGRAMMABLE_ADMIN_AUTHORIZER,
  PROGRAMMABLE_FEE_RECIPIENT,
  PROGRAMMABLE_REGISTRY_NUMERIC_REPOSITORY_ID,
  REGISTRY_ACCEPTANCE_V3_SCHEMA_ID,
  SECURITY_V1_SCHEMA_ID,
  SUBMISSION_V2_SCHEMA_ID,
  createExactContentBindingV2,
  gitBlobObjectIdUtf8,
  sha256Utf8
} from "./launch-bundle-v2-shared.mjs";
export { validateRegistryAcceptanceV3CurrentMain } from "./launch-bundle-v2-registry-current-main.mjs";
export { projectRegistryAcceptanceV3ImmutableReviewAuthority } from "./launch-bundle-v2-registry-review-shared.mjs";

export function validateLaunchBundleV2Input(input) {
  const issues = [];
  const add = (code, path, message) => issues.push({ code, path, message });
  if (!isObject(input)) {
    add("INPUT_TYPE_INVALID", "$", "The launch bundle input must be an object.");
    return issues;
  }
  const allowedRoot = new Set([
    "$schema",
    "schemaVersion",
    "contract",
    "bundleId",
    "applicationId",
    "platform",
    "sources",
    "artifacts",
    "feeScopeBindings",
    "protocolContexts",
    "reviewRequirements",
    "authorizationRequest"
  ]);
  rejectUnknown(input, allowedRoot, "$", add);
  exact(input.$schema, LAUNCH_BUNDLE_INPUT_V2_SCHEMA_ID, "$.\u0024schema", "INPUT_SCHEMA_ID_INVALID", add);
  exact(input.schemaVersion, LAUNCH_BUNDLE_V2_VERSION, "$.schemaVersion", "INPUT_VERSION_INVALID", add);
  exact(input.contract?.id, "launch-bundle-input-v2", "$.contract.id", "INPUT_CONTRACT_INVALID", add);
  exact(input.contract?.version, LAUNCH_BUNDLE_V2_VERSION, "$.contract.version", "INPUT_CONTRACT_VERSION_INVALID", add);
  validateSlug(input.bundleId, "$.bundleId", "BUNDLE_ID_INVALID", add);
  validateSlug(input.applicationId, "$.applicationId", "APPLICATION_ID_INVALID", add);

  exact(input.platform?.feeRecipient, PROGRAMMABLE_FEE_RECIPIENT, "$.platform.feeRecipient", "FEE_RECIPIENT_INVALID", add);
  exact(input.platform?.independentAdminAuthorizer, PROGRAMMABLE_ADMIN_AUTHORIZER, "$.platform.independentAdminAuthorizer", "ADMIN_AUTHORIZER_INVALID", add);
  exact(input.platform?.rolesSeparated, true, "$.platform.rolesSeparated", "PLATFORM_ROLES_NOT_SEPARATED", add);

  validateSourceSnapshots(input.sources, add);
  validateArtifactShape(input.artifacts, add);
  validateArray(input.feeScopeBindings, "$.feeScopeBindings", "FEE_SCOPE_BINDINGS_TYPE", add);
  validateArray(input.protocolContexts, "$.protocolContexts", "PROTOCOL_CONTEXTS_TYPE", add);
  validateArray(input.reviewRequirements, "$.reviewRequirements", "REVIEW_REQUIREMENTS_TYPE", add);

  exact(input.authorizationRequest?.approvalInherited, false, "$.authorizationRequest.approvalInherited", "INHERITED_APPROVAL_FORBIDDEN", add);
  if (!Array.isArray(input.authorizationRequest?.priorApprovalRefs)) {
    add("PRIOR_APPROVAL_REFS_TYPE", "$.authorizationRequest.priorApprovalRefs", "priorApprovalRefs must be an array.");
  }
  exact(input.authorizationRequest?.humanAdminAuthorization, null, "$.authorizationRequest.humanAdminAuthorization", "EMBEDDED_ADMIN_AUTHORIZATION_FORBIDDEN", add);
  exact(input.authorizationRequest?.independentHumanReviewRequired, true, "$.authorizationRequest.independentHumanReviewRequired", "INDEPENDENT_REVIEW_REQUIRED", add);

  validateFeeScopeBindingShapes(input.feeScopeBindings, add);
  validateProtocolContextShapes(input.protocolContexts, add);
  validateReviewRequirementShapes(input.reviewRequirements, "$.reviewRequirements", add);
  return deduplicateIssues(issues);
}

export function prepareLaunchBundleV2(inputValue, runtimeValue = {}) {
  const input = isObject(inputValue) ? inputValue : inputValue ?? null;
  const runtime = isObject(runtimeValue) ? runtimeValue : {};
  const conflicts = issueCollector();
  const unresolved = issueCollector();
  const reviewItems = issueCollector();
  const structuralTracker = tracker();
  const sourceTracker = tracker();
  const registryTracker = tracker();
  const executionTracker = tracker();
  const tradeCapabilityTracker = tracker();
  const applicationTracker = tracker();
  const intentTracker = tracker();
  const feeTracker = tracker();
  const feeRecipientTracker = tracker();
  const securityTracker = tracker();
  const evidenceTracker = tracker();

  for (const issue of validateLaunchBundleV2Input(input)) {
    addConflict(conflicts, structuralTracker, issue.code, issue.path, issue.message);
  }
  if (input?.platform?.feeRecipient !== PROGRAMMABLE_FEE_RECIPIENT) feeRecipientTracker.conflicts += 1;
  if (input?.platform?.independentAdminAuthorizer !== PROGRAMMABLE_ADMIN_AUTHORIZER || input?.platform?.rolesSeparated !== true) {
    feeRecipientTracker.conflicts += 1;
  }

  const sourceSnapshots = collectSourceSnapshots(input?.sources, sourceTracker, conflicts);
  const sourceMap = new Map(sourceSnapshots.map((source) => [source.id, source]));
  const artifactState = collectArtifacts(input?.artifacts, sourceMap, {
    conflicts,
    sourceTracker,
    registryTracker,
    evidenceTracker,
    structuralTracker
  });

  const application = artifactState.documents.application;
  const submission = artifactState.documents.submission;
  const ideaSource = artifactState.documents.ideaSource;
  const intentContract = artifactState.documents.intentContract;
  const architectureDecisions = artifactState.documents.architectureDecisions;
  const intentFidelity = artifactState.documents.intentFidelity;
  const feePolicy = artifactState.documents.feePolicy;
  const securityEnvelope = artifactState.documents.security;
  const executionSurfaceCoverage = artifactState.documents.executionSurfaceCoverage;
  const registryAcceptance = artifactState.documents.registryAcceptance;
  const evidenceIndex = artifactState.evidenceIndex;

  analyzeAuthoritativeContracts({
    application,
    submission,
    artifactState,
    conflicts,
    reviewItems,
    structuralTracker,
    applicationTracker
  });

  analyzeApplicationAndSubmission({
    input,
    application,
    submission,
    feePolicy,
    sourceSnapshots,
    artifacts: artifactState,
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    applicationTracker,
    feeTracker,
    feeRecipientTracker,
    securityTracker,
    evidenceTracker
  });

  analyzeRegistryAcceptance({
    input,
    application,
    registryAcceptance,
    artifacts: artifactState,
    sourceSnapshots,
    conflicts,
    unresolved,
    reviewItems,
    registryTracker,
    trustedReviewVerification: runtime.trustedReviewVerification ?? null
  });

  analyzeIntentChain({
    input,
    application,
    submission,
    ideaSource,
    intentContract,
    architectureDecisions,
    intentFidelity,
    artifacts: artifactState,
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    intentTracker,
    evidenceTracker
  });

  const feeScopeResults = analyzeFeeScopes({
    input,
    submission,
    feePolicy,
    evidenceIndex,
    conflicts,
    unresolved,
    feeTracker,
    evidenceTracker
  });

  const protocolResults = analyzeProtocolContexts({
    input,
    submission,
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    evidenceTracker
  });

  analyzeSecurityEnvelope({
    input,
    application,
    submission,
    securityEnvelope,
    artifacts: artifactState,
    sourceSnapshots,
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    securityTracker,
    evidenceTracker
  });

  const executionAnalysis = analyzeLaunchExecutionEvidence({
    input,
    application,
    submission,
    feePolicy,
    securityEnvelope,
    executionSurfaceCoverage,
    artifacts: artifactState,
    sourceSnapshots,
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    executionTracker,
    tradeCapabilityTracker,
    evidenceTracker
  });

  analyzeFeeConformanceReceipts({
    input,
    application,
    submission,
    feePolicy,
    executionSurfaceCoverage,
    artifacts: artifactState,
    sourceSnapshots,
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    feeTracker,
    evidenceTracker
  });

  analyzeReviewRequirements({
    requirements: input?.reviewRequirements,
    basePath: "$.reviewRequirements",
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    evidenceTracker
  });

  if ((input?.authorizationRequest?.priorApprovalRefs?.length ?? 0) > 0) {
    reviewItems.add(
      "PRIOR_APPROVAL_PRESERVED_WITHOUT_INHERITANCE",
      "$.authorizationRequest.priorApprovalRefs",
      "Prior review references are preserved as history but do not authorize this bundle.",
      []
    );
  }
  reviewItems.add(
    "INDEPENDENT_HUMAN_ADMIN_AUTHORIZATION_REQUIRED",
    "$.authorizationRequest",
    `A human reviewer and the separate admin authority ${PROGRAMMABLE_ADMIN_AUTHORIZER} must authorize any later launch action.`,
    []
  );

  const inputSha256 = sha256Utf8(canonicalJson(input));
  const baseOutput = {
    $schema: LAUNCH_BUNDLE_OUTPUT_V2_SCHEMA_ID,
    schemaVersion: LAUNCH_BUNDLE_V2_VERSION,
    contract: {
      id: "launch-bundle-output-v2",
      version: LAUNCH_BUNDLE_V2_VERSION
    },
    bundleId: validSlug(input?.bundleId) ? input.bundleId : null,
    applicationId: validSlug(input?.applicationId) ? input.applicationId : null,
    status: LAUNCH_BUNDLE_V2_STATUS,
    authorization: {
      approvalInherited: false,
      feeRecipient: PROGRAMMABLE_FEE_RECIPIENT,
      independentAdminAuthorizer: PROGRAMMABLE_ADMIN_AUTHORIZER,
      adminAuthorization: null,
      requiredNextAction: "INDEPENDENT_HUMAN_ADMIN_AUTHORIZATION",
      canSign: false,
      canBroadcast: false,
      canDeploy: false,
      canExecute: false,
      availabilityClaimed: false
    },
    integrity: {
      inputSha256,
      sourceExternallyVerified: false
    },
    sourceBindings: sourceSnapshots,
    artifactBindings: artifactState.bindingSummaries,
    analysis: {
      structuralInputState: bindingState(structuralTracker),
      sourceBindingState: bindingState(sourceTracker),
      registryAcceptanceState: bindingState(registryTracker),
      executionSurfaceState: bindingState(executionTracker),
      tradeCapabilityState: bindingState(tradeCapabilityTracker),
      applicationSubmissionBindingState: bindingState(applicationTracker),
      intentBindingState: bindingState(intentTracker),
      feePolicyBindingState: bindingState(feeTracker),
      feeRecipientBindingState: bindingState(feeRecipientTracker),
      securityState: bindingState(securityTracker),
      evidenceBindingState: bindingState(evidenceTracker),
      executionSurfaces: executionAnalysis.executionSurfaces,
      tradeCapabilities: executionAnalysis.tradeCapabilities,
      feeScopes: feeScopeResults,
      protocolContexts: protocolResults,
      conflicts: conflicts.values(),
      unresolved: unresolved.values(),
      reviewItems: reviewItems.values()
    },
    generatedTransactions: [],
    signatures: [],
    externalActionsPerformed: [],
    networkAccessed: false,
    writePerformed: false
  };
  const reportSha256 = sha256Utf8(canonicalJson(baseOutput));
  return deepFreeze({
    ...baseOutput,
    integrity: {
      ...baseOutput.integrity,
      reportSha256
    }
  });
}

export function verifyLaunchBundleV2Report(report) {
  if (!isObject(report)) return false;
  if (report.status !== LAUNCH_BUNDLE_V2_STATUS) return false;
  if (report.authorization?.approvalInherited !== false) return false;
  if (report.authorization?.adminAuthorization !== null) return false;
  if (report.authorization?.canSign !== false || report.authorization?.canBroadcast !== false) return false;
  if (report.authorization?.canDeploy !== false || report.authorization?.canExecute !== false) return false;
  if (report.networkAccessed !== false || report.writePerformed !== false) return false;
  if ((report.generatedTransactions?.length ?? -1) !== 0) return false;
  if ((report.signatures?.length ?? -1) !== 0) return false;
  if ((report.externalActionsPerformed?.length ?? -1) !== 0) return false;
  const expected = report.integrity?.reportSha256;
  if (!SHA256_PATTERN.test(expected ?? "")) return false;
  const clone = structuredClone(report);
  delete clone.integrity.reportSha256;
  return sha256Utf8(canonicalJson(clone)) === expected;
}
