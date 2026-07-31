#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const INDEXER_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_REPOSITORY_ROOT = path.resolve(INDEXER_ROOT, "..");

const ARTIFACT_PATHS = Object.freeze({
  configSha256: "indexer/config.yaml",
  schemaSha256: "indexer/schema.graphql",
  handlerSha256: "indexer/src/EventHandlers.ts",
  sourceRegistrySha256: "indexer/src/lib/release-map.ts",
});

const IDENTITY_FIELDS = Object.freeze([
  "deployment",
  "sourceCommit",
  "configSha256",
  "schemaSha256",
  "handlerSha256",
  "sourceRegistrySha256",
  "eventSetSha256",
  "eventCount",
]);

const EXPECTED_CONTRACT_NAMES = Object.freeze([
  "ClassicV2Hook",
  "ClassicV2Launcher",
  "ClassicV3Hook",
  "ClassicV3Launcher",
  "ClassicV3RewardVault",
  "ClassicV3RewardVaultFactory",
  "ClassicV3VestingWalletFactory",
  "StockV1EthCoordinator",
  "StockV1Hook",
  "StockV1Launcher",
  "StockV1RewardVault",
  "StockV1RewardVaultFactory",
  "StockV2EthCoordinator",
  "StockV2Launcher",
  "StockV2V3Hook",
  "StockV2V3RewardVault",
  "StockV2V3RewardVaultFactory",
  "StockV3EthCoordinator",
  "StockV3Launcher",
].sort(compareUtf8));

function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function assertSourceCommit(value) {
  const sourceCommit = value.toString("utf8").trim();
  if (!/^[0-9a-f]{40}$/.test(sourceCommit) || /^0+$/.test(sourceCommit)) {
    throw new Error("SOURCE_COMMIT must be a non-zero lowercase 40-byte hex commit");
  }
  return sourceCommit;
}

function assertExactNames(label, actualNames) {
  const actual = [...actualNames].sort(compareUtf8);
  if (new Set(actual).size !== actual.length) {
    throw new Error(`${label} contains duplicate contract names`);
  }
  if (
    actual.length !== EXPECTED_CONTRACT_NAMES.length ||
    actual.some((name, index) => name !== EXPECTED_CONTRACT_NAMES[index])
  ) {
    throw new Error(
      `${label} must contain only Classic V2/V3 and Stock-Paired V1/V2/V3 contracts`,
    );
  }
}

function eventSetFromConfig(configBytes) {
  const config = parse(configBytes.toString("utf8"));
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("config.yaml must contain a mapping");
  }
  if (!Array.isArray(config.contracts)) {
    throw new Error("config.yaml contracts must be an array");
  }

  assertExactNames(
    "config.yaml contracts",
    config.contracts.map((contract) => contract?.name),
  );

  const events = [];
  for (const contract of config.contracts) {
    if (!Array.isArray(contract.events) || contract.events.length === 0) {
      throw new Error(`${contract.name} must declare at least one event`);
    }
    const localEvents = new Set();
    for (const declaration of contract.events) {
      const event = declaration?.event;
      if (typeof event !== "string" || event.length === 0 || event.trim() !== event) {
        throw new Error(`${contract.name} contains an invalid event signature`);
      }
      if (localEvents.has(event)) {
        throw new Error(`${contract.name} contains a duplicate event signature`);
      }
      localEvents.add(event);
      events.push(event);
    }
  }

  if (!Array.isArray(config.chains) || config.chains.length !== 1) {
    throw new Error("config.yaml must contain exactly one chain");
  }
  const [chain] = config.chains;
  if (chain?.id !== 1 || !Array.isArray(chain.contracts)) {
    throw new Error("config.yaml must contain the Ethereum Mainnet contract set");
  }
  assertExactNames(
    "config.yaml chain contracts",
    chain.contracts.map((contract) => contract?.name),
  );

  const canonicalBytes = Buffer.from(
    `${events.sort(compareUtf8).join("\n")}\n`,
    "utf8",
  );
  return Object.freeze({
    eventSetSha256: sha256(canonicalBytes),
    eventCount: events.length,
  });
}

