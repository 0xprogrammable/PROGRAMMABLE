import "server-only";

import { formatUnits } from "viem";

import {
  MARKET_DATA_CURRENT_MAX_AGE_MS,
  MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD,
} from "../market-data/market-data-v1";
import type { LauncherToken } from "../tokens";
import { computeOfficialV4PoolId } from "../uniswap/liquidity-launcher-sdk";
import { marketCapNativeWadFromSqrtPriceX96 } from "./math";
import type { ExplorePage } from "./types";
import { usdValueFromWei } from "./usd";

export const OFFICIAL_MAINNET_V4_SUBGRAPH_ID =
  "DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G";
const OFFICIAL_MAINNET_V4_SUBGRAPH_URL =
  `https://gateway.thegraph.com/api/subgraphs/id/${OFFICIAL_MAINNET_V4_SUBGRAPH_ID}`;
export const OFFICIAL_MAINNET_V4_SUBGRAPH_DEPLOYMENT =
  "QmZsgJLiLQKpb8hxTmQ5LWyrFVvfWzVaL4WK8dfFBn7EeK";
export const OFFICIAL_V4_LIQUIDITY_EVIDENCE_SOURCE =
  "official-uniswap-v4-subgraph" as const;
export const OFFICIAL_V4_POOL_TVL_ELIGIBILITY_MINIMUM_USD_WAD =
  MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD;
export const OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS = 24;
export const OFFICIAL_V4_LIQUIDITY_MAXIMUM_POOL_IDS_PER_READ = 384;
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
const NATIVE_CURRENCY_ADDRESS = "0x0000000000000000000000000000000000000000";

const POOL_ANALYTICS_QUERY = `
  query ProgrammableExplorePools($poolIds: [ID!]!, $first: Int!) {
    _meta {
      deployment
      block {
        number
        hash
        timestamp
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
      token0 { id decimals }
      token1 { id decimals }
      hooks
      feeTier
      tickSpacing
      liquidity
      sqrtPrice
      tick
      txCount
      volumeUSD
      totalValueLockedToken0
      totalValueLockedToken1
      totalValueLockedUSD
    }
  }
`;

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

type ParsedPool = {
  id: `0x${string}`;
  token0: `0x${string}`;
  token0Decimals: number;
  token1: `0x${string}`;
  token1Decimals: number;
  hooks: `0x${string}`;
  feeTierPips: string;
  tickSpacing: number;
  liquidity: string;
  sqrtPriceX96: string;
  tick?: number;
  transactionCount: string;
  volumeUsdWad: string;
  totalValueLockedToken0: string;
  totalValueLockedToken1: string;
  tvlUsdWad: string;
};

type ParsedResponse = {
  deployment: string;
  indexedBlockNumber: string;
  indexedBlockHash: `0x${string}`;
  indexedBlockTimestamp: string;
  indexedBlockTime: string;
  pools: ParsedPool[];
};

export type OfficialV4SubgraphOptions = {
  apiKey?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetcher?: Fetcher;
};

export type OfficialV4LiquidityEvidenceV1 = Readonly<{
  source: typeof OFFICIAL_V4_LIQUIDITY_EVIDENCE_SOURCE;
  identity: Readonly<{
    chainId: "1";
    protocol: "uniswap_v4";
    poolId: `0x${string}`;
    tokenAddress: `0x${string}`;
    quoteAddress: `0x${string}`;
  }>;
  valueBasis: "official-subgraph-pool-tvl-usd";
  tvlUsdWad: string;
  reportedPoolBalances: Readonly<{
    token0: Readonly<{
      address: `0x${string}`;
      decimals: number;
      amountDecimal: string;
    }>;
    token1: Readonly<{
      address: `0x${string}`;
      decimals: number;
      amountDecimal: string;
    }>;
  }>;
  freshness: "current";
  provenance: Readonly<{
    subgraphId: typeof OFFICIAL_MAINNET_V4_SUBGRAPH_ID;
    deployment: typeof OFFICIAL_MAINNET_V4_SUBGRAPH_DEPLOYMENT;
    indexedBlockNumber: string;
    indexedBlockHash: `0x${string}`;
    indexedBlockTimestamp: string;
    indexedBlockTime: string;
    referenceHeadBlockNumber: string;
    referenceHeadBlockHash: `0x${string}`;
    lagBlocks: string;
  }>;
}>;

export type OfficialV4LiquidityReferenceHeadV1 = Readonly<{
  chainId: 1;
  blockNumber: string;
  blockHash: `0x${string}`;
}>;

