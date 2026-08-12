import crypto from "node:crypto";

import {
  ASSESSMENT_STATES,
  FIELD_RULES,
  LAYERS,
  OPEN_WORLD_SECURITY_SCHEMA_VERSION,
  PROFILE_FIELDS,
  assessmentReasonPattern,
  gitObjectPattern,
  openSlugPattern,
  safeRepositoryPathPattern,
  sha256Pattern
} from "./open-world-security-constants.mjs";
import { validateAutomatedFindings } from "./open-world-security-automated.mjs";
import {
  hasOwn,
  isObject,
  isUintString,
  jsonTreeIsValid,
  nonEmptyText,
  rejectUnknownKeys,
  validateEvidenceRefs
} from "./open-world-security-shared.mjs";

export function validateOpenWorldSecurityInput(input) {
  const issues = [];
  const issue = (code, path, message) => issues.push({ code, path, message });

  if (!isObject(input)) {
    issue("OPEN_WORLD_INPUT_TYPE", "$", "The security envelope must be an object.");
    return issues;
  }

  rejectUnknownKeys(input, new Set(["schemaVersion", "subject", "assessment", "layers", "automatedFindings", "extensions"]), "$", issue);
  if (input.schemaVersion !== OPEN_WORLD_SECURITY_SCHEMA_VERSION) {
    issue("OPEN_WORLD_SCHEMA_VERSION", "$.schemaVersion", `schemaVersion must equal ${OPEN_WORLD_SECURITY_SCHEMA_VERSION}.`);
  }
  if (!isObject(input.subject)) {
    issue("OPEN_WORLD_SUBJECT_TYPE", "$.subject", "subject must be an object.");
  } else {
    rejectUnknownKeys(input.subject, new Set(["id", "revision", "stage"]), "$.subject", issue);
    if (!nonEmptyText(input.subject.id)) {
      issue("OPEN_WORLD_SUBJECT_ID", "$.subject.id", "subject.id must be a non-empty string.");
    }
    if (input.subject.revision !== undefined && input.subject.revision !== null && !nonEmptyText(input.subject.revision)) {
      issue("OPEN_WORLD_SUBJECT_REVISION", "$.subject.revision", "subject.revision must be null or a non-empty string.");
    }
    const stages = new Set(["idea", "proposal", "prototype", "candidate", "release", "runtime"]);
    if (!hasOwn(input.subject, "revision")) {
      issue("OPEN_WORLD_SUBJECT_REVISION_REQUIRED", "$.subject.revision", "subject.revision is required and may be null only before a source revision exists.");
    }
    if (!hasOwn(input.subject, "stage")) {
      issue("OPEN_WORLD_SUBJECT_STAGE_REQUIRED", "$.subject.stage", "subject.stage is required so assessment completeness cannot bypass a later-stage gate.");
    } else if (!stages.has(input.subject.stage)) {
      issue("OPEN_WORLD_SUBJECT_STAGE", "$.subject.stage", "subject.stage is not recognized.");
    }
  }

  validateAssessment(input.assessment, input.subject, input.layers, issue);
  validateAutomatedFindings(input.automatedFindings, "$.automatedFindings", issue);

  if (!isObject(input.layers) || Object.keys(input.layers).length === 0) {
    issue("OPEN_WORLD_LAYERS_TYPE", "$.layers", "layers must contain at least one of intent, config, source or runtime.");
    return issues;
  }
  validateCustomProfiles(input.extensions, "$.extensions", issue);
  rejectUnknownKeys(input.layers, new Set(LAYERS), "$.layers", issue);

  for (const layer of LAYERS) {
    const layerValue = input.layers[layer];
    if (layerValue === undefined) continue;
    const layerPath = `$.layers.${layer}`;
    if (!isObject(layerValue)) {
      issue("OPEN_WORLD_LAYER_TYPE", layerPath, `${layer} must be an object.`);
      continue;
    }
    rejectUnknownKeys(layerValue, new Set(["evidenceRefs", "customProfiles", ...Object.keys(PROFILE_FIELDS)]), layerPath, issue);
    validateEvidenceRefs(layerValue.evidenceRefs, `${layerPath}.evidenceRefs`, issue);
    validateCustomProfiles(layerValue.customProfiles, `${layerPath}.customProfiles`, issue);

    for (const [profile, fields] of Object.entries(PROFILE_FIELDS)) {
      const profileValue = layerValue[profile];
      if (profileValue === undefined) continue;
      const profilePath = `${layerPath}.${profile}`;
      if (!isObject(profileValue)) {
        issue("OPEN_WORLD_PROFILE_TYPE", profilePath, `${profile} must be an object.`);
        continue;
      }
      rejectUnknownKeys(profileValue, new Set(["evidenceRefs", ...fields]), profilePath, issue);
      validateEvidenceRefs(profileValue.evidenceRefs, `${profilePath}.evidenceRefs`, issue);
      for (const field of fields) {
        if (!hasOwn(profileValue, field)) continue;
        validateField(profile, field, profileValue[field], `${profilePath}.${field}`, issue);
      }
    }
  }

  return issues;
}

