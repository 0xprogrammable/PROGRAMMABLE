import type { CanonicalJsonValue } from "./canonical-fingerprint";
import { validationError } from "./errors";
import {
  RECONCILER_ROUTE_KEYS,
  type ReconcilerRouteDto,
  type ReconcilerRouteKey,
} from "./reconciler-preparity";

export const RECONCILER_ROUTE_CONTRACT =
  "programmable-route-corpus-v1" as const;
export const CLASSIC_V3_RECONCILER_ROUTE_CONTRACT =
  RECONCILER_ROUTE_CONTRACT;

const RELEASE_MODELS = Object.freeze({
  "classic-v2": "classic",
  "classic-v3": "classic",
  "stock-paired-v1": "stock-paired",
  "stock-paired-v2": "stock-paired",
  "stock-paired-v3": "stock-paired",
} as const);

type JsonRecord = Record<string, CanonicalJsonValue>;

export type ClassicV3ReconcilerRouteParts = Readonly<{
  tokens: readonly CanonicalJsonValue[];
  charts: readonly CanonicalJsonValue[];
  profiles: readonly CanonicalJsonValue[];
  rewards: readonly CanonicalJsonValue[];
  launches: readonly CanonicalJsonValue[];
}>;

export type ReconcilerRouteContribution = Readonly<{
  tokens: readonly CanonicalJsonValue[];
  charts: readonly CanonicalJsonValue[];
  rewards?: readonly CanonicalJsonValue[];
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

function releaseIdentity(row: JsonRecord, operation: string): void {
  const releaseVersion = text(row.releaseVersion, `${operation}-release`);
  const modelId = text(row.modelId, `${operation}-model`);
  if (
    !(releaseVersion in RELEASE_MODELS) ||
    RELEASE_MODELS[releaseVersion as keyof typeof RELEASE_MODELS] !== modelId
  ) {
    fail(operation);
  }
}

function releaseVersion(row: JsonRecord): keyof typeof RELEASE_MODELS {
  return row.releaseVersion as keyof typeof RELEASE_MODELS;
}

function token(value: CanonicalJsonValue): JsonRecord {
  const row = object(value, "reconciler-route-token");
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
    "rewardVaultAddress",
    "positionRecipient",
    "positionTokenId",
    "launchHash",
    "name",
    "symbol",
    "decimals",
    "totalSupplyRaw",
    "quoteAssetAddress",
    "fees",
    "liquidity",
  ], "reconciler-route-token-fields");
  releaseIdentity(row, "reconciler-route-token-release");
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
  if (releaseVersion(row) === "classic-v2") {
    if (row.rewardVaultAddress !== null) {
      fail("reconciler-route-token-vault");
    }
  } else {
    hex(row.rewardVaultAddress, 20, "reconciler-route-token-vault");
  }
  hex(row.positionRecipient, 20, "reconciler-route-token-recipient");
  integerText(row.positionTokenId, "reconciler-route-token-position");
  hex(row.launchHash, 32, "reconciler-route-token-launch-hash");
  text(row.name, "reconciler-route-token-name");
  text(row.symbol, "reconciler-route-token-symbol");
  integer(row.decimals, 0, 255, "reconciler-route-token-decimals");
  integerText(row.totalSupplyRaw, "reconciler-route-token-supply");
  const quoteAssetAddress = hex(
    row.quoteAssetAddress,
    20,
    "reconciler-route-token-quote-asset",
  );
  const isNativeQuote = quoteAssetAddress === `0x${"00".repeat(20)}`;
  if ((row.modelId === "classic") !== isNativeQuote) {
    fail("reconciler-route-token-quote-model");
  }

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
  exactKeys(row, [
    "releaseVersion",
    "modelId",
    "tokenAddress",
    "poolId",
    "quoteAssetAddress",
    "state",
    "volume",
  ],
    "reconciler-route-chart-fields");
  releaseIdentity(row, "reconciler-route-chart-release");
  hex(row.tokenAddress, 20, "reconciler-route-chart-token");
  hex(row.poolId, 32, "reconciler-route-chart-pool");
  const quoteAssetAddress = hex(
    row.quoteAssetAddress,
    20,
    "reconciler-route-chart-quote-asset",
  );
  const isNativeQuote = quoteAssetAddress === `0x${"00".repeat(20)}`;
  if ((row.modelId === "classic") !== isNativeQuote) {
    fail("reconciler-route-chart-quote-model");
  }
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
  exactKeys(volume, [
    "quoteAssetAddress",
    "grossQuoteRaw",
    "creatorFeeQuoteRaw",
    "launcherFeeQuoteRaw",
  ],
    "reconciler-route-chart-volume-fields");
  hex(volume.quoteAssetAddress, 20,
    "reconciler-route-chart-volume-quote-asset");
  if (volume.quoteAssetAddress !== quoteAssetAddress) {
    fail("reconciler-route-chart-volume-quote-asset-mismatch");
  }
  integerText(volume.grossQuoteRaw, "reconciler-route-chart-gross");
  integerText(volume.creatorFeeQuoteRaw,
    "reconciler-route-chart-creator-fee");
  integerText(volume.launcherFeeQuoteRaw,
    "reconciler-route-chart-launcher-fee");
  return row;
}

