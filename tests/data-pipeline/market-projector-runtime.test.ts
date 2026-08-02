import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";
import { keccak256, toBytes } from "viem";

vi.mock("server-only", () => ({}));

import {
  createDualRpcMarketReader,
  createPostgresMarketProjectorStore,
  MARKET_GRAPH_QUERY_CONTRACT,
  MARKET_GRAPH_SCHEMA_COMMITMENT,
  runConfiguredMarketProjectorCycle,
  runMarketProjectorFastLaneCycle,
  runMarketProjectorCycle,
  type MarketAnalytics,
  type MarketCloseAnchor,
  type MarketPoolPlan,
  type MarketProjectorStore,
  type MarketRpc,
  type PreparedMarketPage,
} from "../../lib/data-pipeline/market-projector-runtime.server";
import type {
  PostgresExecutor,
  PostgresParameter,
  PostgresTransaction,
} from "../../lib/data-pipeline/postgres";
import type {
  CandleAnalytics,
  PoolSnapshot,
} from "../../lib/data-pipeline/uniswap";
import {
  OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
  UNISWAP_ANALYTICS_QUERY_CONTRACT,
} from "../../lib/data-pipeline/uniswap";

const POOL_ID = `0x${"11".repeat(32)}` as const;
const BLOCK_HASH = `0x${"22".repeat(32)}` as const;
const GRAPH_COMMITMENT = `0x${"33".repeat(32)}` as const;
const NATIVE = "0x0000000000000000000000000000000000000000" as const;
const TOKEN = "0x1111111111111111111111111111111111111111" as const;
const HOOK = "0x2222222222222222222222222222222222222222" as const;
const TARGET_TIME = new Date("2026-07-31T12:03:20.000Z");

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("unsupported canonical value");
}

function graphSchemaCommitment(value: unknown) {
  return keccak256(
    toBytes(
      `programmable:market-projector:graph-query-contract:v1\0${canonicalJson(value)}`,
    ),
  );
}

function snapshot(): PoolSnapshot {
  return {
    id: POOL_ID,
    createdAtTimestamp: "1785499200",
    createdAtBlockNumber: "100",
    token0: { id: NATIVE, decimals: 18 },
    token1: { id: TOKEN, decimals: 18 },
    hooks: HOOK,
    appliedFeeTier: "0",
    tickSpacing: 60,
    liquidity: "1000000000000000000",
    sqrtPriceX96: "79228162514264337593543950336",
    tick: 0,
    transactionCount: "25",
    marketVolumeToken0: "10",
    marketVolumeToken1: "10",
    marketVolumeUsd: "20",
    totalValueLockedToken0: "5",
    totalValueLockedToken1: "5",
    totalValueLockedUsd: "10",
  };
}

function candle(periodStart: number): CandleAnalytics {
  return {
    id: `hour-${periodStart}`,
    periodStart,
    poolId: POOL_ID,
    liquidity: "1000000000000000000",
    sqrtPriceX96: "79228162514264337593543950336",
    token0Price: "1",
    token1Price: "1",
    tick: 0,
    tvlUsd: "10",
    marketVolumeToken0: "10",
    marketVolumeToken1: "10",
    marketVolumeUsd: "20",
    feesUsd: "0.2",
    transactionCount: "25",
    open: "1",
    high: "1",
    low: "1",
    close: "1",
  };
}

function cursor(
  overrides: Partial<NonNullable<MarketPoolPlan["cursor"]>> = {},
) {
  return {
    id: "11111111-1111-8111-8111-111111111111",
    epochId: "22222222-2222-8222-8222-222222222222",
    pointerGeneration: "1",
    cursorGeneration: "1",
    reorgGeneration: "0",
    sourceCheckpointId: "33333333-3333-8333-8333-333333333333",
    sourceCheckpointGeneration: "1",
    sourceReorgGeneration: "0",
    blockEvidenceId: "44444444-4444-8444-8444-444444444444",
    blockNumber: "100",
    blockHash: `0x${"44".repeat(32)}` as const,
    providerCursor: "block:100:4444444444444444",
    hourCoverageEnd: null,
    dayCoverageEnd: null,
    advancedAt: new Date("2026-07-31T12:01:00.000Z"),
    ...overrides,
  };
}