export class OfficialV4LiquidityEvidenceReadError extends Error {
  readonly code:
    | "invalid-input"
    | "invalid-config"
    | "coverage-incomplete";

  constructor(code: OfficialV4LiquidityEvidenceReadError["code"]) {
    super(`Official Uniswap v4 liquidity evidence read failed: ${code}`);
    this.name = "OfficialV4LiquidityEvidenceReadError";
    this.code = code;
  }
}

type FetcherState = {
  cache: Map<string, { expiresAt: number; response: ParsedResponse }>;
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

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function strictUnsignedInteger(value: unknown, maximumDigits = 78): string {
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
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
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
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return invalidResponse();
  }
  return value.toLowerCase() as `0x${string}`;
}

function strictBytes32(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
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
  if (!Number.isSafeInteger(parsed) || parsed < -887_272 || parsed > 887_272) {
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

function strictDecimals(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) {
    return invalidResponse();
  }
  return parsed;
}

function strictUnsignedDecimal(value: unknown): string {
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
  return value;
}

function decimalToWad(value: unknown): string {
  const decimal = strictUnsignedDecimal(value);
  const [integerPart, fractionalPart = ""] = decimal.split(".");
  const fraction = `${fractionalPart}000000000000000000`.slice(0, 18);
  return (
    BigInt(integerPart) * 10n ** 18n +
    BigInt(fraction || "0")
  ).toString();
}

function strictBlockTimestamp(value: unknown): {
  timestamp: string;
  time: string;
} {
  const timestamp = strictBlockNumber(value);
  if (timestamp > 8_640_000_000_000n) return invalidResponse();
  const milliseconds = Number(timestamp) * 1_000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) {
    return invalidResponse();
  }
  return { timestamp: timestamp.toString(), time: date.toISOString() };
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
      "totalValueLockedToken0",
      "totalValueLockedToken1",
      "totalValueLockedUSD",
    ]) ||
    !isRecord(value.token0) ||
    !hasOnlyKeys(value.token0, ["id", "decimals"]) ||
    !isRecord(value.token1) ||
    !hasOnlyKeys(value.token1, ["id", "decimals"])
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
    token0Decimals: strictDecimals(value.token0.decimals),
    token1,
    token1Decimals: strictDecimals(value.token1.decimals),
    hooks,
    feeTierPips,
    tickSpacing,
    liquidity: strictUnsignedInteger(value.liquidity),
    sqrtPriceX96: strictUnsignedInteger(value.sqrtPrice),
    tick: strictTick(value.tick),
    transactionCount: strictUnsignedInteger(value.txCount),
    volumeUsdWad: decimalToWad(value.volumeUSD),
    totalValueLockedToken0: strictUnsignedDecimal(
      value.totalValueLockedToken0,
    ),
    totalValueLockedToken1: strictUnsignedDecimal(
      value.totalValueLockedToken1,
    ),
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
    value.data._meta.deployment !== OFFICIAL_MAINNET_V4_SUBGRAPH_DEPLOYMENT ||
    value.data._meta.hasIndexingErrors !== false ||
    !isRecord(value.data._meta.block) ||
    !hasOnlyKeys(value.data._meta.block, ["number", "hash", "timestamp"]) ||
    !Array.isArray(value.data.pools) ||
    value.data.pools.length > OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS
  ) {
    return invalidResponse();
  }

  const indexedBlockNumber = strictBlockNumber(value.data._meta.block.number);
  const indexedBlockTimestamp = strictBlockTimestamp(
    value.data._meta.block.timestamp,
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
    indexedBlockTimestamp: indexedBlockTimestamp.timestamp,
    indexedBlockTime: indexedBlockTimestamp.time,
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
    value.length >= 8 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function boundedTimeout(value: number | undefined) {
  return Number.isSafeInteger(value) && value !== undefined && value > 0
    ? Math.min(value, 5_000)
    : DEFAULT_TIMEOUT_MS;
}

function canonicalPoolIds(
  tokens: readonly LauncherToken[],
  maximum = OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS,
) {
  const poolIds: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const poolId = token.poolId.toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(poolId) || seen.has(poolId)) continue;
    seen.add(poolId);
    poolIds.push(poolId);
    if (poolIds.length === maximum) break;
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
          first: OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS,
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
  const counterCurrency =
    token.launchModel === "stock-paired"
      ? token.quoteAssetAddress?.toLowerCase()
      : NATIVE_CURRENCY_ADDRESS;
  if (
    !counterCurrency ||
    !/^0x[0-9a-f]{40}$/.test(counterCurrency) ||
    counterCurrency === tokenAddress
  ) {
    return false;
  }
  const currencies = new Set<string>([pool.token0, pool.token1]);
  return (
    pool.hooks === hookAddress &&
    currencies.has(tokenAddress) &&
    currencies.has(counterCurrency)
  );
}

