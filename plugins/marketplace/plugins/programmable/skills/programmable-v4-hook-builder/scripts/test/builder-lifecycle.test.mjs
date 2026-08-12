import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  bundledVersionStatus,
  BuilderLifecycleError,
  checkSignedUpdate,
  digestCanonical,
  migrationDryRun,
  planPrivateRelease,
  releaseIntentDigest,
  renderHumanStatus,
  verifySignedUpdate,
  versionStatus
} from "../builder-lifecycle-core.mjs";
import { canonicalJson } from "../submission-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const lifecycleCli = path.resolve(testDirectory, "..", "builder-lifecycle.mjs");
const skillRoot = path.resolve(testDirectory, "..", "..");
const lifecycleTemplates = path.join(skillRoot, "assets", "templates", "lifecycle");
const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const HASH_C = `sha256:${"c".repeat(64)}`;
const GIT_A = "a".repeat(40);
const GIT_B = "b".repeat(40);
const GIT_C = "c".repeat(40);

test("version reports exact local standards without external action and renders deterministically", () => {
  const fixture = trustFixture();
  const first = versionStatus(fixture.state);
  const second = versionStatus(JSON.parse(JSON.stringify(fixture.state)));
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(first.installed.releaseVersion, "0.2.1");
  assert.equal(first.installed.publicationState, "not-verified");
  assert.equal(first.publicationStateVerified, false);
  assert.equal(first.historicalStandardsPreserved, true);
  assert.equal(first.networkAccessed, false);
  assert.deepEqual(first.externalActionsPerformed, []);
  assert.equal(renderHumanStatus(first), renderHumanStatus(second));
});

test("bundled version reports standalone code constants without requiring state", () => {
  const result = bundledVersionStatus();
  assert.equal(result.installed.releaseVersion, "0.5.1");
  assert.equal(result.installed.channel, "stable");
  assert.equal(result.installed.publicationState, "unpublished-candidate");
  assert.equal(result.installed.standards.skill, "0.5.1");
  assert.equal(result.installed.standards.engine, "0.5.1");
  assert.equal(result.installed.standards.policy, "1.1.0");
  assert.equal(result.installed.standards.schema, "1.6.0");
  assert.equal(result.installed.standards.submission, "1.6.0");
  assert.equal(result.trust.status, "NOT_PROVIDED");
  assert.equal(result.versionSource, "bundled-code-constants");
  assert.equal(result.publicationStateVerified, false);
  assert.equal(result.installedStateOverrideUsed, false);
  assert.equal(result.networkAccessed, false);
  assert.deepEqual(result.externalActionsPerformed, []);
});

test("update-check verifies the supplied pin and Ed25519 payload without activation", () => {
  const fixture = trustFixture();
  const result = checkSignedUpdate({
    state: fixture.state,
    signedUpdate: fixture.signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  });
  assert.equal(result.status, "update-available");
  assert.equal(result.verification.authenticated, true);
  assert.equal(result.verification.fixtureOnly, false);
  assert.equal(result.verification.authenticatedToSuppliedInstalledPin, true);
  assert.equal(result.verification.productionTrustEstablishedByThisCommand, false);
  assert.equal(result.activationAllowedThisSession, false);
  assert.equal(result.networkAccessed, false);
  assert.deepEqual(result.externalActionsPerformed, []);
});

test("update-check rejects an authenticated downgrade", () => {
  const fixture = trustFixture({ minimumReleaseSequence: "0" });
  const signedUpdate = fixture.signUpdate({
    ...fixture.payload,
    releaseSequence: "0",
    releaseVersion: "0.1.9",
    minimumInstalledVersion: "0.1.0"
  });
  assertLifecycleCode(() => checkSignedUpdate({
    state: fixture.state,
    signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  }), "UPDATE_DOWNGRADE_REJECTED");
});

test("major update is authenticated but requires explicit migration and later consent", () => {
  const fixture = trustFixture();
  const signedUpdate = fixture.signUpdate({
    ...fixture.payload,
    releaseVersion: "1.0.0",
    standards: { ...fixture.payload.standards, submission: "2.0.0" },
    migration: {
      required: true,
      fromStandard: "1.3.0",
      toStandard: "2.0.0",
      majorConsentRequired: true
    }
  });
  const result = checkSignedUpdate({
    state: fixture.state,
    signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  });
  assert.equal(result.status, "major-migration-required");
  assert.equal(result.compatibleUpdate, false);
  assert.equal(result.activationAllowedThisSession, false);
  assert.match(result.nextAction, /migrate --dry-run/u);
});

test("an authenticated release cannot downgrade any bound standard", () => {
  const fixture = trustFixture();
  const signedUpdate = fixture.signUpdate({
    ...fixture.payload,
    standards: { ...fixture.payload.standards, policy: "0.9.0" }
  });
  assertLifecycleCode(() => checkSignedUpdate({
    state: fixture.state,
    signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  }), "UPDATE_STANDARD_DOWNGRADE_REJECTED");
});

test("signed update evidence cannot claim completion without a path and digest", () => {
  const fixture = trustFixture();
  const signedUpdate = fixture.signUpdate({
    ...fixture.payload,
    evidence: {
      ...fixture.payload.evidence,
      sbom: { status: "complete", path: null, evidenceSha256: null }
    }
  });
  assertLifecycleCode(() => checkSignedUpdate({
    state: fixture.state,
    signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  }), "UPDATE_EVIDENCE_INCOMPLETE");
});

test("stale signatures and stale or mismatched pins fail closed", () => {
  const fixture = trustFixture();
  const staleSignature = fixture.signUpdate(fixture.payload, {
    issuedAt: "2026-08-01T00:00:00Z",
    validUntil: "2026-08-02T00:00:00Z"
  });
  assertLifecycleCode(() => checkSignedUpdate({
    state: fixture.state,
    signedUpdate: staleSignature,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  }), "UPDATE_SIGNATURE_STALE");

  const stalePin = { ...fixture.pin, validUntil: "2026-08-02T00:00:00Z" };
  const staleState = { ...fixture.state, trustedPinSha256: digestCanonical(stalePin) };
  assertLifecycleCode(() => checkSignedUpdate({
    state: staleState,
    signedUpdate: fixture.signedUpdate,
    trustedPin: stalePin,
    now: "2026-08-03T12:00:00Z"
  }), "TRUST_PIN_STALE");

  assertLifecycleCode(() => checkSignedUpdate({
    state: { ...fixture.state, trustedPinSha256: HASH_A },
    signedUpdate: fixture.signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  }), "TRUST_PIN_MISMATCH");
});

