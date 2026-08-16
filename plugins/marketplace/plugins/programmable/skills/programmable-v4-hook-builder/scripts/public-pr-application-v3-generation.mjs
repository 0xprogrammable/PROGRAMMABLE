import { canonicalJson } from "./submission-core.mjs";
import { sha256Bytes } from "./open-world-v2-core.mjs";
import {
  analyzeOpenWorldSecurity,
  validateOpenWorldSecurityInput
} from "./open-world-security-core.mjs";
import { inspectDependencyPointerCoverage } from "./application-dependency-core.mjs";
import {
  addFindingCopy,
  cloneCanonicalJson,
  createFindingAdder,
  finalizeReport,
  isObject,
  readJson,
  safeRepositoryPath,
  sha256Pattern
} from "./public-pr-application-v3-shared.mjs";
import {
  findingsHavePrivacyHold,
  privacySafeReport,
  privacySafeSecuritySummary,
  validatePublicApplicationText
} from "./public-pr-application-v3-privacy.mjs";
import {
  validatePublicPrApplicationV3
} from "./public-pr-application-v3-validation.mjs";
import { sourceClosureBindingMatchesRepository } from "./public-pr-application-v3-source-validation.mjs";

const securityAssessmentSchema = readJson(
  new URL("../references/open-world-security-v1.schema.json", import.meta.url)
);

