import "server-only";

import {
  decodeAbiParameters,
  decodeEventLog,
  formatUnits,
  keccak256,
  parseAbiItem,
  toBytes,
  toEventSelector,
  type AbiEvent,
  type Hex,
} from "viem";

import type { LauncherToken } from "../tokens";
import {
  addressFromBytea,
  bytes32FromBytea,
  canonicalAddress,
  canonicalBytes32,
  canonicalRawData,
  dataFromBytea,
  hexToBytes,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
  type HexData,
} from "./codecs";
import {
  readDualRpcTokenMetadataWithTrace,
  type CandidateRpcProvider,
} from "./dual-rpc";
import type { EnvioCandidate } from "./envio";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import {
  PROGRAMMABLE_EVENT_SIGNATURES,
  canonicalizeAbiEventArguments,
  decodeManifestEvent,
} from "./event-manifest";
import {
  type DualRpcOptimisticBlock,
  type OptimisticManifestLog,
  type QuickNodeBlockHint,
  readOptimisticBlockWithDualRpc,
} from "./optimistic-block-reader.server";
import {
  computeOptimisticMarketStateCommitments,
  OPTIMISTIC_MAINNET_STATE_VIEW,
  OPTIMISTIC_MAINNET_STATE_VIEW_RUNTIME_CODE_HASH,
  OPTIMISTIC_MARKET_STATE_VERSION,
  readOptimisticMarketState,
  type OptimisticMarketStateResult,
  type OptimisticNewLaunchMarketInput,
} from "./optimistic-market-state.server";
import {
  mergeOptimisticTokenCorpus,
  selectEligibleOptimisticOverlay,
  type OptimisticMarketFields,
  type OptimisticOverlayRow,
  type OptimisticTokenCorpusResult,
} from "./optimistic-read-overlay.server";
import {
  establishPostgresApiReaderRole,
  postgresJson,
  type PostgresExecutor,
  type PostgresTransaction,
} from "./postgres";
import {
  createProjectorDatabaseGateway,
  type ProjectorDatabaseError,
} from "./postgres-projector";
import {
  foldProjectorEvents,
  type ProjectorCompletedLaunch,
  type ProjectorFoldEvent,
} from "./projector-fold";
import { getServerReadModel } from "./read-model.server";
import { getDataPipelineReleaseBinding } from "./release-binding.server";

export {
  computeOptimisticMarketStateCommitments,
  OPTIMISTIC_MAINNET_STATE_VIEW,
  OPTIMISTIC_MAINNET_STATE_VIEW_RUNTIME_CODE_HASH,
  OPTIMISTIC_MARKET_STATE_VERSION,
} from "./optimistic-market-state.server";

const RELEASE_BINDING = getDataPipelineReleaseBinding();
const MAXIMUM_OPTIMISTIC_CONFIRMATIONS = 11;
const MAXIMUM_PERSISTED_EVENTS_PER_BLOCK = 500;
const MAXIMUM_PERSISTED_MARKET_STATES_PER_BLOCK = 100;
const LIVE_BLOCK_WINDOW = 12n;
const MAXIMUM_LIVE_EVENTS =
  MAXIMUM_PERSISTED_EVENTS_PER_BLOCK * Number(LIVE_BLOCK_WINDOW);
const LIVE_EVENT_PAGE_SIZE = 500;
const MAXIMUM_LIVE_MARKET_STATES =
  MAXIMUM_PERSISTED_MARKET_STATES_PER_BLOCK * Number(LIVE_BLOCK_WINDOW);
const LIVE_MARKET_STATE_PAGE_SIZE = 100;
const MAXIMUM_LIVE_HEAD_AGE_MS = 60_000;
const MAXIMUM_LIVE_HEAD_CLOCK_SKEW_MS = 30_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NORMALIZED_EVENT_SCHEMA = "programmable-optimistic-event-v1" as const;
const UINT128_MAX = (1n << 128n) - 1n;
const UINT160_MAX = (1n << 160n) - 1n;
const PROTOCOL_FEE_DIRECTION_MASK = 0x0fff;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | Readonly<{ [key: string]: JsonValue }>;

type NormalizedTokenMetadata = Readonly<{
  name: string;
  symbol: string;
  blockHash: HexBytes32;
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
}>;

export type NormalizedOptimisticEventPayload = Readonly<{
  schema: typeof NORMALIZED_EVENT_SCHEMA;
  sourceContractName: string;
  eventName: string;
  blockTimestamp: string;
  arguments: Readonly<Record<string, JsonValue>>;
  tokenMetadata?: NormalizedTokenMetadata;
}>;

export type OptimisticProviderDeploymentBinding = Readonly<{
  providerDeploymentId: string;
  providerIdentity: string;
  endpointCommitment: HexBytes32;
  originCommitment: HexBytes32;
}>;

export type OptimisticPersistenceEvent = Readonly<{
  optimisticEventId: string;
  optimisticBlockId: string;
  transactionHash: HexBytes32;
  transactionIndex: number;
  blockGlobalLogIndex: number;
  sourceAddress: HexAddress;
  eventSignature: HexBytes32;
  orderedTopics: readonly HexBytes32[];
  rawData: HexData;
  normalizedPayload: NormalizedOptimisticEventPayload;
  payloadCommitment: HexBytes32;
}>;

export type OptimisticPersistenceBundle = Readonly<{
  optimisticBlockId: string;
  chainId: 1;
  blockNumber: string;
  blockHash: HexBytes32;
  parentHash: HexBytes32;
  blockTimestamp: string;
  providerDeploymentIds: readonly [string, string];
  providerHeads: readonly [string, string];
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerCallCounts: readonly [number, number];
  metadataProviderCallCounts: readonly [number, number];
  confirmations: number;
  evidenceCommitment: HexBytes32;
  logsCommitment?: HexBytes32;
  providerHeadObservations?: DualRpcOptimisticBlock["providerHeadObservations"];
  observedAt: string;
  events: readonly OptimisticPersistenceEvent[];
  marketStates: readonly OptimisticPersistenceMarketState[];
}>;

export type OptimisticPromotionPlan = Readonly<{
  mode: string;
  canPromote: boolean;
  expectedCurrentBlockId: string | null;
  orphanRequired: boolean;
  requiresRebootstrap: boolean;
  targetHeightCurrentBlockId: string | null;
  chainTipBlockId: string | null;
  chainTipBlockNumber: string | null;
  segmentStartBlockNumber: string | null;
  reorgGeneration: string | null;
  canonicalStatusId: string | null;
  orphanStatusId: string | null;
  storedDecisionCommitment: HexBytes32 | null;
  storedDecidedAt: string | null;
}>;

export type OptimisticPersistResult = Readonly<{
  optimisticBlockId: string;
  promotionMode: string;
  replayed: boolean;
  eventCount: number;
  marketStateCount: number;
}>;

export type OptimisticLiveHead = Readonly<{
  optimisticBlockId: string;
  chainId: 1;
  blockNumber: string;
  blockHash: HexBytes32;
  parentHash: HexBytes32;
  blockTimestamp: string;
  providerDeploymentIds: readonly [string, string];
  providerHeads: readonly [string, string];
  reorgGeneration: string;
  observedAt: string;
  canonicalAt: string;
}>;

export type OptimisticLiveBlock = Readonly<{
  optimisticBlockId: string;
  chainId: 1;
  blockNumber: string;
  blockHash: HexBytes32;
  parentHash: HexBytes32;
  reorgGeneration: string;
}>;

export type OptimisticLiveEvent = Readonly<{
  optimisticEventId: string;
  optimisticBlockId: string;
  chainId: 1;
  blockNumber: string;
  blockHash: HexBytes32;
  transactionHash: HexBytes32;
  transactionIndex: number;
  blockGlobalLogIndex: number;
  sourceAddress: HexAddress;
  eventSignature: HexBytes32;
  orderedTopics: readonly HexBytes32[];
  rawData: HexData;
  normalizedPayload: NormalizedOptimisticEventPayload;
  payloadCommitment: HexBytes32;
  reorgGeneration: string;
  observedAt: string;
}>;

export type OptimisticLiveSnapshot = Readonly<{
  head: OptimisticLiveHead | null;
  blocks: readonly OptimisticLiveBlock[];
  events: readonly OptimisticLiveEvent[];
  marketStates: readonly OptimisticLiveMarketState[];
}>;

export type OptimisticMarketStateEvidence = OptimisticMarketStateResult;

export type OptimisticPersistenceMarketState = OptimisticMarketStateEvidence &
  Readonly<{
    optimisticMarketStateId: string;
    optimisticBlockId: string;
    providerDeploymentIds: readonly [string, string];
    observedAt: string;
  }>;

export type OptimisticLiveMarketState = OptimisticPersistenceMarketState &
  Readonly<{ reorgGeneration: string }>;

type ManifestDescriptor = Readonly<{
  eventName: string;
  event: AbiEvent;
}>;

const MANIFEST_BY_CONTRACT_AND_SELECTOR = new Map<
  string,
  ReadonlyMap<HexBytes32, ManifestDescriptor>
>();

