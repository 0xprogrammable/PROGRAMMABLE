import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const productionHarness = vi.hoisted(() => ({
  release: null as unknown,
  sessionFactory: null as unknown,
  marketReader: null as unknown,
  readBinding: null as unknown,
}));
vi.mock("../lib/prediction-v2/public-release-v2.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import(
    "../lib/prediction-v2/public-release-v2.server"
  )>();
  return {
    ...actual,
    getPredictionV2PublicReleaseV2() {
      return productionHarness.release ?? actual.getPredictionV2PublicReleaseV2();
    },
    createPredictionV2PublicReleaseResolutionRpcSession(
      ...args: Parameters<
        typeof actual.createPredictionV2PublicReleaseResolutionRpcSession
      >
    ) {
      if (typeof productionHarness.sessionFactory === "function") {
        return productionHarness.sessionFactory(...args);
      }
      return actual.createPredictionV2PublicReleaseResolutionRpcSession(...args);
    },
    toPredictionV2ReadBindingFromPublicReleaseV2(
      ...args: Parameters<
        typeof actual.toPredictionV2ReadBindingFromPublicReleaseV2
      >
    ) {
      if (productionHarness.readBinding) return productionHarness.readBinding;
      return actual.toPredictionV2ReadBindingFromPublicReleaseV2(...args);
    },
  };
});
vi.mock("../lib/prediction-v2/read-model-v2.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import(
    "../lib/prediction-v2/read-model-v2.server"
  )>();
  return {
    ...actual,
    readPredictionV2MarketAtSnapshot(
      ...args: Parameters<typeof actual.readPredictionV2MarketAtSnapshot>
    ) {
      if (typeof productionHarness.marketReader === "function") {
        return productionHarness.marketReader(...args);
      }
      return actual.readPredictionV2MarketAtSnapshot(...args);
    },
  };
});
import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  keccak256,
  stringToHex,
  toBytes,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  PREDICTION_PRESET_ASSETS_V2,
  predictionOnchainAssetKeyV2,
} from "../lib/prediction-market-assets-v2";
import {
  PREDICTION_V2_ASSET_REGISTRY_ABI,
  PREDICTION_V2_CHECKPOINT_ABI,
  PREDICTION_V2_FACTORY_ABI,
  PREDICTION_V2_POOL_MANAGER_STATE_ABI,
  PREDICTION_V2_VAULT_ABI,
  type PredictionV2OraclePolicy,
  type PredictionV2PoolKey,
  type PredictionV2RegistrySnapshot,
} from "../lib/prediction-v2/abi";
import {
  predictionV2MarketId,
  predictionV2PoolId,
} from "../lib/prediction-v2/accounting";
import { predictionV2RegistrySnapshotHash } from
  "../lib/prediction-v2/codec";
import {
  PREDICTION_V2_PUBLIC_RELEASE_RUNTIME_PREFLIGHT_MAX_RPC_LOGICAL_CALLS,
  PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS,
  type PredictionV2PublicReleaseV2,
} from "../lib/prediction-v2/public-release-v2.server";
import type { PredictionV2ReadBinding, PredictionV2ReadMarket } from
  "../lib/prediction-v2/read-model-v2.server";
import {
  PREDICTION_V2_EXECUTION_ROUTER_READ_ABI,
  PREDICTION_V2_FACTORY_CANONICAL_READ_ABI,
  PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
  PREDICTION_V2_TARGETED_MARKET_MAX_PROVIDER_REQUESTS,
} from "../lib/prediction-v2/read-model-v2.server";
import {
  PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
  PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
  PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
} from "../lib/prediction-v2/resolution-proof-v2-abi";
import {
  PREDICTION_V2_RESOLUTION_CHAIN_ID,
  PREDICTION_V2_RESOLUTION_MAX_OBSERVATION_DISTANCE,
  PREDICTION_V2_RESOLUTION_MAX_PROVIDER_REQUESTS,
  PREDICTION_V2_RESOLUTION_MAX_SEARCH_STEPS,
  PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY,
  PredictionV2ResolutionProofError,
  findPredictionV2ResolutionProof,
  revalidateAndSimulatePredictionV2Resolution,
  type PredictionV2ResolutionBlock,
  type PredictionV2ResolutionCallRequest,
  type PredictionV2ResolutionCodeRequest,
  type PredictionV2ResolutionReleaseBinding,
  type PredictionV2ResolutionRpcQuorum,
  type PredictionV2ResolutionRpcReader,
} from "../lib/prediction-v2/resolution-proof-v2.server";
import {
  PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS,
  PREDICTION_V2_HARD_FALLBACK_OFFSET_SECONDS,
  PREDICTION_V2_RESOLUTION_ACTION_MAX_INVOCATION_PROVIDER_REQUESTS,
  PREDICTION_V2_RESOLUTION_BINDING_DERIVATION_MAX_PROVIDER_REQUESTS,
  PREDICTION_V2_RESOLUTION_PUBLIC_RELEASE_MAX_PROVIDER_REQUESTS,
  PREDICTION_V2_SOFT_RESOLUTION_OFFSET_SECONDS,
  decidePredictionV2ResolutionAction,
  decidePredictionV2ResolutionActionFromPublicRelease,
} from "../lib/prediction-v2/resolution-action-v2.server";

const VAULT = getAddress("0x1000000000000000000000000000000000000001");
const CHECKPOINT = getAddress("0x2000000000000000000000000000000000000002");
const FEED = getAddress("0x3000000000000000000000000000000000000003");
const AGGREGATOR_ONE = getAddress("0x4000000000000000000000000000000000000004");
const AGGREGATOR_TWO = getAddress("0x5000000000000000000000000000000000000005");
const SENDER = getAddress("0x6000000000000000000000000000000000000006");
const FACTORY = getAddress("0x7000000000000000000000000000000000000007");
const REGISTRY = getAddress("0x8000000000000000000000000000000000000008");
const CHECKPOINT_DEPLOYER = getAddress(
  "0x9000000000000000000000000000000000000009",
);
const HOOK = getAddress("0xa00000000000000000000000000000000000000a");
const ROUTER = getAddress("0xb00000000000000000000000000000000000000b");
const POOL_MANAGER = getAddress("0xc00000000000000000000000000000000000000c");
const COLLATERAL = getAddress("0xd00000000000000000000000000000000000000d");
const ECONOMIC_KEY = keccak256(toBytes("prediction-v2-resolution-economic-key"));
const VAULT_CODE = "0x6000600055" as Hex;
const CHECKPOINT_CODE = "0x6001600155" as Hex;
const FEED_CODE = "0x6002600255" as Hex;
const AGGREGATOR_ONE_CODE = "0x6003600355" as Hex;
const AGGREGATOR_TWO_CODE = "0x6004600455" as Hex;
const FACTORY_CODE = "0x6005600555" as Hex;
const REGISTRY_CODE = "0x6006600655" as Hex;
const CHECKPOINT_DEPLOYER_CODE = "0x6007600755" as Hex;
const POLICY_HASH =
  "0x14b51aac26efb0507bb7558c0f4860171737dba2f519f65da3d708b05b072851";
const DESCRIPTION = "BTC / USD";
const DESCRIPTION_HASH = keccak256(toBytes(DESCRIPTION));
const T = 1_800_000_000n;
const REGISTRY_POLICY = Object.freeze({
  checkpointKind: POLICY_HASH,
  checkpointAdapter: CHECKPOINT_DEPLOYER,
  checkpointAdapterCodehash: keccak256(CHECKPOINT_DEPLOYER_CODE),
  feedId: `0x${"00".repeat(32)}`,
  feedAddress: FEED,
  feedProxyCodehash: keccak256(FEED_CODE),
  feedPhaseId: 1,
  feedAggregator: AGGREGATOR_ONE,
  feedAggregatorCodehash: keccak256(AGGREGATOR_ONE_CODE),
  feedDescriptionHash: DESCRIPTION_HASH,
  feedDecimals: 8,
  quoteCurrency: stringToHex("USD", { size: 32 }),
  assetEvidenceHash: keccak256(toBytes("prediction-v2-resolution-asset-evidence")),
  maxOpenInterestAtoms: 20_000_000n,
  validUntil: T + 30n * 24n * 60n * 60n,
  policyVersion: 1,
  active: true,
}) satisfies PredictionV2OraclePolicy;
const REGISTRY_SNAPSHOT = Object.freeze({
  assetKey: predictionOnchainAssetKeyV2(PREDICTION_PRESET_ASSETS_V2[0].identity),
  revision: 1n,
  identity: PREDICTION_PRESET_ASSETS_V2[0].identity,
  displaySymbol: "BTC",
  policy: REGISTRY_POLICY,
}) satisfies PredictionV2RegistrySnapshot;
const ASSET_KEY = REGISTRY_SNAPSHOT.assetKey;
const REGISTRY_SNAPSHOT_HASH = predictionV2RegistrySnapshotHash(
  REGISTRY_SNAPSHOT,
);
const MARKET_ID = predictionV2MarketId(ECONOMIC_KEY, REGISTRY_SNAPSHOT_HASH);
const POOL_KEY = Object.freeze({
  currency0: SENDER,
  currency1: AGGREGATOR_TWO,
  fee: 200,
  tickSpacing: 10,
  hooks: HOOK,
}) satisfies PredictionV2PoolKey;
const POOL_ID = predictionV2PoolId(POOL_KEY);
const SLOT0 = toHex((200n << 208n) | (1n << 96n), { size: 32 });

