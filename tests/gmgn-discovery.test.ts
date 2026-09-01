import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  parseGmgnDiscoverySnapshotV1,
  type GmgnDiscoverySnapshotV1,
} from "../lib/market-data/gmgn-discovery-v1";
import {
  rankCanonicalEntriesWithGmgnDiscoveryV1,
} from "../lib/market-data/gmgn-canonical-ranking";
import {
  readGmgnEthereumHotSearchesV1,
  readGmgnEthereumTrendingV1,
} from "../lib/market-data/gmgn-discovery.server";
import type {
  GmgnAccountGateV1,
} from "../lib/market-data/gmgn-account-gate.server";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const RESERVATION = Object.freeze({
  kind: "reserved" as const,
  reservedAtMs: NOW.getTime(),
  generation: 1,
  holder: "00000000-0000-4000-8000-000000000001",
});

function address(index: number): `0x${string}` {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function providerToken(
  index: number,
  rank = index,
  overrides: Record<string, unknown> = {},
) {
  return {
    chain: "eth",
    address: address(index),
    rank,
    visiting_count: String(1_000 - rank),
    hot_level: rank,
    swaps: String(rank * 10),
    buys: rank * 6,
    sells: rank * 4,
    holder_count: String(rank * 20),
    price: "0.0000123",
    market_cap: "123000",
    liquidity: 42_000,
    volume: "9100.25",
    ...overrides,
  };
}

function rankResponse(items: readonly unknown[]) {
  return {
    code: 0,
    data: {
      code: 0,
      data: { rank: items },
      message: "success",
      reason: "",
    },
  };
}

function hotResponse(
  items: readonly unknown[],
  interval = "24h",
) {
  return {
    code: 0,
    data: [{
      chain: "eth",
      interval,
      version: "eth-hot-v1",
      tokens: items,
    }],
  };
}

function accountGate() {
  const reserveSlot = vi.fn(async () => RESERVATION);
  const blockUntil = vi.fn(async () => ({
    blockedUntilMs: NOW.getTime() + 2_000,
    retryAfterMs: 2_000,
  }));
  const complete = vi.fn(async () => undefined);
  return {
    gate: { reserveSlot, blockUntil, complete } satisfies GmgnAccountGateV1,
    reserveSlot,
    blockUntil,
    complete,
  };
}

describe("GMGN Ethereum discovery schemas", () => {
  it("accepts absent or exact Ethereum envelope chains and rejects foreign ones", () => {
    const input = {
      kind: "trending" as const,
      interval: "1h" as const,
      limit: 10,
      fetchedAt: NOW,
    };
    const exactEthereum = {
      code: 0,
      chain: "eth",
      data: {
        code: 0,
        chain: "eth",
        data: { chain: "eth", rank: [providerToken(1, 1)] },
      },
    };

    expect(parseGmgnDiscoverySnapshotV1(exactEthereum, input))
      .not.toBeNull();
    expect(parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(2, 1),
    ]), input)).not.toBeNull();
    expect(parseGmgnDiscoverySnapshotV1({
      ...exactEthereum,
      chain: "sol",
    }, input)).toBeNull();
    expect(parseGmgnDiscoverySnapshotV1({
      ...exactEthereum,
      data: { ...exactEthereum.data, chain: "base" },
    }, input)).toBeNull();
    expect(parseGmgnDiscoverySnapshotV1({
      ...exactEthereum,
      data: {
        ...exactEthereum.data,
        data: { chain: "bsc", rank: [providerToken(1, 1)] },
      },
    }, input)).toBeNull();
  });

  it("handles the live rank double envelope and discards foreign rows", () => {
    const snapshot = parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(2, 2),
      providerToken(9, 1, { chain: "bsc" }),
      { chain: "eth", address: "not-an-address", rank: 3 },
      providerToken(2, 5),
      providerToken(1, 1),
    ]), {
      kind: "trending",
      interval: "1h",
      limit: 10,
      fetchedAt: NOW,
    });

    expect(snapshot).toMatchObject({
      schemaVersion: "programmable.gmgn-discovery.v1",
      source: "gmgn",
      chainId: "1",
      providerChain: "eth",
      kind: "trending",
      interval: "1h",
      requestedLimit: 10,
      providerItemCount: 5,
      discardedProviderItemCount: 2,
      duplicateProviderItemCount: 1,
      providerVersion: null,
    });
    expect(snapshot?.tokens.map((token) => token.tokenAddress)).toEqual([
      address(1),
      address(2),
    ]);
    expect(snapshot?.tokens[0]).toMatchObject({
      rank: 1,
      visitingCount: 999,
      swaps: 10,
      priceUsd: 0.0000123,
      marketCapUsd: 123_000,
      liquidityUsd: 42_000,
      volumeUsd: 9_100.25,
    });
  });

  it("selects only the exact Ethereum hot-search block", () => {
    const snapshot = parseGmgnDiscoverySnapshotV1({
      code: "0",
      data: [{
        chain: "bsc",
        interval: "5m",
        version: "foreign",
        tokens: [providerToken(91, 1, { chain: "bsc" })],
      }, {
        chain: "eth",
        interval: "5m",
        version: "eth-hot-v2",
        tokens: [providerToken(4, 2), providerToken(3, 1)],
      }],
    }, {
      kind: "hot-search",
      interval: "5m",
      limit: 20,
      fetchedAt: NOW,
    });

    expect(snapshot).toMatchObject({
      kind: "hot-search",
      providerVersion: "eth-hot-v2",
      providerItemCount: 3,
      discardedProviderItemCount: 1,
      duplicateProviderItemCount: 0,
    });
    expect(snapshot?.tokens.map((token) => token.tokenAddress)).toEqual([
      address(3),
      address(4),
    ]);
  });

  it("fails closed for an errored envelope, missing exact block, or over-limit list", () => {
    const input = {
      kind: "trending" as const,
      interval: "1h" as const,
      limit: 1,
      fetchedAt: NOW,
    };
    expect(parseGmgnDiscoverySnapshotV1({
      code: 400,
      data: { rank: [] },
    }, input)).toBeNull();
    expect(parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(1),
      providerToken(2),
    ]), input)).toBeNull();
    expect(parseGmgnDiscoverySnapshotV1({
      code: 0,
      data: [{
        chain: "bsc",
        interval: "1h",
        tokens: [],
      }],
    }, {
      ...input,
      kind: "hot-search",
    })).toBeNull();
  });
});

