#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA } from
  "./bind-vercel-sensitive-production-metadata.mjs";

export const MANUAL_APPLICANT_LAUNCH_FLAG =
  "PROGRAMMABLE_MANUAL_APPLICANT_LAUNCH_ENABLED";
export const MANUAL_APPLICANT_SERVER_ENVIRONMENT = Object.freeze([
  "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
  "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "PRIVY_APP_SECRET",
  "OPS_BLOB_READ_WRITE_TOKEN",
  "CRON_SECRET",
]);
export const MANUAL_APPLICANT_SENSITIVE_SERVER_ENVIRONMENT = Object.freeze([
  "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
  "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
  "PRIVY_APP_SECRET",
  "OPS_BLOB_READ_WRITE_TOKEN",
  "CRON_SECRET",
]);
const HEX_BYTES32 = /^0x[0-9a-f]{64}$/u;

export function readManualApplicantLaunchFlag(envSource) {
  const matches = [];
  for (const line of envSource.split(/\r?\n/u)) {
    const match = new RegExp(`^${MANUAL_APPLICANT_LAUNCH_FLAG}=(.*)$`, "u")
      .exec(line);
    if (match) matches.push(match[1]);
  }
  if (matches.length === 0) return false;
  if (matches.length !== 1) {
    throw new Error("manual Applicant launch flag must occur exactly once");
  }
  const raw = matches[0];
  if (raw === "true" || raw === "false") return raw === "true";
  if (
    raw.length >= 2
    && (
      (raw.startsWith('"') && raw.endsWith('"'))
      || (raw.startsWith("'") && raw.endsWith("'"))
    )
    && !/[\\\r\n]/u.test(raw.slice(1, -1))
  ) {
    const unquoted = raw.slice(1, -1);
    if (unquoted === "true" || unquoted === "false") {
      return unquoted === "true";
    }
  }
  throw new Error(
    "manual Applicant launch flag must be one exact boolean without expansion",
  );
}

export function resolveManualApplicantLaunchPolicy({
  requested,
  productionEnvSource,
  protectedMode,
  sensitiveMetadataSource,
  expectedVercelProjectId,
  endpointCommitments,
}) {
  const dispatchEnabled = exactBoolean(
    requested,
    "manual Applicant launch dispatch request",
  );
  const configuredEnabled = readManualApplicantLaunchFlag(productionEnvSource);
  const protectedEnabled = protectedMode === "enabled"
    ? true
    : protectedMode === "disabled" ? false : null;
  if (protectedEnabled === null) {
    throw new Error(
      "manual Applicant protected production mode must be enabled or disabled",
    );
  }
  if (dispatchEnabled !== configuredEnabled) {
    throw new Error(
      "manual Applicant dispatch request and pulled production configuration disagree",
    );
  }
  if (protectedEnabled !== configuredEnabled) {
    throw new Error(
      "manual Applicant protected mode and pulled production configuration disagree",
    );
  }
  if (configuredEnabled) {
    assertManualApplicantServerEnvironment(productionEnvSource, {
      sensitiveMetadataSource,
      expectedVercelProjectId,
      endpointCommitments,
    });
  }
  return Object.freeze({ enabled: configuredEnabled });
}

export function assertManualApplicantServerEnvironment(
  envSource,
  {
    sensitiveMetadataSource,
    expectedVercelProjectId,
    endpointCommitments,
  } = {},
) {
  const values = new Map(MANUAL_APPLICANT_SERVER_ENVIRONMENT.map((name) =>
    [name, readExactEnvironmentValue(envSource, name)]));
  for (const name of MANUAL_APPLICANT_SENSITIVE_SERVER_ENVIRONMENT) {
    if (values.get(name) !== "") {
      throw new Error(`manual Applicant ${name} custody was downgraded`);
    }
  }
  if (values.get("NEXT_PUBLIC_PRIVY_APP_ID") === "") {
    throw new Error("manual Applicant NEXT_PUBLIC_PRIVY_APP_ID is not configured");
  }
  assertExactSensitiveProductionMetadata({
    source: sensitiveMetadataSource,
    expectedVercelProjectId,
  });
  assertEndpointCommitments(endpointCommitments);
  return Object.freeze(Object.fromEntries(
    [...values.keys()].map((name) => [name, "configured"]),
  ));
}

