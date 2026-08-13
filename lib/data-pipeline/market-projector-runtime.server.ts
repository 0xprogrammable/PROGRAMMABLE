import "server-only";

import { randomUUID } from "node:crypto";

import { keccak256, toBytes, type Hex } from "viem";

import {
  bytes32FromBytea,
  canonicalBytes32,
  hexToBytes,
  parseNonnegativeIntegerText,
  type HexAddress,
  type HexBytes32,
} from "./codecs";
import { loadDataPipelineConfig } from "./config";
import {
  DataPipelineError,
  dataPipelineError,
  invalidInput,
  validationError,
} from "./errors";
import {
  createPostgresExecutor,
  type PostgresExecutor,
  type PostgresTransaction,
} from "./postgres";
import {
  validatedPostgresConnectionString,
  validatedPostgresSslCa,
} from "./postgres-connection.server";
import { boundedJsonRequest, type DataPipelineFetcher } from "./request";
import { getDataPipelineReleaseBinding } from "./release-binding.server";
import {
  assertProductionDualRpcProviders,
  createProductionDualRpcProviders,
} from "./rpc-providers.server";
import { productionMainnetRpcPair } from
  "../onchain/website-rpc-providers.server";
import {
  createUniswapAnalyticsClient,
  OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
  OFFICIAL_V4_SUBGRAPH_ID,
  priceRatiosFromSqrtPriceX96,
  UNISWAP_ANALYTICS_QUERY_CONTRACT,
  type AnalyticsResult,
  type CandleAnalytics,
  type PoolSnapshot,
  type VerifiedPoolKey,
} from "./uniswap";

type Environment = Readonly<Record<string, string | undefined>>;

const CHAIN_ID = 1;
const GRAPH_GATEWAY = "https://gateway.thegraph.com";
const MARKET_PROJECTOR_VERSION = "market-projector-v1";
const MARKET_PROJECTOR_LOGIN_ROLE = "programmable_reconciler_login";
const MARKET_PROJECTOR_CAPABILITY_ROLE = "programmable_reconciler";
const CHAINLINK_ETH_USD =
  "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419" as HexAddress;
const LATEST_ROUND_DATA_SELECTOR = "0xfeaf968c";
const MAXIMUM_CLOSE_BLOCKS = 8;
const MAXIMUM_POOLS_PER_CYCLE = 4;
const PROVIDER_CONCURRENCY = 4;
const MAXIMUM_PENDING_POOLS_PER_SCOPE = 4;
const DEADLINE_MS = 75_000;
const FAST_LANE_DEADLINE_MS = 25_000;
const CLOSE_RESERVE_MS = 5_000;
const DECIMAL_SCALE = 36;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const HEX32_PATTERN = /^0x[0-9a-f]{64}$/u;
const BROWSER_FORBIDDEN = [
  "NEXT_PUBLIC_PROGRAMMABLE_RECONCILER_DATABASE_URL",
  "NEXT_PUBLIC_PROGRAMMABLE_UNISWAP_GRAPH_API_KEY",
  "NEXT_PUBLIC_PROGRAMMABLE_UNISWAP_GRAPH_REDACTED_IDENTITY",
  "NEXT_PUBLIC_PROGRAMMABLE_UNISWAP_GRAPH_DEPLOYMENT_COMMITMENT",
  "NEXT_PUBLIC_PROGRAMMABLE_UNISWAP_GRAPH_SCHEMA_COMMITMENT",
] as const;

export const MARKET_GRAPH_QUERY_CONTRACT = Object.freeze({
  gateway: GRAPH_GATEWAY,
  subgraphId: OFFICIAL_V4_SUBGRAPH_ID,
  deployment: OFFICIAL_V4_SUBGRAPH_DEPLOYMENT,
  metadata: Object.freeze({
    requireDeployment: true,
    requireNoIndexingErrors: true,
    requireExactBlockNumberAndHash: true,
  }),
  analytics: UNISWAP_ANALYTICS_QUERY_CONTRACT,
});

export const MARKET_GRAPH_DEPLOYMENT_COMMITMENT = commitment(
  "graph-deployment-binding",
  {
    gateway: MARKET_GRAPH_QUERY_CONTRACT.gateway,
    subgraphId: MARKET_GRAPH_QUERY_CONTRACT.subgraphId,
    deployment: MARKET_GRAPH_QUERY_CONTRACT.deployment,
  },
);
export const MARKET_GRAPH_SCHEMA_COMMITMENT = commitment(
  "graph-query-contract",
  MARKET_GRAPH_QUERY_CONTRACT,
);

const RELEASE_SCOPES = Object.freeze([
  Object.freeze({
    releaseId: "classic-v2",
    modelId: "classic",
    sourceGroup: "core",
  }),
  Object.freeze({
    releaseId: "classic-v3",
    modelId: "classic",
    sourceGroup: "core",
  }),
  Object.freeze({
    releaseId: "stock-paired-v1",
    modelId: "stock-paired",
    sourceGroup: "core",
  }),
  Object.freeze({
    releaseId: "stock-paired-v2",
    modelId: "stock-paired",
    sourceGroup: "core",
  }),
  Object.freeze({
    releaseId: "stock-paired-v3",
    modelId: "stock-paired",
    sourceGroup: "core",
  }),
]);

export type MarketProjectorScope = (typeof RELEASE_SCOPES)[number];

export type MarketCursor = Readonly<{
  id: string;
  epochId: string;
  pointerGeneration: string;
  cursorGeneration: string;
  reorgGeneration: string;
  sourceCheckpointId: string;
  sourceCheckpointGeneration: string;
  sourceReorgGeneration: string;
  blockEvidenceId: string;
  blockNumber: string;
  blockHash: HexBytes32;
  providerCursor: string;
  hourCoverageEnd: Date | null;
  dayCoverageEnd: Date | null;
  advancedAt: Date;
}>;

export type MarketPoolKey = Readonly<
  Omit<VerifiedPoolKey, "poolId"> & { poolId: HexBytes32 }
>;

export type MarketPoolPlan = Readonly<{
  scope: MarketProjectorScope;
  epochId: string;
  pointerGeneration: string;
  sourceCheckpointId: string;
  sourceCheckpointGeneration: string;
  sourceReorgGeneration: string;
  sourceCheckpointBlockNumber: string;
  sourceCheckpointBlockHash: HexBytes32;
  sourceCheckpointBlockEvidenceId: string;
  token: HexAddress;
  poolKey: MarketPoolKey;
  totalSupply: string;
  launchBlockNumber: string;
  launchBlockTimestamp: Date;
  cursor: MarketCursor | null;
}>;

export type MarketCloseAnchor = Readonly<{
  occurrenceId: string;
  logicalEventId: string;
  blockEvidenceId: string;
  blockNumber: string;
  blockHash: HexBytes32;
  blockTimestamp: Date;
  transactionHash: HexBytes32;
  transactionIndex: string;
  blockGlobalLogIndex: string;
}>;

export type MarketFastLanePlan = Readonly<{
  plan: MarketPoolPlan;
  anchor: MarketCloseAnchor;
}>;

export type VerifiedChainlinkBlock = Readonly<{
  blockNumber: string;
  blockHash: HexBytes32;
  blockTimestamp: Date;
  rawResult: Hex;
  feedRoundId: string;
  answer: string;
  feedUpdatedAt: Date;
}>;

type PreparedMarketClose = Readonly<{
  anchor: MarketCloseAnchor;
  global: VerifiedChainlinkBlock;
  snapshot: PoolSnapshot;
  token0Price: string;
  token1Price: string;
  feesUsd: string;
}>;

type PreparedMarketCandle = Readonly<{
  interval: "hour" | "day";
  periodStart: Date;
  periodEnd: Date;
  data: CandleAnalytics;
}>;

export type PreparedMarketPage = Readonly<{
  plan: MarketPoolPlan;
  graphProviderId: string;
  targetEvidenceId: string;
  target: VerifiedChainlinkBlock;
  targetSnapshot: PoolSnapshot;
  targetToken0Price: string;
  targetToken1Price: string;
  closes: readonly PreparedMarketClose[];
  candles: readonly PreparedMarketCandle[];
  nextHourCoverageEnd: Date | null;
  nextDayCoverageEnd: Date | null;
  providerCursor: string;
  pageCommitment: HexBytes32;
  isReorg: boolean;
  fastLane?: boolean;
}>;

export type MarketProjectorStore = Readonly<{
  tryAcquireLease(): Promise<MarketProjectorLease | null>;
  releaseLease(lease: MarketProjectorLease): Promise<void>;
  loadPlans(): Promise<readonly MarketPoolPlan[]>;
  loadFastLanePlan(): Promise<MarketFastLanePlan | null>;
  listCloseAnchors(
    input: Readonly<{
      plan: MarketPoolPlan;
      fromBlockExclusive: string;
      toBlockInclusive: string;
      limit: number;
    }>,
  ): Promise<readonly MarketCloseAnchor[]>;
  resolveGraphProvider(
    input: Readonly<{
      redactedIdentity: string;
      deploymentCommitment: HexBytes32;
      schemaCommitment: HexBytes32;
    }>,
  ): Promise<string>;
  commit(page: PreparedMarketPage): Promise<MarketProjectorCycleResult>;
  close(): Promise<void>;
}>;

export type MarketProjectorLease = Readonly<{
  holderId: string;
  generation: string;
  tokenHash: HexBytes32;
  acquiredAt: Date;
  expiresAt: Date;
}>;

export type MarketRpc = Readonly<{
  readChainlinkBlock(
    input: Readonly<{
      blockNumber: string;
      expectedBlockHash: HexBytes32;
    }>,
  ): Promise<VerifiedChainlinkBlock>;
}>;

export type MarketAnalytics = ReturnType<typeof createUniswapAnalyticsClient>;

export type MarketProjectorCycleResult = Readonly<{
  status: "committed" | "caught-up" | "idle" | "disabled" | "busy";
  releaseId?: string;
  poolId?: HexBytes32;
  blockNumber?: string;
  lagBlocks: string;
  closeCount: number;
  candleCount: number;
  caughtUp: boolean;
}>;

