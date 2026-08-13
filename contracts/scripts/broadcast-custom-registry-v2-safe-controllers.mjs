import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, getAddress, http, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import {
  SAFE_FACTORY_ABI,
  SAFE_RECEIPTS_SCHEMA,
  SAFE_READ_ABI,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
  assertSafeReviewedAuthorization,
  verifySafeReviewedAuthorizationSignature,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import { requireDistinctRpcOrigins } from "./custom-registry-v2-deployment-guards.mjs";
import {
  appendDurableJsonLine,
  assertExactSerializedEip1559Transaction,
  assertSignedAttemptWindow,
  loadDurableJsonLines,
  trustedNetworkTime,
} from "./custom-registry-v2-transaction-journal.mjs";

const broadcast = process.argv.includes("--broadcast");
const recover = process.argv.includes("--recover");
const rebroadcast = process.argv.includes("--rebroadcast");
if (!broadcast) throw new Error("explicit --broadcast is required");
if (rebroadcast && !recover) {
  throw new Error(
    "Safe rebroadcast requires --recover --rebroadcast --broadcast",
  );
}
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required");
}
const journalPath = path.resolve(process.argv[outputIndex + 1]);
if (!journalPath.startsWith("/tmp/")) {
  throw new Error("Safe receipt journal must be under /tmp");
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
const plan = reviewed.value;
const authorization = authorized.value;
const initialNow = recover ? 0 : trustedNetworkTime().adjustedTimestamp;
assertSafePreflightEnvelope(plan, initialNow, { allowExpired: recover });
assertSafeReviewedAuthorization({
  authorization,
  preflightSha256: reviewed.digest,
  plan,
  nowTimestamp: initialNow,
  allowExpired: recover,
});
await verifySafeReviewedAuthorizationSignature(authorization);

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
  throw new Error("Safe broadcast source identity drifted");
}
const policyBytes = await readFile(
  path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
);
if (sha256(policyBytes) !== plan.policySha256) {
  throw new Error("Safe controller policy drifted");
}
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
if (
  providerIds.some((value) => !value) ||
  JSON.stringify(providerIds) !== JSON.stringify(plan.rpcProviders) ||
  providerIds[0].toLowerCase() === providerIds[1].toLowerCase()
) {
  throw new Error("two distinct Safe RPC provider identities are required");
}
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
);
const appendJournal = (entry, create = false) =>
  appendDurableJsonLine(journalPath, entry, { create });

const validateSigned = async (signed) => {
  if (
    signed?.event !== "SIGNED_ATOMIC_NOT_CONFIRMED" ||
    !signed.serializedTransaction ||
    keccak256(signed.serializedTransaction) !== signed.transactionHash
  ) {
    throw new Error("Safe atomic signed evidence is invalid");
  }
  await assertExactSerializedEip1559Transaction({
    serializedTransaction: signed.serializedTransaction,
    transactionHash: signed.transactionHash,
    expected: plan.atomicTransaction,
  });
};

