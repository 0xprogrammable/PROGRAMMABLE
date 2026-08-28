import assert from "node:assert/strict";
import test from "node:test";

import {
  ProgrammableApiError,
  requestPermitReissueDisposition,
  statusLaunch,
} from "../src/api-client.mjs";
import {
  API_ORIGIN,
  PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
  PERMIT_REISSUE_REQUEST_SCHEMA_V1,
} from "../src/constants.mjs";
import { loadApiKey } from "../src/io.mjs";

const LAUNCH_ID = "8ad84ddb-9453-4264-87fe-bb18a9f80bf0";
const WALLET_API_KEY = `pm_live_${"w".repeat(64)}`;
const PARTNER_SUBKEY = `pm_partner_${"a".repeat(22)}_${"b".repeat(43)}`;
const PARTNER_ROOT_KEY = `pm_partner_root_${"c".repeat(22)}_${"d".repeat(43)}`;

test("the ordinary PROGRAMMABLE_API_KEY channel accepts bounded partner root and subkeys", async () => {
  const original = process.env.PROGRAMMABLE_API_KEY;
  try {
    for (const apiKey of [PARTNER_ROOT_KEY, PARTNER_SUBKEY]) {
      process.env.PROGRAMMABLE_API_KEY = apiKey;
      assert.equal(await loadApiKey(), apiKey);
    }
    process.env.PROGRAMMABLE_API_KEY = `pm_partner_${"a".repeat(21)}_${"b".repeat(43)}`;
    await assert.rejects(loadApiKey(), /invalid shape/u);
  } finally {
    if (original === undefined) delete process.env.PROGRAMMABLE_API_KEY;
    else process.env.PROGRAMMABLE_API_KEY = original;
  }
});

test("partner credentials reject wallet-only permit reissue inspection before network I/O", async () => {
  for (const apiKey of [PARTNER_ROOT_KEY, PARTNER_SUBKEY]) {
    let calls = 0;
    await assert.rejects(
      requestPermitReissueDisposition({
        launchId: LAUNCH_ID,
        expectedRequestHash: `sha256:${"1".repeat(64)}`,
        expectedLaunchIntentHash: `sha256:${"2".repeat(64)}`,
        replacementNonce: `0x${"3".repeat(64)}`,
        replacementPermitWindow: { validAfter: "100", deadline: "3700" },
        idempotencyKey: "permit-recovery-check-0001",
        maxAttempts: 1,
        loadApiKeyImpl: async () => apiKey,
        fetchImpl: async () => {
          calls += 1;
          throw new Error("network must not be called");
        },
      }),
      (error) => {
        assert.ok(error instanceof ProgrammableApiError);
        assert.equal(error.details.code, "PERMIT_REISSUE_WALLET_KEY_REQUIRED");
        assert.equal(error.details.expectedCredentialKind, "wallet");
        return true;
      },
    );
    assert.equal(calls, 0);
  }
});

