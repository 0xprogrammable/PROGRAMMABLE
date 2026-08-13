import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type AbiEvent,
  type Hex,
} from "viem";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  CandidateRpcLog,
  CandidateRpcProvider,
} from "../../lib/data-pipeline/dual-rpc";
import { PROGRAMMABLE_EVENT_SIGNATURES } from "../../lib/data-pipeline/event-manifest";
import {
  attachOptimisticMarketStates,
  computeOptimisticMarketStateCommitments,
  configuredOptimisticMarketReadPlans,
  createOptimisticLiveReader,
  createOptimisticLiveWriter,
  OPTIMISTIC_MAINNET_STATE_VIEW,
  OPTIMISTIC_MAINNET_STATE_VIEW_RUNTIME_CODE_HASH,
  OPTIMISTIC_MARKET_STATE_VERSION,
  optimisticOverlayRowsFromSnapshot,
  verifyOptimisticBlockForPersistence,
  type OptimisticLiveSnapshot,
  type OptimisticMarketStateEvidence,
  type OptimisticPersistenceBundle,
  type OptimisticProviderDeploymentBinding,
} from "../../lib/data-pipeline/optimistic-live-runtime.server";
import type {
  PostgresExecutor,
  PostgresParameter,
} from "../../lib/data-pipeline/postgres";
import { getDataPipelineReleaseBinding } from "../../lib/data-pipeline/release-binding.server";
import type { LauncherToken } from "../../lib/tokens";

const BLOCK_NUMBER = 25_650_000n;
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const PARENT_HASH = `0x${"22".repeat(32)}` as const;
const TRANSACTION_HASH = `0x${"33".repeat(32)}` as const;
const POOL_ID = `0x${"44".repeat(32)}` as const;
const LAUNCH_HASH = `0x${"55".repeat(32)}` as const;
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const CREATOR = "0x2222222222222222222222222222222222222222" as const;
const POSITION_RECIPIENT = "0x3333333333333333333333333333333333333333" as const;
const BINDING = getDataPipelineReleaseBinding();
const LAUNCHER = BINDING.sources.find(
  ({ contractName }) => contractName === "ClassicV2Launcher",
)!;
const HOOK = BINDING.sources.find(
  ({ contractName }) => contractName === "ClassicV2Hook",
)!;

const PROVIDER_DEPLOYMENTS = Object.freeze([
  Object.freeze({
    providerDeploymentId: "11111111-1111-5111-8111-111111111111",
    providerIdentity: "drpc-mainnet",
    endpointCommitment: `0x${"a".repeat(64)}`,
    originCommitment: `0x${"c".repeat(64)}`,
  }),
  Object.freeze({
    providerDeploymentId: "22222222-2222-5222-8222-222222222222",
    providerIdentity: "quicknode-mainnet",
    endpointCommitment: `0x${"b".repeat(64)}`,
    originCommitment: `0x${"d".repeat(64)}`,
  }),
]) as readonly [
  OptimisticProviderDeploymentBinding,
  OptimisticProviderDeploymentBinding,
];

function eventAbi(contractName: keyof typeof PROGRAMMABLE_EVENT_SIGNATURES, eventName: string) {
  const signature = PROGRAMMABLE_EVENT_SIGNATURES[contractName].find(
    (candidate) => candidate.startsWith(`${eventName}(`),
  );
  if (!signature) throw new TypeError("test event is not in manifest");
  const item = parseAbiItem(`event ${signature}`);
  if (item.type !== "event") throw new TypeError("test ABI is not an event");
  return item;
}

function eventLog(input: Readonly<{
  contractName: keyof typeof PROGRAMMABLE_EVENT_SIGNATURES;
  eventName: string;
  args: Record<string, unknown>;
  logIndex: number;
}>): CandidateRpcLog {
  const event = eventAbi(input.contractName, input.eventName);
  const nonIndexed = event.inputs.filter(
    (parameter) => !("indexed" in parameter && parameter.indexed === true),
  );
  return {
    address: BINDING.sources.find(
      ({ contractName }) => contractName === input.contractName,
    )!.address,
    blockNumber: BLOCK_NUMBER,
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 2,
    logIndex: input.logIndex,
    removed: false,
    topics: encodeEventTopics({
      abi: [event] as readonly [AbiEvent],
      eventName: event.name,
      args: input.args,
    }) as readonly Hex[],
    data: encodeAbiParameters(
      nonIndexed,
      nonIndexed.map(({ name }) => input.args[name!]),
    ),
  };
}

function completeClassicLaunchLogs(): readonly CandidateRpcLog[] {
  return [
    eventLog({
      contractName: "ClassicV2Hook",
      eventName: "PoolRegistered",
      logIndex: 1,
      args: {
        poolId: POOL_ID,
        token: TOKEN,
        creator: CREATOR,
        registrar: LAUNCHER.address,
        totalSwapFeeBps: 100,
      },
    }),
    eventLog({
      contractName: "ClassicV2Hook",
      eventName: "PoolFeeDisclosure",
      logIndex: 2,
      args: {
        poolId: POOL_ID,
        token: TOKEN,
        buySwapFeeBps: 100,
        sellSwapFeeBps: 100,
        launcherFeeBps: 10,
        transferTaxBps: 0,
        lpFeePips: 0,
      },
    }),
    eventLog({
      contractName: "ClassicV2Launcher",
      eventName: "MemeTokenLaunched",
      logIndex: 3,
      args: {
        creator: CREATOR,
        token: TOKEN,
        poolId: POOL_ID,
        feeHook: HOOK.address,
        positionRecipient: POSITION_RECIPIENT,
        positionTokenId: 7n,
        totalSwapFeeBps: 100,
        launchHash: LAUNCH_HASH,
      },
    }),
    eventLog({
      contractName: "ClassicV2Launcher",
      eventName: "MemeLiquidityConfigured",
      logIndex: 4,
      args: {
        token: TOKEN,
        totalSupply: 1_000_000_000_000_000_000_000_000n,
        tokenLiquidityAmount: 999_999_999_999_999_999_999_999n,
        lockedTokenDust: 1n,
        initialTick: 0,
        tickLower: -887_200,
        tickUpper: 887_200,
        lpFeePips: 0,
        launchHash: LAUNCH_HASH,
      },
    }),
    eventLog({
      contractName: "ClassicV2Launcher",
      eventName: "MemeCreatorInitialBuy",
      logIndex: 5,
      args: {
        creator: CREATOR,
        token: TOKEN,
        poolId: POOL_ID,
        nativeAmount: 1_000_000_000_000_000n,
        tokenAmount: 1_000_000_000_000_000_000n,
        launchHash: LAUNCH_HASH,
      },
    }),
  ];
}

function feeAccrualLog(): CandidateRpcLog {
  return eventLog({
    contractName: "ClassicV2Hook",
    eventName: "NativeSwapFeesAccrued",
    logIndex: 9,
    args: {
      poolId: POOL_ID,
      swapSender: CREATOR,
      grossNativeAmount: 10_000n,
      creatorFee: 90n,
      launcherFee: 10n,
    },
  });
}

