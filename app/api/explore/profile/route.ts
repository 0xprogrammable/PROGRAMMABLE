import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  buildCreatorProfile,
  readExploreModel,
} from "../../../../lib/onchain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("account")?.trim();
  if (!input || !isAddress(input)) {
    return NextResponse.json(
      { error: "Enter a valid Ethereum account address" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const model = await readExploreModel();
    return NextResponse.json(
      buildCreatorProfile(model, getAddress(input)),
      {
        headers: {
          "Cache-Control":
            model.status === "ready"
              ? "private, max-age=0, s-maxage=15"
              : "private, max-age=0, s-maxage=60",
        },
      },
    );
  } catch (error) {
    console.error("Creator profile onchain read failed", error);
    return NextResponse.json(
      { error: "Onchain creator data is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
