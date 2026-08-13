import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

import {
  REGISTRY_AUTHORIZATION_SCHEMA,
  AUTHORIZATION_SEMANTICS,
  assertReviewedAuthorization,
  computeReviewedPlanDigest,
  reviewedAuthorizationMessage,
  requireDistinctRpcOrigins,
  sha256,
  verifyReviewedAuthorizationSignature,
} from "./custom-registry-v2-deployment-guards.mjs";
import { assertRegistryDeploymentPlan } from "./custom-registry-v2-deployment-plan.mjs";
import { assertRegistryLivePreflight } from "./custom-registry-v2-live-verification.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`${name} is required`);
  }
  return path.resolve(process.argv[index + 1]);
};
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const preflightPath = argument("--preflight");
const printMessage = process.argv.includes("--print-message");
const outputPath = printMessage ? null : argument("--output");
if (
  !preflightPath.startsWith("/tmp/") ||
  (outputPath !== null && !outputPath.startsWith("/tmp/"))
) {
  throw new Error("authorization inputs and output must be under /tmp");
}
const safeVerificationPath = path.resolve(
  required("REGISTRY_SAFE_VERIFICATION_PATH"),
);
if (!safeVerificationPath.startsWith("/tmp/")) {
  throw new Error("Safe verification must be under /tmp");
}
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
const rpcA = required("REGISTRY_PREFLIGHT_RPC_URL_A");
const rpcB = required("REGISTRY_PREFLIGHT_RPC_URL_B");
requireDistinctRpcOrigins(rpcA, rpcB);
const providerIds = [
  required("REGISTRY_RPC_PROVIDER_ID_A"),
  required("REGISTRY_RPC_PROVIDER_ID_B"),
];
const clients = [rpcA, rpcB].map((url) =>
  createPublicClient({ chain: mainnet, transport: http(url) }),
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
const firstAttemptExpiresAtTimestamp = Number(
  required("REGISTRY_AUTHORIZATION_EXPIRES_AT"),
);
if (
  !Number.isSafeInteger(firstAttemptExpiresAtTimestamp) ||
  firstAttemptExpiresAtTimestamp <= nowTimestamp ||
  firstAttemptExpiresAtTimestamp > nowTimestamp + 300 ||
  firstAttemptExpiresAtTimestamp > plan.expiresAtTimestamp
) {
  throw new Error(
    "REGISTRY_AUTHORIZATION_EXPIRES_AT is stale or outside the preflight window",
  );
}
const authorization = {
  schemaVersion: REGISTRY_AUTHORIZATION_SCHEMA,
  status: "REVIEWED_READY_FOR_EXPLICIT_BROADCAST",
  preflightSha256,
  source: plan.source,
  ownerAuthorizationAddress,
  notBeforeTimestamp: nowTimestamp,
  firstAttemptExpiresAtTimestamp,
  authorizationSemantics: AUTHORIZATION_SEMANTICS,
  signingAllowed: true,
  broadcastAllowed: true,
};
authorization.reviewedPlanDigest = computeReviewedPlanDigest({
  preflightSha256,
  ownerAuthorizationAddress,
  notBeforeTimestamp: nowTimestamp,
  firstAttemptExpiresAtTimestamp,
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
