import {
  isMarketChartIdentityV1,
  type MarketChartIdentityV1,
} from "./market-data-v1";

// Provider contract: GMGNAI/gmgn-skills@267ff6ba86aaeb5d4a4f23409b3cfef7ef32ff62.
// The normalized schemas below cover the official Ethereum security, pool,
// token_top_holders, and token_top_traders responses without importing GMGN's
// trading or private-key surfaces.

export const PROGRAMMABLE_GMGN_TOKEN_SECURITY_SCHEMA_VERSION =
  "programmable.gmgn-token-security.v1" as const;
export const PROGRAMMABLE_GMGN_TOKEN_POOL_INFO_SCHEMA_VERSION =
  "programmable.gmgn-token-pool-info.v1" as const;
export const PROGRAMMABLE_GMGN_TOKEN_WALLET_RANKING_SCHEMA_VERSION =
  "programmable.gmgn-token-wallet-ranking.v1" as const;

export const GMGN_TOKEN_RANKING_MAXIMUM_LIMIT = 100 as const;
export const GMGN_TOKEN_RANKING_DEFAULT_LIMIT = 20 as const;

export const GMGN_TOKEN_RANKING_ORDER_VALUES = [
  "amount_percentage",
  "profit",
  "unrealized_profit",
  "buy_volume_cur",
  "sell_volume_cur",
] as const;

export const GMGN_TOKEN_RANKING_TAG_VALUES = [
  "smart_degen",
  "renowned",
  "fresh_wallet",
  "dev",
  "sniper",
  "rat_trader",
  "bundler",
  "transfer_in",
  "dex_bot",
  "bluechip_owner",
] as const;

export type GmgnTokenRankingOrderV1 =
  typeof GMGN_TOKEN_RANKING_ORDER_VALUES[number];
export type GmgnTokenRankingTagV1 =
  typeof GMGN_TOKEN_RANKING_TAG_VALUES[number];
export type GmgnTokenRankingDirectionV1 = "asc" | "desc";
export type GmgnTokenWalletRankingKindV1 = "holders" | "traders";

export type GmgnTokenRankingQueryV1 = Readonly<{
  limit: number;
  orderBy: GmgnTokenRankingOrderV1;
  direction: GmgnTokenRankingDirectionV1;
  tag: GmgnTokenRankingTagV1 | null;
}>;

export type GmgnTokenSecurityLockDetailV1 = Readonly<{
  ratio: string;
  poolAddress: `0x${string}`;
  isBlackhole: boolean;
}>;

export type GmgnTokenSecurityV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_GMGN_TOKEN_SECURITY_SCHEMA_VERSION;
  source: "gmgn";
  fetchedAt: string;
  identity: MarketChartIdentityV1;
  tokenAddress: `0x${string}`;
  isShowAlert: boolean | null;
  isOpenSource: boolean | null;
  isBlacklisted: boolean | null;
  isHoneypot: boolean | null;
  isOwnerRenounced: boolean | null;
  isMintRenounced: boolean | null;
  isFreezeAccountRenounced: boolean | null;
  isWashTrading: boolean | null;
  top10HolderRatio: string | null;
  developerTeamHoldRatio: string | null;
  creatorBalanceRatio: string | null;
  suspectedInsiderHoldRatio: string | null;
  rugRatio: string | null;
  ratTraderAmountRatio: string | null;
  bundlerTraderAmountRatio: string | null;
  buyTaxRatio: string | null;
  sellTaxRatio: string | null;
  averageTaxRatio: string | null;
  highTaxRatio: string | null;
  burnRatio: string | null;
  developerTokenBurnAmount: string | null;
  developerTokenBurnRatio: string | null;
  burnStatus: string | null;
  creatorTokenStatus: string | null;
  sniperCount: number | null;
  canSellCount: number | null;
  cannotSellCount: number | null;
  hideRisk: boolean | null;
  flags: readonly string[];
  lockSummary: Readonly<{
    isLocked: boolean;
    lockRatio: string;
    remainingLockRatio: string;
    details: readonly GmgnTokenSecurityLockDetailV1[];
  }> | null;
}>;

