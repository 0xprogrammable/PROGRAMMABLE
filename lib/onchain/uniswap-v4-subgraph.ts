import "server-only";

import type { LauncherToken } from "../tokens";
import { computeOfficialV4PoolId } from "../uniswap/liquidity-launcher-sdk";
import type { ExplorePage } from "./types";

const OFFICIAL_MAINNET_V4_SUBGRAPH_URL =
  "https://gateway.thegraph.com/api/subgraphs/id/DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G";
const OFFICIAL_MAINNET_V4_SUBGRAPH_DEPLOYMENT =
  "QmZsgJLiLQKpb8hxTmQ5LWyrFVvfWzVaL4WK8dfFBn7EeK";
const MAXIMUM_POOL_IDS = 24;
const MAXIMUM_RESPONSE_BYTES = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 2_500;
const SERVER_CACHE_TTL_MS = 15_000;
const MAXIMUM_SERVER_CACHE_ENTRIES = 64;
const MAXIMUM_IN_FLIGHT_REQUESTS = 8;
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_OPEN_MS = 10_000;
// Roughly 13 minutes at Mainnet's target block time. Older analytics are
// omitted instead of being presented beside a substantially newer RPC view.
const MAXIMUM_SUBGRAPH_LAG_BLOCKS = 64n;
const NATIVE_CURRENCY_ADDRESS =
  "0x0000000000000000000000000000000000000000";

const POOL_ANALYTICS_QUERY = `
  query ProgrammableExplorePools($poolIds: [ID!]!, $first: Int!) {
    _meta {
      deployment
      block {
        number
        hash
      }
      hasIndexingErrors
    }
    pools(
      first: $first
      where: { id_in: $poolIds }
      orderBy: id
      orderDirection: asc
    ) {
      id
      token0 { id }
      token1 { id }
      hooks
      feeTier
      tickSpacing
      liquidity
      sqrtPrice
      tick
      txCount
      volumeUSD
      totalValueLockedUSD
    }
  }
`;

type Fetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

type ParsedPool = {
  id: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  hooks: `0x${string}`;
  feeTierPips: string;
  tickSpacing: number;
  liquidity: string;
  sqrtPriceX96: string;
  tick?: number;
  transactionCount: string;
  volumeUsdWad: string;
  tvlUsdWad: string;
};

type ParsedResponse = {
  deployment: string;
  indexedBlockNumber: string;
  indexedBlockHash: `0x${string}`;
  pools: ParsedPool[];
};

type EnrichmentOptions = {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
};

type FetcherState = {
  cache: Map<
    string,
    { expiresAt: number; response: ParsedResponse }
  >;
  inFlight: Map<string, Promise<ParsedResponse>>;
  consecutiveFailures: number;
  openUntil: number;
};

const fetcherStates = new WeakMap<Fetcher, FetcherState>();

function invalidResponse(): never {
  throw new Error("Invalid Uniswap v4 subgraph response");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function strictUnsignedInteger(
  value: unknown,
  maximumDigits = 78,
): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    value.length > maximumDigits
  ) {
    return invalidResponse();
  }
  return value;
}

function strictBlockNumber(value: unknown): bigint {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return BigInt(value);
  }
  if (
    typeof value === "string" &&
    /^(0|[1-9]\d*)$/.test(value) &&
    value.length <= 78
  ) {
    return BigInt(value);
  }
  return invalidResponse();
}

function strictAddress(value: unknown): `0x${string}` {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(value)
  ) {
    return invalidResponse();
  }
  return value.toLowerCase() as `0x${string}`;
}

function strictBytes32(value: unknown): `0x${string}` {
  if (
    typeof value !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value)
  ) {
    return invalidResponse();
  }
  return value.toLowerCase() as `0x${string}`;
}

function strictTick(value: unknown): number | undefined {
  if (value === null) return undefined;
  if (
    typeof value !== "string" ||
    !/^-?(0|[1-9]\d*)$/.test(value) ||
    value.length > 8
  ) {
    return invalidResponse();
  }
  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < -887_272 ||
    parsed > 887_272
  ) {
    return invalidResponse();
  }
  return parsed;
}

