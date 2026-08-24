import type { PredictionV2PublicReleaseV2 } from
  "@/lib/prediction-v2/public-release-v2.server";
import { PREDICTION_V2_DIRECTORY_MAX_PAGE_SIZE } from
  "@/lib/prediction-v2/read-model-v2.server";

export const PREDICTION_V2_DIRECTORY_RESPONSE_SCHEMA =
  "programmable.prediction-v2.directory-response.v2" as const;
export const PREDICTION_V2_REDEEM_PREPARE_REQUEST_SCHEMA =
  "programmable.prediction-v2.redeem-prepare-request.v2" as const;
export const PREDICTION_V2_RESOLUTION_DECISION_REQUEST_SCHEMA =
  "programmable.prediction-v2.resolution-decision-request.v2" as const;
export const PREDICTION_V2_RESOLUTION_DECISION_RESPONSE_SCHEMA =
  "programmable.prediction-v2.resolution-decision-response.v2" as const;
export const PREDICTION_V2_ROUTE_ERROR_SCHEMA =
  "programmable.prediction-v2.client-error.v2" as const;

const MAXIMUM_BODY_BYTES = 8 * 1_024;
const MAXIMUM_JSON_DEPTH = 12;
const MAXIMUM_JSON_NODES = 8_192;
const UINT256_MAX = (1n << 256n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/u;
const BYTES32_PATTERN = /^0x[0-9a-f]{64}$/u;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]{16,2048}$/u;
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)$/u;
const FORBIDDEN_RESPONSE_FIELDS = new Set([
  "broadcast",
  "broadcasted",
  "rawtransaction",
  "rawtransactionhex",
  "rawtx",
  "signature",
  "signedtransaction",
  "signedtx",
  "submitted",
  "transactionhash",
  "txhash",
]);

const NO_STORE_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
});

export type PredictionV2RouteJsonPrimitiveV2 =
  | boolean
  | null
  | number
  | string;
export type PredictionV2RouteJsonValueV2 =
  | PredictionV2RouteJsonPrimitiveV2
  | readonly PredictionV2RouteJsonValueV2[]
  | Readonly<{ [key: string]: PredictionV2RouteJsonValueV2 }>;
export type PredictionV2RouteJsonObjectV2 = Readonly<{
  [key: string]: PredictionV2RouteJsonValueV2;
}>;

export type PredictionV2RedeemPrepareIntentV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_REDEEM_PREPARE_REQUEST_SCHEMA;
  action: "redeem";
  actionId: `0x${string}`;
  marketKey: `eip155:4663:${string}:${string}`;
  economicKey: `0x${string}`;
  marketId: `0x${string}`;
  account: `0x${string}`;
  minimumConfirmedBlockNumber: string;
  minimumConfirmedBlockHash: `0x${string}`;
  yesAtoms: string;
  noAtoms: string;
}>;

export type PredictionV2ResolutionDecisionIntentV2 = Readonly<{
  schemaVersion: typeof PREDICTION_V2_RESOLUTION_DECISION_REQUEST_SCHEMA;
  action: "decide-resolution";
  actionId: `0x${string}`;
  marketKey: `eip155:4663:${string}:${string}`;
  economicKey: `0x${string}`;
  marketId: `0x${string}`;
  account: `0x${string}`;
}>;

export type PredictionV2DirectoryIntentV2 = Readonly<{
  limit: number;
  cursor: string | null;
}>;

export type PredictionV2RouteBudgetActionV2 =
  | "directory"
  | "redeem-prepare"
  | "resolution-decision";

export type PredictionV2RouteBudgetLeaseV2 = Readonly<{
  expiresAtMs: number;
  opaque: unknown;
}>;

export type PredictionV2RouteBudgetReservationV2 =
  | Readonly<{
    status: "reserved";
    lease: PredictionV2RouteBudgetLeaseV2;
  }>
  | Readonly<{
    status: "rate-limited";
    retryAfterSeconds: number;
  }>
  | Readonly<{
    status: "blocked" | "in-progress" | "replay";
    retryAfterSeconds?: number;
  }>;

