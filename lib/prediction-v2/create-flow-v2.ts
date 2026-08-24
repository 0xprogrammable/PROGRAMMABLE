/**
 * Pure, JSON-safe data model for the progressive Prediction V2 create flow.
 *
 * This module deliberately models neither asset discovery nor settlement
 * eligibility. Discovery supplies an exact chain + token-address identity;
 * the released Registry/Oracle path must independently decide whether that
 * identity can be used to create a live market.
 */

export const PREDICTION_V2_CREATE_STEPS = Object.freeze([
  "address",
  "asset",
  "prediction",
  "review",
] as const);

export type PredictionV2CreateStep =
  (typeof PREDICTION_V2_CREATE_STEPS)[number];

export const PREDICTION_V2_CREATE_SOURCE_NETWORKS = Object.freeze([
  { id: "ethereum", label: "Ethereum", namespace: "evm", chainReference: "1" },
  { id: "base", label: "Base", namespace: "evm", chainReference: "8453" },
  { id: "bnb", label: "BNB Chain", namespace: "evm", chainReference: "56" },
  {
    id: "robinhood",
    label: "Robinhood Chain",
    namespace: "evm",
    chainReference: "4663",
  },
  {
    id: "solana",
    label: "Solana",
    namespace: "solana",
    chainReference: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  },
] as const);

export type PredictionV2CreateSourceNetwork =
  (typeof PREDICTION_V2_CREATE_SOURCE_NETWORKS)[number]["id"];

export const PREDICTION_V2_CREATE_METRICS = Object.freeze([
  { id: "price", label: "Price" },
  { id: "market-cap", label: "Market cap" },
] as const);

export type PredictionV2CreateMetric =
  (typeof PREDICTION_V2_CREATE_METRICS)[number]["id"];

export const PREDICTION_V2_CREATE_TEMPLATES = Object.freeze([
  { id: "target", label: "Target", enabled: true },
  { id: "percent-change", label: "Percentage change", enabled: true },
  {
    id: "reach",
    label: "Reach before deadline",
    enabled: false,
    reason: "Requires an independently released continuous-observation policy.",
  },
] as const);

export type PredictionV2CreateTemplate =
  (typeof PREDICTION_V2_CREATE_TEMPLATES)[number]["id"];
export type PredictionV2EnabledCreateTemplate = Exclude<
  PredictionV2CreateTemplate,
  "reach"
>;

export const PREDICTION_V2_CREATE_COMPARATOR =
  "greater-than-or-equal" as const;
export const PREDICTION_V2_CREATE_QUOTE_CURRENCY = "USD" as const;
export const PREDICTION_V2_CREATE_TIMEZONE = "UTC" as const;
export const PREDICTION_V2_CREATE_SETTLEMENT_ELIGIBILITY =
  "not-evaluated" as const;
export const PREDICTION_V2_PROTOCOL_PRICE_DECIMALS = 8 as const;
export const PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS = "verified" as const;
export const PREDICTION_V2_SETTLEMENT_CHAIN_ID = "4663" as const;
export const PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS = 24n * 60n * 60n;
export const PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS =
  30n * 24n * 60n * 60n;

export type PredictionV2DetectedAssetIdentity = Readonly<{
  sourceNetwork: PredictionV2CreateSourceNetwork;
  /** Lowercase 20-byte address on EVM networks; canonical base58 on Solana. */
  address: string;
}>;

/**
 * Immutable, provider-authenticated point in source-chain state used when the
 * creator builds the draft. It is evidence for the review, not a claim that
 * the current onchain economic key commits to this object.
 */
export type PredictionV2CreationReferenceSnapshot = Readonly<{
  settlementChainId: typeof PREDICTION_V2_SETTLEMENT_CHAIN_ID;
  capturedAtUtc: string;
  snapshotReference: string;
  evidenceDigest: string;
  verificationStatus: typeof PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS;
}>;

/**
 * A supply observation bound to an immutable external snapshot reference.
 * Integer values stay decimal strings so the object remains JSON/UI safe.
 */
export type PredictionV2ReferenceSupplySnapshot = Readonly<{
  sourceNetwork: PredictionV2CreateSourceNetwork;
  address: string;
  /** Verified supply that cannot mint, burn, rebase or otherwise change. */
  fixedSupplyAtoms: string;
  tokenDecimals: number;
  capturedAtUtc: string;
  snapshotReference: string;
  evidenceDigest: string;
  verificationStatus: typeof PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS;
  supplyDefinition: "fixed-supply-fully-circulating";
}>;

/**
 * Verified source-asset metric baseline cross-attested to the exact settlement
 * creation time. Its source reference remains distinct from the settlement
 * chain reference.
 */
export type PredictionV2ReferenceMetricSnapshot = Readonly<{
  metric: PredictionV2CreateMetric;
  valueUsd: string;
  sourceNetwork: PredictionV2CreateSourceNetwork;
  address: string;
  capturedAtUtc: string;
  snapshotReference: string;
  evidenceDigest: string;
  verificationStatus: typeof PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS;
}>;

