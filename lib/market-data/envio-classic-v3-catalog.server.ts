import "server-only";

import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  isAddress,
  isHex,
  type Address,
  type Hex,
} from "viem";
import { mainnet } from "viem/chains";

import { createEnvioClient } from "../data-pipeline/envio";
import {
  getDataPipelineReleaseBinding,
  type DataPipelineReleaseBinding,
} from "../data-pipeline/release-binding.server";
import {
  boundedJsonRequest,
  type DataPipelineFetcher,
} from "../data-pipeline/request";
import { canonicalTokenExploreEntryV1 } from "../explore-entry-v1";
import {
  characterLength,
  hasUnsafeDisplayCharacters,
  isValidTokenSymbol,
  MAX_TOKEN_NAME_BYTES,
  MAX_TOKEN_NAME_CHARACTERS,
  MAX_TOKEN_SYMBOL_BYTES,
  utf8ByteLength,
} from "../metadata-policy";
import { uerc20ReadAbi } from "../onchain/abis";
import { getWebsiteReadOnchainDeployment } from "../onchain/config";
import { withOperationalRpcFailover } from
  "../onchain/operational-rpc-failover.server";
import { canonicalSha256 } from "../server/projection-target/hashing";
import type { ExploreEntry, LauncherToken } from "../tokens";

const CATALOG_CACHE_TTL_MS = 15_000;
const CATALOG_STALE_GRACE_MS = 5 * 60_000;
const CATALOG_WORKER_TIMEOUT_MS = 7_000;
const GRAPHQL_TIMEOUT_MS = 3_000;
const GRAPHQL_MAXIMUM_BODY_BYTES = 4 * 1024 * 1024;
const LAUNCH_PAGE_SIZE = 64;
const MAXIMUM_LAUNCH_COUNT = 5_000;
export const ENVIO_CLASSIC_V3_TOKEN_METADATA_BATCH_SIZE = 32;
export const ENVIO_CLASSIC_V3_TOKEN_METADATA_CONCURRENCY = 2;
const MAXIMUM_RPC_HEAD_SKEW_BLOCKS = 8n;
const NATIVE_CURRENCY_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

const CLASSIC_V3_LAUNCH_QUERY = `
  query ProgrammableClassicV3Catalog(
    $afterId: String!
    $anchorBlock: numeric!
    $first: Int!
  ) {
    Launch(
      where: {
        _and: [
          { id: { _gt: $afterId } }
          { updatedBlock: { _lte: $anchorBlock } }
          { model: { _eq: "classic" } }
          { releaseVersion: { _eq: "classic-v3" } }
          { isComplete: { _eq: true } }
          { provenanceValid: { _eq: true } }
        ]
      }
      order_by: [{ id: asc }]
      limit: $first
    ) {
      id
      chainId
      model
      releaseVersion
      launchHash
      token
      creator
      quoteAsset
      poolId
      hook
      rewardVault
      positionRecipient
      positionTokenId
      totalSwapFeeBps
      buySwapFeeBps
      sellSwapFeeBps
      rewardConfigurationHash
      quoteConfigurationHash
      totalSupply
      tokenLiquidityAmount
      lockedTokenDust
      initialTick
      tickLower
      tickUpper
      lpFeePips
      launchOccurrenceId
      liquidityOccurrenceId
      initialBuyOccurrenceId
      custodyOccurrenceId
      coordinatorOccurrenceId
      hasLaunchEvent
      hasLiquidityEvent
      hasInitialBuyEvent
      hasCustodyEvent
      hasCoordinatorEvent
      hasPoolRegistrationEvent
      hasPoolFeeDisclosureEvent
      hasRewardVaultFactoryEvent
      provenanceValid
      isComplete
      updatedBlock
    }
  }
`;

const CLASSIC_V3_LAUNCH_EVENTS_QUERY = `
  query ProgrammableClassicV3LaunchEvents($ids: [String!]!) {
    ChainEvent(
      where: { id: { _in: $ids } }
      order_by: [{ id: asc }]
    ) {
      id
      downstreamLogicalId
      receiptLogOrdinal
      chainId
      blockNumber
      blockHash
      blockTimestamp
      transactionHash
      transactionIndex
      blockGlobalLogIndex
      sourceAddress
      contractName
      eventName
      model
      releaseVersion
      decodedPayload
      payloadHash
    }
  }
`;

const LAUNCH_KEYS = [
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
] as const;

const EVENT_KEYS = [
  "id",
  "downstreamLogicalId",
  "receiptLogOrdinal",
  "chainId",
  "blockNumber",
  "blockHash",
  "blockTimestamp",
  "transactionHash",
  "transactionIndex",
  "blockGlobalLogIndex",
  "sourceAddress",
  "contractName",
  "eventName",
  "model",
  "releaseVersion",
  "decodedPayload",
  "payloadHash",
] as const;

type CatalogReadOptions = Readonly<{
  signal?: AbortSignal;
  /** Absolute Unix epoch deadline in milliseconds. */
  deadlineMs?: number;
}>;

