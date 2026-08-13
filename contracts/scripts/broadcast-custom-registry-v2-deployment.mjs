import { execFileSync } from "node:child_process";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";

import {
  REGISTRY_RECEIPT_SCHEMA,
  assertReviewedAuthorization,
  requireDistinctRpcOrigins,
  sha256,
  verifyReviewedAuthorizationSignature,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertRegistryDeploymentPlan,
} from "./custom-registry-v2-deployment-plan.mjs";
import {
  assertRegistryLivePreflight,
} from "./custom-registry-v2-live-verification.mjs";

const broadcast = process.argv.includes("--broadcast");
const recover = process.argv.includes("--recover");
const rebroadcast = process.argv.includes("--rebroadcast");
if (!recover && !broadcast) throw new Error("explicit --broadcast is required");
if (rebroadcast && (!recover || !broadcast)) {
  throw new Error("recovery rebroadcast requires --recover --rebroadcast --broadcast");
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputIndex = process.argv.indexOf("--output");
if (outputIndex === -1 || !process.argv[outputIndex + 1]) {
  throw new Error("--output is required");
}
const journalPath = path.resolve(process.argv[outputIndex + 1]);
if (!journalPath.startsWith("/tmp/")) {
  throw new Error("deployment receipt journal must be under /tmp");
}
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const readReviewed = async (pathName, digestName, label) => {
  const filePath = path.resolve(required(pathName));
  if (!filePath.startsWith("/tmp/")) throw new Error(`${label} must be under /tmp`);
  const bytes = await readFile(filePath);
  const digest = sha256(bytes);
  if (digest !== required(digestName)) throw new Error(`${label} digest mismatch`);
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
const plan = reviewed.value;
const authorization = authorized.value;
let nowTimestamp = Math.floor(Date.now() / 1000);
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

const rpcA = required("REGISTRY_PREFLIGHT_RPC_URL_A");
const rpcB = required("REGISTRY_PREFLIGHT_RPC_URL_B");
requireDistinctRpcOrigins(rpcA, rpcB);
const providerIds = [
  required("REGISTRY_RPC_PROVIDER_ID_A"),
  required("REGISTRY_RPC_PROVIDER_ID_B"),
];
if (
  JSON.stringify(providerIds) !== JSON.stringify(plan.rpcProviders) ||
  providerIds[0].toLowerCase() === providerIds[1].toLowerCase()
) {
  throw new Error("RPC provider identity drifted from reviewed plan");
}
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
);

const appendJournal = async (entry, create = false) => {
  const line = `${JSON.stringify(entry)}\n`;
  if (create) {
    await writeFile(journalPath, line, { flag: "wx", mode: 0o600 });
    const handle = await open(journalPath, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return;
  }
  const handle = await open(journalPath, "a", 0o600);
  try {
    await handle.write(line);
    await handle.sync();
  } finally {
    await handle.close();
  }
};
const loadJournal = async () =>
  (await readFile(journalPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

if (recover) {
  const entries = await loadJournal();
  const header = entries[0];
  const signed = entries.find((entry) => entry.event === "SIGNED_NOT_CONFIRMED");
  if (
    header?.schemaVersion !== REGISTRY_RECEIPT_SCHEMA ||
    header.event !== "JOURNAL_OPEN" ||
    header.preflightSha256 !== reviewed.digest ||
    header.authorizationSha256 !== authorized.digest ||
    !signed?.serializedTransaction ||
    keccak256(signed.serializedTransaction) !== signed.transactionHash
  ) {
    throw new Error("deployment recovery journal is invalid");
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
    await appendJournal({
      event: "RECOVERY_TRANSACTION_FOUND",
      observedAtTimestamp: nowTimestamp,
      transactionHash: signed.transactionHash,
      providers: discovered,
    });
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
  if (
    nowTimestamp + 60 > authorization.expiresAtTimestamp ||
    nowTimestamp + 60 > plan.expiresAtTimestamp
  ) {
    throw new Error("recovery transaction lacks a safe inclusion window");
  }
  const responses = await Promise.allSettled(
    clients.map((client) =>
      client.sendRawTransaction({
        serializedTransaction: signed.serializedTransaction,
      }),
    ),
  );
  await appendJournal({
    event: "RECOVERY_REBROADCAST",
    observedAtTimestamp: nowTimestamp,
    transactionHash: signed.transactionHash,
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
        result.status === "fulfilled" && result.value === signed.transactionHash,
    )
  ) {
    throw new Error("exact recovery transaction was not accepted by either RPC");
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

nowTimestamp = Math.floor(Date.now() / 1000);
if (
  nowTimestamp + 60 > authorization.expiresAtTimestamp ||
  nowTimestamp + 60 > plan.expiresAtTimestamp
) {
  throw new Error("authorization lacks a safe inclusion window before signing");
}
const keychainService =
  "programmable.custom-registry.v2.production-custody.20260813.deployer";
const privateKey = execFileSync(
  "security",
  [
    "find-generic-password",
    "-w",
    "-s",
    keychainService,
    "-a",
    getAddress(plan.create.deployer),
  ],
  { encoding: "utf8", maxBuffer: 4096 },
).trim();
if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
  throw new Error("Keychain deployer custody item is invalid");
}
const account = privateKeyToAccount(privateKey);
if (getAddress(account.address) !== getAddress(plan.create.deployer)) {
  throw new Error("Keychain deployer custody address mismatch");
}
const serializedTransaction = await account.signTransaction({
  chainId: 1,
  type: "eip1559",
  data: plan.expectedTransaction.input,
  value: 0n,
  nonce: plan.expectedTransaction.nonce,
  gas: BigInt(plan.expectedTransaction.gasLimit),
  maxFeePerGas: BigInt(plan.expectedTransaction.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(
    plan.expectedTransaction.maxPriorityFeePerGas,
  ),
});
const transactionHash = keccak256(serializedTransaction);
await appendJournal(
  {
    schemaVersion: REGISTRY_RECEIPT_SCHEMA,
    event: "JOURNAL_OPEN",
    chainId: 1,
    preflightSha256: reviewed.digest,
    authorizationSha256: authorized.digest,
    safeVerificationSha256: safeEvidence.digest,
    source: plan.source,
    predictedAddress: plan.create.predictedAddress,
    openedAtTimestamp: nowTimestamp,
  },
  true,
);
await appendJournal({
  event: "SIGNED_NOT_CONFIRMED",
  signedAtTimestamp: nowTimestamp,
  authorizationExpiresAtTimestamp: authorization.expiresAtTimestamp,
  transactionHash,
  serializedTransaction,
});

const responses = await Promise.allSettled(
  clients.map((client) => client.sendRawTransaction({ serializedTransaction })),
);
await appendJournal({
  event: "BROADCAST_PROVIDER_RESPONSES",
  broadcastAtTimestamp: Math.floor(Date.now() / 1000),
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
  throw new Error("exact signed Registry transaction was not accepted");
}
const receipt = await Promise.any(
  clients.map((client) =>
    client.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 }),
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
  getAddress(receipt.contractAddress) !== getAddress(plan.create.predictedAddress)
) {
  throw new Error("Registry deployment receipt failed or address mismatched");
}
process.stdout.write(
  `CUSTOM_REGISTRY_V2_BROADCAST_AWAITING_FINALITY ${transactionHash} ${journalPath}\n`,
);
