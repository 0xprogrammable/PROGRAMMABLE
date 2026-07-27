import { NextResponse } from "next/server";

import {
  buildIndexerFeed,
  getOnchainDeployment,
  readExploreModel,
} from "../../../../../lib/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const deployment = getOnchainDeployment();
    const model = await readExploreModel(deployment);
    const feed = buildIndexerFeed(model, deployment.chainId);

    return NextResponse.json(feed, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control":
          model.status === "ready"
            ? "public, max-age=0, s-maxage=15, stale-while-revalidate=30"
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
