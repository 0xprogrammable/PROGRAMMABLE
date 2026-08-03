"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { useLiveDataRefresh } from "@/components/use-live-data-refresh";
import { getExplorePreviewChart } from "@/components/explore-preview-data";

import styles from "./token-price-chart.module.css";

type ChartPoint = {
  blockNumber: string;
  priceEth: string;
  priceUsd?: string;
};

type ChartPayload = {
  status: "ready" | "insufficient-history" | "not-deployed";
  points: ChartPoint[];
  swapCount: number;
  volumeWei: string;
  volumeEth: string;
  volumeUsdWad?: string;
};

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
type ChartLaunchModel = "classic" | "adaptive" | "deep" | "stock-paired";

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
        maximumFractionDigits: 4,
      }).format(value);
    }
    return `$${value.toLocaleString("en-US", {
      maximumSignificantDigits: 5,
      useGrouping: false,
    })}`;
  }
  return `${value.toLocaleString("en-US", {
    maximumSignificantDigits: 5,
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

export function TokenPriceChart({
  tokenAddress,
  tokenName,
  launchModel,
  preview = false,
  onVolumeChange,
}: {
  tokenAddress: `0x${string}`;
  tokenName: string;
  launchModel?: ChartLaunchModel;
  preview?: boolean;
  onVolumeChange?: (volume: TokenChartVolume | null) => void;
}) {
  const [request, setRequest] = useState<{
    key: string;
    payload: ChartPayload | null;
    failed: boolean;
  } | null>(null);
  const [range, setRange] = useState<ChartRange>("all");
  const refreshTaskRef = useRef<SerializedChartRefresh | null>(null);
  const refreshKey = useLiveDataRefresh({
    enabled: launchModel !== "stock-paired" && !preview,
  });
  const gradientId = useId().replaceAll(":", "");
  const requestKey = `${tokenAddress.toLowerCase()}:${range}`;
  const previewPayload = useMemo(
    () => (preview ? getExplorePreviewChart(tokenAddress, range) : null),
    [preview, range, tokenAddress],
  );
  const payload =
    previewPayload ??
    (launchModel === "stock-paired"
      ? STOCK_PAIRED_EMPTY_CHART
      : request?.key === requestKey
        ? request.payload
        : null);
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
        const response = await fetch(
          `/api/explore/token/chart?address=${encodeURIComponent(tokenAddress)}&range=${range}`,
          { signal },
        );
        if (!response.ok) throw new Error("Chart request failed");
        const nextPayload = (await response.json()) as ChartPayload;
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
      className={styles.shell}
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
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Price</p>
          <p className={styles.value}>
            {chart
              ? formatPrice(chart.current, chart.unit)
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
        <div className={styles.placeholder} aria-hidden="true">
          <span className={styles.loadingLine} />
        </div>
      ) : chart ? (
        <div className={styles.plot}>
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
          </svg>
        </div>
      ) : (
        <div className={styles.placeholder}>
          <p>{emptyMessage}</p>
        </div>
      )}
    </section>
  );
}
