import "server-only";

import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { keccak256, toBytes, type Hex } from "viem";

import publicReleaseJson from "../../config/prediction-v2-public-release.v2.json";
import { canonicalizeJson } from "../server/projection-target/canonical-json";
import {
  PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_COMMITMENT_DOMAIN,
  PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_VERSION,
  PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION,
  assertPredictionV2DistributedBudgetRuntimeV2,
  type PredictionV2DistributedBudgetRuntimeProjectionV2,
  type PredictionV2DistributedBudgetV2,
} from "./distributed-budget-v2.server";
import type { PredictionMarketCanonicalReleaseV2 } from
  "./public-market-view-v2";
import type { PredictionV2ReadBinding } from "./read-model-v2.server";
import { PREDICTION_V2_ROUTE_LOGICAL_RPC_COSTS_V2 } from
  "./logical-rpc-costs-v2";
import {
  assertPredictionV2ProductionActionRpcSession,
  createPredictionV2ActionRpcSnapshotLease,
  PREDICTION_V2_ACTION_CONFIRMATION_DEPTH,
  PREDICTION_V2_ACTION_SNAPSHOT_NEGOTIATION_RPC_LOGICAL_CALLS,
  PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS,
  predictionV2ActionRpcRuntimeProjection,
  toPredictionV2ActionRpcSnapshotReader,
  type PredictionV2ActionRpcSessionReader,
  type PredictionV2ActionRpcHistoricalSnapshotV2,
  type PredictionV2ActionRpcSnapshotLease,
  type PredictionV2RpcSessionReader,
} from "./rpc-session-v2.server";
import { PREDICTION_V2_RPC_LIMITS } from "./rpc-reader-v2.server";

export const PREDICTION_V2_PUBLIC_RELEASE_SCHEMA =
  "programmable.prediction-v2-public-release.v2" as const;
export const PREDICTION_V2_PUBLIC_RELEASE_VERSION = "prediction-v2" as const;
export const PREDICTION_V2_PROTOCOL_RELEASE_ID = "protocol-v2" as const;
export const PREDICTION_V2_PROTOCOL_REPOSITORY =
  "0xprogrammable/programmable-prediction-markets" as const;
export const PREDICTION_V2_SETTLEMENT_NETWORK_ID = "eip155:4663" as const;
export const PREDICTION_V2_SETTLEMENT_CHAIN_ID = 4_663 as const;

const RELEASE_MANIFEST_PATH = "releases/protocol-v2/manifest.json" as const;
const DEPENDENCY_SOURCES_PATH =
  "releases/protocol-v2/dependency-sources.json" as const;
const EXECUTION_ENVIRONMENT =
  "ROBINHOOD_CHAIN_4663_CANCUN_EIP1153" as const;
const USDG_ADDRESS = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const;
const POOL_MANAGER_ADDRESS =
  "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;
const CREATE2_DEPLOYER_ADDRESS =
  "0x4e59b44847b379578588920ca78fbf26c0b4956c" as const;
const EIP_1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
const EMPTY_CODE_HASH =
  "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const SIGNING_DOMAIN = "PROGRAMMABLE_PREDICTION_V2_PUBLIC_RELEASE_V2";
const RPC_COMMITMENT_DOMAINS = Object.freeze({
  provider: "programmable:prediction-v2:rpc-provider:v1\0",
  vendor: "programmable:prediction-v2:rpc-vendor:v1\0",
} as const);
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const ZERO_SHA256 = `sha256:${"0".repeat(64)}`;

const DISABLED_KEYS = Object.freeze([
  "schemaVersion",
  "releaseVersion",
  "status",
] as const);
const ENABLED_KEYS = Object.freeze([
  "schemaVersion",
  "releaseVersion",
  "status",
  "release",
  "components",
  "runtimeDependencies",
  "registrySnapshot",
  "rpcCommitment",
  "distributedBudgetPolicy",
  "distributedBudgetPolicyCommitment",
  "gates",
  "graphCommitments",
  "attestation",
] as const);
const UNSIGNED_ENABLED_KEYS = ENABLED_KEYS.filter(
  (key) => key !== "attestation",
);

export const PREDICTION_V2_COMPONENT_SPECS = Object.freeze([
  Object.freeze({
    component: "AssetRegistryV2",
    contractIdentifier: "src/AssetRegistryV2.sol:AssetRegistryV2",
  }),
  Object.freeze({
    component: "GlobalExposureControllerV2",
    contractIdentifier:
      "src/GlobalExposureControllerV2.sol:GlobalExposureControllerV2",
  }),
  Object.freeze({
    component: "FeeVaultV2",
    contractIdentifier: "src/FeeVaultV2.sol:FeeVaultV2",
  }),
  Object.freeze({
    component: "ExecutionRouterV2",
    contractIdentifier: "src/ExecutionRouterV2.sol:ExecutionRouterV2",
  }),
  Object.freeze({
    component: "BootstrapLockerV2",
    contractIdentifier: "src/BootstrapLockerV2.sol:BootstrapLockerV2",
  }),
  Object.freeze({
    component: "LifecycleHookV2",
    contractIdentifier: "src/LifecycleHookV2.sol:LifecycleHookV2",
  }),
  Object.freeze({
    component: "GenericMarketMetadataRenderer",
    contractIdentifier:
      "src/GenericMarketMetadataRenderer.sol:GenericMarketMetadataRenderer",
  }),
  Object.freeze({
    component: "OutcomeTokenDeployerV1",
    contractIdentifier: "src/OutcomeTokenDeployerV1.sol:OutcomeTokenDeployerV1",
  }),
  Object.freeze({
    component: "ChainlinkRoundCheckpointV2Implementation",
    contractIdentifier:
      "src/ChainlinkRoundCheckpointV2.sol:ChainlinkRoundCheckpointV2",
  }),
  Object.freeze({
    component: "CheckpointDeployerV2",
    contractIdentifier: "src/CheckpointDeployerV2.sol:CheckpointDeployerV2",
  }),
  Object.freeze({
    component: "MarketDeployerV2",
    contractIdentifier: "src/MarketDeployerV2.sol:MarketDeployerV2",
  }),
  Object.freeze({
    component: "GenericPredictionMarketFactoryV2",
    contractIdentifier:
      "src/GenericPredictionMarketFactoryV2.sol:GenericPredictionMarketFactoryV2",
  }),
  Object.freeze({
    component: "PredictionQuoterV2",
    contractIdentifier: "src/PredictionQuoterV2.sol:PredictionQuoterV2",
  }),
] as const);

export const PREDICTION_V2_REQUIRED_RELEASE_GATES = Object.freeze([
  "contract-semantics-frozen",
  "oracle-qualified-assets",
  "exact-source-tests-and-analysis",
  "independent-security-review",
  "onchain-deployment-and-source-readback",
  "lifecycle-and-fee-canaries",
  "application-release",
] as const);

type Sha256 = `sha256:${string}`;
type Bytes32 = `0x${string}`;
type EvmAddress = `0x${string}`;
type PredictionV2RpcVendorGroup = "alchemy" | "drpc" | "quicknode";

const SIGNED_BUDGET_MAXIMUM_LANES = 128;
const SIGNED_BUDGET_MAXIMUM_CAPACITY_UNITS = 1_000_000_000;
const SIGNED_BUDGET_MINIMUM_WINDOW_MS = 1_000;
const SIGNED_BUDGET_MAXIMUM_WINDOW_MS = 86_400_000;
const SIGNED_BUDGET_MAXIMUM_LEASE_TTL_MS = 60_000;
const SIGNED_BUDGET_MAXIMUM_IDEMPOTENCY_TTL_MS = 172_800_000;
const SIGNED_BUDGET_MAXIMUM_BACKEND_TIMEOUT_MS = 30_000;
const REQUIRED_SIGNED_BUDGET_PROVIDER = "robinhood-settlement-rpc" as const;
const REQUIRED_SIGNED_BUDGET_UNIT = "rpc-logical-call" as const;
const REQUIRED_SIGNED_BUDGET_LANES = Object.freeze([
  Object.freeze({
    action: "directory" as const,
    exactUnitsPerAction: PREDICTION_V2_ROUTE_LOGICAL_RPC_COSTS_V2.directory,
  }),
  Object.freeze({
    action: "redeem-prepare" as const,
    exactUnitsPerAction:
      PREDICTION_V2_ROUTE_LOGICAL_RPC_COSTS_V2["redeem-prepare"],
  }),
  Object.freeze({
    action: "resolution-decision" as const,
    exactUnitsPerAction:
      PREDICTION_V2_ROUTE_LOGICAL_RPC_COSTS_V2["resolution-decision"],
  }),
]);

