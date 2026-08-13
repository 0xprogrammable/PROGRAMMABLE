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

const POOL_ANALYTICS_AT_BLOCK_QUERY = `
  query ProgrammableExplorePoolsAtBlock(
    $poolIds: [ID!]!
    $first: Int!
    $blockNumber: Int!
  ) {
    _meta(block: { number: $blockNumber }) {
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
      block: { number: $blockNumber }
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

const POOL_SNAPSHOT_QUERY = `
  query ProgrammableExplorePoolSnapshot {
    _meta {
      deployment
      block {
        number
        hash
        timestamp
      }
      hasIndexingErrors
    }
  }
`;

const POOL_SNAPSHOT_AT_BLOCK_QUERY = `
  query ProgrammableExplorePoolSnapshotAtBlock($blockNumber: Int!) {
    _meta(block: { number: $blockNumber }) {
      deployment
      block {
        number
        hash
        timestamp
      }
      hasIndexingErrors
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
  signal?: AbortSignal;
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

export type OfficialV4LiquiditySnapshotV1 =
  OfficialV4LiquidityReferenceHeadV1;

export type OfficialV4LiquidityEvidenceSnapshotReadV1 = Readonly<{
  evidence: readonly OfficialV4LiquidityEvidenceV1[];
  snapshot: OfficialV4LiquiditySnapshotV1;
}>;

export type OfficialV4LiquidityEvidenceReadCategory =
  | "invalid-input"
  | "invalid-config"
  | "request-http"
  | "request-transport"
  | "request-timeout"
  | "request-capacity"
  | "request-circuit"
  | "response-schema"
  | "response-envelope-schema"
  | "response-meta-schema"
  | "response-block-schema"
  | "response-block-keys-schema"
  | "response-block-number-schema"
  | "response-block-hash-schema"
  | "response-block-timestamp-schema"
  | "response-pool-schema"
  | "response-pool-id-schema"
  | "response-pool-token-schema"
  | "response-pool-hook-schema"
  | "response-pool-fee-schema"
  | "response-pool-tick-schema"
  | "response-pool-market-schema"
  | "response-deployment"
  | "response-indexing-error"
  | "response-ahead"
  | "response-lag"
  | "response-hash"
  | "response-freshness"
  | "exact-pool-coverage"
  | "pool-identity";

export class OfficialV4LiquidityEvidenceReadError extends Error {
  readonly code:
    | "invalid-input"
    | "invalid-config"
    | "coverage-incomplete";
  readonly category: OfficialV4LiquidityEvidenceReadCategory;

  constructor(
    code: OfficialV4LiquidityEvidenceReadError["code"],
    category: OfficialV4LiquidityEvidenceReadCategory = code === "coverage-incomplete"
      ? "exact-pool-coverage"
      : code,
  ) {
    super(`Official Uniswap v4 liquidity evidence read failed: ${code}`);
    this.name = "OfficialV4LiquidityEvidenceReadError";
    this.code = code;
    this.category = category;
  }
}

class OfficialV4SubgraphDiagnosticError extends Error {
  readonly category: OfficialV4LiquidityEvidenceReadCategory;

  constructor(category: OfficialV4LiquidityEvidenceReadCategory) {
    super("Invalid Uniswap v4 subgraph response");
    this.name = "OfficialV4SubgraphDiagnosticError";
    this.category = category;
  }
}

/** Fixed-enum telemetry only; never includes URLs, keys, queries or raw errors. */
export function safeOfficialV4LiquidityEvidenceReadError(error: unknown) {
  if (!(error instanceof OfficialV4LiquidityEvidenceReadError)) return null;
  return { name: error.name, category: error.category } as const;
}

type FetcherState = {
  cache: Map<string, { expiresAt: number; response: ParsedResponse }>;
  inFlight: Map<string, Promise<ParsedResponse>>;
  consecutiveFailures: number;
  openUntil: number;
};

const fetcherStates = new WeakMap<Fetcher, FetcherState>();

function invalidResponse(
  category: OfficialV4LiquidityEvidenceReadCategory = "response-schema",
): never {
  throw new OfficialV4SubgraphDiagnosticError(category);
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

function strictUnsignedInteger(
  value: unknown,
  maximumDigits = 78,
  category: OfficialV4LiquidityEvidenceReadCategory = "response-schema",
): string {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)$/.test(value) ||
    value.length > maximumDigits
  ) {
    return invalidResponse(category);
  }
  return value;
}

function strictBlockNumber(
  value: unknown,
  category: OfficialV4LiquidityEvidenceReadCategory = "response-schema",
): bigint {
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
  return invalidResponse(category);
}

function strictAddress(
  value: unknown,
  category: OfficialV4LiquidityEvidenceReadCategory = "response-schema",
): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    return invalidResponse(category);
  }
  return value.toLowerCase() as `0x${string}`;
}

