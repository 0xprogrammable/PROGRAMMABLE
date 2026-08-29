import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXPLORE_REVALIDATION_INTERVAL_MS,
  createExploreRevalidationScheduler,
  expireResolvedExplorePayloadCache,
  exploreRevalidationCacheTimestamp,
  isExploreModelDatasetCacheFresh,
  loadExplorePayload,
  resolvedExplorePayloadUpdatedAt,
  shouldRevalidateExplore,
  stabilizeExploreRevalidationPayload,
} from "../components/explore-view";

const catalog = {
  source: "envio-classic-v3",
  launchSource: "registry.custom-launched",
  status: "last-known-good",
  lastIndexedAt: "2026-08-27T00:00:00.000Z",
  asOfBlock: "1",
  asOfBlockHash: `0x${"ab".repeat(32)}`,
  identityCount: 0,
  identityCommitment: `sha256:${"cd".repeat(32)}`,
  completeness: {
    classic: "unavailable",
    stock: "excluded",
    custom: "current",
  },
  scope: {
    included: ["registry.custom-launched"],
    excluded: [
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ],
    publicCategories: ["classic", "custom"],
  },
};

function explorePayload(status: "ready" | "not-deployed") {
  return {
    status,
    tokens: [],
    page: 1,
    pageSize: 9,
    total: 0,
    totalPages: 0,
    catalog,
  };
}