test("migration dry-run blocks ambiguous mappings and never writes", () => {
  const fixture = trustFixture();
  const verifiedUpdate = verifySignedUpdate({
    state: fixture.state,
    signedUpdate: fixture.signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  });
  const current = currentDocument();
  const proposed = proposedDocument();
  const result = migrationDryRun({
    currentDocument: current,
    proposal: {
      schemaVersion: "1.0.0",
      fromStandard: "1.3.0",
      toStandard: "1.4.0",
      expectedCurrentSha256: digestCanonical(current),
      proposedDocument: proposed,
      changeReasons: [
        { path: "/standardVersion", reason: "Adopt the authenticated submission standard." },
        { path: "/economics/platformRateBps", reason: "Owner-requested economic change for review." }
      ]
    },
    verifiedUpdate
  });
  assert.equal(result.status, "blocked-ambiguous");
  assert.deepEqual(result.ambiguity.unexplainedPaths, ["/wallets/platformOwner"]);
  assert.equal(result.dryRun, true);
  assert.equal(result.writePerformed, false);
  assert.deepEqual(current, currentDocument());
});

test("migration dry-run names economics and wallet confirmations field by field", () => {
  const fixture = trustFixture();
  const verifiedUpdate = verifySignedUpdate({
    state: fixture.state,
    signedUpdate: fixture.signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  });
  const current = currentDocument();
  const result = migrationDryRun({
    currentDocument: current,
    proposal: completeMigrationProposal(current),
    verifiedUpdate
  });
  assert.equal(result.status, "confirmation-required");
  assert.equal(result.protectedChangeSummary.economics, 1);
  assert.equal(result.protectedChangeSummary.wallet, 1);
  assert.ok(result.confirmations.some((entry) => entry.kind === "economics" && entry.path === "/economics/platformRateBps"));
  assert.ok(result.confirmations.some((entry) => entry.kind === "wallet" && entry.path === "/wallets/platformOwner"));
  assert.equal(result.autoApplyAllowed, false);
  assert.equal(result.historicalStandardPreserved, true);
});

test("authority, risk, and evidence changes also require explicit confirmations", () => {
  const fixture = trustFixture();
  const verifiedUpdate = verifySignedUpdate({
    state: fixture.state,
    signedUpdate: fixture.signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  });
  const current = {
    standardVersion: "1.3.0",
    adminAuthority: "immutable",
    riskTier: "standard",
    evidenceReport: HASH_A
  };
  const proposed = {
    standardVersion: "1.4.0",
    adminAuthority: "mutable",
    riskTier: "enhanced",
    evidenceReport: HASH_B
  };
  const result = migrationDryRun({
    currentDocument: current,
    proposal: {
      schemaVersion: "1.0.0",
      fromStandard: "1.3.0",
      toStandard: "1.4.0",
      expectedCurrentSha256: digestCanonical(current),
      proposedDocument: proposed,
      changeReasons: [
        { path: "/adminAuthority", reason: "Explicit authority proposal." },
        { path: "/evidenceReport", reason: "Explicit evidence replacement." },
        { path: "/riskTier", reason: "Explicit risk reclassification." },
        { path: "/standardVersion", reason: "Adopt authenticated standard." }
      ]
    },
    verifiedUpdate
  });
  assert.equal(result.protectedChangeSummary.authority, 1);
  assert.equal(result.protectedChangeSummary.risk, 1);
  assert.equal(result.protectedChangeSummary.evidence, 1);
  assert.ok(result.confirmations.some((entry) => entry.kind === "authority"));
  assert.ok(result.confirmations.some((entry) => entry.kind === "risk"));
  assert.ok(result.confirmations.some((entry) => entry.kind === "evidence"));
});

test("duplicate and stale migration reasons remain ambiguous", () => {
  const fixture = trustFixture();
  const verifiedUpdate = verifySignedUpdate({
    state: fixture.state,
    signedUpdate: fixture.signedUpdate,
    trustedPin: fixture.pin,
    now: "2026-08-03T12:00:00Z"
  });
  const current = currentDocument();
  const proposal = completeMigrationProposal(current);
  proposal.changeReasons.push(
    { path: "/economics/platformRateBps", reason: "Conflicting explanation." },
    { path: "/unused", reason: "No matching diff." }
  );
  const result = migrationDryRun({ currentDocument: current, proposal, verifiedUpdate });
  assert.equal(result.status, "blocked-ambiguous");
  assert.deepEqual(result.ambiguity.duplicateReasonPaths, ["/economics/platformRateBps"]);
  assert.deepEqual(result.ambiguity.staleReasonPaths, ["/unused"]);
});

test("normal release cadence is only a caller-declared 24-hour calculation", () => {
  const candidate = readyCandidate({ requestedReleaseAt: "2026-08-04T23:59:59Z" });
  const history = releaseHistory("2026-08-04T00:00:00Z");
  const blocked = planPrivateRelease({ candidate, history, now: "2026-08-04T12:00:00Z" });
  assert.equal(blocked.readyForOwnerControlledReleaseAction, false);
  assert.equal(blocked.cadence.callerDeclaredNormalWindowOpen, false);
  assert.equal(blocked.cadence.cadenceComplianceProven, false);
  assert.ok(blocked.blockers.some((entry) => entry.includes("2026-08-05T00:00:00Z")));

  const exact = planPrivateRelease({
    candidate: readyCandidate({ requestedReleaseAt: "2026-08-05T00:00:00Z" }),
    history,
    now: "2026-08-04T12:00:00Z"
  });
  assert.equal(exact.cadence.callerDeclaredNormalWindowOpen, true);
  assert.equal(exact.callerDeclaredPlanComplete, true);
  assert.equal(exact.cadence.releaseHistoryAuthenticated, false);
  assert.equal(exact.cadence.trustedTimeAuthenticated, false);
  assert.equal(exact.releaseReadinessProven, false);
  assert.equal(exact.releaseActionAuthorized, false);
  assert.equal(exact.readyForOwnerControlledReleaseAction, false);
  assert.equal(exact.externalVerificationRequirements.length, 5);
  assert.equal(exact.publicationPerformed, false);
});

