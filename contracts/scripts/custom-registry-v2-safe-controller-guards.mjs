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
    !Number.isSafeInteger(plan.expiresAtTimestamp) ||
    (!allowExpired && plan.expiresAtTimestamp < nowTimestamp) ||
    plan.controllers?.length !== 4 ||
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
    !Number.isSafeInteger(plan.expiresAtTimestamp) ||
    plan.controllers?.length !== 4 ||
    !/^0x[0-9a-f]{64}$/u.test(plan.policySha256 ?? "") ||
    !/^0x[0-9a-f]{64}$/u.test(plan.custodyProofSha256 ?? "")
  ) {
    throw new Error("Safe unfunded cost-review plan is invalid");
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
  const expectedRoles = [
    "deployer",
    "admin",
    "approver",
    "registrar",
    "finalizer",
    "revoker",
  ];
  const expectedAddresses = [deployer, admin, ...owners].map((value) =>
    getAddress(value),
  );
  if (
    proof?.schemaVersion !==
      "programmable.custom-registry-v2-keychain-custody-proof.v1" ||
    proof.chainId !== "1" ||
    proof.allReadbacksVerified !== true ||
    proof.secretValuesPrinted !== false ||
    proof.plaintextRetention !==
      "0400_TEMP_ORIGINALS_PRESERVED_PENDING_EXPLICIT_RETENTION_DECISION" ||
    proof.roles?.length !== expectedRoles.length
  ) {
    throw new Error("Safe custody proof is invalid");
  }
  for (const [index, role] of expectedRoles.entries()) {
    const entry = proof.roles.find((candidate) => candidate.role === role);
    if (
      !entry ||
      getAddress(entry.publicAddress) !== expectedAddresses[index] ||
      entry.account !== entry.publicAddress ||
      entry.service !==
        `programmable.custom-registry.v2.production-custody.20260813.${role}` ||
      entry.sourceKeyFileSha256 !== entry.readbackSha256 ||
      !/^0x[0-9a-f]{64}$/u.test(entry.readbackSha256 ?? "") ||
      entry.readbackByteLength !== 67 ||
      entry.accessibility !== "when-unlocked-this-device-only" ||
      entry.synchronizable !== false ||
      !String(entry.result).endsWith("READBACK_VERIFIED")
    ) {
      throw new Error(`Safe custody proof is invalid for ${role}`);
    }
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