export type PredictionV2DetectedAsset = Readonly<{
  identity: PredictionV2DetectedAssetIdentity;
  name: string;
  symbol: string;
  referenceSupplySnapshot: PredictionV2ReferenceSupplySnapshot | null;
}>;

type PredictionV2CreatePredictionBase = Readonly<{
  metric: PredictionV2CreateMetric;
  observationUtc: string;
  /** Exact immutable reference point that must precede the result deadline. */
  creationSnapshot: PredictionV2CreationReferenceSnapshot;
  /** Current Prediction V2 contracts settle normalized USD prices at 1e8. */
  priceDecimals: typeof PREDICTION_V2_PROTOCOL_PRICE_DECIMALS;
}>;

export type PredictionV2TargetPrediction =
  PredictionV2CreatePredictionBase & Readonly<{
    template: "target";
    targetUsd: string;
  }>;

export type PredictionV2PercentChangePrediction =
  PredictionV2CreatePredictionBase & Readonly<{
    template: "percent-change";
    percentChange: string;
    /** Identity-bound, verified baseline; raw discovery numbers are not valid. */
    referenceMetricSnapshot: PredictionV2ReferenceMetricSnapshot;
  }>;

export type PredictionV2ReachPrediction =
  PredictionV2CreatePredictionBase & Readonly<{
    template: "reach";
    targetUsd: string;
  }>;

export type PredictionV2CreatePrediction =
  | PredictionV2TargetPrediction
  | PredictionV2PercentChangePrediction
  | PredictionV2ReachPrediction;

export type PredictionV2CreateFlowState =
  | Readonly<{
    schemaVersion: 2;
    step: "address";
    addressInput: string;
  }>
  | Readonly<{
    schemaVersion: 2;
    step: "asset";
    addressInput: string;
    asset: PredictionV2DetectedAsset;
  }>
  | Readonly<{
    schemaVersion: 2;
    step: "prediction";
    addressInput: string;
    asset: PredictionV2DetectedAsset;
    prediction: PredictionV2CreatePrediction | null;
  }>
  | Readonly<{
    schemaVersion: 2;
    step: "review";
    addressInput: string;
    asset: PredictionV2DetectedAsset;
    prediction: PredictionV2TargetPrediction | PredictionV2PercentChangePrediction;
    review: PredictionV2CreateReview;
  }>;

export type PredictionV2CreateReview = Readonly<{
  schemaVersion: 2;
  asset: PredictionV2DetectedAssetIdentity;
  assetName: string;
  assetSymbol: string;
  selectedMetric: PredictionV2CreateMetric;
  template: PredictionV2EnabledCreateTemplate;
  metricTargetUsd: string;
  inputTargetUsd: string | null;
  percentChange: string | null;
  referenceMetricUsd: string | null;
  creationSnapshot: PredictionV2CreationReferenceSnapshot;
  referenceMetricSnapshot: PredictionV2ReferenceMetricSnapshot | null;
  referenceSupplySnapshot: PredictionV2ReferenceSupplySnapshot | null;
  protocolPredicate: Readonly<{
    metric: "usd-price";
    comparator: typeof PREDICTION_V2_CREATE_COMPARATOR;
    quoteCurrency: typeof PREDICTION_V2_CREATE_QUOTE_CURRENCY;
    strikeUsd: string;
    strikeAtoms: string;
    priceDecimals: typeof PREDICTION_V2_PROTOCOL_PRICE_DECIMALS;
    observationUtc: string;
    observationUnixSeconds: string;
    timezone: typeof PREDICTION_V2_CREATE_TIMEZONE;
    /**
     * Immutable review evidence used to derive the absolute predicate. The
     * canonical onchain predicate remains the USD strike and result time above.
     */
    evidenceBinding: Readonly<{
      creationSnapshot: PredictionV2CreationReferenceSnapshot;
      referenceMetricSnapshot: PredictionV2ReferenceMetricSnapshot | null;
      referenceSupplySnapshot: PredictionV2ReferenceSupplySnapshot | null;
    }>;
  }>;
  /** This pure create model never asserts Registry/Oracle release readiness. */
  settlementEligibility: typeof PREDICTION_V2_CREATE_SETTLEMENT_ELIGIBILITY;
}>;

export type PredictionV2CreateValidationErrors = Readonly<{
  asset?: string;
  metric?: string;
  template?: string;
  targetUsd?: string;
  percentChange?: string;
  referenceMetricSnapshot?: string;
  creationSnapshot?: string;
  referenceSupplySnapshot?: string;
  observationUtc?: string;
  priceDecimals?: string;
  precision?: string;
  protocolPredicate?: string;
}>;

export type PredictionV2CreateReviewResult =
  | Readonly<{ ok: true; review: PredictionV2CreateReview }>
  | Readonly<{ ok: false; errors: PredictionV2CreateValidationErrors }>;

type ParsedDecimal = Readonly<{
  coefficient: bigint;
  scale: number;
}>;

