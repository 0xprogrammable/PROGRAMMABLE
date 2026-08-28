#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import {
  CLASSIC_V4_DIGEST_DOMAINS,
  digestJson,
} from "./classic-v4-digest.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const INDEXER_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const REPOSITORY_ROOT = path.resolve(INDEXER_ROOT, "..");
const ENVIO_HOST = "indexer.hyperindex.xyz";
const ENVIO_OWNER = "0xprogrammable";
const ENVIO_PROJECT = "programmable-indexer";
const HISTORICAL_RELEASES = Object.freeze([
  "classic-v2",
  "classic-v3",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
]);
const SUPPORTED_RELEASES = Object.freeze([
  ...HISTORICAL_RELEASES,
  "classic-v4",
]);
const MODELS = Object.freeze({
  "classic-v2": "classic",
  "classic-v3": "classic",
  "classic-v4": "classic",
  "stock-paired-v1": "stock-paired",
  "stock-paired-v2": "stock-paired",
  "stock-paired-v3": "stock-paired",
});
const STOCK_COORDINATOR_SOURCES = Object.freeze({
  "stock-paired-v1": "0xfa5f17389ca28d071781d59750b32c842ab6a54b",
  "stock-paired-v2": "0xfb9e1034df6161088e8f358502b19e7515c30fd2",
  "stock-paired-v3": "0xddc3abbab0df7f1189310a4f70e7e365796b74e2",
});
const LIVE_ENVIO_SURFACE_REFERENCE = Object.freeze({
  relativePath: "live-production-92f6373.config.yaml",
  deployment: "production-92f6373",
  sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
  configSha256:
    "0x133099a107e8d9c91aea1f0e811dbcc179fae8cf35919e612df7139deab3ee6a",
  eventSetSha256:
    "0xe5a88608068d4c84582cc63de55cbf386fa7f36b201722a39164eb4af61de95f",
  eventCount: 66,
});
const BASE_CHAIN_CONTRACTS = Object.freeze([
  "ClassicV2Hook",
  "ClassicV2Launcher",
  "ClassicV3Hook",
  "ClassicV3Launcher",
  "ClassicV3RewardVault",
  "ClassicV3RewardVaultFactory",
  "ClassicV3VestingWalletFactory",
  "CustomAtomicRegistrarV1",
  "CustomPartnerFactoryRegistryV1",
  "CustomRegistryV1",
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
const EXPECTED_ABI_CONTRACTS = Object.freeze([
  ...BASE_CHAIN_CONTRACTS,
  "ClassicV4Hook",
  "ClassicV4Launcher",
].sort(compareUtf8));
const ACTIVATED_CHAIN_CONTRACTS = EXPECTED_ABI_CONTRACTS;

const ARTIFACTS = Object.freeze({
  configSha256: "config.yaml",
  schemaSha256: "schema.graphql",
  handlerSha256: "src/EventHandlers.ts",
  sourceRegistrySha256: "src/lib/release-map.ts",
});
const IDENTITY_KEYS = Object.freeze([
  "deployment",
  "sourceCommit",
  "configSha256",
  "schemaSha256",
  "handlerSha256",
  "sourceRegistrySha256",
  "eventSetSha256",
  "eventCount",
]);
const LAUNCH_FIELDS = Object.freeze([
  "id",
  "chainId",
  "model",
  "releaseVersion",
  "launchHash",
  "token",
  "creator",
  "quoteAsset",
  "poolId",
  "hook",
  "rewardVault",
  "positionRecipient",
  "positionTokenId",
  "totalSwapFeeBps",
  "buySwapFeeBps",
  "sellSwapFeeBps",
  "rewardConfigurationHash",
  "quoteConfigurationHash",
  "totalSupply",
  "tokenLiquidityAmount",
  "lockedTokenDust",
  "initialTick",
  "tickLower",
  "tickUpper",
  "lpFeePips",
  "initialBuyQuoteAmount",
  "initialBuyTokenAmount",
  "initialBuyEthAmount",
  "launchOccurrenceId",
  "liquidityOccurrenceId",
  "initialBuyOccurrenceId",
  "custodyOccurrenceId",
  "coordinatorOccurrenceId",
  "hasLaunchEvent",
  "hasLiquidityEvent",
  "hasInitialBuyEvent",
  "hasCustodyEvent",
  "hasCoordinatorEvent",
  "hasPoolRegistrationEvent",
  "hasPoolFeeDisclosureEvent",
  "hasRewardVaultFactoryEvent",
  "provenanceValid",
  "isComplete",
  "updatedBlock",
]);
const STABLE_LAUNCH_FIELDS = Object.freeze(
  LAUNCH_FIELDS.filter(
    (field) => !["provenanceValid", "isComplete", "updatedBlock"].includes(field),
  ),
);
const BOOLEAN_LAUNCH_FIELDS = Object.freeze([
  "hasLaunchEvent",
  "hasLiquidityEvent",
  "hasInitialBuyEvent",
  "hasCustodyEvent",
  "hasCoordinatorEvent",
  "hasPoolRegistrationEvent",
  "hasPoolFeeDisclosureEvent",
  "hasRewardVaultFactoryEvent",
  "provenanceValid",
  "isComplete",
]);
const ADDRESS_LAUNCH_FIELDS = Object.freeze([
  "token",
  "creator",
  "quoteAsset",
  "hook",
  "rewardVault",
  "positionRecipient",
]);
const BYTES32_LAUNCH_FIELDS = Object.freeze([
  "launchHash",
  "poolId",
  "rewardConfigurationHash",
  "quoteConfigurationHash",
]);
const UINT_LAUNCH_FIELDS = Object.freeze([
  "positionTokenId",
  "totalSupply",
  "tokenLiquidityAmount",
  "lockedTokenDust",
  "initialBuyQuoteAmount",
  "initialBuyTokenAmount",
  "initialBuyEthAmount",
]);
const INT_LAUNCH_FIELDS = Object.freeze([
  "totalSwapFeeBps",
  "buySwapFeeBps",
  "sellSwapFeeBps",
  "initialTick",
  "tickLower",
  "tickUpper",
  "lpFeePips",
]);
const OCCURRENCE_LAUNCH_FIELDS = Object.freeze([
  "launchOccurrenceId",
  "liquidityOccurrenceId",
  "initialBuyOccurrenceId",
  "custodyOccurrenceId",
  "coordinatorOccurrenceId",
]);

function compareUtf8(left, right) {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}

function sha256(value) {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

function releaseBindingDigest(value) {
  return digestJson(value, CLASSIC_V4_DIGEST_DOMAINS.releaseBinding);
}

function exactObject(value, label, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort(compareUtf8);
  const expected = [...keys].sort(compareUtf8);
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}`);
  }
  return value;
}

function exactString(value, label, pattern, maximum = 512) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    !pattern.test(value)
  ) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function exactCommit(value, label = "source commit") {
  return exactString(
    value,
    label,
    /^(?!0{40}$)[0-9a-f]{40}$/u,
    40,
  );
}

function exactSha256(value, label) {
  return exactString(value, label, /^0x[0-9a-f]{64}$/u, 66);
}

function exactAddress(value, label) {
  return exactString(value, label, /^0x[0-9a-f]{40}$/u, 42);
}

function exactBytes32(value, label) {
  return exactString(value, label, /^0x[0-9a-f]{64}$/u, 66);
}

function exactNullable(value, parser) {
  return value === null ? null : parser(value);
}

function exactSafeInteger(value, label, minimum = Number.MIN_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer`);
  }
  return value;
}

