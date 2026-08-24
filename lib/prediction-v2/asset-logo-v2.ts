const DEXSCREENER_IMAGE_HOST_V2 = "cdn.dexscreener.com";
const DEXSCREENER_IMAGE_PATH_V2 = /^\/cms\/images\/([0-9a-f]{64})$/u;

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
  logoUrl?: string | null;
}>): PredictionAssetCardImageV2 {
  const assetId = predictionDexscreenerLogoAssetIdV2(input.logoUrl);
  return assetId
    ? Object.freeze({
      source: `/api/prediction/asset-logo/${assetId}`,
      usesProviderLogo: true,
    })
    : Object.freeze({
      source: predictionAssetFallbackImageV2(input.chainId, input.address),
      usesProviderLogo: false,
    });
}