function tokenReference(value: CanonicalJsonValue): JsonRecord {
  const row = object(value, "reconciler-route-token-reference");
  exactKeys(row, [
    "releaseVersion",
    "modelId",
    "tokenAddress",
    "launchTransactionHash",
  ],
    "reconciler-route-token-reference-fields");
  releaseIdentity(row, "reconciler-route-token-reference-release");
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
    "releaseVersion",
    "modelId",
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
  releaseIdentity(row, "reconciler-route-reward-release");
  if (row.releaseVersion !== "classic-v3" || row.modelId !== "classic") {
    fail("reconciler-route-reward-release");
  }
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
  exactKeys(row, [
    "releaseVersion",
    "modelId",
    "account",
    "launchTransactionHash",
    "tokenAddress",
  ],
    "reconciler-route-lookup-fields");
  releaseIdentity(row, "reconciler-route-lookup-release");
  hex(row.account, 20, "reconciler-route-lookup-account");
  hex(row.launchTransactionHash, 32,
    "reconciler-route-lookup-transaction");
  hex(row.tokenAddress, 20, "reconciler-route-lookup-token");
  return row;
}

function tokenIdentity(row: JsonRecord): string {
  return `${row.releaseVersion}:${row.tokenAddress}`;
}

function compareTokenRows(left: JsonRecord, right: JsonRecord): number {
  const leftBlock = BigInt(left.launchBlockNumber as string);
  const rightBlock = BigInt(right.launchBlockNumber as string);
  if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1;
  const numberFields = ["launchTransactionIndex", "launchLogIndex"] as const;
  for (const field of numberFields) {
    const difference = (left[field] as number) - (right[field] as number);
    if (difference !== 0) return difference;
  }
  return (left.launchTransactionHash as string).localeCompare(
    right.launchTransactionHash as string,
  ) || (left.tokenAddress as string).localeCompare(
    right.tokenAddress as string,
  ) || (left.releaseVersion as string).localeCompare(
    right.releaseVersion as string,
  );
}

