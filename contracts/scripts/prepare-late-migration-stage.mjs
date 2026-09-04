#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendLateMigrationStageTransaction,
  createLateMigrationStageJournal,
  deriveDisabledLateMigrationActivationManifest,
  lateMigrationStageProvidersFromConfig,
  prepareDepositActivation,
  productionProvidersFromEnvironment,
  unwrapLateMigrationStageJournal,
  verifyLateMigrationStageContext,
} from "./late-migration-deployment-stages-core.mjs";
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const COMMANDS = {
  "verify-source": 2,
  "prepare-activate": 2,
  "verify-activation": 3,
};
async function readJson(input) {
  return JSON.parse(
    await readFile(
      path.isAbsolute(input) ? input : path.join(repositoryRoot, input),
      "utf8",
    ),
  );
}
export async function runLateMigrationStageCli({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  if (argv.some((argument) => argument.startsWith("--")))
    throw new Error(
      "Options are forbidden; this tool never signs, sends, funds, writes, or broadcasts.",
    );
  const command = argv[0];
  if (!(command in COMMANDS) || argv.length !== COMMANDS[command])
    throw new Error(
      "usage: prepare-late-migration-stage.mjs <verify-source tx-hash|prepare-activate journal.json|verify-activation journal.json tx-hash>",
    );
  const preflight = await readJson(
    "config/late-migration-deployment-preflight.v1.json",
  );
  const [activation, eligibility, source] = await Promise.all([
    readJson(preflight.activationConfigPath),
    readJson(preflight.eligibilityConfigPath),
    readJson(preflight.ownerHandoff.sourceArtifactPath),
  ]);
  const production = command !== "verify-source";
  const sourceSet = production
    ? productionProvidersFromEnvironment({
        env,
        policy: preflight.activationProviderPolicy,
      })
    : null;
  const sourceProviders =
    sourceSet?.providers ??
    lateMigrationStageProvidersFromConfig(preflight.sourceChain, env);
  let journal =
    command === "verify-source"
      ? createLateMigrationStageJournal(argv[1])
      : unwrapLateMigrationStageJournal(await readJson(argv[1]));
  if (command === "verify-activation")
    journal = appendLateMigrationStageTransaction(
      journal,
      "depositActivation",
      argv[2],
    );
  const context = await verifyLateMigrationStageContext({
    activation,
    artifacts: { source },
    eligibility,
    preflight,
    journal,
    sourceProviders,
    productionProviderSets: sourceSet ? { source: sourceSet } : null,
    requireProductionActivationProviders: production,
  });
  if (command === "prepare-activate")
    return prepareDepositActivation({
      context,
      preflight,
      providers: sourceProviders,
    });
  if (command === "verify-activation")
    return {
      ...context,
      disabledActivationCandidate:
        deriveDisabledLateMigrationActivationManifest({ activation, context }),
    };
  return context;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runLateMigrationStageCli()
    .then((result) =>
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`),
    )
    .catch((error) => {
      process.stderr.write(`ERROR ${error?.message ?? "stage failed"}\n`);
      process.exitCode = 1;
    });
}
