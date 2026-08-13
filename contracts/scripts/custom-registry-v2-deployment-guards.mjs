import { createHash } from "node:crypto";
import {
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  recoverMessageAddress,
} from "viem";

export const REGISTRY_PREFLIGHT_SCHEMA =
  "programmable.custom-registry-deployment-preflight.v5";
export const REGISTRY_AUTHORIZATION_SCHEMA =
  "programmable.custom-registry-deployment-authorization.v5";
export const REGISTRY_RECEIPT_SCHEMA =
  "programmable.custom-registry-deployment-receipt.v5";
export const REGISTRY_VERIFICATION_SCHEMA =
  "programmable.custom-registry-deployment-verification.v2";
export const REGISTRY_SOURCE_VERIFICATION_SCHEMA =
  "programmable.custom-registry-source-verification.v3";
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
export const AUTHORIZATION_SEMANTICS =
  "EXACT_RAW_TRANSACTION_HASH_AUTHORIZED_DURABLE_DISPATCH_INTENT_ACTIVATES_LATER_IDENTICAL_RAW_SEND_REBROADCAST_AND_INCLUSION_NO_WORKFLOW_CANCELLATION";
export const REGISTRY_STAGED_TRANSACTION_SCHEMA =
  "programmable.custom-registry-v2-staged-registry-transaction.v1";
export const FLASHBOTS_PRIVATE_SUBMISSION = Object.freeze({
  providerId: "flashbots-protect-max-privacy",
  sanitizedUrl: "https://rpc.flashbots.net/?hint=hash",
  method: "eth_sendRawTransaction",
  privacyMode: "FLASHBOTS_PROTECT_HASH_HINT_NO_PUBLIC_MEMPOOL",
  documentationRepository: "flashbots/flashbots-docs",
  documentationCommit: "19ed5ca7e1ea49be469145a2dc0d2b0036d2a814",
  documentationTree: "016f1aed24d4913b4cae5891912fc1c1c75fd700",
  quickStartSha256:
    "0x096b69482d3eb3318b1130dbc2444c0b2288b3876dbe3c253db451fa23dd7672",
  mevRefundsSha256:
    "0x8f1b1ce0387d6c0b78b5e5c29447181bb8955170ad1b68550252e4b6c9740da2",
});

