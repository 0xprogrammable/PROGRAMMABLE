#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { safeFailure } from "./hosted-db-operator-core.mjs";

export const HELP = `Historical candidate cutover retired.

The production-7f24e63 candidate procedure is not an authority for the current
production release. No mutation command is available through this operator.
Use docs/operations/read-model-scheduler-cutover.md for the canonical staged
release procedure for https://programmable.market.
`;

export function parseArguments(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    return { command: "help", flags: new Map() };
  }
  if (rest.length % 2 !== 0) throw new Error("operator arguments are invalid");
  const flags = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith("--") || !value || value.startsWith("--") || flags.has(name)) {
      throw new Error("operator arguments are invalid");
    }
    flags.set(name, value);
  }
  return { command, flags };
}

export async function main(argv = process.argv.slice(2), environment = process.env) {
  const { command } = parseArguments(argv);
  if (command === "help") {
    process.stdout.write(HELP);
    return null;
  }
  void environment;
  throw new Error(
    "historical candidate cutover is retired; use the canonical read-model release procedure",
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${safeFailure(error)}\n`);
    process.exitCode = 1;
  });
}
