import "server-only";

import { randomUUID } from "node:crypto";

import { keccak256, toBytes } from "viem";

import {
  canonicalizeFingerprintJson,
  type CanonicalJsonValue,
} from "./canonical-fingerprint";
import {
  canonicalBytes32,
  parseNonnegativeIntegerText,
  type HexBytes32,
} from "./codecs";
import type { CandidateRpcProvider } from "./dual-rpc";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
  type DataPipelineDependency,
} from "./errors";
import { assertProductionDualRpcProviders } from "./rpc-providers.server";

export const RECONCILER_ROUTE_KEYS = Object.freeze([
  "explore-list",
  "explore-token",
  "explore-chart",
  "creator-profile",
  "classic-v3-profile",
  "launch-lookup",
] as const);

export type ReconcilerRouteKey = (typeof RECONCILER_ROUTE_KEYS)[number];

export const CLASSIC_V2_RECONCILER_ROUTE_KEYS = Object.freeze([
  "explore-list",
  "explore-token",
  "explore-chart",
  "creator-profile",
] as const satisfies readonly ReconcilerRouteKey[]);

export const CLASSIC_V3_RECONCILER_ROUTE_KEYS = RECONCILER_ROUTE_KEYS;

export const STOCK_PAIRED_RECONCILER_ROUTE_KEYS = Object.freeze([
  "explore-list",
  "explore-token",
  "explore-chart",
  "creator-profile",
  "launch-lookup",
] as const satisfies readonly ReconcilerRouteKey[]);

export function reconcilerRouteKeysForScope(
  releaseId: string,
  modelId: string,
): readonly ReconcilerRouteKey[] {
  if (releaseId === "classic-v2" && modelId === "classic") {
    return CLASSIC_V2_RECONCILER_ROUTE_KEYS;
  }
  if (releaseId === "classic-v3" && modelId === "classic") {
    return CLASSIC_V3_RECONCILER_ROUTE_KEYS;
  }
  if (
    modelId === "stock-paired" &&
    (releaseId === "stock-paired-v1" ||
      releaseId === "stock-paired-v2" ||
      releaseId === "stock-paired-v3")
  ) {
    return STOCK_PAIRED_RECONCILER_ROUTE_KEYS;
  }
  throw invalidInput("config", "reconciler-release-model");
}

export type ReconcilerCheckpointRequest = Readonly<{
  chainId: "1";
  releaseId: string;
  modelId: string;
  sourceGroup: string;
  epochId: string;
  pointerGeneration: string;
  checkpointId: string;
  checkpointBlockNumber: string;
  checkpointBlockHash: HexBytes32;
  maximumEntityCount: number;
}>;

export type ReconcilerPreParityContract = Readonly<{
  chainId: "1";
  releaseId: string;
  modelId: string;
  sourceGroup: string;
  projectorVersion: string;
  epochId: string;
  pointerGeneration: string;
  checkpointId: string;
  checkpointGeneration: string;
  reorgGeneration: string;
  checkpointBlockNumber: string;
  checkpointBlockHash: HexBytes32;
  routeKeys: readonly ReconcilerRouteKey[];
  routeContract: CanonicalJsonValue;
  projectionContract: CanonicalJsonValue;
  currentEntities: CanonicalJsonValue;
}>;

export type ReconcilerRouteDto = Readonly<{
  routeKey: ReconcilerRouteKey;
  comparedCount: number;
  dto: CanonicalJsonValue;
}>;

export type ReconcilerLiveSource = Readonly<{
  identity: string;
  vendorGroup: string;
  endpointCommitment: HexBytes32;
  endpointOriginCommitment: HexBytes32;
}>;

export type ReconcilerRouteDtoReader = Readonly<{
  readLiveRoutes(input: {
    source: ReconcilerLiveSource;
    contract: ReconcilerPreParityContract;
    blockNumber: bigint;
    blockHash: HexBytes32;
    signal: AbortSignal;
  }): Promise<readonly ReconcilerRouteDto[]>;
  readIndexedRoutes(input: {
    contract: ReconcilerPreParityContract;
    signal: AbortSignal;
  }): Promise<readonly ReconcilerRouteDto[]>;
}>;

