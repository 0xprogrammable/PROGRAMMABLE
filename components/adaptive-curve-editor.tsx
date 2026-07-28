"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Plus, Trash2 } from "lucide-react";

import {
  ADAPTIVE_MAX_CURVE_POINTS,
  ADAPTIVE_MAX_FEE_BPS,
  ADAPTIVE_MIN_CURVE_POINTS,
  ADAPTIVE_MIN_FEE_BPS,
  PLATFORM_FEE_BPS,
  type AdaptiveCurvePointDraft,
} from "@/lib/launch";
import styles from "./adaptive-curve-editor.module.css";

export const ADAPTIVE_PRACTICAL_MIN_FDV_INDEX = -207_243;
export const ADAPTIVE_PRACTICAL_MAX_FDV_INDEX = -69_081;
const ADAPTIVE_MIN_VISIBLE_CURVE_POINTS = 2;
const ADAPTIVE_MAX_VISIBLE_CURVE_POINTS = ADAPTIVE_MAX_CURVE_POINTS - 2;
const PRACTICAL_FDV_INDEX_SPAN =
  ADAPTIVE_PRACTICAL_MAX_FDV_INDEX - ADAPTIVE_PRACTICAL_MIN_FDV_INDEX;
const PLOT_LEFT = 42;
const PLOT_RIGHT = 24;
const PLOT_TOP = 30;
const PLOT_BOTTOM = 34;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function xPercent(fdvIndex: number) {
  return (
    ((clamp(
      fdvIndex,
      ADAPTIVE_PRACTICAL_MIN_FDV_INDEX,
      ADAPTIVE_PRACTICAL_MAX_FDV_INDEX,
    ) -
      ADAPTIVE_PRACTICAL_MIN_FDV_INDEX) /
      PRACTICAL_FDV_INDEX_SPAN) *
    100
  );
}

function yPercent(feeBps: number) {
  return (
    ((ADAPTIVE_MAX_FEE_BPS - feeBps) /
      (ADAPTIVE_MAX_FEE_BPS - ADAPTIVE_MIN_FEE_BPS)) *
    100
  );
}

function formatFee(feeBps: number) {
  return `${(feeBps / 100).toFixed(2)}%`;
}

export function ethFdvForIndex(fdvIndex: number) {
  const log10Eth = 9 + fdvIndex * Math.log10(1.0001);
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

export function insertAdaptiveCurvePoint(points: AdaptiveCurvePointDraft[]) {
  if (
    points.length < ADAPTIVE_MIN_CURVE_POINTS + 2 ||
    points.length >= ADAPTIVE_MAX_CURVE_POINTS
  ) {
    return { points, insertedIndex: -1 };
  }

  const editablePoints = points.slice(1, -1);
  const anchors = [
    {
      fdvIndex: ADAPTIVE_PRACTICAL_MIN_FDV_INDEX,
      totalSwapFeeBps:
        editablePoints[0]?.totalSwapFeeBps ?? points[0].totalSwapFeeBps,
    },
    ...editablePoints,
    {
      fdvIndex: ADAPTIVE_PRACTICAL_MAX_FDV_INDEX,
      totalSwapFeeBps:
        editablePoints.at(-1)?.totalSwapFeeBps ??
        points.at(-1)!.totalSwapFeeBps,
    },
  ];
  let gapIndex = 0;
  let largestGap = -1;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const gap = anchors[index + 1].fdvIndex - anchors[index].fdvIndex;
    if (gap > largestGap) {
      largestGap = gap;
      gapIndex = index;
    }
  }

  const lower = anchors[gapIndex];
  const upper = anchors[gapIndex + 1];
  const insertedIndex = gapIndex + 1;
  const nextPoints = [
    ...points.slice(0, insertedIndex),
    {
      fdvIndex: Math.round((lower.fdvIndex + upper.fdvIndex) / 2),
      totalSwapFeeBps:
        Math.round(
          (lower.totalSwapFeeBps + upper.totalSwapFeeBps) / 50,
        ) * 25,
    },
    ...points.slice(insertedIndex),
  ];
  return {
    insertedIndex: gapIndex,
    points: withFlatEndpointGuards(nextPoints),
  };
}

export function withFlatEndpointGuards(points: AdaptiveCurvePointDraft[]) {
  if (points.length < 4) return points;
  return points.map((point, index) => {
    if (index === 0) {
      return { ...point, totalSwapFeeBps: points[1].totalSwapFeeBps };
    }
    if (index === points.length - 1) {
      return {
        ...point,
        totalSwapFeeBps: points[points.length - 2].totalSwapFeeBps,
      };
    }
    return point;
  });
}