function provider(
  vendor: "drpc" | "quicknode",
  logs: readonly CandidateRpcLog[],
  head = BLOCK_NUMBER,
): CandidateRpcProvider {
  const deployment = PROVIDER_DEPLOYMENTS[vendor === "drpc" ? 0 : 1];
  return {
    identity: deployment.providerIdentity,
    vendorGroup: vendor,
    endpointCommitment: deployment.endpointCommitment,
    endpointOriginCommitment: deployment.originCommitment,
    client: {
      getChainId: vi.fn(async () => 1),
      getBlockNumber: vi.fn(async () => head),
      getBlock: vi.fn(async () => ({
        number: BLOCK_NUMBER,
        hash: BLOCK_HASH,
        parentHash: PARENT_HASH,
        timestamp: 1_722_687_488n,
      })),
      getBlocks: vi.fn(async ({ blockNumbers }: { blockNumbers: readonly bigint[] }) => blockNumbers.map((number) => ({
        number,
        hash: number === BLOCK_NUMBER
          ? BLOCK_HASH
          : (`0x${"a".repeat(64)}` as const),
        parentHash: PARENT_HASH,
        timestamp: 1_722_687_488n,
      }))),
      getLogs: vi.fn(async () => logs),
      readErc20Metadata: vi.fn(async () => ({
        name: "Programmable Test",
        symbol: "PRG",
      })),
      getTransactionReceipt: vi.fn(async () => {
        throw new Error("unused");
      }),
      getBytecode: vi.fn(async () => "0x" as const),
    },
  };
}

async function verifiedBundle(
  logs: readonly CandidateRpcLog[] = completeClassicLaunchLogs(),
  head = BLOCK_NUMBER,
): Promise<OptimisticPersistenceBundle> {
  const providers = [
    provider("drpc", logs, head),
    provider("quicknode", logs, head),
  ] as const;
  return verifyOptimisticBlockForPersistence({
    providers,
    providerDeployments: PROVIDER_DEPLOYMENTS,
    hint: {
      chainId: 1,
      blockNumber: BLOCK_NUMBER.toString(),
      streamId: "programmable-mainnet-head",
      reorgedBlockNumbers: [],
    },
    observedAt: "2026-08-02T10:00:00.000Z",
  });
}

async function metadataRetryBundle(): Promise<OptimisticPersistenceBundle> {
  const logs = completeClassicLaunchLogs();
  const providers = [
    provider("drpc", logs),
    provider("quicknode", logs),
  ] as const;
  for (const { client } of providers) {
    vi.mocked(client.readErc20Metadata!)
      .mockRejectedValueOnce(new Error("429"))
      .mockResolvedValue({
        name: "Programmable Test",
        symbol: "PRG",
      });
  }
  return verifyOptimisticBlockForPersistence({
    providers,
    providerDeployments: PROVIDER_DEPLOYMENTS,
    hint: {
      chainId: 1,
      blockNumber: BLOCK_NUMBER.toString(),
      streamId: "programmable-mainnet-head",
      reorgedBlockNumbers: [],
    },
    observedAt: "2026-08-02T10:00:00.000Z",
  });
}

function snapshotFromBundle(bundle: OptimisticPersistenceBundle): OptimisticLiveSnapshot {
  return Object.freeze({
    head: Object.freeze({
      optimisticBlockId: bundle.optimisticBlockId,
      chainId: 1,
      blockNumber: bundle.blockNumber,
      blockHash: bundle.blockHash,
      parentHash: bundle.parentHash,
      blockTimestamp: bundle.blockTimestamp,
      providerDeploymentIds: bundle.providerDeploymentIds,
      providerHeads: bundle.providerHeads,
      reorgGeneration: "0",
      observedAt: bundle.observedAt,
      canonicalAt: bundle.observedAt,
    }),
    blocks: Object.freeze([
      Object.freeze({
        optimisticBlockId: bundle.optimisticBlockId,
        chainId: 1 as const,
        blockNumber: bundle.blockNumber,
        blockHash: bundle.blockHash,
        parentHash: bundle.parentHash,
        reorgGeneration: "0",
      }),
    ]),
    events: Object.freeze(bundle.events.map((event) => Object.freeze({
      optimisticEventId: event.optimisticEventId,
      optimisticBlockId: event.optimisticBlockId,
      chainId: 1 as const,
      blockNumber: bundle.blockNumber,
      blockHash: bundle.blockHash,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      blockGlobalLogIndex: event.blockGlobalLogIndex,
      sourceAddress: event.sourceAddress,
      eventSignature: event.eventSignature,
      orderedTopics: event.orderedTopics,
      rawData: event.rawData,
      normalizedPayload: event.normalizedPayload,
      payloadCommitment: event.payloadCommitment,
      reorgGeneration: "0",
      observedAt: bundle.observedAt,
    }))),
    marketStates: Object.freeze(bundle.marketStates.map((state) =>
      Object.freeze({ ...state, reorgGeneration: "0" }))),
  });
}

function marketStateEvidence(
  bundle: OptimisticPersistenceBundle,
  providerHeads: readonly [string, string] = bundle.providerHeads,
): OptimisticMarketStateEvidence {
  const lowestHead = BigInt(providerHeads[0]) < BigInt(providerHeads[1])
    ? BigInt(providerHeads[0])
    : BigInt(providerHeads[1]);
  const pool = Object.freeze({
    sqrtPriceX96: (1n << 96n).toString(),
    currentTick: 25,
    activeLiquidity: "1000000",
    protocolFeePips: 0,
    lpFeePips: 0,
    slot0Result: encodeAbiParameters(
      [
        { type: "uint160" },
        { type: "int24" },
        { type: "uint24" },
        { type: "uint24" },
      ],
      [1n << 96n, 25, 0, 0],
    ),
    liquidityResult: encodeAbiParameters(
      [{ type: "uint128" }],
      [1_000_000n],
    ),
  });
  const market = Object.freeze({
    indexedValuationBlockNumber: bundle.blockNumber,
    currentTick: 25,
    activeLiquidity: "1000000",
  });
  const confirmations = Number(lowestHead - BigInt(bundle.blockNumber));
  const blockProviderCallCounts = bundle.providerCallCounts;
  const marketProviderCallCounts = [7, 7] as const;
  const totalProviderCallCounts = [
    blockProviderCallCounts[0] + marketProviderCallCounts[0],
    blockProviderCallCounts[1] + marketProviderCallCounts[1],
  ] as const;
  const commitments = computeOptimisticMarketStateCommitments({
    blockNumber: bundle.blockNumber,
    blockHash: bundle.blockHash,
    stateView: OPTIMISTIC_MAINNET_STATE_VIEW,
    poolId: POOL_ID,
    tokenAddress: TOKEN,
    pool,
    market,
    providerIdentities: bundle.providerIdentities,
    providerVendorGroups: bundle.providerVendorGroups,
    providerEndpointCommitments: bundle.providerEndpointCommitments,
    providerOriginCommitments: bundle.providerOriginCommitments,
    providerHeads,
    blockProviderCallCounts,
    marketProviderCallCounts,
    totalProviderCallCounts,
    confirmations,
  });
  return Object.freeze({
    version: OPTIMISTIC_MARKET_STATE_VERSION,
    finality: "optimistic",
    chainId: 1,
    blockNumber: bundle.blockNumber,
    blockHash: bundle.blockHash,
    confirmations,
    poolId: POOL_ID,
    tokenAddress: TOKEN,
    stateView: OPTIMISTIC_MAINNET_STATE_VIEW,
    stateViewRuntimeCodeHash: OPTIMISTIC_MAINNET_STATE_VIEW_RUNTIME_CODE_HASH,
    market,
    ...commitments,
    pool,
    providerIdentities: bundle.providerIdentities,
    providerVendorGroups: bundle.providerVendorGroups,
    providerEndpointCommitments: bundle.providerEndpointCommitments,
    providerOriginCommitments: bundle.providerOriginCommitments,
    providerHeads,
    blockProviderCallCounts,
    marketProviderCallCounts,
    totalProviderCallCounts,
  });
}

