import {
  valuationSortValue,
  type ValuedExploreEntry,
} from "../explore-financial-data";
import type { ExploreEntry } from "../tokens";
import { exploreEntryMarketIdentitiesV1 } from
  "./explore-market-identities";
import {
  MARKET_DATA_CURRENT_MAX_AGE_MS,
  MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD,
} from "./market-data-v1";
import {
  isGmgnMarketSnapshotForExploreEntryV1,
  type GmgnMarketSnapshotV1,
} from "./gmgn-market-data-v1";
import {
  isGmgnDiscoverySnapshotV1,
  isGmgnSearchSnapshotV1,
  normalizeGmgnSearchQueryV1,
  type GmgnDiscoveryKindV1,
  type GmgnDiscoverySnapshotV1,
  type GmgnSearchSnapshotV1,
} from "./gmgn-discovery-v1";

export const PROGRAMMABLE_GMGN_CANONICAL_RANKING_SCHEMA_VERSION =
  "programmable.gmgn-canonical-ranking.v1" as const;

export type GmgnCanonicalDiscoveryIdentityV1 = Readonly<{
  chainId: string | number;
  tokenAddress: unknown;
}>;

export type GmgnCanonicalDiscoveryMatchV1 = Readonly<{
  source: "gmgn";
  kind: GmgnDiscoveryKindV1;
  interval: GmgnDiscoverySnapshotV1["interval"];
  orderBy: GmgnDiscoverySnapshotV1["orderBy"];
  direction: GmgnDiscoverySnapshotV1["direction"];
  fetchedAt: string;
  providerRank: number;
}>;

export type GmgnCanonicalRankedEntryV1<Entry> = Readonly<{
  entry: Entry;
  canonicalIndex: number;
  tokenAddress: `0x${string}` | null;
  gmgn: GmgnCanonicalDiscoveryMatchV1 | null;
}>;

export type GmgnCanonicalRankingCoverageV1 = Readonly<{
  canonicalEntryCount: number;
  canonicalEthereumEntryCount: number;
  canonicalUniqueTokenCount: number;
  gmgnSnapshotCount: number;
  invalidGmgnSnapshotCount: number;
  gmgnObservedUniqueTokenCount: number;
  gmgnMatchedEntryCount: number;
  gmgnMatchedUniqueTokenCount: number;
  unobservedCanonicalEntryCount: number;
  foreignGmgnTokenCount: number;
  duplicateGmgnTokenCount: number;
  discardedProviderItemCount: number;
  canonicalAddressCoverageBps: number;
}>;

export type GmgnCanonicalRankingV1<Entry> = Readonly<{
  schemaVersion: typeof PROGRAMMABLE_GMGN_CANONICAL_RANKING_SCHEMA_VERSION;
  source: "canonical-launch-catalog+gmgn";
  applied: "gmgn-ranked-with-launch-order-fallback";
  entries: readonly Entry[];
  rows: readonly GmgnCanonicalRankedEntryV1<Entry>[];
  coverage: GmgnCanonicalRankingCoverageV1;
}>;

const ADDRESS = /^0x[0-9a-f]{40}$/u;

/**
 * Intersects untrusted, incomplete GMGN rankings with a canonical catalog.
 * GMGN can move observed canonical entries to the front, but it can never add
 * a token or remove an unobserved canonical launch. The original catalog order
 * remains stable for unobserved entries and ties.
 */
