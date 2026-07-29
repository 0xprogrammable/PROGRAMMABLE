import { describe, expect, it } from "vitest";

import {
  formatMarketCapMetric,
  getMarketCapAnimationKey,
} from "../components/animated-market-cap";

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

  it("replays only when the metric or visible result set changes", () => {
    const metric = { kind: "usd", value: 194_000 } as const;
    const stableKey = getMarketCapAnimationKey(
      metric,
      "1:market-cap:",
    );

    expect(
      getMarketCapAnimationKey(metric, "1:market-cap:"),
    ).toBe(stableKey);
    expect(
      getMarketCapAnimationKey(
        { kind: "usd", value: 195_000 },
        "1:market-cap:",
      ),
    ).not.toBe(stableKey);
    expect(
      getMarketCapAnimationKey(metric, "2:market-cap:"),
    ).not.toBe(stableKey);
    expect(
      getMarketCapAnimationKey(metric, "1:newest:"),
    ).not.toBe(stableKey);
  });
});