test("calendar and timezone boundaries cannot shorten the 24-hour window", () => {
  const history = releaseHistory("2026-08-03T23:30:00-07:00");
  const candidate = readyCandidate({ requestedReleaseAt: "2026-08-05T00:00:00+02:00" });
  const result = planPrivateRelease({ candidate, history, now: "2026-08-04T20:00:00Z" });
  assert.equal(result.cadence.callerDeclaredNormalWindowOpen, false);
  assert.equal(result.cadence.calculatedNextNormalReleaseAt, "2026-08-05T06:30:00Z");
  assert.equal(result.cadence.cadenceComplianceProven, false);
  assert.equal(result.readyForOwnerControlledReleaseAction, false);
});

test("a caller-declared security hotfix exception never proves cadence, privacy, or authority", () => {
  const candidate = securityHotfixCandidate();
  const result = planPrivateRelease({
    candidate,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T00:30:00Z"
  });
  assert.equal(result.cadence.callerDeclaredNormalWindowOpen, false);
  assert.equal(result.cadence.hotfixException.callerDeclaredComplete, true);
  assert.equal(result.cadence.hotfixException.callerDeclaredCriticalSeverity, true);
  assert.equal(result.cadence.hotfixException.callerDeclaredCadenceExceptionEligible, true);
  assert.deepEqual(result.cadence.hotfixException.affectedVersions, ["0.2.0", "0.2.1"]);
  assert.equal(result.cadence.hotfixException.ownerOverrideNotBeforePreparedAt, true);
  assert.equal(result.cadence.hotfixException.ownerOverrideNotAfterPlanningTime, true);
  assert.equal(result.cadence.hotfixException.cadenceExceptionProven, false);
  assert.equal(result.cadence.hotfixException.ownerIdentityAuthenticated, false);
  assert.equal(result.cadence.hotfixException.ownerAuthorityVerified, false);
  assert.equal(result.callerDeclaredPlanComplete, true);
  assert.equal(result.readyForOwnerControlledReleaseAction, false);
  assert.equal(result.candidate.callerDeclaredPrivateCandidate, true);
  assert.equal(result.candidate.callerDeclaredPublicState, "not-published");
  assert.equal(result.candidate.privacyProven, false);
  assert.equal(result.candidate.publicationStateVerified, false);
  assert.equal(result.candidate.liveStateVerified, false);
  assert.equal(result.publicClaimAllowed, false);
});

test("a non-critical security hotfix cannot bypass the 24-hour calculation", () => {
  const candidate = securityHotfixCandidate({ securityHotfix: { severity: "high" } });
  const result = planPrivateRelease({
    candidate,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T00:30:00Z"
  });
  assert.equal(result.cadence.callerDeclaredNormalWindowOpen, false);
  assert.equal(result.cadence.hotfixException.callerDeclaredComplete, true);
  assert.equal(result.cadence.hotfixException.callerDeclaredCriticalSeverity, false);
  assert.equal(result.cadence.hotfixException.callerDeclaredCadenceExceptionEligible, false);
  assert.equal(result.callerDeclaredPlanComplete, false);
  assert.ok(result.declaredPlanningBlockers.some((entry) => entry.includes("only a complete caller-declared critical security hotfix")));
  assert.equal(result.releaseActionAuthorized, false);
});

test("security hotfixes reject empty or unsorted affected versions and feature bundles", () => {
  assertLifecycleCode(() => planPrivateRelease({
    candidate: securityHotfixCandidate({ securityHotfix: { affectedVersions: [] } }),
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T00:30:00Z"
  }), "RELEASE_CANDIDATE_INVALID");

  assertLifecycleCode(() => planPrivateRelease({
    candidate: securityHotfixCandidate({ securityHotfix: { affectedVersions: ["0.2.1", "0.2.0"] } }),
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T00:30:00Z"
  }), "RELEASE_CANDIDATE_INVALID");

  assertLifecycleCode(() => planPrivateRelease({
    candidate: securityHotfixCandidate({
      changes: [{ id: "feature-disguised-as-hotfix", kind: "feature", summary: "A feature bundle." }]
    }),
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T00:30:00Z"
  }), "RELEASE_CANDIDATE_INVALID");

  const unknownKind = readyCandidate();
  unknownKind.changes[0].kind = "other";
  assertLifecycleCode(() => planPrivateRelease({
    candidate: unknownKind,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T12:00:00Z"
  }), "RELEASE_CANDIDATE_INVALID");
});

test("normal releases reject every security-hotfix field", () => {
  for (const mutate of [
    (candidate) => { candidate.securityHotfix.severity = "critical"; },
    (candidate) => { candidate.securityHotfix.affectedVersions = ["0.2.1"]; },
    (candidate) => { candidate.securityHotfix.reasonCode = "not-a-normal-field"; },
    (candidate) => { candidate.securityHotfix.incidentRecordSha256 = HASH_B; },
    (candidate) => { candidate.securityHotfix.ownerOverride = ownerEvidence("missing", null, null, null); }
  ]) {
    const candidate = readyCandidate();
    mutate(candidate);
    assertLifecycleCode(() => planPrivateRelease({
      candidate,
      history: releaseHistory("2026-08-04T00:00:00Z"),
      now: "2026-08-04T12:00:00Z"
    }), "RELEASE_CANDIDATE_INVALID");
  }
});