export function rankCanonicalEntriesWithGmgnDiscoveryV1<Entry>(
  canonicalEntries: readonly Entry[],
  snapshots: readonly GmgnDiscoverySnapshotV1[],
  identityOf: (entry: Entry) => GmgnCanonicalDiscoveryIdentityV1 | null,
): GmgnCanonicalRankingV1<Entry> {
  const evidence = new Map<`0x${string}`, Readonly<{
    ordinal: number;
    match: GmgnCanonicalDiscoveryMatchV1;
  }>>();
  let observationOrdinal = 0;
  let validSnapshotCount = 0;
  let invalidSnapshotCount = 0;
  let duplicateGmgnTokenCount = 0;
  let discardedProviderItemCount = 0;

  for (const snapshot of snapshots) {
    if (!isGmgnDiscoverySnapshotV1(snapshot)) {
      invalidSnapshotCount += 1;
      continue;
    }
    validSnapshotCount += 1;
    duplicateGmgnTokenCount += snapshot.duplicateProviderItemCount;
    discardedProviderItemCount += snapshot.discardedProviderItemCount;
    for (const token of snapshot.tokens) {
      const tokenAddress = token.chain === "eth"
        ? canonicalAddress(token.tokenAddress)
        : null;
      if (tokenAddress === null) {
        discardedProviderItemCount += 1;
        continue;
      }
      if (evidence.has(tokenAddress)) {
        duplicateGmgnTokenCount += 1;
        continue;
      }
      evidence.set(tokenAddress, Object.freeze({
        ordinal: observationOrdinal,
        match: Object.freeze({
          source: "gmgn",
          kind: snapshot.kind,
          interval: snapshot.interval,
          orderBy: snapshot.orderBy,
          direction: snapshot.direction,
          fetchedAt: snapshot.fetchedAt,
          providerRank: token.rank,
        }),
      }));
      observationOrdinal += 1;
    }
  }

  const canonicalEthereumAddresses = new Set<`0x${string}`>();
  const ranked: Array<Readonly<{
    row: GmgnCanonicalRankedEntryV1<Entry>;
    ordinal: number;
  }>> = [];
  const unobserved: GmgnCanonicalRankedEntryV1<Entry>[] = [];
  let canonicalEthereumEntryCount = 0;
  let gmgnMatchedEntryCount = 0;
  for (const [canonicalIndex, entry] of canonicalEntries.entries()) {
    const identity = identityOf(entry);
    const tokenAddress = identity !== null && String(identity.chainId) === "1"
      ? canonicalAddress(identity.tokenAddress)
      : null;
    if (tokenAddress !== null) {
      canonicalEthereumEntryCount += 1;
      canonicalEthereumAddresses.add(tokenAddress);
    }
    const match = tokenAddress === null ? undefined : evidence.get(tokenAddress);
    const row: GmgnCanonicalRankedEntryV1<Entry> = Object.freeze({
      entry,
      canonicalIndex,
      tokenAddress,
      gmgn: match?.match ?? null,
    });
    if (match === undefined) {
      unobserved.push(row);
    } else {
      gmgnMatchedEntryCount += 1;
      ranked.push(Object.freeze({ row, ordinal: match.ordinal }));
    }
  }
  ranked.sort((left, right) =>
    left.ordinal - right.ordinal ||
    left.row.canonicalIndex - right.row.canonicalIndex
  );

  const rows = Object.freeze([
    ...ranked.map((item) => item.row),
    ...unobserved,
  ]);
  const matchedUniqueAddresses = new Set(
    rows.flatMap((row) => row.gmgn !== null && row.tokenAddress !== null
      ? [row.tokenAddress]
      : []),
  );
  const foreignGmgnTokenCount = [...evidence.keys()].filter(
    (address) => !canonicalEthereumAddresses.has(address),
  ).length;
  const canonicalAddressCoverageBps = canonicalEthereumAddresses.size === 0
    ? 0
    : Math.floor(
      matchedUniqueAddresses.size * 10_000 / canonicalEthereumAddresses.size,
    );
  const coverage: GmgnCanonicalRankingCoverageV1 = Object.freeze({
    canonicalEntryCount: canonicalEntries.length,
    canonicalEthereumEntryCount,
    canonicalUniqueTokenCount: canonicalEthereumAddresses.size,
    gmgnSnapshotCount: validSnapshotCount,
    invalidGmgnSnapshotCount: invalidSnapshotCount,
    gmgnObservedUniqueTokenCount: evidence.size,
    gmgnMatchedEntryCount,
    gmgnMatchedUniqueTokenCount: matchedUniqueAddresses.size,
    unobservedCanonicalEntryCount: canonicalEntries.length -
      gmgnMatchedEntryCount,
    foreignGmgnTokenCount,
    duplicateGmgnTokenCount,
    discardedProviderItemCount,
    canonicalAddressCoverageBps,
  });
  return Object.freeze({
    schemaVersion: PROGRAMMABLE_GMGN_CANONICAL_RANKING_SCHEMA_VERSION,
    source: "canonical-launch-catalog+gmgn",
    applied: "gmgn-ranked-with-launch-order-fallback",
    entries: Object.freeze(rows.map((row) => row.entry)),
    rows,
    coverage,
  });
}

