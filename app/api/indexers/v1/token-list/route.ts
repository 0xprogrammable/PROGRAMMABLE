import { NextResponse } from "next/server";

import {
  buildUniswapTokenList,
  getPublicOnchainDeployment,
  readExploreModel,
} from "../../../../../lib/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const deployment = getPublicOnchainDeployment();
    const model = await readExploreModel(deployment);
    if (model.tokens.length === 0) {
      return NextResponse.json(
        {
          status: model.status,
          error:
            "The token list will be available after the first verified launch",
        },
        {
          status: 503,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=0, s-maxage=60",
            "Retry-After": "60",
          },
        },
      );
    }
    const tokenList = buildUniswapTokenList(
      model,
      deployment.chainId,
    );

    return NextResponse.json(tokenList, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control":
          model.status === "ready"
            ? "public, max-age=0, s-maxage=60, stale-while-revalidate=300"
            : "public, max-age=0, s-maxage=60",
      },
    });
  } catch (error) {
    console.error("Public token list failed", error);
    return NextResponse.json(
      { error: "Token list is temporarily unavailable" },
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
