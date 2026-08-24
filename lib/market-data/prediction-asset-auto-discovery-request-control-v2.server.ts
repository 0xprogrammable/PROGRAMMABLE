import "server-only";

import {
  normalizePredictionAssetLocatorV2,
  readPredictionAssetAutoDiscoveryV2,
  type PredictionAssetAutoDiscoveryReaderV2,
  type PredictionAssetAutoDiscoveryResultV2,
} from "./prediction-asset-auto-discovery-v2.server";

// Budget units are outbound DEX provider calls, not user requests. A full
// initial bucket plus one minute of refill is at most 144 + 144 = 288 calls,
// below the provider's 300/minute ceiling inside a single runtime.
export const PREDICTION_ASSET_DISCOVERY_GLOBAL_BUDGET_CAPACITY_V2 = 144;
export const PREDICTION_ASSET_DISCOVERY_GLOBAL_BUDGET_INTERVAL_MS_V2 = 60_000;
export const PREDICTION_ASSET_DISCOVERY_POSITIVE_CACHE_TTL_MS_V2 = 15_000;
export const PREDICTION_ASSET_DISCOVERY_NEGATIVE_CACHE_TTL_MS_V2 = 5_000;
export const PREDICTION_ASSET_DISCOVERY_MAXIMUM_CONCURRENT_READS_V2 = 2;
export const PREDICTION_ASSET_DISCOVERY_CONTROL_SCOPE_V2 =
  "single-runtime-only" as const;
export const PREDICTION_ASSET_DISCOVERY_SHARED_LIMITS_REQUIRED_FOR_ACTIVATION_V2 =
  true as const;

const DEFAULT_MAXIMUM_CACHE_ENTRIES = 512;
const EVM_DEX_CALL_COST = 4;
const SOLANA_DEX_CALL_COST = 1;

type CacheEntry = Readonly<{
  expiresAtMs: number;
  result: PredictionAssetAutoDiscoveryResultV2;
}>;

type InFlightEntry = Readonly<{
  controller: AbortController;
  promise: Promise<PredictionAssetAutoDiscoveryResultV2>;
  waiters: { count: number };
}>;

export type PredictionAssetAutoDiscoveryRequestControlResultV2 =
  | Readonly<{
    status: "ok";
    result: PredictionAssetAutoDiscoveryResultV2;
    source: "cache" | "coalesced" | "reader";
  }>
  | Readonly<{
    status: "rate-limited";
    retryAfterSeconds: number;
  }>;

export type PredictionAssetAutoDiscoveryRequestControllerOptionsV2 = Readonly<{
  reader?: PredictionAssetAutoDiscoveryReaderV2;
  nowMs?: () => number;
  budgetCapacity?: number;
  budgetIntervalMs?: number;
  positiveCacheTtlMs?: number;
  negativeCacheTtlMs?: number;
  maximumCacheEntries?: number;
  maximumConcurrentReads?: number;
}>;

export type PredictionAssetAutoDiscoveryRequestControllerV2 = Readonly<{
  read(
    locator: string,
    options?: Readonly<{ signal?: AbortSignal }>,
  ): Promise<PredictionAssetAutoDiscoveryRequestControlResultV2>;
}>;

/**
 * Per-runtime request control. It bounds one server process without pretending
 * to be a distributed quota. Activation also requires an edge per-client limit
 * and a shared outbound provider-call budget across every runtime.
 */
