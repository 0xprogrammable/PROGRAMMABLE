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
  PERMIT_REISSUE_CAPABILITY_SCHEMA_V1,
  PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
  PERMIT_REISSUE_PATH_TEMPLATE_V3,
  PERMIT_REISSUE_REQUEST_SCHEMA_V1,
  PREFLIGHT_PATH_V3,
  PREFLIGHT_SCHEMA_V1,
} from "../src/constants.mjs";
import { sha256Digest } from "../src/io.mjs";
import { validProjectMetadataCapabilities } from "./fixtures/capabilities.mjs";

const API_KEY = "pm_live_remote_preflight_test_secret";
const API_ORIGIN = "https://api.programmable.market";
const WALLET_HANDOFF_BASE_URL = "https://programmable.market/developers/api-keys";
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
      ...validCapabilities(),
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
      fetchImpl: async (url, options) => {
        if (url.endsWith(CAPABILITIES_PATH_V3)) {
          return jsonResponse(validCapabilities());
        }
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
          ? jsonResponse(validCapabilities())
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
          ? jsonResponse(validCapabilities())
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
      walletHandoffUrl: `${WALLET_HANDOFF_BASE_URL}/${REQUEST_ID}`,
      expiresAt: "2026-08-26T23:00:00.000Z",
      secondsRemaining: 900,
    }),
    loadApiKeyImpl: async () => API_KEY,
  });
  assert.deepEqual(result.actionRequired, actionRequired);
  assert.equal(result.walletHandoffUrl, `${WALLET_HANDOFF_BASE_URL}/${REQUEST_ID}`);
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

test("authenticated commands reject every non-production API origin before loading a key", async () => {
  let keyLoads = 0;
  let networkCalls = 0;
  await assert.rejects(
    statusLaunch({
      requestId: REQUEST_ID,
      apiOrigin: "http://127.0.0.1:43210",
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("network must not be reached");
      },
      loadApiKeyImpl: async () => {
        keyLoads += 1;
        return API_KEY;
      },
    }),
    /API origin is fixed to https:\/\/api\.programmable\.market/u,
  );
  assert.equal(keyLoads, 0);
  assert.equal(networkCalls, 0);

  await assert.rejects(
    main(["status", REQUEST_ID, "--api-origin", "http://127.0.0.1:43210"]),
    /Unknown option --api-origin/u,
  );
});

test("remote validation fails closed on profile, route, and auth capability drift before loading a key", async () => {
  const cases = [
    ["profile.profileId", (value) => { value.profile.profileId = "other.profile"; }],
    ["profile.profileRevision", (value) => { value.profile.profileRevision = 4; }],
    ["profile.profileVersion", (value) => { value.profile.profileVersion = "3.3.0"; }],
    ["profile.productionLaunchAuthorized", (value) => {
      value.profile.productionLaunchAuthorized = false;
    }],
    ["routes.create", (value) => { value.routes.create = "/v2/custom-launches"; }],
    ["authentication.create", (value) => { value.authentication.create = "none"; }],
    ["authentication.capabilities", (value) => {
      value.authentication.capabilities = "bearer-api-key";
    }],
    ["authentication.requiredScopes", (value) => {
      value.authentication.requiredScopes = ["custom-launch:read"];
    }],
    ["projectMetadata.imageMayBeNull", (value) => {
      value.projectMetadata.imageMayBeNull = true;
    }],
    ["projectMetadata.requiredFields", (value) => {
      value.projectMetadata.requiredFields = value.projectMetadata.requiredFields.filter(
        (field) => field !== "presentation.links",
      );
    }],
    ["projectMetadata.profilePolicy", (value) => {
      value.projectMetadata.profilePolicy.xUriPattern = "^https://twitter.com/";
    }],
    ["permitReissue.reasonCode", (value) => {
      value.permitReissue.reasonCode = "OTHER_REASON";
    }],
  ];
  for (const [expectedField, mutate] of cases) {
    const capabilities = structuredClone(validCapabilities());
    mutate(capabilities);
    let keyLoads = 0;
    let calls = 0;
    await assert.rejects(
      validateLaunchRemote({
        launchPath: "/does/not/need/to/exist.json",
        configPath: "/does/not/need/to/exist.config.json",
        maxAttempts: 1,
        readLaunchBytesImpl: async () => CANONICAL_REQUEST_VECTOR_BYTES,
        validateLaunchFileImpl: async () => ({
          schemaVersion: CREATE_REQUEST_SCHEMA_V3,
          requestSha256: sha256Digest(CANONICAL_REQUEST_VECTOR_BYTES),
        }),
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse(capabilities);
        },
        loadApiKeyImpl: async () => {
          keyLoads += 1;
          return API_KEY;
        },
      }),
      (error) => {
        assert.ok(error instanceof ProgrammableApiError);
        assert.equal(error.details.code, "CAPABILITIES_CONTRACT_INVALID");
        assert.deepEqual(error.details.serverDetails, { field: expectedField });
        return true;
      },
    );
    assert.equal(calls, 1, expectedField);
    assert.equal(keyLoads, 0, expectedField);
  }
});

