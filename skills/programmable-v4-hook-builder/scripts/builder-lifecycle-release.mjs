import {
  BUILDER_LIFECYCLE_SCHEMA_VERSION,
  EXTERNAL_W5_REQUIREMENTS,
  FULL_GIT_OBJECT_PATTERN,
  HOTFIX_SEVERITIES,
  NORMAL_RELEASE_WINDOW_MS,
  RELEASE_CHANGE_KINDS,
  RELEASE_CHANNELS,
  SECURITY_CHANGE_KINDS,
  SEMANTIC_CLASSIFICATIONS,
  SHA256_PATTERN,
  assertExactKeys,
  assertPlainObject,
  cloneJson,
  compareSemver,
  compareSemverText,
  compareText,
  digestCanonical,
  invalid,
  normalizeTimestamp,
  parseSemver,
  requireOptionalText,
  requireSafeGitTag,
  requireSafeRelativePath,
  requireText,
  semanticClassification,
  timestampMs
} from "./builder-lifecycle-shared.mjs";
import {
  evaluateDeclaredEvidenceSlot,
  grantedAtNotAfter,
  grantedAtNotBefore,
  validEvidenceCoordinates,
  validGrantedEvidence,
  validateEvidenceMap,
  validateOwnerEvidence
} from "./builder-lifecycle-evidence.mjs";

export function releaseIntentDigest(candidate) {
  assertPlainObject(candidate, "release candidate");
  return digestCanonical({
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    candidateId: candidate.candidateId,
    privateCandidate: candidate.privateCandidate,
    publicState: candidate.publicState,
    releaseVersion: candidate.releaseVersion,
    channel: candidate.channel,
    releaseKind: candidate.releaseKind,
    plannedRelease: cloneJson(candidate.plannedRelease),
    preparedAt: candidate.preparedAt,
    requestedReleaseAt: candidate.requestedReleaseAt,
    changeSetComplete: candidate.changeSetComplete,
    changes: cloneJson(candidate.changes),
    unbundledChangeIds: cloneJson(candidate.unbundledChangeIds),
    evidence: cloneJson(candidate.evidence),
    communications: cloneJson(candidate.communications),
    securityHotfix: {
      severity: candidate.securityHotfix?.severity ?? null,
      affectedVersions: cloneJson(candidate.securityHotfix?.affectedVersions ?? []),
      reasonCode: candidate.securityHotfix?.reasonCode ?? null,
      incidentRecordSha256: candidate.securityHotfix?.incidentRecordSha256 ?? null
    }
  });
}

