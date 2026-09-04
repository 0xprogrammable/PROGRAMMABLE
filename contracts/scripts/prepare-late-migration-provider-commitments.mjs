#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { lateMigrationEndpointCommitment } from "./late-migration-deployment-stages-core.mjs";

const ENVIRONMENTS = Object.freeze({
  source: "LATE_MIGRATION_ETHEREUM_PRODUCTION_PROVIDERS_JSON",
});

function fail(message) {
  throw new Error(message);
}

export function prepareLateMigrationProviderCommitments({
  argv = process.argv.slice(2),
  env = process.env,
} = {}) {
  if (argv.length !== 1 || !(argv[0] in ENVIRONMENTS)) {
    fail("usage: prepare-late-migration-provider-commitments.mjs <source>");
  }
  const chain = argv[0];
  const environmentName = ENVIRONMENTS[chain];
  let entries;
  try {
    entries = JSON.parse(env[environmentName]);
  } catch {
    fail(`${environmentName} must contain valid secret JSON`);
  }
  if (!Array.isArray(entries) || entries.length < 2 || entries.length > 4) {
    fail(`${environmentName} must contain two to four providers`);
  }
  const providers = entries.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.trustDomain !== "string"
    ) {
      fail(`${environmentName}[${index}] is invalid`);
    }
    return Object.freeze({
      endpointCommitmentSha256: lateMigrationEndpointCommitment({
        headers: entry.headers,
        url: entry.url,
      }),
      id: entry.id,
      trustDomain: entry.trustDomain,
    });
  });
  return Object.freeze({
    schema: "programmable-late-migration-provider-commitments/v1",
    chain,
    secretValuesIncluded: false,
    providers: Object.freeze(providers),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(prepareLateMigrationProviderCommitments(), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `ERROR ${error?.message ?? "commitment preparation failed"}\n`,
    );
    process.exitCode = 1;
  }
}
