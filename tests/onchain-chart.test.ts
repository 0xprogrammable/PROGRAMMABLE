import { describe, expect, it } from "vitest";

import {
  collapsePricePointsByBlock,
  feeVolumeEventKindForToken,
  findChartRangeStartBlock,
  isTokenChartRange,
  readTokenChartSeries,
  samplePricePoints,
  sumGrossNativeVolume,
} from "../lib/onchain/chart";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 100n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://primary.example",
  rpcUrlSecondary: "https://secondary.example",
  confirmations: 12n,
  logBlockRange: 10_000n,
} satisfies ReadyOnchainDeployment;

const classicToken = {
  id: "1:classic",
  name: "Classic",
  symbol: "CLASSIC",
  tokenAddress: "0x4444444444444444444444444444444444444444",
  hookAddress: "0x5555555555555555555555555555555555555555",
  poolId: `0x${"66".repeat(32)}`,
  launchedAt: "2026-07-29T00:00:00.000Z",
  tokenDecimals: 18,
  totalSwapFeeBps: 100,
  launchModel: "classic",
  liquidityPath: "meme",
} satisfies LauncherToken;

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

  it("counts both swap directions as positive pool-side native volume", () => {
    expect(
      sumGrossNativeVolume([
        2_000_000_000_000_000n,
        -3_500_000_000_000_000n,
        0n,
      ]),
    ).toBe(5_500_000_000_000_000n);
  });

  it("selects each launch model's exact fee-volume event", () => {
    expect(feeVolumeEventKindForToken(classicToken, 1)).toBe("classic");
    expect(
      feeVolumeEventKindForToken(
        {
          ...classicToken,
          hookAddress: "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC",
        },
        1,
      ),
    ).toBe("classic-v3");
    expect(
      feeVolumeEventKindForToken(
        { ...classicToken, launchModel: "adaptive" },
        1,
      ),
    ).toBe("adaptive");
    expect(
      feeVolumeEventKindForToken(
        {
          ...classicToken,
          launchModel: "deep",
          deepReleaseVersion: "deep-full-range-v2",
        },
        1,
      ),
    ).toBe("deep-v1-v2");
    expect(
      feeVolumeEventKindForToken(
        {
          ...classicToken,
          launchModel: "deep",
          deepReleaseVersion: "deep-full-range-v3",
        },
        1,
      ),
    ).toBe("deep-v3");
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

  it("fails closed for Stock-Paired history instead of applying native ETH chart math", async () => {
    const stockToken = {
      id: "1:stock",
      name: "Stock",
      symbol: "STOCK",
      tokenAddress: "0x4444444444444444444444444444444444444444",
      hookAddress: "0x5555555555555555555555555555555555555555",
      poolId: `0x${"66".repeat(32)}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      launchBlockNumber: "not-a-block",
      tokenDecimals: 18,
      launchModel: "stock-paired",
      quoteAssetAddress: "0x7777777777777777777777777777777777777777",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;

    await expect(
      readTokenChartSeries({
        deployment,
        token: stockToken,
        snapshotBlock: 1_000n,
        ethUsdQuote: { answer: "350000000000", decimals: 8 },
      }),
    ).resolves.toEqual({
      status: "insufficient-history",
      points: [],
      swapCount: 0,
      volumeWei: "0",
      volumeEth: "0",
    });
  });
});
