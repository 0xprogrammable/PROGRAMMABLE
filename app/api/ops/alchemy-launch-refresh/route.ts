import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

import {
  ALCHEMY_EXPLORE_CACHE_TAG,
  refreshAlchemyExploreRegistry,
} from "../../../../lib/alchemy/explore.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const runtime = "nodejs";

const NO_STORE = Object.freeze({ "Cache-Control": "no-store" });

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
      { status: 401, headers: NO_STORE },
    );
  }

  try {
    const result = await refreshAlchemyExploreRegistry({
      forcePersist: true,
      includeLatest: false,
      requirePersistence: true,
    });
    revalidateTag(ALCHEMY_EXPLORE_CACHE_TAG, { expire: 0 });
    return NextResponse.json(
      {
        ok: true,
        persisted: result.persisted,
        registryChanged: result.registryChanged,
        confirmedBlockNumber: result.confirmedBlockNumber,
        launchStampRouterBlockNumber: result.launchStampRouterBlockNumber,
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "Alchemy launch registry refresh unavailable" },
      { status: 503, headers: NO_STORE },
    );
  }
}