export type PredictionV2RouteRuntimeV2 = Readonly<{
  readiness: Readonly<{
    productionReady: boolean;
  }>;
  nowMs(): number;
  reserve(input: Readonly<{
    action: PredictionV2RouteBudgetActionV2;
    request: Request;
    idempotencyKeyMaterial: string;
    requestFingerprintMaterial: string;
  }>): Promise<PredictionV2RouteBudgetReservationV2>;
  /**
   * Atomically consumes/starts the lease before provider work. Only the first
   * explicit `started` result authorizes execution. Once this method is called,
   * the route never cancels: an acknowledgement can be stale or lost after the
   * backend already consumed the lease.
   */
  start(
    lease: PredictionV2RouteBudgetLeaseV2,
  ): Promise<"started" | "not-started">;
  commit(input: Readonly<{
    lease: PredictionV2RouteBudgetLeaseV2;
    result: PredictionV2RouteJsonObjectV2;
  }>): Promise<void>;
  cancel(lease: PredictionV2RouteBudgetLeaseV2): Promise<void>;
  readDirectory(input: Readonly<{
    release: PredictionV2PublicReleaseV2 & Readonly<{ status: "enabled" }>;
    intent: PredictionV2DirectoryIntentV2;
    lease: PredictionV2RouteBudgetLeaseV2;
    signal: AbortSignal;
  }>): Promise<PredictionV2RouteJsonObjectV2>;
  prepareRedeem(input: Readonly<{
    release: PredictionV2PublicReleaseV2 & Readonly<{ status: "enabled" }>;
    intent: PredictionV2RedeemPrepareIntentV2;
    lease: PredictionV2RouteBudgetLeaseV2;
    signal: AbortSignal;
  }>): Promise<PredictionV2RouteJsonObjectV2>;
  decideResolution(input: Readonly<{
    release: PredictionV2PublicReleaseV2 & Readonly<{ status: "enabled" }>;
    intent: PredictionV2ResolutionDecisionIntentV2;
    lease: PredictionV2RouteBudgetLeaseV2;
    signal: AbortSignal;
  }>): Promise<PredictionV2RouteJsonObjectV2>;
}>;

export type PredictionV2RouteDependenciesV2 = Readonly<{
  getRelease(): PredictionV2PublicReleaseV2;
  loadRuntime(
    release: PredictionV2PublicReleaseV2 & Readonly<{ status: "enabled" }>,
  ): Promise<PredictionV2RouteRuntimeV2>;
}>;

export class PredictionV2RouteRuntimeErrorV2 extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 415 | 429 | 503,
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super("Prediction V2 route runtime failed closed");
    this.name = "PredictionV2RouteRuntimeErrorV2";
  }
}

function jsonResponse(
  body: PredictionV2RouteJsonObjectV2,
  status: number,
  retryAfterSeconds?: number,
) {
  const headers = new Headers(NO_STORE_HEADERS);
  if (retryAfterSeconds !== undefined) {
    headers.set("Retry-After", String(retryAfterSeconds));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function jsonTextResponse(body: string, status: number) {
  return new Response(body, { status, headers: NO_STORE_HEADERS });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  retryable: boolean,
  retryAfterSeconds?: number,
) {
  return jsonResponse(Object.freeze({
    schemaVersion: PREDICTION_V2_ROUTE_ERROR_SCHEMA,
    code,
    message,
    retryable,
  }), status, retryAfterSeconds);
}

function notFound() {
  return errorResponse(404, "not_found", "Not found", false);
}

function runtimeUnavailable(retryAfterSeconds = 30) {
  return errorResponse(
    503,
    "runtime-unavailable",
    "Prediction markets are temporarily unavailable",
    true,
    retryAfterSeconds,
  );
}

function invalidRequest(message = "The request is invalid") {
  return errorResponse(400, "invalid-request", message, false);
}

async function enabledRuntime(
  dependencies: PredictionV2RouteDependenciesV2,
): Promise<Readonly<{
  release: PredictionV2PublicReleaseV2 & Readonly<{ status: "enabled" }>;
  runtime: PredictionV2RouteRuntimeV2;
}> | Response> {
  // This is intentionally the first observable operation. In particular, no
  // Request field, environment variable, budget backend or RPC module is read
  // before the signed public-release parser has returned an enabled envelope.
  let release: PredictionV2PublicReleaseV2;
  try {
    release = dependencies.getRelease();
  } catch {
    return notFound();
  }
  if (release.status !== "enabled") return notFound();

  let runtime: PredictionV2RouteRuntimeV2;
  try {
    runtime = await dependencies.loadRuntime(release);
  } catch {
    return runtimeUnavailable();
  }
  if (runtime.readiness.productionReady !== true) return runtimeUnavailable();
  return Object.freeze({ release, runtime });
}

function parseDirectoryIntent(request: Request): PredictionV2DirectoryIntentV2 {
  const url = new URL(request.url);
  const allowed = new Set(["cursor", "limit"]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new TypeError("query");
    }
  }
  const limitText = url.searchParams.get("limit");
  const limit = limitText === null
    ? PREDICTION_V2_DIRECTORY_MAX_PAGE_SIZE
    : Number(limitText);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > PREDICTION_V2_DIRECTORY_MAX_PAGE_SIZE ||
    (limitText !== null && String(limit) !== limitText)
  ) throw new TypeError("limit");
  const cursor = url.searchParams.get("cursor");
  if (cursor !== null && !CURSOR_PATTERN.test(cursor)) {
    throw new TypeError("cursor");
  }
  return Object.freeze({ limit, cursor });
}

