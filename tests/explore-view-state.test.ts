import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXPLORE_TOKENS_PER_PAGE,
  EXPLORE_REFRESH_INTERVAL_MS,
  filterTokensBySocialPresence,
  getExplorePaginationItems,
  getMarketCap,
  loadExplorePayload,
  paginateTokensBySocialPresence,
  preserveExplorePayloadOnRefreshFailure,
  shouldRefreshExplore,
  tokenHasSocialLinks,
} from "../components/explore-view";
import type { LauncherToken } from "../lib/tokens";

const payload = {
  status: "ready" as const,
  tokens: [],
  page: 1,
  pageSize: 9,
  total: 1,
  totalPages: 1,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Explore refresh state", () => {
  it("uses a balanced nine-card page and compact desktop pagination", () => {
    expect(EXPLORE_TOKENS_PER_PAGE).toBe(9);
    expect(getExplorePaginationItems(1, 10)).toEqual([
      1,
      2,
      3,
      "end-gap",
      10,
    ]);
    expect(getExplorePaginationItems(5, 10)).toEqual([
      1,
      "start-gap",
      5,
      "end-gap",
      10,
    ]);
    expect(getExplorePaginationItems(10, 10)).toEqual([
      1,
      "start-gap",
      8,
      9,
      10,
    ]);
  });

  it("treats only X and Telegram as social links", () => {
    const websiteOnly = { links: [{ kind: "website", url: "https://example.com" }] } satisfies Pick<
      LauncherToken,
      "links"
    >;
    const withX = { links: [{ kind: "x", url: "https://x.com/example" }] } satisfies Pick<
      LauncherToken,
      "links"
    >;

    expect(tokenHasSocialLinks(websiteOnly)).toBe(false);
    expect(tokenHasSocialLinks(withX)).toBe(true);
  });

  it("filters the loaded token page without fabricating social data", () => {
    const baseToken = {
      id: "1:test",
      name: "Test",
      symbol: "TEST",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${"33".repeat(32)}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;
    const withSocials = {
      ...baseToken,
      id: "1:social",
      links: [{ kind: "telegram" as const, url: "https://t.me/example" }],
    };

    expect(
      filterTokensBySocialPresence([baseToken, withSocials], "yes").map(
        (token) => token.id,
      ),
    ).toEqual(["1:social"]);
    expect(
      filterTokensBySocialPresence([baseToken, withSocials], "no").map(
        (token) => token.id,
      ),
    ).toEqual(["1:test"]);
  });

  it("filters the complete result set before creating nine-token pages", () => {
    const tokens = Array.from({ length: 22 }, (_, index) => ({
      id: `1:${index}`,
      name: `Token ${index}`,
      symbol: `T${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      ...(index % 2 === 0
        ? {
            links: [
              { kind: "x" as const, url: `https://x.com/token${index}` },
            ],
          }
        : {}),
    })) satisfies LauncherToken[];

    expect(paginateTokensBySocialPresence(tokens, "yes", 1)).toMatchObject({
      page: 1,
      pageSize: 9,
      total: 11,
      totalPages: 2,
      tokens: expect.arrayContaining([
        expect.objectContaining({ id: "1:0" }),
        expect.objectContaining({ id: "1:16" }),
      ]),
    });
    expect(
      paginateTokensBySocialPresence(tokens, "yes", 2).tokens.map(
        (token) => token.id,
      ),
    ).toEqual(["1:18", "1:20"]);
    expect(paginateTokensBySocialPresence(tokens, "no", 1)).toMatchObject({
      total: 11,
      totalPages: 2,
      tokens: expect.arrayContaining([
        expect.objectContaining({ id: "1:1" }),
        expect.objectContaining({ id: "1:17" }),
      ]),
    });
  });

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
      limit: "9",
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
        limit: "9",
      }),
    );
    const rejection = expect(request).rejects.toThrow(
      "Tokens took too long to respond",
    );

    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
  });
});
