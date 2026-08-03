import { NextResponse } from "next/server";

import { buildUniswapTokenList } from "../../../../../lib/onchain/indexer-feed";
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

export async function GET() {
  try {
    const deployment = getAlchemyOnchainDeployment();
    const model = await readAlchemyExploreModel();
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
            ...alchemyFeedHeaders("public, max-age=0, s-maxage=60"),
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
      headers: alchemyFeedHeaders(
        "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      ),
    });
  } catch (error) {
    console.error(
      "Public Alchemy token list failed",
      safeAlchemyError(error),
    );
    return NextResponse.json(
      { error: "Token list is temporarily unavailable" },
      {
        status: 503,
        headers: ALCHEMY_NO_STORE_HEADERS,
      },
    );
  }
}
