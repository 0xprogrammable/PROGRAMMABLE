import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/api/explore/route", () => ({ GET: vi.fn() }));
vi.mock("@/components/explore-view", () => ({ ExploreView: () => null }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import {
  INITIAL_EXPLORE_TIMEOUT_MS,
  INITIAL_EXPLORE_QUERY,
  readInitialExploreWithinDeadline,
} from "../app/explore/page";
import { DEFAULT_EXPLORE_VIEW_SORT } from "../lib/explore-defaults";

afterEach(() => {
  vi.useRealTimers();
});

describe("Explore initial server read", () => {
  it("covers the API provider budget without allowing an unbounded render", () => {
    expect(INITIAL_EXPLORE_TIMEOUT_MS).toBeGreaterThan(8_000);
    expect(INITIAL_EXPLORE_TIMEOUT_MS).toBeLessThanOrEqual(9_000);
  });

  it("starts with the highest available FDV ranking", () => {
    const query = new URLSearchParams(INITIAL_EXPLORE_QUERY);

    expect(DEFAULT_EXPLORE_VIEW_SORT).toBe("market-cap");
    expect(query.get("sort")).toBe(DEFAULT_EXPLORE_VIEW_SORT);
  });

  it("returns at the total deadline and safely consumes the aborted read", async () => {
    vi.useFakeTimers();
    let readSignal: AbortSignal | undefined;
    const result = readInitialExploreWithinDeadline(
      (signal) => {
        readSignal = signal;
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error("late provider failure")),
            { once: true },
          );
        });
      },
      25,
    );

    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toEqual({
      ok: false,
      body: { error: "Tokens are temporarily unavailable" },
    });
    expect(readSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline and aborts the request signal after success", async () => {
    vi.useFakeTimers();
    let readSignal: AbortSignal | undefined;

    await expect(
      readInitialExploreWithinDeadline(async (signal) => {
        readSignal = signal;
        return { ok: true, body: { status: "ready" } };
      }, 25),
    ).resolves.toEqual({ ok: true, body: { status: "ready" } });

    expect(readSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
