import {
  isMarketChartIdentityV1,
  isMarketChartV1,
  type MarketChartIdentityV1,
  type MarketChartV1,
} from "./market-data-v1";

export const PROGRAMMABLE_GMGN_MARKET_CHART_SCHEMA_VERSION =
  "programmable.gmgn-market-chart.v1" as const;

export const PROGRAMMABLE_GMGN_CHART_IDENTITY_PROOF_SCHEMA_VERSION =
  "programmable.gmgn-chart-identity-proof.v1" as const;

export type GmgnMarketChartRangeV1 = MarketChartV1["range"];

export type GmgnKlineResolutionV1 =
  | "30s"
  | "1m"
  | "5m"
  | "15m"
  | "1h"
  | "4h"
  | "1d";

export type GmgnChartIdentityProofV1 = Readonly<{
  schemaVersion:
    typeof PROGRAMMABLE_GMGN_CHART_IDENTITY_PROOF_SCHEMA_VERSION;
  source: "gmgn-token-info";
  verifiedAt: string;
  identity: MarketChartIdentityV1;
  canonicalSupply: Readonly<{
    totalSupplyRaw: string;
    tokenDecimals: number;
  }>;
}>;

export type GmgnMarketChartPointV1 = Readonly<{
  time: string;
  bucketStart: string;
  bucketEnd: string;
  valueSemantics: "period-close";
  priceUsd: string;
  ohlcUsd: Readonly<{
    open: string;
    high: string;
    low: string;
    close: string;
  }>;
  volumeUsdWad: string;
}>;

export type GmgnMarketChartV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_GMGN_MARKET_CHART_SCHEMA_VERSION;
  source: "gmgn";
  readStatus: "live";
  status: "ready" | "insufficient-history" | "partial";
  generatedAt: string;
  identity: MarketChartIdentityV1;
  identityProof: GmgnChartIdentityProofV1;
  range: GmgnMarketChartRangeV1;
  resolution: GmgnKlineResolutionV1;
  requestedFrom: string;
  requestedTo: string;
  points: readonly GmgnMarketChartPointV1[];
  candleCount: number;
  volumeUsdWad: string;
  asOfTime: string;
  truncated: boolean;
}>;

const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const CANONICAL_UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const UINT256_MAX = (1n << 256n) - 1n;
const DEFAULT_MAXIMUM_PREFERRED_AGE_MS = 60_000;
const MAXIMUM_CLOCK_SKEW_MS = 5_000;

const RESOLUTION_DURATION_MS: Readonly<Record<GmgnKlineResolutionV1, number>> =
  Object.freeze({
    "30s": 30_000,
    "1m": 60_000,
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
  });

export function gmgnKlineResolutionDurationMsV1(
  resolution: GmgnKlineResolutionV1,
): number {
  return RESOLUTION_DURATION_MS[resolution];
}

export function isGmgnChartIdentityProofV1(
  value: unknown,
): value is GmgnChartIdentityProofV1 {
  return isRecord(value) &&
    value.schemaVersion ===
      PROGRAMMABLE_GMGN_CHART_IDENTITY_PROOF_SCHEMA_VERSION &&
    value.source === "gmgn-token-info" &&
    exactIsoTime(value.verifiedAt) &&
    isMarketChartIdentityV1(value.identity) &&
    isCanonicalSupplyV1(value.canonicalSupply);
}