export type ReconcilerIndexedRouteStore = Readonly<{
  readExactIndexedRouteCorpus(input: {
    contract: ReconcilerPreParityContract;
    maximumEntityCount: number;
    signal: AbortSignal;
  }): Promise<readonly ReconcilerRouteDto[]>;
}>;

export type ReconcilerCommitInput = Readonly<{
  runId: string;
  reconciliationId: string;
  parityRecordIds: readonly string[];
  parityBindingIds: readonly string[];
  outcomeId: string;
  contract: ReconcilerPreParityContract;
  workerVersion: string;
  routeKeys: readonly ReconcilerRouteKey[];
  legacyDtoHashes: readonly HexBytes32[];
  indexedDtoHashes: readonly HexBytes32[];
  routeEvidenceCommitments: readonly HexBytes32[];
  parityBindingCommitments: readonly HexBytes32[];
  requestCommitment: HexBytes32;
  reconciliationEvidenceCommitment: HexBytes32;
  resultCommitment: HexBytes32;
  startedAt: string;
  comparedAt: string;
  finishedAt: string;
}>;

export type ReconcilerCommitResult = Readonly<{
  runId: string;
  reconciliationId: string;
  checkpointId: string;
  checkpointBlockNumber: string;
  checkpointBlockHash: HexBytes32;
  routeCount: number;
  mismatchCount: number;
  status: "succeeded" | "failed";
}>;

export type ReconcilerPreParityStore = Readonly<{
  readExactContract(
    request: ReconcilerCheckpointRequest,
  ): Promise<ReconcilerPreParityContract>;
  commitResult(input: ReconcilerCommitInput): Promise<ReconcilerCommitResult>;
}>;

const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PROVIDER_IDENTITY_PATTERN = /^[a-z0-9][a-z0-9-]{0,95}$/u;
const MAXIMUM_ENTITY_COUNT = 10_000;
const MAXIMUM_ROUTE_DTO_BYTES = 512 * 1024;
const MAXIMUM_ALL_ROUTE_DTO_BYTES = 4 * 1024 * 1024;
const MAXIMUM_JSON_NODES = 100_000;
const MAXIMUM_JSON_DEPTH = 64;
const MAXIMUM_COMPARED_COUNT = 1_000_000;
const MAXIMUM_DEADLINE_MS = 85_000;
const MINIMUM_DEADLINE_MS = 100;
const WORKER_VERSION_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;

function canonicalIdentifier(
  value: unknown,
  operation: string,
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 96 ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw invalidInput("config", operation);
  }
  return value;
}

function canonicalUuid(value: unknown, operation: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw invalidInput("config", operation);
  }
  return value;
}

function canonicalPositiveIntegerText(
  value: unknown,
  operation: string,
): string {
  let parsed: string;
  try {
    parsed = parseNonnegativeIntegerText(value, 19);
  } catch {
    throw invalidInput("config", operation);
  }
  if (parsed === "0" || BigInt(parsed) > 9_223_372_036_854_775_807n) {
    throw invalidInput("config", operation);
  }
  return parsed;
}

function canonicalNonnegativeIntegerText(
  value: unknown,
  operation: string,
): string {
  let parsed: string;
  try {
    parsed = parseNonnegativeIntegerText(value, 19);
  } catch {
    throw invalidInput("config", operation);
  }
  if (BigInt(parsed) > 9_223_372_036_854_775_807n) {
    throw invalidInput("config", operation);
  }
  return parsed;
}

function canonicalBlockNumber(value: unknown): string {
  let parsed: string;
  try {
    parsed = parseNonnegativeIntegerText(value, 19);
  } catch {
    throw invalidInput("config", "checkpoint-block-number");
  }
  if (BigInt(parsed) > 9_223_372_036_854_775_807n) {
    throw invalidInput("config", "checkpoint-block-number");
  }
  return parsed;
}

