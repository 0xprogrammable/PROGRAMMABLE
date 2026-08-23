import { NextRequest, NextResponse } from "next/server";

import { getPredictionV2ReleaseBinding } from
  "@/lib/prediction-v2/release-binding.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 5;

function responseHeaders(cacheSeconds: number | null) {
  return {
    "Cache-Control": cacheSeconds === null
      ? "no-store"
      : `public, max-age=0, s-maxage=${cacheSeconds}, must-revalidate`,
    "X-Content-Type-Options": "nosniff",
    "X-Programmable-Market-Provider": "coingecko-keyless-public",
    "X-Programmable-Read-Purpose":
      "display-only-not-eligibility-or-settlement",
    "X-Programmable-Provider-Service-Level": "best-effort-no-sla",
  };
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

export async function GET(request: NextRequest) {
  if (getPredictionV2ReleaseBinding().status === "disabled") {
    return unavailableRelease();
  }

  if ([...request.nextUrl.searchParams.keys()].length !== 0) {
    return NextResponse.json(
      { error: "Preset discovery does not accept query parameters" },
      { status: 400, headers: responseHeaders(null) },
    );
  }

  const { readPredictionPresetDiscoveryV2 } = await import(
    "@/lib/market-data/prediction-preset-discovery-v2.server"
  );
  const result = await readPredictionPresetDiscoveryV2({
    signal: request.signal,
  });
  if (result.status === "available") {
    const remainingCacheSeconds = Math.floor(
      (new Date(result.cacheExpiresAt).getTime() - Date.now()) / 1_000,
    );
    return NextResponse.json(result, {
      headers: responseHeaders(
        Number.isFinite(remainingCacheSeconds) && remainingCacheSeconds > 0
          ? Math.min(60, remainingCacheSeconds)
          : null,
      ),
    });
  }

  return NextResponse.json(result, {
    status: 503,
    headers: {
      ...responseHeaders(null),
      "Retry-After": result.reason === "rate-limited" ? "60" : "5",
    },
  });
}
