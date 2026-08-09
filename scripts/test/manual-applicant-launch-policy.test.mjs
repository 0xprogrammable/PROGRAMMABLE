import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { keccak256, toBytes } from "viem";

import {
  bindVercelSensitiveProductionMetadata,
} from "../bind-vercel-sensitive-production-metadata.mjs";
import {
  assertManualApplicantServerEnvironment,
  readManualApplicantLaunchFlag,
  resolveManualApplicantLaunchPolicy,
} from "../resolve-manual-applicant-launch-policy.mjs";
import { verifyManualApplicantStagedRuntime } from
  "../verify-manual-applicant-staged-runtime.mjs";

const ALCHEMY_URL = "https://eth-mainnet.g.alchemy.com/v2/key";
const QUICKNODE_URL = "https://example.quiknode.pro/key";
const VERCEL_PROJECT_ID = "prj_12345678";
const ENDPOINT_DOMAIN = "programmable:data-pipeline:rpc-endpoint:v1\0";
const endpointCommitments = Object.freeze({
  alchemy: keccak256(toBytes(`${ENDPOINT_DOMAIN}${ALCHEMY_URL}`)),
  quickNode: keccak256(toBytes(`${ENDPOINT_DOMAIN}${QUICKNODE_URL}`)),
});
const SENSITIVE_NAMES = Object.freeze([
  "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
  "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
  "PRIVY_APP_SECRET",
  "OPS_BLOB_READ_WRITE_TOKEN",
  "CRON_SECRET",
]);

const enabledEnvironment = [
  "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=true",
  `PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL=${ALCHEMY_URL}`,
  `PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL=${QUICKNODE_URL}`,
  "NEXT_PUBLIC_PRIVY_APP_ID=privy-app",
  "PRIVY_APP_SECRET=privy-secret",
  "OPS_BLOB_READ_WRITE_TOKEN=blob-token",
  `CRON_SECRET=${"c".repeat(32)}`,
  "",
].join("\n");

const pulledSensitiveEnvironment = sensitivePulledEnvironment();
const policyEvidence = Object.freeze({
  endpointCommitments,
  expectedVercelProjectId: VERCEL_PROJECT_ID,
  sensitiveMetadataSource: JSON.stringify(boundSensitiveMetadata()),
});

test("manual Applicant flag is default-off and exact", () => {
  assert.equal(readManualApplicantLaunchFlag(""), false);
  assert.equal(readManualApplicantLaunchFlag(
    "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=true\n",
  ), true);
  assert.throws(() => readManualApplicantLaunchFlag(
    "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=${ENABLE}\n",
  ));
  assert.throws(() => readManualApplicantLaunchFlag([
    "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=true",
    "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=true",
  ].join("\n")));
});

test("manual Applicant policy requires dispatch, Vercel and protected mode parity", () => {
  const source = pulledSensitiveEnvironment;
  assert.deepEqual(resolveManualApplicantLaunchPolicy({
    requested: true,
    productionEnvSource: source,
    protectedMode: "enabled",
    ...policyEvidence,
  }), { enabled: true });
  assert.throws(() => resolveManualApplicantLaunchPolicy({
    requested: false,
    productionEnvSource: source,
    protectedMode: "enabled",
    ...policyEvidence,
  }), /dispatch request/u);
  assert.throws(() => resolveManualApplicantLaunchPolicy({
    requested: true,
    productionEnvSource: source,
    protectedMode: "disabled",
    ...policyEvidence,
  }), /protected mode/u);
  assert.deepEqual(resolveManualApplicantLaunchPolicy({
    requested: false,
    productionEnvSource:
      "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED=false\n",
    protectedMode: "disabled",
  }), { enabled: false });
});

test("enabled policy binds only the strict server environment contract", () => {
  assert.deepEqual(
    Object.keys(assertManualApplicantServerEnvironment(
      pulledSensitiveEnvironment,
      policyEvidence,
    )).sort(),
    [
      "CRON_SECRET",
      "NEXT_PUBLIC_PRIVY_APP_ID",
      "OPS_BLOB_READ_WRITE_TOKEN",
      "PRIVY_APP_SECRET",
      "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
      "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
    ].sort(),
  );
  assert.throws(() => assertManualApplicantServerEnvironment(
    pulledSensitiveEnvironment.replace(/^NEXT_PUBLIC_PRIVY_APP_ID=.*\n/mu, ""),
    policyEvidence,
  ), /NEXT_PUBLIC_PRIVY_APP_ID/u);
  assert.throws(() => assertManualApplicantServerEnvironment(
    pulledSensitiveEnvironment.replace(/^PRIVY_APP_SECRET=.*\n/mu, ""),
    policyEvidence,
  ), /must occur exactly once/u);
  for (const name of SENSITIVE_NAMES) {
    assert.throws(() => assertManualApplicantServerEnvironment(
      replaceEnvironmentValue(pulledSensitiveEnvironment, name, "readable"),
      policyEvidence,
    ), /custody was downgraded/u);
  }
});