export function assembleReconcilerRoutesFromContributions(
  contributions: readonly ReconcilerRouteContribution[],
): readonly ReconcilerRouteDto[] {
  if (!Array.isArray(contributions) || contributions.length < 1) {
    fail("reconciler-route-contributions");
  }
  const tokens = contributions.flatMap((contribution) =>
    [...contribution.tokens]
  );
  const charts = contributions.flatMap((contribution) =>
    [...contribution.charts]
  );
  const rewards = contributions.flatMap((contribution) =>
    [...(contribution.rewards ?? [])]
  );
  if (tokens.length < 1 || charts.length !== tokens.length) {
    fail("reconciler-route-contribution-cardinality");
  }
  tokens.forEach(token);
  charts.forEach(chart);
  rewards.forEach(reward);
  const chartByIdentity = new Map<string, CanonicalJsonValue>();
  for (const entry of charts) {
    const row = object(entry, "reconciler-route-contribution-chart");
    const identity = tokenIdentity(row);
    if (chartByIdentity.has(identity)) {
      fail("reconciler-route-contribution-chart-identity");
    }
    chartByIdentity.set(identity, entry);
  }
  const orderedTokens = [...tokens].sort((left, right) =>
    compareTokenRows(
      object(left, "reconciler-route-contribution-token-order"),
      object(right, "reconciler-route-contribution-token-order"),
    )
  );
  const orderedCharts = orderedTokens.map((entry) => {
    const row = object(entry, "reconciler-route-contribution-token-chart");
    const resolved = chartByIdentity.get(tokenIdentity(row));
    if (!resolved) fail("reconciler-route-contribution-chart-coverage");
    return resolved;
  });
  const profileByAccount = new Map<string, CanonicalJsonValue[]>();
  for (const entry of orderedTokens) {
    const row = object(entry, "reconciler-route-contribution-profile-token");
    const account = row.creatorAddress as string;
    const values = profileByAccount.get(account) ?? [];
    values.push({
      releaseVersion: row.releaseVersion!,
      modelId: row.modelId!,
      tokenAddress: row.tokenAddress!,
      launchTransactionHash: row.launchTransactionHash!,
    });
    profileByAccount.set(account, values);
  }
  const profiles = [...profileByAccount.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([account, profileTokens]) => ({
      account,
      tokens: profileTokens,
    }));
  const orderedRewards = [...rewards].sort((left, right) =>
    (object(left, "reconciler-route-contribution-reward").vaultAddress as string)
      .localeCompare(
        object(right, "reconciler-route-contribution-reward").vaultAddress as string,
      )
  );
  const launches = orderedTokens
    .map((entry) => object(entry, "reconciler-route-contribution-lookup"))
    .filter((row) => row.releaseVersion !== "classic-v2")
    .map((row) => ({
      releaseVersion: row.releaseVersion!,
      modelId: row.modelId!,
      account: row.creatorAddress!,
      launchTransactionHash: row.launchTransactionHash!,
      tokenAddress: row.tokenAddress!,
    }))
    .sort((left, right) =>
      (left.account as string).localeCompare(right.account as string) ||
      (left.launchTransactionHash as string).localeCompare(
        right.launchTransactionHash as string,
      ) ||
      (left.tokenAddress as string).localeCompare(right.tokenAddress as string)
    );
  const classicV3Count = orderedTokens.filter((entry) =>
    object(entry, "reconciler-route-contribution-release").releaseVersion ===
      "classic-v3"
  ).length;
  if (
    orderedRewards.length !== classicV3Count ||
    launches.length !== orderedTokens.length -
      orderedTokens.filter((entry) =>
        object(entry, "reconciler-route-contribution-classic-v2")
          .releaseVersion === "classic-v2"
      ).length
  ) {
    fail("reconciler-route-contribution-release-cardinality");
  }
  const routeKeys: ReconcilerRouteKey[] = [
    "explore-list",
    "explore-token",
    "explore-chart",
    "creator-profile",
  ];
  if (classicV3Count > 0) routeKeys.push("classic-v3-profile");
  if (launches.length > 0) routeKeys.push("launch-lookup");
  return assertReconcilerRouteSetForKeys(
    assembleReconcilerRouteParts({
      tokens: orderedTokens,
      charts: orderedCharts,
      profiles,
      rewards: orderedRewards,
      launches,
    }, routeKeys),
    routeKeys,
  );
}

function assembleReconcilerRouteParts(
  parts: ClassicV3ReconcilerRouteParts,
  routeKeys: readonly ReconcilerRouteKey[],
): readonly ReconcilerRouteDto[] {
  const count = parts.tokens.length;
  if (
    count < 1 ||
    parts.charts.length !== count ||
    parts.rewards.length > count ||
    parts.launches.length > count
  ) {
    fail("reconciler-route-part-cardinality");
  }
  const routes = new Map<ReconcilerRouteKey, ReconcilerRouteDto>([
    ["explore-list", Object.freeze({
      routeKey: "explore-list",
      comparedCount: count,
      dto: {
        contractVersion: RECONCILER_ROUTE_CONTRACT,
        tokens: [...parts.tokens],
      },
    })],
    ["explore-token", Object.freeze({
      routeKey: "explore-token",
      comparedCount: count,
      dto: {
        contractVersion: RECONCILER_ROUTE_CONTRACT,
        tokens: [...parts.tokens],
      },
    })],
    ["explore-chart", Object.freeze({
      routeKey: "explore-chart",
      comparedCount: count,
      dto: {
        contractVersion: RECONCILER_ROUTE_CONTRACT,
        charts: [...parts.charts],
      },
    })],
    ["creator-profile", Object.freeze({
      routeKey: "creator-profile",
      comparedCount: count,
      dto: {
        contractVersion: RECONCILER_ROUTE_CONTRACT,
        profiles: [...parts.profiles],
      },
    })],
    ["classic-v3-profile", Object.freeze({
      routeKey: "classic-v3-profile",
      comparedCount: parts.rewards.length,
      dto: {
        contractVersion: RECONCILER_ROUTE_CONTRACT,
        rewards: [...parts.rewards],
      },
    })],
    ["launch-lookup", Object.freeze({
      routeKey: "launch-lookup",
      comparedCount: parts.launches.length,
      dto: {
        contractVersion: RECONCILER_ROUTE_CONTRACT,
        launches: [...parts.launches],
      },
    })],
  ]);
  return Object.freeze(routeKeys.map((routeKey) => {
    const route = routes.get(routeKey);
    if (!route) fail("reconciler-route-part-key");
    return route;
  }));
}

