#!/usr/bin/env node

import { evaluateAlchemyExploreSourceContracts } from "./alchemy-explore-source-contracts.mjs";

function output(value, exitCode) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

try {
  const rootDirectory = process.cwd();
  const source = evaluateAlchemyExploreSourceContracts(rootDirectory);
  output(
    {
      schemaVersion: 1,
      profileId: "alchemy-explore-source-v1",
      mode: "alchemy-only-contract-smoke",
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
      mode: "alchemy-only-contract-smoke",
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
