import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getAddress } from "viem";

import { assertDispatchAuthorizationWindow } from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertNoExistingTransactionIntent,
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import {
  SAFE_PUBLIC_MIGRATION_AUTHORIZATION_SCHEMA,
  SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA,
  assertSafeMigrationAuthorization,
  computeSafeMigrationAuthorizationDigest,
  loadAndAssertSafeMigrationReviewedPlan,
  safeMigrationAuthorizationMessage,
  verifySafeMigrationAuthorizationSignature,
} from "./custom-registry-v2-safe-public-migration-execution.mjs";
import {
  assertStagedTransactionEvidence,
  trustedNetworkTime,
} from "./custom-registry-v2-transaction-journal.mjs";

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
const printMessage = process.argv.includes("--print-message");
const outputPath = printMessage ? null : assertReleaseEvidenceOutput(argument("--output"));
const planBytes = await readFile(planPath);
const planSha256 = sha256(planBytes);
if (planSha256 !== required("REGISTRY_SAFE_MIGRATION_PLAN_SHA256")) {
  throw new Error("reviewed Safe migration plan digest mismatch");
}
const plan = JSON.parse(planBytes);
const stagedInput = JSON.parse(required("REGISTRY_SAFE_MIGRATION_STAGED_FILES_JSON"));
const stagedTransactions = [];
const stagedTransactionSha256ByRole = new Map();
const authorizedTransactions = [];
for (const planned of plan.transactions ?? []) {
  const configured = stagedInput[planned.role];
  if (!configured?.path || !configured.sha256) {
    throw new Error(`staged migration evidence is required for ${planned.role}`);
  }
  const filePath = assertReleaseEvidencePath(configured.path, { mode: 0o400 });
  const bytes = await readFile(filePath);
  if (sha256(bytes) !== configured.sha256) {
    throw new Error(`${planned.role} staged migration digest mismatch`);
  }
  const staged = JSON.parse(bytes);
  await assertStagedTransactionEvidence({
    evidence: staged,
    schemaVersion: SAFE_PUBLIC_MIGRATION_STAGED_SCHEMA,
    preflightSha256: planSha256,
    expectedTransaction: planned.outerTransaction,
    planCreatedAtTimestamp: plan.createdAtTimestamp,
    planExpiresAtTimestamp: plan.expiresAtTimestamp,
  });
  if (
    staged.role !== planned.role ||
    staged.planSha256 !== planSha256 ||
    staged.source?.commit !== plan.source?.commit ||
    staged.source?.tree !== plan.source?.tree ||
    staged.policySha256 !== plan.policySha256 ||
    staged.continuationEvidenceSha256 !== (plan.continuationEvidenceSha256 ?? null)
  ) {
    throw new Error(`${planned.role} staged migration source binding is invalid`);
  }
  assertNoExistingTransactionIntent({
    chainId: 1,
    signer: planned.outerTransaction.from,
    nonce: planned.outerTransaction.nonce,
  });
  stagedTransactions.push(staged);
  stagedTransactionSha256ByRole.set(planned.role, configured.sha256);
  authorizedTransactions.push({
    role: planned.role,
    stagedTransactionSha256: configured.sha256,
    authorizedTransactionHash: staged.transactionHash,
    signer: getAddress(planned.outerTransaction.from),
    nonce: planned.outerTransaction.nonce,
  });
}
if (authorizedTransactions.length !== plan.remainingRoles?.length) {
  throw new Error("authorization must bind every remaining migration role");
}
const currentCommit = execFileSync("/usr/bin/git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const currentTree = execFileSync("/usr/bin/git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
if (
  currentCommit !== plan.source?.commit ||
  currentTree !== plan.source?.tree ||
  execFileSync("/usr/bin/git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }) !== ""
) {
  throw new Error("Safe migration authorization source identity drifted");
}
const reviewTime = trustedNetworkTime();
await loadAndAssertSafeMigrationReviewedPlan({
  root,
  plan,
  nowTimestamp: reviewTime.adjustedTimestamp,
  trustedTime: reviewTime,
});
const nowTimestamp = reviewTime.adjustedTimestamp;
const notBeforeTimestamp = Number(required("REGISTRY_SAFE_MIGRATION_DISPATCH_INTENT_NOT_BEFORE"));
const dispatchIntentExpiresAtTimestamp = Number(required("REGISTRY_SAFE_MIGRATION_DISPATCH_INTENT_EXPIRES_AT"));
assertDispatchAuthorizationWindow({
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  nowTimestamp,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
const ownerAuthorizationAddress = getAddress(required("REGISTRY_RELEASE_OWNER"));
if (ownerAuthorizationAddress !== getAddress(plan.releaseAuthorization?.owner)) {
  throw new Error("release owner does not match migration plan");
}
const authorization = {
  schemaVersion: SAFE_PUBLIC_MIGRATION_AUTHORIZATION_SCHEMA,
  status: "REVIEWED_REMAINING_ROLES_READY_FOR_EXPLICIT_DISPATCH_INTENTS",
  planSha256,
  source: plan.source,
  policySha256: plan.policySha256,
  continuationEvidenceSha256: plan.continuationEvidenceSha256 ?? null,
  ownerAuthorizationAddress,
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  authorizationSemantics: plan.releaseAuthorization.authorizationSemantics,
  signingAllowed: false,
  broadcastAllowed: false,
  dispatchIntentActivationAllowed: true,
  broadcastRequiresDurableDispatchIntent: true,
  authorizedTransactions,
};
authorization.reviewedPlanDigest = computeSafeMigrationAuthorizationDigest(authorization);
assertSafeMigrationAuthorization({
  authorization,
  plan,
  planSha256,
  stagedTransactions,
  stagedTransactionSha256ByRole,
  nowTimestamp,
});
if (printMessage) {
  process.stdout.write(`${JSON.stringify({ reviewedPlanDigest: authorization.reviewedPlanDigest, message: safeMigrationAuthorizationMessage(authorization.reviewedPlanDigest) })}\n`);
  process.exit(0);
}
authorization.ownerAuthorizationSignature = required("REGISTRY_SAFE_MIGRATION_OWNER_AUTHORIZATION_SIGNATURE");
await verifySafeMigrationAuthorizationSignature(authorization);
await writeFile(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`CUSTOM_REGISTRY_V2_SAFE_PUBLIC_MIGRATION_AUTHORIZED ${outputPath}\n`);
