#!/usr/bin/env node

import { appendFileSync, readFileSync } from "node:fs";
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

export function evaluateReadModelDeployPolicy(contents, environment = {}) {
  const flags = readReleaseGatedFlags(contents);
  const nonLegacyFlags = RELEASE_GATED_FLAG_NAMES.filter(
    (name) => flags[name] !== "false",
  );
  const evidenceRequired = nonLegacyFlags.length > 0;
  const invalidCommitments = evidenceRequired
    ? COMMITMENT_NAMES.filter(
        (name) => !HEX_BYTES32.test(environment[name] ?? ""),
      )
    : [];
  let runtimeCommitmentsMatch = !evidenceRequired;
  if (evidenceRequired && invalidCommitments.length === 0) {
    try {
      const runtimeEnvironment = readSelectedDotenvValues(
        contents,
        RUNTIME_RPC_URL_NAMES,
      );
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
    } catch {
      runtimeCommitmentsMatch = false;
    }
  }
  return Object.freeze({
    mode: evidenceRequired ? "indexed-or-shadow" : "legacy-only",
    evidenceRequired,
    nonLegacyFlags,
    commitmentsReady:
      invalidCommitments.length === 0 && runtimeCommitmentsMatch,
    invalidCommitmentNames:
      invalidCommitments.length > 0
        ? invalidCommitments
        : runtimeCommitmentsMatch
          ? []
          : ["runtime-provider-commitment-mismatch"],
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
  const result = evaluateReadModelDeployPolicy(
    readFileSync(resolve(args["env-file"]), "utf8"),
    process.env,
  );
  if (args["github-output"]) {
    appendFileSync(
      resolve(args["github-output"]),
      `mode=${result.mode}\nevidence_required=${result.evidenceRequired}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  process.stdout.write(
    `${JSON.stringify({
      mode: result.mode,
      evidenceRequired: result.evidenceRequired,
      exactFalseFlags:
        RELEASE_GATED_FLAG_NAMES.length - result.nonLegacyFlags.length,
      gatedFlags: result.nonLegacyFlags,
      commitmentsReady: result.commitmentsReady,
    })}\n`,
  );
  if (!result.commitmentsReady) {
    throw new Error(
      `indexed/shadow release requires pinned commitments: ${result.invalidCommitmentNames.join(", ")}`,
    );
  }
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