function strictBytes32(
  value: unknown,
  category: OfficialV4LiquidityEvidenceReadCategory = "response-schema",
): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    return invalidResponse(category);
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
    return invalidResponse("response-pool-tick-schema");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < -887_272 || parsed > 887_272) {
    return invalidResponse("response-pool-tick-schema");
  }
  return parsed;
}

function strictTickSpacing(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^[1-9]\d*$/.test(value) ||
    value.length > 5
  ) {
    return invalidResponse("response-pool-fee-schema");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 32_767) {
    return invalidResponse("response-pool-fee-schema");
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
    return invalidResponse("response-pool-token-schema");
  }
  return parsed;
}

function strictUnsignedDecimal(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 160 ||
    !/^(0|[1-9]\d*)(?:\.(\d+))?$/.test(value)
  ) {
    return invalidResponse("response-pool-market-schema");
  }
  const [integerPart, fractionalPart = ""] = value.split(".");
  if (integerPart.length > 78 || fractionalPart.length > 78) {
    return invalidResponse("response-pool-market-schema");
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
  const timestamp = strictBlockNumber(
    value,
    "response-block-timestamp-schema",
  );
  if (timestamp > 8_640_000_000_000n) {
    return invalidResponse("response-block-timestamp-schema");
  }
  const milliseconds = Number(timestamp) * 1_000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(milliseconds) || Number.isNaN(date.getTime())) {
    return invalidResponse("response-block-timestamp-schema");
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
    return invalidResponse("response-pool-schema");
  }

  const token0 = strictAddress(value.token0.id, "response-pool-token-schema");
  const token1 = strictAddress(value.token1.id, "response-pool-token-schema");
  const hooks = strictAddress(value.hooks, "response-pool-hook-schema");
  const feeTierPips = strictUnsignedInteger(
    value.feeTier,
    8,
    "response-pool-fee-schema",
  );
  const fee = BigInt(feeTierPips);
  if (
    (fee > 1_000_000n && fee !== 0x80_0000n) ||
    BigInt(token0) >= BigInt(token1)
  ) {
    return invalidResponse("response-pool-fee-schema");
  }
  const tickSpacing = strictTickSpacing(value.tickSpacing);
  const id = strictBytes32(value.id, "response-pool-id-schema");
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
    return invalidResponse("response-pool-id-schema");
  }
  if (id !== recomputedId) return invalidResponse("response-pool-id-schema");

  return {
    id,
    token0,
    token0Decimals: strictDecimals(value.token0.decimals),
    token1,
    token1Decimals: strictDecimals(value.token1.decimals),
    hooks,
    feeTierPips,
    tickSpacing,
    liquidity: strictUnsignedInteger(
      value.liquidity,
      78,
      "response-pool-market-schema",
    ),
    sqrtPriceX96: strictUnsignedInteger(
      value.sqrtPrice,
      78,
      "response-pool-market-schema",
    ),
    tick: strictTick(value.tick),
    transactionCount: strictUnsignedInteger(
      value.txCount,
      78,
      "response-pool-market-schema",
    ),
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
    !hasOnlyKeys(value.data, ["_meta", "pools"])
  ) {
    return invalidResponse("response-envelope-schema");
  }
  if (
    !isRecord(value.data._meta) ||
    !hasOnlyKeys(value.data._meta, [
      "block",
      "deployment",
      "hasIndexingErrors",
    ])
  ) {
    return invalidResponse("response-meta-schema");
  }
  if (
    !isRecord(value.data._meta.block) ||
    !hasOnlyKeys(value.data._meta.block, ["number", "hash", "timestamp"])
  ) {
    return invalidResponse("response-block-keys-schema");
  }
  if (
    !Array.isArray(value.data.pools) ||
    value.data.pools.length > OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS
  ) {
    return invalidResponse("response-pool-schema");
  }
  if (value.data._meta.deployment !== OFFICIAL_MAINNET_V4_SUBGRAPH_DEPLOYMENT) {
    return invalidResponse("response-deployment");
  }
  if (value.data._meta.hasIndexingErrors !== false) {
    return invalidResponse("response-indexing-error");
  }

  const indexedBlockNumber = strictBlockNumber(
    value.data._meta.block.number,
    "response-block-number-schema",
  );
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
    indexedBlockHash: strictBytes32(
      value.data._meta.block.hash,
      "response-block-hash-schema",
    ),
    indexedBlockTimestamp: indexedBlockTimestamp.timestamp,
    indexedBlockTime: indexedBlockTimestamp.time,
    pools,
  };
}

