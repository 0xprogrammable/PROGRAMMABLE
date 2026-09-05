import { getAddress, getContractAddress } from "viem";
import { canonicalBrowserSha256V2 } from "../../lib/custom-launch/browser-authority-v2";

import { CUSTOM_LAUNCH_ROBINHOOD_PROFILE_V41, exactWalletTransactionPreimageHashV4 } from "../../lib/custom-launch/wallet-handoff-v4";
// @ts-expect-error -- repository-local JavaScript fixture has no declaration file.
import * as fixtures from "../../packages/launch/test/fixtures/v4.mjs";

/** Full synthetic parser/UI resource. Freeze the QA clock within its permit window. */
export function robinhoodWalletReadyResourceFixtureV41() {
  const account = getAddress("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  const request = fixtures.validV4Request({ launchWallet: account });
  const received = fixtures.validV4Resource(request);
  received.metadataCommitment = canonicalBrowserSha256V2("programmable.project-metadata.v1", received.projectMetadata);
  received.commitments.metadata = received.metadataCommitment;
  received.graphCommitment = canonicalBrowserSha256V2("programmable.custom-graph-project-metadata.v1", {
    graphBundleHash: `sha256:${"8".repeat(64)}`, projectMetadataHash: received.metadataCommitment,
  });
  received.commitments.graph = received.graphCommitment;
  const { preparedArtifact, walletTransaction: generated } = fixtures.validCoordinatedGraphSubstitutionV4(received.commitments);
  const walletTransaction = fixtures.validExactWalletTransaction({ calldata: generated.calldata,
    commitments: received.commitments, from: account,
    launchSummary: { ...generated.launchSummary, controller: account } });
  const resource = fixtures.validV4Resource(request, undefined, { status: "wallet_action_required",
    preparedArtifact, walletTransaction, walletTransactionPreimageHash: walletTransaction.transactionPreimageHash,
    metadataCommitment: received.metadataCommitment, graphCommitment: received.graphCommitment,
    commitments: received.commitments });
  resource.profile = CUSTOM_LAUNCH_ROBINHOOD_PROFILE_V41;
  resource.walletTransaction.profile = CUSTOM_LAUNCH_ROBINHOOD_PROFILE_V41;
  const withoutHash = { ...resource.walletTransaction };
  delete withoutHash.transactionPreimageHash;
  resource.walletTransaction.transactionPreimageHash = exactWalletTransactionPreimageHashV4(withoutHash);
  resource.walletTransactionPreimageHash = resource.walletTransaction.transactionPreimageHash;
  resource.fundingPlan = { schemaVersion: "programmable.robinhood-funding-plan.v1",
    capitalSource: "buyer-funded", pricingModel: "concentrated-liquidity",
    nativeAllocations: { initialLiquidityWei: "0", initialBuyWei: "0", reserveWei: "0", otherLaunchValueWei: "0" },
    maxLaunchValueWei: "0", maxGasCostWei: "1000", launchMode: "fund-and-launch" };
  return attachRobinhoodFeeReviewFixtureV41(resource);
}

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
    feeReviewDigest: feeReview.evidenceDigest,
  };
  return { ...resource, feeReview, admissionReceipt: { ...receipt,
    receiptDigest: canonicalBrowserSha256V2("programmable.custom-launch-admission-receipt.v4", receipt) } };
}
