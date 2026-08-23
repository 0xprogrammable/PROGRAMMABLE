import { formatUnits, parseUnits } from "viem";

import {
  PREDICTION_MARKET_TYPE_V2,
  predictionAssetIdentityCandidatesV2,
  predictionAssetSelectionKeyV2,
  type PredictionAssetIdentityV2,
  type PredictionBytes32V2,
  type PredictionMarketDraftV2,
} from "../prediction-market-assets-v2";
import type { PredictionV2RegistrySnapshot } from "./abi";
import {
  predictionV2RegistrySnapshotHash,
  validatePredictionV2RegistrySnapshot,
} from "./codec";

export const PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS =
  24n * 60n * 60n;
export const PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS =
  30n * 24n * 60n * 60n;
export const PREDICTION_V2_MAX_THRESHOLD = (1n << 191n) - 1n;

const MAX_UINT32 = (1n << 32n) - 1n;
const MAX_PRICE_TEXT_LENGTH = 80;
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/u;
const DECIMAL_PRICE_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/u;
const UTC_INPUT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;

export type PredictionV2MarketDraftBinding = Readonly<{
  /** Exact active snapshot returned by AssetRegistryV2. */
  registrySnapshot: unknown;
  /** Exact result of AssetRegistryV2.hashSnapshot for the same bound read. */
  registryHashSnapshotResult: PredictionBytes32V2;
  /** Snapshot hash pinned by the independently verified release registry. */
  releaseRegistrySnapshotHash: PredictionBytes32V2;
  /** Revision pinned by that same release-registry entry. */
  releaseRegistryRevision: bigint;
  nowUnixSeconds: bigint;
}>;

export type PredictionV2ValidatedMarketDraft = Readonly<{
  selectionKey: string;
  onchainAssetKey: PredictionBytes32V2;
  identity: PredictionAssetIdentityV2;
  registryRevision: bigint;
  registrySnapshotHash: PredictionBytes32V2;
  policyValidUntil: bigint;
  feedDecimals: number;
  observationTime: bigint;
  observationLabel: string;
  thresholdAtoms: bigint;
  strikeUsd: string;
  thresholdLabel: string;
  marketTitle: string;
}>;

export type PredictionV2MarketDraftErrors = Readonly<{
  asset?: string;
  strikeUsd?: string;
  observationUtc?: string;
  binding?: string;
}>;

export type PredictionV2MarketDraftValidation =
  | Readonly<{ ok: true; market: PredictionV2ValidatedMarketDraft }>
  | Readonly<{ ok: false; errors: PredictionV2MarketDraftErrors }>;

function isFeedDecimals(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 18;
}

function normalizedBytes32(value: unknown): PredictionBytes32V2 | null {
  if (typeof value !== "string" || !BYTES32_PATTERN.test(value)) return null;
  return value.toLowerCase() as PredictionBytes32V2;
}

function sameIdentity(
  left: PredictionAssetIdentityV2,
  right: PredictionAssetIdentityV2,
) {
  return left.sourceNamespace === right.sourceNamespace &&
    left.sourceChain === right.sourceChain &&
    left.assetIdentifier === right.assetIdentifier &&
    left.assetStandard === right.assetStandard;
}

/**
 * Parse a human USD strike without floating point or implicit rounding.
 * The Registry snapshot's feedDecimals must be passed directly by the caller.
 */
export function parsePredictionV2StrikeUsd(
  value: string,
  feedDecimals: number,
): bigint | null {
  if (!isFeedDecimals(feedDecimals)) return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_PRICE_TEXT_LENGTH
  ) return null;
  const match = DECIMAL_PRICE_PATTERN.exec(normalized);
  if (!match || (match[1]?.length ?? 0) > feedDecimals) return null;

  try {
    const atoms = parseUnits(normalized, feedDecimals);
    return atoms > 0n && atoms <= PREDICTION_V2_MAX_THRESHOLD
      ? atoms
      : null;
  } catch {
    return null;
  }
}