for (const [contractName, signatures] of Object.entries(
  PROGRAMMABLE_EVENT_SIGNATURES,
)) {
  const descriptors = new Map<HexBytes32, ManifestDescriptor>();
  for (const signature of signatures) {
    const event = parseAbiItem(`event ${signature}`);
    if (event.type !== "event") throw new TypeError("invalid event manifest");
    const selector = canonicalBytes32(toEventSelector(event));
    descriptors.set(selector, Object.freeze({ eventName: event.name, event }));
  }
  MANIFEST_BY_CONTRACT_AND_SELECTOR.set(contractName, descriptors);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw invalidInput("config", "optimistic-json");
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function commitment(domain: string, value: unknown): HexBytes32 {
  return canonicalBytes32(
    keccak256(toBytes(`${domain}\0${canonicalJson(value)}`)),
  );
}

function deterministicUuid(domain: string, value: unknown): string {
  const digest = hexToBytes(commitment(`uuid:${domain}`, value));
  const bytes = Uint8Array.from(digest.slice(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const DECIMAL_MARKET_FIELDS = Object.freeze([
  "tokenPriceEth",
  "marketCapEth",
  "indexedMarketCapEth",
  "grossVolumeEth",
  "creatorFeesGeneratedEth",
  "launcherFeesGeneratedEth",
  "creatorFeesAccruedEth",
] as const satisfies readonly (keyof OptimisticMarketFields)[]);
const UINT_MARKET_FIELDS = Object.freeze([
  "tokenPriceEthWei",
  "tokenPriceUsdWad",
  "marketCapEthWei",
  "indexedMarketCapEthWei",
  "indexedMarketCapUsdWad",
  "indexedValuationBlockNumber",
  "grossVolumeWei",
  "creatorFeesGeneratedWei",
  "launcherFeesGeneratedWei",
  "creatorFeesAccruedWei",
  "activeLiquidity",
] as const satisfies readonly (keyof OptimisticMarketFields)[]);
const MARKET_FIELD_KEYS = new Set<string>([
  ...DECIMAL_MARKET_FIELDS,
  ...UINT_MARKET_FIELDS,
  "swapCount",
  "currentTick",
]);
const BASE_MARKET_FIELD_KEYS = [
  "activeLiquidity",
  "currentTick",
  "indexedValuationBlockNumber",
] as const;
const CLASSIC_MARKET_FIELD_KEYS = [
  "activeLiquidity",
  "currentTick",
  "indexedMarketCapEth",
  "indexedMarketCapEthWei",
  "indexedValuationBlockNumber",
  "marketCapEth",
  "marketCapEthWei",
  "tokenPriceEth",
  "tokenPriceEthWei",
] as const;
const NONNEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/u;

function normalizeMarketFields(
  value: unknown,
  blockNumber: string,
): OptimisticMarketFields {
  if (
    !isPlainRecord(value) ||
    Object.keys(value).length === 0 ||
    Object.keys(value).some((key) => !MARKET_FIELD_KEYS.has(key)) ||
    ![
      BASE_MARKET_FIELD_KEYS.join("\0"),
      CLASSIC_MARKET_FIELD_KEYS.join("\0"),
    ].includes(Object.keys(value).sort().join("\0"))
  ) {
    throw validationError("postgres", "optimistic-market-fields");
  }
  const market: Record<string, string | number> = {};
  for (const field of DECIMAL_MARKET_FIELDS) {
    const fieldValue = value[field];
    if (fieldValue === undefined) continue;
    if (
      typeof fieldValue !== "string" ||
      fieldValue.length > 160 ||
      !NONNEGATIVE_DECIMAL.test(fieldValue)
    ) {
      throw validationError("postgres", "optimistic-market-fields");
    }
    market[field] = fieldValue;
  }
  for (const field of UINT_MARKET_FIELDS) {
    const fieldValue = value[field];
    if (fieldValue === undefined) continue;
    market[field] = integerText(fieldValue, "optimistic-market-fields");
  }
  if (value.swapCount !== undefined) {
    if (
      typeof value.swapCount !== "number" ||
      !Number.isSafeInteger(value.swapCount) ||
      value.swapCount < 0
    ) {
      throw validationError("postgres", "optimistic-market-fields");
    }
    market.swapCount = value.swapCount;
  }
  if (value.currentTick !== undefined) {
    if (
      typeof value.currentTick !== "number" ||
      !Number.isSafeInteger(value.currentTick) ||
      value.currentTick < -887_272 ||
      value.currentTick > 887_272
    ) {
      throw validationError("postgres", "optimistic-market-fields");
    }
    market.currentTick = value.currentTick;
  }
  if (market.indexedValuationBlockNumber !== blockNumber) {
    throw validationError("postgres", "optimistic-market-valuation-block");
  }
  return Object.freeze(market as OptimisticMarketFields);
}

function normalizeOptimisticPoolState(
  value: unknown,
): OptimisticMarketStateEvidence["pool"] {
  if (!isPlainRecord(value)) {
    throw validationError("postgres", "optimistic-market-pool");
  }
  const expectedKeys = [
    "activeLiquidity",
    "currentTick",
    "liquidityResult",
    "lpFeePips",
    "protocolFeePips",
    "slot0Result",
    "sqrtPriceX96",
  ];
  if (
    Object.keys(value).sort().join("\0") !== expectedKeys.join("\0") ||
    typeof value.currentTick !== "number" ||
    !Number.isSafeInteger(value.currentTick) ||
    value.currentTick < -887_272 ||
    value.currentTick > 887_272 ||
    typeof value.protocolFeePips !== "number" ||
    !Number.isSafeInteger(value.protocolFeePips) ||
    value.protocolFeePips < 0 ||
    (value.protocolFeePips & PROTOCOL_FEE_DIRECTION_MASK) > 1_000 ||
    (value.protocolFeePips >> 12) > 1_000 ||
    typeof value.lpFeePips !== "number" ||
    !Number.isSafeInteger(value.lpFeePips) ||
    value.lpFeePips < 0 ||
    value.lpFeePips > 1_000_000
  ) {
    throw validationError("postgres", "optimistic-market-pool");
  }
  const sqrtPriceX96 = BigInt(integerText(
    value.sqrtPriceX96,
    "optimistic-market-sqrt-price",
  ));
  const activeLiquidity = BigInt(integerText(
    value.activeLiquidity,
    "optimistic-market-liquidity",
  ));
  if (
    sqrtPriceX96 <= 0n ||
    sqrtPriceX96 > UINT160_MAX ||
    activeLiquidity > UINT128_MAX
  ) {
    throw validationError("postgres", "optimistic-market-pool");
  }
  const slot0Result = canonicalRawData(value.slot0Result);
  const liquidityResult = canonicalRawData(value.liquidityResult);
  try {
    const [rawSqrtPrice, rawTick, rawProtocolFee, rawLpFee] =
      decodeAbiParameters(
        [
          { type: "uint160" },
          { type: "int24" },
          { type: "uint24" },
          { type: "uint24" },
        ],
        slot0Result,
      );
    const [rawLiquidity] = decodeAbiParameters(
      [{ type: "uint128" }],
      liquidityResult,
    );
    if (
      rawSqrtPrice !== sqrtPriceX96 ||
      rawTick !== value.currentTick ||
      rawProtocolFee !== value.protocolFeePips ||
      rawLpFee !== value.lpFeePips ||
      rawLiquidity !== activeLiquidity
    ) {
      throw new TypeError("pool state decode mismatch");
    }
  } catch {
    throw validationError("postgres", "optimistic-market-pool-decode");
  }
  return Object.freeze({
    sqrtPriceX96: sqrtPriceX96.toString(),
    currentTick: value.currentTick,
    activeLiquidity: activeLiquidity.toString(),
    protocolFeePips: value.protocolFeePips,
    lpFeePips: value.lpFeePips,
    slot0Result,
    liquidityResult,
  });
}

function exactUuid(value: unknown, operation: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw invalidInput("postgres", operation);
  }
  return value;
}

function integerText(value: unknown, operation: string): string {
  if (typeof value === "bigint") {
    if (value < 0n) throw invalidInput("postgres", operation);
    return value.toString();
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw invalidInput("postgres", operation);
    }
    return String(value);
  }
  try {
    return parseNonnegativeIntegerText(value);
  } catch {
    throw invalidInput("postgres", operation);
  }
}

function integerNumber(value: unknown, operation: string): number {
  const parsed = BigInt(integerText(value, operation));
  if (parsed > 0xffff_ffffn) throw invalidInput("postgres", operation);
  return Number(parsed);
}

function signedIntegerNumber(
  value: unknown,
  minimum: number,
  maximum: number,
  operation: string,
): number {
  const parsed = typeof value === "bigint"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? BigInt(value)
      : typeof value === "string" && /^-?(?:0|[1-9]\d*)$/u.test(value)
        ? BigInt(value)
        : null;
  if (
    parsed === null ||
    parsed < BigInt(minimum) ||
    parsed > BigInt(maximum)
  ) {
    throw invalidInput("postgres", operation);
  }
  return Number(parsed);
}

function isoTimestamp(value: unknown, operation: string): string {
  const date = value instanceof Date ? value : new Date(value as string);
  if (!Number.isFinite(date.valueOf())) throw invalidInput("postgres", operation);
  return date.toISOString();
}

function blockTimestampIso(timestamp: string): string {
  const seconds = BigInt(integerText(timestamp, "optimistic-block-timestamp"));
  if (seconds > 253_402_300_799n) {
    throw validationError("rpc", "optimistic-block-timestamp-range");
  }
  return new Date(Number(seconds) * 1_000).toISOString();
}

function normalizedDescriptor(log: OptimisticManifestLog): ManifestDescriptor {
  const descriptor = MANIFEST_BY_CONTRACT_AND_SELECTOR
    .get(log.sourceContractName)
    ?.get(canonicalBytes32(log.topics[0]));
  if (!descriptor) throw validationError("rpc", "optimistic-manifest-event");
  return descriptor;
}

function decodeOptimisticLog(
  log: OptimisticManifestLog,
  blockTimestamp: string,
): NormalizedOptimisticEventPayload {
  const descriptor = normalizedDescriptor(log);
  let locallyDecoded: Readonly<Record<string, JsonValue>>;
  try {
    const decoded = decodeEventLog({
      abi: [descriptor.event],
      eventName: descriptor.eventName,
      topics: log.topics as readonly Hex[] as [Hex, ...Hex[]],
      data: log.data,
      strict: true,
    });
    locallyDecoded = canonicalizeAbiEventArguments(
      descriptor.event.inputs,
      decoded.args,
    ) as Readonly<Record<string, JsonValue>>;
    const verified = decodeManifestEvent({
      contractName: log.sourceContractName,
      eventName: descriptor.eventName,
      topics: log.topics,
      data: log.data,
      providerPayload: locallyDecoded,
    }) as Readonly<Record<string, JsonValue>>;
    if (canonicalJson(verified) !== canonicalJson(locallyDecoded)) {
      throw new TypeError("manifest decode mismatch");
    }
  } catch {
    throw validationError("rpc", "optimistic-manifest-decode");
  }
  return Object.freeze({
    schema: NORMALIZED_EVENT_SCHEMA,
    sourceContractName: log.sourceContractName,
    eventName: descriptor.eventName,
    blockTimestamp,
    arguments: Object.freeze({ ...locallyDecoded }),
  });
}

function launchTokenAddress(
  payload: NormalizedOptimisticEventPayload,
): HexAddress | null {
  if (
    payload.eventName !== "MemeTokenLaunched" &&
    payload.eventName !== "MemeTokenLaunchedV2" &&
    payload.eventName !== "StockPairedTokenLaunched"
  ) {
    return null;
  }
  try {
    return canonicalAddress(payload.arguments.token);
  } catch {
    throw validationError("rpc", "optimistic-launch-token");
  }
}

function boundedMetadataText(
  value: unknown,
  maximumBytes: number,
  operation: string,
): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw validationError("rpc", operation);
  }
  return value;
}

function validatedProviderBindings(
  block: DualRpcOptimisticBlock,
  bindings: readonly [
    OptimisticProviderDeploymentBinding,
    OptimisticProviderDeploymentBinding,
  ],
): readonly [string, string] {
  const ids = bindings.map((binding, index) => {
    if (
      binding.providerIdentity !== block.providerIdentities[index] ||
      canonicalBytes32(binding.endpointCommitment) !==
        block.providerEndpointCommitments[index] ||
      canonicalBytes32(binding.originCommitment) !==
        block.providerOriginCommitments[index]
    ) {
      throw validationError("config", "optimistic-provider-binding");
    }
    return exactUuid(
      binding.providerDeploymentId,
      "optimistic-provider-deployment-id",
    );
  });
  if (ids[0] === ids[1]) {
    throw validationError("config", "optimistic-provider-binding");
  }
  return ids as unknown as readonly [string, string];
}

function exactCallCountPair(
  value: unknown,
  minimum: number,
  maximum: number,
): value is readonly [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every(
    (count) => Number.isSafeInteger(count) && count >= minimum && count <= maximum,
  );
}

function exactMetadataProviderCallCount(
  value: number,
  tokenCount: number,
): boolean {
  if (tokenCount === 0) return value === 0;
  return Number.isSafeInteger(value) &&
    value % 2 === 0 &&
    value >= tokenCount * 2 &&
    value <= tokenCount * 6;
}

function exactBlockTelemetry(
  bundle: OptimisticPersistenceBundle,
): Readonly<{
  logsCommitment: HexBytes32;
  providerHeadObservations: NonNullable<
    OptimisticPersistenceBundle["providerHeadObservations"]
  >;
  providerCallCounts: readonly [number, number];
}> {
  if (
    !bundle.logsCommitment ||
    !bundle.providerHeadObservations ||
    bundle.providerHeadObservations.length !== 2 ||
    !exactCallCountPair(bundle.providerCallCounts, 4, 5)
  ) {
    throw validationError("postgres", "optimistic-block-telemetry");
  }
  const target = BigInt(bundle.blockNumber);
  const observations = bundle.providerHeadObservations;
  for (const [index, observation] of observations.entries()) {
    const head = BigInt(integerText(
      observation.blockNumber,
      "optimistic-block-provider-head",
    ));
    if (
      observation.blockNumber !== bundle.providerHeads[index] ||
      canonicalBytes32(observation.blockHash) !== observation.blockHash ||
      isoTimestamp(
          observation.observedAt,
          "optimistic-block-provider-head-observed",
        ) !== observation.observedAt ||
      head < target ||
      bundle.providerCallCounts[index] !== (head === target ? 4 : 5) ||
      (head === target && observation.blockHash !== bundle.blockHash)
    ) {
      throw validationError("postgres", "optimistic-block-telemetry");
    }
  }
  if (
    observations[0].blockNumber === observations[1].blockNumber &&
    observations[0].blockHash !== observations[1].blockHash
  ) {
    throw validationError("postgres", "optimistic-block-head-consensus");
  }
  return Object.freeze({
    logsCommitment: canonicalBytes32(bundle.logsCommitment),
    providerHeadObservations: observations,
    providerCallCounts: bundle.providerCallCounts,
  });
}

function normalizePersistenceMarketState(
  bundle: OptimisticPersistenceBundle,
  value: OptimisticMarketStateEvidence | OptimisticPersistenceMarketState,
): OptimisticPersistenceMarketState {
  if (
    value.version !== OPTIMISTIC_MARKET_STATE_VERSION ||
    value.finality !== "optimistic" ||
    value.chainId !== 1 ||
    value.blockNumber !== bundle.blockNumber ||
    canonicalBytes32(value.blockHash) !== bundle.blockHash ||
    !Array.isArray(value.providerIdentities) ||
    value.providerIdentities.length !== 2 ||
    value.providerIdentities[0] !== bundle.providerIdentities[0] ||
    value.providerIdentities[1] !== bundle.providerIdentities[1] ||
    !Array.isArray(value.providerVendorGroups) ||
    value.providerVendorGroups.length !== 2 ||
    value.providerVendorGroups[0] !== "alchemy" ||
    value.providerVendorGroups[1] !== "quicknode" ||
    !Array.isArray(value.providerEndpointCommitments) ||
    value.providerEndpointCommitments.length !== 2 ||
    !Array.isArray(value.providerOriginCommitments) ||
    value.providerOriginCommitments.length !== 2 ||
    canonicalBytes32(value.providerEndpointCommitments[0]) !==
      bundle.providerEndpointCommitments[0] ||
    canonicalBytes32(value.providerEndpointCommitments[1]) !==
      bundle.providerEndpointCommitments[1] ||
    canonicalBytes32(value.providerOriginCommitments[0]) !==
      bundle.providerOriginCommitments[0] ||
    canonicalBytes32(value.providerOriginCommitments[1]) !==
      bundle.providerOriginCommitments[1] ||
    !exactCallCountPair(value.blockProviderCallCounts, 4, 5) ||
    !exactCallCountPair(value.marketProviderCallCounts, 7, 8) ||
    !exactCallCountPair(value.totalProviderCallCounts, 11, 0x7fff) ||
    !Number.isSafeInteger(value.confirmations) ||
    value.confirmations < 0 ||
    value.confirmations > MAXIMUM_OPTIMISTIC_CONFIRMATIONS
  ) {
    throw validationError("postgres", "optimistic-market-evidence");
  }
  const blockNumber = integerText(value.blockNumber, "optimistic-market-block");
  const poolId = canonicalBytes32(value.poolId);
  const tokenAddress = canonicalAddress(value.tokenAddress);
  const stateView = canonicalAddress(value.stateView);
  const stateViewRuntimeCodeHash = canonicalBytes32(
    value.stateViewRuntimeCodeHash,
  );
  if (
    stateView !== OPTIMISTIC_MAINNET_STATE_VIEW ||
    stateViewRuntimeCodeHash !==
      OPTIMISTIC_MAINNET_STATE_VIEW_RUNTIME_CODE_HASH
  ) {
    throw validationError("postgres", "optimistic-market-state-view");
  }
  const providerHeads = value.providerHeads.map((head) =>
    integerText(head, "optimistic-market-provider-head")) as unknown as readonly [string, string];
  const providerHeadObservations = value.providerHeadObservations;
  if (providerHeadObservations !== undefined) {
    if (!Array.isArray(providerHeadObservations) || providerHeadObservations.length !== 2) {
      throw validationError("postgres", "optimistic-market-head-observation");
    }
    for (const [index, observation] of providerHeadObservations.entries()) {
      if (
        integerText(observation.blockNumber, "optimistic-market-provider-head") !==
          providerHeads[index] ||
        canonicalBytes32(observation.blockHash) !== observation.blockHash ||
        isoTimestamp(
            observation.observedAt,
            "optimistic-market-provider-head-observed",
          ) !== observation.observedAt ||
        value.marketProviderCallCounts[index] !==
          (BigInt(providerHeads[index]!) === BigInt(blockNumber) ? 7 : 8)
      ) {
        throw validationError("postgres", "optimistic-market-head-observation");
      }
      if (
        BigInt(providerHeads[index]!) === BigInt(blockNumber) &&
        observation.blockHash !== bundle.blockHash
      ) {
        throw validationError("postgres", "optimistic-market-head-observation");
      }
    }
    if (
      providerHeads[0] === providerHeads[1] &&
      providerHeadObservations[0].blockHash !== providerHeadObservations[1].blockHash
    ) {
      throw validationError("postgres", "optimistic-market-head-consensus");
    }
    if (bundle.providerHeadObservations) {
      for (const blockObservation of bundle.providerHeadObservations) {
        for (const marketObservation of providerHeadObservations) {
          if (
            blockObservation.blockNumber === marketObservation.blockNumber &&
            blockObservation.blockHash !== marketObservation.blockHash
          ) {
            throw validationError("postgres", "optimistic-market-head-consensus");
          }
        }
      }
    }
  }
  const lowestHead = BigInt(providerHeads[0]) < BigInt(providerHeads[1])
    ? BigInt(providerHeads[0])
    : BigInt(providerHeads[1]);
  if (
    BigInt(providerHeads[0]) < BigInt(bundle.providerHeads[0]) ||
    BigInt(providerHeads[1]) < BigInt(bundle.providerHeads[1]) ||
    lowestHead < BigInt(blockNumber) ||
    Number(lowestHead - BigInt(blockNumber)) !== value.confirmations
    || value.blockProviderCallCounts[0] !== bundle.providerCallCounts[0]
    || value.blockProviderCallCounts[1] !== bundle.providerCallCounts[1]
  ) {
    throw validationError("postgres", "optimistic-market-confirmations");
  }
  const pool = normalizeOptimisticPoolState(value.pool);
  const market = normalizeMarketFields(value.market, blockNumber);
  if (
    market.currentTick !== pool.currentTick ||
    market.activeLiquidity !== pool.activeLiquidity
  ) {
    throw validationError("postgres", "optimistic-market-pool-fields");
  }
  const commitments = computeOptimisticMarketStateCommitments({
    blockNumber,
    blockHash: bundle.blockHash,
    stateView,
    poolId,
    tokenAddress,
    pool,
    market,
    providerIdentities: bundle.providerIdentities,
    providerVendorGroups: bundle.providerVendorGroups,
    providerEndpointCommitments: bundle.providerEndpointCommitments,
    providerOriginCommitments: bundle.providerOriginCommitments,
    providerHeads,
    ...(providerHeadObservations === undefined
      ? {}
      : { providerHeadObservations }),
    blockProviderCallCounts: value.blockProviderCallCounts,
    marketProviderCallCounts: value.marketProviderCallCounts,
    totalProviderCallCounts: value.totalProviderCallCounts,
    confirmations: value.confirmations,
  });
  if (
    canonicalBytes32(value.marketCommitment) !== commitments.marketCommitment ||
    canonicalBytes32(value.evidenceCommitment) !== commitments.evidenceCommitment
  ) {
    throw validationError("postgres", "optimistic-market-commitment");
  }
  const optimisticMarketStateId = deterministicUuid(
    "optimistic-market-state-v1",
    { chainId: 1, blockHash: bundle.blockHash, poolId },
  );
  if (
    "optimisticMarketStateId" in value &&
    exactUuid(
      value.optimisticMarketStateId,
      "optimistic-market-state-id",
    ) !== optimisticMarketStateId
  ) {
    throw validationError("postgres", "optimistic-market-state-id");
  }
  if (
    "optimisticBlockId" in value &&
    exactUuid(value.optimisticBlockId, "optimistic-market-block-id") !==
      bundle.optimisticBlockId
  ) {
    throw validationError("postgres", "optimistic-market-block-id");
  }
  if (
    "providerDeploymentIds" in value &&
    (!Array.isArray(value.providerDeploymentIds) ||
      value.providerDeploymentIds.length !== 2 ||
      value.providerDeploymentIds[0] !== bundle.providerDeploymentIds[0] ||
      value.providerDeploymentIds[1] !== bundle.providerDeploymentIds[1])
  ) {
    throw validationError("postgres", "optimistic-market-provider-deployment");
  }
  if (
    "observedAt" in value &&
    isoTimestamp(value.observedAt, "optimistic-market-observed") !==
      bundle.observedAt
  ) {
    throw validationError("postgres", "optimistic-market-observed");
  }
  return Object.freeze({
    version: OPTIMISTIC_MARKET_STATE_VERSION,
    finality: "optimistic",
    chainId: 1,
    blockNumber,
    blockHash: bundle.blockHash,
    confirmations: value.confirmations,
    poolId,
    tokenAddress,
    stateView,
    stateViewRuntimeCodeHash,
    market,
    marketCommitment: commitments.marketCommitment,
    evidenceCommitment: commitments.evidenceCommitment,
    pool,
    providerIdentities: bundle.providerIdentities,
    providerVendorGroups: bundle.providerVendorGroups,
    providerEndpointCommitments: bundle.providerEndpointCommitments,
    providerOriginCommitments: bundle.providerOriginCommitments,
    providerHeads,
    ...(providerHeadObservations === undefined
      ? {}
      : { providerHeadObservations: Object.freeze(providerHeadObservations) }),
    blockProviderCallCounts: Object.freeze([
      value.blockProviderCallCounts[0],
      value.blockProviderCallCounts[1],
    ] as const),
    marketProviderCallCounts: Object.freeze([
      value.marketProviderCallCounts[0],
      value.marketProviderCallCounts[1],
    ] as const),
    totalProviderCallCounts: Object.freeze([
      value.totalProviderCallCounts[0],
      value.totalProviderCallCounts[1],
    ] as const),
    optimisticMarketStateId,
    optimisticBlockId: bundle.optimisticBlockId,
    providerDeploymentIds: bundle.providerDeploymentIds,
    observedAt: bundle.observedAt,
  });
}

