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
import { getExplorePreviewChart } from "@/components/explore-preview-data";

import styles from "./token-price-chart.module.css";

type ChartPoint = {
  blockNumber: string;
  priceEth: string;
  priceUsd?: string;
};

export type TokenChartPayload = {
  status: "ready" | "insufficient-history" | "not-deployed";
  points: ChartPoint[];
  swapCount: number;
  volumeWei: string;
  volumeEth: string;
  volumeUsdWad?: string;
  marketCapEthWei?: string;
  marketCapEth?: string;
  marketCapUsdWad?: string;
};
type ChartPayload = TokenChartPayload;

type PlottedPoint = ChartPoint & {
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
export type TokenChartMarketCap = {
  marketCapEthWei?: string;
  marketCapEth?: string;
  marketCapUsdWad?: string;
};
type ChartLaunchModel = "classic" | "adaptive" | "deep" | "stock-paired";

const chartPayloadCache = new Map<
  string,
  Readonly<{ payload: ChartPayload; updatedAt: number }>
>();
const chartPayloadRequests = new Map<string, Promise<ChartPayload>>();
const MAX_CHART_PAYLOAD_CACHE_ENTRIES = 64;

function cacheChartPayload(key: string, payload: ChartPayload) {
  chartPayloadCache.delete(key);
  chartPayloadCache.set(key, { payload, updatedAt: Date.now() });
  while (chartPayloadCache.size > MAX_CHART_PAYLOAD_CACHE_ENTRIES) {
    const oldest = chartPayloadCache.keys().next().value;
    if (oldest === undefined) return;
    chartPayloadCache.delete(oldest);
  }
}

async function requestTokenChartPayload(
  tokenAddress: `0x${string}`,
  range: ChartRange,
) {
  const key = `${tokenAddress.toLowerCase()}:${range}`;
  const active = chartPayloadRequests.get(key);
  if (active) return active;
  const cached = chartPayloadCache.get(key);
  if (cached && Date.now() - cached.updatedAt < 2_000) {
    return cached.payload;
  }
  const request = fetch(
    `/api/explore/token/chart?address=${encodeURIComponent(tokenAddress)}&range=${range}`,
    { headers: { Accept: "application/json" } },
  )
    .then(async (response) => {
      if (!response.ok) throw new Error("Chart request failed");
      const payload = (await response.json()) as ChartPayload;
      cacheChartPayload(key, payload);
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
  return requestTokenChartPayload(tokenAddress, range).catch(() => null);
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
) {
  if (launchModel === "stock-paired") {
    return STOCK_PAIRED_HISTORY_MESSAGE;
  }
  return failed
    ? "Price history is temporarily unavailable"
    : "Price history appears after confirmed trades";
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

const VIEWBOX_WIDTH = 600;
const VIEWBOX_HEIGHT = 132;
const PLOT_LEFT = 7;
const PLOT_RIGHT = VIEWBOX_WIDTH - 7;
const PLOT_TOP = 9;
const PLOT_BOTTOM = VIEWBOX_HEIGHT - 9;

function formatPrice(value: number, unit: "USD" | "ETH") {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  if (unit === "USD") {
    if (value >= 1) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 6,
      }).format(value);
    }
    return `$${value.toLocaleString("en-US", {
      maximumSignificantDigits: 8,
      useGrouping: false,
    })}`;
  }
  return `${value.toLocaleString("en-US", {
    maximumSignificantDigits: 8,
    useGrouping: false,
  })} ETH`;
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

export function TokenPriceChart({
  tokenAddress,
  tokenName,
  launchModel,
  preview = false,
  onVolumeChange,
  onMarketCapChange,
}: {
  tokenAddress: `0x${string}`;
  tokenName: string;
  launchModel?: ChartLaunchModel;
  preview?: boolean;
  onVolumeChange?: (volume: TokenChartVolume | null) => void;
  onMarketCapChange?: (marketCap: TokenChartMarketCap | null) => void;
}) {
  const [request, setRequest] = useState<{
    key: string;
    payload: ChartPayload | null;
    failed: boolean;
  } | null>(null);
  const [range, setRange] = useState<ChartRange>("1d");
  const [activePointIndex, setActivePointIndex] = useState<number | null>(
    null,
  );
  const refreshTaskRef = useRef<SerializedChartRefresh | null>(null);
  const refreshKey = useLiveDataRefresh({
    enabled: launchModel !== "stock-paired" && !preview,
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
      : launchModel === "stock-paired"
      ? false
      : request?.key === requestKey
        ? request.failed
        : false;
  const loading = !payload && !failed;

  useEffect(() => {
    if (launchModel === "stock-paired" || preview) {
      refreshTaskRef.current = null;
      return;
    }

    const refreshTask = createSerializedChartRefresh(async (signal) => {
      try {
        const nextPayload = await requestTokenChartPayload(
          tokenAddress,
          range,
        );
        if (signal.aborted) return;
        setRequest({
          key: requestKey,
          payload: nextPayload,
          failed: false,
        });
      } catch (error: unknown) {
        if (
          signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        )
          return;
        setRequest((current) =>
          current?.key === requestKey && current.payload
            ? current
            : { key: requestKey, payload: null, failed: true },
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
    preview,
    range,
    requestKey,
    tokenAddress,
  ]);

  useEffect(() => {
    if (refreshKey === 0) return;
    refreshTaskRef.current?.request();
  }, [refreshKey]);

  const chart = useMemo(() => {
    if (!payload || payload.points.length < 2) return null;
    const usesUsd = payload.points.every(
      (point) => point.priceUsd && Number(point.priceUsd) > 0,
    );
    const unit = usesUsd ? "USD" : "ETH";
    const validPoints = payload.points
      .map((point) => ({
        ...point,
        value: Number(usesUsd ? point.priceUsd : point.priceEth),
      }))
      .filter((point) => Number.isFinite(point.value) && point.value > 0);
    if (validPoints.length < 2) return null;

    const values = validPoints.map((point) => point.value);
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const span = maximum - minimum || maximum * 0.02 || 1;
    const points: PlottedPoint[] = validPoints.map((point, index) => ({
      ...point,
      x:
        PLOT_LEFT +
        (index / (validPoints.length - 1)) * (PLOT_RIGHT - PLOT_LEFT),
      y:
        PLOT_BOTTOM -
        ((point.value - minimum) / span) * (PLOT_BOTTOM - PLOT_TOP),
    }));
    const path = linePath(points);
    const last = points.at(-1)?.value ?? points[0].value;

    return {
      unit,
      points,
      path,
      areaPath: `${path} L${PLOT_RIGHT},${VIEWBOX_HEIGHT} L${PLOT_LEFT},${VIEWBOX_HEIGHT} Z`,
      current: last,
    } as const;
  }, [payload]);

  const emptyMessage = getPriceHistoryEmptyMessage(launchModel, failed);
  const activePoint =
    chart && activePointIndex !== null
      ? chart.points[Math.min(activePointIndex, chart.points.length - 1)]
      : null;
  const displayedPrice = activePoint?.value ?? chart?.current;
  const chartStatus =
    !payload && !failed
      ? "Loading price history"
      : chart
        ? `Price history loaded with ${chart.points.length} points`
        : emptyMessage;

  useEffect(() => {
    if (launchModel === "stock-paired" || range === "all") {
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
  }, [failed, launchModel, onVolumeChange, payload, range]);

  useEffect(() => {
    if (!payload) {
      onMarketCapChange?.(null);
      return;
    }
    onMarketCapChange?.({
      marketCapEthWei: payload.marketCapEthWei,
      marketCapEth: payload.marketCapEth,
      marketCapUsdWad: payload.marketCapUsdWad,
    });
  }, [onMarketCapChange, payload]);

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
    const lastIndex = chart.points.length - 1;
    const current = activePointIndex ?? lastIndex;
    let next: number | null = null;

    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = Math.max(0, current - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = Math.min(lastIndex, current + 1);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = lastIndex;
    } else if (event.key === "Escape") {
      setActivePointIndex(null);
      return;
    } else {
      return;
    }

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
      className={`${styles.shell} liquid-glass-surface liquid-glass-distortion`}
      aria-busy={loading}
      aria-label={`${tokenName} price history`}
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
        Use the left and right arrow keys to inspect each recorded price. Press
        Home or End for the first or latest point, and Escape to return to the
        latest price.
      </span>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Price</p>
          <p className={styles.value}>
            {chart && displayedPrice !== undefined
              ? formatPrice(displayedPrice, chart.unit)
              : !loading || launchModel === "stock-paired"
                ? "Unavailable"
                : "—"}
          </p>
        </div>
        {launchModel !== "stock-paired" ? (
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
      ) : chart ? (
        <div
          className={styles.plot}
          tabIndex={0}
          aria-label={`${tokenName} interactive price chart. Move the pointer or use arrow keys to inspect exact prices.`}
          aria-describedby={`${instructionId} ${activeValueId}`}
          onBlur={() => setActivePointIndex(null)}
          onKeyDown={inspectKeyboard}
          onPointerDown={inspectPointer}
          onPointerEnter={inspectPointer}
          onPointerMove={inspectPointer}
          onPointerUp={inspectPointer}
          onPointerCancel={() => setActivePointIndex(null)}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setActivePointIndex(null);
          }}
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
                  stopColor="var(--accent)"
                  stopOpacity="0.18"
                />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.34, 0.68, 1].map((position) => {
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
            <path
              className={styles.area}
              d={chart.areaPath}
              fill={`url(#${gradientId})`}
            />
            <path className={styles.line} d={chart.path} />
            {activePoint ? (
              <>
                <line
                  className={styles.hoverGuide}
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={PLOT_TOP}
                  y2={PLOT_BOTTOM}
                />
                <circle
                  className={styles.hoverDot}
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="4.5"
                />
              </>
            ) : null}
          </svg>
          {activePoint ? (
            <div
              className={styles.tooltip}
              data-vertical={activePoint.y < 44 ? "below" : "above"}
              style={{
                left: `clamp(4.5rem, ${(activePoint.x / VIEWBOX_WIDTH) * 100}%, calc(100% - 4.5rem))`,
                top: `${(activePoint.y / VIEWBOX_HEIGHT) * 100}%`,
              }}
              aria-hidden="true"
            >
              <strong>{formatPrice(activePoint.value, chart.unit)}</strong>
              <span>Block {activePoint.blockNumber}</span>
            </div>
          ) : null}
          <span
            className="sr-only"
            id={activeValueId}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {activePoint
              ? `${formatPrice(activePoint.value, chart.unit)}, block ${activePoint.blockNumber}`
              : ""}
          </span>
        </div>
      ) : (
        <div className={styles.placeholder}>
          <p>{emptyMessage}</p>
        </div>
      )}
    </section>
  );
}