function matchesCanonicalLiquidityEvidence(
  pool: ParsedPool,
  token: LauncherToken,
) {
  if (
    !matchesCanonicalToken(pool, token) ||
    typeof token.tokenDecimals !== "number" ||
    !Number.isInteger(token.tokenDecimals) ||
    token.tokenDecimals < 0 ||
    token.tokenDecimals > 255
  ) {
    return false;
  }

  const tokenAddress = token.tokenAddress.toLowerCase();
  const tokenIsCurrency0 = pool.token0 === tokenAddress;
  const tokenDecimals = tokenIsCurrency0
    ? pool.token0Decimals
    : pool.token1Decimals;
  const counterCurrencyDecimals = tokenIsCurrency0
    ? pool.token1Decimals
    : pool.token0Decimals;
  if (
    tokenDecimals !== token.tokenDecimals ||
    counterCurrencyDecimals !== 18
  ) {
    return false;
  }

  if (token.launchModel !== "stock-paired") return true;
  return (
    typeof token.quoteIsCurrency0 === "boolean" &&
    token.quoteIsCurrency0 === !tokenIsCurrency0
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
      indexedBlockHash.toLowerCase() === canonicalBlockHash.toLowerCase())
  );
}

function canonicalReferenceHead(
  value: unknown,
): OfficialV4LiquidityReferenceHeadV1 | undefined {
  if (
    !isRecord(value) ||
    value.chainId !== 1 ||
    typeof value.blockNumber !== "string" ||
    !/^(0|[1-9]\d*)$/.test(value.blockNumber) ||
    value.blockNumber.length > 78 ||
    typeof value.blockHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(value.blockHash)
  ) {
    return undefined;
  }
  return {
    chainId: 1,
    blockNumber: BigInt(value.blockNumber).toString(),
    blockHash: value.blockHash.toLowerCase() as `0x${string}`,
  };
}

function positiveDecimal(value: string) {
  const [integerPart, fractionalPart = ""] = value.split(".");
  return BigInt(integerPart) > 0n || /[1-9]/.test(fractionalPart);
}

function supportsOfficialPoolTvlEvidence(token: LauncherToken) {
  return (
    token.launchModel === "classic" ||
    token.launchModel === "adaptive" ||
    token.launchModel === "deep" ||
    token.launchModel === "stock-paired"
  );
}

function referenceHeadLag(
  response: ParsedResponse,
  referenceHead: OfficialV4LiquidityReferenceHeadV1,
): string | undefined {
  const indexed = BigInt(response.indexedBlockNumber);
  const reference = BigInt(referenceHead.blockNumber);
  if (indexed > reference) return undefined;
  const lag = reference - indexed;
  if (
    lag > MAXIMUM_SUBGRAPH_LAG_BLOCKS ||
    (lag === 0n &&
      response.indexedBlockHash !== referenceHead.blockHash.toLowerCase())
  ) {
    return undefined;
  }
  return lag.toString();
}

function isCurrentIndexedTime(response: ParsedResponse, now: Date) {
  const nowMs = now.getTime();
  const indexedMs = Number(BigInt(response.indexedBlockTimestamp)) * 1_000;
  return (
    Number.isFinite(nowMs) &&
    Number.isFinite(indexedMs) &&
    indexedMs <= nowMs &&
    nowMs - indexedMs <= MARKET_DATA_CURRENT_MAX_AGE_MS
  );
}

