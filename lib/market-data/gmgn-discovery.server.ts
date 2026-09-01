import "server-only";

import { unstable_cache } from "next/cache";

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
// Cold database readiness and account-wide scheduling must not consume the
// provider's response budget after a slot has actually been reserved.
const GMGN_ACCOUNT_GATE_WAIT_TIMEOUT_MS = 5_000;
const GMGN_PROVIDER_WORK_TIMEOUT_MS =
  GMGN_ACCOUNT_GATE_WAIT_TIMEOUT_MS + GMGN_REQUEST_TIMEOUT_MS;
const GMGN_ACCOUNT_GATE_OUTCOME_TIMEOUT_MS = 3_000;
const GMGN_PROVIDER_LIFECYCLE_GRACE_MS =
  GMGN_ACCOUNT_GATE_OUTCOME_TIMEOUT_MS + 500;
const GMGN_RESPONSE_MAXIMUM_BYTES = 1_000_000;
const GMGN_DISCOVERY_CACHE_TTL_MS = 30_000;
const GMGN_DURABLE_CACHE_REVALIDATE_SECONDS = 60;
// Explore responses can spend up to 60 seconds in the public edge cache. Keep
// the shared GMGN authority inside the remaining 235-second origin budget so
// it cannot outlive the five-minute public freshness contract.
const GMGN_DURABLE_CACHE_MAXIMUM_AGE_MS = 235_000;
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
type NormalizedDiscoveryOptionsV1 = Readonly<{
  interval: GmgnDiscoveryIntervalV1;
  limit: number;
  orderBy: "marketcap" | null;
  direction: "asc" | "desc" | null;
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
  if (
    apiKey === null ||
    normalizedQuery === null ||
    !callerCanWait(wait)
  ) return null;
  const key = `search:${normalizedQuery}`;
  return readThroughCache(
    searchCache,
    searchInFlight,
    key,
    wait,
    (providerWait) => readGmgnSearchSnapshotFromProviderV1(
      normalizedQuery,
      apiKey,
      providerWait,
    ),
  );
}

async function readGmgnEthereumDiscoveryV1(
  kind: GmgnDiscoveryKindV1,
  options: GmgnTrendingReadOptionsV1,
  wait: GmgnDiscoveryReadWaitV1,
): Promise<GmgnDiscoverySnapshotV1 | null> {
  const apiKey = readApiKey();
  const normalized = normalizeOptions(kind, options);
  if (
    apiKey === null ||
    normalized === null ||
    !callerCanWait(wait)
  ) return null;
  const key = [
    kind,
    normalized.interval,
    normalized.limit,
    normalized.orderBy ?? "default",
    normalized.direction ?? "default",
  ].join(":");
  if (durableCacheEligible(wait)) {
    const durable = await waitForCaller(
      readDurablyCachedGmgnDiscoverySnapshotV1(
        kind,
        normalized.interval,
        normalized.limit,
        normalized.orderBy,
        normalized.direction,
      ).then(
        (snapshot) => ({ status: "snapshot" as const, snapshot }),
        () => ({ status: "unavailable" as const }),
      ),
      wait,
    );
    if (durable === null || durable.status === "unavailable") return null;
    if (durableSnapshotCurrent(durable.snapshot.fetchedAt)) {
      return durable.snapshot;
    }

    // Next may return a stale entry while it revalidates in the background.
    // Fail closed here: a module-local provider result could differ between
    // serverless isolates and therefore cannot be pagination authority.
    return null;
  }
  return readThroughCache(
    discoveryCache,
    discoveryInFlight,
    key,
    wait,
    (providerWait) => readGmgnDiscoverySnapshotFromProviderV1(
      kind,
      normalized,
      apiKey,
      providerWait,
    ),
  );
}

function normalizeOptions(
  kind: GmgnDiscoveryKindV1,
  options: GmgnTrendingReadOptionsV1,
): NormalizedDiscoveryOptionsV1 | null {
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

async function readGmgnDiscoverySnapshotFromProviderV1(
  kind: GmgnDiscoveryKindV1,
  normalized: NormalizedDiscoveryOptionsV1,
  apiKey: string,
  providerWait: GmgnDiscoveryReadWaitV1,
): Promise<GmgnDiscoverySnapshotV1 | null> {
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
}

async function readGmgnSearchSnapshotFromProviderV1(
  normalizedQuery: string,
  apiKey: string,
  providerWait: GmgnDiscoveryReadWaitV1,
): Promise<GmgnSearchSnapshotV1 | null> {
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
}

// The Next Data Cache shares completed discovery snapshots across serverless
// isolates. A failed provider read rejects the fill so `null` and errors are
// never persisted. The inner read keeps the existing account-gate and
// singleflight lifecycle, but receives no caller signal or deadline.
const readDurablyCachedGmgnDiscoverySnapshotV1 = unstable_cache(
  async (
    kind: GmgnDiscoveryKindV1,
    interval: GmgnDiscoveryIntervalV1,
    limit: number,
    orderBy: "marketcap" | null,
    direction: "asc" | "desc" | null,
  ) => {
    const apiKey = readApiKey();
    if (apiKey === null) throw new Error("GMGN discovery is not configured");
    const key = [
      kind,
      interval,
      limit,
      orderBy ?? "default",
      direction ?? "default",
    ].join(":");
    const snapshot = await readThroughCache(
      discoveryCache,
      discoveryInFlight,
      key,
      {},
      (providerWait) => readGmgnDiscoverySnapshotFromProviderV1(
        kind,
        { interval, limit, orderBy, direction },
        apiKey,
        providerWait,
      ),
    );
    if (snapshot === null) {
      throw new Error("GMGN discovery snapshot is unavailable");
    }
    return snapshot;
  },
  ["programmable-gmgn-ethereum-discovery-v2"],
  { revalidate: GMGN_DURABLE_CACHE_REVALIDATE_SECONDS },
);

function durableCacheEligible(wait: GmgnDiscoveryReadWaitV1): boolean {
  return wait.fetchImpl === undefined &&
    wait.now === undefined &&
    wait.accountGate === undefined;
}

function durableSnapshotCurrent(fetchedAt: string): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  const nowMs = Date.now();
  return Number.isFinite(fetchedAtMs) &&
    fetchedAtMs <= nowMs &&
    nowMs - fetchedAtMs <= GMGN_DURABLE_CACHE_MAXIMUM_AGE_MS;
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
    const promise = settleProviderReadLifecycle(providerRead, operation).then(
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
      ? startedAtMs + GMGN_PROVIDER_WORK_TIMEOUT_MS
      : Date.now() + GMGN_PROVIDER_WORK_TIMEOUT_MS,
  });
}

