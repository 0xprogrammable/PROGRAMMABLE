#!/usr/bin/env node

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const REQUEST_SCHEMA =
  "programmable.website-generic-launch-read-stage-probe-request.v1";
const EXPECTED_SCHEMA =
  "programmable.website-generic-launch-read-stage-probe-expected.v1";
const RECEIPT_SCHEMA =
  "programmable.website-generic-launch-read-stage-probe-receipt.v1";
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const MACHINE = /^[0-9a-f]{14}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]{20,80}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const MAXIMUM_RESPONSE_BYTES = 262_144;

export async function verifyGenericSignerProbeStageV1(input) {
  const target = exactTarget(input.targetUrl);
  exact(input.deploymentId, DEPLOYMENT, "probe deployment ID");
  exact(input.gitHead, COMMIT, "probe Git head");
  const bypass = secret(input.automationBypassSecret, "Vercel bypass");
  const probeSecret = secret(input.probeSecret, "Generic signer probe secret");
  const expectedSource = String(input.expectedJson ?? "").trim();
  if (sha256(expectedSource) !== exact(
    input.expectedSha256,
    DIGEST,
    "expected probe digest",
  )) throw new Error("expected probe digest does not match");
  const expected = expectedProbe(JSON.parse(expectedSource));
  const receipts = [];
  for (const targetMachineId of expected.machineIds) {
    const request = Object.freeze({
      schemaVersion: REQUEST_SCHEMA,
      operationId: expected.operationId,
      nonceSha256: expected.nonceSha256,
      sourceCommit: expected.sourceCommit,
      sourceTree: expected.sourceTree,
      genericImageDigest: expected.genericImageDigest,
      genericBindingSha256: expected.genericBindingSha256,
      genericSignRequestSha256: expected.genericSignRequestSha256,
      targetMachineId,
    });
    const response = await (input.fetchImpl ?? fetch)(new URL(
      "/api/ops/custom-launch/generic-v2-signer-probe",
      target,
    ), {
      method: "POST",
      redirect: "error",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${probeSecret}`,
        "content-type": "application/json",
        "x-vercel-protection-bypass": bypass,
        "x-vercel-set-bypass-cookie": "false",
      },
      body: canonicalJson(request),
      signal: AbortSignal.timeout(30_000),
    });
    if (response.redirected || response.status !== 200
      || !response.headers.get("content-type")?.toLowerCase()
        .startsWith("application/json")) {
      throw new Error(`Generic signer probe ${targetMachineId} failed`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAXIMUM_RESPONSE_BYTES) {
      throw new Error("Generic signer probe response is too large");
    }
    const receipt = verifyReceipt(JSON.parse(text), {
      request, target, deploymentId: input.deploymentId, gitHead: input.gitHead,
    });
    receipts.push(receipt);
  }
  return Object.freeze({ expected, receipts: Object.freeze(receipts) });
}

function verifyReceipt(raw, context) {
  const receipt = object(raw, "Generic signer probe receipt");
  if (receipt.schemaVersion !== RECEIPT_SCHEMA || receipt.status !== "verified"
    || receipt.targetMachineId !== context.request.targetMachineId
    || receipt.operationId !== context.request.operationId
    || receipt.nonceSha256 !== context.request.nonceSha256
    || receipt.sourceCommit !== context.request.sourceCommit
    || receipt.sourceTree !== context.request.sourceTree
    || receipt.genericImageDigest !== context.request.genericImageDigest
    || receipt.genericBindingSha256 !== context.request.genericBindingSha256
    || receipt.genericSignRequestSha256
      !== context.request.genericSignRequestSha256) {
    throw new Error("Generic signer probe receipt binding is invalid");
  }
  const deployment = object(receipt.deployment, "probe deployment");
  if (deployment.deploymentId !== context.deploymentId
    || deployment.origin !== context.target.toString().replace(/\/$/u, "")
    || deployment.gitCommitSha !== context.gitHead
    || deployment.targetEnvironment !== "production") {
    throw new Error("Generic signer probe deployment binding is invalid");
  }
  const signer = object(receipt.signerBinding, "probe signer binding");
  const envelope = object(receipt.signedEnvelope, "signed probe envelope");
  const provider = object(receipt.providerResponse, "probe provider response");
  const providerReceipt = object(
    provider.providerReceipt,
    "probe provider receipt",
  );
  if (provider.schemaVersion
      !== "programmable.remote-signing-authenticated-response.v2"
    || providerReceipt.schemaVersion
      !== "programmable.remote-signing-provider-receipt.v2"
    || providerReceipt.outcome !== "completed"
    || providerReceipt.algorithm !== "Ed25519"
    || providerReceipt.signature !== envelope.signatureBase64Url
    || receipt.observedAt !== providerReceipt.observedAt
    || receipt.expiresAt !== providerReceipt.expiresAt
    || canonicalJson(envelope.payload) !== canonicalJson({
      schemaVersion:
        "programmable.website-generic-launch-read-stage-probe-payload.v1",
      request: context.request,
      workloadIdentity: receipt.workloadIdentity,
      deployment: receipt.deployment,
    })) throw new Error("Generic signer probe authenticated response is invalid");
  const requestBindingHash = canonicalSha256(
    "programmable.website-generic-launch-read-stage-probe-binding.v1",
    envelope.payload,
  );
  if (receipt.requestBindingHash !== requestBindingHash
    || envelope.requestBindingHash !== requestBindingHash
    || receipt.activationBindingHash !== envelope.activationBindingHash
    || receipt.readModelBindingHash !== envelope.readModelBindingHash) {
    throw new Error("Generic signer probe read binding is invalid");
  }
  const signatureMessage = Object.freeze({
    schemaVersion: "programmable.generic-launch-read-signature-message.v2",
    activationBindingHash: envelope.activationBindingHash,
    readModelBindingHash: envelope.readModelBindingHash,
    requestBindingHash,
    payload: envelope.payload,
  });
  const message = Buffer.from(canonicalJson(signatureMessage), "utf8");
  const messageSha256 = sha256Bytes(message);
  const idempotencyKey = canonicalSha256(
    "programmable.generic-launch-read-signing-idempotency.v2",
    {
      schemaVersion:
        "programmable.generic-launch-read-signing-idempotency.v2",
      activationBindingHash: envelope.activationBindingHash,
      readModelBindingHash: envelope.readModelBindingHash,
      requestBindingHash,
      messageSha256,
    },
  );
  const unsignedRequest = Object.freeze({
    schemaVersion: "programmable.remote-signing-request.v2",
    audience: signer.audience,
    keyId: signer.keyId,
    keyEpoch: signer.keyEpoch,
    algorithm: "Ed25519",
    providerIdentityHash: signer.providerIdentityHash,
    idempotencyKey,
    messageEncoding: "base64url",
    message: message.toString("base64url"),
    messageSha256,
  });
  const requestDigest = canonicalSha256(
    "programmable.remote-signing-request.v2",
    unsignedRequest,
  );
  if (providerReceipt.audience !== signer.audience
    || providerReceipt.keyId !== signer.keyId
    || providerReceipt.keyEpoch !== signer.keyEpoch
    || providerReceipt.providerIdentityHash !== signer.providerIdentityHash
    || providerReceipt.messageSha256 !== messageSha256
    || providerReceipt.idempotencyKey !== idempotencyKey
    || providerReceipt.requestDigest !== requestDigest
    || receipt.providerResponseSha256 !== sha256(canonicalJson(provider))) {
    throw new Error("Generic signer probe provider request is invalid");
  }
  const publicKey = createPublicKey(String(signer.publicKeyPem));
  const receiptBytes = Buffer.from(canonicalJson(providerReceipt), "utf8");
  if (publicKey.asymmetricKeyType !== "ed25519"
    || sha256Bytes(receiptBytes) !== provider.providerReceiptDigest
    || !SIGNATURE.test(String(providerReceipt.signature))
    || !SIGNATURE.test(String(provider.providerReceiptSignature))
    || !verifySignature(
      null,
      message,
      publicKey,
      Buffer.from(String(providerReceipt.signature), "base64url"),
    )
    || !verifySignature(
      null,
      receiptBytes,
      publicKey,
      Buffer.from(String(provider.providerReceiptSignature), "base64url"),
    )) throw new Error("Generic signer probe signatures are invalid");
  return receipt;
}

function expectedProbe(raw) {
  const value = object(raw, "expected Generic signer probe");
  const machineIds = Array.isArray(value.machineIds) ? value.machineIds : [];
  if (value.schemaVersion !== EXPECTED_SCHEMA || machineIds.length !== 2
    || machineIds.some((machine) => typeof machine !== "string"
      || !MACHINE.test(machine))
    || machineIds[0] === machineIds[1]
    || machineIds.join("\n") !== [...machineIds].sort().join("\n")) {
    throw new Error("expected Generic signer probe is invalid");
  }
  for (const [field, pattern] of [
    ["operationId", /^[0-9a-f]{32}$/u], ["nonceSha256", DIGEST],
    ["sourceCommit", COMMIT], ["sourceTree", COMMIT],
    ["genericImageDigest", DIGEST], ["genericBindingSha256", DIGEST],
    ["genericSignRequestSha256", DIGEST],
  ]) exact(value[field], pattern, `expected probe ${field}`);
  return Object.freeze({ ...value, machineIds: Object.freeze([...machineIds]) });
}

function exactTarget(value) {
  const target = new URL(value);
  if (target.protocol !== "https:" || target.username !== ""
    || target.password !== "" || target.pathname !== "/"
    || target.search !== "" || target.hash !== ""
    || !target.hostname.endsWith(".vercel.app")) {
    throw new Error("Generic signer probe target is not an immutable Vercel URL");
  }
  return target;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string"
    || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
  throw new Error("canonical JSON value is invalid");
}

function canonicalSha256(domain, value) {
  return sha256Bytes(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.of(0),
    Buffer.from(canonicalJson(value), "utf8"),
  ]));
}

function sha256(value) {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function object(value, label) {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function exact(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function secret(value, label) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32
    || Buffer.byteLength(value, "utf8") > 8_192 || /[\r\n]/u.test(value)) {
    throw new Error(`${label} is unavailable`);
  }
  return value;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!/^--[a-z][a-z-]*$/u.test(flag ?? "") || value === undefined
      || value.startsWith("--") || result[flag.slice(2)] !== undefined) {
      throw new Error("Generic signer probe arguments are invalid");
    }
    result[flag.slice(2)] = value;
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDirectory = args["output-directory"];
  if (!outputDirectory) throw new Error("--output-directory is required");
  const result = await verifyGenericSignerProbeStageV1({
    targetUrl: args["target-url"],
    deploymentId: args["deployment-id"],
    gitHead: args["git-head"],
    expectedSha256: args["expected-sha256"],
    expectedJson:
      process.env.PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_EXPECTED_V1_JSON,
    probeSecret: process.env.PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_TOKEN,
    automationBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  mkdirSync(outputDirectory, { recursive: false, mode: 0o700 });
  for (const receipt of result.receipts) {
    const bytes = `${canonicalJson(receipt)}\n`;
    writeFileSync(
      `${outputDirectory}/generic-signer-probe-${receipt.targetMachineId}.json`,
      bytes,
      { flag: "wx", mode: 0o600 },
    );
  }
  process.stdout.write(`${JSON.stringify({
    status: "verified",
    operationId: result.expected.operationId,
    machineIds: result.expected.machineIds,
    receiptSha256: result.receipts.map((receipt) => sha256(
      `${canonicalJson(receipt)}\n`,
    )),
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error
      ? error.message : "Generic signer probe failed"}\n`);
    process.exitCode = 1;
  });
}
