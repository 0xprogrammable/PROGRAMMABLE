export const PROGRAMMABLE_MARKET_DATA_SCHEMA_VERSION =
  "programmable.market-data.v1" as const;

export const PROGRAMMABLE_MARKET_CHART_SCHEMA_VERSION =
  "programmable.market-chart.v1" as const;

export const PROGRAMMABLE_MARKET_CHART_ERROR_SCHEMA_VERSION =
  "programmable.market-chart-error.v1" as const;

export const MARKET_DATA_CURRENT_MAX_AGE_MS = 5 * 60 * 1_000;

// A public current FDV needs enough exact-pool depth to make a single dust
// trade an insufficient price signal. This is deliberately conservative: a
// launch remains discoverable when it is below the threshold, but its USD FDV
// is unavailable instead of being ranked from an unsafe observation.
export const MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD =
  "10000000000000000000000" as const;
export const MARKET_DATA_MAXIMUM_RAW_INDEXED_PRICE_DEVIATION_BPS = 1_000 as const;
export const MARKET_DATA_USD_PRICE_SOURCE =
  "bitquery-token-price-index-v1" as const;

export type MarketDataIdentityV1 = Readonly<{
  chainId: "1";
  tokenAddress: `0x${string}`;
  poolId: `0x${string}`;
  protocol: "uniswap_v4";
}>;

export type MarketDataFreshnessV1 = "current" | "stale";

export type MarketValuationV1 =
  | Readonly<{
      status: "available";
      metric: "market-cap" | "fdv";
      supplyBasis: "circulating" | "total";
      valueUsdWad: string;
      fdvUsdWad?: string;
      marketCapUsdWad?: string;
      totalSupply?: string;
      circulatingSupply?: string;
      maxSupply?: string;
      asOfTime: string;
      freshness: MarketDataFreshnessV1;
    }>
  | Readonly<{
      status: "unavailable";
      reason:
        | "waiting-for-first-trade"
        | "price-unavailable"
        | "supply-unavailable"
        | "source-unavailable"
        | "inconsistent-market-data";
    }>;

export type MarketTradeV1 = Readonly<{
  transactionHash: `0x${string}`;
  transactionIndex?: number;
  logIndex: number;
  blockNumber: string;
  time: string;
  tokenSide: "buy" | "sell";
  tokenAmount?: string;
  amountUsdWad?: string;
  priceUsdWad?: string;
  priceUsdAsOfTime?: string;
  priceUsdSource?: typeof MARKET_DATA_USD_PRICE_SOURCE;
  rawPriceUsdWad?: string;
  priceQuoteWad?: string;
  quoteAddress?: `0x${string}`;
  quoteSymbol?: string;
}>;

export type MarketLiquidityV1 = Readonly<{
  asOfTime: string;
  asOfBlock: string;
  valueUsdWad: string;
  freshness: MarketDataFreshnessV1;
}>;

export type MarketPoolDataV1 = Readonly<{
  identity: MarketDataIdentityV1;
  source: "bitquery";
  status:
    | "current"
    | "stale"
    | "waiting-for-first-trade"
    | "unavailable";
  quality: "complete" | "partial" | "unavailable";
  asOfTime?: string;
  latestTrade?: MarketTradeV1;
  liquidity?: MarketLiquidityV1;
  volume24hUsdWad?: string;
  tradeCount24h?: number;
  valuation: MarketValuationV1;
}>;

export type TokenMarketDataV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_MARKET_DATA_SCHEMA_VERSION;
  source: "bitquery";
  generatedAt: string;
  status:
    | "current"
    | "partial"
    | "stale"
    | "waiting-for-first-trade"
    | "unavailable";
  primaryPoolId: `0x${string}` | null;
  pools: readonly MarketPoolDataV1[];
}>;

export type MarketChartPointV1 = Readonly<{
  blockNumber: string;
  time: string;
  bucketStart: string;
  bucketEnd: string;
  observedAt: string;
  valueSemantics: "period-median";
  priceUsd?: string;
  priceQuote?: string;
  quoteSymbol?: string;
  ohlcUsd?: MarketOhlcV1;
  ohlcQuote?: MarketOhlcV1;
  volumeUsdWad?: string;
  tradeCount: number;
}>;

