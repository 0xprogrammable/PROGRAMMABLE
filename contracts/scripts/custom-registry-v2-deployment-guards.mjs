import { createHash } from "node:crypto";
import { encodeAbiParameters, getAddress, keccak256, recoverMessageAddress } from "viem";

export const REGISTRY_CONFIG_PARAMETER = {
  type: "tuple",
  components: [
    { name: "initialAdminDelay", type: "uint48" },
    { name: "initialAdmin", type: "address" },
    { name: "initialApprover", type: "address" },
    { name: "initialRegistrar", type: "address" },
    { name: "initialFinalizer", type: "address" },
    { name: "initialRevoker", type: "address" },
    { name: "minimumFinalityBlocks", type: "uint64" },
    { name: "registryPolicyCommitment", type: "bytes32" },
  ],
};

export function computeConstructorCommitment(config) {
  return keccak256(encodeAbiParameters([REGISTRY_CONFIG_PARAMETER], [config]));
}

export function computeReviewedPlanDigest({
  preflightSha256,
  ownerAuthorizationAddress,
  expiresAtTimestamp,
  sourceCommit,
  sourceTree,
}) {
  return keccak256(encodeAbiParameters(
    [
      { type: "bytes32" },
      { type: "address" },
      { type: "uint64" },
      { type: "string" },
      { type: "string" },
    ],
    [preflightSha256, getAddress(ownerAuthorizationAddress), BigInt(expiresAtTimestamp), sourceCommit, sourceTree],
  ));
}

export function reviewedAuthorizationMessage(reviewedPlanDigest) {
  return `Programmable Custom Registry V2 deployment authorization\n${reviewedPlanDigest}`;
}

export async function verifyReviewedAuthorizationSignature(authorization) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(authorization?.ownerAuthorizationSignature ?? "")) {
    throw new Error("owner authorization signature is invalid");
  }
  const recovered = await recoverMessageAddress({
    message: reviewedAuthorizationMessage(authorization.reviewedPlanDigest),
    signature: authorization.ownerAuthorizationSignature,
  });
  if (getAddress(recovered) !== getAddress(authorization.ownerAuthorizationAddress)) {
    throw new Error("owner authorization signature mismatch");
  }
}

export function assertReviewedAuthorization({ authorization, preflightSha256, plan, nowTimestamp }) {
  if (
    authorization?.schemaVersion !== "programmable.custom-registry-deployment-authorization.v2"
    || authorization.status !== "REVIEWED_READY_FOR_EXPLICIT_BROADCAST"
    || authorization.broadcastAllowed !== true
    || authorization.signingAllowed !== true
    || authorization.preflightSha256 !== preflightSha256
    || authorization.source?.commit !== plan.source?.commit
    || authorization.source?.tree !== plan.source?.tree
    || !/^0x[0-9a-fA-F]{40}$/.test(authorization.ownerAuthorizationAddress ?? "")
    || !Number.isSafeInteger(authorization.expiresAtTimestamp)
    || authorization.expiresAtTimestamp < nowTimestamp
    || authorization.expiresAtTimestamp > plan.expiresAtTimestamp
  ) throw new Error("reviewed broadcast authorization is stale or invalid");
  const expected = computeReviewedPlanDigest({
    preflightSha256,
    ownerAuthorizationAddress: authorization.ownerAuthorizationAddress,
    expiresAtTimestamp: authorization.expiresAtTimestamp,
    sourceCommit: authorization.source.commit,
    sourceTree: authorization.source.tree,
  });
  if (authorization.reviewedPlanDigest !== expected) throw new Error("reviewed plan digest mismatch");
  return expected;
}

export function assertPreflightEnvelope(plan, nowTimestamp) {
  if (
    plan?.schemaVersion !== "programmable.custom-registry-deployment-preflight.v2"
    || plan.status !== "PREFLIGHT_ONLY_NO_TRANSACTION"
    || plan.broadcastAllowed !== false
    || plan.signingAllowed !== false
    || !Number.isSafeInteger(plan.expiresAtTimestamp)
    || plan.expiresAtTimestamp < nowTimestamp
  ) throw new Error("preflight plan is stale or invalid");
}

export function assertSourceBinding({ commit, tree, clean, plan }) {
  if (commit !== plan.source?.commit || tree !== plan.source?.tree || !clean) {
    throw new Error("source identity drifted from reviewed plan");
  }
}

export function assertDeployerBinding(actual, expected) {
  if (getAddress(actual) !== getAddress(expected)) throw new Error("deployer key mismatch");
}

export function assertArtifactBinding({ artifactBytecode, manifestBytes, committedAbiBytes, manifest, plan }) {
  const sha256 = (bytes) => `0x${createHash("sha256").update(bytes).digest("hex")}`;
  if (
    keccak256(artifactBytecode) !== plan.source?.creationBytecodeKeccak256
    || sha256(manifestBytes) !== plan.source?.sourceManifestSha256
    || sha256(committedAbiBytes) !== manifest.artifact?.abiSha256
  ) throw new Error("committed deployment ABI, bytecode, or manifest drifted from plan");
}

export function assertLiveBinding({ first, second, plan }) {
  if (
    first.finalized.number.toString() !== plan.commonFinalizedAnchor?.blockNumber
    || first.finalized.hash !== plan.commonFinalizedAnchor?.blockHash
    || second.finalized.number !== first.finalized.number
    || second.finalized.hash !== first.finalized.hash
    || first.nonce !== second.nonce
    || first.nonce !== plan.create?.exactPendingNonce
    || first.balance !== second.balance
    || first.latest.gasLimit !== second.latest.gasLimit
    || first.latest.baseFeePerGas !== second.latest.baseFeePerGas
    || first.priorityFee !== second.priorityFee
  ) throw new Error("live broadcast state drifted from reviewed plan");
}

export function requireDistinctRpcOrigins(first, second) {
  const origins = [first, second].map((value) => new URL(value).origin.toLowerCase());
  if (origins[0] === origins[1]) throw new Error("preflight RPC origins must be distinct");
  return origins;
}

export function assessDeploymentCost({
  gasLimit,
  blockGasLimit,
  observedFeePerGas,
  maxFeePerGas,
  maxTotalCostWei,
  deployerBalance,
}) {
  for (const value of [gasLimit, blockGasLimit, observedFeePerGas, maxFeePerGas, maxTotalCostWei, deployerBalance]) {
    if (typeof value !== "bigint" || value < 0n) throw new TypeError("deployment cost input is invalid");
  }
  if (gasLimit >= blockGasLimit) throw new Error("deployment gas limit does not fit the current block gas limit");
  if (observedFeePerGas > maxFeePerGas) throw new Error("deployment fee per gas exceeds the reviewed ceiling");
  const maximumCostWei = gasLimit * maxFeePerGas;
  if (maximumCostWei > maxTotalCostWei) throw new Error("deployment maximum cost exceeds the reviewed ceiling");
  if (deployerBalance < maximumCostWei) throw new Error("deployer balance is insufficient for the reviewed maximum cost");
  return maximumCostWei;
}