export function rankCanonicalExploreEntriesWithGmgnDiscoveryV1(
  canonicalEntries: readonly ExploreEntry[],
  snapshots: readonly GmgnDiscoverySnapshotV1[],
): GmgnCanonicalRankingV1<ExploreEntry> {
  return rankCanonicalEntriesWithGmgnDiscoveryV1(
    canonicalEntries,
    snapshots,
    (entry) => entry.exploreKind === "custom-project"
      ? {
          chainId: entry.chainId,
          tokenAddress: entry.tokenAddress,
        }
      : {
          chainId: 1,
          tokenAddress: entry.tokenAddress,
        },
  );
}

export type GmgnCanonicalSearchCoverageV1 = Readonly<{
  canonicalUniverseTokenCount: number;
  localMatchEntryCount: number;
  localMatchTokenCount: number;
  canonicalMatchEntryCount: number;
  canonicalMatchTokenCount: number;
  gmgnSnapshotCount: number;
  invalidGmgnSnapshotCount: number;
  gmgnObservedUniqueTokenCount: number;
  gmgnMatchedEntryCount: number;
  gmgnMatchedUniqueTokenCount: number;
  unobservedLocalMatchEntryCount: number;
  providerOnlyCanonicalTokenCount: number;
  foreignGmgnTokenCount: number;
  discardedProviderItemCount: number;
  duplicateGmgnTokenCount: number;
  canonicalAddressCoverageBps: number;
}>;

export type GmgnCanonicalSearchRankingV1<Entry> = Readonly<{
  source: "canonical-launch-catalog+gmgn-search";
  applied: "gmgn-canonical-search-with-local-match-fallback";
  entries: readonly Entry[];
  coverage: GmgnCanonicalSearchCoverageV1;
}>;

/**
 * GMGN search is relevance evidence within the canonical catalog. An observed
 * canonical token may be included even when the local name/symbol/address
 * matcher does not know the provider alias. Foreign coins and wallet rows can
 * never enter the result, and every local match remains as a stable fallback.
 */
