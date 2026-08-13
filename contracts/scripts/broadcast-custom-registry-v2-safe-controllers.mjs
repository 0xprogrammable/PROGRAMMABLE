import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, getAddress, keccak256 } from "viem";
import { mainnet } from "viem/chains";
import {
  acquireReleaseEvidenceLock,
  assertCanonicalTransactionJournalPath,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import { verifySafeCustodyRoleReadbacks } from "./custom-registry-v2-keychain-custody.mjs";

import {
  SAFE_FACTORY_ABI,
  SAFE_RECEIPTS_SCHEMA,
  SAFE_READ_ABI,
  SAFE_STAGED_TRANSACTION_SCHEMA,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
  assertSafeReviewedAuthorization,
  verifySafeReviewedAuthorizationSignature,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import {
  FLASHBOTS_PRIVATE_SUBMISSION,
  assertRpcProviderBindings,
  createRpcProviderBinding,
  releaseRpcTransport,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  appendDurableJsonLine,
  assertBroadcastObservationEvidence,
  assertDispatchAuthorizedJournal,
  assertExactSerializedEip1559Transaction,
  assertSignedDispatchIntentWindow,
  assertStagedTransactionEvidence,
  assertTransactionDiscoveryEvidence,
  createDurableJsonLines,
  loadDurableJsonLines,
  latestJournalTrustedTime,
  trustedNetworkTime,
  trustedNetworkTimeAfter,
} from "./custom-registry-v2-transaction-journal.mjs";

const broadcast = process.argv.includes("--broadcast");
const recover = process.argv.includes("--recover");
const rebroadcast = process.argv.includes("--rebroadcast");
const activationIndexes = process.argv.flatMap((value, index) =>
  value === "--activate-dispatch-intent" ? [index] : [],
);
const activationIndex = activationIndexes[0] ?? -1;
const activationHash =
  activationIndex === -1 ? null : process.argv[activationIndex + 1];
if (!broadcast) throw new Error("explicit --broadcast is required");
if (rebroadcast && !recover) {
  throw new Error(
    "Safe rebroadcast requires --recover --rebroadcast --broadcast",
  );
}
if (
  activationIndexes.length !== (recover ? 0 : 1) ||
  (!recover && !/^0x[0-9a-fA-F]{64}$/u.test(activationHash ?? ""))
) {
  throw new Error(
    "initial Safe broadcast requires exactly one explicit --activate-dispatch-intent transaction hash and recovery forbids it",
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
const journalPath = assertReleaseEvidencePath(process.argv[outputIndex + 1], {
  mustExist: recover,
});
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
const plan = reviewed.value;
const authorization = authorized.value;
assertCanonicalTransactionJournalPath({
  candidate: journalPath,
  chainId: 1,
  signer: plan.atomicTransaction.from,
  nonce: plan.atomicTransaction.nonce,
  mustExist: recover,
});
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
  throw new Error(
    "owner authorization does not bind the staged Safe transaction",
  );
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
await verifySafeCustodyRoleReadbacks({ entries: plan.custody.roles });

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
const privateSubmissionRpcUrl =
  process.env.REGISTRY_SAFE_PRIVATE_SUBMISSION_RPC_URL;
if (!privateSubmissionRpcUrl) {
  throw new Error("private Safe submission endpoint is required");
}
const privateSubmissionBinding = createRpcProviderBinding(
  process.env.REGISTRY_SAFE_PRIVATE_SUBMISSION_PROVIDER_ID,
  privateSubmissionRpcUrl,
);
if (
  JSON.stringify(privateSubmissionBinding) !==
    JSON.stringify({
      providerId: plan.privateSubmission?.providerId,
      sanitizedUrl: plan.privateSubmission?.sanitizedUrl,
    }) ||
  plan.privateSubmission?.privacyMode !==
    FLASHBOTS_PRIVATE_SUBMISSION.privacyMode ||
  plan.privateSubmission?.method !== FLASHBOTS_PRIVATE_SUBMISSION.method
) {
  throw new Error("private Safe submission binding drifted from reviewed plan");
}
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: releaseRpcTransport(url) }),
);
const privateSubmissionClient = createPublicClient({
  chain: mainnet,
  transport: releaseRpcTransport(privateSubmissionRpcUrl),
});
const appendJournal = (entry, create = false) =>
  appendDurableJsonLine(journalPath, entry, { create });
await acquireReleaseEvidenceLock(journalPath);

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
  const { signed, responseRecords, discoveryRecords, receipt, completion } =
    assertDispatchAuthorizedJournal({
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
  if (records[0].preflightSha256 !== reviewed.digest) {
    throw new Error("Safe atomic recovery journal is invalid");
  }
  await validateSigned(signed);
  if (completion) {
    process.stdout.write("CUSTOM_REGISTRY_V2_SAFE_RECOVERY_ALREADY_COMPLETE\n");
    process.exit(0);
  }
  if (receipt) {
    await appendJournal({
      event: "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
      observedAtTimestamp: trustedNetworkTime().adjustedTimestamp,
      transactionHash: signed.transactionHash,
    });
    process.stdout.write(
      "CUSTOM_REGISTRY_V2_SAFE_RECOVERY_COMPLETED_RECEIPT_TAIL\n",
    );
    process.exit(0);
  }
  const discoveryTime = trustedNetworkTimeAfter(
    latestJournalTrustedTime(records),
  );
  const discovered = await Promise.all(
    clients.map(async (client, index) => {
      try {
        const transaction = await client.getTransaction({
          hash: signed.transactionHash,
        });
        if (transaction.hash !== signed.transactionHash) {
          throw new Error("RPC returned a different transaction");
        }
        return {
          providerId: providerBindings[index].providerId,
          rpcOrigin: providerBindings[index].rpcOrigin,
          rpcEndpointSha256: providerBindings[index].rpcEndpointSha256,
          found: true,
          transactionHash: transaction.hash,
          blockNumber: transaction.blockNumber?.toString() ?? null,
        };
      } catch {
        return {
          providerId: providerBindings[index].providerId,
          rpcOrigin: providerBindings[index].rpcOrigin,
          rpcEndpointSha256: providerBindings[index].rpcEndpointSha256,
          found: false,
          transactionHash: null,
          blockNumber: null,
        };
      }
    }),
  );
  if (discovered.every(({ found }) => found)) {
    if (discoveryRecords.length === 0) {
      const discoveryEvidence = {
        event: "RECOVERY_TRANSACTION_DISCOVERY",
        discoveredAtTimestamp: discoveryTime.adjustedTimestamp,
        discoveredTrustedTime: discoveryTime,
        transactionHash: signed.transactionHash,
        providers: discovered,
      };
      assertTransactionDiscoveryEvidence({
        evidence: discoveryEvidence,
        transactionHash: signed.transactionHash,
        providerBindings,
      });
      assertDispatchAuthorizedJournal({
        records: [...records, discoveryEvidence],
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
      await appendJournal(discoveryEvidence);
    }
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
  const recoveryTime = trustedNetworkTimeAfter(
    latestJournalTrustedTime(records),
  );
  const results = await Promise.allSettled([
    privateSubmissionClient.sendRawTransaction({
      serializedTransaction: signed.serializedTransaction,
    }),
  ]);
  const responseObserved = trustedNetworkTimeAfter(recoveryTime);
  const recoveryEvidence = {
    event: "RECOVERY_EXACT_REBROADCAST",
    requestStartedAtTimestamp: recoveryTime.adjustedTimestamp,
    requestStartedTrustedTime: recoveryTime,
    responseObservedAtTimestamp: responseObserved.adjustedTimestamp,
    responseObservedTrustedTime: responseObserved,
    transactionHash: signed.transactionHash,
    providerResponses: results.map((result, index) => ({
      providerId: privateSubmissionBinding.providerId,
      sanitizedUrl: privateSubmissionBinding.sanitizedUrl,
      status: result.status,
      ...(result.status === "fulfilled"
        ? { transactionHash: result.value }
        : { errorName: result.reason?.name ?? "Error" }),
    })),
  };
  assertBroadcastObservationEvidence({
    evidence: recoveryEvidence,
    event: "RECOVERY_EXACT_REBROADCAST",
    transactionHash: signed.transactionHash,
    providerBindings: [privateSubmissionBinding],
  });
  assertDispatchAuthorizedJournal({
    records: [...records, recoveryEvidence],
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
  await appendJournal(recoveryEvidence);
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
    ({ code, nonce }) => (code && code !== "0x") || nonce !== 0,
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

const signingTime = trustedNetworkTime();
if (activationHash !== stagedTransaction.transactionHash) {
  throw new Error(
    "explicit --activate-dispatch-intent must equal the owner-authorized Safe transaction hash",
  );
}
const serializedTransaction = stagedTransaction.serializedTransaction;
const transactionHash = stagedTransaction.transactionHash;
await assertExactSerializedEip1559Transaction({
  serializedTransaction,
  transactionHash,
  expected: plan.atomicTransaction,
});
const journalHeader = {
  schemaVersion: SAFE_RECEIPTS_SCHEMA,
  event: "JOURNAL_OPEN",
  chainId: 1,
  preflightSha256: reviewed.digest,
  authorizationSha256: authorized.digest,
  stagedTransactionSha256,
  source: plan.source,
  policySha256: plan.policySha256,
  custodyProofSha256: plan.custodyProofSha256,
  authorizationSemantics: authorization.authorizationSemantics,
  openedAtTimestamp: signingTime.adjustedTimestamp,
};
const journalSigned = {
  event: "SIGNED_ATOMIC_NOT_CONFIRMED",
  signedAtTimestamp: stagedTransaction.signedAtTimestamp,
  trustedTime: stagedTransaction.trustedTime,
  stagedTransactionSha256,
  transactionHash,
  serializedTransaction,
};
const requestStarted = trustedNetworkTime();
assertSignedDispatchIntentWindow({
  authorization,
  dispatchIntentTrustedTime: requestStarted,
});
const journalIntent = {
  event: "DISPATCH_INTENT_ACTIVATED",
  authorizationSha256: authorized.digest,
  authorizationSemantics: authorization.authorizationSemantics,
  activatedAtTimestamp: requestStarted.adjustedTimestamp,
  activatedTrustedTime: requestStarted,
  transactionHash,
  exactSerializedTransactionOnly: true,
  changedTransactionRequiresFreshAuthorization: true,
  workflowCancellationAllowed: false,
};
await createDurableJsonLines(journalPath, [
  journalHeader,
  journalSigned,
  journalIntent,
]);
const activationRecords = [journalHeader, journalSigned, journalIntent];
const networkRequestStarted = trustedNetworkTimeAfter(requestStarted);
const responses = await Promise.allSettled([
  privateSubmissionClient.sendRawTransaction({ serializedTransaction }),
]);
const responseObserved = trustedNetworkTimeAfter(networkRequestStarted);
const responseEvidence = {
  event: "BROADCAST_PROVIDER_RESPONSES",
  requestStartedAtTimestamp: networkRequestStarted.adjustedTimestamp,
  requestStartedTrustedTime: networkRequestStarted,
  responseObservedAtTimestamp: responseObserved.adjustedTimestamp,
  responseObservedTrustedTime: responseObserved,
  transactionHash,
  providerResponses: responses.map((result, index) => ({
    providerId: privateSubmissionBinding.providerId,
    sanitizedUrl: privateSubmissionBinding.sanitizedUrl,
    status: result.status,
    ...(result.status === "fulfilled"
      ? { transactionHash: result.value }
      : { errorName: result.reason?.name ?? "Error" }),
  })),
};
assertBroadcastObservationEvidence({
  evidence: responseEvidence,
  event: "BROADCAST_PROVIDER_RESPONSES",
  transactionHash,
  providerBindings: [privateSubmissionBinding],
});
assertDispatchAuthorizedJournal({
  records: [...activationRecords, responseEvidence],
  schemaVersion: SAFE_RECEIPTS_SCHEMA,
  signedEvent: "SIGNED_ATOMIC_NOT_CONFIRMED",
  transactionHash,
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
await appendJournal(responseEvidence);
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
