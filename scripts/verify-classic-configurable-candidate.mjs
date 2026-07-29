#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateRoot = "models/classic/candidates/configurable";
const spec = readJson(`${candidateRoot}/spec.json`);
const deployment = readJson(`${candidateRoot}/sepolia.json`);
const errors = [];
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const hashPattern = /^0x[a-fA-F0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;
const contractFields = [
  "ctoAuthority",
  "rewardVaultFactory",
  "initialBuyVestingWalletFactory",
  "launchPolicy",
  "hookFactory",
  "feeHook",
  "launcher"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function requireFile(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    errors.push(`missing ${relativePath}`);
  }
}

if (spec.status !== "candidate" || deployment.status !== "deployment-source-and-lifecycle-verified") {
  errors.push("candidate status is inconsistent");
}
if (spec.network?.chainId !== 11155111 || deployment.chainId !== 11155111) {
  errors.push("candidate evidence must identify Sepolia");
}
if (
  !commitPattern.test(spec.sourcePublicationCommit ?? "") ||
  spec.sourcePublicationCommit !== deployment.sourcePublicationCommit
) {
  errors.push("source publication commit is missing or inconsistent");
} else {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", spec.sourcePublicationCommit, "HEAD"], {
      cwd: root,
      stdio: "ignore"
    });
  } catch {
    errors.push("source publication commit is not an ancestor of HEAD");
  }
}
if (deployment.sourceCommitment !== "0x19b0bc50cdffb1872a581c4c410a4ebf1acfe4e7ac8ddb334d1696218f3b2b0c") {
  errors.push("reviewed source commitment changed");
}
if (spec.fees?.programmableFeeBps !== 10 || spec.fees?.transferTaxBps !== 0) {
  errors.push("published fee policy changed");
}
if (spec.rewards?.maximumBeneficiaries !== 5 || spec.rewards?.totalSharesBps !== 10000) {
  errors.push("published reward bounds changed");
}

for (const relativePath of [
  spec.evidence?.deployment,
  spec.evidence?.security,
  ...(spec.evidence?.sourceFiles ?? []),
  ...(spec.evidence?.tests ?? [])
]) {
  requireFile(relativePath);
}

for (const field of contractFields) {
  if (!addressPattern.test(deployment.addresses?.[field] ?? "")) {
    errors.push(`${field}: invalid address`);
  }
  if (!hashPattern.test(deployment.transactions?.[field] ?? "")) {
    errors.push(`${field}: invalid transaction hash`);
  }
  if (!hashPattern.test(deployment.runtimeCodeHashes?.[field] ?? "")) {
    errors.push(`${field}: invalid runtime hash`);
  }
  if (!Number.isInteger(deployment.deploymentBlocks?.[field]) || deployment.deploymentBlocks[field] <= 0) {
    errors.push(`${field}: invalid deployment block`);
  }
  const source = deployment.sourceVerification?.[field];
  if (
    source?.status !== "verified" ||
    source?.sourcify?.match !== "match" ||
    source?.sourcify?.creationMatch !== "match" ||
    source?.sourcify?.runtimeMatch !== "match" ||
    source?.blockscout?.verified !== true ||
    source?.routescan?.verified !== true
  ) {
    errors.push(`${field}: incomplete source verification`);
  }
}

const lifecycle = deployment.lifecycleEvidence;
for (const field of [
  "deploymentTransactionsVerified",
  "runtimeBindingsVerified",
  "positionLockVerified",
  "buyAndSellVerified",
  "creatorClaimVerified",
  "launcherClaimVerified"
]) {
  if (lifecycle?.[field] !== true) {
    errors.push(`lifecycle: ${field} is not verified`);
  }
}
if (
  lifecycle?.status !== "verified-current-release" ||
  lifecycle?.releaseEligible !== true ||
  lifecycle?.independentRpcCount !== 2
) {
  errors.push("lifecycle evidence is incomplete");
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Verified configurable Classic source, Sepolia deployment and lifecycle evidence.");
