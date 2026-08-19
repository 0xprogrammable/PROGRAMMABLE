import { canonicalJson } from "./submission-core.mjs";
import {
  analyzeOpenWorldSecurity,
  validateOpenWorldSecurityInput
} from "./open-world-security-core.mjs";
import { inspectDependencyPointerCoverage } from "./application-dependency-core.mjs";
import { verifyBoundSourceClosureManifestV1 } from "./public-pr-application-v3-core.mjs";
import {
  addConflict,
  addUnresolved,
  applyDeclaredState,
  bindDeclaredEvidence,
  collectEvidenceRefs,
  exact,
  isObject,
  sha256Utf8,
  sortedUniqueStrings
} from "./launch-bundle-v2-shared.mjs";

export function analyzeSecurityEnvelope(context) {
  const {
    input,
    application,
    submission,
    securityEnvelope,
    artifacts,
    sourceSnapshots,
    evidenceIndex,
    conflicts,
    unresolved,
    reviewItems,
    securityTracker,
    evidenceTracker
  } = context;
  if (!isObject(securityEnvelope)) {
    addConflict(conflicts, securityTracker, "SECURITY_ENVELOPE_MISSING", "$.artifacts.security.content", "A parseable security evidence envelope is required.");
    return;
  }
  const validationIssues = validateOpenWorldSecurityInput(securityEnvelope);
  for (const issue of validationIssues) {
    addConflict(conflicts, securityTracker, `SECURITY_${issue.code}`, `$.artifacts.security.content#${issue.path.slice(1)}`, issue.message);
  }
  if (securityEnvelope.subject?.id !== input?.applicationId) {
    addConflict(conflicts, securityTracker, "SECURITY_SUBJECT_MISMATCH", "$.artifacts.security.content#/subject/id", "Security subject does not match the launch bundle application id.");
  }
  analyzeDependencyPointerLaunchGate({
    application,
    artifacts,
    evidenceIndex,
    unresolved,
    securityTracker
  });
  validateSecuritySourceCoverage({
    application,
    submission,
    securityEnvelope,
    artifacts,
    sourceSnapshots,
    evidenceIndex,
    conflicts,
    unresolved,
    securityTracker
  });
  if (!isObject(securityEnvelope.layers?.source)) {
    addUnresolved(unresolved, securityTracker, "SECURITY_SOURCE_LAYER_UNRESOLVED", "$.artifacts.security.content#/layers/source", "Source-derived security evidence has not been bound yet.");
  }
  bindDeclaredEvidence(collectEvidenceRefs(securityEnvelope), "$.artifacts.security.content", evidenceIndex, unresolved, evidenceTracker, securityTracker);

  let report;
  try {
    report = analyzeOpenWorldSecurity(securityEnvelope);
  } catch (error) {
    addConflict(conflicts, securityTracker, "SECURITY_ANALYSIS_FAILED", "$.artifacts.security.content", `Security analysis failed closed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  for (const finding of report.findings ?? []) {
    const path = `$.artifacts.security.content#${String(finding.path ?? "$.").slice(1)}`;
    const evidenceRefs = sortedUniqueStrings(finding.evidenceRefs);
    if (finding.outcome === "SAFE_REDESIGN" || finding.outcome === "CHANGES_REQUIRED") {
      addConflict(conflicts, securityTracker, `SECURITY_${finding.code}`, path, finding.message, evidenceRefs);
    } else {
      reviewItems.add(`SECURITY_${finding.code}`, path, finding.message, evidenceRefs);
    }
  }
  for (const review of report.requiredReviews ?? []) {
    reviewItems.add("SECURITY_INDEPENDENT_REVIEW_REQUIRED", "$.artifacts.security.content", `Required security review: ${review.id}.`, sortedUniqueStrings(review.evidenceRefs));
  }
  if (report.implementationAuthorization !== "NOT_GRANTED") {
    addConflict(conflicts, securityTracker, "SECURITY_SELF_AUTHORIZATION_FORBIDDEN", "$.artifacts.security.content", "Security analysis must never grant implementation authorization.");
  }
  reviewItems.add("SECURITY_REPORT_NOT_AUTHORIZATION", "$.artifacts.security.content", "A clean automated security report is evidence only and cannot authorize launch.", []);
}

export function analyzeDependencyPointerLaunchGate({ application, artifacts, evidenceIndex, unresolved, securityTracker }) {
  const repositories = [
    application?.source?.primary,
    ...(Array.isArray(application?.source?.companions) ? application.source.companions : [])
  ].filter(isObject);
  const declaredRepositoryRefs = repositories.map(({ id }) => id);
  const persistedReports = Array.isArray(application?.source?.verificationReports)
    ? application.source.verificationReports
    : [];
  const applicationPackageSourceRef = artifacts?.rawRecordsByRole?.get("application")?.sourceRef ?? null;
  const sourceCoverage = [];
  for (const repository of repositories) {
    const associations = persistedReports.filter(({ repositoryRef }) => repositoryRef === repository.id);
    if (associations.length !== 1) {
      addUnresolved(
        unresolved,
        securityTracker,
        "SOURCE_DEPENDENCY_POINTER_REPORT_UNBOUND",
        "$.artifacts.application.content#/source/verificationReports",
        `Repository ${String(repository.id)} does not have one exact persisted verifier-report association for dependency-pointer launch gating.`
      );
      continue;
    }
    const association = associations[0];
    const candidates = [...evidenceIndex.values()].filter((candidate) => (
      candidate.sourceRef === applicationPackageSourceRef
      && candidate.path === association.reportPath
      && candidate.sha256 === association.reportSha256
      && candidate.byteLength === association.reportByteLength
      && isObject(candidate.parsed)
    ));
    if (candidates.length !== 1) {
      addUnresolved(
        unresolved,
        securityTracker,
        "SOURCE_DEPENDENCY_POINTER_REPORT_UNBOUND",
        "$.artifacts.application.content#/source/verificationReports",
        `Repository ${String(repository.id)} dependency-pointer coverage does not resolve to one exact application-package report.`
      );
      continue;
    }
    sourceCoverage.push({ repositoryRef: repository.id, verificationReport: candidates[0].parsed });
  }
  if (repositories.length === 0 || sourceCoverage.length !== repositories.length) return;

  let disposition;
  try {
    disposition = inspectDependencyPointerCoverage(sourceCoverage, { declaredRepositoryRefs });
  } catch (error) {
    addUnresolved(
      unresolved,
      securityTracker,
      "SOURCE_DEPENDENCY_POINTER_COVERAGE_INVALID",
      "$.artifacts.application.content#/source/verificationReports",
      `Dependency-pointer coverage is not one closed internally consistent contract: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }
  if (disposition.state === "LEGACY_MISSING") {
    addUnresolved(
      unresolved,
      securityTracker,
      "SOURCE_DEPENDENCY_POINTER_COVERAGE_MISSING",
      "$.artifacts.application.content#/source/verificationReports",
      "Legacy verifier reports without closed dependency-pointer coverage remain launch-ineligible until replayed."
    );
  } else if (disposition.state === "UNRESOLVED") {
    addUnresolved(
      unresolved,
      securityTracker,
      "SOURCE_CRITICAL_DEPENDENCY_TARGETS_UNRESOLVED",
      "$.artifacts.application.content#/source/verificationReports",
      "Every source-critical symlink, Gitlink, and Git-LFS dependency must be internally or externally verified before launch preparation can match."
    );
  }
  const gitLfsPointerCount = sourceCoverage.reduce((total, coverage) => (
    total + (coverage.verificationReport?.dependencyPointerCoverage?.counts?.gitLfs ?? 0)
  ), 0);
  if (gitLfsPointerCount > 0) {
    addUnresolved(
      unresolved,
      securityTracker,
      "SOURCE_GIT_LFS_PUBLIC_REPRO_AVAILABILITY_UNVERIFIED",
      "$.artifacts.application.content#/source/verificationReports",
      "A local stable-byte match for Git LFS does not prove public object availability or independent reproducibility. Replace the pointer with a normal Git blob or bind a future versioned content-addressed independent public availability proof before launch readiness can match."
    );
  }
}

export function validateSecuritySourceCoverage({
  application,
  submission,
  securityEnvelope,
  artifacts,
  sourceSnapshots,
  evidenceIndex,
  conflicts,
  unresolved,
  securityTracker
}) {
  const assessment = securityEnvelope?.assessment;
  const stage = submission?.stage ?? application?.stage ?? null;
  if (stage === "prototype" && assessment?.state !== "source-assessed") {
    addConflict(conflicts, securityTracker, "SECURITY_PROTOTYPE_SOURCE_ASSESSMENT_REQUIRED", "$.artifacts.security.content#/assessment/state", "A launchable prototype requires a source-assessed security envelope over every exact inline or manifest source closure.");
    return;
  }
  if (assessment?.state !== "source-assessed") {
    addUnresolved(unresolved, securityTracker, "SECURITY_SOURCE_ASSESSMENT_UNRESOLVED", "$.artifacts.security.content#/assessment/state", "Security source coverage is not complete yet.");
    return;
  }

  const repositories = [
    application?.source?.primary,
    ...(Array.isArray(application?.source?.companions) ? application.source.companions : [])
  ].filter(isObject);
  const repositoryMap = new Map(repositories.map((repository) => [repository.id, repository]));
  const snapshotMap = new Map((Array.isArray(sourceSnapshots) ? sourceSnapshots : []).map((snapshot) => [snapshot.id, snapshot]));
  const coverage = assessment.sourceCoverage;
  const coverageRecords = Array.isArray(coverage?.repositories) ? coverage.repositories : [];
  const persistedReports = Array.isArray(application?.source?.verificationReports)
    ? application.source.verificationReports
    : [];
  const applicationPackageSourceRef = artifacts?.rawRecordsByRole?.get("application")?.sourceRef ?? null;
  if (coverage?.primaryRepositoryRef !== application?.source?.primary?.id) {
    addConflict(conflicts, securityTracker, "SECURITY_SOURCE_COVERAGE_PRIMARY_MISMATCH", "$.artifacts.security.content#/assessment/sourceCoverage/primaryRepositoryRef", "Security source coverage primaryRepositoryRef must equal the application primary repository id.");
  }
  if (securityEnvelope.subject?.revision !== application?.source?.primary?.revisionObjectId) {
    addConflict(conflicts, securityTracker, "SECURITY_SOURCE_REVISION_MISMATCH", "$.artifacts.security.content#/subject/revision", "Security subject revision must equal the exact application primary source revision.");
  }
  if (securityEnvelope.subject?.stage !== stage) {
    addConflict(conflicts, securityTracker, "SECURITY_SOURCE_STAGE_MISMATCH", "$.artifacts.security.content#/subject/stage", "Security subject stage must equal the exact submission stage.");
  }
  const coveredRepositoryRefs = new Set(coverageRecords.map((record) => record?.repositoryRef));
  if (coverageRecords.length !== repositories.length || coveredRepositoryRefs.size !== coverageRecords.length) {
    addConflict(conflicts, securityTracker, "SECURITY_SOURCE_REPOSITORY_COVERAGE_CARDINALITY_MISMATCH", "$.artifacts.security.content#/assessment/sourceCoverage/repositories", "Security source coverage must contain exactly one distinct record for every Application V3 repository.");
  }
  const persistedByRepository = new Map();
  for (const report of persistedReports) {
    if (persistedByRepository.has(report?.repositoryRef)) {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_VERIFICATION_REPORT_DUPLICATE", "$.artifacts.application.content#/source/verificationReports", "Application V3 contains more than one persisted verification association for one repository.");
    } else {
      persistedByRepository.set(report?.repositoryRef, report);
    }
  }
  if (persistedReports.length !== repositories.length || persistedByRepository.size !== persistedReports.length) {
    addConflict(conflicts, securityTracker, "SECURITY_SOURCE_VERIFICATION_REPORT_CARDINALITY_MISMATCH", "$.artifacts.application.content#/source/verificationReports", "Application V3 must contain exactly one distinct verifier report binding for every source repository.");
  }
  for (const repository of repositories) {
    if (!coveredRepositoryRefs.has(repository.id)) {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_REPOSITORY_COVERAGE_MISSING", "$.artifacts.security.content#/assessment/sourceCoverage/repositories", `Application repository ${repository.id} has no exact security source-coverage record.`);
    }
  }
  const reportPaths = new Set();
  for (const [index, record] of coverageRecords.entries()) {
    const basePath = `$.artifacts.security.content#/assessment/sourceCoverage/repositories/${index}`;
    const repository = repositoryMap.get(record?.repositoryRef);
    if (!repository) {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_COVERAGE_REPOSITORY_UNBOUND", `${basePath}/repositoryRef`, "Security source coverage references a repository outside the exact application source closure.");
      continue;
    }
    const snapshot = snapshotMap.get(repository.id);
    if (
      record.revisionObjectId !== repository.revisionObjectId
      || record.treeObjectId !== repository.treeObjectId
      || snapshot?.revisionObjectId !== repository.revisionObjectId
      || snapshot?.treeObjectId !== repository.treeObjectId
    ) {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_COVERAGE_REVISION_MISMATCH", `${basePath}/revisionObjectId`, "Security source coverage does not bind the exact application repository revision and tree snapshot.");
    }
    const persisted = persistedByRepository.get(repository.id);
    if (!persisted || canonicalJson(persisted) !== canonicalJson(record)) {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_COVERAGE_APPLICATION_REPORT_MISMATCH", basePath, "Security coverage must exactly equal the one persisted Application V3 verifier-report association for this repository.");
    }
    if (reportPaths.has(record.reportPath)) {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_VERIFICATION_REPORT_PATH_DUPLICATE", `${basePath}/reportPath`, "Each repository must have a distinct application-package verifier report path.");
    }
    reportPaths.add(record.reportPath);
    const reportCandidates = [...evidenceIndex.values()].filter((candidate) => (
      candidate.sourceRef === applicationPackageSourceRef
      && candidate.path === record.reportPath
      && candidate.sha256 === record.reportSha256
      && candidate.byteLength === record.reportByteLength
      && isObject(candidate.parsed)
    ));
    if (reportCandidates.length !== 1) {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_VERIFICATION_REPORT_EVIDENCE_UNBOUND", basePath, "The repository verifier association does not resolve to one exact application-package report file.");
    } else {
      const report = reportCandidates[0].parsed;
      if (
        report.status !== "VERIFIED"
        || report.sourceClosureVerified !== true
        || report.readOnly !== true
        || report.networkAccessed !== false
        || report.candidateCodeExecuted !== false
      ) {
        addConflict(conflicts, securityTracker, "SECURITY_SOURCE_VERIFICATION_REPORT_INVALID", basePath, "The exact verifier report does not prove a completed, read-only, non-executing source-closure verification.");
      }
    }

    if (repository.sourceClosureMode === "inline") {
      const expectedPathsSha256 = sha256Utf8(`${canonicalJson(repository.sourcePaths)}\n`);
      if (
        record.sourceClosureMode !== "inline"
        || canonicalJson(record.sourcePaths) !== canonicalJson(repository.sourcePaths)
        || record.sourcePathsSha256 !== expectedPathsSha256
        || record.manifestPath !== null
        || record.manifestSha256 !== null
        || record.manifestByteLength !== null
      ) {
        addConflict(conflicts, securityTracker, "SECURITY_INLINE_SOURCE_COVERAGE_MISMATCH", basePath, "Inline source coverage does not bind the exact Application V3 path set and canonical path-set digest.");
      }
      continue;
    }

    const rootBinding = repository.sourceManifest;
    if (repository.sourceClosureMode !== "manifest" || !isObject(rootBinding)) {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_CLOSURE_MODE_INVALID", basePath, "Source coverage must use the exact inline or manifest mode declared by Application V3.");
      continue;
    }
    if (
      record.sourceClosureMode !== "manifest"
      || !Array.isArray(record.sourcePaths)
      || record.sourcePaths.length !== 0
      || record.sourcePathsSha256 !== null
      || record.manifestPath !== rootBinding.path
      || record.manifestSha256 !== rootBinding.sha256
      || record.manifestByteLength !== rootBinding.byteLength
    ) {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_MANIFEST_TUPLE_MISMATCH", basePath, "Security source coverage path, SHA-256 and byte length do not match the exact Application V3 sourceManifest binding.");
      continue;
    }
    const manifestCandidates = [...evidenceIndex.values()].filter((candidate) => (
      candidate.sourceRef === repository.id
      && candidate.path === record.manifestPath
      && candidate.sha256 === record.manifestSha256
      && candidate.byteLength === record.manifestByteLength
      && candidate.gitBlobObjectId === rootBinding.blobObjectId
    ));
    if (manifestCandidates.length !== 1 || !isObject(manifestCandidates[0]?.parsed) || typeof manifestCandidates[0]?.content !== "string") {
      addConflict(conflicts, securityTracker, "SECURITY_SOURCE_MANIFEST_EVIDENCE_UNBOUND", basePath, "Manifest source coverage has no unique exact root-manifest bytes and Git blob binding in the declared repository.");
      continue;
    }
    const verification = verifyBoundSourceClosureManifestV1({
      repository,
      manifest: manifestCandidates[0].parsed,
      bytes: Buffer.from(manifestCandidates[0].content, "utf8"),
      observedBlobObjectId: manifestCandidates[0].gitBlobObjectId
    });
    for (const finding of verification.findings ?? []) {
      if (finding.severity === "blocker") addConflict(conflicts, securityTracker, `SECURITY_${finding.code}`, `${basePath}${finding.path === "$" ? "" : finding.path.slice(1)}`, finding.message);
    }
  }
}

export function analyzeReviewRequirements({
  requirements,
  basePath,
  evidenceIndex,
  conflicts,
  unresolved,
  reviewItems,
  evidenceTracker,
  localTracker = null
}) {
  const values = Array.isArray(requirements) ? requirements : [];
  const ids = new Set();
  for (const [index, requirement] of values.entries()) {
    const path = `${basePath}[${index}]`;
    if (!isObject(requirement)) continue;
    if (ids.has(requirement.id)) {
      addConflict(conflicts, localTracker, "REVIEW_REQUIREMENT_ID_DUPLICATE", `${path}.id`, `Duplicate review requirement ${String(requirement.id)}.`);
    }
    ids.add(requirement.id);
    applyDeclaredState(requirement.state, `${path}.state`, "REVIEW_REQUIREMENT", localTracker, conflicts, unresolved);
    if (requirement.state === "satisfied") {
      reviewItems.add("DECLARED_REQUIREMENT_REQUIRES_INDEPENDENT_CONFIRMATION", path, `Requirement ${String(requirement.id)} is declared satisfied but remains subject to independent confirmation.`, sortedUniqueStrings(requirement.evidenceRefs));
      if ((requirement.evidenceRefs?.length ?? 0) === 0) {
        addUnresolved(unresolved, localTracker, "REVIEW_REQUIREMENT_EVIDENCE_UNRESOLVED", `${path}.evidenceRefs`, `Requirement ${String(requirement.id)} is declared satisfied without exact evidence.`);
      }
    }
    bindDeclaredEvidence(requirement.evidenceRefs, `${path}.evidenceRefs`, evidenceIndex, unresolved, evidenceTracker, localTracker);
  }
}
