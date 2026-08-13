import {
  concatHex,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  getAddress,
  getCreate2Address,
  keccak256,
  padHex,
  recoverMessageAddress,
} from "viem";

export const SAFE_SETUP_ABI = [
  {
    type: "function",
    name: "setup",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_owners", type: "address[]" },
      { name: "_threshold", type: "uint256" },
      { name: "to", type: "address" },
      { name: "data", type: "bytes" },
      { name: "fallbackHandler", type: "address" },
      { name: "paymentToken", type: "address" },
      { name: "payment", type: "uint256" },
      { name: "paymentReceiver", type: "address" },
    ],
    outputs: [],
  },
];

export const SAFE_FACTORY_ABI = [
  {
    type: "event",
    name: "ProxyCreation",
    inputs: [
      { indexed: true, name: "proxy", type: "address" },
      { indexed: false, name: "singleton", type: "address" },
    ],
  },
  {
    type: "function",
    name: "proxyCreationCode",
    stateMutability: "pure",
    inputs: [],
    outputs: [{ name: "", type: "bytes" }],
  },
  {
    type: "function",
    name: "createProxyWithNonce",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_singleton", type: "address" },
      { name: "initializer", type: "bytes" },
      { name: "saltNonce", type: "uint256" },
    ],
    outputs: [{ name: "proxy", type: "address" }],
  },
];

export const SAFE_PLAN_SCHEMA =
  "programmable.custom-registry-v2-safe-controller-preflight.v2";
export const SAFE_AUTHORIZATION_SCHEMA =
  "programmable.custom-registry-v2-safe-controller-authorization.v1";
export const SAFE_RECEIPTS_SCHEMA =
  "programmable.custom-registry-v2-safe-controller-receipts.v2";
export const SAFE_VERIFICATION_SCHEMA =
  "programmable.custom-registry-v2-safe-controller-verification.v2";
export const SAFE_CUSTODY_PROOF_SCHEMA =
  "programmable.custom-registry-v2-keychain-custody-proof.v2";
export const SAFE_CONTROLLER_ROLES = [
  "approver",
  "registrar",
  "finalizer",
  "revoker",
];
export const SAFE_CUSTODY_ROLES = [
  "deployer",
  "admin",
  ...SAFE_CONTROLLER_ROLES,
];

export function safeTransactionInput({ singleton, initializer, saltNonce }) {
  return encodeFunctionData({
    abi: SAFE_FACTORY_ABI,
    functionName: "createProxyWithNonce",
    args: [getAddress(singleton), initializer, BigInt(saltNonce)],
  });
}

export function computeSafeReviewedPlanDigest({
  preflightSha256,
  ownerAuthorizationAddress,
  expiresAtTimestamp,
  sourceCommit,
  sourceTree,
  policySha256,
  custodyProofSha256,
}) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "string" },
        { type: "bytes32" },
        { type: "address" },
        { type: "uint64" },
        { type: "string" },
        { type: "string" },
        { type: "bytes32" },
        { type: "bytes32" },
      ],
      [
        SAFE_AUTHORIZATION_SCHEMA,
        preflightSha256,
        getAddress(ownerAuthorizationAddress),
        BigInt(expiresAtTimestamp),
        sourceCommit,
        sourceTree,
        policySha256,
        custodyProofSha256,
      ],
    ),
  );
}

export function safeReviewedAuthorizationMessage(reviewedPlanDigest) {
  return `Programmable Custom Registry V2 Safe controller deployment authorization\n${reviewedPlanDigest}`;
}

export async function verifySafeReviewedAuthorizationSignature(authorization) {
  if (
    !/^0x[0-9a-fA-F]{130}$/u.test(
      authorization?.ownerAuthorizationSignature ?? "",
    )
  ) {
    throw new Error("Safe owner authorization signature is invalid");
  }
  const recovered = await recoverMessageAddress({
    message: safeReviewedAuthorizationMessage(authorization.reviewedPlanDigest),
    signature: authorization.ownerAuthorizationSignature,
  });
  if (
    getAddress(recovered) !==
    getAddress(authorization.ownerAuthorizationAddress)
  ) {
    throw new Error("Safe owner authorization signature mismatch");
  }
}

