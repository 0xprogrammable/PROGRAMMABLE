import "server-only";

import {
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
  readDualRpcTokenMetadata,
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
import { getDataPipelineReleaseBinding } from "./release-binding.server";

const RELEASE_BINDING = getDataPipelineReleaseBinding();
const MAXIMUM_OPTIMISTIC_CONFIRMATIONS = 11;
const MAXIMUM_PERSISTED_EVENTS_PER_BLOCK = 500;
const LIVE_BLOCK_WINDOW = 12n;
const MAXIMUM_LIVE_EVENTS =
  MAXIMUM_PERSISTED_EVENTS_PER_BLOCK * Number(LIVE_BLOCK_WINDOW);
const LIVE_EVENT_PAGE_SIZE = 500;
const MAXIMUM_LIVE_HEAD_AGE_MS = 60_000;
const MAXIMUM_LIVE_HEAD_CLOCK_SKEW_MS = 30_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NORMALIZED_EVENT_SCHEMA = "programmable-optimistic-event-v1" as const;

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
  confirmations: number;
  evidenceCommitment: HexBytes32;
  observedAt: string;
  events: readonly OptimisticPersistenceEvent[];
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
  events: readonly OptimisticLiveEvent[];
}>;

export type OptimisticMarketStateEvidence = Readonly<{
  chainId: 1;
  blockNumber: string;
  blockHash: HexBytes32;
  confirmations: number;
  poolId: HexBytes32;
  tokenAddress: HexAddress;
  market: OptimisticMarketFields;
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
  providerHeads: readonly [string, string];
}>;

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
  const metadataByToken = new Map(
    (await readDualRpcTokenMetadata({
      providers: input.providers,
      tokens: launchTokens.map((token) => ({
        token,
        blockNumber: block.block.number,
        blockHash: block.block.hash,
      })),
    })).map((metadata) => [
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
    providerHeads: block.providerHeads,
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
  return Object.freeze({
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
    confirmations: block.confirmations,
    evidenceCommitment,
    observedAt,
    events: Object.freeze(events),
  });
}

function validatePersistenceBundle(
  bundle: OptimisticPersistenceBundle,
): OptimisticPersistenceBundle {
  if (
    bundle.chainId !== 1 ||
    !Array.isArray(bundle.events) ||
    bundle.events.length > MAXIMUM_PERSISTED_EVENTS_PER_BLOCK ||
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
        });
      });
    },
  });
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
  const bundle = await verifyOptimisticBlockForPersistence({
    providers: input.providers,
    providerDeployments: input.providerDeployments,
    hint: input.hint,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    ...(input.hardDeadlineMs === undefined
      ? {}
      : { hardDeadlineMs: input.hardDeadlineMs }),
  });
  const persisted = await input.writer.persist(bundle);
  if (persisted.optimisticBlockId !== bundle.optimisticBlockId) {
    throw validationError("postgres", "optimistic-persisted-block-id");
  }
  return Object.freeze({ bundle, persisted });
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