type EnvioClassicV3LaunchRow = Readonly<{
  id: string;
  launchHash: Hex;
  token: Address;
  creator: Address;
  poolId: Hex;
  hook: Address;
  rewardVault: Address;
  positionRecipient: Address;
  positionTokenId: string;
  buySwapFeeBps: number;
  sellSwapFeeBps: number;
  rewardConfigurationHash: Hex;
  totalSupply: string;
  tokenLiquidityAmount: string;
  lockedTokenDust: string;
  initialTick: number;
  tickLower: number;
  tickUpper: number;
  lpFeePips: number;
  launchOccurrenceId: string;
  updatedBlock: string;
}>;

type EnvioClassicV3LaunchEvent = Readonly<{
  id: string;
  blockNumber: string;
  blockHash: Hex;
  blockTimestamp: string;
  transactionHash: Hex;
  transactionIndex: number;
  blockGlobalLogIndex: number;
  decodedPayload: Readonly<Record<string, string>>;
}>;

type TokenMetadata = Readonly<{
  tokenAddress: Address;
  name: string;
  symbol: string;
  decimals: number;
}>;

type RpcCatalogSnapshot = Readonly<{
  headBlock: string;
  anchorBlockHash: Hex;
  anchorBlockTimestamp: string;
  metadata: ReadonlyMap<string, TokenMetadata>;
}>;

export type EnvioClassicV3CatalogV1 = Readonly<{
  source: "envio-classic-v3";
  status: "current" | "last-known-good";
  generatedAt: string;
  asOfBlock: string;
  asOfBlockHash: Hex;
  entries: readonly ExploreEntry[];
  completeness: Readonly<{
    classic: "current" | "last-known-good";
    stock: "excluded";
    custom: "unavailable";
  }>;
  scope: Readonly<{
    included: readonly ["classic-v3", "registry.custom-launched"];
    excluded: readonly [
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ];
    publicCategories: readonly ["classic", "custom"];
  }>;
  evidence: Readonly<{
    kind: "envio-indexer-state";
    deployment: string;
    sourceCommit: string;
    progressBlock: string;
    progressOccurrenceId: string;
    commitment: `sha256:${string}`;
  }>;
}>;

export type EnvioClassicV3CatalogDependenciesV1 = Readonly<{
  fetcher?: DataPipelineFetcher;
  readRpcSnapshot?: (input: Readonly<{
    anchorBlock: string;
    tokens: readonly Address[];
    deadlineMs: number;
    signal: AbortSignal;
  }>) => Promise<RpcCatalogSnapshot>;
  now?: () => number;
}>;

type CatalogFlight = {
  promise: Promise<EnvioClassicV3CatalogV1>;
  controller: AbortController;
  waiters: number;
  settled: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function unsignedText(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error(`Envio ${label} is invalid`);
  }
  return value;
}

function safeUnsignedInteger(value: unknown, label: string): number {
  const text = unsignedText(value, label);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) throw new Error(`Envio ${label} is unsafe`);
  return parsed;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`Envio ${label} is invalid`);
  }
  return value;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw new Error(`Envio ${label} is invalid`);
  }
  return getAddress(value);
}

function bytes32(value: unknown, label: string): Hex {
  if (
    typeof value !== "string" ||
    !isHex(value) ||
    value.length !== 66 ||
    !/^0x[0-9a-f]{64}$/u.test(value)
  ) {
    throw new Error(`Envio ${label} is invalid`);
  }
  return value as Hex;
}

function exactString(value: unknown, pattern: RegExp, label: string) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`Envio ${label} is invalid`);
  }
  return value;
}

function launchSourceBindings(release: DataPipelineReleaseBinding) {
  const classicV3 = release.releases.find((candidate) =>
    candidate.model === "classic" &&
    candidate.releaseVersion === "classic-v3"
  );
  if (!classicV3) throw new Error("Classic V3 Envio release is not bound");
  const launcher = release.sources.find(
    (candidate) => candidate.contractName === "ClassicV3Launcher",
  );
  const hook = release.sources.find(
    (candidate) => candidate.contractName === "ClassicV3Hook",
  );
  if (
    !launcher ||
    !hook ||
    !classicV3.sourceContracts.includes(launcher.contractName) ||
    !classicV3.sourceContracts.includes(hook.contractName)
  ) {
    throw new Error("Classic V3 Envio source bindings are incomplete");
  }
  return Object.freeze({ launcher, hook });
}

