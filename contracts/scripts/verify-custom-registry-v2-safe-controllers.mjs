import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, getAddress, hexToBigInt, keccak256 } from "viem";
import { mainnet } from "viem/chains";
import {
  assertCanonicalTransactionJournalPath,
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";

import {
  SAFE_FACTORY_ABI,
  SAFE_READ_ABI,
  SAFE_RECEIPTS_SCHEMA,
  SAFE_STAGED_TRANSACTION_SCHEMA,
  SAFE_VERIFICATION_SCHEMA,
  assertAtomicProxyCreationLogs,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
  assertSafeReviewedAuthorization,
  assertSafeRuntimeState,
  verifySafeReviewedAuthorizationSignature,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import {
  assertFinalizedReceiptAfterDispatchIntent,
  assertRpcProviderBindings,
  createRpcProviderBinding,
  releaseRpcTransport,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertDispatchAuthorizedJournal,
  assertExactSerializedEip1559Transaction,
  assertStagedTransactionEvidence,
  loadDurableJsonLines,
} from "./custom-registry-v2-transaction-journal.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required");
}
const outputPath = assertReleaseEvidenceOutput(process.argv[outputIndex + 1]);
const sha256 = (bytes) =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;
const readReviewed = async (envPath, envDigest, label) => {
  const filePath = assertReleaseEvidencePath(process.env[envPath] ?? "");
  const bytes = await readFile(filePath);
  const digest = sha256(bytes);
  if (digest !== process.env[envDigest]) {
    throw new Error(`${label} digest mismatch`);
  }
  return { bytes, digest, value: JSON.parse(bytes) };
};
const reviewed = await readReviewed(
  "REGISTRY_SAFE_REVIEWED_PLAN_PATH",
  "REGISTRY_SAFE_REVIEWED_PLAN_SHA256",
  "reviewed Safe plan",
);
const authorized = await readReviewed(
  "REGISTRY_SAFE_BROADCAST_AUTHORIZATION_PATH",
  "REGISTRY_SAFE_BROADCAST_AUTHORIZATION_SHA256",
  "Safe broadcast authorization",
);
const stagedTransactionPath = assertReleaseEvidencePath(
  process.env.REGISTRY_SAFE_STAGED_TRANSACTION_PATH ?? "",
  { mode: 0o400 },
);
const stagedTransactionBytes = await readFile(stagedTransactionPath);
const stagedTransactionSha256 = sha256(stagedTransactionBytes);
if (
  stagedTransactionSha256 !==
  process.env.REGISTRY_SAFE_STAGED_TRANSACTION_SHA256
) {
  throw new Error("staged Safe transaction digest mismatch");
}
const stagedTransaction = JSON.parse(stagedTransactionBytes);
const receiptJournalPath = assertReleaseEvidencePath(
  process.env.REGISTRY_SAFE_DEPLOYMENT_RECEIPTS_PATH ?? "",
);
const receiptJournalBytes = await readFile(receiptJournalPath);
const receiptJournalDigest = sha256(receiptJournalBytes);
if (
  receiptJournalDigest !== process.env.REGISTRY_SAFE_DEPLOYMENT_RECEIPTS_SHA256
) {
  throw new Error("Safe deployment receipt journal digest mismatch");
}
const records = await loadDurableJsonLines(receiptJournalPath);
const plan = reviewed.value;
const authorization = authorized.value;
assertCanonicalTransactionJournalPath({
  candidate: receiptJournalPath,
  chainId: 1,
  signer: plan.atomicTransaction.from,
  nonce: plan.atomicTransaction.nonce,
  mustExist: true,
});
assertSafePreflightEnvelope(plan, 0, { allowExpired: true });
assertSafeReviewedAuthorization({
  authorization,
  preflightSha256: reviewed.digest,
  plan,
  nowTimestamp: 0,
  allowExpired: true,
});
await verifySafeReviewedAuthorizationSignature(authorization);
await assertStagedTransactionEvidence({
  evidence: stagedTransaction,
  schemaVersion: SAFE_STAGED_TRANSACTION_SCHEMA,
  preflightSha256: reviewed.digest,
  expectedTransaction: plan.atomicTransaction,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
if (
  authorization.stagedTransactionSha256 !== stagedTransactionSha256 ||
  authorization.authorizedTransactionHash !== stagedTransaction.transactionHash
) {
  throw new Error("owner authorization does not bind staged Safe transaction");
}
const commit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const tree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  commit !== plan.source.commit ||
  tree !== plan.source.tree ||
  execFileSync("/usr/bin/git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }) !== ""
) {
  throw new Error("Safe verification source identity drifted");
}
const policyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
);
const manifestBytes = await readFile(
  path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
);
assertSafePolicyBoundPlan({
  plan,
  policy: JSON.parse(policyBytes),
  manifest: JSON.parse(manifestBytes),
  sourceManifestSha256: sha256(manifestBytes),
});

const rpcA = process.env.REGISTRY_PREFLIGHT_RPC_URL_A;
const rpcB = process.env.REGISTRY_PREFLIGHT_RPC_URL_B;
if (!rpcA || !rpcB) throw new Error("two RPC endpoints are required");
const providerIds = [
  process.env.REGISTRY_RPC_PROVIDER_ID_A,
  process.env.REGISTRY_RPC_PROVIDER_ID_B,
];
const providerBindings = assertRpcProviderBindings({
  plan,
  providerIds,
  rpcUrls: [rpcA, rpcB],
});
const privateSubmissionBinding = createRpcProviderBinding(
  process.env.REGISTRY_SAFE_PRIVATE_SUBMISSION_PROVIDER_ID,
  process.env.REGISTRY_SAFE_PRIVATE_SUBMISSION_RPC_URL,
);
if (
  JSON.stringify(privateSubmissionBinding) !==
  JSON.stringify({
    providerId: plan.privateSubmission?.providerId,
    sanitizedUrl: plan.privateSubmission?.sanitizedUrl,
  })
) {
  throw new Error("private Safe submission binding drifted from reviewed plan");
}
const { signed, intent } = assertDispatchAuthorizedJournal({
  records,
  schemaVersion: SAFE_RECEIPTS_SCHEMA,
  signedEvent: "SIGNED_ATOMIC_NOT_CONFIRMED",
  transactionHash: stagedTransaction.transactionHash,
  stagedTransactionSha256,
  authorizationSha256: authorized.digest,
  authorization,
  broadcastProviderBindings: [privateSubmissionBinding],
  discoveryProviderBindings: providerBindings,
  allowedTailEvents: [
    "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
    "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
  ],
});
if (
  records[0].chainId !== 1 ||
  records[0].preflightSha256 !== reviewed.digest ||
  records[0].source?.commit !== plan.source.commit ||
  records[0].source?.tree !== plan.source.tree ||
  records[0].policySha256 !== plan.policySha256 ||
  records[0].custodyProofSha256 !== plan.custodyProofSha256
) {
  throw new Error("Safe atomic deployment journal release binding is invalid");
}
await assertExactSerializedEip1559Transaction({
  serializedTransaction: signed.serializedTransaction,
  transactionHash: signed.transactionHash,
  expected: plan.atomicTransaction,
});
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: releaseRpcTransport(url) }),
);
const finalizedHeads = await Promise.all(
  clients.map((client) => client.getBlock({ blockTag: "finalized" })),
);
const commonFinalizedNumber =
  finalizedHeads[0].number < finalizedHeads[1].number
    ? finalizedHeads[0].number
    : finalizedHeads[1].number;
