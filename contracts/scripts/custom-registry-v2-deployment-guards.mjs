import { createHash } from "node:crypto";
import {
  encodeAbiParameters,
  getAddress,
  keccak256,
  recoverMessageAddress,
} from "viem";

export const REGISTRY_PREFLIGHT_SCHEMA =
  "programmable.custom-registry-deployment-preflight.v3";
export const REGISTRY_AUTHORIZATION_SCHEMA =
  "programmable.custom-registry-deployment-authorization.v4";
export const REGISTRY_RECEIPT_SCHEMA =
  "programmable.custom-registry-deployment-receipt.v2";
export const REGISTRY_VERIFICATION_SCHEMA =
  "programmable.custom-registry-deployment-verification.v1";
export const REGISTRY_SOURCE_VERIFICATION_SCHEMA =
  "programmable.custom-registry-source-verification.v2";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const AUTHORIZATION_SEMANTICS =
  "SIGN_AND_FIRST_BROADCAST_ATTEMPT_ONLY_LATER_EXACT_RAW_REBROADCAST_AND_INCLUSION_ALLOWED";

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

export const sha256 = (bytes) =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;

export function computeConstructorCommitment(config) {
  return keccak256(encodeAbiParameters([REGISTRY_CONFIG_PARAMETER], [config]));
}

export function computeReviewedPlanDigest({
  preflightSha256,
  ownerAuthorizationAddress,
  notBeforeTimestamp,
  firstAttemptExpiresAtTimestamp,
  sourceCommit,
  sourceTree,
}) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "string" },
        { type: "string" },
        { type: "string" },
      ],
      [
        REGISTRY_AUTHORIZATION_SCHEMA,
        preflightSha256,
        getAddress(ownerAuthorizationAddress),
        BigInt(notBeforeTimestamp),
        BigInt(firstAttemptExpiresAtTimestamp),
        AUTHORIZATION_SEMANTICS,
        sourceCommit,
        sourceTree,
      ],
    ),
  );
}

export function reviewedAuthorizationMessage(reviewedPlanDigest) {
  return `Programmable Custom Registry V2 exact deployment authorization\n${reviewedPlanDigest}`;
}

export async function verifyReviewedAuthorizationSignature(authorization) {
  if (
    !/^0x[0-9a-fA-F]{130}$/.test(
      authorization?.ownerAuthorizationSignature ?? "",
    )
  ) {
    throw new Error("owner authorization signature is invalid");
  }
  const recovered = await recoverMessageAddress({
    message: reviewedAuthorizationMessage(authorization.reviewedPlanDigest),
    signature: authorization.ownerAuthorizationSignature,
  });
  if (
    getAddress(recovered) !==
    getAddress(authorization.ownerAuthorizationAddress)
  ) {
    throw new Error("owner authorization signature mismatch");
  }
}

export function assertReviewedAuthorization({
  authorization,
  preflightSha256,
  plan,
  nowTimestamp,
  allowExpired = false,
}) {
  if (
    authorization?.schemaVersion !== REGISTRY_AUTHORIZATION_SCHEMA ||
    authorization.status !== "REVIEWED_READY_FOR_EXPLICIT_BROADCAST" ||
    authorization.broadcastAllowed !== true ||
    authorization.signingAllowed !== true ||
    authorization.preflightSha256 !== preflightSha256 ||
    authorization.source?.commit !== plan.source?.commit ||
    authorization.source?.tree !== plan.source?.tree ||
    !/^0x[0-9a-fA-F]{40}$/.test(
      authorization.ownerAuthorizationAddress ?? "",
    ) ||
    !/^0x[0-9a-fA-F]{40}$/.test(plan.releaseAuthorization?.owner ?? "") ||
    getAddress(authorization.ownerAuthorizationAddress) !==
      getAddress(plan.releaseAuthorization.owner) ||
    plan.releaseAuthorization.maximumSigningAndFirstAttemptValiditySeconds !==
      300 ||
    plan.releaseAuthorization.authorizationSemantics !==
      AUTHORIZATION_SEMANTICS ||
    authorization.authorizationSemantics !== AUTHORIZATION_SEMANTICS ||
    !Number.isSafeInteger(authorization.notBeforeTimestamp) ||
    !Number.isSafeInteger(authorization.firstAttemptExpiresAtTimestamp) ||
    authorization.firstAttemptExpiresAtTimestamp <=
      authorization.notBeforeTimestamp ||
    authorization.firstAttemptExpiresAtTimestamp -
      authorization.notBeforeTimestamp >
      300 ||
    authorization.firstAttemptExpiresAtTimestamp > plan.expiresAtTimestamp ||
    (!allowExpired &&
      (authorization.notBeforeTimestamp > nowTimestamp ||
        authorization.firstAttemptExpiresAtTimestamp < nowTimestamp))
  ) {
    throw new Error("reviewed broadcast authorization is stale or invalid");
  }
  const expected = computeReviewedPlanDigest({
    preflightSha256,
    ownerAuthorizationAddress: authorization.ownerAuthorizationAddress,
    notBeforeTimestamp: authorization.notBeforeTimestamp,
    firstAttemptExpiresAtTimestamp:
      authorization.firstAttemptExpiresAtTimestamp,
    sourceCommit: authorization.source.commit,
    sourceTree: authorization.source.tree,
  });
  if (authorization.reviewedPlanDigest !== expected) {
    throw new Error("reviewed plan digest mismatch");
  }
  return expected;
}

