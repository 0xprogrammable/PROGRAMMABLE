import { ASSESSMENT_STATES, IMPLEMENTATION_STAGES, LAYERS, PROFILE_FIELDS } from "./open-world-security-constants.mjs";
import {
  hasOwn,
  isObject,
  jsonTreeIsValid,
  mergeObservations,
  nonEmptyText,
  uniqueObjects,
  uniqueStrings
} from "./open-world-security-shared.mjs";

export function analyzeAssessmentCompleteness(input, add) {
  const assessment = input?.assessment;
  if (!isObject(assessment) || !ASSESSMENT_STATES.includes(assessment.state)) return;
  const stage = input?.subject?.stage;
  if (assessment.state === "unassessed") {
    add(
      "INDEPENDENT_REVIEW",
      "SECURITY_ASSESSMENT_UNASSESSED",
      "$.assessment.state",
      "No source security assessment has been performed yet.",
      "Keep the idea eligible, then assess the exact content-addressed source closure before implementation or launch authorization.",
      { reviewId: "source-security-assessment" }
    );
  } else if (assessment.state === "partial") {
    add(
      "INDEPENDENT_REVIEW",
      "SECURITY_ASSESSMENT_PARTIAL",
      "$.assessment.state",
      "The security assessment is explicitly partial and does not claim complete source coverage.",
      "Preserve the partial evidence and complete review against an exact content-addressed source closure.",
      { reviewId: "source-security-assessment" }
    );
  }
  if (IMPLEMENTATION_STAGES.has(stage) && assessment.state !== "source-assessed") {
    add(
      "CHANGES_REQUIRED",
      "SECURITY_ASSESSMENT_INCOMPLETE_FOR_STAGE",
      "$.assessment.state",
      `${stage} security evidence cannot remain ${assessment.state}.`,
      "Bind a complete source-assessed record to every exact inline or manifest repository closure, or move the package back to proposal review."
    );
  }
  if (assessment.state === "source-assessed") {
    const semanticObservationsPresent = hasSourceSemanticObservations(input);
    add(
      "INDEPENDENT_REVIEW",
      "SOURCE_SEMANTIC_COVERAGE_UNPROVEN",
      "$.layers.source",
      semanticObservationsPresent
        ? "The source assessment contains applicant-supplied semantic observations, but no independent verifier authority can be inferred from fields or content hashes alone."
        : "Byte-complete source coverage contains no source-derived security profile or provenance-bound analyzer finding, so semantic risk coverage is unproven.",
      "Carry the exact closure, profiles, analyzer reports, and unknown mechanisms into independent source review; only that separate authority may clear semantic coverage.",
      {
        reviewId: "source-semantic-coverage",
        semanticObservationsPresent,
        applicantAttestationIsIndependentEvidence: false
      }
    );
  }
}

export function hasSourceSemanticObservations(input) {
  const sourceLayer = input?.layers?.source;
  if (!isObject(sourceLayer)) return false;
  if (Array.isArray(sourceLayer.customProfiles) && sourceLayer.customProfiles.length > 0) return true;
  if (Array.isArray(input?.automatedFindings) && input.automatedFindings.length > 0) return true;
  return Object.entries(sourceLayer).some(([profileName, profile]) => (
    PROFILE_FIELDS[profileName] !== undefined
    && isObject(profile)
    && Object.entries(profile).some(([field, value]) => field !== "evidenceRefs" && value !== null)
  ));
}

