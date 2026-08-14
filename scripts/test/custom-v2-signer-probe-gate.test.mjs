import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import test from "node:test";

import { verifyGenericSignerProbeStageV1 } from
  "../custom-v2-signer-probe-gate.mjs";

const expected = Object.freeze({
  schemaVersion:
    "programmable.website-generic-launch-read-stage-probe-expected.v1",
  operationId: "01".repeat(16),
  nonceSha256: digest("nonce"),
  sourceCommit: "02".repeat(20),
  sourceTree: "03".repeat(20),
  genericImageDigest: digest("image"),
  genericBindingSha256: digest("binding"),
  genericSignRequestSha256: digest("sign-request"),
  machineIds: ["00000000000001", "00000000000002"],
});
const expectedJson = canonical(expected);
const targetUrl = "https://programmable-probe-example.vercel.app/";
const deploymentId = "dpl_0123456789abcdefghijklmnop";
const gitHead = "04".repeat(20);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
const publicKeySpki = publicKey.export({ format: "der", type: "spki" });

test("verifies two exact forced-Machine authenticated probe receipts", async () => {
  const observed = [];
  const result = await verifyGenericSignerProbeStageV1({
    targetUrl,
    deploymentId,
    gitHead,
    expectedJson,
    expectedSha256: digest(expectedJson),
    probeSecret: "p".repeat(32),
    automationBypassSecret: "b".repeat(32),
    fetchImpl: async (_url, init) => {
      assert.equal(init.headers.authorization, `Bearer ${"p".repeat(32)}`);
      const request = JSON.parse(init.body);
      observed.push(request.targetMachineId);
      return Response.json(receipt(request));
    },
  });
  assert.deepEqual(observed, expected.machineIds);
  assert.deepEqual(
    result.receipts.map((value) => value.targetMachineId),
    expected.machineIds,
  );
});

test("rejects a tampered authenticated provider signature", async () => {
  await assert.rejects(verifyGenericSignerProbeStageV1({
    targetUrl,
    deploymentId,
    gitHead,
    expectedJson,
    expectedSha256: digest(expectedJson),
    probeSecret: "p".repeat(32),
    automationBypassSecret: "b".repeat(32),
    fetchImpl: async (_url, init) => {
      const value = receipt(JSON.parse(init.body));
      value.providerResponse.providerReceiptSignature = "A".repeat(86);
      value.providerResponseSha256 = digest(canonical(value.providerResponse));
      return Response.json(value);
    },
  }), /signatures are invalid/u);
});

test("cancels an oversized chunked probe response without a content length", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(200_000));
      controller.enqueue(new Uint8Array(70_000));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(verifyGenericSignerProbeStageV1({
    targetUrl,
    deploymentId,
    gitHead,
    expectedJson,
    expectedSha256: digest(expectedJson),
    probeSecret: "p".repeat(32),
    automationBypassSecret: "b".repeat(32),
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  }), /response is too large/u);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

test("rejects a declared oversized probe response before buffering it", async () => {
  let canceled = false;
  const body = new ReadableStream({
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(verifyGenericSignerProbeStageV1({
    targetUrl,
    deploymentId,
    gitHead,
    expectedJson,
    expectedSha256: digest(expectedJson),
    probeSecret: "p".repeat(32),
    automationBypassSecret: "b".repeat(32),
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: {
        "content-length": "262145",
        "content-type": "application/json",
      },
    }),
  }), /response is too large/u);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

test("cancels a probe response larger than its small declared length", async () => {
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(140_000));
      controller.enqueue(new Uint8Array(140_000));
    },
    cancel() {
      canceled = true;
    },
  });
  await assert.rejects(verifyGenericSignerProbeStageV1({
    targetUrl,
    deploymentId,
    gitHead,
    expectedJson,
    expectedSha256: digest(expectedJson),
    probeSecret: "p".repeat(32),
    automationBypassSecret: "b".repeat(32),
    fetchImpl: async () => new Response(body, {
      status: 200,
      headers: {
        "content-length": "2",
        "content-type": "application/json",
      },
    }),
  }), /response is too large/u);
  assert.equal(canceled, true);
  assert.equal(body.locked, false);
});

