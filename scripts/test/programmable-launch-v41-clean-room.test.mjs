import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  buildCleanRoomEvidence, buildCleanRoomRecoveryReceipt, canonicalJsonBytes,
  validateCleanRoomEvidence, validateCleanRoomRecoveryReceipt, verifyEvidenceFile,
} from "../programmable-launch-v41-clean-room.mjs";
import { buildCleanRoomEvidence as buildLegacyEvidence,
  buildCleanRoomRecoveryReceipt as buildLegacyRecovery } from "../programmable-launch-v4-clean-room.mjs";
import { validCleanRoomTranscript } from "./fixtures/programmable-launch-v4-clean-room.mjs";
import { validCleanRoomTranscriptV41, framedDigest } from "./fixtures/programmable-launch-v41-clean-room.mjs";

function transcript() {
  const input = validCleanRoomTranscriptV41();
  input.recovery = buildCleanRoomRecoveryReceipt(input);
  return input;
}

test("4.1 evidence binds actual request funding and server-reviewed native fee proof without claiming a broadcast", () => {
  const input = transcript();
  const evidence = buildCleanRoomEvidence(input);
  assert.equal(validateCleanRoomEvidence(evidence), evidence);
  assert.equal(validateCleanRoomRecoveryReceipt(input.recovery), input.recovery);
  assert.deepEqual(evidence.fundingPlan, input.request.fundingPlan);
  assert.deepEqual(evidence.feeReview, input.status.resource.feeReview);
  assert.deepEqual(evidence.initialBuyReview, input.status.resource.initialBuyReview);
  assert.equal(evidence.walletHandoff.initialBuyReviewDigest, input.status.resource.admissionReceipt.initialBuyReviewDigest);
  assert.equal(evidence.walletHandoff.admissionIssuedAt, input.status.resource.admissionReceipt.issuedAt);
  assert.equal(evidence.walletHandoff.launchWallet, input.request.launchWallet);
  assert.equal(evidence.initialBuyReview.assessmentTime, "permit-authorization");
  assert.equal(evidence.walletHandoff.feeReviewDigest, input.status.resource.admissionReceipt.feeReviewDigest);
  assert.equal(evidence.walletHandoff.launchIntentHash, input.request.launchIntentHash);
  assert.equal(evidence.feeReview.platformFeeBps, 20);
  assert.equal(evidence.walletHandoff.transactionValueWei, input.request.fundingPlan.nativeAllocations.initialBuyWei);
  assert.notEqual(evidence.walletHandoff.transactionValueWei, "0");
  assert.equal(evidence.feeReview.childRuntimeObservation, "required-after-deployment");
  assert.equal(evidence.feeReview.safetyClaim, false);
  assert.equal(Object.values(evidence.safety).every((entry) => entry === false), true);
  const serialized = canonicalJsonBytes(evidence).toString("utf8");
  for (const forbidden of [input.apiKey, input.firstSubmit.idempotencyKey,
    input.status.resource.walletTransaction.calldata, input.firstSubmit.journalPath]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("4.0 and 4.1 evidence cannot be relabeled across immutable release contracts", () => {
  const old = validCleanRoomTranscript();
  old.recovery = buildLegacyRecovery(old);
  const legacyEvidence = buildLegacyEvidence(old);
  assert.throws(() => validateCleanRoomEvidence(legacyEvidence));
  assert.throws(() => buildCleanRoomEvidence(old));
  assert.throws(() => buildLegacyEvidence(transcript()));
  const successor = transcript();
  successor.prepared.release.version = "4.0.0";
  assert.throws(() => buildCleanRoomEvidence(successor), /PREPARED_RELEASE_IDENTITY_INVALID/u);
});

test("4.1 handoff rejects absent, changed, cross-resource or falsely favorable fee and funding evidence", () => {
  const mutations = [
    value => { delete value.status.resource.initialBuyReview; },
    value => { value.status.resource.admissionReceipt.initialBuyReviewDigest = null; },
    value => { value.status.resource.initialBuyReview.execution.initialBuyWei = "1"; },
    value => { value.status.resource.initialBuyReview.execution.buyer = "0x1111111111111111111111111111111111111111"; },
    value => { value.status.resource.initialBuyReview.execution.minimumTokensOut = "0"; },
    value => { value.status.resource.initialBuyReview.quote.minimumInitialBuyWei = "1"; },
    value => { value.status.resource.initialBuyReview.quote.referenceChainId = "4663"; },
    value => { value.status.resource.admissionReceipt.issuedAt = "2026-09-05T12:01:00.000Z"; },
    value => { value.status.resource.preparedArtifact.route.targets.find(({ targetId }) => targetId === "initializer").initializerValueWei = "0"; },
    value => { delete value.status.resource.feeReview; },
    value => { value.status.resource.admissionReceipt.feeReviewDigest = null; },
    value => { value.status.resource.feeReview.platformFeeBps = 0; },
    value => { value.status.resource.feeReview.safetyClaim = true; },
    value => { value.status.resource.feeReview.childRuntimeObservation = "verified"; },
    value => { value.status.resource.feeReview.verificationBundleSha256 = `sha256:${"f".repeat(64)}`; },
    value => { value.status.resource.feeReview.vaultAddress = value.status.resource.feeReview.kernelAddress; },
    value => { value.status.resource.preparedArtifact = null; },
    value => { value.status.resource.preparedArtifact.route.targets.find(({ targetId }) => targetId === "hook").predictedAddress = "0x1111111111111111111111111111111111111111"; },
    value => { delete value.request.fundingPlan; },
    value => { value.request.fundingPlan.maxGasCostWei = "0"; },
    value => { value.request.fundingPlan.launchMode = "build-only"; },
    value => { value.status.resource.fundingPlan.maxGasCostWei = "2000000000000000"; },
    value => { value.status.resource.fundingPlan.nativeAllocations.initialLiquidityWei = "1"; },
    value => { value.request.launchIntentHash = `sha256:${"f".repeat(64)}`; },
    value => { value.status.resource.walletTransaction.commitments.launchIntent = `sha256:${"f".repeat(64)}`; },
    value => { value.remote.preflight.launchEligibility.routable = true; },
    value => { value.request.liquidityModel.model = "none-empty-pool"; },
    value => { value.producer.workflowPath = ".github/workflows/programmable-launch-v4-clean-room.yml"; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const input = transcript();
    mutate(input);
    assert.throws(() => buildCleanRoomEvidence(input), undefined, `mutation ${index} escaped`);
  }
});

test("standalone evidence revalidation retains fee integrity, closed funding fields and no-broadcast limits", () => {
  const evidence = buildCleanRoomEvidence(transcript());
  const mutations = [
    value => { delete value.initialBuyReview; },
    value => { value.walletHandoff.initialBuyReviewDigest = `sha256:${"f".repeat(64)}`; },
    value => { value.walletHandoff.admissionIssuedAt = "2026-09-05T12:01:00.000Z"; },
    value => { value.observedAt = "2026-09-05T11:59:00.000Z"; },
    value => { value.walletHandoff.launchWallet = "0x1111111111111111111111111111111111111111"; },
    value => { value.initialBuyReview.quote.answer = "1"; },
    value => { value.initialBuyReview.execution.nativeSeedWei = "1"; },
    value => { value.feeReview.platformRecipient = "0x1111111111111111111111111111111111111111"; },
    value => { value.feeReview.platformFeeBps = 10; },
    value => { value.walletHandoff.feeReviewDigest = `sha256:${"f".repeat(64)}`; },
    value => { value.walletHandoff.graphSha256 = `sha256:${"f".repeat(64)}`; },
    value => { value.fundingPlan.secret = "unexpected"; },
    value => { value.walletHandoff.profileDigest = `sha256:${"f".repeat(64)}`; },
    value => { value.walletHandoff.transactionValueWei = "0"; },
    value => { value.fundingPlan.nativeAllocations.initialBuyWei = "0"; },
    value => { value.safety.transactionBroadcastObserved = true; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(evidence);
    mutate(changed);
    const unsigned = { ...changed };
    delete unsigned.evidenceDigest;
    changed.evidenceDigest = framedDigest(changed.schemaVersion, unsigned);
    assert.throws(() => validateCleanRoomEvidence(changed));
  }
});

test("canonical 4.1 evidence file is reverified and noncanonical encoding rejected", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "native20-clean-room-integrity-"));
  try {
    const file = path.join(dir, "evidence.json");
    const evidence = buildCleanRoomEvidence(transcript());
    await writeFile(file, canonicalJsonBytes(evidence));
    assert.deepEqual(canonicalJsonBytes(await verifyEvidenceFile(file)), canonicalJsonBytes(evidence));
    await writeFile(file, JSON.stringify(evidence, null, 2));
    await assert.rejects(verifyEvidenceFile(file), /EVIDENCE_FILE_NOT_CANONICAL/u);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