export function assertPreflightEnvelope(
  plan,
  nowTimestamp,
  { allowExpired = false } = {},
) {
  if (
    plan?.schemaVersion !== REGISTRY_PREFLIGHT_SCHEMA ||
    plan.status !== "PREFLIGHT_ONLY_NO_TRANSACTION" ||
    plan.chainId !== 1 ||
    plan.broadcastAllowed !== false ||
    plan.signingAllowed !== false ||
    !Number.isSafeInteger(plan.createdAtTimestamp) ||
    !Number.isSafeInteger(plan.expiresAtTimestamp) ||
    plan.expiresAtTimestamp <= plan.createdAtTimestamp ||
    plan.expiresAtTimestamp - plan.createdAtTimestamp > 900 ||
    (!allowExpired &&
      (plan.createdAtTimestamp > nowTimestamp + 30 ||
        plan.expiresAtTimestamp < nowTimestamp))
  ) {
    throw new Error("preflight plan is stale or invalid");
  }
}

export function assertSourceBinding({ commit, tree, clean, plan }) {
  if (commit !== plan.source?.commit || tree !== plan.source?.tree || !clean) {
    throw new Error("source identity drifted from reviewed plan");
  }
}

export function assertDeployerBinding(actual, expected) {
  if (getAddress(actual) !== getAddress(expected)) {
    throw new Error("deployer key mismatch");
  }
}

export function assertArtifactBinding({
  artifactBytecode,
  deploymentData,
  manifestBytes,
  committedAbiBytes,
  productionPolicyBytes,
  safeVerificationBytes,
  manifest,
  plan,
}) {
  if (
    keccak256(artifactBytecode) !== plan.source?.creationBytecodeKeccak256 ||
    keccak256(deploymentData) !== plan.source?.deploymentDataKeccak256 ||
    sha256(manifestBytes) !== plan.source?.sourceManifestSha256 ||
    sha256(committedAbiBytes) !== plan.source?.committedAbiSha256 ||
    sha256(committedAbiBytes) !== manifest.artifact?.abiSha256 ||
    sha256(productionPolicyBytes) !== plan.productionPolicy?.documentSha256 ||
    sha256(safeVerificationBytes) !== plan.safeControllers?.verificationSha256
  ) {
    throw new Error(
      "committed policy, Safe evidence, deployment ABI, bytecode, data, or manifest drifted from plan",
    );
  }
}

export function assertExpectedDeploymentTransaction({ plan, deploymentData }) {
  const expected = plan.expectedTransaction;
  if (
    expected?.type !== "eip1559" ||
    expected.chainId !== 1 ||
    getAddress(expected.from) !== getAddress(plan.create?.deployer) ||
    expected.to !== null ||
    expected.input !== deploymentData ||
    expected.valueWei !== "0" ||
    expected.nonce !== plan.create?.exactPendingNonce ||
    expected.gasLimit !== plan.create?.gasLimit ||
    expected.maxFeePerGas !== plan.create?.reviewedMaxFeePerGas ||
    expected.maxPriorityFeePerGas !== plan.create?.reviewedMaxPriorityFeePerGas
  ) {
    throw new Error(
      "exact deployment transaction does not match the reviewed plan",
    );
  }
}

export function assertPredictedAddressUnoccupied(...observations) {
  for (const observation of observations) {
    const value =
      typeof observation === "string"
        ? { code: observation, nonce: 0, balance: 0n }
        : observation;
    if (
      (value.code !== undefined && value.code !== "0x") ||
      Number(value.nonce ?? 0) !== 0 ||
      BigInt(value.balance ?? 0) !== 0n
    ) {
      throw new Error("predicted address is occupied on an independent RPC");
    }
  }
}

