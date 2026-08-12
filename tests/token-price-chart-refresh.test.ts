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

const CURRENT_DATA_QUALITY = {
  schemaVersion: "programmable.explore-chart-data-quality.v1",
  status: "current",
  asOfBlock: "100",
  blockHash: `0x${"11".repeat(32)}`,
  finality: "confirmed",
  history: { status: "current", throughBlock: "100" },
  price: { status: "current", asOfBlock: "100", lagBlocks: "0" },
  valuation: {
    status: "current",
    metric: "fdv",
    asOfBlock: "100",
    lagBlocks: "0",
  },
} as const;

const STALE_VALUATION_DATA_QUALITY = {
  ...CURRENT_DATA_QUALITY,
  status: "partial",
  valuation: {
    status: "stale",
    metric: "fdv",
    asOfBlock: "99",
    lagBlocks: "1",
  },
} as const;

const UNAVAILABLE_VALUATION_DATA_QUALITY = {
  ...CURRENT_DATA_QUALITY,
  status: "partial",
  valuation: {
    status: "unavailable",
    metric: "fdv",
  },
} as const;

const STALE_PRICE_DATA_QUALITY = {
  ...CURRENT_DATA_QUALITY,
  status: "partial",
  price: { status: "stale", asOfBlock: "99", lagBlocks: "1" },
  valuation: { status: "unavailable", metric: "fdv" },
} as const;

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

  it("updates historical FDV only from matching ETH and USD evidence", () => {
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
        { blockNumber: "1", priceEth: "0.5", priceUsd: "1250" },
        { blockNumber: "2", priceEth: "1", priceUsd: "2500" },
      ),
    ).toEqual({
      fdvEthWei: "500000000000000000000",
      fdvEth: "500",
      fdvUsdWad: "1000000000000000000000000",
    });
  });

  it("does not substitute current FDV when historical scaling underflows", () => {
    expect(
      getChartFdvAtPoint(
        {
          status: "ready",
          points: [],
          swapCount: 2,
          volumeWei: "0",
          volumeEth: "0",
          fdvEthWei: "1",
          fdvEth: "0.000000000000000001",
          fdvUsdWad: "1",
        },
        { blockNumber: "1", priceEth: "0.5" },
        { blockNumber: "2", priceEth: "1" },
      ),
    ).toEqual({});
  });

  it("never derives an inspected FDV from a period median", () => {
    expect(getChartFdvAtPoint(
      {
        status: "ready",
        points: [],
        swapCount: 2,
        fdvUsdWad: "2000000000000000000000000",
      },
      {
        blockNumber: "1",
        priceUsd: "1250",
        valueSemantics: "period-median",
      },
      {
        blockNumber: "2",
        priceUsd: "2500",
        valueSemantics: "period-median",
      },
    )).toEqual({});
  });

  it("never derives historical USD FDV from ETH or arbitrary quote ratios", () => {
    const payload = {
      status: "ready" as const,
      points: [],
      swapCount: 2,
      fdvEthWei: "1000000000000000000000",
      fdvEth: "1000",
      fdvUsdWad: "2000000000000000000000000",
    };

    expect(getChartFdvAtPoint(
      payload,
      { blockNumber: "1", priceQuote: "5", quoteSymbol: "USDC" },
      { blockNumber: "2", priceQuote: "10", quoteSymbol: "USDC" },
    )).toEqual({});
    expect(getChartFdvAtPoint(
      payload,
      { blockNumber: "1", priceEth: "0.5" },
      { blockNumber: "2", priceEth: "1", priceUsd: "2500" },
    )).toEqual({
      fdvEthWei: "500000000000000000000",
      fdvEth: "500",
    });
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
});

