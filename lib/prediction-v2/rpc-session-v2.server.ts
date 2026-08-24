import "server-only";

import type { Hex } from "viem";

import type {
  PredictionV2ReadCall,
  PredictionV2RpcCallRevert,
  PredictionV2RpcReader,
  PredictionV2SafeBlock,
} from "./read-model-v2.server";
import type { PredictionV2ResolutionRpcReader } from
  "./resolution-proof-v2.server";
import {
  bindPredictionV2RpcProvider,
  createPredictionV2RpcReader,
  PREDICTION_V2_RPC_CHAIN_ID,
  PREDICTION_V2_RPC_LIMITS,
  type PredictionV2RpcBindingProjection,
  type PredictionV2RpcCodeRequest,
  type PredictionV2RpcExecutionCall,
  type PredictionV2RpcProviderBindingInput,
  type PredictionV2RpcReaderDependencies,
  type PredictionV2RpcStorageRequest,
  type PredictionV2RpcTransportReader,
  type PredictionV2RpcVendorGroup,
  predictionV2RpcBindingProjection,
} from "./rpc-reader-v2.server";

type Environment = Readonly<Record<string, string | undefined>>;

export const PREDICTION_V2_RPC_ENV = Object.freeze({
  providerId: "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_PROVIDER_ID",
  providerCommitment:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_PROVIDER_COMMITMENT",
  vendorGroup: "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_VENDOR_GROUP",
  vendorCommitment:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_VENDOR_COMMITMENT",
  url: "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_URL",
  endpointCommitment:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_ENDPOINT_COMMITMENT",
} as const);

export const PREDICTION_V2_ACTION_CONFIRMATION_DEPTH = 3n;
export const PREDICTION_V2_ACTION_SNAPSHOT_NEGOTIATION_RPC_LOGICAL_CALLS = 3;
export const
  PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS = 1;
export const PREDICTION_V2_MAXIMUM_CONFIRMATION_DEPTH = 64n;
export const PREDICTION_V2_ACTION_MAXIMUM_BLOCK_AGE_SECONDS = 60n;
export const PREDICTION_V2_SAFE_MAXIMUM_BLOCK_AGE_SECONDS = 15n * 60n;
export const PREDICTION_V2_MAXIMUM_FUTURE_SKEW_SECONDS = 30n;

export type PredictionV2RpcSnapshotPolicy =
  | Readonly<{ kind: "safe" }>
  | Readonly<{
      kind: "action";
      confirmationDepth: bigint;
    }>;

declare const PREDICTION_V2_RPC_SESSION_READER: unique symbol;

export type PredictionV2RpcSessionReader<
  Kind extends PredictionV2RpcSnapshotPolicy["kind"] =
    PredictionV2RpcSnapshotPolicy["kind"],
> = Omit<PredictionV2RpcReader, "call"> & Readonly<{
  getCode(request: PredictionV2RpcCodeRequest): Promise<Hex>;
  getStorageAt(request: PredictionV2RpcStorageRequest): Promise<Hex>;
  call(
    request: PredictionV2RpcExecutionCall,
  ): Promise<Hex | PredictionV2RpcCallRevert>;
  readonly [PREDICTION_V2_RPC_SESSION_READER]: Kind;
}>;

export type PredictionV2ActionRpcSessionReader =
  PredictionV2RpcSessionReader<"action">;

export type PredictionV2RpcTransport = PredictionV2RpcTransportReader;

export type PredictionV2RpcSessionBindingProjection =
  PredictionV2RpcBindingProjection<"settlement">;

export type PredictionV2ActionRpcRuntimeProjection = Readonly<{
  chainId: typeof PREDICTION_V2_RPC_CHAIN_ID;
  snapshotPolicy: Readonly<{
    kind: "action";
    confirmationDepth: number;
  }>;
  transportPolicy: typeof PREDICTION_V2_RPC_LIMITS;
  provider: PredictionV2RpcSessionBindingProjection;
}>;

declare const PREDICTION_V2_ACTION_RPC_SNAPSHOT_LEASE: unique symbol;

export type PredictionV2ActionRpcSnapshotLease = Readonly<{
  schemaVersion: 1;
  chainId: typeof PREDICTION_V2_RPC_CHAIN_ID;
  snapshot: PredictionV2SafeBlock;
  snapshotPolicy: PredictionV2ActionRpcRuntimeProjection["snapshotPolicy"];
  close(): void;
  readonly [PREDICTION_V2_ACTION_RPC_SNAPSHOT_LEASE]: true;
}>;

