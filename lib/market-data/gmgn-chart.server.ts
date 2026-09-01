import "server-only";

import {
  CANONICAL_LAUNCH_STAMP_V1,
  type ExploreEntry,
} from "../tokens";
import {
  getProductionGmgnAccountGateV1,
  type GmgnAccountGateV1,
} from "./gmgn-account-gate.server";
import {
  PROGRAMMABLE_GMGN_CHART_IDENTITY_PROOF_SCHEMA_VERSION,
  PROGRAMMABLE_GMGN_MARKET_CHART_SCHEMA_VERSION,
  gmgnKlineResolutionDurationMsV1,
  isGmgnChartIdentityProofV1,
  isGmgnMarketChartV1,
  type GmgnChartIdentityProofV1,
  type GmgnKlineResolutionV1,
  type GmgnMarketChartRangeV1,
  type GmgnMarketChartV1,
} from "./gmgn-chart-data-v1";
import { exploreEntryMarketIdentitiesV1 } from
  "./explore-market-identities";
import {
  isMarketChartIdentityV1,
  type MarketChartIdentityV1,
} from "./market-data-v1";

const GMGN_API_ORIGIN = "https://openapi.gmgn.ai" as const;
const GMGN_REQUEST_TIMEOUT_MS = 2_500;
const GMGN_RESPONSE_MAXIMUM_BYTES = 1_000_000;
const GMGN_CHART_CACHE_TTL_MS = 30_000;
const GMGN_IDENTITY_CACHE_TTL_MS = 30_000;
const GMGN_MAXIMUM_CACHE_ENTRIES = 512;
const GMGN_MAXIMUM_CANDLES = 512;
const GMGN_OBSERVED_DEFAULT_CANDLE_LIMIT = 100;
const GMGN_MAXIMUM_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const UINT256_MAX = (1n << 256n) - 1n;
const USD_WAD = 10n ** 18n;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const CANONICAL_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;
const PROVIDER_OPERATION_TIMED_OUT = Symbol("gmgn-provider-operation-timed-out");

type FetchImplementation = typeof fetch;

type CanonicalSupplyV1 = Readonly<{
  raw: bigint;
  decimals: number;
}>;

export type GmgnChartReadWaitV1 = Readonly<{
  signal?: AbortSignal;
  deadlineMs?: number;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
  accountGate?: GmgnAccountGateV1;
}>;

type GmgnChartProviderReadWaitV1 = Readonly<{
  fetchImpl: FetchImplementation | undefined;
  now: () => Date;
  accountGate: GmgnAccountGateV1 | undefined;
  deadlineMs: number;
  signal: AbortSignal;
}>;

type ProviderOperationV1 = Pick<
  GmgnChartProviderReadWaitV1,
  "now" | "deadlineMs" | "signal"
>;

export type GmgnMarketChartReadV1 = Readonly<{
  entry: ExploreEntry;
  identity: MarketChartIdentityV1;
  range: GmgnMarketChartRangeV1;
}>;

type CachedValue<T> = Readonly<{
  expiresAtMs: number;
  value: T;
}>;

const identityCache = new Map<
  string,
  CachedValue<GmgnChartIdentityProofV1>
>();
const identityInFlight = new Map<
  string,
  Promise<GmgnChartIdentityProofV1 | null>
>();
const chartCache = new Map<
  string,
  CachedValue<GmgnMarketChartV1>
>();
const chartInFlight = new Map<
  string,
  Promise<GmgnMarketChartV1 | null>
>();

/**
 * GMGN's kline payload does not carry a pool or quote locator. The adapter
 * therefore accepts candles only after GMGN token info names the requested
 * canonical v4 pool as that token's biggest pool and proves the exact pair
 * and canonical token supply.
 * This is provider identity evidence at read time; it is not per-candle
 * onchain provenance, so any missing or changed locator fails soft to null.
 */