const confirmedUnsafeIntentSignals = Object.freeze({
  CALLBACK_UNAUTHENTICATED_INTENT: Object.freeze({ profile: "callbackAuth", field: "poolManagerOnly", values: [false] }),
  CALLBACK_SENDER_CONFUSED_WITH_USER: Object.freeze({ profile: "callbackAuth", field: "senderTreatedAsEndUser", values: [true] }),
  PRIVILEGED_CONTROL_HIDDEN: Object.freeze({ profile: "privilegedValue", field: "hidden", values: [true] }),
  PRIVILEGED_USER_BACKING_FLOOR_BYPASS: Object.freeze({ profile: "privilegedValue", field: "canReduceUserBackingBelowEnforceableLiabilities", values: [true] }),
  PRIVILEGED_RESERVED_LIABILITY_FLOOR_BYPASS: Object.freeze({ profile: "privilegedValue", field: "canReduceReservedPlatformLiabilitiesBelowFloor", values: [true] }),
  PRIVILEGED_PAYOUT_OUTSIDE_AUTHORIZATION: Object.freeze({ profile: "privilegedValue", field: "canRedirectPayoutOutsidePriorConsentOrImmutableRule", values: [true] }),
  PRIVILEGED_UPGRADE_BYPASS: Object.freeze({ profile: "privilegedValue", field: "upgradeCanBypassInvariants", values: [true] }),
  ECONOMIC_RANDOMNESS_PARTICIPANT_VALUE_EXPOSED_TO_BIAS: Object.freeze({ profile: "randomness", field: "participantValueAtRisk", values: [true], requiresAny: Object.freeze([
    Object.freeze({ field: "source", values: Object.freeze(["signed-server", "block-timestamp", "blockhash", "prevrandao-only"]) })
  ]) }),
  ECONOMIC_RANDOMNESS_UNBIASED_PROMISE_FALSE: Object.freeze({ profile: "randomness", field: "promisedUnbiasedOutcome", values: [true], requiresAny: Object.freeze([
    Object.freeze({ field: "source", values: Object.freeze(["signed-server", "block-timestamp", "blockhash", "prevrandao-only"]) })
  ]) }),
  ECONOMIC_RANDOMNESS_ENFORCEABLE_ENTITLEMENT_MANIPULABLE: Object.freeze({ profile: "randomness", field: "manipulationCanReduceEnforceableUserEntitlement", values: [true] }),
  ECONOMIC_RANDOMNESS_VALUE_BEARING_WITHHOLDING_UNBOUNDED: Object.freeze({ profile: "randomness", field: "withholdingBounded", values: [false], requiresAny: Object.freeze([
    Object.freeze({ field: "participantValueAtRisk", values: Object.freeze([true]) }),
    Object.freeze({ field: "manipulationCanReduceEnforceableUserEntitlement", values: Object.freeze([true]) })
  ]) }),
  GAME_OPERATOR_EXCEEDS_AUTHORIZED_EXPOSURE: Object.freeze({ profile: "gameSettlement", field: "operatorCanExceedAuthorizedExposure", values: [true], requires: Object.freeze({ movesValue: true }) }),
  GAME_OPERATOR_UNAUTHORIZED_RECIPIENT: Object.freeze({ profile: "gameSettlement", field: "operatorCanChooseUnauthorizedRecipient", values: [true], requires: Object.freeze({ movesValue: true }) }),
  GAME_LOSS_EXPOSURE_UNRESOLVED: Object.freeze({ profile: "gameSettlement", field: "lossExposureBounded", values: [false], requires: Object.freeze({ movesValue: true }) }),
  GAME_AUTHORIZATION_SCOPE_UNRESOLVED: Object.freeze({ profile: "gameSettlement", field: "authorizationScopeBound", values: [false], requires: Object.freeze({ movesValue: true }) }),
  GAME_CUSTODY_AUTHORIZATION_UNRESOLVED: Object.freeze({ profile: "gameSettlement", field: "custodyAuthorizationBound", values: [false], requires: Object.freeze({ movesValue: true }) }),
  RETURN_DELTA_NOOP_ON_CLAIMED_CUSTOM_ACCOUNTING: Object.freeze({ profile: "returnDelta", field: "noOpUsedOnPathClaimingCustomAccounting", values: [true] }),
  RETURN_DELTA_OUTPUT_UNBACKED: Object.freeze({ profile: "returnDelta", field: "outputBalanceBacked", values: [false] }),
  RETURN_DELTA_UNAUTHORIZED_ZERO_OUTPUT: Object.freeze({ profile: "returnDelta", field: "userAuthorizedZeroOutput", values: [false], requires: Object.freeze({ zeroOutputPossible: true }) }),
  SOLVENCY_LIABILITIES_UNBACKED: Object.freeze({ profile: "solvency", field: "liabilitiesBoundedByImmediatelyRealizableAssets", values: [false], requires: Object.freeze({ claimIsImmediatelyRedeemableOrGuaranteed: true }) }),
  SOLVENCY_FUTURE_REVENUE_BACKING: Object.freeze({ profile: "solvency", field: "futureRevenueCountedAsBacking", values: [true], requires: Object.freeze({ claimIsImmediatelyRedeemableOrGuaranteed: true }) }),
  SOLVENCY_ADMIN_BACKING_WITHDRAWAL: Object.freeze({ profile: "solvency", field: "adminCanWithdrawBacking", values: [true], requires: Object.freeze({ claimIsImmediatelyRedeemableOrGuaranteed: true }) }),
  SOLVENCY_UNBOUNDED_OR_DECEPTIVE_GUARANTEED_CLAIM: Object.freeze({ profile: "solvency", field: "canCreateUnboundedOrDeceptiveGuaranteedClaim", values: [true] }),
  EXIT_OWED_ENTITLEMENT_PATH_ABSENT: Object.freeze({ profile: "exitLiveness", field: "userExitExists", values: [false], requires: Object.freeze({ outstandingUserEntitlementExists: true }) }),
  EXIT_IRREVERSIBLE_DISPOSITION_UNAUTHORIZED: Object.freeze({ profile: "exitLiveness", field: "userAuthorizedIrreversibleDisposition", values: [false], requires: Object.freeze({ userExitExists: false, outstandingUserEntitlementExists: false }) }),
  EXIT_IRREVERSIBLE_DISPOSITION_UNDISCLOSED: Object.freeze({ profile: "exitLiveness", field: "irreversibleDispositionDisclosed", values: [false], requires: Object.freeze({ userExitExists: false, outstandingUserEntitlementExists: false }) }),
  EXIT_MANAGED_REDEMPTION_UNDISCLOSED: Object.freeze({ profile: "exitLiveness", field: "managedRedemptionDisclosed", values: [false], requires: Object.freeze({ userExitExists: true, managedRedemption: true }) }),
  EXIT_MANAGED_REDEMPTION_AUTHORIZATION_UNBOUND: Object.freeze({ profile: "exitLiveness", field: "managedRedemptionAuthorizationBound", values: [false], requires: Object.freeze({ userExitExists: true, managedRedemption: true }) }),
  EXIT_AUTHORITY_CAN_SEIZE_OR_REDIRECT_OWED_VALUE: Object.freeze({ profile: "exitLiveness", field: "authorityCanSeizeOrRedirectOwedValue", values: [true] }),
  EXIT_AUTONOMOUS_PROMISE_FALSE: Object.freeze({ profile: "exitLiveness", field: "autonomousExitPromised", values: [true], requiresAny: Object.freeze([
    Object.freeze({ field: "userExitExists", values: Object.freeze([false]) }),
    Object.freeze({ field: "independentOfAdmin", values: Object.freeze([false]) }),
    Object.freeze({ field: "independentOfKeeper", values: Object.freeze([false]) }),
    Object.freeze({ field: "managedRedemption", values: Object.freeze([true]) })
  ]) }),
  EXIT_ADMIN_BLOCKABLE: Object.freeze({ profile: "exitLiveness", field: "independentOfAdmin", values: [false], requires: Object.freeze({ userExitExists: true, managedRedemption: false, selectiveBlockingPossible: false }) }),
  EXIT_SELECTIVE_BLOCKING_DISCLOSURE_MISSING: Object.freeze({ profile: "exitLiveness", field: "selectiveBlockingDisclosed", values: [false], requires: Object.freeze({ selectiveBlockingPossible: true }) }),
  EXIT_SELECTIVE_BLOCKING_SCOPE_UNBOUND: Object.freeze({ profile: "exitLiveness", field: "selectiveBlockingScopeBound", values: [false], requires: Object.freeze({ selectiveBlockingPossible: true }) }),
  EXIT_SELECTIVE_BLOCKING_AUTHORIZATION_UNBOUND: Object.freeze({ profile: "exitLiveness", field: "selectiveBlockingAuthorizationBound", values: [false], requires: Object.freeze({ selectiveBlockingPossible: true }) }),
  EXIT_SELECTIVE_BLOCKING_PLATFORM_REDIRECTION: Object.freeze({ profile: "exitLiveness", field: "blockedValueCannotBeRedirectedByPlatformAuthority", values: [false], requires: Object.freeze({ selectiveBlockingPossible: true }) })
});

