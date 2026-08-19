#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_REGISTRY_V1_PATH,
  contractRegistryBytesV1,
  generateContractRegistryV1
} from "./contract-registry-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.resolve(skillRoot, CONTRACT_REGISTRY_V1_PATH);

try {
  const mode = parseMode(process.argv.slice(2));
  const expectedBytes = contractRegistryBytesV1(generateContractRegistryV1({ skillRoot }));
  if (mode === "--check") {
    const actualBytes = readCommittedRegistry(outputPath);
    if (!actualBytes.equals(expectedBytes)) {
      throw new Error(`${CONTRACT_REGISTRY_V1_PATH} is stale; regenerate it with --write`);
    }
    process.stdout.write(`contract registry is current (${expectedBytes.length} bytes)\n`);
  } else {
    writeAtomicRegularFile(outputPath, expectedBytes);
    process.stdout.write(`wrote ${CONTRACT_REGISTRY_V1_PATH} (${expectedBytes.length} bytes)\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseMode(argumentsList) {
  if (argumentsList.length === 0) return "--check";
  if (argumentsList.length === 1 && ["--check", "--write"].includes(argumentsList[0])) return argumentsList[0];
  throw new Error("usage: generate-contract-registry.mjs [--check|--write]");
}

function readCommittedRegistry(filePath) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${CONTRACT_REGISTRY_V1_PATH} must be a regular file`);
  return fs.readFileSync(filePath);
}

function writeAtomicRegularFile(filePath, bytes) {
  if (fs.existsSync(filePath)) {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${CONTRACT_REGISTRY_V1_PATH} must be a regular file`);
  }
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.chmodSync(temporaryPath, 0o644);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}
