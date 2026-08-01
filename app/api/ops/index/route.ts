import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    {
      error: "Legacy index route closed",
      code: "legacy_index_route_closed",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
