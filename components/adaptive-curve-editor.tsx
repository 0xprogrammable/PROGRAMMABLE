"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  ADAPTIVE_MAX_CURVE_POINTS,
  ADAPTIVE_MAX_FDV_INDEX,
  ADAPTIVE_MAX_FEE_BPS,
  ADAPTIVE_MIN_CURVE_POINTS,
  ADAPTIVE_MIN_FDV_INDEX,
  ADAPTIVE_MIN_FEE_BPS,
  PLATFORM_FEE_BPS,
  type AdaptiveCurvePointDraft,
} from "@/lib/launch";
import styles from "./adaptive-curve-editor.module.css";

const FDV_INDEX_SPAN = ADAPTIVE_MAX_FDV_INDEX - ADAPTIVE_MIN_FDV_INDEX;
const PLOT_LEFT = 48;
const PLOT_RIGHT = 24;
const PLOT_TOP = 22;
const PLOT_BOTTOM = 34;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function xPercent(fdvIndex: number) {
  return ((fdvIndex - ADAPTIVE_MIN_FDV_INDEX) / FDV_INDEX_SPAN) * 100;
}

function yPercent(feeBps: number) {
  return (
    ((ADAPTIVE_MAX_FEE_BPS - feeBps) /
      (ADAPTIVE_MAX_FEE_BPS - ADAPTIVE_MIN_FEE_BPS)) *
    100
  );
}

export function ethFdvForIndex(fdvIndex: number) {
  const log10Eth =
    9 + fdvIndex * Math.log10(1.0001);
  if (log10Eth < -6) return "<0.000001 ETH";
  if (log10Eth > 15) return `10^${Math.floor(log10Eth)} ETH`;
  const value = 10 ** log10Eth;
  if (value < 0.01) return `${value.toPrecision(2)} ETH`;
  if (value < 1_000) {
    return `${value.toLocaleString("en-US", {
      maximumFractionDigits: value < 10 ? 2 : 0,
    })} ETH`;
  }
  if (value < 1_000_000) {
    return `${(value / 1_000).toFixed(1)}K ETH`;
  }
  return `${(value / 1_000_000).toFixed(1)}M ETH`;
}