export function predictionV2PublicReleaseRpcIdentityCommitment(
  scope: keyof typeof RPC_COMMITMENT_DOMAINS,
  value: string,
): Bytes32 {
  return keccak256(toBytes(`${RPC_COMMITMENT_DOMAINS[scope]}${value}`));
}

export type PredictionV2PublicReleaseTrustRoot = Readonly<{
  algorithm: "Ed25519";
  keyId: string;
  publicKeySpkiBase64Url: string;
  publicKeySpkiSha256: Sha256;
}>;

type Component = Readonly<{
  component: (typeof PREDICTION_V2_COMPONENT_SPECS)[number]["component"];
  address: EvmAddress;
  deploymentBlock: string;
  runtimeCodeHash: Bytes32;
  contractIdentifier:
    (typeof PREDICTION_V2_COMPONENT_SPECS)[number]["contractIdentifier"];
  sourceVerificationInputSha256: Sha256;
}>;

type ReleaseIdentity = Readonly<{
  releaseId: typeof PREDICTION_V2_PROTOCOL_RELEASE_ID;
  manifestStatus: "live";
  repository: typeof PREDICTION_V2_PROTOCOL_REPOSITORY;
  sourceCommit: string;
  sourceTree: string;
  manifestPath: typeof RELEASE_MANIFEST_PATH;
  manifestSha256: Sha256;
  dependencySourcesPath: typeof DEPENDENCY_SOURCES_PATH;
  dependencySourcesSha256: Sha256;
  projectionAttestorAddress: EvmAddress;
}>;

type RuntimeDependency = Readonly<{
  address: EvmAddress;
  runtimeCodeHash: Bytes32;
}>;

type RuntimeDependencies = Readonly<{
  executionEnvironment: typeof EXECUTION_ENVIRONMENT;
  usdg: Readonly<{
    proxy: typeof USDG_ADDRESS;
    proxyRuntimeCodeHash: Bytes32;
    implementationSlot: typeof EIP_1967_IMPLEMENTATION_SLOT;
    implementation: EvmAddress;
    implementationRuntimeCodeHash: Bytes32;
    decimals: 6;
    permitDomain: Readonly<{
      separator: Bytes32;
      chainId: typeof PREDICTION_V2_SETTLEMENT_CHAIN_ID;
      verifyingContract: typeof USDG_ADDRESS;
    }>;
  }>;
  poolManager: RuntimeDependency;
  create2Deployer: RuntimeDependency;
  checkpointCloneRuntimeCodeHash: Bytes32;
  readbackBlockNumber: string;
  readbackBlockHash: Bytes32;
  runtimeReadbackEvidenceSha256: Sha256;
}>;

type RegistrySnapshot = Readonly<{
  networkId: typeof PREDICTION_V2_SETTLEMENT_NETWORK_ID;
  chainId: typeof PREDICTION_V2_SETTLEMENT_CHAIN_ID;
  registryAddress: EvmAddress;
  snapshotHash: Bytes32;
  blockNumber: string;
  blockHash: Bytes32;
  activePolicyCount: number;
  snapshotArtifactSha256: Sha256;
}>;

type RpcCommitment = Readonly<{
  networkId: typeof PREDICTION_V2_SETTLEMENT_NETWORK_ID;
  chainId: typeof PREDICTION_V2_SETTLEMENT_CHAIN_ID;
  confirmedBlockNumber: string;
  confirmedBlockHash: Bytes32;
  snapshotPolicy: Readonly<{
    kind: "action";
    confirmationDepth: number;
  }>;
  transportPolicy: typeof PREDICTION_V2_RPC_LIMITS;
  readStrategy: "single-eip-1898-confirmed-block-hash-v1";
  requireCanonical: true;
  requiredProviderCount: 1;
  provider: Readonly<{
    role: "settlement";
    providerId: string;
    providerCommitment: Bytes32;
    vendorGroup: PredictionV2RpcVendorGroup;
    vendorCommitment: Bytes32;
    endpointCommitment: Bytes32;
    endpointOriginCommitment: Bytes32;
    batchMode: "batch" | "solo";
  }>;
  evidenceSha256: Sha256;
}>;

export type PredictionV2RuntimeRpcCommitmentProjection = Readonly<{
  chainId: typeof PREDICTION_V2_SETTLEMENT_CHAIN_ID;
  snapshotPolicy: RpcCommitment["snapshotPolicy"];
  transportPolicy: RpcCommitment["transportPolicy"];
  provider: RpcCommitment["provider"];
}>;

type ReleaseGate = Readonly<{
  gateId: (typeof PREDICTION_V2_REQUIRED_RELEASE_GATES)[number];
  status: "closed";
  evidenceSha256: Sha256;
}>;

type GraphCommitments = Readonly<{
  releaseSha256: Sha256;
  componentsSha256: Sha256;
  runtimeDependenciesSha256: Sha256;
  registrySnapshotSha256: Sha256;
  rpcCommitmentSha256: Sha256;
  distributedBudgetPolicySha256: Sha256;
  gatesSha256: Sha256;
}>;

export type PredictionV2DisabledPublicReleaseV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_PUBLIC_RELEASE_SCHEMA;
  releaseVersion: typeof PREDICTION_V2_PUBLIC_RELEASE_VERSION;
  status: "disabled";
}>;

export type PredictionV2EnabledPublicReleaseV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_PUBLIC_RELEASE_SCHEMA;
  releaseVersion: typeof PREDICTION_V2_PUBLIC_RELEASE_VERSION;
  status: "enabled";
  release: ReleaseIdentity;
  components: readonly Component[];
  runtimeDependencies: RuntimeDependencies;
  registrySnapshot: RegistrySnapshot;
  rpcCommitment: RpcCommitment;
  distributedBudgetPolicy: PredictionV2DistributedBudgetRuntimeProjectionV2;
  distributedBudgetPolicyCommitment: Sha256;
  gates: readonly ReleaseGate[];
  graphCommitments: GraphCommitments;
  attestation: Readonly<{
    algorithm: "Ed25519";
    keyId: string;
    payloadSha256: Sha256;
    signature: string;
  }>;
}>;

export type PredictionV2PublicReleaseV2 =
  | PredictionV2DisabledPublicReleaseV2
  | PredictionV2EnabledPublicReleaseV2;

/**
 * Deliberately unset. Public activation requires a separate reviewed change
 * that pins the independently controlled production Ed25519 trust root here.
 * Environment variables and self-declared envelope keys are never accepted.
 */
export const PREDICTION_V2_PUBLIC_RELEASE_PRODUCTION_TRUST_ROOT:
  PredictionV2PublicReleaseTrustRoot | null = null;

const PRODUCTION_VERIFIED_ENABLED_PUBLIC_RELEASES = new WeakSet<object>();

function invalidPublicRelease(): never {
  throw new Error("Invalid Prediction V2 public release binding");
}

function closedRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return invalidPublicRelease();
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    return invalidPublicRelease();
  }
  const actualKeys = [...(ownKeys as string[])].sort();
  const requiredKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== requiredKeys.length ||
    actualKeys.some((key, index) => key !== requiredKeys[index])
  ) {
    return invalidPublicRelease();
  }
  for (const key of actualKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !("value" in descriptor)
    ) {
      return invalidPublicRelease();
    }
  }
  return value as Record<string, unknown>;
}

function closedArray(value: unknown, expectedLength: number): unknown[] {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    return invalidPublicRelease();
  }
  const expectedKeys = [
    ...Array.from({ length: expectedLength }, (_, index) => String(index)),
    "length",
  ].sort();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    return invalidPublicRelease();
  }
  const actualKeys = [...(ownKeys as string[])].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    return invalidPublicRelease();
  }
  for (let index = 0; index < expectedLength; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined ||
      !("value" in descriptor)
    ) {
      return invalidPublicRelease();
    }
  }
  return value;
}

function ownDataProperty(
  value: Record<string, unknown>,
  key: string,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    descriptor.get !== undefined ||
    descriptor.set !== undefined ||
    !("value" in descriptor)
  ) {
    return invalidPublicRelease();
  }
  return descriptor.value;
}

function exact<T extends string | number | boolean>(
  value: unknown,
  expected: T,
): T {
  if (value !== expected) return invalidPublicRelease();
  return expected;
}

function identifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/u.test(value)
  ) {
    return invalidPublicRelease();
  }
  return value;
}

function rpcProviderId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{2,63}$/u.test(value)) {
    return invalidPublicRelease();
  }
  return value;
}

function gitObjectId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{40}$/u.test(value) ||
    value === "0".repeat(40)
  ) {
    return invalidPublicRelease();
  }
  return value;
}

function sha256(value: unknown): Sha256 {
  if (
    typeof value !== "string" ||
    !/^sha256:[0-9a-f]{64}$/u.test(value) ||
    value === ZERO_SHA256
  ) {
    return invalidPublicRelease();
  }
  return value as Sha256;
}

function bytes32(value: unknown, codeHash = false): Bytes32 {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(value) ||
    value === ZERO_BYTES32 ||
    (codeHash && value === EMPTY_CODE_HASH)
  ) {
    return invalidPublicRelease();
  }
  return value as Bytes32;
}

function address(value: unknown): EvmAddress {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-f]{40}$/u.test(value) ||
    value === ZERO_ADDRESS
  ) {
    return invalidPublicRelease();
  }
  return value as EvmAddress;
}

function positiveDecimal(value: unknown): string {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    return invalidPublicRelease();
  }
  return value;
}

function positiveSafeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return invalidPublicRelease();
  }
  return value as number;
}

function confirmationDepth(value: unknown): number {
  const parsed = positiveSafeInteger(value);
  if (BigInt(parsed) !== PREDICTION_V2_ACTION_CONFIRMATION_DEPTH) {
    return invalidPublicRelease();
  }
  return parsed;
}

function positiveSafeIntegerAtMost(value: unknown, maximum: number) {
  const parsed = positiveSafeInteger(value);
  if (parsed > maximum) return invalidPublicRelease();
  return parsed;
}

function budgetIdentifier(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/u.test(value)
  ) return invalidPublicRelease();
  return value;
}

function parseDistributedBudgetScopeLimit(value: unknown) {
  const record = closedRecord(value, ["capacityUnits", "windowMs"]);
  return Object.freeze({
    capacityUnits: positiveSafeIntegerAtMost(
      record.capacityUnits,
      SIGNED_BUDGET_MAXIMUM_CAPACITY_UNITS,
    ),
    windowMs: (() => {
      const parsed = positiveSafeIntegerAtMost(
        record.windowMs,
        SIGNED_BUDGET_MAXIMUM_WINDOW_MS,
      );
      if (parsed < SIGNED_BUDGET_MINIMUM_WINDOW_MS) {
        return invalidPublicRelease();
      }
      return parsed;
    })(),
  });
}

function parseDistributedBudgetPolicy(
  value: unknown,
): PredictionV2DistributedBudgetRuntimeProjectionV2 {
  const record = closedRecord(value, [
    "schemaVersion",
    "backend",
    "policy",
    "lanes",
  ]);
  const backend = closedRecord(record.backend, [
    "scope",
    "backendIdCommitment",
  ]);
  const policy = closedRecord(record.policy, ["version", "backendTimeoutMs"]);
  if (
    !Array.isArray(record.lanes) || record.lanes.length < 1 ||
    record.lanes.length > SIGNED_BUDGET_MAXIMUM_LANES
  ) return invalidPublicRelease();
  const laneInput = closedArray(record.lanes, record.lanes.length);
  const providerLimits = new Map<string, string>();
  const laneIds = new Set<string>();
  let previousLaneId: string | undefined;
  const lanes = laneInput.map((candidate) => {
    const lane = closedRecord(candidate, [
      "laneId",
      "provider",
      "action",
      "unit",
      "exactUnitsPerAction",
      "leaseTtlMs",
      "idempotencyTtlMs",
      "capacities",
    ]);
    const provider = budgetIdentifier(lane.provider);
    const action = budgetIdentifier(lane.action);
    const unit = budgetIdentifier(lane.unit);
    const laneId = exact(lane.laneId, `${provider}:${action}`);
    if (
      laneIds.has(laneId) ||
      (previousLaneId !== undefined &&
        previousLaneId.localeCompare(laneId, "en") >= 0)
    ) return invalidPublicRelease();
    laneIds.add(laneId);
    previousLaneId = laneId;
    const exactUnitsPerAction = positiveSafeIntegerAtMost(
      lane.exactUnitsPerAction,
      SIGNED_BUDGET_MAXIMUM_CAPACITY_UNITS,
    );
    const capacitiesRecord = closedRecord(lane.capacities, [
      "provider",
      "action",
      "client",
    ]);
    const capacities = Object.freeze({
      provider: parseDistributedBudgetScopeLimit(capacitiesRecord.provider),
      action: parseDistributedBudgetScopeLimit(capacitiesRecord.action),
      client: parseDistributedBudgetScopeLimit(capacitiesRecord.client),
    });
    if (Object.values(capacities).some(
      ({ capacityUnits }) => capacityUnits < exactUnitsPerAction,
    )) return invalidPublicRelease();
    const leaseTtlMs = positiveSafeIntegerAtMost(
      lane.leaseTtlMs,
      SIGNED_BUDGET_MAXIMUM_LEASE_TTL_MS,
    );
    const windows = Object.values(capacities).map(({ windowMs }) => windowMs);
    if (leaseTtlMs > Math.min(...windows)) return invalidPublicRelease();
    const idempotencyTtlMs = positiveSafeIntegerAtMost(
      lane.idempotencyTtlMs,
      SIGNED_BUDGET_MAXIMUM_IDEMPOTENCY_TTL_MS,
    );
    if (idempotencyTtlMs < Math.max(...windows)) {
      return invalidPublicRelease();
    }
    const providerFingerprint = JSON.stringify({
      unit,
      ...capacities.provider,
    });
    const priorProviderFingerprint = providerLimits.get(provider);
    if (
      priorProviderFingerprint !== undefined &&
      priorProviderFingerprint !== providerFingerprint
    ) return invalidPublicRelease();
    providerLimits.set(provider, providerFingerprint);
    return Object.freeze({
      laneId,
      provider,
      action,
      unit,
      exactUnitsPerAction,
      leaseTtlMs,
      idempotencyTtlMs,
      capacities,
    });
  });
  if (
    lanes.length !== REQUIRED_SIGNED_BUDGET_LANES.length ||
    lanes.some((lane, index) => {
      const required = REQUIRED_SIGNED_BUDGET_LANES[index];
      return !required ||
        lane.provider !== REQUIRED_SIGNED_BUDGET_PROVIDER ||
        lane.action !== required.action ||
        lane.laneId !==
          `${REQUIRED_SIGNED_BUDGET_PROVIDER}:${required.action}` ||
        lane.unit !== REQUIRED_SIGNED_BUDGET_UNIT ||
        lane.exactUnitsPerAction !== required.exactUnitsPerAction;
    })
  ) return invalidPublicRelease();
  return Object.freeze({
    schemaVersion: exact(
      record.schemaVersion,
      PREDICTION_V2_DISTRIBUTED_BUDGET_SCHEMA_VERSION,
    ),
    backend: Object.freeze({
      scope: exact(backend.scope, "shared-atomic"),
      backendIdCommitment: sha256(backend.backendIdCommitment),
    }),
    policy: Object.freeze({
      version: exact(
        policy.version,
        PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_VERSION,
      ),
      backendTimeoutMs: positiveSafeIntegerAtMost(
        policy.backendTimeoutMs,
        SIGNED_BUDGET_MAXIMUM_BACKEND_TIMEOUT_MS,
      ),
    }),
    lanes: Object.freeze(lanes),
  });
}

function deriveDistributedBudgetPolicyCommitment(
  policy: PredictionV2DistributedBudgetRuntimeProjectionV2,
): Sha256 {
  return `sha256:${createHash("sha256").update(
    `${PREDICTION_V2_DISTRIBUTED_BUDGET_POLICY_COMMITMENT_DOMAIN}\n${JSON.stringify(policy)}`,
  ).digest("hex")}`;
}

function canonicalDigest(domain: string, value: unknown): Sha256 {
  return `sha256:${createHash("sha256")
    .update(`${SIGNING_DOMAIN}:${domain}\0${canonicalizeJson(value)}`, "utf8")
    .digest("hex")}`;
}