describe("GMGN canonical discovery intersection", () => {
  it("moves only observed canonical tokens forward and keeps every fallback stable", () => {
    const alpha = { id: "alpha", metadata: { canonical: true } };
    const foreignChain = { id: "foreign-chain", metadata: { canonical: true } };
    const beta = { id: "beta", metadata: { canonical: true } };
    const unobserved = { id: "unobserved", metadata: { canonical: true } };
    const gamma = { id: "gamma", metadata: { canonical: true } };
    const canonical = [alpha, foreignChain, beta, unobserved, gamma];
    const identities = new Map([
      ["alpha", { chainId: 1, tokenAddress: address(1) }],
      ["foreign-chain", { chainId: 4663, tokenAddress: address(9) }],
      ["beta", { chainId: "1", tokenAddress: address(2) }],
      ["unobserved", { chainId: 1, tokenAddress: address(4) }],
      ["gamma", { chainId: 1, tokenAddress: address(3) }],
    ]);
    const trending = parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(3, 1),
      providerToken(1, 2),
      providerToken(88, 3),
    ]), {
      kind: "trending",
      interval: "1h",
      limit: 10,
      fetchedAt: NOW,
    });
    const hot = parseGmgnDiscoverySnapshotV1(hotResponse([
      providerToken(2, 1),
      providerToken(3, 2),
    ]), {
      kind: "hot-search",
      interval: "24h",
      limit: 10,
      fetchedAt: NOW,
    });
    if (trending === null || hot === null) throw new Error("fixture unavailable");

    const result = rankCanonicalEntriesWithGmgnDiscoveryV1(
      canonical,
      [trending, hot],
      (entry) => identities.get(entry.id) ?? null,
    );

    expect(result.entries).toEqual([
      gamma,
      alpha,
      beta,
      foreignChain,
      unobserved,
    ]);
    expect(result.entries[0]).toBe(gamma);
    expect(result.entries[1]).toBe(alpha);
    expect(result.entries[2]).toBe(beta);
    expect(result.entries[3]).toBe(foreignChain);
    expect(result.entries[4]).toBe(unobserved);
    expect(result.rows.map((row) => row.gmgn?.providerRank ?? null)).toEqual([
      1,
      2,
      1,
      null,
      null,
    ]);
    expect(result.coverage).toEqual({
      canonicalEntryCount: 5,
      canonicalEthereumEntryCount: 4,
      canonicalUniqueTokenCount: 4,
      gmgnSnapshotCount: 2,
      invalidGmgnSnapshotCount: 0,
      gmgnObservedUniqueTokenCount: 4,
      gmgnMatchedEntryCount: 3,
      gmgnMatchedUniqueTokenCount: 3,
      unobservedCanonicalEntryCount: 2,
      foreignGmgnTokenCount: 1,
      duplicateGmgnTokenCount: 1,
      discardedProviderItemCount: 0,
      canonicalAddressCoverageBps: 7_500,
    });
  });

  it("ignores a runtime-invalid GMGN snapshot without hiding the catalog", () => {
    const canonical = [{ id: "one" }, { id: "two" }];
    const valid = parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(1, 1),
    ]), {
      kind: "trending",
      interval: "1h",
      limit: 10,
      fetchedAt: NOW,
    });
    if (valid === null) throw new Error("fixture unavailable");
    const invalid = {
      ...valid,
      tokens: [{ ...valid.tokens[0]!, chain: "bsc" }],
    } as unknown as GmgnDiscoverySnapshotV1;
    const result = rankCanonicalEntriesWithGmgnDiscoveryV1(
      canonical,
      [invalid],
      (entry) => ({
        chainId: 1,
        tokenAddress: entry.id === "one" ? address(1) : address(2),
      }),
    );
    expect(result.entries).toEqual(canonical);
    expect(result.coverage).toMatchObject({
      invalidGmgnSnapshotCount: 1,
      gmgnMatchedEntryCount: 0,
      unobservedCanonicalEntryCount: 2,
    });
  });
});

