import "server-only";

import type {
  ExploreValuation,
  ValuedExploreEntry,
} from "../explore-financial-data";
import type { ExploreEntry } from "../tokens";
import {
  DEXSCREENER_CURRENT_MAXIMUM_AGE_MS,
  readDexscreenerExploreEntriesV1,
  type DexscreenerExploreReadV1,
} from "./dexscreener-explore.server";
import { exploreEntryMarketIdentitiesV1 } from
  "./explore-market-identities";
import {
  gmgnMarketDataConfiguredV1,
  readGmgnExploreSnapshotsV1,
  type GmgnReadWaitV1,
} from "./gmgn.server";
import type { GmgnMarketSnapshotV1 } from "./gmgn-market-data-v1";
import { MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD } from
  "./market-data-v1";

export type GmgnExploreReadV1 = Readonly<{
  provider: "gmgn";
  fallbackProvider: "dexscreener";
  status: "complete" | "partial" | "unavailable";
  currency: "USD";
  requestedCount: number;
  observedCount: number;
  qualifiedCount: number;
  unavailableCount: number;
  gmgnObservedCount: number;
  gmgnQualifiedCount: number;
  fallbackRequestedCount: number;
  fallbackQualifiedCount: number;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
}>;

export type ExploreMarketReadV1 = DexscreenerExploreReadV1 | GmgnExploreReadV1;

export type ExploreMarketResultV1 = Readonly<{
  entries: readonly ValuedExploreEntry[];
  marketRead: ExploreMarketReadV1;
}>;

export async function readExploreMarketEntriesV1(
  entries: readonly ExploreEntry[],
  wait: GmgnReadWaitV1 = {},
): Promise<ExploreMarketResultV1> {
  // GMGN token/info is one weighted request per token. Catalog-wide ranking
  // remains on the existing bounded Dexscreener batch reader; GMGN only
  // enriches the visible page or one detail resource.
  if (!gmgnMarketDataConfiguredV1() || entries.length > 9) {
    return readDexscreenerExploreEntriesV1(entries, wait);
  }

  let snapshots: ReadonlyMap<string, GmgnMarketSnapshotV1>;
  try {
    snapshots = await readGmgnExploreSnapshotsV1(entries, wait);
  } catch {
    return readDexscreenerExploreEntriesV1(entries, wait);
  }
  const nowMs = (wait.now ?? (() => new Date()))().getTime();
  const gmgnEntries = new Map<string, ValuedExploreEntry>();
  const fallbackEntries: ExploreEntry[] = [];
  let gmgnQualifiedCount = 0;
  for (const entry of entries) {
    const snapshot = snapshots.get(entry.id);
    if (snapshot && gmgnSnapshotQualified(snapshot, nowMs)) {
      gmgnEntries.set(entry.id, {
        ...entry,
        valuation: gmgnValuation(snapshot),
        gmgnMarketData: snapshot,
      });
      gmgnQualifiedCount += 1;
    } else {
      fallbackEntries.push(entry);
      if (snapshot) {
        gmgnEntries.set(entry.id, {
          ...entry,
          valuation: { status: "unavailable", reason: "liquidity-unavailable" },
          gmgnMarketData: snapshot,
        });
      }
    }
  }

  const fallback = await readDexscreenerExploreEntriesV1(fallbackEntries, wait);
  const fallbackById = new Map(fallback.entries.map((entry) => [entry.id, entry]));
  let fallbackQualifiedCount = 0;
  const valuedEntries = entries.map((entry): ValuedExploreEntry => {
    const gmgn = gmgnEntries.get(entry.id);
    if (gmgn?.valuation.status === "available") return gmgn;
    const dexscreener = fallbackById.get(entry.id);
    if (dexscreener?.valuation.status === "available") {
      fallbackQualifiedCount += 1;
      return gmgn?.gmgnMarketData
        ? { ...dexscreener, gmgnMarketData: gmgn.gmgnMarketData }
        : dexscreener;
    }
    return gmgn ?? dexscreener ?? unavailableEntry(entry);
  });
  const qualifiedCount = gmgnQualifiedCount + fallbackQualifiedCount;
  const gmgnTimes = [...snapshots.values()].map((snapshot) => snapshot.fetchedAt);
  const sourceTimes = [
    ...gmgnTimes,
    ...(fallback.marketRead.oldestFetchedAt
      ? [fallback.marketRead.oldestFetchedAt]
      : []),
    ...(fallback.marketRead.newestFetchedAt
      ? [fallback.marketRead.newestFetchedAt]
      : []),
  ].sort();
  const providerHealthy = snapshots.size === entries.length ||
    fallback.marketRead.status === "complete";
  const observedCount = entries.filter((entry) =>
    snapshots.has(entry.id) ||
    fallbackById.get(entry.id)?.valuation.status === "available"
  ).length;
  return {
    entries: valuedEntries,
    marketRead: {
      provider: "gmgn",
      fallbackProvider: "dexscreener",
      status: providerHealthy
        ? "complete"
        : observedCount > 0 || fallback.marketRead.status === "partial"
          ? "partial"
          : "unavailable",
      currency: "USD",
      requestedCount: entries.length,
      observedCount,
      qualifiedCount,
      unavailableCount: entries.length - qualifiedCount,
      gmgnObservedCount: snapshots.size,
      gmgnQualifiedCount,
      fallbackRequestedCount: fallbackEntries.length,
      fallbackQualifiedCount,
      oldestFetchedAt: sourceTimes[0] ?? null,
      newestFetchedAt: sourceTimes.at(-1) ?? null,
    },
  };
}

