import { NextRequest, NextResponse } from "next/server";

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
  isGmgnDiscoverySnapshotV1,
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
import {
  canonicalizeJson,
  parseStrictJson,
} from "../../../lib/server/projection-target/canonical-json";
import {
  EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_AGE_MS,
  EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_BYTES,
  EXPLORE_MARKET_CAP_AUTHORITY_POSITIVE_REFRESH_MS,
  exploreMarketCapAuthorityStorageCommitmentV1,
  getProductionExploreMarketCapAuthorityStoreV1,
  type ExploreMarketCapAuthorityCandidateV1,
} from "../../../lib/market-data/explore-market-cap-authority.server";
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
const MARKET_CAP_AUTHORITY_BUILD_BUDGET_MS = FAST_LANE_REQUEST_BUDGET_MS;
const MARKET_CAP_AUTHORITY_PUBLISH_RESERVE_MS = 3_000;
const MARKET_CAP_REQUEST_BUDGET_MS = 12_000;
const EXPLORE_MARKET_CAP_AUTHORITY_COMPOSITION_POLICY_V3 =
  "gmgn-qualified-rank+oldest-first-sentinels+cyclic-supply+same-bucket-supply-priority+cyclic-token-info+dexscreener.v3";
const SHA256_COMMITMENT = /^sha256:[0-9a-f]{64}$/u;
const UNSIGNED_INTEGER = /^(?:0|[1-9][0-9]*)$/u;
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
  "rankingCommitment",
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

