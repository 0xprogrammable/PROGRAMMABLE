import { describe, expect, it } from "vitest";

import {
  collapsePricePointsByBlock,
  samplePricePoints,
} from "../lib/onchain/chart";

describe("onchain token chart", () => {
  it("keeps the closing swap from each block", () => {
    const points = collapsePricePointsByBlock([
      { blockNumber: 12n, logIndex: 4, sqrtPriceX96: 44n },
      { blockNumber: 11n, logIndex: 2, sqrtPriceX96: 22n },
      { blockNumber: 12n, logIndex: 1, sqrtPriceX96: 33n },
      { blockNumber: 11n, logIndex: 1, sqrtPriceX96: 11n },
    ]);

    expect(points).toEqual([
      { blockNumber: 11n, logIndex: 2, sqrtPriceX96: 22n },
      { blockNumber: 12n, logIndex: 4, sqrtPriceX96: 44n },
    ]);
  });

  it("bounds dense history while preserving both endpoints", () => {
    const points = Array.from({ length: 101 }, (_, index) => index);
    const sampled = samplePricePoints(points, 8);

    expect(sampled).toHaveLength(8);
    expect(sampled[0]).toBe(0);
    expect(sampled.at(-1)).toBe(100);
  });

  it("rejects a chart limit that cannot preserve both endpoints", () => {
    expect(() => samplePricePoints([1, 2, 3], 1)).toThrow(
      "Chart point limit must be at least 2",
    );
  });
});
