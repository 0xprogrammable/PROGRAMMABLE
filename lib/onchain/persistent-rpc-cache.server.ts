import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  http,
  keccak256,
  type EIP1193RequestFn,
  type HttpTransportConfig,
  type Transport,
} from "viem";

const CACHE_SCHEMA = "programmable-rpc-log-cursor-v3";
const CACHE_DIRECTORY = "indexes/rpc-log-cursors/v3";
const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu;
const BYTES32 = /^0x[0-9a-f]{64}$/iu;
const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const PERSISTENT_RPC_CACHE_LIMITS = Object.freeze({
  maxCursorSegments: 8,
  maxSegmentBytes: 4 * 1024 * 1024,
  maxCursorBytes: 64 * 1024,
  maxRuntimeBytes: 256 * 1024,
  maxSegmentReadsPerOperation: 8,
});

type JsonRpcRequest = Parameters<EIP1193RequestFn>[0];
type JsonRpcRequestOptions = Parameters<EIP1193RequestFn>[1];
type JsonRpcResult = Awaited<ReturnType<EIP1193RequestFn>>;

export type PersistentRpcCacheRecord = Readonly<{
  etag: string;
  value: unknown;
}>;

export type PersistentRpcCacheStore = Readonly<{
  read(path: string): Promise<PersistentRpcCacheRecord | null>;
  create(path: string, value: unknown): Promise<"created" | "exists">;
  replace(
    path: string,
    value: unknown,
    expectedEtag: string,
  ): Promise<"replaced" | "conflict">;
}>;

type LogSegment = Readonly<{
  fromBlock: string;
  toBlock: string;
  blockHash: string;
  path: string;
  contentHash: string;
  byteLength: number;
}>;

type LogCursorPayload = Readonly<{
  chainId: number;
  providerId: string;
  streamId: string;
  startBlock: string;
  cursorBlock: string;
  cursorBlockHash: string;
  integrityCommitId?: string;
  segments: readonly LogSegment[];
}>;

type LogSegmentPayload = Readonly<{
  chainId: number;
  providerId: string;
  streamId: string;
  fromBlock: string;
  toBlock: string;
  blockHash: string;
  logs: readonly unknown[];
}>;

type CacheEnvelope = Readonly<{
  schemaVersion: typeof CACHE_SCHEMA;
  contentHash: string;
  payload: unknown;
}>;

type LogFilter = Record<string, unknown> & {
  fromBlock: string;
  toBlock: string;
};

type PersistentRequestInput = Readonly<{
  chainId: number;
  providerId: string;
  request: EIP1193RequestFn;
  store: PersistentRpcCacheStore | null;
  maxLogBlockRange?: bigint;
  immutableCodeBindings?: readonly ImmutableCodeBinding[];
}>;

export type ImmutableCodeBinding = Readonly<{
  address: `0x${string}`;
  expectedRuntimeCodeHash: `0x${string}`;
  notBeforeBlock: bigint;
}>;

type RuntimeCodePayload = Readonly<{
  chainId: number;
  providerId: string;
  address: string;
  expectedRuntimeCodeHash: string;
  notBeforeBlock: string;
  observedAtBlock: string;
  observedAtBlockHash: string;
  code: string;
}>;

export class PersistentRpcCacheError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PersistentRpcCacheError";
  }
}

export class PersistentRpcCacheReorgError extends PersistentRpcCacheError {
  constructor(message: string) {
    super(message);
    this.name = "PersistentRpcCacheReorgError";
  }
}

function fail(message: string): never {
  throw new PersistentRpcCacheError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function envelope(payload: unknown): CacheEnvelope {
  return {
    schemaVersion: CACHE_SCHEMA,
    contentHash: digest(payload),
    payload,
  };
}

function persistedByteLength(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function assertByteLimit(value: unknown, maximum: number, label: string) {
  const byteLength = persistedByteLength(value);
  if (byteLength > maximum) {
    fail(`Persistent RPC cache ${label} exceeds ${maximum} bytes`);
  }
  return byteLength;
}

function unwrapEnvelope(value: unknown) {
  if (
    !isRecord(value) ||
    value.schemaVersion !== CACHE_SCHEMA ||
    typeof value.contentHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.contentHash) ||
    digest(value.payload) !== value.contentHash
  ) {
    fail("Persistent RPC cache envelope is invalid");
  }
  return value.payload;
}

function quantity(value: unknown, label: string) {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) {
    fail(`Persistent RPC cache ${label} is invalid`);
  }
  return BigInt(value);
}

function quantityHex(value: bigint) {
  return `0x${value.toString(16)}`;
}

function requireBytes32(value: unknown, label: string) {
  if (typeof value !== "string" || !BYTES32.test(value)) {
    fail(`Persistent RPC cache ${label} is invalid`);
  }
  return value.toLowerCase();
}

function parseFilter(request: JsonRpcRequest): LogFilter | null {
  if (request.method !== "eth_getLogs" || !Array.isArray(request.params)) {
    return null;
  }
  const filter = request.params[0];
  if (
    !isRecord(filter) ||
    typeof filter.fromBlock !== "string" ||
    typeof filter.toBlock !== "string" ||
    !HEX_QUANTITY.test(filter.fromBlock) ||
    !HEX_QUANTITY.test(filter.toBlock)
  ) {
    return null;
  }
  if (BigInt(filter.fromBlock) > BigInt(filter.toBlock)) {
    fail("Persistent RPC cache log range is inverted");
  }
  return filter as LogFilter;
}

function normalizedStreamFilter(filter: LogFilter) {
  const stream: Record<string, unknown> = { ...filter };
  delete stream.fromBlock;
  delete stream.toBlock;
  return stream;
}

function streamId(input: PersistentRequestInput, filter: LogFilter) {
  return digest({
    schemaVersion: CACHE_SCHEMA,
    chainId: input.chainId,
    providerId: input.providerId,
    filter: normalizedStreamFilter(filter),
  });
}

function cursorPath(input: PersistentRequestInput, id: string) {
  return `${CACHE_DIRECTORY}/${input.chainId}/${input.providerId}/${id}/cursor.json`;
}

function integrityCommitPath(
  input: PersistentRequestInput,
  integrityCommitId: string,
) {
  return `${CACHE_DIRECTORY}/${input.chainId}/${input.providerId}/integrity/${integrityCommitId}.json`;
}

function segmentPath(
  input: PersistentRequestInput,
  id: string,
  fromBlock: bigint,
  toBlock: bigint,
  contentHash: string,
) {
  return `${CACHE_DIRECTORY}/${input.chainId}/${input.providerId}/${id}/segments/${fromBlock}-${toBlock}-${contentHash}.json`;
}

