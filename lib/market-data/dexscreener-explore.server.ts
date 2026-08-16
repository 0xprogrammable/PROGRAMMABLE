import "server-only";

import type {
  ExploreValuation,
  ValuedExploreEntry,
} from "../explore-financial-data";
import type { ExploreEntry } from "../tokens";
import { readDexscreenerMarketShadowV1 } from
  "./dexscreener-shadow.server";
import type {
  DexscreenerShadowResultV1,
  DexscreenerShadowSnapshotV1,
} from "./dexscreener-shadow-v1";
import {
  exploreEntriesMarketIdentitiesV1,
  exploreEntryMarketIdentitiesV1,
} from "./explore-market-identities";

export type DexscreenerExploreReadV1 = Readonly<{
  provider: "dexscreener";
  status: "complete" | "partial" | "unavailable";
  currency: "USD";
  requestedCount: number;
  observedCount: number;
  qualifiedCount: number;
  unavailableCount: number;
  oldestFetchedAt: string | null;
  newestFetchedAt: string | null;
}>;

export type DexscreenerExploreResultV1 = Readonly<{
  entries: readonly ValuedExploreEntry[];
  marketRead: DexscreenerExploreReadV1;
}>;

export async function readDexscreenerExploreEntriesV1(
  entries: readonly ExploreEntry[],
): Promise<DexscreenerExploreResultV1> {
  const identities = exploreEntriesMarketIdentitiesV1(entries);
  let snapshot: DexscreenerShadowSnapshotV1;
  try {
    snapshot = await readDexscreenerMarketShadowV1(identities);
  } catch {
    return {
      entries: entries.map(unavailableEntry),
      marketRead: unavailableRead(identities.length),
    };
  }

  const byIdentity = new Map(
    snapshot.results.map((result) => [identityKey(result), result]),
  );
  return {
    entries: entries.map((entry) => valuedEntry(entry, byIdentity)),
    marketRead: {
      provider: "dexscreener",
      status: snapshot.readStatus,
      currency: snapshot.currency,
      requestedCount: snapshot.requestedCount,
      observedCount: snapshot.observedCount,
      qualifiedCount: snapshot.qualifiedCount,
      unavailableCount: snapshot.unavailableCount,
      oldestFetchedAt: snapshot.sourceReadWindow?.oldestFetchedAt ?? null,
      newestFetchedAt: snapshot.sourceReadWindow?.newestFetchedAt ?? null,
    },
  };
}

function unavailableRead(requestedCount: number): DexscreenerExploreReadV1 {
  return {
    provider: "dexscreener",
    status: "unavailable",
    currency: "USD",
    requestedCount,
    observedCount: 0,
    qualifiedCount: 0,
    unavailableCount: requestedCount,
    oldestFetchedAt: null,
    newestFetchedAt: null,
  };
}

function valuedEntry(
  entry: ExploreEntry,
  results: ReadonlyMap<string, DexscreenerShadowResultV1>,
): ValuedExploreEntry {
  const matches = exploreEntryMarketIdentitiesV1(entry)
    .map((identity) => results.get(identityKey({ identity })))
    .filter((result): result is DexscreenerShadowResultV1 => result !== undefined);
  const qualified = matches.filter((result) =>
    result.status === "available" &&
    result.fdvQualification.status === "qualified"
  );
  if (qualified.length !== 1 || qualified[0]?.status !== "available") {
    return unavailableEntry(entry);
  }
  const observation = qualified[0].observation;
  const valuation: ExploreValuation = {
    status: "available",
    metric: "fdv",
    supplyBasis: "total",
    currency: "usd",
    valueWad: observation.fdvUsdWad,
    freshness: "current",
    source: "dexscreener",
    asOfTime: observation.fetchedAt,
  };
  return { ...entry, valuation };
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

function identityKey(
  result: Pick<DexscreenerShadowResultV1, "identity">,
) {
  const identity = result.identity;
  return `${identity.tokenAddress}:${identity.poolId}:${identity.quoteAddress}`;
}
