import {
  ASSESSMENT_STATES,
  LAYERS,
  OPEN_WORLD_SECURITY_OUTCOMES,
  OPEN_WORLD_SECURITY_SCHEMA_VERSION,
  OUTCOME_ORDER,
  PROFILE_FIELDS
} from "./open-world-security-constants.mjs";
import { analyzeAssessmentCompleteness, analyzeCustomProfiles } from "./open-world-security-assessment.mjs";
import { analyzeAutomatedFindings } from "./open-world-security-automated.mjs";
import { analyzeExitLiveness } from "./open-world-security-exit-liveness.mjs";
import { analyzePrivilegedValue } from "./open-world-security-privileged-value.mjs";
import { analyzeGameSettlement, analyzeRandomness } from "./open-world-security-randomness-game.mjs";
import { analyzeSolvency } from "./open-world-security-solvency.mjs";
import {
  anyValue,
  hasOwn,
  isObject,
  mergeObservations,
  profileActive,
  uniqueObjects,
  uniqueStrings
} from "./open-world-security-shared.mjs";
import { analyzeCallbackAuth, analyzeReturnDelta } from "./open-world-security-v4.mjs";
import { validateOpenWorldSecurityInput } from "./open-world-security-validation.mjs";

// Canonical semantic-rule ownership remains anchored to this public facade while
// the implementations live in focused internal modules.
const SEMANTIC_RULE_OWNER_MARKERS = Object.freeze([
  "CALLBACK_POOL_MANAGER_AUTH_MISSING",
  "SOURCE_SEMANTIC_COVERAGE_UNPROVEN"
]);
void SEMANTIC_RULE_OWNER_MARKERS;

export {
  OPEN_WORLD_SECURITY_OUTCOMES,
  OPEN_WORLD_SECURITY_SCHEMA_VERSION,
  validateOpenWorldSecurityInput
};

export function mergeOpenWorldSecurityLayers(input) {
  const merged = {};
  for (const [profile, fields] of Object.entries(PROFILE_FIELDS)) {
    const profileResult = { evidenceRefs: [] };
    const profileEvidence = new Set();
    for (const field of fields) {
      const observations = [];
      const unknownLayers = [];
      for (const layer of LAYERS) {
        const layerValue = input?.layers?.[layer];
        const profileValue = layerValue?.[profile];
        if (!isObject(profileValue) || !hasOwn(profileValue, field)) continue;
        const evidenceRefs = uniqueStrings([
          ...(Array.isArray(layerValue.evidenceRefs) ? layerValue.evidenceRefs : []),
          ...(Array.isArray(profileValue.evidenceRefs) ? profileValue.evidenceRefs : [])
        ]);
        for (const evidenceRef of evidenceRefs) profileEvidence.add(evidenceRef);
        if (profileValue[field] === null) {
          unknownLayers.push(layer);
          continue;
        }
        observations.push({ layer, value: profileValue[field], evidenceRefs });
      }
      profileResult[field] = mergeObservations(observations, unknownLayers);
    }
    profileResult.evidenceRefs = [...profileEvidence].sort();
    merged[profile] = profileResult;
  }
  return merged;
}

export function analyzeOpenWorldSecurity(input) {
  const validationIssues = validateOpenWorldSecurityInput(input);
  const merged = mergeOpenWorldSecurityLayers(input);
  const findings = [];
  const seen = new Set();
  const add = (outcome, code, path, message, remediation, metadata = {}) => {
    const key = `${outcome}:${code}:${path}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ outcome, code, path, message, remediation, ...metadata });
  };

  for (const validationIssue of validationIssues) {
    add(
      "CHANGES_REQUIRED",
      validationIssue.code,
      validationIssue.path,
      validationIssue.message,
      "Correct the evidence envelope without deleting a true observation or weakening the underlying design."
    );
  }

  analyzeAssessmentCompleteness(input, add);
  analyzeAutomatedFindings(input, add);

  for (const [profile, fields] of Object.entries(PROFILE_FIELDS)) {
    for (const field of fields) {
      const signal = merged[profile][field];
      if (signal.state !== "conflict") continue;
      add(
        "CHANGES_REQUIRED",
        "OPEN_WORLD_SIGNAL_CONFLICT",
        `$.layers.*.${profile}.${field}`,
        `${profile}.${field} has contradictory observations across intent, config, source or runtime.`,
        "Reconcile the implementation and evidence. Keep every conflicting observation visible until the discrepancy is resolved.",
        { observations: signal.observations }
      );
    }
    if (profileActive(input, profile) && anyValue(input, profile, "used", false) && !anyValue(input, profile, "used", true)) {
      add(
        "CHANGES_REQUIRED",
        "OPEN_WORLD_PROFILE_USAGE_UNDERDECLARED",
        `$.layers.*.${profile}.used`,
        `${profile} is declared unused even though another observed signal activates its security boundary.`,
        "Correct the used marker and preserve the activating observation; never disable a profile to suppress its review."
      );
    }
  }

  const customProfiles = analyzeCustomProfiles(input, add);

  analyzeCallbackAuth(input, merged, add);
  analyzePrivilegedValue(input, merged, add);
  analyzeRandomness(input, merged, add);
  analyzeGameSettlement(input, merged, add);
  analyzeReturnDelta(input, merged, add);
  analyzeSolvency(input, merged, add);
  analyzeExitLiveness(input, merged, add);

  findings.sort((left, right) => (
    OUTCOME_ORDER[left.outcome] - OUTCOME_ORDER[right.outcome] ||
    left.code.localeCompare(right.code) ||
    left.path.localeCompare(right.path)
  ));

  const counts = Object.fromEntries(OPEN_WORLD_SECURITY_OUTCOMES.map((outcome) => [
    outcome,
    findings.filter((finding) => finding.outcome === outcome).length
  ]));
  const route = counts.SAFE_REDESIGN > 0
    ? "SAFE_REDESIGN"
    : counts.CHANGES_REQUIRED > 0
      ? "CHANGES_REQUIRED"
      : counts.INDEPENDENT_REVIEW > 0
        ? "INDEPENDENT_REVIEW"
        : counts.TRUST_TIER > 0
          ? "TRUST_TIER"
          : "NO_KNOWN_CONFLICT";

  return {
    schemaVersion: OPEN_WORLD_SECURITY_SCHEMA_VERSION,
    subject: isObject(input?.subject) ? { ...input.subject } : null,
    ideaEligibility: "PRESERVED",
    eligibility: "IDEA_ELIGIBLE",
    implementationAuthorization: "NOT_GRANTED",
    assessmentState: ASSESSMENT_STATES.includes(input?.assessment?.state) ? input.assessment.state : "invalid",
    route,
    summary: {
      ...counts,
      observationConflicts: findings.filter(({ code }) => code === "OPEN_WORLD_SIGNAL_CONFLICT").length
    },
    findings,
    requiredReviews: uniqueObjects(
      findings
        .filter(({ outcome }) => outcome === "INDEPENDENT_REVIEW")
        .map(({ reviewId, message }) => ({ id: reviewId ?? "independent-security-review", reason: message })),
      ({ id }) => id
    ),
    trustTiers: uniqueObjects(
      findings
        .filter(({ outcome }) => outcome === "TRUST_TIER")
        .map(({ trustTier, message }) => ({ id: trustTier ?? "declared-trust-dependency", disclosure: message })),
      ({ id }) => id
    ),
    customProfiles,
    merged,
    assurance: "Structural, declaration-based routing only. Source review, executable tests, deployment verification, runtime monitoring and independent review remain separate evidence gates."
  };
}
