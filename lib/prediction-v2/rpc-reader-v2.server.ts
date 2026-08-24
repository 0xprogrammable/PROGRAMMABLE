import "server-only";

import {
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";

import { rpcProviderCommitment } from
  "../data-pipeline/rpc-provider-commitments";
import type {
  PredictionV2ReadCall,
  PredictionV2RpcCallRevert,
  PredictionV2RpcReader,
  PredictionV2SafeBlock,
} from "./read-model-v2.server";

export const PREDICTION_V2_RPC_CHAIN_ID = 4_663 as const;

export const PREDICTION_V2_RPC_LIMITS = Object.freeze({
  maximumBatchCalls: 8,
  maximumCallDataBytes: 16_384,
  maximumLogicalCallsInFlight: 64,
  maximumPhysicalRequestsInFlight: 2,
  maximumRequestBytes: 131_072,
  maximumResponseBytes: 262_144,
  maximumRetries: 1,
  timeoutMs: 5_000,
} as const);

const JSON_RPC_VERSION = "2.0" as const;
const OFFICIAL_PUBLIC_ROBINHOOD_RPC_HOST =
  "rpc.mainnet.chain.robinhood.com";
const BYTES32 = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const DATA = /^0x(?:[0-9a-fA-F]{2})*$/u;
const QUANTITY = /^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/u;
const MAX_UINT256 = (1n << 256n) - 1n;
const COMMITMENT = /^0x[0-9a-f]{64}$/u;
const PROVIDER_ID = /^[a-z][a-z0-9-]{2,63}$/u;
const ALCHEMY_PATH = /^\/v2\/[A-Za-z0-9_-]{8,256}$/u;
const QUICKNODE_HOST =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.quiknode\.pro$/u;
const QUICKNODE_PATH = /^\/[A-Za-z0-9_-]{8,256}\/?$/u;
const DRPC_LIVE_PATH = /^\/robinhood\/[A-Za-z0-9_-]{8,512}\/?$/u;

const COMMITMENT_DOMAINS = Object.freeze({
  provider: "programmable:prediction-v2:rpc-provider:v1\0",
  vendor: "programmable:prediction-v2:rpc-vendor:v1\0",
} as const);

export type PredictionV2RpcVendorGroup =
  | "alchemy"
  | "drpc"
  | "quicknode";

export type PredictionV2RpcBatchMode = "batch" | "solo";

export type PredictionV2RpcCodeRequest = Readonly<{
  address: Address;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  requireCanonical: true;
  signal?: AbortSignal;
}>;

export type PredictionV2RpcStorageRequest = PredictionV2RpcCodeRequest &
  Readonly<{ slot: `0x${string}` }>;

export type PredictionV2RpcExecutionCall = PredictionV2ReadCall & Readonly<{
  from?: Address;
  value?: bigint;
}>;

export type PredictionV2RpcProviderBindingInput = Readonly<{
  chainId: typeof PREDICTION_V2_RPC_CHAIN_ID;
  providerId: string;
  providerCommitment: string;
  vendorGroup: PredictionV2RpcVendorGroup;
  vendorCommitment: string;
  endpoint: string;
  endpointCommitment: string;
  batchMode?: PredictionV2RpcBatchMode;
}>;

export type PredictionV2RpcProviderBinding = Readonly<{
  chainId: typeof PREDICTION_V2_RPC_CHAIN_ID;
  providerId: string;
  providerCommitment: Hex;
  vendorGroup: PredictionV2RpcVendorGroup;
  vendorCommitment: Hex;
  /** Server-only transport value. Deliberately non-enumerable at runtime. */
  endpoint: string;
  endpointCommitment: Hex;
  endpointOriginCommitment: Hex;
  batchMode: PredictionV2RpcBatchMode;
}>;

export type PredictionV2RpcBindingProjection<
  Role extends "primary" | "secondary" = "primary" | "secondary",
> = Readonly<{
  role: Role;
  providerId: string;
  providerCommitment: Hex;
  vendorGroup: PredictionV2RpcVendorGroup;
  vendorCommitment: Hex;
  endpointOriginCommitment: Hex;
  batchMode: PredictionV2RpcBatchMode;
}>;

type RpcBlockTag = "latest" | "safe";

export type PredictionV2RpcTransportReader = Omit<
  PredictionV2RpcReader,
  "call"
> & Readonly<{
  binding: PredictionV2RpcProviderBinding;
  getLatestBlockNumber(signal?: AbortSignal): Promise<bigint>;
  getTaggedBlock(
    tag: RpcBlockTag,
    signal?: AbortSignal,
  ): Promise<PredictionV2SafeBlock>;
  getCode(request: PredictionV2RpcCodeRequest): Promise<Hex>;
  getStorageAt(request: PredictionV2RpcStorageRequest): Promise<Hex>;
  call(
    request: PredictionV2RpcExecutionCall,
  ): Promise<Hex | PredictionV2RpcCallRevert>;
  callBatch(
    requests: readonly PredictionV2RpcExecutionCall[],
    signal?: AbortSignal,
  ): Promise<readonly (Hex | PredictionV2RpcCallRevert)[]>;
}>;

export type PredictionV2RpcReaderDependencies = Readonly<{
  fetcher?: typeof fetch;
  timeoutMs?: number;
}>;

type JsonRpcRequest = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  id: number;
  method: string;
  params: readonly unknown[];
}>;

