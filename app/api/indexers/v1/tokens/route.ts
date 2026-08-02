import { getAddress, isAddress } from "viem";
import { NextResponse } from "next/server";

import {
  buildIndexerFeed,
  findIndexerToken,
  getPublicOnchainDeployment,
  readExploreModel,
} from "../../../../../lib/onchain";
import { indexedPublicIndexerFeedEnabled } from "../../../../../lib/data-pipeline/route-activation.server";
import { readIndexedFeedSnapshot } from "../read-indexed-feed.server";
import {
  indexedFeedHeaders,
  INDEXER_NO_STORE_HEADERS,
} from "../response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LEGACY_PUBLIC_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Cache-Control":
    "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
});

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
    if (!indexedPublicIndexerFeedEnabled()) {
      const deployment = getPublicOnchainDeployment();
      const model = await readExploreModel(deployment);
      if (address) {
        const token = findIndexerToken(
          model,
          deployment.chainId,
          getAddress(address),
        );
        if (!token) {
          return NextResponse.json(
            { error: "Programmable token not found" },
            { status: 404, headers: LEGACY_PUBLIC_HEADERS },
          );
        }
        return NextResponse.json(token, {
          headers: LEGACY_PUBLIC_HEADERS,
        });
      }
      return NextResponse.json(
        buildIndexerFeed(model, deployment.chainId),
        {
          headers: {
            ...LEGACY_PUBLIC_HEADERS,
            "Cache-Control":
              model.status === "ready"
                ? LEGACY_PUBLIC_HEADERS["Cache-Control"]
                : "public, max-age=0, s-maxage=60",
          },
        },
      );
    }

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