export function rankCanonicalEntriesWithGmgnSearchV1<Entry>(
  canonicalUniverse: readonly Entry[],
  localMatches: readonly Entry[],
  snapshot: GmgnSearchSnapshotV1 | null,
  query: string,
  identityOf: (entry: Entry) => GmgnCanonicalDiscoveryIdentityV1 | null,
  now = new Date(),
): GmgnCanonicalSearchRankingV1<Entry> {
  const normalizedQuery = normalizeGmgnSearchQueryV1(query);
  const snapshotUsable = snapshot !== null &&
    normalizedQuery !== null &&
    isGmgnSearchSnapshotV1(snapshot) &&
    snapshot.query === normalizedQuery &&
    currentProviderSnapshotV1(snapshot.fetchedAt, now);
  const evidence = new Map<`0x${string}`, number>();
  if (snapshotUsable) {
    for (const token of snapshot.tokens) {
      evidence.set(token.tokenAddress, token.rank);
    }
  }

  const universeRows = canonicalUniverse.map((entry, canonicalIndex) => {
    const identity = identityOf(entry);
    const tokenAddress = identity !== null && String(identity.chainId) === "1"
      ? canonicalAddress(identity.tokenAddress)
      : null;
    return Object.freeze({ entry, canonicalIndex, tokenAddress });
  });
  const universeByEntry = new Map(
    universeRows.map((row) => [row.entry, row] as const),
  );
  const universeByAddress = new Map<
    `0x${string}`,
    typeof universeRows[number]
  >();
  for (const row of universeRows) {
    if (row.tokenAddress !== null && !universeByAddress.has(row.tokenAddress)) {
      universeByAddress.set(row.tokenAddress, row);
    }
  }
  const universeAddresses = new Set(universeByAddress.keys());
  const normalizedLocalRows: Array<typeof universeRows[number]> = [];
  const normalizedLocalIndexes = new Set<number>();
  const localAddresses = new Set<`0x${string}`>();
  for (const entry of localMatches) {
    const identity = identityOf(entry);
    const address = identity !== null && String(identity.chainId) === "1"
      ? canonicalAddress(identity.tokenAddress)
      : null;
    const row = universeByEntry.get(entry) ??
      (address === null ? undefined : universeByAddress.get(address));
    if (row === undefined || normalizedLocalIndexes.has(row.canonicalIndex)) {
      continue;
    }
    normalizedLocalIndexes.add(row.canonicalIndex);
    normalizedLocalRows.push(row);
    if (row.tokenAddress !== null) localAddresses.add(row.tokenAddress);
  }

  const selectedIndexes = new Set<number>();
  const providerMatchedRows: Array<typeof universeRows[number]> = [];
  for (const address of evidence.keys()) {
    const row = universeByAddress.get(address);
    if (row === undefined || selectedIndexes.has(row.canonicalIndex)) continue;
    selectedIndexes.add(row.canonicalIndex);
    providerMatchedRows.push(row);
  }
  const localFallbackRows = normalizedLocalRows.filter((row) => {
    if (selectedIndexes.has(row.canonicalIndex)) return false;
    selectedIndexes.add(row.canonicalIndex);
    return true;
  });
  const matchedAddresses = new Set(providerMatchedRows.flatMap((row) =>
    row.tokenAddress === null ? [] : [row.tokenAddress]
  ));
  const providerOnlyCanonicalTokenCount = [...matchedAddresses].filter(
    (address) => !localAddresses.has(address),
  ).length;
  const foreignGmgnTokenCount = [...evidence.keys()].filter(
    (address) => !universeAddresses.has(address),
  ).length;
  const entries = Object.freeze([
    ...providerMatchedRows.map((row) => row.entry),
    ...localFallbackRows.map((row) => row.entry),
  ]);
  const canonicalMatchAddresses = new Set([
    ...matchedAddresses,
    ...localFallbackRows.flatMap((row) =>
      row.tokenAddress === null ? [] : [row.tokenAddress]
    ),
  ]);
  const coverage: GmgnCanonicalSearchCoverageV1 = Object.freeze({
    canonicalUniverseTokenCount: universeAddresses.size,
    localMatchEntryCount: normalizedLocalRows.length,
    localMatchTokenCount: localAddresses.size,
    canonicalMatchEntryCount: entries.length,
    canonicalMatchTokenCount: canonicalMatchAddresses.size,
    gmgnSnapshotCount: snapshotUsable ? 1 : 0,
    invalidGmgnSnapshotCount: snapshot === null || snapshotUsable ? 0 : 1,
    gmgnObservedUniqueTokenCount: snapshotUsable ? evidence.size : 0,
    gmgnMatchedEntryCount: providerMatchedRows.length,
    gmgnMatchedUniqueTokenCount: matchedAddresses.size,
    unobservedLocalMatchEntryCount: localFallbackRows.length,
    providerOnlyCanonicalTokenCount,
    foreignGmgnTokenCount,
    discardedProviderItemCount: snapshotUsable
      ? snapshot.discardedProviderItemCount
      : 0,
    duplicateGmgnTokenCount: snapshotUsable
      ? snapshot.duplicateProviderItemCount
      : 0,
    canonicalAddressCoverageBps: canonicalMatchAddresses.size === 0
      ? 0
      : Math.floor(
          matchedAddresses.size * 10_000 / canonicalMatchAddresses.size,
        ),
  });
  return Object.freeze({
    source: "canonical-launch-catalog+gmgn-search",
    applied: "gmgn-canonical-search-with-local-match-fallback",
    entries,
    coverage,
  });
}

