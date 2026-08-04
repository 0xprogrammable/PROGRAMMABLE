import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  enrichTokensWithAlchemyPrices,
  readAlchemyExploreModel,
  safeAlchemyError,
} from "../../../../lib/alchemy/explore.server";

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
        { status: model.status, token: null, snapshot: model.snapshot },
        {
          status: 404,
          headers: {
            "Cache-Control": "no-store",
            "X-Programmable-Read-Source": "blob",
            "X-Programmable-Rpc-Provider": "alchemy",
          },
        },
      );
    }

    const enriched = token
      ? (await enrichTokensWithAlchemyPrices([token]))[0] ?? token
      : null;
    return NextResponse.json(
      {
        status: model.status,
        token: enriched,
        snapshot: model.snapshot,
      },
      {
        headers: {
          "Cache-Control":
            model.status === "ready"
              ? "public, max-age=0, s-maxage=5, stale-while-revalidate=15"
              : "public, max-age=0, s-maxage=30",
          "X-Programmable-Price-Source": "alchemy",
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