function receipt(request) {
  const deployment = {
    schemaVersion:
      "programmable.website-generic-launch-read-stage-probe-deployment.v1",
    deploymentId,
    origin: targetUrl.replace(/\/$/u, ""),
    projectId: "prj_0123456789abcdefghijklmnop",
    targetEnvironment: "production",
    gitCommitSha: gitHead,
  };
  const workloadIdentity = {
    schemaVersion: "programmable.vercel-workload-identity.v1",
    issuer: "https://oidc.vercel.com/example",
    audience: "https://programmable-generic.example",
    subject: "owner:example:project:programmable:environment:production",
    owner: "example",
    ownerId: "team_0123456789abcdefghijklmnop",
    project: "programmable",
    projectId: deployment.projectId,
    environment: "production",
    issuedAt: "2026-08-14T12:00:00.000Z",
    notBefore: "2026-08-14T12:00:00.000Z",
    expiresAt: "2026-08-14T12:05:00.000Z",
  };
  const payload = {
    schemaVersion:
      "programmable.website-generic-launch-read-stage-probe-payload.v1",
    request,
    workloadIdentity,
    deployment,
  };
  const activationBindingHash = digest("activation");
  const readModelBindingHash = digest("read-model");
  const requestBindingHash = canonicalDigest(
    "programmable.website-generic-launch-read-stage-probe-binding.v1",
    payload,
  );
  const message = Buffer.from(canonical({
    schemaVersion: "programmable.generic-launch-read-signature-message.v2",
    activationBindingHash,
    readModelBindingHash,
    requestBindingHash,
    payload,
  }), "utf8");
  const messageSha256 = digest(message);
  const providerIdentityHash = digest("provider");
  const signerBinding = {
    schemaVersion:
      "programmable.website-generic-launch-read-stage-probe-signer.v1",
    endpoint: "https://programmable-generic.example/v1/sign",
    audience: "programmable.generic-launch-read.v2",
    keyId: "generic-v2",
    keyEpoch: "1",
    providerIdentityHash,
    publicKeyPem,
    publicKeySpkiBase64Url: publicKeySpki.toString("base64url"),
    publicKeySpkiSha256: digest(publicKeySpki),
  };
  const idempotencyKey = canonicalDigest(
    "programmable.generic-launch-read-signing-idempotency.v2",
    {
      schemaVersion:
        "programmable.generic-launch-read-signing-idempotency.v2",
      activationBindingHash,
      readModelBindingHash,
      requestBindingHash,
      messageSha256,
    },
  );
  const requestDigest = canonicalDigest("programmable.remote-signing-request.v2", {
    schemaVersion: "programmable.remote-signing-request.v2",
    audience: signerBinding.audience,
    keyId: signerBinding.keyId,
    keyEpoch: signerBinding.keyEpoch,
    algorithm: "Ed25519",
    providerIdentityHash,
    idempotencyKey,
    messageEncoding: "base64url",
    message: message.toString("base64url"),
    messageSha256,
  });
  const messageSignature = sign(null, message, privateKey).toString("base64url");
  const providerReceipt = {
    schemaVersion: "programmable.remote-signing-provider-receipt.v2",
    outcome: "completed",
    audience: signerBinding.audience,
    keyId: signerBinding.keyId,
    keyEpoch: signerBinding.keyEpoch,
    algorithm: "Ed25519",
    providerIdentityHash,
    idempotencyKey,
    messageSha256,
    requestDigest,
    signature: messageSignature,
    observedAt: "2026-08-14T12:00:01.000Z",
    expiresAt: "2026-08-14T12:05:01.000Z",
  };
  const receiptBytes = Buffer.from(canonical(providerReceipt), "utf8");
  const providerResponse = {
    schemaVersion: "programmable.remote-signing-authenticated-response.v2",
    providerReceipt,
    providerReceiptDigest: digest(receiptBytes),
    providerReceiptSignature:
      sign(null, receiptBytes, privateKey).toString("base64url"),
  };
  return {
    schemaVersion:
      "programmable.website-generic-launch-read-stage-probe-receipt.v1",
    status: "verified",
    operationId: request.operationId,
    nonceSha256: request.nonceSha256,
    sourceCommit: request.sourceCommit,
    sourceTree: request.sourceTree,
    genericImageDigest: request.genericImageDigest,
    genericBindingSha256: request.genericBindingSha256,
    genericSignRequestSha256: request.genericSignRequestSha256,
    targetMachineId: request.targetMachineId,
    deployment,
    workloadIdentity,
    signerBinding,
    activationBindingHash,
    readModelBindingHash,
    requestBindingHash,
    signedEnvelope: {
      schemaVersion: "programmable.signed-generic-launch-read-envelope.v2",
      activationBindingHash,
      readModelBindingHash,
      requestBindingHash,
      payload,
      signatureBase64Url: messageSignature,
    },
    providerResponse,
    providerResponseSha256: digest(canonical(providerResponse)),
    observedAt: providerReceipt.observedAt,
    expiresAt: providerReceipt.expiresAt,
  };
}

function canonical(value) {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function canonicalDigest(domain, value) {
  return digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.of(0),
    Buffer.from(canonical(value), "utf8"),
  ]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
