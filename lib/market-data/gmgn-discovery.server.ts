import "server-only";

import {
  getProductionGmgnAccountGateV1,
  type GmgnAccountGateCostV1,
  type GmgnAccountGateV1,
} from "./gmgn-account-gate.server";
import { gmgnEffectiveRequestsPerSecondV1 } from
  "./gmgn-runtime-config.server";
import {
  GMGN_DISCOVERY_INTERVALS,
  GMGN_HOT_SEARCH_MAXIMUM_LIMIT,
  GMGN_TRENDING_MAXIMUM_LIMIT,
  normalizeGmgnSearchQueryV1,
  parseGmgnDiscoverySnapshotV1,
  parseGmgnSearchSnapshotV1,
  type GmgnDiscoveryIntervalV1,
  type GmgnDiscoveryKindV1,
  type GmgnDiscoverySnapshotV1,
  type GmgnSearchSnapshotV1,
} from "./gmgn-discovery-v1";

const GMGN_API_ORIGIN = "https://openapi.gmgn.ai" as const;
const GMGN_REQUEST_TIMEOUT_MS = 2_500;
const GMGN_RESPONSE_MAXIMUM_BYTES = 1_000_000;
const GMGN_DISCOVERY_CACHE_TTL_MS = 30_000;
const GMGN_MAXIMUM_CACHE_ENTRIES = 64;
const GMGN_MAXIMUM_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const PROVIDER_OPERATION_TIMED_OUT = Symbol("provider-operation-timed-out");

type FetchImplementation = typeof fetch;
type GmgnDiscoveryPath = "/v1/market/rank" |
  "/v1/market/hot_searches" |
  "/v1/market/search";
type ProviderOperationV1 = Readonly<{
  deadlineMs: number;
  now: () => Date;
}>;

export type GmgnDiscoveryReadWaitV1 = Readonly<{
  signal?: AbortSignal;
  deadlineMs?: number;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
  accountGate?: GmgnAccountGateV1;
}>;

export type GmgnDiscoveryReadOptionsV1 = Readonly<{
  interval?: GmgnDiscoveryIntervalV1;
  limit?: number;
}>;

export type GmgnTrendingReadOptionsV1 = GmgnDiscoveryReadOptionsV1 & Readonly<{
  orderBy?: "marketcap";
  direction?: "asc" | "desc";
}>;

type CachedValue<T> = Readonly<{
  expiresAtMs: number;
  value: T;
}>;

const discoveryCache = new Map<
  string,
  CachedValue<GmgnDiscoverySnapshotV1>
>();
const discoveryInFlight = new Map<
  string,
  Promise<GmgnDiscoverySnapshotV1 | null>
>();
const searchCache = new Map<
  string,
  CachedValue<GmgnSearchSnapshotV1>
>();
const searchInFlight = new Map<
  string,
  Promise<GmgnSearchSnapshotV1 | null>
>();
let localBlockedUntilMs = 0;

export function gmgnDiscoveryConfiguredV1(): boolean {
  return readApiKey() !== null;
}

export async function readGmgnEthereumTrendingV1(
  options: GmgnTrendingReadOptionsV1 = {},
  wait: GmgnDiscoveryReadWaitV1 = {},
): Promise<GmgnDiscoverySnapshotV1 | null> {
  return readGmgnEthereumDiscoveryV1("trending", options, wait);
}

export async function readGmgnEthereumHotSearchesV1(
  options: GmgnDiscoveryReadOptionsV1 = {},
  wait: GmgnDiscoveryReadWaitV1 = {},
): Promise<GmgnDiscoverySnapshotV1 | null> {
  return readGmgnEthereumDiscoveryV1("hot-search", options, wait);
}

