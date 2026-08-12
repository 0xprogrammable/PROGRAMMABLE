#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalJsonV2 } from "./canonical-json-core.mjs";
import {
  checkCapabilityComposition,
  COMPOSITION_CHECKER_VERSION,
  COMPOSITION_STATUSES
} from "./composition-checker-core.mjs";
import { parseBoundedStrictJsonBytes } from "./strict-json-core.mjs";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;

class CompositionCliError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = "CompositionCliError";
    this.code = code;
  }
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.action === "help") {
    process.stdout.write(help());
  } else if (options.action === "version") {
    process.stdout.write(`${COMPOSITION_CHECKER_VERSION}\n`);
  } else {
    const inputPath = resolveRegularInput(options.inputPath);
    const input = parseBoundedStrictJsonBytes(fs.readFileSync(inputPath), {
      maxSourceBytes: MAX_INPUT_BYTES,
      maxDepth: 128,
      maxNodes: 250_000
    });
    const report = checkCapabilityComposition(input);
    const output = `${canonicalJsonV2(report)}\n`;
    if (options.outputPath !== null) writeNewReport(options.outputPath, output);
    process.stdout.write(output);
    process.exitCode = exitCodeFor(report.status);
  }
} catch (error) {
  const known = error instanceof CompositionCliError;
  process.stdout.write(`${canonicalJsonV2({
    schemaVersion: COMPOSITION_CHECKER_VERSION,
    kind: "programmable-capability-composition-cli-error",
    ok: false,
    error: {
      code: known ? error.code : "COMPOSITION_CHECK_FAILED",
      message: known ? error.message : "The composition checker failed without a safe diagnostic."
    },
    implementationAuthorization: "NOT_GRANTED",
    securityApproval: "NOT_GRANTED",
    deploymentAuthorization: "NOT_GRANTED"
  })}\n`);
  process.exitCode = known ? 2 : 1;
}

function parseArguments(argv) {
  if (argv.length === 0 || (argv.length === 1 && ["--help", "-h"].includes(argv[0]))) return { action: "help" };
  if (argv.length === 1 && argv[0] === "--version") return { action: "version" };
  const options = { action: "check", inputPath: null, outputPath: null };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!["--input", "--output"].includes(name)) throw new CompositionCliError("ARGUMENT_INVALID", `Unknown argument ${name}.`);
    if (seen.has(name)) throw new CompositionCliError("ARGUMENT_DUPLICATE", `${name} may only be provided once.`);
    seen.add(name);
    const value = argv[index + 1];
    if (!value || value.startsWith("-")) throw new CompositionCliError("ARGUMENT_VALUE_MISSING", `${name} requires a path.`);
    index += 1;
    if (name === "--input") options.inputPath = value;
    else options.outputPath = value;
  }
  if (options.inputPath === null) throw new CompositionCliError("INPUT_REQUIRED", "--input <capability-composition.json> is required.");
  return options;
}

function resolveRegularInput(inputPath) {
  const resolved = path.resolve(process.cwd(), inputPath);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new CompositionCliError("INPUT_NOT_FOUND", "The input JSON file does not exist.");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new CompositionCliError("INPUT_NOT_REGULAR", "The input must be a regular non-symlink file.");
  if (stat.size < 1 || stat.size > MAX_INPUT_BYTES) throw new CompositionCliError("INPUT_SIZE_INVALID", "The input is empty or exceeds the 4 MiB limit.");
  return resolved;
}

function writeNewReport(outputPath, contents) {
  const resolved = path.resolve(process.cwd(), outputPath);
  const parent = path.dirname(resolved);
  let parentStat;
  try {
    parentStat = fs.lstatSync(parent);
  } catch {
    throw new CompositionCliError("OUTPUT_PARENT_NOT_FOUND", "The report parent directory must already exist.");
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) throw new CompositionCliError("OUTPUT_PARENT_INVALID", "The report parent must be a real non-symlink directory.");
  if (fs.existsSync(resolved)) throw new CompositionCliError("OUTPUT_EXISTS", "The report path already exists; refusing to overwrite it.");
  try {
    fs.writeFileSync(resolved, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    throw new CompositionCliError("OUTPUT_WRITE_FAILED", `Could not create the report: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function exitCodeFor(status) {
  if (status === COMPOSITION_STATUSES.CANDIDATE) return 0;
  if (status === COMPOSITION_STATUSES.REVIEW) return 3;
  return 1;
}

function help() {
  return `Programmable semantic capability-composition checker (read-only except an optional new report)\n\nUsage:\n  node scripts/composition-checker.mjs --input <capability-composition.json> [--output <new-report.json>]\n  node scripts/composition-checker.mjs --version\n\nInput kind: programmable-capability-composition v1. Output statuses are\nCAPABILITY_CONTRACT_INVALID, COMPOSITION_CONFLICT,\nINDEPENDENT_REVIEW_REQUIRED, or NO_KNOWN_CONFLICT. Exit 0 means only that no\nencoded conflict was found; it never means safe, approved, deployable, audited,\nor live. Review holds exit 3. Invalid input and conflicts exit 1. Existing\noutput files are never overwritten.\n`;
}
