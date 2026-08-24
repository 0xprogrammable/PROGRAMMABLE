import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import {
  PREDICTION_ASSET_LOGO_CAPABILITY_EXPIRY_BUCKET_SECONDS_CLIENT_V2,
  PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_CLIENT_V2,
} from
  "@/lib/prediction-v2/asset-logo-v2";
import { getPredictionV2PublicReleaseV2 } from
  "@/lib/prediction-v2/public-release-v2.server";

const CAPABILITY_DOMAIN =
  "programmable.prediction-asset-logo-capability.v2" as const;
const CAPABILITY_TOKEN_VERSION = "v2" as const;
const PROTOCOL_RELEASE_ID = "protocol-v2" as const;
const ASSET_ID_PATTERN = /^[0-9a-f]{64}$/u;
const KEY_EPOCH_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,31})$/u;
const PAYLOAD_SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const TOKEN_PATTERN =
  /^v2\.([a-z0-9](?:[a-z0-9_-]{0,31}))\.([1-9][0-9]{0,9})\.([A-Za-z0-9_-]{43})$/u;
const MINIMUM_KEY_BYTES = 32;
const MAXIMUM_KEY_BYTES = 1_024;
const MAXIMUM_UNIX_SECONDS = 9_999_999_999;

export const PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_V2 =
  PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_CLIENT_V2;
export const PREDICTION_ASSET_LOGO_CAPABILITY_EXPIRY_BUCKET_SECONDS_V2 =
  PREDICTION_ASSET_LOGO_CAPABILITY_EXPIRY_BUCKET_SECONDS_CLIENT_V2;
export const PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LIFETIME_SECONDS_V2 = 600;
export const PREDICTION_ASSET_LOGO_CAPABILITY_CLOCK_SKEW_SECONDS_V2 = 30;
export const PREDICTION_ASSET_LOGO_CAPABILITY_KEY_ENV_V2 =
  "PREDICTION_V2_ASSET_LOGO_CAPABILITY_HMAC_KEY" as const;
export const PREDICTION_ASSET_LOGO_CAPABILITY_KEY_EPOCH_ENV_V2 =
  "PREDICTION_V2_ASSET_LOGO_CAPABILITY_KEY_EPOCH" as const;

type PredictionAssetLogoCapabilityKeyV2 = Readonly<{
  keyEpoch: string;
  key: string | Uint8Array;
}>;

type PredictionAssetLogoCapabilityReleaseV2 = Readonly<{
  publicReleasePayloadSha256: `sha256:${string}`;
}>;

type PredictionAssetLogoCapabilityIssueInputV2 =
  PredictionAssetLogoCapabilityKeyV2 &
  PredictionAssetLogoCapabilityReleaseV2 &
  Readonly<{ assetId: string; nowUnixSeconds: number }>;

type PredictionAssetLogoCapabilityVerificationV2 =
  PredictionAssetLogoCapabilityIssueInputV2 &
  Readonly<{ capability: string }>;

type ParsedCapabilityV2 = Readonly<{
  keyEpoch: string;
  expiresAtUnixSeconds: number;
  encodedSignature: string;
}>;

function canonicalAssetId(assetId: unknown): string {
  if (typeof assetId !== "string" || !ASSET_ID_PATTERN.test(assetId)) {
    throw new TypeError("assetId must be one canonical lowercase 64-hex id");
  }
  return assetId;
}

function canonicalKeyEpoch(keyEpoch: unknown): string {
  if (typeof keyEpoch !== "string" || !KEY_EPOCH_PATTERN.test(keyEpoch)) {
    throw new TypeError("keyEpoch is invalid");
  }
  return keyEpoch;
}

function canonicalPublicReleasePayloadSha256(value: unknown) {
  if (typeof value !== "string" || !PAYLOAD_SHA256_PATTERN.test(value)) {
    throw new TypeError("public release payload digest is invalid");
  }
  return value as `sha256:${string}`;
}

function canonicalUnixSeconds(value: unknown, label: string): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) <= 0 ||
    (value as number) > MAXIMUM_UNIX_SECONDS
  ) {
    throw new TypeError(`${label} must be canonical Unix seconds`);
  }
  return value as number;
}