function marketCapRankingIdentityCommitmentV1(
  orderedEntries: readonly ExploreEntry[],
  direction: "asc" | "desc",
): `sha256:${string}` {
  return canonicalSha256(
    "programmable.explore-market-cap-ranking-identity-commitment.v1",
    {
      direction,
      orderedCanonicalEntries: orderedEntries.map((entry, index) => ({
        index,
        ...exactOrderedMarketIdentityV1(entry),
      })),
    },
  );
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
  const rankingCommitment = marketCapRankingIdentityCommitmentV1(
    hybrid.entries,
    direction,
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

type ExactOrderedMarketIdentityV1 = Readonly<{
  id: string;
  tokenAddress: string | null;
  marketIdentities: ReturnType<typeof exploreEntryMarketIdentitiesV1>;
}>;

type ExploreMarketCapProviderEvidenceV1 = Readonly<{
  id: string;
  valueWad: string | null;
  asOfTime: string | null;
}>;

type ExploreMarketCapFilterFacetV1 = Readonly<{
  id: string;
  name: string;
  symbol: string | null;
  modelId: string | null;
  category: "classic" | "custom";
  hasSocials: boolean;
}>;

type ExploreMarketCapAuthorityV1 = Readonly<{
  schemaVersion: "programmable.explore-market-cap-authority.v2";
  inputCommitment: `sha256:${string}`;
  direction: "asc" | "desc";
  generatedAt: string;
  rankSnapshot: GmgnDiscoverySnapshotV1 | null;
  filterFacets: readonly ExploreMarketCapFilterFacetV1[];
  gmgnHydrationEligibleEntryIds: readonly string[];
  gmgnRequestedEntryIds: readonly string[];
  gmgnEvidence: readonly ExploreMarketCapProviderEvidenceV1[];
  dexscreenerRequestedEntryIds: readonly string[];
  dexscreenerEvidence: readonly ExploreMarketCapProviderEvidenceV1[];
  orderedIdentities: readonly ExactOrderedMarketIdentityV1[];
  ranking: ExploreMarketCapRankingV1;
}>;

function exactOrderedMarketIdentityV1(
  entry: ExploreEntry,
): ExactOrderedMarketIdentityV1 {
  return Object.freeze({
    id: entry.id,
    tokenAddress: entry.tokenAddress?.toLowerCase() ?? null,
    marketIdentities: Object.freeze(
      exploreEntryMarketIdentitiesV1(entry).map((identity) =>
        Object.freeze({ ...identity })
      ),
    ),
  });
}

function exploreMarketCapFilterFacetV1(
  entry: ExploreEntry,
): ExploreMarketCapFilterFacetV1 {
  const category = entry.launchCategoryProvenance.category;
  return Object.freeze({
    id: entry.id,
    name: entry.name,
    symbol: entry.symbol ?? null,
    modelId: entry.exploreKind === "custom-project" ? entry.modelId : null,
    category: category === "classic" || category === "custom"
      ? category
      : entry.exploreKind === "custom-project" ? "custom" : "classic",
    hasSocials: entry.links?.some(
      (link) => link.kind === "x" || link.kind === "telegram",
    ) ?? false,
  });
}

function marketCapAuthorityPinCommitmentV1(
  orderedEntries: readonly ExploreEntry[],
  filterFacets: readonly ExploreMarketCapFilterFacetV1[],
  direction: "asc" | "desc",
): `sha256:${string}` | null {
  const facetsById = new Map(
    filterFacets.map((facet) => [facet.id, facet] as const),
  );
  if (
    facetsById.size !== filterFacets.length ||
    orderedEntries.length !== filterFacets.length
  ) return null;
  const orderedCanonicalEntries = orderedEntries.flatMap((entry, index) => {
    const filterFacet = facetsById.get(entry.id);
    return filterFacet === undefined
      ? []
      : [{
          index,
          identity: exactOrderedMarketIdentityV1(entry),
          filterFacet,
        }];
  });
  if (orderedCanonicalEntries.length !== orderedEntries.length) return null;
  return canonicalSha256(
    "programmable.explore-market-cap-authority-pin.v2",
    { direction, orderedCanonicalEntries },
  );
}

export function exploreMarketCapAuthorityInputCommitmentV1(
  entries: readonly ExploreEntry[],
): `sha256:${string}` {
  return canonicalSha256(
    "programmable.explore-market-cap-authority-input.v3",
    {
      compositionPolicy: EXPLORE_MARKET_CAP_AUTHORITY_COMPOSITION_POLICY_V3,
      orderedCanonicalIdentities: entries.map((entry, index) => ({
        index,
        ...exactOrderedMarketIdentityV1(entry),
      })),
    },
  );
}

function currentMarketCapAuthorityTimestampV1(
  value: string,
  nowMs: number,
): boolean {
  const timestampMs = Date.parse(value);
  return Number.isFinite(timestampMs) &&
    new Date(timestampMs).toISOString() === value &&
    Number.isFinite(nowMs) && timestampMs <= nowMs &&
    nowMs - timestampMs <= EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_AGE_MS;
}

function valuedEntryProviderTimeV1(
  entry: ValuedExploreEntry,
): string | null {
  if (
    entry.valuation.status === "available" &&
      typeof entry.valuation.asOfTime === "string"
  ) return entry.valuation.asOfTime;
  return typeof entry.gmgnMarketData?.fetchedAt === "string"
    ? entry.gmgnMarketData.fetchedAt
    : null;
}

function exactEntryMapV1(
  entries: readonly ExploreEntry[],
): ReadonlyMap<string, ExploreEntry> | null {
  const byId = new Map<string, ExploreEntry>();
  for (const entry of entries) {
    if (byId.has(entry.id)) return null;
    byId.set(entry.id, entry);
  }
  return byId;
}

function exactAuthorityOrderedEntriesV1(
  authority: ExploreMarketCapAuthorityV1,
  canonicalEntries: readonly ExploreEntry[],
): readonly ExploreEntry[] | null {
  const byId = exactEntryMapV1(canonicalEntries);
  if (byId === null || authority.orderedIdentities.length !== byId.size) {
    return null;
  }
  const seen = new Set<string>();
  const ordered: ExploreEntry[] = [];
  for (const identity of authority.orderedIdentities) {
    const entry = byId.get(identity.id);
    if (
      entry === undefined || seen.has(identity.id) ||
      canonicalizeJson(identity) !==
        canonicalizeJson(exactOrderedMarketIdentityV1(entry))
    ) return null;
    seen.add(identity.id);
    ordered.push(entry);
  }
  return seen.size === byId.size ? Object.freeze(ordered) : null;
}

function exactStringIdsV1(
  values: readonly string[],
  canonicalById: ReadonlyMap<string, ExploreEntry>,
): boolean {
  return values.length === new Set(values).size &&
    values.every((value) => canonicalById.has(value));
}

function compactProviderEvidenceV1(
  entries: readonly ValuedExploreEntry[],
  provider: "gmgn" | "dexscreener",
  now: Date,
): readonly ExploreMarketCapProviderEvidenceV1[] {
  const seen = new Set<string>();
  const result: ExploreMarketCapProviderEvidenceV1[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    const asOfTime = valuedEntryProviderTimeV1(entry);
    const currentAsOfTime = asOfTime !== null &&
      currentMarketCapAuthorityTimestampV1(asOfTime, now.getTime())
      ? asOfTime
      : null;
    if (entry.valuation.status === "available") {
      if (
        entry.valuation.source !== provider ||
        currentAsOfTime === null ||
        !UNSIGNED_INTEGER.test(entry.valuation.valueWad) ||
        BigInt(entry.valuation.valueWad) === 0n
      ) continue;
      result.push(Object.freeze({
        id: entry.id,
        valueWad: entry.valuation.valueWad,
        asOfTime: currentAsOfTime,
      }));
    } else {
      result.push(Object.freeze({
        id: entry.id,
        valueWad: null,
        asOfTime: currentAsOfTime,
      }));
    }
    seen.add(entry.id);
  }
  return Object.freeze(result);
}

function providerEvidenceEntriesV1(
  evidence: readonly ExploreMarketCapProviderEvidenceV1[],
  canonicalById: ReadonlyMap<string, ExploreEntry>,
  provider: "gmgn" | "dexscreener",
): readonly ValuedExploreEntry[] | null {
  const seen = new Set<string>();
  const result: ValuedExploreEntry[] = [];
  for (const item of evidence) {
    const entry = canonicalById.get(item.id);
    if (entry === undefined || seen.has(item.id)) return null;
    seen.add(item.id);
    result.push(Object.freeze({
      ...entry,
      valuation: item.valueWad === null
        ? Object.freeze({
            status: "unavailable" as const,
            reason: "source-unavailable" as const,
          })
        : Object.freeze({
            status: "available" as const,
            metric: "fdv" as const,
            supplyBasis: "total" as const,
            currency: "usd" as const,
            valueWad: item.valueWad,
            freshness: "provider-recent" as const,
            source: provider,
            asOfTime: item.asOfTime!,
          }),
    }));
  }
  return Object.freeze(result);
}

function entriesForExactIdsV1(
  ids: readonly string[],
  canonicalById: ReadonlyMap<string, ExploreEntry>,
): readonly ExploreEntry[] | null {
  if (!exactStringIdsV1(ids, canonicalById)) return null;
  return Object.freeze(ids.map((id) => canonicalById.get(id)!));
}

function authorityFallbackInputV1(
  authority: ExploreMarketCapAuthorityV1,
  canonicalEntries: readonly ExploreEntry[],
): Parameters<typeof rankCanonicalExploreMarketCapEntriesWithGmgnV1>[2] | null {
  const canonicalById = exactEntryMapV1(canonicalEntries);
  if (
    canonicalById === null ||
    authority.filterFacets.length !== canonicalById.size ||
    authority.filterFacets.length !==
      new Set(authority.filterFacets.map((facet) => facet.id)).size ||
    authority.filterFacets.some((facet) => !canonicalById.has(facet.id)) ||
    !exactStringIdsV1(
      authority.gmgnHydrationEligibleEntryIds,
      canonicalById,
    )
  ) return null;
  const gmgnRequestedEntries = entriesForExactIdsV1(
    authority.gmgnRequestedEntryIds,
    canonicalById,
  );
  const dexscreenerRequestedEntries = entriesForExactIdsV1(
    authority.dexscreenerRequestedEntryIds,
    canonicalById,
  );
  const gmgnEntries = providerEvidenceEntriesV1(
    authority.gmgnEvidence,
    canonicalById,
    "gmgn",
  );
  const dexscreenerEntries = providerEvidenceEntriesV1(
    authority.dexscreenerEvidence,
    canonicalById,
    "dexscreener",
  );
  if (
    gmgnRequestedEntries === null || dexscreenerRequestedEntries === null ||
    gmgnEntries === null || dexscreenerEntries === null
  ) return null;
  const gmgnRequestedIds = new Set(authority.gmgnRequestedEntryIds);
  const dexscreenerRequestedIds = new Set(
    authority.dexscreenerRequestedEntryIds,
  );
  if (
    authority.gmgnEvidence.some((item) => !gmgnRequestedIds.has(item.id)) ||
    authority.dexscreenerEvidence.some(
      (item) => !dexscreenerRequestedIds.has(item.id),
    )
  ) return null;
  return Object.freeze({
    gmgnHydrationLimit: GMGN_MARKET_CAP_HYDRATION_LIMIT,
    gmgnHydrationEligibleEntryCount:
      authority.gmgnHydrationEligibleEntryIds.length,
    gmgnRequestedEntries,
    gmgnEntries,
    dexscreenerRequestedEntries,
    dexscreenerEntries,
  });
}

function frozenFilterIdsV1(
  authority: ExploreMarketCapAuthorityV1,
  input: Readonly<{
    query: string;
    socials: "yes" | "no" | null;
    model: "classic" | "custom" | null;
  }>,
): ReadonlySet<string> {
  const normalized = input.query.trim().toLowerCase().replace(/^\$/u, "");
  const tokenAddressById = new Map(
    authority.orderedIdentities.map((identity) => [
      identity.id,
      identity.tokenAddress,
    ] as const),
  );
  return new Set(authority.filterFacets.flatMap((facet) => {
    if (input.model !== null && facet.category !== input.model) return [];
    if (
      input.socials !== null &&
      facet.hasSocials !== (input.socials === "yes")
    ) return [];
    if (
      normalized !== "" &&
      !facet.name.toLowerCase().includes(normalized) &&
      !(facet.symbol?.toLowerCase().includes(normalized) ?? false) &&
      !(tokenAddressById.get(facet.id)?.includes(normalized) ?? false) &&
      !(facet.modelId?.toLowerCase().includes(normalized) ?? false)
    ) return [];
    return [facet.id];
  }));
}

function marketCapAuthorityCurrentV1(
  authority: ExploreMarketCapAuthorityV1,
  input: Readonly<{
    inputCommitment: `sha256:${string}`;
    direction: "asc" | "desc";
    canonicalEntries: readonly ExploreEntry[];
    now?: Date;
  }>,
): boolean {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const ordered = exactAuthorityOrderedEntriesV1(
    authority,
    input.canonicalEntries,
  );
  const fallback = authorityFallbackInputV1(
    authority,
    input.canonicalEntries,
  );
  const authorityPin = ordered === null
    ? null
    : marketCapAuthorityPinCommitmentV1(
        ordered,
        authority.filterFacets,
        input.direction,
      );
  if (
    authority.schemaVersion !==
      "programmable.explore-market-cap-authority.v2" ||
    authority.inputCommitment !== input.inputCommitment ||
    authority.direction !== input.direction || ordered === null ||
    fallback === null || authorityPin === null ||
    !currentMarketCapAuthorityTimestampV1(authority.generatedAt, nowMs) ||
    authority.ranking.direction !== input.direction ||
    authority.ranking.totalCount !== input.canonicalEntries.length ||
    authority.ranking.canonicalEntryCount !== input.canonicalEntries.length ||
    authority.ranking.rankingCommitment !== authorityPin
  ) return false;
  const providerTimes = [
    ...(authority.rankSnapshot === null
      ? []
      : [authority.rankSnapshot.fetchedAt]),
    ...authority.gmgnEvidence.flatMap((item) =>
      item.asOfTime === null ? [] : [item.asOfTime]
    ),
    ...authority.dexscreenerEvidence.flatMap((item) =>
      item.asOfTime === null ? [] : [item.asOfTime]
    ),
  ];
  if (!providerTimes.every((value) =>
    currentMarketCapAuthorityTimestampV1(value, nowMs)
  )) return false;
  const rebuilt = exploreMarketCapRankingV1(
    sortExploreEntries(input.canonicalEntries, "newest"),
    authority.rankSnapshot,
    fallback,
    input.direction,
    now,
  );
  return canonicalizeJson({
    ...rebuilt.ranking,
    rankingCommitment: authorityPin,
  }) === canonicalizeJson(authority.ranking) &&
    rebuilt.ranking.rankingCommitment ===
      marketCapRankingIdentityCommitmentV1(ordered, input.direction) &&
    rebuilt.orderedEntries.every((entry, index) => entry.id === ordered[index]?.id);
}

function filterEntriesByIdsV1<Entry extends ExploreEntry>(
  entries: readonly Entry[],
  ids: ReadonlySet<string>,
): readonly Entry[] {
  return entries.filter((entry) => ids.has(entry.id));
}

function projectExploreMarketCapAuthorityV1(
  authority: ExploreMarketCapAuthorityV1,
  canonicalEntries: readonly ExploreEntry[],
  input: Readonly<{
    inputCommitment: `sha256:${string}`;
    direction: "asc" | "desc";
    query: string;
    socials: "yes" | "no" | null;
    model: "classic" | "custom" | null;
    now?: Date;
  }>,
): Readonly<{
  orderedEntries: readonly ExploreEntry[];
  ranking: ExploreMarketCapRankingV1;
}> | null {
  const now = input.now ?? new Date();
  if (!marketCapAuthorityCurrentV1(authority, {
    inputCommitment: input.inputCommitment,
    direction: input.direction,
    canonicalEntries,
    now,
  })) return null;
  const authorityOrder = exactAuthorityOrderedEntriesV1(
    authority,
    canonicalEntries,
  );
  const fullFallback = authorityFallbackInputV1(authority, canonicalEntries);
  if (authorityOrder === null || fullFallback === null) return null;
  if (input.query === "" && input.socials === null && input.model === null) {
    return Object.freeze({
      orderedEntries: authorityOrder,
      ranking: authority.ranking,
    });
  }
  const filteredIds = frozenFilterIdsV1(authority, input);
  const filteredNewest = sortExploreEntries(
    canonicalEntries.filter((entry) => filteredIds.has(entry.id)),
    "newest",
  );
  const frozenFilteredOrder = authorityOrder.filter((entry) =>
    filteredIds.has(entry.id)
  );
  const ranked = exploreMarketCapRankingV1(
    filteredNewest,
    authority.rankSnapshot,
    {
      gmgnHydrationLimit: GMGN_MARKET_CAP_HYDRATION_LIMIT,
      gmgnHydrationEligibleEntryCount:
        authority.gmgnHydrationEligibleEntryIds.filter((id) =>
          filteredIds.has(id)
        ).length,
      gmgnRequestedEntries: filterEntriesByIdsV1(
        fullFallback.gmgnRequestedEntries,
        filteredIds,
      ),
      gmgnEntries: filterEntriesByIdsV1(
        fullFallback.gmgnEntries,
        filteredIds,
      ),
      dexscreenerRequestedEntries: filterEntriesByIdsV1(
        fullFallback.dexscreenerRequestedEntries,
        filteredIds,
      ),
      dexscreenerEntries: filterEntriesByIdsV1(
        fullFallback.dexscreenerEntries,
        filteredIds,
      ),
    },
    input.direction,
    now,
  );
  if (
    ranked.orderedEntries.length !== frozenFilteredOrder.length ||
    ranked.orderedEntries.some(
      (entry, index) => entry.id !== frozenFilteredOrder[index]?.id,
    ) ||
    ranked.ranking.rankingCommitment !==
      marketCapRankingIdentityCommitmentV1(
        frozenFilteredOrder,
        input.direction,
      )
  ) return null;
  return Object.freeze({
    orderedEntries: Object.freeze(frozenFilteredOrder),
    // The public pin names the retained full-universe generation. Query,
    // model, and social filters are deterministic projections of that one
    // identity order and therefore share its page/limit-independent pin.
    ranking: Object.freeze({
      ...ranked.ranking,
      rankingCommitment: authority.ranking.rankingCommitment,
    }),
  });
}

export function selectMarketCapCyclicHydrationEntriesV1<Entry extends ExploreEntry>(
  eligibleEntries: readonly Entry[],
  limit: number,
  now: Date,
  priorityEntries: readonly Entry[] = [],
  priorityReservation = priorityEntries.length,
): readonly Entry[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) return Object.freeze([]);
  const uniqueEligible: Entry[] = [];
  const seenIds = new Set<string>();
  for (const entry of eligibleEntries) {
    if (seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    uniqueEligible.push(entry);
  }
  if (uniqueEligible.length <= 1) return Object.freeze(uniqueEligible);

  const first = uniqueEligible[0]!;
  const last = uniqueEligible.at(-1)!;
  if (limit === 1) return Object.freeze([last]);
  if (
    !Number.isSafeInteger(priorityReservation) ||
    priorityReservation < 0 ||
    priorityReservation > limit - 2
  ) {
    throw new TypeError("Market-cap hydration priority reservation is invalid");
  }
  const sentinelIds = new Set([first.id, last.id]);
  const priorityIds = new Set(priorityEntries.map((entry) => entry.id));
  const priority = uniqueEligible.filter((entry) =>
    priorityIds.has(entry.id) && !sentinelIds.has(entry.id)
  );
  if (priority.length > priorityReservation) {
    throw new TypeError("Market-cap hydration priority exceeds reservation");
  }
  const prefix = [last, first, ...priority];
  if (prefix.length > limit) {
    throw new TypeError("Market-cap hydration priority exceeds request bound");
  }
  const prefixIds = new Set(prefix.map((entry) => entry.id));
  const rotating = uniqueEligible.slice(1, -1);
  if (rotating.every((entry) => prefixIds.has(entry.id)) || prefix.length === limit) {
    return Object.freeze(prefix);
  }
  // Reserve a stable part of every request for same-bucket supply successes.
  // The rotation remains anchored to the unchanged global interior, so
  // changing priority identities cannot shift its geometry and starve another
  // canonical token forever.
  const windowSize = Math.min(
    limit - 2 - priorityReservation,
    rotating.length,
  );
  if (windowSize <= 0) return Object.freeze(prefix);
  const cycleLength = Math.ceil(rotating.length / windowSize);
  const nowMs = now.getTime();
  const refreshBucket = Number.isFinite(nowMs)
    ? Math.floor(nowMs / EXPLORE_MARKET_CAP_AUTHORITY_POSITIVE_REFRESH_MS)
    : 0;
  const cycleIndex = ((refreshBucket % cycleLength) + cycleLength) % cycleLength;
  const windowStart = cycleIndex * windowSize;
  const window: Entry[] = [];
  const targetCount = Math.min(limit, uniqueEligible.length);
  for (
    let offset = 0;
    offset < rotating.length && prefix.length + window.length < targetCount;
    offset += 1
  ) {
    const entry = rotating[(windowStart + offset) % rotating.length]!;
    if (prefixIds.has(entry.id)) continue;
    prefixIds.add(entry.id);
    window.push(entry);
  }
  return Object.freeze([...prefix, ...window]);
}

async function buildExploreMarketCapAuthorityV1(
  canonicalEntries: readonly ExploreEntry[],
  inputCommitment: `sha256:${string}`,
  direction: "asc" | "desc",
  input: Readonly<{ deadlineMs: number }>,
): Promise<ExploreMarketCapAuthorityCandidateV1> {
  const authorityDeadlineMs = Math.min(
    input.deadlineMs - MARKET_CAP_AUTHORITY_PUBLISH_RESERVE_MS,
    Date.now() + MARKET_CAP_AUTHORITY_BUILD_BUDGET_MS,
  );
  if (authorityDeadlineMs <= Date.now()) {
    throw new TypeError("Market-cap authority build deadline elapsed");
  }
  const authoritySignal = AbortSignal.timeout(
    Math.max(1, authorityDeadlineMs - Date.now()),
  );
  const newestEntries = sortExploreEntries(canonicalEntries, "newest");
  const rankOptions = {
    interval: "1h" as const,
    limit: 100,
    orderBy: "marketcap" as const,
    direction,
  } as const;
  const rankWait = {
    signal: authoritySignal,
    deadlineMs: authorityDeadlineMs,
  };
  const rankCandidate = canonicalEntries.length === 0
    ? null
    : await (async () => {
        const first = await readGmgnEthereumTrendingV1(
          rankOptions,
          rankWait,
        ).catch(() => null);
        if (
          first !== null ||
          rankWait.signal.aborted ||
          authorityDeadlineMs - Date.now() <
            GMGN_MARKET_CAP_RETRY_MINIMUM_REMAINING_MS
        ) return first;
        return readGmgnEthereumTrendingV1(
          rankOptions,
          rankWait,
        ).catch(() => null);
      })();
  const rank = rankCandidate?.kind === "trending" &&
      rankCandidate.orderBy === "marketcap" &&
      rankCandidate.direction === direction &&
      currentMarketCapAuthorityTimestampV1(
        rankCandidate.fetchedAt,
        Date.now(),
      )
    ? rankCandidate
    : null;
  const authorityNow = new Date();
  const primary = rankCanonicalExploreMarketCapPrimaryWithGmgnV1(
    newestEntries,
    rank === null ? [] : [rank],
    direction,
    authorityNow,
  );
  const unobserved = primary.rows.flatMap((row) =>
    row.gmgn === null ? [row.entry] : []
  );
  const supplyRequired = unobserved.filter(
    canonicalTokenSupplyHydrationRequiredV1,
  );
  const supplyRequested = selectMarketCapCyclicHydrationEntriesV1(
    supplyRequired,
    MARKET_CAP_SUPPLY_HYDRATION_LIMIT,
    authorityNow,
  );
  const supplyDeadlineMs = authorityDeadlineMs -
    GMGN_MARKET_CAP_HYDRATION_RESERVE_MS;
  const hydratedSupply = supplyRequested.length === 0 ||
      supplyDeadlineMs <= Date.now()
    ? []
    : await hydrateMissingCanonicalTokenSupplyBoundedV1(
        supplyRequested,
        {
          signal: authoritySignal,
          deadlineMs: supplyDeadlineMs,
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
  // A qualified global GMGN market-cap observation proves provider liveness
  // even when every observed token is foreign to Programmable. Direct
  // token_info then remains the canonical coverage lane. Empty, unavailable,
  // or fully disqualified rank responses fail closed without provider fanout.
  const gmgnRankObserved =
    primary.coverage.gmgnObservedUniqueTokenCount > 0;
  const gmgnHydrationEligible = gmgnRankObserved
    ? hydrationUniverse.filter(gmgnVisibleMarketEntryEligibleV1)
    : [];
  const gmgnRequested = selectMarketCapCyclicHydrationEntriesV1(
    gmgnHydrationEligible,
    GMGN_MARKET_CAP_HYDRATION_LIMIT,
    authorityNow,
    [...hydratedSupplyById.values()],
    MARKET_CAP_SUPPLY_HYDRATION_LIMIT,
  );
  const gmgnHydrationDeadlineMs = authorityDeadlineMs -
    GMGN_MARKET_CAP_HYDRATION_RESERVE_MS;
  const gmgnSnapshots = gmgnRequested.length > 0 &&
      gmgnHydrationDeadlineMs > Date.now()
    ? await readGmgnExploreSnapshotsV1(gmgnRequested, {
        signal: authoritySignal,
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
    const providerTime = hydrated === null
      ? null
      : valuedEntryProviderTimeV1(hydrated);
    return hydrated === null || providerTime === null ||
        !currentMarketCapAuthorityTimestampV1(providerTime, Date.now())
      ? []
      : [hydrated];
  });
  const gmgnQualifiedIds = new Set(gmgnHydratedEntries.flatMap((entry) =>
    valuationSortValue(entry) === null ? [] : [entry.id]
  ));
  const dexscreenerRequested = hydrationUniverse.filter(
    (entry) => !gmgnQualifiedIds.has(entry.id),
  );
  const fallback = await readDexscreenerExploreEntriesV1(
    dexscreenerRequested,
    {
      signal: authoritySignal,
      deadlineMs: authorityDeadlineMs,
    },
  ).catch(() => ({ entries: [] as readonly ValuedExploreEntry[] }));
  const dexscreenerEntries = fallback.entries.filter((entry) => {
    const providerTime = valuedEntryProviderTimeV1(entry);
    return providerTime === null || currentMarketCapAuthorityTimestampV1(
      providerTime,
      Date.now(),
    );
  });
  const generatedAt = new Date().toISOString();
  const generatedAtDate = new Date(generatedAt);
  const gmgnEvidence = compactProviderEvidenceV1(
    gmgnHydratedEntries,
    "gmgn",
    generatedAtDate,
  );
  const dexscreenerEvidence = compactProviderEvidenceV1(
    dexscreenerEntries,
    "dexscreener",
    generatedAtDate,
  );
  const canonicalById = exactEntryMapV1(newestEntries);
  if (canonicalById === null) {
    throw new TypeError("Market-cap canonical identities conflict");
  }
  const compactGmgnEntries = providerEvidenceEntriesV1(
    gmgnEvidence,
    canonicalById,
    "gmgn",
  );
  const compactDexscreenerEntries = providerEvidenceEntriesV1(
    dexscreenerEvidence,
    canonicalById,
    "dexscreener",
  );
  if (compactGmgnEntries === null || compactDexscreenerEntries === null) {
    throw new TypeError("Market-cap provider evidence conflicts");
  }
  const ranked = exploreMarketCapRankingV1(
    newestEntries,
    rank,
    {
      gmgnHydrationLimit: GMGN_MARKET_CAP_HYDRATION_LIMIT,
      gmgnHydrationEligibleEntryCount: gmgnHydrationEligible.length,
      gmgnRequestedEntries: gmgnRequested.map((entry) =>
        canonicalById.get(entry.id)!
      ),
      gmgnEntries: compactGmgnEntries,
      dexscreenerRequestedEntries: dexscreenerRequested.map((entry) =>
        canonicalById.get(entry.id)!
      ),
      dexscreenerEntries: compactDexscreenerEntries,
    },
    direction,
    generatedAtDate,
  );
  const filterFacets = Object.freeze(
    canonicalEntries.map(exploreMarketCapFilterFacetV1),
  );
  const rankingCommitment = marketCapAuthorityPinCommitmentV1(
    ranked.orderedEntries,
    filterFacets,
    direction,
  );
  if (rankingCommitment === null) {
    throw new TypeError("Market-cap authority filter facets conflict");
  }
  const authorityRanking = Object.freeze({
    ...ranked.ranking,
    rankingCommitment,
  });
  const authority: ExploreMarketCapAuthorityV1 = Object.freeze({
    schemaVersion: "programmable.explore-market-cap-authority.v2",
    inputCommitment,
    direction,
    generatedAt,
    rankSnapshot: rank,
    filterFacets,
    gmgnHydrationEligibleEntryIds: Object.freeze(
      gmgnHydrationEligible.map((entry) => entry.id),
    ),
    gmgnRequestedEntryIds: Object.freeze(
      gmgnRequested.map((entry) => entry.id),
    ),
    gmgnEvidence,
    dexscreenerRequestedEntryIds: Object.freeze(
      dexscreenerRequested.map((entry) => entry.id),
    ),
    dexscreenerEvidence,
    orderedIdentities: Object.freeze(
      ranked.orderedEntries.map(exactOrderedMarketIdentityV1),
    ),
    ranking: authorityRanking,
  });
  const canonicalAuthority = canonicalizeJson(authority);
  const evidenceTimes = [
    ...(rank === null ? [] : [rank.fetchedAt]),
    ...gmgnEvidence.flatMap((item) =>
      item.asOfTime === null ? [] : [item.asOfTime]
    ),
    ...dexscreenerEvidence.flatMap((item) =>
      item.asOfTime === null ? [] : [item.asOfTime]
    ),
  ].map((value) => Date.parse(value));
  const validUntilMs = Math.min(
    Date.parse(generatedAt) + EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_AGE_MS,
    ...evidenceTimes.map((value) =>
      value + EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_AGE_MS
    ),
  );
  if (!Number.isFinite(validUntilMs) || validUntilMs <= Date.now()) {
    throw new TypeError("Market-cap provider evidence is stale");
  }
  // This status controls only the durable authority refresh class. Preserve the
  // public ranking status above as canonical GMGN qualification truth, while a
  // qualified global rank observation proves enough provider liveness to avoid
  // repeating the bounded rank plus token_info composition every ten seconds.
  const authorityRefreshGmgnStatus = ranked.ranking.observedTokenCount === 0
    ? "unavailable" as const
    : ranked.ranking.gmgnStatus === "complete"
      ? "complete" as const
      : "partial" as const;
  return Object.freeze({
    canonicalAuthority,
    authorityCommitment:
      exploreMarketCapAuthorityStorageCommitmentV1(canonicalAuthority),
    rankingCommitment,
    gmgnStatus: authorityRefreshGmgnStatus,
    generatedAt,
    validUntil: new Date(validUntilMs).toISOString(),
  });
}

function parseExploreMarketCapAuthorityV1(
  canonicalAuthority: string,
): ExploreMarketCapAuthorityV1 | null {
  try {
    const parsed = parseStrictJson(canonicalAuthority, {
      maximumBytes: EXPLORE_MARKET_CAP_AUTHORITY_MAXIMUM_BYTES,
      maximumDepth: 64,
    });
    if (
      canonicalizeJson(parsed) !== canonicalAuthority ||
      !isRecordV1(parsed) ||
      !hasExactKeysV1(parsed, [
        "schemaVersion", "inputCommitment", "direction", "generatedAt",
        "rankSnapshot", "filterFacets", "gmgnHydrationEligibleEntryIds",
        "gmgnRequestedEntryIds", "gmgnEvidence",
        "dexscreenerRequestedEntryIds", "dexscreenerEvidence",
        "orderedIdentities", "ranking",
      ]) ||
      parsed.schemaVersion !==
        "programmable.explore-market-cap-authority.v2" ||
      typeof parsed.inputCommitment !== "string" ||
      !SHA256_COMMITMENT.test(parsed.inputCommitment) ||
      (parsed.direction !== "asc" && parsed.direction !== "desc") ||
      typeof parsed.generatedAt !== "string" ||
      !exactIsoTimestampV1(parsed.generatedAt) ||
      !exactGmgnDiscoverySnapshotV1(parsed.rankSnapshot) ||
      !exactFilterFacetArrayV1(parsed.filterFacets) ||
      !exactStringArrayV1(parsed.gmgnHydrationEligibleEntryIds) ||
      !exactStringArrayV1(parsed.gmgnRequestedEntryIds) ||
      !exactProviderEvidenceArrayV1(parsed.gmgnEvidence) ||
      !exactStringArrayV1(parsed.dexscreenerRequestedEntryIds) ||
      !exactProviderEvidenceArrayV1(parsed.dexscreenerEvidence) ||
      !exactOrderedIdentityArrayV1(parsed.orderedIdentities) ||
      !isRecordV1(parsed.ranking) ||
      parsed.ranking.schemaVersion !==
        "programmable.explore-market-cap-ranking.v1" ||
      parsed.ranking.direction !== parsed.direction ||
      typeof parsed.ranking.rankingCommitment !== "string" ||
      !SHA256_COMMITMENT.test(parsed.ranking.rankingCommitment)
    ) return null;
    return parsed as unknown as ExploreMarketCapAuthorityV1;
  } catch {
    return null;
  }
}

function exactFilterFacetArrayV1(
  value: unknown,
): value is readonly ExploreMarketCapFilterFacetV1[] {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !isRecordV1(item) || !hasExactKeysV1(item, [
        "id", "name", "symbol", "modelId", "category", "hasSocials",
      ]) ||
      typeof item.id !== "string" || item.id.length > 1_024 ||
      ids.has(item.id) || typeof item.name !== "string" ||
      item.name.length > 4_096 ||
      (item.symbol !== null &&
        (typeof item.symbol !== "string" || item.symbol.length > 1_024)) ||
      (item.modelId !== null &&
        (typeof item.modelId !== "string" || item.modelId.length > 1_024)) ||
      (item.category !== "classic" && item.category !== "custom") ||
      typeof item.hasSocials !== "boolean"
    ) return false;
    ids.add(item.id);
  }
  return true;
}

function isRecordV1(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeysV1(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function exactIsoTimestampV1(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function exactStringArrayV1(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.length <= 10_000 &&
    value.every((item) => typeof item === "string" && item.length <= 1_024) &&
    value.length === new Set(value).size;
}

function exactProviderEvidenceArrayV1(
  value: unknown,
): value is readonly ExploreMarketCapProviderEvidenceV1[] {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !isRecordV1(item) ||
      !hasExactKeysV1(item, ["id", "valueWad", "asOfTime"]) ||
      typeof item.id !== "string" || item.id.length > 1_024 ||
      ids.has(item.id) ||
      (item.valueWad !== null &&
        (typeof item.valueWad !== "string" ||
          !UNSIGNED_INTEGER.test(item.valueWad) ||
          BigInt(item.valueWad) === 0n)) ||
      (item.asOfTime !== null &&
        (typeof item.asOfTime !== "string" ||
          !exactIsoTimestampV1(item.asOfTime))) ||
      (item.valueWad !== null && item.asOfTime === null)
    ) return false;
    ids.add(item.id);
  }
  return true;
}

function exactOrderedIdentityArrayV1(
  value: unknown,
): value is readonly ExactOrderedMarketIdentityV1[] {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  const ids = new Set<string>();
  for (const item of value) {
    if (
      !isRecordV1(item) ||
      !hasExactKeysV1(item, ["id", "tokenAddress", "marketIdentities"]) ||
      typeof item.id !== "string" || item.id.length > 1_024 ||
      ids.has(item.id) ||
      (item.tokenAddress !== null &&
        (typeof item.tokenAddress !== "string" ||
          !/^0x[0-9a-f]{40}$/u.test(item.tokenAddress))) ||
      !Array.isArray(item.marketIdentities) ||
      item.marketIdentities.length > 10_000 ||
      !item.marketIdentities.every((identity) =>
        isRecordV1(identity) && hasExactKeysV1(identity, [
          "chainId", "protocol", "tokenAddress", "poolId", "quoteAddress",
        ]) && identity.chainId === "1" && identity.protocol === "uniswap_v4" &&
        typeof identity.tokenAddress === "string" &&
        /^0x[0-9a-f]{40}$/u.test(identity.tokenAddress) &&
        typeof identity.poolId === "string" &&
        /^0x[0-9a-f]{64}$/u.test(identity.poolId) &&
        typeof identity.quoteAddress === "string" &&
        /^0x[0-9a-f]{40}$/u.test(identity.quoteAddress)
      )
    ) return false;
    ids.add(item.id);
  }
  return true;
}

function exactGmgnDiscoverySnapshotV1(
  value: unknown,
): value is GmgnDiscoverySnapshotV1 | null {
  if (value === null) return true;
  if (
    !isRecordV1(value) || !isGmgnDiscoverySnapshotV1(value) ||
    !hasExactKeysV1(value, [
      "schemaVersion", "source", "chainId", "providerChain", "kind",
      "interval", "orderBy", "direction", "requestedLimit", "fetchedAt",
      "providerVersion", "providerItemCount", "discardedProviderItemCount",
      "duplicateProviderItemCount", "tokens",
    ])
  ) return false;
  return value.tokens.every((token) =>
    hasExactKeysV1(token, [
      "chain", "tokenAddress", "rank", "visitingCount", "hotLevel",
      "swaps", "buys", "sells", "holderCount", "priceUsd",
      "marketCapUsd", "liquidityUsd", "volumeUsd",
    ])
  );
}

function generatedAgeMs(generatedAt: string): number | null {
  const value = Date.parse(generatedAt);
  return Number.isFinite(value) ? Math.max(0, Date.now() - value) : null;
}

export async function GET(request: NextRequest) {
  const rawSort = request.nextUrl.searchParams.get("sort");
  const requestBudgetMs = rawSort === "market-cap" ||
      rawSort === "market-cap-asc"
    ? MARKET_CAP_REQUEST_BUDGET_MS
    : FAST_LANE_REQUEST_BUDGET_MS;
  const deadlineMs = Date.now() + requestBudgetMs;
  const readSignal = AbortSignal.any([
    request.signal,
    AbortSignal.timeout(requestBudgetMs),
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
  const requestedPage = integerQuery(search.get("page"), 1);
  const requestedRankingCommitment = search.get("rankingCommitment");
  const ethereumMarketCapSort = chain === 1 &&
    (requestedSort === "market-cap" || requestedSort === "market-cap-asc");
  if (
    (requestedRankingCommitment !== null &&
      (!ethereumMarketCapSort ||
        !SHA256_COMMITMENT.test(requestedRankingCommitment))) ||
    (ethereumMarketCapSort && requestedPage > 1 &&
      requestedRankingCommitment === null)
  ) {
    return NextResponse.json(
      {
        error: requestedRankingCommitment === null
          ? "Market-cap pages after page 1 require rankingCommitment"
          : "Unsupported market-cap ranking commitment",
        code: "MARKET_CAP_RANKING_COMMITMENT_REQUIRED",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
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
      page: requestedPage,
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
    const marketCapSortRequested = options.sort === "market-cap" ||
      options.sort === "market-cap-asc";
    const searchRead: Promise<GmgnSearchSnapshotV1 | null> =
      options.query === "" || marketCapSortRequested
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
      const direction = options.sort === "market-cap" ? "desc" : "asc";
      const authorityInputCommitment =
        exploreMarketCapAuthorityInputCommitmentV1(
          presentedPublicEntries,
        );
      const projectionInput = {
        inputCommitment: authorityInputCommitment,
        direction,
        query: options.query,
        socials: options.socials,
        model: options.model,
      } as const;
      const rankingCommitment = requestedRankingCommitment as
        `sha256:${string}` | null;
      const authorityStore = getProductionExploreMarketCapAuthorityStoreV1();
      const resolution = rankingCommitment === null
        ? await authorityStore.resolve({
            inputCommitment: authorityInputCommitment,
            direction,
            build: () => buildExploreMarketCapAuthorityV1(
              presentedPublicEntries,
              authorityInputCommitment,
              direction,
              { deadlineMs },
            ),
            deadlineMs,
            signal: readSignal,
          })
        : await authorityStore.resolve({
            inputCommitment: authorityInputCommitment,
            direction,
            rankingCommitment,
            acceptPinnedAuthority: (canonicalAuthority) => {
              const candidate = parseExploreMarketCapAuthorityV1(
                canonicalAuthority,
              );
              if (candidate === null) return false;
              const candidateProjection =
                projectExploreMarketCapAuthorityV1(
                  candidate,
                  presentedPublicEntries,
                  projectionInput,
                );
              return candidateProjection?.ranking.rankingCommitment ===
                rankingCommitment;
            },
            deadlineMs,
            signal: readSignal,
          });
      if (resolution.kind === "ranking-conflict") {
        return NextResponse.json(
          {
            error: "Market-cap ranking changed; restart from page 1",
            code: "MARKET_CAP_RANKING_RESTART_REQUIRED",
          },
          {
            status: 409,
            headers: {
              "Cache-Control": "no-store",
              "X-Programmable-Ranking-Restart": "required",
            },
          },
        );
      }
      if (resolution.kind !== "ready") {
        throw new Error("Market-cap ordering authority is unavailable");
      }
      const authority = parseExploreMarketCapAuthorityV1(
        resolution.canonicalAuthority,
      );
      if (authority === null) {
        throw new Error("Market-cap ordering authority is invalid");
      }
      const ranked = projectExploreMarketCapAuthorityV1(
        authority,
        presentedPublicEntries,
        projectionInput,
      );
      if (ranked === null) {
        throw new Error("Market-cap ordering authority is unavailable");
      }
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
