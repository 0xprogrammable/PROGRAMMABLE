"use client";

import { useEffect, useLayoutEffect, useRef } from "react";

export type MarketCapMetric =
  | { kind: "usd"; value: number }
  | { kind: "eth"; value: number }
  | { kind: "quote"; symbol: string; value: number };

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

const usdStandardFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "standard",
  maximumFractionDigits: 2,
});
const usdCompactFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumSignificantDigits: 3,
});
const standardNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "standard",
  maximumFractionDigits: 4,
});
const standardLargeNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "standard",
  maximumFractionDigits: 1,
});
const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function compactUsd(value: number, target: number) {
  return target < 1_000
    ? usdStandardFormatter.format(value)
    : usdCompactFormatter.format(value);
}

function compactNumber(value: number, target: number) {
  return target >= 1_000
    ? compactNumberFormatter.format(value)
    : target >= 100
      ? standardLargeNumberFormatter.format(value)
      : standardNumberFormatter.format(value);
}

export function formatMarketCapMetric(
  metric: MarketCapMetric,
  value = metric.value,
) {
  return formatMarketCapValue(
    metric.kind,
    metric.value,
    metric.kind === "quote" ? metric.symbol : "",
    value,
  );
}

export function getMarketCapAnimationKey(
  metric: MarketCapMetric,
  replayKey: string,
) {
  const symbol = metric.kind === "quote" ? metric.symbol : "";
  return `${replayKey}\u0000${metric.kind}\u0000${symbol}\u0000${metric.value}`;
}

function formatMarketCapValue(
  kind: MarketCapMetric["kind"],
  target: number,
  symbol: string,
  value: number,
) {
  if (kind === "usd") {
    return compactUsd(value, target);
  }

  const formatted =
    kind === "eth" && value > 0 && value < 0.0001
      ? value.toExponential(2)
      : compactNumber(value, target);

  return `${formatted} ${kind === "eth" ? "ETH" : symbol}`;
}

export function AnimatedMarketCap({
  delay = 0,
  metric,
  replayKey,
}: {
  delay?: number;
  metric: MarketCapMetric;
  replayKey: string;
}) {
  const valueRef = useRef<HTMLSpanElement>(null);
  const completedAnimationKeyRef = useRef<string | null>(null);
  const kind = metric.kind;
  const value = metric.value;
  const symbol = metric.kind === "quote" ? metric.symbol : "";
  const animationKey = getMarketCapAnimationKey(metric, replayKey);
  const finalLabel = formatMarketCapValue(
    kind,
    value,
    symbol,
    value,
  );

  useClientLayoutEffect(() => {
    const element = valueRef.current;
    if (!element) return;

    if (completedAnimationKeyRef.current === animationKey) {
      element.textContent = finalLabel;
      return;
    }

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reducedMotion || value <= 0) {
      element.textContent = finalLabel;
      completedAnimationKeyRef.current = animationKey;
      return;
    }

    let animationFrame = 0;
    let delayTimer = 0;
    const duration = 520;

    element.textContent = formatMarketCapValue(kind, value, symbol, 0);

    delayTimer = window.setTimeout(() => {
      const start = performance.now();

      const tick = (now: number) => {
        const elapsed = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - elapsed, 3);
        element.textContent = formatMarketCapValue(
          kind,
          value,
          symbol,
          value * eased,
        );

        if (elapsed < 1) {
          animationFrame = window.requestAnimationFrame(tick);
        } else {
          element.textContent = finalLabel;
          completedAnimationKeyRef.current = animationKey;
        }
      };

      animationFrame = window.requestAnimationFrame(tick);
    }, delay);

    return () => {
      window.clearTimeout(delayTimer);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [
    animationKey,
    delay,
    finalLabel,
    kind,
    symbol,
    value,
  ]);

  return (
    <strong
      className="animated-market-cap"
      style={{ position: "relative" }}
    >
      <span aria-hidden="true" style={{ visibility: "hidden" }}>
        {finalLabel}
      </span>
      <span
        aria-hidden="true"
        ref={valueRef}
        style={{ inset: 0, position: "absolute" }}
      >
        {finalLabel}
      </span>
      <span className="sr-only">{finalLabel}</span>
    </strong>
  );
}
