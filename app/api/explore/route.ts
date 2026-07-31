import { NextRequest, NextResponse } from "next/server";

import {
  paginateExplore,
  parseExploreSort,
  readExploreModel,
} from "../../../lib/onchain";
import {
  enrichExplorePageWithOfficialV4Subgraph,
  OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS,
} from "../../../lib/onchain/uniswap-v4-subgraph";
import type { ExplorePage } from "../../../lib/onchain/types";
import type { LauncherToken } from "../../../lib/tokens";
import {
  coordinatePublicRouteRead,
  PUBLIC_INDEXED_ROUTE_READS,
  PUBLIC_DISCOVERY_ROUTE_SCOPES,
  preparePublicRouteRequest,
  publicSnapshotCheckpoint,
} from "../../../lib/data-pipeline/public-route-readiness.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EXPLORE_QUERY_PARAMETERS = new Set(["limit", "page", "q", "sort"]);

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

function tokenIdentity(token: LauncherToken) {
  return [
    token.id,
    token.tokenAddress.toLowerCase(),
    token.hookAddress.toLowerCase(),
    token.poolId.toLowerCase(),
  ].join(":");
}

export async function GET(request: NextRequest) {
  const routeRequest = await preparePublicRouteRequest(
    request.nextUrl.searchParams,
    request.headers,
    "explore-list",
  );
  if (routeRequest.probeFailure) return routeRequest.probeFailure;
  const search = routeRequest.searchParams;
  if (!hasCanonicalQueryShape(search)) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const options = {
      query: search.get("q") ?? "",
      sort: parseExploreSort(search.get("sort")),
      page: integerQuery(search.get("page"), 1),
      pageSize: integerQuery(search.get("limit"), 6),
    } as const;
    return await coordinatePublicRouteRead({
      route: "explore-list",
      scope: PUBLIC_DISCOVERY_ROUTE_SCOPES,
      ...(routeRequest.releaseProbe
        ? { releaseProbe: routeRequest.releaseProbe }
        : {}),
      indexed: (transaction) =>
        PUBLIC_INDEXED_ROUTE_READS.explore(transaction, {
          chainId: 1,
          ...options,
        }),
      async legacy() {
        const model = await readExploreModel();
        const completeCandidate = paginateExplore(model, {
          ...options,
          page: 1,
          pageSize: OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS,
        });

        let response: ExplorePage;
        if (
          completeCandidate.total <=
          OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS
        ) {
          const enrichedCandidate =
            await enrichExplorePageWithOfficialV4Subgraph(
              completeCandidate,
            );
          const enrichedByIdentity = new Map(
            enrichedCandidate.tokens.map((token) => [
              tokenIdentity(token),
              token,
            ]),
          );
          response = paginateExplore(
            {
              ...model,
              tokens: model.tokens.map(
                (token) =>
                  enrichedByIdentity.get(tokenIdentity(token)) ?? token,
              ),
            },
            options,
          );
        } else {
          response = await enrichExplorePageWithOfficialV4Subgraph(
            paginateExplore(model, options),
          );
        }

        return {
          source: "rpc" as const,
          checkpoint: publicSnapshotCheckpoint(model.snapshot),
          response: NextResponse.json(response, {
            headers: {
              "Cache-Control":
                response.status === "ready"
                  ? "public, max-age=0, s-maxage=10, stale-while-revalidate=10"
                  : "public, max-age=0, s-maxage=60",
            },
          }),
        };
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