export type MarketOhlcV1 = Readonly<{
  open: string;
  high: string;
  low: string;
  close: string;
}>;

export type MarketChartV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_MARKET_CHART_SCHEMA_VERSION;
  source: "bitquery";
  readStatus: "live" | "cache-fallback";
  status:
    | "ready"
    | "insufficient-history"
    | "partial"
    | "waiting-for-first-trade"
    | "unavailable";
  generatedAt: string;
  identity: MarketDataIdentityV1;
  range: "1h" | "1d" | "1w" | "all";
  points: readonly MarketChartPointV1[];
  swapCount: number;
  volumeUsdWad?: string;
  valuation: MarketValuationV1;
  asOfTime?: string;
  truncated: boolean;
}>;

export type MarketChartErrorV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_MARKET_CHART_ERROR_SCHEMA_VERSION;
  source: "bitquery";
  status: "unavailable";
  generatedAt: string;
  address: `0x${string}`;
  range: MarketChartV1["range"];
  reason: "identity-unavailable" | "market-data-unavailable";
  error: string;
}>;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const TRANSACTION_HASH = /^0x[0-9a-f]{64}$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;

export function isMarketDataIdentityV1(
  value: unknown,
): value is MarketDataIdentityV1 {
  if (!isRecord(value)) return false;
  return value.chainId === "1" &&
    typeof value.tokenAddress === "string" &&
    ADDRESS.test(value.tokenAddress) &&
    value.tokenAddress === value.tokenAddress.toLowerCase() &&
    typeof value.poolId === "string" &&
    BYTES32.test(value.poolId) &&
    value.poolId === value.poolId.toLowerCase() &&
    value.protocol === "uniswap_v4";
}

export function isMarketValuationV1(
  value: unknown,
): value is MarketValuationV1 {
  if (!isRecord(value)) return false;
  if (value.status === "unavailable") {
    return [
      "waiting-for-first-trade",
      "price-unavailable",
      "supply-unavailable",
      "source-unavailable",
      "inconsistent-market-data",
    ].includes(String(value.reason));
  }
  if (
    value.status !== "available" ||
    !["market-cap", "fdv"].includes(String(value.metric)) ||
    !["circulating", "total"].includes(String(value.supplyBasis)) ||
    !positiveInteger(value.valueUsdWad) ||
    !optionalPositiveInteger(value.fdvUsdWad) ||
    !optionalPositiveInteger(value.marketCapUsdWad) ||
    !optionalPositiveDecimal(value.totalSupply) ||
    !optionalPositiveDecimal(value.circulatingSupply) ||
    !optionalPositiveDecimal(value.maxSupply) ||
    !validIsoTime(value.asOfTime) ||
    !["current", "stale"].includes(String(value.freshness))
  ) {
    return false;
  }
  if (value.metric === "market-cap") {
    return value.supplyBasis === "circulating" &&
      positiveInteger(value.marketCapUsdWad) &&
      positiveDecimal(value.circulatingSupply);
  }
  return value.supplyBasis === "total" &&
    positiveInteger(value.fdvUsdWad) &&
    positiveDecimal(value.totalSupply);
}

export function isTokenMarketDataV1(
  value: unknown,
): value is TokenMarketDataV1 {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== PROGRAMMABLE_MARKET_DATA_SCHEMA_VERSION ||
    value.source !== "bitquery" ||
    !validIsoTime(value.generatedAt) ||
    ![
      "current",
      "partial",
      "stale",
      "waiting-for-first-trade",
      "unavailable",
    ].includes(String(value.status)) ||
    !Array.isArray(value.pools) ||
    (value.primaryPoolId !== null &&
      (typeof value.primaryPoolId !== "string" ||
        !BYTES32.test(value.primaryPoolId)))
  ) {
    return false;
  }
  const pools = value.pools as unknown[];
  if (!pools.every(isMarketPoolDataV1)) return false;
  const poolIds = new Set(
    pools.map((pool) => (pool as MarketPoolDataV1).identity.poolId),
  );
  return poolIds.size === pools.length &&
    (value.primaryPoolId === null || poolIds.has(value.primaryPoolId as `0x${string}`));
}

