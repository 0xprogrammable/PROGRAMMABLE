import "server-only";

import {
  GMGN_TOKEN_RANKING_DEFAULT_LIMIT,
  GMGN_TOKEN_RANKING_MAXIMUM_LIMIT,
  GMGN_TOKEN_RANKING_ORDER_VALUES,
  GMGN_TOKEN_RANKING_TAG_VALUES,
  PROGRAMMABLE_GMGN_TOKEN_POOL_INFO_SCHEMA_VERSION,
  PROGRAMMABLE_GMGN_TOKEN_SECURITY_SCHEMA_VERSION,
  PROGRAMMABLE_GMGN_TOKEN_WALLET_RANKING_SCHEMA_VERSION,
  isGmgnTokenPoolInfoV1,
  isGmgnTokenSecurityV1,
  isGmgnTokenWalletRankingV1,
  type GmgnTokenPoolInfoV1,
  type GmgnTokenRankedWalletV1,
  type GmgnTokenRankingDirectionV1,
  type GmgnTokenRankingOrderV1,
  type GmgnTokenRankingQueryV1,
  type GmgnTokenRankingTagV1,
  type GmgnTokenSecurityLockDetailV1,
  type GmgnTokenSecurityV1,
  type GmgnTokenWalletNativeTransferV1,
  type GmgnTokenWalletRankingKindV1,
  type GmgnTokenWalletRankingV1,
  type GmgnTokenWalletTransferV1,
} from "./gmgn-token-analytics-v1";
import {
  getProductionGmgnAccountGateV1,
  type GmgnAccountGateV1,
} from "./gmgn-account-gate.server";
import { gmgnEffectiveRequestsPerSecondV1 } from
  "./gmgn-runtime-config.server";
import {
  isMarketChartIdentityV1,
  type MarketChartIdentityV1,
} from "./market-data-v1";

const GMGN_API_ORIGIN = "https://openapi.gmgn.ai" as const;
const GMGN_REQUEST_TIMEOUT_MS = 2_500;
const GMGN_RESPONSE_MAXIMUM_BYTES = 1_000_000;
const GMGN_ANALYTICS_CACHE_TTL_MS = 30_000;
const GMGN_MAXIMUM_CACHE_ENTRIES = 512;
const GMGN_MAXIMUM_RATE_LIMIT_COOLDOWN_MS = 5 * 60_000;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const PROVIDER_OPERATION_TIMED_OUT = Symbol("gmgn-provider-operation-timed-out");

type FetchImplementation = typeof fetch;
type GmgnAnalyticsPath =
  | "/v1/token/security"
  | "/v1/token/pool_info"
  | "/v1/market/token_top_holders"
  | "/v1/market/token_top_traders";

export type GmgnTokenAnalyticsReadWaitV1 = Readonly<{
  signal?: AbortSignal;
  deadlineMs?: number;
  fetchImpl?: FetchImplementation;
  now?: () => Date;
  accountGate?: GmgnAccountGateV1;
}>;

type GmgnTokenAnalyticsProviderReadWaitV1 = Readonly<{
  fetchImpl: FetchImplementation | undefined;
  now: () => Date;
  accountGate: GmgnAccountGateV1 | undefined;
  deadlineMs: number;
  signal: AbortSignal;
}>;

type ProviderOperationV1 = Pick<
  GmgnTokenAnalyticsProviderReadWaitV1,
  "now" | "deadlineMs" | "signal"
>;

export type GmgnTokenRankingOptionsV1 = Readonly<{
  limit?: number;
  orderBy?: GmgnTokenRankingOrderV1;
  direction?: GmgnTokenRankingDirectionV1;
  tag?: GmgnTokenRankingTagV1 | null;
}>;

type CachedValue<T> = Readonly<{
  expiresAtMs: number;
  value: T;
}>;

const securityCache = new Map<string, CachedValue<GmgnTokenSecurityV1>>();
const securityInFlight = new Map<string, Promise<GmgnTokenSecurityV1 | null>>();
const poolCache = new Map<string, CachedValue<GmgnTokenPoolInfoV1>>();
const poolInFlight = new Map<string, Promise<GmgnTokenPoolInfoV1 | null>>();
const rankingCache = new Map<
  string,
  CachedValue<GmgnTokenWalletRankingV1>
