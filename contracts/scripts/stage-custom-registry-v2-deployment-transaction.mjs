import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { readDefaultUserKeychainItem } from "./custom-registry-v2-keychain-custody.mjs";

import {
  REGISTRY_STAGED_TRANSACTION_SCHEMA,
  sha256,
} from "./custom-registry-v2-deployment-guards.mjs";
import { assertRegistryDeploymentPlan } from "./custom-registry-v2-deployment-plan.mjs";
import {
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import {
  assertStagedTransactionEvidence,
  trustedNetworkTime,
} from "./custom-registry-v2-transaction-journal.mjs";

if (!process.argv.includes("--stage-signed-transaction")) {
  throw new Error("explicit --stage-signed-transaction is required");
}
const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return process.argv[index + 1];
};
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const preflightPath = assertReleaseEvidencePath(argument("--preflight"));
const outputPath = assertReleaseEvidenceOutput(argument("--output"), {
  mode: 0o400,
});
const [preflightBytes, safeVerificationBytes] = await Promise.all([
  readFile(preflightPath),
  readFile(
    assertReleaseEvidencePath(required("REGISTRY_SAFE_VERIFICATION_PATH")),
  ),
]);
const preflightSha256 = sha256(preflightBytes);
if (preflightSha256 !== required("REGISTRY_REVIEWED_PLAN_SHA256")) {
  throw new Error("reviewed Registry preflight digest mismatch");
}
if (
  sha256(safeVerificationBytes) !==
  required("REGISTRY_SAFE_VERIFICATION_SHA256")
) {
  throw new Error("Safe verification digest mismatch");
}
const plan = JSON.parse(preflightBytes);
await assertRegistryDeploymentPlan({
  root,
  plan,
  safeVerificationBytes,
  nowTimestamp: Math.floor(Date.now() / 1_000),
});
const service =
  "programmable.custom-registry.v2.production-custody.20260813.deployer";
const privateKeyBytes = readDefaultUserKeychainItem({
  service,
  account: getAddress(plan.create.deployer),
});
const privateKey = privateKeyBytes.toString("utf8").trim();
if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
  throw new Error("Keychain deployer custody item is invalid");
}
const account = privateKeyToAccount(privateKey);
privateKeyBytes.fill(0);
if (getAddress(account.address) !== getAddress(plan.create.deployer)) {
  throw new Error("Keychain deployer custody address mismatch");
}
const signedAt = trustedNetworkTime();
const serializedTransaction = await account.signTransaction({
  chainId: 1,
  type: "eip1559",
  data: plan.expectedTransaction.input,
  value: BigInt(plan.expectedTransaction.valueWei),
  nonce: plan.expectedTransaction.nonce,
  gas: BigInt(plan.expectedTransaction.gasLimit),
  maxFeePerGas: BigInt(plan.expectedTransaction.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(plan.expectedTransaction.maxPriorityFeePerGas),
});
const staged = {
  schemaVersion: REGISTRY_STAGED_TRANSACTION_SCHEMA,
  status: "SIGNED_RAW_TRANSACTION_STAGED_NO_RELEASE_WORKFLOW_AUTHORIZATION",
  chainId: 1,
  preflightSha256,
  source: plan.source,
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
  schemaVersion: REGISTRY_STAGED_TRANSACTION_SCHEMA,
  preflightSha256,
  expectedTransaction: plan.expectedTransaction,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
await writeFile(outputPath, `${JSON.stringify(staged, null, 2)}\n`, {
  flag: "wx",
  mode: 0o400,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SIGNED_TRANSACTION_STAGED ${staged.transactionHash} ${outputPath}\n`,
);
