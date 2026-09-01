import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

import {
  buildExploreDataQuality,
  publicExploreEntryV1,
  valuationSortValue,
  type ValuedExploreEntry,
} from "../../../lib/explore-financial-data";
import { readDexscreenerExploreEntriesV1 } from
  "../../../lib/market-data/dexscreener-explore.server";
import {
  canonicalTokenSupplyHydrationRequiredV1,
  hydrateMissingCanonicalTokenSupplyBoundedV1,
} from "../../../lib/market-data/canonical-token-supply.server";
import { exploreEntryMarketIdentitiesV1 } from
  "../../../lib/market-data/explore-market-identities";
import {
  gmgnTokenInfoFallbackEntryV1,
  rankCanonicalExploreEntriesWithGmgnDiscoveryV1,
  rankCanonicalExploreEntriesWithGmgnSearchV1,
  rankCanonicalExploreMarketCapEntriesWithGmgnV1,
  rankCanonicalExploreMarketCapPrimaryWithGmgnV1,
} from "../../../lib/market-data/gmgn-canonical-ranking";
import {
  readGmgnEthereumHotSearchesV1,
  readGmgnEthereumSearchV1,
  readGmgnEthereumTrendingV1,
} from "../../../lib/market-data/gmgn-discovery.server";
import {
  GMGN_TRENDING_MAXIMUM_LIMIT,
  normalizeGmgnSearchQueryV1,
  type GmgnDiscoverySnapshotV1,
  type GmgnSearchSnapshotV1,
} from "../../../lib/market-data/gmgn-discovery-v1";
import {
  gmgnVisibleMarketEntryEligibleV1,
  readGmgnExploreSnapshotsV1,
} from "../../../lib/market-data/gmgn.server";
import {
  exploreMarketProviderHeaderV1,
  exploreMarketPriceSourcesV1,
  exploreMarketSourcesV1,
  readExploreMarketEntriesV1,
  type ExploreMarketReadV1,
} from "../../../lib/market-data/explore-market.server";
import {
  envioClassicV3IdentityCommitmentV1,
  mergeEnvioClassicV3CatalogEntriesV1,
  readEnvioClassicV3CatalogV1,
  type EnvioClassicV3CatalogV1,
} from
  "../../../lib/market-data/envio-classic-v3-catalog.server";
import {
  lastGoodLaunchIdentityCommitmentV1,
  readLastGoodLaunchCatalogV1,
  type LastGoodLaunchCatalogV1,
} from "../../../lib/market-data/last-good-launch-catalog.server";
import {
  mergeRouterCustomExploreEntriesV1,
  readFinalizedRouterCustomIdentitySnapshotV1,
  ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
  ROUTER_CUSTOM_LAUNCH_SOURCE,
} from "../../../lib/alchemy/router-custom-public.server";
import { parseExploreSort } from "../../../lib/onchain/query";
import {
  publicExploreCatalogEntriesV1,
  publicExplorePresentationEntryV1,
} from
  "../../../lib/public-explore-catalog-v1";
import { safeOperationalRpcError } from
  "../../../lib/onchain/operational-rpc-failover.server";
import { readProductionCustomExploreDirectoryV1 } from
  "../../../lib/server/custom-launch/explore-directory-v1";
import { isCustomLaunchRegistryPublicReadEnabled } from
  "../../../lib/server/custom-launch/public-readiness";
import type { ExploreSort } from "../../../lib/onchain/types";
import { canonicalSha256 } from
  "../../../lib/server/projection-target/hashing";
import type { ExploreEntry } from "../../../lib/tokens";
import { tryParseViewChainId } from "../../../lib/view-chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const FAST_LANE_REQUEST_BUDGET_MS = 8_000;
const GMGN_MARKET_CAP_HYDRATION_LIMIT = GMGN_TRENDING_MAXIMUM_LIMIT;
const MARKET_CAP_SUPPLY_HYDRATION_LIMIT = 20;
const MARKET_CAP_SUPPLY_HYDRATION_BUDGET_MS = 1_800;
const GMGN_MARKET_CAP_HYDRATION_RESERVE_MS = 2_500;
const GMGN_MARKET_CAP_RANK_REQUEST_BUDGET_MS = 2_500;
const GMGN_MARKET_CAP_RETRY_MINIMUM_REMAINING_MS =
  GMGN_MARKET_CAP_RANK_REQUEST_BUDGET_MS +
  MARKET_CAP_SUPPLY_HYDRATION_BUDGET_MS + GMGN_MARKET_CAP_HYDRATION_RESERVE_MS;
const EXPLORE_MARKET_CAP_CACHE_REVALIDATE_SECONDS = 60;
// Explore responses may spend up to 60 seconds in the public edge cache. Keep
// both the completed composition and every provider ordering observation
// inside the remaining 235-second origin budget of the five-minute contract.
const EXPLORE_MARKET_CAP_CACHE_MAXIMUM_AGE_MS = 235_000;
const CLASSIC_EXCLUSIONS = Object.freeze([
  "classic-v1",
  "classic-v2",
  "stock-paired-v1",
  "stock-paired-v2",
  "stock-paired-v3",
] as const);

type BoundDurableLaunchCatalogV1 = LastGoodLaunchCatalogV1 & Readonly<{
  asOfBlock: string;
  asOfBlockHash: `0x${string}`;
}>;

type ExploreCanonicalCatalogV1 =
  | EnvioClassicV3CatalogV1
  | BoundDurableLaunchCatalogV1;

function boundDurableLaunchCatalogV1(
  catalog: LastGoodLaunchCatalogV1,
): BoundDurableLaunchCatalogV1 | null {
  return catalog.asOfBlock !== null && catalog.asOfBlockHash !== null
    ? catalog as BoundDurableLaunchCatalogV1
    : null;
}

function exploreLaunchSourceV1(input: Readonly<{
  catalog: ExploreCanonicalCatalogV1 | null;
  registryCustomCurrent: boolean;
  routerCustomAvailable: boolean;
}>) {
  return [
    ...(input.catalog === null ? [] : [input.catalog.source]),
    ...(input.registryCustomCurrent ? ["registry.custom-launched"] : []),
    ...(input.routerCustomAvailable
      ? [ROUTER_CUSTOM_LAUNCH_SOURCE]
      : []),
  ].join("+");
}

const EXPLORE_QUERY_PARAMETERS = new Set([
  "chain",
  "limit",
  "model",
  "page",
  "q",
  "socials",
  "sort",
]);