export function isGmgnMarketChartV1(
  value: unknown,
): value is GmgnMarketChartV1 {
  if (
    !isRecord(value) ||
    value.schemaVersion !== PROGRAMMABLE_GMGN_MARKET_CHART_SCHEMA_VERSION ||
    value.source !== "gmgn" ||
    value.readStatus !== "live" ||
    !["ready", "insufficient-history", "partial"].includes(
      String(value.status),
    ) ||
    !exactIsoTime(value.generatedAt) ||
    !isMarketChartIdentityV1(value.identity) ||
    !isGmgnChartIdentityProofV1(value.identityProof) ||
    !sameIdentity(value.identity, value.identityProof.identity) ||
    !["1h", "1d", "1w", "all"].includes(String(value.range)) ||
    !isGmgnKlineResolutionV1(value.resolution) ||
    !exactIsoTime(value.requestedFrom) ||
    !exactIsoTime(value.requestedTo) ||
    Date.parse(value.requestedFrom as string) >=
      Date.parse(value.requestedTo as string) ||
    !Array.isArray(value.points) ||
    value.points.length === 0 ||
    value.points.length > 512 ||
    !Number.isSafeInteger(value.candleCount) ||
    value.candleCount !== value.points.length ||
    !unsignedInteger(value.volumeUsdWad) ||
    !exactIsoTime(value.asOfTime) ||
    typeof value.truncated !== "boolean"
  ) return false;

  const generatedAtMs = Date.parse(value.generatedAt as string);
  const proofAtMs = Date.parse(value.identityProof.verifiedAt);
  const requestedFromMs = Date.parse(value.requestedFrom as string);
  const requestedToMs = Date.parse(value.requestedTo as string);
  if (proofAtMs > generatedAtMs || requestedToMs > generatedAtMs) return false;

  const durationMs = gmgnKlineResolutionDurationMsV1(
    value.resolution as GmgnKlineResolutionV1,
  );
  const points = value.points as unknown[];
  let previousEndMs = Number.NEGATIVE_INFINITY;
  let totalVolume = 0n;
  for (const point of points) {
    if (!isGmgnMarketChartPointV1(point, durationMs)) return false;
    const bucketStartMs = Date.parse(point.bucketStart);
    const bucketEndMs = Date.parse(point.bucketEnd);
    if (
      bucketStartMs < requestedFromMs ||
      bucketEndMs > requestedToMs ||
      bucketStartMs < previousEndMs
    ) return false;
    previousEndMs = bucketEndMs;
    totalVolume += BigInt(point.volumeUsdWad);
  }
  const typedPoints = points as GmgnMarketChartPointV1[];
  if (
    totalVolume.toString() !== value.volumeUsdWad ||
    typedPoints.at(-1)?.bucketEnd !== value.asOfTime
  ) return false;

  if (value.status === "partial") return value.truncated;
  if (value.truncated) return false;
  return value.status === "ready"
    ? typedPoints.length >= 2
    : typedPoints.length === 1;
}

export function isGmgnMarketChartForIdentityV1(
  value: unknown,
  identity: MarketChartIdentityV1,
  range?: GmgnMarketChartRangeV1,
): value is GmgnMarketChartV1 {
  return isMarketChartIdentityV1(identity) &&
    isGmgnMarketChartV1(value) &&
    sameIdentity(value.identity, identity) &&
    (range === undefined || value.range === range);
}

/**
 * Selects GMGN only when its exact token/pool/quote proof is current and its
 * OHLCV result is richer than the existing Bitquery result. A partial GMGN
 * range cannot displace a complete Bitquery range.
 */
export function preferExactGmgnMarketChartV1(input: Readonly<{
  candidate: unknown;
  fallback: MarketChartV1;
  identity: MarketChartIdentityV1;
  range: GmgnMarketChartRangeV1;
  now: Date;
  maximumCandidateAgeMs?: number;
}>): GmgnMarketChartV1 | MarketChartV1 {
  if (
    !isGmgnMarketChartForIdentityV1(
      input.candidate,
      input.identity,
      input.range,
    ) ||
    !Number.isFinite(input.now.getTime())
  ) return input.fallback;

  const maximumAgeMs = input.maximumCandidateAgeMs ??
    DEFAULT_MAXIMUM_PREFERRED_AGE_MS;
  if (
    !Number.isSafeInteger(maximumAgeMs) ||
    maximumAgeMs < 0 ||
    maximumAgeMs > 5 * 60_000
  ) return input.fallback;

  const generatedAtMs = Date.parse(input.candidate.generatedAt);
  const proofAtMs = Date.parse(input.candidate.identityProof.verifiedAt);
  const nowMs = input.now.getTime();
  if (
    generatedAtMs > nowMs + MAXIMUM_CLOCK_SKEW_MS ||
    nowMs - generatedAtMs > maximumAgeMs ||
    generatedAtMs - proofAtMs > maximumAgeMs
  ) return input.fallback;

  const fallbackQuality = marketChartQuality(input.fallback, input.identity);
  const gmgnQuality = input.candidate.status === "ready"
    ? 4
    : input.candidate.status === "partial"
      ? 2
      : 1;
  return gmgnQuality > fallbackQuality ? input.candidate : input.fallback;
}

