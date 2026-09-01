import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PROGRAMMABLE_DEXSCREENER_SHADOW_SCHEMA_VERSION,
  exactJsonNumberLexemeUsdToWadV1,
  exactPositiveDecimalUsdToWadV1,
  rankDexscreenerShadowResultsV1,
  type DexscreenerShadowResultV1,
} from "../lib/market-data/dexscreener-shadow-v1";
import {
  createDexscreenerShadowReaderV1,
  type DexscreenerShadowReaderV1,
} from "../lib/market-data/dexscreener-shadow.server";
import { DEXSCREENER_EXPLORE_OBSERVATION_MAXIMUM_AGE_MS } from
  "../lib/market-data/dexscreener-explore.server";
import type { MarketChartIdentityV1 } from
  "../lib/market-data/market-data-v1";

const FETCHED_AT = "2026-08-15T10:00:00.000Z";
const QUOTE = "0x0000000000000000000000000000000000000000" as const;

function token(index: number) {
  return `0x${index.toString(16).padStart(40, "0")}` as const;
}

function pool(index: number) {
  return `0x${index.toString(16).padStart(64, "0")}` as const;
}

function identity(index: number): MarketChartIdentityV1 {
  return {
    chainId: "1",
    protocol: "uniswap_v4",
    tokenAddress: token(index),
    poolId: pool(index),
    quoteAddress: QUOTE,
  };
}

