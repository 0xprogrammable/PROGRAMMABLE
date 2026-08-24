import type { PredictionTokenProfileV2 } from "./token-profile-v2";

export const PREDICTION_ASSET_DISCOVERY_THRESHOLDS_V2 = Object.freeze({
  minimumPoolAgeSeconds: 24 * 60 * 60,
  minimumLiquidityUsd: 50_000,
  minimumVolume24hUsd: 25_000,
});

export const PREDICTION_ASSET_DISCOVERY_SCOPE_V2 =
  "discovery-quality-only" as const;

export const PREDICTION_ASSET_DISCOVERY_REASON_CODES_V2 = Object.freeze([
  "price-unavailable",
  "price-not-positive",
  "pool-age-unavailable",
  "pool-too-new",
  "liquidity-unavailable",
  "liquidity-below-minimum",
  "volume-24h-unavailable",
  "volume-24h-below-minimum",
] as const);

export type PredictionAssetDiscoveryReasonCodeV2 =
  (typeof PREDICTION_ASSET_DISCOVERY_REASON_CODES_V2)[number];

export type PredictionAssetDiscoveryStatusV2 =
  | "eligible"
  | "ineligible"
  | "unknown";

export type PredictionAssetMarketCapSupplyEvidenceV2 = Readonly<{
  schemaVersion: 2;
  kind:
    | "immutable-circulating-supply"
    | "fixed-supply-fully-circulating";
  chainReference: string;
  tokenAddress: string;
  supplyBaseUnits: string;
  decimals: number;
  immutable: true;
  /** Authenticated upstream evidence; this display gate validates its binding. */
  verification: Readonly<{
    status: "verified";
    method:
      | "verified-immutable-circulating-supply"
      | "verified-fixed-supply-fully-circulating";
    chainStateReference: string;
    evidenceDigest: string;
  }>;
}>;

export type PredictionAssetDiscoveryEvidenceV2 = Readonly<{
  /** Already normalized, client-safe token discovery data. */
  profile: PredictionTokenProfileV2;
  /** Timestamp at which the price, liquidity and rolling volume were observed. */
  observedAtMs: number;
  /** Missing provider data stays unknown; an explicit zero remains a known zero. */
  volume24hUsd?: number | null;
  marketCapSupplyEvidence?: PredictionAssetMarketCapSupplyEvidenceV2 | null;
}>;

export type PredictionAssetMetricAvailabilityReasonCodeV2 =
  | "price-unavailable"
  | "price-not-positive"
  | "market-cap-unavailable"
  | "market-cap-fixed-supply-required"
  | "market-cap-supply-evidence-unavailable"
  | "market-cap-supply-evidence-invalid";

export type PredictionAssetMetricAvailabilityV2 = Readonly<{
  available: boolean;
  reasonCodes: readonly PredictionAssetMetricAvailabilityReasonCodeV2[];
}>;

export type PredictionAssetDiscoveryEligibilityV2 = Readonly<{
  schemaVersion: 2;
  scope: typeof PREDICTION_ASSET_DISCOVERY_SCOPE_V2;
  status: PredictionAssetDiscoveryStatusV2;
  observedAt: string;
  reasonCodes: readonly PredictionAssetDiscoveryReasonCodeV2[];
  thresholds: typeof PREDICTION_ASSET_DISCOVERY_THRESHOLDS_V2;
  observed: Readonly<{
    priceUsd: number | null;
    poolAgeSeconds: number | null;
    liquidityUsd: number | null;
    volume24hUsd: number | null;
  }>;
  metrics: Readonly<{
    price: PredictionAssetMetricAvailabilityV2;
    marketCap: PredictionAssetMetricAvailabilityV2;
  }>;
}>;

const KNOWN_INELIGIBILITY_REASONS = new Set<
  PredictionAssetDiscoveryReasonCodeV2
>([
  "price-not-positive",
  "pool-too-new",
  "liquidity-below-minimum",
  "volume-24h-below-minimum",
]);

const CANONICAL_POSITIVE_INTEGER = /^[1-9][0-9]{0,77}$/u;

/**
 * Evaluate only the beta discovery-quality gate. This result does not establish
 * oracle coverage, settlement eligibility, token safety or release availability.
 */