export type MarketRpcProviderEvidence = Readonly<{
  identity: string;
  endpointCommitment: HexBytes32;
  endpointOriginCommitment: HexBytes32;
}>;

function exactText(value: unknown, pattern: RegExp, operation: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    !pattern.test(value)
  ) {
    throw validationError("postgres", operation);
  }
  return value;
}

function uuid(value: unknown, operation = "uuid"): string {
  return exactText(value, UUID_PATTERN, operation);
}

function integer(value: unknown, operation = "integer"): string {
  try {
    if (typeof value === "bigint")
      return parseNonnegativeIntegerText(value.toString());
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value)) throw new Error("unsafe");
      return parseNonnegativeIntegerText(String(value));
    }
    return parseNonnegativeIntegerText(value);
  } catch {
    throw validationError("postgres", operation);
  }
}

function byteaAddress(value: unknown): HexAddress {
  if (!(value instanceof Uint8Array) || value.byteLength !== 20) {
    throw validationError("postgres", "address");
  }
  return `0x${Buffer.from(value).toString("hex")}` as HexAddress;
}

function byteaBytes32(value: unknown): HexBytes32 {
  try {
    return bytes32FromBytea(value);
  } catch {
    throw validationError("postgres", "bytes32");
  }
}

function date(value: unknown, operation = "timestamp"): Date {
  const parsed =
    value instanceof Date ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(parsed.getTime()))
    throw validationError("postgres", operation);
  return parsed;
}

function nullableDate(value: unknown): Date | null {
  return value === null ? null : date(value);
}

function canonicalJson(value: unknown): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime()))
      throw invalidInput("config", "canonical-date");
    return JSON.stringify(value.toISOString());
  }
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw invalidInput("config", "canonical-number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  throw invalidInput("config", "canonical-value");
}

function commitment(domain: string, value: unknown): HexBytes32 {
  return keccak256(
    toBytes(
      `programmable:market-projector:${domain}:v1\0${canonicalJson(value)}`,
    ),
  );
}

