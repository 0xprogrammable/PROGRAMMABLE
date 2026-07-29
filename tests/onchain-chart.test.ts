import { describe, expect, it } from "vitest";

import {
  collapsePricePointsByBlock,
  findChartRangeStartBlock,
  isTokenChartRange,
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

  it("accepts only the public chart ranges", () => {
    expect(isTokenChartRange("1h")).toBe(true);
    expect(isTokenChartRange("1d")).toBe(true);
    expect(isTokenChartRange("1w")).toBe(true);
    expect(isTokenChartRange("all")).toBe(true);
    expect(isTokenChartRange("1s")).toBe(false);
    expect(isTokenChartRange("month")).toBe(false);
  });

  it("finds the first block inside a wall-clock range", async () => {
    const startBlock = await findChartRangeStartBlock({
      launchBlock: 100n,
      snapshotBlock: 1_000n,
      range: "1h",
      readTimestamp: async (blockNumber) => blockNumber * 12n,
    });

    expect(startBlock).toBe(700n);
  });

  it("uses the launch block for all-time history without timestamp reads", async () => {
    let reads = 0;
    const startBlock = await findChartRangeStartBlock({
      launchBlock: 123n,
      snapshotBlock: 1_000n,
      range: "all",
      readTimestamp: async () => {
        reads += 1;
        return 0n;
      },
    });

    expect(startBlock).toBe(123n);
    expect(reads).toBe(0);
  });
});
