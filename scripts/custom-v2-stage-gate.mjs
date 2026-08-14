#!/usr/bin/env node

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CUSTOM_V2_STAGE_EVIDENCE_SCHEMA_VERSION =
  "programmable.custom-v2-stage-evidence.v1";
export const CUSTOM_V2_AUTHENTICATED_INGRESS_SCHEMA_VERSION =
  "programmable.custom-v2-authenticated-ingress-evidence.v1";

const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HASH32 = /^0x[0-9a-f]{64}$/u;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/u;
const MAXIMUM_JSON_BYTES = 4 * 1024 * 1024;
const UNAUTHORIZED_APPROVAL_ID = `0x${"11".repeat(32)}`;
const DISABLED_DETAIL_HASH = `sha256:${"0".repeat(64)}`;

export async function verifyCustomV2StageCandidateV1(input) {
  const target = exactStagedTarget(input.targetUrl);
  exact(input.deploymentId, DEPLOYMENT_ID, "staged deployment ID");
  exact(input.gitHead, COMMIT, "staged Git commit");
  if (!['prelaunch', 'live'].includes(input.registryMode)) {
    throw new Error("Custom V2 Registry mode must be prelaunch or live");
  }
  if (!['disabled', 'ready'].includes(input.genericMode)) {
    throw new Error("Custom V2 Generic mode must be disabled or ready");
  }
  if (input.genericMode === "ready" && input.registryMode !== "live") {
    throw new Error("Generic V2 cannot be ready before Registry V2 is live");
  }
  if (input.detailRecordHash) {
    exact(input.detailRecordHash, DIGEST, "Generic V2 detail record hash");
  }
  const bypass = secret(input.automationBypassSecret, "Vercel automation bypass");
  const audience = safeId(input.approvalAudience, "Approval V3 audience");
  const targetBindingHash = exact(
    input.approvalTargetBindingHash,
    DIGEST,
    "Approval V3 target binding",
  );
  const fetchImpl = input.fetchImpl ?? fetch;
  const checks = [];
  const add = (id, detail) => checks.push(Object.freeze({ id, status: "pass", detail }));
  const commonHeaders = Object.freeze({
    accept: "application/json",
    "x-vercel-protection-bypass": bypass,
  });
  const requestJson = async (path, init = {}) => {
    const response = await fetchImpl(new URL(path, target), {
      redirect: "error",
      ...init,
      headers: { ...commonHeaders, ...(init.headers ?? {}) },
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAXIMUM_JSON_BYTES
      || !response.headers.get("content-type")?.toLowerCase()
        .startsWith("application/json")) {
      throw new Error(`${path} did not return bounded JSON`);
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`${path} did not return valid JSON`);
    }
    return Object.freeze({ response, body, bodyDigest: sha256(text) });
  };

  const manifestResult = await requestJson(
    "/api/custom-launch/registry/v2/manifest",
  );
  assertStatus(manifestResult, 200, "Registry V2 manifest");
  assertRegistryManifest(manifestResult.body, input.registryMode);
  add("registry-v2-manifest", `exact ${input.registryMode} Registry V2 manifest schema`);

  const registryReadiness = await requestJson(
    "/api/custom-launch/registry/v2/readiness",
  );
  if (input.registryMode === "live") {
    assertStatus(registryReadiness, 200, "Registry V2 readiness");
    assertObjectFields(registryReadiness.body, {
      schemaVersion: "programmable.custom-registry-readiness.v2",
      status: "ready",
      registryStatus: "live",
      generation: "2",
      chainId: "1",
      manifestPath: "/api/custom-launch/registry/v2/manifest",
      runtimeBindings: "verified",
      providerQuorum: "verified",
    }, "Registry V2 readiness");
    canonicalTimestamp(registryReadiness.body.checkedAt, "Registry V2 checkedAt");
    add("registry-v2-readiness", "live binding and independent RPC quorum verified");
  } else {
    assertStatus(registryReadiness, 503, "Registry V2 prelaunch readiness");
    assertObjectFields(registryReadiness.body, {
      schemaVersion: "programmable.custom-registry-readiness.v2",
      status: "unready",
      registryStatus: "prelaunch",
      code: "custom_registry_prelaunch",
    }, "Registry V2 prelaunch readiness");
    add("registry-v2-prelaunch", "prelaunch Registry fails closed");
  }

  const approvalPath = `/v2/internal/projections/approval-descriptors/${encodeURIComponent(
    `approval:${UNAUTHORIZED_APPROVAL_ID}`,
  )}`;
  const approvalHeaders = {
    "x-programmable-audience": audience,
    "x-programmable-projection-kind": "website.approval-v3",
    "x-programmable-target-binding": targetBindingHash,
  };
  for (const [method, init] of [
    ["GET", { headers: approvalHeaders }],
    ["PUT", {
      method: "PUT",
      headers: {
        ...approvalHeaders,
        "content-type": "application/json; charset=utf-8",
        "idempotency-key": `sha256:${"1".repeat(64)}`,
      },
      body: "{}",
    }],
  ]) {
    const result = await requestJson(approvalPath, init);
    assertStatus(result, 401, `unauthorized Approval V3 ${method}`);
    assertObjectFields(result.body, {
      schemaVersion: "programmable.projection-target-error.v1",
      code: "credential_required",
    }, `unauthorized Approval V3 ${method}`);
  }
  add("approval-v3-unauthorized", "unauthenticated GET and PUT are both rejected");

  for (const [method, init] of [
    ["GET", {}],
    ["POST", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvalId: UNAUTHORIZED_APPROVAL_ID }),
    }],
  ]) {
    const result = await requestJson(
      "/api/ops/custom-launch/generic-v2-projector",
      init,
    );
    assertStatus(result, 401, `unauthorized Generic V2 projector ${method}`);
    assertObjectFields(result.body, {
      schemaVersion: "programmable.generic-launch-projector-error.v2",
      status: "error",
      code: "unauthorized",
    }, `unauthorized Generic V2 projector ${method}`);
  }
  add("generic-v2-projector-unauthorized", "projector and reconciliation reject missing credentials");

  const authenticated = authenticatedIngress(input);
  let authenticatedApprovalId = null;
  if (authenticated !== null) {
    if (input.registryMode !== "live") {
      throw new Error("authenticated ingress evidence is forbidden in prelaunch mode");
    }
    authenticatedApprovalId = await deliverAuthenticatedIngress({
      authenticated,
      requestJson,
      approvalHeaders,
    });
    add("approval-v3-authenticated-delivery", "exact authenticated write was accepted and read back");

    const projectorToken = secret(
      input.projectorToken,
      "Generic V2 projector token",
    );
    const projected = await requestJson(
      "/api/ops/custom-launch/generic-v2-projector",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${projectorToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ approvalId: authenticatedApprovalId }),
      },
    );
    assertStatus(projected, 200, "authenticated Generic V2 projector");
    assertObjectFields(projected.body, {
      schemaVersion: "programmable.generic-launch-projector-result.v2",
      status: "ok",
    }, "authenticated Generic V2 projector");
    add("generic-v2-projector-delivery", "authenticated Approval V3 artifact was projected");
  }

  if (input.registryMode === "live") {
    const reconciliation = await requestJson(
      "/api/ops/custom-launch/generic-v2-projector",
      { headers: { authorization: `Bearer ${secret(input.cronSecret, "reconciliation token")}` } },
    );
    assertStatus(reconciliation, 200, "Generic V2 reconciliation");
    assertObjectFields(reconciliation.body, {
      schemaVersion: "programmable.generic-launch-reconciliation-result.v2",
      status: "ok",
      failed: 0,
    }, "Generic V2 reconciliation");
    if (!Number.isSafeInteger(reconciliation.body.scanned)
      || !Number.isSafeInteger(reconciliation.body.succeeded)) {
      throw new Error("Generic V2 reconciliation counts are invalid");
    }
    add("generic-v2-reconciliation", "database posture and reconciliation completed without failures");
  }

  const genericReadiness = await requestJson(
    "/api/custom-launch/generic/v2/readiness",
  );
  const feed = await requestJson(
    "/api/custom-launch/generic/v2/launches?limit=16",
  );
  let detailHash = input.detailRecordHash || DISABLED_DETAIL_HASH;
  let detailExpectedPresent = false;
  if (input.genericMode === "ready") {
    assertStatus(genericReadiness, 200, "Generic V2 readiness");
    assertObjectFields(genericReadiness.body, {
      schemaVersion: "programmable.generic-launch-readiness.v2",
      status: "ready",
      generation: "2",
      chainId: "1",
      feedPath: "/api/custom-launch/generic/v2/launches",
      detailPathTemplate: "/api/custom-launch/generic/v2/launches/{recordHash}",
    }, "Generic V2 readiness");
    canonicalTimestamp(genericReadiness.body.checkedAt, "Generic V2 checkedAt");
    assertStatus(feed, 200, "Generic V2 feed");
    assertObjectFields(feed.body, {
      schemaVersion: "programmable.generic-launch-feed.v2",
    }, "Generic V2 feed");
    if (!Array.isArray(feed.body.records)
      || typeof feed.body.total !== "string"
      || !/^(?:0|[1-9][0-9]{0,77})$/u.test(feed.body.total)
      || BigInt(feed.body.total) < BigInt(feed.body.records.length)
      || (feed.body.nextCursor !== null && typeof feed.body.nextCursor !== "string")) {
      throw new Error("Generic V2 feed schema is invalid");
    }
    detailHash = input.detailRecordHash || feed.body.records[0]?.recordHash;
    detailExpectedPresent = typeof detailHash === "string";
    detailHash = detailHash || DISABLED_DETAIL_HASH;
    exact(detailHash, DIGEST, "Generic V2 detail record hash");
    add("generic-v2-readiness-feed", "read store, remote signer, Registry binding, readiness, and feed verified");
  } else {
    for (const [label, result] of [
      ["Generic V2 readiness", genericReadiness],
      ["Generic V2 feed", feed],
    ]) {
      assertStatus(result, 503, label);
      assertObjectFields(result.body, {
        schemaVersion: label.endsWith("readiness")
          ? "programmable.generic-launch-readiness.v2"
          : "programmable.custom-launch-error.v1",
        ...(label.endsWith("readiness") ? { status: "unready" } : {}),
        code: "generic_launch_v2_not_active",
      }, label);
    }
    add("generic-v2-disabled", "unbound Generic V2 readiness and feed fail closed");
  }

  const detail = await requestJson(
    `/api/custom-launch/generic/v2/launches/${encodeURIComponent(detailHash)}`,
  );
  if (input.genericMode === "ready") {
    if (detailExpectedPresent) {
      assertStatus(detail, 200, "Generic V2 detail");
      assertObjectFields(detail.body, {
        schemaVersion: "programmable.generic-launch-view.v2",
      }, "Generic V2 detail");
      if (!detail.body.record || detail.body.record.recordHash !== detailHash) {
        throw new Error("Generic V2 detail record binding is invalid");
      }
      add("generic-v2-detail", "detail schema and exact record key verified");
    } else {
      assertStatus(detail, 404, "empty Generic V2 detail");
      assertObjectFields(detail.body, {
        schemaVersion: "programmable.custom-launch-error.v1",
        code: "generic_launch_v2_not_found",
      }, "empty Generic V2 detail");
      add("generic-v2-detail-empty", "empty feed detail miss uses the exact 404 schema");
    }
  } else {
    assertStatus(detail, 503, "disabled Generic V2 detail");
    assertObjectFields(detail.body, {
      schemaVersion: "programmable.custom-launch-error.v1",
      code: "generic_launch_v2_not_active",
    }, "disabled Generic V2 detail");
    add("generic-v2-detail-disabled", "unbound Generic V2 detail fails closed");
  }

  for (const path of [
    "/custom-launches",
    `/custom-launches/${encodeURIComponent(detailHash)}`,
  ]) {
    const response = await fetchImpl(new URL(path, target), {
      redirect: "error",
      headers: {
        accept: "text/html",
        "x-vercel-protection-bypass": bypass,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.text();
    if (response.status !== 200
      || !response.headers.get("content-type")?.toLowerCase().startsWith("text/html")
      || Buffer.byteLength(body, "utf8") < 100) {
      throw new Error(`${path} is not a stable HTML route`);
    }
  }
  add("custom-v2-ui-routes", "directory and detail HTML routes are stable");

  return Object.freeze({
    schemaVersion: CUSTOM_V2_STAGE_EVIDENCE_SCHEMA_VERSION,
    status: "verified-staged",
    deployment: Object.freeze({
      id: input.deploymentId,
      targetUrl: target.toString(),
      gitHead: input.gitHead,
    }),
    matrix: Object.freeze({
      registryMode: input.registryMode,
      genericMode: input.genericMode,
      authenticatedIngress: authenticated !== null,
    }),
    publicResponseDigests: Object.freeze({
      registryManifest: manifestResult.bodyDigest,
      registryReadiness: registryReadiness.bodyDigest,
      genericReadiness: genericReadiness.bodyDigest,
      feed: feed.bodyDigest,
      detail: detail.bodyDigest,
    }),
    checks: Object.freeze(checks),
  });
}

async function deliverAuthenticatedIngress(input) {
  const evidence = input.authenticated;
  const path = `/v2/internal/projections/approval-descriptors/${encodeURIComponent(
    evidence.projectionKey,
  )}`;
  const parsedBody = jsonObject(evidence.canonicalPutBody, "authenticated PUT body");
  if (parsedBody.schemaVersion !== "programmable.approval-v3-artifact-projection-write.v1"
    || parsedBody.projectionKind !== "website.approval-v3"
    || parsedBody.projectionKey !== evidence.projectionKey
    || parsedBody.idempotencyKey !== evidence.idempotencyKey
    || !HASH32.test(parsedBody.approvalId ?? "")) {
    throw new Error("authenticated Approval V3 PUT evidence is not exact");
  }
  const put = await input.requestJson(path, {
    method: "PUT",
    headers: {
      ...input.approvalHeaders,
      authorization: `Bearer ${secret(evidence.putBearerToken, "Approval V3 PUT credential")}`,
      "content-type": "application/json; charset=utf-8",
      "idempotency-key": exact(evidence.idempotencyKey, DIGEST, "Approval V3 idempotency key"),
    },
    body: evidence.canonicalPutBody,
  });
  if (put.response.status !== 200 && put.response.status !== 201) {
    throw new Error(`authenticated Approval V3 PUT returned ${put.response.status}`);
  }
  assertObjectFields(put.body, {
    schemaVersion: "programmable.approval-v3-artifact-projection-write-ack.v1",
    projectionKey: evidence.projectionKey,
    approvalId: parsedBody.approvalId,
    idempotencyKey: evidence.idempotencyKey,
    requestDigest: parsedBody.requestDigest,
  }, "authenticated Approval V3 PUT acknowledgement");
  const get = await input.requestJson(path, {
    headers: {
      ...input.approvalHeaders,
      authorization: `Bearer ${secret(evidence.getBearerToken, "Approval V3 GET credential")}`,
    },
  });
  assertStatus(get, 200, "authenticated Approval V3 readback");
  assertObjectFields(get.body, {
    schemaVersion: "programmable.approval-v3-artifact-projection-readback.v1",
    projectionKey: evidence.projectionKey,
    approvalId: parsedBody.approvalId,
    idempotencyKey: evidence.idempotencyKey,
    requestDigest: parsedBody.requestDigest,
  }, "authenticated Approval V3 readback");
  return parsedBody.approvalId;
}

function authenticatedIngress(input) {
  const expectedDigest = input.authenticatedIngressEvidenceSha256?.trim() ?? "";
  const source = input.authenticatedIngressEvidenceJson?.trim() ?? "";
  if (expectedDigest === "" && source === "") return null;
  exact(expectedDigest, DIGEST, "authenticated ingress evidence SHA-256");
  if (sha256(source) !== expectedDigest) {
    throw new Error("authenticated ingress evidence SHA-256 does not match");
  }
  const value = jsonObject(source, "authenticated ingress evidence");
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "canonicalPutBody",
    "getBearerToken",
    "idempotencyKey",
    "projectionKey",
    "putBearerToken",
    "schemaVersion",
  ].sort();
  if (keys.join("\n") !== expectedKeys.join("\n")
    || value.schemaVersion !== CUSTOM_V2_AUTHENTICATED_INGRESS_SCHEMA_VERSION
    || typeof value.projectionKey !== "string"
    || !value.projectionKey.startsWith("approval:")
    || typeof value.canonicalPutBody !== "string") {
    throw new Error("authenticated ingress evidence contract is invalid");
  }
  return value;
}

function assertRegistryManifest(value, expectedMode) {
  assertObjectFields(value, {
    schemaVersion: "programmable.custom-registry-public-manifest.v2",
    status: expectedMode,
    generation: "2",
    chainId: "1",
    caip2: "eip155:1",
    publicReadEnabled: expectedMode === "live",
    indexingEnabled: expectedMode === "live",
  }, "Registry V2 manifest");
  if (expectedMode === "prelaunch") {
    for (const group of [value.registry, value.release, value.finality]) {
      if (!group || Object.values(group).some((entry) => entry !== null)) {
        throw new Error("prelaunch Registry V2 manifest is not closed");
      }
    }
    return;
  }
  exact(value.registry?.address, ADDRESS, "Registry V2 address");
  exact(value.registry?.runtimeCodeKeccak256, HASH32, "Registry V2 runtime hash");
  exact(value.registry?.deploymentTransactionHash, HASH32, "Registry V2 transaction");
  exact(value.registry?.deploymentBlockHash, HASH32, "Registry V2 block hash");
  exact(value.registry?.deploymentBlock, POSITIVE_DECIMAL, "Registry V2 block");
  exact(value.release?.sourceCommit, COMMIT, "Registry V2 source commit");
  exact(value.release?.sourceTree, COMMIT, "Registry V2 source tree");
  for (const field of ["sourceArtifactSha256", "abiArtifactSha256", "eventSetSha256"]) {
    exact(value.release?.[field], DIGEST, `Registry V2 ${field}`);
  }
  exact(value.finality?.minimumConfirmations, POSITIVE_DECIMAL, "Registry V2 finality");
  exact(value.finality?.policyBindingHash, HASH32, "Registry V2 policy binding");
}

function assertStatus(result, expected, label) {
  if (result.response.status !== expected) {
    throw new Error(`${label} returned ${result.response.status}, expected ${expected}`);
  }
}

function assertObjectFields(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      throw new Error(`${label} field ${key} is invalid`);
    }
  }
}

