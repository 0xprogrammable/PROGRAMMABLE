import { getAddress, getContractAddress, sha256, stringToHex, type Address, type Hex } from "viem";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";

const SCHEMA = "programmable.robinhood-native-fee-kernel-proof.v1";
const RECEIPT_SCHEMA = "programmable.custom-launch-admission-receipt.v4";
const PROFILE_DIGEST = "sha256:5bd194ce769e825231d94e16c7e874f36935931224bca86a4003a9a3691b87bc";
const ARTIFACT_RELEASE = "sha256:917c03d59c7b6c051d6aa238cd0b2a91aa02c8993ccbfce6421d5c6341d5380e";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_HASH = `0x${"00".repeat(32)}`;
const RECIPIENT = "0xD88539d3c4C460136a733A3Fd60cf6BF269079da";
const KEYS = ["schemaVersion", "artifactReleaseSha256", "graphSha256", "verificationBundleSha256",
  "preparedArtifactHash", "kernelTargetId", "kernelAddress", "kernelRuntimeCodeHash", "vaultAddress",
  "vaultRuntimeCodeHash", "moduleTargetId", "moduleRuntimeCodeHash", "platformFeeBps", "denominator",
  "feeCurrency", "platformRecipient", "assessmentBase", "rounding", "poolKey", "feeAccrual",
  "platformClaim", "creatorFeeRecipient", "lpFeeMode", "lpFeePips", "creatorBuyFeeBps", "creatorSellFeeBps",
  "maxModuleLpFeePips", "customSettlementDeltas", "childRuntimeObservation", "safetyClaim", "evidenceDigest"];
const RECEIPT_KEYS = ["schemaVersion", "apiVersion", "chainId", "requestHash", "rawRequestSha256",
  "chainDeploymentDescriptorDigest", "profileDigest", "commitments", "staticAnalysisDigest",
  "externalContractEvidenceDigest", "disposition", "evidenceTier", "hardBlockFindingCodes",
  "needsEvidenceFindingCodes", "warningFindingCodes", "issuedAt", "feeReviewDigest", "receiptDigest"];

export type RobinhoodFeeReviewV1 = Readonly<{
  evidenceDigest: `sha256:${string}`;
  preparedArtifactHash: `sha256:${string}`;
  kernelAddress: Address;
  vaultAddress: Address;
  platformRecipient: typeof RECIPIENT;
  creatorFeeRecipient: Address;
  creatorBuyFeeBps: number;
  creatorSellFeeBps: number;
  lpFeeMode: "static" | "dynamic";
  lpFeePips: number;
  maxModuleLpFeePips: number;
}>;

