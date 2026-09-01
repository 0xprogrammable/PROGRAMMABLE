import "server-only";

import type {
  ExploreValuation,
  ValuedExploreEntry,
} from "../explore-financial-data";
import type { ExploreEntry } from "../tokens";
import {
  canonicalTokenSupplyHydrationRequiredV1,
  hydrateMissingCanonicalTokenSupplyV1,
} from "./canonical-token-supply.server";
import {
  DEXSCREENER_EXPLORE_OBSERVATION_MAXIMUM_AGE_MS,
  dexscreenerExploreObservationCurrentV1,
  readDexscreenerExploreEntriesV1,
  type DexscreenerExploreReadV1,
  type DexscreenerExploreResultV1,
} from "./dexscreener-explore.server";
import {
  exploreEntriesMarketIdentitiesV1,
  exploreEntryMarketIdentitiesV1,
} from
  "./explore-market-identities";
import {
  gmgnMarketDataConfiguredV1,
  readGmgnExploreSnapshotsV1,
  gmgnVisibleMarketEntryEligibleV1,
  type GmgnReadWaitV1,
} from "./gmgn.server";
import type { GmgnMarketSnapshotV1 } from "./gmgn-market-data-v1";
import { MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD } from
  "./market-data-v1";

const GMGN_VISIBLE_PHASE_BUDGET_MS = 1_800;
// Dexscreener's fallback reader is bounded to seven seconds. Admit a GMGN
// observation only when it has enough public-freshness headroom to survive
// that fallback plus response assembly without changing providers mid-read.
const GMGN_VISIBLE_FALLBACK_FRESHNESS_RESERVE_MS = 10_000;
const CANONICAL_SUPPLY_PHASE_BUDGET_MS = 1_800;
const CANONICAL_SUPPLY_HYDRATION_LIMIT = 20;
const UINT256_MAX = (1n << 256n) - 1n;
const POSITIVE_CANONICAL_INTEGER = /^[1-9][0-9]*$/u;

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
  fallbackObservedCount: number;
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
  const hydratedEntries = await hydrateVisibleCanonicalSupplyV1(entries, wait);
  // GMGN token/info is one weighted request per eligible token. The visible
  // page is partitioned per entry so one unsupported or multi-market resource
  // cannot downgrade unrelated canonical tokens to the batch fallback.
  if (!gmgnMarketDataConfiguredV1()) {
    return readDexscreenerExploreEntriesV1(hydratedEntries, wait);
  }
  const requestedIdentities = exploreEntriesMarketIdentitiesV1(
    hydratedEntries,
  );
  const requestedIdentityKeys = new Set(
    requestedIdentities.map(exploreMarketIdentityKeyV1),
  );
  const gmgnCandidates = hydratedEntries.filter((entry) => {
    const identities = exploreEntryMarketIdentitiesV1(entry);
    return gmgnVisibleMarketEntryEligibleV1(entry) &&
      identities.length === 1 &&
      requestedIdentityKeys.has(exploreMarketIdentityKeyV1(identities[0]!));
  });
  if (gmgnCandidates.length === 0) {
    return readDexscreenerExploreEntriesV1(hydratedEntries, wait);
  }

  let snapshots: ReadonlyMap<string, GmgnMarketSnapshotV1>;
  try {
    // Reserve the majority of the request budget for the batch fallback. A
    // default-rate GMGN account must never queue nine visible-card requests
    // until the whole Explore deadline is exhausted.
    const phaseStartedAtMs = (wait.now ?? (() => new Date()))().getTime();
    snapshots = await readGmgnExploreSnapshotsV1(gmgnCandidates, {
      ...wait,
      deadlineMs: Math.min(
        wait.deadlineMs ?? Number.POSITIVE_INFINITY,
        phaseStartedAtMs + GMGN_VISIBLE_PHASE_BUDGET_MS,
      ),
    });
  } catch {
    snapshots = new Map();
  }
  const gmgnAdmissionAtMs = (wait.now ?? (() => new Date()))().getTime();
  const admittedGmgnEntries = new Map<string, ValuedExploreEntry>();
  const fallbackEntries: ExploreEntry[] = [];
  const gmgnCandidateIds = new Set(gmgnCandidates.map((entry) => entry.id));
  for (const entry of hydratedEntries) {
    const snapshot = snapshots.get(entry.id);
    if (
      gmgnCandidateIds.has(entry.id) &&
      snapshot &&
      gmgnSnapshotQualified(
        snapshot,
        gmgnAdmissionAtMs,
        DEXSCREENER_EXPLORE_OBSERVATION_MAXIMUM_AGE_MS -
          GMGN_VISIBLE_FALLBACK_FRESHNESS_RESERVE_MS,
      )
    ) {
      admittedGmgnEntries.set(entry.id, {
        ...entry,
        valuation: gmgnValuation(snapshot),
        gmgnMarketData: snapshot,
      });
    } else {
      fallbackEntries.push(entry);
    }
  }

  const fallback = fallbackEntries.length === 0
    ? emptyDexscreenerFallbackV1()
    : await readDexscreenerExploreEntriesV1(fallbackEntries, wait);
  const fallbackObservedAtMs = (wait.now ?? (() => new Date()))().getTime();
  // Recheck after the potentially slow fallback. The admission reserve should
  // keep ordinary reads inside the public window; this final filter is the
  // fail-closed boundary if a caller/provider exceeds that budget.
  const gmgnEntries = new Map(
    [...admittedGmgnEntries].filter(([, entry]) =>
      entry.gmgnMarketData !== undefined &&
      gmgnSnapshotQualified(entry.gmgnMarketData, fallbackObservedAtMs)
    ),
  );
  const gmgnQualifiedCount = gmgnEntries.size;
  const gmgnExpiredAfterFallback =
    admittedGmgnEntries.size - gmgnEntries.size;
  const fallbackById = new Map(fallback.entries.map((entry) => [entry.id, entry]));
  const fallbackWindowCurrent = fallback.marketRead.observedCount === 0
    ? fallback.marketRead.oldestFetchedAt === null &&
      fallback.marketRead.newestFetchedAt === null
    : (
      fallback.marketRead.oldestFetchedAt !== null &&
      fallback.marketRead.newestFetchedAt !== null &&
      dexscreenerExploreObservationCurrentV1(
        fallback.marketRead.oldestFetchedAt,
        fallbackObservedAtMs,
      ) &&
      dexscreenerExploreObservationCurrentV1(
        fallback.marketRead.newestFetchedAt,
        fallbackObservedAtMs,
      )
    );
  const fallbackObservedEntryIds = new Set(
    fallbackWindowCurrent
      ? fallback.observedEntryIds ?? fallback.entries.filter((entry) =>
        entry.valuation.status === "available"
      ).map((entry) => entry.id)
      : [],
  );
  const requestedCount = requestedIdentities.length;
  const fallbackRequestedCount = fallback.marketRead.requestedCount;
  const fallbackObservedCount = fallbackWindowCurrent
    ? Math.min(fallback.marketRead.observedCount, fallbackRequestedCount)
    : 0;
  const fallbackQualifiedCount = fallbackEntries.filter((entry) =>
    fallbackObservedEntryIds.has(entry.id) &&
    fallbackById.get(entry.id)?.valuation.status === "available"
  ).length;
  const valuedEntries = hydratedEntries.map((entry): ValuedExploreEntry => {
    const gmgn = gmgnEntries.get(entry.id);
    if (gmgn?.valuation.status === "available") return gmgn;
    const dexscreener = fallbackObservedEntryIds.has(entry.id)
      ? fallbackById.get(entry.id)
      : undefined;
    if (dexscreener?.valuation.status === "available") return dexscreener;
    return gmgn ?? dexscreener ?? unavailableEntry(entry);
  });
  const qualifiedCount = gmgnQualifiedCount + fallbackQualifiedCount;
  // A GMGN observation is public only when the same qualified snapshot is
  // attached to the returned entry. Liquidity-unqualified provider payloads
  // remain internal and therefore do not contribute to public source counts.
  const gmgnObservedIds = new Set(gmgnEntries.keys());
  const gmgnObservedCount = gmgnObservedIds.size;
  const gmgnTimes = [...gmgnEntries.values()].flatMap((entry) =>
    entry.gmgnMarketData ? [entry.gmgnMarketData.fetchedAt] : []
  );
  const sourceTimes = [
    ...gmgnTimes,
    ...(fallbackObservedCount > 0 && fallback.marketRead.oldestFetchedAt
      ? [fallback.marketRead.oldestFetchedAt]
      : []),
    ...(fallbackObservedCount > 0 && fallback.marketRead.newestFetchedAt
      ? [fallback.marketRead.newestFetchedAt]
      : []),
  ].sort();
  const providerHealthy = gmgnExpiredAfterFallback === 0 &&
    (fallbackRequestedCount === 0 ||
      fallback.marketRead.status === "complete");
  const observedCount = Math.min(
    requestedCount,
    gmgnObservedCount + fallbackObservedCount,
  );
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
      requestedCount,
      observedCount,
      qualifiedCount,
      unavailableCount: requestedCount - qualifiedCount,
      gmgnObservedCount,
      gmgnQualifiedCount,
      fallbackRequestedCount,
      fallbackObservedCount,
      fallbackQualifiedCount,
      oldestFetchedAt: observedCount === 0 ? null : sourceTimes[0] ?? null,
      newestFetchedAt: observedCount === 0 ? null : sourceTimes.at(-1) ?? null,
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
  if (marketRead.fallbackObservedCount > 0) sources.push("dexscreener");
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