const [finalizedA, finalizedB, reviewedAnchorA, reviewedAnchorB] =
  await Promise.all([
    clients[0].getBlock({ blockNumber: commonFinalizedNumber }),
    clients[1].getBlock({ blockNumber: commonFinalizedNumber }),
    clients[0].getBlock({
      blockNumber: BigInt(plan.commonFinalizedAnchor.blockNumber),
    }),
    clients[1].getBlock({
      blockNumber: BigInt(plan.commonFinalizedAnchor.blockNumber),
    }),
  ]);
if (
  finalizedA.hash !== finalizedB.hash ||
  reviewedAnchorA.hash !== plan.commonFinalizedAnchor.blockHash ||
  reviewedAnchorB.hash !== plan.commonFinalizedAnchor.blockHash
) {
  throw new Error("independent finalized Safe anchors disagree");
}
const officialBindings = await Promise.all(
  clients.map(async (client) => {
    const [
      singletonCode,
      singletonVersion,
      factoryCode,
      proxyCreationCode,
      multiSendCode,
    ] = await Promise.all([
      client.getCode({
        address: plan.singleton.address,
        blockNumber: commonFinalizedNumber,
      }),
      client.readContract({
        address: plan.singleton.address,
        abi: SAFE_READ_ABI,
        functionName: "VERSION",
        blockNumber: commonFinalizedNumber,
      }),
      client.getCode({
        address: plan.proxyFactory.address,
        blockNumber: commonFinalizedNumber,
      }),
      client.readContract({
        address: plan.proxyFactory.address,
        abi: SAFE_FACTORY_ABI,
        functionName: "proxyCreationCode",
        blockNumber: commonFinalizedNumber,
      }),
      client.getCode({
        address: plan.multiSendCallOnly.address,
        blockNumber: commonFinalizedNumber,
      }),
    ]);
    return {
      singletonCode,
      singletonVersion,
      factoryCode,
      proxyCreationCode,
      multiSendCode,
    };
  }),
);
if (
  officialBindings.some(
    (binding) =>
      keccak256(binding.singletonCode) !==
        plan.singleton.runtimeCodeKeccak256 ||
      binding.singletonVersion !== plan.safeVersion ||
      keccak256(binding.factoryCode) !==
        plan.proxyFactory.runtimeCodeKeccak256 ||
      keccak256(binding.proxyCreationCode) !==
        plan.proxyFactory.proxyCreationCodeKeccak256 ||
      keccak256(binding.multiSendCode) !==
        plan.multiSendCallOnly.runtimeCodeKeccak256,
  ) ||
  JSON.stringify(officialBindings[0]) !== JSON.stringify(officialBindings[1])
) {
  throw new Error("official atomic Safe runtime binding failed");
}