export async function readGmgnEthereumSearchV1(
  query: string,
  wait: GmgnDiscoveryReadWaitV1 = {},
): Promise<GmgnSearchSnapshotV1 | null> {
  const apiKey = readApiKey();
  const normalizedQuery = normalizeGmgnSearchQueryV1(query);
  if (apiKey === null || normalizedQuery === null) return null;
  const key = `search:${normalizedQuery}`;
  return readThroughCache(
    searchCache,
    searchInFlight,
    key,
    wait,
    async (providerWait) => {
      const data = await gmgnJsonRequest(
        "/v1/market/search",
        {
          query: {
            query: normalizedQuery,
            chain: "eth",
            order_by: "weight",
          },
          body: null,
        },
        apiKey,
        providerWait,
      );
      return parseGmgnSearchSnapshotV1(data, {
        query: normalizedQuery,
        fetchedAt: currentDate(providerWait),
      });
    },
  );
}

async function readGmgnEthereumDiscoveryV1(
  kind: GmgnDiscoveryKindV1,
  options: GmgnTrendingReadOptionsV1,
  wait: GmgnDiscoveryReadWaitV1,
): Promise<GmgnDiscoverySnapshotV1 | null> {
  const apiKey = readApiKey();
  const normalized = normalizeOptions(kind, options);
  if (apiKey === null || normalized === null) return null;
  const key = [
    kind,
    normalized.interval,
    normalized.limit,
    normalized.orderBy ?? "default",
    normalized.direction ?? "default",
  ].join(":");
  return readThroughCache(
    discoveryCache,
    discoveryInFlight,
    key,
    wait,
    async (providerWait) => {
    const path = kind === "trending"
      ? "/v1/market/rank" as const
      : "/v1/market/hot_searches" as const;
    const data = await gmgnJsonRequest(
      path,
      kind === "trending"
        ? {
            query: {
              chain: "eth",
              interval: normalized.interval,
              limit: String(normalized.limit),
              ...(normalized.orderBy === null
                ? {}
                : {
                    order_by: normalized.orderBy,
                    direction: normalized.direction ?? "desc",
                  }),
            },
            body: null,
          }
        : {
            query: {},
            body: {
              params: [{
                label: "hot-search",
                chain: "eth",
                interval: normalized.interval,
                limit: normalized.limit,
              }],
            },
      },
      apiKey,
      providerWait,
    );
    return parseGmgnDiscoverySnapshotV1(data, {
      kind,
      interval: normalized.interval,
      ...(normalized.orderBy === null
        ? {}
        : {
            orderBy: normalized.orderBy,
            direction: normalized.direction ?? "desc",
          }),
      limit: normalized.limit,
      fetchedAt: currentDate(providerWait),
    });
    },
  );
}

function normalizeOptions(
  kind: GmgnDiscoveryKindV1,
  options: GmgnTrendingReadOptionsV1,
): Readonly<{
  interval: GmgnDiscoveryIntervalV1;
  limit: number;
  orderBy: "marketcap" | null;
  direction: "asc" | "desc" | null;
}> | null {
  const interval = options.interval ?? (kind === "trending" ? "1h" : "24h");
  const maximum = kind === "trending"
    ? GMGN_TRENDING_MAXIMUM_LIMIT
    : GMGN_HOT_SEARCH_MAXIMUM_LIMIT;
  const limit = options.limit ?? maximum;
  const orderBy = options.orderBy ?? null;
  const direction = orderBy === null ? null : options.direction ?? "desc";
  if (
    !GMGN_DISCOVERY_INTERVALS.includes(interval) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > maximum ||
    (kind === "hot-search" &&
      (options.orderBy !== undefined || options.direction !== undefined)) ||
    (kind === "trending" &&
      ((orderBy !== null && orderBy !== "marketcap") ||
        (options.direction !== undefined && orderBy === null) ||
        (direction !== null && direction !== "asc" && direction !== "desc")))
  ) return null;
  return Object.freeze({ interval, limit, orderBy, direction });
}