export function assertSafePreflightEnvelope(
  plan,
  nowTimestamp,
  { allowExpired = false } = {},
) {
  if (
    plan?.schemaVersion !== SAFE_PLAN_SCHEMA ||
    plan.status !== "PREFLIGHT_ONLY_NO_TRANSACTION" ||
    plan.chainId !== 1 ||
    plan.signingAllowed !== false ||
    plan.broadcastAllowed !== false ||
    !Number.isSafeInteger(plan.createdAtTimestamp) ||
    !Number.isSafeInteger(plan.validitySeconds) ||
    plan.validitySeconds <= 0 ||
    plan.validitySeconds > 900 ||
    !Number.isSafeInteger(plan.expiresAtTimestamp) ||
    plan.expiresAtTimestamp !==
      plan.createdAtTimestamp + plan.validitySeconds ||
    (!allowExpired && plan.createdAtTimestamp > nowTimestamp) ||
    (!allowExpired && plan.expiresAtTimestamp < nowTimestamp) ||
    plan.controllers?.length !== SAFE_CONTROLLER_ROLES.length ||
    !/^0x[0-9a-f]{64}$/u.test(plan.policySha256 ?? "") ||
    !/^0x[0-9a-f]{64}$/u.test(plan.custodyProofSha256 ?? "")
  ) {
    throw new Error("Safe preflight plan is stale or invalid");
  }
}

export function assertSafeCostReviewEnvelope(plan) {
  if (
    plan?.schemaVersion !== SAFE_PLAN_SCHEMA ||
    plan.status !== "UNFUNDED_COST_REVIEW_ONLY" ||
    plan.chainId !== 1 ||
    plan.signingAllowed !== false ||
    plan.broadcastAllowed !== false ||
    plan.fundingSufficient !== false ||
    !Number.isSafeInteger(plan.createdAtTimestamp) ||
    !Number.isSafeInteger(plan.validitySeconds) ||
    plan.validitySeconds <= 0 ||
    plan.validitySeconds > 900 ||
    !Number.isSafeInteger(plan.expiresAtTimestamp) ||
    plan.expiresAtTimestamp !==
      plan.createdAtTimestamp + plan.validitySeconds ||
    plan.controllers?.length !== SAFE_CONTROLLER_ROLES.length ||
    !/^0x[0-9a-f]{64}$/u.test(plan.policySha256 ?? "") ||
    !/^0x[0-9a-f]{64}$/u.test(plan.custodyProofSha256 ?? "")
  ) {
    throw new Error("Safe unfunded cost-review plan is invalid");
  }
}