function parseOfficialV4SubgraphSnapshotResponse(value: unknown) {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["data"]) ||
    !isRecord(value.data) ||
    !hasOnlyKeys(value.data, ["_meta"])
  ) {
    return invalidResponse("response-envelope-schema");
  }
  return parseOfficialV4SubgraphResponse({
    data: { _meta: value.data._meta, pools: [] },
  });
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
    return invalidResponse();
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return invalidResponse();
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
        return invalidResponse();
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
  referenceSnapshot?: OfficialV4LiquidityReferenceHeadV1;
  cacheNamespace?: "display" | "liquidity";
  metaOnly?: boolean;
  timeoutMs: number;
  fetcher: Fetcher;
  signal?: AbortSignal;
}) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(input.signal?.reason);
  const timeout = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    input.timeoutMs,
  );
  if (input.signal?.aborted) abortFromCaller();
  else input.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    controller.signal.throwIfAborted();
    const response = await input.fetcher(input.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input.metaOnly
        ? {
            query: input.referenceSnapshot
              ? POOL_SNAPSHOT_AT_BLOCK_QUERY
              : POOL_SNAPSHOT_QUERY,
            variables: input.referenceSnapshot
              ? { blockNumber: Number(input.referenceSnapshot.blockNumber) }
              : {},
          }
        : {
            query: input.referenceSnapshot
              ? POOL_ANALYTICS_AT_BLOCK_QUERY
              : POOL_ANALYTICS_QUERY,
            variables: {
              poolIds: input.poolIds,
              first: OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS,
              ...(input.referenceSnapshot
                ? { blockNumber: Number(input.referenceSnapshot.blockNumber) }
                : {}),
            },
          }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new OfficialV4SubgraphDiagnosticError("request-http");
    }
    const body = await readBoundedResponseBody(response);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return invalidResponse();
    }
    return input.metaOnly
      ? parseOfficialV4SubgraphSnapshotResponse(parsed)
      : parseOfficialV4SubgraphResponse(parsed);
  } catch (error) {
    if (input.signal?.aborted) throw error;
    if (timedOut) {
      throw new OfficialV4SubgraphDiagnosticError("request-timeout");
    }
    if (error instanceof OfficialV4SubgraphDiagnosticError) throw error;
    throw new OfficialV4SubgraphDiagnosticError("request-transport");
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", abortFromCaller);
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

function cacheKey(
  poolIds: readonly string[],
  referenceSnapshot?: OfficialV4LiquidityReferenceHeadV1,
  cacheNamespace: "display" | "liquidity" = "display",
) {
  const pools = [...poolIds].sort().join(",");
  return referenceSnapshot
    ? `snapshot:${referenceSnapshot.blockNumber}:${referenceSnapshot.blockHash}:${pools}`
    : `${cacheNamespace}:latest:${pools}`;
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
  referenceSnapshot?: OfficialV4LiquidityReferenceHeadV1;
  cacheNamespace?: "display" | "liquidity";
  metaOnly?: boolean;
  timeoutMs: number;
  fetcher: Fetcher;
  signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const state = stateFor(input.fetcher);
  const now = Date.now();
  const key = cacheKey(
    input.poolIds,
    input.referenceSnapshot,
    input.cacheNamespace,
  );
  const cached = state.cache.get(key);
  if (cached && cached.expiresAt > now) return cached.response;
  if (cached) state.cache.delete(key);

  const pending = state.inFlight.get(key);
  if (pending) return pending;
  if (state.openUntil > now) {
    throw new OfficialV4SubgraphDiagnosticError("request-circuit");
  }
  if (state.inFlight.size >= MAXIMUM_IN_FLIGHT_REQUESTS) {
    throw new OfficialV4SubgraphDiagnosticError("request-capacity");
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
      if (input.signal?.aborted) throw error;
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
    BigInt(value.blockNumber) > 2_147_483_647n ||
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
    (lag === 0n && response.indexedBlockHash !== referenceHead.blockHash)
  ) {
    return undefined;
  }
  return lag.toString();
}

function responseIsAheadOfReferenceHead(
  response: ParsedResponse,
  referenceHead: OfficialV4LiquidityReferenceHeadV1,
) {
  return BigInt(response.indexedBlockNumber) >
    BigInt(referenceHead.blockNumber);
}

function responseMatchesLiquiditySnapshot(
  response: ParsedResponse,
  snapshot: OfficialV4LiquiditySnapshotV1,
) {
  return response.indexedBlockNumber === snapshot.blockNumber &&
    response.indexedBlockHash === snapshot.blockHash;
}

function coverageFailure(
  category: OfficialV4LiquidityEvidenceReadCategory,
): OfficialV4LiquidityEvidenceReadError {
  return new OfficialV4LiquidityEvidenceReadError(
    "coverage-incomplete",
    category,
  );
}

function requestFailure(error: unknown): OfficialV4LiquidityEvidenceReadError {
  return coverageFailure(
    error instanceof OfficialV4SubgraphDiagnosticError
      ? error.category
      : "request-transport",
  );
}

function referenceHeadFailureCategory(
  response: ParsedResponse,
  referenceHead: OfficialV4LiquidityReferenceHeadV1,
): OfficialV4LiquidityEvidenceReadCategory {
  const indexed = BigInt(response.indexedBlockNumber);
  const reference = BigInt(referenceHead.blockNumber);
  if (indexed > reference) return "response-ahead";
  if (reference - indexed > MAXIMUM_SUBGRAPH_LAG_BLOCKS) return "response-lag";
  return "response-hash";
}

function snapshotFailureCategory(
  response: ParsedResponse,
  snapshot: OfficialV4LiquiditySnapshotV1,
): OfficialV4LiquidityEvidenceReadCategory {
  const indexed = BigInt(response.indexedBlockNumber);
  const expected = BigInt(snapshot.blockNumber);
  if (indexed > expected) return "response-ahead";
  return indexed === expected ? "response-hash" : "response-lag";
}

function responseCoversExactly(
  response: ParsedResponse,
  requestedPoolIds: readonly string[],
) {
  const requested = new Set<string>(requestedPoolIds);
  const returned = new Set<string>(response.pools.map((pool) => pool.id));
  return returned.size === requested.size &&
    [...requested].every((poolId) => returned.has(poolId)) &&
    [...returned].every((poolId) => requested.has(poolId));
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
    throw coverageFailure("pool-identity");
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
 * The first read selects one fresh Graph snapshot at or behind the supplied
 * RPC reference head. Every later batch is pinned to that exact Graph block
 * number, and its returned hash must match. A caller can supply the selected
 * snapshot again to replay a continuation without mixing Graph states.
 * Evidence is returned only for a canonical PoolKey and at least the public
 * pool-TVL eligibility floor. This aggregate TVL does not prove current-tick
 * USD depth or manipulation resistance. StateView's active-liquidity scalar
 * is deliberately not interpreted as reserves or TVL, and a missing or
 * rejected entry must stay unavailable.
 * An empty result means every eligible requested pool was covered but none
 * qualified. Invalid configuration or any failed batch rejects the whole read
 * so global ordering can never mistake partial coverage for complete coverage.
 */
export async function readOfficialV4LiquidityEvidenceSnapshot(
  input: {
    tokens: readonly LauncherToken[];
    referenceHead: OfficialV4LiquidityReferenceHeadV1;
    liquiditySnapshot?: OfficialV4LiquiditySnapshotV1;
    now?: Date;
  },
  options: OfficialV4SubgraphOptions = {},
): Promise<OfficialV4LiquidityEvidenceSnapshotReadV1> {
  options.signal?.throwIfAborted();
  const eligibleTokens = input.tokens.filter(supportsOfficialPoolTvlEvidence);
  const referenceHead = canonicalReferenceHead(input.referenceHead);
  const requestedSnapshot = input.liquiditySnapshot === undefined
    ? undefined
    : canonicalReferenceHead(input.liquiditySnapshot);
  const now = input.now ?? new Date();
  if (
    !referenceHead ||
    (input.liquiditySnapshot !== undefined && !requestedSnapshot) ||
    !Number.isFinite(now.getTime())
  ) {
    throw new OfficialV4LiquidityEvidenceReadError("invalid-input");
  }
  if (requestedSnapshot) {
    const requestedBlock = BigInt(requestedSnapshot.blockNumber);
    const referenceBlock = BigInt(referenceHead.blockNumber);
    if (
      requestedBlock > referenceBlock ||
      referenceBlock - requestedBlock > MAXIMUM_SUBGRAPH_LAG_BLOCKS ||
      (requestedBlock === referenceBlock &&
        requestedSnapshot.blockHash !== referenceHead.blockHash)
    ) {
      throw new OfficialV4LiquidityEvidenceReadError("invalid-input");
    }
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
  const fetcher = options.fetcher ?? fetch;

  if (eligibleTokens.length === 0) {
    let response: ParsedResponse;
    try {
      response = await fetchPoolAnalyticsCached({
        endpoint,
        apiKey,
        poolIds: [],
        referenceSnapshot: requestedSnapshot,
        cacheNamespace: "liquidity",
        metaOnly: true,
        timeoutMs: boundedTimeout(options.timeoutMs),
        fetcher,
        signal: options.signal,
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      throw requestFailure(error);
    }
    if (
      requestedSnapshot === undefined &&
      responseIsAheadOfReferenceHead(response, referenceHead)
    ) {
      try {
        response = await fetchPoolAnalyticsCached({
          endpoint,
          apiKey,
          poolIds: [],
          referenceSnapshot: referenceHead,
          cacheNamespace: "liquidity",
          metaOnly: true,
          timeoutMs: boundedTimeout(options.timeoutMs),
          fetcher,
          signal: options.signal,
        });
      } catch (error) {
        options.signal?.throwIfAborted();
        throw requestFailure(error);
      }
      if (!responseMatchesLiquiditySnapshot(response, referenceHead)) {
        throw coverageFailure(snapshotFailureCategory(response, referenceHead));
      }
    }
    if (referenceHeadLag(response, referenceHead) === undefined) {
      throw coverageFailure(referenceHeadFailureCategory(response, referenceHead));
    }
    if (
      requestedSnapshot !== undefined &&
      !responseMatchesLiquiditySnapshot(response, requestedSnapshot)
    ) {
      throw coverageFailure(snapshotFailureCategory(response, requestedSnapshot));
    }
    if (!isCurrentIndexedTime(response, now)) {
      throw coverageFailure("response-freshness");
    }
    return {
      evidence: [],
      snapshot: {
        chainId: 1,
        blockNumber: response.indexedBlockNumber,
        blockHash: response.indexedBlockHash,
      },
    };
  }

  const poolIds = canonicalPoolIds(
    eligibleTokens,
    OFFICIAL_V4_LIQUIDITY_MAXIMUM_POOL_IDS_PER_READ + 1,
  );
  if (poolIds.length === 0) {
    throw new OfficialV4LiquidityEvidenceReadError("invalid-input");
  }
  if (poolIds.length > OFFICIAL_V4_LIQUIDITY_MAXIMUM_POOL_IDS_PER_READ) {
    throw new OfficialV4LiquidityEvidenceReadError("invalid-input");
  }

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
  let liquiditySnapshot = requestedSnapshot;
  let requestIndex = 0;
  if (!liquiditySnapshot) {
    const requestedPoolIds = requests[0]!;
    let response: ParsedResponse;
    try {
      response = await fetchPoolAnalyticsCached({
        endpoint,
        apiKey,
        poolIds: requestedPoolIds,
        cacheNamespace: "liquidity",
        timeoutMs: boundedTimeout(options.timeoutMs),
        fetcher,
        signal: options.signal,
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      throw requestFailure(error);
    }
    if (responseIsAheadOfReferenceHead(response, referenceHead)) {
      try {
        response = await fetchPoolAnalyticsCached({
          endpoint,
          apiKey,
          poolIds: requestedPoolIds,
          referenceSnapshot: referenceHead,
          cacheNamespace: "liquidity",
          timeoutMs: boundedTimeout(options.timeoutMs),
          fetcher,
          signal: options.signal,
        });
      } catch (error) {
        options.signal?.throwIfAborted();
        throw requestFailure(error);
      }
      if (!responseMatchesLiquiditySnapshot(response, referenceHead)) {
        throw coverageFailure(snapshotFailureCategory(response, referenceHead));
      }
    }
    if (referenceHeadLag(response, referenceHead) === undefined) {
      throw coverageFailure(referenceHeadFailureCategory(response, referenceHead));
    }
    if (!responseCoversExactly(response, requestedPoolIds)) {
      throw coverageFailure("exact-pool-coverage");
    }
    if (!isCurrentIndexedTime(response, now)) {
      throw coverageFailure("response-freshness");
    }
    liquiditySnapshot = {
      chainId: 1,
      blockNumber: response.indexedBlockNumber,
      blockHash: response.indexedBlockHash,
    };
    responses.push(response);
    requestIndex = 1;
  }

  for (
    let index = requestIndex;
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
              referenceSnapshot: liquiditySnapshot,
              cacheNamespace: "liquidity",
              timeoutMs: boundedTimeout(options.timeoutMs),
              fetcher,
              signal: options.signal,
            }).then((response) => ({ response, requestedPoolIds })),
          ),
      );
    } catch (error) {
      options.signal?.throwIfAborted();
      throw requestFailure(error);
    }
    for (const result of completed) {
      if (!responseCoversExactly(result.response, result.requestedPoolIds)) {
        throw coverageFailure("exact-pool-coverage");
      }
      responses.push(result.response);
    }
  }

  if (!liquiditySnapshot) {
    throw coverageFailure("exact-pool-coverage");
  }

  const responseByPoolId = new Map<
    string,
    { pool: ParsedPool; response: ParsedResponse; lagBlocks: string }
  >();
  for (const response of responses) {
    const lagBlocks = referenceHeadLag(response, referenceHead);
    if (lagBlocks === undefined) {
      throw coverageFailure(referenceHeadFailureCategory(response, referenceHead));
    }
    if (!responseMatchesLiquiditySnapshot(response, liquiditySnapshot)) {
      throw coverageFailure(snapshotFailureCategory(response, liquiditySnapshot));
    }
    if (!isCurrentIndexedTime(response, now)) {
      throw coverageFailure("response-freshness");
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
      throw coverageFailure("pool-identity");
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
  return { evidence, snapshot: liquiditySnapshot };
}

export async function readOfficialV4LiquidityEvidence(
  input: {
    tokens: readonly LauncherToken[];
    referenceHead: OfficialV4LiquidityReferenceHeadV1;
    now?: Date;
  },
  options: OfficialV4SubgraphOptions = {},
): Promise<readonly OfficialV4LiquidityEvidenceV1[]> {
  if (input.tokens.filter(supportsOfficialPoolTvlEvidence).length === 0) {
    return [];
  }
  return (await readOfficialV4LiquidityEvidenceSnapshot(input, options))
    .evidence;
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
