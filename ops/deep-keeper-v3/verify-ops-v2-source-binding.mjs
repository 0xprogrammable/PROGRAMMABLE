#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { computeDeepV3OpsV2SourceCommitment } from "./source-commitment-v2.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const binding = JSON.parse(
  readFileSync(
    path.join(
      root,
      "ops/deep-keeper-v3/ops-v2-source-binding.json",
    ),
    "utf8",
  ),
);
const expected = computeDeepV3OpsV2SourceCommitment(root);

if (
  binding?.schemaVersion !== 1 ||
  binding.keeperReleaseVersion !== "deep-keeper-v3-ops-v2" ||
  binding.opsSourceCommitment !== expected
) {
  throw new Error(
    `Deep V3 ops v2 build source binding drift: ${binding?.opsSourceCommitment ?? "missing"}/${expected}`,
  );
}

console.log(`Deep V3 ops v2 source binding verified: ${expected}`);
