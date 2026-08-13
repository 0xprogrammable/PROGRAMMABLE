import type {
  CanonicalTokenExploreEntry,
  CustomProjectExploreEntry,
  ExploreEntry,
  LauncherToken,
} from "./tokens";
import type { OfficialV4LiquidityEvidenceV1 } from
  "./onchain/uniswap-v4-subgraph";
import {
  marketCapNativeWadFromSqrtPriceX96,
  nativePriceWadFromSqrtPriceX96,
} from "./onchain/math";
import { usdValueFromWei } from "./onchain/usd";
import {
  MARKET_DATA_CURRENT_MAX_AGE_MS,
  MARKET_DATA_MAXIMUM_RAW_INDEXED_PRICE_DEVIATION_BPS,
  MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD,
  MARKET_DATA_USD_PRICE_SOURCE,
  type MarketPoolDataV1,
  type TokenMarketDataV1,
} from "./market-data/market-data-v1";

export const EXPLORE_DATA_QUALITY_SCHEMA_VERSION =
  "programmable.explore-data-quality.v1" as const;
export const EXPLORE_VALUATION_MAX_LAG_BLOCKS = 64n;
export const EXPLORE_MAXIMUM_STALE_VALUATION_AGE_MS =
  24 * 60 * 60 * 1_000;

const UINT_256_MAX = (1n << 256n) - 1n;
const WAD = 10n ** 18n;
const MAXIMUM_MARKET_FUTURE_SKEW_MS = 60_000;
const NATIVE_CURRENCY_ADDRESS =
  "0x0000000000000000000000000000000000000000";

export function isCanonicalClassicNativeTokenEntry(
  entry: ExploreEntry,
): entry is CanonicalTokenExploreEntry {
  if (entry.exploreKind !== "token" || entry.launchModel !== "classic") {
    return false;
  }
  if (entry.liquidityPath === "meme") {
    return entry.launchStampProvenance === undefined;
  }
  const stamp = entry.launchStampProvenance;
  return entry.liquidityPath === "programmable-v4" &&
    stamp?.kind === "classic" &&
    stamp.chainId === 1 &&
    stamp.poolId.toLowerCase() === entry.poolId.toLowerCase() &&
    stamp.poolKey.currency0.toLowerCase() === NATIVE_CURRENCY_ADDRESS &&
    stamp.poolKey.currency1.toLowerCase() === entry.tokenAddress.toLowerCase() &&
    stamp.poolKey.hooks.toLowerCase() === entry.hookAddress.toLowerCase();
}

export type ExploreValuation =
  | Readonly<{
      status: "available";
      metric: "market-cap" | "fdv";
      supplyBasis: "circulating" | "total";
      currency: "usd" | "eth" | "quote";
      valueWad: string;
      quoteSymbol?: string;
      freshness: "current" | "stale" | "unknown";
      source?: "bitquery" | "stateview-chainlink";
      asOfTime?: string;
      asOfBlock?: string;
      asOfBlockHash?: `0x${string}`;
      lagBlocks?: string;
      priceEvidence?: NonNullable<LauncherToken["liveMarketPriceEvidence"]>;
    }>
  | Readonly<{
      status: "unavailable";
      reason:
        | "no-market"
        | "supply-unavailable"
        | "liquidity-unavailable"
        | "price-unavailable"
        | "inconsistent-snapshot"
        | "waiting-for-first-trade"
        | "source-unavailable";
    }>;

export type ValuedExploreEntry<T extends ExploreEntry = ExploreEntry> =
  T & Readonly<{
    valuation: ExploreValuation;
    marketData?: TokenMarketDataV1;
    liquidityEvidence?: OfficialV4LiquidityEvidenceV1;
  }>;

const LEGACY_MARKET_CAP_FIELDS = [
  "marketCapEth",
  "marketCapEthWei",
  "indexedMarketCapEth",
  "indexedMarketCapEthWei",
  "indexedMarketCapUsdWad",
  "marketCapQuote",
  "marketCapQuoteWad",
] as const;

const LEGACY_EXTERNAL_MARKET_FIELDS = [
  "tokenPriceEth",
  "tokenPriceEthWei",
  "tokenPriceUsdWad",
  "tokenPriceQuote",
  "tokenPriceQuoteWad",
  "grossVolumeEth",
  "grossVolumeWei",
  "grossVolumeQuote",
  "grossVolumeQuoteRaw",
  "swapCount",
  "uniswapV4Pool",
] as const;

type LegacyMarketCapField = typeof LEGACY_MARKET_CAP_FIELDS[number];

export type PublicCanonicalExploreEntry =
  Omit<
    ValuedExploreEntry<CanonicalTokenExploreEntry>,
    LegacyMarketCapField
  > & Readonly<{ fdvUsdWad?: string }>;

