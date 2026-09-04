import { NextRequest, NextResponse } from "next/server";
import { isAddress } from "viem";

import { tokenDataIndexResetResponse } from
  "../../../../../lib/server/explore-index-reset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FIXED_RANKING_LIMIT = 20;
const JSON_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

function inputError(message: string) {
  return NextResponse.json(
    { error: message },
    {
      status: 400,
      headers: {
        ...JSON_SECURITY_HEADERS,
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const allowed = new Set(["address", "chain", "section", "limit"]);
  if (
    [...search.keys()].some((key) => !allowed.has(key)) ||
    search.getAll("address").length !== 1 ||
    search.getAll("chain").length > 1 ||
    search.getAll("section").length > 1 ||
    search.getAll("limit").length > 1
  ) return inputError("Unsupported query parameters");

  const rawAddress = search.get("address")?.trim();
  if (!rawAddress || !isAddress(rawAddress)) {
    return inputError("Enter a valid Ethereum token address");
  }

  const chain = search.get("chain");
  if (chain !== null && chain !== "1") return inputError("Unsupported chain");

  const section = search.get("section")?.trim().toLowerCase() ?? "summary";
  if (section !== "summary" && section !== "holders" && section !== "traders") {
    return inputError("Choose a supported analytics section");
  }

  const limit = search.get("limit");
  if (limit !== null && limit !== String(FIXED_RANKING_LIMIT)) {
    return inputError("Only the fixed ranking limit 20 is supported");
  }

  return tokenDataIndexResetResponse();
}
