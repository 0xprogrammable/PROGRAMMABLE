import type { CanonicalJsonValue } from "./canonical-fingerprint";
import { validationError } from "./errors";

export const STOCK_PAIRED_RECONCILER_CONTRIBUTION_CONTRACT =
  "stock-paired-route-contribution-v1" as const;

export type StockPairedReconcilerRelease =
  | "stock-paired-v1"
  | "stock-paired-v2"
  | "stock-paired-v3";

export type StockPairedReconcilerContribution = Readonly<{
  contractVersion: typeof STOCK_PAIRED_RECONCILER_CONTRIBUTION_CONTRACT;
  releaseVersion: StockPairedReconcilerRelease;
  modelId: "stock-paired";
  tokens: readonly CanonicalJsonValue[];
  charts: readonly CanonicalJsonValue[];
  profiles: readonly CanonicalJsonValue[];
  launches: readonly CanonicalJsonValue[];
}>;

type JsonRecord = Record<string, CanonicalJsonValue>;

function fail(operation: string): never {
  throw validationError("postgres", operation);
}

function record(value: CanonicalJsonValue, operation: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(operation);
  }
  return value as JsonRecord;
}

function exactKeys(
  value: JsonRecord,
  keys: readonly string[],
  operation: string,
): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    fail(operation);
  }
}

function text(value: CanonicalJsonValue, operation: string): string {
  if (typeof value !== "string") fail(operation);
  return value;
}

function integerText(value: CanonicalJsonValue, operation: string): string {
  const parsed = text(value, operation);
  if (!/^(?:0|[1-9][0-9]{0,77})$/u.test(parsed)) fail(operation);
  return parsed;
}

function integer(
  value: CanonicalJsonValue,
  minimum: number,
  maximum: number,
  operation: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(operation);
  }
  return value;
}