afterEach(() => {
  productionHarness.release = null;
  productionHarness.sessionFactory = null;
  productionHarness.marketReader = null;
  productionHarness.readBinding = null;
});

type RoundFixture = Readonly<{
  id: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
  answeredInRound: bigint;
}>;

type FixtureState = {
  chainId: number;
  safeBlockNumber: bigint;
  blocks: Map<bigint, PredictionV2ResolutionBlock>;
  codes: Map<string, Hex>;
  vaultState: bigint;
  checkpointStatus: bigint;
  observationTime: bigint;
  resolutionDeadline: bigint;
  hardResolutionDeadline: bigint;
  fallbackRequestedAt: bigint;
  fallbackChallengeDeadline: bigint;
  phaseId: number;
  highestApprovedPhase: number;
  phaseAggregators: Map<number, Address>;
  phaseApproval: Readonly<{
    aggregator: Address;
    aggregatorCodehash: Hex;
    registryRevision: bigint;
    approvalTimestamp: bigint;
    minimumEligibleLocalRoundId: bigint;
  }>;
  latestRoundId: bigint;
  rounds: Map<bigint, RoundFixture>;
  roundFactory?: (roundId: bigint) => RoundFixture | undefined;
  checkpointSimulationStatus: bigint;
  vaultSimulationState: bigint;
};

function hash(byte: string) {
  return `0x${byte.repeat(64)}` as `0x${string}`;
}

function block(
  number: bigint,
  timestamp = T + 1_000n,
  byte = "1",
): PredictionV2ResolutionBlock {
  return Object.freeze({
    number,
    hash: hash(byte),
    parentHash: hash(byte === "1" ? "a" : "1"),
    timestamp,
  });
}

function roundId(phaseId: number, localRoundId: bigint) {
  return (BigInt(phaseId) << 64n) | localRoundId;
}

function round(
  phaseId: number,
  localRoundId: bigint,
  updatedAt: bigint,
  answer = 60_000_00000000n,
): RoundFixture {
  const id = roundId(phaseId, localRoundId);
  return Object.freeze({
    id,
    answer,
    startedAt: updatedAt > 2n ? updatedAt - 2n : updatedAt,
    updatedAt,
    answeredInRound: id,
  });
}

function baseState(): FixtureState {
  const snapshot = block(1_000n);
  const rounds = new Map<bigint, RoundFixture>();
  for (const value of [
    round(1, 100n, T - 10n),
    round(1, 101n, T),
    round(1, 102n, T + 5n),
    round(1, 103n, T + 30n),
  ]) rounds.set(value.id, value);
  return {
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    safeBlockNumber: snapshot.number,
    blocks: new Map([[snapshot.number, snapshot]]),
    codes: new Map([
      [VAULT.toLowerCase(), VAULT_CODE],
      [CHECKPOINT.toLowerCase(), CHECKPOINT_CODE],
      [FEED.toLowerCase(), FEED_CODE],
      [AGGREGATOR_ONE.toLowerCase(), AGGREGATOR_ONE_CODE],
      [AGGREGATOR_TWO.toLowerCase(), AGGREGATOR_TWO_CODE],
      [FACTORY.toLowerCase(), FACTORY_CODE],
      [REGISTRY.toLowerCase(), REGISTRY_CODE],
      [CHECKPOINT_DEPLOYER.toLowerCase(), CHECKPOINT_DEPLOYER_CODE],
    ]),
    vaultState: 0n,
    checkpointStatus: 0n,
    observationTime: T,
    resolutionDeadline: T + PREDICTION_V2_SOFT_RESOLUTION_OFFSET_SECONDS,
    hardResolutionDeadline: T + PREDICTION_V2_HARD_FALLBACK_OFFSET_SECONDS,
    fallbackRequestedAt: 0n,
    fallbackChallengeDeadline: 0n,
    phaseId: 1,
    highestApprovedPhase: 1,
    phaseAggregators: new Map([[1, AGGREGATOR_ONE]]),
    phaseApproval: Object.freeze({
      aggregator: AGGREGATOR_ONE,
      aggregatorCodehash: keccak256(AGGREGATOR_ONE_CODE),
      registryRevision: 1n,
      approvalTimestamp: T - 100n,
      minimumEligibleLocalRoundId: 100n,
    }),
    latestRoundId: roundId(1, 103n),
    rounds,
    checkpointSimulationStatus: 1n,
    vaultSimulationState: 1n,
  };
}

function binding(): PredictionV2ResolutionReleaseBinding {
  return Object.freeze({
    chainId: PREDICTION_V2_RESOLUTION_CHAIN_ID,
    factory: FACTORY,
    economicKey: ECONOMIC_KEY,
    marketId: MARKET_ID,
    assetRegistry: REGISTRY,
    assetKey: ASSET_KEY,
    registryRevision: 1n,
    registrySnapshotHash: REGISTRY_SNAPSHOT_HASH,
    vault: VAULT,
    vaultRuntimeCodeHash: keccak256(VAULT_CODE),
    checkpoint: CHECKPOINT,
    checkpointRuntimeCodeHash: keccak256(CHECKPOINT_CODE),
    feed: FEED,
    feedProxyRuntimeCodeHash: keccak256(FEED_CODE),
    policyHash: POLICY_HASH,
    oracleRoundTopology: PREDICTION_V2_RESOLUTION_REQUIRED_ROUND_TOPOLOGY,
    oraclePhaseId: 1,
    oracleAggregator: AGGREGATOR_ONE,
    oracleAggregatorRuntimeCodeHash: keccak256(AGGREGATOR_ONE_CODE),
  });
}

function canonicalMarket(): PredictionV2ReadMarket {
  return Object.freeze({
    economicKey: ECONOMIC_KEY,
    marketId: MARKET_ID,
    assetKey: ASSET_KEY,
    registryRevision: 1n,
    registrySnapshotHash: REGISTRY_SNAPSHOT_HASH,
    resolutionPolicyHash: POLICY_HASH,
    policyValidUntil: REGISTRY_POLICY.validUntil,
    snapshotAssetCap: REGISTRY_POLICY.maxOpenInterestAtoms,
    vault: VAULT,
    checkpoint: CHECKPOINT,
    yesToken: SENDER,
    noToken: AGGREGATOR_TWO,
    poolId: POOL_ID,
    poolKey: POOL_KEY,
    asset: Object.freeze({
      identity: REGISTRY_SNAPSHOT.identity,
      displaySymbol: "BTC",
    }),
    predicate: Object.freeze({
      comparator: "greater-than-or-equal" as const,
      threshold: 60_000n * 100_000_000n,
      observationTime: T,
      priceDecimals: 8,
    }),
    lifecycle: Object.freeze({
      protocolState: "OPEN" as const,
      checkpointStatus: "AWAITING" as const,
      tradingPhase: "CLOSED" as const,
      tradable: false,
      tradabilityReason: "cutoff-reached" as const,
      checkpointTradingHealthy: true,
      resolvedPrice: 0n,
    }),
    deadlines: Object.freeze({
      cutoff: T - 60n,
      resolutionDeadline: T + PREDICTION_V2_SOFT_RESOLUTION_OFFSET_SECONDS,
      hardResolutionDeadline: T + PREDICTION_V2_HARD_FALLBACK_OFFSET_SECONDS,
      fallbackRequestedAt: 0n,
      fallbackChallengeDeadline: 0n,
    }),
    poolState: Object.freeze({
      sqrtPriceX96: 1n << 96n,
      tick: 0,
      poolManagerProtocolFee: 0,
      lpFee: 200,
      yesProbabilityBps: 5_000,
    }),
    accountedLiability: 2_000_000n,
  });
}

function publicReleaseFixture(): PredictionV2PublicReleaseV2 {
  const component = (
    name: string,
    componentAddress: Address,
    runtimeCodeHash: Hex,
  ) => Object.freeze({
    component: name,
    address: componentAddress,
    deploymentBlock: "1",
    runtimeCodeHash,
    contractIdentifier: "fixture",
    sourceVerificationInputSha256: `sha256:${"1".repeat(64)}`,
  });
  return Object.freeze({
    schemaVersion: "programmable.prediction-v2-public-release.v2",
    releaseVersion: "prediction-v2",
    status: "enabled",
    components: Object.freeze([
      component("GenericPredictionMarketFactoryV2", FACTORY, keccak256(FACTORY_CODE)),
      component("AssetRegistryV2", REGISTRY, keccak256(REGISTRY_CODE)),
      component("LifecycleHookV2", HOOK, keccak256("0x6008")),
      component("ExecutionRouterV2", ROUTER, keccak256("0x6009")),
      component(
        "CheckpointDeployerV2",
        CHECKPOINT_DEPLOYER,
        keccak256(CHECKPOINT_DEPLOYER_CODE),
      ),
    ]),
    runtimeDependencies: Object.freeze({
      readbackBlockNumber: "900",
      poolManager: Object.freeze({ address: POOL_MANAGER }),
      usdg: Object.freeze({ proxy: COLLATERAL }),
      checkpointCloneRuntimeCodeHash: keccak256(CHECKPOINT_CODE),
    }),
    gates: Object.freeze([
      Object.freeze({
        gateId: "oracle-qualified-assets",
        status: "closed",
        evidenceSha256: `sha256:${"2".repeat(64)}`,
      }),
    ]),
  }) as unknown as PredictionV2PublicReleaseV2;
}