function runtimeCodePath(
  input: PersistentRequestInput,
  binding: ImmutableCodeBinding,
) {
  const runtimeProofVersion = "v2";
  const releaseBinding = digest({
    runtimeProofVersion,
    expectedRuntimeCodeHash: binding.expectedRuntimeCodeHash.toLowerCase(),
    notBeforeBlock: quantityHex(binding.notBeforeBlock),
  });
  return `${CACHE_DIRECTORY}/${input.chainId}/${input.providerId}/runtime-${runtimeProofVersion}/${binding.address.toLowerCase()}/${releaseBinding}.json`;
}

function parseCursor(
  value: unknown,
  input: PersistentRequestInput,
  id: string,
): LogCursorPayload {
  const payload = unwrapEnvelope(value);
  if (
    !isRecord(payload) ||
    payload.chainId !== input.chainId ||
    payload.providerId !== input.providerId ||
    payload.streamId !== id ||
    typeof payload.startBlock !== "string" ||
    typeof payload.cursorBlock !== "string" ||
    !HEX_QUANTITY.test(payload.startBlock) ||
    !HEX_QUANTITY.test(payload.cursorBlock) ||
    !BYTES32.test(String(payload.cursorBlockHash ?? "")) ||
    (payload.integrityCommitId !== undefined &&
      (typeof payload.integrityCommitId !== "string" ||
        !UUID.test(payload.integrityCommitId))) ||
    !Array.isArray(payload.segments) ||
    payload.segments.length === 0 ||
    payload.segments.length > PERSISTENT_RPC_CACHE_LIMITS.maxCursorSegments
  ) {
    fail("Persistent RPC log cursor is invalid");
  }

  let previousTo: bigint | null = null;
  const segments = payload.segments.map((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.fromBlock !== "string" ||
      typeof candidate.toBlock !== "string" ||
      !HEX_QUANTITY.test(candidate.fromBlock) ||
      !HEX_QUANTITY.test(candidate.toBlock) ||
      !BYTES32.test(String(candidate.blockHash ?? "")) ||
      typeof candidate.path !== "string" ||
      !candidate.path.startsWith(`${CACHE_DIRECTORY}/`) ||
      typeof candidate.contentHash !== "string" ||
      !/^[0-9a-f]{64}$/u.test(candidate.contentHash) ||
      typeof candidate.byteLength !== "number" ||
      !Number.isSafeInteger(candidate.byteLength) ||
      candidate.byteLength <= 0 ||
      candidate.byteLength > PERSISTENT_RPC_CACHE_LIMITS.maxSegmentBytes
    ) {
      fail("Persistent RPC log cursor segment is invalid");
    }
    const fromBlock = BigInt(candidate.fromBlock);
    const toBlock = BigInt(candidate.toBlock);
    if (
      toBlock < fromBlock ||
      (previousTo !== null && fromBlock <= previousTo)
    ) {
      fail("Persistent RPC log cursor segments overlap or are unordered");
    }
    previousTo = toBlock;
    return candidate as LogSegment;
  });
  const first = segments[0] as LogSegment;
  const last = segments.at(-1) as LogSegment;
  if (
    BigInt(payload.startBlock) !== BigInt(first.fromBlock) ||
    BigInt(payload.cursorBlock) !== BigInt(last.toBlock) ||
    String(payload.cursorBlockHash).toLowerCase() !==
      last.blockHash.toLowerCase()
  ) {
    fail("Persistent RPC log cursor boundary is invalid");
  }
  const cursor: LogCursorPayload = {
    chainId: input.chainId,
    providerId: input.providerId,
    streamId: id,
    startBlock: payload.startBlock,
    cursorBlock: payload.cursorBlock,
    cursorBlockHash: String(payload.cursorBlockHash).toLowerCase(),
    ...(typeof payload.integrityCommitId === "string"
      ? { integrityCommitId: payload.integrityCommitId }
      : {}),
    segments,
  };
  assertByteLimit(
    envelope(cursor),
    PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
    "cursor",
  );
  return cursor;
}

function allowedAddresses(filter: LogFilter) {
  const value = filter.address;
  const addresses = typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value
      : [];
  return new Set(
    addresses
      .filter((address): address is string =>
        typeof address === "string" && ADDRESS.test(address)
      )
      .map((address) => address.toLowerCase()),
  );
}

function logPosition(log: Record<string, unknown>) {
  return [
    quantity(log.blockNumber, "log block number"),
    quantity(log.transactionIndex, "transaction index"),
    quantity(log.logIndex, "log index"),
  ] as const;
}

function comparePosition(
  left: readonly [bigint, bigint, bigint],
  right: readonly [bigint, bigint, bigint],
) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function validateLogs(
  value: unknown,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
) {
  if (!Array.isArray(value)) fail("Persistent RPC log result is not an array");
  const addresses = allowedAddresses(filter);
  const identities = new Set<string>();
  let previousPosition: readonly [bigint, bigint, bigint] | null = null;
  for (const candidate of value) {
    if (!isRecord(candidate)) fail("Persistent RPC log is invalid");
    const position = logPosition(candidate);
    if (
      position[0] < fromBlock ||
      position[0] > toBlock ||
      candidate.removed === true ||
      !BYTES32.test(String(candidate.blockHash ?? "")) ||
      !BYTES32.test(String(candidate.transactionHash ?? "")) ||
      typeof candidate.address !== "string" ||
      !ADDRESS.test(candidate.address) ||
      (addresses.size > 0 && !addresses.has(candidate.address.toLowerCase())) ||
      !Array.isArray(candidate.topics) ||
      !candidate.topics.every(
        (topic) => typeof topic === "string" && BYTES32.test(topic),
      ) ||
      typeof candidate.data !== "string" ||
      !/^0x(?:[0-9a-f]{2})*$/iu.test(candidate.data)
    ) {
      fail("Persistent RPC log provenance is invalid");
    }
    if (previousPosition && comparePosition(previousPosition, position) > 0) {
      fail("Persistent RPC logs are not canonically ordered");
    }
    previousPosition = position;
    const identity = [
      String(candidate.blockHash).toLowerCase(),
      String(candidate.transactionHash).toLowerCase(),
      String(candidate.logIndex).toLowerCase(),
    ].join(":");
    if (identities.has(identity)) {
      fail("Persistent RPC logs contain duplicate provenance");
    }
    identities.add(identity);
  }
  return value as readonly unknown[];
}

function parseSegment(
  value: unknown,
  input: PersistentRequestInput,
  id: string,
  descriptor: LogSegment,
  filter: LogFilter,
) {
  if (persistedByteLength(value) !== descriptor.byteLength) {
    fail("Persistent RPC log segment byte length changed");
  }
  const payload = unwrapEnvelope(value);
  if (
    !isRecord(payload) ||
    payload.chainId !== input.chainId ||
    payload.providerId !== input.providerId ||
    payload.streamId !== id ||
    payload.fromBlock !== descriptor.fromBlock ||
    payload.toBlock !== descriptor.toBlock ||
    String(payload.blockHash ?? "").toLowerCase() !==
      descriptor.blockHash.toLowerCase() ||
    digest(payload) !== descriptor.contentHash
  ) {
    fail("Persistent RPC log segment binding is invalid");
  }
  return validateLogs(
    payload.logs,
    filter,
    BigInt(descriptor.fromBlock),
    BigInt(descriptor.toBlock),
  );
}