function hex(
  value: CanonicalJsonValue,
  bytes: number,
  operation: string,
): string {
  const parsed = text(value, operation);
  if (!new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`, "u").test(parsed)) {
    fail(operation);
  }
  return parsed;
}

function timestamp(value: CanonicalJsonValue, operation: string): string {
  const parsed = text(value, operation);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed)) {
    fail(operation);
  }
  return parsed;
}

function array(
  value: CanonicalJsonValue,
  operation: string,
): readonly CanonicalJsonValue[] {
  if (!Array.isArray(value)) fail(operation);
  return value;
}

function assertIdentity(
  row: JsonRecord,
  releaseVersion: StockPairedReconcilerRelease,
  operation: string,
): void {
  if (
    row.releaseVersion !== releaseVersion ||
    row.modelId !== "stock-paired"
  ) {
    fail(operation);
  }
}

function token(
  value: CanonicalJsonValue,
  releaseVersion: StockPairedReconcilerRelease,
): JsonRecord {
  const row = record(value, "stock-reconciler-token");
  exactKeys(row, [
    "releaseVersion",
    "modelId",
    "tokenAddress",
    "creatorAddress",
    "launchTransactionHash",
    "launchBlockNumber",
    "launchTransactionIndex",
    "launchLogIndex",
    "launchedAt",
    "poolId",
    "hookAddress",
    "quoteAssetAddress",
    "rewardVaultAddress",
    "positionRecipient",
    "positionTokenId",
    "launchHash",
    "name",
    "symbol",
    "decimals",
    "totalSupplyRaw",
    "fees",
    "liquidity",
  ], "stock-reconciler-token-fields");
  assertIdentity(row, releaseVersion, "stock-reconciler-token-identity");
  hex(row.tokenAddress, 20, "stock-reconciler-token-address");
  hex(row.creatorAddress, 20, "stock-reconciler-token-creator");
  hex(row.launchTransactionHash, 32, "stock-reconciler-token-transaction");
  integerText(row.launchBlockNumber, "stock-reconciler-token-block");
  integer(row.launchTransactionIndex, 0, Number.MAX_SAFE_INTEGER,
    "stock-reconciler-token-transaction-index");
  integer(row.launchLogIndex, 0, Number.MAX_SAFE_INTEGER,
    "stock-reconciler-token-log-index");
  timestamp(row.launchedAt, "stock-reconciler-token-time");
  hex(row.poolId, 32, "stock-reconciler-token-pool");
  hex(row.hookAddress, 20, "stock-reconciler-token-hook");
  hex(row.quoteAssetAddress, 20, "stock-reconciler-token-quote");
  hex(row.rewardVaultAddress, 20, "stock-reconciler-token-vault");
  hex(row.positionRecipient, 20, "stock-reconciler-token-recipient");
  integerText(row.positionTokenId, "stock-reconciler-token-position");
  hex(row.launchHash, 32, "stock-reconciler-token-launch-hash");
  text(row.name, "stock-reconciler-token-name");
  text(row.symbol, "stock-reconciler-token-symbol");
  integer(row.decimals, 0, 255, "stock-reconciler-token-decimals");
  integerText(row.totalSupplyRaw, "stock-reconciler-token-supply");

  const fees = record(row.fees, "stock-reconciler-token-fees");
  exactKeys(fees, [
    "buySwapFeeBps",
    "sellSwapFeeBps",
    "buyCreatorFeeBps",
    "sellCreatorFeeBps",
    "launcherFeeBps",
    "transferTaxBps",
    "lpFeePips",
  ], "stock-reconciler-token-fee-fields");
  integer(fees.buySwapFeeBps, 0, 10_000, "stock-reconciler-buy-fee");
  integer(fees.sellSwapFeeBps, 0, 10_000, "stock-reconciler-sell-fee");
  integer(fees.buyCreatorFeeBps, 0, 10_000,
    "stock-reconciler-buy-creator-fee");
  integer(fees.sellCreatorFeeBps, 0, 10_000,
    "stock-reconciler-sell-creator-fee");
  integer(fees.launcherFeeBps, 0, 10_000,
    "stock-reconciler-launcher-fee");
  integer(fees.transferTaxBps, 0, 10_000,
    "stock-reconciler-transfer-tax");
  integer(fees.lpFeePips, 0, 1_000_000,
    "stock-reconciler-lp-fee");

  const liquidity = record(row.liquidity, "stock-reconciler-liquidity");
  exactKeys(liquidity, [
    "tokenLiquidityAmountRaw",
    "lockedTokenDustRaw",
    "initialTick",
    "tickLower",
    "tickUpper",
  ], "stock-reconciler-liquidity-fields");
  integerText(liquidity.tokenLiquidityAmountRaw,
    "stock-reconciler-token-liquidity");
  integerText(liquidity.lockedTokenDustRaw,
    "stock-reconciler-locked-dust");
  integer(liquidity.initialTick, -887_272, 887_272,
    "stock-reconciler-initial-tick");
  integer(liquidity.tickLower, -887_272, 887_272,
    "stock-reconciler-lower-tick");
  integer(liquidity.tickUpper, -887_272, 887_272,
    "stock-reconciler-upper-tick");
  return row;
}

function chart(
  value: CanonicalJsonValue,
  releaseVersion: StockPairedReconcilerRelease,
): JsonRecord {
  const row = record(value, "stock-reconciler-chart");
  exactKeys(row, [
    "releaseVersion",
    "modelId",
    "tokenAddress",
    "poolId",
    "quoteAssetAddress",
    "state",
    "volume",
  ], "stock-reconciler-chart-fields");
  assertIdentity(row, releaseVersion, "stock-reconciler-chart-identity");
  hex(row.tokenAddress, 20, "stock-reconciler-chart-token");
  hex(row.poolId, 32, "stock-reconciler-chart-pool");
  const quoteAssetAddress = hex(
    row.quoteAssetAddress,
    20,
    "stock-reconciler-chart-quote",
  );
  const state = record(row.state, "stock-reconciler-chart-state");
  exactKeys(state, [
    "blockNumber",
    "blockHash",
    "transactionHash",
    "transactionIndex",
    "logIndex",
    "sqrtPriceX96",
    "liquidity",
    "tick",
    "lpFeePips",
  ], "stock-reconciler-chart-state-fields");
  integerText(state.blockNumber, "stock-reconciler-chart-block");
  hex(state.blockHash, 32, "stock-reconciler-chart-block-hash");
  hex(state.transactionHash, 32, "stock-reconciler-chart-transaction");
  integer(state.transactionIndex, 0, Number.MAX_SAFE_INTEGER,
    "stock-reconciler-chart-transaction-index");
  integer(state.logIndex, 0, Number.MAX_SAFE_INTEGER,
    "stock-reconciler-chart-log-index");
  integerText(state.sqrtPriceX96, "stock-reconciler-chart-price");
  integerText(state.liquidity, "stock-reconciler-chart-liquidity");
  integer(state.tick, -887_272, 887_272, "stock-reconciler-chart-tick");
  integer(state.lpFeePips, 0, 1_000_000,
    "stock-reconciler-chart-lp-fee");
  const volume = record(row.volume, "stock-reconciler-chart-volume");
  exactKeys(volume, [
    "quoteAssetAddress",
    "grossQuoteRaw",
    "creatorFeeQuoteRaw",
    "launcherFeeQuoteRaw",
  ], "stock-reconciler-chart-volume-fields");
  if (
    hex(volume.quoteAssetAddress, 20, "stock-reconciler-volume-quote") !==
      quoteAssetAddress
  ) {
    fail("stock-reconciler-volume-quote-mismatch");
  }
  integerText(volume.grossQuoteRaw, "stock-reconciler-chart-gross");
  integerText(volume.creatorFeeQuoteRaw,
    "stock-reconciler-chart-creator-fee");
  integerText(volume.launcherFeeQuoteRaw,
    "stock-reconciler-chart-launcher-fee");
  return row;
}

function tokenReference(
  value: CanonicalJsonValue,
  releaseVersion: StockPairedReconcilerRelease,
): JsonRecord {
  const row = record(value, "stock-reconciler-token-reference");
  exactKeys(row, [
    "releaseVersion",
    "modelId",
    "tokenAddress",
    "launchTransactionHash",
  ], "stock-reconciler-token-reference-fields");
  assertIdentity(row, releaseVersion,
    "stock-reconciler-token-reference-identity");
  hex(row.tokenAddress, 20, "stock-reconciler-token-reference-address");
  hex(row.launchTransactionHash, 32,
    "stock-reconciler-token-reference-transaction");
  return row;
}

function profile(
  value: CanonicalJsonValue,
  releaseVersion: StockPairedReconcilerRelease,
): JsonRecord {
  const row = record(value, "stock-reconciler-profile");
  exactKeys(row, ["account", "tokens"], "stock-reconciler-profile-fields");
  hex(row.account, 20, "stock-reconciler-profile-account");
  array(row.tokens, "stock-reconciler-profile-tokens").forEach((entry) =>
    tokenReference(entry, releaseVersion));
  return row;
}

function lookup(
  value: CanonicalJsonValue,
  releaseVersion: StockPairedReconcilerRelease,
): JsonRecord {
  const row = record(value, "stock-reconciler-lookup");
  exactKeys(row, [
    "releaseVersion",
    "modelId",
    "account",
    "launchTransactionHash",
    "tokenAddress",
  ], "stock-reconciler-lookup-fields");
  assertIdentity(row, releaseVersion, "stock-reconciler-lookup-identity");
  hex(row.account, 20, "stock-reconciler-lookup-account");
  hex(row.launchTransactionHash, 32,
    "stock-reconciler-lookup-transaction");
  hex(row.tokenAddress, 20, "stock-reconciler-lookup-token");
  return row;
}

export function assertStockPairedReconcilerContribution(
  contribution: StockPairedReconcilerContribution,
): StockPairedReconcilerContribution {
  const count = contribution.tokens.length;
  if (
    contribution.contractVersion !==
      STOCK_PAIRED_RECONCILER_CONTRIBUTION_CONTRACT ||
    contribution.modelId !== "stock-paired" ||
    !["stock-paired-v1", "stock-paired-v2", "stock-paired-v3"].includes(
      contribution.releaseVersion,
    ) ||
    count < 1 ||
    contribution.charts.length !== count ||
    contribution.launches.length !== count
  ) {
    fail("stock-reconciler-contribution-cardinality");
  }
  const tokens = contribution.tokens.map((entry) =>
    token(entry, contribution.releaseVersion));
  const charts = contribution.charts.map((entry) =>
    chart(entry, contribution.releaseVersion));
  const launches = contribution.launches.map((entry) =>
    lookup(entry, contribution.releaseVersion));
  const profiles = contribution.profiles.map((entry) =>
    profile(entry, contribution.releaseVersion));
  const profileCount = contribution.profiles.reduce(
    (sum: number, entry) => sum + array(
      record(entry, "stock-reconciler-profile-count").tokens,
      "stock-reconciler-profile-count-tokens",
    ).length,
    0,
  );
  if (profileCount !== count) {
    fail("stock-reconciler-profile-cardinality");
  }
  const tokenAddresses = new Set<string>();
  const poolIds = new Set<string>();
  const transactionHashes = new Set<string>();
  const profiledTokens = new Set<string>();
  const profileAccounts = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const currentToken = tokens[index]!;
    const currentChart = charts[index]!;
    const currentLaunch = launches[index]!;
    if (
      tokenAddresses.has(currentToken.tokenAddress as string) ||
      poolIds.has(currentToken.poolId as string) ||
      transactionHashes.has(currentToken.launchTransactionHash as string) ||
      currentToken.tokenAddress !== currentChart.tokenAddress ||
      currentToken.poolId !== currentChart.poolId ||
      currentToken.quoteAssetAddress !== currentChart.quoteAssetAddress ||
      currentToken.tokenAddress !== currentLaunch.tokenAddress ||
      currentToken.launchTransactionHash !==
        currentLaunch.launchTransactionHash ||
      currentToken.creatorAddress !== currentLaunch.account
    ) {
      fail("stock-reconciler-cross-route-identity");
    }
    tokenAddresses.add(currentToken.tokenAddress as string);
    poolIds.add(currentToken.poolId as string);
    transactionHashes.add(currentToken.launchTransactionHash as string);
  }
  const tokensByAddress = new Map(
    tokens.map((entry) => [entry.tokenAddress as string, entry]),
  );
  for (const currentProfile of profiles) {
    const account = currentProfile.account as string;
    if (profileAccounts.has(account)) {
      fail("stock-reconciler-profile-account-cardinality");
    }
    profileAccounts.add(account);
    const references = currentProfile.tokens as CanonicalJsonValue[];
    for (const reference of references) {
      const currentReference = record(
        reference,
        "stock-reconciler-profile-reference",
      );
      const tokenAddress = currentReference.tokenAddress as string;
      const sourceToken = tokensByAddress.get(tokenAddress);
      if (
        !sourceToken ||
        profiledTokens.has(tokenAddress) ||
        sourceToken.creatorAddress !== account ||
        sourceToken.launchTransactionHash !==
          currentReference.launchTransactionHash
      ) {
        fail("stock-reconciler-profile-cross-route-identity");
      }
      profiledTokens.add(tokenAddress);
    }
  }
  if (profiledTokens.size !== count) {
    fail("stock-reconciler-profile-token-cardinality");
  }
  return contribution;
}
