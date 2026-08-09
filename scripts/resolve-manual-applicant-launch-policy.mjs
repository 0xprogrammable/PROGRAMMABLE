#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

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
    assertManualApplicantServerEnvironment(productionEnvSource);
  }
  return Object.freeze({ enabled: configuredEnabled });
}

export function assertManualApplicantServerEnvironment(envSource) {
  const values = new Map(MANUAL_APPLICANT_SERVER_ENVIRONMENT.map((name) =>
    [name, readExactEnvironmentValue(envSource, name)]));
  const alchemy = strictRpcUrl(
    values.get("PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL"),
    "PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL",
    (hostname) => hostname === "eth-mainnet.g.alchemy.com",
  );
  const quickNode = strictRpcUrl(
    values.get("PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL"),
    "PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL",
    (hostname) => /^(?:[a-z0-9-]+\.)+quiknode\.pro$/u.test(hostname),
  );
  if (
    alchemy.href === quickNode.href
    || alchemy.hostname === quickNode.hostname
    || alchemy.hostname.split(".").slice(-2).join(".")
      === quickNode.hostname.split(".").slice(-2).join(".")
  ) throw new Error("manual Applicant RPC providers are not independent");
  if (values.get("CRON_SECRET").length < 32) {
    throw new Error("manual Applicant CRON_SECRET is too short");
  }
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
  if (!value || /[\r\n\u0000]/u.test(value)) {
    throw new Error(`manual Applicant ${name} is not configured`);
  }
  return value;
}

function strictRpcUrl(value, name, acceptsHostname) {
  let url;
  if (value.length > 2_048 || value !== value.trim()) {
    throw new Error(`manual Applicant ${name} is not a valid URL`);
  }
  try {
    url = new URL(value);
  } catch {
    throw new Error(`manual Applicant ${name} is not a valid URL`);
  }
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.search !== ""
    || url.hash !== ""
    || url.port !== ""
    || url.pathname === "/"
    || !acceptsHostname(url.hostname.toLowerCase())
  ) throw new Error(`manual Applicant ${name} is not its strict provider`);
  return url;
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
    "env-file", "requested", "protected-mode", "github-output",
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
