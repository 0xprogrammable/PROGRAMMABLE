#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  prepareLateMigrationOwnerHandoff,
  providersFromConfig,
  runLateMigrationDeploymentPreflight,
} from "./late-migration-deployment-preflight-core.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const forbiddenArguments = [
  "--broadcast",
  "--fund",
  "--mnemonic",
  "--private-key",
  "--send",
  "--sign",
];

function fail(message) {
  throw new Error(message);
}

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, relativePath), "utf8"),
  );
}

function assertSafeArguments(argv) {
  for (const argument of argv) {
    const normalized = argument.split("=", 1)[0];
    if (forbiddenArguments.includes(normalized)) {
      fail(`${normalized} is forbidden; this tool never signs or broadcasts`);
    }
  }
}

export async function runLateMigrationDeploymentCli({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  assertSafeArguments(argv);
  const command = argv[0] ?? "check";
  if (argv.length > 1 || !["check", "prepare"].includes(command)) {
    fail("usage: prepare-late-migration-deployment.mjs [check|prepare]");
  }
  const preflight = await readJson(
    "config/late-migration-deployment-preflight.v1.json",
  );
  const [activation, eligibility] = await Promise.all([
    readJson(preflight.activationConfigPath),
    readJson(preflight.eligibilityConfigPath),
  ]);
  const sourceProviders = providersFromConfig(preflight.sourceChain, env);
  const receipt = await runLateMigrationDeploymentPreflight({
    activation,
    eligibility,
    preflight,
    sourceProviders,
    includePendingNonces: command === "prepare",
  });
  if (command === "check") return receipt;

  const sourceArtifact = await readJson(
    preflight.ownerHandoff.sourceArtifactPath,
  );
  return prepareLateMigrationOwnerHandoff({
    activation,
    eligibility,
    sourceProviders,
    artifacts: { source: sourceArtifact },
    preflight,
    preflightReceipt: receipt,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLateMigrationDeploymentCli()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`ERROR ${error?.message ?? "preflight failed"}\n`);
      process.exitCode = 1;
    });
}
