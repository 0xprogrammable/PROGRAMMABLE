import { NextRequest, NextResponse } from "next/server";

import {
  assertPredictionV2VerifiedEnabledPublicReleaseV2,
  getPredictionV2PublicReleaseV2,
} from "@/lib/prediction-v2/public-release-v2.server";
import {
  isCanonicalPredictionAssetLogoCapabilityV2,
  predictionDexscreenerLogoAssetIdV2,
} from
  "@/lib/prediction-v2/asset-logo-v2";
import type {
  PredictionAssetAutoDiscoveryCandidateV2,
  PredictionAssetAutoDiscoveryResultV2,
} from "@/lib/market-data/prediction-asset-auto-discovery-v2.server";
import {
  assertPredictionV2ProviderRouteReadinessV2,
  getPredictionV2ProviderRouteReadinessV2,
} from
  "@/lib/market-data/prediction-v2-provider-route-readiness.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 5;

const QUERY_PARAMETERS = new Set(["locator"]);
const AVAILABLE_CACHE_CONTROL =
  "public, max-age=0, s-maxage=15, stale-while-revalidate=30";

function responseHeaders(cacheable: boolean) {
  return {
    "Cache-Control": cacheable ? AVAILABLE_CACHE_CONTROL : "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function discoveryResultHeaders(
  cacheable: boolean,
  enrichmentSource: unknown,
) {
  return {
    ...responseHeaders(cacheable),
    "X-Programmable-Identity-Source": "onchain-rpc",
    "X-Programmable-Read-Purpose": "informational-only",
    ...(enrichmentSource === "dexscreener"
      ? { "X-Programmable-Market-Provider": "dexscreener" }
      : {}),
  };
}

function invalidQuery() {
  return NextResponse.json(
    { error: "Enter one exact token address" },
    { status: 400, headers: responseHeaders(false) },
  );
}

function unavailableRelease() {
  return NextResponse.json(
    { error: "Not found" },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function logoAssetIdForCandidate(
  candidate: unknown,
) {
  if (!isPlainRecord(candidate)) return null;
  const provenance = isPlainRecord(candidate.provenance)
    ? candidate.provenance
    : null;
  const enrichment = isPlainRecord(provenance?.enrichment)
    ? provenance.enrichment
    : null;
  const links = isPlainRecord(candidate.links) ? candidate.links : null;
  return enrichment?.source === "dexscreener" && links
    ? predictionDexscreenerLogoAssetIdV2(
      typeof links.imageUrl === "string" ? links.imageUrl : null,
    )
    : null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

async function attachAssetLogoCapabilities(
  result: PredictionAssetAutoDiscoveryResultV2,
) {
  const candidates: readonly unknown[] = result.status === "unique"
    ? [result.candidate]
    : result.status === "ambiguous" || result.status === "inconclusive"
      ? Array.isArray(result.candidates) ? result.candidates : []
      : [];
  const hasProviderLogo = candidates.some((candidate) =>
    logoAssetIdForCandidate(candidate) !== null
  );
  let issue: ((assetId: string) => string | null) | null = null;
  if (hasProviderLogo) {
    try {
      ({ createConfiguredPredictionAssetLogoCapabilityV2: issue } = await import(
        "@/lib/market-data/prediction-asset-logo-capability-v2.server"
      ));
    } catch {
      // Identity and market data remain available when optional logo transport
      // configuration is absent. The client will use its bundled fallback.
    }
  }

  const decorate = (candidate: PredictionAssetAutoDiscoveryCandidateV2) => {
    const assetId = logoAssetIdForCandidate(candidate);
    let capability: unknown = null;
    try {
      capability = assetId && issue ? issue(assetId) : null;
    } catch {
      // Optional logo issuance must never hide an independently verified token.
    }
    return Object.freeze({
      ...candidate,
      // Provider image URLs are server-private enrichment. The browser receives
      // only an exact signed asset identifier and its transient capability.
      links: Object.freeze({
        websites: candidate.links?.websites ?? Object.freeze([]),
        socials: candidate.links?.socials ?? Object.freeze([]),
      }),
      logoProxy: assetId &&
          isCanonicalPredictionAssetLogoCapabilityV2(capability)
        ? Object.freeze({ assetId, capability })
        : null,
    });
  };

  if (result.status === "unique") {
    return Object.freeze({ ...result, candidate: decorate(result.candidate) });
  }
  if (result.status === "ambiguous" || result.status === "inconclusive") {
    if (!Array.isArray(result.candidates)) return result;
    return Object.freeze({
      ...result,
      candidates: Object.freeze(result.candidates.map(decorate)),
    });
  }
  return result;
}

export async function GET(request: NextRequest) {
  // Keep a disabled release entirely dark: do not inspect the query and do not
  // load or contact the external discovery provider before this check passes.
  try {
    const release = getPredictionV2PublicReleaseV2();
    if (release.status !== "enabled") return unavailableRelease();
    assertPredictionV2VerifiedEnabledPublicReleaseV2(release);
    const readiness = getPredictionV2ProviderRouteReadinessV2();
    assertPredictionV2ProviderRouteReadinessV2(readiness);
    if (!readiness.productionReady) return unavailableRelease();
  } catch {
    return unavailableRelease();
  }

  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => !QUERY_PARAMETERS.has(key)) ||
    search.getAll("locator").length !== 1
  ) {
    return invalidQuery();
  }
  const locator = search.get("locator")?.trim() ?? "";
  if (locator.length === 0 || locator.length > 128) return invalidQuery();

  const { readControlledPredictionAssetAutoDiscoveryV2 } = await import(
    "@/lib/market-data/prediction-asset-auto-discovery-request-control-v2.server"
  );
  const controlled = await readControlledPredictionAssetAutoDiscoveryV2(locator, {
    signal: request.signal,
  });
  if (controlled.status === "rate-limited") {
    return NextResponse.json(
      { error: "Too many token lookups. Try again shortly." },
      {
        status: 429,
        headers: {
          ...responseHeaders(false),
          "Retry-After": String(controlled.retryAfterSeconds),
        },
      },
    );
  }
  const result = await attachAssetLogoCapabilities(controlled.result);
  const status = result.status === "invalid"
    ? 400
    : result.status === "not-found"
      ? 404
      : result.status === "inconclusive"
        ? 503
        : 200;
  const cacheable = result.status === "unique" || result.status === "ambiguous";

  return NextResponse.json(result, {
    status,
    headers: {
      ...(result.status === "invalid"
        ? responseHeaders(false)
        : discoveryResultHeaders(cacheable, result.source)),
      ...(status === 503 ? { "Retry-After": "5" } : {}),
    },
  });
}