export type GmgnTokenPoolInfoV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_GMGN_TOKEN_POOL_INFO_SCHEMA_VERSION;
  source: "gmgn";
  currency: "USD";
  fetchedAt: string;
  identity: MarketChartIdentityV1;
  tokenAddress: `0x${string}`;
  poolAddress: `0x${string}`;
  baseAddress: `0x${string}`;
  quoteAddress: `0x${string}`;
  token0Address: `0x${string}`;
  token1Address: `0x${string}`;
  quoteSymbol: string | null;
  exchange: "uniswap_v4";
  liquidityUsd: string;
  baseReserve: string;
  quoteReserve: string;
  baseReserveValueUsd: string | null;
  quoteReserveValueUsd: string | null;
  initialLiquidityUsd: string | null;
  initialBaseReserve: string | null;
  initialQuoteReserve: string | null;
  priceUsd: string | null;
  feeRatio: string | null;
  creationTimestamp: number;
}>;

export type GmgnTokenWalletTransferV1 = Readonly<{
  name: string | null;
  address: `0x${string}` | null;
  timestamp: number | null;
  transactionHash: `0x${string}` | null;
  type: string | null;
}>;

export type GmgnTokenWalletNativeTransferV1 = Readonly<{
  name: string | null;
  fromAddress: `0x${string}` | null;
  amount: string | null;
  timestamp: number | null;
  transactionHash: `0x${string}` | null;
}>;

/**
 * A normalized projection of GMGN's current shared holder/trader row schema.
 * Every numeric provider field remains a finite JSON number because GMGN's
 * official endpoint currently emits those values as numbers rather than exact
 * decimal strings. These values are analytics only and must never be used for
 * settlement or transaction construction.
 */
export type GmgnTokenRankedWalletV1 = Readonly<{
  address: `0x${string}`;
  accountAddress: `0x${string}` | null;
  addressType: number | null;
  exchange: string | null;
  walletRank: string | null;
  nativeBalanceRaw: string | null;
  balance: number | null;
  amount: number | null;
  usdValue: number | null;
  amountRatio: number | null;
  accumulatedAmount: number | null;
  accumulatedCostUsd: number | null;
  costUsd: number | null;
  currentCostUsd: number | null;
  isOnCurve: boolean | null;
  isNew: boolean | null;
  isSuspicious: boolean | null;
  transferIn: boolean | null;
  buyVolumeUsd: number | null;
  sellVolumeUsd: number | null;
  buyAmount: number | null;
  sellAmount: number | null;
  currentBuyAmount: number | null;
  currentSellAmount: number | null;
  sellAmountRatio: number | null;
  buyTransactionCount: number | null;
  sellTransactionCount: number | null;
  netflowUsd: number | null;
  netflowAmount: number | null;
  averageCostUsd: number | null;
  averageSoldUsd: number | null;
  historyBoughtCostUsd: number | null;
  historyBoughtFeeUsd: number | null;
  historySoldIncomeUsd: number | null;
  historySoldFeeUsd: number | null;
  totalCostUsd: number | null;
  profitUsd: number | null;
  profitRatio: number | null;
  realizedProfitUsd: number | null;
  realizedPnlRatio: number | null;
  unrealizedProfitUsd: number | null;
  unrealizedPnlRatio: number | null;
  currentTransferInAmount: number | null;
  currentTransferOutAmount: number | null;
  historyTransferInAmount: number | null;
  historyTransferInCostUsd: number | null;
  historyTransferOutAmount: number | null;
  historyTransferOutIncomeUsd: number | null;
  historyTransferOutFeeUsd: number | null;
  transferInCount: number | null;
  transferOutCount: number | null;
  startHoldingAt: number | null;
  endHoldingAt: number | null;
  lastActiveTimestamp: number | null;
  lastBlock: number | null;
  name: string | null;
  twitterUsername: string | null;
  twitterName: string | null;
  avatar: string | null;
  tags: readonly string[];
  makerTokenTags: readonly string[];
  createdAt: number | null;
  nativeTransfer: GmgnTokenWalletNativeTransferV1 | null;
  tokenTransfer: GmgnTokenWalletTransferV1 | null;
  tokenTransferIn: GmgnTokenWalletTransferV1 | null;
  tokenTransferOut: GmgnTokenWalletTransferV1 | null;
}>;

