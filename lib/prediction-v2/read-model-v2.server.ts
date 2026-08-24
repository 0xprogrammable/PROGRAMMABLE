import "server-only";

import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  predictionOnchainAssetKeyV2,
  type PredictionAssetIdentityV2,
  type PredictionBytes32V2,
} from "../prediction-market-assets-v2";
import {
  PREDICTION_V2_ASSET_REGISTRY_ABI,
  PREDICTION_V2_CHECKPOINT_ABI,
  PREDICTION_V2_FACTORY_ABI,
  PREDICTION_V2_POOL_MANAGER_STATE_ABI,
  PREDICTION_V2_VAULT_ABI,
  type PredictionV2PoolKey,
  type PredictionV2RegistrySnapshot,
} from "./abi";
import {
  bindPredictionV2MarketState,
  predictionV2PoolId,
  predictionV2PoolStateSlot,
  predictionV2YesProbabilityBps,
} from "./accounting";
import {
  decodePredictionV2MarketRecord,
  decodePredictionV2RegistrySnapshot,
  predictionV2RegistrySnapshotHash,
} from "./codec";

const PREDICTION_V2_CHAIN_ID = 4_663 as const;
const PREDICTION_V2_MAXIMUM_PAGE_SIZE = 24;
const PREDICTION_V2_MARKET_BATCH_SIZE = 4;
const PREDICTION_V2_MAXIMUM_DUAL_CALLS_IN_FLIGHT = 8;
const PREDICTION_V2_CUTOFF_BEFORE_OBSERVATION_SECONDS = 60n;
const PREDICTION_V2_PRICE_DECIMALS = 8n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/u;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

/**
 * Exact LifecycleHookV2 read closure from canonical V2 source commit
 * 2a6297b34a30aff3b945156d0dce94ff979861fd.
 */
export const PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "authorizedRouter",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "poolManager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "lifecycle",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "cutoff", type: "uint64" },
      { name: "registeredBlock", type: "uint64" },
      { name: "checkpoint", type: "address" },
      { name: "initialized", type: "bool" },
    ],
  },
] as const satisfies Abi;

/**
 * Exact Router-facing Factory read from canonical V2 source commit
 * 2a6297b34a30aff3b945156d0dce94ff979861fd.
 */
