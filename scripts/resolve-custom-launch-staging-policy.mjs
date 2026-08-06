#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const CUSTOM_LAUNCH_PUBLIC_FLAG = "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED";

function parseBoolean(value, label) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new Error(`${label} must be exactly true or false`);
}

export function readCustomLaunchPublicFlag(envSource) {
  const matches = [];
  for (const line of envSource.split(/\r?\n/u)) {
    const match = new RegExp(`^${CUSTOM_LAUNCH_PUBLIC_FLAG}=(.*)$`, "u").exec(line);
    if (match) matches.push(match[1]);
  }
  if (matches.length === 0) return false;
  if (matches.length !== 1) throw new Error("Custom Launch public flag must occur exactly once");
  const raw = matches[0];
  if (raw === "true" || raw === "false") return parseBoolean(raw, "Custom Launch public flag");
  if (
    raw.length >= 2 &&
    ((raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'")))
  ) {
    const unquoted = raw.slice(1, -1);
    if (!/[\\\r\n]/u.test(unquoted)) return parseBoolean(unquoted, "Custom Launch public flag");
  }
  throw new Error("Custom Launch public flag must be one exact boolean without expansion");
}

export function resolveCustomLaunchStagingPolicy({ requested, productionEnvSource }) {
  const requestedEnablement = parseBoolean(requested, "Custom Launch dispatch request");
  const configuredEnablement = readCustomLaunchPublicFlag(productionEnvSource);
  if (requestedEnablement !== configuredEnablement) {
    throw new Error(
      "Custom Launch dispatch request and pulled production configuration disagree",
    );
  }
  return Object.freeze({
    releaseRecordRequired: requestedEnablement,
    configuredEnablement,
  });
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
  for (const name of ["env-file", "requested", "github-output"]) {
    if (!result[name]) throw new Error(`--${name} is required`);
  }
  return result;
}

async function main(argv) {
  const args = argumentsFrom(argv);
  const result = resolveCustomLaunchStagingPolicy({
    requested: args.requested,
    productionEnvSource: await readFile(args["env-file"], "utf8"),
  });
  await appendFile(
    args["github-output"],
    [
      `release_record_required=${result.releaseRecordRequired}`,
      `configured_enablement=${result.configuredEnablement}`,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );
  process.stdout.write(
    `${JSON.stringify({ status: "verified", releaseRecordRequired: result.releaseRecordRequired })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Custom Launch policy resolution failed"}\n`,
    );
    process.exitCode = 1;
  });
}