function parseLaunchRow(
  value: unknown,
  release: DataPipelineReleaseBinding,
): EnvioClassicV3LaunchRow {
  if (!isRecord(value) || !hasOnlyKeys(value, LAUNCH_KEYS)) {
    throw new Error("Envio Classic V3 launch row shape drifted");
  }
  const sources = launchSourceBindings(release);
  const launchHash = bytes32(value.launchHash, "launch hash");
  const token = address(value.token, "token");
  const creator = address(value.creator, "creator");
  const hook = address(value.hook, "hook");
  const rewardVault = address(value.rewardVault, "reward vault");
  const positionRecipient = address(value.positionRecipient, "position recipient");
  const poolId = bytes32(value.poolId, "pool id");
  const rewardConfigurationHash = bytes32(
    value.rewardConfigurationHash,
    "reward configuration hash",
  );
  const id = exactString(
    value.id,
    /^1:classic-v3:0x[0-9a-f]{64}$/u,
    "launch id",
  );
  const launchOccurrenceId = exactString(
    value.launchOccurrenceId,
    /^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:(?:0|[1-9][0-9]*)$/u,
    "launch occurrence",
  );
  const requiredFlags = [
    value.hasLaunchEvent,
    value.hasLiquidityEvent,
    value.hasInitialBuyEvent,
    value.hasCustodyEvent,
    value.hasPoolRegistrationEvent,
    value.hasPoolFeeDisclosureEvent,
    value.hasRewardVaultFactoryEvent,
    value.provenanceValid,
    value.isComplete,
  ];
  if (
    value.chainId !== 1 ||
    value.model !== "classic" ||
    value.releaseVersion !== "classic-v3" ||
    value.quoteAsset !== null ||
    value.totalSwapFeeBps !== null ||
    value.quoteConfigurationHash !== null ||
    value.coordinatorOccurrenceId !== null ||
    value.hasCoordinatorEvent !== false ||
    id !== `1:classic-v3:${launchHash}` ||
    hook.toLowerCase() !== sources.hook.address.toLowerCase() ||
    requiredFlags.some((flag) => flag !== true) ||
    typeof value.liquidityOccurrenceId !== "string" ||
    typeof value.initialBuyOccurrenceId !== "string" ||
    typeof value.custodyOccurrenceId !== "string"
  ) {
    throw new Error(`Envio Classic V3 launch ${id} failed release validation`);
  }
  const buySwapFeeBps = boundedInteger(
    value.buySwapFeeBps,
    0,
    10_000,
    "buy swap fee",
  );
  const sellSwapFeeBps = boundedInteger(
    value.sellSwapFeeBps,
    0,
    10_000,
    "sell swap fee",
  );
  return Object.freeze({
    id,
    launchHash,
    token,
    creator,
    poolId,
    hook,
    rewardVault,
    positionRecipient,
    positionTokenId: unsignedText(value.positionTokenId, "position token id"),
    buySwapFeeBps,
    sellSwapFeeBps,
    rewardConfigurationHash,
    totalSupply: unsignedText(value.totalSupply, "total supply"),
    tokenLiquidityAmount: unsignedText(
      value.tokenLiquidityAmount,
      "token liquidity amount",
    ),
    lockedTokenDust: unsignedText(value.lockedTokenDust, "locked token dust"),
    initialTick: boundedInteger(
      value.initialTick,
      -887_272,
      887_272,
      "initial tick",
    ),
    tickLower: boundedInteger(value.tickLower, -887_272, 887_272, "tick lower"),
    tickUpper: boundedInteger(value.tickUpper, -887_272, 887_272, "tick upper"),
    lpFeePips: boundedInteger(value.lpFeePips, 0, 1_000_000, "LP fee"),
    launchOccurrenceId,
    updatedBlock: unsignedText(value.updatedBlock, "updated block"),
  });
}

function parseLaunchEvent(
  value: unknown,
  expectedOccurrenceId: string,
  release: DataPipelineReleaseBinding,
): EnvioClassicV3LaunchEvent {
  if (!isRecord(value) || !hasOnlyKeys(value, EVENT_KEYS)) {
    throw new Error("Envio Classic V3 launch event shape drifted");
  }
  const sources = launchSourceBindings(release);
  const id = exactString(
    value.id,
    /^1:0x[0-9a-f]{64}:0x[0-9a-f]{64}:(?:0|[1-9][0-9]*)$/u,
    "event id",
  );
  const blockHash = bytes32(value.blockHash, "event block hash");
  const transactionHash = bytes32(value.transactionHash, "event transaction hash");
  const blockGlobalLogIndex = safeUnsignedInteger(
    value.blockGlobalLogIndex,
    "event log index",
  );
  if (
    value.downstreamLogicalId !== null ||
    value.receiptLogOrdinal !== null ||
    typeof value.decodedPayload !== "string"
  ) {
    throw new Error(`Envio Classic V3 event ${id} has invalid source semantics`);
  }
  bytes32(value.payloadHash, "event payload hash");
  let decodedPayload: unknown;
  try {
    decodedPayload = JSON.parse(value.decodedPayload);
  } catch {
    throw new Error(`Envio Classic V3 event ${id} payload is invalid`);
  }
  const payloadKeys = [
    "buySwapFeeBps",
    "deployer",
    "feeHook",
    "launchHash",
    "poolId",
    "positionRecipient",
    "positionTokenId",
    "rewardConfigurationHash",
    "rewardVault",
    "sellSwapFeeBps",
    "token",
  ] as const;
  if (
    !isRecord(decodedPayload) ||
    !hasOnlyKeys(decodedPayload, payloadKeys) ||
    Object.values(decodedPayload).some((item) => typeof item !== "string")
  ) {
    throw new Error(`Envio Classic V3 event ${id} payload shape drifted`);
  }
  if (
    id !== expectedOccurrenceId ||
    value.chainId !== 1 ||
    value.model !== "classic" ||
    value.releaseVersion !== "classic-v3" ||
    value.contractName !== "ClassicV3Launcher" ||
    value.eventName !== "MemeTokenLaunchedV2" ||
    address(value.sourceAddress, "event source").toLowerCase() !==
      sources.launcher.address.toLowerCase() ||
    id !== `1:${blockHash}:${transactionHash}:${blockGlobalLogIndex}`
  ) {
    throw new Error(`Envio Classic V3 event ${id} failed occurrence validation`);
  }
  return Object.freeze({
    id,
    blockNumber: unsignedText(value.blockNumber, "event block number"),
    blockHash,
    blockTimestamp: unsignedText(value.blockTimestamp, "event block timestamp"),
    transactionHash,
    transactionIndex: safeUnsignedInteger(
      value.transactionIndex,
      "event transaction index",
    ),
    blockGlobalLogIndex,
    decodedPayload: decodedPayload as Record<string, string>,
  });
}