export function rankCanonicalExploreEntriesWithGmgnSearchV1(
  canonicalUniverse: readonly ExploreEntry[],
  localMatches: readonly ExploreEntry[],
  snapshot: GmgnSearchSnapshotV1 | null,
  query: string,
  now = new Date(),
): GmgnCanonicalSearchRankingV1<ExploreEntry> {
  return rankCanonicalEntriesWithGmgnSearchV1(
    canonicalUniverse,
    localMatches,
    snapshot,
    query,
    (entry) => entry.exploreKind === "custom-project"
      ? { chainId: entry.chainId, tokenAddress: entry.tokenAddress }
      : { chainId: 1, tokenAddress: entry.tokenAddress },
    now,
  );
}

export type GmgnCanonicalMarketCapOrderingSourceV1 =
  | "gmgn-market-cap"
  | "gmgn-token-info-fdv"
  | "dexscreener-fdv"
  | "canonical-launch-order";

export function gmgnTokenInfoFallbackEntryV1(
  entry: ExploreEntry,
  snapshot: GmgnMarketSnapshotV1,
  now = new Date(),
): ValuedExploreEntry | null {
  if (
    !isGmgnMarketSnapshotForExploreEntryV1(snapshot, entry) ||
    !currentProviderSnapshotV1(snapshot.fetchedAt, now)
  ) return null;
  let liquidity: bigint;
  let fdv: bigint;
  try {
    liquidity = BigInt(snapshot.liquidityUsdWad);
    fdv = BigInt(snapshot.fdvUsdWad);
  } catch {
    return null;
  }
  const qualified = liquidity >=
      BigInt(MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD) && fdv > 0n;
  return Object.freeze({
    ...entry,
    valuation: qualified
      ? Object.freeze({
          status: "available" as const,
          metric: "fdv" as const,
          supplyBasis: "total" as const,
          currency: "usd" as const,
          valueWad: snapshot.fdvUsdWad,
          freshness: "provider-recent" as const,
          source: "gmgn" as const,
          asOfTime: snapshot.fetchedAt,
        })
      : Object.freeze({
          status: "unavailable" as const,
          reason: "liquidity-unavailable" as const,
        }),
    gmgnMarketData: snapshot,
  });
}

export type GmgnCanonicalMarketCapFallbackInputV1 = Readonly<{
  gmgnHydrationLimit: number;
  gmgnHydrationEligibleEntryCount: number;
  gmgnRequestedEntries: readonly ExploreEntry[];
  gmgnEntries: readonly ValuedExploreEntry[];
  dexscreenerRequestedEntries: readonly ExploreEntry[];
  dexscreenerEntries: readonly ValuedExploreEntry[];
}>;

export type GmgnCanonicalMarketCapRankingV1 = Readonly<{
  entries: readonly ExploreEntry[];
  rows: readonly (GmgnCanonicalRankedEntryV1<ExploreEntry> & Readonly<{
    orderingSource: GmgnCanonicalMarketCapOrderingSourceV1;
    orderingValueWad: string | null;
    orderingAsOfTime: string | null;
  }>)[];
  coverage: GmgnCanonicalRankingCoverageV1;
  gmgnHydrationLimit: number;
  gmgnHydrationEligibleEntryCount: number;
  gmgnHydrationRequestedEntryCount: number;
  gmgnHydrationAcceptedEntryCount: number;
  gmgnHydrationQualifiedEntryCount: number;
  gmgnHydrationDeferredEntryCount: number;
  discardedGmgnHydrationEntryCount: number;
  fallbackRequestedEntryCount: number;
  fallbackAcceptedEntryCount: number;
  fallbackQualifiedEntryCount: number;
  discardedFallbackEntryCount: number;
  canonicalTailEntryCount: number;
}>;

const GMGN_MARKET_CAP_MINIMUM_LIQUIDITY_USD =
  Number(BigInt(MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD)) / 1e18;

function currentProviderSnapshotV1(fetchedAt: string, now: Date): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  const nowMs = now.getTime();
  return Number.isFinite(fetchedAtMs) &&
    Number.isFinite(nowMs) &&
    fetchedAtMs <= nowMs &&
    nowMs - fetchedAtMs <= MARKET_DATA_CURRENT_MAX_AGE_MS;
}

