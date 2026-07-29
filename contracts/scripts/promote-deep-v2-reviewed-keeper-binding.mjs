#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEEP_V2_MANIFEST_PATH,
  DEEP_V2_REVIEWED_BINDING_PATH,
  computeDeepV2KeeperExecutorIdentity,
} from "./deep-full-range-release-v2-core.mjs";

if (!process.argv.includes("--write")) {
  throw new Error(
    "Keeper binding promotion is explicit. Re-run with --write after reviewing the final live release.",
  );
}
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const verifier = path.join(
  root,
  "contracts/scripts/verify-deep-full-range-release-v2-manifest.mjs",
);
const verification = spawnSync(
  process.execPath,
  [verifier, "--require-live"],
  { cwd: root, encoding: "utf8", env: process.env },
);
process.stdout.write(verification.stdout ?? "");
process.stderr.write(verification.stderr ?? "");
if (verification.status !== 0) {
  throw new Error(
    "Reviewed keeper binding cannot be promoted before the live release verifier passes",
  );
}

const manifest = JSON.parse(
  await readFile(path.join(root, DEEP_V2_MANIFEST_PATH), "utf8"),
);
const keeperIdentity = computeDeepV2KeeperExecutorIdentity(
  root,
  manifest.addresses.automation,
  manifest.runtimeCodeHashes.automation,
);
if (
  keeperIdentity.runtimeCodeHash !==
    manifest.lifecycleEvidence.keeperExecutorRuntimeCodeHash ||
  keeperIdentity.sourceCommitment !==
    manifest.keeperPolicy.coordinatorSourceCommitment
) {
  throw new Error("Keeper executor identity differs from the final manifest");
}

const binding = {
  schemaVersion: 1,
  status: "reviewed",
  manifestPath: DEEP_V2_MANIFEST_PATH,
  model: "deep",
  releaseVersion: "deep-full-range-v2",
  internalContractRelease: "liquidity-growth-full-range-v2",
  sourceCommitment: manifest.sourceCommitment,
  automationAddress: manifest.addresses.automation,
  automationRuntimeCodeHash: manifest.runtimeCodeHashes.automation,
  automationFqcn:
    "src/LiquidityGrowthFullRangeAutomationV2.sol:LiquidityGrowthFullRangeAutomationV2",
  coordinatorAddress: manifest.lifecycleEvidence.keeperExecutor,
  coordinatorRuntimeCodeHash:
    manifest.lifecycleEvidence.keeperExecutorRuntimeCodeHash,
  coordinatorSourceCommitment: keeperIdentity.sourceCommitment,
  coordinatorFqcn:
    "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1",
};
const target = path.join(root, DEEP_V2_REVIEWED_BINDING_PATH);
await writeFile(target, `${JSON.stringify(binding, null, 2)}\n`);
console.log(`Promoted reviewed Deep V2 keeper binding at ${target}`);