function strictTickSpacing(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    value.length > 5
  ) {
    return invalidResponse();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 32_767) {
    return invalidResponse();
  }
  return parsed;
}

function decimalToWad(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    !/^(0|[1-9]\d*)(?:\.(\d+))?$/.test(value)
  ) {
    return invalidResponse();
  }
  const [integerPart, fractionalPart = ""] = value.split(".");
  if (integerPart.length > 78 || fractionalPart.length > 78) {
    return invalidResponse();
  }
  const fraction = `${fractionalPart}000000000000000000`.slice(0, 18);
  return (
    BigInt(integerPart) * 10n ** 18n +
    BigInt(fraction || "0")
  ).toString();
}

function parsePool(value: unknown): ParsedPool {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "id",
      "token0",
      "token1",
      "hooks",
      "feeTier",
      "tickSpacing",
      "liquidity",
      "sqrtPrice",
      "tick",
      "txCount",
      "volumeUSD",
      "totalValueLockedUSD",
    ]) ||
    !isRecord(value.token0) ||
    !hasOnlyKeys(value.token0, ["id"]) ||
    !isRecord(value.token1) ||
    !hasOnlyKeys(value.token1, ["id"])
  ) {
    return invalidResponse();
  }

  const token0 = strictAddress(value.token0.id);
  const token1 = strictAddress(value.token1.id);
  const hooks = strictAddress(value.hooks);
  const feeTierPips = strictUnsignedInteger(value.feeTier, 8);
  const fee = BigInt(feeTierPips);
  if (
    (fee > 1_000_000n && fee !== 0x80_0000n) ||
    BigInt(token0) >= BigInt(token1)
  ) {
    return invalidResponse();
  }
  const tickSpacing = strictTickSpacing(value.tickSpacing);
  const id = strictBytes32(value.id);
  let recomputedId: string;
  try {
    recomputedId = computeOfficialV4PoolId({
      currency0: token0,
      currency1: token1,
      fee: Number(fee),
      tickSpacing,
      hooks,
    }).toLowerCase();
  } catch {
    return invalidResponse();
  }
  if (id !== recomputedId) return invalidResponse();

  return {
    id,
    token0,
    token1,
    hooks,
    feeTierPips,
    tickSpacing,
    liquidity: strictUnsignedInteger(value.liquidity),
    sqrtPriceX96: strictUnsignedInteger(value.sqrtPrice),
    tick: strictTick(value.tick),
    transactionCount: strictUnsignedInteger(value.txCount),
    volumeUsdWad: decimalToWad(value.volumeUSD),
    tvlUsdWad: decimalToWad(value.totalValueLockedUSD),
  };
}

export function parseOfficialV4SubgraphResponse(
  value: unknown,
): ParsedResponse {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data"]) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["_meta", "pools"]) ||
    !isRecord(value.data._meta) ||
    !hasOnlyKeys(value.data._meta, [
      "block",
      "deployment",
      "hasIndexingErrors",
    ]) ||
    value.data._meta.deployment !==
      OFFICIAL_MAINNET_V4_SUBGRAPH_DEPLOYMENT ||
    value.data._meta.hasIndexingErrors !== false ||
    !isRecord(value.data._meta.block) ||
    !hasOnlyKeys(value.data._meta.block, ["number", "hash"]) ||
    !Array.isArray(value.data.pools) ||
    value.data.pools.length > MAXIMUM_POOL_IDS
  ) {
    return invalidResponse();
  }

  const indexedBlockNumber = strictBlockNumber(
    value.data._meta.block.number,
  );
  const pools = value.data.pools.map(parsePool);
  const uniquePoolIds = new Set(pools.map((pool) => pool.id));
  if (uniquePoolIds.size !== pools.length) {
    return invalidResponse();
  }

  return {
    deployment: OFFICIAL_MAINNET_V4_SUBGRAPH_DEPLOYMENT,
    indexedBlockNumber: indexedBlockNumber.toString(),
    indexedBlockHash: strictBytes32(value.data._meta.block.hash),
    pools,
  };
}