function deterministicUuid(
  domain: string,
  ...values: readonly string[]
): string {
  const digits = commitment(domain, values).slice(2, 34).split("");
  digits[12] = "8";
  digits[16] = ((Number.parseInt(digits[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = digits.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function exactDecimalRatio(
  numeratorText: string,
  denominatorText: string,
): string {
  const numerator = BigInt(integer(numeratorText, "ratio-numerator"));
  const denominator = BigInt(integer(denominatorText, "ratio-denominator"));
  if (denominator === 0n) throw validationError("uniswap", "zero-ratio");
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return whole.toString();
  const scaled = (remainder * 10n ** BigInt(DECIMAL_SCALE)) / denominator;
  const fraction = scaled
    .toString()
    .padStart(DECIMAL_SCALE, "0")
    .replace(/0+$/u, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

function prices(snapshot: PoolSnapshot, poolKey: VerifiedPoolKey) {
  const ratios = priceRatiosFromSqrtPriceX96({
    sqrtPriceX96: snapshot.sqrtPriceX96,
    token0Decimals: poolKey.token0Decimals,
    token1Decimals: poolKey.token1Decimals,
  });
  return Object.freeze({
    token0Price: exactDecimalRatio(
      ratios.token1PerToken0.numerator,
      ratios.token1PerToken0.denominator,
    ),
    token1Price: exactDecimalRatio(
      ratios.token0PerToken1.numerator,
      ratios.token0PerToken1.denominator,
    ),
  });
}

function finiteDuration(startedAt: number): number {
  return Math.max(0, Math.min(86_400_000, Date.now() - startedAt));
}

function exactResult<T>(
  value: AnalyticsResult<T>,
  expectedBlock: Readonly<{ number: string; hash: HexBytes32 }>,
): T {
  if (value.status !== "ready") {
    throw dataPipelineError({
      dependency: "uniswap",
      code: "dependency_unavailable",
      retryable: true,
      countsTowardCircuit: true,
    });
  }
  if (
    value.provenance.deployment !== OFFICIAL_V4_SUBGRAPH_DEPLOYMENT ||
    value.provenance.blockNumber !== expectedBlock.number ||
    value.provenance.blockHash !== expectedBlock.hash
  ) {
    throw validationError("uniswap", "market-query-provenance");
  }
  return value.data;
}

function floorDate(value: Date, seconds: number): Date {
  const unix = Math.floor(value.getTime() / 1_000);
  return new Date(Math.floor(unix / seconds) * seconds * 1_000);
}

function plusSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1_000);
}

function dateSeconds(value: Date): number {
  const seconds = value.getTime() / 1_000;
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    seconds > 2_147_483_647
  ) {
    throw invalidInput("config", "timestamp-range");
  }
  return seconds;
}

function parseCursor(row: Record<string, unknown>): MarketCursor {
  return Object.freeze({
    id: uuid(row.market_cursor_id),
    epochId: uuid(row.epoch_id),
    pointerGeneration: integer(row.pointer_generation),
    cursorGeneration: integer(row.cursor_generation),
    reorgGeneration: integer(row.reorg_generation),
    sourceCheckpointId: uuid(row.source_checkpoint_id),
    sourceCheckpointGeneration: integer(row.source_checkpoint_generation),
    sourceReorgGeneration: integer(row.source_reorg_generation),
    blockEvidenceId: uuid(row.block_evidence_id),
    blockNumber: integer(row.block_number),
    blockHash: byteaBytes32(row.block_hash),
    providerCursor: exactText(
      row.provider_cursor,
      /^[A-Za-z0-9][A-Za-z0-9._:/#-]{0,255}$/u,
      "provider-cursor",
    ),
    hourCoverageEnd: nullableDate(row.hour_coverage_end),
    dayCoverageEnd: nullableDate(row.day_coverage_end),
    advancedAt: date(row.advanced_at),
  });
}

function parsePoolCursor(row: Record<string, unknown>): MarketCursor | null {
  if (row.market_cursor_id === null || row.market_cursor_id === undefined) {
    return null;
  }
  return parseCursor({
    market_cursor_id: row.market_cursor_id,
    epoch_id: row.cursor_epoch_id,
    pointer_generation: row.cursor_pointer_generation,
    cursor_generation: row.cursor_generation,
    reorg_generation: row.cursor_reorg_generation,
    source_checkpoint_id: row.cursor_source_checkpoint_id,
    source_checkpoint_generation: row.cursor_source_checkpoint_generation,
    source_reorg_generation: row.cursor_source_reorg_generation,
    block_evidence_id: row.cursor_block_evidence_id,
    block_number: row.cursor_block_number,
    block_hash: row.cursor_block_hash,
    provider_cursor: row.provider_cursor,
    hour_coverage_end: row.hour_coverage_end,
    day_coverage_end: row.day_coverage_end,
    page_commitment: row.page_commitment,
    advanced_at: row.advanced_at,
  });
}

function parsePoolPlan(
  row: Record<string, unknown>,
  scope?: MarketProjectorScope,
): MarketPoolPlan {
  const resolvedScope =
    scope ??
    RELEASE_SCOPES.find(
      (candidate) =>
        candidate.releaseId === row.release_id &&
        candidate.modelId === row.model_id &&
        candidate.sourceGroup === row.source_group,
    );
  if (!resolvedScope) throw validationError("postgres", "market-scope");
  const poolId = byteaBytes32(row.pool_id);
  return Object.freeze({
    scope: resolvedScope,
    epochId: uuid(row.epoch_id),
    pointerGeneration: integer(row.pointer_generation),
    sourceCheckpointId: uuid(row.source_checkpoint_id),
    sourceCheckpointGeneration: integer(row.source_checkpoint_generation),
    sourceReorgGeneration: integer(row.source_reorg_generation),
    sourceCheckpointBlockNumber: integer(row.source_checkpoint_block_number),
    sourceCheckpointBlockHash: byteaBytes32(row.source_checkpoint_block_hash),
    sourceCheckpointBlockEvidenceId: uuid(
      row.source_checkpoint_block_evidence_id,
    ),
    token: byteaAddress(row.token),
    poolKey: Object.freeze({
      poolId,
      currency0: byteaAddress(row.currency0),
      currency1: byteaAddress(row.currency1),
      hooks: byteaAddress(row.hook),
      fee: Number(integer(row.pool_key_fee)),
      tickSpacing: Number(integer(row.tick_spacing)),
      token0Decimals: Number(integer(row.token0_decimals)),
      token1Decimals: Number(integer(row.token1_decimals)),
    }),
    totalSupply: integer(row.total_supply),
    launchBlockNumber: integer(row.launch_block_number),
    launchBlockTimestamp: date(row.launch_block_timestamp),
    cursor: parsePoolCursor(row),
  });
}

function parseFastLanePlan(row: Record<string, unknown>): MarketFastLanePlan {
  return Object.freeze({
    plan: parsePoolPlan(row),
    anchor: Object.freeze({
      occurrenceId: uuid(row.anchor_occurrence_id),
      logicalEventId: uuid(row.anchor_logical_event_id),
      blockEvidenceId: uuid(row.anchor_block_evidence_id),
      blockNumber: integer(row.anchor_block_number),
      blockHash: byteaBytes32(row.anchor_block_hash),
      blockTimestamp: date(row.anchor_block_timestamp),
      transactionHash: byteaBytes32(row.anchor_transaction_hash),
      transactionIndex: integer(row.anchor_transaction_index),
      blockGlobalLogIndex: integer(row.anchor_block_global_log_index),
    }),
  });
}

function marketGatewayIdentityFailure(): DataPipelineError {
  return invalidInput("postgres", "market-gateway-membership");
}

async function assertMarketGatewayLogin(
  transaction: PostgresTransaction,
): Promise<void> {
  const rows = await transaction.query<{ session_user: unknown }>(
    "select session_user::text as session_user",
  );
  if (
    rows.length !== 1 ||
    rows[0]?.session_user !== MARKET_PROJECTOR_LOGIN_ROLE
  ) {
    throw marketGatewayIdentityFailure();
  }
}

async function assumeAndVerifyMarketCapabilityRole(
  transaction: PostgresTransaction,
): Promise<void> {
  try {
    await transaction.query("set local role programmable_reconciler");
  } catch {
    throw marketGatewayIdentityFailure();
  }
  await transaction.query("set local statement_timeout = '900ms'");
  await transaction.query("set local lock_timeout = '200ms'");
  await transaction.query(
    "set local idle_in_transaction_session_timeout = '2000ms'",
  );
  const rows = await transaction.query<{
    session_user: unknown;
    current_role: unknown;
  }>(
    "select session_user::text as session_user, current_role::text as current_role",
  );
  if (
    rows.length !== 1 ||
    rows[0]?.session_user !== MARKET_PROJECTOR_LOGIN_ROLE ||
    rows[0]?.current_role !== MARKET_PROJECTOR_CAPABILITY_ROLE
  ) {
    throw marketGatewayIdentityFailure();
  }
}

export function createMarketProjectorDatabaseGateway(input: {
  executor: PostgresExecutor;
}) {
  return Object.freeze({
    async transaction<T>(
      work: (transaction: PostgresTransaction) => Promise<T>,
    ): Promise<T> {
      return input.executor.transaction(async (transaction) => {
        await assertMarketGatewayLogin(transaction);
        await assumeAndVerifyMarketCapabilityRole(transaction);
        return work(transaction);
      });
    },
  });
}

export function createPostgresMarketProjectorStore(
  input: Readonly<{
    executor: PostgresExecutor;
    sourceProjectorVersion: string;
    rpcProviders: readonly [
      MarketRpcProviderEvidence,
      MarketRpcProviderEvidence,
    ];
    marketProjectorVersion?: string;
    uuid?: () => string;
    now?: () => Date;
  }>,
): MarketProjectorStore {
  const marketProjectorVersion =
    input.marketProjectorVersion ?? MARKET_PROJECTOR_VERSION;
  const nextUuid = input.uuid ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const gateway = createMarketProjectorDatabaseGateway({
    executor: input.executor,
  });
  let activeLease: MarketProjectorLease | null = null;

  return Object.freeze({
    async tryAcquireLease() {
      if (activeLease) throw invalidInput("postgres", "market-lease-active");
      const requestedAt = now();
      if (!Number.isFinite(requestedAt.valueOf())) {
        throw invalidInput("postgres", "market-lease-time");
      }
      const holderId = `market-projector:${nextUuid()}`;
      const tokenHash = keccak256(
        toBytes(`programmable:market-projector:lease-token:v1:${nextUuid()}`),
      );
      const requestedExpiry = new Date(requestedAt.valueOf() + 90_000);
      const inputCommitment = commitment("runtime-lease-acquire", {
        holderId,
        tokenHash,
        requestedAt: requestedAt.toISOString(),
        requestedExpiry: requestedExpiry.toISOString(),
      });
      const rows = await gateway.transaction(async (transaction) => {
        return transaction.query(
          "select * from programmable_private.try_acquire_market_projector_runtime_lease_v1($1,$2::bytea,$3::timestamptz,$4::timestamptz,$5::bytea)",
          [
            holderId,
            hexToBytes(tokenHash),
            requestedAt.toISOString(),
            requestedExpiry.toISOString(),
            hexToBytes(inputCommitment),
          ],
        );
      });
      if (rows.length !== 1 || typeof rows[0]?.acquired !== "boolean") {
        throw validationError("postgres", "market-lease-cardinality");
      }
      if (rows[0]!.acquired === false) return null;
      activeLease = Object.freeze({
        holderId,
        generation: integer(rows[0]!.lease_generation),
        tokenHash,
        acquiredAt: date(rows[0]!.acquired_at),
        expiresAt: date(rows[0]!.expires_at),
      });
      return activeLease;
    },

    async releaseLease(lease) {
      if (
        !activeLease ||
        lease.holderId !== activeLease.holderId ||
        lease.generation !== activeLease.generation ||
        lease.tokenHash !== activeLease.tokenHash
      ) {
        throw invalidInput("postgres", "market-lease-release");
      }
      const releasedAt = now();
      if (!Number.isFinite(releasedAt.valueOf())) {
        throw invalidInput("postgres", "market-lease-time");
      }
      const inputCommitment = commitment("runtime-lease-release", {
        holderId: lease.holderId,
        generation: lease.generation,
        tokenHash: lease.tokenHash,
        releasedAt: releasedAt.toISOString(),
      });
      const rows = await gateway.transaction(async (transaction) => {
        return transaction.query<{ released: unknown }>(
          "select programmable_private.release_market_projector_runtime_lease_v1($1,$2::bigint,$3::bytea,$4::timestamptz,$5::bytea) as released",
          [
            lease.holderId,
            lease.generation,
            hexToBytes(lease.tokenHash),
            releasedAt.toISOString(),
            hexToBytes(inputCommitment),
          ],
        );
      });
      if (rows.length !== 1 || rows[0]?.released !== true) {
        throw validationError("postgres", "market-lease-release");
      }
      activeLease = null;
    },

    async loadPlans() {
      return gateway.transaction(async (transaction) => {
        const plans: MarketPoolPlan[] = [];
        for (const scope of RELEASE_SCOPES) {
          const rows = await transaction.query(
            "select * from programmable_private.list_market_projector_pools_v1($1::bigint,$2,$3,$4,$5,$6,$7::integer)",
            [
              CHAIN_ID,
              scope.releaseId,
              scope.modelId,
              scope.sourceGroup,
              input.sourceProjectorVersion,
              marketProjectorVersion,
              MAXIMUM_PENDING_POOLS_PER_SCOPE,
            ],
          );
          for (const row of rows) {
            plans.push(parsePoolPlan(row, scope));
          }
        }
        return Object.freeze(plans);
      });
    },

    async loadFastLanePlan() {
      return gateway.transaction(async (transaction) => {
        const rows = await transaction.query(
          "select * from programmable_private.list_market_projector_fast_lane_v1($1::bigint,$2,$3,$4::integer)",
          [CHAIN_ID, input.sourceProjectorVersion, marketProjectorVersion, 1],
        );
        if (rows.length > 1) {
          throw validationError("postgres", "market-fast-lane-cardinality");
        }
        return rows[0] ? parseFastLanePlan(rows[0]) : null;
      });
    },

    async listCloseAnchors({
      plan,
      fromBlockExclusive,
      toBlockInclusive,
      limit,
    }) {
      return gateway.transaction(async (transaction) => {
        const rows = await transaction.query(
          "select * from programmable_private.list_market_close_anchors_v1($1::bigint,$2,$3,$4,$5,$6::bytea,$7::numeric,$8::numeric,$9::integer,$10::numeric)",
          [
            CHAIN_ID,
            plan.scope.releaseId,
            plan.scope.modelId,
            plan.scope.sourceGroup,
            input.sourceProjectorVersion,
            hexToBytes(plan.poolKey.poolId),
            fromBlockExclusive,
            toBlockInclusive,
            limit,
            null,
          ],
        );
        return Object.freeze(
          rows.map((row) =>
            Object.freeze({
              occurrenceId: uuid(row.occurrence_id),
              logicalEventId: uuid(row.logical_event_id),
              blockEvidenceId: uuid(row.block_evidence_id),
              blockNumber: integer(row.block_number),
              blockHash: byteaBytes32(row.block_hash),
              blockTimestamp: date(row.block_timestamp),
              transactionHash: byteaBytes32(row.transaction_hash),
              transactionIndex: integer(row.transaction_index),
              blockGlobalLogIndex: integer(row.block_global_log_index),
            }),
          ),
        );
      });
    },

    async resolveGraphProvider(provider) {
      return gateway.transaction(async (transaction) => {
        const rows = await transaction.query<{ id: unknown }>(
          "select programmable_private.resolve_market_graph_provider_v1($1,$2::bytea,$3::bytea) as id",
          [
            provider.redactedIdentity,
            hexToBytes(provider.deploymentCommitment),
            hexToBytes(provider.schemaCommitment),
          ],
        );
        if (rows.length !== 1)
          throw validationError("postgres", "graph-provider-cardinality");
        return uuid(rows[0]!.id, "graph-provider-id");
      });
    },

    async commit(page) {
      const startedAt = Date.now();
      return gateway.transaction(async (transaction) => {
        if (!page.fastLane && !activeLease) {
          throw validationError("postgres", "market-lease-missing");
        }
        if (!page.fastLane) {
          const leaseRows = await transaction.query<{ valid: unknown }>(
            "select programmable_private.assert_market_projector_runtime_lease_v1($1,$2::bigint,$3::bytea) as valid",
            [
              activeLease!.holderId,
              activeLease!.generation,
              hexToBytes(activeLease!.tokenHash),
            ],
          );
          if (leaseRows.length !== 1 || leaseRows[0]?.valid !== true) {
            throw validationError("postgres", "market-lease-expired");
          }
        }
        const plan = page.plan;
        const poolLockRows = await transaction.query<{ locked: unknown }>(
          "select programmable_private.try_lock_market_projector_pool_v1($1::bigint,$2,$3,$4,$5::bytea) as locked",
          [
            CHAIN_ID,
            plan.scope.releaseId,
            plan.scope.modelId,
            plan.scope.sourceGroup,
            hexToBytes(plan.poolKey.poolId),
          ],
        );
        if (poolLockRows.length !== 1 || poolLockRows[0]?.locked !== true) {
          throw validationError("postgres", "market-pool-busy");
        }
        if (page.fastLane) {
          const cursor = plan.cursor;
          const anchor = page.closes[0]?.anchor;
          if (!cursor || page.closes.length !== 1 || !anchor) {
            throw validationError("postgres", "market-fast-lane-page");
          }
          const assertionRows = await transaction.query<{ valid: unknown }>(
            "select programmable_private.assert_market_projector_fast_lane_v1($1::bigint,$2,$3,$4,$5,$6,$7::bytea,$8::uuid,$9::bigint,$10::uuid,$11::bigint,$12::bigint,$13::numeric,$14::bytea,$15::uuid,$16::uuid,$17::bigint,$18::bigint,$19::uuid,$20::uuid,$21::numeric,$22::bytea) as valid",
            [
              CHAIN_ID,
              plan.scope.releaseId,
              plan.scope.modelId,
              plan.scope.sourceGroup,
              input.sourceProjectorVersion,
              marketProjectorVersion,
              hexToBytes(plan.poolKey.poolId),
              plan.epochId,
              plan.pointerGeneration,
              plan.sourceCheckpointId,
              plan.sourceCheckpointGeneration,
              plan.sourceReorgGeneration,
              plan.sourceCheckpointBlockNumber,
              hexToBytes(plan.sourceCheckpointBlockHash),
              plan.sourceCheckpointBlockEvidenceId,
              cursor.id,
              cursor.cursorGeneration,
              cursor.reorgGeneration,
              anchor.occurrenceId,
              anchor.blockEvidenceId,
              anchor.blockNumber,
              hexToBytes(anchor.blockHash),
            ],
          );
          if (assertionRows.length !== 1 || assertionRows[0]?.valid !== true) {
            throw validationError("postgres", "market-fast-lane-stale");
          }
        }
        const pageHex = page.pageCommitment;
        const runId = deterministicUuid("run", plan.epochId, pageHex);
        const reconciliationId = deterministicUuid("reconciliation", runId);
        const outcomeId = deterministicUuid("outcome", runId);
        const telemetryId = deterministicUuid("telemetry", runId);
        const cursorId = deterministicUuid(
          "cursor",
          plan.epochId,
          plan.poolKey.poolId,
          pageHex,
        );
        const currentCursorGeneration = plan.cursor?.cursorGeneration ?? "0";
        const currentReorgGeneration = plan.cursor?.reorgGeneration ?? "0";
        const nextCursorGeneration = (
          BigInt(currentCursorGeneration) + 1n
        ).toString();
        const nextReorgGeneration = page.isReorg
          ? (BigInt(currentReorgGeneration) + 1n).toString()
          : currentReorgGeneration;
        const sourceFromBlock = page.isReorg
          ? plan.launchBlockNumber
          : (plan.cursor?.blockNumber ?? plan.launchBlockNumber);
        const comparedCount = 1 + page.closes.length + page.candles.length;
        const now = new Date();

        await transaction.query(
          "select programmable_private.open_run($1::uuid,'reconciliation',$2::bigint,$3,$4,$5,$6::uuid,$7::bigint,$8,$9::bytea,$10::timestamptz)",
          [
            runId,
            CHAIN_ID,
            plan.scope.releaseId,
            plan.scope.modelId,
            plan.scope.sourceGroup,
            plan.epochId,
            plan.pointerGeneration,
            marketProjectorVersion,
            hexToBytes(pageHex),
            now,
          ],
        );
        await transaction.query(
          "select programmable_private.append_reconciliation_record($1::uuid,$2::uuid,$3,$4,$5::numeric,$6::numeric,$7::bigint,0,$8::bytea,array[]::bytea[],null,$9::timestamptz)",
          [
            reconciliationId,
            runId,
            "market-source-match",
            "info",
            sourceFromBlock,
            page.target.blockNumber,
            comparedCount,
            hexToBytes(
              commitment("reconciliation", {
                page: pageHex,
                graphProviderId: page.graphProviderId,
                block: page.target.blockNumber,
              }),
            ),
            now,
          ],
        );

        const globalIds = new Map<string, string>();
        const ensureGlobal = async (
          evidenceId: string,
          block: VerifiedChainlinkBlock,
        ) => {
          const cached = globalIds.get(evidenceId);
          if (cached) return cached;
          const existingRows = await transaction.query<{ id: unknown }>(
            "select programmable_private.get_market_global_snapshot_v1($1::uuid,$2::uuid) as id",
            [reconciliationId, evidenceId],
          );
          const existing = existingRows[0]?.id;
          if (existing !== null && existing !== undefined) {
            const existingId = uuid(existing, "global-market-id");
            globalIds.set(evidenceId, existingId);
            return existingId;
          }
          const contextRows = await transaction.query<Record<string, unknown>>(
            "select * from programmable_private.get_market_block_evidence_context_v1($1::uuid,$2::uuid)",
            [reconciliationId, evidenceId],
          );
          if (contextRows.length !== 1)
            throw validationError("postgres", "evidence-context-cardinality");
          const providerA = uuid(contextRows[0]!.provider_a_id);
          const providerB = uuid(contextRows[0]!.provider_b_id);
          if (
            integer(contextRows[0]!.block_number) !== block.blockNumber ||
            byteaBytes32(contextRows[0]!.block_hash) !== block.blockHash ||
            exactText(
              contextRows[0]!.provider_a_identity,
              IDENTIFIER_PATTERN,
              "rpc-provider-identity",
            ) !== input.rpcProviders[0].identity ||
            exactText(
              contextRows[0]!.provider_b_identity,
              IDENTIFIER_PATTERN,
              "rpc-provider-identity",
            ) !== input.rpcProviders[1].identity ||
            byteaBytes32(contextRows[0]!.provider_a_endpoint_commitment) !==
              input.rpcProviders[0].endpointCommitment ||
            byteaBytes32(contextRows[0]!.provider_b_endpoint_commitment) !==
              input.rpcProviders[1].endpointCommitment ||
            byteaBytes32(contextRows[0]!.provider_a_origin_commitment) !==
              input.rpcProviders[0].endpointOriginCommitment ||
            byteaBytes32(contextRows[0]!.provider_b_origin_commitment) !==
              input.rpcProviders[1].endpointOriginCommitment
          )
            throw validationError("postgres", "evidence-context-mismatch");
          const id = deterministicUuid(
            "global",
            plan.epochId,
            plan.pointerGeneration,
            block.blockHash,
          );
          const sourceCommitment = commitment("chainlink-query", {
            feed: CHAINLINK_ETH_USD,
            selector: LATEST_ROUND_DATA_SELECTOR,
            blockNumber: block.blockNumber,
            blockHash: block.blockHash,
          });
          const resultCommitment = commitment("chainlink-result", {
            sourceCommitment,
            rawResult: block.rawResult,
          });
          await transaction.query(
            "select programmable_private.append_global_eth_usd_snapshot_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::numeric,$7::numeric,8,$8::timestamptz,$9::bytea,$10::bytea,$11::bytea,$12::bytea,$13::timestamptz)",
            [
              id,
              reconciliationId,
              evidenceId,
              providerA,
              providerB,
              block.feedRoundId,
              block.answer,
              block.feedUpdatedAt,
              hexToBytes(block.rawResult),
              hexToBytes(block.rawResult),
              hexToBytes(sourceCommitment),
              hexToBytes(resultCommitment),
              block.blockTimestamp,
            ],
          );
          globalIds.set(evidenceId, id);
          return id;
        };

        for (const close of page.closes) {
          const globalId = await ensureGlobal(
            close.anchor.blockEvidenceId,
            close.global,
          );
          const closeId = deterministicUuid(
            "close",
            plan.epochId,
            plan.pointerGeneration,
            plan.poolKey.poolId,
            close.anchor.blockHash,
            close.anchor.occurrenceId,
          );
          const sourceQueryCommitment = commitment("close-query", {
            deployment: page.graphProviderId,
            poolId: plan.poolKey.poolId,
            blockNumber: close.anchor.blockNumber,
            blockHash: close.anchor.blockHash,
          });
          const closeCommitment = commitment("close", {
            sourceQueryCommitment,
            occurrenceId: close.anchor.occurrenceId,
            snapshot: close.snapshot,
            token0Price: close.token0Price,
            token1Price: close.token1Price,
            feesUsd: close.feesUsd,
          });
          await transaction.query(
            "select programmable_private.append_market_block_close_v2($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bytea,$6::uuid,$7::numeric,$8::numeric,$9::integer,$10::numeric,$11::numeric,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::numeric,$17::bigint,$18::uuid,$19::bytea,$20::bytea,$21::timestamptz)",
            [
              closeId,
              reconciliationId,
              page.graphProviderId,
              close.anchor.blockEvidenceId,
              hexToBytes(plan.poolKey.poolId),
              close.anchor.occurrenceId,
              close.snapshot.sqrtPriceX96,
              close.snapshot.liquidity,
              close.snapshot.tick,
              close.token0Price,
              close.token1Price,
              close.snapshot.marketVolumeToken0,
              close.snapshot.marketVolumeToken1,
              close.snapshot.marketVolumeUsd,
              close.feesUsd,
              close.snapshot.totalValueLockedUsd,
              close.snapshot.transactionCount,
              globalId,
              hexToBytes(sourceQueryCommitment),
              hexToBytes(closeCommitment),
              close.global.blockTimestamp,
            ],
          );
        }

        const targetGlobalId = await ensureGlobal(
          page.targetEvidenceId,
          page.target,
        );
        const marketSnapshotId = deterministicUuid(
          "snapshot",
          plan.epochId,
          plan.pointerGeneration,
          plan.poolKey.poolId,
          page.target.blockHash,
        );
        const snapshotInput = commitment("snapshot", {
          deployment: page.graphProviderId,
          poolId: plan.poolKey.poolId,
          blockNumber: page.target.blockNumber,
          blockHash: page.target.blockHash,
          snapshot: page.targetSnapshot,
        });
        await transaction.query(
          "select programmable_private.append_market_snapshot_v2($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bytea,$6::numeric,$7::bytea,$8::numeric,$9::numeric,$10::numeric,$11::numeric,$12::numeric,null,$13::timestamptz,$14::bytea)",
          [
            marketSnapshotId,
            reconciliationId,
            page.graphProviderId,
            page.targetEvidenceId,
            hexToBytes(plan.poolKey.poolId),
            page.target.blockNumber,
            hexToBytes(page.target.blockHash),
            page.targetSnapshot.sqrtPriceX96,
            page.targetSnapshot.liquidity,
            page.targetSnapshot.marketVolumeToken0,
            page.targetSnapshot.marketVolumeToken1,
            page.targetSnapshot.marketVolumeUsd,
            page.target.blockTimestamp,
            hexToBytes(snapshotInput),
          ],
        );
        const snapshotDetail = commitment("snapshot-detail", {
          snapshotId: marketSnapshotId,
          globalId: targetGlobalId,
          tick: page.targetSnapshot.tick,
          token0Price: page.targetToken0Price,
          token1Price: page.targetToken1Price,
          tvlToken0: page.targetSnapshot.totalValueLockedToken0,
          tvlToken1: page.targetSnapshot.totalValueLockedToken1,
          tvlUsd: page.targetSnapshot.totalValueLockedUsd,
          transactionCount: page.targetSnapshot.transactionCount,
        });
        await transaction.query(
          "select programmable_private.append_market_snapshot_details_v2($1::uuid,$2::uuid,$3,$4::bigint,$5::uuid,$6::integer,$7::numeric,$8::numeric,$9::numeric,$10::numeric,$11::numeric,$12::bigint,$13::bytea,$14::timestamptz)",
          [
            marketSnapshotId,
            reconciliationId,
            marketProjectorVersion,
            nextReorgGeneration,
            targetGlobalId,
            page.targetSnapshot.tick,
            page.targetToken0Price,
            page.targetToken1Price,
            page.targetSnapshot.totalValueLockedToken0,
            page.targetSnapshot.totalValueLockedToken1,
            page.targetSnapshot.totalValueLockedUsd,
            page.targetSnapshot.transactionCount,
            hexToBytes(snapshotDetail),
            page.target.blockTimestamp,
          ],
        );

        for (const candle of page.candles) {
          const candleId = deterministicUuid(
            "candle",
            plan.epochId,
            plan.pointerGeneration,
            plan.poolKey.poolId,
            candle.interval,
            candle.periodStart.toISOString(),
            page.target.blockHash,
          );
          const candleCommitment = commitment("candle", {
            deployment: page.graphProviderId,
            interval: candle.interval,
            periodStart: candle.periodStart.toISOString(),
            periodEnd: candle.periodEnd.toISOString(),
            data: candle.data,
            sourceBlockHash: page.target.blockHash,
          });
          await transaction.query(
            "select programmable_private.append_market_candle_v2($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::bytea,$6,$7::timestamptz,$8::timestamptz,$9::numeric,$10::numeric,$11::numeric,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::bytea,$17::bytea)",
            [
              candleId,
              reconciliationId,
              page.graphProviderId,
              page.targetEvidenceId,
              hexToBytes(plan.poolKey.poolId),
              candle.interval,
              candle.periodStart,
              candle.periodEnd,
              candle.data.open,
              candle.data.high,
              candle.data.low,
              candle.data.close,
              candle.data.marketVolumeToken0,
              candle.data.marketVolumeToken1,
              candle.data.marketVolumeUsd,
              hexToBytes(page.target.blockHash),
              hexToBytes(candleCommitment),
            ],
          );
          const closingRows = await transaction.query<{ id: unknown }>(
            "select programmable_private.resolve_market_candle_close_v1($1::uuid,$2::bytea,$3::timestamptz,$4::timestamptz) as id",
            [
              reconciliationId,
              hexToBytes(plan.poolKey.poolId),
              candle.periodStart,
              candle.periodEnd,
            ],
          );
          if (closingRows.length !== 1)
            throw validationError("postgres", "candle-close-cardinality");
          const closingId = uuid(closingRows[0]!.id, "candle-close-id");
          const detail = commitment("candle-detail", {
            candleId,
            closingId,
            sourceBlockHash: page.target.blockHash,
            feesUsd: candle.data.feesUsd,
            transactionCount: candle.data.transactionCount,
          });
          await transaction.query(
            "select programmable_private.append_market_candle_details_v2($1::uuid,$2::uuid,$3,$4::bigint,$5::uuid,$6::numeric,$7::bigint,$8::bytea,$9::timestamptz)",
            [
              candleId,
              reconciliationId,
              marketProjectorVersion,
              nextReorgGeneration,
              closingId,
              candle.data.feesUsd,
              candle.data.transactionCount,
              hexToBytes(detail),
              page.target.blockTimestamp,
            ],
          );
        }

        if (!page.fastLane) {
          await transaction.query(
            "select programmable_private.advance_market_projector_cursor_v1($1::uuid,$2::uuid,$3,$4,$5::bytea,$6::bigint,$7::bigint,$8::bigint,$9::bigint,$10::uuid,$11::bigint,$12::bigint,$13::uuid,$14::numeric,$15::bytea,$16,$17::timestamptz,$18::timestamptz,$19::bytea,$20::timestamptz)",
            [
              cursorId,
              reconciliationId,
              input.sourceProjectorVersion,
              marketProjectorVersion,
              hexToBytes(plan.poolKey.poolId),
              currentCursorGeneration,
              nextCursorGeneration,
              currentReorgGeneration,
              nextReorgGeneration,
              plan.sourceCheckpointId,
              plan.sourceCheckpointGeneration,
              plan.sourceReorgGeneration,
              page.targetEvidenceId,
              page.target.blockNumber,
              hexToBytes(page.target.blockHash),
              page.providerCursor,
              page.nextHourCoverageEnd,
              page.nextDayCoverageEnd,
              hexToBytes(pageHex),
              now,
            ],
          );
        }

        const lagBlocks = (
          BigInt(plan.sourceCheckpointBlockNumber) -
          BigInt(page.target.blockNumber)
        ).toString();
        const caughtUp = lagBlocks === "0";
        const telemetry = Object.freeze({
          closeCount: page.closes.length,
          candleCount: page.candles.length,
          lagBlocks,
          caughtUp,
          fastLane: page.fastLane === true,
          hourCovered: page.nextHourCoverageEnd?.toISOString() ?? null,
          dayCovered: page.nextDayCoverageEnd?.toISOString() ?? null,
        });
        await transaction.query(
          "select programmable_private.append_run_telemetry($1::uuid,$2::uuid,$3,$4::timestamptz,$5::bigint,$6::bigint,$7::jsonb,$8::boolean)",
          [
            telemetryId,
            runId,
            "market-page",
            now,
            finiteDuration(startedAt),
            comparedCount,
            JSON.stringify(telemetry),
            page.isReorg,
          ],
        );
        const resultCommitment = commitment("result", {
          page: pageHex,
          telemetry,
        });
        await transaction.query(
          "select programmable_private.append_run_outcome($1::uuid,$2::uuid,'succeeded',$3::bytea,$4::timestamptz)",
          [outcomeId, runId, hexToBytes(resultCommitment), now],
        );
        return Object.freeze({
          status: caughtUp ? ("caught-up" as const) : ("committed" as const),
          releaseId: plan.scope.releaseId,
          poolId: plan.poolKey.poolId,
          blockNumber: page.target.blockNumber,
          lagBlocks,
          closeCount: page.closes.length,
          candleCount: page.candles.length,
          caughtUp,
        });
      });
    },

    close: () => input.executor.close(),
  });
}

function parseHexQuantity(value: unknown, operation: string): bigint {
  if (
    typeof value !== "string" ||
    !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(value)
  ) {
    throw validationError("rpc", operation);
  }
  return BigInt(value);
}

function parseRpcEnvelope(value: unknown, operation: string): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).jsonrpc !== "2.0" ||
    (value as Record<string, unknown>).id !== 1 ||
    !("result" in value) ||
    "error" in value
  )
    throw validationError("rpc", operation);
  return (value as Record<string, unknown>).result;
}

function decodeChainlinkResult(value: unknown) {
  if (typeof value !== "string" || !/^0x[0-9a-f]{320}$/u.test(value)) {
    throw validationError("rpc", "chainlink-result");
  }
  const words = Array.from({ length: 5 }, (_, index) =>
    BigInt(`0x${value.slice(2 + index * 64, 2 + (index + 1) * 64)}`),
  );
  const signedAnswer =
    words[1]! >= 2n ** 255n ? words[1]! - 2n ** 256n : words[1]!;
  if (
    words[0]! <= 0n ||
    words[0]! >= 2n ** 80n ||
    signedAnswer <= 0n ||
    words[2]! <= 0n ||
    words[3]! < words[2]! ||
    words[4]! < words[0]! ||
    words[4]! >= 2n ** 80n ||
    words[2]! > 253_402_300_799n ||
    words[3]! > 253_402_300_799n
  )
    throw validationError("rpc", "chainlink-round");
  return Object.freeze({
    rawResult: value as Hex,
    feedRoundId: words[0]!.toString(),
    answer: signedAnswer.toString(),
    feedUpdatedAt: new Date(Number(words[3]!) * 1_000),
  });
}

function exactRpcUrl(
  value: unknown,
  provider: "drpc" | "quicknode",
): string {
  if (typeof value !== "string") throw invalidInput("config", "rpc-url");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidInput("config", "rpc-url");
  }
  const drpc =
    parsed.hostname === "lb.drpc.live" &&
    /^\/ethereum\/[A-Za-z0-9_-]{8,512}\/?$/u.test(parsed.pathname);
  const quicknode =
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ethereum-mainnet\.quiknode\.pro$/u.test(
      parsed.hostname,
    ) && /^\/[A-Za-z0-9_-]{8,256}\/?$/u.test(parsed.pathname);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    (provider === "drpc" ? !drpc : !quicknode)
  )
    throw invalidInput("config", "rpc-url");
  return parsed.toString();
}

