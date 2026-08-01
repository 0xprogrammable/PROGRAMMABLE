#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const INDEXER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASES = Object.freeze([
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
]);
const MODELS = Object.freeze({
  "classic-v2": "classic",
  "classic-v3": "classic",
  "stock-paired-v1": "stock-paired",
  "stock-paired-v2": "stock-paired",
  "stock-paired-v3": "stock-paired",
});
const EXPECTED_CONTRACTS = Object.freeze([
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

const ARTIFACTS = Object.freeze({
  configSha256: "config.yaml",
  schemaSha256: "schema.graphql",
  handlerSha256: "src/EventHandlers.ts",
  sourceRegistrySha256: "src/lib/release-map.ts",
});

function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function exactCommit(value) {
  if (!/^[0-9a-f]{40}$/u.test(value ?? "") || /^0+$/u.test(value)) {
    throw new Error("source commit must be a non-zero lowercase 40-character Git SHA");
  }
  return value;
}

function exactUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash) {
    throw new Error("endpoint must be a credential-free HTTPS URL");
  }
  return parsed.toString();
}

function exactNames(label, names) {
  const sorted = [...names].sort(compareUtf8);
  if (
    sorted.length !== EXPECTED_CONTRACTS.length ||
    new Set(sorted).size !== sorted.length ||
    sorted.some((name, index) => name !== EXPECTED_CONTRACTS[index])
  ) {
    throw new Error(`${label} must be the exact reviewed 19-contract scope`);
  }
}

function localIdentity(sourceCommit) {
  const configBytes = readFileSync(path.join(INDEXER_ROOT, ARTIFACTS.configSha256));
  const config = parse(configBytes.toString("utf8"));
  if (!Array.isArray(config?.contracts) || !Array.isArray(config?.chains)) {
    throw new Error("config.yaml is missing the reviewed contract registry");
  }
  if (
    config.chains.length !== 1 ||
    config.chains[0]?.id !== 1 ||
    config.chains[0]?.block_lag !== 12 ||
    config.chains[0]?.max_reorg_depth !== 200
  ) {
    throw new Error("config.yaml must retain the reviewed Ethereum finality policy");
  }
  exactNames("ABI registry", config.contracts.map((entry) => entry?.name));
  exactNames("chain registry", config.chains[0].contracts?.map((entry) => entry?.name) ?? []);

  const events = [];
  for (const contract of config.contracts) {
    if (!Array.isArray(contract.events) || contract.events.length === 0) {
      throw new Error(`${contract.name} has no events`);
    }
    const local = new Set();
    for (const declaration of contract.events) {
      const event = declaration?.event;
      if (typeof event !== "string" || event.length === 0 || event.trim() !== event) {
        throw new Error(`${contract.name} has an invalid event signature`);
      }
      if (local.has(event)) throw new Error(`${contract.name} repeats an event signature`);
      local.add(event);
      events.push(event);
    }
  }
  const eventSet = Buffer.from(`${events.sort(compareUtf8).join("\n")}\n`, "utf8");
  const identity = {
    deployment: `production-${sourceCommit.slice(0, 7)}`,
    sourceCommit,
    configSha256: sha256(configBytes),
    schemaSha256: sha256(readFileSync(path.join(INDEXER_ROOT, ARTIFACTS.schemaSha256))),
    handlerSha256: sha256(readFileSync(path.join(INDEXER_ROOT, ARTIFACTS.handlerSha256))),
    sourceRegistrySha256: sha256(
      readFileSync(path.join(INDEXER_ROOT, ARTIFACTS.sourceRegistrySha256)),
    ),
    eventSetSha256: sha256(eventSet),
    eventCount: events.length,
  };
  return Object.freeze(identity);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`invalid argument ${key ?? ""}`.trim());
    }
    values[key.slice(2)] = value;
  }
  return { command, values };
}