function liquidityEvidence(
  token: LauncherToken,
  pool: ParsedPool,
  response: ParsedResponse,
  referenceHead: OfficialV4LiquidityReferenceHeadV1,
  lagBlocks: string,
): OfficialV4LiquidityEvidenceV1 | undefined {
  if (
    BigInt(pool.tvlUsdWad) <
    BigInt(OFFICIAL_V4_POOL_TVL_ELIGIBILITY_MINIMUM_USD_WAD)
  ) {
    return undefined;
  }
  if (
    !positiveDecimal(pool.totalValueLockedToken0) &&
    !positiveDecimal(pool.totalValueLockedToken1)
  ) {
    throw new OfficialV4LiquidityEvidenceReadError("coverage-incomplete");
  }
  const tokenAddress = token.tokenAddress.toLowerCase() as `0x${string}`;
  const quoteAddress = (
    pool.token0 === tokenAddress ? pool.token1 : pool.token0
  ) as `0x${string}`;
  return {
    source: OFFICIAL_V4_LIQUIDITY_EVIDENCE_SOURCE,
    identity: {
      chainId: "1",
      protocol: "uniswap_v4",
      poolId: pool.id,
      tokenAddress,
      quoteAddress,
    },
    valueBasis: "official-subgraph-pool-tvl-usd",
    tvlUsdWad: pool.tvlUsdWad,
    reportedPoolBalances: {
      token0: {
        address: pool.token0,
        decimals: pool.token0Decimals,
        amountDecimal: pool.totalValueLockedToken0,
      },
      token1: {
        address: pool.token1,
        decimals: pool.token1Decimals,
        amountDecimal: pool.totalValueLockedToken1,
      },
    },
    freshness: "current",
    provenance: {
      subgraphId: OFFICIAL_MAINNET_V4_SUBGRAPH_ID,
      deployment: OFFICIAL_MAINNET_V4_SUBGRAPH_DEPLOYMENT,
      indexedBlockNumber: response.indexedBlockNumber,
      indexedBlockHash: response.indexedBlockHash,
      indexedBlockTimestamp: response.indexedBlockTimestamp,
      indexedBlockTime: response.indexedBlockTime,
      referenceHeadBlockNumber: referenceHead.blockNumber,
      referenceHeadBlockHash: referenceHead.blockHash,
      lagBlocks,
    },
  };
}

/**
 * Reads independently attributable official Uniswap v4 subgraph pool TVL.
 *
 * Evidence is returned only for a canonical PoolKey, a fresh indexed block at
 * or behind the supplied reference head, and at least the public pool-TVL
 * eligibility floor. This aggregate TVL does not prove current-tick USD depth
 * or manipulation resistance. StateView's active-liquidity scalar is
 * deliberately not interpreted as reserves or TVL, and a missing or rejected
 * entry must stay unavailable.
 * An empty result means every eligible requested pool was covered but none
 * qualified. Invalid configuration or any failed batch rejects the whole read
 * so global ordering can never mistake partial coverage for complete coverage.
 */
