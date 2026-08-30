"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { formatMarketCapMetric } from "@/components/animated-market-cap";
import { getExplorePreviewChart } from "@/components/explore-preview-data";
import {
  isMarketChartV1,
  type MarketChartV1,
} from "@/lib/market-data/market-data-v1";

import styles from "./token-price-chart.module.css";

export type TokenChartPoint = {
  blockNumber: string;
  time?: string;
  bucketStart?: string;
  bucketEnd?: string;
  observedAt?: string;
  valueSemantics?: "period-median";
  priceEth?: string;
  priceUsd?: string;
  marketCapUsd?: string;
  priceQuote?: string;
  quoteSymbol?: string;
};

export type TokenChartPayload = {
  status:
    | "ready"
    | "insufficient-history"
    | "partial"
    | "waiting-for-first-trade";
  points: TokenChartPoint[];
  swapCount: number;
  volumeWei?: string;
  volumeEth?: string;
  volumeUsdWad?: string;
  marketData?: MarketChartV1;
};
type ChartPayload = TokenChartPayload;
type ChartRequestState = {
  key: string;
  payload: ChartPayload | null;
  failed: boolean;
};

type PlottedPoint = TokenChartPoint & {
  x: number;
  y: number;
  value: number;
};

export type ChartRange = "1h" | "1d" | "1w" | "all";
export type TokenChartVolume = {
  range: ChartRange;
  pending: boolean;
  volumeEth?: string;
  volumeUsdWad?: string;
};
type ChartLaunchModel = "classic" | "adaptive" | "deep" | "stock-paired";

const chartPayloadCache = new Map<
  string,
  Readonly<{ payload: ChartPayload; updatedAt: number }>
>();
const chartPayloadRequests = new Map<string, Promise<ChartPayload>>();
const MAX_CHART_PAYLOAD_CACHE_ENTRIES = 64;
const CHART_PAYLOAD_CACHE_CURRENT_MAX_AGE_MS = 60_000;
const CHART_REFRESH_INTERVAL_MS = 60_000;

function cacheChartPayload(key: string, payload: ChartPayload) {
  chartPayloadCache.delete(key);
  chartPayloadCache.set(key, { payload, updatedAt: Date.now() });
  while (chartPayloadCache.size > MAX_CHART_PAYLOAD_CACHE_ENTRIES) {
    const oldest = chartPayloadCache.keys().next().value;
    if (oldest === undefined) return;
    chartPayloadCache.delete(oldest);
  }
}

export function isAuthoritativeChartPayloadStatus(status: unknown) {
  return (
    status === "ready" ||
    status === "insufficient-history" ||
    status === "partial" ||
    status === "waiting-for-first-trade"
  );
}

export function parseAuthoritativeChartPayload(
  value: unknown,
): ChartPayload | null {
  if (
    !isMarketChartV1(value) ||
    value.status === "unavailable" ||
    value.valuation.status !== "unavailable" ||
    value.valuation.reason !== "source-unavailable" ||
    "fdvEthWei" in value ||
    "fdvEth" in value ||
    "fdvUsdWad" in value ||
    "valuationMetric" in value
  ) return null;
  return {
    status: value.status,
    points: [...value.points],
    swapCount: value.swapCount,
    ...(value.volumeUsdWad ? { volumeUsdWad: value.volumeUsdWad } : {}),
    marketData: value,
  };
}

export function isAuthoritativeChartPayload(
  value: unknown,
): value is ChartPayload {
  return parseAuthoritativeChartPayload(value) !== null;
}

export function preserveChartPayloadOnFailure(
  current: ChartRequestState | null,
  key: string,
  cachedPayload: ChartPayload | null,
): ChartRequestState {
  const currentPayload =
    current?.key === key && current.payload ? current.payload : null;
  return {
    key,
    payload: currentPayload ?? cachedPayload,
    failed: true,
  };
}