export function analyzeCustomProfiles(input, add) {
  const entries = [];
  for (const [index, profile] of (Array.isArray(input?.extensions) ? input.extensions : []).entries()) {
    if (isObject(profile) && nonEmptyText(profile.id)) entries.push({ layer: "extension", path: `$.extensions[${index}]`, profile });
  }
  for (const layer of LAYERS) {
    for (const [index, profile] of (Array.isArray(input?.layers?.[layer]?.customProfiles) ? input.layers[layer].customProfiles : []).entries()) {
      if (isObject(profile) && nonEmptyText(profile.id)) entries.push({ layer, path: `$.layers.${layer}.customProfiles[${index}]`, profile });
    }
  }

  const grouped = new Map();
  for (const entry of entries) {
    if (!grouped.has(entry.profile.id)) grouped.set(entry.profile.id, []);
    grouped.get(entry.profile.id).push(entry);
  }

  const reports = [];
  for (const [id, profileEntries] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const customPath = `$.customProfiles[${JSON.stringify(id)}]`;
    const evidenceRefs = uniqueStrings(profileEntries.flatMap(({ profile }) => Array.isArray(profile.evidenceRefs) ? profile.evidenceRefs : []));
    const declaredRisks = uniqueStrings(profileEntries.flatMap(({ profile }) => Array.isArray(profile.declaredRisks) ? profile.declaredRisks : []));
    const controls = uniqueStrings(profileEntries.flatMap(({ profile }) => Array.isArray(profile.controls) ? profile.controls : []));
    const declaredUnresolved = uniqueStrings(profileEntries.flatMap(({ profile }) => Array.isArray(profile.unresolved) ? profile.unresolved : []));
    const resolutions = uniqueObjects(
      profileEntries.flatMap(({ layer, profile }) => (Array.isArray(profile.resolutions) ? profile.resolutions : [])
        .filter((resolution) => isObject(resolution) && nonEmptyText(resolution.question) && nonEmptyText(resolution.resolution) && Array.isArray(resolution.evidenceRefs) && resolution.evidenceRefs.length > 0)
        .map((resolution) => ({
          layer,
          question: resolution.question,
          resolution: resolution.resolution,
          evidenceRefs: uniqueStrings(resolution.evidenceRefs)
        }))),
      (resolution) => `${resolution.layer}:${resolution.question}:${resolution.resolution}:${resolution.evidenceRefs.join("|")}`
    );
    const unresolved = declaredUnresolved.filter((question) => !resolutions.some((resolution) => resolution.question === question));
    const summaries = uniqueStrings(profileEntries.map(({ profile }) => profile.summary));
    const schemaRefs = uniqueStrings(profileEntries.map(({ profile }) => profile.schemaRef));
    const mergedFacts = {};
    const factKeys = new Set();
    for (const { profile } of profileEntries) {
      if (isObject(profile.facts) && jsonTreeIsValid(profile.facts)) {
        for (const key of Object.keys(profile.facts)) factKeys.add(key);
      }
    }
    for (const factKey of [...factKeys].sort()) {
      const factEntries = profileEntries
        .filter(({ profile }) => isObject(profile.facts) && hasOwn(profile.facts, factKey) && jsonTreeIsValid(profile.facts[factKey]));
      const observations = factEntries
        .filter(({ profile }) => profile.facts[factKey] !== null)
        .map(({ layer, path, profile }) => ({ layer, value: profile.facts[factKey], evidenceRefs: profile.evidenceRefs ?? [], path: `${path}.facts[${JSON.stringify(factKey)}]` }));
      const unknownLayers = factEntries.filter(({ profile }) => profile.facts[factKey] === null).map(({ layer }) => layer);
      mergedFacts[factKey] = mergeObservations(observations, unknownLayers);
      if (mergedFacts[factKey].state === "conflict") {
        add(
          "CHANGES_REQUIRED",
          "OPEN_WORLD_CUSTOM_FACT_CONFLICT",
          `${customPath}.facts[${JSON.stringify(factKey)}]`,
          `Custom security profile ${id} has contradictory observations for fact ${factKey}.`,
          "Keep both observations visible, reconcile the source or runtime behavior, and update the profile evidence without deleting the novel risk boundary.",
          { observations: mergedFacts[factKey].observations }
        );
      }
    }

    if (schemaRefs.length > 1) {
      add(
        "CHANGES_REQUIRED",
        "OPEN_WORLD_CUSTOM_SCHEMA_CONFLICT",
        `${customPath}.schemaRef`,
        `Custom security profile ${id} references multiple schema bindings.`,
        "Pin one reviewed schema revision or document an explicit compatible migration."
      );
    }
    for (const resolution of resolutions) {
      if (!declaredUnresolved.includes(resolution.question)) {
        add(
          "CHANGES_REQUIRED",
          "OPEN_WORLD_CUSTOM_RESOLUTION_UNBOUND",
          `${customPath}.resolutions`,
          `Custom security profile ${id} resolves a question that is not present in its declared unresolved set.`,
          "Bind the resolution to the exact unresolved question text so the historical concern remains auditable."
        );
      }
    }
    if (declaredRisks.length === 0) {
      add(
        "CHANGES_REQUIRED",
        "OPEN_WORLD_CUSTOM_RISK_UNDECLARED",
        `${customPath}.declaredRisks`,
        `Custom security profile ${id} declares no concrete risk boundary.`,
        "Describe at least one authority, privacy, value, liveness, proof, replay or dependency risk in plain language."
      );
    }
    if (controls.length === 0) {
      add(
        "CHANGES_REQUIRED",
        "OPEN_WORLD_CUSTOM_CONTROLS_UNRESOLVED",
        `${customPath}.controls`,
        `Custom security profile ${id} has no declared control yet.`,
        "Keep the idea eligible, then define enforceable controls and evidence before implementation approval."
      );
    }
    if (unresolved.length > 0) {
      add(
        "CHANGES_REQUIRED",
        "OPEN_WORLD_CUSTOM_QUESTIONS_UNRESOLVED",
        `${customPath}.unresolved`,
        `Custom security profile ${id} still has unresolved security questions.`,
        "Resolve or explicitly bound each open question before launch authorization; do not delete the profile to make the check pass.",
        { unresolved }
      );
    }
    add(
      "INDEPENDENT_REVIEW",
      "OPEN_WORLD_CUSTOM_PROFILE_REVIEW",
      customPath,
      `Novel security boundary ${id} remains eligible and requires independent architecture review.`,
      "Review the open facts, schema binding, declared risks, controls, unresolved questions and evidence on their own merits.",
      { reviewId: `custom-profile-${id}` }
    );
    reports.push({
      id,
      layers: [...new Set(profileEntries.map(({ layer }) => layer))],
      summaries,
      schemaRef: schemaRefs.length === 1 ? schemaRefs[0] : null,
      schemaRefs,
      facts: mergedFacts,
      declaredRisks,
      controls,
      unresolved,
      declaredUnresolved,
      resolutions,
      reviewRoute: "independent-review",
      evidenceRefs,
      eligibility: "IDEA_ELIGIBLE"
    });
  }
  return reports;
}
