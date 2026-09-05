import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi } from "viem";
import { validateEvidenceShapeV41 } from "./fee-review-v1.mjs";
import { assertRobinhoodInitialBuyUsdQuoteV1, framedEvidenceDigestV41, ROBINHOOD_INITIAL_BUY_QUOTE_SCHEMA_V1 } from "./initial-buy-quote-v1.mjs";

const sha = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" };
const positive = { type: "string", pattern: "^[1-9][0-9]{0,77}$" };
const id = { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:@/+\\-]{0,255}$" };
const closed = properties => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
export const ROBINHOOD_NATIVE20_EXECUTION_PROOF_SCHEMA_V1 = closed({
  schemaVersion: { const: "programmable.robinhood-native20-seed-proof.v1" }, artifactReleaseSha256: { const: "sha256:c88991b7987bdbee930ead63f5ac4b880858051b334e02ff25fe533793a2d7c4" },
  graphSha256: sha, verificationBundleSha256: sha, preparedArtifactHash: sha, kernelEvidenceDigest: sha,
  tokenTargetId: id, tokenAddress: address, initializerTargetId: id, initializerAddress: address,
  initialSqrtPriceX96: { const: "1747735933952748037356115466503453" },
  initialTokenInventoryRaw: { const: "1000000000000000000000000000" }, nativeSeedWei: { const: "0" },
  initialBuyWei: positive, buyer: address, minimumTokensOut: positive,
  initialBuyExecution: { const: "atomic-full-native-input-and-minimum-token-output" },
  tickLower: { const: 160020 }, tickUpper: { const: 200040 }, positionOwner: address,
  principalPolicy: { const: "no-remove-approve-or-execute-entrypoint" }, evidenceDigest: sha,
});
export const ROBINHOOD_INITIAL_BUY_REVIEW_SCHEMA_V1 = closed({
  schemaVersion: { const: "programmable.robinhood-initial-buy-review.v1" },
  execution: ROBINHOOD_NATIVE20_EXECUTION_PROOF_SCHEMA_V1, quote: ROBINHOOD_INITIAL_BUY_QUOTE_SCHEMA_V1,
  assessmentTime: { const: "permit-authorization" }, evidenceDigest: sha,
});
const INITIALIZE = parseAbi(["function initialize(address token, address hook, address buyer, uint256 minimumTokensOut) payable"]);

/** Historical verification at the receipt's authorization time, never an execution-time USD guarantee. */
export function assertRobinhoodInitialBuyReviewV1(review, resource) {
  validateEvidenceShapeV41(review, ROBINHOOD_INITIAL_BUY_REVIEW_SCHEMA_V1, "initialBuyReview");
  const execution = review.execution;
  const { evidenceDigest: executionDigest, ...executionUnsigned } = execution;
  const { evidenceDigest: reviewDigest, ...reviewUnsigned } = review;
  const fee = resource.feeReview;
  if (reviewDigest !== framedEvidenceDigestV41(review.schemaVersion, reviewUnsigned)
    || executionDigest !== framedEvidenceDigestV41(execution.schemaVersion, executionUnsigned)
    || resource.admissionReceipt?.initialBuyReviewDigest !== reviewDigest
    || execution.kernelEvidenceDigest !== fee?.evidenceDigest
    || execution.graphSha256 !== fee.graphSha256
    || execution.verificationBundleSha256 !== fee.verificationBundleSha256
    || execution.verificationBundleSha256 !== resource.commitments.verification
    || execution.preparedArtifactHash !== fee.preparedArtifactHash
    || execution.tokenAddress !== fee.poolKey.currency1
    || getAddress(execution.buyer) !== getAddress(resource.controller.address)
    || execution.initialBuyWei !== resource.fundingPlan.nativeAllocations.initialBuyWei
    || BigInt(execution.initialBuyWei) > BigInt(resource.funding.valueWei)
    || BigInt(execution.initialBuyWei) >= 1n << 256n || BigInt(execution.minimumTokensOut) >= 1n << 256n
    || execution.positionOwner !== execution.initializerAddress
    || execution.initializerTargetId === execution.tokenTargetId
    || execution.initializerAddress === execution.tokenAddress) {
    throw new TypeError("INITIAL_BUY_REVIEW_INVALID: execution, funding, buyer or canonical proof binding differs");
  }
  if (typeof resource.admissionReceipt.issuedAt !== "string") throw new TypeError("INITIAL_BUY_REVIEW_INVALID: recorded admission timestamp is required");
  assertRobinhoodInitialBuyUsdQuoteV1(review.quote, { atTime: resource.admissionReceipt.issuedAt });
  if (BigInt(execution.initialBuyWei) < BigInt(review.quote.minimumInitialBuyWei)) {
    throw new TypeError("INITIAL_BUY_REVIEW_INVALID: proven buy is below the recorded server USD reference");
  }
  const artifact = resource.preparedArtifact;
  if (artifact != null) {
    const initializer = artifact.route.targets.find(target => target.targetId === execution.initializerTargetId);
    const token = artifact.route.targets.find(target => target.targetId === execution.tokenTargetId);
    if (execution.preparedArtifactHash !== artifact.artifactHash
      || initializer?.predictedAddress !== execution.initializerAddress
      || token?.predictedAddress !== execution.tokenAddress
      || initializer.initializerValueWei !== execution.initialBuyWei) {
      throw new TypeError("INITIAL_BUY_REVIEW_INVALID: prepared initializer or token binding differs");
    }
    const call = decodeFunctionData({ abi: INITIALIZE, data: initializer.initializerCalldata });
    if (call.functionName !== "initialize" || call.args[0] !== execution.tokenAddress
      || call.args[1] !== fee.kernelAddress || call.args[2] !== execution.buyer
      || call.args[3].toString() !== execution.minimumTokensOut
      || encodeFunctionData({ abi: INITIALIZE, functionName: "initialize", args: call.args }) !== initializer.initializerCalldata) {
      throw new TypeError("INITIAL_BUY_REVIEW_INVALID: exact atomic first-buy calldata differs");
    }
  }
  return review;
}
