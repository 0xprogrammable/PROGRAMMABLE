import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { runConfiguredManualRouterFinalityWorkerV1 } from
  "@/lib/server/custom-launch/manual-router-finality-worker-v1";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const secretLength = secret ? Buffer.byteLength(secret, "utf8") : 0;
  if (
    !secret
    || secretLength < 32
    || secretLength > 1_024
    || !authorization?.startsWith("Bearer ")
  ) return false;
  const provided = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return provided.length === expected.length
    && timingSafeEqual(provided, expected);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
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