function assertLaunchEventBinding(
  launch: EnvioClassicV3LaunchRow,
  event: EnvioClassicV3LaunchEvent,
  release: DataPipelineReleaseBinding,
) {
  const classicV3 = release.releases.find((candidate) =>
    candidate.releaseVersion === "classic-v3"
  );
  if (!classicV3) throw new Error("Classic V3 Envio release is unavailable");
  const payload = event.decodedPayload;
  const sameHex = (left: string, right: string) =>
    left.toLowerCase() === right.toLowerCase();
  if (
    BigInt(event.blockNumber) < BigInt(classicV3.activationBlock) ||
    BigInt(launch.updatedBlock) < BigInt(event.blockNumber) ||
    !sameHex(payload.launchHash!, launch.launchHash) ||
    !sameHex(payload.token!, launch.token) ||
    !sameHex(payload.deployer!, launch.creator) ||
    !sameHex(payload.poolId!, launch.poolId) ||
    !sameHex(payload.feeHook!, launch.hook) ||
    !sameHex(payload.rewardVault!, launch.rewardVault) ||
    !sameHex(payload.positionRecipient!, launch.positionRecipient) ||
    payload.positionTokenId !== launch.positionTokenId ||
    payload.buySwapFeeBps !== String(launch.buySwapFeeBps) ||
    payload.sellSwapFeeBps !== String(launch.sellSwapFeeBps) ||
    !sameHex(
      payload.rewardConfigurationHash!,
      launch.rewardConfigurationHash,
    )
  ) {
    throw new Error(`Envio Classic V3 launch ${launch.id} payload binding failed`);
  }
}

function parseRows(response: unknown, field: "Launch" | "ChainEvent") {
  if (
    !isRecord(response) ||
    !hasOnlyKeys(response, ["data"]) ||
    !isRecord(response.data) ||
    !hasOnlyKeys(response.data, [field]) ||
    !Array.isArray(response.data[field])
  ) {
    throw new Error(`Envio ${field} response shape drifted`);
  }
  return response.data[field];
}

function boundFetcher(
  fetcher: DataPipelineFetcher | undefined,
  signal: AbortSignal,
  deadlineMs: number,
): DataPipelineFetcher {
  return async (input, init) => {
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) throw new Error("Envio catalog deadline exceeded");
    const signals = [signal, AbortSignal.timeout(remaining)];
    if (init?.signal) signals.push(init.signal);
    return await (fetcher ?? fetch)(input, {
      ...init,
      signal: AbortSignal.any(signals),
    });
  };
}

async function graphqlRequest(
  release: DataPipelineReleaseBinding,
  body: unknown,
  fetcher: DataPipelineFetcher,
) {
  return await boundedJsonRequest<unknown>({
    dependency: "envio",
    endpoint: release.envio.graphqlEndpoint,
    timeoutMs: GRAPHQL_TIMEOUT_MS,
    maximumBodyBytes: GRAPHQL_MAXIMUM_BODY_BYTES,
    fetcher,
    body,
  });
}