export function acceptChartPayload(
  key: string,
  payload: ChartPayload,
): ChartRequestState {
  return { key, payload, failed: false };
}

async function requestTokenChartPayload(
  tokenAddress: `0x${string}`,
  range: ChartRange,
  allowCache: boolean,
) {
  const key = `${tokenAddress.toLowerCase()}:${range}`;
  const active = chartPayloadRequests.get(key);
  if (active) return active;
  const cached = chartPayloadCache.get(key);
  if (
    allowCache &&
    cached &&
    Date.now() - cached.updatedAt < CHART_PAYLOAD_CACHE_CURRENT_MAX_AGE_MS
  ) {
    return cached.payload;
  }
  const request = fetch(
    `/api/explore/token/chart?address=${encodeURIComponent(tokenAddress)}&range=${range}`,
    { headers: { Accept: "application/json" } },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error("Chart request failed");
      const value: unknown = await response.json();
      const payload = parseAuthoritativeChartPayload(value);
      if (payload === null) {
        throw new Error("Chart source is not ready");
      }
      if (allowCache && payload.status !== "partial") {
        cacheChartPayload(key, payload);
      }
      return payload;
    })
    .finally(() => {
      if (chartPayloadRequests.get(key) === request) {
        chartPayloadRequests.delete(key);
      }
    });
  chartPayloadRequests.set(key, request);
  return request;
}

export function preloadTokenChart(
  tokenAddress: `0x${string}`,
  range: ChartRange = "1d",
) {
  return requestTokenChartPayload(tokenAddress, range, true).catch(() => null);
}

type SerializedChartRefresh = {
  request(): void;
  stop(): void;
};

export function createSerializedChartRefresh(
  run: (signal: AbortSignal) => Promise<void>,
): SerializedChartRefresh {
  let active: Promise<void> | null = null;
  let activeController: AbortController | null = null;
  let queued = false;
  let stopped = false;

  function request() {
    if (stopped) return;
    if (active) {
      queued = true;
      return;
    }

    activeController = new AbortController();
    const signal = activeController.signal;
    active = Promise.resolve()
      .then(() => run(signal))
      .catch(() => undefined)
      .finally(() => {
        active = null;
        activeController = null;
        if (!queued || stopped) return;
        queued = false;
        request();
      });
  }

  return {
    request,
    stop() {
      stopped = true;
      queued = false;
      activeController?.abort();
    },
  };
}

const STOCK_PAIRED_HISTORY_MESSAGE =
  "Historical price data is not available for Stock-Paired tokens";
const STOCK_PAIRED_EMPTY_CHART: ChartPayload = {
  status: "insufficient-history",
  points: [],
  swapCount: 0,
  volumeWei: "0",
  volumeEth: "0",
};

export function getPriceHistoryEmptyMessage(
  launchModel: ChartLaunchModel | undefined,
  failed: boolean,
  waitingForFirstTrade = false,
) {
  if (launchModel === "stock-paired") {
    return STOCK_PAIRED_HISTORY_MESSAGE;
  }
  if (waitingForFirstTrade) return "Waiting for first trade";
  return failed ? "Price history is temporarily unavailable" : "";
}

export function shouldRenderPriceHistory(input: {
  loading: boolean;
  hasChart: boolean;
  range: ChartRange;
}) {
  return (
    input.loading ||
    input.hasChart ||
    CHART_RANGES.some(({ value }) => value === input.range)
  );
}

const CHART_RANGES: ReadonlyArray<{
  value: ChartRange;
  label: string;
}> = [
  { value: "1h", label: "1H" },
  { value: "1d", label: "1D" },
  { value: "1w", label: "1W" },
  { value: "all", label: "ALL" },
];

function shouldEnablePriceHistory(
  launchModel: ChartLaunchModel | undefined,
): boolean {
  return launchModel !== "stock-paired";
}

