import { parseBoundedStrictJson } from "./strict-json-core.mjs";
import {
  FEE_POLICY_V2_HASH,
  FEE_POLICY_V2_HASH_PREIMAGE,
  FEE_POLICY_V2_ID,
  FEE_POLICY_V2_VERSION,
  validateFeePolicyV2
} from "./fee-policy-v2-core.mjs";
import { deriveOpenWorldV2FeeApplicability, validateOpenWorldV2Package } from "./open-world-v2-core.mjs";
import { TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID } from "./trade-capability-manifest-core.mjs";
import { validatePublicPrApplicationV3, verifyBoundSourceClosureManifestV1 } from "./public-pr-application-v3-core.mjs";
import {
  APPLICATION_V3_SCHEMA_ID,
  ARCHITECTURE_DECISIONS_V1_SCHEMA_ID,
  EXECUTION_SURFACE_COVERAGE_V1_SCHEMA_ID,
  FEE_POLICY_V2_SCHEMA_ID,
  GIT_OBJECT_PATTERN,
  IDEA_SOURCE_V1_SCHEMA_ID,
  INTENT_CONTRACT_V1_SCHEMA_ID,
  INTENT_FIDELITY_V1_SCHEMA_ID,
  PROGRAMMABLE_FEE_RECIPIENT,
  REGISTRY_ACCEPTANCE_V3_PATH_PATTERN,
  REGISTRY_ACCEPTANCE_V3_SCHEMA_ID,
  SAFE_PATH_PATTERN,
  SECURITY_V1_SCHEMA_ID,
  SHA256_PATTERN,
  SUBMISSION_V2_SCHEMA_ID,
  addConflict,
  addUnresolved,
  bindDeclaredEvidence,
  exact,
  gitBlobObjectIdUtf8,
  isObject,
  registryAcceptanceV3Schema,
  requireEqual,
  sha256Utf8,
  tradeCapabilitySupportingRecords,
  validSlug,
  validSource
} from "./launch-bundle-v2-shared.mjs";

export function collectSourceSnapshots(sourceValue, sourceTracker, conflicts) {
  const sources = Array.isArray(sourceValue) ? sourceValue : [];
  const ids = new Set();
  const identities = new Set();
  const output = [];
  for (const [index, source] of sources.entries()) {
    const path = `$.sources[${index}]`;
    if (!validSource(source)) continue;
    if (ids.has(source.id)) {
      addConflict(conflicts, sourceTracker, "SOURCE_ID_DUPLICATE", `${path}.id`, `Duplicate source id ${source.id}.`);
      continue;
    }
    ids.add(source.id);
    const identity = `${source.numericRepositoryId}:${source.revisionObjectId}:${source.treeObjectId}`;
    if (identities.has(identity)) {
      addConflict(conflicts, sourceTracker, "SOURCE_SNAPSHOT_DUPLICATE", path, "The same repository revision and tree are declared more than once.");
      continue;
    }
    identities.add(identity);
    output.push({
      id: source.id,
      repositoryUri: source.repositoryUri,
      numericRepositoryId: source.numericRepositoryId,
      revisionObjectId: source.revisionObjectId,
      treeObjectId: source.treeObjectId
    });
  }
  return output.sort((left, right) => left.id.localeCompare(right.id));
}

export function collectArtifacts(artifactsValue, sourceMap, trackers) {
  const documents = {};
  const bindingSummaries = [];
  const evidenceIndex = new Map();
  const tradeCapabilityRecords = [];
  const rawRecordsByRole = new Map();
  const ids = new Set();
  const sourcePaths = new Set();
  const mandatory = [
    ["application", "application", APPLICATION_V3_SCHEMA_ID],
    ["submission", "submission", SUBMISSION_V2_SCHEMA_ID],
    ["ideaSource", "idea-source", IDEA_SOURCE_V1_SCHEMA_ID],
    ["intentContract", "intent-contract", INTENT_CONTRACT_V1_SCHEMA_ID],
    ["architectureDecisions", "architecture-decisions", ARCHITECTURE_DECISIONS_V1_SCHEMA_ID],
    ["intentFidelity", "intent-fidelity", INTENT_FIDELITY_V1_SCHEMA_ID],
    ["feePolicy", "fee-policy", FEE_POLICY_V2_SCHEMA_ID],
    ["security", "security", SECURITY_V1_SCHEMA_ID],
    ["executionSurfaceCoverage", "execution-surface-coverage", EXECUTION_SURFACE_COVERAGE_V1_SCHEMA_ID]
  ];

  for (const [key, role, expectedSchemaId] of mandatory) {
    const path = `$.artifacts.${key}`;
    const result = inspectContentBinding(artifactsValue?.[key], role, path, sourceMap, expectedSchemaId, trackers);
    if (result.summary) bindingSummaries.push(result.summary);
    if (result.parsed !== null) documents[key] = result.parsed;
    if (result.summary) rawRecordsByRole.set(role, {
      ...result.summary,
      parsed: result.parsed,
      content: result.content
    });
    registerArtifactIdentity(result, ids, sourcePaths, path, trackers);
  }

  const tradeCapabilities = Array.isArray(artifactsValue?.tradeCapabilities) ? artifactsValue.tradeCapabilities : [];
  for (const [index, record] of tradeCapabilities.entries()) {
    const path = `$.artifacts.tradeCapabilities[${index}]`;
    const result = inspectContentBinding(record, "trade-capability", path, sourceMap, TRADE_CAPABILITY_MANIFEST_V1_SCHEMA_ID, trackers);
    if (result.summary) {
      bindingSummaries.push(result.summary);
      tradeCapabilityRecords.push({
        ...result.summary,
        parsed: result.parsed,
        content: result.content
      });
    }
    registerArtifactIdentity(result, ids, sourcePaths, path, trackers);
  }

  const acceptancePath = "$.artifacts.registryAcceptance";
  if (artifactsValue?.registryAcceptance === null) {
    documents.registryAcceptance = null;
  } else {
    const acceptanceContract = registryAcceptanceContractForPath(artifactsValue?.registryAcceptance?.path);
    const result = inspectContentBinding(
      artifactsValue?.registryAcceptance,
      "registry-acceptance",
      acceptancePath,
      sourceMap,
      acceptanceContract?.schemaId ?? null,
      trackers
    );
    if (result.summary) bindingSummaries.push(result.summary);
    if (result.parsed !== null) documents.registryAcceptance = result.parsed;
    if (result.summary) rawRecordsByRole.set("registry-acceptance", {
      ...result.summary,
      parsed: result.parsed,
      content: result.content
    });
    registerArtifactIdentity(result, ids, sourcePaths, acceptancePath, trackers);
  }

  const evidence = Array.isArray(artifactsValue?.evidence) ? artifactsValue.evidence : [];
  for (const [index, record] of evidence.entries()) {
    const path = `$.artifacts.evidence[${index}]`;
    const result = inspectContentBinding(record, "evidence", path, sourceMap, null, trackers);
    if (result.summary) bindingSummaries.push(result.summary);
    registerArtifactIdentity(result, ids, sourcePaths, path, trackers);
    if (result.summary) {
      if (evidenceIndex.has(result.summary.id)) {
        addConflict(trackers.conflicts, trackers.evidenceTracker, "EVIDENCE_ID_DUPLICATE", `${path}.id`, `Duplicate evidence id ${result.summary.id}.`);
      } else {
        evidenceIndex.set(result.summary.id, {
          ...result.summary,
          evidenceType: record.evidenceType,
          parsed: result.parsed,
          content: result.content
        });
      }
    }
  }

  return {
    documents,
    evidenceIndex,
    tradeCapabilityRecords,
    bindingSummaries: bindingSummaries.sort((left, right) => (
      left.role.localeCompare(right.role) || left.id.localeCompare(right.id)
    )),
    recordsByRole: new Map(bindingSummaries.map((binding) => [binding.role, binding])),
    rawRecordsByRole
  };
}

