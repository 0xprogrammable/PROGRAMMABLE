import { createHash } from "node:crypto";
import { canonicalizeJson } from "../../packages/launch/src/canonical-json.mjs";

// Legacy defaults remain frozen; only the explicit successor wrapper supplies new proof rules.
export function createApiActivationTools(successor = null) {
  if (successor !== null && (successor.version !== "4.1.0" || typeof successor.validateNativeEvidence !== "function")) {
    throw new Error("Unsupported activation release");
  }
  const version = successor?.version ?? "4.0.0";
  const ACTIVATION_SCHEMA = successor?.schema ?? "programmable.robinhood-v4-api-activation.v1";
  const ACTIVATION_PATH = successor?.path ?? "docs/operations/releases/custom-launch-v4/api-activation.json";
  const SUCCESS_EVIDENCE_PATH = successor?.evidencePath ?? "release/robinhood-chain-4663/programmable-launch-v4-clean-room-evidence.json";
  const SUCCESS_ATTESTATION_PATH = successor?.attestationPath ?? "release/robinhood-chain-4663/programmable-launch-v4-clean-room-evidence.attestation.json";
  const CLEAN_ROOM_WORKFLOW = successor?.workflow ?? ".github/workflows/programmable-launch-v4-clean-room.yml";
  const REPOSITORY = "programmablehq/PROGRAMMABLE";
  const PUBLICATION = Object.freeze({
    indexingStatus: "unproven",
    canaryStatus: "not-performed",
    externalIndexingGuaranteed: false,
  });
  const SHA = /^sha256:[0-9a-f]{64}$/u;
  const HEX40 = /^[0-9a-f]{40}$/u;
  const fail = (condition, message) => { if (!condition) throw new Error(message); };
  const jsonDigest = (value) => `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}`;
  const bytesDigest = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
  const same = (a, b) => canonicalizeJson(a) === canonicalizeJson(b);
  const keys = (value, names) => fail(value && typeof value === "object" && !Array.isArray(value)
    && same(Object.keys(value).sort(), [...names].sort()), "V4 activation object fields differ");

  // Cryptographic authentication happens in the protected import/audit command. The
  // runtime projection additionally closes over the exact semantic inputs bundled
  // by Next, so a stale activation record cannot promote changed release data.
  function assertActivationRecord(record, binding, coordinate) {
    keys(record, ["schemaVersion", "scope", "proof"]);
    fail(record.schemaVersion === ACTIVATION_SCHEMA && record.scope === "api-until-wallet",
      "V4 activation identity differs");
    if (record.proof === null) return false;
    const proof = record.proof;
    keys(proof, ["releaseBinding", "cliCoordinate", "cleanRoom"]);
    for (const [reference, value] of [[proof.releaseBinding, binding], [proof.cliCoordinate, coordinate]]) {
      keys(reference, ["sha256", "jsonSha256"]);
      fail(SHA.test(reference.sha256) && reference.jsonSha256 === jsonDigest(value),
        "V4 activation input digest differs");
    }
    fail(binding.releaseReady === true && same(binding.blockers, [])
      && coordinate.releaseReady === true && same(coordinate.blockers, [])
      && coordinate.repository === REPOSITORY && coordinate.version === version
      && coordinate.tag === `programmable-launch-v${version}`
      && coordinate.releaseBinding.sha256 === proof.releaseBinding.sha256
      && coordinate.machineContractBinding.sha256 === proof.releaseBinding.sha256,
    "V4 activation release prerequisites differ");
    const clean = proof.cleanRoom;
    keys(clean, ["path", "sha256", "attestationPath", "attestationSha256", "artifact", "evidence"]);
    keys(clean.artifact, ["id", "digest"]);
    fail(clean.path === SUCCESS_EVIDENCE_PATH && clean.attestationPath === SUCCESS_ATTESTATION_PATH
      && SHA.test(clean.sha256) && SHA.test(clean.attestationSha256)
      && /^[1-9][0-9]*$/u.test(clean.artifact.id) && SHA.test(clean.artifact.digest),
    "V4 activation success evidence references differ");
    const evidence = clean.evidence;
    fail(clean.sha256 === bytesDigest(Buffer.from(`${canonicalizeJson(evidence)}\n`)),
      "V4 activation embedded evidence bytes differ");
    const producer = evidence?.producer;
    fail(evidence?.schemaVersion === (successor?.evidenceSchema ?? "programmable.launch-v4-clean-room-evidence.v1")
      && producer?.repository === REPOSITORY && producer.repositoryId === "1314365508"
      && producer.workflowPath === CLEAN_ROOM_WORKFLOW
      && producer.workflowRef === `${REPOSITORY}/${CLEAN_ROOM_WORKFLOW}@refs/heads/production`
      && HEX40.test(producer.sourceSha) && producer.workflowSha === producer.sourceSha
      && producer.actor === "hazarxyz" && producer.actorId === "258789013"
      && producer.runAttempt === "1" && /^[1-9][0-9]*$/u.test(producer.runId)
      && producer.environment === "production", "V4 activation producer differs");
    const release = evidence.release;
    fail(release?.repository === coordinate.repository && release.tag === coordinate.tag
      && release.version === coordinate.version && release.sourceCommit === coordinate.source.commitSha
      && release.sourceTree === coordinate.source.treeSha
      && release.reviewedCoordinateSha256 === proof.cliCoordinate.sha256
      && release.machineContractBindingSha256 === proof.releaseBinding.sha256
      && release.attestationsVerified === true
      && release.signerWorkflow === `${REPOSITORY}/.github/workflows/release-programmable-launch.yml`,
    "V4 activation clean-room release differs");
    for (const [field, name] of [
      ["tarballSha256", `programmable-launch-${version}.tgz`],
      ["checksumSha256", `programmable-launch-${version}.tgz.sha256`],
      ["sbomSha256", `programmable-launch-${version}.cdx.json`],
      ["manifestSha256", `programmable-launch-${version}.release.json`],
    ]) fail(SHA.test(release[field]) && release[field] === coordinate.assets.find((asset) => asset.name === name)?.sha256,
      "V4 activation CLI asset differs");
    const handoff = evidence.walletHandoff;
    fail(evidence.request?.chainId === "4663" && evidence.request.caip2 === "eip155:4663"
      && handoff?.status === "wallet_action_required"
      && (successor === null ? handoff.transactionValueWei === "0" : /^(?:0|[1-9][0-9]*)$/u.test(handoff.transactionValueWei))
      && handoff.chainDeploymentId === binding.chain.chainDeploymentId
      && handoff.chainDeploymentDescriptorDigest === binding.chain.chainDeploymentDescriptorDigest
      && handoff.profileDigest === binding.releaseIdentity.profile.profileDigest
      && handoff.transactionTarget.toLowerCase()
        === binding.evidence.chainDeployment.descriptor.contracts.programmableLaunchStampRouter.address.toLowerCase(),
    "V4 activation wallet handoff differs");
    fail(same(evidence.safety, { walletSignatureObserved: false, transactionBroadcastObserved: false,
      onchainEvidenceObserved: false, apiCredentialRecorded: false, rawRequestRecorded: false,
      rawTransactionRecorded: false }) && same(evidence.replay, { identicalIdempotencyKey: true,
      sameLaunchId: true, sameRequestDigest: true }), "V4 activation no-broadcast or replay boundary differs");
    if (successor !== null) successor.validateNativeEvidence(evidence, binding);
    return true;
  }

  function projectV4ApiActivation(record, binding, coordinate) {
    let ready = false;
    let invalid = false;
    try { ready = assertActivationRecord(record, binding, coordinate); } catch { invalid = true; }
    const blockers = ready ? [] : [
      ...(coordinate.releaseReady !== true ? ["public-cli-release"] : []),
      ...(binding.releaseReady !== true ? ["generated-release-evidence"] : []),
      "clean-room-end-to-end-proof",
      ...(invalid ? ["activation-proof-invalid"] : []),
    ];
    return Object.freeze({
      status: ready ? "live" : "release-candidate",
      activationStage: ready ? "public-api-wallet-handoff" : "pending-public-discovery-promotion",
      activationScope: "api-until-wallet",
      publicAuthorization: ready, publicWrites: ready, releaseReady: ready,
      activationBlockers: Object.freeze(blockers), publication: PUBLICATION,
      cliReleased: ready, cliInstallable: ready,
      cliRelease: ready ? { repository: coordinate.repository, tag: coordinate.tag, version: coordinate.version,
        source: coordinate.source, assets: coordinate.assets,
        releaseUrl: `https://github.com/${REPOSITORY}/releases/tag/${coordinate.tag}`,
        tarballUrl: `https://github.com/${REPOSITORY}/releases/download/${coordinate.tag}/programmable-launch-${version}.tgz`,
        checksumUrl: `https://github.com/${REPOSITORY}/releases/download/${coordinate.tag}/programmable-launch-${version}.tgz.sha256`,
      } : null,
      deployment: ready ? binding.evidence.chainDeployment.descriptor : null,
      chainDeploymentDescriptorDigest: ready ? binding.chain.chainDeploymentDescriptorDigest : null,
    });
  }
  return Object.freeze({ ACTIVATION_SCHEMA, ACTIVATION_PATH, SUCCESS_EVIDENCE_PATH, SUCCESS_ATTESTATION_PATH, CLEAN_ROOM_WORKFLOW, REPOSITORY, PUBLICATION, jsonDigest, bytesDigest, assertActivationRecord, projectV4ApiActivation });
}

export const { ACTIVATION_SCHEMA, ACTIVATION_PATH, SUCCESS_EVIDENCE_PATH, SUCCESS_ATTESTATION_PATH, CLEAN_ROOM_WORKFLOW, REPOSITORY, PUBLICATION, jsonDigest, bytesDigest, assertActivationRecord, projectV4ApiActivation } = createApiActivationTools();