test("owner GO and hotfix override must be granted after preparation and no later than planning time", () => {
  const earlyOwner = readyCandidate({
    ownerReleaseGo: ownerEvidence("granted", HASH_A, "release/owner-go.json", "2026-08-03T23:59:59Z")
  });
  const earlyOwnerResult = planPrivateRelease({
    candidate: earlyOwner,
    history: releaseHistory("2026-08-03T00:00:00Z"),
    now: "2026-08-04T12:00:00Z"
  });
  assert.equal(earlyOwnerResult.ownerReleaseGo.callerDeclaredComplete, false);
  assert.equal(earlyOwnerResult.ownerReleaseGo.grantedNotBeforePreparedAt, false);
  assert.equal(earlyOwnerResult.ownerReleaseGo.grantedNotAfterPlanningTime, true);

  const futureOwner = readyCandidate({
    ownerReleaseGo: ownerEvidence("granted", HASH_A, "release/owner-go.json", "2026-08-04T12:00:01Z")
  });
  const futureOwnerResult = planPrivateRelease({
    candidate: futureOwner,
    history: releaseHistory("2026-08-03T00:00:00Z"),
    now: "2026-08-04T12:00:00Z"
  });
  assert.equal(futureOwnerResult.ownerReleaseGo.callerDeclaredComplete, false);
  assert.equal(futureOwnerResult.ownerReleaseGo.grantedNotBeforePreparedAt, true);
  assert.equal(futureOwnerResult.ownerReleaseGo.grantedNotAfterPlanningTime, false);

  const earlyOverride = securityHotfixCandidate({
    securityHotfix: {
      ownerOverride: ownerEvidence("granted", HASH_C, "evidence/security-hotfix-owner-go.json", "2026-08-03T23:59:59Z")
    }
  });
  const earlyOverrideResult = planPrivateRelease({
    candidate: earlyOverride,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T00:30:00Z"
  });
  assert.equal(earlyOverrideResult.cadence.hotfixException.callerDeclaredComplete, false);
  assert.equal(earlyOverrideResult.cadence.hotfixException.ownerOverrideNotBeforePreparedAt, false);
  assert.equal(earlyOverrideResult.cadence.hotfixException.ownerOverrideNotAfterPlanningTime, true);

  const futureOverride = securityHotfixCandidate({
    securityHotfix: {
      ownerOverride: ownerEvidence("granted", HASH_C, "evidence/security-hotfix-owner-go.json", "2026-08-04T00:30:01Z")
    }
  });
  const futureOverrideResult = planPrivateRelease({
    candidate: futureOverride,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T00:30:00Z"
  });
  assert.equal(futureOverrideResult.cadence.hotfixException.callerDeclaredComplete, false);
  assert.equal(futureOverrideResult.cadence.hotfixException.ownerOverrideNotBeforePreparedAt, true);
  assert.equal(futureOverrideResult.cadence.hotfixException.ownerOverrideNotAfterPlanningTime, false);
  assert.equal(futureOverrideResult.cadence.hotfixException.callerDeclaredCadenceExceptionEligible, false);
});

test("planned source, artifact, manifest, change kind, severity, and affected versions are intent-bound", () => {
  const normal = readyCandidate();
  const normalIntent = releaseIntentDigest(normal);
  const normalMutations = [
    (candidate) => { candidate.plannedRelease.builder.fromVersion = "0.2.0"; },
    (candidate) => { candidate.plannedRelease.submissionStandard.toVersion = "1.5.0"; },
    (candidate) => { candidate.plannedRelease.feePolicy.toVersion = "1.2.0"; },
    (candidate) => { candidate.plannedRelease.source.commitSha = GIT_C; },
    (candidate) => { candidate.plannedRelease.source.treeSha = GIT_C; },
    (candidate) => { candidate.plannedRelease.source.tagName = "programmable-v4-builder-v0.3.0-other"; },
    (candidate) => { candidate.plannedRelease.artifact.sha256 = HASH_A; },
    (candidate) => { candidate.plannedRelease.releaseManifest.sha256 = HASH_A; },
    (candidate) => { candidate.changes[0].kind = "maintenance"; }
  ];
  for (const mutate of normalMutations) {
    const changed = JSON.parse(JSON.stringify(normal));
    mutate(changed);
    assert.notEqual(releaseIntentDigest(changed), normalIntent);
  }

  const hotfix = securityHotfixCandidate();
  const hotfixIntent = releaseIntentDigest(hotfix);
  for (const mutate of [
    (candidate) => { candidate.securityHotfix.severity = "high"; },
    (candidate) => { candidate.securityHotfix.affectedVersions.push("0.2.2"); }
  ]) {
    const changed = JSON.parse(JSON.stringify(hotfix));
    mutate(changed);
    assert.notEqual(releaseIntentDigest(changed), hotfixIntent);
  }

  const changedArtifact = JSON.parse(JSON.stringify(normal));
  changedArtifact.plannedRelease.artifact.sha256 = HASH_A;
  const result = planPrivateRelease({
    candidate: changedArtifact,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T12:00:00Z"
  });
  assert.equal(result.ownerReleaseGo.intentDigestMatches, false);
  assert.equal(result.ownerReleaseGo.callerDeclaredComplete, false);
  assert.equal(result.releaseActionAuthorized, false);
});

test("planned release identity rejects mismatched semantic classification", () => {
  const candidate = readyCandidate();
  candidate.plannedRelease.builder.semanticClassification = "patch";
  assertLifecycleCode(() => planPrivateRelease({
    candidate,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T12:00:00Z"
  }), "RELEASE_CANDIDATE_INVALID");

  for (const field of ["commitSha", "treeSha"]) {
    const abbreviated = readyCandidate();
    abbreviated.plannedRelease.source[field] = "abcdef1";
    assertLifecycleCode(() => planPrivateRelease({
      candidate: abbreviated,
      history: releaseHistory("2026-08-04T00:00:00Z"),
      now: "2026-08-04T12:00:00Z"
    }), "RELEASE_CANDIDATE_INVALID");
  }
});

test("evidence placeholders cannot become complete by changing only the status", () => {
  const candidate = readyCandidate({ requestedReleaseAt: "2026-08-06T00:00:00Z" });
  candidate.evidence.sbom = { status: "complete", path: null, evidenceSha256: null };
  const result = planPrivateRelease({
    candidate,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-05T00:00:00Z"
  });
  assert.equal(result.evidence.sbom.callerDeclaredComplete, false);
  assert.equal(result.evidence.sbom.artifactRead, false);
  assert.equal(result.evidence.sbom.evidenceDigestVerified, false);
  assert.equal(result.readyForOwnerControlledReleaseAction, false);
  assert.ok(result.blockers.some((entry) => entry.includes("candidate.evidence.sbom")));
});

test("owner release GO cannot be replayed after the private candidate changes", () => {
  const candidate = readyCandidate({ requestedReleaseAt: "2026-08-05T00:00:00Z" });
  candidate.changes.push({ id: "after-owner-go", kind: "feature", summary: "A change added after the owner decision." });
  const result = planPrivateRelease({
    candidate,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T12:00:00Z"
  });
  assert.equal(result.ownerReleaseGo.callerDeclaredComplete, false);
  assert.equal(result.ownerReleaseGo.intentDigestMatches, false);
  assert.equal(result.ownerReleaseGo.identityAuthenticated, false);
  assert.equal(result.ownerReleaseGo.authorityVerified, false);
  assert.equal(result.readyForOwnerControlledReleaseAction, false);
  assert.ok(result.declaredPlanningBlockers.some((entry) => entry.includes("owner-GO")));
});