async function readThroughCache<Value>(
  cache: Map<string, CachedValue<Value>>,
  inFlight: Map<string, Promise<Value | null>>,
  key: string,
  wait: GmgnDiscoveryReadWaitV1,
  read: (
    providerWait: GmgnDiscoveryReadWaitV1,
  ) => Promise<Value | null>,
): Promise<Value | null> {
  if (!callerCanWait(wait)) return null;
  const nowMs = currentDate(wait).getTime();
  const cached = cache.get(key);
  if (cached && cached.expiresAtMs > nowMs) {
    return waitForCaller(cached.value, wait);
  }
  if (cached) cache.delete(key);
  let active = inFlight.get(key);
  if (!active) {
    const providerWait = providerWorkWait(wait);
    const operation = providerOperation(providerWait);
    const providerRead = read(providerWait);
    const promise = settleProviderOperation(providerRead, operation).then(
      (settled) => settled === PROVIDER_OPERATION_TIMED_OUT ? null : settled,
    ).then((value) => {
      if (value !== null) {
          setCacheValue(
            cache,
            key,
            value,
          currentDate(providerWait).getTime() + GMGN_DISCOVERY_CACHE_TTL_MS,
        );
      }
      return value;
    }).catch(() => null).finally(() => {
      if (inFlight.get(key) === promise) {
        inFlight.delete(key);
      }
    });
    inFlight.set(key, promise);
    active = promise;
  }
  return waitForCaller(active, wait);
}

function providerWorkWait(
  callerWait: GmgnDiscoveryReadWaitV1,
): GmgnDiscoveryReadWaitV1 {
  const now = callerWait.now ?? (() => new Date());
  const startedAtMs = now().getTime();
  return Object.freeze({
    fetchImpl: callerWait.fetchImpl,
    accountGate: callerWait.accountGate,
    now,
    deadlineMs: Number.isFinite(startedAtMs)
      ? startedAtMs + GMGN_REQUEST_TIMEOUT_MS
      : Date.now() + GMGN_REQUEST_TIMEOUT_MS,
  });
}

function providerOperation(wait: GmgnDiscoveryReadWaitV1): ProviderOperationV1 {
  const now = wait.now ?? (() => new Date());
  return Object.freeze({
    deadlineMs: wait.deadlineMs ?? now().getTime() + GMGN_REQUEST_TIMEOUT_MS,
    now,
  });
}

