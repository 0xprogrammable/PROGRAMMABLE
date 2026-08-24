import "server-only";

import type { Hex } from "viem";

import type {
  PredictionV2ReadCall,
  PredictionV2RpcCallRevert,
  PredictionV2RpcReader,
  PredictionV2SafeBlock,
} from "./read-model-v2.server";
import type { PredictionV2ResolutionRpcQuorum } from
  "./resolution-proof-v2.server";
import {
  bindPredictionV2RpcProvider,
  createPredictionV2RpcReader,
  PREDICTION_V2_RPC_CHAIN_ID,
  PREDICTION_V2_RPC_LIMITS,
  type PredictionV2RpcProviderBindingInput,
  type PredictionV2RpcBindingProjection,
  type PredictionV2RpcCodeRequest,
  type PredictionV2RpcExecutionCall,
  type PredictionV2RpcReaderDependencies,
  type PredictionV2RpcStorageRequest,
  type PredictionV2RpcTransportReader,
  type PredictionV2RpcVendorGroup,
  predictionV2RpcBindingProjection,
} from "./rpc-reader-v2.server";

type Environment = Readonly<Record<string, string | undefined>>;

export const PREDICTION_V2_RPC_ENV = Object.freeze({
  primaryProviderId:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_PRIMARY_PROVIDER_ID",
  primaryProviderCommitment:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_PRIMARY_PROVIDER_COMMITMENT",
  primaryVendorGroup:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_PRIMARY_VENDOR_GROUP",
  primaryVendorCommitment:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_PRIMARY_VENDOR_COMMITMENT",
  primaryUrl:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_PRIMARY_URL",
  primaryEndpointCommitment:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_PRIMARY_ENDPOINT_COMMITMENT",
  secondaryProviderId:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_SECONDARY_PROVIDER_ID",
  secondaryProviderCommitment:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_SECONDARY_PROVIDER_COMMITMENT",
  secondaryVendorGroup:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_SECONDARY_VENDOR_GROUP",
  secondaryVendorCommitment:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_SECONDARY_VENDOR_COMMITMENT",
  secondaryUrl:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_SECONDARY_URL",
  secondaryEndpointCommitment:
    "PROGRAMMABLE_PREDICTION_V2_SETTLEMENT_RPC_SECONDARY_ENDPOINT_COMMITMENT",
} as const);

export const PREDICTION_V2_ACTION_CONFIRMATION_DEPTH = 3n;
export const PREDICTION_V2_ACTION_SNAPSHOT_NEGOTIATION_RPC_LOGICAL_CALLS = 6;
export const
  PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS = 2;
export const PREDICTION_V2_MAXIMUM_CONFIRMATION_DEPTH = 64n;
export const PREDICTION_V2_MAXIMUM_HEAD_DIVERGENCE = 30n;
export const PREDICTION_V2_ACTION_MAXIMUM_BLOCK_AGE_SECONDS = 60n;
export const PREDICTION_V2_SAFE_MAXIMUM_BLOCK_AGE_SECONDS = 15n * 60n;
export const PREDICTION_V2_MAXIMUM_FUTURE_SKEW_SECONDS = 30n;

export type PredictionV2RpcSnapshotPolicy =
  | Readonly<{ kind: "safe" }>
  | Readonly<{
      kind: "action";
      confirmationDepth: bigint;
    }>;

declare const PREDICTION_V2_RPC_QUORUM_READERS: unique symbol;

export type PredictionV2RpcQuorumReader = Omit<
  PredictionV2RpcReader,
  "call"
> & Readonly<{
  getCode(request: PredictionV2RpcCodeRequest): Promise<Hex>;
  getStorageAt(request: PredictionV2RpcStorageRequest): Promise<Hex>;
  call(
    request: PredictionV2RpcExecutionCall,
  ): Promise<Hex | PredictionV2RpcCallRevert>;
}>;

export type PredictionV2RpcQuorumReaders<
  Kind extends PredictionV2RpcSnapshotPolicy["kind"] =
    PredictionV2RpcSnapshotPolicy["kind"],
