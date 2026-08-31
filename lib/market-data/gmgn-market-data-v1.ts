import type { MarketChartIdentityV1 } from "./market-data-v1";

export const PROGRAMMABLE_GMGN_MARKET_SNAPSHOT_SCHEMA_VERSION =
  "programmable.gmgn-market-snapshot.v1" as const;

export type GmgnMarketSnapshotV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_GMGN_MARKET_SNAPSHOT_SCHEMA_VERSION;
  source: "gmgn";
  currency: "USD";
  fetchedAt: string;
  identity: MarketChartIdentityV1;
  priceUsdWad: string;
  fdvUsdWad: string;
  liquidityUsdWad: string;
  volume24hUsdWad: string;
  swapCount24h: number;
}>;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;

export function isGmgnMarketSnapshotV1(
  value: unknown,
): value is GmgnMarketSnapshotV1 {
  if (!isRecord(value) || !isMarketIdentity(value.identity)) return false;
  return value.schemaVersion ===
      PROGRAMMABLE_GMGN_MARKET_SNAPSHOT_SCHEMA_VERSION &&
    value.source === "gmgn" &&
    value.currency === "USD" &&
    exactIsoTime(value.fetchedAt) &&
    positiveInteger(value.priceUsdWad) &&
    positiveInteger(value.fdvUsdWad) &&
    positiveInteger(value.liquidityUsdWad) &&
    unsignedInteger(value.volume24hUsdWad) &&
    Number.isSafeInteger(value.swapCount24h) &&
    Number(value.swapCount24h) >= 0;
}

function isMarketIdentity(value: unknown): value is MarketChartIdentityV1 {
  if (!isRecord(value)) return false;
  return value.chainId === "1" &&
    typeof value.tokenAddress === "string" &&
    ADDRESS.test(value.tokenAddress) &&
    value.tokenAddress === value.tokenAddress.toLowerCase() &&
    typeof value.poolId === "string" &&
    BYTES32.test(value.poolId) &&
    value.poolId === value.poolId.toLowerCase() &&
    typeof value.quoteAddress === "string" &&
    ADDRESS.test(value.quoteAddress) &&
    value.quoteAddress === value.quoteAddress.toLowerCase() &&
    value.quoteAddress !== value.tokenAddress &&
    value.protocol === "uniswap_v4";
}

function exactIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function unsignedInteger(value: unknown): value is string {
  return typeof value === "string" && UNSIGNED_INTEGER.test(value);
}

function positiveInteger(value: unknown): value is string {
  return unsignedInteger(value) && BigInt(value) > 0n;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