function exactStagedTarget(value) {
  const target = new URL(value);
  if (target.protocol !== "https:" || target.username !== ""
    || target.password !== "" || target.pathname !== "/"
    || target.search !== "" || target.hash !== ""
    || !target.hostname.endsWith(".vercel.app")) {
    throw new Error("Custom V2 stage target must be an exact unaliased Vercel origin");
  }
  return target;
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
    throw new Error(`${label} is unavailable or invalid`);
  }
  return value;
}

function safeId(value, label) {
  if (typeof value !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function canonicalTimestamp(value, label) {
  const parsed = new Date(value);
  if (typeof value !== "string" || !Number.isFinite(parsed.getTime())
    || parsed.toISOString() !== value) throw new Error(`${label} is invalid`);
}

function jsonObject(source, label) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${label} is not JSON`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function argumentsFrom(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!/^--[a-z][a-z-]*$/u.test(flag ?? "") || value === undefined
      || value.startsWith("--") || parsed.has(flag)) {
      throw new Error("Custom V2 stage gate arguments are invalid");
    }
    parsed.set(flag, value);
  }
  return Object.fromEntries([...parsed].map(([key, value]) => [key.slice(2), value]));
}

async function main() {
  const args = argumentsFrom(process.argv.slice(2));
  for (const required of [
    "target-url", "deployment-id", "git-head", "registry-mode",
    "generic-mode", "evidence-output",
  ]) {
    if (!args[required]) throw new Error(`--${required} is required`);
  }
  const evidence = await verifyCustomV2StageCandidateV1({
    targetUrl: args["target-url"],
    deploymentId: args["deployment-id"],
    gitHead: args["git-head"],
    registryMode: args["registry-mode"],
    genericMode: args["generic-mode"],
    detailRecordHash: args["detail-record-hash"] ?? "",
    authenticatedIngressEvidenceSha256:
      args["authenticated-ingress-evidence-sha256"] ?? "",
    authenticatedIngressEvidenceJson:
      process.env.PROGRAMMABLE_CUSTOM_V2_STAGE_AUTHENTICATED_EVIDENCE_V1_JSON,
    approvalAudience: process.env.PROGRAMMABLE_WEBSITE_APPROVAL_V3_AUDIENCE,
    approvalTargetBindingHash:
      process.env.PROGRAMMABLE_WEBSITE_APPROVAL_V3_TARGET_BINDING_HASH,
    automationBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    projectorToken: process.env.PROGRAMMABLE_GENERIC_LAUNCH_PROJECTOR_TOKEN,
    cronSecret: process.env.CRON_SECRET,
  });
  writeFileSync(
    args["evidence-output"],
    `${JSON.stringify(evidence, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify({
    status: evidence.status,
    deploymentId: evidence.deployment.id,
    gitHead: evidence.deployment.gitHead,
    registryMode: evidence.matrix.registryMode,
    genericMode: evidence.matrix.genericMode,
    authenticatedIngress: evidence.matrix.authenticatedIngress,
    evidenceSha256: sha256(`${JSON.stringify(evidence, null, 2)}\n`),
  })}\n`);
}

if (process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error
      ? error.message : "Custom V2 stage gate failed"}\n`);
    process.exitCode = 1;
  });
}
