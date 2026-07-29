import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  getPublicOnchainDeployment,
  readExploreModel,
} from "../../../../../lib/onchain";
import {
  isTokenChartRange,
  readTokenChartSeries,
} from "../../../../../lib/onchain/chart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("address")?.trim();
  const requestedRange =
    request.nextUrl.searchParams.get("range")?.trim().toLowerCase() ?? "all";
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum token address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!isTokenChartRange(requestedRange)) {
    return NextResponse.json(
      { error: "Choose a supported chart range" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const deployment = getPublicOnchainDeployment();
    const model = await readExploreModel(deployment);
    if (deployment.status !== "ready" || model.status !== "ready") {
      return NextResponse.json(
        {
          status: "not-deployed",
          points: [],
          swapCount: 0,
        },
        {
          headers: {
            "Cache-Control": "public, max-age=0, s-maxage=60",
          },
        },
      );
    }

    const address = getAddress(input);
    const token = model.tokens.find(
      (candidate) =>
        candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
    );
    if (!token) {
      return NextResponse.json(
        { error: "Token not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const series = await readTokenChartSeries({
      deployment,
      token,
      snapshotBlock: BigInt(model.snapshot.blockNumber),
      ethUsdQuote: model.snapshot.ethUsdQuote,
      range: requestedRange,
    });
    return NextResponse.json(
      {
        ...series,
        range: requestedRange,
        snapshotBlock: model.snapshot.blockNumber,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    console.error("Token chart onchain read failed", error);
    return NextResponse.json(
      { error: "Onchain chart data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
