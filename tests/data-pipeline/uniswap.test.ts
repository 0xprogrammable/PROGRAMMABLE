import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
  OFFICIAL_V4_SUBGRAPH_ID,
  createUniswapAnalyticsClient,
  priceRatiosFromSqrtPriceX96,
} from "../../lib/data-pipeline/uniswap";

const POOL_ID =
  "0x1a1d489ab64459031dd616d24b823600e804f04164fd47f3c158a6338c77fc42";
const TOKEN = "0x2222222222222222222222222222222222222222";
const HOOK = "0x3333333333333333333333333333333333333333";
const NATIVE = "0x0000000000000000000000000000000000000000";
const BLOCK_HASH = `0x${"44".repeat(32)}`;

const POOL_KEY = {
  poolId: POOL_ID,
  currency0: NATIVE,
  currency1: TOKEN,
  fee: 0,
  tickSpacing: 60,
  hooks: HOOK,
  token0Decimals: 6,
  token1Decimals: 18,
} as const;

const BLOCK = {
  number: "25650000",
  hash: BLOCK_HASH,
} as const;

function meta(overrides: Record<string, unknown> = {}) {
  return {
    deployment: OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
    hasIndexingErrors: false,
    block: {
      number: BLOCK.number,
      hash: BLOCK.hash,
    },
    ...overrides,
  };
}

