import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INDEX_RESET_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Programmable-Indexing-Status": "reset",
});

function indexingResetResponse() {
  return NextResponse.json(
    {
      status: "index_rebuilding",
      code: "indexing_reset",
      operation: "read-model-real-block-sla",
    },
    { status: 410, headers: INDEX_RESET_HEADERS },
  );
}

export function POST() {
  return indexingResetResponse();
}

export function PUT() {
  return indexingResetResponse();
}