export function createDualRpcMarketReader(
  input: Readonly<{
    endpoints: readonly [string, string];
    fetcher?: DataPipelineFetcher;
  }>,
): MarketRpc {
  const endpoints = Object.freeze([
    exactRpcUrl(input.endpoints[0], "drpc"),
    exactRpcUrl(input.endpoints[1], "quicknode"),
  ] as const);

  async function request(endpoint: string, method: string, params: unknown[]) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await boundedJsonRequest<unknown>({
          dependency: "rpc",
          endpoint,
          timeoutMs: 5_000,
          maximumBodyBytes: 32 * 1024,
          fetcher: input.fetcher,
          body: { jsonrpc: "2.0", id: 1, method, params },
        });
      } catch (error) {
        if (error instanceof DataPipelineError && !error.retryable) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }

  return Object.freeze({
    async readChainlinkBlock({ blockNumber, expectedBlockHash }) {
      const number = BigInt(integer(blockNumber, "rpc-block-number"));
      const results = await Promise.all(
        endpoints.map(async (endpoint) => {
          const [rawBlock, rawCall] = await Promise.all([
            request(endpoint, "eth_getBlockByHash", [expectedBlockHash, false]),
            request(endpoint, "eth_call", [
              { to: CHAINLINK_ETH_USD, data: LATEST_ROUND_DATA_SELECTOR },
              { blockHash: expectedBlockHash, requireCanonical: true },
            ]),
          ]);
          const block = parseRpcEnvelope(rawBlock, "block");
          if (
            typeof block !== "object" ||
            block === null ||
            Array.isArray(block)
          ) {
            throw validationError("rpc", "block");
          }
          const row = block as Record<string, unknown>;
          const parsedNumber = parseHexQuantity(row.number, "block-number");
          const hash = canonicalBytes32(row.hash);
          const timestamp = parseHexQuantity(row.timestamp, "block-timestamp");
          if (parsedNumber !== number || hash !== expectedBlockHash) {
            throw validationError("rpc", "block-identity");
          }
          const chainlink = decodeChainlinkResult(
            parseRpcEnvelope(rawCall, "eth-call"),
          );
          const blockTimestamp = new Date(Number(timestamp) * 1_000);
          if (
            !Number.isFinite(blockTimestamp.getTime()) ||
            chainlink.feedUpdatedAt > blockTimestamp ||
            blockTimestamp.getTime() - chainlink.feedUpdatedAt.getTime() >
              3_600_000
          )
            throw validationError("rpc", "chainlink-freshness");
          return Object.freeze({
            blockNumber,
            blockHash: hash,
            blockTimestamp,
            ...chainlink,
          });
        }),
      );
      if (
        results[0]!.blockHash !== results[1]!.blockHash ||
        results[0]!.blockTimestamp.getTime() !==
          results[1]!.blockTimestamp.getTime() ||
        results[0]!.rawResult !== results[1]!.rawResult
      )
        throw validationError("rpc", "provider-mismatch");
      return results[0]!;
    },
  });
}