function marketDatabaseRow(
  bundle: OptimisticPersistenceBundle,
  state = bundle.marketStates[0]!,
) {
  return {
    optimistic_market_state_id: state.optimisticMarketStateId,
    optimistic_block_id: state.optimisticBlockId,
    version: state.version,
    finality: state.finality,
    chain_id: "1",
    block_number: state.blockNumber,
    block_hash: Buffer.from(state.blockHash.slice(2), "hex"),
    confirmations: String(state.confirmations),
    pool_id: Buffer.from(state.poolId.slice(2), "hex"),
    token_address: Buffer.from(state.tokenAddress.slice(2), "hex"),
    state_view_address: Buffer.from(state.stateView.slice(2), "hex"),
    state_view_runtime_code_hash: Buffer.from(
      state.stateViewRuntimeCodeHash.slice(2),
      "hex",
    ),
    sqrt_price_x96: state.pool.sqrtPriceX96,
    current_tick: state.pool.currentTick,
    active_liquidity: state.pool.activeLiquidity,
    protocol_fee_pips: state.pool.protocolFeePips,
    lp_fee_pips: state.pool.lpFeePips,
    slot0_result: Buffer.from(state.pool.slot0Result.slice(2), "hex"),
    liquidity_result: Buffer.from(state.pool.liquidityResult.slice(2), "hex"),
    market: state.market,
    market_commitment: Buffer.from(state.marketCommitment.slice(2), "hex"),
    evidence_commitment: Buffer.from(state.evidenceCommitment.slice(2), "hex"),
    provider_a_id: state.providerDeploymentIds[0],
    provider_b_id: state.providerDeploymentIds[1],
    provider_a_identity: state.providerIdentities[0],
    provider_b_identity: state.providerIdentities[1],
    provider_a_vendor: state.providerVendorGroups[0],
    provider_b_vendor: state.providerVendorGroups[1],
    provider_a_endpoint_commitment: Buffer.from(
      state.providerEndpointCommitments[0].slice(2),
      "hex",
    ),
    provider_b_endpoint_commitment: Buffer.from(
      state.providerEndpointCommitments[1].slice(2),
      "hex",
    ),
    provider_a_origin_commitment: Buffer.from(
      state.providerOriginCommitments[0].slice(2),
      "hex",
    ),
    provider_b_origin_commitment: Buffer.from(
      state.providerOriginCommitments[1].slice(2),
      "hex",
    ),
    market_provider_a_head: state.providerHeads[0],
    market_provider_b_head: state.providerHeads[1],
    block_provider_call_count_a: 4,
    block_provider_call_count_b: 4,
    market_provider_call_count_a: 7,
    market_provider_call_count_b: 7,
    total_provider_call_count_a: 11,
    total_provider_call_count_b: 11,
    reorg_generation: "0",
    observed_at: new Date(state.observedAt),
  };
}

function liveBlockDatabaseRow(
  bundle: OptimisticPersistenceBundle,
  overrides: Readonly<Record<string, unknown>> = {},
) {
  return {
    optimistic_block_id: bundle.optimisticBlockId,
    chain_id: "1",
    block_number: bundle.blockNumber,
    block_hash: Buffer.from(bundle.blockHash.slice(2), "hex"),
    parent_hash: Buffer.from(bundle.parentHash.slice(2), "hex"),
    reorg_generation: "0",
    segment_start_block_number: bundle.blockNumber,
    ...overrides,
  };
}

