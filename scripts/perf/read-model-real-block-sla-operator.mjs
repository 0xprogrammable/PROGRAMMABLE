#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { verifyRealBlockSlaDatabaseAttestation } from "./read-model-real-block-sla-gate.mjs";

export const REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS = 5 * 60 * 1_000;

const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 1_000;
const MAXIMUM_RESPONSE_BYTES = 1024 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NONZERO_BYTES32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const COMMIT = /^(?!0{40}$)[0-9a-f]{40}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,128}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u;
const STREAM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const USAGE =
  "usage: --target-url <exact-staged-origin> --deployment-id <id> --expected-commit <sha> --project-id <id> --stream-id <id> --output <absolute-path>";

function fail() {
  throw new Error("real block SLA operator failed");
}

function exactObject(value, keys) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
  ) fail();
  return value;
}

function exactStagedOrigin(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    return fail();
  }
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== "" ||
    !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.vercel\.app$/u.test(
      target.hostname,
    )
  ) fail();
  return target.origin;
}

function exactSecret(value, minimumBytes) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < minimumBytes ||
    Buffer.byteLength(value, "utf8") > 1_024 ||
    /[\r\n]/u.test(value)
  ) fail();
  return value;
}

export function realBlockSlaOperatorArgumentsFrom(argv) {
  const allowed = new Set([
    "--target-url",
    "--deployment-id",
    "--expected-commit",
    "--project-id",
    "--stream-id",
    "--output",
  ]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !allowed.has(name) ||
      typeof value !== "string" ||
      value.length === 0 ||
      value.startsWith("--") ||
      values.has(name)
    ) throw new Error(USAGE);
    values.set(name, value);
  }
  if (values.size !== allowed.size) throw new Error(USAGE);

  const targetUrl = exactStagedOrigin(values.get("--target-url"));
  const deploymentId = values.get("--deployment-id");
  const expectedRepositoryCommit = values.get("--expected-commit");
  const projectId = values.get("--project-id");
  const streamId = values.get("--stream-id");
  const outputPath = values.get("--output");
  if (
    !DEPLOYMENT_ID.test(deploymentId) ||
    !COMMIT.test(expectedRepositoryCommit) ||
    !SAFE_ID.test(projectId) ||
    !STREAM_ID.test(streamId) ||
    !isAbsolute(outputPath) ||
    Buffer.byteLength(outputPath, "utf8") > 4_096
  ) throw new Error(USAGE);

  return Object.freeze({
    targetUrl,
    deploymentId,
    expectedRepositoryCommit,
    projectId,
    streamId,
    outputPath: resolve(outputPath),
  });
}

function privateNoStore(response) {
  const directives = response.headers.get("cache-control")
    ?.split(",")
    .map((value) => value.trim().toLowerCase())
    .sort();
  const contentType = response.headers.get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    JSON.stringify(directives) !== JSON.stringify(["no-store", "private"]) ||
    contentType !== "application/json"
  ) fail();
}

async function boundedJson(response) {
  privateNoStore(response);
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declared) ||
      Number(declared) > MAXIMUM_RESPONSE_BYTES)
  ) fail();
  if (!response.body) fail();
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel();
      return fail();
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks, length).toString("utf8");
  try {
    return JSON.parse(body);
  } catch {
    return fail();
  }
}

function transportFailure(error) {
  return error instanceof TypeError ||
    error?.name === "AbortError" ||
    error?.name === "TimeoutError";
}

function challengeFrom(randomBytesImpl) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const bytes = randomBytesImpl(32);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) fail();
    const challenge = `0x${Buffer.from(bytes).toString("hex")}`;
    if (NONZERO_BYTES32.test(challenge)) return challenge;
  }
  return fail();
}