function assertBeforeDeadline(deadlineAt: number) {
  if (Date.now() >= deadlineAt) {
    throw dataPipelineError({
      dependency: "uniswap",
      code: "timeout",
      retryable: true,
      countsTowardCircuit: true,
    });
  }
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        output[index] = await operation(values[index]!, index);
      }
    },
  );
  await Promise.all(workers);
  return Object.freeze(output);
}

async function preparePoolPage(
  input: Readonly<{
    plan: MarketPoolPlan;
    store: MarketProjectorStore;
    analytics: MarketAnalytics;
    rpc: MarketRpc;
    graphProviderId: string;
    deadlineAt: number;
  }>,
): Promise<PreparedMarketPage> {
  const { plan } = input;
  assertBeforeDeadline(input.deadlineAt);
  const sourceReorg = BigInt(plan.sourceReorgGeneration);
  const cursorReorg = BigInt(plan.cursor?.sourceReorgGeneration ?? "0");
  const epochChanged =
    plan.cursor !== null && plan.epochId !== plan.cursor.epochId;
  const pointerChanged =
    plan.cursor !== null &&
    plan.pointerGeneration !== plan.cursor.pointerGeneration;
  const sourceCheckpointAdvanced =
    plan.cursor !== null &&
    BigInt(plan.sourceCheckpointGeneration) >
      BigInt(plan.cursor.sourceCheckpointGeneration);
  const isReorg =
    plan.cursor !== null &&
    (epochChanged || pointerChanged || sourceReorg > cursorReorg);
  if (
    plan.cursor &&
    !epochChanged &&
    (BigInt(plan.pointerGeneration) < BigInt(plan.cursor.pointerGeneration) ||
      (!pointerChanged && sourceReorg < cursorReorg))
  ) {
    throw validationError("postgres", "stale-source-reorg");
  }
  const sameBlockSourceAdvance =
    sourceCheckpointAdvanced &&
    plan.cursor !== null &&
    plan.sourceCheckpointBlockNumber === plan.cursor.blockNumber;
  const fromBlock = isReorg
    ? (BigInt(plan.launchBlockNumber) - 1n).toString()
    : sameBlockSourceAdvance
      ? (BigInt(plan.cursor!.blockNumber) > 0n
          ? BigInt(plan.cursor!.blockNumber) - 1n
          : 0n
        ).toString()
      : (plan.cursor?.blockNumber ??
        (BigInt(plan.launchBlockNumber) - 1n).toString());
  const anchors = await input.store.listCloseAnchors({
    plan,
    fromBlockExclusive: fromBlock,
    toBlockInclusive: plan.sourceCheckpointBlockNumber,
    limit: MAXIMUM_CLOSE_BLOCKS,
  });
  const bounded = anchors.length === MAXIMUM_CLOSE_BLOCKS;
  const terminalAnchor = bounded ? anchors[anchors.length - 1]! : null;
  const targetBlockNumber =
    terminalAnchor?.blockNumber ?? plan.sourceCheckpointBlockNumber;
  const targetBlockHash =
    terminalAnchor?.blockHash ?? plan.sourceCheckpointBlockHash;
  const targetEvidenceId =
    terminalAnchor?.blockEvidenceId ?? plan.sourceCheckpointBlockEvidenceId;
  assertBeforeDeadline(input.deadlineAt);
  const target = await input.rpc.readChainlinkBlock({
    blockNumber: targetBlockNumber,
    expectedBlockHash: targetBlockHash,
  });
  const targetSnapshot = exactResult(
    await input.analytics.readPoolSnapshot({
      poolKey: plan.poolKey,
      block: { number: targetBlockNumber, hash: targetBlockHash },
    }),
    { number: targetBlockNumber, hash: targetBlockHash },
  );
  if (targetSnapshot.tick === null)
    throw validationError("uniswap", "missing-tick");
  const targetPrices = prices(targetSnapshot, plan.poolKey);

  const closes = await mapWithConcurrency(
    anchors,
    PROVIDER_CONCURRENCY,
    async (anchor): Promise<PreparedMarketClose> => {
      assertBeforeDeadline(input.deadlineAt);
      const global =
        anchor.blockHash === target.blockHash
          ? target
          : await input.rpc.readChainlinkBlock({
              blockNumber: anchor.blockNumber,
              expectedBlockHash: anchor.blockHash,
            });
      const snapshot =
        anchor.blockHash === target.blockHash
          ? targetSnapshot
          : exactResult(
              await input.analytics.readPoolSnapshot({
                poolKey: plan.poolKey,
                block: { number: anchor.blockNumber, hash: anchor.blockHash },
              }),
              { number: anchor.blockNumber, hash: anchor.blockHash },
            );
      if (snapshot.tick === null)
        throw validationError("uniswap", "missing-close-tick");
      const closePrices = prices(snapshot, plan.poolKey);
      const hourStart = floorDate(global.blockTimestamp, 3_600);
      const partialHour = exactResult(
        await input.analytics.readHourSeries({
          poolKey: plan.poolKey,
          block: { number: anchor.blockNumber, hash: anchor.blockHash },
          from: dateSeconds(hourStart),
          toExclusive: dateSeconds(plusSeconds(hourStart, 3_600)),
        }),
        { number: anchor.blockNumber, hash: anchor.blockHash },
      );
      const hour = partialHour.find(
        (item) => item.periodStart === dateSeconds(hourStart),
      );
      if (!hour) throw validationError("uniswap", "missing-close-fees");
      return Object.freeze({
        anchor,
        global,
        snapshot,
        token0Price: closePrices.token0Price,
        token1Price: closePrices.token1Price,
        feesUsd: hour.feesUsd,
      });
    },
  );

  const hourEnd = floorDate(target.blockTimestamp, 3_600);
  const dayEnd = floorDate(target.blockTimestamp, 86_400);
  const hourStart = isReorg
    ? floorDate(plan.launchBlockTimestamp, 3_600)
    : (plan.cursor?.hourCoverageEnd ??
      floorDate(plan.launchBlockTimestamp, 3_600));
  const dayStart = isReorg
    ? floorDate(plan.launchBlockTimestamp, 86_400)
    : (plan.cursor?.dayCoverageEnd ??
      floorDate(plan.launchBlockTimestamp, 86_400));
  assertBeforeDeadline(input.deadlineAt);
  const [hourSeries, daySeries] = await Promise.all([
    hourStart < hourEnd
      ? input.analytics.readHourSeries({
          poolKey: plan.poolKey,
          block: { number: target.blockNumber, hash: target.blockHash },
          from: dateSeconds(hourStart),
          toExclusive: dateSeconds(hourEnd),
        })
      : Promise.resolve(null),
    dayStart < dayEnd
      ? input.analytics.readDaySeries({
          poolKey: plan.poolKey,
          block: { number: target.blockNumber, hash: target.blockHash },
          from: dateSeconds(dayStart),
          toExclusive: dateSeconds(dayEnd),
        })
      : Promise.resolve(null),
  ]);
  const candles: PreparedMarketCandle[] = [];
  if (hourStart < hourEnd) {
    for (const data of exactResult(hourSeries!, {
      number: target.blockNumber,
      hash: target.blockHash,
    })) {
      const periodStart = new Date(data.periodStart * 1_000);
      candles.push(
        Object.freeze({
          interval: "hour",
          periodStart,
          periodEnd: plusSeconds(periodStart, 3_600),
          data,
        }),
      );
    }
  }
  if (dayStart < dayEnd) {
    for (const data of exactResult(daySeries!, {
      number: target.blockNumber,
      hash: target.blockHash,
    })) {
      const periodStart = new Date(data.periodStart * 1_000);
      candles.push(
        Object.freeze({
          interval: "day",
          periodStart,
          periodEnd: plusSeconds(periodStart, 86_400),
          data,
        }),
      );
    }
  }
  const nextHourCoverageEnd =
    hourStart < hourEnd ? hourEnd : (plan.cursor?.hourCoverageEnd ?? null);
  const nextDayCoverageEnd =
    dayStart < dayEnd ? dayEnd : (plan.cursor?.dayCoverageEnd ?? null);
  const providerCursor = `block:${target.blockNumber}:${target.blockHash.slice(2, 18)}`;
  const pageCommitment = commitment("page", {
    releaseId: plan.scope.releaseId,
    modelId: plan.scope.modelId,
    epochId: plan.epochId,
    pointerGeneration: plan.pointerGeneration,
    sourceCheckpointId: plan.sourceCheckpointId,
    sourceCheckpointGeneration: plan.sourceCheckpointGeneration,
    sourceReorgGeneration: plan.sourceReorgGeneration,
    poolId: plan.poolKey.poolId,
    graphProviderId: input.graphProviderId,
    target,
    targetSnapshot,
    closes,
    candles,
    nextHourCoverageEnd: nextHourCoverageEnd?.toISOString() ?? null,
    nextDayCoverageEnd: nextDayCoverageEnd?.toISOString() ?? null,
    providerCursor,
    isReorg,
  });
  return Object.freeze({
    plan,
    graphProviderId: input.graphProviderId,
    targetEvidenceId,
    target,
    targetSnapshot,
    targetToken0Price: targetPrices.token0Price,
    targetToken1Price: targetPrices.token1Price,
    closes: Object.freeze(closes),
    candles: Object.freeze(candles),
    nextHourCoverageEnd,
    nextDayCoverageEnd,
    providerCursor,
    pageCommitment,
    isReorg,
  });
}