export type GmgnTokenWalletRankingV1 = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_GMGN_TOKEN_WALLET_RANKING_SCHEMA_VERSION;
  source: "gmgn";
  fetchedAt: string;
  identity: MarketChartIdentityV1;
  tokenAddress: `0x${string}`;
  kind: GmgnTokenWalletRankingKindV1;
  query: GmgnTokenRankingQueryV1;
  wallets: readonly GmgnTokenRankedWalletV1[];
}>;

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;

export function isGmgnTokenSecurityV1(
  value: unknown,
): value is GmgnTokenSecurityV1 {
  if (!isRecord(value) || !isMarketChartIdentityV1(value.identity)) {
    return false;
  }
  if (
    value.schemaVersion !== PROGRAMMABLE_GMGN_TOKEN_SECURITY_SCHEMA_VERSION ||
    value.source !== "gmgn" ||
    !exactIsoTime(value.fetchedAt) ||
    !canonicalAddress(value.tokenAddress) ||
    value.tokenAddress !== value.identity.tokenAddress ||
    !nullableBoolean(value.isShowAlert) ||
    !nullableBoolean(value.isOpenSource) ||
    !nullableBoolean(value.isBlacklisted) ||
    !nullableBoolean(value.isHoneypot) ||
    !nullableBoolean(value.isOwnerRenounced) ||
    !nullableBoolean(value.isMintRenounced) ||
    !nullableBoolean(value.isFreezeAccountRenounced) ||
    !nullableBoolean(value.isWashTrading) ||
    !nullableRatio(value.top10HolderRatio) ||
    !nullableRatio(value.developerTeamHoldRatio) ||
    !nullableRatio(value.creatorBalanceRatio) ||
    !nullableRatio(value.suspectedInsiderHoldRatio) ||
    !nullableRatio(value.rugRatio) ||
    !nullableRatio(value.ratTraderAmountRatio) ||
    !nullableRatio(value.bundlerTraderAmountRatio) ||
    !nullableRatio(value.buyTaxRatio) ||
    !nullableRatio(value.sellTaxRatio) ||
    !nullableRatio(value.averageTaxRatio) ||
    !nullableRatio(value.highTaxRatio) ||
    !nullableRatio(value.burnRatio) ||
    !nullableDecimal(value.developerTokenBurnAmount) ||
    !nullableRatio(value.developerTokenBurnRatio) ||
    !nullableBoundedString(value.burnStatus, 128) ||
    !nullableBoundedString(value.creatorTokenStatus, 128) ||
    !nullableUnsignedSafeInteger(value.sniperCount) ||
    !nullableUnsignedSafeInteger(value.canSellCount) ||
    !nullableUnsignedSafeInteger(value.cannotSellCount) ||
    !nullableBoolean(value.hideRisk) ||
    !boundedStringArray(value.flags, 64, 128)
  ) return false;
  return value.lockSummary === null || isSecurityLockSummary(value.lockSummary);
}

export function isGmgnTokenPoolInfoV1(
  value: unknown,
): value is GmgnTokenPoolInfoV1 {
  if (!isRecord(value) || !isMarketChartIdentityV1(value.identity)) {
    return false;
  }
  const pair = [value.token0Address, value.token1Address];
  return value.schemaVersion === PROGRAMMABLE_GMGN_TOKEN_POOL_INFO_SCHEMA_VERSION &&
    value.source === "gmgn" &&
    value.currency === "USD" &&
    exactIsoTime(value.fetchedAt) &&
    value.tokenAddress === value.identity.tokenAddress &&
    value.baseAddress === value.identity.tokenAddress &&
    value.poolAddress === value.identity.poolId &&
    value.quoteAddress === value.identity.quoteAddress &&
    canonicalAddress(value.tokenAddress) &&
    canonicalBytes32(value.poolAddress) &&
    canonicalAddress(value.baseAddress) &&
    canonicalAddress(value.quoteAddress) &&
    pair.every(canonicalAddress) &&
    new Set(pair).size === 2 &&
    pair.includes(value.identity.tokenAddress) &&
    pair.includes(value.identity.quoteAddress) &&
    value.exchange === "uniswap_v4" &&
    nullableBoundedString(value.quoteSymbol, 64) &&
    exactNonNegativeDecimal(value.liquidityUsd) &&
    exactNonNegativeDecimal(value.baseReserve) &&
    exactNonNegativeDecimal(value.quoteReserve) &&
    nullableDecimal(value.baseReserveValueUsd) &&
    nullableDecimal(value.quoteReserveValueUsd) &&
    nullableDecimal(value.initialLiquidityUsd) &&
    nullableDecimal(value.initialBaseReserve) &&
    nullableDecimal(value.initialQuoteReserve) &&
    nullableDecimal(value.priceUsd) &&
    nullableRatio(value.feeRatio) &&
    unsignedSafeInteger(value.creationTimestamp);
}

