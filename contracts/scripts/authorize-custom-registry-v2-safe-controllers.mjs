import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

import {
  SAFE_AUTHORIZATION_SCHEMA,
  assertSafePolicyBoundPlan,
  assertSafePreflightEnvelope,
  computeSafeReviewedPlanDigest,
  safeReviewedAuthorizationMessage,
  verifySafeReviewedAuthorizationSignature,
} from "./custom-registry-v2-safe-controller-guards.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1])
    throw new Error(`${name} is required`);
  return path.resolve(process.argv[index + 1]);
};
const preflightPath = argument("--preflight");
const printMessage = process.argv.includes("--print-message");
const outputPath = printMessage ? null : argument("--output");
if (
  !preflightPath.startsWith("/tmp/") ||
  (outputPath !== null && !outputPath.startsWith("/tmp/"))
)
  throw new Error("Safe authorization inputs and output must be under /tmp");

const preflightBytes = await readFile(preflightPath);
const preflightSha256 = `0x${createHash("sha256")
  .update(preflightBytes)
  .digest("hex")}`;
if (preflightSha256 !== process.env.REGISTRY_SAFE_REVIEWED_PLAN_SHA256)
  throw new Error("reviewed Safe preflight digest mismatch");
const plan = JSON.parse(preflightBytes);
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
const expiresAtTimestamp = Number(
  process.env.REGISTRY_SAFE_AUTHORIZATION_EXPIRES_AT,
);
if (
  !Number.isSafeInteger(expiresAtTimestamp) ||
  expiresAtTimestamp < nowTimestamp ||
  expiresAtTimestamp > nowTimestamp + 300 ||
  expiresAtTimestamp > plan.expiresAtTimestamp
)
  throw new Error("Safe authorization is stale or outside the reviewed window");

const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], {
  cwd: root,
  encoding: "utf8",
}).trim();
if (
  commit !== plan.source.commit ||
  tree !== plan.source.tree ||
  execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }) !== ""
)
  throw new Error("Safe preflight source is not current and clean");

const authorization = {
  schemaVersion: SAFE_AUTHORIZATION_SCHEMA,
  status: "REVIEWED_READY_FOR_EXPLICIT_SAFE_BROADCAST",
  preflightSha256,
  source: { commit, tree },
  policySha256: plan.policySha256,
  custodyProofSha256: plan.custodyProofSha256,
  ownerAuthorizationAddress,
  expiresAtTimestamp,
  signingAllowed: true,
  broadcastAllowed: true,
};
authorization.reviewedPlanDigest = computeSafeReviewedPlanDigest({
  preflightSha256,
  ownerAuthorizationAddress,
  expiresAtTimestamp,
  sourceCommit: commit,
  sourceTree: tree,
  policySha256: plan.policySha256,
  custodyProofSha256: plan.custodyProofSha256,
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