test("shipped candidate template remains an incomplete caller declaration", () => {
  const candidate = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "release-candidate.example.json"),
    "utf8"
  ));
  const result = planPrivateRelease({
    candidate,
    history: { schemaVersion: "1.0.0", releases: [] },
    now: "2026-08-03T09:00:00Z"
  });
  assert.equal(result.readyForOwnerControlledReleaseAction, false);
  assert.equal(result.candidate.callerDeclaredPrivateCandidate, true);
  assert.equal(result.candidate.callerDeclaredPublicState, "not-published");
  assert.equal(result.candidate.privacyProven, false);
  assert.equal(result.candidate.publicationStateVerified, false);
  assert.equal(result.candidate.liveStateVerified, false);
  assert.equal(result.publicationPerformed, false);
  assert.equal(result.callerDeclaredPlanComplete, false);
  assert.deepEqual(result.candidate.plannedRelease.builder, {
    fromVersion: "0.4.0",
    toVersion: "0.5.1",
    semanticClassification: "minor"
  });
  assert.deepEqual(result.candidate.plannedRelease.submissionStandard, { fromVersion: "1.5.0", toVersion: "1.6.0" });
  assert.deepEqual(result.candidate.plannedRelease.feePolicy, { fromVersion: "1.1.0", toVersion: "1.1.0" });
  assert.equal(result.candidate.plannedRelease.source.commitSha, null);
  assert.equal(result.candidate.plannedRelease.source.treeSha, null);
  assert.equal(result.candidate.plannedRelease.source.tagName, null);
  assert.equal(result.candidate.plannedRelease.source.callerDeclaredComplete, false);
  assert.equal(result.candidate.plannedRelease.artifact.callerDeclaredCoordinatesComplete, false);
  assert.equal(result.candidate.plannedRelease.releaseManifest.callerDeclaredCoordinatesComplete, false);
  assert.equal(result.candidate.plannedRelease.callerDeclaredComplete, false);
  assert.equal(result.candidate.plannedRelease.externallyVerified, false);
  assert.ok(result.declaredPlanningBlockers.length >= 9);
  assert.equal(result.externalVerificationRequirements.length, 5);
});

test("shipped critical-hotfix template is closed but cannot declare a cadence exception complete", () => {
  const candidate = readLifecycleTemplate("release-candidate.critical-hotfix.caller-declared.example.json");
  const result = planPrivateRelease({
    candidate,
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T00:30:00Z"
  });
  assert.equal(result.candidate.releaseKind, "security-hotfix");
  assert.deepEqual(result.bundledChanges.changes, [
    { id: "replace-with-security-advisory-id", kind: "security-advisory" },
    { id: "replace-with-security-fix-id", kind: "security-fix" }
  ]);
  assert.equal(result.candidate.plannedRelease.callerDeclaredComplete, false);
  assert.equal(result.cadence.hotfixException.callerDeclaredCriticalSeverity, true);
  assert.equal(result.cadence.hotfixException.callerDeclaredComplete, false);
  assert.equal(result.cadence.hotfixException.callerDeclaredCadenceExceptionEligible, false);
  assert.equal(result.cadence.hotfixException.cadenceExceptionProven, false);
  assert.equal(result.callerDeclaredPlanComplete, false);
  assert.equal(result.releaseActionAuthorized, false);
});

test("well-shaped nonexistent evidence coordinates never prove W5 readiness", () => {
  const result = planPrivateRelease({
    candidate: readyCandidate({ requestedReleaseAt: "2026-08-05T00:00:00Z" }),
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T12:00:00Z"
  });
  assert.equal(result.callerDeclaredPlanComplete, true);
  assert.deepEqual(result.declaredPlanningBlockers, []);
  assert.equal(result.evidence.checksums.callerDeclaredComplete, true);
  assert.equal(result.evidence.checksums.artifactRead, false);
  assert.equal(result.evidence.checksums.evidenceDigestVerified, false);
  assert.equal(result.ownerReleaseGo.callerDeclaredComplete, true);
  assert.equal(result.ownerReleaseGo.identityAuthenticated, false);
  assert.equal(result.ownerReleaseGo.authorityVerified, false);
  assert.equal(result.releaseReadinessProven, false);
  assert.equal(result.readyForOwnerControlledReleaseAction, false);
  assert.equal(result.blockers.length, result.externalVerificationRequirements.length);
});

test("empty caller history and caller time cannot prove an open release window", () => {
  const result = planPrivateRelease({
    candidate: readyCandidate({ requestedReleaseAt: "2026-08-05T00:00:00Z" }),
    history: { schemaVersion: "1.0.0", releases: [] },
    now: "2026-08-04T12:00:00Z"
  });
  assert.equal(result.cadence.callerDeclaredNormalWindowOpen, true);
  assert.equal(result.cadence.callerSuppliedHistoryEntries, 0);
  assert.equal(result.cadence.releaseHistoryAuthenticated, false);
  assert.equal(result.cadence.trustedTimeAuthenticated, false);
  assert.equal(result.cadence.cadenceComplianceProven, false);
  assert.equal(result.readyForOwnerControlledReleaseAction, false);
});

test("human release output never presents caller declarations as private or ready", () => {
  const result = planPrivateRelease({
    candidate: readyCandidate({ requestedReleaseAt: "2026-08-05T00:00:00Z" }),
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T12:00:00Z"
  });
  const human = renderHumanStatus(result);
  assert.match(human, /Local release calculation/u);
  assert.match(human, /unverified/u);
  assert.doesNotMatch(human, /private candidate|ready for separate|release-ready/iu);
});

test("release planning and human rendering are deterministic", () => {
  const input = {
    candidate: readyCandidate({ requestedReleaseAt: "2026-08-05T00:00:00Z" }),
    history: releaseHistory("2026-08-04T00:00:00Z"),
    now: "2026-08-04T12:00:00Z"
  };
  const first = planPrivateRelease(input);
  const second = planPrivateRelease(JSON.parse(JSON.stringify(input)));
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(renderHumanStatus(first), renderHumanStatus(second));
});

