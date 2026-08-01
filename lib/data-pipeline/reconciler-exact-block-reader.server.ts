import "server-only";

import {
  getAddress,
  isAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  canonicalBytes32,
  type HexBytes32,
} from "./codecs";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import {
  RECONCILER_CORPUS_MAXIMUM_TOTAL_COUNT,
  RECONCILER_CORPUS_PARTITION_SIZE,
} from "./reconciler-corpus-partitions";
import {
  canonicalProjectorRpcEndpoint,
  projectorRpcDeploymentCommitment,
} from "./projector-provider-commitments";
import type {
  ReconcilerIndexedRouteStore,
  ReconcilerLiveSource,
  ReconcilerPreParityContract,
  ReconcilerRouteDto,
  ReconcilerRouteDtoReader,
} from "./reconciler-preparity";
import { rpcProviderCommitment } from "./rpc-provider-commitments";

type Environment = Readonly<Record<string, string | undefined>>;
type Fetch = typeof fetch;

const HEX_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/u;
const HEX_DATA = /^0x(?:[0-9a-f]{2})*$/u;
const MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_REQUEST_BUDGET = 512;
const DEFAULT_BATCH_SIZE = 32;
const MAXIMUM_BATCH_SIZE = 100;
const DEFAULT_LOGICAL_REQUEST_BUDGET =
  DEFAULT_REQUEST_BUDGET * DEFAULT_BATCH_SIZE;
const DEFAULT_TIMEOUT_MS = 5_000;

function quantity(value: bigint): Hex {
  if (value < 0n) throw invalidInput("rpc", "negative-block-number");
  return `0x${value.toString(16)}` as Hex;
}

function parseQuantity(value: unknown, operation: string): bigint {
  if (typeof value !== "string" || !HEX_QUANTITY.test(value)) {
    throw validationError("rpc", operation);
  }
  return BigInt(value);
}

function data(value: unknown, operation: string): Hex {
  if (typeof value !== "string" || !HEX_DATA.test(value)) {
    throw validationError("rpc", operation);
  }
  return value as Hex;
}

function address(value: unknown, operation: string): Address {
  if (typeof value !== "string" || !isAddress(value)) {
    throw validationError("rpc", operation);
  }
  return getAddress(value);
}

function object(value: unknown, operation: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw validationError("rpc", operation);
  }
  return value as Record<string, unknown>;
}

function exactBlockHash(value: unknown, operation: string): HexBytes32 {
  try {
    return canonicalBytes32(value);
  } catch {
    throw validationError("rpc", operation);
  }
}

export type ExactBlockRpcLog = Readonly<{
  address: Address;
  blockNumber: bigint;
  blockHash: HexBytes32;
  transactionHash: HexBytes32;
  transactionIndex: number;
  logIndex: number;
  topics: readonly Hex[];
  data: Hex;
}>;

export type ExactBlockRpcReceiptLog = ExactBlockRpcLog & Readonly<{
  /** Zero-based position in the canonical transaction receipt log array. */
  receiptLogIndex: number;
}>;

export type ExactBlockRpcReceipt = Readonly<{
  transactionHash: HexBytes32;
  blockNumber: bigint;
  blockHash: HexBytes32;
  transactionIndex: number;
  status: 1n;
  logs: readonly ExactBlockRpcReceiptLog[];
}>;

export type ExactBlockRpcReceiptBinding = Readonly<{
  transactionHash: HexBytes32;
  expectedBlockNumber: bigint;
  expectedBlockHash: HexBytes32;
}>;

export type ExactBlockRpcTransaction = Readonly<{
  transactionHash: HexBytes32;
  blockNumber: bigint;
  blockHash: HexBytes32;
  transactionIndex: number;
  from: Address;
  to: Address;
  input: Hex;
  value: bigint;
}>;

export type ExactBlockRpcTransactionBinding = Readonly<{
  transactionHash: HexBytes32;
  expectedBlockNumber: bigint;
  expectedBlockHash: HexBytes32;
  expectedTo: Address;
}>;

export type ExactBlockRpcTimestampBinding = Readonly<{
  blockNumber: bigint;
  expectedHash?: HexBytes32;
}>;

export type ExactBlockRpcCall = Readonly<{
  to: Address;
  data: Hex;
}>;

export type ExactBlockRpcPartitionBinding = Readonly<{
  manifestCommitment: HexBytes32;
  pageCommitment: HexBytes32;
  pageIndex: number;
  pageCount: number;
  pageSize: number;
  totalCount: number;
  startIndex: number;
  endIndexExclusive: number;
}>;

function safeQuantityNumber(value: unknown, operation: string): number {
  const parsed = parseQuantity(value, operation);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw validationError("rpc", operation);
  }
  return Number(parsed);
}

function decodeRpcLog(
  raw: unknown,
  operation: string,
): ExactBlockRpcLog {
  const row = object(raw, operation);
  if (
    (row.removed !== undefined && row.removed !== false) ||
    !Array.isArray(row.topics)
  ) {
    throw validationError("rpc", `${operation}-canonical`);
  }
  return Object.freeze({
    address: address(row.address, `${operation}-address`),
    blockNumber: parseQuantity(row.blockNumber, `${operation}-block-number`),
    blockHash: exactBlockHash(row.blockHash, `${operation}-block-hash`),
    transactionHash: exactBlockHash(
      row.transactionHash,
      `${operation}-transaction-hash`,
    ),
    transactionIndex: safeQuantityNumber(
      row.transactionIndex,
      `${operation}-transaction-index`,
    ),
    logIndex: safeQuantityNumber(row.logIndex, `${operation}-log-index`),
    topics: Object.freeze(row.topics.map((topic) =>
      exactBlockHash(topic, `${operation}-topic`) as Hex
    )),
    data: data(row.data, `${operation}-data`),
  });
}

