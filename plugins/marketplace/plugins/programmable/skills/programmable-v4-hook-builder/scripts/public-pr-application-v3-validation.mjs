import { canonicalJson, validateAgainstSchema } from "./submission-core.mjs";
import { PROGRAMMABLE_FEE_V2, sha256Bytes } from "./open-world-v2-core.mjs";
import {
  PUBLIC_PR_APPLICATION_V3_REQUIRED_REVIEW_KINDS,
  SOURCE_CLOSURE_MANIFEST_SCHEMA_ID,
  SOURCE_CLOSURE_MANIFEST_VERSION,
  compareUtf8,
  createFindingAdder,
  finalizeReport,
  gitObjectPattern,
  githubRepositoryPattern,
  isObject,
  positiveDecimalPattern,
  readJson,
  safeRepositoryPath,
  sha256Pattern
} from "./public-pr-application-v3-shared.mjs";
import {
  findingsHavePrivacyHold,
  privacySafeReport,
  validatePublicApplicationText
} from "./public-pr-application-v3-privacy.mjs";
import { validateSourceClosure } from "./public-pr-application-v3-source-validation.mjs";

const applicationSchema = readJson(
  new URL("../references/public-pr-application-v3.schema.json", import.meta.url)
);

export function derivePublicPrApplicationV3PreviousBinding({
  application,
  applicationSha256,
  packageSha256
}) {
  const source = application?.source?.primary;
  const policy = application?.policyBindings;
  const submissionStandard = application?.contract?.submissionStandard;
  if (
    application?.contract?.id !== "public-pr-application-v3"
    || application?.contract?.version !== "3.0.0"
    || application?.schemaVersion !== 3
    || !positiveDecimalPattern.test(application?.applicationRevision ?? "")
    || !sha256Pattern.test(applicationSha256 ?? "")
    || !sha256Pattern.test(packageSha256 ?? "")
    || typeof submissionStandard !== "string"
    || !isObject(source)
    || !isObject(policy)
  ) {
    throw new TypeError("immutable predecessor does not satisfy the derivable public-pr-application-v3 lineage contract");
  }
  return Object.freeze({
    applicationContract: application.contract.id,
    applicationSchemaVersion: application.schemaVersion,
    applicationRevision: application.applicationRevision,
    applicationSha256,
    packageSha256,
    sourceNumericRepositoryId: source.numericRepositoryId,
    sourceCommit: source.revisionObjectId,
    sourceTree: source.treeObjectId,
    submissionSchemaId: `urn:programmable:v4-hook-submission:${submissionStandard}`,
    submissionStandard,
    submissionPath: policy.submissionPath,
    submissionSha256: policy.submissionSha256,
    feePolicyId: policy.programmableFeePolicyId,
    feePolicyVersion: policy.programmableFeePolicyVersion,
    feeApplicability: policy.feeApplicability,
    feePolicyInstanceSha256: policy.feePolicyInstanceSha256
  });
}

/**
 * Project the exact added-only path set that one Application V3 pull request
 * would expose. This is intentionally transport-independent so Registry CI can
 * enforce the same uniqueness and review-window invariant as the client.
 */
export function projectPublicPrApplicationV3DiffPaths({
  priorPaths,
  currentPaths,
  maxFiles = 3000
}) {
  if (
    !Array.isArray(priorPaths)
    || !Array.isArray(currentPaths)
    || !Number.isSafeInteger(maxFiles)
    || maxFiles < 1
  ) {
    throw new TypeError("Application V3 diff projection inputs are invalid");
  }
  const combined = [...priorPaths, ...currentPaths];
  if (combined.some((value) => typeof value !== "string" || value.length === 0)) {
    throw new TypeError("Application V3 diff projection contains an invalid path");
  }
  if (new Set(combined).size !== combined.length) {
    const error = new TypeError("Application V3 diff projection contains a duplicate or overlapping path");
    error.code = "APPLICATION_V3_DIFF_PATH_COLLISION";
    throw error;
  }
  if (combined.length > maxFiles) {
    const error = new RangeError("Application V3 diff projection exceeds the exact review window");
    error.code = "APPLICATION_V3_DIFF_REVIEW_BUDGET_EXCEEDED";
    error.projectedFileCount = combined.length;
    error.maxFiles = maxFiles;
    throw error;
  }
  return Object.freeze([...combined].sort(compareUtf8));
}

