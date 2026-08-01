import "server-only";

import { encodeAbiParameters, keccak256 } from "viem";
import { CircuitBreaker } from "./circuit";
import {
  canonicalAddress,
  canonicalBytes32,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
} from "./codecs";
import { loadDataPipelineConfig } from "./config";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
  type DataPipelineErrorCode,
} from "./errors";
import { boundedJsonRequest, type DataPipelineFetcher } from "./request";
import { getDataPipelineReleaseBinding } from "./release-binding.server";
import { UNISWAP_ANALYTICS_PARSER_BINDING } from "./uniswap-parser-binding";

const RELEASE_BINDING = getDataPipelineReleaseBinding();
export const OFFICIAL_V4_SUBGRAPH_ID =
  RELEASE_BINDING.uniswapV4Subgraph.subgraphId;
export const OFFICIAL_V4_SUBGRAPH_DEPLOYMENT =
  RELEASE_BINDING.uniswapV4Subgraph.deployment;
const OFFICIAL_V4_SUBGRAPH_GATEWAY_BASE_URL = "https://gateway.thegraph.com";

// Conservative query spans keep each fixed subgraph request bounded before
// entity pagination: six hours of swaps, 31 days of hourly candles, and one
// leap year of daily candles. Every split remains half-open: [from, to).
export const UNISWAP_SWAP_WINDOW_SECONDS = 21_600n;
export const UNISWAP_HOUR_WINDOW_SECONDS = 2_678_400;
export const UNISWAP_DAY_WINDOW_SECONDS = 31_622_400;

const POOL_QUERY = `
  query ProgrammablePoolSnapshot($poolId: ID!, $block: Int!) {
    _meta(block: { number: $block }) {
      deployment
      hasIndexingErrors
      block { number hash }
    }
    pool(
      id: $poolId
      block: { number: $block }
      subgraphError: deny
    ) {
      id
      createdAtTimestamp
      createdAtBlockNumber
      token0 { id decimals }
      token1 { id decimals }
      hooks
      feeTier
      tickSpacing
      liquidity
      sqrtPrice
      tick
      txCount
      volumeToken0
      volumeToken1
      volumeUSD
      totalValueLockedToken0
      totalValueLockedToken1
      totalValueLockedUSD
    }
  }
`;

const SWAP_QUERY = `
  query ProgrammableSwapPage(
    $poolId: String!
    $blockHash: Bytes!
    $from: BigInt!
    $toExclusive: BigInt!
    $cursor: ID!
  ) {
    _meta(block: { hash: $blockHash }) {
      deployment
      hasIndexingErrors
      block { number hash }
    }
    swaps(
      first: 250
      orderBy: id
      orderDirection: asc
      block: { hash: $blockHash }
      subgraphError: deny
      where: {
        pool: $poolId
        timestamp_gte: $from
        timestamp_lt: $toExclusive
        id_gt: $cursor
      }
    ) {
      id
      transaction { id blockNumber timestamp }
      timestamp
      pool { id }
      sender
      origin
      amount0
      amount1
      amountUSD
      sqrtPriceX96
      tick
      logIndex
    }
  }
`;

const HOUR_QUERY = `
  query ProgrammablePoolHourSeries(
    $poolId: String!
    $blockHash: Bytes!
    $from: Int!
    $toExclusive: Int!
    $cursor: ID!
  ) {
    _meta(block: { hash: $blockHash }) {
      deployment
      hasIndexingErrors
      block { number hash }
    }
    poolHourDatas(
      first: 250
      orderBy: id
      orderDirection: asc
      block: { hash: $blockHash }
      subgraphError: deny
      where: {
        pool: $poolId
        periodStartUnix_gte: $from
        periodStartUnix_lt: $toExclusive
        id_gt: $cursor
      }
    ) {
      id
      periodStartUnix
      pool { id }
      liquidity
      sqrtPrice
      token0Price
      token1Price
      tick
      tvlUSD
      volumeToken0
      volumeToken1
      volumeUSD
      feesUSD
      txCount
      open
      high
      low
      close
    }
  }
`;