export function registryAcceptanceContractForPath(value) {
  if (typeof value !== "string") return null;
  const match = REGISTRY_ACCEPTANCE_V3_PATH_PATTERN.exec(value);
  return match === null ? null : {
    applicationId: match[1],
    applicationRevision: match[2],
    contractId: "registry-acceptance-v3",
    fileVersion: "v3",
    schema: registryAcceptanceV3Schema,
    schemaId: REGISTRY_ACCEPTANCE_V3_SCHEMA_ID,
    version: "3.0.0"
  };
}

export function registryAcceptanceContractForSchemaId(value) {
  return value === REGISTRY_ACCEPTANCE_V3_SCHEMA_ID ? {
    contractId: "registry-acceptance-v3",
    fileVersion: "v3",
    schema: registryAcceptanceV3Schema,
    schemaId: REGISTRY_ACCEPTANCE_V3_SCHEMA_ID,
    version: "3.0.0"
  } : null;
}

export function inspectContentBinding(record, role, path, sourceMap, expectedSchemaId, trackers) {
  if (!isObject(record)) return { summary: null, parsed: null, content: null, id: null, sourcePathKey: null };
  const content = typeof record.content === "string" ? record.content : null;
  let contentMatched = true;
  if (content === null || content.length === 0) {
    addConflict(trackers.conflicts, trackers.structuralTracker, "ARTIFACT_CONTENT_INVALID", `${path}.content`, "Artifact content must be a non-empty UTF-8 string.");
    contentMatched = false;
  } else {
    const actualLength = Buffer.byteLength(content, "utf8");
    const actualSha256 = sha256Utf8(content);
    const actualGitBlob = gitBlobObjectIdUtf8(content, "sha1");
    if (record.byteLength !== actualLength) {
      addConflict(trackers.conflicts, trackers.evidenceTracker, "ARTIFACT_BYTE_LENGTH_MISMATCH", `${path}.byteLength`, `Declared ${String(record.byteLength)} bytes but bound content has ${actualLength} bytes.`);
      contentMatched = false;
    }
    if (record.sha256 !== actualSha256) {
      addConflict(trackers.conflicts, trackers.evidenceTracker, "ARTIFACT_SHA256_MISMATCH", `${path}.sha256`, "The SHA-256 binding does not match the exact content bytes.");
      contentMatched = false;
    }
    if (record.gitBlobObjectId !== actualGitBlob) {
      addConflict(trackers.conflicts, trackers.evidenceTracker, "ARTIFACT_GIT_BLOB_MISMATCH", `${path}.gitBlobObjectId`, "The Git blob object id does not match the exact content bytes.");
      contentMatched = false;
    }
  }
  if (!sourceMap.has(record.sourceRef)) {
    addConflict(trackers.conflicts, trackers.sourceTracker, "ARTIFACT_SOURCE_UNBOUND", `${path}.sourceRef`, `No exact source snapshot exists for ${String(record.sourceRef)}.`);
  }
  if (expectedSchemaId !== null && record.schemaId !== expectedSchemaId) {
    addConflict(trackers.conflicts, trackers.structuralTracker, "ARTIFACT_SCHEMA_BINDING_MISMATCH", `${path}.schemaId`, `Expected exact schema id ${expectedSchemaId}.`);
  }

  let parsed = null;
  if (content !== null && record.mediaType === "application/json") {
    try {
      parsed = parseBoundedStrictJson(content, {
        maxSourceBytes: 16 * 1024 * 1024,
        maxDepth: 256,
        maxNodes: 250_000,
        maxNumberCharacters: 16 * 1024 * 1024
      });
    } catch {
      addConflict(trackers.conflicts, trackers.structuralTracker, "ARTIFACT_JSON_INVALID", `${path}.content`, "The bound JSON artifact cannot be parsed.");
    }
  }
  if (parsed !== null && expectedSchemaId !== null) {
    if ((role === "submission" || role === "fee-policy") && parsed.$schema !== expectedSchemaId) {
      addConflict(trackers.conflicts, trackers.structuralTracker, "ARTIFACT_DOCUMENT_SCHEMA_MISMATCH", `${path}.content#/$schema`, "The document's schema id does not match its external content binding.");
    }
    if (role === "security" && parsed.schemaVersion !== "open-world-security-v1") {
      addConflict(trackers.conflicts, trackers.structuralTracker, "SECURITY_DOCUMENT_VERSION_MISMATCH", `${path}.content#/schemaVersion`, "The security envelope is not open-world-security-v1.");
    }
  }

  const summaryValid = (
    validSlug(record.id)
    && validSlug(record.sourceRef)
    && typeof record.path === "string"
    && SAFE_PATH_PATTERN.test(record.path)
    && GIT_OBJECT_PATTERN.test(record.gitBlobObjectId ?? "")
    && (typeof record.schemaId === "string" || (role === "evidence" && record.schemaId === null))
    && typeof record.mediaType === "string"
    && record.mediaType.length > 0
    && SHA256_PATTERN.test(record.sha256 ?? "")
    && Number.isSafeInteger(record.byteLength)
    && record.byteLength > 0
  );
  const summary = summaryValid ? {
    role,
    id: record.id,
    sourceRef: record.sourceRef,
    path: record.path,
    gitBlobObjectId: record.gitBlobObjectId,
    schemaId: record.schemaId,
    mediaType: record.mediaType,
    sha256: record.sha256,
    byteLength: record.byteLength,
    contentMatched
  } : null;
  return {
    summary,
    parsed,
    content,
    id: validSlug(record.id) ? record.id : null,
    sourcePathKey: validSlug(record.sourceRef) && typeof record.path === "string"
      ? `${record.sourceRef}:${record.path}`
      : null
  };
}