export async function readOfficialV4LiquidityEvidence(
  input: {
    tokens: readonly LauncherToken[];
    referenceHead: OfficialV4LiquidityReferenceHeadV1;
    now?: Date;
  },
  options: OfficialV4SubgraphOptions = {},
): Promise<readonly OfficialV4LiquidityEvidenceV1[]> {
  const eligibleTokens = input.tokens.filter(supportsOfficialPoolTvlEvidence);
  if (eligibleTokens.length === 0) return [];

  const referenceHead = canonicalReferenceHead(input.referenceHead);
  const now = input.now ?? new Date();
  if (!referenceHead || !Number.isFinite(now.getTime())) {
    throw new OfficialV4LiquidityEvidenceReadError("invalid-input");
  }

  const apiKey =
    options.apiKey ?? process.env.UNISWAP_V4_SUBGRAPH_API_KEY ?? "";
  const endpoint =
    options.endpoint ??
    process.env.UNISWAP_V4_SUBGRAPH_URL ??
    OFFICIAL_MAINNET_V4_SUBGRAPH_URL;
  if (!validApiKey(apiKey) || !validEndpoint(endpoint)) {
    throw new OfficialV4LiquidityEvidenceReadError("invalid-config");
  }

  const poolIds = canonicalPoolIds(
    eligibleTokens,
    OFFICIAL_V4_LIQUIDITY_MAXIMUM_POOL_IDS_PER_READ + 1,
  );
  if (poolIds.length === 0) return [];
  if (poolIds.length > OFFICIAL_V4_LIQUIDITY_MAXIMUM_POOL_IDS_PER_READ) {
    throw new OfficialV4LiquidityEvidenceReadError("invalid-input");
  }

  const fetcher = options.fetcher ?? fetch;
  const requests: string[][] = [];
  for (
    let index = 0;
    index < poolIds.length;
    index += OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS
  ) {
    requests.push(
      poolIds.slice(index, index + OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS),
    );
  }

  const responses: ParsedResponse[] = [];
  for (
    let index = 0;
    index < requests.length;
    index += MAXIMUM_IN_FLIGHT_REQUESTS
  ) {
    let completed: {
      response: ParsedResponse;
      requestedPoolIds: string[];
    }[];
    try {
      completed = await Promise.all(
        requests
          .slice(index, index + MAXIMUM_IN_FLIGHT_REQUESTS)
          .map((requestedPoolIds) =>
            fetchPoolAnalyticsCached({
              endpoint,
              apiKey,
              poolIds: requestedPoolIds,
              timeoutMs: boundedTimeout(options.timeoutMs),
              fetcher,
            }).then((response) => ({ response, requestedPoolIds })),
          ),
      );
    } catch {
      throw new OfficialV4LiquidityEvidenceReadError("coverage-incomplete");
    }
    for (const result of completed) {
      const requested = new Set<string>(result.requestedPoolIds);
      const returned = new Set<string>(
        result.response.pools.map((pool) => pool.id),
      );
      if (
        returned.size !== requested.size ||
        [...requested].some((poolId) => !returned.has(poolId)) ||
        [...returned].some((poolId) => !requested.has(poolId))
      ) {
        throw new OfficialV4LiquidityEvidenceReadError(
          "coverage-incomplete",
        );
      }
      responses.push(result.response);
    }
  }

  const responseByPoolId = new Map<
    string,
    { pool: ParsedPool; response: ParsedResponse; lagBlocks: string }
  >();
  for (const response of responses) {
    const lagBlocks = referenceHeadLag(response, referenceHead);
    if (lagBlocks === undefined || !isCurrentIndexedTime(response, now)) {
      throw new OfficialV4LiquidityEvidenceReadError("coverage-incomplete");
    }
    for (const pool of response.pools) {
      responseByPoolId.set(pool.id, { pool, response, lagBlocks });
    }
  }

  const evidence: OfficialV4LiquidityEvidenceV1[] = [];
  for (const token of eligibleTokens) {
    const matched = responseByPoolId.get(token.poolId.toLowerCase());
    if (
      !matched ||
      !matchesCanonicalLiquidityEvidence(matched.pool, token)
    ) {
      throw new OfficialV4LiquidityEvidenceReadError("coverage-incomplete");
    }
    const item = liquidityEvidence(
      token,
      matched.pool,
      matched.response,
      referenceHead,
      matched.lagBlocks,
    );
    if (item) evidence.push(item);
  }
  return evidence;
}

function indexedMarketCap(
  token: LauncherToken,
  pool: ParsedPool,
  page: ExplorePage,
  indexedBlockNumber: string,
): Pick<
  LauncherToken,
  | "indexedMarketCapEth"
  | "indexedMarketCapEthWei"
  | "indexedMarketCapUsdWad"
  | "indexedValuationBlockNumber"
> {
  if (
    token.launchModel === "stock-paired" ||
    pool.token0 !== NATIVE_CURRENCY_ADDRESS ||
    !token.totalSupplyRaw ||
    !/^(0|[1-9]\d*)$/.test(token.totalSupplyRaw)
  ) {
    return {};
  }

  try {
    const marketCapWei = marketCapNativeWadFromSqrtPriceX96(
      BigInt(token.totalSupplyRaw),
      BigInt(pool.sqrtPriceX96),
    );
    if (marketCapWei <= 0n) return {};

    const quote = page.snapshot?.ethUsdQuote;
    const marketCapUsdWad =
      quote && /^(0|[1-9]\d*)$/.test(quote.answer)
        ? usdValueFromWei(
            marketCapWei.toString(),
            BigInt(quote.answer),
            quote.decimals,
          )
        : undefined;

    return {
      indexedMarketCapEth: formatUnits(marketCapWei, 18),
      indexedMarketCapEthWei: marketCapWei.toString(),
      ...(marketCapUsdWad === undefined
        ? {}
        : { indexedMarketCapUsdWad: marketCapUsdWad }),
      indexedValuationBlockNumber: indexedBlockNumber,
    };
  } catch {
    return {};
  }
}

/**
 * Adds read-only pool analytics to launches already proven by Programmable
 * events. A subgraph response can never create a token, change metadata, or
 * replace canonical onchain accounting.
 */
export async function enrichExplorePageWithOfficialV4Subgraph(
  page: ExplorePage,
  options: OfficialV4SubgraphOptions = {},
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
        return token;
      }
      return {
        ...token,
        ...indexedMarketCap(token, pool, page, response.indexedBlockNumber),
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
