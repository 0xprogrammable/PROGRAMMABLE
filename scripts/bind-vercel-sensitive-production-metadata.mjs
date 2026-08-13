#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA =
  "programmable.vercel-sensitive-production-metadata.v1";

export function omitVercelEnvironmentValues(metadata) {
  if (
    metadata === null
    || typeof metadata !== "object"
    || Array.isArray(metadata)
    || Object.keys(metadata).sort().join("\0") !== "envs"
    || !Array.isArray(metadata.envs)
  ) {
    throw new Error("Vercel environment metadata is invalid");
  }
  return Object.freeze({
    envs: metadata.envs.map((entry) => {
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error("Vercel environment metadata is invalid");
      }
      const valueFreeEntry = { ...entry };
      delete valueFreeEntry.value;
      return Object.freeze(valueFreeEntry);
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
  ) {
    throw new Error("Vercel environment metadata is invalid");
  }
  for (const entry of metadata.envs) {
    if (
      entry === null
      || typeof entry !== "object"
      || Array.isArray(entry)
      || Object.hasOwn(entry, "value")
    ) {
      throw new Error("Vercel environment metadata must not contain values");
    }
  }
  return Object.freeze({
    schemaVersion: VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA,
    vercelProjectId,
    target: "production",
    envs: metadata.envs,
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
  for (const name of ["metadata-file", "vercel-project-id"]) {
    if (!result[name]) throw new Error(`--${name} is required`);
  }
  return result;
}

async function readStandardInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
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
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "metadata binding failed"}\n`,
    );
    process.exitCode = 1;
  });
}
