#!/usr/bin/env node

import { createHash, createHmac, randomBytes } from "node:crypto";

export const PROJECTOR_WAKE_ROUTE = "/api/ops/projector-wake";
export const QUICKNODE_STREAM_SECRET_ENV_NAME =
  "PROGRAMMABLE_QUICKNODE_STREAM_SECRET";

const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_SECRET_BYTES = 1_024;
const STALE_TIMESTAMP_OFFSET_SECONDS = 360;
const REQUEST_TIMEOUT_MS = 15_000;

function exactStagedOrigin(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("wake canary target must be an exact HTTPS origin");
  }
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== "" ||
    !target.hostname.endsWith(".vercel.app")
  ) {
    throw new Error(
      "wake canary target must be a deployment-specific Vercel HTTPS origin",
    );
  }
  return target.origin;
}

function configuredSecret(environment) {
  const secret = environment[QUICKNODE_STREAM_SECRET_ENV_NAME];
  const length = typeof secret === "string"
    ? Buffer.byteLength(secret, "utf8")
    : 0;
  if (
    typeof secret !== "string" ||
    length < MINIMUM_SECRET_BYTES ||
    length > MAXIMUM_SECRET_BYTES
  ) {
    throw new Error("wake canary secret is unavailable or invalid");
  }
  return secret;
}

function mutateSignature(signature) {
  return `${signature[0] === "0" ? "1" : "0"}${signature.slice(1)}`;
}

function signedHeaders({ body, nonce, secret, timestamp, valid }) {
  const signature = createHmac("sha256", secret)
    .update(nonce, "utf8")
    .update(timestamp, "utf8")
    .update(body, "utf8")
    .digest("hex");
  return Object.freeze({
    "cache-control": "no-store",
    "content-type": "application/json",
    "x-qn-nonce": nonce,
    "x-qn-timestamp": timestamp,
    "x-qn-signature": valid ? signature : mutateSignature(signature),
  });
}

async function expectJsonResponse(response, expectation) {
  if (response.status !== expectation.status) {
    throw new Error(`${expectation.id} returned an unexpected status`);
  }
  if (response.headers.get("cache-control")?.trim().toLowerCase() !== "no-store") {
    throw new Error(`${expectation.id} did not return Cache-Control: no-store`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new Error(`${expectation.id} did not return JSON`);
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > 4_096) {
    throw new Error(`${expectation.id} returned an oversized response`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${expectation.id} returned malformed JSON`);
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    value[expectation.bodyKey] !== expectation.bodyValue
  ) {
    throw new Error(`${expectation.id} returned an unexpected body`);
  }
  return Object.freeze({ id: expectation.id, status: response.status });
}

export async function runProjectorWakeCanary(input) {
  const targetOrigin = exactStagedOrigin(input.targetUrl);
  const secret = configuredSecret(input.environment ?? process.env);
  const fetchImpl = input.fetchImpl ?? fetch;
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
    throw new Error("wake canary clock is invalid");
  }
  const nonceFactory = input.nonceFactory ?? (() => randomBytes(24).toString("hex"));
  const probeId = (input.probeIdFactory ?? (() => randomBytes(16).toString("hex")))();
  if (!/^[0-9a-f]{32}$/u.test(probeId)) {
    throw new Error("wake canary probe identity is invalid");
  }
  const body = JSON.stringify({
    programmableWakeCanary: {
      schemaVersion: 1,
      probeId,
      sentAt: new Date(nowMs).toISOString(),
    },
  });
  const currentTimestamp = String(Math.floor(nowMs / 1_000));
  const staleTimestamp = String(
    Math.floor(nowMs / 1_000) - STALE_TIMESTAMP_OFFSET_SECONDS,
  );
  const cases = Object.freeze([
    Object.freeze({
      id: "invalid-signature",
      timestamp: currentTimestamp,
      validSignature: false,
      status: 401,
      bodyKey: "error",
      bodyValue: "Unauthorized",
    }),
    Object.freeze({
      id: "stale-timestamp",
      timestamp: staleTimestamp,
      validSignature: true,
      status: 401,
      bodyKey: "error",
      bodyValue: "Unauthorized",
    }),
    Object.freeze({
      id: "valid-delivery",
      timestamp: currentTimestamp,
      validSignature: true,
      status: 202,
      bodyKey: "accepted",
      bodyValue: true,
    }),
  ]);
  const checks = [];
  const target = new URL(PROJECTOR_WAKE_ROUTE, targetOrigin);
  for (const canaryCase of cases) {
    const nonce = nonceFactory(canaryCase.id);
    if (
      typeof nonce !== "string" ||
      nonce.length < 16 ||
      nonce.length > 256 ||
      !/^[\x21-\x7e]+$/u.test(nonce)
    ) {
      throw new Error("wake canary nonce is invalid");
    }
    let response;
    try {
      response = await fetchImpl(target, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: signedHeaders({
          body,
          nonce,
          secret,
          timestamp: canaryCase.timestamp,
          valid: canaryCase.validSignature,
        }),
        body,
      });
    } catch {
      throw new Error(`${canaryCase.id} request failed`);
    }
    checks.push(await expectJsonResponse(response, canaryCase));
  }
  return Object.freeze({
    ok: true,
    targetOrigin,
    route: PROJECTOR_WAKE_ROUTE,
    payloadSha256: createHash("sha256").update(body, "utf8").digest("hex"),
    checks: Object.freeze(checks),
  });
}

export function projectorWakeCanaryArgumentsFrom(argv) {
  if (
    argv.length !== 2 ||
    argv[0] !== "--target-url" ||
    typeof argv[1] !== "string" ||
    argv[1] === ""
  ) {
    throw new Error("usage: --target-url <exact-staged-origin>");
  }
  return Object.freeze({ targetUrl: argv[1] });
}

async function main() {
  const args = projectorWakeCanaryArgumentsFrom(process.argv.slice(2));
  const result = await runProjectorWakeCanary(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "wake canary failed"}\n`,
    );
    process.exitCode = 1;
  });
}
