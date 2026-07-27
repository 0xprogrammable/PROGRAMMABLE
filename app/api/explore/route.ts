import { NextRequest, NextResponse } from "next/server";

import {
  paginateExplore,
  parseExploreSort,
  readExploreModel,
} from "../../../lib/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function integerQuery(value: string | null, fallback: number) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;

  try {
    const model = await readExploreModel();
    const response = paginateExplore(model, {
      query: search.get("q") ?? "",
      sort: parseExploreSort(search.get("sort")),
      page: integerQuery(search.get("page"), 1),
      pageSize: integerQuery(search.get("limit"), 6),
    });

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
