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

export type TokenChartPoint = {
  blockNumber: string;
  priceEth: string;
  priceUsd?: string;
};

export type TokenChartPayload = {
  status: "ready" | "insufficient-history" | "not-deployed";
  points: TokenChartPoint[];
  swapCount: number;
  volumeWei: string;
  volumeEth: string;
  volumeUsdWad?: string;
  marketCapEthWei?: string;
  marketCapEth?: string;
  marketCapUsdWad?: string;
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
export type TokenChartMarketCap = {
  marketCapEthWei?: string;
  marketCapEth?: string;
  marketCapUsdWad?: string;
};

type PositiveDecimal = {
  coefficient: bigint;
  scale: bigint;
};

function parsePositiveDecimal(value?: string): PositiveDecimal | null {
  if (!value) return null;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  const coefficient = BigInt(`${match[1]}${fraction}`);
  if (coefficient <= 0n) return null;
  return {
    coefficient,
    scale: 10n ** BigInt(fraction.length),
  };
}

function scaleIntegerByPriceRatio(
  value: string | undefined,
  inspectedPrice: string | undefined,
  latestPrice: string | undefined,
) {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const inspected = parsePositiveDecimal(inspectedPrice);
  const latest = parsePositiveDecimal(latestPrice);
  if (!inspected || !latest) return undefined;
  return (
    (BigInt(value) * inspected.coefficient * latest.scale) /
    (latest.coefficient * inspected.scale)
  ).toString();
}

function formatFixedInteger(value: bigint, decimals: number) {
  const raw = value.toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, -decimals);
  const fraction = raw.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function scaleDecimalByPriceRatio(
  value: string | undefined,
  inspectedPrice: string | undefined,
  latestPrice: string | undefined,
) {
  const source = parsePositiveDecimal(value);
  const inspected = parsePositiveDecimal(inspectedPrice);
  const latest = parsePositiveDecimal(latestPrice);
  if (!source || !inspected || !latest) return undefined;
  const precision = 18;
  const numerator =
    source.coefficient *
    inspected.coefficient *
    latest.scale *
    10n ** BigInt(precision);
  const denominator =
    source.scale * inspected.scale * latest.coefficient;
  return formatFixedInteger(numerator / denominator, precision);
}

export function getChartMarketCapAtPoint(
  payload: TokenChartPayload,
  inspectedPoint?: TokenChartPoint,
  latestPoint?: TokenChartPoint,
): TokenChartMarketCap {
  if (!inspectedPoint || !latestPoint || inspectedPoint === latestPoint) {
    return {
      marketCapEthWei: payload.marketCapEthWei,
      marketCapEth: payload.marketCapEth,
      marketCapUsdWad: payload.marketCapUsdWad,
    };
  }

  const marketCapEthWei = scaleIntegerByPriceRatio(
    payload.marketCapEthWei,
    inspectedPoint.priceEth,
    latestPoint.priceEth,
  );
  const marketCapEth = marketCapEthWei
    ? formatFixedInteger(BigInt(marketCapEthWei), 18)
    : scaleDecimalByPriceRatio(
        payload.marketCapEth,
        inspectedPoint.priceEth,
        latestPoint.priceEth,
      );
  const marketCapUsdWad = scaleIntegerByPriceRatio(
    payload.marketCapUsdWad,
    inspectedPoint.priceUsd ?? inspectedPoint.priceEth,
    latestPoint.priceUsd ?? latestPoint.priceEth,
  );

  return {
    marketCapEthWei: marketCapEthWei ?? payload.marketCapEthWei,
    marketCapEth: marketCapEth ?? payload.marketCapEth,
    marketCapUsdWad: marketCapUsdWad ?? payload.marketCapUsdWad,
  };
}
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

export function isAuthoritativeChartPayloadStatus(status: unknown) {
  return status === "ready" || status === "insufficient-history";
}

function isUnsignedIntegerString(value: unknown) {
  return typeof value === "string" && /^\d+$/.test(value);
}

function isUnsignedDecimalString(value: unknown) {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
  );
}

