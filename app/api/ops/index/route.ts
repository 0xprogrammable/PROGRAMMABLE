import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  getOperationalOnchainDeployment,
  readLiveExploreModel,
  writeDurableExploreModel,
} from "../../../../lib/onchain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

function isAuthorized(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!cronSecret || !authorization?.startsWith("Bearer ")) {
    return false;
  }

  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(cronSecret);
  return (
    provided.length === expected.length &&
    timingSafeEqual(provided, expected)
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  const startedAt = Date.now();
  try {
    const deployment = getOperationalOnchainDeployment("production");
    if (deployment.status !== "ready") {
      throw new Error(
        "The verified production release is not operationally eligible",
      );
    }
    const model = await readLiveExploreModel(deployment);
    if (model.status !== "ready") {
      throw new Error("The live Explore model is not ready");
    }
    const result = await writeDurableExploreModel(deployment, model);
    console.info("Programmable index refresh completed", {
      blockNumber: result.blockNumber,
      tokenCount: result.tokenCount,
      updated: result.updated,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: true,
        blockNumber: result.blockNumber,
        tokenCount: result.tokenCount,
        updated: result.updated,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Programmable index refresh failed", {
      errorName:
        error instanceof Error ? error.name : "UnknownIndexError",
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Index refresh failed" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