function exactRecord(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) throw new TypeError("record");
  const record = value as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string") ||
    !fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, field);
      return descriptor?.enumerable === true &&
        Object.hasOwn(descriptor, "value");
    })
  ) throw new TypeError("fields");
  return record;
}

function bytes32(value: unknown): `0x${string}` {
  if (
    typeof value !== "string" ||
    !BYTES32_PATTERN.test(value) ||
    /^0x0{64}$/iu.test(value)
  ) {
    throw new TypeError("bytes32");
  }
  return value.toLowerCase() as `0x${string}`;
}

function address(value: unknown): `0x${string}` {
  if (
    typeof value !== "string" ||
    !ADDRESS_PATTERN.test(value) ||
    /^0x0{40}$/iu.test(value)
  ) throw new TypeError("address");
  return value.toLowerCase() as `0x${string}`;
}

function uint(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 78 ||
    !DECIMAL_PATTERN.test(value) ||
    BigInt(value) > UINT256_MAX
  ) throw new TypeError("uint");
  return value;
}

function positiveUint64(value: unknown): string {
  const normalized = uint(value);
  const parsed = BigInt(normalized);
  if (parsed < 1n || parsed > UINT64_MAX) throw new TypeError("uint64");
  return normalized;
}

function marketKey(
  value: unknown,
  economicKey: `0x${string}`,
): `eip155:4663:${string}:${string}` {
  if (typeof value !== "string" || value.length > 192) {
    throw new TypeError("market key");
  }
  const parts = value.split(":");
  if (
    parts.length !== 4 ||
    parts[0] !== "eip155" ||
    parts[1] !== "4663" ||
    !ADDRESS_PATTERN.test(parts[2] ?? "") ||
    (parts[2] ?? "").toLowerCase() === `0x${"0".repeat(40)}` ||
    parts[3] !== economicKey
  ) throw new TypeError("market key");
  return `eip155:4663:${parts[2]!.toLowerCase()}:${economicKey}`;
}

async function readBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")
    ?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new PredictionV2RouteRuntimeErrorV2(
      415,
      "unsupported-media-type",
      false,
    );
  }
  const contentEncoding = request.headers.get("content-encoding");
  if (
    contentEncoding !== null &&
    contentEncoding.trim().toLowerCase() !== "identity"
  ) {
    throw new PredictionV2RouteRuntimeErrorV2(
      415,
      "unsupported-content-encoding",
      false,
    );
  }
  const declaredLength = request.headers.get("content-length");
  let expectedLength: number | null = null;
  if (declaredLength !== null) {
    if (!DECIMAL_PATTERN.test(declaredLength)) {
      throw new PredictionV2RouteRuntimeErrorV2(400, "invalid-request", false);
    }
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed > MAXIMUM_BODY_BYTES) {
      throw new PredictionV2RouteRuntimeErrorV2(
        413,
        "request-too-large",
        false,
      );
    }
    expectedLength = parsed;
  }
  if (request.body === null) {
    throw new PredictionV2RouteRuntimeErrorV2(400, "invalid-request", false);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAXIMUM_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new PredictionV2RouteRuntimeErrorV2(
          413,
          "request-too-large",
          false,
        );
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (expectedLength !== null && total !== expectedLength) {
    throw new PredictionV2RouteRuntimeErrorV2(400, "invalid-request", false);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new PredictionV2RouteRuntimeErrorV2(400, "invalid-request", false);
  }
  try {
    assertNoDuplicateJsonKeys(text);
    return JSON.parse(text) as unknown;
  } catch {
    throw new PredictionV2RouteRuntimeErrorV2(400, "invalid-request", false);
  }
}