type JsonRpcSuccess = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  id: number;
  result: unknown;
}>;

type JsonRpcFailure = Readonly<{
  jsonrpc: typeof JSON_RPC_VERSION;
  id: number;
  error: Readonly<{
    code: number;
    message: string;
    data?: unknown;
  }>;
}>;

type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

type PendingCall = {
  deadlineMs: number;
  request: PredictionV2RpcExecutionCall;
  release: () => void;
  resolve: (value: Hex | PredictionV2RpcCallRevert) => void;
  reject: (reason: unknown) => void;
};

export class PredictionV2RpcReaderError extends Error {
  readonly code:
    | "aborted"
    | "budget-exceeded"
    | "http-error"
    | "invalid-binding"
    | "invalid-request"
    | "malformed-response"
    | "rpc-error"
    | "timeout"
    | "transport-unavailable";

  constructor(code: PredictionV2RpcReaderError["code"]) {
    super("Prediction V2 RPC request failed");
    this.name = "PredictionV2RpcReaderError";
    this.code = code;
  }

  toJSON() {
    return Object.freeze({ name: this.name, code: this.code });
  }
}

function fail(
  code: PredictionV2RpcReaderError["code"],
): never {
  throw new PredictionV2RpcReaderError(code);
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) fail("aborted");
}

