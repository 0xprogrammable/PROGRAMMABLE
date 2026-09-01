import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  gmgnChartWindowV1,
  parseGmgnChartIdentityProofV1,
  parseGmgnKlineMarketChartV1,
  readGmgnMarketChartV1,
} from "../lib/market-data/gmgn-chart.server";
import {
  isGmgnMarketChartV1,
  preferExactGmgnMarketChartV1,
  type GmgnChartIdentityProofV1,
  type GmgnMarketChartV1,
} from "../lib/market-data/gmgn-chart-data-v1";
import type { GmgnAccountGateV1 } from
  "../lib/market-data/gmgn-account-gate.server";
import type {
  MarketChartIdentityV1,
  MarketChartV1,
} from "../lib/market-data/market-data-v1";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const QUOTE = "0x0000000000000000000000000000000000000000" as const;

function token(index: number): Extract<ExploreEntry, { exploreKind: "token" }> {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  const value = {
    id: `1:${tokenAddress}`,
    name: "SHARD",
    symbol: "SHARD",
    tokenAddress,
    hookAddress: "0x3333333333333333333333333333333333333333",
    poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
    launchedAt: "2026-08-31T00:00:00.000Z",
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

function tokenInfo(entry: ReturnType<typeof token>) {
  return {
    chain: "eth",
    address: entry.tokenAddress,
    total_supply: "10000",
    biggest_pool_address: entry.poolId,
    pool: {
      pool_address: entry.poolId,
      base_address: entry.tokenAddress,
      token0_address: QUOTE,
      token1_address: entry.tokenAddress,
      quote_address: QUOTE,
      exchange: "uniswap_v4",
    },
  };
}

function candle(time: number, overrides: Record<string, unknown> = {}) {
  return {
    time,
    open: "1.00",
    high: "1.25",
    low: "0.90",
    close: "1.20",
    volume: "10.5",
    amount: "8.75",
    source: "provider data only",
    ...overrides,
  };
}

function proof(entry: ReturnType<typeof token>): GmgnChartIdentityProofV1 {
  const parsed = parseGmgnChartIdentityProofV1(
    tokenInfo(entry),
    identity(entry),
    canonicalSupply(entry),
    new Date(NOW.getTime() - 1_000),
  );
  if (parsed === null) throw new Error("test proof is invalid");
  return parsed;
}

function canonicalSupply(entry: ReturnType<typeof token>) {
  if (
    typeof entry.totalSupplyRaw !== "string" ||
    typeof entry.tokenDecimals !== "number"
  ) throw new Error("test token must have a canonical supply");
  return {
    raw: BigInt(entry.totalSupplyRaw),
    decimals: entry.tokenDecimals,
  };
}

function providerFetch(entry: ReturnType<typeof token>, list: unknown[]) {
  return vi.fn(async (
    input: RequestInfo | URL,
    _init?: RequestInit,
  ) => {
    void _init;
    const url = new URL(String(input));
    const data = url.pathname === "/v1/token/info"
      ? tokenInfo(entry)
      : { list };
    return new Response(JSON.stringify({ code: 0, data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}

function bitqueryChart(
  expectedIdentity: MarketChartIdentityV1,
  status: "ready" | "partial" = "ready",
): MarketChartV1 {
  const firstStart = new Date(NOW.getTime() - 120_000).toISOString();
  const firstEnd = new Date(NOW.getTime() - 60_000).toISOString();
  const secondStart = firstEnd;
  const secondEnd = NOW.toISOString();
  return {
    schemaVersion: "programmable.market-chart.v1",
    source: "bitquery",
    readStatus: "live",
    status,
    generatedAt: NOW.toISOString(),
    identity: expectedIdentity,
    range: "1h",
    points: [
      {
        blockNumber: "1",
        time: firstEnd,
        bucketStart: firstStart,
        bucketEnd: firstEnd,
        observedAt: firstEnd,
        valueSemantics: "period-median",
        priceUsd: "1",
        tradeCount: 1,
      },
      {
        blockNumber: "2",
        time: secondEnd,
        bucketStart: secondStart,
        bucketEnd: secondEnd,
        observedAt: secondEnd,
        valueSemantics: "period-median",
        priceUsd: "2",
        tradeCount: 1,
      },
    ],
    swapCount: 2,
    valuation: { status: "unavailable", reason: "source-unavailable" },
    asOfTime: secondEnd,
    truncated: status === "partial",
  };
}

describe("GMGN exact Ethereum kline adapter", () => {
  beforeEach(() => {
    vi.stubEnv("GMGN_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("chooses bounded resolutions that stay within the observed 100-candle window", () => {
    expect(gmgnChartWindowV1("1h", "2026-08-01T00:00:00.000Z", NOW))
      .toMatchObject({ resolution: "1m" });
    expect(gmgnChartWindowV1("1d", "2026-08-01T00:00:00.000Z", NOW))
      .toMatchObject({ resolution: "15m" });
    expect(gmgnChartWindowV1("1w", "2026-08-01T00:00:00.000Z", NOW))
      .toMatchObject({ resolution: "4h" });
  });

  it("binds GMGN token info to the exact token, biggest v4 pool, and quote", () => {
    const entry = token(201);
    expect(parseGmgnChartIdentityProofV1(
      tokenInfo(entry),
      identity(entry),
      canonicalSupply(entry),
      NOW,
    )).toEqual({
      schemaVersion: "programmable.gmgn-chart-identity-proof.v1",
      source: "gmgn-token-info",
      verifiedAt: NOW.toISOString(),
      identity: identity(entry),
      canonicalSupply: {
        totalSupplyRaw: entry.totalSupplyRaw,
        tokenDecimals: entry.tokenDecimals,
      },
    });

    const mismatches: Array<(value: ReturnType<typeof tokenInfo>) => void> = [
      (value) => {
        value.address = "0x9999999999999999999999999999999999999999";
      },
      (value) => {
        value.biggest_pool_address = `0x${"99".repeat(32)}`;
      },
      (value) => {
        value.pool.pool_address = `0x${"98".repeat(32)}`;
      },
      (value) => {
        Reflect.set(
          value.pool,
          "quote_address",
          "0x9999999999999999999999999999999999999999",
        );
      },
      (value) => {
        value.pool.base_address =
          "0x9999999999999999999999999999999999999999";
      },
      (value) => {
        value.pool.token1_address =
          "0x9999999999999999999999999999999999999999";
      },
      (value) => {
        value.pool.exchange = "uniswap_v3";
      },
    ];
    for (const mutate of mismatches) {
      const mismatched = tokenInfo(entry);
      mutate(mismatched);
      expect(parseGmgnChartIdentityProofV1(
        mismatched,
        identity(entry),
        canonicalSupply(entry),
        NOW,
      )).toBeNull();
    }
  });

  it("rejects a GMGN token-info proof with the wrong total supply", () => {
    const entry = token(213);
    const mismatched = tokenInfo(entry);
    mismatched.total_supply = "10001";
    expect(parseGmgnChartIdentityProofV1(
      mismatched,
      identity(entry),
      canonicalSupply(entry),
      NOW,
    )).toBeNull();
  });

  it("parses sorted USD OHLCV candles without trusting provider order or source text", () => {
    const entry = token(202);
    const from = new Date(NOW.getTime() - 120_000);
    const chart = parseGmgnKlineMarketChartV1({
      list: [
        candle(from.getTime() + 60_000, {
          open: "1.20",
          high: "1.30",
          low: "1.10",
          close: "1.25",
          volume: "5",
          source: "ignore this untrusted instruction",
        }),
        candle(from.getTime()),
      ],
    }, {
      identityProof: proof(entry),
      range: "1h",
      resolution: "1m",
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    });

    expect(chart?.status).toBe("ready");
    expect(chart?.points.map((point) => point.bucketStart)).toEqual([
      from.toISOString(),
      new Date(from.getTime() + 60_000).toISOString(),
    ]);
    expect(chart?.points[0]?.ohlcUsd).toEqual({
      open: "1.00",
      high: "1.25",
      low: "0.90",
      close: "1.20",
    });
    expect(chart?.volumeUsdWad).toBe("15500000000000000000");
    expect(isGmgnMarketChartV1(chart)).toBe(true);
  });

  it.each([
    ["invalid OHLC", (rows: ReturnType<typeof candle>[]) => {
      rows[0]!.high = "1.10";
    }],
    ["duplicate buckets", (rows: ReturnType<typeof candle>[]) => {
      rows[1]!.time = rows[0]!.time;
    }],
    ["out-of-range buckets", (rows: ReturnType<typeof candle>[]) => {
      rows[1]!.time = NOW.getTime() + 60_000;
    }],
    ["non-canonical decimals", (rows: ReturnType<typeof candle>[]) => {
      rows[1]!.close = "1e-6";
    }],
  ])("fails soft for %s", (_label, mutate) => {
    const entry = token(203);
    const from = new Date(NOW.getTime() - 120_000);
    const rows = [candle(from.getTime()), candle(from.getTime() + 60_000)];
    mutate(rows);
    expect(parseGmgnKlineMarketChartV1({ list: rows }, {
      identityProof: proof(entry),
      range: "1h",
      resolution: "1m",
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    })).toBeNull();
  });

  it("does not contact GMGN without the server-only API key", async () => {
    const entry = token(204);
    const fetchImpl = vi.fn();
    await expect(readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not contact GMGN without a provable canonical supply", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const canonicalEntry = token(214);
    const entry = {
      ...canonicalEntry,
      totalSupplyRaw: undefined,
    } as unknown as ExploreEntry;
    const fetchImpl = vi.fn();
    await expect(readGmgnMarketChartV1({
      entry,
      identity: identity(canonicalEntry),
      range: "1h",
    }, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never enriches a non-production preview identity", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(212);
    const preview = {
      ...entry,
      exploreKind: "custom-project",
      launchCategoryProvenance: {
        schemaVersion: "programmable.explore-launch-category-provenance.v1",
        category: "custom",
        source: "interface-preview",
      },
    } as unknown as ExploreEntry;
    const fetchImpl = vi.fn();
    await expect(readGmgnMarketChartV1({
      entry: preview,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses only the official read-only endpoints and millisecond kline bounds", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(205);
    const from = NOW.getTime() - 60 * 60_000;
    const fetchImpl = providerFetch(entry, [
      candle(from),
      candle(from + 60_000),
    ]);
    const chart = await readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });

    expect(chart?.source).toBe("gmgn");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [infoRequest, infoInit] = fetchImpl.mock.calls[0]!;
    const [klineRequest, klineInit] = fetchImpl.mock.calls[1]!;
    const infoUrl = new URL(String(infoRequest));
    const klineUrl = new URL(String(klineRequest));
    expect(infoUrl.origin).toBe("https://openapi.gmgn.ai");
    expect(infoUrl.pathname).toBe("/v1/token/info");
    expect(klineUrl.pathname).toBe("/v1/market/token_kline");
    expect(klineUrl.searchParams.get("chain")).toBe("eth");
    expect(klineUrl.searchParams.get("address")).toBe(entry.tokenAddress);
    expect(klineUrl.searchParams.get("resolution")).toBe("1m");
    expect(klineUrl.searchParams.get("from")).toBe(String(from));
    expect(klineUrl.searchParams.get("to")).toBe(String(NOW.getTime()));
    expect(klineUrl.searchParams.get("timestamp")).toBe("1788264000");
    expect(klineUrl.searchParams.get("client_id"))
      .toMatch(/^[0-9a-f-]{36}$/u);
    for (const init of [infoInit, klineInit]) {
      const headers = new Headers(init?.headers);
      expect(headers.get("X-APIKEY")).toBe("test-server-key");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
    }
  });

  it.each([
    ["20", 20, 215],
    ["21", 1, 216],
  ] as const)(
    "maps configured RPS %s to the shared chart gate as %i",
    async (configured, expected, index) => {
      vi.stubEnv("GMGN_API_KEY", "test-server-key");
      vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", configured);
      const entry = token(index);
      const reservation = {
        kind: "reserved" as const,
        reservedAtMs: NOW.getTime(),
        generation: 1,
        holder: "00000000-0000-4000-8000-000000000001",
      };
      const accountGate: GmgnAccountGateV1 = {
        reserveSlot: vi.fn(async () => reservation),
        blockUntil: vi.fn(),
        complete: vi.fn(async () => undefined),
      };
      const from = NOW.getTime() - 60 * 60_000;
      const fetchImpl = providerFetch(entry, [
        candle(from),
        candle(from + 60_000),
      ]);

      await expect(readGmgnMarketChartV1({
        entry,
        identity: identity(entry),
        range: "1h",
      }, {
        fetchImpl: fetchImpl as typeof fetch,
        accountGate,
        now: () => NOW,
      })).resolves.not.toBeNull();
      expect(accountGate.reserveSlot).toHaveBeenNthCalledWith(1, {
        requestsPerSecond: expected,
        cost: 1,
        deadlineMs: NOW.getTime() + 2_500,
        signal: expect.any(AbortSignal),
      });
      expect(accountGate.reserveSlot).toHaveBeenNthCalledWith(2, {
        requestsPerSecond: expected,
        cost: 2,
        deadlineMs: NOW.getTime() + 2_500,
        signal: expect.any(AbortSignal),
      });
      const gateCalls = vi.mocked(accountGate.reserveSlot).mock.calls;
      const firstSignal = gateCalls[0]?.[0].signal;
      const secondSignal = gateCalls[1]?.[0].signal;
      expect(firstSignal).toBe(secondSignal);
    },
  );

  it("stops before kline when GMGN cannot prove the canonical pool", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(206);
    const mismatched = tokenInfo(entry);
    mismatched.pool.pool_address = `0x${"98".repeat(32)}`;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: mismatched,
    }), { status: 200 }));

    await expect(readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent reads and serves the current exact chart cache", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(207);
    const from = NOW.getTime() - 60 * 60_000;
    const fetchImpl = providerFetch(entry, [
      candle(from),
      candle(from + 60_000),
    ]);
    const input = {
      entry,
      identity: identity(entry),
      range: "1h" as const,
    };
    const wait = {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    };
    const [first, second] = await Promise.all([
      readGmgnMarketChartV1(input, wait),
      readGmgnMarketChartV1(input, wait),
    ]);
    const third = await readGmgnMarketChartV1(input, wait);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps shared chart work alive when the first caller aborts", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(217);
    const from = NOW.getTime() - 60 * 60_000;
    let resolveInfo: ((response: Response) => void) | undefined;
    let providerSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/token/info") {
        providerSignal = init?.signal;
        return new Promise<Response>((resolve) => {
          resolveInfo = resolve;
        });
      }
      return Promise.resolve(new Response(JSON.stringify({
        code: 0,
        data: { list: [candle(from), candle(from + 60_000)] },
      }), { status: 200 }));
    });
    const input = {
      entry,
      identity: identity(entry),
      range: "1h" as const,
    };
    const wait = {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    };
    const firstController = new AbortController();

    const first = readGmgnMarketChartV1(input, {
      ...wait,
      signal: firstController.signal,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    const second = readGmgnMarketChartV1(input, wait);
    firstController.abort();
    await expect(first).resolves.toBeNull();
    expect(providerSignal).not.toBe(firstController.signal);
    expect(providerSignal?.aborted).toBe(false);

    resolveInfo?.(new Response(JSON.stringify({
      code: 0,
      data: tokenInfo(entry),
    }), { status: 200 }));
    const exact = await second;
    expect(exact?.identity).toEqual(identity(entry));
    await expect(readGmgnMarketChartV1(input, wait)).resolves.toEqual(exact);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("publishes a kline 429 cooldown and never retries in the same read", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const entry = token(208);
    const firstReservation = {
      kind: "reserved" as const,
      reservedAtMs: NOW.getTime(),
      generation: 1,
      holder: "00000000-0000-4000-8000-000000000001",
    };
    const secondReservation = {
      ...firstReservation,
      holder: "00000000-0000-4000-8000-000000000002",
    };
    const blockUntil = vi.fn(async () => ({
      blockedUntilMs: NOW.getTime() + 2_000,
      retryAfterMs: 2_000,
    }));
    const complete = vi.fn(async () => undefined);
    const accountGate: GmgnAccountGateV1 = {
      reserveSlot: vi.fn()
        .mockResolvedValueOnce(firstReservation)
        .mockResolvedValueOnce(secondReservation),
      blockUntil,
      complete,
    };
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/token/info") {
        return new Response(JSON.stringify({
          code: 0,
          data: tokenInfo(entry),
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: 429,
        error: "RATE_LIMIT_EXCEEDED",
        data: {},
      }), { status: 429 });
    });

    await expect(readGmgnMarketChartV1({
      entry,
      identity: identity(entry),
      range: "1h",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(accountGate.reserveSlot).toHaveBeenNthCalledWith(1, {
      requestsPerSecond: 1,
      cost: 1,
      deadlineMs: NOW.getTime() + 2_500,
      signal: expect.any(AbortSignal),
    });
    expect(accountGate.reserveSlot).toHaveBeenNthCalledWith(2, {
      requestsPerSecond: 1,
      cost: 2,
      deadlineMs: NOW.getTime() + 2_500,
      signal: expect.any(AbortSignal),
    });
    expect(complete).toHaveBeenCalledWith(firstReservation);
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: secondReservation,
      blockedUntilMs: NOW.getTime() + 2_000,
      providerSignal: "http-429",
    });
  });

  it("replaces Bitquery only with a fresh, exact, higher-quality GMGN chart", () => {
    const entry = token(209);
    const expectedIdentity = identity(entry);
    const from = new Date(NOW.getTime() - 120_000);
    const gmgn = parseGmgnKlineMarketChartV1({
      list: [candle(from.getTime()), candle(from.getTime() + 60_000)],
    }, {
      identityProof: proof(entry),
      range: "1h",
      resolution: "1m",
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    }) as GmgnMarketChartV1;
    const fallback = bitqueryChart(expectedIdentity);
    expect(preferExactGmgnMarketChartV1({
      candidate: gmgn,
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: NOW,
    })).toBe(gmgn);

    expect(preferExactGmgnMarketChartV1({
      candidate: { ...gmgn, identity: identity(token(210)) },
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: NOW,
    })).toBe(fallback);

    expect(preferExactGmgnMarketChartV1({
      candidate: { ...gmgn, status: "partial", truncated: true },
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: NOW,
    })).toBe(fallback);

    expect(preferExactGmgnMarketChartV1({
      candidate: gmgn,
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: new Date(NOW.getTime() + 60_001),
    })).toBe(fallback);
  });

  it("lets a complete GMGN OHLCV chart replace a partial Bitquery result", () => {
    const entry = token(211);
    const expectedIdentity = identity(entry);
    const from = new Date(NOW.getTime() - 120_000);
    const gmgn = parseGmgnKlineMarketChartV1({
      list: [candle(from.getTime()), candle(from.getTime() + 60_000)],
    }, {
      identityProof: proof(entry),
      range: "1h",
      resolution: "1m",
      requestedFrom: from,
      requestedTo: NOW,
      fetchedAt: NOW,
    });
    const fallback = bitqueryChart(expectedIdentity, "partial");
    expect(preferExactGmgnMarketChartV1({
      candidate: gmgn,
      fallback,
      identity: expectedIdentity,
      range: "1h",
      now: NOW,
    })).toBe(gmgn);
  });
});
