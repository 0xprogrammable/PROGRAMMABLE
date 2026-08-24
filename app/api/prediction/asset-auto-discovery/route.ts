import { NextRequest, NextResponse } from "next/server";

import { isPredictionV2ReleaseEnabled } from
  "@/lib/prediction-v2/release-binding.server";

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

export async function GET(request: NextRequest) {
  // Keep a disabled release entirely dark: do not inspect the query and do not
  // load or contact the external discovery provider before this check passes.
  let releaseEnabled = false;
  try {
    releaseEnabled = isPredictionV2ReleaseEnabled();
  } catch {
    return unavailableRelease();
  }
  if (!releaseEnabled) {
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
  const result = controlled.result;
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