export function derivePredictionV2PublicReleaseGraphCommitments(input: Readonly<{
  release: unknown;
  components: unknown;
  runtimeDependencies: unknown;
  registrySnapshot: unknown;
  rpcCommitment: unknown;
  distributedBudgetPolicy: unknown;
  distributedBudgetPolicyCommitment: unknown;
  gates: unknown;
}>): GraphCommitments {
  return Object.freeze({
    releaseSha256: canonicalDigest("release", input.release),
    componentsSha256: canonicalDigest("components", input.components),
    runtimeDependenciesSha256: canonicalDigest(
      "runtime-dependencies",
      input.runtimeDependencies,
    ),
    registrySnapshotSha256: canonicalDigest(
      "registry-snapshot",
      input.registrySnapshot,
    ),
    rpcCommitmentSha256: canonicalDigest(
      "rpc-commitment",
      input.rpcCommitment,
    ),
    distributedBudgetPolicySha256: canonicalDigest(
      "distributed-budget-policy",
      Object.freeze({
        policy: input.distributedBudgetPolicy,
        commitment: input.distributedBudgetPolicyCommitment,
      }),
    ),
    gatesSha256: canonicalDigest("gates", input.gates),
  });
}

function parseRelease(value: unknown) {
  const record = closedRecord(value, [
    "releaseId",
    "manifestStatus",
    "repository",
    "sourceCommit",
    "sourceTree",
    "manifestPath",
    "manifestSha256",
    "dependencySourcesPath",
    "dependencySourcesSha256",
    "projectionAttestorAddress",
  ]);
  return Object.freeze({
    releaseId: exact(record.releaseId, PREDICTION_V2_PROTOCOL_RELEASE_ID),
    manifestStatus: exact(record.manifestStatus, "live"),
    repository: exact(record.repository, PREDICTION_V2_PROTOCOL_REPOSITORY),
    sourceCommit: gitObjectId(record.sourceCommit),
    sourceTree: gitObjectId(record.sourceTree),
    manifestPath: exact(record.manifestPath, RELEASE_MANIFEST_PATH),
    manifestSha256: sha256(record.manifestSha256),
    dependencySourcesPath: exact(
      record.dependencySourcesPath,
      DEPENDENCY_SOURCES_PATH,
    ),
    dependencySourcesSha256: sha256(record.dependencySourcesSha256),
    projectionAttestorAddress: address(record.projectionAttestorAddress),
  });
}

function parseComponents(value: unknown): readonly Component[] {
  const input = closedArray(value, PREDICTION_V2_COMPONENT_SPECS.length);
  const addresses = new Set<string>();
  const result = PREDICTION_V2_COMPONENT_SPECS.map((spec, index) => {
    const record = closedRecord(input[index], [
      "component",
      "address",
      "deploymentBlock",
      "runtimeCodeHash",
      "contractIdentifier",
      "sourceVerificationInputSha256",
    ]);
    const componentAddress = address(record.address);
    if (addresses.has(componentAddress)) return invalidPublicRelease();
    addresses.add(componentAddress);
    return Object.freeze({
      component: exact(record.component, spec.component),
      address: componentAddress,
      deploymentBlock: positiveDecimal(record.deploymentBlock),
      runtimeCodeHash: bytes32(record.runtimeCodeHash, true),
      contractIdentifier: exact(
        record.contractIdentifier,
        spec.contractIdentifier,
      ),
      sourceVerificationInputSha256: sha256(
        record.sourceVerificationInputSha256,
      ),
    });
  });
  return Object.freeze(result);
}

function parseRuntimeDependency(
  value: unknown,
  expectedAddress: EvmAddress,
) {
  const record = closedRecord(value, ["address", "runtimeCodeHash"]);
  return Object.freeze({
    address: exact(record.address, expectedAddress),
    runtimeCodeHash: bytes32(record.runtimeCodeHash, true),
  });
}

function parseRuntimeDependencies(value: unknown) {
  const record = closedRecord(value, [
    "executionEnvironment",
    "usdg",
    "poolManager",
    "create2Deployer",
    "checkpointCloneRuntimeCodeHash",
    "readbackBlockNumber",
    "readbackBlockHash",
    "runtimeReadbackEvidenceSha256",
  ]);
  const usdg = closedRecord(record.usdg, [
    "proxy",
    "proxyRuntimeCodeHash",
    "implementationSlot",
    "implementation",
    "implementationRuntimeCodeHash",
    "decimals",
    "permitDomain",
  ]);
  const permitDomain = closedRecord(usdg.permitDomain, [
    "separator",
    "chainId",
    "verifyingContract",
  ]);
  const implementation = address(usdg.implementation);
  if (
    implementation === USDG_ADDRESS ||
    implementation === POOL_MANAGER_ADDRESS ||
    implementation === CREATE2_DEPLOYER_ADDRESS
  ) {
    return invalidPublicRelease();
  }

  return Object.freeze({
    executionEnvironment: exact(
      record.executionEnvironment,
      EXECUTION_ENVIRONMENT,
    ),
    usdg: Object.freeze({
      proxy: exact(usdg.proxy, USDG_ADDRESS),
      proxyRuntimeCodeHash: bytes32(usdg.proxyRuntimeCodeHash, true),
      implementationSlot: exact(
        usdg.implementationSlot,
        EIP_1967_IMPLEMENTATION_SLOT,
      ),
      implementation,
      implementationRuntimeCodeHash: bytes32(
        usdg.implementationRuntimeCodeHash,
        true,
      ),
      decimals: exact(usdg.decimals, 6),
      permitDomain: Object.freeze({
        separator: bytes32(permitDomain.separator),
        chainId: exact(
          permitDomain.chainId,
          PREDICTION_V2_SETTLEMENT_CHAIN_ID,
        ),
        verifyingContract: exact(
          permitDomain.verifyingContract,
          USDG_ADDRESS,
        ),
      }),
    }),
    poolManager: parseRuntimeDependency(
      record.poolManager,
      POOL_MANAGER_ADDRESS,
    ),
    create2Deployer: parseRuntimeDependency(
      record.create2Deployer,
      CREATE2_DEPLOYER_ADDRESS,
    ),
    checkpointCloneRuntimeCodeHash: bytes32(
      record.checkpointCloneRuntimeCodeHash,
      true,
    ),
    readbackBlockNumber: positiveDecimal(record.readbackBlockNumber),
    readbackBlockHash: bytes32(record.readbackBlockHash),
    runtimeReadbackEvidenceSha256: sha256(
      record.runtimeReadbackEvidenceSha256,
    ),
  });
}

function parseRegistrySnapshot(value: unknown, registryAddress: EvmAddress) {
  const record = closedRecord(value, [
    "networkId",
    "chainId",
    "registryAddress",
    "snapshotHash",
    "blockNumber",
    "blockHash",
    "activePolicyCount",
    "snapshotArtifactSha256",
  ]);
  return Object.freeze({
    networkId: exact(record.networkId, PREDICTION_V2_SETTLEMENT_NETWORK_ID),
    chainId: exact(record.chainId, PREDICTION_V2_SETTLEMENT_CHAIN_ID),
    registryAddress: exact(record.registryAddress, registryAddress),
    snapshotHash: bytes32(record.snapshotHash),
    blockNumber: positiveDecimal(record.blockNumber),
    blockHash: bytes32(record.blockHash),
    activePolicyCount: positiveSafeInteger(record.activePolicyCount),
    snapshotArtifactSha256: sha256(record.snapshotArtifactSha256),
  });
}

function parseRpcProvider(value: unknown): RpcCommitment["provider"] {
  const record = closedRecord(value, [
    "role",
    "providerId",
    "providerCommitment",
    "vendorGroup",
    "vendorCommitment",
    "endpointCommitment",
    "endpointOriginCommitment",
    "batchMode",
  ]);
  const providerId = rpcProviderId(record.providerId);
  const vendorGroup = record.vendorGroup;
  if (
    vendorGroup !== "alchemy" &&
    vendorGroup !== "drpc" &&
    vendorGroup !== "quicknode"
  ) {
    return invalidPublicRelease();
  }
  return Object.freeze({
    role: exact(record.role, "settlement"),
    providerId,
    providerCommitment: exact(
      bytes32(record.providerCommitment),
      predictionV2PublicReleaseRpcIdentityCommitment("provider", providerId),
    ),
    vendorGroup,
    vendorCommitment: exact(
      bytes32(record.vendorCommitment),
      predictionV2PublicReleaseRpcIdentityCommitment("vendor", vendorGroup),
    ),
    endpointCommitment: bytes32(record.endpointCommitment),
    endpointOriginCommitment: bytes32(record.endpointOriginCommitment),
    batchMode: record.batchMode === "batch" || record.batchMode === "solo"
      ? record.batchMode
      : invalidPublicRelease(),
  });
}

