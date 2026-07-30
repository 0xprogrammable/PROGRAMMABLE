import { getAddress, isAddress } from "viem";
import { NextResponse } from "next/server";

import {
  findIndexerToken,
  getPublicOnchainDeployment,
  readExploreModel,
} from "../../../../../../lib/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    address: string;
  }>;
};

const publicHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control":
    "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
};

export async function GET(_request: Request, context: RouteContext) {
  const { address } = await context.params;
  if (!isAddress(address)) {
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
  } catch (error) {
    console.error("Public token lookup failed", error);
    return NextResponse.json(
      { error: "Token metadata is temporarily unavailable" },
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