export function assertFinalizedAnchor({ anchor, observations }) {
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(anchor?.blockHash ?? "") ||
    observations.length !== 2 ||
    observations.some(
      ({ number, hash }) =>
        number.toString() !== anchor.blockNumber || hash !== anchor.blockHash,
    )
  ) {
    throw new Error("reviewed finalized anchor is not canonical on both RPCs");
  }
}

export function assertLiveBinding({ first, second, plan }) {
  const sameFinalized =
    first.finalized.number === second.finalized.number &&
    first.finalized.hash === second.finalized.hash;
  const reviewedAnchorReached =
    first.finalized.number >=
    BigInt(plan.commonFinalizedAnchor?.blockNumber ?? -1);
  if (
    !sameFinalized ||
    !reviewedAnchorReached ||
    first.nonce !== second.nonce ||
    first.nonce !== plan.create?.exactPendingNonce ||
    first.balance !== second.balance ||
    first.predictedCode !== second.predictedCode ||
    Number(first.predictedNonce) !== Number(second.predictedNonce) ||
    first.predictedBalance !== second.predictedBalance
  ) {
    throw new Error("live broadcast state drifted from reviewed plan");
  }
}

export function assertPostDeploymentBinding({ actual, expected }) {
  const roleAssignmentsExact =
    actual.roleAssignments.length === 4 &&
    actual.roleAssignments.every(
      ({ expectedControllerHasRole, zeroAddressHasRole, adminHasRole }) =>
        expectedControllerHasRole === true &&
        zeroAddressHasRole === false &&
        adminHasRole === false,
    );
  const noPendingControllers =
    actual.pendingControllers.length === 4 &&
    actual.pendingControllers.every(
      ({ controller, acceptAfter }) =>
        getAddress(controller) === ZERO_ADDRESS && BigInt(acceptAfter) === 0n,
    );
  if (
    !actual.runtimeA ||
    actual.runtimeA === "0x" ||
    actual.runtimeA !== actual.runtimeB ||
    keccak256(actual.runtimeA) !== expected.runtimeCodeKeccak256 ||
    actual.chainId !== 1n ||
    actual.registryGeneration !== 2n ||
    BigInt(actual.adminDelay) !== BigInt(expected.initialAdminDelay) ||
    getAddress(actual.admin) !== getAddress(expected.initialAdmin) ||
    getAddress(actual.pendingAdmin) !== ZERO_ADDRESS ||
    BigInt(actual.pendingAdminSchedule) !== 0n ||
    BigInt(actual.pendingAdminDelay) !== 0n ||
    BigInt(actual.pendingAdminDelaySchedule) !== 0n ||
    actual.minimumFinalityBlocks !== BigInt(expected.minimumFinalityBlocks) ||
    actual.policy !== expected.registryPolicyCommitment ||
    actual.controllers.some(
      (controller, index) =>
        getAddress(controller) !== getAddress(expected.controllers[index]),
    ) ||
    !roleAssignmentsExact ||
    !noPendingControllers ||
    actual.approvalCount !== 0n ||
    actual.registrationCount !== 0n ||
    actual.transitionCount !== 0n
  ) {
    throw new Error(
      "post-deployment runtime, immutable, controller, pending-state, role, or counter verification failed",
    );
  }
}

export function assertFinalizedDeploymentTransaction({
  actual,
  transactionHash,
  plan,
}) {
  if (
    actual.hash !== transactionHash ||
    actual.blockNumber !== actual.receiptBlockNumber ||
    actual.blockHash !== actual.receiptBlockHash ||
    actual.receiptTransactionHash !== transactionHash ||
    getAddress(actual.from) !== getAddress(plan.expectedTransaction.from) ||
    actual.to !== null ||
    actual.input !== plan.expectedTransaction.input ||
    actual.value !== plan.expectedTransaction.valueWei ||
    actual.nonce !== plan.expectedTransaction.nonce ||
    actual.chainId !== 1 ||
    actual.type !== "eip1559" ||
    actual.gas !== plan.expectedTransaction.gasLimit ||
    actual.maxFeePerGas !== plan.expectedTransaction.maxFeePerGas ||
    actual.maxPriorityFeePerGas !==
      plan.expectedTransaction.maxPriorityFeePerGas ||
    actual.receiptStatus !== "success" ||
    getAddress(actual.receiptContractAddress) !==
      getAddress(plan.create.predictedAddress) ||
    BigInt(actual.receiptGasUsed) > BigInt(plan.expectedTransaction.gasLimit) ||
    BigInt(actual.receiptEffectiveGasPrice) >
      BigInt(plan.expectedTransaction.maxFeePerGas) ||
    actual.runtimeCodeKeccak256 !== plan.expectedRuntime.codeKeccak256
  ) {
    throw new Error(
      "finalized Registry transaction does not match the exact signed plan",
    );
  }
}