>();
const rankingInFlight = new Map<
  string,
  Promise<GmgnTokenWalletRankingV1 | null>
>();
let localBlockedUntilMs = 0;

export function gmgnTokenAnalyticsConfiguredV1(): boolean {
  return readApiKey() !== null;
}

export async function readGmgnTokenSecurityV1(
  identity: MarketChartIdentityV1,
  wait: GmgnTokenAnalyticsReadWaitV1 = {},
): Promise<GmgnTokenSecurityV1 | null> {
  const apiKey = readApiKey();
  if (apiKey === null || !isMarketChartIdentityV1(identity)) return null;
  const key = `security:${identityKey(identity)}`;
  return readThroughCache(
    securityCache,
    securityInFlight,
    key,
    wait,
    async (providerWait) => {
      const data = await gmgnJsonRequest(
        "/v1/token/security",
        { chain: "eth", address: identity.tokenAddress },
        apiKey,
        providerWait,
      );
      return parseGmgnTokenSecurityV1(
        data,
        identity,
        currentDate(providerWait),
      );
    },
  );
}

export async function readGmgnTokenPoolInfoV1(
  identity: MarketChartIdentityV1,
  wait: GmgnTokenAnalyticsReadWaitV1 = {},
): Promise<GmgnTokenPoolInfoV1 | null> {
  const apiKey = readApiKey();
  if (apiKey === null || !isMarketChartIdentityV1(identity)) return null;
  const key = `pool:${identityKey(identity)}`;
  return readThroughCache(
    poolCache,
    poolInFlight,
    key,
    wait,
    async (providerWait) => {
      const data = await gmgnJsonRequest(
        "/v1/token/pool_info",
        { chain: "eth", address: identity.tokenAddress },
        apiKey,
        providerWait,
      );
      return parseGmgnTokenPoolInfoV1(
        data,
        identity,
        currentDate(providerWait),
      );
    },
  );
}

export async function readGmgnTokenTopHoldersV1(
  identity: MarketChartIdentityV1,
  options: GmgnTokenRankingOptionsV1 = {},
  wait: GmgnTokenAnalyticsReadWaitV1 = {},
): Promise<GmgnTokenWalletRankingV1 | null> {
  return readGmgnTokenWalletRankingV1("holders", identity, options, wait);
}

export async function readGmgnTokenTopTradersV1(
  identity: MarketChartIdentityV1,
  options: GmgnTokenRankingOptionsV1 = {},
  wait: GmgnTokenAnalyticsReadWaitV1 = {},
): Promise<GmgnTokenWalletRankingV1 | null> {
  return readGmgnTokenWalletRankingV1("traders", identity, options, wait);
}

async function readGmgnTokenWalletRankingV1(
  kind: GmgnTokenWalletRankingKindV1,
  identity: MarketChartIdentityV1,
  options: GmgnTokenRankingOptionsV1,
  wait: GmgnTokenAnalyticsReadWaitV1,
): Promise<GmgnTokenWalletRankingV1 | null> {
  const apiKey = readApiKey();
  const query = normalizeRankingQuery(options);
  if (
    apiKey === null ||
    query === null ||
    !isMarketChartIdentityV1(identity)
  ) return null;
  const key = [
    kind,
    identityKey(identity),
    query.limit,
    query.orderBy,
    query.direction,
    query.tag ?? "all",
  ].join(":");
  return readThroughCache(
    rankingCache,
    rankingInFlight,
    key,
    wait,
    async (providerWait) => {
      const path = kind === "holders"
        ? "/v1/market/token_top_holders" as const
        : "/v1/market/token_top_traders" as const;
      const providerQuery: Record<string, string> = {
        chain: "eth",
        address: identity.tokenAddress,
        limit: String(query.limit),
        order_by: query.orderBy,
        direction: query.direction,
      };
      if (query.tag !== null) providerQuery.tag = query.tag;
      const data = await gmgnJsonRequest(
        path,
        providerQuery,
        apiKey,
        providerWait,
      );
      return parseGmgnTokenWalletRankingV1(
        data,
        kind,
        identity,
        query,
        currentDate(providerWait),
      );
    },
  );
}