test("packaged update fixture is cryptographically consistent and explicitly non-production", () => {
  const signedFixturePath = path.join(lifecycleTemplates, "signed-update.TEST-ONLY.example.json");
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(signedFixturePath)).digest("hex"),
    "543419942827edd89c61dc8ebbcd40830a935e5315772789910f636c15b84dcb"
  );
  const state = readLifecycleTemplate("installed-state.TEST-ONLY.example.json");
  const trustedPin = readLifecycleTemplate("trusted-pin.TEST-ONLY.example.json");
  const signedUpdate = readLifecycleTemplate("signed-update.TEST-ONLY.example.json");
  const result = checkSignedUpdate({ state, trustedPin, signedUpdate, now: "2026-08-03T12:00:00Z" });
  assert.equal(result.status, "migration-required");
  assert.equal(result.verification.authenticated, true);
  assert.equal(result.verification.authenticationScope, "test-fixture-only");
  assert.equal(result.verification.fixtureOnly, true);
  assert.equal(result.verification.authenticatedToSuppliedInstalledPin, true);
  assert.equal(result.verification.productionTrustEstablishedByThisCommand, false);
  assert.equal(result.activationAllowedThisSession, false);
  assert.match(result.nextAction, /never install, trust, or publish/u);
  assert.match(renderHumanStatus(result), /TEST FIXTURE ONLY/u);
});

test("the packaged fixture key cannot be relabeled as production trust", () => {
  const signedUpdate = readLifecycleTemplate("signed-update.TEST-ONLY.example.json");
  const fixturePin = readLifecycleTemplate("trusted-pin.TEST-ONLY.example.json");
  const trustedPin = { ...fixturePin, pinId: "programmable-builder-release-root-pretend-production" };
  const state = {
    ...readLifecycleTemplate("installed-state.TEST-ONLY.example.json"),
    trustedPinSha256: digestCanonical(trustedPin)
  };
  const result = checkSignedUpdate({ state, trustedPin, signedUpdate, now: "2026-08-03T12:00:00Z" });
  assert.equal(result.verification.fixtureOnly, true);
  assert.equal(result.verification.productionTrustEstablishedByThisCommand, false);
});

test("a modified packaged fixture signature fails closed", () => {
  const state = readLifecycleTemplate("installed-state.TEST-ONLY.example.json");
  const trustedPin = readLifecycleTemplate("trusted-pin.TEST-ONLY.example.json");
  const signedUpdate = readLifecycleTemplate("signed-update.TEST-ONLY.example.json");
  signedUpdate.signature.signature = `A${signedUpdate.signature.signature.slice(1)}`;
  assertLifecycleCode(() => checkSignedUpdate({
    state,
    trustedPin,
    signedUpdate,
    now: "2026-08-03T12:00:00Z"
  }), "UPDATE_SIGNATURE_INVALID");
});

test("packaged migration examples are digest-bound and preserve protected fields", () => {
  const state = readLifecycleTemplate("installed-state.TEST-ONLY.example.json");
  const trustedPin = readLifecycleTemplate("trusted-pin.TEST-ONLY.example.json");
  const signedUpdate = readLifecycleTemplate("signed-update.TEST-ONLY.example.json");
  const currentDocument = readLifecycleTemplate("migration-current-document.example.json");
  const proposal = readLifecycleTemplate("migration-proposal.example.json");
  const verifiedUpdate = verifySignedUpdate({ state, trustedPin, signedUpdate, now: "2026-08-03T12:00:00Z" });
  const result = migrationDryRun({ currentDocument, proposal, verifiedUpdate });
  assert.equal(result.status, "review-ready");
  assert.deepEqual(result.changes.map((entry) => entry.path), ["/standardVersion"]);
  assert.deepEqual(result.protectedChangeSummary, {
    economics: 0,
    wallet: 0,
    authority: 0,
    risk: 0,
    evidence: 0
  });
  assert.deepEqual(result.confirmations, []);
  assert.equal(result.writePerformed, false);
  assert.equal(result.autoApplyAllowed, false);
});

test("packaged caller-declared release history demonstrates shape without proving cadence", () => {
  const candidate = JSON.parse(fs.readFileSync(
    path.join(skillRoot, "assets", "templates", "release-candidate.example.json"),
    "utf8"
  ));
  const history = readLifecycleTemplate("release-history.caller-declared.example.json");
  const result = planPrivateRelease({ candidate, history, now: "2026-08-03T09:00:00Z" });
  assert.equal(result.cadence.callerDeclaredNormalWindowOpen, true);
  assert.equal(result.cadence.releaseHistoryAuthenticated, false);
  assert.equal(result.cadence.trustedTimeAuthenticated, false);
  assert.equal(result.cadence.cadenceComplianceProven, false);
  assert.equal(result.readyForOwnerControlledReleaseAction, false);
});

test("packaged lifecycle examples run through the standalone update and migration commands", () => {
  const update = childProcess.spawnSync(process.execPath, [
    lifecycleCli,
    "update-check",
    "--state", path.join(lifecycleTemplates, "installed-state.TEST-ONLY.example.json"),
    "--update", path.join(lifecycleTemplates, "signed-update.TEST-ONLY.example.json"),
    "--pin", path.join(lifecycleTemplates, "trusted-pin.TEST-ONLY.example.json"),
    "--now", "2026-08-03T12:00:00Z",
    "--human"
  ], { encoding: "utf8", shell: false });
  assert.equal(update.status, 0, update.stdout || update.stderr);
  assert.equal(JSON.parse(update.stdout).result.verification.fixtureOnly, true);
  assert.match(update.stderr, /TEST FIXTURE ONLY/u);

  const migration = childProcess.spawnSync(process.execPath, [
    lifecycleCli,
    "migrate",
    "--current", path.join(lifecycleTemplates, "migration-current-document.example.json"),
    "--proposal", path.join(lifecycleTemplates, "migration-proposal.example.json"),
    "--state", path.join(lifecycleTemplates, "installed-state.TEST-ONLY.example.json"),
    "--update", path.join(lifecycleTemplates, "signed-update.TEST-ONLY.example.json"),
    "--pin", path.join(lifecycleTemplates, "trusted-pin.TEST-ONLY.example.json"),
    "--now", "2026-08-03T12:00:00Z",
    "--dry-run",
    "--human"
  ], { encoding: "utf8", shell: false });
  assert.equal(migration.status, 0, migration.stdout || migration.stderr);
  assert.equal(JSON.parse(migration.stdout).result.status, "review-ready");
  assert.match(migration.stderr, /Migration dry-run/u);

  const release = childProcess.spawnSync(process.execPath, [
    lifecycleCli,
    "plan-release",
    "--candidate", path.join(skillRoot, "assets", "templates", "release-candidate.example.json"),
    "--history", path.join(lifecycleTemplates, "release-history.caller-declared.example.json"),
    "--now", "2026-08-03T09:00:00Z",
    "--human"
  ], { encoding: "utf8", shell: false });
  assert.equal(release.status, 0, release.stdout || release.stderr);
  const releaseOutput = JSON.parse(release.stdout).result;
  assert.equal(releaseOutput.kind, "caller-declared-local-release-plan");
  assert.equal(releaseOutput.releaseReadinessProven, false);
  assert.equal(releaseOutput.readyForOwnerControlledReleaseAction, false);
  assert.match(release.stderr, /privacy, cadence, planned source identity, artifact and release-manifest bytes, owner authority, and release readiness are all unverified/u);
  assert.doesNotMatch(release.stderr, /private candidate|ready for separate|release-ready/iu);
});

