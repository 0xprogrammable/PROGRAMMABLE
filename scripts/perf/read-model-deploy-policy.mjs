#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { runtimeProductionProviderBindingsFromUrls } from "./read-model-provider-binding.mjs";

export const RELEASE_GATED_FLAG_NAMES = Object.freeze([
  "INDEXED_EXPLORE_LIST_READS_ENABLED",
  "INDEXED_EXPLORE_TOKEN_READS_ENABLED",
  "INDEXED_EXPLORE_CHART_READS_ENABLED",
  "INDEXED_CREATOR_PROFILE_READS_ENABLED",
  "INDEXED_CLASSIC_V3_PROFILE_READS_ENABLED",
  "INDEXED_LAUNCH_LOOKUP_ENABLED",
  "INDEXED_PUBLIC_INDEXER_FEED_READS_ENABLED",
  "INDEXED_READ_SHADOW_COMPARE_ENABLED",
]);
const PUBLIC_INDEXED_ROUTE_FLAG_NAMES = Object.freeze(
  RELEASE_GATED_FLAG_NAMES.filter(
    (name) => name !== "INDEXED_READ_SHADOW_COMPARE_ENABLED",
  ),
);

export const WORKER_ACTIVATION_FLAG_NAMES = Object.freeze([
  "PROGRAMMABLE_PROJECTOR_ACTIVE",
  "PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE",
]);

export const REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES = Object.freeze([
  "PROGRAMMABLE_ENVIO_GRAPHQL_URL",
  "PROGRAMMABLE_PROJECTOR_BINDING_MODE",
  "PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY",
  "PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT",
  "PROGRAMMABLE_SOURCE_PROJECTOR_VERSION",
  "PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL",
  "PROGRAMMABLE_UNISWAP_GRAPH_REDACTED_IDENTITY",
  "PROGRAMMABLE_UNISWAP_GRAPH_DEPLOYMENT_COMMITMENT",
  "PROGRAMMABLE_UNISWAP_GRAPH_SCHEMA_COMMITMENT",
]);

const CANONICAL_PRODUCTION_ORIGIN = "https://programmable.family";
const EXPECTED_SOURCE_PROJECTOR_VERSION = "projector-v1";
const EXPECTED_PROJECTOR_BINDING_MODE = "release";
const EXPECTED_PROJECTOR_ENVIO_MIRROR_COMMIT =
  "7ffd15c2a28c481a2d3632e30b315262c2471b2e";
const EXPECTED_UNISWAP_GRAPH_BASE_URL = "https://gateway.thegraph.com";
const EXPECTED_UNISWAP_GRAPH_REDACTED_IDENTITY = "uniswap-v4-official";
const EXPECTED_UNISWAP_GRAPH_DEPLOYMENT_COMMITMENT =
  "0x44c8d7127503563653f7f53ea339caa383453e00224a6c33cf95fc29f5c3e35c";
const EXPECTED_UNISWAP_GRAPH_SCHEMA_COMMITMENT =
  "0xd0d2087059ca0a7c1e7c633999ff75ea34fcc00d42cee8985a79d0ef76e6813c";

const COMMITMENT_NAMES = Object.freeze([
  "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_ENDPOINT_COMMITMENT",
  "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_ENDPOINT_COMMITMENT",
]);
const HEX_BYTES32 = /^0x[0-9a-f]{64}$/u;
const RUNTIME_RPC_URL_NAMES = Object.freeze([
  "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
  "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
  "ETHEREUM_RPC_URL",
  "ETHEREUM_RPC_URL_B",
]);
const VERCEL_SENSITIVE_PLACEHOLDER = /^\[[A-Za-z]{1,32}\]$/u;