export function analyzeAuthoritativeContracts({
  application,
  submission,
  artifactState,
  conflicts,
  reviewItems,
  structuralTracker,
  applicationTracker
}) {
  if (isObject(application)) {
    const applicationReport = validatePublicPrApplicationV3(application);
    collectAuthoritativeFindings({
      report: applicationReport,
      prefix: "APPLICATION_V3",
      conflicts,
      reviewItems,
      trackerValue: applicationTracker
    });
  }
  if (!isObject(submission)) return;

  const records = {};
  for (const [key, role] of [
    ["ideaSource", "idea-source"],
    ["intentContract", "intent-contract"],
    ["architectureDecisions", "architecture-decisions"],
    ["intentFidelity", "intent-fidelity"]
  ]) {
    const record = artifactState.rawRecordsByRole.get(role);
    if (record?.content !== null && isObject(record?.parsed)) {
      records[key] = { value: record.parsed, bytes: Buffer.from(record.content, "utf8") };
    }
  }

  const supportingRecords = {};
  const feePolicy = artifactState.rawRecordsByRole.get("fee-policy");
  const securityAssessment = submission?.supportingPackage?.securityAssessment === null
    ? null
    : artifactState.rawRecordsByRole.get("security");
  const feePolicySchema = reviewArtifactForKind(application, "fee-policy-schema", artifactState);
  const securityAssessmentSchema = reviewArtifactForKind(application, "security-assessment-schema", artifactState);
  for (const [key, record] of [
    ["feePolicySchema", feePolicySchema],
    ["feePolicy", feePolicy],
    ["securityAssessmentSchema", securityAssessmentSchema],
    ["securityAssessment", securityAssessment]
  ]) {
    if (record?.content !== null && isObject(record?.parsed)) {
      supportingRecords[key] = { value: record.parsed, bytes: Buffer.from(record.content, "utf8") };
    }
  }
  const feeConformanceDeclarations = Array.isArray(submission?.programmableFee?.conformance?.scopeArtifacts)
    ? submission.programmableFee.conformance.scopeArtifacts
    : [];
  if (feeConformanceDeclarations.length > 0) {
    supportingRecords.feeConformance = feeConformanceDeclarations.map((declaration) => {
      const entry = { feeScopeRef: declaration?.feeScopeRef };
      for (const key of ["receipt", "vectorSet"]) {
        const declared = declaration?.[key];
        const candidates = [...artifactState.evidenceIndex.values()].filter((record) => (
          record.path === declared?.path
          && record.schemaId === declared?.schemaId
          && record.sha256 === declared?.sha256
          && record.byteLength === declared?.byteLength
          && record.contentMatched === true
          && typeof record.content === "string"
          && isObject(record.parsed)
        ));
        if (candidates.length === 1) {
          entry[key] = {
            value: candidates[0].parsed,
            bytes: Buffer.from(candidates[0].content, "utf8")
          };
        }
      }
      return entry;
    });
  }
  const tradeCapabilityDeclarations = Array.isArray(submission?.tradeCapability?.markets)
    ? submission.tradeCapability.markets
    : [];
  if (tradeCapabilityDeclarations.length > 0) {
    supportingRecords.tradeCapabilities = tradeCapabilitySupportingRecords(
      tradeCapabilityDeclarations,
      artifactState.tradeCapabilityRecords,
      artifactState.evidenceIndex
    );
  }

  const submissionRecord = artifactState.rawRecordsByRole.get("submission");
  const extensionSchemaBytes = collectExtensionSchemaBytes(
    { submission, records, supportingRecords },
    submissionRecord?.sourceRef ?? null,
    artifactState.evidenceIndex
  );
  const openWorldReport = validateOpenWorldV2Package({
    submission,
    submissionBytes: submissionRecord?.content === null || submissionRecord?.content === undefined
      ? undefined
      : Buffer.from(submissionRecord.content, "utf8"),
    records,
    supportingRecords,
    extensionSchemaBytes
  });
  collectAuthoritativeFindings({
    report: openWorldReport,
    prefix: "OPEN_WORLD_V2",
    conflicts,
    reviewItems,
    trackerValue: structuralTracker
  });
}

