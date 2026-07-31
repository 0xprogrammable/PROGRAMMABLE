import { NextResponse } from "next/server";

import { buildUniswapTokenList } from "../../../../../lib/onchain";
import { readIndexedFeedSnapshot } from "../read-indexed-feed.server";
import {
  indexedFeedHeaders,
  INDEXER_NO_STORE_HEADERS,
} from "../response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const snapshot = await readIndexedFeedSnapshot();
    if (snapshot.model.tokens.length === 0) {
      return NextResponse.json(
        {
          status: snapshot.model.status,
          error:
            "The token list will be available after the first verified launch",
        },
        {
          status: 503,
          headers: {
            ...indexedFeedHeaders(
              snapshot,
              "public, max-age=0, s-maxage=60",
            ),
            "Retry-After": "60",
          },
        },
      );
    }
    const tokenList = buildUniswapTokenList(
      snapshot.model,
      snapshot.chainId,
      new Date(snapshot.capturedAt),
    );

    return NextResponse.json(tokenList, {
      headers: indexedFeedHeaders(
        snapshot,
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      ),
    });
  } catch (error) {
    console.error("Public token list failed", error);
    return NextResponse.json(
      { error: "Token list is temporarily unavailable" },
      {
        status: 503,
        headers: INDEXER_NO_STORE_HEADERS,
      },
    );
  }
}
