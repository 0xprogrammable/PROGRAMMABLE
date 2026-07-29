import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadExplorePayload,
  preserveExplorePayloadOnRefreshFailure,
} from "../components/explore-view";

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