function hmacKey(key: string | Uint8Array): Buffer {
  const bytes = typeof key === "string"
    ? Buffer.from(key, "utf8")
    : Buffer.from(key);
  if (
    bytes.byteLength < MINIMUM_KEY_BYTES ||
    bytes.byteLength > MAXIMUM_KEY_BYTES
  ) {
    throw new TypeError("asset logo capability key is invalid");
  }
  return bytes;
}

function capabilityExpiry(nowUnixSeconds: number): number {
  const now = canonicalUnixSeconds(nowUnixSeconds, "nowUnixSeconds");
  return (
    Math.floor(
      now / PREDICTION_ASSET_LOGO_CAPABILITY_EXPIRY_BUCKET_SECONDS_V2,
    ) + 2
  ) * PREDICTION_ASSET_LOGO_CAPABILITY_EXPIRY_BUCKET_SECONDS_V2;
}

function capabilityMessage(input: Readonly<{
  assetId: string;
  expiresAtUnixSeconds: number;
  keyEpoch: string;
  publicReleasePayloadSha256: `sha256:${string}`;
}>): string {
  return [
    CAPABILITY_DOMAIN,
    `publicReleasePayloadSha256:${input.publicReleasePayloadSha256}`,
    `keyEpoch:${input.keyEpoch}`,
    `assetId:${input.assetId}`,
    `expiresAtUnixSeconds:${input.expiresAtUnixSeconds}`,
  ].join("\n");
}

function capabilityDigest(
  input: Parameters<typeof capabilityMessage>[0],
  key: string | Uint8Array,
): Buffer {
  return createHmac("sha256", hmacKey(key))
    .update(capabilityMessage(input), "utf8")
    .digest();
}

function parseCapability(value: unknown): ParsedCapabilityV2 | null {
  if (
    typeof value !== "string" ||
    value.length > PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_V2
  ) return null;
  const match = TOKEN_PATTERN.exec(value);
  if (!match) return null;
  try {
    const expiresAtUnixSeconds = canonicalUnixSeconds(
      Number(match[2]),
      "expiresAtUnixSeconds",
    );
    if (
      expiresAtUnixSeconds %
        PREDICTION_ASSET_LOGO_CAPABILITY_EXPIRY_BUCKET_SECONDS_V2 !== 0
    ) return null;
    return Object.freeze({
      keyEpoch: canonicalKeyEpoch(match[1]),
      expiresAtUnixSeconds,
      encodedSignature: match[3] as string,
    });
  } catch {
    return null;
  }
}

function configuredPublicReleasePayloadSha256(): `sha256:${string}` | null {
  try {
    const release = getPredictionV2PublicReleaseV2();
    if (
      release.status !== "enabled" ||
      release.release.releaseId !== PROTOCOL_RELEASE_ID
    ) return null;
    return canonicalPublicReleasePayloadSha256(
      release.attestation.payloadSha256,
    );
  } catch {
    return null;
  }
}

function configuredKey(): PredictionAssetLogoCapabilityKeyV2 | null {
  const keyEpoch = process.env[
    PREDICTION_ASSET_LOGO_CAPABILITY_KEY_EPOCH_ENV_V2
  ];
  const key = process.env[PREDICTION_ASSET_LOGO_CAPABILITY_KEY_ENV_V2];
  try {
    canonicalKeyEpoch(keyEpoch);
    hmacKey(key ?? "");
  } catch {
    return null;
  }
  return { keyEpoch: keyEpoch as string, key: key as string };
}

function currentUnixSeconds(): number {
  return canonicalUnixSeconds(
    Math.floor(Date.now() / 1_000),
    "nowUnixSeconds",
  );
}

export function isCanonicalPredictionAssetLogoAssetIdV2(
  assetId: unknown,
): assetId is string {
  return typeof assetId === "string" && ASSET_ID_PATTERN.test(assetId);
}