const observations = await Promise.all(
  clients.map(async (client) => {
    const [transaction, receipt] = await Promise.all([
      client.getTransaction({ hash: signed.transactionHash }),
      client.getTransactionReceipt({ hash: signed.transactionHash }),
    ]);
    const receiptBlock = await client.getBlock({
      blockNumber: receipt.blockNumber,
    });
    assertFinalizedReceiptAfterDispatchIntent({
      receiptBlockTimestamp: receiptBlock.timestamp,
      dispatchIntentTrustedTime: intent.activatedTrustedTime,
    });
    if (
      receipt.status !== "success" ||
      transaction.hash !== signed.transactionHash ||
      receipt.transactionHash !== signed.transactionHash ||
      receipt.contractAddress !== null ||
      receipt.blockNumber > commonFinalizedNumber ||
      transaction.blockNumber !== receipt.blockNumber ||
      transaction.blockHash !== receipt.blockHash ||
      receiptBlock.number !== receipt.blockNumber ||
      receiptBlock.hash !== receipt.blockHash ||
      getAddress(transaction.from) !==
        getAddress(plan.atomicTransaction.from) ||
      getAddress(transaction.to) !== getAddress(plan.atomicTransaction.to) ||
      transaction.input !== plan.atomicTransaction.input ||
      transaction.value !== 0n ||
      transaction.nonce !== plan.atomicTransaction.nonce ||
      transaction.chainId !== 1 ||
      transaction.gas !== BigInt(plan.atomicTransaction.gasLimit) ||
      transaction.maxFeePerGas !==
        BigInt(plan.atomicTransaction.maxFeePerGas) ||
      transaction.maxPriorityFeePerGas !==
        BigInt(plan.atomicTransaction.maxPriorityFeePerGas) ||
      receiptBlock.timestamp < BigInt(authorization.notBeforeTimestamp)
    ) {
      throw new Error("finalized atomic Safe transaction differs from plan");
    }
    assertAtomicProxyCreationLogs({
      logs: receipt.logs,
      factory: plan.proxyFactory.address,
      controllers: plan.controllers,
      singleton: plan.singleton.address,
    });
    if (
      receipt.logs.some(
        (log) =>
          log.transactionHash !== signed.transactionHash ||
          log.blockHash !== receipt.blockHash ||
          log.blockNumber !== receipt.blockNumber ||
          log.removed === true,
      )
    ) {
      throw new Error(
        "Safe receipt log metadata differs from canonical receipt",
      );
    }
    return { transaction, receipt, receiptBlock };
  }),
);
if (
  observations[0].transaction.hash !== observations[1].transaction.hash ||
  observations[0].receipt.blockNumber !== observations[1].receipt.blockNumber ||
  observations[0].receipt.blockHash !== observations[1].receipt.blockHash ||
  observations[0].receiptBlock.timestamp !==
    observations[1].receiptBlock.timestamp
) {
  throw new Error("independent atomic Safe transaction evidence disagrees");
}

