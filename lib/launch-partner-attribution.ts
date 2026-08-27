export const LAUNCH_PARTNER_ATTRIBUTION_SCHEMA_V1 =
  "programmable.launch-partner-attribution.v1" as const;

export type LaunchPartnerAttributionV1 = Readonly<{
  schemaVersion: typeof LAUNCH_PARTNER_ATTRIBUTION_SCHEMA_V1;
  partnerId: string;
  name: string;
  website: string | null;
  attributionSource: "authenticated-partner-api-key";
  attributionVersion: number;
  snapshotDigest: `sha256:${string}`;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const unsafeText = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
const sensitiveQueryKey =
  /(?:^|[_-])(?:api[_-]?key|token|secret|password|signature|credential|authorization|auth)(?:$|[_-])/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>) {
  const keys = Object.keys(value).sort();
  const expected = [
    "attributionSource",
    "attributionVersion",
    "name",
    "partnerId",
    "schemaVersion",
    "snapshotDigest",
    "website",
  ].sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index]);
}

function containsUnsafeDecodedText(value: string) {
  let current = value;
  for (let pass = 0; pass < 4; pass += 1) {
    if (unsafeText.test(current)) return true;
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return false;
      current = decoded;
    } catch {
      return false;
    }
  }
  return unsafeText.test(current);
}

function isSensitiveQueryKey(value: string) {
  let current = value;
  for (let pass = 0; pass < 4; pass += 1) {
    if (sensitiveQueryKey.test(current)) return true;
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return false;
      current = decoded;
    } catch {
      return false;
    }
  }
  return sensitiveQueryKey.test(current);
}

export function parseLaunchPartnerNameV1(value: unknown) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 96
    || value.trim() !== value
    || unsafeText.test(value)
  ) return null;
  return value;
}

export function parseLaunchPartnerWebsiteV1(value: unknown) {
  if (
    typeof value !== "string"
    || value.length > 2_048
    || value.trim() !== value
    || containsUnsafeDecodedText(value)
  ) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || !url.hostname
      || url.hash
      || url.href !== value
      || [...url.searchParams].some(([key]) => isSensitiveQueryKey(key))
    ) return null;
    return value;
  } catch {
    return null;
  }
}

/**
 * This parser accepts only the immutable attribution snapshot emitted by the
 * authenticated backend. Create requests deliberately have no attribution
 * input; UI code must never synthesize this object from query params, project
 * metadata, API-key labels or arbitrary caller data.
 */
export function parseLaunchPartnerAttributionV1(
  value: unknown,
): LaunchPartnerAttributionV1 | null {
  if (!isRecord(value) || !exactKeys(value)) return null;
  const name = parseLaunchPartnerNameV1(value.name);
  const website = value.website === null
    ? null
    : parseLaunchPartnerWebsiteV1(value.website);
  if (
    value.schemaVersion !== LAUNCH_PARTNER_ATTRIBUTION_SCHEMA_V1
    || typeof value.partnerId !== "string"
    || !identifierPattern.test(value.partnerId)
    || name === null
    || (value.website !== null && website === null)
    || value.attributionSource !== "authenticated-partner-api-key"
    || !Number.isSafeInteger(value.attributionVersion)
    || Number(value.attributionVersion) !== 1
    || typeof value.snapshotDigest !== "string"
    || !digestPattern.test(value.snapshotDigest)
  ) return null;
  return Object.freeze({
    schemaVersion: LAUNCH_PARTNER_ATTRIBUTION_SCHEMA_V1,
    partnerId: value.partnerId,
    name,
    website: value.website === null ? null : website,
    attributionSource: "authenticated-partner-api-key",
    attributionVersion: Number(value.attributionVersion),
    snapshotDigest: value.snapshotDigest as `sha256:${string}`,
  });
}