const DAY_QUERY = `
  query ProgrammablePoolDaySeries(
    $poolId: String!
    $blockHash: Bytes!
    $from: Int!
    $toExclusive: Int!
    $cursor: ID!
  ) {
    _meta(block: { hash: $blockHash }) {
      deployment
      hasIndexingErrors
      block { number hash }
    }
    poolDayDatas(
      first: 250
      orderBy: id
      orderDirection: asc
      block: { hash: $blockHash }
      subgraphError: deny
      where: {
        pool: $poolId
        date_gte: $from
        date_lt: $toExclusive
        id_gt: $cursor
      }
    ) {
      id
      date
      pool { id }
      liquidity
      sqrtPrice
      token0Price
      token1Price
      tick
      tvlUSD
      volumeToken0
      volumeToken1
      volumeUSD
      feesUSD
      txCount
      open
      high
      low
      close
    }
  }
`;

// This is the canonical provenance input for consumers that persist Graph
// facts. It deliberately references the exact documents executed below. Any
// parser behavior change must ship with a new parser contract version so a
// registered schema commitment cannot silently describe different semantics.
export const UNISWAP_ANALYTICS_QUERY_CONTRACT = Object.freeze({
  parser: UNISWAP_ANALYTICS_PARSER_BINDING,
  queries: Object.freeze({
    poolSnapshot: POOL_QUERY,
    swaps: SWAP_QUERY,
    hourSeries: HOUR_QUERY,
    daySeries: DAY_QUERY,
  }),
});

export type VerifiedPoolKey = {
  poolId: string;
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  token0Decimals: number;
  token1Decimals: number;
};

type CanonicalPoolKey = {
  poolId: HexBytes32;
  currency0: HexAddress;
  currency1: HexAddress;
  fee: number;
  tickSpacing: number;
  hooks: HexAddress;
  token0Decimals: number;
  token1Decimals: number;
};

export type AnalyticsProvenance = {
  deployment: typeof OFFICIAL_V4_SUBGRAPH_DEPLOYMENT;
  blockNumber: string;
  blockHash: HexBytes32;
};

export type AnalyticsResult<T> =
  | {
      status: "ready";
      data: T;
      provenance: AnalyticsProvenance;
    }
  | {
      status: "pending";
      reason: DataPipelineErrorCode;
    };

type Meta = AnalyticsProvenance;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function unsigned(value: unknown, maximumDigits = 78): string {
  try {
    return parseNonnegativeIntegerText(value, maximumDigits);
  } catch {
    throw validationError("uniswap", "integer");
  }
}

function decimal(value: unknown, signed = false): string {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    !(signed
      ? /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
      : /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
  ) {
    throw validationError("uniswap", "decimal");
  }
  return value;
}

function safeInteger(value: unknown, minimum: number, maximum: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw validationError("uniswap", "integer");
  }
  return parsed;
}

function id(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw validationError("uniswap", "entity-id");
  }
  return value;
}

function responseData(
  response: unknown,
  entityKey: string,
): { meta: unknown; entity: unknown } {
  if (
    !isRecord(response) ||
    !onlyKeys(response, ["data"]) ||
    !isRecord(response.data) ||
    !onlyKeys(response.data, ["_meta", entityKey])
  ) {
    throw validationError("uniswap", "response");
  }
  return {
    meta: response.data._meta,
    entity: response.data[entityKey],
  };
}

function parseMeta(
  value: unknown,
  block: { number: string; hash: string },
): Meta {
  if (
    !isRecord(value) ||
    !onlyKeys(value, ["deployment", "hasIndexingErrors", "block"]) ||
    value.deployment !== OFFICIAL_V4_SUBGRAPH_DEPLOYMENT ||
    value.hasIndexingErrors !== false ||
    !isRecord(value.block) ||
    !onlyKeys(value.block, ["number", "hash"])
  ) {
    throw validationError("uniswap", "metadata");
  }
  const number = unsigned(
    typeof value.block.number === "number"
      ? String(value.block.number)
      : value.block.number,
  );
  const hash = providerBytes32(value.block.hash);
  if (number !== block.number || hash !== block.hash) {
    throw validationError("uniswap", "metadata-block");
  }
  return {
    deployment: OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
    blockNumber: number,
    blockHash: hash,
  };
}