function assertMarketReleaseBinding(
  release: PredictionV2PublicReleaseV2 & Readonly<{ status: "enabled" }>,
  marketKeyValue: string,
) {
  const factory = release.components.find(
    ({ component }) => component === "GenericPredictionMarketFactoryV2",
  );
  const marketFactory = marketKeyValue.split(":")[2];
  if (
    !factory ||
    typeof marketFactory !== "string" ||
    marketFactory.toLowerCase() !== factory.address.toLowerCase()
  ) throw new TypeError("market release binding");
}

/** Rejects decoded duplicate object keys before JSON.parse can collapse them. */
function assertNoDuplicateJsonKeys(text: string) {
  let index = 0;
  const whitespace = () => {
    while (/\s/u.test(text[index] ?? "")) index += 1;
  };
  const fail = (): never => {
    throw new SyntaxError("Invalid JSON object keys");
  };
  const quoted = () => {
    if (text[index] !== '"') return fail();
    const start = index;
    index += 1;
    for (;;) {
      const character = text[index];
      if (character === undefined || character.charCodeAt(0) < 0x20) {
        return fail();
      }
      if (character === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index)) as string;
      }
      if (character === "\\") {
        index += 1;
        const escaped = text[index];
        if (escaped === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(index + 1, index + 5))) {
            return fail();
          }
          index += 5;
          continue;
        }
        if (!escaped || !'"\\/bfnrt'.includes(escaped)) return fail();
      }
      index += 1;
    }
  };
  const primitive = () => {
    const start = index;
    while (
      index < text.length &&
      !/[\s,\]}]/u.test(text[index] ?? "")
    ) index += 1;
    if (index === start) return fail();
  };
  const value = (depth: number): void => {
    if (depth > MAXIMUM_JSON_DEPTH) return fail();
    whitespace();
    if (text[index] === '"') {
      quoted();
      return;
    }
    if (text[index] === "{") {
      object(depth + 1);
      return;
    }
    if (text[index] === "[") {
      array(depth + 1);
      return;
    }
    primitive();
  };
  const object = (depth: number): void => {
    index += 1;
    whitespace();
    if (text[index] === "}") {
      index += 1;
      return;
    }
    const keys = new Set<string>();
    for (;;) {
      whitespace();
      const key = quoted();
      if (keys.has(key)) return fail();
      keys.add(key);
      whitespace();
      if (text[index] !== ":") return fail();
      index += 1;
      value(depth);
      whitespace();
      if (text[index] === "}") {
        index += 1;
        return;
      }
      if (text[index] !== ",") return fail();
      index += 1;
    }
  };
  const array = (depth: number): void => {
    index += 1;
    whitespace();
    if (text[index] === "]") {
      index += 1;
      return;
    }
    for (;;) {
      value(depth);
      whitespace();
      if (text[index] === "]") {
        index += 1;
        return;
      }
      if (text[index] !== ",") return fail();
      index += 1;
    }
  };
  value(0);
  whitespace();
  if (index !== text.length) fail();
}