const EVM_NETWORKS = new Set<PredictionV2CreateSourceNetwork>([
  "ethereum",
  "base",
  "bnb",
  "robinhood",
]);
const SUPPORTED_NETWORKS = new Set<PredictionV2CreateSourceNetwork>(
  PREDICTION_V2_CREATE_SOURCE_NETWORKS.map(({ id }) => id),
);
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const SOLANA_BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]+$/u;
const SOLANA_BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const UNSIGNED_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/u;
const SIGNED_DECIMAL_PATTERN = /^(-?)(?:0|[1-9]\d*)(?:\.(\d+))?$/u;
const EXACT_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/u;
const CANONICAL_POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/u;
const MAX_DECIMAL_TEXT_LENGTH = 96;
const MAX_DECIMAL_SCALE = 36;
const MAX_TOKEN_DECIMALS = 255;
const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_PROTOCOL_THRESHOLD = (1n << 191n) - 1n;
const CANONICAL_CHAIN_POSITION_PATTERN = /^(?:0|[1-9]\d{0,19})$/u;
const CANONICAL_EVIDENCE_DIGEST_PATTERN = /^0x[0-9a-f]{64}$/u;
const ZERO_EVIDENCE_DIGEST = `0x${"0".repeat(64)}`;

const EVM_CHAIN_REFERENCE_BY_NETWORK = Object.freeze({
  ethereum: "1",
  base: "8453",
  bnb: "56",
  robinhood: "4663",
} as const satisfies Readonly<Record<
  Exclude<PredictionV2CreateSourceNetwork, "solana">,
  string
>>);

function powerOfTen(exponent: number) {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 512) {
    throw new RangeError("Unsupported decimal scale");
  }
  return 10n ** BigInt(exponent);
}

function normalizeDecimal(coefficient: bigint, scale: number): ParsedDecimal {
  let normalizedCoefficient = coefficient;
  let normalizedScale = scale;
  while (normalizedScale > 0 && normalizedCoefficient % 10n === 0n) {
    normalizedCoefficient /= 10n;
    normalizedScale -= 1;
  }
  return { coefficient: normalizedCoefficient, scale: normalizedScale };
}

function parseUnsignedDecimal(value: unknown): ParsedDecimal | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_DECIMAL_TEXT_LENGTH) return null;
  const match = UNSIGNED_DECIMAL_PATTERN.exec(text);
  if (!match) return null;
  const fractionLength = match[1]?.length ?? 0;
  if (fractionLength > MAX_DECIMAL_SCALE) return null;
  const coefficient = BigInt(text.replace(".", ""));
  return normalizeDecimal(coefficient, fractionLength);
}

function parseSignedDecimal(value: unknown): ParsedDecimal | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_DECIMAL_TEXT_LENGTH) return null;
  const match = SIGNED_DECIMAL_PATTERN.exec(text);
  if (!match) return null;
  const fractionLength = match[2]?.length ?? 0;
  if (fractionLength > MAX_DECIMAL_SCALE) return null;
  const unsignedText = text.replace(/^-|\./gu, "");
  const unsignedCoefficient = BigInt(unsignedText);
  const coefficient = match[1] === "-" ? -unsignedCoefficient : unsignedCoefficient;
  return normalizeDecimal(coefficient, fractionLength);
}

