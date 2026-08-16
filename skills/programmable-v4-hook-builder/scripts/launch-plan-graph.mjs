#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalJsonV2 } from "./canonical-json-core.mjs";
import {
  compileLaunchPlanGraph,
  LaunchPlanGraphError
} from "./launch-plan-graph-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

class UsageError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = "UsageError";
    this.code = code;
  }
}

try {
  const parsed = parseArguments(process.argv.slice(2));
  if (parsed.action === "help") {
    process.stdout.write(help());
  } else if (parsed.action === "version") {
    process.stdout.write("1.0.0\n");
  } else {
    const inputPath = resolveRegularInput(parsed.inputPath);
    const input = parseBoundedStrictJsonBytes(fs.readFileSync(inputPath), {
      maxSourceBytes: MAX_INPUT_BYTES,
      maxDepth: 64,
      maxNodes: 100_000
    });
    const result = compileLaunchPlanGraph(input);
    process.stdout.write(`${canonicalJsonV2({
      schemaVersion: "1.0.0",
      command: "launch-plan-graph compile",
      ok: true,
      result
    })}\n`);
  }
} catch (error) {
  const known = error instanceof LaunchPlanGraphError || error instanceof UsageError;
  process.stdout.write(`${canonicalJsonV2({
    schemaVersion: "1.0.0",
    command: "launch-plan-graph compile",
    ok: false,
    error: {
      code: known ? error.code : "LAUNCH_PLAN_GRAPH_COMPILE_FAILED",
      message: known ? error.message : "The launch-plan graph compiler failed without a safe diagnostic.",
      findings: error instanceof LaunchPlanGraphError ? error.findings : []
    }
  })}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}

function parseArguments(argv) {
  if (argv.length === 0 || (argv.length === 1 && ["--help", "-h"].includes(argv[0]))) {
    return { action: "help" };
  }
  if (argv.length === 1 && argv[0] === "--version") return { action: "version" };
  if (argv[0] !== "compile") throw new UsageError("COMMAND_INVALID", "Expected compile <input.json>.");
  if (argv.length !== 2 || argv[1].startsWith("-")) {
    throw new UsageError("ARGUMENT_INVALID", "compile requires exactly one input JSON path.");
  }
  return { action: "compile", inputPath: argv[1] };
}

function resolveRegularInput(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new UsageError("INPUT_NOT_FOUND", "The input JSON file does not exist.");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new UsageError("INPUT_NOT_REGULAR", "The input must be a regular non-symlink file.");
  }
  if (stat.size < 1 || stat.size > MAX_INPUT_BYTES) {
    throw new UsageError("INPUT_SIZE_INVALID", "The input JSON file is empty or exceeds the 4 MiB limit.");
  }
  return resolved;
}

function help() {
  return `Programmable closed launch-plan graph compiler (read-only)\n\nUsage:\n  node scripts/launch-plan-graph.mjs compile <input.json>\n\nThe input explicitly binds either the historical six-file central submission\npackage or the authority-extended seven-file package. Legacy input compiles\nonly to a non-executable extension requirement. Output is deterministic and\ncontent-addressed, but never approval, signing, deployment, registry, wallet,\npermit, execution, or launch authority.\n`;
}