export function collectExtensionSchemaBytes(value, sourceRef, evidenceIndex) {
  const paths = new Set();
  const visit = (node) => {
    if (Buffer.isBuffer(node)) return;
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry);
      return;
    }
    if (!isObject(node)) return;
    if (node.kind === "repository" && typeof node.path === "string") paths.add(node.path);
    for (const entry of Object.values(node)) visit(entry);
  };
  visit(value);
  const result = {};
  for (const schemaPath of paths) {
    const candidates = [...evidenceIndex.values()].filter((record) => (
      record.sourceRef === sourceRef
      && record.path === schemaPath
      && typeof record.content === "string"
      && record.sha256 === sha256Utf8(record.content)
      && record.byteLength === Buffer.byteLength(record.content, "utf8")
    ));
    if (candidates.length === 1) result[schemaPath] = Buffer.from(candidates[0].content, "utf8");
  }
  return result;
}

export function collectAuthoritativeFindings({ report, prefix, conflicts, reviewItems, trackerValue }) {
  for (const finding of Array.isArray(report?.findings) ? report.findings : []) {
    const code = `${prefix}_${finding.code}`;
    const path = typeof finding.details?.instancePath === "string"
      ? finding.details.instancePath
      : finding.path ?? "$";
    const message = finding.message ?? `${prefix} validation finding.`;
    if (finding.severity === "blocker") {
      addConflict(conflicts, trackerValue, code, path, message);
    } else {
      reviewItems.add(code, path, message, []);
    }
  }
}

export function reviewArtifactForKind(application, kind, artifactState) {
  const declared = (Array.isArray(application?.reviewPackage?.records) ? application.reviewPackage.records : [])
    .find((record) => record?.kind === kind);
  if (!isObject(declared)) return null;
  const candidates = [
    ...artifactState.evidenceIndex.values(),
    ...artifactState.rawRecordsByRole.values()
  ].filter((candidate) => candidate.path === declared.path && (
    declared.source === "source-repository"
      ? candidate.sourceRef === declared.repositoryRef
      : candidate.sourceRef === artifactState.rawRecordsByRole.get("application")?.sourceRef
  ));
  if (candidates.length !== 1) return null;
  const [candidate] = candidates;
  if (candidate.sha256 !== declared.sha256 || candidate.byteLength !== declared.byteLength) return null;
  return candidate;
}

export function registerArtifactIdentity(result, ids, sourcePaths, path, trackers) {
  if (result.id !== null) {
    if (ids.has(result.id)) {
      addConflict(trackers.conflicts, trackers.evidenceTracker, "ARTIFACT_ID_DUPLICATE", `${path}.id`, `Duplicate artifact id ${result.id}.`);
    }
    ids.add(result.id);
  }
  if (result.sourcePathKey !== null) {
    if (sourcePaths.has(result.sourcePathKey)) {
      addConflict(trackers.conflicts, trackers.evidenceTracker, "ARTIFACT_SOURCE_PATH_DUPLICATE", path, "Two artifact records bind the same source snapshot and repository path.");
    }
    sourcePaths.add(result.sourcePathKey);
  }
}