async function readClassicV3Rows(
  release: DataPipelineReleaseBinding,
  anchorBlock: string,
  fetcher: DataPipelineFetcher,
) {
  const launches: EnvioClassicV3LaunchRow[] = [];
  const events = new Map<string, EnvioClassicV3LaunchEvent>();
  let afterId = "";
  while (true) {
    const launchResponse = await graphqlRequest(release, {
      query: CLASSIC_V3_LAUNCH_QUERY,
      variables: { afterId, anchorBlock, first: LAUNCH_PAGE_SIZE },
    }, fetcher);
    const rawLaunches = parseRows(launchResponse, "Launch");
    if (rawLaunches.length > LAUNCH_PAGE_SIZE) {
      throw new Error("Envio Classic V3 page exceeded its bound");
    }
    const page = rawLaunches.map((row) => parseLaunchRow(row, release));
    for (const launch of page) {
      if (
        launch.id <= afterId ||
        BigInt(launch.updatedBlock) > BigInt(anchorBlock)
      ) {
        throw new Error("Envio Classic V3 launch order drifted");
      }
      afterId = launch.id;
      launches.push(launch);
    }
    if (launches.length > MAXIMUM_LAUNCH_COUNT) {
      throw new Error("Envio Classic V3 catalog exceeded its safety bound");
    }
    if (page.length > 0) {
      const ids = page.map((launch) => launch.launchOccurrenceId);
      const eventResponse = await graphqlRequest(release, {
        query: CLASSIC_V3_LAUNCH_EVENTS_QUERY,
        variables: { ids },
      }, fetcher);
      const rawEvents = parseRows(eventResponse, "ChainEvent");
      if (rawEvents.length !== ids.length) {
        throw new Error("Envio Classic V3 occurrence coverage is incomplete");
      }
      const expected = new Set(ids);
      for (const rawEvent of rawEvents) {
        const rawId = isRecord(rawEvent) ? rawEvent.id : undefined;
        if (typeof rawId !== "string" || !expected.delete(rawId)) {
          throw new Error("Envio Classic V3 occurrence set drifted");
        }
        const event = parseLaunchEvent(rawEvent, rawId, release);
        if (BigInt(event.blockNumber) > BigInt(anchorBlock)) {
          throw new Error("Envio Classic V3 occurrence exceeds progress");
        }
        events.set(event.id, event);
      }
      if (expected.size !== 0) {
        throw new Error("Envio Classic V3 occurrence coverage is incomplete");
      }
      for (const launch of page) {
        const event = events.get(launch.launchOccurrenceId);
        if (!event) {
          throw new Error("Envio Classic V3 occurrence coverage is incomplete");
        }
        assertLaunchEventBinding(launch, event, release);
      }
    }
    if (page.length < LAUNCH_PAGE_SIZE) break;
  }
  if (launches.length === 0) {
    throw new Error("Envio Classic V3 catalog is empty");
  }
  const launchIds = new Set<string>();
  const tokens = new Set<string>();
  const pools = new Set<string>();
  const occurrences = new Set<string>();
  for (const launch of launches) {
    const token = launch.token.toLowerCase();
    const pool = launch.poolId.toLowerCase();
    if (
      launchIds.has(launch.id) ||
      tokens.has(token) ||
      pools.has(pool) ||
      occurrences.has(launch.launchOccurrenceId)
    ) {
      throw new Error("Envio Classic V3 catalog contains duplicate identities");
    }
    launchIds.add(launch.id);
    tokens.add(token);
    pools.add(pool);
    occurrences.add(launch.launchOccurrenceId);
  }
  return Object.freeze({
    launches: Object.freeze(launches),
    events,
  });
}

function validTokenMetadata(
  tokenAddress: Address,
  nameValue: unknown,
  symbolValue: unknown,
  decimalsValue: unknown,
): TokenMetadata {
  const name = typeof nameValue === "string" ? nameValue.trim() : "";
  const symbol = typeof symbolValue === "string" ? symbolValue.trim() : "";
  if (
    !name ||
    name !== nameValue ||
    characterLength(name) > MAX_TOKEN_NAME_CHARACTERS ||
    utf8ByteLength(name) > MAX_TOKEN_NAME_BYTES ||
    hasUnsafeDisplayCharacters(name) ||
    !symbol ||
    symbol !== symbolValue ||
    utf8ByteLength(symbol) > MAX_TOKEN_SYMBOL_BYTES ||
    !isValidTokenSymbol(symbol) ||
    typeof decimalsValue !== "number" ||
    !Number.isInteger(decimalsValue) ||
    decimalsValue < 0 ||
    decimalsValue > 255
  ) {
    throw new Error(`Token metadata is invalid for ${tokenAddress}`);
  }
  return Object.freeze({
    tokenAddress,
    name,
    symbol,
    decimals: decimalsValue,
  });
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
) {
  const output = new Array<Output>(values.length);
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (cursor < values.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await mapper(values[index]!);
      }
    },
  ));
  return output;
}

