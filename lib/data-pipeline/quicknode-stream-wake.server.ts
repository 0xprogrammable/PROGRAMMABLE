import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
  kind: "work";
  nonceDigest: `0x${string}`;
  timestamp: string;
  hint: QuickNodeStreamBlockHint;
  payload: string;
  payloadBytes: number;
}>;

export type QuickNodeStreamWakeCanary = Readonly<{
  kind: "auth-only-canary";
  timestamp: string;
  payloadBytes: number;
}>;

export type VerifiedQuickNodeStreamWake =
  | QuickNodeStreamWake
  | QuickNodeStreamWakeCanary;

export type QuickNodeStreamBlockHint = Readonly<{
  chainId: 1;
  blockNumber: string;
  streamId: string;
  reorgedBlockNumbers: readonly string[];
}>;

export type QuickNodeStreamBlockHintParser = (
  value: unknown,
) => QuickNodeStreamBlockHint;

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

function parseJsonPayload(decoded: Uint8Array): Readonly<{
  payload: string;
  value: unknown;
}> {
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
  let value: unknown;
  try {
    value = JSON.parse(payload);
    if (value === null || typeof value !== "object") {
      throw new Error("non-object payload");
    }
  } catch {
    throw new QuickNodeStreamWakeError(400);
  }
  return Object.freeze({ payload, value });
}

function isAuthOnlyCanary(value: unknown, timestamp: string): boolean {
  const envelope = value !== null && typeof value === "object"
    ? Reflect.get(value, "programmableWakeCanary")
    : null;
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 1 ||
    envelope === null ||
    typeof envelope !== "object" ||
    Array.isArray(envelope) ||
    Object.keys(envelope).sort().join(",") !== "probeId,schemaVersion,sentAt" ||
    Reflect.get(envelope, "schemaVersion") !== 1 ||
    typeof Reflect.get(envelope, "probeId") !== "string" ||
    !/^[0-9a-f]{32}$/u.test(Reflect.get(envelope, "probeId") as string) ||
    typeof Reflect.get(envelope, "sentAt") !== "string"
  ) {
    return false;
  }
  const sentAtText = Reflect.get(envelope, "sentAt") as string;
  const sentAt = new Date(sentAtText);
  return (
    Number.isFinite(sentAt.valueOf()) &&
    sentAt.toISOString() === sentAtText &&
    Math.abs(sentAt.valueOf() - Number(timestamp) * 1_000) < 1_000
  );
}

function validatedBlockHint(value: unknown): QuickNodeStreamBlockHint {
  if (
    value === null ||
    typeof value !== "object" ||
    Reflect.get(value, "chainId") !== 1 ||
    typeof Reflect.get(value, "blockNumber") !== "string" ||
    !/^(?:0|[1-9]\d{0,18})$/u.test(
      Reflect.get(value, "blockNumber") as string,
    ) ||
    BigInt(Reflect.get(value, "blockNumber") as string) >
      9_223_372_036_854_775_807n ||
    typeof Reflect.get(value, "streamId") !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(
      Reflect.get(value, "streamId") as string,
    ) ||
    !Array.isArray(Reflect.get(value, "reorgedBlockNumbers")) ||
    (Reflect.get(value, "reorgedBlockNumbers") as unknown[]).length > 64
  ) {
    throw new QuickNodeStreamWakeError(400);
  }
  const reorgedBlockNumbers = Reflect.get(
    value,
    "reorgedBlockNumbers",
  ) as unknown[];
  if (
    reorgedBlockNumbers.some((block) =>
      typeof block !== "string" ||
      !/^(?:0|[1-9]\d{0,18})$/u.test(block) ||
      BigInt(block) > 9_223_372_036_854_775_807n
    ) ||
    new Set(reorgedBlockNumbers).size !== reorgedBlockNumbers.length
  ) {
    throw new QuickNodeStreamWakeError(400);
  }
  return (
    Object.freeze({
      chainId: 1 as const,
      blockNumber: Reflect.get(value, "blockNumber") as string,
      streamId: Reflect.get(value, "streamId") as string,
      reorgedBlockNumbers: Object.freeze(
        reorgedBlockNumbers as string[],
      ),
    })
  );
}

export async function verifyQuickNodeStreamWake(
  request: Request,
  input: Readonly<{
    env?: Environment;
    nowMs?: number;
    parseBlockHint?: QuickNodeStreamBlockHintParser;
  }> = {},
): Promise<VerifiedQuickNodeStreamWake> {
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
  const parsed = parseJsonPayload(decoded);
  const payload = parsed.payload;
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

  if (isAuthOnlyCanary(parsed.value, timestamp)) {
    return Object.freeze({
      kind: "auth-only-canary" as const,
      timestamp,
      payloadBytes: Buffer.byteLength(payload, "utf8"),
    });
  }

  if (!input.parseBlockHint) throw new QuickNodeStreamWakeError(503);
  let hint: QuickNodeStreamBlockHint;
  try {
    hint = validatedBlockHint(input.parseBlockHint(parsed.value));
  } catch (error) {
    if (error instanceof QuickNodeStreamWakeError) throw error;
    throw new QuickNodeStreamWakeError(400);
  }

  return Object.freeze({
    kind: "work" as const,
    nonceDigest: `0x${createHash("sha256").update(nonce, "utf8").digest("hex")}`,
    timestamp,
    hint,
    payload,
    payloadBytes: Buffer.byteLength(payload, "utf8"),
  });
}
