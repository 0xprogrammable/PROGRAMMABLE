import "server-only";

import {
  CANONICAL_LAUNCH_STAMP_V1,
  type ExploreEntry,
} from "../tokens";
import {
  exactPositiveDecimalUsdToWadV1,
} from "./dexscreener-shadow-v1";
import { exploreEntryMarketIdentitiesV1 } from
  "./explore-market-identities";
import {
  PROGRAMMABLE_GMGN_MARKET_SNAPSHOT_SCHEMA_VERSION,
  isGmgnMarketSnapshotV1,
  type GmgnMarketSnapshotV1,
} from "./gmgn-market-data-v1";
import {
  getProductionGmgnAccountGateV1,
  type GmgnAccountGateV1,
} from "./gmgn-account-gate.server";
import type { MarketChartIdentityV1 } from "./market-data-v1";

const GMGN_API_ORIGIN = "https://openapi.gmgn.ai" as const;
const GMGN_REQUEST_TIMEOUT_MS = 1_500;
const GMGN_RESPONSE_MAXIMUM_BYTES = 1_000_000;
const GMGN_MARKET_CACHE_TTL_MS = 30_000;
const GMGN_FAILURE_CACHE_TTL_MS = 5_000;
const GMGN_MAXIMUM_CACHE_ENTRIES = 512;
const GMGN_MAXIMUM_CONCURRENCY = 3;
const GMGN_MAXIMUM_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const UINT256_MAX = (1n << 256n) - 1n;
const USD_WAD = 10n ** 18n;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const CANONICAL_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.([0-9]+))?$/u;

type FetchImplementation = typeof fetch;

export type GmgnReadWaitV1 = Readonly<{
  signal?: AbortSignal;
  deadlineMs?: number;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
  accountGate?: GmgnAccountGateV1;
}>;

type CachedValue<T> = Readonly<{
  expiresAtMs: number;
  value: T;
}>;

const snapshotCache = new Map<string, CachedValue<GmgnMarketSnapshotV1 | null>>();
const snapshotInFlight = new Map<string, Promise<GmgnMarketSnapshotV1 | null>>();

export function gmgnMarketDataConfiguredV1(): boolean {
  return readApiKey() !== null;
}

export function gmgnChainSlugV1(chainId: string | number):
  | "eth"
  | null {
  return String(chainId) === "1" ? "eth" : null;
}

export async function readGmgnExploreSnapshotsV1(
  entries: readonly ExploreEntry[],
  wait: GmgnReadWaitV1 = {},
): Promise<ReadonlyMap<string, GmgnMarketSnapshotV1>> {
  if (!gmgnMarketDataConfiguredV1()) return new Map();
  const results = await mapWithConcurrency(
    entries,
    GMGN_MAXIMUM_CONCURRENCY,
    async (entry) => [entry.id, await readGmgnMarketSnapshotV1(entry, wait)] as const,
  );
  return new Map(
    results.filter(
      (result): result is readonly [string, GmgnMarketSnapshotV1] =>
        result[1] !== null,
    ),
  );
}

