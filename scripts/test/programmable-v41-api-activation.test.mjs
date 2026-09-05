import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validCleanRoomTranscriptV41 } from "./fixtures/programmable-launch-v41-clean-room.mjs";
import { buildCleanRoomEvidence, buildCleanRoomRecoveryReceipt, canonicalJsonBytes } from "../programmable-launch-v41-clean-room.mjs";
import { assertActivationJsonEqual, assertProducerMetadata, assertVerifiedAttestation, createActivationRecord } from "../programmable-v41-api-activation.mjs";
import { ACTIVATION_SCHEMA, CLEAN_ROOM_WORKFLOW, REPOSITORY, bytesDigest, projectV4ApiActivation } from "../../lib/custom-launch/v41-api-activation.mjs";
import { parseStrictJson } from "../../packages/launch/src/canonical-json.mjs";

const coordinateTemplate = JSON.parse(readFileSync(new URL("../../docs/operations/releases/custom-launch-v4/clean-room-release-coordinate.json", import.meta.url), "utf8")
  .replaceAll("4.0.0", "4.1.0").replaceAll("custom-launch-v4/", "custom-launch-v4.1/")
  .replace("programmable.launch-v4-clean-room-release-coordinate.v1", "programmable.launch-v4-clean-room-release-coordinate.v2")
  .replace("programmable.launch-cli-v4-release-binding.v1", "programmable.launch-cli-v4-release-binding.v2"));
const digest = letter => `sha256:${letter.repeat(64)}`;

function fixture() {
  const input = validCleanRoomTranscriptV41();
  const capabilities = input.remote.capabilities;
  const binding = { schemaVersion: "programmable.launch-cli-v4-release-binding.v2", releaseReady: true, blockers: [], chain: {
    chainId: "4663", caip2: "eip155:4663", chainDeploymentId: capabilities.chainDeployment.chainDeploymentId,
    chainDeploymentDescriptorDigest: capabilities.chainDeploymentDescriptorDigest,
  }, releaseIdentity: { profile: capabilities.profile, package: { version: "4.1.0" } }, evidence: { chainDeployment: { descriptor: capabilities.chainDeployment } } };
  const bindingBytes = canonicalJsonBytes(binding);
  const coordinate = structuredClone(coordinateTemplate);
  Object.assign(coordinate, { releaseReady: true, blockers: [], source: input.prepared.release.source,
    manifestSha256: input.prepared.release.assets.find(a => a.name.endsWith(".release.json")).sha256,
    assets: input.prepared.release.assets.map(({ name, sha256 }) => ({ name, sha256 })),
  });
  coordinate.releaseBinding.sha256 = coordinate.machineContractBinding.sha256 = bytesDigest(bindingBytes);
  const coordinateBytes = canonicalJsonBytes(coordinate);
  input.prepared.release.machineContractBinding.sha256 = bytesDigest(bindingBytes);
  input.prepared.release.reviewedCoordinate.sha256 = bytesDigest(coordinateBytes);
  input.recovery = buildCleanRoomRecoveryReceipt(input);
  const evidence = buildCleanRoomEvidence(input);
  const evidenceBytes = canonicalJsonBytes(evidence);
  const bundleBytes = Buffer.from('{"testFixtureOnly":true}\n');
  const artifactRef = { id: "456789", digest: digest("a") };
  const record = createActivationRecord(bindingBytes, coordinateBytes, evidenceBytes, bundleBytes, artifactRef);
  return { binding, bindingBytes, coordinate, coordinateBytes, evidence, evidenceBytes, bundleBytes, artifactRef, record };
}

test("activation comparisons accept strict-parser JSON and still reject changed proof and asset values", () => {
  const f = fixture();
  const parsed = parseStrictJson(canonicalJsonBytes(f.record).toString("utf8"));
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.doesNotThrow(() => assertActivationJsonEqual(parsed, f.record));
  const assets = parseStrictJson(f.coordinateBytes.toString("utf8")).assets;
  assert.doesNotThrow(() => assertActivationJsonEqual(f.coordinate.assets, assets));
  const changedRecord = structuredClone(parsed);
  changedRecord.proof.cleanRoom.evidence.producer.sourceSha = "f".repeat(40);
  assert.throws(() => assertActivationJsonEqual(changedRecord, f.record));
  const changedAssets = structuredClone(assets);
  changedAssets[0].sha256 = digest("f");
  assert.throws(() => assertActivationJsonEqual(f.coordinate.assets, changedAssets));
});

