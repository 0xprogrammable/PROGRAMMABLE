import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { readDefaultUserKeychainItem } from "./custom-registry-v2-keychain-custody.mjs";
import {
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import {
  SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA,
  loadAndAssertSafeMigrationReviewedPlan,
} from "./custom-registry-v2-safe-public-migration-execution.mjs";
import {
  assertStagedTransactionEvidence,
  trustedNetworkTime,
} from "./custom-registry-v2-transaction-journal.mjs";

if (!process.argv.includes("--stage-signed-transaction")) {
  throw new Error("explicit --stage-signed-transaction is required");
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
const planPath = assertReleaseEvidencePath(argument("--preflight"));
const outputPath = assertReleaseEvidenceOutput(argument("--output"), { mode: 0o400 });
const role = argument("--role");
const planBytes = await readFile(planPath);
const planSha256 = sha256(planBytes);
if (planSha256 !== required("REGISTRY_SAFE_MIGRATION_PLAN_SHA256")) {
  throw new Error("reviewed Safe migration plan digest mismatch");
}
const plan = JSON.parse(planBytes);
const planned = plan.transactions?.find((entry) => entry.role === role);
if (
  !planned ||
  !plan.remainingRoles?.includes(role) ||
  plan.signingAllowed !== false ||
  plan.broadcastAllowed !== false ||
  plan.activationAllowed !== false
) {
  throw new Error("role is not an exact remaining Safe migration transaction");
}
const commit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const tree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
if (
  commit !== plan.source?.commit ||
  tree !== plan.source?.tree ||
  execFileSync("/usr/bin/git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }) !== ""
) {
  throw new Error("Safe migration staging source identity drifted");
}
const signedAt = trustedNetworkTime();
await loadAndAssertSafeMigrationReviewedPlan({
  root,
  plan,
  nowTimestamp: signedAt.adjustedTimestamp,
  trustedTime: signedAt,
});
const legacyOwner = getAddress(planned.outerTransaction.from);
if (legacyOwner !== getAddress(planned.legacyOwner)) {
  throw new Error("Safe migration legacy owner binding is invalid");
}
const service = `programmable.custom-registry.v2.production-custody.20260813.${role}`;
const privateKeyBytes = readDefaultUserKeychainItem({ service, account: legacyOwner });
const privateKey = privateKeyBytes.toString("utf8").trim();
if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
  privateKeyBytes.fill(0);
  throw new Error("Safe migration Keychain custody item is invalid");
}
const account = privateKeyToAccount(privateKey);
privateKeyBytes.fill(0);
if (getAddress(account.address) !== legacyOwner) {
  throw new Error("Safe migration Keychain key does not recover legacy owner");
}
const transaction = planned.outerTransaction;
const serializedTransaction = await account.signTransaction({
  chainId: 1,
  type: "eip1559",
  to: transaction.to,
  data: transaction.input,
  value: BigInt(transaction.valueWei),
  nonce: transaction.nonce,
  gas: BigInt(transaction.gasLimit),
  maxFeePerGas: BigInt(transaction.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(transaction.maxPriorityFeePerGas),
});
const staged = {
  schemaVersion: SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA,
  status: "SIGNED_RAW_TRANSACTION_STAGED_NO_RELEASE_WORKFLOW_AUTHORIZATION",
  chainId: 1,
  role,
  planSha256,
  preflightSha256: planSha256,
  source: plan.source,
  policySha256: plan.policySha256,
  continuationEvidenceSha256: plan.continuationEvidenceSha256 ?? null,
  signingAuthorizedByExplicitCli: true,
  networkCallsPerformedByStager: false,
  releaseWorkflowDispatchAuthorityCreated: false,
  signedAtTimestamp: signedAt.adjustedTimestamp,
  trustedTime: signedAt,
  transactionHash: keccak256(serializedTransaction),
  serializedTransaction,
};
await assertStagedTransactionEvidence({
  evidence: staged,
  schemaVersion: SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA,
  preflightSha256: planSha256,
  expectedTransaction: transaction,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
await writeFile(outputPath, `${JSON.stringify(staged, null, 2)}\n`, { flag: "wx", mode: 0o400 });
process.stdout.write(`CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_STAGED ${role} ${staged.transactionHash} ${outputPath}\n`);