export type PredictionV2ActionRpcHistoricalSnapshotV2 = Readonly<{
  number: bigint;
  hash: `0x${string}`;
}>;

export type PredictionV2RpcSessionDependencies = Readonly<{
  provider?: PredictionV2RpcReaderDependencies;
  nowMs?: () => number;
}>;

export type PredictionV2RpcSessionInput = Readonly<{
  binding?: PredictionV2RpcProviderBindingInput;
  environment?: Environment;
  dependencies?: PredictionV2RpcSessionDependencies;
  policy?: PredictionV2RpcSnapshotPolicy;
}>;

export class PredictionV2RpcSessionError extends Error {
  readonly code:
    | "aborted"
    | "block-mismatch"
    | "config-unavailable"
    | "invalid-config"
    | "non-production-transport"
    | "provider-unavailable"
    | "snapshot-lease-closed"
    | "snapshot-policy-mismatch"
    | "stale-snapshot"
    | "wrong-chain";

  constructor(code: PredictionV2RpcSessionError["code"]) {
    super("Prediction V2 RPC session is unavailable");
    this.name = "PredictionV2RpcSessionError";
    this.code = code;
  }

  toJSON() {
    return Object.freeze({ name: this.name, code: this.code });
  }
}

function fail(code: PredictionV2RpcSessionError["code"]): never {
  throw new PredictionV2RpcSessionError(code);
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) fail("aborted");
}

function required(environment: Environment, name: string) {
  const value = environment[name];
  if (typeof value !== "string" || value.length === 0) {
    return fail("config-unavailable");
  }
  return value;
}

function vendorGroup(value: string): PredictionV2RpcVendorGroup {
  if (value === "alchemy" || value === "drpc" || value === "quicknode") {
    return value;
  }
  return fail("invalid-config");
}

function environmentBinding(
  environment: Environment,
): PredictionV2RpcProviderBindingInput {
  return Object.freeze({
    chainId: PREDICTION_V2_RPC_CHAIN_ID,
    providerId: required(environment, PREDICTION_V2_RPC_ENV.providerId),
    providerCommitment: required(
      environment,
      PREDICTION_V2_RPC_ENV.providerCommitment,
    ),
    vendorGroup: vendorGroup(required(
      environment,
      PREDICTION_V2_RPC_ENV.vendorGroup,
    )),
    vendorCommitment: required(
      environment,
      PREDICTION_V2_RPC_ENV.vendorCommitment,
    ),
    endpoint: required(environment, PREDICTION_V2_RPC_ENV.url),
    endpointCommitment: required(
      environment,
      PREDICTION_V2_RPC_ENV.endpointCommitment,
    ),
    batchMode: "batch",
  });
}

export function predictionV2RpcBindingFromEnvironment(
  environment: Environment = process.env,
): PredictionV2RpcProviderBindingInput {
  const binding = environmentBinding(environment);
  try {
    bindPredictionV2RpcProvider(binding);
  } catch {
    return fail("invalid-config");
  }
  return binding;
}

function sameBlock(left: PredictionV2SafeBlock, right: PredictionV2SafeBlock) {
  return left.number === right.number &&
    left.hash.toLowerCase() === right.hash.toLowerCase() &&
    left.parentHash.toLowerCase() === right.parentHash.toLowerCase() &&
    left.timestamp === right.timestamp;
}

function normalizePolicy(
  value: PredictionV2RpcSnapshotPolicy,
): PredictionV2RpcSnapshotPolicy {
  if (value.kind === "safe") return Object.freeze({ kind: "safe" as const });
  if (
    value.kind !== "action" || typeof value.confirmationDepth !== "bigint" ||
    value.confirmationDepth < 1n ||
    value.confirmationDepth > PREDICTION_V2_MAXIMUM_CONFIRMATION_DEPTH
  ) return fail("invalid-config");
  return Object.freeze({
    kind: "action" as const,
    confirmationDepth: value.confirmationDepth,
  });
}