function emptyDexscreenerFallbackV1(): DexscreenerExploreResultV1 {
  return {
    entries: [],
    observedEntryIds: [],
    marketRead: {
      provider: "dexscreener",
      status: "complete",
      currency: "USD",
      requestedCount: 0,
      observedCount: 0,
      qualifiedCount: 0,
      unavailableCount: 0,
      oldestFetchedAt: null,
      newestFetchedAt: null,
    },
  };
}

async function hydrateVisibleCanonicalSupplyV1(
  entries: readonly ExploreEntry[],
  wait: GmgnReadWaitV1,
): Promise<ExploreEntry[]> {
  if (entries.length === 0) return [];
  // The response deadline cannot cancel quorum reads that already started.
  // Admit one Pro-sized visible prefix before starting any supply RPC work;
  // later missing-supply entries remain unchanged for the Dex fallback.
  const hydrationCandidateIndexes = entries.flatMap((entry, index) =>
    canonicalTokenSupplyHydrationRequiredV1(entry) &&
      exploreEntryMarketIdentitiesV1(entry).length > 0
      ? [index]
      : []
  ).slice(0, CANONICAL_SUPPLY_HYDRATION_LIMIT);
  if (hydrationCandidateIndexes.length === 0) return [...entries];
  const hydrationCandidates = hydrationCandidateIndexes.map((index) =>
    entries[index]!
  );
  const nowMs = (wait.now ?? (() => new Date()))().getTime();
  const deadlineMs = Math.min(
    wait.deadlineMs ?? Number.POSITIVE_INFINITY,
    nowMs + CANONICAL_SUPPLY_PHASE_BUDGET_MS,
  );
  const remainingMs = deadlineMs - nowMs;
  if (
    wait.signal?.aborted ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(remainingMs) ||
    remainingMs <= 0
  ) return [...entries];

  const pending = hydrateMissingCanonicalTokenSupplyV1(
    hydrationCandidates,
    { deadlineMs, now: wait.now },
  );
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (value: readonly ExploreEntry[]) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      wait.signal?.removeEventListener("abort", onAbort);
      const merged = [...entries];
      for (const [candidateIndex, entryIndex] of
        hydrationCandidateIndexes.entries()) {
        const original = entries[entryIndex]!;
        const hydrated = value[candidateIndex];
        const supply = canonicalHydratedSupplyV1(hydrated);
        if (
          hydrated?.id === original.id &&
          hydrated.exploreKind === original.exploreKind &&
          hydrated.tokenAddress?.toLowerCase() ===
            original.tokenAddress?.toLowerCase() &&
          supply !== null
        ) {
          merged[entryIndex] = {
            ...original,
            totalSupplyRaw: supply.totalSupplyRaw,
            tokenDecimals: supply.tokenDecimals,
          };
        }
      }
      resolve(merged);
    };
    const onAbort = () => finish(hydrationCandidates);
    wait.signal?.addEventListener("abort", onAbort, { once: true });
    if (wait.signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(
      () => finish(hydrationCandidates),
      Math.min(Math.ceil(remainingMs), 2_147_483_647),
    );
    void pending.then(finish, () => finish(hydrationCandidates));
  });
}

