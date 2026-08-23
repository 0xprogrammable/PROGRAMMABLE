import { NextRequest, NextResponse } from "next/server";

import { isPredictionSourceNetworkIdV2 } from
  "@/lib/prediction-market-assets-v2";
import { getPredictionV2ReleaseBinding } from
  "@/lib/prediction-v2/release-binding.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 5;

const QUERY_PARAMETERS = new Set(["network", "locator"]);
const AVAILABLE_CACHE_CONTROL =
  "public, max-age=0, s-maxage=15, stale-while-revalidate=30";

function responseHeaders(available: boolean) {
  return {
    "Cache-Control": available ? AVAILABLE_CACHE_CONTROL : "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Programmable-Market-Provider": "dexscreener",
    "X-Programmable-Read-Purpose": "informational-only",
  };
}

function invalidQuery() {
  return NextResponse.json(
    { error: "Choose one supported network and enter its exact token locator" },
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

export async function GET(request: NextRequest) {
  if (getPredictionV2ReleaseBinding().status === "disabled") {
    return unavailableRelease();
  }

  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => !QUERY_PARAMETERS.has(key)) ||
    search.getAll("network").length !== 1 ||
    search.getAll("locator").length !== 1
  ) {
    return invalidQuery();
  }

  const network = search.get("network") ?? "";
  const locator = search.get("locator")?.trim() ?? "";
  if (
    !isPredictionSourceNetworkIdV2(network) ||
    locator.length === 0 ||
    locator.length > 128
  ) {
    return invalidQuery();
  }

  const { readPredictionAssetDiscoveryV2 } = await import(
    "@/lib/market-data/prediction-asset-discovery-v2.server"
  );
  const result = await readPredictionAssetDiscoveryV2(
    { mode: "custom", sourceNetwork: network, assetLocator: locator },
    { signal: request.signal },
  );
  if (result.status === "available") {
    return NextResponse.json(result, {
      headers: responseHeaders(true),
    });
  }

  const status = result.reason === "invalid-selection"
    ? 400
    : result.reason === "not-found"
      ? 404
      : 503;
  return NextResponse.json(result, {
    status,
    headers: {
      ...responseHeaders(false),
      ...(status === 503 ? { "Retry-After": "5" } : {}),
    },
  });
}