describe("optimistic live runtime", () => {
  it("keeps block evidence idempotent across receipt observation clocks", async () => {
    const first = await verifiedBundle();
    const second = await verifiedBundle();

    expect(second.evidenceCommitment).toBe(first.evidenceCommitment);
    expect(second.logsCommitment).toBe(first.logsCommitment);
  });

  it("normalizes exact dual-RPC logs and keeps deterministic physical identities", async () => {
    const first = await verifiedBundle();
    const second = await verifiedBundle();

    expect(first.confirmations).toBe(0);
    expect(first.events).toHaveLength(5);
    expect(first.optimisticBlockId).toBe(second.optimisticBlockId);
    expect(first.evidenceCommitment).toBe(second.evidenceCommitment);
    expect(first.events.map(({ optimisticEventId }) => optimisticEventId)).toEqual(
      second.events.map(({ optimisticEventId }) => optimisticEventId),
    );
    const launch = first.events.find(
      ({ normalizedPayload }) => normalizedPayload.eventName === "MemeTokenLaunched",
    )!;
    expect(launch.normalizedPayload.arguments).toMatchObject({
      token: TOKEN,
      poolId: POOL_ID,
      feeHook: HOOK.address,
    });
    expect(launch.normalizedPayload.tokenMetadata).toMatchObject({
      name: "Programmable Test",
      symbol: "PRG",
      blockHash: BLOCK_HASH,
    });
  });

  it("persists the measured four-call metadata retry for one launch token", async () => {
    const bundle = await metadataRetryBundle();
    let eventIndex = 0;
    const executor: PostgresExecutor = {
      async transaction(work) {
        return work({
          async query<Row extends Record<string, unknown>>(sql: string) {
            if (sql.includes("session_user::text") && !sql.includes("current_role")) {
              return [{ session_user: "programmable_projector_login" }] as unknown as Row[];
            }
            if (sql.includes("current_role::text")) {
              return [{
                session_user: "programmable_projector_login",
                current_role: "programmable_projector",
              }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_block_observation_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_event_row_v1")) {
              const event = bundle.events[eventIndex++]!;
              return [{ optimistic_event_id: event.optimisticEventId }] as unknown as Row[];
            }
            if (sql.includes("get_optimistic_promotion_plan_v1")) {
              return [{
                mode: "bootstrap",
                can_promote: true,
                expected_current_block_id: null,
                orphan_required: false,
                requires_rebootstrap: false,
                target_height_current_block_id: null,
                chain_tip_block_id: null,
                chain_tip_block_number: null,
                segment_start_block_number: null,
                reorg_generation: null,
                canonical_status_id: null,
                orphan_status_id: null,
                stored_decision_commitment: null,
                stored_decided_at: null,
              }] as unknown as Row[];
            }
            if (sql.includes("promote_optimistic_block_canonical_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            return [] as Row[];
          },
        });
      },
      async close() {},
    };

    expect(bundle.metadataProviderCallCounts).toEqual([4, 4]);
    await expect(createOptimisticLiveWriter({ executor }).persist(bundle))
      .resolves.toMatchObject({ eventCount: 5, replayed: false });
  });

  it("rejects odd, over-budget, and zero-token metadata call telemetry", async () => {
    const launchBundle = await metadataRetryBundle();
    const emptyBundle = await verifiedBundle([]);
    let transactionOpened = false;
    const executor: PostgresExecutor = {
      async transaction() {
        transactionOpened = true;
        throw new Error("must not run");
      },
      async close() {},
    };
    const invalid = [
      { ...launchBundle, metadataProviderCallCounts: [3, 4] as const },
      { ...launchBundle, metadataProviderCallCounts: [8, 4] as const },
      { ...emptyBundle, metadataProviderCallCounts: [2, 0] as const },
    ];

    for (const bundle of invalid) {
      await expect(createOptimisticLiveWriter({ executor }).persist(bundle))
        .rejects.toMatchObject({
          name: "DataPipelineError",
          dependency: "postgres",
          code: "validation_failed",
          safeMetadata: { operation: "optimistic-metadata-call-count" },
        });
    }
    expect(transactionOpened).toBe(false);
  });

  it("refuses blocks outside the explicit zero-to-eleven confirmation window", async () => {
    await expect(verifiedBundle(completeClassicLaunchLogs(), BLOCK_NUMBER + 12n))
      .rejects.toMatchObject({
        name: "DataPipelineError",
        dependency: "rpc",
        code: "validation_failed",
        safeMetadata: { operation: "optimistic-finality-window" },
      });
  });

  it("persists block and all events before planning and promoting atomically", async () => {
    const bundle = await verifiedBundle();
    const calls: string[] = [];
    const executor: PostgresExecutor = {
      async transaction(work) {
        return work({
          async query<Row extends Record<string, unknown>>(sql: string) {
            calls.push(sql.replace(/\s+/gu, " ").trim());
            if (sql.includes("session_user::text") && !sql.includes("current_role")) {
              return [{ session_user: "programmable_projector_login" }] as unknown as Row[];
            }
            if (sql.includes("current_role::text")) {
              return [{
                session_user: "programmable_projector_login",
                current_role: "programmable_projector",
              }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_block_observation_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_event_row_v1")) {
              const eventIndex = calls.filter((call) =>
                call.includes("append_optimistic_event_row_v1")).length - 1;
              return [{ optimistic_event_id: bundle.events[eventIndex]!.optimisticEventId }] as unknown as Row[];
            }
            if (sql.includes("get_optimistic_promotion_plan_v1")) {
              return [{
                mode: "bootstrap",
                can_promote: true,
                expected_current_block_id: null,
                orphan_required: false,
                requires_rebootstrap: false,
                target_height_current_block_id: null,
                chain_tip_block_id: null,
                chain_tip_block_number: null,
                segment_start_block_number: null,
                reorg_generation: null,
                canonical_status_id: null,
                orphan_status_id: null,
                stored_decision_commitment: null,
                stored_decided_at: null,
              }] as unknown as Row[];
            }
            if (sql.includes("promote_optimistic_block_canonical_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            return [] as Row[];
          },
        });
      },
      async close() {},
    };

    const result = await createOptimisticLiveWriter({ executor }).persist(bundle);

    expect(result).toEqual({
      optimisticBlockId: bundle.optimisticBlockId,
      promotionMode: "bootstrap",
      replayed: false,
      eventCount: 5,
      marketStateCount: 0,
    });
    const blockIndex = calls.findIndex((call) =>
      call.includes("append_optimistic_block_observation_v1"));
    const eventIndexes = calls
      .map((call, index) => call.includes("append_optimistic_event_row_v1") ? index : -1)
      .filter((index) => index >= 0);
    const planIndex = calls.findIndex((call) =>
      call.includes("get_optimistic_promotion_plan_v1"));
    const promoteIndex = calls.findIndex((call) =>
      call.includes("promote_optimistic_block_canonical_v1"));
    expect(blockIndex).toBeLessThan(eventIndexes[0]!);
    expect(Math.max(...eventIndexes)).toBeLessThan(planIndex);
    expect(planIndex).toBeLessThan(promoteIndex);
  });

  it("appends durable market evidence in the same transaction before promotion", async () => {
    const base = await verifiedBundle([feeAccrualLog()]);
    const laterHeads = [
      (BLOCK_NUMBER + 2n).toString(),
      (BLOCK_NUMBER + 3n).toString(),
    ] as const;
    const bundle = attachOptimisticMarketStates(base, [
      marketStateEvidence(base, laterHeads),
    ]);
    const calls: Array<{ sql: string; values: readonly PostgresParameter[] }> = [];
    const executor: PostgresExecutor = {
      async transaction(work) {
        return work({
          async query<Row extends Record<string, unknown>>(
            sql: string,
            values: readonly PostgresParameter[] = [],
          ) {
            calls.push({ sql: sql.replace(/\s+/gu, " ").trim(), values });
            if (sql.includes("session_user::text") && !sql.includes("current_role")) {
              return [{ session_user: "programmable_projector_login" }] as unknown as Row[];
            }
            if (sql.includes("current_role::text")) {
              return [{
                session_user: "programmable_projector_login",
                current_role: "programmable_projector",
              }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_block_observation_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_event_row_v1")) {
              return [{ optimistic_event_id: bundle.events[0]!.optimisticEventId }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_market_state_v2")) {
              return [{
                optimistic_market_state_id:
                  bundle.marketStates[0]!.optimisticMarketStateId,
              }] as unknown as Row[];
            }
            if (sql.includes("get_optimistic_promotion_plan_v1")) {
              return [{
                mode: "bootstrap",
                can_promote: true,
                expected_current_block_id: null,
                orphan_required: false,
                requires_rebootstrap: false,
                target_height_current_block_id: null,
                chain_tip_block_id: null,
                chain_tip_block_number: null,
                segment_start_block_number: null,
                reorg_generation: null,
                canonical_status_id: null,
                orphan_status_id: null,
                stored_decision_commitment: null,
                stored_decided_at: null,
              }] as unknown as Row[];
            }
            if (sql.includes("promote_optimistic_block_canonical_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            return [] as Row[];
          },
        });
      },
      async close() {},
    };

    const result = await createOptimisticLiveWriter({ executor }).persist(bundle);
    const indexOf = (operation: string) =>
      calls.findIndex(({ sql }) => sql.includes(operation));
    const marketCall = calls.find(({ sql }) =>
      sql.includes("append_optimistic_market_state_v2"))!;

    expect(result.marketStateCount).toBe(1);
    expect(indexOf("append_optimistic_block_observation_v1"))
      .toBeLessThan(indexOf("append_optimistic_event_row_v1"));
    expect(indexOf("append_optimistic_event_row_v1"))
      .toBeLessThan(indexOf("append_optimistic_market_state_v2"));
    expect(indexOf("append_optimistic_market_state_v2"))
      .toBeLessThan(indexOf("get_optimistic_promotion_plan_v1"));
    expect(indexOf("get_optimistic_promotion_plan_v1"))
      .toBeLessThan(indexOf("promote_optimistic_block_canonical_v1"));
    expect(marketCall.values[25]).toBe(laterHeads[0]);
    expect(marketCall.values[26]).toBe(laterHeads[1]);
    expect(marketCall.values[33]).toBe("2");
  });

  it("aborts before planning or promotion when the atomic market append fails", async () => {
    const base = await verifiedBundle([feeAccrualLog()]);
    const bundle = attachOptimisticMarketStates(base, [
      marketStateEvidence(base),
    ]);
    let planned = false;
    let promoted = false;
    const executor: PostgresExecutor = {
      async transaction(work) {
        return work({
          async query<Row extends Record<string, unknown>>(sql: string) {
            if (sql.includes("session_user::text") && !sql.includes("current_role")) {
              return [{ session_user: "programmable_projector_login" }] as unknown as Row[];
            }
            if (sql.includes("current_role::text")) {
              return [{
                session_user: "programmable_projector_login",
                current_role: "programmable_projector",
              }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_block_observation_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_event_row_v1")) {
              return [{ optimistic_event_id: bundle.events[0]!.optimisticEventId }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_market_state_v2")) {
              throw new Error("market append failed");
            }
            if (sql.includes("get_optimistic_promotion_plan_v1")) planned = true;
            if (sql.includes("promote_optimistic_block_canonical_v1")) promoted = true;
            return [] as Row[];
          },
        });
      },
      async close() {},
    };

    await expect(createOptimisticLiveWriter({ executor }).persist(bundle))
      .rejects.toMatchObject({
        name: "ProjectorDatabaseError",
      });
    expect(planned).toBe(false);
    expect(promoted).toBe(false);
  });

  it("advances the verified live chain for an empty manifest-log block", async () => {
    const bundle = await verifiedBundle([]);
    let eventAppendCalls = 0;
    const executor: PostgresExecutor = {
      async transaction(work) {
        return work({
          async query<Row extends Record<string, unknown>>(sql: string) {
            if (sql.includes("session_user::text") && !sql.includes("current_role")) {
              return [{ session_user: "programmable_projector_login" }] as unknown as Row[];
            }
            if (sql.includes("current_role::text")) {
              return [{
                session_user: "programmable_projector_login",
                current_role: "programmable_projector",
              }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_block_observation_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_event_row_v1")) {
              eventAppendCalls += 1;
            }
            if (sql.includes("get_optimistic_promotion_plan_v1")) {
              return [{
                mode: "bootstrap",
                can_promote: true,
                expected_current_block_id: null,
                orphan_required: false,
                requires_rebootstrap: false,
                target_height_current_block_id: null,
                chain_tip_block_id: null,
                chain_tip_block_number: null,
                segment_start_block_number: null,
                reorg_generation: null,
                canonical_status_id: null,
                orphan_status_id: null,
                stored_decision_commitment: null,
                stored_decided_at: null,
              }] as unknown as Row[];
            }
            if (sql.includes("promote_optimistic_block_canonical_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            return [] as Row[];
          },
        });
      },
      async close() {},
    };

    const persisted = await createOptimisticLiveWriter({ executor }).persist(bundle);

    expect(bundle.events).toEqual([]);
    expect(persisted.eventCount).toBe(0);
    expect(eventAppendCalls).toBe(0);
  });

  it("rejects a tampered persistence bundle before opening a database transaction", async () => {
    const bundle = await verifiedBundle([completeClassicLaunchLogs()[0]!]);
    let transactionOpened = false;
    const executor: PostgresExecutor = {
      async transaction() {
        transactionOpened = true;
        throw new Error("must not run");
      },
      async close() {},
    };
    const event = bundle.events[0]!;
    const tampered = {
      ...bundle,
      events: [{ ...event, rawData: "0x" as const }],
    };

    await expect(createOptimisticLiveWriter({ executor }).persist(tampered))
      .rejects.toMatchObject({
        name: "DataPipelineError",
        dependency: "postgres",
        code: "validation_failed",
      });
    expect(transactionOpened).toBe(false);
  });

  it("rejects tampered market commitments and regressed market heads before the transaction", async () => {
    const base = await verifiedBundle([feeAccrualLog()], BLOCK_NUMBER + 1n);
    const bundle = attachOptimisticMarketStates(base, [
      marketStateEvidence(base, [
        (BLOCK_NUMBER + 2n).toString(),
        (BLOCK_NUMBER + 2n).toString(),
      ]),
    ]);
    let transactionCount = 0;
    const executor: PostgresExecutor = {
      async transaction() {
        transactionCount += 1;
        throw new Error("must not run");
      },
      async close() {},
    };
    const state = bundle.marketStates[0]!;
    const tamperedCommitment = {
      ...bundle,
      marketStates: [{
        ...state,
        market: { ...state.market, activeLiquidity: "999" },
      }],
    };
    const regressedHeads = {
      ...bundle,
      marketStates: [{
        ...state,
        providerHeads: [BLOCK_NUMBER.toString(), BLOCK_NUMBER.toString()] as const,
      }],
    };

    await expect(createOptimisticLiveWriter({ executor }).persist(
      tamperedCommitment,
    )).rejects.toMatchObject({
      name: "DataPipelineError",
      code: "validation_failed",
    });
    await expect(createOptimisticLiveWriter({ executor }).persist(
      regressedHeads,
    )).rejects.toMatchObject({
      name: "DataPipelineError",
      code: "validation_failed",
    });
    expect(transactionCount).toBe(0);
  });

  it("reads and revalidates bounded live rows through only API-reader RPCs", async () => {
    const bundle = await verifiedBundle([
      completeClassicLaunchLogs()[0]!,
    ]);
    let listed = false;
    const executor: PostgresExecutor = {
      async transaction(work) {
        return work({
          async query<Row extends Record<string, unknown>>(sql: string) {
            if (sql.includes("session_user::text") && !sql.includes("current_role")) {
              return [{ session_user: "programmable_api_reader_login" }] as unknown as Row[];
            }
            if (sql.includes("current_role::text")) {
              return [{
                session_user: "programmable_api_reader_login",
                current_role: "programmable_api_reader",
              }] as unknown as Row[];
            }
            if (sql.includes("get_optimistic_live_head_v1")) {
              return [{
                optimistic_block_id: bundle.optimisticBlockId,
                chain_id: "1",
                block_number: bundle.blockNumber,
                block_hash: Buffer.from(bundle.blockHash.slice(2), "hex"),
                parent_hash: Buffer.from(bundle.parentHash.slice(2), "hex"),
                block_timestamp: new Date(bundle.blockTimestamp),
                provider_a_id: bundle.providerDeploymentIds[0],
                provider_b_id: bundle.providerDeploymentIds[1],
                provider_a_head: bundle.providerHeads[0],
                provider_b_head: bundle.providerHeads[1],
                reorg_generation: "0",
                status: "canonical",
                observed_at: new Date(bundle.observedAt),
                canonical_at: new Date(bundle.observedAt),
              }] as unknown as Row[];
            }
            if (sql.includes("list_optimistic_live_chain_segment_v1")) {
              return [liveBlockDatabaseRow(bundle)] as unknown as Row[];
            }
            if (sql.includes("list_optimistic_canonical_events_v1")) {
              if (listed) return [] as Row[];
              listed = true;
              const event = bundle.events[0]!;
              return [{
                optimistic_event_id: event.optimisticEventId,
                optimistic_block_id: event.optimisticBlockId,
                chain_id: "1",
                block_number: bundle.blockNumber,
                block_hash: Buffer.from(bundle.blockHash.slice(2), "hex"),
                transaction_hash: Buffer.from(event.transactionHash.slice(2), "hex"),
                transaction_index: String(event.transactionIndex),
                block_global_log_index: String(event.blockGlobalLogIndex),
                source_address: Buffer.from(event.sourceAddress.slice(2), "hex"),
                event_signature: Buffer.from(event.eventSignature.slice(2), "hex"),
                ordered_topics: event.orderedTopics.map((topic) =>
                  Buffer.from(topic.slice(2), "hex")),
                raw_data: Buffer.from(event.rawData.slice(2), "hex"),
                normalized_payload: event.normalizedPayload,
                payload_commitment: Buffer.from(event.payloadCommitment.slice(2), "hex"),
                reorg_generation: "0",
                observed_at: new Date(bundle.observedAt),
              }] as unknown as Row[];
            }
            return [] as Row[];
          },
        });
      },
      async close() {},
    };

    const snapshot = await createOptimisticLiveReader({
      executor,
      now: () => new Date("2026-08-02T10:00:30.000Z"),
    }).snapshot();

    expect(snapshot.head?.blockHash).toBe(BLOCK_HASH);
    expect(snapshot.blocks).toEqual([
      {
        optimisticBlockId: bundle.optimisticBlockId,
        chainId: 1,
        blockNumber: bundle.blockNumber,
        blockHash: bundle.blockHash,
        parentHash: bundle.parentHash,
        reorgGeneration: "0",
      },
    ]);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.normalizedPayload.eventName).toBe("PoolRegistered");
  });

  it("proves every empty height and the preceding checkpoint across the twelve-block ancestry", async () => {
    const bundle = await verifiedBundle([]);
    const oldestParentHash = `0x${"fe".repeat(32)}` as Hex;
    const ancestorHashes = Array.from({ length: 11 }, (_, index) =>
      `0x${(index + 1).toString(16).padStart(2, "0").repeat(32)}` as Hex);
    ancestorHashes[10] = bundle.parentHash;
    const hashes = [...ancestorHashes, bundle.blockHash] as readonly Hex[];
    const rows = hashes.map((hash, index) => ({
      optimistic_block_id:
        `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      chain_id: "1",
      block_number: (BLOCK_NUMBER - 11n + BigInt(index)).toString(),
      block_hash: Buffer.from(hash.slice(2), "hex"),
      parent_hash: Buffer.from(
        (index === 0 ? oldestParentHash : hashes[index - 1]!).slice(2),
        "hex",
      ),
      reorg_generation: "7",
      segment_start_block_number: (BLOCK_NUMBER - 20n).toString(),
    }));
    rows[11] = {
      ...rows[11]!,
      optimistic_block_id: bundle.optimisticBlockId,
    };
    const executorFor = (
      blockRows: readonly Record<string, unknown>[],
    ): PostgresExecutor => ({
      async transaction(work) {
        return work({
          async query<Row extends Record<string, unknown>>(sql: string) {
            if (sql.includes("session_user::text") && !sql.includes("current_role")) {
              return [{ session_user: "programmable_api_reader_login" }] as unknown as Row[];
            }
            if (sql.includes("current_role::text")) {
              return [{
                session_user: "programmable_api_reader_login",
                current_role: "programmable_api_reader",
              }] as unknown as Row[];
            }
            if (sql.includes("get_optimistic_live_head_v1")) {
              return [{
                optimistic_block_id: bundle.optimisticBlockId,
                chain_id: "1",
                block_number: bundle.blockNumber,
                block_hash: Buffer.from(bundle.blockHash.slice(2), "hex"),
                parent_hash: Buffer.from(bundle.parentHash.slice(2), "hex"),
                block_timestamp: new Date(bundle.blockTimestamp),
                provider_a_id: bundle.providerDeploymentIds[0],
                provider_b_id: bundle.providerDeploymentIds[1],
                provider_a_head: bundle.providerHeads[0],
                provider_b_head: bundle.providerHeads[1],
                reorg_generation: "7",
                status: "canonical",
                observed_at: new Date(bundle.observedAt),
                canonical_at: new Date(bundle.observedAt),
              }] as unknown as Row[];
            }
            if (sql.includes("list_optimistic_live_chain_segment_v1")) {
              return blockRows as Row[];
            }
            return [] as Row[];
          },
        });
      },
      async close() {},
    });

    const snapshot = await createOptimisticLiveReader({
      executor: executorFor(rows),
      now: () => new Date("2026-08-02T10:00:30.000Z"),
    }).snapshot();

    expect(snapshot.events).toEqual([]);
    expect(snapshot.blocks).toHaveLength(12);
    expect(snapshot.blocks[0]).toMatchObject({
      blockNumber: (BLOCK_NUMBER - 11n).toString(),
      parentHash: oldestParentHash,
      reorgGeneration: "7",
    });
    expect({
      blockNumber: (BigInt(snapshot.blocks[0]!.blockNumber) - 1n).toString(),
      blockHash: snapshot.blocks[0]!.parentHash,
    }).toEqual({
      blockNumber: (BLOCK_NUMBER - 12n).toString(),
      blockHash: oldestParentHash,
    });

    await expect(createOptimisticLiveReader({
      executor: executorFor(rows.slice(1)),
      now: () => new Date("2026-08-02T10:00:30.000Z"),
    }).snapshot()).rejects.toMatchObject({
      code: "validation_failed",
      safeMetadata: { operation: "optimistic-block-segment-completeness" },
    });
    await expect(createOptimisticLiveReader({
      executor: executorFor(rows.map((row, index) =>
        index === 6
          ? { ...row, parent_hash: Buffer.from("ff".repeat(32), "hex") }
          : row)),
      now: () => new Date("2026-08-02T10:00:30.000Z"),
    }).snapshot()).rejects.toMatchObject({
      code: "validation_failed",
      safeMetadata: { operation: "optimistic-block-ancestry" },
    });
  });

  it("reconstructs durable market state in a cold reader and rejects tamper or reorg mismatch", async () => {
    const base = await verifiedBundle([feeAccrualLog()]);
    const bundle = attachOptimisticMarketStates(base, [
      marketStateEvidence(base, [
        (BLOCK_NUMBER + 2n).toString(),
        (BLOCK_NUMBER + 3n).toString(),
      ]),
    ]);
    const stateRow = marketDatabaseRow(bundle);
    const executorFor = (
      mutate?: (row: ReturnType<typeof marketDatabaseRow>) => Record<string, unknown>,
    ): PostgresExecutor => {
      let eventsListed = false;
      let marketsListed = false;
      return {
        async transaction(work) {
          return work({
            async query<Row extends Record<string, unknown>>(sql: string) {
              if (sql.includes("session_user::text") && !sql.includes("current_role")) {
                return [{ session_user: "programmable_api_reader_login" }] as unknown as Row[];
              }
              if (sql.includes("current_role::text")) {
                return [{
                  session_user: "programmable_api_reader_login",
                  current_role: "programmable_api_reader",
                }] as unknown as Row[];
              }
              if (sql.includes("get_optimistic_live_head_v1")) {
                return [{
                  optimistic_block_id: bundle.optimisticBlockId,
                  chain_id: "1",
                  block_number: bundle.blockNumber,
                  block_hash: Buffer.from(bundle.blockHash.slice(2), "hex"),
                  parent_hash: Buffer.from(bundle.parentHash.slice(2), "hex"),
                  block_timestamp: new Date(bundle.blockTimestamp),
                  provider_a_id: bundle.providerDeploymentIds[0],
                  provider_b_id: bundle.providerDeploymentIds[1],
                  provider_a_head: bundle.providerHeads[0],
                  provider_b_head: bundle.providerHeads[1],
                  reorg_generation: "0",
                  status: "canonical",
                  observed_at: new Date(bundle.observedAt),
                  canonical_at: new Date(bundle.observedAt),
                }] as unknown as Row[];
              }
              if (sql.includes("list_optimistic_live_chain_segment_v1")) {
                return [liveBlockDatabaseRow(bundle)] as unknown as Row[];
              }
              if (sql.includes("list_optimistic_canonical_events_v1")) {
                if (eventsListed) return [] as Row[];
                eventsListed = true;
                const event = bundle.events[0]!;
                return [{
                  optimistic_event_id: event.optimisticEventId,
                  optimistic_block_id: event.optimisticBlockId,
                  chain_id: "1",
                  block_number: bundle.blockNumber,
                  block_hash: Buffer.from(bundle.blockHash.slice(2), "hex"),
                  transaction_hash: Buffer.from(event.transactionHash.slice(2), "hex"),
                  transaction_index: String(event.transactionIndex),
                  block_global_log_index: String(event.blockGlobalLogIndex),
                  source_address: Buffer.from(event.sourceAddress.slice(2), "hex"),
                  event_signature: Buffer.from(event.eventSignature.slice(2), "hex"),
                  ordered_topics: event.orderedTopics.map((topic) =>
                    Buffer.from(topic.slice(2), "hex")),
                  raw_data: Buffer.from(event.rawData.slice(2), "hex"),
                  normalized_payload: event.normalizedPayload,
                  payload_commitment: Buffer.from(event.payloadCommitment.slice(2), "hex"),
                  reorg_generation: "0",
                  observed_at: new Date(bundle.observedAt),
                }] as unknown as Row[];
              }
              if (sql.includes("list_optimistic_canonical_market_states_v1")) {
                if (marketsListed) return [] as Row[];
                marketsListed = true;
                return [mutate ? mutate({ ...stateRow }) : stateRow] as unknown as Row[];
              }
              return [] as Row[];
            },
          });
        },
        async close() {},
      };
    };

    const coldSnapshot = await createOptimisticLiveReader({
      executor: executorFor(),
      now: () => new Date("2026-08-02T10:00:30.000Z"),
    }).snapshot();

    expect(coldSnapshot.marketStates).toHaveLength(1);
    expect(coldSnapshot.marketStates[0]).toMatchObject({
      confirmations: 2,
      providerHeads: [
        (BLOCK_NUMBER + 2n).toString(),
        (BLOCK_NUMBER + 3n).toString(),
      ],
      market: {
        indexedValuationBlockNumber: BLOCK_NUMBER.toString(),
        currentTick: 25,
        activeLiquidity: "1000000",
      },
    });
    expect(coldSnapshot.head?.providerHeads).toEqual([
      BLOCK_NUMBER.toString(),
      BLOCK_NUMBER.toString(),
    ]);

    await expect(createOptimisticLiveReader({
      executor: executorFor((row) => ({
        ...row,
        market: { ...row.market, activeLiquidity: "999" },
      })),
      now: () => new Date("2026-08-02T10:00:30.000Z"),
    }).snapshot()).rejects.toMatchObject({
      name: "DataPipelineError",
      code: "validation_failed",
    });
    await expect(createOptimisticLiveReader({
      executor: executorFor((row) => ({ ...row, reorg_generation: "1" })),
      now: () => new Date("2026-08-02T10:00:30.000Z"),
    }).snapshot()).rejects.toMatchObject({
      name: "DataPipelineError",
      code: "validation_failed",
      safeMetadata: { operation: "optimistic-market-window" },
    });
  });

  it("drops stale or implausibly future live heads before reading event rows", async () => {
    const bundle = await verifiedBundle([completeClassicLaunchLogs()[0]!]);
    let listCalls = 0;
    const executor: PostgresExecutor = {
      async transaction(work) {
        return work({
          async query<Row extends Record<string, unknown>>(sql: string) {
            if (sql.includes("session_user::text") && !sql.includes("current_role")) {
              return [{ session_user: "programmable_api_reader_login" }] as unknown as Row[];
            }
            if (sql.includes("current_role::text")) {
              return [{
                session_user: "programmable_api_reader_login",
                current_role: "programmable_api_reader",
              }] as unknown as Row[];
            }
            if (sql.includes("get_optimistic_live_head_v1")) {
              return [{
                optimistic_block_id: bundle.optimisticBlockId,
                chain_id: "1",
                block_number: bundle.blockNumber,
                block_hash: Buffer.from(bundle.blockHash.slice(2), "hex"),
                parent_hash: Buffer.from(bundle.parentHash.slice(2), "hex"),
                block_timestamp: new Date(bundle.blockTimestamp),
                provider_a_id: bundle.providerDeploymentIds[0],
                provider_b_id: bundle.providerDeploymentIds[1],
                provider_a_head: bundle.providerHeads[0],
                provider_b_head: bundle.providerHeads[1],
                reorg_generation: "0",
                status: "canonical",
                observed_at: new Date(bundle.observedAt),
                canonical_at: new Date(bundle.observedAt),
              }] as unknown as Row[];
            }
            if (
              sql.includes("list_optimistic_live_chain_segment_v1") ||
              sql.includes("list_optimistic_canonical_events_v1") ||
              sql.includes("list_optimistic_canonical_market_states_v1")
            ) {
              listCalls += 1;
            }
            return [] as Row[];
          },
        });
      },
      async close() {},
    };

    const stale = await createOptimisticLiveReader({
      executor,
      now: () => new Date("2026-08-02T10:01:01.000Z"),
    }).snapshot();
    const future = await createOptimisticLiveReader({
      executor,
      now: () => new Date("2026-08-02T09:59:29.000Z"),
    }).snapshot();

    expect(stale).toEqual({
      head: null,
      blocks: [],
      events: [],
      marketStates: [],
    });
    expect(future).toEqual({
      head: null,
      blocks: [],
      events: [],
      marketStates: [],
    });
    expect(listCalls).toBe(0);
  });

  it("replays the database-stored canonical decision and refuses non-promotable reorg plans", async () => {
    const replayBase = await verifiedBundle([feeAccrualLog()]);
    const bundle = attachOptimisticMarketStates(replayBase, [
      marketStateEvidence(replayBase),
    ]);
    const canonicalStatusId = "aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa";
    const storedDecision = Buffer.from("ef".repeat(32), "hex");
    const storedDecidedAt = new Date("2026-08-02T09:59:59.000Z");
    let promoteValues: readonly unknown[] | undefined;
    const executorFor = (mode: "replay" | "parent-mismatch"): PostgresExecutor => ({
      async transaction(work) {
        return work({
          async query<Row extends Record<string, unknown>>(
            sql: string,
            values: readonly PostgresParameter[] = [],
          ) {
            if (sql.includes("session_user::text") && !sql.includes("current_role")) {
              return [{ session_user: "programmable_projector_login" }] as unknown as Row[];
            }
            if (sql.includes("current_role::text")) {
              return [{
                session_user: "programmable_projector_login",
                current_role: "programmable_projector",
              }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_block_observation_v1")) {
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_event_row_v1")) {
              return [{ optimistic_event_id: bundle.events[0]!.optimisticEventId }] as unknown as Row[];
            }
            if (sql.includes("append_optimistic_market_state_v2")) {
              return [{
                optimistic_market_state_id:
                  bundle.marketStates[0]!.optimisticMarketStateId,
              }] as unknown as Row[];
            }
            if (sql.includes("get_optimistic_promotion_plan_v1")) {
              return [{
                mode,
                can_promote: mode === "replay",
                expected_current_block_id: null,
                orphan_required: false,
                requires_rebootstrap: false,
                target_height_current_block_id: bundle.optimisticBlockId,
                chain_tip_block_id: bundle.optimisticBlockId,
                chain_tip_block_number: bundle.blockNumber,
                segment_start_block_number: bundle.blockNumber,
                reorg_generation: "0",
                canonical_status_id: mode === "replay" ? canonicalStatusId : null,
                orphan_status_id: null,
                stored_decision_commitment: mode === "replay" ? storedDecision : null,
                stored_decided_at: mode === "replay" ? storedDecidedAt : null,
              }] as unknown as Row[];
            }
            if (sql.includes("promote_optimistic_block_canonical_v1")) {
              promoteValues = values;
              return [{ optimistic_block_id: bundle.optimisticBlockId }] as unknown as Row[];
            }
            return [] as Row[];
          },
        });
      },
      async close() {},
    });

    const replay = await createOptimisticLiveWriter({
      executor: executorFor("replay"),
    }).persist(bundle);

    expect(replay.replayed).toBe(true);
    expect(promoteValues?.[2]).toBe(canonicalStatusId);
    expect(Buffer.from(promoteValues?.[4] as Uint8Array)).toEqual(storedDecision);
    expect(promoteValues?.[5]).toEqual(storedDecidedAt);

    promoteValues = undefined;
    await expect(createOptimisticLiveWriter({
      executor: executorFor("parent-mismatch"),
    }).persist(bundle)).rejects.toMatchObject({
      name: "DataPipelineError",
      dependency: "postgres",
      code: "validation_failed",
      safeMetadata: { operation: "optimistic-promotion-refused" },
    });
    expect(promoteValues).toBeUndefined();
  });

  it("publishes a launch only after the complete same-transaction parent group folds", async () => {
    const complete = await verifiedBundle();
    const incomplete = await verifiedBundle(completeClassicLaunchLogs().slice(0, -1));

    const completeRows = optimisticOverlayRowsFromSnapshot({
      snapshot: snapshotFromBundle(complete),
      canonicalTokens: [],
    });
    const incompleteRows = optimisticOverlayRowsFromSnapshot({
      snapshot: snapshotFromBundle(incomplete),
      canonicalTokens: [],
    });

    expect(completeRows).toHaveLength(1);
    expect(completeRows[0]).toMatchObject({
      kind: "launch",
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      token: {
        name: "Programmable Test",
        symbol: "PRG",
        hookAddress: HOOK.address,
        totalSupplyRaw: "1000000000000000000000000",
        totalSwapFeeBps: 100,
      },
      evidence: {
        finality: "optimistic",
        confirmations: 0,
      },
    });
    expect(incompleteRows).toEqual([]);
  });

  it("uses only snapshot-persisted market state bound to a live fee event and known pool", async () => {
    const baseBundle = await verifiedBundle([feeAccrualLog()]);
    const bundle = attachOptimisticMarketStates(baseBundle, [
      marketStateEvidence(baseBundle),
    ]);
    const snapshot = snapshotFromBundle(bundle);
    const canonicalToken: LauncherToken = {
      id: TOKEN,
      name: "Programmable Test",
      symbol: "PRG",
      tokenAddress: TOKEN,
      hookAddress: HOOK.address,
      poolId: POOL_ID,
      launchBlockNumber: (BLOCK_NUMBER - 100n).toString(),
      launchTransactionHash: `0x${"99".repeat(32)}`,
      launchTransactionIndex: 1,
      launchLogIndex: 1,
      launchedAt: "2026-08-02T09:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    };
    const rows = optimisticOverlayRowsFromSnapshot({
      snapshot,
      canonicalTokens: [canonicalToken],
    });
    const noDurableStateRows = optimisticOverlayRowsFromSnapshot({
      snapshot: Object.freeze({ ...snapshot, marketStates: Object.freeze([]) }),
      canonicalTokens: [canonicalToken],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "market",
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      market: {
        indexedValuationBlockNumber: bundle.blockNumber,
        currentTick: 25,
        activeLiquidity: "1000000",
      },
    });
    expect(noDurableStateRows).toEqual([]);
  });

  it("keeps a Classic SLA sentinel when the organic market plan is stock-only", async () => {
    const bundle = await verifiedBundle([feeAccrualLog()]);
    const base = {
      id: TOKEN,
      name: "Programmable Test",
      symbol: "PRG",
      tokenAddress: TOKEN,
      hookAddress: HOOK.address,
      poolId: POOL_ID,
      launchBlockNumber: (BLOCK_NUMBER - 100n).toString(),
      launchTransactionHash: `0x${"99".repeat(32)}` as const,
      launchTransactionIndex: 1,
      launchLogIndex: 1,
      launchedAt: "2026-08-02T09:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
    } satisfies LauncherToken;
    const classicPool = `0x${"aa".repeat(32)}` as const;
    const classicToken = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;
    const plans = configuredOptimisticMarketReadPlans({
      bundle,
      canonicalTokens: [
        { ...base, launchModel: "stock-paired" },
        {
          ...base,
          id: classicToken,
          tokenAddress: classicToken,
          poolId: classicPool,
          launchModel: "classic",
        },
      ],
      ensureTrackedMarket: true,
    });

    expect(plans.map(({ tokenAddress }) => tokenAddress)).toEqual([
      TOKEN,
      classicToken,
    ]);
  });

  it("adds a canonical Classic SLA sentinel beside a brand-new Classic launch", async () => {
    const bundle = await verifiedBundle();
    const classicPool = `0x${"cc".repeat(32)}` as const;
    const classicToken = "0xdddddddddddddddddddddddddddddddddddddddd" as const;
    const canonicalClassic = {
      id: classicToken,
      name: "Canonical Classic",
      symbol: "CC",
      tokenAddress: classicToken,
      hookAddress: HOOK.address,
      poolId: classicPool,
      launchBlockNumber: (BLOCK_NUMBER - 100n).toString(),
      launchTransactionHash: `0x${"99".repeat(32)}` as const,
      launchTransactionIndex: 1,
      launchLogIndex: 1,
      launchedAt: "2026-08-02T09:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      launchModel: "classic" as const,
    } satisfies LauncherToken;

    const plans = configuredOptimisticMarketReadPlans({
      bundle,
      canonicalTokens: [canonicalClassic],
      ensureTrackedMarket: true,
    });

    expect(plans).toHaveLength(2);
    expect(plans.some(({ token }) => token?.tokenAddress === classicToken)).toBe(true);
    expect(plans.some(({ newLaunch }) => newLaunch?.tokenAddress === TOKEN)).toBe(true);
  });
});