function formatDecimal(value: ParsedDecimal) {
  const normalized = normalizeDecimal(value.coefficient, value.scale);
  const negative = normalized.coefficient < 0n;
  const digits = (negative ? -normalized.coefficient : normalized.coefficient)
    .toString();
  if (normalized.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(normalized.scale + 1, "0");
  const split = padded.length - normalized.scale;
  return `${negative ? "-" : ""}${padded.slice(0, split)}.${padded.slice(split)}`;
}

function decimalToAtomsExact(value: ParsedDecimal, decimals: number) {
  if (value.coefficient < 0n) return null;
  if (value.scale <= decimals) {
    return value.coefficient * powerOfTen(decimals - value.scale);
  }
  const divisor = powerOfTen(value.scale - decimals);
  return value.coefficient % divisor === 0n
    ? value.coefficient / divisor
    : null;
}

function atomsToDecimal(atoms: bigint, decimals: number) {
  return formatDecimal({ coefficient: atoms, scale: decimals });
}

function decodeBase58Bytes(value: string): Uint8Array | null {
  if (!value || !SOLANA_BASE58_PATTERN.test(value)) return null;
  const littleEndian = [0];
  for (const character of value) {
    const alphabetIndex = SOLANA_BASE58_ALPHABET.indexOf(character);
    if (alphabetIndex < 0) return null;
    let carry = alphabetIndex;
    for (let index = 0; index < littleEndian.length; index += 1) {
      carry += littleEndian[index] * 58;
      littleEndian[index] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      littleEndian.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeroCount = 0;
  while (leadingZeroCount < value.length && value[leadingZeroCount] === "1") {
    leadingZeroCount += 1;
  }
  const decodedLength = littleEndian.length + leadingZeroCount -
    (littleEndian.length === 1 && littleEndian[0] === 0 ? 1 : 0);
  const decoded = new Uint8Array(decodedLength);
  for (let index = 0; index < littleEndian.length; index += 1) {
    const target = decoded.length - 1 - index;
    if (target >= leadingZeroCount) decoded[target] = littleEndian[index];
  }
  return decoded;
}

function isSupportedNetwork(
  value: unknown,
): value is PredictionV2CreateSourceNetwork {
  return typeof value === "string" &&
    SUPPORTED_NETWORKS.has(value as PredictionV2CreateSourceNetwork);
}

export function normalizePredictionV2DetectedAssetIdentity(
  value: unknown,
): PredictionV2DetectedAssetIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (!isSupportedNetwork(candidate.sourceNetwork) ||
    typeof candidate.address !== "string") return null;
  const address = candidate.address.trim();
  if (EVM_NETWORKS.has(candidate.sourceNetwork)) {
    if (!EVM_ADDRESS_PATTERN.test(address) || /^0x0{40}$/iu.test(address)) {
      return null;
    }
    return { sourceNetwork: candidate.sourceNetwork, address: address.toLowerCase() };
  }
  const decoded = decodeBase58Bytes(address);
  return decoded?.length === 32 && decoded.some((byte) => byte !== 0)
    ? { sourceNetwork: "solana", address }
    : null;
}

function canonicalSnapshotReferenceForIdentity(
  identity: PredictionV2DetectedAssetIdentity,
  value: unknown,
) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const separatorIndex = value.lastIndexOf(":");
  if (separatorIndex < 0) return null;
  const position = value.slice(separatorIndex + 1);
  if (!CANONICAL_CHAIN_POSITION_PATTERN.test(position) ||
    BigInt(position) > MAX_UINT64) return null;
  const expectedPrefix = identity.sourceNetwork === "solana"
    ? "solana:slot:"
    : `eip155:${EVM_CHAIN_REFERENCE_BY_NETWORK[identity.sourceNetwork]}:block:`;
  return value === `${expectedPrefix}${position}` ? value : null;
}

function canonicalSettlementSnapshotReference(value: unknown) {
  if (typeof value !== "string" || value !== value.trim()) return null;
  const prefix = `eip155:${PREDICTION_V2_SETTLEMENT_CHAIN_ID}:block:`;
  if (!value.startsWith(prefix)) return null;
  const position = value.slice(prefix.length);
  return CANONICAL_CHAIN_POSITION_PATTERN.test(position) &&
      BigInt(position) <= MAX_UINT64
    ? value
    : null;
}

function canonicalEvidenceDigest(value: unknown) {
  return typeof value === "string" &&
      CANONICAL_EVIDENCE_DIGEST_PATTERN.test(value) &&
      value !== ZERO_EVIDENCE_DIGEST
    ? value
    : null;
}

function normalizedSnapshotIdentity(
  sourceNetwork: unknown,
  address: unknown,
  expectedIdentity: PredictionV2DetectedAssetIdentity | null = null,
) {
  const identity = normalizePredictionV2DetectedAssetIdentity({
    sourceNetwork,
    address,
  });
  if (!identity || address !== identity.address) return null;
  if (expectedIdentity && (
    identity.sourceNetwork !== expectedIdentity.sourceNetwork ||
    identity.address !== expectedIdentity.address
  )) return null;
  return identity;
}

/** Parse an exact `YYYY-MM-DDTHH:mm:ssZ` UTC value into JSON-safe Unix seconds. */
export function predictionV2ExactUtcToUnixSeconds(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const match = EXACT_UTC_PATTERN.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1970) return null;
  const milliseconds = Date.UTC(year, month - 1, day, hour, minute, second, 0);
  if (!Number.isFinite(milliseconds)) return null;
  const parsed = new Date(milliseconds);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute ||
    parsed.getUTCSeconds() !== second
  ) return null;
  const unixSeconds = BigInt(milliseconds / 1_000);
  return unixSeconds <= MAX_UINT32 ? unixSeconds.toString() : null;
}

/** Exact decimal-to-atoms helper. It never uses Number for protocol values. */
export function parsePredictionV2DecimalAtoms(
  value: string,
  decimals: number,
): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    return null;
  }
  const parsed = parseUnsignedDecimal(value);
  return parsed ? decimalToAtomsExact(parsed, decimals) : null;
}

export function formatPredictionV2DecimalAtoms(
  atoms: bigint,
  decimals: number,
) {
  if (atoms < 0n || !Number.isInteger(decimals) ||
    decimals < 0 || decimals > MAX_TOKEN_DECIMALS) {
    throw new TypeError("Invalid decimal atoms");
  }
  return atomsToDecimal(atoms, decimals);
}

type PriceStrikeDerivation =
  | Readonly<{
    ok: true;
    strikeAtoms: string;
    strikeUsd: string;
  }>
  | Readonly<{
    ok: false;
    reason: "invalid" | "precision" | "unsupported";
  }>;