function createReader(repositoryRoot, gitRef) {
  if (gitRef === undefined) {
    return (relativePath) => readFileSync(path.join(repositoryRoot, relativePath));
  }
  return (relativePath) => {
    try {
      return execFileSync("git", ["show", `${gitRef}:${relativePath}`], {
        cwd: repositoryRoot,
        encoding: "buffer",
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      throw new Error(`cannot read ${relativePath} from git ref ${gitRef}`);
    }
  };
}

function computeIdentity(repositoryRoot, gitRef) {
  const read = createReader(repositoryRoot, gitRef);
  const sourceCommit = assertSourceCommit(read("SOURCE_COMMIT"));
  const configBytes = read(ARTIFACT_PATHS.configSha256);
  const eventSet = eventSetFromConfig(configBytes);

  return Object.freeze({
    deployment: `production-${sourceCommit.slice(0, 7)}`,
    sourceCommit,
    configSha256: sha256(configBytes),
    schemaSha256: sha256(read(ARTIFACT_PATHS.schemaSha256)),
    handlerSha256: sha256(read(ARTIFACT_PATHS.handlerSha256)),
    sourceRegistrySha256: sha256(
      read(ARTIFACT_PATHS.sourceRegistrySha256),
    ),
    ...eventSet,
  });
}

function parseArguments(argv) {
  const options = {
    repositoryRoot: DEFAULT_REPOSITORY_ROOT,
    format: "json",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];
    if (argument === "--root" && value !== undefined) {
      options.repositoryRoot = path.resolve(value);
      index += 1;
    } else if (argument === "--git-ref" && value !== undefined) {
      options.gitRef = value;
      index += 1;
    } else if (argument === "--verify" && value !== undefined) {
      options.verifyPath = path.resolve(value);
      index += 1;
    } else if (argument === "--format" && (value === "json" || value === "env")) {
      options.format = value;
      index += 1;
    } else {
      throw new Error(`unsupported or incomplete argument: ${argument}`);
    }
  }
  return options;
}

function loadVerification(options) {
  if (options.verifyPath === undefined) {
    return undefined;
  }
  const value = JSON.parse(readFileSync(options.verifyPath, "utf8"));
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.identity === null ||
    typeof value.identity !== "object" ||
    Array.isArray(value.identity)
  ) {
    throw new Error("verification manifest must contain an identity object");
  }
  return value;
}

function verifyIdentity(actual, expected) {
  const mismatches = IDENTITY_FIELDS.filter(
    (field) => actual[field] !== expected[field],
  );
  if (mismatches.length > 0) {
    throw new Error(`deployment identity mismatch: ${mismatches.join(", ")}`);
  }
}

function formatEnvironment(identity) {
  return [
    ["ENVIO_DEPLOYMENT_LABEL", identity.deployment],
    ["ENVIO_SOURCE_COMMIT", identity.sourceCommit],
    ["ENVIO_CONFIG_SHA256", identity.configSha256],
    ["ENVIO_SCHEMA_SHA256", identity.schemaSha256],
    ["ENVIO_HANDLER_SHA256", identity.handlerSha256],
    ["ENVIO_SOURCE_REGISTRY_SHA256", identity.sourceRegistrySha256],
    ["ENVIO_EVENT_SET_SHA256", identity.eventSetSha256],
    ["ENVIO_EVENT_COUNT", identity.eventCount],
  ]
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const verification = loadVerification(options);
  const gitRef = options.gitRef ?? verification?.gitRef;
  const identity = computeIdentity(options.repositoryRoot, gitRef);
  if (verification !== undefined) {
    verifyIdentity(identity, verification.identity);
  }
  process.stdout.write(
    `${options.format === "env" ? formatEnvironment(identity) : JSON.stringify(identity, null, 2)}\n`,
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`deployment identity: ${message}\n`);
  process.exitCode = 1;
}
