import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  hexToBigInt,
  keccak256,
} from "viem";
import { mainnet } from "viem/chains";

import {
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import {
  assertRpcProviderBindings,
  releaseRpcTransport,
  requireDistinctRpcOrigins,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  SAFE_READ_ABI,
  SAFE_VERIFICATION_SCHEMA,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import {
  SAFE_PUBLIC_MIGRATION_ABI,
  SAFE_PUBLIC_MIGRATION_CONTINUATION_SCHEMA,
  SAFE_PUBLIC_MIGRATION_PLAN_SCHEMA,
  SAFE_PUBLIC_MIGRATION_PROGRESS_SCHEMA,
  SAFE_PUBLIC_MIGRATION_RECEIPTS_SCHEMA,
  SAFE_PUBLIC_MIGRATION_ROLES,
  SAFE_PUBLIC_MIGRATION_VERIFICATION_SCHEMA,
  assertHardwareMigrationInventory,
  assertHardwareThresholdControlProof,
  assertSafePublicMigrationPolicy,
  assertSafePublicMigrationReleaseAuthorization,
  assertSafePublicMigrationReceiptTime,
  assertSafePublicMigrationReceiptLogs,
  classifySafePublicMigrationState,
  safePublicMigrationTransaction,
  safeTransactionHash,
  sortedSafeSignatures,
} from "./custom-registry-v2-safe-public-migration-guards.mjs";
import { commonFinalizedBlock } from "./custom-registry-v2-live-verification.mjs";
import {
  assertSafeMigrationContinuationExecutionBinding,
  assertSafeMigrationReceiptFollowsDispatchIntent,
  readSafeMigrationExecutionBundle,
  readSafeMigrationExecutionBundleContext,
} from "./custom-registry-v2-safe-public-migration-execution.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const SENTINEL_MODULE = "0x0000000000000000000000000000000000000001";
const sha256 = (bytes) =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const readEvidence = async (pathName, digestName, label) => {
  const filePath = assertReleaseEvidencePath(required(pathName));
  const bytes = await readFile(filePath);
  const digest = sha256(bytes);
  if (digest !== required(digestName)) {
    throw new Error(`${label} digest mismatch`);
  }
  return { bytes, digest, value: JSON.parse(bytes) };
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required");
}
const outputPath = assertReleaseEvidenceOutput(process.argv[outputIndex + 1]);

const rpcUrls = [
  required("REGISTRY_VERIFY_RPC_URL_A"),
  required("REGISTRY_VERIFY_RPC_URL_B"),
];
requireDistinctRpcOrigins(...rpcUrls);
const providerIds = [
  required("REGISTRY_RPC_PROVIDER_ID_A"),
  required("REGISTRY_RPC_PROVIDER_ID_B"),
];
const clients = rpcUrls.map((url) =>
  createPublicClient({ chain: mainnet, transport: releaseRpcTransport(url) }),
);
if ((await Promise.all(clients.map((client) => client.getChainId()))).some((id) => id !== 1)) {
  throw new Error("hardware migration verifier RPC is not Ethereum mainnet");
}

const planEvidence = await readEvidence(
  "REGISTRY_SAFE_MIGRATION_PLAN_PATH",
  "REGISTRY_SAFE_MIGRATION_PLAN_SHA256",
  "hardware migration plan",
);
const receiptsEvidence = await readEvidence(
  "REGISTRY_SAFE_MIGRATION_RECEIPTS_PATH",
  "REGISTRY_SAFE_MIGRATION_RECEIPTS_SHA256",
  "hardware migration receipts",
);
const dark = await readEvidence(
  "REGISTRY_SAFE_VERIFICATION_PATH",
  "REGISTRY_SAFE_VERIFICATION_SHA256",
  "dark Safe verification",
);
const hardware = await readEvidence(
  "REGISTRY_HARDWARE_OWNER_INVENTORY_PATH",
  "REGISTRY_HARDWARE_OWNER_INVENTORY_SHA256",
  "hardware owner inventory",
);
const plan = planEvidence.value;
const receipts = receiptsEvidence.value;

const policyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-safe-public-migration-policy.json"),
);
const safePolicyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
);
const releasePolicyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-release-policy.json"),
);
const predeploymentBytes = await readFile(
  path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
);
const policy = assertSafePublicMigrationPolicy(JSON.parse(policyBytes));
const safePolicy = JSON.parse(safePolicyBytes);
const releasePolicy = JSON.parse(releasePolicyBytes);
const predeployment = JSON.parse(predeploymentBytes);
const currentCommit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const currentTree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  execFileSync("/usr/bin/git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }) !== "" ||
  currentCommit !== plan.source?.commit ||
  currentTree !== plan.source?.tree ||
  dark.value.schemaVersion !== SAFE_VERIFICATION_SCHEMA ||
  dark.value.verified !== true ||
  dark.digest !== plan.darkSafeVerificationSha256 ||
  hardware.digest !== plan.hardwareInventorySha256 ||
  sha256(policyBytes) !== plan.policySha256 ||
  sha256(safePolicyBytes) !== plan.safeControllerPolicySha256 ||
  sha256(releasePolicyBytes) !== plan.releasePolicySha256 ||
  sha256(predeploymentBytes) !== plan.predeploymentManifestSha256 ||
  releasePolicy.activationAllowed !== false ||
  predeployment.activationAllowed !== false
) {
  throw new Error("hardware migration source, evidence, or activation policy drifted");
}
assertSafePublicMigrationReleaseAuthorization({
  actual: plan.releaseAuthorization,
  expected: predeployment.releaseAuthorization,
  releaseOwner: dark.value.releaseOwner,
});
if (
  plan.schemaVersion !== SAFE_PUBLIC_MIGRATION_PLAN_SCHEMA ||
  plan.status !== "PREFLIGHT_ONLY_TWELVE_HARDWARE_KEYS_NO_SIGNING_NO_BROADCAST" ||
  plan.chainId !== 1 ||
  plan.roleStates?.length !== 4 ||
  !Array.isArray(plan.transactions) ||
  !Array.isArray(plan.completedMigrations) ||
  !Array.isArray(plan.remainingRoles) ||
  plan.transactions.length !== plan.remainingRoles.length ||
  plan.completedMigrations.length + plan.transactions.length !== 4 ||
  plan.aggregateFinalizedVerificationRequired !== true ||
  plan.activationAllowed !== false ||
  plan.signingAllowed !== false ||
  plan.broadcastAllowed !== false ||
  receipts.schemaVersion !== SAFE_PUBLIC_MIGRATION_RECEIPTS_SCHEMA ||
  receipts.chainId !== 1 ||
  receipts.planSha256 !== planEvidence.digest ||
  !Array.isArray(receipts.transactions) ||
  receipts.transactions.length > plan.transactions.length ||
  receipts.status !== "SUBSET_OF_REMAINING_DIRECT_LEGACY_OWNER_MIGRATIONS_SUBMITTED"
) {
  throw new Error("hardware migration plan or receipt schema is invalid");
}
const plannedByRole = new Map(plan.transactions.map((entry) => [entry.role, entry]));
const completedByRole = new Map(
  plan.completedMigrations.map((entry) => [entry.role, entry]),
);
const submittedByRole = new Map(
  receipts.transactions.map((entry) => [entry.role, entry]),
);
if (
  plannedByRole.size !== plan.transactions.length ||
  completedByRole.size !== plan.completedMigrations.length ||
  submittedByRole.size !== receipts.transactions.length ||
  plan.roleStates.some(
    (entry, index) =>
      entry.role !== SAFE_PUBLIC_MIGRATION_ROLES[index] ||
      ![
        "LEGACY_ONE_OF_ONE_PENDING",
        "MIGRATED_HARDWARE_TWO_OF_THREE_FINALIZED",
      ].includes(entry.classification) ||
      (entry.classification === "LEGACY_ONE_OF_ONE_PENDING") !==
        plannedByRole.has(entry.role) ||
      (entry.classification === "MIGRATED_HARDWARE_TWO_OF_THREE_FINALIZED") !==
        completedByRole.has(entry.role),
  ) ||
  plan.remainingRoles.some(
    (role, index) => role !== plan.transactions[index]?.role,
  ) ||
  receipts.transactions.some(({ role }) => !plannedByRole.has(role))
) {
  throw new Error("hardware migration mixed-state role partition is invalid");
}
assertRpcProviderBindings({ plan, providerIds, rpcUrls });
const inventory = await assertHardwareMigrationInventory({
  inventory: hardware.value,
  darkSafeVerification: dark.value,
  darkSafeVerificationSha256: dark.digest,
  policySha256: sha256(policyBytes),
  forbiddenAddresses: [
    dark.value.deployer,
    dark.value.admin,
    dark.value.releaseOwner,
    dark.value.singleton.address,
    dark.value.proxyFactory.address,
    dark.value.multiSendCallOnly.address,
  ],
  nowTimestamp: plan.createdAtTimestamp,
  trustedTime: plan.createdAtTrustedTime,
});
if (inventory.migrationPlanDigest !== plan.migrationPlanDigest) {
  throw new Error("hardware migration inventory does not bind the reviewed plan");
}
if (
  JSON.stringify(inventory.proofWindow) !==
    JSON.stringify(plan.hardwareProofWindow) ||
  plan.expiresAtTimestamp > inventory.proofWindow.expiresAtTimestamp
) {
  throw new Error("hardware proof window does not cover the reviewed plan");
}

