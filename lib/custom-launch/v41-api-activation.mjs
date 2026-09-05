import { createApiActivationTools } from "./v4-api-activation.mjs";
import { assertRobinhoodFeeReviewV1 } from "../../packages/launch/src/fee-review-v1.mjs";
import { normalizeRobinhoodFundingPlanV1 } from "../../packages/launch/src/funding-plan-v1.mjs";
import { assertRobinhoodInitialBuyReviewV1 } from "../../packages/launch/src/initial-buy-review-v1.mjs";
import { ROBINHOOD_PROFILE_V41 } from "../../packages/launch/src/profile-v41.mjs";
import { canonicalizeJson } from "../../packages/launch/src/canonical-json.mjs";

function validateNativeEvidence(evidence, binding) {
  const handoff = evidence.walletHandoff;
  const sha = /^sha256:[0-9a-f]{64}$/u;
  if (canonicalizeJson(binding.releaseIdentity.profile) !== canonicalizeJson(ROBINHOOD_PROFILE_V41)
    || binding.releaseIdentity.package.version !== "4.1.0"
    || binding.schemaVersion !== "programmable.launch-cli-v4-release-binding.v2"
    || [handoff.preparedArtifactHash, handoff.graphSha256, handoff.verificationBundleSha256,
      handoff.launchIntentHash, handoff.admissionReceiptDigest, handoff.feeReviewDigest, handoff.initialBuyReviewDigest]
      .some((digest) => !sha.test(digest ?? ""))) {
    throw new Error("V4.1 activation requires the exact successor profile and admission bindings");
  }
  const proof = assertRobinhoodFeeReviewV1(evidence.feeReview, {
    admissionReceipt: { feeReviewDigest: handoff.feeReviewDigest },
    commitments: { verification: handoff.verificationBundleSha256 }, preparedArtifact: null,
  });
  if (proof.preparedArtifactHash !== handoff.preparedArtifactHash || proof.graphSha256 !== handoff.graphSha256) {
    throw new Error("V4.1 activation fee review differs from the admitted handoff");
  }
  const plan = normalizeRobinhoodFundingPlanV1(evidence.fundingPlan, { valueWei: handoff.transactionValueWei });
  if (plan.launchMode !== "fund-and-launch") {
    throw new Error("V4.1 activation requires an executable funding plan");
  }
  assertRobinhoodInitialBuyReviewV1(evidence.initialBuyReview, {
    feeReview: proof, fundingPlan: plan, funding: { valueWei: handoff.transactionValueWei },
    controller: { address: handoff.launchWallet },
    admissionReceipt: { initialBuyReviewDigest: handoff.initialBuyReviewDigest, issuedAt: handoff.admissionIssuedAt },
    commitments: { verification: handoff.verificationBundleSha256 }, preparedArtifact: null,
  });
}

export const {
  ACTIVATION_SCHEMA, ACTIVATION_PATH, SUCCESS_EVIDENCE_PATH, SUCCESS_ATTESTATION_PATH,
  CLEAN_ROOM_WORKFLOW, REPOSITORY, PUBLICATION, jsonDigest, bytesDigest,
  assertActivationRecord, projectV4ApiActivation,
} = createApiActivationTools({
  version: "4.1.0",
  schema: "programmable.robinhood-v4-api-activation.v2",
  path: "docs/operations/releases/custom-launch-v4.1/api-activation.json",
  evidencePath: "release/robinhood-chain-4663/v4.1/programmable-launch-v41-clean-room-evidence.json",
  attestationPath: "release/robinhood-chain-4663/v4.1/programmable-launch-v41-clean-room-evidence.attestation.json",
  workflow: ".github/workflows/programmable-launch-v41-clean-room.yml",
  evidenceSchema: "programmable.launch-v4-clean-room-evidence.v2",
  validateNativeEvidence,
});
