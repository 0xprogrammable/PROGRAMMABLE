import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import { readExploreModel } from "../../../../lib/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("address")?.trim();
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum token address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const address = getAddress(input);
    const model = await readExploreModel();
    const token =
      model.tokens.find(
        (candidate) =>
          candidate.tokenAddress.toLowerCase() ===
          address.toLowerCase(),
      ) ?? null;

    if (model.status === "ready" && !token) {
      return NextResponse.json(
        {
          status: model.status,
          token: null,
          snapshot: model.snapshot,
        },
        {
          status: 404,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    return NextResponse.json(
      {
        status: model.status,
        token,
        snapshot: model.snapshot,
      },
      {
        headers: {
          "Cache-Control":
            model.status === "ready"
              ? "public, max-age=0, s-maxage=15, stale-while-revalidate=30"
              : "public, max-age=0, s-maxage=60",
        },
      },
    );
  } catch (error) {
    console.error("Token detail onchain read failed", error);
    return NextResponse.json(
      { error: "Onchain token data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