function plan(overrides: Partial<MarketPoolPlan> = {}): MarketPoolPlan {
  return {
    scope: { releaseId: "classic-v3", modelId: "classic", sourceGroup: "core" },
    epochId: "22222222-2222-8222-8222-222222222222",
    pointerGeneration: "1",
    sourceCheckpointId: "55555555-5555-8555-8555-555555555555",
    sourceCheckpointGeneration: "2",
    sourceReorgGeneration: "0",
    sourceCheckpointBlockNumber: "200",
    sourceCheckpointBlockHash: BLOCK_HASH,
    sourceCheckpointBlockEvidenceId: "66666666-6666-8666-8666-666666666666",
    token: TOKEN,
    poolKey: {
      poolId: POOL_ID,
      currency0: NATIVE,
      currency1: TOKEN,
      hooks: HOOK,
      fee: 0,
      tickSpacing: 60,
      token0Decimals: 18,
      token1Decimals: 18,
    },
    totalSupply: "1000000000000000000000000000",
    launchBlockNumber: "100",
    launchBlockTimestamp: new Date("2026-07-31T12:00:10.000Z"),
    cursor: cursor(),
    ...overrides,
  };
}

function anchor(block: number): MarketCloseAnchor {
  const hex = block.toString(16).padStart(64, "0");
  return {
    occurrenceId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
    logicalEventId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-9${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
    blockEvidenceId: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-a${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`,
    blockNumber: String(block),
    blockHash: `0x${hex}`,
    blockTimestamp: new Date(TARGET_TIME.getTime() + block * 1_000),
    transactionHash: `0x${(block + 1).toString(16).padStart(64, "0")}`,
    transactionIndex: "1",
    blockGlobalLogIndex: "1",
  };
}

function analytics(overrides: Record<string, unknown> = {}): MarketAnalytics {
  return {
    readPoolSnapshot: vi.fn(
      async (input: { block: { number: string; hash: string } }) => ({
        status: "ready",
        data: snapshot(),
        provenance: {
          deployment: OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
          blockNumber: input.block.number,
          blockHash: input.block.hash,
        },
      }),
    ),
    readHourSeries: vi.fn(
      async (input: {
        from: number;
        block: { number: string; hash: string };
      }) => ({
        status: "ready",
        data: [candle(input.from)],
        provenance: {
          deployment: OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
          blockNumber: input.block.number,
          blockHash: input.block.hash,
        },
      }),
    ),
    readDaySeries: vi.fn(
      async (input: { block: { number: string; hash: string } }) => ({
        status: "ready",
        data: [],
        provenance: {
          deployment: OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
          blockNumber: input.block.number,
          blockHash: input.block.hash,
        },
      }),
    ),
    ...overrides,
  } as unknown as MarketAnalytics;
}

function rpc(): MarketRpc {
  const readChainlinkBlock: MarketRpc["readChainlinkBlock"] = vi.fn(
    async ({ blockNumber, expectedBlockHash }) => ({
      blockNumber,
      blockHash: expectedBlockHash,
      blockTimestamp: new Date(TARGET_TIME),
      rawResult: `0x${"00".repeat(160)}` as const,
      feedRoundId: "1",
      answer: "350000000000",
      feedUpdatedAt: new Date(TARGET_TIME.getTime() - 10_000),
    }),
  );
  return {
    readChainlinkBlock,
  };
}

function store(
  plans: readonly MarketPoolPlan[],
  anchors: readonly MarketCloseAnchor[] = [],
) {
  const committed: PreparedMarketPage[] = [];
  const value: MarketProjectorStore = {
    tryAcquireLease: vi.fn(async () => ({
      holderId: "market-projector:test",
      generation: "1",
      tokenHash: `0x${"ab".repeat(32)}` as const,
      acquiredAt: new Date("2026-07-31T12:00:00.000Z"),
      expiresAt: new Date("2026-07-31T12:01:30.000Z"),
    })),
    releaseLease: vi.fn(async () => undefined),
    loadPlans: vi.fn(async () => plans),
    loadFastLanePlan: vi.fn(async () =>
      plans[0] && anchors[0] ? { plan: plans[0], anchor: anchors[0] } : null,
    ),
    listCloseAnchors: vi.fn(async () => anchors),
    resolveGraphProvider: vi.fn(
      async () => "77777777-7777-8777-8777-777777777777",
    ),
    commit: vi.fn(async (page: PreparedMarketPage) => {
      committed.push(page);
      const lag =
        BigInt(page.plan.sourceCheckpointBlockNumber) -
        BigInt(page.target.blockNumber);
      return {
        status: lag === 0n ? ("caught-up" as const) : ("committed" as const),
        releaseId: page.plan.scope.releaseId,
        poolId: page.plan.poolKey.poolId,
        blockNumber: page.target.blockNumber,
        lagBlocks: lag.toString(),
        closeCount: page.closes.length,
        candleCount: page.candles.length,
        caughtUp: lag === 0n,
      };
    }),
    close: vi.fn(async () => undefined),
  };
  return { value, committed };
}

const graphProvider = {
  redactedIdentity: "uniswap-v4-official",
  deploymentCommitment: GRAPH_COMMITMENT,
  schemaCommitment: `0x${"55".repeat(32)}` as const,
};

function uintWord(value: bigint) {
  return value.toString(16).padStart(64, "0");
}

function chainlinkResult(input: { answer: bigint; updatedAt: bigint }) {
  return `0x${[1n, input.answer, input.updatedAt - 10n, input.updatedAt, 1n]
    .map(uintWord)
    .join("")}`;
}

function rpcFetcher(input: { quicknodeAnswer?: bigint; updatedAt: bigint }) {
  return vi.fn(async (endpoint: string, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as {
      id: number;
      method: string;
      params: unknown[];
    };
    const quicknode = endpoint.includes("quiknode.pro");
    const result =
      request.method === "eth_getBlockByHash"
        ? {
            number: "0xc8",
            hash: BLOCK_HASH,
            timestamp: `0x${BigInt(Math.floor(TARGET_TIME.getTime() / 1_000)).toString(16)}`,
          }
        : chainlinkResult({
            answer: quicknode
              ? (input.quicknodeAnswer ?? 350000000000n)
              : 350000000000n,
            updatedAt: input.updatedAt,
          });
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
    );
  });
}

describe("market projector runtime", () => {
  it("stays disabled without constructing configured dependencies", async () => {
    await expect(runConfiguredMarketProjectorCycle({ env: {} })).resolves.toEqual(
      {
        status: "disabled",
        lagBlocks: "0",
        closeCount: 0,
        candleCount: 0,
        caughtUp: false,
      },
    );
    await expect(
      runConfiguredMarketProjectorCycle({
        env: { PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE: "false" },
      }),
    ).resolves.toEqual({
      status: "disabled",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: false,
    });
  });

  it("fails closed on an ambiguous activation value", async () => {
    await expect(
      runConfiguredMarketProjectorCycle({
        env: { PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE: "yes" },
      }),
    ).rejects.toMatchObject({
      dependency: "config",
      code: "invalid_input",
    });
  });

  it("binds Graph provenance to the exact query documents and parser contract", () => {
    expect(MARKET_GRAPH_QUERY_CONTRACT.analytics).toBe(
      UNISWAP_ANALYTICS_QUERY_CONTRACT,
    );
    expect(graphSchemaCommitment(MARKET_GRAPH_QUERY_CONTRACT)).toBe(
      MARKET_GRAPH_SCHEMA_COMMITMENT,
    );
    expect(MARKET_GRAPH_SCHEMA_COMMITMENT).toBe(
      "0xd0d2087059ca0a7c1e7c633999ff75ea34fcc00d42cee8985a79d0ef76e6813c",
    );
    const parserSource = readFileSync(
      resolve(process.cwd(), UNISWAP_ANALYTICS_QUERY_CONTRACT.parser.sourcePath),
      "utf8",
    );
    expect(keccak256(toBytes(parserSource))).toBe(
      UNISWAP_ANALYTICS_QUERY_CONTRACT.parser.sourceCommitment,
    );

    const changedQuery = {
      ...MARKET_GRAPH_QUERY_CONTRACT,
      analytics: {
        ...UNISWAP_ANALYTICS_QUERY_CONTRACT,
        queries: {
          ...UNISWAP_ANALYTICS_QUERY_CONTRACT.queries,
          poolSnapshot: `${UNISWAP_ANALYTICS_QUERY_CONTRACT.queries.poolSnapshot}\n# changed`,
        },
      },
    };
    const changedParser = {
      ...MARKET_GRAPH_QUERY_CONTRACT,
      analytics: {
        ...UNISWAP_ANALYTICS_QUERY_CONTRACT,
        parser: {
          ...UNISWAP_ANALYTICS_QUERY_CONTRACT.parser,
          contractVersion: "uniswap-analytics-parser-v2",
        },
      },
    };
    expect(graphSchemaCommitment(changedQuery)).not.toBe(
      MARKET_GRAPH_SCHEMA_COMMITMENT,
    );
    expect(graphSchemaCommitment(changedParser)).not.toBe(
      MARKET_GRAPH_SCHEMA_COMMITMENT,
    );
  });

  it("does not open a commit for a fully caught-up source cursor", async () => {
    const caughtUp = plan({
      cursor: cursor({
        blockNumber: "200",
        blockHash: BLOCK_HASH,
        sourceCheckpointGeneration: "2",
      }),
    });
    const fixture = store([caughtUp]);

    await expect(
      runMarketProjectorCycle({
        store: fixture.value,
        analytics: analytics(),
        rpc: rpc(),
        graphProvider,
      }),
    ).resolves.toEqual({
      status: "idle",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: true,
    });
    expect(fixture.value.commit).not.toHaveBeenCalled();
  });

  it("projects only the newest exact close and checkpoint snapshot on the fast lane", async () => {
    const latest = anchor(175);
    const fixture = store([plan()], [latest]);
    const marketAnalytics = analytics();

    await expect(
      runMarketProjectorFastLaneCycle({
        store: fixture.value,
        analytics: marketAnalytics,
        rpc: rpc(),
        graphProvider,
      }),
    ).resolves.toMatchObject({
      status: "caught-up",
      blockNumber: "200",
      closeCount: 1,
      candleCount: 0,
    });

    expect(fixture.value.loadPlans).not.toHaveBeenCalled();
    expect(fixture.value.listCloseAnchors).not.toHaveBeenCalled();
    expect(fixture.committed).toHaveLength(1);
    expect(fixture.committed[0]).toMatchObject({
      fastLane: true,
      target: { blockNumber: "200", blockHash: BLOCK_HASH },
      targetEvidenceId: plan().sourceCheckpointBlockEvidenceId,
      isReorg: false,
      candles: [],
    });
    expect(fixture.committed[0]!.closes).toHaveLength(1);
    expect(fixture.committed[0]!.closes[0]!.anchor).toEqual(latest);
    expect(marketAnalytics.readHourSeries).toHaveBeenCalledTimes(1);
    expect(marketAnalytics.readDaySeries).not.toHaveBeenCalled();
  });

  it("fails closed before providers when the fast-lane cursor lineage is stale", async () => {
    const stale = plan({
      pointerGeneration: "2",
      cursor: cursor({ pointerGeneration: "1" }),
    });
    const fixture = store([stale], [anchor(175)]);
    const marketAnalytics = analytics();
    const marketRpc = rpc();

    await expect(
      runMarketProjectorFastLaneCycle({
        store: fixture.value,
        analytics: marketAnalytics,
        rpc: marketRpc,
        graphProvider,
      }),
    ).rejects.toMatchObject({
      dependency: "postgres",
      code: "validation_failed",
    });

    expect(marketRpc.readChainlinkBlock).not.toHaveBeenCalled();
    expect(marketAnalytics.readPoolSnapshot).not.toHaveBeenCalled();
    expect(fixture.value.commit).not.toHaveBeenCalled();
  });

  it("bounds each page at eight canonical fee blocks", async () => {
    const anchors = Array.from({ length: 8 }, (_, index) =>
      anchor(101 + index),
    );
    const fixture = store([plan()], anchors);

    await runMarketProjectorCycle({
      store: fixture.value,
      analytics: analytics(),
      rpc: rpc(),
      graphProvider,
    });

    expect(fixture.committed).toHaveLength(1);
    expect(fixture.committed[0]).toMatchObject({
      target: { blockNumber: "108", blockHash: anchors[7]!.blockHash },
      targetEvidenceId: anchors[7]!.blockEvidenceId,
      isReorg: false,
    });
    expect(fixture.committed[0]!.closes).toHaveLength(8);
  });

  it("processes a bounded batch instead of one pool per invocation", async () => {
    const plans = Array.from({ length: 5 }, (_, index) =>
      plan({
        cursor: cursor({
          advancedAt: new Date(Date.UTC(2026, 6, 31, 11, index, 0)),
        }),
      }),
    );
    const fixture = store(plans);

    await runMarketProjectorCycle({
      store: fixture.value,
      analytics: analytics(),
      rpc: rpc(),
      graphProvider,
    });

    expect(fixture.committed).toHaveLength(4);
  });

  it("fails before commit when the exact Graph snapshot is pending", async () => {
    const fixture = store([plan()]);
    const pending = analytics({
      readPoolSnapshot: vi.fn(async () => ({
        status: "pending",
        reason: "dependency_unavailable",
      })),
    });

    await expect(
      runMarketProjectorCycle({
        store: fixture.value,
        analytics: pending,
        rpc: rpc(),
        graphProvider,
      }),
    ).rejects.toMatchObject({
      dependency: "uniswap",
      code: "dependency_unavailable",
    });
    expect(fixture.value.commit).not.toHaveBeenCalled();
  });

  it("does not let a failed pool consume the four-success cycle budget", async () => {
    const poolIds = ["10", "20", "30", "40", "50"].map(
      (prefix) => `0x${prefix.repeat(32)}` as const,
    );
    const fixture = store(
      poolIds.map((poolId, index) =>
        plan({
          poolKey: { ...plan().poolKey, poolId },
          cursor: cursor({
            advancedAt: new Date(Date.UTC(2026, 6, 31, 11, index, 0)),
          }),
        }),
      ),
    );
    const marketAnalytics = analytics({
      readPoolSnapshot: vi.fn(
        async (input: {
          poolKey: { poolId: typeof POOL_ID };
          block: { number: string; hash: string };
        }) => {
          if (input.poolKey.poolId === poolIds[0]) {
            return {
              status: "pending" as const,
              reason: "dependency_unavailable" as const,
            };
          }
          return {
            status: "ready" as const,
            data: { ...snapshot(), id: input.poolKey.poolId },
            provenance: {
              deployment: OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
              blockNumber: input.block.number,
              blockHash: input.block.hash,
            },
          };
        },
      ),
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      runMarketProjectorCycle({
        store: fixture.value,
        analytics: marketAnalytics,
        rpc: rpc(),
        graphProvider,
      }),
    ).rejects.toMatchObject({
      dependency: "uniswap",
      code: "dependency_unavailable",
    });

    expect(fixture.committed.map((page) => page.plan.poolKey.poolId)).toEqual(
      poolIds.slice(1),
    );
    expect(warning).toHaveBeenCalledWith(
      "Market projector skipped one pool",
      expect.objectContaining({ poolId: poolIds[0] }),
    );
    warning.mockRestore();
  });

  it("rescans the current block when a later source checkpoint arrives", async () => {
    const currentHash = cursor().blockHash;
    const laterAnchor = {
      ...anchor(100),
      blockHash: currentHash,
      blockEvidenceId: "66666666-6666-8666-8666-666666666666",
    } satisfies MarketCloseAnchor;
    const sameBlock = plan({
      sourceCheckpointBlockNumber: "100",
      sourceCheckpointBlockHash: currentHash,
      cursor: cursor({
        blockNumber: "100",
        blockHash: currentHash,
        sourceCheckpointGeneration: "1",
      }),
    });
    const fixture = store([sameBlock], [laterAnchor]);

    await runMarketProjectorCycle({
      store: fixture.value,
      analytics: analytics(),
      rpc: rpc(),
      graphProvider,
    });

    expect(fixture.value.listCloseAnchors).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlockExclusive: "99",
        toBlockInclusive: "100",
      }),
    );
    expect(fixture.committed).toHaveLength(1);
    expect(fixture.committed[0]!.closes).toHaveLength(1);
  });

  it("persists exact interval fees and transaction counts for candles", async () => {
    const calls: Array<{ text: string; values: readonly unknown[] }> = [];
    const closingId = "99999999-9999-8999-8999-999999999999";
    const globalId = "aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa";
    const transaction: PostgresTransaction = {
      async query<Row extends Record<string, unknown>>(
        text: string,
        values: readonly PostgresParameter[] = [],
      ) {
        calls.push({ text, values });
        if (text === "select session_user::text as session_user") {
          return [
            { session_user: "programmable_reconciler_login" },
          ] as unknown as readonly Row[];
        }
        if (
          text ===
          "select session_user::text as session_user, current_role::text as current_role"
        ) {
          return [
            {
              session_user: "programmable_reconciler_login",
              current_role: "programmable_reconciler",
            },
          ] as unknown as readonly Row[];
        }
        if (text.includes("get_market_global_snapshot_v1")) {
          return [{ id: globalId }] as unknown as readonly Row[];
        }
        if (text.includes("resolve_market_candle_close_v1")) {
          return [{ id: closingId }] as unknown as readonly Row[];
        }
        if (text.includes("try_acquire_market_projector_runtime_lease_v1")) {
          return [
            {
              acquired: true,
              lease_generation: "1",
              acquired_at: "2026-07-31T12:00:00.000Z",
              expires_at: "2026-07-31T12:01:30.000Z",
            },
          ] as unknown as readonly Row[];
        }
        if (text.includes("assert_market_projector_runtime_lease_v1")) {
          return [{ valid: true }] as unknown as readonly Row[];
        }
        if (text.includes("try_lock_market_projector_pool_v1")) {
          return [{ locked: true }] as unknown as readonly Row[];
        }
        if (text.includes("assert_market_projector_fast_lane_v1")) {
          return [{ valid: true }] as unknown as readonly Row[];
        }
        if (text.includes("release_market_projector_runtime_lease_v1")) {
          return [{ released: true }] as unknown as readonly Row[];
        }
        return [];
      },
    };
    const executor: PostgresExecutor = {
      transaction: async (work) => work(transaction),
      close: async () => undefined,
    };
    const postgresStore = createPostgresMarketProjectorStore({
      executor,
      sourceProjectorVersion: "projector-v1",
      rpcProviders: [
        {
          identity: "rpc-a",
          endpointCommitment: `0x${"aa".repeat(32)}`,
          endpointOriginCommitment: `0x${"ab".repeat(32)}`,
        },
        {
          identity: "rpc-b",
          endpointCommitment: `0x${"ba".repeat(32)}`,
          endpointOriginCommitment: `0x${"bb".repeat(32)}`,
        },
      ],
      uuid: vi
        .fn()
        .mockReturnValueOnce("11111111-1111-4111-8111-111111111111")
        .mockReturnValueOnce("22222222-2222-4222-8222-222222222222"),
      now: () => new Date("2026-07-31T12:00:00.000Z"),
    });
    const marketPlan = plan();
    const interval = {
      ...candle(Math.floor(Date.parse("2026-07-31T11:00:00.000Z") / 1_000)),
      feesUsd: "7.5",
      transactionCount: "9",
    };
    const page: PreparedMarketPage = {
      plan: marketPlan,
      graphProviderId: "77777777-7777-8777-8777-777777777777",
      targetEvidenceId: marketPlan.sourceCheckpointBlockEvidenceId,
      target: await rpc().readChainlinkBlock({
        blockNumber: marketPlan.sourceCheckpointBlockNumber,
        expectedBlockHash: marketPlan.sourceCheckpointBlockHash,
      }),
      targetSnapshot: snapshot(),
      targetToken0Price: "1",
      targetToken1Price: "1",
      closes: [],
      candles: [
        {
          interval: "hour",
          periodStart: new Date("2026-07-31T11:00:00.000Z"),
          periodEnd: new Date("2026-07-31T12:00:00.000Z"),
          data: interval,
        },
      ],
      nextHourCoverageEnd: new Date("2026-07-31T12:00:00.000Z"),
      nextDayCoverageEnd: null,
      providerCursor: "block:200:2222222222222222",
      pageCommitment: `0x${"cc".repeat(32)}`,
      isReorg: false,
    };

    const lease = await postgresStore.tryAcquireLease();
    expect(lease).not.toBeNull();
    await postgresStore.commit(page);
    await postgresStore.releaseLease(lease!);

    const detail = calls.find((call) =>
      call.text.includes("append_market_candle_details_v2"),
    );
    expect(detail?.values[5]).toBe("7.5");
    expect(detail?.values[6]).toBe("9");
    expect(
      calls.filter(
        ({ text }) => text === "select session_user::text as session_user",
      ),
    ).toHaveLength(3);
    expect(
      calls.filter(
        ({ text }) => text === "set local role programmable_reconciler",
      ),
    ).toHaveLength(3);
    expect(
      calls.filter(
        ({ text }) =>
          text ===
          "select session_user::text as session_user, current_role::text as current_role",
      ),
    ).toHaveLength(3);

    const fastLaneStart = calls.length;
    const exactAnchor: MarketCloseAnchor = {
      ...anchor(200),
      blockEvidenceId: marketPlan.sourceCheckpointBlockEvidenceId,
      blockHash: marketPlan.sourceCheckpointBlockHash,
      blockTimestamp: new Date(TARGET_TIME),
    };
    await postgresStore.commit({
      ...page,
      pageCommitment: `0x${"dd".repeat(32)}`,
      closes: [
        {
          anchor: exactAnchor,
          global: page.target,
          snapshot: page.targetSnapshot,
          token0Price: "1",
          token1Price: "1",
          feesUsd: "0.2",
        },
      ],
      candles: [],
      fastLane: true,
    });
    const fastLaneCalls = calls.slice(fastLaneStart);
    expect(
      fastLaneCalls.some(({ text }) =>
        text.includes("assert_market_projector_fast_lane_v1"),
      ),
    ).toBe(true);
    expect(
      fastLaneCalls.some(({ text }) =>
        text.includes("assert_market_projector_runtime_lease_v1"),
      ),
    ).toBe(false);
    expect(
      fastLaneCalls.some(({ text }) =>
        text.includes("advance_market_projector_cursor_v1"),
      ),
    ).toBe(false);
    expect(
      fastLaneCalls.some(({ text }) =>
        text.includes("append_market_block_close_v2"),
      ),
    ).toBe(true);
  });

  it("rebuilds from launch when the source reorg generation advances", async () => {
    const reorg = plan({
      pointerGeneration: "2",
      sourceReorgGeneration: "1",
      launchBlockTimestamp: new Date("2026-07-31T10:00:10.000Z"),
      cursor: cursor({
        pointerGeneration: "1",
        sourceReorgGeneration: "0",
        hourCoverageEnd: new Date("2026-07-31T12:00:00.000Z"),
      }),
    });
    const fixture = store([reorg]);
    const marketAnalytics = analytics();

    await runMarketProjectorCycle({
      store: fixture.value,
      analytics: marketAnalytics,
      rpc: rpc(),
      graphProvider,
    });

    expect(fixture.committed[0]!.isReorg).toBe(true);
    expect(fixture.value.listCloseAnchors).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlockExclusive: "99" }),
    );
    expect(marketAnalytics.readHourSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        from: Math.floor(
          new Date("2026-07-31T10:00:00.000Z").getTime() / 1_000,
        ),
        toExclusive: Math.floor(
          new Date("2026-07-31T12:00:00.000Z").getTime() / 1_000,
        ),
      }),
    );
  });

  it("rebuilds a caught-up pool when its current release epoch changes", async () => {
    const nextEpoch = plan({
      epochId: "88888888-8888-8888-8888-888888888888",
      cursor: cursor({ blockNumber: "200", blockHash: BLOCK_HASH }),
    });
    const fixture = store([nextEpoch]);

    await runMarketProjectorCycle({
      store: fixture.value,
      analytics: analytics(),
      rpc: rpc(),
      graphProvider,
    });

    expect(fixture.committed).toHaveLength(1);
    expect(fixture.committed[0]!.isReorg).toBe(true);
  });

  it("rejects disagreement between the independent RPC results", async () => {
    const fetcher = rpcFetcher({
      quicknodeAnswer: 350000000001n,
      updatedAt: BigInt(Math.floor(TARGET_TIME.getTime() / 1_000) - 10),
    });
    const reader = createDualRpcMarketReader({
      endpoints: [
        "https://eth-mainnet.g.alchemy.com/v2/abcdefgh",
        "https://blue.quiknode.pro/abcdefgh/",
      ],
      fetcher,
    });

    await expect(
      reader.readChainlinkBlock({
        blockNumber: "200",
        expectedBlockHash: BLOCK_HASH,
      }),
    ).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation: "provider-mismatch" },
    });
    const requests = fetcher.mock.calls.map(
      (call) =>
        JSON.parse(String(call[1]?.body)) as {
          method: string;
          params: unknown[];
        },
    );
    expect(
      requests
        .filter((request) => request.method === "eth_getBlockByHash")
        .map(({ method, params }) => ({ method, params })),
    ).toEqual([
      { method: "eth_getBlockByHash", params: [BLOCK_HASH, false] },
      { method: "eth_getBlockByHash", params: [BLOCK_HASH, false] },
    ]);
    expect(requests.filter((request) => request.method === "eth_call")).toEqual(
      [
        expect.objectContaining({
          params: [
            expect.any(Object),
            { blockHash: BLOCK_HASH, requireCanonical: true },
          ],
        }),
        expect.objectContaining({
          params: [
            expect.any(Object),
            { blockHash: BLOCK_HASH, requireCanonical: true },
          ],
        }),
      ],
    );
  });

  it("rejects a stale Chainlink answer at the exact historical block", async () => {
    const reader = createDualRpcMarketReader({
      endpoints: [
        "https://eth-mainnet.g.alchemy.com/v2/abcdefgh",
        "https://blue.quiknode.pro/abcdefgh/",
      ],
      fetcher: rpcFetcher({
        updatedAt: BigInt(Math.floor(TARGET_TIME.getTime() / 1_000) - 3_601),
      }),
    });

    await expect(
      reader.readChainlinkBlock({
        blockNumber: "200",
        expectedBlockHash: BLOCK_HASH,
      }),
    ).rejects.toMatchObject({
      dependency: "rpc",
      code: "validation_failed",
      safeMetadata: { operation: "chainlink-freshness" },
    });
  });
});
