#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA =
  "programmable.vercel-sensitive-production-metadata.v1";

const MAXIMUM_METADATA_BYTES = 1_000_000;
const MAXIMUM_ENVIRONMENT_RECORDS = 512;
const MAXIMUM_METADATA_DEPTH = 8;
const MAXIMUM_METADATA_STRING_LENGTH = 1_024;
export const VERCEL_SAFE_ENVIRONMENT_METADATA_FIELDS = Object.freeze([
  "customEnvironmentIds",
  "decrypted",
  "gitBranch",
  "key",
  "system",
  "target",
  "type",
  "visibility",
]);
const SAFE_ENVIRONMENT_METADATA_FIELDS = new Set(
  VERCEL_SAFE_ENVIRONMENT_METADATA_FIELDS,
);
const FORBIDDEN_VALUE_FIELDS = new Set([
  "decryptedvalue",
  "encryptedvalue",
  "legacyvalue",
  "value",
  "vsmvalue",
]);

export function omitVercelEnvironmentValues(metadata) {
  if (
    metadata === null
    || typeof metadata !== "object"
    || Array.isArray(metadata)
    || Object.keys(metadata).sort().join("\0") !== "envs"
    || !Array.isArray(metadata.envs)
    || metadata.envs.length > MAXIMUM_ENVIRONMENT_RECORDS
  ) {
    throw new Error("Vercel environment metadata is invalid");
  }
  return Object.freeze({
    envs: metadata.envs.map((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("Vercel environment metadata is invalid");
      }
      return omitEnvironmentValueFields(entry);
    }),
  });
}

export function bindVercelSensitiveProductionMetadata({
  metadata,
  vercelProjectId,
}) {
  if (!/^prj_[A-Za-z0-9]{8,128}$/u.test(vercelProjectId ?? "")) {
    throw new Error("Vercel project ID is invalid");
  }
  if (
    metadata === null
    || typeof metadata !== "object"
    || Array.isArray(metadata)
    || Object.keys(metadata).sort().join("\0") !== "envs"
    || !Array.isArray(metadata.envs)
    || metadata.envs.length > MAXIMUM_ENVIRONMENT_RECORDS
  ) {
    throw new Error("Vercel environment metadata is invalid");
  }
  const projectedEntries = metadata.envs.map((entry) => {
    if (
      entry === null
      || typeof entry !== "object"
      || Array.isArray(entry)
      || containsForbiddenValueField(entry)
    ) {
      throw new Error("Vercel environment metadata must not contain values");
    }
    if (
      hasUnknownEnvironmentMetadataField(entry)
      || !isExactSafeVercelEnvironmentMetadataEntry(entry)
    ) {
      throw new Error("Vercel environment metadata is invalid");
    }
    return copySafeEnvironmentMetadataEntry(entry);
  });
  return Object.freeze({
    schemaVersion: VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA,
    vercelProjectId,
    target: "production",
    envs: Object.freeze(projectedEntries),
  });
}

function omitEnvironmentValueFields(candidate) {
  assertBoundedMetadataValue(candidate);
  return copySafeEnvironmentMetadataEntry(candidate);
}

function copySafeEnvironmentMetadataEntry(entry) {
  const projected = {};
  for (const field of VERCEL_SAFE_ENVIRONMENT_METADATA_FIELDS) {
    if (!Object.hasOwn(entry, field)) continue;
    const value = entry[field];
    projected[field] = Array.isArray(value)
      ? Object.freeze([...value])
      : value;
  }
  if (!isExactSafeVercelEnvironmentMetadataEntry(projected)) {
    throw new Error("Vercel environment metadata is invalid");
  }
  return Object.freeze(projected);
}

function assertBoundedMetadataValue(value, depth = 0) {
  if (depth > MAXIMUM_METADATA_DEPTH) {
    throw new Error("Vercel environment metadata is invalid");
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertBoundedMetadataValue(entry, depth + 1);
    return;
  }
  for (const nested of Object.values(value)) {
    assertBoundedMetadataValue(nested, depth + 1);
  }
}

function boundedMetadataString(value) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= MAXIMUM_METADATA_STRING_LENGTH;
}

function optionalBoundedMetadataString(value) {
  return value === undefined || value === null || boundedMetadataString(value);
}

function optionalBoolean(value) {
  return value === undefined || typeof value === "boolean";
}

function boundedMetadataStringArray(value, maximumLength) {
  return Array.isArray(value)
    && value.length <= maximumLength
    && value.every(boundedMetadataString);
}

export function isExactSafeVercelEnvironmentMetadataEntry(entry) {
  return entry !== null
    && typeof entry === "object"
    && !Array.isArray(entry)
    && !hasUnknownEnvironmentMetadataField(entry)
    && boundedMetadataString(entry.key)
    && boundedMetadataString(entry.type)
    && boundedMetadataStringArray(entry.target, 8)
    && optionalBoundedMetadataString(entry.gitBranch)
    && (
      entry.customEnvironmentIds === undefined
      || entry.customEnvironmentIds === null
      || boundedMetadataStringArray(entry.customEnvironmentIds, 64)
    )
    && optionalBoundedMetadataString(entry.visibility)
    && optionalBoolean(entry.decrypted)
    && optionalBoolean(entry.system);
}

function hasUnknownEnvironmentMetadataField(entry) {
  return Object.keys(entry).some(
    (field) => !SAFE_ENVIRONMENT_METADATA_FIELDS.has(field),
  );
}

function containsForbiddenValueField(value, depth = 0) {
  if (depth > MAXIMUM_METADATA_DEPTH) return true;
  if (value === null || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_VALUE_FIELDS.has(key.toLowerCase())) return true;
    if (containsForbiddenValueField(nested, depth + 1)) return true;
  }
  return false;
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
  for (const name of ["metadata-file", "vercel-project-id"]) {
    if (!result[name]) throw new Error(`--${name} is required`);
  }
  return result;
}

async function readStandardInput() {
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    byteLength += buffer.length;
    if (byteLength > MAXIMUM_METADATA_BYTES) {
      throw new Error("Vercel environment metadata is invalid");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv) {
  const args = argumentsFrom(argv);
  const source = JSON.parse(await readStandardInput());
  const bound = bindVercelSensitiveProductionMetadata({
    metadata: omitVercelEnvironmentValues(source),
    vercelProjectId: args["vercel-project-id"],
  });
  await writeFile(args["metadata-file"], `${JSON.stringify(bound)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify({
    status: "bound",
    schemaVersion: bound.schemaVersion,
    target: bound.target,
  })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write("Vercel Production metadata binding failed\n");
    process.exitCode = 1;
  });
}
