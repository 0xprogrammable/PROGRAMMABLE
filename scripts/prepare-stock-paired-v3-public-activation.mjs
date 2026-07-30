#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertStockPairedV3ReleaseCheckout } from "./stock-paired-v3-release-core.mjs";
import {
  activatedStockPairedV3Artifacts,
  assertStockPairedV3ActivationEvidence,
  STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE,
} from "./stock-paired-v3-public-activation-core.mjs";

const root = path.resolve(import.meta.dirname, "..");
const PRODUCTION_RC = "fca1e1895363543c4c4d0f7c1d838c891f906c20";
const manifestPath = path.join(
  root,
  "contracts/deployments/mainnet-stock-paired-v3.json",
);
const deploymentEvidencePath = path.join(
  root,
  "contracts/deployments/evidence/stock-paired-v3-mainnet-release.json",
);
const sourcePath = path.join(
  root,
  STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE.path,
);
const write = process.argv.includes("--write");

async function writeAtomic(file, contents) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
}

function run(rootDirectory, command, args) {
  execFileSync(command, args, {
    cwd: rootDirectory,
    stdio: "inherit",
  });
}

function assertActivationInputsCommitted(manifest) {
  const output = execFileSync(
    "git",
    [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      path.relative(root, deploymentEvidencePath),
      STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE.path,
    ],
    {
      cwd: root,
      encoding: "utf8",
    },
  ).trim();
  if (output) {
    throw new Error(
      "Stock-Paired V3 activation gate failed: lifecycle and deployment evidence must be committed before activation",
    );
  }
  const committedManifest = JSON.parse(
    execFileSync(
      "git",
      ["show", `HEAD:${path.relative(root, manifestPath)}`],
      {
        cwd: root,
        encoding: "utf8",
      },
    ),
  );
  const withoutActivationPricing = (value) => {
    const copy = structuredClone(value);
    delete copy.pricePolicy?.finalActivationPricing;
    return copy;
  };
  if (
    JSON.stringify(withoutActivationPricing(committedManifest)) !==
    JSON.stringify(withoutActivationPricing(manifest))
  ) {
    throw new Error(
      "Stock-Paired V3 activation gate failed: uncommitted manifest changes exceed the fresh pricing record",
    );
  }
}

async function main() {
  const [manifest, deploymentEvidence, source] = await Promise.all([
    readFile(manifestPath, "utf8").then(JSON.parse),
    readFile(deploymentEvidencePath, "utf8").then(JSON.parse),
    readFile(sourcePath, "utf8"),
  ]);
  assertStockPairedV3ReleaseCheckout(root, PRODUCTION_RC, {
    allowDescendant: true,
  });
  assertActivationInputsCommitted(manifest);
  assertStockPairedV3ActivationEvidence({ manifest, deploymentEvidence });
  if (
    !source.includes(STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE.before) ||
    source.includes(STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE.after)
  ) {
    throw new Error(
      "Stock-Paired V3 activation gate failed: the app switch is not in the reviewed disabled state",
    );
  }

  run(root, process.execPath, [
    "contracts/scripts/verify-stock-paired-v3-final-pricing.mjs",
  ]);

  const activated = activatedStockPairedV3Artifacts({
    manifest,
    deploymentEvidence,
  });
  const activatedSource = source.replace(
    STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE.before,
    STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE.after,
  );
  const changedPaths = [
    "contracts/deployments/mainnet-stock-paired-v3.json",
    "contracts/deployments/evidence/stock-paired-v3-mainnet-release.json",
    STOCK_PAIRED_V3_ACTIVATION_SOURCE_CHANGE.path,
  ];

  if (write) {
    await Promise.all([
      writeAtomic(
        manifestPath,
        `${JSON.stringify(activated.manifest, null, 2)}\n`,
      ),
      writeAtomic(
        deploymentEvidencePath,
        `${JSON.stringify(activated.deploymentEvidence, null, 2)}\n`,
      ),
      writeAtomic(sourcePath, activatedSource),
    ]);
  }

  console.log(
    JSON.stringify(
      {
        mode: write ? "write" : "dry-run",
        externalAction: false,
        network: "Ethereum Mainnet",
        internalContractRelease: "stock-paired-v3",
        publicModel: "Stock-Paired",
        changedPaths,
        next: write
          ? "Run the focused tests, typecheck, production build and rendered browser QA before committing. Deployment and publication remain separate."
          : "All gates passed. Re-run with --write to create the local three-file activation diff.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