const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 132;
const PLOT_LEFT = 7;
const PLOT_RIGHT = VIEWBOX_WIDTH - 7;
const PLOT_TOP = 9;
const PLOT_BOTTOM = VIEWBOX_HEIGHT - 9;

function formatPriceMagnitude(value: number) {
  if (value > 0 && value < 0.000001) {
    const magnitude = Math.floor(Math.log10(value));
    const decimalPlaces = Math.min(18, Math.max(6, -magnitude + 5));
    return value
      .toFixed(decimalPlaces)
      .replace(/0+$/u, "")
      .replace(/\.$/u, "");
  }

  return new Intl.NumberFormat("en-US", {
    maximumSignificantDigits: 6,
    useGrouping: true,
  }).format(value);
}

export function formatPrice(value: number, unit: string) {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  if (unit === "USD") {
    return `$${formatPriceMagnitude(value)}`;
  }
  return `${formatPriceMagnitude(value)} ${unit}`;
}

function formatChartValue(
  value: number,
  unit: string,
  metric: "market-cap" | "price",
) {
  return metric === "market-cap"
    ? formatMarketCapMetric({ kind: "usd", value })
    : formatPrice(value, unit);
}

function marketCapUsdForPoint(
  point: TokenChartPoint,
  totalSupply: string | undefined,
) {
  if (!totalSupply || !point.priceUsd) return undefined;
  const price = Number(point.priceUsd);
  const supply = Number(totalSupply);
  const marketCap = price * supply;
  return Number.isFinite(price) && price > 0 &&
      Number.isFinite(supply) && supply > 0 &&
      Number.isFinite(marketCap) && marketCap > 0
    ? marketCap.toString()
    : undefined;
}

function positiveChartNumber(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function bindMarketCapHistory(
  points: readonly TokenChartPoint[],
  totalSupply?: string,
  currentMarketCapUsd?: string,
): TokenChartPoint[] {
  if (points.length === 0) return [];
  if (points.every((point) => positiveChartNumber(point.marketCapUsd) !== null)) {
    return points.map((point) => ({ ...point }));
  }

  if (
    positiveChartNumber(totalSupply) !== null &&
    points.every((point) => positiveChartNumber(point.priceUsd) !== null)
  ) {
    return points.map((point) => ({
      ...point,
      marketCapUsd: marketCapUsdForPoint(point, totalSupply),
    }));
  }

  const anchorMarketCap = positiveChartNumber(currentMarketCapUsd);
  if (anchorMarketCap === null) return points.map((point) => ({ ...point }));

  const priceField = (["priceUsd", "priceEth", "priceQuote"] as const).find(
    (field) => points.every((point) => positiveChartNumber(point[field]) !== null),
  );
  if (!priceField) return points.map((point) => ({ ...point }));
  if (priceField === "priceQuote") {
    const quoteSymbols = new Set(
      points.map((point) => point.quoteSymbol?.trim()).filter(Boolean),
    );
    if (quoteSymbols.size !== 1) return points.map((point) => ({ ...point }));
  }

  const latestPrice = positiveChartNumber(points.at(-1)?.[priceField]);
  if (latestPrice === null) return points.map((point) => ({ ...point }));

  return points.map((point) => ({
    ...point,
    marketCapUsd: (
      anchorMarketCap *
      (positiveChartNumber(point[priceField]) as number) /
      latestPrice
    ).toString(),
  }));
}

export function selectChartMetric(
  points: readonly TokenChartPoint[],
  totalSupply?: string,
  currentMarketCapUsd?: string,
): "market-cap" | "price" {
  const boundPoints = bindMarketCapHistory(
    points,
    totalSupply,
    currentMarketCapUsd,
  );
  return boundPoints.length > 0 && boundPoints.every(
      (point) => positiveChartNumber(point.marketCapUsd) !== null,
    )
    ? "market-cap"
    : "price";
}

function chartPointContext(point: TokenChartPoint): string {
  const timestamp = point.valueSemantics === "period-median"
    ? point.time ?? point.bucketEnd ?? point.bucketStart
    : point.time;
  if (timestamp && Number.isFinite(Date.parse(timestamp))) {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      hour12: true,
    }).format(new Date(timestamp));
  }
  return `Block ${point.blockNumber}`;
}