export type ExactBlockRpcClient = Readonly<{
  endpointCommitment: HexBytes32;
  endpointOriginCommitment: HexBytes32;
  /** Physical HTTP requests reserved by this client. */
  requestCount(): number;
  /** Individual JSON-RPC operations reserved by this client. */
  logicalRequestCount(): number;
  /**
   * Creates one independently bounded client for the next manifest-bound
   * corpus page. The parent aggregates its counters and rejects reuse or
   * out-of-order page issuance.
   */
  createPartitionClient(
    binding: ExactBlockRpcPartitionBinding,
  ): ExactBlockRpcClient;
  assertCheckpoint(input: {
    blockNumber: bigint;
    blockHash: HexBytes32;
    signal: AbortSignal;
  }): Promise<bigint>;
  call(input: {
    to: Address;
    data: Hex;
    blockHash: HexBytes32;
    signal: AbortSignal;
  }): Promise<Hex>;
  callMany(input: {
    calls: readonly ExactBlockRpcCall[];
    blockHash: HexBytes32;
    signal: AbortSignal;
  }): Promise<readonly Hex[]>;
  getCodeHash(input: {
    address: Address;
    blockHash: HexBytes32;
    signal: AbortSignal;
  }): Promise<HexBytes32>;
  getLogs(input: {
    addresses: Address | readonly Address[];
    topics?: readonly (Hex | readonly Hex[] | null)[];
    fromBlock: bigint;
    toBlock: bigint;
    maximumLogs: number;
    signal: AbortSignal;
  }): Promise<readonly ExactBlockRpcLog[]>;
  getBlockTimestamp(input: {
    blockNumber: bigint;
    expectedHash?: HexBytes32;
    signal: AbortSignal;
  }): Promise<bigint>;
  getBlockTimestamps(input: {
    blocks: readonly ExactBlockRpcTimestampBinding[];
    signal: AbortSignal;
  }): Promise<readonly bigint[]>;
  getTransactionReceipt(input: {
    transactionHash: HexBytes32;
    expectedBlockNumber: bigint;
    expectedBlockHash: HexBytes32;
    signal: AbortSignal;
  }): Promise<ExactBlockRpcReceipt>;
  getTransactionReceipts(input: {
    receipts: readonly ExactBlockRpcReceiptBinding[];
    signal: AbortSignal;
  }): Promise<readonly ExactBlockRpcReceipt[]>;
  getTransaction(input: {
    transactionHash: HexBytes32;
    expectedBlockNumber: bigint;
    expectedBlockHash: HexBytes32;
    expectedTo: Address;
    signal: AbortSignal;
  }): Promise<ExactBlockRpcTransaction>;
  getTransactions(input: {
    transactions: readonly ExactBlockRpcTransactionBinding[];
    signal: AbortSignal;
  }): Promise<readonly ExactBlockRpcTransaction[]>;
}>;

type JsonRpcRequest = Readonly<{
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: readonly unknown[];
}>;

type ExactBlockRpcBudgetLedger = {
  physicalRequests: number;
  logicalRequests: number;
};

class ProviderLogLimitError extends Error {
  constructor() {
    super("Provider rejected the eth_getLogs range");
    this.name = "ProviderLogLimitError";
  }
}

const EXPLICIT_LOG_LIMIT_PATTERNS = Object.freeze([
  /\beth_getlogs\b.{0,120}\b(?:block range|range|response size|result size|limit(?:ed)?|too (?:large|wide|many)|exceed(?:ed|s)?)\b/iu,
  /\b(?:block range|response size|result size|query size)\b.{0,120}\b(?:limit(?:ed)?|too (?:large|wide)|exceed(?:ed|s)?|maximum|max)\b/iu,
  /\b(?:too many|more than|maximum|max)\b.{0,120}\b(?:logs?|results?|blocks?)\b/iu,
  /\bquery returned more than\b/iu,
]);

function isExplicitProviderLogLimit(value: unknown): boolean {
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value);
    } catch {
      return false;
    }
  }
  return EXPLICIT_LOG_LIMIT_PATTERNS.some((pattern) => pattern.test(text));
}

function isSplittableLogFailure(error: unknown): boolean {
  if (error instanceof ProviderLogLimitError) return true;
  if (!(error instanceof DataPipelineError) || error.code !== "response_oversize") {
    return false;
  }
  const operation = error.safeMetadata?.operation;
  return operation === "reconciler-rpc-response" ||
    operation === "reconciler-rpc-log-count";
}

function assertCanonicalLogOrder(
  logs: readonly ExactBlockRpcLog[],
  operation: string,
): void {
  for (let index = 1; index < logs.length; index += 1) {
    const previous = logs[index - 1]!;
    const current = logs[index]!;
    if (
      current.blockNumber < previous.blockNumber ||
      (current.blockNumber === previous.blockNumber &&
        (current.transactionIndex < previous.transactionIndex ||
          (current.transactionIndex === previous.transactionIndex &&
            current.logIndex <= previous.logIndex)))
    ) {
      throw validationError("rpc", operation);
    }
  }
}