export function attachOptimisticMarketStates(
  bundle: OptimisticPersistenceBundle,
  marketStates: readonly OptimisticMarketStateEvidence[],
): OptimisticPersistenceBundle {
  if (
    !Array.isArray(marketStates) ||
    marketStates.length > MAXIMUM_PERSISTED_MARKET_STATES_PER_BLOCK
  ) {
    throw validationError("postgres", "optimistic-market-state-bound");
  }
  const aggregateProviderCalls = Object.freeze([
    bundle.providerCallCounts[0] + bundle.metadataProviderCallCounts[0] + marketStates.reduce(
      (sum, state) => sum + state.marketProviderCallCounts[0],
      0,
    ),
    bundle.providerCallCounts[1] + bundle.metadataProviderCallCounts[1] + marketStates.reduce(
      (sum, state) => sum + state.marketProviderCallCounts[1],
      0,
    ),
  ] as const);
  const normalized = marketStates.map((state) => {
    const counts = Object.freeze({
      ...state,
      blockProviderCallCounts: bundle.providerCallCounts,
      totalProviderCallCounts: aggregateProviderCalls,
    });
    const commitments = computeOptimisticMarketStateCommitments({
      ...counts,
      providerHeadObservations: counts.providerHeadObservations,
    });
    return normalizePersistenceMarketState(bundle, Object.freeze({
      ...counts,
      marketCommitment: commitments.marketCommitment,
      evidenceCommitment: commitments.evidenceCommitment,
    }));
  });
  if (new Set(normalized.map(({ poolId }) => poolId)).size !== normalized.length) {
    throw validationError("postgres", "optimistic-market-state-duplicate");
  }
  return Object.freeze({ ...bundle, marketStates: Object.freeze(normalized) });
}

export type OptimisticMarketStateReader = (
  input: Readonly<{
    block: DualRpcOptimisticBlock;
    bundle: OptimisticPersistenceBundle;
  }>,
) => Promise<readonly OptimisticMarketStateEvidence[]>;

async function verifyOptimisticBlockForPersistenceInternal(input: Readonly<{
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  providerDeployments: readonly [
    OptimisticProviderDeploymentBinding,
    OptimisticProviderDeploymentBinding,
  ];
  hint: QuickNodeBlockHint;
  observedAt?: string;
  hardDeadlineMs?: number;
  marketStateReader?: OptimisticMarketStateReader;
}>): Promise<OptimisticPersistenceBundle> {
  const block = await readOptimisticBlockWithDualRpc({
    providers: input.providers,
    hint: input.hint,
    ...(input.hardDeadlineMs === undefined
      ? {}
      : { hardDeadlineMs: input.hardDeadlineMs }),
  });
  if (
    block.finality !== "optimistic" ||
    !Number.isSafeInteger(block.confirmations) ||
    block.confirmations < 0 ||
    block.confirmations > MAXIMUM_OPTIMISTIC_CONFIRMATIONS ||
    block.logs.length > MAXIMUM_PERSISTED_EVENTS_PER_BLOCK
  ) {
    throw validationError("rpc", "optimistic-finality-window");
  }
  const providerDeploymentIds = validatedProviderBindings(
    block,
    input.providerDeployments,
  );
  const observedAt = input.observedAt === undefined
    ? new Date().toISOString()
    : isoTimestamp(input.observedAt, "optimistic-observed-at");
  const blockTimestamp = blockTimestampIso(block.block.timestamp);
  const decoded = block.logs.map((log) =>
    decodeOptimisticLog(log, block.block.timestamp));
  const launchTokens = [...new Set(decoded
    .map(launchTokenAddress)
    .filter((value): value is HexAddress => value !== null))];
  if (launchTokens.length > 16) {
    throw validationError("rpc", "optimistic-launch-count");
  }
  const metadataBatch = await readDualRpcTokenMetadataWithTrace({
      providers: input.providers,
      tokens: launchTokens.map((token) => ({
        token,
        blockNumber: block.block.number,
        blockHash: block.block.hash,
      })),
    });
  const metadataByToken = new Map(
    metadataBatch.metadata.map((metadata) => [
      metadata.token,
      Object.freeze({
        name: metadata.name,
        symbol: metadata.symbol,
        blockHash: metadata.blockHash,
        providerIdentities: block.providerIdentities,
        providerVendorGroups: block.providerVendorGroups,
        providerEndpointCommitments: block.providerEndpointCommitments,
        providerOriginCommitments: block.providerOriginCommitments,
      }) satisfies NormalizedTokenMetadata,
    ] as const),
  );
  const normalized = decoded.map((payload) => {
    const token = launchTokenAddress(payload);
    return token
      ? Object.freeze({ ...payload, tokenMetadata: metadataByToken.get(token)! })
      : payload;
  });
  const optimisticBlockId = deterministicUuid("optimistic-block-v1", {
    chainId: block.chainId,
    blockNumber: block.block.number,
    blockHash: block.block.hash,
  });
  const evidenceCommitment = commitment("optimistic-block-evidence-v1", {
    chainId: block.chainId,
    block: block.block,
    providerDeploymentIds,
    providerIdentities: block.providerIdentities,
    providerVendorGroups: block.providerVendorGroups,
    providerEndpointCommitments: block.providerEndpointCommitments,
    providerOriginCommitments: block.providerOriginCommitments,
    providerCallCounts: block.providerCallCounts,
    metadataProviderCallCounts: metadataBatch.providerCallCounts,
    providerHeads: block.providerHeads,
    providerHeadObservations: block.providerHeadObservations.map(
      ({ blockNumber, blockHash }) => ({ blockNumber, blockHash }),
    ),
    logsCommitment: block.logsCommitment,
  });
  const events = block.logs.map((log, index): OptimisticPersistenceEvent => {
    const normalizedPayload = normalized[index]!;
    const physicalIdentity = {
      chainId: block.chainId,
      blockHash: block.block.hash,
      transactionHash: log.transactionHash,
      blockGlobalLogIndex: log.logIndex,
    };
    const optimisticEventId = deterministicUuid(
      "optimistic-event-v1",
      physicalIdentity,
    );
    const payloadCommitment = commitment("optimistic-event-payload-v1", {
      ...physicalIdentity,
      optimisticEventId,
      optimisticBlockId,
      transactionIndex: log.transactionIndex,
      sourceAddress: log.address,
      orderedTopics: log.topics,
      rawData: log.data,
      normalizedPayload,
    });
    return Object.freeze({
      optimisticEventId,
      optimisticBlockId,
      transactionHash: log.transactionHash,
      transactionIndex: log.transactionIndex,
      blockGlobalLogIndex: log.logIndex,
      sourceAddress: log.address,
      eventSignature: log.topics[0]!,
      orderedTopics: log.topics,
      rawData: log.data,
      normalizedPayload,
      payloadCommitment,
    });
  });
  const bundle: OptimisticPersistenceBundle = Object.freeze({
    optimisticBlockId,
    chainId: 1,
    blockNumber: block.block.number,
    blockHash: block.block.hash,
    parentHash: block.block.parentHash,
    blockTimestamp,
    providerDeploymentIds,
    providerHeads: block.providerHeads,
    providerIdentities: block.providerIdentities,
    providerVendorGroups: block.providerVendorGroups,
    providerEndpointCommitments: block.providerEndpointCommitments,
    providerOriginCommitments: block.providerOriginCommitments,
    providerCallCounts: block.providerCallCounts,
    metadataProviderCallCounts: metadataBatch.providerCallCounts,
    confirmations: block.confirmations,
    evidenceCommitment,
    logsCommitment: block.logsCommitment,
    providerHeadObservations: block.providerHeadObservations,
    observedAt,
    events: Object.freeze(events),
    marketStates: Object.freeze([]),
  });
  if (!input.marketStateReader) return bundle;
  const marketStates = await input.marketStateReader({ block, bundle });
  return attachOptimisticMarketStates(bundle, marketStates);
}

export async function verifyOptimisticBlockForPersistence(input: Readonly<{
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  providerDeployments: readonly [
    OptimisticProviderDeploymentBinding,
    OptimisticProviderDeploymentBinding,
  ];
  hint: QuickNodeBlockHint;
  observedAt?: string;
  hardDeadlineMs?: number;
}>): Promise<OptimisticPersistenceBundle> {
  return verifyOptimisticBlockForPersistenceInternal(input);
}

