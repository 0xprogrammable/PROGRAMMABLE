import type { ExploreEntry, LauncherToken } from "./tokens";

export const EXPLORE_DATA_QUALITY_SCHEMA_VERSION =
  "programmable.explore-data-quality.v1" as const;
export const EXPLORE_VALUATION_MAX_LAG_BLOCKS = 64n;

const UINT_256_MAX = (1n << 256n) - 1n;
const WAD = 10n ** 18n;

export type ExploreValuation =
  | Readonly<{
      status: "available";
      metric: "fdv";
      supplyBasis: "total";
      currency: "usd" | "eth" | "quote";
      valueWad: string;
      quoteSymbol?: string;
      freshness: "current" | "stale" | "unknown";
      asOfBlock?: string;
      lagBlocks?: string;
    }>
  | Readonly<{
      status: "unavailable";
      reason:
        | "no-market"
        | "supply-unavailable"
        | "liquidity-unavailable"
        | "price-unavailable"
        | "inconsistent-snapshot";
    }>;

export type ValuedExploreEntry<T extends ExploreEntry = ExploreEntry> =
  T & Readonly<{ valuation: ExploreValuation }>;

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
    metric: "fdv";
    available: number;
    unavailable: number;
    stale: number;
    unknown: number;
    asOfBlock: string | null;
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

function valuationFreshness(
  asOfBlock: string | undefined,
  referenceBlock: string | null | undefined,
  forceStale: boolean,
): Pick<
  Extract<ExploreValuation, { status: "available" }>,
  "freshness" | "asOfBlock" | "lagBlocks"
> | null {
  if (!asOfBlock) {
    return { freshness: forceStale ? "stale" : "unknown" };
  }
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

export function valuationSortValue(entry: ExploreEntry): bigint | null {
  const value = (entry as Partial<ValuedExploreEntry>).valuation;
  return value?.status === "available" ? positiveUint256(value.valueWad) : null;
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

export function buildExploreDataQuality(input: Readonly<{
  entries: readonly ValuedExploreEntry[];
  generatedAt?: string;
  canonicalStatus: ExploreSourceStatus;
  customStatus: ExploreSourceStatus;
  identityAsOfBlock: string | null;
  referenceBlock: string | null;
  identityAgeMs?: number | null;
}>): ExploreDataQuality {
  const tokenValuations = input.entries.flatMap((entry) =>
    entry.exploreKind === "token" ? [entry.valuation] : [],
  );
  const available = tokenValuations.filter(
    (value) => value.status === "available",
  );
  const stale = available.filter((value) => value.freshness === "stale");
  const unknown = available.filter((value) => value.freshness === "unknown");
  const unavailable = tokenValuations.length - available.length;
  const valuationStatus =
    available.length === 0
      ? "unavailable" as const
      : stale.length > 0
        ? "stale" as const
        : unavailable > 0 || unknown.length > 0
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
      metric: "fdv",
      available: available.length,
      unavailable,
      stale: stale.length,
      unknown: unknown.length,
      asOfBlock: latestAvailableValuationBlock(input.entries),
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
    ].includes(String(candidate.reason));
  }
  return candidate.status === "available" &&
    candidate.metric === "fdv" &&
    candidate.supplyBasis === "total" &&
    ["usd", "eth", "quote"].includes(String(candidate.currency)) &&
    positiveUint256(candidate.valueWad) !== null &&
    ["current", "stale", "unknown"].includes(String(candidate.freshness)) &&
    (candidate.currency !== "quote" ||
      (typeof candidate.quoteSymbol === "string" &&
        candidate.quoteSymbol.trim().length > 0)) &&
    (candidate.asOfBlock === undefined ||
      blockNumber(candidate.asOfBlock) !== null) &&
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
    valuationRecord.metric === "fdv" &&
    ["available", "unavailable", "stale", "unknown"].every(
      (key) =>
        typeof valuationRecord[key] === "number" &&
        Number.isSafeInteger(valuationRecord[key]) &&
        Number(valuationRecord[key]) >= 0,
    ) &&
    (valuationRecord.asOfBlock === null ||
      blockNumber(valuationRecord.asOfBlock) !== null);
}