const finalized = await commonFinalizedBlock(clients);
const reviewedAnchorBlocks = await Promise.all(
  clients.map((client) =>
    client.getBlock({ blockNumber: BigInt(plan.finalizedAnchor.blockNumber) }),
  ),
);
if (reviewedAnchorBlocks.some(({ hash }) => hash !== plan.finalizedAnchor.blockHash)) {
  throw new Error("hardware migration reviewed finalized anchor is no longer canonical");
}
const multiSendCodes = await Promise.all(
  clients.map((client) =>
    client.getCode({
      address: policy.multiSendCallOnly.address,
      blockNumber: finalized.number,
    }),
  ),
);
if (
  multiSendCodes.some(
    (code) => keccak256(code ?? "0x") !== policy.multiSendCallOnly.runtimeCodeKeccak256,
  )
) {
  throw new Error("final hardware migration MultiSendCallOnly runtime is invalid");
}

const verifiedTransactions = [];
const verifiedCompletedTransactions = [];
for (const completed of plan.completedMigrations) {
  const role = completed.role;
  const index = SAFE_PUBLIC_MIGRATION_ROLES.indexOf(role);
  const planned = plan.roleStates[index];
  const inventoryRole = inventory.intentRoles[index];
  const execution = await readSafeMigrationExecutionBundleContext({
    bundlePath: completed.executionBundlePath,
    bundleSha256: completed.executionBundleSha256,
    nowTimestamp: plan.createdAtTimestamp,
    allowExpired: true,
  });
  assertSafeMigrationContinuationExecutionBinding({
    entry: completed,
    execution,
    executionBundlePath: completed.executionBundlePath,
    executionBundleSha256: completed.executionBundleSha256,
    migrationPlanDigest: plan.migrationPlanDigest,
    source: plan.source,
    policySha256: plan.policySha256,
    hardwareInventorySha256: plan.hardwareInventorySha256,
  });
  const journalReceipt = execution.journalRecords.find(
    ({ event }) => event === "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
  );
  if (
    index === -1 ||
    planned?.role !== role ||
    inventoryRole?.role !== role ||
    !/^0x[0-9a-fA-F]{64}$/u.test(completed.transactionHash ?? "") ||
    getAddress(planned.safe) !== getAddress(inventoryRole.safe) ||
    getAddress(planned.legacyOwner) !== getAddress(inventoryRole.legacyOwner)
  ) {
    throw new Error(`${role} completed migration plan binding is invalid`);
  }
  const migration = safePublicMigrationTransaction({
    safe: planned.safe,
    legacyOwner: planned.legacyOwner,
    hardwareOwners: planned.hardwareOwners,
    safeNonce: 0n,
    multiSendCallOnly: policy.multiSendCallOnly.address,
  });
  const expectedSafeTransactionHash = safeTransactionHash({
    safe: planned.safe,
    transaction: migration.safeTransaction,
  });
  if (
    completed.reviewedTransaction.input !== migration.execTransactionData ||
    JSON.stringify(execution.plannedRole.outerTransaction) !==
      JSON.stringify({
        type: "eip1559",
        chainId: 1,
        from: planned.legacyOwner,
        to: planned.safe,
        input: completed.reviewedTransaction.input,
        valueWei: "0",
        nonce: completed.reviewedTransaction.nonce,
        gasLimit: completed.reviewedTransaction.gasLimit,
        maxFeePerGas: completed.reviewedTransaction.maxFeePerGas,
        maxPriorityFeePerGas:
          completed.reviewedTransaction.maxPriorityFeePerGas,
      }) ||
    planned.expectedSafeTransactionHash !== expectedSafeTransactionHash
  ) {
    throw new Error(`${role} completed reviewed transaction is invalid`);
  }
  const observations = await Promise.all(
    clients.map(async (client) => {
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: completed.transactionHash }),
        client.getTransactionReceipt({ hash: completed.transactionHash }),
      ]);
      const receiptBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (
        transaction.hash !== completed.transactionHash ||
        receipt.transactionHash !== completed.transactionHash ||
        transaction.type !== "eip1559" ||
        transaction.chainId !== 1 ||
        getAddress(transaction.from) !== getAddress(planned.legacyOwner) ||
        getAddress(transaction.to) !== getAddress(planned.safe) ||
        transaction.input !== completed.reviewedTransaction.input ||
        transaction.value !== 0n ||
        transaction.nonce !== completed.reviewedTransaction.nonce ||
        transaction.gas !== BigInt(completed.reviewedTransaction.gasLimit) ||
        transaction.maxFeePerGas !==
          BigInt(completed.reviewedTransaction.maxFeePerGas) ||
        transaction.maxPriorityFeePerGas !==
          BigInt(completed.reviewedTransaction.maxPriorityFeePerGas) ||
        receipt.status !== "success" ||
        receipt.blockHash !== completed.blockHash ||
        receipt.blockNumber.toString() !== completed.blockNumber ||
        receipt.blockNumber > finalized.number ||
        journalReceipt?.blockNumber !== receipt.blockNumber.toString() ||
        journalReceipt?.blockHash !== receipt.blockHash ||
        receiptBlock.hash !== receipt.blockHash ||
        receiptBlock.number !== receipt.blockNumber ||
        Number(receiptBlock.timestamp) !== completed.receiptBlockTimestamp ||
        receipt.gasUsed > BigInt(completed.reviewedTransaction.gasLimit) ||
        receipt.effectiveGasPrice >
          BigInt(completed.reviewedTransaction.maxFeePerGas) ||
        receipt.logs.some(
          (log) =>
            log.transactionHash !== completed.transactionHash ||
            log.blockHash !== receipt.blockHash ||
            log.blockNumber !== receipt.blockNumber ||
            log.removed === true,
        )
      ) {
        throw new Error(`${role} completed migration transaction is invalid`);
      }
      assertSafePublicMigrationReceiptTime({
        receiptBlockTimestamp: receiptBlock.timestamp,
        plan: {
          createdAtTimestamp: completed.sourcePlanWindow.createdAtTimestamp,
          expiresAtTimestamp: completed.sourcePlanWindow.expiresAtTimestamp,
          createdAtTrustedTime:
            completed.sourcePlanWindow.createdAtTrustedTime,
          hardwareProofWindow: plan.hardwareProofWindow,
        },
      });
      assertSafeMigrationReceiptFollowsDispatchIntent({
        receiptBlockTimestamp: receiptBlock.timestamp,
        execution,
      });
      assertSafePublicMigrationReceiptLogs({
        logs: receipt.logs,
        safe: planned.safe,
        legacyOwner: planned.legacyOwner,
        hardwareOwners: planned.hardwareOwners,
        safeTransactionHash: expectedSafeTransactionHash,
      });
      return {
        transactionHash: transaction.hash,
        blockHash: receipt.blockHash,
        blockNumber: receipt.blockNumber.toString(),
        transactionIndex: receipt.transactionIndex,
        gasUsed: receipt.gasUsed.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString(),
        blockTimestamp: receiptBlock.timestamp.toString(),
      };
    }),
  );
  if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) {
    throw new Error(`independent ${role} completed migration evidence disagrees`);
  }
  verifiedCompletedTransactions.push(completed);
}
for (const submitted of receipts.transactions) {
  const role = submitted.role;
  const index = SAFE_PUBLIC_MIGRATION_ROLES.indexOf(role);
  const planned = plannedByRole.get(role);
  const inventoryRole = inventory.intentRoles[index];
  const execution = await readSafeMigrationExecutionBundle({
    bundlePath: submitted.executionBundlePath,
    bundleSha256: submitted.executionBundleSha256,
    plan,
    plannedRole: planned,
    nowTimestamp: plan.expiresAtTimestamp,
    allowExpired: true,
  });
  const journalReceipt = execution.journalRecords.find(
    ({ event }) => event === "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
  );
  if (
    planned.role !== role ||
    inventoryRole.role !== role ||
    !/^0x[0-9a-fA-F]{64}$/u.test(submitted.transactionHash ?? "") ||
    execution.transactionHash !== submitted.transactionHash ||
    getAddress(planned.safe) !== getAddress(inventoryRole.safe) ||
    getAddress(planned.legacyOwner) !== getAddress(inventoryRole.legacyOwner) ||
    JSON.stringify(planned.hardwareOwners.map((value) => getAddress(value))) !==
      JSON.stringify(
        inventoryRole.hardwareOwners.map((value) => getAddress(value)),
      )
  ) {
    throw new Error(`${role} migration plan, inventory, or receipt binding is invalid`);
  }
  const migration = safePublicMigrationTransaction({
    safe: planned.safe,
    legacyOwner: planned.legacyOwner,
    hardwareOwners: planned.hardwareOwners,
    safeNonce: BigInt(planned.expectedSafeNonceBefore),
    multiSendCallOnly: policy.multiSendCallOnly.address,
  });
  const expectedSafeTransactionHash = safeTransactionHash({
    safe: planned.safe,
    transaction: migration.safeTransaction,
  });
  if (
    planned.safeTransactionHash !== expectedSafeTransactionHash ||
    planned.outerTransaction.type !== "eip1559" ||
    planned.outerTransaction.chainId !== 1 ||
    getAddress(planned.outerTransaction.from) !== getAddress(planned.legacyOwner) ||
    getAddress(planned.outerTransaction.to) !== getAddress(planned.safe) ||
    planned.outerTransaction.input !== migration.execTransactionData ||
    planned.outerTransaction.valueWei !== "0" ||
    planned.expectedSafeNonceBefore !== "0" ||
    planned.expectedSafeNonceAfter !== "1" ||
    planned.expectedThreshold !== 2 ||
    JSON.stringify(planned.expectedOwners.map((value) => getAddress(value))) !==
      JSON.stringify(migration.expectedOwners.map((value) => getAddress(value)))
  ) {
    throw new Error(`${role} reviewed migration transaction is invalid`);
  }
  const observations = await Promise.all(
    clients.map(async (client) => {
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: submitted.transactionHash }),
        client.getTransactionReceipt({ hash: submitted.transactionHash }),
      ]);
      const receiptBlock = await client.getBlock({ blockNumber: receipt.blockNumber });
      if (
        transaction.hash !== submitted.transactionHash ||
        receipt.transactionHash !== submitted.transactionHash ||
        receipt.status !== "success" ||
        receipt.contractAddress !== null ||
        transaction.type !== "eip1559" ||
        transaction.chainId !== 1 ||
        getAddress(transaction.from) !== getAddress(planned.outerTransaction.from) ||
        getAddress(transaction.to) !== getAddress(planned.outerTransaction.to) ||
        transaction.input !== planned.outerTransaction.input ||
        transaction.value !== 0n ||
        transaction.nonce !== planned.outerTransaction.nonce ||
        transaction.gas !== BigInt(planned.outerTransaction.gasLimit) ||
        transaction.maxFeePerGas !== BigInt(planned.outerTransaction.maxFeePerGas) ||
        transaction.maxPriorityFeePerGas !==
          BigInt(planned.outerTransaction.maxPriorityFeePerGas) ||
        transaction.blockHash !== receipt.blockHash ||
        transaction.blockNumber !== receipt.blockNumber ||
        receipt.blockNumber > finalized.number ||
        journalReceipt?.blockNumber !== receipt.blockNumber.toString() ||
        journalReceipt?.blockHash !== receipt.blockHash ||
        receiptBlock.hash !== receipt.blockHash ||
        receiptBlock.number !== receipt.blockNumber ||
        receipt.gasUsed > BigInt(planned.outerTransaction.gasLimit) ||
        receipt.effectiveGasPrice >
          BigInt(planned.outerTransaction.maxFeePerGas) ||
        receipt.logs.some(
          (log) =>
            log.transactionHash !== submitted.transactionHash ||
            log.blockHash !== receipt.blockHash ||
            log.blockNumber !== receipt.blockNumber ||
            log.removed === true,
        )
      ) {
        throw new Error(`${role} finalized migration transaction differs from plan`);
      }
      assertSafePublicMigrationReceiptTime({
        receiptBlockTimestamp: receiptBlock.timestamp,
        plan,
      });
      assertSafeMigrationReceiptFollowsDispatchIntent({
        receiptBlockTimestamp: receiptBlock.timestamp,
        execution,
      });
      assertSafePublicMigrationReceiptLogs({
        logs: receipt.logs,
        safe: planned.safe,
        legacyOwner: planned.legacyOwner,
        hardwareOwners: planned.hardwareOwners,
        safeTransactionHash: expectedSafeTransactionHash,
      });
      return { transaction, receipt, receiptBlock };
    }),
  );
  const comparable = ({ transaction, receipt, receiptBlock }) => ({
    transactionHash: transaction.hash,
    blockHash: receipt.blockHash,
    blockNumber: receipt.blockNumber.toString(),
    transactionIndex: receipt.transactionIndex,
    gasUsed: receipt.gasUsed.toString(),
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    blockTimestamp: receiptBlock.timestamp.toString(),
    logs: receipt.logs.map((log) => ({
      address: getAddress(log.address),
      topics: log.topics,
      data: log.data,
      logIndex: log.logIndex,
      transactionIndex: log.transactionIndex,
    })),
  });
  if (JSON.stringify(comparable(observations[0])) !== JSON.stringify(comparable(observations[1]))) {
    throw new Error(`independent ${role} migration receipt evidence disagrees`);
  }
  verifiedTransactions.push({
    role,
    transactionHash: submitted.transactionHash,
    blockNumber: observations[0].receipt.blockNumber.toString(),
    blockHash: observations[0].receipt.blockHash,
    safeTransactionHash: expectedSafeTransactionHash,
    sourcePlanSha256: planEvidence.digest,
    ownerAuthorizationSha256:
      execution.bundle.artifacts.ownerAuthorization.sha256,
    transactionJournalSha256:
      execution.bundle.artifacts.transactionJournal.sha256,
    receiptEvidenceSha256: receiptsEvidence.digest,
    executionBundlePath: submitted.executionBundlePath,
    executionBundleSha256: submitted.executionBundleSha256,
    receiptBlockTimestamp: Number(observations[0].receiptBlock.timestamp),
    sourcePlanWindow: {
      createdAtTimestamp: plan.createdAtTimestamp,
      expiresAtTimestamp: plan.expiresAtTimestamp,
      createdAtTrustedTime: plan.createdAtTrustedTime,
    },
    reviewedTransaction: {
      input: planned.outerTransaction.input,
      nonce: planned.outerTransaction.nonce,
      gasLimit: planned.outerTransaction.gasLimit,
      maxFeePerGas: planned.outerTransaction.maxFeePerGas,
      maxPriorityFeePerGas: planned.outerTransaction.maxPriorityFeePerGas,
    },
  });
}

