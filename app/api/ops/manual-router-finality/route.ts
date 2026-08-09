import { NextResponse } from "next/server";

import { isManualRouterFinalityCronAuthorizedV1 } from
  "@/lib/server/custom-launch/manual-router-cron-auth-v1";
import { runConfiguredManualRouterFinalityWorkerV1 } from
  "@/lib/server/custom-launch/manual-router-finality-worker-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isManualRouterFinalityCronAuthorizedV1(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    const result = await runConfiguredManualRouterFinalityWorkerV1();
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Manual Router finality failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