export function gmgnMarketCapDiscoverySnapshotUsableV1(
  snapshot: GmgnDiscoverySnapshotV1,
  direction: "asc" | "desc",
  now = new Date(),
): boolean {
  return isGmgnDiscoverySnapshotV1(snapshot) &&
    snapshot.kind === "trending" &&
    snapshot.orderBy === "marketcap" &&
    snapshot.direction === direction &&
    currentProviderSnapshotV1(snapshot.fetchedAt, now);
}

function qualifiedMarketCapSnapshotV1(
  snapshot: GmgnDiscoverySnapshotV1,
  direction: "asc" | "desc",
  now: Date,
): GmgnDiscoverySnapshotV1 | null {
  if (!gmgnMarketCapDiscoverySnapshotUsableV1(snapshot, direction, now)) {
    return null;
  }
  const tokens = snapshot.tokens.filter((token) =>
    token.marketCapUsd !== null &&
    Number.isFinite(token.marketCapUsd) &&
    token.marketCapUsd > 0 &&
    token.liquidityUsd !== null &&
    Number.isFinite(token.liquidityUsd) &&
    token.liquidityUsd >= GMGN_MARKET_CAP_MINIMUM_LIQUIDITY_USD
  );
  const disqualifiedCount = snapshot.tokens.length - tokens.length;
  return Object.freeze({
    ...snapshot,
    discardedProviderItemCount:
      snapshot.discardedProviderItemCount + disqualifiedCount,
    tokens: Object.freeze(tokens),
  });
}

export function rankCanonicalExploreMarketCapPrimaryWithGmgnV1(
  canonicalEntries: readonly ExploreEntry[],
  snapshots: readonly GmgnDiscoverySnapshotV1[],
  direction: "asc" | "desc",
  now = new Date(),
): GmgnCanonicalRankingV1<ExploreEntry> {
  const marketCapSnapshots = snapshots.flatMap((snapshot) => {
    const qualified = qualifiedMarketCapSnapshotV1(snapshot, direction, now);
    return qualified === null ? [] : [qualified];
  });
  return rankCanonicalExploreEntriesWithGmgnDiscoveryV1(
    canonicalEntries,
    marketCapSnapshots,
  );
}

/**
 * Keeps GMGN market-cap observations in provider order. The unobserved
 * canonical remainder is then split into a GMGN token_info FDV tier, a
 * Dexscreener FDV tier only for the still-unqualified remainder, and finally
 * stable canonical launch order. Values from different metric/provider tiers
 * are never compared with each other.
 */
