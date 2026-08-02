import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    {
      code: "deep_launches_closed",
      error: "New Deep launches are not available",
    },
    {
      status: 410,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