test("public API discovery is blocked without attested clean-room activation even when release prerequisites are ready", () => {
  const { binding, coordinate } = fixture();
  const result = projectV4ApiActivation({ schemaVersion: ACTIVATION_SCHEMA, scope: "api-until-wallet", proof: null }, binding, coordinate);
  assert.equal(result.publicAuthorization, false);
  assert.equal(result.publicWrites, false);
  assert.equal(result.releaseReady, false);
  assert.equal(result.cliRelease, null);
  assert.equal(result.deployment, null);
  assert.deepEqual(result.activationBlockers, ["clean-room-end-to-end-proof"]);
});

test("complete bound evidence projects both public gates and immutable CLI coordinates while preserving the wallet and indexing boundary", () => {
  const { record, binding, coordinate } = fixture();
  const result = projectV4ApiActivation(record, binding, coordinate);
  assert.equal(result.releaseReady, true);
  assert.equal(result.publicAuthorization, true);
  assert.equal(result.publicWrites, true);
  assert.equal(result.activationScope, "api-until-wallet");
  assert.deepEqual(result.activationBlockers, []);
  assert.deepEqual(result.cliRelease.assets, coordinate.assets);
  assert.deepEqual(result.cliRelease.source, coordinate.source);
  assert.equal(result.deployment, binding.evidence.chainDeployment.descriptor);
  assert.deepEqual(result.publication, { indexingStatus: "unproven", canaryStatus: "not-performed", externalIndexingGuaranteed: false });
});

test("stale inputs, forged producer, changed release asset and weakened wallet boundaries cannot promote discovery", () => {
  for (const mutate of [
    f => { f.binding.chain.chainDeploymentId = "changed"; },
    f => { f.coordinate.assets[0].sha256 = digest("f"); },
    f => { f.record.proof.cleanRoom.evidence.producer.sourceSha = "f".repeat(40); },
    f => { f.record.proof.cleanRoom.evidence.producer.actor = "other"; },
    f => { f.record.proof.cleanRoom.evidence.replay.sameRequestDigest = false; },
    f => { f.record.proof.cleanRoom.evidence.safety.walletSignatureObserved = true; },
    f => { f.record.proof.cleanRoom.evidence.walletHandoff.transactionValueWei = "1"; },
    f => { f.record.proof.cleanRoom.sha256 = digest("f"); },
    f => { f.record.proof.cleanRoom.artifact.id = "0"; },
    f => { f.record.scope = "onchain-finalized"; },
    f => { delete f.record.proof.cleanRoom.evidence.feeReview; },
    f => { delete f.record.proof.cleanRoom.evidence.fundingPlan; },
    f => { delete f.record.proof.cleanRoom.evidence.initialBuyReview; },
    f => { f.record.proof.cleanRoom.evidence.walletHandoff.initialBuyReviewDigest = digest("e"); },
    f => { f.record.proof.cleanRoom.evidence.walletHandoff.admissionIssuedAt = "2099-01-01T00:00:00.000Z"; },
    f => { f.record.proof.cleanRoom.evidence.walletHandoff.launchWallet = "0x0000000000000000000000000000000000000000"; },
    f => { f.record.proof.cleanRoom.evidence.initialBuyReview.execution.minimumTokensOut = "0"; },

    f => { f.record.proof.cleanRoom.evidence.feeReview.platformFeeBps = 0; },
    f => { f.record.proof.cleanRoom.evidence.feeReview.platformRecipient = f.record.proof.cleanRoom.evidence.feeReview.creatorFeeRecipient; },
    f => { f.record.proof.cleanRoom.evidence.walletHandoff.graphSha256 = digest("f"); },
    f => { f.record.proof.cleanRoom.evidence.schemaVersion = "programmable.launch-v4-clean-room-evidence.v1"; },
  ]) {
    const f = fixture(); f.record = structuredClone(f.record); mutate(f);
    if (f.record.proof.cleanRoom.sha256 !== digest("f")) {
      f.record.proof.cleanRoom.sha256 = bytesDigest(canonicalJsonBytes(f.record.proof.cleanRoom.evidence));
    }
    const result = projectV4ApiActivation(f.record, f.binding, f.coordinate);
    assert.equal(result.publicWrites, false);
    assert.equal(result.cliRelease, null);
    assert.ok(result.activationBlockers.includes("activation-proof-invalid"));
  }
  const f = fixture();
  assert.throws(() => createActivationRecord(f.bindingBytes, f.coordinateBytes, Buffer.from(JSON.stringify(f.evidence)), f.bundleBytes, f.artifactRef), /canonical/);
});