function publicReleaseReadBindingFixture(): PredictionV2ReadBinding {
  return Object.freeze({
    factory: FACTORY,
    assetRegistry: REGISTRY,
    poolManager: POOL_MANAGER,
    hook: HOOK,
    collateral: COLLATERAL,
    router: ROUTER,
    deploymentBlock: 1n,
  });
}

function encodeResult(
  abi: Abi,
  functionName: string,
  result: unknown,
): Hex {
  return encodeFunctionResult({
    abi,
    functionName: functionName as never,
    result: result as never,
  });
}

function assertBlockRequest(
  state: FixtureState,
  request: PredictionV2ResolutionCallRequest | PredictionV2ResolutionCodeRequest,
) {
  const expected = state.blocks.get(request.blockNumber);
  if (
    request.requireCanonical !== true ||
    !expected ||
    expected.hash.toLowerCase() !== request.blockHash.toLowerCase()
  ) throw new Error("noncanonical fixture request");
}

function hasVisiblePostObservationEvidence(
  state: FixtureState,
  snapshot: PredictionV2ResolutionBlock,
) {
  const initialCode = state.codes.get(AGGREGATOR_ONE.toLowerCase());
  const currentCode = state.codes.get(
    state.phaseApproval.aggregator.toLowerCase(),
  );
  if (
    state.codes.get(FEED.toLowerCase()) !== FEED_CODE ||
    !initialCode || keccak256(initialCode) !== keccak256(AGGREGATOR_ONE_CODE) ||
    state.phaseAggregators.get(1)?.toLowerCase() !== AGGREGATOR_ONE.toLowerCase() ||
    state.phaseId !== state.highestApprovedPhase ||
    state.phaseApproval.approvalTimestamp > state.observationTime ||
    !currentCode || keccak256(currentCode) !== state.phaseApproval.aggregatorCodehash ||
    state.phaseAggregators.get(state.phaseId)?.toLowerCase() !==
      state.phaseApproval.aggregator.toLowerCase()
  ) return false;
  const latest = state.rounds.get(state.latestRoundId) ??
    state.roundFactory?.(state.latestRoundId);
  if (!latest) return false;
  const phase = Number(latest.id >> 64n);
  const local = latest.id & ((1n << 64n) - 1n);
  const answeredPhase = Number(latest.answeredInRound >> 64n);
  const answeredLocal = latest.answeredInRound & ((1n << 64n) - 1n);
  return phase === state.phaseId &&
    local >= state.phaseApproval.minimumEligibleLocalRoundId &&
    latest.answer > 0n && latest.answer <= (1n << 191n) - 1n &&
    latest.startedAt > 0n && latest.startedAt <= latest.updatedAt &&
    latest.updatedAt > state.observationTime &&
    latest.updatedAt <= snapshot.timestamp && latest.updatedAt < (1n << 32n) &&
    answeredPhase === phase && answeredLocal >= local;
}

