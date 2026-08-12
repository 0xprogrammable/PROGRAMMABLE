import {
  AUTOMATED_CONFIRMATION_STATUSES,
  AUTOMATED_FINDING_CATEGORIES,
  AUTOMATED_FINDING_CONFIDENCE,
  AUTOMATED_FINDING_LANGUAGE_PROFILES,
  AUTOMATED_FINDING_STATUSES,
  automatedFindingLanguageIdentifierPattern,
  openSlugPattern,
  safeRepositoryPathPattern,
  sha256Pattern
} from "./open-world-security-constants.mjs";
import { isObject, nonEmptyText, rejectUnknownKeys, validateEvidenceRefs } from "./open-world-security-shared.mjs";

export function analyzeAutomatedFindings(input, add) {
  for (const [index, finding] of (Array.isArray(input?.automatedFindings) ? input.automatedFindings : []).entries()) {
    if (!isObject(finding)) continue;
    const findingPath = `$.automatedFindings[${index}]`;
    const scopeResolution = automatedFindingScopeResolution(finding);
    const metadata = {
      reviewId: `automated-finding-${openSlugPattern.test(finding.id ?? "") ? finding.id : index + 1}`,
      automatedFindingId: typeof finding.id === "string" ? finding.id : null,
      ruleId: typeof finding.rule?.id === "string" ? finding.rule.id : null,
      ruleScope: typeof finding.rule?.scope === "string" ? finding.rule.scope : null,
      sourceTool: typeof finding.source?.tool === "string" ? finding.source.tool : null,
      sourceToolVersion: typeof finding.source?.toolVersion === "string" ? finding.source.toolVersion : null,
      sourceReportRef: typeof finding.source?.reportRef === "string" ? finding.source.reportRef : null,
      sourceReportSha256: sha256Pattern.test(finding.source?.reportSha256 ?? "") ? finding.source.reportSha256 : null,
      confidence: AUTOMATED_FINDING_CONFIDENCE.has(finding.confidence) ? finding.confidence : null,
      confirmationStatus: AUTOMATED_FINDING_STATUSES.has(finding.status) ? finding.status : null,
      objectiveCategory: AUTOMATED_FINDING_CATEGORIES.has(finding.category) ? finding.category : null,
      language: isAutomatedFindingLanguageIdentifier(finding.language) ? finding.language : null,
      repositoryPath: typeof finding.repositoryPath === "string" ? finding.repositoryPath : null,
      scopeMatched: scopeResolution.matches === true,
      languageProfileKnown: scopeResolution.profileKnown
    };

    if (scopeResolution.reason === "profile-unavailable") {
      add(
        "INDEPENDENT_REVIEW",
        "AUTOMATED_FINDING_LANGUAGE_PROFILE_UNAVAILABLE",
        findingPath,
        "The scanner uses a safe, explicit language identifier for which this verifier has no path-profile rule.",
        "Keep the finding reviewable, verify the tool's language and path scope independently, and add a versioned profile later without rejecting the project language.",
        metadata
      );
      continue;
    }

    if (scopeResolution.matches !== true) {
      add(
        "INDEPENDENT_REVIEW",
        "AUTOMATED_FINDING_LANGUAGE_SCOPE_MISMATCH",
        findingPath,
        "A language-specific scanner rule was reported outside its declared language and repository-path scope.",
        "Retain the provenance-bound observation, rerun a rule set for the actual language, and require independent review; do not treat the mismatch as a confirmed product defect.",
        metadata
      );
      continue;
    }

    if (AUTOMATED_CONFIRMATION_STATUSES.has(finding.status) && ["drain", "deception"].includes(finding.category)) {
      add(
        "SAFE_REDESIGN",
        "AUTOMATED_CONFIRMED_DRAIN_OR_DECEPTION",
        findingPath,
        "A correctly scoped drain or deception mechanism is explicitly confirmed by the builder or an independent reviewer.",
        "Preserve the product goal, redesign the unsafe mechanism, and assess the exact replacement source closure; this confirmation has no self-waiver path.",
        metadata
      );
      continue;
    }

    add(
      "INDEPENDENT_REVIEW",
      "AUTOMATED_FINDING_INDEPENDENT_REVIEW_REQUIRED",
      findingPath,
      "A provenance-bound automated, partial, disputed, or non-drain/deception finding remains unresolved.",
      "Keep the finding, tool identity, report digest, confidence, status and evidence visible for independent review; automation or dispute cannot become an objective product blocker or a self-waiver.",
      metadata
    );
  }
}

