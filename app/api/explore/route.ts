import { NextRequest, NextResponse } from "next/server";

import {
  paginateExplore,
  parseExploreSort,
  readExploreModel,
} from "../../../lib/onchain";
import { enrichExplorePageWithOfficialV4Subgraph } from "../../../lib/onchain/uniswap-v4-subgraph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPLORE_QUERY_PARAMETERS = new Set([
  "limit",
  "page",
  "q",
  "sort",
]);

function hasCanonicalQueryShape(search: URLSearchParams) {
  const seen = new Set<string>();
  for (const [key] of search) {
    if (!EXPLORE_QUERY_PARAMETERS.has(key) || seen.has(key)) {
      return false;
    }
    seen.add(key);
  }
  return true;
}

function integerQuery(value: string | null, fallback: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (!hasCanonicalQueryShape(search)) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const model = await readExploreModel();
    const response =
      await enrichExplorePageWithOfficialV4Subgraph(
        paginateExplore(model, {
          query: search.get("q") ?? "",
          sort: parseExploreSort(search.get("sort")),
          page: integerQuery(search.get("page"), 1),
          pageSize: integerQuery(search.get("limit"), 6),
        }),
      );

    return NextResponse.json(response, {
      headers: {
        "Cache-Control":
          response.status === "ready"
            ? "public, max-age=0, s-maxage=15, stale-while-revalidate=30"
            : "public, max-age=0, s-maxage=60",
      },
    });
  } catch (error) {
    console.error("Explore onchain read failed", error);
    return NextResponse.json(
      {
        error: "Onchain token data is temporarily unavailable",
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