function linePath(points: PlottedPoint[]) {
  if (points.length === 0) return "";

  return points.slice(1).reduce(
    (path, point, index) => {
      const previous = points[index];
      const midpoint = (previous.x + point.x) / 2;
      return `${path} C${midpoint.toFixed(2)},${previous.y.toFixed(2)} ${midpoint.toFixed(2)},${point.y.toFixed(2)} ${point.x.toFixed(2)},${point.y.toFixed(2)}`;
    },
    `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`,
  );
}

export function createChartGeometry(
  points: readonly TokenChartPoint[],
  metric: "market-cap" | "price" = "price",
) {
  if (points.length === 0) return null;
  const usesMarketCap = metric === "market-cap";
  const usesUsd = points.every((point) => {
    const value = usesMarketCap ? point.marketCapUsd : point.priceUsd;
    return value && Number(value) > 0;
  });
  if (usesMarketCap && !usesUsd) return null;
  const usesEth = !usesUsd && points.every(
    (point) => point.priceEth && Number(point.priceEth) > 0,
  );
  const quoteSymbols = new Set(
    points.map((point) => point.quoteSymbol?.trim()).filter(Boolean),
  );
  const unit = usesUsd
    ? "USD"
    : usesEth
      ? "ETH"
      : quoteSymbols.size === 1
        ? [...quoteSymbols][0] as string
        : "quote";
  const validPoints = points
    .map((point) => ({
      ...point,
      value: Number(
        usesMarketCap || usesUsd
          ? usesMarketCap
            ? point.marketCapUsd
            : point.priceUsd
          : usesEth
            ? point.priceEth
            : point.priceQuote,
      ),
    }))
    .filter((point) => Number.isFinite(point.value) && point.value > 0);
  if (validPoints.length === 0) return null;

  const values = validPoints.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum || maximum * 0.02 || 1;
  const domainMinimum = Math.max(0, minimum - span * 0.1);
  const domainMaximum = maximum + span * 0.1;
  const domainSpan = domainMaximum - domainMinimum || 1;
  const singlePoint = validPoints.length === 1;
  const plottedPoints: PlottedPoint[] = validPoints.map((point, index) => ({
    ...point,
    x: singlePoint
      ? (PLOT_LEFT + PLOT_RIGHT) / 2
      : PLOT_LEFT +
        (index / (validPoints.length - 1)) * (PLOT_RIGHT - PLOT_LEFT),
    y:
      PLOT_BOTTOM -
      ((point.value - domainMinimum) / domainSpan) *
        (PLOT_BOTTOM - PLOT_TOP),
  }));
  const path = singlePoint ? "" : linePath(plottedPoints);
  const latestValue = plottedPoints.at(-1)?.value ?? plottedPoints[0].value;

  return {
    unit,
    points: plottedPoints,
    path,
    areaPath: path
      ? `${path} L${PLOT_RIGHT},${VIEWBOX_HEIGHT} L${PLOT_LEFT},${VIEWBOX_HEIGHT} Z`
      : "",
    latestValue,
  } as const;
}

export function nearestChartPointIndex(
  clientX: number,
  boundsLeft: number,
  boundsWidth: number,
  pointCount: number,
) {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(boundsLeft) ||
    !Number.isFinite(boundsWidth) ||
    boundsWidth <= 0 ||
    !Number.isSafeInteger(pointCount) ||
    pointCount < 1
  ) {
    return 0;
  }
  const pointerX =
    ((clientX - boundsLeft) / boundsWidth) * VIEWBOX_WIDTH;
  const normalized = Math.min(
    1,
    Math.max(0, (pointerX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT)),
  );
  return Math.round(normalized * (pointCount - 1));
}