async function parseRedeemIntent(
  request: Request,
): Promise<PredictionV2RedeemPrepareIntentV2> {
  const value = await readBody(request);
  const record = exactRecord(value, [
    "schemaVersion",
    "action",
    "actionId",
    "marketKey",
    "economicKey",
    "marketId",
    "account",
    "minimumConfirmedBlockNumber",
    "minimumConfirmedBlockHash",
    "yesAtoms",
    "noAtoms",
  ]);
  if (
    record.schemaVersion !== PREDICTION_V2_REDEEM_PREPARE_REQUEST_SCHEMA ||
    record.action !== "redeem"
  ) throw new TypeError("intent");
  const actionId = bytes32(record.actionId);
  const economicKey = bytes32(record.economicKey);
  const marketId = bytes32(record.marketId);
  const account = address(record.account);
  const minimumConfirmedBlockNumber = positiveUint64(
    record.minimumConfirmedBlockNumber,
  );
  const minimumConfirmedBlockHash = bytes32(
    record.minimumConfirmedBlockHash,
  );
  const yesAtoms = uint(record.yesAtoms);
  const noAtoms = uint(record.noAtoms);
  if (yesAtoms === "0" && noAtoms === "0") throw new TypeError("amount");
  const key = marketKey(record.marketKey, economicKey);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey !== actionId) throw new TypeError("idempotency");
  return Object.freeze({
    schemaVersion: PREDICTION_V2_REDEEM_PREPARE_REQUEST_SCHEMA,
    action: "redeem" as const,
    actionId,
    marketKey: key,
    economicKey,
    marketId,
    account,
    minimumConfirmedBlockNumber,
    minimumConfirmedBlockHash,
    yesAtoms,
    noAtoms,
  });
}

async function parseResolutionIntent(
  request: Request,
): Promise<PredictionV2ResolutionDecisionIntentV2> {
  const value = await readBody(request);
  const record = exactRecord(value, [
    "schemaVersion",
    "action",
    "actionId",
    "marketKey",
    "economicKey",
    "marketId",
    "account",
  ]);
  if (
    record.schemaVersion !==
      PREDICTION_V2_RESOLUTION_DECISION_REQUEST_SCHEMA ||
    record.action !== "decide-resolution"
  ) throw new TypeError("intent");
  const actionId = bytes32(record.actionId);
  const economicKey = bytes32(record.economicKey);
  const marketId = bytes32(record.marketId);
  const account = address(record.account);
  const key = marketKey(record.marketKey, economicKey);
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey !== actionId) throw new TypeError("idempotency");
  return Object.freeze({
    schemaVersion: PREDICTION_V2_RESOLUTION_DECISION_REQUEST_SCHEMA,
    action: "decide-resolution" as const,
    actionId,
    marketKey: key,
    economicKey,
    marketId,
    account,
  });
}

function sealedJsonResponseBody(
  value: unknown,
  unsignedOnly: boolean,
): Readonly<{
  body: PredictionV2RouteJsonObjectV2;
  text: string;
}> {
  const budget = { remaining: MAXIMUM_JSON_NODES };
  const visit = (candidate: unknown, depth: number): void => {
    budget.remaining -= 1;
    if (budget.remaining < 0 || depth > MAXIMUM_JSON_DEPTH) {
      throw new PredictionV2RouteRuntimeErrorV2(
        503,
        "runtime-invalid-response",
        true,
      );
    }
    if (
      candidate === null ||
      typeof candidate === "string" ||
      typeof candidate === "boolean"
    ) return;
    if (typeof candidate === "number") {
      if (!Number.isSafeInteger(candidate)) {
        throw new PredictionV2RouteRuntimeErrorV2(
          503,
          "runtime-invalid-response",
          true,
        );
      }
      return;
    }
    if (Array.isArray(candidate)) {
      const keys = Reflect.ownKeys(candidate);
      const expected = [
        ...Array.from({ length: candidate.length }, (_, index) => String(index)),
        "length",
      ];
      if (
        keys.length !== expected.length ||
        expected.some((key) => !keys.includes(key))
      ) {
        throw new PredictionV2RouteRuntimeErrorV2(
          503,
          "runtime-invalid-response",
          true,
        );
      }
      for (let index = 0; index < candidate.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          candidate,
          String(index),
        );
        if (
          !descriptor ||
          descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, "value")
        ) {
          throw new PredictionV2RouteRuntimeErrorV2(
            503,
            "runtime-invalid-response",
            true,
          );
        }
        visit(descriptor.value, depth + 1);
      }
      return;
    }
    if (
      typeof candidate !== "object" ||
      candidate === null ||
      Object.getPrototypeOf(candidate) !== Object.prototype
    ) {
      throw new PredictionV2RouteRuntimeErrorV2(
        503,
        "runtime-invalid-response",
        true,
      );
    }
    for (const key of Reflect.ownKeys(candidate)) {
      const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
      if (
        typeof key !== "string" ||
        key.length === 0 ||
        key.length > 128 ||
        !descriptor ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, "value") ||
        (unsignedOnly && FORBIDDEN_RESPONSE_FIELDS.has(
          key.toLowerCase().replaceAll("_", "").replaceAll("-", ""),
        ))
      ) {
        throw new PredictionV2RouteRuntimeErrorV2(
          503,
          "runtime-invalid-response",
          true,
        );
      }
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    throw new PredictionV2RouteRuntimeErrorV2(
      503,
      "runtime-invalid-response",
      true,
    );
  }
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new PredictionV2RouteRuntimeErrorV2(
      503,
      "runtime-invalid-response",
      true,
    );
  }
  const cloned = JSON.parse(text) as PredictionV2RouteJsonObjectV2;
  const freeze = (candidate: PredictionV2RouteJsonValueV2): void => {
    if (candidate === null || typeof candidate !== "object") return;
    if (Array.isArray(candidate)) {
      for (const item of candidate) freeze(item);
    } else {
      for (const item of Object.values(candidate)) freeze(item);
    }
    Object.freeze(candidate);
  };
  freeze(cloned);
  return Object.freeze({ body: cloned, text });
}