export type PublicValuedExploreEntry =
  | PublicCanonicalExploreEntry
  | ValuedExploreEntry<CustomProjectExploreEntry>;

export type ExploreDataQuality = Readonly<{
  schemaVersion: typeof EXPLORE_DATA_QUALITY_SCHEMA_VERSION;
  status: "complete" | "partial" | "stale";
  generatedAt: string;
  launchIdentity: Readonly<{
    status: "current" | "last-known-good" | "partial";
    canonical: ExploreSourceStatus;
    custom: ExploreSourceStatus;
    asOfBlock: string | null;
    referenceBlock: string | null;
    lagBlocks: string | null;
    ageMs: number | null;
  }>;
  valuation: Readonly<{
    status: "current" | "partial" | "stale" | "unavailable";
    metric: "market-cap" | "fdv" | "mixed";
    available: number;
    unavailable: number;
    stale: number;
    unknown: number;
    asOfBlock: string | null;
    asOfTime: string | null;
  }>;
}>;

export type ExploreSourceStatus =
  | "current"
  | "last-known-good"
  | "unavailable";

type ValuationContext = Readonly<{
  referenceBlock?: string | null;
  forceStale?: boolean;
}>;

type BitqueryValuationContext = Readonly<{
  maximumValuationAgeMs?: number;
  now?: Date;
}>;

function uint256(value: unknown): bigint | null {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/u.test(value) ||
    value.length > 78
  ) {
    return null;
  }
  try {
    const parsed = BigInt(value);
    return parsed <= UINT_256_MAX ? parsed : null;
  } catch {
    return null;
  }
}

function positiveUint256(value: unknown): bigint | null {
  const parsed = uint256(value);
  return parsed !== null && parsed > 0n ? parsed : null;
}

function decimalToWad(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (!match) return null;
  try {
    const whole = BigInt(match[1]);
    const fraction = (match[2] ?? "").slice(0, 18).padEnd(18, "0");
    const result = whole * WAD + BigInt(fraction || "0");
    return result > 0n && result <= UINT_256_MAX ? result : null;
  } catch {
    return null;
  }
}

function blockNumber(value: unknown): bigint | null {
  return positiveUint256(value);
}

function unixTimestampMatchesIso(value: unknown, iso: unknown): boolean {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9]\d*)$/u.test(value) ||
    typeof iso !== "string"
  ) return false;
  try {
    const seconds = BigInt(value);
    return seconds <= 8_640_000_000_000n &&
      new Date(Number(seconds) * 1_000).toISOString() === iso;
  } catch {
    return false;
  }
}

function valuationFreshness(
  asOfBlock: string | undefined,
  referenceBlock: string | null | undefined,
  forceStale: boolean,
): Pick<
  Extract<ExploreValuation, { status: "available" }>,
  "freshness" | "asOfBlock" | "lagBlocks"
> | null {
  // A numeric valuation without block provenance cannot be reconciled with
  // the launch/read snapshot. Treat it as unavailable instead of publishing a
  // plausible but unprovable USD value (for example an offchain price API
  // response with no onchain observation block).
  if (!asOfBlock) return null;
  const asOf = blockNumber(asOfBlock);
  const reference = blockNumber(referenceBlock);
  if (asOf === null || (reference !== null && asOf > reference)) return null;
  const lag = reference === null ? null : reference - asOf;
  return {
    freshness:
      forceStale || (lag !== null && lag > EXPLORE_VALUATION_MAX_LAG_BLOCKS)
        ? "stale"
        : lag === null
          ? "unknown"
          : "current",
    asOfBlock,
    ...(lag === null ? {} : { lagBlocks: lag.toString() }),
  };
}

