#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseReadModelLoadProfile } from "./read-model-gate-core.mjs";
import { evaluateReadModelSourceContracts } from "./read-model-source-contracts.mjs";

function output(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

try {
  const rootDirectory = process.cwd();
  const profile = parseReadModelLoadProfile(
    JSON.parse(
      readFileSync(
        resolve(rootDirectory, "config/read-model-load-profile.v1.json"),
        "utf8",
      ),
    ),
  );
  const source = evaluateReadModelSourceContracts(rootDirectory, profile);
  output(
    {
      schemaVersion: 1,
      profileId: profile.profileId,
      mode: "contract-smoke",
      contractValid: source.ok,
      releaseEvidenceAccepted: false,
      checks: source.checks,
      failures: source.failures,
    },
    source.ok ? 0 : 1,
  );
} catch (error) {
  output(
    {
      schemaVersion: 1,
      mode: "contract-smoke",
      contractValid: false,
      releaseEvidenceAccepted: false,
      checks: [],
      failures: [
        {
          id: "smoke-input",
          detail: error instanceof Error ? error.message : "invalid input",
        },
      ],
    },
    1,
  );
}
