import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  getAddress,
  hexToBigInt,
  http,
  keccak256,
} from "viem";
import { mainnet } from "viem/chains";

import {
  SAFE_FACTORY_ABI,
  SAFE_READ_ABI,
  SAFE_RECEIPTS_SCHEMA,
  SAFE_VERIFICATION_SCHEMA,
  assertAtomicProxyCreationLogs,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
  assertSafeReviewedAuthorization,
  assertSafeRuntimeState,
  verifySafeReviewedAuthorizationSignature,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import { requireDistinctRpcOrigins } from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertExactSerializedEip1559Transaction,
  assertSignedAttemptWindow,
  assertTrustedTimeEvidence,
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
const outputPath = path.resolve(process.argv[outputIndex + 1]);
if (!outputPath.startsWith("/tmp/")) {
  throw new Error("Safe verification output must be under /tmp");
}
const sha256 = (bytes) =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;
const readReviewed = async (envPath, envDigest, label) => {
  const filePath = path.resolve(process.env[envPath] ?? "");
  if (!filePath.startsWith("/tmp/")) {
    throw new Error(`${label} must be under /tmp`);
  }
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
const receiptJournalPath = path.resolve(
  process.env.REGISTRY_SAFE_DEPLOYMENT_RECEIPTS_PATH ?? "",
);
if (!receiptJournalPath.startsWith("/tmp/")) {
  throw new Error("Safe deployment receipt journal must be under /tmp");
}
const receiptJournalBytes = await readFile(receiptJournalPath);
const receiptJournalDigest = sha256(receiptJournalBytes);
if (
  receiptJournalDigest !== process.env.REGISTRY_SAFE_DEPLOYMENT_RECEIPTS_SHA256
) {
  throw new Error("Safe deployment receipt journal digest mismatch");
}
const records = await loadDurableJsonLines(receiptJournalPath);
const header = records[0];
const signedRecords = records.filter(
  ({ event }) => event === "SIGNED_ATOMIC_NOT_CONFIRMED",
);
const signed = signedRecords[0];
const responseRecords = records.filter(
  ({ event }) => event === "BROADCAST_PROVIDER_RESPONSES",
);
const response = responseRecords[0];
const plan = reviewed.value;
const authorization = authorized.value;
assertSafePreflightEnvelope(plan, 0, { allowExpired: true });
assertSafeReviewedAuthorization({
  authorization,
  preflightSha256: reviewed.digest,
  plan,
  nowTimestamp: 0,
  allowExpired: true,
});
await verifySafeReviewedAuthorizationSignature(authorization);
if (
  header?.schemaVersion !== SAFE_RECEIPTS_SCHEMA ||
  header.event !== "JOURNAL_OPEN" ||
  header.chainId !== 1 ||
  header.preflightSha256 !== reviewed.digest ||
  header.authorizationSha256 !== authorized.digest ||
  header.source?.commit !== plan.source.commit ||
  header.source?.tree !== plan.source.tree ||
  header.policySha256 !== plan.policySha256 ||
  header.custodyProofSha256 !== plan.custodyProofSha256 ||
  signedRecords.length !== 1 ||
  records.indexOf(signed) !== 1 ||
  responseRecords.length !== 1 ||
  response.transactionHash !== signed.transactionHash ||
  records.indexOf(response) < 2 ||
  records.some(
    (entry) =>
      entry.transactionHash !== undefined &&
      entry.transactionHash !== signed.transactionHash,
  ) ||
  JSON.stringify(
    response.providerResponses?.map(({ providerId }) => providerId),
  ) !== JSON.stringify(plan.rpcProviders) ||
  response.providerResponses?.some(
    (entry) =>
      entry.status === "fulfilled" &&
      entry.transactionHash !== signed.transactionHash,
  ) ||
  !response.providerResponses?.some(
    (entry) =>
      entry.status === "fulfilled" &&
      entry.transactionHash === signed.transactionHash,
  )
) {
  throw new Error("Safe atomic deployment journal is invalid");
}
assertTrustedTimeEvidence(signed.trustedTime, signed.signedAtTimestamp);
assertTrustedTimeEvidence(
  response.requestStartedTrustedTime,
  response.requestStartedAtTimestamp,
);
await assertExactSerializedEip1559Transaction({
  serializedTransaction: signed.serializedTransaction,
  transactionHash: signed.transactionHash,
  expected: plan.atomicTransaction,
});
assertSignedAttemptWindow({
  authorization,
  signedAt: signed.signedAtTimestamp,
  firstAttemptAt: response.requestStartedAtTimestamp,
});

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  commit !== plan.source.commit ||
  tree !== plan.source.tree ||
  execFileSync("git", ["status", "--porcelain"], {
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
requireDistinctRpcOrigins(rpcA, rpcB);
const providerIds = [
  process.env.REGISTRY_RPC_PROVIDER_ID_A,
  process.env.REGISTRY_RPC_PROVIDER_ID_B,
];
if (JSON.stringify(providerIds) !== JSON.stringify(plan.rpcProviders)) {
  throw new Error("Safe RPC provider identity drifted from reviewed plan");
}
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
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
    if (
      receipt.status !== "success" ||
      receipt.contractAddress !== null ||
      receipt.blockNumber > commonFinalizedNumber ||
      transaction.blockNumber !== receipt.blockNumber ||
      transaction.blockHash !== receipt.blockHash ||
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
        safeNonce !== 0n ||
        balance !== 0n
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
