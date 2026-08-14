import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPublicClient, getAddress, hexToBigInt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import {
  assertRpcProviderBindings,
  releaseRpcTransport,
} from "./custom-registry-v2-deployment-guards.mjs";
import { readDefaultUserKeychainItem } from "./custom-registry-v2-keychain-custody.mjs";
import { commonFinalizedBlock } from "./custom-registry-v2-live-verification.mjs";
import { SAFE_READ_ABI } from "./custom-registry-v2-safe-controller-guards.mjs";
import {
  acquireReleaseEvidenceLock,
  assertCanonicalTransactionJournalPath,
  assertNoExistingTransactionIntent,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import {
  SAFE_PUBLIC_MIGRATION_AUTHORIZATION_SCHEMA,
  SAFE_PUBLIC_MIGRATION_JOURNAL_SCHEMA,
  SAFE_PUBLIC_MIGRATION_SIGNED_EVENT,
  SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA,
  assertSafeMigrationJournalCandidate,
  assertSafeMigrationAuthorization,
  loadAndAssertSafeMigrationReviewedPlan,
  safeMigrationReceiptTailEvents,
  verifySafeMigrationAuthorizationSignature,
} from "./custom-registry-v2-safe-public-migration-execution.mjs";
import {
  appendDurableJsonLine,
  assertDispatchAuthorizedJournal,
  assertExactSerializedEip1559Transaction,
  assertSignedDispatchIntentWindow,
  assertStagedTransactionEvidence,
  createDurableJsonLines,
  latestJournalTrustedTime,
  loadDurableJsonLines,
  trustedNetworkTime,
  trustedNetworkTimeAfter,
} from "./custom-registry-v2-transaction-journal.mjs";

const broadcast = process.argv.includes("--broadcast");
const recover = process.argv.includes("--recover");
const rebroadcast = process.argv.includes("--rebroadcast");
const activationIndexes = process.argv.flatMap((value, index) =>
  value === "--activate-dispatch-intent" ? [index] : [],
);
if (!broadcast) throw new Error("explicit --broadcast is required");
if (recover && activationIndexes.length !== 0) {
  throw new Error("recovery forbids dispatch-intent activation");
}
if (!recover && activationIndexes.length !== 1) {
  throw new Error("initial migration broadcast requires exactly one dispatch-intent activation");
}
if (rebroadcast && !recover) {
  throw new Error("rebroadcast requires explicit recovery");
}
const activationHash = activationIndexes.length
  ? process.argv[activationIndexes[0] + 1]
  : null;
if (!recover && !/^0x[0-9a-fA-F]{64}$/u.test(activationHash ?? "")) {
  throw new Error("dispatch-intent activation requires an exact transaction hash");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return process.argv[index + 1];
};
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const sha256 = (bytes) => `0x${createHash("sha256").update(bytes).digest("hex")}`;
const readBound = async (pathName, digestName, mode = 0o600) => {
  const filePath = assertReleaseEvidencePath(required(pathName), { mode });
  const bytes = await readFile(filePath);
  if (sha256(bytes) !== required(digestName)) throw new Error(`${pathName} digest mismatch`);
  return { path: filePath, bytes, digest: sha256(bytes), value: JSON.parse(bytes) };
};
const planEvidence = await readBound("REGISTRY_SAFE_MIGRATION_PLAN_PATH", "REGISTRY_SAFE_MIGRATION_PLAN_SHA256");
const stagedEvidence = await readBound("REGISTRY_SAFE_MIGRATION_STAGED_TRANSACTION_PATH", "REGISTRY_SAFE_MIGRATION_STAGED_TRANSACTION_SHA256", 0o400);
const authorizationEvidence = await readBound("REGISTRY_SAFE_MIGRATION_AUTHORIZATION_PATH", "REGISTRY_SAFE_MIGRATION_AUTHORIZATION_SHA256");
const plan = planEvidence.value;
const staged = stagedEvidence.value;
const authorization = authorizationEvidence.value;
const role = argument("--role");
const planned = plan.transactions?.find((entry) => entry.role === role);
if (!planned || staged.role !== role) throw new Error("migration broadcast role is not an exact remaining role");
const reviewTime = recover ? plan.createdAtTrustedTime : trustedNetworkTime();
const nowTimestamp = reviewTime.adjustedTimestamp;
await assertStagedTransactionEvidence({
  evidence: staged,
  schemaVersion: SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA,
  preflightSha256: planEvidence.digest,
  expectedTransaction: planned.outerTransaction,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
assertSafeMigrationAuthorization({
  authorization,
  plan,
  planSha256: planEvidence.digest,
  stagedTransactions: [staged],
  stagedTransactionSha256ByRole: new Map([[role, stagedEvidence.digest]]),
  nowTimestamp,
  allowExpired: recover,
});
await verifySafeMigrationAuthorizationSignature(authorization);
if (
  authorization.schemaVersion !== SAFE_PUBLIC_MIGRATION_AUTHORIZATION_SCHEMA ||
  !authorization.authorizedTransactions.some(
    (entry) => entry.role === role && entry.authorizedTransactionHash === staged.transactionHash,
  )
) {
  throw new Error("migration owner authorization does not bind role transaction");
}
await assertExactSerializedEip1559Transaction({
  serializedTransaction: staged.serializedTransaction,
  transactionHash: staged.transactionHash,
  expected: planned.outerTransaction,
});
if (!recover && activationHash !== staged.transactionHash) {
  throw new Error("dispatch-intent activation hash differs from exact staged raw transaction");
}
const commit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const tree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
if (
  commit !== plan.source?.commit ||
  tree !== plan.source?.tree ||
  execFileSync("/usr/bin/git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }) !== ""
) {
  throw new Error("Safe migration broadcast source identity drifted");
}
const [policyBytes, safePolicyBytes] = await Promise.all([
  readFile(path.join(root, "config/custom-registry-v2-safe-public-migration-policy.json")),
  readFile(path.join(root, "config/custom-registry-v2-safe-controller-policy.json")),
]);
if (
  sha256(policyBytes) !== plan.policySha256 ||
  sha256(safePolicyBytes) !== plan.safeControllerPolicySha256
) {
  throw new Error("Safe migration policy drifted");
}
const safePolicy = JSON.parse(safePolicyBytes);
await loadAndAssertSafeMigrationReviewedPlan({
  root,
  plan,
  nowTimestamp,
  trustedTime: reviewTime,
});
const rpcUrls = [required("REGISTRY_PREFLIGHT_RPC_URL_A"), required("REGISTRY_PREFLIGHT_RPC_URL_B")];
const providerIds = [required("REGISTRY_RPC_PROVIDER_ID_A"), required("REGISTRY_RPC_PROVIDER_ID_B")];
const providerBindings = assertRpcProviderBindings({ plan, providerIds, rpcUrls });
const clients = rpcUrls.map((url) => createPublicClient({ chain: mainnet, transport: releaseRpcTransport(url) }));
if ((await Promise.all(clients.map((client) => client.getChainId()))).some((id) => id !== 1)) {
  throw new Error("Safe migration broadcast RPC is not Ethereum mainnet");
}
const journalPath = assertCanonicalTransactionJournalPath({
  candidate: argument("--output"),
  chainId: 1,
  signer: planned.outerTransaction.from,
  nonce: planned.outerTransaction.nonce,
  mustExist: recover,
});
await acquireReleaseEvidenceLock(journalPath);
let journalRecords = [];
const append = async (entry) => {
  assertSafeMigrationJournalCandidate({
    records: journalRecords,
    candidate: entry,
    plan,
    plannedRole: planned,
    stagedTransaction: staged,
    stagedTransactionSha256: stagedEvidence.digest,
    authorization,
    authorizationSha256: authorizationEvidence.digest,
    planSha256: planEvidence.digest,
  });
  await appendDurableJsonLine(journalPath, entry);
  journalRecords.push(entry);
};
const assertLegacyKeyImmediately = () => {
  const expected = getAddress(planned.outerTransaction.from);
  const bytes = readDefaultUserKeychainItem({
    service: `programmable.custom-registry.v2.production-custody.20260813.${role}`,
    account: expected,
  });
  const key = bytes.toString("utf8").trim();
  const valid = /^0x[0-9a-fA-F]{64}$/u.test(key) && getAddress(privateKeyToAccount(key).address) === expected;
  bytes.fill(0);
  if (!valid) throw new Error("immediate migration legacy Keychain readback failed");
};
const assertImmediateLegacySafeState = async () => {
  const finalized = await commonFinalizedBlock(clients);
  const sentinel = "0x0000000000000000000000000000000000000001";
  const readSnapshot = async (client, block) => {
    const selector =
      block === "latest" ? { blockTag: "latest" } : { blockNumber: block };
    const [
      code,
      version,
      masterCopy,
      owners,
      threshold,
      safeNonce,
      modules,
      fallbackStorage,
      guardStorage,
      legacyCode,
    ] = await Promise.all([
      client.getCode({ address: planned.safe, ...selector }),
      client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "VERSION", ...selector }),
      client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "masterCopy", ...selector }),
      client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getOwners", ...selector }),
      client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getThreshold", ...selector }),
      client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "nonce", ...selector }),
      client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getModulesPaginated", args: [sentinel, 10n], ...selector }),
      client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getStorageAt", args: [hexToBigInt(safePolicy.storageSlots.fallbackHandler), 1n], ...selector }),
      client.readContract({ address: planned.safe, abi: SAFE_READ_ABI, functionName: "getStorageAt", args: [hexToBigInt(safePolicy.storageSlots.guard), 1n], ...selector }),
      client.getCode({ address: planned.legacyOwner, ...selector }),
    ]);
    return {
      codePresent: Boolean(code && code !== "0x"),
      version,
      masterCopy: getAddress(masterCopy),
      owners: owners.map((value) => getAddress(value)),
      threshold: threshold.toString(),
      safeNonce: safeNonce.toString(),
      modules: modules[0].map((value) => getAddress(value)),
      nextModule: getAddress(modules[1]),
      fallbackStorage,
      guardStorage,
      legacyCode: legacyCode ?? "0x",
    };
  };
  const [pendingNonces, finalizedNonces, snapshots] = await Promise.all([
    Promise.all(
      clients.map((client) =>
        client.getTransactionCount({
          address: planned.legacyOwner,
          blockTag: "pending",
        }),
      ),
    ),
    Promise.all(
      clients.map((client) =>
        client.getTransactionCount({
          address: planned.legacyOwner,
          blockNumber: finalized.number,
        }),
      ),
    ),
    Promise.all(
      clients.flatMap((client) => [
        readSnapshot(client, finalized.number),
        readSnapshot(client, "latest"),
      ]),
    ),
  ]);
  const expectedNonce = planned.outerTransaction.nonce;
  const expectedSnapshot = {
    version: safePolicy.safeVersion,
    masterCopy: getAddress(safePolicy.singleton.address),
    owners: [getAddress(planned.legacyOwner)],
    threshold: "1",
    safeNonce: planned.expectedSafeNonceBefore,
    modules: [],
    nextModule: sentinel,
    fallbackStorage: `0x${"00".repeat(32)}`,
    guardStorage: `0x${"00".repeat(32)}`,
    legacyCode: "0x",
  };
  if (
    pendingNonces.some((nonce) => nonce !== expectedNonce) ||
    finalizedNonces.some((nonce) => nonce !== expectedNonce) ||
    snapshots.some(
      ({ codePresent, ...snapshot }) =>
        !codePresent || JSON.stringify(snapshot) !== JSON.stringify(expectedSnapshot),
    )
  ) {
    throw new Error(
      "immediate migration legacy Safe, signer nonce, or protection state drifted",
    );
  }
};
const providerResponses = async (event, previousTime) => {
  const requestStartedTrustedTime = trustedNetworkTimeAfter(previousTime);
  assertLegacyKeyImmediately();
  const settled = await Promise.allSettled(
    clients.map((client) => client.sendRawTransaction({ serializedTransaction: staged.serializedTransaction })),
  );
  const responseObservedTrustedTime = trustedNetworkTimeAfter(requestStartedTrustedTime);
  const entry = {
    event,
    transactionHash: staged.transactionHash,
    requestStartedAtTimestamp: requestStartedTrustedTime.adjustedTimestamp,
    requestStartedTrustedTime,
    responseObservedAtTimestamp: responseObservedTrustedTime.adjustedTimestamp,
    responseObservedTrustedTime,
    providerResponses: settled.map((result, index) => ({
      ...providerBindings[index],
      status: result.status,
      ...(result.status === "fulfilled"
        ? { transactionHash: result.value }
        : { errorName: result.reason?.name ?? "RpcRequestError" }),
    })),
  };
  await append(entry);
  return entry;
};
const observeFinalReceipt = async (
  previousTime,
  { discoveryAlready = false, existingReceipt = null } = {},
) => {
  const transactions = await Promise.all(
    clients.map((client) => client.getTransaction({ hash: staged.transactionHash }).catch(() => null)),
  );
  if (transactions.some((value) => value === null)) return false;
  const discoveredTrustedTime = discoveryAlready
    ? previousTime
    : trustedNetworkTimeAfter(previousTime);
  if (!discoveryAlready) {
    await append({
      event: "RECOVERY_TRANSACTION_DISCOVERY",
      transactionHash: staged.transactionHash,
      discoveredAtTimestamp: discoveredTrustedTime.adjustedTimestamp,
      discoveredTrustedTime,
      providers: providerBindings.map((binding) => ({ ...binding, found: true, transactionHash: staged.transactionHash })),
    });
  }
  const receipts = await Promise.all(
    clients.map((client) => client.getTransactionReceipt({ hash: staged.transactionHash }).catch(() => null)),
  );
  if (receipts.some((value) => value === null)) return false;
  const [first, second] = receipts;
  if (
    first.transactionHash !== staged.transactionHash ||
    second.transactionHash !== staged.transactionHash ||
    first.blockHash !== second.blockHash ||
    first.blockNumber !== second.blockNumber ||
    first.status !== "success" ||
    second.status !== "success"
  ) {
    throw new Error("migration receipt observations disagree or failed");
  }
  const observed = trustedNetworkTimeAfter(discoveredTrustedTime);
  const completed = trustedNetworkTimeAfter(observed);
  const tail = safeMigrationReceiptTailEvents({
    existingReceipt,
    transactionHash: staged.transactionHash,
    blockNumber: first.blockNumber,
    blockHash: first.blockHash,
    observedTrustedTime: observed,
    completedTrustedTime: completed,
  });
  for (const entry of tail) await append(entry);
  return true;
};
if (recover) {
  const records = await loadDurableJsonLines(journalPath, { repairTrailingTornRecord: true });
  journalRecords = records;
  const parsed = assertDispatchAuthorizedJournal({
    records,
    schemaVersion: SAFE_PUBLIC_MIGRATION_JOURNAL_SCHEMA,
    signedEvent: SAFE_PUBLIC_MIGRATION_SIGNED_EVENT,
    transactionHash: staged.transactionHash,
    stagedTransactionSha256: stagedEvidence.digest,
    authorizationSha256: authorizationEvidence.digest,
    authorization,
    broadcastProviderBindings: providerBindings,
    discoveryProviderBindings: providerBindings,
    allowedTailEvents: ["RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION", "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION"],
  });
  if (
    parsed.header.planSha256 !== planEvidence.digest ||
    parsed.header.role !== role ||
    parsed.signed.serializedTransaction !== staged.serializedTransaction
  ) {
    throw new Error("migration recovery journal differs from exact reviewed raw");
  }
  if (parsed.completion) {
    process.stdout.write(`CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_RECOVERY_ALREADY_COMPLETE ${role}\n`);
    process.exit(0);
  }
  const latest = latestJournalTrustedTime(records);
  if (
    await observeFinalReceipt(latest, {
      discoveryAlready: parsed.discoveryRecords.length === 1,
      existingReceipt: parsed.receipt,
    })
  ) {
    process.stdout.write(`CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_RECOVERED ${role}\n`);
    process.exit(0);
  }
  if (!rebroadcast) throw new Error("exact migration transaction not complete; use explicit --recover --rebroadcast");
  const response = await providerResponses("RECOVERY_EXACT_REBROADCAST", latest);
  await observeFinalReceipt(response.responseObservedTrustedTime, {
    discoveryAlready: parsed.discoveryRecords.length === 1,
    existingReceipt: parsed.receipt,
  });
  process.stdout.write(`CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_REBROADCAST ${role} ${staged.transactionHash}\n`);
  process.exit(0);
}
await assertImmediateLegacySafeState();
assertNoExistingTransactionIntent({
  chainId: 1,
  signer: planned.outerTransaction.from,
  nonce: planned.outerTransaction.nonce,
});
assertLegacyKeyImmediately();
const activatedTrustedTime = trustedNetworkTime();
assertSignedDispatchIntentWindow({
  authorization,
  dispatchIntentTrustedTime: activatedTrustedTime,
});
const initial = [
  {
    schemaVersion: SAFE_PUBLIC_MIGRATION_JOURNAL_SCHEMA,
    event: "JOURNAL_OPEN",
    planSha256: planEvidence.digest,
    authorizationSha256: authorizationEvidence.digest,
    stagedTransactionSha256: stagedEvidence.digest,
    role,
    signer: getAddress(planned.outerTransaction.from),
    nonce: planned.outerTransaction.nonce,
  },
  {
    event: SAFE_PUBLIC_MIGRATION_SIGNED_EVENT,
    transactionHash: staged.transactionHash,
    stagedTransactionSha256: stagedEvidence.digest,
    serializedTransaction: staged.serializedTransaction,
  },
  {
    event: "DISPATCH_INTENT_ACTIVATED",
    transactionHash: staged.transactionHash,
    authorizationSha256: authorizationEvidence.digest,
    authorizationSemantics: authorization.authorizationSemantics,
    exactSerializedTransactionOnly: true,
    changedTransactionRequiresFreshAuthorization: true,
    workflowCancellationAllowed: false,
    activatedAtTimestamp: activatedTrustedTime.adjustedTimestamp,
    activatedTrustedTime,
  },
];
journalRecords = initial;
assertDispatchAuthorizedJournal({
  records: journalRecords,
  schemaVersion: SAFE_PUBLIC_MIGRATION_JOURNAL_SCHEMA,
  signedEvent: SAFE_PUBLIC_MIGRATION_SIGNED_EVENT,
  transactionHash: staged.transactionHash,
  stagedTransactionSha256: stagedEvidence.digest,
  authorizationSha256: authorizationEvidence.digest,
  authorization,
  broadcastProviderBindings: providerBindings,
  discoveryProviderBindings: providerBindings,
  allowedTailEvents: [
    "RECEIPT_SEEN_AWAITING_FINALIZED_VERIFICATION",
    "BROADCAST_COMPLETE_AWAITING_FINALIZED_VERIFICATION",
  ],
});
await createDurableJsonLines(journalPath, initial);
const response = await providerResponses("BROADCAST_PROVIDER_RESPONSES", activatedTrustedTime);
await observeFinalReceipt(response.responseObservedTrustedTime);
process.stdout.write(`CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_BROADCAST ${role} ${staged.transactionHash}\n`);