function parseRpcTransportPolicy(
  value: unknown,
): RpcCommitment["transportPolicy"] {
  const record = closedRecord(value, [
    "maximumBatchCalls",
    "maximumCallDataBytes",
    "maximumLogicalCallsInFlight",
    "maximumPhysicalRequestsInFlight",
    "maximumRequestBytes",
    "maximumResponseBytes",
    "maximumRetries",
    "timeoutMs",
  ]);
  return Object.freeze({
    maximumBatchCalls: exact(
      record.maximumBatchCalls,
      PREDICTION_V2_RPC_LIMITS.maximumBatchCalls,
    ),
    maximumCallDataBytes: exact(
      record.maximumCallDataBytes,
      PREDICTION_V2_RPC_LIMITS.maximumCallDataBytes,
    ),
    maximumLogicalCallsInFlight: exact(
      record.maximumLogicalCallsInFlight,
      PREDICTION_V2_RPC_LIMITS.maximumLogicalCallsInFlight,
    ),
    maximumPhysicalRequestsInFlight: exact(
      record.maximumPhysicalRequestsInFlight,
      PREDICTION_V2_RPC_LIMITS.maximumPhysicalRequestsInFlight,
    ),
    maximumRequestBytes: exact(
      record.maximumRequestBytes,
      PREDICTION_V2_RPC_LIMITS.maximumRequestBytes,
    ),
    maximumResponseBytes: exact(
      record.maximumResponseBytes,
      PREDICTION_V2_RPC_LIMITS.maximumResponseBytes,
    ),
    maximumRetries: exact(
      record.maximumRetries,
      PREDICTION_V2_RPC_LIMITS.maximumRetries,
    ),
    timeoutMs: exact(record.timeoutMs, PREDICTION_V2_RPC_LIMITS.timeoutMs),
  });
}

function parseRpcCommitment(value: unknown): RpcCommitment {
  const record = closedRecord(value, [
    "networkId",
    "chainId",
    "confirmedBlockNumber",
    "confirmedBlockHash",
    "snapshotPolicy",
    "transportPolicy",
    "readStrategy",
    "requireCanonical",
    "requiredProviderCount",
    "provider",
    "evidenceSha256",
  ]);
  const provider = parseRpcProvider(record.provider);
  const snapshotPolicy = closedRecord(record.snapshotPolicy, [
    "kind",
    "confirmationDepth",
  ]);
  return Object.freeze({
    networkId: exact(record.networkId, PREDICTION_V2_SETTLEMENT_NETWORK_ID),
    chainId: exact(record.chainId, PREDICTION_V2_SETTLEMENT_CHAIN_ID),
    confirmedBlockNumber: positiveDecimal(record.confirmedBlockNumber),
    confirmedBlockHash: bytes32(record.confirmedBlockHash),
    snapshotPolicy: Object.freeze({
      kind: exact(snapshotPolicy.kind, "action"),
      confirmationDepth: confirmationDepth(
        snapshotPolicy.confirmationDepth,
      ),
    }),
    transportPolicy: parseRpcTransportPolicy(record.transportPolicy),
    readStrategy: exact(
      record.readStrategy,
      "single-eip-1898-confirmed-block-hash-v1",
    ),
    requireCanonical: exact(record.requireCanonical, true),
    requiredProviderCount: exact(record.requiredProviderCount, 1),
    provider,
    evidenceSha256: sha256(record.evidenceSha256),
  });
}

function parseGates(value: unknown) {
  const input = closedArray(value, PREDICTION_V2_REQUIRED_RELEASE_GATES.length);
  const gates = PREDICTION_V2_REQUIRED_RELEASE_GATES.map((gateId, index) => {
    const record = closedRecord(input[index], [
      "gateId",
      "status",
      "evidenceSha256",
    ]);
    return Object.freeze({
      gateId: exact(record.gateId, gateId),
      status: exact(record.status, "closed"),
      evidenceSha256: sha256(record.evidenceSha256),
    });
  });
  return Object.freeze(gates);
}

function parseGraphCommitments(value: unknown): GraphCommitments {
  const record = closedRecord(value, [
    "releaseSha256",
    "componentsSha256",
    "runtimeDependenciesSha256",
    "registrySnapshotSha256",
    "rpcCommitmentSha256",
    "distributedBudgetPolicySha256",
    "gatesSha256",
  ]);
  return Object.freeze({
    releaseSha256: sha256(record.releaseSha256),
    componentsSha256: sha256(record.componentsSha256),
    runtimeDependenciesSha256: sha256(record.runtimeDependenciesSha256),
    registrySnapshotSha256: sha256(record.registrySnapshotSha256),
    rpcCommitmentSha256: sha256(record.rpcCommitmentSha256),
    distributedBudgetPolicySha256: sha256(
      record.distributedBudgetPolicySha256,
    ),
    gatesSha256: sha256(record.gatesSha256),
  });
}

function equalCommitments(left: GraphCommitments, right: GraphCommitments) {
  return (
    left.releaseSha256 === right.releaseSha256 &&
    left.componentsSha256 === right.componentsSha256 &&
    left.runtimeDependenciesSha256 === right.runtimeDependenciesSha256 &&
    left.registrySnapshotSha256 === right.registrySnapshotSha256 &&
    left.rpcCommitmentSha256 === right.rpcCommitmentSha256 &&
    left.distributedBudgetPolicySha256 ===
      right.distributedBudgetPolicySha256 &&
    left.gatesSha256 === right.gatesSha256
  );
}

function parseUnsignedEnabled(value: unknown) {
  const record = closedRecord(value, UNSIGNED_ENABLED_KEYS);
  exact(record.schemaVersion, PREDICTION_V2_PUBLIC_RELEASE_SCHEMA);
  exact(record.releaseVersion, PREDICTION_V2_PUBLIC_RELEASE_VERSION);
  exact(record.status, "enabled");
  const release = parseRelease(record.release);
  const components = parseComponents(record.components);
  const runtimeDependencies = parseRuntimeDependencies(record.runtimeDependencies);
  const componentAddresses = new Set(
    components.map((component) => component.address),
  );
  if (
    componentAddresses.has(USDG_ADDRESS) ||
    componentAddresses.has(POOL_MANAGER_ADDRESS) ||
    componentAddresses.has(CREATE2_DEPLOYER_ADDRESS) ||
    componentAddresses.has(runtimeDependencies.usdg.implementation)
  ) {
    return invalidPublicRelease();
  }
  const readbackBlockNumber = BigInt(runtimeDependencies.readbackBlockNumber);
  if (components.some(
    ({ deploymentBlock }) => BigInt(deploymentBlock) > readbackBlockNumber,
  )) return invalidPublicRelease();
  const registrySnapshot = parseRegistrySnapshot(
    record.registrySnapshot,
    components[0]!.address,
  );
  const rpcCommitment = parseRpcCommitment(record.rpcCommitment);
  const distributedBudgetPolicy = parseDistributedBudgetPolicy(
    record.distributedBudgetPolicy,
  );
  const distributedBudgetPolicyCommitment = exact(
    sha256(record.distributedBudgetPolicyCommitment),
    deriveDistributedBudgetPolicyCommitment(distributedBudgetPolicy),
  );
  if (
    runtimeDependencies.readbackBlockNumber !==
      rpcCommitment.confirmedBlockNumber ||
    runtimeDependencies.readbackBlockHash !== rpcCommitment.confirmedBlockHash ||
    registrySnapshot.blockNumber !== rpcCommitment.confirmedBlockNumber ||
    registrySnapshot.blockHash !== rpcCommitment.confirmedBlockHash
  ) {
    return invalidPublicRelease();
  }
  const gates = parseGates(record.gates);
  const graphCommitments = parseGraphCommitments(record.graphCommitments);
  const derivedCommitments = derivePredictionV2PublicReleaseGraphCommitments({
    release,
    components,
    runtimeDependencies,
    registrySnapshot,
    rpcCommitment,
    distributedBudgetPolicy,
    distributedBudgetPolicyCommitment,
    gates,
  });
  if (!equalCommitments(graphCommitments, derivedCommitments)) {
    return invalidPublicRelease();
  }
  return Object.freeze({
    schemaVersion: PREDICTION_V2_PUBLIC_RELEASE_SCHEMA,
    releaseVersion: PREDICTION_V2_PUBLIC_RELEASE_VERSION,
    status: "enabled" as const,
    release,
    components,
    runtimeDependencies,
    registrySnapshot,
    rpcCommitment,
    distributedBudgetPolicy,
    distributedBudgetPolicyCommitment,
    gates,
    graphCommitments,
  });
}

