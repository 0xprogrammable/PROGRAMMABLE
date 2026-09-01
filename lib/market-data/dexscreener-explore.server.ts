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
// Explore responses may remain at the edge for s-maxage=15 plus a 45-second
// stale-while-revalidate window. Admit only observations that still satisfy
// the public five-minute freshness contract at the end of that cache window,
// with a small delivery margin after the edge releases the response.
const EXPLORE_PUBLIC_EDGE_CACHE_MAXIMUM_AGE_MS = (15 + 45) * 1_000;
const EXPLORE_PUBLIC_DELIVERY_SAFETY_MARGIN_MS = 5_000;
export const DEXSCREENER_EXPLORE_OBSERVATION_MAXIMUM_AGE_MS =
  DEXSCREENER_CURRENT_MAXIMUM_AGE_MS -
  EXPLORE_PUBLIC_EDGE_CACHE_MAXIMUM_AGE_MS -
  EXPLORE_PUBLIC_DELIVERY_SAFETY_MARGIN_MS;

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
  /**
   * Internal exact-identity coverage used when another provider delegates a
   * subset to Dexscreener. This is intentionally kept outside marketRead so it
   * never becomes part of the public response contract.
   */
  observedEntryIds: readonly string[];
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
      observedEntryIds: [],
    };
  }

  const observedAtMs = Date.now();
  const requestedIdentityKeys = new Set(
    identities.map((identity) => identityKey({ identity })),
  );
  const byIdentity = new Map(
    snapshot.results.map((result) => [identityKey(result), result]),
  );
  const currentObservedResults = snapshot.results.filter(
    (result): result is Extract<
      DexscreenerShadowResultV1,
      { status: "available" }
    > =>
      requestedIdentityKeys.has(identityKey(result)) &&
      result.status === "available" &&
      dexscreenerExploreObservationCurrentV1(
        result.observation.fetchedAt,
        observedAtMs,
      ),
  );
  const observedIdentityKeys = new Set(
    currentObservedResults.map(identityKey),
  );
  const observedEntryIds = entries.filter((entry) =>
    exploreEntryMarketIdentitiesV1(entry).some((identity) =>
      observedIdentityKeys.has(identityKey({ identity }))
    )
  ).map((entry) => entry.id);
  const valuedEntries = entries.map((entry) =>
    valuedEntry(entry, byIdentity, observedAtMs)
  );
  const qualifiedCount = new Set(currentObservedResults.filter((result) =>
    result.fdvQualification.status === "qualified"
  ).map(identityKey)).size;
  const sourceTimes = currentObservedResults
    .map((result) => result.observation.fetchedAt)
    .sort();
  return {
    entries: valuedEntries,
    observedEntryIds,
    marketRead: {
      provider: "dexscreener",
      status: snapshot.readStatus,
      currency: snapshot.currency,
      requestedCount: snapshot.requestedCount,
      observedCount: observedIdentityKeys.size,
      qualifiedCount,
      unavailableCount: snapshot.requestedCount - qualifiedCount,
      oldestFetchedAt: sourceTimes[0] ?? null,
      newestFetchedAt: sourceTimes.at(-1) ?? null,
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
    result.fdvQualification.status === "qualified" &&
    dexscreenerExploreObservationCurrentV1(
      result.observation.fetchedAt,
      observedAtMs,
    )
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

export function dexscreenerExploreObservationCurrentV1(
  fetchedAt: string,
  nowMs = Date.now(),
): boolean {
  const fetchedAtMs = Date.parse(fetchedAt);
  return Number.isFinite(fetchedAtMs) &&
    Number.isFinite(nowMs) &&
    nowMs >= fetchedAtMs &&
    nowMs - fetchedAtMs <=
      DEXSCREENER_EXPLORE_OBSERVATION_MAXIMUM_AGE_MS;
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
  return [
    identity.chainId,
    identity.protocol,
    identity.tokenAddress,
    identity.poolId,
    identity.quoteAddress,
  ].join(":");
}