function producerMetadata(f) {
  const producer = f.evidence.producer;
  const actor = { login: "hazarxyz", id: 258789013 };
  return { run: {
    id: Number(producer.runId), run_attempt: 1, event: "workflow_dispatch", head_branch: "production", head_sha: producer.sourceSha,
    status: "completed", conclusion: "success", path: CLEAN_ROOM_WORKFLOW,
    repository: { full_name: REPOSITORY, id: 1314365508 }, head_commit: { id: producer.sourceSha }, actor, triggering_actor: actor,
  }, artifact: {
    id: Number(f.artifactRef.id), digest: f.artifactRef.digest, name: `programmable-launch-v41-clean-room-evidence-attestation-${producer.runId}-1`, expired: false,
    expires_at: new Date(Date.now() + 86400000).toISOString(), workflow_run: { id: Number(producer.runId), head_sha: producer.sourceSha, head_branch: "production", repository_id: 1314365508, head_repository_id: 1314365508 },
  } };
}

test("activation import requires exact successful owner-run artifact provenance", () => {
  const f = fixture();
  const good = producerMetadata(f);
  assert.doesNotThrow(() => assertProducerMetadata(good.run, good.artifact, f.evidence, f.artifactRef));
  for (const mutate of [
    m => { m.run.conclusion = "failure"; },
    m => { m.run.event = "pull_request"; },
    m => { m.run.run_attempt = 2; },
    m => { m.run.repository.id++; },
    m => { m.run.head_sha = "a".repeat(40); },
    m => { m.run.actor = { login: "other", id: 1 }; },
    m => { m.artifact.digest = digest("b"); },
    m => { m.artifact.name = "programmable-launch-v4-clean-room-recovery"; },
    m => { m.artifact.workflow_run.id++; },
    m => { m.artifact.workflow_run.head_repository_id++; },
  ]) {
    const m = structuredClone(good); mutate(m);
    assert.throws(() => assertProducerMetadata(m.run, m.artifact, f.evidence, f.artifactRef));
  }
});

function attestationResult(f) {
  const producer = f.evidence.producer;
  const uri = `https://github.com/${REPOSITORY}`;
  const workflowUri = `${uri}/${CLEAN_ROOM_WORKFLOW}@refs/heads/production`;
  return [{ verificationResult: { signature: { certificate: {
    issuer: "https://token.actions.githubusercontent.com", githubWorkflowTrigger: "workflow_dispatch",
    githubWorkflowSHA: producer.sourceSha, githubWorkflowRepository: REPOSITORY, githubWorkflowRef: "refs/heads/production",
    runnerEnvironment: "github-hosted", sourceRepositoryURI: uri, sourceRepositoryDigest: producer.sourceSha,
    sourceRepositoryRef: "refs/heads/production", sourceRepositoryIdentifier: "1314365508", buildConfigURI: workflowUri,
    buildConfigDigest: producer.sourceSha, buildSignerURI: workflowUri, buildSignerDigest: producer.sourceSha,
    buildTrigger: "workflow_dispatch", runInvocationURI: `${uri}/actions/runs/${producer.runId}/attempts/1`, subjectAlternativeName: workflowUri,
  } }, statement: { predicateType: "https://slsa.dev/provenance/v1", subject: [{ digest: { sha256: bytesDigest(f.evidenceBytes).slice(7) } }] } } }];
}

test("verified attestation must bind the exact success bytes, workflow, protected ref, source and hosted execution", () => {
  const f = fixture(); const good = attestationResult(f);
  assert.doesNotThrow(() => assertVerifiedAttestation(good, f.evidenceBytes, f.evidence.producer));
  for (const field of Object.keys(good[0].verificationResult.signature.certificate)) {
    const bad = structuredClone(good); bad[0].verificationResult.signature.certificate[field] = "untrusted";
    assert.throws(() => assertVerifiedAttestation(bad, f.evidenceBytes, f.evidence.producer), field);
  }
  assert.throws(() => assertVerifiedAttestation([...good, ...good], f.evidenceBytes, f.evidence.producer));
  assert.throws(() => assertVerifiedAttestation(good, Buffer.concat([f.evidenceBytes, Buffer.from(" ")]), f.evidence.producer));
  const noStatement = structuredClone(good); delete noStatement[0].verificationResult.statement;
  assert.throws(() => assertVerifiedAttestation(noStatement, f.evidenceBytes, f.evidence.producer));
});