> = readonly [
  PredictionV2RpcQuorumReader,
  PredictionV2RpcQuorumReader,
] & Readonly<{ [PREDICTION_V2_RPC_QUORUM_READERS]: Kind }>;

export type PredictionV2ActionRpcQuorumReaders =
  PredictionV2RpcQuorumReaders<"action">;

export type PredictionV2RpcTransportPair = readonly [
  PredictionV2RpcTransportReader,
  PredictionV2RpcTransportReader,
];

export type PredictionV2RpcQuorumBindingProjection = readonly [
  PredictionV2RpcBindingProjection<"primary">,
  PredictionV2RpcBindingProjection<"secondary">,
];

export type PredictionV2ActionRpcRuntimeProjection = Readonly<{
  chainId: typeof PREDICTION_V2_RPC_CHAIN_ID;
  snapshotPolicy: Readonly<{
    kind: "action";
    confirmationDepth: number;
  }>;
  transportPolicy: typeof PREDICTION_V2_RPC_LIMITS;
  providers: PredictionV2RpcQuorumBindingProjection;
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

export type PredictionV2RpcQuorumDependencies = Readonly<{
  primary?: PredictionV2RpcReaderDependencies;
  secondary?: PredictionV2RpcReaderDependencies;
  nowMs?: () => number;
}>;

export type PredictionV2RpcQuorumInput = Readonly<{
  bindings?: readonly [
    PredictionV2RpcProviderBindingInput,
    PredictionV2RpcProviderBindingInput,
  ];
  environment?: Environment;
  dependencies?: PredictionV2RpcQuorumDependencies;
  policy?: PredictionV2RpcSnapshotPolicy;
}>;

export class PredictionV2RpcQuorumError extends Error {
  readonly code:
    | "aborted"
    | "block-mismatch"
    | "config-unavailable"
    | "head-divergence"
    | "invalid-config"
    | "non-production-transport"
    | "providers-not-independent"
    | "quorum-unavailable"
    | "raw-result-mismatch"
    | "snapshot-lease-closed"
    | "snapshot-policy-mismatch"
    | "stale-snapshot"
    | "wrong-chain";

  constructor(code: PredictionV2RpcQuorumError["code"]) {
    super("Prediction V2 RPC quorum is unavailable");
    this.name = "PredictionV2RpcQuorumError";
    this.code = code;
  }

  toJSON() {
    return Object.freeze({ name: this.name, code: this.code });
  }
}

function fail(code: PredictionV2RpcQuorumError["code"]): never {
  throw new PredictionV2RpcQuorumError(code);
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
  role: "primary" | "secondary",
): PredictionV2RpcProviderBindingInput {
  const prefix = role === "primary" ? "primary" : "secondary";
  return Object.freeze({
    chainId: PREDICTION_V2_RPC_CHAIN_ID,
    providerId: required(
      environment,
      PREDICTION_V2_RPC_ENV[`${prefix}ProviderId`],
    ),
    providerCommitment: required(
      environment,
      PREDICTION_V2_RPC_ENV[`${prefix}ProviderCommitment`],
    ),
    vendorGroup: vendorGroup(required(
      environment,
      PREDICTION_V2_RPC_ENV[`${prefix}VendorGroup`],
    )),
    vendorCommitment: required(
      environment,
      PREDICTION_V2_RPC_ENV[`${prefix}VendorCommitment`],
    ),
    endpoint: required(
      environment,
      PREDICTION_V2_RPC_ENV[`${prefix}Url`],
    ),
    endpointCommitment: required(
      environment,
      PREDICTION_V2_RPC_ENV[`${prefix}EndpointCommitment`],
    ),
    batchMode: "batch",
  });
}

export function predictionV2RpcBindingsFromEnvironment(
  environment: Environment = process.env,
): readonly [
  PredictionV2RpcProviderBindingInput,
  PredictionV2RpcProviderBindingInput,
] {
  const bindings = Object.freeze([
    environmentBinding(environment, "primary"),
    environmentBinding(environment, "secondary"),
  ] as const);
  try {
    bindPredictionV2RpcProvider(bindings[0]);
    bindPredictionV2RpcProvider(bindings[1]);
  } catch {
    return fail("invalid-config");
  }
  return bindings;
}

function sameBlock(left: PredictionV2SafeBlock, right: PredictionV2SafeBlock) {
  return left.number === right.number &&
    left.hash.toLowerCase() === right.hash.toLowerCase() &&
    left.parentHash.toLowerCase() === right.parentHash.toLowerCase() &&
    left.timestamp === right.timestamp;
}

function assertIndependent(pair: PredictionV2RpcTransportPair) {
  const [primary, secondary] = pair.map(({ binding }) => binding) as [
    PredictionV2RpcTransportReader["binding"],
    PredictionV2RpcTransportReader["binding"],
  ];
  if (
    primary.providerId === secondary.providerId ||
    primary.providerCommitment === secondary.providerCommitment ||
    primary.vendorGroup === secondary.vendorGroup ||
    primary.vendorCommitment === secondary.vendorCommitment ||
    primary.endpointCommitment === secondary.endpointCommitment ||
    primary.endpointOriginCommitment === secondary.endpointOriginCommitment
  ) return fail("providers-not-independent");
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

async function commonSnapshot(
  pair: PredictionV2RpcTransportPair,
  policy: PredictionV2RpcSnapshotPolicy,
  nowMs: () => number,
  signal?: AbortSignal,
  historicalSnapshot?: PredictionV2ActionRpcHistoricalSnapshotV2,
): Promise<readonly [PredictionV2SafeBlock, PredictionV2SafeBlock]> {
  assertNotAborted(signal);
  const [primaryChainId, secondaryChainId] = await Promise.all([
    pair[0].getChainId(signal),
    pair[1].getChainId(signal),
  ]);
  if (
    primaryChainId !== PREDICTION_V2_RPC_CHAIN_ID ||
    secondaryChainId !== PREDICTION_V2_RPC_CHAIN_ID
  ) return fail("wrong-chain");
  let primaryHead: bigint;
  let secondaryHead: bigint;
  if (policy.kind === "safe") {
    const heads = await Promise.all([
      pair[0].getTaggedBlock("safe", signal),
      pair[1].getTaggedBlock("safe", signal),
    ]);
    primaryHead = heads[0].number;
    secondaryHead = heads[1].number;
  } else {
    [primaryHead, secondaryHead] = await Promise.all([
      pair[0].getLatestBlockNumber(signal),
      pair[1].getLatestBlockNumber(signal),
    ]);
  }
  assertNotAborted(signal);
  const lowerHead = primaryHead < secondaryHead ? primaryHead : secondaryHead;
  const upperHead = primaryHead > secondaryHead ? primaryHead : secondaryHead;
  if (upperHead - lowerHead > PREDICTION_V2_MAXIMUM_HEAD_DIVERGENCE) {
    return fail("head-divergence");
  }
  const confirmationDepth = policy.kind === "action"
    ? policy.confirmationDepth
    : 0n;
  if (lowerHead <= confirmationDepth) return fail("quorum-unavailable");
  const commonHeight = lowerHead - confirmationDepth;
  const blocks = await Promise.all([
    pair[0].getBlock(commonHeight, signal),
    pair[1].getBlock(commonHeight, signal),
  ]);
  assertNotAborted(signal);
  if (!blocks[0] || !blocks[1]) return fail("quorum-unavailable");
  if (!sameBlock(blocks[0], blocks[1])) return fail("block-mismatch");
  let observedAtMs: number;
  try {
    observedAtMs = nowMs();
  } catch {
    return fail("invalid-config");
  }
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs < 0) {
    return fail("invalid-config");
  }
  const observedAt = BigInt(Math.floor(observedAtMs / 1_000));
  const maximumAge = policy.kind === "action"
    ? PREDICTION_V2_ACTION_MAXIMUM_BLOCK_AGE_SECONDS
    : PREDICTION_V2_SAFE_MAXIMUM_BLOCK_AGE_SECONDS;
  if (
    blocks[0].timestamp >
      observedAt + PREDICTION_V2_MAXIMUM_FUTURE_SKEW_SECONDS ||
    observedAt > blocks[0].timestamp + maximumAge
  ) return fail("stale-snapshot");
  if (!historicalSnapshot) return Object.freeze([blocks[0], blocks[1]] as const);
  if (
    policy.kind !== "action" ||
    typeof historicalSnapshot !== "object" ||
    historicalSnapshot === null ||
    typeof historicalSnapshot.number !== "bigint" ||
    historicalSnapshot.number < 1n ||
    historicalSnapshot.number > commonHeight ||
    typeof historicalSnapshot.hash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/u.test(historicalSnapshot.hash) ||
    /^0x0{64}$/iu.test(historicalSnapshot.hash)
  ) return fail("block-mismatch");
  const historical = await Promise.all([
    pair[0].getBlock(historicalSnapshot.number, signal),
    pair[1].getBlock(historicalSnapshot.number, signal),
  ]);
  assertNotAborted(signal);
  if (
    !historical[0] || !historical[1] ||
    !sameBlock(historical[0], historical[1]) ||
    historical[0].hash.toLowerCase() !== historicalSnapshot.hash.toLowerCase()
  ) return fail("block-mismatch");
  if (
    historical[0].timestamp >
      observedAt + PREDICTION_V2_MAXIMUM_FUTURE_SKEW_SECONDS ||
    observedAt > historical[0].timestamp +
      PREDICTION_V2_ACTION_MAXIMUM_BLOCK_AGE_SECONDS
  ) return fail("stale-snapshot");
  return Object.freeze([historical[0], historical[1]] as const);
}

function quorumReaders(
  pair: PredictionV2RpcTransportPair,
  policy: PredictionV2RpcSnapshotPolicy,
  nowMs: () => number,
  productionTransport: boolean,
): PredictionV2RpcQuorumReaders {
  let unscopedSnapshotPromise:
    | Promise<readonly [PredictionV2SafeBlock, PredictionV2SafeBlock]>
    | undefined;
  const scopedSnapshots = new WeakMap<
    AbortSignal,
    Promise<readonly [PredictionV2SafeBlock, PredictionV2SafeBlock]>
  >();
  const snapshot = (signal?: AbortSignal) => {
    assertNotAborted(signal);
    const current = signal
      ? scopedSnapshots.get(signal)
      : unscopedSnapshotPromise;
    if (current) return current;
    const attempt = commonSnapshot(pair, policy, nowMs, signal);
    if (signal) scopedSnapshots.set(signal, attempt);
    else unscopedSnapshotPromise = attempt;
    const clear = () => {
      if (signal) {
        if (scopedSnapshots.get(signal) === attempt) {
          scopedSnapshots.delete(signal);
        }
      } else if (unscopedSnapshotPromise === attempt) {
        unscopedSnapshotPromise = undefined;
      }
    };
    void attempt.then(clear, clear);
    return attempt;
  };
  const wrap = (index: 0 | 1): PredictionV2RpcQuorumReader => Object.freeze({
    readerId: pair[index].readerId,
    getChainId(signal?: AbortSignal) {
      return pair[index].getChainId(signal);
    },
    async getSafeBlock(signal?: AbortSignal) {
      return (await snapshot(signal))[index];
    },
    getBlock(blockNumber: bigint, signal?: AbortSignal) {
      return pair[index].getBlock(blockNumber, signal);
    },
    getCode(request: PredictionV2RpcCodeRequest) {
      return pair[index].getCode(request);
    },
    getStorageAt(request: PredictionV2RpcStorageRequest) {
      return pair[index].getStorageAt(request);
    },
    call(request: PredictionV2RpcExecutionCall) {
      return pair[index].call(request);
    },
  });
  const readers = Object.freeze([wrap(0), wrap(1)] as const) as unknown as
    PredictionV2RpcQuorumReaders;
  RPC_QUORUM_RUNTIME_BY_READERS.set(
    readers,
    Object.freeze({ pair, policy, nowMs, productionTransport }),
  );
  return readers;
}

const RPC_QUORUM_RUNTIME_BY_READERS = new WeakMap<
  PredictionV2RpcQuorumReaders,
  Readonly<{
    pair: PredictionV2RpcTransportPair;
    policy: PredictionV2RpcSnapshotPolicy;
    nowMs: () => number;
    productionTransport: boolean;
  }>
>();

function actionRpcRuntime(
  readers: PredictionV2ActionRpcQuorumReaders,
) {
  const runtime = RPC_QUORUM_RUNTIME_BY_READERS.get(readers);
  if (runtime?.policy.kind !== "action") {
    return fail("snapshot-policy-mismatch");
  }
  return runtime as Readonly<{
    pair: PredictionV2RpcTransportPair;
    policy: Extract<PredictionV2RpcSnapshotPolicy, { kind: "action" }>;
    nowMs: () => number;
    productionTransport: boolean;
  }>;
}

type ActionRpcSnapshotLeaseRuntime = {
  closeController: AbortController;
  ownerSignal?: AbortSignal;
  pair: PredictionV2RpcTransportPair;
  policy: Extract<PredictionV2RpcSnapshotPolicy, { kind: "action" }>;
  snapshot: PredictionV2SafeBlock;
  quorum?: PredictionV2RpcQuorumReaders<"action">;
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
  if (runtime.closeController.signal.aborted) {
    return fail("snapshot-lease-closed");
  }
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

function snapshotLeaseQuorum(
  runtime: ActionRpcSnapshotLeaseRuntime,
): PredictionV2RpcQuorumReaders<"action"> {
  const wrap = (index: 0 | 1): PredictionV2RpcQuorumReader => Object.freeze({
    readerId: runtime.pair[index].readerId,
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
      return runtime.pair[index].getBlock(
        blockNumber,
        snapshotLeaseSignal(runtime, signal),
      );
    },
    getCode(request: PredictionV2RpcCodeRequest) {
      assertSnapshotLeaseRequest(runtime, request);
      const signal = snapshotLeaseSignal(runtime, request.signal);
      return runtime.pair[index].getCode(Object.freeze({
        ...request,
        signal,
      }));
    },
    getStorageAt(request: PredictionV2RpcStorageRequest) {
      assertSnapshotLeaseRequest(runtime, request);
      const signal = snapshotLeaseSignal(runtime, request.signal);
      return runtime.pair[index].getStorageAt(Object.freeze({
        ...request,
        signal,
      }));
    },
    call(request: PredictionV2RpcExecutionCall) {
      assertSnapshotLeaseRequest(runtime, request);
      const signal = snapshotLeaseSignal(runtime, request.signal);
      return runtime.pair[index].call(Object.freeze({
        ...request,
        signal,
      }));
    },
  });
  return Object.freeze([wrap(0), wrap(1)] as const) as unknown as
    PredictionV2RpcQuorumReaders<"action">;
}

export function createPredictionV2RpcTransportPair(input: Readonly<{
  bindings?: readonly [
    PredictionV2RpcProviderBindingInput,
    PredictionV2RpcProviderBindingInput,
  ];
  environment?: Environment;
  dependencies?: PredictionV2RpcQuorumDependencies;
}> = {}): PredictionV2RpcTransportPair {
  const bindings = input.bindings ??
    predictionV2RpcBindingsFromEnvironment(input.environment);
  let pair: PredictionV2RpcTransportPair;
  try {
    pair = Object.freeze([
      createPredictionV2RpcReader(
        bindings[0],
        input.dependencies?.primary,
      ),
      createPredictionV2RpcReader(
        bindings[1],
        input.dependencies?.secondary,
      ),
    ] as const);
  } catch (error) {
    if (error instanceof PredictionV2RpcQuorumError) throw error;
    return fail("invalid-config");
  }
  assertIndependent(pair);
  return pair;
}

export function predictionV2RpcQuorumBindingProjection(
  pair: PredictionV2RpcTransportPair,
): PredictionV2RpcQuorumBindingProjection {
  return Object.freeze([
    predictionV2RpcBindingProjection("primary", pair[0].binding),
    predictionV2RpcBindingProjection("secondary", pair[1].binding),
  ] as const);
}

/**
 * Secret-free runtime projection for signed-release matching. It is derived
 * only from the same factory-proven Action quorum later adapted for production
 * resolution; callers cannot supply the provider graph or policy separately.
 */
export function predictionV2ActionRpcRuntimeProjection(
  readers: PredictionV2ActionRpcQuorumReaders,
): PredictionV2ActionRpcRuntimeProjection {
  const runtime = actionRpcRuntime(readers);
  return Object.freeze({
    chainId: PREDICTION_V2_RPC_CHAIN_ID,
    snapshotPolicy: Object.freeze({
      kind: "action" as const,
      confirmationDepth: Number(runtime.policy.confirmationDepth),
    }),
    transportPolicy: Object.freeze({ ...PREDICTION_V2_RPC_LIMITS }),
    providers: predictionV2RpcQuorumBindingProjection(runtime.pair),
  });
}

/**
 * Production provenance boundary. Factory-made readers that inject a fetcher,
 * timeout or clock remain useful for deterministic tests, but they can never
 * satisfy a signed public-release session.
 */
export function assertPredictionV2ProductionActionRpcQuorum(
  readers: PredictionV2ActionRpcQuorumReaders,
): void {
  if (!actionRpcRuntime(readers).productionTransport) {
    return fail("non-production-transport");
  }
}

export function createPredictionV2RpcQuorum(
  input: PredictionV2RpcQuorumInput = {},
): PredictionV2RpcQuorumReaders {
  const bindings = input.bindings;
  const environment = input.environment;
  const dependencies = input.dependencies;
  const primaryDependencies = dependencies?.primary;
  const secondaryDependencies = dependencies?.secondary;
  const nowMsDependency = dependencies?.nowMs;
  const policy = normalizePolicy(input.policy ?? { kind: "safe" });
  return quorumReaders(
    createPredictionV2RpcTransportPair({
      ...(bindings ? { bindings } : {}),
      ...(environment ? { environment } : {}),
      ...(primaryDependencies || secondaryDependencies || nowMsDependency
        ? {
            dependencies: Object.freeze({
              ...(primaryDependencies
                ? { primary: primaryDependencies }
                : {}),
              ...(secondaryDependencies
                ? { secondary: secondaryDependencies }
                : {}),
              ...(nowMsDependency ? { nowMs: nowMsDependency } : {}),
            }),
          }
        : {}),
    }),
    policy,
    nowMsDependency ?? Date.now,
    primaryDependencies === undefined &&
      secondaryDependencies === undefined &&
      nowMsDependency === undefined,
  );
}

export function createPredictionV2ActionRpcQuorum(input: Omit<
  PredictionV2RpcQuorumInput,
  "policy"
> & Readonly<{ confirmationDepth?: bigint }> = {}):
PredictionV2ActionRpcQuorumReaders {
  return createPredictionV2RpcQuorum({
    ...input,
    policy: {
      kind: "action",
      confirmationDepth:
        input.confirmationDepth ?? PREDICTION_V2_ACTION_CONFIRMATION_DEPTH,
    },
  }) as PredictionV2ActionRpcQuorumReaders;
}

/**
 * Negotiates one immutable, factory-proven Action snapshot for a single
 * resolution/preparation operation. Every reader obtained from this lease is
 * pinned to the exact block number/hash until the owner closes the lease.
 */
export async function createPredictionV2ActionRpcSnapshotLease(
  readers: PredictionV2ActionRpcQuorumReaders,
  signal?: AbortSignal,
  historicalSnapshot?: PredictionV2ActionRpcHistoricalSnapshotV2,
): Promise<PredictionV2ActionRpcSnapshotLease> {
  assertNotAborted(signal);
  const actionRuntime = actionRpcRuntime(readers);
  const closeController = new AbortController();
  const creationSignal = signal
    ? AbortSignal.any([signal, closeController.signal])
    : closeController.signal;
  const blocks = await commonSnapshot(
    actionRuntime.pair,
    actionRuntime.policy,
    actionRuntime.nowMs,
    creationSignal,
    historicalSnapshot,
  );
  assertNotAborted(signal);
  const runtime: ActionRpcSnapshotLeaseRuntime = {
    closeController,
    ...(signal ? { ownerSignal: signal } : {}),
    pair: actionRuntime.pair,
    policy: actionRuntime.policy,
    snapshot: blocks[0],
  };
  runtime.quorum = snapshotLeaseQuorum(runtime);
  const lease = Object.freeze({
    schemaVersion: 1 as const,
    chainId: PREDICTION_V2_RPC_CHAIN_ID,
    snapshot: runtime.snapshot,
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

export function toPredictionV2ResolutionRpcQuorum(
  lease: PredictionV2ActionRpcSnapshotLease,
): PredictionV2ResolutionRpcQuorum {
  const runtime = snapshotLeaseRuntime(lease);
  const quorum = runtime.quorum;
  if (!quorum) return fail("snapshot-lease-closed");
  return Object.freeze({
    primary: quorum[0],
    secondary: quorum[1],
  });
}

export function toPredictionV2ActionRpcSnapshotQuorum(
  lease: PredictionV2ActionRpcSnapshotLease,
): PredictionV2RpcQuorumReaders<"action"> {
  const runtime = snapshotLeaseRuntime(lease);
  const quorum = runtime.quorum;
  if (!quorum) return fail("snapshot-lease-closed");
  return quorum;
}

/**
 * Revalidates an earlier canonical block against both independent providers
 * while the caller still owns the surrounding Action snapshot lease.
 */
export async function verifyPredictionV2CanonicalHistoricalBlockV2(
  lease: PredictionV2ActionRpcSnapshotLease,
  expected: Readonly<{
    number: bigint;
    hash: `0x${string}`;
  }>,
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
  assertIndependent(runtime.pair);
  const [primary, secondary] = await Promise.all([
    runtime.pair[0].getBlock(expected.number, operationSignal),
    runtime.pair[1].getBlock(expected.number, operationSignal),
  ]);
  snapshotLeaseSignal(runtime, signal);
  if (
    !primary || !secondary ||
    !sameBlock(primary, secondary) ||
    primary.hash.toLowerCase() !== expected.hash.toLowerCase()
  ) return fail("block-mismatch");
}

function canonicalOutcome(value: Hex | PredictionV2RpcCallRevert) {
  if (typeof value === "string") {
    return Object.freeze({ status: "success" as const, data: value.toLowerCase() });
  }
  return Object.freeze({
    status: "reverted" as const,
    data: value.data.toLowerCase(),
  });
}

/**
 * Action/preparation callers can use this boundary when they need one raw
 * value rather than the directory read model. No ABI decoding happens until
 * both independent readers agree on success/revert status and exact bytes.
 */
export async function readPredictionV2RawRpcQuorum(input: Readonly<{
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
  const readers = runtime.quorum;
  if (!readers) return fail("snapshot-lease-closed");
  if (
    readers[0] === readers[1] ||
    readers[0].readerId === readers[1].readerId
  ) return fail("providers-not-independent");
  assertSnapshotLeaseRequest(runtime, input.request);
  const request = Object.freeze({
    ...input.request,
    signal,
  });
  const outcomes = await Promise.all([
    readers[0].call(request),
    readers[1].call(request),
  ]);
  const [primaryCurrent, secondaryCurrent] = await Promise.all([
    readers[0].getBlock(runtime.snapshot.number, signal),
    readers[1].getBlock(runtime.snapshot.number, signal),
  ]);
  if (
    !primaryCurrent || !secondaryCurrent ||
    !sameBlock(primaryCurrent, secondaryCurrent) ||
    !sameBlock(runtime.snapshot, primaryCurrent)
  ) return fail("block-mismatch");
  const primary = canonicalOutcome(outcomes[0]);
  const secondary = canonicalOutcome(outcomes[1]);
  if (
    primary.status !== secondary.status || primary.data !== secondary.data
  ) return fail("raw-result-mismatch");
  if (primary.status === "reverted") {
    return Object.freeze({ status: "reverted" as const, data: primary.data as Hex });
  }
  return primary.data as Hex;
}
