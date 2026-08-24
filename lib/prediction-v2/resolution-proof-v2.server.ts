import "server-only";

import {
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
  PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
  PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
} from "./resolution-proof-v2-abi";

export const PREDICTION_V2_RESOLUTION_CHAIN_ID = 4_663 as const;
export const PREDICTION_V2_RESOLUTION_MAX_SEARCH_STEPS = 64;
export const PREDICTION_V2_RESOLUTION_MAX_PROVIDER_REQUESTS = 224;
export const PREDICTION_V2_RESOLUTION_MAX_OBSERVATION_DISTANCE = 25n * 60n * 60n;
export const PREDICTION_V2_CHAINLINK_RESOLUTION_POLICY_HASH =
  "0x14b51aac26efb0507bb7558c0f4860171737dba2f519f65da3d708b05b072851" as const;
export const PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY =
  "dense-monotone-local-round-ids" as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const UINT16_MAX = (1n << 16n) - 1n;
const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const UINT80_MAX = (1n << 80n) - 1n;
const INT192_MAX = (1n << 191n) - 1n;
const HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/u;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

export type PredictionV2ResolutionBytes32 = `0x${string}`;

export type PredictionV2ResolutionBlock = Readonly<{
  number: bigint;
  hash: PredictionV2ResolutionBytes32;
  parentHash: PredictionV2ResolutionBytes32;
  timestamp: bigint;
}>;

export type PredictionV2ResolutionCallRequest = Readonly<{
  to: Address;
  data: Hex;
  blockNumber: bigint;
  blockHash: PredictionV2ResolutionBytes32;
  requireCanonical: true;
  from?: Address;
  value?: bigint;
  signal?: AbortSignal;
}>;

export type PredictionV2ResolutionCodeRequest = Readonly<{
  address: Address;
  blockNumber: bigint;
  blockHash: PredictionV2ResolutionBytes32;
  requireCanonical: true;
  signal?: AbortSignal;
}>;

/**
 * A tagged revert is reserved for a deterministic EVM revert. Transport,
 * timeout, malformed-response, and provider failures reject the promise.
 */
export type PredictionV2ResolutionCallRevert = Readonly<{
  status: "reverted";
  data: Hex;
}>;

/**
 * Server-owned provider boundary. Implementations must execute call/code reads
 * with the supplied EIP-1898 block hash and `requireCanonical: true`.
 */
export type PredictionV2ResolutionRpcReader = Readonly<{
  readerId: string;
  getChainId(signal?: AbortSignal): Promise<number>;
  getSafeBlock(signal?: AbortSignal): Promise<PredictionV2ResolutionBlock>;
  getBlock(
    blockNumber: bigint,
    signal?: AbortSignal,
  ): Promise<PredictionV2ResolutionBlock | null>;
  call(
    request: PredictionV2ResolutionCallRequest,
  ): Promise<Hex | PredictionV2ResolutionCallRevert>;
  getCode(request: PredictionV2ResolutionCodeRequest): Promise<Hex>;
}>;

export type PredictionV2ResolutionRpcQuorum = Readonly<{
  primary: PredictionV2ResolutionRpcReader;
  secondary: PredictionV2ResolutionRpcReader;
}>;

/** Exact release authority supplied by the disabled V2 release binding. */
export type PredictionV2ResolutionReleaseBinding = Readonly<{
  chainId: typeof PREDICTION_V2_RESOLUTION_CHAIN_ID;
  factory: Address;
  economicKey: PredictionV2ResolutionBytes32;
  marketId: PredictionV2ResolutionBytes32;
  assetRegistry: Address;
  assetKey: PredictionV2ResolutionBytes32;
  registryRevision: bigint;
  registrySnapshotHash: PredictionV2ResolutionBytes32;
  vault: Address;
  vaultRuntimeCodeHash: PredictionV2ResolutionBytes32;
  checkpoint: Address;
  checkpointRuntimeCodeHash: PredictionV2ResolutionBytes32;
  feed: Address;
  feedProxyRuntimeCodeHash: PredictionV2ResolutionBytes32;
  policyHash: PredictionV2ResolutionBytes32;
  /** Signed release qualification; the binary search never infers this from one market. */
  oracleRoundTopology: typeof PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY;
  oraclePhaseId: number;
  oracleAggregator: Address;
  oracleAggregatorRuntimeCodeHash: PredictionV2ResolutionBytes32;
}>;

export type PredictionV2ResolutionRound = Readonly<{
  id: bigint;
  phaseId: number;
  localRoundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}>;

export type PredictionV2ResolutionProofCandidate = Readonly<{
  schemaVersion: 2;
  chainId: typeof PREDICTION_V2_RESOLUTION_CHAIN_ID;
  snapshot: PredictionV2ResolutionBlock;
  binding: PredictionV2ResolutionReleaseBinding;
  oracle: Readonly<{
    observationTime: bigint;
    feedDecimals: number;
    feedDescriptionHash: PredictionV2ResolutionBytes32;
    currentPhase: number;
    highestApprovedPhase: number;
    currentAggregator: Address;
    currentAggregatorRuntimeCodeHash: PredictionV2ResolutionBytes32;
    phaseRegistryRevision: bigint;
    phaseApprovalTimestamp: bigint;
    minimumEligibleLocalRoundId: bigint;
  }>;
  before: PredictionV2ResolutionRound;
  after: PredictionV2ResolutionRound;
  proof: Hex;
  expectedCheckpointStatus: "FINAL" | "INVALID";
  commitment: PredictionV2ResolutionBytes32;
  searchSteps: number;
  providerRequests: number;
}>;

export type PredictionV2ResolutionPreparedTransaction = Readonly<{
  schemaVersion: 2;
  chainId: typeof PREDICTION_V2_RESOLUTION_CHAIN_ID;
  from: Address;
  to: Address;
  data: Hex;
  value: 0n;
  validAtBlock: PredictionV2ResolutionBlock;
  candidate: PredictionV2ResolutionProofCandidate;
  simulation: Readonly<{
    checkpointStatus: "FINAL" | "INVALID";
    vaultState: "FINAL_YES" | "FINAL_NO" | "FINAL_INVALID";
  }>;
  providerRequests: number;
}>;