function validatePersistenceBundle(
  bundle: OptimisticPersistenceBundle,
): OptimisticPersistenceBundle {
  if (
    bundle.chainId !== 1 ||
    !Array.isArray(bundle.events) ||
    bundle.events.length > MAXIMUM_PERSISTED_EVENTS_PER_BLOCK ||
    !Array.isArray(bundle.marketStates) ||
    bundle.marketStates.length > MAXIMUM_PERSISTED_MARKET_STATES_PER_BLOCK ||
    !Array.isArray(bundle.providerDeploymentIds) ||
    bundle.providerDeploymentIds.length !== 2 ||
    !Array.isArray(bundle.providerHeads) ||
    bundle.providerHeads.length !== 2 ||
    !Array.isArray(bundle.providerIdentities) ||
    bundle.providerIdentities.length !== 2 ||
    bundle.providerIdentities.some(
      (identity) => typeof identity !== "string" || identity.length > 64,
    ) ||
    bundle.providerIdentities[0] === bundle.providerIdentities[1] ||
    !Array.isArray(bundle.providerVendorGroups) ||
    bundle.providerVendorGroups.length !== 2 ||
    bundle.providerVendorGroups[0] !== "alchemy" ||
    bundle.providerVendorGroups[1] !== "quicknode" ||
    !Array.isArray(bundle.providerEndpointCommitments) ||
    bundle.providerEndpointCommitments.length !== 2 ||
    !Array.isArray(bundle.providerOriginCommitments) ||
    bundle.providerOriginCommitments.length !== 2 ||
    !exactCallCountPair(bundle.metadataProviderCallCounts, 0, 96) ||
    !Number.isSafeInteger(bundle.confirmations) ||
    bundle.confirmations < 0 ||
    bundle.confirmations > MAXIMUM_OPTIMISTIC_CONFIRMATIONS
  ) {
    throw validationError("postgres", "optimistic-persistence-bundle");
  }
  const blockNumber = integerText(bundle.blockNumber, "optimistic-bundle-block");
  const blockHash = canonicalBytes32(bundle.blockHash);
  const parentHash = canonicalBytes32(bundle.parentHash);
  const blockTimestamp = isoTimestamp(
    bundle.blockTimestamp,
    "optimistic-bundle-block-timestamp",
  );
  isoTimestamp(bundle.observedAt, "optimistic-bundle-observed");
  const providerHeads = bundle.providerHeads.map((head) =>
    integerText(head, "optimistic-bundle-provider-head")) as unknown as readonly [string, string];
  const lowestHead = BigInt(providerHeads[0]) < BigInt(providerHeads[1])
    ? BigInt(providerHeads[0])
    : BigInt(providerHeads[1]);
  if (
    lowestHead < BigInt(blockNumber) ||
    Number(lowestHead - BigInt(blockNumber)) !== bundle.confirmations ||
    deterministicUuid("optimistic-block-v1", {
      chainId: 1,
      blockNumber,
      blockHash,
    }) !== exactUuid(bundle.optimisticBlockId, "optimistic-bundle-id")
  ) {
    throw validationError("postgres", "optimistic-persistence-bundle");
  }
  const providerDeploymentIds = bundle.providerDeploymentIds.map((id) =>
    exactUuid(id, "optimistic-bundle-provider")) as unknown as readonly [string, string];
  const providerEndpointCommitments = bundle.providerEndpointCommitments.map(
    canonicalBytes32,
  ) as unknown as readonly [HexBytes32, HexBytes32];
  const providerOriginCommitments = bundle.providerOriginCommitments.map(
    canonicalBytes32,
  ) as unknown as readonly [HexBytes32, HexBytes32];
  if (
    providerDeploymentIds[0] === providerDeploymentIds[1] ||
    providerEndpointCommitments[0] === providerEndpointCommitments[1] ||
    providerOriginCommitments[0] === providerOriginCommitments[1]
  ) {
    throw validationError("postgres", "optimistic-persistence-bundle");
  }
  const metadataCount = bundle.events.filter(
    ({ normalizedPayload }) => normalizedPayload.tokenMetadata !== undefined,
  ).length;
  if (
    !exactMetadataProviderCallCount(
      bundle.metadataProviderCallCounts[0],
      metadataCount,
    ) ||
    !exactMetadataProviderCallCount(
      bundle.metadataProviderCallCounts[1],
      metadataCount,
    )
  ) {
    throw validationError("postgres", "optimistic-metadata-call-count");
  }
  const telemetry = exactBlockTelemetry(bundle);
  const expectedEvidence = commitment("optimistic-block-evidence-v1", {
    chainId: 1,
    block: {
      number: blockNumber,
      hash: blockHash,
      parentHash,
      timestamp: bundle.events[0]?.normalizedPayload.blockTimestamp ??
        String(Math.floor(new Date(blockTimestamp).valueOf() / 1_000)),
    },
    providerDeploymentIds,
    providerIdentities: bundle.providerIdentities,
    providerVendorGroups: bundle.providerVendorGroups,
    providerEndpointCommitments,
    providerOriginCommitments,
    providerHeads,
    providerHeadObservations: telemetry.providerHeadObservations.map(
      ({ blockNumber: headNumber, blockHash: headHash }) => ({
        blockNumber: headNumber,
        blockHash: headHash,
      }),
    ),
    providerCallCounts: telemetry.providerCallCounts,
    metadataProviderCallCounts: bundle.metadataProviderCallCounts,
    logsCommitment: telemetry.logsCommitment,
  });
  if (expectedEvidence !== canonicalBytes32(bundle.evidenceCommitment)) {
    throw validationError("postgres", "optimistic-block-commitment");
  }
  for (const event of bundle.events) {
    if (
      !Number.isSafeInteger(event.transactionIndex) ||
      event.transactionIndex < 0 ||
      event.transactionIndex > 0xffff_ffff ||
      !Number.isSafeInteger(event.blockGlobalLogIndex) ||
      event.blockGlobalLogIndex < 0 ||
      event.blockGlobalLogIndex > 0xffff_ffff ||
      !Array.isArray(event.orderedTopics)
    ) {
      throw validationError("postgres", "optimistic-persistence-event");
    }
    const source = RELEASE_BINDING.sources.find(
      ({ address }) => address === canonicalAddress(event.sourceAddress),
    );
    const eventId = deterministicUuid("optimistic-event-v1", {
      chainId: 1,
      blockHash,
      transactionHash: canonicalBytes32(event.transactionHash),
      blockGlobalLogIndex: event.blockGlobalLogIndex,
    });
    if (
      event.optimisticBlockId !== bundle.optimisticBlockId ||
      eventId !== exactUuid(event.optimisticEventId, "optimistic-bundle-event-id") ||
      !source ||
      source.contractName !== event.normalizedPayload.sourceContractName ||
      blockTimestampIso(event.normalizedPayload.blockTimestamp) !== blockTimestamp ||
      event.orderedTopics.length < 1 ||
      event.orderedTopics.length > 4 ||
      canonicalBytes32(event.eventSignature) !==
        canonicalBytes32(event.orderedTopics[0])
    ) {
      throw validationError("postgres", "optimistic-persistence-event");
    }
    try {
      decodeManifestEvent({
        contractName: event.normalizedPayload.sourceContractName,
        eventName: event.normalizedPayload.eventName,
        topics: event.orderedTopics,
        data: event.rawData,
        providerPayload: event.normalizedPayload.arguments,
      });
    } catch {
      throw validationError("postgres", "optimistic-persistence-event");
    }
    const expectedPayload = commitment("optimistic-event-payload-v1", {
      chainId: 1,
      blockHash,
      transactionHash: event.transactionHash,
      blockGlobalLogIndex: event.blockGlobalLogIndex,
      optimisticEventId: event.optimisticEventId,
      optimisticBlockId: event.optimisticBlockId,
      transactionIndex: event.transactionIndex,
      sourceAddress: event.sourceAddress,
      orderedTopics: event.orderedTopics,
      rawData: canonicalRawData(event.rawData),
      normalizedPayload: event.normalizedPayload,
    });
    if (expectedPayload !== canonicalBytes32(event.payloadCommitment)) {
      throw validationError("postgres", "optimistic-event-commitment");
    }
  }
  const marketStateIds = new Set<string>();
  const marketStatePools = new Set<string>();
  for (const marketState of bundle.marketStates) {
    const normalized = normalizePersistenceMarketState(bundle, marketState);
    if (
      normalized.optimisticMarketStateId !==
        marketState.optimisticMarketStateId ||
      marketStateIds.has(normalized.optimisticMarketStateId) ||
      marketStatePools.has(normalized.poolId)
    ) {
      throw validationError("postgres", "optimistic-market-state-duplicate");
    }
    marketStateIds.add(normalized.optimisticMarketStateId);
    marketStatePools.add(normalized.poolId);
  }
  return bundle;
}

function parsePromotionPlan(row: Record<string, unknown>): OptimisticPromotionPlan {
  const nullableUuid = (value: unknown, operation: string) =>
    value === null ? null : exactUuid(value, operation);
  const nullableInteger = (value: unknown, operation: string) =>
    value === null ? null : integerText(value, operation);
  const storedCommitment = row.stored_decision_commitment === null
    ? null
    : bytes32FromBytea(row.stored_decision_commitment);
  return Object.freeze({
    mode:
      typeof row.mode === "string" && /^[a-z][a-z-]{0,63}$/u.test(row.mode)
        ? row.mode
        : (() => { throw invalidInput("postgres", "optimistic-plan-mode"); })(),
    canPromote:
      typeof row.can_promote === "boolean"
        ? row.can_promote
        : (() => { throw invalidInput("postgres", "optimistic-plan"); })(),
    expectedCurrentBlockId: nullableUuid(
      row.expected_current_block_id,
      "optimistic-plan-expected",
    ),
    orphanRequired:
      typeof row.orphan_required === "boolean"
        ? row.orphan_required
        : (() => { throw invalidInput("postgres", "optimistic-plan"); })(),
    requiresRebootstrap:
      typeof row.requires_rebootstrap === "boolean"
        ? row.requires_rebootstrap
        : (() => { throw invalidInput("postgres", "optimistic-plan"); })(),
    targetHeightCurrentBlockId: nullableUuid(
      row.target_height_current_block_id,
      "optimistic-plan-target",
    ),
    chainTipBlockId: nullableUuid(row.chain_tip_block_id, "optimistic-plan-tip"),
    chainTipBlockNumber: nullableInteger(
      row.chain_tip_block_number,
      "optimistic-plan-tip-number",
    ),
    segmentStartBlockNumber: nullableInteger(
      row.segment_start_block_number,
      "optimistic-plan-segment",
    ),
    reorgGeneration: nullableInteger(
      row.reorg_generation,
      "optimistic-plan-generation",
    ),
    canonicalStatusId: nullableUuid(
      row.canonical_status_id,
      "optimistic-plan-canonical-status",
    ),
    orphanStatusId: nullableUuid(
      row.orphan_status_id,
      "optimistic-plan-orphan-status",
    ),
    storedDecisionCommitment: storedCommitment,
    storedDecidedAt:
      row.stored_decided_at === null
        ? null
        : isoTimestamp(row.stored_decided_at, "optimistic-plan-decided-at"),
  });
}

async function oneUuid(
  transaction: PostgresTransaction,
  sql: string,
  values: readonly (string | Date | Uint8Array | ReturnType<typeof postgresJson> | readonly Uint8Array[] | null)[],
  column: string,
): Promise<string> {
  const rows = await transaction.query<Record<string, unknown>>(sql, values);
  if (rows.length !== 1) throw validationError("postgres", "optimistic-rpc-row");
  return exactUuid(rows[0]?.[column], "optimistic-rpc-id");
}

export function createOptimisticLiveWriter(input: { executor: PostgresExecutor }) {
  const gateway = createProjectorDatabaseGateway({ executor: input.executor });
  return Object.freeze({
    async persist(bundle: OptimisticPersistenceBundle): Promise<OptimisticPersistResult> {
      validatePersistenceBundle(bundle);
      return gateway.transaction(async (transaction) => {
        const insertedBlockId = await oneUuid(
          transaction,
          `select programmable_private.append_optimistic_block_observation_v1(
             $1::uuid, $2::bigint, $3::bigint, $4::bytea, $5::bytea,
             $6::bytea, $7::bytea, $8::timestamptz, $9::timestamptz,
             $10::uuid, $11::uuid, $12::bigint, $13::bigint, $14::bytea,
             $15::timestamptz
           ) as optimistic_block_id`,
          [
            bundle.optimisticBlockId,
            bundle.chainId.toString(),
            bundle.blockNumber,
            hexToBytes(bundle.blockHash),
            hexToBytes(bundle.blockHash),
            hexToBytes(bundle.parentHash),
            hexToBytes(bundle.parentHash),
            new Date(bundle.blockTimestamp),
            new Date(bundle.blockTimestamp),
            bundle.providerDeploymentIds[0],
            bundle.providerDeploymentIds[1],
            bundle.providerHeads[0],
            bundle.providerHeads[1],
            hexToBytes(bundle.evidenceCommitment),
            new Date(bundle.observedAt),
          ],
          "optimistic_block_id",
        );
        if (insertedBlockId !== bundle.optimisticBlockId) {
          throw validationError("postgres", "optimistic-block-id");
        }
        for (const event of bundle.events) {
          const insertedEventId = await oneUuid(
            transaction,
            `select programmable_private.append_optimistic_event_row_v1(
               $1::uuid, $2::uuid, $3::bytea, $4::bigint, $5::bigint,
               $6::bytea, $7::bytea, $8::bytea[], $9::bytea, $10::jsonb,
               $11::bytea, $12::timestamptz
             ) as optimistic_event_id`,
            [
              event.optimisticEventId,
              event.optimisticBlockId,
              hexToBytes(event.transactionHash),
              String(event.transactionIndex),
              String(event.blockGlobalLogIndex),
              hexToBytes(event.sourceAddress),
              hexToBytes(event.eventSignature),
              event.orderedTopics.map(hexToBytes),
              hexToBytes(event.rawData),
              postgresJson(event.normalizedPayload),
              hexToBytes(event.payloadCommitment),
              new Date(bundle.observedAt),
            ],
            "optimistic_event_id",
          );
          if (insertedEventId !== event.optimisticEventId) {
            throw validationError("postgres", "optimistic-event-id");
          }
        }
        for (const state of bundle.marketStates) {
          const insertedMarketStateId = await oneUuid(
            transaction,
            `select programmable_private.append_optimistic_market_state_v2(
               $1::uuid, $2::uuid, $3::bytea, $4::bytea, $5::bytea,
               $6::bytea, $7::numeric, $8::integer, $9::numeric,
               $10::integer, $11::integer, $12::bytea, $13::bytea,
               $14::bytea, $15::bytea, $16::jsonb, $17::bytea,
               $18::uuid, $19::uuid, $20::text, $21::text, $22::bytea,
               $23::bytea, $24::bytea, $25::bytea, $26::bigint,
               $27::bigint, $28::smallint, $29::smallint, $30::smallint,
               $31::smallint, $32::smallint, $33::smallint, $34::smallint,
               $35::bytea, $36::timestamptz
             ) as optimistic_market_state_id`,
            [
              state.optimisticMarketStateId,
              state.optimisticBlockId,
              hexToBytes(state.poolId),
              hexToBytes(state.tokenAddress),
              hexToBytes(state.stateView),
              hexToBytes(state.stateViewRuntimeCodeHash),
              state.pool.sqrtPriceX96,
              String(state.pool.currentTick),
              state.pool.activeLiquidity,
              String(state.pool.protocolFeePips),
              String(state.pool.lpFeePips),
              hexToBytes(state.pool.slot0Result),
              hexToBytes(state.pool.slot0Result),
              hexToBytes(state.pool.liquidityResult),
              hexToBytes(state.pool.liquidityResult),
              postgresJson(state.market),
              hexToBytes(state.marketCommitment),
              state.providerDeploymentIds[0],
              state.providerDeploymentIds[1],
              state.providerIdentities[0],
              state.providerIdentities[1],
              hexToBytes(state.providerEndpointCommitments[0]),
              hexToBytes(state.providerEndpointCommitments[1]),
              hexToBytes(state.providerOriginCommitments[0]),
              hexToBytes(state.providerOriginCommitments[1]),
              state.providerHeads[0],
              state.providerHeads[1],
              String(state.blockProviderCallCounts[0]),
              String(state.blockProviderCallCounts[1]),
              String(state.marketProviderCallCounts[0]),
              String(state.marketProviderCallCounts[1]),
              String(state.totalProviderCallCounts[0]),
              String(state.totalProviderCallCounts[1]),
              String(state.confirmations),
              hexToBytes(state.evidenceCommitment),
              new Date(state.observedAt),
            ],
            "optimistic_market_state_id",
          );
          if (insertedMarketStateId !== state.optimisticMarketStateId) {
            throw validationError("postgres", "optimistic-market-state-id");
          }
        }
        const planRows = await transaction.query<Record<string, unknown>>(
          "select * from programmable_private.get_optimistic_promotion_plan_v1($1::uuid)",
          [bundle.optimisticBlockId],
        );
        if (planRows.length !== 1) {
          throw validationError("postgres", "optimistic-promotion-plan");
        }
        const plan = parsePromotionPlan(planRows[0]!);
        if (!plan.canPromote || plan.requiresRebootstrap) {
          throw validationError("postgres", "optimistic-promotion-refused");
        }
        const replayed = plan.mode === "replay";
        const canonicalStatusId = replayed
          ? exactUuid(plan.canonicalStatusId, "optimistic-replay-status")
          : deterministicUuid("optimistic-canonical-status-v1", {
              optimisticBlockId: bundle.optimisticBlockId,
              evidenceCommitment: bundle.evidenceCommitment,
            });
        const orphanStatusId = plan.orphanRequired
          ? replayed
            ? exactUuid(plan.orphanStatusId, "optimistic-replay-orphan")
            : deterministicUuid("optimistic-orphan-status-v1", {
                optimisticBlockId: bundle.optimisticBlockId,
                expectedCurrentBlockId: plan.expectedCurrentBlockId,
                evidenceCommitment: bundle.evidenceCommitment,
              })
          : null;
        const decisionCommitment = replayed
          ? canonicalBytes32(plan.storedDecisionCommitment)
          : commitment("optimistic-canonical-decision-v1", {
              optimisticBlockId: bundle.optimisticBlockId,
              expectedCurrentBlockId: plan.expectedCurrentBlockId,
              orphanRequired: plan.orphanRequired,
              evidenceCommitment: bundle.evidenceCommitment,
            });
        const decidedAt = replayed
          ? new Date(isoTimestamp(plan.storedDecidedAt, "optimistic-replay-decided"))
          : new Date(bundle.observedAt);
        const promoted = await oneUuid(
          transaction,
          `select programmable_private.promote_optimistic_block_canonical_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::bytea,
             $6::timestamptz
           ) as optimistic_block_id`,
          [
            bundle.optimisticBlockId,
            plan.expectedCurrentBlockId,
            canonicalStatusId,
            orphanStatusId,
            hexToBytes(decisionCommitment),
            decidedAt,
          ],
          "optimistic_block_id",
        );
        if (promoted !== bundle.optimisticBlockId) {
          throw validationError("postgres", "optimistic-promotion-id");
        }
        return Object.freeze({
          optimisticBlockId: promoted,
          promotionMode: plan.mode,
          replayed,
          eventCount: bundle.events.length,
          marketStateCount: bundle.marketStates.length,
        });
      });
    },
  });
}