export async function readGmgnMarketChartV1(
  input: GmgnMarketChartReadV1,
  wait: GmgnChartReadWaitV1 = {},
): Promise<GmgnMarketChartV1 | null> {
  const apiKey = readApiKey();
  const identity = exactExploreIdentity(input.entry, input.identity);
  const canonicalSupply = canonicalSupplyV1(input.entry);
  const now = wait.now ?? (() => new Date());
  const initialNow = now();
  if (
    apiKey === null ||
    identity === null ||
    canonicalSupply === null ||
    !isGmgnMarketChartRangeV1(input.range) ||
    !Number.isFinite(initialNow.getTime())
  ) return null;

  const window = gmgnChartWindowV1(
    input.range,
    input.entry.launchedAt,
    initialNow,
  );
  if (window === null) return null;
  const bindingKey = entryIdentityBindingKey(input.entry, identity);
  const cacheKey = [
    bindingKey,
    input.range,
    window.resolution,
    input.range === "all" ? window.from.toISOString() : "bounded",
  ].join(":");
  if (!callerCanAwaitSharedRead(wait, initialNow.getTime())) return null;
  const cached = currentCacheValue(chartCache, cacheKey, initialNow.getTime());
  if (cached !== undefined) return cached;
  const active = chartInFlight.get(cacheKey);
  if (active) return awaitSharedReadForCaller(active, wait);

  const providerWait = sharedProviderWait(wait);
  const providerRead = (async () => {
    const proof = await readGmgnChartIdentityProofV1(
      input.entry,
      identity,
      canonicalSupply,
      apiKey,
      providerWait,
    );
    if (proof === null) return null;
    const response = await gmgnJsonRequest(
      "/v1/market/token_kline",
      {
        chain: "eth",
        address: identity.tokenAddress,
        resolution: window.resolution,
        from: String(window.from.getTime()),
        to: String(window.to.getTime()),
      },
      apiKey,
      providerWait,
    );
    const fetchedAt = now();
    const chart = parseGmgnKlineMarketChartV1(response, {
      identityProof: proof,
      range: input.range,
      resolution: window.resolution,
      requestedFrom: window.from,
      requestedTo: window.to,
      fetchedAt,
    });
    return chart;
  })();
  const promise = settleProviderOperation(providerRead, providerWait).then(
    (settled) => {
      if (settled === PROVIDER_OPERATION_TIMED_OUT) return null;
      const chart = settled;
      if (chart !== null) {
        setCacheValue(
          chartCache,
          cacheKey,
          chart,
          providerWait.now().getTime() + GMGN_CHART_CACHE_TTL_MS,
        );
      }
      return chart;
    },
  ).catch(() => null).finally(() => {
    if (chartInFlight.get(cacheKey) === promise) {
      chartInFlight.delete(cacheKey);
    }
  });
  chartInFlight.set(cacheKey, promise);
  return awaitSharedReadForCaller(promise, wait);
}

export function parseGmgnChartIdentityProofV1(
  response: unknown,
  expectedIdentity: MarketChartIdentityV1,
  canonicalSupply: CanonicalSupplyV1,
  verifiedAt: Date,
): GmgnChartIdentityProofV1 | null {
  const data = unwrapData(response);
  if (
    !hasExactOptionalEthereumChain(response) ||
    !hasExactOptionalEthereumChain(data) ||
    !isMarketChartIdentityV1(expectedIdentity) ||
    !isCanonicalSupplyV1(canonicalSupply) ||
    !Number.isFinite(verifiedAt.getTime()) ||
    !isRecord(data) ||
    !isRecord(data.pool)
  ) return null;
  const pool = data.pool;
  const tokenAddress = canonicalAddress(data.address);
  const poolId = canonicalBytes32(pool.pool_address);
  const biggestPoolId = canonicalBytes32(data.biggest_pool_address);
  const quoteAddress = canonicalAddress(pool.quote_address);
  const declaredBaseAddress = tokenLocatorAddress(
    pool.base_address ?? pool.token_address,
  );
  const token0Address = tokenLocatorAddress(pool.token0_address);
  const token1Address = tokenLocatorAddress(pool.token1_address);
  if (
    expectedIdentity.chainId !== "1" ||
    expectedIdentity.protocol !== "uniswap_v4" ||
    tokenAddress !== expectedIdentity.tokenAddress ||
    poolId !== expectedIdentity.poolId ||
    biggestPoolId !== expectedIdentity.poolId ||
    quoteAddress !== expectedIdentity.quoteAddress ||
    declaredBaseAddress !== expectedIdentity.tokenAddress ||
    token0Address === null ||
    token1Address === null ||
    token0Address === token1Address ||
    ![token0Address, token1Address].includes(expectedIdentity.tokenAddress) ||
    ![token0Address, token1Address].includes(expectedIdentity.quoteAddress) ||
    String(pool.exchange).toLowerCase() !== "uniswap_v4" ||
    !providerSupplyMatchesCanonical(
      data.total_supply,
      canonicalSupply.raw,
      canonicalSupply.decimals,
    )
  ) return null;

  const proof: GmgnChartIdentityProofV1 = {
    schemaVersion: PROGRAMMABLE_GMGN_CHART_IDENTITY_PROOF_SCHEMA_VERSION,
    source: "gmgn-token-info",
    verifiedAt: verifiedAt.toISOString(),
    identity: expectedIdentity,
    canonicalSupply: {
      totalSupplyRaw: canonicalSupply.raw.toString(),
      tokenDecimals: canonicalSupply.decimals,
    },
  };
  return isGmgnChartIdentityProofV1(proof) ? proof : null;
}

