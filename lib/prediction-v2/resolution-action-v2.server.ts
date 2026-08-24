import "server-only";

import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  keccak256,
  toBytes,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  PREDICTION_V2_ASSET_REGISTRY_ABI,
  type PredictionV2RegistrySnapshot,
} from "./abi";
import {
  decodePredictionV2RegistrySnapshot,
  predictionV2RegistrySnapshotHash,
} from "./codec";
import type { PredictionV2DistributedBudgetV2 } from
  "./distributed-budget-v2.server";
import {
  assertPredictionV2ReadMarketAtSnapshotProvenance,
  PREDICTION_V2_TARGETED_MARKET_MAX_PROVIDER_REQUESTS,
  readPredictionV2MarketAtSnapshot,
  type PredictionV2MarketAtSnapshotRead,
  type PredictionV2ReadBinding,
  type PredictionV2ReadMarket,
} from "./read-model-v2.server";
import {
  PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
  PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
  PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
} from "./resolution-proof-v2-abi";
import {
  createPredictionV2PublicReleaseRpcSession,
  getPredictionV2PublicReleaseV2,
  PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS,
  toPredictionV2ReadBindingFromPublicReleaseV2,
  type PredictionV2EnabledPublicReleaseV2,
  type PredictionV2PublicReleaseV2,
} from "./public-release-v2.server";
import type { PredictionV2ActionRpcSessionReader } from
  "./rpc-session-v2.server";
import {
  PREDICTION_V2_RESOLUTION_CHAIN_ID,
  PREDICTION_V2_CHAINLINK_RESOLUTION_POLICY_HASH,
  PREDICTION_V2_RESOLUTION_MAX_PROVIDER_REQUESTS,
  PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY,
  PredictionV2ResolutionProofError,
  findPredictionV2ResolutionProof,
  revalidateAndSimulatePredictionV2Resolution,
  type PredictionV2ResolutionBlock,
  type PredictionV2ResolutionBytes32,
  type PredictionV2ResolutionCallRequest,
  type PredictionV2ResolutionCallRevert,
  type PredictionV2ResolutionCodeRequest,
  type PredictionV2ResolutionPreparedTransaction,
  type PredictionV2ResolutionReleaseBinding,
  type PredictionV2ResolutionRpcReader,
} from "./resolution-proof-v2.server";

export const PREDICTION_V2_SOFT_RESOLUTION_OFFSET_SECONDS = 26n * 60n * 60n;
export const PREDICTION_V2_HARD_FALLBACK_OFFSET_SECONDS = 7n * 24n * 60n * 60n;
export const PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS = 3n * 24n * 60n * 60n;
export const PREDICTION_V2_RESOLUTION_ACTION_MAX_PROVIDER_REQUESTS = 40;
export const PREDICTION_V2_RESOLUTION_ACTION_MAX_INVOCATION_PROVIDER_REQUESTS =
  2 * (
    2 * PREDICTION_V2_RESOLUTION_ACTION_MAX_PROVIDER_REQUESTS +
    4 * PREDICTION_V2_RESOLUTION_MAX_PROVIDER_REQUESTS
  );
export const PREDICTION_V2_RESOLUTION_BINDING_DERIVATION_MAX_PROVIDER_REQUESTS =
  21;

/**
 * Exact logical-RPC-call precharge for the complete signed public Resolution
 * operation: release-bound snapshot/runtime session, one canonical targeted
 * market read, authority derivation, and the bounded decision engine including
 * its single race retry.
 */
export const PREDICTION_V2_RESOLUTION_PUBLIC_RELEASE_MAX_PROVIDER_REQUESTS =
  PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS +
  PREDICTION_V2_TARGETED_MARKET_MAX_PROVIDER_REQUESTS +
  PREDICTION_V2_RESOLUTION_BINDING_DERIVATION_MAX_PROVIDER_REQUESTS +
  PREDICTION_V2_RESOLUTION_ACTION_MAX_INVOCATION_PROVIDER_REQUESTS;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BYTES32 = `0x${"00".repeat(32)}`;
const UINT32_MAX = (1n << 32n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const HEX_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/u;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;

export type PredictionV2ResolutionAction =
  | "finalize-with-proof"
  | "finalize-unavailable"
  | "request-unproven-fallback"
  | "finalize-unproven"
  | "finalize-resolved";

export type PredictionV2ResolutionWaitReason =
  | "observation-not-elapsed"
  | "awaiting-post-t-round"
  | "soft-unavailable-not-proven"
  | "fallback-challenge-active"
  | "proof-search-bounded"
  | "hard-fallback-not-admissible"
  | "unproven-terminalization-not-admissible";

export type PredictionV2ResolutionLifecycleSnapshot = Readonly<{
  block: PredictionV2ResolutionBlock;
  vaultState: "OPEN" | "FINAL_YES" | "FINAL_NO" | "FINAL_INVALID";
  checkpointStatus: "AWAITING" | "FINAL" | "INVALID";
  observationTime: bigint;
  resolutionDeadline: bigint;
  hardResolutionDeadline: bigint;
  fallbackRequestedAt: bigint;
  fallbackChallengeDeadline: bigint;
}>;

export type PredictionV2ResolutionActionCandidate = Readonly<{
  schemaVersion: 2;
  decision: "action";
  chainId: typeof PREDICTION_V2_RESOLUTION_CHAIN_ID;
  action: PredictionV2ResolutionAction;
  account: Address;
  snapshot: PredictionV2ResolutionBlock;
  binding: PredictionV2ResolutionReleaseBinding;
  transaction: Readonly<{
    to: Address;
    data: Hex;
    selector: Hex;
    value: 0n;
  }>;
  expected: Readonly<{
    checkpointStatus: "AWAITING" | "FINAL" | "INVALID";
    vaultState: "OPEN" | "FINAL_YES" | "FINAL_NO" | "FINAL_INVALID";
    fallbackChallengeDeadline: bigint;
  }>;
  proofCommitment?: PredictionV2ResolutionBytes32;
  providerRequests: number;
}>;

export type PredictionV2ResolutionNoActionDecision = Readonly<{
  schemaVersion: 2;
  decision: "no-action";
  reason: "vault-terminal";
  chainId: typeof PREDICTION_V2_RESOLUTION_CHAIN_ID;
  snapshot: PredictionV2ResolutionLifecycleSnapshot;
  providerRequests: number;
}>;

export type PredictionV2ResolutionWaitDecision = Readonly<{
  schemaVersion: 2;
  decision: "wait";
  reason: PredictionV2ResolutionWaitReason;
  chainId: typeof PREDICTION_V2_RESOLUTION_CHAIN_ID;
  snapshot: PredictionV2ResolutionLifecycleSnapshot;
  providerRequests: number;
}>;

export type PredictionV2ResolutionActionDecision =
  | PredictionV2ResolutionActionCandidate
  | PredictionV2ResolutionNoActionDecision
  | PredictionV2ResolutionWaitDecision;

export type PredictionV2ResolutionActionErrorCode =
  | "invalid-input"
  | "provider-failure"
  | "wrong-chain"
  | "noncanonical-block"
  | "binding-mismatch"
  | "invalid-lifecycle"
  | "simulation-failed"
  | "resolution-race";

export class PredictionV2ResolutionActionError extends Error {
  constructor(
    readonly code: PredictionV2ResolutionActionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PredictionV2ResolutionActionError";
  }
}

type CallOutcome =
  | Readonly<{ status: "success"; data: Hex }>
  | Readonly<{ status: "reverted"; data: Hex }>;

type ActionContext = Readonly<{
  reader: PredictionV2ResolutionRpcReader;
  block: PredictionV2ResolutionBlock;
  budget: ActionBudget;
  signal?: AbortSignal;
}>;

class ActionBudget {
  #used = 0;

  consume(amount: number) {
    if (
      !Number.isSafeInteger(amount) ||
      amount < 1 ||
      this.#used + amount > PREDICTION_V2_RESOLUTION_ACTION_MAX_PROVIDER_REQUESTS
    ) {
      actionFail(
        "provider-failure",
        "Prediction V2 resolution-action provider budget was exhausted",
      );
    }
    this.#used += amount;
  }

  get used() {
    return this.#used;
  }
}

class InvocationBudget {
  #used = 0;

  constructor(
    private readonly maximum =
      PREDICTION_V2_RESOLUTION_ACTION_MAX_INVOCATION_PROVIDER_REQUESTS,
  ) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) {
      actionFail("invalid-input", "Prediction V2 invocation budget is invalid");
    }
  }

  consume() {
    if (this.#used >= this.maximum) {
      actionFail(
        "provider-failure",
        "Prediction V2 resolution invocation provider budget was exhausted",
      );
    }
    this.#used += 1;
  }

  get used() {
    return this.#used;
  }
}

