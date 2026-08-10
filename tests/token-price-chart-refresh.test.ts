import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptChartPayload,
  createSerializedChartRefresh,
  createChartGeometry,
  getChartKeyboardInspectionIndex,
  getChartFdvAtPoint,
  isAuthoritativeChartPayload,
  isAuthoritativeChartPayloadStatus,
  nearestChartPointIndex,
  preserveChartPayloadOnFailure,
  shouldClearChartInspectionAfterPointerUp,
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

  it("supports bounded keyboard inspection for short and long series", () => {
    expect(getChartKeyboardInspectionIndex("ArrowLeft", null, 1)).toBe(0);
    expect(getChartKeyboardInspectionIndex("ArrowRight", 0, 2)).toBe(1);
    expect(getChartKeyboardInspectionIndex("ArrowRight", 1, 2)).toBe(1);
    expect(getChartKeyboardInspectionIndex("Home", 49_999, 50_000)).toBe(0);
    expect(getChartKeyboardInspectionIndex("End", 0, 50_000)).toBe(49_999);
    expect(getChartKeyboardInspectionIndex("Escape", 4, 8)).toBeNull();
    expect(getChartKeyboardInspectionIndex("Enter", 4, 8)).toBeUndefined();
    expect(getChartKeyboardInspectionIndex("ArrowLeft", null, 0)).toBeUndefined();
  });

  it("keeps hover inspection but clears touch and pen inspection on release", () => {
    expect(shouldClearChartInspectionAfterPointerUp("mouse")).toBe(false);
    expect(shouldClearChartInspectionAfterPointerUp("touch")).toBe(true);
    expect(shouldClearChartInspectionAfterPointerUp("pen")).toBe(true);
    expect(shouldClearChartInspectionAfterPointerUp("")).toBe(true);
  });

  it("updates FDV to the inspected historical price", () => {
    expect(
      getChartFdvAtPoint(
        {
          status: "ready",
          points: [],
          swapCount: 2,
          volumeWei: "0",
          volumeEth: "0",
          fdvEthWei: "1000000000000000000000",
          fdvEth: "1000",
          fdvUsdWad: "2000000000000000000000000",
        },
        { blockNumber: "1", priceEth: "0.5" },
        { blockNumber: "2", priceEth: "1", priceUsd: "2500" },
      ),
    ).toEqual({
      fdvEthWei: "500000000000000000000",
      fdvEth: "500",
      fdvUsdWad: "1000000000000000000000000",
    });
  });

  it("keeps a current one-point series as an accessible inspectable value", () => {
    const chart = createChartGeometry([
      { blockNumber: "100", priceEth: "1", priceUsd: "3500" },
    ]);

    expect(chart).toMatchObject({
      unit: "USD",
      current: 3500,
      path: "",
      areaPath: "",
      points: [
        expect.objectContaining({
          blockNumber: "100",
          value: 3500,
          x: 300,
        }),
      ],
    });
    expect(Number.isFinite(chart?.points[0]?.y)).toBe(true);
    expect(getChartKeyboardInspectionIndex("End", null, 1)).toBe(0);
  });
});

describe("token price chart refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats source readiness as unavailable instead of authoritative zero data", () => {
    expect(isAuthoritativeChartPayloadStatus("ready")).toBe(true);
    expect(isAuthoritativeChartPayloadStatus("insufficient-history")).toBe(true);
    expect(isAuthoritativeChartPayloadStatus("not-deployed")).toBe(false);
    expect(isAuthoritativeChartPayloadStatus("partial")).toBe(false);
    expect(
      isAuthoritativeChartPayload({
        status: "ready",
        points: [
          { blockNumber: "1", priceEth: "0.1", priceUsd: "350" },
          { blockNumber: "2", priceEth: "0.2", priceUsd: "700" },
        ],
        swapCount: 2,
        volumeWei: "3",
        volumeEth: "0.000000000000000003",
        fdvEthWei: "1000000000000000000000",
        fdvEth: "1000",
        fdvUsdWad: "3000000000000000000000000",
      }),
    ).toBe(true);
    expect(
      isAuthoritativeChartPayload({
        status: "ready",
        points: [{ blockNumber: "1", priceEth: "0.1" }],
        swapCount: 1,
        volumeWei: "1",
        volumeEth: "0.000000000000000001",
        marketCapEthWei: "1000000000000000000000",
        marketCapEth: "1000",
        marketCapUsdWad: "3000000000000000000000000",
      }),
    ).toBe(false);
    expect(
      isAuthoritativeChartPayload({
        status: "ready",
        points: [{ blockNumber: "1", priceEth: "0" }],
        swapCount: 1,
        volumeWei: "0",
        volumeEth: "0",
        fdvEthWei: "0",
        fdvEth: "0",
        fdvUsdWad: "0",
      }),
    ).toBe(false);
    expect(
      isAuthoritativeChartPayload({
        status: "not-deployed",
        points: [],
        swapCount: 0,
        volumeWei: "0",
        volumeEth: "0",
      }),
    ).toBe(false);
    expect(
      isAuthoritativeChartPayload({
        status: "partial",
        points: [],
        swapCount: 0,
        volumeWei: "0",
        volumeEth: "0",
      }),
    ).toBe(false);
    expect(
      isAuthoritativeChartPayload({
        status: "ready",
        points: [{ blockNumber: "2", priceEth: "NaN" }],
        swapCount: 1,
        volumeWei: "0",
        volumeEth: "Infinity",
      }),
    ).toBe(false);
  });

  it("preserves last-known-good data through failure and replaces it on recovery", () => {
    const cached = {
      status: "ready" as const,
      points: [
        { blockNumber: "1", priceEth: "0.1" },
        { blockNumber: "2", priceEth: "0.2" },
      ],
      swapCount: 2,
      volumeWei: "3",
      volumeEth: "0.000000000000000003",
    };
    const recovered = {
      ...cached,
      points: [
        ...cached.points,
        { blockNumber: "3", priceEth: "0.3" },
      ],
      swapCount: 3,
      volumeWei: "6",
      volumeEth: "0.000000000000000006",
    };

    const failed = preserveChartPayloadOnFailure(null, "token:1d", cached);
    expect(failed).toEqual({
      key: "token:1d",
      payload: cached,
      failed: true,
    });
    expect(acceptChartPayload("token:1d", recovered)).toEqual({
      key: "token:1d",
      payload: recovered,
      failed: false,
    });
    expect(
      preserveChartPayloadOnFailure(
        { key: "other:1d", payload: cached, failed: false },
        "token:1d",
        null,
      ),
    ).toEqual({ key: "token:1d", payload: null, failed: true });
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
