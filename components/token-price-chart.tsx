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
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
    )
    .join(" ");
}

export function TokenPriceChart({
  tokenAddress,
  tokenName,
}: {
  tokenAddress: `0x${string}`;
  tokenName: string;
}) {
  const [request, setRequest] = useState<{
    address: string;
    payload: ChartPayload | null;
    failed: boolean;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const plotRef = useRef<SVGSVGElement | null>(null);
  const gradientId = useId().replaceAll(":", "");
  const payload =
    request?.address === tokenAddress ? request.payload : null;
  const failed =
    request?.address === tokenAddress ? request.failed : false;

  useEffect(() => {
    const controller = new AbortController();

    void fetch(
      `/api/explore/token/chart?address=${encodeURIComponent(tokenAddress)}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Chart request failed");
        return (await response.json()) as ChartPayload;
      })
      .then((nextPayload) => {
        setRequest({
          address: tokenAddress,
          payload: nextPayload,
          failed: false,
        });
        setActiveIndex(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setRequest({
          address: tokenAddress,
          payload: null,
          failed: true,
        });
      });

    return () => controller.abort();
  }, [tokenAddress]);

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
    const first = points[0].value;
    const last = points.at(-1)?.value ?? first;
    const change = first > 0 ? ((last - first) / first) * 100 : 0;

    return {
      unit,
      points,
      path,
      areaPath: `${path} L${PLOT_RIGHT},${VIEWBOX_HEIGHT} L${PLOT_LEFT},${VIEWBOX_HEIGHT} Z`,
      change,
      current: last,
    } as const;
  }, [payload]);

  const activePoint =
    chart && activeIndex !== null ? chart.points[activeIndex] : null;

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
          {chart ? (
            <p
              className={`${styles.change} ${
                chart.change > 0
                  ? styles.positive
                  : chart.change < 0
                    ? styles.negative
                    : ""
              }`}
            >
              {chart.change > 0 ? "+" : ""}
              {chart.change.toFixed(2)}% since launch
            </p>
          ) : null}
        </div>
        <span className={styles.range}>All</span>
      </div>

      {!payload && !failed ? (
        <div className={styles.placeholder} aria-label="Loading price history">
          <span className={styles.loadingLine} />
        </div>
      ) : chart ? (
        <>
          <div className={styles.plot}>
            {activePoint ? (
              <span
                className={styles.tooltip}
                style={{
                  left: `${(activePoint.x / VIEWBOX_WIDTH) * 100}%`,
                }}
              >
                {formatPrice(activePoint.value, chart.unit)}
              </span>
            ) : null}
            <svg
              ref={plotRef}
              viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={`${tokenName} onchain price chart`}
              onPointerMove={(event) => updateActivePoint(event.clientX)}
              onPointerLeave={() => setActiveIndex(null)}
            >
              <defs>
                <linearGradient
                  id={gradientId}
                  x1="0"
                  x2="0"
                  y1="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <line
                className={styles.grid}
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={PLOT_BOTTOM}
                y2={PLOT_BOTTOM}
              />
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
          <div className={styles.axis} aria-hidden="true">
            <span>Launch</span>
            <span>Latest confirmed block</span>
          </div>
        </>
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