export function isGmgnTokenWalletRankingV1(
  value: unknown,
): value is GmgnTokenWalletRankingV1 {
  if (!isRecord(value) || !isMarketChartIdentityV1(value.identity)) {
    return false;
  }
  return value.schemaVersion ===
      PROGRAMMABLE_GMGN_TOKEN_WALLET_RANKING_SCHEMA_VERSION &&
    value.source === "gmgn" &&
    exactIsoTime(value.fetchedAt) &&
    value.tokenAddress === value.identity.tokenAddress &&
    canonicalAddress(value.tokenAddress) &&
    (value.kind === "holders" || value.kind === "traders") &&
    isRankingQuery(value.query) &&
    Array.isArray(value.wallets) &&
    value.wallets.length <= value.query.limit &&
    value.wallets.every(isRankedWallet);
}

function isRankingQuery(value: unknown): value is GmgnTokenRankingQueryV1 {
  if (!isRecord(value)) return false;
  return Number.isSafeInteger(value.limit) &&
    Number(value.limit) >= 1 &&
    Number(value.limit) <= GMGN_TOKEN_RANKING_MAXIMUM_LIMIT &&
    GMGN_TOKEN_RANKING_ORDER_VALUES.includes(
      value.orderBy as GmgnTokenRankingOrderV1,
    ) &&
    (value.direction === "asc" || value.direction === "desc") &&
    (value.tag === null || GMGN_TOKEN_RANKING_TAG_VALUES.includes(
      value.tag as GmgnTokenRankingTagV1,
    ));
}

function isRankedWallet(value: unknown): value is GmgnTokenRankedWalletV1 {
  if (!isRecord(value) || !canonicalAddress(value.address)) return false;
  const nullableNumbers = [
    value.balance,
    value.amount,
    value.usdValue,
    value.amountRatio,
    value.accumulatedAmount,
    value.accumulatedCostUsd,
    value.costUsd,
    value.currentCostUsd,
    value.buyVolumeUsd,
    value.sellVolumeUsd,
    value.buyAmount,
    value.sellAmount,
    value.currentBuyAmount,
    value.currentSellAmount,
    value.sellAmountRatio,
    value.netflowUsd,
    value.netflowAmount,
    value.averageCostUsd,
    value.averageSoldUsd,
    value.historyBoughtCostUsd,
    value.historyBoughtFeeUsd,
    value.historySoldIncomeUsd,
    value.historySoldFeeUsd,
    value.totalCostUsd,
    value.profitUsd,
    value.profitRatio,
    value.realizedProfitUsd,
    value.realizedPnlRatio,
    value.unrealizedProfitUsd,
    value.unrealizedPnlRatio,
    value.currentTransferInAmount,
    value.currentTransferOutAmount,
    value.historyTransferInAmount,
    value.historyTransferInCostUsd,
    value.historyTransferOutAmount,
    value.historyTransferOutIncomeUsd,
    value.historyTransferOutFeeUsd,
  ];
  const nullableIntegers = [
    value.addressType,
    value.buyTransactionCount,
    value.sellTransactionCount,
    value.transferInCount,
    value.transferOutCount,
    value.startHoldingAt,
    value.endHoldingAt,
    value.lastActiveTimestamp,
    value.lastBlock,
    value.createdAt,
  ];
  return (value.accountAddress === null || canonicalAddress(value.accountAddress)) &&
    nullableIntegers.every(nullableUnsignedSafeInteger) &&
    nullableBoundedString(value.exchange, 128) &&
    nullableBoundedString(value.walletRank, 64) &&
    (value.nativeBalanceRaw === null || unsignedInteger(value.nativeBalanceRaw)) &&
    nullableNumbers.every(nullableFiniteNumber) &&
    nullableBoolean(value.isOnCurve) &&
    nullableBoolean(value.isNew) &&
    nullableBoolean(value.isSuspicious) &&
    nullableBoolean(value.transferIn) &&
    nullableBoundedString(value.name, 512) &&
    nullableBoundedString(value.twitterUsername, 256) &&
    nullableBoundedString(value.twitterName, 512) &&
    nullableBoundedString(value.avatar, 2_048) &&
    boundedStringArray(value.tags, 64, 128) &&
    boundedStringArray(value.makerTokenTags, 64, 128) &&
    (value.nativeTransfer === null || isNativeTransfer(value.nativeTransfer)) &&
    (value.tokenTransfer === null || isWalletTransfer(value.tokenTransfer)) &&
    (value.tokenTransferIn === null || isWalletTransfer(value.tokenTransferIn)) &&
    (value.tokenTransferOut === null || isWalletTransfer(value.tokenTransferOut));
}

