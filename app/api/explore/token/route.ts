import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import { readExploreModel } from "../../../../lib/onchain";
import type { ExplorePage } from "../../../../lib/onchain/types";
import {
  enrichExplorePageWithOfficialV4Subgraph,
} from "../../../../lib/onchain/uniswap-v4-subgraph";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "address") ||
    search.getAll("address").length !== 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const input = search.get("address")?.trim();
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum token address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const address = getAddress(input);
    const model = await readExploreModel();
    const token =
      model.tokens.find(
        (candidate) =>
          candidate.tokenAddress.toLowerCase() ===
          address.toLowerCase(),
      ) ?? null;

    if (model.status === "ready" && !token) {
      return NextResponse.json(
        {
          status: model.status,
          token: null,
          snapshot: model.snapshot,
        },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    let enrichedToken = token;
    if (token) {
      const tokenPage = {
        status: model.status,
        tokens: [token],
        page: 1,
        pageSize: 1,
        total: 1,
        totalPages: 1,
        sort: "market-cap",
        query: address,
        snapshot: model.snapshot,
        launcherFeesAccruedWei: model.launcherFeesAccruedWei,
        launcherFeesAccruedEth: model.launcherFeesAccruedEth,
      } satisfies ExplorePage;
      const enriched =
        await enrichExplorePageWithOfficialV4Subgraph(tokenPage);
      const enrichedCandidate = enriched.tokens.find(
        (candidate) =>
          candidate.id === token.id &&
          candidate.tokenAddress.toLowerCase() ===
            token.tokenAddress.toLowerCase() &&
          candidate.hookAddress.toLowerCase() ===
            token.hookAddress.toLowerCase() &&
          candidate.poolId.toLowerCase() === token.poolId.toLowerCase(),
      );
      enrichedToken = enrichedCandidate
        ? {
            ...token,
            ...(enrichedCandidate.indexedMarketCapEth === undefined
              ? {}
              : {
                  indexedMarketCapEth:
                    enrichedCandidate.indexedMarketCapEth,
                }),
            ...(enrichedCandidate.indexedMarketCapEthWei === undefined
              ? {}
              : {
                  indexedMarketCapEthWei:
                    enrichedCandidate.indexedMarketCapEthWei,
                }),
            ...(enrichedCandidate.indexedMarketCapUsdWad === undefined
              ? {}
              : {
                  indexedMarketCapUsdWad:
                    enrichedCandidate.indexedMarketCapUsdWad,
                }),
            ...(enrichedCandidate.indexedValuationBlockNumber ===
            undefined
              ? {}
              : {
                  indexedValuationBlockNumber:
                    enrichedCandidate.indexedValuationBlockNumber,
                }),
            ...(enrichedCandidate.uniswapV4Pool === undefined
              ? {}
              : {
                  uniswapV4Pool: enrichedCandidate.uniswapV4Pool,
                }),
          }
        : token;
    }

    return NextResponse.json(
      {
        status: model.status,
        token: enrichedToken,
        snapshot: model.snapshot,
      },
      {
        headers: {
          "Cache-Control":
            model.status === "ready"
              ? "public, max-age=0, s-maxage=15, stale-while-revalidate=30"
              : "public, max-age=0, s-maxage=60",
        },
      },
    );
  } catch (error) {
    console.error("Token detail onchain read failed", error);
    return NextResponse.json(
      { error: "Onchain token data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