function assertBeforeDeadline(deadlineMs: number) {
  if (!Number.isFinite(deadlineMs) || performance.now() >= deadlineMs) {
    return fail("timeout");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactCommitment(value: string): Hex {
  if (!COMMITMENT.test(value)) return fail("invalid-binding");
  return value as Hex;
}

export function predictionV2RpcCommitment(
  scope: keyof typeof COMMITMENT_DOMAINS,
  value: string,
): Hex {
  return keccak256(toBytes(`${COMMITMENT_DOMAINS[scope]}${value}`));
}

function vendorEndpointMatches(
  parsed: URL,
  vendor: PredictionV2RpcVendorGroup,
) {
  if (vendor === "alchemy") {
    return parsed.hostname === "robinhood-mainnet.g.alchemy.com" &&
      parsed.search === "" && ALCHEMY_PATH.test(parsed.pathname) &&
      !parsed.pathname.endsWith("/docs-demo");
  }
  if (vendor === "quicknode") {
    return QUICKNODE_HOST.test(parsed.hostname) && parsed.search === "" &&
      QUICKNODE_PATH.test(parsed.pathname) &&
      parsed.pathname.replace(/^\//u, "").replace(/\/$/u, "") !==
        "docs-demo";
  }
  if (
    parsed.hostname === "lb.drpc.live" && parsed.search === "" &&
    DRPC_LIVE_PATH.test(parsed.pathname)
  ) return true;
  if (
    parsed.hostname !== "lb.drpc.org" || parsed.pathname !== "/ogrpc" ||
    parsed.searchParams.size !== 2 ||
    [...parsed.searchParams.keys()].some(
      (key) => key !== "network" && key !== "dkey",
    )
  ) return false;
  const network = parsed.searchParams.get("network");
  const key = parsed.searchParams.get("dkey") ?? "";
  return (network === "robinhood" || network === "robinhood-mainnet") &&
    /^[A-Za-z0-9_-]{8,512}$/u.test(key);
}

function strictEndpoint(
  value: string,
  vendor: PredictionV2RpcVendorGroup,
) {
  if (
    typeof value !== "string" || value.length < 1 || value.length > 1_024 ||
    value !== value.trim()
  ) return fail("invalid-binding");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail("invalid-binding");
  }
  if (
    parsed.protocol !== "https:" || parsed.username !== "" ||
    parsed.password !== "" || parsed.port !== "" || parsed.hash !== "" ||
    parsed.hostname === OFFICIAL_PUBLIC_ROBINHOOD_RPC_HOST ||
    !vendorEndpointMatches(parsed, vendor)
  ) return fail("invalid-binding");
  return parsed;
}

export function bindPredictionV2RpcProvider(
  input: PredictionV2RpcProviderBindingInput,
): PredictionV2RpcProviderBinding {
  if (
    !isRecord(input) || input.chainId !== PREDICTION_V2_RPC_CHAIN_ID ||
    !PROVIDER_ID.test(input.providerId) ||
    !["alchemy", "drpc", "quicknode"].includes(input.vendorGroup) ||
    (input.batchMode !== undefined && input.batchMode !== "batch" &&
      input.batchMode !== "solo")
  ) return fail("invalid-binding");
  const parsed = strictEndpoint(input.endpoint, input.vendorGroup);
  const endpoint = parsed.href;
  const providerCommitment = exactCommitment(input.providerCommitment);
  const vendorCommitment = exactCommitment(input.vendorCommitment);
  const endpointCommitment = exactCommitment(input.endpointCommitment);
  if (
    providerCommitment !==
      predictionV2RpcCommitment("provider", input.providerId) ||
    vendorCommitment !==
      predictionV2RpcCommitment("vendor", input.vendorGroup) ||
    endpointCommitment !== rpcProviderCommitment("endpoint", endpoint)
  ) return fail("invalid-binding");

  const binding = {
    chainId: PREDICTION_V2_RPC_CHAIN_ID,
    providerId: input.providerId,
    providerCommitment,
    vendorGroup: input.vendorGroup,
    vendorCommitment,
    endpointCommitment,
    endpointOriginCommitment: rpcProviderCommitment(
      "origin",
      parsed.origin.toLowerCase(),
    ),
    batchMode: input.batchMode ?? "batch",
  } as PredictionV2RpcProviderBinding;
  Object.defineProperty(binding, "endpoint", {
    value: endpoint,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return Object.freeze(binding);
}

/**
 * Secret-free release projection. Endpoint URLs and their credential-bound
 * commitments deliberately remain private transport configuration.
 */
export function predictionV2RpcBindingProjection<
  Role extends "primary" | "secondary",
>(
  role: Role,
  binding: PredictionV2RpcProviderBinding,
): PredictionV2RpcBindingProjection<Role> {
  return Object.freeze({
    role,
    providerId: binding.providerId,
    providerCommitment: binding.providerCommitment,
    vendorGroup: binding.vendorGroup,
    vendorCommitment: binding.vendorCommitment,
    endpointOriginCommitment: binding.endpointOriginCommitment,
    batchMode: binding.batchMode,
  });
}

function canonicalQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !QUANTITY.test(value)) {
    return fail("malformed-response");
  }
  return BigInt(value);
}

function canonicalBytes32(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !BYTES32.test(value)) {
    return fail("malformed-response");
  }
  return value.toLowerCase() as `0x${string}`;
}

function canonicalData(value: unknown): Hex {
  if (typeof value !== "string" || !DATA.test(value)) {
    return fail("malformed-response");
  }
  return value.toLowerCase() as Hex;
}

function normalizeBlock(
  value: unknown,
  expectedNumber?: bigint,
): PredictionV2SafeBlock | null {
  if (value === null) return null;
  if (!isRecord(value)) return fail("malformed-response");
  const number = canonicalQuantity(value.number);
  const timestamp = canonicalQuantity(value.timestamp);
  if (expectedNumber !== undefined && number !== expectedNumber) {
    return fail("malformed-response");
  }
  return Object.freeze({
    number,
    hash: canonicalBytes32(value.hash),
    parentHash: canonicalBytes32(value.parentHash),
    timestamp,
  });
}

function validJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  if (!isRecord(value) || value.jsonrpc !== JSON_RPC_VERSION ||
    !Number.isSafeInteger(value.id) || Number(value.id) < 1) return false;
  const hasResult = Object.hasOwn(value, "result");
  const hasError = Object.hasOwn(value, "error");
  if (hasResult === hasError) return false;
  if (hasResult) return true;
  return isRecord(value.error) && Number.isSafeInteger(value.error.code) &&
    typeof value.error.message === "string";
}