/**
 * Pure, fail-closed assembly gate for one publishable public PR application.
 * Filesystem/Git collection stays in the CLI; this function only accepts exact,
 * content-addressed evidence and never grants launch authorization.
 */
export function generatePublicPrApplicationV3({
  application,
  securityAssessment,
  sourceCoverage,
  securityEvidenceBindings
}) {
  const generatedApplication = cloneCanonicalJson(application);
  const findings = [];
  const seen = new Set();
  const add = createFindingAdder(findings, seen);
  const applicationValidation = validatePublicPrApplicationV3(generatedApplication);
  for (const finding of applicationValidation.findings) addFindingCopy(add, finding);
  validatePublicApplicationText({ securityAssessment, sourceCoverage, securityEvidenceBindings }, add);

  if (!isObject(generatedApplication)) {
    add("blocker", "APPLICATION_GENERATOR_INPUT_INVALID", "$.application", "Application input must be one closed v3 object.", "Assemble the exact application contract before materialization.", "application-contract");
  }
  if (generatedApplication?.stage !== "prototype") {
    add("blocker", "APPLICATION_GENERATOR_PROTOTYPE_REQUIRED", "$.application.stage", "Only a source-backed prototype can be materialized as a public application; ideas, proposals, and migration previews remain editable and eligible.", "Complete the prototype evidence package without changing or narrowing the product idea.", "review-readiness");
  }

  const securityIssues = validateOpenWorldSecurityInput(securityAssessment);
  for (const issue of securityIssues) {
    add("blocker", "APPLICATION_SECURITY_INPUT_INVALID", `$.securityAssessment${issue.path === "$" ? "" : issue.path.slice(1)}`, issue.message, "Correct the exact security evidence envelope without deleting true observations.", "security-evidence", { securityCode: issue.code });
  }
  const primary = generatedApplication?.source?.primary;
  if (
    securityAssessment?.subject?.id !== generatedApplication?.applicationId
    || securityAssessment?.subject?.revision !== primary?.revisionObjectId
    || securityAssessment?.subject?.stage !== generatedApplication?.stage
  ) {
    add("blocker", "APPLICATION_SECURITY_SUBJECT_BINDING_MISMATCH", "$.securityAssessment.subject", "Security subject id, source revision, and stage must exactly match the application primary source.", "Analyze the exact bound prototype commit and stage.", "security-evidence");
  }
  let dependencyDisposition = null;
  try {
    dependencyDisposition = inspectDependencyPointerCoverage(sourceCoverage, {
      declaredRepositoryRefs: [
        generatedApplication?.source?.primary?.id,
        ...(Array.isArray(generatedApplication?.source?.companions)
          ? generatedApplication.source.companions.map(({ id }) => id)
          : [])
      ]
    });
  } catch (error) {
    add("blocker", "APPLICATION_DEPENDENCY_POINTER_COVERAGE_INVALID", "$.sourceCoverage", "Dependency-pointer coverage is missing, malformed, or does not exactly cover every declared repository.", "Replay every exact source closure with the current verifier and preserve its closed dependencyPointerCoverage contract.", "source-closure-binding", { dependencyCode: error?.code ?? "DEPENDENCY_POINTER_COVERAGE_INVALID" });
  }
  if (dependencyDisposition?.state === "LEGACY_MISSING") {
    add("blocker", "APPLICATION_DEPENDENCY_POINTER_COVERAGE_MISSING", "$.sourceCoverage", "Legacy source reports without closed dependency-pointer coverage cannot be materialized.", "Replay every source repository with the current verifier before materialization or launch review.", "source-closure-binding");
  }
  const dependencyPartial = dependencyDisposition?.state === "UNRESOLVED"
    && securityAssessment?.assessment?.state === "partial"
    && securityAssessment?.assessment?.reasonCode === "DEPENDENCY_TARGETS_UNRESOLVED"
    && securityAssessment?.assessment?.sourceCoverage === null;
  if (dependencyDisposition?.state === "UNRESOLVED" && !dependencyPartial) {
    add("blocker", "APPLICATION_DEPENDENCY_SECURITY_DOWNGRADE_REQUIRED", "$.securityAssessment.assessment", "Unresolved source-critical dependencies require the exact mechanical partial security state.", "Set assessment.state to partial, reasonCode to DEPENDENCY_TARGETS_UNRESOLVED, and sourceCoverage to null; this permits unreviewed materialization but grants no approval.", "security-evidence");
  } else if (dependencyDisposition?.state === "VERIFIED" && securityAssessment?.assessment?.state !== "source-assessed") {
    add("blocker", "APPLICATION_SECURITY_SOURCE_ASSESSMENT_REQUIRED", "$.securityAssessment.assessment.state", "Fully dereferenced source materialization requires an explicit source-assessed security state.", "Assess the complete content-addressed source closure.", "security-evidence");
  } else if (dependencyDisposition === null && securityAssessment?.assessment?.state !== "source-assessed") {
    add("blocker", "APPLICATION_SECURITY_SOURCE_ASSESSMENT_REQUIRED", "$.securityAssessment.assessment.state", "Public application materialization requires exact dependency-aware source security evidence.", "Replay the complete content-addressed source closure with the current verifier.", "security-evidence");
  }
  validateGeneratorDerivedSecurityArtifacts(generatedApplication, securityAssessment, add);

  const securityAnalysis = analyzeOpenWorldSecurity(securityAssessment);
  const confirmedIntentRedesign = securityAnalysis.findings.filter((finding) => (
    finding.outcome === "SAFE_REDESIGN"
    && (
      (
        applicationHasConfirmedOwnerIntent(generatedApplication)
        && findingHasConfirmedUnsafeIntent(securityAssessment, finding.code)
      )
      || findingIsConfirmedAutomatedDrainOrDeception(finding)
    )
  ));
  const confirmedIntentCodes = new Set(confirmedIntentRedesign.map(({ code }) => code));
  for (const finding of confirmedIntentRedesign) {
    add(
      "blocker",
      "APPLICATION_SECURITY_CONFIRMED_REDESIGN_REQUIRED",
      `$.securityAssessment.layers.intent.${finding.code}`,
      "The owner-confirmed design explicitly selects a mechanism that violates a non-waivable value, authorization, solvency, settlement, or exit invariant.",
      "Preserve the product goal, redesign the unsafe mechanism, and assess the exact new source revision; no builder-owned waiver can authorize it.",
      "security-evidence",
      { securityCode: finding.code, outcome: finding.outcome }
    );
  }
  for (const finding of securityAnalysis.findings) {
    if (confirmedIntentCodes.has(finding.code)) continue;
    add(
      "review",
      "APPLICATION_SECURITY_INDEPENDENT_REVIEW_REQUIRED",
      `$.securityAssessment.findings.${finding.code}`,
      "An exact security observation, conflict, automated finding, trust dependency, or unresolved boundary requires independent review.",
      "Carry the original evidence and finding into review; do not self-waive it, but do not reject the underlying product idea solely from an automated or disputed conclusion.",
      "security-evidence",
      { securityCode: finding.code, outcome: finding.outcome }
    );
  }
  const sourceDependencyReviewRequired = Array.isArray(sourceCoverage)
    && sourceCoverage.some((coverage) => (
      Number.isSafeInteger(coverage?.verificationReport?.dependencyPointerCoverage?.counts?.gitLfs)
      && coverage.verificationReport.dependencyPointerCoverage.counts.gitLfs > 0
    ));
  if (sourceDependencyReviewRequired) {
    add(
      "review",
      "APPLICATION_SOURCE_DEPENDENCY_REPRO_REVIEW_REQUIRED",
      "$.sourceCoverage",
      "One or more Git LFS targets were matched only to local stable bytes; public availability and independent reproducibility remain unverified.",
      "Keep the application reviewable, but require independent source-dependency review and replace each pointer with a normal Git blob or a versioned content-bound public availability proof before launch.",
      "source-dependency-availability",
      {
        verificationScope: "LOCAL_STABLE_BYTES_ONLY",
        availabilityVerified: false,
        reproducibilityVerified: false
      }
    );
  }
  validateGeneratorSourceCoverage(generatedApplication, securityAssessment, sourceCoverage, add, {
    dependencyPartial
  });
  validateGeneratorSecurityEvidenceBindings(generatedApplication, securityAssessment, securityEvidenceBindings, add);

  const privacyHeld = findingsHavePrivacyHold(findings);
  const securityReviewRequired = securityAnalysis.findings.length > 0 && confirmedIntentRedesign.length === 0;
  const generatedReport = finalizeReport("public-pr-application-v3-generation", findings, {
    applicationContract: "public-pr-application-v3",
    ideaEligibility: "ELIGIBLE_FOR_REVIEW",
    publicApplicationEligibility: privacyHeld ? "HELD_FOR_PRIVACY_REDACTION" : "ELIGIBLE_FOR_REVIEW",
    approvalGranted: false,
    launchAuthorizationGranted: false,
    implementationAuthorizationGranted: false,
    securityDisposition: confirmedIntentRedesign.length > 0
      ? "REDESIGN_REQUIRED"
      : securityReviewRequired
        ? "HELD_FOR_INDEPENDENT_SECURITY_REVIEW"
        : "VALID_FOR_REVIEW",
    sourceDependencyDisposition: sourceDependencyReviewRequired
      ? "HELD_FOR_INDEPENDENT_SOURCE_REVIEW"
      : "NO_LOCAL_ONLY_DEPENDENCY_TARGETS",
    sourceCoverageVerified: findings.every(({ code }) => !code.startsWith("APPLICATION_SOURCE_COVERAGE_")),
    securityRoute: securityAnalysis.route
  });
  const statusReport = {
    ...generatedReport,
    status: generatedReport.valid && sourceDependencyReviewRequired
      ? "HELD_FOR_INDEPENDENT_SOURCE_REVIEW"
      : generatedReport.valid && securityReviewRequired
      ? "HELD_FOR_INDEPENDENT_SECURITY_REVIEW"
      : generatedReport.valid
        ? "VALID_FOR_REVIEW"
        : generatedReport.status
  };
  const report = privacyHeld ? privacySafeReport(statusReport) : statusReport;
  return {
    application: privacyHeld ? null : generatedApplication,
    securityAnalysis: privacyHeld ? privacySafeSecuritySummary(securityAnalysis) : securityAnalysis,
    report,
    materializationAllowed: !privacyHeld && report.valid
  };
}