export type PredictionV2ResolutionProofErrorCode =
  | "invalid-input"
  | "provider-failure"
  | "provider-disagreement"
  | "request-budget-exceeded"
  | "wrong-chain"
  | "noncanonical-block"
  | "binding-mismatch"
  | "proof-unavailable"
  | "checkpoint-terminal"
  | "invalid-round"
  | "candidate-changed"
  | "simulation-failed";

export class PredictionV2ResolutionProofError extends Error {
  constructor(
    readonly code: PredictionV2ResolutionProofErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PredictionV2ResolutionProofError";
  }
}

type NormalizedCallOutcome =
  | Readonly<{ status: "success"; data: Hex }>
  | Readonly<{ status: "reverted"; data: Hex }>;

type ResolutionContext = Readonly<{
  quorum: PredictionV2ResolutionRpcQuorum;
  snapshot: PredictionV2ResolutionBlock;
  budget: RequestBudget;
  signal?: AbortSignal;
}>;

class RequestBudget {
  #used = 0;

  consume(amount: number) {
    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      this.#used + amount > PREDICTION_V2_RESOLUTION_MAX_PROVIDER_REQUESTS
    ) {
      fail(
        "request-budget-exceeded",
        "Prediction V2 resolution provider request budget was exhausted",
      );
    }
    this.#used += amount;
  }

  get used() {
    return this.#used;
  }
}

function fail(
  code: PredictionV2ResolutionProofErrorCode,
  message: string,
): never {
  throw new PredictionV2ResolutionProofError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !HEX_PATTERN.test(value)) {
    return fail("provider-failure", `${label} is not canonical even-length hex`);
  }
  return value.toLowerCase() as Hex;
}

function nonzeroBytes32(
  value: unknown,
  label: string,
  code: PredictionV2ResolutionProofErrorCode = "invalid-input",
): PredictionV2ResolutionBytes32 {
  if (
    typeof value !== "string" ||
    !BYTES32_PATTERN.test(value) ||
    value.toLowerCase() === ZERO_BYTES32
  ) return fail(code, `${label} is not a nonzero bytes32 value`);
  return value.toLowerCase() as PredictionV2ResolutionBytes32;
}

function nonzeroAddress(
  value: unknown,
  label: string,
  code: PredictionV2ResolutionProofErrorCode = "invalid-input",
): Address {
  if (typeof value !== "string") return fail(code, `${label} is not an address`);
  let address: Address;
  try {
    address = getAddress(value);
  } catch {
    return fail(code, `${label} is not an address`);
  }
  if (address.toLowerCase() === ZERO_ADDRESS) {
    return fail(code, `${label} is the zero address`);
  }
  return address;
}

function unsigned(
  value: unknown,
  label: string,
  maximum?: bigint,
): bigint {
  if (
    (typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) ||
    (typeof value === "bigint" && value < 0n)
  ) return fail("provider-failure", `${label} is not an unsigned integer`);
  const result = BigInt(value);
  if (maximum !== undefined && result > maximum) {
    return fail("provider-failure", `${label} exceeds its Solidity type`);
  }
  return result;
}

function signed(value: unknown, label: string): bigint {
  if (
    (typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && !Number.isSafeInteger(value))
  ) return fail("provider-failure", `${label} is not a signed integer`);
  return BigInt(value);
}

function exactString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    return fail("provider-failure", `${label} is not a string`);
  }
  return value;
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameAddress(left: Address, right: Address) {
  return sameHex(left, right);
}

function normalizeBlock(
  value: PredictionV2ResolutionBlock,
  label: string,
): PredictionV2ResolutionBlock {
  if (!isRecord(value) || value.number < 1n || value.timestamp < 0n) {
    return fail("provider-failure", `${label} is malformed`);
  }
  return Object.freeze({
    number: value.number,
    hash: nonzeroBytes32(value.hash, `${label} hash`, "provider-failure"),
    parentHash: nonzeroBytes32(
      value.parentHash,
      `${label} parent hash`,
      "provider-failure",
    ),
    timestamp: value.timestamp,
  });
}

function sameBlock(
  left: PredictionV2ResolutionBlock,
  right: PredictionV2ResolutionBlock,
) {
  return (
    left.number === right.number &&
    sameHex(left.hash, right.hash) &&
    sameHex(left.parentHash, right.parentHash) &&
    left.timestamp === right.timestamp
  );
}

function normalizeCallOutcome(
  value: Hex | PredictionV2ResolutionCallRevert,
  label: string,
): NormalizedCallOutcome {
  if (typeof value === "string") {
    return Object.freeze({ status: "success", data: exactHex(value, label) });
  }
  const keys = isRecord(value) ? Reflect.ownKeys(value) : [];
  if (
    !isRecord(value) ||
    keys.some((key) => typeof key !== "string") ||
    (keys as string[]).sort().join(",") !== "data,status" ||
    value.status !== "reverted"
  ) return fail("provider-failure", `${label} has a malformed call outcome`);
  return Object.freeze({
    status: "reverted",
    data: exactHex(value.data, `${label} revert data`),
  });
}

function normalizeQuorum(
  value: PredictionV2ResolutionRpcQuorum,
): PredictionV2ResolutionRpcQuorum {
  if (
    !value?.primary ||
    !value.secondary ||
    typeof value.primary.readerId !== "string" ||
    typeof value.secondary.readerId !== "string" ||
    value.primary.readerId.trim() === "" ||
    value.secondary.readerId.trim() === "" ||
    value.primary.readerId === value.secondary.readerId
  ) {
    return fail(
      "invalid-input",
      "Prediction V2 resolution requires two distinctly identified RPC readers",
    );
  }
  return value;
}