async function ingestOptimisticLiveBlockInternal(input: Readonly<{
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  providerDeployments: readonly [
    OptimisticProviderDeploymentBinding,
    OptimisticProviderDeploymentBinding,
  ];
  hint: QuickNodeBlockHint;
  writer: Pick<OptimisticLiveWriter, "persist">;
  observedAt?: string;
  hardDeadlineMs?: number;
  marketStateReader?: OptimisticMarketStateReader;
}>): Promise<Readonly<{
  bundle: OptimisticPersistenceBundle;
  persisted: OptimisticPersistResult;
}>> {
  const bundle = await verifyOptimisticBlockForPersistenceInternal({
    providers: input.providers,
    providerDeployments: input.providerDeployments,
    hint: input.hint,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    ...(input.hardDeadlineMs === undefined
      ? {}
      : { hardDeadlineMs: input.hardDeadlineMs }),
    ...(input.marketStateReader === undefined
      ? {}
      : { marketStateReader: input.marketStateReader }),
  });
  const persisted = await input.writer.persist(bundle);
  if (persisted.optimisticBlockId !== bundle.optimisticBlockId) {
    throw validationError("postgres", "optimistic-persisted-block-id");
  }
  return Object.freeze({ bundle, persisted });
}

export async function ingestOptimisticLiveBlock(input: Readonly<{
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  providerDeployments: readonly [
    OptimisticProviderDeploymentBinding,
    OptimisticProviderDeploymentBinding,
  ];
  hint: QuickNodeBlockHint;
  writer: Pick<OptimisticLiveWriter, "persist">;
  observedAt?: string;
  hardDeadlineMs?: number;
}>): Promise<Readonly<{
  bundle: OptimisticPersistenceBundle;
  persisted: OptimisticPersistResult;
}>> {
  return ingestOptimisticLiveBlockInternal(input);
}

/**
 * Narrow wake-route integration: one branded dual-RPC block, its derived
 * market reads, and one atomic database promotion. The caller supplies only a
 * previously parsed queue hint plus process-configured dependencies.
 */
export function createOptimisticFirstStage(input: Readonly<{
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  providerDeployments: readonly [
    OptimisticProviderDeploymentBinding,
    OptimisticProviderDeploymentBinding,
  ];
  writer: Pick<OptimisticLiveWriter, "persist">;
  loadCanonicalTokens: () => Promise<readonly LauncherToken[]>;
  hardDeadlineMs?: number;
  ensureTrackedMarket?: boolean;
}>) {
  const marketStateReader = createOptimisticMarketStateReader({
    providers: input.providers,
    loadCanonicalTokens: input.loadCanonicalTokens,
    ...(input.hardDeadlineMs === undefined
      ? {}
      : { hardDeadlineMs: input.hardDeadlineMs }),
    ...(input.ensureTrackedMarket === undefined
      ? {}
      : { ensureTrackedMarket: input.ensureTrackedMarket }),
  });
  return Object.freeze({
    async ingest(job: Readonly<{
      hint: QuickNodeBlockHint;
      observedAt?: string;
    }>) {
      return ingestOptimisticLiveBlockInternal({
        providers: input.providers,
        providerDeployments: input.providerDeployments,
        hint: job.hint,
        writer: input.writer,
        marketStateReader,
        ...(job.observedAt === undefined
          ? {}
          : { observedAt: job.observedAt }),
        ...(input.hardDeadlineMs === undefined
          ? {}
          : { hardDeadlineMs: input.hardDeadlineMs }),
      });
    },
  });
}

function parseNormalizedPayload(value: unknown): NormalizedOptimisticEventPayload {
  if (
    !isPlainRecord(value) ||
    value.schema !== NORMALIZED_EVENT_SCHEMA ||
    typeof value.sourceContractName !== "string" ||
    !MANIFEST_BY_CONTRACT_AND_SELECTOR.has(value.sourceContractName) ||
    typeof value.eventName !== "string" ||
    !isPlainRecord(value.arguments) ||
    typeof value.blockTimestamp !== "string"
  ) {
    throw validationError("postgres", "optimistic-normalized-payload");
  }
  const timestamp = integerText(
    value.blockTimestamp,
    "optimistic-normalized-block-timestamp",
  );
  const descriptor = [...(MANIFEST_BY_CONTRACT_AND_SELECTOR
    .get(value.sourceContractName)?.values() ?? [])]
    .find(({ eventName }) => eventName === value.eventName);
  if (!descriptor) {
    throw validationError("postgres", "optimistic-normalized-manifest");
  }
  const argumentsJson = JSON.parse(canonicalJson(value.arguments)) as Record<
    string,
    JsonValue
  >;
  let tokenMetadata: NormalizedTokenMetadata | undefined;
  if (value.tokenMetadata !== undefined) {
    if (!isPlainRecord(value.tokenMetadata)) {
      throw validationError("postgres", "optimistic-token-metadata");
    }
    const metadata = value.tokenMetadata;
    const providerIdentities = metadata.providerIdentities;
    const providerVendorGroups = metadata.providerVendorGroups;
    const endpoints = metadata.providerEndpointCommitments;
    const origins = metadata.providerOriginCommitments;
    if (
      !Array.isArray(providerIdentities) || providerIdentities.length !== 2 ||
      providerIdentities.some((item) => typeof item !== "string") ||
      providerIdentities[0] === providerIdentities[1] ||
      !Array.isArray(providerVendorGroups) ||
      providerVendorGroups.length !== 2 ||
      providerVendorGroups[0] !== "alchemy" ||
      providerVendorGroups[1] !== "quicknode" ||
      !Array.isArray(endpoints) || endpoints.length !== 2 ||
      !Array.isArray(origins) || origins.length !== 2 ||
      endpoints[0] === endpoints[1] ||
      origins[0] === origins[1]
    ) {
      throw validationError("postgres", "optimistic-token-metadata-evidence");
    }
    tokenMetadata = Object.freeze({
      name: boundedMetadataText(metadata.name, 128, "optimistic-token-name"),
      symbol: boundedMetadataText(metadata.symbol, 32, "optimistic-token-symbol"),
      blockHash: canonicalBytes32(metadata.blockHash),
      providerIdentities: providerIdentities as unknown as readonly [string, string],
      providerVendorGroups: providerVendorGroups as unknown as readonly [string, string],
      providerEndpointCommitments: endpoints.map(canonicalBytes32) as unknown as readonly [HexBytes32, HexBytes32],
      providerOriginCommitments: origins.map(canonicalBytes32) as unknown as readonly [HexBytes32, HexBytes32],
    });
  }
  return Object.freeze({
    schema: NORMALIZED_EVENT_SCHEMA,
    sourceContractName: value.sourceContractName,
    eventName: value.eventName,
    blockTimestamp: timestamp,
    arguments: Object.freeze(argumentsJson),
    ...(tokenMetadata ? { tokenMetadata } : {}),
  });
}

function parseHead(rows: readonly Record<string, unknown>[]): OptimisticLiveHead | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1 || rows[0]?.status !== "canonical") {
    throw validationError("postgres", "optimistic-live-head");
  }
  const row = rows[0]!;
  if (integerText(row.chain_id, "optimistic-head-chain") !== "1") {
    throw validationError("postgres", "optimistic-head-chain");
  }
  return Object.freeze({
    optimisticBlockId: exactUuid(row.optimistic_block_id, "optimistic-head-id"),
    chainId: 1,
    blockNumber: integerText(row.block_number, "optimistic-head-number"),
    blockHash: bytes32FromBytea(row.block_hash),
    parentHash: bytes32FromBytea(row.parent_hash),
    blockTimestamp: isoTimestamp(row.block_timestamp, "optimistic-head-timestamp"),
    providerDeploymentIds: Object.freeze([
      exactUuid(row.provider_a_id, "optimistic-head-provider"),
      exactUuid(row.provider_b_id, "optimistic-head-provider"),
    ] as const),
    providerHeads: Object.freeze([
      integerText(row.provider_a_head, "optimistic-head-provider-number"),
      integerText(row.provider_b_head, "optimistic-head-provider-number"),
    ] as const),
    reorgGeneration: integerText(row.reorg_generation, "optimistic-head-generation"),
    observedAt: isoTimestamp(row.observed_at, "optimistic-head-observed"),
    canonicalAt: isoTimestamp(row.canonical_at, "optimistic-head-canonical"),
  });
}

function parseLiveBlocks(
  rows: readonly Record<string, unknown>[],
  head: OptimisticLiveHead,
): readonly OptimisticLiveBlock[] {
  if (rows.length < 1 || rows.length > Number(LIVE_BLOCK_WINDOW)) {
    throw validationError("postgres", "optimistic-block-segment-bound");
  }
  let segmentStartBlockNumber: string | null = null;
  const blocks = rows.map((row): OptimisticLiveBlock => {
    if (integerText(row.chain_id, "optimistic-block-chain") !== "1") {
      throw validationError("postgres", "optimistic-block-chain");
    }
    const rowSegmentStart = integerText(
      row.segment_start_block_number,
      "optimistic-block-segment-start",
    );
    if (
      segmentStartBlockNumber !== null &&
      rowSegmentStart !== segmentStartBlockNumber
    ) {
      throw validationError("postgres", "optimistic-block-segment-start");
    }
    segmentStartBlockNumber = rowSegmentStart;
    return Object.freeze({
      optimisticBlockId: exactUuid(
        row.optimistic_block_id,
        "optimistic-block-id",
      ),
      chainId: 1,
      blockNumber: integerText(row.block_number, "optimistic-block-number"),
      blockHash: bytes32FromBytea(row.block_hash),
      parentHash: bytes32FromBytea(row.parent_hash),
      reorgGeneration: integerText(
        row.reorg_generation,
        "optimistic-block-generation",
      ),
    });
  });
  const headNumber = BigInt(head.blockNumber);
  const declaredSegmentStart = BigInt(segmentStartBlockNumber!);
  const boundedWindowStart = headNumber >= LIVE_BLOCK_WINDOW
    ? headNumber - (LIVE_BLOCK_WINDOW - 1n)
    : 0n;
  const expectedStart = declaredSegmentStart > boundedWindowStart
    ? declaredSegmentStart
    : boundedWindowStart;
  if (
    declaredSegmentStart > headNumber ||
    BigInt(blocks[0]!.blockNumber) !== expectedStart ||
    blocks.length !== Number(headNumber - expectedStart + 1n)
  ) {
    throw validationError("postgres", "optimistic-block-segment-completeness");
  }
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (block.reorgGeneration !== head.reorgGeneration) {
      throw validationError("postgres", "optimistic-block-generation");
    }
    if (index > 0) {
      const parent = blocks[index - 1]!;
      if (
        BigInt(block.blockNumber) !== BigInt(parent.blockNumber) + 1n ||
        block.parentHash !== parent.blockHash
      ) {
        throw validationError("postgres", "optimistic-block-ancestry");
      }
    }
  }
  const last = blocks.at(-1)!;
  if (
    last.optimisticBlockId !== head.optimisticBlockId ||
    last.blockNumber !== head.blockNumber ||
    last.blockHash !== head.blockHash ||
    last.parentHash !== head.parentHash
  ) {
    throw validationError("postgres", "optimistic-block-head");
  }
  return Object.freeze(blocks);
}