export function parseGmgnTokenSecurityV1(
  response: unknown,
  identity: MarketChartIdentityV1,
  fetchedAt: Date,
): GmgnTokenSecurityV1 | null {
  const data = unwrapData(response);
  if (
    !isMarketChartIdentityV1(identity) ||
    !isRecord(data) ||
    !providerEthereumChainMatchesIfPresent(response, data) ||
    canonicalAddress(data.address) !== identity.tokenAddress ||
    !Number.isFinite(fetchedAt.getTime())
  ) return null;
  const flags = providerStringArray(data.flags, 64, 128);
  const lockSummary = parseSecurityLockSummary(data.lock_summary);
  if (flags === null || lockSummary === undefined) return null;
  const snapshot: GmgnTokenSecurityV1 = {
    schemaVersion: PROGRAMMABLE_GMGN_TOKEN_SECURITY_SCHEMA_VERSION,
    source: "gmgn",
    fetchedAt: fetchedAt.toISOString(),
    identity,
    tokenAddress: identity.tokenAddress,
    isShowAlert: providerBoolean(data.is_show_alert),
    isOpenSource: providerBoolean(data.is_open_source, data.open_source),
    isBlacklisted: providerBoolean(data.is_blacklist, data.blacklist),
    isHoneypot: providerBoolean(data.is_honeypot, data.honeypot),
    isOwnerRenounced: providerBoolean(
      data.is_renounced,
      data.owner_renounced,
      data.renounced,
    ),
    isMintRenounced: providerBoolean(data.renounced_mint),
    isFreezeAccountRenounced: providerBoolean(
      data.renounced_freeze_account,
    ),
    isWashTrading: providerBoolean(data.is_wash_trading),
    top10HolderRatio: providerRatio(data.top_10_holder_rate),
    developerTeamHoldRatio: providerRatio(data.dev_team_hold_rate),
    creatorBalanceRatio: providerRatio(data.creator_balance_rate),
    suspectedInsiderHoldRatio: providerRatio(
      data.suspected_insider_hold_rate,
    ),
    rugRatio: providerRatio(data.rug_ratio),
    ratTraderAmountRatio: providerRatio(data.rat_trader_amount_rate),
    bundlerTraderAmountRatio: providerRatio(data.bundler_trader_amount_rate),
    buyTaxRatio: providerRatio(data.buy_tax),
    sellTaxRatio: providerRatio(data.sell_tax),
    averageTaxRatio: providerRatio(data.average_tax),
    highTaxRatio: providerRatio(data.high_tax),
    burnRatio: providerRatio(data.burn_ratio),
    developerTokenBurnAmount: providerDecimal(data.dev_token_burn_amount),
    developerTokenBurnRatio: providerRatio(data.dev_token_burn_ratio),
    burnStatus: providerString(data.burn_status, 128),
    creatorTokenStatus: providerString(data.creator_token_status, 128),
    sniperCount: providerUnsignedInteger(data.sniper_count),
    canSellCount: providerUnsignedInteger(data.can_sell),
    cannotSellCount: providerUnsignedInteger(data.can_not_sell),
    hideRisk: providerBoolean(data.hide_risk),
    flags,
    lockSummary,
  };
  return isGmgnTokenSecurityV1(snapshot) ? Object.freeze(snapshot) : null;
}