function normalizeBinding(
  value: PredictionV2ResolutionReleaseBinding,
): PredictionV2ResolutionReleaseBinding {
  if (!isRecord(value) || value.chainId !== PREDICTION_V2_RESOLUTION_CHAIN_ID) {
    return fail("invalid-input", "Prediction V2 resolution binding has the wrong chain");
  }
  if (
    !Number.isInteger(value.oraclePhaseId) ||
    value.oraclePhaseId < 1 ||
    value.oraclePhaseId > Number(UINT16_MAX)
  ) {
    return fail("invalid-input", "Prediction V2 oracle phase is invalid");
  }
  if (
    typeof value.registryRevision !== "bigint" ||
    value.registryRevision < 1n ||
    value.registryRevision > UINT64_MAX
  ) {
    return fail("invalid-input", "Prediction V2 registry revision is invalid");
  }
  if (
    value.oracleRoundTopology !==
      PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY
  ) {
    return fail(
      "invalid-input",
      "Prediction V2 release has not qualified dense monotone local round IDs",
    );
  }
  if (!sameHex(value.policyHash, PREDICTION_V2_CHAINLINK_RESOLUTION_POLICY_HASH)) {
    return fail(
      "invalid-input",
      "Prediction V2 resolution binding has an unsupported policy hash",
    );
  }
  return Object.freeze({
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    factory: nonzeroAddress(value.factory, "Factory"),
    economicKey: nonzeroBytes32(value.economicKey, "economic key"),
    marketId: nonzeroBytes32(value.marketId, "market id"),
    assetRegistry: nonzeroAddress(value.assetRegistry, "Asset Registry"),
    assetKey: nonzeroBytes32(value.assetKey, "asset key"),
    registryRevision: value.registryRevision,
    registrySnapshotHash: nonzeroBytes32(
      value.registrySnapshotHash,
      "registry snapshot hash",
    ),
    vault: nonzeroAddress(value.vault, "Vault"),
    vaultRuntimeCodeHash: nonzeroBytes32(
      value.vaultRuntimeCodeHash,
      "Vault runtime code hash",
    ),
    checkpoint: nonzeroAddress(value.checkpoint, "checkpoint"),
    checkpointRuntimeCodeHash: nonzeroBytes32(
      value.checkpointRuntimeCodeHash,
      "checkpoint runtime code hash",
    ),
    feed: nonzeroAddress(value.feed, "Chainlink feed"),
    feedProxyRuntimeCodeHash: nonzeroBytes32(
      value.feedProxyRuntimeCodeHash,
      "feed proxy runtime code hash",
    ),
    policyHash: PREDICTION_V2_CHAINLINK_RESOLUTION_POLICY_HASH,
    oracleRoundTopology: PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY,
    oraclePhaseId: value.oraclePhaseId,
    oracleAggregator: nonzeroAddress(value.oracleAggregator, "initial oracle aggregator"),
    oracleAggregatorRuntimeCodeHash: nonzeroBytes32(
      value.oracleAggregatorRuntimeCodeHash,
      "initial oracle aggregator runtime code hash",
    ),
  });
}

async function providerPair<Value>(
  budget: RequestBudget,
  label: string,
  primary: () => Promise<Value>,
  secondary: () => Promise<Value>,
): Promise<readonly [Value, Value]> {
  budget.consume(2);
  try {
    return await Promise.all([primary(), secondary()]);
  } catch {
    return fail("provider-failure", `${label} failed on at least one RPC reader`);
  }
}

async function commonBlock(
  quorum: PredictionV2ResolutionRpcQuorum,
  budget: RequestBudget,
  signal?: AbortSignal,
): Promise<PredictionV2ResolutionBlock> {
  signal?.throwIfAborted();
  const [primaryChain, secondaryChain] = await providerPair(
    budget,
    "Prediction V2 chain-id read",
    () => quorum.primary.getChainId(signal),
    () => quorum.secondary.getChainId(signal),
  );
  if (
    primaryChain !== PREDICTION_V2_RESOLUTION_CHAIN_ID ||
    secondaryChain !== PREDICTION_V2_RESOLUTION_CHAIN_ID
  ) return fail("wrong-chain", "Prediction V2 resolution RPC is not chain 4663");

  const [primarySafeRaw, secondarySafeRaw] = await providerPair(
    budget,
    "Prediction V2 safe-block read",
    () => quorum.primary.getSafeBlock(signal),
    () => quorum.secondary.getSafeBlock(signal),
  );
  const primarySafe = normalizeBlock(primarySafeRaw, "primary safe block");
  const secondarySafe = normalizeBlock(secondarySafeRaw, "secondary safe block");
  const number = primarySafe.number < secondarySafe.number
    ? primarySafe.number
    : secondarySafe.number;
  const [primaryBlockRaw, secondaryBlockRaw] = await providerPair(
    budget,
    "Prediction V2 common-block read",
    () => quorum.primary.getBlock(number, signal),
    () => quorum.secondary.getBlock(number, signal),
  );
  if (!primaryBlockRaw || !secondaryBlockRaw) {
    return fail("noncanonical-block", "Prediction V2 common block is unavailable");
  }
  const primaryBlock = normalizeBlock(primaryBlockRaw, "primary common block");
  const secondaryBlock = normalizeBlock(secondaryBlockRaw, "secondary common block");
  if (!sameBlock(primaryBlock, secondaryBlock)) {
    return fail(
      "provider-disagreement",
      "Prediction V2 RPC readers disagree on the common block",
    );
  }
  return primaryBlock;
}

async function assertCanonicalBlock(
  context: ResolutionContext,
  expected: PredictionV2ResolutionBlock = context.snapshot,
) {
  context.signal?.throwIfAborted();
  const [primaryRaw, secondaryRaw] = await providerPair(
    context.budget,
    "Prediction V2 canonical-block revalidation",
    () => context.quorum.primary.getBlock(expected.number, context.signal),
    () => context.quorum.secondary.getBlock(expected.number, context.signal),
  );
  if (!primaryRaw || !secondaryRaw) {
    return fail("noncanonical-block", "Prediction V2 proof block is no longer available");
  }
  const primary = normalizeBlock(primaryRaw, "primary revalidated block");
  const secondary = normalizeBlock(secondaryRaw, "secondary revalidated block");
  if (!sameBlock(primary, secondary)) {
    return fail(
      "provider-disagreement",
      "Prediction V2 RPC readers disagree during block revalidation",
    );
  }
  if (!sameBlock(primary, expected)) {
    return fail("noncanonical-block", "Prediction V2 proof block was reorganized");
  }
}