function actionFail(
  code: PredictionV2ResolutionActionErrorCode,
  message: string,
): never {
  throw new PredictionV2ResolutionActionError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !HEX_PATTERN.test(value)) {
    return actionFail("provider-failure", `${label} is not canonical hex`);
  }
  return value.toLowerCase() as Hex;
}

function bytes32(
  value: unknown,
  label: string,
  code: PredictionV2ResolutionActionErrorCode = "invalid-input",
): PredictionV2ResolutionBytes32 {
  if (
    typeof value !== "string" ||
    !BYTES32_PATTERN.test(value) ||
    value.toLowerCase() === ZERO_BYTES32
  ) return actionFail(code, `${label} is not a nonzero bytes32 value`);
  return value.toLowerCase() as PredictionV2ResolutionBytes32;
}

function address(
  value: unknown,
  label: string,
  code: PredictionV2ResolutionActionErrorCode = "invalid-input",
): Address {
  if (typeof value !== "string") return actionFail(code, `${label} is not an address`);
  let normalized: Address;
  try {
    normalized = getAddress(value);
  } catch {
    return actionFail(code, `${label} is not an address`);
  }
  if (normalized.toLowerCase() === ZERO_ADDRESS) {
    return actionFail(code, `${label} is the zero address`);
  }
  return normalized;
}

function uint(value: unknown, maximum: bigint, label: string) {
  if (
    (typeof value !== "number" && typeof value !== "bigint") ||
    (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) ||
    (typeof value === "bigint" && value < 0n)
  ) return actionFail("provider-failure", `${label} is not an unsigned integer`);
  const normalized = BigInt(value);
  if (normalized > maximum) {
    return actionFail("provider-failure", `${label} exceeds its Solidity type`);
  }
  return normalized;
}

function sameHex(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function sameAddress(left: Address, right: Address) {
  return sameHex(left, right);
}

function enabledPublicRelease(
  value: PredictionV2PublicReleaseV2,
): PredictionV2EnabledPublicReleaseV2 {
  if (value.status !== "enabled") {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 public release is not enabled",
    );
  }
  return value;
}

function releaseComponent(
  release: PredictionV2EnabledPublicReleaseV2,
  component: PredictionV2EnabledPublicReleaseV2["components"][number]["component"],
) {
  const found = release.components.find((candidate) =>
    candidate.component === component
  );
  if (!found) {
    return actionFail(
      "binding-mismatch",
      `Prediction V2 signed release is missing ${component}`,
    );
  }
  return Object.freeze({
    address: address(found.address, `${component} address`, "binding-mismatch"),
    runtimeCodeHash: bytes32(
      found.runtimeCodeHash,
      `${component} runtime code hash`,
      "binding-mismatch",
    ),
  });
}

function releaseReadBinding(
  release: PredictionV2EnabledPublicReleaseV2,
): PredictionV2ReadBinding {
  try {
    return toPredictionV2ReadBindingFromPublicReleaseV2(release);
  } catch {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 signed read-model binding is invalid",
    );
  }
}