export function analyzeApplicationAndSubmission(context) {
  const {
    input,
    application,
    submission,
    feePolicy,
    sourceSnapshots,
    artifacts,
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    applicationTracker,
    feeTracker,
    feeRecipientTracker,
    securityTracker,
    evidenceTracker
  } = context;
  if (!isObject(application)) {
    addConflict(conflicts, applicationTracker, "APPLICATION_DOCUMENT_MISSING", "$.artifacts.application.content", "A parseable public application document is required.");
  } else {
    requireEqual(application.applicationId, input?.applicationId, "APPLICATION_ID_BINDING_MISMATCH", "$.artifacts.application.content#/applicationId", "Application id does not match the launch bundle.", conflicts, applicationTracker);
    requireEqual(application.schemaVersion, 3, "APPLICATION_SCHEMA_VERSION_MISMATCH", "$.artifacts.application.content#/schemaVersion", "Application schemaVersion must equal 3.", conflicts, applicationTracker);
    requireEqual(application.contract?.id, "public-pr-application-v3", "APPLICATION_CONTRACT_MISMATCH", "$.artifacts.application.content#/contract/id", "The application must use public-pr-application-v3.", conflicts, applicationTracker);
    requireEqual(application.contract?.version, "3.0.0", "APPLICATION_CONTRACT_VERSION_MISMATCH", "$.artifacts.application.content#/contract/version", "The application contract version must equal 3.0.0.", conflicts, applicationTracker);
    requireEqual(application.contract?.submissionStandard, "2.0.0", "APPLICATION_SUBMISSION_STANDARD_MISMATCH", "$.artifacts.application.content#/contract/submissionStandard", "The application must bind submission standard 2.0.0.", conflicts, applicationTracker);
    if (application.declarations?.noInheritedApproval !== true) {
      addConflict(conflicts, applicationTracker, "APPLICATION_INHERITED_APPROVAL_NOT_DENIED", "$.artifacts.application.content#/declarations/noInheritedApproval", "The application must explicitly deny inherited approval.");
    }
    if (application.declarations?.noApprovalClaim !== true) {
      addConflict(conflicts, applicationTracker, "APPLICATION_APPROVAL_CLAIM_NOT_DENIED", "$.artifacts.application.content#/declarations/noApprovalClaim", "The application must explicitly deny a self-approval claim.");
    }
    if (application.reviewState !== undefined) {
      reviewItems.add("APPLICATION_REVIEW_NOT_LAUNCH_AUTHORIZATION", "$.artifacts.application.content#/reviewState", "An application review state is preserved but never treated as launch authorization.", []);
    }
    bindApplicationSources(application.source, sourceSnapshots, conflicts, unresolved, applicationTracker);
  }

  if (!isObject(submission)) {
    addConflict(conflicts, applicationTracker, "SUBMISSION_DOCUMENT_MISSING", "$.artifacts.submission.content", "A parseable open-world submission document is required.");
  } else {
    requireEqual(submission.applicationId, input?.applicationId, "SUBMISSION_ID_BINDING_MISMATCH", "$.artifacts.submission.content#/applicationId", "Submission id does not match the launch bundle.", conflicts, applicationTracker);
    requireEqual(submission.standardVersion, "2.0.0", "SUBMISSION_STANDARD_MISMATCH", "$.artifacts.submission.content#/standardVersion", "The submission must use open-world standard 2.0.0.", conflicts, applicationTracker);
  }

  const submissionBinding = artifacts.recordsByRole.get("submission");
  const feePolicyBinding = artifacts.recordsByRole.get("fee-policy");
  const derivedFeeApplicability = isObject(submission)
    ? deriveOpenWorldV2FeeApplicability(submission)
    : "unresolved";
  if (isObject(application) && submissionBinding) {
    const policyBindings = application.policyBindings;
    requireEqual(policyBindings?.submissionPath, submissionBinding.path, "APPLICATION_SUBMISSION_PATH_MISMATCH", "$.artifacts.application.content#/policyBindings/submissionPath", "Application submission path does not match the exact bound submission.", conflicts, applicationTracker);
    requireEqual(policyBindings?.submissionRepositoryRef, submissionBinding.sourceRef, "APPLICATION_SUBMISSION_REPOSITORY_MISMATCH", "$.artifacts.application.content#/policyBindings/submissionRepositoryRef", "Application submission repository ref does not match the exact bound source snapshot.", conflicts, applicationTracker);
    requireEqual(policyBindings?.submissionSha256, submissionBinding.sha256, "APPLICATION_SUBMISSION_SHA256_MISMATCH", "$.artifacts.application.content#/policyBindings/submissionSha256", "Application submission SHA-256 does not match the exact bound submission.", conflicts, applicationTracker);
    requireEqual(policyBindings?.feePolicySchemaId, FEE_POLICY_V2_SCHEMA_ID, "APPLICATION_FEE_POLICY_SCHEMA_MISMATCH", "$.artifacts.application.content#/policyBindings/feePolicySchemaId", "Application does not bind the exact fee policy schema id.", conflicts, feeTracker);
    requireEqual(policyBindings?.programmableFeePolicyId, FEE_POLICY_V2_ID, "APPLICATION_FEE_POLICY_ID_MISMATCH", "$.artifacts.application.content#/policyBindings/programmableFeePolicyId", "Application does not bind Programmable fee policy v2.", conflicts, feeTracker);
    requireEqual(policyBindings?.programmableFeePolicyVersion, FEE_POLICY_V2_VERSION, "APPLICATION_FEE_POLICY_VERSION_MISMATCH", "$.artifacts.application.content#/policyBindings/programmableFeePolicyVersion", "Application does not bind fee policy version 2.0.0.", conflicts, feeTracker);
    requireEqual(policyBindings?.programmableFeePolicyHashPreimage, FEE_POLICY_V2_HASH_PREIMAGE, "APPLICATION_FEE_POLICY_PREIMAGE_MISMATCH", "$.artifacts.application.content#/policyBindings/programmableFeePolicyHashPreimage", "Application does not bind the immutable fee policy preimage.", conflicts, feeTracker);
    requireEqual(policyBindings?.programmableFeePolicyHash, FEE_POLICY_V2_HASH, "APPLICATION_FEE_POLICY_HASH_MISMATCH", "$.artifacts.application.content#/policyBindings/programmableFeePolicyHash", "Application does not bind the immutable fee policy hash.", conflicts, feeTracker);
    requireEqual(
      policyBindings?.feeApplicability,
      derivedFeeApplicability,
      "APPLICATION_FEE_APPLICABILITY_MISMATCH",
      "$.artifacts.application.content#/policyBindings/feeApplicability",
      "Application feeApplicability does not match the exact V2 execution-scope state.",
      conflicts,
      feeTracker
    );
    if (derivedFeeApplicability === "applicable") {
      if (feePolicyBinding) {
        requireEqual(policyBindings?.feePolicyInstancePath, feePolicyBinding.path, "APPLICATION_FEE_POLICY_INSTANCE_PATH_MISMATCH", "$.artifacts.application.content#/policyBindings/feePolicyInstancePath", "Application fee-policy instance path does not match the exact bound instance artifact.", conflicts, feeTracker);
        requireEqual(policyBindings?.feePolicyInstanceRepositoryRef, feePolicyBinding.sourceRef, "APPLICATION_FEE_POLICY_INSTANCE_REPOSITORY_MISMATCH", "$.artifacts.application.content#/policyBindings/feePolicyInstanceRepositoryRef", "Application fee-policy instance repository ref does not match the bound source snapshot.", conflicts, feeTracker);
        requireEqual(policyBindings?.feePolicyInstanceSha256, feePolicyBinding.sha256, "APPLICATION_FEE_POLICY_INSTANCE_SHA256_MISMATCH", "$.artifacts.application.content#/policyBindings/feePolicyInstanceSha256", "Application fee-policy instance SHA-256 does not match the exact bound instance bytes.", conflicts, feeTracker);
      } else {
        addConflict(conflicts, feeTracker, "APPLICATION_FEE_POLICY_INSTANCE_MISSING", "$.artifacts.feePolicy", "A launchable applicable Application requires the exact bound Fee V2 instance artifact.");
      }
    } else if (derivedFeeApplicability === "not-applicable") {
      requireEqual(policyBindings?.feePolicyInstancePath, null, "APPLICATION_FEE_NOT_APPLICABLE_INSTANCE_PATH_FORBIDDEN", "$.artifacts.application.content#/policyBindings/feePolicyInstancePath", "Fee-not-applicable Application state requires a null instance path.", conflicts, feeTracker);
      requireEqual(policyBindings?.feePolicyInstanceRepositoryRef, null, "APPLICATION_FEE_NOT_APPLICABLE_INSTANCE_REPOSITORY_FORBIDDEN", "$.artifacts.application.content#/policyBindings/feePolicyInstanceRepositoryRef", "Fee-not-applicable Application state requires a null instance repository.", conflicts, feeTracker);
      requireEqual(policyBindings?.feePolicyInstanceSha256, null, "APPLICATION_FEE_NOT_APPLICABLE_INSTANCE_SHA256_FORBIDDEN", "$.artifacts.application.content#/policyBindings/feePolicyInstanceSha256", "Fee-not-applicable Application state requires a null instance digest.", conflicts, feeTracker);
      addConflict(
        conflicts,
        feeTracker,
        "APPLICATION_FEE_NOT_APPLICABLE_NOT_LAUNCHABLE",
        "$.artifacts.application.content#/policyBindings/feeApplicability",
        "Fee-not-applicable is a valid review state for exact zero-scope products, but Launch V2 authorizes only applicable products with a real Fee V2 instance."
      );
    } else {
      addConflict(conflicts, feeTracker, "APPLICATION_FEE_APPLICABILITY_UNRESOLVED", "$.artifacts.application.content#/policyBindings/feeApplicability", "Launch V2 requires an exact applicable Fee V2 execution-scope state.");
    }
    requireEqual(application.reviewState?.status, "unreviewed", "APPLICATION_REVIEW_STATE_INVALID", "$.artifacts.application.content#/reviewState/status", "A public v3 application entering launch preparation must remain unreviewed.", conflicts, applicationTracker);
    requireEqual(application.reviewState?.inheritedApproval, false, "APPLICATION_REVIEW_INHERITANCE_FORBIDDEN", "$.artifacts.application.content#/reviewState/inheritedApproval", "Application review state must not inherit approval.", conflicts, applicationTracker);
    requireEqual(application.reviewState?.acceptancePath, null, "APPLICATION_ACCEPTANCE_PATH_FORBIDDEN", "$.artifacts.application.content#/reviewState/acceptancePath", "An unreviewed application cannot carry an acceptance path.", conflicts, applicationTracker);
    requireEqual(application.reviewState?.acceptanceSha256, null, "APPLICATION_ACCEPTANCE_HASH_FORBIDDEN", "$.artifacts.application.content#/reviewState/acceptanceSha256", "An unreviewed application cannot carry an acceptance hash.", conflicts, applicationTracker);
  }

  if (!isObject(feePolicy)) {
    addConflict(conflicts, feeTracker, "FEE_POLICY_DOCUMENT_MISSING", "$.artifacts.feePolicy.content", "A parseable fee policy v2 document is required.");
  } else {
    for (const error of validateFeePolicyV2(feePolicy)) {
      addConflict(conflicts, feeTracker, "FEE_POLICY_INVALID", "$.artifacts.feePolicy.content", error);
    }
    requireEqual(feePolicy.policyId, FEE_POLICY_V2_ID, "FEE_POLICY_ID_MISMATCH", "$.artifacts.feePolicy.content#/policyId", "Fee policy id is not the immutable v2 policy.", conflicts, feeTracker);
    requireEqual(feePolicy.policyVersion, FEE_POLICY_V2_VERSION, "FEE_POLICY_VERSION_MISMATCH", "$.artifacts.feePolicy.content#/policyVersion", "Fee policy version is not 2.0.0.", conflicts, feeTracker);
    requireEqual(feePolicy.policyHashPreimage, FEE_POLICY_V2_HASH_PREIMAGE, "FEE_POLICY_PREIMAGE_MISMATCH", "$.artifacts.feePolicy.content#/policyHashPreimage", "Fee policy preimage is not the immutable v2 policy preimage.", conflicts, feeTracker);
    requireEqual(feePolicy.policyHash, FEE_POLICY_V2_HASH, "FEE_POLICY_HASH_MISMATCH", "$.artifacts.feePolicy.content#/policyHash", "Fee policy hash is not the immutable v2 policy hash.", conflicts, feeTracker);
    requireEqual(feePolicy.platform?.owner, PROGRAMMABLE_FEE_RECIPIENT, "FEE_POLICY_RECIPIENT_MISMATCH", "$.artifacts.feePolicy.content#/platform/owner", "Fee policy owner is not the Programmable fee recipient.", conflicts, feeRecipientTracker);
  }

  if (isObject(submission)) {
    const fee = submission.programmableFee;
    requireEqual(fee?.policyId, FEE_POLICY_V2_ID, "SUBMISSION_FEE_POLICY_ID_MISMATCH", "$.artifacts.submission.content#/programmableFee/policyId", "Submission does not bind fee policy v2.", conflicts, feeTracker);
    requireEqual(fee?.policyVersion, FEE_POLICY_V2_VERSION, "SUBMISSION_FEE_POLICY_VERSION_MISMATCH", "$.artifacts.submission.content#/programmableFee/policyVersion", "Submission does not bind fee policy version 2.0.0.", conflicts, feeTracker);
    requireEqual(fee?.policyHashPreimage, FEE_POLICY_V2_HASH_PREIMAGE, "SUBMISSION_FEE_POLICY_PREIMAGE_MISMATCH", "$.artifacts.submission.content#/programmableFee/policyHashPreimage", "Submission does not bind the immutable fee policy preimage.", conflicts, feeTracker);
    requireEqual(fee?.policyHash, FEE_POLICY_V2_HASH, "SUBMISSION_FEE_POLICY_HASH_MISMATCH", "$.artifacts.submission.content#/programmableFee/policyHash", "Submission does not bind the immutable fee policy hash.", conflicts, feeTracker);
    requireEqual(fee?.platformHundredthsOfBip, 1000, "SUBMISSION_PLATFORM_RATE_MISMATCH", "$.artifacts.submission.content#/programmableFee/platformHundredthsOfBip", "The mandatory Programmable fee must equal 0.1 percent.", conflicts, feeTracker);
    requireEqual(fee?.owner, PROGRAMMABLE_FEE_RECIPIENT, "SUBMISSION_FEE_RECIPIENT_MISMATCH", "$.artifacts.submission.content#/programmableFee/owner", "Submission fee owner is not the Programmable fee recipient.", conflicts, feeRecipientTracker);
    bindFeeClaimAuthority(submission, fee, conflicts, unresolved, feeRecipientTracker);
    bindDeclaredEvidence(submission.implementation?.evidenceRefs, "$.artifacts.submission.content#/implementation/evidenceRefs", evidenceIndex, unresolved, evidenceTracker);
  }

  if (isObject(application)) {
    const reviewIndex = new Map(evidenceIndex);
    for (const binding of artifacts.bindingSummaries) {
      if (binding.role !== "application" && !reviewIndex.has(binding.id)) reviewIndex.set(binding.id, binding);
    }
    bindApplicationReviewPackage(
      application.reviewPackage,
      reviewIndex,
      artifacts.recordsByRole.get("application")?.sourceRef ?? null,
      conflicts,
      unresolved,
      evidenceTracker
    );
    bindDerivedSecurityApplicationPackage({
      application,
      artifacts,
      conflicts,
      securityTracker
    });
  }
}