function responseFor(
  state: FixtureState,
  request: PredictionV2ResolutionCallRequest,
): Hex | Readonly<{ status: "reverted"; data: Hex }> {
  assertBlockRequest(state, request);
  const snapshot = state.blocks.get(request.blockNumber);
  if (!snapshot) throw new Error("missing fixture snapshot");
  if (request.to.toLowerCase() === VAULT.toLowerCase()) {
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_VAULT_ABI,
      data: request.data,
    });
    switch (decoded.functionName) {
      case "collateral":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "collateral", COLLATERAL);
      case "checkpoint":
        return encodeResult(PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI, "checkpoint", CHECKPOINT);
      case "factory":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "factory", FACTORY);
      case "router":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "router", ROUTER);
      case "yesToken":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "yesToken", SENDER);
      case "noToken":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "noToken", AGGREGATOR_TWO);
      case "cutoff":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "cutoff", T - 60n);
      case "threshold":
        return encodeResult(
          PREDICTION_V2_VAULT_ABI,
          "threshold",
          60_000n * 100_000_000n,
        );
      case "economicKey":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "economicKey", ECONOMIC_KEY);
      case "marketId":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "marketId", MARKET_ID);
      case "assetKey":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "assetKey", ASSET_KEY);
      case "registryRevision":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "registryRevision", 1n);
      case "registrySnapshotHash":
        return encodeResult(
          PREDICTION_V2_VAULT_ABI,
          "registrySnapshotHash",
          REGISTRY_SNAPSHOT_HASH,
        );
      case "oraclePolicyHash":
        return encodeResult(
          PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
          "oraclePolicyHash",
          POLICY_HASH,
        );
      case "state":
        return encodeResult(PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI, "state", state.vaultState);
      case "accountedLiability":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "accountedLiability", 2_000_000n);
      case "canonicalPoolId":
        return encodeResult(PREDICTION_V2_VAULT_ABI, "canonicalPoolId", POOL_ID);
      case "finalize":
        if (
          state.vaultState === 0n && state.checkpointStatus === 0n &&
          state.fallbackRequestedAt !== 0n &&
          snapshot.timestamp > state.fallbackChallengeDeadline &&
          !hasVisiblePostObservationEvidence(state, snapshot)
        ) return { status: "reverted", data: "0x0a" };
        return encodeResult(
          PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
          "finalize",
          state.vaultSimulationState,
        );
      case "finalizeUnavailable": {
        if (state.vaultState !== 0n) {
          return encodeResult(
            PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
            "finalizeUnavailable",
            state.vaultState,
          );
        }
        if (state.checkpointStatus === 1n) {
          return encodeResult(
            PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
            "finalizeUnavailable",
            state.vaultSimulationState,
          );
        }
        if (state.checkpointStatus === 2n) {
          return encodeResult(
            PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
            "finalizeUnavailable",
            3n,
          );
        }
        const latest = state.rounds.get(state.latestRoundId) ??
          state.roundFactory?.(state.latestRoundId);
        if (
          snapshot.timestamp < state.resolutionDeadline ||
          !latest ||
          latest.updatedAt > state.observationTime
        ) return { status: "reverted", data: "0x05" };
        return encodeResult(
          PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
          "finalizeUnavailable",
          3n,
        );
      }
      case "requestUnprovenFallback": {
        if (state.vaultState !== 0n || state.checkpointStatus !== 0n) {
          return encodeResult(
            PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
            "requestUnprovenFallback",
            state.fallbackChallengeDeadline,
          );
        }
        if (snapshot.timestamp < state.hardResolutionDeadline) {
          return { status: "reverted", data: "0x06" };
        }
        if (hasVisiblePostObservationEvidence(state, snapshot)) {
          return { status: "reverted", data: "0x0b" };
        }
        const challenge = state.fallbackRequestedAt === 0n
          ? snapshot.timestamp + PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS
          : state.fallbackChallengeDeadline;
        return encodeResult(
          PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
          "requestUnprovenFallback",
          challenge,
        );
      }
      case "finalizeUnproven": {
        if (state.vaultState !== 0n) {
          return encodeResult(
            PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
            "finalizeUnproven",
            state.vaultState,
          );
        }
        if (state.checkpointStatus === 1n) {
          return encodeResult(
            PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
            "finalizeUnproven",
            state.vaultSimulationState,
          );
        }
        if (state.checkpointStatus === 2n) {
          return encodeResult(
            PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
            "finalizeUnproven",
            3n,
          );
        }
        if (
          state.fallbackRequestedAt === 0n ||
          snapshot.timestamp <= state.fallbackChallengeDeadline
        ) return { status: "reverted", data: "0x07" };
        if (hasVisiblePostObservationEvidence(state, snapshot)) {
          return { status: "reverted", data: "0x0c" };
        }
        return encodeResult(
          PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
          "finalizeUnproven",
          3n,
        );
      }
      case "finalizeResolved": {
        if (state.vaultState !== 0n) {
          return encodeResult(
            PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
            "finalizeResolved",
            state.vaultState,
          );
        }
        if (state.checkpointStatus === 0n) {
          return { status: "reverted", data: "0x08" };
        }
        return encodeResult(
          PREDICTION_V2_RESOLUTION_VAULT_PROOF_ABI,
          "finalizeResolved",
          state.checkpointStatus === 2n ? 3n : state.vaultSimulationState,
        );
      }
    }
  }
  if (request.to.toLowerCase() === CHECKPOINT.toLowerCase()) {
    let decoded: ReturnType<typeof decodeFunctionData>;
    try {
      decoded = decodeFunctionData({
        abi: PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
        data: request.data,
      });
    } catch {
      decoded = decodeFunctionData({
        abi: PREDICTION_V2_CHECKPOINT_ABI,
        data: request.data,
      });
    }
    switch (decoded.functionName) {
      case "status":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "status",
          state.checkpointStatus,
        );
      case "resolvedPrice":
        return encodeResult(PREDICTION_V2_CHECKPOINT_ABI, "resolvedPrice", 0n);
      case "feed":
        return encodeResult(PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI, "feed", FEED);
      case "policyHash":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "policyHash",
          POLICY_HASH,
        );
      case "observationTime":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "observationTime",
          state.observationTime,
        );
      case "resolutionDeadline":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "resolutionDeadline",
          state.resolutionDeadline,
        );
      case "hardResolutionDeadline":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "hardResolutionDeadline",
          state.hardResolutionDeadline,
        );
      case "fallbackRequestedAt":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "fallbackRequestedAt",
          state.fallbackRequestedAt,
        );
      case "fallbackChallengeDeadline":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "fallbackChallengeDeadline",
          state.fallbackChallengeDeadline,
        );
      case "isTradingHealthy":
        return encodeResult(
          PREDICTION_V2_CHECKPOINT_ABI,
          "isTradingHealthy",
          state.checkpointStatus === 0n,
        );
      case "feedDecimals":
        return encodeResult(PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI, "feedDecimals", 8);
      case "priceDecimals":
        return encodeResult(PREDICTION_V2_CHECKPOINT_ABI, "priceDecimals", 8);
      case "feedDescriptionHash":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "feedDescriptionHash",
          DESCRIPTION_HASH,
        );
      case "oracleProxyCodehash":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "oracleProxyCodehash",
          keccak256(FEED_CODE),
        );
      case "oraclePhaseId":
        return encodeResult(PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI, "oraclePhaseId", 1);
      case "oracleAggregator":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "oracleAggregator",
          AGGREGATOR_ONE,
        );
      case "oracleAggregatorCodehash":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "oracleAggregatorCodehash",
          keccak256(AGGREGATOR_ONE_CODE),
        );
      case "highestApprovedPhase":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "highestApprovedPhase",
          state.highestApprovedPhase,
        );
      case "phaseApprovals":
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "phaseApprovals",
          [
            state.phaseApproval.aggregator,
            state.phaseApproval.aggregatorCodehash,
            state.phaseApproval.registryRevision,
            state.phaseApproval.approvalTimestamp,
            state.phaseApproval.minimumEligibleLocalRoundId,
          ],
        );
      case "resolve":
        if (
          state.checkpointStatus === 0n && state.fallbackRequestedAt !== 0n &&
          snapshot.timestamp > state.fallbackChallengeDeadline &&
          !hasVisiblePostObservationEvidence(state, snapshot)
        ) return { status: "reverted", data: "0x0d" };
        return encodeResult(
          PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
          "resolve",
          state.checkpointSimulationStatus,
        );
    }
  }
  if (request.to.toLowerCase() === FEED.toLowerCase()) {
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
      data: request.data,
    });
    switch (decoded.functionName) {
      case "phaseId":
        return encodeResult(PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI, "phaseId", state.phaseId);
      case "aggregator": {
        const aggregator = state.phaseAggregators.get(state.phaseId);
        if (!aggregator) return { status: "reverted", data: "0x01" };
        return encodeResult(PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI, "aggregator", aggregator);
      }
      case "phaseAggregators": {
        const phase = Number(decoded.args[0]);
        const aggregator = state.phaseAggregators.get(phase);
        if (!aggregator) return { status: "reverted", data: "0x02" };
        return encodeResult(
          PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI,
          "phaseAggregators",
          aggregator,
        );
      }
      case "decimals":
        return encodeResult(PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI, "decimals", 8);
      case "description":
        return encodeResult(PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI, "description", DESCRIPTION);
      case "latestRoundData": {
        const latest = state.rounds.get(state.latestRoundId) ?? state.roundFactory?.(state.latestRoundId);
        if (!latest) return { status: "reverted", data: "0x03" };
        return encodeResult(PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI, "latestRoundData", [
          latest.id,
          latest.answer,
          latest.startedAt,
          latest.updatedAt,
          latest.answeredInRound,
        ]);
      }
      case "getRoundData": {
        const requested = BigInt(decoded.args[0]);
        const found = state.rounds.get(requested) ?? state.roundFactory?.(requested);
        if (!found) return { status: "reverted", data: "0x04" };
        return encodeResult(PREDICTION_V2_CHAINLINK_FEED_PROOF_ABI, "getRoundData", [
          found.id,
          found.answer,
          found.startedAt,
          found.updatedAt,
          found.answeredInRound,
        ]);
      }
    }
  }
  if (request.to.toLowerCase() === FACTORY.toLowerCase()) {
    let decoded: ReturnType<typeof decodeFunctionData>;
    try {
      decoded = decodeFunctionData({
        abi: PREDICTION_V2_FACTORY_ABI,
        data: request.data,
      });
    } catch {
      decoded = decodeFunctionData({
        abi: PREDICTION_V2_FACTORY_CANONICAL_READ_ABI,
        data: request.data,
      });
    }
    switch (decoded.functionName) {
      case "assetRegistry":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, "assetRegistry", REGISTRY);
      case "manager":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, "manager", POOL_MANAGER);
      case "marketCount":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, "marketCount", 1n);
      case "markets":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, "markets", [
          VAULT,
          CHECKPOINT,
          POOL_ID,
          MARKET_ID,
          ASSET_KEY,
          REGISTRY_SNAPSHOT_HASH,
          POLICY_HASH,
          1n,
          REGISTRY_POLICY.validUntil,
          REGISTRY_POLICY.maxOpenInterestAtoms,
        ]);
      case "getPoolKey":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, "getPoolKey", POOL_KEY);
      case "economicEventKey":
        return encodeResult(
          PREDICTION_V2_FACTORY_ABI,
          "economicEventKey",
          ECONOMIC_KEY,
        );
      case "isCanonicalVault":
        return encodeResult(
          PREDICTION_V2_FACTORY_CANONICAL_READ_ABI,
          "isCanonicalVault",
          true,
        );
    }
  }
  if (request.to.toLowerCase() === REGISTRY.toLowerCase()) {
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_ASSET_REGISTRY_ABI,
      data: request.data,
    });
    if (decoded.functionName === "getSnapshot") {
      return encodeResult(
        PREDICTION_V2_ASSET_REGISTRY_ABI,
        "getSnapshot",
        REGISTRY_SNAPSHOT,
      );
    }
    if (decoded.functionName === "hashSnapshot") {
      return encodeResult(
        PREDICTION_V2_ASSET_REGISTRY_ABI,
        "hashSnapshot",
        REGISTRY_SNAPSHOT_HASH,
      );
    }
  }
  if (request.to.toLowerCase() === HOOK.toLowerCase()) {
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
      data: request.data,
    });
    switch (decoded.functionName) {
      case "factory":
        return encodeResult(PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, "factory", FACTORY);
      case "authorizedRouter":
        return encodeResult(
          PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
          "authorizedRouter",
          ROUTER,
        );
      case "poolManager":
        return encodeResult(
          PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
          "poolManager",
          POOL_MANAGER,
        );
      case "lifecycle":
        return encodeResult(PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, "lifecycle", [
          T - 60n,
          2n,
          CHECKPOINT,
          true,
        ]);
    }
  }
  if (request.to.toLowerCase() === ROUTER.toLowerCase()) {
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_EXECUTION_ROUTER_READ_ABI,
      data: request.data,
    });
    const value = decoded.functionName === "factory"
      ? FACTORY
      : decoded.functionName === "manager"
        ? POOL_MANAGER
        : COLLATERAL;
    return encodeResult(
      PREDICTION_V2_EXECUTION_ROUTER_READ_ABI,
      decoded.functionName,
      value,
    );
  }
  if (request.to.toLowerCase() === POOL_MANAGER.toLowerCase()) {
    const decoded = decodeFunctionData({
      abi: PREDICTION_V2_POOL_MANAGER_STATE_ABI,
      data: request.data,
    });
    if (decoded.functionName === "extsload") {
      return encodeResult(
        PREDICTION_V2_POOL_MANAGER_STATE_ABI,
        "extsload",
        SLOT0,
      );
    }
  }
  throw new Error(`unexpected fixture call to ${request.to}`);
}

function reader(
  readerId: string,
  state: FixtureState,
  transform?: (
    request: PredictionV2ResolutionCallRequest,
    response: Hex | Readonly<{ status: "reverted"; data: Hex }>,
  ) => Hex | Readonly<{ status: "reverted"; data: Hex }>,
): PredictionV2ResolutionRpcReader {
  return Object.freeze({
    readerId,
    getChainId: async () => state.chainId,
    getSafeBlock: async () => {
      const safe = state.blocks.get(state.safeBlockNumber);
      if (!safe) throw new Error("missing safe block");
      return safe;
    },
    getBlock: async (number) => state.blocks.get(number) ?? null,
    call: async (request) => {
      const response = responseFor(state, request);
      return transform ? transform(request, response) : response;
    },
    getCode: async (request) => {
      assertBlockRequest(state, request);
      return state.codes.get(request.address.toLowerCase()) ?? "0x";
    },
  });
}