export async function readGmgnMarketSnapshotV1(
  entry: ExploreEntry,
  wait: GmgnReadWaitV1 = {},
): Promise<GmgnMarketSnapshotV1 | null> {
  const apiKey = readApiKey();
  const canonicalSupply = canonicalSupplyV1(entry);
  const identities = exploreEntryMarketIdentitiesV1(entry);
  if (
    apiKey === null ||
    canonicalSupply === null ||
    !productionPoolManagerBoundV1(entry) ||
    identities.length === 0
  ) {
    return null;
  }
  const chain = gmgnChainSlugV1(identities[0]?.chainId ?? "");
  if (chain === null || identities.some((identity) =>
    gmgnChainSlugV1(identity.chainId) !== chain
  )) return null;

  const cacheKey = snapshotCacheKey(entry, identities, canonicalSupply);
  const nowMs = (wait.now ?? (() => new Date()))().getTime();
  const cached = currentCacheValue(snapshotCache, cacheKey, nowMs);
  if (cached !== undefined) return cached;
  const active = snapshotInFlight.get(cacheKey);
  if (active) return active;

  const promise = (async () => {
    const value = await gmgnJsonRequest(
      "/v1/token/info",
      { chain, address: identities[0]!.tokenAddress },
      apiKey,
      wait,
    );
    const snapshot = parseGmgnMarketSnapshotV1(
      value,
      identities,
      canonicalSupply,
      (wait.now ?? (() => new Date()))(),
    );
    setCacheValue(
      snapshotCache,
      cacheKey,
      snapshot,
      (wait.now ?? (() => new Date()))().getTime() +
        (snapshot === null ? GMGN_FAILURE_CACHE_TTL_MS : GMGN_MARKET_CACHE_TTL_MS),
    );
    return snapshot;
  })().finally(() => {
    if (snapshotInFlight.get(cacheKey) === promise) {
      snapshotInFlight.delete(cacheKey);
    }
  });
  snapshotInFlight.set(cacheKey, promise);
  return promise;
}

export function parseGmgnMarketSnapshotV1(
  response: unknown,
  identities: readonly MarketChartIdentityV1[],
  canonicalSupply: Readonly<{ raw: bigint; decimals: number }>,
  fetchedAt: Date,
): GmgnMarketSnapshotV1 | null {
  const data = unwrapData(response);
  if (!isRecord(data) || !isRecord(data.price) || !isRecord(data.pool)) {
    return null;
  }
  const tokenAddress = canonicalAddress(data.address);
  const poolId = canonicalBytes32(data.pool.pool_address);
  const quoteAddress = canonicalAddress(data.pool.quote_address);
  const identity = identities.find((candidate) =>
    candidate.protocol === "uniswap_v4" &&
    candidate.tokenAddress === tokenAddress &&
    candidate.poolId === poolId &&
    candidate.quoteAddress === quoteAddress
  );
  if (
    identity === undefined ||
    String(data.pool.exchange).toLowerCase() !== "uniswap_v4" ||
    !poolBaseQuoteMatchesV1(data.pool, identity) ||
    (data.biggest_pool_address !== undefined &&
      canonicalBytes32(data.biggest_pool_address) !== identity.poolId) ||
    !providerSupplyMatchesCanonical(
      data.total_supply,
      canonicalSupply.raw,
      canonicalSupply.decimals,
    )
  ) return null;

  const priceUsdWad = exactPositiveDecimalUsdToWadV1(data.price.price);
  const liquidityUsdWad = exactPositiveDecimalUsdToWadV1(data.pool.liquidity);
  const volume24hUsdWad = exactNonNegativeDecimalUsdToWadV1(
    data.price.volume_24h,
  );
  const swapCount24h = canonicalSafeInteger(data.price.swaps_24h);
  if (
    priceUsdWad === null ||
    liquidityUsdWad === null ||
    volume24hUsdWad === null ||
    swapCount24h === null ||
    !Number.isFinite(fetchedAt.getTime())
  ) return null;
  const divisor = 10n ** BigInt(canonicalSupply.decimals);
  const fdvUsdWad = (BigInt(priceUsdWad) * canonicalSupply.raw) / divisor;
  if (fdvUsdWad <= 0n || fdvUsdWad > UINT256_MAX) return null;

  const snapshot: GmgnMarketSnapshotV1 = {
    schemaVersion: PROGRAMMABLE_GMGN_MARKET_SNAPSHOT_SCHEMA_VERSION,
    source: "gmgn",
    currency: "USD",
    fetchedAt: fetchedAt.toISOString(),
    identity,
    priceUsdWad,
    fdvUsdWad: fdvUsdWad.toString(),
    liquidityUsdWad,
    volume24hUsdWad,
    swapCount24h,
  };
  return isGmgnMarketSnapshotV1(snapshot) ? snapshot : null;
}

