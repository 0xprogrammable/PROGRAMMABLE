#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA =
  "programmable.vercel-sensitive-production-metadata.v1";

const MAXIMUM_INPUT_BYTES = 8 * 1024 * 1024;
const VERCEL_ENVIRONMENT_TARGETS = new Set([
  "development",
  "preview",
  "production",
]);

function normalizeVercelEnvironmentEntry(entry) {
  if (
    entry === null
    || typeof entry !== "object"
    || Array.isArray(entry)
    || typeof entry.key !== "string"
    || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(entry.key)
    || typeof entry.type !== "string"
    || !/^[a-z][a-z-]{0,31}$/u.test(entry.type)
    || !Array.isArray(entry.target)
    || entry.target.length < 1
    || entry.target.length > VERCEL_ENVIRONMENT_TARGETS.size
    || entry.target.some(
      (target) =>
        typeof target !== "string"
        || !VERCEL_ENVIRONMENT_TARGETS.has(target),
    )
    || new Set(entry.target).size !== entry.target.length
  ) {
    throw new Error("Vercel environment metadata is invalid");
  }
  return Object.freeze({
    key: entry.key,
    type: entry.type,
    target: Object.freeze([...entry.target]),
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
  ) {
    throw new Error("Vercel environment metadata is invalid");
  }
  const envs = Object.freeze(
    metadata.envs.map(normalizeVercelEnvironmentEntry),
  );
  return Object.freeze({
    schemaVersion: VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA,
    vercelProjectId,
    target: "production",
    envs,
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
  for (const name of ["output-file", "vercel-project-id"]) {
    if (!result[name]) throw new Error(`--${name} is required`);
  }
  return result;
}

async function readStandardInput() {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of process.stdin) {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAXIMUM_INPUT_BYTES) {
      throw new Error("Vercel environment metadata is invalid");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function main(argv) {
  const args = argumentsFrom(argv);
  let source;
  try {
    source = JSON.parse(await readStandardInput());
  } catch {
    throw new Error("Vercel environment metadata is invalid");
  }
  const bound = bindVercelSensitiveProductionMetadata({
    metadata: source,
    vercelProjectId: args["vercel-project-id"],
  });
  await writeFile(args["output-file"], `${JSON.stringify(bound)}\n`, {
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
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.message
        : "Vercel environment metadata binding failed"}\n`,
    );
    process.exitCode = 1;
  });
}
