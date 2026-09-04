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
      status: "index-reset",
      providers: [],
    },
    { status: 200, headers: INDEX_RESET_HEADERS },
  );
}
