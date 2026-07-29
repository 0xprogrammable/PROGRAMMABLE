import { NextRequest, NextResponse } from "next/server";

import { readExploreModel } from "@/lib/onchain";
import { findDeepV2LaunchByTransaction } from "@/lib/onchain/deep-v2-read-model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  if (
    [...search.keys()].some((key) => key !== "transaction") ||
    search.getAll("transaction").length !== 1
  ) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const transactionHash = search.get("transaction")?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{64}$/.test(transactionHash)) {
    return NextResponse.json(
      { error: "Enter a valid launch transaction hash" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const model = await readExploreModel();
    const launch = findDeepV2LaunchByTransaction(model, transactionHash);
    return NextResponse.json(
      {
        status: model.status,
        launch,
        snapshot: model.snapshot,
      },
      {
        status: launch ? 200 : 404,
        headers: { "Cache-Control": "private, max-age=0, no-store" },
      },
    );
  } catch (error) {
    console.error("Deep V2 launch confirmation failed", error);
    return NextResponse.json(
      { error: "Launch confirmation is temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