/** Lossless canonical decimal text for a validated positive int192 strike. */
export function formatPredictionV2StrikeUsd(
  thresholdAtoms: bigint,
  feedDecimals: number,
) {
  if (
    !isFeedDecimals(feedDecimals) ||
    thresholdAtoms <= 0n ||
    thresholdAtoms > PREDICTION_V2_MAX_THRESHOLD
  ) {
    throw new TypeError("Invalid Prediction V2 USD strike");
  }
  return formatUnits(thresholdAtoms, feedDecimals);
}

export function formatPredictionV2StrikeLabel(
  thresholdAtoms: bigint,
  feedDecimals: number,
) {
  const [whole, fraction = ""] = formatPredictionV2StrikeUsd(
    thresholdAtoms,
    feedDecimals,
  ).split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  return `$${groupedWhole}${fraction ? `.${fraction}` : ""}`;
}

/** Parse the exact value emitted by a UTC-labelled datetime-local control. */
export function parsePredictionV2ObservationUtc(value: string): bigint | null {
  const match = UTC_INPUT_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const milliseconds = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  if (!Number.isFinite(milliseconds)) return null;
  const parsed = new Date(milliseconds);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) return null;

  const seconds = milliseconds / 1_000;
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;
  const timestamp = BigInt(seconds);
  return timestamp <= MAX_UINT32 ? timestamp : null;
}