export function validatePublicPrApplicationV3(application, { schema = applicationSchema } = {}) {
  const findings = [];
  const seen = new Set();
  const add = createFindingAdder(findings, seen);

  for (const finding of validateAgainstSchema(application, schema)) {
    const toolingTransport = finding.path.includes(".sourcePaths") && finding.code === "SCHEMA_MAX_ITEMS";
    add(
      "blocker",
      finding.code,
      finding.path,
      finding.message,
      toolingTransport
        ? "Use the content-addressed sourceManifest mode or split the tooling review; the product idea remains eligible."
        : "Make the application match the closed public-pr-application-v3 contract.",
      toolingTransport ? "tooling-transport" : "application-contract"
    );
  }

  if (!isObject(application)) {
    return applicationReport(findings);
  }

  validatePublicApplicationText(application, add);
  validateLineage(application.lineage, application.applicationRevision, add);
  validateIntentAndFidelity(application.intentCapture, application.fidelity, add);
  validatePolicyBindings(application.policyBindings, application.stage, add);
  validateReviewPackage(application.reviewPackage, application.policyBindings, application.stage, application.intentCapture, add);
  validateSecurityBindings(application.securityBindings, application.reviewPackage, add);
  validateReviewState(application.reviewState, application.declarations, add);
  validateSourceClosure(
    application.source,
    application.policyBindings,
    application.securityBindings,
    application.intentCapture,
    application.reviewPackage,
    add
  );

  return applicationReport(findings);
}

function validateLineage(lineage, applicationRevision, add) {
  if (!isObject(lineage)) return;
  if (!positiveDecimalPattern.test(applicationRevision ?? "")) {
    add("blocker", "APPLICATION_REVISION_INVALID", "$.applicationRevision", "Application revision must be one canonical positive decimal string.", "Emit the exact decimal revision without Number coercion, leading zeroes, exponents, or a numeric cap.", "lineage");
    return;
  }
  if (lineage.kind === "new" && lineage.previous !== null) {
    add("blocker", "APPLICATION_LINEAGE_NEW_HAS_PREVIOUS", "$.lineage.previous", "A new application cannot claim a previous application.", "Set previous to null or select the exact update lineage.", "lineage");
  }
  if (lineage.kind === "new" && applicationRevision !== "1") {
    add("blocker", "APPLICATION_LINEAGE_NEW_REVISION_INVALID", "$.applicationRevision", "A new application starts at canonical revision 1.", "Use revision \"1\"; later changes increment from exact lineage.", "lineage");
  }
  if (lineage.kind !== "new" && !isObject(lineage.previous)) {
    add("blocker", "APPLICATION_LINEAGE_PREVIOUS_MISSING", "$.lineage.previous", "An update, migration, or recheck must bind its exact previous application.", "Add the immutable previous application, package, source, submission, and historical fee projection bindings.", "lineage");
    return;
  }
  if (lineage.kind !== "new") {
    const previousContract = lineage.previous?.applicationContract;
    const previousSchemaVersion = lineage.previous?.applicationSchemaVersion;
    if (
      !new Set(["public-pr-application-v2", "public-pr-application-v3"]).has(previousContract)
      || (previousContract === "public-pr-application-v2" && previousSchemaVersion !== 2)
      || (previousContract === "public-pr-application-v3" && previousSchemaVersion !== 3)
    ) {
      add("blocker", "APPLICATION_LINEAGE_PREVIOUS_CONTRACT_INVALID", "$.lineage.previous.applicationContract", "Previous application contract and schema version must select one exact supported V2 or V3 lineage shape.", "Use an authenticated public-pr-application-v2 schema migration or the complete derived public-pr-application-v3 predecessor binding.", "lineage");
    }
    const previousRevision = lineage.previous?.applicationRevision;
    if (!positiveDecimalPattern.test(previousRevision ?? "")) {
      add("blocker", "APPLICATION_LINEAGE_PREVIOUS_REVISION_INVALID", "$.lineage.previous.applicationRevision", "Previous application revision must be one canonical positive decimal string.", "Preserve the exact historical decimal revision without Number coercion.", "lineage");
    } else if (applicationRevision !== incrementCanonicalDecimal(previousRevision)) {
      add("blocker", "APPLICATION_LINEAGE_REVISION_SEQUENCE_INVALID", "$.applicationRevision", "Application revision must be exactly the prior canonical decimal revision plus one.", "Increment the exact decimal string with arbitrary-precision semantics and regenerate all revision-bound evidence.", "lineage");
    }
  }
}