function applicationHasConfirmedOwnerIntent(application) {
  const intent = application?.intentCapture;
  const facts = Array.isArray(intent?.facts) ? intent.facts : [];
  return intent?.captureStatus === "captured-verbatim-public-safe"
    && intent?.agentInterpretationStatus === "owner-confirmed"
    && Array.isArray(intent?.unresolvedMaterialDecisions)
    && intent.unresolvedMaterialDecisions.length === 0
    && facts.length > 0
    && facts.every((fact) => fact?.provenance === "owner-stated" && fact?.confirmationStatus === "confirmed")
    && application?.fidelity?.status === "complete";
}

function findingHasConfirmedUnsafeIntent(securityAssessment, code) {
  const signal = confirmedUnsafeIntentSignals[code];
  if (!signal) return false;
  const profile = securityAssessment?.layers?.intent?.[signal.profile];
  if (!isObject(profile) || !signal.values.includes(profile[signal.field])) return false;
  if (!Object.entries(signal.requires ?? {}).every(([field, expected]) => profile[field] === expected)) return false;
  return !Array.isArray(signal.requiresAny)
    || signal.requiresAny.some((requirement) => (
      isObject(requirement)
      && Array.isArray(requirement.values)
      && requirement.values.includes(profile[requirement.field])
    ));
}