export function formatPredictionV2ObservationUtc(observationTime: bigint) {
  if (observationTime < 0n || observationTime > MAX_UINT32) {
    throw new TypeError("Invalid Prediction V2 observation time");
  }
  const date = new Date(Number(observationTime) * 1_000);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(date);
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day}, ${year} at ${hour}:${minute} UTC`;
}

function validateDraftShape(value: unknown): value is PredictionMarketDraftV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  const keys = Object.keys(draft);
  if (
    keys.length !== 7 ||
    ![
      "schemaVersion",
      "asset",
      "marketType",
      "comparator",
      "quoteCurrency",
      "strikeUsd",
      "observationUtc",
    ].every((key) => Object.hasOwn(draft, key)) ||
    draft.schemaVersion !== 2 ||
    draft.marketType !== PREDICTION_MARKET_TYPE_V2 ||
    draft.comparator !== "greater-than-or-equal" ||
    draft.quoteCurrency !== "USD" ||
    typeof draft.strikeUsd !== "string" ||
    typeof draft.observationUtc !== "string"
  ) return false;

  const asset = draft.asset;
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) return false;
  const assetRecord = asset as Record<string, unknown>;
  if (assetRecord.mode === "preset") {
    return Object.keys(assetRecord).length === 2 &&
      Object.hasOwn(assetRecord, "presetId") &&
      typeof assetRecord.presetId === "string";
  }
  return assetRecord.mode === "custom" &&
    Object.keys(assetRecord).length === 3 &&
    Object.hasOwn(assetRecord, "sourceNetwork") &&
    Object.hasOwn(assetRecord, "assetLocator") &&
    typeof assetRecord.sourceNetwork === "string" &&
    typeof assetRecord.assetLocator === "string";
}

function decodeBoundSnapshot(
  binding: PredictionV2MarketDraftBinding,
): Readonly<{
  snapshot: PredictionV2RegistrySnapshot;
  snapshotHash: PredictionBytes32V2;
}> | null {
  try {
    const snapshot = validatePredictionV2RegistrySnapshot(
      binding.registrySnapshot,
    );
    const snapshotHash = predictionV2RegistrySnapshotHash(snapshot);
    const registryHash = normalizedBytes32(
      binding.registryHashSnapshotResult,
    );
    const releaseHash = normalizedBytes32(
      binding.releaseRegistrySnapshotHash,
    );
    if (
      !snapshot.policy.active ||
      typeof binding.releaseRegistryRevision !== "bigint" ||
      binding.releaseRegistryRevision !== snapshot.revision ||
      registryHash !== snapshotHash ||
      releaseHash !== snapshotHash
    ) return null;
    return { snapshot, snapshotHash };
  } catch {
    return null;
  }
}

export function validatePredictionV2MarketDraft(
  draft: unknown,
  binding: PredictionV2MarketDraftBinding,
): PredictionV2MarketDraftValidation {
  if (!validateDraftShape(draft)) {
    return {
      ok: false,
      errors: { binding: "This market draft is not supported." },
    };
  }

  const selectionKey = predictionAssetSelectionKeyV2(draft.asset);
  const bound = decodeBoundSnapshot(binding);
  const errors: {
    asset?: string;
    strikeUsd?: string;
    observationUtc?: string;
    binding?: string;
  } = {};

  if (!selectionKey) errors.asset = "Choose a released asset.";
  if (!bound) {
    errors.binding = "The released price source could not be verified.";
  } else if (!predictionAssetIdentityCandidatesV2(draft.asset).some(
    (candidate) => sameIdentity(candidate, bound.snapshot.identity),
  )) {
    errors.asset = "The selected asset does not match the released price source.";
  }

  const thresholdAtoms = bound
    ? parsePredictionV2StrikeUsd(
      draft.strikeUsd,
      bound.snapshot.policy.feedDecimals,
    )
    : null;
  if (bound && thresholdAtoms === null) {
    errors.strikeUsd =
      `Enter a positive USD price with no more than ${bound.snapshot.policy.feedDecimals} decimal places.`;
  }

  const observationTime = parsePredictionV2ObservationUtc(
    draft.observationUtc,
  );
  const now = binding.nowUnixSeconds;
  if (
    typeof now !== "bigint" ||
    now < 0n ||
    now > MAX_UINT32
  ) {
    errors.binding = "The current chain time could not be verified.";
  }
  if (observationTime === null) {
    errors.observationUtc = "Enter a valid date and time in UTC.";
  } else if (typeof now === "bigint" && now >= 0n && now <= MAX_UINT32) {
    if (
      observationTime <= now + PREDICTION_V2_MINIMUM_MARKET_DURATION_SECONDS
    ) {
      errors.observationUtc =
        "The result time must be more than 24 hours from now.";
    } else if (
      observationTime > now + PREDICTION_V2_MAXIMUM_MARKET_DURATION_SECONDS
    ) {
      errors.observationUtc =
        "The result time must be no more than 30 days from now.";
    } else if (
      bound && observationTime > bound.snapshot.policy.validUntil
    ) {
      errors.observationUtc =
        "The released price source expires before this result time.";
    }
  }

  if (
    !bound ||
    !selectionKey ||
    thresholdAtoms === null ||
    observationTime === null ||
    Object.keys(errors).length > 0
  ) {
    return { ok: false, errors };
  }

  const thresholdLabel = formatPredictionV2StrikeLabel(
    thresholdAtoms,
    bound.snapshot.policy.feedDecimals,
  );
  const observationLabel = formatPredictionV2ObservationUtc(observationTime);
  return {
    ok: true,
    market: {
      selectionKey,
      onchainAssetKey: bound.snapshot.assetKey,
      identity: bound.snapshot.identity,
      registryRevision: bound.snapshot.revision,
      registrySnapshotHash: bound.snapshotHash,
      policyValidUntil: bound.snapshot.policy.validUntil,
      feedDecimals: bound.snapshot.policy.feedDecimals,
      observationTime,
      observationLabel,
      thresholdAtoms,
      strikeUsd: formatPredictionV2StrikeUsd(
        thresholdAtoms,
        bound.snapshot.policy.feedDecimals,
      ),
      thresholdLabel,
      marketTitle:
        `Will ${bound.snapshot.displaySymbol} be at or above ${thresholdLabel} on ${observationLabel}?`,
    },
  };
}
