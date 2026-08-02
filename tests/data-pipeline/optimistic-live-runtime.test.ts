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
  createOptimisticLiveReader,
  createOptimisticLiveWriter,
  optimisticOverlayRowsFromSnapshot,
  verifyOptimisticBlockForPersistence,
  type OptimisticLiveSnapshot,
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
    providerIdentity: "alchemy-mainnet",
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
  vendor: "alchemy" | "quicknode",
  logs: readonly CandidateRpcLog[],
  head = BLOCK_NUMBER,
): CandidateRpcProvider {
  const deployment = PROVIDER_DEPLOYMENTS[vendor === "alchemy" ? 0 : 1];
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
    provider("alchemy", logs, head),
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
  });
}

describe("optimistic live runtime", () => {
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
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.normalizedPayload.eventName).toBe("PoolRegistered");
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
            if (sql.includes("list_optimistic_canonical_events_v1")) {
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

    expect(stale).toEqual({ head: null, events: [] });
    expect(future).toEqual({ head: null, events: [] });
    expect(listCalls).toBe(0);
  });

  it("replays the database-stored canonical decision and refuses non-promotable reorg plans", async () => {
    const bundle = await verifiedBundle([completeClassicLaunchLogs()[0]!]);
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

  it("binds market state to a live fee event, known pool and the exact provider pair", async () => {
    const bundle = await verifiedBundle([feeAccrualLog()]);
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
    const state = {
      chainId: 1 as const,
      blockNumber: bundle.blockNumber,
      blockHash: bundle.blockHash,
      confirmations: 0,
      poolId: POOL_ID,
      tokenAddress: TOKEN,
      market: {
        indexedValuationBlockNumber: bundle.blockNumber,
        currentTick: 25,
        activeLiquidity: "1000000",
      },
      providerIdentities: bundle.providerIdentities,
      providerVendorGroups: bundle.providerVendorGroups,
      providerEndpointCommitments: bundle.providerEndpointCommitments,
      providerOriginCommitments: bundle.providerOriginCommitments,
      providerHeads: bundle.providerHeads,
    };

    const rows = optimisticOverlayRowsFromSnapshot({
      snapshot,
      canonicalTokens: [canonicalToken],
      marketStates: [state],
      providerDeployments: PROVIDER_DEPLOYMENTS,
    });
    const wrongProviderRows = optimisticOverlayRowsFromSnapshot({
      snapshot,
      canonicalTokens: [canonicalToken],
      marketStates: [{
        ...state,
        providerIdentities: ["untrusted", state.providerIdentities[1]],
      }],
      providerDeployments: PROVIDER_DEPLOYMENTS,
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
    expect(wrongProviderRows).toEqual([]);
  });
});