function providerAddress(value: unknown): HexAddress {
  try {
    return canonicalAddress(value);
  } catch {
    throw validationError("uniswap", "address");
  }
}

function providerBytes32(value: unknown): HexBytes32 {
  try {
    return canonicalBytes32(value);
  } catch {
    throw validationError("uniswap", "bytes32");
  }
}

function canonicalPoolKey(value: VerifiedPoolKey): CanonicalPoolKey {
  let poolId: HexBytes32;
  let currency0: HexAddress;
  let currency1: HexAddress;
  let hooks: HexAddress;
  try {
    poolId = canonicalBytes32(value.poolId);
    currency0 = canonicalAddress(value.currency0);
    currency1 = canonicalAddress(value.currency1);
    hooks = canonicalAddress(value.hooks);
  } catch {
    throw invalidInput("uniswap", "pool-key");
  }
  if (
    BigInt(currency0) >= BigInt(currency1) ||
    !Number.isSafeInteger(value.fee) ||
    (value.fee !== 0x80_00_00 && (value.fee < 0 || value.fee > 1_000_000)) ||
    !Number.isSafeInteger(value.tickSpacing) ||
    value.tickSpacing < 1 ||
    value.tickSpacing > 32_767 ||
    !Number.isSafeInteger(value.token0Decimals) ||
    value.token0Decimals < 0 ||
    value.token0Decimals > 255 ||
    !Number.isSafeInteger(value.token1Decimals) ||
    value.token1Decimals < 0 ||
    value.token1Decimals > 255
  ) {
    throw invalidInput("uniswap", "pool-key");
  }
  const recomputed = keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [currency0, currency1, value.fee, value.tickSpacing, hooks],
    ),
  );
  if (recomputed !== poolId) throw invalidInput("uniswap", "pool-id");
  return {
    poolId,
    currency0,
    currency1,
    fee: value.fee,
    tickSpacing: value.tickSpacing,
    hooks,
    token0Decimals: value.token0Decimals,
    token1Decimals: value.token1Decimals,
  };
}

function canonicalBlock(value: { number: string; hash: string }) {
  let number: string;
  let hash: HexBytes32;
  try {
    number = parseNonnegativeIntegerText(value.number, 10);
    hash = canonicalBytes32(value.hash);
  } catch {
    throw invalidInput("uniswap", "block");
  }
  const graphNumber = Number(number);
  if (
    !Number.isSafeInteger(graphNumber) ||
    graphNumber < 0 ||
    graphNumber > 2_147_483_647
  ) {
    throw invalidInput("uniswap", "block");
  }
  return { number, hash, graphNumber };
}

export type PoolSnapshot = {
  id: HexBytes32;
  createdAtTimestamp: string;
  createdAtBlockNumber: string;
  token0: { id: HexAddress; decimals: number };
  token1: { id: HexAddress; decimals: number };
  hooks: HexAddress;
  appliedFeeTier: string;
  tickSpacing: number;
  liquidity: string;
  sqrtPriceX96: string;
  tick: number | null;
  transactionCount: string;
  marketVolumeToken0: string;
  marketVolumeToken1: string;
  marketVolumeUsd: string;
  totalValueLockedToken0: string;
  totalValueLockedToken1: string;
  totalValueLockedUsd: string;
};

