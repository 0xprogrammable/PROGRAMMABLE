import "server-only";

import type {
  ExploreValuation,
  ValuedExploreEntry,
} from "../explore-financial-data";
import type { ExploreEntry } from "../tokens";
import { readDexscreenerMarketShadowV1 } from
  "./dexscreener-shadow.server";
import type { DexscreenerShadowReadWaitV1 } from
  "./dexscreener-shadow.server";
import type {
  DexscreenerShadowResultV1,
  DexscreenerShadowSnapshotV1,
} from "./dexscreener-shadow-v1";
import {
  exploreEntriesMarketIdentitiesV1,
  exploreEntryMarketIdentitiesV1,
} from "./explore-market-identities";

export const DEXSCREENER_CURRENT_MAXIMUM_AGE_MS = 5 * 60 * 1_000;

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
  wait: DexscreenerShadowReadWaitV1 = {},
): Promise<DexscreenerExploreResultV1> {
  const identities = exploreEntriesMarketIdentitiesV1(entries);
  let snapshot: DexscreenerShadowSnapshotV1;
  try {
    snapshot = await readDexscreenerMarketShadowV1(identities, wait);
  } catch {
    return {
      entries: entries.map(unavailableEntry),
      marketRead: unavailableRead(identities.length),
    };
  }

  const observedAtMs = Date.now();
  const byIdentity = new Map(
    snapshot.results.map((result) => [identityKey(result), result]),
  );
  const valuedEntries = entries.map((entry) =>
    valuedEntry(entry, byIdentity, observedAtMs)
  );
  const qualifiedCount = snapshot.results.filter((result) =>
    result.status === "available" &&
    result.fdvQualification.status === "qualified" &&
    dexscreenerObservationFreshnessV1(
      result.observation.fetchedAt,
      observedAtMs,
    ) === "provider-recent"
  ).length;
  return {
    entries: valuedEntries,
    marketRead: {
      provider: "dexscreener",
      status: snapshot.readStatus,
      currency: snapshot.currency,
      requestedCount: snapshot.requestedCount,
      observedCount: snapshot.observedCount,
      qualifiedCount,
      unavailableCount: snapshot.requestedCount - qualifiedCount,
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
  observedAtMs: number,
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
  const freshness = dexscreenerObservationFreshnessV1(
    observation.fetchedAt,
    observedAtMs,
  );
  const valuation: ExploreValuation = {
    status: "available",
    metric: "fdv",
    supplyBasis: "total",
    currency: "usd",
    valueWad: observation.fdvUsdWad,
    freshness,
    source: "dexscreener",
    asOfTime: observation.fetchedAt,
  };
  return { ...entry, valuation };
}

export function dexscreenerObservationFreshnessV1(
  fetchedAt: string,
  nowMs = Date.now(),
): "provider-recent" | "stale" {
  const fetchedAtMs = Date.parse(fetchedAt);
  return Number.isFinite(fetchedAtMs) &&
      Number.isFinite(nowMs) &&
      nowMs >= fetchedAtMs &&
      nowMs - fetchedAtMs <= DEXSCREENER_CURRENT_MAXIMUM_AGE_MS
    ? "provider-recent"
    : "stale";
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