export function rankCanonicalExploreMarketCapEntriesWithGmgnV1(
  canonicalEntries: readonly ExploreEntry[],
  snapshots: readonly GmgnDiscoverySnapshotV1[],
  fallback: GmgnCanonicalMarketCapFallbackInputV1,
  direction: "asc" | "desc",
  now = new Date(),
): GmgnCanonicalMarketCapRankingV1 {
  const primary = rankCanonicalExploreMarketCapPrimaryWithGmgnV1(
    canonicalEntries,
    snapshots,
    direction,
    now,
  );
  const matched = primary.rows.filter((row) => row.gmgn !== null);
  const unobserved = primary.rows.filter((row) => row.gmgn === null);
  const unobservedById = new Map(
    unobserved.map((row) => [row.entry.id, row] as const),
  );
  const gmgnRequested = requestedCanonicalRowsV1(
    fallback.gmgnRequestedEntries,
    unobservedById,
  );
  const gmgnAccepted = new Map<string, Readonly<{
    row: GmgnCanonicalRankedEntryV1<ExploreEntry>;
    value: bigint | null;
    asOfTime: string | null;
  }>>();
  let discardedGmgnHydrationEntryCount = gmgnRequested.discarded;
  for (const entry of fallback.gmgnEntries) {
    const row = gmgnRequested.rows.get(entry.id);
    if (
      row === undefined ||
      gmgnAccepted.has(entry.id) ||
      !exactCanonicalMarketIdentityV1(entry, row.entry) ||
      !validProviderValuationV1(entry, "gmgn")
    ) {
      discardedGmgnHydrationEntryCount += 1;
      continue;
    }
    gmgnAccepted.set(entry.id, Object.freeze({
      row,
      value: valuationSortValue(entry),
      asOfTime: providerValuationAsOfTimeV1(entry),
    }));
  }
  const gmgnSorted = sortedQualifiedFallbackV1(
    unobserved,
    gmgnAccepted,
    direction,
  );
  const gmgnQualifiedIds = new Set(
    gmgnSorted.map(({ row }) => row.entry.id),
  );

  const dexscreenerRequested = requestedCanonicalRowsV1(
    fallback.dexscreenerRequestedEntries.filter(
      (entry) => !gmgnQualifiedIds.has(entry.id),
    ),
    unobservedById,
  );
  const dexscreenerAccepted = new Map<string, Readonly<{
    row: GmgnCanonicalRankedEntryV1<ExploreEntry>;
    value: bigint | null;
    asOfTime: string | null;
  }>>();
  let discardedFallbackEntryCount = dexscreenerRequested.discarded;
  for (const entry of fallback.dexscreenerEntries) {
    const row = dexscreenerRequested.rows.get(entry.id);
    if (
      row === undefined ||
      dexscreenerAccepted.has(entry.id) ||
      gmgnQualifiedIds.has(entry.id) ||
      !exactCanonicalMarketIdentityV1(entry, row.entry) ||
      !validProviderValuationV1(entry, "dexscreener")
    ) {
      discardedFallbackEntryCount += 1;
      continue;
    }
    dexscreenerAccepted.set(entry.id, Object.freeze({
      row,
      value: valuationSortValue(entry),
      asOfTime: providerValuationAsOfTimeV1(entry),
    }));
  }
  const dexscreenerSorted = sortedQualifiedFallbackV1(
    unobserved.filter((row) => !gmgnQualifiedIds.has(row.entry.id)),
    dexscreenerAccepted,
    direction,
  );
  const dexscreenerQualifiedIds = new Set(
    dexscreenerSorted.map(({ row }) => row.entry.id),
  );
  const canonicalTail = unobserved.filter((row) =>
    !gmgnQualifiedIds.has(row.entry.id) &&
    !dexscreenerQualifiedIds.has(row.entry.id)
  );
  const rows = Object.freeze([
    ...matched.map((row) => Object.freeze({
      ...row,
      orderingSource: "gmgn-market-cap" as const,
      orderingValueWad: null,
      orderingAsOfTime: row.gmgn?.fetchedAt ?? null,
    })),
    ...gmgnSorted.map(({ row, value, asOfTime }) => Object.freeze({
      ...row,
      orderingSource: "gmgn-token-info-fdv" as const,
      orderingValueWad: value.toString(),
      orderingAsOfTime: asOfTime,
    })),
    ...dexscreenerSorted.map(({ row, value, asOfTime }) => Object.freeze({
      ...row,
      orderingSource: "dexscreener-fdv" as const,
      orderingValueWad: value.toString(),
      orderingAsOfTime: asOfTime,
    })),
    ...canonicalTail.map((row) => Object.freeze({
      ...row,
      orderingSource: "canonical-launch-order" as const,
      orderingValueWad: null,
      orderingAsOfTime: null,
    })),
  ]);
  const gmgnHydrationEligibleEntryCount = Number.isSafeInteger(
      fallback.gmgnHydrationEligibleEntryCount,
    ) && fallback.gmgnHydrationEligibleEntryCount >= 0
    ? Math.min(fallback.gmgnHydrationEligibleEntryCount, unobserved.length)
    : 0;
  const gmgnHydrationLimit = Number.isSafeInteger(fallback.gmgnHydrationLimit) &&
      fallback.gmgnHydrationLimit >= 0
    ? fallback.gmgnHydrationLimit
    : 0;
  return Object.freeze({
    entries: Object.freeze(rows.map((row) => row.entry)),
    rows,
    coverage: primary.coverage,
    gmgnHydrationLimit,
    gmgnHydrationEligibleEntryCount,
    gmgnHydrationRequestedEntryCount: gmgnRequested.rows.size,
    gmgnHydrationAcceptedEntryCount: gmgnAccepted.size,
    gmgnHydrationQualifiedEntryCount: gmgnSorted.length,
    gmgnHydrationDeferredEntryCount: Math.max(
      0,
      gmgnHydrationEligibleEntryCount - gmgnRequested.rows.size,
    ),
    discardedGmgnHydrationEntryCount,
    fallbackRequestedEntryCount: dexscreenerRequested.rows.size,
    fallbackAcceptedEntryCount: dexscreenerAccepted.size,
    fallbackQualifiedEntryCount: dexscreenerSorted.length,
    discardedFallbackEntryCount,
    canonicalTailEntryCount: canonicalTail.length,
  });
}

