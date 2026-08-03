import { createHmac, timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { ALCHEMY_EXPLORE_CACHE_TAG } from "../../../../lib/alchemy/explore.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAXIMUM_BODY_BYTES = 128 * 1024;
const HEX_SHA256 = /^[0-9a-f]{64}$/iu;
const PRIVATE_NO_STORE = Object.freeze({
  "Cache-Control": "private, no-store",
});

class AlchemyWebhookError extends Error {
  readonly status: 400 | 401 | 413 | 415 | 503;

  constructor(status: 400 | 401 | 413 | 415 | 503) {
    super("Alchemy webhook rejected");
    this.name = "AlchemyWebhookError";
    this.status = status;
  }
}

function signingKey() {
  const value = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY;
  const byteLength = value ? Buffer.byteLength(value, "utf8") : 0;
  if (!value || byteLength < 32 || byteLength > 1_024) {
    throw new AlchemyWebhookError(503);
  }
  return value;
}

function signature(request: Request) {
  const value = request.headers.get("x-alchemy-signature");
  if (!value || !HEX_SHA256.test(value)) {
    throw new AlchemyWebhookError(401);
  }
  return Buffer.from(value, "hex");
}

async function rawRequestBody(request: Request) {
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9]\d{0,9})$/u.test(declaredLength) ||
      Number(declaredLength) > MAXIMUM_BODY_BYTES)
  ) {
    throw new AlchemyWebhookError(413);
  }

  if (request.body === null) return Buffer.alloc(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAXIMUM_BODY_BYTES) {
      await reader.cancel();
      throw new AlchemyWebhookError(413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, totalBytes);
}

function parsePayload(rawBody: Uint8Array) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
  } catch {
    throw new AlchemyWebhookError(400);
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new AlchemyWebhookError(400);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AlchemyWebhookError(400);
  }
}

function errorResponse(status: AlchemyWebhookError["status"]) {
  const message = status === 413
    ? "Request body too large"
    : status === 415
      ? "JSON body required"
      : status === 503
        ? "Webhook unavailable"
        : status === 401
          ? "Unauthorized"
          : "Invalid JSON";
  return NextResponse.json(
    { error: message },
    { status, headers: PRIVATE_NO_STORE },
  );
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
      throw new AlchemyWebhookError(415);
    }

    const key = signingKey();
    const provided = signature(request);
    const rawBody = await rawRequestBody(request);
    const expected = createHmac("sha256", key).update(rawBody).digest();
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      throw new AlchemyWebhookError(401);
    }

    parsePayload(rawBody);
    revalidateTag(ALCHEMY_EXPLORE_CACHE_TAG, "max");
    return new NextResponse(null, {
      status: 200,
      headers: PRIVATE_NO_STORE,
    });
  } catch (error) {
    if (error instanceof AlchemyWebhookError) {
      return errorResponse(error.status);
    }
    return errorResponse(503);
  }
}