export function createPredictionV2PublicReleaseSigningMessage(
  unsignedEnabledRelease: unknown,
): Buffer {
  const parsed = parseUnsignedEnabled(unsignedEnabledRelease);
  return Buffer.from(
    `${SIGNING_DOMAIN}\0${canonicalizeJson(parsed)}`,
    "utf8",
  );
}

function decodeCanonicalBase64Url(value: unknown, expectedBytes?: number) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return invalidPublicRelease();
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length === 0 ||
    decoded.toString("base64url") !== value ||
    (expectedBytes !== undefined && decoded.length !== expectedBytes)
  ) {
    return invalidPublicRelease();
  }
  return decoded;
}

function parseTrustRoot(value: unknown) {
  const record = closedRecord(value, [
    "algorithm",
    "keyId",
    "publicKeySpkiBase64Url",
    "publicKeySpkiSha256",
  ]);
  const publicKeySpki = decodeCanonicalBase64Url(
    record.publicKeySpkiBase64Url,
    44,
  );
  const publicKeySpkiSha256 = sha256(record.publicKeySpkiSha256);
  const actualSpkiSha256 = `sha256:${createHash("sha256")
    .update(publicKeySpki)
    .digest("hex")}`;
  if (actualSpkiSha256 !== publicKeySpkiSha256) {
    return invalidPublicRelease();
  }
  let publicKey;
  try {
    publicKey = createPublicKey({ key: publicKeySpki, format: "der", type: "spki" });
  } catch {
    return invalidPublicRelease();
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    return invalidPublicRelease();
  }
  return Object.freeze({
    algorithm: exact(record.algorithm, "Ed25519"),
    keyId: identifier(record.keyId),
    publicKey,
  });
}

function parseAttestation(value: unknown) {
  const record = closedRecord(value, [
    "algorithm",
    "keyId",
    "payloadSha256",
    "signature",
  ]);
  return Object.freeze({
    algorithm: exact(record.algorithm, "Ed25519"),
    keyId: identifier(record.keyId),
    payloadSha256: sha256(record.payloadSha256),
    signature: decodeCanonicalBase64Url(record.signature, 64),
  });
}

function parsePredictionV2PublicReleaseV2AgainstTrustRoot(
  value: unknown,
  trustRoot: PredictionV2PublicReleaseTrustRoot | null,
  brandAsProductionVerified: boolean,
): PredictionV2PublicReleaseV2 {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return invalidPublicRelease();
  }
  const root = value as Record<string, unknown>;
  const schemaVersion = ownDataProperty(root, "schemaVersion");
  const releaseVersion = ownDataProperty(root, "releaseVersion");
  const status = ownDataProperty(root, "status");
  if (
    schemaVersion !== PREDICTION_V2_PUBLIC_RELEASE_SCHEMA ||
    releaseVersion !== PREDICTION_V2_PUBLIC_RELEASE_VERSION
  ) {
    return invalidPublicRelease();
  }
  if (status === "disabled") {
    closedRecord(root, DISABLED_KEYS);
    return Object.freeze({
      schemaVersion: PREDICTION_V2_PUBLIC_RELEASE_SCHEMA,
      releaseVersion: PREDICTION_V2_PUBLIC_RELEASE_VERSION,
      status: "disabled",
    });
  }
  if (status !== "enabled" || trustRoot === null) {
    return invalidPublicRelease();
  }
  closedRecord(root, ENABLED_KEYS);
  const unsignedInput = {
    schemaVersion,
    releaseVersion,
    status,
    release: root.release,
    components: root.components,
    runtimeDependencies: root.runtimeDependencies,
    registrySnapshot: root.registrySnapshot,
    rpcCommitment: root.rpcCommitment,
    distributedBudgetPolicy: root.distributedBudgetPolicy,
    distributedBudgetPolicyCommitment:
      root.distributedBudgetPolicyCommitment,
    gates: root.gates,
    graphCommitments: root.graphCommitments,
  };
  const unsigned = parseUnsignedEnabled(unsignedInput);
  const attestation = parseAttestation(root.attestation);
  const parsedTrustRoot = parseTrustRoot(trustRoot);
  if (
    attestation.algorithm !== parsedTrustRoot.algorithm ||
    attestation.keyId !== parsedTrustRoot.keyId
  ) {
    return invalidPublicRelease();
  }
  const signingMessage = Buffer.from(
    `${SIGNING_DOMAIN}\0${canonicalizeJson(unsigned)}`,
    "utf8",
  );
  const payloadSha256 = `sha256:${createHash("sha256")
    .update(signingMessage)
    .digest("hex")}`;
  if (
    payloadSha256 !== attestation.payloadSha256 ||
    !verifySignature(
      null,
      signingMessage,
      parsedTrustRoot.publicKey,
      attestation.signature,
    )
  ) {
    return invalidPublicRelease();
  }
  const verifiedRelease: PredictionV2EnabledPublicReleaseV2 = Object.freeze({
    ...unsigned,
    attestation: Object.freeze({
      algorithm: attestation.algorithm,
      keyId: attestation.keyId,
      payloadSha256: attestation.payloadSha256,
      signature: attestation.signature.toString("base64url"),
    }),
  });
  if (brandAsProductionVerified) {
    PRODUCTION_VERIFIED_ENABLED_PUBLIC_RELEASES.add(verifiedRelease);
  }
  return verifiedRelease;
}

/**
 * Parses the shipped release only against the module-pinned Production root.
 * The trust root is intentionally not caller-overridable. Extra JavaScript
 * arguments are ignored and can never mint the Production verification brand.
 */
export function parsePredictionV2PublicReleaseV2(
  value: unknown,
): PredictionV2PublicReleaseV2 {
  return parsePredictionV2PublicReleaseV2AgainstTrustRoot(
    value,
    PREDICTION_V2_PUBLIC_RELEASE_PRODUCTION_TRUST_ROOT,
    true,
  );
}

/**
 * Verifies a fixture or offline artifact against an explicitly supplied root,
 * but deliberately returns an unbranded object. It can exercise the complete
 * schema/signature parser without granting access to any Production adapter.
 */
export function verifyPredictionV2PublicReleaseV2WithTrustRoot(
  value: unknown,
  trustRoot: PredictionV2PublicReleaseTrustRoot,
): PredictionV2PublicReleaseV2 {
  return parsePredictionV2PublicReleaseV2AgainstTrustRoot(
    value,
    trustRoot,
    false,
  );
}

/**
 * Runtime proof that this exact object passed the closed-schema, graph and
 * Ed25519 verification against the non-overridable pinned Production root.
 * Custom-root parses, structural copies and casts all fail this boundary.
 */
export function assertPredictionV2VerifiedEnabledPublicReleaseV2(
  value: unknown,
): asserts value is PredictionV2EnabledPublicReleaseV2 {
  if (
    !value || typeof value !== "object" ||
    !PRODUCTION_VERIFIED_ENABLED_PUBLIC_RELEASES.has(value)
  ) return invalidPublicRelease();
}

function runtimeRpcCommitmentMismatch(): never {
  throw new Error(
    "Prediction V2 runtime RPC commitment does not match public release",
  );
}

function runtimeDistributedBudgetMismatch(): never {
  throw new Error(
    "Prediction V2 distributed budget does not match public release",
  );
}

/**
 * Binds the secret-free, enumerable projection of the live settlement RPC to
 * the exact provider identity authorized by an already verified enabled
 * release. Endpoint URLs and credentials remain private, while the full
 * credential-bound endpoint commitment and transport policy are signed.
 */