function blockHashFromResult(value: unknown, expectedBlock: bigint) {
  if (
    !isRecord(value) ||
    quantity(value.number, "block number") !== expectedBlock
  ) {
    fail("Persistent RPC cache received the wrong block");
  }
  return requireBytes32(value.hash, "block hash");
}

function blockRequest(blockNumber: bigint): JsonRpcRequest {
  return {
    method: "eth_getBlockByNumber",
    params: [quantityHex(blockNumber), false],
  } as JsonRpcRequest;
}

async function readBlockHash(
  request: EIP1193RequestFn,
  blockNumber: bigint,
  options?: JsonRpcRequestOptions,
) {
  return blockHashFromResult(
    await request(blockRequest(blockNumber), options),
    blockNumber,
  );
}

async function withStableBlockAnchor<T>(
  input: PersistentRequestInput,
  blockNumber: bigint,
  operation: () => Promise<T>,
  options?: JsonRpcRequestOptions,
) {
  const before = await readBlockHash(input.request, blockNumber, options);
  const value = await operation();
  const after = await readBlockHash(input.request, blockNumber, options);
  if (before !== after) {
    throw new PersistentRpcCacheReorgError(
      `Persistent RPC provider ${input.providerId} changed the canonical anchor during a read`,
    );
  }
  return { value, blockHash: after };
}

type BlockHashProof = Readonly<{
  blockNumber: bigint;
  blockHash: string;
}>;

type IntegrityScopeBinding = Readonly<{
  input: PersistentRequestInput;
  proof: BlockHashProof;
  options?: JsonRpcRequestOptions;
}>;

type IntegrityScope = {
  id: number;
  commitId: string;
  phase: "open" | "finalizing" | "closed";
  bindings: Map<string, IntegrityScopeBinding>;
  prechecks: Map<string, Promise<void>>;
  persistenceBindings: Array<
    Readonly<{
      input: PersistentRequestInput;
      store: PersistentRpcCacheStore;
      cursorDigests: Set<string>;
    }>
  >;
};

const integrityScopes = new AsyncLocalStorage<IntegrityScope>();
let nextIntegrityScopeId = 1;
const requestDomainIds = new WeakMap<object, number>();
let nextRequestDomainId = 1;

function requestDomainId(input: PersistentRequestInput) {
  let id = requestDomainIds.get(input);
  if (!id) {
    id = nextRequestDomainId;
    nextRequestDomainId += 1;
    requestDomainIds.set(input, id);
  }
  return id;
}

function integrityProofKey(input: PersistentRequestInput, blockNumber: bigint) {
  return `${requestDomainId(input)}:${input.chainId}:${input.providerId}:${blockNumber}`;
}

type IntegrityMarkerStatus = "pending" | "committed" | "aborted";

function integrityMarker(
  input: PersistentRequestInput,
  integrityCommitId: string,
  status: IntegrityMarkerStatus,
  cursorDigests: ReadonlySet<string>,
) {
  return envelope({
    chainId: input.chainId,
    providerId: input.providerId,
    integrityCommitId,
    status,
    cursorDigests: [...cursorDigests].sort(),
  });
}

function parseIntegrityMarker(
  value: unknown,
  input: PersistentRequestInput,
  integrityCommitId: string,
) {
  const payload = unwrapEnvelope(value);
  if (
    !isRecord(payload) ||
    payload.chainId !== input.chainId ||
    payload.providerId !== input.providerId ||
    payload.integrityCommitId !== integrityCommitId ||
    (payload.status !== "pending" &&
      payload.status !== "committed" &&
      payload.status !== "aborted") ||
    !Array.isArray(payload.cursorDigests) ||
    payload.cursorDigests.length === 0 ||
    payload.cursorDigests.length > 128 ||
    payload.cursorDigests.some(
      (candidate) =>
        typeof candidate !== "string" || !/^[0-9a-f]{64}$/u.test(candidate),
    ) ||
    new Set(payload.cursorDigests).size !== payload.cursorDigests.length
  ) {
    fail("Persistent RPC integrity commit is invalid");
  }
  return {
    status: payload.status,
    cursorDigests: new Set(payload.cursorDigests as string[]),
  };
}

async function transitionIntegrityMarker(
  input: PersistentRequestInput,
  store: PersistentRpcCacheStore,
  integrityCommitId: string,
  status: Exclude<IntegrityMarkerStatus, "pending">,
  cursorDigests: ReadonlySet<string>,
) {
  const path = integrityCommitPath(input, integrityCommitId);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await store.read(path);
    if (!record) {
      if (status === "aborted") return;
      fail("Persistent RPC pending integrity commit is missing");
    }
    const current = parseIntegrityMarker(
      record.value,
      input,
      integrityCommitId,
    );
    if (
      current.cursorDigests.size !== cursorDigests.size ||
      [...cursorDigests].some(
        (candidate) => !current.cursorDigests.has(candidate),
      )
    ) {
      fail("Persistent RPC integrity commit cursor set changed");
    }
    if (
      current.status === status ||
      (current.status === "aborted" && status === "aborted")
    ) {
      return;
    }
    if (current.status !== "pending" && status === "committed") {
      fail("Persistent RPC integrity commit cannot be promoted");
    }
    const marker = integrityMarker(
      input,
      integrityCommitId,
      status,
      cursorDigests,
    );
    assertByteLimit(
      marker,
      PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
      "integrity commit",
    );
    if (await store.replace(path, marker, record.etag) === "replaced") return;
  }
  fail("Persistent RPC integrity commit update conflicted repeatedly");
}

function logBlockProofs(logs: readonly unknown[]) {
  const proofs = new Map<bigint, string>();
  for (const candidate of logs) {
    if (!isRecord(candidate)) fail("Persistent RPC log is invalid");
    const blockNumber = quantity(candidate.blockNumber, "log block number");
    const blockHash = requireBytes32(candidate.blockHash, "log block hash");
    const existing = proofs.get(blockNumber);
    if (existing && existing !== blockHash) {
      fail("Persistent RPC logs disagree on a block hash");
    }
    proofs.set(blockNumber, blockHash);
  }
  return [...proofs].map(([blockNumber, blockHash]) => ({
    blockNumber,
    blockHash,
  }));
}

