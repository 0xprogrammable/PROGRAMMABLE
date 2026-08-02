import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";

const MAXIMUM_ENCODED_BODY_BYTES = 64 * 1024;
const MAXIMUM_DECODED_BODY_BYTES = 128 * 1024;
const MAXIMUM_TIMESTAMP_AGE_SECONDS = 5 * 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 30;
const ASCII_HEADER = /^[\x21-\x7e]+$/u;
const HEX_SIGNATURE = /^[0-9a-f]{64}$/iu;
const CANONICAL_TIMESTAMP = /^(?:0|[1-9]\d{0,11})$/u;

type Environment = Readonly<Record<string, string | undefined>>;

export type QuickNodeStreamWake = Readonly<{
  timestamp: string;
  payloadBytes: number;
}>;

export class QuickNodeStreamWakeError extends Error {
  readonly status: 400 | 401 | 413 | 503;

  constructor(status: 400 | 401 | 413 | 503) {
    super("QuickNode stream wake rejected");
    this.name = "QuickNodeStreamWakeError";
    this.status = status;
  }
}

function configuredSecret(env: Environment): string {
  const secret = env.PROGRAMMABLE_QUICKNODE_STREAM_SECRET;
  const length = secret ? Buffer.byteLength(secret, "utf8") : 0;
  if (!secret || length < 32 || length > 1_024) {
    throw new QuickNodeStreamWakeError(503);
  }
  return secret;
}

function exactHeader(
  request: Request,
  name: string,
  maximumLength: number,
): string {
  const value = request.headers.get(name);
  if (
    !value ||
    value.length > maximumLength ||
    !ASCII_HEADER.test(value)
  ) {
    throw new QuickNodeStreamWakeError(401);
  }
  return value;
}

function assertFreshTimestamp(timestamp: string, nowMs: number) {
  if (!CANONICAL_TIMESTAMP.test(timestamp)) {
    throw new QuickNodeStreamWakeError(401);
  }
  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(nowMs / 1_000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    timestampSeconds < nowSeconds - MAXIMUM_TIMESTAMP_AGE_SECONDS ||
    timestampSeconds > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS
  ) {
    throw new QuickNodeStreamWakeError(401);
  }
}

function decodedBody(request: Request, encoded: Uint8Array): Uint8Array {
  const contentEncoding = request.headers.get("content-encoding")
    ?.trim()
    .toLowerCase();
  const hasGzipMagic = encoded[0] === 0x1f && encoded[1] === 0x8b;
  if (contentEncoding && contentEncoding !== "identity" && contentEncoding !== "gzip") {
    throw new QuickNodeStreamWakeError(400);
  }
  if (!hasGzipMagic) return encoded;
  if (contentEncoding !== "gzip") {
    throw new QuickNodeStreamWakeError(400);
  }
  try {
    return gunzipSync(encoded, {
      maxOutputLength: MAXIMUM_DECODED_BODY_BYTES,
    });
  } catch {
    throw new QuickNodeStreamWakeError(400);
  }
}

function parseJsonPayload(decoded: Uint8Array): string {
  if (
    decoded.byteLength < 2 ||
    decoded.byteLength > MAXIMUM_DECODED_BODY_BYTES
  ) {
    throw new QuickNodeStreamWakeError(413);
  }
  let payload: string;
  try {
    payload = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    throw new QuickNodeStreamWakeError(400);
  }
  try {
    const value: unknown = JSON.parse(payload);
    if (value === null || typeof value !== "object") {
      throw new Error("non-object payload");
    }
  } catch {
    throw new QuickNodeStreamWakeError(400);
  }
  return payload;
}

export async function verifyQuickNodeStreamWake(
  request: Request,
  input: Readonly<{
    env?: Environment;
    nowMs?: number;
  }> = {},
): Promise<QuickNodeStreamWake> {
  const secret = configuredSecret(input.env ?? process.env);
  const nonce = exactHeader(request, "x-qn-nonce", 256);
  const timestamp = exactHeader(request, "x-qn-timestamp", 32);
  const signature = exactHeader(request, "x-qn-signature", 128);
  assertFreshTimestamp(timestamp, input.nowMs ?? Date.now());
  if (!HEX_SIGNATURE.test(signature)) {
    throw new QuickNodeStreamWakeError(401);
  }

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9]\d{0,9})$/u.test(declaredLength) ||
      Number(declaredLength) > MAXIMUM_ENCODED_BODY_BYTES)
  ) {
    throw new QuickNodeStreamWakeError(413);
  }
  const encoded = new Uint8Array(await request.arrayBuffer());
  if (
    encoded.byteLength < 2 ||
    encoded.byteLength > MAXIMUM_ENCODED_BODY_BYTES
  ) {
    throw new QuickNodeStreamWakeError(413);
  }
  const decoded = decodedBody(request, encoded);
  const payload = parseJsonPayload(decoded);
  const expected = createHmac("sha256", secret)
    .update(nonce, "utf8")
    .update(timestamp, "utf8")
    .update(payload, "utf8")
    .digest();
  const provided = Buffer.from(signature, "hex");
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new QuickNodeStreamWakeError(401);
  }

  return Object.freeze({
    timestamp,
    payloadBytes: Buffer.byteLength(payload, "utf8"),
  });
}
