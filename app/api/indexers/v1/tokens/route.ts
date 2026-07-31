import { getAddress, isAddress } from "viem";
import { NextResponse } from "next/server";

import {
  buildIndexerFeed,
  findIndexerToken,
} from "../../../../../lib/onchain";
import { readIndexedFeedSnapshot } from "../read-indexed-feed.server";
import {
  indexedFeedHeaders,
  INDEXER_NO_STORE_HEADERS,
} from "../response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");

  if (address && !isAddress(address)) {
    return NextResponse.json(
      { error: "Invalid token address" },
      {
        status: 400,
        headers: INDEXER_NO_STORE_HEADERS,
      },
    );
  }

  try {
    const snapshot = await readIndexedFeedSnapshot();

    if (address) {
      const token = findIndexerToken(
        snapshot.model,
        snapshot.chainId,
        getAddress(address),
      );

      if (!token) {
        return NextResponse.json(
          { error: "Programmable token not found" },
          {
            status: 404,
            headers: indexedFeedHeaders(snapshot),
          },
        );
      }

      return NextResponse.json(token, {
        headers: indexedFeedHeaders(snapshot),
      });
    }

    const feed = buildIndexerFeed(snapshot.model, snapshot.chainId);

    return NextResponse.json(feed, {
      headers: indexedFeedHeaders(snapshot),
    });
  } catch (error) {
    console.error("Public indexer feed failed", error);
    return NextResponse.json(
      { error: "Indexer data is temporarily unavailable" },
      {
        status: 503,
        headers: INDEXER_NO_STORE_HEADERS,
      },
    );
  }
}