const verifiedControllers = [];
for (const controller of plan.controllers) {
  const states = await Promise.all(
    clients.map(async (client) => {
      const [
        code,
        version,
        masterCopy,
        owners,
        threshold,
        safeNonce,
        balance,
        modulesPage,
        fallbackStorage,
        guardStorage,
      ] = await Promise.all([
        client.getCode({
          address: controller.predictedAddress,
          blockNumber: commonFinalizedNumber,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "VERSION",
          blockNumber: commonFinalizedNumber,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "masterCopy",
          blockNumber: commonFinalizedNumber,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getOwners",
          blockNumber: commonFinalizedNumber,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getThreshold",
          blockNumber: commonFinalizedNumber,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "nonce",
          blockNumber: commonFinalizedNumber,
        }),
        client.getBalance({
          address: controller.predictedAddress,
          blockNumber: commonFinalizedNumber,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getModulesPaginated",
          args: ["0x0000000000000000000000000000000000000001", 10n],
          blockNumber: commonFinalizedNumber,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getStorageAt",
          args: [hexToBigInt(plan.storageSlots.fallbackHandler), 1n],
          blockNumber: commonFinalizedNumber,
        }),
        client.readContract({
          address: controller.predictedAddress,
          abi: SAFE_READ_ABI,
          functionName: "getStorageAt",
          args: [hexToBigInt(plan.storageSlots.guard), 1n],
          blockNumber: commonFinalizedNumber,
        }),
      ]);
      if (
        !code ||
        code === "0x" ||
        keccak256(code) !== plan.proxyFactory.proxyRuntimeCodeKeccak256 ||
        safeNonce !== 0n
      ) {
        throw new Error(`${controller.role} SafeProxy runtime mismatch`);
      }
      const [modules, nextModule] = modulesPage;
      assertSafeRuntimeState({
        actual: {
          version,
          masterCopy,
          owners,
          threshold,
          modules,
          nextModule,
          fallbackStorage,
          guardStorage,
        },
        expected: {
          version: plan.safeVersion,
          singleton: plan.singleton.address,
          owner: controller.owner,
        },
      });
      return {
        runtimeCodeKeccak256: keccak256(code),
        owner: getAddress(owners[0]),
        threshold: threshold.toString(),
        safeNonce: safeNonce.toString(),
        balance: balance.toString(),
      };
    }),
  );
  if (JSON.stringify(states[0]) !== JSON.stringify(states[1])) {
    throw new Error(`independent ${controller.role} Safe states disagree`);
  }
  verifiedControllers.push({
    role: controller.role,
    address: controller.predictedAddress,
    owner: controller.owner,
    transactionHash: signed.transactionHash,
    blockNumber: observations[0].receipt.blockNumber.toString(),
    blockHash: observations[0].receipt.blockHash,
    runtimeCodeKeccak256: states[0].runtimeCodeKeccak256,
    masterCopy: plan.singleton.address,
    threshold: "1",
    modules: [],
    fallbackHandler: "0x0000000000000000000000000000000000000000",
    guard: "0x0000000000000000000000000000000000000000",
  });
}

const closingFinalized = await Promise.all(
  clients.map((client) =>
    client.getBlock({ blockNumber: commonFinalizedNumber }),
  ),
);
if (closingFinalized.some(({ hash }) => hash !== finalizedA.hash)) {
  throw new Error("finalized Safe snapshot drifted during verification");
}

const verification = {
  schemaVersion: SAFE_VERIFICATION_SCHEMA,
  status: "VERIFIED_FINALIZED_ATOMIC_SAFE_CONTROLLERS",
  chainId: 1,
  source: plan.source,
  preflightSha256: reviewed.digest,
  authorizationSha256: authorized.digest,
  receiptsSha256: receiptJournalDigest,
  policySha256: plan.policySha256,
  custodyProofSha256: plan.custodyProofSha256,
  proxyFactory: plan.proxyFactory,
  singleton: plan.singleton,
  multiSendCallOnly: plan.multiSendCallOnly,
  atomicTransactionHash: signed.transactionHash,
  finalizedAnchor: {
    blockNumber: commonFinalizedNumber.toString(),
    blockHash: finalizedA.hash,
  },
  deployer: plan.deployer,
  admin: plan.admin,
  releaseOwner: plan.releaseAuthorization.owner,
  controllers: verifiedControllers,
  verified: true,
};
await writeFile(outputPath, `${JSON.stringify(verification, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_CONTROLLERS_VERIFIED ${outputPath}\n`,
);