function findingIsConfirmedAutomatedDrainOrDeception(finding) {
  return finding?.code === "AUTOMATED_CONFIRMED_DRAIN_OR_DECEPTION"
    && ["builder-confirmed", "reviewer-confirmed"].includes(finding.confirmationStatus)
    && ["drain", "deception"].includes(finding.objectiveCategory)
    && finding.scopeMatched === true;
}

function validateGeneratorDerivedSecurityArtifacts(application, securityAssessment, add) {
  const security = application?.securityBindings;
  const records = Array.isArray(application?.reviewPackage?.records) ? application.reviewPackage.records : [];
  let schemaBytes;
  let assessmentBytes;
  try {
    schemaBytes = Buffer.from(`${canonicalJson(securityAssessmentSchema)}\n`, "utf8");
    assessmentBytes = Buffer.from(`${canonicalJson(securityAssessment)}\n`, "utf8");
  } catch {
    add("blocker", "APPLICATION_DERIVED_SECURITY_ARTIFACT_INVALID", "$.securityAssessment", "Derived security artifacts are not canonical JSON values.", "Regenerate the exact schema and assessment after pinning source.", "security-evidence");
    return;
  }
  const expected = {
    securityAssessmentSchemaPath: "security-assessment-v1.schema.json",
    securityAssessmentSchemaRepositoryRef: null,
    securityAssessmentSchemaSha256: sha256Bytes(schemaBytes),
    securityAssessmentSchemaByteLength: schemaBytes.length,
    securityAssessmentPath: "security-assessment.v1.json",
    securityAssessmentRepositoryRef: null,
    securityAssessmentSha256: sha256Bytes(assessmentBytes),
    securityAssessmentByteLength: assessmentBytes.length
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (security?.[field] !== expectedValue) {
      add("blocker", "APPLICATION_DERIVED_SECURITY_BINDING_MISMATCH", `$.application.securityBindings.${field}`, "Security schema or assessment binding does not match the exact canonical derived application-package bytes.", "Materialize both artifacts after the source commit exists, then copy their exact paths, hashes, and byte lengths.", "security-evidence");
    }
  }
  for (const artifact of [
    {
      kind: "security-assessment-schema",
      path: expected.securityAssessmentSchemaPath,
      sha256: expected.securityAssessmentSchemaSha256,
      byteLength: expected.securityAssessmentSchemaByteLength
    },
    {
      kind: "security-assessment",
      path: expected.securityAssessmentPath,
      sha256: expected.securityAssessmentSha256,
      byteLength: expected.securityAssessmentByteLength
    }
  ]) {
    const matches = records.filter((record) => (
      record.kind === artifact.kind
      && record.source === "application-package"
      && record.repositoryRef === null
      && record.path === artifact.path
      && record.sha256 === artifact.sha256
      && record.byteLength === artifact.byteLength
    ));
    if (matches.length !== 1) {
      add("blocker", "APPLICATION_DERIVED_SECURITY_RECORD_MISMATCH", "$.application.reviewPackage.records", `Derived ${artifact.kind} bytes do not resolve to exactly one application-package review record.`, "Bind each canonical derived artifact exactly once with repositoryRef null.", "security-evidence", { artifactKind: artifact.kind });
    }
  }
}

