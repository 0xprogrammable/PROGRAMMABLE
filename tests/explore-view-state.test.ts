import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXPLORE_REFRESH_INTERVAL_MS,
  getMarketCap,
  loadExplorePayload,
  preserveExplorePayloadOnRefreshFailure,
  shouldRefreshExplore,
} from "../components/explore-view";
import type { LauncherToken } from "../lib/tokens";

const payload = {
  status: "ready" as const,
  tokens: [],
  page: 1,
  pageSize: 10,
  total: 1,
  totalPages: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Explore refresh state", () => {
  it("refreshes only visible Explore content after the freshness interval", () => {
    expect(EXPLORE_REFRESH_INTERVAL_MS).toBe(5_000);
    expect(
      shouldRefreshExplore({
        visibilityState: "hidden",
        lastRefreshAt: 0,
        now: 20_000,
      }),
    ).toBe(false);
    expect(
      shouldRefreshExplore({
        visibilityState: "visible",
        lastRefreshAt: 5_000,
        now: 9_999,
      }),
    ).toBe(false);
    expect(
      shouldRefreshExplore({
        visibilityState: "visible",
        lastRefreshAt: 5_000,
        now: 10_000,
      }),
    ).toBe(true);
  });

  it("prefers a compatible indexed market cap over the older canonical snapshot", () => {
    const token = {
      id: "1:test",
      name: "Test",
      symbol: "TEST",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${"33".repeat(32)}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      fdvUsdWad: "100000000000000000000",
      indexedMarketCapUsdWad: "125000000000000000000",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;

    expect(getMarketCap(token)).toEqual({ kind: "usd", value: 125 });
  });

  it("keeps the last valid page when a background refresh fails", () => {
    expect(
      preserveExplorePayloadOnRefreshFailure(
        {
          phase: "ready",
          payload,
          contentKey: "same-content",
          requestKey: "previous-request",
        },
        {
          contentKey: "same-content",
          requestKey: "refresh-request",
          message: "RPC unavailable",
        },
      ),
    ).toEqual({
      phase: "ready",
      payload,
      contentKey: "same-content",
      requestKey: "refresh-request",
      refreshError: "RPC unavailable",
    });
  });

  it("does not show stale cards for a different query or page", () => {
    expect(
      preserveExplorePayloadOnRefreshFailure(
        {
          phase: "ready",
          payload,
          contentKey: "old-query",
          requestKey: "old-request",
        },
        {
          contentKey: "new-query",
          requestKey: "new-request",
          message: "RPC unavailable",
        },
      ),
    ).toEqual({
      phase: "error",
      contentKey: "new-query",
      requestKey: "new-request",
      message: "RPC unavailable",
    });
  });

  it("shares one in-flight request for repeated refreshes of the same content", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const search = new URLSearchParams({
      q: "",
      sort: "market-cap",
      page: "1",
      limit: "10",
    });

    const first = loadExplorePayload("same-content-dedupe", search);
    const second = loadExplorePayload("same-content-dedupe", search);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops a stalled Explore request after twelve seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const request = loadExplorePayload(
      "stalled-content-timeout",
      new URLSearchParams({
        q: "",
        sort: "market-cap",
        page: "1",
        limit: "10",
      }),
    );
    const rejection = expect(request).rejects.toThrow(
      "Tokens took too long to respond",
    );

    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
  });
});