function deriveExactMarketCapPriceStrike(
  target: ParsedDecimal,
  supplySnapshot: PredictionV2ReferenceSupplySnapshot,
  priceDecimals: number,
): PriceStrikeDerivation {
  const snapshotIdentity = normalizedSnapshotIdentity(
    supplySnapshot?.sourceNetwork,
    supplySnapshot?.address,
  );
  if (
    target.coefficient <= 0n ||
    priceDecimals !== PREDICTION_V2_PROTOCOL_PRICE_DECIMALS ||
    !snapshotIdentity ||
    supplySnapshot.supplyDefinition !== "fixed-supply-fully-circulating" ||
    supplySnapshot.verificationStatus !== PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS ||
    !canonicalSnapshotReferenceForIdentity(
      snapshotIdentity,
      supplySnapshot.snapshotReference,
    ) ||
    !canonicalEvidenceDigest(supplySnapshot.evidenceDigest) ||
    !predictionV2ExactUtcToUnixSeconds(supplySnapshot.capturedAtUtc) ||
    typeof supplySnapshot.fixedSupplyAtoms !== "string" ||
    !CANONICAL_POSITIVE_INTEGER_PATTERN.test(
      supplySnapshot.fixedSupplyAtoms,
    )
  ) {
    return { ok: false, reason: "invalid" };
  }
  const fixedSupplyAtoms = BigInt(
    supplySnapshot.fixedSupplyAtoms,
  );
  if (fixedSupplyAtoms <= 0n || fixedSupplyAtoms > MAX_UINT256 ||
    !Number.isInteger(supplySnapshot.tokenDecimals) ||
    supplySnapshot.tokenDecimals < 0 ||
    supplySnapshot.tokenDecimals > MAX_TOKEN_DECIMALS) {
    return { ok: false, reason: "invalid" };
  }

  const numerator = target.coefficient * powerOfTen(
    supplySnapshot.tokenDecimals + priceDecimals,
  );
  const denominator = powerOfTen(target.scale) * fixedSupplyAtoms;
  if (numerator % denominator !== 0n) {
    return { ok: false, reason: "precision" };
  }
  const strikeAtoms = numerator / denominator;
  if (strikeAtoms <= 0n || strikeAtoms > MAX_PROTOCOL_THRESHOLD) {
    return { ok: false, reason: "unsupported" };
  }
  return {
    ok: true,
    strikeAtoms: strikeAtoms.toString(),
    strikeUsd: atomsToDecimal(strikeAtoms, priceDecimals),
  };
}

/**
 * Converts a USD market-cap threshold only when its frozen-supply price is
 * exactly representable by the current 8-decimal protocol predicate. Mutable
 * circulating-supply snapshots are deliberately unsupported.
 */
export function predictionV2MarketCapTargetToPriceStrike(
  targetMarketCapUsd: string,
  supplySnapshot: PredictionV2ReferenceSupplySnapshot,
  priceDecimals: number,
): Readonly<{ strikeAtoms: string; strikeUsd: string }> | null {
  const target = parseUnsignedDecimal(targetMarketCapUsd);
  if (!target) return null;
  const result = deriveExactMarketCapPriceStrike(
    target,
    supplySnapshot,
    priceDecimals,
  );
  return result.ok
    ? { strikeAtoms: result.strikeAtoms, strikeUsd: result.strikeUsd }
    : null;
}

function percentageTarget(
  reference: ParsedDecimal,
  percent: ParsedDecimal,
): Readonly<{ target: ParsedDecimal; normalizedPercent: string }> | null {
  if (reference.coefficient <= 0n || percent.coefficient <= 0n) return null;
  const percentScale = powerOfTen(percent.scale);
  const multiplier = 100n * percentScale + percent.coefficient;
  return {
    target: normalizeDecimal(
      reference.coefficient * multiplier,
      reference.scale + percent.scale + 2,
    ),
    normalizedPercent: formatDecimal(percent),
  };
}

function validateDetectedAsset(
  asset: PredictionV2DetectedAsset,
): Readonly<{
  asset: PredictionV2DetectedAsset | null;
  error?: string;
}> {
  const identity = normalizePredictionV2DetectedAssetIdentity(asset?.identity);
  const name = typeof asset?.name === "string" ? asset.name.trim() : "";
  const symbol = typeof asset?.symbol === "string" ? asset.symbol.trim() : "";
  if (!identity || !name || name.length > 160 || !symbol || symbol.length > 32) {
    return { asset: null, error: "Use a valid detected token identity." };
  }
  return {
    asset: {
      identity,
      name,
      symbol,
      referenceSupplySnapshot: asset.referenceSupplySnapshot ?? null,
    },
  };
}

type NormalizedEvidenceSnapshotBase = Readonly<{
  identity: PredictionV2DetectedAssetIdentity;
  capturedAtUtc: string;
  capturedUnixSeconds: string;
  snapshotReference: string;
  evidenceDigest: string;
}>;

