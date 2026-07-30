import { getAddress, isAddress } from "viem";
import { NextResponse } from "next/server";

import {
  buildIndexerFeed,
  findIndexerToken,
  getPublicOnchainDeployment,
  readExploreModel,
} from "../../../../../lib/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const publicHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control":
    "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
};

export async function GET(request: Request) {
  const address = new URL(request.url).searchParams.get("address");

  if (address && !isAddress(address)) {
    return NextResponse.json(
      { error: "Invalid token address" },
      {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
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
          {
            status: 404,
            headers: publicHeaders,
          },
        );
      }

      return NextResponse.json(token, {
        headers: publicHeaders,
      });
    }

    const feed = buildIndexerFeed(model, deployment.chainId);

    return NextResponse.json(feed, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control":
          model.status === "ready"
            ? publicHeaders["Cache-Control"]
            : "public, max-age=0, s-maxage=60",
      },
    });
  } catch (error) {
    console.error("Public indexer feed failed", error);
    return NextResponse.json(
      { error: "Indexer data is temporarily unavailable" },
      {
        status: 503,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
