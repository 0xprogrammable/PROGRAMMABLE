import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  gmgnChainSlugV1,
  parseGmgnMarketSnapshotV1,
  readGmgnMarketSnapshotV1,
} from "../lib/market-data/gmgn.server";
import type { MarketChartIdentityV1 } from
  "../lib/market-data/market-data-v1";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const QUOTE = "0x0000000000000000000000000000000000000000" as const;

function token(index = 1): Extract<ExploreEntry, { exploreKind: "token" }> {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  const value = {
    id: `1:${tokenAddress}`,
    name: "SHARD",
    symbol: "SHARD",
    tokenAddress,
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
    launchedAt: NOW.toISOString(),
    totalSupplyRaw: "10000000000000000000000",
    tokenDecimals: 18,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
  } satisfies LauncherToken;
  return {
    ...value,
    exploreKind: "token",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: value.id,
      modelId: "classic",
      modelVersion: null,
    },
  };
}

function identity(entry: ReturnType<typeof token>): MarketChartIdentityV1 {
  return {
    chainId: "1",
    protocol: "uniswap_v4",
    tokenAddress: entry.tokenAddress,
    poolId: entry.poolId,
    quoteAddress: QUOTE,
  };
}

function providerData(entry: ReturnType<typeof token>) {
  return {
    address: entry.tokenAddress,
    biggest_pool_address: entry.poolId,
    total_supply: "10000",
    price: {
      price: "3.3111698",
      volume_24h: "123.45",
      swaps_24h: "17",
    },
    pool: {
      pool_address: entry.poolId,
      base_address: entry.tokenAddress,
      token0_address: QUOTE,
      token1_address: entry.tokenAddress,
      quote_address: QUOTE,
      exchange: "uniswap_v4",
      liquidity: "12000.5",
    },
  };
}

describe("GMGN canonical market enrichment", () => {
  beforeEach(() => {
    vi.stubEnv("GMGN_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("maps only Ethereum mainnet", () => {
    expect(gmgnChainSlugV1(1)).toBe("eth");
    expect(gmgnChainSlugV1("4663")).toBeNull();
    expect(gmgnChainSlugV1(8453)).toBeNull();
  });

  it("computes FDV from canonical raw supply and exact provider price", () => {
    const entry = token();
    const snapshot = parseGmgnMarketSnapshotV1(
      providerData(entry),
      [identity(entry)],
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    );
    expect(snapshot).toEqual({
      schemaVersion: "programmable.gmgn-market-snapshot.v1",
      source: "gmgn",
      currency: "USD",
      fetchedAt: NOW.toISOString(),
      identity: identity(entry),
      priceUsdWad: "3311169800000000000",
      fdvUsdWad: "33111698000000000000000",
      liquidityUsdWad: "12000500000000000000000",
      volume24hUsdWad: "123450000000000000000",
      swapCount24h: 17,
    });
  });

  it.each([
    ["token", (data: ReturnType<typeof providerData>) => {
      data.address = "0x9999999999999999999999999999999999999999";
    }],
    ["pool", (data: ReturnType<typeof providerData>) => {
      data.pool.pool_address = `0x${"99".repeat(32)}`;
    }],
    ["biggest pool", (data: ReturnType<typeof providerData>) => {
      data.biggest_pool_address = `0x${"99".repeat(32)}`;
    }],
    ["quote", (data: ReturnType<typeof providerData>) => {
      Reflect.set(
        data.pool,
        "quote_address",
        "0x9999999999999999999999999999999999999999",
      );
    }],
    ["exchange", (data: ReturnType<typeof providerData>) => {
      data.pool.exchange = "uniswap_v3";
    }],
    ["base", (data: ReturnType<typeof providerData>) => {
      data.pool.base_address = "0x9999999999999999999999999999999999999999";
    }],
    ["token pair", (data: ReturnType<typeof providerData>) => {
      data.pool.token1_address =
        "0x9999999999999999999999999999999999999999";
    }],
    ["supply", (data: ReturnType<typeof providerData>) => {
      data.total_supply = "10001";
    }],
  ])("rejects a mismatched %s identity binding", (_label, mutate) => {
    const entry = token();
    const data = providerData(entry);
    mutate(data);
    expect(parseGmgnMarketSnapshotV1(
      data,
      [identity(entry)],
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    )).toBeNull();
  });

  it("does not call GMGN without a server-side API key", async () => {
    const fetchImpl = vi.fn();
    await expect(readGmgnMarketSnapshotV1(token(2), {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires the official numeric-zero envelope and binds auth server-side", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(3);
    const fetchMock = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      void input;
      void init;
      return new Response(JSON.stringify({
        code: 0,
        data: providerData(entry),
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const snapshot = await readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchMock as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 2_000,
    });
    expect(snapshot?.source).toBe("gmgn");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [request, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin).toBe("https://openapi.gmgn.ai");
    expect(url.pathname).toBe("/v1/token/info");
    expect(url.searchParams.get("chain")).toBe("eth");
    expect(url.searchParams.get("address")).toBe(entry.tokenAddress);
    expect(url.searchParams.get("timestamp")).toBe("1788091200");
    expect(url.searchParams.get("client_id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(new Headers(init?.headers).get("X-APIKEY")).toBe("test-server-key");
  });

  it("fails closed on an unsealed provider response", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(4);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: providerData(entry),
    }), { status: 200 }));
    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 2_000,
    })).resolves.toBeNull();
  });

  it("fails soft without a same-request retry after a 429", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(5);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 429,
        error: "RATE_LIMIT_EXCEEDED",
        data: {},
      }), { status: 429, headers: { "Retry-After": "1" } }));
    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 2_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("holds the shared cooldown when a 429 omits reset headers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 429,
      error: "RATE_LIMIT_EXCEEDED",
      data: {},
    }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readGmgnMarketSnapshotV1(token(6), {
      now: () => new Date(Date.now()),
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
    vi.setSystemTime(NOW.getTime() + 600);
    await expect(readGmgnMarketSnapshotV1(token(7), {
      now: () => new Date(Date.now()),
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["provider 500", 500, JSON.stringify({ code: 0, data: {} })],
    ["oversized UTF-8 body", 200, "é".repeat(500_001)],
  ])("fails soft for a bounded %s response", async (_label, status, body) => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(status + 10);
    const fetchImpl = vi.fn(async () => new Response(body, { status }));
    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 2_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