function parseLiveEvent(row: Record<string, unknown>): OptimisticLiveEvent {
  if (integerText(row.chain_id, "optimistic-event-chain") !== "1") {
    throw validationError("postgres", "optimistic-event-chain");
  }
  const orderedTopics = row.ordered_topics;
  if (!Array.isArray(orderedTopics) || orderedTopics.length < 1 || orderedTopics.length > 4) {
    throw validationError("postgres", "optimistic-event-topics");
  }
  const event: OptimisticLiveEvent = Object.freeze({
    optimisticEventId: exactUuid(row.optimistic_event_id, "optimistic-event-id"),
    optimisticBlockId: exactUuid(row.optimistic_block_id, "optimistic-event-block-id"),
    chainId: 1,
    blockNumber: integerText(row.block_number, "optimistic-event-number"),
    blockHash: bytes32FromBytea(row.block_hash),
    transactionHash: bytes32FromBytea(row.transaction_hash),
    transactionIndex: integerNumber(row.transaction_index, "optimistic-event-tx-index"),
    blockGlobalLogIndex: integerNumber(row.block_global_log_index, "optimistic-event-log-index"),
    sourceAddress: addressFromBytea(row.source_address),
    eventSignature: bytes32FromBytea(row.event_signature),
    orderedTopics: Object.freeze(orderedTopics.map(bytes32FromBytea)),
    rawData: dataFromBytea(row.raw_data),
    normalizedPayload: parseNormalizedPayload(row.normalized_payload),
    payloadCommitment: bytes32FromBytea(row.payload_commitment),
    reorgGeneration: integerText(row.reorg_generation, "optimistic-event-generation"),
    observedAt: isoTimestamp(row.observed_at, "optimistic-event-observed"),
  });
  if (
    event.eventSignature !== event.orderedTopics[0] ||
    event.normalizedPayload.sourceContractName !==
      RELEASE_BINDING.sources.find(({ address }) => address === event.sourceAddress)?.contractName
  ) {
    throw validationError("postgres", "optimistic-event-source");
  }
  const expected = commitment("optimistic-event-payload-v1", {
    chainId: event.chainId,
    blockHash: event.blockHash,
    transactionHash: event.transactionHash,
    blockGlobalLogIndex: event.blockGlobalLogIndex,
    optimisticEventId: event.optimisticEventId,
    optimisticBlockId: event.optimisticBlockId,
    transactionIndex: event.transactionIndex,
    sourceAddress: event.sourceAddress,
    orderedTopics: event.orderedTopics,
    rawData: event.rawData,
    normalizedPayload: event.normalizedPayload,
  });
  if (expected !== event.payloadCommitment) {
    throw validationError("postgres", "optimistic-event-commitment");
  }
  try {
    decodeManifestEvent({
      contractName: event.normalizedPayload.sourceContractName,
      eventName: event.normalizedPayload.eventName,
      topics: event.orderedTopics,
      data: event.rawData,
      providerPayload: event.normalizedPayload.arguments,
    });
  } catch {
    throw validationError("postgres", "optimistic-event-redecode");
  }
  return event;
}

function postgresSourceIdentifier(value: unknown, operation: string): string {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") < 1 ||
    Buffer.byteLength(value, "utf8") > 128 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw validationError("postgres", operation);
  }
  return value;
}

function parseLiveMarketState(
  row: Record<string, unknown>,
): OptimisticLiveMarketState {
  if (integerText(row.chain_id, "optimistic-market-chain") !== "1") {
    throw validationError("postgres", "optimistic-market-chain");
  }
  const blockNumber = integerText(
    row.block_number,
    "optimistic-market-block-number",
  );
  const blockHash = bytes32FromBytea(row.block_hash);
  const optimisticBlockId = exactUuid(
    row.optimistic_block_id,
    "optimistic-market-block-id",
  );
  const providerHeads = Object.freeze([
    integerText(row.market_provider_a_head, "optimistic-market-provider-head"),
    integerText(row.market_provider_b_head, "optimistic-market-provider-head"),
  ] as const);
  const providerDeploymentIds = Object.freeze([
    exactUuid(row.provider_a_id, "optimistic-market-provider-id"),
    exactUuid(row.provider_b_id, "optimistic-market-provider-id"),
  ] as const);
  const providerIdentities = Object.freeze([
    postgresSourceIdentifier(
      row.provider_a_identity,
      "optimistic-market-provider-identity",
    ),
    postgresSourceIdentifier(
      row.provider_b_identity,
      "optimistic-market-provider-identity",
    ),
  ] as const);
  const providerVendorGroups = Object.freeze([
    postgresSourceIdentifier(
      row.provider_a_vendor,
      "optimistic-market-provider-vendor",
    ),
    postgresSourceIdentifier(
      row.provider_b_vendor,
      "optimistic-market-provider-vendor",
    ),
  ] as const);
  const providerEndpointCommitments = Object.freeze([
    bytes32FromBytea(row.provider_a_endpoint_commitment),
    bytes32FromBytea(row.provider_b_endpoint_commitment),
  ] as const);
  const providerOriginCommitments = Object.freeze([
    bytes32FromBytea(row.provider_a_origin_commitment),
    bytes32FromBytea(row.provider_b_origin_commitment),
  ] as const);
  const observedAt = isoTimestamp(
    row.observed_at,
    "optimistic-market-observed",
  );
  const bundleContext: OptimisticPersistenceBundle = Object.freeze({
    optimisticBlockId,
    chainId: 1,
    blockNumber,
    blockHash,
    parentHash: blockHash,
    blockTimestamp: observedAt,
    providerDeploymentIds,
    providerHeads,
    providerIdentities,
    providerVendorGroups,
    providerEndpointCommitments,
    providerOriginCommitments,
    providerCallCounts: Object.freeze([
      integerNumber(row.block_provider_call_count_a, "optimistic-market-calls"),
      integerNumber(row.block_provider_call_count_b, "optimistic-market-calls"),
    ] as const),
    // The live-state projection predates the SLA bundle receipt. Its persisted
    // aggregate counts are validated on the state below; metadata phase counts
    // are only needed while assembling a new persistence bundle.
    metadataProviderCallCounts: Object.freeze([0, 0] as const),
    confirmations: integerNumber(
      row.confirmations,
      "optimistic-market-confirmations",
    ),
    evidenceCommitment: bytes32FromBytea(row.evidence_commitment),
    observedAt,
    events: Object.freeze([]),
    marketStates: Object.freeze([]),
  });
  const normalized = normalizePersistenceMarketState(bundleContext, {
    version: row.version as typeof OPTIMISTIC_MARKET_STATE_VERSION,
    finality: row.finality as "optimistic",
    chainId: 1,
    blockNumber,
    blockHash,
    confirmations: bundleContext.confirmations,
    poolId: bytes32FromBytea(row.pool_id),
    tokenAddress: addressFromBytea(row.token_address),
    stateView: addressFromBytea(row.state_view_address),
    stateViewRuntimeCodeHash: bytes32FromBytea(
      row.state_view_runtime_code_hash,
    ),
    market: row.market as OptimisticMarketFields,
    marketCommitment: bytes32FromBytea(row.market_commitment),
    evidenceCommitment: bytes32FromBytea(row.evidence_commitment),
    pool: {
      sqrtPriceX96: integerText(
        row.sqrt_price_x96,
        "optimistic-market-sqrt-price",
      ),
      currentTick: signedIntegerNumber(
        row.current_tick,
        -887_272,
        887_272,
        "optimistic-market-current-tick",
      ),
      activeLiquidity: integerText(
        row.active_liquidity,
        "optimistic-market-liquidity",
      ),
      protocolFeePips: integerNumber(
        row.protocol_fee_pips,
        "optimistic-market-protocol-fee",
      ),
      lpFeePips: integerNumber(
        row.lp_fee_pips,
        "optimistic-market-lp-fee",
      ),
      slot0Result: dataFromBytea(row.slot0_result),
      liquidityResult: dataFromBytea(row.liquidity_result),
    },
    providerIdentities,
    providerVendorGroups,
    providerEndpointCommitments,
    providerOriginCommitments,
    providerHeads,
    blockProviderCallCounts: Object.freeze([
      integerNumber(row.block_provider_call_count_a, "optimistic-market-calls"),
      integerNumber(row.block_provider_call_count_b, "optimistic-market-calls"),
    ] as const),
    marketProviderCallCounts: Object.freeze([
      integerNumber(row.market_provider_call_count_a, "optimistic-market-calls"),
      integerNumber(row.market_provider_call_count_b, "optimistic-market-calls"),
    ] as const),
    totalProviderCallCounts: Object.freeze([
      integerNumber(row.total_provider_call_count_a, "optimistic-market-calls"),
      integerNumber(row.total_provider_call_count_b, "optimistic-market-calls"),
    ] as const),
    optimisticMarketStateId: exactUuid(
      row.optimistic_market_state_id,
      "optimistic-market-state-id",
    ),
    optimisticBlockId,
    providerDeploymentIds,
    observedAt,
  });
  return Object.freeze({
    ...normalized,
    reorgGeneration: integerText(
      row.reorg_generation,
      "optimistic-market-generation",
    ),
  });
}

function buildOptimisticLiveReader(input: {
  executor: PostgresExecutor;
  now?: () => Date;
  transactionPrepared: boolean;
}) {
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async snapshot(chainId: 1 = 1): Promise<OptimisticLiveSnapshot> {
      if (chainId !== 1) throw invalidInput("postgres", "optimistic-chain-id");
      try {
        return await input.executor.transaction(async (transaction) => {
          if (!input.transactionPrepared) {
            await transaction.query(
              "set transaction isolation level repeatable read, read only",
            );
            await establishPostgresApiReaderRole(transaction);
            await transaction.query("set local statement_timeout = '1000ms'");
            await transaction.query("set local lock_timeout = '250ms'");
            await transaction.query(
              "set local idle_in_transaction_session_timeout = '2000ms'",
            );
          }
          const head = parseHead(
            await transaction.query<Record<string, unknown>>(
              "select * from programmable_private.get_optimistic_live_head_v1($1::bigint)",
              [String(chainId)],
            ),
          );
          if (!head) {
            return Object.freeze({
              head: null,
              blocks: Object.freeze([]),
              events: Object.freeze([]),
              marketStates: Object.freeze([]),
            });
          }
          const nowValue = now();
          const nowMs = nowValue instanceof Date ? nowValue.valueOf() : Number.NaN;
          const observedMs = Date.parse(head.observedAt);
          const canonicalMs = Date.parse(head.canonicalAt);
          if (
            !Number.isFinite(nowMs) ||
            nowMs - observedMs > MAXIMUM_LIVE_HEAD_AGE_MS ||
            nowMs - canonicalMs > MAXIMUM_LIVE_HEAD_AGE_MS ||
            observedMs - nowMs > MAXIMUM_LIVE_HEAD_CLOCK_SKEW_MS ||
            canonicalMs - nowMs > MAXIMUM_LIVE_HEAD_CLOCK_SKEW_MS
          ) {
            return Object.freeze({
              head: null,
              blocks: Object.freeze([]),
              events: Object.freeze([]),
              marketStates: Object.freeze([]),
            });
          }
          const blocks = parseLiveBlocks(
            await transaction.query<Record<string, unknown>>(
              "select * from programmable_private.list_optimistic_live_chain_segment_v1($1::bigint)",
              [String(chainId)],
            ),
            head,
          );
          const events: OptimisticLiveEvent[] = [];
          const headNumber = BigInt(head.blockNumber);
          const firstLiveBlock = headNumber >= LIVE_BLOCK_WINDOW
            ? headNumber - (LIVE_BLOCK_WINDOW - 1n)
            : 0n;
          let cursor: Readonly<{
            blockNumber: string;
            blockGlobalLogIndex: number;
            optimisticEventId: string;
          }> | null = null;
          do {
            const rows: readonly Record<string, unknown>[] =
              await transaction.query<Record<string, unknown>>(
              `select * from programmable_private.list_optimistic_canonical_events_v1(
                 $1::bigint, $2::bigint, $3::bigint, $4::uuid, $5::integer
               )`,
              [
                String(chainId),
                cursor?.blockNumber ?? null,
                cursor === null ? null : String(cursor.blockGlobalLogIndex),
                cursor?.optimisticEventId ?? null,
                LIVE_EVENT_PAGE_SIZE,
              ],
            );
            const page: OptimisticLiveEvent[] = rows.map(parseLiveEvent);
            for (const event of page) {
              const previous = events.at(-1);
              if (
                previous &&
                (BigInt(event.blockNumber) < BigInt(previous.blockNumber) ||
                  (event.blockNumber === previous.blockNumber &&
                    (event.blockGlobalLogIndex < previous.blockGlobalLogIndex ||
                      (event.blockGlobalLogIndex === previous.blockGlobalLogIndex &&
                        event.optimisticEventId <= previous.optimisticEventId))))
              ) {
                throw validationError("postgres", "optimistic-event-order");
              }
              if (event.reorgGeneration !== head.reorgGeneration) {
                throw validationError("postgres", "optimistic-event-generation");
              }
              if (
                BigInt(event.blockNumber) < firstLiveBlock ||
                BigInt(event.blockNumber) > headNumber
              ) {
                throw validationError("postgres", "optimistic-event-window");
              }
              events.push(event);
              if (events.length > MAXIMUM_LIVE_EVENTS) {
                throw validationError("postgres", "optimistic-event-bound");
              }
            }
            cursor = page.at(-1) ?? null;
            if (page.length < LIVE_EVENT_PAGE_SIZE) break;
          } while (cursor !== null);
          const marketStates: OptimisticLiveMarketState[] = [];
          let marketCursor: Readonly<{
            blockNumber: string;
            poolId: HexBytes32;
            optimisticMarketStateId: string;
          }> | null = null;
          do {
            const rows: readonly Record<string, unknown>[] =
              await transaction.query<Record<string, unknown>>(
              `select * from programmable_private.list_optimistic_canonical_market_states_v1(
                 $1::bigint, $2::bigint, $3::bytea, $4::uuid, $5::integer
               )`,
              [
                String(chainId),
                marketCursor?.blockNumber ?? null,
                marketCursor ? hexToBytes(marketCursor.poolId) : null,
                marketCursor?.optimisticMarketStateId ?? null,
                LIVE_MARKET_STATE_PAGE_SIZE,
              ],
            );
            const page: OptimisticLiveMarketState[] =
              rows.map(parseLiveMarketState);
            for (const state of page) {
              const previous = marketStates.at(-1);
              if (
                previous &&
                (BigInt(state.blockNumber) < BigInt(previous.blockNumber) ||
                  (state.blockNumber === previous.blockNumber &&
                    (state.poolId < previous.poolId ||
                      (state.poolId === previous.poolId &&
                        state.optimisticMarketStateId <=
                          previous.optimisticMarketStateId))))
              ) {
                throw validationError("postgres", "optimistic-market-order");
              }
              if (
                state.reorgGeneration !== head.reorgGeneration ||
                BigInt(state.blockNumber) < firstLiveBlock ||
                BigInt(state.blockNumber) > headNumber
              ) {
                throw validationError("postgres", "optimistic-market-window");
              }
              marketStates.push(state);
              if (marketStates.length > MAXIMUM_LIVE_MARKET_STATES) {
                throw validationError("postgres", "optimistic-market-bound");
              }
            }
            const last: OptimisticLiveMarketState | undefined = page.at(-1);
            marketCursor = last
              ? Object.freeze({
                  blockNumber: last.blockNumber,
                  poolId: last.poolId,
                  optimisticMarketStateId: last.optimisticMarketStateId,
                })
              : null;
            if (page.length < LIVE_MARKET_STATE_PAGE_SIZE) break;
          } while (marketCursor !== null);
          return Object.freeze({
            head,
            blocks,
            events: Object.freeze(events),
            marketStates: Object.freeze(marketStates),
          });
        });
      } catch (error) {
        if (error instanceof DataPipelineError) throw error;
        throw dataPipelineError({
          dependency: "postgres",
          code: "query_failed",
          retryable: true,
          countsTowardCircuit: true,
          metadata: { operation: "optimistic-live-snapshot" },
        });
      }
    },
  });
}

