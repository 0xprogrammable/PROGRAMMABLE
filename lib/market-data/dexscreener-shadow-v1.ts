import {
  MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD,
  type MarketChartIdentityV1,
} from "./market-data-v1";

export const PROGRAMMABLE_DEXSCREENER_SHADOW_SCHEMA_VERSION =
  "programmable.dexscreener-market-shadow.v1" as const;

export const DEXSCREENER_SHADOW_SOURCE = "dexscreener" as const;
export const DEXSCREENER_SHADOW_MODE = "shadow" as const;
export const DEXSCREENER_SHADOW_CURRENCY = "USD" as const;
export const DEXSCREENER_SHADOW_MAX_TOKENS_PER_REQUEST = 30 as const;
export const DEXSCREENER_SHADOW_MINIMUM_FDV_LIQUIDITY_USD_WAD =
  MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD;

const UINT256_MAX = (1n << 256n) - 1n;
const USD_WAD = 10n ** 18n;
const STRICT_POSITIVE_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

export type DexscreenerShadowUnavailableReasonV1 =
  | "provider-missing"
  | "identity-mismatch"
  | "ambiguous-exact-pair"
  | "malformed-market-data"
  | "batch-rate-limited"
  | "batch-server-error"
  | "batch-timeout"
  | "batch-transport-error"
  | "batch-response-invalid"
  | "batch-response-too-large";

export type DexscreenerShadowObservationV1 = Readonly<{
  source: typeof DEXSCREENER_SHADOW_SOURCE;
  mode: typeof DEXSCREENER_SHADOW_MODE;
  currency: typeof DEXSCREENER_SHADOW_CURRENCY;
  fetchedAt: string;
  pairAddress: `0x${string}`;
  priceUsdWad: string;
  liquidityUsdWad: string;
  fdvUsdWad: string;
  marketCapUsdWad: string;
}>;

export type DexscreenerShadowFdvQualificationV1 =
  | Readonly<{
      status: "qualified";
      minimumLiquidityUsdWad:
        typeof DEXSCREENER_SHADOW_MINIMUM_FDV_LIQUIDITY_USD_WAD;
    }>
  | Readonly<{
      status: "unavailable";
      reason: "insufficient-liquidity";
      minimumLiquidityUsdWad:
        typeof DEXSCREENER_SHADOW_MINIMUM_FDV_LIQUIDITY_USD_WAD;
    }>;

export type DexscreenerShadowResultV1 =
  | Readonly<{
      identity: MarketChartIdentityV1;
      status: "available";
      observation: DexscreenerShadowObservationV1;
      fdvQualification: DexscreenerShadowFdvQualificationV1;
    }>
  | Readonly<{
      identity: MarketChartIdentityV1;
      status: "unavailable";
      reason: DexscreenerShadowUnavailableReasonV1;
    }>;

export type DexscreenerShadowBatchStatusV1 =
  | "ok"
  | "rate-limited"
  | "server-error"
  | "timeout"
  | "transport-error"
  | "response-invalid"
  | "response-too-large";

export type DexscreenerShadowBatchDiagnosticV1 = Readonly<{
  index: number;
  requestedTokenCount: number;
  status: DexscreenerShadowBatchStatusV1;
  httpStatus?: number;
}>;

export type DexscreenerShadowSnapshotV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_DEXSCREENER_SHADOW_SCHEMA_VERSION;
  source: typeof DEXSCREENER_SHADOW_SOURCE;
  mode: typeof DEXSCREENER_SHADOW_MODE;
  currency: typeof DEXSCREENER_SHADOW_CURRENCY;
  assembledAt: string;
  sourceReadWindow: Readonly<{
    oldestFetchedAt: string;
    newestFetchedAt: string;
  }> | null;
  readStatus: "complete" | "partial" | "unavailable";
  requestedCount: number;
  observedCount: number;
  qualifiedCount: number;
  unavailableCount: number;
  batches: readonly DexscreenerShadowBatchDiagnosticV1[];
  results: readonly DexscreenerShadowResultV1[];
}>;

export type DexscreenerShadowRankingV1 = Readonly<{
  requested: "fdv";
  status: "complete" | "partial" | "unavailable";
  applied: "fdv" | "qualified-fdv-then-launch-order" | "launch-order";
  qualifiedCount: number;
  unavailableCount: number;
}>;

