import { hexToBytes, type Hex } from "viem";

import {
  MAX_METADATA_URL_BYTES,
  MAX_SOCIAL_EXTRA_DATA_BYTES,
  MAX_SOCIAL_URL_BYTES,
  utf8ByteLength,
} from "../metadata-policy";
import type { TokenLink } from "../tokens";

type SocialMetadataV1 = {
  v: 1;
  x?: string;
  telegram?: string;
};

function parseHttpsUrl(
  value: unknown,
  maximumBytes = MAX_METADATA_URL_BYTES,
) {
  if (
    typeof value !== "string" ||
    utf8ByteLength(value) > maximumBytes
  ) {
    return null;
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function sanitizeWebsiteUrl(value: unknown) {
  return parseHttpsUrl(value)?.toString() ?? null;
}

export function sanitizeImageUrl(value: unknown) {
  return parseHttpsUrl(value)?.toString() ?? null;
}

function socialLink(kind: "x" | "telegram", value: unknown): TokenLink | null {
  const parsed = parseHttpsUrl(value, MAX_SOCIAL_URL_BYTES);
  if (!parsed) return null;

  const hostname = parsed.hostname.toLowerCase();
  const allowed =
    kind === "x"
      ? hostname === "x.com" ||
        hostname === "www.x.com" ||
        hostname === "twitter.com" ||
        hostname === "www.twitter.com"
      : hostname === "t.me" ||
        hostname === "www.t.me" ||
        hostname === "telegram.me" ||
        hostname === "www.telegram.me";
  if (!allowed || parsed.pathname === "/") return null;

  return { kind, url: parsed.toString() };
}

export function decodeSocialMetadata(extraData: Hex): SocialMetadataV1 | null {
  if (extraData === "0x") return null;

  let bytes: Uint8Array;
  try {
    bytes = hexToBytes(extraData);
  } catch {
    return null;
  }
  if (bytes.byteLength > MAX_SOCIAL_EXTRA_DATA_BYTES) return null;

  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const candidate: unknown = JSON.parse(decoded);
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Array.isArray(candidate) ||
      (candidate as { v?: unknown }).v !== 1
    ) {
      return null;
    }

    const value = candidate as Record<string, unknown>;
    if (
      (value.x !== undefined && typeof value.x !== "string") ||
      (value.telegram !== undefined &&
        typeof value.telegram !== "string")
    ) {
      return null;
    }
    return {
      v: 1,
      ...(typeof value.x === "string" ? { x: value.x } : {}),
      ...(typeof value.telegram === "string"
        ? { telegram: value.telegram }
        : {}),
    };
  } catch {
    return null;
  }
}

export function buildTokenLinks(website: unknown, extraData: Hex) {
  const links: TokenLink[] = [];
  const safeWebsite = sanitizeWebsiteUrl(website);
  if (safeWebsite) links.push({ kind: "website", url: safeWebsite });

  const social = decodeSocialMetadata(extraData);
  if (social) {
    const x = socialLink("x", social.x);
    const telegram = socialLink("telegram", social.telegram);
    if (x) links.push(x);
    if (telegram) links.push(telegram);
  }
  return links;
}