function marketChartQuality(
  value: MarketChartV1,
  expectedIdentity: MarketChartIdentityV1,
): number {
  if (
    !isMarketChartV1(value) ||
    !sameIdentity(value.identity, expectedIdentity)
  ) return -1;
  const liveQuality = value.status === "ready"
    ? 3
    : value.status === "insufficient-history"
      ? 2
      : value.status === "partial"
        ? 1
        : 0;
  return value.readStatus === "cache-fallback"
    ? Math.max(0, liveQuality - 1)
    : liveQuality;
}

function isGmgnMarketChartPointV1(
  value: unknown,
  durationMs: number,
): value is GmgnMarketChartPointV1 {
  if (
    !isRecord(value) ||
    !exactIsoTime(value.time) ||
    !exactIsoTime(value.bucketStart) ||
    !exactIsoTime(value.bucketEnd) ||
    value.time !== value.bucketEnd ||
    value.valueSemantics !== "period-close" ||
    !positiveDecimal(value.priceUsd) ||
    !isRecord(value.ohlcUsd) ||
    !positiveDecimal(value.ohlcUsd.open) ||
    !positiveDecimal(value.ohlcUsd.high) ||
    !positiveDecimal(value.ohlcUsd.low) ||
    !positiveDecimal(value.ohlcUsd.close) ||
    value.priceUsd !== value.ohlcUsd.close ||
    !unsignedInteger(value.volumeUsdWad)
  ) return false;

  const startMs = Date.parse(value.bucketStart as string);
  const endMs = Date.parse(value.bucketEnd as string);
  if (endMs - startMs !== durationMs) return false;
  const open = decimalParts(value.ohlcUsd.open as string);
  const high = decimalParts(value.ohlcUsd.high as string);
  const low = decimalParts(value.ohlcUsd.low as string);
  const close = decimalParts(value.ohlcUsd.close as string);
  return compareDecimals(high, open) >= 0 &&
    compareDecimals(high, close) >= 0 &&
    compareDecimals(open, low) >= 0 &&
    compareDecimals(close, low) >= 0;
}

function isGmgnKlineResolutionV1(
  value: unknown,
): value is GmgnKlineResolutionV1 {
  return typeof value === "string" && value in RESOLUTION_DURATION_MS;
}

function sameIdentity(
  first: MarketChartIdentityV1,
  second: MarketChartIdentityV1,
): boolean {
  return first.chainId === second.chainId &&
    first.protocol === second.protocol &&
    first.tokenAddress === second.tokenAddress &&
    first.poolId === second.poolId &&
    first.quoteAddress === second.quoteAddress;
}

function exactIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function positiveDecimal(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 160 &&
    CANONICAL_DECIMAL.test(value) &&
    decimalParts(value).coefficient > 0n;
}

function unsignedInteger(value: unknown): value is string {
  return typeof value === "string" &&
    CANONICAL_UNSIGNED_INTEGER.test(value);
}

function isCanonicalSupplyV1(value: unknown): value is Readonly<{
  totalSupplyRaw: string;
  tokenDecimals: number;
}> {
  if (
    !isRecord(value) ||
    !unsignedInteger(value.totalSupplyRaw) ||
    !Number.isSafeInteger(value.tokenDecimals) ||
    (value.tokenDecimals as number) < 0 ||
    (value.tokenDecimals as number) > 255
  ) return false;
  try {
    const raw = BigInt(value.totalSupplyRaw);
    return raw > 0n && raw <= UINT256_MAX;
  } catch {
    return false;
  }
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

function compareDecimals(
  first: ReturnType<typeof decimalParts>,
  second: ReturnType<typeof decimalParts>,
): number {
  const difference = first.coefficient * second.scale -
    second.coefficient * first.scale;
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