function exactUint(value, label) {
  if (typeof value === "number") {
    return String(exactSafeInteger(value, label, 0));
  }
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`${label} must be an unsigned decimal integer`);
  }
  return value;
}

function exactTimestamp(value, label) {
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function endpointIdFromUrl(value, expectedEndpointId) {
  if (typeof value !== "string" || value.length > 256) {
    throw new Error("endpoint must be the reviewed Envio GraphQL endpoint");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("endpoint must be the reviewed Envio GraphQL endpoint");
  }
  const match = /^\/([a-z0-9]{7,64})\/v1\/graphql$/u.exec(parsed.pathname);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== ENVIO_HOST ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.toString() !== value ||
    match === null ||
    (expectedEndpointId !== undefined && match[1] !== expectedEndpointId)
  ) {
    throw new Error("endpoint must be the reviewed Envio GraphQL endpoint");
  }
  return match[1];
}

function exactEndpointId(value) {
  return exactString(value, "Envio endpoint id", /^[a-z0-9]{7,64}$/u, 64);
}

function exactNames(label, names, expectedNames) {
  const sorted = [...names].sort(compareUtf8);
  if (
    sorted.length !== expectedNames.length ||
    new Set(sorted).size !== sorted.length ||
    sorted.some((name, index) => name !== expectedNames[index])
  ) {
    throw new Error(`${label} must be the exact reviewed contract scope`);
  }
}

function configEventSurface(config, label) {
  if (!Array.isArray(config?.contracts)) {
    throw new Error(`${label} has no contract event surface`);
  }
  const events = [];
  const contractEvents = [];
  for (const contract of config.contracts) {
    if (
      typeof contract?.name !== "string" ||
      !Array.isArray(contract.events) ||
      contract.events.length === 0
    ) {
      throw new Error(`${label} has an invalid contract event surface`);
    }
    const local = new Set();
    for (const declaration of contract.events) {
      const event = declaration?.event;
      if (typeof event !== "string" || event.length === 0 || event.trim() !== event) {
        throw new Error(`${label} has an invalid event signature`);
      }
      if (local.has(event)) {
        throw new Error(`${label} repeats an event signature for ${contract.name}`);
      }
      local.add(event);
      events.push(event);
      contractEvents.push(`${contract.name}\u0000${event}`);
    }
  }
  return Object.freeze({ events, contractEvents });
}

function parseLiveEnvioSurfaceReference(referenceBytes) {
  if (sha256(referenceBytes) !== LIVE_ENVIO_SURFACE_REFERENCE.configSha256) {
    throw new Error("live Envio surface reference digest is invalid");
  }
  const reference = parse(referenceBytes.toString("utf8"));
  if (
    !Array.isArray(reference?.chains) ||
    reference.chains.length !== 1 ||
    reference.chains[0]?.id !== 1 ||
    !Array.isArray(reference.chains[0]?.contracts)
  ) {
    throw new Error("live Envio surface reference is invalid");
  }
  const surface = configEventSurface(reference, "live Envio surface reference");
  const eventSet = Buffer.from(
    `${[...surface.events].sort(compareUtf8).join("\n")}\n`,
    "utf8",
  );
  if (
    surface.events.length !== LIVE_ENVIO_SURFACE_REFERENCE.eventCount ||
    sha256(eventSet) !== LIVE_ENVIO_SURFACE_REFERENCE.eventSetSha256
  ) {
    throw new Error("live Envio event-set reference is invalid");
  }
  return Object.freeze({ config: reference, surface });
}

function assertLiveEnvioSurfaceSuperset(candidate, referenceInput) {
  const reference = referenceInput.config ?? referenceInput;
  const referenceSurface = referenceInput.surface ??
    configEventSurface(reference, "live Envio surface reference");
  const candidateSurface = configEventSurface(candidate, "candidate Envio config");
  const candidateContractEvents = new Set(candidateSurface.contractEvents);
  for (const required of referenceSurface.contractEvents) {
    if (!candidateContractEvents.has(required)) {
      const separator = required.indexOf("\u0000");
      throw new Error(
        `candidate must preserve live ${required.slice(0, separator)} event ${required.slice(separator + 1)}`,
      );
    }
  }

  const candidateSources = candidate.chains?.[0]?.contracts;
  if (!Array.isArray(candidateSources)) {
    throw new Error("candidate must preserve the live Envio source surface");
  }
  for (const required of reference.chains[0].contracts) {
    const matches = candidateSources.filter(({ name }) => name === required.name);
    if (
      matches.length !== 1 ||
      (required.address !== undefined && matches[0]?.address !== required.address)
    ) {
      throw new Error(`candidate must preserve live ${required.name} source`);
    }
  }
  return Object.freeze({
    requiredEventCount: referenceSurface.events.length,
    candidateEventCount: candidateSurface.events.length,
  });
}

function exactChainContractScope(contracts) {
  if (!Array.isArray(contracts)) {
    throw new Error("chain registry must be the exact reviewed contract scope");
  }
  const names = contracts.map((entry) => entry?.name);
  const sorted = [...names].sort(compareUtf8);
  const baseline = [...BASE_CHAIN_CONTRACTS];
  const activated = [...ACTIVATED_CHAIN_CONTRACTS];
  const matches = (expected) =>
    sorted.length === expected.length &&
    new Set(sorted).size === sorted.length &&
    sorted.every((name, index) => name === expected[index]);
  const isBaseline = matches(baseline);
  const isActivated = matches(activated);
  if (!isBaseline && !isActivated) {
    throw new Error("chain registry must be the exact reviewed contract scope");
  }
  if (isBaseline) return false;
  for (const contractName of ["ClassicV4Hook", "ClassicV4Launcher"]) {
    const source = contracts.find((entry) => entry?.name === contractName);
    exactAddress(source?.address, `${contractName} chain address`);
  }
  return true;
}

function validatedConfig(configBytes, liveSurfaceReferenceBytes) {
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
  exactNames(
    "ABI registry",
    config.contracts.map((entry) => entry?.name),
    EXPECTED_ABI_CONTRACTS,
  );
  assertLiveEnvioSurfaceSuperset(
    config,
    parseLiveEnvioSurfaceReference(liveSurfaceReferenceBytes),
  );
  const classicV4Activated = exactChainContractScope(
    config.chains[0].contracts,
  );
  return Object.freeze({ configBytes, config, classicV4Activated });
}

function validatedLocalConfig(sourceCommit) {
  return validatedConfig(
    localArtifactBytes(sourceCommit, ARTIFACTS.configSha256),
    localArtifactBytes(sourceCommit, LIVE_ENVIO_SURFACE_REFERENCE.relativePath),
  );
}

function workingTreeArtifactBytes(relativePath) {
  return readFileSync(path.join(INDEXER_ROOT, relativePath));
}