export function bindDerivedSecurityApplicationPackage({ application, artifacts, conflicts, securityTracker }) {
  const applicationSourceRef = artifacts.rawRecordsByRole.get("application")?.sourceRef ?? null;
  const securityBindings = application?.securityBindings;
  const specifications = [
    {
      kind: "security-assessment-schema",
      record: reviewArtifactForKind(application, "security-assessment-schema", artifacts),
      schemaId: SECURITY_V1_SCHEMA_ID,
      schemaIdField: "securityAssessmentSchemaId",
      pathField: "securityAssessmentSchemaPath",
      repositoryRefField: "securityAssessmentSchemaRepositoryRef",
      sha256Field: "securityAssessmentSchemaSha256",
      byteLengthField: "securityAssessmentSchemaByteLength"
    },
    {
      kind: "security-assessment",
      record: reviewArtifactForKind(application, "security-assessment", artifacts),
      schemaId: SECURITY_V1_SCHEMA_ID,
      schemaIdField: null,
      pathField: "securityAssessmentPath",
      repositoryRefField: "securityAssessmentRepositoryRef",
      sha256Field: "securityAssessmentSha256",
      byteLengthField: "securityAssessmentByteLength"
    }
  ];
  for (const specification of specifications) {
    const basePath = `$.artifacts.application.content#/securityBindings/${specification.kind}`;
    const record = specification.record;
    if (!record) {
      addConflict(conflicts, securityTracker, "APPLICATION_DERIVED_SECURITY_ARTIFACT_UNBOUND", basePath, `Derived ${specification.kind} bytes do not resolve to one exact application-package review record.`);
      continue;
    }
    if (record.sourceRef !== applicationSourceRef) {
      addConflict(conflicts, securityTracker, "APPLICATION_DERIVED_SECURITY_SOURCE_MISMATCH", basePath, `Derived ${specification.kind} bytes must travel with the exact central application package, not a builder source repository.`);
    }
    if (specification.schemaIdField !== null) {
      requireEqual(securityBindings?.[specification.schemaIdField], specification.schemaId, "APPLICATION_SECURITY_SCHEMA_ID_MISMATCH", `${basePath}/${specification.schemaIdField}`, "Application security schema id does not match the stable security contract.", conflicts, securityTracker);
    }
    requireEqual(securityBindings?.[specification.repositoryRefField], null, "APPLICATION_DERIVED_SECURITY_SELF_REFERENCE_FORBIDDEN", `${basePath}/${specification.repositoryRefField}`, "Derived security artifacts must use repositoryRef null so they cannot create a source-commit fixed point.", conflicts, securityTracker);
    requireEqual(securityBindings?.[specification.pathField], record.path, "APPLICATION_DERIVED_SECURITY_PATH_MISMATCH", `${basePath}/${specification.pathField}`, `Application ${specification.kind} path does not match the exact supplied central bytes.`, conflicts, securityTracker);
    requireEqual(securityBindings?.[specification.sha256Field], record.sha256, "APPLICATION_DERIVED_SECURITY_SHA256_MISMATCH", `${basePath}/${specification.sha256Field}`, `Application ${specification.kind} SHA-256 does not match the exact supplied central bytes.`, conflicts, securityTracker);
    requireEqual(securityBindings?.[specification.byteLengthField], record.byteLength, "APPLICATION_DERIVED_SECURITY_BYTE_LENGTH_MISMATCH", `${basePath}/${specification.byteLengthField}`, `Application ${specification.kind} byte length does not match the exact supplied central bytes.`, conflicts, securityTracker);
  }
}

