#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA,
  isExactSafeVercelEnvironmentMetadataEntry,
} from "../bind-vercel-sensitive-production-metadata.mjs";

export const RESET_POLICY_MODE = "index-reset";

export const RELEASE_GATED_FLAG_NAMES = Object.freeze([
  "INDEXED_EXPLORE_LIST_READS_ENABLED",
  "INDEXED_EXPLORE_TOKEN_READS_ENABLED",
  "INDEXED_EXPLORE_CHART_READS_ENABLED",
  "INDEXED_CREATOR_PROFILE_READS_ENABLED",
  "INDEXED_READ_SHADOW_COMPARE_ENABLED",
]);

export const WORKER_ACTIVATION_FLAG_NAMES = Object.freeze([
  "PROGRAMMABLE_PROJECTOR_ACTIVE",
  "PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE",
]);

// The Explore index is intentionally reset. No provider credential or provider
// binding is part of this release policy.
export const REQUIRED_SERVER_SECRET_ENV_NAMES = Object.freeze([]);
export const REQUIRED_NON_SECRET_RUNTIME_ENV_NAMES = Object.freeze([]);

const CANONICAL_PRODUCTION_ORIGIN = "https://programmable.market";

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

function exactBooleanFlags(raw, names, { missingIsFalse }) {
  const values = {};
  const invalidNames = [];
  for (const name of names) {
    const value = raw[name];
    if ((value === undefined || value === "") && missingIsFalse) {
      values[name] = false;
      continue;
    }
    if (value === "true" || value === "false") {
      values[name] = value === "true";
      continue;
    }
    values[name] = false;
    invalidNames.push(name);
  }
  return Object.freeze({
    values: Object.freeze(values),
    invalidNames: Object.freeze(invalidNames),
  });
}

export function readReleasePolicyExpectations() {
  return Object.freeze({ mode: RESET_POLICY_MODE });
}

export function validateBoundVercelProductionMetadata(
  contents,
  expectedVercelProjectId,
) {
  if (!/^prj_[A-Za-z0-9]{8,128}$/u.test(expectedVercelProjectId ?? "")) {
    throw new Error("expected Vercel project ID is invalid");
  }
  let metadata;
  try {
    metadata = JSON.parse(contents);
  } catch {
    throw new Error("bound Vercel production metadata is invalid");
  }
  const record = exactObjectKeys(
    metadata,
    ["schemaVersion", "vercelProjectId", "target", "envs"],
    "bound Vercel production metadata",
  );
  if (
    record.schemaVersion !== VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA ||
    record.vercelProjectId !== expectedVercelProjectId ||
    record.target !== "production" ||
    !Array.isArray(record.envs) ||
    record.envs.length > 512 ||
    record.envs.some(
      (entry) => !isExactSafeVercelEnvironmentMetadataEntry(entry),
    )
  ) {
    throw new Error("bound Vercel production metadata is invalid");
  }
  return Object.freeze({
    schemaVersion: record.schemaVersion,
    vercelProjectId: record.vercelProjectId,
    target: record.target,
    environmentRecordCount: record.envs.length,
  });
}

export function evaluateReadModelDeployPolicy(
  contents,
  _environment = {},
  expectations = readReleasePolicyExpectations(),
) {
  void _environment;
  const indexedFlags = exactBooleanFlags(
    readReleaseGatedFlags(contents),
    RELEASE_GATED_FLAG_NAMES,
    { missingIsFalse: false },
  );
  const workerFlags = exactBooleanFlags(
    readSelectedDotenvValues(contents, WORKER_ACTIVATION_FLAG_NAMES),
    WORKER_ACTIVATION_FLAG_NAMES,
    { missingIsFalse: true },
  );
  const activeFlagNames = Object.freeze([
    ...RELEASE_GATED_FLAG_NAMES.filter((name) => indexedFlags.values[name]),
    ...WORKER_ACTIVATION_FLAG_NAMES.filter((name) => workerFlags.values[name]),
  ]);
  const invalidFlagNames = Object.freeze([
    ...indexedFlags.invalidNames,
    ...workerFlags.invalidNames,
  ]);
  const expectationsReady =
    expectations === undefined || expectations?.mode === RESET_POLICY_MODE;
  const policyReady =
    expectationsReady &&
    invalidFlagNames.length === 0 &&
    activeFlagNames.length === 0;

  return Object.freeze({
    mode: RESET_POLICY_MODE,
    evidenceRequired: false,
    providerCredentialsRequired: false,
    activeFlagNames,
    nonLegacyFlags: activeFlagNames,
    indexedFlags: indexedFlags.values,
    workerActivationFlags: workerFlags.values,
    policyReady,
    invalidFlagNames,
    invalidNonSecretEnvironmentNames: Object.freeze([]),
    invalidProductionRpcRuntimeEnvironmentNames: Object.freeze([]),
    invalidServerSecretEnvironmentNames: Object.freeze([]),
    commitmentsReady: true,
    runtimeProviderBinding: "not-required",
    invalidCommitmentNames: Object.freeze([]),
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
  if (
    attestation.policyMode !== RESET_POLICY_MODE ||
    Object.values(indexedFlags).some(Boolean) ||
    Object.values(workerActivationFlags).some(Boolean)
  ) {
    throw new Error("staged release attestation reset mode is invalid");
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
    expectations.requireIndexedFlagsFalse === true &&
    Object.values(indexedFlags).some(Boolean)
  ) {
    throw new Error("staged release attestation exposes indexed reads");
  }
  return Object.freeze({
    ...attestation,
    stagedDeploymentUrl: stagedTarget.origin,
    indexedFlags,
    workerActivationFlags,
  });
}

export function createStagedReleaseAttestation(input) {
  if (!input.policy?.policyReady || input.policy?.mode !== RESET_POLICY_MODE) {
    throw new Error("index reset release policy must pass before attestation");
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
    policyMode: RESET_POLICY_MODE,
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
  for (const name of ["env-file", "sensitive-env-metadata"]) {
    if (!result[name]) throw new Error(`--${name} is required`);
  }
  return result;
}

function main() {
  const args = argumentsFrom(process.argv.slice(2));
  const metadata = validateBoundVercelProductionMetadata(
    readFileSync(resolve(args["sensitive-env-metadata"]), "utf8"),
    process.env.VERCEL_PROJECT_ID,
  );
  const result = evaluateReadModelDeployPolicy(
    readFileSync(resolve(args["env-file"]), "utf8"),
  );
  if (!result.policyReady) {
    const rejectedNames = [
      ...result.invalidFlagNames,
      ...result.activeFlagNames,
    ];
    throw new Error(
      rejectedNames.length > 0
        ? `index reset environment preflight failed: ${rejectedNames.join(", ")}`
        : "index reset environment preflight failed",
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
        "evidence_required=false",
        "provider_credentials_required=false",
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
      evidenceRequired: false,
      providerCredentialsRequired: false,
      environmentMetadataBound: true,
      environmentRecordCount: metadata.environmentRecordCount,
      exactFalseFlags: RELEASE_GATED_FLAG_NAMES.length,
      workerActivationFlags: result.workerActivationFlags,
      policyReady: result.policyReady,
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