export function parseGmgnKlineMarketChartV1(
  response: unknown,
  input: Readonly<{
    identityProof: GmgnChartIdentityProofV1;
    range: GmgnMarketChartRangeV1;
    resolution: GmgnKlineResolutionV1;
    requestedFrom: Date;
    requestedTo: Date;
    fetchedAt: Date;
  }>,
): GmgnMarketChartV1 | null {
  const data = unwrapData(response);
  if (
    !hasExactOptionalEthereumChain(response) ||
    !hasExactOptionalEthereumChain(data) ||
    !isRecord(data) ||
    !Array.isArray(data.list) ||
    data.list.length === 0 ||
    data.list.length > GMGN_MAXIMUM_CANDLES ||
    !isGmgnChartIdentityProofV1(input.identityProof) ||
    !isGmgnMarketChartRangeV1(input.range) ||
    !Number.isFinite(input.requestedFrom.getTime()) ||
    !Number.isFinite(input.requestedTo.getTime()) ||
    !Number.isFinite(input.fetchedAt.getTime()) ||
    input.requestedFrom.getTime() >= input.requestedTo.getTime() ||
    input.requestedTo.getTime() > input.fetchedAt.getTime()
  ) return null;

  const resolutionMs = gmgnKlineResolutionDurationMsV1(input.resolution);
  // Some candle APIs interpret `to` inclusively and return the next bucket at
  // the exact boundary. It is an unfinished bucket for our half-open window,
  // so ignore that one documented boundary shape while rejecting every other
  // out-of-window or malformed row.
  const rows = data.list.filter((value) =>
    !isRecord(value) || canonicalSafeInteger(value.time) !==
      input.requestedTo.getTime()
  );
  if (rows.length === 0) return null;
  const points = rows.map((value) => parseGmgnKlinePointV1(
    value,
    resolutionMs,
    input.requestedFrom.getTime(),
    input.requestedTo.getTime(),
  ));
  if (points.some((point) => point === null)) return null;
  const canonicalPoints = points as NonNullable<(typeof points)[number]>[];
  canonicalPoints.sort((first, second) =>
    Date.parse(first.bucketStart) - Date.parse(second.bucketStart)
  );
  for (let index = 1; index < canonicalPoints.length; index += 1) {
    if (
      canonicalPoints[index - 1]!.bucketStart ===
        canonicalPoints[index]!.bucketStart
    ) return null;
  }
  let volumeUsdWad = 0n;
  for (const point of canonicalPoints) {
    volumeUsdWad += BigInt(point.volumeUsdWad);
    if (volumeUsdWad > UINT256_MAX) return null;
  }
  const earliest = canonicalPoints[0]!;
  const truncated = rows.length >= GMGN_OBSERVED_DEFAULT_CANDLE_LIMIT &&
    Date.parse(earliest.bucketStart) >
      input.requestedFrom.getTime() + resolutionMs;
  const status = truncated
    ? "partial" as const
    : canonicalPoints.length === 1
      ? "insufficient-history" as const
      : "ready" as const;
  const chart: GmgnMarketChartV1 = {
    schemaVersion: PROGRAMMABLE_GMGN_MARKET_CHART_SCHEMA_VERSION,
    source: "gmgn",
    readStatus: "live",
    status,
    generatedAt: input.fetchedAt.toISOString(),
    identity: input.identityProof.identity,
    identityProof: input.identityProof,
    range: input.range,
    resolution: input.resolution,
    requestedFrom: input.requestedFrom.toISOString(),
    requestedTo: input.requestedTo.toISOString(),
    points: canonicalPoints,
    candleCount: canonicalPoints.length,
    volumeUsdWad: volumeUsdWad.toString(),
    asOfTime: canonicalPoints.at(-1)!.bucketEnd,
    truncated,
  };
  return isGmgnMarketChartV1(chart) ? chart : null;
}