function normalizeBlock(
  value: PredictionV2ResolutionBlock,
  label: string,
): PredictionV2ResolutionBlock {
  if (!isRecord(value) || value.number < 1n || value.timestamp < 0n) {
    return actionFail("provider-failure", `${label} is malformed`);
  }
  return Object.freeze({
    number: value.number,
    hash: bytes32(value.hash, `${label} hash`, "provider-failure"),
    parentHash: bytes32(value.parentHash, `${label} parent hash`, "provider-failure"),
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

function normalizeBinding(
  value: PredictionV2ResolutionReleaseBinding,
): PredictionV2ResolutionReleaseBinding {
  if (!isRecord(value) || value.chainId !== PREDICTION_V2_RESOLUTION_CHAIN_ID) {
    return actionFail("invalid-input", "Prediction V2 resolution action has the wrong binding chain");
  }
  if (
    !Number.isInteger(value.oraclePhaseId) ||
    value.oraclePhaseId < 1 ||
    value.oraclePhaseId > 65_535
  ) return actionFail("invalid-input", "Prediction V2 initial oracle phase is invalid");
  if (
    typeof value.registryRevision !== "bigint" ||
    value.registryRevision < 1n ||
    value.registryRevision > UINT64_MAX
  ) return actionFail("invalid-input", "Prediction V2 registry revision is invalid");
  if (
    value.oracleRoundTopology !==
      PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY
  ) {
    return actionFail(
      "invalid-input",
      "Prediction V2 release has not qualified dense monotone local round IDs",
    );
  }
  if (!sameHex(value.policyHash, PREDICTION_V2_CHAINLINK_RESOLUTION_POLICY_HASH)) {
    return actionFail(
      "invalid-input",
      "Prediction V2 resolution action has an unsupported policy hash",
    );
  }
  return Object.freeze({
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    factory: address(value.factory, "Factory"),
    economicKey: bytes32(value.economicKey, "economic key"),
    marketId: bytes32(value.marketId, "market id"),
    assetRegistry: address(value.assetRegistry, "Asset Registry"),
    assetKey: bytes32(value.assetKey, "asset key"),
    registryRevision: value.registryRevision,
    registrySnapshotHash: bytes32(
      value.registrySnapshotHash,
      "registry snapshot hash",
    ),
    vault: address(value.vault, "Vault"),
    vaultRuntimeCodeHash: bytes32(value.vaultRuntimeCodeHash, "Vault runtime code hash"),
    checkpoint: address(value.checkpoint, "checkpoint"),
    checkpointRuntimeCodeHash: bytes32(
      value.checkpointRuntimeCodeHash,
      "checkpoint runtime code hash",
    ),
    feed: address(value.feed, "feed"),
    feedProxyRuntimeCodeHash: bytes32(
      value.feedProxyRuntimeCodeHash,
      "feed runtime code hash",
    ),
    policyHash: PREDICTION_V2_CHAINLINK_RESOLUTION_POLICY_HASH,
    oracleRoundTopology: PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY,
    oraclePhaseId: value.oraclePhaseId,
    oracleAggregator: address(value.oracleAggregator, "initial aggregator"),
    oracleAggregatorRuntimeCodeHash: bytes32(
      value.oracleAggregatorRuntimeCodeHash,
      "initial aggregator runtime code hash",
    ),
  });
}

function normalizeOutcome(
  value: Hex | PredictionV2ResolutionCallRevert,
  label: string,
): CallOutcome {
  if (typeof value === "string") {
    return Object.freeze({ status: "success", data: exactHex(value, label) });
  }
  if (
    !isRecord(value) ||
    value.status !== "reverted" ||
    Reflect.ownKeys(value).some((key) => typeof key !== "string") ||
    (Reflect.ownKeys(value) as string[]).sort().join(",") !== "data,status"
  ) return actionFail("provider-failure", `${label} is a malformed call result`);
  return Object.freeze({
    status: "reverted",
    data: exactHex(value.data, `${label} revert data`),
  });
}

async function providerRequest<Value>(
  context: Pick<ActionContext, "reader" | "budget">,
  label: string,
  request: () => Promise<Value>,
): Promise<Value> {
  context.budget.consume(1);
  try {
    return await request();
  } catch {
    return actionFail(
      "provider-failure",
      `${label} failed on the release-bound RPC reader`,
    );
  }
}

function normalizeReader(reader: PredictionV2ResolutionRpcReader) {
  if (
    !reader ||
    typeof reader.readerId !== "string" ||
    reader.readerId.trim() === ""
  ) {
    return actionFail(
      "invalid-input",
      "Prediction V2 resolution action requires an identified RPC reader",
    );
  }
  return reader;
}

function meteredReader(
  reader: PredictionV2ResolutionRpcReader,
  budget: InvocationBudget,
): PredictionV2ResolutionRpcReader {
  return Object.freeze({
    readerId: reader.readerId,
    getChainId(signal?: AbortSignal) {
      budget.consume();
      return reader.getChainId(signal);
    },
    getSafeBlock(signal?: AbortSignal) {
      budget.consume();
      return reader.getSafeBlock(signal);
    },
    getBlock(blockNumber: bigint, signal?: AbortSignal) {
      budget.consume();
      return reader.getBlock(blockNumber, signal);
    },
    call(request: PredictionV2ResolutionCallRequest) {
      budget.consume();
      return reader.call(request);
    },
    getCode(request: PredictionV2ResolutionCodeRequest) {
      budget.consume();
      return reader.getCode(request);
    },
  });
}

async function commonBlock(
  reader: PredictionV2ResolutionRpcReader,
  budget: ActionBudget,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const context = { reader, budget };
  const chainId = await providerRequest(
    context,
    "resolution-action chain read",
    () => reader.getChainId(signal),
  );
  if (chainId !== PREDICTION_V2_RESOLUTION_CHAIN_ID) {
    return actionFail("wrong-chain", "Prediction V2 resolution action RPC is not chain 4663");
  }
  const safeRaw = await providerRequest(
    context,
    "resolution-action safe-block read",
    () => reader.getSafeBlock(signal),
  );
  const safe = normalizeBlock(safeRaw, "safe block");
  const blockRaw = await providerRequest(
    context,
    "resolution-action confirmed-block read",
    () => reader.getBlock(safe.number, signal),
  );
  if (!blockRaw) {
    return actionFail("noncanonical-block", "Resolution action confirmed block is unavailable");
  }
  const block = normalizeBlock(blockRaw, "confirmed block");
  if (!sameBlock(block, safe)) {
    return actionFail("noncanonical-block", "Resolution action confirmed block changed during selection");
  }
  return block;
}

async function assertCanonical(context: ActionContext) {
  const raw = await providerRequest(
    context,
    "resolution-action canonical recheck",
    () => context.reader.getBlock(context.block.number, context.signal),
  );
  if (!raw) {
    return actionFail("noncanonical-block", "Resolution action block disappeared");
  }
  const block = normalizeBlock(raw, "rechecked block");
  if (!sameBlock(block, context.block)) {
    return actionFail("noncanonical-block", "Resolution action block was reorganized");
  }
}

async function exactCall(
  context: ActionContext,
  request: Omit<
    PredictionV2ResolutionCallRequest,
    "blockNumber" | "blockHash" | "requireCanonical" | "signal"
  >,
  label: string,
): Promise<CallOutcome> {
  const exactRequest = Object.freeze({
    ...request,
    blockNumber: context.block.number,
    blockHash: context.block.hash,
    requireCanonical: true as const,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  const raw = await providerRequest(
    context,
    label,
    () => context.reader.call(exactRequest),
  );
  return normalizeOutcome(raw, `${label} response`);
}

async function contractResult(
  context: ActionContext,
  to: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] | undefined,
  label: string,
): Promise<unknown> {
  const data = encodeFunctionData({
    abi,
    functionName: functionName as never,
    ...(args ? { args: args as never } : {}),
  });
  const outcome = await exactCall(context, { to, data }, label);
  if (outcome.status === "reverted") {
    return actionFail("provider-failure", `${label} reverted at the confirmed block`);
  }
  try {
    return decodeFunctionResult({
      abi,
      functionName: functionName as never,
      data: outcome.data,
    });
  } catch {
    return actionFail("provider-failure", `${label} returned malformed ABI data`);
  }
}

async function codeHash(
  context: ActionContext,
  target: Address,
  label: string,
): Promise<PredictionV2ResolutionBytes32> {
  const request: PredictionV2ResolutionCodeRequest = Object.freeze({
    address: target,
    blockNumber: context.block.number,
    blockHash: context.block.hash,
    requireCanonical: true,
    ...(context.signal ? { signal: context.signal } : {}),
  });
  const raw = await providerRequest(
    context,
    `${label} code read`,
    () => context.reader.getCode(request),
  );
  const code = exactHex(raw, `${label} code`);
  if (code === "0x") return actionFail("binding-mismatch", `${label} has no runtime code`);
  return keccak256(code).toLowerCase() as PredictionV2ResolutionBytes32;
}

async function registrySnapshotAt(
  context: ActionContext,
  registry: Address,
  assetKey: PredictionV2ResolutionBytes32,
  revision: bigint,
): Promise<PredictionV2RegistrySnapshot> {
  const data = encodeFunctionData({
    abi: PREDICTION_V2_ASSET_REGISTRY_ABI,
    functionName: "getSnapshot",
    args: [assetKey, revision],
  });
  const outcome = await exactCall(
    context,
    { to: registry, data },
    "resolution Registry snapshot read",
  );
  if (outcome.status === "reverted") {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 canonical Registry snapshot is unavailable",
    );
  }
  try {
    return decodePredictionV2RegistrySnapshot(outcome.data, "getSnapshot");
  } catch {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 canonical Registry snapshot is malformed",
    );
  }
}

/**
 * Derives every proof-finder binding field from the signed release graph, the
 * canonical same-snapshot market row, and hash-bound contract reads. No
 * address, code hash, feed, policy, phase, or topology value comes from the
 * request. The signed oracle-qualification gate is the release authority for
 * the dense/monotone local-round topology required by the bounded search.
 */
async function deriveResolutionBinding(
  context: ActionContext,
  release: PredictionV2EnabledPublicReleaseV2,
  market: PredictionV2ReadMarket,
): Promise<PredictionV2ResolutionReleaseBinding> {
  const readBinding = releaseReadBinding(release);
  try {
    assertPredictionV2ReadMarketAtSnapshotProvenance(
      market,
      context.block,
      readBinding,
    );
  } catch {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 market lacks canonical read-model provenance",
    );
  }
  const factory = releaseComponent(release, "GenericPredictionMarketFactoryV2");
  const registry = releaseComponent(release, "AssetRegistryV2");
  const checkpointDeployer = releaseComponent(release, "CheckpointDeployerV2");
  const oracleQualification = release.gates.find(
    ({ gateId }) => gateId === "oracle-qualified-assets",
  );
  if (oracleQualification?.status !== "closed") {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 release has no closed oracle qualification gate",
    );
  }

  const economicKey = bytes32(
    market.economicKey,
    "canonical market economic key",
    "binding-mismatch",
  );
  const marketId = bytes32(
    market.marketId,
    "canonical market id",
    "binding-mismatch",
  );
  const assetKey = bytes32(
    market.assetKey,
    "canonical market asset key",
    "binding-mismatch",
  );
  const registrySnapshotHash = bytes32(
    market.registrySnapshotHash,
    "canonical market Registry snapshot hash",
    "binding-mismatch",
  );
  const policyHash = bytes32(
    market.resolutionPolicyHash,
    "canonical market resolution policy hash",
    "binding-mismatch",
  );
  const vault = address(market.vault, "canonical market Vault", "binding-mismatch");
  const checkpoint = address(
    market.checkpoint,
    "canonical market checkpoint",
    "binding-mismatch",
  );
  const registryRevision = uint(
    market.registryRevision,
    UINT64_MAX,
    "canonical market Registry revision",
  );
  if (registryRevision === 0n) {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 canonical market Registry revision is zero",
    );
  }
  if (!sameHex(policyHash, PREDICTION_V2_CHAINLINK_RESOLUTION_POLICY_HASH)) {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 canonical market uses an unsupported resolution policy",
    );
  }

  const snapshot = await registrySnapshotAt(
    context,
    registry.address,
    assetKey,
    registryRevision,
  );
  const snapshotHash = predictionV2RegistrySnapshotHash(snapshot);
  if (
    !sameHex(snapshot.assetKey, assetKey) ||
    snapshot.revision !== registryRevision ||
    !sameHex(snapshotHash, registrySnapshotHash) ||
    !sameHex(snapshot.policy.checkpointKind, policyHash) ||
    !snapshot.policy.active ||
    snapshot.policy.validUntil < market.predicate.observationTime ||
    snapshot.policy.feedId !== ZERO_BYTES32
  ) {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 canonical market and Registry snapshot differ",
    );
  }
  if (
    !sameAddress(snapshot.policy.checkpointAdapter, checkpointDeployer.address) ||
    !sameHex(
      snapshot.policy.checkpointAdapterCodehash,
      checkpointDeployer.runtimeCodeHash,
    )
  ) {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 Registry checkpoint adapter differs from the signed release",
    );
  }

  const feed = address(
    snapshot.policy.feedAddress,
    "Registry Chainlink feed",
    "binding-mismatch",
  );
  const aggregator = address(
    snapshot.policy.feedAggregator,
    "Registry Chainlink aggregator",
    "binding-mismatch",
  );
  const phase = snapshot.policy.feedPhaseId;
  if (!Number.isInteger(phase) || phase < 1 || phase > 65_535) {
    return actionFail("binding-mismatch", "Prediction V2 Registry phase is invalid");
  }

  const [
    factoryCodeHash,
    registryCodeHash,
    vaultCodeHash,
    checkpointCodeHash,
    feedCodeHash,
    aggregatorCodeHash,
    checkpointFeed,
    checkpointPolicy,
    checkpointDecimals,
    checkpointDescriptionHash,
    checkpointProxyCodeHash,
    checkpointPhase,
    checkpointAggregator,
    checkpointAggregatorCodeHash,
    livePhase,
    liveAggregator,
    livePhaseAggregator,
    liveDecimals,
    liveDescription,
  ] = await Promise.all([
    codeHash(context, factory.address, "signed Factory"),
    codeHash(context, registry.address, "signed Asset Registry"),
    codeHash(context, vault, "canonical Vault"),
    codeHash(context, checkpoint, "canonical checkpoint"),
    codeHash(context, feed, "Registry feed"),
    codeHash(context, aggregator, "Registry aggregator"),
    contractResult(
      context,
      checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "feed",
      undefined,
      "resolution checkpoint feed binding",
    ),
    contractResult(
      context,
      checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "policyHash",
      undefined,
      "resolution checkpoint policy binding",
    ),
    contractResult(
      context,
      checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "feedDecimals",
      undefined,
      "resolution checkpoint decimals binding",
    ),
    contractResult(
      context,
      checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "feedDescriptionHash",
      undefined,
      "resolution checkpoint description binding",
    ),
    contractResult(
      context,
      checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "oracleProxyCodehash",
      undefined,
      "resolution checkpoint proxy-code binding",
    ),
    contractResult(
      context,
      checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "oraclePhaseId",
      undefined,
      "resolution checkpoint phase binding",
    ),
    contractResult(
      context,
      checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "oracleAggregator",
      undefined,
      "resolution checkpoint aggregator binding",
    ),
    contractResult(
      context,
      checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "oracleAggregatorCodehash",
      undefined,
      "resolution checkpoint aggregator-code binding",
    ),
    contractResult(
      context,
      feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "phaseId",
      undefined,
      "resolution live feed phase",
    ),
    contractResult(
      context,
      feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "aggregator",
      undefined,
      "resolution live feed aggregator",
    ),
    contractResult(
      context,
      feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "phaseAggregators",
      [phase],
      "resolution live feed phase aggregator",
    ),
    contractResult(
      context,
      feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "decimals",
      undefined,
      "resolution live feed decimals",
    ),
    contractResult(
      context,
      feed,
      PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      "description",
      undefined,
      "resolution live feed description",
    ),
  ]);

  if (typeof liveDescription !== "string") {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 live feed description is malformed",
    );
  }
  const descriptionHash: PredictionV2ResolutionBytes32 = keccak256(
    toBytes(liveDescription),
  );
  const cloneCodeHash = bytes32(
    release.runtimeDependencies.checkpointCloneRuntimeCodeHash,
    "signed checkpoint clone runtime code hash",
    "binding-mismatch",
  );
  if (
    !sameHex(factoryCodeHash, factory.runtimeCodeHash) ||
    !sameHex(registryCodeHash, registry.runtimeCodeHash) ||
    !sameHex(checkpointCodeHash, cloneCodeHash) ||
    !sameHex(feedCodeHash, snapshot.policy.feedProxyCodehash) ||
    !sameHex(aggregatorCodeHash, snapshot.policy.feedAggregatorCodehash) ||
    !sameAddress(
      address(checkpointFeed, "checkpoint feed", "binding-mismatch"),
      feed,
    ) ||
    !sameHex(
      bytes32(checkpointPolicy, "checkpoint policy", "binding-mismatch"),
      policyHash,
    ) ||
    uint(checkpointDecimals, 255n, "checkpoint feed decimals") !==
      BigInt(snapshot.policy.feedDecimals) ||
    !sameHex(
      bytes32(
        checkpointDescriptionHash,
        "checkpoint feed description hash",
        "binding-mismatch",
      ),
      snapshot.policy.feedDescriptionHash,
    ) ||
    !sameHex(
      bytes32(
        checkpointProxyCodeHash,
        "checkpoint feed proxy code hash",
        "binding-mismatch",
      ),
      snapshot.policy.feedProxyCodehash,
    ) ||
    uint(checkpointPhase, 65_535n, "checkpoint oracle phase") !== BigInt(phase) ||
    !sameAddress(
      address(
        checkpointAggregator,
        "checkpoint oracle aggregator",
        "binding-mismatch",
      ),
      aggregator,
    ) ||
    !sameHex(
      bytes32(
        checkpointAggregatorCodeHash,
        "checkpoint oracle aggregator code hash",
        "binding-mismatch",
      ),
      snapshot.policy.feedAggregatorCodehash,
    ) ||
    uint(livePhase, 65_535n, "live feed phase") !== BigInt(phase) ||
    !sameAddress(
      address(liveAggregator, "live feed aggregator", "binding-mismatch"),
      aggregator,
    ) ||
    !sameAddress(
      address(
        livePhaseAggregator,
        "live phase aggregator",
        "binding-mismatch",
      ),
      aggregator,
    ) ||
    uint(liveDecimals, 255n, "live feed decimals") !==
      BigInt(snapshot.policy.feedDecimals) ||
    !sameHex(descriptionHash, snapshot.policy.feedDescriptionHash)
  ) {
    return actionFail(
      "binding-mismatch",
      "Prediction V2 signed release, market, Registry, checkpoint, or feed binding differs",
    );
  }
  await assertCanonical(context);
  return normalizeBinding(Object.freeze({
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    factory: factory.address,
    economicKey,
    marketId,
    assetRegistry: registry.address,
    assetKey,
    registryRevision,
    registrySnapshotHash,
    vault,
    vaultRuntimeCodeHash: vaultCodeHash,
    checkpoint,
    checkpointRuntimeCodeHash: checkpointCodeHash,
    feed,
    feedProxyRuntimeCodeHash: feedCodeHash,
    policyHash: PREDICTION_V2_CHAINLINK_RESOLUTION_POLICY_HASH,
    oracleRoundTopology: PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY,
    oraclePhaseId: phase,
    oracleAggregator: aggregator,
    oracleAggregatorRuntimeCodeHash: aggregatorCodeHash,
  }));
}