function hasOwn(value: object, property: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

async function responseText(response: Response): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && !/^(?:0|[1-9][0-9]*)$/u.test(declared)) {
    throw validationError("rpc", "reconciler-rpc-content-length");
  }
  if (
    declared !== null &&
    BigInt(declared) > BigInt(MAXIMUM_RESPONSE_BYTES)
  ) {
    throw dataPipelineError({
      dependency: "rpc",
      code: "response_oversize",
      retryable: true,
      countsTowardCircuit: true,
      metadata: { operation: "reconciler-rpc-response" },
    });
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAXIMUM_RESPONSE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size failure remains authoritative even if cancellation races
          // with a provider closing the response stream.
        }
        throw dataPipelineError({
          dependency: "rpc",
          code: "response_oversize",
          retryable: true,
          countsTowardCircuit: true,
          metadata: { operation: "reconciler-rpc-response" },
        });
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(
    Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), byteLength),
  );
}

export function createExactBlockRpcClient(input: {
  endpoint: string;
  endpointCommitment: HexBytes32;
  endpointOriginCommitment: HexBytes32;
  fetch?: Fetch;
  maximumRequests?: number;
  maximumLogicalRequests?: number;
  maximumBatchSize?: number;
  timeoutMs?: number;
  /** @internal Root, corpus page, then one bounded nested-work page. */
  partitionDepth?: number;
  /** @internal One budget shared by the root and every partition descendant. */
  budgetLedger?: ExactBlockRpcBudgetLedger;
}): ExactBlockRpcClient {
  const fetchImplementation = input.fetch ?? fetch;
  const maximumRequests = input.maximumRequests ?? DEFAULT_REQUEST_BUDGET;
  const maximumLogicalRequests = input.maximumLogicalRequests ??
    DEFAULT_LOGICAL_REQUEST_BUDGET;
  const maximumBatchSize = input.maximumBatchSize ?? DEFAULT_BATCH_SIZE;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const partitionDepth = input.partitionDepth ?? 0;
  const budgetLedger = input.budgetLedger ?? {
    physicalRequests: 0,
    logicalRequests: 0,
  };
  if (
    !Number.isSafeInteger(maximumRequests) ||
    maximumRequests < 1 ||
    maximumRequests > 10_000 ||
    !Number.isSafeInteger(maximumLogicalRequests) ||
    maximumLogicalRequests < 1 ||
    maximumLogicalRequests > 1_000_000 ||
    !Number.isSafeInteger(maximumBatchSize) ||
    maximumBatchSize < 1 ||
    maximumBatchSize > MAXIMUM_BATCH_SIZE ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 30_000 ||
    !Number.isSafeInteger(partitionDepth) ||
    partitionDepth < 0 ||
    partitionDepth > 2
  ) {
    throw invalidInput("config", "reconciler-rpc-budget");
  }
  let nextId = 1;
  const partitionClients: ExactBlockRpcClient[] = [];
  const issuedPartitions = new Set<string>();
  let partitionManifestCommitment: HexBytes32 | null = null;
  let partitionPageCount: number | null = null;
  let partitionPageSize: number | null = null;
  let partitionTotalCount: number | null = null;
  let partitionNextStartIndex = 0;
  let partitionSequenceClosed = false;

  const assertNotAborted = (signal: AbortSignal) => {
    if (signal.aborted) {
      throw dataPipelineError({
        dependency: "rpc",
        code: "timeout",
        retryable: true,
        countsTowardCircuit: true,
        metadata: { operation: "reconciler-rpc-aborted" },
      });
    }
  };

  // Reserve the whole operation before the first network request. This makes
  // oversized batches atomic: they cannot spend a prefix of their budget and
  // then fail midway through the input.
  const reserve = (physicalCount: number, logicalCount: number) => {
    const nextPhysicalCount = budgetLedger.physicalRequests + physicalCount;
    const nextLogicalCount = budgetLedger.logicalRequests + logicalCount;
    budgetLedger.physicalRequests = nextPhysicalCount;
    budgetLedger.logicalRequests = nextLogicalCount;
    if (nextPhysicalCount > maximumRequests) {
      throw dataPipelineError({
        dependency: "rpc",
        code: "response_oversize",
        retryable: false,
        countsTowardCircuit: true,
        metadata: { operation: "reconciler-rpc-request-budget" },
      });
    }
    if (nextLogicalCount > maximumLogicalRequests) {
      throw dataPipelineError({
        dependency: "rpc",
        code: "response_oversize",
        retryable: false,
        countsTowardCircuit: true,
        metadata: { operation: "reconciler-rpc-logical-budget" },
      });
    }
  };

  const allocateRequest = (
    method: string,
    params: readonly unknown[],
  ): JsonRpcRequest => {
    if (!Number.isSafeInteger(nextId)) {
      throw dataPipelineError({
        dependency: "rpc",
        code: "response_oversize",
        retryable: false,
        countsTowardCircuit: true,
        metadata: { operation: "reconciler-rpc-id-budget" },
      });
    }
    const request = Object.freeze({
      jsonrpc: "2.0" as const,
      id: nextId,
      method,
      params,
    });
    nextId += 1;
    return request;
  };

  const post = async (
    body: JsonRpcRequest | readonly JsonRpcRequest[],
    signal: AbortSignal,
  ): Promise<unknown> => {
    assertNotAborted(signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const encodedBody = JSON.stringify(body);
      if (Buffer.byteLength(encodedBody, "utf8") > MAXIMUM_RESPONSE_BYTES) {
        throw dataPipelineError({
          dependency: "rpc",
          code: "response_oversize",
          retryable: false,
          countsTowardCircuit: true,
          metadata: { operation: "reconciler-rpc-request-body" },
        });
      }
      const response = await fetchImplementation(input.endpoint, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: encodedBody,
        signal: controller.signal,
      });
      if (!response.ok) {
        const isLogRequest = !Array.isArray(body) &&
          (body as JsonRpcRequest).method === "eth_getLogs";
        if (isLogRequest && response.status !== 408 && response.status !== 429) {
          if (response.status === 413) {
            throw new ProviderLogLimitError();
          }
          const failureBody = await responseText(response);
          if (isExplicitProviderLogLimit(failureBody)) {
            throw new ProviderLogLimitError();
          }
        }
        throw dataPipelineError({
          dependency: "rpc",
          code: "dependency_unavailable",
          retryable: response.status === 408 || response.status === 429 ||
            response.status >= 500,
          countsTowardCircuit: true,
          metadata: {
            operation: "reconciler-rpc-http",
            status: response.status,
          },
        });
      }
      try {
        return JSON.parse(await responseText(response)) as unknown;
      } catch (error) {
        if (error instanceof DataPipelineError) {
          throw error;
        }
        throw dataPipelineError({
          dependency: "rpc",
          code: "invalid_json",
          retryable: true,
          countsTowardCircuit: true,
          metadata: { operation: "reconciler-rpc-json" },
        });
      }
    } catch (error) {
      if (
        error instanceof DataPipelineError ||
        error instanceof ProviderLogLimitError
      ) {
        throw error;
      }
      throw dataPipelineError({
        dependency: "rpc",
        code: controller.signal.aborted ? "timeout" : "dependency_unavailable",
        retryable: true,
        countsTowardCircuit: true,
        metadata: { operation: "reconciler-rpc-request" },
      });
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  };

  const decodeSingleResponse = (
    decoded: unknown,
    expectedId: number,
    method: string,
  ): unknown => {
    const envelope = object(decoded, "reconciler-rpc-envelope");
    const hasResult = hasOwn(envelope, "result");
    const hasError = hasOwn(envelope, "error");
    if (
      envelope.jsonrpc !== "2.0" ||
      envelope.id !== expectedId ||
      hasResult === hasError
    ) {
      throw validationError("rpc", "reconciler-rpc-envelope");
    }
    if (hasError) {
      if (
        method === "eth_getLogs" &&
        isExplicitProviderLogLimit(envelope.error)
      ) {
        throw new ProviderLogLimitError();
      }
      throw validationError("rpc", "reconciler-rpc-item-error");
    }
    return envelope.result;
  };

  const rpc = async (
    method: string,
    params: readonly unknown[],
    signal: AbortSignal,
  ): Promise<unknown> => {
    assertNotAborted(signal);
    reserve(1, 1);
    const request = allocateRequest(method, params);
    return decodeSingleResponse(
      await post(request, signal),
      request.id,
      method,
    );
  };

  const rpcBatch = async (
    requestsForBatch: readonly JsonRpcRequest[],
    signal: AbortSignal,
  ): Promise<readonly unknown[]> => {
    const decoded = await post(requestsForBatch, signal);
    if (!Array.isArray(decoded)) {
      throw validationError("rpc", "reconciler-rpc-batch-envelope");
    }
    const expectedIds = new Set(requestsForBatch.map((request) => request.id));
    const results = new Map<number, unknown>();
    for (const rawEnvelope of decoded) {
      const envelope = object(rawEnvelope, "reconciler-rpc-batch-item");
      if (
        envelope.jsonrpc !== "2.0" ||
        !Number.isSafeInteger(envelope.id)
      ) {
        throw validationError("rpc", "reconciler-rpc-batch-item");
      }
      const id = envelope.id as number;
      if (!expectedIds.has(id)) {
        throw validationError("rpc", "reconciler-rpc-batch-id-unknown");
      }
      if (results.has(id)) {
        throw validationError("rpc", "reconciler-rpc-batch-id-duplicate");
      }
      const hasResult = hasOwn(envelope, "result");
      const hasError = hasOwn(envelope, "error");
      if (hasResult === hasError) {
        throw validationError("rpc", "reconciler-rpc-batch-item-shape");
      }
      if (hasError) {
        throw validationError("rpc", "reconciler-rpc-batch-item-error");
      }
      results.set(id, envelope.result);
    }
    if (results.size !== requestsForBatch.length) {
      throw validationError("rpc", "reconciler-rpc-batch-id-missing");
    }
    return Object.freeze(requestsForBatch.map((request) =>
      results.get(request.id)
    ));
  };

  const validateReceiptBinding = (
    binding: ExactBlockRpcReceiptBinding,
  ) => {
    if (binding.expectedBlockNumber < 0n) {
      throw invalidInput("rpc", "reconciler-rpc-receipt-block");
    }
    return Object.freeze({
      transactionHash: canonicalBytes32(binding.transactionHash),
      expectedBlockNumber: binding.expectedBlockNumber,
      expectedBlockHash: canonicalBytes32(binding.expectedBlockHash),
    });
  };

  const decodeReceipt = (
    raw: unknown,
    binding: ReturnType<typeof validateReceiptBinding>,
  ): ExactBlockRpcReceipt => {
    const row = object(raw, "reconciler-rpc-receipt");
    const transactionHash = exactBlockHash(
      row.transactionHash,
      "reconciler-rpc-receipt-transaction-hash",
    );
    const blockNumber = parseQuantity(
      row.blockNumber,
      "reconciler-rpc-receipt-block-number",
    );
    const blockHash = exactBlockHash(
      row.blockHash,
      "reconciler-rpc-receipt-block-hash",
    );
    const transactionIndex = safeQuantityNumber(
      row.transactionIndex,
      "reconciler-rpc-receipt-transaction-index",
    );
    const status = parseQuantity(
      row.status,
      "reconciler-rpc-receipt-status",
    );
    if (
      transactionHash !== binding.transactionHash ||
      blockNumber !== binding.expectedBlockNumber ||
      blockHash !== binding.expectedBlockHash ||
      status !== 1n ||
      !Array.isArray(row.logs)
    ) {
      throw validationError("rpc", "reconciler-rpc-receipt-binding");
    }
    const logs = row.logs.map((rawLog, receiptLogIndex) => {
      const log = decodeRpcLog(rawLog, "reconciler-rpc-receipt-log");
      if (
        log.transactionHash !== transactionHash ||
        log.blockNumber !== blockNumber ||
        log.blockHash !== blockHash ||
        log.transactionIndex !== transactionIndex
      ) {
        throw validationError("rpc", "reconciler-rpc-receipt-log-binding");
      }
      return Object.freeze({ ...log, receiptLogIndex });
    });
    for (let index = 1; index < logs.length; index += 1) {
      if (logs[index]!.logIndex <= logs[index - 1]!.logIndex) {
        throw validationError("rpc", "reconciler-rpc-receipt-log-order");
      }
    }
    return Object.freeze({
      transactionHash,
      blockNumber,
      blockHash,
      transactionIndex,
      status: 1n as const,
      logs: Object.freeze(logs),
    });
  };

  const validateTransactionBinding = (
    binding: ExactBlockRpcTransactionBinding,
  ) => {
    if (binding.expectedBlockNumber < 0n) {
      throw invalidInput("rpc", "reconciler-rpc-transaction-block");
    }
    return Object.freeze({
      transactionHash: canonicalBytes32(binding.transactionHash),
      expectedBlockNumber: binding.expectedBlockNumber,
      expectedBlockHash: canonicalBytes32(binding.expectedBlockHash),
      expectedTo: getAddress(binding.expectedTo),
    });
  };

  const decodeTransaction = (
    raw: unknown,
    binding: ReturnType<typeof validateTransactionBinding>,
  ): ExactBlockRpcTransaction => {
    const row = object(raw, "reconciler-rpc-transaction");
    const resolved = Object.freeze({
      transactionHash: exactBlockHash(
        row.hash,
        "reconciler-rpc-transaction-hash",
      ),
      blockNumber: parseQuantity(
        row.blockNumber,
        "reconciler-rpc-transaction-block-number",
      ),
      blockHash: exactBlockHash(
        row.blockHash,
        "reconciler-rpc-transaction-block-hash",
      ),
      transactionIndex: safeQuantityNumber(
        row.transactionIndex,
        "reconciler-rpc-transaction-index",
      ),
      from: address(row.from, "reconciler-rpc-transaction-from"),
      to: address(row.to, "reconciler-rpc-transaction-to"),
      input: data(row.input, "reconciler-rpc-transaction-input"),
      value: parseQuantity(row.value, "reconciler-rpc-transaction-value"),
    });
    if (
      resolved.transactionHash !== binding.transactionHash ||
      resolved.blockNumber !== binding.expectedBlockNumber ||
      resolved.blockHash !== binding.expectedBlockHash ||
      resolved.to !== binding.expectedTo
    ) {
      throw validationError("rpc", "reconciler-rpc-transaction-binding");
    }
    return resolved;
  };

  const decodeBlock = (raw: unknown, blockNumber: bigint) => {
    const result = object(raw, "reconciler-rpc-block");
    const number = parseQuantity(result.number, "reconciler-rpc-block-number");
    const hash = exactBlockHash(result.hash, "reconciler-rpc-block-hash");
    const timestamp = parseQuantity(
      result.timestamp,
      "reconciler-rpc-block-timestamp",
    );
    if (number !== blockNumber) {
      throw validationError("rpc", "reconciler-rpc-block-number-mismatch");
    }
    return { number, hash, timestamp } as const;
  };

  const readBlock = async (
    blockNumber: bigint,
    signal: AbortSignal,
  ) => decodeBlock(
    await rpc("eth_getBlockByNumber", [quantity(blockNumber), false], signal),
    blockNumber,
  );

  return Object.freeze({
    endpointCommitment: canonicalBytes32(input.endpointCommitment),
    endpointOriginCommitment: canonicalBytes32(
      input.endpointOriginCommitment,
    ),
    requestCount: () => budgetLedger.physicalRequests,
    logicalRequestCount: () => budgetLedger.logicalRequests,
    createPartitionClient(binding) {
      if (partitionDepth >= 2) {
        throw invalidInput("rpc", "reconciler-rpc-nested-partition");
      }
      const manifestCommitment = canonicalBytes32(binding.manifestCommitment);
      const pageCommitment = canonicalBytes32(binding.pageCommitment);
      if (
        !Number.isSafeInteger(binding.pageIndex) ||
        !Number.isSafeInteger(binding.pageCount) ||
        !Number.isSafeInteger(binding.pageSize) ||
        !Number.isSafeInteger(binding.totalCount) ||
        !Number.isSafeInteger(binding.startIndex) ||
        !Number.isSafeInteger(binding.endIndexExclusive) ||
        binding.pageCount < 1 ||
        binding.pageSize < 1 ||
        binding.pageSize > RECONCILER_CORPUS_PARTITION_SIZE ||
        binding.totalCount < 1 ||
        binding.totalCount > RECONCILER_CORPUS_MAXIMUM_TOTAL_COUNT ||
        binding.pageCount !== Math.ceil(binding.totalCount / binding.pageSize) ||
        binding.pageIndex !== partitionClients.length ||
        binding.pageIndex >= binding.pageCount ||
        binding.startIndex !== binding.pageIndex * binding.pageSize ||
        binding.endIndexExclusive !== Math.min(
          binding.startIndex + binding.pageSize,
          binding.totalCount,
        ) ||
        partitionSequenceClosed
      ) {
        throw invalidInput("rpc", "reconciler-rpc-partition-binding");
      }
      if (partitionManifestCommitment === null) {
        if (binding.pageIndex !== 0 || binding.startIndex !== 0) {
          throw invalidInput("rpc", "reconciler-rpc-partition-sequence");
        }
        partitionManifestCommitment = manifestCommitment;
        partitionPageCount = binding.pageCount;
        partitionPageSize = binding.pageSize;
        partitionTotalCount = binding.totalCount;
      } else if (
        manifestCommitment !== partitionManifestCommitment ||
        binding.pageCount !== partitionPageCount ||
        binding.pageSize !== partitionPageSize ||
        binding.totalCount !== partitionTotalCount ||
        binding.startIndex !== partitionNextStartIndex
      ) {
        throw invalidInput("rpc", "reconciler-rpc-partition-sequence");
      }
      const identity = `${manifestCommitment}:${pageCommitment}:${binding.pageIndex}`;
      if (issuedPartitions.has(identity) || issuedPartitions.has(pageCommitment)) {
        throw invalidInput("rpc", "reconciler-rpc-partition-reuse");
      }
      issuedPartitions.add(identity);
      issuedPartitions.add(pageCommitment);
      const client = createExactBlockRpcClient({
        endpoint: input.endpoint,
        endpointCommitment: input.endpointCommitment,
        endpointOriginCommitment: input.endpointOriginCommitment,
        fetch: fetchImplementation,
        maximumRequests,
        maximumLogicalRequests,
        maximumBatchSize,
        timeoutMs,
        partitionDepth: partitionDepth + 1,
        budgetLedger,
      });
      partitionClients.push(client);
      partitionNextStartIndex = binding.endIndexExclusive;
      partitionSequenceClosed = binding.pageIndex + 1 === binding.pageCount;
      return client;
    },
    async assertCheckpoint({ blockNumber, blockHash, signal }) {
      const block = await readBlock(blockNumber, signal);
      if (block.hash !== canonicalBytes32(blockHash)) {
        throw validationError("rpc", "reconciler-rpc-checkpoint-mismatch");
      }
      return block.timestamp;
    },
    async call({ to, data: callData, blockHash, signal }) {
      return data(
        await rpc(
          "eth_call",
          [
            { to: getAddress(to), data: data(callData, "reconciler-call-data") },
            {
              blockHash: canonicalBytes32(blockHash),
              requireCanonical: true,
            },
          ],
          signal,
        ),
        "reconciler-rpc-call-result",
      );
    },
    async callMany({ calls, blockHash, signal }) {
      assertNotAborted(signal);
      const exactHash = canonicalBytes32(blockHash);
      if (!Array.isArray(calls)) {
        throw invalidInput("rpc", "reconciler-rpc-batch-calls");
      }
      const validatedCalls = calls.map((call) => Object.freeze({
        to: address(call.to, "reconciler-rpc-batch-call-address"),
        data: data(call.data, "reconciler-rpc-batch-call-data"),
      }));
      if (validatedCalls.length === 0) {
        return Object.freeze([]);
      }
      const physicalCount = Math.ceil(
        validatedCalls.length / maximumBatchSize,
      );
      reserve(physicalCount, validatedCalls.length);
      const results: Hex[] = [];
      for (
        let offset = 0;
        offset < validatedCalls.length;
        offset += maximumBatchSize
      ) {
        const chunk = validatedCalls.slice(offset, offset + maximumBatchSize);
        const requestsForBatch = chunk.map((call) => allocateRequest(
          "eth_call",
          [
            call,
            { blockHash: exactHash, requireCanonical: true },
          ],
        ));
        const batchResults = await rpcBatch(requestsForBatch, signal);
        for (const result of batchResults) {
          results.push(data(result, "reconciler-rpc-batch-call-result"));
        }
      }
      return Object.freeze(results);
    },
    async getCodeHash({ address: contractAddress, blockHash, signal }) {
      const code = data(
        await rpc(
          "eth_getCode",
          [
            getAddress(contractAddress),
            {
              blockHash: canonicalBytes32(blockHash),
              requireCanonical: true,
            },
          ],
          signal,
        ),
        "reconciler-rpc-code",
      );
      if (code === "0x") {
        throw validationError("rpc", "reconciler-rpc-code-empty");
      }
      return keccak256(code);
    },
    async getLogs({
      addresses,
      topics,
      fromBlock,
      toBlock,
      maximumLogs,
      signal,
    }) {
      if (
        fromBlock < 0n ||
        toBlock < fromBlock ||
        !Number.isSafeInteger(maximumLogs) ||
        maximumLogs < 1 ||
        maximumLogs > 100_000
      ) {
        throw invalidInput("rpc", "reconciler-log-request");
      }
      const exactAddresses = Array.isArray(addresses)
        ? addresses.map((item) => getAddress(item))
        : getAddress(addresses as Address);
      const readRange = async (
        rangeFromBlock: bigint,
        rangeToBlock: bigint,
      ): Promise<readonly ExactBlockRpcLog[]> => {
        try {
          const result = await rpc(
            "eth_getLogs",
            [{
              address: exactAddresses,
              fromBlock: quantity(rangeFromBlock),
              toBlock: quantity(rangeToBlock),
              ...(topics ? { topics } : {}),
            }],
            signal,
          );
          if (!Array.isArray(result) || result.length > maximumLogs) {
            throw dataPipelineError({
              dependency: "rpc",
              code: "response_oversize",
              retryable: false,
              countsTowardCircuit: true,
              metadata: { operation: "reconciler-rpc-log-count" },
            });
          }
          const logs = result.map((raw) =>
            decodeRpcLog(raw, "reconciler-rpc-log")
          );
          if (logs.some((log) =>
            log.blockNumber < rangeFromBlock ||
            log.blockNumber > rangeToBlock
          )) {
            throw validationError("rpc", "reconciler-rpc-log-block-range");
          }
          assertCanonicalLogOrder(logs, "reconciler-rpc-log-order");
          return Object.freeze(logs);
        } catch (error) {
          if (!isSplittableLogFailure(error)) throw error;
          if (rangeFromBlock === rangeToBlock) {
            throw dataPipelineError({
              dependency: "rpc",
              code: "response_oversize",
              retryable: false,
              countsTowardCircuit: true,
              metadata: {
                operation: "reconciler-rpc-log-single-block-oversize",
              },
            });
          }
          const midpoint = rangeFromBlock +
            (rangeToBlock - rangeFromBlock) / 2n;
          const left = await readRange(rangeFromBlock, midpoint);
          const right = await readRange(midpoint + 1n, rangeToBlock);
          const merged = Object.freeze([...left, ...right]);
          assertCanonicalLogOrder(
            merged,
            "reconciler-rpc-log-split-order",
          );
          return merged;
        }
      };
      return readRange(fromBlock, toBlock);
    },
    async getBlockTimestamp({ blockNumber, expectedHash, signal }) {
      const block = await readBlock(blockNumber, signal);
      if (expectedHash && block.hash !== canonicalBytes32(expectedHash)) {
        throw validationError("rpc", "reconciler-rpc-block-hash-mismatch");
      }
      return block.timestamp;
    },
    async getBlockTimestamps({ blocks, signal }) {
      assertNotAborted(signal);
      if (!Array.isArray(blocks)) {
        throw invalidInput("rpc", "reconciler-rpc-block-timestamps");
      }
      const bindings = blocks.map((binding) => {
        if (binding.blockNumber < 0n) {
          throw invalidInput("rpc", "reconciler-rpc-block-timestamp-number");
        }
        return Object.freeze({
          blockNumber: binding.blockNumber,
          expectedHash: binding.expectedHash === undefined
            ? undefined
            : canonicalBytes32(binding.expectedHash),
        });
      });
      if (bindings.length === 0) return Object.freeze([]);
      reserve(Math.ceil(bindings.length / maximumBatchSize), bindings.length);
      const timestamps: bigint[] = [];
      for (
        let offset = 0;
        offset < bindings.length;
        offset += maximumBatchSize
      ) {
        const chunk = bindings.slice(offset, offset + maximumBatchSize);
        const requestsForBatch = chunk.map((binding) => allocateRequest(
          "eth_getBlockByNumber",
          [quantity(binding.blockNumber), false],
        ));
        const results = await rpcBatch(requestsForBatch, signal);
        for (let index = 0; index < results.length; index += 1) {
          const binding = chunk[index]!;
          const block = decodeBlock(results[index], binding.blockNumber);
          if (
            binding.expectedHash !== undefined &&
            block.hash !== binding.expectedHash
          ) {
            throw validationError(
              "rpc",
              "reconciler-rpc-block-hash-mismatch",
            );
          }
          timestamps.push(block.timestamp);
        }
      }
      return Object.freeze(timestamps);
    },
    async getTransactionReceipt({
      transactionHash,
      expectedBlockNumber,
      expectedBlockHash,
      signal,
    }) {
      const binding = validateReceiptBinding({
        transactionHash,
        expectedBlockNumber,
        expectedBlockHash,
      });
      return decodeReceipt(
        await rpc(
          "eth_getTransactionReceipt",
          [binding.transactionHash],
          signal,
        ),
        binding,
      );
    },
    async getTransactionReceipts({ receipts, signal }) {
      assertNotAborted(signal);
      if (!Array.isArray(receipts)) {
        throw invalidInput("rpc", "reconciler-rpc-receipts");
      }
      const bindings = receipts.map(validateReceiptBinding);
      if (bindings.length === 0) {
        return Object.freeze([]);
      }
      reserve(Math.ceil(bindings.length / maximumBatchSize), bindings.length);
      const resolved: ExactBlockRpcReceipt[] = [];
      for (
        let offset = 0;
        offset < bindings.length;
        offset += maximumBatchSize
      ) {
        const chunk = bindings.slice(offset, offset + maximumBatchSize);
        const requestsForBatch = chunk.map((binding) => allocateRequest(
          "eth_getTransactionReceipt",
          [binding.transactionHash],
        ));
        const results = await rpcBatch(requestsForBatch, signal);
        for (let index = 0; index < results.length; index += 1) {
          resolved.push(decodeReceipt(results[index], chunk[index]!));
        }
      }
      return Object.freeze(resolved);
    },
    async getTransaction({
      transactionHash,
      expectedBlockNumber,
      expectedBlockHash,
      expectedTo,
      signal,
    }) {
      const binding = validateTransactionBinding({
        transactionHash,
        expectedBlockNumber,
        expectedBlockHash,
        expectedTo,
      });
      return decodeTransaction(
        await rpc(
          "eth_getTransactionByHash",
          [binding.transactionHash],
          signal,
        ),
        binding,
      );
    },
    async getTransactions({ transactions, signal }) {
      assertNotAborted(signal);
      if (!Array.isArray(transactions)) {
        throw invalidInput("rpc", "reconciler-rpc-transactions");
      }
      const bindings = transactions.map(validateTransactionBinding);
      if (bindings.length === 0) {
        return Object.freeze([]);
      }
      reserve(Math.ceil(bindings.length / maximumBatchSize), bindings.length);
      const resolved: ExactBlockRpcTransaction[] = [];
      for (
        let offset = 0;
        offset < bindings.length;
        offset += maximumBatchSize
      ) {
        const chunk = bindings.slice(offset, offset + maximumBatchSize);
        const requestsForBatch = chunk.map((binding) => allocateRequest(
          "eth_getTransactionByHash",
          [binding.transactionHash],
        ));
        const results = await rpcBatch(requestsForBatch, signal);
        for (let index = 0; index < results.length; index += 1) {
          resolved.push(decodeTransaction(results[index], chunk[index]!));
        }
      }
      return Object.freeze(resolved);
    },
  });
}