export function createPredictionAssetLogoCapabilityV2(
  input: PredictionAssetLogoCapabilityIssueInputV2,
): string {
  const assetId = canonicalAssetId(input.assetId);
  const keyEpoch = canonicalKeyEpoch(input.keyEpoch);
  const publicReleasePayloadSha256 = canonicalPublicReleasePayloadSha256(
    input.publicReleasePayloadSha256,
  );
  const expiresAtUnixSeconds = capabilityExpiry(input.nowUnixSeconds);
  const signature = capabilityDigest({
    assetId,
    expiresAtUnixSeconds,
    keyEpoch,
    publicReleasePayloadSha256,
  }, input.key).toString("base64url");
  return `${CAPABILITY_TOKEN_VERSION}.${keyEpoch}.` +
    `${expiresAtUnixSeconds}.${signature}`;
}

export function verifyPredictionAssetLogoCapabilityV2(
  input: PredictionAssetLogoCapabilityVerificationV2,
): boolean {
  if (!isCanonicalPredictionAssetLogoAssetIdV2(input.assetId)) return false;
  const parsed = parseCapability(input.capability);
  if (!parsed) return false;

  let nowUnixSeconds: number;
  let publicReleasePayloadSha256: `sha256:${string}`;
  try {
    nowUnixSeconds = canonicalUnixSeconds(
      input.nowUnixSeconds,
      "nowUnixSeconds",
    );
    publicReleasePayloadSha256 = canonicalPublicReleasePayloadSha256(
      input.publicReleasePayloadSha256,
    );
    if (
      parsed.keyEpoch !== canonicalKeyEpoch(input.keyEpoch) ||
      parsed.expiresAtUnixSeconds < nowUnixSeconds -
        PREDICTION_ASSET_LOGO_CAPABILITY_CLOCK_SKEW_SECONDS_V2 ||
      parsed.expiresAtUnixSeconds > nowUnixSeconds +
        PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LIFETIME_SECONDS_V2 +
        PREDICTION_ASSET_LOGO_CAPABILITY_CLOCK_SKEW_SECONDS_V2
    ) return false;
  } catch {
    return false;
  }

  let suppliedDigest: Buffer;
  let expectedDigest: Buffer;
  try {
    suppliedDigest = Buffer.from(parsed.encodedSignature, "base64url");
    if (
      !SIGNATURE_PATTERN.test(parsed.encodedSignature) ||
      suppliedDigest.byteLength !== 32 ||
      suppliedDigest.toString("base64url") !== parsed.encodedSignature
    ) {
      return false;
    }
    expectedDigest = capabilityDigest({
      assetId: input.assetId,
      expiresAtUnixSeconds: parsed.expiresAtUnixSeconds,
      keyEpoch: parsed.keyEpoch,
      publicReleasePayloadSha256,
    }, input.key);
  } catch {
    return false;
  }
  return suppliedDigest.byteLength === expectedDigest.byteLength &&
    timingSafeEqual(suppliedDigest, expectedDigest);
}

export function createConfiguredPredictionAssetLogoCapabilityV2(
  assetId: string,
): string | null {
  // The exact verified Ed25519 release is the first gate. A disabled or
  // malformed release never causes HMAC key material to be read.
  const publicReleasePayloadSha256 = configuredPublicReleasePayloadSha256();
  if (!publicReleasePayloadSha256) return null;
  const configured = configuredKey();
  if (!configured) return null;
  try {
    return createPredictionAssetLogoCapabilityV2({
      assetId,
      nowUnixSeconds: currentUnixSeconds(),
      publicReleasePayloadSha256,
      ...configured,
    });
  } catch {
    return null;
  }
}

export function verifyConfiguredPredictionAssetLogoCapabilityV2(
  assetId: string,
  capability: string,
): boolean {
  // Verification is pinned to the currently verified release payload. A token
  // minted for any previous signed release fails before provider work begins.
  const publicReleasePayloadSha256 = configuredPublicReleasePayloadSha256();
  if (!publicReleasePayloadSha256) return false;
  const configured = configuredKey();
  if (!configured) return false;
  try {
    return verifyPredictionAssetLogoCapabilityV2({
      assetId,
      capability,
      nowUnixSeconds: currentUnixSeconds(),
      publicReleasePayloadSha256,
      ...configured,
    });
  } catch {
    return false;
  }
}