function incrementCanonicalDecimal(value) {
  const digits = [...value];
  let carry = 1;
  for (let index = digits.length - 1; index >= 0 && carry === 1; index -= 1) {
    if (digits[index] === "9") {
      digits[index] = "0";
    } else {
      digits[index] = String(Number(digits[index]) + 1);
      carry = 0;
    }
  }
  if (carry === 1) digits.unshift("1");
  return digits.join("");
}

function validateIntentAndFidelity(intent, fidelity, add) {
  if (!isObject(intent)) return;
  const facts = Array.isArray(intent.facts) ? intent.facts : [];
  const factIds = new Set();
  for (const [index, fact] of facts.entries()) {
    if (!isObject(fact)) continue;
    if (factIds.has(fact.id)) {
      add("blocker", "APPLICATION_INTENT_FACT_ID_DUPLICATE", `$.intentCapture.facts[${index}].id`, "Intent fact IDs must be unique.", "Merge duplicate facts or assign distinct stable IDs.", "intent-provenance");
    }
    factIds.add(fact.id);
    if (["legacy-declared", "agent-derived"].includes(fact.provenance) && fact.confirmationStatus !== "unconfirmed") {
      add("blocker", "APPLICATION_DERIVED_FACT_CONFIRMATION_INVALID", `$.intentCapture.facts[${index}].confirmationStatus`, "Legacy or agent-derived prose cannot inherit or invent owner confirmation.", "Keep the fact unconfirmed until the owner supplies a new, attributable confirmation.", "intent-provenance");
    }
  }

  if (intent.captureStatus === "captured-verbatim-public-safe") {
    if (intent.originalIdeaDisplayExcerpt !== null && (typeof intent.originalIdeaDisplayExcerpt !== "string" || intent.originalIdeaDisplayExcerpt.trim().length === 0)) {
      add("blocker", "APPLICATION_IDEA_DISPLAY_EXCERPT_INVALID", "$.intentCapture.originalIdeaDisplayExcerpt", "The optional non-normative display excerpt must be null or non-empty text.", "Keep the content-addressed idea-source artifact as the sole normative intent truth.", "intent-privacy");
    }
  } else if (intent.captureStatus === "redacted-sensitive") {
    if (intent.originalIdeaDisplayExcerpt !== null || intent.agentInterpretationStatus !== "unconfirmed") {
      add("blocker", "APPLICATION_REDACTED_INTENT_STATE_INVALID", "$.intentCapture", "Redacted intent must keep its display excerpt null and agent interpretation unconfirmed.", "Remove sensitive prose and keep derived facts unconfirmed.", "intent-privacy");
    }
  } else if (intent.captureStatus === "unavailable-legacy") {
    if (intent.originalIdeaDisplayExcerpt !== null || intent.agentInterpretationStatus !== "unconfirmed") {
      add("blocker", "APPLICATION_LEGACY_INTENT_STATE_INVALID", "$.intentCapture", "Unavailable legacy intent must keep its display excerpt null and remain unconfirmed.", "Recapture the owner intent in a new revision; never infer confirmation from legacy prose.", "intent-provenance");
    }
    if (facts.some((fact) => fact?.confirmationStatus !== "unconfirmed")) {
      add("blocker", "APPLICATION_LEGACY_FACT_CONFIRMATION_INVALID", "$.intentCapture.facts", "Every unavailable-legacy fact must remain unconfirmed.", "Recapture owner intent before confirming any migrated fact.", "intent-provenance");
    }
    if (
      !isObject(fidelity)
      || fidelity.status !== "unassessed"
      || fidelity.reasonCode !== "ORIGINAL_INTENT_UNAVAILABLE"
      || !Array.isArray(fidelity.requirementBindings)
      || fidelity.requirementBindings.length !== 0
    ) {
      add("blocker", "APPLICATION_LEGACY_FIDELITY_INVALID", "$.fidelity", "Fidelity must remain unassessed when original owner intent is unavailable.", "Recapture and confirm intent before creating requirement bindings or a fidelity result.", "intent-fidelity");
    }
  }
}