async function dualCall(
  context: ResolutionContext,
  request: Omit<
    PredictionV2ResolutionCallRequest,
    "blockNumber" | "blockHash" | "requireCanonical" | "signal"
  >,
  label: string,
  revertCode: PredictionV2ResolutionProofErrorCode = "provider-failure",
): Promise<Hex> {
  context.signal?.throwIfAborted();
  const exactRequest = Object.freeze({
    ...request,
    blockNumber: context.snapshot.number,
    blockHash: context.snapshot.hash,
    requireCanonical: true as const,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  const [primaryRaw, secondaryRaw] = await providerPair(
    context.budget,
    label,
    () => context.quorum.primary.call(exactRequest),
    () => context.quorum.secondary.call(exactRequest),
  );
  const primary = normalizeCallOutcome(primaryRaw, `${label} primary response`);
  const secondary = normalizeCallOutcome(secondaryRaw, `${label} secondary response`);
  if (primary.status !== secondary.status || !sameHex(primary.data, secondary.data)) {
    return fail("provider-disagreement", `${label} differs across RPC readers`);
  }
  if (primary.status === "reverted") {
    return fail(revertCode, `${label} reverted at the common block`);
  }
  return primary.data;
}

async function codeHashAt(
  context: ResolutionContext,
  address: Address,
  label: string,
): Promise<PredictionV2ResolutionBytes32> {
  context.signal?.throwIfAborted();
  const request = Object.freeze({
    address,
    blockNumber: context.snapshot.number,
    blockHash: context.snapshot.hash,
    requireCanonical: true as const,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  const [primaryRaw, secondaryRaw] = await providerPair(
    context.budget,
    `${label} code read`,
    () => context.quorum.primary.getCode(request),
    () => context.quorum.secondary.getCode(request),
  );
  const primary = exactHex(primaryRaw, `${label} primary code`);
  const secondary = exactHex(secondaryRaw, `${label} secondary code`);
  if (!sameHex(primary, secondary)) {
    return fail("provider-disagreement", `${label} code differs across RPC readers`);
  }
  if (primary === "0x") {
    return fail("binding-mismatch", `${label} has no runtime code`);
  }
  return keccak256(primary).toLowerCase() as PredictionV2ResolutionBytes32;
}

async function contractResult(
  context: ResolutionContext,
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] | undefined,
  label: string,
  options?: Readonly<{
    from?: Address;
    value?: bigint;
    revertCode?: PredictionV2ResolutionProofErrorCode;
  }>,
): Promise<unknown> {
  let data: Hex;
  try {
    data = encodeFunctionData({
      abi,
      functionName: functionName as never,
      ...(args ? { args: args as never } : {}),
    });
  } catch {
    return fail("invalid-input", `${label} could not be encoded`);
  }
  const response = await dualCall(
    context,
    {
      to,
      data,
      ...(options?.from ? { from: options.from } : {}),
      ...(options?.value !== undefined ? { value: options.value } : {}),
    },
    label,
    options?.revertCode,
  );
  try {
    return decodeFunctionResult({
      abi,
      functionName: functionName as never,
      data: response,
    });
  } catch {
    return fail("provider-failure", `${label} returned malformed ABI data`);
  }
}

async function addressResult(
  context: ResolutionContext,
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] | undefined,
  label: string,
) {
  return nonzeroAddress(
    await contractResult(context, to, abi, functionName, args, label),
    `${label} result`,
    "provider-failure",
  );
}

async function bytes32Result(
  context: ResolutionContext,
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] | undefined,
  label: string,
) {
  return nonzeroBytes32(
    await contractResult(context, to, abi, functionName, args, label),
    `${label} result`,
    "provider-failure",
  );
}

async function unsignedResult(
  context: ResolutionContext,
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] | undefined,
  label: string,
  maximum?: bigint,
) {
  return unsigned(
    await contractResult(context, to, abi, functionName, args, label),
    `${label} result`,
    maximum,
  );
}

function tuple(value: unknown, length: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || value.length !== length) {
    return fail("provider-failure", `${label} returned a malformed tuple`);
  }
  return value;
}

function splitRoundId(roundId: bigint, label: string) {
  if (roundId < 1n || roundId > UINT80_MAX) {
    return fail("invalid-round", `${label} has an invalid uint80 round id`);
  }
  const phaseId = Number(roundId >> 64n);
  const localRoundId = roundId & UINT64_MAX;
  if (phaseId === 0 || localRoundId === 0n) {
    return fail("invalid-round", `${label} has a zero phase or local round`);
  }
  return Object.freeze({ phaseId, localRoundId });
}

function joinRoundId(phaseId: number, localRoundId: bigint) {
  if (
    !Number.isInteger(phaseId) ||
    phaseId < 1 ||
    phaseId > Number(UINT16_MAX) ||
    localRoundId < 1n ||
    localRoundId > UINT64_MAX
  ) return fail("invalid-round", "Prediction V2 round-id components are invalid");
  return (BigInt(phaseId) << 64n) | localRoundId;
}

function validateRound(
  value: unknown,
  requestedRoundId: bigint | undefined,
  snapshot: PredictionV2ResolutionBlock,
  label: string,
): PredictionV2ResolutionRound {
  const fields = tuple(value, 5, label);
  const id = unsigned(fields[0], `${label} id`, UINT80_MAX);
  if (requestedRoundId !== undefined && id !== requestedRoundId) {
    return fail("invalid-round", `${label} returned a different round id`);
  }
  const answer = signed(fields[1], `${label} answer`);
  const startedAt = unsigned(fields[2], `${label} startedAt`);
  const updatedAt = unsigned(fields[3], `${label} updatedAt`);
  const answeredInRound = unsigned(
    fields[4],
    `${label} answeredInRound`,
    UINT80_MAX,
  );
  const idParts = splitRoundId(id, label);
  const answeredParts = splitRoundId(answeredInRound, `${label} answeredInRound`);
  if (
    answer <= 0n ||
    answer > INT192_MAX ||
    startedAt === 0n ||
    startedAt > updatedAt ||
    updatedAt === 0n ||
    updatedAt > UINT32_MAX ||
    updatedAt > snapshot.timestamp ||
    answeredParts.phaseId !== idParts.phaseId ||
    answeredParts.localRoundId < idParts.localRoundId
  ) return fail("invalid-round", `${label} fails Chainlink V2 round validation`);
  return Object.freeze({
    id,
    phaseId: idParts.phaseId,
    localRoundId: idParts.localRoundId,
    answer,
    startedAt,
    updatedAt,
    answeredInRound,
  });
}

async function readRound(
  context: ResolutionContext,
  feed: Address,
  roundId: bigint,
  cache: Map<bigint, PredictionV2ResolutionRound>,
) {
  const cached = cache.get(roundId);
  if (cached) return cached;
  const raw = await contractResult(
    context,
    feed,
    PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
    "getRoundData",
    [roundId],
    `Chainlink round ${roundId}`,
    { revertCode: "proof-unavailable" },
  );
  const round = validateRound(raw, roundId, context.snapshot, `Chainlink round ${roundId}`);
  cache.set(roundId, round);
  return round;
}