export function canonicalReconcilerCheckpointRequest(
  value: unknown,
): ReconcilerCheckpointRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput("config", "reconciler-checkpoint-request");
  }
  const input = value as Record<string, unknown>;
  const exactKeys = [
    "chainId",
    "releaseId",
    "modelId",
    "sourceGroup",
    "epochId",
    "pointerGeneration",
    "checkpointId",
    "checkpointBlockNumber",
    "checkpointBlockHash",
    "maximumEntityCount",
  ].sort();
  if (Object.keys(input).sort().join("\0") !== exactKeys.join("\0")) {
    throw invalidInput("config", "reconciler-checkpoint-request-fields");
  }
  if (input.chainId !== "1") {
    throw invalidInput("config", "chain-id");
  }
  if (
    typeof input.maximumEntityCount !== "number" ||
    !Number.isSafeInteger(input.maximumEntityCount) ||
    input.maximumEntityCount < 1 ||
    input.maximumEntityCount > MAXIMUM_ENTITY_COUNT
  ) {
    throw invalidInput("config", "maximum-entity-count");
  }
  const releaseId = canonicalIdentifier(input.releaseId, "release-id");
  const modelId = canonicalIdentifier(input.modelId, "model-id");
  reconcilerRouteKeysForScope(releaseId, modelId);
  return Object.freeze({
    chainId: "1",
    releaseId,
    modelId,
    sourceGroup: canonicalIdentifier(input.sourceGroup, "source-group"),
    epochId: canonicalUuid(input.epochId, "epoch-id"),
    pointerGeneration: canonicalPositiveIntegerText(
      input.pointerGeneration,
      "pointer-generation",
    ),
    checkpointId: canonicalUuid(input.checkpointId, "checkpoint-id"),
    checkpointBlockNumber: canonicalBlockNumber(
      input.checkpointBlockNumber,
    ),
    checkpointBlockHash: canonicalBytes32(input.checkpointBlockHash),
    maximumEntityCount: input.maximumEntityCount,
  });
}

function jsonValue(
  value: unknown,
  dependency: DataPipelineDependency,
  operation: string,
  state = { nodes: 0 },
  depth = 0,
): CanonicalJsonValue {
  state.nodes += 1;
  if (state.nodes > MAXIMUM_JSON_NODES || depth > MAXIMUM_JSON_DEPTH) {
    throw validationError(dependency, operation);
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (typeof value === "string" && value.length > MAXIMUM_ROUTE_DTO_BYTES) {
      throw validationError(dependency, operation);
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw validationError(dependency, operation);
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAXIMUM_JSON_NODES) {
      throw validationError(dependency, operation);
    }
    return value.map((entry) =>
      jsonValue(entry, dependency, operation, state, depth + 1),
    );
  }
  if (typeof value !== "object") {
    throw validationError(dependency, operation);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw validationError(dependency, operation);
  }
  const output: Record<string, CanonicalJsonValue> = Object.create(null);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAXIMUM_JSON_NODES) {
    throw validationError(dependency, operation);
  }
  for (const [key, entry] of entries) {
    if (key.length > 256) throw validationError(dependency, operation);
    output[key] = jsonValue(
      entry,
      dependency,
      operation,
      state,
      depth + 1,
    );
  }
  return output;
}

function canonicalJsonDocument(
  value: unknown,
  dependency: DataPipelineDependency,
  operation: string,
  maximumBytes: number,
): { value: CanonicalJsonValue; encoded: string; bytes: number } {
  const canonical = jsonValue(value, dependency, operation);
  let encoded: string;
  try {
    encoded = canonicalizeFingerprintJson(canonical);
  } catch {
    throw validationError(dependency, operation);
  }
  const bytes = Buffer.byteLength(encoded, "utf8");
  if (bytes > maximumBytes) {
    throw dataPipelineError({
      dependency,
      code: "response_oversize",
      retryable: false,
      countsTowardCircuit: false,
      metadata: { operation, limit: maximumBytes },
    });
  }
  return { value: canonical, encoded, bytes };
}