function requestedCanonicalRowsV1(
  requestedEntries: readonly ExploreEntry[],
  eligible: ReadonlyMap<string, GmgnCanonicalRankedEntryV1<ExploreEntry>>,
): Readonly<{
  rows: ReadonlyMap<string, GmgnCanonicalRankedEntryV1<ExploreEntry>>;
  discarded: number;
}> {
  const rows = new Map<string, GmgnCanonicalRankedEntryV1<ExploreEntry>>();
  let discarded = 0;
  for (const entry of requestedEntries) {
    const row = eligible.get(entry.id);
    if (
      row === undefined ||
      rows.has(entry.id) ||
      !exactCanonicalMarketIdentityV1(entry, row.entry)
    ) {
      discarded += 1;
      continue;
    }
    rows.set(entry.id, row);
  }
  return Object.freeze({ rows, discarded });
}

function validProviderValuationV1(
  entry: ValuedExploreEntry,
  provider: "gmgn" | "dexscreener",
): boolean {
  return entry.valuation.status === "unavailable" ||
    entry.valuation.source === provider;
}

function providerValuationAsOfTimeV1(
  entry: ValuedExploreEntry,
): string | null {
  if (entry.valuation.status !== "available") return null;
  const value = entry.valuation.asOfTime;
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? value
    : null;
}

function exactCanonicalMarketIdentityV1(
  candidate: ExploreEntry,
  canonical: ExploreEntry,
): boolean {
  if (
    candidate.id !== canonical.id ||
    candidate.exploreKind !== canonical.exploreKind ||
    canonicalAddress(candidate.tokenAddress) !==
      canonicalAddress(canonical.tokenAddress)
  ) return false;
  const candidateIdentities = exploreEntryMarketIdentitiesV1(candidate)
    .map(marketIdentityKeyV1);
  const canonicalIdentities = exploreEntryMarketIdentitiesV1(canonical)
    .map(marketIdentityKeyV1);
  return canonicalIdentities.length > 0 &&
    candidateIdentities.length === canonicalIdentities.length &&
    candidateIdentities.every((value, index) =>
      value === canonicalIdentities[index]
    );
}

function marketIdentityKeyV1(
  identity: ReturnType<typeof exploreEntryMarketIdentitiesV1>[number],
): string {
  return [
    identity.chainId,
    identity.protocol,
    identity.tokenAddress,
    identity.poolId,
    identity.quoteAddress,
  ].join(":");
}

function sortedQualifiedFallbackV1(
  canonicalRows: readonly GmgnCanonicalRankedEntryV1<ExploreEntry>[],
  accepted: ReadonlyMap<string, Readonly<{
    row: GmgnCanonicalRankedEntryV1<ExploreEntry>;
    value: bigint | null;
    asOfTime: string | null;
  }>>,
  direction: "asc" | "desc",
): Array<Readonly<{
  row: GmgnCanonicalRankedEntryV1<ExploreEntry>;
  value: bigint;
  asOfTime: string | null;
}>> {
  return canonicalRows.flatMap((row) => {
    const item = accepted.get(row.entry.id);
    return item?.value === null || item?.value === undefined
      ? []
      : [{ row, value: item.value, asOfTime: item.asOfTime }];
  }).sort((left, right) => {
    if (left.value !== right.value) {
      const ascending = left.value < right.value ? -1 : 1;
      return direction === "asc" ? ascending : -ascending;
    }
    return left.row.canonicalIndex - right.row.canonicalIndex;
  });
}

function canonicalAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS.test(normalized) ? normalized as `0x${string}` : null;
}