export const PREDICTION_V2_FACTORY_CANONICAL_READ_ABI = [
  {
    type: "function",
    name: "isCanonicalVault",
    stateMutability: "view",
    inputs: [
      { name: "vault", type: "address" },
      { name: "poolId", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const satisfies Abi;

/**
 * Exact ExecutionRouterV2 read closure from canonical V2 source commit
 * 2a6297b34a30aff3b945156d0dce94ff979861fd.
 */
export const PREDICTION_V2_EXECUTION_ROUTER_READ_ABI = [
  {
    type: "function",
    name: "factory",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "manager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "collateral",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const satisfies Abi;

export type PredictionV2SafeBlock = Readonly<{
  number: bigint;
  hash: PredictionBytes32V2;
  parentHash: PredictionBytes32V2;
  timestamp: bigint;
}>;

export type PredictionV2ReadCall = Readonly<{
  to: Address;
  data: Hex;
  blockNumber: bigint;
  blockHash: PredictionBytes32V2;
  requireCanonical: true;
  signal?: AbortSignal;
}>;

/**
 * A reader may return this only for a deterministic EVM execution revert. RPC
 * transport, timeout, malformed-response, and provider errors must reject the
 * promise so they remain global fail-closed failures.
 */
export type PredictionV2RpcCallRevert = Readonly<{
  status: "reverted";
  data: Hex;
}>;

/**
 * Provider-neutral, server-only boundary. Each implementation must obtain its
 * safe block independently; the read model accepts state only after the two
 * readers agree on the complete block identity and every raw eth_call result.
 * `call` must use the request's EIP-1898 `{ blockHash, requireCanonical }`
 * reference; `blockNumber` is retained only for diagnostics and assertions.
 */
export type PredictionV2RpcReader = Readonly<{
  readerId: string;
  getChainId(signal?: AbortSignal): Promise<number>;
  getSafeBlock(signal?: AbortSignal): Promise<PredictionV2SafeBlock>;
  getBlock(
    blockNumber: bigint,
    signal?: AbortSignal,
  ): Promise<PredictionV2SafeBlock | null>;
  call(request: PredictionV2ReadCall): Promise<Hex | PredictionV2RpcCallRevert>;
}>;

export type PredictionV2ReadBinding = Readonly<{
  factory: Address;
  assetRegistry: Address;
  poolManager: Address;
  hook: Address;
  collateral: Address;
  router: Address;
  deploymentBlock: bigint;
}>;

export type PredictionV2ReadCursor = Readonly<{
  schemaVersion: 2;
  blockNumber: bigint;
  blockHash: PredictionBytes32V2;
  marketCount: bigint;
  nextExclusiveIndex: bigint;
}>;

export type PredictionV2ProtocolState =
  | "OPEN"
  | "FINAL_YES"
  | "FINAL_NO"
  | "FINAL_INVALID";

export type PredictionV2CheckpointStatus = "AWAITING" | "FINAL" | "INVALID";

export type PredictionV2TradingPhase = "OPEN" | "CLOSED" | "FINAL";

export type PredictionV2TradabilityReason =
  | "tradable"
  | "market-final"
  | "cutoff-reached"
  | "checkpoint-unhealthy";

export type PredictionV2Lifecycle = Readonly<{
  protocolState: PredictionV2ProtocolState;
  checkpointStatus: PredictionV2CheckpointStatus;
  tradingPhase: PredictionV2TradingPhase;
  tradable: boolean;
  tradabilityReason: PredictionV2TradabilityReason;
  checkpointTradingHealthy: boolean;
  resolvedPrice: bigint;
}>;

export type PredictionV2ReadMarket = Readonly<{
  economicKey: PredictionBytes32V2;
  marketId: PredictionBytes32V2;
  assetKey: PredictionBytes32V2;
  registryRevision: bigint;
  registrySnapshotHash: PredictionBytes32V2;
  resolutionPolicyHash: PredictionBytes32V2;
  policyValidUntil: bigint;
  snapshotAssetCap: bigint;
  vault: Address;
  checkpoint: Address;
  yesToken: Address;
  noToken: Address;
  poolId: PredictionBytes32V2;
  poolKey: PredictionV2PoolKey;
  asset: Readonly<{
    identity: PredictionAssetIdentityV2;
    displaySymbol: string;
  }>;
  predicate: Readonly<{
    comparator: "greater-than-or-equal";
    threshold: bigint;
    observationTime: bigint;
    priceDecimals: number;
  }>;
  lifecycle: PredictionV2Lifecycle;
  deadlines: Readonly<{
    cutoff: bigint;
    resolutionDeadline: bigint;
    hardResolutionDeadline: bigint;
    fallbackRequestedAt: bigint;
    fallbackChallengeDeadline: bigint;
  }>;
  poolState: Readonly<{
    sqrtPriceX96: bigint;
    tick: number;
    poolManagerProtocolFee: number;
    lpFee: number;
    yesProbabilityBps: number;
  }>;
  accountedLiability: bigint;
}>;

export type PredictionV2QuarantinedMarket = Readonly<{
  index: bigint;
  economicKey: PredictionBytes32V2;
  code: "invalid-market-wiring";
}>;

export type PredictionV2DirectoryRead = Readonly<{
  schemaVersion: 2;
  chainId: typeof PREDICTION_V2_CHAIN_ID;
  snapshot: PredictionV2SafeBlock;
  marketCount: bigint;
  markets: readonly PredictionV2ReadMarket[];
  quarantined: readonly PredictionV2QuarantinedMarket[];
  nextCursor: PredictionV2ReadCursor | null;
}>;

type NormalizedBinding = PredictionV2ReadBinding;

class PredictionV2ReadModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictionV2ReadModelError";
  }
}

class PredictionV2MarketWiringError extends Error {
  constructor() {
    super("Prediction V2 market wiring is invalid");
    this.name = "PredictionV2MarketWiringError";
  }
}

class PredictionV2DeterministicCallRevert extends Error {
  constructor() {
    super("Prediction V2 contract read reverted deterministically");
    this.name = "PredictionV2DeterministicCallRevert";
  }
}

class PredictionV2DualCallLimiter {
  readonly #waiters: Array<() => void> = [];
  #active = 0;

  async run<Value>(operation: () => Promise<Value>, signal?: AbortSignal): Promise<Value> {
    signal?.throwIfAborted();
    if (this.#active >= PREDICTION_V2_MAXIMUM_DUAL_CALLS_IN_FLIGHT) {
      await new Promise<void>((resolve) => this.#waiters.push(resolve));
    } else {
      this.#active += 1;
    }
    try {
      signal?.throwIfAborted();
      return await operation();
    } finally {
      const next = this.#waiters.shift();
      if (next) next();
      else this.#active -= 1;
    }
  }
}

function fail(message: string): never {
  throw new PredictionV2ReadModelError(message);
}

function invalidMarket(): never {
  throw new PredictionV2MarketWiringError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonzeroAddress(value: unknown, label: string): Address {
  if (typeof value !== "string") return fail(`${label} is invalid`);
  let address: Address;
  try {
    address = getAddress(value);
  } catch {
    return fail(`${label} is invalid`);
  }
  if (address.toLowerCase() === ZERO_ADDRESS) return fail(`${label} is zero`);
  return address;
}

function nonzeroBytes32(value: unknown, label: string): PredictionBytes32V2 {
  if (
    typeof value !== "string" ||
    !BYTES32_PATTERN.test(value) ||
    value.toLowerCase() === ZERO_BYTES32
  ) return fail(`${label} is invalid`);
  return value.toLowerCase() as PredictionBytes32V2;
}

function exactHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !HEX_PATTERN.test(value)) {
    return fail(`${label} is not canonical hex`);
  }
  return value.toLowerCase() as Hex;
}

type NormalizedCallOutcome =
  | Readonly<{ status: "success"; data: Hex }>
  | Readonly<{ status: "reverted"; data: Hex }>;

function normalizeCallOutcome(value: unknown, label: string): NormalizedCallOutcome {
  if (typeof value === "string") {
    return Object.freeze({ status: "success", data: exactHex(value, label) });
  }
  const ownKeys = isRecord(value) ? Reflect.ownKeys(value) : [];
  if (
    !isRecord(value) ||
    ownKeys.some((key) => typeof key !== "string") ||
    (ownKeys as string[]).sort().join(",") !== "data,status" ||
    value.status !== "reverted"
  ) return fail(`${label} is invalid`);
  return Object.freeze({
    status: "reverted",
    data: exactHex(value.data, `${label} revert data`),
  });
}

function sameAddress(left: Address, right: Address) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameBytes32(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function normalizeBinding(binding: PredictionV2ReadBinding): NormalizedBinding {
  if (!isRecord(binding) || binding.deploymentBlock < 1n) {
    return fail("Prediction V2 read binding is invalid");
  }
  return Object.freeze({
    factory: nonzeroAddress(binding.factory, "Factory"),
    assetRegistry: nonzeroAddress(binding.assetRegistry, "Asset Registry"),
    poolManager: nonzeroAddress(binding.poolManager, "PoolManager"),
    hook: nonzeroAddress(binding.hook, "Hook"),
    collateral: nonzeroAddress(binding.collateral, "collateral"),
    router: nonzeroAddress(binding.router, "Router"),
    deploymentBlock: binding.deploymentBlock,
  });
}

function normalizeBlock(value: PredictionV2SafeBlock, label: string): PredictionV2SafeBlock {
  if (!isRecord(value) || value.number < 1n || value.timestamp < 0n) {
    return fail(`${label} block is invalid`);
  }
  return Object.freeze({
    number: value.number,
    hash: nonzeroBytes32(value.hash, `${label} block hash`),
    parentHash: nonzeroBytes32(value.parentHash, `${label} parent hash`),
    timestamp: value.timestamp,
  });
}

function assertSameBlock(
  primary: PredictionV2SafeBlock,
  secondary: PredictionV2SafeBlock,
) {
  if (!sameBlockIdentity(primary, secondary)) {
    fail("Prediction V2 RPCs disagree about the safe block");
  }
}

function sameBlockIdentity(
  primary: PredictionV2SafeBlock,
  secondary: PredictionV2SafeBlock,
) {
  return !(
    primary.number !== secondary.number ||
    !sameBytes32(primary.hash, secondary.hash) ||
    !sameBytes32(primary.parentHash, secondary.parentHash) ||
    primary.timestamp !== secondary.timestamp
  );
}

function normalizeCursor(value: PredictionV2ReadCursor): PredictionV2ReadCursor {
  const ownKeys = isRecord(value) ? Reflect.ownKeys(value) : [];
  if (
    !isRecord(value) ||
    ownKeys.some((key) => typeof key !== "string") ||
    (ownKeys as string[]).sort().join(",") !==
      "blockHash,blockNumber,marketCount,nextExclusiveIndex,schemaVersion" ||
    value.schemaVersion !== 2 ||
    value.blockNumber < 1n ||
    value.marketCount < 0n ||
    value.nextExclusiveIndex < 0n ||
    value.nextExclusiveIndex > value.marketCount
  ) return fail("Prediction V2 cursor is invalid");
  return Object.freeze({
    schemaVersion: 2,
    blockNumber: value.blockNumber,
    blockHash: nonzeroBytes32(value.blockHash, "cursor block hash"),
    marketCount: value.marketCount,
    nextExclusiveIndex: value.nextExclusiveIndex,
  });
}

export function predictionV2PageIndices(input: Readonly<{
  marketCount: bigint;
  limit: number;
  nextExclusiveIndex?: bigint;
}>) {
  if (input.marketCount < 0n) return fail("Prediction V2 market count is invalid");
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > PREDICTION_V2_MAXIMUM_PAGE_SIZE
  ) return fail("Prediction V2 page size must be between 1 and 24");
  const upperBound = input.nextExclusiveIndex ?? input.marketCount;
  if (upperBound < 0n || upperBound > input.marketCount) {
    return fail("Prediction V2 page cursor is outside the Factory range");
  }
  const pageSize = Number(
    upperBound < BigInt(input.limit) ? upperBound : BigInt(input.limit),
  );
  const indices = Array.from(
    { length: pageSize },
    (_, index) => upperBound - 1n - BigInt(index),
  );
  const nextExclusiveIndex = upperBound - BigInt(pageSize);
  return Object.freeze({
    indices: Object.freeze(indices),
    nextExclusiveIndex,
  });
}

function encodeCall(
  abi: Abi,
  functionName: string,
  args?: readonly unknown[],
): Hex {
  return encodeFunctionData({
    abi,
    functionName: functionName as never,
    ...(args ? { args: args as never } : {}),
  });
}

function decodeResult(
  abi: Abi,
  functionName: string,
  data: Hex,
): unknown {
  return decodeFunctionResult({
    abi,
    functionName: functionName as never,
    data,
  });
}

function decodeAddressResult(abi: Abi, functionName: string, data: Hex): Address {
  return nonzeroAddress(decodeResult(abi, functionName, data), `${functionName} result`);
}

function decodeBytes32Result(
  abi: Abi,
  functionName: string,
  data: Hex,
): PredictionBytes32V2 {
  return nonzeroBytes32(decodeResult(abi, functionName, data), `${functionName} result`);
}

function decodeUnsignedResult(abi: Abi, functionName: string, data: Hex): bigint {
  const value = decodeResult(abi, functionName, data);
  if (
    (typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) ||
    (typeof value === "bigint" && value < 0n)
  ) return fail(`${functionName} result is invalid`);
  return BigInt(value);
}

function decodeSignedResult(abi: Abi, functionName: string, data: Hex): bigint {
  const value = decodeResult(abi, functionName, data);
  if (
    (typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) return fail(`${functionName} result is invalid`);
  return BigInt(value);
}

function decodeBooleanResult(abi: Abi, functionName: string, data: Hex): boolean {
  const value = decodeResult(abi, functionName, data);
  if (typeof value !== "boolean") return fail(`${functionName} result is invalid`);
  return value;
}

function exactTuple(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> {
  if (Array.isArray(value)) {
    if (value.length !== fields.length) return fail(`${label} result is invalid`);
    return Object.fromEntries(fields.map((field, index) => [field, value[index]]));
  }
  if (!isRecord(value)) return fail(`${label} result is invalid`);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join(",") !== [...fields].sort().join(",")
  ) return fail(`${label} result is invalid`);
  return value;
}

function unsignedValue(value: unknown, label: string): bigint {
  if (
    (typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) ||
    (typeof value === "bigint" && value < 0n)
  ) return fail(`${label} is invalid`);
  return BigInt(value);
}

function decodeHookLifecycle(data: Hex) {
  const value = exactTuple(
    decodeResult(PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, "lifecycle", data),
    ["cutoff", "registeredBlock", "checkpoint", "initialized"],
    "LifecycleHook lifecycle",
  );
  if (typeof value.initialized !== "boolean") {
    return fail("LifecycleHook initialized result is invalid");
  }
  return Object.freeze({
    cutoff: unsignedValue(value.cutoff, "LifecycleHook cutoff"),
    registeredBlock: unsignedValue(
      value.registeredBlock,
      "LifecycleHook registered block",
    ),
    checkpoint: nonzeroAddress(value.checkpoint, "LifecycleHook checkpoint"),
    initialized: value.initialized,
  });
}

function decodePoolKey(data: Hex): PredictionV2PoolKey {
  const value = decodeResult(PREDICTION_V2_FACTORY_ABI, "getPoolKey", data);
  if (!isRecord(value)) return fail("PoolKey result is invalid");
  const fee = value.fee;
  const tickSpacing = value.tickSpacing;
  if (
    typeof fee !== "number" ||
    !Number.isInteger(fee) ||
    typeof tickSpacing !== "number" ||
    !Number.isInteger(tickSpacing)
  ) return fail("PoolKey result is invalid");
  return Object.freeze({
    currency0: nonzeroAddress(value.currency0, "PoolKey currency0"),
    currency1: nonzeroAddress(value.currency1, "PoolKey currency1"),
    fee,
    tickSpacing,
    hooks: nonzeroAddress(value.hooks, "PoolKey hook"),
  });
}

function decodeSlot0(data: Hex) {
  const word = decodeResult(PREDICTION_V2_POOL_MANAGER_STATE_ABI, "extsload", data);
  const canonical = nonzeroBytes32(word, "PoolManager slot0");
  const packed = BigInt(canonical);
  if (packed >> 232n !== 0n) return fail("PoolManager slot0 reserved bits are set");
  const sqrtPriceX96 = packed & ((1n << 160n) - 1n);
  const unsignedTick = Number((packed >> 160n) & 0xff_ffffn);
  const tick = unsignedTick >= 0x80_0000
    ? unsignedTick - 0x100_0000
    : unsignedTick;
  return Object.freeze({
    sqrtPriceX96,
    tick,
    poolManagerProtocolFee: Number((packed >> 184n) & 0xff_ffffn),
    lpFee: Number((packed >> 208n) & 0xff_ffffn),
  });
}

function protocolState(value: bigint): PredictionV2ProtocolState {
  const states = ["OPEN", "FINAL_YES", "FINAL_NO", "FINAL_INVALID"] as const;
  if (value < 0n || value >= BigInt(states.length)) return invalidMarket();
  return states[Number(value)];
}

function checkpointStatus(value: bigint): PredictionV2CheckpointStatus {
  const statuses = ["AWAITING", "FINAL", "INVALID"] as const;
  if (value < 0n || value >= BigInt(statuses.length)) return invalidMarket();
  return statuses[Number(value)];
}

function lifecycle(input: Readonly<{
  state: bigint;
  checkpointStatus: bigint;
  checkpointTradingHealthy: boolean;
  resolvedPrice: bigint;
  threshold: bigint;
  cutoff: bigint;
  observationTime: bigint;
  blockTimestamp: bigint;
}>): PredictionV2Lifecycle {
  const state = protocolState(input.state);
  const status = checkpointStatus(input.checkpointStatus);
  if (state !== "OPEN" && input.blockTimestamp < input.cutoff) invalidMarket();
  if (status !== "AWAITING" && input.checkpointTradingHealthy) invalidMarket();
  if (status !== "FINAL" && input.resolvedPrice !== 0n) invalidMarket();
  if (status !== "AWAITING" && input.blockTimestamp <= input.observationTime) invalidMarket();
  if (
    (state === "FINAL_YES" &&
      (status !== "FINAL" || input.resolvedPrice < input.threshold)) ||
    (state === "FINAL_NO" &&
      (status !== "FINAL" || input.resolvedPrice <= 0n ||
        input.resolvedPrice >= input.threshold)) ||
    (state === "FINAL_INVALID" &&
      status !== "INVALID" && (status !== "FINAL" || input.resolvedPrice > 0n))
  ) invalidMarket();

  if (state !== "OPEN") {
    return Object.freeze({
      protocolState: state,
      checkpointStatus: status,
      tradingPhase: "FINAL",
      tradable: false,
      tradabilityReason: "market-final",
      checkpointTradingHealthy: input.checkpointTradingHealthy,
      resolvedPrice: input.resolvedPrice,
    });
  }
  if (input.blockTimestamp >= input.cutoff) {
    return Object.freeze({
      protocolState: state,
      checkpointStatus: status,
      tradingPhase: "CLOSED",
      tradable: false,
      tradabilityReason: "cutoff-reached",
      checkpointTradingHealthy: input.checkpointTradingHealthy,
      resolvedPrice: input.resolvedPrice,
    });
  }
  if (!input.checkpointTradingHealthy) {
    return Object.freeze({
      protocolState: state,
      checkpointStatus: status,
      tradingPhase: "OPEN",
      tradable: false,
      tradabilityReason: "checkpoint-unhealthy",
      checkpointTradingHealthy: input.checkpointTradingHealthy,
      resolvedPrice: input.resolvedPrice,
    });
  }
  return Object.freeze({
    protocolState: state,
    checkpointStatus: status,
    tradingPhase: "OPEN",
    tradable: true,
    tradabilityReason: "tradable",
    checkpointTradingHealthy: true,
    resolvedPrice: input.resolvedPrice,
  });
}

async function sameRawCall(input: Readonly<{
  readers: readonly [PredictionV2RpcReader, PredictionV2RpcReader];
  limiter: PredictionV2DualCallLimiter;
  to: Address;
  data: Hex;
  blockNumber: bigint;
  blockHash: PredictionBytes32V2;
  signal?: AbortSignal;
}>): Promise<Hex> {
  input.signal?.throwIfAborted();
  const request = Object.freeze({
    to: input.to,
    data: input.data,
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    requireCanonical: true as const,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const [primaryValue, secondaryValue] = await input.limiter.run(
    () => Promise.all([
      input.readers[0].call(request),
      input.readers[1].call(request),
    ]),
    input.signal,
  );
  const primary = normalizeCallOutcome(primaryValue, "primary RPC result");
  const secondary = normalizeCallOutcome(secondaryValue, "secondary RPC result");
  if (primary.status !== secondary.status || primary.data !== secondary.data) {
    fail("Prediction V2 RPCs disagree about contract state");
  }
  if (primary.status === "reverted") throw new PredictionV2DeterministicCallRevert();
  return primary.data;
}

function readFunction(input: Readonly<{
  readers: readonly [PredictionV2RpcReader, PredictionV2RpcReader];
  limiter: PredictionV2DualCallLimiter;
  to: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  blockNumber: bigint;
  blockHash: PredictionBytes32V2;
  signal?: AbortSignal;
}>) {
  return sameRawCall({
    readers: input.readers,
    limiter: input.limiter,
    to: input.to,
    data: encodeCall(input.abi, input.functionName, input.args),
    blockNumber: input.blockNumber,
    blockHash: input.blockHash,
    ...(input.signal ? { signal: input.signal } : {}),
  });
}

async function resolveSnapshot(input: Readonly<{
  readers: readonly [PredictionV2RpcReader, PredictionV2RpcReader];
  binding: NormalizedBinding;
  cursor?: PredictionV2ReadCursor;
  signal?: AbortSignal;
}>) {
  const [primaryChainId, secondaryChainId, primarySafe, secondarySafe] =
    await Promise.all([
      input.readers[0].getChainId(input.signal),
      input.readers[1].getChainId(input.signal),
      input.readers[0].getSafeBlock(input.signal),
      input.readers[1].getSafeBlock(input.signal),
    ]);
  if (
    primaryChainId !== PREDICTION_V2_CHAIN_ID ||
    secondaryChainId !== PREDICTION_V2_CHAIN_ID
  ) fail("A Prediction V2 RPC is not serving Robinhood Chain");
  const safePrimary = normalizeBlock(primarySafe, "primary safe");
  const safeSecondary = normalizeBlock(secondarySafe, "secondary safe");
  assertSameBlock(safePrimary, safeSecondary);
  if (safePrimary.number < input.binding.deploymentBlock) {
    fail("Prediction V2 safe block predates the release deployment");
  }
  if (!input.cursor) return safePrimary;
  if (input.cursor.blockNumber > safePrimary.number) {
    fail("Prediction V2 cursor is newer than the safe block");
  }
  const [primaryHistorical, secondaryHistorical] = await Promise.all([
    input.readers[0].getBlock(input.cursor.blockNumber, input.signal),
    input.readers[1].getBlock(input.cursor.blockNumber, input.signal),
  ]);
  if (!primaryHistorical || !secondaryHistorical) {
    return fail("Prediction V2 cursor block is unavailable");
  }
  const historicalPrimary = normalizeBlock(primaryHistorical, "primary cursor");
  const historicalSecondary = normalizeBlock(secondaryHistorical, "secondary cursor");
  assertSameBlock(historicalPrimary, historicalSecondary);
  if (!sameBytes32(historicalPrimary.hash, input.cursor.blockHash)) {
    fail("Prediction V2 cursor block was replaced");
  }
  return historicalPrimary;
}

async function revalidateSnapshot(input: Readonly<{
  readers: readonly [PredictionV2RpcReader, PredictionV2RpcReader];
  block: PredictionV2SafeBlock;
  signal?: AbortSignal;
}>) {
  input.signal?.throwIfAborted();
  const [primaryCurrent, secondaryCurrent] = await Promise.all([
    input.readers[0].getBlock(input.block.number, input.signal),
    input.readers[1].getBlock(input.block.number, input.signal),
  ]);
  if (!primaryCurrent || !secondaryCurrent) {
    return fail("Prediction V2 snapshot block disappeared during read");
  }
  const primary = normalizeBlock(primaryCurrent, "primary final snapshot");
  const secondary = normalizeBlock(secondaryCurrent, "secondary final snapshot");
  assertSameBlock(primary, secondary);
  if (!sameBlockIdentity(input.block, primary)) {
    fail("Prediction V2 snapshot block changed during read");
  }
}

async function mapInBatches<Input, Output>(
  values: readonly Input[],
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output: Output[] = [];
  for (let index = 0; index < values.length; index += PREDICTION_V2_MARKET_BATCH_SIZE) {
    output.push(...await Promise.all(
      values.slice(index, index + PREDICTION_V2_MARKET_BATCH_SIZE).map(mapper),
    ));
  }
  return output;
}

async function readVerifiedMarket(input: Readonly<{
  readers: readonly [PredictionV2RpcReader, PredictionV2RpcReader];
  limiter: PredictionV2DualCallLimiter;
  binding: NormalizedBinding;
  economicKey: PredictionBytes32V2;
  block: PredictionV2SafeBlock;
  signal?: AbortSignal;
}>): Promise<PredictionV2ReadMarket> {
  const call = (
    to: Address,
    abi: Abi,
    functionName: string,
    args?: readonly unknown[],
  ) => readFunction({
    readers: input.readers,
    limiter: input.limiter,
    to,
    abi,
    functionName,
    ...(args ? { args } : {}),
    blockNumber: input.block.number,
    blockHash: input.block.hash,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  const [marketResult, poolKeyResult] = await Promise.all([
    call(input.binding.factory, PREDICTION_V2_FACTORY_ABI, "markets", [input.economicKey]),
    call(input.binding.factory, PREDICTION_V2_FACTORY_ABI, "getPoolKey", [input.economicKey]),
  ]);

  let market;
  let poolKey: PredictionV2PoolKey;
  try {
    market = decodePredictionV2MarketRecord(marketResult);
    poolKey = decodePoolKey(poolKeyResult);
    if (!market) invalidMarket();
  } catch {
    return invalidMarket();
  }

  const vault = market.vault;
  const checkpoint = market.checkpoint;
  const slot0CallData = encodeCall(PREDICTION_V2_POOL_MANAGER_STATE_ABI, "extsload", [
    predictionV2PoolStateSlot(poolKey),
  ]);
  const [
    registrySnapshotResult,
    vaultCollateralResult,
    vaultCheckpointResult,
    vaultFactoryResult,
    vaultRouterResult,
    yesTokenResult,
    noTokenResult,
    cutoffResult,
    thresholdResult,
    vaultEconomicKeyResult,
    vaultMarketIdResult,
    vaultAssetKeyResult,
    vaultRegistryRevisionResult,
    vaultRegistrySnapshotHashResult,
    vaultPolicyHashResult,
    vaultStateResult,
    accountedLiabilityResult,
    canonicalPoolIdResult,
    checkpointStatusResult,
    resolvedPriceResult,
    observationTimeResult,
    resolutionDeadlineResult,
    hardResolutionDeadlineResult,
    fallbackRequestedAtResult,
    fallbackChallengeDeadlineResult,
    checkpointPolicyHashResult,
    priceDecimalsResult,
    checkpointHealthResult,
    hookLifecycleResult,
    canonicalVaultResult,
    slot0Result,
  ] = await Promise.all([
    call(input.binding.assetRegistry, PREDICTION_V2_ASSET_REGISTRY_ABI, "getSnapshot", [
      market.assetKey,
      market.registryRevision,
    ]),
    call(vault, PREDICTION_V2_VAULT_ABI, "collateral"),
    call(vault, PREDICTION_V2_VAULT_ABI, "checkpoint"),
    call(vault, PREDICTION_V2_VAULT_ABI, "factory"),
    call(vault, PREDICTION_V2_VAULT_ABI, "router"),
    call(vault, PREDICTION_V2_VAULT_ABI, "yesToken"),
    call(vault, PREDICTION_V2_VAULT_ABI, "noToken"),
    call(vault, PREDICTION_V2_VAULT_ABI, "cutoff"),
    call(vault, PREDICTION_V2_VAULT_ABI, "threshold"),
    call(vault, PREDICTION_V2_VAULT_ABI, "economicKey"),
    call(vault, PREDICTION_V2_VAULT_ABI, "marketId"),
    call(vault, PREDICTION_V2_VAULT_ABI, "assetKey"),
    call(vault, PREDICTION_V2_VAULT_ABI, "registryRevision"),
    call(vault, PREDICTION_V2_VAULT_ABI, "registrySnapshotHash"),
    call(vault, PREDICTION_V2_VAULT_ABI, "oraclePolicyHash"),
    call(vault, PREDICTION_V2_VAULT_ABI, "state"),
    call(vault, PREDICTION_V2_VAULT_ABI, "accountedLiability"),
    call(vault, PREDICTION_V2_VAULT_ABI, "canonicalPoolId"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "status"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "resolvedPrice"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "observationTime"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "resolutionDeadline"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "hardResolutionDeadline"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "fallbackRequestedAt"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "fallbackChallengeDeadline"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "policyHash"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "priceDecimals"),
    call(checkpoint, PREDICTION_V2_CHECKPOINT_ABI, "isTradingHealthy"),
    call(
      input.binding.hook,
      PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
      "lifecycle",
      [market.poolId],
    ),
    call(
      input.binding.factory,
      PREDICTION_V2_FACTORY_CANONICAL_READ_ABI,
      "isCanonicalVault",
      [vault, market.poolId],
    ),
    sameRawCall({
      readers: input.readers,
      limiter: input.limiter,
      to: input.binding.poolManager,
      data: slot0CallData,
      blockNumber: input.block.number,
      blockHash: input.block.hash,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
  ]);

  let snapshot: PredictionV2RegistrySnapshot;
  let collateral: Address;
  let vaultCheckpoint: Address;
  let vaultFactory: Address;
  let router: Address;
  let yesToken: Address;
  let noToken: Address;
  let cutoff: bigint;
  let threshold: bigint;
  let vaultEconomicKey: PredictionBytes32V2;
  let vaultMarketId: PredictionBytes32V2;
  let vaultAssetKey: PredictionBytes32V2;
  let vaultRegistryRevision: bigint;
  let vaultRegistrySnapshotHash: PredictionBytes32V2;
  let vaultPolicyHash: PredictionBytes32V2;
  let rawState: bigint;
  let accountedLiability: bigint;
  let canonicalPoolId: PredictionBytes32V2;
  let rawCheckpointStatus: bigint;
  let resolvedPrice: bigint;
  let observationTime: bigint;
  let resolutionDeadline: bigint;
  let hardResolutionDeadline: bigint;
  let fallbackRequestedAt: bigint;
  let fallbackChallengeDeadline: bigint;
  let checkpointPolicyHash: PredictionBytes32V2;
  let priceDecimals: bigint;
  let checkpointTradingHealthy: boolean;
  let hookLifecycle: ReturnType<typeof decodeHookLifecycle>;
  let canonicalVault: boolean;
  let slot0: ReturnType<typeof decodeSlot0>;
  try {
    snapshot = decodePredictionV2RegistrySnapshot(registrySnapshotResult, "getSnapshot");
    collateral = decodeAddressResult(PREDICTION_V2_VAULT_ABI, "collateral", vaultCollateralResult);
    vaultCheckpoint = decodeAddressResult(PREDICTION_V2_VAULT_ABI, "checkpoint", vaultCheckpointResult);
    vaultFactory = decodeAddressResult(PREDICTION_V2_VAULT_ABI, "factory", vaultFactoryResult);
    router = decodeAddressResult(PREDICTION_V2_VAULT_ABI, "router", vaultRouterResult);
    yesToken = decodeAddressResult(PREDICTION_V2_VAULT_ABI, "yesToken", yesTokenResult);
    noToken = decodeAddressResult(PREDICTION_V2_VAULT_ABI, "noToken", noTokenResult);
    cutoff = decodeUnsignedResult(PREDICTION_V2_VAULT_ABI, "cutoff", cutoffResult);
    threshold = decodeSignedResult(PREDICTION_V2_VAULT_ABI, "threshold", thresholdResult);
    vaultEconomicKey = decodeBytes32Result(PREDICTION_V2_VAULT_ABI, "economicKey", vaultEconomicKeyResult);
    vaultMarketId = decodeBytes32Result(PREDICTION_V2_VAULT_ABI, "marketId", vaultMarketIdResult);
    vaultAssetKey = decodeBytes32Result(PREDICTION_V2_VAULT_ABI, "assetKey", vaultAssetKeyResult);
    vaultRegistryRevision = decodeUnsignedResult(PREDICTION_V2_VAULT_ABI, "registryRevision", vaultRegistryRevisionResult);
    vaultRegistrySnapshotHash = decodeBytes32Result(PREDICTION_V2_VAULT_ABI, "registrySnapshotHash", vaultRegistrySnapshotHashResult);
    vaultPolicyHash = decodeBytes32Result(PREDICTION_V2_VAULT_ABI, "oraclePolicyHash", vaultPolicyHashResult);
    rawState = decodeUnsignedResult(PREDICTION_V2_VAULT_ABI, "state", vaultStateResult);
    accountedLiability = decodeUnsignedResult(PREDICTION_V2_VAULT_ABI, "accountedLiability", accountedLiabilityResult);
    canonicalPoolId = decodeBytes32Result(PREDICTION_V2_VAULT_ABI, "canonicalPoolId", canonicalPoolIdResult);
    rawCheckpointStatus = decodeUnsignedResult(PREDICTION_V2_CHECKPOINT_ABI, "status", checkpointStatusResult);
    resolvedPrice = decodeSignedResult(PREDICTION_V2_CHECKPOINT_ABI, "resolvedPrice", resolvedPriceResult);
    observationTime = decodeUnsignedResult(PREDICTION_V2_CHECKPOINT_ABI, "observationTime", observationTimeResult);
    resolutionDeadline = decodeUnsignedResult(PREDICTION_V2_CHECKPOINT_ABI, "resolutionDeadline", resolutionDeadlineResult);
    hardResolutionDeadline = decodeUnsignedResult(PREDICTION_V2_CHECKPOINT_ABI, "hardResolutionDeadline", hardResolutionDeadlineResult);
    fallbackRequestedAt = decodeUnsignedResult(PREDICTION_V2_CHECKPOINT_ABI, "fallbackRequestedAt", fallbackRequestedAtResult);
    fallbackChallengeDeadline = decodeUnsignedResult(PREDICTION_V2_CHECKPOINT_ABI, "fallbackChallengeDeadline", fallbackChallengeDeadlineResult);
    checkpointPolicyHash = decodeBytes32Result(PREDICTION_V2_CHECKPOINT_ABI, "policyHash", checkpointPolicyHashResult);
    priceDecimals = decodeUnsignedResult(PREDICTION_V2_CHECKPOINT_ABI, "priceDecimals", priceDecimalsResult);
    checkpointTradingHealthy = decodeBooleanResult(PREDICTION_V2_CHECKPOINT_ABI, "isTradingHealthy", checkpointHealthResult);
    hookLifecycle = decodeHookLifecycle(hookLifecycleResult);
    canonicalVault = decodeBooleanResult(
      PREDICTION_V2_FACTORY_CANONICAL_READ_ABI,
      "isCanonicalVault",
      canonicalVaultResult,
    );
    slot0 = decodeSlot0(slot0Result);
  } catch {
    return invalidMarket();
  }

  const localAssetKey = predictionOnchainAssetKeyV2(snapshot.identity);
  const localSnapshotHash = predictionV2RegistrySnapshotHash(snapshot);
  const localPoolId = predictionV2PoolId(poolKey);
  if (
    !sameAddress(collateral, input.binding.collateral) ||
    !sameAddress(vaultCheckpoint, checkpoint) ||
    !sameAddress(vaultFactory, input.binding.factory) ||
    !sameAddress(router, input.binding.router) ||
    !sameAddress(poolKey.hooks, input.binding.hook) ||
    !sameBytes32(vaultEconomicKey, input.economicKey) ||
    !sameBytes32(vaultMarketId, market.marketId) ||
    !sameBytes32(vaultAssetKey, market.assetKey) ||
    vaultRegistryRevision !== market.registryRevision ||
    !sameBytes32(vaultRegistrySnapshotHash, market.registrySnapshotHash) ||
    !sameBytes32(vaultPolicyHash, market.resolutionPolicyHash) ||
    !sameBytes32(checkpointPolicyHash, market.resolutionPolicyHash) ||
    !sameBytes32(snapshot.assetKey, market.assetKey) ||
    snapshot.revision !== market.registryRevision ||
    !sameBytes32(localAssetKey, market.assetKey) ||
    !sameBytes32(snapshot.policy.checkpointKind, market.resolutionPolicyHash) ||
    !sameBytes32(localSnapshotHash, market.registrySnapshotHash) ||
    !sameBytes32(localPoolId, market.poolId) ||
    !sameBytes32(canonicalPoolId, market.poolId) ||
    hookLifecycle.cutoff !== cutoff ||
    !sameAddress(hookLifecycle.checkpoint, checkpoint) ||
    !hookLifecycle.initialized ||
    hookLifecycle.registeredBlock < input.binding.deploymentBlock ||
    hookLifecycle.registeredBlock > input.block.number ||
    !canonicalVault ||
    market.policyValidUntil !== snapshot.policy.validUntil ||
    market.snapshotAssetCap !== snapshot.policy.maxOpenInterestAtoms ||
    !snapshot.policy.active ||
    threshold <= 0n ||
    cutoff + PREDICTION_V2_CUTOFF_BEFORE_OBSERVATION_SECONDS !== observationTime ||
    observationTime > market.policyValidUntil ||
    resolutionDeadline < observationTime ||
    hardResolutionDeadline < resolutionDeadline ||
    priceDecimals !== PREDICTION_V2_PRICE_DECIMALS ||
    priceDecimals !== BigInt(snapshot.policy.feedDecimals) ||
    (fallbackRequestedAt === 0n) !== (fallbackChallengeDeadline === 0n) ||
    (fallbackRequestedAt > 0n && fallbackChallengeDeadline < fallbackRequestedAt)
  ) invalidMarket();

  const [registryHashResult, economicKeyResult] = await Promise.all([
    call(input.binding.assetRegistry, PREDICTION_V2_ASSET_REGISTRY_ABI, "hashSnapshot", [snapshot]),
    call(input.binding.factory, PREDICTION_V2_FACTORY_ABI, "economicEventKey", [
      market.assetKey,
      Number(observationTime),
      threshold,
    ]),
  ]);
  let registryHash: PredictionBytes32V2;
  let derivedEconomicKey: PredictionBytes32V2;
  try {
    registryHash = decodeBytes32Result(PREDICTION_V2_ASSET_REGISTRY_ABI, "hashSnapshot", registryHashResult);
    derivedEconomicKey = decodeBytes32Result(PREDICTION_V2_FACTORY_ABI, "economicEventKey", economicKeyResult);
  } catch {
    return invalidMarket();
  }
  if (
    !sameBytes32(registryHash, localSnapshotHash) ||
    !sameBytes32(derivedEconomicKey, input.economicKey)
  ) invalidMarket();

  let marketState;
  try {
    marketState = bindPredictionV2MarketState({
      chainId: PREDICTION_V2_CHAIN_ID,
      vault,
      poolManager: input.binding.poolManager,
      poolKey,
      poolId: market.poolId,
      poolStateSlot: predictionV2PoolStateSlot(poolKey),
      checkpoint,
      checkpointTradingHealthy,
      yesToken,
      noToken,
      currentSqrtPriceX96: slot0.sqrtPriceX96,
      currentTick: slot0.tick,
      poolManagerProtocolFee: slot0.poolManagerProtocolFee,
      lpFee: slot0.lpFee,
      observedBlockNumber: input.block.number,
      observedBlockHash: input.block.hash,
      checkpointCall: Object.freeze({
        to: vault,
        data: encodeCall(PREDICTION_V2_VAULT_ABI, "checkpoint"),
      }),
      checkpointResult: vaultCheckpointResult,
      checkpointTradingHealthCall: Object.freeze({
        to: checkpoint,
        data: encodeCall(PREDICTION_V2_CHECKPOINT_ABI, "isTradingHealthy"),
      }),
      checkpointTradingHealthResult: checkpointHealthResult,
      yesTokenCall: Object.freeze({
        to: vault,
        data: encodeCall(PREDICTION_V2_VAULT_ABI, "yesToken"),
      }),
      yesTokenResult,
      noTokenCall: Object.freeze({
        to: vault,
        data: encodeCall(PREDICTION_V2_VAULT_ABI, "noToken"),
      }),
      noTokenResult,
      slot0Call: Object.freeze({
        to: input.binding.poolManager,
        data: slot0CallData,
      }),
      slot0Result,
    });
  } catch {
    return invalidMarket();
  }

  const marketLifecycle = lifecycle({
    state: rawState,
    checkpointStatus: rawCheckpointStatus,
    checkpointTradingHealthy,
    resolvedPrice,
    threshold,
    cutoff,
    observationTime,
    blockTimestamp: input.block.timestamp,
  });
  const yesIsCurrency0 = sameAddress(poolKey.currency0, yesToken);
  return Object.freeze({
    economicKey: input.economicKey,
    marketId: market.marketId,
    assetKey: market.assetKey,
    registryRevision: market.registryRevision,
    registrySnapshotHash: market.registrySnapshotHash,
    resolutionPolicyHash: market.resolutionPolicyHash,
    policyValidUntil: market.policyValidUntil,
    snapshotAssetCap: market.snapshotAssetCap,
    vault,
    checkpoint,
    yesToken,
    noToken,
    poolId: market.poolId,
    poolKey,
    asset: Object.freeze({
      identity: snapshot.identity,
      displaySymbol: snapshot.displaySymbol,
    }),
    predicate: Object.freeze({
      comparator: "greater-than-or-equal" as const,
      threshold,
      observationTime,
      priceDecimals: Number(priceDecimals),
    }),
    lifecycle: marketLifecycle,
    deadlines: Object.freeze({
      cutoff,
      resolutionDeadline,
      hardResolutionDeadline,
      fallbackRequestedAt,
      fallbackChallengeDeadline,
    }),
    poolState: Object.freeze({
      sqrtPriceX96: marketState.currentSqrtPriceX96,
      tick: marketState.currentTick,
      poolManagerProtocolFee: marketState.poolManagerProtocolFee,
      lpFee: marketState.lpFee,
      yesProbabilityBps: predictionV2YesProbabilityBps(
        marketState.currentSqrtPriceX96,
        yesIsCurrency0,
      ),
    }),
    accountedLiability,
  });
}

export async function readPredictionV2Directory(input: Readonly<{
  readers: readonly [PredictionV2RpcReader, PredictionV2RpcReader];
  binding: PredictionV2ReadBinding;
  limit?: number;
  cursor?: PredictionV2ReadCursor | null;
  signal?: AbortSignal;
}>): Promise<PredictionV2DirectoryRead> {
  if (
    input.readers.length !== 2 ||
    input.readers[0] === input.readers[1] ||
    typeof input.readers[0].readerId !== "string" ||
    typeof input.readers[1].readerId !== "string" ||
    input.readers[0].readerId.trim().length === 0 ||
    input.readers[1].readerId.trim().length === 0 ||
    input.readers[0].readerId === input.readers[1].readerId
  ) fail("Prediction V2 requires two distinct RPC readers");
  const binding = normalizeBinding(input.binding);
  const cursor = input.cursor ? normalizeCursor(input.cursor) : undefined;
  const limit = input.limit ?? PREDICTION_V2_MAXIMUM_PAGE_SIZE;
  const block = await resolveSnapshot({
    readers: input.readers,
    binding,
    ...(cursor ? { cursor } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const limiter = new PredictionV2DualCallLimiter();

  const readFactory = (functionName: string, args?: readonly unknown[]) =>
    readFunction({
      readers: input.readers,
      limiter,
      to: binding.factory,
      abi: PREDICTION_V2_FACTORY_ABI,
      functionName,
      ...(args ? { args } : {}),
      blockNumber: block.number,
      blockHash: block.hash,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  const readBound = (to: Address, abi: Abi, functionName: string) => readFunction({
    readers: input.readers,
    limiter,
    to,
    abi,
    functionName,
    blockNumber: block.number,
    blockHash: block.hash,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const [
    assetRegistryResult,
    managerResult,
    marketCountResult,
    hookFactoryResult,
    hookRouterResult,
    hookManagerResult,
    routerFactoryResult,
    routerManagerResult,
    routerCollateralResult,
  ] = await Promise.all([
    readFactory("assetRegistry"),
    readFactory("manager"),
    readFactory("marketCount"),
    readBound(binding.hook, PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, "factory"),
    readBound(
      binding.hook,
      PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
      "authorizedRouter",
    ),
    readBound(binding.hook, PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, "poolManager"),
    readBound(binding.router, PREDICTION_V2_EXECUTION_ROUTER_READ_ABI, "factory"),
    readBound(binding.router, PREDICTION_V2_EXECUTION_ROUTER_READ_ABI, "manager"),
    readBound(binding.router, PREDICTION_V2_EXECUTION_ROUTER_READ_ABI, "collateral"),
  ]);
  const assetRegistry = decodeAddressResult(
    PREDICTION_V2_FACTORY_ABI,
    "assetRegistry",
    assetRegistryResult,
  );
  const manager = decodeAddressResult(PREDICTION_V2_FACTORY_ABI, "manager", managerResult);
  const marketCount = decodeUnsignedResult(
    PREDICTION_V2_FACTORY_ABI,
    "marketCount",
    marketCountResult,
  );
  const hookFactory = decodeAddressResult(
    PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
    "factory",
    hookFactoryResult,
  );
  const hookRouter = decodeAddressResult(
    PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
    "authorizedRouter",
    hookRouterResult,
  );
  const hookManager = decodeAddressResult(
    PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
    "poolManager",
    hookManagerResult,
  );
  const routerFactory = decodeAddressResult(
    PREDICTION_V2_EXECUTION_ROUTER_READ_ABI,
    "factory",
    routerFactoryResult,
  );
  const routerManager = decodeAddressResult(
    PREDICTION_V2_EXECUTION_ROUTER_READ_ABI,
    "manager",
    routerManagerResult,
  );
  const routerCollateral = decodeAddressResult(
    PREDICTION_V2_EXECUTION_ROUTER_READ_ABI,
    "collateral",
    routerCollateralResult,
  );
  if (
    !sameAddress(assetRegistry, binding.assetRegistry) ||
    !sameAddress(manager, binding.poolManager) ||
    !sameAddress(hookFactory, binding.factory) ||
    !sameAddress(hookRouter, binding.router) ||
    !sameAddress(hookManager, binding.poolManager) ||
    !sameAddress(routerFactory, binding.factory) ||
    !sameAddress(routerManager, binding.poolManager) ||
    !sameAddress(routerCollateral, binding.collateral)
  ) fail("Prediction V2 release endpoints do not match the read binding");
  if (cursor && cursor.marketCount !== marketCount) {
    fail("Prediction V2 cursor market count changed");
  }

  const page = predictionV2PageIndices({
    marketCount,
    limit,
    ...(cursor ? { nextExclusiveIndex: cursor.nextExclusiveIndex } : {}),
  });
  const indexedKeys = await mapInBatches(page.indices, async (index) => {
    const result = await readFactory("marketKeyAt", [index]);
    return Object.freeze({
      index,
      economicKey: decodeBytes32Result(
        PREDICTION_V2_FACTORY_ABI,
        "marketKeyAt",
        result,
      ),
    });
  });
  if (new Set(indexedKeys.map(({ economicKey }) => economicKey)).size !== indexedKeys.length) {
    fail("Prediction V2 Factory returned duplicate market keys");
  }

  const rows = await mapInBatches(indexedKeys, async ({ index, economicKey }) => {
    try {
      return Object.freeze({
        status: "verified" as const,
        market: await readVerifiedMarket({
          readers: input.readers,
          limiter,
          binding,
          economicKey,
          block,
          ...(input.signal ? { signal: input.signal } : {}),
        }),
      });
    } catch (error) {
      if (
        !(error instanceof PredictionV2MarketWiringError) &&
        !(error instanceof PredictionV2DeterministicCallRevert)
      ) throw error;
      return Object.freeze({
        status: "quarantined" as const,
        failure: Object.freeze({
          index,
          economicKey,
          code: "invalid-market-wiring" as const,
        }),
      });
    }
  });
  await revalidateSnapshot({
    readers: input.readers,
    block,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const markets = rows.flatMap((row) => row.status === "verified" ? [row.market] : []);
  const quarantined = rows.flatMap((row) =>
    row.status === "quarantined" ? [row.failure] : []
  );
  const nextCursor = page.nextExclusiveIndex > 0n
    ? Object.freeze({
      schemaVersion: 2 as const,
      blockNumber: block.number,
      blockHash: nonzeroBytes32(block.hash, "snapshot block hash"),
      marketCount,
      nextExclusiveIndex: page.nextExclusiveIndex,
    })
    : null;
  return Object.freeze({
    schemaVersion: 2,
    chainId: PREDICTION_V2_CHAIN_ID,
    snapshot: block,
    marketCount,
    markets: Object.freeze(markets),
    quarantined: Object.freeze(quarantined),
    nextCursor,
  });
}