function isNativeTransfer(
  value: unknown,
): value is GmgnTokenWalletNativeTransferV1 {
  if (!isRecord(value)) return false;
  return nullableBoundedString(value.name, 512) &&
    (value.fromAddress === null || canonicalAddress(value.fromAddress)) &&
    (value.amount === null || exactNonNegativeDecimal(value.amount)) &&
    nullableUnsignedSafeInteger(value.timestamp) &&
    (value.transactionHash === null || canonicalBytes32(value.transactionHash));
}

function isWalletTransfer(
  value: unknown,
): value is GmgnTokenWalletTransferV1 {
  if (!isRecord(value)) return false;
  return nullableBoundedString(value.name, 512) &&
    (value.address === null || canonicalAddress(value.address)) &&
    nullableUnsignedSafeInteger(value.timestamp) &&
    (value.transactionHash === null || canonicalBytes32(value.transactionHash)) &&
    nullableBoundedString(value.type, 128);
}

function isSecurityLockSummary(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.isLocked === "boolean" &&
    isRatio(value.lockRatio) &&
    isRatio(value.remainingLockRatio) &&
    Array.isArray(value.details) &&
    value.details.length <= 256 &&
    value.details.every((detail) =>
      isRecord(detail) &&
      isRatio(detail.ratio) &&
      canonicalAddress(detail.poolAddress) &&
      typeof detail.isBlackhole === "boolean"
    );
}

function canonicalAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" &&
    ADDRESS.test(value) &&
    value === value.toLowerCase();
}

function canonicalBytes32(value: unknown): value is `0x${string}` {
  return typeof value === "string" &&
    BYTES32.test(value) &&
    value === value.toLowerCase();
}

function exactIsoTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function exactNonNegativeDecimal(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 160 &&
    NON_NEGATIVE_DECIMAL.test(value);
}

function nullableDecimal(value: unknown): value is string | null {
  return value === null || exactNonNegativeDecimal(value);
}

function isRatio(value: unknown): value is string {
  if (!exactNonNegativeDecimal(value)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1;
}

function nullableRatio(value: unknown): value is string | null {
  return value === null || isRatio(value);
}

function unsignedInteger(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= 160 &&
    UNSIGNED_INTEGER.test(value);
}

function unsignedSafeInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function nullableUnsignedSafeInteger(value: unknown): value is number | null {
  return value === null || unsignedSafeInteger(value);
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null ||
    (typeof value === "number" && Number.isFinite(value));
}

function nullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function nullableBoundedString(
  value: unknown,
  maximumLength: number,
): value is string | null {
  return value === null ||
    (typeof value === "string" && value.length <= maximumLength);
}

function boundedStringArray(
  value: unknown,
  maximumEntries: number,
  maximumLength: number,
): value is readonly string[] {
  return Array.isArray(value) &&
    value.length <= maximumEntries &&
    value.every((entry) =>
      typeof entry === "string" && entry.length <= maximumLength
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
