import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  parseAbiItem,
  type AbiEvent,
  type Address,
  type Hex,
} from "viem";
import { mainnet, sepolia } from "viem/chains";

import mainnetDependencies from "../../contracts/dependencies/ethereum-mainnet.json";
import sepoliaDependencies from "../../contracts/dependencies/ethereum-sepolia.json";
import mainnetClassicV3 from "../../contracts/deployments/mainnet-classic-v3.json";
import sepoliaClassicV3 from "../../contracts/deployments/sepolia-classic-v3.json";
import { deepNativeSwapFeesAccruedEvent } from "../deep-v1";
import type { LauncherToken } from "../tokens";

import {
  nativeSwapFeesAccruedEvent,
  poolManagerSwapEvent,
} from "./abis";
import { deepV3NativeSwapFeesAccruedEvent } from "./deep-v3-explore";
import { nativePriceWadFromSqrtPriceX96 } from "./math";
import { withOperationalRpcFailover } from "./operational-rpc-failover.server";
import type { ReadyOnchainDeployment } from "./types";
import { usdValueFromWei } from "./usd";

const MAXIMUM_CHART_POINTS = 80;
const CHART_RANGE_SECONDS = {
  "1h": 60n * 60n,
  "1d": 24n * 60n * 60n,
  "1w": 7n * 24n * 60n * 60n,
} as const;

const classicV3NativeSwapFeesAccruedEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,bool indexed isBuy,uint16 appliedTotalSwapFeeBps,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
);
const adaptiveNativeSwapFeesAccruedEvent = parseAbiItem(
  "event NativeSwapFeesAccrued(bytes32 indexed poolId,address indexed swapSender,int24 fdvIndex,uint16 totalSwapFeeBps,uint256 grossNativeAmount,uint256 creatorFee,uint256 launcherFee)",
);

export const TOKEN_CHART_RANGES = ["1h", "1d", "1w", "all"] as const;
export type TokenChartRange = (typeof TOKEN_CHART_RANGES)[number];
export type FeeVolumeEventKind =
  | "classic"
  | "classic-v3"
  | "adaptive"
  | "deep-v1-v2"
  | "deep-v3";

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
  status: "ready" | "insufficient-history" | "partial";
  points: TokenChartPoint[];
  swapCount: number;
  volumeWei: string;
  volumeEth: string;
  volumeUsdWad?: string;
  fdvEthWei?: string;
  fdvEth?: string;
  fdvUsdWad?: string;
  freshness: TokenChartFreshness;
};

export type TokenChartFreshness = Readonly<{
  history:
    | Readonly<{ status: "current"; throughBlock: string }>
    | Readonly<{ status: "unavailable" }>;
  price:
    | Readonly<{
        status: "current" | "stale";
        asOfBlock: string;
        lagBlocks: string;
      }>
    | Readonly<{ status: "unavailable" }>;
  valuation:
    | Readonly<{
        status: "current" | "stale";
        metric: "fdv";
        asOfBlock: string;
        lagBlocks: string;
      }>
    | Readonly<{ status: "unavailable"; metric: "fdv" }>;
}>;

export type TokenChartIntegrityReason =
  | "invalid-launch-block"
  | "launch-after-snapshot"
  | "invalid-token-decimals"
  | "invalid-valuation-block"
  | "valuation-after-snapshot";

export type TokenChartUnavailableReason = "unsupported-pool-orientation";

export class TokenChartIntegrityError extends Error {
  override name = "TokenChartIntegrityError";

  constructor(readonly reason: TokenChartIntegrityReason) {
    super("Token chart inputs failed integrity validation");
  }
}

export class TokenChartUnavailableError extends Error {
  override name = "TokenChartUnavailableError";

  constructor(readonly reason: TokenChartUnavailableReason) {
    super("Token chart data is unavailable for this pool");
  }
}

/**
 * Router Custom Graph pools do not inherit the Classic native/token PoolKey
 * orientation. Until the read model exposes a validated chart capability, the
 * public chart must not interpret their sqrtPriceX96 or fee events as Classic.
 */
export function assertTokenChartSupported(token: LauncherToken) {
  if (
    token.launchModel === "custom-graph" ||
    token.launchStampProvenance?.kind === "custom-graph"
  ) {
    throw new TokenChartUnavailableError("unsupported-pool-orientation");
  }
}

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
export function samplePricePoints<T>(
  points: T[],
  limit = MAXIMUM_CHART_POINTS,
) {
  if (limit < 2) throw new RangeError("Chart point limit must be at least 2");
  if (points.length <= limit) return points;

  const sampled: T[] = [];
  const lastIndex = points.length - 1;
  for (let index = 0; index < limit; index += 1) {
    sampled.push(points[Math.round((index * lastIndex) / (limit - 1))]);
  }
  return sampled;
}