function providerOperation(wait: GmgnDiscoveryReadWaitV1): ProviderOperationV1 {
  const now = wait.now ?? (() => new Date());
  return Object.freeze({
    deadlineMs: wait.deadlineMs ??
      now().getTime() + GMGN_PROVIDER_WORK_TIMEOUT_MS,
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
    const settled = await Promise.race([
      pending,
      new Promise<typeof PROVIDER_OPERATION_TIMED_OUT>((resolve) => {
        timer = setTimeout(
          () => resolve(PROVIDER_OPERATION_TIMED_OUT),
          Math.min(remainingMs, 2_147_483_647),
        );
      }),
    ]);
    if (settled === PROVIDER_OPERATION_TIMED_OUT) {
      void pending.catch(() => undefined);
    }
    return settled;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function settleProviderReadLifecycle<Value>(
  pending: Promise<Value>,
  requestOperation: ProviderOperationV1,
): Promise<Value | typeof PROVIDER_OPERATION_TIMED_OUT> {
  const timely = await settleProviderOperation(pending, requestOperation);
  if (timely !== PROVIDER_OPERATION_TIMED_OUT) return timely;

  // Keep the singleflight alive while a timed-out provider call finalizes its
  // exact database lease, without accepting a late provider response.
  await settleProviderOperation(
    pending,
    providerLifecycleOperation(),
  );
  return PROVIDER_OPERATION_TIMED_OUT;
}

function providerLifecycleOperation(): ProviderOperationV1 {
  const startedAtMs = Date.now();
  return Object.freeze({
    now: () => new Date(),
    deadlineMs: startedAtMs + GMGN_PROVIDER_LIFECYCLE_GRACE_MS,
  });
}

function providerOutcomeOperation(): ProviderOperationV1 {
  const startedAtMs = Date.now();
  return Object.freeze({
    now: () => new Date(),
    deadlineMs: startedAtMs + GMGN_ACCOUNT_GATE_OUTCOME_TIMEOUT_MS,
  });
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
  const lateOutcome = providerOutcomeOperation();
  const lateDecision = await settleProviderOperation(pending, lateOutcome);
  if (lateDecision !== PROVIDER_OPERATION_TIMED_OUT) {
    if (lateDecision?.kind === "reserved") {
      await completeProviderRequest(accountGate, lateDecision, lateOutcome);
    }
    return null;
  }

  // A gate implementation that outlives both bounded budgets must still
  // release the exact late lease if it eventually commits.
  void pending.then(async (decision) => {
    if (decision?.kind !== "reserved") return;
    await completeProviderRequest(accountGate, decision);
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
    queuedAtMs + GMGN_PROVIDER_WORK_TIMEOUT_MS;
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
  const gateDeadlineMs = Math.min(
    requestDeadlineMs,
    queuedAtMs + GMGN_ACCOUNT_GATE_WAIT_TIMEOUT_MS,
  );
  const gateOperation = Object.freeze({ deadlineMs: gateDeadlineMs, now });
  try {
    if (
      accountGate === null &&
      (process.env.NODE_ENV === "production" || fetchImpl === fetch)
    ) accountGate = getProductionGmgnAccountGateV1();
    if (accountGate !== null) {
      const decision = await reserveProviderSlot(accountGate, {
        requestsPerSecond: gmgnEffectiveRequestsPerSecondV1(),
        cost: endpointCost(path),
        deadlineMs: gateDeadlineMs,
        signal: wait.signal,
      }, gateOperation);
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
    await completeProviderRequest(accountGate, reservation);
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
    await completeProviderRequest(accountGate, reservation);
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
    );
  } else if (!await completeProviderRequest(
    accountGate,
    reservation,
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
): Promise<void> {
  if (response.status !== 429) {
    await completeProviderRequest(accountGate, reservation);
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
    await settleProviderOperation(pending, providerOutcomeOperation());
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
  outcomeOperation: ProviderOperationV1 = providerOutcomeOperation(),
): Promise<boolean> {
  if (accountGate === null) return true;
  if (reservation === null) return false;
  try {
    const settled = await settleProviderOperation(
      accountGate.complete(reservation),
      outcomeOperation,
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