function validateGeneratorSourceCoverage(application, securityAssessment, sourceCoverage, add, { dependencyPartial = false } = {}) {
  if (!Array.isArray(sourceCoverage) || sourceCoverage.length === 0) {
    add("blocker", "APPLICATION_SOURCE_COVERAGE_MISSING", "$.sourceCoverage", "At least one exact local source-closure verification result is required.", "Verify every declared inline or manifest repository closure at its pinned commit and tree.", "source-closure-binding");
    return;
  }
  const repositories = [application?.source?.primary, ...(application?.source?.companions ?? [])]
    .filter(isObject);
  const repositoriesById = new Map(repositories.map((repository) => [repository.id, repository]));
  const declaredCoverage = securityAssessment?.assessment?.sourceCoverage?.repositories;
  const securityByRepository = new Map((Array.isArray(declaredCoverage) ? declaredCoverage : []).map((binding) => [
    binding?.repositoryRef,
    binding
  ]));
  const observedRepositories = new Set();
  const observedReportPaths = new Set();
  for (const [index, coverage] of sourceCoverage.entries()) {
    const findingPath = `$.sourceCoverage[${index}]`;
    if (!isObject(coverage)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_INVALID", findingPath, "Source coverage record must be one exact object.", "Use the generator's closed source coverage record shape.", "source-closure-binding");
      continue;
    }
    const exactKeys = ["closureSha256", "manifestByteLength", "manifestPath", "manifestSha256", "repositoryRef", "revisionObjectId", "sourceClosureMode", "sourcePaths", "sourcePathsSha256", "treeObjectId", "verificationReport", "verificationReportByteLength", "verificationReportPath", "verificationReportSha256"];
    if (canonicalJson(Object.keys(coverage).sort()) !== canonicalJson(exactKeys)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_INVALID", findingPath, "Source coverage record has missing or unknown fields.", "Use the exact dual-mode repository, closure and derived verification-report record shape.", "source-closure-binding");
      continue;
    }
    const repository = repositoriesById.get(coverage.repositoryRef);
    if (!sourceClosureBindingMatchesRepository(coverage, repository)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_BINDING_MISMATCH", findingPath, "Source coverage does not match one exact application repository commit, tree, and inline or manifest closure identity.", "Verify and bind the exact declared repository closure without changing transport modes or narrowing source paths.", "source-closure-binding");
    }
    if (!sha256Pattern.test(coverage.closureSha256 ?? "")) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_CLOSURE_DIGEST_INVALID", `${findingPath}.closureSha256`, "Source coverage lacks the exact verified logical closure digest.", "Bind the closure digest emitted by the exact read-only verifier run.", "source-closure-binding");
    }
    if (observedRepositories.has(coverage.repositoryRef)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_DUPLICATE", `${findingPath}.repositoryRef`, "One repository closure is covered more than once.", "Keep exactly one verification result per repository closure.", "source-closure-binding");
    }
    observedRepositories.add(coverage.repositoryRef);
    if (observedReportPaths.has(coverage.verificationReportPath)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_REPORT_PATH_DUPLICATE", `${findingPath}.verificationReportPath`, "Each repository closure must have one distinct derived verification report path.", "Materialize a separate application-package report per repository.", "source-closure-binding");
    }
    observedReportPaths.add(coverage.verificationReportPath);

    const securityRepository = securityByRepository.get(coverage.repositoryRef);
    if (!dependencyPartial && !securityCoverageMatchesGeneratorCoverage(securityRepository, coverage)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_SECURITY_BINDING_MISSING", findingPath, "Local repository, commit, tree, closure identity, closure digest, report bytes, or result does not match one exact security assessment coverage tuple.", "Persist the identical one-to-one tuple in assessment.sourceCoverage.repositories.", "security-evidence");
    }

    const verification = coverage.verificationReport;
    if (
      !isObject(verification)
      || verification.sourceClosureVerified !== true
      || verification.status !== "VERIFIED"
      || verification.readOnly !== true
      || verification.networkAccessed !== false
      || verification.candidateCodeExecuted !== false
    ) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_NOT_VERIFIED", `${findingPath}.verificationReport`, "Source closure verification is missing, incomplete, review-only, or invalid.", "Run the read-only raw-Git verifier to VERIFIED on the exact pinned repository.", "source-closure-binding");
    }
    if (!verificationSourceBindingMatchesCoverage(verification?.sourceBinding, coverage)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_REPORT_SOURCE_BINDING_MISMATCH", `${findingPath}.verificationReport.sourceBinding`, "The verifier report does not bind the same repository, commit, tree, closure mode, closure identity, and closure digest as its persisted tuple.", "Regenerate the report from the exact pinned repository closure; do not hand-edit or reuse a report from another revision.", "source-closure-binding");
    }
    let verificationBytes = null;
    try {
      verificationBytes = Buffer.from(`${canonicalJson(verification)}\n`, "utf8");
    } catch {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_REPORT_INVALID", `${findingPath}.verificationReport`, "Source closure verification report is not canonical JSON.", "Regenerate the exact read-only verifier report.", "source-closure-binding");
    }
    if (
      !safeRepositoryPath(coverage.verificationReportPath)
      || verificationBytes === null
      || coverage.verificationReportSha256 !== sha256Bytes(verificationBytes)
      || coverage.verificationReportByteLength !== verificationBytes.length
    ) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_REPORT_BINDING_MISMATCH", findingPath, "Verification report path, hash, or byte length does not match its exact canonical bytes.", "Materialize the report in the application package and bind its exact canonical bytes.", "source-closure-binding");
    }
    const verificationRecords = (application?.reviewPackage?.records ?? []).filter((record) => (
      record.kind === "source-closure-verification"
      && record.source === "application-package"
      && record.repositoryRef === null
      && record.path === coverage.verificationReportPath
      && record.sha256 === coverage.verificationReportSha256
      && record.byteLength === coverage.verificationReportByteLength
    ));
    if (verificationRecords.length !== 1) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_REPORT_RECORD_MISMATCH", findingPath, "Verification report does not resolve to exactly one application-package review record.", "Bind each derived verifier report exactly once with repositoryRef null.", "source-closure-binding");
    }
    if (!(securityAssessment?.assessment?.evidenceRefs ?? []).includes(coverage.verificationReportPath)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_REPORT_SECURITY_REF_MISSING", findingPath, "Security assessment does not cite the derived source-verification report.", "Add the exact application-package report path to assessment.evidenceRefs and bind it to its review record.", "security-evidence");
    }
    const persistedReports = (application?.source?.verificationReports ?? []).filter((binding) => (
      persistedCoverageMatchesGeneratorCoverage(binding, coverage)
    ));
    if (persistedReports.length !== 1) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_PERSISTED_MAPPING_MISMATCH", findingPath, "Generator evidence does not match exactly one persisted application source-verification association.", "Persist the one-to-one repository, commit, tree, root, closure, report, and result mapping in source.verificationReports.", "source-closure-binding");
    }
  }
  for (const binding of Array.isArray(declaredCoverage) ? declaredCoverage : []) {
    if (isObject(binding) && !observedRepositories.has(binding.repositoryRef)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_DECLARATION_UNVERIFIED", `$.securityAssessment.assessment.sourceCoverage.repositories.${binding.repositoryRef ?? "unknown"}`, "A declared security repository closure has no exact local verification result.", "Verify every declared repository closure before materialization.", "security-evidence");
    }
  }
  for (const repository of repositories) {
    if (!observedRepositories.has(repository.id)) {
      add("blocker", "APPLICATION_SOURCE_COVERAGE_REPOSITORY_MISSING", "$.sourceCoverage", "One declared repository has no exact verified source closure.", "Verify every primary and companion repository independently.", "source-closure-binding");
    }
  }
}

