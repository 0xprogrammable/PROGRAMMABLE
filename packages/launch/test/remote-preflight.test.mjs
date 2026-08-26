import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ProgrammableApiError,
  statusLaunch,
  submitLaunch,
  validateLaunchRemote,
} from "../src/api-client.mjs";
import { formatCliError, main } from "../src/cli.mjs";
import {
  CAPABILITIES_PATH_V3,
  CREATE_REQUEST_SCHEMA_V3,
  PREFLIGHT_PATH_V3,
  PREFLIGHT_SCHEMA_V1,
} from "../src/constants.mjs";
import { sha256Digest } from "../src/io.mjs";

const API_KEY = "pm_live_remote_preflight_test_secret";
const API_ORIGIN = "http://127.0.0.1:43210";
const REQUEST_ID = "8ad84ddb-9453-4264-87fe-bb18a9f80bf0";
const CANONICAL_REQUEST_VECTOR_BYTES = Buffer.from(
  "{\n  \"z\":\"last\",\n  \"schemaVersion\":\"programmable.custom-launch-create-request.v3\",\n  \"a\":{\"value\":1}\n}\n",
  "utf8",
);
const CANONICAL_REQUEST_VECTOR_HASH =
  "sha256:7c0a12cdec841fa5c256d0f9887382166b6dcfef6002ccee955120f5f16690d8";

test("remote validate discovers public capabilities then runs authenticated side-effect-free preflight", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-remote-preflight-"));
  try {
    const launchPath = path.join(root, "launch.json");
    const requestBytes = CANONICAL_REQUEST_VECTOR_BYTES;
    await writeFile(launchPath, requestBytes);
    const requestSha256 = sha256Digest(requestBytes);
    assert.notEqual(requestSha256, CANONICAL_REQUEST_VECTOR_HASH);
    const calls = [];
    const capabilities = {
      schemaVersion: "programmable.custom-launch-capabilities.v1",
      routes: {
        preflight: { method: "POST", path: PREFLIGHT_PATH_V3 },
      },
      walletHandoffBaseUrl: `${API_ORIGIN}/wallet/`,
      futureAdditiveCapability: { preserved: true },
    };
    const preflight = validPreflight(CANONICAL_REQUEST_VECTOR_HASH, {
      disposition: "needs_evidence",
      needsEvidenceFindingCodes: ["CUSTOM_EVIDENCE_UNPROVEN"],
      remediations: [remediation()],
      futureAdditiveResult: { preserved: true },
    });
    const result = await validateLaunchRemote({
      launchPath,
      configPath: path.join(root, "programmable-launch.config.json"),
      apiOrigin: API_ORIGIN,
      maxAttempts: 1,
      validateLaunchFileImpl: async () => ({
        schemaVersion: CREATE_REQUEST_SCHEMA_V3,
        requestSha256,
        byteLength: requestBytes.byteLength,
        reproducedFromConfig: true,
        exactSourceIncluded: true,
      }),
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (calls.length === 1) {
          return jsonResponse(capabilities);
        }
        return jsonResponse(preflight);
      },
      loadApiKeyImpl: async () => API_KEY,
    });

    assert.equal(calls[0].url, `${API_ORIGIN}${CAPABILITIES_PATH_V3}`);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(Object.hasOwn(calls[0].options.headers, "authorization"), false);
    assert.equal(calls[0].options.body, undefined);
    assert.equal(calls[1].url, `${API_ORIGIN}${PREFLIGHT_PATH_V3}`);
    assert.equal(calls[1].options.method, "POST");
    assert.equal(calls[1].options.headers.authorization, `Bearer ${API_KEY}`);
    assert.deepEqual(Buffer.from(calls[1].options.body), requestBytes);

    assert.equal(result.remoteValidation, true);
    assert.equal(result.requestSha256, requestSha256);
    assert.equal(result.preflight.requestHash, CANONICAL_REQUEST_VECTOR_HASH);
    assert.equal(result.reproducedFromConfig, true);
    assert.equal(result.disposition, "needs_evidence");
    assert.equal(result.capabilities.futureAdditiveCapability.preserved, true);
    assert.equal(result.preflight.futureAdditiveResult.preserved, true);
    assert.equal(result.preflight.quotaConsumed, false);
    assert.equal(result.preflight.nonceAllocated, false);
    assert.equal(result.preflight.persisted, false);
    assert.equal(result.preflight.walletBroadcastByService, false);
    assert.ok(!JSON.stringify(result).includes(API_KEY));

    let submitBody;
    await submitLaunch({
      launchPath,
      configPath: path.join(root, "programmable-launch.config.json"),
      idempotencyKey: "preflight-submit-byte-parity-0001",
      stateDirectory: path.join(root, "state"),
      apiOrigin: API_ORIGIN,
      maxAttempts: 1,
      validateLaunchFileImpl: async () => ({
        schemaVersion: CREATE_REQUEST_SCHEMA_V3,
        requestSha256,
      }),
      fetchImpl: async (_url, options) => {
        submitBody = Buffer.from(options.body);
        return jsonResponse({
          schemaVersion: "programmable.custom-launch.v3",
          requestId: REQUEST_ID,
          launchId: REQUEST_ID,
          status: "received",
        }, 202);
      },
      loadApiKeyImpl: async () => API_KEY,
    });
    assert.deepEqual(submitBody, Buffer.from(calls[1].options.body));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("remote validate rejects a response that contradicts the no-side-effects contract", async () => {
  const requestBytes = CANONICAL_REQUEST_VECTOR_BYTES;
  let calls = 0;
  await assert.rejects(
    validateLaunchRemote({
      launchPath: "/does/not/need/to/exist.json",
      configPath: "/does/not/need/to/exist.config.json",
      apiOrigin: API_ORIGIN,
      maxAttempts: 1,
      readLaunchBytesImpl: async () => requestBytes,
      validateLaunchFileImpl: async () => ({
        schemaVersion: CREATE_REQUEST_SCHEMA_V3,
        requestSha256: sha256Digest(requestBytes),
      }),
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ walletHandoffBaseUrl: `${API_ORIGIN}/wallet/` })
          : jsonResponse(validPreflight(CANONICAL_REQUEST_VECTOR_HASH, { quotaConsumed: true }));
      },
      loadApiKeyImpl: async () => API_KEY,
    }),
    (error) => {
      assert.ok(error instanceof ProgrammableApiError);
      assert.equal(error.details.code, "PREFLIGHT_CONTRACT_INVALID");
      assert.deepEqual(error.details.serverDetails, { field: "quotaConsumed" });
      return true;
    },
  );
});

