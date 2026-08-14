import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, getAddress, hexToBigInt, keccak256 } from "viem";
import { mainnet } from "viem/chains";

import {
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import {
  assertRpcProviderBindings,
  createRpcProviderBindings,
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
  assertHardwareMigrationInventory,
  assertSafePublicMigrationReleaseAuthorization,
  assertSafePublicMigrationContinuationEvidence,
  assertSafePublicMigrationPolicy,
  assertSafePublicMigrationReceiptLogs,
  assertSafePublicMigrationReceiptTime,
  classifySafePublicMigrationState,
  safePublicMigrationTransaction,
  safeTransactionHash,
} from "./custom-registry-v2-safe-public-migration-guards.mjs";
import { commonFinalizedBlock } from "./custom-registry-v2-live-verification.mjs";
import {
  assertSafeMigrationContinuationExecutionBinding,
  assertSafeMigrationReceiptFollowsDispatchIntent,
  assertSafeMigrationSignerNonceAvailable,
  readSafeMigrationExecutionBundleContext,
} from "./custom-registry-v2-safe-public-migration-execution.mjs";
import { trustedNetworkTime } from "./custom-registry-v2-transaction-journal.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
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
  if (sha256(bytes) !== required(digestName)) {
    throw new Error(`${label} digest mismatch`);
  }
  return { bytes, digest: sha256(bytes), value: JSON.parse(bytes) };
};
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required");
}
const outputPath = assertReleaseEvidenceOutput(process.argv[outputIndex + 1]);
const rpcUrls = [
  required("REGISTRY_PREFLIGHT_RPC_URL_A"),
  required("REGISTRY_PREFLIGHT_RPC_URL_B"),
];
requireDistinctRpcOrigins(...rpcUrls);
const providerIds = [
  required("REGISTRY_RPC_PROVIDER_ID_A"),
  required("REGISTRY_RPC_PROVIDER_ID_B"),
];
const rpcProviderBindings = createRpcProviderBindings(providerIds, rpcUrls);
const maxFeePerGas = BigInt(required("REGISTRY_MIGRATION_MAX_FEE_PER_GAS"));
const maxPriorityFeePerGas = BigInt(
  required("REGISTRY_MIGRATION_MAX_PRIORITY_FEE_PER_GAS"),
);
const maxTotalCostWei = BigInt(required("REGISTRY_MIGRATION_MAX_TOTAL_COST_WEI"));
if (
  maxFeePerGas <= 0n ||
  maxPriorityFeePerGas <= 0n ||
  maxPriorityFeePerGas > maxFeePerGas ||
  maxTotalCostWei <= 0n
) {
  throw new Error("migration fee ceilings are invalid");
}

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
const continuationPathValue =
  process.env.REGISTRY_SAFE_MIGRATION_CONTINUATION_PATH?.trim();
const continuationDigestValue =
  process.env.REGISTRY_SAFE_MIGRATION_CONTINUATION_SHA256?.trim();