export function isMarketChartV1(value: unknown): value is MarketChartV1 {
  if (!isRecord(value)) return false;
  if (
    value.schemaVersion !== PROGRAMMABLE_MARKET_CHART_SCHEMA_VERSION ||
    value.source !== "bitquery" ||
    !["live", "cache-fallback"].includes(String(value.readStatus)) ||
    ![
      "ready",
      "insufficient-history",
      "partial",
      "waiting-for-first-trade",
      "unavailable",
    ].includes(String(value.status)) ||
    !validIsoTime(value.generatedAt) ||
    !isMarketDataIdentityV1(value.identity) ||
    !["1h", "1d", "1w", "all"].includes(String(value.range)) ||
    !Array.isArray(value.points) ||
    !Number.isSafeInteger(value.swapCount) ||
    Number(value.swapCount) < 0 ||
    typeof value.truncated !== "boolean" ||
    !optionalPositiveInteger(value.volumeUsdWad) ||
    !isMarketValuationV1(value.valuation) ||
    (value.asOfTime !== undefined && !validIsoTime(value.asOfTime))
  ) {
    return false;
  }
  const points = value.points as unknown[];
  if (!points.every(isMarketChartPointV1)) return false;
  const typedPoints = points as MarketChartPointV1[];
  let previousBlock: bigint | null = null;
  let previousTime = Number.NEGATIVE_INFINITY;
  let previousBucketEnd = Number.NEGATIVE_INFINITY;
  for (const point of typedPoints) {
    const block = BigInt(point.blockNumber);
    const time = Date.parse(point.time);
    const bucketStart = Date.parse(point.bucketStart);
    if (
      (previousBlock !== null && block <= previousBlock) ||
      time < previousTime ||
      bucketStart < previousBucketEnd
    ) return false;
    previousBlock = block;
    previousTime = time;
    previousBucketEnd = Date.parse(point.bucketEnd);
  }
  const observedTrades = typedPoints.reduce(
    (total, point) => total + point.tradeCount,
    0,
  );
  if (observedTrades !== value.swapCount) return false;
  if (value.volumeUsdWad !== undefined) {
    if (typedPoints.some((point) => point.volumeUsdWad === undefined)) {
      return false;
    }
    const pointVolume = typedPoints.reduce(
      (total, point) => total + BigInt(point.volumeUsdWad as string),
      0n,
    );
    if (pointVolume.toString() !== value.volumeUsdWad) return false;
  }
  if (typedPoints.length === 0) {
    if (
      value.swapCount !== 0 ||
      value.volumeUsdWad !== undefined ||
      value.asOfTime !== undefined
    ) return false;
  } else if (value.asOfTime !== typedPoints.at(-1)?.observedAt) {
    return false;
  }
  if (value.status === "ready") {
    return typedPoints.length >= 2 && value.truncated === false;
  }
  if (value.status === "insufficient-history") {
    return typedPoints.length === 1 && value.truncated === false;
  }
  if (value.status === "partial") return typedPoints.length > 0;
  return typedPoints.length === 0;
}

export function marketDataStatusLabel(
  value: TokenMarketDataV1 | undefined,
):
  | "Waiting for first trade"
  | "Last verified"
  | "Limited market data"
  | "Unavailable"
  | undefined {
  if (!value || value.status === "unavailable") return "Unavailable";
  if (value.status === "waiting-for-first-trade") {
    return "Waiting for first trade";
  }
  if (value.status === "stale") return "Last verified";
  const primary = value.pools.find(
    (pool) => pool.identity.poolId === value.primaryPoolId,
  );
  if (primary?.status === "waiting-for-first-trade") {
    return "Waiting for first trade";
  }
  if (primary?.status === "stale") return "Last verified";
  if (!primary || primary.status === "unavailable") return "Unavailable";
  if (
    primary.valuation.status === "available" &&
    primary.valuation.freshness === "stale"
  ) return "Last verified";
  if (value.status === "partial" || primary.quality === "partial") {
    return "Limited market data";
  }
  return undefined;
}

