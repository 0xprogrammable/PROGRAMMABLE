import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  runConfiguredMarketProjectorCycle,
  safeMarketProjectorError,
} from "../../../../lib/data-pipeline/market-projector-runtime.server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const secretLength = secret ? Buffer.byteLength(secret, "utf8") : 0;
  if (
    !secret ||
    secretLength < 32 ||
    secretLength > 1_024 ||
    !authorization?.startsWith("Bearer ")
  ) {
    return false;
  }
  const provided = Buffer.from(authorization.slice(7), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return (
    provided.length === expected.length && timingSafeEqual(provided, expected)
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startedAt = Date.now();
  try {
    const result = await runConfiguredMarketProjectorCycle();
    console.info("Programmable market projector completed", {
      status: result.status,
      releaseId: "releaseId" in result ? result.releaseId : undefined,
      blockNumber: "blockNumber" in result ? result.blockNumber : undefined,
      lagBlocks: result.lagBlocks,
      closeCount: result.closeCount,
      candleCount: result.candleCount,
      caughtUp: result.caughtUp,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Programmable market projector failed", {
      ...safeMarketProjectorError(error),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Market projection failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
