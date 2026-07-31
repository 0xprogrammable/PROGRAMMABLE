import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { DataPipelineError } from "../../../../lib/data-pipeline/errors";
import { captureReadModelPerformance } from "../../../../lib/data-pipeline/read-model-performance-capture.server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const runtime = "nodejs";

const MAXIMUM_BODY_BYTES = 4_096;
const PRIVATE_NO_STORE = Object.freeze({
  "Cache-Control": "private, no-store",
});

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN;
  const provided = request.headers.get(
    "x-programmable-performance-probe-token",
  );
  if (
    request.headers.get("x-programmable-performance-probe") !== "1" ||
    typeof secret !== "string" ||
    secret.length < 32 ||
    secret.length > 1_024 ||
    provided === null
  ) {
    return false;
  }
  const expectedBytes = Buffer.from(secret, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

function errorResponse(error: string, status: number) {
  return NextResponse.json(
    { error },
    { status, headers: PRIVATE_NO_STORE },
  );
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) return errorResponse("Unauthorized", 401);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    return errorResponse("JSON body required", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAXIMUM_BODY_BYTES
  ) {
    return errorResponse("Request body too large", 413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return errorResponse("Invalid request body", 400);
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAXIMUM_BODY_BYTES) {
    return errorResponse("Request body too large", 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse("Invalid JSON", 400);
  }

  const startedAt = Date.now();
  try {
    const capture = await captureReadModelPerformance(body);
    return NextResponse.json(capture, { headers: PRIVATE_NO_STORE });
  } catch (error) {
    if (
      error instanceof DataPipelineError &&
      error.code === "invalid_input" &&
      error.safeMetadata?.operation === "performance-capture-request"
    ) {
      return errorResponse("Invalid capture request", 400);
    }
    console.error("Programmable performance capture failed", {
      errorName:
        error instanceof Error ? error.name : "UnknownPerformanceCaptureError",
      durationMs: Date.now() - startedAt,
    });
    return errorResponse("Performance capture unavailable", 503);
  }
}
