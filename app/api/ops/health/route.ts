import { NextResponse } from "next/server";

import { bitqueryMarketDataConfigured } from "../../../../lib/market-data/bitquery.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const configured = bitqueryMarketDataConfigured();

  return NextResponse.json(
    {
      status: configured ? "ready" : "degraded",
      provider: {
        name: "bitquery",
        configured,
      },
      checkedAt: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": configured
          ? "public, max-age=0, s-maxage=30"
          : "no-store",
      },
    },
  );
}