test("wallet-key permit reissue inspection posts the exact resource binding and preserves typed 409 guidance", async () => {
  let observed;
  const serverDetails = {
    schemaVersion: PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
    reason: "ROUTER_V1_PERMIT_NONCE_IS_CREATE2_ROUTE_NONCE",
    currentReleaseRecovery: {
      action: "repack-and-submit-new-launch-request",
      freshNonceRequired: true,
      newIdempotencyKeyRequired: true,
      predictedAddressesMayChange: true,
    },
  };
  await assert.rejects(
    requestPermitReissueDisposition({
      launchId: LAUNCH_ID,
      expectedRequestHash: `sha256:${"1".repeat(64)}`,
      expectedLaunchIntentHash: `sha256:${"2".repeat(64)}`,
      replacementNonce: `0x${"3".repeat(64)}`,
      replacementPermitWindow: { validAfter: "100", deadline: "3700" },
      idempotencyKey: "permit-recovery-check-0001",
      apiOrigin: API_ORIGIN,
      maxAttempts: 1,
      loadApiKeyImpl: async () => WALLET_API_KEY,
      fetchImpl: async (url, options) => {
        observed = { url, options };
        return jsonResponse({
          schemaVersion: "programmable.api-error.v1",
          error: {
            code: "PERMIT_REISSUE_UNSUPPORTED",
            requestId: LAUNCH_ID,
            details: serverDetails,
          },
        }, 409);
      },
    }),
    (error) => {
      assert.ok(error instanceof ProgrammableApiError);
      assert.equal(error.details.code, "PERMIT_REISSUE_UNSUPPORTED");
      assert.deepEqual(error.details.serverDetails, serverDetails);
      return true;
    },
  );

  assert.equal(
    observed.url,
    `${API_ORIGIN}/v3/custom-launches/${LAUNCH_ID}/permit-reissues`,
  );
  assert.equal(observed.options.method, "POST");
  assert.equal(observed.options.headers.authorization, `Bearer ${WALLET_API_KEY}`);
  assert.equal(observed.options.headers["idempotency-key"], "permit-recovery-check-0001");
  assert.deepEqual(JSON.parse(Buffer.from(observed.options.body).toString("utf8")), {
    schemaVersion: PERMIT_REISSUE_REQUEST_SCHEMA_V1,
    expectedRequestHash: `sha256:${"1".repeat(64)}`,
    expectedLaunchIntentHash: `sha256:${"2".repeat(64)}`,
    replacementNonce: `0x${"3".repeat(64)}`,
    replacementPermitWindow: { validAfter: "100", deadline: "3700" },
  });
  assert.ok(!JSON.stringify(observed.options.body).includes(WALLET_API_KEY));
});

test("permit reissue inspection rejects an impossible Router V1 success response", async () => {
  await assert.rejects(
    requestPermitReissueDisposition({
      launchId: LAUNCH_ID,
      expectedRequestHash: `sha256:${"1".repeat(64)}`,
      expectedLaunchIntentHash: `sha256:${"2".repeat(64)}`,
      replacementNonce: `0x${"3".repeat(64)}`,
      replacementPermitWindow: { validAfter: "100", deadline: "200" },
      idempotencyKey: "permit-recovery-check-0002",
      loadApiKeyImpl: async () => WALLET_API_KEY,
      maxAttempts: 1,
      fetchImpl: async () => jsonResponse({ disposition: "created" }, 200),
    }),
    (error) => {
      assert.ok(error instanceof ProgrammableApiError);
      assert.equal(error.details.code, "PERMIT_REISSUE_CONTRACT_INVALID");
      return true;
    },
  );
});

test("failed expired partner status recommends a fresh pack without advertising the wallet-only endpoint", async () => {
  const result = await statusLaunch({
    requestId: LAUNCH_ID,
    apiOrigin: API_ORIGIN,
    maxAttempts: 1,
    loadApiKeyImpl: async () => PARTNER_SUBKEY,
    fetchImpl: async () => jsonResponse({
      requestId: LAUNCH_ID,
      launchId: LAUNCH_ID,
      status: "failed",
      failure: { code: "PERMIT_EXPIRED" },
      onchainLaunchId: null,
    }),
  });

  assert.deepEqual(result.permitRecovery, {
    action: "repack-and-submit-new-launch-request",
    requiresFreshNonce: true,
    requiresNewIdempotencyKey: true,
    predictedAddressesMayChange: true,
    automaticReissue: false,
    permitReissueEndpoint: null,
  });
});

test("failed expired wallet status retains the typed disposition endpoint", async () => {
  const result = await statusLaunch({
    requestId: LAUNCH_ID,
    apiOrigin: API_ORIGIN,
    maxAttempts: 1,
    loadApiKeyImpl: async () => WALLET_API_KEY,
    fetchImpl: async () => jsonResponse({
      requestId: LAUNCH_ID,
      launchId: LAUNCH_ID,
      status: "failed",
      failure: { code: "PERMIT_EXPIRED" },
      onchainLaunchId: null,
    }),
  });

  assert.deepEqual(result.permitRecovery, {
    action: "repack-and-submit-new-launch-request",
    requiresFreshNonce: true,
    requiresNewIdempotencyKey: true,
    predictedAddressesMayChange: true,
    automaticReissue: false,
    permitReissueEndpoint: `/v3/custom-launches/${LAUNCH_ID}/permit-reissues`,
  });
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