describe("GMGN discovery server adapter", () => {
  beforeEach(() => {
    vi.stubEnv("GMGN_API_KEY", "");
    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not request GMGN without a server-side API key", async () => {
    const fetchImpl = vi.fn();
    await expect(readGmgnEthereumTrendingV1({}, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a foreign chain declared by the raw provider envelope", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    const response = rankResponse([providerToken(10, 1)]);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...response,
      chain: "sol",
    }), { status: 200 }));

    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 10,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
  });

  it("uses only the official read-only rank request and weight one", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot, complete } = accountGate();
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      void _input;
      void _init;
      return new Response(JSON.stringify(
        rankResponse([providerToken(11, 1)]),
      ), { status: 200 });
    });

    const result = await readGmgnEthereumTrendingV1({
      interval: "1m",
      limit: 11,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    expect(result?.tokens[0]?.tokenAddress).toBe(address(11));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [request, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin).toBe("https://openapi.gmgn.ai");
    expect(url.pathname).toBe("/v1/market/rank");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      chain: "eth",
      interval: "1m",
      limit: "11",
      timestamp: "1788264000",
    });
    expect(url.searchParams.get("client_id")).toMatch(/^[0-9a-f-]{36}$/u);
    const headers = new Headers(init?.headers);
    expect(headers.get("X-APIKEY")).toBe("test-server-key");
    expect(headers.get("X-Signature")).toBeNull();
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect(reserveSlot).toHaveBeenCalledWith({
      requestsPerSecond: 1,
      cost: 1,
      deadlineMs: NOW.getTime() + 2_500,
      signal: undefined,
    });
    expect(complete).toHaveBeenCalledWith(RESERVATION);
  });

  it("sends the exact Ethereum hot-search body and charges weight three", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot } = accountGate();
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      void _input;
      void _init;
      return new Response(JSON.stringify(
        hotResponse([providerToken(12, 1)], "5m"),
      ), { status: 200 });
    });

    const result = await readGmgnEthereumHotSearchesV1({
      interval: "5m",
      limit: 12,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    expect(result?.tokens[0]?.tokenAddress).toBe(address(12));
    const [request, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin).toBe("https://openapi.gmgn.ai");
    expect(url.pathname).toBe("/v1/market/hot_searches");
    expect(url.searchParams.get("chain")).toBeNull();
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      params: [{
        label: "hot-search",
        chain: "eth",
        interval: "5m",
        limit: 12,
      }],
    });
    expect(reserveSlot).toHaveBeenCalledWith({
      requestsPerSecond: 1,
      cost: 3,
      deadlineMs: NOW.getTime() + 2_500,
      signal: undefined,
    });
  });

  it("coalesces concurrent reads and serves the bounded live cache", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      rankResponse([providerToken(13, 1)]),
    ), { status: 200 }));
    const read = () => readGmgnEthereumTrendingV1({
      interval: "6h",
      limit: 13,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    const [first, second] = await Promise.all([read(), read()]);
    const third = await read();
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts the official 20 RPS ceiling and rejects 21 conservatively", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot } = accountGate();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      rankResponse([providerToken(18, 1)]),
    ), { status: 200 }));

    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "20");
    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 18,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.not.toBeNull();

    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "21");
    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 19,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.not.toBeNull();

    expect(reserveSlot).toHaveBeenNthCalledWith(1, {
      requestsPerSecond: 20,
      cost: 1,
      deadlineMs: NOW.getTime() + 2_500,
      signal: undefined,
    });
    expect(reserveSlot).toHaveBeenNthCalledWith(2, {
      requestsPerSecond: 1,
      cost: 1,
      deadlineMs: NOW.getTime() + 2_500,
      signal: undefined,
    });
  });

  it("isolates caller aborts from shared provider work and the success cache", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    const controller = new AbortController();
    let releaseResponse!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await responseReady;
      return new Response(JSON.stringify(
        rankResponse([providerToken(20, 1)]),
      ), { status: 200 });
    });
    const input = { interval: "1m" as const, limit: 20 };
    const first = readGmgnEthereumTrendingV1(input, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      signal: controller.signal,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_000,
    });
    const second = readGmgnEthereumTrendingV1(input, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(first).resolves.toBeNull();
    releaseResponse();
    await expect(second).resolves.toMatchObject({
      kind: "trending",
      tokens: [{ tokenAddress: address(20) }],
    });

    await expect(readGmgnEthereumTrendingV1(input, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(20) }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails soft for invalid controls, envelopes, and oversized bodies", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const fetchImpl = vi.fn();
    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 101,
    }, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    const invalidEnvelopeFetch = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: { code: 400, data: { rank: [] } },
    }), { status: 200 }));
    await expect(readGmgnEthereumTrendingV1({
      interval: "24h",
      limit: 14,
    }, {
      fetchImpl: invalidEnvelopeFetch as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();

    const cancel = vi.fn();
    const oversizedFetch = vi.fn(async () => new Response(
      new ReadableStream({ cancel }),
      {
        status: 200,
        headers: { "Content-Length": "1000001" },
      },
    ));
    await expect(readGmgnEthereumHotSearchesV1({
      interval: "1h",
      limit: 15,
    }, {
      fetchImpl: oversizedFetch as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
    expect(invalidEnvelopeFetch).toHaveBeenCalledOnce();
    expect(oversizedFetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds a stalled account gate and does not poison a later retry", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const reserveSlot = vi.fn(() => new Promise<never>(() => undefined));
    const stalledGate: GmgnAccountGateV1 = {
      reserveSlot,
      blockUntil: vi.fn(),
      complete: vi.fn(),
    };
    const fetchImpl = vi.fn();
    const input = { interval: "24h" as const, limit: 21 };
    const stalledRead = readGmgnEthereumTrendingV1(input, {
      fetchImpl,
      accountGate: stalledGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(stalledRead).resolves.toBeNull();
    expect(reserveSlot).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();

    vi.useRealTimers();
    const { gate } = accountGate();
    const retryFetch = vi.fn(async () => new Response(JSON.stringify(
      rankResponse([providerToken(21, 1)]),
    ), { status: 200 }));
    await expect(readGmgnEthereumTrendingV1(input, {
      fetchImpl: retryFetch as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(21) }],
    });
    expect(retryFetch).toHaveBeenCalledOnce();
  });

  it("rejects redirects without forwarding the API key to the target", async () => {
    vi.stubEnv("GMGN_API_KEY", "redirect-secret");
    const targetKeys: Array<string | string[] | undefined> = [];
    const redirectKeys: Array<string | string[] | undefined> = [];
    const target = createServer((request, response) => {
      targetKeys.push(request.headers["x-apikey"]);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(rankResponse([providerToken(17, 1)])));
    });
    const redirector = createServer((request, response) => {
      redirectKeys.push(request.headers["x-apikey"]);
      const targetAddress = target.address();
      if (targetAddress === null || typeof targetAddress === "string") {
        response.writeHead(500).end();
        return;
      }
      response.writeHead(302, {
        Location: `http://127.0.0.1:${targetAddress.port}/target`,
      });
      response.end();
    });
    const listen = (server: typeof target) => new Promise<void>(
      (resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      },
    );
    await listen(target);
    await listen(redirector);
    try {
      const redirectAddress = redirector.address();
      if (redirectAddress === null || typeof redirectAddress === "string") {
        throw new Error("redirect fixture unavailable");
      }
      const fetchImpl = vi.fn(async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => fetch(
        `http://127.0.0.1:${redirectAddress.port}/rank`,
        init,
      ));
      await expect(readGmgnEthereumTrendingV1({
        interval: "5m",
        limit: 17,
      }, {
        fetchImpl: fetchImpl as typeof fetch,
        now: () => NOW,
        deadlineMs: NOW.getTime() + 5_000,
      })).resolves.toBeNull();
      expect(redirectKeys).toEqual(["redirect-secret"]);
      expect(targetKeys).toEqual([]);
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => redirector.close(() => resolve())),
        new Promise<void>((resolve) => target.close(() => resolve())),
      ]);
    }
  });

  it("publishes a shared 429 cooldown and performs no same-read retry", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot, blockUntil, complete } = accountGate();
    let clockMs = NOW.getTime();
    const fetchImpl = vi.fn(async () => {
      // A relative Retry-After starts when the response is received, even when
      // the provider spent most of this request's timeout producing the 429.
      clockMs += 2_000;
      return new Response(JSON.stringify({
        code: 429,
        error: "RATE_LIMIT_EXCEEDED",
        reset_at: Math.floor(NOW.getTime() / 1_000),
        data: {},
      }), { status: 429, headers: { "Retry-After": "1" } });
    });

    await expect(readGmgnEthereumTrendingV1({
      interval: "5m",
      limit: 16,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => new Date(clockMs),
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: RESERVATION,
      blockedUntilMs: NOW.getTime() + 3_250,
      providerSignal: "http-429",
    });
    expect(complete).not.toHaveBeenCalled();

    await expect(readGmgnEthereumHotSearchesV1({
      interval: "6h",
      limit: 16,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => new Date(clockMs),
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(reserveSlot).toHaveBeenCalledTimes(1);
  });
});