async function readLifecycleAt(
  context: ActionContext,
  binding: PredictionV2ResolutionReleaseBinding,
): Promise<PredictionV2ResolutionLifecycleSnapshot> {
  const [
    vaultCodeHash,
    checkpointCodeHash,
    feedCodeHash,
    aggregatorCodeHash,
    vaultCheckpoint,
    vaultPolicy,
    rawVaultState,
    rawCheckpointStatus,
    checkpointFeed,
    checkpointPolicy,
    observationTime,
    resolutionDeadline,
    hardResolutionDeadline,
    fallbackRequestedAt,
    fallbackChallengeDeadline,
  ] = await Promise.all([
    codeHash(context, binding.vault, "Vault"),
    codeHash(context, binding.checkpoint, "checkpoint"),
    codeHash(context, binding.feed, "feed"),
    codeHash(context, binding.oracleAggregator, "initial aggregator"),
    contractResult(
      context,
      binding.vault,
      PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
      "checkpoint",
      undefined,
      "Vault checkpoint",
    ),
    contractResult(
      context,
      binding.vault,
      PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
      "oraclePolicyHash",
      undefined,
      "Vault policy",
    ),
    contractResult(
      context,
      binding.vault,
      PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
      "state",
      undefined,
      "Vault state",
    ),
    contractResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "status",
      undefined,
      "checkpoint status",
    ),
    contractResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "feed",
      undefined,
      "checkpoint feed",
    ),
    contractResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "policyHash",
      undefined,
      "checkpoint policy",
    ),
    contractResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "observationTime",
      undefined,
      "checkpoint observation time",
    ),
    contractResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "resolutionDeadline",
      undefined,
      "checkpoint resolution deadline",
    ),
    contractResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "hardResolutionDeadline",
      undefined,
      "checkpoint hard resolution deadline",
    ),
    contractResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "fallbackRequestedAt",
      undefined,
      "checkpoint fallback request",
    ),
    contractResult(
      context,
      binding.checkpoint,
      PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
      "fallbackChallengeDeadline",
      undefined,
      "checkpoint fallback challenge deadline",
    ),
  ]);

  const vaultCheckpointAddress = address(
    vaultCheckpoint,
    "Vault checkpoint result",
    "provider-failure",
  );
  const checkpointFeedAddress = address(
    checkpointFeed,
    "checkpoint feed result",
    "provider-failure",
  );
  const vaultPolicyHash = bytes32(vaultPolicy, "Vault policy result", "provider-failure");
  const checkpointPolicyHash = bytes32(
    checkpointPolicy,
    "checkpoint policy result",
    "provider-failure",
  );
  if (
    !sameHex(vaultCodeHash, binding.vaultRuntimeCodeHash) ||
    !sameHex(checkpointCodeHash, binding.checkpointRuntimeCodeHash) ||
    !sameHex(feedCodeHash, binding.feedProxyRuntimeCodeHash) ||
    !sameHex(aggregatorCodeHash, binding.oracleAggregatorRuntimeCodeHash) ||
    !sameAddress(vaultCheckpointAddress, binding.checkpoint) ||
    !sameAddress(checkpointFeedAddress, binding.feed) ||
    !sameHex(vaultPolicyHash, binding.policyHash) ||
    !sameHex(checkpointPolicyHash, binding.policyHash)
  ) return actionFail("binding-mismatch", "Resolution action release binding changed");

  const vaultStateValue = uint(rawVaultState, 3n, "Vault state");
  const checkpointStatusValue = uint(rawCheckpointStatus, 2n, "checkpoint status");
  const observation = uint(observationTime, UINT32_MAX, "observation time");
  const soft = uint(resolutionDeadline, UINT32_MAX, "resolution deadline");
  const hard = uint(hardResolutionDeadline, UINT32_MAX, "hard resolution deadline");
  const requested = uint(fallbackRequestedAt, UINT32_MAX, "fallback requested at");
  const challenge = uint(
    fallbackChallengeDeadline,
    UINT32_MAX,
    "fallback challenge deadline",
  );
  if (
    observation === 0n ||
    observation + PREDICTION_V2_SOFT_RESOLUTION_OFFSET_SECONDS !== soft ||
    observation + PREDICTION_V2_HARD_FALLBACK_OFFSET_SECONDS !== hard ||
    (requested === 0n && challenge !== 0n) ||
    (requested !== 0n &&
      (requested < hard ||
        requested > context.block.timestamp ||
        requested + PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS !== challenge))
  ) return actionFail("invalid-lifecycle", "Resolution action deadlines are inconsistent");

  const vaultStates = ["OPEN", "FINAL_YES", "FINAL_NO", "FINAL_INVALID"] as const;
  const checkpointStatuses = ["AWAITING", "FINAL", "INVALID"] as const;
  const vaultState = vaultStates[Number(vaultStateValue)];
  const checkpointStatus = checkpointStatuses[Number(checkpointStatusValue)];
  if (
    ((vaultState === "FINAL_YES" || vaultState === "FINAL_NO") &&
      checkpointStatus !== "FINAL") ||
    (vaultState === "FINAL_INVALID" && checkpointStatus !== "INVALID")
  ) {
    return actionFail(
      "invalid-lifecycle",
      "Resolution action Vault and checkpoint terminal states are inconsistent",
    );
  }
  return Object.freeze({
    block: context.block,
    vaultState,
    checkpointStatus,
    observationTime: observation,
    resolutionDeadline: soft,
    hardResolutionDeadline: hard,
    fallbackRequestedAt: requested,
    fallbackChallengeDeadline: challenge,
  });
}