async function settleProviderOperation<Value>(
  pending: Promise<Value>,
  operation: ProviderOperationV1,
): Promise<Value | typeof PROVIDER_OPERATION_TIMED_OUT> {
  const nowMs = operation.now().getTime();
  const remainingMs = operation.deadlineMs - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    void pending.catch(() => undefined);
    return PROVIDER_OPERATION_TIMED_OUT;
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      pending,
      new Promise<typeof PROVIDER_OPERATION_TIMED_OUT>((resolve) => {
        timer = setTimeout(
          () => resolve(PROVIDER_OPERATION_TIMED_OUT),
          Math.min(remainingMs, 2_147_483_647),
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function waitForCaller<Value>(
  value: Value | Promise<Value | null>,
  wait: GmgnDiscoveryReadWaitV1,
): Promise<Value | null> {
  if (!(value instanceof Promise)) {
    return callerCanWait(wait) ? value : null;
  }
  const nowMs = currentDate(wait).getTime();
  const remainingMs = wait.deadlineMs === undefined
    ? null
    : wait.deadlineMs - nowMs;
  if (
    wait.signal?.aborted ||
    !Number.isFinite(nowMs) ||
    (remainingMs !== null &&
      (!Number.isFinite(remainingMs) || remainingMs <= 0))
  ) return null;
  if (wait.signal === undefined && remainingMs === null) return value;

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: Value | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      wait.signal?.removeEventListener("abort", abort);
      resolve(result);
    };
    const abort = () => finish(null);
    wait.signal?.addEventListener("abort", abort, { once: true });
    if (wait.signal?.aborted) {
      finish(null);
      return;
    }
    if (remainingMs !== null) {
      timer = setTimeout(abort, Math.min(remainingMs, 2_147_483_647));
    }
    value.then(finish, () => finish(null));
  });
}

function callerCanWait(wait: GmgnDiscoveryReadWaitV1): boolean {
  if (wait.signal?.aborted) return false;
  const nowMs = currentDate(wait).getTime();
  return Number.isFinite(nowMs) &&
    (wait.deadlineMs === undefined ||
      (Number.isFinite(wait.deadlineMs) && wait.deadlineMs > nowMs));
}

async function reserveProviderSlot(
  accountGate: GmgnAccountGateV1,
  input: Parameters<GmgnAccountGateV1["reserveSlot"]>[0],
  operation: ProviderOperationV1,
): Promise<Awaited<ReturnType<GmgnAccountGateV1["reserveSlot"]>>> {
  const pending = accountGate.reserveSlot(input);
  const settled = await settleProviderOperation(pending, operation);
  if (settled !== PROVIDER_OPERATION_TIMED_OUT) return settled;

  // A database query that ignores its AbortSignal may reserve after the local
  // operation deadline. Release that exact late lease without allowing it to
  // trigger a provider request or keep this singleflight pending.
  void pending.then(async (decision) => {
    if (decision?.kind !== "reserved") return;
    try {
      await accountGate.complete(decision);
    } catch {
      // The database gate retains its bounded five-minute lease on failure.
    }
  }).catch(() => undefined);
  return null;
}

async function gmgnJsonRequest(
  path: GmgnDiscoveryPath,
  request: Readonly<{
    query: Readonly<Record<string, string>>;
    body: Readonly<Record<string, unknown>> | null;
  }>,
  apiKey: string,
  wait: GmgnDiscoveryReadWaitV1,
): Promise<unknown | null> {
  const fetchImpl = wait.fetchImpl ?? fetch;
  const now = wait.now ?? (() => new Date());
  const queuedAtMs = now().getTime();
  const requestDeadlineMs = wait.deadlineMs ??
    queuedAtMs + GMGN_REQUEST_TIMEOUT_MS;
  if (
    wait.signal?.aborted ||
    !Number.isFinite(queuedAtMs) ||
    !Number.isFinite(requestDeadlineMs) ||
    requestDeadlineMs <= queuedAtMs ||
    localBlockedUntilMs > queuedAtMs
  ) return null;

  let accountGate: GmgnAccountGateV1 | null = wait.accountGate ?? null;
  let reservation: Extract<
    Awaited<ReturnType<GmgnAccountGateV1["reserveSlot"]>>,
    { kind: "reserved" }
  > | null = null;
  const operation = Object.freeze({ deadlineMs: requestDeadlineMs, now });
  try {
    if (
      accountGate === null &&
      (process.env.NODE_ENV === "production" || fetchImpl === fetch)
    ) accountGate = getProductionGmgnAccountGateV1();
    if (accountGate !== null) {
      const decision = await reserveProviderSlot(accountGate, {
        requestsPerSecond: gmgnEffectiveRequestsPerSecondV1(),
        cost: endpointCost(path),
        deadlineMs: requestDeadlineMs,
        signal: wait.signal,
      }, operation);
      if (decision?.kind !== "reserved") return null;
      reservation = decision;
    }
  } catch {
    // A production request must never bypass the shared database gate.
    return null;
  }

  const nowMs = now().getTime();
  const remainingMs = requestDeadlineMs - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    await completeProviderRequest(accountGate, reservation, operation);
    return null;
  }
  const url = new URL(path, GMGN_API_ORIGIN);
  for (const [key, value] of Object.entries(request.query)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("timestamp", String(Math.floor(nowMs / 1_000)));
  url.searchParams.set("client_id", crypto.randomUUID());
  const method = request.body === null ? "GET" : "POST";
  const timeout = AbortSignal.timeout(
    Math.max(1, Math.min(GMGN_REQUEST_TIMEOUT_MS, remainingMs)),
  );
  const signal = wait.signal
    ? AbortSignal.any([wait.signal, timeout])
    : timeout;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(request.body === null ? {} : { "Content-Type": "application/json" }),
        "X-APIKEY": apiKey,
      },
      body: request.body === null ? undefined : JSON.stringify(request.body),
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal,
    });
  } catch {
    await completeProviderRequest(accountGate, reservation, operation);
    return null;
  }

  const declaredLength = Number(response.headers.get("Content-Length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > GMGN_RESPONSE_MAXIMUM_BYTES
  ) {
    const responseAtMs = currentTimestampMs(now, nowMs);
    cancelResponseBody(response);
    await finalizeRejectedResponse(
      accountGate,
      reservation,
      response,
      null,
      responseAtMs,
      operation,
    );
    return null;
  }
  const bytes = await readBoundedResponseBytes(
    response,
    GMGN_RESPONSE_MAXIMUM_BYTES,
  );
  if (bytes === null) {
    const responseAtMs = currentTimestampMs(now, nowMs);
    await finalizeRejectedResponse(
      accountGate,
      reservation,
      response,
      null,
      responseAtMs,
      operation,
    );
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const responseAtMs = currentTimestampMs(now, nowMs);
    await finalizeRejectedResponse(
      accountGate,
      reservation,
      response,
      null,
      responseAtMs,
      operation,
    );
    return null;
  }
  const envelope = safeJson(text);
  const responseAtMs = currentTimestampMs(now, nowMs);
  const rateLimited = response.status === 429 ||
    isRateLimitedEnvelope(envelope);
  if (rateLimited) {
    const blockedUntilMs = providerCooldownFromResponse(
      response.headers,
      envelope,
      responseAtMs,
    );
    localBlockedUntilMs = Math.max(localBlockedUntilMs, blockedUntilMs);
    await publishProviderBlock(
      accountGate,
      reservation,
      response,
      envelope,
      responseAtMs,
      operation,
    );
  } else if (!await completeProviderRequest(
    accountGate,
    reservation,
    operation,
  )) {
    return null;
  }
  if (
    !response.ok ||
    rateLimited ||
    !isRecord(envelope) ||
    (envelope.code !== 0 && envelope.code !== "0") ||
    envelope.data === undefined
  ) return null;
  // Preserve the provider envelope so the schema parser can validate every
  // explicit outer and nested chain declaration before unwrapping its data.
  return envelope;
}