export function evaluatePredictionAssetDiscoveryEligibilityV2(
  evidence: PredictionAssetDiscoveryEvidenceV2,
): PredictionAssetDiscoveryEligibilityV2 {
  const observedAtMs = requireObservedAtMs(evidence.observedAtMs);
  const priceUsd = nonNegativeFiniteNumberOrNull(evidence.profile.priceUsd);
  const poolAgeSeconds = poolAgeSecondsAt(
    evidence.profile,
    observedAtMs,
  );
  const liquidityUsd = nonNegativeFiniteNumberOrNull(
    evidence.profile.liquidityUsd,
  );
  const volume24hUsd = nonNegativeFiniteNumberOrNull(evidence.volume24hUsd);
  const reasonCodes: PredictionAssetDiscoveryReasonCodeV2[] = [];

  if (priceUsd === null) {
    reasonCodes.push("price-unavailable");
  } else if (priceUsd === 0) {
    reasonCodes.push("price-not-positive");
  }

  if (poolAgeSeconds === null) {
    reasonCodes.push("pool-age-unavailable");
  } else if (
    poolAgeSeconds <
      PREDICTION_ASSET_DISCOVERY_THRESHOLDS_V2.minimumPoolAgeSeconds
  ) {
    reasonCodes.push("pool-too-new");
  }

  if (liquidityUsd === null) {
    reasonCodes.push("liquidity-unavailable");
  } else if (
    liquidityUsd <
      PREDICTION_ASSET_DISCOVERY_THRESHOLDS_V2.minimumLiquidityUsd
  ) {
    reasonCodes.push("liquidity-below-minimum");
  }

  if (volume24hUsd === null) {
    reasonCodes.push("volume-24h-unavailable");
  } else if (
    volume24hUsd <
      PREDICTION_ASSET_DISCOVERY_THRESHOLDS_V2.minimumVolume24hUsd
  ) {
    reasonCodes.push("volume-24h-below-minimum");
  }

  const marketCapReasonCodes = marketCapMetricReasonCodes(
    evidence.profile,
    evidence.marketCapSupplyEvidence,
  );
  const frozenReasonCodes = Object.freeze(reasonCodes);
  const frozenMarketCapReasonCodes = Object.freeze(marketCapReasonCodes);
  const frozenPriceReasonCodes = Object.freeze(
    priceUsd === null
      ? ["price-unavailable" as const]
      : priceUsd === 0
        ? ["price-not-positive" as const]
        : [],
  );

  return Object.freeze({
    schemaVersion: 2 as const,
    scope: PREDICTION_ASSET_DISCOVERY_SCOPE_V2,
    status: discoveryStatus(reasonCodes),
    observedAt: new Date(observedAtMs).toISOString(),
    reasonCodes: frozenReasonCodes,
    thresholds: PREDICTION_ASSET_DISCOVERY_THRESHOLDS_V2,
    observed: Object.freeze({
      priceUsd,
      poolAgeSeconds,
      liquidityUsd,
      volume24hUsd,
    }),
    metrics: Object.freeze({
      price: Object.freeze({
        available: priceUsd !== null && priceUsd > 0,
        reasonCodes: frozenPriceReasonCodes,
      }),
      marketCap: Object.freeze({
        available: marketCapReasonCodes.length === 0,
        reasonCodes: frozenMarketCapReasonCodes,
      }),
    }),
  });
}

function requireObservedAtMs(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    !Number.isFinite(new Date(value).getTime())
  ) {
    throw new TypeError("observedAtMs must be a non-negative safe integer");
  }
  return value;
}

function positiveFiniteNumberOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function nonNegativeFiniteNumberOrNull(
  value: number | null | undefined,
): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function poolAgeSecondsAt(
  profile: PredictionTokenProfileV2,
  observedAtMs: number,
): number | null {
  if (!profile.age) return null;
  const pairCreatedAtMs = Date.parse(profile.age.pairCreatedAt);
  if (
    !Number.isSafeInteger(pairCreatedAtMs) ||
    new Date(pairCreatedAtMs).toISOString() !== profile.age.pairCreatedAt ||
    pairCreatedAtMs > observedAtMs
  ) {
    return null;
  }
  return Math.floor((observedAtMs - pairCreatedAtMs) / 1_000);
}

function discoveryStatus(
  reasonCodes: readonly PredictionAssetDiscoveryReasonCodeV2[],
): PredictionAssetDiscoveryStatusV2 {
  if (reasonCodes.some((code) => KNOWN_INELIGIBILITY_REASONS.has(code))) {
    return "ineligible";
  }
  return reasonCodes.length === 0 ? "eligible" : "unknown";
}

function marketCapMetricReasonCodes(
  profile: PredictionTokenProfileV2,
  evidence: PredictionAssetMarketCapSupplyEvidenceV2 | null | undefined,
): PredictionAssetMetricAvailabilityReasonCodeV2[] {
  const reasonCodes: PredictionAssetMetricAvailabilityReasonCodeV2[] = [];
  if (positiveFiniteNumberOrNull(profile.marketCapUsd) === null) {
    reasonCodes.push("market-cap-unavailable");
  }
  if (evidence === null || evidence === undefined) {
    reasonCodes.push("market-cap-supply-evidence-unavailable");
  } else if (!validMarketCapSupplyEvidence(profile, evidence)) {
    reasonCodes.push("market-cap-supply-evidence-invalid");
  } else if (evidence.kind !== "fixed-supply-fully-circulating") {
    reasonCodes.push("market-cap-fixed-supply-required");
  }
  return reasonCodes;
}

function validMarketCapSupplyEvidence(
  profile: PredictionTokenProfileV2,
  evidence: unknown,
): boolean {
  if (!isRecord(evidence)) return false;
  const verification = isRecord(evidence.verification)
    ? evidence.verification
    : null;
  const expectedVerificationMethod = evidence.kind ===
      "immutable-circulating-supply"
    ? "verified-immutable-circulating-supply"
    : "verified-fixed-supply-fully-circulating";
  return evidence.schemaVersion === 2 &&
    (evidence.kind === "immutable-circulating-supply" ||
      evidence.kind === "fixed-supply-fully-circulating") &&
    evidence.chainReference === profile.chain.reference &&
    evidence.tokenAddress === profile.address &&
    evidence.immutable === true &&
    typeof evidence.supplyBaseUnits === "string" &&
    CANONICAL_POSITIVE_INTEGER.test(evidence.supplyBaseUnits) &&
    Number.isSafeInteger(evidence.decimals) &&
    typeof evidence.decimals === "number" &&
    evidence.decimals >= 0 &&
    evidence.decimals <= 255 &&
    verification?.status === "verified" &&
    verification.method === expectedVerificationMethod &&
    canonicalChainStateReference(verification.chainStateReference) &&
    typeof verification.evidenceDigest === "string" &&
    /^0x[0-9a-f]{64}$/u.test(verification.evidenceDigest) &&
    !/^0x0{64}$/u.test(verification.evidenceDigest);
}

function canonicalChainStateReference(value: unknown): value is string {
  return typeof value === "string" &&
    /^(?:0|[1-9][0-9]{0,19}|0x[0-9a-f]{64})$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