if (Boolean(continuationPathValue) !== Boolean(continuationDigestValue)) {
  throw new Error("continuation path and digest must be supplied together");
}
let continuation = null;
if (continuationPathValue) {
  const continuationPath = assertReleaseEvidencePath(continuationPathValue);
  const bytes = await readFile(continuationPath);
  const digest = sha256(bytes);
  if (digest !== continuationDigestValue) {
    throw new Error("hardware migration continuation digest mismatch");
  }
  continuation = { bytes, digest, value: JSON.parse(bytes) };
}
const policyPath = path.join(
  root,
  "config/custom-registry-v2-safe-public-migration-policy.json",
);
const safePolicyPath = path.join(
  root,
  "config/custom-registry-v2-safe-controller-policy.json",
);
const releasePolicyPath = path.join(
  root,
  "config/custom-registry-v2-release-policy.json",
);
const predeploymentPath = path.join(
  root,
  "contracts/spec/custom-registry-v2-predeployment.json",
);
const policyBytes = await readFile(policyPath);
const safePolicyBytes = await readFile(safePolicyPath);
const releasePolicyBytes = await readFile(releasePolicyPath);
const predeploymentBytes = await readFile(predeploymentPath);
const policy = assertSafePublicMigrationPolicy(JSON.parse(policyBytes));
const safePolicy = JSON.parse(safePolicyBytes);
const releasePolicy = JSON.parse(releasePolicyBytes);
const predeployment = JSON.parse(predeploymentBytes);
if (
  dark.value.schemaVersion !== SAFE_VERIFICATION_SCHEMA ||
  dark.value.status !== "VERIFIED_FINALIZED_ATOMIC_SAFE_CONTROLLERS" ||
  dark.value.verified !== true ||
  dark.value.chainId !== 1 ||
  execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim() !== dark.value.source?.commit ||
  execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], {
    cwd: root,
    encoding: "utf8",
  }).trim() !== dark.value.source?.tree ||
  execFileSync("/usr/bin/git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }) !== ""
) {
  throw new Error("hardware migration requires exact clean dark release source");
}
if (
  releasePolicy.schemaVersion !==
    "programmable.custom-registry-release-policy.v4" ||
  releasePolicy.activationAllowed !== true ||
  predeployment.schemaVersion !==
    "programmable.custom-registry-predeployment.v4" ||
  predeployment.activationAllowed !== true ||
  predeployment.status !== "SOURCE_ONLY_NOT_DEPLOYED"
) {
  throw new Error("public migration requires the active temporary custody release policy");
}
assertSafePublicMigrationReleaseAuthorization({
  actual: predeployment.releaseAuthorization,
  expected: predeployment.releaseAuthorization,
  releaseOwner: dark.value.releaseOwner,
});
const forbiddenAddresses = [
  dark.value.deployer,
  dark.value.admin,
  dark.value.releaseOwner,
  dark.value.singleton.address,
  dark.value.proxyFactory.address,
  dark.value.multiSendCallOnly.address,
];
const createdAtTrustedTime = trustedNetworkTime();
const nowTimestamp = createdAtTrustedTime.adjustedTimestamp;
const inventory = await assertHardwareMigrationInventory({
  inventory: hardware.value,
  darkSafeVerification: dark.value,
  darkSafeVerificationSha256: dark.digest,
  policySha256: sha256(policyBytes),
  forbiddenAddresses,
  nowTimestamp,
  trustedTime: createdAtTrustedTime,
});
if (inventory.proofWindow.expiresAtTimestamp < nowTimestamp + 600) {
  throw new Error("hardware proof window does not cover the full preflight lifetime");
}
const clients = rpcUrls.map((url) =>
  createPublicClient({ chain: mainnet, transport: releaseRpcTransport(url) }),
);
if ((await Promise.all(clients.map((client) => client.getChainId()))).some((id) => id !== 1)) {
  throw new Error("hardware migration RPC is not Ethereum mainnet");
}
const finalized = await commonFinalizedBlock(clients);
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
  throw new Error("migration MultiSendCallOnly runtime is invalid");
}
const allHardware = inventory.intentRoles.flatMap(({ hardwareOwners }) =>
  hardwareOwners.map((value) => getAddress(value)),
);
const hardwareCodes = await Promise.all(
  clients.map((client) =>
    Promise.all(
      allHardware.map((address) =>
        client.getCode({ address, blockNumber: finalized.number }),
      ),
    ),
  ),
);
const currentHardwareCodes = await Promise.all(
  clients.map((client) =>
    Promise.all(
      allHardware.map((address) => client.getCode({ address, blockTag: "latest" })),
    ),
  ),
);
if (
  hardwareCodes.some((codes) => codes.some((code) => code && code !== "0x")) ||
  currentHardwareCodes.some((codes) =>
    codes.some((code) => code && code !== "0x"),
  )
) {
  throw new Error("hardware owner must be an undelegated code-free EOA");
}
const liveFees = await Promise.all(
  clients.map((client) => client.estimateFeesPerGas({ type: "eip1559" })),
);
const currentBlocks = await Promise.all(
  clients.map((client) => client.getBlock({ blockTag: "latest" })),
);
const observedMaxFeePerGas = liveFees.reduce(
  (maximum, fees) =>
    fees.maxFeePerGas > maximum ? fees.maxFeePerGas : maximum,
  0n,
);
const observedMaxPriorityFeePerGas = liveFees.reduce(
  (maximum, fees) =>
    fees.maxPriorityFeePerGas > maximum
      ? fees.maxPriorityFeePerGas
      : maximum,
  0n,
);
if (
  maxFeePerGas < observedMaxFeePerGas ||
  maxPriorityFeePerGas < observedMaxPriorityFeePerGas
) {
  throw new Error("migration fee ceilings are below current two-provider fees");
}

