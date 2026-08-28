import type { Metadata } from "next";
import { getAddress, isAddress } from "viem";

import {
  characterLength,
  hasUnsafeDisplayCharacters,
  isValidTokenSymbol,
  MAX_TOKEN_DESCRIPTION_BYTES,
  MAX_TOKEN_NAME_BYTES,
  MAX_TOKEN_NAME_CHARACTERS,
  MAX_TOKEN_SYMBOL_BYTES,
  MAX_TOKEN_SYMBOL_CHARACTERS,
  utf8ByteLength,
} from "./metadata-policy";
import { safePublicImageUrl } from "./safe-public-image-url";

const SITE_ORIGIN = "https://programmable.market";
const SITE_DESCRIPTION = "Shape what assets can do";
const FALLBACK_SOCIAL_IMAGE =
  `${SITE_ORIGIN}/og/programmable-landing-preview-v2-1200x630.jpg`;
const FALLBACK_SOCIAL_ALT =
  "Programmable and Shape what assets can do over a vivid floral night garden";
const BIDI_OVERRIDE_CHARACTERS = /[\u202a-\u202e\u2066-\u2069]/u;

type TokenDetailProjectionResponse = Readonly<{
  status: number;
  body: unknown;
}>;

type ProjectedTokenMetadata = Readonly<{
  address: `0x${string}`;
  name: string;
  symbol: string | null;
  description: string;
  imageUrl: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDisplayText(
  value: unknown,
  maximumBytes: number,
  maximumCharacters?: number,
) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (
    value.trim() !== value ||
    value.normalize("NFC") !== value ||
    hasUnsafeDisplayCharacters(value) ||
    BIDI_OVERRIDE_CHARACTERS.test(value) ||
    utf8ByteLength(value) > maximumBytes ||
    (maximumCharacters !== undefined &&
      characterLength(value) > maximumCharacters)
  ) {
    return null;
  }
  return value;
}

function absolutePublicImageUrl(value: unknown) {
  const safeValue = safePublicImageUrl(value);
  if (!safeValue) return null;
  try {
    const url = new URL(safeValue, SITE_ORIGIN);
    if (safeValue.startsWith("/")) {
      return url.origin === SITE_ORIGIN ? url.toString() : null;
    }
    if (url.origin === SITE_ORIGIN) return url.toString();

    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      hostname === "" ||
      hostname === "localhost" ||
      hostname === "localhost." ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".localhost.") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".local.") ||
      hostname.endsWith(".") ||
      hostname.includes(":") ||
      /^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname) ||
      !/^[a-z0-9.-]+$/u.test(hostname) ||
      !hostname.includes(".") ||
      url.hash !== ""
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function fallbackTokenCanonical(requestedAddress?: string) {
  if (!requestedAddress || !isAddress(requestedAddress)) return SITE_ORIGIN;
  return `${SITE_ORIGIN}/token/${getAddress(requestedAddress)}`;
}

function shouldNoIndexFallback(
  requestedAddress: string,
  response: TokenDetailProjectionResponse,
) {
  return !isAddress(requestedAddress) ||
    response.status === 400 ||
    response.status === 404 ||
    response.status === 410;
}

function projectedTokenMetadata(
  requestedAddress: string,
  response: TokenDetailProjectionResponse,
): ProjectedTokenMetadata | null {
  if (
    response.status < 200 ||
    response.status >= 300 ||
    !isAddress(requestedAddress) ||
    !isRecord(response.body) ||
    response.body.status !== "ready"
  ) {
    return null;
  }

  const token = isRecord(response.body.token) ? response.body.token : null;
  const customProject = isRecord(response.body.customProject)
    ? response.body.customProject
    : null;
  if ((token === null) === (customProject === null)) return null;
  const entity = token ?? customProject;
  if (entity === null) return null;

  if (
    typeof entity.tokenAddress !== "string" ||
    !isAddress(entity.tokenAddress) ||
    getAddress(entity.tokenAddress).toLowerCase() !==
      getAddress(requestedAddress).toLowerCase()
  ) {
    return null;
  }

  const name = safeDisplayText(
    entity.name,
    MAX_TOKEN_NAME_BYTES,
    MAX_TOKEN_NAME_CHARACTERS,
  );
  if (!name) return null;

  const symbol = entity.symbol === undefined || entity.symbol === null
    ? null
    : safeDisplayText(
        entity.symbol,
        MAX_TOKEN_SYMBOL_BYTES,
        MAX_TOKEN_SYMBOL_CHARACTERS,
      );
  if (entity.symbol !== undefined && entity.symbol !== null && !symbol) {
    return null;
  }
  if (symbol && !isValidTokenSymbol(symbol)) return null;

  const description = safeDisplayText(
    entity.description,
    MAX_TOKEN_DESCRIPTION_BYTES,
  );
  const symbolLabel = symbol
    ? symbol.startsWith("$") ? symbol : `$${symbol}`
    : null;

  return {
    address: getAddress(entity.tokenAddress),
    name,
    symbol,
    description:
      description ?? `Explore ${name}${symbolLabel ? ` (${symbolLabel})` : ""} on Programmable.`,
    imageUrl:
      absolutePublicImageUrl(entity.imageUrl) ?? FALLBACK_SOCIAL_IMAGE,
  };
}

export function genericTokenDetailMetadata(
  requestedAddress?: string,
  noIndex = false,
): Metadata {
  const canonical = fallbackTokenCanonical(requestedAddress);
  const metadata: Metadata = {
    title: "Programmable",
    description: SITE_DESCRIPTION,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: "Programmable",
      title: "Programmable",
      description: SITE_DESCRIPTION,
      images: [{ url: FALLBACK_SOCIAL_IMAGE, alt: FALLBACK_SOCIAL_ALT }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Programmable",
      description: SITE_DESCRIPTION,
      creator: "@0xprogrammable",
      images: [{ url: FALLBACK_SOCIAL_IMAGE, alt: FALLBACK_SOCIAL_ALT }],
    },
  };
  if (noIndex) metadata.robots = { index: false, follow: false };
  return metadata;
}

export function tokenDetailMetadataFromProjection(
  requestedAddress: string,
  response: TokenDetailProjectionResponse,
): Metadata {
  const projected = projectedTokenMetadata(requestedAddress, response);
  if (!projected) {
    return genericTokenDetailMetadata(
      requestedAddress,
      shouldNoIndexFallback(requestedAddress, response),
    );
  }

  const symbolLabel = projected.symbol
    ? projected.symbol.startsWith("$")
      ? projected.symbol
      : `$${projected.symbol}`
    : null;
  const identityLabel = symbolLabel
    ? `${projected.name} (${symbolLabel})`
    : projected.name;
  const title = `${identityLabel} | Programmable`;
  const canonical = `${SITE_ORIGIN}/token/${projected.address}`;
  const imageAlt = `${projected.name} artwork`;

  return {
    title,
    description: projected.description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      url: canonical,
      siteName: "Programmable",
      title,
      description: projected.description,
      images: [{ url: projected.imageUrl, alt: imageAlt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: projected.description,
      creator: "@0xprogrammable",
      images: [{ url: projected.imageUrl, alt: imageAlt }],
    },
  };
}