async function prepareFastLanePage(
  input: Readonly<{
    fastLane: MarketFastLanePlan;
    analytics: MarketAnalytics;
    rpc: MarketRpc;
    graphProviderId: string;
    deadlineAt: number;
  }>,
): Promise<PreparedMarketPage> {
  const { plan, anchor } = input.fastLane;
  const cursor = plan.cursor;
  if (
    !cursor ||
    plan.epochId !== cursor.epochId ||
    plan.pointerGeneration !== cursor.pointerGeneration ||
    plan.sourceReorgGeneration !== cursor.sourceReorgGeneration ||
    BigInt(plan.sourceCheckpointGeneration) <
      BigInt(cursor.sourceCheckpointGeneration) ||
    BigInt(anchor.blockNumber) < BigInt(cursor.blockNumber) ||
    BigInt(anchor.blockNumber) > BigInt(plan.sourceCheckpointBlockNumber)
  ) {
    throw validationError("postgres", "market-fast-lane-lineage");
  }
  assertBeforeDeadline(input.deadlineAt);
  const targetPromise = input.rpc.readChainlinkBlock({
    blockNumber: plan.sourceCheckpointBlockNumber,
    expectedBlockHash: plan.sourceCheckpointBlockHash,
  });
  const targetSnapshotPromise = input.analytics.readPoolSnapshot({
    poolKey: plan.poolKey,
    block: {
      number: plan.sourceCheckpointBlockNumber,
      hash: plan.sourceCheckpointBlockHash,
    },
  });
  const sameBlock = anchor.blockHash === plan.sourceCheckpointBlockHash;
  const closeGlobalPromise = sameBlock
    ? targetPromise
    : input.rpc.readChainlinkBlock({
        blockNumber: anchor.blockNumber,
        expectedBlockHash: anchor.blockHash,
      });
  const closeSnapshotPromise = sameBlock
    ? targetSnapshotPromise
    : input.analytics.readPoolSnapshot({
        poolKey: plan.poolKey,
        block: { number: anchor.blockNumber, hash: anchor.blockHash },
      });
  const closeHourStart = floorDate(anchor.blockTimestamp, 3_600);
  const partialHourPromise = input.analytics.readHourSeries({
    poolKey: plan.poolKey,
    block: { number: anchor.blockNumber, hash: anchor.blockHash },
    from: dateSeconds(closeHourStart),
    toExclusive: dateSeconds(plusSeconds(closeHourStart, 3_600)),
  });
  const [
    target,
    targetSnapshotResult,
    closeGlobal,
    closeSnapshotResult,
    partialHourResult,
  ] = await Promise.all([
    targetPromise,
    targetSnapshotPromise,
    closeGlobalPromise,
    closeSnapshotPromise,
    partialHourPromise,
  ]);
  const targetSnapshot = exactResult(targetSnapshotResult, {
    number: plan.sourceCheckpointBlockNumber,
    hash: plan.sourceCheckpointBlockHash,
  });
  if (targetSnapshot.tick === null) {
    throw validationError("uniswap", "missing-fast-lane-tick");
  }
  const targetPrices = prices(targetSnapshot, plan.poolKey);

  assertBeforeDeadline(input.deadlineAt);
  const closeSnapshot = exactResult(closeSnapshotResult, {
    number: anchor.blockNumber,
    hash: anchor.blockHash,
  });
  if (closeSnapshot.tick === null) {
    throw validationError("uniswap", "missing-fast-lane-close-tick");
  }
  const closePrices = prices(closeSnapshot, plan.poolKey);
  const partialHour = exactResult(partialHourResult, {
    number: anchor.blockNumber,
    hash: anchor.blockHash,
  });
  const closeHour = partialHour.find(
    (item) => item.periodStart === dateSeconds(closeHourStart),
  );
  if (!closeHour) {
    throw validationError("uniswap", "missing-fast-lane-close-fees");
  }
  const closes = Object.freeze([
    Object.freeze({
      anchor,
      global: closeGlobal,
      snapshot: closeSnapshot,
      token0Price: closePrices.token0Price,
      token1Price: closePrices.token1Price,
      feesUsd: closeHour.feesUsd,
    }),
  ]);
  const providerCursor = `head:${target.blockNumber}:${target.blockHash.slice(2, 18)}`;
  const pageCommitment = commitment("fast-lane-page", {
    releaseId: plan.scope.releaseId,
    modelId: plan.scope.modelId,
    epochId: plan.epochId,
    pointerGeneration: plan.pointerGeneration,
    sourceCheckpointId: plan.sourceCheckpointId,
    sourceCheckpointGeneration: plan.sourceCheckpointGeneration,
    sourceReorgGeneration: plan.sourceReorgGeneration,
    cursorId: cursor.id,
    cursorGeneration: cursor.cursorGeneration,
    cursorReorgGeneration: cursor.reorgGeneration,
    poolId: plan.poolKey.poolId,
    graphProviderId: input.graphProviderId,
    anchor,
    target,
    targetSnapshot,
    closes,
  });
  return Object.freeze({
    plan,
    graphProviderId: input.graphProviderId,
    targetEvidenceId: plan.sourceCheckpointBlockEvidenceId,
    target,
    targetSnapshot,
    targetToken0Price: targetPrices.token0Price,
    targetToken1Price: targetPrices.token1Price,
    closes,
    candles: Object.freeze([]),
    nextHourCoverageEnd: cursor.hourCoverageEnd,
    nextDayCoverageEnd: cursor.dayCoverageEnd,
    providerCursor,
    pageCommitment,
    isReorg: false,
    fastLane: true,
  });
}

