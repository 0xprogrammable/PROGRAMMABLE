import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  runConfiguredProtocolRevenueKeeper,
  safeProtocolRevenueKeeperError,
} from "../../../../lib/protocol-revenue/keeper.server";

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
    const result = await runConfiguredProtocolRevenueKeeper();
    console.info("Programmable protocol revenue keeper completed", {
      status: result.status,
      transactionHash:
        result.status === "submitted" ? result.transactionHash : undefined,
      finalizedBlockNumber:
        "finalizedBlockNumber" in result
          ? result.finalizedBlockNumber
          : undefined,
      availableRevenue:
        "availableRevenue" in result ? result.availableRevenue : undefined,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(result, {
      status: result.status === "submitted" ? 202 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Programmable protocol revenue keeper failed", {
      ...safeProtocolRevenueKeeperError(error),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Protocol revenue cycle failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