function mergeBlockProofs(proofs: readonly BlockHashProof[]) {
  const merged = new Map<bigint, string>();
  for (const proof of proofs) {
    const blockHash = requireBytes32(proof.blockHash, "block proof hash");
    const existing = merged.get(proof.blockNumber);
    if (existing && existing !== blockHash) {
      fail("Persistent RPC proofs disagree on a block hash");
    }
    merged.set(proof.blockNumber, blockHash);
  }
  return [...merged].map(([blockNumber, blockHash]) => ({
    blockNumber,
    blockHash,
  }));
}

async function assertCanonicalBlockProofs(
  input: PersistentRequestInput,
  proofs: readonly BlockHashProof[],
  options?: JsonRpcRequestOptions,
) {
  for (const proof of mergeBlockProofs(proofs)) {
    const canonical = await readBlockHash(
      input.request,
      proof.blockNumber,
      options,
    );
    if (canonical !== proof.blockHash) {
      throw new PersistentRpcCacheReorgError(
        `Persistent RPC provider ${input.providerId} returned a non-canonical log block`,
      );
    }
  }
}

async function registerScopedBlockProofs(
  input: PersistentRequestInput,
  proofs: readonly BlockHashProof[],
  validateNow: boolean,
  options?: JsonRpcRequestOptions,
) {
  const scope = integrityScopes.getStore();
  if (!scope) return false;
  if (scope.phase !== "open") {
    fail("Persistent RPC integrity scope is already sealed");
  }
  for (const proof of mergeBlockProofs(proofs)) {
    const key = integrityProofKey(input, proof.blockNumber);
    const existing = scope.bindings.get(key);
    if (
      existing &&
      existing.proof.blockHash.toLowerCase() !== proof.blockHash.toLowerCase()
    ) {
      fail("Persistent RPC integrity scope proofs disagree on a block hash");
    }
    if (!existing) scope.bindings.set(key, { input, proof, options });
    if (validateNow) {
      let precheck = scope.prechecks.get(key);
      if (!precheck) {
        precheck = assertCanonicalBlockProofs(input, [proof], options);
        scope.prechecks.set(key, precheck);
      }
      await precheck;
    }
  }
  return true;
}

export async function withPersistentRpcIntegrityScope<T>(
  operation: () => Promise<T>,
) {
  if (integrityScopes.getStore()) return operation();
  const scope: IntegrityScope = {
    id: nextIntegrityScopeId,
    commitId: randomUUID(),
    phase: "open",
    bindings: new Map(),
    prechecks: new Map(),
    persistenceBindings: [],
  };
  nextIntegrityScopeId += 1;
  return integrityScopes.run(scope, async () => {
    try {
      const result = await operation();
      scope.phase = "finalizing";
      const finalBindings = [...scope.bindings.entries()];
      const commitProofKeys = new Set<string>();
      for (const { input } of scope.persistenceBindings) {
        let commitProof: readonly [string, IntegrityScopeBinding] | null = null;
        for (const binding of finalBindings) {
          if (binding[1].input !== input) continue;
          if (
            !commitProof ||
            binding[1].proof.blockNumber > commitProof[1].proof.blockNumber
          ) {
            commitProof = binding;
          }
        }
        if (!commitProof) {
          fail("Persistent RPC integrity commit has no canonical proof");
        }
        commitProofKeys.add(commitProof[0]);
      }
      for (const [key, binding] of finalBindings) {
        if (commitProofKeys.has(key)) continue;
        await assertCanonicalBlockProofs(
          binding.input,
          [binding.proof],
          binding.options,
        );
      }
      try {
        for (const { input, store, cursorDigests } of scope.persistenceBindings) {
          const path = integrityCommitPath(input, scope.commitId);
          const marker = integrityMarker(
            input,
            scope.commitId,
            "pending",
            cursorDigests,
          );
          assertByteLimit(
            marker,
            PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
            "integrity commit",
          );
          const created = await store.create(path, marker);
          if (created !== "created") {
            const record = await store.read(path);
            if (
              !record ||
              parseIntegrityMarker(record.value, input, scope.commitId).status !==
                "pending"
            ) {
              fail("Persistent RPC integrity commit already exists");
            }
          }
        }
        for (const { input, store, cursorDigests } of scope.persistenceBindings) {
          await transitionIntegrityMarker(
            input,
            store,
            scope.commitId,
            "committed",
            cursorDigests,
          );
        }
        for (const [key, binding] of finalBindings) {
          if (!commitProofKeys.has(key)) continue;
          await assertCanonicalBlockProofs(
            binding.input,
            [binding.proof],
            binding.options,
          );
        }
      } catch (error) {
        for (const { input, store, cursorDigests } of scope.persistenceBindings) {
          await transitionIntegrityMarker(
            input,
            store,
            scope.commitId,
            "aborted",
            cursorDigests,
          );
        }
        throw error;
      }
      return result;
    } finally {
      scope.phase = "closed";
    }
  });
}

async function assertCanonicalRuntimeCode(
  input: PersistentRequestInput,
  request: JsonRpcRequest,
  blockNumber: bigint,
  expectedCode: string,
  expectedBlockHash: string,
  options?: JsonRpcRequestOptions,
) {
  const stable = await withStableBlockAnchor(
    input,
    blockNumber,
    () => input.request(request, options),
    options,
  );
  if (
    stable.blockHash !== expectedBlockHash.toLowerCase() ||
    stable.value !== expectedCode
  ) {
    throw new PersistentRpcCacheReorgError(
      `Persistent RPC provider ${input.providerId} changed the runtime proof during persistence`,
    );
  }
}

function immutableCodeBinding(
  input: PersistentRequestInput,
  request: JsonRpcRequest,
) {
  if (request.method !== "eth_getCode" || !Array.isArray(request.params)) {
    return null;
  }
  const address = request.params[0];
  const block = request.params[1];
  if (
    typeof address !== "string" ||
    !ADDRESS.test(address) ||
    typeof block !== "string" ||
    !HEX_QUANTITY.test(block)
  ) {
    return null;
  }
  const binding = input.immutableCodeBindings?.find(
    (candidate) => candidate.address.toLowerCase() === address.toLowerCase(),
  );
  if (!binding || BigInt(block) < binding.notBeforeBlock) return null;
  return { binding, blockNumber: BigInt(block) };
}