function observedAt(nowMs: () => number) {
  let value: number;
  try {
    value = nowMs();
  } catch {
    return fail("invalid-config");
  }
  if (!Number.isSafeInteger(value) || value < 0) return fail("invalid-config");
  return BigInt(Math.floor(value / 1_000));
}

function assertFreshSnapshot(
  block: PredictionV2SafeBlock,
  policy: PredictionV2RpcSnapshotPolicy,
  nowMs: () => number,
) {
  const now = observedAt(nowMs);
  const maximumAge = policy.kind === "action"
    ? PREDICTION_V2_ACTION_MAXIMUM_BLOCK_AGE_SECONDS
    : PREDICTION_V2_SAFE_MAXIMUM_BLOCK_AGE_SECONDS;
  if (
    block.timestamp > now + PREDICTION_V2_MAXIMUM_FUTURE_SKEW_SECONDS ||
    now > block.timestamp + maximumAge
  ) return fail("stale-snapshot");
}

async function sessionSnapshot(
  transport: PredictionV2RpcTransport,
  policy: PredictionV2RpcSnapshotPolicy,
  nowMs: () => number,
  signal?: AbortSignal,
  historicalSnapshot?: PredictionV2ActionRpcHistoricalSnapshotV2,
): Promise<PredictionV2SafeBlock> {
  assertNotAborted(signal);
  if (await transport.getChainId(signal) !== PREDICTION_V2_RPC_CHAIN_ID) {
    return fail("wrong-chain");
  }

  let block: PredictionV2SafeBlock | null;
  if (policy.kind === "safe") {
    block = await transport.getTaggedBlock("safe", signal);
  } else {
    const head = await transport.getLatestBlockNumber(signal);
    if (head <= policy.confirmationDepth) return fail("provider-unavailable");
    block = await transport.getBlock(head - policy.confirmationDepth, signal);
  }
  assertNotAborted(signal);
  if (!block) return fail("provider-unavailable");
  assertFreshSnapshot(block, policy, nowMs);

  if (!historicalSnapshot) return block;
  if (
    policy.kind !== "action" ||
    typeof historicalSnapshot !== "object" ||
    historicalSnapshot === null ||
    typeof historicalSnapshot.number !== "bigint" ||
    historicalSnapshot.number < 1n ||
    historicalSnapshot.number > block.number ||
    typeof historicalSnapshot.hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/u.test(historicalSnapshot.hash) ||
    /^0x0{64}$/iu.test(historicalSnapshot.hash)
  ) return fail("block-mismatch");
  const historical = await transport.getBlock(historicalSnapshot.number, signal);
  assertNotAborted(signal);
  if (
    !historical ||
    historical.hash.toLowerCase() !== historicalSnapshot.hash.toLowerCase()
  ) return fail("block-mismatch");
  assertFreshSnapshot(historical, policy, nowMs);
  return historical;
}

type RpcSessionRuntime = Readonly<{
  transport: PredictionV2RpcTransport;
  policy: PredictionV2RpcSnapshotPolicy;
  nowMs: () => number;
  productionTransport: boolean;
}>;

const RPC_SESSION_RUNTIME_BY_READER = new WeakMap<
  PredictionV2RpcSessionReader,
  RpcSessionRuntime
>();

function sessionReader(
  transport: PredictionV2RpcTransport,
  policy: PredictionV2RpcSnapshotPolicy,
  nowMs: () => number,
  productionTransport: boolean,
): PredictionV2RpcSessionReader {
  let unscopedSnapshotPromise: Promise<PredictionV2SafeBlock> | undefined;
  const scopedSnapshots = new WeakMap<AbortSignal, Promise<PredictionV2SafeBlock>>();
  const snapshot = (signal?: AbortSignal) => {
    assertNotAborted(signal);
    const current = signal ? scopedSnapshots.get(signal) : unscopedSnapshotPromise;
    if (current) return current;
    const attempt = sessionSnapshot(transport, policy, nowMs, signal);
    if (signal) scopedSnapshots.set(signal, attempt);
    else unscopedSnapshotPromise = attempt;
    const clear = () => {
      if (signal) {
        if (scopedSnapshots.get(signal) === attempt) scopedSnapshots.delete(signal);
      } else if (unscopedSnapshotPromise === attempt) {
        unscopedSnapshotPromise = undefined;
      }
    };
    void attempt.then(clear, clear);
    return attempt;
  };
  const reader = Object.freeze({
    readerId: transport.readerId,
    getChainId(signal?: AbortSignal) {
      return transport.getChainId(signal);
    },
    getSafeBlock(signal?: AbortSignal) {
      return snapshot(signal);
    },
    getBlock(blockNumber: bigint, signal?: AbortSignal) {
      return transport.getBlock(blockNumber, signal);
    },
    getCode(request: PredictionV2RpcCodeRequest) {
      return transport.getCode(request);
    },
    getStorageAt(request: PredictionV2RpcStorageRequest) {
      return transport.getStorageAt(request);
    },
    call(request: PredictionV2RpcExecutionCall) {
      return transport.call(request);
    },
  }) as unknown as PredictionV2RpcSessionReader;
  RPC_SESSION_RUNTIME_BY_READER.set(
    reader,
    Object.freeze({ transport, policy, nowMs, productionTransport }),
  );
  return reader;
}

