#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registry = readJson("models/registry.json");
const errors = [];
const addressPattern = /^0x[a-fA-F0-9]{40}$/;
const hashPattern = /^0x[a-fA-F0-9]{64}$/;
const commitPattern = /^[a-f0-9]{40}$/;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function requireFile(relativePath, context) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    errors.push(`${context}: missing ${relativePath}`);
  }
}

for (const entry of registry.models.filter(({ status }) => status === "available")) {
  const model = readJson(entry.manifest);
  const specification = readJson(model.specification);
  const deployment = readJson(model.deployment);
  const release = readJson(model.releaseManifest);
  const context = `${model.name} ${model.currentRelease}`;

  if (release.status !== "available" || release.model !== model.id || release.release !== model.currentRelease) {
    errors.push(`${context}: release identity is inconsistent`);
  }
  if (!commitPattern.test(release.sourcePublicationCommit ?? "")) {
    errors.push(`${context}: sourcePublicationCommit must be a full Git commit`);
  } else if (fs.existsSync(path.join(root, ".git"))) {
    try {
      execFileSync(
        "git",
        ["merge-base", "--is-ancestor", release.sourcePublicationCommit, "HEAD"],
        { cwd: root, stdio: "ignore" }
      );
    } catch {
      errors.push(`${context}: sourcePublicationCommit is not an ancestor of HEAD`);
    }
  }
  if (release.compiler?.solc !== "0.8.26" || release.compiler?.evmVersion !== "cancun") {
    errors.push(`${context}: compiler settings differ from foundry.toml`);
  }

  for (const evidencePath of [
    release.evidence?.specification,
    release.evidence?.deployment,
    release.evidence?.security,
    ...(release.evidence?.tests ?? [])
  ]) {
    requireFile(evidencePath, context);
  }

  if (specification.release !== release.release || deployment.release !== release.release) {
    errors.push(`${context}: specification or deployment identifies another release`);
  }
  if (specification.chainId !== 1 || deployment.chainId !== 1 || release.network?.chainId !== 1) {
    errors.push(`${context}: Ethereum chainId must be 1`);
  }
  if (!Number.isInteger(deployment.deploymentBlock) || deployment.deploymentBlock <= 0) {
    errors.push(`${context}: deploymentBlock must be a positive integer`);
  }

  const manifestContracts = new Map(model.contracts.map((contract) => [contract.deploymentKey, contract]));
  for (const [deploymentKey, contract] of Object.entries(deployment.contracts ?? {})) {
    if (!addressPattern.test(contract.address ?? "")) {
      errors.push(`${context}: ${deploymentKey} has an invalid address`);
    }
    if (!hashPattern.test(contract.runtimeCodeHash ?? "")) {
      errors.push(`${context}: ${deploymentKey} has an invalid runtimeCodeHash`);
    }
    if (contract.transactionHash !== undefined && !hashPattern.test(contract.transactionHash)) {
      errors.push(`${context}: ${deploymentKey} has an invalid transactionHash`);
    }
    if (contract.etherscan !== `https://etherscan.io/address/${contract.address}#code`) {
      errors.push(`${context}: ${deploymentKey} has an inconsistent Etherscan link`);
    }

    const manifestContract = manifestContracts.get(deploymentKey);
    if (!manifestContract || manifestContract.address.toLowerCase() !== contract.address.toLowerCase()) {
      errors.push(`${context}: ${deploymentKey} differs between model and deployment manifests`);
    }
  }

  if (manifestContracts.size !== Object.keys(deployment.contracts ?? {}).length) {
    errors.push(`${context}: contract counts differ between model and deployment manifests`);
  }
  if (deployment.sourceVerification?.etherscan !== "exact-match") {
    errors.push(`${context}: Etherscan verification is not recorded as an exact match`);
  }
  if (deployment.sourceVerification?.sourcify !== "match") {
    errors.push(`${context}: Sourcify verification is not recorded as a match`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Verified all available release manifests and deployment records.");