export function planPrivateRelease({ candidate, history, now }) {
  validateReleaseCandidate(candidate);
  validateReleaseHistory(history);
  const normalizedNow = normalizeTimestamp(now, "release planning time");
  const nowMs = timestampMs(normalizedNow, "release planning time");
  const preparedAtMs = timestampMs(candidate.preparedAt, "candidate preparedAt");
  const requestedReleaseAtMs = timestampMs(candidate.requestedReleaseAt, "candidate requestedReleaseAt");
  const intentSha256 = releaseIntentDigest(candidate);
  if (preparedAtMs > nowMs || preparedAtMs > requestedReleaseAtMs) {
    throw new BuilderLifecycleError("RELEASE_TIME_INVALID", "candidate preparation time must not be in the future or after its requested release time");
  }
  if (requestedReleaseAtMs < nowMs) {
    throw new BuilderLifecycleError("RELEASE_TIME_IN_PAST", "requested release time is earlier than the supplied planning time");
  }
  if (history.releases.some((entry) => timestampMs(entry.releasedAt, "history releasedAt") > nowMs)) {
    throw new BuilderLifecycleError("RELEASE_HISTORY_FUTURE", "release history contains an entry later than the caller-supplied planning time");
  }

  const declaredPlanningBlockers = [];
  const plannedRelease = evaluatePlannedReleaseIdentity(candidate.plannedRelease);
  if (!plannedRelease.callerDeclaredComplete) {
    declaredPlanningBlockers.push("Caller-declared planned release identity needs a full commit, tree, tag, builder artifact path/digest, and release-manifest path/digest.");
  }
  const evidence = {};
  for (const [id, slot] of Object.entries(candidate.evidence)) {
    const result = evaluateDeclaredEvidenceSlot(slot, `candidate.evidence.${id}`);
    evidence[id] = result;
    if (!result.callerDeclaredComplete) declaredPlanningBlockers.push(result.blocker);
  }
  const communications = {};
  for (const [id, slot] of Object.entries(candidate.communications)) {
    const result = evaluateDeclaredEvidenceSlot(slot, `candidate.communications.${id}`);
    communications[id] = result;
    if (!result.callerDeclaredComplete) declaredPlanningBlockers.push(result.blocker);
  }
  if (!candidate.changeSetComplete || candidate.unbundledChangeIds.length > 0) {
    declaredPlanningBlockers.push("Caller must declare one complete bundled change set and clear unbundledChangeIds.");
  }

  const sameChannelReleases = history.releases.filter((entry) => entry.channel === candidate.channel);
  for (const release of sameChannelReleases) {
    if (compareSemver(parseSemver(candidate.releaseVersion, "candidate releaseVersion"), parseSemver(release.releaseVersion, "history releaseVersion")) <= 0) {
      declaredPlanningBlockers.push(`Candidate version must be newer than caller-supplied ${candidate.channel} release ${release.releaseVersion}.`);
      break;
    }
  }

  const normalReleases = history.releases
    .filter((entry) => entry.releaseKind === "normal")
    .map((entry) => ({ ...entry, releasedAtMs: timestampMs(entry.releasedAt, "history releasedAt") }))
    .filter((entry) => entry.releasedAtMs <= requestedReleaseAtMs)
    .sort((left, right) => right.releasedAtMs - left.releasedAtMs);
  const previousNormal = normalReleases[0] ?? null;
  const nextNormalReleaseAtMs = previousNormal === null ? null : previousNormal.releasedAtMs + NORMAL_RELEASE_WINDOW_MS;
  const callerDeclaredNormalWindowOpen = nextNormalReleaseAtMs === null || requestedReleaseAtMs >= nextNormalReleaseAtMs;

  let hotfixException = {
    applicable: candidate.releaseKind === "security-hotfix",
    callerDeclaredComplete: false,
    callerDeclaredCriticalSeverity: false,
    callerDeclaredCadenceExceptionEligible: false,
    severity: null,
    affectedVersions: [],
    reasonCode: null,
    incidentRecordSha256: null,
    ownerOverrideEvidenceSha256: null,
    releaseIntentSha256: null,
    ownerOverrideGrantedAt: null,
    ownerOverrideNotBeforePreparedAt: false,
    ownerOverrideNotAfterPlanningTime: false,
    evidenceArtifactRead: false,
    ownerIdentityAuthenticated: false,
    ownerAuthorityVerified: false,
    cadenceExceptionProven: false
  };
  if (candidate.releaseKind === "security-hotfix") {
    const override = candidate.securityHotfix;
    const ownerOverrideNotBeforePreparedAt = grantedAtNotBefore(override.ownerOverride, preparedAtMs);
    const ownerOverrideNotAfterPlanningTime = grantedAtNotAfter(override.ownerOverride, nowMs);
    const callerDeclaredComplete = Boolean(
      HOTFIX_SEVERITIES.has(override.severity)
      && override.affectedVersions.length > 0
      && requireOptionalText(override.reasonCode)
      && SHA256_PATTERN.test(override.incidentRecordSha256 ?? "")
      && validGrantedEvidence(override.ownerOverride, preparedAtMs, nowMs, intentSha256)
    );
    const callerDeclaredCriticalSeverity = override.severity === "critical";
    hotfixException = {
      applicable: true,
      callerDeclaredComplete,
      callerDeclaredCriticalSeverity,
      callerDeclaredCadenceExceptionEligible: callerDeclaredComplete && callerDeclaredCriticalSeverity,
      severity: override.severity,
      affectedVersions: cloneJson(override.affectedVersions),
      reasonCode: override.reasonCode,
      incidentRecordSha256: override.incidentRecordSha256,
      ownerOverrideEvidenceSha256: override.ownerOverride.evidenceSha256,
      releaseIntentSha256: override.ownerOverride.releaseIntentSha256,
      ownerOverrideGrantedAt: override.ownerOverride.grantedAt,
      ownerOverrideNotBeforePreparedAt,
      ownerOverrideNotAfterPlanningTime,
      evidenceArtifactRead: false,
      ownerIdentityAuthenticated: false,
      ownerAuthorityVerified: false,
      cadenceExceptionProven: false
    };
    if (!hotfixException.callerDeclaredComplete) {
      declaredPlanningBlockers.push("Caller-declared security-hotfix coordinates need severity, sorted affected versions, a reason code, incident digest, and an intent-bound owner override granted between candidate preparation and planning time.");
    }
  }
  if (!callerDeclaredNormalWindowOpen && !hotfixException.callerDeclaredCadenceExceptionEligible) {
    declaredPlanningBlockers.push(`Caller-supplied history calculates the next normal release at ${new Date(nextNormalReleaseAtMs).toISOString().replace(".000Z", "Z")}; only a complete caller-declared critical security hotfix may bypass this local calculation.`);
  }
  const callerDeclaredOwnerGoComplete = validGrantedEvidence(candidate.ownerReleaseGo, preparedAtMs, nowMs, intentSha256);
  if (!callerDeclaredOwnerGoComplete) {
    declaredPlanningBlockers.push("Caller-declared owner-GO coordinates are missing, outside candidate-preparedAt through planning-now, incomplete, or do not bind the exact candidate intent.");
  }

  const uniqueDeclaredPlanningBlockers = [...new Set(declaredPlanningBlockers)].sort(compareText);
  const externalVerificationRequirements = EXTERNAL_W5_REQUIREMENTS.map((entry) => ({
    ...entry,
    status: "not-performed"
  }));
  const externalVerificationBlockers = externalVerificationRequirements.map((entry) => `External W5 verification pending: ${entry.id}.`);
  const blockers = [...uniqueDeclaredPlanningBlockers, ...externalVerificationBlockers].sort(compareText);
  const callerDeclaredPlanComplete = uniqueDeclaredPlanningBlockers.length === 0;
  return {
    kind: "caller-declared-local-release-plan",
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    planningBoundary: {
      inputAuthority: "caller-supplied-untrusted-data",
      callerDeclarationsOnly: true,
      candidateBytesBound: false,
      plannedReleaseIdentityVerified: false,
      sourceCommitTreeTagVerified: false,
      releaseArtifactBytesRead: false,
      releaseManifestBytesRead: false,
      repositoryVisibilityChecked: false,
      releaseHistoryAuthenticated: false,
      trustedTimeAuthenticated: false,
      evidenceArtifactsRead: false,
      evidenceDigestsVerified: false,
      ownerIdentityAuthenticated: false,
      ownerAuthorityVerified: false,
      externalW5VerificationPerformed: false
    },
    candidate: {
      candidateId: candidate.candidateId,
      releaseVersion: candidate.releaseVersion,
      channel: candidate.channel,
      releaseKind: candidate.releaseKind,
      plannedRelease,
      preparedAt: candidate.preparedAt,
      requestedReleaseAt: normalizeTimestamp(candidate.requestedReleaseAt, "candidate requestedReleaseAt"),
      releaseIntentSha256: intentSha256,
      callerDeclaredPrivateCandidate: candidate.privateCandidate,
      callerDeclaredPublicState: candidate.publicState,
      privacyProven: false,
      publicationStateVerified: false,
      liveStateVerified: false
    },
    cadence: {
      rule: "one-normal-public-release-per-rolling-24-hours",
      operationalTimestampRule: "independently-verified-github-release-published-at-or-earliest-public-exposure",
      calculationOnly: true,
      inputAuthority: "caller-supplied-release-history-and-time",
      callerSuppliedHistoryEntries: history.releases.length,
      declaredPreviousNormalReleaseAt: previousNormal?.releasedAt ?? null,
      calculatedNextNormalReleaseAt: nextNormalReleaseAtMs === null ? null : new Date(nextNormalReleaseAtMs).toISOString().replace(".000Z", "Z"),
      callerDeclaredNormalWindowOpen,
      timezoneRule: "absolute-rfc3339-instants",
      releaseHistoryAuthenticated: false,
      trustedTimeAuthenticated: false,
      cadenceComplianceProven: false,
      hotfixException
    },
    bundledChanges: {
      callerDeclaredComplete: candidate.changeSetComplete && candidate.unbundledChangeIds.length === 0,
      changeIds: candidate.changes.map((entry) => entry.id).sort(compareText),
      changes: candidate.changes.map((entry) => ({ id: entry.id, kind: entry.kind })).sort((left, right) => compareText(left.id, right.id)),
      unbundledChangeIds: [...candidate.unbundledChangeIds].sort(compareText)
    },
    evidence,
    communications,
    ownerReleaseGo: {
      callerDeclaredStatus: candidate.ownerReleaseGo.status,
      callerDeclaredComplete: callerDeclaredOwnerGoComplete,
      evidenceCoordinatesComplete: validEvidenceCoordinates(candidate.ownerReleaseGo),
      intentDigestMatches: candidate.ownerReleaseGo.releaseIntentSha256 === intentSha256,
      evidenceSha256: candidate.ownerReleaseGo.evidenceSha256,
      releaseIntentSha256: candidate.ownerReleaseGo.releaseIntentSha256,
      grantedAt: candidate.ownerReleaseGo.grantedAt,
      grantedNotBeforePreparedAt: grantedAtNotBefore(candidate.ownerReleaseGo, preparedAtMs),
      grantedNotAfterPlanningTime: grantedAtNotAfter(candidate.ownerReleaseGo, nowMs),
      evidenceArtifactRead: false,
      evidenceDigestVerified: false,
      identityAuthenticated: false,
      authorityVerified: false
    },
    declaredPlanningBlockers: uniqueDeclaredPlanningBlockers,
    externalVerificationRequirements,
    blockers,
    callerDeclaredPlanComplete,
    externalW5VerificationRequired: true,
    releaseReadinessProven: false,
    releaseActionAuthorized: false,
    readyForOwnerControlledReleaseAction: false,
    publicationPerformed: false,
    networkAccessed: false,
    externalActionsPerformed: [],
    publicClaimAllowed: false,
    nextAction: callerDeclaredPlanComplete
      ? "Send the exact candidate and referenced bytes to independent W5 verification; this local calculation cannot authorize a release."
      : "Complete the caller-declared planning inputs, rerun locally, then send the exact candidate and bytes to independent W5 verification."
  };
}