function validatePolicyBindings(policy, stage, add) {
  if (!isObject(policy)) return;
  for (const [field, expected] of Object.entries({
    feePolicySchemaId: PROGRAMMABLE_FEE_V2.policySchemaId,
    programmableFeePolicyId: PROGRAMMABLE_FEE_V2.policyId,
    programmableFeePolicyVersion: PROGRAMMABLE_FEE_V2.policyVersion,
    programmableFeePolicyHashPreimage: PROGRAMMABLE_FEE_V2.policyHashPreimage,
    programmableFeePolicyHash: PROGRAMMABLE_FEE_V2.policyHash
  })) {
    if (policy[field] !== expected) {
      add("blocker", "APPLICATION_FEE_V2_BINDING_INVALID", `$.policyBindings.${field}`, "New v3 applications must bind the exact active Fee V2 policy; Fee V1 is historical lineage only.", "Use the exact versioned Fee V2 constants and preserve older policy data only under lineage.previous.", "fee-policy");
    }
  }
  const instanceFields = [
    policy.feePolicyInstancePath,
    policy.feePolicyInstanceRepositoryRef,
    policy.feePolicyInstanceSha256
  ];
  if (stage === "proposal" && policy.feeApplicability !== "unresolved") {
    add("blocker", "APPLICATION_PROPOSAL_FEE_APPLICABILITY_INVALID", "$.policyBindings.feeApplicability", "A proposal must keep Fee applicability unresolved until exact prototype execution scopes exist.", "Use unresolved with all feePolicyInstance fields null.", "fee-policy-role-separation");
  }
  if (stage === "prototype" && policy.feeApplicability === "unresolved") {
    add("blocker", "APPLICATION_PROTOTYPE_FEE_APPLICABILITY_UNRESOLVED", "$.policyBindings.feeApplicability", "A prototype cannot leave Fee applicability unresolved.", "Revalidate the exact bound V2 source package and select applicable or exact zero-scope not-applicable.", "fee-policy-role-separation");
  }
  if (policy.feeApplicability === "applicable" && instanceFields.some((value) => value === null)) {
    add("blocker", "APPLICATION_PROTOTYPE_FEE_INSTANCE_REQUIRED", "$.policyBindings", "An applicable prototype must bind one real scoped Fee V2 policy instance.", "Create fee-policy.v2.json with exact scopes and bind its repository, path, and hash.", "fee-policy-role-separation");
  }
  if (policy.feeApplicability !== "applicable" && instanceFields.some((value) => value !== null)) {
    const code = policy.feeApplicability === "not-applicable"
      ? "APPLICATION_FEE_NOT_APPLICABLE_INSTANCE_FORBIDDEN"
      : "APPLICATION_PROPOSAL_FEE_INSTANCE_FORBIDDEN";
    add("blocker", code, "$.policyBindings", "A non-applicable or unresolved Fee state cannot carry a scoped Fee V2 instance binding.", "Keep all feePolicyInstance fields null unless the exact bound V2 package derives applicable.", "fee-policy-role-separation");
  }
  if (policy.feePolicySchemaPath === policy.feePolicyInstancePath && policy.feePolicyInstancePath !== null) {
    add("blocker", "APPLICATION_FEE_SCHEMA_INSTANCE_ROLE_COLLISION", "$.policyBindings", "Fee policy schema and scoped instance cannot share one path.", "Use fee-policy-v2.schema.json for schema bytes and fee-policy.v2.json for the real instance.", "fee-policy-role-separation");
  }
}