function parsePool(value: unknown, key: CanonicalPoolKey): PoolSnapshot {
  const keys = [
    "id",
    "createdAtTimestamp",
    "createdAtBlockNumber",
    "token0",
    "token1",
    "hooks",
    "feeTier",
    "tickSpacing",
    "liquidity",
    "sqrtPrice",
    "tick",
    "txCount",
    "volumeToken0",
    "volumeToken1",
    "volumeUSD",
    "totalValueLockedToken0",
    "totalValueLockedToken1",
    "totalValueLockedUSD",
  ] as const;
  if (
    !isRecord(value) ||
    !onlyKeys(value, keys) ||
    !isRecord(value.token0) ||
    !onlyKeys(value.token0, ["id", "decimals"]) ||
    !isRecord(value.token1) ||
    !onlyKeys(value.token1, ["id", "decimals"])
  ) {
    throw validationError("uniswap", "pool");
  }
  const poolId = providerBytes32(value.id);
  const token0 = providerAddress(value.token0.id);
  const token1 = providerAddress(value.token1.id);
  const hooks = providerAddress(value.hooks);
  const token0Decimals = safeInteger(value.token0.decimals, 0, 255);
  const token1Decimals = safeInteger(value.token1.decimals, 0, 255);
  const tickSpacing = safeInteger(value.tickSpacing, 1, 0x7f_ffff);
  if (
    poolId !== key.poolId ||
    token0 !== key.currency0 ||
    token1 !== key.currency1 ||
    hooks !== key.hooks ||
    token0Decimals !== key.token0Decimals ||
    token1Decimals !== key.token1Decimals ||
    tickSpacing !== key.tickSpacing
  ) {
    throw validationError("uniswap", "pool-key");
  }
  return {
    id: poolId,
    createdAtTimestamp: unsigned(value.createdAtTimestamp),
    createdAtBlockNumber: unsigned(value.createdAtBlockNumber),
    token0: { id: token0, decimals: token0Decimals },
    token1: { id: token1, decimals: token1Decimals },
    hooks,
    appliedFeeTier: unsigned(value.feeTier, 8),
    tickSpacing,
    liquidity: unsigned(value.liquidity),
    sqrtPriceX96: unsigned(value.sqrtPrice),
    tick:
      value.tick === null ? null : safeInteger(value.tick, -887_272, 887_272),
    transactionCount: unsigned(value.txCount),
    marketVolumeToken0: decimal(value.volumeToken0),
    marketVolumeToken1: decimal(value.volumeToken1),
    marketVolumeUsd: decimal(value.volumeUSD),
    totalValueLockedToken0: decimal(value.totalValueLockedToken0),
    totalValueLockedToken1: decimal(value.totalValueLockedToken1),
    totalValueLockedUsd: decimal(value.totalValueLockedUSD),
  };
}

export type SwapAnalytics = {
  id: string;
  transactionHash: HexBytes32;
  blockNumber: string;
  transactionTimestamp: string;
  timestamp: string;
  poolId: HexBytes32;
  sender: HexAddress;
  origin: HexAddress;
  amount0: string;
  amount1: string;
  marketAmountUsd: string;
  sqrtPriceX96: string;
  tick: number;
  logIndex: string;
};

function parseSwap(
  value: unknown,
  key: CanonicalPoolKey,
  from: bigint,
  toExclusive: bigint,
): SwapAnalytics {
  const keys = [
    "id",
    "transaction",
    "timestamp",
    "pool",
    "sender",
    "origin",
    "amount0",
    "amount1",
    "amountUSD",
    "sqrtPriceX96",
    "tick",
    "logIndex",
  ] as const;
  if (
    !isRecord(value) ||
    !onlyKeys(value, keys) ||
    !isRecord(value.transaction) ||
    !onlyKeys(value.transaction, ["id", "blockNumber", "timestamp"]) ||
    !isRecord(value.pool) ||
    !onlyKeys(value.pool, ["id"])
  ) {
    throw validationError("uniswap", "swap");
  }
  const timestamp = unsigned(value.timestamp);
  const numericTimestamp = BigInt(timestamp);
  const poolId = providerBytes32(value.pool.id);
  if (
    numericTimestamp < from ||
    numericTimestamp >= toExclusive ||
    poolId !== key.poolId
  ) {
    throw validationError("uniswap", "swap-window");
  }
  return {
    id: id(value.id),
    transactionHash: providerBytes32(value.transaction.id),
    blockNumber: unsigned(value.transaction.blockNumber),
    transactionTimestamp: unsigned(value.transaction.timestamp),
    timestamp,
    poolId,
    sender: providerAddress(value.sender),
    origin: providerAddress(value.origin),
    amount0: decimal(value.amount0, true),
    amount1: decimal(value.amount1, true),
    marketAmountUsd: decimal(value.amountUSD),
    sqrtPriceX96: unsigned(value.sqrtPriceX96),
    tick: safeInteger(value.tick, -887_272, 887_272),
    logIndex: unsigned(value.logIndex, 10),
  };
}

