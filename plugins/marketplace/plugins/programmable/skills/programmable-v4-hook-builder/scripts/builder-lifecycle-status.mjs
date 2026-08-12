import {
  PROGRAMMABLE_FEE_POLICY_VERSION,
  STANDARD_VERSION
} from "./submission-core.mjs";
import {
  BUILDER_LIFECYCLE_SCHEMA_VERSION,
  BUNDLED_BUILDER_PUBLICATION_STATE,
  BUNDLED_BUILDER_VERSION,
  assertPlainObject,
  cloneJson
} from "./builder-lifecycle-shared.mjs";
import { validateInstalledState } from "./builder-lifecycle-update.mjs";

export function versionStatus(state) {
  validateInstalledState(state);
  return {
    kind: "builder-version-status",
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    installed: {
      channel: state.channel,
      publicationState: "not-verified",
      releaseSequence: state.releaseSequence,
      releaseVersion: state.releaseVersion,
      standards: cloneJson(state.standards)
    },
    trust: {
      keyId: state.trustedKeyId,
      pinSha256: state.trustedPinSha256
    },
    publicationStateVerified: false,
    historicalStandardsPreserved: true,
    networkAccessed: false,
    externalActionsPerformed: []
  };
}

export function bundledVersionStatus() {
  return {
    kind: "builder-version-status",
    schemaVersion: BUILDER_LIFECYCLE_SCHEMA_VERSION,
    installed: {
      channel: "stable",
      publicationState: BUNDLED_BUILDER_PUBLICATION_STATE,
      releaseSequence: null,
      releaseVersion: BUNDLED_BUILDER_VERSION,
      standards: {
        skill: BUNDLED_BUILDER_VERSION,
        engine: BUNDLED_BUILDER_VERSION,
        policy: PROGRAMMABLE_FEE_POLICY_VERSION,
        schema: STANDARD_VERSION,
        submission: STANDARD_VERSION
      }
    },
    trust: {
      status: "NOT_PROVIDED",
      keyId: null,
      pinSha256: null,
      note: "No installed-state override was supplied; this reports bundled code constants and establishes no update trust."
    },
    versionSource: "bundled-code-constants",
    publicationStateVerified: false,
    installedStateOverrideUsed: false,
    historicalStandardsPreserved: true,
    networkAccessed: false,
    externalActionsPerformed: []
  };
}

export function renderHumanStatus(result) {
  assertPlainObject(result, "lifecycle result");
  if (result.kind === "builder-version-status") {
    return [
      `Builder ${result.installed.releaseVersion} (${result.installed.channel}; ${result.installed.publicationState})`,
      `Standard: ${result.installed.standards.submission}`,
      "State: local version record only; no network access or publication verification."
    ].join("\n");
  }
  if (result.kind === "builder-update-check") {
    const lines = [
      `Update: ${result.status}`,
      `Installed ${result.installed.releaseVersion} -> candidate ${result.candidate.releaseVersion}`,
      result.blocker === null ? `Next: ${result.nextAction}` : `Blocked: ${result.blocker}`,
      "No update was downloaded, activated, or published."
    ];
    lines.splice(
      2,
      0,
      result.verification.fixtureOnly
        ? "Trust: TEST FIXTURE ONLY; no production trust is established."
        : "Trust: signature matches the supplied installed pin; production-root provenance remains external."
    );
    return lines.join("\n");
  }
  if (result.kind === "builder-migration-dry-run") {
    const blocker = result.status === "blocked-ambiguous"
      ? `Blocked: ${result.ambiguity.unexplainedPaths.length} unexplained, ${result.ambiguity.duplicateReasonPaths.length} duplicate, ${result.ambiguity.staleReasonPaths.length} stale reason paths.`
      : `${result.confirmations.length} explicit confirmation(s) required.`;
    return [
      `Migration dry-run: ${result.source.standardVersion} -> ${result.target.standardVersion}`,
      `Diff: ${result.changes.length} field change(s). ${blocker}`,
      `Next: ${result.nextAction}`,
      "No file was changed. Historical standards remain preserved."
    ].join("\n");
  }
  if (result.kind === "caller-declared-local-release-plan") {
    const state = result.callerDeclaredPlanComplete ? "caller-declared inputs complete" : "caller-declared inputs incomplete";
    return [
      `Local release calculation ${result.candidate.releaseVersion} (${result.candidate.channel}): ${state}`,
      "Proof: privacy, cadence, planned source identity, artifact and release-manifest bytes, owner authority, and release readiness are all unverified.",
      result.declaredPlanningBlockers.length === 0
        ? "Caller-declared blockers: none. External W5 verification remains mandatory."
        : `Caller-declared blockers: ${result.declaredPlanningBlockers.join(" | ")}`,
      `Next: ${result.nextAction}`,
      "This command performed no publication and authorized no release."
    ].join("\n");
  }
  throw new BuilderLifecycleError("HUMAN_RENDER_UNSUPPORTED", "unsupported lifecycle result kind");
}