function validateReviewPackage(reviewPackage, policy, stage, intent, add) {
  if (!isObject(reviewPackage)) return;
  if (canonicalJson(reviewPackage.requiredKinds) !== canonicalJson(PUBLIC_PR_APPLICATION_V3_REQUIRED_REVIEW_KINDS)) {
    add("blocker", "APPLICATION_REVIEW_REQUIRED_KINDS_INVALID", "$.reviewPackage.requiredKinds", "The semantic review-kind contract is missing, reordered, or expanded as if optional records were mandatory.", "Use the exact required-kind list; add novel evidence as extra open records.", "review-package");
  }
  const records = Array.isArray(reviewPackage.records) ? reviewPackage.records : [];
  const kinds = new Set(records.map((record) => record?.kind));
  for (const kind of PUBLIC_PR_APPLICATION_V3_REQUIRED_REVIEW_KINDS) {
    if (!kinds.has(kind)) {
      add("blocker", "APPLICATION_REVIEW_RECORD_KIND_MISSING", "$.reviewPackage.records", `Required semantic review record ${kind} is missing.`, "Bind at least one exact record of every required semantic kind.", "review-package", { requiredKind: kind });
    }
  }
  const recordIdentities = new Set();
  for (const [index, record] of records.entries()) {
    if (!isObject(record)) continue;
    const identity = `${record.source}:${record.repositoryRef ?? "application-package"}:${record.path}`;
    if (recordIdentities.has(identity)) {
      add("blocker", "APPLICATION_REVIEW_RECORD_DUPLICATE", `$.reviewPackage.records[${index}]`, "A review package path is bound more than once for the same source.", "Keep one content-addressed record per source and path.", "review-package");
    }
    recordIdentities.add(identity);
    if (!Number.isSafeInteger(record.byteLength) || record.byteLength < 1) {
      add("blocker", "APPLICATION_REVIEW_RECORD_SIZE_INVALID", `$.reviewPackage.records[${index}].byteLength`, "Review record byteLength must be one positive safe integer.", "Bind the exact byte length without losing integer precision.", "review-package");
    }
  }
  if (isObject(intent)) {
    const ideaSourceRecord = records.find((record) => (
      record?.kind === "idea-source"
      && record?.source === "source-repository"
      && record?.repositoryRef === intent.ideaSourceRepositoryRef
      && record?.path === intent.ideaSourcePath
      && record?.sha256 === intent.ideaSourceSha256
    ));
    if (!ideaSourceRecord) {
      add("blocker", "APPLICATION_IDEA_SOURCE_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "Normative idea-source path and hash do not match an exact review record.", "Bind intentCapture to the same content-addressed idea-source artifact used by review.", "intent-provenance");
    }
  }
  if (isObject(policy)) {
    const feeSchemaRecord = records.find((record) => (
      record?.kind === "fee-policy-schema"
      && record?.source === "source-repository"
      && record?.repositoryRef === policy.feePolicySchemaRepositoryRef
      && record?.path === policy.feePolicySchemaPath
      && record?.sha256 === policy.feePolicySchemaSha256
    ));
    if (!feeSchemaRecord) {
      add("blocker", "APPLICATION_FEE_SCHEMA_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "The Fee V2 schema path and hash do not match a source-repository fee-policy-schema record.", "Bind the same exact immutable schema bytes in policyBindings and reviewPackage.records.", "fee-policy-role-separation");
    }
    const feeInstanceRecords = records.filter((record) => record?.kind === "fee-policy");
    if (stage === "prototype" && policy.feeApplicability === "applicable") {
      const matchingFeeInstanceRecords = feeInstanceRecords.filter((record) => (
        record?.kind === "fee-policy"
        && record?.source === "source-repository"
        && record?.repositoryRef === policy.feePolicyInstanceRepositoryRef
        && record?.path === policy.feePolicyInstancePath
        && record?.sha256 === policy.feePolicyInstanceSha256
      ));
      if (feeInstanceRecords.length !== 1 || matchingFeeInstanceRecords.length !== 1) {
        add("blocker", "APPLICATION_FEE_INSTANCE_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "The prototype Fee V2 instance does not match an exact source-repository fee-policy record.", "Bind the real scoped fee-policy.v2.json instance, never the schema bytes.", "fee-policy-role-separation");
      }
    } else if (feeInstanceRecords.length !== 0) {
      const code = policy.feeApplicability === "not-applicable"
        ? "APPLICATION_FEE_NOT_APPLICABLE_REVIEW_RECORD_FORBIDDEN"
        : "APPLICATION_FEE_UNRESOLVED_REVIEW_RECORD_FORBIDDEN";
      add("blocker", code, "$.reviewPackage.records", "A non-applicable or unresolved Fee state cannot carry a fee-policy review record.", "Remove every fee-policy record unless the exact bound V2 package derives applicable.", "fee-policy-role-separation");
    }
  }
}

function validateSecurityBindings(security, reviewPackage, add) {
  if (!isObject(security)) return;
  if (security.securityAssessmentSchemaId !== "urn:programmable:open-world-security:1.0.0") {
    add("blocker", "APPLICATION_SECURITY_SCHEMA_ID_INVALID", "$.securityBindings.securityAssessmentSchemaId", "Security assessment must bind the stable open-world security schema URN.", "Use urn:programmable:open-world-security:1.0.0 and exact schema bytes.", "security-role-separation");
  }
  if (security.securityAssessmentSchemaPath === security.securityAssessmentPath) {
    add("blocker", "APPLICATION_SECURITY_SCHEMA_INSTANCE_ROLE_COLLISION", "$.securityBindings", "Security schema and assessment instance cannot share one path.", "Use security-assessment-v1.schema.json for schema bytes and security-assessment.v1.json for the instance.", "security-role-separation");
  }
  const records = Array.isArray(reviewPackage?.records) ? reviewPackage.records : [];
  const schemaRecord = records.find((record) => (
    record?.kind === "security-assessment-schema"
    && record?.source === "application-package"
    && record?.repositoryRef === null
    && record?.path === security.securityAssessmentSchemaPath
    && record?.sha256 === security.securityAssessmentSchemaSha256
    && record?.byteLength === security.securityAssessmentSchemaByteLength
  ));
  if (!schemaRecord) {
    add("blocker", "APPLICATION_SECURITY_SCHEMA_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "Security schema path, hash, and byte length do not match one application-package schema record.", "Bind the exact stable schema bytes in the derived application package.", "security-role-separation");
  }
  const assessmentRecord = records.find((record) => (
    record?.kind === "security-assessment"
    && record?.source === "application-package"
    && record?.repositoryRef === null
    && record?.path === security.securityAssessmentPath
    && record?.sha256 === security.securityAssessmentSha256
    && record?.byteLength === security.securityAssessmentByteLength
  ));
  if (!assessmentRecord) {
    add("blocker", "APPLICATION_SECURITY_ASSESSMENT_REVIEW_BINDING_MISMATCH", "$.reviewPackage.records", "Derived security assessment path and hash do not match one application-package security-assessment record.", "Create the assessment only after pinning source, then bind its exact application-package bytes with repositoryRef null.", "security-role-separation");
  }
  if (security.securityAssessmentRepositoryRef !== null) {
    add("blocker", "APPLICATION_SECURITY_ASSESSMENT_SELF_REFERENCE_FORBIDDEN", "$.securityBindings.securityAssessmentRepositoryRef", "A source-assessed instance cannot live in the source commit whose identity it contains.", "Keep the stable schema in source, but materialize the derived assessment in the application package with repositoryRef null.", "security-role-separation");
  }
  if (security.securityAssessmentSchemaRepositoryRef !== null) {
    add("blocker", "APPLICATION_SECURITY_SCHEMA_SOURCE_BINDING_FORBIDDEN", "$.securityBindings.securityAssessmentSchemaRepositoryRef", "The security schema used for the derived assessment must travel in the same application package, not claim membership in the pinned source closure.", "Bind the exact bundled schema bytes with repositoryRef null.", "security-role-separation");
  }
}

function validateReviewState(reviewState, declarations, add) {
  if (
    !isObject(reviewState)
    || reviewState.status !== "unreviewed"
    || reviewState.inheritedApproval !== false
    || reviewState.acceptancePath !== null
    || reviewState.acceptanceSha256 !== null
  ) {
    add("blocker", "APPLICATION_REVIEW_STATE_INVALID", "$.reviewState", "A submitted v3 application must be unreviewed and cannot inherit or invent acceptance.", "Reset review state; only maintainers create a separate acceptance after review.", "approval-boundary");
  }
  if (
    !isObject(declarations)
    || declarations.noApprovalClaim !== true
    || declarations.noInheritedApproval !== true
    || declarations.historicalEvidencePreserved !== true
  ) {
    add("blocker", "APPLICATION_APPROVAL_DECLARATION_INVALID", "$.declarations", "The application must disclaim approval, forbid inherited approval, and preserve historical evidence.", "Restore all approval-boundary declarations to true.", "approval-boundary");
  }
}


function applicationReport(findings) {
  const privacyHeld = findingsHavePrivacyHold(findings);
  const report = finalizeReport("public-pr-application-v3-validation", findings, {
    applicationContract: "public-pr-application-v3",
    ideaEligibility: "ELIGIBLE_FOR_REVIEW",
    publicApplicationEligibility: privacyHeld ? "HELD_FOR_PRIVACY_REDACTION" : "ELIGIBLE_FOR_REVIEW",
    approvalGranted: false
  });
  const statusReport = {
    ...report,
    status: privacyHeld ? "HELD_FOR_PRIVACY_REDACTION" : report.status
  };
  return privacyHeld ? privacySafeReport(statusReport) : statusReport;
}