function canonicalHydratedSupplyV1(
  entry: ExploreEntry | undefined,
): Readonly<{ totalSupplyRaw: string; tokenDecimals: number }> | null {
  if (
    typeof entry?.totalSupplyRaw !== "string" ||
    entry.totalSupplyRaw.length > 78 ||
    !POSITIVE_CANONICAL_INTEGER.test(entry.totalSupplyRaw) ||
    typeof entry.tokenDecimals !== "number" ||
    !Number.isSafeInteger(entry.tokenDecimals) ||
    entry.tokenDecimals < 0 || entry.tokenDecimals > 255
  ) return null;
  try {
    return BigInt(entry.totalSupplyRaw) <= UINT256_MAX
      ? {
          totalSupplyRaw: entry.totalSupplyRaw,
          tokenDecimals: entry.tokenDecimals,
        }
      : null;
  } catch {
    return null;
  }
}

function gmgnSnapshotQualified(
  snapshot: NonNullable<ValuedExploreEntry["gmgnMarketData"]>,
  nowMs: number,
  maximumAgeMs = DEXSCREENER_EXPLORE_OBSERVATION_MAXIMUM_AGE_MS,
) {
  const fetchedAtMs = Date.parse(snapshot.fetchedAt);
  return BigInt(snapshot.liquidityUsdWad) >=
      BigInt(MARKET_DATA_MINIMUM_FDV_LIQUIDITY_USD_WAD) &&
    Number.isFinite(fetchedAtMs) &&
    nowMs >= fetchedAtMs &&
    maximumAgeMs >= 0 &&
    nowMs - fetchedAtMs <= maximumAgeMs;
}

function exploreMarketIdentityKeyV1(
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
