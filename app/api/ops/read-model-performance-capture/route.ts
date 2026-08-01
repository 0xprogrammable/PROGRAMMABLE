import { createHmac, timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { DataPipelineError } from "../../../../lib/data-pipeline/errors";
import { captureReadModelPerformance } from "../../../../lib/data-pipeline/read-model-performance-capture.server";

export const dynamic = "force-dynamic";
export const maxDuration = 90;
export const runtime = "nodejs";

const MAXIMUM_BODY_BYTES = 4_096;
const RELEASE_PROFILE_ID = "read-model-release-v1";
const RELEASE_RATE_LIMIT_MS = 30_000;
const RELEASE_REPLAY_TTL_MS = 60_000;
const releaseCaptures = new Map<string, number>();
const PRIVATE_NO_STORE = Object.freeze({
  "Cache-Control": "private, no-store",
});

function isValidProbeSecret(secret: unknown): secret is string {
  if (typeof secret !== "string") return false;
  const byteLength = Buffer.byteLength(secret, "utf8");
  return byteLength >= 32 && byteLength <= 1_024;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN;
  const provided = request.headers.get(
    "x-programmable-performance-probe-token",
  );
  if (
    request.headers.get("x-programmable-performance-probe") !== "1" ||
    !isValidProbeSecret(secret) ||
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

function releaseCaptureAuthorization(
  request: NextRequest,
  rawBody: string,
  body: unknown,
): "not-release" | "authorized" | "unauthorized" | "rate-limited" {
  if (
    body === null ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Reflect.get(body, "profileId") !== RELEASE_PROFILE_ID
  ) {
    return "not-release";
  }
  const secret = process.env.PROGRAMMABLE_PERFORMANCE_PROBE_TOKEN;
  const supplied = request.headers.get(
    "x-programmable-release-capture-signature",
  );
  if (
    !isValidProbeSecret(secret) ||
    typeof supplied !== "string" ||
    !/^v1=[0-9a-f]{64}$/u.test(supplied)
  ) {
    return "unauthorized";
  }
  const expected = Buffer.from(
    createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"),
    "hex",
  );
  const provided = Buffer.from(supplied.slice(3), "hex");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return "unauthorized";
  }
  const nonce = Reflect.get(body, "captureNonce");
  const deploymentId = Reflect.get(body, "vercelDeploymentId");
  if (
    typeof nonce !== "string" ||
    !/^0x[0-9a-f]{64}$/u.test(nonce) ||
    typeof deploymentId !== "string" ||
    !/^dpl_[A-Za-z0-9]{20,128}$/u.test(deploymentId)
  ) {
    return "unauthorized";
  }
  const nowMs = Date.now();
  for (const [key, capturedAtMs] of releaseCaptures) {
    if (nowMs - capturedAtMs > RELEASE_REPLAY_TTL_MS) {
      releaseCaptures.delete(key);
    }
  }
  if (
    releaseCaptures.has(`nonce:${nonce}`) ||
    nowMs - (releaseCaptures.get(`deployment:${deploymentId}`) ?? 0) <
      RELEASE_RATE_LIMIT_MS
  ) {
    return "rate-limited";
  }
  releaseCaptures.set(`nonce:${nonce}`, nowMs);
  releaseCaptures.set(`deployment:${deploymentId}`, nowMs);
  return "authorized";
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
  const releaseAuthorization = releaseCaptureAuthorization(
    request,
    rawBody,
    body,
  );
  if (releaseAuthorization === "unauthorized") {
    return errorResponse("Unauthorized", 401);
  }
  if (releaseAuthorization === "rate-limited") {
    const response = errorResponse("Release capture rate limited", 429);
    response.headers.set("Retry-After", "30");
    return response;
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
