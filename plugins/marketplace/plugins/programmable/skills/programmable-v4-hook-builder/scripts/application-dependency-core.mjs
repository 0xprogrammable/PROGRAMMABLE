const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const countKeys = Object.freeze([
  "gitLfs",
  "gitlink",
  "internalVerified",
  "runtimeAssetDelegated",
  "sourceCritical",
  "symlink",
  "targetVerified",
  "unclassified",
  "unresolved"
]);
const coverageKeys = Object.freeze([
  "counts",
  "pointerCount",
  "pointerRecordsSha256",
  "schemaVersion",
  "sourceCriticalDereferenceState"
]);

export function inspectDependencyPointerCoverage(sourceCoverage, { declaredRepositoryRefs = null } = {}) {
  if (!Array.isArray(sourceCoverage) || sourceCoverage.length === 0) {
    throw dependencyFailure("DEPENDENCY_POINTER_COVERAGE_INVALID", "source coverage must be a non-empty array");
  }
  const observedRefs = [];
  const observedSet = new Set();
  const missingRepositoryRefs = [];
  const unresolvedRepositoryRefs = [];
  for (const coverage of sourceCoverage) {
    const repositoryRef = typeof coverage?.repositoryRef === "string" && coverage.repositoryRef.length > 0
      ? coverage.repositoryRef
      : null;
    if (repositoryRef === null || observedSet.has(repositoryRef)) {
      throw dependencyFailure("DEPENDENCY_POINTER_COVERAGE_INVALID", "source coverage repository refs must be non-empty and unique");
    }
    observedSet.add(repositoryRef);
    observedRefs.push(repositoryRef);
    const pointerCoverage = coverage?.verificationReport?.dependencyPointerCoverage;
    if (pointerCoverage === undefined || pointerCoverage === null) {
      missingRepositoryRefs.push(repositoryRef);
      continue;
    }
    validateDependencyPointerCoverage(pointerCoverage);
    if (pointerCoverage.sourceCriticalDereferenceState === "UNRESOLVED") {
      unresolvedRepositoryRefs.push(repositoryRef);
    }
  }
  if (declaredRepositoryRefs !== null) {
    if (
      !Array.isArray(declaredRepositoryRefs)
      || declaredRepositoryRefs.length === 0
      || declaredRepositoryRefs.some((value) => typeof value !== "string" || value.length === 0)
      || new Set(declaredRepositoryRefs).size !== declaredRepositoryRefs.length
      || canonicalJson([...declaredRepositoryRefs].sort(compareUtf8)) !== canonicalJson([...observedRefs].sort(compareUtf8))
    ) {
      throw dependencyFailure("DEPENDENCY_POINTER_COVERAGE_REPOSITORY_MISMATCH", "source coverage must exactly equal the declared primary and companion repository set");
    }
  }
  missingRepositoryRefs.sort(compareUtf8);
  unresolvedRepositoryRefs.sort(compareUtf8);
  return Object.freeze({
    state: missingRepositoryRefs.length > 0
      ? "LEGACY_MISSING"
      : unresolvedRepositoryRefs.length > 0
        ? "UNRESOLVED"
        : "VERIFIED",
    missingRepositoryRefs: Object.freeze(missingRepositoryRefs),
    unresolvedRepositoryRefs: Object.freeze(unresolvedRepositoryRefs)
  });
}

