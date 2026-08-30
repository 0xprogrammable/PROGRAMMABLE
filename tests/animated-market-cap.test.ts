import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AnimatedMarketCap,
  formatMarketCapMetric,
  interpolateMarketCapValue,
  MARKET_CAP_ANIMATION_DURATION_MS,
  shouldAnimateMarketCapChange,
  type MarketCapMetric,
} from "../components/animated-market-cap";

function shouldAnimate(
  previousMetric: MarketCapMetric | null,
  nextMetric: MarketCapMetric,
  options: Readonly<{
    nextReplayKey?: string;
    previousReplayKey?: string | null;
    reducedMotion?: boolean;
  }> = {},
) {
  return shouldAnimateMarketCapChange({
    nextMetric,
    nextReplayKey: options.nextReplayKey ?? "token-1",
    previousMetric,
    previousReplayKey:
      options.previousReplayKey === undefined
        ? "token-1"
        : options.previousReplayKey,
    reducedMotion: options.reducedMotion ?? false,
  });
}

describe("market cap formatting", () => {
  it("keeps the Explore USD format while values animate", () => {
    const metric = { kind: "usd", value: 194_000 } as const;

    expect(formatMarketCapMetric(metric, 0)).toBe("$0");
    expect(formatMarketCapMetric(metric, 97_000)).toBe("$97K");
    expect(formatMarketCapMetric(metric)).toBe("$194K");
  });

  it("preserves ETH and quote-asset units", () => {
    expect(
      formatMarketCapMetric({ kind: "eth", value: 12.5 }),
    ).toBe("12.5 ETH");
    expect(
      formatMarketCapMetric({
        kind: "quote",
        symbol: "NVDAon",
        value: 4_200,
      }),
    ).toBe("4.2K NVDAon");
  });
});

describe("market cap animation decisions", () => {
  it("renders the first value immediately", () => {
    expect(
      shouldAnimate(null, { kind: "usd", value: 194_000 }, {
        previousReplayKey: null,
      }),
    ).toBe(false);
  });

  it("animates genuine increases and decreases for the same metric", () => {
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: 220_000 },
      ),
    ).toBe(true);
    expect(
      shouldAnimate(
        { kind: "usd", value: 220_000 },
        { kind: "usd", value: 194_000 },
      ),
    ).toBe(true);
  });

  it("does not animate no-ops or changes hidden by compact formatting", () => {
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: 194_000 },
      ),
    ).toBe(false);
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: 194_100 },
      ),
    ).toBe(false);
  });

  it("does not let replayKey changes trigger or bridge animations", () => {
    const metric = { kind: "usd", value: 194_000 } as const;

    expect(
      shouldAnimate(metric, metric, {
        nextReplayKey: "token-2",
        previousReplayKey: "token-1",
      }),
    ).toBe(false);
    expect(
      shouldAnimate(metric, { kind: "usd", value: 220_000 }, {
        nextReplayKey: "token-2",
        previousReplayKey: "token-1",
      }),
    ).toBe(false);
  });

  it("snaps for reduced motion, metric changes, and quote-symbol changes", () => {
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: 220_000 },
        { reducedMotion: true },
      ),
    ).toBe(false);
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "eth", value: 220_000 },
      ),
    ).toBe(false);
    expect(
      shouldAnimate(
        { kind: "quote", symbol: "ETH", value: 194_000 },
        { kind: "quote", symbol: "HOOD", value: 220_000 },
      ),
    ).toBe(false);
  });

  it("snaps for non-positive and non-finite values", () => {
    expect(
      shouldAnimate(
        { kind: "usd", value: 0 },
        { kind: "usd", value: 220_000 },
      ),
    ).toBe(false);
    expect(
      shouldAnimate(
        { kind: "usd", value: 194_000 },
        { kind: "usd", value: Number.POSITIVE_INFINITY },
      ),
    ).toBe(false);
  });
});

describe("market cap interpolation", () => {
  it("uses a 220ms cubic ease-out in both directions", () => {
    expect(MARKET_CAP_ANIMATION_DURATION_MS).toBe(220);
    expect(interpolateMarketCapValue(100, 200, 0)).toBe(100);
    expect(interpolateMarketCapValue(100, 200, 0.5)).toBe(187.5);
    expect(interpolateMarketCapValue(100, 200, 1)).toBe(200);
    expect(interpolateMarketCapValue(200, 100, 0.5)).toBe(112.5);
  });

  it("clamps late or early animation frames to their endpoints", () => {
    expect(interpolateMarketCapValue(100, 200, -1)).toBe(100);
    expect(interpolateMarketCapValue(100, 200, 2)).toBe(200);
  });
});

describe("market cap accessibility and sizing", () => {
  it("keeps the visual counter hidden from assistive tech and exposes the final value", () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedMarketCap, {
        metric: { kind: "usd", value: 194_000 },
        replayKey: "token-1",
      }),
    );

    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
    expect(html).toContain('<span class="sr-only">$194K</span>');
    expect(html).toContain("font-variant-numeric:tabular-nums");
    expect(html).toContain("inline-size:100%");
    expect(html).toContain("min-inline-size:7ch");
    expect(html).toContain('title="$194K"');
  });
});