export async function runMarketProjectorFastLaneCycle(
  input: Readonly<{
    store: MarketProjectorStore;
    analytics: MarketAnalytics;
    rpc: MarketRpc;
    graphProvider: Readonly<{
      redactedIdentity: string;
      deploymentCommitment: HexBytes32;
      schemaCommitment: HexBytes32;
    }>;
    deadlineMs?: number;
  }>,
): Promise<MarketProjectorCycleResult> {
  const startedAt = Date.now();
  const deadlineMs = input.deadlineMs ?? FAST_LANE_DEADLINE_MS;
  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < CLOSE_RESERVE_MS + 1_000 ||
    deadlineMs > 30_000
  ) {
    throw invalidInput("config", "market-fast-lane-deadline");
  }
  const deadlineAt = startedAt + deadlineMs - CLOSE_RESERVE_MS;
  const graphProviderId = await input.store.resolveGraphProvider(
    input.graphProvider,
  );
  const fastLane = await input.store.loadFastLanePlan();
  if (!fastLane) {
    return Object.freeze({
      status: "idle",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: true,
    });
  }
  const page = await prepareFastLanePage({
    fastLane,
    analytics: input.analytics,
    rpc: input.rpc,
    graphProviderId,
    deadlineAt,
  });
  return input.store.commit(page);
}