const roleStates = [];
const transactions = [];
for (const [index, roleEntry] of inventory.intentRoles.entries()) {
  const darkController = dark.value.controllers[index];
  const safe = getAddress(roleEntry.safe);
  const legacyOwner = getAddress(roleEntry.legacyOwner);
  const [
    safeStates,
    safeNonces,
    ownerPendingNonces,
    ownerFinalizedNonces,
    balances,
    finalizedOwnerCodes,
    currentOwnerCodes,
  ] =
    await Promise.all([
      Promise.all(
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
            client.getCode({ address: safe, blockNumber: finalized.number }),
            client.readContract({ address: safe, abi: SAFE_READ_ABI, functionName: "VERSION", blockNumber: finalized.number }),
            client.readContract({ address: safe, abi: SAFE_READ_ABI, functionName: "masterCopy", blockNumber: finalized.number }),
            client.readContract({ address: safe, abi: SAFE_READ_ABI, functionName: "getOwners", blockNumber: finalized.number }),
            client.readContract({ address: safe, abi: SAFE_READ_ABI, functionName: "getThreshold", blockNumber: finalized.number }),
            client.readContract({ address: safe, abi: SAFE_READ_ABI, functionName: "nonce", blockNumber: finalized.number }),
            client.readContract({ address: safe, abi: SAFE_READ_ABI, functionName: "getModulesPaginated", args: ["0x0000000000000000000000000000000000000001", 10n], blockNumber: finalized.number }),
            client.readContract({ address: safe, abi: SAFE_READ_ABI, functionName: "getStorageAt", args: [hexToBigInt(safePolicy.storageSlots.fallbackHandler), 1n], blockNumber: finalized.number }),
            client.readContract({ address: safe, abi: SAFE_READ_ABI, functionName: "getStorageAt", args: [hexToBigInt(safePolicy.storageSlots.guard), 1n], blockNumber: finalized.number }),
          ]);
          return {
            runtimeCodeKeccak256: keccak256(code ?? "0x"),
            version,
            masterCopy,
            owners,
            threshold,
            safeNonce,
            modules: modulesPage[0],
            nextModule: modulesPage[1],
            fallbackStorage,
            guardStorage,
          };
        }),
      ),
      Promise.all(
        clients.map((client) =>
          client.readContract({
            address: safe,
            abi: SAFE_READ_ABI,
            functionName: "nonce",
            blockNumber: finalized.number,
          }),
        ),
      ),
      Promise.all(
        clients.map((client) =>
          client.getTransactionCount({
            address: legacyOwner,
            blockTag: "pending",
          }),
        ),
      ),
      Promise.all(
        clients.map((client) =>
          client.getTransactionCount({
            address: legacyOwner,
            blockNumber: finalized.number,
          }),
        ),
      ),
      Promise.all(
        clients.map((client) =>
          client.getBalance({ address: legacyOwner, blockTag: "latest" }),
        ),
      ),
      Promise.all(
        clients.map((client) =>
          client.getCode({ address: legacyOwner, blockNumber: finalized.number }),
        ),
      ),
      Promise.all(
        clients.map((client) =>
          client.getCode({ address: legacyOwner, blockTag: "latest" }),
        ),
      ),
    ]);
  const classifications = safeStates.map((actual) =>
    classifySafePublicMigrationState({
      actual,
      expected: {
        safe,
        legacyOwner,
        hardwareOwners: roleEntry.hardwareOwners,
        proxyRuntimeCodeKeccak256:
          dark.value.proxyFactory.proxyRuntimeCodeKeccak256,
        safeVersion: safePolicy.safeVersion,
        singleton: dark.value.singleton.address,
      },
    }),
  );
  if (
    classifications[0] !== classifications[1] ||
    safeNonces[0] !== safeNonces[1]
  ) {
    throw new Error(`${roleEntry.role} Safe migration state disagrees across RPCs`);
  }
  const migration = safePublicMigrationTransaction({
    safe,
    legacyOwner,
    hardwareOwners: roleEntry.hardwareOwners,
    safeNonce: 0n,
    multiSendCallOnly: policy.multiSendCallOnly.address,
  });
  const localSafeTxHash = safeTransactionHash({
    safe,
    transaction: migration.safeTransaction,
  });
  roleStates.push({
    role: roleEntry.role,
    safe,
    legacyOwner,
    hardwareOwners: roleEntry.hardwareOwners,
    expectedOwners: migration.expectedOwners,
    classification: classifications[0],
    expectedSafeTransactionHash: localSafeTxHash,
    completedMigration: null,
  });
  if (classifications[0] === "MIGRATED_HARDWARE_TWO_OF_THREE_FINALIZED") {
    continue;
  }
  const ownerNonce = assertSafeMigrationSignerNonceAvailable({
    signer: legacyOwner,
    pendingNonces: ownerPendingNonces,
    finalizedNonces: ownerFinalizedNonces,
  });
  if (balances[0] !== balances[1]) {
    throw new Error(`${roleEntry.role} current-owner balance disagrees`);
  }
  if (
    finalizedOwnerCodes.some((code) => code && code !== "0x") ||
    currentOwnerCodes.some((code) => code && code !== "0x")
  ) {
    throw new Error(`${roleEntry.role} current owner must be a code-free EOA`);
  }
  const remoteSafeTxHashes = await Promise.all(
    clients.map((client) =>
      client.readContract({
        address: safe,
        abi: SAFE_PUBLIC_MIGRATION_ABI,
        functionName: "getTransactionHash",
        args: [
          migration.safeTransaction.to,
          0n,
          migration.safeTransaction.data,
          1,
          0n,
          0n,
          0n,
          migration.safeTransaction.gasToken,
          migration.safeTransaction.refundReceiver,
          safeNonces[0],
        ],
        blockNumber: finalized.number,
      }),
    ),
  );
  if (remoteSafeTxHashes.some((hash) => hash !== localSafeTxHash)) {
    throw new Error(`${roleEntry.role} Safe transaction hash disagrees`);
  }
  const simulations = await Promise.all(
    clients.map((client) =>
      client.call({
        account: legacyOwner,
        to: safe,
        data: migration.execTransactionData,
        value: 0n,
        blockNumber: finalized.number,
      }),
    ),
  );
  if (simulations.some(({ data }) => !data || BigInt(data) !== 1n)) {
    throw new Error(`${roleEntry.role} migration simulation did not return true`);
  }
  const estimates = await Promise.all(
    clients.map((client) =>
      client.estimateGas({
        account: legacyOwner,
        to: safe,
        data: migration.execTransactionData,
        value: 0n,
      }),
    ),
  );
  const gasLimit =
    (estimates.reduce((max, value) => (value > max ? value : max), 0n) * 120n) /
    100n;
  const maximumCostWei = gasLimit * maxFeePerGas;
  if (
    balances[0] < maximumCostWei ||
    currentBlocks.some((block) => gasLimit >= block.gasLimit)
  ) {
    throw new Error(`${roleEntry.role} migration gas funding is insufficient`);
  }
  transactions.push({
    role: roleEntry.role,
    safe,
    legacyOwner,
    hardwareOwners: roleEntry.hardwareOwners,
    expectedOwners: migration.expectedOwners,
    expectedThreshold: 2,
    expectedSafeNonceBefore: safeNonces[0].toString(),
    expectedSafeNonceAfter: (safeNonces[0] + 1n).toString(),
    safeTransactionHash: localSafeTxHash,
    outerTransaction: {
      type: "eip1559",
      chainId: 1,
      from: legacyOwner,
      to: safe,
      input: migration.execTransactionData,
      valueWei: "0",
      nonce: ownerNonce,
      gasLimit: gasLimit.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    },
    gasEstimates: estimates.map(String),
    maximumCostWei: maximumCostWei.toString(),
    legacyOwnerBalanceWei: balances[0].toString(),
    sourceControllerTransactionHash: darkController.transactionHash,
  });
}