function parseRuntimeCode(
  value: unknown,
  input: PersistentRequestInput,
  binding: ImmutableCodeBinding,
) {
  assertByteLimit(
    value,
    PERSISTENT_RPC_CACHE_LIMITS.maxRuntimeBytes,
    "runtime proof",
  );
  const payload = unwrapEnvelope(value);
  if (
    !isRecord(payload) ||
    payload.chainId !== input.chainId ||
    payload.providerId !== input.providerId ||
    String(payload.address ?? "").toLowerCase() !==
      binding.address.toLowerCase() ||
    String(payload.expectedRuntimeCodeHash ?? "").toLowerCase() !==
      binding.expectedRuntimeCodeHash.toLowerCase() ||
    payload.notBeforeBlock !== quantityHex(binding.notBeforeBlock) ||
    typeof payload.observedAtBlock !== "string" ||
    !HEX_QUANTITY.test(payload.observedAtBlock) ||
    BigInt(payload.observedAtBlock) < binding.notBeforeBlock ||
    !BYTES32.test(String(payload.observedAtBlockHash ?? "")) ||
    typeof payload.code !== "string" ||
    !/^0x(?:[0-9a-f]{2})+$/iu.test(payload.code) ||
    keccak256(payload.code as `0x${string}`).toLowerCase() !==
      binding.expectedRuntimeCodeHash.toLowerCase()
  ) {
    fail("Persistent RPC runtime-code binding is invalid");
  }
  return payload as RuntimeCodePayload;
}

function requestWithRange(
  request: JsonRpcRequest,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
): JsonRpcRequest {
  return {
    ...request,
    params: [
      {
        ...filter,
        fromBlock: quantityHex(fromBlock),
        toBlock: quantityHex(toBlock),
      },
    ],
  } as JsonRpcRequest;
}

function* splitLogRange(
  fromBlock: bigint,
  toBlock: bigint,
  maximumRange: bigint | undefined,
) {
  if (maximumRange === undefined) {
    yield [fromBlock, toBlock] as const;
    return;
  }
  if (maximumRange <= 0n) {
    fail("Persistent RPC maximum log block range must be positive");
  }
  for (let start = fromBlock; start <= toBlock; start += maximumRange) {
    const end = start + maximumRange - 1n;
    yield [start, end < toBlock ? end : toBlock] as const;
  }
}

function logsInRequestedRange(
  logs: readonly unknown[],
  fromBlock: bigint,
  toBlock: bigint,
) {
  return logs.filter((candidate) => {
    if (!isRecord(candidate)) return false;
    const block = quantity(candidate.blockNumber, "log block number");
    return block >= fromBlock && block <= toBlock;
  });
}

async function loadCursor(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  acceptedIntegrityCommitId?: string,
) {
  const path = cursorPath(input, id);
  const record = await store.read(path);
  if (!record) return { path, etag: null, cursor: null };
  const cursor = parseCursor(record.value, input, id);
  if (
    cursor.integrityCommitId &&
    cursor.integrityCommitId !== acceptedIntegrityCommitId
  ) {
    const commit = await store.read(
      integrityCommitPath(input, cursor.integrityCommitId),
    );
    if (!commit) {
      return { path, etag: record.etag, cursor: null };
    }
    const marker = parseIntegrityMarker(
      commit.value,
      input,
      cursor.integrityCommitId,
    );
    if (
      marker.status !== "committed" ||
      !marker.cursorDigests.has(digest(record.value))
    ) {
      return { path, etag: record.etag, cursor: null };
    }
  }
  return { path, etag: record.etag, cursor };
}

async function assertCanonicalCursor(
  request: EIP1193RequestFn,
  cursor: LogCursorPayload,
  options?: JsonRpcRequestOptions,
) {
  const blockNumber = BigInt(cursor.cursorBlock);
  const block = await request(blockRequest(blockNumber), options);
  const hash = blockHashFromResult(block, blockNumber);
  if (hash !== cursor.cursorBlockHash.toLowerCase()) {
    throw new PersistentRpcCacheReorgError(
      "Persistent RPC log cursor is no longer canonical",
    );
  }
}

async function readCoveredLogs(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  cursor: LogCursorPayload,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
) {
  if (
    cursor.segments.length >
    PERSISTENT_RPC_CACHE_LIMITS.maxSegmentReadsPerOperation
  ) {
    fail("Persistent RPC cursor exceeds its segment-read budget");
  }
  const logs: unknown[] = [];
  const gaps: Array<readonly [bigint, bigint]> = [];
  let nextMissingBlock = fromBlock;
  for (const descriptor of cursor.segments) {
    const segmentFrom = BigInt(descriptor.fromBlock);
    const segmentTo = BigInt(descriptor.toBlock);
    if (segmentTo < fromBlock) continue;
    if (segmentFrom > toBlock) break;
    if (segmentFrom > nextMissingBlock) {
      gaps.push([nextMissingBlock, segmentFrom - 1n]);
    }
    const record = await store.read(descriptor.path);
    if (!record) fail("Persistent RPC log segment is missing");
    const segmentLogs = parseSegment(
      record.value,
      input,
      id,
      descriptor,
      filter,
    );
    logs.push(...logsInRequestedRange(segmentLogs, fromBlock, toBlock));
    nextMissingBlock = segmentTo + 1n;
    if (nextMissingBlock > toBlock) break;
  }
  if (nextMissingBlock <= toBlock) gaps.push([nextMissingBlock, toBlock]);
  return { logs, gaps };
}

async function createSegment(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
  blockHash: string,
  logs: readonly unknown[],
) {
  const payload: LogSegmentPayload = {
    chainId: input.chainId,
    providerId: input.providerId,
    streamId: id,
    fromBlock: quantityHex(fromBlock),
    toBlock: quantityHex(toBlock),
    blockHash,
    logs: validateLogs(logs, filter, fromBlock, toBlock),
  };
  const contentHash = digest(payload);
  const path = segmentPath(
    input,
    id,
    fromBlock,
    toBlock,
    contentHash,
  );
  const wrappedPayload = envelope(payload);
  const descriptor: LogSegment = {
    fromBlock: payload.fromBlock,
    toBlock: payload.toBlock,
    blockHash,
    path,
    contentHash,
    byteLength: assertByteLimit(
      wrappedPayload,
      PERSISTENT_RPC_CACHE_LIMITS.maxSegmentBytes,
      "log segment",
    ),
  };
  const created = await store.create(path, wrappedPayload);
  if (created === "exists") {
    const existing = await store.read(path);
    if (!existing) fail("Persistent RPC log segment raced and disappeared");
    parseSegment(existing.value, input, id, descriptor, filter);
  }
  return descriptor;
}

async function mergeAdjacentSegments(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  filter: LogFilter,
  left: LogSegment,
  right: LogSegment,
) {
  const leftTo = BigInt(left.toBlock);
  const rightFrom = BigInt(right.fromBlock);
  if (leftTo + 1n !== rightFrom) {
    fail("Persistent RPC compaction requires adjacent segments");
  }
  const [leftRecord, rightRecord] = await Promise.all([
    store.read(left.path),
    store.read(right.path),
  ]);
  if (!leftRecord || !rightRecord) {
    fail("Persistent RPC compaction source is missing");
  }
  const logs = [
    ...parseSegment(leftRecord.value, input, id, left, filter),
    ...parseSegment(rightRecord.value, input, id, right, filter),
  ];
  return createSegment(
    store,
    input,
    id,
    filter,
    BigInt(left.fromBlock),
    BigInt(right.toBlock),
    right.blockHash,
    logs,
  );
}

