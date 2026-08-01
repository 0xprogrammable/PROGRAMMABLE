import type { CanonicalJsonValue } from "./canonical-fingerprint";
import { validationError } from "./errors";
import {
  RECONCILER_ROUTE_KEYS,
  type ReconcilerRouteDto,
} from "./reconciler-preparity";

export const CLASSIC_V3_RECONCILER_ROUTE_CONTRACT =
  "classic-v3-route-corpus-v1" as const;

type JsonRecord = Record<string, CanonicalJsonValue>;

export type ClassicV3ReconcilerRouteParts = Readonly<{
  tokens: readonly CanonicalJsonValue[];
  charts: readonly CanonicalJsonValue[];
  profiles: readonly CanonicalJsonValue[];
  rewards: readonly CanonicalJsonValue[];
  launches: readonly CanonicalJsonValue[];
}>;

function fail(operation: string): never {
  throw validationError("postgres", operation);
}

function object(value: CanonicalJsonValue, operation: string): JsonRecord {
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

function integerText(value: CanonicalJsonValue, operation: string): string {
  const parsed = text(value, operation);
  if (!/^(?:0|[1-9][0-9]{0,77})$/u.test(parsed)) fail(operation);
  return parsed;
}

function timestamp(value: CanonicalJsonValue, operation: string): string {
  const parsed = text(value, operation);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed)) {
    fail(operation);
  }
  return parsed;
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

function array(
  value: CanonicalJsonValue,
  operation: string,
): readonly CanonicalJsonValue[] {
  if (!Array.isArray(value)) fail(operation);
  return value;
}

function token(value: CanonicalJsonValue): JsonRecord {
  const row = object(value, "reconciler-route-token");
  exactKeys(row, [
    "tokenAddress",
    "creatorAddress",
    "launchTransactionHash",
    "launchBlockNumber",
    "launchTransactionIndex",
    "launchLogIndex",
    "launchedAt",
    "poolId",
    "hookAddress",
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
  ], "reconciler-route-token-fields");
  hex(row.tokenAddress, 20, "reconciler-route-token-address");
  hex(row.creatorAddress, 20, "reconciler-route-token-creator");
  hex(row.launchTransactionHash, 32, "reconciler-route-token-transaction");
  integerText(row.launchBlockNumber, "reconciler-route-token-block");
  integer(row.launchTransactionIndex, 0, Number.MAX_SAFE_INTEGER,
    "reconciler-route-token-transaction-index");
  integer(row.launchLogIndex, 0, Number.MAX_SAFE_INTEGER,
    "reconciler-route-token-log-index");
  timestamp(row.launchedAt, "reconciler-route-token-timestamp");
  hex(row.poolId, 32, "reconciler-route-token-pool");
  hex(row.hookAddress, 20, "reconciler-route-token-hook");
  hex(row.rewardVaultAddress, 20, "reconciler-route-token-vault");
  hex(row.positionRecipient, 20, "reconciler-route-token-recipient");
  integerText(row.positionTokenId, "reconciler-route-token-position");
  hex(row.launchHash, 32, "reconciler-route-token-launch-hash");
  text(row.name, "reconciler-route-token-name");
  text(row.symbol, "reconciler-route-token-symbol");
  integer(row.decimals, 0, 255, "reconciler-route-token-decimals");
  integerText(row.totalSupplyRaw, "reconciler-route-token-supply");

  const fees = object(row.fees, "reconciler-route-token-fees");
  exactKeys(fees, [
    "buySwapFeeBps",
    "sellSwapFeeBps",
    "buyCreatorFeeBps",
    "sellCreatorFeeBps",
    "launcherFeeBps",
    "transferTaxBps",
    "lpFeePips",
  ], "reconciler-route-token-fee-fields");
  integer(fees.buySwapFeeBps, 0, 10_000, "reconciler-route-token-buy-fee");
  integer(fees.sellSwapFeeBps, 0, 10_000, "reconciler-route-token-sell-fee");
  integer(fees.buyCreatorFeeBps, 0, 10_000,
    "reconciler-route-token-buy-creator-fee");
  integer(fees.sellCreatorFeeBps, 0, 10_000,
    "reconciler-route-token-sell-creator-fee");
  integer(fees.launcherFeeBps, 0, 10_000,
    "reconciler-route-token-launcher-fee");
  integer(fees.transferTaxBps, 0, 10_000,
    "reconciler-route-token-transfer-tax");
  integer(fees.lpFeePips, 0, 1_000_000,
    "reconciler-route-token-lp-fee");

  const liquidity = object(row.liquidity, "reconciler-route-token-liquidity");
  exactKeys(liquidity, [
    "tokenLiquidityAmountRaw",
    "lockedTokenDustRaw",
    "initialTick",
    "tickLower",
    "tickUpper",
  ], "reconciler-route-token-liquidity-fields");
  integerText(liquidity.tokenLiquidityAmountRaw,
    "reconciler-route-token-liquidity-amount");
  integerText(liquidity.lockedTokenDustRaw,
    "reconciler-route-token-locked-dust");
  integer(liquidity.initialTick, -887_272, 887_272,
    "reconciler-route-token-initial-tick");
  integer(liquidity.tickLower, -887_272, 887_272,
    "reconciler-route-token-lower-tick");
  integer(liquidity.tickUpper, -887_272, 887_272,
    "reconciler-route-token-upper-tick");
  return row;
}