function securityCoverageMatchesGeneratorCoverage(binding, coverage) {
  if (!isObject(binding) || !isObject(coverage)) return false;
  return binding.repositoryRef === coverage.repositoryRef
    && binding.revisionObjectId === coverage.revisionObjectId
    && binding.treeObjectId === coverage.treeObjectId
    && binding.sourceClosureMode === coverage.sourceClosureMode
    && canonicalJson(binding.sourcePaths) === canonicalJson(coverage.sourcePaths)
    && binding.sourcePathsSha256 === coverage.sourcePathsSha256
    && binding.manifestPath === coverage.manifestPath
    && binding.manifestSha256 === coverage.manifestSha256
    && binding.manifestByteLength === coverage.manifestByteLength
    && binding.closureSha256 === coverage.closureSha256
    && binding.reportPath === coverage.verificationReportPath
    && binding.reportSha256 === coverage.verificationReportSha256
    && binding.reportByteLength === coverage.verificationReportByteLength
    && binding.result === coverage.verificationReport?.status;
}

function persistedCoverageMatchesGeneratorCoverage(binding, coverage) {
  if (!isObject(binding) || !isObject(coverage)) return false;
  return binding.repositoryRef === coverage.repositoryRef
    && binding.revisionObjectId === coverage.revisionObjectId
    && binding.treeObjectId === coverage.treeObjectId
    && binding.sourceClosureMode === coverage.sourceClosureMode
    && canonicalJson(binding.sourcePaths) === canonicalJson(coverage.sourcePaths)
    && binding.sourcePathsSha256 === coverage.sourcePathsSha256
    && binding.manifestPath === coverage.manifestPath
    && binding.manifestSha256 === coverage.manifestSha256
    && binding.manifestByteLength === coverage.manifestByteLength
    && binding.closureSha256 === coverage.closureSha256
    && binding.reportPath === coverage.verificationReportPath
    && binding.reportSha256 === coverage.verificationReportSha256
    && binding.reportByteLength === coverage.verificationReportByteLength
    && binding.result === coverage.verificationReport?.status;
}

