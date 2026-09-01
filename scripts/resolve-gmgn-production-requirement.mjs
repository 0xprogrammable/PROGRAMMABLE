#!/usr/bin/env node

import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  isExactSafeVercelEnvironmentMetadataEntry,
  VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA,
} from "./bind-vercel-sensitive-production-metadata.mjs";

export const GMGN_PRODUCTION_ENVIRONMENT_KEY = "GMGN_API_KEY";
export const GMGN_MAX_REQUESTS_PER_SECOND_ENVIRONMENT_KEY =
  "GMGN_MAX_REQUESTS_PER_SECOND";

const MAXIMUM_METADATA_BYTES = 1_000_000;
const EXACT_METADATA_KEYS = [
  "envs",
  "schemaVersion",
  "target",
  "vercelProjectId",
].join("\0");
const FORBIDDEN_VALUE_FIELDS = new Set([
  "decryptedvalue",
  "encryptedvalue",
  "legacyvalue",
  "value",
  "vsmvalue",
]);

export function resolveGmgnProductionRequirement({
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
    || Object.keys(metadata).sort().join("\0") !== EXACT_METADATA_KEYS
    || metadata.schemaVersion !== VERCEL_SENSITIVE_PRODUCTION_METADATA_SCHEMA
    || metadata.vercelProjectId !== vercelProjectId
    || metadata.target !== "production"
    || !Array.isArray(metadata.envs)
    || metadata.envs.length > 512
  ) {
    throw new Error("Bound Vercel Production metadata is invalid");
  }

  const matches = [];
  const rateMatches = [];
  for (const entry of metadata.envs) {
    if (
      entry === null
      || typeof entry !== "object"
      || Array.isArray(entry)
      || typeof entry.key !== "string"
      || containsForbiddenValueField(entry)
      || !isExactSafeVercelEnvironmentMetadataEntry(entry)
    ) {
      throw new Error("Bound Vercel Production metadata is invalid");
    }
    if (
      entry.key !== GMGN_PRODUCTION_ENVIRONMENT_KEY
      && entry.key.toUpperCase() === GMGN_PRODUCTION_ENVIRONMENT_KEY
    ) {
      throw new Error("GMGN Production metadata key casing is invalid");
    }
    if (
      entry.key !== GMGN_MAX_REQUESTS_PER_SECOND_ENVIRONMENT_KEY
      && entry.key.toUpperCase() ===
        GMGN_MAX_REQUESTS_PER_SECOND_ENVIRONMENT_KEY
    ) {
      throw new Error("GMGN rate metadata key casing is invalid");
    }
    if (entry.key === GMGN_PRODUCTION_ENVIRONMENT_KEY) matches.push(entry);
    if (
      entry.key === GMGN_MAX_REQUESTS_PER_SECOND_ENVIRONMENT_KEY
    ) rateMatches.push(entry);
  }

  if (matches.length > 1 || rateMatches.length > 1) {
    throw new Error("GMGN Production metadata is ambiguous");
  }
  if (matches.length === 0 && rateMatches.length === 0) return false;
  if (matches.length === 0 || rateMatches.length === 0) {
    throw new Error("GMGN Production metadata is incomplete");
  }
  if (matches.length !== 1 || rateMatches.length !== 1) {
    throw new Error("GMGN Production metadata is invalid");
  }

  const [entry] = matches;
  const branchless = entry.gitBranch === undefined || entry.gitBranch === null;
  const nonCustom = entry.customEnvironmentIds === undefined
    || entry.customEnvironmentIds === null
    || (
      Array.isArray(entry.customEnvironmentIds)
      && entry.customEnvironmentIds.length === 0
    );
  const secretVisibility = entry.visibility === undefined
    || entry.visibility === "secret";
  const notDecrypted = entry.decrypted === undefined || entry.decrypted === false;
  if (
    entry.type !== "sensitive"
    || !Array.isArray(entry.target)
    || entry.target.length !== 1
    || entry.target[0] !== "production"
    || !branchless
    || !nonCustom
    || !secretVisibility
    || !notDecrypted
    || entry.system === true
  ) {
    throw new Error("GMGN is not exact sensitive Production metadata");
  }

  const [rateEntry] = rateMatches;
  const rateBranchless = rateEntry.gitBranch === undefined
    || rateEntry.gitBranch === null;
  const rateNonCustom = rateEntry.customEnvironmentIds === undefined
    || rateEntry.customEnvironmentIds === null
    || (
      Array.isArray(rateEntry.customEnvironmentIds)
      && rateEntry.customEnvironmentIds.length === 0
    );
  const rateSecretVisibility = rateEntry.visibility === undefined
    || rateEntry.visibility === "secret";
  const rateNotDecrypted = rateEntry.decrypted === undefined
    || rateEntry.decrypted === false;
  if (
    !["sensitive", "encrypted"].includes(rateEntry.type)
    || !Array.isArray(rateEntry.target)
    || rateEntry.target.length !== 1
    || rateEntry.target[0] !== "production"
    || !rateBranchless
    || !rateNonCustom
    || !rateSecretVisibility
    || !rateNotDecrypted
    || rateEntry.system === true
  ) {
    throw new Error("GMGN rate is not exact protected Production metadata");
  }
  return true;
}

function containsForbiddenValueField(value, depth = 0) {
  if (depth > 8) return true;
  if (value === null || typeof value !== "object") return false;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_VALUE_FIELDS.has(key.toLowerCase())) return true;
    if (containsForbiddenValueField(nested, depth + 1)) return true;
  }
  return false;
}

function argumentsFrom(argv) {
  if (argv.length !== 4) {
    throw new Error(
      "--metadata-file and --vercel-project-id are required exactly once",
    );
  }
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (
      !["--metadata-file", "--vercel-project-id"].includes(name)
      || !value
      || value.startsWith("--")
      || Object.hasOwn(result, name)
    ) {
      throw new Error(
        "--metadata-file and --vercel-project-id are required exactly once",
      );
    }
    result[name] = value;
  }
  return Object.freeze({
    metadataFile: result["--metadata-file"],
    vercelProjectId: result["--vercel-project-id"],
  });
}

async function main(argv) {
  const args = argumentsFrom(argv);
  const metadataStat = await stat(args.metadataFile);
  if (
    !metadataStat.isFile()
    || metadataStat.size < 2
    || metadataStat.size > MAXIMUM_METADATA_BYTES
  ) {
    throw new Error("Bound Vercel Production metadata file is invalid");
  }
  let metadata;
  try {
    metadata = JSON.parse(await readFile(args.metadataFile, "utf8"));
  } catch {
    throw new Error("Bound Vercel Production metadata file is invalid");
  }
  const requireGmgnMarket = resolveGmgnProductionRequirement({
    metadata,
    vercelProjectId: args.vercelProjectId,
  });
  process.stdout.write(requireGmgnMarket ? "true\n" : "false\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `${error instanceof Error
        ? error.message
        : "GMGN Production requirement resolution failed"}\n`,
    );
    process.exitCode = 1;
  });
}