function reservationResponse(
  reservation: Exclude<PredictionV2RouteBudgetReservationV2, {
    status: "reserved";
  }>,
) {
  if (reservation.status === "rate-limited") {
    return errorResponse(
      429,
      "rate-limited",
      "Too many prediction-market requests",
      true,
      reservation.retryAfterSeconds,
    );
  }
  if (reservation.status === "in-progress") {
    return errorResponse(
      409,
      "request-in-progress",
      "This request is already in progress",
      true,
      reservation.retryAfterSeconds ?? 1,
    );
  }
  return runtimeUnavailable(reservation.retryAfterSeconds ?? 30);
}

async function executeWithBudget(input: Readonly<{
  runtime: PredictionV2RouteRuntimeV2;
  request: Request;
  action: PredictionV2RouteBudgetActionV2;
  idempotencyKeyMaterial: string;
  requestFingerprintMaterial: string;
  unsignedOnly: boolean;
  execute(lease: PredictionV2RouteBudgetLeaseV2):
    Promise<PredictionV2RouteJsonObjectV2>;
}>): Promise<Response> {
  let reservation: PredictionV2RouteBudgetReservationV2;
  try {
    reservation = await input.runtime.reserve({
      action: input.action,
      request: input.request,
      idempotencyKeyMaterial: input.idempotencyKeyMaterial,
      requestFingerprintMaterial: input.requestFingerprintMaterial,
    });
  } catch {
    return runtimeUnavailable();
  }
  if (reservation.status !== "reserved") {
    return reservationResponse(reservation);
  }
  const lease = reservation.lease;
  let startAttempted = false;
  let responseBody: PredictionV2RouteJsonObjectV2;
  let responseText: string;
  try {
    const nowMs = input.runtime.nowMs();
    if (
      !Number.isSafeInteger(nowMs) ||
      !Number.isSafeInteger(lease.expiresAtMs) ||
      lease.expiresAtMs <= nowMs
    ) {
      await input.runtime.cancel(lease).catch(() => undefined);
      return runtimeUnavailable(1);
    }
    if (input.request.signal.aborted) {
      await input.runtime.cancel(lease).catch(() => undefined);
      return runtimeUnavailable(1);
    }
    let startResult: "started" | "not-started";
    startAttempted = true;
    try {
      startResult = await input.runtime.start(lease);
    } catch {
      // A lost acknowledgement is ambiguous. It may already be started, so a
      // refund would let repeated failures bypass the provider budget.
      return runtimeUnavailable();
    }
    if (startResult !== "started") {
      return runtimeUnavailable();
    }
    if (input.request.signal.aborted) {
      // The start CAS consumed the lease. Abort prevents provider work but can
      // never turn consumed capacity back into a refundable reservation.
      return runtimeUnavailable(1);
    }
    responseBody = await input.execute(lease);
    if (input.request.signal.aborted) {
      throw new PredictionV2RouteRuntimeErrorV2(
        503,
        "request-aborted",
        true,
        1,
      );
    }
    const sealed = sealedJsonResponseBody(responseBody, input.unsignedOnly);
    responseBody = sealed.body;
    responseText = sealed.text;
    await input.runtime.commit({ lease, result: responseBody });
  } catch (error) {
    if (!startAttempted) {
      await input.runtime.cancel(lease).catch(() => undefined);
    }
    if (error instanceof PredictionV2RouteRuntimeErrorV2) {
      return errorResponse(
        error.status,
        error.code,
        error.status === 404 ? "Prediction market not found" :
          error.status === 400 ? "The request is invalid" :
            "Prediction markets are temporarily unavailable",
        error.retryable,
        error.retryAfterSeconds,
      );
    }
    return runtimeUnavailable();
  }
  return jsonTextResponse(responseText!, 200);
}