function availableValuation(
  token: LauncherToken,
  context: ValuationContext,
): ExploreValuation {
  if (
    positiveUint256(token.totalSupplyRaw) === null ||
    typeof token.tokenDecimals !== "number" ||
    !Number.isInteger(token.tokenDecimals) ||
    token.tokenDecimals < 0 ||
    token.tokenDecimals > 255
  ) {
    return { status: "unavailable", reason: "supply-unavailable" };
  }

  const poolLiquidity =
    positiveUint256(token.activeLiquidity) ??
    positiveUint256(token.uniswapV4Pool?.liquidity);
  if (poolLiquidity === null) {
    return { status: "unavailable", reason: "liquidity-unavailable" };
  }

  const candidates = [
    {
      currency: "usd" as const,
      value: positiveUint256(token.indexedMarketCapUsdWad),
      asOfBlock: token.indexedValuationBlockNumber,
    },
    {
      currency: "usd" as const,
      value: positiveUint256(token.fdvUsdWad),
      asOfBlock: token.indexedValuationBlockNumber,
    },
    {
      currency: "quote" as const,
      value:
        positiveUint256(token.marketCapQuoteWad) ??
        decimalToWad(token.marketCapQuote),
      quoteSymbol: token.quoteAssetSymbol?.trim(),
      asOfBlock: token.indexedValuationBlockNumber,
    },
    {
      currency: "eth" as const,
      value:
        positiveUint256(token.indexedMarketCapEthWei) ??
        positiveUint256(token.marketCapEthWei) ??
        decimalToWad(token.indexedMarketCapEth ?? token.marketCapEth),
      asOfBlock: token.indexedValuationBlockNumber,
    },
  ];

  const candidate = candidates.find(
    (value) =>
      value.value !== null &&
      (value.currency !== "quote" || Boolean(value.quoteSymbol)),
  );
  if (!candidate || candidate.value === null) {
    return { status: "unavailable", reason: "price-unavailable" };
  }
  const freshness = valuationFreshness(
    candidate.asOfBlock,
    context.referenceBlock,
    context.forceStale === true,
  );
  if (freshness === null) {
    return { status: "unavailable", reason: "inconsistent-snapshot" };
  }

  return {
    status: "available",
    metric: "fdv",
    supplyBasis: "total",
    currency: candidate.currency,
    valueWad: candidate.value.toString(),
    ...(candidate.currency === "quote" && candidate.quoteSymbol
      ? { quoteSymbol: candidate.quoteSymbol }
      : {}),
    ...freshness,
  };
}

/**
 * The legacy `marketCap*` fields in the current read model are calculated from
 * total supply. The Website consumer therefore exposes them only as FDV. A
 * circulating market cap remains unavailable until a separately evidenced
 * circulating-supply field exists.
 */
export function exploreValuation(
  entry: ExploreEntry | LauncherToken,
  context: ValuationContext = {},
): ExploreValuation {
  if ("exploreKind" in entry && entry.exploreKind === "custom-project") {
    return entry.markets.length === 0
      ? { status: "unavailable", reason: "no-market" }
      : { status: "unavailable", reason: "supply-unavailable" };
  }
  return availableValuation(entry, context);
}

export function withExploreValuation<T extends ExploreEntry>(
  entry: T,
  context: ValuationContext,
): ValuedExploreEntry<T> {
  return { ...entry, valuation: exploreValuation(entry, context) };
}

export function withBitqueryMarketData<T extends ExploreEntry>(
  entry: T,
  marketData: TokenMarketDataV1,
  context: BitqueryValuationContext = {},
): ValuedExploreEntry<T> {
  const reconciledMarketData = reconcileBitqueryValuations(
    entry,
    marketData,
    context,
  );
  const primary = reconciledMarketData.pools.find(
    (pool) => pool.identity.poolId === reconciledMarketData.primaryPoolId,
  );
  const marketValuation = primary?.valuation;
  const valuation: ExploreValuation =
    marketValuation?.status === "available"
      ? {
          status: "available",
          metric: marketValuation.metric,
          supplyBasis: marketValuation.supplyBasis,
          currency: "usd",
          valueWad: marketValuation.valueUsdWad,
          freshness: marketValuation.freshness,
          source: "bitquery",
          asOfTime: marketValuation.asOfTime,
        }
      : {
          status: "unavailable",
          reason:
            marketValuation?.reason === "waiting-for-first-trade"
              ? "waiting-for-first-trade"
              : marketValuation?.reason === "source-unavailable"
                ? "source-unavailable"
                : marketValuation?.reason === "price-unavailable"
                  ? "price-unavailable"
                  : marketValuation?.reason === "supply-unavailable"
                    ? "supply-unavailable"
                    : "inconsistent-snapshot",
        };
  return { ...entry, valuation, marketData: reconciledMarketData };
}

function matchingCurrentLiquidityEvidence(
  entry: CanonicalTokenExploreEntry,
  evidence: OfficialV4LiquidityEvidenceV1 | undefined,
  price: NonNullable<LauncherToken["liveMarketPriceEvidence"]> | undefined,
): price is NonNullable<LauncherToken["liveMarketPriceEvidence"]> {
  return evidence !== undefined &&
    price !== undefined &&
    isCanonicalClassicNativeTokenEntry(entry) &&
    evidence.source === "official-uniswap-v4-subgraph" &&
    evidence.valueBasis === "official-subgraph-pool-tvl-usd" &&
    evidence.freshness === "current" &&
    evidence.identity.chainId === "1" &&
    evidence.identity.protocol === "uniswap_v4" &&
    evidence.identity.poolId.toLowerCase() === entry.poolId.toLowerCase() &&
    evidence.identity.tokenAddress.toLowerCase() ===
      entry.tokenAddress.toLowerCase() &&
    evidence.identity.quoteAddress.toLowerCase() ===
      price.quoteAddress.toLowerCase() &&
    evidence.identity.quoteAddress.toLowerCase() === NATIVE_CURRENCY_ADDRESS &&
    evidence.reportedPoolBalances.token0.address.toLowerCase() ===
      NATIVE_CURRENCY_ADDRESS &&
    evidence.reportedPoolBalances.token0.decimals === 18 &&
    evidence.reportedPoolBalances.token1.address.toLowerCase() ===
      entry.tokenAddress.toLowerCase() &&
    evidence.reportedPoolBalances.token1.decimals === entry.tokenDecimals &&
    evidence.provenance.referenceHeadBlockNumber === price.blockNumber &&
    evidence.provenance.referenceHeadBlockHash.toLowerCase() ===
      price.blockHash.toLowerCase();
}

