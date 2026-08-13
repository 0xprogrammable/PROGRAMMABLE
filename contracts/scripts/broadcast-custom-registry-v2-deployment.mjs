import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, getAddress } from "viem";
import { mainnet } from "viem/chains";
import {
  acquireReleaseEvidenceLock,
  assertCanonicalTransactionJournalPath,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";

import {
  REGISTRY_RECEIPT_SCHEMA,
  REGISTRY_STAGED_TRANSACTION_SCHEMA,
  assertRpcProviderBindings,
  assertReviewedAuthorization,
  releaseRpcTransport,
  sha256,
  verifyReviewedAuthorizationSignature,
} from "./custom-registry-v2-deployment-guards.mjs";
import { assertRegistryDeploymentPlan } from "./custom-registry-v2-deployment-plan.mjs";
import { assertRegistryLivePreflight } from "./custom-registry-v2-live-verification.mjs";
import { assertSafeCustodyProof } from "./custom-registry-v2-safe-controller-guards.mjs";
import { verifySafeCustodyRoleReadbacks } from "./custom-registry-v2-keychain-custody.mjs";
import {
  appendDurableJsonLine,
  assertBroadcastObservationEvidence,
  assertDispatchAuthorizedJournal,
  assertExactSerializedEip1559Transaction,
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
if (!recover && !broadcast) throw new Error("explicit --broadcast is required");
if (rebroadcast && (!recover || !broadcast)) {
  throw new Error(
    "recovery rebroadcast requires --recover --rebroadcast --broadcast",
  );
}
if (
  activationIndexes.length !== (recover ? 0 : 1) ||
  (!recover && !/^0x[0-9a-fA-F]{64}$/u.test(activationHash ?? ""))
) {
  throw new Error(
    "initial broadcast requires exactly one explicit --activate-dispatch-intent transaction hash and recovery forbids it",
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
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const readReviewed = async (pathName, digestName, label) => {
  const filePath = assertReleaseEvidencePath(required(pathName));
  const bytes = await readFile(filePath);
  const digest = sha256(bytes);
  if (digest !== required(digestName))
    throw new Error(`${label} digest mismatch`);
  return { bytes, digest, value: JSON.parse(bytes) };
};
const reviewed = await readReviewed(
  "REGISTRY_REVIEWED_PLAN_PATH",
  "REGISTRY_REVIEWED_PLAN_SHA256",
  "reviewed plan",
);
const authorized = await readReviewed(
  "REGISTRY_BROADCAST_AUTHORIZATION_PATH",
  "REGISTRY_BROADCAST_AUTHORIZATION_SHA256",
  "broadcast authorization",
);
const safeEvidence = await readReviewed(
  "REGISTRY_SAFE_VERIFICATION_PATH",
  "REGISTRY_SAFE_VERIFICATION_SHA256",
  "Safe verification",
);
const stagedTransactionPath = assertReleaseEvidencePath(
  required("REGISTRY_STAGED_TRANSACTION_PATH"),
  { mode: 0o400 },
);
const stagedTransactionBytes = await readFile(stagedTransactionPath);
const stagedTransactionSha256 = sha256(stagedTransactionBytes);
if (
  stagedTransactionSha256 !== required("REGISTRY_STAGED_TRANSACTION_SHA256")
) {
  throw new Error("staged Registry transaction digest mismatch");
}
const stagedTransaction = JSON.parse(stagedTransactionBytes);
const plan = reviewed.value;
const authorization = authorized.value;
assertCanonicalTransactionJournalPath({
  candidate: journalPath,
  chainId: 1,
  signer: plan.expectedTransaction.from,
  nonce: plan.expectedTransaction.nonce,
  mustExist: recover,
});
let nowTimestamp = trustedNetworkTime().adjustedTimestamp;
const planInputs = await assertRegistryDeploymentPlan({
  root,
  plan,
  safeVerificationBytes: safeEvidence.bytes,
  nowTimestamp,
  allowExpired: recover,
});
assertReviewedAuthorization({
  authorization,
  preflightSha256: reviewed.digest,
  plan,
  nowTimestamp,
  allowExpired: recover,
});
await verifyReviewedAuthorizationSignature(authorization);
await assertStagedTransactionEvidence({
  evidence: stagedTransaction,
  schemaVersion: REGISTRY_STAGED_TRANSACTION_SCHEMA,
  preflightSha256: reviewed.digest,
  expectedTransaction: plan.expectedTransaction,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
if (
  authorization.stagedTransactionSha256 !== stagedTransactionSha256 ||
  authorization.authorizedTransactionHash !== stagedTransaction.transactionHash
) {
  throw new Error("owner authorization does not bind the staged transaction");
}
const custodyProofPath = assertReleaseEvidencePath(
  required("REGISTRY_CUSTODY_PROOF_PATH"),
);
const custodyProofBytes = await readFile(custodyProofPath);
if (
  sha256(custodyProofBytes) !== plan.safeControllers.custodyProofSha256 ||
  sha256(custodyProofBytes) !== required("REGISTRY_CUSTODY_PROOF_SHA256")
) {
  throw new Error("Registry broadcast custody proof digest mismatch");
}
const custodyProof = JSON.parse(custodyProofBytes);
assertSafeCustodyProof({
  proof: custodyProof,
  deployer: plan.create.deployer,
  admin: plan.constructor.initialAdmin,
  owners: plan.safeControllers.controllers.map(({ owner }) => owner),
});
await verifySafeCustodyRoleReadbacks({ entries: custodyProof.roles });

const rpcA = required("REGISTRY_PREFLIGHT_RPC_URL_A");
const rpcB = required("REGISTRY_PREFLIGHT_RPC_URL_B");
const providerIds = [
  required("REGISTRY_RPC_PROVIDER_ID_A"),
  required("REGISTRY_RPC_PROVIDER_ID_B"),
];
const providerBindings = assertRpcProviderBindings({
  plan,
  providerIds,
  rpcUrls: [rpcA, rpcB],
});
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: releaseRpcTransport(url) }),
);

const appendJournal = (entry, create = false) =>
  appendDurableJsonLine(journalPath, entry, { create });
await acquireReleaseEvidenceLock(journalPath);

if (recover) {
  const entries = await loadDurableJsonLines(journalPath, {
    repairTrailingTornRecord: true,
  });
  const { signed, responseRecords, discoveryRecords, receipt } =
    assertDispatchAuthorizedJournal({
      records: entries,
      schemaVersion: REGISTRY_RECEIPT_SCHEMA,
      signedEvent: "SIGNED_NOT_CONFIRMED",
      transactionHash: stagedTransaction.transactionHash,
      stagedTransactionSha256,
      authorizationSha256: authorized.digest,
      authorization,
      broadcastProviderBindings: providerBindings,
      discoveryProviderBindings: providerBindings,
      allowedTailEvents: [
        "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
        "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
      ],
    });
  if (
    entries[0].preflightSha256 !== reviewed.digest ||
    entries[0].safeVerificationSha256 !== safeEvidence.digest
  ) {
    throw new Error("deployment recovery journal is invalid");
  }
  await assertExactSerializedEip1559Transaction({
    serializedTransaction: signed.serializedTransaction,
    transactionHash: signed.transactionHash,
    expected: plan.expectedTransaction,
  });
  if (receipt) {
    process.stdout.write(
      `CUSTOM_REGISTRY_V2_RECOVERY_RECEIPT_ALREADY_SEEN ${signed.transactionHash}\n`,
    );
    process.exit(0);
  }
  const discoveryTime = trustedNetworkTimeAfter(
    latestJournalTrustedTime(entries),
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
        records: [...entries, discoveryEvidence],
        schemaVersion: REGISTRY_RECEIPT_SCHEMA,
        signedEvent: "SIGNED_NOT_CONFIRMED",
        transactionHash: stagedTransaction.transactionHash,
        stagedTransactionSha256,
        authorizationSha256: authorized.digest,
        authorization,
        broadcastProviderBindings: providerBindings,
        discoveryProviderBindings: providerBindings,
        allowedTailEvents: [
          "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
          "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
        ],
      });
      await appendJournal(discoveryEvidence);
    }
    process.stdout.write(
      `CUSTOM_REGISTRY_V2_RECOVERY_FOUND ${signed.transactionHash}\n`,
    );
    process.exit(0);
  }
  if (!rebroadcast) {
    process.stdout.write(
      `CUSTOM_REGISTRY_V2_RECOVERY_NOT_FOUND ${signed.transactionHash}\n`,
    );
    process.exit(2);
  }
  const recoveryTime = trustedNetworkTimeAfter(
    latestJournalTrustedTime(entries),
  );
  const responses = await Promise.allSettled(
    clients.map((client) =>
      client.sendRawTransaction({
        serializedTransaction: signed.serializedTransaction,
      }),
    ),
  );
  const responseObserved = trustedNetworkTimeAfter(recoveryTime);
  const recoveryEvidence = {
    event: "RECOVERY_EXACT_REBROADCAST",
    requestStartedAtTimestamp: recoveryTime.adjustedTimestamp,
    requestStartedTrustedTime: recoveryTime,
    responseObservedAtTimestamp: responseObserved.adjustedTimestamp,
    responseObservedTrustedTime: responseObserved,
    transactionHash: signed.transactionHash,
    providerResponses: responses.map((result, index) => ({
      providerId: providerIds[index],
      rpcOrigin: providerBindings[index].rpcOrigin,
      rpcEndpointSha256: providerBindings[index].rpcEndpointSha256,
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
    providerBindings,
  });
  assertDispatchAuthorizedJournal({
    records: [...entries, recoveryEvidence],
    schemaVersion: REGISTRY_RECEIPT_SCHEMA,
    signedEvent: "SIGNED_NOT_CONFIRMED",
    transactionHash: stagedTransaction.transactionHash,
    stagedTransactionSha256,
    authorizationSha256: authorized.digest,
    authorization,
    broadcastProviderBindings: providerBindings,
    discoveryProviderBindings: providerBindings,
    allowedTailEvents: [
      "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
      "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
    ],
  });
  await appendJournal(recoveryEvidence);
  if (
    !responses.some(
      (result) =>
        result.status === "fulfilled" &&
        result.value === signed.transactionHash,
    )
  ) {
    throw new Error(
      "exact recovery transaction was not accepted by either RPC",
    );
  }
  process.stdout.write(
    `CUSTOM_REGISTRY_V2_RECOVERY_REBROADCAST ${signed.transactionHash}\n`,
  );
  process.exit(0);
}

await assertRegistryLivePreflight({
  clients,
  providerIds,
  plan,
  planInputs,
});

const signingTime = trustedNetworkTime();
nowTimestamp = signingTime.adjustedTimestamp;
if (
  nowTimestamp > authorization.dispatchIntentExpiresAtTimestamp ||
  nowTimestamp + 60 > plan.expiresAtTimestamp
) {
  throw new Error("authorization or reviewed preflight expired before signing");
}
if (activationHash !== stagedTransaction.transactionHash) {
  throw new Error(
    "explicit --activate-dispatch-intent must equal the owner-authorized transaction hash",
  );
}
const serializedTransaction = stagedTransaction.serializedTransaction;
const transactionHash = stagedTransaction.transactionHash;
await assertExactSerializedEip1559Transaction({
  serializedTransaction,
  transactionHash,
  expected: plan.expectedTransaction,
});
const journalHeader = {
  schemaVersion: REGISTRY_RECEIPT_SCHEMA,
  event: "JOURNAL_OPEN",
  chainId: 1,
  preflightSha256: reviewed.digest,
  authorizationSha256: authorized.digest,
  stagedTransactionSha256,
  safeVerificationSha256: safeEvidence.digest,
  source: plan.source,
  predictedAddress: plan.create.predictedAddress,
  openedAtTimestamp: nowTimestamp,
  authorizationSemantics: authorization.authorizationSemantics,
};
const journalSigned = {
  event: "SIGNED_NOT_CONFIRMED",
  signedAtTimestamp: stagedTransaction.signedAtTimestamp,
  trustedTime: stagedTransaction.trustedTime,
  stagedTransactionSha256,
  transactionHash,
  serializedTransaction,
};
const dispatchIntentTime = trustedNetworkTime();
assertSignedDispatchIntentWindow({
  authorization,
  dispatchIntentTrustedTime: dispatchIntentTime,
});
const journalIntent = {
  event: "DISPATCH_INTENT_ACTIVATED",
  authorizationSha256: authorized.digest,
  authorizationSemantics: authorization.authorizationSemantics,
  activatedAtTimestamp: dispatchIntentTime.adjustedTimestamp,
  activatedTrustedTime: dispatchIntentTime,
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
const requestStarted = trustedNetworkTimeAfter(dispatchIntentTime);
const responses = await Promise.allSettled(
  clients.map((client) => client.sendRawTransaction({ serializedTransaction })),
);
const responseObserved = trustedNetworkTimeAfter(requestStarted);
const responseEvidence = {
  event: "BROADCAST_PROVIDER_RESPONSES",
  requestStartedAtTimestamp: requestStarted.adjustedTimestamp,
  requestStartedTrustedTime: requestStarted,
  responseObservedAtTimestamp: responseObserved.adjustedTimestamp,
  responseObservedTrustedTime: responseObserved,
  transactionHash,
  providerResponses: responses.map((result, index) => ({
    providerId: providerIds[index],
    rpcOrigin: providerBindings[index].rpcOrigin,
    rpcEndpointSha256: providerBindings[index].rpcEndpointSha256,
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
  providerBindings,
});
assertDispatchAuthorizedJournal({
  records: [...activationRecords, responseEvidence],
  schemaVersion: REGISTRY_RECEIPT_SCHEMA,
  signedEvent: "SIGNED_NOT_CONFIRMED",
  transactionHash,
  stagedTransactionSha256,
  authorizationSha256: authorized.digest,
  authorization,
  broadcastProviderBindings: providerBindings,
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
  throw new Error("exact signed Registry transaction was not accepted");
}
const receipt = await Promise.any(
  clients.map((client) =>
    client.waitForTransactionReceipt({
      hash: transactionHash,
      confirmations: 1,
    }),
  ),
);
await appendJournal({
  event: "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
  observedAtTimestamp: Math.floor(Date.now() / 1000),
  transactionHash,
  status: receipt.status,
  contractAddress: receipt.contractAddress,
  blockNumber: receipt.blockNumber.toString(),
  blockHash: receipt.blockHash,
});
if (
  receipt.status !== "success" ||
  getAddress(receipt.contractAddress) !==
    getAddress(plan.create.predictedAddress)
) {
  throw new Error("Registry deployment receipt failed or address mismatched");
}
process.stdout.write(
  `CUSTOM_REGISTRY_V2_BROADCAST_AWAITING_FINALITY ${transactionHash} ${journalPath}\n`,
);
