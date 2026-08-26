#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;

function canonicalize(value) {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("unsupported canonical JSON value");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has an unexpected shape`);
  }
}

function headers(bypass, authorization) {
  const result = { accept: "application/json" };
  if (bypass) {
    result["x-vercel-protection-bypass"] = bypass;
    result["x-vercel-set-bypass-cookie"] = "false";
  }
  if (authorization) result.authorization = `Bearer ${authorization}`;
  return result;
}

async function fetchBytes(url, options, fetchImpl) {
  const response = await fetchImpl(url, {
    ...options,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAX_JSON_BYTES) {
    throw new Error(`${url.pathname} returned an invalid response size`);
  }
  return { response, bytes };
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`${label} did not return UTF-8 JSON`, { cause: error });
  }
}

export async function probeCustomLaunchV3Release(input) {
  if (typeof input.apiKey !== "string" || input.apiKey.length < 1) {
    throw new Error("V3 canary API credential is unavailable");
  }
  if (!COMMIT.test(input.expectedWebsiteCommitSha ?? "")) {
    throw new Error("expected Website commit is invalid");
  }
  const observation = input.apiReleaseObservation;
  if (!SHA256.test(observation?.api?.readinessIdentitySha256 ?? "")) {
    throw new Error("API release observation is invalid");
  }
  if (observation.websiteCandidateCommitSha !== input.expectedWebsiteCommitSha) {
    throw new Error("staged Website commit differs from the API release binding");
  }
  if (typeof input.websiteDeploymentId !== "string" || input.websiteDeploymentId.length < 1) {
    throw new Error("staged Website deployment ID is invalid");
  }
  const websiteOrigin = new URL(input.websiteUrl);
  const apiOrigin = new URL(observation.fly.origin);
  const fetchImpl = input.fetchImpl ?? fetch;
  const websiteHeaders = headers(input.vercelBypassSecret);
  const [openApiResult, manifestResult, readinessResult] = await Promise.all([
    fetchBytes(new URL("/openapi/custom-launch-v3.json", websiteOrigin), {
      method: "GET", headers: websiteHeaders,
    }, fetchImpl),
    fetchBytes(new URL("/.well-known/programmable.json", websiteOrigin), {
      method: "GET", headers: websiteHeaders,
    }, fetchImpl),
    fetchBytes(new URL("/readyz", apiOrigin), {
      method: "GET", headers: headers(),
    }, fetchImpl),
  ]);
  if (openApiResult.response.status !== 200) throw new Error("staged V3 OpenAPI is unavailable");
  const openApiSha256 = sha256(openApiResult.bytes);
  if (openApiSha256 !== observation.website.publicOpenApiSha256) {
    throw new Error("staged V3 OpenAPI bytes differ from the release binding");
  }
  const openApi = parseJson(openApiResult.bytes, "staged V3 OpenAPI");
  if (
    openApi?.info?.version !== "3.0.0"
    || openApi?.["x-programmable-profile"]?.profileId
      !== "programmable.direct-native-hook-graph.v1"
    || openApi?.["x-programmable-profile"]?.productionLaunchAuthorized !== true
    || openApi?.["x-programmable-availability"]?.status !== "live"
    || openApi?.["x-programmable-availability"]?.publicAuthorized !== true
    || openApi?.paths?.["/v3/custom-launches"] === undefined
  ) throw new Error("staged V3 OpenAPI contract is not the enabled profile contract");

  if (manifestResult.response.status !== 200) throw new Error("staged discovery manifest is unavailable");
  const manifest = parseJson(manifestResult.bytes, "staged discovery manifest");
  const serializedManifest = JSON.stringify(manifest);
  if (
    manifest?.customLaunchApi?.versions?.v3?.status !== "live"
    || manifest?.customLaunchApi?.versions?.v3?.publicAuthorization !== true
    || manifest?.customLaunchApi?.legacyIntake?.registry !== "closed"
    || manifest?.customLaunchApi?.legacyIntake?.github !== "closed"
    || serializedManifest.includes("CUSTOM_LAUNCH_V3_INTEGRATION_PENDING")
    || serializedManifest.includes("integration-pending")
  ) throw new Error("staged discovery does not advertise an enabled V3 API with legacy intake closed");

  if (
    readinessResult.response.status !== 200
    || readinessResult.response.headers.get("cache-control")?.toLowerCase()
      !== "no-store"
  ) throw new Error("Custom Launch API readiness is unavailable or cacheable");
  const readiness = parseJson(readinessResult.bytes, "Custom Launch API readiness");
  exactKeys(readiness, [
    "schemaVersion", "status", "service", "sourceCommit", "sourceTree",
    "migrationInventorySha256", "apiContractSha256", "publicProfile", "chain",
  ], "Custom Launch API readiness");
  exactKeys(readiness.publicProfile, [
    "profileId", "profileVersion", "profileSha256", "productionLaunchAuthorized",
  ], "Custom Launch API public profile readiness");
  exactKeys(readiness.chain, [
    "chainId", "router", "routerRuntimeCodeHash", "graphFactory",
    "graphFactoryRuntimeCodeHash", "poolManager", "poolManagerRuntimeCodeHash",
    "permitAuthority", "permitAuthorityRuntimeCodeHash",
  ], "Custom Launch API chain readiness");
  const readinessIdentitySha256 = sha256(Buffer.from(canonicalize(readiness), "utf8"));
  if (
    readiness.schemaVersion !== "programmable.custom-launch-api-readiness.v2"
    || readiness.status !== "ready"
    || readiness.service !== "custom-launch-api-v1"
    || readiness.sourceCommit !== observation.backendCandidateCommitSha
    || readiness.sourceTree !== observation.backendCandidateTreeSha
    || readiness.migrationInventorySha256
      !== observation.database.migrationInventorySha256
    || readiness.apiContractSha256 !== observation.api.apiContractSha256
    || readiness.publicProfile.profileId !== observation.api.profileId
    || readiness.publicProfile.profileVersion !== observation.api.profileVersion
    || readiness.publicProfile.profileSha256 !== observation.api.publicProfileSha256
    || readiness.publicProfile.productionLaunchAuthorized !== true
    || canonicalize(readiness.chain) !== canonicalize(observation.chain)
    || readinessIdentitySha256 !== observation.api.readinessIdentitySha256
  ) throw new Error("Custom Launch API readiness differs from the exact release binding");

  const listResult = await fetchBytes(new URL("/v3/custom-launches?limit=1", apiOrigin), {
    method: "GET",
    headers: headers(undefined, input.apiKey),
  }, fetchImpl);
  const list = parseJson(listResult.bytes, "Custom Launch API V3 list");
  if (
    listResult.response.status !== 200
    || list?.schemaVersion !== "programmable.custom-launch-list.v3"
    || !Array.isArray(list.items)
  ) throw new Error("authenticated V3 list canary failed");

  return Object.freeze({
    schemaVersion: "programmable.custom-launch-v3-stage-evidence.v1",
    status: "passed",
    website: Object.freeze({
      deploymentId: input.websiteDeploymentId,
      immutableUrl: websiteOrigin.origin,
      commitSha: input.expectedWebsiteCommitSha,
      openApiSha256,
      discoveryStatus: "v3-live",
      legacyIntake: "closed",
    }),
    api: Object.freeze({
      origin: apiOrigin.origin,
      sourceCommit: readiness.sourceCommit,
      sourceTree: readiness.sourceTree,
      readinessIdentitySha256,
      listStatus: listResult.response.status,
      listSchemaVersion: list.schemaVersion,
    }),
    safety: Object.freeze({
      requestMethod: "GET",
      walletSignatureObserved: false,
      transactionBroadcastObserved: false,
      apiCredentialRecorded: false,
    }),
    observedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, "Z"),
  });
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("invalid command arguments");
    result[key.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = value;
  }
  return result;
}

async function main(argv) {
  const args = parseArguments(argv);
  const observation = JSON.parse(await readFile(args.apiReleaseSummary, "utf8"));
  const evidence = await probeCustomLaunchV3Release({
    websiteUrl: args.websiteUrl,
    websiteDeploymentId: args.websiteDeploymentId,
    expectedWebsiteCommitSha: args.expectedWebsiteCommit,
    apiReleaseObservation: observation,
    apiKey: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_V3_CANARY_API_KEY,
    vercelBypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
  });
  await writeFile(args.output, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: "wx", mode: 0o600, encoding: "utf8",
  });
  process.stdout.write("CUSTOM_LAUNCH_V3_STAGE_VALID\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