function readExactEnvironmentValue(source, name) {
  const matches = [];
  for (const line of source.split(/\r?\n/u)) {
    const match = new RegExp(`^${name}=(.*)$`, "u").exec(line);
    if (match) matches.push(match[1]);
  }
  if (matches.length !== 1) {
    throw new Error(`manual Applicant ${name} must occur exactly once`);
  }
  const raw = matches[0];
  const value = raw.length >= 2
    && ((raw.startsWith('"') && raw.endsWith('"'))
      || (raw.startsWith("'") && raw.endsWith("'")))
    ? raw.slice(1, -1)
    : raw;
  if (/[\r\n\u0000]/u.test(value)) {
    throw new Error(`manual Applicant ${name} is not configured`);
  }
  return value;
}

function assertExactSensitiveProductionMetadata({
  source,
  expectedVercelProjectId,
}) {
  if (
    typeof expectedVercelProjectId !== "string"
    || !/^prj_[A-Za-z0-9]{8,128}$/u.test(expectedVercelProjectId)
  ) throw new Error("manual Applicant Vercel project binding is invalid");
  let metadata;
  try {
    metadata = JSON.parse(source);
  } catch {
    throw new Error("manual Applicant sensitive production metadata is invalid");
  }
  if (
    metadata === null
    || typeof metadata !== "object"
    || Array.isArray(metadata)
    || Object.keys(metadata).sort().join("\0")
      !== "envs\0schemaVersion\0target\0vercelProjectId"
    || metadata.schemaVersion
      !== VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA
    || metadata.vercelProjectId !== expectedVercelProjectId
    || metadata.target !== "production"
    || !Array.isArray(metadata.envs)
  ) throw new Error("manual Applicant sensitive production metadata is invalid");
  for (const name of MANUAL_APPLICANT_SENSITIVE_SERVER_ENVIRONMENT) {
    const matches = metadata.envs.filter(
      (entry) => entry !== null && typeof entry === "object" && entry.key === name,
    );
    if (
      matches.length !== 1
      || matches[0].type !== "sensitive"
      || !Array.isArray(matches[0].target)
      || matches[0].target.length !== 1
      || matches[0].target[0] !== "production"
      || Object.hasOwn(matches[0], "value")
    ) throw new Error(`manual Applicant ${name} is not exact sensitive production metadata`);
  }
}

function assertEndpointCommitments(value) {
  const alchemy = value?.alchemy;
  const quickNode = value?.quickNode;
  if (!HEX_BYTES32.test(alchemy ?? "")) {
    throw new Error("manual Applicant Alchemy endpoint commitment is invalid");
  }
  if (!HEX_BYTES32.test(quickNode ?? "")) {
    throw new Error("manual Applicant QuickNode endpoint commitment is invalid");
  }
  if (alchemy === quickNode) {
    throw new Error("manual Applicant endpoint commitments are not independent");
  }
  return Object.freeze({ alchemy, quickNode });
}

function exactBoolean(value, label) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${label} must be exactly true or false`);
}

function argumentsFrom(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("arguments must be --name value pairs");
    }
    result[name.slice(2)] = value;
  }
  for (const name of [
    "env-file",
    "manual-sensitive-metadata",
    "vercel-project-id",
    "alchemy-endpoint-commitment",
    "quicknode-endpoint-commitment",
    "requested",
    "protected-mode",
    "github-output",
  ]) {
    if (!result[name]) throw new Error(`--${name} is required`);
  }
  return result;
}

async function main(argv) {
  const args = argumentsFrom(argv);
  const policy = resolveManualApplicantLaunchPolicy({
    requested: args.requested,
    productionEnvSource: await readFile(args["env-file"], "utf8"),
    protectedMode: args["protected-mode"],
    sensitiveMetadataSource: await readFile(
      args["manual-sensitive-metadata"],
      "utf8",
    ),
    expectedVercelProjectId: args["vercel-project-id"],
    endpointCommitments: {
      alchemy: args["alchemy-endpoint-commitment"],
      quickNode: args["quicknode-endpoint-commitment"],
    },
  });
  await appendFile(
    args["github-output"],
    `enabled=${policy.enabled}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify({ status: "verified", ...policy })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "manual Applicant policy failed"}\n`,
    );
    process.exitCode = 1;
  });
}