export function gmgnChartWindowV1(
  range: GmgnMarketChartRangeV1,
  historyStart: string,
  now: Date,
): Readonly<{
  from: Date;
  to: Date;
  resolution: GmgnKlineResolutionV1;
}> | null {
  if (!isGmgnMarketChartRangeV1(range) || !Number.isFinite(now.getTime())) {
    return null;
  }
  const historyStartMs = Date.parse(historyStart);
  const durationMs = range === "1h"
    ? 60 * 60_000
    : range === "1d"
      ? 24 * 60 * 60_000
      : range === "1w"
        ? 7 * 24 * 60 * 60_000
        : Number.isFinite(historyStartMs) && historyStartMs <= now.getTime()
          ? now.getTime() - historyStartMs
          : Number.NaN;
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const resolution = gmgnKlineResolutionForDurationV1(durationMs);
  const resolutionMs = gmgnKlineResolutionDurationMsV1(resolution);
  const toMs = Math.floor(now.getTime() / resolutionMs) * resolutionMs;
  const fromMs = range === "all"
    ? Math.floor(historyStartMs / resolutionMs) * resolutionMs
    : toMs - durationMs;
  return Number.isFinite(fromMs) && fromMs < toMs
    ? { from: new Date(fromMs), to: new Date(toMs), resolution }
    : null;
}

export function gmgnKlineResolutionForDurationV1(
  durationMs: number,
): GmgnKlineResolutionV1 {
  const candidates: readonly GmgnKlineResolutionV1[] = [
    "30s",
    "1m",
    "5m",
    "15m",
    "1h",
    "4h",
    "1d",
  ];
  return candidates.find((resolution) =>
    Math.ceil(durationMs / gmgnKlineResolutionDurationMsV1(resolution)) <=
      GMGN_OBSERVED_DEFAULT_CANDLE_LIMIT
  ) ?? "1d";
}

async function readGmgnChartIdentityProofV1(
  entry: ExploreEntry,
  identity: MarketChartIdentityV1,
  canonicalSupply: CanonicalSupplyV1,
  apiKey: string,
  wait: GmgnChartProviderReadWaitV1,
): Promise<GmgnChartIdentityProofV1 | null> {
  const key = entryIdentityBindingKey(entry, identity);
  const now = wait.now ?? (() => new Date());
  const nowMs = now().getTime();
  const cached = currentCacheValue(identityCache, key, nowMs);
  if (cached !== undefined) return cached;
  const active = identityInFlight.get(key);
  if (active) return active;
  const providerRead = (async () => {
    const response = await gmgnJsonRequest(
      "/v1/token/info",
      { chain: "eth", address: identity.tokenAddress },
      apiKey,
      wait,
    );
    const verifiedAt = now();
    const proof = parseGmgnChartIdentityProofV1(
      response,
      identity,
      canonicalSupply,
      verifiedAt,
    );
    return proof;
  })();
  const promise = settleProviderOperation(providerRead, wait).then((settled) => {
    if (settled === PROVIDER_OPERATION_TIMED_OUT) return null;
    const proof = settled;
    if (proof !== null) {
      setCacheValue(
        identityCache,
        key,
        proof,
        wait.now().getTime() + GMGN_IDENTITY_CACHE_TTL_MS,
      );
    }
    return proof;
  }).catch(() => null).finally(() => {
    if (identityInFlight.get(key) === promise) {
      identityInFlight.delete(key);
    }
  });
  identityInFlight.set(key, promise);
  return promise;
}

function parseGmgnKlinePointV1(
  value: unknown,
  resolutionMs: number,
  requestedFromMs: number,
  requestedToMs: number,
) {
  if (!isRecord(value)) return null;
  const time = canonicalSafeInteger(value.time);
  const open = canonicalPositiveDecimal(value.open);
  const high = canonicalPositiveDecimal(value.high);
  const low = canonicalPositiveDecimal(value.low);
  const close = canonicalPositiveDecimal(value.close);
  const volumeUsdWad = exactNonNegativeDecimalUsdToWadV1(value.volume);
  if (
    time === null ||
    time % resolutionMs !== 0 ||
    time < requestedFromMs ||
    time + resolutionMs > requestedToMs ||
    open === null ||
    high === null ||
    low === null ||
    close === null ||
    volumeUsdWad === null
  ) return null;
  const openParts = decimalParts(open);
  const highParts = decimalParts(high);
  const lowParts = decimalParts(low);
  const closeParts = decimalParts(close);
  if (
    openParts === null || highParts === null ||
    lowParts === null || closeParts === null ||
    compareDecimals(highParts, openParts) < 0 ||
    compareDecimals(highParts, closeParts) < 0 ||
    compareDecimals(openParts, lowParts) < 0 ||
    compareDecimals(closeParts, lowParts) < 0
  ) return null;
  const bucketEnd = new Date(time + resolutionMs).toISOString();
  return {
    time: bucketEnd,
    bucketStart: new Date(time).toISOString(),
    bucketEnd,
    valueSemantics: "period-close" as const,
    priceUsd: close,
    ohlcUsd: { open, high, low, close },
    volumeUsdWad,
  };
}