function hasOptionalUnsignedInteger(value: unknown) {
  return value === undefined || isUnsignedIntegerString(value);
}

function hasOptionalUnsignedDecimal(value: unknown) {
  return value === undefined || isUnsignedDecimalString(value);
}

export function isAuthoritativeChartPayload(
  value: unknown,
): value is ChartPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ChartPayload>;
  if (
    !isAuthoritativeChartPayloadStatus(payload.status) ||
    !Array.isArray(payload.points) ||
    !Number.isSafeInteger(payload.swapCount) ||
    (payload.swapCount ?? -1) < 0 ||
    !isUnsignedIntegerString(payload.volumeWei) ||
    !isUnsignedDecimalString(payload.volumeEth) ||
    !hasOptionalUnsignedInteger(payload.volumeUsdWad) ||
    !hasOptionalUnsignedInteger(payload.marketCapEthWei) ||
    !hasOptionalUnsignedDecimal(payload.marketCapEth) ||
    !hasOptionalUnsignedInteger(payload.marketCapUsdWad)
  ) {
    return false;
  }

  return payload.points.every(
    (point) =>
      Boolean(point) &&
      typeof point === "object" &&
      isUnsignedIntegerString(point.blockNumber) &&
      isUnsignedDecimalString(point.priceEth) &&
      (point.priceUsd === undefined ||
        isUnsignedDecimalString(point.priceUsd)),
  );
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
      const payload: unknown = await response.json();
      if (!isAuthoritativeChartPayload(payload)) {
        throw new Error("Chart source is not ready");
      }
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
  preview = false,
  marketCapEthWei,
  marketCapEth,
  marketCapUsdWad,
  onVolumeChange,
  onMarketCapChange,
}: {
  tokenAddress: `0x${string}`;
  tokenName: string;
  launchModel?: ChartLaunchModel;
  preview?: boolean;
  marketCapEthWei?: string;
  marketCapEth?: string;
  marketCapUsdWad?: string;
  onVolumeChange?: (volume: TokenChartVolume | null) => void;
  onMarketCapChange?: (marketCap: TokenChartMarketCap | null) => void;
}) {
  const [request, setRequest] = useState<ChartRequestState | null>(null);
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
            chartPayloadCache.get(requestKey)?.payload ?? null,
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
    const domainMinimum = Math.max(0, minimum - span * 0.1);
    const domainMaximum = maximum + span * 0.1;
    const domainSpan = domainMaximum - domainMinimum || 1;
    const points: PlottedPoint[] = validPoints.map((point, index) => ({
      ...point,
      x:
        PLOT_LEFT +
        (index / (validPoints.length - 1)) * (PLOT_RIGHT - PLOT_LEFT),
      y:
        PLOT_BOTTOM -
        ((point.value - domainMinimum) / domainSpan) *
          (PLOT_BOTTOM - PLOT_TOP),
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
  const inspectedMarketCap = useMemo(() => {
    if (!payload) return null;
    const latestPoint = chart?.points.at(-1);
    return getChartMarketCapAtPoint(
      {
        ...payload,
        marketCapEthWei: payload.marketCapEthWei ?? marketCapEthWei,
        marketCapEth: payload.marketCapEth ?? marketCapEth,
        marketCapUsdWad: payload.marketCapUsdWad ?? marketCapUsdWad,
      },
      activePoint ?? latestPoint,
      latestPoint,
    );
  }, [
    activePoint,
    chart,
    marketCapEth,
    marketCapEthWei,
    marketCapUsdWad,
    payload,
  ]);
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
    onMarketCapChange?.(inspectedMarketCap);
  }, [inspectedMarketCap, onMarketCapChange]);

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
            <path
              className={styles.area}
              d={chart.areaPath}
              fill={`url(#${gradientId})`}
            />
            <path className={styles.line} d={chart.path} />
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
            <>
              <span
                className={styles.inspectionDot}
                style={{
                  left: `${(activePoint.x / VIEWBOX_WIDTH) * 100}%`,
                  top: `${(activePoint.y / VIEWBOX_HEIGHT) * 100}%`,
                }}
                aria-hidden="true"
              />
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
            </>
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