export function assertSafePolicyBoundPlan({
  plan,
  policy,
  manifest,
  sourceManifestSha256,
}) {
  const zero = "0x0000000000000000000000000000000000000000";
  const canonicalUint = (value) => /^(0|[1-9][0-9]*)$/u.test(value ?? "");
  if (
    policy?.schemaVersion !==
      "programmable.custom-registry-v2-safe-controller-policy.v1" ||
    policy.chainId !== "1" ||
    policy.safeVersion !== "1.4.1" ||
    policy.source?.repository !== "safe-fndn/safe-smart-account" ||
    policy.source?.tag !== "v1.4.1" ||
    policy.source?.commit !==
      "bf943f80fec5ac647159d26161446ac5d716a294" ||
    policy.deploymentInventory?.repository !==
      "safe-global/safe-deployments" ||
    policy.deploymentInventory?.commit !==
      "5bb0ebd7150a777f39bec4733e4d799c4b637b49" ||
    policy.deploymentInventory?.tree !==
      "9c48b5f3bd56e47239a15c8da9d2e2c4d9f87679" ||
    getAddress(policy.singleton?.address) !==
      getAddress("0x41675C099F32341bf84BFc5382aF534df5C7461a") ||
    policy.singleton?.runtimeCodeKeccak256 !==
      "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4" ||
    getAddress(policy.proxyFactory?.address) !==
      getAddress("0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67") ||
    policy.proxyFactory?.runtimeCodeKeccak256 !==
      "0x50c3cdc4074750a7a974204a716c999edd37482f907608d960b2b025ee0b3317" ||
    policy.proxyFactory?.proxyCreationCodeKeccak256 !==
      "0x1856e0ee08399d74e0ea0b03adca210aeade6f748969ac023cdcb4dd62dcaf5f" ||
    policy.proxyFactory?.proxyRuntimeCodeKeccak256 !==
      "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c" ||
    policy.proxyFactory?.proxyCreationEvent !==
      "ProxyCreation(address,address)" ||
    !/^[0-9a-f]{40}$/u.test(plan.source?.commit ?? "") ||
    !/^[0-9a-f]{40}$/u.test(plan.source?.tree ?? "") ||
    !Number.isSafeInteger(plan.exactPendingNonce) ||
    plan.exactPendingNonce < 0 ||
    !canonicalUint(plan.commonFinalizedAnchor?.blockNumber) ||
    BigInt(plan.commonFinalizedAnchor.blockNumber) === 0n ||
    !/^0x[0-9a-f]{64}$/u.test(
      plan.commonFinalizedAnchor?.blockHash ?? "",
    ) ||
    !canonicalUint(plan.deployerBalanceWei) ||
    !canonicalUint(plan.totalGasLimit) ||
    !canonicalUint(plan.observedFeePerGas) ||
    !canonicalUint(plan.reviewedMaxFeePerGas) ||
    !canonicalUint(plan.reviewedMaxTotalCostWei) ||
    !canonicalUint(plan.maximumTotalCostWei) ||
    !/^0x[0-9a-f]{64}$/u.test(sourceManifestSha256 ?? "") ||
    plan.sourceManifestSha256 !== sourceManifestSha256 ||
    manifest?.status !== "SOURCE_ONLY_NOT_DEPLOYED" ||
    manifest.activationAllowed !== false ||
    manifest.sourceDigests?.[
      "config/custom-registry-v2-safe-controller-policy.json"
    ] !== plan.policySha256 ||
    getAddress(manifest.releaseAuthorization?.owner) !==
      getAddress(plan.releaseAuthorization?.owner) ||
    manifest.releaseAuthorization?.maximumValiditySeconds !== 300 ||
    plan.releaseAuthorization?.maximumValiditySeconds !== 300 ||
    plan.safeVersion !== policy.safeVersion ||
    getAddress(plan.singleton?.address) !==
      getAddress(policy.singleton?.address) ||
    plan.singleton?.runtimeCodeKeccak256 !==
      policy.singleton?.runtimeCodeKeccak256 ||
    getAddress(plan.proxyFactory?.address) !==
      getAddress(policy.proxyFactory?.address) ||
    plan.proxyFactory?.runtimeCodeKeccak256 !==
      policy.proxyFactory?.runtimeCodeKeccak256 ||
    plan.proxyFactory?.proxyCreationCodeKeccak256 !==
      policy.proxyFactory?.proxyCreationCodeKeccak256 ||
    plan.proxyFactory?.proxyCreationCode !==
      policy.proxyFactory?.proxyCreationCode ||
    plan.proxyFactory?.proxyRuntimeCodeKeccak256 !==
      policy.proxyFactory?.proxyRuntimeCodeKeccak256 ||
    plan.proxyFactory?.proxyCreationEvent !==
      policy.proxyFactory?.proxyCreationEvent ||
    !/^0x[0-9a-fA-F]+$/u.test(plan.proxyFactory?.proxyCreationCode ?? "") ||
    keccak256(plan.proxyFactory.proxyCreationCode) !==
      policy.proxyFactory.proxyCreationCodeKeccak256 ||
    JSON.stringify(plan.storageSlots) !==
      JSON.stringify(policy.storageSlots) ||
    policy.setup?.threshold !== 1 ||
    getAddress(policy.setup?.to) !== getAddress(zero) ||
    policy.setup?.data !== "0x" ||
    getAddress(policy.setup?.fallbackHandler) !== getAddress(zero) ||
    getAddress(policy.setup?.paymentToken) !== getAddress(zero) ||
    policy.setup?.payment !== "0" ||
    getAddress(policy.setup?.paymentReceiver) !== getAddress(zero) ||
    policy.setup?.modules?.length !== 0 ||
    getAddress(policy.setup?.guard) !== getAddress(zero) ||
    plan.controllers?.length !== SAFE_CONTROLLER_ROLES.length ||
    plan.custody?.roles?.length !== SAFE_CUSTODY_ROLES.length ||
    !/^0x[0-9a-f]{64}$/u.test(plan.custody?.inventorySha256 ?? "")
  ) {
    throw new Error("Safe plan is not bound to committed policy and source");
  }

  const deployer = getAddress(plan.deployer);
  const admin = getAddress(plan.admin);
  const releaseOwner = getAddress(plan.releaseAuthorization.owner);
  const custodyByRole = new Map(
    plan.custody.roles.map((entry) => [entry.role, entry]),
  );
  if (
    custodyByRole.size !== SAFE_CUSTODY_ROLES.length ||
    getAddress(custodyByRole.get("deployer")?.publicAddress) !== deployer ||
    custodyByRole.get("deployer")?.service !==
      "programmable.custom-registry.v2.production-custody.20260813.deployer" ||
    !/^0x[0-9a-f]{64}$/u.test(
      custodyByRole.get("deployer")?.readbackSha256 ?? "",
    )
  ) {
    throw new Error("Safe plan custody roles do not match the deployer");
  }

  let totalGasLimit = 0n;
  let reviewedPriorityFee;
  const predictedAddresses = new Set();
  const isolatedAddresses = new Set([deployer.toLowerCase(), releaseOwner.toLowerCase()]);
  for (const [index, role] of SAFE_CONTROLLER_ROLES.entries()) {
    const controller = plan.controllers[index];
    const custody = custodyByRole.get(role);
    if (
      controller?.role !== role ||
      custody?.role !== role ||
      getAddress(custody.publicAddress) !== getAddress(controller.owner) ||
      custody.service !==
        `programmable.custom-registry.v2.production-custody.20260813.${role}` ||
      !/^0x[0-9a-f]{64}$/u.test(custody.readbackSha256 ?? "") ||
      controller.saltNonce !== policy.roles?.[role]?.saltNonce
    ) {
      throw new Error(`Safe plan custody or role binding failed for ${role}`);
    }
    const expectedInitializer = safeInitializer(controller.owner, policy.setup);
    const expectedInput = safeTransactionInput({
      singleton: policy.singleton.address,
      initializer: expectedInitializer,
      saltNonce: controller.saltNonce,
    });
    const expectedAddress = predictSafeProxyAddress({
      factory: policy.proxyFactory.address,
      singleton: policy.singleton.address,
      proxyCreationCode: plan.proxyFactory.proxyCreationCode,
      initializer: expectedInitializer,
      saltNonce: controller.saltNonce,
    });
    const estimates = controller.gasEstimates?.map((value) => BigInt(value));
    const gasLimit = BigInt(controller.gasLimit);
    const maximumEstimate = estimates?.reduce(
      (maximum, value) => (value > maximum ? value : maximum),
      0n,
    );
    const transaction = controller.expectedTransaction;
    const priorityFee = BigInt(transaction?.maxPriorityFeePerGas);
    if (
      controller.initializer !== expectedInitializer ||
      controller.initializerKeccak256 !== keccak256(expectedInitializer) ||
      getAddress(controller.predictedAddress) !== getAddress(expectedAddress) ||
      controller.expectedTransactionNonce !== plan.exactPendingNonce + index ||
      estimates?.length !== 2 ||
      !controller.gasEstimates.every(canonicalUint) ||
      controller.predictedAddressNonces?.length !== 2 ||
      controller.predictedAddressNonces.some((nonce) => nonce !== 0) ||
      controller.predictedAddressBalancesWei?.length !== 2 ||
      !controller.predictedAddressBalancesWei.every(
        (balance) => balance === "0",
      ) ||
      !canonicalUint(controller.gasLimit) ||
      maximumEstimate === undefined ||
      gasLimit !== (maximumEstimate * 120n) / 100n ||
      transaction?.chainId !== 1 ||
      getAddress(transaction.from) !== deployer ||
      getAddress(transaction.to) !== getAddress(policy.proxyFactory.address) ||
      transaction.input !== expectedInput ||
      transaction.valueWei !== "0" ||
      transaction.nonce !== controller.expectedTransactionNonce ||
      transaction.gasLimit !== controller.gasLimit ||
      !canonicalUint(transaction.maxFeePerGas) ||
      !canonicalUint(transaction.maxPriorityFeePerGas) ||
      transaction.maxFeePerGas !== plan.reviewedMaxFeePerGas ||
      priorityFee === 0n ||
      priorityFee > BigInt(plan.reviewedMaxFeePerGas) ||
      (reviewedPriorityFee !== undefined && priorityFee !== reviewedPriorityFee)
    ) {
      throw new Error(`Safe plan transaction binding failed for ${role}`);
    }
    reviewedPriorityFee = priorityFee;
    totalGasLimit += gasLimit;
    predictedAddresses.add(getAddress(controller.predictedAddress).toLowerCase());
    isolatedAddresses.add(getAddress(controller.owner).toLowerCase());
    isolatedAddresses.add(getAddress(controller.predictedAddress).toLowerCase());
  }

  const adminCustody = custodyByRole.get("admin");
  if (
    adminCustody?.service !==
      "programmable.custom-registry.v2.production-custody.20260813.admin" ||
    getAddress(adminCustody?.publicAddress) !== admin ||
    !/^0x[0-9a-f]{64}$/u.test(adminCustody?.readbackSha256 ?? "") ||
    getAddress(custodyByRole.get("deployer")?.publicAddress) !== deployer
  ) {
    throw new Error("Safe plan admin or deployer custody binding failed");
  }
  isolatedAddresses.add(admin.toLowerCase());
  if (
    predictedAddresses.size !== SAFE_CONTROLLER_ROLES.length ||
    isolatedAddresses.size !==
      SAFE_CUSTODY_ROLES.length + SAFE_CONTROLLER_ROLES.length + 1 ||
    totalGasLimit === 0n ||
    BigInt(plan.reviewedMaxFeePerGas) === 0n ||
    BigInt(plan.reviewedMaxTotalCostWei) === 0n ||
    totalGasLimit !== BigInt(plan.totalGasLimit) ||
    BigInt(plan.maximumTotalCostWei) !==
      totalGasLimit * BigInt(plan.reviewedMaxFeePerGas) ||
    BigInt(plan.maximumTotalCostWei) >
      BigInt(plan.reviewedMaxTotalCostWei) ||
    BigInt(plan.observedFeePerGas) > BigInt(plan.reviewedMaxFeePerGas) ||
    plan.fundingSufficient !==
      (BigInt(plan.deployerBalanceWei) >= BigInt(plan.maximumTotalCostWei))
  ) {
    throw new Error("Safe plan aggregate cost or isolation binding failed");
  }
}