export function validateAssessment(value, subject, layers, issue) {
  const assessmentPath = "$.assessment";
  if (!isObject(value)) {
    issue("OPEN_WORLD_ASSESSMENT_REQUIRED", assessmentPath, "assessment must be one closed completeness record.");
    return;
  }
  rejectUnknownKeys(value, new Set(["state", "reasonCode", "evidenceRefs", "sourceCoverage"]), assessmentPath, issue);
  if (!ASSESSMENT_STATES.includes(value.state)) {
    issue("OPEN_WORLD_ASSESSMENT_STATE", `${assessmentPath}.state`, "assessment.state must be unassessed, partial, or source-assessed.");
  }
  if (!hasOwn(value, "reasonCode")) {
    issue("OPEN_WORLD_ASSESSMENT_REASON_REQUIRED", `${assessmentPath}.reasonCode`, "assessment.reasonCode is required and is null only for source-assessed evidence.");
  }
  if (!hasOwn(value, "evidenceRefs")) {
    issue("OPEN_WORLD_ASSESSMENT_EVIDENCE_REQUIRED", `${assessmentPath}.evidenceRefs`, "assessment.evidenceRefs is required.");
  }
  if (!hasOwn(value, "sourceCoverage")) {
    issue("OPEN_WORLD_SOURCE_COVERAGE_REQUIRED", `${assessmentPath}.sourceCoverage`, "assessment.sourceCoverage is required and may be null only before source assessment completes.");
  }
  validateEvidenceRefs(value.evidenceRefs, `${assessmentPath}.evidenceRefs`, issue);

  if (value.state === "unassessed") {
    if (!assessmentReasonPattern.test(value.reasonCode ?? "")) {
      issue("OPEN_WORLD_ASSESSMENT_REASON_INVALID", `${assessmentPath}.reasonCode`, "An unassessed record needs one stable uppercase reason code.");
    }
    if (Array.isArray(value.evidenceRefs) && value.evidenceRefs.length !== 0) {
      issue("OPEN_WORLD_UNASSESSED_EVIDENCE_FORBIDDEN", `${assessmentPath}.evidenceRefs`, "Unassessed cannot claim assessment evidence.");
    }
    if (value.sourceCoverage !== null) {
      issue("OPEN_WORLD_UNASSESSED_COVERAGE_FORBIDDEN", `${assessmentPath}.sourceCoverage`, "Unassessed cannot claim source coverage.");
    }
    return;
  }

  if (value.state === "partial") {
    if (!assessmentReasonPattern.test(value.reasonCode ?? "")) {
      issue("OPEN_WORLD_ASSESSMENT_REASON_INVALID", `${assessmentPath}.reasonCode`, "A partial assessment needs one stable uppercase reason code.");
    }
    if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) {
      issue("OPEN_WORLD_PARTIAL_EVIDENCE_MISSING", `${assessmentPath}.evidenceRefs`, "A partial assessment must preserve at least one exact evidence reference.");
    }
    if (value.sourceCoverage !== null) {
      issue("OPEN_WORLD_PARTIAL_COVERAGE_CLAIM_INVALID", `${assessmentPath}.sourceCoverage`, "Partial assessment cannot claim complete source coverage.");
    }
    return;
  }

  if (value.state !== "source-assessed") return;
  if (value.reasonCode !== null) {
    issue("OPEN_WORLD_SOURCE_ASSESSED_REASON_INVALID", `${assessmentPath}.reasonCode`, "source-assessed uses null reasonCode; incomplete work must be partial or unassessed.");
  }
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.length === 0) {
    issue("OPEN_WORLD_SOURCE_ASSESSED_EVIDENCE_MISSING", `${assessmentPath}.evidenceRefs`, "source-assessed requires exact evidence references.");
  }
  if (!isObject(layers?.source) || !Array.isArray(layers.source.evidenceRefs) || layers.source.evidenceRefs.length === 0) {
    issue("OPEN_WORLD_SOURCE_LAYER_EVIDENCE_MISSING", "$.layers.source.evidenceRefs", "source-assessed requires a source layer with at least one exact evidence reference.");
  }
  validateSourceCoverage(value.sourceCoverage, subject, value.evidenceRefs, issue);
}

