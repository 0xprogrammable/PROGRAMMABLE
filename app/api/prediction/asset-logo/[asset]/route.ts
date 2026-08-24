import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { isPredictionV2ReleaseEnabled } from
  "@/lib/prediction-v2/release-binding.server";
import { verifyTokenImageWebpV1 } from
  "@/lib/server/token-image-webp-v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

const DEXSCREENER_IMAGE_ORIGIN = "https://cdn.dexscreener.com";
const ASSET_ID_PATTERN = /^[0-9a-f]{64}$/u;
const MAXIMUM_SOURCE_BYTES = 4_000_000;
const MAXIMUM_SOURCE_PIXELS = 16_000_000;
const FETCH_TIMEOUT_MS = 5_000;
export const PREDICTION_ASSET_LOGO_MAXIMUM_CONCURRENT_TRANSFORMS_V2 = 2;
export const PREDICTION_ASSET_LOGO_NEGATIVE_CACHE_TTL_MS_V2 = 5_000;
export const PREDICTION_ASSET_LOGO_MAXIMUM_NEGATIVE_CACHE_ENTRIES_V2 = 256;
export const PREDICTION_ASSET_LOGO_RUNTIME_CONTROL_SCOPE_V2 =
  "single-runtime-only" as const;
export const PREDICTION_ASSET_LOGO_SHARED_LIMITS_REQUIRED_FOR_ACTIVATION_V2 =
  true as const;
export const PREDICTION_ASSET_LOGO_KNOWN_ASSET_AUTHORIZATION_REQUIRED_FOR_ACTIVATION_V2 =
  true as const;
const ACCEPTED_SOURCE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type PredictionAssetLogoRouteDependenciesV2 = Readonly<{
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  nowMs?: () => number;
  maximumConcurrentTransforms?: number;
  negativeCacheTtlMs?: number;
  maximumNegativeCacheEntries?: number;
}>;

function errorResponse(status: number, retryAfterSeconds?: number) {
  return NextResponse.json(
    { error: "Asset image is unavailable" },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(retryAfterSeconds === undefined
          ? {}
          : { "Retry-After": String(retryAfterSeconds) }),
      },
    },
  );
}