function pair(
  item: MarketChartIdentityV1,
  overrides: Record<string, unknown> = {},
) {
  return {
    chainId: "ethereum",
    dexId: "uniswap",
    labels: ["v4"],
    pairAddress: item.poolId,
    baseToken: { address: item.tokenAddress },
    quoteToken: { address: item.quoteAddress },
    priceUsd: "0.000003009",
    liquidity: { usd: 10_001.07 },
    fdv: 3_010,
    marketCap: 3_010,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function urlTokens(input: RequestInfo | URL) {
  const pathname = new URL(String(input)).pathname;
  return decodeURIComponent(pathname.split("/").at(-1) ?? "").split(",");
}

function reader(
  fetchImpl: typeof fetch,
  overrides: Partial<Parameters<typeof createDexscreenerShadowReaderV1>[0]> = {},
): DexscreenerShadowReaderV1 {
  return createDexscreenerShadowReaderV1({
    fetchImpl,
    now: () => new Date(FETCHED_AT),
    timeoutMs: 50,
    cacheTtlMs: 300_000,
    maximumResponseBytes: 2_000_000,
    minimumRequestIntervalMs: 0,
    ...overrides,
  });
}

describe("Dexscreener shadow USD-WAD normalization", () => {
  it("normalizes exact price strings and safe JSON numbers without rounding", () => {
    expect(exactPositiveDecimalUsdToWadV1("0.000003009")).toBe(
      "3009000000000",
    );
    expect(exactJsonNumberLexemeUsdToWadV1("2991.07")).toBe(
      "2991070000000000000000",
    );
    expect(exactJsonNumberLexemeUsdToWadV1(
      Number.MAX_SAFE_INTEGER.toString(),
    )).toBe(
      "9007199254740991000000000000000000",
    );
    expect(exactJsonNumberLexemeUsdToWadV1("1e-7")).toBe("100000000000");
    expect(exactJsonNumberLexemeUsdToWadV1("3010.0000000000001")).toBe(
      "3010000000000000100000",
    );
  });

  it.each([
    "0",
    "-1",
    "NaN",
    "Infinity",
    "9007199254740992",
    "0.1234567890123456789",
    2_991.07,
  ])("rejects an unsafe JSON-number lexeme: %s", (value) => {
    expect(exactJsonNumberLexemeUsdToWadV1(value)).toBeNull();
  });

  it.each([
    "0",
    "-1",
    "+1",
    "1e3",
    "1.0000000000000000001",
    `${2n ** 256n}`,
  ])("rejects an inexact or out-of-range decimal: %s", (value) => {
    expect(exactPositiveDecimalUsdToWadV1(value)).toBeNull();
  });
});

describe("Dexscreener server-only shadow reader", () => {
  beforeEach(() => vi.useRealTimers());

  it("chunks 351 unique tokens into 12 bounded requests and retains every identity", async () => {
    const identities = Array.from({ length: 351 }, (_, index) => identity(index + 1));
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const requested = new Set(urlTokens(input).map((value) => value.toLowerCase()));
      return jsonResponse(identities
        .filter((item) => requested.has(item.tokenAddress))
        .map((item) => pair(item)));
    });

    const snapshot = await reader(fetchImpl).read(identities);

    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(fetchImpl.mock.calls.every(([, init]) =>
      init?.redirect === "error")).toBe(true);
    expect(fetchImpl.mock.calls.map(([input]) => urlTokens(input).length)).toEqual(
      [...Array(11).fill(30), 21],
    );
    expect(snapshot).toMatchObject({
      schemaVersion: PROGRAMMABLE_DEXSCREENER_SHADOW_SCHEMA_VERSION,
      source: "dexscreener",
      mode: "shadow",
      currency: "USD",
      assembledAt: FETCHED_AT,
      sourceReadWindow: {
        oldestFetchedAt: FETCHED_AT,
        newestFetchedAt: FETCHED_AT,
      },
      readStatus: "complete",
      requestedCount: 351,
      observedCount: 351,
      qualifiedCount: 351,
      unavailableCount: 0,
    });
    expect(snapshot.results).toHaveLength(351);
    expect(snapshot.results.map((result) => result.identity)).toEqual(identities);
    expect(snapshot).not.toHaveProperty("asOfBlock");
    expect(snapshot).not.toHaveProperty("freshness");
  });

  it("bounds a cold 351-token read while retaining every identity", async () => {
    vi.useFakeTimers({ now: Date.parse(FETCHED_AT) });
    const identities = Array.from({ length: 351 }, (_, index) =>
      identity(index + 1));
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const requested = new Set(
        urlTokens(input).map((value) => value.toLowerCase()),
      );
      return jsonResponse(identities
        .filter((item) => requested.has(item.tokenAddress))
        .map((item) => pair(item)));
    });
    const pending = createDexscreenerShadowReaderV1({
      fetchImpl,
      now: () => new Date(Date.now()),
    }).read(identities);

    await vi.advanceTimersByTimeAsync(7_001);
    const snapshot = await pending;

    expect(fetchImpl.mock.calls.length).toBeLessThan(12);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(7);
    expect(snapshot).toMatchObject({
      readStatus: "partial",
      requestedCount: 351,
    });
    expect(snapshot.results).toHaveLength(351);
    expect(snapshot.unavailableCount).toBeGreaterThan(0);
  });

  it("shares the default start limiter across two cold producers", async () => {
    vi.useFakeTimers({ now: Date.parse(FETCHED_AT) });
    const firstIdentities = Array.from({ length: 351 }, (_, index) =>
      identity(index + 1));
    const secondIdentities = Array.from({ length: 351 }, (_, index) =>
      identity(index + 1_000));
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const requested = new Set(
        urlTokens(input).map((value) => value.toLowerCase()),
      );
      return jsonResponse([...firstIdentities, ...secondIdentities]
        .filter((item) => requested.has(item.tokenAddress))
        .map((item) => pair(item)));
    });
    const productionReader = createDexscreenerShadowReaderV1({
      fetchImpl,
      now: () => new Date(Date.now()),
    });
    const first = productionReader.read(firstIdentities);
    const second = productionReader.read(secondIdentities);

    await vi.advanceTimersByTimeAsync(7_001);
    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);

    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(7);
    expect(firstSnapshot.results).toHaveLength(351);
    expect(secondSnapshot.results).toHaveLength(351);
    expect(firstSnapshot.unavailableCount + secondSnapshot.unavailableCount)
      .toBeGreaterThan(0);
  });

  it("binds only one exact ethereum Uniswap-v4 canonical pair", async () => {
    const item = identity(7);
    const foreign = [
      pair(item, { chainId: "base" }),
      pair(item, { dexId: "sushiswap" }),
      pair(item, { labels: ["v3"] }),
      pair(item, { pairAddress: pool(999) }),
      pair(item, { baseToken: { address: token(998) } }),
      pair(item, { quoteToken: { address: token(997) } }),
    ];
    const snapshot = await reader(vi.fn(async () =>
      jsonResponse([...foreign, pair(item)]))).read([item]);

    expect(snapshot.results).toEqual([{
      identity: item,
      status: "available",
      fdvQualification: {
        status: "qualified",
        minimumLiquidityUsdWad: "10000000000000000000000",
      },
      observation: {
        source: "dexscreener",
        mode: "shadow",
        currency: "USD",
        fetchedAt: FETCHED_AT,
        pairAddress: item.poolId,
        priceUsdWad: "3009000000000",
        liquidityUsdWad: "10001070000000000000000",
        fdvUsdWad: "3010000000000000000000",
        marketCapUsdWad: "3010000000000000000000",
      },
    }]);
  });

  it("accepts the audited checksummed token only at its canonical bytes32 pool", async () => {
    const item = {
      chainId: "1",
      protocol: "uniswap_v4",
      tokenAddress: "0x9ea1917b68aa295d3a59be8c3934bcb45a1e449b",
      poolId: "0x2aa5d22834a63e685d1bc3d05e9c62dfdba0905941728cffe0d8a9f75976ce93",
      quoteAddress: QUOTE,
    } as const satisfies MarketChartIdentityV1;
    const snapshot = await reader(vi.fn(async () => jsonResponse([
      pair(item, {
        baseToken: { address: "0x9EA1917b68aa295D3A59bE8c3934bCB45A1E449b" },
        liquidity: { usd: 2_991.07 },
      }),
    ]))).read([item]);

    expect(snapshot.results[0]).toMatchObject({
      identity: item,
      status: "available",
      fdvQualification: {
        status: "unavailable",
        reason: "insufficient-liquidity",
      },
      observation: { pairAddress: item.poolId },
    });
    expect(snapshot).toMatchObject({ observedCount: 1, qualifiedCount: 0 });
  });

  it("rejects swapped base and quote roles even at the same canonical pool", async () => {
    const item = identity(10);
    const snapshot = await reader(vi.fn(async () => jsonResponse([
      pair(item, {
        baseToken: { address: item.quoteAddress },
        quoteToken: { address: item.tokenAddress },
      }),
    ]))).read([item]);

    expect(snapshot.results[0]).toMatchObject({
      status: "unavailable",
      reason: "identity-mismatch",
    });
  });

  it("does not select a foreign or merely more liquid pool", async () => {
    const item = identity(8);
    const snapshot = await reader(vi.fn(async () => jsonResponse([
      pair(item, { pairAddress: pool(900), liquidity: { usd: 9_000_000 } }),
    ]))).read([item]);

    expect(snapshot.results[0]).toMatchObject({
      identity: item,
      status: "unavailable",
      reason: "identity-mismatch",
    });
  });

  it("rejects duplicate exact pairs as ambiguous instead of picking a row", async () => {
    const item = identity(9);
    const exact = pair(item);
    const snapshot = await reader(vi.fn(async () =>
      jsonResponse([exact, exact]))).read([item]);

    expect(snapshot.results[0]).toMatchObject({
      status: "unavailable",
      reason: "ambiguous-exact-pair",
    });
  });

  it("reports the audited 20/331 sparse shape without losing identities", async () => {
    const identities = Array.from({ length: 351 }, (_, index) => identity(index + 1));
    const available = new Set(identities.slice(0, 20).map((item) => item.tokenAddress));
    const snapshot = await reader(vi.fn(async (input) => jsonResponse(
      identities
        .filter((item) => urlTokens(input).includes(item.tokenAddress))
        .filter((item) => available.has(item.tokenAddress))
        .map((item) => pair(item)),
    ))).read(identities);

    expect(snapshot.results).toHaveLength(351);
    expect(snapshot.observedCount).toBe(20);
    expect(snapshot.qualifiedCount).toBe(20);
    expect(snapshot.unavailableCount).toBe(331);
    expect(snapshot.results.slice(20).every((result) =>
      result.status === "unavailable" && result.reason === "provider-missing"))
      .toBe(true);
  });

  it("isolates one failed batch and preserves the other 321 results", async () => {
    const identities = Array.from({ length: 351 }, (_, index) => identity(index + 1));
    let calls = 0;
    const snapshot = await reader(vi.fn(async (input) => {
      calls += 1;
      if (calls === 4) return jsonResponse({ error: "down" }, 503);
      const requested = new Set(urlTokens(input));
      return jsonResponse(identities
        .filter((item) => requested.has(item.tokenAddress))
        .map((item) => pair(item)));
    })).read(identities);

    expect(snapshot).toMatchObject({
      readStatus: "partial",
      qualifiedCount: 321,
      unavailableCount: 30,
    });
    expect(snapshot.batches).toContainEqual({
      index: 3,
      requestedTokenCount: 30,
      status: "server-error",
      httpStatus: 503,
    });
    expect(snapshot.results.filter((result) =>
      result.status === "unavailable" &&
      result.reason === "batch-server-error")).toHaveLength(30);
  });

  it.each([
    [429, "rate-limited", "batch-rate-limited"],
    [500, "server-error", "batch-server-error"],
  ] as const)("classifies HTTP %s per chunk", async (
    status,
    batchStatus,
    reason,
  ) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "no" }, status));
    const snapshot = await reader(fetchImpl).read([identity(1)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(snapshot.readStatus).toBe("unavailable");
    expect(snapshot.batches[0]).toMatchObject({ status: batchStatus, httpStatus: status });
    expect(snapshot.results[0]).toMatchObject({ status: "unavailable", reason });
  });

  it("classifies transport errors without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("offline");
    });
    const snapshot = await reader(fetchImpl).read([identity(1)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(snapshot.batches[0].status).toBe("transport-error");
    expect(snapshot.results[0]).toMatchObject({
      status: "unavailable",
      reason: "batch-transport-error",
    });
  });

  it.each([429, 500, 400])(
    "aborts and cancels an unread HTTP %s response body",
    async (status) => {
      const cancel = vi.fn(async () => undefined);
      let signal: AbortSignal | undefined;
      const response = {
        ok: false,
        status,
        headers: new Headers(),
        body: { cancel },
      } as unknown as Response;
      const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
        signal = init?.signal ?? undefined;
        return response;
      });
      await reader(fetchImpl).read([identity(1)]);
      expect(signal?.aborted).toBe(true);
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("aborts an unread response with malformed Content-Length", async () => {
    const cancel = vi.fn(async () => undefined);
    let signal: AbortSignal | undefined;
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-length": "not-a-number" }),
      body: { cancel },
    } as unknown as Response;
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return response;
    });
    const snapshot = await reader(fetchImpl).read([identity(1)]);
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(snapshot.batches[0].status).toBe("response-invalid");
  });

  it("enforces its own bounded timeout even when fetch ignores AbortSignal", async () => {
    vi.useFakeTimers();
    const pending = new Promise<Response>(() => undefined);
    const read = reader(vi.fn(() => pending), { timeoutMs: 100 }).read([identity(1)]);
    await vi.advanceTimersByTimeAsync(101);
    const snapshot = await read;
    expect(snapshot.batches[0].status).toBe("timeout");
    expect(snapshot.results[0]).toMatchObject({
      status: "unavailable",
      reason: "batch-timeout",
    });
  });

  it("applies the same deadline when the provider stalls after headers", async () => {
    vi.useFakeTimers();
    const stalledResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => new Promise<string>(() => undefined),
    } as Response;
    const read = reader(vi.fn(async () => stalledResponse), {
      timeoutMs: 100,
    }).read([identity(1)]);
    await vi.advanceTimersByTimeAsync(101);
    const snapshot = await read;
    expect(snapshot.batches[0].status).toBe("timeout");
  });

  it("isolates malformed JSON, invalid top-level responses and oversized bodies", async () => {
    const malformed = new Response("{", { status: 200 });
    const wrongShape = jsonResponse({ pairs: [] });
    const oversized = new Response("[]".padEnd(101, " "), { status: 200 });

    for (const [response, expected] of [
      [malformed, "response-invalid"],
      [wrongShape, "response-invalid"],
      [oversized, "response-too-large"],
    ] as const) {
      const snapshot = await reader(vi.fn(async () => response), {
        maximumResponseBytes: 100,
      }).read([identity(1)]);
      expect(snapshot.batches[0].status).toBe(expected);
      expect(snapshot.results).toHaveLength(1);
    }
  });

  it("stops reading a chunked body as soon as the byte cap is exceeded", async () => {
    let reads = 0;
    const cancel = vi.fn(async () => undefined);
    const releaseLock = vi.fn();
    const oversizedResponse = {
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: async () => {
            reads += 1;
            return reads <= 3
              ? { done: false as const, value: new Uint8Array(60) }
              : { done: true as const, value: undefined };
          },
          cancel,
          releaseLock,
        }),
      },
    } as unknown as Response;

    const snapshot = await reader(vi.fn(async () => oversizedResponse), {
      maximumResponseBytes: 100,
    }).read([identity(1)]);
    expect(reads).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(releaseLock).toHaveBeenCalledTimes(1);
    expect(snapshot.batches[0].status).toBe("response-too-large");
  });

  it("keeps a valid sibling when one exact row has malformed market data", async () => {
    const first = identity(1);
    const second = identity(2);
    const snapshot = await reader(vi.fn(async () => jsonResponse([
      pair(first, { fdv: "3010" }),
      pair(second),
    ]))).read([first, second]);
    expect(snapshot.results[0]).toMatchObject({
      status: "unavailable",
      reason: "malformed-market-data",
    });
    expect(snapshot.results[1].status).toBe("available");
  });

  it("preserves raw JSON-number precision instead of accepting a rounded Number", async () => {
    const item = identity(1);
    const raw = JSON.stringify([pair(item)])
      .replace('"fdv":3010', '"fdv":3010.0000000000001')
      .replace('"marketCap":3010', '"marketCap":3010.0000000000001');
    const snapshot = await reader(vi.fn(async () => new Response(raw, {
      status: 200,
    }))).read([item]);

    expect(snapshot.results[0]).toMatchObject({
      status: "available",
      observation: {
        fdvUsdWad: "3010000000000000100000",
        marketCapUsdWad: "3010000000000000100000",
      },
    });
  });

  it("rejects an out-of-range raw JSON number without poisoning a sibling", async () => {
    const first = identity(1);
    const second = identity(2);
    const raw = JSON.stringify([pair(first), pair(second)])
      .replace('"fdv":3010', '"fdv":9007199254740992');
    const snapshot = await reader(vi.fn(async () => new Response(raw, {
      status: 200,
    }))).read([first, second]);
    expect(snapshot.results[0]).toMatchObject({
      status: "unavailable",
      reason: "malformed-market-data",
    });
    expect(snapshot.results[1].status).toBe("available");
  });

  it("separates observation from FDV eligibility at the $10k boundary", async () => {
    const identities = [identity(1), identity(2), identity(3)];
    const snapshot = await reader(vi.fn(async () => jsonResponse([
      pair(identities[0], { liquidity: { usd: 9_999.999999999998 } }),
      pair(identities[1], { liquidity: { usd: 10_000 } }),
      pair(identities[2], { liquidity: { usd: 10_000.000000000002 } }),
    ]))).read(identities);

    expect(snapshot).toMatchObject({ observedCount: 3, qualifiedCount: 2 });
    expect(snapshot.results[0]).toMatchObject({
      status: "available",
      fdvQualification: {
        status: "unavailable",
        reason: "insufficient-liquidity",
      },
    });
    expect(snapshot.results[1]).toMatchObject({
      fdvQualification: { status: "qualified" },
    });
    expect(snapshot.results[2]).toMatchObject({
      fdvQualification: { status: "qualified" },
    });
  });

  it("queries one token once while separating multiple canonical pools", async () => {
    const first = identity(1);
    const second = { ...first, poolId: pool(2) } satisfies MarketChartIdentityV1;
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse([
      pair(first),
      pair(second),
    ]));
    const snapshot = await reader(fetchImpl).read([first, second]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(urlTokens(fetchImpl.mock.calls[0][0])).toHaveLength(1);
    expect(snapshot.results.map((result) => result.status)).toEqual([
      "available",
      "available",
    ]);
  });

  it("uses a TTL cache and singleflight for identical identity reads", async () => {
    let nowMs = Date.parse(FETCHED_AT);
    const item = identity(1);
    const fetchImpl = vi.fn(async () => jsonResponse([pair(item)]));
    const shadowReader = reader(fetchImpl, {
      now: () => new Date(nowMs),
      cacheTtlMs: 1_000,
    });

    const [first, concurrent, cached] = await Promise.all([
      shadowReader.read([item]),
      shadowReader.read([item]),
      shadowReader.read([item]),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(first).toEqual(concurrent);
    expect(concurrent).toEqual(cached);

    const reversed = await shadowReader.read([item]);
    expect(reversed.results.map((result) => result.identity)).toEqual([item]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    nowMs += 1_001;
    await shadowReader.read([item]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("aborts one caller without cancelling a shared producer or its cache", async () => {
    const item = identity(1);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return jsonResponse([pair(item)]);
    });
    const shadowReader = reader(fetchImpl);
    const controller = new AbortController();
    const owner = shadowReader.read([item], { signal: controller.signal });
    const sibling = shadowReader.read([item]);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    controller.abort(new DOMException("stale", "AbortError"));
    await expect(owner).rejects.toMatchObject({ name: "AbortError" });
    release();
    await expect(sibling).resolves.toMatchObject({ observedCount: 1 });
    await expect(shadowReader.read([item])).resolves.toMatchObject({
      observedCount: 1,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("bounds a caller wait while the shared producer settles independently", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FETCHED_AT));
    const pending = new Promise<Response>(() => undefined);
    const shadowReader = reader(vi.fn(() => pending), {
      timeoutMs: 10_000,
      maximumReadDurationMs: 150,
    });
    const caller = shadowReader.read([identity(1)], {
      deadlineMs: Date.now() + 100,
    });
    const callerAssertion = expect(caller).rejects.toThrow(/deadline/u);
    const producerWaiter = shadowReader.read([identity(1)]);
    await vi.advanceTimersByTimeAsync(101);
    await callerAssertion;
    await vi.advanceTimersByTimeAsync(50);
    await expect(producerWaiter).resolves.toMatchObject({
      readStatus: "unavailable",
      requestedCount: 1,
      unavailableCount: 1,
    });
  });

  it("stops a 351-token producer at one global deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FETCHED_AT));
    const identities = Array.from({ length: 351 }, (_, index) =>
      identity(index + 1)
    );
    const fetchImpl = vi.fn(() => new Promise<Response>(() => undefined));
    const shadowReader = reader(fetchImpl, {
      timeoutMs: 10_000,
      minimumRequestIntervalMs: 100,
      maximumConcurrentBatches: 2,
      maximumReadDurationMs: 250,
    });
    const read = shadowReader.read(identities);
    await vi.advanceTimersByTimeAsync(251);
    const snapshot = await read;
    expect(snapshot.results).toHaveLength(351);
    expect(snapshot.results.every((result) => result.status === "unavailable"))
      .toBe(true);
    expect(snapshot.readStatus).toBe("unavailable");
    expect(fetchImpl.mock.calls.length).toBeLessThan(12);
    const started = fetchImpl.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchImpl).toHaveBeenCalledTimes(started);
  });

  it("shares cache and singleflight across different launch-order permutations", async () => {
    const first = identity(1);
    const second = identity(2);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await gate;
      return jsonResponse([pair(first), pair(second)]);
    });
    const shadowReader = reader(fetchImpl);
    const forward = shadowReader.read([first, second]);
    const reverse = shadowReader.read([second, first]);
    release();
    const [forwardSnapshot, reverseSnapshot] = await Promise.all([
      forward,
      reverse,
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(forwardSnapshot.results.map((result) => result.identity)).toEqual([
      first,
      second,
    ]);
    expect(reverseSnapshot.results.map((result) => result.identity)).toEqual([
      second,
      first,
    ]);
  });

  it("singleflights overlapping identity sets at token granularity", async () => {
    const first = identity(1);
    const shared = identity(2);
    const third = identity(3);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      await gate;
      const requested = new Set(urlTokens(input));
      return jsonResponse([first, shared, third]
        .filter((item) => requested.has(item.tokenAddress))
        .map((item) => pair(item)));
    });
    const shadowReader = reader(fetchImpl);
    const left = shadowReader.read([first, shared]);
    const right = shadowReader.read([shared, third]);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    release();
    const [leftSnapshot, rightSnapshot] = await Promise.all([left, right]);

    const requestedTokens = fetchImpl.mock.calls.flatMap(([input]) =>
      urlTokens(input));
    expect(requestedTokens.filter((address) =>
      address === shared.tokenAddress)).toHaveLength(1);
    expect(leftSnapshot.results.map((result) => result.identity)).toEqual([
      first,
      shared,
    ]);
    expect(rightSnapshot.results.map((result) => result.identity)).toEqual([
      shared,
      third,
    ]);
  });

  it("shares the batch concurrency bound across disjoint reads", async () => {
    const identities = Array.from({ length: 6 }, (_, index) => identity(index + 1));
    let activeBatchCount = 0;
    let maximumActiveBatchCount = 0;
    const releases: Array<() => void> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      activeBatchCount += 1;
      maximumActiveBatchCount = Math.max(
        maximumActiveBatchCount,
        activeBatchCount,
      );
      await new Promise<void>((resolve) => releases.push(resolve));
      activeBatchCount -= 1;
      const requested = new Set(urlTokens(input));
      return jsonResponse(identities
        .filter((item) => requested.has(item.tokenAddress))
        .map((item) => pair(item)));
    });
    const shadowReader = reader(fetchImpl, { maximumConcurrentBatches: 2 });
    const pendingReads = identities.map((item) => shadowReader.read([item]));

    for (const expectedStarts of [2, 4, 6]) {
      await vi.waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledTimes(expectedStarts);
        expect(releases).toHaveLength(2);
      });
      expect(activeBatchCount).toBe(2);
      for (const release of releases.splice(0)) release();
    }

    const snapshots = await Promise.all(pendingReads);
    expect(maximumActiveBatchCount).toBe(2);
    expect(snapshots).toHaveLength(identities.length);
    expect(snapshots.every((snapshot) => snapshot.observedCount === 1)).toBe(
      true,
    );
  });

  it("paces provider starts after waiting for a shared concurrency slot", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FETCHED_AT));
    const identities = Array.from({ length: 4 }, (_, index) => identity(index + 1));
    const startTimes: number[] = [];
    const releases: Array<() => void> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      startTimes.push(Date.now());
      await new Promise<void>((resolve) => releases.push(resolve));
      const requested = new Set(urlTokens(input));
      return jsonResponse(identities
        .filter((item) => requested.has(item.tokenAddress))
        .map((item) => pair(item)));
    });
    const shadowReader = reader(fetchImpl, {
      maximumConcurrentBatches: 2,
      minimumRequestIntervalMs: 1_000,
      timeoutMs: 10_000,
    });
    const pendingReads = identities.map((item) => shadowReader.read([item]));
    const epoch = Date.parse(FETCHED_AT);

    await vi.advanceTimersByTimeAsync(0);
    expect(startTimes).toEqual([epoch]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(startTimes).toEqual([epoch, epoch + 1_000]);

    for (const release of releases.splice(0)) release();
    await vi.advanceTimersByTimeAsync(999);
    expect(startTimes).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(startTimes).toEqual([epoch, epoch + 1_000, epoch + 2_000]);

    for (const release of releases.splice(0)) release();
    await vi.advanceTimersByTimeAsync(999);
    expect(startTimes).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(startTimes).toEqual([
      epoch,
      epoch + 1_000,
      epoch + 2_000,
      epoch + 3_000,
    ]);

    for (const release of releases.splice(0)) release();
    await Promise.all(pendingReads);
  });

  it("bounds cache entries with deterministic least-recent eviction", async () => {
    const identities = Array.from({ length: 31 }, (_, index) => identity(index + 1));
    const fetchImpl = vi.fn(async (input) => {
      const requested = urlTokens(input);
      const item = identities.find((candidate) =>
        requested.includes(candidate.tokenAddress));
      return jsonResponse(item ? [pair(item)] : []);
    });
    const shadowReader = reader(fetchImpl, { maximumCacheEntries: 1 });
    for (const item of identities) await shadowReader.read([item]);
    await shadowReader.read([identities[0]]);
    expect(fetchImpl).toHaveBeenCalledTimes(32);
  });

  it("caches a successful empty provider result from completion time", async () => {
    let nowMs = Date.parse(FETCHED_AT);
    const fetchImpl = vi.fn(async () => {
      nowMs += 20_000;
      return jsonResponse([]);
    });
    const shadowReader = reader(fetchImpl, {
      now: () => new Date(nowMs),
      cacheTtlMs: 300_000,
      failureCacheTtlMs: 15_000,
    });

    await shadowReader.read([identity(1)]);
    await shadowReader.read([identity(1)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    nowMs += 300_001;
    await shadowReader.read([identity(1)]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refreshes the default success cache before Explore stops admitting it", async () => {
    let nowMs = Date.parse(FETCHED_AT);
    const item = identity(1);
    const fetchImpl = vi.fn(async () => jsonResponse([pair(item)]));
    const shadowReader = createDexscreenerShadowReaderV1({
      fetchImpl,
      now: () => new Date(nowMs),
      timeoutMs: 50,
      minimumRequestIntervalMs: 0,
    });

    await shadowReader.read([item]);
    nowMs += 3 * 60_000 + 30_001;
    await shadowReader.read([item]);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(3 * 60_000 + 30_001).toBeLessThan(
      DEXSCREENER_EXPLORE_OBSERVATION_MAXIMUM_AGE_MS,
    );
  });

  it("separates assembly time from mixed token-cache provider times", async () => {
    let nowMs = Date.parse(FETCHED_AT);
    const first = identity(1);
    const second = identity(2);
    const fetchImpl = vi.fn(async (input) => {
      const requested = new Set(urlTokens(input));
      return jsonResponse([first, second]
        .filter((item) => requested.has(item.tokenAddress))
        .map((item) => pair(item)));
    });
    const shadowReader = reader(fetchImpl, {
      now: () => new Date(nowMs),
      failureCacheTtlMs: 15_000,
    });

    await shadowReader.read([first]);
    nowMs += 1_000;
    const assembled = await shadowReader.read([first, second]);
    const nextTime = new Date(nowMs).toISOString();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(assembled).toMatchObject({
      assembledAt: nextTime,
      sourceReadWindow: {
        oldestFetchedAt: FETCHED_AT,
        newestFetchedAt: nextTime,
      },
    });
    expect(assembled.results[0]).toMatchObject({
      status: "available",
      observation: { fetchedAt: FETCHED_AT },
    });
    expect(assembled.results[1]).toMatchObject({
      status: "available",
      observation: { fetchedAt: nextTime },
    });
  });

  it("retains all 351 identities and launch order during a total outage", async () => {
    const identities = Array.from({ length: 351 }, (_, index) => identity(index + 1));
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "down" }, 503));
    const snapshot = await reader(fetchImpl).read(identities);
    const ranked = rankDexscreenerShadowResultsV1(snapshot.results);
    expect(fetchImpl).toHaveBeenCalledTimes(12);
    expect(snapshot).toMatchObject({
      readStatus: "unavailable",
      requestedCount: 351,
      observedCount: 0,
      qualifiedCount: 0,
      unavailableCount: 351,
    });
    expect(ranked.ranking).toMatchObject({
      status: "unavailable",
      applied: "launch-order",
    });
    expect(ranked.results.map((result) => result.identity)).toEqual(identities);
  });

  it("rejects malformed and duplicate canonical input before provider access", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const shadowReader = reader(fetchImpl);
    const item = identity(1);

    await expect(shadowReader.read([item, item])).rejects.toThrow(/duplicate/u);
    await expect(shadowReader.read([{
      ...item,
      tokenAddress: item.tokenAddress.toUpperCase() as `0x${string}`,
    }])).rejects.toThrow(/malformed/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Dexscreener shadow ranking", () => {
  function available(index: number, fdvUsdWad: string): DexscreenerShadowResultV1 {
    const item = identity(index);
    return {
      identity: item,
      status: "available",
      fdvQualification: {
        status: "qualified",
        minimumLiquidityUsdWad: "10000000000000000000000",
      },
      observation: {
        source: "dexscreener",
        mode: "shadow",
        currency: "USD",
        fetchedAt: FETCHED_AT,
        pairAddress: item.poolId,
        priceUsdWad: "1",
        liquidityUsdWad: "10000000000000000000000",
        fdvUsdWad,
        marketCapUsdWad: "1",
      },
    };
  }

  function unavailable(index: number): DexscreenerShadowResultV1 {
    return { identity: identity(index), status: "unavailable", reason: "provider-missing" };
  }

  it("sorts qualified FDV descending, then unavailable in stable launch order", () => {
    const ranked = rankDexscreenerShadowResultsV1([
      unavailable(1),
      available(2, "20"),
      available(3, "30"),
      unavailable(4),
      available(5, "20"),
    ]);
    expect(ranked.ranking).toEqual({
      requested: "fdv",
      status: "partial",
      applied: "qualified-fdv-then-launch-order",
      qualifiedCount: 3,
      unavailableCount: 2,
    });
    expect(ranked.results.map((result) => result.identity.tokenAddress)).toEqual(
      [token(3), token(2), token(5), token(1), token(4)],
    );
  });

  it("keeps launch order and says unavailable when no FDV qualifies", () => {
    const results = [unavailable(3), unavailable(1), unavailable(2)];
    const ranked = rankDexscreenerShadowResultsV1(results);
    expect(ranked.ranking).toEqual({
      requested: "fdv",
      status: "unavailable",
      applied: "launch-order",
      qualifiedCount: 0,
      unavailableCount: 3,
    });
    expect(ranked.results).toEqual(results);
  });

  it("keeps launch order when observations exist but all liquidity is subthreshold", async () => {
    const identities = [identity(3), identity(1), identity(2)];
    const snapshot = await reader(vi.fn(async () => jsonResponse(
      identities.map((item, index) => pair(item, {
        liquidity: { usd: 2_991.07 },
        fdv: 10_000 - index,
      })),
    ))).read(identities);
    const ranked = rankDexscreenerShadowResultsV1(snapshot.results);

    expect(snapshot).toMatchObject({ observedCount: 3, qualifiedCount: 0 });
    expect(ranked.ranking).toEqual({
      requested: "fdv",
      status: "unavailable",
      applied: "launch-order",
      qualifiedCount: 0,
      unavailableCount: 3,
    });
    expect(ranked.results.map((result) => result.identity)).toEqual(identities);
  });
});