function actionRpcRuntime(reader: PredictionV2ActionRpcSessionReader) {
  const runtime = RPC_SESSION_RUNTIME_BY_READER.get(reader);
  if (runtime?.policy.kind !== "action") return fail("snapshot-policy-mismatch");
  return runtime as Readonly<{
    transport: PredictionV2RpcTransport;
    policy: Extract<PredictionV2RpcSnapshotPolicy, { kind: "action" }>;
    nowMs: () => number;
    productionTransport: boolean;
  }>;
}

type ActionRpcSnapshotLeaseRuntime = {
  closeController: AbortController;
  ownerSignal?: AbortSignal;
  transport: PredictionV2RpcTransport;
  policy: Extract<PredictionV2RpcSnapshotPolicy, { kind: "action" }>;
  snapshot: PredictionV2SafeBlock;
  reader?: PredictionV2RpcSessionReader<"action">;
};

const ACTION_RPC_SNAPSHOT_LEASE_RUNTIME = new WeakMap<
  PredictionV2ActionRpcSnapshotLease,
  ActionRpcSnapshotLeaseRuntime
>();

function snapshotLeaseRuntime(lease: PredictionV2ActionRpcSnapshotLease) {
  const runtime = ACTION_RPC_SNAPSHOT_LEASE_RUNTIME.get(lease);
  if (!runtime || runtime.closeController.signal.aborted) {
    return fail("snapshot-lease-closed");
  }
  if (runtime.ownerSignal?.aborted) return fail("aborted");
  return runtime;
}

