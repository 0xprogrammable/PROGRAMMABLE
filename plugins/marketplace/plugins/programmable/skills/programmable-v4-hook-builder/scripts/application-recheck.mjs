#!/usr/bin/env node

import process from "node:process";
import {
  APPLICATION_RECHECK_SCHEMA_VERSION,
  ApplicationRecheckError,
  applicationRecheckDryRun
} from "./open-world-migration-core.mjs";
import { canonicalJson } from "./submission-core.mjs";

const HELP = `Usage:
  node application-recheck.mjs --application-package <directory> --source-repository <directory> [options]

Read-only migration recheck for one historical six-file application package. It verifies exact local package and
source bindings, preserves the historical declared result, and emits an unmaterialized open-world target preview.
It never edits the v1.6 submission, writes files, accesses the network, submits an application, or changes approval.

Options:
  --application-package <directory>       Historical directory containing exactly the six application files.
  --source-repository <directory>         Exact local Git checkout at application.json's bound commit and tree.
  --expected-package-sha256 <sha256:...>  Optional package digest pin; mismatch fails closed.
  --dry-run                               Accepted for explicitness; this command is always dry-run and read-only.
  -h, --help                              Show this help message.
`;

function main(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(HELP);
    return 0;
  }
  const options = parseArguments(argv);
  const result = applicationRecheckDryRun({
    applicationPackageDirectory: options.applicationPackage,
    sourceRepositoryRoot: options.sourceRepository,
    expectedPackageSha256: options.expectedPackageSha256
  });
  process.stdout.write(`${canonicalJson(result)}\n`);
  return 0;
}

function parseArguments(argv) {
  if (!Array.isArray(argv)) usage("arguments must be an array");
  const definitions = new Map([
    ["--application-package", { key: "applicationPackage", type: "value" }],
    ["--source-repository", { key: "sourceRepository", type: "value" }],
    ["--expected-package-sha256", { key: "expectedPackageSha256", type: "value" }],
    ["--dry-run", { key: "dryRun", type: "boolean" }]
  ]);
  const options = {
    applicationPackage: null,
    sourceRepository: null,
    expectedPackageSha256: null,
    dryRun: false
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const separator = token.indexOf("=");
    const name = separator === -1 ? token : token.slice(0, separator);
    const definition = definitions.get(name);
    if (definition === undefined) usage(`unknown option ${name}`);
    if (seen.has(name)) usage(`option ${name} may only be used once`);
    seen.add(name);
    if (definition.type === "boolean") {
      if (separator !== -1) usage(`option ${name} does not accept a value`);
      options[definition.key] = true;
      continue;
    }
    const value = separator === -1 ? argv[index + 1] : token.slice(separator + 1);
    if (separator === -1) index += 1;
    if (typeof value !== "string" || value.length < 1 || value.startsWith("--")) {
      usage(`option ${name} requires a value`);
    }
    options[definition.key] = value;
  }
  if (options.applicationPackage === null) usage("missing --application-package");
  if (options.sourceRepository === null) usage("missing --source-repository");
  return options;
}

function usage(message) {
  throw new ApplicationRecheckError("USAGE_ERROR", message);
}

function safeFailure(error) {
  if (error instanceof ApplicationRecheckError) return error;
  return new ApplicationRecheckError(
    "APPLICATION_RECHECK_FAILED",
    "the read-only application recheck failed without a safe diagnostic"
  );
}

try {
  process.exitCode = main();
} catch (error) {
  const failure = safeFailure(error);
  const payload = {
    kind: "application-recheck-error",
    schemaVersion: APPLICATION_RECHECK_SCHEMA_VERSION,
    ok: false,
    error: {
      code: failure.code,
      message: failure.message
    },
    dryRun: true,
    writePerformed: false,
    networkAccessed: false,
    externalActionsPerformed: []
  };
  if (failure.details !== null) payload.error.details = failure.details;
  process.stdout.write(`${canonicalJson(payload)}\n`);
  process.exitCode = failure.exitCode;
}