function normalizeEvidenceSnapshotBase(
  snapshot: unknown,
  expectedIdentity: PredictionV2DetectedAssetIdentity,
): NormalizedEvidenceSnapshotBase | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return null;
  }
  const candidate = snapshot as Record<string, unknown>;
  const identity = normalizedSnapshotIdentity(
    candidate.sourceNetwork,
    candidate.address,
    expectedIdentity,
  );
  if (!identity ||
    candidate.verificationStatus !== PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS) {
    return null;
  }
  const capturedUnixSeconds = predictionV2ExactUtcToUnixSeconds(
    candidate.capturedAtUtc,
  );
  const snapshotReference = canonicalSnapshotReferenceForIdentity(
    identity,
    candidate.snapshotReference,
  );
  const evidenceDigest = canonicalEvidenceDigest(candidate.evidenceDigest);
  if (!capturedUnixSeconds || typeof candidate.capturedAtUtc !== "string" ||
    !snapshotReference || !evidenceDigest) return null;
  return {
    identity,
    capturedAtUtc: candidate.capturedAtUtc,
    capturedUnixSeconds,
    snapshotReference,
    evidenceDigest,
  };
}

function validateCreationSnapshot(
  snapshot: PredictionV2CreationReferenceSnapshot,
): Readonly<{
  snapshot: PredictionV2CreationReferenceSnapshot | null;
  capturedUnixSeconds: string | null;
  error?: string;
}> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return {
      snapshot: null,
      capturedUnixSeconds: null,
      error: "Use a verified immutable Robinhood Chain creation snapshot.",
    };
  }
  const candidate = snapshot as Record<string, unknown>;
  const capturedUnixSeconds = predictionV2ExactUtcToUnixSeconds(
    candidate.capturedAtUtc,
  );
  const snapshotReference = canonicalSettlementSnapshotReference(
    candidate.snapshotReference,
  );
  const evidenceDigest = canonicalEvidenceDigest(candidate.evidenceDigest);
  if (candidate.settlementChainId !== PREDICTION_V2_SETTLEMENT_CHAIN_ID ||
    candidate.verificationStatus !== PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS ||
    !capturedUnixSeconds || typeof candidate.capturedAtUtc !== "string" ||
    !snapshotReference || !evidenceDigest) {
    return {
      snapshot: null,
      capturedUnixSeconds: null,
      error: "Use a verified immutable Robinhood Chain creation snapshot.",
    };
  }
  return {
    snapshot: {
      settlementChainId: PREDICTION_V2_SETTLEMENT_CHAIN_ID,
      capturedAtUtc: candidate.capturedAtUtc,
      snapshotReference,
      evidenceDigest,
      verificationStatus: PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS,
    },
    capturedUnixSeconds,
  };
}

function validateReferenceMetricSnapshot(
  snapshot: PredictionV2ReferenceMetricSnapshot,
  expectedIdentity: PredictionV2DetectedAssetIdentity,
  expectedMetric: PredictionV2CreateMetric,
  creationSnapshot: PredictionV2CreationReferenceSnapshot | null,
): Readonly<{
  snapshot: PredictionV2ReferenceMetricSnapshot | null;
  value: ParsedDecimal | null;
  error?: string;
}> {
  const base = normalizeEvidenceSnapshotBase(snapshot, expectedIdentity);
  const value = parseUnsignedDecimal(snapshot?.valueUsd);
  // Exact timestamp equality is the V2 cross-attestation rule. Source and
  // settlement references intentionally remain different and are both kept.
  if (!base || snapshot?.metric !== expectedMetric || !value ||
    value.coefficient <= 0n || !creationSnapshot ||
    base.capturedAtUtc !== creationSnapshot.capturedAtUtc) {
    return {
      snapshot: null,
      value: null,
      error:
        "Percentage change requires a verified metric baseline from the exact creation snapshot.",
    };
  }
  return {
    snapshot: {
      metric: expectedMetric,
      valueUsd: formatDecimal(value),
      sourceNetwork: base.identity.sourceNetwork,
      address: base.identity.address,
      capturedAtUtc: base.capturedAtUtc,
      snapshotReference: base.snapshotReference,
      evidenceDigest: base.evidenceDigest,
      verificationStatus: PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS,
    },
    value,
  };
}

