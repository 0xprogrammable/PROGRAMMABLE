import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createPredictionPresetDiscoveryReaderV2,
} from "../lib/market-data/prediction-preset-discovery-v2.server";

const OBSERVED_AT = "2026-08-23T16:30:00.000Z";
const OBSERVED_AT_MS = new Date(OBSERVED_AT).getTime();
const UPDATED_AT_SECONDS = Math.floor(OBSERVED_AT_MS / 1_000) - 30;

function payload(updatedAt = UPDATED_AT_SECONDS) {
  return {
    bitcoin: {
      usd: 61_234.5,
      usd_market_cap: 1_220_000_000_000,
      last_updated_at: updatedAt,
    },
    ethereum: {
      usd: 2_345.67,
      usd_market_cap: 282_000_000_000,
      last_updated_at: updatedAt,
    },
    solana: {
      usd: 145.25,
      usd_market_cap: 77_000_000_000,
      last_updated_at: updatedAt,
    },
    binancecoin: {
      usd: 612.75,
      usd_market_cap: 89_000_000_000,
      last_updated_at: updatedAt,
    },
  };
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function reader(
  fetchImpl: typeof fetch,
  overrides: Partial<
    Parameters<typeof createPredictionPresetDiscoveryReaderV2>[0]
  > = {},
) {
  return createPredictionPresetDiscoveryReaderV2({
    fetchImpl,
    now: () => new Date(OBSERVED_AT),
    timeoutMs: 100,
    maximumResponseBytes: 32_768,
    successCacheTtlMs: 60_000,
    maximumDataAgeMs: 600_000,
    maximumFutureSkewMs: 300_000,
    ...overrides,
  });
}

describe("prediction preset discovery V2", () => {
  beforeEach(() => vi.useRealTimers());

  it("uses one canonical keyless CoinGecko request for the fixed preset IDs", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.origin).toBe("https://api.coingecko.com");
      expect(requestUrl.pathname).toBe("/api/v3/simple/price");
      expect([...requestUrl.searchParams.keys()].sort()).toEqual([
        "ids",
        "include_last_updated_at",
        "include_market_cap",
        "precision",
        "vs_currencies",
      ]);
      expect(requestUrl.searchParams.get("ids")).toBe(
        "bitcoin,ethereum,solana,binancecoin",
      );
      expect(requestUrl.searchParams.get("vs_currencies")).toBe("usd");
      expect(requestUrl.searchParams.get("include_market_cap")).toBe("true");
      expect(requestUrl.searchParams.get("include_last_updated_at")).toBe(
        "true",
      );
      expect(requestUrl.searchParams.get("precision")).toBe("full");
      expect(requestUrl.searchParams.has("x_cg_demo_api_key")).toBe(false);
      const headers = new Headers(init?.headers);
      expect(headers.has("x-cg-demo-api-key")).toBe(false);
      expect(headers.has("x-cg-pro-api-key")).toBe(false);
      expect(init).toMatchObject({
        method: "GET",
        cache: "no-store",
        redirect: "error",
      });
      return jsonResponse(payload());
    });

    const result = await reader(fetchImpl).read();

    expect(result).toMatchObject({
      schemaVersion: 2,
      status: "available",
      source: "coingecko-keyless-public",
      providerTier: "keyless-public",
      observedAt: OBSERVED_AT,
      usage: "display-only-not-eligibility-or-settlement",
      serviceLevel: "best-effort-no-sla",
      cacheExpiresAt: "2026-08-23T16:31:00.000Z",
      presets: [
        {
          presetId: "btc",
          selectionKey: "preset:btc",
          symbol: "BTC",
          providerId: "bitcoin",
          currentPriceUsd: 61_234.5,
          marketCapUsd: 1_220_000_000_000,
        },
        { presetId: "eth", providerId: "ethereum" },
        { presetId: "sol", providerId: "solana" },
        { presetId: "bnb", providerId: "binancecoin" },
      ],
    });
    expect(result).not.toHaveProperty("assetKey");
    expect(result).not.toHaveProperty("oracleStatus");
    expect(result).not.toHaveProperty("settlementEligible");
  });

  it("caches only a fresh success and never serves it after expiry", async () => {
    let currentMs = OBSERVED_AT_MS;
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(payload()))
      .mockResolvedValueOnce(jsonResponse({ error: "down" }, 503));
    const discovery = reader(fetchImpl, {
      now: () => new Date(currentMs),
    });

    const first = await discovery.read();
    currentMs += 59_000;
    const cached = await discovery.read();
    currentMs += 2_000;
    const expired = await discovery.read();

    expect(cached).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(expired).toMatchObject({
      status: "unavailable",
      reason: "provider-unavailable",
    });
    expect(expired).not.toHaveProperty("presets");
  });

  it.each([
    [
      (() => {
        const value = payload() as Record<string, unknown>;
        delete value.binancecoin;
        return value;
      })(),
      "incomplete-provider-data",
    ],
    [{ ...payload(), dogecoin: payload().bitcoin }, "response-invalid"],
    [
      {
        ...payload(),
        bitcoin: { ...payload().bitcoin, usd_24h_change: 1 },
      },
      "response-invalid",
    ],
    [
      {
        ...payload(),
        ethereum: { ...payload().ethereum, usd_market_cap: null },
      },
      "incomplete-provider-data",
    ],
  ] as const)("fails closed on a non-canonical provider payload", async (
    body,
    reason,
  ) => {
    const result = await reader(
      vi.fn(async () => jsonResponse(body)),
    ).read();

    expect(result).toMatchObject({ status: "unavailable", reason });
    expect(result).not.toHaveProperty("presets");
  });

  it("rejects provider timestamps outside the freshness window", async () => {
    const staleSeconds = Math.floor((OBSERVED_AT_MS - 600_001) / 1_000);
    const result = await reader(
      vi.fn(async () => jsonResponse(payload(staleSeconds))),
    ).read();

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "stale-provider-data",
    });
  });

  it("enforces the response byte cap before trusting JSON", async () => {
    const response = jsonResponse(payload(), 200, {
      "content-length": "999999",
    });
    const result = await reader(vi.fn(async () => response), {
      maximumResponseBytes: 1_024,
    }).read();

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "response-too-large",
    });
  });

  it("bounds a provider that ignores AbortSignal", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const pending = reader(fetchImpl).read();

    await vi.advanceTimersByTimeAsync(101);

    await expect(pending).resolves.toMatchObject({
      status: "unavailable",
      reason: "timeout",
    });
    expect(signal?.aborted).toBe(true);
  });

  it("propagates caller cancellation without returning cached-looking data", async () => {
    const fetchImpl = vi.fn<typeof fetch>(() =>
      new Promise<Response>(() => undefined)
    );
    const controller = new AbortController();
    const pending = reader(fetchImpl).read({ signal: controller.signal });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    controller.abort();

    await expect(pending).resolves.toMatchObject({
      status: "unavailable",
      reason: "aborted",
    });
  });

  it.each([
    [429, "rate-limited"],
    [500, "provider-unavailable"],
  ] as const)("classifies provider HTTP %s without exposing its body", async (
    status,
    reason,
  ) => {
    const result = await reader(vi.fn(async () => jsonResponse(
      { secret: "provider detail" },
      status,
    ))).read();

    expect(result).toMatchObject({ status: "unavailable", reason });
    expect(JSON.stringify(result)).not.toContain("provider detail");
  });
});
