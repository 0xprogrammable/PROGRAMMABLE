#!/usr/bin/env node

import process from "node:process";

import { parseCli, renderHelp } from "./cli-args.mjs";
import { CliFailure, emitFailure, emitSuccess } from "./cli-runtime.mjs";
import {
  RESOLVE_CONTRACT_V1,
  resolveActiveContractV1
} from "./resolve-contract-core.mjs";

const spec = {
  command: "resolve-contract.mjs",
  usage: "resolve-contract.mjs <owner/repository> [--network] [--manifest-path <path>] [--timeout-ms <milliseconds>]",
  summary: "Resolve exact public default-branch workflow, validator, package and policy evidence without using GitHub review state as authority.",
  options: [
    {
      name: "--network",
      key: "network",
      type: "boolean",
      description: "Enable bounded anonymous GET-only GitHub resolution. Without it, emit an offline plan."
    },
    {
      name: "--manifest-path",
      key: "manifestPath",
      type: "value",
      valueName: "path",
      description: "Resolve only this exact default-branch active-contract manifest path."
    },
    {
      name: "--timeout-ms",
      key: "timeoutMs",
      type: "value",
      valueName: "milliseconds",
      description: `Bound the whole network operation from ${RESOLVE_CONTRACT_V1.minimumTimeoutMs} to ${RESOLVE_CONTRACT_V1.maximumTimeoutMs} milliseconds.`
    }
  ],
  positionals: { min: 1, max: 1, names: ["owner/repository"] }
};

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(`${renderHelp(spec)}\n`);
} else try {
  let parsed;
  try {
    parsed = parseCli(spec, argv);
  } catch (error) {
    throw new CliFailure("USAGE_ERROR", error instanceof Error ? error.message : String(error));
  }
  const { options, positionals } = parsed;
  const timeoutMs = options.timeoutMs === null
    ? RESOLVE_CONTRACT_V1.defaultTimeoutMs
    : parseTimeout(options.timeoutMs);
  const result = await resolveActiveContractV1({
    repository: positionals[0],
    network: options.network,
    manifestPath: options.manifestPath,
    timeoutMs
  });
  if (result.transport.failure !== null) {
    process.exitCode = emitFailure("resolve-contract", new CliFailure(
      "CONTRACT_RESOLUTION_TRANSPORT_FAILED",
      result.transport.failure.message,
      { exitCode: 1, details: result }
    ));
  } else if (result.outcome === "unresolved") {
    process.exitCode = emitFailure("resolve-contract", new CliFailure(
      "CONTRACT_RESOLUTION_UNRESOLVED",
      "the exact default-branch contract could not be resolved without ambiguity or integrity failure",
      { exitCode: 1, details: result }
    ));
  } else {
    process.exitCode = emitSuccess("resolve-contract", result);
  }
} catch (error) {
  const failure = error instanceof CliFailure
    ? error
    : new CliFailure("USAGE_ERROR", error instanceof Error ? error.message : String(error));
  process.exitCode = emitFailure("resolve-contract", failure);
}

function parseTimeout(value) {
  if (!/^(?:0|[1-9][0-9]{0,8})$/u.test(value)) {
    throw new CliFailure("USAGE_ERROR", "--timeout-ms must be a canonical decimal integer");
  }
  const timeoutMs = Number(value);
  if (
    timeoutMs < RESOLVE_CONTRACT_V1.minimumTimeoutMs
    || timeoutMs > RESOLVE_CONTRACT_V1.maximumTimeoutMs
  ) {
    throw new CliFailure(
      "USAGE_ERROR",
      `--timeout-ms must be between ${RESOLVE_CONTRACT_V1.minimumTimeoutMs} and ${RESOLVE_CONTRACT_V1.maximumTimeoutMs}`
    );
  }
  return timeoutMs;
}