test("sensitive production metadata is project-bound and value-free", () => {
  const raw = rawSensitiveMetadata();
  const bound = bindVercelSensitiveProductionMetadata({
    metadata: raw,
    vercelProjectId: VERCEL_PROJECT_ID,
  });
  assert.equal(bound.vercelProjectId, VERCEL_PROJECT_ID);
  assert.equal(bound.target, "production");
  assert.equal(bound.envs.length, 5);
  assert.throws(() => bindVercelSensitiveProductionMetadata({
    metadata: { envs: [{ key: "CRON_SECRET", value: null }] },
    vercelProjectId: VERCEL_PROJECT_ID,
  }), /must not contain values/u);
  assert.throws(() => bindVercelSensitiveProductionMetadata({
    metadata: { envs: [{ key: "CRON_SECRET", value: "must-not-exist" }] },
    vercelProjectId: VERCEL_PROJECT_ID,
  }), /must not contain values/u);
  assert.throws(() => bindVercelSensitiveProductionMetadata({
    metadata: raw,
    vercelProjectId: "wrong-project",
  }), /project ID/u);
});

test("enabled policy accepts only exact sensitive production placeholders", () => {
  const productionEnvSource = pulledSensitiveEnvironment;
  const metadata = boundSensitiveMetadata();
  const evidence = {
    endpointCommitments,
    expectedVercelProjectId: VERCEL_PROJECT_ID,
    sensitiveMetadataSource: JSON.stringify(metadata),
  };
  assert.deepEqual(resolveManualApplicantLaunchPolicy({
    requested: true,
    productionEnvSource,
    protectedMode: "enabled",
    ...evidence,
  }), { enabled: true });

  for (const name of SENSITIVE_NAMES) {
    const index = metadata.envs.findIndex((entry) => entry.key === name);
    const missing = clone(metadata);
    missing.envs.splice(index, 1);
    assertMetadataRejected(productionEnvSource, evidence, missing, /exact sensitive/u);

    const duplicate = clone(metadata);
    duplicate.envs.push(clone(duplicate.envs[index]));
    assertMetadataRejected(productionEnvSource, evidence, duplicate, /exact sensitive/u);

    for (const mutation of [
      (entry) => { entry.target = ["preview"]; },
      (entry) => { entry.target = ["production", "preview"]; },
      (entry) => { entry.type = "encrypted"; },
      (entry) => { entry.value = null; },
      (entry) => { entry.value = "must-not-exist"; },
    ]) {
      const changed = clone(metadata);
      mutation(changed.envs[index]);
      assertMetadataRejected(
        productionEnvSource,
        evidence,
        changed,
        /exact sensitive/u,
      );
    }
  }

  assert.throws(() => assertManualApplicantServerEnvironment(
    productionEnvSource,
    {
      endpointCommitments,
      expectedVercelProjectId: VERCEL_PROJECT_ID,
    },
  ), /metadata is invalid/u);
  assert.throws(() => assertManualApplicantServerEnvironment(
    productionEnvSource,
    {
      ...evidence,
      expectedVercelProjectId: "prj_other1234",
    },
  ), /metadata is invalid/u);
});

test("enabled policy requires exact independent protected commitments", () => {
  assert.throws(() => assertManualApplicantServerEnvironment(
    pulledSensitiveEnvironment,
    {
      ...policyEvidence,
      endpointCommitments: {
        ...endpointCommitments,
        alchemy: "invalid",
      },
    },
  ), /Alchemy endpoint commitment is invalid/u);
  assert.throws(() => assertManualApplicantServerEnvironment(
    pulledSensitiveEnvironment,
    {
      ...policyEvidence,
      endpointCommitments: {
        alchemy: endpointCommitments.alchemy,
        quickNode: endpointCommitments.alchemy,
      },
    },
  ), /not independent/u);
  assert.throws(() => assertManualApplicantServerEnvironment(
    pulledSensitiveEnvironment,
    {
      ...policyEvidence,
      endpointCommitments: { alchemy: endpointCommitments.alchemy },
    },
  ), /QuickNode endpoint commitment is invalid/u);
});