test("remote validate rejects the raw launch-file digest as the server requestHash", async () => {
  const rawRequestSha256 = sha256Digest(CANONICAL_REQUEST_VECTOR_BYTES);
  assert.notEqual(rawRequestSha256, CANONICAL_REQUEST_VECTOR_HASH);
  let calls = 0;
  await assert.rejects(
    validateLaunchRemote({
      launchPath: "/does/not/need/to/exist.json",
      configPath: "/does/not/need/to/exist.config.json",
      apiOrigin: API_ORIGIN,
      maxAttempts: 1,
      readLaunchBytesImpl: async () => CANONICAL_REQUEST_VECTOR_BYTES,
      validateLaunchFileImpl: async () => ({
        schemaVersion: CREATE_REQUEST_SCHEMA_V3,
        requestSha256: rawRequestSha256,
      }),
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ walletHandoffBaseUrl: `${API_ORIGIN}/wallet/` })
          : jsonResponse(validPreflight(rawRequestSha256));
      },
      loadApiKeyImpl: async () => API_KEY,
    }),
    (error) => {
      assert.ok(error instanceof ProgrammableApiError);
      assert.equal(error.details.code, "PREFLIGHT_CONTRACT_INVALID");
      assert.deepEqual(error.details.serverDetails, { field: "requestHash" });
      return true;
    },
  );
});