export function validateReleaseCandidate(candidate) {
  assertPlainObject(candidate, "release candidate");
  assertExactKeys(candidate, [
    "schemaVersion", "candidateId", "privateCandidate", "publicState", "releaseVersion", "channel", "releaseKind",
    "plannedRelease", "preparedAt", "requestedReleaseAt", "changeSetComplete", "changes", "unbundledChangeIds", "evidence",
    "communications", "ownerReleaseGo", "securityHotfix"
  ], "release candidate");
  if (candidate.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION) invalid("RELEASE_CANDIDATE_INVALID", "unsupported release candidate schema");
  requireText(candidate.candidateId, "release candidate id");
  if (candidate.privateCandidate !== true || candidate.publicState !== "not-published") invalid("RELEASE_CANDIDATE_INVALID", "candidate must declare privateCandidate true and publicState not-published; the planner does not verify either claim");
  parseSemver(candidate.releaseVersion, "candidate releaseVersion");
  if (!RELEASE_CHANNELS.has(candidate.channel)) invalid("RELEASE_CANDIDATE_INVALID", "candidate channel is invalid");
  if (candidate.channel === "stable" && parseSemver(candidate.releaseVersion, "candidate releaseVersion").prerelease.length > 0) invalid("RELEASE_CANDIDATE_INVALID", "stable candidate cannot be a prerelease");
  if (!new Set(["normal", "security-hotfix"]).has(candidate.releaseKind)) invalid("RELEASE_CANDIDATE_INVALID", "candidate release kind is invalid");
  validatePlannedReleaseIdentity(candidate.plannedRelease, candidate.releaseVersion);
  timestampMs(candidate.preparedAt, "candidate preparedAt");
  timestampMs(candidate.requestedReleaseAt, "candidate requestedReleaseAt");
  if (typeof candidate.changeSetComplete !== "boolean") invalid("RELEASE_CANDIDATE_INVALID", "candidate changeSetComplete must be boolean");
  if (!Array.isArray(candidate.changes) || candidate.changes.length === 0 || candidate.changes.length > 1024) invalid("RELEASE_CANDIDATE_INVALID", "candidate changes are invalid");
  const ids = new Set();
  for (const change of candidate.changes) {
    assertPlainObject(change, "candidate change");
    assertExactKeys(change, ["id", "kind", "summary"], "candidate change");
    requireText(change.id, "candidate change id");
    if (!RELEASE_CHANGE_KINDS.has(change.kind)) invalid("RELEASE_CANDIDATE_INVALID", "candidate change kind is invalid");
    requireText(change.summary, "candidate change summary");
    if (ids.has(change.id)) invalid("RELEASE_CANDIDATE_INVALID", "candidate change ids must be unique");
    ids.add(change.id);
  }
  if (!Array.isArray(candidate.unbundledChangeIds) || candidate.unbundledChangeIds.some((entry) => typeof entry !== "string" || entry.length === 0)) invalid("RELEASE_CANDIDATE_INVALID", "candidate unbundled change ids are invalid");
  if (new Set(candidate.unbundledChangeIds).size !== candidate.unbundledChangeIds.length) invalid("RELEASE_CANDIDATE_INVALID", "candidate unbundled change ids must be unique");
  validateEvidenceMap(candidate.evidence, "candidate evidence", ["checksums", "sbom", "evals", "canary"]);
  validateEvidenceMap(candidate.communications, "candidate communications", ["dailyReleaseNotes", "publicPostSummary"]);
  validateOwnerEvidence(candidate.ownerReleaseGo, "candidate owner release GO", ["missing", "granted"]);
  assertPlainObject(candidate.securityHotfix, "candidate security hotfix");
  assertExactKeys(candidate.securityHotfix, ["severity", "affectedVersions", "reasonCode", "incidentRecordSha256", "ownerOverride"], "candidate security hotfix");
  if (candidate.securityHotfix.severity !== null && !HOTFIX_SEVERITIES.has(candidate.securityHotfix.severity)) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix severity is invalid");
  if (!Array.isArray(candidate.securityHotfix.affectedVersions) || candidate.securityHotfix.affectedVersions.length > 256) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix affectedVersions is invalid");
  const affectedVersionIdentities = new Set();
  for (const version of candidate.securityHotfix.affectedVersions) {
    parseSemver(version, "security hotfix affected version");
    if (affectedVersionIdentities.has(version)) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix affectedVersions must be unique");
    affectedVersionIdentities.add(version);
  }
  const sortedAffectedVersions = [...candidate.securityHotfix.affectedVersions].sort(compareSemverText);
  if (sortedAffectedVersions.some((version, index) => version !== candidate.securityHotfix.affectedVersions[index])) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix affectedVersions must be sorted by semantic version");
  if (candidate.securityHotfix.reasonCode !== null) requireText(candidate.securityHotfix.reasonCode, "security hotfix reason code");
  if (candidate.securityHotfix.incidentRecordSha256 !== null && !SHA256_PATTERN.test(candidate.securityHotfix.incidentRecordSha256)) invalid("RELEASE_CANDIDATE_INVALID", "security hotfix incident digest is invalid");
  validateOwnerEvidence(candidate.securityHotfix.ownerOverride, "candidate security hotfix owner override", ["not-applicable", "missing", "granted"]);
  if (
    candidate.releaseKind === "normal"
    && (
      candidate.securityHotfix.severity !== null
      || candidate.securityHotfix.affectedVersions.length !== 0
      || candidate.securityHotfix.reasonCode !== null
      || candidate.securityHotfix.incidentRecordSha256 !== null
      || candidate.securityHotfix.ownerOverride.status !== "not-applicable"
    )
  ) invalid("RELEASE_CANDIDATE_INVALID", "normal release must not carry a security-hotfix override");
  if (
    candidate.releaseKind === "security-hotfix"
    && (
      candidate.securityHotfix.severity === null
      || candidate.securityHotfix.affectedVersions.length === 0
      || candidate.securityHotfix.reasonCode === null
      || candidate.securityHotfix.incidentRecordSha256 === null
      || candidate.securityHotfix.ownerOverride.status === "not-applicable"
    )
  ) invalid("RELEASE_CANDIDATE_INVALID", "security-hotfix release needs severity, affectedVersions, a reason code, an incident digest, and an owner override record");
  if (candidate.releaseKind === "security-hotfix" && candidate.changes.some((change) => !SECURITY_CHANGE_KINDS.has(change.kind))) {
    invalid("RELEASE_CANDIDATE_INVALID", "security-hotfix release may contain only security-fix or security-advisory changes");
  }
}