export function assertPredictionV2RuntimeRpcCommitmentProjectionMatchesRelease(
  release: PredictionV2PublicReleaseV2,
  projection: unknown,
): asserts release is PredictionV2EnabledPublicReleaseV2 {
  try {
    assertPredictionV2VerifiedEnabledPublicReleaseV2(release);
  } catch {
    return runtimeRpcCommitmentMismatch();
  }
  let parsedProjection: PredictionV2RuntimeRpcCommitmentProjection;
  try {
    const record = closedRecord(projection, [
      "chainId",
      "snapshotPolicy",
      "transportPolicy",
      "provider",
    ]);
    const snapshotPolicy = closedRecord(record.snapshotPolicy, [
      "kind",
      "confirmationDepth",
    ]);
    parsedProjection = Object.freeze({
      chainId: exact(record.chainId, PREDICTION_V2_SETTLEMENT_CHAIN_ID),
      snapshotPolicy: Object.freeze({
        kind: exact(snapshotPolicy.kind, "action"),
        confirmationDepth: confirmationDepth(
          snapshotPolicy.confirmationDepth,
        ),
      }),
      transportPolicy: parseRpcTransportPolicy(record.transportPolicy),
      provider: parseRpcProvider(record.provider),
    });
  } catch {
    return runtimeRpcCommitmentMismatch();
  }
  if (
    parsedProjection.snapshotPolicy.kind !==
      release.rpcCommitment.snapshotPolicy.kind ||
    parsedProjection.snapshotPolicy.confirmationDepth !==
      release.rpcCommitment.snapshotPolicy.confirmationDepth ||
    canonicalizeJson(parsedProjection.transportPolicy) !==
      canonicalizeJson(release.rpcCommitment.transportPolicy)
  ) return runtimeRpcCommitmentMismatch();
  const authorized = release.rpcCommitment.provider;
  const runtime = parsedProjection.provider;
  if (
    runtime.role !== authorized.role ||
    runtime.providerId !== authorized.providerId ||
    runtime.providerCommitment !== authorized.providerCommitment ||
    runtime.vendorGroup !== authorized.vendorGroup ||
    runtime.vendorCommitment !== authorized.vendorCommitment ||
    runtime.endpointCommitment !== authorized.endpointCommitment ||
    runtime.endpointOriginCommitment !== authorized.endpointOriginCommitment ||
    runtime.batchMode !== authorized.batchMode
  ) return runtimeRpcCommitmentMismatch();
}

/**
 * Accepts only a factory-proven distributed budget backed by a shared atomic
 * backend, then binds its complete secret-free policy and backend identity to
 * the signed release. A structurally compatible object is rejected first.
 */
export function assertPredictionV2RuntimeDistributedBudgetMatchesRelease(
  release: PredictionV2PublicReleaseV2,
  budget: unknown,
): asserts release is PredictionV2EnabledPublicReleaseV2 {
  try {
    assertPredictionV2VerifiedEnabledPublicReleaseV2(release);
  } catch {
    return runtimeDistributedBudgetMismatch();
  }
  let runtime: PredictionV2DistributedBudgetV2;
  let projection: PredictionV2DistributedBudgetRuntimeProjectionV2;
  let commitment: Sha256;
  try {
    assertPredictionV2DistributedBudgetRuntimeV2(budget);
    runtime = budget;
    if (runtime.readiness.backendScope !== "shared-atomic") {
      return runtimeDistributedBudgetMismatch();
    }
    projection = parseDistributedBudgetPolicy(
      runtime.runtimePolicyProjection(),
    );
    commitment = sha256(runtime.runtimePolicyCommitment());
  } catch {
    return runtimeDistributedBudgetMismatch();
  }
  if (
    commitment !== deriveDistributedBudgetPolicyCommitment(projection) ||
    commitment !== release.distributedBudgetPolicyCommitment ||
    canonicalizeJson(projection) !==
      canonicalizeJson(release.distributedBudgetPolicy)
  ) return runtimeDistributedBudgetMismatch();
}

const PREDICTION_V2_RUNTIME_CODE_TARGETS =
  PREDICTION_V2_COMPONENT_SPECS.length + 4;
const USDG_DECIMALS_SELECTOR = "0x313ce567" as const;
const USDG_DOMAIN_SEPARATOR_SELECTOR = "0x3644e515" as const;

export const
PREDICTION_V2_PUBLIC_RELEASE_RUNTIME_PREFLIGHT_MAX_RPC_LOGICAL_CALLS =
  PREDICTION_V2_RUNTIME_CODE_TARGETS +
  1 + // EIP-1967 implementation-slot read
  2 + // decimals() and DOMAIN_SEPARATOR()
  1; // exact-block revalidation

export const PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS =
  PREDICTION_V2_ACTION_SNAPSHOT_NEGOTIATION_RPC_LOGICAL_CALLS +
  PREDICTION_V2_PUBLIC_RELEASE_RUNTIME_PREFLIGHT_MAX_RPC_LOGICAL_CALLS;

export const
PREDICTION_V2_PUBLIC_RELEASE_HISTORICAL_SESSION_MAX_RPC_LOGICAL_CALLS =
  PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS +
  PREDICTION_V2_CANONICAL_HISTORICAL_BLOCK_VERIFICATION_RPC_LOGICAL_CALLS;

const PREDICTION_V2_RUNTIME_PREFLIGHT_TARGET_CONCURRENCY =
  PREDICTION_V2_RPC_LIMITS.maximumPhysicalRequestsInFlight;

export type PredictionV2RuntimeDependencySnapshotBindingV2 = Readonly<{
  codeTargets: readonly Readonly<{
    address: EvmAddress;
    runtimeCodeHash: Bytes32;
  }>[];
  usdgProxy: EvmAddress;
  usdgImplementationSlot: Bytes32;
  usdgImplementation: EvmAddress;
  usdgDecimals: 6;
  usdgDomainSeparator: Bytes32;
}>;

export class PredictionV2RuntimeDependencySnapshotErrorV2 extends Error {
  readonly code:
    | "block-mismatch"
    | "invalid-binding"
    | "runtime-mismatch";

  constructor(code: PredictionV2RuntimeDependencySnapshotErrorV2["code"]) {
    super("Prediction V2 runtime dependency preflight failed");
    this.name = "PredictionV2RuntimeDependencySnapshotErrorV2";
    this.code = code;
  }

  toJSON() {
    return Object.freeze({ name: this.name, code: this.code });
  }
}

function runtimeDependencyFail(
  code: PredictionV2RuntimeDependencySnapshotErrorV2["code"],
): never {
  throw new PredictionV2RuntimeDependencySnapshotErrorV2(code);
}

function normalizeRuntimeDependencySnapshotBinding(
  value: unknown,
): PredictionV2RuntimeDependencySnapshotBindingV2 {
  try {
    const record = closedRecord(value, [
      "codeTargets",
      "usdgProxy",
      "usdgImplementationSlot",
      "usdgImplementation",
      "usdgDecimals",
      "usdgDomainSeparator",
    ]);
    const targetInput = closedArray(
      record.codeTargets,
      PREDICTION_V2_RUNTIME_CODE_TARGETS,
    );
    const seen = new Set<string>();
    const codeTargets = Object.freeze(targetInput.map((candidate) => {
      const target = closedRecord(candidate, ["address", "runtimeCodeHash"]);
      const targetAddress = address(target.address);
      if (seen.has(targetAddress)) return invalidPublicRelease();
      seen.add(targetAddress);
      return Object.freeze({
        address: targetAddress,
        runtimeCodeHash: bytes32(target.runtimeCodeHash, true),
      });
    }));
    const usdgProxy = address(record.usdgProxy);
    const usdgImplementation = address(record.usdgImplementation);
    if (
      !codeTargets.some(({ address: target }) => target === usdgProxy) ||
      !codeTargets.some(({ address: target }) => target === usdgImplementation)
    ) return invalidPublicRelease();
    return Object.freeze({
      codeTargets,
      usdgProxy,
      usdgImplementationSlot: bytes32(record.usdgImplementationSlot),
      usdgImplementation,
      usdgDecimals: exact(record.usdgDecimals, 6),
      usdgDomainSeparator: bytes32(record.usdgDomainSeparator),
    });
  } catch {
    return runtimeDependencyFail("invalid-binding");
  }
}

function runtimeDependencyBindingFromRelease(
  release: PredictionV2EnabledPublicReleaseV2,
): PredictionV2RuntimeDependencySnapshotBindingV2 {
  return normalizeRuntimeDependencySnapshotBinding({
    codeTargets: [
      ...release.components.map(({ address, runtimeCodeHash }) => ({
        address,
        runtimeCodeHash,
      })),
      {
        address: release.runtimeDependencies.usdg.proxy,
        runtimeCodeHash:
          release.runtimeDependencies.usdg.proxyRuntimeCodeHash,
      },
      {
        address: release.runtimeDependencies.usdg.implementation,
        runtimeCodeHash:
          release.runtimeDependencies.usdg.implementationRuntimeCodeHash,
      },
      release.runtimeDependencies.poolManager,
      release.runtimeDependencies.create2Deployer,
    ],
    usdgProxy: release.runtimeDependencies.usdg.proxy,
    usdgImplementationSlot:
      release.runtimeDependencies.usdg.implementationSlot,
    usdgImplementation: release.runtimeDependencies.usdg.implementation,
    usdgDecimals: release.runtimeDependencies.usdg.decimals,
    usdgDomainSeparator:
      release.runtimeDependencies.usdg.permitDomain.separator,
  });
}

