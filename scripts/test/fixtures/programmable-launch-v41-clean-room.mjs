// Synthetic integrity-test transcript. Never a production release or execution receipt.
import { getAddress, getContractAddress, encodeFunctionData, parseAbi } from "viem";
import { canonicalizeJson } from "../../../packages/launch/src/canonical-json.mjs";
import { ROBINHOOD_NATIVE20_EXECUTION_PROOF_SCHEMA_V1 } from "../../../packages/launch/src/initial-buy-review-v1.mjs";
import { ROBINHOOD_PROFILE_V41 } from "../../../packages/launch/src/profile-v41.mjs";
import { ROBINHOOD_NATIVE_FEE_ARTIFACT_SHA256_V1, ROBINHOOD_NATIVE_FEE_ARTIFACT_V1 } from "../../../packages/launch/src/robinhood-native-fee-v1.mjs";
import { sha256 } from "../../programmable-launch-v4-clean-room.mjs";
import { validCleanRoomTranscript } from "./programmable-launch-v4-clean-room.mjs";

export function framedDigest(domain, value) {
  return sha256(Buffer.concat([Buffer.from(domain), Buffer.from([0]), Buffer.from(canonicalizeJson(value))]));
}

export function syntheticInitialBuyQuoteV41() {
  const quote = {
    schemaVersion: "programmable.robinhood-initial-buy-usd-quote.v1", executionChainId: "4663",
    referenceChainId: "1", nativeCurrency: "ETH", quoteCurrency: "USD",
    assessmentBase: "gross-native-initial-buy-at-admission",
    feedAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", feedDecimals: 8,
    blockNumber: "23000000", blockHash: `0x${"c".repeat(64)}`,
    blockTimestamp: String(Date.parse("2026-09-05T11:59:20.000Z") / 1000),
    roundId: "100", answeredInRound: "100", answer: "200000000000",
    startedAt: String(Date.parse("2026-09-05T11:57:00.000Z") / 1000),
    updatedAt: String(Date.parse("2026-09-05T11:58:00.000Z") / 1000),
    minimumUsdWad: "1000000000000000000", minimumInitialBuyWei: "500000000000000",
    observedAt: "2026-09-05T11:59:30.000Z", expiresAt: "2026-09-05T12:00:30.000Z",
    providers: [{ providerId: "drpc", trustDomain: "drpc.org" },
      { providerId: "quicknode", trustDomain: "quicknode.com" }],
  };
  return { ...quote, evidenceDigest: framedDigest(quote.schemaVersion, quote) };
}