/** Accept server-issued proof only when its receipt and exact prepared graph agree. */
export function parseRobinhoodFeeReviewV1(value: unknown): RobinhoodFeeReviewV1 | null {
  try {
    const resource = record(value);
    const profile = record(resource.profile);
    if (resource.schemaVersion !== "programmable.custom-launch.v4"
      || resource.apiVersion !== "v4" || resource.chainId !== "4663"
      || resource.caip2 !== "eip155:4663" || resource.routeId !== "custom-launch:create:v4"
      || profile.profileVersion !== "4.1.0" || profile.profileRevision !== 2 || profile.profileDigest !== PROFILE_DIGEST) return null;
    const proof = exact(resource.feeReview, KEYS);
    const receipt = exact(resource.admissionReceipt, RECEIPT_KEYS);
    const artifact = record(resource.preparedArtifact);
    const artifactPreimage = without(artifact, "artifactHash");
    const artifactDigest = `sha256:${sha256(stringToHex(canonicalBrowserJsonV2(artifactPreimage))).slice(2)}`;
    if (artifactDigest !== artifact.artifactHash) return null;
    const commitments = record(resource.commitments);
    const stamp = record(artifact.stampRequest);
    const pool = exact(proof.poolKey, ["currency0", "currency1", "fee", "tickSpacing", "hooks"]);
    const targets = record(artifact.route).targets;
    if (!Array.isArray(targets) || targets.length < 3 || targets.length > 16) return null;
    const kernel = targets.map(record).find((target) => target.targetId === proof.kernelTargetId);
    if (!kernel) return null;
    const moduleTarget = proof.moduleTargetId === null ? null
      : targets.map(record).find((target) => target.targetId === proof.moduleTargetId);
    const kernelAddress = address(proof.kernelAddress);
    const vaultAddress = address(proof.vaultAddress);
    const creatorFeeRecipient = address(proof.creatorFeeRecipient);
    const evidenceDigest = digest(proof.evidenceDigest);
    const proofPreimage = without(proof, "evidenceDigest");
    const receiptPreimage = without(receipt, "receiptDigest");
    const creatorBuyFeeBps = integer(proof.creatorBuyFeeBps, 9_979);
    const creatorSellFeeBps = integer(proof.creatorSellFeeBps, 9_979);
    const lpFeePips = integer(proof.lpFeePips, 0x800000);
    const maxModuleLpFeePips = integer(proof.maxModuleLpFeePips, 1_000_000);
    if (proof.schemaVersion !== SCHEMA || proof.artifactReleaseSha256 !== ARTIFACT_RELEASE
      || digest(proof.graphSha256) !== (artifact.unboundGraphBundleHash ?? artifact.graphBundleHash)
      || digest(proof.verificationBundleSha256) !== artifact.verificationBundleHash
      || proof.verificationBundleSha256 !== commitments.verification
      || digest(proof.preparedArtifactHash) !== artifact.artifactHash
      || artifact.graphBundleHash !== commitments.graph
      || typeof proof.kernelTargetId !== "string" || !/^[a-z][a-z0-9._:-]{0,127}$/u.test(proof.kernelTargetId)
      || kernelAddress !== kernel.predictedAddress
      || hash(proof.kernelRuntimeCodeHash) !== kernel.expectedRuntimeCodeHash
      || hash(proof.vaultRuntimeCodeHash) === ZERO_HASH
      || vaultAddress !== getContractAddress({ from: kernelAddress, opcode: "CREATE", nonce: 1n })
      || (proof.moduleTargetId === null ? proof.moduleRuntimeCodeHash !== ZERO_HASH
        : !moduleTarget || hash(proof.moduleRuntimeCodeHash) !== moduleTarget.expectedRuntimeCodeHash)
      || proof.platformFeeBps !== 20 || proof.denominator !== 10000 || proof.feeCurrency !== "native-ETH"
      || proof.platformRecipient !== RECIPIENT
      || proof.assessmentBase !== "gross-native-leg-once-per-successful-swap"
      || proof.rounding !== "ceil-per-trade" || proof.feeAccrual !== "pool-manager-native-claims"
      || proof.platformClaim !== "permissionless-fixed-recipient"
      || proof.customSettlementDeltas !== "unsupported" || proof.childRuntimeObservation !== "required-after-deployment"
      || proof.safetyClaim !== false || creatorFeeRecipient === ZERO_ADDRESS
      || canonicalBrowserJsonV2(pool) !== canonicalBrowserJsonV2(stamp.poolKey)
      || pool.currency0 !== ZERO_ADDRESS || pool.hooks !== kernelAddress || pool.fee !== lpFeePips
      || (proof.lpFeeMode === "dynamic" ? lpFeePips !== 0x800000
        : proof.lpFeeMode !== "static" || lpFeePips > 1_000_000)
      || canonicalBrowserSha256V2(SCHEMA, proofPreimage) !== evidenceDigest
      || receipt.schemaVersion !== RECEIPT_SCHEMA || receipt.apiVersion !== "v4" || receipt.chainId !== "4663"
      || receipt.feeReviewDigest !== evidenceDigest || receipt.requestHash !== resource.requestHash
      || receipt.rawRequestSha256 !== resource.rawRequestSha256
      || receipt.profileDigest !== profile.profileDigest
      || receipt.chainDeploymentDescriptorDigest !== resource.chainDeploymentDescriptorDigest
      || canonicalBrowserJsonV2(receipt.commitments) !== canonicalBrowserJsonV2(commitments)
      || !["supported", "supported_with_warnings"].includes(String(receipt.disposition))
      || !Array.isArray(receipt.hardBlockFindingCodes) || receipt.hardBlockFindingCodes.length !== 0
      || !Array.isArray(receipt.needsEvidenceFindingCodes) || receipt.needsEvidenceFindingCodes.length !== 0
      || canonicalBrowserSha256V2(RECEIPT_SCHEMA, receiptPreimage) !== digest(receipt.receiptDigest)) return null;
    return Object.freeze({ evidenceDigest, preparedArtifactHash: digest(proof.preparedArtifactHash),
      kernelAddress, vaultAddress, platformRecipient: RECIPIENT, creatorFeeRecipient,
      creatorBuyFeeBps, creatorSellFeeBps, lpFeeMode: proof.lpFeeMode as "static" | "dynamic",
      lpFeePips, maxModuleLpFeePips });
  } catch { return null; }
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid object");
  return value as Record<string, unknown>;
}
function exact(value: unknown, keys: readonly string[]) {
  const result = record(value);
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) throw new TypeError("Invalid fields");
  return result;
}
function without(value: Record<string, unknown>, key: string) {
  const result = { ...value };
  delete result[key];
  return result;
}
function address(value: unknown): Address {
  if (typeof value !== "string" || getAddress(value) !== value) throw new TypeError("Invalid address");
  return getAddress(value);
}
function hash(value: unknown): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/u.test(value)) throw new TypeError("Invalid hash");
  return value as Hex;
}
function digest(value: unknown): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) throw new TypeError("Invalid digest");
  return value as `sha256:${string}`;
}
function integer(value: unknown, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) throw new TypeError("Invalid fee");
  return value;
}