export function createPredictionV2DirectoryRouteHandler(
  dependencies: PredictionV2RouteDependenciesV2,
) {
  return async function predictionV2Directory(request: Request) {
    const enabled = await enabledRuntime(dependencies);
    if (enabled instanceof Response) return enabled;
    let intent: PredictionV2DirectoryIntentV2;
    try {
      intent = parseDirectoryIntent(request);
    } catch {
      return invalidRequest();
    }
    return executeWithBudget({
      runtime: enabled.runtime,
      request,
      action: "directory",
      idempotencyKeyMaterial: "",
      requestFingerprintMaterial:
        `directory\n${intent.limit}\n${intent.cursor ?? ""}`,
      unsignedOnly: false,
      execute: (lease) => enabled.runtime.readDirectory({
        release: enabled.release,
        intent,
        lease,
        signal: request.signal,
      }),
    });
  };
}

export function createPredictionV2RedeemPrepareRouteHandler(
  dependencies: PredictionV2RouteDependenciesV2,
) {
  return async function predictionV2RedeemPrepare(request: Request) {
    const enabled = await enabledRuntime(dependencies);
    if (enabled instanceof Response) return enabled;
    let intent: PredictionV2RedeemPrepareIntentV2;
    try {
      intent = await parseRedeemIntent(request);
      assertMarketReleaseBinding(enabled.release, intent.marketKey);
    } catch (error) {
      if (error instanceof PredictionV2RouteRuntimeErrorV2) {
        return errorResponse(
          error.status,
          error.code,
          error.status === 413 ? "The request is too large" :
            error.status === 415 ? "Use application/json" :
              "The request is invalid",
          error.retryable,
          error.retryAfterSeconds,
        );
      }
      return invalidRequest();
    }
    return executeWithBudget({
      runtime: enabled.runtime,
      request,
      action: "redeem-prepare",
      idempotencyKeyMaterial: intent.actionId,
      requestFingerprintMaterial: JSON.stringify(intent),
      unsignedOnly: true,
      execute: (lease) => enabled.runtime.prepareRedeem({
        release: enabled.release,
        intent,
        lease,
        signal: request.signal,
      }),
    });
  };
}

export function createPredictionV2ResolutionDecisionRouteHandler(
  dependencies: PredictionV2RouteDependenciesV2,
) {
  return async function predictionV2ResolutionDecision(request: Request) {
    const enabled = await enabledRuntime(dependencies);
    if (enabled instanceof Response) return enabled;
    let intent: PredictionV2ResolutionDecisionIntentV2;
    try {
      intent = await parseResolutionIntent(request);
      assertMarketReleaseBinding(enabled.release, intent.marketKey);
    } catch (error) {
      if (error instanceof PredictionV2RouteRuntimeErrorV2) {
        return errorResponse(
          error.status,
          error.code,
          error.status === 413 ? "The request is too large" :
            error.status === 415 ? "Use application/json" :
              "The request is invalid",
          error.retryable,
          error.retryAfterSeconds,
        );
      }
      return invalidRequest();
    }
    return executeWithBudget({
      runtime: enabled.runtime,
      request,
      action: "resolution-decision",
      idempotencyKeyMaterial: intent.actionId,
      requestFingerprintMaterial: JSON.stringify(intent),
      unsignedOnly: true,
      execute: (lease) => enabled.runtime.decideResolution({
        release: enabled.release,
        intent,
        lease,
        signal: request.signal,
      }),
    });
  };
}
