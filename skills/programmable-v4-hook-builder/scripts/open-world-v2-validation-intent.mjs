import { validateExtensionInstance } from "./open-world-v2-extension-schema-core.mjs";
import { isPublicGitHubRepositoryTransport } from "./open-world-v2-package-io.mjs";
import {
  isObject,
  sha256Bytes,
  sha256Utf8,
  utf8ByteLength
} from "./open-world-v2-primitives.mjs";
import {
  byteBoundaries,
  hasLoneSurrogate,
  hasPublicChainIdentifierContext,
  sensitiveCandidates
} from "./open-world-v2-privacy-core.mjs";
import {
  EXTENSION_SPLIT_REVIEW_CODES,
  OPEN_WORLD_V2_STANDARD_VERSION,
  bundledSchemas,
  duplicates,
  idsFor
} from "./open-world-v2-contracts.mjs";

export function validateOpenWorldV2Intent(context) {
  const {
    submission,
    parsedRecords,
    recordDigests,
    add,
    addSplitReason,
    requireObject,
    requireArray,
    requireSlug,
    validateSchemaBinding
  } = context;
  if (submission.$schema !== "urn:programmable:v4-hook-submission:2.0.0") add("blocker", "SUBMISSION_SCHEMA_ID_INVALID", "$.$schema", "Submission must bind the v2 schema URN.");
  if (submission.schemaVersion !== 2 || submission.standardVersion !== OPEN_WORLD_V2_STANDARD_VERSION) add("blocker", "SUBMISSION_VERSION_INVALID", "$", "Submission must use schemaVersion 2 and standardVersion 2.0.0.");
  requireSlug(submission.applicationId, "$.applicationId", "APPLICATION_ID_INVALID");
  if (!["proposal", "prototype"].includes(submission.stage)) add("blocker", "STAGE_INVALID", "$.stage", "Stage must be proposal or prototype.");

  const idea = parsedRecords.ideaSource ?? {};
  const intent = parsedRecords.intentContract ?? {};
  const architecture = parsedRecords.architectureDecisions ?? {};
  const fidelity = parsedRecords.intentFidelity ?? {};
  for (const [key, value, valuePath] of [
    ["ideaSource", idea, "$.records.ideaSource"],
    ["intentContract", intent, "$.records.intentContract"],
    ["architectureDecisions", architecture, "$.records.architectureDecisions"],
    ["intentFidelity", fidelity, "$.records.intentFidelity"],
    ["submission", submission, "$"]
  ]) {
    for (const issue of validateExtensionInstance(value, bundledSchemas[key], { trustedSchema: true })) {
      if (EXTENSION_SPLIT_REVIEW_CODES.has(issue.code)) {
        addSplitReason({ collection: `base-schema:${key}`, code: issue.code });
        add("split-review", "BASE_SCHEMA_SPLIT_REVIEW_REQUIRED", valuePath, issue.message, {
          schemaId: bundledSchemas[key].$id,
          schemaCode: issue.code,
          instancePath: issue.path,
          ideaEligibility: "ELIGIBLE_FOR_REVIEW",
          designEligible: true,
          automaticMaterialization: false
        });
      } else {
        add("blocker", "BASE_SCHEMA_INVALID", valuePath, issue.message, { schemaId: bundledSchemas[key].$id, schemaCode: issue.code, instancePath: issue.path });
      }
    }
  }
  if (submission.project?.repository !== null && !isPublicGitHubRepositoryTransport(submission.project?.repository)) {
    add(
      "review",
      "SOURCE_TRANSPORT_INTEGRATION_PENDING",
      "$.project.repository",
      "The proposal remains design-eligible, but Public Application v3 currently has a GitHub-only public-source transport. No source write or safety conclusion is performed for this repository transport.",
      {
        route: "INTEGRATION_PENDING",
        classification: "transport-integration",
        writePerformed: false
      }
    );
  }
  for (const [label, value] of [
    ["ideaSource", idea], ["intentContract", intent], ["architectureDecisions", architecture], ["intentFidelity", fidelity]
  ]) if (value.applicationId !== submission.applicationId) add("blocker", "APPLICATION_ID_MISMATCH", `$.records.${label}.applicationId`, "All records must bind the same applicationId.");
  if (intent.ideaSourceSha256 !== recordDigests.ideaSource) add("blocker", "INTENT_IDEA_DIGEST_MISMATCH", "$.records.intentContract.ideaSourceSha256", "Intent contract does not bind the exact idea-source bytes.");
  if (architecture.intentContractSha256 !== recordDigests.intentContract) add("blocker", "ARCHITECTURE_INTENT_DIGEST_MISMATCH", "$.records.architectureDecisions.intentContractSha256", "Architecture decisions do not bind the exact intent-contract bytes.");

  const ideaEntries = requireArray(idea.entries, "$.records.ideaSource.entries", "IDEA_ENTRIES_INVALID");
  const ideaEntryIds = idsFor(ideaEntries);
  for (const duplicate of duplicates(ideaEntries.map((entry) => entry?.id))) add("blocker", "IDEA_ENTRY_ID_DUPLICATE", "$.records.ideaSource.entries", "Idea entry IDs must be unique.", { id: duplicate });
  const priorIdeaIds = new Set();
  let hasRedaction = false;
  ideaEntries.forEach((entry, index) => {
    const entryPath = `$.records.ideaSource.entries[${index}]`;
    if (!requireObject(entry, entryPath, "IDEA_ENTRY_INVALID")) return;
    requireSlug(entry.id, `${entryPath}.id`);
    requireSlug(entry.kind, `${entryPath}.kind`);
    if (entry.sequence !== index + 1) add("blocker", "IDEA_SEQUENCE_INVALID", `${entryPath}.sequence`, "Idea entry sequence must be contiguous and append-only.");
    if (entry.authorRole !== "builder") add("blocker", "IDEA_AUTHOR_INVALID", `${entryPath}.authorRole`, "Only builder-authored source belongs in the public idea ledger.");
    if (!["public-safe", "withheld-sensitive", "redacted"].includes(entry.publicationStatus)) add("blocker", "PUBLICATION_STATUS_INVALID", `${entryPath}.publicationStatus`, "Unknown publication status.");
    if (entry.publicationStatus !== "public-safe") hasRedaction = true;
    if (typeof entry.publicTextUtf8 !== "string") add("blocker", "PUBLIC_TEXT_INVALID", `${entryPath}.publicTextUtf8`, "Public text must be UTF-8 JSON text.");
    else {
      if (hasLoneSurrogate(entry.publicTextUtf8)) add("blocker", "PUBLIC_TEXT_UNICODE_INVALID", `${entryPath}.publicTextUtf8`, "Public text contains an unpaired surrogate and cannot be preserved as exact Unicode.");
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(entry.publicTextUtf8)) add("blocker", "PUBLIC_TEXT_CONTROL_CHARACTER_FORBIDDEN", `${entryPath}.publicTextUtf8`, "Public text contains hidden control characters outside tab and line breaks.");
      if (/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(entry.publicTextUtf8)) add("blocker", "PUBLIC_TEXT_BIDI_REVIEW_REQUIRED", `${entryPath}.publicTextUtf8`, "Bidirectional control characters require a separate visible-source review before public packaging.");
      if (entry.sha256 !== sha256Utf8(entry.publicTextUtf8)) add("blocker", "IDEA_TEXT_HASH_MISMATCH", `${entryPath}.sha256`, "Public text SHA-256 does not match exact UTF-8 bytes.");
      if (entry.byteLength !== utf8ByteLength(entry.publicTextUtf8)) add("blocker", "IDEA_TEXT_LENGTH_MISMATCH", `${entryPath}.byteLength`, "Public text byte length does not match exact UTF-8 bytes.");
      const sourceBoundaries = byteBoundaries(entry.publicTextUtf8);
      const attestations = requireArray(entry.publicIdentifierAttestations, `${entryPath}.publicIdentifierAttestations`, "PUBLIC_IDENTIFIER_ATTESTATIONS_INVALID");
      const attestedPublicIdentifierRanges = [];
      for (const [attestationIndex, attestation] of attestations.entries()) {
        const attestationPath = `${entryPath}.publicIdentifierAttestations[${attestationIndex}]`;
        const rangeValid = isObject(attestation)
          && attestation.kind === "public-chain-identifier"
          && attestation.reviewerRole === "human-privacy-reviewer"
          && typeof attestation.reviewRecordRef === "string"
          && attestation.reviewRecordRef.length > 0
          && Number.isInteger(attestation.startByte)
          && Number.isInteger(attestation.endByte)
          && attestation.endByte > attestation.startByte
          && sourceBoundaries.has(attestation.startByte)
          && sourceBoundaries.has(attestation.endByte);
        const publicBytes = Buffer.from(entry.publicTextUtf8, "utf8");
        const classifiedBytes = rangeValid ? publicBytes.subarray(attestation.startByte, attestation.endByte) : Buffer.alloc(0);
        if (!rangeValid || attestation.byteLength !== classifiedBytes.length || attestation.sha256 !== sha256Bytes(classifiedBytes) || !/^(?:0x)?[0-9a-fA-F]{64}$/u.test(classifiedBytes.toString("utf8"))) {
          add("blocker", "PUBLIC_IDENTIFIER_ATTESTATION_INVALID", attestationPath, "Public-chain attestation must bind the exact UTF-8 span, digest, length, human privacy review, and one 32-byte identifier.");
        } else {
          attestedPublicIdentifierRanges.push({ startByte: attestation.startByte, endByte: attestation.endByte });
        }
      }
      const candidates = sensitiveCandidates(entry.publicTextUtf8).filter((candidate) => !(
        candidate.kind === "private-key-or-secret-hex"
        && (
          attestedPublicIdentifierRanges.some(({ startByte, endByte }) => candidate.startByte === startByte && candidate.endByte === endByte)
          || hasPublicChainIdentifierContext(entry.publicTextUtf8, candidate)
        )
      ));
      if (candidates.length > 0) add("blocker", "MANUAL_REDACTION_REQUIRED", `${entryPath}.publicTextUtf8`, "Potential secret, key, token, seed phrase, or private PII must be manually removed before public packaging.", { candidateKinds: [...new Set(candidates.map(({ kind }) => kind))].sort() });
      if (entry.publicationStatus !== "public-safe" && /(?:sha256:)?[0-9a-fA-F]{64}/u.test(entry.publicTextUtf8)) add("blocker", "REDACTION_LEAKY_HASH_FORBIDDEN", `${entryPath}.publicTextUtf8`, "A public redaction must not include the private original or its brute-forceable hash.");
    }
    if (entry.publicationStatus === "public-safe" && entry.redactionReason !== null) add("blocker", "PUBLIC_SAFE_REDACTION_CONFLICT", `${entryPath}.redactionReason`, "Public-safe text cannot declare a redaction reason.");
    if (entry.publicationStatus !== "public-safe" && typeof entry.redactionReason !== "string") add("blocker", "REDACTION_REASON_MISSING", `${entryPath}.redactionReason`, "Redacted or withheld text needs a non-secret reason.");
    for (const superseded of requireArray(entry.supersedes, `${entryPath}.supersedes`, "SUPERSEDES_INVALID")) if (!priorIdeaIds.has(superseded)) add("blocker", "IDEA_SUPERSEDES_FORWARD_REF", `${entryPath}.supersedes`, "An append-only entry may supersede only an earlier entry.");
    priorIdeaIds.add(entry.id);
  });
  if (idea.captureStatus === "unavailable-legacy") {
    if (ideaEntries.length !== 0 || idea.originalEntryId !== null || !Array.isArray(idea.legacySourceRefs) || idea.legacySourceRefs.length === 0) add("blocker", "LEGACY_CAPTURE_INVALID", "$.records.ideaSource", "Unavailable legacy capture needs no fabricated entries, null originalEntryId, and at least one legacy source reference.");
  } else {
    if (!ideaEntryIds.has(idea.originalEntryId)) add("blocker", "ORIGINAL_IDEA_REF_INVALID", "$.records.ideaSource.originalEntryId", "originalEntryId must reference a captured public entry.");
    const expectedCapture = hasRedaction ? "redacted-sensitive" : "captured-verbatim-public-safe";
    if (idea.captureStatus !== expectedCapture) add("blocker", "CAPTURE_STATUS_INCONSISTENT", "$.records.ideaSource.captureStatus", `Capture status must be ${expectedCapture}.`);
  }

  const entities = requireArray(intent.entities, "$.records.intentContract.entities", "INTENT_ENTITIES_INVALID");
  const entityIds = idsFor(entities);
  const facts = requireArray(intent.facts, "$.records.intentContract.facts", "INTENT_FACTS_INVALID");
  const factIds = idsFor(facts);
  const ambiguities = requireArray(intent.ambiguities, "$.records.intentContract.ambiguities", "INTENT_AMBIGUITIES_INVALID");
  const ambiguityIds = idsFor(ambiguities);
  const routeIds = new Set(["DIRECT_BUILD", "CUSTOM_ARCHITECTURE", "INTEGRATION_PENDING", "SAFE_REDESIGN"]);
  if (!isObject(intent.route) || !routeIds.has(intent.route.id) || !Array.isArray(intent.route.reasons) || intent.route.reasons.length === 0 || !Array.isArray(intent.route.blockedByRefs)) add("blocker", "INTENT_ROUTE_INVALID", "$.records.intentContract.route", "Intent contract must choose exactly one workflow route with reasons and blocker references.");
  else {
    for (const ref of intent.route.blockedByRefs) if (!factIds.has(ref) && !ambiguityIds.has(ref)) add("blocker", "INTENT_ROUTE_BLOCK_REF_MISSING", "$.records.intentContract.route.blockedByRefs", "Workflow route references an unknown fact or ambiguity.", { ref });
    if (["INTEGRATION_PENDING", "SAFE_REDESIGN"].includes(intent.route.id)) add(submission.stage === "prototype" ? "blocker" : "review", "INTENT_ROUTE_REVIEW_REQUIRED", "$.records.intentContract.route", "The selected workflow route requires integration or builder-approved redesign work; the idea remains eligible.");
  }
  for (const duplicate of duplicates(facts.map((fact) => fact?.id))) add("blocker", "INTENT_FACT_ID_DUPLICATE", "$.records.intentContract.facts", "Intent fact IDs must be unique.", { id: duplicate });
  for (const duplicate of duplicates(entities.map((entity) => entity?.id))) add("blocker", "INTENT_ENTITY_ID_DUPLICATE", "$.records.intentContract.entities", "Intent entity IDs must be unique.", { id: duplicate });
  for (const duplicate of duplicates(ambiguities.map((item) => item?.id))) add("blocker", "AMBIGUITY_ID_DUPLICATE", "$.records.intentContract.ambiguities", "Ambiguity IDs must be unique.", { id: duplicate });
  facts.forEach((fact, index) => {
    const factPath = `$.records.intentContract.facts[${index}]`;
    if (!requireObject(fact, factPath, "INTENT_FACT_INVALID")) return;
    requireSlug(fact.id, `${factPath}.id`);
    requireSlug(fact.kind, `${factPath}.kind`);
    validateSchemaBinding(fact.payloadSchema, fact.semanticPayload, `${factPath}.payloadSchema`, "intent-fact");
    for (const subjectRef of requireArray(fact.subjectRefs, `${factPath}.subjectRefs`, "FACT_SUBJECT_REFS_INVALID")) if (!entityIds.has(subjectRef)) add("blocker", "FACT_ENTITY_REF_MISSING", `${factPath}.subjectRefs`, "Intent fact references an unknown entity.", { ref: subjectRef });
    for (const [provenanceIndex, provenance] of requireArray(fact.provenance, `${factPath}.provenance`, "FACT_PROVENANCE_INVALID").entries()) {
      const provenancePath = `${factPath}.provenance[${provenanceIndex}]`;
      if (!isObject(provenance)) {
        add("blocker", "FACT_PROVENANCE_INVALID", provenancePath, "Fact provenance must be an object.");
        continue;
      }
      if (idea.captureStatus === "unavailable-legacy") {
        if (provenance.ideaEntryId !== null || provenance.relation !== "legacy-derived" || !idea.legacySourceRefs?.includes(provenance.legacySourceRef)) add("blocker", "LEGACY_PROVENANCE_INVALID", provenancePath, "Legacy provenance must reference an exact declared legacy source without fabricating public text.");
        continue;
      }
      const source = ideaEntries.find((entry) => entry?.id === provenance.ideaEntryId);
      if (!source || provenance.legacySourceRef !== null || provenance.relation === "legacy-derived") {
        add("blocker", "FACT_PROVENANCE_REF_INVALID", provenancePath, "Fact provenance must reference a captured public idea entry.");
        continue;
      }
      const boundaries = byteBoundaries(source.publicTextUtf8 ?? "");
      if (!Number.isInteger(provenance.startByte) || !Number.isInteger(provenance.endByte) || provenance.startByte < 0 || provenance.endByte <= provenance.startByte || !boundaries.has(provenance.startByte) || !boundaries.has(provenance.endByte)) add("blocker", "FACT_PROVENANCE_BYTE_RANGE_INVALID", provenancePath, "Provenance byte range must be non-empty and align to exact UTF-8 character boundaries.");
    }
  });
  ambiguities.forEach((ambiguity, index) => {
    const ambiguityPath = `$.records.intentContract.ambiguities[${index}]`;
    if (!requireObject(ambiguity, ambiguityPath, "AMBIGUITY_INVALID")) return;
    requireSlug(ambiguity.id, `${ambiguityPath}.id`);
    for (const factRef of requireArray(ambiguity.factRefs, `${ambiguityPath}.factRefs`, "AMBIGUITY_FACT_REFS_INVALID")) if (!factIds.has(factRef)) add("blocker", "AMBIGUITY_FACT_REF_MISSING", `${ambiguityPath}.factRefs`, "Ambiguity references an unknown fact.", { ref: factRef });
    const optionIds = idsFor(ambiguity.options);
    if (ambiguity.selectedOptionId !== null && !optionIds.has(ambiguity.selectedOptionId)) add("blocker", "AMBIGUITY_SELECTION_INVALID", `${ambiguityPath}.selectedOptionId`, "Selected option does not exist.");
    if (ambiguity.defaultOptionId !== null && !optionIds.has(ambiguity.defaultOptionId)) add("blocker", "AMBIGUITY_DEFAULT_INVALID", `${ambiguityPath}.defaultOptionId`, "Default option does not exist.");
    if (ambiguity.resolutionIdeaEntryId !== null && !ideaEntryIds.has(ambiguity.resolutionIdeaEntryId)) add("blocker", "AMBIGUITY_RESOLUTION_SOURCE_MISSING", `${ambiguityPath}.resolutionIdeaEntryId`, "Resolution source entry does not exist.");
    if (ambiguity.status === "open" && ambiguity.factRefs?.some((ref) => ["core", "material"].includes(facts.find((fact) => fact?.id === ref)?.materiality))) add(submission.stage === "prototype" ? "blocker" : "review", "MATERIAL_AMBIGUITY_OPEN", ambiguityPath, "A material ambiguity remains visible and must be resolved or explicitly delegated before prototype readiness.");
    if (["resolved", "delegated-default"].includes(ambiguity.status) && ambiguity.selectedOptionId === null) add("blocker", "AMBIGUITY_RESOLUTION_SELECTION_MISSING", `${ambiguityPath}.selectedOptionId`, "Resolved or delegated ambiguity needs one selected option.");
  });
  const confirmation = intent.confirmation;
  const confirmedFactIds = new Set(confirmation?.confirmedFactIds ?? []);
  const delegatedFactIds = new Set(confirmation?.delegatedDefaultFactIds ?? []);
  for (const id of confirmedFactIds) if (delegatedFactIds.has(id)) add("blocker", "INTENT_CONFIRMATION_OVERLAP", "$.records.intentContract.confirmation", "A fact cannot be both builder-confirmed and delegated.", { factId: id });
  if (submission.stage === "prototype") {
    if (idea.captureStatus === "unavailable-legacy" || intent.status === "legacy-unconfirmed" || confirmation?.state === "legacy-unconfirmed") add("blocker", "LEGACY_PROTOTYPE_FORBIDDEN", "$.records.intentContract", "Legacy-unconfirmed intent is proposal-only until the builder recaptures and confirms it.");
    if (!["builder-confirmed", "delegated-defaults"].includes(intent.status) || !["builder-confirmed", "delegated-defaults"].includes(confirmation?.state)) add("blocker", "PROTOTYPE_INTENT_CONFIRMATION_MISSING", "$.records.intentContract.confirmation", "Prototype stage requires builder confirmation or an explicit delegated-default contract.");
    for (const fact of facts.filter((candidate) => ["core", "material"].includes(candidate?.materiality))) {
      if (fact.state === "confirmed" && !confirmedFactIds.has(fact.id)) add("blocker", "CONFIRMED_FACT_NOT_BOUND", "$.records.intentContract.confirmation.confirmedFactIds", "Confirmed material fact is absent from the builder confirmation set.", { factId: fact.id });
      else if (fact.state === "default-proposed" && !delegatedFactIds.has(fact.id)) add("blocker", "DELEGATED_FACT_NOT_BOUND", "$.records.intentContract.confirmation.delegatedDefaultFactIds", "Delegated material fact is absent from the delegated-default set.", { factId: fact.id });
      else if (!["confirmed", "default-proposed"].includes(fact.state)) add("blocker", "PROTOTYPE_MATERIAL_FACT_UNCONFIRMED", "$.records.intentContract.facts", "Every core or material fact must be confirmed or explicitly delegated before prototype readiness.", { factId: fact.id, state: fact.state });
    }
  } else if (idea.captureStatus === "unavailable-legacy" || !["builder-confirmed", "delegated-defaults"].includes(intent.status)) {
    add("review", "INTENT_CONFIRMATION_REQUIRED", "$.records.intentContract.confirmation", "Proposal remains valid but requires builder recapture or confirmation before prototype work can be called ready.");
  }

  const decisions = requireArray(architecture.decisions, "$.records.architectureDecisions.decisions", "ARCHITECTURE_DECISIONS_INVALID");
  const decisionIds = idsFor(decisions);
  for (const duplicate of duplicates(decisions.map((decision) => decision?.id))) add("blocker", "DECISION_ID_DUPLICATE", "$.records.architectureDecisions.decisions", "Architecture decision IDs must be unique.", { id: duplicate });
  decisions.forEach((decision, index) => {
    const decisionPath = `$.records.architectureDecisions.decisions[${index}]`;
    if (!requireObject(decision, decisionPath, "ARCHITECTURE_DECISION_INVALID")) return;
    requireSlug(decision.id, `${decisionPath}.id`);
    requireSlug(decision.kind, `${decisionPath}.kind`);
    if (decision.sequence !== index + 1) add("blocker", "DECISION_SEQUENCE_INVALID", `${decisionPath}.sequence`, "Decision sequence must be contiguous and append-only.");
    validateSchemaBinding(decision.decisionSchema, decision.decisionPayload, `${decisionPath}.decisionSchema`, "architecture-decision");
    for (const ref of requireArray(decision.factRefs, `${decisionPath}.factRefs`, "DECISION_FACT_REFS_INVALID")) if (!factIds.has(ref)) add("blocker", "DECISION_FACT_REF_MISSING", `${decisionPath}.factRefs`, "Decision references an unknown intent fact.", { ref });
    for (const ref of requireArray(decision.ambiguityRefs, `${decisionPath}.ambiguityRefs`, "DECISION_AMBIGUITY_REFS_INVALID")) if (!ambiguityIds.has(ref)) add("blocker", "DECISION_AMBIGUITY_REF_MISSING", `${decisionPath}.ambiguityRefs`, "Decision references an unknown ambiguity.", { ref });
    const alternativeIds = idsFor(decision.alternatives);
    if (decision.status === "selected" && !alternativeIds.has(decision.selectedAlternativeId)) add("blocker", "DECISION_SELECTION_INVALID", `${decisionPath}.selectedAlternativeId`, "Selected decision needs an existing alternative.");
    if (decision.status !== "selected" && decision.selectedAlternativeId !== null) add("blocker", "DECISION_SELECTION_STATUS_CONFLICT", `${decisionPath}.selectedAlternativeId`, "Only selected decisions may bind a selected alternative.");
  });

  context.intentState = {
    idea,
    intent,
    architecture,
    fidelity,
    ideaEntries,
    facts,
    factIds,
    decisions,
    decisionIds
  };
}