export function parseGmgnTokenPoolInfoV1(
  response: unknown,
  identity: MarketChartIdentityV1,
  fetchedAt: Date,
): GmgnTokenPoolInfoV1 | null {
  const data = unwrapData(response);
  if (
    !isMarketChartIdentityV1(identity) ||
    !isRecord(data) ||
    !providerEthereumChainMatchesIfPresent(response, data)
  ) return null;
  // Live Ethereum v4 pool_info uses `address` and `base_address` for the
  // queried token. It does not return a bytes32 v4 PoolId. Keep the canonical
  // PoolId only as admission context and never attribute these token-level
  // figures to that pool.
  const providerAddress = canonicalAddress(data.address);
  const baseAddress = canonicalAddress(data.base_address);
  const quoteAddress = canonicalAddress(data.quote_address);
  const tokenAddress = baseAddress;
  const providerPair = requiredProviderPair(
    data.token0_address,
    data.token1_address,
  );
  if (
    tokenAddress !== identity.tokenAddress ||
    providerAddress !== identity.tokenAddress ||
    baseAddress !== identity.tokenAddress ||
    quoteAddress !== identity.quoteAddress ||
    data.exchange !== "uniswap_v4" ||
    providerPair === null ||
    !Number.isFinite(fetchedAt.getTime())
  ) return null;
  const liquidityUsd = providerDecimal(data.liquidity);
  const baseReserve = providerDecimal(data.base_reserve);
  const quoteReserve = providerDecimal(data.quote_reserve);
  const creationTimestamp = providerUnsignedInteger(data.creation_timestamp);
  if (
    liquidityUsd === null ||
    baseReserve === null ||
    quoteReserve === null ||
    creationTimestamp === null ||
    providerAddress === null ||
    baseAddress === null ||
    quoteAddress === null
  ) return null;
  const token0Address = baseAddress < quoteAddress ? baseAddress : quoteAddress;
  const token1Address = baseAddress < quoteAddress ? quoteAddress : baseAddress;
  if (
    providerPair !== null &&
    (providerPair[0] !== token0Address || providerPair[1] !== token1Address)
  ) return null;
  const snapshot: GmgnTokenPoolInfoV1 = {
    schemaVersion: PROGRAMMABLE_GMGN_TOKEN_POOL_INFO_SCHEMA_VERSION,
    source: "gmgn",
    marketScope: "token",
    poolAttribution: "unavailable",
    currency: "USD",
    fetchedAt: fetchedAt.toISOString(),
    identity,
    tokenAddress,
    providerAddress,
    baseAddress,
    quoteAddress,
    token0Address,
    token1Address,
    quoteSymbol: providerString(data.quote_symbol, 64),
    exchange: "uniswap_v4",
    liquidityUsd,
    baseReserve,
    quoteReserve,
    baseReserveValueUsd: providerDecimal(data.base_reserve_value),
    quoteReserveValueUsd: providerDecimal(data.quote_reserve_value),
    initialLiquidityUsd: providerDecimal(data.initial_liquidity),
    initialBaseReserve: providerDecimal(data.initial_base_reserve),
    initialQuoteReserve: providerDecimal(data.initial_quote_reserve),
    priceUsd: providerDecimal(data.price),
    feeRatio: providerRatio(data.fee_ratio),
    creationTimestamp,
  };
  return isGmgnTokenPoolInfoV1(snapshot) ? Object.freeze(snapshot) : null;
}

function requiredProviderPair(
  token0: unknown,
  token1: unknown,
): readonly [`0x${string}`, `0x${string}`] | null {
  const token0Address = canonicalAddress(token0);
  const token1Address = canonicalAddress(token1);
  return token0Address !== null &&
      token1Address !== null &&
      token0Address < token1Address
    ? [token0Address, token1Address]
    : null;
}

export function parseGmgnTokenWalletRankingV1(
  response: unknown,
  kind: GmgnTokenWalletRankingKindV1,
  identity: MarketChartIdentityV1,
  query: GmgnTokenRankingQueryV1,
  fetchedAt: Date,
): GmgnTokenWalletRankingV1 | null {
  const data = unwrapData(response);
  const normalizedQuery = normalizeRankingQuery(query);
  if (
    !isMarketChartIdentityV1(identity) ||
    (kind !== "holders" && kind !== "traders") ||
    normalizedQuery === null ||
    !isRecord(data) ||
    !Array.isArray(data.list) ||
    !providerEthereumChainMatchesIfPresent(response, data) ||
    data.list.some((row) => !providerEthereumChainMatchesIfPresent(row)) ||
    data.list.length > normalizedQuery.limit ||
    !Number.isFinite(fetchedAt.getTime())
  ) return null;
  const wallets = data.list.map(parseRankedWallet);
  if (wallets.some((wallet) => wallet === null)) return null;
  const parsedWallets = wallets.filter(
    (wallet): wallet is GmgnTokenRankedWalletV1 => wallet !== null,
  );
  if (new Set(parsedWallets.map((wallet) => wallet.address)).size !==
    parsedWallets.length) return null;
  const snapshot: GmgnTokenWalletRankingV1 = {
    schemaVersion: PROGRAMMABLE_GMGN_TOKEN_WALLET_RANKING_SCHEMA_VERSION,
    source: "gmgn",
    fetchedAt: fetchedAt.toISOString(),
    identity,
    tokenAddress: identity.tokenAddress,
    kind,
    query: normalizedQuery,
    wallets: parsedWallets,
  };
  return isGmgnTokenWalletRankingV1(snapshot) ? Object.freeze(snapshot) : null;
}

