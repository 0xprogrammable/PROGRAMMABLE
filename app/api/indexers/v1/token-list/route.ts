import { NextResponse } from "next/server";

import { buildUniswapTokenListResult } from "../../../../../lib/onchain/indexer-feed";
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

const TOKEN_LIST_OMITTED_COUNT_HEADER =
  "X-Programmable-Omitted-Token-Count";
const TOKEN_LIST_OMISSION_REASON_HEADER =
  "X-Programmable-Omission-Reason";

function tokenListHeaders(
  cacheControl: string,
  omissions: ReturnType<typeof buildUniswapTokenListResult>["omissions"],
) {
  const headers = alchemyFeedHeaders(cacheControl);
  return {
    ...headers,
    "Access-Control-Expose-Headers": [
      headers["Access-Control-Expose-Headers"],
      TOKEN_LIST_OMITTED_COUNT_HEADER,
      TOKEN_LIST_OMISSION_REASON_HEADER,
    ].join(", "),
    [TOKEN_LIST_OMITTED_COUNT_HEADER]: String(omissions.count),
    ...(omissions.reason
      ? { [TOKEN_LIST_OMISSION_REASON_HEADER]: omissions.reason }
      : {}),
  };
}

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
            ...alchemyFeedHeaders("public, max-age=0, s-maxage=5"),
            "Retry-After": "60",
          },
        },
      );
    }
    const result = buildUniswapTokenListResult(
      model,
      deployment.chainId,
    );
    if (result.tokenList === null) {
      return NextResponse.json(
        {
          status: model.status,
          error:
            "The token list is unavailable until a token has verified decimals",
        },
        {
          status: 503,
          headers: {
            ...tokenListHeaders(
              "public, max-age=0, s-maxage=5",
              result.omissions,
            ),
            "Retry-After": "60",
          },
        },
      );
    }

    return NextResponse.json(result.tokenList, {
      headers: tokenListHeaders(
        "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
        result.omissions,
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