const migratedRoles = roleStates
  .filter(
    ({ classification }) =>
      classification === "MIGRATED_HARDWARE_TWO_OF_THREE_FINALIZED",
  )
  .map(({ role }) => role);
if ((migratedRoles.length === 0) !== (continuation === null)) {
  throw new Error(
    "continuation evidence is required exactly when finalized migrations exist",
  );
}
let completedMigrations = [];
if (continuation) {
  const completedByRole = assertSafePublicMigrationContinuationEvidence({
    evidence: continuation.value.continuation ?? continuation.value,
    migrationPlanDigest: inventory.migrationPlanDigest,
    migratedRoles,
  });
  for (const state of roleStates.filter(({ role }) => migratedRoles.includes(role))) {
    const completed = completedByRole.get(state.role);
    const execution = await readSafeMigrationExecutionBundleContext({
      bundlePath: completed.executionBundlePath,
      bundleSha256: completed.executionBundleSha256,
      nowTimestamp,
      allowExpired: true,
    });
    assertSafeMigrationContinuationExecutionBinding({
      entry: completed,
      execution,
      executionBundlePath: completed.executionBundlePath,
      executionBundleSha256: completed.executionBundleSha256,
      migrationPlanDigest: inventory.migrationPlanDigest,
      source: dark.value.source,
      darkSafeVerificationSha256: dark.digest,
      policySha256: sha256(policyBytes),
      safeControllerPolicySha256: sha256(safePolicyBytes),
      releasePolicySha256: sha256(releasePolicyBytes),
      predeploymentManifestSha256: sha256(predeploymentBytes),
      hardwareInventorySha256: hardware.digest,
      releaseAuthorization: predeployment.releaseAuthorization,
    });
    const journalReceipt = execution.journalRecords.find(
      ({ event }) => event === "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
    );
    if (
      JSON.stringify(execution.plannedRole.outerTransaction) !==
      JSON.stringify({
        type: "eip1559",
        chainId: 1,
        from: state.legacyOwner,
        to: state.safe,
        input: completed.reviewedTransaction.input,
        valueWei: "0",
        nonce: completed.reviewedTransaction.nonce,
        gasLimit: completed.reviewedTransaction.gasLimit,
        maxFeePerGas: completed.reviewedTransaction.maxFeePerGas,
        maxPriorityFeePerGas:
          completed.reviewedTransaction.maxPriorityFeePerGas,
      })
    ) {
      throw new Error(`${state.role} completed execution plan is invalid`);
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
          getAddress(transaction.from) !== getAddress(state.legacyOwner) ||
          getAddress(transaction.to) !== getAddress(state.safe) ||
          transaction.input !== completed.reviewedTransaction.input ||
          transaction.input !==
            safePublicMigrationTransaction({
              safe: state.safe,
              legacyOwner: state.legacyOwner,
              hardwareOwners: state.hardwareOwners,
              safeNonce: 0n,
              multiSendCallOnly: policy.multiSendCallOnly.address,
            }).execTransactionData ||
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
          receipt.logs.some(
            (log) =>
              log.transactionHash !== completed.transactionHash ||
              log.blockHash !== receipt.blockHash ||
              log.blockNumber !== receipt.blockNumber ||
              log.removed === true,
          )
        ) {
          throw new Error(`${state.role} completed migration evidence is invalid`);
        }
        assertSafePublicMigrationReceiptLogs({
          logs: receipt.logs,
          safe: state.safe,
          legacyOwner: state.legacyOwner,
          hardwareOwners: state.hardwareOwners,
          safeTransactionHash: state.expectedSafeTransactionHash,
        });
        assertSafePublicMigrationReceiptTime({
          receiptBlockTimestamp: receiptBlock.timestamp,
          plan: {
            createdAtTimestamp:
              completed.sourcePlanWindow.createdAtTimestamp,
            expiresAtTimestamp:
              completed.sourcePlanWindow.expiresAtTimestamp,
            createdAtTrustedTime:
              completed.sourcePlanWindow.createdAtTrustedTime,
            hardwareProofWindow: inventory.proofWindow,
          },
        });
        assertSafeMigrationReceiptFollowsDispatchIntent({
          receiptBlockTimestamp: receiptBlock.timestamp,
          execution,
        });
        if (Number(receiptBlock.timestamp) !== completed.receiptBlockTimestamp) {
          throw new Error(`${state.role} completed receipt timestamp is invalid`);
        }
        return {
          transactionHash: transaction.hash,
          blockHash: receipt.blockHash,
          blockNumber: receipt.blockNumber.toString(),
          transactionIndex: receipt.transactionIndex,
          gasUsed: receipt.gasUsed.toString(),
          effectiveGasPrice: receipt.effectiveGasPrice.toString(),
        };
      }),
    );
    if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) {
      throw new Error(`${state.role} completed migration RPC evidence disagrees`);
    }
    state.completedMigration = completed;
    completedMigrations.push(completed);
  }
}