function validateSupplySnapshot(
  snapshot: PredictionV2ReferenceSupplySnapshot | null,
  expectedIdentity: PredictionV2DetectedAssetIdentity,
  creationSnapshot: PredictionV2CreationReferenceSnapshot | null,
): Readonly<{
  snapshot: PredictionV2ReferenceSupplySnapshot | null;
  error?: string;
}> {
  if (!snapshot) {
    return {
      snapshot: null,
      error:
        "Market-cap markets require verified fixed, fully circulating supply.",
    };
  }
  const base = normalizeEvidenceSnapshotBase(snapshot, expectedIdentity);
  // Exact timestamp equality cross-attests the immutable source-supply proof
  // to creation without conflating its source block with the settlement block.
  if (!base || snapshot.supplyDefinition !== "fixed-supply-fully-circulating" ||
    typeof snapshot.fixedSupplyAtoms !== "string" ||
    !CANONICAL_POSITIVE_INTEGER_PATTERN.test(
      snapshot.fixedSupplyAtoms,
    ) || !creationSnapshot ||
    base.capturedAtUtc !== creationSnapshot.capturedAtUtc) {
    return {
      snapshot: null,
      error:
        "Fixed, fully circulating supply must be verified for this token at the exact creation snapshot.",
    };
  }
  const supply = BigInt(snapshot.fixedSupplyAtoms);
  if (supply <= 0n || supply > MAX_UINT256) {
    return { snapshot: null, error: "The fixed supply must be positive." };
  }
  if (!Number.isInteger(snapshot.tokenDecimals) || snapshot.tokenDecimals < 0 ||
    snapshot.tokenDecimals > MAX_TOKEN_DECIMALS) {
    return { snapshot: null, error: "The reference supply decimals are invalid." };
  }
  return {
    snapshot: {
      sourceNetwork: base.identity.sourceNetwork,
      address: base.identity.address,
      fixedSupplyAtoms: supply.toString(),
      tokenDecimals: snapshot.tokenDecimals,
      capturedAtUtc: base.capturedAtUtc,
      snapshotReference: base.snapshotReference,
      evidenceDigest: base.evidenceDigest,
      verificationStatus: PREDICTION_V2_VERIFIED_SNAPSHOT_STATUS,
      supplyDefinition: "fixed-supply-fully-circulating",
    },
  };
}

