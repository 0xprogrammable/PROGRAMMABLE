import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  stringToHex,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";

import {
  PREDICTION_PRESET_ASSETS_V2,
  predictionOnchainAssetKeyV2,
  type PredictionBytes32V2,
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
import {
  predictionV2RegistrySnapshotHash,
} from "../lib/prediction-v2/codec";
import {
  PREDICTION_V2_DIRECTORY_MAX_PAGE_SIZE,
  PREDICTION_V2_DIRECTORY_MAX_PROVIDER_REQUESTS,
  PREDICTION_V2_EXECUTION_ROUTER_READ_ABI,
  PREDICTION_V2_FACTORY_CANONICAL_READ_ABI,
  PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
  PREDICTION_V2_TARGETED_MARKET_MAX_PROVIDER_REQUESTS,
  assertPredictionV2ReadMarketAtSnapshotProvenance,
  predictionV2PageIndices,
  readPredictionV2Directory,
  readPredictionV2MarketAtSnapshot,
  type PredictionV2ReadBinding,
  type PredictionV2ReadCall,
  type PredictionV2RpcReader,
  type PredictionV2SafeBlock,
} from "../lib/prediction-v2/read-model-v2.server";

const address = (suffix: number) =>
  getAddress(`0x${suffix.toString(16).padStart(40, "0")}`) as Address;
const bytes32 = (value: bigint | number) =>
  toHex(BigInt(value), { size: 32 }) as PredictionBytes32V2;

const FACTORY = address(1);
const REGISTRY = address(2);
const POOL_MANAGER = address(3);
const HOOK = address(4);
const COLLATERAL = address(5);
const ROUTER = address(6);
const VAULT = address(7);
const CHECKPOINT = address(8);
const YES_TOKEN = address(9);
const NO_TOKEN = address(10);
const CHECKPOINT_ADAPTER = address(11);
const FEED = address(12);
const AGGREGATOR = address(13);

const ECONOMIC_KEY = bytes32(101);
const OTHER_ECONOMIC_KEY = bytes32(102);
const POLICY_VALID_UNTIL = 5_000n;
const ASSET_CAP = 20_000_000n;
const THRESHOLD = 100_000_000n;
const OBSERVATION_TIME = 2_000n;
const BLOCK = Object.freeze({
  number: 100n,
  hash: bytes32(201),
  parentHash: bytes32(200),
  timestamp: 1_000n,
}) satisfies PredictionV2SafeBlock;

const binding = Object.freeze({
  factory: FACTORY,
  assetRegistry: REGISTRY,
  poolManager: POOL_MANAGER,
  hook: HOOK,
  collateral: COLLATERAL,
  router: ROUTER,
  deploymentBlock: 50n,
}) satisfies PredictionV2ReadBinding;

const policy = Object.freeze({
  checkpointKind: bytes32(301),
  checkpointAdapter: CHECKPOINT_ADAPTER,
  checkpointAdapterCodehash: bytes32(302),
  feedId: bytes32(0),
  feedAddress: FEED,
  feedProxyCodehash: bytes32(303),
  feedPhaseId: 1,
  feedAggregator: AGGREGATOR,
  feedAggregatorCodehash: bytes32(304),
  feedDescriptionHash: bytes32(305),
  feedDecimals: 8,
  quoteCurrency: stringToHex("USD", { size: 32 }) as PredictionBytes32V2,
  assetEvidenceHash: bytes32(306),
  maxOpenInterestAtoms: ASSET_CAP,
  validUntil: POLICY_VALID_UNTIL,
  policyVersion: 1,
  active: true,
}) satisfies PredictionV2OraclePolicy;

const snapshot = Object.freeze({
  assetKey: predictionOnchainAssetKeyV2(PREDICTION_PRESET_ASSETS_V2[0].identity),
  revision: 1n,
  identity: PREDICTION_PRESET_ASSETS_V2[0].identity,
  displaySymbol: "BTC",
  policy,
}) satisfies PredictionV2RegistrySnapshot;
const SNAPSHOT_HASH = predictionV2RegistrySnapshotHash(snapshot);
const MARKET_ID = predictionV2MarketId(ECONOMIC_KEY, SNAPSHOT_HASH);
const POLICY_HASH = policy.checkpointKind;
const poolKey = Object.freeze({
  currency0: YES_TOKEN,
  currency1: NO_TOKEN,
  fee: 200,
  tickSpacing: 10,
  hooks: HOOK,
}) satisfies PredictionV2PoolKey;
const POOL_ID = predictionV2PoolId(poolKey);
const SLOT0 = bytes32((200n << 208n) | (1n << 96n));
const PREDICTION_V2_FACTORY_TEST_ABI = [
  ...PREDICTION_V2_FACTORY_ABI,
  ...PREDICTION_V2_FACTORY_CANONICAL_READ_ABI,
] as const satisfies Abi;

type FixtureOverrides = Readonly<Record<string, unknown>>;

type FixtureCallProbe = {
  active: number;
  maximum: number;
  delayMs: number;
};

type FixtureOptions = Readonly<{
  readerId: string;
  block?: PredictionV2SafeBlock;
  chainId?: number;
  marketCount?: bigint;
  marketKeys?: readonly PredictionBytes32V2[];
  blockReads?: readonly (PredictionV2SafeBlock | null)[];
  overrides?: FixtureOverrides;
  callProbe?: FixtureCallProbe;
  deterministicRevert?: (request: PredictionV2ReadCall) => boolean;
}>;

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

function decodedCall(abi: Abi, data: Hex) {
  return decodeFunctionData({ abi, data }) as Readonly<{
    functionName: string;
    args?: readonly unknown[];
  }>;
}

class FixtureReader implements PredictionV2RpcReader {
  readonly readerId: string;
  readonly calls: PredictionV2ReadCall[] = [];
  providerRequests = 0;
  readonly #block: PredictionV2SafeBlock;
  readonly #chainId: number;
  readonly #marketCount: bigint;
  readonly #marketKeys: readonly PredictionBytes32V2[];
  readonly #blockReads: readonly (PredictionV2SafeBlock | null)[];
  readonly #overrides: FixtureOverrides;
  readonly #callProbe?: FixtureCallProbe;
  readonly #deterministicRevert?: (request: PredictionV2ReadCall) => boolean;
  #blockReadIndex = 0;

  constructor(options: FixtureOptions) {
    this.readerId = options.readerId;
    this.#block = options.block ?? BLOCK;
    this.#chainId = options.chainId ?? 4_663;
    this.#marketCount = options.marketCount ?? 1n;
    this.#marketKeys = options.marketKeys ?? [ECONOMIC_KEY];
    this.#blockReads = options.blockReads ?? [];
    this.#overrides = options.overrides ?? {};
    this.#callProbe = options.callProbe;
    this.#deterministicRevert = options.deterministicRevert;
  }

  async getChainId() {
    this.providerRequests += 1;
    return this.#chainId;
  }

  async getSafeBlock() {
    this.providerRequests += 1;
    return this.#block;
  }

  async getBlock(blockNumber: bigint) {
    this.providerRequests += 1;
    const configured = this.#blockReads[this.#blockReadIndex];
    this.#blockReadIndex += 1;
    if (configured !== undefined) return configured;
    return blockNumber === this.#block.number ? this.#block : null;
  }

  async call(request: PredictionV2ReadCall) {
    this.providerRequests += 1;
    this.calls.push(request);
    const callProbe = this.#callProbe;
    if (callProbe) {
      callProbe.active += 1;
      callProbe.maximum = Math.max(
        callProbe.maximum,
        callProbe.active,
      );
    }
    try {
      if (callProbe?.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, callProbe.delayMs));
      }
      if (this.#deterministicRevert?.(request)) {
        return Object.freeze({ status: "reverted" as const, data: "0xdeadbeef" as Hex });
      }
      if (request.to.toLowerCase() === FACTORY.toLowerCase()) {
        return this.#factory(request.data);
      }
      if (request.to.toLowerCase() === REGISTRY.toLowerCase()) {
        return this.#registry(request.data);
      }
      if (request.to.toLowerCase() === VAULT.toLowerCase()) {
        return this.#vault(request.data);
      }
      if (request.to.toLowerCase() === CHECKPOINT.toLowerCase()) {
        return this.#checkpoint(request.data);
      }
      if (request.to.toLowerCase() === HOOK.toLowerCase()) {
        return this.#hook(request.data);
      }
      if (request.to.toLowerCase() === ROUTER.toLowerCase()) {
        return this.#router(request.data);
      }
      if (request.to.toLowerCase() === POOL_MANAGER.toLowerCase()) {
        return this.#poolManager(request.data);
      }
      throw new Error("unexpected fixture target");
    } finally {
      if (callProbe) callProbe.active -= 1;
    }
  }

  #value(key: string, fallback: unknown) {
    return Object.hasOwn(this.#overrides, key) ? this.#overrides[key] : fallback;
  }

  #factory(data: Hex) {
    const call = decodedCall(PREDICTION_V2_FACTORY_TEST_ABI, data);
    switch (call.functionName) {
      case "assetRegistry":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, call.functionName,
          this.#value("factory.assetRegistry", REGISTRY));
      case "manager":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, call.functionName,
          this.#value("factory.manager", POOL_MANAGER));
      case "marketCount":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, call.functionName,
          this.#marketCount);
      case "marketKeyAt": {
        const index = Number(call.args?.[0]);
        const key = this.#marketKeys[index];
        if (!key) throw new Error("fixture market index is missing");
        return encodeResult(PREDICTION_V2_FACTORY_ABI, call.functionName, key);
      }
      case "markets":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, call.functionName, [
          this.#value("factory.vault", VAULT),
          this.#value("factory.checkpoint", CHECKPOINT),
          this.#value("factory.poolId", POOL_ID),
          this.#value("factory.marketId", MARKET_ID),
          this.#value("factory.assetKey", snapshot.assetKey),
          this.#value("factory.registrySnapshotHash", SNAPSHOT_HASH),
          this.#value("factory.resolutionPolicyHash", POLICY_HASH),
          this.#value("factory.registryRevision", snapshot.revision),
          this.#value("factory.policyValidUntil", POLICY_VALID_UNTIL),
          this.#value("factory.snapshotAssetCap", ASSET_CAP),
        ]);
      case "getPoolKey":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, call.functionName,
          this.#value("factory.poolKey", poolKey));
      case "economicEventKey":
        return encodeResult(PREDICTION_V2_FACTORY_ABI, call.functionName,
          this.#value("factory.derivedEconomicKey", ECONOMIC_KEY));
      case "isCanonicalVault":
        return encodeResult(
          PREDICTION_V2_FACTORY_CANONICAL_READ_ABI,
          call.functionName,
          this.#value("factory.isCanonicalVault", true),
        );
      default:
        throw new Error(`unexpected Factory call ${call.functionName}`);
    }
  }

  #registry(data: Hex) {
    const call = decodedCall(PREDICTION_V2_ASSET_REGISTRY_ABI, data);
    switch (call.functionName) {
      case "getSnapshot":
        return encodeResult(PREDICTION_V2_ASSET_REGISTRY_ABI, call.functionName,
          this.#value("registry.snapshot", snapshot));
      case "hashSnapshot":
        return encodeResult(PREDICTION_V2_ASSET_REGISTRY_ABI, call.functionName,
          this.#value("registry.hashSnapshot", SNAPSHOT_HASH));
      default:
        throw new Error(`unexpected Registry call ${call.functionName}`);
    }
  }

  #vault(data: Hex) {
    const call = decodedCall(PREDICTION_V2_VAULT_ABI, data);
    const values: Readonly<Record<string, unknown>> = {
      collateral: COLLATERAL,
      checkpoint: CHECKPOINT,
      factory: FACTORY,
      router: ROUTER,
      yesToken: YES_TOKEN,
      noToken: NO_TOKEN,
      cutoff: OBSERVATION_TIME - 60n,
      threshold: THRESHOLD,
      economicKey: ECONOMIC_KEY,
      marketId: MARKET_ID,
      assetKey: snapshot.assetKey,
      registryRevision: snapshot.revision,
      registrySnapshotHash: SNAPSHOT_HASH,
      oraclePolicyHash: POLICY_HASH,
      state: 0,
      accountedLiability: 2_000_000n,
      canonicalPoolId: POOL_ID,
    };
    if (!Object.hasOwn(values, call.functionName)) {
      throw new Error(`unexpected Vault call ${call.functionName}`);
    }
    return encodeResult(PREDICTION_V2_VAULT_ABI, call.functionName,
      this.#value(`vault.${call.functionName}`, values[call.functionName]));
  }

  #checkpoint(data: Hex) {
    const call = decodedCall(PREDICTION_V2_CHECKPOINT_ABI, data);
    const values: Readonly<Record<string, unknown>> = {
      status: 0,
      resolvedPrice: 0n,
      observationTime: Number(OBSERVATION_TIME),
      resolutionDeadline: 2_100,
      hardResolutionDeadline: 2_200,
      fallbackRequestedAt: 0,
      fallbackChallengeDeadline: 0,
      policyHash: POLICY_HASH,
      priceDecimals: 8,
      isTradingHealthy: true,
    };
    if (!Object.hasOwn(values, call.functionName)) {
      throw new Error(`unexpected Checkpoint call ${call.functionName}`);
    }
    return encodeResult(PREDICTION_V2_CHECKPOINT_ABI, call.functionName,
      this.#value(`checkpoint.${call.functionName}`, values[call.functionName]));
  }

  #hook(data: Hex) {
    const call = decodedCall(PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, data);
    switch (call.functionName) {
      case "factory":
        return encodeResult(PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, call.functionName,
          this.#value("hook.factory", FACTORY));
      case "authorizedRouter":
        return encodeResult(PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, call.functionName,
          this.#value("hook.authorizedRouter", ROUTER));
      case "poolManager":
        return encodeResult(PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, call.functionName,
          this.#value("hook.poolManager", POOL_MANAGER));
      case "lifecycle":
        return encodeResult(PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, call.functionName, [
          this.#value("hook.cutoff", OBSERVATION_TIME - 60n),
          this.#value("hook.registeredBlock", 75n),
          this.#value("hook.checkpoint", CHECKPOINT),
          this.#value("hook.initialized", true),
        ]);
      default:
        throw new Error(`unexpected LifecycleHook call ${call.functionName}`);
    }
  }

  #router(data: Hex) {
    const call = decodedCall(PREDICTION_V2_EXECUTION_ROUTER_READ_ABI, data);
    const values: Readonly<Record<string, unknown>> = {
      factory: FACTORY,
      manager: POOL_MANAGER,
      collateral: COLLATERAL,
    };
    if (!Object.hasOwn(values, call.functionName)) {
      throw new Error(`unexpected ExecutionRouter call ${call.functionName}`);
    }
    return encodeResult(
      PREDICTION_V2_EXECUTION_ROUTER_READ_ABI,
      call.functionName,
      this.#value(`router.${call.functionName}`, values[call.functionName]),
    );
  }

  #poolManager(data: Hex) {
    const call = decodedCall(PREDICTION_V2_POOL_MANAGER_STATE_ABI, data);
    if (call.functionName !== "extsload") throw new Error("unexpected PoolManager call");
    return encodeResult(PREDICTION_V2_POOL_MANAGER_STATE_ABI, call.functionName,
      this.#value("pool.slot0", SLOT0));
  }
}

function reader(input: Omit<FixtureOptions, "readerId"> = {}) {
  return new FixtureReader({ readerId: "settlement", ...input });
}

function deterministicMarketRevert(economicKey: PredictionBytes32V2) {
  return (request: PredictionV2ReadCall) => {
    if (request.to.toLowerCase() !== FACTORY.toLowerCase()) return false;
    const call = decodedCall(PREDICTION_V2_FACTORY_TEST_ABI, request.data);
    return call.functionName === "markets" && call.args?.[0] === economicKey;
  };
}

describe("Prediction V2 bounded Factory read model", () => {
  it("reads one economic key only at the exact operation-leased snapshot", async () => {
    const settlement = reader();
    const result = await readPredictionV2MarketAtSnapshot({
      reader: settlement,
      binding,
      economicKey: ECONOMIC_KEY,
      snapshot: BLOCK,
    });
    const { market } = result;

    expect(market).toMatchObject({
      economicKey: ECONOMIC_KEY,
      marketId: MARKET_ID,
      vault: VAULT,
      checkpoint: CHECKPOINT,
    });
    expect(() => assertPredictionV2ReadMarketAtSnapshotProvenance(
      market,
      result.snapshot,
      binding,
    )).not.toThrow();
    expect(() => assertPredictionV2ReadMarketAtSnapshotProvenance(
      market,
      { ...result.snapshot },
      binding,
    )).toThrow("not bound to this verified snapshot object");
    expect(() => assertPredictionV2ReadMarketAtSnapshotProvenance(
      market,
      { ...result.snapshot, hash: bytes32(998) },
      binding,
    )).toThrow("not bound to this verified snapshot object");
    expect(() => assertPredictionV2ReadMarketAtSnapshotProvenance(
      market,
      result.snapshot,
      { ...binding, factory: address(998) },
    )).toThrow("not bound to this signed release read graph");
    expect(() => assertPredictionV2ReadMarketAtSnapshotProvenance(
      { ...market },
      result.snapshot,
      binding,
    ))
      .toThrow("lacks verified read-model provenance");
    expect(() => assertPredictionV2ReadMarketAtSnapshotProvenance(
      JSON.parse(JSON.stringify({ economicKey: market.economicKey })),
      result.snapshot,
      binding,
    )).toThrow("lacks verified read-model provenance");
    expect(settlement.calls.every(({ blockNumber }) => blockNumber === BLOCK.number))
      .toBe(true);
    expect(settlement.calls.every(({ blockHash }) => blockHash === BLOCK.hash))
      .toBe(true);
    expect(settlement.calls.some(({ to, data }) =>
      to.toLowerCase() === FACTORY.toLowerCase() &&
      decodedCall(PREDICTION_V2_FACTORY_TEST_ABI, data).functionName ===
        "marketKeyAt"
    )).toBe(false);
    expect(settlement.providerRequests).toBe(
      PREDICTION_V2_TARGETED_MARKET_MAX_PROVIDER_REQUESTS,
    );
  });

  it("rejects wrong or missing economic keys and a reader leased to another snapshot", async () => {
    await expect(readPredictionV2MarketAtSnapshot({
      reader: reader(),
      binding,
      economicKey: OTHER_ECONOMIC_KEY,
      snapshot: BLOCK,
    })).rejects.toThrow("missing or not canonically wired");

    const missing = deterministicMarketRevert(OTHER_ECONOMIC_KEY);
    await expect(readPredictionV2MarketAtSnapshot({
      reader: reader({ deterministicRevert: missing }),
      binding,
      economicKey: OTHER_ECONOMIC_KEY,
      snapshot: BLOCK,
    })).rejects.toThrow("missing or not canonically wired");

    const otherBlock = Object.freeze({
      ...BLOCK,
      hash: bytes32(991),
      parentHash: bytes32(990),
    });
    await expect(readPredictionV2MarketAtSnapshot({
      reader: reader({ block: otherBlock }),
      binding,
      economicKey: ECONOMIC_KEY,
      snapshot: BLOCK,
    })).rejects.toThrow("not leased to the requested exact snapshot");
  });

  it("reads one fully cross-bound market at one exact safe block", async () => {
    const settlement = reader();
    const result = await readPredictionV2Directory({
      reader: settlement,
      binding,
      limit: PREDICTION_V2_DIRECTORY_MAX_PAGE_SIZE,
    });

    expect(result).toMatchObject({
      schemaVersion: 2,
      chainId: 4_663,
      snapshot: BLOCK,
      marketCount: 1n,
      quarantined: [],
      nextCursor: null,
      markets: [{
        economicKey: ECONOMIC_KEY,
        marketId: MARKET_ID,
        assetKey: snapshot.assetKey,
        vault: VAULT,
        checkpoint: CHECKPOINT,
        yesToken: YES_TOKEN,
        noToken: NO_TOKEN,
        poolId: POOL_ID,
        asset: { displaySymbol: "BTC", identity: snapshot.identity },
        predicate: {
          comparator: "greater-than-or-equal",
          threshold: THRESHOLD,
          observationTime: OBSERVATION_TIME,
          priceDecimals: 8,
        },
        lifecycle: {
          protocolState: "OPEN",
          checkpointStatus: "AWAITING",
          tradingPhase: "OPEN",
          tradable: true,
          tradabilityReason: "tradable",
        },
        poolState: {
          sqrtPriceX96: 1n << 96n,
          tick: 0,
          lpFee: 200,
          yesProbabilityBps: 5_000,
        },
      }],
    });
    expect(() => assertPredictionV2ReadMarketAtSnapshotProvenance(
      result.markets[0],
      result.snapshot,
      binding,
    )).not.toThrow();
    expect(settlement.calls.length).toBeGreaterThan(25);
    expect(settlement.calls.every(({ blockNumber }) => blockNumber === BLOCK.number))
      .toBe(true);
    expect(settlement.calls.every(({ blockHash }) => blockHash === BLOCK.hash))
      .toBe(true);
    expect(settlement.calls.every(({ requireCanonical }) => requireCanonical))
      .toBe(true);
    const hookLifecycleCall = settlement.calls.find(({ to, data }) =>
        to.toLowerCase() === HOOK.toLowerCase() &&
        decodedCall(PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI, data).functionName === "lifecycle"
    );
    expect(hookLifecycleCall).toBeDefined();
    expect(decodedCall(
      PREDICTION_V2_LIFECYCLE_HOOK_READ_ABI,
      hookLifecycleCall!.data,
    ).args).toEqual([POOL_ID]);
    const canonicalVaultCall = settlement.calls.find(({ to, data }) =>
        to.toLowerCase() === FACTORY.toLowerCase() &&
        decodedCall(PREDICTION_V2_FACTORY_TEST_ABI, data).functionName ===
          "isCanonicalVault"
    );
    expect(canonicalVaultCall).toBeDefined();
    expect(decodedCall(
      PREDICTION_V2_FACTORY_TEST_ABI,
      canonicalVaultCall!.data,
    ).args).toEqual([VAULT, POOL_ID]);
  });

  it("bounds newest-first pagination to 1..8 and emits a snapshot-bound cursor", async () => {
    expect(predictionV2PageIndices({ marketCount: 27n, limit: 3 })).toEqual({
      indices: [26n, 25n, 24n],
      nextExclusiveIndex: 24n,
    });
    expect(() => predictionV2PageIndices({ marketCount: 1n, limit: 0 }))
      .toThrow("between 1 and 8");
    expect(() => predictionV2PageIndices({ marketCount: 9n, limit: 9 }))
      .toThrow("between 1 and 8");

    const settlement = reader({
      marketCount: 2n,
      marketKeys: [OTHER_ECONOMIC_KEY, ECONOMIC_KEY],
    });
    const result = await readPredictionV2Directory({
      reader: settlement,
      binding,
      limit: 1,
    });
    expect(result.markets.map(({ economicKey }) => economicKey)).toEqual([ECONOMIC_KEY]);
    expect(result.nextCursor).toEqual({
      schemaVersion: 2,
      blockNumber: BLOCK.number,
      blockHash: BLOCK.hash,
      marketCount: 2n,
      nextExclusiveIndex: 1n,
    });
  });

  it("keeps the exact directory provider budget synchronized with every read branch", async () => {
    const settlement = reader();
    const result = await readPredictionV2Directory({
      reader: settlement,
      binding,
      limit: PREDICTION_V2_DIRECTORY_MAX_PAGE_SIZE,
      cursor: {
        schemaVersion: 2,
        blockNumber: BLOCK.number,
        blockHash: BLOCK.hash,
        marketCount: 1n,
        nextExclusiveIndex: 1n,
      },
    });

    expect(result.markets).toHaveLength(1);
    // 13 fixed cursor-path requests plus 36 for one fully verified market.
    expect(settlement.providerRequests).toBe(49);
    expect(PREDICTION_V2_DIRECTORY_MAX_PROVIDER_REQUESTS).toBe(
      13 + 36 * PREDICTION_V2_DIRECTORY_MAX_PAGE_SIZE,
    );
    expect(settlement.providerRequests).toBeLessThanOrEqual(
      PREDICTION_V2_DIRECTORY_MAX_PROVIDER_REQUESTS,
    );
  });

  it("rejects a settlement RPC serving the wrong chain", async () => {
    await expect(readPredictionV2Directory({
      reader: reader({ chainId: 1 }),
      binding,
    })).rejects.toThrow("not serving Robinhood Chain");
  });

  it("rejects a mid-read reorg after all hash-bound calls and before returning", async () => {
    const replacedBlock = Object.freeze({
      ...BLOCK,
      hash: bytes32(901),
      parentHash: bytes32(900),
    });
    const settlement = reader({ blockReads: [replacedBlock] });

    await expect(readPredictionV2Directory({ reader: settlement, binding }))
      .rejects.toThrow("snapshot block changed during read");
    expect(settlement.calls.length).toBeGreaterThan(25);
    expect(settlement.calls.every(({ blockHash }) => blockHash === BLOCK.hash))
      .toBe(true);
  });

  it.each([
    ["Hook Factory", { "hook.factory": address(91) }],
    ["Hook authorized Router", { "hook.authorizedRouter": address(92) }],
    ["Hook PoolManager", { "hook.poolManager": address(96) }],
    ["Router Factory", { "router.factory": address(93) }],
    ["Router PoolManager", { "router.manager": address(94) }],
    ["Router collateral", { "router.collateral": address(95) }],
  ])("rejects invalid global %s wiring", async (_label, overrides) => {
    await expect(readPredictionV2Directory({
      reader: reader({ overrides }),
      binding,
    })).rejects.toThrow("release endpoints do not match");
  });

  it("quarantines one deterministic revert without hiding a healthy market", async () => {
    const revert = deterministicMarketRevert(OTHER_ECONOMIC_KEY);
    const options = {
      marketCount: 2n,
      marketKeys: [OTHER_ECONOMIC_KEY, ECONOMIC_KEY],
      deterministicRevert: revert,
    } as const;
    const result = await readPredictionV2Directory({
      reader: reader(options),
      binding,
      limit: 2,
    });

    expect(result.markets.map(({ economicKey }) => economicKey)).toEqual([ECONOMIC_KEY]);
    expect(result.quarantined).toEqual([{
      index: 0n,
      economicKey: OTHER_ECONOMIC_KEY,
      code: "invalid-market-wiring",
    }]);
  });

  it("caps provider concurrency across batched market reads", async () => {
    const probe: FixtureCallProbe = { active: 0, maximum: 0, delayMs: 2 };
    const marketKeys = [
      bytes32(110),
      bytes32(111),
      bytes32(112),
      ECONOMIC_KEY,
    ];
    const options = { marketCount: 4n, marketKeys, callProbe: probe } as const;
    await readPredictionV2Directory({
      reader: reader(options),
      binding,
      limit: 4,
    });

    expect(probe.maximum).toBeGreaterThan(2);
    expect(probe.maximum).toBeLessThanOrEqual(8);
    expect(probe.active).toBe(0);
  });

  it("rejects a replaced snapshot cursor before reading Factory state", async () => {
    const settlement = reader();
    await expect(readPredictionV2Directory({
      reader: settlement,
      binding,
      cursor: {
        schemaVersion: 2,
        blockNumber: BLOCK.number,
        blockHash: bytes32(999),
        marketCount: 2n,
        nextExclusiveIndex: 1n,
      },
    })).rejects.toThrow("cursor block was replaced");
    expect(settlement.calls).toHaveLength(0);
  });

  it("rejects hidden cursor fields instead of accepting an extended cursor", async () => {
    const cursor = {
      schemaVersion: 2 as const,
      blockNumber: BLOCK.number,
      blockHash: BLOCK.hash,
      marketCount: 2n,
      nextExclusiveIndex: 1n,
    };
    Object.defineProperty(cursor, "providerOverride", { value: "untrusted" });
    await expect(readPredictionV2Directory({
      reader: reader(),
      binding,
      cursor,
    })).rejects.toThrow("cursor is invalid");
  });

  it.each([
    ["Factory/Vault identity", { "vault.economicKey": bytes32(800) }],
    ["locally derived market id", {
      "factory.marketId": bytes32(803),
      "vault.marketId": bytes32(803),
    }],
    ["Registry snapshot", { "factory.registrySnapshotHash": bytes32(801) }],
    ["Checkpoint policy", { "checkpoint.policyHash": bytes32(802) }],
    ["terminal checkpoint health", {
      "checkpoint.status": 1,
      "checkpoint.isTradingHealthy": true,
    }],
    ["60-second cutoff", { "vault.cutoff": OBSERVATION_TIME }],
    ["Pool binding", {
      "factory.poolKey": { ...poolKey, hooks: address(99) },
    }],
    ["LifecycleHook cutoff", { "hook.cutoff": OBSERVATION_TIME - 59n }],
    ["LifecycleHook checkpoint", { "hook.checkpoint": address(98) }],
    ["LifecycleHook initialization", { "hook.initialized": false }],
    ["LifecycleHook registration block", { "hook.registeredBlock": 49n }],
    ["Factory canonical Vault mapping", { "factory.isCanonicalVault": false }],
  ])("quarantines one market with invalid %s wiring", async (_label, overrides) => {
    const result = await readPredictionV2Directory({
      reader: reader({ overrides }),
      binding,
    });
    expect(result.markets).toEqual([]);
    expect(result.quarantined).toEqual([{
      index: 0n,
      economicKey: ECONOMIC_KEY,
      code: "invalid-market-wiring",
    }]);
  });

  it.each([
    [
      "closed pending resolution",
      { state: 0, status: 0, price: 0n, healthy: true },
      { protocolState: "OPEN", tradingPhase: "CLOSED", tradabilityReason: "cutoff-reached" },
    ],
    [
      "paused before cutoff",
      { state: 0, status: 0, price: 0n, healthy: false },
      { protocolState: "OPEN", tradingPhase: "OPEN", tradabilityReason: "checkpoint-unhealthy" },
    ],
    [
      "final YES",
      { state: 1, status: 1, price: THRESHOLD, healthy: false },
      { protocolState: "FINAL_YES", tradingPhase: "FINAL", tradabilityReason: "market-final" },
    ],
    [
      "final NO",
      { state: 2, status: 1, price: THRESHOLD - 1n, healthy: false },
      { protocolState: "FINAL_NO", tradingPhase: "FINAL", tradabilityReason: "market-final" },
    ],
    [
      "final invalid",
      { state: 3, status: 2, price: 0n, healthy: false },
      { protocolState: "FINAL_INVALID", tradingPhase: "FINAL", tradabilityReason: "market-final" },
    ],
    [
      "final invalid from a nonpositive terminal price",
      { state: 3, status: 1, price: 0n, healthy: false },
      { protocolState: "FINAL_INVALID", tradingPhase: "FINAL", tradabilityReason: "market-final" },
    ],
    [
      "terminal checkpoint awaiting Vault consumption",
      { state: 0, status: 1, price: THRESHOLD, healthy: false },
      { protocolState: "OPEN", tradingPhase: "CLOSED", tradabilityReason: "cutoff-reached" },
    ],
  ])("derives %s only from verified chain time and lifecycle reads", async (
    label,
    fixture,
    expected,
  ) => {
    const afterCutoff = label === "paused before cutoff"
      ? BLOCK
      : { ...BLOCK, timestamp: OBSERVATION_TIME + 1n };
    const overrides = {
      "vault.state": fixture.state,
      "checkpoint.status": fixture.status,
      "checkpoint.resolvedPrice": fixture.price,
      "checkpoint.isTradingHealthy": fixture.healthy,
    };
    const result = await readPredictionV2Directory({
      reader: reader({ block: afterCutoff, overrides }),
      binding,
    });
    expect(result.markets[0]?.lifecycle).toMatchObject({
      ...expected,
      tradable: false,
    });
  });

  it.each([
    [
      "a terminal checkpoint before observation",
      { state: 0, status: 1, price: THRESHOLD, healthy: false },
      BLOCK.timestamp,
    ],
    [
      "a nonzero AWAITING price",
      { state: 0, status: 0, price: 1n, healthy: true },
      OBSERVATION_TIME + 1n,
    ],
    [
      "a nonzero INVALID price",
      { state: 0, status: 2, price: 1n, healthy: false },
      OBSERVATION_TIME + 1n,
    ],
    [
      "a finalized Vault with an AWAITING checkpoint",
      { state: 3, status: 0, price: 0n, healthy: false },
      OBSERVATION_TIME + 1n,
    ],
  ])("quarantines %s", async (_label, fixture, timestamp) => {
    const overrides = {
      "vault.state": fixture.state,
      "checkpoint.status": fixture.status,
      "checkpoint.resolvedPrice": fixture.price,
      "checkpoint.isTradingHealthy": fixture.healthy,
    };
    const block = { ...BLOCK, timestamp };
    const result = await readPredictionV2Directory({
      reader: reader({ block, overrides }),
      binding,
    });
    expect(result.markets).toEqual([]);
    expect(result.quarantined).toHaveLength(1);
  });

  it("uses the historical Registry revision and fails closed on cursor count drift", async () => {
    const settlement = reader();
    await readPredictionV2Directory({ reader: settlement, binding });
    const registryCall = settlement.calls.find(({ to, data }) => {
      if (to.toLowerCase() !== REGISTRY.toLowerCase()) return false;
      return decodedCall(PREDICTION_V2_ASSET_REGISTRY_ABI, data).functionName ===
        "getSnapshot";
    });
    expect(registryCall).toBeDefined();
    expect(decodedCall(PREDICTION_V2_ASSET_REGISTRY_ABI, registryCall!.data).args)
      .toEqual([snapshot.assetKey, snapshot.revision]);

    await expect(readPredictionV2Directory({
      reader: settlement,
      binding,
      cursor: {
        schemaVersion: 2,
        blockNumber: BLOCK.number,
        blockHash: BLOCK.hash,
        marketCount: 2n,
        nextExclusiveIndex: 1n,
      },
    })).rejects.toThrow("cursor market count changed");
  });
});
