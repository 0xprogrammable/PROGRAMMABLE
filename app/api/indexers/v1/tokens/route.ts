import { getAddress, isAddress } from "viem";
import { NextResponse } from "next/server";

import {
  buildIndexerFeed,
  findIndexerToken,
} from "../../../../../lib/onchain/indexer-feed";
import {
  getAlchemyOnchainDeployment,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../../lib/alchemy/explore.server";
import {
  alchemyFeedHeaders,
  ALCHEMY_NO_STORE_HEADERS,
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
        headers: ALCHEMY_NO_STORE_HEADERS,
      },
    );
  }

  try {
    const deployment = getAlchemyOnchainDeployment();
    const model = await readAlchemyExploreModel();

    if (address) {
      const token = findIndexerToken(
        model,
        deployment.chainId,
        getAddress(address),
      );

      if (!token) {
        return NextResponse.json(
          { error: "Programmable token not found" },
          {
            status: 404,
            headers: alchemyFeedHeaders(),
          },
        );
      }

      return NextResponse.json(token, {
        headers: alchemyFeedHeaders(),
      });
    }

    const feed = buildIndexerFeed(model, deployment.chainId);

    return NextResponse.json(feed, {
      headers: alchemyFeedHeaders(
        model.status === "ready"
          ? undefined
          : "public, max-age=0, s-maxage=60",
      ),
    });
  } catch (error) {
    console.error(
      "Public Alchemy feed failed",
      safeAlchemyError(error),
    );
    return NextResponse.json(
      { error: "Indexer data is temporarily unavailable" },
      {
        status: 503,
        headers: ALCHEMY_NO_STORE_HEADERS,
      },
    );
  }
}