if (recover) {
  const records = await loadDurableJsonLines(journalPath, {
    repairTrailingTornRecord: true,
  });
  const header = records[0];
  const signedRecords = records.filter(
    ({ event }) => event === "SIGNED_ATOMIC_NOT_CONFIRMED",
  );
  const signed = signedRecords[0];
  const responseRecords = records.filter(
    ({ event }) => event === "BROADCAST_PROVIDER_RESPONSES",
  );
  const response = responseRecords[0];
  const completed = records.filter(
    ({ event }) =>
      event === "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
  );
  if (
    header?.schemaVersion !== SAFE_RECEIPTS_SCHEMA ||
    header.event !== "JOURNAL_OPEN" ||
    header.preflightSha256 !== reviewed.digest ||
    header.authorizationSha256 !== authorized.digest ||
    signedRecords.length !== 1 ||
    records.indexOf(signed) !== 1 ||
    responseRecords.length > 1 ||
    (response &&
      (response.transactionHash !== signed.transactionHash ||
        records.indexOf(response) < 2)) ||
    completed.length > 1
  ) {
    throw new Error("Safe atomic recovery journal is invalid");
  }
  await validateSigned(signed);
  if (completed.length === 1) {
    process.stdout.write("CUSTOM_REGISTRY_V2_SAFE_RECOVERY_ALREADY_COMPLETE\n");
    process.exit(0);
  }
  const discovered = await Promise.all(
    clients.map(async (client) => {
      try {
        const transaction = await client.getTransaction({
          hash: signed.transactionHash,
        });
        return { found: true, blockNumber: transaction.blockNumber };
      } catch {
        return { found: false, blockNumber: null };
      }
    }),
  );
  if (discovered.some(({ found }) => found)) {
    process.stdout.write(
      `CUSTOM_REGISTRY_V2_SAFE_RECOVERY_FOUND ${signed.transactionHash}\n`,
    );
    process.exit(0);
  }
  if (!rebroadcast) {
    process.stdout.write(
      `CUSTOM_REGISTRY_V2_SAFE_RECOVERY_NOT_FOUND ${signed.transactionHash}\n`,
    );
    process.exit(2);
  }
  const recoveryTime = trustedNetworkTime();
  const timelyAcceptedAttempt = response?.providerResponses?.some(
    (entry) =>
      entry.status === "fulfilled" &&
      entry.transactionHash === signed.transactionHash,
  );
  if (
    recoveryTime.adjustedTimestamp >
      authorization.firstAttemptExpiresAtTimestamp &&
    !timelyAcceptedAttempt
  ) {
    throw new Error(
      "expired Safe recovery lacks a durable timely accepted attempt; fresh authorization is required",
    );
  }
  assertSignedAttemptWindow({
    authorization,
    signedAt: signed.signedAtTimestamp,
    firstAttemptAt:
      response?.requestStartedAtTimestamp ?? recoveryTime.adjustedTimestamp,
  });
  const results = await Promise.allSettled(
    clients.map((client) =>
      client.sendRawTransaction({
        serializedTransaction: signed.serializedTransaction,
      }),
    ),
  );
  await appendJournal({
    event: response
      ? "RECOVERY_EXACT_REBROADCAST"
      : "BROADCAST_PROVIDER_RESPONSES",
    requestStartedAtTimestamp: recoveryTime.adjustedTimestamp,
    requestStartedTrustedTime: recoveryTime,
    responseObservedAtTimestamp: trustedNetworkTime().adjustedTimestamp,
    transactionHash: signed.transactionHash,
    providerResponses: results.map((result, index) => ({
      providerId: providerIds[index],
      status: result.status,
      ...(result.status === "fulfilled"
        ? { transactionHash: result.value }
        : { errorName: result.reason?.name ?? "Error" }),
    })),
  });
  if (
    !results.some(
      (result) =>
        result.status === "fulfilled" &&
        result.value === signed.transactionHash,
    )
  ) {
    throw new Error("exact Safe atomic recovery transaction was not accepted");
  }
  process.stdout.write(
    `CUSTOM_REGISTRY_V2_SAFE_RECOVERY_REBROADCAST ${signed.transactionHash}\n`,
  );
  process.exit(0);
}

