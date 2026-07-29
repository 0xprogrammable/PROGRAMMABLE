import {
  createPublicClient,
  fallback,
  formatUnits,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import mainnetDependencies from "../../contracts/dependencies/ethereum-mainnet.json";
import sepoliaDependencies from "../../contracts/dependencies/ethereum-sepolia.json";
import type { LauncherToken } from "../tokens";

import { poolManagerSwapEvent } from "./abis";
import { nativePriceWadFromSqrtPriceX96 } from "./math";
import type { ReadyOnchainDeployment } from "./types";
import { usdValueFromWei } from "./usd";

const MAXIMUM_CHART_POINTS = 80;
const CHART_RANGE_SECONDS = {
  "1h": 60n * 60n,
  "1d": 24n * 60n * 60n,
  "1w": 7n * 24n * 60n * 60n,
} as const;

export const TOKEN_CHART_RANGES = ["1h", "1d", "1w", "all"] as const;
export type TokenChartRange = (typeof TOKEN_CHART_RANGES)[number];

type RawPricePoint = {
  blockNumber: bigint;
  logIndex: number;
  sqrtPriceX96: bigint;
};

export type TokenChartPoint = {
  blockNumber: string;
  priceEth: string;
  priceUsd?: string;
};

export type TokenChartSeries = {
  status: "ready" | "insufficient-history";
  points: TokenChartPoint[];
  swapCount: number;
};

export function isTokenChartRange(
  value: string | null,
): value is TokenChartRange {
  return TOKEN_CHART_RANGES.some((range) => range === value);
}

/**
 * Finds the first block inside a requested wall-clock range. Ethereum block
 * times are not exact, so deriving ranges from a fixed blocks-per-hour
 * estimate would move the boundary during periods of slower or faster blocks.
 */
export async function findChartRangeStartBlock(input: {
  launchBlock: bigint;
  snapshotBlock: bigint;
  range: TokenChartRange;
  readTimestamp: (blockNumber: bigint) => Promise<bigint>;
}) {
  const { launchBlock, snapshotBlock, range, readTimestamp } = input;
  if (range === "all" || launchBlock >= snapshotBlock) return launchBlock;

  const snapshotTimestamp = await readTimestamp(snapshotBlock);
  const duration = CHART_RANGE_SECONDS[range];
  const targetTimestamp =
    snapshotTimestamp > duration ? snapshotTimestamp - duration : 0n;
  let lower = launchBlock;
  let upper = snapshotBlock;

  while (lower < upper) {
    const midpoint = lower + (upper - lower) / 2n;
    const timestamp = await readTimestamp(midpoint);
    if (timestamp < targetTimestamp) {
      lower = midpoint + 1n;
    } else {
      upper = midpoint;
    }
  }

  return lower;
}

function minimum(first: bigint, second: bigint) {
  return first < second ? first : second;
}

function poolManagerAddress(chainId: 1 | 11_155_111): Address {
  const dependencies =
    chainId === 1 ? mainnetDependencies : sepoliaDependencies;
  return getAddress(dependencies.contracts.poolManager.address);
}

/**
 * Keeps the final swap from each block. Multiple swaps in one block share the
 * same horizontal position, so retaining the closing price avoids duplicate
 * SVG coordinates without hiding the final state.
 */
export function collapsePricePointsByBlock(points: RawPricePoint[]) {
  const byBlock = new Map<string, RawPricePoint>();
  for (const point of [...points].sort((first, second) => {
    if (first.blockNumber === second.blockNumber) {
      return first.logIndex - second.logIndex;
    }
    return first.blockNumber < second.blockNumber ? -1 : 1;
  })) {
    byBlock.set(point.blockNumber.toString(), point);
  }
  return [...byBlock.values()];
}

/**
 * Samples the complete series while always preserving its first and last
 * points. This bounds the response and rendering work for heavily traded
 * pools without changing the underlying onchain values.
 */
export function samplePricePoints<T>(points: T[], limit = MAXIMUM_CHART_POINTS) {
  if (limit < 2) throw new RangeError("Chart point limit must be at least 2");
  if (points.length <= limit) return points;

  const sampled: T[] = [];
  const lastIndex = points.length - 1;
  for (let index = 0; index < limit; index += 1) {
    sampled.push(points[Math.round((index * lastIndex) / (limit - 1))]);
  }
  return sampled;
}

function appendSnapshotPoint(
  points: TokenChartPoint[],
  token: LauncherToken,
  snapshotBlock: bigint,
  ethUsdQuote?: { answer: string; decimals: number },
) {
  if (
    !token.tokenPriceEthWei ||
    !/^\d+$/.test(token.tokenPriceEthWei) ||
    BigInt(token.tokenPriceEthWei) <= 0n
  ) {
    return points;
  }

  const blockNumber = snapshotBlock.toString();
  const priceUsdWad = ethUsdQuote
    ? usdValueFromWei(
        token.tokenPriceEthWei,
        BigInt(ethUsdQuote.answer),
        ethUsdQuote.decimals,
      )
    : undefined;
  const snapshotPoint: TokenChartPoint = {
    blockNumber,
    priceEth: formatUnits(BigInt(token.tokenPriceEthWei), 18),
    ...(priceUsdWad
      ? { priceUsd: formatUnits(BigInt(priceUsdWad), 18) }
      : {}),
  };
  const lastPoint = points.at(-1);
  if (lastPoint?.blockNumber === blockNumber) {
    return [...points.slice(0, -1), snapshotPoint];
  }
  return [...points, snapshotPoint];
}

export async function readTokenChartSeries(input: {
  deployment: ReadyOnchainDeployment;
  token: LauncherToken;
  snapshotBlock: bigint;
  ethUsdQuote?: { answer: string; decimals: number };
  range?: TokenChartRange;
}): Promise<TokenChartSeries> {
  const {
    deployment,
    token,
    snapshotBlock,
    ethUsdQuote,
    range = "all",
  } = input;
  const launchBlock = token.launchBlockNumber
    ? BigInt(token.launchBlockNumber)
    : deployment.deploymentBlock;
  if (
    launchBlock > snapshotBlock ||
    typeof token.tokenDecimals !== "number" ||
    !Number.isInteger(token.tokenDecimals)
  ) {
    return { status: "insufficient-history", points: [], swapCount: 0 };
  }

  const client = createPublicClient({
    chain: deployment.chainId === 1 ? mainnet : sepolia,
    transport: deployment.rpcUrlSecondary
      ? fallback([
          http(deployment.rpcUrl, {
            retryCount: 1,
            timeout: 12_000,
          }),
          http(deployment.rpcUrlSecondary, {
            retryCount: 1,
            timeout: 12_000,
          }),
        ])
      : http(deployment.rpcUrl, {
          retryCount: 2,
          timeout: 12_000,
      }),
  });
  const rangeStartBlock = await findChartRangeStartBlock({
    launchBlock,
    snapshotBlock,
    range,
    readTimestamp: async (blockNumber) =>
      (await client.getBlock({ blockNumber })).timestamp,
  });
  const rawPoints: RawPricePoint[] = [];

  for (
    let fromBlock = rangeStartBlock;
    fromBlock <= snapshotBlock;
    fromBlock += deployment.logBlockRange
  ) {
    const toBlock = minimum(
      snapshotBlock,
      fromBlock + deployment.logBlockRange - 1n,
    );
    const logs = await client.getLogs({
      address: poolManagerAddress(deployment.chainId),
      event: poolManagerSwapEvent,
      args: { id: token.poolId as Hex },
      fromBlock,
      toBlock,
      strict: true,
    });

    for (const log of logs) {
      if (log.removed || log.blockNumber === null) continue;
      rawPoints.push({
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        sqrtPriceX96: log.args.sqrtPriceX96,
      });
    }
  }

  const sampled = samplePricePoints(
    collapsePricePointsByBlock(rawPoints),
  );
  const points = sampled.map((point): TokenChartPoint => {
    const priceEthWei = nativePriceWadFromSqrtPriceX96(
      point.sqrtPriceX96,
      token.tokenDecimals as number,
    );
    const priceUsdWad = ethUsdQuote
      ? usdValueFromWei(
          priceEthWei.toString(),
          BigInt(ethUsdQuote.answer),
          ethUsdQuote.decimals,
        )
      : undefined;
    return {
      blockNumber: point.blockNumber.toString(),
      priceEth: formatUnits(priceEthWei, 18),
      ...(priceUsdWad
        ? { priceUsd: formatUnits(BigInt(priceUsdWad), 18) }
        : {}),
    };
  });
  const completedPoints = appendSnapshotPoint(
    points,
    token,
    snapshotBlock,
    ethUsdQuote,
  );

  return {
    status:
      completedPoints.length >= 2 ? "ready" : "insufficient-history",
    points: completedPoints,
    swapCount: rawPoints.length,
  };
}