export function createPredictionAssetLogoHandlerV2(
  dependencies: PredictionAssetLogoRouteDependenciesV2 = {},
) {
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const nowMs = dependencies.nowMs ?? Date.now;
  const timeoutMs = boundedInteger(
    dependencies.timeoutMs,
    FETCH_TIMEOUT_MS,
    1,
    30_000,
    "timeoutMs",
  );
  const maximumConcurrentTransforms = boundedInteger(
    dependencies.maximumConcurrentTransforms,
    PREDICTION_ASSET_LOGO_MAXIMUM_CONCURRENT_TRANSFORMS_V2,
    1,
    16,
    "maximumConcurrentTransforms",
  );
  const negativeCacheTtlMs = boundedInteger(
    dependencies.negativeCacheTtlMs,
    PREDICTION_ASSET_LOGO_NEGATIVE_CACHE_TTL_MS_V2,
    1,
    60_000,
    "negativeCacheTtlMs",
  );
  const maximumNegativeCacheEntries = boundedInteger(
    dependencies.maximumNegativeCacheEntries,
    PREDICTION_ASSET_LOGO_MAXIMUM_NEGATIVE_CACHE_ENTRIES_V2,
    1,
    2_048,
    "maximumNegativeCacheEntries",
  );
  const negativeCache = new Map<string, number>();
  let activeTransforms = 0;

  return async function predictionAssetLogo(
    asset: string,
    requestSignal?: AbortSignal,
  ): Promise<Response> {
    if (!ASSET_ID_PATTERN.test(asset)) return errorResponse(400);
    if (requestSignal?.aborted) return errorResponse(502);
    if (hasFreshNegativeEntry(negativeCache, asset, checkedNow(nowMs))) {
      return errorResponse(502);
    }
    // This zero-queue bulkhead bounds one Node runtime only. It deliberately
    // does not claim edge, distributed or per-client abuse protection.
    if (activeTransforms >= maximumConcurrentTransforms) {
      return errorResponse(503, 1);
    }
    activeTransforms += 1;

    const source = `${DEXSCREENER_IMAGE_ORIGIN}/cms/images/${asset}` +
      "?width=1000&height=1000&quality=95&format=auto";
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = requestSignal
      ? AbortSignal.any([requestSignal, timeout])
      : timeout;

    const unavailable = () => {
      if (!requestSignal?.aborted) {
        const failureAtMs = checkedNow(nowMs);
        writeBoundedNegativeCache(
          negativeCache,
          asset,
          failureAtMs + negativeCacheTtlMs,
          maximumNegativeCacheEntries,
          failureAtMs,
        );
      }
      return errorResponse(502);
    };

    try {
      if (hasFreshNegativeEntry(negativeCache, asset, checkedNow(nowMs))) {
        return errorResponse(502);
      }
      // The asset identifier cannot select a host or path prefix. Redirects
      // remain disabled so this can never become an arbitrary URL proxy.
      const upstream = await fetchImpl(source, {
        cache: "force-cache",
        credentials: "omit",
        headers: { Accept: "image/webp,image/png,image/jpeg" },
        method: "GET",
        redirect: "error",
        signal,
      });
      const contentType = upstream.headers.get("content-type")
        ?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (
        !upstream.ok ||
        upstream.redirected ||
        !ACCEPTED_SOURCE_TYPES.has(contentType)
      ) return unavailable();

      const bytes = await readBoundedImageBody(upstream);
      const image = sharp(bytes, {
        animated: false,
        failOn: "error",
        limitInputPixels: MAXIMUM_SOURCE_PIXELS,
        sequentialRead: true,
      });
      const metadata = await image.metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > MAXIMUM_SOURCE_PIXELS ||
        (metadata.pages ?? 1) !== 1 ||
        !["jpeg", "png", "webp"].includes(metadata.format ?? "")
      ) return unavailable();

      const normalized = await image
        .rotate()
        .resize(1_000, 1_000, { fit: "cover", position: "centre" })
        .webp({ effort: 4, quality: 84 })
        .toBuffer();
      const verified = await verifyTokenImageWebpV1(normalized);
      if (signal.aborted) return unavailable();
      const digest = createHash("sha256").update(verified.bytes).digest("hex");

      return new Response(Uint8Array.from(verified.bytes).buffer, {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
          "Content-Length": String(verified.bytes.byteLength),
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Content-Type": "image/webp",
          ETag: `\"sha256-${digest}\"`,
          "X-Content-Type-Options": "nosniff",
          "X-Programmable-Image-Source": "dexscreener",
        },
      });
    } catch {
      return unavailable();
    } finally {
      activeTransforms -= 1;
    }
  };
}

function hasFreshNegativeEntry(
  cache: Map<string, number>,
  asset: string,
  nowMs: number,
) {
  const expiresAtMs = cache.get(asset);
  if (expiresAtMs === undefined) return false;
  if (expiresAtMs <= nowMs) {
    cache.delete(asset);
    return false;
  }
  return true;
}

function writeBoundedNegativeCache(
  cache: Map<string, number>,
  asset: string,
  expiresAtMs: number,
  maximumEntries: number,
  nowMs: number,
) {
  for (const [candidate, expiry] of cache) {
    if (expiry <= nowMs) cache.delete(candidate);
  }
  cache.delete(asset);
  while (cache.size >= maximumEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(asset, expiresAtMs);
}

function checkedNow(nowMs: () => number) {
  const value = nowMs();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("nowMs must return a non-negative safe integer");
  }
  return value;
}

function boundedInteger(
  candidate: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  const value = candidate ?? fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

async function readBoundedImageBody(response: Response) {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declared) ||
      BigInt(declared) > BigInt(MAXIMUM_SOURCE_BYTES))
  ) throw new TypeError("asset image is too large");
  if (!response.body) throw new TypeError("asset image is empty");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAXIMUM_SOURCE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new TypeError("asset image is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) throw new TypeError("asset image is empty");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

const handler = createPredictionAssetLogoHandlerV2();

export async function GET(
  request: Request,
  context: { params: Promise<{ asset: string }> },
) {
  try {
    if (!isPredictionV2ReleaseEnabled()) return errorResponse(404);
  } catch {
    return errorResponse(404);
  }
  const { asset } = await context.params;
  return handler(asset, request.signal);
}