export function validateSourceCoverage(value, subject, assessmentEvidenceRefs, issue) {
  const coveragePath = "$.assessment.sourceCoverage";
  if (!isObject(value)) {
    issue("OPEN_WORLD_SOURCE_COVERAGE_INVALID", coveragePath, "source-assessed requires one closed sourceCoverage record.");
    return;
  }
  rejectUnknownKeys(value, new Set(["primaryRepositoryRef", "repositories"]), coveragePath, issue);
  if (!openSlugPattern.test(value.primaryRepositoryRef ?? "") || value.primaryRepositoryRef.length > 120) {
    issue("OPEN_WORLD_SOURCE_COVERAGE_PRIMARY_INVALID", `${coveragePath}.primaryRepositoryRef`, "primaryRepositoryRef must be one lowercase open slug.");
  }
  if (!Array.isArray(value.repositories) || value.repositories.length === 0) {
    issue("OPEN_WORLD_SOURCE_COVERAGE_REPOSITORIES_EMPTY", `${coveragePath}.repositories`, "source-assessed requires at least one exact repository closure and derived verification-report binding.");
    return;
  }

  const repositoryRefs = new Set();
  const reportPaths = new Set();
  let primaryRepository = null;
  for (const [index, repository] of value.repositories.entries()) {
    const repositoryPath = `${coveragePath}.repositories[${index}]`;
    if (!isObject(repository)) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_REPOSITORY_RECORD_INVALID", repositoryPath, "Each covered repository must be one exact closure/report binding object.");
      continue;
    }
    rejectUnknownKeys(repository, new Set([
      "repositoryRef",
      "revisionObjectId",
      "treeObjectId",
      "sourceClosureMode",
      "sourcePaths",
      "sourcePathsSha256",
      "manifestPath",
      "manifestSha256",
      "manifestByteLength",
      "closureSha256",
      "reportPath",
      "reportSha256",
      "reportByteLength",
      "result"
    ]), repositoryPath, issue);
    if (!openSlugPattern.test(repository.repositoryRef ?? "") || repository.repositoryRef.length > 120) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_REPOSITORY_INVALID", `${repositoryPath}.repositoryRef`, "Coverage repositoryRef must be one lowercase open slug.");
    } else if (repositoryRefs.has(repository.repositoryRef)) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_REPOSITORY_DUPLICATE", `${repositoryPath}.repositoryRef`, "Each covered repository must appear exactly once.");
    } else {
      repositoryRefs.add(repository.repositoryRef);
    }
    if (!gitObjectPattern.test(repository.revisionObjectId ?? "")) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_REVISION_INVALID", `${repositoryPath}.revisionObjectId`, "Coverage revisionObjectId must be one full lowercase Git object ID.");
    }
    if (!gitObjectPattern.test(repository.treeObjectId ?? "")) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_TREE_INVALID", `${repositoryPath}.treeObjectId`, "Coverage treeObjectId must be one full lowercase Git object ID.");
    }
    if (!Array.isArray(repository.sourcePaths)) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_SOURCE_PATHS_INVALID", `${repositoryPath}.sourcePaths`, "Coverage sourcePaths must be an explicit array in both closure modes.");
    } else {
      const seenPaths = new Set();
      for (const [pathIndex, sourcePath] of repository.sourcePaths.entries()) {
        const sourcePathLocation = `${repositoryPath}.sourcePaths[${pathIndex}]`;
        if (typeof sourcePath !== "string" || !safeRepositoryPathPattern.test(sourcePath)) {
          issue("OPEN_WORLD_SOURCE_COVERAGE_SOURCE_PATH_INVALID", sourcePathLocation, "Every inline source path must be one safe canonical repository path.");
        } else if (seenPaths.has(sourcePath)) {
          issue("OPEN_WORLD_SOURCE_COVERAGE_SOURCE_PATH_DUPLICATE", sourcePathLocation, "Inline source paths must be unique.");
        }
        seenPaths.add(sourcePath);
      }
    }

    if (repository.sourceClosureMode === "inline") {
      if (!Array.isArray(repository.sourcePaths) || repository.sourcePaths.length < 1 || repository.sourcePaths.length > 4096) {
        issue("OPEN_WORLD_SOURCE_COVERAGE_INLINE_PATHS_INVALID", `${repositoryPath}.sourcePaths`, "Inline coverage requires one to 4,096 exact source paths.");
      }
      const expectedSourcePathsSha256 = Array.isArray(repository.sourcePaths)
        ? sha256JsonValue(repository.sourcePaths)
        : null;
      if (!sha256Pattern.test(repository.sourcePathsSha256 ?? "") || repository.sourcePathsSha256 !== expectedSourcePathsSha256) {
        issue("OPEN_WORLD_SOURCE_COVERAGE_SOURCE_PATHS_SHA256_INVALID", `${repositoryPath}.sourcePathsSha256`, "Inline sourcePathsSha256 must bind the exact canonical sourcePaths array bytes.");
      }
      if (repository.manifestPath !== null || repository.manifestSha256 !== null || repository.manifestByteLength !== null) {
        issue("OPEN_WORLD_SOURCE_COVERAGE_INLINE_MANIFEST_CONFLICT", repositoryPath, "Inline coverage cannot also claim a source manifest.");
      }
    } else if (repository.sourceClosureMode === "manifest") {
      if (!Array.isArray(repository.sourcePaths) || repository.sourcePaths.length !== 0 || repository.sourcePathsSha256 !== null) {
        issue("OPEN_WORLD_SOURCE_COVERAGE_MANIFEST_INLINE_CONFLICT", repositoryPath, "Manifest coverage requires empty sourcePaths and null sourcePathsSha256.");
      }
      if (typeof repository.manifestPath !== "string" || !safeRepositoryPathPattern.test(repository.manifestPath)) {
        issue("OPEN_WORLD_SOURCE_COVERAGE_PATH_INVALID", `${repositoryPath}.manifestPath`, "Coverage manifestPath must be one safe canonical repository path.");
      }
      if (!sha256Pattern.test(repository.manifestSha256 ?? "")) {
        issue("OPEN_WORLD_SOURCE_COVERAGE_SHA256_INVALID", `${repositoryPath}.manifestSha256`, "Coverage manifestSha256 must bind non-zero exact bytes.");
      }
      if (!Number.isSafeInteger(repository.manifestByteLength) || repository.manifestByteLength < 1) {
        issue("OPEN_WORLD_SOURCE_COVERAGE_LENGTH_INVALID", `${repositoryPath}.manifestByteLength`, "Coverage manifestByteLength must be one positive safe integer.");
      }
      if (Array.isArray(assessmentEvidenceRefs) && typeof repository.manifestPath === "string" && !assessmentEvidenceRefs.includes(repository.manifestPath)) {
        issue("OPEN_WORLD_SOURCE_COVERAGE_EVIDENCE_UNBOUND", `${repositoryPath}.manifestPath`, "Every source-closure manifest path must also be present in assessment.evidenceRefs.");
      }
    } else {
      issue("OPEN_WORLD_SOURCE_COVERAGE_MODE_INVALID", `${repositoryPath}.sourceClosureMode`, "Source-assessed coverage must bind inline or manifest closure mode explicitly.");
    }
    if (!sha256Pattern.test(repository.closureSha256 ?? "")) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_CLOSURE_SHA256_INVALID", `${repositoryPath}.closureSha256`, "Coverage closureSha256 must bind the exact verified logical source closure.");
    }
    if (typeof repository.reportPath !== "string" || !safeRepositoryPathPattern.test(repository.reportPath)) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_REPORT_PATH_INVALID", `${repositoryPath}.reportPath`, "Coverage reportPath must be one safe canonical application-package path.");
    } else if (reportPaths.has(repository.reportPath)) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_REPORT_PATH_DUPLICATE", `${repositoryPath}.reportPath`, "Each covered repository must bind a distinct verification report path.");
    } else {
      reportPaths.add(repository.reportPath);
    }
    if (!sha256Pattern.test(repository.reportSha256 ?? "")) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_REPORT_SHA256_INVALID", `${repositoryPath}.reportSha256`, "Coverage reportSha256 must bind the exact derived verification report bytes.");
    }
    if (!Number.isSafeInteger(repository.reportByteLength) || repository.reportByteLength < 1) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_REPORT_LENGTH_INVALID", `${repositoryPath}.reportByteLength`, "Coverage reportByteLength must be one positive safe integer.");
    }
    if (repository.result !== "VERIFIED") {
      issue("OPEN_WORLD_SOURCE_COVERAGE_RESULT_INVALID", `${repositoryPath}.result`, "Only an exact VERIFIED source-closure report can support source-assessed coverage.");
    }
    if (Array.isArray(assessmentEvidenceRefs) && typeof repository.reportPath === "string" && !assessmentEvidenceRefs.includes(repository.reportPath)) {
      issue("OPEN_WORLD_SOURCE_COVERAGE_REPORT_EVIDENCE_UNBOUND", `${repositoryPath}.reportPath`, "Every derived verification report path must also be present in assessment.evidenceRefs.");
    }
    if (repository.repositoryRef === value.primaryRepositoryRef) primaryRepository = repository;
  }
  if (primaryRepository === null) {
    issue("OPEN_WORLD_SOURCE_COVERAGE_PRIMARY_MISSING", `${coveragePath}.primaryRepositoryRef`, "The declared primary repository must have exactly one coverage record.");
  } else if (subject?.revision !== primaryRepository.revisionObjectId) {
    issue("OPEN_WORLD_SOURCE_COVERAGE_SUBJECT_REVISION_MISMATCH", "$.subject.revision", "subject.revision must equal the primary source-closure revisionObjectId.");
  }
}