test("standalone CLI preserves canonical JSON on stdout when human output is requested", () => {
  const fixture = trustFixture();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-lifecycle-"));
  try {
    const statePath = path.join(temporary, "state.json");
    fs.writeFileSync(statePath, `${JSON.stringify(fixture.state)}\n`);
    const result = childProcess.spawnSync(process.execPath, [lifecycleCli, "version", "--state", statePath, "--human"], {
      encoding: "utf8",
      shell: false
    });
    assert.equal(result.status, 0, result.stdout || result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(result.stdout, `${canonicalJson(parsed)}\n`);
    assert.equal(parsed.ok, true);
    assert.match(result.stderr, /^Builder 0\.2\.1 \(stable; not-verified\)/u);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("standalone CLI reports bundled version without an installed-state file", () => {
  const result = childProcess.spawnSync(process.execPath, [lifecycleCli, "version"], {
    encoding: "utf8",
    shell: false
  });
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.result.installed.releaseVersion, "0.5.1");
  assert.equal(parsed.result.installed.publicationState, "unpublished-candidate");
  assert.equal(parsed.result.versionSource, "bundled-code-constants");
  assert.equal(parsed.result.installedStateOverrideUsed, false);
});

test("standalone CLI rejects duplicate JSON keys before lifecycle evaluation", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-duplicate-json-"));
  try {
    const statePath = path.join(temporary, "state.json");
    fs.writeFileSync(statePath, "{\"schemaVersion\":\"1.0.0\",\"schemaVersion\":\"1.0.0\"}\n");
    const result = childProcess.spawnSync(process.execPath, [lifecycleCli, "version", "--state", statePath], {
      encoding: "utf8",
      shell: false
    });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).error.code, "INPUT_INVALID");
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

test("standalone migrate command refuses any non-dry-run invocation", () => {
  const fixture = trustFixture();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-migration-cli-"));
  try {
    const current = currentDocument();
    const inputs = {
      current,
      proposal: completeMigrationProposal(current),
      state: fixture.state,
      update: fixture.signedUpdate,
      pin: fixture.pin
    };
    for (const [name, value] of Object.entries(inputs)) fs.writeFileSync(path.join(temporary, `${name}.json`), `${JSON.stringify(value)}\n`);
    const result = childProcess.spawnSync(process.execPath, [
      lifecycleCli,
      "migrate",
      "--current", path.join(temporary, "current.json"),
      "--proposal", path.join(temporary, "proposal.json"),
      "--state", path.join(temporary, "state.json"),
      "--update", path.join(temporary, "update.json"),
      "--pin", path.join(temporary, "pin.json"),
      "--now", "2026-08-03T12:00:00Z"
    ], {
      encoding: "utf8",
      shell: false
    });
    assert.equal(result.status, 1);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.error.code, "DRY_RUN_REQUIRED");
    assert.equal(output.networkAccessed, false);
    assert.deepEqual(output.externalActionsPerformed, []);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});

function trustFixture({ minimumReleaseSequence = "1" } = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const rawPublicKey = Buffer.from(spki).subarray(-32);
  const keyId = crypto.createHash("sha256").update(rawPublicKey).digest("hex");
  const pin = {
    schemaVersion: "1.0.0",
    pinId: "programmable-builder-release-root-1",
    keyId,
    publicKey: rawPublicKey.toString("base64url"),
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    channels: ["stable", "canary"],
    minimumReleaseSequence
  };
  const state = {
    schemaVersion: "1.0.0",
    releaseVersion: "0.2.1",
    releaseSequence: "1",
    channel: "stable",
    standards: standards("1.3.0"),
    trustedPinSha256: digestCanonical(pin),
    trustedKeyId: keyId
  };
  const payload = {
    schemaVersion: "1.0.0",
    releaseSequence: "2",
    channel: "stable",
    releaseVersion: "0.3.0",
    minimumInstalledVersion: "0.2.1",
    releasedAt: "2026-08-03T08:00:00Z",
    validUntil: "2026-08-10T00:00:00Z",
    standards: standards("1.4.0"),
    migration: {
      required: false,
      fromStandard: "1.3.0",
      toStandard: "1.4.0",
      majorConsentRequired: false
    },
    artifacts: [
      { id: "builder-skill", bytes: 1234, sha256: HASH_A },
      { id: "deterministic-engine", bytes: 5678, sha256: HASH_B }
    ],
    evidence: {
      checksums: evidence("release/checksums.json", HASH_A),
      sbom: evidence("release/sbom.json", HASH_B),
      evals: evidence("release/evals.json", HASH_C),
      canary: evidence("release/canary.json", HASH_A)
    }
  };
  const signUpdate = (nextPayload, envelope = {}) => {
    const payloadBytes = Buffer.from(canonicalJson(nextPayload), "utf8");
    return {
      payload: JSON.parse(JSON.stringify(nextPayload)),
      signature: {
        algorithm: "Ed25519",
        keyId,
        issuedAt: envelope.issuedAt ?? "2026-08-03T08:00:00Z",
        validUntil: envelope.validUntil ?? "2026-08-10T00:00:00Z",
        payloadSha256: `sha256:${crypto.createHash("sha256").update(payloadBytes).digest("hex")}`,
        signature: crypto.sign(null, payloadBytes, privateKey).toString("base64url")
      }
    };
  };
  return { state, pin, payload, signedUpdate: signUpdate(payload), signUpdate };
}

function standards(submission) {
  return {
    skill: "0.3.0",
    engine: "0.3.0",
    policy: "1.0.0",
    schema: "1.0.0",
    submission
  };
}

function currentDocument() {
  return {
    standardVersion: "1.3.0",
    economics: { platformRateBps: 10 },
    wallets: { platformOwner: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c" },
    evidence: { localReport: HASH_A }
  };
}

function proposedDocument() {
  return {
    standardVersion: "1.4.0",
    economics: { platformRateBps: 12 },
    wallets: { platformOwner: "0x1111111111111111111111111111111111111111" },
    evidence: { localReport: HASH_A }
  };
}

function completeMigrationProposal(current) {
  return {
    schemaVersion: "1.0.0",
    fromStandard: "1.3.0",
    toStandard: "1.4.0",
    expectedCurrentSha256: digestCanonical(current),
    proposedDocument: proposedDocument(),
    changeReasons: [
      { path: "/economics/platformRateBps", reason: "Explicit economic proposal for owner review." },
      { path: "/standardVersion", reason: "Adopt the authenticated submission standard." },
      { path: "/wallets/platformOwner", reason: "Explicit wallet proposal for owner review." }
    ]
  };
}

function readyCandidate(overrides = {}) {
  const candidate = {
    schemaVersion: "1.0.0",
    candidateId: "programmable-v4-builder-v0.3.0-private",
    privateCandidate: true,
    publicState: "not-published",
    releaseVersion: "0.3.0",
    channel: "stable",
    releaseKind: "normal",
    plannedRelease: plannedRelease(),
    preparedAt: "2026-08-04T00:00:00Z",
    requestedReleaseAt: "2026-08-05T00:00:00Z",
    changeSetComplete: true,
    changes: [
      { id: "templates", kind: "feature", summary: "Add capability templates." },
      { id: "upgrade-lifecycle", kind: "feature", summary: "Add deterministic upgrade lifecycle." }
    ],
    unbundledChangeIds: [],
    evidence: {
      checksums: evidence("release/checksums.json", HASH_A),
      sbom: evidence("release/sbom.json", HASH_B),
      evals: evidence("release/evals.json", HASH_C),
      canary: evidence("release/canary.json", HASH_A)
    },
    communications: {
      dailyReleaseNotes: evidence("release/daily-notes.md", HASH_B),
      publicPostSummary: evidence("release/post-summary.md", HASH_C)
    },
    ownerReleaseGo: ownerEvidence("missing", null, null, null),
    securityHotfix: {
      severity: null,
      affectedVersions: [],
      reasonCode: null,
      incidentRecordSha256: null,
      ownerOverride: ownerEvidence("not-applicable", null, null, null)
    }
  };
  const merged = { ...candidate, ...overrides };
  const intentSha256 = releaseIntentDigest(merged);
  if (merged.ownerReleaseGo.status === "missing") {
    merged.ownerReleaseGo = ownerEvidence("granted", HASH_A, "release/owner-go.json", "2026-08-04T00:00:00Z", intentSha256);
  } else if (merged.ownerReleaseGo.status === "granted" && merged.ownerReleaseGo.releaseIntentSha256 === null) {
    merged.ownerReleaseGo = { ...merged.ownerReleaseGo, releaseIntentSha256: intentSha256 };
  }
  if (merged.securityHotfix.ownerOverride.status === "granted" && merged.securityHotfix.ownerOverride.releaseIntentSha256 === null) {
    merged.securityHotfix = {
      ...merged.securityHotfix,
      ownerOverride: { ...merged.securityHotfix.ownerOverride, releaseIntentSha256: intentSha256 }
    };
  }
  return merged;
}

function plannedRelease(overrides = {}) {
  const value = {
    builder: { fromVersion: "0.2.1", toVersion: "0.3.0", semanticClassification: "minor" },
    submissionStandard: { fromVersion: "1.3.0", toVersion: "1.4.0" },
    feePolicy: { fromVersion: "1.0.0", toVersion: "1.1.0" },
    source: { commitSha: GIT_A, treeSha: GIT_B, tagName: "programmable-v4-builder-v0.3.0" },
    artifact: { path: "release/programmable-v4-hook-builder.tar.gz", sha256: HASH_B },
    releaseManifest: { path: "release/release-manifest.json", sha256: HASH_C }
  };
  return { ...value, ...overrides };
}

function securityHotfixCandidate(overrides = {}) {
  const base = {
    releaseVersion: "0.2.2",
    releaseKind: "security-hotfix",
    plannedRelease: plannedRelease({
      builder: { fromVersion: "0.2.1", toVersion: "0.2.2", semanticClassification: "patch" },
      source: { commitSha: GIT_A, treeSha: GIT_B, tagName: "programmable-v4-builder-v0.2.2" }
    }),
    requestedReleaseAt: "2026-08-04T01:00:00Z",
    changes: [
      { id: "critical-parser-fix", kind: "security-fix", summary: "Fix the critical parser bypass." },
      { id: "critical-parser-advisory", kind: "security-advisory", summary: "Document affected versions." }
    ],
    securityHotfix: {
      severity: "critical",
      affectedVersions: ["0.2.0", "0.2.1"],
      reasonCode: "critical-parser-bypass",
      incidentRecordSha256: HASH_B,
      ownerOverride: ownerEvidence("granted", HASH_C, "evidence/security-hotfix-owner-go.json", "2026-08-04T00:30:00Z")
    }
  };
  return readyCandidate({
    ...base,
    ...overrides,
    securityHotfix: { ...base.securityHotfix, ...(overrides.securityHotfix ?? {}) }
  });
}

function releaseHistory(releasedAt) {
  return {
    schemaVersion: "1.0.0",
    releases: [{
      releaseVersion: "0.2.1",
      channel: "stable",
      releaseKind: "normal",
      releasedAt,
      ownerGoEvidenceSha256: HASH_A
    }]
  };
}

function evidence(pathValue, digest) {
  return { status: "complete", path: pathValue, evidenceSha256: digest };
}

function ownerEvidence(status, digest, pathValue, grantedAt, releaseIntentSha256 = null) {
  return { status, path: pathValue, evidenceSha256: digest, releaseIntentSha256, grantedAt };
}

function readLifecycleTemplate(name) {
  return JSON.parse(fs.readFileSync(path.join(lifecycleTemplates, name), "utf8"));
}

function assertLifecycleCode(callback, expected) {
  assert.throws(callback, (error) => error instanceof BuilderLifecycleError && error.code === expected);
}
