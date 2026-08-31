import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  gmgnChainSlugV1,
  parseGmgnMarketSnapshotV1,
  readGmgnMarketSnapshotV1,
} from "../lib/market-data/gmgn.server";
import { isGmgnMarketSnapshotForExploreEntryV1 } from
  "../lib/market-data/gmgn-market-data-v1";
import type { MarketChartIdentityV1 } from
  "../lib/market-data/market-data-v1";
import type { GmgnAccountGateV1 } from
  "../lib/market-data/gmgn-account-gate.server";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const NOW = new Date("2026-08-30T12:00:00.000Z");
const QUOTE = "0x0000000000000000000000000000000000000000" as const;
const GATE_RESERVATION = Object.freeze({
  kind: "reserved" as const,
  reservedAtMs: NOW.getTime(),
  generation: 1,
  holder: "00000000-0000-4000-8000-000000000001",
});

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

  it("rejects a formally valid snapshot attached to another Explore identity", () => {
    const entry = token(101);
    const snapshot = parseGmgnMarketSnapshotV1(
      providerData(entry),
      [identity(entry)],
      { raw: 10_000n * 10n ** 18n, decimals: 18 },
      NOW,
    );
    expect(snapshot).not.toBeNull();
    expect(isGmgnMarketSnapshotForExploreEntryV1(snapshot, entry)).toBe(true);
    expect(isGmgnMarketSnapshotForExploreEntryV1({
      ...snapshot!,
      identity: {
        ...snapshot!.identity,
        tokenAddress: token(102).tokenAddress,
      },
    }, entry)).toBe(false);
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

  it("publishes provider cooldown to the shared account gate", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: 429,
      error: "RATE_LIMIT_EXCEEDED",
      data: {},
    }), { status: 429 }));
    const blockUntil = vi.fn(async () => ({
      blockedUntilMs: NOW.getTime() + 2_000,
      retryAfterMs: 2_000,
    }));
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => ({
        ...GATE_RESERVATION,
      })),
      blockUntil,
      complete: vi.fn(),
    };

    await expect(readGmgnMarketSnapshotV1(token(6), {
      fetchImpl: fetchMock as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: GATE_RESERVATION,
      blockedUntilMs: NOW.getTime() + 2_000,
      providerSignal: "http-429",
    });
  });

  it("bounds provider reset_at before publishing it to the gate", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const resetAt = Math.floor(NOW.getTime() / 1_000) + 3_600;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      code: "RATE_LIMIT_BANNED",
      error: "RATE_LIMIT_BANNED",
      reset_at: resetAt,
      data: {},
    }), { status: 200 }));
    const blockUntil = vi.fn(async () => ({
      blockedUntilMs: NOW.getTime() + 300_000,
      retryAfterMs: 300_000,
    }));
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => ({
        ...GATE_RESERVATION,
      })),
      blockUntil,
      complete: vi.fn(),
    };

    await expect(readGmgnMarketSnapshotV1(token(8), {
      fetchImpl: fetchMock as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 310_000,
    })).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: GATE_RESERVATION,
      blockedUntilMs: NOW.getTime() + 300_000,
      providerSignal: "provider-envelope",
    });
  });

  it("fails closed before fetch when the shared gate is unavailable", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const fetchMock = vi.fn();
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
      blockUntil: vi.fn(),
      complete: vi.fn(),
    };
    await expect(readGmgnMarketSnapshotV1(token(105), {
      fetchImpl: fetchMock as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cannot bypass the production gate with an injected fetch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    vi.stubEnv("PROGRAMMABLE_WEBSITE_PROJECTION_DATABASE_URL", "");
    const fetchMock = vi.fn();

    await expect(readGmgnMarketSnapshotV1(token(106), {
      fetchImpl: fetchMock as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("releases only the matching lease after a normal provider response", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(107);
    const complete = vi.fn(async () => {});
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => GATE_RESERVATION),
      blockUntil: vi.fn(),
      complete,
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: providerData(entry),
    }), { status: 200 }));

    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.not.toBeNull();
    expect(complete).toHaveBeenCalledWith(GATE_RESERVATION);
  });

  it("discards a normal response when its lease release fails", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(108);
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => GATE_RESERVATION),
      blockUntil: vi.fn(),
      complete: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: providerData(entry),
    }), { status: 200 }));

    await expect(readGmgnMarketSnapshotV1(entry, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.toBeNull();
  });

  it("does not release the lease when the provider fetch fails", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const complete = vi.fn();
    const blockUntil = vi.fn();
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn(async () => GATE_RESERVATION),
      blockUntil,
      complete,
    };
    const fetchImpl = vi.fn(async () => {
      throw new Error("provider unavailable");
    });

    await expect(readGmgnMarketSnapshotV1(token(109), {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_500,
    })).resolves.toBeNull();
    expect(complete).not.toHaveBeenCalled();
    expect(blockUntil).not.toHaveBeenCalled();
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
