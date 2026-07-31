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
import {
  coordinatePublicRouteRead,
  PUBLIC_INDEXED_ROUTE_READS,
  PUBLIC_DISCOVERY_ROUTE_SCOPES,
  publicRouteSearchParams,
  publicSnapshotCheckpoint,
} from "../../../../../lib/data-pipeline/public-route-readiness.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = publicRouteSearchParams(
    request.nextUrl.searchParams,
    request.headers,
  );
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
    return await coordinatePublicRouteRead({
      route: "explore-chart",
      scope: PUBLIC_DISCOVERY_ROUTE_SCOPES,
      requestHeaders: request.headers,
      indexed: (transaction) =>
        PUBLIC_INDEXED_ROUTE_READS.tokenChart(transaction, {
          chainId: 1,
          address,
          range: requestedRange,
        }),
      async legacy() {
        const deployment = getPublicOnchainDeployment();
        const model = await readExploreModel(deployment);
        if (deployment.status !== "ready" || model.status !== "ready") {
          return {
            source: "rpc" as const,
            response: NextResponse.json(
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
                },
              },
            ),
          };
        }

        const token = model.tokens.find(
          (candidate) =>
            candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
        );
        if (!token) {
          return {
            source: "rpc" as const,
            checkpoint: publicSnapshotCheckpoint(model.snapshot),
            response: NextResponse.json(
              { error: "Token not found" },
              { status: 404, headers: { "Cache-Control": "no-store" } },
            ),
          };
        }

        const series = await readTokenChartSeries({
          deployment,
          token,
          snapshotBlock: BigInt(model.snapshot.blockNumber),
          ethUsdQuote: model.snapshot.ethUsdQuote,
          range: requestedRange,
        });
        return {
          source: "rpc" as const,
          checkpoint: publicSnapshotCheckpoint(model.snapshot),
          response: NextResponse.json(
            {
              ...series,
              address,
              range: requestedRange,
              snapshotBlock: model.snapshot.blockNumber,
            },
            {
              headers: {
                "Cache-Control":
                  "public, max-age=0, s-maxage=15, stale-while-revalidate=15",
              },
            },
          ),
        };
      },
    });
  } catch (error) {
    console.error("Token chart onchain read failed", error);
    return NextResponse.json(
      { error: "Onchain chart data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