export function validatePlannedReleaseIdentity(value, candidateReleaseVersion) {
  assertPlainObject(value, "candidate planned release");
  assertExactKeys(value, ["builder", "submissionStandard", "feePolicy", "source", "artifact", "releaseManifest"], "candidate planned release");

  assertPlainObject(value.builder, "candidate planned builder transition");
  assertExactKeys(value.builder, ["fromVersion", "toVersion", "semanticClassification"], "candidate planned builder transition");
  const builderFrom = parseSemver(value.builder.fromVersion, "candidate planned builder fromVersion");
  const builderTo = parseSemver(value.builder.toVersion, "candidate planned builder toVersion");
  if (compareSemver(builderTo, builderFrom) <= 0) invalid("RELEASE_CANDIDATE_INVALID", "planned builder version must advance");
  if (value.builder.toVersion !== candidateReleaseVersion) invalid("RELEASE_CANDIDATE_INVALID", "planned builder target must equal candidate releaseVersion");
  if (!SEMANTIC_CLASSIFICATIONS.has(value.builder.semanticClassification)) invalid("RELEASE_CANDIDATE_INVALID", "planned builder semantic classification is invalid");
  if (semanticClassification(builderFrom, builderTo) !== value.builder.semanticClassification) invalid("RELEASE_CANDIDATE_INVALID", "planned builder semantic classification does not match its version transition");

  validateNonDowngradeTransition(value.submissionStandard, "candidate planned submission standard");
  validateNonDowngradeTransition(value.feePolicy, "candidate planned fee policy");

  assertPlainObject(value.source, "candidate planned source");
  assertExactKeys(value.source, ["commitSha", "treeSha", "tagName"], "candidate planned source");
  for (const [field, objectValue] of [["commitSha", value.source.commitSha], ["treeSha", value.source.treeSha]]) {
    if (objectValue !== null && !FULL_GIT_OBJECT_PATTERN.test(objectValue)) invalid("RELEASE_CANDIDATE_INVALID", `candidate planned source ${field} must be null or a full lowercase 40-hex Git object id`);
  }
  if (value.source.tagName !== null) requireSafeGitTag(value.source.tagName, "candidate planned source tagName");

  validateDigestCoordinate(value.artifact, "candidate planned artifact");
  validateDigestCoordinate(value.releaseManifest, "candidate planned release manifest");
}