function parseRankedWallet(value: unknown): GmgnTokenRankedWalletV1 | null {
  if (!isRecord(value)) return null;
  const address = canonicalAddress(value.address);
  if (address === null) return null;
  const accountAddress = providerAddress(value.account_address);
  const nativeBalanceRaw = providerUnsignedIntegerString(value.native_balance);
  const tags = providerStringArray(value.tags, 64, 128);
  const makerTokenTags = providerStringArray(value.maker_token_tags, 64, 128);
  const nativeTransfer = parseNativeTransfer(value.native_transfer);
  const tokenTransfer = parseWalletTransfer(value.token_transfer);
  const tokenTransferIn = parseWalletTransfer(value.token_transfer_in);
  const tokenTransferOut = parseWalletTransfer(value.token_transfer_out);
  if (
    accountAddress === undefined ||
    nativeBalanceRaw === undefined ||
    tags === null ||
    makerTokenTags === null ||
    nativeTransfer === undefined ||
    tokenTransfer === undefined ||
    tokenTransferIn === undefined ||
    tokenTransferOut === undefined
  ) return null;
  const wallet: GmgnTokenRankedWalletV1 = {
    address,
    accountAddress,
    addressType: providerUnsignedInteger(value.addr_type),
    exchange: providerString(value.exchange, 128),
    walletRank: providerString(value.wallet_tag_v2, 64),
    nativeBalanceRaw,
    balance: providerFiniteNumber(value.balance),
    amount: providerFiniteNumber(value.amount_cur),
    usdValue: providerFiniteNumber(value.usd_value),
    amountRatio: providerFiniteNumber(value.amount_percentage),
    accumulatedAmount: providerFiniteNumber(value.accu_amount),
    accumulatedCostUsd: providerFiniteNumber(value.accu_cost),
    costUsd: providerFiniteNumber(value.cost),
    currentCostUsd: providerFiniteNumber(value.cost_cur),
    isOnCurve: providerBoolean(value.is_on_curve),
    isNew: providerBoolean(value.is_new),
    isSuspicious: providerBoolean(value.is_suspicious),
    transferIn: providerBoolean(value.transfer_in),
    buyVolumeUsd: providerFiniteNumber(value.buy_volume_cur),
    sellVolumeUsd: providerFiniteNumber(value.sell_volume_cur),
    buyAmount: providerFiniteNumber(value.buy_amount_cur),
    sellAmount: providerFiniteNumber(value.sell_amount_cur),
    currentBuyAmount: providerFiniteNumber(value.current_buy_amount),
    currentSellAmount: providerFiniteNumber(value.current_sell_amount),
    sellAmountRatio: providerFiniteNumber(value.sell_amount_percentage),
    buyTransactionCount: providerUnsignedInteger(value.buy_tx_count_cur),
    sellTransactionCount: providerUnsignedInteger(value.sell_tx_count_cur),
    netflowUsd: providerFiniteNumber(value.netflow_usd),
    netflowAmount: providerFiniteNumber(value.netflow_amount),
    averageCostUsd: providerFiniteNumber(value.avg_cost),
    averageSoldUsd: providerFiniteNumber(value.avg_sold),
    historyBoughtCostUsd: providerFiniteNumber(value.history_bought_cost),
    historyBoughtFeeUsd: providerFiniteNumber(value.history_bought_fee),
    historySoldIncomeUsd: providerFiniteNumber(value.history_sold_income),
    historySoldFeeUsd: providerFiniteNumber(value.history_sold_fee),
    totalCostUsd: providerFiniteNumber(value.total_cost),
    profitUsd: providerFiniteNumber(value.profit),
    profitRatio: providerFiniteNumber(value.profit_change),
    realizedProfitUsd: providerFiniteNumber(value.realized_profit),
    realizedPnlRatio: providerFiniteNumber(value.realized_pnl),
    unrealizedProfitUsd: providerFiniteNumber(value.unrealized_profit),
    unrealizedPnlRatio: providerFiniteNumber(value.unrealized_pnl),
    currentTransferInAmount: providerFiniteNumber(
      value.current_transfer_in_amount,
    ),
    currentTransferOutAmount: providerFiniteNumber(
      value.current_transfer_out_amount,
    ),
    historyTransferInAmount: providerFiniteNumber(
      value.history_transfer_in_amount,
    ),
    historyTransferInCostUsd: providerFiniteNumber(
      value.history_transfer_in_cost,
    ),
    historyTransferOutAmount: providerFiniteNumber(
      value.history_transfer_out_amount,
    ),
    historyTransferOutIncomeUsd: providerFiniteNumber(
      value.history_transfer_out_income,
    ),
    historyTransferOutFeeUsd: providerFiniteNumber(
      value.history_transfer_out_fee,
    ),
    transferInCount: providerUnsignedInteger(value.transfer_in_count),
    transferOutCount: providerUnsignedInteger(value.transfer_out_count),
    startHoldingAt: providerUnsignedInteger(value.start_holding_at),
    endHoldingAt: providerUnsignedInteger(value.end_holding_at),
    lastActiveTimestamp: providerUnsignedInteger(value.last_active_timestamp),
    lastBlock: providerUnsignedInteger(value.last_block),
    name: providerString(value.name, 512),
    twitterUsername: providerString(value.twitter_username, 256),
    twitterName: providerString(value.twitter_name, 512),
    avatar: providerString(value.avatar, 2_048),
    tags,
    makerTokenTags,
    createdAt: providerUnsignedInteger(value.created_at),
    nativeTransfer,
    tokenTransfer,
    tokenTransferIn,
    tokenTransferOut,
  };
  return wallet;
}