test("staged runtime preflight accepts only the typed client error", async () => {
  let request;
  const result = await verifyManualApplicantStagedRuntime({
    targetUrl: "https://candidate.example.vercel.app/",
    bypassSecret: "b".repeat(32),
    attempts: 1,
    retryDelayMs: 0,
    async fetchImpl(url, init) {
      request = { url: String(url), init };
      return new Response(JSON.stringify({
        schemaVersion: "programmable.manual-router-website-error.v1",
        code: "invalid_request",
        message: "invalid_request",
        retryable: false,
      }), {
        status: 400,
        headers: {
          "cache-control": "no-store, max-age=0",
          "content-type": "application/json; charset=utf-8",
        },
      });
    },
  });
  assert.deepEqual(result, {
    status: "verified",
    route: "/api/custom-launch/manual/submissions",
    httpStatus: 400,
    code: "invalid_request",
  });
  assert.equal(request.url,
    "https://candidate.example.vercel.app/api/custom-launch/manual/submissions");
  assert.equal(request.init.body, "{}");
  assert.equal(new Headers(request.init.headers).has("authorization"), false);

  await assert.rejects(() => verifyManualApplicantStagedRuntime({
    targetUrl: "https://candidate.example.vercel.app/",
    bypassSecret: "b".repeat(32),
    attempts: 1,
    retryDelayMs: 0,
    async fetchImpl() {
      return new Response(JSON.stringify({
        schemaVersion: "programmable.manual-router-website-error.v1",
        code: "storage_unavailable",
        message: "storage_unavailable",
        retryable: true,
      }), {
        status: 503,
        headers: {
          "cache-control": "no-store, max-age=0",
          "content-type": "application/json; charset=utf-8",
        },
      });
    },
  }), /preflight failed/u);
});

test("production workflow keeps manual Applicant policy independent of legacy Custom", async () => {
  const workflow = await readFile(
    new URL("../../.github/workflows/deploy-production.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /manual_applicant_launch_enablement:/u);
  assert.match(workflow, /Resolve manual Applicant launch policy/u);
  assert.match(workflow, /PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_MODE/u);
  assert.match(workflow, /resolve-manual-applicant-launch-policy\.mjs/u);
  assert.match(workflow, /bind-vercel-sensitive-production-metadata\.mjs/u);
  assert.match(workflow, /--manual-sensitive-metadata/u);
  assert.match(workflow, /--alchemy-endpoint-commitment/u);
  assert.match(workflow, /--quicknode-endpoint-commitment/u);
  assert.match(workflow, /verify-manual-applicant-staged-runtime\.mjs/u);
  assert.ok(
    workflow.indexOf("Capture sensitive production environment metadata")
      < workflow.indexOf("Resolve manual Applicant launch policy"),
  );
  assert.equal(
    (workflow.match(/--env PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT=/gu)
      ?? []).length,
    1,
  );
  assert.equal(
    (workflow.match(/--env PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT=/gu)
      ?? []).length,
    1,
  );
});

function replaceEnvironmentValue(source, name, value) {
  return source.replace(
    new RegExp(`^${name}=.*$`, "mu"),
    `${name}=${value}`,
  );
}

function rawSensitiveMetadata() {
  return {
    envs: [
      "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
      "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
      "PRIVY_APP_SECRET",
      "OPS_BLOB_READ_WRITE_TOKEN",
      "CRON_SECRET",
    ].map((key) => ({ key, type: "sensitive", target: ["production"] })),
  };
}

function boundSensitiveMetadata() {
  return bindVercelSensitiveProductionMetadata({
    metadata: rawSensitiveMetadata(),
    vercelProjectId: VERCEL_PROJECT_ID,
  });
}

function sensitivePulledEnvironment() {
  return [
    "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
    "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
    "PRIVY_APP_SECRET",
    "OPS_BLOB_READ_WRITE_TOKEN",
    "CRON_SECRET",
  ].reduce(
    (source, name) => replaceEnvironmentValue(source, name, '""'),
    enabledEnvironment,
  );
}

function assertMetadataRejected(productionEnvSource, evidence, metadata, match) {
  assert.throws(() => assertManualApplicantServerEnvironment(
    productionEnvSource,
    {
      ...evidence,
      sensitiveMetadataSource: JSON.stringify(metadata),
    },
  ), match);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