async function compactSegments(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  filter: LogFilter,
  candidates: readonly LogSegment[],
) {
  const segments = [...candidates].sort((left, right) =>
    BigInt(left.fromBlock) < BigInt(right.fromBlock) ? -1 : 1,
  );
  while (segments.length > PERSISTENT_RPC_CACHE_LIMITS.maxCursorSegments) {
    let mergeAt = -1;
    let smallestCombinedBytes = Number.POSITIVE_INFINITY;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const left = segments[index] as LogSegment;
      const right = segments[index + 1] as LogSegment;
      const combinedBytes = left.byteLength + right.byteLength;
      if (
        BigInt(left.toBlock) + 1n === BigInt(right.fromBlock) &&
        combinedBytes <= PERSISTENT_RPC_CACHE_LIMITS.maxSegmentBytes &&
        combinedBytes < smallestCombinedBytes
      ) {
        mergeAt = index;
        smallestCombinedBytes = combinedBytes;
      }
    }
    if (mergeAt < 0) {
      fail("Persistent RPC cursor reached its bounded compaction capacity");
    }
    const compacted = await mergeAdjacentSegments(
      store,
      input,
      id,
      filter,
      segments[mergeAt] as LogSegment,
      segments[mergeAt + 1] as LogSegment,
    );
    segments.splice(mergeAt, 2, compacted);
  }
  return segments;
}

async function persistSegment(
  store: PersistentRpcCacheStore,
  input: PersistentRequestInput,
  id: string,
  loaded: Awaited<ReturnType<typeof loadCursor>>,
  filter: LogFilter,
  fromBlock: bigint,
  toBlock: bigint,
  blockHash: string,
  logs: readonly unknown[],
) {
  const integrityScope = integrityScopes.getStore();
  const descriptor = await createSegment(
    store,
    input,
    id,
    filter,
    fromBlock,
    toBlock,
    blockHash,
    logs,
  );

  const recordScopedPersistence = (cursorDigest: string) => {
    if (!integrityScope) return;
    if (integrityScope.phase !== "open") {
      fail("Persistent RPC integrity scope is already sealed");
    }
    const exists = integrityScope.persistenceBindings.some(
      (binding) =>
        binding.store === store &&
        binding.input === input,
    );
    if (exists) {
      integrityScope.persistenceBindings[0]?.cursorDigests.add(cursorDigest);
      return;
    }
    if (integrityScope.persistenceBindings.length !== 0) {
      fail("Persistent RPC integrity scope cannot span request/store domains");
    }
    integrityScope.persistenceBindings.push({
      input,
      store,
      cursorDigests: new Set([cursorDigest]),
    });
  };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = attempt === 0
      ? loaded
      : await loadCursor(store, input, id, integrityScope?.commitId);
    if (current.cursor) {
      const exact = current.cursor.segments.find(
        (candidate) =>
          BigInt(candidate.fromBlock) === fromBlock &&
          BigInt(candidate.toBlock) === toBlock,
      );
      if (exact) {
        if (
          exact.contentHash !== descriptor.contentHash ||
          exact.blockHash.toLowerCase() !== descriptor.blockHash.toLowerCase()
        ) {
          fail("Persistent RPC log segment range changed content");
        }
        return;
      }
      if (
        current.cursor.segments.some(
          (candidate) =>
            fromBlock <= BigInt(candidate.toBlock) &&
            toBlock >= BigInt(candidate.fromBlock),
        )
      ) {
        fail("Persistent RPC log segment overlaps concurrent coverage");
      }
    }
    const segments = await compactSegments(
      store,
      input,
      id,
      filter,
      [...(current.cursor?.segments ?? []), descriptor],
    );
    const first = segments[0] as LogSegment;
    const last = segments.at(-1) as LogSegment;
    const next: LogCursorPayload = {
      chainId: input.chainId,
      providerId: input.providerId,
      streamId: id,
      startBlock: first.fromBlock,
      cursorBlock: last.toBlock,
      cursorBlockHash: last.blockHash,
      ...(integrityScope
        ? { integrityCommitId: integrityScope.commitId }
        : {}),
      segments,
    };
    const nextEnvelope = envelope(next);
    assertByteLimit(
      nextEnvelope,
      PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes,
      "cursor",
    );
    if (current.etag === null) {
      if (await store.create(current.path, nextEnvelope) === "created") {
        recordScopedPersistence(digest(nextEnvelope));
        return;
      }
    } else if (
      await store.replace(current.path, nextEnvelope, current.etag) ===
        "replaced"
    ) {
      recordScopedPersistence(digest(nextEnvelope));
      return;
    }
  }
  fail("Persistent RPC log cursor advance conflicted repeatedly");
}

const requestFlights = new Map<string, Promise<JsonRpcResult>>();