export function assembleClassicV3ReconcilerRoutes(
  parts: ClassicV3ReconcilerRouteParts,
): readonly ReconcilerRouteDto[] {
  if (parts.rewards.length < 1 || parts.launches.length < 1) {
    fail("reconciler-route-part-cardinality");
  }
  return assembleReconcilerRouteParts(parts, RECONCILER_ROUTE_KEYS);
}

export function assertReconcilerRouteSetForKeys(
  routes: readonly ReconcilerRouteDto[],
  expectedRouteKeys: readonly ReconcilerRouteKey[],
): readonly ReconcilerRouteDto[] {
  const expectedSet = new Set(expectedRouteKeys);
  const baseRouteKeys: readonly ReconcilerRouteKey[] = [
    "explore-list",
    "explore-token",
    "explore-chart",
    "creator-profile",
  ];
  if (
    expectedRouteKeys.length < baseRouteKeys.length ||
    expectedRouteKeys.length > RECONCILER_ROUTE_KEYS.length ||
    expectedSet.size !== expectedRouteKeys.length ||
    baseRouteKeys.some((routeKey) => !expectedSet.has(routeKey)) ||
    expectedRouteKeys.some((routeKey, index) =>
      !RECONCILER_ROUTE_KEYS.includes(routeKey) ||
      (index > 0 &&
        RECONCILER_ROUTE_KEYS.indexOf(routeKey) <=
          RECONCILER_ROUTE_KEYS.indexOf(expectedRouteKeys[index - 1]!))
    ) ||
    routes.length !== expectedRouteKeys.length ||
    routes.some((route, index) =>
      route.routeKey !== expectedRouteKeys[index] ||
      !Number.isSafeInteger(route.comparedCount) ||
      route.comparedCount < 1
    )
  ) {
    fail("reconciler-route-set");
  }
  const documents = new Map<
    ReconcilerRouteKey,
    readonly CanonicalJsonValue[]
  >();
  for (const route of routes) {
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
    if (document.contractVersion !== RECONCILER_ROUTE_CONTRACT) {
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
    documents.set(route.routeKey, collection);
  }
  const tokenRows = documents.get("explore-list")!;
  const detailRows = documents.get("explore-token")!;
  const chartRows = documents.get("explore-chart")!;
  const profileRows = documents.get("creator-profile")!;
  const rewardRows = documents.get("classic-v3-profile") ?? [];
  const lookupRows = documents.get("launch-lookup") ?? [];
  if (JSON.stringify(tokenRows) !== JSON.stringify(detailRows)) {
    fail("reconciler-route-cross-contract");
  }
  const tokenByIdentity = new Map<string, JsonRecord>();
  let previousTokenOrder: readonly (bigint | number | string)[] | undefined;
  for (const entry of tokenRows) {
    const row = object(entry, "reconciler-route-token-identity");
    const identity = `${row.releaseVersion}:${row.tokenAddress}`;
    if (tokenByIdentity.has(identity)) {
      fail("reconciler-route-token-identity");
    }
    const order = [
      BigInt(row.launchBlockNumber as string),
      row.launchTransactionIndex as number,
      row.launchLogIndex as number,
      row.launchTransactionHash as string,
      row.tokenAddress as string,
    ] as const;
    if (previousTokenOrder) {
      let comparison = 0;
      for (let index = 0; index < order.length; index += 1) {
        if (order[index]! < previousTokenOrder[index]!) {
          comparison = -1;
          break;
        }
        if (order[index]! > previousTokenOrder[index]!) {
          comparison = 1;
          break;
        }
      }
      if (comparison < 0) fail("reconciler-route-token-order");
    }
    previousTokenOrder = order;
    tokenByIdentity.set(identity, row);
  }

  chartRows.forEach((entry, index) => {
    const row = object(entry, "reconciler-route-chart-identity");
    const source = tokenRows[index] === undefined
      ? undefined
      : object(tokenRows[index]!, "reconciler-route-chart-token-source");
    if (
      !source ||
      row.releaseVersion !== source.releaseVersion ||
      row.modelId !== source.modelId ||
      row.tokenAddress !== source.tokenAddress ||
      row.poolId !== source.poolId ||
      row.quoteAssetAddress !== source.quoteAssetAddress
    ) {
      fail("reconciler-route-chart-token-mismatch");
    }
  });

  const profileTokenIdentities = new Set<string>();
  let previousAccount = "";
  for (const entry of profileRows) {
    const row = object(entry, "reconciler-route-profile-identity");
    const account = row.account as string;
    if (account <= previousAccount) fail("reconciler-route-profile-order");
    previousAccount = account;
    for (const reference of array(
      row.tokens,
      "reconciler-route-profile-identity-tokens",
    )) {
      const item = object(reference, "reconciler-route-profile-reference");
      const identity = `${item.releaseVersion}:${item.tokenAddress}`;
      const source = tokenByIdentity.get(identity);
      if (
        !source ||
        source.creatorAddress !== account ||
        source.modelId !== item.modelId ||
        source.launchTransactionHash !== item.launchTransactionHash ||
        profileTokenIdentities.has(identity)
      ) {
        fail("reconciler-route-profile-token-mismatch");
      }
      profileTokenIdentities.add(identity);
    }
  }
  if (profileTokenIdentities.size !== tokenByIdentity.size) {
    fail("reconciler-route-profile-token-coverage");
  }

  const classicV3Tokens = new Set(
    [...tokenByIdentity.entries()]
      .filter(([, row]) => row.releaseVersion === "classic-v3")
      .map(([identity]) => identity),
  );
  if (!documents.has("classic-v3-profile") && classicV3Tokens.size > 0) {
    fail("reconciler-route-reward-route-missing");
  }
  let previousVault = "";
  for (const entry of rewardRows) {
    const row = object(entry, "reconciler-route-reward-identity");
    const identity = `${row.releaseVersion}:${row.tokenAddress}`;
    const source = tokenByIdentity.get(identity);
    const vault = row.vaultAddress as string;
    if (
      !source ||
      !classicV3Tokens.delete(identity) ||
      source.poolId !== row.poolId ||
      source.rewardVaultAddress !== vault ||
      source.launchTransactionHash !== row.launchTransactionHash ||
      source.name !== row.tokenName ||
      source.symbol !== row.tokenSymbol ||
      vault <= previousVault
    ) {
      fail("reconciler-route-reward-token-mismatch");
    }
    previousVault = vault;
  }
  if (classicV3Tokens.size !== 0) {
    fail("reconciler-route-reward-token-coverage");
  }

  const lookupExpected = new Set(
    [...tokenByIdentity.entries()]
      .filter(([, row]) => row.releaseVersion !== "classic-v2")
      .map(([identity]) => identity),
  );
  if (!documents.has("launch-lookup") && lookupExpected.size > 0) {
    fail("reconciler-route-lookup-route-missing");
  }
  let previousLookupOrder = "";
  for (const entry of lookupRows) {
    const row = object(entry, "reconciler-route-lookup-identity");
    const identity = `${row.releaseVersion}:${row.tokenAddress}`;
    const source = tokenByIdentity.get(identity);
    const order = `${row.account}:${row.launchTransactionHash}:${row.tokenAddress}`;
    if (
      !source ||
      !lookupExpected.delete(identity) ||
      source.modelId !== row.modelId ||
      source.creatorAddress !== row.account ||
      source.launchTransactionHash !== row.launchTransactionHash ||
      order <= previousLookupOrder
    ) {
      fail("reconciler-route-lookup-token-mismatch");
    }
    previousLookupOrder = order;
  }
  if (lookupExpected.size !== 0) {
    fail("reconciler-route-lookup-token-coverage");
  }
  return routes;
}

export function assertClassicV3ReconcilerRouteSet(
  routes: readonly ReconcilerRouteDto[],
): readonly ReconcilerRouteDto[] {
  return assertReconcilerRouteSetForKeys(routes, RECONCILER_ROUTE_KEYS);
}

export const assembleReconcilerRoutes = assembleClassicV3ReconcilerRoutes;
export const assertReconcilerRouteSet = assertClassicV3ReconcilerRouteSet;