function hasCanonicalQueryShape(search: URLSearchParams) {
  const seen = new Set<string>();
  for (const [key] of search) {
    if (!EXPLORE_QUERY_PARAMETERS.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function hasCanonicalPaginationShape(search: URLSearchParams) {
  return ["page", "limit"].every((parameter) => {
    const value = search.get(parameter);
    if (value === null) return true;
    if (!/^[1-9]\d*$/u.test(value)) return false;
    return Number.isSafeInteger(Number(value));
  });
}

function integerQuery(value: string | null, fallback: number) {
  if (!value || !/^\d+$/u.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

function positiveInteger(value: number, fallback: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < 1) return fallback;
  return Math.min(value, maximum);
}

function entryLaunchTime(entry: ExploreEntry): number {
  const value = Date.parse(entry.launchedAt);
  return Number.isFinite(value) ? value : 0;
}

function nonNegativeInteger(value: unknown): bigint | null {
  const normalized = String(value ?? "");
  return /^(?:0|[1-9][0-9]*)$/u.test(normalized)
    ? BigInt(normalized)
    : null;
}

function entryChainId(entry: ExploreEntry): string | null {
  if (entry.exploreKind === "custom-project") return entry.chainId;
  const [chainId] = entry.id.split(":", 1);
  return /^\d+$/u.test(chainId ?? "") ? chainId : null;
}

function exactExploreMarketIdentityV1(
  candidate: ExploreEntry,
  canonical: ExploreEntry,
): boolean {
  if (
    candidate.id !== canonical.id ||
    candidate.exploreKind !== canonical.exploreKind ||
    candidate.tokenAddress?.toLowerCase() !==
      canonical.tokenAddress?.toLowerCase()
  ) return false;
  const key = (entry: ExploreEntry) => exploreEntryMarketIdentitiesV1(entry)
    .map((identity) => [
      identity.chainId,
      identity.protocol,
      identity.tokenAddress,
      identity.poolId,
      identity.quoteAddress,
    ].join(":"));
  const candidateKeys = key(candidate);
  const canonicalKeys = key(canonical);
  return canonicalKeys.length > 0 &&
    candidateKeys.length === canonicalKeys.length &&
    candidateKeys.every((value, index) => value === canonicalKeys[index]);
}

function entryLaunchOrder(
  entry: ExploreEntry,
): readonly [bigint, bigint, bigint] | null {
  const values = entry.exploreKind === "token"
    ? [
        entry.launchBlockNumber,
        entry.launchTransactionIndex,
        entry.launchLogIndex,
      ]
    : entry.launchCategoryProvenance.source === "registry.custom-launched"
      ? [
          entry.launchCategoryProvenance.blockNumber,
          entry.launchCategoryProvenance.transactionIndex,
          entry.launchCategoryProvenance.logIndex,
        ]
      : null;
  if (values === null) return null;
  const coordinates = values.map(nonNegativeInteger);
  return coordinates.every((value): value is bigint => value !== null)
    ? [coordinates[0], coordinates[1], coordinates[2]]
    : null;
}

function compareCanonicalLaunchOrder(
  first: ExploreEntry,
  second: ExploreEntry,
): number {
  const firstChainId = entryChainId(first);
  const secondChainId = entryChainId(second);
  const firstOrder = entryLaunchOrder(first);
  const secondOrder = entryLaunchOrder(second);
  if (
    firstChainId === null ||
    firstChainId !== secondChainId ||
    firstOrder === null ||
    secondOrder === null
  ) return 0;
  for (let index = 0; index < firstOrder.length; index += 1) {
    if (firstOrder[index] === secondOrder[index]) continue;
    return firstOrder[index] > secondOrder[index] ? -1 : 1;
  }
  return 0;
}

function compareNewestEntries(first: ExploreEntry, second: ExploreEntry) {
  const time = entryLaunchTime(second) - entryLaunchTime(first);
  if (time !== 0) return time;
  const firstChainId = entryChainId(first);
  const secondChainId = entryChainId(second);
  if (firstChainId !== secondChainId) {
    if (firstChainId === null) return 1;
    if (secondChainId === null) return -1;
    return BigInt(firstChainId) < BigInt(secondChainId) ? -1 : 1;
  }
  const canonicalOrder = compareCanonicalLaunchOrder(first, second);
  return canonicalOrder === 0 ? first.id.localeCompare(second.id) : canonicalOrder;
}

function sortExploreEntries(
  entries: readonly ExploreEntry[],
  sort: ExploreSort,
): ExploreEntry[] {
  return [...entries].sort((first, second) => {
    if (sort === "newest" || sort === "oldest" || sort === "trending") {
      const comparison = compareNewestEntries(first, second);
      return sort === "oldest" ? -comparison : comparison;
    }
    const firstCap = valuationSortValue(first);
    const secondCap = valuationSortValue(second);
    if (firstCap === null || secondCap === null) {
      if (firstCap === null && secondCap !== null) return 1;
      if (firstCap !== null && secondCap === null) return -1;
      return compareNewestEntries(first, second);
    }
    if (firstCap !== secondCap) {
      if (sort === "market-cap") return firstCap > secondCap ? -1 : 1;
      return firstCap < secondCap ? -1 : 1;
    }
    return compareNewestEntries(first, second);
  });
}

function filterExploreEntries(
  entries: readonly ExploreEntry[],
  query: string,
  socials: "yes" | "no" | null,
  model: "classic" | "custom" | null,
): ExploreEntry[] {
  const normalized = query.trim().toLowerCase().replace(/^\$/u, "");
  return entries.filter((entry) => {
    if (
      model !== null &&
      entry.launchCategoryProvenance.category !== model
    ) return false;
    const hasSocials = entry.links?.some(
      (link) => link.kind === "x" || link.kind === "telegram",
    ) ?? false;
    if (socials !== null && hasSocials !== (socials === "yes")) return false;
    if (!normalized) return true;
    return entry.name.toLowerCase().includes(normalized) ||
      (entry.symbol?.toLowerCase().includes(normalized) ?? false) ||
      (entry.tokenAddress?.toLowerCase().includes(normalized) ?? false) ||
      (entry.exploreKind === "custom-project" &&
        entry.modelId.toLowerCase().includes(normalized));
  });
}

export function dedupeExploreEntriesV1(
  entries: readonly ExploreEntry[],
): ExploreEntry[] {
  const byId = new Map<string, ExploreEntry>();
  const byTokenAddress = new Map<string, ExploreEntry>();
  const output: ExploreEntry[] = [];
  for (const entry of entries) {
    const existingId = byId.get(entry.id);
    if (existingId !== undefined) {
      if (JSON.stringify(existingId) === JSON.stringify(entry)) continue;
      throw new Error(`Launch catalog returned conflicting launch ${entry.id}`);
    }
    const address = entry.tokenAddress?.toLowerCase();
    const existingAddress = address ? byTokenAddress.get(address) : undefined;
    if (existingAddress !== undefined) {
      if (JSON.stringify(existingAddress) === JSON.stringify(entry)) continue;
      throw new Error(`Launch catalog returned conflicting token ${entry.tokenAddress}`);
    }
    byId.set(entry.id, entry);
    if (address) byTokenAddress.set(address, entry);
    output.push(entry);
  }
  return output;
}

function paginateEntries(
  ordered: readonly ExploreEntry[],
  input: Readonly<{ page: number; pageSize: number }>,
) {
  const pageSize = positiveInteger(input.pageSize, 9, 100);
  const totalPages = Math.ceil(ordered.length / pageSize);
  const requestedPage = positiveInteger(input.page, 1, Number.MAX_SAFE_INTEGER);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  return {
    tokens: ordered.slice(offset, offset + pageSize),
    page,
    pageSize,
    total: ordered.length,
    totalPages,
  };
}

export function paginateExploreEntriesV1(
  entries: readonly ExploreEntry[],
  input: Readonly<{
    page: number;
    pageSize: number;
    query: string;
    socials: "yes" | "no" | null;
    model: "classic" | "custom" | null;
    sort: ExploreSort;
  }>,
) {
  const filtered = filterExploreEntries(
    entries,
    input.query,
    input.socials,
    input.model,
  );
  return paginateEntries(sortExploreEntries(filtered, input.sort), input);
}

export type ExploreSearchRankingV1 = Readonly<{
  schemaVersion: "programmable.explore-search-ranking.v1";
  provider: "gmgn";
  requested: "search";
  orderBy: "weight";
  rankingCommitment: `sha256:${string}`;
  status: "complete" | "partial" | "unavailable";
  applied:
    | "gmgn-canonical-search-with-local-match-fallback"
    | "local-match-order";
  observedTokenCount: number;
  matchedTokenCount: number;
  matchedUniqueTokenCount: number;
  canonicalMatchCount: number;
  canonicalMatchTokenCount: number;
  unobservedCanonicalMatchCount: number;
  providerOnlyCanonicalTokenCount: number;
  foreignTokenCount: number;
  discardedProviderItemCount: number;
  duplicateProviderItemCount: number;
  canonicalAddressCoverageBps: number;
  asOfTime: string | null;
}>;

function localSearchMatchPriorityV1(
  entry: ExploreEntry,
  query: string,
): number {
  const normalized = normalizeGmgnSearchQueryV1(query);
  if (normalized === null) return 1;
  const exact = [
    entry.name,
    entry.symbol,
    entry.tokenAddress,
    ...(entry.exploreKind === "custom-project" ? [entry.modelId] : []),
  ].some((value) => typeof value === "string" &&
    value.toLowerCase() === normalized);
  return exact ? 0 : 1;
}

export function rankExploreSearchEntriesV1(
  entries: readonly ExploreEntry[],
  snapshot: GmgnSearchSnapshotV1 | null,
  input: Readonly<{
    query: string;
    socials: "yes" | "no" | null;
    model: "classic" | "custom" | null;
    fallbackSort: ExploreSort;
    now?: Date;
  }>,
): Readonly<{
  entries: readonly ExploreEntry[];
  search: ExploreSearchRankingV1;
}> {
  const canonicalUniverse = filterExploreEntries(
    entries,
    "",
    input.socials,
    input.model,
  );
  const localMatches = sortExploreEntries(
    filterExploreEntries(
      canonicalUniverse,
      input.query,
      null,
      null,
    ),
    input.fallbackSort,
  ).map((entry, stableIndex) => ({ entry, stableIndex }))
    .sort((left, right) =>
      localSearchMatchPriorityV1(left.entry, input.query) -
        localSearchMatchPriorityV1(right.entry, input.query) ||
      left.stableIndex - right.stableIndex
    )
    .map(({ entry }) => entry);
  const ranked = rankCanonicalExploreEntriesWithGmgnSearchV1(
    canonicalUniverse,
    localMatches,
    snapshot,
    input.query,
    input.now ?? new Date(),
  );
  const coverage = ranked.coverage;
  const matched = coverage.gmgnMatchedEntryCount;
  const usableSnapshot = coverage.gmgnSnapshotCount === 1 ? snapshot : null;
  const status = usableSnapshot === null
    ? "unavailable" as const
    : matched === ranked.entries.length
      ? "complete" as const
      : "partial" as const;
  const rankingCommitment = canonicalSha256(
    "programmable.explore-search-ranking-commitment.v1",
    {
      query: normalizeGmgnSearchQueryV1(input.query),
      providerSnapshot: usableSnapshot === null
        ? null
        : {
            fetchedAt: usableSnapshot.fetchedAt,
            orderBy: usableSnapshot.orderBy,
            providerItemCount: usableSnapshot.providerItemCount,
          },
      orderedCanonicalMatches: ranked.entries.map((entry, index) => ({
        index,
        id: entry.id,
        tokenAddress: entry.tokenAddress?.toLowerCase() ?? null,
      })),
    },
  );
  return Object.freeze({
    entries: ranked.entries,
    search: Object.freeze({
      schemaVersion: "programmable.explore-search-ranking.v1",
      provider: "gmgn",
      requested: "search",
      orderBy: "weight",
      rankingCommitment,
      status,
      applied: matched > 0
        ? "gmgn-canonical-search-with-local-match-fallback"
        : "local-match-order",
      observedTokenCount: coverage.gmgnObservedUniqueTokenCount,
      matchedTokenCount: matched,
      matchedUniqueTokenCount: coverage.gmgnMatchedUniqueTokenCount,
      canonicalMatchCount: coverage.canonicalMatchEntryCount,
      canonicalMatchTokenCount: coverage.canonicalMatchTokenCount,
      unobservedCanonicalMatchCount: coverage.unobservedLocalMatchEntryCount,
      providerOnlyCanonicalTokenCount:
        coverage.providerOnlyCanonicalTokenCount,
      foreignTokenCount: coverage.foreignGmgnTokenCount,
      discardedProviderItemCount: coverage.discardedProviderItemCount,
      duplicateProviderItemCount: coverage.duplicateGmgnTokenCount,
      canonicalAddressCoverageBps: coverage.canonicalAddressCoverageBps,
      asOfTime: usableSnapshot?.fetchedAt ?? null,
    }),
  });
}

export type ExploreDiscoveryRankingV1 = Readonly<{
  schemaVersion: "programmable.explore-discovery-ranking.v1";
  provider: "gmgn";
  requested: "trending";
  rankingCommitment: `sha256:${string}`;
  status: "complete" | "partial" | "unavailable";
  applied: "gmgn-ranked-with-launch-order-fallback" | "launch-order";
  rankInterval: "1h";
  hotSearchInterval: "24h";
  snapshotCount: number;
  observedTokenCount: number;
  matchedTokenCount: number;
  matchedUniqueTokenCount: number;
  canonicalEntryCount: number;
  canonicalTokenCount: number;
  unobservedCanonicalEntryCount: number;
  canonicalAddressCoverageBps: number;
  foreignTokenCount: number;
  discardedProviderItemCount: number;
  asOfTime: string | null;
}>;

export type ExploreMarketCapRankingV1 = Readonly<{
  schemaVersion: "programmable.explore-market-cap-ranking.v1";
  requested: "market-cap";
  direction: "asc" | "desc";
  primaryProvider: "gmgn";
  source:
    | "gmgn"
    | "gmgn+dexscreener"
    | "dexscreener"
    | "canonical-launch-order";
  fallbackProvider: "dexscreener";
  rankingCommitment: `sha256:${string}`;
  status: "complete" | "partial" | "unavailable";
  gmgnStatus: "complete" | "partial" | "unavailable";
  applied:
    | "gmgn-market-cap"
    | "gmgn-market-cap-then-gmgn-token-info-fdv"
    | "gmgn-market-cap-then-gmgn-token-info-fdv-then-launch-order"
    | "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv"
    | "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
    | "gmgn-market-cap-then-dexscreener-fdv"
    | "gmgn-market-cap-then-dexscreener-fdv-then-launch-order"
    | "gmgn-market-cap-then-launch-order"
    | "gmgn-token-info-fdv"
    | "gmgn-token-info-fdv-then-launch-order"
    | "gmgn-token-info-fdv-then-dexscreener-fdv"
    | "gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
    | "fdv"
    | "qualified-fdv-then-launch-order"
    | "launch-order";
  metricOrder:
    "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order";
  rankInterval: "1h";
  rankLimit: 100;
  observedTokenCount: number;
  matchedTokenCount: number;
  matchedUniqueTokenCount: number;
  canonicalEntryCount: number;
  canonicalTokenCount: number;
  unobservedCanonicalEntryCount: number;
  canonicalAddressCoverageBps: number;
  foreignTokenCount: number;
  discardedProviderItemCount: number;
  gmgnHydrationLimit: number;
  gmgnHydrationEligibleCount: number;
  gmgnHydrationRequestedCount: number;
  gmgnHydrationObservedCount: number;
  gmgnHydrationQualifiedCount: number;
  gmgnHydrationDeferredCount: number;
  fallbackRequestedCount: number;
  fallbackQualifiedCount: number;
  canonicalTailCount: number;
  qualifiedCount: number;
  totalCount: number;
  asOfTime: string | null;
}>;

export function paginateTrendingExploreEntriesV1(
  entries: readonly ExploreEntry[],
  snapshots: readonly GmgnDiscoverySnapshotV1[],
  input: Readonly<{
    page: number;
    pageSize: number;
    query: string;
    socials: "yes" | "no" | null;
    model: "classic" | "custom" | null;
  }>,
): Readonly<{
  paginated: ReturnType<typeof paginateEntries>;
  discovery: ExploreDiscoveryRankingV1;
}> {
  const filteredNewest = sortExploreEntries(
    filterExploreEntries(
      entries,
      input.query,
      input.socials,
      input.model,
    ),
    "newest",
  );
  const ranked = rankCanonicalExploreEntriesWithGmgnDiscoveryV1(
    filteredNewest,
    snapshots,
  );
  const coverage = ranked.coverage;
  const matched = coverage.gmgnMatchedEntryCount;
  const status = matched === 0
    ? "unavailable" as const
    : matched === coverage.canonicalEntryCount
      ? "complete" as const
      : "partial" as const;
  const acceptedTimes = snapshots
    .map((snapshot) => snapshot.fetchedAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort();
  const rankingCommitment = canonicalSha256(
    "programmable.explore-discovery-ranking-identity-commitment.v1",
    {
      canonicalEntryCount: coverage.canonicalEntryCount,
      matches: ranked.rows.flatMap((row) =>
        row.gmgn === null || row.tokenAddress === null
          ? []
          : [{
              canonicalIndex: row.canonicalIndex,
              tokenAddress: row.tokenAddress,
              snapshotKind: row.gmgn.kind,
              snapshotInterval: row.gmgn.interval,
              snapshotOrderBy: row.gmgn.orderBy,
              snapshotDirection: row.gmgn.direction,
            }]
      ),
    },
  );
  return {
    paginated: paginateEntries(ranked.entries, input),
    discovery: {
      schemaVersion: "programmable.explore-discovery-ranking.v1",
      provider: "gmgn",
      requested: "trending",
      rankingCommitment,
      status,
      applied: matched > 0
        ? "gmgn-ranked-with-launch-order-fallback"
        : "launch-order",
      rankInterval: "1h",
      hotSearchInterval: "24h",
      snapshotCount: coverage.gmgnSnapshotCount,
      observedTokenCount: coverage.gmgnObservedUniqueTokenCount,
      matchedTokenCount: matched,
      matchedUniqueTokenCount: coverage.gmgnMatchedUniqueTokenCount,
      canonicalEntryCount: coverage.canonicalEntryCount,
      canonicalTokenCount: coverage.canonicalUniqueTokenCount,
      unobservedCanonicalEntryCount: coverage.unobservedCanonicalEntryCount,
      canonicalAddressCoverageBps: coverage.canonicalAddressCoverageBps,
      foreignTokenCount: coverage.foreignGmgnTokenCount,
      discardedProviderItemCount: coverage.discardedProviderItemCount,
      asOfTime: acceptedTimes.at(-1) ?? null,
    },
  };
}

function marketCapAppliedV1(input: Readonly<{
  totalCount: number;
  gmgnMatchedCount: number;
  gmgnHydrationQualifiedCount: number;
  fallbackQualifiedCount: number;
}>): ExploreMarketCapRankingV1["applied"] {
  if (input.totalCount === 0) return "launch-order";
  const hasRank = input.gmgnMatchedCount > 0;
  const hasHydration = input.gmgnHydrationQualifiedCount > 0;
  const hasFallback = input.fallbackQualifiedCount > 0;
  const hasTail = input.gmgnMatchedCount +
      input.gmgnHydrationQualifiedCount + input.fallbackQualifiedCount <
    input.totalCount;
  if (hasRank && hasHydration && hasFallback) {
    return hasTail
      ? "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
      : "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv";
  }
  if (hasRank && hasHydration) {
    return hasTail
      ? "gmgn-market-cap-then-gmgn-token-info-fdv-then-launch-order"
      : "gmgn-market-cap-then-gmgn-token-info-fdv";
  }
  if (hasRank && hasFallback) {
    return hasTail
      ? "gmgn-market-cap-then-dexscreener-fdv-then-launch-order"
      : "gmgn-market-cap-then-dexscreener-fdv";
  }
  if (hasRank) {
    return input.gmgnMatchedCount === input.totalCount
      ? "gmgn-market-cap"
      : "gmgn-market-cap-then-launch-order";
  }
  if (hasHydration && hasFallback) {
    return hasTail
      ? "gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order"
      : "gmgn-token-info-fdv-then-dexscreener-fdv";
  }
  if (hasHydration) {
    return hasTail
      ? "gmgn-token-info-fdv-then-launch-order"
      : "gmgn-token-info-fdv";
  }
  if (hasFallback) {
    return hasTail
      ? "qualified-fdv-then-launch-order"
      : "fdv";
  }
  return "launch-order";
}

export function exploreMarketCapRankingV1(
  canonicalEntries: readonly ExploreEntry[],
  snapshot: GmgnDiscoverySnapshotV1 | null,
  fallback: Parameters<
    typeof rankCanonicalExploreMarketCapEntriesWithGmgnV1
  >[2],
  direction: "asc" | "desc",
  now = new Date(),
): Readonly<{
  orderedEntries: readonly ExploreEntry[];
  orderingAsOfTimes: readonly (string | null)[];
  ranking: ExploreMarketCapRankingV1;
}> {
  const hybrid = rankCanonicalExploreMarketCapEntriesWithGmgnV1(
    canonicalEntries,
    snapshot === null ? [] : [snapshot],
    fallback,
    direction,
    now,
  );
  const coverage = hybrid.coverage;
  const matched = coverage.gmgnMatchedEntryCount;
  const qualifiedCount = matched + hybrid.gmgnHydrationQualifiedEntryCount +
    hybrid.fallbackQualifiedEntryCount;
  const status = qualifiedCount === 0 || canonicalEntries.length === 0
    ? "unavailable" as const
    : qualifiedCount === canonicalEntries.length
      ? "complete" as const
      : "partial" as const;
  const gmgnQualifiedCount = matched + hybrid.gmgnHydrationQualifiedEntryCount;
  const gmgnStatus = gmgnQualifiedCount === 0 || canonicalEntries.length === 0
    ? "unavailable" as const
    : gmgnQualifiedCount === canonicalEntries.length
      ? "complete" as const
      : "partial" as const;
  const source = gmgnQualifiedCount > 0
    ? hybrid.fallbackQualifiedEntryCount > 0
      ? "gmgn+dexscreener" as const
      : "gmgn" as const
    : hybrid.fallbackQualifiedEntryCount > 0
      ? "dexscreener" as const
      : "canonical-launch-order" as const;
  const rankingCommitment = canonicalSha256(
    "programmable.explore-market-cap-ranking-commitment.v1",
    {
      direction,
      gmgnSnapshot: snapshot === null || coverage.gmgnSnapshotCount === 0
        ? null
        : {
            interval: snapshot.interval,
            orderBy: snapshot.orderBy,
            direction: snapshot.direction,
            requestedLimit: snapshot.requestedLimit,
            fetchedAt: snapshot.fetchedAt,
          },
      orderedCanonicalEntries: hybrid.rows.map((row, index) => ({
        index,
        id: row.entry.id,
        tokenAddress: row.tokenAddress,
        source: row.orderingSource,
        valueWad: row.orderingValueWad,
        asOfTime: row.orderingAsOfTime,
      })),
    },
  );
  return {
    orderedEntries: hybrid.entries,
    orderingAsOfTimes: Object.freeze(
      hybrid.rows.map((row) => row.orderingAsOfTime),
    ),
    ranking: {
      schemaVersion: "programmable.explore-market-cap-ranking.v1",
      requested: "market-cap",
      direction,
      primaryProvider: "gmgn",
      source,
      fallbackProvider: "dexscreener",
      rankingCommitment,
      status,
      gmgnStatus,
      applied: marketCapAppliedV1({
        totalCount: canonicalEntries.length,
        gmgnMatchedCount: matched,
        gmgnHydrationQualifiedCount:
          hybrid.gmgnHydrationQualifiedEntryCount,
        fallbackQualifiedCount: hybrid.fallbackQualifiedEntryCount,
      }),
      metricOrder:
        "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order",
      rankInterval: "1h",
      rankLimit: 100,
      observedTokenCount: coverage.gmgnObservedUniqueTokenCount,
      matchedTokenCount: matched,
      matchedUniqueTokenCount: coverage.gmgnMatchedUniqueTokenCount,
      canonicalEntryCount: coverage.canonicalEntryCount,
      canonicalTokenCount: coverage.canonicalUniqueTokenCount,
      unobservedCanonicalEntryCount: coverage.unobservedCanonicalEntryCount,
      canonicalAddressCoverageBps: coverage.canonicalAddressCoverageBps,
      foreignTokenCount: coverage.foreignGmgnTokenCount,
      discardedProviderItemCount: coverage.discardedProviderItemCount,
      gmgnHydrationLimit: hybrid.gmgnHydrationLimit,
      gmgnHydrationEligibleCount: hybrid.gmgnHydrationEligibleEntryCount,
      gmgnHydrationRequestedCount: hybrid.gmgnHydrationRequestedEntryCount,
      gmgnHydrationObservedCount: hybrid.gmgnHydrationAcceptedEntryCount,
      gmgnHydrationQualifiedCount: hybrid.gmgnHydrationQualifiedEntryCount,
      gmgnHydrationDeferredCount: hybrid.gmgnHydrationDeferredEntryCount,
      fallbackRequestedCount: hybrid.fallbackRequestedEntryCount,
      fallbackQualifiedCount: hybrid.fallbackQualifiedEntryCount,
      canonicalTailCount: hybrid.canonicalTailEntryCount,
      qualifiedCount,
      totalCount: canonicalEntries.length,
      asOfTime: coverage.gmgnObservedUniqueTokenCount > 0 && snapshot !== null
        ? snapshot.fetchedAt
        : hybrid.rows.map((row) => row.orderingAsOfTime)
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null,
    },
  };
}

type CachedExploreMarketCapCompositionV1 = Readonly<{
  schemaVersion: "programmable.explore-market-cap-composition.v1";
  inputCommitment: `sha256:${string}`;
  direction: "asc" | "desc";
  assembledAt: string;
  orderedEntryIds: readonly string[];
  orderingAsOfTimes: readonly (string | null)[];
  ranking: ExploreMarketCapRankingV1;
}>;

function exploreMarketCapCompositionInputCommitmentV1(
  entries: readonly ExploreEntry[],
  direction: "asc" | "desc",
): `sha256:${string}` {
  return canonicalSha256(
    "programmable.explore-market-cap-composition-input.v1",
    { direction, entries },
  );
}

async function assembleExploreMarketCapCompositionV1(
  filteredNewest: readonly ExploreEntry[],
  direction: "asc" | "desc",
): Promise<Readonly<{
  orderedEntries: readonly ExploreEntry[];
  orderingAsOfTimes: readonly (string | null)[];
  ranking: ExploreMarketCapRankingV1;
}>> {
  const deadlineMs = Date.now() + FAST_LANE_REQUEST_BUDGET_MS;
  const readSignal = AbortSignal.timeout(FAST_LANE_REQUEST_BUDGET_MS);
  const rankOptions = {
    interval: "1h" as const,
    limit: 100,
    orderBy: "marketcap" as const,
    direction,
  } as const;
  const rankWait = { signal: readSignal, deadlineMs };
  const rankCandidate = filteredNewest.length === 0
    ? null
    : await (async () => {
        const first = await readGmgnEthereumTrendingV1(
          rankOptions,
          rankWait,
        ).catch(() => null);
        if (
          first !== null ||
          rankWait.signal.aborted ||
          deadlineMs - Date.now() <
            GMGN_MARKET_CAP_RETRY_MINIMUM_REMAINING_MS
        ) return first;
        return readGmgnEthereumTrendingV1(
          rankOptions,
          rankWait,
        ).catch(() => null);
      })();
  const rank = rankCandidate?.kind === "trending" &&
      rankCandidate.orderBy === "marketcap" &&
      rankCandidate.direction === direction
    ? rankCandidate
    : null;
  const marketCapNow = new Date();
  const primary = rankCanonicalExploreMarketCapPrimaryWithGmgnV1(
    filteredNewest,
    rank === null ? [] : [rank],
    direction,
    marketCapNow,
  );
  const unobserved = primary.rows.flatMap((row) =>
    row.gmgn === null ? [row.entry] : []
  );
  const supplyRequested = unobserved.filter(
    canonicalTokenSupplyHydrationRequiredV1,
  ).slice(0, MARKET_CAP_SUPPLY_HYDRATION_LIMIT);
  const hydratedSupply = supplyRequested.length === 0
    ? []
    : await hydrateMissingCanonicalTokenSupplyBoundedV1(
        supplyRequested,
        {
          signal: readSignal,
          deadlineMs: deadlineMs - GMGN_MARKET_CAP_HYDRATION_RESERVE_MS,
          maximumDurationMs: MARKET_CAP_SUPPLY_HYDRATION_BUDGET_MS,
        },
      ).catch(() => supplyRequested);
  const hydratedSupplyById = new Map<string, ExploreEntry>();
  for (const [index, original] of supplyRequested.entries()) {
    const candidate = hydratedSupply[index];
    if (
      candidate !== undefined &&
      !canonicalTokenSupplyHydrationRequiredV1(candidate) &&
      exactExploreMarketIdentityV1(candidate, original)
    ) hydratedSupplyById.set(original.id, candidate);
  }
  const hydrationUniverse = unobserved.map((entry) =>
    hydratedSupplyById.get(entry.id) ?? entry
  );
  const gmgnHydrationEligible = hydrationUniverse.filter(
    gmgnVisibleMarketEntryEligibleV1,
  );
  const gmgnRequested = gmgnHydrationEligible.slice(
    0,
    GMGN_MARKET_CAP_HYDRATION_LIMIT,
  );
  const gmgnHydrationDeadlineMs = deadlineMs -
    GMGN_MARKET_CAP_HYDRATION_RESERVE_MS;
  const gmgnSnapshots = gmgnRequested.length > 0 &&
      gmgnHydrationDeadlineMs > Date.now()
    ? await readGmgnExploreSnapshotsV1(gmgnRequested, {
        signal: readSignal,
        deadlineMs: gmgnHydrationDeadlineMs,
      }).catch(() => new Map())
    : new Map();
  const gmgnHydratedEntries = gmgnRequested.flatMap((entry) => {
    const snapshot = gmgnSnapshots.get(entry.id);
    if (snapshot === undefined) return [];
    const hydrated = gmgnTokenInfoFallbackEntryV1(
      entry,
      snapshot,
      new Date(),
    );
    return hydrated === null ? [] : [hydrated];
  });
  const gmgnQualifiedIds = new Set(gmgnHydratedEntries.flatMap((entry) =>
    valuationSortValue(entry) === null ? [] : [entry.id]
  ));
  const dexscreenerRequested = hydrationUniverse.filter(
    (entry) => !gmgnQualifiedIds.has(entry.id),
  );
  const fallback = await readDexscreenerExploreEntriesV1(
    dexscreenerRequested,
    { signal: readSignal, deadlineMs },
  );
  return exploreMarketCapRankingV1(
    filteredNewest,
    rank,
    {
      gmgnHydrationLimit: GMGN_MARKET_CAP_HYDRATION_LIMIT,
      gmgnHydrationEligibleEntryCount: gmgnHydrationEligible.length,
      gmgnRequestedEntries: gmgnRequested,
      gmgnEntries: gmgnHydratedEntries,
      dexscreenerRequestedEntries: dexscreenerRequested,
      dexscreenerEntries: fallback.entries,
    },
    direction,
    new Date(),
  );
}

// The Next Data Cache binds the complete provider composition, not just GMGN's
// rank prefix, across serverless isolates. The callback receives no caller
// signal: a timed-out request may stop waiting while the bounded fill finishes.
const readDurablyCachedExploreMarketCapCompositionV1 = unstable_cache(
  async (
    inputCommitment: `sha256:${string}`,
    direction: "asc" | "desc",
    entries: readonly ExploreEntry[],
  ): Promise<CachedExploreMarketCapCompositionV1> => {
    if (
      exploreMarketCapCompositionInputCommitmentV1(entries, direction) !==
        inputCommitment
    ) throw new Error("Explore market-cap cache input is not bound");
    const composed = await assembleExploreMarketCapCompositionV1(
      entries,
      direction,
    );
    const assembledAt = new Date().toISOString();
    if (
      !currentExploreMarketCapOrderingTimesV1(
        composed.orderingAsOfTimes,
        entries.length,
        composed.ranking.qualifiedCount,
      ) ||
      (composed.ranking.asOfTime === null &&
        (composed.ranking.observedTokenCount > 0 ||
          composed.ranking.qualifiedCount > 0)) ||
      (composed.ranking.asOfTime !== null &&
        !currentExploreMarketCapTimestampV1(composed.ranking.asOfTime))
    ) throw new Error("Explore market-cap provider snapshot is stale");
    return Object.freeze({
      schemaVersion: "programmable.explore-market-cap-composition.v1",
      inputCommitment,
      direction,
      assembledAt,
      orderedEntryIds: Object.freeze(
        composed.orderedEntries.map((entry) => entry.id),
      ),
      orderingAsOfTimes: Object.freeze([...composed.orderingAsOfTimes]),
      ranking: composed.ranking,
    });
  },
  ["programmable-explore-market-cap-composition-v1"],
  { revalidate: EXPLORE_MARKET_CAP_CACHE_REVALIDATE_SECONDS },
);

function currentExploreMarketCapTimestampV1(value: string): boolean {
  const observedAtMs = Date.parse(value);
  const nowMs = Date.now();
  return Number.isFinite(observedAtMs) &&
    new Date(observedAtMs).toISOString() === value &&
    observedAtMs <= nowMs &&
    nowMs - observedAtMs <= EXPLORE_MARKET_CAP_CACHE_MAXIMUM_AGE_MS;
}

function currentExploreMarketCapOrderingTimesV1(
  value: unknown,
  expectedLength: number,
  expectedQualifiedCount: number,
): value is readonly (string | null)[] {
  if (!Array.isArray(value) || value.length !== expectedLength) return false;
  let qualifiedCount = 0;
  for (const observedAt of value) {
    if (observedAt === null) continue;
    if (
      typeof observedAt !== "string" ||
      !currentExploreMarketCapTimestampV1(observedAt)
    ) return false;
    qualifiedCount += 1;
  }
  return qualifiedCount === expectedQualifiedCount;
}

async function waitForExploreMarketCapCompositionV1(
  pending: Promise<CachedExploreMarketCapCompositionV1>,
  signal: AbortSignal,
  deadlineMs: number,
): Promise<CachedExploreMarketCapCompositionV1> {
  if (signal.aborted || deadlineMs <= Date.now()) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(
      signal.reason ?? new DOMException("Aborted", "AbortError"),
    ));
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, Math.max(0, deadlineMs - Date.now()));
    pending.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

async function readBoundExploreMarketCapCompositionV1(
  entries: readonly ExploreEntry[],
  direction: "asc" | "desc",
  wait: Readonly<{ signal: AbortSignal; deadlineMs: number }>,
): Promise<Readonly<{
  orderedEntries: readonly ExploreEntry[];
  ranking: ExploreMarketCapRankingV1;
}>> {
  const inputCommitment = exploreMarketCapCompositionInputCommitmentV1(
    entries,
    direction,
  );
  const cached = await waitForExploreMarketCapCompositionV1(
    readDurablyCachedExploreMarketCapCompositionV1(
      inputCommitment,
      direction,
      entries,
    ),
    wait.signal,
    wait.deadlineMs,
  );
  if (
    cached.schemaVersion !==
      "programmable.explore-market-cap-composition.v1" ||
    cached.inputCommitment !== inputCommitment ||
    cached.direction !== direction ||
    !currentExploreMarketCapTimestampV1(cached.assembledAt) ||
    cached.ranking.direction !== direction ||
    cached.ranking.canonicalEntryCount !== entries.length ||
    cached.ranking.totalCount !== entries.length ||
    !/^sha256:[0-9a-f]{64}$/u.test(cached.ranking.rankingCommitment) ||
    (cached.ranking.asOfTime === null &&
      (cached.ranking.observedTokenCount > 0 ||
        cached.ranking.qualifiedCount > 0)) ||
    (cached.ranking.asOfTime !== null &&
      !currentExploreMarketCapTimestampV1(cached.ranking.asOfTime)) ||
    cached.orderedEntryIds.length !== entries.length ||
    !currentExploreMarketCapOrderingTimesV1(
      cached.orderingAsOfTimes,
      entries.length,
      cached.ranking.qualifiedCount,
    )
  ) throw new Error("Explore market-cap cache result is invalid or stale");
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  if (entriesById.size !== entries.length) {
    throw new Error("Explore market-cap cache input identities are duplicated");
  }
  const orderedIds = new Set(cached.orderedEntryIds);
  if (
    orderedIds.size !== entries.length ||
    cached.orderedEntryIds.some((id) => !entriesById.has(id))
  ) throw new Error("Explore market-cap cache order is not a permutation");
  return Object.freeze({
    orderedEntries: Object.freeze(
      cached.orderedEntryIds.map((id) => entriesById.get(id)!),
    ),
    ranking: cached.ranking,
  });
}

function generatedAgeMs(generatedAt: string): number | null {
  const value = Date.parse(generatedAt);
  return Number.isFinite(value) ? Math.max(0, Date.now() - value) : null;
}

export async function GET(request: NextRequest) {
  const deadlineMs = Date.now() + FAST_LANE_REQUEST_BUDGET_MS;
  const readSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(FAST_LANE_REQUEST_BUDGET_MS),
  ]);
  const search = request.nextUrl.searchParams;
  if (!hasCanonicalQueryShape(search) || !hasCanonicalPaginationShape(search)) {
    return NextResponse.json(
      { error: "Unsupported query parameters" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const socials = search.get("socials");
  if (socials !== null && socials !== "yes" && socials !== "no") {
    return NextResponse.json(
      { error: "Unsupported socials filter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const model = search.get("model");
  if (model !== null && model !== "classic" && model !== "custom") {
    return NextResponse.json(
      { error: "Unsupported launch model filter" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const query = search.get("q")?.trim() ?? "";
  if (query !== "" && normalizeGmgnSearchQueryV1(query) === null) {
    return NextResponse.json(
      { error: "Unsupported search query" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const chainValue = search.get("chain");
  const chain = chainValue === null ? 1 : tryParseViewChainId(chainValue);
  if (chain === null) {
    return NextResponse.json(
      { error: "Unsupported chain" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const requestedSort = parseExploreSort(search.get("sort"));
  if (requestedSort === "trending" && chain !== 1) {
    return NextResponse.json(
      { error: "Trending discovery is available on Ethereum only" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (chain === 4663) {
    const pageSize = positiveInteger(
      integerQuery(search.get("limit"), 9),
      9,
      100,
    );
    return NextResponse.json(
      {
        status: "not-deployed" as const,
        activationStage: "planned-not-deployed" as const,
        chainId: chain,
        tokens: [],
        page: 1,
        pageSize,
        total: 0,
        totalPages: 0,
        sort: requestedSort,
        query,
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=15, stale-while-revalidate=45",
          "X-Programmable-Chain-Id": String(chain),
          "X-Programmable-Read-Source": "planned-not-deployed",
        },
      },
    );
  }

  try {
    const options = {
      chain,
      query,
      sort: requestedSort,
      page: integerQuery(search.get("page"), 1),
      pageSize: integerQuery(search.get("limit"), 9),
      socials,
      model,
    } as const;
    const durableCatalogRead = readLastGoodLaunchCatalogV1({
      signal: readSignal,
      deadlineMs,
    }).then(
      boundDurableLaunchCatalogV1,
      () => null,
    );
    const catalogRead: Promise<ExploreCanonicalCatalogV1 | null> =
      readEnvioClassicV3CatalogV1({
        signal: readSignal,
        deadlineMs,
      }).then(
        (catalog) => catalog,
        async () => {
          console.error("Explore Envio identity read unavailable", {
            name: "EnvioClassicV3ReadError",
          });
          return await durableCatalogRead;
        },
      );
    const registryRead = isCustomLaunchRegistryPublicReadEnabled()
      ? readProductionCustomExploreDirectoryV1(readSignal).then(
          (entries) => ({ entries, status: "current" as const }),
          () => {
            console.error("Explore Custom Registry read unavailable", {
              name: "CustomRegistryReadError",
            });
            return { entries: [] as readonly ExploreEntry[], status: "unavailable" as const };
          },
        )
      : Promise.resolve({
          entries: [] as readonly ExploreEntry[],
          status: "unavailable" as const,
        });
    const routerRead = readFinalizedRouterCustomIdentitySnapshotV1({
      signal: readSignal,
      deadlineMs,
    }).then(
      (snapshot) => ({
        entries: snapshot.entries,
        status: snapshot.status,
        snapshot,
        verifiedIdentityCount: snapshot.entries.length,
      }),
      () => {
        console.error("Explore Router Custom read unavailable", {
          name: "RouterCustomReadError",
        });
        return {
          entries: [] as const,
          status: "unavailable" as const,
          snapshot: null,
          verifiedIdentityCount: 0,
        };
      },
    );
    const [catalog, registryCustom, routerCustom] = await Promise.all([
      catalogRead,
      registryRead,
      routerRead,
    ]);
    let customEntries = registryCustom.entries;
    let registryCustomStatus = registryCustom.status;
    let routerEntries = routerCustom.entries;
    let routerCustomStatus = routerCustom.status;
    const verifiedRouterIdentityCount = routerCustom.verifiedIdentityCount;
    if (catalog === null) {
      // Registry projects do not carry an independent onchain snapshot.
      // Only the Router lane may stand alone on its bound durable cursor.
      customEntries = [];
      registryCustomStatus = "unavailable";
    }
    let registryIdentityEntries: readonly ExploreEntry[];
    try {
      registryIdentityEntries = mergeEnvioClassicV3CatalogEntriesV1(
        catalog?.entries ?? [],
        customEntries,
      );
    } catch {
      console.error("Explore Custom Registry identity merge unavailable", {
        name: "CustomRegistryIdentityError",
      });
      customEntries = [];
      registryCustomStatus = "unavailable";
      registryIdentityEntries = catalog?.entries ?? [];
    }
    let identityEntries: readonly ExploreEntry[];
    try {
      identityEntries = mergeRouterCustomExploreEntriesV1(
        registryIdentityEntries,
        routerEntries,
      );
    } catch {
      console.error("Explore Router Custom identity merge unavailable", {
        name: "RouterCustomIdentityError",
      });
      routerEntries = [];
      routerCustomStatus = "unavailable";
      identityEntries = registryIdentityEntries;
    }
    if (
      catalog === null &&
      (routerCustom.snapshot === null ||
        routerCustomStatus === "unavailable" ||
        identityEntries.length === 0)
    ) {
      throw new Error("No validated public identity snapshot is available");
    }
    const routerAvailable = routerCustomStatus !== "unavailable";
    const acceptedRouterSnapshot = routerAvailable
      ? routerCustom.snapshot
      : null;
    const routerOwnsAggregateBoundary = acceptedRouterSnapshot !== null &&
      (catalog === null ||
        BigInt(acceptedRouterSnapshot.asOfBlock) > BigInt(catalog.asOfBlock));
    const identityAsOfBlock = routerOwnsAggregateBoundary
      ? acceptedRouterSnapshot!.asOfBlock
      : catalog!.asOfBlock;
    const identityAsOfBlockHash = routerOwnsAggregateBoundary
      ? acceptedRouterSnapshot!.asOfBlockHash
      : catalog!.asOfBlockHash;
    const identityGeneratedAt = routerOwnsAggregateBoundary
      ? acceptedRouterSnapshot!.generatedAt
      : catalog!.generatedAt;
    const publicIdentityEntries = publicExploreCatalogEntriesV1(
      identityEntries,
    ).filter((entry) => entryChainId(entry) === String(options.chain));
    const presentedPublicEntries = publicIdentityEntries.map(
      publicExplorePresentationEntryV1,
    );
    const identityCommitment = catalog === null
      ? canonicalSha256("programmable.public-identity-fallback.v1", {
          chainId: options.chain,
          launchSource: ROUTER_CUSTOM_LAUNCH_SOURCE,
          asOfBlock: identityAsOfBlock,
          entries: publicIdentityEntries,
        })
      : catalog.source === "envio-classic-v3"
        ? envioClassicV3IdentityCommitmentV1(
            catalog,
            publicIdentityEntries,
          )
        : lastGoodLaunchIdentityCommitmentV1(
            catalog,
            publicIdentityEntries,
          );
    const customStatus =
      registryCustomStatus === "current" && routerCustomStatus === "current"
        ? "current" as const
        : registryCustomStatus === "current" &&
            routerCustomStatus === "last-known-good"
          ? "last-known-good" as const
        : "unavailable" as const;
    const launchSource = exploreLaunchSourceV1({
      catalog,
      registryCustomCurrent: registryCustomStatus === "current",
      routerCustomAvailable: routerAvailable,
    });
    const projectedRouterIdentityCount = publicIdentityEntries.filter(
      (entry) => entry.exploreKind === "token" &&
        entry.launchCategoryProvenance.source === ROUTER_CUSTOM_LAUNCH_SOURCE,
    ).length;
    const catalogStatus = catalog?.status ?? "last-known-good" as const;
    const canonicalStatus = catalog?.status ?? "unavailable" as const;
    const catalogScope = catalog?.source === "envio-classic-v3"
      ? catalog.scope
      : {
          included: [] as readonly string[],
          excluded: CLASSIC_EXCLUSIONS,
          publicCategories: ["classic", "custom"] as const,
        };
    const includedSources = new Set<string>(catalogScope.included);
    if (registryCustomStatus === "current") {
      includedSources.add("registry.custom-launched");
    }
    if (routerAvailable) includedSources.add(ROUTER_CUSTOM_LAUNCH_SOURCE);
    const searchRead: Promise<GmgnSearchSnapshotV1 | null> =
      options.query === ""
        ? Promise.resolve(null)
        : readGmgnEthereumSearchV1(options.query, {
            signal: readSignal,
            deadlineMs,
          }).catch(() => null);
    let paginated: ReturnType<typeof paginateExploreEntriesV1>;
    let marketRead: ExploreMarketReadV1;
    let marketCapRanking: ExploreMarketCapRankingV1 | null = null;
    let discovery: ExploreDiscoveryRankingV1 | null = null;
    let searchRanking: ExploreSearchRankingV1 | null = null;
    if (options.sort === "market-cap" || options.sort === "market-cap-asc") {
      const localFilteredNewest = sortExploreEntries(
        filterExploreEntries(
          presentedPublicEntries,
          options.query,
          options.socials,
          options.model,
        ),
        "newest",
      );
      const direction = options.sort === "market-cap" ? "desc" : "asc";
      const searchSnapshot = await searchRead;
      const searchResult = options.query === ""
        ? null
        : rankExploreSearchEntriesV1(
            presentedPublicEntries,
            searchSnapshot,
            {
              query: options.query,
              socials: options.socials,
              model: options.model,
              fallbackSort: "newest",
            },
          );
      if (searchResult !== null) searchRanking = searchResult.search;
      const filteredNewest = searchResult?.entries ?? localFilteredNewest;
      const ranked = await readBoundExploreMarketCapCompositionV1(
        filteredNewest,
        direction,
        { signal: readSignal, deadlineMs },
      );
      marketCapRanking = ranked.ranking;
      const identityPage = paginateEntries(ranked.orderedEntries, options);
      const valued = await readExploreMarketEntriesV1(
        identityPage.tokens,
        { signal: readSignal, deadlineMs },
      );
      marketRead = valued.marketRead;
      paginated = { ...identityPage, tokens: [...valued.entries] };
    } else if (options.sort === "trending") {
      const canonicalFilterUniverse = filterExploreEntries(
        presentedPublicEntries,
        "",
        options.socials,
        options.model,
      );
      const localFilteredNewest = sortExploreEntries(
        filterExploreEntries(
          presentedPublicEntries,
          options.query,
          options.socials,
          options.model,
        ),
        "newest",
      );
      const [rank, searchSnapshot] = await Promise.all([
        canonicalFilterUniverse.length === 0
          ? Promise.resolve(null)
          : readGmgnEthereumTrendingV1(
              { interval: "1h", limit: 100 },
              { signal: readSignal, deadlineMs },
            ).catch(() => null),
        searchRead,
      ]);
      const searchResult = options.query === ""
        ? null
        : rankExploreSearchEntriesV1(
            presentedPublicEntries,
            searchSnapshot,
            {
              query: options.query,
              socials: options.socials,
              model: options.model,
              fallbackSort: "newest",
            },
          );
      if (searchResult !== null) searchRanking = searchResult.search;
      const filteredNewest = searchResult?.entries ?? localFilteredNewest;
      const snapshots: GmgnDiscoverySnapshotV1[] = [];
      if (filteredNewest.length > 0) {
        if (rank !== null) snapshots.push(rank);
        const rankCoverage = rankCanonicalExploreEntriesWithGmgnDiscoveryV1(
          filteredNewest,
          snapshots,
        ).coverage;
        const hotSearchDeadlineMs = deadlineMs - 2_500;
        const hotSearchCanAddCoverage =
          rankCoverage.gmgnMatchedUniqueTokenCount <
            rankCoverage.canonicalUniqueTokenCount;
        if (
          hotSearchCanAddCoverage &&
          hotSearchDeadlineMs - Date.now() >= 3_000
        ) {
          const hotSearch = await readGmgnEthereumHotSearchesV1(
            { interval: "24h", limit: 100 },
            { signal: readSignal, deadlineMs: hotSearchDeadlineMs },
          ).catch(() => null);
          if (hotSearch !== null) snapshots.push(hotSearch);
        }
      }
      const trendingPage = paginateTrendingExploreEntriesV1(
        filteredNewest,
        snapshots,
        {
          ...options,
          query: "",
          socials: null,
          model: null,
        },
      );
      discovery = trendingPage.discovery;
      const valued = await readExploreMarketEntriesV1(
        trendingPage.paginated.tokens,
        { signal: readSignal, deadlineMs },
      );
      marketRead = valued.marketRead;
      paginated = {
        ...trendingPage.paginated,
        tokens: [...valued.entries],
      };
    } else {
      const searchSnapshot = await searchRead;
      const searchResult = options.query === ""
        ? null
        : rankExploreSearchEntriesV1(
            presentedPublicEntries,
            searchSnapshot,
            {
              query: options.query,
              socials: options.socials,
              model: options.model,
              fallbackSort: options.sort,
            },
          );
      if (searchResult !== null) searchRanking = searchResult.search;
      const identityPage = searchResult === null
        ? paginateExploreEntriesV1(presentedPublicEntries, options)
        : paginateEntries(searchResult.entries, options);
      const valued = await readExploreMarketEntriesV1(
        identityPage.tokens,
        { signal: readSignal, deadlineMs },
      );
      marketRead = valued.marketRead;
      paginated = { ...identityPage, tokens: [...valued.entries] };
    }
    const pageEntries = paginated.tokens.map(
      publicExplorePresentationEntryV1,
    ) as ValuedExploreEntry[];
    const dataQuality = buildExploreDataQuality({
      entries: pageEntries,
      generatedAt: identityGeneratedAt,
      canonicalStatus,
      customStatus,
      identityAsOfBlock,
      referenceBlock: identityAsOfBlock,
      identityAgeMs: generatedAgeMs(identityGeneratedAt),
    });
    const marketSort = options.sort === "market-cap" ||
      options.sort === "market-cap-asc";
    const marketProvider = exploreMarketProviderHeaderV1(marketRead);
    const marketSources = exploreMarketSourcesV1(marketRead);
    const priceSources = exploreMarketPriceSourcesV1(marketRead);

    return NextResponse.json(
      {
        status: "ready" as const,
        chainId: options.chain,
        ...paginated,
        tokens: pageEntries.map(publicExploreEntryV1),
        sort: options.sort,
        query: options.query,
        sortMetric: options.sort === "trending"
          ? "gmgn-trending" as const
          : marketSort
            ? "gmgn-market-cap+gmgn-token-info-fdv+dexscreener-fdv-fallback" as const
            : "fdv" as const,
        dataQuality,
        snapshot: null,
        marketRead,
        ...(discovery === null ? {} : { discovery }),
        ...(searchRanking === null ? {} : { search: searchRanking }),
        catalog: {
          source: catalog?.source ?? ("envio-classic-v3" as const),
          launchSource,
          status: catalogStatus,
          lastIndexedAt: identityGeneratedAt,
          asOfBlock: identityAsOfBlock,
          asOfBlockHash: identityAsOfBlockHash,
          identityCount: publicIdentityEntries.length,
          identityCommitment,
          completeness: {
            ...(catalog?.completeness ?? {
              classic: "unavailable" as const,
              stock: "excluded" as const,
              custom: "unavailable" as const,
            }),
            custom: customStatus,
            registryCustom: registryCustomStatus,
            routerCustom: routerCustomStatus,
          },
          ...(catalog?.source === "durable-blob"
            ? { evidence: catalog.evidence }
            : {
                scope: {
                  ...catalogScope,
                  included: [...includedSources],
                },
                ...(catalog ? { evidence: catalog.evidence } : {}),
              }),
          routerStamp: {
            source: ROUTER_CUSTOM_LAUNCH_SOURCE,
            status: routerCustomStatus,
            finalityConfirmations: ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
            verifiedIdentityCount: routerAvailable
              ? verifiedRouterIdentityCount
              : 0,
            projectedIdentityCount: projectedRouterIdentityCount,
            ...(acceptedRouterSnapshot
              ? {
                  generatedAt: acceptedRouterSnapshot.generatedAt,
                  asOfBlock: acceptedRouterSnapshot.asOfBlock,
                  asOfBlockHash: acceptedRouterSnapshot.asOfBlockHash,
                  identityCommitment:
                    acceptedRouterSnapshot.identityCommitment,
                }
              : {}),
          },
        },
        ...(marketCapRanking === null ? {} : { ranking: marketCapRanking }),
      },
      {
        headers: {
          "Cache-Control":
            "public, max-age=0, s-maxage=15, stale-while-revalidate=45",
          "X-Programmable-Data-Quality": dataQuality.status,
          "X-Programmable-Chain-Id": String(options.chain),
          "X-Programmable-Launch-Source": launchSource,
          "X-Programmable-Read-Source": `${launchSource}+${marketProvider}${
            discovery !== null && discovery.status !== "unavailable"
              ? "+gmgn-discovery"
              : ""
          }${
            marketCapRanking !== null &&
              marketCapRanking.gmgnStatus !== "unavailable"
              ? "+gmgn-ranking"
              : ""
          }${
            searchRanking !== null && searchRanking.asOfTime !== null
              ? "+gmgn-search"
              : ""
          }`,
          "X-Programmable-Market-Read-Status": marketRead.status,
          "X-Programmable-Market-Provider": marketProvider,
          "X-Programmable-Canonical-Read-Status": canonicalStatus,
          "X-Programmable-Router-Read-Status": routerCustomStatus,
          ...(discovery === null
            ? {}
            : {
                "X-Programmable-Discovery-Provider": "gmgn",
                "X-Programmable-Discovery-Read-Status": discovery.status,
                "X-Programmable-Discovery-Matched-Count":
                  String(discovery.matchedTokenCount),
                "X-Programmable-Discovery-Matched-Unique-Count":
                  String(discovery.matchedUniqueTokenCount),
                "X-Programmable-Discovery-Ranking-Commitment":
                  discovery.rankingCommitment,
              }),
          ...(marketCapRanking === null
            ? {}
            : {
                "X-Programmable-Ranking-Primary-Provider": "gmgn",
                "X-Programmable-Ranking-Source": marketCapRanking.source,
                "X-Programmable-Ranking-Read-Status":
                  marketCapRanking.status,
                "X-Programmable-Ranking-GMGN-Status":
                  marketCapRanking.gmgnStatus,
                "X-Programmable-Ranking-Commitment":
                  marketCapRanking.rankingCommitment,
              }),
          ...(searchRanking === null
            ? {}
            : {
                "X-Programmable-Search-Provider": "gmgn",
                "X-Programmable-Search-Read-Status": searchRanking.status,
                "X-Programmable-Search-Matched-Count":
                  String(searchRanking.matchedTokenCount),
                "X-Programmable-Search-Matched-Unique-Count":
                  String(searchRanking.matchedUniqueTokenCount),
                "X-Programmable-Search-Ranking-Commitment":
                  searchRanking.rankingCommitment,
              }),
          ...(marketSources.length > 0
            ? {
                "X-Programmable-Market-Source": marketSources.join("+"),
              }
            : {}),
          ...(priceSources.length > 0
            ? { "X-Programmable-Price-Source": priceSources.join("+") }
            : {}),
          ...(dataQuality.valuation.asOfTime
            ? { "X-Programmable-Market-As-Of": dataQuality.valuation.asOfTime }
            : {}),
          "X-Programmable-Identity-Last-Indexed-At": identityGeneratedAt,
        },
      },
    );
  } catch (error) {
    console.error("Explore read failed", safeOperationalRpcError(error));
    return NextResponse.json(
      { error: "Token data is temporarily unavailable" },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": "5",
          "X-Programmable-Launch-Source": "envio-classic-v3",
          "X-Programmable-Read-Source": "envio-classic-v3",
        },
      },
    );
  }
}