export function deriveDependencyAwareSecurityAssessment({ draft, application, sourceCoverage } = {}) {
  if (
    draft?.assessment?.state !== "source-assessed"
    || draft?.assessment?.reasonCode !== null
    || !Array.isArray(draft?.layers?.source?.evidenceRefs)
    || draft.layers.source.evidenceRefs.length === 0
    || typeof application?.applicationId !== "string"
    || typeof application?.source?.primary?.id !== "string"
    || typeof application?.source?.primary?.revisionObjectId !== "string"
    || !Array.isArray(sourceCoverage)
    || sourceCoverage.length === 0
  ) {
    throw dependencyFailure("DEPENDENCY_SECURITY_REVIEW_INVALID", "dependency-aware derivation requires one source-assessed draft and exact source coverage");
  }
  for (const coverage of sourceCoverage) {
    if (
      coverage?.verificationReport?.status !== "VERIFIED"
      || coverage?.verificationReport?.sourceClosureVerified !== true
    ) throw dependencyFailure("DEPENDENCY_SOURCE_CLOSURE_NOT_VERIFIED", "dependency-aware derivation requires exact verified pointer identities for every repository");
  }
  const declaredRepositoryRefs = [
    application.source.primary.id,
    ...(Array.isArray(application.source.companions)
      ? application.source.companions.map(({ id }) => id)
      : [])
  ];
  const disposition = inspectDependencyPointerCoverage(sourceCoverage, { declaredRepositoryRefs });
  if (disposition.state === "LEGACY_MISSING") {
    throw dependencyFailure("DEPENDENCY_POINTER_COVERAGE_MISSING", "legacy source reports without closed dependency pointer coverage cannot be materialized or launched");
  }

  const derived = cloneCanonical(draft);
  const reportPaths = sourceCoverage.map(({ verificationReportPath }) => verificationReportPath);
  const manifestPaths = sourceCoverage
    .filter(({ sourceClosureMode }) => sourceClosureMode === "manifest")
    .map(({ manifestPath }) => manifestPath);
  const derivedEvidenceRefs = uniqueSorted([
    ...(Array.isArray(derived.assessment.evidenceRefs) ? derived.assessment.evidenceRefs : []),
    ...manifestPaths,
    ...reportPaths
  ]);
  derived.subject = {
    id: application.applicationId,
    revision: application.source.primary.revisionObjectId,
    stage: application.stage
  };
  derived.assessment.evidenceRefs = derivedEvidenceRefs;
  derived.layers.source.evidenceRefs = uniqueSorted([
    ...derived.layers.source.evidenceRefs,
    ...manifestPaths,
    ...reportPaths
  ]);
  if (disposition.state === "UNRESOLVED") {
    derived.assessment.state = "partial";
    derived.assessment.reasonCode = "DEPENDENCY_TARGETS_UNRESOLVED";
    derived.assessment.sourceCoverage = null;
  } else {
    derived.assessment.state = "source-assessed";
    derived.assessment.reasonCode = null;
    derived.assessment.sourceCoverage = {
      primaryRepositoryRef: application.source.primary.id,
      repositories: sourceCoverage.map(persistedSourceCoverageRecord)
    };
  }
  return Object.freeze({
    securityAssessment: derived,
    dependencyDisposition: disposition.state,
    missingRepositoryRefs: disposition.missingRepositoryRefs,
    unresolvedRepositoryRefs: disposition.unresolvedRepositoryRefs
  });
}

function validateDependencyPointerCoverage(coverage) {
  if (
    !isObject(coverage)
    || canonicalJson(Object.keys(coverage).sort()) !== canonicalJson(coverageKeys)
    || coverage.schemaVersion !== "1.0.0"
    || !Number.isSafeInteger(coverage.pointerCount)
    || coverage.pointerCount < 0
    || !sha256Pattern.test(coverage.pointerRecordsSha256 ?? "")
    || !["NONE", "VERIFIED", "UNRESOLVED"].includes(coverage.sourceCriticalDereferenceState)
    || !isObject(coverage.counts)
    || canonicalJson(Object.keys(coverage.counts).sort()) !== canonicalJson(countKeys)
    || countKeys.some((key) => !Number.isSafeInteger(coverage.counts[key]) || coverage.counts[key] < 0)
    || coverage.counts.symlink + coverage.counts.gitlink + coverage.counts.gitLfs !== coverage.pointerCount
    || coverage.counts.internalVerified + coverage.counts.targetVerified + coverage.counts.unresolved !== coverage.pointerCount
    || coverage.counts.sourceCritical > coverage.pointerCount
    || coverage.counts.runtimeAssetDelegated > coverage.pointerCount
    || coverage.counts.runtimeAssetDelegated !== 0
    || coverage.counts.sourceCritical + coverage.counts.runtimeAssetDelegated !== coverage.pointerCount
    || coverage.counts.unclassified > coverage.counts.sourceCritical
    || coverage.sourceCriticalDereferenceState !== (
      coverage.counts.sourceCritical === 0
        ? "NONE"
        : coverage.counts.unresolved === 0
          ? "VERIFIED"
          : "UNRESOLVED"
    )
  ) throw dependencyFailure("DEPENDENCY_POINTER_COVERAGE_INVALID", "dependency pointer coverage is not one closed internally consistent v1 summary");
}

function persistedSourceCoverageRecord(coverage) {
  return {
    repositoryRef: coverage.repositoryRef,
    revisionObjectId: coverage.revisionObjectId,
    treeObjectId: coverage.treeObjectId,
    sourceClosureMode: coverage.sourceClosureMode,
    sourcePaths: [...coverage.sourcePaths],
    sourcePathsSha256: coverage.sourcePathsSha256,
    manifestPath: coverage.manifestPath,
    manifestSha256: coverage.manifestSha256,
    manifestByteLength: coverage.manifestByteLength,
    closureSha256: coverage.closureSha256,
    reportPath: coverage.verificationReportPath,
    reportSha256: coverage.verificationReportSha256,
    reportByteLength: coverage.verificationReportByteLength,
    result: "VERIFIED"
  };
}

function uniqueSorted(values) {
  if (values.some((value) => typeof value !== "string" || value.length === 0)) {
    throw dependencyFailure("DEPENDENCY_SECURITY_EVIDENCE_INVALID", "dependency security evidence paths must be non-empty strings");
  }
  return [...new Set(values)].sort(compareUtf8);
}

function cloneCanonical(value) {
  return JSON.parse(canonicalJson(value));
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function dependencyFailure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