export function assertSafeReviewedAuthorization({
  authorization,
  preflightSha256,
  plan,
  nowTimestamp,
  allowExpired = false,
}) {
  if (
    authorization?.schemaVersion !== SAFE_AUTHORIZATION_SCHEMA ||
    authorization.status !== "REVIEWED_READY_FOR_EXPLICIT_SAFE_BROADCAST" ||
    authorization.signingAllowed !== true ||
    authorization.broadcastAllowed !== true ||
    authorization.preflightSha256 !== preflightSha256 ||
    authorization.source?.commit !== plan.source?.commit ||
    authorization.source?.tree !== plan.source?.tree ||
    authorization.policySha256 !== plan.policySha256 ||
    authorization.custodyProofSha256 !== plan.custodyProofSha256 ||
    getAddress(authorization.ownerAuthorizationAddress) !==
      getAddress(plan.releaseAuthorization?.owner) ||
    plan.releaseAuthorization?.maximumValiditySeconds !== 300 ||
    !Number.isSafeInteger(authorization.expiresAtTimestamp) ||
    (!allowExpired && authorization.expiresAtTimestamp < nowTimestamp) ||
    authorization.expiresAtTimestamp > plan.expiresAtTimestamp
  ) {
    throw new Error(
      "reviewed Safe broadcast authorization is stale or invalid",
    );
  }
  const expected = computeSafeReviewedPlanDigest({
    preflightSha256,
    ownerAuthorizationAddress: authorization.ownerAuthorizationAddress,
    expiresAtTimestamp: authorization.expiresAtTimestamp,
    sourceCommit: authorization.source.commit,
    sourceTree: authorization.source.tree,
    policySha256: authorization.policySha256,
    custodyProofSha256: authorization.custodyProofSha256,
  });
  if (authorization.reviewedPlanDigest !== expected) {
    throw new Error("reviewed Safe plan digest mismatch");
  }
  return expected;
}