function wait(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

async function retryDelay(input) {
  const remaining = input.deadlineMs - input.now();
  if (remaining <= 0) fail();
  await input.sleep(Math.min(RETRY_DELAY_MS, remaining));
}

async function callApi(input) {
  const remaining = input.deadlineMs - input.now();
  if (remaining <= 0) fail();
  try {
    const response = await input.fetchImpl(input.url, {
      method: input.method,
      redirect: "error",
      cache: "no-store",
      signal: input.signalFactory(Math.min(REQUEST_TIMEOUT_MS, remaining)),
      headers: input.headers,
      body: JSON.stringify(input.body),
    });
    const value = await boundedJson(response);
    return Object.freeze({ status: response.status, value });
  } catch (error) {
    if (!transportFailure(error)) throw error;
    return Object.freeze({ status: 0, value: null });
  }
}

function exactBinding(evidence, input, challenge) {
  if (
    evidence === null ||
    typeof evidence !== "object" ||
    Array.isArray(evidence) ||
    evidence.challenge !== challenge ||
    evidence.runtimeReceipt === null ||
    typeof evidence.runtimeReceipt !== "object" ||
    Array.isArray(evidence.runtimeReceipt)
  ) fail();
  const runtime = evidence.runtimeReceipt;
  if (
    runtime.repositoryCommit !== input.expectedRepositoryCommit ||
    runtime.deploymentId !== input.deploymentId ||
    runtime.deploymentOrigin !== input.targetUrl ||
    runtime.projectId !== input.projectId ||
    runtime.streamId !== input.streamId
  ) fail();
}

export async function writeRealBlockSlaEvidenceExclusive(outputPath, evidence) {
  if (!isAbsolute(outputPath)) fail();
  const absolutePath = resolve(outputPath);
  const parent = dirname(absolutePath);
  const [parentMetadata, canonicalParent] = await Promise.all([
    lstat(parent),
    realpath(parent),
  ]);
  if (
    !parentMetadata.isDirectory() ||
    parentMetadata.isSymbolicLink() ||
    canonicalParent !== parent
  ) fail();

  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (
    Buffer.byteLength(serialized, "utf8") < 2 ||
    Buffer.byteLength(serialized, "utf8") > MAXIMUM_RESPONSE_BYTES
  ) fail();
  const file = await open(absolutePath, "wx", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(serialized, { encoding: "utf8" });
    await file.sync();
  } finally {
    await file.close();
  }
  return absolutePath;
}

export async function runRealBlockSlaOperator(input) {
  const binding = realBlockSlaOperatorArgumentsFrom([
    "--target-url", input.targetUrl,
    "--deployment-id", input.deploymentId,
    "--expected-commit", input.expectedRepositoryCommit,
    "--project-id", input.projectId,
    "--stream-id", input.streamId,
    "--output", input.outputPath,
  ]);
  const maximumWaitMs = input.maximumWaitMs ?? REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS;
  if (
    !Number.isSafeInteger(maximumWaitMs) ||
    maximumWaitMs < 1_000 ||
    maximumWaitMs > REAL_BLOCK_SLA_OPERATOR_MAXIMUM_WAIT_MS
  ) fail();
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const wallNow = input.wallNow ?? Date.now;
  const startedAt = monotonicNow();
  if (!Number.isFinite(startedAt) || startedAt < 0) fail();
  const deadlineMs = startedAt + maximumWaitMs;
  if (!Number.isFinite(deadlineMs)) fail();

  const probeToken = exactSecret(
    input.probeToken ?? process.env.PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN,
    32,
  );
  const bypassSecret = exactSecret(
    input.automationBypassSecret ?? process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    16,
  );
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? wait;
  const signalFactory = input.signalFactory ?? ((timeoutMs) => AbortSignal.timeout(timeoutMs));
  const randomBytesImpl = input.randomBytesImpl ?? randomBytes;
  const verifyEvidence = input.verifyEvidence ?? verifyRealBlockSlaDatabaseAttestation;
  const writeEvidence = input.writeEvidence ?? writeRealBlockSlaEvidenceExclusive;
  const url = `${binding.targetUrl}/api/ops/read-model-real-block-sla`;
  const headers = Object.freeze({
    accept: "application/json",
    "content-type": "application/json",
    "x-programmable-performance-probe": "1",
    "x-programmable-performance-probe-token": probeToken,
    "x-vercel-protection-bypass": bypassSecret,
  });

  let armId;
  while (armId === undefined) {
    const result = await callApi({
      url,
      method: "PUT",
      body: { action: "arm-provider-retry", streamId: binding.streamId },
      headers,
      deadlineMs,
      now: monotonicNow,
      fetchImpl,
      signalFactory,
    });
    if (result.status === 200) {
      const arm = exactObject(result.value, ["armed", "armId"]);
      if (arm.armed !== true || typeof arm.armId !== "string" || !UUID.test(arm.armId)) {
        fail();
      }
      armId = arm.armId;
      break;
    }
    if (result.status !== 0 && result.status !== 503) fail();
    await retryDelay({ deadlineMs, now: monotonicNow, sleep });
  }

  const challenge = challengeFrom(randomBytesImpl);
  let evidence;
  while (evidence === undefined) {
    const result = await callApi({
      url,
      method: "POST",
      body: { armId, challenge },
      headers,
      deadlineMs,
      now: monotonicNow,
      fetchImpl,
      signalFactory,
    });
    if (result.status === 200) {
      evidence = result.value;
      break;
    }
    if (![0, 409, 503].includes(result.status)) fail();
    await retryDelay({ deadlineMs, now: monotonicNow, sleep });
  }

  exactBinding(evidence, binding, challenge);
  verifyEvidence(evidence, {
    expectedRepositoryCommit: binding.expectedRepositoryCommit,
    expectedDeploymentId: binding.deploymentId,
    expectedTargetUrl: binding.targetUrl,
    nowMs: wallNow(),
    probeToken,
  });
  const evidencePath = await writeEvidence(binding.outputPath, evidence);
  return Object.freeze({ ok: true, evidencePath });
}

async function main() {
  const args = realBlockSlaOperatorArgumentsFrom(process.argv.slice(2));
  const result = await runRealBlockSlaOperator(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch(() => {
    process.stderr.write("real block SLA operator failed\n");
    process.exitCode = 1;
  });
}