async function graphql(endpoint, query, variables = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GraphQL returned HTTP ${response.status}`);
    const value = await response.json();
    if (Array.isArray(value.errors) && value.errors.length > 0) {
      throw new Error(`GraphQL rejected the candidate audit: ${value.errors[0]?.message}`);
    }
    return value.data;
  } finally {
    clearTimeout(timer);
  }
}

const PROGRESS_QUERY = `
  query ProgrammableReleaseCandidateProgress {
    _meta(where: { chainId: { _eq: 1 } }) {
      chainId progressBlock bufferBlock sourceBlock isReady eventsProcessed
    }
    IndexerState_by_pk(id: "ethereum-mainnet") {
      id schemaVersion deployment sourceCommit configSha256 schemaSha256
      handlerSha256 sourceRegistrySha256 eventSetSha256 eventCount chainId
      progressBlock progressBlockHash progressTimestamp progressTransactionHash
      progressOccurrenceId
    }
  }
`;

const INVENTORY_QUERY = `
  query ProgrammableReleaseCandidateInventory($afterId: String!, $first: Int!) {
    Launch(
      where: { id: { _gt: $afterId } }
      order_by: [{ id: asc }]
      limit: $first
    ) {
      id chainId model releaseVersion launchHash token creator quoteAsset poolId hook
      rewardVault positionRecipient positionTokenId totalSwapFeeBps buySwapFeeBps
      sellSwapFeeBps rewardConfigurationHash quoteConfigurationHash
      launchOccurrenceId liquidityOccurrenceId initialBuyOccurrenceId
      custodyOccurrenceId coordinatorOccurrenceId hasLaunchEvent hasLiquidityEvent
      hasInitialBuyEvent hasCustodyEvent hasCoordinatorEvent
      hasPoolRegistrationEvent hasPoolFeeDisclosureEvent
      hasRewardVaultFactoryEvent provenanceValid isComplete updatedBlock
    }
  }
`;

function sameIdentity(actual, expected) {
  for (const key of Object.keys(expected)) {
    if (actual?.[key] !== expected[key]) {
      throw new Error(`candidate IndexerState identity mismatch at ${key}`);
    }
  }
}

async function auditCandidate(endpoint, expected) {
  const progress = await graphql(endpoint, PROGRESS_QUERY);
  if (!Array.isArray(progress?._meta) || progress._meta.length !== 1) {
    throw new Error("candidate returned an invalid Ethereum _meta row");
  }
  const meta = progress._meta[0];
  if (meta.chainId !== 1 || meta.isReady !== true) {
    throw new Error("candidate is not ready on Ethereum Mainnet");
  }
  if (progress.IndexerState_by_pk?.schemaVersion !== "1") {
    throw new Error("candidate IndexerState schema is not v1");
  }
  sameIdentity(progress.IndexerState_by_pk, expected);

  const launches = [];
  let afterId = "";
  for (;;) {
    const page = await graphql(endpoint, INVENTORY_QUERY, { afterId, first: 250 });
    const rows = page?.Launch;
    if (!Array.isArray(rows)) throw new Error("candidate inventory page is invalid");
    if (rows.length === 0) break;
    for (const row of rows) {
      if (row.id <= afterId) throw new Error("candidate inventory is not strictly ordered");
      launches.push(row);
      afterId = row.id;
    }
    if (rows.length < 250) break;
  }
  if (launches.length === 0) throw new Error("candidate inventory is empty");

  const ids = new Set();
  const tokens = new Set();
  const launchHashes = new Set();
  const perRelease = Object.fromEntries(RELEASES.map((release) => [release, 0]));
  for (const row of launches) {
    if (!RELEASES.includes(row.releaseVersion) || row.model !== MODELS[row.releaseVersion]) {
      throw new Error(`unsupported release in candidate inventory: ${row.releaseVersion}`);
    }
    if (row.chainId !== 1 || row.provenanceValid !== true || row.isComplete !== true) {
      throw new Error(`incomplete or invalid launch ${row.id}`);
    }
    if (!row.token || !row.launchOccurrenceId || !row.liquidityOccurrenceId || !row.initialBuyOccurrenceId) {
      throw new Error(`launch ${row.id} is missing required identity evidence`);
    }
    if (ids.has(row.id) || tokens.has(row.token) || launchHashes.has(row.launchHash)) {
      throw new Error(`duplicate launch identity in candidate inventory: ${row.id}`);
    }
    ids.add(row.id);
    tokens.add(row.token);
    launchHashes.add(row.launchHash);
    perRelease[row.releaseVersion] += 1;
  }
  for (const release of RELEASES) {
    if (perRelease[release] === 0) throw new Error(`candidate has no ${release} launches`);
  }

  const canonical = Buffer.from(`${launches.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return {
    schemaVersion: 1,
    kind: "envio-release-inventory",
    endpoint,
    identity: expected,
    anchor: {
      progressBlock: String(meta.progressBlock),
      bufferBlock: String(meta.bufferBlock),
      sourceBlock: String(meta.sourceBlock),
      eventsProcessed: String(meta.eventsProcessed),
      stateProgressBlock: String(progress.IndexerState_by_pk.progressBlock),
      stateProgressBlockHash: progress.IndexerState_by_pk.progressBlockHash,
      stateProgressOccurrenceId: progress.IndexerState_by_pk.progressOccurrenceId,
    },
    inventory: {
      count: launches.length,
      perRelease,
      sha256: sha256(canonical),
    },
  };
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (command === "identity") {
    const identity = localIdentity(exactCommit(values["source-commit"]));
    process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
    return;
  }
  if (command === "audit") {
    const endpoint = exactUrl(values.endpoint);
    const identityPath = values.identity;
    if (!identityPath) throw new Error("--identity is required");
    const expected = JSON.parse(readFileSync(path.resolve(identityPath), "utf8"));
    const evidence = await auditCandidate(endpoint, expected);
    const output = `${JSON.stringify(evidence, null, 2)}\n`;
    if (values.output) writeFileSync(path.resolve(values.output), output, { flag: "wx" });
    else process.stdout.write(output);
    return;
  }
  throw new Error("usage: release-candidate.mjs identity|audit [...options]");
}

main().catch((error) => {
  process.stderr.write(`Envio release candidate: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