function absoluteNativeAmount(amount: bigint) {
  return amount < 0n ? -amount : amount;
}

export function sumGrossNativeVolume(amounts: readonly bigint[]) {
  return amounts.reduce(
    (total, amount) => total + absoluteNativeAmount(amount),
    0n,
  );
}

export function feeVolumeEventKindForToken(
  token: LauncherToken,
  chainId: 1 | 11_155_111,
): FeeVolumeEventKind {
  if (token.launchModel === "deep") {
    return token.deepReleaseVersion === "deep-full-range-v3"
      ? "deep-v3"
      : "deep-v1-v2";
  }
  if (token.launchModel === "adaptive") return "adaptive";

  const classicV3Hook =
    chainId === 1
      ? mainnetClassicV3.addresses.feeHook
      : sepoliaClassicV3.addresses.feeHook;
  return token.hookAddress.toLowerCase() === classicV3Hook.toLowerCase()
    ? "classic-v3"
    : "classic";
}

function feeVolumeEventForToken(
  token: LauncherToken,
  chainId: 1 | 11_155_111,
): AbiEvent {
  const kind = feeVolumeEventKindForToken(token, chainId);
  if (kind === "classic-v3") return classicV3NativeSwapFeesAccruedEvent;
  if (kind === "adaptive") return adaptiveNativeSwapFeesAccruedEvent;
  if (kind === "deep-v1-v2") return deepNativeSwapFeesAccruedEvent;
  if (kind === "deep-v3") return deepV3NativeSwapFeesAccruedEvent;
  return nativeSwapFeesAccruedEvent;
}

function validNativeVolume(value: string | undefined) {
  return value && /^\d+$/.test(value) ? BigInt(value) : undefined;
}

function parseBlockNumber(
  value: string | undefined,
  invalidReason: TokenChartIntegrityReason,
) {
  if (value === undefined) return null;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new TokenChartIntegrityError(invalidReason);
  }
  return BigInt(value);
}

function freshnessAtBlock(
  asOfBlock: bigint,
  snapshotBlock: bigint,
): Readonly<{
  status: "current" | "stale";
  asOfBlock: string;
  lagBlocks: string;
}> {
  if (asOfBlock > snapshotBlock) {
    throw new TokenChartIntegrityError("valuation-after-snapshot");
  }
  return {
    status: asOfBlock === snapshotBlock ? "current" : "stale",
    asOfBlock: asOfBlock.toString(),
    lagBlocks: (snapshotBlock - asOfBlock).toString(),
  };
}

function positiveInteger(value: string | undefined) {
  return value && /^(?:0|[1-9]\d*)$/u.test(value) && BigInt(value) > 0n
    ? value
    : undefined;
}