export function validateAutomatedFindings(value, path, issue) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue("OPEN_WORLD_AUTOMATED_FINDINGS_TYPE", path, "automatedFindings must be an array of provenance-bound scanner observations.");
    return;
  }
  const ids = new Set();
  for (const [index, finding] of value.entries()) {
    const findingPath = `${path}[${index}]`;
    if (!isObject(finding)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_TYPE", findingPath, "Each automated finding must be one closed object.");
      continue;
    }
    rejectUnknownKeys(finding, new Set([
      "id",
      "rule",
      "source",
      "confidence",
      "status",
      "language",
      "repositoryPath",
      "category",
      "message",
      "evidenceRefs"
    ]), findingPath, issue);
    if (!openSlugPattern.test(finding.id ?? "") || finding.id.length > 120) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_ID", `${findingPath}.id`, "Automated finding id must be one lowercase open slug.");
    } else if (ids.has(finding.id)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_ID_DUPLICATE", `${findingPath}.id`, "Each automated finding id must be unique.");
    } else {
      ids.add(finding.id);
    }

    if (!isObject(finding.rule)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_RULE", `${findingPath}.rule`, "Automated finding rule must bind one rule id and language scope.");
    } else {
      rejectUnknownKeys(finding.rule, new Set(["id", "scope"]), `${findingPath}.rule`, issue);
      if (!nonEmptyText(finding.rule.id)) {
        issue("OPEN_WORLD_AUTOMATED_FINDING_RULE_ID", `${findingPath}.rule.id`, "Automated finding rule id must be non-empty.");
      }
      if (!isAutomatedFindingLanguageIdentifier(finding.rule.scope)) {
        issue("OPEN_WORLD_AUTOMATED_FINDING_RULE_SCOPE", `${findingPath}.rule.scope`, "Rule scope must be generic or one safe canonical public language identifier.");
      }
    }

    if (!isObject(finding.source)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_SOURCE", `${findingPath}.source`, "Automated finding source must bind its tool and exact report.");
    } else {
      rejectUnknownKeys(finding.source, new Set(["tool", "toolVersion", "reportRef", "reportSha256"]), `${findingPath}.source`, issue);
      if (!nonEmptyText(finding.source.tool)) {
        issue("OPEN_WORLD_AUTOMATED_FINDING_SOURCE_TOOL", `${findingPath}.source.tool`, "Scanner tool identity must be non-empty.");
      }
      if (finding.source.toolVersion !== null && !nonEmptyText(finding.source.toolVersion)) {
        issue("OPEN_WORLD_AUTOMATED_FINDING_SOURCE_VERSION", `${findingPath}.source.toolVersion`, "Scanner toolVersion must be null or non-empty.");
      }
      if (!nonEmptyText(finding.source.reportRef)) {
        issue("OPEN_WORLD_AUTOMATED_FINDING_SOURCE_REPORT", `${findingPath}.source.reportRef`, "Scanner reportRef must be non-empty.");
      }
      if (!sha256Pattern.test(finding.source.reportSha256 ?? "")) {
        issue("OPEN_WORLD_AUTOMATED_FINDING_SOURCE_SHA256", `${findingPath}.source.reportSha256`, "Scanner reportSha256 must bind exact non-zero report bytes.");
      }
    }

    if (!AUTOMATED_FINDING_CONFIDENCE.has(finding.confidence)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_CONFIDENCE", `${findingPath}.confidence`, "Automated finding confidence must be low, medium, or high.");
    }
    if (!AUTOMATED_FINDING_STATUSES.has(finding.status)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_STATUS", `${findingPath}.status`, "Automated finding status must preserve automated, partial, disputed, builder-confirmed, or reviewer-confirmed provenance.");
    }
    if (!isAutomatedFindingLanguageIdentifier(finding.language)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_LANGUAGE", `${findingPath}.language`, "Automated finding language must be one safe canonical public identifier.");
    }
    if (finding.repositoryPath !== null && (typeof finding.repositoryPath !== "string" || !safeRepositoryPathPattern.test(finding.repositoryPath))) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_PATH", `${findingPath}.repositoryPath`, "repositoryPath must be null or one safe canonical repository path.");
    }
    if (!AUTOMATED_FINDING_CATEGORIES.has(finding.category)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_CATEGORY", `${findingPath}.category`, "Automated finding category is not recognized.");
    }
    if (!nonEmptyText(finding.message)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_MESSAGE", `${findingPath}.message`, "Automated finding message must be non-empty.");
    }
    validateEvidenceRefs(finding.evidenceRefs, `${findingPath}.evidenceRefs`, issue);
    if (!Array.isArray(finding.evidenceRefs) || finding.evidenceRefs.length === 0) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_EVIDENCE", `${findingPath}.evidenceRefs`, "Automated findings require at least one exact evidence reference.");
    } else if (nonEmptyText(finding.source?.reportRef) && !finding.evidenceRefs.includes(finding.source.reportRef)) {
      issue("OPEN_WORLD_AUTOMATED_FINDING_REPORT_UNBOUND", `${findingPath}.source.reportRef`, "The scanner reportRef must also appear in this finding's evidenceRefs.");
    }
  }
}

export function automatedFindingScopeResolution(finding) {
  const scope = finding?.rule?.scope;
  if (scope === "generic") return { matches: true, profileKnown: true, reason: "generic" };
  if (
    !isAutomatedFindingLanguageIdentifier(scope)
    || !isAutomatedFindingLanguageIdentifier(finding?.language)
    || finding.language !== scope
    || typeof finding?.repositoryPath !== "string"
  ) {
    return { matches: false, profileKnown: hasAutomatedFindingLanguageProfile(scope), reason: "scope-mismatch" };
  }
  const repositoryPath = finding.repositoryPath.toLowerCase();
  const profile = hasAutomatedFindingLanguageProfile(scope)
    ? AUTOMATED_FINDING_LANGUAGE_PROFILES[scope]
    : null;
  if (typeof profile !== "function") {
    return { matches: null, profileKnown: false, reason: "profile-unavailable" };
  }
  return { matches: profile(repositoryPath), profileKnown: true, reason: "known-profile" };
}

export function hasAutomatedFindingLanguageProfile(language) {
  return Object.hasOwn(AUTOMATED_FINDING_LANGUAGE_PROFILES, language)
    && typeof AUTOMATED_FINDING_LANGUAGE_PROFILES[language] === "function";
}

export function isAutomatedFindingLanguageIdentifier(value) {
  return typeof value === "string" && automatedFindingLanguageIdentifierPattern.test(value);
}