export type ExactBlockRouteBuilder = (input: {
  rpc: ExactBlockRpcClient;
  contract: ReconcilerPreParityContract;
  blockNumber: bigint;
  blockHash: HexBytes32;
  signal: AbortSignal;
}) => Promise<readonly ReconcilerRouteDto[]>;

function endpointConfigurations(env: Environment) {
  const values = [
    {
      vendor: "alchemy" as const,
      endpoint: canonicalProjectorRpcEndpoint(
        env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL,
        "alchemy",
      ),
    },
    {
      vendor: "quicknode" as const,
      endpoint: canonicalProjectorRpcEndpoint(
        env.PROGRAMMABLE_QUICKNODE_MAINNET_RPC_URL,
        "quicknode",
      ),
    },
  ];
  if (new URL(values[0]!.endpoint).origin === new URL(values[1]!.endpoint).origin) {
    throw invalidInput("config", "reconciler-rpc-provider-independence");
  }
  return values.map((value) => Object.freeze({
    ...value,
    endpointCommitment: projectorRpcDeploymentCommitment(value.endpoint),
    endpointOriginCommitment: rpcProviderCommitment(
      "origin",
      new URL(value.endpoint).origin,
    ),
  }));
}

function sourceEndpoint(
  configurations: ReturnType<typeof endpointConfigurations>,
  source: ReconcilerLiveSource,
) {
  const match = configurations.find((candidate) =>
    candidate.vendor === source.vendorGroup &&
    candidate.endpointCommitment === source.endpointCommitment &&
    candidate.endpointOriginCommitment === source.endpointOriginCommitment
  );
  if (!match) {
    throw invalidInput("rpc", "reconciler-live-source-binding");
  }
  return match;
}