function pagedExplorePayload(page: 1 | 2) {
  return {
    ...explorePayload("ready"),
    page,
    total: 18,
    totalPages: 2,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Explore background revalidation", () => {
  it("keeps card order and the last known valuation during partial refreshes", () => {
    const known = {
      exploreKind: "token" as const,
      id: "1:known",
      tokenAddress: `0x${"11".repeat(20)}` as const,
      valuation: {
        status: "available" as const,
        metric: "fdv" as const,
        supplyBasis: "total" as const,
        currency: "usd" as const,
        valueWad: "1000000000000000000",
        freshness: "current" as const,
      },
    };
    const second = {
      ...known,
      id: "1:second",
      tokenAddress: `0x${"22".repeat(20)}` as const,
    };
    const added = {
      ...known,
      id: "1:added",
      tokenAddress: `0x${"33".repeat(20)}` as const,
    };
    const previous = {
      ...explorePayload("ready"),
      tokens: [known, second],
      pageSize: 9,
      total: 2,
      totalPages: 1,
    };
    const incoming = {
      ...previous,
      tokens: [
        added,
        { ...known, valuation: { status: "unavailable" as const, reason: "source-unavailable" as const } },
      ],
      total: 3,
    };

    const stable = stabilizeExploreRevalidationPayload(
      previous as never,
      incoming as never,
    );

    expect(stable.tokens.map((token) => token.id)).toEqual([
      "1:added",
      "1:known",
      "1:second",
    ]);
    expect(stable.tokens[1]?.valuation).toEqual(known.valuation);
    expect(stable.total).toBe(3);
  });

  it("runs only when the tab is visible, online and due", () => {
    const due = {
      visibilityState: "visible" as const,
      online: true,
      lastRevalidationAt: 1_000,
      now: 1_000 + EXPLORE_REVALIDATION_INTERVAL_MS,
    };

    expect(shouldRevalidateExplore(due)).toBe(true);
    expect(
      shouldRevalidateExplore({
        ...due,
        visibilityState: "hidden",
      }),
    ).toBe(false);
    expect(shouldRevalidateExplore({ ...due, online: false })).toBe(false);
    expect(shouldRevalidateExplore({ ...due, now: due.now - 1 })).toBe(false);
    expect(shouldRevalidateExplore({ ...due, intervalMs: 999 })).toBe(false);
    expect(
      shouldRevalidateExplore({
        ...due,
        intervalMs: 60_001,
        now: 100_000,
      }),
    ).toBe(false);
  });

  it("keeps one bounded timer, pauses offline or hidden, and cleans up", () => {
    let now = 5_000;
    let visibilityState: DocumentVisibilityState = "visible";
    let online = true;
    let nextTimer = 0;
    let revalidations = 0;
    const timers = new Map<number, { callback: () => void; delayMs: number }>();
    const clearedTimers: number[] = [];

    const scheduler = createExploreRevalidationScheduler({
      visibilityState: () => visibilityState,
      online: () => online,
      now: () => now,
      setTimeout(callback, delayMs) {
        nextTimer += 1;
        timers.set(nextTimer, { callback, delayMs });
        return nextTimer;
      },
      clearTimeout(timer) {
        clearedTimers.push(timer);
        timers.delete(timer);
      },
      onRevalidate() {
        revalidations += 1;
      },
    });

    expect([...timers.values()].map((timer) => timer.delayMs)).toEqual([
      EXPLORE_REVALIDATION_INTERVAL_MS,
    ]);
    scheduler.sync();
    scheduler.sync();
    expect(timers.size).toBe(1);
    expect(clearedTimers).toHaveLength(2);

    visibilityState = "hidden";
    scheduler.sync();
    expect(timers.size).toBe(0);

    now += EXPLORE_REVALIDATION_INTERVAL_MS;
    visibilityState = "visible";
    scheduler.sync();
    const resumed = [...timers.entries()][0];
    expect(resumed?.[1].delayMs).toBe(0);
    timers.delete(resumed![0]);
    resumed![1].callback();
    expect(revalidations).toBe(1);
    expect([...timers.values()].map((timer) => timer.delayMs)).toEqual([
      EXPLORE_REVALIDATION_INTERVAL_MS,
    ]);

    online = false;
    scheduler.sync();
    expect(timers.size).toBe(0);
    scheduler.dispose();
    scheduler.sync();
    expect(timers.size).toBe(0);
  });

  it("revalidates an aged cached view immediately after it is reactivated", () => {
    const timers: { callback: () => void; delayMs: number }[] = [];
    const scheduler = createExploreRevalidationScheduler({
      visibilityState: () => "visible",
      online: () => true,
      now: () => 20_000,
      lastRevalidationAt: 5_000,
      setTimeout(callback, delayMs) {
        timers.push({ callback, delayMs });
        return timers.length;
      },
      clearTimeout() {},
      onRevalidate() {},
    });

    expect(timers).toHaveLength(1);
    expect(timers[0]?.delayMs).toBe(0);
    scheduler.dispose();
  });

  it("bounds and timestamps the local complete-dataset cache", () => {
    const cached = {
      key: "combined-sort",
      updatedAt: 5_000,
    };

    expect(
      isExploreModelDatasetCacheFresh(cached, "combined-sort", 19_999),
    ).toBe(true);
    expect(
      isExploreModelDatasetCacheFresh(cached, "combined-sort", 20_000),
    ).toBe(false);
    expect(isExploreModelDatasetCacheFresh(cached, "other", 5_001)).toBe(
      false,
    );
    expect(
      exploreRevalidationCacheTimestamp({
        activeKey: "combined-sort",
        fallback: 30_000,
        resolvedUpdatedAt: 25_000,
        modelDataset: cached,
      }),
    ).toBe(5_000);
    expect(
      exploreRevalidationCacheTimestamp({
        activeKey: "other",
        fallback: 30_000,
        resolvedUpdatedAt: null,
        modelDataset: cached,
      }),
    ).toBe(30_000);
  });

  it("bypasses only the resolved cache and still shares a same-key request", async () => {
    const firstPayload = explorePayload("not-deployed");
    const refreshedPayload = explorePayload("ready");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify(firstPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(refreshedPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    const contentKey = "background-revalidation-cache";
    const search = new URLSearchParams({
      q: "",
      sort: "newest",
      page: "1",
      limit: "9",
    });

    await expect(loadExplorePayload(contentKey, search)).resolves.toMatchObject(
      {
        status: "not-deployed",
      },
    );
    await expect(loadExplorePayload(contentKey, search)).resolves.toMatchObject(
      {
        status: "not-deployed",
      },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expireResolvedExplorePayloadCache(contentKey);
    const revalidation = loadExplorePayload(contentKey, search);
    const sharedRevalidation = loadExplorePayload(contentKey, search);
    expect(sharedRevalidation).toBe(revalidation);
    await expect(revalidation).resolves.toMatchObject({ status: "ready" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates every cached page in one query before a refresh", async () => {
    let now = 10_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify(pagedExplorePayload(1)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pagedExplorePayload(2)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pagedExplorePayload(2)), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const pageOneKey = "page-group\u00001";
    const pageTwoKey = "page-group\u00002";
    const pageOneSearch = new URLSearchParams({
      q: "",
      sort: "newest",
      page: "1",
      limit: "9",
    });
    const pageTwoSearch = new URLSearchParams(pageOneSearch);
    pageTwoSearch.set("page", "2");

    await loadExplorePayload(pageOneKey, pageOneSearch);
    await loadExplorePayload(pageTwoKey, pageTwoSearch);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resolvedExplorePayloadUpdatedAt(pageOneKey, now)).toBe(now);

    now += EXPLORE_REVALIDATION_INTERVAL_MS;
    expireResolvedExplorePayloadCache(pageOneKey);
    expect(resolvedExplorePayloadUpdatedAt(pageOneKey, now)).toBeNull();
    expect(resolvedExplorePayloadUpdatedAt(pageTwoKey, now)).toBeNull();

    await loadExplorePayload(pageTwoKey, pageTwoSearch);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps background refreshes separate from the visible request identity", () => {
    const source = readFileSync(
      join(process.cwd(), "components/explore-view.tsx"),
      "utf8",
    );

    expect(source).toContain(
      "const [revalidationKey, setRevalidationKey] = useState(0)",
    );
    expect(source).toContain(
      "const requestKey = `${contentKey}\\u0000${retryKey}`;",
    );
    expect(source).not.toContain(
      "const requestKey = `${contentKey}\\u0000${retryKey}\\u0000${revalidationKey}`;",
    );
    expect(source).toContain(
      "expireResolvedExplorePayloadCache(activeRequestContentKey);",
    );
    expect(source).toContain("modelDatasetCache.current = null;");
    expect(source).toContain("updatedAt: Date.now(),");
    expect(source).toContain("revalidationKey === 0");
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).toContain('window.addEventListener("online"');
    expect(source).toContain('window.addEventListener("offline"');
    expect(source).toContain("scheduler.dispose();");
  });
});
