import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INDEX_RESET_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "X-Programmable-Indexing-Status": "reset",
});

export function GET() {
  return NextResponse.json(
    {
      status: "index_rebuilding",
      code: "indexing_reset",
      operation: "index-v2",
    },
    { status: 410, headers: INDEX_RESET_HEADERS },
  );
}