async function gmgnJsonRequest(
  path: "/v1/token/info" | "/v1/market/token_kline",
  query: Readonly<Record<string, string>>,
  apiKey: string,
  wait: GmgnChartProviderReadWaitV1,
): Promise<unknown | null> {
  const fetchImpl = wait.fetchImpl ?? fetch;
  const now = wait.now;
  const queueTimeMs = now().getTime();
  const requestDeadlineMs = wait.deadlineMs;
  if (
    wait.signal.aborted ||
    !Number.isFinite(queueTimeMs) ||
    !Number.isFinite(requestDeadlineMs) ||
    requestDeadlineMs <= queueTimeMs
  ) return null;
  let accountGate: GmgnAccountGateV1 | null = wait.accountGate ?? null;
  let reservation: Extract<
    Awaited<ReturnType<GmgnAccountGateV1["reserveSlot"]>>,
    { kind: "reserved" }
  > | null = null;
  try {
    if (
      accountGate === null &&
      (process.env.NODE_ENV === "production" || fetchImpl === fetch)
    ) {
      accountGate = getProductionGmgnAccountGateV1();
    }
    if (accountGate !== null) {
      const decision = await reserveProviderSlot(accountGate, {
        requestsPerSecond: configuredRequestsPerSecond(),
        cost: path === "/v1/market/token_kline" ? 2 : 1,
        deadlineMs: requestDeadlineMs,
        signal: wait.signal,
      }, wait);
      if (decision?.kind !== "reserved") return null;
      reservation = decision;
    }
  } catch {
    return null;
  }
  const nowMs = now().getTime();
  const remaining = requestDeadlineMs - nowMs;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    await completeProviderRequest(accountGate, reservation, wait);
    return null;
  }
  const url = new URL(path, GMGN_API_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("timestamp", String(Math.floor(nowMs / 1_000)));
  url.searchParams.set("client_id", crypto.randomUUID());
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-APIKEY": apiKey,
      },
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      signal: wait.signal,
    });
  } catch {
    await completeProviderRequest(accountGate, reservation, wait);
    return null;
  }
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > GMGN_RESPONSE_MAXIMUM_BYTES
  ) {
    if (response.status === 429) {
      await publishProviderBlock(
        accountGate,
        reservation,
        response,
        null,
        nowMs,
        wait,
      );
    } else {
      await completeProviderRequest(accountGate, reservation, wait);
    }
    return null;
  }
  const bytes = await readBoundedResponseBytes(
    response,
    GMGN_RESPONSE_MAXIMUM_BYTES,
  );
  if (bytes === null) {
    if (response.status === 429) {
      await publishProviderBlock(
        accountGate,
        reservation,
        response,
        null,
        nowMs,
        wait,
      );
    } else {
      await completeProviderRequest(accountGate, reservation, wait);
    }
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    if (response.status === 429) {
      await publishProviderBlock(
        accountGate,
        reservation,
        response,
        null,
        nowMs,
        wait,
      );
    } else {
      await completeProviderRequest(accountGate, reservation, wait);
    }
    return null;
  }
  const value = safeJson(text);
  const rateLimited = response.status === 429 || isRateLimitedEnvelope(value);
  if (rateLimited && accountGate !== null) {
    await publishProviderBlock(
      accountGate,
      reservation,
      response,
      value,
      nowMs,
      wait,
    );
  } else if (!await completeProviderRequest(accountGate, reservation, wait)) {
    return null;
  }
  if (!response.ok || rateLimited || value === null) return null;
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) {
    return null;
  }
  // Preserve the raw envelope so the parser can reject an explicit foreign
  // outer chain instead of losing that provider signal before validation.
  return value;
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

