import { getContractAddress } from "viem";
import { canonicalBrowserSha256V2 } from "../../lib/custom-launch/browser-authority-v2";

import walletFixture from "./robinhood-initial-buy-wallet-v41.json";

/** Offline service-generated resource: real compiled artifact, invalid test signature and mocked RPC/simulation. */
export function robinhoodWalletReadyResourceFixtureV41() {
  return JSON.parse(JSON.stringify(walletFixture.resource));
}
export function robinhoodInitialBuyCapabilitiesFixtureV41() {
  return JSON.parse(JSON.stringify(walletFixture.capabilities));
}
export const robinhoodInitialBuyFixtureNowV41 = walletFixture.now;

/** Synthetic server receipt for parser tests; never a deployment or audit proof. */
export function attachRobinhoodFeeReviewFixtureV41<T extends Record<string, unknown>>(resource: T) {
  const artifact = resource.preparedArtifact as {
    artifactHash: string; unboundGraphBundleHash: string | null; graphBundleHash: string;
    verificationBundleHash: string;
    stampRequest: { poolKey: { currency0: string; currency1: string; hooks: `0x${string}`; fee: number; tickSpacing: number } };
    route: { targets: Array<{ targetId: string; predictedAddress: string; expectedRuntimeCodeHash: string }> };
  };
  const profile = resource.profile as { profileDigest: string };
  const controller = resource.controller as { address: string };
  const kernel = artifact.route.targets.find((target) => target.predictedAddress === artifact.stampRequest.poolKey.hooks)!;
  const poolKey = artifact.stampRequest.poolKey;
  const proof = {
    schemaVersion: "programmable.robinhood-native-fee-kernel-proof.v1",
    artifactReleaseSha256: "sha256:917c03d59c7b6c051d6aa238cd0b2a91aa02c8993ccbfce6421d5c6341d5380e",
    graphSha256: artifact.unboundGraphBundleHash ?? artifact.graphBundleHash,
    verificationBundleSha256: artifact.verificationBundleHash,
    preparedArtifactHash: artifact.artifactHash,
    kernelTargetId: kernel.targetId, kernelAddress: kernel.predictedAddress,
    kernelRuntimeCodeHash: kernel.expectedRuntimeCodeHash,
    vaultAddress: getContractAddress({ from: poolKey.hooks, opcode: "CREATE", nonce: 1n }),
    vaultRuntimeCodeHash: `0x${"77".repeat(32)}`, moduleTargetId: null, moduleRuntimeCodeHash: `0x${"00".repeat(32)}`,
    platformFeeBps: 20, denominator: 10000, feeCurrency: "native-ETH",
    platformRecipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    assessmentBase: "gross-native-leg-once-per-successful-swap", rounding: "ceil-per-trade",
    poolKey, feeAccrual: "pool-manager-native-claims", platformClaim: "permissionless-fixed-recipient",
    creatorFeeRecipient: controller.address, lpFeeMode: poolKey.fee === 0x800000 ? "dynamic" : "static",
    lpFeePips: poolKey.fee, creatorBuyFeeBps: 100, creatorSellFeeBps: 200, maxModuleLpFeePips: 3000,
    customSettlementDeltas: "unsupported", childRuntimeObservation: "required-after-deployment", safetyClaim: false,
  };
  const feeReview = { ...proof, evidenceDigest: canonicalBrowserSha256V2("programmable.robinhood-native-fee-kernel-proof.v1", proof) };
  const receipt = {
    schemaVersion: "programmable.custom-launch-admission-receipt.v4", apiVersion: "v4", chainId: "4663",
    requestHash: resource.requestHash, rawRequestSha256: resource.rawRequestSha256,
    chainDeploymentDescriptorDigest: resource.chainDeploymentDescriptorDigest,
    profileDigest: profile.profileDigest, commitments: resource.commitments,
    staticAnalysisDigest: `sha256:${"55".repeat(32)}`, externalContractEvidenceDigest: `sha256:${"66".repeat(32)}`,
    disposition: "supported", evidenceTier: "launch_mechanics_verified", hardBlockFindingCodes: [],
    needsEvidenceFindingCodes: [], warningFindingCodes: [], issuedAt: "2026-08-29T12:00:00.000Z",
    feeReviewDigest: feeReview.evidenceDigest, initialBuyReviewDigest: null,
  };
  return { ...resource, feeReview, admissionReceipt: { ...receipt,
    receiptDigest: canonicalBrowserSha256V2("programmable.custom-launch-admission-receipt.v4", receipt) } };
}