function deterministicRevertData(error: JsonRpcFailure["error"]): Hex | null {
  if (
    error.code !== 3 && error.code !== -32_000 && error.code !== -32_015
  ) return null;
  if (!/\b(?:execution\s+)?revert(?:ed)?\b/iu.test(error.message)) return null;
  const raw = typeof error.data === "string"
    ? error.data
    : isRecord(error.data) && typeof error.data.data === "string"
      ? error.data.data
      : null;
  return raw !== null && DATA.test(raw)
    ? raw.toLowerCase() as Hex
    : null;
}

function responseOutcome(
  response: JsonRpcResponse,
  allowDeterministicRevert: boolean,
): unknown {
  if ("result" in response) return response.result;
  if (allowDeterministicRevert) {
    const data = deterministicRevertData(response.error);
    if (data !== null) {
      return Object.freeze({ status: "reverted" as const, data });
    }
  }
  return fail("rpc-error");
}

function requestBodyBytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

async function readBoundedResponse(response: Response, signal?: AbortSignal) {
  assertNotAborted(signal);
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      BigInt(declaredLength) >
      BigInt(PREDICTION_V2_RPC_LIMITS.maximumResponseBytes))
  ) {
    await cancelResponseBody(response);
    return fail("budget-exceeded");
  }
  if (!response.body) return fail("malformed-response");
  const reader = response.body.getReader();
  const onAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    assertNotAborted(signal);
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const next = await reader.read();
      assertNotAborted(signal);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > PREDICTION_V2_RPC_LIMITS.maximumResponseBytes) {
        await reader.cancel();
        return fail("budget-exceeded");
      }
      chunks.push(next.value);
    }
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(joined);
    } catch {
      return fail("malformed-response");
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

async function cancelResponseBody(response: Response) {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort. The original bounded failure stays public.
  }
}

function validateCall(request: PredictionV2RpcExecutionCall) {
  if (
    !isRecord(request) || !ADDRESS.test(request.to) ||
    !DATA.test(request.data) ||
    (request.data.length - 2) / 2 >
      PREDICTION_V2_RPC_LIMITS.maximumCallDataBytes ||
    typeof request.blockNumber !== "bigint" || request.blockNumber < 1n ||
    !BYTES32.test(request.blockHash) || request.requireCanonical !== true ||
    (request.from !== undefined && !ADDRESS.test(request.from)) ||
    (request.value !== undefined &&
      (typeof request.value !== "bigint" || request.value < 0n ||
        request.value > MAX_UINT256)) ||
    (request.signal !== undefined && !(request.signal instanceof AbortSignal))
  ) return fail("invalid-request");
}

function callParams(request: PredictionV2RpcExecutionCall) {
  validateCall(request);
  return Object.freeze([
    Object.freeze({
      to: request.to,
      data: request.data,
      ...(request.from !== undefined ? { from: request.from } : {}),
      ...(request.value !== undefined
        ? { value: `0x${request.value.toString(16)}` }
        : {}),
    }),
    Object.freeze({
      blockHash: request.blockHash.toLowerCase(),
      requireCanonical: true,
    }),
  ] as const);
}