export function assertSafeCustodyProof({ proof, owners, deployer, admin }) {
  const expectedRoles = SAFE_CUSTODY_ROLES;
  const expectedAddresses = [deployer, admin, ...owners].map((value) =>
    getAddress(value),
  );
  if (
    proof?.schemaVersion !== SAFE_CUSTODY_PROOF_SCHEMA ||
    proof.chainId !== "1" ||
    proof.keychain !== "current-user-default-login-keychain" ||
    proof.allReadbacksVerified !== true ||
    proof.allEvmAddressesRecovered !== true ||
    proof.roleIsolationBasis !==
      "SIX_DISTINCT_GENERIC_PASSWORD_ITEMS_WITH_DISTINCT_PRIVATE_KEY_HASHES_AND_PUBLIC_ADDRESSES" ||
    proof.secretValuesPrinted !== false ||
    proof.plaintextRetention !==
      "0400_TEMP_ORIGINALS_PRESERVED_PENDING_EXPLICIT_RETENTION_DECISION" ||
    !/^0x[0-9a-f]{64}$/u.test(proof.inventorySha256 ?? "") ||
    proof.roles?.length !== expectedRoles.length
  ) {
    throw new Error("Safe custody proof is invalid");
  }
  const publicAddresses = new Set();
  const privateKeyHashes = new Set();
  const persistentReferences = new Set();
  for (const [index, role] of expectedRoles.entries()) {
    const entry = proof.roles.find((candidate) => candidate.role === role);
    if (
      !entry ||
      getAddress(entry.publicAddress) !== expectedAddresses[index] ||
      getAddress(entry.recoveredPublicAddress) !== expectedAddresses[index] ||
      entry.evmAddressRecoveryVerified !== true ||
      entry.addressRecoveryBasis !==
        "KEYCHAIN_READBACK_SHA256_EQUALS_SOURCE_KEY_SHA256_AND_SOURCE_KEY_DERIVES_ADDRESS" ||
      entry.account !== entry.publicAddress ||
      entry.service !==
        `programmable.custom-registry.v2.production-custody.20260813.${role}` ||
      entry.sourceKeyFileSha256 !== entry.readbackSha256 ||
      !/^0x[0-9a-f]{64}$/u.test(entry.readbackSha256 ?? "") ||
      !/^0x[0-9a-f]{64}$/u.test(entry.persistentRefSha256 ?? "") ||
      entry.readbackByteLength !== 67 ||
      entry.sourcePrivateKeyFileMode !== "0400" ||
      entry.accessibility !== "when-unlocked-this-device-only" ||
      entry.synchronizable !== false ||
      !String(entry.result).endsWith("READBACK_VERIFIED")
    ) {
      throw new Error(`Safe custody proof is invalid for ${role}`);
    }
    publicAddresses.add(getAddress(entry.publicAddress).toLowerCase());
    privateKeyHashes.add(entry.readbackSha256);
    persistentReferences.add(entry.persistentRefSha256);
  }
  if (
    publicAddresses.size !== expectedRoles.length ||
    privateKeyHashes.size !== expectedRoles.length ||
    persistentReferences.size !== expectedRoles.length
  ) {
    throw new Error("Safe custody proof does not isolate every role");
  }
}