const migratedControllers = [];
const finalRoleStates = [];
for (const [index, role] of SAFE_PUBLIC_MIGRATION_ROLES.entries()) {
  const planned = plan.roleStates[index];
  const inventoryRole = hardware.value.roles[index];
  const states = await Promise.all(
    clients.map(async (client) => {
      const [
        code,
        version,
        masterCopy,
        owners,
        threshold,
        safeNonce,
        modulesPage,
        fallbackStorage,
        guardStorage,
      ] = await Promise.all([
        client.getCode({ address: planned.safe, blockNumber: finalized.number }),
        client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "VERSION", blockNumber: finalized.number }),
        client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "masterCopy", blockNumber: finalized.number }),
        client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getOwners", blockNumber: finalized.number }),
        client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getThreshold", blockNumber: finalized.number }),
        client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "nonce", blockNumber: finalized.number }),
        client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getModulesPaginated", args: [SENTINEL_MODULE, 10n], blockNumber: finalized.number }),
        client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getStorageAt", args: [hexToBigInt(safePolicy.storageSlots.fallbackHandler), 1n], blockNumber: finalized.number }),
        client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getStorageAt", args: [hexToBigInt(safePolicy.storageSlots.guard), 1n], blockNumber: finalized.number }),
      ]);
      return { code: code ?? "0x", version, masterCopy, owners, threshold, safeNonce, modulesPage, fallbackStorage, guardStorage };
    }),
  );
  const expectedOwners = planned.expectedOwners.map((value) => getAddress(value));
  const comparableState = (state) => ({
    runtimeCodeKeccak256: keccak256(state.code),
    version: state.version,
    masterCopy: getAddress(state.masterCopy),
    owners: state.owners.map((value) => getAddress(value)),
    threshold: state.threshold.toString(),
    safeNonce: state.safeNonce.toString(),
    modules: state.modulesPage[0].map((value) => getAddress(value)),
    nextModule: getAddress(state.modulesPage[1]),
    fallbackStorage: state.fallbackStorage,
    guardStorage: state.guardStorage,
  });
  const classifications = states.map((state) =>
    classifySafePublicMigrationState({
      actual: {
        runtimeCodeKeccak256: keccak256(state.code),
        version: state.version,
        masterCopy: state.masterCopy,
        owners: state.owners,
        threshold: state.threshold,
        safeNonce: state.safeNonce,
        modules: state.modulesPage[0],
        nextModule: state.modulesPage[1],
        fallbackStorage: state.fallbackStorage,
        guardStorage: state.guardStorage,
      },
      expected: {
        safe: planned.safe,
        legacyOwner: planned.legacyOwner,
        hardwareOwners: planned.hardwareOwners,
        proxyRuntimeCodeKeccak256:
          dark.value.proxyFactory.proxyRuntimeCodeKeccak256,
        safeVersion: safePolicy.safeVersion,
        singleton: dark.value.singleton.address,
      },
    }),
  );
  if (JSON.stringify(comparableState(states[0])) !== JSON.stringify(comparableState(states[1]))) {
    throw new Error(`independent ${role} final Safe state disagrees`);
  }
  if (
    classifications[0] !== classifications[1] ||
    (submittedByRole.has(role) &&
      classifications[0] !== "MIGRATED_HARDWARE_TWO_OF_THREE_FINALIZED") ||
    (completedByRole.has(role) &&
      classifications[0] !== "MIGRATED_HARDWARE_TWO_OF_THREE_FINALIZED") ||
    (classifications[0] === "MIGRATED_HARDWARE_TWO_OF_THREE_FINALIZED" &&
      !submittedByRole.has(role) &&
      !completedByRole.has(role))
  ) {
    throw new Error(`${role} final Safe state does not match migration evidence`);
  }
  finalRoleStates.push({
    role,
    address: getAddress(planned.safe),
    classification: classifications[0],
  });
  if (classifications[0] === "LEGACY_ONE_OF_ONE_PENDING") {
    continue;
  }
  const thresholdProof = await assertHardwareThresholdControlProof({
    proof: inventoryRole.thresholdControlProof,
    role,
    safe: planned.safe,
    hardwareOwners: planned.hardwareOwners,
    migrationPlanDigest: plan.migrationPlanDigest,
    source: plan.source,
    nowTimestamp: plan.createdAtTimestamp,
    trustedTime: plan.createdAtTrustedTime,
  });
  const checkSignaturesData = encodeFunctionData({
    abi: SAFE_PUBLIC_MIGRATION_ABI,
    functionName: "checkSignatures",
    args: [
      thresholdProof.dataHash,
      "0x",
      sortedSafeSignatures(thresholdProof.signatures.slice(0, 2)),
    ],
  });
  await Promise.all(
    clients.map((client) =>
      client.call({
        to: planned.safe,
        data: checkSignaturesData,
        blockNumber: finalized.number,
      }),
    ),
  );
  const finalHardwareCodes = await Promise.all(
    clients.flatMap((client) =>
      planned.hardwareOwners.map((address) =>
        client.getCode({ address, blockNumber: finalized.number }),
      ),
    ),
  );
  const currentHardwareCodes = await Promise.all(
    clients.flatMap((client) =>
      planned.hardwareOwners.map((address) =>
        client.getCode({ address, blockTag: "latest" }),
      ),
    ),
  );
  if (
    finalHardwareCodes.some((code) => code && code !== "0x") ||
    currentHardwareCodes.some((code) => code && code !== "0x")
  ) {
    throw new Error(`${role} final hardware owner is code-bearing or delegated`);
  }
  migratedControllers.push({
    role,
    address: getAddress(planned.safe),
    owners: expectedOwners,
    threshold: 2,
    safeNonce: "1",
    legacyOwnerRemoved: true,
    thresholdControlDataHash: thresholdProof.dataHash,
  });
}