function chart(value: CanonicalJsonValue): JsonRecord {
  const row = object(value, "reconciler-route-chart");
  exactKeys(row, ["tokenAddress", "poolId", "state", "volume"],
    "reconciler-route-chart-fields");
  hex(row.tokenAddress, 20, "reconciler-route-chart-token");
  hex(row.poolId, 32, "reconciler-route-chart-pool");
  const state = object(row.state, "reconciler-route-chart-state");
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
  ], "reconciler-route-chart-state-fields");
  integerText(state.blockNumber, "reconciler-route-chart-block");
  hex(state.blockHash, 32, "reconciler-route-chart-block-hash");
  hex(state.transactionHash, 32, "reconciler-route-chart-transaction");
  integer(state.transactionIndex, 0, Number.MAX_SAFE_INTEGER,
    "reconciler-route-chart-transaction-index");
  integer(state.logIndex, 0, Number.MAX_SAFE_INTEGER,
    "reconciler-route-chart-log-index");
  integerText(state.sqrtPriceX96, "reconciler-route-chart-price");
  integerText(state.liquidity, "reconciler-route-chart-liquidity");
  integer(state.tick, -887_272, 887_272, "reconciler-route-chart-tick");
  integer(state.lpFeePips, 0, 1_000_000, "reconciler-route-chart-lp-fee");
  const volume = object(row.volume, "reconciler-route-chart-volume");
  exactKeys(volume, ["grossNativeWei", "creatorFeeWei", "launcherFeeWei"],
    "reconciler-route-chart-volume-fields");
  integerText(volume.grossNativeWei, "reconciler-route-chart-gross");
  integerText(volume.creatorFeeWei, "reconciler-route-chart-creator-fee");
  integerText(volume.launcherFeeWei, "reconciler-route-chart-launcher-fee");
  return row;
}

function tokenReference(value: CanonicalJsonValue): JsonRecord {
  const row = object(value, "reconciler-route-token-reference");
  exactKeys(row, ["tokenAddress", "launchTransactionHash"],
    "reconciler-route-token-reference-fields");
  hex(row.tokenAddress, 20, "reconciler-route-token-reference-address");
  hex(row.launchTransactionHash, 32,
    "reconciler-route-token-reference-transaction");
  return row;
}

function profile(value: CanonicalJsonValue): JsonRecord {
  const row = object(value, "reconciler-route-profile");
  exactKeys(row, ["account", "tokens"], "reconciler-route-profile-fields");
  hex(row.account, 20, "reconciler-route-profile-account");
  array(row.tokens, "reconciler-route-profile-tokens").forEach(tokenReference);
  return row;
}

function reward(value: CanonicalJsonValue): JsonRecord {
  const row = object(value, "reconciler-route-reward");
  exactKeys(row, [
    "vaultAddress",
    "poolId",
    "tokenAddress",
    "tokenName",
    "tokenSymbol",
    "launchTransactionHash",
    "buySwapFeeBps",
    "sellSwapFeeBps",
    "launcherFeeBps",
    "allocations",
  ], "reconciler-route-reward-fields");
  hex(row.vaultAddress, 20, "reconciler-route-reward-vault");
  hex(row.poolId, 32, "reconciler-route-reward-pool");
  hex(row.tokenAddress, 20, "reconciler-route-reward-token");
  text(row.tokenName, "reconciler-route-reward-name");
  text(row.tokenSymbol, "reconciler-route-reward-symbol");
  hex(row.launchTransactionHash, 32,
    "reconciler-route-reward-transaction");
  integer(row.buySwapFeeBps, 0, 10_000,
    "reconciler-route-reward-buy-fee");
  integer(row.sellSwapFeeBps, 0, 10_000,
    "reconciler-route-reward-sell-fee");
  integer(row.launcherFeeBps, 0, 10_000,
    "reconciler-route-reward-launcher-fee");
  const allocations = array(row.allocations,
    "reconciler-route-reward-allocations");
  if (allocations.length < 1 || allocations.length > 5) {
    fail("reconciler-route-reward-allocation-count");
  }
  let shareTotal = 0;
  allocations.forEach((allocation, index) => {
    const item = object(allocation, "reconciler-route-reward-allocation");
    exactKeys(item, [
      "allocationIndex",
      "payoutAddress",
      "shareBps",
      "claimableWei",
      "claimedWei",
    ], "reconciler-route-reward-allocation-fields");
    if (integer(item.allocationIndex, 0, 4,
      "reconciler-route-reward-allocation-index") !== index) {
      fail("reconciler-route-reward-allocation-order");
    }
    hex(item.payoutAddress, 20,
      "reconciler-route-reward-payout-address");
    shareTotal += integer(item.shareBps, 1, 10_000,
      "reconciler-route-reward-share");
    integerText(item.claimableWei, "reconciler-route-reward-claimable");
    integerText(item.claimedWei, "reconciler-route-reward-claimed");
  });
  if (shareTotal !== 10_000) fail("reconciler-route-reward-share-total");
  return row;
}

