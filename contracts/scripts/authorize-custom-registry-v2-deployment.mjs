import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertPreflightEnvelope,
  computeConstructorCommitment,
  computeReviewedPlanDigest,
  reviewedAuthorizationMessage,
  verifyReviewedAuthorizationSignature,
} from "./custom-registry-v2-deployment-guards.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argument = (name) => {
  const index = process.argv.indexOf(name);
  if (index === -1 || !process.argv[index + 1]) throw new Error(`${name} is required`);
  return path.resolve(process.argv[index + 1]);
};
const preflightPath = argument("--preflight");
const printMessage = process.argv.includes("--print-message");
const outputPath = printMessage ? null : argument("--output");
if (!preflightPath.startsWith("/tmp/") || (outputPath !== null && !outputPath.startsWith("/tmp/"))) {
  throw new Error("authorization inputs and output must be under /tmp");
}
const ownerAuthorizationAddress = process.env.REGISTRY_RELEASE_OWNER;
const ownerAuthorizationSignature = process.env.REGISTRY_OWNER_AUTHORIZATION_SIGNATURE;
const expiresAtTimestamp = Number(process.env.REGISTRY_AUTHORIZATION_EXPIRES_AT);
if (!printMessage && !/^0x[0-9a-fA-F]{130}$/.test(ownerAuthorizationSignature ?? "")) {
  throw new Error("REGISTRY_OWNER_AUTHORIZATION_SIGNATURE is required");
}
const preflightBytes = await readFile(preflightPath);
const preflightSha256 = `0x${createHash("sha256").update(preflightBytes).digest("hex")}`;
const plan = JSON.parse(preflightBytes);
const nowTimestamp = Math.floor(Date.now() / 1000);
assertPreflightEnvelope(plan, nowTimestamp);
if (
  !/^0x[0-9a-fA-F]{40}$/.test(ownerAuthorizationAddress ?? "")
  || !/^0x[0-9a-fA-F]{40}$/.test(plan.releaseAuthorization?.owner ?? "")
  || ownerAuthorizationAddress.toLowerCase() !== plan.releaseAuthorization.owner.toLowerCase()
) throw new Error("REGISTRY_RELEASE_OWNER does not match the reviewed preflight");
if (computeConstructorCommitment(plan.constructor) !== plan.constructorCommitment) {
  throw new Error("constructor commitment mismatch");
}
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: root, encoding: "utf8" }).trim();
if (commit !== plan.source.commit || tree !== plan.source.tree) throw new Error("preflight source is not current");
if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }) !== "") {
  throw new Error("authorization requires a clean worktree");
}
if (
  !Number.isSafeInteger(expiresAtTimestamp)
  || expiresAtTimestamp < nowTimestamp
  || expiresAtTimestamp > nowTimestamp + 300
  || expiresAtTimestamp > plan.expiresAtTimestamp
) {
  throw new Error("REGISTRY_AUTHORIZATION_EXPIRES_AT is stale or outside the preflight window");
}
const authorization = {
  schemaVersion: "programmable.custom-registry-deployment-authorization.v2",
  status: "REVIEWED_READY_FOR_EXPLICIT_BROADCAST",
  preflightSha256,
  source: { commit, tree },
  ownerAuthorizationAddress,
  ownerAuthorizationSignature,
  expiresAtTimestamp,
  signingAllowed: true,
  broadcastAllowed: true,
};
authorization.reviewedPlanDigest = computeReviewedPlanDigest({
  preflightSha256,
  ownerAuthorizationAddress,
  expiresAtTimestamp,
  sourceCommit: commit,
  sourceTree: tree,
});
if (printMessage) {
  process.stdout.write(`${JSON.stringify({
    reviewedPlanDigest: authorization.reviewedPlanDigest,
    message: reviewedAuthorizationMessage(authorization.reviewedPlanDigest),
  })}\n`);
  process.exit(0);
}
await verifyReviewedAuthorizationSignature(authorization);
await writeFile(outputPath, `${JSON.stringify(authorization, null, 2)}\n`, { flag: "wx", mode: 0o600 });
process.stdout.write(`CUSTOM_REGISTRY_V2_REVIEWED_AUTHORIZATION ${outputPath}\n`);