export function validCleanRoomTranscriptV41() {
  const input = validCleanRoomTranscript();
  input.prepared = JSON.parse(JSON.stringify(input.prepared)
    .replaceAll("4.0.0", "4.1.0").replaceAll("custom-launch-v4/", "custom-launch-v4.1/")
    .replace("programmable.launch-v4-clean-room-prepared.v1", "programmable.launch-v4-clean-room-prepared.v2")
    .replace("programmable.launch-cli-v4-release-binding.v1", "programmable.launch-cli-v4-release-binding.v2"));
  input.producer.schemaVersion = "programmable.launch-v4-clean-room-producer.v2";
  input.producer.workflowPath = ".github/workflows/programmable-launch-v41-clean-room.yml";
  input.producer.workflowRef = `${input.producer.repository}/${input.producer.workflowPath}@refs/heads/production`;
  const plan = {
    schemaVersion: "programmable.robinhood-funding-plan.v1", capitalSource: "buyer-funded",
    pricingModel: "concentrated-liquidity", nativeAllocations: {
      initialLiquidityWei: "0", initialBuyWei: "1000000000000000", reserveWei: "0", otherLaunchValueWei: "0",
    }, maxLaunchValueWei: "1000000000000000", maxGasCostWei: "1000000000000000", launchMode: "fund-and-launch",
  };
  input.request.profile = ROBINHOOD_PROFILE_V41;
  input.request.launchWallet = getAddress(input.request.launchWallet);
  input.request.fundingPlan = plan;
  input.request.funding = { schemaVersion: "programmable.custom-launch-funding-intent.v2",
    mode: "wallet-transaction-value", valueWei: plan.nativeAllocations.initialBuyWei };
  input.request.launchIntentHash = input.status.resource.commitments.launchIntent;
  input.request.liquidityModel = { schemaVersion: "programmable.custom-launch-liquidity-model.v1",
    model: "project-provided-liquidity", declaredLaunchState: "liquidity-provided-by-launch", targetIds: ["initializer"] };
  const requestSha = sha256(Buffer.from(canonicalizeJson(input.request)));
  const requestDigest = framedDigest("programmable.custom-launch-request.v4", input.request);
  input.local.profile = ROBINHOOD_PROFILE_V41;
  input.local.requestSha256 = requestSha;
  input.remote.profile = ROBINHOOD_PROFILE_V41;
  input.remote.requestSha256 = requestSha;
  input.remote.capabilities.profile = ROBINHOOD_PROFILE_V41;
  const preflight = input.remote.preflight;
  preflight.profile = ROBINHOOD_PROFILE_V41;
  preflight.rawRequestSha256 = requestSha;
  preflight.requestHash = requestDigest;
  preflight.disposition = "supported_with_warnings";
  preflight.launchEligibility.routable = false;
  input.remote.disposition = preflight.disposition;
  input.remote.launchEligibility = structuredClone(preflight.launchEligibility);
  const resource = input.status.resource;
  resource.profile = ROBINHOOD_PROFILE_V41;
  resource.controller.address = input.request.launchWallet;
  resource.requestHash = requestDigest;
  resource.rawRequestSha256 = requestSha;
  resource.fundingPlan = plan;
  resource.funding = input.request.funding;
  resource.liquidityModel = input.request.liquidityModel;
  const artifact = resource.preparedArtifact;
  const kernel = artifact.route.targets.find(({ targetId }) => targetId === "hook");
  kernel.predictedAddress = getAddress(kernel.predictedAddress);
  kernel.initCode = ROBINHOOD_NATIVE_FEE_ARTIFACT_V1.kernel.creationBytecode;
  artifact.stampRequest.poolKey = { ...artifact.stampRequest.poolKey,
    currency0: "0x0000000000000000000000000000000000000000", currency1: getAddress(artifact.stampRequest.poolKey.currency1),
    hooks: kernel.predictedAddress, fee: 0, tickSpacing: 60 };
  const proof = {
    schemaVersion: "programmable.robinhood-native-fee-kernel-proof.v1",
    artifactReleaseSha256: ROBINHOOD_NATIVE_FEE_ARTIFACT_SHA256_V1,
    graphSha256: artifact.unboundGraphBundleHash, verificationBundleSha256: resource.commitments.verification,
    preparedArtifactHash: artifact.artifactHash, kernelTargetId: "hook", kernelAddress: kernel.predictedAddress,
    kernelRuntimeCodeHash: kernel.expectedRuntimeCodeHash,
    vaultAddress: getContractAddress({ from: kernel.predictedAddress, opcode: "CREATE", nonce: 1n }),
    vaultRuntimeCodeHash: `0x${"d".repeat(64)}`, moduleTargetId: null, moduleRuntimeCodeHash: `0x${"0".repeat(64)}`,
    platformFeeBps: 20, denominator: 10000, feeCurrency: "native-ETH",
    platformRecipient: "0xD88539d3c4C460136a733A3Fd60cf6BF269079da",
    assessmentBase: "gross-native-leg-once-per-successful-swap", rounding: "ceil-per-trade",
    poolKey: artifact.stampRequest.poolKey, feeAccrual: "pool-manager-native-claims",
    platformClaim: "permissionless-fixed-recipient", creatorFeeRecipient: getAddress(input.request.launchWallet),
    lpFeeMode: "static", lpFeePips: 0, creatorBuyFeeBps: 0, creatorSellFeeBps: 0, maxModuleLpFeePips: 0,
    customSettlementDeltas: "unsupported", childRuntimeObservation: "required-after-deployment", safetyClaim: false,
  };
  resource.feeReview = { ...proof, evidenceDigest: framedDigest(proof.schemaVersion, proof) };
  const initializer = artifact.route.targets.find(({ targetId }) => targetId === "initializer");
  initializer.initializerValueWei = plan.nativeAllocations.initialBuyWei;
  initializer.initializerCalldata = encodeFunctionData({
    abi: parseAbi(["function initialize(address token, address hook, address buyer, uint256 minimumTokensOut) payable"]),
    functionName: "initialize", args: [proof.poolKey.currency1, proof.kernelAddress, input.request.launchWallet, 1n],
  });
  const execution = {
    schemaVersion: "programmable.robinhood-native20-seed-proof.v1",
    artifactReleaseSha256: ROBINHOOD_NATIVE20_EXECUTION_PROOF_SCHEMA_V1.properties.artifactReleaseSha256.const,
    graphSha256: proof.graphSha256, verificationBundleSha256: proof.verificationBundleSha256,
    preparedArtifactHash: proof.preparedArtifactHash, kernelEvidenceDigest: resource.feeReview.evidenceDigest,
    tokenTargetId: "token", tokenAddress: proof.poolKey.currency1,
    initializerTargetId: "initializer", initializerAddress: initializer.predictedAddress,
    initialSqrtPriceX96: "1747735933952748037356115466503453", initialTokenInventoryRaw: "1000000000000000000000000000",
    nativeSeedWei: "0", initialBuyWei: plan.nativeAllocations.initialBuyWei,
    buyer: input.request.launchWallet, minimumTokensOut: "1",
    initialBuyExecution: "atomic-full-native-input-and-minimum-token-output", tickLower: 160020, tickUpper: 200040,
    positionOwner: initializer.predictedAddress, principalPolicy: "no-remove-approve-or-execute-entrypoint",
  };
  const initialBuyReview = { schemaVersion: "programmable.robinhood-initial-buy-review.v1",
    execution: { ...execution, evidenceDigest: framedDigest(execution.schemaVersion, execution) },
    quote: syntheticInitialBuyQuoteV41(), assessmentTime: "permit-authorization" };
  resource.initialBuyReview = { ...initialBuyReview,
    evidenceDigest: framedDigest(initialBuyReview.schemaVersion, initialBuyReview) };
  const admission = resource.admissionReceipt;
  admission.issuedAt = "2026-09-05T11:59:40.000Z";
  admission.initialBuyReviewDigest = resource.initialBuyReview.evidenceDigest;
  admission.requestHash = requestDigest;
  admission.rawRequestSha256 = requestSha;
  admission.profileDigest = ROBINHOOD_PROFILE_V41.profileDigest;
  admission.commitments = structuredClone(resource.commitments);
  admission.feeReviewDigest = resource.feeReview.evidenceDigest;
  delete admission.receiptDigest;
  admission.receiptDigest = framedDigest(admission.schemaVersion, admission);
  const transaction = resource.walletTransaction;
  transaction.profile = ROBINHOOD_PROFILE_V41;
  transaction.from = input.request.launchWallet;
  transaction.valueWei = plan.nativeAllocations.initialBuyWei;
  transaction.commitments = structuredClone(resource.commitments);
  delete transaction.transactionPreimageHash;
  transaction.transactionPreimageHash = framedDigest("programmable.exact-wallet-transaction-preimage.v4", transaction);
  resource.walletTransactionPreimageHash = transaction.transactionPreimageHash;
  for (const field of ["firstSubmit", "replaySubmit"]) {
    input[field].requestSha256 = requestSha;
    input[field].idempotencyKey = input[field].idempotencyKey.replace("programmable-v4-", "programmable-v41-");
    input[field].resource = structuredClone(resource);
  }
  input.observedAt = "2026-09-05T12:00:00.000Z";
  return structuredClone(input);
}