function lookup(value: CanonicalJsonValue): JsonRecord {
  const row = object(value, "reconciler-route-lookup");
  exactKeys(row, ["account", "launchTransactionHash", "tokenAddress"],
    "reconciler-route-lookup-fields");
  hex(row.account, 20, "reconciler-route-lookup-account");
  hex(row.launchTransactionHash, 32,
    "reconciler-route-lookup-transaction");
  hex(row.tokenAddress, 20, "reconciler-route-lookup-token");
  return row;
}

export function assembleClassicV3ReconcilerRoutes(
  parts: ClassicV3ReconcilerRouteParts,
): readonly ReconcilerRouteDto[] {
  const count = parts.tokens.length;
  if (
    count < 1 ||
    parts.charts.length !== count ||
    parts.rewards.length !== count ||
    parts.launches.length !== count
  ) {
    fail("reconciler-route-part-cardinality");
  }
  return Object.freeze([
    Object.freeze({
      routeKey: "explore-list",
      comparedCount: count,
      dto: {
        contractVersion: CLASSIC_V3_RECONCILER_ROUTE_CONTRACT,
        tokens: [...parts.tokens],
      },
    }),
    Object.freeze({
      routeKey: "explore-token",
      comparedCount: count,
      dto: {
        contractVersion: CLASSIC_V3_RECONCILER_ROUTE_CONTRACT,
        tokens: [...parts.tokens],
      },
    }),
    Object.freeze({
      routeKey: "explore-chart",
      comparedCount: count,
      dto: {
        contractVersion: CLASSIC_V3_RECONCILER_ROUTE_CONTRACT,
        charts: [...parts.charts],
      },
    }),
    Object.freeze({
      routeKey: "creator-profile",
      comparedCount: count,
      dto: {
        contractVersion: CLASSIC_V3_RECONCILER_ROUTE_CONTRACT,
        profiles: [...parts.profiles],
      },
    }),
    Object.freeze({
      routeKey: "classic-v3-profile",
      comparedCount: count,
      dto: {
        contractVersion: CLASSIC_V3_RECONCILER_ROUTE_CONTRACT,
        rewards: [...parts.rewards],
      },
    }),
    Object.freeze({
      routeKey: "launch-lookup",
      comparedCount: count,
      dto: {
        contractVersion: CLASSIC_V3_RECONCILER_ROUTE_CONTRACT,
        launches: [...parts.launches],
      },
    }),
  ] satisfies ReconcilerRouteDto[]);
}

export function assertClassicV3ReconcilerRouteSet(
  routes: readonly ReconcilerRouteDto[],
): readonly ReconcilerRouteDto[] {
  if (
    routes.length !== RECONCILER_ROUTE_KEYS.length ||
    routes.some((route, index) =>
      route.routeKey !== RECONCILER_ROUTE_KEYS[index] ||
      !Number.isSafeInteger(route.comparedCount) ||
      route.comparedCount < 1
    )
  ) {
    fail("reconciler-route-set");
  }
  const documents = routes.map((route) => {
    const document = object(route.dto, "reconciler-route-document");
    const collectionKey = route.routeKey === "explore-chart"
      ? "charts"
      : route.routeKey === "creator-profile"
        ? "profiles"
        : route.routeKey === "classic-v3-profile"
          ? "rewards"
          : route.routeKey === "launch-lookup"
            ? "launches"
            : "tokens";
    exactKeys(document, ["contractVersion", collectionKey],
      "reconciler-route-document-fields");
    if (document.contractVersion !== CLASSIC_V3_RECONCILER_ROUTE_CONTRACT) {
      fail("reconciler-route-contract-version");
    }
    const collection = array(document[collectionKey],
      "reconciler-route-collection");
    if (
      route.routeKey !== "creator-profile" &&
      collection.length !== route.comparedCount
    ) {
      fail("reconciler-route-collection-cardinality");
    }
    if (route.routeKey === "explore-list" || route.routeKey === "explore-token") {
      collection.forEach(token);
    } else if (route.routeKey === "explore-chart") {
      collection.forEach(chart);
    } else if (route.routeKey === "creator-profile") {
      collection.forEach(profile);
      let profileTokenCount = 0;
      for (const entry of collection) {
        profileTokenCount += array(
          object(entry, "reconciler-route-profile-count").tokens,
          "reconciler-route-profile-count-tokens",
        ).length;
      }
      if (profileTokenCount !== route.comparedCount) {
        fail("reconciler-route-profile-cardinality");
      }
    } else if (route.routeKey === "classic-v3-profile") {
      collection.forEach(reward);
    } else {
      collection.forEach(lookup);
    }
    return collection;
  });
  if (
    routes.some((route) => route.comparedCount !== routes[0]!.comparedCount) ||
    JSON.stringify(documents[0]) !== JSON.stringify(documents[1])
  ) {
    fail("reconciler-route-cross-contract");
  }
  return routes;
}