function decodeDotenvValue(value, name) {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  if (/^[^\s#]*$/u.test(trimmed)) return trimmed;
  throw new Error(`${name} has an unsupported dotenv encoding`);
}

function readSelectedDotenvValues(contents, selectedNames) {
  const values = new Map();
  for (const [index, line] of contents.split(/\r?\n/u).entries()) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    const [, name, rawValue] = match;
    if (!selectedNames.includes(name)) continue;
    if (values.has(name)) {
      throw new Error(`${name} is duplicated at line ${index + 1}`);
    }
    values.set(name, decodeDotenvValue(rawValue, name));
  }
  return Object.fromEntries(selectedNames.map((name) => [name, values.get(name)]));
}

export function readReleaseGatedFlags(contents) {
  return readSelectedDotenvValues(contents, RELEASE_GATED_FLAG_NAMES);
}

function normalizedFlags(raw, names, missingIsFalse) {
  const values = {};
  const invalidNames = [];
  for (const name of names) {
    const value = raw[name];
    if ((value === undefined || value === "") && missingIsFalse) {
      values[name] = false;
    } else if (value === "true" || value === "false") {
      values[name] = value === "true";
    } else {
      values[name] = value !== "false";
      invalidNames.push(name);
    }
  }
  return Object.freeze({
    values: Object.freeze(values),
    invalidNames: Object.freeze(invalidNames),
  });
}

function parseReleaseExpectations(rootDirectory) {
  const manifestPath = resolve(
    rootDirectory,
    "config/data-pipeline-release.v1.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const deploymentLabel = manifest?.envio?.deploymentLabel;
  const graphqlEndpoint = manifest?.envio?.graphqlEndpoint;
  if (
    typeof deploymentLabel !== "string" ||
    !/^[a-z0-9][a-z0-9._-]{0,95}$/u.test(deploymentLabel) ||
    typeof graphqlEndpoint !== "string" ||
    !/^https:\/\/indexer\.hyperindex\.xyz\/[a-z0-9]{7}\/(?:v1)\/graphql$/u.test(
      graphqlEndpoint,
    )
  ) {
    throw new Error("data-pipeline release has an invalid Envio binding");
  }
  return Object.freeze({
    PROGRAMMABLE_ENVIO_GRAPHQL_URL: graphqlEndpoint,
    PROGRAMMABLE_PROJECTOR_BINDING_MODE: EXPECTED_PROJECTOR_BINDING_MODE,
    PROGRAMMABLE_PROJECTOR_ENVIO_REDACTED_IDENTITY: `envio:${deploymentLabel}`,
    PROGRAMMABLE_PROJECTOR_ENVIO_MIRROR_COMMIT:
      EXPECTED_PROJECTOR_ENVIO_MIRROR_COMMIT,
    PROGRAMMABLE_SOURCE_PROJECTOR_VERSION:
      EXPECTED_SOURCE_PROJECTOR_VERSION,
    PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL:
      EXPECTED_UNISWAP_GRAPH_BASE_URL,
    PROGRAMMABLE_UNISWAP_GRAPH_REDACTED_IDENTITY:
      EXPECTED_UNISWAP_GRAPH_REDACTED_IDENTITY,
    PROGRAMMABLE_UNISWAP_GRAPH_DEPLOYMENT_COMMITMENT:
      EXPECTED_UNISWAP_GRAPH_DEPLOYMENT_COMMITMENT,
    PROGRAMMABLE_UNISWAP_GRAPH_SCHEMA_COMMITMENT:
      EXPECTED_UNISWAP_GRAPH_SCHEMA_COMMITMENT,
  });
}

export function readReleasePolicyExpectations(
  rootDirectory = process.cwd(),
) {
  return parseReleaseExpectations(rootDirectory);
}

function validateNonSecretRuntimeEnvironment(contents, expectations) {
  if (!expectations) {
    return Object.freeze({ ready: true, invalidNames: Object.freeze([]) });
  }
  const configured = readSelectedDotenvValues(
    contents,
    REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES,
  );
  const invalidNames = REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES.filter(
    (name) =>
      typeof configured[name] !== "string" ||
      configured[name] === "" ||
      configured[name] !== expectations[name],
  );
  return Object.freeze({
    ready: invalidNames.length === 0,
    invalidNames: Object.freeze(invalidNames),
  });
}

export function evaluateReadModelDeployPolicy(
  contents,
  environment = {},
  expectations,
) {
  const indexedFlags = normalizedFlags(
    readReleaseGatedFlags(contents),
    RELEASE_GATED_FLAG_NAMES,
    false,
  );
  const workerFlags = normalizedFlags(
    readSelectedDotenvValues(contents, WORKER_ACTIVATION_FLAG_NAMES),
    WORKER_ACTIVATION_FLAG_NAMES,
    true,
  );
  const nonLegacyFlags = [
    ...RELEASE_GATED_FLAG_NAMES.filter((name) => indexedFlags.values[name]),
    ...WORKER_ACTIVATION_FLAG_NAMES.filter((name) => workerFlags.values[name]),
  ];
  const invalidFlagNames = Object.freeze([
    ...indexedFlags.invalidNames,
    ...workerFlags.invalidNames,
  ]);
  const environmentPreflight = validateNonSecretRuntimeEnvironment(
    contents,
    expectations,
  );
  const evidenceRequired = nonLegacyFlags.length > 0;
  const invalidCommitments = evidenceRequired
    ? COMMITMENT_NAMES.filter(
        (name) => !HEX_BYTES32.test(environment[name] ?? ""),
      )
    : [];
  let runtimeCommitmentsMatch = !evidenceRequired;
  let runtimeProviderBinding = evidenceRequired ? "unverified" : "not-required";
  if (evidenceRequired && invalidCommitments.length === 0) {
    try {
      const runtimeEnvironment = readSelectedDotenvValues(
        contents,
        RUNTIME_RPC_URL_NAMES,
      );
      const configuredRuntimeValues = Object.values(runtimeEnvironment).filter(
        (value) => value !== undefined && value !== "",
      );
      const sensitiveValuesDeferred =
        configuredRuntimeValues.length >= 2 &&
        configuredRuntimeValues.every((value) =>
          VERCEL_SENSITIVE_PLACEHOLDER.test(value),
        );
      if (sensitiveValuesDeferred) {
        // Vercel deliberately replaces Sensitive environment values during
        // `vercel pull`. The staged runtime capture recomputes both endpoint
        // commitments from the real URLs and the release gate compares them
        // with the pinned GitHub environment variables before promotion.
        runtimeCommitmentsMatch = true;
        runtimeProviderBinding = "deferred-stage";
      } else {
        const runtimeBindings = runtimeProductionProviderBindingsFromUrls(
          runtimeEnvironment,
        );
        runtimeCommitmentsMatch = runtimeBindings.every(
          (binding) =>
            binding.endpointCommitment ===
            environment[
              binding.vendorGroup === "alchemy"
                ? COMMITMENT_NAMES[0]
                : COMMITMENT_NAMES[1]
            ],
        );
        runtimeProviderBinding = runtimeCommitmentsMatch
          ? "verified"
          : "unverified";
      }
    } catch {
      runtimeCommitmentsMatch = false;
      runtimeProviderBinding = "unverified";
    }
  }
  return Object.freeze({
    mode: evidenceRequired ? "indexed-or-shadow" : "legacy-only",
    evidenceRequired,
    nonLegacyFlags,
    indexedFlags: indexedFlags.values,
    workerActivationFlags: workerFlags.values,
    policyReady:
      invalidFlagNames.length === 0 && environmentPreflight.ready,
    invalidFlagNames,
    invalidNonSecretEnvironmentNames: environmentPreflight.invalidNames,
    commitmentsReady:
      invalidCommitments.length === 0 && runtimeCommitmentsMatch,
    runtimeProviderBinding,
    invalidCommitmentNames:
      invalidCommitments.length > 0
        ? invalidCommitments
        : runtimeCommitmentsMatch
          ? []
          : ["runtime-provider-commitment-mismatch"],
  });
}

function exactHttpsOrigin(value, subject) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error(`${subject} must be an exact HTTPS origin`);
  }
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.pathname !== "/" ||
    target.search !== "" ||
    target.hash !== ""
  ) {
    throw new Error(`${subject} must be an exact HTTPS origin`);
  }
  return target;
}