function codeParams(request: PredictionV2RpcCodeRequest) {
  if (
    !isRecord(request) || !ADDRESS.test(request.address) ||
    typeof request.blockNumber !== "bigint" || request.blockNumber < 1n ||
    !BYTES32.test(request.blockHash) || request.requireCanonical !== true ||
    (request.signal !== undefined && !(request.signal instanceof AbortSignal))
  ) return fail("invalid-request");
  return Object.freeze([
    request.address,
    Object.freeze({
      blockHash: request.blockHash.toLowerCase(),
      requireCanonical: true,
    }),
  ] as const);
}

function storageParams(request: PredictionV2RpcStorageRequest) {
  if (!isRecord(request) || !BYTES32.test(request.slot)) {
    return fail("invalid-request");
  }
  const [address, block] = codeParams(request);
  return Object.freeze([address, request.slot.toLowerCase(), block] as const);
}

function isRetriableStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function sharedSignal(pending: readonly PendingCall[]) {
  const signals = pending
    .map(({ request }) => request.signal)
    .filter((value): value is AbortSignal => value !== undefined);
  if (signals.length !== pending.length) return undefined;
  return signals.every((signal) => signal === signals[0])
    ? signals[0]
    : undefined;
}

class PhysicalRequestLimiter {
  readonly #waiters: Array<Readonly<{
    resolve: () => void;
    reject: (reason: unknown) => void;
    signal?: AbortSignal;
    onAbort?: () => void;
  }>> = [];
  #active = 0;

  async #acquire(signal?: AbortSignal) {
    assertNotAborted(signal);
    if (
      this.#active <
        PREDICTION_V2_RPC_LIMITS.maximumPhysicalRequestsInFlight
    ) {
      this.#active += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = this.#waiters.indexOf(waiter);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new PredictionV2RpcReaderError("aborted"));
      };
      const waiter = {
        resolve,
        reject,
        ...(signal ? { signal, onAbort } : {}),
      };
      this.#waiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  #release() {
    while (this.#waiters.length > 0) {
      const next = this.#waiters.shift()!;
      if (next.signal?.aborted) {
        if (next.onAbort) {
          next.signal.removeEventListener("abort", next.onAbort);
        }
        next.reject(new PredictionV2RpcReaderError("aborted"));
        continue;
      }
      if (next.signal && next.onAbort) {
        next.signal.removeEventListener("abort", next.onAbort);
      }
      next.resolve();
      return;
    }
    this.#active -= 1;
  }

  async run<Value>(operation: () => Promise<Value>, signal?: AbortSignal) {
    await this.#acquire(signal);
    try {
      assertNotAborted(signal);
      return await operation();
    } finally {
      this.#release();
    }
  }
}

class StrictPredictionV2RpcTransport {
  readonly #binding: PredictionV2RpcProviderBinding;
  readonly #fetcher: typeof fetch;
  readonly #limiter = new PhysicalRequestLimiter();
  readonly #timeoutMs: number;
  readonly #queue: PendingCall[] = [];
  #flushScheduled = false;
  #logicalCallsInFlight = 0;
  #nextId = 1;