function validCurrentPriceEvidence(
  entry: CanonicalTokenExploreEntry,
): NonNullable<LauncherToken["liveMarketPriceEvidence"]> | undefined {
  const price = entry.liveMarketPriceEvidence;
  let recomputedTokenEth: bigint;
  let recomputedFdvEth: bigint;
  let recomputedTokenUsd: bigint;
  let recomputedFdvUsd: bigint;
  let recomputedActiveVirtualToken0: bigint;
  let recomputedActiveVirtualUsd: bigint;
  try {
    const sqrtPriceX96 = BigInt(price?.sqrtPriceX96 ?? "");
    const totalSupplyRaw = BigInt(price?.totalSupplyRaw ?? "");
    const quoteAnswer = BigInt(price?.ethUsdQuote.answer ?? "");
    recomputedTokenEth = nativePriceWadFromSqrtPriceX96(
      sqrtPriceX96,
      price?.tokenDecimals ?? -1,
    );
    recomputedFdvEth = marketCapNativeWadFromSqrtPriceX96(
      totalSupplyRaw,
      sqrtPriceX96,
    );
    const tokenUsd = usdValueFromWei(
      recomputedTokenEth.toString(),
      quoteAnswer,
      price?.ethUsdQuote.decimals ?? -1,
    );
    const fdvUsd = usdValueFromWei(
      recomputedFdvEth.toString(),
      quoteAnswer,
      price?.ethUsdQuote.decimals ?? -1,
    );
    recomputedActiveVirtualToken0 =
      (BigInt(price?.activeLiquidity ?? "") * (1n << 96n)) /
      sqrtPriceX96;
    const activeVirtualUsd = usdValueFromWei(
      (2n * recomputedActiveVirtualToken0).toString(),
      quoteAnswer,
      price?.ethUsdQuote.decimals ?? -1,
    );
    if (
      tokenUsd === undefined ||
      fdvUsd === undefined ||
      activeVirtualUsd === undefined
    ) return undefined;
    recomputedTokenUsd = BigInt(tokenUsd);
    recomputedFdvUsd = BigInt(fdvUsd);
    recomputedActiveVirtualUsd = BigInt(activeVirtualUsd);
  } catch {
    return undefined;
  }
  const blockTime = Date.parse(price?.blockTime ?? "");
  const now = Date.now();
  if (
    !price ||
    price.schemaVersion !==
      "programmable.stateview-chainlink-price-evidence.v1" ||
    price.source !== "uniswap-v4-stateview-chainlink-v1" ||
    price.chainId !== "1" ||
    price.quoteAddress.toLowerCase() !== NATIVE_CURRENCY_ADDRESS ||
    !/^0x[0-9a-f]{40}$/iu.test(price.stateViewAddress) ||
    !/^0x[0-9a-f]{64}$/iu.test(price.stateViewRuntimeCodeHash) ||
    !/^0x[0-9a-f]{64}$/iu.test(price.blockHash) ||
    price.poolId.toLowerCase() !== entry.poolId.toLowerCase() ||
    price.tokenAddress.toLowerCase() !== entry.tokenAddress.toLowerCase() ||
    price.totalSupplyRaw !== entry.totalSupplyRaw ||
    price.tokenDecimals !== entry.tokenDecimals ||
    price.blockNumber !== entry.indexedValuationBlockNumber ||
    price.fdvUsdWad !== entry.fdvUsdWad ||
    price.tokenPriceUsdWad !== entry.tokenPriceUsdWad ||
    positiveUint256(price.sqrtPriceX96) === null ||
    positiveUint256(price.activeLiquidity) === null ||
    positiveUint256(price.activeVirtualToken0Wei) === null ||
    positiveUint256(price.activeVirtualLiquidityUsdWad) === null ||
    price.activeVirtualLiquidityValueBasis !==
      "stateview-active-liquidity-virtual-depth-usd" ||
    positiveUint256(price.tokenPriceEthWei) === null ||
    positiveUint256(price.tokenPriceUsdWad) === null ||
    positiveUint256(price.fdvUsdWad) === null ||
    positiveUint256(price.ethUsdQuote.answer) === null ||
    positiveUint256(price.ethUsdQuote.roundId) === null ||
    !/^0x[0-9a-f]{40}$/iu.test(price.ethUsdQuote.feedAddress) ||
    !Number.isInteger(price.ethUsdQuote.decimals) ||
    price.ethUsdQuote.decimals < 0 ||
    price.ethUsdQuote.decimals > 255 ||
    !unixTimestampMatchesIso(price.blockTimestamp, price.blockTime) ||
    !unixTimestampMatchesIso(
      price.ethUsdQuote.updatedAt,
      price.ethUsdQuote.updatedAtTime,
    ) ||
    recomputedTokenEth.toString() !== price.tokenPriceEthWei ||
    recomputedTokenUsd.toString() !== price.tokenPriceUsdWad ||
    recomputedFdvUsd.toString() !== price.fdvUsdWad ||
    recomputedActiveVirtualToken0.toString() !==
      price.activeVirtualToken0Wei ||
    recomputedActiveVirtualUsd.toString() !==
      price.activeVirtualLiquidityUsdWad ||
    recomputedActiveVirtualUsd <
      BigInt(MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD) ||
    !Number.isFinite(blockTime) ||
    blockTime > now + MAXIMUM_MARKET_FUTURE_SKEW_MS ||
    now - blockTime > MARKET_DATA_CURRENT_MAX_AGE_MS ||
    !Number.isFinite(Date.parse(price.ethUsdQuote.updatedAtTime))
  ) {
    return undefined;
  }
  return price;
}