export function createOptimisticLiveReader(input: {
  executor: PostgresExecutor;
  now?: () => Date;
}) {
  return buildOptimisticLiveReader({
    ...input,
    transactionPrepared: false,
  });
}

/**
 * Uses the process-wide API-reader pool and its already-prepared immutable
 * transaction. Public routes never parse database URLs or create pools.
 */
export async function readConfiguredOptimisticLiveSnapshot(
  chainId: 1 = 1,
): Promise<OptimisticLiveSnapshot> {
  const readModel = await getServerReadModel({ required: true });
  if (!readModel) {
    return Object.freeze({
      head: null,
      blocks: Object.freeze([]),
      events: Object.freeze([]),
      marketStates: Object.freeze([]),
    });
  }
  const executor: PostgresExecutor = Object.freeze({
    transaction: (work) => readModel.repeatableReadSnapshot(work),
    close: async () => undefined,
  });
  return buildOptimisticLiveReader({
    executor,
    transactionPrepared: true,
  }).snapshot(chainId);
}

function releaseForLaunchEvent(event: OptimisticLiveEvent) {
  if (!["MemeTokenLaunched", "MemeTokenLaunchedV2", "StockPairedTokenLaunched"]
    .includes(event.normalizedPayload.eventName)) {
    return null;
  }
  const matches = RELEASE_BINDING.releases.filter((release) =>
    release.sourceContracts.includes(event.normalizedPayload.sourceContractName),
  );
  return matches.length === 1 ? matches[0]! : null;
}

function foldEvent(
  event: OptimisticLiveEvent,
  release: (typeof RELEASE_BINDING.releases)[number],
  snapshot: OptimisticLiveSnapshot,
  providerEvidence: NormalizedTokenMetadata,
  receiptLogOrdinal: number,
): ProjectorFoldEvent {
  const payloadHash = event.payloadCommitment;
  const candidate: EnvioCandidate = {
    candidateId: `1:${event.blockHash}:${event.transactionHash}:${event.blockGlobalLogIndex}`,
    chainId: 1,
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    blockTimestamp: event.normalizedPayload.blockTimestamp,
    transactionHash: event.transactionHash,
    transactionIndex: event.transactionIndex,
    blockGlobalLogIndex: event.blockGlobalLogIndex,
    sourceAddress: event.sourceAddress,
    contractName: event.normalizedPayload.sourceContractName,
    eventName: event.normalizedPayload.eventName,
    releaseHint: {
      model: release.model as "classic" | "stock-paired",
      releaseVersion: release.releaseVersion,
    },
    orderedTopics: [...event.orderedTopics],
    rawData: event.rawData,
    decodedPayload: { ...event.normalizedPayload.arguments },
    payloadHash,
  };
  const source = RELEASE_BINDING.sources.find(
    ({ contractName }) => contractName === candidate.contractName,
  );
  if (!source || !snapshot.head) {
    throw validationError("postgres", "optimistic-fold-source");
  }
  return Object.freeze({
    candidate,
    releaseContext: Object.freeze({
      model: release.model as "classic" | "stock-paired",
      releaseVersion: release.releaseVersion as
        | "classic-v2"
        | "classic-v3"
        | "stock-paired-v1"
        | "stock-paired-v2"
        | "stock-paired-v3",
    }),
    evidence: {
      chainId: 1,
      candidateId: candidate.candidateId,
      sourceAddress: candidate.sourceAddress,
      contractName: candidate.contractName,
      eventName: candidate.eventName,
      sourceKind: "static",
      model: release.model as "classic" | "stock-paired",
      releaseVersion: release.releaseVersion,
      payloadHash,
      rawLogCommitment: event.payloadCommitment,
      providerIdentities: providerEvidence.providerIdentities,
      providerVendorGroups: providerEvidence.providerVendorGroups,
      providerEndpointCommitments: providerEvidence.providerEndpointCommitments,
      providerOriginCommitments: providerEvidence.providerOriginCommitments,
      providerHeads: snapshot.head.providerHeads,
      safeBlockNumber: event.blockNumber,
      safeBlockHash: event.blockHash,
      candidateBlockNumber: event.blockNumber,
      candidateBlockHash: event.blockHash,
      candidateBlockTimestamp: candidate.blockTimestamp,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      receiptCommitment: event.payloadCommitment,
      sourceCodeHash: source.runtimeCodeHash,
      receiptLogOrdinal,
    },
  });
}

function launchToken(
  launch: ProjectorCompletedLaunch,
  occurrence: OptimisticLiveEvent,
): LauncherToken {
  const fees = launch.feeConfiguration;
  const buySwapFeeBps = Number(fees.buySwapFeeBps);
  const sellSwapFeeBps = Number(fees.sellSwapFeeBps);
  const buyCreatorFeeBps = Number(fees.buyCreatorFeeBps);
  const sellCreatorFeeBps = Number(fees.sellCreatorFeeBps);
  const launcherFeeBps = Number(fees.launcherFeeBps);
  const transferTaxBps = Number(fees.transferTaxBps);
  const lpFeePips = Number(fees.lpFeePips);
  const totalSwapFeeBps = Number(
    BigInt(fees.buySwapFeeBps) > BigInt(fees.sellSwapFeeBps)
      ? fees.buySwapFeeBps
      : fees.sellSwapFeeBps,
  );
  if (
    ![
      buySwapFeeBps,
      sellSwapFeeBps,
      buyCreatorFeeBps,
      sellCreatorFeeBps,
      launcherFeeBps,
      transferTaxBps,
      lpFeePips,
      totalSwapFeeBps,
    ].every(Number.isSafeInteger) ||
    totalSwapFeeBps !== Math.max(buySwapFeeBps, sellSwapFeeBps) ||
    buyCreatorFeeBps + launcherFeeBps !== buySwapFeeBps ||
    sellCreatorFeeBps + launcherFeeBps !== sellSwapFeeBps ||
    launcherFeeBps !== 10 ||
    transferTaxBps !== 0 ||
    lpFeePips !== 0 ||
    (launch.releaseVersion === "classic-v2" &&
      (buySwapFeeBps !== sellSwapFeeBps ||
        buyCreatorFeeBps !== sellCreatorFeeBps ||
        totalSwapFeeBps < 100 ||
        totalSwapFeeBps > 1_000 ||
        totalSwapFeeBps % 100 !== 0)) ||
    (launch.model === "stock-paired" &&
      (totalSwapFeeBps !== 100 ||
        buySwapFeeBps !== 100 ||
        sellSwapFeeBps !== 100 ||
        buyCreatorFeeBps !== 90 ||
        sellCreatorFeeBps !== 90))
  ) {
    throw validationError("postgres", "optimistic-launch-policy");
  }
  const decimals = 18;
  return Object.freeze({
    id: `1:${launch.token.toLowerCase()}`,
    name: launch.tokenName,
    symbol: launch.tokenSymbol,
    tokenAddress: launch.token,
    hookAddress: launch.pool.hook,
    poolId: launch.poolId,
    creatorAddress: launch.creator,
    positionRecipient: launch.positionRecipient,
    positionTokenId: launch.positionTokenId,
    launchHash: launch.launchHash,
    launchBlockNumber: occurrence.blockNumber,
    launchTransactionHash: occurrence.transactionHash,
    launchTransactionIndex: occurrence.transactionIndex,
    launchLogIndex: occurrence.blockGlobalLogIndex,
    launchedAt: blockTimestampIso(occurrence.normalizedPayload.blockTimestamp),
    totalSupply: formatUnits(BigInt(launch.totalSupply), decimals),
    totalSupplyRaw: launch.totalSupply,
    tokenDecimals: decimals,
    tokenLiquidityAmountRaw: launch.liquidity.tokenLiquidityAmount,
    lockedTokenDustRaw: launch.liquidity.lockedTokenDust,
    ...(launch.model === "stock-paired"
      ? {
          quoteAssetAddress: launch.initialBuy.fundingAsset,
          quoteIsCurrency0:
            BigInt(launch.initialBuy.fundingAsset) < BigInt(launch.token),
        }
      : {}),
    ...(launch.rewardVault ? { rewardVaultAddress: launch.rewardVault } : {}),
    initialTick: Number(launch.liquidity.initialTick),
    tickLower: Number(launch.liquidity.tickLower),
    tickUpper: Number(launch.liquidity.tickUpper),
    protocolFeePips: 0,
    lpFeePips,
    buyHookFeeBps: buySwapFeeBps,
    sellHookFeeBps: sellSwapFeeBps,
    ...(buyCreatorFeeBps === sellCreatorFeeBps
      ? { creatorFeeBps: buyCreatorFeeBps }
      : {}),
    buyCreatorFeeBps,
    sellCreatorFeeBps,
    ...(launch.releaseVersion === "classic-v2"
      ? {}
      : { programmableFeeBps: launcherFeeBps }),
    launcherFeeBps,
    transferTaxBps,
    totalSwapFeeBps,
    launchModel: launch.model === "classic" ? "classic" : "stock-paired",
    launchModelVersion: launch.releaseVersion === "classic-v2"
      ? undefined
      : launch.releaseVersion,
    liquidityPath: "meme",
  });
}

function snapshotForPersistenceBundle(
  bundle: OptimisticPersistenceBundle,
): OptimisticLiveSnapshot {
  return Object.freeze({
    head: Object.freeze({
      optimisticBlockId: bundle.optimisticBlockId,
      chainId: 1,
      blockNumber: bundle.blockNumber,
      blockHash: bundle.blockHash,
      parentHash: bundle.parentHash,
      blockTimestamp: bundle.blockTimestamp,
      providerDeploymentIds: bundle.providerDeploymentIds,
      providerHeads: bundle.providerHeads,
      reorgGeneration: "0",
      observedAt: bundle.observedAt,
      canonicalAt: bundle.observedAt,
    }),
    blocks: Object.freeze([
      Object.freeze({
        optimisticBlockId: bundle.optimisticBlockId,
        chainId: 1 as const,
        blockNumber: bundle.blockNumber,
        blockHash: bundle.blockHash,
        parentHash: bundle.parentHash,
        reorgGeneration: "0",
      }),
    ]),
    events: Object.freeze(bundle.events.map((event) => Object.freeze({
      ...event,
      chainId: 1 as const,
      blockNumber: bundle.blockNumber,
      blockHash: bundle.blockHash,
      reorgGeneration: "0",
      observedAt: bundle.observedAt,
    }))),
    marketStates: Object.freeze([]),
  });
}

type PlannedOptimisticMarketRead = Readonly<{
  poolId: HexBytes32;
  tokenAddress: HexAddress;
  token?: LauncherToken;
  newLaunch?: OptimisticNewLaunchMarketInput;
}>;

function completeNewLaunchMarketPlans(
  bundle: OptimisticPersistenceBundle,
): readonly PlannedOptimisticMarketRead[] {
  const snapshot = snapshotForPersistenceBundle(bundle);
  const plans = new Map<HexBytes32, PlannedOptimisticMarketRead>();
  for (const launchEvent of snapshot.events.filter(releaseForLaunchEvent)) {
    const release = releaseForLaunchEvent(launchEvent)!;
    const metadata = launchEvent.normalizedPayload.tokenMetadata;
    if (!metadata || metadata.blockHash !== bundle.blockHash) continue;
    const transactionEvents = snapshot.events.filter(
      (event) =>
        event.transactionHash === launchEvent.transactionHash &&
        event.blockHash === launchEvent.blockHash &&
        release.sourceContracts.includes(
          event.normalizedPayload.sourceContractName,
        ),
    );
    try {
      const folded = foldProjectorEvents({
        events: transactionEvents.map((event, index) =>
          foldEvent(event, release, snapshot, metadata, index)),
        tokenMetadata: {
          [canonicalAddress(launchEvent.normalizedPayload.arguments.token)]: {
            name: metadata.name,
            symbol: metadata.symbol,
          },
        },
      });
      const launch = folded.launches.find(
        (candidate) =>
          candidate.launchTransactionHash === launchEvent.transactionHash,
      );
      if (!launch) continue;
      const tokenAddress = canonicalAddress(launch.token);
      const poolId = canonicalBytes32(launch.poolId);
      const quoteAssetAddress = launch.model === "stock-paired"
        ? canonicalAddress(
            launch.pool.currency0 === tokenAddress
              ? launch.pool.currency1
              : launch.pool.currency0,
          )
        : undefined;
      const newLaunch: OptimisticNewLaunchMarketInput = Object.freeze({
        tokenAddress,
        poolId,
        totalSupplyRaw: integerText(
          launch.totalSupply,
          "optimistic-new-launch-supply",
        ),
        tokenDecimals: 18,
        launchModel: launch.model === "classic"
          ? "classic"
          : "stock-paired",
        poolKey: Object.freeze({
          currency0: launch.pool.currency0,
          currency1: launch.pool.currency1,
          fee: Number(BigInt(launch.pool.poolKeyFee)),
          tickSpacing: Number(BigInt(launch.pool.tickSpacing)),
          hooks: launch.pool.hook,
        }),
        ...(quoteAssetAddress
          ? {
              quoteAssetAddress,
              quoteAssetDecimals: 18,
              quoteIsCurrency0:
                launch.pool.currency0 === quoteAssetAddress,
            }
          : {}),
      });
      const existing = plans.get(poolId);
      if (
        existing &&
        (existing.tokenAddress !== tokenAddress ||
          canonicalJson(existing.newLaunch) !== canonicalJson(newLaunch))
      ) {
        throw validationError("rpc", "optimistic-market-launch-ambiguity");
      }
      plans.set(poolId, Object.freeze({ poolId, tokenAddress, newLaunch }));
    } catch (error) {
      if (error instanceof DataPipelineError) throw error;
      // Incomplete same-transaction groups never become market read plans.
    }
  }
  return Object.freeze([...plans.values()]);
}

