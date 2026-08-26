#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

const MAXIMUM_INPUT_BYTES = 4 * 1024 * 1024;
const COMMIT = /^(?!0{40}$)[0-9a-f]{40}$/u;
const DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{20,80}$/u;
const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,255}$/u;
const ENVIRONMENT_TYPES = new Set(["encrypted", "plain", "sensitive"]);
const ENVIRONMENT_TARGETS = new Set(["development", "preview", "production"]);
const ENVIRONMENT_ENTRY_KEYS = new Set([
  "configurationId",
  "createdAt",
  "key",
  "target",
  "type",
  "updatedAt",
  "value",
]);

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return isObject(value)
    && Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function exactHttpsOrigin(value, expectedHostname) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Vercel production binding contains an invalid HTTPS origin");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== ""
    || url.hostname !== expectedHostname || url.pathname !== "/"
    || url.search !== "" || url.hash !== "") {
    throw new Error("Vercel production binding contains an invalid HTTPS origin");
  }
  return url.toString();
}

export function createCustomLaunchV3RollbackConfigurationSnapshotV1(input) {
  const binding = input.productionBinding;
  if (!exactKeys(binding, [
    "status", "deploymentId", "deploymentUrl", "gitHead", "targetUrl",
  ])
    || binding.status !== "verified"
    || !DEPLOYMENT_ID.test(binding.deploymentId ?? "")
    || !COMMIT.test(binding.gitHead ?? "")) {
    throw new Error("Vercel production binding is invalid");
  }
  let deploymentHostname;
  try {
    deploymentHostname = new URL(binding.deploymentUrl).hostname;
  } catch {
    throw new Error("Vercel production binding contains an invalid HTTPS origin");
  }
  const immutableDeploymentUrl = exactHttpsOrigin(binding.deploymentUrl, deploymentHostname);
  if (!deploymentHostname.endsWith(".vercel.app")) {
    throw new Error("Vercel production binding is not immutable");
  }
  const productionAlias = exactHttpsOrigin(binding.targetUrl, "programmable.market");
  const readback = input.environmentReadback;
  if (!exactKeys(readback, ["envs"]) || !Array.isArray(readback.envs)
    || readback.envs.length < 1 || readback.envs.length > 512) {
    throw new Error("Vercel environment metadata readback is invalid");
  }
  const variables = readback.envs.map((entry) => {
    if (!isObject(entry)
      || Object.keys(entry).some((key) => !ENVIRONMENT_ENTRY_KEYS.has(key))
      || ![6, 7].includes(Object.keys(entry).length)
      || !ENVIRONMENT_NAME.test(entry.key ?? "")
      || !ENVIRONMENT_TYPES.has(entry.type)
      || !Array.isArray(entry.target) || entry.target.length < 1
      || entry.target.some((target) => !ENVIRONMENT_TARGETS.has(target))
      || new Set(entry.target).size !== entry.target.length
      || !entry.target.includes("production")
      || !Number.isSafeInteger(entry.createdAt)
      || !Number.isSafeInteger(entry.updatedAt)
      || !(entry.configurationId === null || typeof entry.configurationId === "string")) {
      throw new Error("Vercel environment metadata entry is invalid");
    }
    return Object.freeze({
      name: entry.key,
      type: entry.type,
      target: Object.freeze([...entry.target].sort()),
    });
  }).sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
  if (new Set(variables.map((variable) => variable.name)).size !== variables.length) {
    throw new Error("Vercel production environment metadata contains duplicate names");
  }
  return Object.freeze({
    schemaVersion: "programmable.custom-launch-v3-rollback-configuration-snapshot.v1",
    deployment: Object.freeze({
      deploymentId: binding.deploymentId,
      immutableDeploymentUrl,
      commitSha: binding.gitHead,
      productionAlias,
    }),
    environment: Object.freeze({
      target: "production",
      variables: Object.freeze(variables),
    }),
  });
}

async function readBoundedJsonFile(path, label) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    throw new Error(`${label} is unavailable`);
  }
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAXIMUM_INPUT_BYTES) {
    throw new Error(`${label} is not one bounded regular file`);
  }
  try {
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(await readFile(path)));
  } catch {
    throw new Error(`${label} is not UTF-8 JSON`);
  }
}

async function readBoundedStdin(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAXIMUM_INPUT_BYTES) throw new Error("Vercel environment metadata exceeds the input limit");
    chunks.push(bytes);
  }
  if (size < 1) throw new Error("Vercel environment metadata stdin is unavailable");
  try {
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(Buffer.concat(chunks)));
  } catch {
    throw new Error("Vercel environment metadata stdin is not UTF-8 JSON");
  }
}

async function exclusiveOutputPath(path) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new Error("rollback configuration snapshot output must be absolute");
  }
  let parent;
  try {
    parent = await realpath(dirname(path));
  } catch {
    throw new Error("rollback configuration snapshot output parent is unavailable");
  }
  const filename = basename(path);
  if (filename === "" || filename === "." || filename === "..") {
    throw new Error("rollback configuration snapshot output is invalid");
  }
  const outputPath = join(parent, filename);
  try {
    await lstat(outputPath);
  } catch (error) {
    if (error?.code === "ENOENT") return outputPath;
    throw new Error("rollback configuration snapshot output could not be inspected");
  }
  throw new Error("rollback configuration snapshot output already exists");
}

export async function materializeCustomLaunchV3RollbackConfigurationSnapshotV1(input) {
  const [productionBinding, outputPath] = await Promise.all([
    readBoundedJsonFile(input.productionBindingPath, "Vercel production binding"),
    exclusiveOutputPath(input.outputPath),
  ]);
  const snapshot = createCustomLaunchV3RollbackConfigurationSnapshotV1({
    productionBinding,
    environmentReadback: input.environmentReadback,
  });
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  try {
    await writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
  } catch {
    throw new Error("rollback configuration snapshot could not be created exclusively");
  }
  if (!(await readFile(outputPath)).equals(bytes)) {
    throw new Error("rollback configuration snapshot differs after creation");
  }
  return Object.freeze({ outputPath, configurationSnapshotSha256: sha256(bytes), snapshot });
}

function parseArguments(argv) {
  if (argv.length !== 4) throw new Error("invalid command arguments");
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!["--production-binding", "--output"].includes(key)
      || typeof value !== "string" || !isAbsolute(value)
      || values[key] !== undefined) {
      throw new Error("invalid command arguments");
    }
    values[key] = value;
  }
  return values;
}

async function main(argv) {
  const args = parseArguments(argv);
  const environmentReadback = await readBoundedStdin(process.stdin);
  const result = await materializeCustomLaunchV3RollbackConfigurationSnapshotV1({
    productionBindingPath: args["--production-binding"],
    outputPath: args["--output"],
    environmentReadback,
  });
  process.stdout.write(
    `CUSTOM_LAUNCH_V3_ROLLBACK_CONFIGURATION_SNAPSHOT_MATERIALIZED ${result.configurationSnapshotSha256}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
