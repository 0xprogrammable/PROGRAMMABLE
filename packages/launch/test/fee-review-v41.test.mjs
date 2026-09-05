import assert from "node:assert/strict";
import test from "node:test";
import { getContractAddress } from "viem";
import { assertRobinhoodFeeReviewV1, ROBINHOOD_FEE_REVIEW_SCHEMA_V1 } from "../src/fee-review-v1.mjs";
import { canonicalizeJson } from "../src/canonical-json.mjs";
import { sha256Digest } from "../src/io.mjs";
import { ROBINHOOD_NATIVE_FEE_ARTIFACT_SHA256_V1 } from "../src/robinhood-native-fee-v1.mjs";

const hash = `sha256:${"11".repeat(32)}`;
const hex = `0x${"22".repeat(32)}`;
const kernel = "0x1111111111111111111111111111111111111111";
function evidence() {
  const proof = Object.fromEntries(Object.entries(ROBINHOOD_FEE_REVIEW_SCHEMA_V1.properties).map(([key, schema]) =>
    [key, Object.hasOwn(schema, "const") ? schema.const : null]));
  Object.assign(proof, { artifactReleaseSha256: ROBINHOOD_NATIVE_FEE_ARTIFACT_SHA256_V1,
    graphSha256: hash, verificationBundleSha256: hash, preparedArtifactHash: hash, kernelTargetId: "hook",
    kernelAddress: kernel, kernelRuntimeCodeHash: hex,
    vaultAddress: getContractAddress({ from: kernel, opcode: "CREATE", nonce: 1n }), vaultRuntimeCodeHash: hex,
    moduleTargetId: null, moduleRuntimeCodeHash: `0x${"00".repeat(32)}`,
    poolKey: { currency0: "0x0000000000000000000000000000000000000000", currency1: "0x2222222222222222222222222222222222222222", fee: 0, tickSpacing: 60, hooks: kernel },
    creatorFeeRecipient: kernel, lpFeeMode: "static", lpFeePips: 0, creatorBuyFeeBps: 0, creatorSellFeeBps: 0,
    maxModuleLpFeePips: 0 });
  const { evidenceDigest, ...unsigned } = proof;
  proof.evidenceDigest = sha256Digest(Buffer.concat([Buffer.from(proof.schemaVersion), Buffer.from([0]), Buffer.from(canonicalizeJson(unsigned))]));
  return { proof, resource: { commitments: { verification: hash }, preparedArtifact: null,
    admissionReceipt: { feeReviewDigest: proof.evidenceDigest } } };
}

test("4.1 fee proof binds fixed native economics and its canonical evidence digest", () => {
  const { proof, resource } = evidence();
  assert.equal(assertRobinhoodFeeReviewV1(proof, resource), proof);
  for (const edit of [
    p => { p.platformFeeBps = 21; }, p => { p.platformRecipient = kernel; },
    p => { p.safetyClaim = true; }, p => { p.vaultAddress = kernel; },
    p => { p.creatorBuyFeeBps = 9980; }, p => { p.evidenceDigest = hash; },
    p => { p.rounding = "floor"; }, p => { p.extra = false; },
  ]) { const changed = structuredClone(proof); edit(changed); assert.throws(() => assertRobinhoodFeeReviewV1(changed, resource)); }
  assert.throws(() => assertRobinhoodFeeReviewV1(proof, { ...resource, commitments: { verification: `sha256:${"33".repeat(32)}` } }));
});