export function configuredOptimisticMarketReadPlans(input: Readonly<{
  bundle: OptimisticPersistenceBundle;
  canonicalTokens: readonly LauncherToken[];
  ensureTrackedMarket?: boolean;
}>): readonly PlannedOptimisticMarketRead[] {
  const plans = new Map<HexBytes32, PlannedOptimisticMarketRead>();
  const ambiguousPools = new Set<HexBytes32>();
  for (const token of input.canonicalTokens) {
    try {
      const poolId = canonicalBytes32(token.poolId);
      const tokenAddress = canonicalAddress(token.tokenAddress);
      const existing = plans.get(poolId);
      if (existing && existing.tokenAddress !== tokenAddress) {
        plans.delete(poolId);
        ambiguousPools.add(poolId);
      } else if (!ambiguousPools.has(poolId)) {
        plans.set(poolId, Object.freeze({ poolId, tokenAddress, token }));
      }
    } catch {
      // Malformed canonical rows cannot authorize an optimistic market read.
    }
  }
  const relevantFeePools = new Set<HexBytes32>();
  for (const event of input.bundle.events) {
    if (
      event.normalizedPayload.eventName !== "NativeSwapFeesAccrued" &&
      event.normalizedPayload.eventName !== "QuoteSwapFeesAccrued"
    ) {
      continue;
    }
    relevantFeePools.add(canonicalBytes32(
      event.normalizedPayload.arguments.poolId,
    ));
  }
  for (const poolId of [...plans.keys()]) {
    if (!relevantFeePools.has(poolId)) plans.delete(poolId);
  }
  for (const launchPlan of completeNewLaunchMarketPlans(input.bundle)) {
    plans.set(launchPlan.poolId, launchPlan);
  }
  const hasClassicPlan = [...plans.values()].some(
    (plan) => plan.token?.launchModel === "classic",
  );
  if (!hasClassicPlan && input.ensureTrackedMarket) {
    const sentinel = [...input.canonicalTokens]
      .filter((token) => token.launchModel === "classic")
      .sort((left, right) => left.poolId.localeCompare(right.poolId))[0];
    if (sentinel) {
      const poolId = canonicalBytes32(sentinel.poolId);
      plans.set(poolId, Object.freeze({
        poolId,
        tokenAddress: canonicalAddress(sentinel.tokenAddress),
        token: sentinel,
      }));
    }
  }
  const selected = [...plans.values()].sort((left, right) =>
    left.poolId.localeCompare(right.poolId));
  if (selected.length > MAXIMUM_PERSISTED_MARKET_STATES_PER_BLOCK) {
    throw validationError("rpc", "optimistic-market-state-bound");
  }
  return Object.freeze(selected);
}

async function readMarketPlansBounded(
  plans: readonly PlannedOptimisticMarketRead[],
  read: (plan: PlannedOptimisticMarketRead) => Promise<OptimisticMarketStateEvidence>,
): Promise<readonly OptimisticMarketStateEvidence[]> {
  const results = new Array<OptimisticMarketStateEvidence>(plans.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < plans.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await read(plans[index]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, plans.length) }, worker),
  );
  return Object.freeze(results);
}

/**
 * Builds the only accepted first-stage market reader. Existing pools must be
 * present in the full canonical corpus and new pools must complete the same
 * reviewed launch transaction fold before any StateView call starts.
 */
export function createOptimisticMarketStateReader(input: Readonly<{
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  loadCanonicalTokens: () => Promise<readonly LauncherToken[]>;
  hardDeadlineMs?: number;
  ensureTrackedMarket?: boolean;
}>): OptimisticMarketStateReader {
  return async ({ block, bundle }) => {
    const canonicalTokens = await input.loadCanonicalTokens();
    if (!Array.isArray(canonicalTokens)) {
      throw validationError("config", "optimistic-canonical-token-corpus");
    }
    const plans = configuredOptimisticMarketReadPlans({
      bundle,
      canonicalTokens,
      ...(input.ensureTrackedMarket === undefined
        ? {}
        : { ensureTrackedMarket: input.ensureTrackedMarket }),
    });
    return readMarketPlansBounded(plans, (plan) =>
      readOptimisticMarketState({
        providers: input.providers,
        evidence: block,
        stateView: OPTIMISTIC_MAINNET_STATE_VIEW,
        poolId: plan.poolId,
        tokenAddress: plan.tokenAddress,
        ...(plan.token ? { token: plan.token } : {}),
        ...(plan.newLaunch ? { newLaunch: plan.newLaunch } : {}),
        ...(input.hardDeadlineMs === undefined
          ? {}
          : { hardDeadlineMs: input.hardDeadlineMs }),
      }));
  };
}

function evidenceFor(
  snapshot: OptimisticLiveSnapshot,
  event: OptimisticLiveEvent,
) {
  if (!snapshot.head) throw validationError("postgres", "optimistic-head-missing");
  const lowestHead = BigInt(snapshot.head.providerHeads[0]) <
      BigInt(snapshot.head.providerHeads[1])
    ? BigInt(snapshot.head.providerHeads[0])
    : BigInt(snapshot.head.providerHeads[1]);
  const confirmations = lowestHead - BigInt(event.blockNumber);
  if (confirmations < 0n || confirmations > BigInt(MAXIMUM_OPTIMISTIC_CONFIRMATIONS)) {
    return null;
  }
  return Object.freeze({
    eligibility: "optimistic",
    source: "dual-rpc-head",
    finality: "optimistic",
    chainId: 1,
    blockNumber: event.blockNumber,
    blockHash: event.blockHash,
    primaryBlockNumber: event.blockNumber,
    primaryBlockHash: event.blockHash,
    secondaryBlockNumber: event.blockNumber,
    secondaryBlockHash: event.blockHash,
    confirmations: Number(confirmations),
    finalityDepth: 12,
    observedAt: event.observedAt,
  });
}

function marketEvidenceFor(
  state: OptimisticLiveMarketState,
  event: OptimisticLiveEvent,
) {
  const lowestHead = BigInt(state.providerHeads[0]) <
      BigInt(state.providerHeads[1])
    ? BigInt(state.providerHeads[0])
    : BigInt(state.providerHeads[1]);
  const confirmations = lowestHead - BigInt(state.blockNumber);
  if (
    event.optimisticBlockId !== state.optimisticBlockId ||
    event.blockNumber !== state.blockNumber ||
    event.blockHash !== state.blockHash ||
    confirmations < 0n ||
    confirmations > BigInt(MAXIMUM_OPTIMISTIC_CONFIRMATIONS) ||
    Number(confirmations) !== state.confirmations
  ) {
    return null;
  }
  return Object.freeze({
    eligibility: "optimistic",
    source: "dual-rpc-head",
    finality: "optimistic",
    chainId: 1,
    blockNumber: state.blockNumber,
    blockHash: state.blockHash,
    primaryBlockNumber: state.blockNumber,
    primaryBlockHash: state.blockHash,
    secondaryBlockNumber: state.blockNumber,
    secondaryBlockHash: state.blockHash,
    confirmations: state.confirmations,
    finalityDepth: 12,
    observedAt: state.observedAt,
  });
}

export function optimisticOverlayRowsFromSnapshot(input: Readonly<{
  snapshot: OptimisticLiveSnapshot;
  canonicalTokens: readonly LauncherToken[];
}>): readonly OptimisticOverlayRow[] {
  if (!input.snapshot.head) return Object.freeze([]);
  const rows: OptimisticOverlayRow[] = [];
  const transactionEvents = new Map<string, OptimisticLiveEvent[]>();
  for (const event of input.snapshot.events) {
    const key = `${event.blockHash}:${event.transactionHash}`;
    const grouped = transactionEvents.get(key);
    if (grouped) grouped.push(event);
    else transactionEvents.set(key, [event]);
  }
  type Release = NonNullable<ReturnType<typeof releaseForLaunchEvent>>;
  const launchGroups = new Map<
    string,
    { release: Release; events: OptimisticLiveEvent[] }
  >();
  for (const event of input.snapshot.events) {
    const release = releaseForLaunchEvent(event);
    if (!release) continue;
    const key = [
      event.blockHash,
      event.transactionHash,
      release.releaseVersion,
    ].join(":");
    const grouped = launchGroups.get(key);
    if (grouped) grouped.events.push(event);
    else launchGroups.set(key, { release, events: [event] });
  }
  for (const group of launchGroups.values()) {
    const firstLaunch = group.events[0]!;
    const launchTransactionEvents = (transactionEvents.get(
      `${firstLaunch.blockHash}:${firstLaunch.transactionHash}`,
    ) ?? []).filter((event) =>
      group.release.sourceContracts.includes(
        event.normalizedPayload.sourceContractName,
      ));
    if (launchTransactionEvents.length === 0) continue;
    try {
      const tokenMetadata: Record<string, { name: string; symbol: string }> = {};
      let providerEvidence: NormalizedTokenMetadata | null = null;
      let providerEvidenceIdentity: string | null = null;
      for (const launchEvent of group.events) {
        const metadata = launchEvent.normalizedPayload.tokenMetadata;
        if (!metadata || metadata.blockHash !== launchEvent.blockHash) {
          throw validationError("postgres", "optimistic-launch-metadata");
        }
        const identity = canonicalJson({
          blockHash: metadata.blockHash,
          providerIdentities: metadata.providerIdentities,
          providerVendorGroups: metadata.providerVendorGroups,
          providerEndpointCommitments: metadata.providerEndpointCommitments,
          providerOriginCommitments: metadata.providerOriginCommitments,
        });
        if (providerEvidenceIdentity && providerEvidenceIdentity !== identity) {
          throw validationError("postgres", "optimistic-launch-metadata");
        }
        providerEvidence ??= metadata;
        providerEvidenceIdentity ??= identity;
        tokenMetadata[
          canonicalAddress(launchEvent.normalizedPayload.arguments.token)
        ] = { name: metadata.name, symbol: metadata.symbol };
      }
      if (!providerEvidence) continue;
      const folded = foldProjectorEvents({
        events: launchTransactionEvents.map((event, index) =>
          foldEvent(
            event,
            group.release,
            input.snapshot,
            providerEvidence,
            index,
          )),
        tokenMetadata,
      });
      const completedByToken = new Map(
        folded.launches.map((launch) => [
          canonicalAddress(launch.token),
          launch,
        ] as const),
      );
      for (const launchEvent of group.events) {
        const completed = completedByToken.get(canonicalAddress(
          launchEvent.normalizedPayload.arguments.token,
        ));
        const evidence = evidenceFor(input.snapshot, launchEvent);
        if (
          !completed ||
          completed.launchTransactionHash !== launchEvent.transactionHash ||
          !evidence
        ) {
          continue;
        }
        const token = launchToken(completed, launchEvent);
        rows.push(Object.freeze({
          kind: "launch" as const,
          evidenceCommitment: launchEvent.payloadCommitment,
          evidence,
          event: Object.freeze({
            transactionHash: launchEvent.transactionHash,
            logIndex: launchEvent.blockGlobalLogIndex,
          }),
          poolId: completed.poolId,
          tokenAddress: completed.token,
          token,
        }));
      }
    } catch {
      // A partial or internally inconsistent launch group is never public.
    }
  }
  const tokensByPool = new Map<string, HexAddress>();
  for (const token of input.canonicalTokens) {
    const pool = canonicalBytes32(token.poolId).toLowerCase();
    const address = canonicalAddress(token.tokenAddress);
    const existing = tokensByPool.get(pool);
    if (existing && existing !== address) tokensByPool.delete(pool);
    else if (!existing) tokensByPool.set(pool, address);
  }
  for (const row of rows) {
    if (row.kind === "launch") tokensByPool.set(row.poolId.toLowerCase(), row.tokenAddress);
  }
  const optimisticLaunchPools = new Set(
    rows
      .filter((row) => row.kind === "launch")
      .map(({ poolId }) => poolId.toLowerCase()),
  );
  const latestMarketEvent = new Map<string, OptimisticLiveEvent>();
  for (const event of input.snapshot.events) {
    const payload = event.normalizedPayload;
    const isFeeEvent = [
      "NativeSwapFeesAccrued",
      "QuoteSwapFeesAccrued",
    ].includes(payload.eventName);
    const isLaunchEvent = [
      "MemeTokenLaunched",
      "MemeTokenLaunchedV2",
      "StockPairedTokenLaunched",
    ].includes(payload.eventName);
    if (!isFeeEvent && !isLaunchEvent) continue;
    try {
      const poolId = canonicalBytes32(payload.arguments.poolId).toLowerCase();
      if (isLaunchEvent && !optimisticLaunchPools.has(poolId)) continue;
      latestMarketEvent.set(
        `${event.optimisticBlockId}:${event.blockHash}:${poolId}`,
        event,
      );
    } catch {
      // Malformed pool identities cannot authorize an optimistic market row.
    }
  }
  for (const state of input.snapshot.marketStates) {
    const event = latestMarketEvent.get(
      `${state.optimisticBlockId}:${state.blockHash}:${state.poolId.toLowerCase()}`,
    );
    if (!event || state.chainId !== 1 || state.confirmations < 0 || state.confirmations > 11) {
      continue;
    }
    const expectedToken = tokensByPool.get(state.poolId.toLowerCase());
    const evidence = marketEvidenceFor(state, event);
    if (
      !expectedToken ||
      expectedToken !== canonicalAddress(state.tokenAddress) ||
      !evidence ||
      state.market.indexedValuationBlockNumber !== state.blockNumber
    ) {
      continue;
    }
    rows.push(Object.freeze({
      kind: "market" as const,
      evidenceCommitment: state.evidenceCommitment,
      evidence,
      event: Object.freeze({
        transactionHash: event.transactionHash,
        logIndex: event.blockGlobalLogIndex,
      }),
      poolId: state.poolId,
      tokenAddress: state.tokenAddress,
      market: Object.freeze({ ...state.market }),
    }));
  }
  return Object.freeze(rows);
}

export function applyOptimisticLiveOverlay(input: Readonly<{
  snapshot: OptimisticLiveSnapshot;
  canonicalTokens: readonly LauncherToken[];
}>): OptimisticTokenCorpusResult {
  const overlay = selectEligibleOptimisticOverlay({
    rows: optimisticOverlayRowsFromSnapshot(input),
    chainId: 1,
  });
  return mergeOptimisticTokenCorpus({
    canonicalTokens: input.canonicalTokens,
    overlay,
  });
}

export type OptimisticLiveWriter = ReturnType<typeof createOptimisticLiveWriter>;
export type OptimisticLiveReader = ReturnType<typeof createOptimisticLiveReader>;
export type OptimisticLiveWriterFailure = ProjectorDatabaseError;
