import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  getAlchemyOnchainDeployment,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../../lib/alchemy/explore.server";
import {
  isTokenChartRange,
  readTokenChartSeries,
} from "../../../../../lib/onchain/chart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some(
      (key) => key !== "address" && key !== "range",
    ) ||
    search.getAll("address").length !== 1 ||
    search.getAll("range").length > 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const input = search.get("address")?.trim();
  const requestedRange =
    search.get("range")?.trim().toLowerCase() ?? "all";
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
    const address = getAddress(input);
    const deployment = getAlchemyOnchainDeployment();
    const model = await readAlchemyExploreModel();
    if (deployment.status !== "ready" || model.status !== "ready") {
      return NextResponse.json(
        {
          status: "not-deployed",
          address,
          points: [],
          swapCount: 0,
          volumeWei: "0",
          volumeEth: "0",
        },
        {
          headers: {
            "Cache-Control": "public, max-age=0, s-maxage=60",
            "X-Programmable-Read-Source": "rpc",
            "X-Programmable-Rpc-Provider": "alchemy",
          },
        },
      );
    }

    const token = model.tokens.find(
      (candidate) =>
        candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
    );
    if (!token) {
      return NextResponse.json(
        {
          error: "Token not found",
          snapshotBlock: model.snapshot.blockNumber,
          snapshotHash: model.snapshot.blockHash,
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "X-Programmable-Read-Source": "rpc",
            "X-Programmable-Rpc-Provider": "alchemy",
          },
        },
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
        address,
        range: requestedRange,
        snapshotBlock: model.snapshot.blockNumber,
        snapshotHash: model.snapshot.blockHash,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
          "X-Programmable-Read-Source": "rpc",
          "X-Programmable-Rpc-Provider": "alchemy",
        },
      },
    );
  } catch (error) {
    console.error(
      "Alchemy token chart read failed",
      safeAlchemyError(error),
    );
    return NextResponse.json(
      { error: "Onchain chart data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