const live = await Promise.all(
  clients.map(async (client) => {
    const [
      chainId,
      finalized,
      latest,
      nonce,
      balance,
      priorityFee,
      singletonCode,
      version,
      factoryCode,
      proxyCreationCode,
      multiSendCode,
      controllerState,
    ] = await Promise.all([
      client.getChainId(),
      client.getBlock({ blockTag: "finalized" }),
      client.getBlock({ blockTag: "latest" }),
      client.getTransactionCount({
        address: plan.deployer,
        blockTag: "pending",
      }),
      client.getBalance({ address: plan.deployer, blockTag: "latest" }),
      client.estimateMaxPriorityFeePerGas(),
      client.getCode({ address: plan.singleton.address, blockTag: "latest" }),
      client.readContract({
        address: plan.singleton.address,
        abi: SAFE_READ_ABI,
        functionName: "VERSION",
      }),
      client.getCode({
        address: plan.proxyFactory.address,
        blockTag: "latest",
      }),
      client.readContract({
        address: plan.proxyFactory.address,
        abi: SAFE_FACTORY_ABI,
        functionName: "proxyCreationCode",
      }),
      client.getCode({
        address: plan.multiSendCallOnly.address,
        blockTag: "latest",
      }),
      Promise.all(
        plan.controllers.map(async ({ predictedAddress }) => ({
          code: await client.getCode({
            address: predictedAddress,
            blockTag: "latest",
          }),
          nonce: await client.getTransactionCount({
            address: predictedAddress,
            blockTag: "latest",
          }),
          balance: await client.getBalance({
            address: predictedAddress,
            blockTag: "latest",
          }),
        })),
      ),
    ]);
    return {
      chainId,
      finalized,
      latest,
      nonce,
      balance,
      priorityFee,
      singletonCode,
      version,
      factoryCode,
      proxyCreationCode,
      multiSendCode,
      controllerState,
    };
  }),
);
const [a, b] = live;
const commonFinalizedNumber =
  a.finalized.number < b.finalized.number
    ? a.finalized.number
    : b.finalized.number;