export function AdaptiveCurveEditor({
  points,
  onChange,
}: {
  points: AdaptiveCurvePointDraft[];
  onChange: (points: AdaptiveCurvePointDraft[]) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);

  function updatePoint(
    index: number,
    patch: Partial<AdaptiveCurvePointDraft>,
  ) {
    onChange(
      points.map((point, pointIndex) =>
        pointIndex === index ? { ...point, ...patch } : point,
      ),
    );
  }

  function moveFromPointer(
    index: number,
    event: PointerEvent<HTMLButtonElement>,
  ) {
    const plot = plotRef.current;
    if (!plot) return;
    const rect = plot.getBoundingClientRect();
    const usableWidth = rect.width - PLOT_LEFT - PLOT_RIGHT;
    const usableHeight = rect.height - PLOT_TOP - PLOT_BOTTOM;
    const x = clamp(
      (event.clientX - rect.left - PLOT_LEFT) / usableWidth,
      0,
      1,
    );
    const y = clamp(
      (event.clientY - rect.top - PLOT_TOP) / usableHeight,
      0,
      1,
    );
    const previous = points[index - 1]?.fdvIndex ?? ADAPTIVE_MIN_FDV_INDEX;
    const next = points[index + 1]?.fdvIndex ?? ADAPTIVE_MAX_FDV_INDEX;
    const fdvIndex =
      index === 0 || index === points.length - 1
        ? points[index].fdvIndex
        : clamp(
            Math.round(ADAPTIVE_MIN_FDV_INDEX + x * FDV_INDEX_SPAN),
            previous + 1,
            next - 1,
          );
    const totalSwapFeeBps = clamp(
      Math.round(
        (ADAPTIVE_MAX_FEE_BPS -
          y * (ADAPTIVE_MAX_FEE_BPS - ADAPTIVE_MIN_FEE_BPS)) /
          25,
      ) * 25,
      ADAPTIVE_MIN_FEE_BPS,
      ADAPTIVE_MAX_FEE_BPS,
    );
    updatePoint(index, { fdvIndex, totalSwapFeeBps });
  }

  function onPointerDown(
    index: number,
    event: PointerEvent<HTMLButtonElement>,
  ) {
    event.currentTarget.setPointerCapture(event.pointerId);
    moveFromPointer(index, event);
  }

  function onHandleKeyDown(
    index: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    const point = points[index];
    const feeStep = event.shiftKey ? 100 : 25;
    const indexStep = event.shiftKey ? 10_000 : 1_000;
    const previous = points[index - 1]?.fdvIndex ?? ADAPTIVE_MIN_FDV_INDEX;
    const next = points[index + 1]?.fdvIndex ?? ADAPTIVE_MAX_FDV_INDEX;
    let patch: Partial<AdaptiveCurvePointDraft> | null = null;

    if (event.key === "ArrowUp") {
      patch = {
        totalSwapFeeBps: clamp(
          point.totalSwapFeeBps + feeStep,
          ADAPTIVE_MIN_FEE_BPS,
          ADAPTIVE_MAX_FEE_BPS,
        ),
      };
    } else if (event.key === "ArrowDown") {
      patch = {
        totalSwapFeeBps: clamp(
          point.totalSwapFeeBps - feeStep,
          ADAPTIVE_MIN_FEE_BPS,
          ADAPTIVE_MAX_FEE_BPS,
        ),
      };
    } else if (
      event.key === "ArrowLeft" &&
      index > 0 &&
      index < points.length - 1
    ) {
      patch = {
        fdvIndex: clamp(point.fdvIndex - indexStep, previous + 1, next - 1),
      };
    } else if (
      event.key === "ArrowRight" &&
      index > 0 &&
      index < points.length - 1
    ) {
      patch = {
        fdvIndex: clamp(point.fdvIndex + indexStep, previous + 1, next - 1),
      };
    }
    if (patch) {
      event.preventDefault();
      updatePoint(index, patch);
    }
  }

  function addPoint() {
    if (points.length >= ADAPTIVE_MAX_CURVE_POINTS) return;
    let gapIndex = 0;
    let largestGap = -1;
    for (let index = 0; index < points.length - 1; index += 1) {
      const gap = points[index + 1].fdvIndex - points[index].fdvIndex;
      if (gap > largestGap) {
        largestGap = gap;
        gapIndex = index;
      }
    }
    const lower = points[gapIndex];
    const upper = points[gapIndex + 1];
    const next = [
      ...points.slice(0, gapIndex + 1),
      {
        fdvIndex: Math.round((lower.fdvIndex + upper.fdvIndex) / 2),
        totalSwapFeeBps: Math.round(
          (lower.totalSwapFeeBps + upper.totalSwapFeeBps) / 50,
        ) * 25,
      },
      ...points.slice(gapIndex + 1),
    ];
    onChange(next);
  }

  function removePoint(index: number) {
    if (
      points.length <= ADAPTIVE_MIN_CURVE_POINTS ||
      index === 0 ||
      index === points.length - 1
    ) {
      return;
    }
    onChange(points.filter((_, pointIndex) => pointIndex !== index));
  }

  const polyline = points
    .map(
      (point) =>
        `${xPercent(point.fdvIndex)},${yPercent(point.totalSwapFeeBps)}`,
    )
    .join(" ");

  return (
    <section className={styles.editor} aria-labelledby="adaptive-curve-title">
      <div className={styles.heading}>
        <h2 id="adaptive-curve-title">Fee curve</h2>
        <p>
          Set the total swap fee as the token&apos;s ETH-denominated fully
          diluted value changes
        </p>
      </div>

      <div className={styles.plot} ref={plotRef}>
        <div className={styles.grid} aria-hidden="true" />
        <svg
          className={styles.line}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points={polyline} />
        </svg>
        <span className={styles.axisY}>Total swap fee · 1% to 10%</span>
        <span className={styles.axisX}>ETH-denominated onchain FDV →</span>
        <div className={styles.handles}>
          {points.map((point, index) => (
            <button
              className={styles.handle}
              key={`${index}-${point.fdvIndex}`}
              type="button"
              style={{
                left: `${xPercent(point.fdvIndex)}%`,
                top: `${yPercent(point.totalSwapFeeBps)}%`,
              }}
              aria-label={`Curve point ${index + 1}, ${ethFdvForIndex(
                point.fdvIndex,
              )}, ${(point.totalSwapFeeBps / 100).toFixed(2)}% total fee`}
              onPointerDown={(event) => onPointerDown(index, event)}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  moveFromPointer(index, event);
                }
              }}
              onKeyDown={(event) => onHandleKeyDown(index, event)}
            />
          ))}
        </div>
      </div>

      <div className={styles.points}>
        {points.map((point, index) => {
          const creatorFeeBps = point.totalSwapFeeBps - PLATFORM_FEE_BPS;
          const boundary = index === 0 || index === points.length - 1;
          return (
            <div className={styles.point} key={`${point.fdvIndex}-${index}`}>
              <span>
                <strong>
                  {boundary
                    ? index === 0
                      ? "Lowest onchain value"
                      : "Highest onchain value"
                    : ethFdvForIndex(point.fdvIndex)}
                </strong>
                Creator {(creatorFeeBps / 100).toFixed(2)}% · Programmable
                {" "}
                {(PLATFORM_FEE_BPS / 100).toFixed(2)}%
              </span>
              <input
                aria-label={`Total fee for curve point ${index + 1}`}
                type="number"
                min="1"
                max="10"
                step="0.25"
                value={(point.totalSwapFeeBps / 100).toFixed(2)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  updatePoint(index, {
                    totalSwapFeeBps: clamp(
                      Math.round(value * 100),
                      ADAPTIVE_MIN_FEE_BPS,
                      ADAPTIVE_MAX_FEE_BPS,
                    ),
                  });
                }}
              />
              <button
                className={styles.remove}
                type="button"
                aria-label={`Remove curve point ${index + 1}`}
                disabled={
                  boundary || points.length <= ADAPTIVE_MIN_CURVE_POINTS
                }
                onClick={() => removePoint(index)}
              >
                <Trash2 aria-hidden="true" size={15} />
              </button>
            </div>
          );
        })}
      </div>

      <button
        className={styles.add}
        type="button"
        disabled={points.length >= ADAPTIVE_MAX_CURVE_POINTS}
        onClick={addPoint}
      >
        <Plus aria-hidden="true" size={15} />
        Add point
      </button>

      <div className={styles.disclosure}>
        <div>
          <strong>Fixed at launch</strong>
          <span>The curve cannot be changed after the token is created</span>
        </div>
        <div>
          <strong>Same rule both ways</strong>
          <span>One pre-swap fee applies to the complete buy or sell</span>
        </div>
        <div>
          <strong>No transfer tax</strong>
          <span>The fee exists only in the canonical Uniswap v4 pool</span>
        </div>
      </div>
    </section>
  );
}