function routeKeys(
  value: unknown,
  releaseId: string,
  modelId: string,
): readonly ReconcilerRouteKey[] {
  const expected = reconcilerRouteKeysForScope(releaseId, modelId);
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    value.some((routeKey, index) => routeKey !== expected[index])
  ) {
    throw validationError("postgres", "reconciler-route-contract");
  }
  return expected;
}

export function canonicalReconcilerPreParityContract(
  value: unknown,
): ReconcilerPreParityContract {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("postgres", "reconciler-contract");
  }
  const input = value as Record<string, unknown>;
  if (input.chainId !== "1") {
    throw validationError("postgres", "reconciler-contract-chain");
  }
  const routeContract = canonicalJsonDocument(
    input.routeContract,
    "postgres",
    "reconciler-route-contract",
    MAXIMUM_ROUTE_DTO_BYTES,
  ).value;
  const projectionContract = canonicalJsonDocument(
    input.projectionContract,
    "postgres",
    "reconciler-projection-contract",
    MAXIMUM_ROUTE_DTO_BYTES,
  ).value;
  const currentEntities = canonicalJsonDocument(
    input.currentEntities,
    "postgres",
    "reconciler-current-entities",
    2 * 1024 * 1024,
  ).value;
  const releaseId = canonicalIdentifier(input.releaseId, "release-id");
  const modelId = canonicalIdentifier(input.modelId, "model-id");
  return Object.freeze({
    chainId: "1",
    releaseId,
    modelId,
    sourceGroup: canonicalIdentifier(input.sourceGroup, "source-group"),
    projectorVersion: canonicalIdentifier(
      input.projectorVersion,
      "projector-version",
    ),
    epochId: canonicalUuid(input.epochId, "epoch-id"),
    pointerGeneration: canonicalPositiveIntegerText(
      input.pointerGeneration,
      "pointer-generation",
    ),
    checkpointId: canonicalUuid(input.checkpointId, "checkpoint-id"),
    checkpointGeneration: canonicalPositiveIntegerText(
      input.checkpointGeneration,
      "checkpoint-generation",
    ),
    reorgGeneration: canonicalNonnegativeIntegerText(
      input.reorgGeneration,
      "reorg-generation",
    ),
    checkpointBlockNumber: canonicalBlockNumber(
      input.checkpointBlockNumber,
    ),
    checkpointBlockHash: canonicalBytes32(input.checkpointBlockHash),
    routeKeys: routeKeys(input.routeKeys, releaseId, modelId),
    routeContract,
    projectionContract,
    currentEntities,
  });
}

function assertContractMatchesRequest(
  contract: ReconcilerPreParityContract,
  request: ReconcilerCheckpointRequest,
): void {
  if (
    contract.chainId !== request.chainId ||
    contract.releaseId !== request.releaseId ||
    contract.modelId !== request.modelId ||
    contract.sourceGroup !== request.sourceGroup ||
    contract.epochId !== request.epochId ||
    contract.pointerGeneration !== request.pointerGeneration ||
    contract.checkpointId !== request.checkpointId ||
    contract.checkpointBlockNumber !== request.checkpointBlockNumber ||
    contract.checkpointBlockHash !== request.checkpointBlockHash
  ) {
    throw validationError("postgres", "reconciler-contract-scope");
  }
}

function canonicalProviderPair(
  providers: readonly CandidateRpcProvider[],
): readonly [CandidateRpcProvider, CandidateRpcProvider] {
  assertProductionDualRpcProviders(providers);
  if (providers.length !== 2) {
    throw invalidInput("rpc", "reconciler-provider-count");
  }
  const pair = providers as readonly [CandidateRpcProvider, CandidateRpcProvider];
  const identities = new Set<string>();
  const vendors = new Set<string>();
  const endpoints = new Set<string>();
  const origins = new Set<string>();
  for (const provider of pair) {
    if (
      provider === null ||
      typeof provider !== "object" ||
      !PROVIDER_IDENTITY_PATTERN.test(provider.identity) ||
      !IDENTIFIER_PATTERN.test(provider.vendorGroup) ||
      typeof provider.client?.getChainId !== "function" ||
      typeof provider.client?.getBlock !== "function"
    ) {
      throw invalidInput("rpc", "reconciler-provider");
    }
    identities.add(provider.identity);
    vendors.add(provider.vendorGroup);
    endpoints.add(canonicalBytes32(provider.endpointCommitment));
    origins.add(canonicalBytes32(provider.endpointOriginCommitment));
  }
  if (
    identities.size !== 2 ||
    vendors.size !== 2 ||
    endpoints.size !== 2 ||
    origins.size !== 2
  ) {
    throw invalidInput("rpc", "reconciler-provider-independence");
  }
  return pair;
}