function verificationSourceBindingMatchesCoverage(binding, coverage) {
  if (!isObject(binding) || !isObject(coverage)) return false;
  const commonMatches = binding.repositoryRef === coverage.repositoryRef
    && binding.revisionObjectId === coverage.revisionObjectId
    && binding.treeObjectId === coverage.treeObjectId
    && binding.sourceClosureMode === coverage.sourceClosureMode
    && binding.closureSha256 === coverage.closureSha256;
  if (!commonMatches) return false;
  if (coverage.sourceClosureMode === "inline") {
    return canonicalJson(binding.sourcePaths) === canonicalJson(coverage.sourcePaths)
      && binding.sourcePathsSha256 === coverage.sourcePathsSha256
      && (binding.manifestPath === undefined || binding.manifestPath === null)
      && (binding.manifestSha256 === undefined || binding.manifestSha256 === null)
      && (binding.manifestByteLength === undefined || binding.manifestByteLength === null);
  }
  return coverage.sourceClosureMode === "manifest"
    && binding.manifestPath === coverage.manifestPath
    && binding.manifestSha256 === coverage.manifestSha256
    && binding.manifestByteLength === coverage.manifestByteLength
    && (binding.sourcePaths === undefined || (Array.isArray(binding.sourcePaths) && binding.sourcePaths.length === 0))
    && (binding.sourcePathsSha256 === undefined || binding.sourcePathsSha256 === null);
}

function validateGeneratorSecurityEvidenceBindings(application, securityAssessment, securityEvidenceBindings, add) {
  if (!Array.isArray(securityEvidenceBindings)) {
    add("blocker", "APPLICATION_SECURITY_EVIDENCE_BINDINGS_MISSING", "$.securityEvidenceBindings", "Security evidence bindings must be an explicit array.", "Bind every security evidence reference to one exact review record.", "security-evidence");
    return;
  }
  const records = Array.isArray(application?.reviewPackage?.records) ? application.reviewPackage.records : [];
  const evidenceRefs = collectEvidenceRefs(securityAssessment);
  const boundRefs = new Set();
  for (const [index, binding] of securityEvidenceBindings.entries()) {
    const findingPath = `$.securityEvidenceBindings[${index}]`;
    const exactKeys = ["evidenceRef", "kind", "path", "repositoryRef", "sha256", "source"];
    if (!isObject(binding) || canonicalJson(Object.keys(binding).sort()) !== canonicalJson(exactKeys)) {
      add("blocker", "APPLICATION_SECURITY_EVIDENCE_BINDING_INVALID", findingPath, "Security evidence binding has missing or unknown fields.", "Map one evidenceRef to the exact kind, source, repositoryRef, path, and SHA-256 of its review record.", "security-evidence");
      continue;
    }
    if (!evidenceRefs.has(binding.evidenceRef)) {
      add("blocker", "APPLICATION_SECURITY_EVIDENCE_BINDING_UNUSED", `${findingPath}.evidenceRef`, "Security evidence binding references no evidenceRef in the assessment envelope.", "Remove the unused mapping or preserve the actual security observation that cites it.", "security-evidence");
    }
    if (boundRefs.has(binding.evidenceRef)) {
      add("blocker", "APPLICATION_SECURITY_EVIDENCE_BINDING_DUPLICATE", `${findingPath}.evidenceRef`, "One security evidenceRef is mapped more than once.", "Keep one unambiguous exact review-record binding per evidenceRef.", "security-evidence");
    }
    boundRefs.add(binding.evidenceRef);
    const matches = records.filter((record) => (
      record.kind === binding.kind
      && record.source === binding.source
      && record.repositoryRef === binding.repositoryRef
      && record.path === binding.path
      && record.sha256 === binding.sha256
    ));
    if (matches.length !== 1) {
      add("blocker", "APPLICATION_SECURITY_EVIDENCE_RECORD_MISMATCH", findingPath, "Security evidenceRef does not resolve to exactly one bound review record.", "Add or correct the exact content-addressed review record before materialization.", "security-evidence");
    }
  }
  for (const evidenceRef of evidenceRefs) {
    if (!boundRefs.has(evidenceRef)) {
      add("blocker", "APPLICATION_SECURITY_EVIDENCE_REF_UNBOUND", "$.securityAssessment", "A security evidenceRef has no exact review-record binding.", "Map every assessment, layer, profile, and custom-profile evidence reference.", "security-evidence");
    }
  }
}

function collectEvidenceRefs(value) {
  const refs = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (!isObject(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (key === "evidenceRefs" && Array.isArray(child)) {
        for (const ref of child) if (typeof ref === "string") refs.add(ref);
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return refs;
}