export function buildPredictionV2CreateReview(
  assetInput: PredictionV2DetectedAsset,
  prediction: PredictionV2CreatePrediction,
): PredictionV2CreateReviewResult {
  const errors: {
    asset?: string;
    metric?: string;
    template?: string;
    targetUsd?: string;
    percentChange?: string;
    referenceMetricSnapshot?: string;
    creationSnapshot?: string;
    referenceSupplySnapshot?: string;
    observationUtc?: string;
    priceDecimals?: string;
    precision?: string;
    protocolPredicate?: string;
  } = {};
  if (!prediction || typeof prediction !== "object") {
    return {
      ok: false,
      errors: {
        metric: "Choose a supported metric.",
        template: "Choose a supported prediction type.",
      },
    };
  }
  const detected = validateDetectedAsset(assetInput);
  if (detected.error) errors.asset = detected.error;

  const metric = prediction.metric === "price" || prediction.metric === "market-cap"
    ? prediction.metric
    : null;
  if (!metric) errors.metric = "Choose Price or Market cap.";
  const template = prediction.template === "target" ||
      prediction.template === "percent-change" || prediction.template === "reach"
    ? prediction.template
    : null;
  if (!template) {
    errors.template = "Choose a supported prediction type.";
  } else if (template === "reach") {
    errors.template = "Reach-before-deadline markets are not enabled yet.";
  }

  let creationSnapshot: PredictionV2CreationReferenceSnapshot | null = null;
  let creationUnixSeconds: string | null = null;
  if (detected.asset) {
    const creation = validateCreationSnapshot(
      prediction.creationSnapshot,
    );
    if (creation.error) errors.creationSnapshot = creation.error;
    creationSnapshot = creation.snapshot;
    creationUnixSeconds = creation.capturedUnixSeconds;
  }

  const observationUnixSeconds = predictionV2ExactUtcToUnixSeconds(
    prediction.observationUtc,
  );
  if (!observationUnixSeconds) {
    errors.observationUtc = "Enter an exact UTC time including seconds and Z.";
  } else if (creationUnixSeconds) {
    const observation = BigInt(observationUnixSeconds);
    const creation = BigInt(creationUnixSeconds);
    if (observation <=
      creation + PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS) {
      errors.observationUtc =
        "The result time must be more than 24 hours after the creation snapshot.";
    } else if (observation >
      creation + PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS) {
      errors.observationUtc =
        "The result time must be no more than 30 days after the creation snapshot.";
    }
  }
  if (prediction.priceDecimals !== PREDICTION_V2_PROTOCOL_PRICE_DECIMALS) {
    errors.priceDecimals =
      `Prediction V2 requires exactly ${PREDICTION_V2_PROTOCOL_PRICE_DECIMALS} price decimals.`;
  }

  let metricTarget: ParsedDecimal | null = null;
  let normalizedPercent: string | null = null;
  let referenceMetricUsd: string | null = null;
  let referenceMetricSnapshot: PredictionV2ReferenceMetricSnapshot | null = null;
  let inputTargetUsd: string | null = null;
  if (prediction.template === "target" || prediction.template === "reach") {
    const parsedTarget = parseUnsignedDecimal(prediction.targetUsd);
    if (!parsedTarget || parsedTarget.coefficient <= 0n) {
      errors.targetUsd = "Enter a positive USD target as a decimal value.";
    } else {
      metricTarget = parsedTarget;
      inputTargetUsd = formatDecimal(parsedTarget);
    }
  } else if (prediction.template === "percent-change" && metric && detected.asset) {
    const reference = validateReferenceMetricSnapshot(
      prediction.referenceMetricSnapshot,
      detected.asset.identity,
      metric,
      creationSnapshot,
    );
    if (reference.error) errors.referenceMetricSnapshot = reference.error;
    referenceMetricSnapshot = reference.snapshot;
    if (reference.value) referenceMetricUsd = formatDecimal(reference.value);

    const parsedPercent = parseSignedDecimal(prediction.percentChange);
    if (!parsedPercent) {
      errors.percentChange = "Enter a percentage as a decimal value.";
    } else if (parsedPercent.coefficient <= 0n) {
      errors.percentChange =
        "Prediction V2 supports only a positive upward percentage threshold.";
    }
    const derived = reference.value && parsedPercent && parsedPercent.coefficient > 0n
      ? percentageTarget(reference.value, parsedPercent)
      : null;
    if (derived) {
      metricTarget = derived.target;
      normalizedPercent = derived.normalizedPercent;
    }
  }

  let supplySnapshot: PredictionV2ReferenceSupplySnapshot | null = null;
  if (metric === "market-cap" && detected.asset) {
    const supply = validateSupplySnapshot(
      assetInput?.referenceSupplySnapshot ?? null,
      detected.asset.identity,
      creationSnapshot,
    );
    if (supply.error) errors.referenceSupplySnapshot = supply.error;
    supplySnapshot = supply.snapshot;
  }

  let priceStrike: Readonly<{ strikeAtoms: string; strikeUsd: string }> | null = null;
  if (metricTarget && !errors.priceDecimals) {
    if (metric === "price") {
      const strikeAtoms = decimalToAtomsExact(
        metricTarget,
        PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
      );
      if (strikeAtoms === null) {
        errors.precision =
          "The exact target cannot be represented by the 8-decimal protocol price.";
      } else if (strikeAtoms <= 0n || strikeAtoms > MAX_PROTOCOL_THRESHOLD) {
        errors.protocolPredicate = "The resulting price threshold is unsupported.";
      } else {
        priceStrike = {
          strikeAtoms: strikeAtoms.toString(),
          strikeUsd: atomsToDecimal(
            strikeAtoms,
            PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
          ),
        };
      }
    } else if (metric === "market-cap" && supplySnapshot) {
      const derived = deriveExactMarketCapPriceStrike(
        metricTarget,
        supplySnapshot,
        PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
      );
      if (!derived.ok && derived.reason === "precision") {
        errors.precision =
          "The exact market-cap target cannot be represented by the 8-decimal protocol price.";
      } else if (!derived.ok) {
        errors.protocolPredicate =
          "The market-cap target cannot produce a valid price threshold.";
      } else {
        priceStrike = {
          strikeAtoms: derived.strikeAtoms,
          strikeUsd: derived.strikeUsd,
        };
      }
    }
  }

  const enabledTemplate = template === "target" || template === "percent-change"
    ? template
    : null;
  if (Object.keys(errors).length > 0 || !detected.asset || !metric ||
    !enabledTemplate || !metricTarget || !priceStrike || !observationUnixSeconds ||
    !creationSnapshot) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    review: {
      schemaVersion: 2,
      asset: detected.asset.identity,
      assetName: detected.asset.name,
      assetSymbol: detected.asset.symbol,
      selectedMetric: metric,
      template: enabledTemplate,
      metricTargetUsd: formatDecimal(metricTarget),
      inputTargetUsd,
      percentChange: normalizedPercent,
      referenceMetricUsd,
      creationSnapshot,
      referenceMetricSnapshot,
      referenceSupplySnapshot: supplySnapshot,
      protocolPredicate: {
        metric: "usd-price",
        comparator: PREDICTION_V2_CREATE_COMPARATOR,
        quoteCurrency: PREDICTION_V2_CREATE_QUOTE_CURRENCY,
        strikeUsd: priceStrike.strikeUsd,
        strikeAtoms: priceStrike.strikeAtoms,
        priceDecimals: PREDICTION_V2_PROTOCOL_PRICE_DECIMALS,
        observationUtc: prediction.observationUtc,
        observationUnixSeconds,
        timezone: PREDICTION_V2_CREATE_TIMEZONE,
        evidenceBinding: {
          creationSnapshot,
          referenceMetricSnapshot,
          referenceSupplySnapshot: supplySnapshot,
        },
      },
      settlementEligibility: PREDICTION_V2_CREATE_SETTLEMENT_ELIGIBILITY,
    },
  };
}

export function nextPredictionV2CreateStep(
  step: PredictionV2CreateStep,
): PredictionV2CreateStep {
  const index = PREDICTION_V2_CREATE_STEPS.indexOf(step);
  return PREDICTION_V2_CREATE_STEPS[Math.min(
    Math.max(index, 0) + 1,
    PREDICTION_V2_CREATE_STEPS.length - 1,
  )];
}

export function previousPredictionV2CreateStep(
  step: PredictionV2CreateStep,
): PredictionV2CreateStep {
  const index = PREDICTION_V2_CREATE_STEPS.indexOf(step);
  return PREDICTION_V2_CREATE_STEPS[Math.max(index - 1, 0)];
}