function exactExploreIdentity(
  entry: ExploreEntry,
  identity: MarketChartIdentityV1,
): MarketChartIdentityV1 | null {
  if (
    !isMarketChartIdentityV1(identity) ||
    !productionAuthorizedEntryV1(entry)
  ) return null;
  return exploreEntryMarketIdentitiesV1(entry).find((candidate) =>
    sameIdentity(candidate, identity)
  ) ?? null;
}

function productionAuthorizedEntryV1(entry: ExploreEntry): boolean {
  const provenance = entry.launchCategoryProvenance;
  if (entry.exploreKind === "custom-project") {
    return provenance.source === "registry.custom-launched" ||
      provenance.source === "canonical-launch-stamp-router";
  }
  if (provenance.source === "canonical-launch-read-model") return true;
  const stamp = entry.launchStampProvenance;
  return provenance.source === "canonical-launch-stamp-router" &&
    stamp !== undefined &&
    canonicalAddress(stamp.poolManagerAddress) ===
      canonicalAddress(CANONICAL_LAUNCH_STAMP_V1.poolManagerAddress) &&
    canonicalAddress(stamp.poolProof.poolManagerAddress) ===
      canonicalAddress(CANONICAL_LAUNCH_STAMP_V1.poolManagerAddress);
}

function canonicalSupplyV1(entry: ExploreEntry): CanonicalSupplyV1 | null {
  if (
    entry.exploreKind !== "token" ||
    typeof entry.totalSupplyRaw !== "string" ||
    !CANONICAL_INTEGER.test(entry.totalSupplyRaw) ||
    typeof entry.tokenDecimals !== "number" ||
    !Number.isSafeInteger(entry.tokenDecimals) ||
    entry.tokenDecimals < 0 || entry.tokenDecimals > 255
  ) return null;
  try {
    const raw = BigInt(entry.totalSupplyRaw);
    return raw > 0n && raw <= UINT256_MAX
      ? { raw, decimals: entry.tokenDecimals }
      : null;
  } catch {
    return null;
  }
}

function entryIdentityBindingKey(
  entry: ExploreEntry,
  identity: MarketChartIdentityV1,
): string {
  const authority = entry.exploreKind === "token"
    ? {
        kind: entry.exploreKind,
        source: entry.launchCategoryProvenance.source,
        totalSupplyRaw: entry.totalSupplyRaw ?? null,
        tokenDecimals: entry.tokenDecimals ?? null,
        poolId: entry.poolId,
        quoteAssetAddress: entry.quoteAssetAddress ?? null,
        stamp: entry.launchStampProvenance
          ? {
              chainId: entry.launchStampProvenance.chainId,
              stampHash: entry.launchStampProvenance.stampHash,
              poolManagerAddress:
                entry.launchStampProvenance.poolManagerAddress,
              provenPoolManagerAddress:
                entry.launchStampProvenance.poolProof.poolManagerAddress,
            }
          : null,
      }
    : {
        kind: entry.exploreKind,
        source: entry.launchCategoryProvenance.source,
        customProjectId: entry.customProjectId,
        customLaunchId: entry.customLaunchId,
        finalizedAt: entry.finalizedAt,
        markets: entry.markets
          .filter((market) => market.poolId?.toLowerCase() === identity.poolId)
          .map((market) => ({
            marketId: market.marketId,
            status: market.status,
            poolId: market.poolId,
            base: market.baseAsset.identity.value,
            quote: market.quoteAsset.identity.value,
          })),
      };
  return [
    entry.id,
    entry.launchedAt,
    identityKey(identity),
    JSON.stringify(authority),
  ].join(":");
}

function identityKey(identity: MarketChartIdentityV1): string {
  return [
    identity.chainId,
    identity.protocol,
    identity.tokenAddress,
    identity.poolId,
    identity.quoteAddress,
  ].join(":");
}

function sameIdentity(
  first: MarketChartIdentityV1,
  second: MarketChartIdentityV1,
): boolean {
  return identityKey(first) === identityKey(second);
}

function readApiKey(): string | null {
  const value = process.env.GMGN_API_KEY?.trim();
  return value ? value : null;
}

function configuredRequestsPerSecond(): number {
  const value = Number(process.env.GMGN_MAX_REQUESTS_PER_SECOND ?? "1");
  return Number.isSafeInteger(value) && value >= 1 && value <= 20 ? value : 1;
}