function endpointCost(path: GmgnDiscoveryPath): GmgnAccountGateCostV1 {
  return path === "/v1/market/hot_searches" ? 3 : 1;
}

async function finalizeRejectedResponse(
  accountGate: GmgnAccountGateV1 | null,
  reservation: Extract<
    Awaited<ReturnType<GmgnAccountGateV1["reserveSlot"]>>,
    { kind: "reserved" }
  > | null,
  response: Response,
  envelope: unknown,
  nowMs: number,
  operation: ProviderOperationV1,
): Promise<void> {
  if (response.status !== 429) {
    await completeProviderRequest(accountGate, reservation, operation);
    return;
  }
  const blockedUntilMs = providerCooldownFromResponse(
    response.headers,
    envelope,
    nowMs,
  );
  localBlockedUntilMs = Math.max(localBlockedUntilMs, blockedUntilMs);
  await publishProviderBlock(
    accountGate,
    reservation,
    response,
    envelope,
    nowMs,
    operation,
  );
}

async function readBoundedResponseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maximumBytes - total) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function cancelResponseBody(response: Response): void {
  if (response.body === null) return;
  void response.body.cancel().catch(() => undefined);
}

function readApiKey(): string | null {
  const value = process.env.GMGN_API_KEY?.trim();
  return value ? value : null;
}

function isRateLimitedEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const nested = isRecord(value.data) ? value.data : null;
  const joined = [
    value.code,
    value.error,
    value.message,
    nested?.code,
    nested?.error,
    nested?.message,
  ].map((item) => String(item ?? "").toUpperCase()).join(":");
  return joined.includes("429") ||
    joined.includes("RATE_LIMIT_EXCEEDED") ||
    joined.includes("RATE_LIMIT_BANNED");
}

function providerCooldownFromResponse(
  headers: Headers,
  envelope: unknown,
  nowMs: number,
): number {
  const maximum = nowMs + GMGN_MAXIMUM_RATE_LIMIT_COOLDOWN_MS;
  const candidates: number[] = [];
  const resetAt = providerResetAt(envelope);
  if (resetAt !== null && resetAt > 0) {
    candidates.push(Math.max(nowMs, resetAt * 1_000) + 250);
  }
  const retryAfter = headers.get("Retry-After")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const dateMs = Date.parse(retryAfter);
    const candidate = Number.isFinite(seconds)
      ? nowMs + Math.max(0, Math.ceil(seconds * 1_000)) + 250
      : Number.isFinite(dateMs)
        ? Math.max(nowMs, dateMs) + 250
        : Number.NaN;
    if (Number.isFinite(candidate)) candidates.push(candidate);
  }
  const resetHeader = headers.get("x-ratelimit-reset")?.trim();
  const reset = resetHeader ? Number(resetHeader) : Number.NaN;
  if (Number.isFinite(reset)) {
    candidates.push(Math.max(nowMs, Math.ceil(reset * 1_000)) + 250);
  }
  return Math.min(
    maximum,
    candidates.length === 0 ? nowMs + 2_000 : Math.max(...candidates),
  );
}

function providerResetAt(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const direct = unsignedSafeInteger(value.reset_at);
  if (direct !== null) return direct;
  return isRecord(value.data) ? unsignedSafeInteger(value.data.reset_at) : null;
}

async function publishProviderBlock(
  accountGate: GmgnAccountGateV1 | null,
  reservation: Extract<
    Awaited<ReturnType<GmgnAccountGateV1["reserveSlot"]>>,
    { kind: "reserved" }
  > | null,
  response: Response,
  envelope: unknown,
  nowMs: number,
  operation: ProviderOperationV1,
): Promise<void> {
  if (accountGate === null || reservation === null) return;
  try {
    const pending = accountGate.blockUntil({
      reservation,
      blockedUntilMs: providerCooldownFromResponse(
        response.headers,
        envelope,
        nowMs,
      ),
      providerSignal: response.status === 429
        ? "http-429"
        : "provider-envelope",
    });
    await settleProviderOperation(pending, operation);
  } catch {
    // This read already fails soft. A later production request must pass the
    // shared database gate again before another provider call can occur.
  }
}

async function completeProviderRequest(
  accountGate: GmgnAccountGateV1 | null,
  reservation: Extract<
    Awaited<ReturnType<GmgnAccountGateV1["reserveSlot"]>>,
    { kind: "reserved" }
  > | null,
  operation: ProviderOperationV1,
): Promise<boolean> {
  if (accountGate === null) return true;
  if (reservation === null) return false;
  try {
    const settled = await settleProviderOperation(
      accountGate.complete(reservation),
      operation,
    );
    return settled !== PROVIDER_OPERATION_TIMED_OUT;
  } catch {
    return false;
  }
}

function setCacheValue<Value>(
  cache: Map<string, CachedValue<Value>>,
  key: string,
  value: Value,
  expiresAtMs: number,
): void {
  cache.delete(key);
  cache.set(key, { expiresAtMs, value });
  while (cache.size > GMGN_MAXIMUM_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function currentDate(wait: GmgnDiscoveryReadWaitV1): Date {
  return (wait.now ?? (() => new Date()))();
}

function currentTimestampMs(now: () => Date, minimumMs: number): number {
  const value = now().getTime();
  return Number.isFinite(value) ? Math.max(minimumMs, value) : minimumMs;
}

function safeJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function unsignedSafeInteger(value: unknown): number | null {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