export type CandleAnalytics = {
  id: string;
  periodStart: number;
  poolId: HexBytes32;
  liquidity: string;
  sqrtPriceX96: string;
  token0Price: string;
  token1Price: string;
  tick: number;
  tvlUsd: string;
  marketVolumeToken0: string;
  marketVolumeToken1: string;
  marketVolumeUsd: string;
  feesUsd: string;
  transactionCount: string;
  open: string;
  high: string;
  low: string;
  close: string;
};

function parseCandle(
  value: unknown,
  key: CanonicalPoolKey,
  timeField: "periodStartUnix" | "date",
  from: number,
  toExclusive: number,
): CandleAnalytics {
  const keys = [
    "id",
    timeField,
    "pool",
    "liquidity",
    "sqrtPrice",
    "token0Price",
    "token1Price",
    "tick",
    "tvlUSD",
    "volumeToken0",
    "volumeToken1",
    "volumeUSD",
    "feesUSD",
    "txCount",
    "open",
    "high",
    "low",
    "close",
  ] as const;
  if (
    !isRecord(value) ||
    !onlyKeys(value, keys) ||
    !isRecord(value.pool) ||
    !onlyKeys(value.pool, ["id"])
  ) {
    throw validationError("uniswap", "candle");
  }
  const periodStart = safeInteger(value[timeField], 0, 2_147_483_647);
  const poolId = providerBytes32(value.pool.id);
  if (
    periodStart < from ||
    periodStart >= toExclusive ||
    poolId !== key.poolId
  ) {
    throw validationError("uniswap", "candle-window");
  }
  return {
    id: id(value.id),
    periodStart,
    poolId,
    liquidity: unsigned(value.liquidity),
    sqrtPriceX96: unsigned(value.sqrtPrice),
    token0Price: decimal(value.token0Price),
    token1Price: decimal(value.token1Price),
    tick: safeInteger(value.tick, -887_272, 887_272),
    tvlUsd: decimal(value.tvlUSD),
    marketVolumeToken0: decimal(value.volumeToken0),
    marketVolumeToken1: decimal(value.volumeToken1),
    marketVolumeUsd: decimal(value.volumeUSD),
    feesUsd: decimal(value.feesUSD),
    transactionCount: unsigned(value.txCount),
    open: decimal(value.open),
    high: decimal(value.high),
    low: decimal(value.low),
    close: decimal(value.close),
  };
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

export function priceRatiosFromSqrtPriceX96(input: {
  sqrtPriceX96: string;
  token0Decimals: number;
  token1Decimals: number;
}) {
  let sqrt: bigint;
  try {
    sqrt = BigInt(parseNonnegativeIntegerText(input.sqrtPriceX96));
  } catch {
    throw invalidInput("uniswap", "sqrt-price");
  }
  if (
    sqrt === 0n ||
    !Number.isSafeInteger(input.token0Decimals) ||
    input.token0Decimals < 0 ||
    input.token0Decimals > 255 ||
    !Number.isSafeInteger(input.token1Decimals) ||
    input.token1Decimals < 0 ||
    input.token1Decimals > 255
  ) {
    throw invalidInput("uniswap", "price-decimals");
  }
  const directNumerator = sqrt * sqrt * 10n ** BigInt(input.token0Decimals);
  const directDenominator = 2n ** 192n * 10n ** BigInt(input.token1Decimals);
  const divisor = gcd(directNumerator, directDenominator);
  const numerator = directNumerator / divisor;
  const denominator = directDenominator / divisor;
  return {
    token1PerToken0: {
      numerator: numerator.toString(),
      denominator: denominator.toString(),
    },
    token0PerToken1: {
      numerator: denominator.toString(),
      denominator: numerator.toString(),
    },
  };
}

function windowBigInt(from: string, toExclusive: string) {
  let canonicalFrom: string;
  let canonicalTo: string;
  try {
    canonicalFrom = parseNonnegativeIntegerText(from);
    canonicalTo = parseNonnegativeIntegerText(toExclusive);
  } catch {
    throw invalidInput("uniswap", "window");
  }
  if (BigInt(canonicalFrom) >= BigInt(canonicalTo)) {
    throw invalidInput("uniswap", "window");
  }
  return {
    from: canonicalFrom,
    toExclusive: canonicalTo,
    fromBigInt: BigInt(canonicalFrom),
    toBigInt: BigInt(canonicalTo),
  };
}

function windowInt(from: number, toExclusive: number) {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(toExclusive) ||
    from < 0 ||
    toExclusive > 2_147_483_647 ||
    from >= toExclusive
  ) {
    throw invalidInput("uniswap", "window");
  }
  return { from, toExclusive };
}