export function validateNonDowngradeTransition(value, location) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["fromVersion", "toVersion"], location);
  const from = parseSemver(value.fromVersion, `${location} fromVersion`);
  const to = parseSemver(value.toVersion, `${location} toVersion`);
  if (compareSemver(to, from) < 0) invalid("RELEASE_CANDIDATE_INVALID", `${location} must not downgrade`);
}

export function validateDigestCoordinate(value, location) {
  assertPlainObject(value, location);
  assertExactKeys(value, ["path", "sha256"], location);
  if (value.path !== null) requireSafeRelativePath(value.path, `${location}.path`);
  if (value.sha256 !== null && !SHA256_PATTERN.test(value.sha256)) invalid("RELEASE_CANDIDATE_INVALID", `${location}.sha256 is invalid`);
}

export function evaluatePlannedReleaseIdentity(value) {
  const sourceComplete = FULL_GIT_OBJECT_PATTERN.test(value.source.commitSha ?? "")
    && FULL_GIT_OBJECT_PATTERN.test(value.source.treeSha ?? "")
    && typeof value.source.tagName === "string";
  const artifactComplete = validDigestCoordinate(value.artifact);
  const releaseManifestComplete = validDigestCoordinate(value.releaseManifest);
  return {
    builder: cloneJson(value.builder),
    submissionStandard: cloneJson(value.submissionStandard),
    feePolicy: cloneJson(value.feePolicy),
    callerDeclaredVersionTransitionsConsistent: true,
    source: {
      commitSha: value.source.commitSha,
      treeSha: value.source.treeSha,
      tagName: value.source.tagName,
      callerDeclaredComplete: sourceComplete,
      commitVerified: false,
      treeVerified: false,
      tagVerified: false,
      publicExposureChecked: false
    },
    artifact: evaluateDigestCoordinate(value.artifact),
    releaseManifest: evaluateDigestCoordinate(value.releaseManifest),
    callerDeclaredComplete: sourceComplete && artifactComplete && releaseManifestComplete,
    externallyVerified: false
  };
}