function sharedProviderWait(
  wait: GmgnChartReadWaitV1,
): GmgnChartProviderReadWaitV1 {
  const now = wait.now ?? (() => new Date());
  const startedAtMs = now().getTime();
  return {
    fetchImpl: wait.fetchImpl,
    now,
    accountGate: wait.accountGate,
    deadlineMs: Number.isFinite(startedAtMs)
      ? startedAtMs + GMGN_REQUEST_TIMEOUT_MS
      : Date.now() + GMGN_REQUEST_TIMEOUT_MS,
    signal: AbortSignal.timeout(GMGN_REQUEST_TIMEOUT_MS),
  };
}

async function settleProviderOperation<T>(
  pending: Promise<T>,
  operation: ProviderOperationV1,
): Promise<T | typeof PROVIDER_OPERATION_TIMED_OUT> {
  const remainingMs = operation.deadlineMs - operation.now().getTime();
  if (
    operation.signal.aborted ||
    !Number.isFinite(remainingMs) ||
    remainingMs <= 0
  ) {
    void pending.catch(() => undefined);
    return PROVIDER_OPERATION_TIMED_OUT;
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let onAbort: (() => void) | null = null;
  try {
    return await Promise.race([
      pending,
      new Promise<typeof PROVIDER_OPERATION_TIMED_OUT>((resolve) => {
        const timeout = () => resolve(PROVIDER_OPERATION_TIMED_OUT);
        onAbort = timeout;
        operation.signal.addEventListener("abort", timeout, { once: true });
        if (operation.signal.aborted) {
          timeout();
          return;
        }
        timer = setTimeout(
          timeout,
          Math.min(Math.ceil(remainingMs), 2_147_483_647),
        );
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
    if (onAbort !== null) operation.signal.removeEventListener("abort", onAbort);
  }
}

async function reserveProviderSlot(
  accountGate: GmgnAccountGateV1,
  input: Parameters<GmgnAccountGateV1["reserveSlot"]>[0],
  operation: ProviderOperationV1,
): Promise<Awaited<ReturnType<GmgnAccountGateV1["reserveSlot"]>>> {
  const pending = accountGate.reserveSlot(input);
  const settled = await settleProviderOperation(pending, operation);
  if (settled !== PROVIDER_OPERATION_TIMED_OUT) return settled;
  void pending.then(async (decision) => {
    if (decision?.kind !== "reserved") return;
    try {
      await accountGate.complete(decision);
    } catch {
      // The database retains its bounded lease when exact late cleanup fails.
    }
  }).catch(() => undefined);
  return null;
}

function callerCanAwaitSharedRead(
  wait: GmgnChartReadWaitV1,
  nowMs: number,
): boolean {
  if (!Number.isFinite(nowMs) || wait.signal?.aborted) return false;
  return wait.deadlineMs === undefined || (
    Number.isFinite(wait.deadlineMs) && wait.deadlineMs > nowMs
  );
}

function awaitSharedReadForCaller<T>(
  promise: Promise<T | null>,
  wait: GmgnChartReadWaitV1,
): Promise<T | null> {
  const nowMs = (wait.now ?? (() => new Date()))().getTime();
  if (!callerCanAwaitSharedRead(wait, nowMs)) return Promise.resolve(null);
  if (wait.signal === undefined && wait.deadlineMs === undefined) return promise;

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      wait.signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const abort = () => finish(null);
    wait.signal?.addEventListener("abort", abort, { once: true });
    if (wait.signal?.aborted) {
      finish(null);
      return;
    }
    if (wait.deadlineMs !== undefined) {
      timeout = setTimeout(
        () => finish(null),
        Math.max(1, Math.min(
          Math.ceil(wait.deadlineMs - nowMs),
          2_147_483_647,
        )),
      );
    }
    promise.then(finish, () => finish(null));
  });
}

function isGmgnMarketChartRangeV1(
  value: unknown,
): value is GmgnMarketChartRangeV1 {
  return value === "1h" || value === "1d" ||
    value === "1w" || value === "all";
}

function canonicalPositiveDecimal(value: unknown): string | null {
  const parsed = decimalParts(value);
  return parsed !== null && parsed.coefficient > 0n ? value as string : null;
}

function exactNonNegativeDecimalUsdToWadV1(value: unknown): string | null {
  const parsed = decimalParts(value);
  if (parsed === null || parsed.scale > USD_WAD) return null;
  const wad = parsed.coefficient * (USD_WAD / parsed.scale);
  return wad <= UINT256_MAX ? wad.toString() : null;
}

function isCanonicalSupplyV1(value: CanonicalSupplyV1): boolean {
  return typeof value.raw === "bigint" &&
    value.raw > 0n &&
    value.raw <= UINT256_MAX &&
    Number.isSafeInteger(value.decimals) &&
    value.decimals >= 0 &&
    value.decimals <= 255;
}

function providerSupplyMatchesCanonical(
  value: unknown,
  raw: bigint,
  decimals: number,
): boolean {
  const parsed = decimalParts(value);
  if (parsed === null) return false;
  return parsed.coefficient * 10n ** BigInt(decimals) ===
    raw * parsed.scale;
}

function decimalParts(value: unknown): Readonly<{
  coefficient: bigint;
  scale: bigint;
}> | null {
  if (typeof value !== "string" || value.length > 160) return null;
  const match = CANONICAL_DECIMAL.exec(value);
  if (!match) return null;
  const [whole, fraction = ""] = value.split(".");
  if (whole.length > 78 || fraction.length > 18) return null;
  try {
    return {
      coefficient: BigInt(`${whole}${fraction}`),
      scale: 10n ** BigInt(fraction.length),
    };
  } catch {
    return null;
  }
}

function compareDecimals(
  first: NonNullable<ReturnType<typeof decimalParts>>,
  second: NonNullable<ReturnType<typeof decimalParts>>,
): number {
  const difference = first.coefficient * second.scale -
    second.coefficient * first.scale;
  return difference === 0n ? 0 : difference > 0n ? 1 : -1;
}

function canonicalSafeInteger(value: unknown): number | null {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string" && CANONICAL_INTEGER.test(value)
      ? value
      : null;
  if (normalized === null) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function canonicalAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS.test(normalized) ? normalized as `0x${string}` : null;
}

function canonicalBytes32(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return BYTES32.test(normalized) ? normalized as `0x${string}` : null;
}

function tokenLocatorAddress(value: unknown): `0x${string}` | null {
  if (isRecord(value)) {
    return canonicalAddress(value.address ?? value.token_address);
  }
  return canonicalAddress(value);
}

function unwrapData(value: unknown): unknown {
  return isRecord(value) && value.data !== undefined ? value.data : value;
}

function hasExactOptionalEthereumChain(value: unknown): boolean {
  return !isRecord(value) ||
    !Object.prototype.hasOwnProperty.call(value, "chain") ||
    value.chain === "eth";
}

function isRateLimitedEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const joined = [value.code, value.error, value.message]
    .map((item) => String(item ?? "").toUpperCase())
    .join(":");
  return joined.includes("429") ||
    joined.includes("RATE_LIMIT_EXCEEDED") || joined.includes("BANNED");
}

function providerCooldownFromResponse(
  headers: Headers,
  envelope: unknown,
  nowMs: number,
): number {
  const maximum = nowMs + GMGN_MAXIMUM_RATE_LIMIT_COOLDOWN_MS;
  if (isRecord(envelope)) {
    const resetAt = canonicalSafeInteger(envelope.reset_at);
    if (resetAt !== null && resetAt > 0) {
      return Math.min(maximum, Math.max(nowMs, resetAt * 1_000) + 250);
    }
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
    if (Number.isFinite(candidate)) return Math.min(maximum, candidate);
  }
  const resetHeader = headers.get("x-ratelimit-reset")?.trim();
  const reset = resetHeader ? Number(resetHeader) : Number.NaN;
  if (Number.isFinite(reset)) {
    return Math.min(
      maximum,
      Math.max(nowMs, Math.ceil(reset * 1_000)) + 250,
    );
  }
  return nowMs + 2_000;
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
    // The read already fails soft. The shared gate will be checked again by the
    // next request rather than bypassed in this process.
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

function safeJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function currentCacheValue<T>(
  cache: ReadonlyMap<string, CachedValue<T>>,
  key: string,
  nowMs: number,
): T | undefined {
  const cached = cache.get(key);
  return cached && cached.expiresAtMs > nowMs ? cached.value : undefined;
}

function setCacheValue<T>(
  cache: Map<string, CachedValue<T>>,
  key: string,
  value: T,
  expiresAtMs: number,
): void {
  cache.delete(key);
  cache.set(key, { expiresAtMs, value });
  while (cache.size > GMGN_MAXIMUM_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