export function exploreMarketProviderHeaderV1(
  marketRead: ExploreMarketReadV1,
): "dexscreener" | "gmgn" | "gmgn+dexscreener" {
  if (marketRead.provider === "dexscreener") return "dexscreener";
  return marketRead.fallbackRequestedCount > 0
    ? "gmgn+dexscreener"
    : "gmgn";
}

export function exploreMarketSourcesV1(
  marketRead: ExploreMarketReadV1,
): readonly ("dexscreener" | "gmgn")[] {
  if (marketRead.provider === "dexscreener") {
    return marketRead.observedCount > 0 ? ["dexscreener"] : [];
  }
  const sources: ("dexscreener" | "gmgn")[] = [];
  if (marketRead.gmgnObservedCount > 0) sources.push("gmgn");
  if (marketRead.fallbackQualifiedCount > 0) sources.push("dexscreener");
  return sources;
}

export function exploreMarketPriceSourcesV1(
  marketRead: ExploreMarketReadV1,
): readonly ("dexscreener" | "gmgn")[] {
  if (marketRead.provider === "dexscreener") {
    return marketRead.qualifiedCount > 0 ? ["dexscreener"] : [];
  }
  const sources: ("dexscreener" | "gmgn")[] = [];
  if (marketRead.gmgnQualifiedCount > 0) sources.push("gmgn");
  if (marketRead.fallbackQualifiedCount > 0) sources.push("dexscreener");
  return sources;
}

function gmgnSnapshotQualified(
  snapshot: NonNullable<ValuedExploreEntry["gmgnMarketData"]>,
  nowMs: number,
) {
  const fetchedAtMs = Date.parse(snapshot.fetchedAt);
  return BigInt(snapshot.liquidityUsdWad) >=
      BigInt(MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD) &&
    Number.isFinite(fetchedAtMs) &&
    nowMs >= fetchedAtMs &&
    nowMs - fetchedAtMs <= DEXSCREENER_CURRENT_MAXIMUM_AGE_MS;
}

function gmgnValuation(
  snapshot: NonNullable<ValuedExploreEntry["gmgnMarketData"]>,
): ExploreValuation {
  return {
    status: "available",
    metric: "fdv",
    supplyBasis: "total",
    currency: "usd",
    valueWad: snapshot.fdvUsdWad,
    freshness: "provider-recent",
    source: "gmgn",
    asOfTime: snapshot.fetchedAt,
  };
}

function unavailableEntry(entry: ExploreEntry): ValuedExploreEntry {
  return {
    ...entry,
    valuation: {
      status: "unavailable",
      reason: exploreEntryMarketIdentitiesV1(entry).length === 0
        ? "no-market"
        : "source-unavailable",
    },
  };
}
