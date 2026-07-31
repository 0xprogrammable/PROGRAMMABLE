import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  buildCreatorProfile,
  readExploreModel,
} from "../../../../lib/onchain";
import {
  coordinatePublicRouteRead,
  PUBLIC_INDEXED_ROUTE_READS,
  PUBLIC_DISCOVERY_ROUTE_SCOPES,
  publicRouteSearchParams,
  publicSnapshotCheckpoint,
} from "../../../../lib/data-pipeline/public-route-readiness.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = publicRouteSearchParams(
    request.nextUrl.searchParams,
    request.headers,
  );
  if (
    [...search.keys()].some(
      (key) => key !== "account" && key !== "launch" && key !== "attempt",
    ) ||
    search.getAll("account").length !== 1 ||
    search.getAll("launch").length > 1 ||
    search.getAll("attempt").length > 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const input = search.get("account")?.trim();
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum account address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const account = getAddress(input);
    return await coordinatePublicRouteRead({
      route: "creator-profile",
      scope: PUBLIC_DISCOVERY_ROUTE_SCOPES,
      requestHeaders: request.headers,
      indexed: (transaction) =>
        PUBLIC_INDEXED_ROUTE_READS.creatorProfile(transaction, {
          chainId: 1,
          account,
        }),
      async legacy() {
        const model = await readExploreModel();
        return {
          source: "rpc" as const,
          checkpoint: publicSnapshotCheckpoint(model.snapshot),
          response: NextResponse.json(
            buildCreatorProfile(model, account),
            {
              headers: {
                "Cache-Control":
                  model.status === "ready"
                    ? "private, max-age=0, s-maxage=15"
                    : "private, max-age=0, s-maxage=60",
              },
            },
          ),
        };
      },
    });
  } catch (error) {
    console.error("Creator profile onchain read failed", error);
    return NextResponse.json(
      { error: "Onchain creator data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