describe("token price chart refresh", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats source readiness as unavailable instead of authoritative zero data", () => {
    expect(isAuthoritativeChartPayloadStatus("ready")).toBe(true);
    expect(isAuthoritativeChartPayloadStatus("insufficient-history")).toBe(true);
    expect(isAuthoritativeChartPayloadStatus("not-deployed")).toBe(false);
    expect(isAuthoritativeChartPayloadStatus("partial")).toBe(true);
    expect(
      isAuthoritativeChartPayload({
        status: "ready",
        points: [
          { blockNumber: "99", priceEth: "0.1", priceUsd: "350" },
          { blockNumber: "100", priceEth: "0.2", priceUsd: "700" },
        ],
        swapCount: 2,
        volumeWei: "3",
        volumeEth: "0.000000000000000003",
        fdvEthWei: "1000000000000000000000",
        fdvEth: "1000",
        fdvUsdWad: "3000000000000000000000000",
        valuationMetric: "fdv",
        dataQuality: CURRENT_DATA_QUALITY,
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
        status: "insufficient-history",
        points: [{ blockNumber: "100", priceEth: "0.1" }],
        swapCount: 1,
        volumeWei: "1",
        volumeEth: "0.000000000000000001",
        valuationMetric: "fdv",
        dataQuality: CURRENT_DATA_QUALITY,
      }),
    ).toBe(true);
    expect(
      isAuthoritativeChartPayload({
        status: "ready",
        points: [{ blockNumber: "1", priceEth: "0.1" }],
        swapCount: 1,
        volumeWei: "1",
        volumeEth: "0.000000000000000001",
        valuationMetric: "fdv",
        dataQuality: CURRENT_DATA_QUALITY,
      }),
    ).toBe(false);
    expect(
      isAuthoritativeChartPayload({
        status: "ready",
        points: [
          { blockNumber: "99", priceEth: "0.1" },
          { blockNumber: "100", priceEth: "0.2" },
        ],
        swapCount: 2,
        volumeWei: "3",
        volumeEth: "0.000000000000000003",
        valuationMetric: "fdv",
      }),
    ).toBe(false);
    expect(
      isAuthoritativeChartPayload({
        status: "insufficient-history",
        points: [
          { blockNumber: "1", priceEth: "0.1" },
          { blockNumber: "2", priceEth: "0.2" },
        ],
        swapCount: 2,
        volumeWei: "2",
        volumeEth: "0.000000000000000002",
        valuationMetric: "fdv",
        dataQuality: CURRENT_DATA_QUALITY,
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

  it("keeps current history but strips stale FDV before acceptance", () => {
    const partialValuation = {
      status: "ready" as const,
      points: [
        { blockNumber: "99", priceEth: "0.1" },
        { blockNumber: "100", priceEth: "0.2" },
      ],
      swapCount: 2,
      volumeWei: "3",
      volumeEth: "0.000000000000000003",
      fdvEthWei: "1000000000000000000000",
      fdvEth: "1000",
      fdvUsdWad: "3000000000000000000000000",
      valuationMetric: "fdv" as const,
      dataQuality: STALE_VALUATION_DATA_QUALITY,
    };

    expect(isAuthoritativeChartPayload(partialValuation)).toBe(true);
    expect(acceptChartPayload("token:1d", partialValuation)).toEqual({
      key: "token:1d",
      payload: {
        status: "ready",
        points: partialValuation.points,
        swapCount: 2,
        volumeWei: "3",
        volumeEth: "0.000000000000000003",
        valuationMetric: "fdv",
        dataQuality: STALE_VALUATION_DATA_QUALITY,
      },
      failed: false,
    });
  });

  it("keeps current history but strips unavailable FDV before acceptance", () => {
    const partialValuation = {
      status: "ready" as const,
      points: [
        { blockNumber: "99", priceEth: "0.1" },
        { blockNumber: "100", priceEth: "0.2" },
      ],
      swapCount: 2,
      volumeWei: "3",
      volumeEth: "0.000000000000000003",
      fdvEthWei: "1000000000000000000000",
      fdvEth: "1000",
      fdvUsdWad: "3000000000000000000000000",
      valuationMetric: "fdv" as const,
      dataQuality: UNAVAILABLE_VALUATION_DATA_QUALITY,
    };

    expect(isAuthoritativeChartPayload(partialValuation)).toBe(true);
    expect(acceptChartPayload("token:1d", partialValuation).payload).toEqual({
      status: "ready",
      points: partialValuation.points,
      swapCount: 2,
      volumeWei: "3",
      volumeEth: "0.000000000000000003",
      valuationMetric: "fdv",
      dataQuality: UNAVAILABLE_VALUATION_DATA_QUALITY,
    });
  });

  it("accepts an exact stale price as limited history without caching FDV", () => {
    expect(
      isAuthoritativeChartPayload({
        status: "partial",
        points: [
          { blockNumber: "98", priceEth: "0.1" },
          { blockNumber: "99", priceEth: "0.2" },
        ],
        swapCount: 2,
        volumeWei: "3",
        volumeEth: "0.000000000000000003",
        valuationMetric: "fdv",
        dataQuality: STALE_PRICE_DATA_QUALITY,
      }),
    ).toBe(true);
  });

  it("rejects forged stale-price provenance", () => {
    expect(
      isAuthoritativeChartPayload({
        status: "partial",
        points: [
          { blockNumber: "98", priceEth: "0.1" },
          { blockNumber: "99", priceEth: "0.2" },
        ],
        swapCount: 2,
        volumeWei: "3",
        volumeEth: "0.000000000000000003",
        valuationMetric: "fdv",
        dataQuality: {
          ...STALE_PRICE_DATA_QUALITY,
          price: { status: "stale", asOfBlock: "99", lagBlocks: "2" },
        },
      }),
    ).toBe(false);
  });

  it("rejects unordered, duplicate, future, or noncanonical points before caching", () => {
    for (const points of [
      [
        { blockNumber: "100", priceEth: "0.1" },
        { blockNumber: "99", priceEth: "0.2" },
      ],
      [
        { blockNumber: "100", priceEth: "0.1" },
        { blockNumber: "100", priceEth: "0.2" },
      ],
      [
        { blockNumber: "99", priceEth: "0.1" },
        { blockNumber: "101", priceEth: "0.2" },
      ],
      [
        { blockNumber: "099", priceEth: "0.1" },
        { blockNumber: "100", priceEth: "0.2" },
      ],
    ]) {
      expect(
        isAuthoritativeChartPayload({
          status: "ready",
          points,
          swapCount: 2,
          volumeWei: "3",
          volumeEth: "0.000000000000000003",
          valuationMetric: "fdv",
          dataQuality: CURRENT_DATA_QUALITY,
        }),
      ).toBe(false);
    }
  });

  it("rejects noncanonical quality block numbers before caching", () => {
    const noncanonicalBlock = "0100";
    expect(
      isAuthoritativeChartPayload({
        status: "ready",
        points: [
          { blockNumber: "99", priceEth: "0.1" },
          { blockNumber: noncanonicalBlock, priceEth: "0.2" },
        ],
        swapCount: 2,
        volumeWei: "3",
        volumeEth: "0.000000000000000003",
        valuationMetric: "fdv",
        dataQuality: {
          ...CURRENT_DATA_QUALITY,
          asOfBlock: noncanonicalBlock,
          history: { status: "current", throughBlock: noncanonicalBlock },
          price: {
            status: "current",
            asOfBlock: noncanonicalBlock,
            lagBlocks: "0",
          },
          valuation: {
            status: "current",
            metric: "fdv",
            asOfBlock: noncanonicalBlock,
            lagBlocks: "0",
          },
        },
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