export function sha256JsonValue(value) {
  return `sha256:${crypto.createHash("sha256").update(`${JSON.stringify(value)}\n`, "utf8").digest("hex")}`;
}

export function validateField(profile, field, value, path, issue) {
  if (value === null) return;
  const rule = FIELD_RULES[profile]?.[field];
  if (!rule) {
    if (typeof value !== "boolean") issue("OPEN_WORLD_FIELD_TYPE", path, `${profile}.${field} must be boolean or null.`);
    return;
  }
  if (rule.type === "enum" && !rule.values.has(value)) {
    issue("OPEN_WORLD_FIELD_ENUM", path, `${profile}.${field} is not a recognized value.`);
  } else if (rule.type === "seconds" && (!Number.isSafeInteger(value) || value < 0)) {
    issue("OPEN_WORLD_FIELD_SECONDS", path, `${profile}.${field} must be null or a non-negative safe integer number of seconds.`);
  } else if (rule.type === "uint" && !isUintString(value)) {
    issue("OPEN_WORLD_FIELD_UINT", path, `${profile}.${field} must be null or a canonical unsigned integer string.`);
  }
}

export function validateCustomProfiles(value, path, issue) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue("OPEN_WORLD_CUSTOM_PROFILES_TYPE", path, "Custom profiles must be an array.");
    return;
  }
  for (const [index, profile] of value.entries()) {
    const profilePath = `${path}[${index}]`;
    if (!isObject(profile)) {
      issue("OPEN_WORLD_CUSTOM_PROFILE_TYPE", profilePath, "Each custom profile must be an object.");
      continue;
    }
    rejectUnknownKeys(
      profile,
      new Set(["id", "summary", "schemaRef", "facts", "declaredRisks", "controls", "unresolved", "resolutions", "reviewRoute", "evidenceRefs"]),
      profilePath,
      issue
    );
    if (typeof profile.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(profile.id) || profile.id.length > 64) {
      issue("OPEN_WORLD_CUSTOM_PROFILE_ID", `${profilePath}.id`, "Custom profile id must be a lowercase hyphenated identifier of at most 64 characters.");
    }
    if (!nonEmptyText(profile.summary)) {
      issue("OPEN_WORLD_CUSTOM_PROFILE_SUMMARY", `${profilePath}.summary`, "Custom profile summary must be non-empty.");
    }
    if (profile.schemaRef !== null && !nonEmptyText(profile.schemaRef)) {
      issue("OPEN_WORLD_CUSTOM_PROFILE_SCHEMA", `${profilePath}.schemaRef`, "schemaRef must be null or a non-empty string.");
    }
    if (!isObject(profile.facts) || !jsonTreeIsValid(profile.facts)) {
      issue("OPEN_WORLD_CUSTOM_PROFILE_FACTS", `${profilePath}.facts`, "facts must be a JSON object; novel fact names are allowed inside this object.");
    }
    validateOpenTextList(profile.declaredRisks, `${profilePath}.declaredRisks`, issue);
    validateOpenTextList(profile.controls, `${profilePath}.controls`, issue);
    validateOpenTextList(profile.unresolved, `${profilePath}.unresolved`, issue);
    validateCustomResolutions(profile.resolutions, `${profilePath}.resolutions`, issue);
    if (profile.reviewRoute !== "independent-review") {
      issue("OPEN_WORLD_CUSTOM_PROFILE_REVIEW_ROUTE", `${profilePath}.reviewRoute`, "Novel custom profiles must route to independent-review.");
    }
    if (profile.evidenceRefs === undefined) {
      issue("OPEN_WORLD_CUSTOM_PROFILE_EVIDENCE_REQUIRED", `${profilePath}.evidenceRefs`, "Custom profile evidenceRefs must be declared, even when the current list is empty.");
    } else {
      validateEvidenceRefs(profile.evidenceRefs, `${profilePath}.evidenceRefs`, issue);
    }
  }
}