export function createPersistentRpcRequest(
  input: PersistentRequestInput,
): EIP1193RequestFn {
  const validateBlock = async (
    blockNumber: bigint,
    expectedBlockHash: string,
    options?: JsonRpcRequestOptions,
  ) => {
    const hash = await readBlockHash(input.request, blockNumber, options);
    if (hash !== expectedBlockHash.toLowerCase()) {
      throw new PersistentRpcCacheReorgError(
        "Persistent RPC runtime-code proof is no longer canonical",
      );
    }
  };
  const validateCursor = async (
    cursor: LogCursorPayload,
    options?: JsonRpcRequestOptions,
  ) => assertCanonicalCursor(input.request, cursor, options);
  const wrapped = async (
    request: JsonRpcRequest,
    options?: JsonRpcRequestOptions,
  ): Promise<JsonRpcResult> => {
    const integrityScope = integrityScopes.getStore();
    const assertScopeLease = () => {
      if (integrityScope && integrityScope.phase !== "open") {
        fail("Persistent RPC integrity scope is already sealed");
      }
    };
    assertScopeLease();
    const codeBinding = immutableCodeBinding(input, request);
    if (codeBinding && input.store) {
      const path = runtimeCodePath(input, codeBinding.binding);
      const existing = await input.store.read(path);
      assertScopeLease();
      if (existing) {
        const proof = parseRuntimeCode(existing.value, input, codeBinding.binding);
        if (BigInt(proof.observedAtBlock) <= codeBinding.blockNumber) {
          await validateBlock(
            BigInt(proof.observedAtBlock),
            proof.observedAtBlockHash,
            options,
          );
          assertScopeLease();
          return proof.code;
        }
      }
      const stableCode = await withStableBlockAnchor(
        input,
        codeBinding.blockNumber,
        () => input.request(request, options),
        options,
      );
      assertScopeLease();
      const code = stableCode.value;
      if (
        typeof code !== "string" ||
        !/^0x(?:[0-9a-f]{2})+$/iu.test(code) ||
        keccak256(code as `0x${string}`).toLowerCase() !==
          codeBinding.binding.expectedRuntimeCodeHash.toLowerCase()
      ) {
        fail("RPC runtime code does not match its immutable release binding");
      }
      const payload: RuntimeCodePayload = {
        chainId: input.chainId,
        providerId: input.providerId,
        address: codeBinding.binding.address.toLowerCase(),
        expectedRuntimeCodeHash:
          codeBinding.binding.expectedRuntimeCodeHash.toLowerCase(),
        notBeforeBlock: quantityHex(codeBinding.binding.notBeforeBlock),
        observedAtBlock: quantityHex(codeBinding.blockNumber),
        observedAtBlockHash: stableCode.blockHash,
        code,
      };
      const runtimeEnvelope = envelope(payload);
      assertByteLimit(
        runtimeEnvelope,
        PERSISTENT_RPC_CACHE_LIMITS.maxRuntimeBytes,
        "runtime proof",
      );
      const created = await input.store.create(path, runtimeEnvelope);
      assertScopeLease();
      if (created === "exists") {
        const raced = await input.store.read(path);
        assertScopeLease();
        if (!raced) fail("Persistent RPC runtime proof raced and disappeared");
        parseRuntimeCode(raced.value, input, codeBinding.binding);
      }
      await assertCanonicalRuntimeCode(
        input,
        request,
        codeBinding.blockNumber,
        code,
        stableCode.blockHash,
        options,
      );
      assertScopeLease();
      return code;
    }
    const filter = parseFilter(request);
    if (!filter) {
      const result = await input.request(request, options);
      assertScopeLease();
      return result;
    }
    const fromBlock = BigInt(filter.fromBlock);
    const toBlock = BigInt(filter.toBlock);
    if (!input.store) {
      if (
        input.maxLogBlockRange === undefined ||
        toBlock - fromBlock + 1n <= input.maxLogBlockRange
      ) {
        const result = await input.request(request, options);
        assertScopeLease();
        return result;
      }
      const logs: unknown[] = [];
      let completedRanges = 0;
      for (const [rangeFrom, rangeTo] of splitLogRange(
        fromBlock,
        toBlock,
        input.maxLogBlockRange,
      )) {
        try {
          logs.push(
            ...validateLogs(
              await input.request(
                requestWithRange(request, filter, rangeFrom, rangeTo),
                options,
              ),
              filter,
              rangeFrom,
              rangeTo,
            ),
          );
          assertScopeLease();
          completedRanges += 1;
        } catch (error) {
          if (completedRanges > 0) {
            throw new PersistentRpcCacheError(
              "Persistent RPC passthrough stopped after a partial range; refusing to replay its prefix",
              { cause: error },
            );
          }
          throw error;
        }
      }
      const validated = validateLogs(logs, filter, fromBlock, toBlock);
      assertScopeLease();
      return validated;
    }
    const id = streamId(input, filter);
    const flightKey = digest({
      providerId: input.providerId,
      chainId: input.chainId,
      id,
      fromBlock: filter.fromBlock,
      toBlock: filter.toBlock,
      integrityScopeId: integrityScope?.id ?? null,
      requestDomainId: requestDomainId(input),
    });
    const existingFlight = requestFlights.get(flightKey);
    if (existingFlight) {
      const result = await existingFlight;
      assertScopeLease();
      return result;
    }

    const value = (async () => {
      const loaded = await loadCursor(
        input.store as PersistentRpcCacheStore,
        input,
        id,
        integrityScope?.commitId,
      );
      assertScopeLease();
      let logs: unknown[] = [];
      let gaps: Array<readonly [bigint, bigint]> = [[fromBlock, toBlock]];
      const newAnchors: BlockHashProof[] = [];
      if (loaded.cursor) {
        const cursorProof = {
          blockNumber: BigInt(loaded.cursor.cursorBlock),
          blockHash: loaded.cursor.cursorBlockHash,
        };
        if (
          !(await registerScopedBlockProofs(
            input,
            [cursorProof],
            true,
            options,
          ))
        ) {
          await validateCursor(loaded.cursor, options);
        }
        assertScopeLease();
        const covered = await readCoveredLogs(
          input.store as PersistentRpcCacheStore,
          input,
          id,
          loaded.cursor,
          filter,
          fromBlock,
          toBlock,
        );
        assertScopeLease();
        logs = covered.logs;
        gaps = covered.gaps;
      }
      for (const [gapFrom, gapTo] of gaps) {
        for (const [missingFrom, missingTo] of splitLogRange(
          gapFrom,
          gapTo,
          input.maxLogBlockRange,
        )) {
          const stableLogs = await withStableBlockAnchor(
            input,
            missingTo,
            () =>
              input.request(
                requestWithRange(request, filter, missingFrom, missingTo),
                options,
              ),
            options,
          );
          assertScopeLease();
          const fetchedLogs = validateLogs(
            stableLogs.value,
            filter,
            missingFrom,
            missingTo,
          );
          const fetchedLogProofs = logBlockProofs(fetchedLogs);
          const newAnchor = {
            blockNumber: missingTo,
            blockHash: stableLogs.blockHash,
          };
          const nonAnchorLogProofs = mergeBlockProofs([
            ...fetchedLogProofs,
            newAnchor,
          ]).filter((proof) => proof.blockNumber !== missingTo);
          if (
            !(await registerScopedBlockProofs(
              input,
              nonAnchorLogProofs,
              true,
              options,
            ))
          ) {
            await assertCanonicalBlockProofs(
              input,
              nonAnchorLogProofs,
              options,
            );
          }
          assertScopeLease();
          await registerScopedBlockProofs(
            input,
            [newAnchor, ...fetchedLogProofs],
            false,
            options,
          );
          assertScopeLease();
          await persistSegment(
            input.store as PersistentRpcCacheStore,
            input,
            id,
            loaded,
            filter,
            missingFrom,
            missingTo,
            stableLogs.blockHash,
            fetchedLogs,
          );
          assertScopeLease();
          newAnchors.push(newAnchor);
          logs.push(...fetchedLogs);
        }
      }
      const orderedLogs = [...logs].sort((left, right) =>
        comparePosition(
          logPosition(left as Record<string, unknown>),
          logPosition(right as Record<string, unknown>),
        ),
      );
      const validatedLogs = validateLogs(
        orderedLogs,
        filter,
        fromBlock,
        toBlock,
      );
      if (!integrityScope) {
        const finalProofs = logBlockProofs(validatedLogs);
        if (loaded.cursor) {
          finalProofs.push({
            blockNumber: BigInt(loaded.cursor.cursorBlock),
            blockHash: loaded.cursor.cursorBlockHash,
          });
        }
        finalProofs.push(...newAnchors);
        await assertCanonicalBlockProofs(input, finalProofs, options);
        assertScopeLease();
      }
      assertScopeLease();
      return validatedLogs;
    })() as Promise<JsonRpcResult>;
    requestFlights.set(flightKey, value);
    try {
      const result = await value;
      assertScopeLease();
      return result;
    } finally {
      if (requestFlights.get(flightKey) === value) {
        requestFlights.delete(flightKey);
      }
    }
  };
  return wrapped as EIP1193RequestFn;
}