export async function runMarketProjectorCycle(
  input: Readonly<{
    store: MarketProjectorStore;
    analytics: MarketAnalytics;
    rpc: MarketRpc;
    graphProvider: Readonly<{
      redactedIdentity: string;
      deploymentCommitment: HexBytes32;
      schemaCommitment: HexBytes32;
    }>;
    deadlineMs?: number;
  }>,
): Promise<MarketProjectorCycleResult> {
  const startedAt = Date.now();
  const deadlineMs = input.deadlineMs ?? DEADLINE_MS;
  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < CLOSE_RESERVE_MS + 1_000 ||
    deadlineMs > 80_000
  ) {
    throw invalidInput("config", "market-projector-deadline");
  }
  const deadlineAt = startedAt + deadlineMs - CLOSE_RESERVE_MS;
  const graphProviderId = await input.store.resolveGraphProvider(
    input.graphProvider,
  );
  const plans = (await input.store.loadPlans()).filter((plan) => {
    if (plan.cursor === null) return true;
    if (
      plan.epochId !== plan.cursor.epochId ||
      plan.pointerGeneration !== plan.cursor.pointerGeneration
    ) {
      return true;
    }
    if (
      BigInt(plan.sourceReorgGeneration) >
      BigInt(plan.cursor.sourceReorgGeneration)
    ) {
      return true;
    }
    if (
      BigInt(plan.sourceCheckpointGeneration) >
      BigInt(plan.cursor.sourceCheckpointGeneration)
    ) {
      return true;
    }
    return (
      BigInt(plan.sourceCheckpointBlockNumber) > BigInt(plan.cursor.blockNumber)
    );
  });
  if (plans.length === 0) {
    return Object.freeze({
      status: "idle",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: true,
    });
  }
  const ranked = [...plans].sort((left, right) => {
    const leftReorg =
      left.cursor !== null &&
      (left.epochId !== left.cursor.epochId ||
        left.pointerGeneration !== left.cursor.pointerGeneration ||
        BigInt(left.sourceReorgGeneration) >
          BigInt(left.cursor.sourceReorgGeneration));
    const rightReorg =
      right.cursor !== null &&
      (right.epochId !== right.cursor.epochId ||
        right.pointerGeneration !== right.cursor.pointerGeneration ||
        BigInt(right.sourceReorgGeneration) >
          BigInt(right.cursor.sourceReorgGeneration));
    if (leftReorg !== rightReorg) return leftReorg ? -1 : 1;
    if ((left.cursor === null) !== (right.cursor === null)) {
      return left.cursor === null ? -1 : 1;
    }
    const leftAdvancedAt = left.cursor?.advancedAt.getTime() ?? 0;
    const rightAdvancedAt = right.cursor?.advancedAt.getTime() ?? 0;
    if (leftAdvancedAt !== rightAdvancedAt) {
      return leftAdvancedAt - rightAdvancedAt;
    }
    const leftLag =
      BigInt(left.sourceCheckpointBlockNumber) -
      BigInt(left.cursor?.blockNumber ?? left.launchBlockNumber);
    const rightLag =
      BigInt(right.sourceCheckpointBlockNumber) -
      BigInt(right.cursor?.blockNumber ?? right.launchBlockNumber);
    if (leftLag !== rightLag) return leftLag > rightLag ? -1 : 1;
    const release = left.scope.releaseId.localeCompare(right.scope.releaseId);
    return release !== 0
      ? release
      : left.poolKey.poolId.localeCompare(right.poolKey.poolId);
  });
  let last: MarketProjectorCycleResult | null = null;
  let lastError: unknown;
  let committedPools = 0;
  for (const plan of ranked) {
    if (committedPools >= MAXIMUM_POOLS_PER_CYCLE) break;
    if (Date.now() >= deadlineAt) break;
    try {
      const page = await preparePoolPage({
        plan,
        store: input.store,
        analytics: input.analytics,
        rpc: input.rpc,
        graphProviderId,
        deadlineAt,
      });
      last = await input.store.commit(page);
      committedPools += 1;
    } catch (error) {
      lastError = error;
      console.warn("Market projector skipped one pool", {
        releaseId: plan.scope.releaseId,
        poolId: plan.poolKey.poolId,
        error: safeMarketProjectorError(error),
      });
    }
  }
  if (lastError !== undefined) throw lastError;
  return (
    last ??
    Object.freeze({
      status: "idle",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: false,
    })
  );
}

export type MarketProjectorRuntimeConfig = Readonly<{
  databaseUrl: string;
  sslCaPem: string;
  sourceProjectorVersion: string;
  graphApiKey: string;
  graphProvider: Readonly<{
    redactedIdentity: string;
    deploymentCommitment: HexBytes32;
    schemaCommitment: HexBytes32;
  }>;
  rpcEndpoints: readonly [string, string];
  rpcProviders: readonly [MarketRpcProviderEvidence, MarketRpcProviderEvidence];
}>;

export function loadMarketProjectorRuntimeConfig(
  env: Environment = process.env,
): MarketProjectorRuntimeConfig {
  if (BROWSER_FORBIDDEN.some((name) => env[name])) {
    throw invalidInput("config", "browser-market-secret");
  }
  const binding = getDataPipelineReleaseBinding();
  if (
    binding.releases.length !== RELEASE_SCOPES.length ||
    binding.releases.some(
      (release, index) =>
        release.releaseVersion !== RELEASE_SCOPES[index]!.releaseId ||
        release.model !== RELEASE_SCOPES[index]!.modelId,
    )
  )
    throw invalidInput("config", "market-release-scopes");
  const pipeline = loadDataPipelineConfig(env);
  const sourceProjectorVersion = exactText(
    env.PROGRAMMABLE_SOURCE_PROJECTOR_VERSION,
    IDENTIFIER_PATTERN,
    "source-projector-version",
  );
  const redactedIdentity = exactText(
    env.PROGRAMMABLE_UNISWAP_GRAPH_REDACTED_IDENTITY,
    IDENTIFIER_PATTERN,
    "graph-redacted-identity",
  );
  const deploymentCommitment = canonicalBytes32(
    exactText(
      env.PROGRAMMABLE_UNISWAP_GRAPH_DEPLOYMENT_COMMITMENT,
      HEX32_PATTERN,
      "graph-deployment-commitment",
    ),
  );
  const schemaCommitment = canonicalBytes32(
    exactText(
      env.PROGRAMMABLE_UNISWAP_GRAPH_SCHEMA_COMMITMENT,
      HEX32_PATTERN,
      "graph-schema-commitment",
    ),
  );
  if (
    deploymentCommitment !== MARKET_GRAPH_DEPLOYMENT_COMMITMENT ||
    schemaCommitment !== MARKET_GRAPH_SCHEMA_COMMITMENT
  ) {
    throw invalidInput("config", "graph-release-provenance");
  }
  if (!pipeline.uniswap.apiKey) throw invalidInput("config", "graph-api-key");
  const providers = createProductionDualRpcProviders(env);
  assertProductionDualRpcProviders(providers);
  const rpcPair = productionMainnetRpcPair(env);
  return Object.freeze({
    databaseUrl: validatedPostgresConnectionString(
      env.PROGRAMMABLE_RECONCILER_DATABASE_URL,
    ),
    sslCaPem: validatedPostgresSslCa(env.PROGRAMMABLE_POSTGRES_SSL_CA_PEM),
    sourceProjectorVersion,
    graphApiKey: pipeline.uniswap.apiKey,
    graphProvider: Object.freeze({
      redactedIdentity,
      deploymentCommitment,
      schemaCommitment,
    }),
    rpcEndpoints: Object.freeze([
      exactRpcUrl(rpcPair.primary.url, "drpc"),
      exactRpcUrl(rpcPair.secondary.url, "quicknode"),
    ] as const),
    rpcProviders: Object.freeze([
      Object.freeze({
        identity: providers[0].identity,
        endpointCommitment: canonicalBytes32(providers[0].endpointCommitment),
        endpointOriginCommitment: canonicalBytes32(
          providers[0].endpointOriginCommitment,
        ),
      }),
      Object.freeze({
        identity: providers[1].identity,
        endpointCommitment: canonicalBytes32(providers[1].endpointCommitment),
        endpointOriginCommitment: canonicalBytes32(
          providers[1].endpointOriginCommitment,
        ),
      }),
    ] as const),
  });
}

export async function runConfiguredMarketProjectorCycle(
  input: Readonly<{
    env?: Environment;
    fetcher?: DataPipelineFetcher;
    executor?: PostgresExecutor;
  }> = {},
): Promise<MarketProjectorCycleResult> {
  const env = input.env ?? process.env;
  const activation = env.PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE;
  if (activation === undefined || activation === "false") {
    return Object.freeze({
      status: "disabled",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: false,
    });
  }
  if (activation !== "true") {
    throw invalidInput("config", "market-projector-active");
  }
  const config = loadMarketProjectorRuntimeConfig(env);
  const executor =
    input.executor ??
    createPostgresExecutor({
      connectionString: config.databaseUrl,
      sslCaPem: config.sslCaPem,
      maxConnections: 1,
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 5_000,
    });
  const store = createPostgresMarketProjectorStore({
    executor,
    sourceProjectorVersion: config.sourceProjectorVersion,
    rpcProviders: config.rpcProviders,
  });
  try {
    const lease = await store.tryAcquireLease();
    if (!lease) {
      return Object.freeze({
        status: "busy",
        lagBlocks: "0",
        closeCount: 0,
        candleCount: 0,
        caughtUp: false,
      });
    }
    try {
      return await runMarketProjectorCycle({
        store,
        analytics: createUniswapAnalyticsClient({
          gatewayBaseUrl: GRAPH_GATEWAY,
          apiKey: config.graphApiKey,
          fetcher: input.fetcher,
          limits: { maximumPages: 24, maximumEntities: 6_000 },
        }),
        rpc: createDualRpcMarketReader({
          endpoints: config.rpcEndpoints,
          fetcher: input.fetcher,
        }),
        graphProvider: config.graphProvider,
      });
    } finally {
      await store.releaseLease(lease);
    }
  } finally {
    if (!input.executor) await store.close();
  }
}

export async function runConfiguredMarketProjectorFastLaneCycle(
  input: Readonly<{
    env?: Environment;
    fetcher?: DataPipelineFetcher;
    executor?: PostgresExecutor;
  }> = {},
): Promise<MarketProjectorCycleResult> {
  const env = input.env ?? process.env;
  const activation = env.PROGRAMMABLE_MARKET_PROJECTOR_ACTIVE;
  if (activation === undefined || activation === "false") {
    return Object.freeze({
      status: "disabled",
      lagBlocks: "0",
      closeCount: 0,
      candleCount: 0,
      caughtUp: false,
    });
  }
  if (activation !== "true") {
    throw invalidInput("config", "market-projector-active");
  }
  const config = loadMarketProjectorRuntimeConfig(env);
  const executor =
    input.executor ??
    createPostgresExecutor({
      connectionString: config.databaseUrl,
      sslCaPem: config.sslCaPem,
      maxConnections: 1,
      connectTimeoutMs: 2_000,
      idleTimeoutMs: 5_000,
    });
  const store = createPostgresMarketProjectorStore({
    executor,
    sourceProjectorVersion: config.sourceProjectorVersion,
    rpcProviders: config.rpcProviders,
  });
  try {
    return await runMarketProjectorFastLaneCycle({
      store,
      analytics: createUniswapAnalyticsClient({
        gatewayBaseUrl: GRAPH_GATEWAY,
        apiKey: config.graphApiKey,
        fetcher: input.fetcher,
        limits: { maximumPages: 4, maximumEntities: 500 },
      }),
      rpc: createDualRpcMarketReader({
        endpoints: config.rpcEndpoints,
        fetcher: input.fetcher,
      }),
      graphProvider: config.graphProvider,
    });
  } finally {
    if (!input.executor) await store.close();
  }
}

export function safeMarketProjectorError(error: unknown) {
  if (error instanceof DataPipelineError) {
    return Object.freeze({
      dependency: error.dependency,
      code: error.code,
      retryable: error.retryable,
    });
  }
  return Object.freeze({
    dependency: "market-projector",
    code: "internal_error",
    retryable: false,
  });
}