function parseSecurityLockSummary(
  value: unknown,
): GmgnTokenSecurityV1["lockSummary"] | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  const isLocked = providerBoolean(value.is_locked);
  const lockRatio = providerRatio(value.lock_percent);
  const remainingLockRatio = providerRatio(value.left_lock_percent);
  if (
    isLocked === null ||
    lockRatio === null ||
    remainingLockRatio === null ||
    !Array.isArray(value.lock_detail) ||
    value.lock_detail.length > 256
  ) return undefined;
  const details: GmgnTokenSecurityLockDetailV1[] = [];
  for (const item of value.lock_detail) {
    if (!isRecord(item)) return undefined;
    const ratio = providerRatio(item.percent);
    const poolAddress = canonicalAddress(item.pool);
    const isBlackhole = providerBoolean(item.is_blackhole);
    if (ratio === null || poolAddress === null || isBlackhole === null) {
      return undefined;
    }
    details.push({ ratio, poolAddress, isBlackhole });
  }
  return Object.freeze({
    isLocked,
    lockRatio,
    remainingLockRatio,
    details: Object.freeze(details),
  });
}

function parseNativeTransfer(
  value: unknown,
): GmgnTokenWalletNativeTransferV1 | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  const fromAddress = providerAddress(value.from_address);
  const amount = providerDecimal(value.amount);
  const transactionHash = providerBytes32(value.tx_hash);
  if (
    fromAddress === undefined ||
    transactionHash === undefined
  ) return undefined;
  return Object.freeze({
    name: providerString(value.name, 512),
    fromAddress,
    amount,
    timestamp: providerUnsignedInteger(value.timestamp),
    transactionHash,
  });
}

function parseWalletTransfer(
  value: unknown,
): GmgnTokenWalletTransferV1 | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) return undefined;
  const address = providerAddress(value.address);
  const transactionHash = providerBytes32(value.tx_hash);
  if (address === undefined || transactionHash === undefined) return undefined;
  return Object.freeze({
    name: providerString(value.name, 512),
    address,
    timestamp: providerUnsignedInteger(value.timestamp),
    transactionHash,
    type: providerString(value.type, 128),
  });
}

