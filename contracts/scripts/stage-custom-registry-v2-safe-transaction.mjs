import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { readDefaultUserKeychainItem } from "./custom-registry-v2-keychain-custody.mjs";

import {
  SAFE_STAGED_TRANSACTION_SCHEMA,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
} from "./custom-registry-v2-safe-controller-guards.mjs";
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
const sha256 = (bytes) =>
  `0x${createHash("sha256").update(bytes).digest("hex")}`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const preflightPath = assertReleaseEvidencePath(argument("--preflight"));
const outputPath = assertReleaseEvidenceOutput(argument("--output"), {
  mode: 0o400,
});
const preflightBytes = await readFile(preflightPath);
const preflightSha256 = sha256(preflightBytes);
if (preflightSha256 !== required("REGISTRY_SAFE_REVIEWED_PLAN_SHA256")) {
  throw new Error("reviewed Safe preflight digest mismatch");
}
const plan = JSON.parse(preflightBytes);
assertSafePreflightEnvelope(plan, Math.floor(Date.now() / 1_000));
const [policyBytes, manifestBytes] = await Promise.all([
  readFile(
    path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
  ),
  readFile(path.join(root, "contracts/spec/custom-registry-v2-predeployment.json")),
]);
assertSafePolicyBoundPlan({
  plan,
  policy: JSON.parse(policyBytes),
  manifest: JSON.parse(manifestBytes),
  sourceManifestSha256: sha256(manifestBytes),
});
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
  throw new Error("Safe staged transaction source identity drifted");
}
const deployerCustody = plan.custody.roles.find(({ role }) => role === "deployer");
if (
  deployerCustody?.service !==
    "programmable.custom-registry.v2.production-custody.20260813.deployer" ||
  getAddress(deployerCustody.publicAddress) !== getAddress(plan.deployer)
) {
  throw new Error("reviewed Safe deployer custody is invalid");
}
const privateKeyBytes = readDefaultUserKeychainItem({
  service: deployerCustody.service,
  account: getAddress(plan.deployer),
});
const privateKey = privateKeyBytes.toString("utf8").trim();
if (!/^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
  throw new Error("Safe deployer Keychain custody item is invalid");
}
const account = privateKeyToAccount(privateKey);
privateKeyBytes.fill(0);
if (getAddress(account.address) !== getAddress(plan.deployer)) {
  throw new Error("Safe deployer key mismatch");
}
const signedAt = trustedNetworkTime();
const serializedTransaction = await account.signTransaction({
  chainId: 1,
  type: "eip1559",
  to: plan.atomicTransaction.to,
  data: plan.atomicTransaction.input,
  value: BigInt(plan.atomicTransaction.valueWei),
  nonce: plan.atomicTransaction.nonce,
  gas: BigInt(plan.atomicTransaction.gasLimit),
  maxFeePerGas: BigInt(plan.atomicTransaction.maxFeePerGas),
  maxPriorityFeePerGas: BigInt(plan.atomicTransaction.maxPriorityFeePerGas),
});
const staged = {
  schemaVersion: SAFE_STAGED_TRANSACTION_SCHEMA,
  status: "SIGNED_RAW_TRANSACTION_STAGED_NO_RELEASE_WORKFLOW_AUTHORIZATION",
  chainId: 1,
  preflightSha256,
  source: plan.source,
  policySha256: plan.policySha256,
  custodyProofSha256: plan.custodyProofSha256,
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
  schemaVersion: SAFE_STAGED_TRANSACTION_SCHEMA,
  preflightSha256,
  expectedTransaction: plan.atomicTransaction,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
await writeFile(outputPath, `${JSON.stringify(staged, null, 2)}\n`, {
  flag: "wx",
  mode: 0o400,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_SIGNED_TRANSACTION_STAGED ${staged.transactionHash} ${outputPath}\n`,
);
