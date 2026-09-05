import { spawnSync } from "node:child_process";
import { canonicalizeJson } from "../../packages/launch/src/canonical-json.mjs";
import * as releaseTools from "../../scripts/programmable-launch-v41-release-binding.mjs";

// This context is for backend identity comparison only. It is never substituted
// for the signed Phase A stage bytes or its deployment/source attestations.
export function robinhoodV41BackendStageContext({ repositoryRoot, stageBundle }) {
  const candidate = releaseTools.createV4ReleaseCandidate({ repositoryRoot });
  return {
    ...stageBundle,
    artifacts: {
      ...stageBundle.artifacts,
      cliReleaseBinding: { ...stageBundle.artifacts.cliReleaseBinding, value: candidate },
    },
  };
}

export function prepareRobinhoodV41ReleaseBinding({
  repositoryRoot, stageBundle, backendAuthorization,
}) {
  const revision = backendAuthorization?.producerRevision;
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/u.test(revision)) {
    throw new TypeError("successor release requires an exact authorization producer revision");
  }
  const result = spawnSync("git", ["-C", repositoryRoot, "show",
    `${revision}:${releaseTools.V4_RELEASE_BINDING_PATH}`], {
    encoding: null, maxBuffer: 16 * 1024 * 1024,
    env: { ...Object.fromEntries(Object.entries(process.env)
      .filter(([key]) => !key.startsWith("GIT_"))), GIT_NO_REPLACE_OBJECTS: "1" },
  });
  if (result.status !== 0) {
    throw new TypeError("successor candidate is missing from the authorization producer commit");
  }
  const audit = releaseTools.auditV4ReleaseBinding({
    repositoryRoot, bindingBytes: result.stdout,
  });
  const candidate = releaseTools.createV4ReleaseCandidate({ repositoryRoot });
  if (canonicalizeJson(audit.binding) !== canonicalizeJson(candidate)) {
    throw new TypeError("authorization producer must bind the exact inactive successor candidate");
  }
  const original = stageBundle.artifacts.cliReleaseBinding.value;
  if (original.releaseIdentity.profile.profileVersion !== "4.0.0"
    || original.releaseReady !== false || original.evidence.backend !== null
    || original.evidence.manifest !== null) {
    throw new TypeError("successor requires the original closed Phase A deployment stage");
  }
  const profile = {
    ...structuredClone(original.evidence.profile),
    profile: structuredClone(candidate.releaseIdentity.profile),
    profileEvidenceDigest: null,
  };
  profile.profileEvidenceDigest = releaseTools.computeV4ProfileEvidenceDigest(profile);
  const binding = {
    ...structuredClone(candidate),
    chain: structuredClone(original.chain),
    evidence: {
      chainDeployment: structuredClone(original.evidence.chainDeployment),
      profile,
      manifest: null,
      source: structuredClone(original.evidence.source),
      finality: structuredClone(original.evidence.finality),
      backend: null,
    },
    blockers: ["releaseManifestEvidence", "backendReleaseEvidence"],
  };
  // Validate the derived profile against the same immutable deployment roots.
  releaseTools.auditV4ReleaseBinding({
    repositoryRoot, bindingBytes: Buffer.from(JSON.stringify(binding)),
  });
  return Object.freeze({ binding, replacesSha256: audit.bindingSha256 });
}

export function robinhoodV41ConsumerInputs(stageInputs, finalBinding) {
  return {
    ...structuredClone(stageInputs),
    cli: {
      ...structuredClone(stageInputs.cli),
      releaseBindingPath: releaseTools.V4_RELEASE_BINDING_PATH,
      profile: structuredClone(finalBinding.releaseIdentity.profile),
    },
  };
}