const [commonA, commonB, reviewedAnchorA, reviewedAnchorB] = await Promise.all([
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
  a.chainId !== 1 ||
  b.chainId !== 1 ||
  commonA.hash !== commonB.hash ||
  reviewedAnchorA.hash !== plan.commonFinalizedAnchor.blockHash ||
  reviewedAnchorB.hash !== plan.commonFinalizedAnchor.blockHash ||
  a.nonce !== b.nonce ||
  a.nonce !== plan.exactPendingNonce ||
  a.balance !== b.balance ||
  a.proxyCreationCode !== b.proxyCreationCode ||
  keccak256(a.singletonCode) !== plan.singleton.runtimeCodeKeccak256 ||
  keccak256(b.singletonCode) !== plan.singleton.runtimeCodeKeccak256 ||
  a.version !== plan.safeVersion ||
  b.version !== plan.safeVersion ||
  keccak256(a.factoryCode) !== plan.proxyFactory.runtimeCodeKeccak256 ||
  keccak256(b.factoryCode) !== plan.proxyFactory.runtimeCodeKeccak256 ||
  keccak256(a.multiSendCode) !== plan.multiSendCallOnly.runtimeCodeKeccak256 ||
  keccak256(b.multiSendCode) !== plan.multiSendCallOnly.runtimeCodeKeccak256 ||
  [...a.controllerState, ...b.controllerState].some(
    ({ code, nonce, balance }) =>
      (code && code !== "0x") || nonce !== 0 || balance !== 0n,
  )
) {
  throw new Error("live atomic Safe broadcast state drifted from plan");
}
const observedFeePerGas = live.reduce((maximum, observation) => {
  const observed =
    (observation.latest.baseFeePerGas ?? 0n) * 2n + observation.priorityFee;
  return observed > maximum ? observed : maximum;
}, 0n);
if (
  observedFeePerGas > BigInt(plan.reviewedMaxFeePerGas) ||
  a.balance < BigInt(plan.maximumTotalCostWei) ||
  BigInt(plan.atomicTransaction.gasLimit) >= a.latest.gasLimit ||
  BigInt(plan.atomicTransaction.gasLimit) >= b.latest.gasLimit
) {
  throw new Error("live Safe atomic broadcast economics exceed plan");
}

const custody = plan.custody.roles.find(({ role }) => role === "deployer");
if (
  custody?.service !==
    "programmable.custom-registry.v2.production-custody.20260813.deployer" ||
  getAddress(custody.publicAddress) !== getAddress(plan.deployer)
) {
  throw new Error("reviewed Safe deployer custody is invalid");
}
const privateKey = execFileSync(
  "security",
  [
    "find-generic-password",
    "-w",
    "-s",
    custody.service,
    "-a",
    getAddress(plan.deployer),
  ],
  { encoding: "utf8", maxBuffer: 4096 },
).trim();
if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
  throw new Error("Safe deployer Keychain custody item is invalid");
}
const account = privateKeyToAccount(privateKey);
if (getAddress(account.address) !== getAddress(plan.deployer)) {
  throw new Error("Safe deployer key mismatch");
}
const signingTime = trustedNetworkTime();
assertSignedAttemptWindow({
  authorization,
  signedAt: signingTime.adjustedTimestamp,
  firstAttemptAt: signingTime.adjustedTimestamp,
});
const serializedTransaction = await account.signTransaction({
  chainId: 1,
  type: "eip1559",
  to: plan.atomicTransaction.to,
  data: plan.atomicTransaction.input,
  value: 0n,
  nonce: plan.atomicTransaction.nonce,
  gas: BigInt(plan.atomicTransaction.gasLimit),
  maxFeePerGas: BigInt(plan.atomicTransaction.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(plan.atomicTransaction.maxPriorityFeePerGas),
});
const transactionHash = keccak256(serializedTransaction);
await assertExactSerializedEip1559Transaction({
  serializedTransaction,
  transactionHash,
  expected: plan.atomicTransaction,
});
await appendJournal(
  {
    schemaVersion: SAFE_RECEIPTS_SCHEMA,
    event: "JOURNAL_OPEN",
    chainId: 1,
    preflightSha256: reviewed.digest,
    authorizationSha256: authorized.digest,
    source: plan.source,
    policySha256: plan.policySha256,
    custodyProofSha256: plan.custodyProofSha256,
    authorizationSemantics: authorization.authorizationSemantics,
    openedAtTimestamp: signingTime.adjustedTimestamp,
  },
  true,
);
await appendJournal({
  event: "SIGNED_ATOMIC_NOT_CONFIRMED",
  signedAtTimestamp: signingTime.adjustedTimestamp,
  trustedTime: signingTime,
  transactionHash,
  serializedTransaction,
});
const requestStarted = trustedNetworkTime();
assertSignedAttemptWindow({
  authorization,
  signedAt: signingTime.adjustedTimestamp,
  firstAttemptAt: requestStarted.adjustedTimestamp,
});
const responses = await Promise.allSettled(
  clients.map((client) => client.sendRawTransaction({ serializedTransaction })),
);
await appendJournal({
  event: "BROADCAST_PROVIDER_RESPONSES",
  requestStartedAtTimestamp: requestStarted.adjustedTimestamp,
  requestStartedTrustedTime: requestStarted,
  responseObservedAtTimestamp: trustedNetworkTime().adjustedTimestamp,
  transactionHash,
  providerResponses: responses.map((result, index) => ({
    providerId: providerIds[index],
    status: result.status,
    ...(result.status === "fulfilled"
      ? { transactionHash: result.value }
      : { errorName: result.reason?.name ?? "Error" }),
  })),
});
if (
  !responses.some(
    (result) =>
      result.status === "fulfilled" && result.value === transactionHash,
  )
) {
  throw new Error("exact signed atomic Safe transaction was not accepted");
}
const receipt = await Promise.any(
  clients.map((client) =>
    client.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
    }),
  ),
);
if (receipt.status !== "success" || receipt.contractAddress !== null) {
  throw new Error("atomic Safe transaction failed");
}
await appendJournal({
  event: "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
  observedAtTimestamp: trustedNetworkTime().adjustedTimestamp,
  transactionHash,
  blockNumber: receipt.blockNumber.toString(),
  blockHash: receipt.blockHash,
});
await appendJournal({
  event: "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
  observedAtTimestamp: trustedNetworkTime().adjustedTimestamp,
  transactionHash,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_ATOMIC_RECEIPT ${transactionHash} ${journalPath}\n`,
);