async function defaultReadRpcSnapshot(input: Readonly<{
  anchorBlock: string;
  tokens: readonly Address[];
  deadlineMs: number;
  signal: AbortSignal;
}>): Promise<RpcCatalogSnapshot> {
  const deployment = getWebsiteReadOnchainDeployment("production");
  if (deployment.status !== "ready") {
    throw new Error("Production RPC metadata binding is unavailable");
  }
  return await withOperationalRpcFailover(deployment, async (selected) => {
    const remaining = input.deadlineMs - Date.now();
    if (remaining <= 0 || input.signal.aborted) {
      throw input.signal.reason ?? new Error("RPC metadata deadline exceeded");
    }
    const client = createPublicClient({
      chain: mainnet,
      transport: http(selected.rpcUrl, {
        retryCount: 1,
        timeout: Math.max(250, Math.min(remaining, 4_000)),
      }),
    });
    const anchorBlock = BigInt(input.anchorBlock);
    const [headBlock, anchor] = await Promise.all([
      client.getBlockNumber(),
      client.getBlock({ blockNumber: anchorBlock, includeTransactions: false }),
    ]);
    if (!anchor.hash || anchor.number !== anchorBlock) {
      throw new Error("RPC metadata anchor is unavailable");
    }
    const batches = Array.from(
      {
        length: Math.ceil(
          input.tokens.length / ENVIO_CLASSIC_V3_TOKEN_METADATA_BATCH_SIZE,
        ),
      },
      (_value, index) => input.tokens.slice(
        index * ENVIO_CLASSIC_V3_TOKEN_METADATA_BATCH_SIZE,
        (index + 1) * ENVIO_CLASSIC_V3_TOKEN_METADATA_BATCH_SIZE,
      ),
    );
    const hydrated = await mapWithConcurrency(
      batches,
      ENVIO_CLASSIC_V3_TOKEN_METADATA_CONCURRENCY,
      async (tokens) => {
        if (input.signal.aborted || Date.now() >= input.deadlineMs) {
          throw input.signal.reason ?? new Error("RPC metadata deadline exceeded");
        }
        const contracts = tokens.flatMap((tokenAddress) => [
          { address: tokenAddress, abi: uerc20ReadAbi, functionName: "name" as const },
          { address: tokenAddress, abi: uerc20ReadAbi, functionName: "symbol" as const },
          { address: tokenAddress, abi: uerc20ReadAbi, functionName: "decimals" as const },
        ]);
        const results = await client.multicall({
          contracts,
          blockNumber: anchorBlock,
          allowFailure: true,
        });
        return tokens.map((tokenAddress, index) => {
          const name = results[index * 3];
          const symbol = results[index * 3 + 1];
          const decimals = results[index * 3 + 2];
          if (
            name?.status !== "success" ||
            symbol?.status !== "success" ||
            decimals?.status !== "success"
          ) {
            throw new Error(`Token metadata read failed for ${tokenAddress}`);
          }
          return validTokenMetadata(
            tokenAddress,
            name.result,
            symbol.result,
            decimals.result,
          );
        });
      },
    );
    return Object.freeze({
      headBlock: headBlock.toString(),
      anchorBlockHash: anchor.hash,
      anchorBlockTimestamp: anchor.timestamp.toString(),
      metadata: new Map(
        hydrated.flat().map((entry) => [entry.tokenAddress.toLowerCase(), entry]),
      ),
    });
  });
}

function buildEntries(
  launches: readonly EnvioClassicV3LaunchRow[],
  events: ReadonlyMap<string, EnvioClassicV3LaunchEvent>,
  metadata: ReadonlyMap<string, TokenMetadata>,
) {
  return Object.freeze(launches.map((launch) => {
    const event = events.get(launch.launchOccurrenceId);
    const tokenMetadata = metadata.get(launch.token.toLowerCase());
    if (!event || !tokenMetadata) {
      throw new Error(`Envio Classic V3 launch ${launch.id} is not hydrated`);
    }
    const totalSwapFeeBps = Math.max(
      launch.buySwapFeeBps,
      launch.sellSwapFeeBps,
    );
    const token: LauncherToken = {
      id: `1:${launch.token.toLowerCase()}`,
      name: tokenMetadata.name,
      symbol: tokenMetadata.symbol,
      tokenAddress: launch.token,
      hookAddress: launch.hook,
      poolId: launch.poolId,
      creatorAddress: launch.creator,
      rewardVaultAddress: launch.rewardVault,
      positionRecipient: launch.positionRecipient,
      positionTokenId: launch.positionTokenId,
      launchHash: launch.launchHash,
      launchBlockNumber: event.blockNumber,
      launchTransactionHash: event.transactionHash,
      launchTransactionIndex: event.transactionIndex,
      launchLogIndex: event.blockGlobalLogIndex,
      launchedAt: new Date(Number(BigInt(event.blockTimestamp)) * 1_000).toISOString(),
      totalSupply: formatUnits(
        BigInt(launch.totalSupply),
        tokenMetadata.decimals,
      ),
      totalSupplyRaw: launch.totalSupply,
      tokenDecimals: tokenMetadata.decimals,
      tokenLiquidityAmountRaw: launch.tokenLiquidityAmount,
      lockedTokenDustRaw: launch.lockedTokenDust,
      quoteAssetAddress: NATIVE_CURRENCY_ADDRESS,
      quoteAssetSymbol: "ETH",
      quoteAssetName: "Ether",
      buyHookFeeBps: launch.buySwapFeeBps,
      sellHookFeeBps: launch.sellSwapFeeBps,
      totalSwapFeeBps,
      initialTick: launch.initialTick,
      tickLower: launch.tickLower,
      tickUpper: launch.tickUpper,
      lpFeePips: launch.lpFeePips,
      launchModel: "classic",
      launchModelVersion: "classic-v3",
      liquidityPath: "meme",
    };
    return canonicalTokenExploreEntryV1(token);
  }));
}