test("V3 submit rechecks capabilities before loading a key", async () => {
  const capabilities = validCapabilities();
  capabilities.routes.create = "/v2/custom-launches";
  let keyLoads = 0;
  let networkCalls = 0;
  await assert.rejects(
    submitLaunch({
      launchPath: "/does/not/need/to/exist.json",
      configPath: "/does/not/need/to/exist.config.json",
      stateDirectory: "/does/not/need/to/exist.state",
      maxAttempts: 1,
      validateLaunchFileImpl: async () => ({
        schemaVersion: CREATE_REQUEST_SCHEMA_V3,
        requestSha256: sha256Digest(CANONICAL_REQUEST_VECTOR_BYTES),
      }),
      readLaunchBytesImpl: async () => CANONICAL_REQUEST_VECTOR_BYTES,
      fetchImpl: async () => {
        networkCalls += 1;
        return jsonResponse(capabilities);
      },
      loadApiKeyImpl: async () => {
        keyLoads += 1;
        return API_KEY;
      },
    }),
    (error) => {
      assert.ok(error instanceof ProgrammableApiError);
      assert.equal(error.details.code, "CAPABILITIES_CONTRACT_INVALID");
      assert.deepEqual(error.details.serverDetails, { field: "routes.create" });
      return true;
    },
  );
  assert.equal(networkCalls, 1);
  assert.equal(keyLoads, 0);
});

function validCapabilities() {
  return {
    schemaVersion: "programmable.custom-launch-capabilities.v1",
    apiVersion: "v3",
    serverTime: "2026-08-26T18:00:00.000Z",
    readinessUrl: `${API_ORIGIN}/readyz`,
    chain: { id: "1", name: "Ethereum Mainnet" },
    profile: {
      profileId: "programmable.direct-native-hook-graph.v1",
      profileRevision: 3,
      profileVersion: "3.4.0",
      productionLaunchAuthorized: true,
    },
    routes: {
      create: "/v3/custom-launches",
      preflight: PREFLIGHT_PATH_V3,
      status: "/v3/custom-launches/{launchId}",
      list: "/v3/custom-launches",
      finalizedMetadata: "/v3/finalized-custom-launches",
      capabilities: CAPABILITIES_PATH_V3,
      permitReissue: PERMIT_REISSUE_PATH_TEMPLATE_V3,
    },
    authentication: {
      create: "bearer-api-key",
      preflight: "bearer-api-key",
      status: "bearer-api-key",
      finalizedMetadata: "none",
      capabilities: "none",
      permitReissue: "bearer-api-key",
      requiredScopes: ["custom-launch:create", "custom-launch:read"],
      apiKeyIsWallet: false,
    },
    preflight: {
      quotaConsumed: false,
      nonceAllocated: false,
      persisted: false,
      walletSignatureProduced: false,
      transactionBroadcast: false,
      exactProductionAdmissionEngine: true,
    },
    projectMetadata: validProjectMetadataCapabilities(),
    permitReissue: {
      schemaVersion: PERMIT_REISSUE_CAPABILITY_SCHEMA_V1,
      endpoint: PERMIT_REISSUE_PATH_TEMPLATE_V3,
      requestSchemaVersion: PERMIT_REISSUE_REQUEST_SCHEMA_V1,
      dispositionSchemaVersion: PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
      disposition: "unsupported",
      httpStatus: 409,
      reasonCode: "ROUTER_V1_PERMIT_NONCE_IS_CREATE2_ROUTE_NONCE",
      authenticationScope: "custom-launch:create",
      idempotencyKeyRequired: true,
      resourceBindingRequired: [
        "launchId",
        "expectedRequestHash",
        "expectedLaunchIntentHash",
      ],
      noReplacementNonceReserved: true,
      noReplacementPermitIssued: true,
      oldPermitStateRequired: "expired-and-unconsumed",
      oldPermitInvalidation: "original-signature-expired-by-signed-deadline",
      currentReleaseRecovery: "repack-and-submit-new-launch-request",
      futureContractRequirements: ["separate authorization nonce from route nonce"],
    },
    walletHandoffBaseUrl: WALLET_HANDOFF_BASE_URL,
  };
}

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