export function canonicalJson(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error("release attestation contains a non-canonical value");
}

function exactObjectKeys(value, keys, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")
  ) {
    throw new Error(`${label} shape is invalid`);
  }
  return value;
}

function exactBooleanRecord(value, keys, label) {
  const record = exactObjectKeys(value, keys, label);
  if (keys.some((key) => typeof record[key] !== "boolean")) {
    throw new Error(`${label} values are invalid`);
  }
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, record[key]])));
}

export function validateStagedReleaseAttestation(value, expectations = {}) {
  const attestation = exactObjectKeys(
    value,
    [
      "schemaVersion",
      "verifiedSha",
      "vercelProjectId",
      "stagedDeploymentId",
      "stagedDeploymentUrl",
      "productionOrigin",
      "policyMode",
      "indexedFlags",
      "workerActivationFlags",
      "timestamp",
    ],
    "staged release attestation",
  );
  if (
    attestation.schemaVersion !== 1 ||
    !/^[0-9a-f]{40}$/u.test(attestation.verifiedSha ?? "") ||
    !/^prj_[A-Za-z0-9]{8,80}$/u.test(attestation.vercelProjectId ?? "") ||
    !/^dpl_[A-Za-z0-9]{20,80}$/u.test(attestation.stagedDeploymentId ?? "")
  ) {
    throw new Error("staged release attestation identity is invalid");
  }
  const stagedTarget = exactHttpsOrigin(
    attestation.stagedDeploymentUrl,
    "staged release attestation URL",
  );
  if (!stagedTarget.hostname.endsWith(".vercel.app")) {
    throw new Error("staged release attestation URL is not deployment-specific");
  }
  if (
    attestation.productionOrigin !== CANONICAL_PRODUCTION_ORIGIN ||
    exactHttpsOrigin(attestation.productionOrigin, "production origin").origin !==
      CANONICAL_PRODUCTION_ORIGIN
  ) {
    throw new Error("staged release attestation production origin is invalid");
  }
  const indexedFlags = exactBooleanRecord(
    attestation.indexedFlags,
    RELEASE_GATED_FLAG_NAMES,
    "staged release indexed flags",
  );
  const workerActivationFlags = exactBooleanRecord(
    attestation.workerActivationFlags,
    WORKER_ACTIVATION_FLAG_NAMES,
    "staged release worker flags",
  );
  const nonLegacy =
    Object.values(indexedFlags).some(Boolean) ||
    Object.values(workerActivationFlags).some(Boolean);
  const expectedMode = nonLegacy ? "indexed-or-shadow" : "legacy-only";
  if (attestation.policyMode !== expectedMode) {
    throw new Error("staged release attestation mode is invalid");
  }
  const timestampMs = Date.parse(attestation.timestamp ?? "");
  const nowMs = expectations.nowMs ?? Date.now();
  const maximumAgeMs = expectations.maximumAgeMs ?? 2 * 60 * 60 * 1_000;
  if (
    !Number.isFinite(timestampMs) ||
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(maximumAgeMs) ||
    maximumAgeMs < 1_000 ||
    maximumAgeMs > 24 * 60 * 60 * 1_000 ||
    timestampMs > nowMs + 60_000 ||
    nowMs - timestampMs > maximumAgeMs
  ) {
    throw new Error("staged release attestation timestamp is invalid");
  }
  const exactExpectations = [
    ["verifiedSha", attestation.verifiedSha],
    ["vercelProjectId", attestation.vercelProjectId],
    ["stagedDeploymentId", attestation.stagedDeploymentId],
    ["stagedDeploymentUrl", stagedTarget.origin],
    ["productionOrigin", attestation.productionOrigin],
  ];
  for (const [key, observed] of exactExpectations) {
    if (expectations[key] !== undefined && expectations[key] !== observed) {
      throw new Error(`staged release attestation ${key} does not match`);
    }
  }
  if (
    expectations.requireWorkersActive === true &&
    Object.values(workerActivationFlags).some((active) => active !== true)
  ) {
    throw new Error("staged release attestation workers are not active");
  }
  if (
    expectations.requireIndexedFlagsFalse === true &&
    Object.values(indexedFlags).some(Boolean)
  ) {
    throw new Error("staged release attestation exposes indexed reads");
  }
  if (
    expectations.requireIndexedRoutesActive === true &&
    (PUBLIC_INDEXED_ROUTE_FLAG_NAMES.some((name) => indexedFlags[name] !== true) ||
      indexedFlags.INDEXED_READ_SHADOW_COMPARE_ENABLED !== false)
  ) {
    throw new Error("staged release attestation does not activate exact indexed routes");
  }
  return Object.freeze({
    ...attestation,
    stagedDeploymentUrl: stagedTarget.origin,
    indexedFlags,
    workerActivationFlags,
  });
}