function workingTreeClassicV4Activated() {
  return validatedConfig(
    workingTreeArtifactBytes(ARTIFACTS.configSha256),
    workingTreeArtifactBytes(LIVE_ENVIO_SURFACE_REFERENCE.relativePath),
  ).classicV4Activated;
}

function reviewedArtifactBytes(sourceCommit, relativePath) {
  try {
    return execFileSync(
      "git",
      ["show", `${sourceCommit}:indexer/${relativePath}`],
      { cwd: REPOSITORY_ROOT, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
    );
  } catch {
    throw new Error(`reviewed source commit does not contain indexer/${relativePath}`);
  }
}

function localArtifactBytes(sourceCommit, relativePath) {
  const local = readFileSync(path.join(INDEXER_ROOT, relativePath));
  const reviewed = reviewedArtifactBytes(sourceCommit, relativePath);
  if (!local.equals(reviewed)) {
    throw new Error(`local indexer/${relativePath} differs from reviewed source commit`);
  }
  return local;
}

function identityFromArtifactReader(sourceCommitInput, readArtifact) {
  const sourceCommit = exactCommit(sourceCommitInput);
  const configBytes = readArtifact(ARTIFACTS.configSha256);
  const { config } = validatedConfig(
    configBytes,
    readArtifact(LIVE_ENVIO_SURFACE_REFERENCE.relativePath),
  );

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
  return Object.freeze({
    deployment: `production-${sourceCommit.slice(0, 7)}`,
    sourceCommit,
    configSha256: sha256(configBytes),
    schemaSha256: sha256(readArtifact(ARTIFACTS.schemaSha256)),
    handlerSha256: sha256(readArtifact(ARTIFACTS.handlerSha256)),
    sourceRegistrySha256: sha256(
      readArtifact(ARTIFACTS.sourceRegistrySha256),
    ),
    eventSetSha256: sha256(eventSet),
    eventCount: events.length,
  });
}

function localIdentity(sourceCommitInput) {
  const sourceCommit = exactCommit(sourceCommitInput);
  return identityFromArtifactReader(
    sourceCommit,
    (relativePath) => localArtifactBytes(sourceCommit, relativePath),
  );
}

// Exported only for deterministic unit fixtures. Production CLI/audit paths
// continue to use localIdentity, which requires byte equality with the reviewed commit.
function workingTreeIdentity(sourceCommitInput) {
  return identityFromArtifactReader(
    sourceCommitInput,
    workingTreeArtifactBytes,
  );
}

function parseCandidateIdentity(value, label = "candidate identity") {
  const object = exactObject(value, label, IDENTITY_KEYS);
  return {
    deployment: exactString(
      object.deployment,
      `${label}.deployment`,
      /^[a-z0-9][a-z0-9._-]{0,127}$/u,
      128,
    ),
    sourceCommit: exactCommit(object.sourceCommit, `${label}.sourceCommit`),
    configSha256: exactSha256(object.configSha256, `${label}.configSha256`),
    schemaSha256: exactSha256(object.schemaSha256, `${label}.schemaSha256`),
    handlerSha256: exactSha256(object.handlerSha256, `${label}.handlerSha256`),
    sourceRegistrySha256: exactSha256(
      object.sourceRegistrySha256,
      `${label}.sourceRegistrySha256`,
    ),
    eventSetSha256: exactSha256(object.eventSetSha256, `${label}.eventSetSha256`),
    eventCount: exactSafeInteger(object.eventCount, `${label}.eventCount`, 1),
  };
}

function assertSameIdentity(actual, expected, label) {
  for (const key of IDENTITY_KEYS) {
    if (actual[key] !== expected[key]) {
      throw new Error(`${label} identity mismatch at ${key}`);
    }
  }
}

function parseAuditReleaseBinding(value, endpoint, expectedIdentity) {
  const binding = exactObject(value, "release binding", [
    "schemaVersion",
    "chainId",
    "startBlock",
    "confirmations",
    "envio",
    "uniswapV4Subgraph",
    "sources",
    "releases",
  ]);
  const envio = exactObject(binding.envio, "release binding Envio identity", [
    "deploymentLabel",
    "graphqlEndpoint",
    "schemaVersion",
    "sourceCommit",
    "configSha256",
    "schemaSha256",
    "handlerSha256",
    "sourceRegistrySha256",
    "eventSetSha256",
    "eventCount",
  ]);
  const releaseIdentity = parseCandidateIdentity({
    deployment: envio.deploymentLabel,
    sourceCommit: envio.sourceCommit,
    configSha256: envio.configSha256,
    schemaSha256: envio.schemaSha256,
    handlerSha256: envio.handlerSha256,
    sourceRegistrySha256: envio.sourceRegistrySha256,
    eventSetSha256: envio.eventSetSha256,
    eventCount: envio.eventCount,
  }, "release binding Envio identity");
  assertSameIdentity(releaseIdentity, expectedIdentity, "release binding");
  if (
    binding.schemaVersion !== 1 ||
    binding.chainId !== 1 ||
    !Number.isSafeInteger(binding.startBlock) ||
    binding.startBlock <= 0 ||
    binding.confirmations !== 12 ||
    envio.schemaVersion !== "1" ||
    envio.graphqlEndpoint !== endpoint ||
    !Array.isArray(binding.sources) ||
    binding.sources.length === 0 ||
    !Array.isArray(binding.releases) ||
    binding.releases.length === 0
  ) {
    throw new Error("release binding does not match the audited Envio deployment");
  }
  const uniswap = exactObject(
    binding.uniswapV4Subgraph,
    "release binding Uniswap v4 identity",
    ["subgraphId", "deployment"],
  );
  exactString(
    uniswap.subgraphId,
    "release binding Uniswap v4 subgraph",
    /^[1-9A-HJ-NP-Za-km-z]+$/u,
    96,
  );
  exactString(
    uniswap.deployment,
    "release binding Uniswap v4 deployment",
    /^[1-9A-HJ-NP-Za-km-z]+$/u,
    96,
  );
  return binding;
}

function parseArgs(argv) {
  const [command, ...rawRest] = argv;
  const rest = rawRest[0] === "--" ? rawRest.slice(1) : rawRest;
  if (rest.length % 2 !== 0) throw new Error("every option requires one value");
  const values = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!/^--[a-z][a-z-]*$/u.test(key ?? "") || value === undefined) {
      throw new Error(`invalid argument ${key ?? ""}`.trim());
    }
    const name = key.slice(2);
    if (Object.hasOwn(values, name)) throw new Error(`duplicate argument --${name}`);
    values[name] = value;
  }
  return { command, values };
}