test("API errors preserve server details and typed remediation without rendering secret echoes", async () => {
  const secretEcho = "pm_live_do_not_render_this_echo";
  const typed = remediation();
  let caught;
  try {
    await statusLaunch({
      requestId: REQUEST_ID,
      apiOrigin: API_ORIGIN,
      maxAttempts: 1,
      fetchImpl: async () => jsonResponse({
        error: {
          code: "SOURCE_TARGET_ANALYSIS_INCOMPLETE",
          requestId: REQUEST_ID,
          details: {
            field: "staticBaseline",
            requestBody: secretEcho,
            remediations: [typed],
          },
        },
      }, 422),
      loadApiKeyImpl: async () => API_KEY,
    });
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof ProgrammableApiError);
  assert.equal(caught.details.serverDetails.requestBody, secretEcho);
  assert.deepEqual(caught.details.remediations, [typed]);
  const rendered = formatCliError(caught);
  assert.match(rendered, /SOURCE_TARGET_ANALYSIS_INCOMPLETE/u);
  assert.match(rendered, /requiredChange/u);
  assert.match(rendered, /staticBaseline/u);
  assert.ok(!rendered.includes(secretEcho));
  assert.ok(!rendered.includes("requestBody"));
});

test("status promotes the safe wallet handoff, expiry and action without signing", async () => {
  const actionRequired = { kind: "send-router-transaction", message: "Review in the wallet handoff." };
  const result = await statusLaunch({
    requestId: REQUEST_ID,
    apiOrigin: API_ORIGIN,
    maxAttempts: 1,
    fetchImpl: async () => jsonResponse({
      requestId: REQUEST_ID,
      status: "authorized",
      actionRequired,
      walletHandoffUrl: `${API_ORIGIN}/wallet/${REQUEST_ID}`,
      expiresAt: "2026-08-26T23:00:00.000Z",
      secondsRemaining: 900,
    }),
    loadApiKeyImpl: async () => API_KEY,
  });
  assert.deepEqual(result.actionRequired, actionRequired);
  assert.equal(result.walletHandoffUrl, `${API_ORIGIN}/wallet/${REQUEST_ID}`);
  assert.equal(result.expiresAt, "2026-08-26T23:00:00.000Z");
  assert.equal(result.secondsRemaining, 900);
  assert.equal(result.walletHandoffReady, true);
});

test("validate help keeps four commands and documents remote preflight boundaries", async () => {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    await main(["validate", "--help"]);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.match(output, /validate <launch\.json>.*--remote/u);
  assert.match(output, /quota-free V3 preflight/u);
  assert.match(output, /never allocates a nonce, persists a launch, signs, or broadcasts/u);
});

function validPreflight(requestHash, overrides = {}) {
  return {
    schemaVersion: PREFLIGHT_SCHEMA_V1,
    requestHash,
    profileRevision: 3,
    serverTime: "2026-08-26T18:00:00.000Z",
    disposition: "supported",
    launchEligibility: {
      deployable: true,
      routable: true,
      featured: false,
    },
    evidenceTier: "source-and-artifacts",
    hardBlockFindingCodes: [],
    needsEvidenceFindingCodes: [],
    warningFindingCodes: [],
    staticBaseline: null,
    remediations: [],
    quotaConsumed: false,
    nonceAllocated: false,
    persisted: false,
    walletSignatureRequiredLater: true,
    walletBroadcastByService: false,
    ...overrides,
  };
}

function remediation() {
  return {
    schemaVersion: "programmable.custom-launch-remediation.v1",
    remediationId: "PLATFORM_ADMISSION_FINDING",
    code: "CUSTOM_EVIDENCE_UNPROVEN",
    stage: "admission",
    targetId: "hook",
    targetRole: "hook",
    sourcePath: "src/Hook.sol",
    expected: "Role-aware evidence for the enabled callback.",
    observed: "Evidence is incomplete.",
    requiredChange: "Add the exact bounded evidence and rerun remote validation.",
    catalogUrl: "https://programmable.market/policies/custom-launch-agent-remediation-v1.json",
    guideUrl: "https://programmable.market/docs/developers/custom-launch#existing-project-integration",
    retryable: false,
    requiresNewRequest: false,
    resumeAt: "validate",
  };
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}