export function bindApplicationSources(sourceClosure, sources, conflicts, unresolved, trackerValue) {
  const declared = [sourceClosure?.primary, ...(Array.isArray(sourceClosure?.companions) ? sourceClosure.companions : [])]
    .filter(isObject);
  if (declared.length === 0) {
    addUnresolved(unresolved, trackerValue, "APPLICATION_SOURCE_UNRESOLVED", "$.artifacts.application.content#/source", "Application source closure is missing.");
    return;
  }
  for (const [index, source] of declared.entries()) {
    const match = sources.find((candidate) => (
      candidate.numericRepositoryId === source.numericRepositoryId
      && candidate.repositoryUri === source.repositoryUri
      && candidate.revisionObjectId === source.revisionObjectId
      && candidate.treeObjectId === source.treeObjectId
    ));
    if (!match) {
      addConflict(conflicts, trackerValue, "APPLICATION_SOURCE_SNAPSHOT_MISMATCH", `$.artifacts.application.content#/source/${index}`, "Application source is not exactly bound to a declared repository id, revision and tree snapshot.");
    }
  }
}

export function bindApplicationReviewPackage(reviewPackage, evidenceIndex, applicationSourceRef, conflicts, unresolved, trackerValue) {
  const records = Array.isArray(reviewPackage)
    ? reviewPackage
    : Array.isArray(reviewPackage?.records)
      ? reviewPackage.records
      : null;
  if (records === null) {
    addUnresolved(unresolved, trackerValue, "APPLICATION_REVIEW_PACKAGE_UNRESOLVED", "$.artifacts.application.content#/reviewPackage", "Application review package is not an array of exact files.");
    return;
  }
  for (const [index, declared] of records.entries()) {
    if (!isObject(declared)) continue;
    const path = `$.artifacts.application.content#/reviewPackage/${index}`;
    const expectedSourceRef = declared.source === "source-repository"
      ? declared.repositoryRef
      : declared.source === "application-package"
        ? applicationSourceRef
        : null;
    if (!validSlug(expectedSourceRef)) {
      addConflict(conflicts, trackerValue, "APPLICATION_REVIEW_SOURCE_INVALID", path, `Review file ${String(declared.path)} has no exact repository identity.`);
      continue;
    }
    const candidates = [...evidenceIndex.values()].filter((evidence) => (
      evidence.sourceRef === expectedSourceRef && evidence.path === declared.path
    ));
    if (candidates.length === 0) {
      addUnresolved(unresolved, trackerValue, "APPLICATION_REVIEW_EVIDENCE_UNBOUND", path, `Review file ${String(declared.path)} has no exact evidence content binding.`);
    } else if (candidates.length > 1) {
      addConflict(conflicts, trackerValue, "APPLICATION_REVIEW_EVIDENCE_AMBIGUOUS", path, `Review file ${String(declared.path)} resolves to more than one artifact in the declared repository.`);
    } else if (candidates[0].sha256 !== declared.sha256 || candidates[0].byteLength !== declared.byteLength || candidates[0].mediaType !== declared.mediaType) {
      addConflict(conflicts, trackerValue, "APPLICATION_REVIEW_EVIDENCE_MISMATCH", path, `Review file ${String(declared.path)} does not match its exact evidence bytes.`);
    }
  }
}

