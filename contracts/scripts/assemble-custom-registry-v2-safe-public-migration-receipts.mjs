import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import {
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import { SAFE_PUBLIC_MIGRATION_RECEIPTS_SCHEMA } from "./custom-registry-v2-safe-public-migration-guards.mjs";
import { createSafeMigrationExecutionBundle } from "./custom-registry-v2-safe-public-migration-execution.mjs";

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
const outputPath = assertReleaseEvidenceOutput(argument("--output"));
const planPath = assertReleaseEvidencePath(argument("--preflight"));
const planBytes = await readFile(planPath);
const planSha256 = sha256(planBytes);
if (planSha256 !== required("REGISTRY_SAFE_MIGRATION_PLAN_SHA256")) {
  throw new Error("reviewed Safe migration plan digest mismatch");
}
const plan = JSON.parse(planBytes);
const authorizationPath = assertReleaseEvidencePath(
  required("REGISTRY_SAFE_MIGRATION_AUTHORIZATION_PATH"),
);
const authorizationBytes = await readFile(authorizationPath);
const authorizationSha256 = sha256(authorizationBytes);
if (authorizationSha256 !== required("REGISTRY_SAFE_MIGRATION_AUTHORIZATION_SHA256")) {
  throw new Error("Safe migration owner authorization digest mismatch");
}
const inputs = JSON.parse(required("REGISTRY_SAFE_MIGRATION_EXECUTION_INPUTS_JSON"));
if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > plan.transactions.length) {
  throw new Error("one to all remaining migration execution inputs are required");
}
const seen = new Set();
const transactions = [];
for (const input of inputs) {
  if (seen.has(input.role) || !plan.remainingRoles.includes(input.role)) {
    throw new Error("migration execution input role is duplicate or not remaining");
  }
  seen.add(input.role);
  const bundleOutput = assertReleaseEvidenceOutput(input.bundleOutput);
  const { bundle } = await createSafeMigrationExecutionBundle({
    role: input.role,
    planPath,
    planSha256,
    stagedTransactionPath: input.stagedTransactionPath,
    stagedTransactionSha256: input.stagedTransactionSha256,
    ownerAuthorizationPath: authorizationPath,
    ownerAuthorizationSha256: authorizationSha256,
    transactionJournalPath: input.transactionJournalPath,
    transactionJournalSha256: input.transactionJournalSha256,
    nowTimestamp: Math.floor(Date.now() / 1_000),
    allowExpired: true,
  });
  const bundleBytes = Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`);
  await writeFile(bundleOutput, bundleBytes, { flag: "wx", mode: 0o600 });
  transactions.push({
    role: input.role,
    transactionHash: bundle.transactionHash,
    executionBundlePath: bundleOutput,
    executionBundleSha256: sha256(bundleBytes),
  });
}
const receipts = {
  schemaVersion: SAFE_PUBLIC_MIGRATION_RECEIPTS_SCHEMA,
  status: "SUBSET_OF_REMAINING_DIRECT_LEGACY_OWNER_MIGRATIONS_SUBMITTED",
  chainId: 1,
  planSha256,
  transactions,
};
await writeFile(outputPath, `${JSON.stringify(receipts, null, 2)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_RECEIPTS ${outputPath}\n`);