async function readUncached(
  options: Required<Pick<CatalogReadOptions, "signal" | "deadlineMs">>,
  dependencies: EnvioClassicV3CatalogDependenciesV1,
): Promise<EnvioClassicV3CatalogV1> {
  const release = getDataPipelineReleaseBinding();
  const fetcher = boundFetcher(
    dependencies.fetcher,
    options.signal,
    options.deadlineMs,
  );
  const progress = await createEnvioClient({
    endpoint: release.envio.graphqlEndpoint,
    releaseBinding: release,
    fetcher,
  }).readProgress({ requiredBlock: "0" });
  if (!progress.isReady) throw new Error("Envio Classic V3 indexer is not ready");
  const sourceLag = BigInt(progress.sourceBlock) - BigInt(progress.progressBlock);
  if (sourceLag < 0n || sourceLag > BigInt(release.confirmations)) {
    throw new Error("Envio Classic V3 indexer freshness is invalid");
  }
  const rows = await readClassicV3Rows(
    release,
    progress.progressBlock,
    fetcher,
  );
  const rpc = await (dependencies.readRpcSnapshot ?? defaultReadRpcSnapshot)({
    anchorBlock: progress.progressBlock,
    tokens: rows.launches.map((launch) => launch.token),
    deadlineMs: options.deadlineMs,
    signal: options.signal,
  });
  const rpcLag = BigInt(rpc.headBlock) - BigInt(progress.progressBlock);
  if (
    rpcLag < 0n ||
    rpcLag > BigInt(release.confirmations) + MAXIMUM_RPC_HEAD_SKEW_BLOCKS ||
    rpc.metadata.size !== rows.launches.length
  ) {
    throw new Error("Envio Classic V3 RPC freshness or metadata coverage failed");
  }
  const safeHead = BigInt(rpc.headBlock) > BigInt(release.confirmations)
    ? BigInt(rpc.headBlock) - BigInt(release.confirmations)
    : 0n;
  const finalProgress = await createEnvioClient({
    endpoint: release.envio.graphqlEndpoint,
    releaseBinding: release,
    fetcher,
  }).readProgress({ requiredBlock: safeHead.toString() });
  if (
    !finalProgress.isReady ||
    BigInt(finalProgress.progressBlock) < BigInt(progress.progressBlock) ||
    finalProgress.deployment !== progress.deployment
  ) {
    throw new Error("Envio Classic V3 progress regressed during catalog read");
  }
  const generatedAt = new Date(
    Number(BigInt(rpc.anchorBlockTimestamp)) * 1_000,
  ).toISOString();
  const entries = buildEntries(rows.launches, rows.events, rpc.metadata);
  const evidenceCore = {
    deployment: progress.deployment,
    sourceCommit: release.envio.sourceCommit,
    progressBlock: progress.progressBlock,
    progressBlockHash: rpc.anchorBlockHash,
    progressOccurrenceId: progress.lastHandledEventOccurrenceId,
    indexerStateCommitments: {
      config: release.envio.configSha256,
      schema: release.envio.schemaSha256,
      handler: release.envio.handlerSha256,
      sourceRegistry: release.envio.sourceRegistrySha256,
      eventSet: release.envio.eventSetSha256,
    },
  };
  return Object.freeze({
    source: "envio-classic-v3" as const,
    status: "current" as const,
    generatedAt,
    asOfBlock: progress.progressBlock,
    asOfBlockHash: rpc.anchorBlockHash,
    entries,
    completeness: Object.freeze({
      classic: "current" as const,
      stock: "excluded" as const,
      custom: "unavailable" as const,
    }),
    scope: Object.freeze({
      included: Object.freeze([
        "classic-v3",
        "registry.custom-launched",
      ] as const),
      excluded: Object.freeze([
        "classic-v1",
        "classic-v2",
        "stock-paired-v1",
        "stock-paired-v2",
        "stock-paired-v3",
      ] as const),
      publicCategories: Object.freeze(["classic", "custom"] as const),
    }),
    evidence: Object.freeze({
      kind: "envio-indexer-state" as const,
      deployment: progress.deployment,
      sourceCommit: release.envio.sourceCommit,
      progressBlock: progress.progressBlock,
      progressOccurrenceId: progress.lastHandledEventOccurrenceId,
      commitment: canonicalSha256(
        "programmable.envio-classic-v3-catalog-evidence.v1",
        evidenceCore,
      ),
    }),
  });
}

function assertCallerActive(options: CatalogReadOptions, now: number) {
  if (
    options.deadlineMs !== undefined &&
    (!Number.isFinite(options.deadlineMs) || options.deadlineMs <= now)
  ) {
    throw new Error("Envio Classic V3 catalog deadline exceeded");
  }
  if (options.signal?.aborted) {
    throw options.signal.reason ?? new Error("Envio Classic V3 catalog read aborted");
  }
}

