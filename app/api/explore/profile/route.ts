import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  readBitqueryCreatorProfile,
  safeBitqueryProfileError,
} from "@/lib/market-data/bitquery-profile.server";
import { creatorProfileApiError } from "@/lib/profile/onchain-profile";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "account") ||
    search.getAll("account").length !== 1
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
    const profile = await readBitqueryCreatorProfile(getAddress(input));
    return NextResponse.json(profile, {
      headers: {
        "Cache-Control": "private, max-age=0, s-maxage=15",
        "X-Programmable-Launch-Source": "bitquery-events",
        "X-Programmable-Read-Source": "bitquery",
      },
    });
  } catch (error) {
    console.error("Bitquery creator profile read failed", safeBitqueryProfileError(error));
    return NextResponse.json(creatorProfileApiError("temporary"), {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