export function createPredictionAssetAutoDiscoveryRequestControllerV2(
  options: PredictionAssetAutoDiscoveryRequestControllerOptionsV2 = {},
): PredictionAssetAutoDiscoveryRequestControllerV2 {
  const reader = options.reader ?? Object.freeze({
    read: readPredictionAssetAutoDiscoveryV2,
  });
  const nowMs = options.nowMs ?? Date.now;
  const budgetCapacity = boundedInteger(
    options.budgetCapacity,
    PREDICTION_ASSET_DISCOVERY_GLOBAL_BUDGET_CAPACITY_V2,
    EVM_DEX_CALL_COST,
    1_000,
    "budgetCapacity",
  );
  const budgetIntervalMs = boundedInteger(
    options.budgetIntervalMs,
    PREDICTION_ASSET_DISCOVERY_GLOBAL_BUDGET_INTERVAL_MS_V2,
    1,
    3_600_000,
    "budgetIntervalMs",
  );
  const positiveCacheTtlMs = boundedInteger(
    options.positiveCacheTtlMs,
    PREDICTION_ASSET_DISCOVERY_POSITIVE_CACHE_TTL_MS_V2,
    1,
    60_000,
    "positiveCacheTtlMs",
  );
  const negativeCacheTtlMs = boundedInteger(
    options.negativeCacheTtlMs,
    PREDICTION_ASSET_DISCOVERY_NEGATIVE_CACHE_TTL_MS_V2,
    1,
    60_000,
    "negativeCacheTtlMs",
  );
  const maximumCacheEntries = boundedInteger(
    options.maximumCacheEntries,
    DEFAULT_MAXIMUM_CACHE_ENTRIES,
    1,
    10_000,
    "maximumCacheEntries",
  );
  const maximumConcurrentReads = boundedInteger(
    options.maximumConcurrentReads,
    PREDICTION_ASSET_DISCOVERY_MAXIMUM_CONCURRENT_READS_V2,
    1,
    32,
    "maximumConcurrentReads",
  );
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightEntry>();
  let availableBudget = budgetCapacity;
  let budgetUpdatedAtMs = checkedNow(nowMs);
  let activeReads = 0;

  return Object.freeze({
    async read(locator, readOptions = {}) {
      const normalized = normalizePredictionAssetLocatorV2(locator);
      if (normalized === null) {
        return Object.freeze({
          status: "ok" as const,
          source: "reader" as const,
          result: await reader.read(locator, readOptions),
        });
      }

      const currentTimeMs = checkedNow(nowMs);
      const cached = cache.get(normalized.locator);
      if (cached && cached.expiresAtMs > currentTimeMs) {
        return Object.freeze({
          status: "ok" as const,
          source: "cache" as const,
          result: cached.result,
        });
      }
      if (cached) cache.delete(normalized.locator);

      const existing = inFlight.get(normalized.locator);
      if (existing && !existing.controller.signal.aborted) {
        return Object.freeze({
          status: "ok" as const,
          source: "coalesced" as const,
          result: await waitForEntry(existing, readOptions.signal),
        });
      }
      if (existing) inFlight.delete(normalized.locator);

      const elapsedMs = Math.max(0, currentTimeMs - budgetUpdatedAtMs);
      const requestCost = normalized.namespace === "evm"
        ? EVM_DEX_CALL_COST
        : SOLANA_DEX_CALL_COST;
      availableBudget = Math.min(
        budgetCapacity,
        availableBudget + elapsedMs * budgetCapacity / budgetIntervalMs,
      );
      budgetUpdatedAtMs = currentTimeMs;
      if (availableBudget < requestCost) {
        const waitMs = (requestCost - availableBudget) * budgetIntervalMs /
          budgetCapacity;
        return Object.freeze({
          status: "rate-limited" as const,
          retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1_000)),
        });
      }
      // Zero-queue per-runtime bulkhead. Coalesced callers above share the
      // existing slot; a distinct discovery must retry rather than waiting
      // inside the route's bounded execution window. This is not distributed.
      if (activeReads >= maximumConcurrentReads) {
        return Object.freeze({
          status: "rate-limited" as const,
          retryAfterSeconds: 1,
        });
      }
      activeReads += 1;
      availableBudget -= requestCost;

      const controller = new AbortController();
      const waiters = { count: 0 };
      const promise = Promise.resolve()
        .then(() => reader.read(normalized.locator, {
          signal: controller.signal,
        }))
        .then((result) => {
          const ttlMs = cacheTtl(result, positiveCacheTtlMs, negativeCacheTtlMs);
          if (ttlMs !== null && !controller.signal.aborted) {
            writeBoundedCache(
              cache,
              normalized.locator,
              { result, expiresAtMs: checkedNow(nowMs) + ttlMs },
              maximumCacheEntries,
              checkedNow(nowMs),
            );
          }
          return result;
        })
        .finally(() => {
          activeReads -= 1;
          if (inFlight.get(normalized.locator)?.promise === promise) {
            inFlight.delete(normalized.locator);
          }
        });
      const entry = Object.freeze({ controller, promise, waiters });
      inFlight.set(normalized.locator, entry);

      return Object.freeze({
        status: "ok" as const,
        source: "reader" as const,
        result: await waitForEntry(entry, readOptions.signal),
      });
    },
  });
}

async function waitForEntry(
  entry: InFlightEntry,
  signal: AbortSignal | undefined,
) {
  entry.waiters.count += 1;
  let active = true;
  const release = () => {
    if (!active) return;
    active = false;
    entry.waiters.count -= 1;
    if (entry.waiters.count === 0 && signal?.aborted) {
      entry.controller.abort();
    }
  };
  const onAbort = () => release();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) release();
  try {
    return await entry.promise;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    release();
  }
}

function cacheTtl(
  result: PredictionAssetAutoDiscoveryResultV2,
  positiveCacheTtlMs: number,
  negativeCacheTtlMs: number,
) {
  if (result.status === "unique" || result.status === "ambiguous") {
    return positiveCacheTtlMs;
  }
  return result.status === "not-found" ? negativeCacheTtlMs : null;
}

function writeBoundedCache(
  cache: Map<string, CacheEntry>,
  key: string,
  value: CacheEntry,
  maximumEntries: number,
  nowMs: number,
) {
  for (const [candidateKey, entry] of cache) {
    if (entry.expiresAtMs <= nowMs) cache.delete(candidateKey);
  }
  cache.delete(key);
  while (cache.size >= maximumEntries) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(key, value);
}

function checkedNow(nowMs: () => number) {
  const value = nowMs();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("nowMs must return a non-negative safe integer");
  }
  return value;
}

function boundedInteger(
  candidate: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
) {
  const value = candidate ?? fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __programmablePredictionAssetDiscoveryControllerV2?:
    PredictionAssetAutoDiscoveryRequestControllerV2;
};
const defaultRequestController =
  runtimeGlobal.__programmablePredictionAssetDiscoveryControllerV2 ??=
    createPredictionAssetAutoDiscoveryRequestControllerV2();

export const readControlledPredictionAssetAutoDiscoveryV2 =
  defaultRequestController.read;
