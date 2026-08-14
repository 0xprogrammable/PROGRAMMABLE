import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient } from "viem";
import { mainnet } from "viem/chains";
import {
  assertNoExistingTransactionIntent,
  assertReleaseEvidenceOutput,
  assertReleaseEvidencePath,
} from "./custom-registry-v2-release-evidence.mjs";

import {
  REGISTRY_AUTHORIZATION_SCHEMA,
  REGISTRY_STAGED_TRANSACTION_SCHEMA,
  AUTHORIZATION_SEMANTICS,
  assertReviewedAuthorization,
  assertRpcProviderBindings,
  assertDispatchAuthorizationWindow,
  computeReviewedPlanDigest,
  reviewedAuthorizationMessage,
  releaseRpcTransport,
  sha256,
  verifyReviewedAuthorizationSignature,
} from "./custom-registry-v2-deployment-guards.mjs";
import { assertRegistryDeploymentPlan } from "./custom-registry-v2-deployment-plan.mjs";
import { assertRegistryLivePreflight } from "./custom-registry-v2-live-verification.mjs";
import { assertStagedTransactionEvidence } from "./custom-registry-v2-transaction-journal.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
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
const preflightPath = assertReleaseEvidencePath(argument("--preflight"));
const printMessage = process.argv.includes("--print-message");
const outputPath = printMessage
  ? null
  : assertReleaseEvidenceOutput(argument("--output"));
const safeVerificationPath = assertReleaseEvidencePath(
  required("REGISTRY_SAFE_VERIFICATION_PATH"),
);
const safeVerificationBytes = await readFile(safeVerificationPath);
if (
  sha256(safeVerificationBytes) !==
  required("REGISTRY_SAFE_VERIFICATION_SHA256")
) {
  throw new Error("Safe verification digest mismatch");
}
const preflightBytes = await readFile(preflightPath);
const preflightSha256 = sha256(preflightBytes);
const plan = JSON.parse(preflightBytes);
const nowTimestamp = Math.floor(Date.now() / 1000);
const planInputs = await assertRegistryDeploymentPlan({
  root,
  plan,
  safeVerificationBytes,
  nowTimestamp,
});
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
await assertStagedTransactionEvidence({
  evidence: stagedTransaction,
  schemaVersion: REGISTRY_STAGED_TRANSACTION_SCHEMA,
  preflightSha256,
  expectedTransaction: plan.expectedTransaction,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
assertNoExistingTransactionIntent({
  chainId: 1,
  signer: plan.expectedTransaction.from,
  nonce: plan.expectedTransaction.nonce,
});
const rpcA = required("REGISTRY_PREFLIGHT_RPC_URL_A");
const rpcB = required("REGISTRY_PREFLIGHT_RPC_URL_B");
const providerIds = [
  required("REGISTRY_RPC_PROVIDER_ID_A"),
  required("REGISTRY_RPC_PROVIDER_ID_B"),
];
assertRpcProviderBindings({ plan, providerIds, rpcUrls: [rpcA, rpcB] });
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: releaseRpcTransport(url) }),
);
await assertRegistryLivePreflight({
  clients,
  providerIds,
  plan,
  planInputs,
});

const ownerAuthorizationAddress = required("REGISTRY_RELEASE_OWNER");
if (
  ownerAuthorizationAddress.toLowerCase() !==
  plan.releaseAuthorization.owner.toLowerCase()
) {
  throw new Error(
    "REGISTRY_RELEASE_OWNER does not match the reviewed preflight",
  );
}
const dispatchIntentExpiresAtTimestamp = Number(
  required("REGISTRY_DISPATCH_INTENT_EXPIRES_AT"),
);
const notBeforeTimestamp = Number(
  required("REGISTRY_DISPATCH_INTENT_NOT_BEFORE"),
);
assertDispatchAuthorizationWindow({
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  nowTimestamp,
  planCreatedAtTimestamp: plan.createdAtTimestamp,
  planExpiresAtTimestamp: plan.expiresAtTimestamp,
});
const authorization = {
  schemaVersion: REGISTRY_AUTHORIZATION_SCHEMA,
  status: "REVIEWED_READY_FOR_EXPLICIT_DISPATCH_INTENT",
  preflightSha256,
  stagedTransactionSha256,
  authorizedTransactionHash: stagedTransaction.transactionHash,
  source: plan.source,
  ownerAuthorizationAddress,
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  authorizationSemantics: AUTHORIZATION_SEMANTICS,
  signingAllowed: false,
  broadcastAllowed: false,
  dispatchIntentActivationAllowed: true,
  broadcastRequiresDurableDispatchIntent: true,
};
authorization.reviewedPlanDigest = computeReviewedPlanDigest({
  preflightSha256,
  stagedTransactionSha256,
  authorizedTransactionHash: stagedTransaction.transactionHash,
  ownerAuthorizationAddress,
  notBeforeTimestamp,
  dispatchIntentExpiresAtTimestamp,
  sourceCommit: plan.source.commit,
  sourceTree: plan.source.tree,
});
if (printMessage) {
  process.stdout.write(
    `${JSON.stringify({
      reviewedPlanDigest: authorization.reviewedPlanDigest,
      message: reviewedAuthorizationMessage(authorization.reviewedPlanDigest),
    })}\n`,
  );
  process.exit(0);
}
const signature = required("REGISTRY_OWNER_AUTHORIZATION_SIGNATURE");
authorization.ownerAuthorizationSignature = signature;
assertReviewedAuthorization({
  authorization,
  preflightSha256,
  plan,
  nowTimestamp,
});
await verifyReviewedAuthorizationSignature(authorization);
await writeFile(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
process.stdout.write(
  `CUSTOM_REGISTRY_V2_REVIEWED_AUTHORIZATION ${outputPath}\n`,
);