export function assertDispatchAuthorizationWindow({
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  nowTimestamp,
  planCreatedAtTimestamp,
  planExpiresAtTimestamp,
}) {
  if (
    !Number.isSafeInteger(notBeforeTimestamp) ||
    !Number.isSafeInteger(dispatchIntentExpiresAtTimestamp) ||
    !Number.isSafeInteger(nowTimestamp) ||
    notBeforeTimestamp < planCreatedAtTimestamp ||
    notBeforeTimestamp > nowTimestamp ||
    dispatchIntentExpiresAtTimestamp <= nowTimestamp ||
    dispatchIntentExpiresAtTimestamp <= notBeforeTimestamp ||
    dispatchIntentExpiresAtTimestamp - notBeforeTimestamp > 300 ||
    dispatchIntentExpiresAtTimestamp > planExpiresAtTimestamp
  ) {
    throw new Error("dispatch authorization window is stale or invalid");
  }
}

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
  stagedTransactionSha256,
  authorizedTransactionHash,
  ownerAuthorizationAddress,
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  sourceCommit,
  sourceTree,
}) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "bytes32" },
        { type: "bytes32" },
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
        stagedTransactionSha256,
        authorizedTransactionHash,
        getAddress(ownerAuthorizationAddress),
        BigInt(notBeforeTimestamp),
        BigInt(dispatchIntentExpiresAtTimestamp),
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
    authorization.status !== "REVIEWED_READY_FOR_EXPLICIT_DISPATCH_INTENT" ||
    authorization.dispatchIntentActivationAllowed !== true ||
    authorization.broadcastRequiresDurableDispatchIntent !== true ||
    authorization.broadcastAllowed !== false ||
    authorization.signingAllowed !== false ||
    authorization.preflightSha256 !== preflightSha256 ||
    !/^0x[0-9a-f]{64}$/u.test(authorization.stagedTransactionSha256 ?? "") ||
    !/^0x[0-9a-fA-F]{64}$/u.test(
      authorization.authorizedTransactionHash ?? "",
    ) ||
    authorization.source?.commit !== plan.source?.commit ||
    authorization.source?.tree !== plan.source?.tree ||
    !/^0x[0-9a-fA-F]{40}$/.test(
      authorization.ownerAuthorizationAddress ?? "",
    ) ||
    !/^0x[0-9a-fA-F]{40}$/.test(plan.releaseAuthorization?.owner ?? "") ||
    getAddress(authorization.ownerAuthorizationAddress) !==
      getAddress(plan.releaseAuthorization.owner) ||
    plan.releaseAuthorization
      .maximumDispatchIntentAuthorizationValiditySeconds !== 300 ||
    plan.releaseAuthorization.authorizationSemantics !==
      AUTHORIZATION_SEMANTICS ||
    authorization.authorizationSemantics !== AUTHORIZATION_SEMANTICS ||
    !Number.isSafeInteger(authorization.notBeforeTimestamp) ||
    !Number.isSafeInteger(authorization.dispatchIntentExpiresAtTimestamp) ||
    authorization.dispatchIntentExpiresAtTimestamp <=
      authorization.notBeforeTimestamp ||
    authorization.dispatchIntentExpiresAtTimestamp -
      authorization.notBeforeTimestamp >
      300 ||
    authorization.dispatchIntentExpiresAtTimestamp > plan.expiresAtTimestamp ||
    (!allowExpired &&
      (authorization.notBeforeTimestamp > nowTimestamp ||
        authorization.dispatchIntentExpiresAtTimestamp < nowTimestamp))
  ) {
    throw new Error("reviewed broadcast authorization is stale or invalid");
  }
  const expected = computeReviewedPlanDigest({
    preflightSha256,
    stagedTransactionSha256: authorization.stagedTransactionSha256,
    authorizedTransactionHash: authorization.authorizedTransactionHash,
    ownerAuthorizationAddress: authorization.ownerAuthorizationAddress,
    notBeforeTimestamp: authorization.notBeforeTimestamp,
    dispatchIntentExpiresAtTimestamp:
      authorization.dispatchIntentExpiresAtTimestamp,
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
    plan.create?.exactFinalizedNonce !== plan.create?.exactPendingNonce ||
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
      Number(value.nonce ?? 0) !== 0
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
    Number(first.predictedNonce) !== Number(second.predictedNonce)
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

export function assertFinalizedReceiptAfterDispatchIntent({
  receiptBlockTimestamp,
  dispatchIntentTrustedTime,
}) {
  const dispatchIntentUpperBoundMilliseconds =
    dispatchIntentTrustedTime?.adjustedTimeMilliseconds +
    dispatchIntentTrustedTime?.uncertaintyMilliseconds;
  if (
    !Number.isSafeInteger(dispatchIntentUpperBoundMilliseconds) ||
    BigInt(receiptBlockTimestamp) * 1000n <=
      BigInt(dispatchIntentUpperBoundMilliseconds)
  ) {
    throw new Error("finalized receipt does not follow durable dispatch intent");
  }
}

export function assertFinalizedDeploymentTransaction({
  actual,
  transactionHash,
  plan,
  authorization,
  dispatchIntentTrustedTime,
}) {
  assertFinalizedReceiptAfterDispatchIntent({
    receiptBlockTimestamp: actual.receiptBlockTimestamp,
    dispatchIntentTrustedTime,
  });
  if (
    actual.hash !== transactionHash ||
    actual.blockNumber !== actual.receiptBlockNumber ||
    actual.blockHash !== actual.receiptBlockHash ||
    actual.fetchedReceiptBlockNumber !== actual.receiptBlockNumber ||
    actual.fetchedReceiptBlockHash !== actual.receiptBlockHash ||
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
    actual.runtimeCodeKeccak256 !== plan.expectedRuntime.codeKeccak256 ||
    BigInt(actual.receiptBlockTimestamp) <
      BigInt(authorization.notBeforeTimestamp)
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
      "SELF_COMPILED_ETHERSCAN_VERIFIED_SOURCE_EXACT_CLOSURE_SOURCIFY_V2_EXACT",
      "FRESH_FULL_ONCHAIN_SELF_COMPILED_ETHERSCAN_VERIFIED_SOURCE_EXACT_CLOSURE_SOURCIFY_V2_EXACT",
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
    source.etherscan?.status !== "verified-source-exact-closure" ||
    !(
      source.etherscan?.similarMatch === null ||
      /^0x[0-9a-fA-F]{40}$/u.test(source.etherscan?.similarMatch ?? "")
    ) ||
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
  const origins = [first, second].map((value) => {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname.endsWith(".")
    ) {
      throw new Error(
        "production RPC endpoints must use canonical HTTPS origins",
      );
    }
    return url.origin.toLowerCase();
  });
  if (origins[0] === origins[1]) {
    throw new Error("preflight RPC origins must be distinct");
  }
  return origins;
}

export function createRpcProviderBindings(providerIds, rpcUrls) {
  if (
    providerIds?.length !== 2 ||
    rpcUrls?.length !== 2 ||
    providerIds.some(
      (value) => !/^[a-z0-9][a-z0-9._-]{2,63}$/iu.test(value ?? ""),
    ) ||
    providerIds[0].toLowerCase() === providerIds[1].toLowerCase()
  ) {
    throw new Error(
      "two explicit distinct RPC provider identities are required",
    );
  }
  const origins = requireDistinctRpcOrigins(rpcUrls[0], rpcUrls[1]);
  return providerIds.map((providerId, index) => {
    const url = new URL(rpcUrls[index]);
    if (url.hash)
      throw new Error("production RPC endpoints must not use fragments");
    return {
      providerId,
      rpcOrigin: origins[index],
      rpcEndpointSha256: `0x${createHash("sha256")
        .update(`programmable.custom-registry-v2.rpc-endpoint.v1\0${url.href}`)
        .digest("hex")}`,
    };
  });
}

export function assertSettledDeployerNonce({
  pendingNonces,
  finalizedNonces,
}) {
  if (
    !Array.isArray(pendingNonces) ||
    !Array.isArray(finalizedNonces) ||
    pendingNonces.length !== 2 ||
    finalizedNonces.length !== 2 ||
    [...pendingNonces, ...finalizedNonces].some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    ) ||
    pendingNonces[0] !== pendingNonces[1] ||
    finalizedNonces[0] !== finalizedNonces[1] ||
    pendingNonces[0] !== finalizedNonces[0]
  ) {
    throw new Error(
      "deployer nonce is not settled at the reviewed common finalized anchor",
    );
  }
  return pendingNonces[0];
}

export function createRpcProviderBinding(providerId, rpcUrl) {
  const url = new URL(rpcUrl);
  if (
    providerId !== "flashbots-protect-max-privacy" ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hostname.endsWith(".") ||
    url.hash ||
    url.origin.toLowerCase() !== "https://rpc.flashbots.net" ||
    url.pathname !== "/" ||
    url.search !== "?hint=hash"
  ) {
    throw new Error(
      "private submission endpoint must be exact Flashbots Protect max-privacy hint=hash",
    );
  }
  return {
    providerId,
    sanitizedUrl: "https://rpc.flashbots.net/?hint=hash",
  };
}

export function assertRpcProviderBindings({ plan, providerIds, rpcUrls }) {
  const actual = createRpcProviderBindings(providerIds, rpcUrls);
  if (JSON.stringify(actual) !== JSON.stringify(plan?.rpcProviderBindings)) {
    throw new Error(
      "RPC provider identity or origin drifted from reviewed plan",
    );
  }
  return actual;
}

export function releaseRpcTransport(rpcUrl) {
  return http(rpcUrl, { fetchOptions: { redirect: "error" } });
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