export function selectPrimaryMarketPoolV1(
  pools: readonly MarketPoolDataV1[],
): MarketPoolDataV1 | null {
  const ranked = [...pools].sort((first, second) => {
    const statusDifference = marketPoolRank(first) - marketPoolRank(second);
    if (statusDifference !== 0) return statusDifference;
    const firstLiquidity = first.liquidity?.freshness === "current"
      ? positiveBigInt(first.liquidity.valueUsdWad) ?? 0n
      : 0n;
    const secondLiquidity = second.liquidity?.freshness === "current"
      ? positiveBigInt(second.liquidity.valueUsdWad) ?? 0n
      : 0n;
    if (firstLiquidity !== secondLiquidity) {
      return firstLiquidity > secondLiquidity ? -1 : 1;
    }
    const firstTime = Date.parse(first.asOfTime ?? "");
    const secondTime = Date.parse(second.asOfTime ?? "");
    if (firstTime !== secondTime) return secondTime - firstTime;
    return first.identity.poolId.localeCompare(second.identity.poolId);
  });
  return ranked.find((pool) => pool.status !== "unavailable") ?? ranked[0] ?? null;
}

function marketPoolRank(value: MarketPoolDataV1): number {
  return value.status === "current"
    ? 0
    : value.status === "stale"
      ? 1
      : value.status === "waiting-for-first-trade"
        ? 2
        : 3;
}

function isMarketPoolDataV1(value: unknown): value is MarketPoolDataV1 {
  if (!isRecord(value)) return false;
  if (
    !isMarketDataIdentityV1(value.identity) ||
    value.source !== "bitquery" ||
    !["current", "stale", "waiting-for-first-trade", "unavailable"].includes(
      String(value.status),
    ) ||
    !["complete", "partial", "unavailable"].includes(String(value.quality)) ||
    (value.asOfTime !== undefined && !validIsoTime(value.asOfTime)) ||
    !optionalPositiveInteger(value.volume24hUsdWad) ||
    (value.tradeCount24h !== undefined &&
      (!Number.isSafeInteger(value.tradeCount24h) ||
        Number(value.tradeCount24h) < 0)) ||
    !isMarketValuationV1(value.valuation)
  ) return false;
  if (value.latestTrade !== undefined && !isMarketTradeV1(value.latestTrade)) {
    return false;
  }
  if (value.liquidity !== undefined && !isMarketLiquidityV1(value.liquidity)) {
    return false;
  }
  return true;
}

function isMarketTradeV1(value: unknown): value is MarketTradeV1 {
  if (!isRecord(value)) return false;
  const hasIndexedUsdPrice = value.priceUsdWad !== undefined ||
    value.priceUsdAsOfTime !== undefined || value.priceUsdSource !== undefined;
  return typeof value.transactionHash === "string" &&
    TRANSACTION_HASH.test(value.transactionHash) &&
    (value.transactionIndex === undefined ||
      (Number.isSafeInteger(value.transactionIndex) &&
        Number(value.transactionIndex) >= 0)) &&
    Number.isSafeInteger(value.logIndex) &&
    Number(value.logIndex) >= 0 &&
    CANONICAL_UNSIGNED_INTEGER.test(String(value.blockNumber)) &&
    validIsoTime(value.time) &&
    ["buy", "sell"].includes(String(value.tokenSide)) &&
    optionalPositiveDecimal(value.tokenAmount) &&
    optionalPositiveInteger(value.amountUsdWad) &&
    optionalPositiveInteger(value.priceUsdWad) &&
    (value.priceUsdAsOfTime === undefined || validIsoTime(value.priceUsdAsOfTime)) &&
    (value.priceUsdSource === undefined ||
      value.priceUsdSource === MARKET_DATA_USD_PRICE_SOURCE) &&
    optionalPositiveInteger(value.rawPriceUsdWad) &&
    (!hasIndexedUsdPrice ||
      (positiveInteger(value.priceUsdWad) &&
        validIsoTime(value.priceUsdAsOfTime) &&
        value.priceUsdSource === MARKET_DATA_USD_PRICE_SOURCE)) &&
    (value.amountUsdWad === undefined || hasIndexedUsdPrice) &&
    optionalPositiveInteger(value.priceQuoteWad) &&
    (value.quoteAddress === undefined ||
      (typeof value.quoteAddress === "string" && ADDRESS.test(value.quoteAddress))) &&
    (value.quoteSymbol === undefined ||
      (typeof value.quoteSymbol === "string" && value.quoteSymbol.trim() !== ""));
}