function normalizeRankingQuery(
  options: GmgnTokenRankingOptionsV1 | GmgnTokenRankingQueryV1,
): GmgnTokenRankingQueryV1 | null {
  const limit = options.limit ?? GMGN_TOKEN_RANKING_DEFAULT_LIMIT;
  const orderBy = options.orderBy ?? "amount_percentage";
  const direction = options.direction ?? "desc";
  const tag = options.tag ?? null;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > GMGN_TOKEN_RANKING_MAXIMUM_LIMIT ||
    !GMGN_TOKEN_RANKING_ORDER_VALUES.includes(orderBy) ||
    (direction !== "asc" && direction !== "desc") ||
    (tag !== null && !GMGN_TOKEN_RANKING_TAG_VALUES.includes(tag))
  ) return null;
  return Object.freeze({ limit, orderBy, direction, tag });
}

async function readThroughCache<T>(
  cache: Map<string, CachedValue<T>>,
  inFlight: Map<string, Promise<T | null>>,
  key: string,
  wait: GmgnTokenAnalyticsReadWaitV1,
  read: (providerWait: GmgnTokenAnalyticsProviderReadWaitV1) =>
    Promise<T | null>,
): Promise<T | null> {
  const nowMs = currentDate(wait).getTime();
  if (!callerCanAwaitSharedRead(wait, nowMs)) return null;
  const cached = cache.get(key);
  if (cached && cached.expiresAtMs > nowMs) return cached.value;
  if (cached) cache.delete(key);
  const active = inFlight.get(key);
  if (active) return awaitSharedReadForCaller(active, wait);
  const providerWait = sharedProviderWait(wait);
  const providerRead = read(providerWait);
  const promise = settleProviderOperation(providerRead, providerWait).then((settled) => {
    if (settled === PROVIDER_OPERATION_TIMED_OUT) return null;
    const value = settled;
    if (value !== null) {
      setCacheValue(
        cache,
        key,
        value,
        currentDate(providerWait).getTime() + GMGN_ANALYTICS_CACHE_TTL_MS,
      );
    }
    return value;
  }).catch(() => null).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return awaitSharedReadForCaller(promise, wait);
}