export function bindFeeClaimAuthority(submission, fee, conflicts, unresolved, trackerValue) {
  if (!validSlug(fee?.claimAuthorityRef)) {
    addUnresolved(unresolved, trackerValue, "FEE_CLAIM_AUTHORITY_UNRESOLVED", "$.artifacts.submission.content#/programmableFee/claimAuthorityRef", "Fee claim authority is unresolved.");
    return;
  }
  const authorities = Array.isArray(submission.authorities) ? submission.authorities : [];
  const authority = authorities.find(({ id }) => id === fee.claimAuthorityRef);
  if (!authority) {
    addConflict(conflicts, trackerValue, "FEE_CLAIM_AUTHORITY_UNBOUND", "$.artifacts.submission.content#/programmableFee/claimAuthorityRef", "Fee claim authority ref is absent from the authority graph.");
    return;
  }
  requireEqual(authority.holder, PROGRAMMABLE_FEE_RECIPIENT, "FEE_CLAIM_AUTHORITY_HOLDER_MISMATCH", "$.artifacts.submission.content#/authorities", "Fee claim authority holder is not the Programmable fee recipient.", conflicts, trackerValue);
  requireEqual(authority.revocation, "immutable", "FEE_CLAIM_AUTHORITY_MUTABLE", "$.artifacts.submission.content#/authorities", "Programmable fee claim authority must be immutable.", conflicts, trackerValue);
}
