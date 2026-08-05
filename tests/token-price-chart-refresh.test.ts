import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSerializedChartRefresh,
  getChartMarketCapAtPoint,
  nearestChartPointIndex,
} from "../components/token-price-chart";

describe("token price chart inspection", () => {
  it("maps the pointer to the nearest plotted price point", () => {
    expect(nearestChartPointIndex(100, 100, 600, 7)).toBe(0);
    expect(nearestChartPointIndex(400, 100, 600, 7)).toBe(3);
    expect(nearestChartPointIndex(700, 100, 600, 7)).toBe(6);
    expect(nearestChartPointIndex(10_000, 100, 600, 7)).toBe(6);
  });

  it("clamps inspection at both edges and fails safely for invalid geometry", () => {
    expect(nearestChartPointIndex(-10_000, 100, 600, 7)).toBe(0);
    expect(nearestChartPointIndex(400, 100, 600, 1)).toBe(0);
    expect(nearestChartPointIndex(400, 100, 0, 7)).toBe(0);
    expect(nearestChartPointIndex(Number.NaN, 100, 600, 7)).toBe(0);
    expect(nearestChartPointIndex(400, 100, 600, 0)).toBe(0);
  });

  it("updates market cap to the inspected historical price", () => {
    expect(
      getChartMarketCapAtPoint(
        {
          status: "ready",
          points: [],
          swapCount: 2,
          volumeWei: "0",
          volumeEth: "0",
          marketCapEthWei: "1000000000000000000000",
          marketCapEth: "1000",
          marketCapUsdWad: "2000000000000000000000000",
        },
        { blockNumber: "1", priceEth: "0.5", priceUsd: "1000" },
        { blockNumber: "2", priceEth: "1", priceUsd: "2000" },
      ),
    ).toEqual({
      marketCapEthWei: "500000000000000000000",
      marketCapEth: "500",
      marketCapUsdWad: "1000000000000000000000000",
    });
  });
});

describe("token price chart refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a response longer than the refresh interval finish before refreshing again", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const run = vi.fn(
      (signal: AbortSignal) =>
        new Promise<void>((resolve) => {
          signals.push(signal);
          const timer = setTimeout(resolve, 11_000);
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        }),
    );
    const refresh = createSerializedChartRefresh(run);

    refresh.request();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(run).toHaveBeenCalledTimes(1);

    refresh.request();
    expect(signals[0].aborted).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(6_000);
    expect(signals[0].aborted).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);

    refresh.stop();
    expect(signals[1].aborted).toBe(true);
  });
});