function snapshotLeaseSignal(
  runtime: ActionRpcSnapshotLeaseRuntime,
  signal?: AbortSignal,
) {
  assertNotAborted(signal);
  if (runtime.ownerSignal?.aborted) return fail("aborted");
  if (runtime.closeController.signal.aborted) return fail("snapshot-lease-closed");
  const signals = [
    runtime.closeController.signal,
    ...(runtime.ownerSignal ? [runtime.ownerSignal] : []),
    ...(signal ? [signal] : []),
  ];
  return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

function assertSnapshotLeaseRequest(
  runtime: ActionRpcSnapshotLeaseRuntime,
  request: Readonly<{ blockNumber: bigint; blockHash: `0x${string}` }>,
) {
  if (
    !request || typeof request !== "object" ||
    typeof request.blockNumber !== "bigint" ||
    typeof request.blockHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/u.test(request.blockHash) ||
    request.blockNumber !== runtime.snapshot.number ||
    request.blockHash.toLowerCase() !== runtime.snapshot.hash.toLowerCase()
  ) return fail("block-mismatch");
}

function snapshotLeaseReader(
  runtime: ActionRpcSnapshotLeaseRuntime,
): PredictionV2RpcSessionReader<"action"> {
  return Object.freeze({
    readerId: runtime.transport.readerId,
    async getChainId(signal?: AbortSignal) {
      snapshotLeaseSignal(runtime, signal);
      return PREDICTION_V2_RPC_CHAIN_ID;
    },
    async getSafeBlock(signal?: AbortSignal) {
      snapshotLeaseSignal(runtime, signal);
      return runtime.snapshot;
    },
    getBlock(blockNumber: bigint, signal?: AbortSignal) {
      if (blockNumber !== runtime.snapshot.number) return fail("block-mismatch");
      return runtime.transport.getBlock(blockNumber, snapshotLeaseSignal(runtime, signal));
    },
    getCode(request: PredictionV2RpcCodeRequest) {
      assertSnapshotLeaseRequest(runtime, request);
      return runtime.transport.getCode(Object.freeze({
        ...request,
        signal: snapshotLeaseSignal(runtime, request.signal),
      }));
    },
    getStorageAt(request: PredictionV2RpcStorageRequest) {
      assertSnapshotLeaseRequest(runtime, request);
      return runtime.transport.getStorageAt(Object.freeze({
        ...request,
        signal: snapshotLeaseSignal(runtime, request.signal),
      }));
    },
    call(request: PredictionV2RpcExecutionCall) {
      assertSnapshotLeaseRequest(runtime, request);
      return runtime.transport.call(Object.freeze({
        ...request,
        signal: snapshotLeaseSignal(runtime, request.signal),
      }));
    },
  }) as unknown as PredictionV2RpcSessionReader<"action">;
}

export function createPredictionV2RpcTransport(input: Readonly<{
  binding?: PredictionV2RpcProviderBindingInput;
  environment?: Environment;
  dependencies?: PredictionV2RpcSessionDependencies;
}> = {}): PredictionV2RpcTransport {
  const binding = input.binding ?? predictionV2RpcBindingFromEnvironment(input.environment);
  try {
    return createPredictionV2RpcReader(binding, input.dependencies?.provider);
  } catch (error) {
    if (error instanceof PredictionV2RpcSessionError) throw error;
    return fail("invalid-config");
  }
}

export function predictionV2RpcSessionBindingProjection(
  transport: PredictionV2RpcTransport,
): PredictionV2RpcSessionBindingProjection {
  return predictionV2RpcBindingProjection("settlement", transport.binding);
}

export function predictionV2ActionRpcRuntimeProjection(
  reader: PredictionV2ActionRpcSessionReader,
): PredictionV2ActionRpcRuntimeProjection {
  const runtime = actionRpcRuntime(reader);
  return Object.freeze({
    chainId: PREDICTION_V2_RPC_CHAIN_ID,
    snapshotPolicy: Object.freeze({
      kind: "action" as const,
      confirmationDepth: Number(runtime.policy.confirmationDepth),
    }),
    transportPolicy: Object.freeze({ ...PREDICTION_V2_RPC_LIMITS }),
    provider: predictionV2RpcSessionBindingProjection(runtime.transport),
  });
}

export function assertPredictionV2ProductionActionRpcSession(
  reader: PredictionV2ActionRpcSessionReader,
): void {
  const runtime = actionRpcRuntime(reader);
  if (!runtime.productionTransport) {
    return fail("non-production-transport");
  }
  if (runtime.policy.confirmationDepth !== PREDICTION_V2_ACTION_CONFIRMATION_DEPTH) {
    return fail("snapshot-policy-mismatch");
  }
}

export function createPredictionV2RpcSession(
  input: PredictionV2RpcSessionInput = {},
): PredictionV2RpcSessionReader {
  const providerDependencies = input.dependencies?.provider;
  const nowMsDependency = input.dependencies?.nowMs;
  const policy = normalizePolicy(input.policy ?? { kind: "safe" });
  return sessionReader(
    createPredictionV2RpcTransport({
      ...(input.binding ? { binding: input.binding } : {}),
      ...(input.environment ? { environment: input.environment } : {}),
      ...(input.dependencies ? { dependencies: input.dependencies } : {}),
    }),
    policy,
    nowMsDependency ?? Date.now,
    providerDependencies === undefined && nowMsDependency === undefined,
  );
}

export function createPredictionV2ActionRpcSession(input: Omit<
  PredictionV2RpcSessionInput,
  "policy"
> & Readonly<{ confirmationDepth?: bigint }> = {}):
PredictionV2ActionRpcSessionReader {
  return createPredictionV2RpcSession({
    ...input,
    policy: {
      kind: "action",
      confirmationDepth:
        input.confirmationDepth ?? PREDICTION_V2_ACTION_CONFIRMATION_DEPTH,
    },
  }) as PredictionV2ActionRpcSessionReader;
}

export async function createPredictionV2ActionRpcSnapshotLease(
  reader: PredictionV2ActionRpcSessionReader,
  signal?: AbortSignal,
  historicalSnapshot?: PredictionV2ActionRpcHistoricalSnapshotV2,
): Promise<PredictionV2ActionRpcSnapshotLease> {
  assertNotAborted(signal);
  const actionRuntime = actionRpcRuntime(reader);
  const closeController = new AbortController();
  const creationSignal = signal
    ? AbortSignal.any([signal, closeController.signal])
    : closeController.signal;
  const snapshot = await sessionSnapshot(
    actionRuntime.transport,
    actionRuntime.policy,
    actionRuntime.nowMs,
    creationSignal,
    historicalSnapshot,
  );
  assertNotAborted(signal);
  const runtime: ActionRpcSnapshotLeaseRuntime = {
    closeController,
    ...(signal ? { ownerSignal: signal } : {}),
    transport: actionRuntime.transport,
    policy: actionRuntime.policy,
    snapshot,
  };
  runtime.reader = snapshotLeaseReader(runtime);
  const lease = Object.freeze({
    schemaVersion: 1 as const,
    chainId: PREDICTION_V2_RPC_CHAIN_ID,
    snapshot,
    snapshotPolicy: Object.freeze({
      kind: "action" as const,
      confirmationDepth: Number(runtime.policy.confirmationDepth),
    }),
    close() {
      if (!closeController.signal.aborted) closeController.abort();
    },
  }) as unknown as PredictionV2ActionRpcSnapshotLease;
  ACTION_RPC_SNAPSHOT_LEASE_RUNTIME.set(lease, runtime);
  return lease;
}

export function toPredictionV2ResolutionRpcReader(
  lease: PredictionV2ActionRpcSnapshotLease,
): PredictionV2ResolutionRpcReader {
  const reader = snapshotLeaseRuntime(lease).reader;
  if (!reader) return fail("snapshot-lease-closed");
  return reader;
}

export function toPredictionV2ActionRpcSnapshotReader(
  lease: PredictionV2ActionRpcSnapshotLease,
): PredictionV2RpcSessionReader<"action"> {
  const reader = snapshotLeaseRuntime(lease).reader;
  if (!reader) return fail("snapshot-lease-closed");
  return reader;
}

export async function verifyPredictionV2CanonicalHistoricalBlockV2(
  lease: PredictionV2ActionRpcSnapshotLease,
  expected: Readonly<{ number: bigint; hash: `0x${string}` }>,
  signal?: AbortSignal,
): Promise<void> {
  const runtime = snapshotLeaseRuntime(lease);
  if (
    !expected || typeof expected !== "object" ||
    typeof expected.number !== "bigint" ||
    expected.number < 1n || expected.number > runtime.snapshot.number ||
    typeof expected.hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/u.test(expected.hash)
  ) return fail("block-mismatch");
  const operationSignal = snapshotLeaseSignal(runtime, signal);
  const current = await runtime.transport.getBlock(expected.number, operationSignal);
  snapshotLeaseSignal(runtime, signal);
  if (!current || current.hash.toLowerCase() !== expected.hash.toLowerCase()) {
    return fail("block-mismatch");
  }
}

export async function readPredictionV2RawRpc(input: Readonly<{
  lease: PredictionV2ActionRpcSnapshotLease;
  request: PredictionV2ReadCall;
  signal?: AbortSignal;
}>): Promise<Hex | PredictionV2RpcCallRevert> {
  const runtime = snapshotLeaseRuntime(input.lease);
  const callerSignals = [input.signal, input.request.signal].filter(
    (value): value is AbortSignal => value !== undefined,
  );
  const callerSignal = callerSignals.length > 1
    ? AbortSignal.any(callerSignals)
    : callerSignals[0];
  const signal = snapshotLeaseSignal(runtime, callerSignal);
  const reader = runtime.reader;
  if (!reader) return fail("snapshot-lease-closed");
  assertSnapshotLeaseRequest(runtime, input.request);
  const outcome = await reader.call(Object.freeze({ ...input.request, signal }));
  const current = await reader.getBlock(runtime.snapshot.number, signal);
  if (!current || !sameBlock(runtime.snapshot, current)) {
    return fail("block-mismatch");
  }
  if (typeof outcome === "string") return outcome.toLowerCase() as Hex;
  return Object.freeze({
    status: "reverted" as const,
    data: outcome.data.toLowerCase() as Hex,
  });
}