export function createExactBlockReconcilerRouteDtoReader(input: {
  env?: Environment;
  indexedStore: ReconcilerIndexedRouteStore;
  buildLiveRoutes: ExactBlockRouteBuilder;
  fetch?: Fetch;
  maximumRequestsPerProvider?: number;
  maximumLogicalRequestsPerProvider?: number;
  maximumBatchSize?: number;
  timeoutMs?: number;
}): ReconcilerRouteDtoReader {
  const configurations = endpointConfigurations(input.env ?? process.env);
  return Object.freeze({
    async readLiveRoutes({
      source,
      contract,
      blockNumber,
      blockHash,
      signal,
    }) {
      const configuration = sourceEndpoint(configurations, source);
      const rpc = createExactBlockRpcClient({
        endpoint: configuration.endpoint,
        endpointCommitment: configuration.endpointCommitment,
        endpointOriginCommitment: configuration.endpointOriginCommitment,
        fetch: input.fetch,
        maximumRequests: input.maximumRequestsPerProvider,
        maximumLogicalRequests: input.maximumLogicalRequestsPerProvider,
        maximumBatchSize: input.maximumBatchSize,
        timeoutMs: input.timeoutMs,
      });
      await rpc.assertCheckpoint({ blockNumber, blockHash, signal });
      const routes = await input.buildLiveRoutes({
        rpc,
        contract,
        blockNumber,
        blockHash,
        signal,
      });
      const byKey = new Map(routes.map((route) => [route.routeKey, route]));
      if (byKey.size !== routes.length) {
        throw validationError("rpc", "reconciler-live-route-duplicate");
      }
      const selected = contract.routeKeys.map((routeKey) => {
        const route = byKey.get(routeKey);
        if (!route) {
          throw validationError("rpc", "reconciler-live-route-missing");
        }
        return route;
      });
      // A canonicality change while logs or EIP-1898 calls were in flight must
      // invalidate the whole source read, not merely the affected entity.
      await rpc.assertCheckpoint({ blockNumber, blockHash, signal });
      return Object.freeze(selected);
    },
    readIndexedRoutes({ contract, signal }) {
      return input.indexedStore.readExactIndexedRouteCorpus({
        contract,
        maximumEntityCount: 10_000,
        signal,
      });
    },
  });
}