function liveSource(provider: CandidateRpcProvider): ReconcilerLiveSource {
  return Object.freeze({
    identity: provider.identity,
    vendorGroup: provider.vendorGroup,
    endpointCommitment: canonicalBytes32(provider.endpointCommitment),
    endpointOriginCommitment: canonicalBytes32(
      provider.endpointOriginCommitment,
    ),
  });
}

function dependencyUnavailable(
  dependency: DataPipelineDependency,
  operation: string,
): DataPipelineError {
  return dataPipelineError({
    dependency,
    code: "dependency_unavailable",
    retryable: true,
    countsTowardCircuit: true,
    metadata: { operation },
  });
}

async function exactProviderCheckpoint(input: {
  provider: CandidateRpcProvider;
  blockNumber: bigint;
  blockHash: HexBytes32;
}): Promise<bigint> {
  try {
    const [chainId, block] = await Promise.all([
      input.provider.client.getChainId(),
      input.provider.client.getBlock({ blockNumber: input.blockNumber }),
    ]);
    if (
      chainId !== 1 ||
      block.number !== input.blockNumber ||
      block.hash === null ||
      canonicalBytes32(block.hash) !== input.blockHash ||
      typeof block.timestamp !== "bigint" ||
      block.timestamp < 0n
    ) {
      throw validationError("rpc", "reconciler-exact-checkpoint");
    }
    return block.timestamp;
  } catch (error) {
    if (error instanceof DataPipelineError) throw error;
    throw dependencyUnavailable("rpc", "reconciler-exact-checkpoint");
  }
}

type CanonicalRouteDto = ReconcilerRouteDto & {
  encoded: string;
  bytes: number;
  hash: HexBytes32;
};

function commitment(domain: string, value: CanonicalJsonValue): HexBytes32 {
  return keccak256(
    toBytes(
      `programmable:reconciler:${domain}:v1\0${canonicalizeFingerprintJson(value)}`,
    ),
  ) as HexBytes32;
}

function canonicalRouteSet(input: {
  value: unknown;
  routeKeys: readonly ReconcilerRouteKey[];
  dependency: DataPipelineDependency;
  operation: string;
}): readonly CanonicalRouteDto[] {
  if (!Array.isArray(input.value) || input.value.length !== input.routeKeys.length) {
    throw validationError(input.dependency, input.operation);
  }
  const byKey = new Map<ReconcilerRouteKey, CanonicalRouteDto>();
  let totalBytes = 0;
  for (const raw of input.value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw validationError(input.dependency, input.operation);
    }
    const item = raw as Record<string, unknown>;
    if (
      typeof item.routeKey !== "string" ||
      !input.routeKeys.includes(item.routeKey as ReconcilerRouteKey) ||
      typeof item.comparedCount !== "number" ||
      !Number.isSafeInteger(item.comparedCount) ||
      item.comparedCount < 1 ||
      item.comparedCount > MAXIMUM_COMPARED_COUNT ||
      byKey.has(item.routeKey as ReconcilerRouteKey)
    ) {
      throw validationError(input.dependency, input.operation);
    }
    const document = canonicalJsonDocument(
      item.dto,
      input.dependency,
      input.operation,
      MAXIMUM_ROUTE_DTO_BYTES,
    );
    totalBytes += document.bytes;
    if (totalBytes > MAXIMUM_ALL_ROUTE_DTO_BYTES) {
      throw dataPipelineError({
        dependency: input.dependency,
        code: "response_oversize",
        retryable: false,
        countsTowardCircuit: false,
        metadata: {
          operation: input.operation,
          limit: MAXIMUM_ALL_ROUTE_DTO_BYTES,
        },
      });
    }
    const routeKey = item.routeKey as ReconcilerRouteKey;
    const comparedCount = item.comparedCount;
    const hash = commitment("route-dto", {
      routeKey,
      comparedCount,
      dto: document.value,
    });
    byKey.set(routeKey, {
      routeKey,
      comparedCount,
      dto: document.value,
      encoded: document.encoded,
      bytes: document.bytes,
      hash,
    });
  }
  return input.routeKeys.map((key) => {
    const route = byKey.get(key);
    if (!route) throw validationError(input.dependency, input.operation);
    return route;
  });
}