export function createStagedReleaseAttestation(input) {
  if (!input.policy?.policyReady || !input.policy?.commitmentsReady) {
    throw new Error("release policy must pass before attestation");
  }
  if (!/^[0-9a-f]{40}$/u.test(input.verifiedSha ?? "")) {
    throw new Error("verified SHA must be an exact Git commit");
  }
  if (!/^prj_[A-Za-z0-9]{8,80}$/u.test(input.vercelProjectId ?? "")) {
    throw new Error("Vercel project ID is invalid");
  }
  if (!/^dpl_[A-Za-z0-9]{20,80}$/u.test(input.stagedDeploymentId ?? "")) {
    throw new Error("staged deployment ID is invalid");
  }
  const stagedTarget = exactHttpsOrigin(
    input.stagedDeploymentUrl,
    "staged deployment URL",
  );
  if (!stagedTarget.hostname.endsWith(".vercel.app")) {
    throw new Error("staged deployment URL must use a deployment-specific Vercel host");
  }
  const productionTarget = exactHttpsOrigin(
    input.productionOrigin,
    "production origin",
  );
  if (
    productionTarget.origin !== CANONICAL_PRODUCTION_ORIGIN ||
    input.productionOrigin !== CANONICAL_PRODUCTION_ORIGIN
  ) {
    throw new Error("production origin is not the canonical Programmable domain");
  }
  if (
    input.expectedMode !== undefined &&
    input.expectedMode !== input.policy.mode
  ) {
    throw new Error("staged runtime mode differs from the preflight policy");
  }
  const timestamp = new Date(input.timestamp ?? Date.now());
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("release attestation timestamp is invalid");
  }
  const attestation = Object.freeze({
    schemaVersion: 1,
    verifiedSha: input.verifiedSha,
    vercelProjectId: input.vercelProjectId,
    stagedDeploymentId: input.stagedDeploymentId,
    stagedDeploymentUrl: stagedTarget.origin,
    productionOrigin: CANONICAL_PRODUCTION_ORIGIN,
    policyMode: input.policy.mode,
    indexedFlags: input.policy.indexedFlags,
    workerActivationFlags: input.policy.workerActivationFlags,
    timestamp: timestamp.toISOString(),
  });
  const json = canonicalJson(attestation);
  return Object.freeze({
    attestation,
    json,
    sha256: createHash("sha256").update(json, "utf8").digest("hex"),
  });
}

function argumentsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("arguments must be --name value pairs");
    }
    result[name.slice(2)] = value;
  }
  if (!result["env-file"]) throw new Error("--env-file is required");
  return result;
}

function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const expectations = readReleasePolicyExpectations(process.cwd());
  const result = evaluateReadModelDeployPolicy(
    readFileSync(resolve(args["env-file"]), "utf8"),
    process.env,
    expectations,
  );
  if (!result.policyReady) {
    throw new Error(
      [
        ...result.invalidFlagNames,
        ...result.invalidNonSecretEnvironmentNames,
      ].length > 0
        ? `release environment preflight failed: ${[
            ...result.invalidFlagNames,
            ...result.invalidNonSecretEnvironmentNames,
          ].join(", ")}`
        : "release environment preflight failed",
    );
  }
  if (!result.commitmentsReady) {
    throw new Error(
      `indexed/shadow release requires pinned commitments: ${result.invalidCommitmentNames.join(", ")}`,
    );
  }
  let attestation;
  if (args["attestation-output"]) {
    const requiredAttestationArguments = [
      "verified-sha",
      "vercel-project-id",
      "staged-deployment-id",
      "staged-target-url",
      "production-origin",
      "expected-mode",
    ];
    const missing = requiredAttestationArguments.filter((name) => !args[name]);
    if (missing.length > 0) {
      throw new Error(`release attestation arguments missing: ${missing.join(", ")}`);
    }
    attestation = createStagedReleaseAttestation({
      policy: result,
      verifiedSha: args["verified-sha"],
      vercelProjectId: args["vercel-project-id"],
      stagedDeploymentId: args["staged-deployment-id"],
      stagedDeploymentUrl: args["staged-target-url"],
      productionOrigin: args["production-origin"],
      expectedMode: args["expected-mode"],
    });
    writeFileSync(resolve(args["attestation-output"]), attestation.json, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
  }
  if (args["github-output"]) {
    appendFileSync(
      resolve(args["github-output"]),
      [
        `mode=${result.mode}`,
        `evidence_required=${result.evidenceRequired}`,
        ...(attestation
          ? [
              `attestation_path=${resolve(args["attestation-output"])}`,
              `attestation_sha256=${attestation.sha256}`,
            ]
          : []),
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      mode: result.mode,
      evidenceRequired: result.evidenceRequired,
      exactFalseFlags:
        RELEASE_GATED_FLAG_NAMES.filter(
          (name) => result.indexedFlags[name] === false,
        ).length,
      gatedFlags: result.nonLegacyFlags,
      workerActivationFlags: result.workerActivationFlags,
      policyReady: result.policyReady,
      commitmentsReady: result.commitmentsReady,
      runtimeProviderBinding: result.runtimeProviderBinding,
      ...(attestation
        ? { attestationSha256: attestation.sha256 }
        : {}),
    })}\n`,
  );
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "deploy policy failed"}\n`,
    );
    process.exitCode = 1;
  }
}