  constructor(
    binding: PredictionV2RpcProviderBinding,
    dependencies: PredictionV2RpcReaderDependencies,
  ) {
    const timeoutMs = dependencies.timeoutMs ??
      PREDICTION_V2_RPC_LIMITS.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
      fail("invalid-binding");
    }
    this.#binding = binding;
    this.#fetcher = dependencies.fetcher ?? fetch;
    this.#timeoutMs = timeoutMs;
  }

  #acquireLogicalCalls(count: number) {
    if (
      !Number.isSafeInteger(count) || count < 1 ||
      this.#logicalCallsInFlight + count >
        PREDICTION_V2_RPC_LIMITS.maximumLogicalCallsInFlight
    ) return fail("budget-exceeded");
    this.#logicalCallsInFlight += count;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#logicalCallsInFlight -= count;
    };
  }

  #id() {
    if (this.#nextId >= Number.MAX_SAFE_INTEGER) return fail("budget-exceeded");
    return this.#nextId++;
  }

  async #post(
    payload: JsonRpcRequest | readonly JsonRpcRequest[],
    signal?: AbortSignal,
    deadlineMs = performance.now() + this.#timeoutMs,
  ): Promise<unknown> {
    assertNotAborted(signal);
    const body = JSON.stringify(payload);
    if (
      requestBodyBytes(body) > PREDICTION_V2_RPC_LIMITS.maximumRequestBytes
    ) return fail("budget-exceeded");

    const remainingMs = deadlineMs - performance.now();
    assertBeforeDeadline(deadlineMs);
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort(),
      remainingMs,
    );
    const requestSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;
    try {
      return await this.#limiter.run(async () => {
        assertBeforeDeadline(deadlineMs);
        for (
          let attempt = 0;
          attempt <= PREDICTION_V2_RPC_LIMITS.maximumRetries;
          attempt += 1
        ) {
          assertNotAborted(requestSignal);
          assertBeforeDeadline(deadlineMs);
          try {
            const response = await this.#fetcher(this.#binding.endpoint, {
              method: "POST",
              redirect: "error",
              headers: Object.freeze({
                accept: "application/json",
                "content-type": "application/json",
              }),
              body,
              signal: requestSignal,
            });
            assertNotAborted(requestSignal);
            assertBeforeDeadline(deadlineMs);
            if (!response.ok) {
              await cancelResponseBody(response);
              assertNotAborted(requestSignal);
              assertBeforeDeadline(deadlineMs);
              if (
                isRetriableStatus(response.status) &&
                attempt < PREDICTION_V2_RPC_LIMITS.maximumRetries
              ) continue;
              return fail("http-error");
            }
            const contentType = response.headers.get("content-type") ?? "";
            if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
              await cancelResponseBody(response);
              assertNotAborted(requestSignal);
              assertBeforeDeadline(deadlineMs);
              return fail("malformed-response");
            }
            const text = await readBoundedResponse(response, requestSignal);
            assertNotAborted(requestSignal);
            assertBeforeDeadline(deadlineMs);
            let parsed: unknown;
            try {
              parsed = JSON.parse(text) as unknown;
            } catch {
              return fail("malformed-response");
            }
            assertNotAborted(requestSignal);
            assertBeforeDeadline(deadlineMs);
            return parsed;
          } catch (error) {
            if (requestSignal.aborted) throw error;
            if (error instanceof PredictionV2RpcReaderError) throw error;
            if (attempt >= PREDICTION_V2_RPC_LIMITS.maximumRetries) {
              return fail("transport-unavailable");
            }
          }
        }
        return fail("transport-unavailable");
      }, requestSignal);
    } catch (error) {
      if (signal?.aborted) return fail("aborted");
      if (timeoutController.signal.aborted) return fail("timeout");
      if (error instanceof PredictionV2RpcReaderError) throw error;
      return fail("transport-unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  async request(
    method: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ) {
    const deadlineMs = performance.now() + this.#timeoutMs;
    const release = this.#acquireLogicalCalls(1);
    const request = Object.freeze({
      jsonrpc: JSON_RPC_VERSION,
      id: this.#id(),
      method,
      params,
    });
    try {
      const raw = await this.#post(request, signal, deadlineMs);
      if (!validJsonRpcResponse(raw) || raw.id !== request.id) {
        return fail("malformed-response");
      }
      const outcome = responseOutcome(raw, false);
      assertBeforeDeadline(deadlineMs);
      return outcome;
    } finally {
      release();
    }
  }

  async #requestCalls(
    pending: readonly PendingCall[],
    signal?: AbortSignal,
  ) {
    const requests = pending.map(({ request }) => Object.freeze({
      jsonrpc: JSON_RPC_VERSION,
      id: this.#id(),
      method: "eth_call",
      params: callParams(request),
    }));
    const useBatch = this.#binding.batchMode === "batch" && requests.length > 1;
    const payload = useBatch ? Object.freeze(requests) : requests[0]!;
    const deadlineMs = Math.min(...pending.map((item) => item.deadlineMs));
    const raw = await this.#post(payload, signal, deadlineMs);
    assertNotAborted(signal);
    assertBeforeDeadline(deadlineMs);
    const responses = useBatch ? raw : [raw];
    if (!Array.isArray(responses) || responses.length !== requests.length) {
      return fail("malformed-response");
    }
    const byId = new Map<number, JsonRpcResponse>();
    for (const response of responses) {
      if (!validJsonRpcResponse(response) || byId.has(response.id)) {
        return fail("malformed-response");
      }
      byId.set(response.id, response);
    }
    if (byId.size !== requests.length) return fail("malformed-response");
    const results = requests.map((request) => {
      const response = byId.get(request.id);
      if (!response) return fail("malformed-response");
      const result = responseOutcome(response, true);
      if (typeof result === "string") return canonicalData(result);
      if (
        isRecord(result) && result.status === "reverted" &&
        typeof result.data === "string"
      ) return result as PredictionV2RpcCallRevert;
      return fail("malformed-response");
    });
    assertBeforeDeadline(deadlineMs);
    return results;
  }

  async callBatch(
    requests: readonly PredictionV2RpcExecutionCall[],
    signal?: AbortSignal,
  ) {
    assertNotAborted(signal);
    if (
      !Array.isArray(requests) || requests.length < 1 ||
      requests.length > PREDICTION_V2_RPC_LIMITS.maximumBatchCalls
    ) return fail("budget-exceeded");
    for (const request of requests) validateCall(request);
    for (const request of requests) assertNotAborted(request.signal);
    const deadlineMs = performance.now() + this.#timeoutMs;
    const release = this.#acquireLogicalCalls(requests.length);
    const pending = requests.map((request) => ({
      deadlineMs,
      request,
      release: () => undefined,
      resolve: () => undefined,
      reject: () => undefined,
    }));
    try {
      const itemSignals = pending.flatMap(({ request }) =>
        request.signal ? [request.signal] : []
      );
      const signals = [
        ...(signal ? [signal] : []),
        ...itemSignals,
      ];
      const effectiveSignal = signals.length > 0
        ? AbortSignal.any(signals)
        : undefined;
      if (this.#binding.batchMode === "solo" && pending.length > 1) {
        const settled = await Promise.allSettled(
          pending.map(async (item) => (await this.#requestCalls(
            [item],
            effectiveSignal,
          ))[0]!),
        );
        const failure = settled.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        if (failure) throw failure.reason;
        return Object.freeze(settled.map((result) =>
          (result as PromiseFulfilledResult<Hex | PredictionV2RpcCallRevert>)
            .value
        ));
      }
      const results = await this.#requestCalls(pending, effectiveSignal);
      if (pending.some(({ request }) => request.signal?.aborted)) {
        return fail("aborted");
      }
      return Object.freeze(results);
    } finally {
      release();
    }
  }

  call(request: PredictionV2RpcExecutionCall) {
    validateCall(request);
    assertNotAborted(request.signal);
    const deadlineMs = performance.now() + this.#timeoutMs;
    const release = this.#acquireLogicalCalls(1);
    if (this.#binding.batchMode === "solo") {
      return this.#requestCalls([{
        deadlineMs,
        request,
        release,
        resolve: () => undefined,
        reject: () => undefined,
      }], request.signal).then(([value]) => value!).finally(release);
    }
    return new Promise<Hex | PredictionV2RpcCallRevert>((resolve, reject) => {
      this.#queue.push({ deadlineMs, request, release, resolve, reject });
      if (!this.#flushScheduled) {
        this.#flushScheduled = true;
        queueMicrotask(() => void this.#flush());
      }
    });
  }

  async #flush() {
    this.#flushScheduled = false;
    while (this.#queue.length > 0) {
      const pending = this.#queue.splice(
        0,
        PREDICTION_V2_RPC_LIMITS.maximumBatchCalls,
      );
      const nowMs = performance.now();
      const active = pending.filter(({ deadlineMs, request }) =>
        deadlineMs > nowMs && !request.signal?.aborted
      );
      for (const item of pending) {
        if (item.deadlineMs <= nowMs || item.request.signal?.aborted) {
          item.release();
          item.reject(new PredictionV2RpcReaderError(
            item.request.signal?.aborted ? "aborted" : "timeout",
          ));
        }
      }
      if (active.length === 0) continue;
      try {
        const results = await this.#requestCalls(active, sharedSignal(active));
        active.forEach((item, index) => {
          if (
            item.deadlineMs <= performance.now() ||
            item.request.signal?.aborted
          ) {
            item.release();
            item.reject(new PredictionV2RpcReaderError(
              item.request.signal?.aborted ? "aborted" : "timeout",
            ));
          } else {
            item.release();
            item.resolve(results[index]!);
          }
        });
      } catch (error) {
        active.forEach((item) => {
          item.release();
          item.reject(error);
        });
      }
    }
  }
}

