import path from "node:path";

import {
  concatHex,
  decodeEventLog,
  encodePacked,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  hexToBigInt,
  keccak256,
  padHex,
  recoverTypedDataAddress,
  toHex,
} from "viem";

import { AUTHORIZATION_SEMANTICS } from "./custom-registry-v2-deployment-guards.mjs";
import { assertTrustedTimeEvidence } from "./custom-registry-v2-transaction-journal.mjs";

export const SAFE_PUBLIC_MIGRATION_POLICY_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-policy.v2";
export const SAFE_PUBLIC_MIGRATION_INVENTORY_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-inventory.v1";
export const SAFE_PUBLIC_MIGRATION_PLAN_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-plan.v2";
export const SAFE_PUBLIC_MIGRATION_RECEIPTS_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-receipts.v2";
export const SAFE_PUBLIC_MIGRATION_VERIFICATION_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-verification.v2";
export const SAFE_PUBLIC_MIGRATION_PROGRESS_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-progress.v1";
export const SAFE_PUBLIC_MIGRATION_CONTINUATION_SCHEMA =
  "programmable.custom-registry-v2-safe-public-migration-continuation.v1";
export const SAFE_PUBLIC_MIGRATION_ROLES = Object.freeze([
  "approver",
  "registrar",
  "finalizer",
  "revoker",
]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SAFE_TX_TYPEHASH =
  "0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8";
const DOMAIN_SEPARATOR_TYPEHASH =
  "0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218";
const PINNED_SAFE_SOURCE = Object.freeze({
  repository: "safe-fndn/safe-smart-account",
  tag: "v1.4.1",
  commit: "bf943f80fec5ac647159d26161446ac5d716a294",
  tree: "dbbe8faa94445342975303ff4da1471cac2052d6",
});
const PINNED_MULTISEND_CALL_ONLY = Object.freeze({
  address: "0x9641d764fc13c8B624c04430C7356C1C7C8102e2",
  runtimeCodeKeccak256:
    "0xecd5bd14a08c5d2122379900b2f272bdf107a7e92423c10dd5fe3254386c9939",
  sourcePath: "contracts/libraries/MultiSendCallOnly.sol",
  sourceBlob: "7399f11911d80b1c46ecab5408aad7cb66c7f43a",
  sourceSha256:
    "0x2ff7f7fd09ba1967524d9bd9507cb7528253ea3d401feaf8d0428e20109f8919",
});

export function assertSafePublicMigrationReleaseAuthorization({
  actual,
  expected,
  releaseOwner,
}) {
  if (
    getAddress(actual?.owner) !== getAddress(releaseOwner) ||
    getAddress(expected?.owner) !== getAddress(releaseOwner) ||
    actual.maximumDispatchIntentAuthorizationValiditySeconds !== 300 ||
    expected.maximumDispatchIntentAuthorizationValiditySeconds !== 300 ||
    actual.authorizationSemantics !== AUTHORIZATION_SEMANTICS ||
    expected.authorizationSemantics !== AUTHORIZATION_SEMANTICS ||
    actual.stagedRawTransactionTrustBoundary !==
      "OWNER_ONLY_0400_CURRENT_USER_TEMPORARY_PUBLIC_ONE_OF_ONE_CUSTODY_WORKFLOW_NOT_AN_ONCHAIN_OWNER_GATE" ||
    actual.stagedRawTransactionTrustBoundary !==
      expected.stagedRawTransactionTrustBoundary ||
    actual.dispatchIntentFinalConfirmation !==
      "EXPLICIT_EXACT_TRANSACTION_HASH_REQUIRED_IMMEDIATELY_BEFORE_DURABLE_ACTIVATION" ||
    actual.dispatchIntentFinalConfirmation !==
      expected.dispatchIntentFinalConfirmation ||
    actual.nonceScopedJournalExclusivity !==
      "ONE_CANONICAL_CHAIN_SIGNER_NONCE_JOURNAL_BLOCKS_CHANGED_TRANSACTION_UNTIL_NONCE_IS_CANONICALLY_CONSUMED" ||
    actual.nonceScopedJournalExclusivity !==
      expected.nonceScopedJournalExclusivity
  ) {
    throw new Error("Safe public migration release authorization is invalid");
  }
  return true;
}

export const SAFE_PUBLIC_MIGRATION_ABI = [
  {
    type: "function",
    name: "addOwnerWithThreshold",
    stateMutability: "nonpayable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "_threshold", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "swapOwner",
    stateMutability: "nonpayable",
    inputs: [
      { name: "prevOwner", type: "address" },
      { name: "oldOwner", type: "address" },
      { name: "newOwner", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "execTransaction",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [{ name: "success", type: "bool" }],
  },
  {
    type: "function",
    name: "getTransactionHash",
    stateMutability: "view",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "_nonce", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function",
    name: "checkSignatures",
    stateMutability: "view",
    inputs: [
      { name: "dataHash", type: "bytes32" },
      { name: "data", type: "bytes" },
      { name: "signatures", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "AddedOwner",
    inputs: [{ indexed: true, name: "owner", type: "address" }],
  },
  {
    type: "event",
    name: "RemovedOwner",
    inputs: [{ indexed: true, name: "owner", type: "address" }],
  },
  {
    type: "event",
    name: "ChangedThreshold",
    inputs: [{ indexed: false, name: "threshold", type: "uint256" }],
  },
  {
    type: "event",
    name: "ExecutionSuccess",
    inputs: [
      { indexed: true, name: "txHash", type: "bytes32" },
      { indexed: false, name: "payment", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "ExecutionFailure",
    inputs: [
      { indexed: true, name: "txHash", type: "bytes32" },
      { indexed: false, name: "payment", type: "uint256" },
    ],
  },
];

const MULTISEND_ABI = [
  {
    type: "function",
    name: "multiSend",
    stateMutability: "payable",
    inputs: [{ name: "transactions", type: "bytes" }],
    outputs: [],
  },
];

export function assertSafePublicMigrationPolicy(policy) {
  if (
    policy?.schemaVersion !== SAFE_PUBLIC_MIGRATION_POLICY_SCHEMA ||
    policy.chainId !== "1" ||
    policy.safeVersion !== "1.4.1" ||
    JSON.stringify(policy.source) !== JSON.stringify(PINNED_SAFE_SOURCE) ||
    JSON.stringify(policy.multiSendCallOnly) !==
      JSON.stringify(PINNED_MULTISEND_CALL_ONLY) ||
    JSON.stringify(policy.roles) !== JSON.stringify(SAFE_PUBLIC_MIGRATION_ROLES) ||
    policy.migration?.transactions !== 4 ||
    policy.migration?.oneDirectCurrentOwnerTransactionPerSafe !== true ||
    policy.migration?.safeOperation !== "DELEGATECALL" ||
    policy.migration?.atomicPerSafe !== true ||
    policy.migration?.crossSafeAtomicityRequired !== false ||
    policy.migration?.partialProgressFailClosedUntilAggregateVerification !== true ||
    policy.migration?.partialProgressClassification !==
      "EXACT_LEGACY_ONE_OF_ONE_OR_EXACT_MIGRATED_HARDWARE_TWO_OF_THREE_OTHERWISE_INVALID" ||
    policy.migration?.continuation !==
      "FRESH_PLAN_AUTHORIZES_ONLY_REMAINING_LEGACY_SAFES_AND_BINDS_FINALIZED_COMPLETED_RECEIPTS_AUTHORIZATIONS_AND_JOURNALS" ||
    policy.migration?.expiredPlanBehavior !==
      "STOP_WITH_COMPLETED_SAFES_SAFE_AND_RESUME_ONLY_REMAINING_SAFES_UNDER_FRESH_AUTHORIZATION" ||
    policy.migration?.safeTxGas !== "0" ||
    policy.migration?.baseGas !== "0" ||
    policy.migration?.gasPrice !== "0" ||
    getAddress(policy.migration?.gasToken) !== ZERO_ADDRESS ||
    getAddress(policy.migration?.refundReceiver) !== ZERO_ADDRESS ||
    policy.migration?.executorBinding !==
      "CURRENT_OWNER_DIRECT_PREVALIDATED_SIGNATURE_V1" ||
    JSON.stringify(policy.migration?.innerOperations) !==
      JSON.stringify([
        "addOwnerWithThreshold(H1,1)",
        "addOwnerWithThreshold(H2,2)",
        "swapOwner(H1,legacy,H3)",
      ]) ||
    policy.finalState?.ownersPerSafe !== 3 ||
    policy.finalState?.threshold !== 2 ||
    policy.finalState?.hardwareOwnersPerSafe !== 3 ||
    policy.finalState?.hardwareOwnersGloballyDistinct !== true ||
    policy.finalState?.legacyKeychainOwnerRemoved !== true ||
    JSON.stringify(policy.finalState?.expectedOwnerOrder) !==
      JSON.stringify(["H2", "H1", "H3"]) ||
    JSON.stringify(policy.finalState?.modules) !== JSON.stringify([]) ||
    getAddress(policy.finalState?.fallbackHandler) !== ZERO_ADDRESS ||
    getAddress(policy.finalState?.guard) !== ZERO_ADDRESS ||
    policy.finalState?.safeNonceDelta !== 1 ||
    policy.hardwareProof?.requiredOwners !== 12 ||
    policy.hardwareProof?.eip712ControlProofPerOwner !== true ||
    policy.hardwareProof?.dualHardwareSignaturePostMigrationEthCallRequired !== true ||
    policy.hardwareProof?.deviceDisplayAndIndependentCustodyAttestationRequired !== true ||
    policy.hardwareProof?.physicalIndependenceIsOperationalEvidence !== true ||
    policy.activationAllowedBeforeAggregateFinalizedVerification !== false ||
    policy.status !== "POLICY_ONLY_NO_HARDWARE_KEYS_NO_TRANSACTION_AUTHORIZATION"
  ) {
    throw new Error("Safe public migration policy is invalid");
  }
  return policy;
}

function packedCall(to, data) {
  return concatHex([
    toHex(0, { size: 1 }),
    getAddress(to),
    toHex(0n, { size: 32 }),
    toHex(BigInt((data.length - 2) / 2), { size: 32 }),
    data,
  ]);
}

export function safePublicMigrationBatch({
  safe,
  legacyOwner,
  hardwareOwners,
}) {
  const safeAddress = getAddress(safe);
  const legacy = getAddress(legacyOwner);
  const hardware = hardwareOwners.map((value) => getAddress(value));
  if (
    hardware.length !== 3 ||
    new Set([legacy, ...hardware].map((value) => value.toLowerCase())).size !== 4 ||
    [safeAddress, ZERO_ADDRESS].some((forbidden) =>
      hardware.some(
        (owner) => owner.toLowerCase() === forbidden.toLowerCase(),
      ),
    )
  ) {
    throw new Error("Safe hardware owner migration identities are invalid");
  }
  const [h1, h2, h3] = hardware;
  const calls = [
    encodeFunctionData({
      abi: SAFE_PUBLIC_MIGRATION_ABI,
      functionName: "addOwnerWithThreshold",
      args: [h1, 1n],
    }),
    encodeFunctionData({
      abi: SAFE_PUBLIC_MIGRATION_ABI,
      functionName: "addOwnerWithThreshold",
      args: [h2, 2n],
    }),
    encodeFunctionData({
      abi: SAFE_PUBLIC_MIGRATION_ABI,
      functionName: "swapOwner",
      args: [h1, legacy, h3],
    }),
  ];
  return {
    innerTransactions: concatHex(calls.map((data) => packedCall(safeAddress, data))),
    calls,
    expectedOwners: [h2, h1, h3],
  };
}

export function prevalidatedOwnerSignature(owner) {
  return concatHex([
    padHex(getAddress(owner), { size: 32 }),
    toHex(0n, { size: 32 }),
    toHex(1, { size: 1 }),
  ]);
}

export function safePublicMigrationTransaction({
  safe,
  legacyOwner,
  hardwareOwners,
  safeNonce,
  multiSendCallOnly,
}) {
  const batch = safePublicMigrationBatch({ safe, legacyOwner, hardwareOwners });
  const multiSendData = encodeFunctionData({
    abi: MULTISEND_ABI,
    functionName: "multiSend",
    args: [batch.innerTransactions],
  });
  const safeTransaction = {
    to: getAddress(multiSendCallOnly),
    value: 0n,
    data: multiSendData,
    operation: 1,
    safeTxGas: 0n,
    baseGas: 0n,
    gasPrice: 0n,
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
    nonce: BigInt(safeNonce),
  };
  const execTransactionData = encodeFunctionData({
    abi: SAFE_PUBLIC_MIGRATION_ABI,
    functionName: "execTransaction",
    args: [
      safeTransaction.to,
      safeTransaction.value,
      safeTransaction.data,
      safeTransaction.operation,
      safeTransaction.safeTxGas,
      safeTransaction.baseGas,
      safeTransaction.gasPrice,
      safeTransaction.gasToken,
      safeTransaction.refundReceiver,
      prevalidatedOwnerSignature(legacyOwner),
    ],
  });
  return { ...batch, safeTransaction, execTransactionData };
}

export function safeTransactionHash({ safe, chainId = 1n, transaction }) {
  const domainSeparator = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
      ],
      [DOMAIN_SEPARATOR_TYPEHASH, BigInt(chainId), getAddress(safe)],
    ),
  );
  const structHash = keccak256(
    encodeAbiParameters(
      [
        { type: "bytes32" },
        { type: "address" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "address" },
        { type: "address" },
        { type: "uint256" },
      ],
      [
        SAFE_TX_TYPEHASH,
        transaction.to,
        transaction.value,
        keccak256(transaction.data),
        transaction.operation,
        transaction.safeTxGas,
        transaction.baseGas,
        transaction.gasPrice,
        transaction.gasToken,
        transaction.refundReceiver,
        transaction.nonce,
      ],
    ),
  );
  return keccak256(concatHex(["0x1901", domainSeparator, structHash]));
}

const hardwareProofTypes = {
  HardwareOwnerControl: [
    { name: "role", type: "string" },
    { name: "safe", type: "address" },
    { name: "hardwareOwner", type: "address" },
    { name: "ownerIndex", type: "uint8" },
    { name: "migrationPlanDigest", type: "bytes32" },
    { name: "sourceCommit", type: "string" },
    { name: "sourceTree", type: "string" },
    { name: "challenge", type: "bytes32" },
    { name: "notBeforeTimestamp", type: "uint64" },
    { name: "expiresAtTimestamp", type: "uint64" },
  ],
};

const hardwareThresholdProofTypes = {
  HardwareSafeThresholdControl: [
    { name: "role", type: "string" },
    { name: "safe", type: "address" },
    { name: "migrationPlanDigest", type: "bytes32" },
    { name: "hardwareOwnerSetHash", type: "bytes32" },
    { name: "sourceCommit", type: "string" },
    { name: "sourceTree", type: "string" },
    { name: "challenge", type: "bytes32" },
    { name: "notBeforeTimestamp", type: "uint64" },
    { name: "expiresAtTimestamp", type: "uint64" },
  ],
};

const SECP256K1_HALF_ORDER =
  0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n;

export function assertCanonicalDirectTypedDataSignature(signature) {
  if (!/^0x[0-9a-fA-F]{130}$/u.test(signature ?? "")) {
    throw new Error("hardware proof signature must be exactly 65 bytes");
  }
  const v = Number.parseInt(signature.slice(-2), 16);
  const s = hexToBigInt(`0x${signature.slice(66, 130)}`);
  if ((v !== 27 && v !== 28) || s === 0n || s > SECP256K1_HALF_ORDER) {
    throw new Error("hardware proof signature must be canonical low-s v27/v28");
  }
  return signature;
}

export function hardwareOwnerControlTypedData({ proof, migrationPlanDigest, source }) {
  return {
    domain: {
      name: "Programmable Custom Registry V2 Hardware Owner Proof",
      version: "1",
      chainId: 1,
      verifyingContract: getAddress(proof.safe),
    },
    types: hardwareProofTypes,
    primaryType: "HardwareOwnerControl",
    message: {
      role: proof.role,
      safe: getAddress(proof.safe),
      hardwareOwner: getAddress(proof.hardwareOwner),
      ownerIndex: proof.ownerIndex,
      migrationPlanDigest,
      sourceCommit: source.commit,
      sourceTree: source.tree,
      challenge: proof.challenge,
      notBeforeTimestamp: BigInt(proof.notBeforeTimestamp),
      expiresAtTimestamp: BigInt(proof.expiresAtTimestamp),
    },
  };
}

function assertTrustedIntervalInsideProofWindow({
  trustedTime,
  notBeforeTimestamp,
  expiresAtTimestamp,
}) {
  assertTrustedTimeEvidence(trustedTime, trustedTime?.adjustedTimestamp);
  if (
    trustedTime.adjustedTimeMilliseconds -
        trustedTime.uncertaintyMilliseconds <
      notBeforeTimestamp * 1000 ||
    trustedTime.adjustedTimeMilliseconds +
        trustedTime.uncertaintyMilliseconds >=
      expiresAtTimestamp * 1000
  ) {
    throw new Error("trusted time interval is outside hardware proof window");
  }
}

export function assertSafePublicMigrationReceiptTime({
  receiptBlockTimestamp,
  plan,
}) {
  if (
    typeof receiptBlockTimestamp !== "bigint" ||
    !Number.isSafeInteger(plan?.createdAtTimestamp) ||
    !Number.isSafeInteger(plan?.expiresAtTimestamp) ||
    plan.expiresAtTimestamp - plan.createdAtTimestamp !== 600 ||
    !Number.isSafeInteger(plan?.hardwareProofWindow?.notBeforeTimestamp) ||
    !Number.isSafeInteger(plan?.hardwareProofWindow?.expiresAtTimestamp)
  ) {
    throw new Error("hardware migration plan or receipt time is invalid");
  }
  assertTrustedTimeEvidence(
    plan.createdAtTrustedTime,
    plan.createdAtTimestamp,
  );
  const receiptMilliseconds = receiptBlockTimestamp * 1000n;
  const reviewedUpperBoundMilliseconds = BigInt(
    plan.createdAtTrustedTime.adjustedTimeMilliseconds +
      plan.createdAtTrustedTime.uncertaintyMilliseconds,
  );
  if (
    receiptMilliseconds <= reviewedUpperBoundMilliseconds ||
    plan.createdAtTimestamp < plan.hardwareProofWindow.notBeforeTimestamp ||
    plan.createdAtTimestamp >= plan.hardwareProofWindow.expiresAtTimestamp ||
    plan.expiresAtTimestamp > plan.hardwareProofWindow.expiresAtTimestamp
  ) {
    throw new Error(
      "finalized hardware migration receipt did not follow reviewed plan activation",
    );
  }
  return true;
}

export function classifySafePublicMigrationState({
  actual,
  expected,
}) {
  const expectedMigratedOwners = safePublicMigrationBatch({
    safe: expected.safe,
    legacyOwner: expected.legacyOwner,
    hardwareOwners: expected.hardwareOwners,
  }).expectedOwners.map((value) => getAddress(value));
  const owners = actual?.owners?.map((value) => getAddress(value)) ?? [];
  if (
    actual?.runtimeCodeKeccak256 !== expected.proxyRuntimeCodeKeccak256 ||
    actual.version !== expected.safeVersion ||
    getAddress(actual.masterCopy) !== getAddress(expected.singleton) ||
    actual.modules?.length !== 0 ||
    getAddress(actual.nextModule) !==
      "0x0000000000000000000000000000000000000001" ||
    !/^0x0{64}$/u.test(actual.fallbackStorage ?? "") ||
    !/^0x0{64}$/u.test(actual.guardStorage ?? "")
  ) {
    throw new Error("Safe public migration state has invalid runtime or protections");
  }
  if (
    owners.length === 1 &&
    owners[0] === getAddress(expected.legacyOwner) &&
    actual.threshold === 1n &&
    actual.safeNonce === 0n
  ) {
    return "LEGACY_ONE_OF_ONE_PENDING";
  }
  if (
    JSON.stringify(owners) === JSON.stringify(expectedMigratedOwners) &&
    actual.threshold === 2n &&
    actual.safeNonce === 1n
  ) {
    return "MIGRATED_HARDWARE_TWO_OF_THREE_FINALIZED";
  }
  throw new Error("Safe public migration state is neither exact legacy nor migrated state");
}

export function assertSafePublicMigrationContinuationEvidence({
  evidence,
  migrationPlanDigest,
  migratedRoles,
}) {
  const migrated = new Set(migratedRoles);
  if (
    evidence?.schemaVersion !== SAFE_PUBLIC_MIGRATION_CONTINUATION_SCHEMA ||
    evidence.chainId !== 1 ||
    evidence.migrationPlanDigest !== migrationPlanDigest ||
    evidence.status !== "FINALIZED_PARTIAL_MIGRATIONS_BOUND_FOR_CONTINUATION" ||
    evidence.transactions?.length !== migrated.size
  ) {
    throw new Error("Safe public migration continuation evidence is invalid");
  }
  const byRole = new Map();
  for (const entry of evidence.transactions) {
    if (
      !migrated.has(entry?.role) ||
      byRole.has(entry.role) ||
      !/^0x[0-9a-fA-F]{64}$/u.test(entry.transactionHash ?? "") ||
      !/^0x[0-9a-f]{64}$/u.test(entry.sourcePlanSha256 ?? "") ||
      !/^0x[0-9a-f]{64}$/u.test(entry.ownerAuthorizationSha256 ?? "") ||
      !/^0x[0-9a-f]{64}$/u.test(entry.transactionJournalSha256 ?? "") ||
      !/^0x[0-9a-f]{64}$/u.test(entry.receiptEvidenceSha256 ?? "") ||
      !path.isAbsolute(entry.executionBundlePath ?? "") ||
      !/^0x[0-9a-f]{64}$/u.test(entry.executionBundleSha256 ?? "") ||
      !/^(0|[1-9][0-9]*)$/u.test(entry.blockNumber ?? "") ||
      !/^0x[0-9a-fA-F]{64}$/u.test(entry.blockHash ?? "") ||
      !/^0x[0-9a-fA-F]+$/u.test(entry.reviewedTransaction?.input ?? "") ||
      !Number.isSafeInteger(entry.reviewedTransaction?.nonce) ||
      entry.reviewedTransaction.nonce < 0 ||
      !/^[1-9][0-9]*$/u.test(entry.reviewedTransaction?.gasLimit ?? "") ||
      !/^[1-9][0-9]*$/u.test(entry.reviewedTransaction?.maxFeePerGas ?? "") ||
      !/^[1-9][0-9]*$/u.test(
        entry.reviewedTransaction?.maxPriorityFeePerGas ?? "",
      ) ||
      !Number.isSafeInteger(entry.sourcePlanWindow?.createdAtTimestamp) ||
      !Number.isSafeInteger(entry.sourcePlanWindow?.expiresAtTimestamp) ||
      entry.sourcePlanWindow.expiresAtTimestamp -
          entry.sourcePlanWindow.createdAtTimestamp !==
        600 ||
      !Number.isSafeInteger(
        entry.sourcePlanWindow?.createdAtTrustedTime?.adjustedTimestamp,
      ) ||
      entry.sourcePlanWindow.createdAtTrustedTime.adjustedTimestamp !==
        entry.sourcePlanWindow.createdAtTimestamp ||
      !Number.isSafeInteger(entry.receiptBlockTimestamp)
    ) {
      throw new Error("Safe public migration continuation transaction is invalid");
    }
    byRole.set(entry.role, entry);
  }
  if ([...migrated].some((role) => !byRole.has(role))) {
    throw new Error("Safe public migration continuation role set is incomplete");
  }
  return byRole;
}

export function hardwareThresholdControlTypedData({
  proof,
  migrationPlanDigest,
  source,
}) {
  return {
    domain: {
      name: "Programmable Custom Registry V2 Hardware Threshold Proof",
      version: "1",
      chainId: 1,
      verifyingContract: getAddress(proof.safe),
    },
    types: hardwareThresholdProofTypes,
    primaryType: "HardwareSafeThresholdControl",
    message: {
      role: proof.role,
      safe: getAddress(proof.safe),
      migrationPlanDigest,
      hardwareOwnerSetHash: proof.hardwareOwnerSetHash,
      sourceCommit: source.commit,
      sourceTree: source.tree,
      challenge: proof.challenge,
      notBeforeTimestamp: BigInt(proof.notBeforeTimestamp),
      expiresAtTimestamp: BigInt(proof.expiresAtTimestamp),
    },
  };
}

export async function assertHardwareOwnerControlProof({
  proof,
  migrationPlanDigest,
  source,
  nowTimestamp,
  trustedTime,
}) {
  if (
    !SAFE_PUBLIC_MIGRATION_ROLES.includes(proof?.role) ||
    proof.ownerIndex < 0 ||
    proof.ownerIndex > 2 ||
    proof.migrationPlanDigest !== migrationPlanDigest ||
    proof.sourceCommit !== source.commit ||
    proof.sourceTree !== source.tree ||
    !/^0x[0-9a-fA-F]{64}$/u.test(proof.challenge ?? "") ||
    !Number.isSafeInteger(proof.notBeforeTimestamp) ||
    !Number.isSafeInteger(proof.expiresAtTimestamp) ||
    nowTimestamp < proof.notBeforeTimestamp ||
    nowTimestamp >= proof.expiresAtTimestamp ||
    proof.expiresAtTimestamp - proof.notBeforeTimestamp > 86_400 ||
    proof.deviceDisplayVerified !== true ||
    proof.independentCustodianAttested !== true ||
    proof.independentSeedAndBackupAttested !== true
  ) {
    throw new Error("hardware owner control proof is invalid or stale");
  }
  assertTrustedIntervalInsideProofWindow({
    trustedTime,
    notBeforeTimestamp: proof.notBeforeTimestamp,
    expiresAtTimestamp: proof.expiresAtTimestamp,
  });
  const address = getAddress(proof.hardwareOwner);
  assertCanonicalDirectTypedDataSignature(proof.signature);
  const recovered = await recoverTypedDataAddress({
    ...hardwareOwnerControlTypedData({ proof, migrationPlanDigest, source }),
    signature: proof.signature,
  });
  if (getAddress(recovered) !== address) {
    throw new Error("hardware owner control signature does not recover owner");
  }
  return address;
}

export function hardwareOwnerSetHash(hardwareOwners) {
  if (hardwareOwners?.length !== 3) {
    throw new Error("hardware owner set must contain exactly three owners");
  }
  return keccak256(
    encodePacked(
      ["address", "address", "address"],
      hardwareOwners.map((value) => getAddress(value)),
    ),
  );
}

export async function assertHardwareThresholdControlProof({
  proof,
  role,
  safe,
  hardwareOwners,
  migrationPlanDigest,
  source,
  nowTimestamp,
  trustedTime,
}) {
  const expectedOwnerSetHash = hardwareOwnerSetHash(hardwareOwners);
  if (
    proof?.role !== role ||
    getAddress(proof.safe) !== getAddress(safe) ||
    proof.migrationPlanDigest !== migrationPlanDigest ||
    proof.hardwareOwnerSetHash !== expectedOwnerSetHash ||
    !/^0x[0-9a-fA-F]{64}$/u.test(proof.challenge ?? "") ||
    !Number.isSafeInteger(proof.notBeforeTimestamp) ||
    !Number.isSafeInteger(proof.expiresAtTimestamp) ||
    nowTimestamp < proof.notBeforeTimestamp ||
    nowTimestamp >= proof.expiresAtTimestamp ||
    proof.expiresAtTimestamp - proof.notBeforeTimestamp > 86_400 ||
    proof.signatures?.length !== 3
  ) {
    throw new Error(`${role} hardware threshold control proof is invalid or stale`);
  }
  assertTrustedIntervalInsideProofWindow({
    trustedTime,
    notBeforeTimestamp: proof.notBeforeTimestamp,
    expiresAtTimestamp: proof.expiresAtTimestamp,
  });
  const typedData = hardwareThresholdControlTypedData({
    proof,
    migrationPlanDigest,
    source,
  });
  const expected = hardwareOwners.map((value) => getAddress(value));
  const recovered = [];
  for (const [index, entry] of proof.signatures.entries()) {
    if (getAddress(entry.hardwareOwner) !== expected[index]) {
      throw new Error(`${role} threshold signature order is invalid`);
    }
    assertCanonicalDirectTypedDataSignature(entry.signature);
    const signer = await recoverTypedDataAddress({
      ...typedData,
      signature: entry.signature,
    });
    if (getAddress(signer) !== expected[index]) {
      throw new Error(`${role} threshold signature does not recover owner`);
    }
    recovered.push({ owner: expected[index], signature: entry.signature });
  }
  return {
    dataHash: hashTypedData(typedData),
    signatures: recovered,
  };
}

export function sortedSafeSignatures(entries) {
  if (entries?.length < 2) {
    throw new Error("at least two hardware signatures are required");
  }
  const sorted = [...entries].sort((left, right) =>
    BigInt(left.owner) < BigInt(right.owner) ? -1 : 1,
  );
  return concatHex(
    sorted.map(({ signature }) =>
      assertCanonicalDirectTypedDataSignature(signature),
    ),
  );
}

export function assertSafePublicMigrationReceiptLogs({
  logs,
  safe,
  legacyOwner,
  hardwareOwners,
  safeTransactionHash: expectedSafeTransactionHash,
}) {
  if (logs?.length !== 6) {
    throw new Error("Safe public migration receipt must contain exactly six logs");
  }
  const [h1, h2, h3] = hardwareOwners.map((value) => getAddress(value));
  const expected = [
    ["AddedOwner", { owner: h1 }],
    ["AddedOwner", { owner: h2 }],
    ["ChangedThreshold", { threshold: 2n }],
    ["RemovedOwner", { owner: getAddress(legacyOwner) }],
    ["AddedOwner", { owner: h3 }],
    [
      "ExecutionSuccess",
      { txHash: expectedSafeTransactionHash, payment: 0n },
    ],
  ];
  for (const [index, log] of logs.entries()) {
    if (getAddress(log.address) !== getAddress(safe)) {
      throw new Error("Safe public migration log emitter is invalid");
    }
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: SAFE_PUBLIC_MIGRATION_ABI,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
    } catch {
      throw new Error("Safe public migration receipt contains an unknown log");
    }
    const [eventName, args] = expected[index];
    if (
      decoded.eventName !== eventName ||
      Object.entries(args).some(([key, value]) => {
        const actual = decoded.args[key];
        return typeof value === "string"
          ? actual !== value
          : BigInt(actual) !== value;
      })
    ) {
      throw new Error("Safe public migration log sequence or arguments differ");
    }
  }
  return true;
}

export function safePublicMigrationIntentDigest({
  source,
  darkSafeVerificationSha256,
  policySha256,
  roles,
}) {
  if (
    !/^[0-9a-f]{40}$/u.test(source?.commit ?? "") ||
    !/^[0-9a-f]{40}$/u.test(source?.tree ?? "") ||
    !/^0x[0-9a-f]{64}$/u.test(darkSafeVerificationSha256 ?? "") ||
    !/^0x[0-9a-f]{64}$/u.test(policySha256 ?? "") ||
    roles?.length !== SAFE_PUBLIC_MIGRATION_ROLES.length
  ) {
    throw new Error("hardware migration intent inputs are invalid");
  }
  const packedRoles = concatHex(
    roles.map((entry, index) => {
      if (
        entry.role !== SAFE_PUBLIC_MIGRATION_ROLES[index] ||
        entry.hardwareOwners?.length !== 3
      ) {
        throw new Error("hardware migration role order is invalid");
      }
      return encodePacked(
        ["string", "address", "address", "address", "address", "address"],
        [
          entry.role,
          getAddress(entry.safe),
          getAddress(entry.legacyOwner),
          ...entry.hardwareOwners.map((value) => getAddress(value)),
        ],
      );
    }),
  );
  return keccak256(
    encodePacked(
      ["string", "string", "string", "bytes32", "bytes32", "bytes32"],
      [
        "programmable.custom-registry-v2.safe-public-migration.intent.v1",
        source.commit,
        source.tree,
        darkSafeVerificationSha256,
        policySha256,
        keccak256(packedRoles),
      ],
    ),
  );
}

export async function assertHardwareMigrationInventory({
  inventory,
  darkSafeVerification,
  darkSafeVerificationSha256,
  policySha256,
  forbiddenAddresses,
  nowTimestamp,
  trustedTime,
}) {
  if (
    inventory?.schemaVersion !== SAFE_PUBLIC_MIGRATION_INVENTORY_SCHEMA ||
    inventory.chainId !== 1 ||
    inventory.source?.commit !== darkSafeVerification.source?.commit ||
    inventory.source?.tree !== darkSafeVerification.source?.tree ||
    inventory.darkSafeVerificationSha256 !== darkSafeVerificationSha256 ||
    inventory.policySha256 !== policySha256 ||
    inventory.roles?.length !== SAFE_PUBLIC_MIGRATION_ROLES.length ||
    inventory.physicalCustodyEvidenceIsOperational !== true ||
    inventory.allDeviceDisplaysVerified !== true ||
    inventory.allCustodiansIndependentPerRole !== true ||
    inventory.allSeedsAndBackupsIndependentPerRole !== true ||
    inventory.status !== "TWELVE_HARDWARE_OWNER_CONTROL_PROOFS_READY_FOR_PREFLIGHT"
  ) {
    throw new Error("hardware migration inventory is invalid");
  }
  const intentRoles = inventory.roles.map((entry) => ({
    role: entry.role,
    safe: entry.safe,
    legacyOwner: entry.legacyOwner,
    hardwareOwners: entry.hardwareOwners.map(({ address }) => address),
  }));
  const migrationPlanDigest = safePublicMigrationIntentDigest({
    source: inventory.source,
    darkSafeVerificationSha256,
    policySha256,
    roles: intentRoles,
  });
  if (inventory.migrationPlanDigest !== migrationPlanDigest) {
    throw new Error("hardware migration inventory digest mismatch");
  }
  const darkControllers = darkSafeVerification.controllers ?? [];
  const hardwareAddresses = [];
  const deviceIds = new Set();
  const custodyDomains = new Set();
  let proofNotBeforeTimestamp = 0;
  let proofExpiresAtTimestamp = Number.MAX_SAFE_INTEGER;
  for (const [roleIndex, role] of SAFE_PUBLIC_MIGRATION_ROLES.entries()) {
    const entry = inventory.roles[roleIndex];
    const dark = darkControllers[roleIndex];
    if (
      entry.role !== role ||
      dark?.role !== role ||
      getAddress(entry.safe) !== getAddress(dark.address) ||
      getAddress(entry.legacyOwner) !== getAddress(dark.owner) ||
      entry.hardwareOwners.length !== 3
    ) {
      throw new Error(`hardware migration ${role} binding is invalid`);
    }
    const roleCustodyDomains = new Set();
    for (const [ownerIndex, owner] of entry.hardwareOwners.entries()) {
      const address = getAddress(owner.address);
      if (
        owner.proof?.role !== role ||
        getAddress(owner.proof.safe) !== getAddress(entry.safe) ||
        getAddress(owner.proof.hardwareOwner) !== address ||
        owner.proof.ownerIndex !== ownerIndex ||
        owner.deviceType !== "HARDWARE_WALLET_SECURE_ELEMENT_OR_AIRGAPPED_SIGNER" ||
        !/^0x[0-9a-f]{64}$/u.test(owner.deviceIdentifierSha256 ?? "") ||
        !/^0x[0-9a-f]{64}$/u.test(owner.custodyDomainSha256 ?? "")
      ) {
        throw new Error(`${role} hardware owner ${ownerIndex} is invalid`);
      }
      await assertHardwareOwnerControlProof({
        proof: owner.proof,
        migrationPlanDigest,
        source: inventory.source,
        nowTimestamp,
        trustedTime,
      });
      proofNotBeforeTimestamp = Math.max(
        proofNotBeforeTimestamp,
        owner.proof.notBeforeTimestamp,
      );
      proofExpiresAtTimestamp = Math.min(
        proofExpiresAtTimestamp,
        owner.proof.expiresAtTimestamp,
      );
      hardwareAddresses.push(address.toLowerCase());
      deviceIds.add(owner.deviceIdentifierSha256);
      custodyDomains.add(owner.custodyDomainSha256);
      roleCustodyDomains.add(owner.custodyDomainSha256);
    }
    if (roleCustodyDomains.size !== 3) {
      throw new Error(`${role} hardware custody domains are not independent`);
    }
    await assertHardwareThresholdControlProof({
      proof: entry.thresholdControlProof,
      role,
      safe: entry.safe,
      hardwareOwners: entry.hardwareOwners.map(({ address }) => address),
      migrationPlanDigest,
      source: inventory.source,
      nowTimestamp,
      trustedTime,
    });
    proofNotBeforeTimestamp = Math.max(
      proofNotBeforeTimestamp,
      entry.thresholdControlProof.notBeforeTimestamp,
    );
    proofExpiresAtTimestamp = Math.min(
      proofExpiresAtTimestamp,
      entry.thresholdControlProof.expiresAtTimestamp,
    );
  }
  const forbidden = new Set(
    [...forbiddenAddresses, ...darkControllers.flatMap((entry) => [entry.address, entry.owner])].map(
      (value) => getAddress(value).toLowerCase(),
    ),
  );
  if (
    new Set(hardwareAddresses).size !== 12 ||
    hardwareAddresses.some((address) => forbidden.has(address)) ||
    deviceIds.size !== 12 ||
    custodyDomains.size !== 12
  ) {
    throw new Error("twelve globally isolated hardware owners are required");
  }
  return {
    migrationPlanDigest,
    intentRoles,
    proofWindow: {
      notBeforeTimestamp: proofNotBeforeTimestamp,
      expiresAtTimestamp: proofExpiresAtTimestamp,
    },
  };
}
