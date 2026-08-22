import {
  encodeFunctionData,
  formatUnits,
  hashDomain,
  isAddress,
  isHex,
  parseSignature,
  parseUnits,
  serializeTypedData,
  type Address,
  type Hex,
} from "viem";

import { ROBINHOOD_CHAIN_ID } from "./chains";

export { ROBINHOOD_CHAIN_ID } from "./chains";

export const ROBINHOOD_USDG_ADDRESS =
  "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;
export const ROBINHOOD_BTC_USD_FEED_ADDRESS =
  "0xa2c5184bF03d373Dc9dE4876eb4Bce595B460251" as const;
export const PREDICTION_BOOTSTRAP_USDG_ATOMS = 2_000_000n;
export const PREDICTION_MINIMUM_DURATION_SECONDS = 24 * 60 * 60;
export const PREDICTION_TRADING_CUTOFF_SECONDS = 60;
export const PREDICTION_PRICE_DECIMALS = 8;
export const PREDICTION_PERMIT_DURATION_SECONDS = 20 * 60;

const INT192_MAX = (1n << 191n) - 1n;
const UINT256_MAX = (1n << 256n) - 1n;
const UINT32_MAX = 2 ** 32 - 1;
const UTC_INPUT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DECIMAL_PRICE_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,8})?$/;

export type PredictionMarketDraft = Readonly<{
  observationUtc: string;
  thresholdUsd: string;
}>;

export type ValidatedPredictionMarket = Readonly<{
  cutoffTime: number;
  countdownLabel: string;
  marketTitle: string;
  observationLabel: string;
  observationTime: number;
  thresholdAtoms: bigint;
  thresholdLabel: string;
}>;

export type PredictionMarketDraftErrors = Readonly<{
  observationUtc?: string;
  thresholdUsd?: string;
}>;

export type PredictionMarketDraftValidation =
  | Readonly<{ ok: true; market: ValidatedPredictionMarket }>
  | Readonly<{ ok: false; errors: PredictionMarketDraftErrors }>;

export type PredictionPermitSignature = Readonly<{
  deadline: bigint;
  r: Hex;
  s: Hex;
  v: number;
}>;

export const predictionMarketFactoryAbi = [
  {
    type: "function",
    name: "createMarketWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "observationTime", type: "uint32" },
      { name: "threshold", type: "int192" },
      { name: "permitDeadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [
      { name: "vaultAddress", type: "address" },
      { name: "created", type: "bool" },
    ],
  },
] as const;

export const usdgPermitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const usdgPermitDomainTypes = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
} as const;

export function defaultPredictionObservationUtc(nowMs = Date.now()) {
  const targetMs = nowMs + 48 * 60 * 60 * 1_000;
  const nextWholeHourMs =
    Math.ceil(targetMs / (60 * 60 * 1_000)) * 60 * 60 * 1_000;
  return new Date(nextWholeHourMs).toISOString().slice(0, 16);
}

export function parseBtcUsdThreshold(value: string) {
  const normalized = value.trim();
  if (!DECIMAL_PRICE_PATTERN.test(normalized)) return null;

  try {
    const atoms = parseUnits(normalized, PREDICTION_PRICE_DECIMALS);
    return atoms > 0n && atoms <= INT192_MAX ? atoms : null;
  } catch {
    return null;
  }
}

export function parseUtcObservation(value: string) {
  const match = UTC_INPUT_PATTERN.exec(value.trim());
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const milliseconds = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const parsed = new Date(milliseconds);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day ||
    parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute
  ) {
    return null;
  }

  const seconds = milliseconds / 1_000;
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= UINT32_MAX
    ? seconds
    : null;
}

export function formatPredictionThreshold(thresholdAtoms: bigint) {
  const [whole, fraction = ""] = formatUnits(
    thresholdAtoms,
    PREDICTION_PRICE_DECIMALS,
  ).split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return `$${groupedWhole}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

export function formatUtcObservation(observationTime: number) {
  const date = new Date(observationTime * 1_000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute} UTC`;
}