function blobToken(environment: NodeJS.ProcessEnv = process.env) {
  return (
    environment.OPS_BLOB_READ_WRITE_TOKEN?.trim() ||
    environment.BLOB_READ_WRITE_TOKEN?.trim() ||
    null
  );
}

export function persistentRpcCachePathByteLimit(path: string) {
  if (path.endsWith("/cursor.json")) {
    return PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes;
  }
  if (path.includes("/segments/")) {
    return PERSISTENT_RPC_CACHE_LIMITS.maxSegmentBytes;
  }
  if (path.includes("/runtime-v2/")) {
    return PERSISTENT_RPC_CACHE_LIMITS.maxRuntimeBytes;
  }
  if (path.includes("/integrity/")) {
    return PERSISTENT_RPC_CACHE_LIMITS.maxCursorBytes;
  }
  fail("Persistent RPC cache path has no byte limit");
}

function contentLength(headers: Readonly<{ get(name: string): string | null }>) {
  const value = headers.get("content-length");
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    fail("Persistent RPC Blob Content-Length is invalid");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    fail("Persistent RPC Blob Content-Length is unsafe");
  }
  return parsed;
}

export async function readBoundedBlobJson(input: Readonly<{
  stream: ReadableStream<Uint8Array>;
  maximumBytes: number;
  declaredSize: number;
  declaredContentLength: number | null;
}>) {
  if (
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes <= 0 ||
    !Number.isSafeInteger(input.declaredSize) ||
    input.declaredSize < 0 ||
    input.declaredSize > input.maximumBytes ||
    (input.declaredContentLength !== null &&
      (!Number.isSafeInteger(input.declaredContentLength) ||
        input.declaredContentLength < 0 ||
        input.declaredContentLength > input.maximumBytes ||
        input.declaredContentLength !== input.declaredSize))
  ) {
    await input.stream.cancel("Persistent RPC Blob declaration exceeds limit");
    fail("Persistent RPC Blob declaration exceeds or conflicts with its limit");
  }

  const reader = input.stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        await reader.cancel("Persistent RPC Blob chunk is invalid");
        fail("Persistent RPC Blob chunk is invalid");
      }
      totalBytes += result.value.byteLength;
      if (
        totalBytes > input.maximumBytes ||
        totalBytes > input.declaredSize ||
        (input.declaredContentLength !== null &&
          totalBytes > input.declaredContentLength)
      ) {
        await reader.cancel("Persistent RPC Blob stream exceeds limit");
        fail("Persistent RPC Blob stream exceeds its declared byte limit");
      }
      chunks.push(decoder.decode(result.value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // The original bounded-read failure remains authoritative.
    }
    if (error instanceof PersistentRpcCacheError) throw error;
    throw new PersistentRpcCacheError(
      "Persistent RPC Blob stream could not be read safely",
      { cause: error },
    );
  } finally {
    reader.releaseLock();
  }
  if (
    totalBytes !== input.declaredSize ||
    (input.declaredContentLength !== null &&
      totalBytes !== input.declaredContentLength)
  ) {
    fail("Persistent RPC Blob stream length does not match its declaration");
  }
  try {
    return JSON.parse(chunks.join("")) as unknown;
  } catch (error) {
    throw new PersistentRpcCacheError(
      "Persistent RPC Blob JSON is invalid",
      { cause: error },
    );
  }
}

function blobStore(token: string): PersistentRpcCacheStore {
  return {
    async read(path) {
      const { get } = await import("@vercel/blob");
      const result = await get(path, {
        access: "private",
        token,
        useCache: false,
      });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const maximumBytes = persistentRpcCachePathByteLimit(path);
      return {
        etag: result.blob.etag,
        value: await readBoundedBlobJson({
          stream: result.stream,
          maximumBytes,
          declaredSize: result.blob.size,
          declaredContentLength: contentLength(result.headers),
        }),
      };
    },
    async create(path, value) {
      const { get, put } = await import("@vercel/blob");
      try {
        await put(path, JSON.stringify(value), {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
          token,
        });
        return "created";
      } catch (error) {
        const existing = await get(path, {
          access: "private",
          token,
          useCache: false,
        });
        if (existing?.statusCode === 200) return "exists";
        throw error;
      }
    },
    async replace(path, value, expectedEtag) {
      const { get, put } = await import("@vercel/blob");
      try {
        await put(path, JSON.stringify(value), {
          access: "private",
          contentType: "application/json",
          addRandomSuffix: false,
          allowOverwrite: true,
          cacheControlMaxAge: 60,
          ifMatch: expectedEtag,
          token,
        });
        return "replaced";
      } catch (error) {
        const current = await get(path, {
          access: "private",
          token,
          useCache: false,
        });
        if (current?.statusCode === 200 && current.blob.etag !== expectedEtag) {
          return "conflict";
        }
        throw error;
      }
    },
  };
}

export function createMemoryPersistentRpcCacheStore(): PersistentRpcCacheStore {
  const values = new Map<string, { etag: string; value: unknown }>();
  let generation = 0;
  return {
    async read(path) {
      return values.get(path) ?? null;
    },
    async create(path, value) {
      if (values.has(path)) return "exists";
      generation += 1;
      values.set(path, { etag: `memory-${generation}`, value });
      return "created";
    },
    async replace(path, value, expectedEtag) {
      const current = values.get(path);
      if (!current || current.etag !== expectedEtag) return "conflict";
      generation += 1;
      values.set(path, { etag: `memory-${generation}`, value });
      return "replaced";
    },
  };
}

export function persistentRpcHttp(
  rpcUrl: string,
  input: Readonly<{
    chainId: number;
    http?: HttpTransportConfig;
    maxLogBlockRange?: bigint;
    immutableCodeBindings?: readonly ImmutableCodeBinding[];
    store?: PersistentRpcCacheStore | null;
  }>,
): Transport {
  const underlying = http(rpcUrl, input.http);
  const providerId = digest({ rpcUrl });
  return (transportInput) => {
    const transport = underlying(transportInput);
    const token = blobToken();
    return {
      ...transport,
      request: createPersistentRpcRequest({
        chainId: input.chainId,
        providerId,
        request: transport.request,
        maxLogBlockRange: input.maxLogBlockRange,
        immutableCodeBindings: input.immutableCodeBindings,
        store: input.store === undefined
          ? token
            ? blobStore(token)
            : null
          : input.store,
      }),
    };
  };
}