export function assertSourceVerificationBinding({ onchain, source }) {
  if (
    onchain?.schemaVersion !== REGISTRY_VERIFICATION_SCHEMA ||
    onchain.status !== "VERIFIED_FINALIZED_ONCHAIN_AWAITING_SOURCE" ||
    onchain.verified !== false ||
    source?.schemaVersion !== REGISTRY_SOURCE_VERIFICATION_SCHEMA ||
    ![
      "SELF_COMPILED_ETHERSCAN_EXACT_SOURCIFY_V2_EXACT",
      "FRESH_FULL_ONCHAIN_SELF_COMPILED_DUAL_PROVIDER_EXACT",
    ].includes(source.status) ||
    source.verified !== true ||
    source.chainId !== 1 ||
    getAddress(source.contractAddress) !==
      getAddress(onchain.contractAddress) ||
    source.transactionHash !== onchain.transactionHash ||
    source.source?.commit !== onchain.source?.commit ||
    source.source?.tree !== onchain.source?.tree ||
    source.runtimeCodeKeccak256 !== onchain.runtimeCodeKeccak256 ||
    source.constructorArguments !== onchain.constructorArguments ||
    source.fqcn !==
      "src/ProgrammableCustomRegistryV2.sol:ProgrammableCustomRegistryV2" ||
    source.compiler?.version !== "v0.8.26+commit.8a97fa7a" ||
    !["darwin", "linux"].includes(source.compiler?.platform) ||
    !["arm64", "x64"].includes(source.compiler?.architecture) ||
    !/^0x[0-9a-f]{64}$/u.test(source.compiler?.binarySha256 ?? "") ||
    !/^0x[0-9a-f]{64}$/u.test(source.compiler?.standardJsonInputSha256 ?? "") ||
    !/^0x[0-9a-f]{64}$/u.test(
      source.compiler?.standardJsonOutputSha256 ?? "",
    ) ||
    Object.keys(source.sourceClosure ?? {}).length !== 13 ||
    Object.values(source.sourceClosure ?? {}).some(
      (digest) => !/^0x[0-9a-f]{64}$/u.test(digest),
    ) ||
    source.etherscan?.status !== "exact-match" ||
    source.etherscan?.url !==
      `https://etherscan.io/address/${getAddress(onchain.contractAddress)}#code` ||
    source.sourcify?.status !== "exact-match" ||
    source.sourcify?.url !==
      `https://sourcify.dev/server/v2/contract/1/${getAddress(onchain.contractAddress)}`
  ) {
    throw new Error(
      "source verification does not bind finalized onchain evidence",
    );
  }
}

export function requireDistinctRpcOrigins(first, second) {
  const origins = [first, second].map((value) =>
    new URL(value).origin.toLowerCase(),
  );
  if (origins[0] === origins[1]) {
    throw new Error("preflight RPC origins must be distinct");
  }
  return origins;
}

export function assessDeploymentCost({
  gasLimit,
  blockGasLimit,
  observedFeePerGas,
  maxFeePerGas,
  maxPriorityFeePerGas = 0n,
  maxTotalCostWei,
  deployerBalance,
}) {
  for (const value of [
    gasLimit,
    blockGasLimit,
    observedFeePerGas,
    maxFeePerGas,
    maxPriorityFeePerGas,
    maxTotalCostWei,
    deployerBalance,
  ]) {
    if (typeof value !== "bigint" || value < 0n) {
      throw new TypeError("deployment cost input is invalid");
    }
  }
  if (gasLimit >= blockGasLimit) {
    throw new Error(
      "deployment gas limit does not fit the current block gas limit",
    );
  }
  if (maxPriorityFeePerGas > maxFeePerGas) {
    throw new Error("deployment priority fee exceeds the reviewed fee ceiling");
  }
  if (observedFeePerGas > maxFeePerGas) {
    throw new Error("deployment fee per gas exceeds the reviewed ceiling");
  }
  const maximumCostWei = gasLimit * maxFeePerGas;
  if (maximumCostWei > maxTotalCostWei) {
    throw new Error("deployment maximum cost exceeds the reviewed ceiling");
  }
  if (deployerBalance < maximumCostWei) {
    throw new Error(
      "deployer balance is insufficient for the reviewed maximum cost",
    );
  }
  return maximumCostWei;
}
