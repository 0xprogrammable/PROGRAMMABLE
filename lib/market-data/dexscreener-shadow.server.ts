import "server-only";

import {
  DEXSCREENER_SHADOW_CURRENCY,
  DEXSCREENER_SHADOW_MAX_TOKENS_PER_REQUEST,
  DEXSCREENER_SHADOW_MINIMUM_FDV_LIQUIDITY_USD_WAD,
  DEXSCREENER_SHADOW_MODE,
  DEXSCREENER_SHADOW_SOURCE,
  PROGRAMMABLE_DEXSCREENER_SHADOW_SCHEMA_VERSION,
  exactJsonNumberLexemeUsdToWadV1,
  exactPositiveDecimalUsdToWadV1,
  type DexscreenerShadowBatchDiagnosticV1,
  type DexscreenerShadowResultV1,
  type DexscreenerShadowSnapshotV1,
  type DexscreenerShadowUnavailableReasonV1,
} from "./dexscreener-shadow-v1";
import {
  isMarketChartIdentityV1,
  type MarketChartIdentityV1,
} from "./market-data-v1";

const DEXSCREENER_TOKENS_ENDPOINT =
  "https://api.dexscreener.com/tokens/v1/ethereum" as const;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_FAILURE_CACHE_TTL_MS = 15_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 2_000_000;
const DEFAULT_MAXIMUM_ROWS_PER_BATCH = 1_000;
const DEFAULT_MAXIMUM_CONCURRENT_BATCHES = 2;
const DEFAULT_MAXIMUM_CACHE_ENTRIES = 32;

// One reader instance begins no more than 80 calls/minute, far below the
// documented 300 calls/minute provider ceiling. Cache and singleflight reduce
// repeated work further; this is never invoked by browser cards.
const DEFAULT_MINIMUM_REQUEST_INTERVAL_MS = 750;

const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const BYTES32 = /^0x[0-9a-f]{64}$/iu;

type FetchImplementation = typeof fetch;

export type DexscreenerShadowReaderOptionsV1 = Readonly<{
  fetchImpl?: FetchImplementation;
  now?: () => Date;
  timeoutMs?: number;
  cacheTtlMs?: number;
  failureCacheTtlMs?: number;
  maximumResponseBytes?: number;
  maximumRowsPerBatch?: number;
  maximumConcurrentBatches?: number;
  minimumRequestIntervalMs?: number;
  maximumCacheEntries?: number;
}>;

export type DexscreenerShadowReaderV1 = Readonly<{
  read(
    identities: readonly MarketChartIdentityV1[],
  ): Promise<DexscreenerShadowSnapshotV1>;
}>;

type SuccessfulBatch = Readonly<{
  diagnostic: DexscreenerShadowBatchDiagnosticV1 & Readonly<{ status: "ok" }>;
  rows: readonly unknown[];
  requestedTokens: readonly `0x${string}`[];
}>;

type FailedBatch = Readonly<{
  diagnostic: DexscreenerShadowBatchDiagnosticV1;
  reason: DexscreenerShadowUnavailableReasonV1;
  requestedTokens: readonly `0x${string}`[];
}>;

type BatchResult = SuccessfulBatch | FailedBatch;

type TokenProviderResult =
  | Readonly<{
      status: "ok";
      rows: readonly unknown[];
      fetchedAt: string;
    }>
  | Readonly<{
      status: "failed";
      reason: DexscreenerShadowUnavailableReasonV1;
      fetchedAt: string;
    }>;

type CachedSnapshot = Readonly<{
  expiresAtMs: number;
  value: DexscreenerShadowSnapshotV1;
}>;

type CachedTokenResult = Readonly<{
  expiresAtMs: number;
  value: TokenProviderResult;
}>;

class DexscreenerShadowTimeoutError extends Error {
  constructor() {
    super("Dexscreener shadow request timed out");
    this.name = "DexscreenerShadowTimeoutError";
  }
}

class DexscreenerShadowResponseTooLargeError extends Error {}
class DexscreenerShadowInvalidResponseError extends Error {}

const LOSSLESS_JSON_NUMBER = Symbol("dexscreener-json-number");
type LosslessJsonNumber = Readonly<{
  [LOSSLESS_JSON_NUMBER]: string;
}>;