/**
 * Promotes a current FDV only when an exact StateView/Chainlink price and an
 * independently attributed official-v4 pool TVL observation bind to the same
 * canonical Classic pool and confirmed RPC reference block.
 */
export function withCurrentOnchainValuation<T extends ExploreEntry>(
  entry: ValuedExploreEntry<T>,
  liquidityEvidence?: OfficialV4LiquidityEvidenceV1,
): ValuedExploreEntry<T> {
  if (entry.exploreKind !== "token") return entry;
  const priceEvidence = validCurrentPriceEvidence(entry);
  if (!matchingCurrentLiquidityEvidence(entry, liquidityEvidence, priceEvidence)) {
    return entry;
  }
  return {
    ...entry,
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      valueWad: priceEvidence.fdvUsdWad,
      freshness: "current",
      source: "stateview-chainlink",
      asOfTime: priceEvidence.blockTime,
      asOfBlock: priceEvidence.blockNumber,
      asOfBlockHash: priceEvidence.blockHash,
      lagBlocks: "0",
      priceEvidence,
    },
    liquidityEvidence,
  };
}

function reconcileBitqueryValuations<T extends ExploreEntry>(
  entry: T,
  marketData: TokenMarketDataV1,
  context: BitqueryValuationContext,
): TokenMarketDataV1 {
  // Bitquery owns the market price, but Router/Registry owns the token
  // identity and canonical fixed supply. Its third-party circulating-supply
  // estimate is never promoted to Market cap. A numeric FDV is current only
  // when the exact v4 pool also has a current, positive liquidity snapshot.
  const canonicalSupply = canonicalTotalSupply(entry);
  const pools = marketData.pools.map((pool): MarketPoolDataV1 => {
    const price = positiveUint256(pool.latestTrade?.priceUsdWad);
    const rawPrice = positiveUint256(pool.latestTrade?.rawPriceUsdWad);
    const liquidity = positiveUint256(pool.liquidity?.valueUsdWad);
    if (canonicalSupply === null) {
      return {
        ...pool,
        quality: "partial",
        valuation: { status: "unavailable", reason: "supply-unavailable" },
      };
    }
    if (price === null) {
      return {
        ...pool,
        quality: "partial",
        valuation: { status: "unavailable", reason: "price-unavailable" },
      };
    }
    if (
      pool.latestTrade?.priceUsdSource !== MARKET_DATA_USD_PRICE_SOURCE ||
      !pool.latestTrade.priceUsdAsOfTime ||
      rawPrice === null ||
      !usdPricesWithinConfidence(rawPrice, price)
    ) {
      return {
        ...pool,
        quality: "partial",
        valuation: {
          status: "unavailable",
          reason: "inconsistent-market-data",
        },
      };
    }
    if (
      pool.liquidity &&
      (liquidity === null ||
        liquidity < BigInt(MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD))
    ) {
      return {
        ...pool,
        quality: "partial",
        valuation: {
          status: "unavailable",
          reason: "inconsistent-market-data",
        },
      };
    }
    const supplyWad = decimalToWad(canonicalSupply);
    if (supplyWad === null) {
      return {
        ...pool,
        quality: "partial",
        valuation: { status: "unavailable", reason: "supply-unavailable" },
      };
    }
    const fdv = (price * supplyWad) / WAD;
    if (fdv <= 0n || fdv > UINT_256_MAX) {
      return {
        ...pool,
        quality: "partial",
        valuation: {
          status: "unavailable",
          reason: "inconsistent-market-data",
        },
      };
    }
    const tradeTime = Date.parse(pool.latestTrade?.time ?? "");
    const priceTime = Date.parse(pool.latestTrade.priceUsdAsOfTime);
    const liquidityTime = pool.liquidity
      ? Date.parse(pool.liquidity.asOfTime)
      : null;
    const generatedTime = Date.parse(marketData.generatedAt);
    if (
      !Number.isFinite(tradeTime) ||
      !Number.isFinite(priceTime) ||
      (liquidityTime !== null && !Number.isFinite(liquidityTime)) ||
      !Number.isFinite(generatedTime) ||
      Math.abs(tradeTime - priceTime) > MARKET_DATA_CURRENT_MAX_AGE_MS ||
      tradeTime > generatedTime + MAXIMUM_MARKET_FUTURE_SKEW_MS ||
      priceTime > generatedTime + MAXIMUM_MARKET_FUTURE_SKEW_MS ||
      (liquidityTime !== null &&
        liquidityTime > generatedTime + MAXIMUM_MARKET_FUTURE_SKEW_MS)
    ) {
      return {
        ...pool,
        quality: "partial",
        valuation: {
          status: "unavailable",
          reason: "inconsistent-market-data",
        },
      };
    }
    const evidenceTimes = liquidityTime === null
      ? [tradeTime, priceTime]
      : [tradeTime, priceTime, liquidityTime];
    const asOfTimestamp = Math.min(...evidenceTimes);
    const asOfTime = new Date(asOfTimestamp).toISOString();
    const valuationReferenceTime = context.now?.getTime() ?? generatedTime;
    if (
      context.maximumValuationAgeMs !== undefined &&
      valuationReferenceTime - asOfTimestamp > context.maximumValuationAgeMs
    ) {
      return {
        ...pool,
        quality: "partial",
        valuation: { status: "unavailable", reason: "price-unavailable" },
      };
    }
    const evidenceIsCurrent = pool.liquidity !== undefined &&
      evidenceTimes.every(
      (time) => generatedTime - time <= MARKET_DATA_CURRENT_MAX_AGE_MS,
      );
    const freshness = pool.status === "current" &&
        pool.liquidity?.freshness === "current" &&
        evidenceIsCurrent
      ? "current" as const
      : "stale" as const;
    return {
      ...pool,
      quality: freshness === "current" && pool.quality === "complete"
        ? "complete"
        : "partial",
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        valueUsdWad: fdv.toString(),
        fdvUsdWad: fdv.toString(),
        totalSupply: canonicalSupply,
        asOfTime,
        freshness,
      },
    };
  });
  return { ...marketData, pools };
}