const aggregateMaximumCostWei = transactions.reduce(
  (total, transaction) => total + BigInt(transaction.maximumCostWei),
  0n,
);
if (aggregateMaximumCostWei > maxTotalCostWei) {
  throw new Error("aggregate migration maximum cost exceeds owner ceiling");
}
const closingAnchors = await Promise.all(
  clients.map((client) => client.getBlock({ blockNumber: finalized.number })),
);
if (closingAnchors.some(({ hash }) => hash !== finalized.hash)) {
  throw new Error("hardware migration finalized anchor drifted during preflight");
}

const plan = {
  schemaVersion: SAFE_PUBLIC_MIGRATION_PLAN_SCHEMA,
  status: "PREFLIGHT_ONLY_TWELVE_HARDWARE_KEYS_NO_SIGNING_NO_BROADCAST",
  chainId: 1,
  source: dark.value.source,
  darkSafeVerificationSha256: dark.digest,
  hardwareInventorySha256: hardware.digest,
  policySha256: sha256(policyBytes),
  safeControllerPolicySha256: sha256(safePolicyBytes),
  releasePolicySha256: sha256(releasePolicyBytes),
  predeploymentManifestSha256: sha256(predeploymentBytes),
  migrationPlanDigest: inventory.migrationPlanDigest,
  releaseAuthorization: {
    owner: getAddress(predeployment.releaseAuthorization.owner),
    maximumDispatchIntentAuthorizationValiditySeconds:
      predeployment.releaseAuthorization
        .maximumDispatchIntentAuthorizationValiditySeconds,
    authorizationSemantics:
      predeployment.releaseAuthorization.authorizationSemantics,
    stagedRawTransactionTrustBoundary:
      predeployment.releaseAuthorization.stagedRawTransactionTrustBoundary,
    dispatchIntentFinalConfirmation:
      predeployment.releaseAuthorization.dispatchIntentFinalConfirmation,
    nonceScopedJournalExclusivity:
      predeployment.releaseAuthorization.nonceScopedJournalExclusivity,
  },
  hardwareProofWindow: inventory.proofWindow,
  continuationEvidenceSha256: continuation?.digest ?? null,
  roleStates,
  completedMigrations,
  remainingRoles: transactions.map(({ role }) => role),
  rpcProviders: providerIds,
  rpcProviderBindings,
  finalizedAnchor: {
    blockNumber: finalized.number.toString(),
    blockHash: finalized.hash,
  },
  transactions,
  feeReview: {
    observedMaxFeePerGas: liveFees.map(({ maxFeePerGas }) =>
      maxFeePerGas.toString(),
    ),
    observedMaxPriorityFeePerGas: liveFees.map(({ maxPriorityFeePerGas }) =>
      maxPriorityFeePerGas.toString(),
    ),
    reviewedMaxFeePerGas: maxFeePerGas.toString(),
    reviewedMaxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    aggregateMaximumCostWei: aggregateMaximumCostWei.toString(),
    ownerAggregateCostCeilingWei: maxTotalCostWei.toString(),
    currentBlockGasLimits: currentBlocks.map(({ gasLimit }) =>
      gasLimit.toString(),
    ),
    currentBaseFeesPerGas: currentBlocks.map(({ baseFeePerGas }) =>
      (baseFeePerGas ?? 0n).toString(),
    ),
  },
  aggregateFinalizedVerificationRequired: true,
  activationAllowed: false,
  signingAllowed: false,
  broadcastAllowed: false,
  createdAtTimestamp: nowTimestamp,
  createdAtTrustedTime,
  expiresAtTimestamp: nowTimestamp + 600,
};
assertRpcProviderBindings({ plan, providerIds, rpcUrls });
await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_PREFLIGHT ${outputPath}\n`,
);