export function createOptimisticLiveReader(input: {
  executor: PostgresExecutor;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  return Object.freeze({
    async snapshot(chainId: 1 = 1): Promise<OptimisticLiveSnapshot> {
      if (chainId !== 1) throw invalidInput("postgres", "optimistic-chain-id");
      try {
        return await input.executor.transaction(async (transaction) => {
          await transaction.query("set transaction isolation level repeatable read, read only");
          await establishPostgresApiReaderRole(transaction);
          await transaction.query("set local statement_timeout = '1000ms'");
          await transaction.query("set local lock_timeout = '250ms'");
          await transaction.query("set local idle_in_transaction_session_timeout = '2000ms'");
          const head = parseHead(
            await transaction.query<Record<string, unknown>>(
              "select * from programmable_private.get_optimistic_live_head_v1($1::bigint)",
              [String(chainId)],
            ),
          );
          if (!head) return Object.freeze({ head: null, events: Object.freeze([]) });
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
            return Object.freeze({ head: null, events: Object.freeze([]) });
          }
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
          return Object.freeze({ head, events: Object.freeze(events) });
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

export function optimisticOverlayRowsFromSnapshot(input: Readonly<{
  snapshot: OptimisticLiveSnapshot;
  canonicalTokens: readonly LauncherToken[];
  marketStates?: readonly OptimisticMarketStateEvidence[];
  providerDeployments?: readonly [
    OptimisticProviderDeploymentBinding,
    OptimisticProviderDeploymentBinding,
  ];
}>): readonly OptimisticOverlayRow[] {
  if (!input.snapshot.head) return Object.freeze([]);
  const rows: OptimisticOverlayRow[] = [];
  const launchEvents = input.snapshot.events.filter(releaseForLaunchEvent);
  for (const launchEvent of launchEvents) {
    const release = releaseForLaunchEvent(launchEvent)!;
    const transactionEvents = input.snapshot.events.filter(
      (event) =>
        event.transactionHash === launchEvent.transactionHash &&
        event.blockHash === launchEvent.blockHash &&
        release.sourceContracts.includes(event.normalizedPayload.sourceContractName),
    );
    const metadata = launchEvent.normalizedPayload.tokenMetadata;
    if (
      !metadata ||
      metadata.blockHash !== launchEvent.blockHash ||
      transactionEvents.length === 0
    ) {
      continue;
    }
    try {
      const folded = foldProjectorEvents({
        events: transactionEvents.map((event, index) =>
          foldEvent(event, release, input.snapshot, metadata, index)),
        tokenMetadata: {
          [canonicalAddress(launchEvent.normalizedPayload.arguments.token)]: {
            name: metadata.name,
            symbol: metadata.symbol,
          },
        },
      });
      const completed = folded.launches.find(
        (launch) => launch.launchTransactionHash === launchEvent.transactionHash,
      );
      const evidence = evidenceFor(input.snapshot, launchEvent);
      if (!completed || !evidence) continue;
      const token = launchToken(completed, launchEvent);
      rows.push(Object.freeze({
        kind: "launch" as const,
        evidence,
        event: Object.freeze({
          transactionHash: launchEvent.transactionHash,
          logIndex: launchEvent.blockGlobalLogIndex,
        }),
        poolId: completed.poolId,
        tokenAddress: completed.token,
        token,
      }));
    } catch {
      // A partial launch transaction must never become a public optimistic row.
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
  for (const state of input.marketStates ?? []) {
    const providerBindings = input.providerDeployments;
    const event = [...input.snapshot.events]
      .reverse()
      .find((candidate) => {
        const payload = candidate.normalizedPayload;
        return (
          candidate.blockNumber === state.blockNumber &&
          candidate.blockHash === canonicalBytes32(state.blockHash) &&
          ["NativeSwapFeesAccrued", "QuoteSwapFeesAccrued"].includes(payload.eventName) &&
          canonicalBytes32(payload.arguments.poolId) === canonicalBytes32(state.poolId)
        );
      });
    if (!event || state.chainId !== 1 || state.confirmations < 0 || state.confirmations > 11) {
      continue;
    }
    const expectedToken = tokensByPool.get(state.poolId.toLowerCase());
    const evidence = evidenceFor(input.snapshot, event);
    if (
      !expectedToken ||
      !providerBindings ||
      input.snapshot.head.providerDeploymentIds[0] !==
        providerBindings[0].providerDeploymentId ||
      input.snapshot.head.providerDeploymentIds[1] !==
        providerBindings[1].providerDeploymentId ||
      state.providerIdentities[0] !== providerBindings[0].providerIdentity ||
      state.providerIdentities[1] !== providerBindings[1].providerIdentity ||
      state.providerVendorGroups[0] !== "alchemy" ||
      state.providerVendorGroups[1] !== "quicknode" ||
      state.providerEndpointCommitments[0] !==
        canonicalBytes32(providerBindings[0].endpointCommitment) ||
      state.providerEndpointCommitments[1] !==
        canonicalBytes32(providerBindings[1].endpointCommitment) ||
      state.providerOriginCommitments[0] !==
        canonicalBytes32(providerBindings[0].originCommitment) ||
      state.providerOriginCommitments[1] !==
        canonicalBytes32(providerBindings[1].originCommitment) ||
      expectedToken !== canonicalAddress(state.tokenAddress) ||
      !evidence ||
      evidence.confirmations !== state.confirmations ||
      state.market.indexedValuationBlockNumber !== state.blockNumber ||
      state.providerHeads[0] !== input.snapshot.head.providerHeads[0] ||
      state.providerHeads[1] !== input.snapshot.head.providerHeads[1]
    ) {
      continue;
    }
    rows.push(Object.freeze({
      kind: "market" as const,
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
  marketStates?: readonly OptimisticMarketStateEvidence[];
  providerDeployments?: readonly [
    OptimisticProviderDeploymentBinding,
    OptimisticProviderDeploymentBinding,
  ];
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
