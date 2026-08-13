import { describe, expect, it, vi } from "vitest";
import { parseEther } from "viem";

vi.mock("server-only", () => ({}));

import type { LauncherToken } from "../lib/tokens";
import type { ExplorePage } from "../lib/onchain/types";
import { computeOfficialV4PoolId } from "../lib/uniswap/liquidity-launcher-sdk";
import {
  enrichExplorePageWithOfficialV4Subgraph,
  parseOfficialV4SubgraphResponse,
  readOfficialV4LiquidityEvidence,
  readOfficialV4LiquidityEvidenceSnapshot,
} from "../lib/onchain/uniswap-v4-subgraph";

const POOL_ID =
  "0x1a1d489ab64459031dd616d24b823600e804f04164fd47f3c158a6338c77fc42" as const;
const TOKEN_ADDRESS = "0x2222222222222222222222222222222222222222" as const;
const HOOK_ADDRESS = "0x3333333333333333333333333333333333333333" as const;
const OFFICIAL_DEPLOYMENT = "QmZsgJLiLQKpb8hxTmQ5LWyrFVvfWzVaL4WK8dfFBn7EeK";
const OFFICIAL_ENDPOINT =
  "https://gateway.thegraph.com/api/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G";
const REFERENCE_BLOCK_NUMBER = "25630000";
const REFERENCE_BLOCK_HASH = `0x${"44".repeat(32)}` as const;

function canonicalToken(overrides: Partial<LauncherToken> = {}): LauncherToken {
  return {
    id: "1:token",
    name: "Canonical",
    symbol: "CAN",
    tokenAddress: TOKEN_ADDRESS,
    hookAddress: HOOK_ADDRESS,
    poolId: POOL_ID,
    launchedAt: "2026-07-29T00:00:00.000Z",
    grossVolumeWei: "900",
    grossVolumeEth: "0.0000000000000009",
    activeLiquidity: "700",
    tokenDecimals: 18,
    totalSwapFeeBps: 100,
    launchModel: "classic",
    liquidityPath: "meme",
    ...overrides,
  };
}