async function lifecycleSnapshot(input: Readonly<{
  reader: PredictionV2ResolutionRpcReader;
  binding: PredictionV2ResolutionReleaseBinding;
  signal?: AbortSignal;
}>) {
  const budget = new ActionBudget();
  const block = await commonBlock(input.reader, budget, input.signal);
  const context: ActionContext = Object.freeze({
    reader: input.reader,
    block,
    budget,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const lifecycle = await readLifecycleAt(context, input.binding);
  await assertCanonical(context);
  return Object.freeze({ context, lifecycle });
}

async function lifecycleAtExactBlock(input: Readonly<{
  reader: PredictionV2ResolutionRpcReader;
  binding: PredictionV2ResolutionReleaseBinding;
  block: PredictionV2ResolutionBlock;
  signal?: AbortSignal;
}>) {
  const budget = new ActionBudget();
  const context: ActionContext = Object.freeze({
    reader: input.reader,
    block: normalizeBlock(input.block, "resolution action proof block"),
    budget,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const chainId = await providerRequest(
    context,
    "resolution-action proof-block chain read",
    () => input.reader.getChainId(input.signal),
  );
  if (chainId !== PREDICTION_V2_RESOLUTION_CHAIN_ID) {
    return actionFail("wrong-chain", "Prediction V2 proof-block RPC is not chain 4663");
  }
  const lifecycle = await readLifecycleAt(context, input.binding);
  await assertCanonical(context);
  return Object.freeze({ context, lifecycle });
}

function selector(data: Hex): Hex {
  if (data.length < 10) return actionFail("simulation-failed", "Resolution action has no selector");
  return data.slice(0, 10) as Hex;
}

function proofAction(
  prepared: PredictionV2ResolutionPreparedTransaction,
  lifecycle: PredictionV2ResolutionLifecycleSnapshot,
  providerRequests: number,
): PredictionV2ResolutionActionCandidate {
  return Object.freeze({
    schemaVersion: 2 as const,
    decision: "action" as const,
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    action: "finalize-with-proof" as const,
    account: prepared.from,
    snapshot: prepared.validAtBlock,
    binding: prepared.candidate.binding,
    transaction: Object.freeze({
      to: prepared.to,
      data: prepared.data,
      selector: selector(prepared.data),
      value: 0n as const,
    }),
    expected: Object.freeze({
      checkpointStatus: prepared.simulation.checkpointStatus,
      vaultState: prepared.simulation.vaultState,
      fallbackChallengeDeadline: lifecycle.fallbackChallengeDeadline,
    }),
    proofCommitment: prepared.candidate.commitment,
    providerRequests,
  });
}

async function simulateNoArg(
  context: ActionContext,
  binding: PredictionV2ResolutionReleaseBinding,
  lifecycle: PredictionV2ResolutionLifecycleSnapshot,
  account: Address,
  action: Exclude<PredictionV2ResolutionAction, "finalize-with-proof">,
  allowRevert = false,
): Promise<PredictionV2ResolutionActionCandidate | null> {
  const functionName = {
    "finalize-unavailable": "finalizeUnavailable",
    "request-unproven-fallback": "requestUnprovenFallback",
    "finalize-unproven": "finalizeUnproven",
    "finalize-resolved": "finalizeResolved",
  }[action];
  const data = encodeFunctionData({
    abi: PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
    functionName: functionName as never,
  });
  const outcome = await exactCall(
    context,
    { to: binding.vault, data, from: account, value: 0n },
    `Vault ${functionName} simulation`,
  );
  if (outcome.status === "reverted") {
    if (allowRevert) {
      await assertCanonical(context);
      return null;
    }
    return actionFail("simulation-failed", `Vault ${functionName} simulation reverted`);
  }
  let rawResult: unknown;
  try {
    rawResult = decodeFunctionResult({
      abi: PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
      functionName: functionName as never,
      data: outcome.data,
    });
  } catch {
    return actionFail("simulation-failed", `Vault ${functionName} simulation was malformed`);
  }

  let expectedCheckpointStatus: "AWAITING" | "FINAL" | "INVALID";
  let expectedVaultState: "OPEN" | "FINAL_YES" | "FINAL_NO" | "FINAL_INVALID";
  let expectedChallenge = lifecycle.fallbackChallengeDeadline;
  if (action === "request-unproven-fallback") {
    const returnedChallenge = uint(rawResult, UINT32_MAX, "fallback simulation result");
    expectedChallenge = context.block.timestamp + PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS;
    if (returnedChallenge !== expectedChallenge || expectedChallenge > UINT32_MAX) {
      return actionFail("simulation-failed", "Fallback request simulation returned the wrong deadline");
    }
    expectedCheckpointStatus = "AWAITING";
    expectedVaultState = "OPEN";
  } else {
    const returnedState = uint(rawResult, 3n, `${functionName} simulation result`);
    if (action === "finalize-resolved") {
      expectedCheckpointStatus = lifecycle.checkpointStatus;
      const consistent = lifecycle.checkpointStatus === "FINAL"
        ? returnedState === 1n || returnedState === 2n
        : lifecycle.checkpointStatus === "INVALID" && returnedState === 3n;
      if (!consistent) {
        return actionFail("simulation-failed", "finalizeResolved simulation disagrees with checkpoint");
      }
    } else {
      expectedCheckpointStatus = "INVALID";
      if (returnedState !== 3n) {
        return actionFail("simulation-failed", `${functionName} did not neutralize the Vault`);
      }
    }
    expectedVaultState = returnedState === 1n
      ? "FINAL_YES"
      : returnedState === 2n
        ? "FINAL_NO"
        : "FINAL_INVALID";
  }
  await assertCanonical(context);
  return Object.freeze({
    schemaVersion: 2 as const,
    decision: "action" as const,
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    action,
    account,
    snapshot: context.block,
    binding,
    transaction: Object.freeze({
      to: binding.vault,
      data,
      selector: selector(data),
      value: 0n as const,
    }),
    expected: Object.freeze({
      checkpointStatus: expectedCheckpointStatus,
      vaultState: expectedVaultState,
      fallbackChallengeDeadline: expectedChallenge,
    }),
    providerRequests: context.budget.used,
  });
}

function wait(
  lifecycle: PredictionV2ResolutionLifecycleSnapshot,
  reason: PredictionV2ResolutionWaitReason,
): PredictionV2ResolutionWaitDecision {
  return Object.freeze({
    schemaVersion: 2 as const,
    decision: "wait" as const,
    reason,
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    snapshot: lifecycle,
    providerRequests: 0,
  });
}

function noAction(
  lifecycle: PredictionV2ResolutionLifecycleSnapshot,
): PredictionV2ResolutionNoActionDecision {
  return Object.freeze({
    schemaVersion: 2 as const,
    decision: "no-action" as const,
    reason: "vault-terminal" as const,
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    snapshot: lifecycle,
    providerRequests: 0,
  });
}

function withInvocationProviderRequests(
  decision: PredictionV2ResolutionActionDecision,
  providerRequests: number,
): PredictionV2ResolutionActionDecision {
  return Object.freeze({ ...decision, providerRequests });
}

function toleratedProofAbsence(error: unknown) {
  return error instanceof PredictionV2ResolutionProofError &&
    (
      error.code === "proof-unavailable" ||
      error.code === "invalid-round" ||
      error.code === "request-budget-exceeded" ||
      error.code === "checkpoint-terminal"
    );
}

async function decideOnce(input: Readonly<{
  reader: PredictionV2ResolutionRpcReader;
  binding: PredictionV2ResolutionReleaseBinding;
  account: Address;
  signal?: AbortSignal;
}>): Promise<PredictionV2ResolutionActionDecision> {
  let current = await lifecycleSnapshot(input);
  let lifecycle = current.lifecycle;
  if (lifecycle.vaultState !== "OPEN") return noAction(lifecycle);
  if (lifecycle.checkpointStatus !== "AWAITING") {
    const resolved = await simulateNoArg(
      current.context,
      input.binding,
      lifecycle,
      input.account,
      "finalize-resolved",
    );
    if (!resolved) return actionFail("simulation-failed", "finalizeResolved was not simulated");
    return resolved;
  }
  if (lifecycle.block.timestamp <= lifecycle.observationTime) {
    return wait(lifecycle, "observation-not-elapsed");
  }

  let proofBounded = false;
  try {
    const candidate = await findPredictionV2ResolutionProof({
      reader: input.reader,
      binding: input.binding,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const prepared = await revalidateAndSimulatePredictionV2Resolution({
      reader: input.reader,
      binding: input.binding,
      candidate,
      sender: input.account,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const proofLifecycle = await lifecycleAtExactBlock({
      reader: input.reader,
      binding: input.binding,
      block: prepared.validAtBlock,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (
      proofLifecycle.lifecycle.vaultState !== "OPEN" ||
      proofLifecycle.lifecycle.checkpointStatus !== "AWAITING"
    ) {
      return actionFail(
        "resolution-race",
        "Resolution state changed at the prepared proof block",
      );
    }
    return proofAction(
      prepared,
      proofLifecycle.lifecycle,
      current.context.budget.used + candidate.providerRequests +
        prepared.providerRequests + proofLifecycle.context.budget.used,
    );
  } catch (error) {
    if (
      error instanceof PredictionV2ResolutionProofError &&
      error.code === "candidate-changed"
    ) {
      return actionFail("resolution-race", "Resolution proof changed during preparation");
    }
    if (!toleratedProofAbsence(error)) throw error;
    proofBounded = error instanceof PredictionV2ResolutionProofError &&
      error.code === "request-budget-exceeded";
  }

  current = await lifecycleSnapshot(input);
  lifecycle = current.lifecycle;
  if (lifecycle.vaultState !== "OPEN") return noAction(lifecycle);
  if (lifecycle.checkpointStatus !== "AWAITING") {
    const resolved = await simulateNoArg(
      current.context,
      input.binding,
      lifecycle,
      input.account,
      "finalize-resolved",
    );
    if (!resolved) return actionFail("simulation-failed", "finalizeResolved was not simulated");
    return resolved;
  }
  if (lifecycle.block.timestamp <= lifecycle.observationTime) {
    return wait(lifecycle, "observation-not-elapsed");
  }

  let softUnavailableRejected = false;
  if (lifecycle.block.timestamp >= lifecycle.resolutionDeadline) {
    const soft = await simulateNoArg(
      current.context,
      input.binding,
      lifecycle,
      input.account,
      "finalize-unavailable",
      true,
    );
    if (soft) return soft;
    softUnavailableRejected = true;
  }

  if (lifecycle.fallbackRequestedAt !== 0n) {
    if (lifecycle.block.timestamp > lifecycle.fallbackChallengeDeadline) {
      const unproven = await simulateNoArg(
        current.context,
        input.binding,
        lifecycle,
        input.account,
        "finalize-unproven",
        true,
      );
      return unproven ?? wait(
        lifecycle,
        "unproven-terminalization-not-admissible",
      );
    }
    return wait(lifecycle, "fallback-challenge-active");
  }

  if (lifecycle.block.timestamp >= lifecycle.hardResolutionDeadline) {
    const fallback = await simulateNoArg(
      current.context,
      input.binding,
      lifecycle,
      input.account,
      "request-unproven-fallback",
      true,
    );
    return fallback ?? wait(lifecycle, "hard-fallback-not-admissible");
  }
  if (softUnavailableRejected) return wait(lifecycle, "soft-unavailable-not-proven");
  if (proofBounded) return wait(lifecycle, "proof-search-bounded");
  return wait(lifecycle, "awaiting-post-t-round");
}

/**
 * Closed, release-dark resolution decision. It never broadcasts: action
 * results are unsigned, exact-block candidates for the prepared-transaction
 * envelope. A single proof race is retried once; a second race fails closed.
 */
export async function decidePredictionV2ResolutionAction(input: Readonly<{
  reader: PredictionV2ResolutionRpcReader;
  binding: PredictionV2ResolutionReleaseBinding;
  account: Address;
  signal?: AbortSignal;
}>): Promise<PredictionV2ResolutionActionDecision> {
  const invocationBudget = new InvocationBudget();
  const reader = meteredReader(normalizeReader(input.reader), invocationBudget);
  const binding = normalizeBinding(input.binding);
  const account = address(input.account, "resolution account");
  const normalized = Object.freeze({
    reader,
    binding,
    account,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  let decision: PredictionV2ResolutionActionDecision;
  try {
    decision = await decideOnce(normalized);
  } catch (error) {
    if (
      !(error instanceof PredictionV2ResolutionActionError) ||
      error.code !== "resolution-race"
    ) throw error;
    try {
      decision = await decideOnce(normalized);
    } catch (retryError) {
      if (
        retryError instanceof PredictionV2ResolutionActionError &&
        retryError.code === "resolution-race"
      ) {
        return actionFail(
          "resolution-race",
          "Resolution state changed twice during preparation",
        );
      }
      throw retryError;
    }
  }
  return withInvocationProviderRequests(decision, invocationBudget.used);
}

/**
 * The only production Resolution entrypoint. It accepts only market identity,
 * never a Resolution binding. The canonical signed release binds the RPC and
 * shared-budget policies; one leased snapshot then supplies the verified
 * read-model row and every derived resolution authority before an unsigned
 * decision is returned. The injected engine above is a test/review boundary.
 */
export async function decidePredictionV2ResolutionActionFromPublicRelease(input: Readonly<{
  reader: PredictionV2ActionRpcSessionReader;
  budget: PredictionV2DistributedBudgetV2;
  economicKey: PredictionV2ResolutionBytes32;
  marketId: PredictionV2ResolutionBytes32;
  account: Address;
  signal?: AbortSignal;
}>): Promise<PredictionV2ResolutionActionDecision> {
  const release = enabledPublicRelease(getPredictionV2PublicReleaseV2());
  const economicKey = bytes32(input.economicKey, "requested economic key");
  const marketId = bytes32(input.marketId, "requested market id");
  const session = await createPredictionV2PublicReleaseRpcSession(
    release,
    input.reader,
    input.budget,
    input.signal,
  );
  try {
    if (
      session.rpcLogicalCalls !==
        PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS
    ) {
      return actionFail(
        "provider-failure",
        "Prediction V2 release-session cost differs from the signed bound",
      );
    }
    const invocationBudget = new InvocationBudget(
      PREDICTION_V2_RESOLUTION_PUBLIC_RELEASE_MAX_PROVIDER_REQUESTS -
        session.rpcLogicalCalls,
    );
    const reader = meteredReader(session.reader, invocationBudget);
    let marketRead: PredictionV2MarketAtSnapshotRead;
    try {
      marketRead = await readPredictionV2MarketAtSnapshot({
        reader,
        binding: releaseReadBinding(release),
        economicKey,
        snapshot: session.snapshot,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch {
      input.signal?.throwIfAborted();
      return actionFail(
        "binding-mismatch",
        "Prediction V2 canonical market is unavailable at the Action snapshot",
      );
    }
    const { market } = marketRead;
    if (!sameHex(market.economicKey, economicKey) || !sameHex(market.marketId, marketId)) {
      return actionFail(
        "binding-mismatch",
        "Prediction V2 requested market identity differs from the canonical row",
      );
    }
    const context: ActionContext = Object.freeze({
      reader,
      block: marketRead.snapshot,
      budget: new ActionBudget(),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const binding = await deriveResolutionBinding(
      context,
      release,
      market,
    );
    const decision = await decidePredictionV2ResolutionAction({
      reader,
      binding,
      account: input.account,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    return withInvocationProviderRequests(
      decision,
      session.rpcLogicalCalls + invocationBudget.used,
    );
  } finally {
    session.close();
  }
}