function usdPricesWithinConfidence(rawPrice: bigint, indexedPrice: bigint): boolean {
  if (rawPrice <= 0n || indexedPrice <= 0n) return false;
  const difference = rawPrice > indexedPrice
    ? rawPrice - indexedPrice
    : indexedPrice - rawPrice;
  return difference * 10_000n <=
    indexedPrice * BigInt(MARKET_DATA_MAXIMUM_RAW_INDEXED_PRICE_DEVIATION_BPS);
}

function canonicalTotalSupply(entry: ExploreEntry): string | null {
  if (entry.exploreKind !== "token") return null;
  const raw = positiveUint256(entry.totalSupplyRaw);
  const decimals = entry.tokenDecimals;
  if (
    raw === null ||
    typeof decimals !== "number" ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  ) return null;
  const digits = raw.toString().padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  const whole = digits.slice(0, -decimals);
  const fraction = digits.slice(-decimals).replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Removes legacy total-supply values whose names imply circulating market
 * cap. Public consumers receive the typed FDV valuation and, for USD values,
 * the existing `fdvUsdWad` compatibility field.
 */
export function publicExploreEntryV1(
  entry: ValuedExploreEntry,
): PublicValuedExploreEntry {
  if (entry.exploreKind === "custom-project") return entry;

  const output = { ...entry } as Record<string, unknown>;
  delete output.liveMarketStateEvidence;
  delete output.liveMarketPriceEvidence;
  for (const field of LEGACY_MARKET_CAP_FIELDS) delete output[field];
  for (const field of LEGACY_EXTERNAL_MARKET_FIELDS) delete output[field];
  if (
    entry.valuation.status === "available" &&
    entry.valuation.metric === "fdv" &&
    entry.valuation.currency === "usd" &&
    entry.valuation.freshness === "current" &&
    entry.valuation.source !== "bitquery"
  ) {
    output.fdvUsdWad = entry.valuation.valueWad;
  } else {
    delete output.fdvUsdWad;
  }
  if (
    entry.valuation.status === "available" &&
    entry.valuation.source === "stateview-chainlink" &&
    entry.valuation.priceEvidence
  ) {
    const price = entry.valuation.priceEvidence;
    output.tokenPriceUsdWad = price.tokenPriceUsdWad;
    output.tokenPriceEthWei = price.tokenPriceEthWei;
    output.tokenPriceEth = wadToDecimal(BigInt(price.tokenPriceEthWei));
    output.quoteAssetAddress = price.quoteAddress;
    output.quoteAssetSymbol = "ETH";
  }
  return output as PublicCanonicalExploreEntry;
}

function wadToDecimal(value: bigint): string {
  const raw = value.toString().padStart(19, "0");
  const whole = raw.slice(0, -18);
  const fraction = raw.slice(-18).replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function valuationSortValue(entry: ExploreEntry): bigint | null {
  const value = (entry as Partial<ValuedExploreEntry>).valuation;
  return value?.status === "available" &&
    value.metric === "fdv" &&
    value.currency === "usd" &&
    value.freshness === "current" &&
    value.source !== "bitquery"
    ? positiveUint256(value.valueWad)
    : null;
}

function latestAvailableValuationBlock(
  entries: readonly ValuedExploreEntry[],
): string | null {
  let latest: bigint | null = null;
  for (const entry of entries) {
    const valuation = entry.valuation;
    if (valuation.status !== "available") continue;
    const block = blockNumber(valuation.asOfBlock);
    if (block !== null && (latest === null || block > latest)) latest = block;
  }
  return latest?.toString() ?? null;
}

function latestAvailableValuationTime(
  entries: readonly ValuedExploreEntry[],
): string | null {
  let latest: number | null = null;
  for (const entry of entries) {
    const valuation = entry.valuation;
    if (valuation.status !== "available" || !valuation.asOfTime) continue;
    const parsed = Date.parse(valuation.asOfTime);
    if (Number.isFinite(parsed) && (latest === null || parsed > latest)) {
      latest = parsed;
    }
  }
  return latest === null ? null : new Date(latest).toISOString();
}

export function buildExploreDataQuality(input: Readonly<{
  entries: readonly ValuedExploreEntry[];
  generatedAt?: string;
  canonicalStatus: ExploreSourceStatus;
  customStatus: ExploreSourceStatus;
  identityAsOfBlock: string | null;
  referenceBlock: string | null;
  identityAgeMs?: number | null;
}>): ExploreDataQuality {
  const valuations = input.entries.map((entry) => entry.valuation);
  const available = valuations.filter(
    (value) => value.status === "available",
  );
  const stale = available.filter((value) => value.freshness === "stale");
  const unknown = available.filter((value) => value.freshness === "unknown");
  const unavailable = valuations.length - available.length;
  const incompleteMarketData = input.entries.filter((entry) => {
    const marketData = entry.marketData;
    if (!marketData) return false;
    const primary = marketData.pools.find(
      (pool) => pool.identity.poolId === marketData.primaryPoolId,
    );
    return marketData.status !== "current" || primary?.quality !== "complete";
  }).length;
  const metrics = new Set(available.map((value) => value.metric));
  const valuationStatus =
    available.length === 0
      ? "unavailable" as const
      : stale.length > 0
        ? "stale" as const
        : unavailable > 0 || unknown.length > 0 || incompleteMarketData > 0
          ? "partial" as const
          : "current" as const;
  const identityAsOf = blockNumber(input.identityAsOfBlock);
  const reference = blockNumber(input.referenceBlock);
  const identityLag =
    identityAsOf !== null && reference !== null && reference >= identityAsOf
      ? reference - identityAsOf
      : null;
  const launchIdentityStatus =
    input.canonicalStatus === "unavailable" ||
    input.customStatus === "unavailable"
      ? "partial" as const
      : input.canonicalStatus === "current" &&
          input.customStatus === "current" &&
          (identityLag === null ||
            identityLag <= EXPLORE_VALUATION_MAX_LAG_BLOCKS)
        ? "current" as const
        : "last-known-good" as const;
  const status =
    launchIdentityStatus === "last-known-good" || valuationStatus === "stale"
      ? "stale" as const
      : launchIdentityStatus === "partial" ||
          valuationStatus === "partial" ||
          valuationStatus === "unavailable"
        ? "partial" as const
        : "complete" as const;

  return {
    schemaVersion: EXPLORE_DATA_QUALITY_SCHEMA_VERSION,
    status,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    launchIdentity: {
      status: launchIdentityStatus,
      canonical: input.canonicalStatus,
      custom: input.customStatus,
      asOfBlock: input.identityAsOfBlock,
      referenceBlock: input.referenceBlock,
      lagBlocks: identityLag?.toString() ?? null,
      ageMs: input.identityAgeMs ?? null,
    },
    valuation: {
      status: valuationStatus,
      metric:
        metrics.size > 1
          ? "mixed"
          : metrics.has("market-cap")
            ? "market-cap"
            : "fdv",
      available: available.length,
      unavailable,
      stale: stale.length,
      unknown: unknown.length,
      asOfBlock: latestAvailableValuationBlock(input.entries),
      asOfTime: latestAvailableValuationTime(input.entries),
    },
  };
}

export function isExploreValuation(value: unknown): value is ExploreValuation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.status === "unavailable") {
    return [
      "no-market",
      "supply-unavailable",
      "liquidity-unavailable",
      "price-unavailable",
      "inconsistent-snapshot",
      "waiting-for-first-trade",
      "source-unavailable",
    ].includes(String(candidate.reason));
  }
  return candidate.status === "available" &&
    ["market-cap", "fdv"].includes(String(candidate.metric)) &&
    ["circulating", "total"].includes(String(candidate.supplyBasis)) &&
    (candidate.metric !== "market-cap" ||
      candidate.supplyBasis === "circulating") &&
    (candidate.metric !== "fdv" || candidate.supplyBasis === "total") &&
    ["usd", "eth", "quote"].includes(String(candidate.currency)) &&
    positiveUint256(candidate.valueWad) !== null &&
    ["current", "stale", "unknown"].includes(String(candidate.freshness)) &&
    (candidate.currency !== "quote" ||
      (typeof candidate.quoteSymbol === "string" &&
        candidate.quoteSymbol.trim().length > 0)) &&
    (candidate.source === undefined ||
      candidate.source === "bitquery" ||
      candidate.source === "stateview-chainlink") &&
    (candidate.asOfTime === undefined ||
      (typeof candidate.asOfTime === "string" &&
        Number.isFinite(Date.parse(candidate.asOfTime)))) &&
    (candidate.asOfBlock === undefined ||
      blockNumber(candidate.asOfBlock) !== null) &&
    (candidate.asOfBlockHash === undefined ||
      (typeof candidate.asOfBlockHash === "string" &&
        /^0x[0-9a-f]{64}$/iu.test(candidate.asOfBlockHash))) &&
    (candidate.lagBlocks === undefined || uint256(candidate.lagBlocks) !== null);
}