function waitForCaller<T>(
  operation: Promise<T>,
  options: CatalogReadOptions,
  now: () => number,
): Promise<T> {
  assertCallerActive(options, now());
  if (options.signal === undefined && options.deadlineMs === undefined) {
    return operation;
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(
      options.signal?.reason ?? new Error("Envio Classic V3 catalog read aborted"),
    ));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.deadlineMs !== undefined) {
      timer = setTimeout(
        () => finish(() => reject(
          new Error("Envio Classic V3 catalog deadline exceeded"),
        )),
        Math.max(0, options.deadlineMs - now()),
      );
    }
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export function createEnvioClassicV3CatalogReaderV1(
  dependencies: EnvioClassicV3CatalogDependenciesV1 = {},
) {
  const now = dependencies.now ?? Date.now;
  let cached: Readonly<{
    expiresAt: number;
    staleUntil: number;
    catalog: EnvioClassicV3CatalogV1;
  }> | null = null;
  let inFlight: CatalogFlight | null = null;

  const createFlight = () => {
    const controller = new AbortController();
    const flight: CatalogFlight = {
      promise: Promise.resolve(undefined as never),
      controller,
      waiters: 0,
      settled: false,
    };
    flight.promise = readUncached({
      signal: controller.signal,
      deadlineMs: now() + CATALOG_WORKER_TIMEOUT_MS,
    }, dependencies).then((catalog) => {
      cached = {
        expiresAt: now() + CATALOG_CACHE_TTL_MS,
        staleUntil: now() + CATALOG_STALE_GRACE_MS,
        catalog,
      };
      return catalog;
    }).finally(() => {
      flight.settled = true;
      if (inFlight === flight) inFlight = null;
    });
    inFlight = flight;
    return flight;
  };

  return async function readEnvioClassicV3CatalogV1(
    options: CatalogReadOptions = {},
  ) {
    assertCallerActive(options, now());
    if (cached && cached.expiresAt > now()) return cached.catalog;
    const flight = inFlight ?? createFlight();
    flight.waiters += 1;
    try {
      try {
        return await waitForCaller(flight.promise, options, now);
      } catch (error) {
        if (cached && cached.staleUntil > now()) {
          return Object.freeze({
            ...cached.catalog,
            status: "last-known-good" as const,
            completeness: Object.freeze({
              ...cached.catalog.completeness,
              classic: "last-known-good" as const,
            }),
          });
        }
        throw error;
      }
    } finally {
      flight.waiters -= 1;
      if (
        flight.waiters === 0 &&
        !flight.settled &&
        inFlight === flight &&
        !flight.controller.signal.aborted
      ) {
        flight.controller.abort(
          new Error("Envio Classic V3 catalog has no active readers"),
        );
      }
    }
  };
}

const readProductionEnvioClassicV3Catalog =
  createEnvioClassicV3CatalogReaderV1();

export async function readEnvioClassicV3CatalogV1(
  options: CatalogReadOptions = {},
) {
  return await readProductionEnvioClassicV3Catalog(options);
}

function assertUniqueEntries(entries: readonly ExploreEntry[]) {
  const ids = new Set<string>();
  const tokens = new Set<string>();
  for (const entry of entries) {
    const token = entry.tokenAddress?.toLowerCase();
    if (ids.has(entry.id) || (token !== undefined && tokens.has(token))) {
      throw new Error("Launch catalog contains duplicate identities");
    }
    ids.add(entry.id);
    if (token !== undefined) tokens.add(token);
  }
}

export function mergeEnvioClassicV3CatalogEntriesV1(
  canonical: readonly ExploreEntry[],
  custom: readonly ExploreEntry[],
) {
  const producedCustomEntries = custom.filter((entry) =>
    entry.exploreKind === "custom-project" &&
    entry.launchCategoryProvenance.source === "registry.custom-launched" &&
    (entry.tokenAddress !== undefined || entry.markets.length > 0)
  );
  const entries = Object.freeze([...canonical, ...producedCustomEntries]);
  assertUniqueEntries(entries);
  return entries;
}

export function envioClassicV3IdentityCommitmentV1(
  catalog: EnvioClassicV3CatalogV1,
  entries: readonly ExploreEntry[],
) {
  return canonicalSha256("programmable.envio-classic-v3-identity.v1", {
    source: catalog.source,
    entries: [...entries]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) => entry.exploreKind === "token"
        ? {
            kind: entry.exploreKind,
            id: entry.id,
            tokenAddress: entry.tokenAddress,
            poolId: entry.poolId,
            provenance: entry.launchCategoryProvenance,
          }
        : {
            kind: entry.exploreKind,
            id: entry.id,
            customProjectId: entry.customProjectId,
            customLaunchId: entry.customLaunchId,
            tokenAddress: entry.tokenAddress ?? null,
            markets: entry.markets.map((market) => ({
              marketId: market.marketId,
              kind: market.kind,
              status: market.status,
              poolId: market.poolId ?? null,
              baseAsset: market.baseAsset.identity,
              quoteAsset: market.quoteAsset.identity,
            })),
            provenance: entry.launchCategoryProvenance,
          }),
  });
}
