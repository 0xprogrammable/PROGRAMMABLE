import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

import {
  SAFE_AUTHORIZATION_SCHEMA,
  SAFE_STAGED_TRANSACTION_SCHEMA,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
  assertSafeReviewedAuthorization,
  computeSafeReviewedPlanDigest,
  safeReviewedAuthorizationMessage,
  verifySafeReviewedAuthorizationSignature,
} from "./custom-registry-v2-safe-controller-guards.mjs";
import {
  AUTHORIZATION_SEMANTICS,
  assertDispatchAuthorizationWindow,
} from "./custom-registry-v2-deployment-guards.mjs";
import {
  assertNoExistingTransactionIntent,
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";
import { assertStagedTransactionEvidence } from "./custom-registry-v2-transaction-journal.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1])
    throw new Error(`${name} is required`);
  return process.argv[index + 1];
};
const preflightPath = assertReleaseEvidencePath(argument("--preflight"));
const printMessage = process.argv.includes("--print-message");
const outputPath = printMessage
  ? null
  : assertReleaseEvidenceOutput(argument("--output"));

const preflightBytes = await readFile(preflightPath);
const preflightSha256 = `0x${createHash("sha256")
  .update(preflightBytes)
  .digest("hex")}`;
if (preflightSha256 !== process.env.REGISTRY_SAFE_REVIEWED_PLAN_SHA256)
  throw new Error("reviewed Safe preflight digest mismatch");
const plan = JSON.parse(preflightBytes);
const stagedTransactionPath = assertReleaseEvidencePath(
  process.env.REGISTRY_SAFE_STAGED_TRANSACTION_PATH ?? "",
  { mode: 0o400 },
);
const stagedTransactionBytes = await readFile(stagedTransactionPath);
const stagedTransactionSha256 = `0x${createHash("sha256")
  .update(stagedTransactionBytes)
  .digest("hex")}`;
if (
  stagedTransactionSha256 !==
  process.env.REGISTRY_SAFE_STAGED_TRANSACTION_SHA256
) {
  throw new Error("staged Safe transaction digest mismatch");
}
const stagedTransaction = JSON.parse(stagedTransactionBytes);
await assertStagedTransactionEvidence({
  evidence: stagedTransaction,
  schemaVersion: SAFE_STAGED_TRANSACTION_SCHEMA,
  preflightSha256,
  expectedTransaction: plan.atomicTransaction,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
assertNoExistingTransactionIntent({
  chainId: 1,
  signer: plan.atomicTransaction.from,
  nonce: plan.atomicTransaction.nonce,
});
const nowTimestamp = Math.floor(Date.now() / 1000);
assertSafePreflightEnvelope(plan, nowTimestamp);
const [policyBytes, manifestBytes] = await Promise.all([
  readFile(
    path.join(root, "config/custom-registry-v2-safe-controller-policy.json"),
  ),
  readFile(
    path.join(root, "contracts/spec/custom-registry-v2-predeployment.json"),
  ),
]);
if (
  `0x${createHash("sha256").update(policyBytes).digest("hex")}` !==
  plan.policySha256
)
  throw new Error("Safe controller policy drifted");
assertSafePolicyBoundPlan({
  plan,
  policy: JSON.parse(policyBytes),
  manifest: JSON.parse(manifestBytes),
  sourceManifestSha256: `0x${createHash("sha256")
    .update(manifestBytes)
    .digest("hex")}`,
});

const ownerAuthorizationAddress = getAddress(
  process.env.REGISTRY_RELEASE_OWNER ?? "",
);
if (ownerAuthorizationAddress !== getAddress(plan.releaseAuthorization.owner))
  throw new Error("release owner does not match reviewed Safe preflight");
const dispatchIntentExpiresAtTimestamp = Number(
  process.env.REGISTRY_SAFE_DISPATCH_INTENT_EXPIRES_AT,
);
const notBeforeTimestamp = Number(
  process.env.REGISTRY_SAFE_DISPATCH_INTENT_NOT_BEFORE,
);
assertDispatchAuthorizationWindow({
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  nowTimestamp,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
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
)
  throw new Error("Safe preflight source is not current and clean");

const authorization = {
  schemaVersion: SAFE_AUTHORIZATION_SCHEMA,
  status: "REVIEWED_READY_FOR_EXPLICIT_DISPATCH_INTENT",
  preflightSha256,
  stagedTransactionSha256,
  authorizedTransactionHash: stagedTransaction.transactionHash,
  source: { commit, tree },
  policySha256: plan.policySha256,
  custodyProofSha256: plan.custodyProofSha256,
  ownerAuthorizationAddress,
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  authorizationSemantics: AUTHORIZATION_SEMANTICS,
  signingAllowed: false,
  broadcastAllowed: false,
  dispatchIntentActivationAllowed: true,
  broadcastRequiresDurableDispatchIntent: true,
};
authorization.reviewedPlanDigest = computeSafeReviewedPlanDigest({
  preflightSha256,
  stagedTransactionSha256,
  authorizedTransactionHash: stagedTransaction.transactionHash,
  ownerAuthorizationAddress,
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  sourceCommit: commit,
  sourceTree: tree,
  policySha256: plan.policySha256,
  custodyProofSha256: plan.custodyProofSha256,
});
assertSafeReviewedAuthorization({
  authorization,
  preflightSha256,
  plan,
  nowTimestamp,
});

if (printMessage) {
  process.stdout.write(
    `${JSON.stringify({
      reviewedPlanDigest: authorization.reviewedPlanDigest,
      message: safeReviewedAuthorizationMessage(
        authorization.reviewedPlanDigest,
      ),
    })}\n`,
  );
  process.exit(0);
}

authorization.ownerAuthorizationSignature =
  process.env.REGISTRY_SAFE_OWNER_AUTHORIZATION_SIGNATURE;
await verifySafeReviewedAuthorizationSignature(authorization);
await writeFile(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_SAFE_REVIEWED_AUTHORIZATION ${outputPath}\n`,
);