export function isExploreDataQuality(
  value: unknown,
): value is ExploreDataQuality {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const identity = candidate.launchIdentity;
  const valuation = candidate.valuation;
  if (
    candidate.schemaVersion !== EXPLORE_DATA_QUALITY_SCHEMA_VERSION ||
    !["complete", "partial", "stale"].includes(String(candidate.status)) ||
    typeof candidate.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.generatedAt)) ||
    typeof identity !== "object" ||
    identity === null ||
    typeof valuation !== "object" ||
    valuation === null
  ) {
    return false;
  }
  const identityRecord = identity as Record<string, unknown>;
  const valuationRecord = valuation as Record<string, unknown>;
  return ["current", "last-known-good", "partial"].includes(
    String(identityRecord.status),
  ) &&
    ["current", "last-known-good", "unavailable"].includes(
      String(identityRecord.canonical),
    ) &&
    ["current", "last-known-good", "unavailable"].includes(
      String(identityRecord.custom),
    ) &&
    (identityRecord.asOfBlock === null ||
      blockNumber(identityRecord.asOfBlock) !== null) &&
    (identityRecord.referenceBlock === null ||
      blockNumber(identityRecord.referenceBlock) !== null) &&
    (identityRecord.lagBlocks === null ||
      uint256(identityRecord.lagBlocks) !== null) &&
    (identityRecord.ageMs === null ||
      (typeof identityRecord.ageMs === "number" &&
        Number.isSafeInteger(identityRecord.ageMs) &&
        identityRecord.ageMs >= 0)) &&
    ["current", "partial", "stale", "unavailable"].includes(
      String(valuationRecord.status),
    ) &&
    ["market-cap", "fdv", "mixed"].includes(
      String(valuationRecord.metric),
    ) &&
    ["available", "unavailable", "stale", "unknown"].every(
      (key) =>
        typeof valuationRecord[key] === "number" &&
        Number.isSafeInteger(valuationRecord[key]) &&
        Number(valuationRecord[key]) >= 0,
    ) &&
    (valuationRecord.asOfBlock === null ||
      blockNumber(valuationRecord.asOfBlock) !== null) &&
    (valuationRecord.asOfTime === null ||
      (typeof valuationRecord.asOfTime === "string" &&
        Number.isFinite(Date.parse(valuationRecord.asOfTime))));
}