function countedReader(
  source: PredictionV2ResolutionRpcReader,
  counter: { value: number },
  beforeSafeBlock?: () => void,
): PredictionV2ResolutionRpcReader {
  return Object.freeze({
    readerId: source.readerId,
    getChainId(signal?: AbortSignal) {
      counter.value += 1;
      return source.getChainId(signal);
    },
    getSafeBlock(signal?: AbortSignal) {
      counter.value += 1;
      beforeSafeBlock?.();
      return source.getSafeBlock(signal);
    },
    getBlock(number: bigint, signal?: AbortSignal) {
      counter.value += 1;
      return source.getBlock(number, signal);
    },
    call(request: PredictionV2ResolutionCallRequest) {
      counter.value += 1;
      return source.call(request);
    },
    getCode(request: PredictionV2ResolutionCodeRequest) {
      counter.value += 1;
      return source.getCode(request);
    },
  });
}

function quorum(
  primaryState: FixtureState,
  secondaryState: FixtureState = primaryState,
  secondaryTransform?: Parameters<typeof reader>[2],
): PredictionV2ResolutionRpcQuorum {
  return Object.freeze({
    primary: reader("primary", primaryState),
    secondary: reader("secondary", secondaryState, secondaryTransform),
  });
}

async function expectCode(
  operation: Promise<unknown>,
  code: PredictionV2ResolutionProofError["code"],
) {
  await expect(operation).rejects.toMatchObject({
    name: "PredictionV2ResolutionProofError",
    code,
  });
}

describe("Prediction V2 Chainlink adjacent-round proof finder", () => {
  it("treats updatedAt == T as before, finds the first post-T round, and prepares only after dual simulation", async () => {
    const state = baseState();
    const rpc = quorum(state);
    const candidate = await findPredictionV2ResolutionProof({
      quorum: rpc,
      binding: binding(),
    });

    expect(candidate.chainId).toBe(4_663);
    expect(candidate.snapshot).toEqual(state.blocks.get(1_000n));
    expect(candidate.before.localRoundId).toBe(101n);
    expect(candidate.before.updatedAt).toBe(T);
    expect(candidate.after.localRoundId).toBe(102n);
    expect(candidate.after.updatedAt).toBe(T + 5n);
    expect(candidate.expectedCheckpointStatus).toBe("FINAL");
    expect(candidate.oracle.currentPhase).toBe(1);
    expect(candidate.oracle.highestApprovedPhase).toBe(1);
    expect(candidate.oracle.minimumEligibleLocalRoundId).toBe(100n);
    expect(candidate.providerRequests).toBeLessThanOrEqual(
      PREDICTION_V2_RESOLUTION_MAX_PROVIDER_REQUESTS,
    );

    const prepared = await revalidateAndSimulatePredictionV2Resolution({
      quorum: rpc,
      binding: binding(),
      candidate,
      sender: SENDER,
    });
    expect(prepared).toMatchObject({
      chainId: 4_663,
      from: SENDER,
      to: VAULT,
      value: 0n,
      simulation: {
        checkpointStatus: "FINAL",
        vaultState: "FINAL_YES",
      },
    });
    expect(prepared.data.slice(0, 10)).toBe("0xa0345fca");
  });

  it("accepts equal timestamps without skipping the earliest valid boundary", async () => {
    const state = baseState();
    const equalAfter = round(1, 103n, T + 5n);
    state.rounds.set(equalAfter.id, equalAfter);
    const candidate = await findPredictionV2ResolutionProof({
      quorum: quorum(state),
      binding: binding(),
    });
    expect(candidate.after.localRoundId).toBe(102n);
    expect(candidate.after.updatedAt).toBe(T + 5n);
  });

  it("keeps the inclusive 25-hour boundary FINAL and deterministically resolves older evidence INVALID", async () => {
    const boundary = baseState();
    const before = round(1, 101n, T - PREDICTION_V2_RESOLUTION_MAX_OBSERVATION_DISTANCE);
    const after = round(1, 102n, T + PREDICTION_V2_RESOLUTION_MAX_OBSERVATION_DISTANCE);
    boundary.rounds.set(before.id, before);
    boundary.rounds.set(after.id, after);
    boundary.rounds.set(roundId(1, 103n), round(1, 103n, after.updatedAt + 1n));
    boundary.blocks.set(1_000n, block(1_000n, after.updatedAt + 10n));
    const candidate = await findPredictionV2ResolutionProof({
      quorum: quorum(boundary),
      binding: binding(),
    });
    expect(candidate.before.updatedAt).toBe(T - 90_000n);
    expect(candidate.after.updatedAt).toBe(T + 90_000n);
    expect(candidate.expectedCheckpointStatus).toBe("FINAL");

    const staleBefore = baseState();
    staleBefore.rounds.set(
      roundId(1, 101n),
      round(1, 101n, T - PREDICTION_V2_RESOLUTION_MAX_OBSERVATION_DISTANCE - 1n),
    );
    const staleBeforeRpc = quorum(staleBefore);
    const staleBeforeCandidate = await findPredictionV2ResolutionProof({
      quorum: staleBeforeRpc,
      binding: binding(),
    });
    expect(staleBeforeCandidate.expectedCheckpointStatus).toBe("INVALID");
    staleBefore.checkpointSimulationStatus = 2n;
    staleBefore.vaultSimulationState = 3n;
    const preparedInvalid = await revalidateAndSimulatePredictionV2Resolution({
      quorum: staleBeforeRpc,
      binding: binding(),
      candidate: staleBeforeCandidate,
      sender: SENDER,
    });
    expect(preparedInvalid.simulation).toEqual({
      checkpointStatus: "INVALID",
      vaultState: "FINAL_INVALID",
    });

    const staleAfter = baseState();
    const late = T + PREDICTION_V2_RESOLUTION_MAX_OBSERVATION_DISTANCE + 1n;
    staleAfter.rounds.set(roundId(1, 102n), round(1, 102n, late));
    staleAfter.rounds.set(roundId(1, 103n), round(1, 103n, late + 1n));
    staleAfter.blocks.set(1_000n, block(1_000n, late + 10n));
    const staleAfterCandidate = await findPredictionV2ResolutionProof({
      quorum: quorum(staleAfter),
      binding: binding(),
    });
    expect(staleAfterCandidate.expectedCheckpointStatus).toBe("INVALID");
  });

  it("fails closed on missing rounds and on any raw provider disagreement", async () => {
    const missing = baseState();
    missing.rounds.delete(roundId(1, 102n));
    await expectCode(
      findPredictionV2ResolutionProof({ quorum: quorum(missing), binding: binding() }),
      "proof-unavailable",
    );

    const sparseMidpoint = baseState();
    for (const local of [105n, 106n, 107n]) {
      const value = round(1, local, T + local);
      sparseMidpoint.rounds.set(value.id, value);
    }
    sparseMidpoint.latestRoundId = roundId(1, 107n);
    await expectCode(
      findPredictionV2ResolutionProof({
        quorum: quorum(sparseMidpoint),
        binding: binding(),
      }),
      "proof-unavailable",
    );

    const state = baseState();
    const secondary = baseState();
    secondary.rounds.set(roundId(1, 102n), round(1, 102n, T + 6n));
    await expectCode(
      findPredictionV2ResolutionProof({
        quorum: quorum(state, secondary),
        binding: binding(),
      }),
      "provider-disagreement",
    );
  });

  it("rejects wrong-chain readers, reused reader identity, and a reorg before broadcast", async () => {
    const wrongChain = baseState();
    wrongChain.chainId = 1;
    await expectCode(
      findPredictionV2ResolutionProof({ quorum: quorum(wrongChain), binding: binding() }),
      "wrong-chain",
    );

    const state = baseState();
    const oneReader = reader("same", state);
    await expectCode(
      findPredictionV2ResolutionProof({
        quorum: { primary: oneReader, secondary: oneReader },
        binding: binding(),
      }),
      "invalid-input",
    );

    await expectCode(
      findPredictionV2ResolutionProof({
        quorum: quorum(state),
        binding: {
          ...binding(),
          oracleRoundTopology: "unqualified" as
            PredictionV2ResolutionReleaseBinding["oracleRoundTopology"],
        },
      }),
      "invalid-input",
    );

    const rpc = quorum(state);
    const candidate = await findPredictionV2ResolutionProof({
      quorum: rpc,
      binding: binding(),
    });
    state.blocks.set(1_000n, block(1_000n, T + 1_000n, "9"));
    await expectCode(
      revalidateAndSimulatePredictionV2Resolution({
        quorum: rpc,
        binding: binding(),
        candidate,
        sender: SENDER,
      }),
      "noncanonical-block",
    );
  });

  it("authenticates the Vault runtime and exposes the terminal-checkpoint handoff explicitly", async () => {
    const wrongVault = baseState();
    wrongVault.codes.set(VAULT.toLowerCase(), "0x6005600555");
    await expectCode(
      findPredictionV2ResolutionProof({ quorum: quorum(wrongVault), binding: binding() }),
      "binding-mismatch",
    );

    const splitTerminal = baseState();
    splitTerminal.checkpointStatus = 1n;
    await expectCode(
      findPredictionV2ResolutionProof({
        quorum: quorum(splitTerminal),
        binding: binding(),
      }),
      "checkpoint-terminal",
    );
  });

  it("rejects phase rollover gaps, approval after T, and a round below the captured floor", async () => {
    const rollover = baseState();
    rollover.phaseId = 2;
    rollover.phaseAggregators.set(2, AGGREGATOR_TWO);
    await expectCode(
      findPredictionV2ResolutionProof({ quorum: quorum(rollover), binding: binding() }),
      "proof-unavailable",
    );

    const lateApproval = baseState();
    lateApproval.phaseApproval = Object.freeze({
      ...lateApproval.phaseApproval,
      approvalTimestamp: T + 1n,
    });
    await expectCode(
      findPredictionV2ResolutionProof({ quorum: quorum(lateApproval), binding: binding() }),
      "proof-unavailable",
    );

    const highFloor = baseState();
    highFloor.phaseApproval = Object.freeze({
      ...highFloor.phaseApproval,
      minimumEligibleLocalRoundId: 103n,
    });
    await expectCode(
      findPredictionV2ResolutionProof({ quorum: quorum(highFloor), binding: binding() }),
      "proof-unavailable",
    );
  });

  it("detects a fully approved phase change during pre-broadcast revalidation", async () => {
    const state = baseState();
    const rpc = quorum(state);
    const candidate = await findPredictionV2ResolutionProof({
      quorum: rpc,
      binding: binding(),
    });

    const nextBlock = block(1_001n, T + 2_000n, "2");
    state.blocks.set(nextBlock.number, nextBlock);
    state.safeBlockNumber = nextBlock.number;
    state.phaseId = 2;
    state.highestApprovedPhase = 2;
    state.phaseAggregators.set(2, AGGREGATOR_TWO);
    state.phaseApproval = Object.freeze({
      aggregator: AGGREGATOR_TWO,
      aggregatorCodehash: keccak256(AGGREGATOR_TWO_CODE),
      registryRevision: 2n,
      approvalTimestamp: T - 50n,
      minimumEligibleLocalRoundId: 50n,
    });
    state.rounds.clear();
    for (const value of [
      round(2, 50n, T - 10n),
      round(2, 51n, T),
      round(2, 52n, T + 5n),
      round(2, 53n, T + 30n),
    ]) state.rounds.set(value.id, value);
    state.latestRoundId = roundId(2, 53n);

    await expectCode(
      revalidateAndSimulatePredictionV2Resolution({
        quorum: rpc,
        binding: binding(),
        candidate,
        sender: SENDER,
      }),
      "candidate-changed",
    );
  });

  it("fails closed when either dual simulation does not produce a winner", async () => {
    const state = baseState();
    const rpc = quorum(state);
    const candidate = await findPredictionV2ResolutionProof({
      quorum: rpc,
      binding: binding(),
    });
    state.checkpointSimulationStatus = 2n;
    await expectCode(
      revalidateAndSimulatePredictionV2Resolution({
        quorum: rpc,
        binding: binding(),
        candidate,
        sender: SENDER,
      }),
      "simulation-failed",
    );
    state.checkpointSimulationStatus = 1n;
    state.vaultSimulationState = 3n;
    await expectCode(
      revalidateAndSimulatePredictionV2Resolution({
        quorum: rpc,
        binding: binding(),
        candidate,
        sender: SENDER,
      }),
      "simulation-failed",
    );
  });

  it("rejects any tampering with the snapshot-bound candidate before revalidation", async () => {
    const state = baseState();
    const rpc = quorum(state);
    const candidate = await findPredictionV2ResolutionProof({
      quorum: rpc,
      binding: binding(),
    });
    const tampered = Object.freeze({
      ...candidate,
      before: Object.freeze({
        ...candidate.before,
        answer: candidate.before.answer + 1n,
      }),
    });
    await expectCode(
      revalidateAndSimulatePredictionV2Resolution({
        quorum: rpc,
        binding: binding(),
        candidate: tampered,
        sender: SENDER,
      }),
      "invalid-input",
    );
  });

  it("keeps a uint64-sized search inside the fixed search and provider budgets", async () => {
    const state = baseState();
    const maximumLocal = (1n << 64n) - 2n;
    const boundary = maximumLocal - 7n;
    state.phaseApproval = Object.freeze({
      ...state.phaseApproval,
      minimumEligibleLocalRoundId: 1n,
    });
    state.latestRoundId = roundId(1, maximumLocal);
    state.rounds.clear();
    state.roundFactory = (id) => {
      const phase = Number(id >> 64n);
      const local = id & ((1n << 64n) - 1n);
      if (phase !== 1 || local < 1n || local > maximumLocal) return undefined;
      return round(phase, local, local < boundary ? T : T + 1n);
    };
    const candidate = await findPredictionV2ResolutionProof({
      quorum: quorum(state),
      binding: binding(),
    });
    expect(candidate.before.localRoundId).toBe(boundary - 1n);
    expect(candidate.after.localRoundId).toBe(boundary);
    expect(candidate.searchSteps).toBeLessThanOrEqual(
      PREDICTION_V2_RESOLUTION_MAX_SEARCH_STEPS,
    );
    expect(candidate.providerRequests).toBeLessThanOrEqual(
      PREDICTION_V2_RESOLUTION_MAX_PROVIDER_REQUESTS,
    );
  });
});