function sameBinding(
  left: PredictionV2ResolutionReleaseBinding,
  right: PredictionV2ResolutionReleaseBinding,
) {
  return (
    left.chainId === right.chainId &&
    sameAddress(left.factory, right.factory) &&
    sameHex(left.economicKey, right.economicKey) &&
    sameHex(left.marketId, right.marketId) &&
    sameAddress(left.assetRegistry, right.assetRegistry) &&
    sameHex(left.assetKey, right.assetKey) &&
    left.registryRevision === right.registryRevision &&
    sameHex(left.registrySnapshotHash, right.registrySnapshotHash) &&
    sameAddress(left.vault, right.vault) &&
    sameHex(left.vaultRuntimeCodeHash, right.vaultRuntimeCodeHash) &&
    sameAddress(left.checkpoint, right.checkpoint) &&
    sameHex(left.checkpointRuntimeCodeHash, right.checkpointRuntimeCodeHash) &&
    sameAddress(left.feed, right.feed) &&
    sameHex(left.feedProxyRuntimeCodeHash, right.feedProxyRuntimeCodeHash) &&
    sameHex(left.policyHash, right.policyHash) &&
    left.oracleRoundTopology === right.oracleRoundTopology &&
    left.oraclePhaseId === right.oraclePhaseId &&
    sameAddress(left.oracleAggregator, right.oracleAggregator) &&
    sameHex(
      left.oracleAggregatorRuntimeCodeHash,
      right.oracleAggregatorRuntimeCodeHash,
    )
  );
}

function candidateCommitment(
  candidate: Omit<PredictionV2ResolutionProofCandidate, "commitment">,
): PredictionV2ResolutionBytes32 {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint64" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "bytes32" },
        { type: "uint16" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint32" },
        { type: "uint8" },
        { type: "bytes32" },
        { type: "uint16" },
        { type: "uint16" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "uint64" },
        { type: "uint80" },
        { type: "int256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint80" },
        { type: "uint80" },
        { type: "int256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint80" },
        { type: "uint8" },
        { type: "bytes" },
      ],
      [
        BigInt(candidate.chainId),
        candidate.snapshot.number,
        candidate.snapshot.hash,
        candidate.snapshot.parentHash,
        candidate.snapshot.timestamp,
        candidate.binding.factory,
        candidate.binding.economicKey,
        candidate.binding.marketId,
        candidate.binding.assetRegistry,
        candidate.binding.assetKey,
        candidate.binding.registryRevision,
        candidate.binding.registrySnapshotHash,
        candidate.binding.vault,
        candidate.binding.vaultRuntimeCodeHash,
        candidate.binding.checkpoint,
        candidate.binding.checkpointRuntimeCodeHash,
        candidate.binding.feed,
        candidate.binding.feedProxyRuntimeCodeHash,
        candidate.binding.policyHash,
        keccak256(toBytes(candidate.binding.oracleRoundTopology)),
        candidate.binding.oraclePhaseId,
        candidate.binding.oracleAggregator,
        candidate.binding.oracleAggregatorRuntimeCodeHash,
        Number(candidate.oracle.observationTime),
        candidate.oracle.feedDecimals,
        candidate.oracle.feedDescriptionHash,
        candidate.oracle.currentPhase,
        candidate.oracle.highestApprovedPhase,
        candidate.oracle.currentAggregator,
        candidate.oracle.currentAggregatorRuntimeCodeHash,
        candidate.oracle.phaseRegistryRevision,
        candidate.oracle.phaseApprovalTimestamp,
        candidate.oracle.minimumEligibleLocalRoundId,
        candidate.before.id,
        candidate.before.answer,
        candidate.before.startedAt,
        candidate.before.updatedAt,
        candidate.before.answeredInRound,
        candidate.after.id,
        candidate.after.answer,
        candidate.after.startedAt,
        candidate.after.updatedAt,
        candidate.after.answeredInRound,
        candidate.expectedCheckpointStatus === "FINAL" ? 1 : 2,
        candidate.proof,
      ],
    ),
  ).toLowerCase() as PredictionV2ResolutionBytes32;
}

function sameResolutionEvidence(
  left: PredictionV2ResolutionProofCandidate,
  right: PredictionV2ResolutionProofCandidate,
) {
  return (
    sameBinding(left.binding, right.binding) &&
    left.oracle.observationTime === right.oracle.observationTime &&
    left.oracle.feedDecimals === right.oracle.feedDecimals &&
    sameHex(left.oracle.feedDescriptionHash, right.oracle.feedDescriptionHash) &&
    left.oracle.currentPhase === right.oracle.currentPhase &&
    left.oracle.highestApprovedPhase === right.oracle.highestApprovedPhase &&
    sameAddress(left.oracle.currentAggregator, right.oracle.currentAggregator) &&
    sameHex(
      left.oracle.currentAggregatorRuntimeCodeHash,
      right.oracle.currentAggregatorRuntimeCodeHash,
    ) &&
    left.oracle.phaseRegistryRevision === right.oracle.phaseRegistryRevision &&
    left.oracle.phaseApprovalTimestamp === right.oracle.phaseApprovalTimestamp &&
    left.oracle.minimumEligibleLocalRoundId ===
      right.oracle.minimumEligibleLocalRoundId &&
    left.before.id === right.before.id &&
    left.before.answer === right.before.answer &&
    left.before.startedAt === right.before.startedAt &&
    left.before.updatedAt === right.before.updatedAt &&
    left.before.answeredInRound === right.before.answeredInRound &&
    left.after.id === right.after.id &&
    left.after.answer === right.after.answer &&
    left.after.startedAt === right.after.startedAt &&
    left.after.updatedAt === right.after.updatedAt &&
    left.after.answeredInRound === right.after.answeredInRound &&
    left.expectedCheckpointStatus === right.expectedCheckpointStatus &&
    sameHex(left.proof, right.proof)
  );
}

