import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { DataPipelineError } from "../../../../lib/data-pipeline/errors";
import { ReconcilerDatabaseError } from "../../../../lib/data-pipeline/postgres-reconciler";
import { canonicalReconcilerCheckpointRequest } from "../../../../lib/data-pipeline/reconciler-preparity";
import { runConfiguredReconcilerPreParity } from "../../../../lib/data-pipeline/reconciler-preparity.server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const runtime = "nodejs";

const MAXIMUM_REQUEST_BYTES = 16 * 1024;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const secretLength = typeof secret === "string"
    ? Buffer.byteLength(secret, "utf8")
    : 0;
  if (
    typeof secret !== "string" ||
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

function noStore(status: number) {
  return {
    status,
    headers: { "Cache-Control": "no-store" },
  };
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, noStore(401));
  }

  let checkpointRequest;
  try {
    const body = await request.text();
    if (
      body.length === 0 ||
      Buffer.byteLength(body, "utf8") > MAXIMUM_REQUEST_BYTES
    ) {
      return NextResponse.json(
        { error: "Invalid checkpoint request" },
        noStore(400),
      );
    }
    checkpointRequest = canonicalReconcilerCheckpointRequest(
      JSON.parse(body) as unknown,
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid checkpoint request" },
      noStore(400),
    );
  }

  const startedAt = Date.now();
  try {
    const result = await runConfiguredReconcilerPreParity({
      request: checkpointRequest,
    });
    console.info("Programmable reconciliation completed", {
      status: result.status,
      routeCount: result.routeCount,
      mismatchCount: result.mismatchCount,
      checkpointBlockNumber: result.checkpointBlockNumber,
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      {
        ok: result.status === "succeeded",
        status: result.status,
        routeCount: result.routeCount,
        mismatchCount: result.mismatchCount,
        checkpointId: result.checkpointId,
        checkpointBlockNumber: result.checkpointBlockNumber,
        checkpointBlockHash: result.checkpointBlockHash,
      },
      noStore(result.status === "succeeded" ? 200 : 409),
    );
  } catch (error) {
    console.error("Programmable reconciliation failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      ...(error instanceof DataPipelineError
        ? { dependency: error.dependency, code: error.code }
        : {}),
      ...(error instanceof ReconcilerDatabaseError
        ? { disposition: error.disposition, retryable: error.retryable }
        : {}),
      durationMs: Date.now() - startedAt,
    });
    return NextResponse.json(
      { error: "Reconciliation unavailable" },
      noStore(503),
    );
  }
}