function canonicalSupplyV1(
  entry: ExploreEntry,
): Readonly<{ raw: bigint; decimals: number }> | null {
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

function productionPoolManagerBoundV1(entry: ExploreEntry): boolean {
  if (entry.exploreKind !== "token") return false;
  const provenance = entry.launchCategoryProvenance;
  if (provenance.source === "canonical-launch-read-model") return true;
  const stamp = entry.launchStampProvenance;
  return provenance.source === "canonical-launch-stamp-router" &&
    stamp !== undefined &&
    canonicalAddress(stamp.poolManagerAddress) ===
      canonicalAddress(CANONICAL_LAUNCH_STAMP_V1.poolManagerAddress) &&
    canonicalAddress(stamp.poolProof.poolManagerAddress) ===
      canonicalAddress(CANONICAL_LAUNCH_STAMP_V1.poolManagerAddress);
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

function poolBaseQuoteMatchesV1(
  pool: Record<string, unknown>,
  identity: MarketChartIdentityV1,
): boolean {
  const declaredBases = [pool.base_address, pool.token_address]
    .filter((value) => value !== undefined)
    .map(tokenLocatorAddress);
  if (declaredBases.some((value) => value !== identity.tokenAddress)) {
    return false;
  }
  const tokenPair = [pool.token0_address, pool.token1_address].filter(
    (value) => value !== undefined,
  );
  if (tokenPair.length === 0) return true;
  if (tokenPair.length !== 2) return false;
  const addresses = tokenPair.map(tokenLocatorAddress);
  return addresses.every((address): address is `0x${string}` => address !== null) &&
    new Set(addresses).size === 2 &&
    addresses.includes(identity.tokenAddress) &&
    addresses.includes(identity.quoteAddress);
}

function tokenLocatorAddress(value: unknown): `0x${string}` | null {
  if (isRecord(value)) {
    return canonicalAddress(value.address ?? value.token_address);
  }
  return canonicalAddress(value);
}

async function gmgnJsonRequest(
  path: "/v1/token/info",
  query: Readonly<Record<string, string>>,
  apiKey: string,
  wait: GmgnReadWaitV1,
): Promise<unknown | null> {
  const fetchImpl = wait.fetchImpl ?? fetch;
  const implicitDeadlineMs = (wait.now ?? (() => new Date()))().getTime() +
    GMGN_REQUEST_TIMEOUT_MS;
  const requestDeadlineMs = wait.deadlineMs ?? implicitDeadlineMs;
  if (wait.signal?.aborted) return null;
  const now = wait.now ?? (() => new Date());
  const queueTimeMs = now().getTime();
  if (requestDeadlineMs <= queueTimeMs) return null;
  let accountGate: GmgnAccountGateV1 | null = wait.accountGate ?? null;
  let reservation: Extract<
    Awaited<ReturnType<GmgnAccountGateV1["reserveSlot"]>>,
    { kind: "reserved" }
  > | null = null;
  try {
    if (
      accountGate === null
      && (process.env.NODE_ENV === "production" || fetchImpl === fetch)
    ) {
      accountGate = getProductionGmgnAccountGateV1();
    }
    if (accountGate !== null) {
      const decision = await accountGate.reserveSlot({
        requestsPerSecond: configuredRequestsPerSecond(),
        deadlineMs: requestDeadlineMs,
        signal: wait.signal,
      });
      if (decision?.kind !== "reserved") return null;
      reservation = decision;
    }
  } catch {
    // Production must never bypass the shared account gate when its database,
    // migration, role, or TLS authority is unavailable.
    return null;
  }
  const nowMs = now().getTime();
  const remaining = requestDeadlineMs - nowMs;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    await completeProviderRequest(accountGate, reservation);
    return null;
  }
  const url = new URL(path, GMGN_API_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("timestamp", String(Math.floor(nowMs / 1_000)));
  url.searchParams.set("client_id", crypto.randomUUID());
  const timeout = AbortSignal.timeout(
    Math.max(1, Math.min(GMGN_REQUEST_TIMEOUT_MS, remaining)),
  );
  const signal = wait.signal
    ? AbortSignal.any([wait.signal, timeout])
    : timeout;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", "X-APIKEY": apiKey },
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
    if (response.status === 429) {
      await publishProviderBlock(accountGate, reservation, response, null, nowMs);
    } else {
      await completeProviderRequest(accountGate, reservation);
    }
    return null;
  }
  const bytes = await readBoundedResponseBytes(
    response,
    GMGN_RESPONSE_MAXIMUM_BYTES,
  );
  if (bytes === null) {
    if (response.status === 429) {
      await publishProviderBlock(accountGate, reservation, response, null, nowMs);
    } else {
      await completeProviderRequest(accountGate, reservation);
    }
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    if (response.status === 429) {
      await publishProviderBlock(accountGate, reservation, response, null, nowMs);
    } else {
      await completeProviderRequest(accountGate, reservation);
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
    );
  } else if (!await completeProviderRequest(accountGate, reservation)) {
    return null;
  }
  if (!response.ok || rateLimited || value === null) return null;
  if (!isRecord(value) || value.code !== 0 || !isRecord(value.data)) {
    return null;
  }
  return value.data;
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

function readApiKey(): string | null {
  const value = process.env.GMGN_API_KEY?.trim();
  return value ? value : null;
}

function configuredRequestsPerSecond(): number {
  // GMGN's public OpenAPI notice documents one request per second by default.
  // A paid account may opt into its written allowance through the server-only
  // override without changing the provider contract in application code.
  const value = Number(process.env.GMGN_MAX_REQUESTS_PER_SECOND ?? "1");
  return Number.isSafeInteger(value) && value >= 1 && value <= 50 ? value : 1;
}

function unwrapData(value: unknown): unknown {
  return isRecord(value) && value.data !== undefined ? value.data : value;
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
      return Math.min(
        maximum,
        Math.max(nowMs, resetAt * 1_000) + 250,
      );
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
): Promise<void> {
  if (accountGate === null || reservation === null) return;
  try {
    await accountGate.blockUntil({
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
  } catch {
    // The provider response already fails soft. A later production request
    // must independently pass the database gate before another provider call.
  }
}

async function completeProviderRequest(
  accountGate: GmgnAccountGateV1 | null,
  reservation: Extract<
    Awaited<ReturnType<GmgnAccountGateV1["reserveSlot"]>>,
    { kind: "reserved" }
  > | null,
): Promise<boolean> {
  if (accountGate === null) return true;
  if (reservation === null) return false;
  try {
    await accountGate.complete(reservation);
    return true;
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

function exactNonNegativeDecimalUsdToWadV1(value: unknown): string | null {
  if (value === "0" || value === "0.0") return "0";
  const parsed = decimalParts(value);
  if (parsed === null || parsed.coefficient < 0n || parsed.scale > USD_WAD) {
    return null;
  }
  const wad = parsed.coefficient * (USD_WAD / parsed.scale);
  return wad <= UINT256_MAX ? wad.toString() : null;
}

function decimalParts(value: unknown): Readonly<{
  coefficient: bigint;
  scale: bigint;
}> | null {
  if (typeof value !== "string" || value.length > 160) return null;
  const match = POSITIVE_DECIMAL.exec(value);
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

function identityKey(identity: MarketChartIdentityV1) {
  return [
    identity.chainId,
    identity.protocol,
    identity.tokenAddress,
    identity.poolId,
    identity.quoteAddress,
  ].join(":");
}

function snapshotCacheKey(
  entry: ExploreEntry,
  identities: readonly MarketChartIdentityV1[],
  supply: Readonly<{ raw: bigint; decimals: number }>,
) {
  return [
    entry.id,
    supply.raw,
    supply.decimals,
    ...identities.map(identityKey).sort(),
  ].join(":");
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
) {
  cache.delete(key);
  cache.set(key, { expiresAtMs, value });
  while (cache.size > GMGN_MAXIMUM_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  callback: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= values.length) return;
        output[index] = await callback(values[index]!);
      }
    },
  ));
  return output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