function page(tokens = [canonicalToken()]): ExplorePage {
  return {
    status: "ready",
    tokens,
    page: 1,
    pageSize: 6,
    total: tokens.length,
    totalPages: 1,
    sort: "market-cap",
    query: "",
    snapshot: {
      chainId: 1,
      blockNumber: "25630000",
      blockHash: `0x${"44".repeat(32)}`,
      confirmations: 12,
    },
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

function officialResponse(
  indexedBlockNumber: number | string = 25_629_999,
  indexedBlockTimestamp: number | string = 1_786_576_740,
) {
  return {
    data: {
      _meta: {
        deployment: OFFICIAL_DEPLOYMENT,
        block: {
          number: indexedBlockNumber,
          hash: `0x${"55".repeat(32)}`,
          timestamp: indexedBlockTimestamp,
        },
        hasIndexingErrors: false,
      },
      pools: [
        {
          id: POOL_ID,
          token0: {
            id: "0x0000000000000000000000000000000000000000",
            decimals: "18",
          },
          token1: { id: TOKEN_ADDRESS, decimals: "18" },
          hooks: HOOK_ADDRESS,
          feeTier: "0",
          tickSpacing: "60",
          liquidity: "123456789",
          sqrtPrice: "79228162514264337593543950336",
          tick: "-120",
          txCount: "42",
          volumeUSD: "1234.56789012345678912345",
          totalValueLockedToken0: "0.0141",
          totalValueLockedToken1: "32100.25",
          totalValueLockedUSD: "98.7",
        },
      ],
    },
  };
}

function exactOfficialResponse(
  indexedBlockTimestamp: number | string = 1_786_576_740,
) {
  const response = officialResponse(
    REFERENCE_BLOCK_NUMBER,
    indexedBlockTimestamp,
  );
  response.data._meta.block.hash = REFERENCE_BLOCK_HASH;
  return response;
}

function officialPool(input: {
  token0: `0x${string}`;
  token1: `0x${string}`;
  hooks: `0x${string}`;
}) {
  return {
    id: computeOfficialV4PoolId({
      currency0: input.token0,
      currency1: input.token1,
      fee: 0,
      tickSpacing: 60,
      hooks: input.hooks,
    }),
    token0: { id: input.token0, decimals: "18" },
    token1: { id: input.token1, decimals: "18" },
    hooks: input.hooks,
    feeTier: "0",
    tickSpacing: "60",
    liquidity: "123456789",
    sqrtPrice: "79228162514264337593543950336",
    tick: "-120",
    txCount: "42",
    volumeUSD: "1234.56789012345678912345",
    totalValueLockedToken0: "0.0141",
    totalValueLockedToken1: "32100.25",
    totalValueLockedUSD: "98.7",
  };
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function batchedTokensAndPools(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const tokenAddress = `0x${(index + 1).toString(16).padStart(40, "0")}` as const;
    const pool = officialPool({
      token0: "0x0000000000000000000000000000000000000000",
      token1: tokenAddress,
      hooks: HOOK_ADDRESS,
    });
    pool.totalValueLockedUSD = "10000";
    return {
      token: canonicalToken({
        id: `1:batch-${index}`,
        tokenAddress,
        poolId: pool.id,
      }),
      pool,
    };
  });
}

describe("official Uniswap v4 subgraph adapter", () => {
  it("adds bounded pool analytics without replacing canonical launch data", async () => {
    const source = page();
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { first: number; poolIds: string[] };
      };
      expect(request.query).toContain("deployment");
      expect(request.query).toContain("feeTier");
      expect(request.query).toContain("sqrtPrice");
      expect(request.query).toContain("tickSpacing");
      expect(request.query).toContain("timestamp");
      expect(request.query).toContain("totalValueLockedToken0");
      expect(request.query).not.toContain("isExternalLiquidity");
      expect(request.variables).toEqual({
        first: 24,
        poolIds: [POOL_ID],
      });
      expect(init?.headers).toMatchObject({
        authorization: "Bearer graph-secret",
        "content-type": "application/json",
      });
      return jsonResponse(officialResponse());
    });

    const enriched = await enrichExplorePageWithOfficialV4Subgraph(source, {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher,
    });

    expect(enriched.tokens).toHaveLength(1);
    expect(enriched.tokens[0]).toMatchObject({
      id: "1:token",
      name: "Canonical",
      tokenAddress: TOKEN_ADDRESS,
      hookAddress: HOOK_ADDRESS,
      poolId: POOL_ID,
      grossVolumeWei: "900",
      activeLiquidity: "700",
      uniswapV4Pool: {
        source: "official-uniswap-v4-subgraph",
        indexedBlockNumber: "25629999",
        indexedBlockHash: `0x${"55".repeat(32)}`,
        volumeUsdWad: "1234567890123456789123",
        tvlUsdWad: "98700000000000000000",
        transactionCount: "42",
        liquidity: "123456789",
        sqrtPriceX96: "79228162514264337593543950336",
        tick: -120,
        feeTierPips: "0",
      },
    });
    expect(enriched.tokens[0]?.grossVolumeWei).toBe("900");
    expect(enriched.tokens[0]?.activeLiquidity).toBe("700");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns current exact-pool TVL with independent provenance", async () => {
    const response = officialResponse();
    response.data.pools[0].totalValueLockedUSD = "12500.5";
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: {
          first: number;
          poolIds: string[];
        };
      };
      expect(request.query).not.toContain("$blockNumber");
      expect(request.variables).toEqual({
        first: 24,
        poolIds: [POOL_ID],
      });
      return jsonResponse(response);
    });
    const result = await readOfficialV4LiquidityEvidenceSnapshot(
      {
        tokens: [canonicalToken()],
        referenceHead: {
          chainId: 1,
          blockNumber: REFERENCE_BLOCK_NUMBER,
          blockHash: REFERENCE_BLOCK_HASH,
        },
        now: new Date("2026-08-12T23:21:00.000Z"),
      },
      {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher,
      },
    );
    const { evidence } = result;

    expect(result.snapshot).toEqual({
      chainId: 1,
      blockNumber: "25629999",
      blockHash: `0x${"55".repeat(32)}`,
    });

    expect(evidence).toEqual([
      {
        source: "official-uniswap-v4-subgraph",
        identity: {
          chainId: "1",
          protocol: "uniswap_v4",
          poolId: POOL_ID,
          tokenAddress: TOKEN_ADDRESS,
          quoteAddress: "0x0000000000000000000000000000000000000000",
        },
        valueBasis: "official-subgraph-pool-tvl-usd",
        tvlUsdWad: "12500500000000000000000",
        reportedPoolBalances: {
          token0: {
            address: "0x0000000000000000000000000000000000000000",
            decimals: 18,
            amountDecimal: "0.0141",
          },
          token1: {
            address: TOKEN_ADDRESS,
            decimals: 18,
            amountDecimal: "32100.25",
          },
        },
        freshness: "current",
        provenance: {
          subgraphId: "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G",
          deployment: OFFICIAL_DEPLOYMENT,
          indexedBlockNumber: "25629999",
          indexedBlockHash: `0x${"55".repeat(32)}`,
          indexedBlockTimestamp: "1786576740",
          indexedBlockTime: "2026-08-12T23:19:00.000Z",
          referenceHeadBlockNumber: REFERENCE_BLOCK_NUMBER,
          referenceHeadBlockHash: REFERENCE_BLOCK_HASH,
          lagBlocks: "1",
        },
      },
    ]);
  });

  it("propagates a caller deadline into the active subgraph fetch", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | null | undefined;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      observedSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          { once: true },
        );
      });
    });
    const read = readOfficialV4LiquidityEvidence(
      {
        tokens: [canonicalToken()],
        referenceHead: {
          chainId: 1,
          blockNumber: REFERENCE_BLOCK_NUMBER,
          blockHash: REFERENCE_BLOCK_HASH,
        },
      },
      {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher,
        signal: controller.signal,
      },
    );

    await vi.waitFor(() => expect(observedSignal).toBeInstanceOf(AbortSignal));
    controller.abort(new Error("current evidence deadline"));

    await expect(read).rejects.toThrow("current evidence deadline");
    expect(observedSignal?.aborted).toBe(true);
  });

  it("pins an ahead latest pool read to the confirmed RPC reference head", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { blockNumber?: number };
      };
      const response = request.variables.blockNumber === undefined
        ? officialResponse(25_630_012)
        : exactOfficialResponse();
      response.data.pools[0].totalValueLockedUSD = "10000";
      return jsonResponse(response);
    });

    const result = await readOfficialV4LiquidityEvidenceSnapshot(
      {
        tokens: [canonicalToken()],
        referenceHead: {
          chainId: 1,
          blockNumber: REFERENCE_BLOCK_NUMBER,
          blockHash: REFERENCE_BLOCK_HASH,
        },
        now: new Date("2026-08-12T23:21:00.000Z"),
      },
      {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher,
      },
    );

    expect(result.snapshot).toEqual({
      chainId: 1,
      blockNumber: REFERENCE_BLOCK_NUMBER,
      blockHash: REFERENCE_BLOCK_HASH,
    });
    expect(result.evidence).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      fetcher.mock.calls.map(
        ([, init]) => JSON.parse(String(init?.body)).variables.blockNumber,
      ),
    ).toEqual([undefined, 25_630_000]);

    const mismatchFetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        variables: { blockNumber?: number };
      };
      return jsonResponse(
        request.variables.blockNumber === undefined
          ? officialResponse(25_630_012)
          : officialResponse(25_630_000),
      );
    });
    await expect(
      readOfficialV4LiquidityEvidenceSnapshot(
        {
          tokens: [canonicalToken()],
          referenceHead: {
            chainId: 1,
            blockNumber: REFERENCE_BLOCK_NUMBER,
            blockHash: REFERENCE_BLOCK_HASH,
          },
          now: new Date("2026-08-12T23:21:00.000Z"),
        },
        {
          apiKey: "graph-secret",
          endpoint: OFFICIAL_ENDPOINT,
          fetcher: mismatchFetcher,
        },
      ),
    ).rejects.toMatchObject({ code: "coverage-incomplete" });
    expect(mismatchFetcher).toHaveBeenCalledTimes(2);
  });

  it("establishes and replays a Graph snapshot without liquidity pools", async () => {
    const meta = officialResponse().data._meta;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { blockNumber?: number };
      };
      expect(request.query).not.toContain("pools(");
      if (fetcher.mock.calls.length === 1) {
        expect(request.query).not.toContain("$blockNumber");
        expect(request.variables).toEqual({});
      } else {
        expect(request.query).toContain(
          "_meta(block: { number: $blockNumber })",
        );
        expect(request.variables).toEqual({ blockNumber: 25_629_999 });
      }
      return jsonResponse({ data: { _meta: meta } });
    });
    const options = {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher,
    };
    const first = await readOfficialV4LiquidityEvidenceSnapshot(
      {
        tokens: [],
        referenceHead: {
          chainId: 1,
          blockNumber: REFERENCE_BLOCK_NUMBER,
          blockHash: REFERENCE_BLOCK_HASH,
        },
        now: new Date("2026-08-12T23:21:00.000Z"),
      },
      options,
    );
    expect(first).toEqual({
      evidence: [],
      snapshot: {
        chainId: 1,
        blockNumber: "25629999",
        blockHash: `0x${"55".repeat(32)}`,
      },
    });

    await expect(
      readOfficialV4LiquidityEvidenceSnapshot(
        {
          tokens: [],
          referenceHead: {
            chainId: 1,
            blockNumber: REFERENCE_BLOCK_NUMBER,
            blockHash: REFERENCE_BLOCK_HASH,
          },
          liquiditySnapshot: first.snapshot,
          now: new Date("2026-08-12T23:21:00.000Z"),
        },
        options,
      ),
    ).resolves.toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(2);

    const legacyFetcher = vi.fn();
    await expect(
      readOfficialV4LiquidityEvidence(
        {
          tokens: [],
          referenceHead: {
            chainId: 1,
            blockNumber: REFERENCE_BLOCK_NUMBER,
            blockHash: REFERENCE_BLOCK_HASH,
          },
        },
        { fetcher: legacyFetcher },
      ),
    ).resolves.toEqual([]);
    expect(legacyFetcher).not.toHaveBeenCalled();
  });

  it("pins an ahead latest meta-only read to the confirmed RPC reference head", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { blockNumber?: number };
      };
      expect(request.query).not.toContain("pools(");
      const response = request.variables.blockNumber === undefined
        ? officialResponse(25_630_012)
        : exactOfficialResponse();
      return jsonResponse({ data: { _meta: response.data._meta } });
    });
    const input = {
      tokens: [],
      referenceHead: {
        chainId: 1 as const,
        blockNumber: REFERENCE_BLOCK_NUMBER,
        blockHash: REFERENCE_BLOCK_HASH,
      },
      now: new Date("2026-08-12T23:21:00.000Z"),
    };
    const options = {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher,
    };

    await expect(
      readOfficialV4LiquidityEvidenceSnapshot(input, options),
    ).resolves.toEqual({
      evidence: [],
      snapshot: {
        chainId: 1,
        blockNumber: REFERENCE_BLOCK_NUMBER,
        blockHash: REFERENCE_BLOCK_HASH,
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    const mismatchFetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        variables: { blockNumber?: number };
      };
      const response = request.variables.blockNumber === undefined
        ? officialResponse(25_630_012)
        : officialResponse(25_630_000);
      return jsonResponse({ data: { _meta: response.data._meta } });
    });
    await expect(
      readOfficialV4LiquidityEvidenceSnapshot(input, {
        ...options,
        fetcher: mismatchFetcher,
      }),
    ).rejects.toMatchObject({ code: "coverage-incomplete" });
    expect(mismatchFetcher).toHaveBeenCalledTimes(2);
  });

  it("does not reuse liquidity evidence cache entries across exact snapshots", async () => {
    const firstHash = `0x${"55".repeat(32)}` as const;
    const secondHash = `0x${"66".repeat(32)}` as const;
    const thirdHash = `0x${"77".repeat(32)}` as const;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { blockNumber: number };
      };
      expect(
        request.query.match(/block: \{ number: \$blockNumber \}/g),
      ).toHaveLength(2);
      expect(request.query).toContain("$blockNumber: Int!");
      const call = fetcher.mock.calls.length;
      const response = officialResponse(request.variables.blockNumber);
      response.data._meta.block.hash =
        call === 1 ? firstHash : call === 2 ? secondHash : thirdHash;
      response.data.pools[0].totalValueLockedUSD = "10000";
      return jsonResponse(response);
    });
    const read = (blockNumber: string, blockHash: `0x${string}`) =>
      readOfficialV4LiquidityEvidenceSnapshot(
        {
          tokens: [canonicalToken()],
          referenceHead: {
            chainId: 1,
            blockNumber: REFERENCE_BLOCK_NUMBER,
            blockHash: REFERENCE_BLOCK_HASH,
          },
          liquiditySnapshot: { chainId: 1, blockNumber, blockHash },
          now: new Date("2026-08-12T23:21:00.000Z"),
        },
        {
          apiKey: "graph-secret",
          endpoint: OFFICIAL_ENDPOINT,
          fetcher,
        },
      );

    await expect(
      read("25629999", firstHash),
    ).resolves.toMatchObject({ evidence: [{}] });
    await expect(
      read("25629999", secondHash),
    ).resolves.toMatchObject({ evidence: [{}] });
    await expect(read("25629998", thirdHash)).resolves.toMatchObject({
      evidence: [{}],
    });
    await expect(
      read("25629999", firstHash),
    ).resolves.toMatchObject({ evidence: [{}] });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.map(
        ([, init]) => JSON.parse(String(init?.body)).variables.blockNumber,
      ),
    ).toEqual([25_629_999, 25_629_999, 25_629_998]);

    const mismatchFetcher = vi.fn(async () => {
      const response = officialResponse(25_629_999);
      response.data._meta.block.hash = secondHash;
      response.data.pools[0].totalValueLockedUSD = "10000";
      return jsonResponse(response);
    });
    await expect(
      readOfficialV4LiquidityEvidenceSnapshot(
        {
          tokens: [canonicalToken()],
          referenceHead: {
            chainId: 1,
            blockNumber: REFERENCE_BLOCK_NUMBER,
            blockHash: REFERENCE_BLOCK_HASH,
          },
          liquiditySnapshot: {
            chainId: 1,
            blockNumber: "25629999",
            blockHash: firstHash,
          },
          now: new Date("2026-08-12T23:21:00.000Z"),
        },
        {
          apiKey: "graph-secret",
          endpoint: OFFICIAL_ENDPOINT,
          fetcher: mismatchFetcher,
        },
      ),
    ).rejects.toMatchObject({ code: "coverage-incomplete" });
  });

  it("distinguishes shallow pools from stale or internally conflicting evidence", async () => {
    async function read(
      response: unknown,
      token = canonicalToken(),
    ) {
      return readOfficialV4LiquidityEvidence(
        {
          tokens: [token],
          referenceHead: {
            chainId: 1,
            blockNumber: REFERENCE_BLOCK_NUMBER,
            blockHash: REFERENCE_BLOCK_HASH,
          },
          now: new Date("2026-08-12T23:21:00.000Z"),
        },
        {
          apiKey: "graph-secret",
          endpoint: OFFICIAL_ENDPOINT,
          fetcher: async () => jsonResponse(response),
        },
      );
    }

    const shallow = exactOfficialResponse();
    shallow.data.pools[0].totalValueLockedUSD = "9999.999999999999999999";
    await expect(read(shallow)).resolves.toEqual([]);

    const stale = exactOfficialResponse(1_786_576_499);
    stale.data.pools[0].totalValueLockedUSD = "10000";
    await expect(read(stale)).rejects.toMatchObject({
      code: "coverage-incomplete",
    });

    const futureTime = exactOfficialResponse(1_786_577_101);
    futureTime.data.pools[0].totalValueLockedUSD = "10000";
    await expect(read(futureTime)).rejects.toMatchObject({
      code: "coverage-incomplete",
    });

    const ahead = officialResponse(25_630_001);
    ahead.data.pools[0].totalValueLockedUSD = "10000";
    await expect(read(ahead)).rejects.toMatchObject({
      code: "coverage-incomplete",
    });

    const lagged = officialResponse(25_629_935);
    lagged.data.pools[0].totalValueLockedUSD = "10000";
    await expect(read(lagged)).rejects.toMatchObject({
      code: "coverage-incomplete",
    });

    const conflicting = officialResponse(25_630_000);
    conflicting.data.pools[0].totalValueLockedUSD = "10000";
    await expect(read(conflicting)).rejects.toMatchObject({
      code: "coverage-incomplete",
    });

    const emptyPrincipal = exactOfficialResponse();
    emptyPrincipal.data.pools[0].totalValueLockedUSD = "10000";
    emptyPrincipal.data.pools[0].totalValueLockedToken0 = "0";
    emptyPrincipal.data.pools[0].totalValueLockedToken1 = "0.000";
    await expect(read(emptyPrincipal)).rejects.toMatchObject({
      code: "coverage-incomplete",
    });

    const exactPool = exactOfficialResponse();
    exactPool.data.pools[0].totalValueLockedUSD = "10000";
    await expect(
      read(
        exactPool,
        canonicalToken({
          tokenAddress: "0x4444444444444444444444444444444444444444",
        }),
      ),
    ).rejects.toMatchObject({ code: "coverage-incomplete" });
    await expect(
      read(
        exactPool,
        canonicalToken({
          hookAddress: "0x4444444444444444444444444444444444444444",
        }),
      ),
    ).rejects.toMatchObject({ code: "coverage-incomplete" });
    await expect(
      read(exactPool, canonicalToken({ tokenDecimals: 17 })),
    ).rejects.toMatchObject({ code: "coverage-incomplete" });

    const quoteAsset =
      "0x1111111111111111111111111111111111111111" as const;
    const stockPool = officialPool({
      token0: quoteAsset,
      token1: TOKEN_ADDRESS,
      hooks: HOOK_ADDRESS,
    });
    stockPool.totalValueLockedUSD = "10000";
    await expect(
      read(
        {
          data: {
            ...exactOfficialResponse().data,
            pools: [stockPool],
          },
        },
        canonicalToken({
          launchModel: "stock-paired",
          poolId: stockPool.id,
          quoteAssetAddress: quoteAsset,
          quoteIsCurrency0: false,
        }),
      ),
    ).rejects.toMatchObject({ code: "coverage-incomplete" });

    const fetcher = vi.fn(async () => jsonResponse(officialResponse()));
    await expect(
      readOfficialV4LiquidityEvidence(
        {
          tokens: [canonicalToken()],
          referenceHead: {
            chainId: 1,
            blockNumber: "025630000",
            blockHash: `0x${"44".repeat(32)}`,
          },
        },
        {
          apiKey: "graph-secret",
          endpoint: OFFICIAL_ENDPOINT,
          fetcher,
        },
      ),
    ).rejects.toMatchObject({
      name: "OfficialV4LiquidityEvidenceReadError",
      code: "invalid-input",
    });
    expect(fetcher).not.toHaveBeenCalled();

    const unsupportedFetcher = vi.fn(async () => jsonResponse(officialResponse()));
    await expect(
      readOfficialV4LiquidityEvidence(
        {
          tokens: [canonicalToken({ launchModel: "custom-graph" })],
          referenceHead: {
            chainId: 1,
            blockNumber: "25630000",
            blockHash: `0x${"44".repeat(32)}`,
          },
        },
        {
          apiKey: "graph-secret",
          endpoint: OFFICIAL_ENDPOINT,
          fetcher: unsupportedFetcher,
        },
      ),
    ).resolves.toEqual([]);
    expect(unsupportedFetcher).not.toHaveBeenCalled();
  });

  it("batches more than 24 exact pools without silently truncating evidence", async () => {
    const tokensAndPools = batchedTokensAndPools(25);
    const pools = new Map(tokensAndPools.map(({ pool }) => [pool.id, pool]));
    const requestedBlocks: Array<number | undefined> = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: { blockNumber?: number; poolIds: string[] };
      };
      requestedBlocks.push(request.variables.blockNumber);
      if (request.variables.blockNumber === undefined) {
        expect(request.query).not.toContain("$blockNumber");
      } else {
        expect(request.query).toContain("$blockNumber: Int!");
        expect(
          request.query.match(/block: \{ number: \$blockNumber \}/g),
        ).toHaveLength(2);
      }
      return jsonResponse({
        data: {
          ...officialResponse().data,
          pools: request.variables.poolIds.map((poolId) =>
            pools.get(poolId as `0x${string}`),
          ),
        },
      });
    });

    const evidence = await readOfficialV4LiquidityEvidence(
      {
        tokens: tokensAndPools.map(({ token }) => token),
        referenceHead: {
          chainId: 1,
          blockNumber: REFERENCE_BLOCK_NUMBER,
          blockHash: REFERENCE_BLOCK_HASH,
        },
        now: new Date("2026-08-12T23:21:00.000Z"),
      },
      {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher,
      },
    );

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(requestedBlocks).toEqual([undefined, 25_629_999]);
    expect(evidence).toHaveLength(25);
  });

  it("rejects the whole read when one of multiple pool batches fails", async () => {
    const tokensAndPools = batchedTokensAndPools(25);
    const pools = new Map(tokensAndPools.map(({ pool }) => [pool.id, pool]));
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        variables: { poolIds: string[] };
      };
      if (request.variables.poolIds.length === 1) {
        return new Response("unavailable", { status: 503 });
      }
      return jsonResponse({
        data: {
          ...exactOfficialResponse().data,
          pools: request.variables.poolIds.map((poolId) =>
            pools.get(poolId as `0x${string}`),
          ),
        },
      });
    });

    await expect(
      readOfficialV4LiquidityEvidence(
        {
          tokens: tokensAndPools.map(({ token }) => token),
          referenceHead: {
            chainId: 1,
            blockNumber: REFERENCE_BLOCK_NUMBER,
            blockHash: REFERENCE_BLOCK_HASH,
          },
          now: new Date("2026-08-12T23:21:00.000Z"),
        },
        {
          apiKey: "graph-secret",
          endpoint: OFFICIAL_ENDPOINT,
          fetcher,
        },
      ),
    ).rejects.toMatchObject({
      name: "OfficialV4LiquidityEvidenceReadError",
      code: "coverage-incomplete",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects coverage when a successful batch omits a requested canonical pool", async () => {
    const tokensAndPools = batchedTokensAndPools(2);
    await expect(
      readOfficialV4LiquidityEvidence(
        {
          tokens: tokensAndPools.map(({ token }) => token),
          referenceHead: {
            chainId: 1,
            blockNumber: "25630000",
            blockHash: `0x${"44".repeat(32)}`,
          },
          now: new Date("2026-08-12T23:21:00.000Z"),
        },
        {
          apiKey: "graph-secret",
          endpoint: OFFICIAL_ENDPOINT,
          fetcher: async () =>
            jsonResponse({
              data: {
                ...exactOfficialResponse().data,
                pools: [tokensAndPools[0]!.pool],
              },
            }),
        },
      ),
    ).rejects.toMatchObject({
      name: "OfficialV4LiquidityEvidenceReadError",
      code: "coverage-incomplete",
    });
  });

  it("accepts complete pool coverage while omitting a returned shallow pool", async () => {
    const tokensAndPools = batchedTokensAndPools(2);
    tokensAndPools[1]!.pool.totalValueLockedUSD = "9999.99";

    const evidence = await readOfficialV4LiquidityEvidence(
      {
        tokens: tokensAndPools.map(({ token }) => token),
        referenceHead: {
          chainId: 1,
          blockNumber: REFERENCE_BLOCK_NUMBER,
          blockHash: REFERENCE_BLOCK_HASH,
        },
        now: new Date("2026-08-12T23:21:00.000Z"),
      },
      {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher: async () =>
          jsonResponse({
            data: {
              ...exactOfficialResponse().data,
              pools: tokensAndPools.map(({ pool }) => pool),
            },
          }),
      },
    );

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.identity.poolId).toBe(tokensAndPools[0]!.pool.id);
  });

  it("adds an indexed display valuation from the compatible official pool snapshot", async () => {
    const source = page([
      canonicalToken({
        totalSupply: "1000",
        totalSupplyRaw: parseEther("1000").toString(),
        tokenDecimals: 18,
        fdvUsdWad: parseEther("1").toString(),
      }),
    ]);
    if (source.snapshot) {
      source.snapshot.ethUsdQuote = {
        feedAddress: "0x1111111111111111111111111111111111111111",
        roundId: "1",
        answer: "350000000000",
        decimals: 8,
        updatedAt: "1",
      };
    }
    const fetcher = vi.fn(async () => jsonResponse(officialResponse()));

    const enriched = await enrichExplorePageWithOfficialV4Subgraph(source, {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher,
    });

    expect(enriched.tokens[0]).toMatchObject({
      fdvUsdWad: parseEther("1").toString(),
      indexedMarketCapEth: "1000",
      indexedMarketCapEthWei: parseEther("1000").toString(),
      indexedMarketCapUsdWad: parseEther("3500000").toString(),
      indexedValuationBlockNumber: "25629999",
    });
  });

  it("accepts the recorded quote asset as the Stock-Paired countercurrency", async () => {
    const quoteAsset = "0x1111111111111111111111111111111111111111" as const;
    const pool = officialPool({
      token0: quoteAsset,
      token1: TOKEN_ADDRESS,
      hooks: HOOK_ADDRESS,
    });
    const stock = canonicalToken({
      id: "1:stock",
      launchModel: "stock-paired",
      quoteAssetAddress: quoteAsset,
      quoteAssetSymbol: "SVON",
      poolId: pool.id,
    });
    const source = page([stock]);

    const enriched = await enrichExplorePageWithOfficialV4Subgraph(source, {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher: async () =>
        jsonResponse({
          data: {
            ...officialResponse().data,
            pools: [pool],
          },
        }),
    });

    expect(enriched.tokens[0]?.uniswapV4Pool).toMatchObject({
      source: "official-uniswap-v4-subgraph",
      volumeUsdWad: "1234567890123456789123",
    });
  });

  it("isolates a mismatched token without discarding valid page analytics", async () => {
    const mismatchedToken =
      "0x4444444444444444444444444444444444444444" as const;
    const actualHook = "0x5555555555555555555555555555555555555555" as const;
    const recordedHook = "0x6666666666666666666666666666666666666666" as const;
    const mismatchedPool = officialPool({
      token0: "0x0000000000000000000000000000000000000000",
      token1: mismatchedToken,
      hooks: actualHook,
    });
    const mismatched = canonicalToken({
      id: "1:mismatched",
      tokenAddress: mismatchedToken,
      hookAddress: recordedHook,
      poolId: mismatchedPool.id,
    });
    const source = page([canonicalToken(), mismatched]);

    const enriched = await enrichExplorePageWithOfficialV4Subgraph(source, {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher: async () =>
        jsonResponse({
          data: {
            ...officialResponse().data,
            pools: [officialResponse().data.pools[0], mismatchedPool],
          },
        }),
    });

    expect(enriched.tokens[0]?.uniswapV4Pool).toBeDefined();
    expect(enriched.tokens[1]?.uniswapV4Pool).toBeUndefined();
  });

  it("accepts the documented deployment schema and rejects unsupported extra fields", () => {
    expect(parseOfficialV4SubgraphResponse(officialResponse())).toMatchObject({
      deployment: OFFICIAL_DEPLOYMENT,
      pools: [
        {
          feeTierPips: "0",
          sqrtPriceX96: "79228162514264337593543950336",
          transactionCount: "42",
        },
      ],
    });

    const responseWithUnsupportedField = officialResponse();
    expect(() =>
      parseOfficialV4SubgraphResponse({
        data: {
          ...responseWithUnsupportedField.data,
          pools: responseWithUnsupportedField.data.pools.map((pool) => ({
            ...pool,
            isExternalLiquidity: false,
          })),
        },
      }),
    ).toThrow("Invalid Uniswap v4 subgraph response");
  });

  it("rejects malformed numeric fields and indexing errors", () => {
    const malformed = officialResponse();
    malformed.data.pools[0].txCount = "4e2";
    expect(() => parseOfficialV4SubgraphResponse(malformed)).toThrow(
      "Invalid Uniswap v4 subgraph response",
    );

    const indexingError = officialResponse();
    indexingError.data._meta.hasIndexingErrors = true;
    expect(() => parseOfficialV4SubgraphResponse(indexingError)).toThrow(
      "Invalid Uniswap v4 subgraph response",
    );
  });

  it("rejects official-subgraph deployment drift", () => {
    const drifted = officialResponse();
    drifted.data._meta.deployment =
      "QmPKime8TBSfLDrjZELimwpKfg6pjt36h2ikmRhUwrCR4t";

    expect(() => parseOfficialV4SubgraphResponse(drifted)).toThrow(
      "Invalid Uniswap v4 subgraph response",
    );
  });

  it("rejects a pool whose PoolKey does not recompute to its id", () => {
    const mismatched = officialResponse();
    mismatched.data.pools[0].tickSpacing = "61";

    expect(() => parseOfficialV4SubgraphResponse(mismatched)).toThrow(
      "Invalid Uniswap v4 subgraph response",
    );
  });

  it("rejects a response with an oversized declared length", async () => {
    const source = page();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify(officialResponse())),
        );
        controller.close();
      },
    });

    const enriched = await enrichExplorePageWithOfficialV4Subgraph(source, {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher: async () =>
        new Response(body, {
          status: 200,
          headers: {
            "content-length": String(128 * 1024 + 1),
            "content-type": "application/json",
          },
        }),
    });

    expect(enriched).toBe(source);
  });

  it("keeps the existing Explore page when configuration, data, or timeouts fail", async () => {
    const source = page();
    await expect(
      enrichExplorePageWithOfficialV4Subgraph(source, {
        apiKey: "",
        endpoint: OFFICIAL_ENDPOINT,
      }),
    ).resolves.toBe(source);

    await expect(
      enrichExplorePageWithOfficialV4Subgraph(source, {
        apiKey: "graph-secret",
        endpoint:
          "https://gateway.thegraph.com/api/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3H",
        fetcher: async () => jsonResponse(officialResponse()),
      }),
    ).resolves.toBe(source);

    await expect(
      enrichExplorePageWithOfficialV4Subgraph(source, {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher: async () =>
          jsonResponse({
            data: {
              ...officialResponse().data,
              pools: [
                { ...officialResponse().data.pools[0], hooks: TOKEN_ADDRESS },
              ],
            },
          }),
      }),
    ).resolves.toBe(source);

    await expect(
      enrichExplorePageWithOfficialV4Subgraph(source, {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        timeoutMs: 5,
        fetcher: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      }),
    ).resolves.toBe(source);
  });

  it("coalesces concurrent reads and reuses a short-lived server cache", async () => {
    let releaseFetch: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetcher = vi.fn(async () => {
      await gate;
      return jsonResponse(officialResponse());
    });
    const options = {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher,
    };

    const first = enrichExplorePageWithOfficialV4Subgraph(page(), options);
    const second = enrichExplorePageWithOfficialV4Subgraph(page(), options);
    releaseFetch?.();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    const cachedResult = await enrichExplorePageWithOfficialV4Subgraph(
      page(),
      options,
    );

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(firstResult.tokens[0]?.uniswapV4Pool).toBeDefined();
    expect(secondResult.tokens[0]?.uniswapV4Pool).toBeDefined();
    expect(cachedResult.tokens[0]?.uniswapV4Pool).toBeDefined();
  });

  it("bounds concurrent upstream reads across distinct canonical pool sets", async () => {
    let releaseFetch: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const fetcher = vi.fn(async () => {
      await gate;
      const response = officialResponse();
      response.data.pools = [];
      return jsonResponse(response);
    });
    const requests = Array.from({ length: 9 }, (_, index) => {
      const suffix = (index + 1).toString(16);
      const source = page([
        canonicalToken({
          id: `canonical-${index}`,
          tokenAddress: `0x${suffix.padStart(40, "0")}`,
          poolId: `0x${suffix.padStart(64, "0")}`,
        }),
      ]);
      return enrichExplorePageWithOfficialV4Subgraph(source, {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher,
      });
    });

    releaseFetch?.();
    await Promise.all(requests);

    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("opens a short circuit after repeated upstream failures and later recovers", async () => {
    vi.useFakeTimers({ now: new Date("2026-07-29T00:00:00.000Z") });
    try {
      let shouldFail = true;
      const fetcher = vi.fn(async () =>
        shouldFail
          ? new Response("upstream unavailable", { status: 503 })
          : jsonResponse(officialResponse()),
      );
      const options = {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher,
      };

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await expect(
          enrichExplorePageWithOfficialV4Subgraph(page(), options),
        ).resolves.toMatchObject({ tokens: [canonicalToken()] });
      }
      expect(fetcher).toHaveBeenCalledTimes(3);

      shouldFail = false;
      await vi.advanceTimersByTimeAsync(10_001);
      const recovered = await enrichExplorePageWithOfficialV4Subgraph(
        page(),
        options,
      );

      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(recovered.tokens[0]?.uniswapV4Pool).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts exact and nearby snapshots but rejects conflicting or distant analytics", async () => {
    const exactPage = page();
    const exact = await enrichExplorePageWithOfficialV4Subgraph(exactPage, {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher: async () => {
        const response = officialResponse("25630000");
        response.data._meta.block.hash = exactPage.snapshot!.blockHash;
        return jsonResponse(response);
      },
    });
    expect(exact.tokens[0]?.uniswapV4Pool?.indexedBlockNumber).toBe("25630000");

    const conflictingExactPage = page();
    await expect(
      enrichExplorePageWithOfficialV4Subgraph(conflictingExactPage, {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher: async () => jsonResponse(officialResponse("25630000")),
      }),
    ).resolves.toBe(conflictingExactPage);

    const nearPage = page();
    const near = await enrichExplorePageWithOfficialV4Subgraph(nearPage, {
      apiKey: "graph-secret",
      endpoint: OFFICIAL_ENDPOINT,
      fetcher: async () => jsonResponse(officialResponse("25629936")),
    });
    expect(near.tokens[0]?.uniswapV4Pool?.indexedBlockNumber).toBe("25629936");

    const nearAheadPage = page();
    const nearAhead = await enrichExplorePageWithOfficialV4Subgraph(
      nearAheadPage,
      {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher: async () => jsonResponse(officialResponse("25630001")),
      },
    );
    expect(nearAhead.tokens[0]?.uniswapV4Pool?.indexedBlockNumber).toBe(
      "25630001",
    );

    const farAheadPage = page();
    await expect(
      enrichExplorePageWithOfficialV4Subgraph(farAheadPage, {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher: async () => jsonResponse(officialResponse("25630065")),
      }),
    ).resolves.toBe(farAheadPage);

    const stalePage = page();
    await expect(
      enrichExplorePageWithOfficialV4Subgraph(stalePage, {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher: async () => jsonResponse(officialResponse("25629935")),
      }),
    ).resolves.toBe(stalePage);
  });

  it("queries at most 24 canonical pool ids and ignores unrequested pools", async () => {
    const tokens = Array.from({ length: 30 }, (_, index) =>
      canonicalToken({
        id: `token-${index}`,
        tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
        poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      }),
    );
    let requestedPoolIds: string[] = [];
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        variables: { poolIds: string[] };
      };
      requestedPoolIds = request.variables.poolIds;
      return jsonResponse({
        data: {
          ...officialResponse().data,
          pools: [],
        },
      });
    });

    const enriched = await enrichExplorePageWithOfficialV4Subgraph(
      page(tokens),
      {
        apiKey: "graph-secret",
        endpoint: OFFICIAL_ENDPOINT,
        fetcher,
      },
    );

    expect(requestedPoolIds).toHaveLength(24);
    expect(new Set(requestedPoolIds).size).toBe(24);
    expect(enriched.tokens).toEqual(tokens);
  });
});
