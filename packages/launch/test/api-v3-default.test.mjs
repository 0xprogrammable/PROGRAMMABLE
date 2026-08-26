import assert from "node:assert/strict";
import test from "node:test";

import { statusLaunch } from "../src/api-client.mjs";
import { main } from "../src/cli.mjs";
import {
  AGENT_ATTESTATION_SCHEMA,
  AGENT_ATTESTATION_SCHEMA_V2,
  CREATE_PATH,
  CREATE_PATH_V1,
  CREATE_PATH_V2,
  CREATE_PATH_V3,
  CREATE_REQUEST_SCHEMA,
  CREATE_REQUEST_SCHEMA_V3,
  OPENAPI_URL,
  OPENAPI_URL_V3,
  PACK_CONFIG_SCHEMA,
  PACK_CONFIG_SCHEMA_V3,
  PACKAGE_VERSION,
  DIRECT_NATIVE_PROFILE_REVISION,
  DIRECT_NATIVE_PROFILE_REVISION_V2,
  DIRECT_NATIVE_PROFILE_REVISION_V3,
  DIRECT_NATIVE_PROFILE_VERSION,
  DIRECT_NATIVE_PROFILE_VERSION_V2,
  DIRECT_NATIVE_PROFILE_VERSION_V3,
} from "../src/constants.mjs";

const REQUEST_ID = "60000000-0000-4000-8000-000000000006";

test("package 3 generic aliases select the public V3 contracts", () => {
  assert.equal(PACK_CONFIG_SCHEMA, PACK_CONFIG_SCHEMA_V3);
  assert.equal(CREATE_REQUEST_SCHEMA, CREATE_REQUEST_SCHEMA_V3);
  assert.equal(AGENT_ATTESTATION_SCHEMA, AGENT_ATTESTATION_SCHEMA_V2);
  assert.equal(CREATE_PATH, CREATE_PATH_V3);
  assert.equal(OPENAPI_URL, OPENAPI_URL_V3);
  assert.equal(PACKAGE_VERSION, "3.3.0");
  assert.equal(DIRECT_NATIVE_PROFILE_REVISION, DIRECT_NATIVE_PROFILE_REVISION_V3);
  assert.equal(DIRECT_NATIVE_PROFILE_REVISION, 3);
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION, DIRECT_NATIVE_PROFILE_VERSION_V3);
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION, "3.0.0");
  assert.equal(DIRECT_NATIVE_PROFILE_REVISION_V2, 2);
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION_V2, "2.0.0");
});

test("status defaults to V3 while explicit V1 and V2 reads remain available", async () => {
  const urls = [];
  const read = async (apiVersion) => statusLaunch({
    requestId: REQUEST_ID,
    ...(apiVersion === undefined ? {} : { apiVersion }),
    apiOrigin: "http://127.0.0.1:43198",
    maxAttempts: 1,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({
        requestId: REQUEST_ID,
        status: "received",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });

  await read(undefined);
  await read("1");
  await read("v2");

  assert.deepEqual(urls, [
    `http://127.0.0.1:43198${CREATE_PATH_V3}/${REQUEST_ID}`,
    `http://127.0.0.1:43198${CREATE_PATH_V1}/${REQUEST_ID}`,
    `http://127.0.0.1:43198${CREATE_PATH_V2}/${REQUEST_ID}`,
  ]);
});

test("CLI help identifies V3 as the default and current public release", async () => {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    await main(["status", "--help"]);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.match(output, /V3 is the default/u);
  assert.match(output, /Public V3 release/u);
  assert.doesNotMatch(output, /V2 remains the default/u);
});