export function getChartKeyboardInspectionIndex(
  key: string,
  activeIndex: number | null,
  pointCount: number,
) {
  if (!Number.isSafeInteger(pointCount) || pointCount < 1) return undefined;

  const lastIndex = pointCount - 1;
  const current = Math.min(lastIndex, Math.max(0, activeIndex ?? lastIndex));

  if (key === "ArrowLeft" || key === "ArrowDown") {
    return Math.max(0, current - 1);
  }
  if (key === "ArrowRight" || key === "ArrowUp") {
    return Math.min(lastIndex, current + 1);
  }
  if (key === "Home") return 0;
  if (key === "End") return lastIndex;
  if (key === "Escape") return null;
  return undefined;
}

export function shouldClearChartInspectionAfterPointerUp(
  pointerType: string,
) {
  return pointerType !== "mouse";
}

export function TokenPriceChart({
  tokenAddress,
  tokenName,
  launchModel,
  totalSupply,
  currentMarketCapUsd,
  preview = false,
  onVolumeChange,
}: {
  tokenAddress: `0x${string}`;
  tokenName: string;
  launchModel?: ChartLaunchModel;
  totalSupply?: string;
  currentMarketCapUsd?: string;
  preview?: boolean;
  onVolumeChange?: (volume: TokenChartVolume | null) => void;
}) {
  // Live history is read only through the exact pool-bound chart endpoint.
  // Stock-Paired families intentionally remain outside the public chart scope.
  const historyEnabled = shouldEnablePriceHistory(launchModel);
  const [request, setRequest] = useState<ChartRequestState | null>(null);
  const [range, setRange] = useState<ChartRange>("1d");
  const [activePointIndex, setActivePointIndex] = useState<number | null>(
    null,
  );
  const refreshTaskRef = useRef<SerializedChartRefresh | null>(null);
  const chartCacheable = launchModel === "classic";
  const refreshKey = useLiveDataRefresh({
    enabled: historyEnabled && launchModel !== "stock-paired" && !preview,
    intervalMs: CHART_REFRESH_INTERVAL_MS,
  });
  const chartId = useId().replaceAll(":", "");
  const gradientId = `${chartId}-fill`;
  const instructionId = `${chartId}-instructions`;
  const activeValueId = `${chartId}-active-value`;
  const requestKey = `${tokenAddress.toLowerCase()}:${range}`;
  const previewPayload = useMemo(
    () => (preview ? getExplorePreviewChart(tokenAddress, range) : null),
    [preview, range, tokenAddress],
  );
  const payload: ChartPayload | null =
    previewPayload ??
    (launchModel === "stock-paired"
      ? STOCK_PAIRED_EMPTY_CHART
      : request?.key === requestKey
        ? request.payload
        : (chartPayloadCache.get(requestKey)?.payload ?? null));
  const failed =
    preview
      ? false
      : !historyEnabled
      ? true
      : launchModel === "stock-paired"
      ? false
      : request?.key === requestKey
        ? request.failed
        : false;
  const loading = !payload && !failed;

  useEffect(() => {
    if (!historyEnabled || launchModel === "stock-paired" || preview) {
      refreshTaskRef.current = null;
      return;
    }

    const refreshTask = createSerializedChartRefresh(async (signal) => {
      try {
        const nextPayload = await requestTokenChartPayload(
          tokenAddress,
          range,
          chartCacheable,
        );
        if (signal.aborted) return;
        setRequest(acceptChartPayload(requestKey, nextPayload));
      } catch (error: unknown) {
        if (
          signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          return;
        setRequest((current) =>
          preserveChartPayloadOnFailure(
            current,
            requestKey,
            chartCacheable
              ? chartPayloadCache.get(requestKey)?.payload ?? null
              : null,
          ),
        );
      }
    });
    refreshTaskRef.current = refreshTask;
    refreshTask.request();

    return () => {
      refreshTask.stop();
      if (refreshTaskRef.current === refreshTask) {
        refreshTaskRef.current = null;
      }
    };
  }, [
    launchModel,
    historyEnabled,
    preview,
    range,
    requestKey,
    tokenAddress,
    chartCacheable,
  ]);

  useEffect(() => {
    if (refreshKey === 0) return;
    refreshTaskRef.current?.request();
  }, [refreshKey]);

  const chartPoints = useMemo(
    () => bindMarketCapHistory(
      payload?.points ?? [],
      totalSupply,
      currentMarketCapUsd,
    ),
    [currentMarketCapUsd, payload, totalSupply],
  );
  const chartMetric = selectChartMetric(chartPoints);
  const chart = useMemo(
    () => createChartGeometry(chartPoints, chartMetric),
    [chartMetric, chartPoints],
  );
  const emptyMessage = chartMetric === "market-cap"
    ? ""
    : getPriceHistoryEmptyMessage(
        launchModel,
        failed,
        payload?.status === "waiting-for-first-trade",
      );
  const activePoint =
    chart && activePointIndex !== null
      ? chart.points[Math.min(activePointIndex, chart.points.length - 1)]
      : null;
  const singleObservation =
    chart?.points.length === 1 ? chart.points[0] : null;
  const displayedPrice = activePoint?.value ?? chart?.latestValue;
  const historyLabel = chartMetric === "market-cap"
    ? "Market cap history"
    : "Price history";
  const chartStatus =
    !payload && !failed
      ? `Loading ${chartMetric === "market-cap" ? "market cap" : "price"} history`
      : chart
        ? chart.points.length === 1
          ? `${historyLabel} loaded from 1 point`
          : `${historyLabel} loaded with ${chart.points.length} points`
        : emptyMessage;

  useEffect(() => {
    if (!historyEnabled || launchModel === "stock-paired" || range === "all") {
      onVolumeChange?.(null);
      return;
    }

    if (!payload) {
      onVolumeChange?.({
        range,
        pending: !failed,
      });
      return;
    }

    onVolumeChange?.({
      range,
      pending: false,
      volumeEth: payload.volumeEth,
      volumeUsdWad: payload.volumeUsdWad,
    });
  }, [failed, historyEnabled, launchModel, onVolumeChange, payload, range]);

  function inspectPointer(event: PointerEvent<HTMLDivElement>) {
    if (!chart) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    setActivePointIndex(
      nearestChartPointIndex(
        event.clientX,
        bounds.left,
        bounds.width,
        chart.points.length,
      ),
    );
  }

  function inspectKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!chart) return;
    const next = getChartKeyboardInspectionIndex(
      event.key,
      activePointIndex,
      chart.points.length,
    );
    if (next === undefined) return;

    event.preventDefault();
    setActivePointIndex(next);
  }

  if (
    !shouldRenderPriceHistory({
      loading,
      hasChart: Boolean(chart),
      range,
    })
  ) {
    return null;
  }

  return (
    <section
      className={`${styles.shell} liquid-glass-surface`}
      aria-busy={loading}
      aria-label={`${tokenName} ${chartMetric === "market-cap" ? "market cap" : "price"} history`}
    >
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {chartStatus}
      </span>
      <span className="sr-only" id={instructionId}>
        Use the left and right arrow keys to inspect each chart value. Press
        Home or End for the first or last value, and Escape to stop inspecting.
      </span>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            {chartMetric === "market-cap"
              ? "Market cap"
              : "Last verified price"}
          </p>
          <p className={styles.value}>
            {chart && displayedPrice !== undefined
              ? `${formatChartValue(displayedPrice, chart.unit, chartMetric)}${
                  chartMetric === "price" ? ` per ${tokenName}` : ""
                }`
              : !loading || launchModel === "stock-paired"
                ? chartMetric === "market-cap"
                  ? ""
                  : "Unavailable"
                : "—"}
          </p>
          <p className={styles.context} aria-hidden="true">
            {activePoint
              ? chartPointContext(activePoint)
              : singleObservation
                ? `1 verified observation · ${chartPointContext(singleObservation)}`
                : "\u00A0"}
          </p>
        </div>
        {historyEnabled && launchModel !== "stock-paired" ? (
          <div className={styles.ranges} aria-label="Chart range" role="group">
            {CHART_RANGES.map((option) => (
              <button
                className={styles.rangeButton}
                type="button"
                aria-pressed={range === option.value}
                key={option.value}
                onClick={() => {
                  if (option.value === range) return;
                  onVolumeChange?.(
                    option.value === "all"
                      ? null
                      : { range: option.value, pending: true },
                  );
                  setActivePointIndex(null);
                  setRange(option.value);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className={`${styles.plot} ${styles.waitingPlot}`} aria-hidden="true" />
      ) : singleObservation && chart ? (
        <div className={styles.placeholder} role="note">
          <p>
            <span
              className={`${styles.inspectionDot} ${styles.singleObservationDot}`}
              aria-hidden="true"
            />
            One verified observation. The chart will appear as more history is
            recorded.
          </p>
        </div>
      ) : chart ? (
        <div
          className={styles.plot}
          role="group"
          tabIndex={0}
          aria-label={`${tokenName} interactive ${chartMetric === "market-cap" ? "market cap" : "price"} chart. Move the pointer or use arrow keys to inspect chart values.`}
          aria-describedby={`${instructionId} ${activeValueId}`}
          onBlur={() => setActivePointIndex(null)}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible")) {
              setActivePointIndex(chart.points.length - 1);
            }
          }}
          onKeyDown={inspectKeyboard}
          onPointerDown={inspectPointer}
          onPointerEnter={inspectPointer}
          onPointerMove={inspectPointer}
          onPointerUp={(event) => {
            if (shouldClearChartInspectionAfterPointerUp(event.pointerType)) {
              setActivePointIndex(null);
              return;
            }
            inspectPointer(event);
          }}
          onPointerCancel={() => setActivePointIndex(null)}
          onPointerLeave={() => setActivePointIndex(null)}
        >
          <svg
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--brand-ivory)"
                  stopOpacity="0.18"
                />
                <stop
                  offset="100%"
                  stopColor="var(--brand-ivory)"
                  stopOpacity="0"
                />
              </linearGradient>
            </defs>
            {[0.42, 0.84].map((position) => {
              const y = PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * position;
              return (
                <line
                  className={styles.grid}
                  key={position}
                  x1={PLOT_LEFT}
                  x2={PLOT_RIGHT}
                  y1={y}
                  y2={y}
                />
              );
            })}
            {chart.areaPath ? (
              <path
                className={styles.area}
                d={chart.areaPath}
                fill={`url(#${gradientId})`}
              />
            ) : null}
            {chart.path ? (
              <path className={styles.line} d={chart.path} />
            ) : null}
            {activePoint ? (
              <line
                className={styles.hoverGuide}
                x1={activePoint.x}
                x2={activePoint.x}
                y1={PLOT_TOP}
                y2={PLOT_BOTTOM}
              />
            ) : null}
          </svg>
          {activePoint ? (
            <span
              className={styles.inspectionDot}
              style={{
                left: `${(activePoint.x / VIEWBOX_WIDTH) * 100}%`,
                top: `${(activePoint.y / VIEWBOX_HEIGHT) * 100}%`,
              }}
              aria-hidden="true"
            />
          ) : null}
          <span
            className="sr-only"
            id={activeValueId}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {activePoint
              ? `${formatChartValue(activePoint.value, chart.unit, chartMetric)}, ${chartPointContext(activePoint)}`
              : ""}
          </span>
        </div>
      ) : (
        <div className={styles.placeholder}>
          {emptyMessage ? <p>{emptyMessage}</p> : null}
        </div>
      )}
    </section>
  );
}