export type RankedDexscreenerShadowResultsV1 = Readonly<{
  ranking: DexscreenerShadowRankingV1;
  results: readonly DexscreenerShadowResultV1[];
}>;

/**
 * Converts an exact provider decimal string to the website USD-WAD contract.
 * Scientific notation, signs, rounding and precision loss are intentionally
 * rejected. Zero is not a market observation.
 */
export function exactPositiveDecimalUsdToWadV1(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 160) return null;
  const match = STRICT_POSITIVE_DECIMAL.exec(value);
  if (!match) return null;

  const [whole, fraction = ""] = value.split(".");
  if (whole.length > 78 || fraction.length > 18) return null;

  try {
    const wad = BigInt(whole) * USD_WAD +
      BigInt(fraction.padEnd(18, "0") || "0");
    return wad > 0n && wad <= UINT256_MAX ? wad.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Dexscreener exposes several USD fields as JSON numbers. The server parser
 * passes their source lexemes here before IEEE-754 conversion. Scientific
 * notation is expanded, but rounding, more than 18 fractional decimals, and
 * magnitudes above Number.MAX_SAFE_INTEGER are rejected.
 */
export function exactJsonNumberLexemeUsdToWadV1(
  value: unknown,
): string | null {
  if (typeof value !== "string" || value.length > 160) return null;
  const decimal = expandPositiveJsonNumber(value);
  if (decimal === null) return null;
  const [whole, rawFraction = ""] = decimal.split(".");
  const fraction = rawFraction.replace(/0+$/u, "");
  if (fraction.length > 18) return null;
  try {
    const wholeValue = BigInt(whole);
    if (
      wholeValue > BigInt(Number.MAX_SAFE_INTEGER) ||
      (wholeValue === BigInt(Number.MAX_SAFE_INTEGER) && fraction.length > 0)
    ) return null;
  } catch {
    return null;
  }
  return exactPositiveDecimalUsdToWadV1(
    fraction.length === 0 ? whole : `${whole}.${fraction}`,
  );
}

export function rankDexscreenerShadowResultsV1(
  results: readonly DexscreenerShadowResultV1[],
): RankedDexscreenerShadowResultsV1 {
  const launchOrder = new Map(
    results.map((result, index) => [identityKey(result.identity), index]),
  );
  const qualifiedCount = results.filter(
    (result) => result.status === "available" &&
      result.fdvQualification.status === "qualified",
  ).length;
  const unavailableCount = results.length - qualifiedCount;

  if (qualifiedCount === 0) {
    return {
      ranking: {
        requested: "fdv",
        status: "unavailable",
        applied: "launch-order",
        qualifiedCount,
        unavailableCount,
      },
      results: [...results],
    };
  }

  const sorted = [...results].sort((left, right) => {
    const leftQualified = left.status === "available" &&
      left.fdvQualification.status === "qualified";
    const rightQualified = right.status === "available" &&
      right.fdvQualification.status === "qualified";
    if (leftQualified && !rightQualified) return -1;
    if (!leftQualified && rightQualified) return 1;
    if (leftQualified && rightQualified &&
      left.status === "available" && right.status === "available") {
      const fdvDifference = BigInt(right.observation.fdvUsdWad) -
        BigInt(left.observation.fdvUsdWad);
      if (fdvDifference !== 0n) return fdvDifference > 0n ? 1 : -1;
    }
    return (launchOrder.get(identityKey(left.identity)) ?? 0) -
      (launchOrder.get(identityKey(right.identity)) ?? 0);
  });

  return {
    ranking: {
      requested: "fdv",
      status: unavailableCount === 0 ? "complete" : "partial",
      applied: unavailableCount === 0
        ? "fdv"
        : "qualified-fdv-then-launch-order",
      qualifiedCount,
      unavailableCount,
    },
    results: sorted,
  };
}

function identityKey(identity: MarketChartIdentityV1): string {
  return `${identity.tokenAddress}:${identity.poolId}:${identity.quoteAddress}`;
}

function expandPositiveJsonNumber(value: string): string | null {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/u
    .exec(value);
  if (!match) return null;

  const whole = match[1];
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) return null;

  const digits = `${whole}${fraction}`;
  const decimalIndex = whole.length + exponent;
  if (decimalIndex <= 0) {
    return `0.${"0".repeat(-decimalIndex)}${digits}`;
  }
  if (decimalIndex >= digits.length) {
    return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  }
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}
