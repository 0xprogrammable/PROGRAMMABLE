const DEXSCREENER_IMAGE_HOST_V2 = "cdn.dexscreener.com";
const DEXSCREENER_IMAGE_PATH_V2 = /^\/cms\/images\/([0-9a-f]{64})$/u;
const PREDICTION_ASSET_LOGO_ASSET_ID_V2 = /^[0-9a-f]{64}$/u;
const PREDICTION_ASSET_LOGO_CAPABILITY_V2 =
  /^v2\.[a-z0-9](?:[a-z0-9_-]{0,31})\.([1-9][0-9]{0,9})\.[A-Za-z0-9_-]{43}$/u;

export const PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_CLIENT_V2 = 90;
export const PREDICTION_ASSET_LOGO_CAPABILITY_EXPIRY_BUCKET_SECONDS_CLIENT_V2 =
  300;

const PREDICTION_ASSET_FALLBACKS_V2 = Object.freeze([
  "/brand/programmable-token-fallback-01-dawn.webp",
  "/brand/programmable-token-fallback-02-moon.webp",
  "/brand/programmable-token-fallback-03-sun.webp",
  "/brand/programmable-token-fallback-04-mint.webp",
  "/brand/programmable-token-fallback-05-lavender.webp",
  "/brand/programmable-token-fallback-06-dusk.webp",
] as const);

export type PredictionAssetCardImageV2 = Readonly<{
  source: string;
  usesProviderLogo: boolean;
}>;

/**
 * Transient browser transport only. The capability is server-issued for one
 * exact provider asset id and is never part of the canonical presentation
 * record or content-addressed public artwork.
 */
export type PredictionAssetLogoProxyV2 = Readonly<{
  assetId: string;
  capability: string;
}>;

export function isCanonicalPredictionAssetLogoCapabilityV2(
  value: unknown,
): value is string {
  if (
    typeof value !== "string" ||
    value.length > PREDICTION_ASSET_LOGO_CAPABILITY_MAXIMUM_LENGTH_CLIENT_V2
  ) return false;
  const expiresAt = Number(PREDICTION_ASSET_LOGO_CAPABILITY_V2.exec(value)?.[1]);
  return Number.isSafeInteger(expiresAt) &&
    expiresAt > 0 &&
    expiresAt %
      PREDICTION_ASSET_LOGO_CAPABILITY_EXPIRY_BUCKET_SECONDS_CLIENT_V2 === 0;
}

export function predictionAssetLogoCapabilityExpiresAtUnixSecondsV2(
  value: unknown,
): number | null {
  if (!isCanonicalPredictionAssetLogoCapabilityV2(value)) return null;
  const encoded = PREDICTION_ASSET_LOGO_CAPABILITY_V2.exec(value)?.[1];
  const expiresAt = Number(encoded);
  return Number.isSafeInteger(expiresAt) && expiresAt > 0
    ? expiresAt
    : null;
}

/**
 * Reduce a DEX Screener image URL to its immutable CDN asset identifier. The
 * browser never receives or loads the provider URL directly; the internal
 * image route reconstructs one fixed upstream origin from this identifier.
 */
export function predictionDexscreenerLogoAssetIdV2(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== DEXSCREENER_IMAGE_HOST_V2 ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.hash !== ""
  ) return null;
  return DEXSCREENER_IMAGE_PATH_V2.exec(parsed.pathname)?.[1] ?? null;
}

export function predictionAssetFallbackImageV2(
  chainId: string,
  address: string,
) {
  // FNV-1a is deliberately used only for stable visual distribution. It is
  // not an identity or integrity digest.
  let hash = 0x811c9dc5;
  for (const character of `${chainId}:${address}`.toLowerCase()) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PREDICTION_ASSET_FALLBACKS_V2[
    hash % PREDICTION_ASSET_FALLBACKS_V2.length
  ];
}

export function predictionAssetCardImageV2(input: Readonly<{
  chainId: string;
  address: string;
  /** Legacy input is deliberately ignored; raw provider URLs are not trusted. */
  logoUrl?: string | null;
  logoProxy?: PredictionAssetLogoProxyV2 | null;
}>): PredictionAssetCardImageV2 {
  const logoProxy = input.logoProxy;
  const assetId = logoProxy?.assetId;
  const authorized = typeof assetId === "string" &&
    PREDICTION_ASSET_LOGO_ASSET_ID_V2.test(assetId) &&
    isCanonicalPredictionAssetLogoCapabilityV2(logoProxy?.capability);
  return authorized && logoProxy
    ? Object.freeze({
      source: `/api/prediction/asset-logo/${assetId}` +
        `?capability=${encodeURIComponent(logoProxy.capability)}`,
      usesProviderLogo: true,
    })
    : Object.freeze({
      source: predictionAssetFallbackImageV2(input.chainId, input.address),
      usesProviderLogo: false,
    });
}