export function evaluateDigestCoordinate(value) {
  return {
    path: value.path,
    sha256: value.sha256,
    callerDeclaredCoordinatesComplete: validDigestCoordinate(value),
    bytesRead: false,
    digestVerified: false,
    externallyVerified: false
  };
}

export function validDigestCoordinate(value) {
  return typeof value.path === "string" && value.path.trim().length > 0 && SHA256_PATTERN.test(value.sha256 ?? "");
}

export function validateReleaseHistory(history) {
  assertPlainObject(history, "release history");
  assertExactKeys(history, ["schemaVersion", "releases"], "release history");
  if (history.schemaVersion !== BUILDER_LIFECYCLE_SCHEMA_VERSION || !Array.isArray(history.releases) || history.releases.length > 4096) invalid("RELEASE_HISTORY_INVALID", "release history is invalid");
  const identities = new Set();
  for (const entry of history.releases) {
    assertPlainObject(entry, "release history entry");
    assertExactKeys(entry, ["releaseVersion", "channel", "releaseKind", "releasedAt", "ownerGoEvidenceSha256"], "release history entry");
    parseSemver(entry.releaseVersion, "history releaseVersion");
    if (!RELEASE_CHANNELS.has(entry.channel) || !new Set(["normal", "security-hotfix"]).has(entry.releaseKind)) invalid("RELEASE_HISTORY_INVALID", "release history channel or kind is invalid");
    timestampMs(entry.releasedAt, "history releasedAt");
    if (!SHA256_PATTERN.test(entry.ownerGoEvidenceSha256 ?? "")) invalid("RELEASE_HISTORY_INVALID", "release history owner GO digest is invalid");
    const identity = `${entry.channel}\u0000${entry.releaseVersion}`;
    if (identities.has(identity)) invalid("RELEASE_HISTORY_INVALID", "release history contains a duplicate channel/version");
    identities.add(identity);
  }
}