function positiveDecimal(value: string | undefined) {
  if (!value || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    return undefined;
  }
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction}`) > 0n ? value : undefined;
}

function appendSnapshotPoint(
  points: TokenChartPoint[],
  token: LauncherToken,
  snapshotBlock: bigint,
  valuationBlock: bigint | null,
  ethUsdQuote?: { answer: string; decimals: number },
) {
  if (
    valuationBlock !== snapshotBlock ||
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
    ...(priceUsdWad ? { priceUsd: formatUnits(BigInt(priceUsdWad), 18) } : {}),
  };
  const lastPoint = points.at(-1);
  if (lastPoint?.blockNumber === blockNumber) {
    return [...points.slice(0, -1), snapshotPoint];
  }
  return [...points, snapshotPoint];
}

async function readTokenChartSeriesFromRpc(input: {
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
  assertTokenChartSupported(token);
  if (token.launchModel === "stock-paired") {
    return {
      status: "partial",
      points: [],
      swapCount: 0,
      volumeWei: "0",
      volumeEth: "0",
      freshness: {
        history: { status: "unavailable" },
        price: { status: "unavailable" },
        valuation: { status: "unavailable", metric: "fdv" },
      },
    };
  }
  const launchBlock =
    parseBlockNumber(token.launchBlockNumber, "invalid-launch-block") ??
    deployment.deploymentBlock;
  if (launchBlock > snapshotBlock) {
    throw new TokenChartIntegrityError("launch-after-snapshot");
  }
  if (
    typeof token.tokenDecimals !== "number" ||
    !Number.isInteger(token.tokenDecimals) ||
    token.tokenDecimals < 0 ||
    token.tokenDecimals > 255
  ) {
    throw new TokenChartIntegrityError("invalid-token-decimals");
  }
  const valuationBlock = parseBlockNumber(
    token.indexedValuationBlockNumber,
    "invalid-valuation-block",
  );
  if (valuationBlock !== null && valuationBlock > snapshotBlock) {
    throw new TokenChartIntegrityError("valuation-after-snapshot");
  }

  const client = createPublicClient({
    chain: deployment.chainId === 1 ? mainnet : sepolia,
    transport: http(deployment.rpcUrl, {
      retryCount: 1,
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
  const indexedAllTimeVolume =
    range === "all" ? validNativeVolume(token.grossVolumeWei) : undefined;
  let volumeWei = indexedAllTimeVolume ?? 0n;
  const shouldReadFeeVolume = indexedAllTimeVolume === undefined;
  const feeVolumeEvent = feeVolumeEventForToken(token, deployment.chainId);

  for (
    let fromBlock = rangeStartBlock;
    fromBlock <= snapshotBlock;
    fromBlock += deployment.logBlockRange
  ) {
    const toBlock = minimum(
      snapshotBlock,
      fromBlock + deployment.logBlockRange - 1n,
    );
    const [logs, feeLogs] = await Promise.all([
      client.getLogs({
        address: poolManagerAddress(deployment.chainId),
        event: poolManagerSwapEvent,
        args: { id: token.poolId as Hex },
        fromBlock,
        toBlock,
        strict: true,
      }),
      shouldReadFeeVolume
        ? client.getLogs({
            address: getAddress(token.hookAddress),
            event: feeVolumeEvent,
            args: { poolId: token.poolId as Hex },
            fromBlock,
            toBlock,
            strict: true,
          })
        : Promise.resolve([]),
    ]);

    for (const log of logs) {
      if (log.removed || log.blockNumber === null) continue;
      rawPoints.push({
        blockNumber: log.blockNumber,
        logIndex: log.logIndex,
        sqrtPriceX96: log.args.sqrtPriceX96,
      });
    }
    for (const log of feeLogs) {
      if (log.removed) continue;
      const args = log.args;
      if (
        args &&
        typeof args === "object" &&
        "grossNativeAmount" in args &&
        typeof args.grossNativeAmount === "bigint"
      ) {
        volumeWei += args.grossNativeAmount;
      }
    }
  }

  const sampled = samplePricePoints(collapsePricePointsByBlock(rawPoints));
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
    valuationBlock,
    ethUsdQuote,
  );
  const volumeUsdWad = ethUsdQuote
    ? usdValueFromWei(
        volumeWei.toString(),
        BigInt(ethUsdQuote.answer),
        ethUsdQuote.decimals,
      )
    : undefined;
  const latestPoint = completedPoints.at(-1);
  const latestPointBlock = latestPoint
    ? parseBlockNumber(latestPoint.blockNumber, "invalid-valuation-block")
    : null;
  const priceFreshness = latestPointBlock === null
    ? { status: "unavailable" as const }
    : freshnessAtBlock(latestPointBlock, snapshotBlock);
  // These legacy read-model values are total-supply valuations. The public
  // chart contract names them FDV until circulating supply is evidenced.
  const fdvEthWei = positiveInteger(token.marketCapEthWei);
  const fdvEth = positiveDecimal(token.marketCapEth);
  const fdvUsdWad = positiveInteger(token.fdvUsdWad);
  const hasFdv = Boolean(fdvEthWei || fdvEth || fdvUsdWad);
  const valuationFreshness = valuationBlock !== null && hasFdv
    ? { metric: "fdv" as const, ...freshnessAtBlock(valuationBlock, snapshotBlock) }
    : { status: "unavailable" as const, metric: "fdv" as const };
  const hasCurrentPrice = priceFreshness.status === "current";

  return {
    status: hasCurrentPrice
      ? completedPoints.length >= 2
        ? "ready"
        : "insufficient-history"
      : "partial",
    points: completedPoints,
    swapCount: rawPoints.length,
    volumeWei: volumeWei.toString(),
    volumeEth: formatUnits(volumeWei, 18),
    ...(volumeUsdWad === undefined ? {} : { volumeUsdWad }),
    ...(valuationBlock === null || !fdvEthWei ? {} : { fdvEthWei }),
    ...(valuationBlock === null || !fdvEth ? {} : { fdvEth }),
    ...(valuationBlock === null || !fdvUsdWad ? {} : { fdvUsdWad }),
    freshness: {
      history: {
        status: "current",
        throughBlock: snapshotBlock.toString(),
      },
      price: priceFreshness,
      valuation: valuationFreshness,
    },
  };
}

export async function readTokenChartSeries(input: {
  deployment: ReadyOnchainDeployment;
  token: LauncherToken;
  snapshotBlock: bigint;
  ethUsdQuote?: { answer: string; decimals: number };
  range?: TokenChartRange;
}): Promise<TokenChartSeries> {
  return withOperationalRpcFailover(
    input.deployment,
    (deployment) => readTokenChartSeriesFromRpc({
      ...input,
      deployment,
    }),
  );
}