export function createDexscreenerShadowReaderV1(
  options: DexscreenerShadowReaderOptionsV1 = {},
): DexscreenerShadowReaderV1 {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const timeoutMs = boundedInteger(
    options.timeoutMs,
    DEFAULT_TIMEOUT_MS,
    1,
    30_000,
    "timeoutMs",
  );
  const cacheTtlMs = boundedInteger(
    options.cacheTtlMs,
    DEFAULT_CACHE_TTL_MS,
    0,
    60 * 60 * 1_000,
    "cacheTtlMs",
  );
  const failureCacheTtlMs = boundedInteger(
    options.failureCacheTtlMs,
    DEFAULT_FAILURE_CACHE_TTL_MS,
    0,
    60 * 1_000,
    "failureCacheTtlMs",
  );
  const maximumResponseBytes = boundedInteger(
    options.maximumResponseBytes,
    DEFAULT_MAXIMUM_RESPONSE_BYTES,
    2,
    10_000_000,
    "maximumResponseBytes",
  );
  const maximumRowsPerBatch = boundedInteger(
    options.maximumRowsPerBatch,
    DEFAULT_MAXIMUM_ROWS_PER_BATCH,
    1,
    10_000,
    "maximumRowsPerBatch",
  );
  const maximumConcurrentBatches = boundedInteger(
    options.maximumConcurrentBatches,
    DEFAULT_MAXIMUM_CONCURRENT_BATCHES,
    1,
    4,
    "maximumConcurrentBatches",
  );
  const minimumRequestIntervalMs = boundedInteger(
    options.minimumRequestIntervalMs,
    DEFAULT_MINIMUM_REQUEST_INTERVAL_MS,
    0,
    10_000,
    "minimumRequestIntervalMs",
  );
  const maximumCacheEntries = boundedInteger(
    options.maximumCacheEntries,
    DEFAULT_MAXIMUM_CACHE_ENTRIES,
    1,
    256,
    "maximumCacheEntries",
  );

  const cache = new Map<string, CachedSnapshot>();
  const inFlight = new Map<string, Promise<DexscreenerShadowSnapshotV1>>();
  const tokenCache = new Map<`0x${string}`, CachedTokenResult>();
  const tokenInFlight = new Map<
    `0x${string}`,
    Promise<TokenProviderResult>
  >();
  const maximumTokenCacheEntries = maximumCacheEntries *
    DEXSCREENER_SHADOW_MAX_TOKENS_PER_REQUEST;
  let nextRequestStartMs = 0;
  let rateSchedule = Promise.resolve();
  let activeBatchCount = 0;
  const batchSlotWaiters: Array<() => void> = [];

  async function acquireBatchSlot() {
    await new Promise<void>((resolve) => {
      if (activeBatchCount < maximumConcurrentBatches) {
        activeBatchCount += 1;
        resolve();
        return;
      }
      batchSlotWaiters.push(resolve);
    });

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = batchSlotWaiters.shift();
      if (next) {
        // The active slot is transferred directly to the oldest waiter.
        next();
        return;
      }
      activeBatchCount -= 1;
    };
  }

  async function waitForRateSlot() {
    let release!: () => void;
    const preceding = rateSchedule;
    rateSchedule = new Promise<void>((resolve) => {
      release = resolve;
    });
    await preceding;
    try {
      const waitMs = Math.max(0, nextRequestStartMs - Date.now());
      if (waitMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
      }
      nextRequestStartMs = Math.max(nextRequestStartMs, Date.now()) +
        minimumRequestIntervalMs;
    } finally {
      release();
    }
  }

  async function requestBatch(
    requestedTokens: readonly `0x${string}`[],
    index: number,
  ): Promise<BatchResult> {
    const releaseBatchSlot = await acquireBatchSlot();
    await waitForRateSlot();
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const request = fetchImpl(
        `${DEXSCREENER_TOKENS_ENDPOINT}/${requestedTokens.join(",")}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
        },
      );
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new DexscreenerShadowTimeoutError());
        }, timeoutMs);
      });
      const response = await Promise.race([request, timeout]);

      if (response.status === 429) {
        abortUnreadResponse(response, controller);
        return failedBatch(index, requestedTokens, "rate-limited", 429);
      }
      if (response.status >= 500) {
        abortUnreadResponse(response, controller);
        return failedBatch(
          index,
          requestedTokens,
          "server-error",
          response.status,
        );
      }
      if (!response.ok) {
        abortUnreadResponse(response, controller);
        return failedBatch(
          index,
          requestedTokens,
          "response-invalid",
          response.status,
        );
      }

      // The same absolute deadline covers headers and body consumption. A
      // provider that sends headers and then stalls must not pin the worker.
      const body = await readBoundedResponseBody(
        response,
        maximumResponseBytes,
        timeout,
        controller,
      );

      let rows: unknown;
      try {
        rows = parseLosslessJson(body);
      } catch {
        return failedBatch(index, requestedTokens, "response-invalid");
      }
      if (!Array.isArray(rows) || rows.length > maximumRowsPerBatch) {
        return failedBatch(index, requestedTokens, "response-invalid");
      }
      return {
        diagnostic: {
          index,
          requestedTokenCount: requestedTokens.length,
          status: "ok",
          httpStatus: response.status,
        },
        rows,
        requestedTokens,
      };
    } catch (error) {
      if (error instanceof DexscreenerShadowTimeoutError) {
        return failedBatch(index, requestedTokens, "timeout");
      }
      if (error instanceof DexscreenerShadowResponseTooLargeError) {
        return failedBatch(index, requestedTokens, "response-too-large");
      }
      if (error instanceof DexscreenerShadowInvalidResponseError) {
        return failedBatch(index, requestedTokens, "response-invalid");
      }
      return failedBatch(index, requestedTokens, "transport-error");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      releaseBatchSlot();
    }
  }

  async function readUncached(
    identities: readonly MarketChartIdentityV1[],
  ): Promise<DexscreenerShadowSnapshotV1> {
    const timestamp = now();
    const nowMs = timestamp.valueOf();
    if (!Number.isFinite(nowMs)) {
      throw new Error("Dexscreener shadow clock returned an invalid Date");
    }
    const fetchedAt = timestamp.toISOString();
    const tokens = [...new Set(
      identities.map((identity) => identity.tokenAddress),
    )].sort();
    for (const [tokenAddress, cached] of tokenCache) {
      if (cached.expiresAtMs <= nowMs) tokenCache.delete(tokenAddress);
    }
    const tokenPromises = new Map<
      `0x${string}`,
      Promise<TokenProviderResult>
    >();
    const ownedResolvers = new Map<
      `0x${string}`,
      (value: TokenProviderResult) => void
    >();
    const ownedTokens: `0x${string}`[] = [];
    for (const tokenAddress of tokens) {
      const cached = tokenCache.get(tokenAddress);
      if (cached && cached.expiresAtMs > nowMs) {
        tokenCache.delete(tokenAddress);
        tokenCache.set(tokenAddress, cached);
        tokenPromises.set(tokenAddress, Promise.resolve(cached.value));
        continue;
      }
      const active = tokenInFlight.get(tokenAddress);
      if (active) {
        tokenPromises.set(tokenAddress, active);
        continue;
      }

      let resolve!: (value: TokenProviderResult) => void;
      const unresolved = new Promise<TokenProviderResult>((complete) => {
        resolve = complete;
      });
      const managed = unresolved.then((value) => {
        const completedMs = now().valueOf();
        if (!Number.isFinite(completedMs)) {
          throw new Error("Dexscreener shadow clock returned an invalid Date");
        }
        const ttl = Math.min(cacheTtlMs, failureCacheTtlMs);
        if (ttl > 0) {
          tokenCache.delete(tokenAddress);
          while (tokenCache.size >= maximumTokenCacheEntries) {
            const oldest = tokenCache.keys().next().value as
              `0x${string}` | undefined;
            if (oldest === undefined) break;
            tokenCache.delete(oldest);
          }
          tokenCache.set(tokenAddress, {
            expiresAtMs: completedMs + ttl,
            value,
          });
        }
        return value;
      }).finally(() => {
        if (tokenInFlight.get(tokenAddress) === managed) {
          tokenInFlight.delete(tokenAddress);
        }
      });
      tokenInFlight.set(tokenAddress, managed);
      tokenPromises.set(tokenAddress, managed);
      ownedResolvers.set(tokenAddress, resolve);
      ownedTokens.push(tokenAddress);
    }

    const batches = Array.from(
      {
        length: Math.ceil(
          ownedTokens.length / DEXSCREENER_SHADOW_MAX_TOKENS_PER_REQUEST,
        ),
      },
      (_, index) => ownedTokens.slice(
        index * DEXSCREENER_SHADOW_MAX_TOKENS_PER_REQUEST,
        (index + 1) * DEXSCREENER_SHADOW_MAX_TOKENS_PER_REQUEST,
      ),
    );
    const batchResults: BatchResult[] = [];
    try {
      for (
        let offset = 0;
        offset < batches.length;
        offset += maximumConcurrentBatches
      ) {
        const completed = await Promise.all(
          batches.slice(offset, offset + maximumConcurrentBatches)
            .map((batch, relativeIndex) => requestBatch(
              batch,
              offset + relativeIndex,
            )),
        );
        batchResults.push(...completed);
        for (const batch of completed) {
          for (const tokenAddress of batch.requestedTokens) {
            const resolve = ownedResolvers.get(tokenAddress);
            if (!resolve) continue;
            ownedResolvers.delete(tokenAddress);
            if (!("rows" in batch)) {
              resolve({ status: "failed", reason: batch.reason, fetchedAt });
              continue;
            }
            resolve({
              status: "ok",
              rows: batch.rows.filter((row) =>
                rowTokenAddresses(row).includes(tokenAddress)),
              fetchedAt,
            });
          }
        }
      }
    } catch {
      for (const [tokenAddress, resolve] of ownedResolvers) {
        ownedResolvers.delete(tokenAddress);
        resolve({
          status: "failed",
          reason: "batch-transport-error",
          fetchedAt,
        });
      }
    }

    const tokenResults = new Map<`0x${string}`, TokenProviderResult>();
    await Promise.all([...tokenPromises].map(async ([tokenAddress, promise]) => {
      tokenResults.set(tokenAddress, await promise);
    }));

    const results = identities.map((identity) => {
      const tokenResult = tokenResults.get(identity.tokenAddress);
      if (!tokenResult) {
        return unavailable(identity, "batch-transport-error");
      }
      if (tokenResult.status === "failed") {
        return unavailable(identity, tokenResult.reason);
      }
      return qualifyIdentity(
        identity,
        tokenResult.rows,
        tokenResult.fetchedAt,
      );
    });
    const observedCount = results.filter(
      (result) => result.status === "available",
    ).length;
    const qualifiedCount = results.filter(
      (result) => result.status === "available" &&
        result.fdvQualification.status === "qualified",
    ).length;
    const successfulTokens = [...tokenResults.values()].filter(
      (result) => result.status === "ok",
    ).length;
    const readStatus = tokens.length === 0 || successfulTokens === tokens.length
      ? "complete"
      : successfulTokens === 0
        ? "unavailable"
        : "partial";
    const sourceFetchedAt = [...tokenResults.values()]
      .map((result) => result.fetchedAt)
      .sort();
    const assembled = now();
    if (!Number.isFinite(assembled.valueOf())) {
      throw new Error("Dexscreener shadow clock returned an invalid Date");
    }

    return {
      schemaVersion: PROGRAMMABLE_DEXSCREENER_SHADOW_SCHEMA_VERSION,
      source: DEXSCREENER_SHADOW_SOURCE,
      mode: DEXSCREENER_SHADOW_MODE,
      currency: DEXSCREENER_SHADOW_CURRENCY,
      assembledAt: assembled.toISOString(),
      sourceReadWindow: sourceFetchedAt.length === 0
        ? null
        : {
            oldestFetchedAt: sourceFetchedAt[0],
            newestFetchedAt: sourceFetchedAt.at(-1) ?? sourceFetchedAt[0],
          },
      readStatus,
      requestedCount: identities.length,
      observedCount,
      qualifiedCount,
      unavailableCount: identities.length - qualifiedCount,
      batches: batchResults.map((batch) => batch.diagnostic),
      results,
    };
  }

  async function read(
    identities: readonly MarketChartIdentityV1[],
  ): Promise<DexscreenerShadowSnapshotV1> {
    assertCanonicalIdentities(identities);
    const canonicalIdentities = [...identities].sort((left, right) =>
      identityKey(left).localeCompare(identityKey(right)));
    const key = canonicalIdentities.map(identityKey).join("|");
    const currentMs = now().valueOf();
    if (!Number.isFinite(currentMs)) {
      throw new Error("Dexscreener shadow clock returned an invalid Date");
    }
    for (const [cachedKey, candidate] of cache) {
      if (candidate.expiresAtMs <= currentMs) cache.delete(cachedKey);
    }
    const cached = cache.get(key);
    if (cached && cached.expiresAtMs > currentMs) {
      cache.delete(key);
      cache.set(key, cached);
      return reorderSnapshot(cached.value, identities);
    }
    const active = inFlight.get(key);
    if (active) return active.then((value) => reorderSnapshot(value, identities));

    const pending = readUncached(canonicalIdentities).then((value) => {
      const ttl = value.readStatus === "complete" &&
          value.unavailableCount === 0
        ? cacheTtlMs
        : Math.min(cacheTtlMs, failureCacheTtlMs);
      const completedMs = now().valueOf();
      if (!Number.isFinite(completedMs)) {
        throw new Error("Dexscreener shadow clock returned an invalid Date");
      }
      if (ttl > 0) {
        cache.delete(key);
        while (cache.size >= maximumCacheEntries) {
          const oldest = cache.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        cache.set(key, { expiresAtMs: completedMs + ttl, value });
      }
      return value;
    }).finally(() => {
      if (inFlight.get(key) === pending) inFlight.delete(key);
    });
    inFlight.set(key, pending);
    return pending.then((value) => reorderSnapshot(value, identities));
  }

  return { read };
}

let sharedReader: DexscreenerShadowReaderV1 | undefined;

/**
 * Server-worker entrypoint. It is intentionally not wired into any public API
 * response; callers must opt into a separate shadow comparison.
 */
export function readDexscreenerMarketShadowV1(
  identities: readonly MarketChartIdentityV1[],
): Promise<DexscreenerShadowSnapshotV1> {
  sharedReader ??= createDexscreenerShadowReaderV1();
  return sharedReader.read(identities);
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
  timeout: Promise<never>,
  controller: AbortController,
): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength)) {
      abortUnreadResponse(response, controller);
      throw new DexscreenerShadowInvalidResponseError();
    }
    if (BigInt(declaredLength) > BigInt(maximumBytes)) {
      abortUnreadResponse(response, controller);
      throw new DexscreenerShadowResponseTooLargeError();
    }
  }

  if (response.body === null || response.body === undefined) {
    const body = await Promise.race([response.text(), timeout]);
    if (new TextEncoder().encode(body).byteLength > maximumBytes) {
      controller.abort();
      throw new DexscreenerShadowResponseTooLargeError();
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await Promise.race([reader.read(), timeout]);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        throw new DexscreenerShadowInvalidResponseError();
      }
      totalBytes += next.value.byteLength;
      if (totalBytes > maximumBytes) {
        controller.abort();
        void reader.cancel().catch(() => undefined);
        throw new DexscreenerShadowResponseTooLargeError();
      }
      chunks.push(next.value);
    }
  } finally {
    // A deadline can win while reader.read() is still pending. Releasing a
    // locked reader then throws synchronously in the Web Streams contract and
    // must not mask the timeout classification.
    try {
      reader.releaseLock();
    } catch {
      // The AbortController above owns cancellation of the underlying fetch.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DexscreenerShadowInvalidResponseError();
  }
}

function abortUnreadResponse(
  response: Response,
  controller: AbortController,
) {
  controller.abort();
  if (response.body !== null && response.body !== undefined) {
    void response.body.cancel().catch(() => undefined);
  }
}

function parseLosslessJson(source: string): unknown {
  let cursor = 0;

  function invalid(): never {
    throw new DexscreenerShadowInvalidResponseError();
  }

  function skipWhitespace() {
    while (
      source[cursor] === " " ||
      source[cursor] === "\n" ||
      source[cursor] === "\r" ||
      source[cursor] === "\t"
    ) cursor += 1;
  }

  function parseString(): string {
    if (source[cursor] !== "\"") return invalid();
    const start = cursor;
    cursor += 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (source[cursor] === "\"") {
        cursor += 1;
        try {
          const parsed = JSON.parse(source.slice(start, cursor));
          return typeof parsed === "string" ? parsed : invalid();
        } catch {
          return invalid();
        }
      }
      cursor += 1;
    }
    return invalid();
  }

  function parseNumber(): LosslessJsonNumber {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/u
      .exec(source.slice(cursor));
    if (!match) return invalid();
    cursor += match[0].length;
    if (!/[\s,\]}]/u.test(source[cursor] ?? " ")) return invalid();
    return { [LOSSLESS_JSON_NUMBER]: match[0] };
  }

  function parseArray(depth: number): unknown[] {
    cursor += 1;
    skipWhitespace();
    const result: unknown[] = [];
    if (source[cursor] === "]") {
      cursor += 1;
      return result;
    }
    while (true) {
      result.push(parseValue(depth + 1));
      skipWhitespace();
      if (source[cursor] === "]") {
        cursor += 1;
        return result;
      }
      if (source[cursor] !== ",") return invalid();
      cursor += 1;
      skipWhitespace();
    }
  }

  function parseObject(depth: number): Record<string, unknown> {
    cursor += 1;
    skipWhitespace();
    const result = Object.create(null) as Record<string, unknown>;
    if (source[cursor] === "}") {
      cursor += 1;
      return result;
    }
    while (true) {
      const key = parseString();
      if (Object.hasOwn(result, key)) return invalid();
      skipWhitespace();
      if (source[cursor] !== ":") return invalid();
      cursor += 1;
      result[key] = parseValue(depth + 1);
      skipWhitespace();
      if (source[cursor] === "}") {
        cursor += 1;
        return result;
      }
      if (source[cursor] !== ",") return invalid();
      cursor += 1;
      skipWhitespace();
    }
  }

  function parseValue(depth: number): unknown {
    if (depth > 64) return invalid();
    skipWhitespace();
    const current = source[cursor];
    if (current === "\"") return parseString();
    if (current === "[") return parseArray(depth);
    if (current === "{") return parseObject(depth);
    if (current === "-" || (current >= "0" && current <= "9")) {
      return parseNumber();
    }
    for (const [literal, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (source.startsWith(literal, cursor)) {
        cursor += literal.length;
        if (!/[\s,\]}]/u.test(source[cursor] ?? " ")) return invalid();
        return value;
      }
    }
    return invalid();
  }

  const value = parseValue(0);
  skipWhitespace();
  if (cursor !== source.length) return invalid();
  return value;
}

function losslessJsonNumberLexeme(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !(LOSSLESS_JSON_NUMBER in value)
  ) return null;
  const lexeme = (value as LosslessJsonNumber)[LOSSLESS_JSON_NUMBER];
  return typeof lexeme === "string" ? lexeme : null;
}

function reorderSnapshot(
  snapshot: DexscreenerShadowSnapshotV1,
  identities: readonly MarketChartIdentityV1[],
): DexscreenerShadowSnapshotV1 {
  const byIdentity = new Map(
    snapshot.results.map((result) => [identityKey(result.identity), result]),
  );
  return {
    ...snapshot,
    results: identities.map((identity) => {
      const result = byIdentity.get(identityKey(identity));
      if (!result) {
        throw new Error("Dexscreener shadow cache lost a canonical identity");
      }
      return result;
    }),
  };
}

function qualifyIdentity(
  identity: MarketChartIdentityV1,
  rows: readonly unknown[],
  fetchedAt: string,
): DexscreenerShadowResultV1 {
  if (rows.length === 0) return unavailable(identity, "provider-missing");
  const exactRows = rows.filter((row) => exactIdentityPair(row, identity));
  if (exactRows.length === 0) return unavailable(identity, "identity-mismatch");
  if (exactRows.length > 1) {
    return unavailable(identity, "ambiguous-exact-pair");
  }

  const row = exactRows[0];
  if (!isRecord(row)) return unavailable(identity, "malformed-market-data");
  const priceUsdWad = exactPositiveDecimalUsdToWadV1(row.priceUsd);
  const liquidityUsdWad = isRecord(row.liquidity)
    ? exactJsonNumberLexemeUsdToWadV1(
        losslessJsonNumberLexeme(row.liquidity.usd),
      )
    : null;
  const fdvUsdWad = exactJsonNumberLexemeUsdToWadV1(
    losslessJsonNumberLexeme(row.fdv),
  );
  const marketCapUsdWad = exactJsonNumberLexemeUsdToWadV1(
    losslessJsonNumberLexeme(row.marketCap),
  );
  if (
    priceUsdWad === null ||
    liquidityUsdWad === null ||
    fdvUsdWad === null ||
    marketCapUsdWad === null
  ) {
    return unavailable(identity, "malformed-market-data");
  }

  return {
    identity,
    status: "available",
    fdvQualification: BigInt(liquidityUsdWad) >=
        BigInt(DEXSCREENER_SHADOW_MINIMUM_FDV_LIQUIDITY_USD_WAD)
      ? {
          status: "qualified",
          minimumLiquidityUsdWad:
            DEXSCREENER_SHADOW_MINIMUM_FDV_LIQUIDITY_USD_WAD,
        }
      : {
          status: "unavailable",
          reason: "insufficient-liquidity",
          minimumLiquidityUsdWad:
            DEXSCREENER_SHADOW_MINIMUM_FDV_LIQUIDITY_USD_WAD,
        },
    observation: {
      source: DEXSCREENER_SHADOW_SOURCE,
      mode: DEXSCREENER_SHADOW_MODE,
      currency: DEXSCREENER_SHADOW_CURRENCY,
      fetchedAt,
      pairAddress: identity.poolId,
      priceUsdWad,
      liquidityUsdWad,
      fdvUsdWad,
      marketCapUsdWad,
    },
  };
}

function exactIdentityPair(row: unknown, identity: MarketChartIdentityV1) {
  if (
    !isRecord(row) ||
    row.chainId !== "ethereum" ||
    row.dexId !== "uniswap" ||
    !Array.isArray(row.labels) ||
    !row.labels.includes("v4") ||
    typeof row.pairAddress !== "string" ||
    !BYTES32.test(row.pairAddress) ||
    row.pairAddress.toLowerCase() !== identity.poolId ||
    !isRecord(row.baseToken) ||
    !isRecord(row.quoteToken)
  ) {
    return false;
  }
  const baseAddress = canonicalAddress(row.baseToken.address);
  const quoteAddress = canonicalAddress(row.quoteToken.address);
  if (baseAddress === null || quoteAddress === null || baseAddress === quoteAddress) {
    return false;
  }
  return baseAddress === identity.tokenAddress &&
    quoteAddress === identity.quoteAddress;
}

function rowTokenAddresses(row: unknown): readonly `0x${string}`[] {
  if (!isRecord(row)) return [];
  const result = new Set<`0x${string}`>();
  if (isRecord(row.baseToken)) {
    const address = canonicalAddress(row.baseToken.address);
    if (address !== null) result.add(address);
  }
  if (isRecord(row.quoteToken)) {
    const address = canonicalAddress(row.quoteToken.address);
    if (address !== null) result.add(address);
  }
  return [...result];
}

function canonicalAddress(value: unknown): `0x${string}` | null {
  return typeof value === "string" && ADDRESS.test(value)
    ? value.toLowerCase() as `0x${string}`
    : null;
}

function unavailable(
  identity: MarketChartIdentityV1,
  reason: DexscreenerShadowUnavailableReasonV1,
): DexscreenerShadowResultV1 {
  return { identity, status: "unavailable", reason };
}

function failedBatch(
  index: number,
  requestedTokens: readonly `0x${string}`[],
  status: Exclude<DexscreenerShadowBatchDiagnosticV1["status"], "ok">,
  httpStatus?: number,
): FailedBatch {
  const reasons = {
    "rate-limited": "batch-rate-limited",
    "server-error": "batch-server-error",
    timeout: "batch-timeout",
    "transport-error": "batch-transport-error",
    "response-invalid": "batch-response-invalid",
    "response-too-large": "batch-response-too-large",
  } as const;
  return {
    diagnostic: {
      index,
      requestedTokenCount: requestedTokens.length,
      status,
      ...(httpStatus === undefined ? {} : { httpStatus }),
    },
    reason: reasons[status],
    requestedTokens,
  };
}

function assertCanonicalIdentities(
  identities: readonly MarketChartIdentityV1[],
) {
  const seen = new Set<string>();
  for (const identity of identities) {
    if (!isMarketChartIdentityV1(identity)) {
      throw new Error("Dexscreener shadow received a malformed canonical identity");
    }
    const key = identityKey(identity);
    if (seen.has(key)) {
      throw new Error("Dexscreener shadow received a duplicate canonical identity");
    }
    seen.add(key);
  }
}

function identityKey(identity: MarketChartIdentityV1) {
  return `${identity.tokenAddress}:${identity.poolId}:${identity.quoteAddress}`;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  const selected = value ?? fallback;
  if (
    !Number.isSafeInteger(selected) ||
    selected < minimum ||
    selected > maximum
  ) {
    throw new Error(`Dexscreener shadow ${label} is out of bounds`);
  }
  return selected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