async function findAtSnapshot(
  context: ResolutionContext,
  binding: PredictionV2ResolutionReleaseBinding,
): Promise<PredictionV2ResolutionProofCandidate> {
  const [
    vaultCheckpoint,
    vaultPolicyHash,
    vaultState,
    checkpointStatus,
    checkpointFeed,
    checkpointPolicyHash,
    observationTime,
    feedDecimals,
    feedDescriptionHash,
    oracleProxyCodehash,
    oraclePhaseId,
    oracleAggregator,
    oracleAggregatorCodehash,
    highestApprovedPhase,
  ] = await Promise.all([
    addressResult(
      context,
      binding.vault,
      PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
      "checkpoint",
      undefined,
      "Vault checkpoint",
    ),
    bytes32Result(
      context,
      binding.vault,
      PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
      "oraclePolicyHash",
      undefined,
      "Vault oracle policy",
    ),
    unsignedResult(
      context,
      binding.vault,
      PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
      "state",
      undefined,
      "Vault state",
      3n,
    ),
    unsignedResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "status",
      undefined,
      "checkpoint status",
      2n,
    ),
    addressResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "feed",
      undefined,
      "checkpoint feed",
    ),
    bytes32Result(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "policyHash",
      undefined,
      "checkpoint policy",
    ),
    unsignedResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "observationTime",
      undefined,
      "checkpoint observation time",
      UINT32_MAX,
    ),
    unsignedResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "feedDecimals",
      undefined,
      "checkpoint feed decimals",
      255n,
    ),
    bytes32Result(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "feedDescriptionHash",
      undefined,
      "checkpoint feed description hash",
    ),
    bytes32Result(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "oracleProxyCodehash",
      undefined,
      "checkpoint oracle proxy code hash",
    ),
    unsignedResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "oraclePhaseId",
      undefined,
      "checkpoint initial phase",
      UINT16_MAX,
    ),
    addressResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "oracleAggregator",
      undefined,
      "checkpoint initial aggregator",
    ),
    bytes32Result(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "oracleAggregatorCodehash",
      undefined,
      "checkpoint initial aggregator code hash",
    ),
    unsignedResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "highestApprovedPhase",
      undefined,
      "checkpoint highest approved phase",
      UINT16_MAX,
    ),
  ]);

  if (
    !sameAddress(vaultCheckpoint, binding.checkpoint) ||
    !sameAddress(checkpointFeed, binding.feed) ||
    !sameHex(vaultPolicyHash, binding.policyHash) ||
    !sameHex(checkpointPolicyHash, binding.policyHash) ||
    !sameHex(oracleProxyCodehash, binding.feedProxyRuntimeCodeHash) ||
    Number(oraclePhaseId) !== binding.oraclePhaseId ||
    !sameAddress(oracleAggregator, binding.oracleAggregator) ||
    !sameHex(
      oracleAggregatorCodehash,
      binding.oracleAggregatorRuntimeCodeHash,
    )
  ) return fail("binding-mismatch", "Prediction V2 release binding does not match the market");
  if (vaultState !== 0n) {
    return fail("proof-unavailable", "Prediction V2 market is already terminal");
  }
  if (checkpointStatus !== 0n) {
    return fail(
      "checkpoint-terminal",
      "Prediction V2 checkpoint is terminal and the open Vault requires finalizeResolved",
    );
  }
  if (observationTime === 0n || context.snapshot.timestamp <= observationTime) {
    return fail("proof-unavailable", "Prediction V2 observation time has not elapsed");
  }

  const [
    vaultCodeHash,
    checkpointCodeHash,
    feedCodeHash,
    initialAggregatorCodeHash,
    feedPhase,
    feedAggregator,
    initialPhaseAggregator,
    liveFeedDecimals,
    liveFeedDescription,
  ] = await Promise.all([
    codeHashAt(context, binding.vault, "Vault"),
    codeHashAt(context, binding.checkpoint, "checkpoint"),
    codeHashAt(context, binding.feed, "Chainlink feed"),
    codeHashAt(context, binding.oracleAggregator, "initial Chainlink aggregator"),
    unsignedResult(
      context,
      binding.feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "phaseId",
      undefined,
      "Chainlink current phase",
      UINT16_MAX,
    ),
    addressResult(
      context,
      binding.feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "aggregator",
      undefined,
      "Chainlink current aggregator",
    ),
    addressResult(
      context,
      binding.feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "phaseAggregators",
      [binding.oraclePhaseId],
      "Chainlink initial phase aggregator",
    ),
    unsignedResult(
      context,
      binding.feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "decimals",
      undefined,
      "Chainlink feed decimals",
      255n,
    ),
    contractResult(
      context,
      binding.feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "description",
      undefined,
      "Chainlink feed description",
    ),
  ]);
  const liveDescriptionHash = keccak256(
    toBytes(exactString(liveFeedDescription, "Chainlink feed description")),
  ).toLowerCase() as PredictionV2ResolutionBytes32;
  if (
    !sameHex(vaultCodeHash, binding.vaultRuntimeCodeHash) ||
    !sameHex(checkpointCodeHash, binding.checkpointRuntimeCodeHash) ||
    !sameHex(feedCodeHash, binding.feedProxyRuntimeCodeHash) ||
    !sameHex(initialAggregatorCodeHash, binding.oracleAggregatorRuntimeCodeHash) ||
    !sameAddress(initialPhaseAggregator, binding.oracleAggregator) ||
    liveFeedDecimals !== feedDecimals ||
    !sameHex(liveDescriptionHash, feedDescriptionHash)
  ) return fail("binding-mismatch", "Prediction V2 oracle runtime fingerprint changed");

  const currentPhase = Number(feedPhase);
  const highestPhase = Number(highestApprovedPhase);
  if (
    currentPhase < binding.oraclePhaseId ||
    currentPhase !== highestPhase ||
    currentPhase === 0
  ) {
    return fail(
      "proof-unavailable",
      "Prediction V2 Chainlink phase is not the current highest-approved phase",
    );
  }

  const approvalRaw = await contractResult(
    context,
    binding.checkpoint,
    PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
    "phaseApprovals",
    [currentPhase],
    "checkpoint phase approval",
  );
  const approval = tuple(approvalRaw, 5, "checkpoint phase approval");
  const approvedAggregator = nonzeroAddress(
    approval[0],
    "approved phase aggregator",
    "provider-failure",
  );
  const approvedAggregatorCodehash = nonzeroBytes32(
    approval[1],
    "approved phase aggregator code hash",
    "provider-failure",
  );
  const phaseRegistryRevision = unsigned(
    approval[2],
    "approved phase registry revision",
    UINT64_MAX,
  );
  const phaseApprovalTimestamp = unsigned(
    approval[3],
    "approved phase timestamp",
    UINT64_MAX,
  );
  const minimumEligibleLocalRoundId = unsigned(
    approval[4],
    "minimum eligible local round",
    UINT64_MAX,
  );
  if (
    phaseRegistryRevision === 0n ||
    phaseApprovalTimestamp === 0n ||
    phaseApprovalTimestamp > observationTime ||
    minimumEligibleLocalRoundId === 0n ||
    minimumEligibleLocalRoundId === UINT64_MAX
  ) {
    return fail("proof-unavailable", "Prediction V2 phase approval is not eligible at T");
  }

  const [mappedCurrentAggregator, currentAggregatorCodeHash] = await Promise.all([
    addressResult(
      context,
      binding.feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "phaseAggregators",
      [currentPhase],
      "Chainlink current phase mapping",
    ),
    codeHashAt(context, approvedAggregator, "current Chainlink aggregator"),
  ]);
  if (
    !sameAddress(feedAggregator, approvedAggregator) ||
    !sameAddress(mappedCurrentAggregator, approvedAggregator) ||
    !sameHex(currentAggregatorCodeHash, approvedAggregatorCodehash)
  ) return fail("binding-mismatch", "Prediction V2 current phase topology changed");

  const latestRaw = await contractResult(
    context,
    binding.feed,
    PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
    "latestRoundData",
    undefined,
    "Chainlink latest round",
    { revertCode: "proof-unavailable" },
  );
  const latest = validateRound(
    latestRaw,
    undefined,
    context.snapshot,
    "Chainlink latest round",
  );
  if (
    latest.phaseId !== currentPhase ||
    latest.localRoundId < minimumEligibleLocalRoundId
  ) return fail("proof-unavailable", "Prediction V2 latest round is outside the approved phase floor");

  const cache = new Map<bigint, PredictionV2ResolutionRound>([[latest.id, latest]]);
  if (latest.localRoundId === minimumEligibleLocalRoundId) {
    return fail("proof-unavailable", "Prediction V2 has no eligible adjacent round pair yet");
  }
  const floorId = joinRoundId(currentPhase, minimumEligibleLocalRoundId);
  const floorRound = await readRound(context, binding.feed, floorId, cache);
  if (floorRound.updatedAt > observationTime) {
    return fail(
      "proof-unavailable",
      "Prediction V2 first eligible round is already after T and has no eligible predecessor",
    );
  }
  if (latest.updatedAt <= observationTime) {
    return fail("proof-unavailable", "Prediction V2 has no completed post-T round yet");
  }

  let lower = minimumEligibleLocalRoundId + 1n;
  let upper = latest.localRoundId;
  let searchSteps = 0;
  // Chainlink local round IDs are not guaranteed dense. A missing midpoint is
  // deliberately proof-unavailable: without a separately authenticated index
  // we never skip a hole or infer that a later round is the first post-T round.
  while (lower < upper) {
    if (searchSteps >= PREDICTION_V2_RESOLUTION_MAX_SEARCH_STEPS) {
      return fail(
        "request-budget-exceeded",
        "Prediction V2 adjacent-round search exceeded 64 steps",
      );
    }
    searchSteps += 1;
    const midpoint = lower + ((upper - lower) >> 1n);
    const round = await readRound(
      context,
      binding.feed,
      joinRoundId(currentPhase, midpoint),
      cache,
    );
    if (round.updatedAt > observationTime) upper = midpoint;
    else lower = midpoint + 1n;
  }

  const after = await readRound(
    context,
    binding.feed,
    joinRoundId(currentPhase, lower),
    cache,
  );
  const before = await readRound(
    context,
    binding.feed,
    joinRoundId(currentPhase, lower - 1n),
    cache,
  );
  if (
    before.phaseId !== currentPhase ||
    after.phaseId !== currentPhase ||
    before.localRoundId < minimumEligibleLocalRoundId ||
    before.localRoundId === UINT64_MAX ||
    after.localRoundId !== before.localRoundId + 1n ||
    before.updatedAt > observationTime ||
    after.updatedAt <= observationTime
  ) return fail("invalid-round", "Prediction V2 rounds are not the adjacent bracket around T");

  const preAge = observationTime - before.updatedAt;
  const postDelay = after.updatedAt - observationTime;
  const expectedCheckpointStatus = (
    preAge > PREDICTION_V2_RESOLUTION_MAX_OBSERVATION_DISTANCE ||
    postDelay > PREDICTION_V2_RESOLUTION_MAX_OBSERVATION_DISTANCE
  ) ? "INVALID" as const : "FINAL" as const;

  const proof = encodeAbiParameters(
    [{ type: "uint80" }, { type: "uint80" }],
    [before.id, after.id],
  );
  const withoutCommitment = Object.freeze({
    schemaVersion: 2 as const,
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    snapshot: context.snapshot,
    binding,
    oracle: Object.freeze({
      observationTime,
      feedDecimals: Number(feedDecimals),
      feedDescriptionHash,
      currentPhase,
      highestApprovedPhase: highestPhase,
      currentAggregator: approvedAggregator,
      currentAggregatorRuntimeCodeHash: currentAggregatorCodeHash,
      phaseRegistryRevision,
      phaseApprovalTimestamp,
      minimumEligibleLocalRoundId,
    }),
    before,
    after,
    proof,
    expectedCheckpointStatus,
    searchSteps,
    providerRequests: context.budget.used,
  });
  const candidate = Object.freeze({
    ...withoutCommitment,
    commitment: candidateCommitment(withoutCommitment),
  });
  return candidate;
}

