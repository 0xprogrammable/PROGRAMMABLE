import { canonicalJson, isObject } from "./open-world-v2-primitives.mjs";
import {
  DEFAULT_FRAGMENT_LIMITS,
  OPEN_WORLD_V2_REPORT_VERSION,
  OPEN_WORLD_V2_STANDARD_VERSION,
  architectureSnapshotSha256,
  severityOrder
} from "./open-world-v2-contracts.mjs";

export function finalizeOpenWorldV2Validation(context) {
  const {
    submission,
    submissionBytes,
    records,
    fragmentLimits,
    recordDigests,
    securityAnalysis,
    findings,
    splitReasons,
    add,
    addSplitReason,
    parseStrictRecordJson,
    requireObject,
    requireArray
  } = context;
  const {
    fidelity,
    ideaEntries,
    facts,
    factIds,
    decisions,
    decisionIds
  } = context.intentState;
  const { validateArchitectureRef } = context.graphState;
  const inputDigests = fidelity.inputDigests ?? {};
  for (const [field, expected] of [
    ["ideaSourceSha256", recordDigests.ideaSource],
    ["intentContractSha256", recordDigests.intentContract],
    ["architectureDecisionsSha256", recordDigests.architectureDecisions],
    ["architectureSnapshotSha256", architectureSnapshotSha256(submission)]
  ]) if (inputDigests[field] !== expected) add("blocker", "FIDELITY_INPUT_DIGEST_MISMATCH", `$.records.intentFidelity.inputDigests.${field}`, "Intent-fidelity input digest does not match exact current input.");
  const traces = requireArray(fidelity.traces, "$.records.intentFidelity.traces", "FIDELITY_TRACES_INVALID");
  const tracesByFact = new Map();
  traces.forEach((trace, index) => {
    const tracePath = `$.records.intentFidelity.traces[${index}]`;
    if (!requireObject(trace, tracePath, "FIDELITY_TRACE_INVALID")) return;
    const bucket = tracesByFact.get(trace.factId) ?? [];
    bucket.push(trace);
    tracesByFact.set(trace.factId, bucket);
    if (!factIds.has(trace.factId)) add("blocker", "FIDELITY_FACT_REF_MISSING", `${tracePath}.factId`, "Fidelity trace references an unknown fact.");
    for (const ref of requireArray(trace.decisionRefs, `${tracePath}.decisionRefs`, "FIDELITY_DECISION_REFS_INVALID")) if (!decisionIds.has(ref)) add("blocker", "FIDELITY_DECISION_REF_MISSING", `${tracePath}.decisionRefs`, "Fidelity trace references an unknown decision.", { ref });
    requireArray(trace.architectureRefs, `${tracePath}.architectureRefs`, "FIDELITY_ARCHITECTURE_REFS_INVALID").forEach((ref, refIndex) => validateArchitectureRef(ref, `${tracePath}.architectureRefs[${refIndex}]`));
    if (trace.acceptedChangeIdeaEntryId !== null) {
      const changeEntry = ideaEntries.find((entry) => entry?.id === trace.acceptedChangeIdeaEntryId);
      if (!changeEntry || !["clarification", "correction", "builder-approved-change"].includes(changeEntry.kind)) add("blocker", "FIDELITY_ACCEPTED_CHANGE_SOURCE_INVALID", `${tracePath}.acceptedChangeIdeaEntryId`, "Accepted change must reference a builder-authored clarification, correction, or approved-change entry.");
    }
    const fact = facts.find((candidate) => candidate?.id === trace.factId);
    if (trace.status === "drift") add("blocker", "INTENT_DRIFT", tracePath, "Architecture or implementation drifts from the intent contract. Update the intent contract from a builder-authored change before proceeding.");
    if (trace.status === "partially-preserved" && fact?.materiality === "core") add("blocker", "CORE_INTENT_PARTIALLY_PRESERVED", tracePath, "Core intent may not be silently weakened.");
    if (["unimplemented", "unassessed"].includes(trace.status)) add(submission.stage === "prototype" ? "blocker" : "review", "INTENT_FIDELITY_INCOMPLETE", tracePath, "Material intent is not yet fully represented in the current stage.");
    if (submission.stage === "prototype" && trace.status === "preserved" && ["core", "material"].includes(fact?.materiality) && ((trace.implementationRefs?.length ?? 0) === 0 || (trace.testRefs?.length ?? 0) === 0)) add("blocker", "PROTOTYPE_FIDELITY_EVIDENCE_MISSING", tracePath, "A preserved material fact at prototype stage needs implementation and test references.");
  });
  for (const fact of facts.filter((candidate) => ["core", "material"].includes(candidate?.materiality))) {
    const count = tracesByFact.get(fact.id)?.length ?? 0;
    if (count !== 1) add("blocker", "MATERIAL_FACT_TRACE_COUNT_INVALID", "$.records.intentFidelity.traces", "Every core or material fact needs exactly one fidelity trace.", { factId: fact.id, count });
  }
  const driftEvents = requireArray(fidelity.driftEvents, "$.records.intentFidelity.driftEvents", "DRIFT_EVENTS_INVALID");
  driftEvents.forEach((event, index) => {
    const eventPath = `$.records.intentFidelity.driftEvents[${index}]`;
    if (event.sequence !== index + 1) add("blocker", "DRIFT_EVENT_SEQUENCE_INVALID", `${eventPath}.sequence`, "Drift event sequence must be contiguous and append-only.");
    for (const ref of requireArray(event.factRefs, `${eventPath}.factRefs`, "DRIFT_EVENT_FACT_REFS_INVALID")) if (!factIds.has(ref)) add("blocker", "DRIFT_EVENT_FACT_REF_MISSING", `${eventPath}.factRefs`, "Drift event references an unknown fact.", { ref });
    if (event.acceptedChangeIdeaEntryId !== null) {
      const changeEntry = ideaEntries.find((entry) => entry?.id === event.acceptedChangeIdeaEntryId);
      if (!changeEntry || !["clarification", "correction", "builder-approved-change"].includes(changeEntry.kind)) add("blocker", "DRIFT_EVENT_CHANGE_SOURCE_INVALID", `${eventPath}.acceptedChangeIdeaEntryId`, "Accepted drift event must reference a builder-authored change entry.");
    }
  });
  const materialTraces = facts.filter((fact) => ["core", "material"].includes(fact?.materiality)).flatMap((fact) => tracesByFact.get(fact.id) ?? []);
  const derivedFidelityStatus = materialTraces.some((trace) => trace.status === "drift")
    ? "drift"
    : materialTraces.length !== facts.filter((fact) => ["core", "material"].includes(fact?.materiality)).length || materialTraces.some((trace) => trace.status !== "preserved")
      ? "incomplete"
      : "preserved";
  if (fidelity.overallStatus !== derivedFidelityStatus) add("blocker", "FIDELITY_OVERALL_STATUS_INVALID", "$.records.intentFidelity.overallStatus", `overallStatus must be ${derivedFidelityStatus}.`);

  const limits = { ...DEFAULT_FRAGMENT_LIMITS };
  for (const [key, value] of Object.entries(fragmentLimits ?? {})) if (Object.prototype.hasOwnProperty.call(limits, key) && Number.isInteger(value) && value > 0) limits[key] = value;
  const fragmentCounts = {
    assets: submission.assets?.length ?? 0,
    markets: submission.markets?.length ?? 0,
    hooks: submission.hooks?.length ?? 0,
    lifecyclePhases: submission.lifecyclePhases?.length ?? 0,
    components: submission.components?.length ?? 0,
    valueFlows: submission.valueFlows?.length ?? 0,
    authorities: submission.authorities?.length ?? 0,
    capabilityProfiles: submission.capabilityProfiles?.length ?? 0,
    facts: facts.length,
    decisions: decisions.length,
    traces: traces.length
  };
  for (const [collection, count] of Object.entries(fragmentCounts)) {
    if (count > limits[collection]) {
      addSplitReason({ collection, count, limit: limits[collection] });
      add("split-review", "FRAGMENT_LIMIT_EXCEEDED", `$.${collection}`, "Operational review size requires multiple review fragments; it does not make the idea unsupported or invalid.", { collection, count, limit: limits[collection] });
    }
  }
  for (const [key, record] of Object.entries(records ?? {})) {
    const length = Buffer.isBuffer(record?.bytes) ? record.bytes.length : typeof record?.bytes === "string" ? Buffer.byteLength(record.bytes) : 0;
    if (length > limits.recordBytes) {
      addSplitReason({ collection: `record:${key}`, count: length, limit: limits.recordBytes });
      add("split-review", "RECORD_FRAGMENT_LIMIT_EXCEEDED", `$.records.${key}`, "Large record requires split review; it does not make the idea unsupported or invalid.", { byteLength: length, limit: limits.recordBytes });
    }
  }
  const declaredFragmentation = submission.fragmentation;
  if (!isObject(declaredFragmentation) || !["single-review", "split-review"].includes(declaredFragmentation.strategy) || !Array.isArray(declaredFragmentation.fragments)) add("blocker", "FRAGMENTATION_DECLARATION_INVALID", "$.fragmentation", "Submission must declare its review-fragment strategy.");
  if (splitReasons.length > 0 && declaredFragmentation?.strategy !== "split-review") add("review", "SPLIT_REVIEW_PLAN_REQUIRED", "$.fragmentation.strategy", "Operational limits require a split-review plan before reviewer assignment.");

  if (submissionBytes !== undefined) {
    const buffer = Buffer.isBuffer(submissionBytes) ? submissionBytes : Buffer.from(submissionBytes);
    const parsedSubmission = parseStrictRecordJson(buffer, {
      collection: "submission-bytes",
      findingPath: "$.bytes",
      invalidCode: "SUBMISSION_BYTES_JSON_INVALID",
      invalidMessage: "Submission bytes are not valid duplicate-free JSON.",
      structureMessage: "Submission bytes exceed a safe JSON structural boundary."
    });
    if (parsedSubmission !== null && canonicalJson(parsedSubmission) !== canonicalJson(submission)) {
      add("blocker", "SUBMISSION_VALUE_BYTES_MISMATCH", "$", "Parsed submission bytes differ from the supplied submission value.");
    }
  }

  findings.sort((left, right) =>
    (severityOrder[left.severity] ?? 99) - (severityOrder[right.severity] ?? 99)
    || left.path.localeCompare(right.path)
    || left.code.localeCompare(right.code)
    || left.message.localeCompare(right.message)
    || canonicalJson(left.details ?? null).localeCompare(canonicalJson(right.details ?? null))
  );
  const blockerCount = findings.filter((finding) => finding.severity === "blocker").length;
  const valid = blockerCount === 0;
  const splitReviewRequired = splitReasons.length > 0;
  const reviewRequired = findings.some((finding) => finding.severity === "review");
  const privacyHeld = findings.some((finding) => finding.code === "MANUAL_REDACTION_REQUIRED");
  const integrationPending = findings.some((finding) => finding.details?.route === "INTEGRATION_PENDING");
  const designEligible = !privacyHeld;
  const automaticMaterialization = valid && designEligible && !splitReviewRequired && !integrationPending;
  return {
    reportVersion: OPEN_WORLD_V2_REPORT_VERSION,
    standardVersion: OPEN_WORLD_V2_STANDARD_VERSION,
    valid,
    ok: valid,
    status: valid ? (splitReviewRequired ? "SPLIT_REVIEW_REQUIRED" : reviewRequired ? "REVIEW_REQUIRED" : "VALID") : "INVALID",
    reviewRequired,
    ideaEligibility: privacyHeld ? "HELD_FOR_PRIVACY_REDACTION" : "ELIGIBLE_FOR_REVIEW",
    designEligible,
    automaticMaterialization,
    writePerformed: false,
    counts: {
      blocker: blockerCount,
      review: findings.filter((finding) => finding.severity === "review").length,
      splitReview: findings.filter((finding) => finding.severity === "split-review").length
    },
    splitReview: {
      required: splitReviewRequired,
      reasons: splitReasons.sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)))
    },
    security: securityAnalysis === null ? {
      route: "DERIVED_APPLICATION_ASSESSMENT_PENDING",
      summary: null,
      implementationAuthorization: "NOT_GRANTED",
      assurance: "Source-owned submission only. Exact source assessment must be derived after the pinned source commit and bound by Public Application v3 before launch review."
    } : {
      route: securityAnalysis.route,
      summary: securityAnalysis.summary,
      implementationAuthorization: "NOT_GRANTED",
      assurance: securityAnalysis.assurance
    },
    findings
  };
}
