"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

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
};

type PlottedPoint = ChartPoint & {
  x: number;
  y: number;
  value: number;
};

type ChartRange = "1h" | "1d" | "1w" | "all";

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

function formatMarketCap(value: number, unit: "USD" | "ETH") {
  if (!Number.isFinite(value) || value < 0) return null;
  if (unit === "USD") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: value >= 1_000 ? "compact" : "standard",
      maximumFractionDigits: value >= 1_000 ? 1 : 2,
    }).format(value);
  }
  return `${new Intl.NumberFormat("en-US", {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 5,
  }).format(value)} ETH`;
}

function linePath(points: PlottedPoint[]) {
  if (points.length === 0) return "";

  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C${midpoint.toFixed(2)},${previous.y.toFixed(2)} ${midpoint.toFixed(2)},${point.y.toFixed(2)} ${point.x.toFixed(2)},${point.y.toFixed(2)}`;
  }, `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`);
}

export function TokenPriceChart({
  tokenAddress,
  tokenName,
  totalSupply,
  onMarketCapChange,
}: {
  tokenAddress: `0x${string}`;
  tokenName: string;
  totalSupply?: string;
  onMarketCapChange?: (marketCap: string | null) => void;
}) {
  const [request, setRequest] = useState<{
    key: string;
    payload: ChartPayload | null;
    failed: boolean;
  } | null>(null);
  const [range, setRange] = useState<ChartRange>("all");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const plotRef = useRef<SVGSVGElement | null>(null);
  const gradientId = useId().replaceAll(":", "");
  const requestKey = `${tokenAddress.toLowerCase()}:${range}`;
  const payload =
    request?.key === requestKey ? request.payload : null;
  const failed =
    request?.key === requestKey ? request.failed : false;

  useEffect(() => {
    const controller = new AbortController();

    void fetch(
      `/api/explore/token/chart?address=${encodeURIComponent(tokenAddress)}&range=${range}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Chart request failed");
        return (await response.json()) as ChartPayload;
      })
      .then((nextPayload) => {
        setRequest({
          key: requestKey,
          payload: nextPayload,
          failed: false,
        });
        setActiveIndex(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRequest({
          key: requestKey,
          payload: null,
          failed: true,
        });
      });

    return () => controller.abort();
  }, [range, requestKey, tokenAddress]);

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

  const activePoint =
    chart && activeIndex !== null ? chart.points[activeIndex] : null;

  useEffect(() => {
    const supply = Number(totalSupply);
    if (
      !activePoint ||
      !chart ||
      !Number.isFinite(supply) ||
      supply <= 0
    ) {
      onMarketCapChange?.(null);
      return;
    }

    onMarketCapChange?.(
      formatMarketCap(activePoint.value * supply, chart.unit),
    );
  }, [activePoint, chart, onMarketCapChange, totalSupply]);

  function updateActivePoint(clientX: number) {
    if (!chart || !plotRef.current) return;
    const bounds = plotRef.current.getBoundingClientRect();
    const relative = Math.min(
      1,
      Math.max(0, (clientX - bounds.left) / bounds.width),
    );
    setActiveIndex(
      Math.round(relative * Math.max(0, chart.points.length - 1)),
    );
  }

  return (
    <section className={styles.shell} aria-label={`${tokenName} price history`}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Price history</p>
          <p className={styles.value}>
            {chart
              ? formatPrice(
                  activePoint?.value ?? chart.current,
                  chart.unit,
                )
              : "Onchain"}
          </p>
        </div>
        <div className={styles.ranges} aria-label="Chart range" role="group">
          {CHART_RANGES.map((option) => (
            <button
              className={styles.rangeButton}
              type="button"
              aria-pressed={range === option.value}
              key={option.value}
              onClick={() => {
                setRange(option.value);
                setActiveIndex(null);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {!payload && !failed ? (
        <div className={styles.placeholder} aria-label="Loading price history">
          <span className={styles.loadingLine} />
        </div>
      ) : chart ? (
        <div className={styles.plot}>
          <svg
            ref={plotRef}
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${tokenName} onchain price chart`}
            onPointerDown={(event) => updateActivePoint(event.clientX)}
            onPointerMove={(event) => updateActivePoint(event.clientX)}
            onPointerLeave={(event) => {
              if (event.pointerType !== "touch") setActiveIndex(null);
            }}
          >
            <defs>
              <linearGradient
                id={gradientId}
                x1="0"
                x2="0"
                y1="0"
                y2="1"
              >
                <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0.34, 0.68, 1].map((position) => {
              const y =
                PLOT_TOP + (PLOT_BOTTOM - PLOT_TOP) * position;
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
                  className={styles.guide}
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={PLOT_TOP}
                  y2={PLOT_BOTTOM}
                />
                <circle
                  className={styles.point}
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="4"
                />
              </>
            ) : null}
          </svg>
        </div>
      ) : (
        <div className={styles.placeholder}>
          {failed
            ? "Price history is temporarily unavailable"
            : "Price history appears after confirmed trades"}
        </div>
      )}
    </section>
  );
}
