import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  getAlchemyOnchainDeployment,
  enrichTokensWithAlchemyPrices,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../lib/alchemy/explore.server";
import { enrichTokensWithAlchemyPoolState } from "../../../../lib/alchemy/live-market.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "address") ||
    search.getAll("address").length !== 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const input = search.get("address")?.trim();
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum token address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const address = getAddress(input);
    const model = await readAlchemyExploreModel();
    const token = model.tokens.find(
      (candidate) =>
        candidate.tokenAddress.toLowerCase() === address.toLowerCase(),
    );

    if (model.status === "ready" && !token) {
      return NextResponse.json(
        {
          status: model.status,
          token: null,
          snapshot: model.snapshot,
          launchDiscoverySnapshot: model.launchDiscoverySnapshot,
        },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "X-Programmable-Launch-Source": "alchemy",
            "X-Programmable-Read-Source": "blob",
            "X-Programmable-Rpc-Provider": "alchemy",
          },
        },
      );
    }

    const priced = token
      ? (await enrichTokensWithAlchemyPrices([token]))[0] ?? token
      : null;
    const liveSnapshot =
      model.status === "ready"
        ? (model.launchDiscoverySnapshot ?? model.snapshot)
        : null;
    const deployment = getAlchemyOnchainDeployment();
    const enriched =
      priced && liveSnapshot && deployment.status === "ready"
        ? (
            await enrichTokensWithAlchemyPoolState({
              deployment,
              snapshot: liveSnapshot,
              tokens: [priced],
            })
          )[0] ?? priced
        : priced;
    return NextResponse.json(
      {
        status: model.status,
        token: enriched,
        snapshot: model.snapshot,
        launchDiscoverySnapshot:
          model.status === "ready"
            ? model.launchDiscoverySnapshot
            : undefined,
      },
      {
        headers: {
          "Cache-Control":
            model.status === "ready"
              ? "public, max-age=0, s-maxage=2, stale-while-revalidate=5"
              : "public, max-age=0, s-maxage=30",
          "X-Programmable-Price-Source": "alchemy",
          "X-Programmable-Launch-Source": "alchemy",
          "X-Programmable-Read-Source": "blob",
          "X-Programmable-Rpc-Provider": "alchemy",
        },
      },
    );
  } catch (error) {
    console.error(
      "Alchemy token detail read failed",
      safeAlchemyError(error),
    );
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