/**
 * Finds the exact adjacent Chainlink V2 proof at one independently agreed safe
 * block. No provider, route, or release config is selected inside this module.
 */
export async function findPredictionV2ResolutionProof(input: Readonly<{
  quorum: PredictionV2ResolutionRpcQuorum;
  binding: PredictionV2ResolutionReleaseBinding;
  signal?: AbortSignal;
}>): Promise<PredictionV2ResolutionProofCandidate> {
  const quorum = normalizeQuorum(input.quorum);
  const binding = normalizeBinding(input.binding);
  const budget = new RequestBudget();
  const snapshot = await commonBlock(quorum, budget, input.signal);
  const context: ResolutionContext = Object.freeze({
    quorum,
    snapshot,
    budget,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const candidate = await findAtSnapshot(context, binding);
  await assertCanonicalBlock(context);
  return Object.freeze({ ...candidate, providerRequests: budget.used });
}

function assertCandidateCommitment(candidate: PredictionV2ResolutionProofCandidate) {
  if (
    candidate.expectedCheckpointStatus !== "FINAL" &&
    candidate.expectedCheckpointStatus !== "INVALID"
  ) {
    return fail(
      "invalid-input",
      "Prediction V2 resolution candidate has an invalid expected status",
    );
  }
  let recomputed: PredictionV2ResolutionBytes32;
  try {
    const { commitment: _commitment, ...withoutCommitment } = candidate;
    void _commitment;
    recomputed = candidateCommitment(withoutCommitment);
  } catch {
    return fail("invalid-input", "Prediction V2 resolution candidate is malformed");
  }
  const commitment = nonzeroBytes32(
    candidate.commitment,
    "resolution candidate commitment",
  );
  if (!sameHex(commitment, recomputed)) {
    return fail("invalid-input", "Prediction V2 resolution candidate commitment is invalid");
  }
}

/**
 * Mandatory final gate before requesting a wallet signature. It proves the
 * discovery block is still canonical, repeats the complete proof search at a
 * fresh common safe block, requires identical evidence, and simulates both the
 * checkpoint and Vault transitions across both RPC readers.
 *
 * The returned transaction is snapshot-bound evidence, not a broadcast. A
 * caller must discard it after any delay or wallet/network change and rerun
 * this function.
 */
export async function revalidateAndSimulatePredictionV2Resolution(input: Readonly<{
  quorum: PredictionV2ResolutionRpcQuorum;
  binding: PredictionV2ResolutionReleaseBinding;
  candidate: PredictionV2ResolutionProofCandidate;
  sender: Address;
  signal?: AbortSignal;
}>): Promise<PredictionV2ResolutionPreparedTransaction> {
  const quorum = normalizeQuorum(input.quorum);
  const binding = normalizeBinding(input.binding);
  const sender = nonzeroAddress(input.sender, "resolution transaction sender");
  assertCandidateCommitment(input.candidate);
  if (!sameBinding(binding, input.candidate.binding)) {
    return fail("invalid-input", "Prediction V2 candidate uses a different release binding");
  }

  const historicalBudget = new RequestBudget();
  const historicalContext: ResolutionContext = Object.freeze({
    quorum,
    snapshot: normalizeBlock(input.candidate.snapshot, "candidate snapshot"),
    budget: historicalBudget,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const [primaryChain, secondaryChain] = await providerPair(
    historicalBudget,
    "Prediction V2 pre-broadcast chain-id read",
    () => quorum.primary.getChainId(input.signal),
    () => quorum.secondary.getChainId(input.signal),
  );
  if (
    primaryChain !== PREDICTION_V2_RESOLUTION_CHAIN_ID ||
    secondaryChain !== PREDICTION_V2_RESOLUTION_CHAIN_ID
  ) return fail("wrong-chain", "Prediction V2 pre-broadcast RPC is not chain 4663");
  await assertCanonicalBlock(historicalContext, input.candidate.snapshot);

  const fresh = await findPredictionV2ResolutionProof({
    quorum,
    binding,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (
    fresh.snapshot.number < input.candidate.snapshot.number ||
    (fresh.snapshot.number === input.candidate.snapshot.number &&
      !sameBlock(fresh.snapshot, input.candidate.snapshot)) ||
    !sameResolutionEvidence(input.candidate, fresh)
  ) {
    return fail(
      "candidate-changed",
      "Prediction V2 resolution evidence changed before broadcast",
    );
  }

  const simulationBudget = new RequestBudget();
  const simulationContext: ResolutionContext = Object.freeze({
    quorum,
    snapshot: fresh.snapshot,
    budget: simulationBudget,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const checkpointStatus = unsigned(
    await contractResult(
      simulationContext,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "resolve",
      [fresh.proof],
      "checkpoint resolution simulation",
      { from: sender, value: 0n, revertCode: "simulation-failed" },
    ),
    "checkpoint simulation result",
    2n,
  );
  const simulatedCheckpointStatus = checkpointStatus === 1n
    ? "FINAL" as const
    : checkpointStatus === 2n
      ? "INVALID" as const
      : null;
  if (
    simulatedCheckpointStatus === null ||
    simulatedCheckpointStatus !== fresh.expectedCheckpointStatus
  ) {
    return fail(
      "simulation-failed",
      "Prediction V2 checkpoint simulation differs from the adjacent-round evidence",
    );
  }

  const transactionData = encodeFunctionData({
    abi: PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
    functionName: "finalize",
    args: [fresh.proof],
  });
  const vaultState = unsigned(
    await contractResult(
      simulationContext,
      binding.vault,
      PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
      "finalize",
      [fresh.proof],
      "Vault finalization simulation",
      { from: sender, value: 0n, revertCode: "simulation-failed" },
    ),
    "Vault finalization simulation result",
    3n,
  );
  const simulatedVaultState = vaultState === 1n
    ? "FINAL_YES" as const
    : vaultState === 2n
      ? "FINAL_NO" as const
      : vaultState === 3n
        ? "FINAL_INVALID" as const
        : null;
  const simulationConsistent = fresh.expectedCheckpointStatus === "FINAL"
    ? simulatedVaultState === "FINAL_YES" || simulatedVaultState === "FINAL_NO"
    : simulatedVaultState === "FINAL_INVALID";
  if (simulatedVaultState === null || !simulationConsistent) {
    return fail(
      "simulation-failed",
      "Prediction V2 Vault simulation differs from the checkpoint outcome",
    );
  }
  await assertCanonicalBlock(simulationContext);

  return Object.freeze({
    schemaVersion: 2 as const,
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    from: sender,
    to: binding.vault,
    data: transactionData,
    value: 0n as const,
    validAtBlock: fresh.snapshot,
    candidate: fresh,
    simulation: Object.freeze({
      checkpointStatus: simulatedCheckpointStatus,
      vaultState: simulatedVaultState,
    }),
    providerRequests:
      historicalBudget.used + fresh.providerRequests + simulationBudget.used,
  });
}