function canonicalTimestamp(value: Date, operation: string): string {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) {
    throw invalidInput("config", operation);
  }
  return value.toISOString();
}

function monotonicTimestamps(now: () => Date) {
  const startedAt = canonicalTimestamp(now(), "reconciler-started-at");
  return {
    startedAt,
    comparedAt() {
      const value = canonicalTimestamp(now(), "reconciler-compared-at");
      if (value < startedAt) {
        throw invalidInput("config", "reconciler-clock");
      }
      return value;
    },
    finishedAt(comparedAt: string) {
      const value = canonicalTimestamp(now(), "reconciler-finished-at");
      if (value < comparedAt) {
        throw invalidInput("config", "reconciler-clock");
      }
      return value;
    },
  };
}

function uniqueUuids(
  uuidFactory: () => string,
  routeCount: number,
): {
  runId: string;
  reconciliationId: string;
  parityRecordIds: readonly string[];
  parityBindingIds: readonly string[];
  outcomeId: string;
} {
  const valueCount = 3 + routeCount * 2;
  const values = Array.from({ length: valueCount }, () =>
    canonicalUuid(uuidFactory(), "reconciler-generated-id"),
  );
  if (new Set(values).size !== values.length) {
    throw invalidInput("config", "reconciler-generated-id-collision");
  }
  return {
    runId: values[0]!,
    reconciliationId: values[1]!,
    parityRecordIds: values.slice(2, 2 + routeCount),
    parityBindingIds: values.slice(2 + routeCount, 2 + routeCount * 2),
    outcomeId: values[valueCount - 1]!,
  };
}

type Deadline = Readonly<{
  signal: AbortSignal;
  assertActive(): void;
  assertCommitWindow(): void;
}>;

