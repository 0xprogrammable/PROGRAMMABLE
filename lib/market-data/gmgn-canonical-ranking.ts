import type { ExploreEntry } from "../tokens";
import {
  isGmgnDiscoverySnapshotV1,
  type GmgnDiscoveryKindV1,
  type GmgnDiscoverySnapshotV1,
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

function canonicalAddress(value: unknown): `0x${string}` | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase();
  return ADDRESS.test(normalized) ? normalized as `0x${string}` : null;
}