export function assertProxyCreationLog({ logs, factory, proxy, singleton }) {
  const matches = logs.filter(
    (log) => getAddress(log.address) === getAddress(factory),
  );
  if (matches.length !== 1)
    throw new Error("Safe receipt must contain one factory log");
  let decoded;
  try {
    decoded = decodeEventLog({
      abi: SAFE_FACTORY_ABI,
      data: matches[0].data,
      topics: matches[0].topics,
      eventName: "ProxyCreation",
      strict: true,
    });
  } catch {
    throw new Error("Safe ProxyCreation log is invalid");
  }
  if (
    decoded.eventName !== "ProxyCreation" ||
    getAddress(decoded.args.proxy) !== getAddress(proxy) ||
    getAddress(decoded.args.singleton) !== getAddress(singleton)
  ) {
    throw new Error("Safe ProxyCreation log does not match reviewed plan");
  }
}

export const SAFE_READ_ABI = [
  {
    type: "function",
    name: "VERSION",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
  {
    type: "function",
    name: "masterCopy",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "getOwners",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }],
  },
  {
    type: "function",
    name: "getThreshold",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getModulesPaginated",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "start" },
      { type: "uint256", name: "pageSize" },
    ],
    outputs: [
      { type: "address[]", name: "array" },
      { type: "address", name: "next" },
    ],
  },
  {
    type: "function",
    name: "getStorageAt",
    stateMutability: "view",
    inputs: [
      { type: "uint256", name: "offset" },
      { type: "uint256", name: "length" },
    ],
    outputs: [{ type: "bytes", name: "" }],
  },
];