async function withDeadline<T>(
  deadlineMs: number,
  work: (deadline: Deadline) => Promise<T>,
): Promise<T> {
  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < MINIMUM_DEADLINE_MS ||
    deadlineMs > MAXIMUM_DEADLINE_MS
  ) {
    throw invalidInput("config", "reconciler-deadline");
  }
  const controller = new AbortController();
  let expired = false;
  const expiresAt = Date.now() + deadlineMs;
  const commitReserveMs = Math.min(
    5_000,
    Math.max(20, Math.floor(deadlineMs / 5)),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
      reject(
        dataPipelineError({
          dependency: "rpc",
          code: "timeout",
          retryable: true,
          countsTowardCircuit: true,
          metadata: { operation: "reconciler-cycle" },
        }),
      );
    }, deadlineMs);
  });
  const deadline = Object.freeze({
    signal: controller.signal,
    assertActive() {
      if (expired || controller.signal.aborted) {
        throw dataPipelineError({
          dependency: "rpc",
          code: "timeout",
          retryable: true,
          countsTowardCircuit: true,
          metadata: { operation: "reconciler-cycle" },
        });
      }
    },
    assertCommitWindow() {
      if (
        expired ||
        controller.signal.aborted ||
        expiresAt - Date.now() < commitReserveMs
      ) {
        throw dataPipelineError({
          dependency: "rpc",
          code: "timeout",
          retryable: true,
          countsTowardCircuit: true,
          metadata: { operation: "reconciler-commit-window" },
        });
      }
    },
  });
  try {
    return await Promise.race([work(deadline), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runReconcilerPreParityCycle(input: {
  request: ReconcilerCheckpointRequest;
  store: ReconcilerPreParityStore;
  providers: readonly CandidateRpcProvider[];
  routeDtoReader: ReconcilerRouteDtoReader;
  workerVersion?: string;
  deadlineMs?: number;
  now?: () => Date;
  uuidFactory?: () => string;
}): Promise<ReconcilerCommitResult> {
  const request = canonicalReconcilerCheckpointRequest(input.request);
  const providers = canonicalProviderPair(input.providers);
  const workerVersion = canonicalIdentifier(
    input.workerVersion ?? "reconciler-preparity-v1",
    "reconciler-worker-version",
  );
  if (!WORKER_VERSION_PATTERN.test(workerVersion)) {
    throw invalidInput("config", "reconciler-worker-version");
  }
  if (
    !input.store ||
    typeof input.store.readExactContract !== "function" ||
    typeof input.store.commitResult !== "function" ||
    !input.routeDtoReader ||
    typeof input.routeDtoReader.readLiveRoutes !== "function" ||
    typeof input.routeDtoReader.readIndexedRoutes !== "function"
  ) {
    throw invalidInput("config", "reconciler-runtime-dependencies");
  }
  const now = input.now ?? (() => new Date());
  const timestamps = monotonicTimestamps(now);

  return withDeadline(input.deadlineMs ?? 75_000, async (deadline) => {
    const contract = canonicalReconcilerPreParityContract(
      await input.store.readExactContract(request),
    );
    deadline.assertActive();
    assertContractMatchesRequest(contract, request);

    const blockNumber = BigInt(contract.checkpointBlockNumber);
    const [firstTimestamp, secondTimestamp] = await Promise.all(
      providers.map((provider) =>
        exactProviderCheckpoint({
          provider,
          blockNumber,
          blockHash: contract.checkpointBlockHash,
        }),
      ),
    );
    deadline.assertActive();
    if (firstTimestamp !== secondTimestamp) {
      throw validationError("rpc", "reconciler-block-timestamp-consensus");
    }

    let firstLiveRaw: readonly ReconcilerRouteDto[];
    let secondLiveRaw: readonly ReconcilerRouteDto[];
    let indexedRaw: readonly ReconcilerRouteDto[];
    try {
      [firstLiveRaw, secondLiveRaw, indexedRaw] = await Promise.all([
        input.routeDtoReader.readLiveRoutes({
          source: liveSource(providers[0]),
          contract,
          blockNumber,
          blockHash: contract.checkpointBlockHash,
          signal: deadline.signal,
        }),
        input.routeDtoReader.readLiveRoutes({
          source: liveSource(providers[1]),
          contract,
          blockNumber,
          blockHash: contract.checkpointBlockHash,
          signal: deadline.signal,
        }),
        input.routeDtoReader.readIndexedRoutes({
          contract,
          signal: deadline.signal,
        }),
      ]);
    } catch (error) {
      if (error instanceof DataPipelineError) throw error;
      throw dependencyUnavailable("uniswap", "reconciler-route-dto-read");
    }
    deadline.assertActive();

    const firstLive = canonicalRouteSet({
      value: firstLiveRaw,
      routeKeys: contract.routeKeys,
      dependency: "rpc",
      operation: "reconciler-live-route-a",
    });
    const secondLive = canonicalRouteSet({
      value: secondLiveRaw,
      routeKeys: contract.routeKeys,
      dependency: "rpc",
      operation: "reconciler-live-route-b",
    });
    const indexed = canonicalRouteSet({
      value: indexedRaw,
      routeKeys: contract.routeKeys,
      dependency: "postgres",
      operation: "reconciler-indexed-route",
    });

    for (let index = 0; index < contract.routeKeys.length; index += 1) {
      if (
        firstLive[index]!.hash !== secondLive[index]!.hash ||
        firstLive[index]!.comparedCount !== secondLive[index]!.comparedCount ||
        firstLive[index]!.comparedCount !== indexed[index]!.comparedCount
      ) {
        throw validationError("rpc", "reconciler-provider-route-consensus");
      }
    }

    const routeEvidenceCommitments = contract.routeKeys.map(
      (routeKey, index) =>
        commitment("route-evidence", {
          routeKey,
          chainId: contract.chainId,
          checkpointId: contract.checkpointId,
          checkpointBlockNumber: contract.checkpointBlockNumber,
          checkpointBlockHash: contract.checkpointBlockHash,
          comparedCount: firstLive[index]!.comparedCount,
          liveDtoHash: firstLive[index]!.hash,
          indexedDtoHash: indexed[index]!.hash,
          providers: providers.map((provider) => liveSource(provider)),
        }),
    );
    const parityBindingCommitments = contract.routeKeys.map(
      (routeKey, index) =>
        commitment("parity-binding", {
          routeKey,
          checkpointId: contract.checkpointId,
          checkpointGeneration: contract.checkpointGeneration,
          reorgGeneration: contract.reorgGeneration,
          checkpointBlockNumber: contract.checkpointBlockNumber,
          checkpointBlockHash: contract.checkpointBlockHash,
          routeEvidenceCommitment: routeEvidenceCommitments[index]!,
        }),
    );
    const requestCommitment = commitment("request", {
      request,
      projectorVersion: contract.projectorVersion,
      checkpointGeneration: contract.checkpointGeneration,
      reorgGeneration: contract.reorgGeneration,
      routeContract: contract.routeContract,
      projectionContract: contract.projectionContract,
      currentEntities: contract.currentEntities,
    });
    const reconciliationEvidenceCommitment = commitment(
      "reconciliation-evidence",
      {
        requestCommitment,
        checkpointId: contract.checkpointId,
        checkpointBlockNumber: contract.checkpointBlockNumber,
        checkpointBlockHash: contract.checkpointBlockHash,
        providers: providers.map((provider) => liveSource(provider)),
        routeEvidenceCommitments,
      },
    );
    const mismatchRoutes = contract.routeKeys.filter(
      (_, index) => firstLive[index]!.hash !== indexed[index]!.hash,
    );
    const resultCommitment = commitment("result", {
      requestCommitment,
      reconciliationEvidenceCommitment,
      routeKeys: [...contract.routeKeys],
      legacyDtoHashes: firstLive.map((route) => route.hash),
      indexedDtoHashes: indexed.map((route) => route.hash),
      routeEvidenceCommitments,
      parityBindingCommitments,
      mismatchRoutes,
      status: mismatchRoutes.length === 0 ? "succeeded" : "failed",
    });
    const comparedAt = timestamps.comparedAt();
    const finishedAt = timestamps.finishedAt(comparedAt);
    const ids = uniqueUuids(
      input.uuidFactory ?? randomUUID,
      contract.routeKeys.length,
    );

    deadline.assertCommitWindow();
    const result = await input.store.commitResult({
      ...ids,
      contract,
      workerVersion,
      routeKeys: contract.routeKeys,
      legacyDtoHashes: firstLive.map((route) => route.hash),
      indexedDtoHashes: indexed.map((route) => route.hash),
      routeEvidenceCommitments,
      parityBindingCommitments,
      requestCommitment,
      reconciliationEvidenceCommitment,
      resultCommitment,
      startedAt: timestamps.startedAt,
      comparedAt,
      finishedAt,
    });
    deadline.assertActive();

    if (
      result.runId !== ids.runId ||
      result.reconciliationId !== ids.reconciliationId ||
      result.checkpointId !== contract.checkpointId ||
      result.checkpointBlockNumber !== contract.checkpointBlockNumber ||
      result.checkpointBlockHash !== contract.checkpointBlockHash ||
      result.routeCount !== contract.routeKeys.length ||
      result.mismatchCount !== mismatchRoutes.length ||
      result.status !== (mismatchRoutes.length === 0 ? "succeeded" : "failed")
    ) {
      throw validationError("postgres", "reconciler-commit-result");
    }
    return Object.freeze(result);
  });
}