export function formatPredictionCountdown(
  observationTime: number,
  nowMs = Date.now(),
) {
  const remainingSeconds = Math.max(
    0,
    observationTime - Math.floor(nowMs / 1_000),
  );
  const days = Math.floor(remainingSeconds / (24 * 60 * 60));
  const hours = Math.floor((remainingSeconds % (24 * 60 * 60)) / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);

  if (days > 0) {
    return `${days} ${days === 1 ? "day" : "days"} ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  if (hours > 0) {
    return `${hours} ${hours === 1 ? "hour" : "hours"} ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export function validatePredictionMarketDraft(
  draft: PredictionMarketDraft,
  nowMs = Date.now(),
): PredictionMarketDraftValidation {
  const thresholdAtoms = parseBtcUsdThreshold(draft.thresholdUsd);
  const observationTime = parseUtcObservation(draft.observationUtc);
  const minimumObservationTime =
    Math.floor(nowMs / 1_000) + PREDICTION_MINIMUM_DURATION_SECONDS;
  const errors: {
    observationUtc?: string;
    thresholdUsd?: string;
  } = {};

  if (thresholdAtoms === null) {
    errors.thresholdUsd =
      "Enter a positive BTC price with no more than 8 decimal places.";
  }
  if (observationTime === null) {
    errors.observationUtc = "Enter a valid date and time in UTC.";
  } else if (observationTime <= minimumObservationTime) {
    errors.observationUtc =
      "The result time must be more than 24 hours from now.";
  }

  if (thresholdAtoms === null || observationTime === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const thresholdLabel = formatPredictionThreshold(thresholdAtoms);
  const observationLabel = formatUtcObservation(observationTime);
  return {
    ok: true,
    market: {
      cutoffTime: observationTime - PREDICTION_TRADING_CUTOFF_SECONDS,
      countdownLabel: formatPredictionCountdown(observationTime, nowMs),
      marketTitle: `Will BTC/USD be at or above ${thresholdLabel} at ${observationLabel}?`,
      observationLabel,
      observationTime,
      thresholdAtoms,
      thresholdLabel,
    },
  };
}

export function buildUsdgPermitTypedData({
  deadline,
  factoryAddress,
  nonce,
  owner,
}: {
  deadline: bigint;
  factoryAddress: Address;
  nonce: bigint;
  owner: Address;
}) {
  if (!isAddress(owner) || !isAddress(factoryAddress)) {
    throw new Error("Permit owner and factory must be valid addresses");
  }
  if (
    nonce < 0n ||
    nonce > UINT256_MAX ||
    deadline <= 0n ||
    deadline > UINT256_MAX
  ) {
    throw new Error("Permit nonce or deadline is outside uint256 bounds");
  }

  return {
    domain: {
      chainId: ROBINHOOD_CHAIN_ID,
      name: "Global Dollar",
      verifyingContract: ROBINHOOD_USDG_ADDRESS,
      version: "1",
    },
    message: {
      deadline,
      nonce,
      owner,
      spender: factoryAddress,
      value: PREDICTION_BOOTSTRAP_USDG_ATOMS,
    },
    primaryType: "Permit" as const,
    types: usdgPermitTypes,
  };
}

export function getExpectedUsdgPermitDomainSeparator() {
  return hashDomain({
    domain: {
      chainId: BigInt(ROBINHOOD_CHAIN_ID),
      name: "Global Dollar",
      verifyingContract: ROBINHOOD_USDG_ADDRESS,
      version: "1",
    },
    types: usdgPermitDomainTypes,
  });
}

export function serializeUsdgPermitTypedData(
  typedData: ReturnType<typeof buildUsdgPermitTypedData>,
) {
  const serialized = serializeTypedData({
    ...typedData,
    domain: {
      ...typedData.domain,
      chainId: BigInt(typedData.domain.chainId),
    },
    types: {
      ...usdgPermitDomainTypes,
      ...typedData.types,
    },
  });
  const payload = JSON.parse(serialized) as {
    domain: { chainId: number | string };
  };
  payload.domain.chainId = ROBINHOOD_CHAIN_ID;
  return JSON.stringify(payload);
}

export function parsePredictionPermitSignature(
  signature: Hex,
  deadline: bigint,
): PredictionPermitSignature {
  if (
    !isHex(signature, { strict: true }) ||
    signature.length !== 132 ||
    deadline <= 0n ||
    deadline > UINT256_MAX
  ) {
    throw new Error("The wallet returned an invalid permit signature");
  }

  const parsed = parseSignature(signature);
  const v = parsed.v === undefined
    ? (parsed.yParity ?? -1) + 27
    : Number(parsed.v);
  if (v !== 27 && v !== 28) {
    throw new Error("The wallet returned an invalid permit signature");
  }

  return {
    deadline,
    r: parsed.r,
    s: parsed.s,
    v,
  };
}

export function encodePredictionMarketCreation({
  factoryAddress,
  market,
  permit,
}: {
  factoryAddress: Address;
  market: ValidatedPredictionMarket;
  permit: PredictionPermitSignature;
}) {
  if (!isAddress(factoryAddress)) {
    throw new Error("Prediction factory must be a valid address");
  }
  if (
    !Number.isInteger(market.observationTime) ||
    market.observationTime < 0 ||
    market.observationTime > UINT32_MAX ||
    market.thresholdAtoms <= 0n ||
    market.thresholdAtoms > INT192_MAX ||
    permit.deadline <= 0n ||
    permit.deadline > UINT256_MAX
  ) {
    throw new Error("Prediction market or permit bounds are invalid");
  }
  if (
    !Number.isInteger(permit.v) ||
    (permit.v !== 27 && permit.v !== 28) ||
    !isHex(permit.r, { strict: true }) ||
    permit.r.length !== 66 ||
    !isHex(permit.s, { strict: true }) ||
    permit.s.length !== 66
  ) {
    throw new Error("Permit signature is invalid");
  }

  return {
    data: encodeFunctionData({
      abi: predictionMarketFactoryAbi,
      functionName: "createMarketWithPermit",
      args: [
        market.observationTime,
        market.thresholdAtoms,
        permit.deadline,
        permit.v,
        permit.r,
        permit.s,
      ],
    }),
    to: factoryAddress,
    value: 0n,
  } as const;
}
