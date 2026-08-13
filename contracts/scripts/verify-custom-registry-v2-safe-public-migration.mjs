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
  SAFE_PUBLIC_MIGRATION_PLAN_SCHEMA,
  SAFE_PUBLIC_MIGRATION_RECEIPTS_SCHEMA,
  SAFE_PUBLIC_MIGRATION_ROLES,
  SAFE_PUBLIC_MIGRATION_VERIFICATION_SCHEMA,
  assertHardwareMigrationInventory,
  assertHardwareThresholdControlProof,
  assertSafePublicMigrationPolicy,
  assertSafePublicMigrationReceiptLogs,
  safePublicMigrationTransaction,
  safeTransactionHash,
  sortedSafeSignatures,
} from "./custom-registry-v2-safe-public-migration-guards.mjs";
import { commonFinalizedBlock } from "./custom-registry-v2-live-verification.mjs";

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
if (
  plan.schemaVersion !== SAFE_PUBLIC_MIGRATION_PLAN_SCHEMA ||
  plan.status !== "PREFLIGHT_ONLY_TWELVE_HARDWARE_KEYS_NO_SIGNING_NO_BROADCAST" ||
  plan.chainId !== 1 ||
  plan.transactions?.length !== 4 ||
  plan.aggregateFinalizedVerificationRequired !== true ||
  plan.activationAllowed !== false ||
  plan.signingAllowed !== false ||
  plan.broadcastAllowed !== false ||
  receipts.schemaVersion !== SAFE_PUBLIC_MIGRATION_RECEIPTS_SCHEMA ||
  receipts.chainId !== 1 ||
  receipts.planSha256 !== planEvidence.digest ||
  receipts.transactions?.length !== 4 ||
  receipts.status !== "FOUR_DIRECT_LEGACY_OWNER_MIGRATIONS_SUBMITTED"
) {
  throw new Error("hardware migration plan or receipt schema is invalid");
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
for (const [index, role] of SAFE_PUBLIC_MIGRATION_ROLES.entries()) {
  const planned = plan.transactions[index];
  const submitted = receipts.transactions[index];
  const inventoryRole = inventory.intentRoles[index];
  if (
    planned.role !== role ||
    submitted.role !== role ||
    inventoryRole.role !== role ||
    !/^0x[0-9a-fA-F]{64}$/u.test(submitted.transactionHash ?? "") ||
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
    planned.outerTransaction.input !== migration.execTransactionData ||
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
        receiptBlock.hash !== receipt.blockHash ||
        receiptBlock.number !== receipt.blockNumber ||
        receiptBlock.timestamp * 1000n <=
          BigInt(
            plan.createdAtTrustedTime.adjustedTimeMilliseconds +
              plan.createdAtTrustedTime.uncertaintyMilliseconds,
          ) ||
        receiptBlock.timestamp >= BigInt(plan.hardwareProofWindow.expiresAtTimestamp) ||
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
  });
}

const migratedControllers = [];
for (const [index, role] of SAFE_PUBLIC_MIGRATION_ROLES.entries()) {
  const planned = plan.transactions[index];
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
  for (const state of states) {
    if (
      state.code === "0x" ||
      keccak256(state.code) !== dark.value.proxyFactory.proxyRuntimeCodeKeccak256 ||
      state.version !== safePolicy.safeVersion ||
      getAddress(state.masterCopy) !== getAddress(dark.value.singleton.address) ||
      JSON.stringify(state.owners.map((value) => getAddress(value))) !== JSON.stringify(expectedOwners) ||
      state.threshold !== 2n ||
      state.safeNonce !== 1n ||
      state.modulesPage[0].length !== 0 ||
      getAddress(state.modulesPage[1]) !== SENTINEL_MODULE ||
      !/^0x0{64}$/u.test(state.fallbackStorage) ||
      !/^0x0{64}$/u.test(state.guardStorage)
    ) {
      throw new Error(`${role} final hardware Safe state is invalid`);
    }
  }
  if (JSON.stringify(comparableState(states[0])) !== JSON.stringify(comparableState(states[1]))) {
    throw new Error(`independent ${role} final Safe state disagrees`);
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

const verification = {
  schemaVersion: SAFE_PUBLIC_MIGRATION_VERIFICATION_SCHEMA,
  status:
    "VERIFIED_FINALIZED_HARDWARE_TWO_OF_THREE_MIGRATION_ACTIVATION_NOT_PERFORMED",
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
  controllers: migratedControllers,
  migrationGateSatisfied: true,
  aggregateFinalizedVerificationComplete: true,
  activationAllowed: false,
  activationPerformed: false,
  verified: true,
};
await writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_VERIFIED ${outputPath}\n`,
);
