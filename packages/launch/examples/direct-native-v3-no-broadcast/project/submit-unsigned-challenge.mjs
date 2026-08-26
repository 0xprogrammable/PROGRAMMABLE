#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const idempotencyKey = required("PROGRAMMABLE_IDEMPOTENCY_KEY");
if (!/^[A-Za-z0-9._:-]{16,128}$/.test(idempotencyKey)) {
  throw new TypeError("PROGRAMMABLE_IDEMPOTENCY_KEY must satisfy the CLI Idempotency-Key grammar");
}

const executable = process.env.PROGRAMMABLE_LAUNCH_BIN ?? "programmable-launch";
const args = [
  "submit",
  path.join(root, "launch.json"),
  "--config",
  path.join(root, "programmable-launch.config.json"),
  "--idempotency-key",
  idempotencyKey,
  "--state-dir",
  path.join(root, ".programmable-state"),
  "--max-attempts",
  "1",
];
if (process.env.PROGRAMMABLE_API_ORIGIN) {
  args.push("--api-origin", process.env.PROGRAMMABLE_API_ORIGIN);
}

const { code, stdout } = await run(executable, args);
if (code !== 0) process.exit(code);

let result;
try {
  result = JSON.parse(stdout);
} catch {
  throw new TypeError("programmable-launch submit returned non-JSON output");
}
if (result?.resource?.status !== "awaiting_funding_authorization") {
  throw new TypeError(
    `NO_BROADCAST_BOUNDARY: expected awaiting_funding_authorization, received ${String(result?.resource?.status)}`,
  );
}
for (const forbidden of ["signature", "walletTransaction", "rawTransaction", "transactionHash"]) {
  if (containsKey(result, forbidden)) {
    throw new TypeError(`NO_BROADCAST_BOUNDARY: unexpected ${forbidden} field in unsigned challenge response`);
  }
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: "programmable.direct-native-v3-unsigned-challenge-result.v1",
  requestSha256: result.requestSha256,
  requestId: result.resource.requestId ?? result.resource.launchId,
  status: result.resource.status,
  fundingIntentHash: result.resource.fundingIntentHash ?? null,
  stopped: true,
  fundingSignatureSubmitted: false,
  routerTransactionRequested: false,
  walletBroadcast: false,
}, null, 2)}\n`);

function required(name) {
  const value = process.env[name];
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

function containsKey(value, key) {
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, key));
  if (value === null || typeof value !== "object") return false;
  return Object.hasOwn(value, key) || Object.values(value).some((entry) => containsKey(entry, key));
}

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
  });
}