function* splitBigIntWindow(
  window: ReturnType<typeof windowBigInt>,
  maximumSpan: bigint,
) {
  let from = window.fromBigInt;
  while (from < window.toBigInt) {
    const candidate = from + maximumSpan;
    const toExclusive =
      candidate < window.toBigInt ? candidate : window.toBigInt;
    yield {
      from: from.toString(),
      toExclusive: toExclusive.toString(),
      fromBigInt: from,
      toBigInt: toExclusive,
    };
    from = toExclusive;
  }
}

function* splitIntWindow(
  window: ReturnType<typeof windowInt>,
  maximumSpan: number,
) {
  let from = window.from;
  while (from < window.toExclusive) {
    const toExclusive = Math.min(from + maximumSpan, window.toExclusive);
    yield { from, toExclusive };
    from = toExclusive;
  }
}

function pending(error: unknown): {
  status: "pending";
  reason: DataPipelineErrorCode;
} {
  if (error instanceof DataPipelineError) {
    return { status: "pending", reason: error.code };
  }
  return { status: "pending", reason: "dependency_unavailable" };
}

export function createUniswapAnalyticsClient(options: {
  gatewayBaseUrl: string;
  apiKey: string;
  fetcher?: DataPipelineFetcher;
  circuit?: CircuitBreaker;
  limits?: {
    maximumPages: number;
    maximumEntities: number;
  };
}) {
  const isProduction =
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production";
  if (
    isProduction &&
    options.gatewayBaseUrl !== OFFICIAL_V4_SUBGRAPH_GATEWAY_BASE_URL
  ) {
    throw dataPipelineError({
      dependency: "config",
      code: "invalid_config",
      retryable: false,
      countsTowardCircuit: false,
    });
  }
  const config = loadDataPipelineConfig({
    PROGRAMMABLE_UNISWAP_GRAPH_BASE_URL: options.gatewayBaseUrl,
    PROGRAMMABLE_UNISWAP_GRAPH_API_KEY: options.apiKey,
  });
  if (!config.uniswap.apiKey) {
    throw invalidInput("config", "uniswap-config");
  }
  const maximumPages = options.limits?.maximumPages ?? 40;
  const maximumEntities = options.limits?.maximumEntities ?? 10_000;
  if (
    !Number.isSafeInteger(maximumPages) ||
    maximumPages < 1 ||
    maximumPages > 40 ||
    !Number.isSafeInteger(maximumEntities) ||
    maximumEntities < 1 ||
    maximumEntities > 10_000 ||
    maximumEntities > maximumPages * 250
  ) {
    throw invalidInput("uniswap", "pagination-limits");
  }
  const endpoint = `${config.uniswap.gatewayBaseUrl}/api/subgraphs/id/${OFFICIAL_V4_SUBGRAPH_ID}`;
  const circuit =
    options.circuit ?? new CircuitBreaker({ dependency: "uniswap" });
  const request = (body: unknown) =>
    boundedJsonRequest<unknown>({
      dependency: "uniswap",
      endpoint,
      timeoutMs: config.uniswap.timeoutMs,
      maximumBodyBytes: config.uniswap.maximumBodyBytes,
      fetcher: options.fetcher,
      headers: { authorization: `Bearer ${config.uniswap.apiKey!}` },
      body,
    });

  async function execute<T>(
    operation: () => Promise<{ data: T; provenance: Meta }>,
  ): Promise<AnalyticsResult<T>> {
    try {
      const result = await circuit.execute(operation);
      return {
        status: "ready",
        data: result.data,
        provenance: result.provenance,
      };
    } catch (error) {
      return pending(error);
    }
  }

  async function paginate<T>(input: {
    block: ReturnType<typeof canonicalBlock>;
    query: string;
    entityKey: "swaps" | "poolHourDatas" | "poolDayDatas";
    windows: Iterable<{
      variables: Record<string, unknown>;
      parse: (value: unknown) => T;
    }>;
    sort?: (left: T, right: T) => number;
  }) {
    return execute(async () => {
      const collected: T[] = [];
      let provenance: Meta | undefined;
      let pagesConsumed = 0;
      for (const window of input.windows) {
        let cursor = "";
        while (true) {
          if (pagesConsumed >= maximumPages) {
            throw dataPipelineError({
              dependency: "uniswap",
              code: "response_oversize",
              retryable: true,
              countsTowardCircuit: true,
            });
          }
          pagesConsumed += 1;
          const response = await request({
            query: input.query,
            variables: { ...window.variables, cursor },
          });
          const parsed = responseData(response, input.entityKey);
          const currentMeta = parseMeta(parsed.meta, input.block);
          if (
            provenance !== undefined &&
            (provenance.blockNumber !== currentMeta.blockNumber ||
              provenance.blockHash !== currentMeta.blockHash)
          ) {
            throw validationError("uniswap", "page-metadata");
          }
          provenance = currentMeta;
          if (!Array.isArray(parsed.entity) || parsed.entity.length > 250) {
            throw validationError("uniswap", "page");
          }
          let previousId = cursor;
          for (const entity of parsed.entity) {
            const item = window.parse(entity);
            const itemId =
              isRecord(entity) && typeof entity.id === "string"
                ? entity.id
                : "";
            if (itemId <= previousId) {
              throw validationError("uniswap", "page-order");
            }
            previousId = itemId;
            collected.push(item);
            if (collected.length > maximumEntities) {
              throw dataPipelineError({
                dependency: "uniswap",
                code: "response_oversize",
                retryable: true,
                countsTowardCircuit: true,
              });
            }
          }
          if (parsed.entity.length < 250) break;
          cursor = previousId;
          if (collected.length >= maximumEntities) {
            throw dataPipelineError({
              dependency: "uniswap",
              code: "response_oversize",
              retryable: true,
              countsTowardCircuit: true,
            });
          }
        }
      }
      if (!provenance) throw validationError("uniswap", "page-metadata");
      if (input.sort) collected.sort(input.sort);
      return { data: collected, provenance };
    });
  }

  return Object.freeze({
    async readPoolSnapshot(input: {
      poolKey: VerifiedPoolKey;
      block: { number: string; hash: string };
    }): Promise<AnalyticsResult<PoolSnapshot>> {
      const key = canonicalPoolKey(input.poolKey);
      const block = canonicalBlock(input.block);
      return execute(async () => {
        const response = await request({
          query: POOL_QUERY,
          variables: {
            poolId: key.poolId,
            block: block.graphNumber,
          },
        });
        const parsed = responseData(response, "pool");
        const provenance = parseMeta(parsed.meta, block);
        if (parsed.entity === null) {
          throw validationError("uniswap", "pool-missing");
        }
        return {
          data: parsePool(parsed.entity, key),
          provenance,
        };
      });
    },

    async readSwaps(input: {
      poolKey: VerifiedPoolKey;
      block: { number: string; hash: string };
      from: string;
      toExclusive: string;
    }): Promise<AnalyticsResult<SwapAnalytics[]>> {
      const key = canonicalPoolKey(input.poolKey);
      const block = canonicalBlock(input.block);
      const window = windowBigInt(input.from, input.toExclusive);
      function* windows() {
        for (const split of splitBigIntWindow(
          window,
          UNISWAP_SWAP_WINDOW_SECONDS,
        )) {
          yield {
            variables: {
              poolId: key.poolId,
              blockHash: block.hash,
              from: split.from,
              toExclusive: split.toExclusive,
            },
            parse: (value: unknown) =>
              parseSwap(value, key, split.fromBigInt, split.toBigInt),
          };
        }
      }
      return paginate({
        block,
        query: SWAP_QUERY,
        entityKey: "swaps",
        windows: windows(),
        sort: (left, right) => {
          const blockOrder =
            BigInt(left.blockNumber) - BigInt(right.blockNumber);
          if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
          const transactionOrder =
            left.transactionHash < right.transactionHash
              ? -1
              : left.transactionHash > right.transactionHash
                ? 1
                : 0;
          if (transactionOrder !== 0) return transactionOrder;
          const logOrder = BigInt(left.logIndex) - BigInt(right.logIndex);
          return logOrder < 0n ? -1 : logOrder > 0n ? 1 : 0;
        },
      });
    },

    async readHourSeries(input: {
      poolKey: VerifiedPoolKey;
      block: { number: string; hash: string };
      from: number;
      toExclusive: number;
    }): Promise<AnalyticsResult<CandleAnalytics[]>> {
      const key = canonicalPoolKey(input.poolKey);
      const block = canonicalBlock(input.block);
      const window = windowInt(input.from, input.toExclusive);
      function* windows() {
        for (const split of splitIntWindow(
          window,
          UNISWAP_HOUR_WINDOW_SECONDS,
        )) {
          yield {
            variables: {
              poolId: key.poolId,
              blockHash: block.hash,
              ...split,
            },
            parse: (value: unknown) =>
              parseCandle(
                value,
                key,
                "periodStartUnix",
                split.from,
                split.toExclusive,
              ),
          };
        }
      }
      return paginate({
        block,
        query: HOUR_QUERY,
        entityKey: "poolHourDatas",
        windows: windows(),
        sort: (left, right) => {
          if (left.periodStart !== right.periodStart) {
            return left.periodStart - right.periodStart;
          }
          return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        },
      });
    },

    async readDaySeries(input: {
      poolKey: VerifiedPoolKey;
      block: { number: string; hash: string };
      from: number;
      toExclusive: number;
    }): Promise<AnalyticsResult<CandleAnalytics[]>> {
      const key = canonicalPoolKey(input.poolKey);
      const block = canonicalBlock(input.block);
      const window = windowInt(input.from, input.toExclusive);
      function* windows() {
        for (const split of splitIntWindow(
          window,
          UNISWAP_DAY_WINDOW_SECONDS,
        )) {
          yield {
            variables: {
              poolId: key.poolId,
              blockHash: block.hash,
              ...split,
            },
            parse: (value: unknown) =>
              parseCandle(value, key, "date", split.from, split.toExclusive),
          };
        }
      }
      return paginate({
        block,
        query: DAY_QUERY,
        entityKey: "poolDayDatas",
        windows: windows(),
        sort: (left, right) => {
          if (left.periodStart !== right.periodStart) {
            return left.periodStart - right.periodStart;
          }
          return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        },
      });
    },

    circuitSnapshot: () => circuit.snapshot(),
  });
}