const closingBlocks = await Promise.all(
  clients.map((client) => client.getBlock({ blockNumber: finalized.number })),
);
if (closingBlocks.some(({ hash }) => hash !== finalized.hash)) {
  throw new Error("hardware migration finalized anchor drifted during verification");
}

const completedTransactionsByRole = new Map(
  [...verifiedCompletedTransactions, ...verifiedTransactions].map((entry) => [
    entry.role,
    entry,
  ]),
);
if (
  completedTransactionsByRole.size !==
  verifiedCompletedTransactions.length + verifiedTransactions.length
) {
  throw new Error("hardware migration continuation contains duplicate roles");
}
const completedTransactions = SAFE_PUBLIC_MIGRATION_ROLES.filter((role) =>
  completedTransactionsByRole.has(role),
).map((role) => completedTransactionsByRole.get(role));
const aggregateComplete = completedTransactions.length === 4;
const continuation = {
  schemaVersion: SAFE_PUBLIC_MIGRATION_CONTINUATION_SCHEMA,
  chainId: 1,
  migrationPlanDigest: plan.migrationPlanDigest,
  status: "FINALIZED_PARTIAL_MIGRATIONS_BOUND_FOR_CONTINUATION",
  transactions: completedTransactions,
};

const verification = {
  schemaVersion: aggregateComplete
    ? SAFE_PUBLIC_MIGRATION_VERIFICATION_SCHEMA
    : SAFE_PUBLIC_MIGRATION_PROGRESS_SCHEMA,
  status: aggregateComplete
    ? "VERIFIED_FINALIZED_HARDWARE_TWO_OF_THREE_MIGRATION_ACTIVATION_NOT_PERFORMED"
    : "VERIFIED_MIXED_STATE_SAFE_CONTINUATION_REQUIRED_ACTIVATION_BLOCKED",
  chainId: 1,
  source: plan.source,
  planSha256: planEvidence.digest,
  receiptsSha256: receiptsEvidence.digest,
  darkSafeVerificationSha256: dark.digest,
  hardwareInventorySha256: hardware.digest,
  policySha256: sha256(policyBytes),
  releasePolicySha256: sha256(releasePolicyBytes),
  predeploymentManifestSha256: sha256(predeploymentBytes),
  finalizedAnchor: {
    blockNumber: finalized.number.toString(),
    blockHash: finalized.hash,
  },
  transactions: verifiedTransactions,
  cumulativeCompletedTransactions: completedTransactions,
  continuation,
  roleStates: finalRoleStates,
  controllers: migratedControllers,
  migrationGateSatisfied: aggregateComplete,
  aggregateFinalizedVerificationComplete: aggregateComplete,
  activationAllowed: false,
  activationPerformed: false,
  verified: aggregateComplete,
};
await writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_VERIFIED ${outputPath}\n`,
);
