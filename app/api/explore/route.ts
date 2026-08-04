import { NextRequest, NextResponse } from "next/server";

import {
  enrichTokensWithAlchemyPrices,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../lib/alchemy/explore.server";
import {
  filterAndSortTokens,
  paginateExplore,
  parseExploreSort,
  visibleExploreTokens,
} from "../../../lib/onchain/query";
import type { ExplorePage, ExploreReadModel } from "../../../lib/onchain/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPLORE_QUERY_PARAMETERS = new Set([
  "limit",
  "page",
  "q",
  "socials",
  "sort",
]);
const TOP_MARKET_CAP_LIMIT = 20;

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
  if (!value || !/^\d+$/u.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function positiveInteger(value: number, fallback: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(value, maximum);
}

function topThenNewestPage(
  model: ExploreReadModel,
  input: Readonly<{ page: number; pageSize: number }>,
): ExplorePage {
  const visible = visibleExploreTokens(model);
  const top = filterAndSortTokens(
    [...visible],
    "",
    "market-cap",
  ).slice(0, TOP_MARKET_CAP_LIMIT);
  const topAddresses = new Set(
    top.map((token) => token.tokenAddress.toLowerCase()),
  );
  const newest = filterAndSortTokens(
    [...visible],
    "",
    "newest",
  ).filter(
    (token) => !topAddresses.has(token.tokenAddress.toLowerCase()),
  );
  const ordered = [...top, ...newest];
  const pageSize = positiveInteger(input.pageSize, 9, 100);
  const totalPages = Math.ceil(ordered.length / pageSize);
  const requestedPage = positiveInteger(
    input.page,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  return {
    status: model.status,
    tokens: ordered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: ordered.length,
    totalPages,
    sort: "market-cap",
    query: "",
    snapshot: model.snapshot,
    launchDiscoverySnapshot:
      model.status === "ready" ? model.launchDiscoverySnapshot : undefined,
    launcherFeesAccruedWei: model.launcherFeesAccruedWei,
    launcherFeesAccruedEth: model.launcherFeesAccruedEth,
  };
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (!hasCanonicalQueryShape(search)) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const socials = search.get("socials");
  if (socials !== null && socials !== "yes" && socials !== "no") {
    return NextResponse.json(
      { error: "Unsupported socials filter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const options = {
      query: search.get("q")?.trim() ?? "",
      sort: parseExploreSort(search.get("sort")),
      page: integerQuery(search.get("page"), 1),
      pageSize: integerQuery(search.get("limit"), 9),
      socials,
    } as const;
    const model = await readAlchemyExploreModel();
    const pricedModel = {
      ...model,
      tokens: await enrichTokensWithAlchemyPrices(model.tokens),
    } satisfies ExploreReadModel;
    const useTopMarketCapView =
      options.sort === "market-cap" &&
      options.query.length === 0 &&
      options.socials === null;
    const page = useTopMarketCapView
      ? topThenNewestPage(pricedModel, options)
      : paginateExplore(pricedModel, options);

    return NextResponse.json(
      page,
      {
        headers: {
          "Cache-Control":
            page.status === "ready"
              ? "public, max-age=0, s-maxage=2, stale-while-revalidate=5"
              : "public, max-age=0, s-maxage=30",
          "X-Programmable-Price-Source": "alchemy",
          "X-Programmable-Launch-Source": "alchemy",
          "X-Programmable-Read-Source": "blob",
          "X-Programmable-Rpc-Provider": "alchemy",
        },
      },
    );
  } catch (error) {
    console.error("Alchemy Explore read failed", safeAlchemyError(error));
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