async function gmgnJsonRequest(
  path: GmgnAnalyticsPath,
  query: Readonly<Record<string, string>>,
  apiKey: string,
  wait: GmgnTokenAnalyticsProviderReadWaitV1,
): Promise<unknown | null> {
  const fetchImpl = wait.fetchImpl ?? fetch;
  const now = wait.now;
  const queuedAtMs = now().getTime();
  const requestDeadlineMs = wait.deadlineMs;
  if (
    wait.signal.aborted ||
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
  try {
    if (
      accountGate === null &&
      (process.env.NODE_ENV === "production" || fetchImpl === fetch)
    ) accountGate = getProductionGmgnAccountGateV1();
    if (accountGate !== null) {
      const decision = await reserveProviderSlot(accountGate, {
        requestsPerSecond: gmgnEffectiveRequestsPerSecondV1(),
        cost: gmgnRequestCost(path),
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
  const remainingMs = requestDeadlineMs - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
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
      headers: { Accept: "application/json", "X-APIKEY": apiKey },
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
    await finalizeRejectedResponse(
      accountGate,
      reservation,
      response,
      null,
      nowMs,
      wait,
    );
    return null;
  }
  const bytes = await readBoundedResponseBytes(
    response,
    GMGN_RESPONSE_MAXIMUM_BYTES,
  );
  if (bytes === null) {
    await finalizeRejectedResponse(
      accountGate,
      reservation,
      response,
      null,
      nowMs,
      wait,
    );
    return null;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    await finalizeRejectedResponse(
      accountGate,
      reservation,
      response,
      null,
      nowMs,
      wait,
    );
    return null;
  }
  const envelope = safeJson(text);
  const rateLimited = response.status === 429 || isRateLimitedEnvelope(envelope);
  if (rateLimited) {
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
      wait,
    );
  } else if (!await completeProviderRequest(accountGate, reservation, wait)) {
    return null;
  }
  if (!response.ok || rateLimited || !isRecord(envelope)) return null;
  if (envelope.code !== 0 && envelope.code !== "0") return null;
  if (!isRecord(envelope.data)) return null;
  // Preserve the raw envelope so each parser can validate an explicit outer
  // chain together with the normalized inner payload.
  return envelope;
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

function readApiKey(): string | null {
  const value = process.env.GMGN_API_KEY?.trim();
  return value ? value : null;
}

function sharedProviderWait(
  wait: GmgnTokenAnalyticsReadWaitV1,
): GmgnTokenAnalyticsProviderReadWaitV1 {
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
  wait: GmgnTokenAnalyticsReadWaitV1,
  nowMs: number,
): boolean {
  if (!Number.isFinite(nowMs) || wait.signal?.aborted) return false;
  return wait.deadlineMs === undefined || (
    Number.isFinite(wait.deadlineMs) && wait.deadlineMs > nowMs
  );
}

function awaitSharedReadForCaller<T>(
  promise: Promise<T | null>,
  wait: GmgnTokenAnalyticsReadWaitV1,
): Promise<T | null> {
  const nowMs = currentDate(wait).getTime();
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

function gmgnRequestCost(path: GmgnAnalyticsPath): 1 | 5 {
  return path.includes("token_top_") ? 5 : 1;
}

function isRateLimitedEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const joined = [value.code, value.error, value.message]
    .map((item) => String(item ?? "").toUpperCase())
    .join(":");
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
  if (isRecord(envelope)) {
    const resetAt = providerUnsignedInteger(envelope.reset_at);
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
    return Math.min(maximum, Math.max(nowMs, Math.ceil(reset * 1_000)) + 250);
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
    // The read already fails soft. A future production request must pass the
    // shared gate again before another provider request can be made.
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

function providerBoolean(...values: readonly unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "yes") return true;
    if (value === 0 || value === "0" || value === "no") return false;
  }
  return null;
}

function providerEthereumChainMatchesIfPresent(
  ...values: readonly unknown[]
): boolean {
  return values.every((value) =>
    !isRecord(value) ||
    !Object.prototype.hasOwnProperty.call(value, "chain") ||
    value.chain === "eth"
  );
}

function providerRatio(value: unknown): string | null {
  const decimal = providerDecimal(value);
  if (decimal === null) return null;
  const parsed = Number(decimal);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1
    ? decimal
    : null;
}

function providerDecimal(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const normalized = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string"
      ? value
      : null;
  if (
    normalized === null ||
    normalized.length > 160 ||
    !NON_NEGATIVE_DECIMAL.test(normalized)
  ) return null;
  return normalized;
}

function providerFiniteNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "string" &&
    value.length <= 160 &&
    NON_NEGATIVE_DECIMAL.test(value)
  ) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function providerUnsignedInteger(value: unknown): number | null {
  const normalized = typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : typeof value === "string" && UNSIGNED_INTEGER.test(value)
      ? Number(value)
      : null;
  return normalized !== null && Number.isSafeInteger(normalized) && normalized >= 0
    ? normalized
    : null;
}

function providerUnsignedIntegerString(
  value: unknown,
): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string" && value.length <= 160 && UNSIGNED_INTEGER.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

function providerString(value: unknown, maximumLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  return typeof value === "string" && value.length <= maximumLength
    ? value
    : null;
}

function providerStringArray(
  value: unknown,
  maximumEntries: number,
  maximumLength: number,
): readonly string[] | null {
  if (value === undefined || value === null) return Object.freeze([]);
  if (
    !Array.isArray(value) ||
    value.length > maximumEntries ||
    value.some((entry) =>
      typeof entry !== "string" || entry.length > maximumLength
    )
  ) return null;
  return Object.freeze([...value]);
}

function providerAddress(value: unknown): `0x${string}` | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return canonicalAddress(value) ?? undefined;
}

function providerBytes32(value: unknown): `0x${string}` | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  return canonicalBytes32(value) ?? undefined;
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

function currentDate(wait: Readonly<{ now?: (() => Date) | undefined }>): Date {
  return (wait.now ?? (() => new Date()))();
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
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function unwrapData(value: unknown): unknown {
  return isRecord(value) && value.data !== undefined ? value.data : value;
}

function safeJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
