#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listExampleIds,
  materializeExample,
  serializeSubmission
} from "./example-materializer-core.mjs";

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  if (options.list) {
    process.stdout.write(`${listExampleIds(skillRoot).join("\n")}\n`);
    process.exit(0);
  }

  if (!options.exampleId) {
    throw new Error("Provide --example <id>, or use --list.");
  }

  const submission = materializeExample({
    skillRoot,
    exampleId: options.exampleId,
    stepId: options.stepId
  });
  const output = serializeSubmission(submission);

  if (options.outputPath) {
    fs.writeFileSync(path.resolve(options.outputPath), output, { encoding: "utf8" });
  } else {
    process.stdout.write(output);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseArguments(args) {
  const options = {
    help: false,
    list: false,
    exampleId: null,
    stepId: null,
    outputPath: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--list") {
      options.list = true;
      continue;
    }
    if (["--example", "--step", "--output"].includes(argument)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${argument} requires a value.`);
      }
      if (argument === "--example") options.exampleId = value;
      if (argument === "--step") options.stepId = value;
      if (argument === "--output") options.outputPath = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if ((options.help || options.list) && (options.exampleId || options.stepId || options.outputPath)) {
    throw new Error("--help and --list cannot be combined with materialization arguments.");
  }
  return options;
}

function usage() {
  return [
    "Usage: materialize-example.mjs --example <id> [--step <id>] [--output <path>]",
    "       materialize-example.mjs --list",
    "",
    "Materialize one packaged scenario patch as a complete schema-valid submission.",
    "",
    "Options:",
    "  --example <id>   Select a packaged example.",
    "  --step <id>      Stop after this step. Defaults to the final step.",
    "  --output <path>  Write JSON to a file. Defaults to stdout.",
    "  --list           List packaged example ids.",
    "  -h, --help       Show this help.",
    ""
  ].join("\n");
}