function sameRuntimeBlock(
  left: PredictionV2ActionRpcSnapshotLease["snapshot"],
  right: PredictionV2ActionRpcSnapshotLease["snapshot"],
) {
  return left.number === right.number && left.timestamp === right.timestamp &&
    left.hash.toLowerCase() === right.hash.toLowerCase() &&
    left.parentHash.toLowerCase() === right.parentHash.toLowerCase();
}

function runtimeBytes(value: unknown): Hex {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/u.test(value)
  ) return runtimeDependencyFail("runtime-mismatch");
  return value.toLowerCase() as Hex;
}

/**
 * Low-level exact-snapshot verifier. It grants no release authority: the
 * production session derives this binding only from its already branded
 * signed release, then closes the lease on every failure.
 */
export async function verifyPredictionV2RuntimeDependencySnapshotV2(
  lease: PredictionV2ActionRpcSnapshotLease,
  input: PredictionV2RuntimeDependencySnapshotBindingV2,
  signal?: AbortSignal,
): Promise<void> {
  const binding = normalizeRuntimeDependencySnapshotBinding(input);
  const reader = toPredictionV2ActionRpcSnapshotReader(lease);
  const block = lease.snapshot;
  for (
    let start = 0;
    start < binding.codeTargets.length;
    start += PREDICTION_V2_RUNTIME_PREFLIGHT_TARGET_CONCURRENCY
  ) {
    const targets = binding.codeTargets.slice(
      start,
      start + PREDICTION_V2_RUNTIME_PREFLIGHT_TARGET_CONCURRENCY,
    );
    await Promise.all(targets.map(async (target) => {
      const request = Object.freeze({
        address: target.address,
        blockNumber: block.number,
        blockHash: block.hash,
        requireCanonical: true as const,
        ...(signal ? { signal } : {}),
      });
      const code = runtimeBytes(await reader.getCode(request));
      if (keccak256(code).toLowerCase() !== target.runtimeCodeHash) {
        return runtimeDependencyFail("runtime-mismatch");
      }
    }));
  }

  const storageRequest = Object.freeze({
    address: binding.usdgProxy,
    slot: binding.usdgImplementationSlot,
    blockNumber: block.number,
    blockHash: block.hash,
    requireCanonical: true as const,
    ...(signal ? { signal } : {}),
  });
  const storage = runtimeBytes(await reader.getStorageAt(storageRequest));
  const expectedStorage =
    `0x${"0".repeat(24)}${binding.usdgImplementation.slice(2)}`;
  if (storage !== expectedStorage) return runtimeDependencyFail("runtime-mismatch");

  const call = async (data: Hex) => {
    const request = Object.freeze({
      to: binding.usdgProxy,
      data,
      blockNumber: block.number,
      blockHash: block.hash,
      requireCanonical: true as const,
      ...(signal ? { signal } : {}),
    });
    return runtimeBytes(await reader.call(request));
  };
  const [decimals, domainSeparator] = await Promise.all([
    call(USDG_DECIMALS_SELECTOR),
    call(USDG_DOMAIN_SEPARATOR_SELECTOR),
  ]);
  if (
    decimals !== `0x${BigInt(binding.usdgDecimals).toString(16).padStart(64, "0")}` ||
    domainSeparator !== binding.usdgDomainSeparator
  ) return runtimeDependencyFail("runtime-mismatch");

  const current = await reader.getBlock(block.number, signal);
  if (
    !current || !sameRuntimeBlock(block, current)
  ) return runtimeDependencyFail("block-mismatch");
}

/**
 * The only supported production RPC adapter. It binds both the exact
 * factory-proven RPC policy and the factory-proven shared distributed budget
 * to the signed release before exposing an operation-scoped reader lease.
 * The route must reserve and irreversibly mark its budget lease started before
 * calling this function; this identity boundary does not reserve units itself.
 * Production code must never assemble the reader or budget object by hand.
 */
export type PredictionV2PublicReleaseRpcSession = Readonly<{
  lease: PredictionV2ActionRpcSnapshotLease;
  reader: PredictionV2RpcSessionReader<"action">;
  snapshot: PredictionV2ActionRpcSnapshotLease["snapshot"];
  rpcLogicalCalls: number;
  close(): void;
}>;

export async function createPredictionV2PublicReleaseRpcSession(
  release: PredictionV2PublicReleaseV2,
  rpcSession: PredictionV2ActionRpcSessionReader,
  budget: PredictionV2DistributedBudgetV2,
  signal?: AbortSignal,
  historicalSnapshot?: PredictionV2ActionRpcHistoricalSnapshotV2,
): Promise<PredictionV2PublicReleaseRpcSession> {
  assertPredictionV2RuntimeDistributedBudgetMatchesRelease(release, budget);
  assertPredictionV2ProductionActionRpcSession(rpcSession);
  assertPredictionV2RuntimeRpcCommitmentProjectionMatchesRelease(
    release,
    predictionV2ActionRpcRuntimeProjection(rpcSession),
  );
  const lease = await createPredictionV2ActionRpcSnapshotLease(
    rpcSession,
    signal,
    historicalSnapshot,
  );
  try {
    await verifyPredictionV2RuntimeDependencySnapshotV2(
      lease,
      runtimeDependencyBindingFromRelease(release),
      signal,
    );
    const reader = toPredictionV2ActionRpcSnapshotReader(lease);
    return Object.freeze({
      lease,
      reader,
      snapshot: lease.snapshot,
      rpcLogicalCalls: historicalSnapshot
        ? PREDICTION_V2_PUBLIC_RELEASE_HISTORICAL_SESSION_MAX_RPC_LOGICAL_CALLS
        : PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS,
      close() {
        lease.close();
      },
    });
  } catch (error) {
    lease.close();
    throw error;
  }
}

/**
 * Canonical release root for optional attested enrichment only. Base market
 * cards remain available from their verified onchain read model without an
 * attestor or enrichment record.
 */
export function toPredictionV2PublicMarketCanonicalReleaseV2(
  release: PredictionV2PublicReleaseV2,
): PredictionMarketCanonicalReleaseV2 {
  assertPredictionV2VerifiedEnabledPublicReleaseV2(release);
  const factory = release.components.find(
    ({ component }) => component === "GenericPredictionMarketFactoryV2",
  );
  if (!factory) return invalidPublicRelease();
  return Object.freeze({
    schemaVersion: 2 as const,
    releaseId: release.release.releaseId,
    settlementChainId: "4663" as const,
    factoryAddress: factory.address,
    factoryRuntimeCodeHash: factory.runtimeCodeHash,
    projectionAttestorAddress: release.release.projectionAttestorAddress,
  });
}

/**
 * Exact read-model binding derived only from the signed component graph.
 * The readback evidence block is deliberately not treated as deployment
 * provenance; the scan lower bound is the Factory's own deployment block.
 */
export function toPredictionV2ReadBindingFromPublicReleaseV2(
  release: PredictionV2PublicReleaseV2,
): PredictionV2ReadBinding {
  assertPredictionV2VerifiedEnabledPublicReleaseV2(release);
  const component = <
    Name extends Component["component"],
  >(name: Name) => {
    const match = release.components.find((value) => value.component === name);
    if (!match) return invalidPublicRelease();
    return match;
  };
  const factory = component("GenericPredictionMarketFactoryV2");
  return Object.freeze({
    factory: factory.address,
    assetRegistry: component("AssetRegistryV2").address,
    poolManager: release.runtimeDependencies.poolManager.address,
    hook: component("LifecycleHookV2").address,
    collateral: release.runtimeDependencies.usdg.proxy,
    router: component("ExecutionRouterV2").address,
    deploymentBlock: BigInt(factory.deploymentBlock),
  });
}

let cachedPublicRelease: PredictionV2PublicReleaseV2 | undefined;

export function getPredictionV2PublicReleaseV2(): PredictionV2PublicReleaseV2 {
  cachedPublicRelease ??= parsePredictionV2PublicReleaseV2(publicReleaseJson);
  return cachedPublicRelease;
}

export function isPredictionV2PublicReleaseV2Enabled(): boolean {
  try {
    return getPredictionV2PublicReleaseV2().status === "enabled";
  } catch {
    return false;
  }
}
