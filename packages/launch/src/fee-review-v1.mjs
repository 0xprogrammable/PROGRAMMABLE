import { getAddress, getContractAddress, keccak256 } from "viem";
import { canonicalizeJson } from "./canonical-json.mjs";
import { assertExactKeys, sha256Digest } from "./io.mjs";
import { ROBINHOOD_NATIVE_FEE_ARTIFACT_SHA256_V1, ROBINHOOD_NATIVE_FEE_KERNEL_CREATION_BYTES_V1, ROBINHOOD_NATIVE_FEE_KERNEL_CREATION_KECCAK_V1 } from "./fee-policy-v1.mjs";

const sha = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const hex = { type: "string", pattern: "^0x[0-9a-f]{64}$" };
const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/+\\-]{0,255}$" };
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const closed = (properties) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const ROBINHOOD_FEE_REVIEW_SCHEMA_V1 = closed({
  schemaVersion: { const: "programmable.robinhood-native-fee-kernel-proof.v1" },
  artifactReleaseSha256: { const: ROBINHOOD_NATIVE_FEE_ARTIFACT_SHA256_V1 },
  graphSha256: sha, verificationBundleSha256: sha, preparedArtifactHash: sha,
  kernelTargetId: id, kernelAddress: address, kernelRuntimeCodeHash: hex,
  vaultAddress: address, vaultRuntimeCodeHash: hex,
  moduleTargetId: { anyOf: [id, { type: "null" }] }, moduleRuntimeCodeHash: hex,
  platformFeeBps: { const: 20 }, denominator: { const: 10000 },
  feeCurrency: { const: "native-ETH" },
  platformRecipient: { const: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da" },
  assessmentBase: { const: "gross-native-leg-once-per-successful-swap" },
  rounding: { const: "ceil-per-trade" },
  poolKey: closed({ currency0: address, currency1: address, fee: integer(0, 16777215),
    tickSpacing: integer(-8388608, 8388607), hooks: address }),
  feeAccrual: { const: "pool-manager-native-claims" },
  platformClaim: { const: "permissionless-fixed-recipient" }, creatorFeeRecipient: address,
  lpFeeMode: { enum: ["static", "dynamic"] }, lpFeePips: integer(0, 16777215),
  creatorBuyFeeBps: integer(0, 9979), creatorSellFeeBps: integer(0, 9979),
  maxModuleLpFeePips: integer(0, 1000000),
  customSettlementDeltas: { const: "unsupported" },
  childRuntimeObservation: { const: "required-after-deployment" }, safetyClaim: { const: false },
  evidenceDigest: sha,
});

/** Validate server-issued proof bindings, not a fresh onchain state or a safety guarantee. */
export function assertRobinhoodFeeReviewV1(proof, resource) {
  validateEvidenceShapeV41(proof, ROBINHOOD_FEE_REVIEW_SCHEMA_V1, "feeReview");
  const { evidenceDigest, ...unsigned } = proof;
  const digest = sha256Digest(Buffer.concat([Buffer.from(proof.schemaVersion), Buffer.from([0]),
    Buffer.from(canonicalizeJson(unsigned))]));
  if (digest !== evidenceDigest || resource.admissionReceipt?.feeReviewDigest !== digest
    || proof.verificationBundleSha256 !== resource.commitments.verification
    || proof.vaultAddress !== getContractAddress({ from: proof.kernelAddress, opcode: "CREATE", nonce: 1n })
    || proof.poolKey.currency0 !== "0x0000000000000000000000000000000000000000"
    || proof.poolKey.hooks !== proof.kernelAddress || proof.poolKey.fee !== proof.lpFeePips
    || proof.lpFeeMode !== (proof.lpFeePips === 0x800000 ? "dynamic" : "static")
    || (proof.moduleTargetId === null && proof.moduleRuntimeCodeHash !== `0x${"00".repeat(32)}`)) {
    throw new TypeError("feeReview is not bound to the exact resource and native fee kernel");
  }
  const artifact = resource.preparedArtifact;
  if (artifact != null) {
    const target = artifact.route.targets.find(({ targetId }) => targetId === proof.kernelTargetId);
    if (proof.preparedArtifactHash !== artifact.artifactHash
      || proof.graphSha256 !== (artifact.unboundGraphBundleHash ?? artifact.graphBundleHash)
      || target?.predictedAddress !== proof.kernelAddress
      || target?.expectedRuntimeCodeHash !== proof.kernelRuntimeCodeHash
      || keccak256(target.initCode.slice(0, 2 + ROBINHOOD_NATIVE_FEE_KERNEL_CREATION_BYTES_V1 * 2)) !== ROBINHOOD_NATIVE_FEE_KERNEL_CREATION_KECCAK_V1
      || canonicalizeJson(proof.poolKey) !== canonicalizeJson(artifact.stampRequest.poolKey)) {
      throw new TypeError("feeReview prepared artifact or kernel binding differs");
    }
  }
  return proof;
}

export function validateEvidenceShapeV41(value, schema, label) {
  if (schema.anyOf) {
    if (value === null && schema.anyOf.some((entry) => entry.type === "null")) return;
    return validateEvidenceShapeV41(value, schema.anyOf[0], label);
  }
  if (Object.hasOwn(schema, "const")) {
    if (canonicalizeJson(value) !== canonicalizeJson(schema.const)) throw new TypeError(`${label} differs from the reviewed fee policy`);
  } else if (schema.enum) {
    if (!schema.enum.includes(value)) throw new TypeError(`${label} is unsupported`);
  } else if (schema.type === "object") {
    assertExactKeys(value, schema.required, label);
    for (const [key, child] of Object.entries(schema.properties)) validateEvidenceShapeV41(value[key], child, `${label}.${key}`);
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(value) || value < schema.minimum || value > schema.maximum) throw new TypeError(`${label} is out of bounds`);
  } else if (schema.type === "string") {
    if (typeof value !== "string" || !new RegExp(schema.pattern, "u").test(value)) throw new TypeError(`${label} is invalid`);
    if (schema === address && getAddress(value) !== value) throw new TypeError(`${label} must be checksummed`);
  }
}