function isMarketLiquidityV1(value: unknown): value is MarketLiquidityV1 {
  return isRecord(value) &&
    validIsoTime(value.asOfTime) &&
    CANONICAL_UNSIGNED_INTEGER.test(String(value.asOfBlock)) &&
    positiveInteger(value.valueUsdWad) &&
    ["current", "stale"].includes(String(value.freshness));
}

function isMarketChartPointV1(value: unknown): value is MarketChartPointV1 {
  if (!isRecord(value)) return false;
  if (
    value.valueSemantics !== "period-median" ||
    !validIsoTime(value.bucketStart) ||
    !validIsoTime(value.bucketEnd) ||
    !validIsoTime(value.observedAt) ||
    value.time !== value.bucketEnd ||
    Date.parse(value.bucketStart) >= Date.parse(value.bucketEnd) ||
    Date.parse(value.observedAt) < Date.parse(value.bucketStart) ||
    Date.parse(value.observedAt) > Date.parse(value.bucketEnd)
  ) return false;
  return (
    CANONICAL_UNSIGNED_INTEGER.test(String(value.blockNumber)) &&
    validIsoTime(value.time) &&
    optionalPositiveDecimal(value.priceUsd) &&
    optionalPositiveDecimal(value.priceQuote) &&
    (positiveDecimal(value.priceUsd) || positiveDecimal(value.priceQuote)) &&
    (value.ohlcUsd === undefined || isMarketOhlcV1(value.ohlcUsd)) &&
    (value.ohlcQuote === undefined || isMarketOhlcV1(value.ohlcQuote)) &&
    (value.ohlcUsd === undefined || value.priceUsd === value.ohlcUsd.close) &&
    (value.ohlcQuote === undefined ||
      value.priceQuote === value.ohlcQuote.close) &&
    optionalPositiveInteger(value.volumeUsdWad) &&
    Number.isSafeInteger(value.tradeCount) &&
    Number(value.tradeCount) > 0 &&
    (value.quoteSymbol === undefined ||
      (typeof value.quoteSymbol === "string" && value.quoteSymbol.trim() !== ""))
  );
}

function isMarketOhlcV1(value: unknown): value is MarketOhlcV1 {
  if (!isRecord(value)) return false;
  if (
    !positiveDecimal(value.open) ||
    !positiveDecimal(value.high) ||
    !positiveDecimal(value.low) ||
    !positiveDecimal(value.close)
  ) return false;
  const open = decimalParts(value.open);
  const high = decimalParts(value.high);
  const low = decimalParts(value.low);
  const close = decimalParts(value.close);
  return compareDecimals(high, open) >= 0 &&
    compareDecimals(high, close) >= 0 &&
    compareDecimals(open, low) >= 0 &&
    compareDecimals(close, low) >= 0;
}

function decimalParts(value: string): Readonly<{
  coefficient: bigint;
  scale: bigint;
}> {
  const [whole, fraction = ""] = value.split(".");
  return {
    coefficient: BigInt(`${whole}${fraction}`),
    scale: 10n ** BigInt(fraction.length),
  };
}

function compareDecimals(first: ReturnType<typeof decimalParts>, second: ReturnType<typeof decimalParts>) {
  const difference = first.coefficient * second.scale -
    second.coefficient * first.scale;
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveBigInt(value: unknown): bigint | null {
  return positiveInteger(value) ? BigInt(value) : null;
}

function positiveInteger(value: unknown): value is string {
  return typeof value === "string" &&
    CANONICAL_UNSIGNED_INTEGER.test(value) &&
    BigInt(value) > 0n;
}

function optionalPositiveInteger(value: unknown): boolean {
  return value === undefined || positiveInteger(value);
}

function positiveDecimal(value: unknown): value is string {
  return typeof value === "string" &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value) &&
    !/^0(?:\.0+)?$/u.test(value);
}

function optionalPositiveDecimal(value: unknown): boolean {
  return value === undefined || positiveDecimal(value);
}

function validIsoTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value) &&
    Number.isFinite(Date.parse(value));
}
