import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";

import {
  type ResetChartRange,
  tokenChartIndexResetResponse,
} from "../../../../../lib/server/explore-index-reset";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOKEN_CHART_RANGES = new Set<ResetChartRange>([
  "1h",
  "1d",
  "1w",
  "all",
]);

function inputError(message: string) {
  return NextResponse.json(
    { error: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "address" && key !== "range") ||
    search.getAll("address").length !== 1 ||
    search.getAll("range").length > 1
  ) {
    return inputError("Unsupported query parameters");
  }

  const rawAddress = search.get("address")?.trim();
  const rawRange = search.get("range")?.trim().toLowerCase() ?? "all";
  if (!rawAddress || !isAddress(rawAddress)) {
    return inputError("Enter a valid Ethereum token address");
  }
  if (!TOKEN_CHART_RANGES.has(rawRange as ResetChartRange)) {
    return inputError("Choose a supported chart range");
  }

  return tokenChartIndexResetResponse({
    address: getAddress(rawAddress),
    range: rawRange as ResetChartRange,
  });
}