function exactCommandArgs(command, values, allowed, required = allowed) {
  for (const key of Object.keys(values)) {
    if (!allowed.includes(key)) throw new Error(`unexpected argument --${key} for ${command}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(values, key)) throw new Error(`--${key} is required`);
  }
}

async function graphql(endpoint, query, variables = {}, fetcher = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GraphQL returned HTTP ${response.status}`);
    const value = await response.json();
    if (Array.isArray(value.errors) && value.errors.length > 0) {
      throw new Error(`GraphQL rejected the release audit: ${value.errors[0]?.message}`);
    }
    if (value === null || typeof value !== "object" || value.data === undefined) {
      throw new Error("GraphQL returned an invalid response");
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

const BASELINE_PROGRESS_QUERY = `
  query ProgrammableReleaseBaselineProgress {
    _meta(where: { chainId: { _eq: 1 } }) {
      chainId progressBlock bufferBlock sourceBlock isReady eventsProcessed
    }
    IndexerState_by_pk(id: "ethereum-mainnet") {
      id schemaVersion deployment chainId progressBlock progressBlockHash
      progressTimestamp progressTransactionHash progressOccurrenceId
    }
  }
`;

const INVENTORY_QUERY = `
  query ProgrammableReleaseInventory(
    $afterId: String!
    $anchorBlock: numeric!
    $first: Int!
  ) {
    Launch(
      where: {
        _and: [
          { id: { _gt: $afterId } }
          { updatedBlock: { _lte: $anchorBlock } }
        ]
      }
      order_by: [{ id: asc }]
      limit: $first
    ) {
      id chainId model releaseVersion launchHash token creator quoteAsset poolId hook
      rewardVault positionRecipient positionTokenId totalSwapFeeBps buySwapFeeBps
      sellSwapFeeBps rewardConfigurationHash quoteConfigurationHash totalSupply
      tokenLiquidityAmount lockedTokenDust initialTick tickLower tickUpper lpFeePips
      initialBuyQuoteAmount initialBuyTokenAmount initialBuyEthAmount
      launchOccurrenceId liquidityOccurrenceId initialBuyOccurrenceId
      custodyOccurrenceId coordinatorOccurrenceId hasLaunchEvent hasLiquidityEvent
      hasInitialBuyEvent hasCustodyEvent hasCoordinatorEvent
      hasPoolRegistrationEvent hasPoolFeeDisclosureEvent
      hasRewardVaultFactoryEvent provenanceValid isComplete updatedBlock
    }
  }
`;

function stableLaunch(value, label = "launch") {
  const object = exactObject(value, label, LAUNCH_FIELDS);
  const canonical = {};
  for (const field of LAUNCH_FIELDS) {
    const fieldLabel = `${label}.${field}`;
    if (field === "id") {
      canonical[field] = exactString(object[field], fieldLabel, /^[\x21-\x7e]+$/u, 512);
    } else if (field === "chainId") {
      if (object[field] !== 1) throw new Error(`${fieldLabel} must be Ethereum Mainnet`);
      canonical[field] = 1;
    } else if (field === "model") {
      canonical[field] = exactString(object[field], fieldLabel, /^(?:classic|stock-paired)$/u, 32);
    } else if (field === "releaseVersion") {
      canonical[field] = exactString(object[field], fieldLabel, /^[a-z0-9-]+$/u, 64);
    } else if (ADDRESS_LAUNCH_FIELDS.includes(field)) {
      canonical[field] = exactNullable(object[field], (entry) => exactAddress(entry, fieldLabel));
    } else if (BYTES32_LAUNCH_FIELDS.includes(field)) {
      canonical[field] = exactNullable(object[field], (entry) => exactBytes32(entry, fieldLabel));
    } else if (UINT_LAUNCH_FIELDS.includes(field)) {
      canonical[field] = exactNullable(object[field], (entry) => exactUint(entry, fieldLabel));
    } else if (INT_LAUNCH_FIELDS.includes(field)) {
      canonical[field] = exactNullable(object[field], (entry) =>
        exactSafeInteger(entry, fieldLabel),
      );
    } else if (OCCURRENCE_LAUNCH_FIELDS.includes(field)) {
      canonical[field] = exactNullable(object[field], (entry) =>
        exactString(entry, fieldLabel, /^[\x21-\x7e]+$/u, 512),
      );
    } else if (BOOLEAN_LAUNCH_FIELDS.includes(field)) {
      if (typeof object[field] !== "boolean") throw new Error(`${fieldLabel} must be boolean`);
      canonical[field] = object[field];
    } else if (field === "updatedBlock") {
      canonical[field] = exactUint(object[field], fieldLabel);
    } else {
      throw new Error(`unhandled stable launch field ${field}`);
    }
  }
  return canonical;
}

function assertEligibleLaunch(row) {
  if (
    !SUPPORTED_RELEASES.includes(row.releaseVersion) ||
    row.model !== MODELS[row.releaseVersion]
  ) {
    throw new Error(`unsupported release in inventory: ${row.releaseVersion}`);
  }
  if (row.provenanceValid !== true || row.isComplete !== true) {
    throw new Error(`incomplete or invalid launch ${row.id}`);
  }
  if (
    !row.token ||
    !row.launchOccurrenceId ||
    !row.liquidityOccurrenceId ||
    !row.initialBuyOccurrenceId
  ) {
    throw new Error(`launch ${row.id} is missing required identity evidence`);
  }
}

function assertSupportedLaunch(row) {
  if (
    !SUPPORTED_RELEASES.includes(row.releaseVersion) ||
    row.model !== MODELS[row.releaseVersion]
  ) {
    throw new Error(`unsupported release in inventory: ${row.releaseVersion}`);
  }
}

function canonicalRows(launches) {
  return Buffer.from(`${launches.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function inventoryEvidence(launches, releases = SUPPORTED_RELEASES) {
  const perRelease = Object.fromEntries(releases.map((release) => [release, 0]));
  for (const row of launches) {
    if (!Object.hasOwn(perRelease, row.releaseVersion)) {
      throw new Error(`inventory release is outside its declared scope: ${row.releaseVersion}`);
    }
    perRelease[row.releaseVersion] += 1;
  }
  return {
    count: launches.length,
    perRelease,
    sha256: sha256(canonicalRows(launches)),
  };
}

function exactAnchor(data, label) {
  if (!Array.isArray(data?._meta) || data._meta.length !== 1) {
    throw new Error(`${label} returned an invalid Ethereum _meta row`);
  }
  const meta = data._meta[0];
  const state = data.IndexerState_by_pk;
  if (
    state === null ||
    typeof state !== "object" ||
    meta.chainId !== 1 ||
    meta.isReady !== true ||
    state.id !== "ethereum-mainnet" ||
    state.schemaVersion !== "1" ||
    state.chainId !== 1
  ) {
    throw new Error(`${label} is not a ready v1 Ethereum Mainnet deployment`);
  }
  const anchor = {
    progressBlock: exactUint(meta.progressBlock, `${label}.progressBlock`),
    bufferBlock: exactUint(meta.bufferBlock, `${label}.bufferBlock`),
    sourceBlock: exactUint(meta.sourceBlock, `${label}.sourceBlock`),
    eventsProcessed: exactUint(meta.eventsProcessed, `${label}.eventsProcessed`),
    stateProgressBlock: exactUint(state.progressBlock, `${label}.stateProgressBlock`),
    stateProgressBlockHash: exactBytes32(
      state.progressBlockHash,
      `${label}.stateProgressBlockHash`,
    ),
    stateProgressTimestamp: exactUint(
      state.progressTimestamp,
      `${label}.stateProgressTimestamp`,
    ),
    stateProgressTransactionHash: exactBytes32(
      state.progressTransactionHash,
      `${label}.stateProgressTransactionHash`,
    ),
    stateProgressOccurrenceId: exactString(
      state.progressOccurrenceId,
      `${label}.stateProgressOccurrenceId`,
      /^[\x21-\x7e]+$/u,
      512,
    ),
  };
  if (
    BigInt(anchor.progressBlock) !== BigInt(anchor.bufferBlock) ||
    BigInt(anchor.sourceBlock) < BigInt(anchor.progressBlock) ||
    BigInt(anchor.stateProgressBlock) > BigInt(anchor.progressBlock)
  ) {
    throw new Error(`${label} does not expose a stable processed checkpoint`);
  }
  return anchor;
}

async function readInventory(endpoint, anchorBlock, fetcher = fetch) {
  const launches = [];
  let afterId = "";
  for (;;) {
    const page = await graphql(
      endpoint,
      INVENTORY_QUERY,
      { afterId, anchorBlock, first: 250 },
      fetcher,
    );
    const rows = page?.Launch;
    if (!Array.isArray(rows)) throw new Error("inventory page is invalid");
    if (rows.length > 250) throw new Error("inventory page exceeds the requested bound");
    if (rows.length === 0) break;
    for (const value of rows) {
      const row = stableLaunch(value);
      if (row.id <= afterId) throw new Error("inventory is not strictly ordered");
      if (BigInt(row.updatedBlock) > BigInt(anchorBlock)) {
        throw new Error(`launch ${row.id} exceeds the frozen inventory anchor`);
      }
      launches.push(row);
      afterId = row.id;
    }
    if (rows.length < 250) break;
  }
  return launches;
}

async function readFrozenInventory(endpoint, progressQuery, fetcher = fetch) {
  const progress = await graphql(endpoint, progressQuery, {}, fetcher);
  const anchor = exactAnchor(progress, "deployment");
  const first = await readInventory(endpoint, anchor.progressBlock, fetcher);
  const second = await readInventory(endpoint, anchor.progressBlock, fetcher);
  if (sha256(canonicalRows(first)) !== sha256(canonicalRows(second))) {
    throw new Error("inventory changed while reading the frozen checkpoint");
  }
  const afterProgress = await graphql(endpoint, progressQuery, {}, fetcher);
  const after = exactAnchor(
    afterProgress,
    "deployment after inventory",
  );
  if (BigInt(after.progressBlock) < BigInt(anchor.progressBlock)) {
    throw new Error("deployment checkpoint regressed during inventory capture");
  }
  return { progress, afterProgress, anchor, launches: first };
}

function withDigest(kind, payload) {
  const digest = sha256(
    Buffer.from(`programmable:${kind}:v2\n${JSON.stringify(payload)}\n`, "utf8"),
  );
  return { ...payload, digest };
}

function baselineDeployment(endpoint, progress) {
  const label = exactString(
    progress.IndexerState_by_pk?.deployment,
    "baseline deployment label",
    /^[a-z0-9][a-z0-9._-]{0,127}$/u,
    128,
  );
  return {
    provider: "envio-cloud",
    host: ENVIO_HOST,
    endpointId: endpointIdFromUrl(endpoint),
    deploymentLabel: label,
    chainId: 1,
  };
}

async function snapshotBaseline(endpointInput, fetcher = fetch, now = () => new Date()) {
  const endpoint = exactString(
    endpointInput,
    "endpoint",
    /^https:\/\//u,
    256,
  );
  endpointIdFromUrl(endpoint);
  const { progress, anchor, launches } = await readFrozenInventory(
    endpoint,
    BASELINE_PROGRESS_QUERY,
    fetcher,
  );
  if (launches.length === 0) throw new Error("baseline inventory is empty");
  for (const row of launches) assertSupportedLaunch(row);
  const inventory = inventoryEvidence(launches);
  for (const release of HISTORICAL_RELEASES) {
    if (inventory.perRelease[release] === 0) {
      throw new Error("baseline does not contain every reviewed historical release");
    }
  }
  return withDigest("envio-launch-inventory-baseline", {
    schemaVersion: 2,
    kind: "envio-launch-inventory-baseline",
    endpoint,
    capturedAt: now().toISOString(),
    deployment: baselineDeployment(endpoint, progress),
    anchor,
    inventory,
    entries: launches,
  });
}

function parseInventory(value, label) {
  const object = exactObject(value, label, ["count", "perRelease", "sha256"]);
  const actualReleaseKeys = object.perRelease !== null &&
      typeof object.perRelease === "object" &&
      !Array.isArray(object.perRelease)
    ? Object.keys(object.perRelease).sort(compareUtf8)
    : [];
  const matchesReleaseKeys = (expected) => {
    const sorted = [...expected].sort(compareUtf8);
    return actualReleaseKeys.length === sorted.length &&
      actualReleaseKeys.every((key, index) => key === sorted[index]);
  };
  const releaseKeys = matchesReleaseKeys(SUPPORTED_RELEASES)
    ? SUPPORTED_RELEASES
    : matchesReleaseKeys(HISTORICAL_RELEASES)
      ? HISTORICAL_RELEASES
      : null;
  if (!releaseKeys) {
    throw new Error(`${label}.perRelease has an unsupported release scope`);
  }
  const perRelease = exactObject(
    object.perRelease,
    `${label}.perRelease`,
    releaseKeys,
  );
  const canonicalPerRelease = {};
  let total = 0;
  for (const release of releaseKeys) {
    const count = exactSafeInteger(perRelease[release], `${label}.perRelease.${release}`, 0);
    canonicalPerRelease[release] = count;
    total += count;
  }
  const count = exactSafeInteger(object.count, `${label}.count`, 1);
  if (count !== total) throw new Error(`${label}.count does not match release counts`);
  return {
    count,
    perRelease: canonicalPerRelease,
    sha256: exactSha256(object.sha256, `${label}.sha256`),
  };
}

function parseAnchor(value, label) {
  const keys = [
    "progressBlock",
    "bufferBlock",
    "sourceBlock",
    "eventsProcessed",
    "stateProgressBlock",
    "stateProgressBlockHash",
    "stateProgressTimestamp",
    "stateProgressTransactionHash",
    "stateProgressOccurrenceId",
  ];
  const object = exactObject(value, label, keys);
  const anchor = {
    progressBlock: exactUint(object.progressBlock, `${label}.progressBlock`),
    bufferBlock: exactUint(object.bufferBlock, `${label}.bufferBlock`),
    sourceBlock: exactUint(object.sourceBlock, `${label}.sourceBlock`),
    eventsProcessed: exactUint(object.eventsProcessed, `${label}.eventsProcessed`),
    stateProgressBlock: exactUint(object.stateProgressBlock, `${label}.stateProgressBlock`),
    stateProgressBlockHash: exactBytes32(
      object.stateProgressBlockHash,
      `${label}.stateProgressBlockHash`,
    ),
    stateProgressTimestamp: exactUint(
      object.stateProgressTimestamp,
      `${label}.stateProgressTimestamp`,
    ),
    stateProgressTransactionHash: exactBytes32(
      object.stateProgressTransactionHash,
      `${label}.stateProgressTransactionHash`,
    ),
    stateProgressOccurrenceId: exactString(
      object.stateProgressOccurrenceId,
      `${label}.stateProgressOccurrenceId`,
      /^[\x21-\x7e]+$/u,
      512,
    ),
  };
  if (
    anchor.progressBlock !== anchor.bufferBlock ||
    BigInt(anchor.sourceBlock) < BigInt(anchor.progressBlock) ||
    BigInt(anchor.stateProgressBlock) > BigInt(anchor.progressBlock)
  ) {
    throw new Error(`${label} is not a stable processed checkpoint`);
  }
  return anchor;
}

function parseBaseline(value) {
  const keys = [
    "schemaVersion",
    "kind",
    "endpoint",
    "capturedAt",
    "deployment",
    "anchor",
    "inventory",
    "entries",
    "digest",
  ];
  const object = exactObject(value, "baseline", keys);
  if (object.schemaVersion !== 2 || object.kind !== "envio-launch-inventory-baseline") {
    throw new Error("--baseline must be a v2 launch inventory baseline");
  }
  const endpoint = exactString(object.endpoint, "baseline.endpoint", /^https:\/\//u, 256);
  const endpointId = endpointIdFromUrl(endpoint);
  const deploymentObject = exactObject(object.deployment, "baseline.deployment", [
    "provider",
    "host",
    "endpointId",
    "deploymentLabel",
    "chainId",
  ]);
  const deployment = {
    provider: deploymentObject.provider,
    host: deploymentObject.host,
    endpointId: deploymentObject.endpointId,
    deploymentLabel: exactString(
      deploymentObject.deploymentLabel,
      "baseline.deployment.deploymentLabel",
      /^[a-z0-9][a-z0-9._-]{0,127}$/u,
      128,
    ),
    chainId: deploymentObject.chainId,
  };
  if (
    deployment.provider !== "envio-cloud" ||
    deployment.host !== ENVIO_HOST ||
    deployment.endpointId !== endpointId ||
    deployment.chainId !== 1
  ) {
    throw new Error("baseline deployment does not match its Envio endpoint");
  }
  const anchor = parseAnchor(object.anchor, "baseline.anchor");
  if (!Array.isArray(object.entries) || object.entries.length === 0) {
    throw new Error("baseline.entries must be non-empty");
  }
  const entries = object.entries.map((entry, index) =>
    stableLaunch(entry, `baseline.entries[${index}]`),
  );
  for (let index = 0; index < entries.length; index += 1) {
    const row = entries[index];
    assertSupportedLaunch(row);
    if (index > 0 && entries[index - 1].id >= row.id) {
      throw new Error("baseline entries are not strictly ordered");
    }
    if (BigInt(row.updatedBlock) > BigInt(anchor.progressBlock)) {
      throw new Error(`baseline launch ${row.id} exceeds its anchor`);
    }
  }
  const inventory = parseInventory(object.inventory, "baseline.inventory");
  const computedInventory = inventoryEvidence(
    entries,
    Object.keys(inventory.perRelease),
  );
  if (JSON.stringify(inventory) !== JSON.stringify(computedInventory)) {
    throw new Error("baseline inventory count or digest does not match its entries");
  }
  const canonical = {
    schemaVersion: 2,
    kind: "envio-launch-inventory-baseline",
    endpoint,
    capturedAt: exactTimestamp(object.capturedAt, "baseline.capturedAt"),
    deployment,
    anchor,
    inventory,
    entries,
  };
  const expectedDigest = withDigest("envio-launch-inventory-baseline", canonical).digest;
  if (object.digest !== expectedDigest) throw new Error("baseline digest mismatch");
  return { ...canonical, digest: expectedDigest };
}

function exactCoordinatorCreatorRepair(expected, actual, changedFields) {
  const coordinatorSource = STOCK_COORDINATOR_SOURCES[expected.releaseVersion];
  if (
    coordinatorSource === undefined ||
    changedFields.length !== 1 ||
    changedFields[0] !== "creator" ||
    expected.provenanceValid !== false ||
    expected.isComplete !== false ||
    expected.creator !== coordinatorSource ||
    expected.hasLaunchEvent !== true ||
    expected.hasCoordinatorEvent !== true ||
    expected.launchOccurrenceId === null ||
    expected.coordinatorOccurrenceId === null ||
    actual.provenanceValid !== true ||
    actual.isComplete !== true ||
    actual.creator === null ||
    actual.creator === coordinatorSource ||
    actual.launchOccurrenceId !== expected.launchOccurrenceId ||
    actual.coordinatorOccurrenceId !== expected.coordinatorOccurrenceId
  ) {
    return undefined;
  }
  return {
    id: expected.id,
    releaseVersion: expected.releaseVersion,
    priorCoordinatorSource: coordinatorSource,
    authenticatedCreator: actual.creator,
    launchOccurrenceId: actual.launchOccurrenceId,
    coordinatorOccurrenceId: actual.coordinatorOccurrenceId,
  };
}

function assertFrozenBaseline(launches, baseline) {
  const current = new Map(launches.map((row) => [row.id, row]));
  const repairs = [];
  for (const expected of baseline.entries) {
    const actual = current.get(expected.id);
    if (actual === undefined) throw new Error(`candidate omitted frozen launch ${expected.id}`);
    const changedFields = STABLE_LAUNCH_FIELDS.filter(
      (field) => actual[field] !== expected[field],
    );
    if (changedFields.length === 0) continue;
    const repair = exactCoordinatorCreatorRepair(expected, actual, changedFields);
    if (repair !== undefined) {
      repairs.push(repair);
      continue;
    }
    throw new Error(`candidate changed frozen launch ${expected.id} at ${changedFields[0]}`);
  }
  return repairs;
}

function parseControlPlaneDeployment(value, endpoint, identity) {
  const deployment = exactObject(value, "release audit deployment", [
    "provider",
    "owner",
    "project",
    "mirrorCommit",
    "deploymentLabel",
    "endpointId",
  ]);
  const endpointId = endpointIdFromUrl(endpoint);
  const canonical = {
    provider: deployment.provider,
    owner: deployment.owner,
    project: deployment.project,
    mirrorCommit: exactCommit(
      deployment.mirrorCommit,
      "release audit mirror commit",
    ),
    deploymentLabel: exactString(
      deployment.deploymentLabel,
      "release audit deployment label",
      /^[a-z0-9][a-z0-9._-]{0,127}$/u,
      128,
    ),
    endpointId: exactEndpointId(deployment.endpointId),
  };
  if (
    canonical.provider !== "envio-cloud" ||
    canonical.owner !== ENVIO_OWNER ||
    canonical.project !== ENVIO_PROJECT ||
    canonical.deploymentLabel !== identity.deployment ||
    canonical.endpointId !== endpointId
  ) {
    throw new Error("release audit deployment identity is invalid");
  }
  return canonical;
}

function parseBaselineSummary(value) {
  const baseline = exactObject(value, "release audit baseline", [
    "digest",
    "deployment",
    "anchor",
    "inventory",
  ]);
  const deploymentValue = exactObject(
    baseline.deployment,
    "release audit baseline deployment",
    ["provider", "host", "endpointId", "deploymentLabel", "chainId"],
  );
  const endpointId = exactEndpointId(deploymentValue.endpointId);
  const deploymentLabel = exactString(
    deploymentValue.deploymentLabel,
    "release audit baseline deployment label",
    /^[a-z0-9][a-z0-9._-]{0,127}$/u,
    128,
  );
  const deployment = {
    provider: deploymentValue.provider,
    host: deploymentValue.host,
    endpointId,
    deploymentLabel,
    chainId: deploymentValue.chainId,
  };
  if (
    deployment.provider !== "envio-cloud" ||
    deployment.host !== ENVIO_HOST ||
    deployment.chainId !== 1
  ) {
    throw new Error("release audit baseline deployment is invalid");
  }
  return {
    digest: exactSha256(baseline.digest, "release audit baseline digest"),
    deployment,
    anchor: parseAnchor(baseline.anchor, "release audit baseline anchor"),
    inventory: parseInventory(
      baseline.inventory,
      "release audit baseline inventory",
    ),
  };
}

function parseCoordinatorCreatorRepairs(value) {
  if (!Array.isArray(value)) {
    throw new Error("release audit coordinator repairs must be an array");
  }
  return value.map((entry, index) => {
    const label = `release audit coordinator repair ${index}`;
    const repair = exactObject(entry, label, [
      "id",
      "releaseVersion",
      "priorCoordinatorSource",
      "authenticatedCreator",
      "launchOccurrenceId",
      "coordinatorOccurrenceId",
    ]);
    const releaseVersion = exactString(
      repair.releaseVersion,
      `${label}.releaseVersion`,
      /^stock-paired-v[123]$/u,
      32,
    );
    const priorCoordinatorSource = exactAddress(
      repair.priorCoordinatorSource,
      `${label}.priorCoordinatorSource`,
    );
    if (priorCoordinatorSource !== STOCK_COORDINATOR_SOURCES[releaseVersion]) {
      throw new Error(`${label} has an invalid prior coordinator source`);
    }
    return {
      id: exactString(repair.id, `${label}.id`, /^[\x21-\x7e]+$/u, 512),
      releaseVersion,
      priorCoordinatorSource,
      authenticatedCreator: exactAddress(
        repair.authenticatedCreator,
        `${label}.authenticatedCreator`,
      ),
      launchOccurrenceId: exactString(
        repair.launchOccurrenceId,
        `${label}.launchOccurrenceId`,
        /^[\x21-\x7e]+$/u,
        512,
      ),
      coordinatorOccurrenceId: exactString(
        repair.coordinatorOccurrenceId,
        `${label}.coordinatorOccurrenceId`,
        /^[\x21-\x7e]+$/u,
        512,
      ),
    };
  });
}

function parseReleaseAuditArtifact(value, options = {}) {
  const artifact = exactObject(value, "release audit", [
    "schemaVersion",
    "kind",
    "endpoint",
    "capturedAt",
    "deployment",
    "identity",
    "releaseBindingDigest",
    "releaseBinding",
    "classicV4Activated",
    "baseline",
    "anchor",
    "inventory",
    "authenticatedCoordinatorCreatorRepairs",
    "digest",
  ]);
  if (
    artifact.schemaVersion !== 2 ||
    artifact.kind !== "envio-release-inventory" ||
    typeof artifact.classicV4Activated !== "boolean"
  ) {
    throw new Error("release audit identity is invalid");
  }
  const endpoint = exactString(
    artifact.endpoint,
    "release audit endpoint",
    /^https:\/\//u,
    256,
  );
  endpointIdFromUrl(endpoint);
  const identity = parseCandidateIdentity(
    artifact.identity,
    "release audit IndexerState identity",
  );
  const deployment = parseControlPlaneDeployment(
    artifact.deployment,
    endpoint,
    identity,
  );
  const releaseBinding = parseAuditReleaseBinding(
    artifact.releaseBinding,
    endpoint,
    identity,
  );
  const bindingDigest = releaseBindingDigest(releaseBinding);
  if (artifact.releaseBindingDigest !== bindingDigest) {
    throw new Error("release audit binding digest mismatch");
  }
  const baseline = parseBaselineSummary(artifact.baseline);
  const anchor = parseAnchor(artifact.anchor, "release audit anchor");
  if (BigInt(anchor.progressBlock) < BigInt(baseline.anchor.progressBlock)) {
    throw new Error("release audit regressed behind its frozen baseline");
  }
  const inventory = parseInventory(artifact.inventory, "release audit inventory");
  if (
    Object.keys(inventory.perRelease).length !== SUPPORTED_RELEASES.length ||
    SUPPORTED_RELEASES.some((release) =>
      !Object.hasOwn(inventory.perRelease, release)
    )
  ) {
    throw new Error("release audit inventory omits a supported release");
  }
  for (const release of HISTORICAL_RELEASES) {
    if (inventory.perRelease[release] < 1) {
      throw new Error(`release audit has no ${release} launches`);
    }
  }
  const classicV4Count = inventory.perRelease["classic-v4"];
  if (
    typeof classicV4Count !== "number" ||
    (artifact.classicV4Activated && classicV4Count < 1) ||
    (!artifact.classicV4Activated && classicV4Count !== 0) ||
    (options.requireClassicV4 === true && !artifact.classicV4Activated)
  ) {
    throw new Error("release audit does not prove an activated Classic V4 canary");
  }
  const authenticatedCoordinatorCreatorRepairs =
    parseCoordinatorCreatorRepairs(
      artifact.authenticatedCoordinatorCreatorRepairs,
    );
  const canonical = {
    schemaVersion: 2,
    kind: "envio-release-inventory",
    endpoint,
    capturedAt: exactTimestamp(
      artifact.capturedAt,
      "release audit capture timestamp",
    ),
    deployment,
    identity,
    releaseBindingDigest: bindingDigest,
    releaseBinding,
    classicV4Activated: artifact.classicV4Activated,
    baseline,
    anchor,
    inventory,
    authenticatedCoordinatorCreatorRepairs,
  };
  const expectedDigest = withDigest("envio-release-inventory", canonical).digest;
  if (artifact.digest !== expectedDigest) {
    throw new Error("release audit digest mismatch");
  }
  return Object.freeze({ ...canonical, digest: expectedDigest });
}

function candidateDeployment(values, endpoint, expectedIdentity) {
  const endpointId = exactEndpointId(values["deployment-endpoint-id"]);
  endpointIdFromUrl(endpoint, endpointId);
  const deploymentLabel = exactString(
    values["deployment-label"],
    "deployment label",
    /^[a-z0-9][a-z0-9._-]{0,127}$/u,
    128,
  );
  if (deploymentLabel !== expectedIdentity.deployment) {
    throw new Error("control-plane deployment label does not match candidate identity");
  }
  return {
    provider: "envio-cloud",
    owner: ENVIO_OWNER,
    project: ENVIO_PROJECT,
    mirrorCommit: exactCommit(values["mirror-commit"], "mirror commit"),
    deploymentLabel,
    endpointId,
  };
}

function identityFromState(state) {
  if (
    state === null ||
    typeof state !== "object" ||
    state.id !== "ethereum-mainnet" ||
    state.schemaVersion !== "1" ||
    state.chainId !== 1
  ) {
    throw new Error("candidate IndexerState is not the v1 Ethereum singleton");
  }
  const identity = {};
  for (const key of IDENTITY_KEYS) identity[key] = state[key];
  return parseCandidateIdentity(identity, "candidate IndexerState");
}

async function auditCandidateWithReaders({
  endpoint: endpointInput,
  expectedIdentity: identityInput,
  releaseBinding: releaseBindingInput,
  baseline: baselineInput,
  sourceCommit: sourceCommitInput,
  deployment,
  fetcher = fetch,
  now = () => new Date(),
  identityReader = localIdentity,
  classicV4ActivationReader = (sourceCommit) =>
    validatedLocalConfig(sourceCommit).classicV4Activated,
}) {
  const sourceCommit = exactCommit(sourceCommitInput);
  const expectedFileIdentity = parseCandidateIdentity(identityInput);
  if (expectedFileIdentity.sourceCommit !== sourceCommit) {
    throw new Error("candidate identity sourceCommit does not match reviewed input");
  }
  const expectedIdentity = identityReader(sourceCommit);
  const classicV4Activated = classicV4ActivationReader(sourceCommit);
  assertSameIdentity(expectedFileIdentity, expectedIdentity, "reviewed checkout");
  const endpoint = exactString(endpointInput, "endpoint", /^https:\/\//u, 256);
  endpointIdFromUrl(endpoint);
  const releaseBinding = parseAuditReleaseBinding(
    releaseBindingInput,
    endpoint,
    expectedIdentity,
  );
  const bindingDigest = releaseBindingDigest(releaseBinding);
  const controlPlane = candidateDeployment(deployment, endpoint, expectedIdentity);
  const baseline = parseBaseline(baselineInput);
  const { progress, afterProgress, anchor, launches } = await readFrozenInventory(
    endpoint,
    PROGRESS_QUERY,
    fetcher,
  );
  const runtimeIdentity = identityFromState(progress.IndexerState_by_pk);
  assertSameIdentity(runtimeIdentity, expectedIdentity, "candidate IndexerState");
  const finalRuntimeIdentity = identityFromState(afterProgress.IndexerState_by_pk);
  assertSameIdentity(
    finalRuntimeIdentity,
    expectedIdentity,
    "candidate IndexerState after inventory",
  );
  if (runtimeIdentity.deployment !== controlPlane.deploymentLabel) {
    throw new Error("candidate runtime does not corroborate the control-plane deployment");
  }
  if (BigInt(anchor.progressBlock) < BigInt(baseline.anchor.progressBlock)) {
    throw new Error("candidate has not reached the frozen baseline checkpoint");
  }
  if (launches.length === 0) throw new Error("candidate inventory is empty");
  const ids = new Set();
  const tokens = new Set();
  const launchHashes = new Set();
  for (const row of launches) {
    assertEligibleLaunch(row);
    if (ids.has(row.id) || tokens.has(row.token) || launchHashes.has(row.launchHash)) {
      throw new Error(`duplicate launch identity in candidate inventory: ${row.id}`);
    }
    ids.add(row.id);
    tokens.add(row.token);
    launchHashes.add(row.launchHash);
  }
  const inventory = inventoryEvidence(launches);
  for (const release of HISTORICAL_RELEASES) {
    if (inventory.perRelease[release] === 0) {
      throw new Error(`candidate has no ${release} launches`);
    }
  }
  if (classicV4Activated && inventory.perRelease["classic-v4"] === 0) {
    throw new Error("candidate has no classic-v4 launches");
  }
  if (!classicV4Activated && inventory.perRelease["classic-v4"] !== 0) {
    throw new Error("candidate exposes classic-v4 before source activation");
  }
  const authenticatedCoordinatorCreatorRepairs = assertFrozenBaseline(launches, baseline);
  return parseReleaseAuditArtifact(withDigest("envio-release-inventory", {
    schemaVersion: 2,
    kind: "envio-release-inventory",
    endpoint,
    capturedAt: now().toISOString(),
    deployment: controlPlane,
    identity: expectedIdentity,
    releaseBindingDigest: bindingDigest,
    releaseBinding,
    classicV4Activated,
    baseline: {
      digest: baseline.digest,
      deployment: baseline.deployment,
      anchor: baseline.anchor,
      inventory: baseline.inventory,
    },
    anchor,
    inventory,
    authenticatedCoordinatorCreatorRepairs,
  }));
}

async function auditCandidate(input) {
  return await auditCandidateWithReaders({
    ...input,
    identityReader: localIdentity,
    classicV4ActivationReader: (sourceCommit) =>
      validatedLocalConfig(sourceCommit).classicV4Activated,
  });
}

// Test-only entrypoint: it validates and hashes the current candidate bytes,
// but it cannot be selected through the production CLI.
async function auditWorkingTreeCandidate(input) {
  const {
    classicV4ActivationReader = () => workingTreeClassicV4Activated(),
    ...candidate
  } = input;
  return await auditCandidateWithReaders({
    ...candidate,
    identityReader: workingTreeIdentity,
    classicV4ActivationReader,
  });
}

async function main(argv = process.argv.slice(2)) {
  const { command, values } = parseArgs(argv);
  if (command === "identity") {
    exactCommandArgs(command, values, ["source-commit"]);
    const identity = localIdentity(values["source-commit"]);
    process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
    return;
  }
  if (command === "snapshot") {
    exactCommandArgs(command, values, ["endpoint", "output"]);
    const baseline = await snapshotBaseline(values.endpoint);
    writeFileSync(path.resolve(values.output), `${JSON.stringify(baseline, null, 2)}\n`, {
      flag: "wx",
      flush: true,
    });
    return;
  }
  if (command === "audit") {
    const required = [
      "endpoint",
      "deployment-endpoint-id",
      "deployment-label",
      "mirror-commit",
      "source-commit",
      "identity",
      "release-binding",
      "baseline",
    ];
    exactCommandArgs(command, values, [...required, "output"], required);
    const expectedIdentity = JSON.parse(readFileSync(path.resolve(values.identity), "utf8"));
    const releaseBinding = JSON.parse(
      readFileSync(path.resolve(values["release-binding"]), "utf8"),
    );
    const baseline = JSON.parse(readFileSync(path.resolve(values.baseline), "utf8"));
    const evidence = await auditCandidate({
      endpoint: values.endpoint,
      expectedIdentity,
      releaseBinding,
      baseline,
      sourceCommit: values["source-commit"],
      deployment: values,
    });
    const output = `${JSON.stringify(evidence, null, 2)}\n`;
    if (values.output) {
      writeFileSync(path.resolve(values.output), output, {
        flag: "wx",
        flush: true,
      });
    }
    else process.stdout.write(output);
    return;
  }
  throw new Error("usage: release-candidate.mjs identity|snapshot|audit [...options]");
}

if (path.resolve(process.argv[1] ?? "") === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(
      `Envio release candidate: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}

export {
  IDENTITY_KEYS,
  INVENTORY_QUERY,
  LAUNCH_FIELDS,
  LIVE_ENVIO_SURFACE_REFERENCE,
  STABLE_LAUNCH_FIELDS,
  assertFrozenBaseline,
  assertLiveEnvioSurfaceSuperset,
  auditCandidate,
  auditWorkingTreeCandidate,
  endpointIdFromUrl,
  localIdentity,
  parseBaseline,
  parseCandidateIdentity,
  parseLiveEnvioSurfaceReference,
  parseReleaseAuditArtifact,
  releaseBindingDigest,
  snapshotBaseline,
  stableLaunch,
  workingTreeClassicV4Activated,
  workingTreeIdentity,
};