function validEndpoint(value: string) {
  try {
    const url = new URL(value);
    const official = new URL(OFFICIAL_MAINNET_V4_SUBGRAPH_URL);
    return (
      url.origin === official.origin &&
      url.pathname === official.pathname &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function validApiKey(value: string) {
  return (
    value.length >= 8 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function boundedTimeout(value: number | undefined) {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? Math.min(value, 5_000)
    : DEFAULT_TIMEOUT_MS;
}

function canonicalPoolIds(tokens: readonly LauncherToken[]) {
  const poolIds: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const poolId = token.poolId.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(poolId) || seen.has(poolId)) continue;
    seen.add(poolId);
    poolIds.push(poolId);
    if (poolIds.length === MAXIMUM_POOL_IDS) break;
  }
  return poolIds;
}

async function readBoundedResponseBody(response: Response) {
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^(0|[1-9]\d*)$/.test(declaredLength) ||
      declaredLength.length > 12 ||
      BigInt(declaredLength) > BigInt(MAXIMUM_RESPONSE_BYTES))
  ) {
    throw new Error("Uniswap v4 subgraph response is too large");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Uniswap v4 subgraph response has no body");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks: string[] = [];
  let bytesRead = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > MAXIMUM_RESPONSE_BYTES) {
        throw new Error("Uniswap v4 subgraph response is too large");
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    completed = true;
    return chunks.join("");
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

async function fetchPoolAnalytics(input: {
  endpoint: string;
  apiKey: string;
  poolIds: string[];
  timeoutMs: number;
  fetcher: Fetcher;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        query: POOL_ANALYTICS_QUERY,
        variables: {
          poolIds: input.poolIds,
          first: MAXIMUM_POOL_IDS,
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("Uniswap v4 subgraph request failed");
    }
    const body = await readBoundedResponseBody(response);
    return parseOfficialV4SubgraphResponse(JSON.parse(body));
  } finally {
    clearTimeout(timeout);
  }
}

function stateFor(fetcher: Fetcher) {
  const existing = fetcherStates.get(fetcher);
  if (existing) return existing;
  const created: FetcherState = {
    cache: new Map(),
    inFlight: new Map(),
    consecutiveFailures: 0,
    openUntil: 0,
  };
  fetcherStates.set(fetcher, created);
  return created;
}

function cacheKey(poolIds: readonly string[]) {
  return [...poolIds].sort().join(",");
}

function pruneCache(state: FetcherState, now: number) {
  for (const [key, entry] of state.cache) {
    if (entry.expiresAt <= now) state.cache.delete(key);
  }
  while (state.cache.size >= MAXIMUM_SERVER_CACHE_ENTRIES) {
    const oldest = state.cache.keys().next().value;
    if (oldest === undefined) break;
    state.cache.delete(oldest);
  }
}

async function fetchPoolAnalyticsCached(input: {
  endpoint: string;
  apiKey: string;
  poolIds: string[];
  timeoutMs: number;
  fetcher: Fetcher;
}) {
  const state = stateFor(input.fetcher);
  const now = Date.now();
  const key = cacheKey(input.poolIds);
  const cached = state.cache.get(key);
  if (cached && cached.expiresAt > now) return cached.response;
  if (cached) state.cache.delete(key);

  const pending = state.inFlight.get(key);
  if (pending) return pending;
  if (state.openUntil > now) {
    throw new Error("Uniswap v4 subgraph circuit is open");
  }
  if (state.inFlight.size >= MAXIMUM_IN_FLIGHT_REQUESTS) {
    throw new Error("Uniswap v4 subgraph request capacity reached");
  }

  const request = fetchPoolAnalytics(input)
    .then((response) => {
      state.consecutiveFailures = 0;
      state.openUntil = 0;
      const completedAt = Date.now();
      pruneCache(state, completedAt);
      state.cache.set(key, {
        expiresAt: completedAt + SERVER_CACHE_TTL_MS,
        response,
      });
      return response;
    })
    .catch((error: unknown) => {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
        state.openUntil = Date.now() + CIRCUIT_OPEN_MS;
      }
      throw error;
    })
    .finally(() => {
      state.inFlight.delete(key);
    });
  state.inFlight.set(key, request);
  return request;
}

function matchesCanonicalToken(pool: ParsedPool, token: LauncherToken) {
  const tokenAddress = token.tokenAddress.toLowerCase();
  const hookAddress = token.hookAddress.toLowerCase();
  const currencies = new Set<string>([pool.token0, pool.token1]);
  return (
    pool.hooks === hookAddress &&
    currencies.has(tokenAddress) &&
    currencies.has(NATIVE_CURRENCY_ADDRESS)
  );
}

function snapshotIsCompatible(
  indexedBlockNumber: string,
  indexedBlockHash: `0x${string}`,
  canonicalBlockNumber: string,
  canonicalBlockHash: `0x${string}`,
) {
  if (
    !/^(0|[1-9]\d*)$/.test(canonicalBlockNumber) ||
    canonicalBlockNumber.length > 78 ||
    !/^0x[0-9a-fA-F]{64}$/.test(canonicalBlockHash)
  ) {
    return false;
  }
  const indexed = BigInt(indexedBlockNumber);
  const canonical = BigInt(canonicalBlockNumber);
  const distance =
    indexed >= canonical ? indexed - canonical : canonical - indexed;
  return (
    distance <= MAXIMUM_SUBGRAPH_LAG_BLOCKS &&
    (indexed !== canonical ||
      indexedBlockHash.toLowerCase() ===
        canonicalBlockHash.toLowerCase())
  );
}

/**
 * Adds read-only pool analytics to launches already proven by Programmable
 * events. A subgraph response can never create a token, change metadata, or
 * replace canonical onchain accounting.
 */
export async function enrichExplorePageWithOfficialV4Subgraph(
  page: ExplorePage,
  options: EnrichmentOptions = {},
): Promise<ExplorePage> {
  if (
    page.status !== "ready" ||
    page.snapshot?.chainId !== 1 ||
    page.tokens.length === 0
  ) {
    return page;
  }

  const apiKey =
    options.apiKey ?? process.env.UNISWAP_V4_SUBGRAPH_API_KEY ?? "";
  const endpoint =
    options.endpoint ??
    process.env.UNISWAP_V4_SUBGRAPH_URL ??
    OFFICIAL_MAINNET_V4_SUBGRAPH_URL;
  if (!validApiKey(apiKey) || !validEndpoint(endpoint)) return page;

  const poolIds = canonicalPoolIds(page.tokens);
  if (poolIds.length === 0) return page;

  try {
    const response = await fetchPoolAnalyticsCached({
      endpoint,
      apiKey,
      poolIds,
      timeoutMs: boundedTimeout(options.timeoutMs),
      fetcher: options.fetcher ?? fetch,
    });
    const requested = new Set(poolIds);
    if (
      !snapshotIsCompatible(
        response.indexedBlockNumber,
        response.indexedBlockHash,
        page.snapshot.blockNumber,
        page.snapshot.blockHash,
      ) ||
      response.pools.some((pool) => !requested.has(pool.id))
    ) {
      return page;
    }

    const pools = new Map<string, ParsedPool>(
      response.pools.map((pool) => [pool.id, pool]),
    );
    const tokens = page.tokens.map((token) => {
      const pool = pools.get(token.poolId.toLowerCase());
      if (!pool) return token;
      if (!matchesCanonicalToken(pool, token)) {
        throw new Error("Subgraph pool does not match canonical launch");
      }
      return {
        ...token,
        uniswapV4Pool: {
          source: "official-uniswap-v4-subgraph" as const,
          indexedBlockNumber: response.indexedBlockNumber,
          indexedBlockHash: response.indexedBlockHash,
          volumeUsdWad: pool.volumeUsdWad,
          tvlUsdWad: pool.tvlUsdWad,
          transactionCount: pool.transactionCount,
          liquidity: pool.liquidity,
          sqrtPriceX96: pool.sqrtPriceX96,
          ...(pool.tick === undefined ? {} : { tick: pool.tick }),
          feeTierPips: pool.feeTierPips,
        },
      };
    });
    return { ...page, tokens };
  } catch {
    return page;
  }
}