function blockNumberParameter(blockNumber: bigint) {
  if (blockNumber < 0n) return fail("invalid-request");
  return `0x${blockNumber.toString(16)}` as const;
}

export function createPredictionV2RpcReader(
  input: PredictionV2RpcProviderBindingInput,
  dependencies: PredictionV2RpcReaderDependencies = {},
): PredictionV2RpcTransportReader {
  const binding = bindPredictionV2RpcProvider(input);
  const transport = new StrictPredictionV2RpcTransport(binding, dependencies);

  const getTaggedBlock = async (
    tag: RpcBlockTag,
    signal?: AbortSignal,
  ) => {
    if (tag !== "latest" && tag !== "safe") return fail("invalid-request");
    const block = normalizeBlock(await transport.request(
      "eth_getBlockByNumber",
      [tag, false],
      signal,
    ));
    if (!block) return fail("malformed-response");
    return block;
  };

  const reader = {
    binding,
    readerId:
      `${binding.providerId}:${binding.providerCommitment.slice(2, 18)}`,
    async getChainId(signal?: AbortSignal) {
      return Number(canonicalQuantity(await transport.request(
        "eth_chainId",
        [],
        signal,
      )));
    },
    async getLatestBlockNumber(signal?: AbortSignal) {
      return canonicalQuantity(await transport.request(
        "eth_blockNumber",
        [],
        signal,
      ));
    },
    getTaggedBlock,
    async getCode(request: PredictionV2RpcCodeRequest) {
      return canonicalData(await transport.request(
        "eth_getCode",
        codeParams(request),
        request.signal,
      ));
    },
    async getStorageAt(request: PredictionV2RpcStorageRequest) {
      return canonicalBytes32(await transport.request(
        "eth_getStorageAt",
        storageParams(request),
        request.signal,
      ));
    },
    async getSafeBlock(signal?: AbortSignal) {
      return getTaggedBlock("safe", signal);
    },
    async getBlock(blockNumber: bigint, signal?: AbortSignal) {
      return normalizeBlock(await transport.request(
        "eth_getBlockByNumber",
        [blockNumberParameter(blockNumber), false],
        signal,
      ), blockNumber);
    },
    call(request: PredictionV2ReadCall) {
      return transport.call(request);
    },
    callBatch(
      requests: readonly PredictionV2RpcExecutionCall[],
      signal?: AbortSignal,
    ) {
      return transport.callBatch(requests, signal);
    },
  } satisfies PredictionV2RpcTransportReader;
  return Object.freeze(reader);
}

export function predictionV2RpcBindingInput(input: Readonly<{
  providerId: string;
  vendorGroup: PredictionV2RpcVendorGroup;
  endpoint: string;
  batchMode?: PredictionV2RpcBatchMode;
}>): PredictionV2RpcProviderBindingInput {
  let canonicalEndpoint: string;
  try {
    canonicalEndpoint = new URL(input.endpoint).href;
  } catch {
    return fail("invalid-binding");
  }
  return Object.freeze({
    chainId: PREDICTION_V2_RPC_CHAIN_ID,
    providerId: input.providerId,
    providerCommitment: predictionV2RpcCommitment(
      "provider",
      input.providerId,
    ),
    vendorGroup: input.vendorGroup,
    vendorCommitment: predictionV2RpcCommitment(
      "vendor",
      input.vendorGroup,
    ),
    endpoint: canonicalEndpoint,
    endpointCommitment: rpcProviderCommitment(
      "endpoint",
      canonicalEndpoint,
    ),
    ...(input.batchMode ? { batchMode: input.batchMode } : {}),
  });
}