function pointName(index: number) {
  return `Point ${index + 1}`;
}

export function AdaptiveCurveEditor({
  points,
  onChange,
}: {
  points: AdaptiveCurvePointDraft[];
  onChange: (points: AdaptiveCurvePointDraft[]) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [selectedPointIndex, setSelectedPointIndex] = useState(0);
  const editablePoints = points.slice(1, -1);
  const selectedIndex = clamp(
    selectedPointIndex,
    0,
    Math.max(editablePoints.length - 1, 0),
  );
  const selectedPoint = editablePoints[selectedIndex];

  useEffect(() => {
    if (points.length < 4) return;
    const firstFee = points[1].totalSwapFeeBps;
    const lastFee = points[points.length - 2].totalSwapFeeBps;
    if (
      points[0].totalSwapFeeBps !== firstFee ||
      points[points.length - 1].totalSwapFeeBps !== lastFee
    ) {
      onChange(withFlatEndpointGuards(points));
    }
  }, [onChange, points]);

  function updatePoint(
    index: number,
    patch: Partial<AdaptiveCurvePointDraft>,
  ) {
    const pointIndex = index + 1;
    onChange(
      withFlatEndpointGuards(
        points.map((point, currentIndex) =>
          currentIndex === pointIndex ? { ...point, ...patch } : point,
        ),
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
    const previous =
      editablePoints[index - 1]?.fdvIndex ??
      ADAPTIVE_PRACTICAL_MIN_FDV_INDEX - 1;
    const next =
      editablePoints[index + 1]?.fdvIndex ??
      ADAPTIVE_PRACTICAL_MAX_FDV_INDEX + 1;
    const fdvIndex = clamp(
      Math.round(
        ADAPTIVE_PRACTICAL_MIN_FDV_INDEX + x * PRACTICAL_FDV_INDEX_SPAN,
      ),
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
    setSelectedPointIndex(index);
    event.currentTarget.setPointerCapture(event.pointerId);
    moveFromPointer(index, event);
  }

  function onHandleKeyDown(
    index: number,
    event: KeyboardEvent<HTMLButtonElement>,
  ) {
    const point = editablePoints[index];
    const feeStep = event.shiftKey ? 100 : 25;
    const indexStep = event.shiftKey ? 10_000 : 1_000;
    const previous =
      editablePoints[index - 1]?.fdvIndex ??
      ADAPTIVE_PRACTICAL_MIN_FDV_INDEX - 1;
    const next =
      editablePoints[index + 1]?.fdvIndex ??
      ADAPTIVE_PRACTICAL_MAX_FDV_INDEX + 1;
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
      point.fdvIndex > ADAPTIVE_PRACTICAL_MIN_FDV_INDEX
    ) {
      patch = {
        fdvIndex: clamp(point.fdvIndex - indexStep, previous + 1, next - 1),
      };
    } else if (
      event.key === "ArrowRight" &&
      point.fdvIndex < ADAPTIVE_PRACTICAL_MAX_FDV_INDEX
    ) {
      patch = {
        fdvIndex: clamp(point.fdvIndex + indexStep, previous + 1, next - 1),
      };
    }

    if (patch) {
      event.preventDefault();
      setSelectedPointIndex(index);
      updatePoint(index, patch);
    }
  }

  function addPoint() {
    const result = insertAdaptiveCurvePoint(points);
    if (result.insertedIndex < 0) return;
    setSelectedPointIndex(result.insertedIndex);
    onChange(result.points);
  }

  function removeSelectedPoint() {
    if (editablePoints.length <= ADAPTIVE_MIN_VISIBLE_CURVE_POINTS) return;
    onChange(
      withFlatEndpointGuards(
        points.filter((_, index) => index !== selectedIndex + 1),
      ),
    );
    setSelectedPointIndex(Math.max(0, selectedIndex - 1));
  }

  const curvePoints =
    editablePoints.length > 0
      ? [
          {
            fdvIndex: ADAPTIVE_PRACTICAL_MIN_FDV_INDEX,
            totalSwapFeeBps: editablePoints[0].totalSwapFeeBps,
          },
          ...editablePoints,
          {
            fdvIndex: ADAPTIVE_PRACTICAL_MAX_FDV_INDEX,
            totalSwapFeeBps:
              editablePoints[editablePoints.length - 1].totalSwapFeeBps,
          },
        ]
      : [];
  const polyline = curvePoints
    .map(
      (point) =>
        `${xPercent(point.fdvIndex)},${yPercent(point.totalSwapFeeBps)}`,
    )
    .join(" ");
  const creatorFeeBps = Math.max(
    0,
    (selectedPoint?.totalSwapFeeBps ?? PLATFORM_FEE_BPS) - PLATFORM_FEE_BPS,
  );

  return (
    <section className={styles.editor} aria-labelledby="adaptive-curve-title">
      <div className={styles.heading}>
        <div>
          <h2 id="adaptive-curve-title">Price-based swap fees</h2>
          <p>
            Set the total fee at different market caps. The curve moves between
            your points as the token price changes.
          </p>
        </div>
        <button
          className={styles.add}
          type="button"
          disabled={points.length >= ADAPTIVE_MAX_CURVE_POINTS}
          onClick={addPoint}
        >
          <Plus aria-hidden="true" size={16} />
          {points.length >= ADAPTIVE_MAX_CURVE_POINTS
            ? `${ADAPTIVE_MAX_VISIBLE_CURVE_POINTS} points`
            : "Add point"}
        </button>
      </div>

      <div
        className={styles.plot}
        ref={plotRef}
        aria-label="Adaptive swap fee curve"
      >
        <div className={styles.grid} aria-hidden="true" />
        <svg
          className={styles.line}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points={polyline} />
        </svg>
        <span className={styles.feeMaximum} aria-hidden="true">
          10%
        </span>
        <span className={styles.feeMinimum} aria-hidden="true">
          1%
        </span>
        <span className={styles.valueMinimum} aria-hidden="true">
          1 ETH market cap
        </span>
        <span className={styles.valueMaximum} aria-hidden="true">
          1M ETH market cap
        </span>
        <div className={styles.handles}>
          {editablePoints.map((point, index) => {
            const selected = index === selectedIndex;
            return (
              <button
                className={styles.handle}
                data-selected={selected ? "true" : "false"}
                key={index}
                type="button"
                style={{
                  left: `${xPercent(point.fdvIndex)}%`,
                  top: `${yPercent(point.totalSwapFeeBps)}%`,
                }}
                aria-label={`${pointName(index)}, ${ethFdvForIndex(
                  point.fdvIndex,
                )}, ${formatFee(point.totalSwapFeeBps)} total fee`}
                aria-describedby="adaptive-curve-instructions"
                onFocus={() => setSelectedPointIndex(index)}
                onPointerDown={(event) => onPointerDown(index, event)}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    moveFromPointer(index, event);
                  }
                }}
                onKeyDown={(event) => onHandleKeyDown(index, event)}
              >
                <span aria-hidden="true">{formatFee(point.totalSwapFeeBps)}</span>
              </button>
            );
          })}
        </div>
      </div>

      <p className={styles.instructions} id="adaptive-curve-instructions">
        Select a point to edit it. Arrow keys make precise changes.
      </p>

      {selectedPoint ? (
        <div className={styles.inspector}>
          <div className={styles.selectedPoint}>
            <span>{pointName(selectedIndex)}</span>
            <strong>
              {ethFdvForIndex(selectedPoint.fdvIndex)} market cap
            </strong>
          </div>

          <label className={styles.feeInput}>
            <span>Total fee</span>
            <span>
              <input
                aria-label={`Total fee for point ${selectedIndex + 1}`}
                type="number"
                min="1"
                max="10"
                step="0.25"
                value={(selectedPoint.totalSwapFeeBps / 100).toFixed(2)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (!Number.isFinite(value)) return;
                  updatePoint(selectedIndex, {
                    totalSwapFeeBps: clamp(
                      Math.round(value * 100),
                      ADAPTIVE_MIN_FEE_BPS,
                      ADAPTIVE_MAX_FEE_BPS,
                    ),
                  });
                }}
              />
              <small>%</small>
            </span>
          </label>

          <div className={styles.split}>
            <span>
              Creator <strong>{formatFee(creatorFeeBps)}</strong>
            </span>
            <span>
              Programmable <strong>{formatFee(PLATFORM_FEE_BPS)}</strong>
            </span>
          </div>

          {editablePoints.length > ADAPTIVE_MIN_VISIBLE_CURVE_POINTS ? (
            <button
              className={styles.remove}
              type="button"
              onClick={removeSelectedPoint}
            >
              <Trash2 aria-hidden="true" size={16} />
              Remove point
            </button>
          ) : (
            <span className={styles.minimum}>Two point minimum</span>
          )}
        </div>
      ) : null}

      <p className={styles.disclosure}>
        The curve is fixed at launch. Programmable&apos;s 0.10% is included in
        every fee.
      </p>
    </section>
  );
}
