import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptChartPayload,
  createSerializedChartRefresh,
  createChartGeometry,
  getChartKeyboardInspectionIndex,
  isAuthoritativeChartPayload,
  isAuthoritativeChartPayloadStatus,
  nearestChartPointIndex,
  parseAuthoritativeChartPayload,
  preserveChartPayloadOnFailure,
  selectChartMetric,
  shouldClearChartInspectionAfterPointerUp,
} from "../components/token-price-chart";
import type { MarketChartV1 } from "../lib/market-data/market-data-v1";

const MARKET_CHART = {
  schemaVersion: "programmable.market-chart.v1",
  source: "bitquery",
  readStatus: "live",
  status: "ready",
  generatedAt: "2026-08-11T14:02:00.000Z",
  identity: {
    chainId: "1",
    tokenAddress: "0x1111111111111111111111111111111111111111",
    quoteAddress: "0x0000000000000000000000000000000000000000",
    poolId: `0x${"22".repeat(32)}`,
    protocol: "uniswap_v4",
  },
  range: "1d",
  points: [{
    blockNumber: "99",
    time: "2026-08-11T14:01:00.000Z",
    bucketStart: "2026-08-11T14:00:00.000Z",
    bucketEnd: "2026-08-11T14:01:00.000Z",
    observedAt: "2026-08-11T14:00:59.000Z",
    valueSemantics: "period-median",
    priceQuote: "0.1",
    quoteSymbol: "ETH",
    tradeCount: 1,
  }, {
    blockNumber: "100",
    time: "2026-08-11T14:02:00.000Z",
    bucketStart: "2026-08-11T14:01:00.000Z",
    bucketEnd: "2026-08-11T14:02:00.000Z",
    observedAt: "2026-08-11T14:01:59.000Z",
    valueSemantics: "period-median",
    priceQuote: "0.2",
    quoteSymbol: "ETH",
    tradeCount: 1,
  }],
  swapCount: 2,
  valuation: { status: "unavailable", reason: "source-unavailable" },
  asOfTime: "2026-08-11T14:01:59.000Z",
  truncated: false,
} as const satisfies MarketChartV1;

describe("token price chart inspection", () => {
  it("uses quote price history when USD history is not available", () => {
    expect(
      selectChartMetric(
        [{ blockNumber: "100", priceQuote: "0.1", quoteSymbol: "ETH" }],
        "1000000",
      ),
    ).toBe("price");
    expect(
      selectChartMetric(
        [{ blockNumber: "100", priceUsd: "0.0003" }],
        "1000000",
      ),
    ).toBe("market-cap");
  });

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

  it("keeps a one-point series as an accessible inspectable value", () => {
    const chart = createChartGeometry([
      { blockNumber: "100", priceEth: "1", priceUsd: "3500" },
    ]);

    expect(chart).toMatchObject({
      unit: "USD",
      latestValue: 3500,
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

  it("plots market-cap values in compact USD form when supply is bound", () => {
    const chart = createChartGeometry([
      { blockNumber: "100", priceUsd: "0.0003", marketCapUsd: "300000" },
      { blockNumber: "101", priceUsd: "0.000265", marketCapUsd: "265000" },
    ], "market-cap");

    expect(chart).toMatchObject({
      unit: "USD",
      latestValue: 265000,
      points: [
        expect.objectContaining({ value: 300000 }),
        expect.objectContaining({ value: 265000 }),
      ],
    });
  });
});

describe("token price chart refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts only quote-bound period-median chart DTOs", () => {
    expect(isAuthoritativeChartPayloadStatus("ready")).toBe(true);
    expect(isAuthoritativeChartPayloadStatus("insufficient-history")).toBe(true);
    expect(isAuthoritativeChartPayloadStatus("partial")).toBe(true);
    expect(isAuthoritativeChartPayloadStatus("not-deployed")).toBe(false);
    expect(isAuthoritativeChartPayload(MARKET_CHART)).toBe(true);

    const payload = parseAuthoritativeChartPayload(MARKET_CHART);
    expect(payload).toMatchObject({
      status: "ready",
      points: MARKET_CHART.points,
      swapCount: 2,
      marketData: MARKET_CHART,
    });
    expect(acceptChartPayload("token:1d", payload!).payload).toBe(payload);
  });

  it("rejects every chart-owned valuation path", () => {
    expect(isAuthoritativeChartPayload({
      ...MARKET_CHART,
      fdvUsdWad: "3000000000000000000000000",
    })).toBe(false);
    expect(isAuthoritativeChartPayload({
      ...MARKET_CHART,
      valuationMetric: "fdv",
    })).toBe(false);
    expect(isAuthoritativeChartPayload({
      ...MARKET_CHART,
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        valueUsdWad: "3000000000000000000000000",
        fdvUsdWad: "3000000000000000000000000",
        totalSupply: "1000000",
        asOfTime: MARKET_CHART.asOfTime,
        freshness: "current",
      },
    })).toBe(false);
    expect(isAuthoritativeChartPayload({
      status: "ready",
      points: MARKET_CHART.points,
      swapCount: 2,
    })).toBe(false);
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