export function validateCustomResolutions(value, path, issue) {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    issue("OPEN_WORLD_CUSTOM_RESOLUTIONS_TYPE", path, "resolutions must be an array.");
    return;
  }
  for (const [index, resolution] of value.entries()) {
    const resolutionPath = `${path}[${index}]`;
    if (!isObject(resolution)) {
      issue("OPEN_WORLD_CUSTOM_RESOLUTION_TYPE", resolutionPath, "Each resolution must be an object.");
      continue;
    }
    rejectUnknownKeys(resolution, new Set(["question", "resolution", "evidenceRefs"]), resolutionPath, issue);
    if (!nonEmptyText(resolution.question)) {
      issue("OPEN_WORLD_CUSTOM_RESOLUTION_QUESTION", `${resolutionPath}.question`, "Resolution question must exactly identify one non-empty unresolved item.");
    }
    if (!nonEmptyText(resolution.resolution)) {
      issue("OPEN_WORLD_CUSTOM_RESOLUTION_TEXT", `${resolutionPath}.resolution`, "Resolution text must be non-empty.");
    }
    if (!Array.isArray(resolution.evidenceRefs) || resolution.evidenceRefs.length === 0) {
      issue("OPEN_WORLD_CUSTOM_RESOLUTION_EVIDENCE", `${resolutionPath}.evidenceRefs`, "A resolution must bind at least one evidence reference.");
    } else {
      validateEvidenceRefs(resolution.evidenceRefs, `${resolutionPath}.evidenceRefs`, issue);
    }
  }
}

export function validateOpenTextList(value, path, issue) {
  if (!Array.isArray(value)) {
    issue("OPEN_WORLD_CUSTOM_TEXT_LIST", path, "The field must be an array of open plain-language strings.");
    return;
  }
  if (new Set(value).size !== value.length) {
    issue("OPEN_WORLD_CUSTOM_TEXT_LIST_SET", path, "The field must not contain duplicate entries.");
  }
  for (const [index, entry] of value.entries()) {
    if (!nonEmptyText(entry)) {
      issue("OPEN_WORLD_CUSTOM_TEXT", `${path}[${index}]`, "Each entry must be a non-empty string.");
    }
  }
}