function pool(overrides: Record<string, unknown> = {}) {
  return {
    id: POOL_ID,
    createdAtTimestamp: "1785480000",
    createdAtBlockNumber: "25640000",
    token0: { id: NATIVE, decimals: "6" },
    token1: { id: TOKEN, decimals: "18" },
    hooks: HOOK,
    feeTier: "0",
    tickSpacing: "60",
    liquidity: "340282366920938463463374607431768211455",
    sqrtPrice: "79228162514264337593543950336",
    tick: "0",
    txCount: "42",
    volumeToken0: "12345678901234567890.123456",
    volumeToken1: "0.000000000000000001",
    volumeUSD: "999999999999999999999999.999999999999999999",
    totalValueLockedToken0: "1000000.1",
    totalValueLockedToken1: "2000000.2",
    totalValueLockedUSD: "3000000.3",
    ...overrides,
  };
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function swap(index: number, timestamp = 100) {
  const id = `swap-${index.toString().padStart(4, "0")}`;
  const firstPageBoundaryFixture = index === 0;
  return {
    id,
    transaction: {
      id: `0x${index.toString(16).padStart(64, "0")}`,
      blockNumber: String(25_649_000 + index),
      timestamp: String(timestamp),
    },
    timestamp: String(timestamp),
    pool: { id: POOL_ID },
    sender: NATIVE,
    origin: TOKEN,
    amount0: firstPageBoundaryFixture
      ? "-12345678901234567890.123456"
      : "-1",
    amount1: firstPageBoundaryFixture ? "0.000000000000000001" : "1",
    amountUSD: "1.25",
    sqrtPriceX96: "79228162514264337593543950336",
    tick: "0",
    logIndex: String(index),
  };
}

function candle(id: string, time: number) {
  return {
    id,
    periodStartUnix: time,
    pool: { id: POOL_ID },
    liquidity: "100000000000000000000000000000000000000",
    sqrtPrice: "79228162514264337593543950336",
    token0Price: "1000000000000",
    token1Price: "0.000000000001",
    tick: "0",
    tvlUSD: "30.5",
    volumeToken0: "10.1",
    volumeToken1: "20.2",
    volumeUSD: "30.3",
    feesUSD: "0.1",
    txCount: "2",
    open: "1",
    high: "2",
    low: "0.5",
    close: "1.5",
  };
}

describe("pinned Uniswap v4 analytics adapter", () => {
  it("uses the fixed subgraph and exact block Pool contract", async () => {
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        `https://gateway.thegraph.com/api/subgraphs/id/${OFFICIAL_V4_SUBGRAPH_ID}`,
      );
      expect(url).not.toContain("graph-secret");
      expect(init?.headers).toMatchObject({
        authorization: "Bearer graph-secret",
        "content-type": "application/json",
      });
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(request.query).toContain("query ProgrammablePoolSnapshot");
      expect(request.query).toContain("subgraphError: deny");
      expect(request.query).toContain("block: { number: $block }");
      expect(request.variables).toEqual({
        poolId: POOL_ID,
        block: 25_650_000,
      });
      return json({ data: { _meta: meta(), pool: pool() } });
    });
    const client = createUniswapAnalyticsClient({
      gatewayBaseUrl: "https://gateway.thegraph.com",
      apiKey: "graph-secret",
      fetcher,
    });

    const result = await client.readPoolSnapshot({
      poolKey: POOL_KEY,
      block: BLOCK,
    });

    expect(result).toMatchObject({
      status: "ready",
      provenance: {
        deployment: OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
        blockNumber: BLOCK.number,
        blockHash: BLOCK.hash,
      },
      data: {
        id: POOL_ID,
        token0: { id: NATIVE, decimals: 6 },
        token1: { id: TOKEN, decimals: 18 },
        liquidity: "340282366920938463463374607431768211455",
        sqrtPriceX96: "79228162514264337593543950336",
        marketVolumeToken0: "12345678901234567890.123456",
        marketVolumeToken1: "0.000000000000000001",
        marketVolumeUsd: "999999999999999999999999.999999999999999999",
      },
    });
    expect(result).not.toHaveProperty("data.hookGrossVolume");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["deployment", { deployment: "QmWrong" }],
    ["indexing status", { hasIndexingErrors: true }],
    [
      "block number",
      { block: { number: "25649999", hash: BLOCK.hash } },
    ],
    [
      "block hash",
      { block: { number: BLOCK.number, hash: `0x${"99".repeat(32)}` } },
    ],
  ])("returns market pending on %s mismatch", async (_name, override) => {
    const client = createUniswapAnalyticsClient({
      gatewayBaseUrl: "https://gateway.thegraph.com",
      apiKey: "graph-secret",
      fetcher: async () =>
        json({ data: { _meta: meta(override), pool: pool() } }),
    });

    await expect(
      client.readPoolSnapshot({ poolKey: POOL_KEY, block: BLOCK }),
    ).resolves.toEqual({
      status: "pending",
      reason: "validation_failed",
    });
  });

  it("rejects PoolKey and returned pool-id mismatches without substituting a pool", async () => {
    const client = createUniswapAnalyticsClient({
      gatewayBaseUrl: "https://gateway.thegraph.com",
      apiKey: "graph-secret",
      fetcher: async () =>
        json({
          data: {
            _meta: meta(),
            pool: pool({ id: `0x${"99".repeat(32)}` }),
          },
        }),
    });
    await expect(
      client.readPoolSnapshot({ poolKey: POOL_KEY, block: BLOCK }),
    ).resolves.toEqual({
      status: "pending",
      reason: "validation_failed",
    });

    await expect(
      client.readPoolSnapshot({
        poolKey: { ...POOL_KEY, tickSpacing: 61 },
        block: BLOCK,
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
      countsTowardCircuit: false,
    });
  });

  it("paginates swaps in exact 250-row pages with id_gt and half-open windows", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      expect(request.query).toContain("query ProgrammableSwapPage");
      expect(request.query).toContain("first: 250");
      expect(request.query).toContain("orderBy: id");
      expect(request.query).toContain("id_gt: $cursor");
      expect(request.query).toContain("timestamp_gte: $from");
      expect(request.query).toContain("timestamp_lt: $toExclusive");
      expect(request.query).toContain("block: { hash: $blockHash }");
      expect(request.query).toContain("subgraphError: deny");
      const cursor = String(request.variables.cursor);
      if (cursor === "") {
        expect(request.variables).toMatchObject({
          poolId: POOL_ID,
          blockHash: BLOCK.hash,
          from: "100",
          toExclusive: "200",
        });
        return json({
          data: {
            _meta: meta(),
            swaps: Array.from({ length: 250 }, (_, index) => swap(index, 100)),
          },
        });
      }
      expect(cursor).toBe("swap-0249");
      return json({
        data: { _meta: meta(), swaps: [swap(250, 199)] },
      });
    });
    const client = createUniswapAnalyticsClient({
      gatewayBaseUrl: "https://gateway.thegraph.com",
      apiKey: "graph-secret",
      fetcher,
    });

    const result = await client.readSwaps({
      poolKey: POOL_KEY,
      block: BLOCK,
      from: "100",
      toExclusive: "200",
    });

    expect(result).toMatchObject({ status: "ready" });
    if (result.status !== "ready") throw new Error("expected ready");
    expect(result.data).toHaveLength(251);
    expect(result.data[0]).toMatchObject({
      amount0: "-12345678901234567890.123456",
      amount1: "0.000000000000000001",
      sqrtPriceX96: "79228162514264337593543950336",
      marketAmountUsd: "1.25",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("queries hour and day series with the pinned fields and half-open windows", async () => {
    const queries: string[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      queries.push(request.query);
      expect(request.variables).toMatchObject({
        poolId: POOL_ID,
        blockHash: BLOCK.hash,
        from: 100,
        toExclusive: 200,
        cursor: "",
      });
      if (request.query.includes("PoolHourSeries")) {
        return json({
          data: {
            _meta: meta(),
            poolHourDatas: [candle("hour-1", 100)],
          },
        });
      }
      return json({
        data: {
          _meta: meta(),
          poolDayDatas: [
            { ...candle("day-1", 100), date: 100, periodStartUnix: undefined },
          ],
        },
      });
    });
    const client = createUniswapAnalyticsClient({
      gatewayBaseUrl: "https://gateway.thegraph.com",
      apiKey: "graph-secret",
      fetcher,
    });

    await expect(
      client.readHourSeries({
        poolKey: POOL_KEY,
        block: BLOCK,
        from: 100,
        toExclusive: 200,
      }),
    ).resolves.toMatchObject({ status: "ready", data: [{ feesUsd: "0.1" }] });
    await expect(
      client.readDaySeries({
        poolKey: POOL_KEY,
        block: BLOCK,
        from: 100,
        toExclusive: 200,
      }),
    ).resolves.toMatchObject({ status: "ready", data: [{ feesUsd: "0.1" }] });
    expect(queries[0]).toContain("periodStartUnix_lt: $toExclusive");
    expect(queries[1]).toContain("date_lt: $toExclusive");
    expect(queries.every((query) => query.includes("feesUSD"))).toBe(true);
  });

  it("returns pending for GraphQL, body, and bounded-page failures", async () => {
    const graphqlClient = createUniswapAnalyticsClient({
      gatewayBaseUrl: "https://gateway.thegraph.com",
      apiKey: "graph-secret",
      fetcher: async () =>
        json({ data: null, errors: [{ message: "indexing failed" }] }),
    });
    await expect(
      graphqlClient.readPoolSnapshot({ poolKey: POOL_KEY, block: BLOCK }),
    ).resolves.toEqual({ status: "pending", reason: "graphql_error" });

    const bodyClient = createUniswapAnalyticsClient({
      gatewayBaseUrl: "https://gateway.thegraph.com",
      apiKey: "graph-secret",
      fetcher: async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(128 * 1024 + 1) },
        }),
    });
    await expect(
      bodyClient.readPoolSnapshot({ poolKey: POOL_KEY, block: BLOCK }),
    ).resolves.toEqual({ status: "pending", reason: "response_oversize" });

    const pageClient = createUniswapAnalyticsClient({
      gatewayBaseUrl: "https://gateway.thegraph.com",
      apiKey: "graph-secret",
      limits: { maximumPages: 1, maximumEntities: 250 },
      fetcher: async () =>
        json({
          data: {
            _meta: meta(),
            swaps: Array.from({ length: 250 }, (_, index) => swap(index, 100)),
          },
        }),
    });
    await expect(
      pageClient.readSwaps({
        poolKey: POOL_KEY,
        block: BLOCK,
        from: "100",
        toExclusive: "200",
      }),
    ).resolves.toEqual({
      status: "pending",
      reason: "response_oversize",
    });
  });

  it("handles token ordering and decimals with exact bigint price ratios", () => {
    expect(
      priceRatiosFromSqrtPriceX96({
        sqrtPriceX96: "79228162514264337593543950336",
        token0Decimals: 6,
        token1Decimals: 18,
      }),
    ).toEqual({
      token1PerToken0: {
        numerator: "1",
        denominator: "1000000000000",
      },
      token0PerToken1: {
        numerator: "1000000000000",
        denominator: "1",
      },
    });
  });
});