describe("Prediction V2 bounded resolution action decision", () => {
  it("derives the complete unsigned action from one signed-release snapshot", async () => {
    const state = baseState();
    const snapshot = state.blocks.get(state.safeBlockNumber);
    if (!snapshot) throw new Error("missing fixture snapshot");
    const close = vi.fn();
    const runtimeBudget = {} as Parameters<
      typeof decidePredictionV2ResolutionActionFromPublicRelease
    >[0]["budget"];
    const runtimeReaders = Object.freeze([{}, {}]) as unknown as Parameters<
      typeof decidePredictionV2ResolutionActionFromPublicRelease
    >[0]["readers"];
    const sessionFactory = vi.fn(async () => Object.freeze({
      lease: Object.freeze({}) as never,
      quorum: quorum(state),
      snapshot,
      rpcLogicalCalls:
        PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS,
      close,
    }));
    productionHarness.release = publicReleaseFixture();
    productionHarness.readBinding = publicReleaseReadBindingFixture();
    productionHarness.sessionFactory = sessionFactory;

    const decision = await decidePredictionV2ResolutionActionFromPublicRelease({
      readers: runtimeReaders,
      budget: runtimeBudget,
      economicKey: ECONOMIC_KEY,
      marketId: MARKET_ID,
      account: SENDER,
    });

    expect(decision).toMatchObject({
      decision: "action",
      action: "finalize-with-proof",
      transaction: { to: VAULT, selector: "0xa0345fca", value: 0n },
      binding: {
        factory: FACTORY,
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        assetRegistry: REGISTRY,
        vault: VAULT,
        checkpoint: CHECKPOINT,
        feed: FEED,
      },
    });
    // registeredBlock=2 remains valid although the signed release readback is
    // block 900, because the canonical Factory deployment block is block 1.
    expect(sessionFactory).toHaveBeenCalledWith(
      productionHarness.release,
      runtimeReaders,
      runtimeBudget,
      undefined,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(decision.providerRequests).toBeLessThanOrEqual(
      PREDICTION_V2_RESOLUTION_PUBLIC_RELEASE_MAX_PROVIDER_REQUESTS,
    );
    expect(PREDICTION_V2_RESOLUTION_BINDING_DERIVATION_MAX_PROVIDER_REQUESTS)
      .toBe(42);
    expect(
      PREDICTION_V2_PUBLIC_RELEASE_RUNTIME_PREFLIGHT_MAX_RPC_LOGICAL_CALLS,
    ).toBe(42);
    expect(
      PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS,
    ).toBe(48);
    expect(PREDICTION_V2_RESOLUTION_PUBLIC_RELEASE_MAX_PROVIDER_REQUESTS).toBe(
      PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS +
        PREDICTION_V2_TARGETED_MARKET_MAX_PROVIDER_REQUESTS +
        PREDICTION_V2_RESOLUTION_BINDING_DERIVATION_MAX_PROVIDER_REQUESTS +
        PREDICTION_V2_RESOLUTION_ACTION_MAX_INVOCATION_PROVIDER_REQUESTS,
    );
    expect(PREDICTION_V2_RESOLUTION_PUBLIC_RELEASE_MAX_PROVIDER_REQUESTS).toBe(
      2_296,
    );
  });

  it("rejects a structural market row even inside a valid leased session", async () => {
    const state = baseState();
    const snapshot = state.blocks.get(state.safeBlockNumber);
    if (!snapshot) throw new Error("missing fixture snapshot");
    const close = vi.fn();
    productionHarness.release = publicReleaseFixture();
    productionHarness.readBinding = publicReleaseReadBindingFixture();
    productionHarness.sessionFactory = vi.fn(async () => Object.freeze({
      lease: Object.freeze({}) as never,
      quorum: quorum(state),
      snapshot,
      rpcLogicalCalls:
        PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS,
      close,
    }));
    productionHarness.marketReader = vi.fn(async () => Object.freeze({
      market: canonicalMarket(),
      snapshot,
    }));

    await expect(decidePredictionV2ResolutionActionFromPublicRelease({
      readers: Object.freeze([{}, {}]) as unknown as Parameters<
        typeof decidePredictionV2ResolutionActionFromPublicRelease
      >[0]["readers"],
      budget: {} as Parameters<
        typeof decidePredictionV2ResolutionActionFromPublicRelease
      >[0]["budget"],
      economicKey: ECONOMIC_KEY,
      marketId: MARKET_ID,
      account: SENDER,
    })).rejects.toMatchObject({
      name: "PredictionV2ResolutionActionError",
      code: "binding-mismatch",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes and rejects a release session whose reported cost drifts", async () => {
    const state = baseState();
    const snapshot = state.blocks.get(state.safeBlockNumber);
    if (!snapshot) throw new Error("missing fixture snapshot");
    const close = vi.fn();
    productionHarness.release = publicReleaseFixture();
    productionHarness.sessionFactory = vi.fn(async () => Object.freeze({
      lease: Object.freeze({}) as never,
      quorum: quorum(state),
      snapshot,
      rpcLogicalCalls:
        PREDICTION_V2_PUBLIC_RELEASE_SESSION_MAX_RPC_LOGICAL_CALLS - 1,
      close,
    }));

    await expect(decidePredictionV2ResolutionActionFromPublicRelease({
      readers: Object.freeze([{}, {}]) as unknown as Parameters<
        typeof decidePredictionV2ResolutionActionFromPublicRelease
      >[0]["readers"],
      budget: {} as Parameters<
        typeof decidePredictionV2ResolutionActionFromPublicRelease
      >[0]["budget"],
      economicKey: ECONOMIC_KEY,
      marketId: MARKET_ID,
      account: SENDER,
    })).rejects.toMatchObject({ code: "provider-failure" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("returns unsigned snapshot-bound FINAL and INVALID proof actions", async () => {
    const finalState = baseState();
    const finalDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(finalState),
      binding: binding(),
      account: SENDER,
    });
    expect(finalDecision).toMatchObject({
      decision: "action",
      action: "finalize-with-proof",
      account: SENDER,
      snapshot: finalState.blocks.get(1_000n),
      transaction: {
        to: VAULT,
        selector: "0xa0345fca",
        value: 0n,
      },
      expected: {
        checkpointStatus: "FINAL",
        vaultState: "FINAL_YES",
      },
    });
    if (finalDecision.decision !== "action") throw new Error("expected action");
    expect(finalDecision.transaction.data.slice(0, 10)).toBe(finalDecision.transaction.selector);
    expect(finalDecision.binding).toEqual(binding());
    expect(finalDecision.proofCommitment).toMatch(/^0x[0-9a-f]{64}$/u);

    const invalidState = baseState();
    invalidState.rounds.set(
      roundId(1, 101n),
      round(
        1,
        101n,
        T - PREDICTION_V2_RESOLUTION_MAX_OBSERVATION_DISTANCE - 1n,
      ),
    );
    invalidState.checkpointSimulationStatus = 2n;
    invalidState.vaultSimulationState = 3n;
    const invalidDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(invalidState),
      binding: binding(),
      account: SENDER,
    });
    expect(invalidDecision).toMatchObject({
      decision: "action",
      action: "finalize-with-proof",
      transaction: { to: VAULT, selector: "0xa0345fca", value: 0n },
      expected: {
        checkpointStatus: "INVALID",
        vaultState: "FINAL_INVALID",
      },
    });

    const challengedState = baseState();
    challengedState.fallbackRequestedAt = challengedState.hardResolutionDeadline;
    challengedState.fallbackChallengeDeadline =
      challengedState.fallbackRequestedAt + PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS;
    challengedState.blocks.set(
      1_000n,
      block(1_000n, challengedState.fallbackRequestedAt + 1n),
    );
    const challengedDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(challengedState),
      binding: binding(),
      account: SENDER,
    });
    expect(challengedDecision).toMatchObject({
      decision: "action",
      action: "finalize-with-proof",
      expected: {
        checkpointStatus: "FINAL",
        vaultState: "FINAL_YES",
        fallbackChallengeDeadline: challengedState.fallbackChallengeDeadline,
      },
    });
  });

  it("closes the direct-checkpoint liveness handoff with finalizeResolved", async () => {
    const finalCheckpoint = baseState();
    finalCheckpoint.checkpointStatus = 1n;
    finalCheckpoint.vaultSimulationState = 2n;
    const finalDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(finalCheckpoint),
      binding: binding(),
      account: SENDER,
    });
    expect(finalDecision).toMatchObject({
      decision: "action",
      action: "finalize-resolved",
      transaction: { to: VAULT, selector: "0xe24e19b0", value: 0n },
      expected: { checkpointStatus: "FINAL", vaultState: "FINAL_NO" },
    });

    const invalidCheckpoint = baseState();
    invalidCheckpoint.checkpointStatus = 2n;
    const invalidDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(invalidCheckpoint),
      binding: binding(),
      account: SENDER,
    });
    expect(invalidDecision).toMatchObject({
      decision: "action",
      action: "finalize-resolved",
      transaction: { selector: "0xe24e19b0", value: 0n },
      expected: { checkpointStatus: "INVALID", vaultState: "FINAL_INVALID" },
    });

    const inconsistentSimulation = baseState();
    inconsistentSimulation.checkpointStatus = 1n;
    inconsistentSimulation.vaultSimulationState = 3n;
    await expect(
      decidePredictionV2ResolutionAction({
        quorum: quorum(inconsistentSimulation),
        binding: binding(),
        account: SENDER,
      }),
    ).rejects.toMatchObject({
      name: "PredictionV2ResolutionActionError",
      code: "simulation-failed",
    });
  });

  it("uses exact observation and soft-timeout boundaries", async () => {
    const atObservation = baseState();
    atObservation.blocks.set(1_000n, block(1_000n, T));
    const observationDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(atObservation),
      binding: binding(),
      account: SENDER,
    });
    expect(observationDecision).toMatchObject({
      decision: "wait",
      reason: "observation-not-elapsed",
    });
    expect(observationDecision.providerRequests).toBeGreaterThan(0);

    const beforeSoft = baseState();
    beforeSoft.latestRoundId = roundId(1, 101n);
    beforeSoft.blocks.set(
      1_000n,
      block(1_000n, beforeSoft.resolutionDeadline - 1n),
    );
    const beforeDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(beforeSoft),
      binding: binding(),
      account: SENDER,
    });
    expect(beforeDecision).toMatchObject({
      decision: "wait",
      reason: "awaiting-post-t-round",
    });
    expect(beforeDecision.providerRequests).toBeGreaterThan(
      observationDecision.providerRequests,
    );

    const atSoft = baseState();
    atSoft.latestRoundId = roundId(1, 101n);
    atSoft.blocks.set(1_000n, block(1_000n, atSoft.resolutionDeadline));
    const softDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(atSoft),
      binding: binding(),
      account: SENDER,
    });
    expect(softDecision).toMatchObject({
      decision: "action",
      action: "finalize-unavailable",
      transaction: { to: VAULT, selector: "0x0773da0c", value: 0n },
      expected: { checkpointStatus: "INVALID", vaultState: "FINAL_INVALID" },
    });
  });

  it("never requests fallback over visible evidence and uses it for unavailable sources", async () => {
    const beforeHard = baseState();
    beforeHard.rounds.delete(roundId(1, 102n));
    beforeHard.blocks.set(
      1_000n,
      block(1_000n, beforeHard.hardResolutionDeadline - 1n),
    );
    const beforeDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(beforeHard),
      binding: binding(),
      account: SENDER,
    });
    expect(beforeDecision).toMatchObject({
      decision: "wait",
      reason: "soft-unavailable-not-proven",
    });

    const atHard = baseState();
    atHard.rounds.delete(roundId(1, 102n));
    atHard.blocks.set(1_000n, block(1_000n, atHard.hardResolutionDeadline));
    const visibleDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(atHard),
      binding: binding(),
      account: SENDER,
    });
    expect(visibleDecision).toMatchObject({
      decision: "wait",
      reason: "hard-fallback-not-admissible",
    });
    expect(visibleDecision.providerRequests).toBeGreaterThan(0);

    const unavailable = baseState();
    unavailable.latestRoundId = roundId(1, 999n);
    unavailable.blocks.set(
      1_000n,
      block(1_000n, unavailable.hardResolutionDeadline),
    );
    const hardDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(unavailable),
      binding: binding(),
      account: SENDER,
    });
    expect(hardDecision).toMatchObject({
      decision: "action",
      action: "request-unproven-fallback",
      transaction: { to: VAULT, selector: "0x7a559160", value: 0n },
      expected: {
        checkpointStatus: "AWAITING",
        vaultState: "OPEN",
        fallbackChallengeDeadline:
          unavailable.hardResolutionDeadline + PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS,
      },
    });
  });

  it("keeps expiry exclusive, prefers recovered proof, and neutralizes only unavailable sources", async () => {
    const exactChallenge = baseState();
    exactChallenge.latestRoundId = roundId(1, 999n);
    exactChallenge.fallbackRequestedAt = exactChallenge.hardResolutionDeadline;
    exactChallenge.fallbackChallengeDeadline =
      exactChallenge.fallbackRequestedAt + PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS;
    exactChallenge.blocks.set(
      1_000n,
      block(1_000n, exactChallenge.fallbackChallengeDeadline),
    );
    const exactDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(exactChallenge),
      binding: binding(),
      account: SENDER,
    });
    expect(exactDecision).toMatchObject({
      decision: "wait",
      reason: "fallback-challenge-active",
    });
    expect(exactDecision.providerRequests).toBeGreaterThan(0);

    const recovered = baseState();
    recovered.fallbackRequestedAt = recovered.hardResolutionDeadline;
    recovered.fallbackChallengeDeadline =
      recovered.fallbackRequestedAt + PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS;
    recovered.blocks.set(
      1_000n,
      block(1_000n, recovered.fallbackChallengeDeadline + 1n),
    );
    const recoveredDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(recovered),
      binding: binding(),
      account: SENDER,
    });
    expect(recoveredDecision).toMatchObject({
      decision: "action",
      action: "finalize-with-proof",
      transaction: { selector: "0xa0345fca", value: 0n },
      expected: { checkpointStatus: "FINAL", vaultState: "FINAL_YES" },
    });

    const visibleSparse = baseState();
    visibleSparse.rounds.delete(roundId(1, 102n));
    visibleSparse.fallbackRequestedAt = visibleSparse.hardResolutionDeadline;
    visibleSparse.fallbackChallengeDeadline =
      visibleSparse.fallbackRequestedAt + PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS;
    visibleSparse.blocks.set(
      1_000n,
      block(1_000n, visibleSparse.fallbackChallengeDeadline + 1n),
    );
    const visibleDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(visibleSparse),
      binding: binding(),
      account: SENDER,
    });
    expect(visibleDecision).toMatchObject({
      decision: "wait",
      reason: "unproven-terminalization-not-admissible",
    });

    const elapsed = baseState();
    elapsed.latestRoundId = roundId(1, 999n);
    elapsed.fallbackRequestedAt = elapsed.hardResolutionDeadline;
    elapsed.fallbackChallengeDeadline =
      elapsed.fallbackRequestedAt + PREDICTION_V2_FALLBACK_CHALLENGE_SECONDS;
    elapsed.blocks.set(
      1_000n,
      block(1_000n, elapsed.fallbackChallengeDeadline + 1n),
    );
    const elapsedDecision = await decidePredictionV2ResolutionAction({
      quorum: quorum(elapsed),
      binding: binding(),
      account: SENDER,
    });
    expect(elapsedDecision).toMatchObject({
      decision: "action",
      action: "finalize-unproven",
      transaction: { to: VAULT, selector: "0x3b38b139", value: 0n },
      expected: { checkpointStatus: "INVALID", vaultState: "FINAL_INVALID" },
    });
  });

  it("returns an explicit no-action for terminal Vaults", async () => {
    const state = baseState();
    state.vaultState = 1n;
    state.checkpointStatus = 1n;
    const decision = await decidePredictionV2ResolutionAction({
      quorum: quorum(state),
      binding: binding(),
      account: SENDER,
    });
    expect(decision).toMatchObject({
      decision: "no-action",
      reason: "vault-terminal",
      snapshot: { vaultState: "FINAL_YES" },
    });
    expect(decision.providerRequests).toBeGreaterThan(0);
  });

  it("fails closed on runtime drift, reader disagreement, and malformed lifecycle deadlines", async () => {
    const unbranded = baseState();
    await expect(decidePredictionV2ResolutionActionFromPublicRelease({
      readers: Object.freeze([
        reader("unbranded-primary", unbranded),
        reader("unbranded-secondary", unbranded),
      ]) as Parameters<
        typeof decidePredictionV2ResolutionActionFromPublicRelease
      >[0]["readers"],
      budget: {} as Parameters<
        typeof decidePredictionV2ResolutionActionFromPublicRelease
      >[0]["budget"],
      economicKey: ECONOMIC_KEY,
      marketId: MARKET_ID,
      account: SENDER,
    })).rejects.toMatchObject({
      name: "PredictionV2ResolutionActionError",
      code: "binding-mismatch",
    });

    const wrongRuntime = baseState();
    wrongRuntime.codes.set(VAULT.toLowerCase(), "0x6005600555");
    await expect(
      decidePredictionV2ResolutionAction({
        quorum: quorum(wrongRuntime),
        binding: binding(),
        account: SENDER,
      }),
    ).rejects.toMatchObject({
      name: "PredictionV2ResolutionActionError",
      code: "binding-mismatch",
    });

    const disagreement = baseState();
    await expect(
      decidePredictionV2ResolutionAction({
        quorum: quorum(disagreement, disagreement, (request, response) => {
          if (request.to.toLowerCase() !== CHECKPOINT.toLowerCase()) return response;
          const decoded = decodeFunctionData({
            abi: PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
            data: request.data,
          });
          return decoded.functionName === "status"
            ? encodeResult(
                PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
                "status",
                1n,
              )
            : response;
        }),
        binding: binding(),
        account: SENDER,
      }),
    ).rejects.toMatchObject({
      name: "PredictionV2ResolutionActionError",
      code: "provider-disagreement",
    });

    const revertedGetter = baseState();
    const revertStatus: Parameters<typeof reader>[2] = (request, response) => {
      if (request.to.toLowerCase() !== CHECKPOINT.toLowerCase()) return response;
      const decoded = decodeFunctionData({
        abi: PREDICTION_V2_CHAINLINK_CHECKPOINT_PROOF_ABI,
        data: request.data,
      });
      return decoded.functionName === "status"
        ? { status: "reverted" as const, data: "0x09" as Hex }
        : response;
    };
    await expect(
      decidePredictionV2ResolutionAction({
        quorum: {
          primary: reader("revert-primary", revertedGetter, revertStatus),
          secondary: reader("revert-secondary", revertedGetter, revertStatus),
        },
        binding: binding(),
        account: SENDER,
      }),
    ).rejects.toMatchObject({
      name: "PredictionV2ResolutionActionError",
      code: "provider-failure",
    });

    const malformedDeadlines = baseState();
    malformedDeadlines.resolutionDeadline += 1n;
    await expect(
      decidePredictionV2ResolutionAction({
        quorum: quorum(malformedDeadlines),
        binding: binding(),
        account: SENDER,
      }),
    ).rejects.toMatchObject({
      name: "PredictionV2ResolutionActionError",
      code: "invalid-lifecycle",
    });

    const impossibleTerminal = baseState();
    impossibleTerminal.vaultState = 1n;
    await expect(
      decidePredictionV2ResolutionAction({
        quorum: quorum(impossibleTerminal),
        binding: binding(),
        account: SENDER,
      }),
    ).rejects.toMatchObject({
      name: "PredictionV2ResolutionActionError",
      code: "invalid-lifecycle",
    });
  });

  it("carries a near-maximum first proof attempt into the single race retry budget", async () => {
    const state = baseState();
    const maximumLocal = (1n << 64n) - 2n;
    let boundary = maximumLocal - 7n;
    state.phaseApproval = Object.freeze({
      ...state.phaseApproval,
      minimumEligibleLocalRoundId: 1n,
    });
    state.latestRoundId = roundId(1, maximumLocal);
    state.rounds.clear();
    state.roundFactory = (id) => {
      const phase = Number(id >> 64n);
      const local = id & ((1n << 64n) - 1n);
      if (phase !== 1 || local < 1n || local > maximumLocal) return undefined;
      return round(phase, local, local < boundary ? T : T + 1n);
    };
    const nextBlock = block(1_001n, T + 2_000n, "2");
    state.blocks.set(nextBlock.number, nextBlock);

    const counter = { value: 0 };
    let primarySafeReads = 0;
    let requestsAtRace = 0;
    const primary = countedReader(reader("race-primary", state), counter, () => {
      primarySafeReads += 1;
      if (primarySafeReads === 3) {
        requestsAtRace = counter.value;
        boundary -= 2n;
        state.safeBlockNumber = nextBlock.number;
      }
    });
    const secondary = countedReader(reader("race-secondary", state), counter);
    const decision = await decidePredictionV2ResolutionAction({
      quorum: { primary, secondary },
      binding: binding(),
      account: SENDER,
    });

    expect(decision).toMatchObject({
      decision: "action",
      action: "finalize-with-proof",
      snapshot: nextBlock,
    });
    expect(requestsAtRace).toBeGreaterThan(180);
    expect(decision.providerRequests).toBe(counter.value);
    expect(decision.providerRequests).toBeGreaterThan(requestsAtRace);
    expect(decision.providerRequests).toBeLessThanOrEqual(
      PREDICTION_V2_RESOLUTION_ACTION_MAX_INVOCATION_PROVIDER_REQUESTS,
    );
  });

  it("rejects a canonical-block race after successful simulation", async () => {
    const state = baseState();
    state.checkpointStatus = 1n;
    const makeReorgingReader = (readerId: string): PredictionV2ResolutionRpcReader => {
      const stable = reader(readerId, state);
      let blockReads = 0;
      return Object.freeze({
        ...stable,
        getBlock: async (number: bigint, signal?: AbortSignal) => {
          blockReads += 1;
          if (blockReads >= 3) return block(number, T + 1_000n, "9");
          return stable.getBlock(number, signal);
        },
      });
    };
    await expect(
      decidePredictionV2ResolutionAction({
        quorum: {
          primary: makeReorgingReader("reorg-primary"),
          secondary: makeReorgingReader("reorg-secondary"),
        },
        binding: binding(),
        account: SENDER,
      }),
    ).rejects.toMatchObject({
      name: "PredictionV2ResolutionActionError",
      code: "noncanonical-block",
    });
  });
});