export function safeInitializer(owner, setup) {
  return encodeFunctionData({
    abi: SAFE_SETUP_ABI,
    functionName: "setup",
    args: [
      [getAddress(owner)],
      BigInt(setup.threshold),
      getAddress(setup.to),
      setup.data,
      getAddress(setup.fallbackHandler),
      getAddress(setup.paymentToken),
      BigInt(setup.payment),
      getAddress(setup.paymentReceiver),
    ],
  });
}

export function predictSafeProxyAddress({
  factory,
  singleton,
  proxyCreationCode,
  initializer,
  saltNonce,
}) {
  const salt = keccak256(
    encodePacked(
      ["bytes32", "uint256"],
      [keccak256(initializer), BigInt(saltNonce)],
    ),
  );
  const bytecodeHash = keccak256(
    concatHex([proxyCreationCode, padHex(getAddress(singleton), { size: 32 })]),
  );
  return getCreate2Address({ from: getAddress(factory), salt, bytecodeHash });
}

export function assertDistinctControllerOwners({
  deployer,
  admin,
  releaseOwner,
  owners,
}) {
  const addresses = [deployer, admin, releaseOwner, ...owners].map((value) =>
    getAddress(value).toLowerCase(),
  );
  if (new Set(addresses).size !== addresses.length) {
    throw new Error(
      "deployer, admin, release owner, and Safe owners must be distinct",
    );
  }
}

export function assertSafeRuntimeState({ actual, expected }) {
  if (
    actual.version !== expected.version ||
    getAddress(actual.masterCopy) !== getAddress(expected.singleton) ||
    actual.owners.length !== 1 ||
    getAddress(actual.owners[0]) !== getAddress(expected.owner) ||
    actual.threshold !== 1n ||
    actual.modules.length !== 0 ||
    getAddress(actual.nextModule) !==
      getAddress("0x0000000000000000000000000000000000000001") ||
    !/^0x0{64}$/u.test(actual.fallbackStorage) ||
    !/^0x0{64}$/u.test(actual.guardStorage)
  )
    throw new Error("Safe controller post-deployment state is invalid");
}
