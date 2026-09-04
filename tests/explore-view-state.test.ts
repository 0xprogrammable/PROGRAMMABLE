import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EXPLORE_MOBILE_TOKENS_PER_PAGE,
  EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
  EXPLORE_TOKENS_PER_PAGE,
  createExploreInitialState,
  createResponsiveExploreInitialState,
  exploreActiveSelectionState,
  exploreAppliedSortLabel,
  exploreMarketStatusLabel,
  explorePageSizeMatchesViewport,
  exploreUnavailableFdvLabel,
  exploreTokensPerPageForViewport,
  handledInitialExploreRequestKey,
  filterTokensByLaunchModel,
  filterTokensBySocialPresence,
  formatExploreContractAddress,
  getTokenCards,
  getExplorePaginationItems,
  getExploreValuationMetric,
  loadExploreModelDataset,
  loadExplorePage,
  loadExplorePayload,
  paginateExploreModelDataset,
  paginateTokensByExploreFilters,
  paginateTokensByExploreSelections,
  paginateTokensBySocialPresence,
  parseExploreDiscoveryRanking,
  parseExploreRanking,
  parseExploreSearchRanking,
  preserveExplorePayloadOnRefreshFailure,
  requiresCompleteExploreDataset,
  resolveExploreServerSort,
  resolveExploreSortSelectionsForChain,
  sortExploreEntriesBySelections,
  stabilizeExploreRevalidationPayload,
  tokenHasSocialLinks,
  tokenLaunchModelGroup,
} from "../components/explore-view";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";
import { customGraphExploreEntry } from "./launch-stamp-surface-fixture";

describe("Explore discovery client contract", () => {
  const duplicateAddressDiscovery = {
    schemaVersion: "programmable.explore-discovery-ranking.v1",
    provider: "gmgn",
    requested: "trending",
    rankingCommitment: `sha256:${"ab".repeat(32)}`,
    status: "complete",
    applied: "gmgn-ranked-with-launch-order-fallback",
    rankInterval: "1h",
    hotSearchInterval: "24h",
    snapshotCount: 1,
    observedTokenCount: 1,
    matchedTokenCount: 2,
    matchedUniqueTokenCount: 1,
    canonicalEntryCount: 2,
    canonicalTokenCount: 1,
    unobservedCanonicalEntryCount: 0,
    canonicalAddressCoverageBps: 10_000,
    foreignTokenCount: 0,
    discardedProviderItemCount: 0,
    asOfTime: "2026-09-01T08:00:00.000Z",
  } as const;

  it("keeps matched entries separate from unique-address coverage", () => {
    expect(parseExploreDiscoveryRanking(duplicateAddressDiscovery, 2))
      .toEqual(duplicateAddressDiscovery);
    expect(parseExploreDiscoveryRanking({
      ...duplicateAddressDiscovery,
      matchedUniqueTokenCount: 2,
    }, 2)).toBeNull();
    expect(parseExploreDiscoveryRanking({
      ...duplicateAddressDiscovery,
      rankingCommitment: "sha256:not-a-digest",
    }, 2)).toBeNull();
  });
});

describe("Explore search client contract", () => {
  const search = {
    schemaVersion: "programmable.explore-search-ranking.v1",
    provider: "gmgn",
    requested: "search",
    orderBy: "weight",
    rankingCommitment: `sha256:${"bc".repeat(32)}`,
    status: "partial",
    applied: "gmgn-canonical-search-with-local-match-fallback",
    observedTokenCount: 3,
    matchedTokenCount: 2,
    matchedUniqueTokenCount: 2,
    canonicalMatchCount: 3,
    canonicalMatchTokenCount: 3,
    unobservedCanonicalMatchCount: 1,
    providerOnlyCanonicalTokenCount: 1,
    foreignTokenCount: 1,
    discardedProviderItemCount: 2,
    duplicateProviderItemCount: 1,
    canonicalAddressCoverageBps: 6_666,
    asOfTime: "2026-09-01T08:00:00.000Z",
  } as const;

  it("parses only the aggregate canonical-intersection proof", () => {
    expect(parseExploreSearchRanking(search, 3)).toEqual(search);
    expect(parseExploreSearchRanking({
      ...search,
      observedTokenCount: 2,
    }, 3)).toBeNull();
    expect(parseExploreSearchRanking({
      ...search,
      canonicalAddressCoverageBps: 10_000,
    }, 3)).toBeNull();
    expect(parseExploreSearchRanking({
      ...search,
      rankingCommitment: "sha256:not-a-digest",
    }, 3)).toBeNull();
  });

  it("rejects raw foreign provider rows instead of retaining them as proof", () => {
    expect(parseExploreSearchRanking({
      ...search,
      coins: [{
        chain: "eth",
        address: "0xffffffffffffffffffffffffffffffffffffffff",
      }],
    }, 3)).toBeNull();
    expect(parseExploreSearchRanking({
      ...search,
      wallets: ["0xffffffffffffffffffffffffffffffffffffffff"],
    }, 3)).toBeNull();
  });
});

describe("Explore market-cap ranking client contract", () => {
  const ranking = {
    schemaVersion: "programmable.explore-market-cap-ranking.v1",
    requested: "market-cap",
    direction: "desc",
    primaryProvider: "gmgn",
    source: "gmgn+dexscreener",
    fallbackProvider: "dexscreener",
    rankingCommitment: `sha256:${"cd".repeat(32)}`,
    status: "partial",
    gmgnStatus: "partial",
    applied:
      "gmgn-market-cap-then-gmgn-token-info-fdv-then-dexscreener-fdv-then-launch-order",
    metricOrder:
      "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order",
    rankInterval: "1h",
    rankLimit: 100,
    observedTokenCount: 2,
    matchedTokenCount: 1,
    matchedUniqueTokenCount: 1,
    canonicalEntryCount: 4,
    canonicalTokenCount: 4,
    unobservedCanonicalEntryCount: 3,
    canonicalAddressCoverageBps: 2_500,
    foreignTokenCount: 1,
    discardedProviderItemCount: 1,
    gmgnHydrationLimit: 100,
    gmgnHydrationEligibleCount: 3,
    gmgnHydrationRequestedCount: 3,
    gmgnHydrationObservedCount: 2,
    gmgnHydrationQualifiedCount: 1,
    gmgnHydrationDeferredCount: 0,
    fallbackRequestedCount: 2,
    fallbackQualifiedCount: 1,
    canonicalTailCount: 1,
    qualifiedCount: 3,
    totalCount: 4,
    asOfTime: "2026-09-01T08:00:00.000Z",
  } as const;

  it("keeps aggregate and GMGN-only coverage distinct", () => {
    expect(parseExploreRanking(ranking, 4)).toEqual(ranking);
    expect(parseExploreRanking({
      ...ranking,
      gmgnStatus: "complete",
    }, 4)).toBeNull();
    expect(parseExploreRanking({
      ...ranking,
      source: "gmgn",
    }, 4)).toBeNull();
    expect(parseExploreRanking({
      ...ranking,
      rankingCommitment: "sha256:not-a-digest",
    }, 4)).toBeNull();
    expect(parseExploreRanking({
      ...ranking,
      gmgnHydrationRequestedCount: 2,
    }, 4)).toBeNull();
    expect(parseExploreRanking({
      ...ranking,
      fallbackRequestedCount: 3,
    }, 4)).toBeNull();
    expect(parseExploreRanking({
      ...ranking,
      canonicalTailCount: 0,
    }, 4)).toBeNull();
  });

  it("keeps a rank snapshot time for foreign-only GMGN observations", () => {
    const foreignOnly = {
      ...ranking,
      source: "canonical-launch-order",
      status: "unavailable",
      gmgnStatus: "unavailable",
      applied: "launch-order",
      observedTokenCount: 2,
      matchedTokenCount: 0,
      matchedUniqueTokenCount: 0,
      unobservedCanonicalEntryCount: 4,
      canonicalAddressCoverageBps: 0,
      foreignTokenCount: 2,
      gmgnHydrationEligibleCount: 4,
      gmgnHydrationRequestedCount: 4,
      gmgnHydrationObservedCount: 0,
      gmgnHydrationQualifiedCount: 0,
      fallbackRequestedCount: 4,
      fallbackQualifiedCount: 0,
      canonicalTailCount: 4,
      qualifiedCount: 0,
      asOfTime: "2026-09-01T08:00:00.000Z",
    } as const;

    expect(parseExploreRanking(foreignOnly, 4)).toEqual(foreignOnly);
    expect(parseExploreRanking({ ...foreignOnly, asOfTime: null }, 4)).toBeNull();
  });
});

const classicProvenance = {
  schemaVersion: "programmable.explore-launch-category-provenance.v1",
  category: "classic",
  source: "canonical-launch-read-model",
  recordId: "fixture",
  modelId: null,
  modelVersion: null,
} as const;

const customProvenance = {
  schemaVersion: "programmable.explore-launch-category-provenance.v1",
  category: "custom",
  source: "interface-preview",
  projectId: `sha256:${"1".repeat(64)}`,
  launchId: `sha256:${"2".repeat(64)}`,
  sourceRecordBindingHash: `sha256:${"3".repeat(64)}`,
  finalizedLaunchBindingHash: `sha256:${"4".repeat(64)}`,
} as const;

function classicEntry(token: LauncherToken): ExploreEntry {
  return {
    ...token,
    exploreKind: "token",
    launchCategoryProvenance: {
      ...classicProvenance,
      recordId: token.id,
      modelId: token.launchModel ?? null,
      modelVersion: token.launchModelVersion ?? token.deepReleaseVersion ?? null,
    },
  };
}

function customEntry(index: number): ExploreEntry {
  const hash = `sha256:${index.toString(16).padStart(64, "0")}` as const;
  const wallet = {
    namespace: "eip155:1",
    value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  } as const;
  return {
    exploreKind: "custom-project",
    id: `custom:${index}`,
    name: `Custom ${index}`,
    symbol: `C${index}`,
    links: [],
    launchedAt: "2026-08-03T00:00:00.000Z",
    finalizedAt: "2026-08-03T00:01:00.000Z",
    chainId: "1",
    modelId: "custom-contract-graph-v2",
    customProjectId: hash,
    customLaunchId: hash,
    launchingWallet: wallet,
    postLaunchAuthorityInventoryHash: hash,
    markets: [],
    postLaunchAuthorityInventory: {
      schemaVersion: "programmable.post-launch-authority-inventory.v1",
      launchingWallet: wallet,
      addressBindings: [],
      declaredIdentityBindings: [],
      postLaunchAuthorities: [],
      confirmation: {
        mode: "artifact-bound-launching-wallet-intent",
        confirmingIdentity: wallet,
        userVisibleDisclosureRequired: true,
      },
      postLaunchActionPolicy: "declared-onchain-authority-only",
      githubAuthority: "provenance-only-never-post-launch-authority",
      postLaunchAuthorityInventoryHash: hash,
    },
    launchCategoryProvenance: {
      ...customProvenance,
      projectId: hash,
      launchId: hash,
    },
  };
}

const catalogBoundary = {
  source: "envio-classic-v3" as const,
  launchSource: "envio-classic-v3+registry.custom-launched" as const,
  status: "current" as const,
  lastIndexedAt: "2026-08-14T00:00:00.000Z",
  asOfBlock: "25740000",
  asOfBlockHash: `0x${"ab".repeat(32)}` as `0x${string}`,
  identityCount: 351,
  identityCommitment: `sha256:${"cd".repeat(32)}` as `sha256:${string}`,
  completeness: {
    classic: "current" as const,
    stock: "excluded" as const,
    custom: "current" as const,
  },
  scope: {
    included: [
      "classic-v3",
      "classic-v4",
      "official-main-token",
      "registry.custom-launched",
    ] as const,
    excluded: [
      "classic-v1",
      "classic-v2",
      "stock-paired-v1",
      "stock-paired-v2",
      "stock-paired-v3",
    ] as const,
    publicCategories: ["classic", "custom"] as const,
  },
  evidence: {
    kind: "envio-indexer-state" as const,
    deployment: "production-92f6373",
    sourceCommit: "92f63731ff0a61601a649cf40ceba3e492f63c62",
    progressBlock: "25740000",
    progressOccurrenceId: `1:0x${"11".repeat(32)}:0x${"22".repeat(32)}:0`,
    commitment: `sha256:${"ef".repeat(32)}` as `sha256:${string}`,
  },
};

const payload = {
  status: "ready" as const,
  tokens: [],
  page: 1,
  pageSize: 9,
  total: 18,
  totalPages: 2,
  catalog: catalogBoundary,
};

const bitqueryMarketEntry = classicEntry({
  id: "1:bitquery-market",
  name: "Bitquery market",
  symbol: "BQM",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  launchedAt: "2026-08-11T14:00:00.000Z",
  totalSwapFeeBps: 100,
  liquidityPath: "meme",
});

const unvaluedMarketPayload = {
  ...payload,
  tokens: [{
    ...bitqueryMarketEntry,
    valuation: { status: "unavailable", reason: "source-unavailable" },
  }],
  total: 1,
  totalPages: 1,
};

const valuedMarketPayload = {
  ...payload,
  tokens: [{
    ...bitqueryMarketEntry,
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      valueWad: "125000000000000000000",
      freshness: "current",
      source: "bitquery",
    },
  }],
  total: 1,
  totalPages: 1,
};

const wrongCurrencyMarketPayload = {
  ...valuedMarketPayload,
  tokens: valuedMarketPayload.tokens.map((token) => ({
    ...token,
    valuation: { ...token.valuation, currency: "eth" },
  })),
};

const unavailableMarketDataQuality = {
  schemaVersion: "programmable.explore-data-quality.v1",
  status: "partial",
  generatedAt: "2026-08-14T00:00:00.000Z",
  launchIdentity: {
    status: "current",
    canonical: "current",
    custom: "current",
    asOfBlock: "25740000",
    referenceBlock: "25740000",
    lagBlocks: "0",
    ageMs: 0,
  },
  valuation: {
    status: "unavailable",
    metric: "fdv",
    available: 0,
    unavailable: 1,
    stale: 0,
    unknown: 0,
    asOfBlock: null,
    asOfTime: null,
  },
} as const;

const transportUnavailableMarketPayload = {
  ...unvaluedMarketPayload,
  dataQuality: unavailableMarketDataQuality,
  marketRead: {
    provider: "bitquery",
    status: "unavailable",
    category: "transport",
    phase: "market-core",
  },
  ranking: {
    status: "unavailable",
    requested: "fdv",
    applied: "launch-order",
  },
} as const;

const responseUnavailableMarketPayload = {
  ...unvaluedMarketPayload,
  dataQuality: unavailableMarketDataQuality,
  marketRead: {
    provider: "bitquery",
    status: "unavailable",
    category: "response",
    phase: "market-core",
    reason: "http-status",
    httpStatus: 402,
  },
  ranking: {
    status: "unavailable",
    requested: "fdv",
    applied: "launch-order",
  },
} as const;

function modelCompatibilityMarketData() {
  return {
    schemaVersion: "programmable.market-data.v1" as const,
    source: "bitquery" as const,
    generatedAt: "2026-08-14T00:00:00.000Z",
    status: "current" as const,
    primaryPoolId: null,
    pools: [],
  };
}

function modelFilterEntry(
  index: number,
  valuation: "available" | "unavailable",
) {
  const entry = classicEntry({
    id: `1:model-filter-${index}`,
    name: `Model filter ${index}`,
    symbol: `MF${index}`,
    tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
    hookAddress: "0x2222222222222222222222222222222222222222",
    poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
    launchedAt: "2026-08-03T00:00:00.000Z",
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
  });
  return {
    ...entry,
    ...(valuation === "available"
      ? {
          fdvUsdWad: `${index + 1}000000000000000000`,
          marketData: modelCompatibilityMarketData(),
        }
      : {}),
    valuation: valuation === "available"
      ? {
          status: "available" as const,
          metric: "fdv" as const,
          supplyBasis: "total" as const,
          currency: "usd" as const,
          valueWad: `${index + 1}000000000000000000`,
          freshness: "current" as const,
          source: "bitquery" as const,
        }
      : {
          status: "unavailable" as const,
          reason: "source-unavailable" as const,
        },
  };
}

function modelPageDataQuality(available: number, unavailable: number) {
  const current = available > 0 && unavailable === 0;
  return {
    schemaVersion: "programmable.explore-data-quality.v1",
    status: current ? "complete" as const : "partial" as const,
    generatedAt: "2026-08-14T00:00:00.000Z",
    launchIdentity: {
      status: "current" as const,
      canonical: "current" as const,
      custom: "current" as const,
      asOfBlock: "25740000",
      referenceBlock: "25740000",
      lagBlocks: "0",
      ageMs: 0,
    },
    valuation: {
      status: current ? "current" as const : "unavailable" as const,
      metric: "fdv" as const,
      available,
      unavailable,
      stale: 0,
      unknown: 0,
      asOfBlock: null,
      asOfTime: null,
    },
  };
}

function unavailableMarketCapRanking(
  total: number,
  rankingCommitment: `sha256:${string}`,
) {
  return {
    schemaVersion: "programmable.explore-market-cap-ranking.v1",
    requested: "market-cap",
    direction: "desc",
    primaryProvider: "gmgn",
    source: "canonical-launch-order",
    fallbackProvider: "dexscreener",
    rankingCommitment,
    status: "unavailable",
    gmgnStatus: "unavailable",
    applied: "launch-order",
    metricOrder:
      "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order",
    rankInterval: "1h",
    rankLimit: 100,
    observedTokenCount: 0,
    matchedTokenCount: 0,
    matchedUniqueTokenCount: 0,
    canonicalEntryCount: total,
    canonicalTokenCount: total,
    unobservedCanonicalEntryCount: total,
    canonicalAddressCoverageBps: 0,
    foreignTokenCount: 0,
    discardedProviderItemCount: 0,
    gmgnHydrationLimit: 100,
    gmgnHydrationEligibleCount: 0,
    gmgnHydrationRequestedCount: 0,
    gmgnHydrationObservedCount: 0,
    gmgnHydrationQualifiedCount: 0,
    gmgnHydrationDeferredCount: 0,
    fallbackRequestedCount: total,
    fallbackQualifiedCount: 0,
    canonicalTailCount: total,
    qualifiedCount: 0,
    totalCount: total,
    asOfTime: null,
  } as const;
}

function unavailableGmgnMarketRead(total: number) {
  return {
    provider: "gmgn",
    status: "unavailable",
    currency: "USD",
    requestedCount: total,
    observedCount: 0,
    qualifiedCount: 0,
    unavailableCount: total,
    oldestFetchedAt: null,
    newestFetchedAt: null,
    fallbackProvider: "dexscreener",
    gmgnObservedCount: 0,
    gmgnQualifiedCount: 0,
    fallbackRequestedCount: total,
    fallbackObservedCount: 0,
    fallbackQualifiedCount: 0,
  } as const;
}

function sparseDexscreenerMarketCapRanking(
  total: number,
  qualified: number,
  rankingCommitment: `sha256:${string}`,
) {
  return {
    ...unavailableMarketCapRanking(total, rankingCommitment),
    source: "dexscreener",
    status: "partial",
    applied: "qualified-fdv-then-launch-order",
    fallbackQualifiedCount: qualified,
    canonicalTailCount: total - qualified,
    qualifiedCount: qualified,
    asOfTime: "2026-08-16T08:00:00.000Z",
  } as const;
}

describe("Explore provider-ranked revalidation", () => {
  const entries = Array.from(
    { length: 4 },
    (_, index) => modelFilterEntry(100 + index, "unavailable"),
  );

  it("adopts a recovered GMGN search page and its expanded alias total atomically", () => {
    const previousSearch = {
      schemaVersion: "programmable.explore-search-ranking.v1",
      provider: "gmgn",
      requested: "search",
      orderBy: "weight",
      rankingCommitment: `sha256:${"10".repeat(32)}`,
      status: "unavailable",
      applied: "local-match-order",
      observedTokenCount: 0,
      matchedTokenCount: 0,
      matchedUniqueTokenCount: 0,
      canonicalMatchCount: 3,
      canonicalMatchTokenCount: 3,
      unobservedCanonicalMatchCount: 3,
      providerOnlyCanonicalTokenCount: 0,
      foreignTokenCount: 0,
      discardedProviderItemCount: 0,
      duplicateProviderItemCount: 0,
      canonicalAddressCoverageBps: 0,
      asOfTime: null,
    } as const;
    const incomingSearch = {
      ...previousSearch,
      rankingCommitment: `sha256:${"11".repeat(32)}`,
      status: "partial",
      applied: "gmgn-canonical-search-with-local-match-fallback",
      observedTokenCount: 1,
      matchedTokenCount: 1,
      matchedUniqueTokenCount: 1,
      canonicalMatchCount: 4,
      canonicalMatchTokenCount: 4,
      unobservedCanonicalMatchCount: 3,
      providerOnlyCanonicalTokenCount: 1,
      canonicalAddressCoverageBps: 2_500,
      asOfTime: "2026-09-01T08:01:00.000Z",
    } as const;
    const previous = {
      ...payload,
      tokens: [entries[0]!, entries[1]!],
      pageSize: 2,
      total: 3,
      totalPages: 2,
      search: previousSearch,
    };
    const incoming = {
      ...payload,
      tokens: [entries[3]!, entries[0]!],
      pageSize: 2,
      total: 4,
      totalPages: 2,
      search: incomingSearch,
    };

    const stable = stabilizeExploreRevalidationPayload(previous, incoming);

    expect(stable.tokens.map((token) => token.id)).toEqual([
      entries[3]!.id,
      entries[0]!.id,
    ]);
    expect(stable.total).toBe(4);
    expect(stable.totalPages).toBe(2);
    expect(stable.search).toEqual(incomingSearch);
  });

  it("adopts a changed GMGN alias relevance order with its new commitment", () => {
    const previousSearch = {
      schemaVersion: "programmable.explore-search-ranking.v1",
      provider: "gmgn",
      requested: "search",
      orderBy: "weight",
      rankingCommitment: `sha256:${"20".repeat(32)}`,
      status: "partial",
      applied: "gmgn-canonical-search-with-local-match-fallback",
      observedTokenCount: 2,
      matchedTokenCount: 2,
      matchedUniqueTokenCount: 2,
      canonicalMatchCount: 3,
      canonicalMatchTokenCount: 3,
      unobservedCanonicalMatchCount: 1,
      providerOnlyCanonicalTokenCount: 1,
      foreignTokenCount: 0,
      discardedProviderItemCount: 0,
      duplicateProviderItemCount: 0,
      canonicalAddressCoverageBps: 6_666,
      asOfTime: "2026-09-01T08:02:00.000Z",
    } as const;
    const incomingSearch = {
      ...previousSearch,
      rankingCommitment: `sha256:${"21".repeat(32)}`,
      asOfTime: "2026-09-01T08:03:00.000Z",
    } as const;
    const previous = {
      ...payload,
      tokens: [entries[0]!, entries[1]!],
      pageSize: 2,
      total: 3,
      totalPages: 2,
      search: previousSearch,
    };
    const incoming = {
      ...previous,
      tokens: [entries[1]!, entries[0]!],
      search: incomingSearch,
    };

    const stable = stabilizeExploreRevalidationPayload(previous, incoming);

    expect(stable.tokens.map((token) => token.id)).toEqual([
      entries[1]!.id,
      entries[0]!.id,
    ]);
    expect(stable.search?.rankingCommitment).toBe(
      incomingSearch.rankingCommitment,
    );
  });

  it("keeps market-cap membership, order, totals, and commitment from one payload", () => {
    const previousRanking = {
      schemaVersion: "programmable.explore-market-cap-ranking.v1",
      requested: "market-cap",
      direction: "desc",
      primaryProvider: "gmgn",
      source: "gmgn",
      fallbackProvider: "dexscreener",
      rankingCommitment: `sha256:${"30".repeat(32)}`,
      status: "complete",
      gmgnStatus: "complete",
      applied: "gmgn-market-cap",
      metricOrder:
        "gmgn-market-cap>gmgn-token-info-fdv>dexscreener-fdv>canonical-launch-order",
      rankInterval: "1h",
      rankLimit: 100,
      observedTokenCount: 2,
      matchedTokenCount: 2,
      matchedUniqueTokenCount: 2,
      canonicalEntryCount: 2,
      canonicalTokenCount: 2,
      unobservedCanonicalEntryCount: 0,
      canonicalAddressCoverageBps: 10_000,
      foreignTokenCount: 0,
      discardedProviderItemCount: 0,
      gmgnHydrationLimit: 100,
      gmgnHydrationEligibleCount: 0,
      gmgnHydrationRequestedCount: 0,
      gmgnHydrationObservedCount: 0,
      gmgnHydrationQualifiedCount: 0,
      gmgnHydrationDeferredCount: 0,
      fallbackRequestedCount: 0,
      fallbackQualifiedCount: 0,
      canonicalTailCount: 0,
      qualifiedCount: 2,
      totalCount: 2,
      asOfTime: "2026-09-01T08:04:00.000Z",
    } as const;
    const incomingRanking = {
      ...previousRanking,
      rankingCommitment: `sha256:${"31".repeat(32)}`,
      asOfTime: "2026-09-01T08:05:00.000Z",
    } as const;
    const previous = {
      ...payload,
      tokens: [entries[0]!, entries[1]!],
      pageSize: 2,
      total: 2,
      totalPages: 1,
      ranking: previousRanking,
    };
    const incoming = {
      ...previous,
      tokens: [entries[1]!, entries[0]!],
      ranking: incomingRanking,
    };

    const stable = stabilizeExploreRevalidationPayload(previous, incoming);

    expect(stable.tokens.map((token) => token.id)).toEqual([
      entries[1]!.id,
      entries[0]!.id,
    ]);
    expect(stable.total).toBe(incoming.total);
    expect(stable.totalPages).toBe(incoming.totalPages);
    expect(stable.ranking).toEqual(incomingRanking);
  });

  it("drops provider-order proofs from a locally reordered market-cap and oldest page", () => {
    const sharedValueWad = "500000000000000000000";
    const newer = {
      ...modelFilterEntry(200, "available"),
      launchedAt: "2026-08-04T00:00:00.000Z",
      fdvUsdWad: sharedValueWad,
      valuation: {
        ...modelFilterEntry(200, "available").valuation,
        valueWad: sharedValueWad,
      },
    };
    const older = {
      ...modelFilterEntry(201, "available"),
      launchedAt: "2026-08-01T00:00:00.000Z",
      fdvUsdWad: sharedValueWad,
      valuation: {
        ...modelFilterEntry(201, "available").valuation,
        valueWad: sharedValueWad,
      },
    };
    const ranking = {
      requested: "market-cap",
      rankingCommitment: `sha256:${"40".repeat(32)}`,
    };
    const discovery = {
      requested: "trending",
      rankingCommitment: `sha256:${"41".repeat(32)}`,
    };
    const search = {
      requested: "search",
      rankingCommitment: `sha256:${"42".repeat(32)}`,
    };
    const dataset = {
      ...payload,
      tokens: [newer, older],
      pageSize: 100,
      total: 2,
      totalPages: 1,
      dataQuality: modelPageDataQuality(2, 0),
      ranking,
      discovery,
      search,
    };

    const locallyOrdered = paginateExploreModelDataset(
      dataset as never,
      "all",
      1,
      9,
      "highest",
      "oldest",
      "all",
    );

    expect(locallyOrdered.tokens.map((token) => token.id)).toEqual([
      older.id,
      newer.id,
    ]);
    expect(locallyOrdered.ranking).toBeUndefined();
    expect(locallyOrdered.discovery).toBeUndefined();
    expect(locallyOrdered.search).toBeUndefined();
    expect(locallyOrdered.catalog).toEqual(catalogBoundary);
    expect(locallyOrdered.dataQuality?.valuation).toMatchObject({
      available: 2,
      unavailable: 0,
    });

    const providerOrdered = paginateExploreModelDataset(
      dataset as never,
      "all",
      1,
      9,
      "highest",
      "none",
      "all",
    );
    expect(providerOrdered.tokens.map((token) => token.id)).toEqual([
      newer.id,
      older.id,
    ]);
    expect(providerOrdered.ranking).toBe(ranking);
    expect(providerOrdered.discovery).toBe(discovery);
    expect(providerOrdered.search).toBe(search);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Explore refresh state", () => {
  it("keeps compact contract identity readable on narrow cards", () => {
    expect(formatExploreContractAddress(
      "0x1234567890abcdef1234567890abcdef12345678",
    )).toBe("0x1234…678");
  });

  it("hydrates the first server page without waiting for a client request", () => {
    expect(
      createExploreInitialState(
        {
          ok: true,
          body: payload,
        },
        {
          contentKey: "initial-content",
          requestKey: "initial-request",
          pageSize: EXPLORE_TOKENS_PER_PAGE,
        },
      ),
    ).toEqual({
      phase: "ready",
      payload,
      contentKey: "initial-content",
      requestKey: "initial-request",
    });
  });

  it("accepts only the exact bound Classic V4 catalog scope", () => {
    const input = {
      contentKey: "classic-v4-content",
      requestKey: "classic-v4-request",
      pageSize: EXPLORE_TOKENS_PER_PAGE,
    };

    expect(createExploreInitialState({ ok: true, body: payload }, input))
      .toMatchObject({ phase: "ready" });

    for (const included of [
      [
        "classic-v3",
        "official-main-token",
        "registry.custom-launched",
      ],
      [
        "classic-v3",
        "classic-v4",
        "classic-v4",
        "official-main-token",
        "registry.custom-launched",
      ],
    ]) {
      const state = createExploreInitialState({
        ok: true,
        body: {
          ...payload,
          catalog: {
            ...catalogBoundary,
            scope: { ...catalogBoundary.scope, included },
          },
        },
      }, input);

      expect(state).toMatchObject({
        phase: "error",
        message: "The token registry returned invalid catalog data",
      });
    }
  });

  it("hydrates a Router-only fallback when Envio is unavailable", () => {
    const routerFallback = {
      status: "ready" as const,
      tokens: [{
        ...customGraphExploreEntry,
        valuation: { status: "unavailable", reason: "source-unavailable" },
      }],
      page: 1,
      pageSize: 9,
      total: 1,
      totalPages: 1,
      catalog: {
        source: "envio-classic-v3" as const,
        launchSource: "canonical-launch-stamp-router" as const,
        status: "last-known-good" as const,
        lastIndexedAt: "2026-08-25T06:00:00.000Z",
        asOfBlock: "25740001",
        asOfBlockHash: `0x${"bc".repeat(32)}`,
        identityCount: 1,
        identityCommitment: `sha256:${"ac".repeat(32)}`,
        completeness: {
          classic: "unavailable" as const,
          stock: "excluded" as const,
          custom: "unavailable" as const,
          registryCustom: "unavailable" as const,
          routerCustom: "current" as const,
        },
        scope: {
          included: ["canonical-launch-stamp-router"] as const,
          excluded: catalogBoundary.scope.excluded,
          publicCategories: ["classic", "custom"] as const,
        },
        routerStamp: {
          source: "canonical-launch-stamp-router" as const,
          status: "current" as const,
          finalityConfirmations: 64 as const,
          verifiedIdentityCount: 1,
          projectedIdentityCount: 1,
          generatedAt: "2026-08-25T06:00:00.000Z",
          asOfBlock: "25740001",
          asOfBlockHash: `0x${"bc".repeat(32)}`,
          identityCommitment: `sha256:${"ac".repeat(32)}`,
        },
      },
    };

    const state = createExploreInitialState(
      { ok: true, body: routerFallback },
      {
        contentKey: "router-fallback-content",
        requestKey: "router-fallback-request",
        pageSize: EXPLORE_TOKENS_PER_PAGE,
      },
    );

    expect(state).toMatchObject({
      phase: "ready",
      payload: {
        tokens: [{ tokenAddress: customGraphExploreEntry.tokenAddress }],
        catalog: { launchSource: "canonical-launch-stamp-router" },
      },
    });

    expect(createExploreInitialState({
      ok: true,
      body: {
        ...routerFallback,
        catalog: {
          ...routerFallback.catalog,
          scope: {
            ...routerFallback.catalog.scope,
            included: ["classic-v4", "canonical-launch-stamp-router"],
          },
        },
      },
    }, {
      contentKey: "router-fallback-invalid-content",
      requestKey: "router-fallback-invalid-request",
      pageSize: EXPLORE_TOKENS_PER_PAGE,
    })).toMatchObject({
      phase: "error",
      message: "The token registry returned invalid catalog data",
    });
  });

  it("hydrates a bounded durable catalog during a cold Envio read", () => {
    const durableFallback = {
      ...payload,
      catalog: {
        source: "durable-blob" as const,
        launchSource:
          "durable-blob+canonical-launch-stamp-router" as const,
        status: "last-known-good" as const,
        lastIndexedAt: "2026-08-25T06:00:00.000Z",
        asOfBlock: "25740001",
        asOfBlockHash: `0x${"bc".repeat(32)}`,
        identityCount: 351,
        identityCommitment: `sha256:${"ac".repeat(32)}`,
        completeness: {
          classic: "last-known-good" as const,
          stock: "last-known-good" as const,
          custom: "unavailable" as const,
          registryCustom: "unavailable" as const,
          routerCustom: "current" as const,
        },
        evidence: {
          kind: "durable-envelope" as const,
          commitment: `0x${"cd".repeat(32)}`,
        },
        routerStamp: {
          source: "canonical-launch-stamp-router" as const,
          status: "current" as const,
          finalityConfirmations: 64 as const,
          verifiedIdentityCount: 1,
          projectedIdentityCount: 1,
          generatedAt: "2026-08-25T06:00:00.000Z",
          asOfBlock: "25740001",
          asOfBlockHash: `0x${"bc".repeat(32)}`,
          identityCommitment: `sha256:${"ac".repeat(32)}`,
        },
      },
    };

    expect(createExploreInitialState(
      { ok: true, body: durableFallback },
      {
        contentKey: "durable-fallback-content",
        requestKey: "durable-fallback-request",
        pageSize: EXPLORE_TOKENS_PER_PAGE,
      },
    )).toMatchObject({
      phase: "ready",
      payload: {
        catalog: {
          source: "durable-blob",
          status: "last-known-good",
        },
      },
    });

    expect(createExploreInitialState({
      ok: true,
      body: {
        ...durableFallback,
        catalog: { ...durableFallback.catalog, evidence: undefined },
      },
    }, {
      contentKey: "durable-fallback-invalid-content",
      requestKey: "durable-fallback-invalid-request",
      pageSize: EXPLORE_TOKENS_PER_PAGE,
    })).toMatchObject({
      phase: "error",
      message: "The token registry returned invalid catalog data",
    });
  });

  it("surfaces a server-side Explore failure with explicit recovery", () => {
    const initialState = createExploreInitialState(
        {
          ok: false,
          body: { error: "Launch index is catching up" },
        },
        {
          contentKey: "initial-content-error",
          requestKey: "initial-request-error",
          pageSize: EXPLORE_TOKENS_PER_PAGE,
        },
      );

    expect(initialState).toEqual({
      phase: "error",
      message: "Launch index is catching up",
      contentKey: "initial-content-error",
      requestKey: "initial-request-error",
    });
    expect(
      handledInitialExploreRequestKey(initialState, "initial-request-error"),
    ).toBe("initial-request-error");
  });

  it("surfaces an error only after the client retry also fails", () => {
    expect(
      preserveExplorePayloadOnRefreshFailure(
        { phase: "loading" },
        {
          contentKey: "initial-content-error",
          requestKey: "initial-request-error",
          message: "Launch index is catching up",
        },
      ),
    ).toEqual({
      phase: "error",
      message: "Launch index is catching up",
      contentKey: "initial-content-error",
      requestKey: "initial-request-error",
    });
  });

  it("suppresses only the successful server response hydration request", () => {
    const initialState = createExploreInitialState(
      { ok: true, body: payload },
      {
        contentKey: "initial-content",
        requestKey: "initial-request",
        pageSize: EXPLORE_TOKENS_PER_PAGE,
      },
    );

    expect(
      handledInitialExploreRequestKey(initialState, "initial-request"),
    ).toBe("initial-request");
    expect(
      handledInitialExploreRequestKey(null, "initial-request"),
    ).toBeNull();
  });

  it("reuses the nine-token server page for the four-token mobile view", () => {
    const initialState = createResponsiveExploreInitialState(
      { ok: true, body: unvaluedMarketPayload },
      {
        reuseAvailable: true,
        isInitialRequest: true,
        contentKey: "initial-mobile-content",
        requestKey: "initial-mobile-request",
        pageSize: EXPLORE_MOBILE_TOKENS_PER_PAGE,
      },
    );

    expect(initialState?.phase).toBe("ready");
    if (initialState?.phase !== "ready") return;
    expect(initialState.payload.tokens).toHaveLength(1);
    expect(initialState.payload.tokens[0]).toMatchObject(
      unvaluedMarketPayload.tokens[0]!,
    );
    expect(initialState.payload.pageSize).toBe(EXPLORE_MOBILE_TOKENS_PER_PAGE);
    expect(initialState.payload.totalPages).toBe(1);
    expect(
      handledInitialExploreRequestKey(initialState, "initial-mobile-request"),
    ).toBe("initial-mobile-request");
  });

  it("falls through once to the bounded client read after an initial failure", () => {
    expect(createResponsiveExploreInitialState(
      { ok: false, body: { error: "Launch index is catching up" } },
      {
        reuseAvailable: true,
        isInitialRequest: true,
        contentKey: "initial-mobile-error-content",
        requestKey: "initial-mobile-error-request",
        pageSize: EXPLORE_MOBILE_TOKENS_PER_PAGE,
      },
    )).toBeNull();
  });

  it("stops reusing the server page after the first non-initial request", () => {
    const input = {
      contentKey: "initial-mobile-content",
      requestKey: "initial-mobile-request",
      pageSize: EXPLORE_MOBILE_TOKENS_PER_PAGE,
      isInitialRequest: true,
    } as const;

    expect(
      createResponsiveExploreInitialState(
        { ok: true, body: unvaluedMarketPayload },
        { ...input, reuseAvailable: false },
      ),
    ).toBeNull();
    expect(
      createResponsiveExploreInitialState(
        { ok: true, body: unvaluedMarketPayload },
        { ...input, reuseAvailable: true, isInitialRequest: false },
      ),
    ).toBeNull();
  });

  it("uses nine desktop cards and four mobile cards per page", () => {
    expect(EXPLORE_TOKENS_PER_PAGE).toBe(9);
    expect(EXPLORE_MOBILE_TOKENS_PER_PAGE).toBe(4);
    expect(exploreTokensPerPageForViewport(390)).toBe(4);
    expect(exploreTokensPerPageForViewport(700)).toBe(4);
    expect(exploreTokensPerPageForViewport(701)).toBe(9);
    expect(explorePageSizeMatchesViewport(9, 1440)).toBe(true);
    expect(explorePageSizeMatchesViewport(9, 390)).toBe(false);
    expect(explorePageSizeMatchesViewport(4, 390)).toBe(true);
    expect(getExplorePaginationItems(1, 10)).toEqual([
      1,
      2,
      3,
      "end-gap",
      10,
    ]);
    expect(getExplorePaginationItems(5, 10)).toEqual([
      1,
      "start-gap",
      5,
      "end-gap",
      10,
    ]);
    expect(getExplorePaginationItems(10, 10)).toEqual([
      1,
      "start-gap",
      8,
      9,
      10,
    ]);
  });

  it("treats only X and Telegram as social links", () => {
    const websiteOnly = { links: [{ kind: "website", url: "https://example.com" }] } satisfies Pick<
      LauncherToken,
      "links"
    >;
    const withX = { links: [{ kind: "x", url: "https://x.com/example" }] } satisfies Pick<
      LauncherToken,
      "links"
    >;

    expect(tokenHasSocialLinks(websiteOnly)).toBe(false);
    expect(tokenHasSocialLinks(withX)).toBe(true);
  });

  it("filters the loaded token page without fabricating social data", () => {
    const baseToken = {
      id: "1:test",
      name: "Test",
      symbol: "TEST",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${"33".repeat(32)}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;
    const withSocials = {
      ...baseToken,
      id: "1:social",
      links: [{ kind: "telegram" as const, url: "https://t.me/example" }],
    };

    expect(
      filterTokensBySocialPresence(
        [classicEntry(baseToken), classicEntry(withSocials)],
        "yes",
      ).map(
        (token) => token.id,
      ),
    ).toEqual(["1:social"]);
    expect(
      filterTokensBySocialPresence(
        [classicEntry(baseToken), classicEntry(withSocials)],
        "no",
      ).map(
        (token) => token.id,
      ),
    ).toEqual(["1:test"]);
  });

  it("filters the complete result set before creating nine-token pages", () => {
    const tokens = Array.from({ length: 22 }, (_, index) => classicEntry({
      id: `1:${index}`,
      name: `Token ${index}`,
      symbol: `T${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      ...(index % 2 === 0
        ? {
            links: [
              { kind: "x" as const, url: `https://x.com/token${index}` },
            ],
          }
        : {}),
    } satisfies LauncherToken));

    expect(paginateTokensBySocialPresence(tokens, "yes", 1)).toMatchObject({
      page: 1,
      pageSize: 9,
      total: 11,
      totalPages: 2,
      tokens: expect.arrayContaining([
        expect.objectContaining({ id: "1:0" }),
        expect.objectContaining({ id: "1:16" }),
      ]),
    });
    expect(
      paginateTokensBySocialPresence(tokens, "yes", 2).tokens.map(
        (token) => token.id,
      ),
    ).toEqual(["1:18", "1:20"]);
    expect(paginateTokensBySocialPresence(tokens, "no", 1)).toMatchObject({
      total: 11,
      totalPages: 2,
      tokens: expect.arrayContaining([
        expect.objectContaining({ id: "1:1" }),
        expect.objectContaining({ id: "1:17" }),
      ]),
    });
  });

  it("groups only canonical provenance and never infers type from a model or address", () => {
    expect(tokenLaunchModelGroup({ launchCategoryProvenance: classicProvenance }))
      .toBe("classic");
    expect(tokenLaunchModelGroup({ launchCategoryProvenance: customProvenance }))
      .toBe("custom-hook");
    expect(tokenLaunchModelGroup({
      launchCategoryProvenance: {
        ...classicProvenance,
        modelId: "deep",
        recordId: "custom-looking-symbol-and-address",
      },
    })).toBe("classic");
  });

  it("labels a project-only Custom launch as No market without inventing a token", () => {
    const project = customEntry(1);
    expect(getTokenCards([project])).toEqual([
      expect.objectContaining({
        id: project.id,
        launchCategory: "Custom V4 Hook",
        marketStatus: "No market",
      }),
    ]);
    expect(getTokenCards([project])[0]).not.toHaveProperty("tokenAddress");
  });

  it("combines model and social filters before nine-token pagination", () => {
    const tokens = Array.from({ length: 25 }, (_, index) => index < 20
      ? classicEntry({
      id: `1:model-${index}`,
      name: `Model ${index}`,
      symbol: `M${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-08-03T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      launchModel: "classic",
      links: [{ kind: "x" as const, url: `https://x.com/model${index}` }],
    } satisfies LauncherToken)
      : customEntry(index));

    expect(filterTokensByLaunchModel(tokens, "classic")).toHaveLength(20);
    expect(filterTokensByLaunchModel(tokens, "custom-hook")).toHaveLength(5);
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "classic", 1),
    ).toMatchObject({ page: 1, pageSize: 9, total: 20, totalPages: 3 });
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "classic", 2).tokens,
    ).toHaveLength(9);
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "classic", 3).tokens,
    ).toHaveLength(2);
    expect(
      paginateTokensByExploreFilters(tokens, "yes", "custom-hook", 1),
    ).toMatchObject({ total: 0, totalPages: 0, tokens: [] });
  });

  it("combines launch type, valuation and age ordering without clearing a selection", () => {
    const valued = (
      index: number,
      valueWad: string,
      launchedAt: string,
    ) => ({
      ...modelFilterEntry(index, "available"),
      launchedAt,
      valuation: {
        ...modelFilterEntry(index, "available").valuation,
        valueWad,
      },
    });
    const highOld = valued(1, "9000000000000000000", "2026-08-01T00:00:00.000Z");
    const highNew = valued(2, "9000000000000000000", "2026-08-04T00:00:00.000Z");
    const lowNewest = valued(3, "2000000000000000000", "2026-08-05T00:00:00.000Z");
    const unavailable = {
      ...modelFilterEntry(4, "unavailable"),
      launchedAt: "2026-08-06T00:00:00.000Z",
    };

    expect(resolveExploreServerSort("highest", "newest")).toBe("market-cap");
    expect(resolveExploreServerSort("none", "oldest")).toBe("oldest");
    expect(resolveExploreServerSort("none", "none", "trending")).toBe(
      "trending",
    );
    expect(requiresCompleteExploreDataset("highest", "newest")).toBe(false);
    expect(requiresCompleteExploreDataset("lowest", "newest")).toBe(false);
    expect(requiresCompleteExploreDataset("highest", "oldest")).toBe(true);
    expect(requiresCompleteExploreDataset("none", "oldest")).toBe(false);
    expect(requiresCompleteExploreDataset("highest", "oldest", "trending"))
      .toBe(false);
    expect(
      sortExploreEntriesBySelections(
        [lowNewest, highOld, unavailable, highNew],
        "highest",
        "newest",
      ).map((token) => token.id),
    ).toEqual([highNew.id, highOld.id, lowNewest.id, unavailable.id]);
    expect(
      paginateTokensByExploreSelections(
        [customEntry(99), lowNewest, highOld, unavailable, highNew],
        "all",
        "classic",
        "highest",
        "newest",
        1,
        2,
      ),
    ).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 4,
      totalPages: 2,
      tokens: [
        expect.objectContaining({ id: highNew.id }),
        expect.objectContaining({ id: highOld.id }),
      ],
    });
  });

  it("derives Robinhood sort choices without clearing the Ethereum selections", () => {
    expect(
      resolveExploreSortSelectionsForChain(
        1,
        "highest",
        "oldest",
        "trending",
      ),
    ).toEqual({
      valuationSort: "highest",
      ageSort: "oldest",
      discoverySort: "trending",
    });

    const robinhoodSelections = resolveExploreSortSelectionsForChain(
      4663,
      "highest",
      "oldest",
      "trending",
    );
    expect(robinhoodSelections).toEqual({
      valuationSort: "none",
      ageSort: "none",
      discoverySort: "none",
    });
    expect(resolveExploreServerSort(
      robinhoodSelections.valuationSort,
      robinhoodSelections.ageSort,
      robinhoodSelections.discoverySort,
    )).toBe("newest");
    expect(requiresCompleteExploreDataset(
      robinhoodSelections.valuationSort,
      robinhoodSelections.ageSort,
      robinhoodSelections.discoverySort,
    )).toBe(false);
    expect(
      resolveExploreSortSelectionsForChain(
        4663,
        "lowest",
        "newest",
        "trending",
      ),
    ).toEqual({
      valuationSort: "none",
      ageSort: "newest",
      discoverySort: "none",
    });
  });

  it("announces Newest as the default and market-cap ranking as an override", () => {
    expect(exploreActiveSelectionState({
      valuationSort: "highest",
      ageSort: "none",
      socialFilter: "all",
      modelFilter: "all",
    })).toEqual({
      count: 1,
      summary: "Highest market cap selected",
    });
    expect(exploreActiveSelectionState({
      valuationSort: "none",
      ageSort: "none",
      socialFilter: "all",
      modelFilter: "all",
    })).toEqual({
      count: 0,
      summary: "Default sorting applied",
    });
    expect(exploreActiveSelectionState({
      valuationSort: "none",
      ageSort: "none",
      discoverySort: "trending",
      socialFilter: "all",
      modelFilter: "all",
    })).toEqual({
      count: 1,
      summary: "Trending selected",
    });
    expect(exploreAppliedSortLabel("trending", undefined)).toBe("Trending");
  });

  it("loads every server page before model filtering and preserves server order", async () => {
    const tokens = Array.from({ length: 230 }, (_, index) => index < 145
      ? classicEntry({
      id: `1:server-model-${index}`,
      name: `Server model ${index}`,
      symbol: `SM${index}`,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
      launchedAt: "2026-08-03T00:00:00.000Z",
      totalSwapFeeBps: 100,
      liquidityPath: "meme" as const,
      launchModel: index < 145 ? ("classic" as const) : ("deep" as const),
      links: [
        { kind: "x" as const, url: `https://x.com/server-model-${index}` },
      ],
    } satisfies LauncherToken)
      : customEntry(index));
    const totalPages = Math.ceil(
      tokens.length / EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE,
    );
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        const offset = (page - 1) * pageSize;

        expect(pageSize).toBe(EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE);
        expect(url.searchParams.get("q")).toBe("server");
        expect(url.searchParams.get("sort")).toBe("newest");
        expect(url.searchParams.get("socials")).toBe("yes");

        return new Response(
          JSON.stringify({
            status: "ready",
            tokens: tokens.slice(offset, offset + pageSize),
            page,
            pageSize,
            total: tokens.length,
            totalPages,
            catalog: { ...catalogBoundary, identityCount: tokens.length },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

    const dataset = await loadExploreModelDataset(
      "complete-model-dataset",
      new URLSearchParams({
        q: "server",
        sort: "newest",
        socials: "yes",
        page: "12",
        limit: "9",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(dataset.tokens.map((token) => token.id)).toEqual(
      tokens.map((token) => token.id),
    );
    expect(
      paginateTokensByExploreFilters(
        dataset.tokens,
        "all",
        "classic",
        12,
      ),
    ).toMatchObject({
      page: 12,
      pageSize: 9,
      total: 145,
      totalPages: 17,
      tokens: tokens
        .slice(99, 108)
        .map((token) => expect.objectContaining({ id: token.id })),
    });
  });

  it("rejects same-sized model pages from a different identity commitment", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "unavailable"),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://example.test");
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("limit"));
      return new Response(JSON.stringify({
        status: "ready",
        tokens: tokens.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        total: tokens.length,
        totalPages: 2,
        catalog: {
          ...catalogBoundary,
          identityCount: tokens.length,
          identityCommitment: page === 1
            ? catalogBoundary.identityCommitment
            : `sha256:${"11".repeat(32)}`,
        },
      }), { status: 200 });
    });

    await expect(loadExploreModelDataset(
      "commitment-drift-model-dataset",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).rejects.toThrow("Tokens changed while filters were loading");
  });

  it("pins model pages and restarts the whole dataset after a ranking 409", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "unavailable"),
    );
    const firstCommitment = `sha256:${"64".repeat(32)}` as const;
    const recoveredCommitment = `sha256:${"65".repeat(32)}` as const;
    let request = 0;
    const requestedPins: Array<string | null> = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        request += 1;
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        requestedPins.push(url.searchParams.get("rankingCommitment"));
        const commitment = request <= 2 ? firstCommitment : recoveredCommitment;
        if (request === 2) {
          return new Response(
            JSON.stringify({
              error: "Market-cap ranking changed; restart from page 1",
            }),
            { status: 409 },
          );
        }
        return new Response(
          JSON.stringify({
            status: "ready",
            tokens: tokens.slice((page - 1) * pageSize, page * pageSize),
            page,
            pageSize,
            total: tokens.length,
            totalPages: 2,
            catalog: { ...catalogBoundary, identityCount: tokens.length },
            dataQuality: modelPageDataQuality(
              0,
              tokens.slice((page - 1) * pageSize, page * pageSize).length,
            ),
            marketRead: unavailableGmgnMarketRead(tokens.length),
            ranking: unavailableMarketCapRanking(tokens.length, commitment),
          }),
          {
            status: 200,
            headers: { "X-Programmable-Market-Read-Status": "unavailable" },
          },
        );
      });

    await expect(
      loadExploreModelDataset(
        "ranking-restart-model-dataset",
        new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
      ),
    ).resolves.toMatchObject({
      total: tokens.length,
      tokens: tokens.map((token) => expect.objectContaining({ id: token.id })),
      ranking: { rankingCommitment: recoveredCommitment },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestedPins).toEqual([
      null,
      firstCommitment,
      null,
      recoveredCommitment,
    ]);
  });

  it("rejects model pages from different provider-order commitments", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "unavailable"),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        const pageTokens = tokens.slice(
          (page - 1) * pageSize,
          page * pageSize,
        );
        return new Response(JSON.stringify({
          status: "ready",
          tokens: pageTokens,
          page,
          pageSize,
          total: tokens.length,
          totalPages: 2,
          catalog: { ...catalogBoundary, identityCount: tokens.length },
          dataQuality: modelPageDataQuality(0, pageTokens.length),
          marketRead: {
            provider: "bitquery",
            status: "unavailable",
            category: "transport",
            phase: "market-core",
          },
          ranking: unavailableMarketCapRanking(
            tokens.length,
            page === 1
              ? `sha256:${"50".repeat(32)}`
              : `sha256:${"51".repeat(32)}`,
          ),
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Programmable-Market-Read-Status": "transport-unavailable",
          },
        });
      },
    );

    await expect(loadExploreModelDataset(
      "provider-order-commitment-drift-model-dataset",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("Tokens changed while filters were loading");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("retries once when the launch identity changes between model pages", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "unavailable"),
    );
    let fetchCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        fetchCount += 1;
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        const firstAttempt = fetchCount <= 2;
        return new Response(JSON.stringify({
          status: "ready",
          tokens: tokens.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: tokens.length,
          totalPages: 2,
          catalog: {
            ...catalogBoundary,
            identityCount: tokens.length,
            identityCommitment: firstAttempt && page === 2
              ? `sha256:${"11".repeat(32)}`
              : catalogBoundary.identityCommitment,
          },
        }), { status: 200 });
      },
    );

    await expect(loadExploreModelDataset(
      "transient-commitment-drift-model-dataset",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).resolves.toMatchObject({ total: tokens.length, totalPages: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("accepts index progress advancing between pages when identity stays exact", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "unavailable"),
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "https://example.test");
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("limit"));
      const asOfBlock = page === 1 ? "25740000" : "25740001";
      return new Response(JSON.stringify({
        status: "ready",
        tokens: tokens.slice((page - 1) * pageSize, page * pageSize),
        page,
        pageSize,
        total: tokens.length,
        totalPages: 2,
        catalog: {
          ...catalogBoundary,
          lastIndexedAt: page === 1
            ? "2026-08-14T00:00:00.000Z"
            : "2026-08-14T00:00:12.000Z",
          asOfBlock,
          asOfBlockHash: page === 1
            ? catalogBoundary.asOfBlockHash
            : `0x${"bc".repeat(32)}`,
          identityCount: tokens.length,
          evidence: {
            ...catalogBoundary.evidence,
            progressBlock: asOfBlock,
            commitment: page === 1
              ? catalogBoundary.evidence.commitment
              : `sha256:${"ef".repeat(32)}`,
          },
        },
      }), { status: 200 });
    });

    await expect(loadExploreModelDataset(
      "progress-only-drift-model-dataset",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).resolves.toMatchObject({ total: tokens.length, totalPages: 2 });
  });

  it("accepts Router cursor progress when the public identity stays exact", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "unavailable"),
    );
    const routerCatalogBoundary = {
      ...catalogBoundary,
      launchSource:
        "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router" as const,
      completeness: {
        ...catalogBoundary.completeness,
        registryCustom: "current" as const,
        routerCustom: "current" as const,
      },
      scope: {
        ...catalogBoundary.scope,
        included: [
          ...catalogBoundary.scope.included,
          "canonical-launch-stamp-router",
        ] as const,
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        return new Response(JSON.stringify({
          status: "ready",
          tokens: tokens.slice((page - 1) * pageSize, page * pageSize),
          page,
          pageSize,
          total: tokens.length,
          totalPages: 2,
          catalog: {
            ...routerCatalogBoundary,
            identityCount: tokens.length,
            routerStamp: {
              source: "canonical-launch-stamp-router",
              status: "current",
              finalityConfirmations: 64,
              verifiedIdentityCount: page === 1 ? 4 : 5,
              projectedIdentityCount: 1,
              generatedAt: page === 1
                ? "2026-08-14T00:00:00.000Z"
                : "2026-08-14T00:00:12.000Z",
              asOfBlock: page === 1 ? "25739998" : "25739999",
              asOfBlockHash: page === 1
                ? `0x${"12".repeat(32)}`
                : `0x${"34".repeat(32)}`,
              identityCommitment: page === 1
                ? `sha256:${"56".repeat(32)}`
                : `sha256:${"78".repeat(32)}`,
            },
          },
        }), { status: 200 });
      },
    );

    await expect(loadExploreModelDataset(
      "router-progress-only-drift-model-dataset",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).resolves.toMatchObject({ total: tokens.length, totalPages: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves an all-page transport marker and does not cache the degraded model dataset", async () => {
    const tokens = [
      ...Array.from(
        { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE },
        (_, index) => modelFilterEntry(index, "available"),
      ),
      {
        ...customEntry(900),
        fdvUsdWad: "1000000000000000000",
        marketData: modelCompatibilityMarketData(),
        liquidityEvidence: { compatibility: true },
        valuation: {
          status: "available" as const,
          metric: "fdv" as const,
          supplyBasis: "total" as const,
          currency: "usd" as const,
          valueWad: "1000000000000000000",
          freshness: "current" as const,
          source: "bitquery" as const,
        },
      },
    ];
    const totalPages = 2;
    const degradedResponse = (
      input: string | URL | Request,
      phase: "market-core" | "market-price",
    ) => {
      const url = new URL(String(input), "https://example.test");
      const page = Number(url.searchParams.get("page"));
      const pageSize = Number(url.searchParams.get("limit"));
      const pageTokens = tokens.slice((page - 1) * pageSize, page * pageSize)
        .map((entry) => ({
          ...entry,
          valuation: {
            status: "unavailable" as const,
            reason: "source-unavailable" as const,
          },
        }));
      return new Response(JSON.stringify({
        status: "ready",
        tokens: pageTokens,
        page,
        pageSize,
        total: tokens.length,
        totalPages,
        catalog: { ...catalogBoundary, identityCount: tokens.length },
        dataQuality: modelPageDataQuality(0, pageTokens.length),
        marketRead: {
          provider: "bitquery",
          status: "unavailable",
          category: "transport",
          phase,
        },
        ranking: unavailableMarketCapRanking(
          tokens.length,
          `sha256:${"66".repeat(32)}`,
        ),
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "transport-unavailable",
        },
      });
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => degradedResponse(input, "market-core"),
    );
    const search = new URLSearchParams({
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    const dataset = await loadExploreModelDataset(
      "all-degraded-model-dataset",
      search,
    );
    const filtered = paginateExploreModelDataset(dataset, "classic", 1);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(dataset).toMatchObject({
      marketRead: { status: "unavailable", phase: "market-core" },
      ranking: { status: "unavailable", applied: "launch-order" },
      dataQuality: {
        status: "partial",
        valuation: {
          status: "unavailable",
          available: 0,
          unavailable: tokens.length,
        },
      },
    });
    expect(filtered).toMatchObject({
      marketRead: { status: "unavailable" },
      dataQuality: {
        status: "partial",
        valuation: { status: "unavailable", available: 0, unavailable: 9 },
      },
    });
    expect(filtered.ranking).toBeUndefined();
    expect(dataset.tokens.every((entry) =>
      entry.valuation.status === "unavailable" &&
      !("fdvUsdWad" in entry) &&
      !("marketData" in entry) &&
      !("liquidityEvidence" in entry)
    )).toBe(true);
    expect(dataset.tokens.at(-1)?.valuation).toEqual({
      status: "unavailable",
      reason: "no-market",
    });

    await loadExploreModelDataset("all-degraded-model-dataset", search);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockImplementation(async (input) => {
      const page = new URL(String(input), "https://example.test")
        .searchParams.get("page");
      return degradedResponse(
        input,
        page === "1" ? "market-core" : "market-price",
      );
    });
    await expect(loadExploreModelDataset(
      "inconsistent-degraded-model-dataset",
      search,
    )).rejects.toThrow("Tokens changed while filters were loading");
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("rejects a mixed current and transport-unavailable model dataset", async () => {
    const tokens = Array.from(
      { length: EXPLORE_MODEL_FILTER_SERVER_PAGE_SIZE + 1 },
      (_, index) => modelFilterEntry(index, "available"),
    );
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        const pageSize = Number(url.searchParams.get("limit"));
        const pageTokens = tokens.slice((page - 1) * pageSize, page * pageSize);
        const degraded = page === 2;
        const visibleTokens = degraded
          ? pageTokens.map((entry) => ({
              ...entry,
              valuation: {
                status: "unavailable" as const,
                reason: "source-unavailable" as const,
              },
            }))
          : pageTokens;
        return new Response(JSON.stringify({
          status: "ready",
          tokens: visibleTokens,
          page,
          pageSize,
          total: tokens.length,
          totalPages: 2,
          catalog: { ...catalogBoundary, identityCount: tokens.length },
          dataQuality: modelPageDataQuality(
            degraded ? 0 : visibleTokens.length,
            degraded ? visibleTokens.length : 0,
          ),
          ...(degraded
            ? {
                marketRead: {
                  provider: "bitquery",
                  status: "unavailable",
                  category: "transport",
                  phase: "market-price",
                },
                ranking: unavailableMarketCapRanking(
                  tokens.length,
                  `sha256:${"67".repeat(32)}`,
                ),
              }
            : {
                marketRead: {
                  provider: "dexscreener",
                  status: "complete",
                  currency: "USD",
                  requestedCount: tokens.length,
                  observedCount: tokens.length,
                  qualifiedCount: tokens.length,
                  unavailableCount: 0,
                  oldestFetchedAt: "2026-08-16T08:00:00.000Z",
                  newestFetchedAt: "2026-08-16T08:00:00.000Z",
                },
                ranking: unavailableMarketCapRanking(
                  tokens.length,
                  `sha256:${"67".repeat(32)}`,
                ),
              }),
        }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Programmable-Market-Read-Status": degraded
              ? "transport-unavailable"
              : "complete",
          },
        });
      },
    );

    await expect(loadExploreModelDataset(
      "mixed-model-dataset",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("Tokens changed while filters were loading");

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(["highest-market-cap", "lowest-market-cap"])(
    "requests a direct second %s page without continuation fields",
    async (sort) => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
        async (input) => {
          const url = new URL(String(input), "https://example.test");
          expect(url.searchParams.get("sort")).toBe(sort);
          expect(url.searchParams.get("page")).toBe("2");
          expect([...url.searchParams.keys()]).toEqual([
            "sort",
            "page",
            "limit",
          ]);
          return new Response(JSON.stringify({
            ...payload,
            page: 2,
          }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      );

      await expect(loadExplorePage(
        `direct-${sort}-page-two`,
        new URLSearchParams({ sort, page: "2", limit: "9" }),
      )).resolves.toMatchObject({ page: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["market-cap", "market-cap-asc"] as const)(
    "pins a direct second %s page to the first-page ranking commitment",
    async (sort) => {
      const commitment = `sha256:${"61".repeat(32)}` as const;
      const fetchMock = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input) => {
          const url = new URL(String(input), "https://example.test");
          const page = Number(url.searchParams.get("page"));
          expect(url.searchParams.get("sort")).toBe(sort);
          expect(url.searchParams.get("rankingCommitment")).toBe(
            page === 1 ? null : commitment,
          );
          return new Response(
            JSON.stringify({
              ...payload,
              page,
              dataQuality: modelPageDataQuality(0, 0),
              ranking: {
                ...unavailableMarketCapRanking(payload.total, commitment),
                direction: sort === "market-cap" ? "desc" : "asc",
              },
              marketRead: unavailableGmgnMarketRead(payload.total),
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "X-Programmable-Market-Read-Status": "unavailable",
              },
            },
          );
        });

      await expect(
        loadExplorePage(
          `pinned-direct-${sort}-page-two`,
          new URLSearchParams({ sort, page: "2", limit: "9" }),
        ),
      ).resolves.toMatchObject({ page: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("keeps one first-page market-cap commitment across page navigation", async () => {
    const commitment = `sha256:${"69".repeat(32)}` as const;
    const requestedPins: Array<string | null> = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = new URL(String(input), "https://example.test");
        const page = Number(url.searchParams.get("page"));
        requestedPins.push(url.searchParams.get("rankingCommitment"));
        return new Response(JSON.stringify({
          ...payload,
          page,
          total: 27,
          totalPages: 3,
          dataQuality: modelPageDataQuality(0, 0),
          marketRead: {
            provider: "dexscreener",
            status: "complete",
            currency: "USD",
            requestedCount: 27,
            observedCount: 0,
            qualifiedCount: 0,
            unavailableCount: 27,
            oldestFetchedAt: null,
            newestFetchedAt: null,
          },
          ranking: unavailableMarketCapRanking(27, commitment),
        }), {
          status: 200,
          headers: { "X-Programmable-Market-Read-Status": "complete" },
        });
      },
    );

    await loadExplorePage(
      "market-cap-session-page-one",
      new URLSearchParams({
        q: "session-ranking",
        sort: "market-cap",
        page: "1",
        limit: "9",
      }),
    );
    await loadExplorePage(
      "market-cap-session-page-two",
      new URLSearchParams({
        q: "session-ranking",
        sort: "market-cap",
        page: "2",
        limit: "9",
      }),
    );
    await loadExplorePage(
      "market-cap-session-page-three",
      new URLSearchParams({
        q: "session-ranking",
        sort: "market-cap",
        page: "3",
        limit: "9",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestedPins).toEqual([null, commitment, commitment]);
  });

  it("restarts direct market-cap pagination once after a 409", async () => {
    const firstCommitment = `sha256:${"62".repeat(32)}` as const;
    const recoveredCommitment = `sha256:${"63".repeat(32)}` as const;
    let request = 0;
    const requestedUrls: URL[] = [];
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        request += 1;
        const url = new URL(String(input), "https://example.test");
        requestedUrls.push(url);
        const page = Number(url.searchParams.get("page"));
        const commitment = request <= 2 ? firstCommitment : recoveredCommitment;
        if (request === 2) {
          return new Response(
            JSON.stringify({
              error: "Market-cap ranking changed; restart from page 1",
            }),
            { status: 409 },
          );
        }
        return new Response(
          JSON.stringify({
            ...payload,
            page,
            dataQuality: modelPageDataQuality(0, 0),
            marketRead: unavailableGmgnMarketRead(payload.total),
            ranking: unavailableMarketCapRanking(payload.total, commitment),
          }),
          {
            status: 200,
            headers: { "X-Programmable-Market-Read-Status": "unavailable" },
          },
        );
      });

    await expect(
      loadExplorePage(
        "restart-direct-market-cap-page-two",
        new URLSearchParams({
          q: "restart-ranking",
          sort: "market-cap",
          page: "2",
          limit: "9",
        }),
      ),
    ).resolves.toMatchObject({
      page: 2,
      ranking: { rankingCommitment: recoveredCommitment },
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(
      requestedUrls.map((url) => ({
        page: url.searchParams.get("page"),
        rankingCommitment: url.searchParams.get("rankingCommitment"),
      })),
    ).toEqual([
      { page: "1", rankingCommitment: null },
      { page: "2", rankingCommitment: firstCommitment },
      { page: "1", rankingCommitment: null },
      { page: "2", rankingCommitment: recoveredCommitment },
    ]);
  });

  it("purges a separately cached page-one pin before a 409 restart", async () => {
    const staleCommitment = `sha256:${"64".repeat(32)}` as const;
    const recoveredCommitment = `sha256:${"65".repeat(32)}` as const;
    const requestedUrls: URL[] = [];
    let request = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        request += 1;
        const url = new URL(String(input), "https://example.test");
        requestedUrls.push(url);
        const page = Number(url.searchParams.get("page"));
        if (request === 2) {
          return new Response(JSON.stringify({
            error: "Market-cap ranking changed; restart from page 1",
          }), { status: 409 });
        }
        const commitment = request === 1
          ? staleCommitment
          : recoveredCommitment;
        return new Response(JSON.stringify({
          ...payload,
          page,
          dataQuality: modelPageDataQuality(0, 0),
          marketRead: {
            provider: "dexscreener",
            status: "complete",
            currency: "USD",
            requestedCount: payload.total,
            observedCount: 0,
            qualifiedCount: 0,
            unavailableCount: payload.total,
            oldestFetchedAt: null,
            newestFetchedAt: null,
          },
          ranking: unavailableMarketCapRanking(payload.total, commitment),
        }), {
          status: 200,
          headers: { "X-Programmable-Market-Read-Status": "complete" },
        });
      },
    );
    const search = {
      q: "seeded-restart-ranking",
      sort: "market-cap",
      limit: "9",
    } as const;

    await loadExplorePage(
      "seeded-restart-market-cap-page-one",
      new URLSearchParams({ ...search, page: "1" }),
    );
    await expect(loadExplorePage(
      "seeded-restart-market-cap-page-two",
      new URLSearchParams({ ...search, page: "2" }),
    )).resolves.toMatchObject({
      page: 2,
      ranking: { rankingCommitment: recoveredCommitment },
    });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(requestedUrls.map((url) => ({
      page: url.searchParams.get("page"),
      rankingCommitment: url.searchParams.get("rankingCommitment"),
    }))).toEqual([
      { page: "1", rankingCommitment: null },
      { page: "2", rankingCommitment: staleCommitment },
      { page: "1", rankingCommitment: null },
      { page: "2", rankingCommitment: recoveredCommitment },
    ]);
  });

  it("presents total-supply valuation using the public market cap label", () => {
    const token = {
      id: "1:test",
      name: "Test",
      symbol: "TEST",
      tokenAddress: "0x1111111111111111111111111111111111111111",
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${"33".repeat(32)}`,
      launchedAt: "2026-07-29T00:00:00.000Z",
      fdvUsdWad: "100000000000000000000",
      indexedMarketCapUsdWad: "125000000000000000000",
      totalSupplyRaw: "1000000000000000000000000000",
      tokenDecimals: 18,
      activeLiquidity: "1",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
    } satisfies LauncherToken;

    const entry = {
      ...classicEntry(token),
      valuation: {
        status: "available" as const,
        metric: "fdv" as const,
        supplyBasis: "total" as const,
        currency: "usd" as const,
        valueWad: "125000000000000000000",
        freshness: "current" as const,
        asOfBlock: "25730000",
        lagBlocks: "0",
      },
    };

    expect(getExploreValuationMetric(entry)).toEqual({
      kind: "usd",
      value: 125,
    });
    expect(getTokenCards([entry])[0]?.valuationMetric).toBe(
      "Fully diluted valuation",
    );
  });

  it("explains missing FDV without inventing a value", () => {
    expect(exploreUnavailableFdvLabel("Waiting for first trade")).toBe(
      "Waiting for first trade",
    );
    expect(exploreUnavailableFdvLabel("No market")).toBe("No market yet");
    expect(exploreUnavailableFdvLabel("Unavailable")).toBe(
      "",
    );
    expect(exploreUnavailableFdvLabel(undefined)).toBe("");
  });

  it("labels bounded offchain FDV as provider recent, never onchain current", () => {
    const entry = {
      ...bitqueryMarketEntry,
      valuation: {
        status: "available" as const,
        metric: "fdv" as const,
        supplyBasis: "total" as const,
        currency: "usd" as const,
        valueWad: "125000000000000000000",
        freshness: "provider-recent" as const,
        source: "dexscreener" as const,
        asOfTime: "2026-08-16T08:00:00.000Z",
      },
    };
    expect(getExploreValuationMetric(entry)).toEqual({ kind: "usd", value: 125 });
    expect(exploreMarketStatusLabel(entry)).toBe("Provider recent");
    expect(getTokenCards([entry])[0]?.valuationProvider).toBe("Dexscreener");
    expect(getTokenCards([{
      ...entry,
      valuation: { ...entry.valuation, source: "gmgn" as const },
    }])[0]?.valuationProvider).toBe("GMGN");
  });

  it("keeps the last valid page when a background refresh fails", () => {
    expect(
      preserveExplorePayloadOnRefreshFailure(
        {
          phase: "ready",
          payload,
          contentKey: "same-content",
          requestKey: "previous-request",
        },
        {
          contentKey: "same-content",
          requestKey: "refresh-request",
          message: "RPC unavailable",
        },
      ),
    ).toEqual({
      phase: "ready",
      payload,
      contentKey: "same-content",
      requestKey: "refresh-request",
    });
  });

  it("does not show stale cards for a different query or page", () => {
    expect(
      preserveExplorePayloadOnRefreshFailure(
        {
          phase: "ready",
          payload,
          contentKey: "old-query",
          requestKey: "old-request",
        },
        {
          contentKey: "new-query",
          requestKey: "new-request",
          message: "RPC unavailable",
        },
      ),
    ).toEqual({
      phase: "error",
      contentKey: "new-query",
      requestKey: "new-request",
      message: "RPC unavailable",
    });
  });

  it("shares one in-flight request for repeated refreshes of the same content", async () => {
    const marketPayload = payload;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(marketPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const search = new URLSearchParams({
      q: "",
      sort: "newest",
      page: "1",
      limit: "9",
    });

    const first = loadExplorePayload("same-content-dedupe", search);
    const second = loadExplorePayload("same-content-dedupe", search);

    expect(second).toBe(first);
    await expect(first).resolves.toEqual(marketPayload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["market-cap", "market-cap-asc"])(
    "retries a valid zero-valuation %s response and returns the valued retry",
    async (sort) => {
      const first = new Response(JSON.stringify(unvaluedMarketPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      const firstJson = vi.spyOn(first, "json");
      const fetchMock = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(new Response(
          JSON.stringify(valuedMarketPayload),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ));

      const result = await loadExplorePayload(
        `${sort}-zero-then-valued`,
        new URLSearchParams({ sort, page: "1", limit: "9" }),
      );

      expect(result.tokens[0]?.valuation).toMatchObject({
        status: "available",
        metric: "fdv",
        freshness: "current",
        source: "bitquery",
      });
      expect(firstJson).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
    },
  );

  it("returns a marked transport-unavailable page without retrying or caching it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(transportUnavailableMarketPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "transport-unavailable",
        },
      }),
    );
    const search = new URLSearchParams({
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    await expect(loadExplorePayload(
      "marked-market-transport-unavailable",
      search,
    )).resolves.toMatchObject({
      marketRead: {
        provider: "bitquery",
        status: "unavailable",
        category: "transport",
        phase: "market-core",
      },
      ranking: {
        status: "unavailable",
        requested: "fdv",
        applied: "launch-order",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(loadExplorePayload(
      "marked-market-transport-unavailable",
      search,
    )).resolves.toMatchObject({
      marketRead: { status: "unavailable" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns an honest HTTP 402 response-unavailable page without retrying or caching it", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify(responseUnavailableMarketPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "response-unavailable",
        },
      }),
    );
    const search = new URLSearchParams({
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    const result = await loadExplorePayload(
      "marked-market-http-402-response-unavailable",
      search,
    );

    expect(result).toMatchObject({
      marketRead: {
        provider: "bitquery",
        status: "unavailable",
        category: "response",
        phase: "market-core",
        reason: "http-status",
        httpStatus: 402,
      },
      ranking: {
        status: "unavailable",
        requested: "fdv",
        applied: "launch-order",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getTokenCards(result.tokens)).toEqual([
      expect.objectContaining({
        valuation: undefined,
        marketStatus: "Unavailable",
      }),
    ]);

    await expect(loadExplorePayload(
      "marked-market-http-402-response-unavailable",
      search,
    )).resolves.toMatchObject({
      marketRead: {
        status: "unavailable",
        category: "response",
        reason: "http-status",
        httpStatus: 402,
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects an HTTP 402 marker without its exact response-unavailable header", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(responseUnavailableMarketPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "transport-unavailable",
        },
      }),
    );

    await expect(loadExplorePayload(
      "mismatched-market-http-402-response-unavailable",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("inconsistent market read data");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries the first non-USD FDV and returns the second fail-closed", async () => {
    const secondPayload = { ...wrongCurrencyMarketPayload, total: 2 };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify(wrongCurrencyMarketPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify(secondPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ));

    await expect(loadExplorePayload(
      "market-cap-wrong-currency",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).resolves.toMatchObject({
      total: 2,
      tokens: [expect.objectContaining({
        valuation: expect.objectContaining({ currency: "eth" }),
      })],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns the second valid zero-valuation response without a third attempt", async () => {
    const secondPayload = { ...unvaluedMarketPayload, total: 2 };
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify(unvaluedMarketPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ))
      .mockResolvedValueOnce(new Response(JSON.stringify(secondPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    await expect(loadExplorePayload(
      "market-cap-zero-twice",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).resolves.toMatchObject({ total: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a valid zero-valuation response for Newest", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify(unvaluedMarketPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify(valuedMarketPayload),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ));

    await expect(loadExplorePayload(
      "newest-zero-no-retry",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).resolves.toMatchObject({
      tokens: [expect.objectContaining({
        valuation: { status: "unavailable", reason: "source-unavailable" },
      })],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries the identical Explore request once after a 503", async () => {
    const first = new Response(JSON.stringify({
      status: "ready",
      tokens: [{ forged: "must-not-be-parsed" }],
    }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
    const firstJson = vi.spyOn(first, "json");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(new Response(JSON.stringify(unvaluedMarketPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    const search = new URLSearchParams({
      q: "",
      sort: "market-cap",
      page: "1",
      limit: "9",
    });

    const request = loadExplorePayload("bitquery-one-retry", search);
    expect(loadExplorePayload("bitquery-one-retry", search)).toBe(request);
    await expect(request).resolves.toMatchObject({
      tokens: [expect.objectContaining({
        valuation: { status: "unavailable", reason: "source-unavailable" },
      })],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { Accept: "application/json" },
    });
    expect(fetchMock.mock.calls[1]?.[1]?.signal).not.toBe(
      fetchMock.mock.calls[0]?.[1]?.signal,
    );
    expect(firstJson).not.toHaveBeenCalled();
  });

  it.each(["newest", "oldest", "market-cap", "market-cap-asc"])(
    "stops after one automatic 503 retry for the %s sort",
    async (sort) => {
      const first = new Response("not launch data", { status: 503 });
      const firstJson = vi.spyOn(first, "json");
      const fetchMock = vi.spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(new Response(JSON.stringify({
          status: "unavailable",
          error: "Launch data is temporarily unavailable",
          retryable: true,
        }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }));

      await expect(loadExplorePayload(
        `${sort}-one-retry-terminal`,
        new URLSearchParams({ sort, page: "1", limit: "9" }),
      )).rejects.toThrow("Launch data is temporarily unavailable");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(fetchMock.mock.calls[0]?.[0]);
      expect(firstJson).not.toHaveBeenCalled();
    },
  );

  it("does not retry a non-503 response", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Invalid Explore request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(loadExplorePayload(
      "non-503-no-retry",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    )).rejects.toThrow("Invalid Explore request");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives a late 503 retry its own full twelve-second deadline", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => {
        calls += 1;
        if (calls === 1) {
          return await new Promise<Response>((resolve) => {
            globalThis.setTimeout(
              () => resolve(new Response("ignored", { status: 503 })),
              11_000,
            );
          });
        }
        return await new Promise<Response>((resolve) => {
          globalThis.setTimeout(() => resolve(new Response(
            JSON.stringify(payload),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          )), 6_000);
        });
      },
    );
    const request = loadExplorePayload(
      "late-503-fresh-attempt-deadline",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );

    await vi.advanceTimersByTimeAsync(11_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(request).resolves.toEqual(payload);
  });

  it("does not retry an aborted 503 request", async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    let oldAttemptSignal: AbortSignal | undefined;
    const requests: string[] = [];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url.includes("page=1")) {
          oldAttemptSignal = init?.signal ?? undefined;
          return await new Promise<Response>((resolve) => {
            resolveOld = resolve;
          });
        }
        return new Response(JSON.stringify({
          ...valuedMarketPayload,
          page: 2,
          total: 18,
          totalPages: 2,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const first = loadExplorePayload(
      "aborted-503-no-retry",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );
    await vi.waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    const current = loadExplorePayload(
      "aborted-503-no-retry",
      new URLSearchParams({ sort: "market-cap", page: "2", limit: "9" }),
    );
    resolveOld?.(new Response("ignored", { status: 503 }));

    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(current).resolves.toMatchObject({ page: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requests.filter((url) => url.includes("page=1"))).toHaveLength(1);
    expect(oldAttemptSignal?.aborted).toBe(true);
  });

  it("never caches a successful response from an aborted stale request", async () => {
    let resolveOld: ((response: Response) => void) | undefined;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = String(input);
        if (url.includes("page=1")) {
          return await new Promise<Response>((resolve) => {
            resolveOld = resolve;
          });
        }
        return new Response(JSON.stringify({ ...payload, page: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const first = loadExplorePayload(
      "aborted-success-no-stale-cache",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    );
    await vi.waitFor(() => expect(resolveOld).toBeTypeOf("function"));
    const currentSearch = new URLSearchParams({
      sort: "newest",
      page: "2",
      limit: "9",
    });
    const current = loadExplorePayload(
      "aborted-success-no-stale-cache",
      currentSearch,
    );
    await expect(current).resolves.toMatchObject({ page: 2 });
    resolveOld?.(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(loadExplorePayload(
      "aborted-success-no-stale-cache",
      currentSearch,
    )).resolves.toMatchObject({ page: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache an empty-FDV response when its retry is aborted as stale", async () => {
    let resolveOldRetry: ((response: Response) => void) | undefined;
    let oldRetrySignal: AbortSignal | undefined;
    let pageOneCalls = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input, init) => {
        const url = new URL(String(input), "https://example.test");
        if (url.searchParams.get("page") === "1") {
          pageOneCalls += 1;
          if (pageOneCalls === 1) {
            return new Response(JSON.stringify(unvaluedMarketPayload), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          oldRetrySignal = init?.signal ?? undefined;
          return await new Promise<Response>((resolve) => {
            resolveOldRetry = resolve;
          });
        }
        return new Response(JSON.stringify({
          ...valuedMarketPayload,
          page: 2,
          total: 18,
          totalPages: 2,
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );
    const oldRequest = loadExplorePayload(
      "aborted-empty-fdv-no-stale-cache",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const currentSearch = new URLSearchParams({
      sort: "market-cap",
      page: "2",
      limit: "9",
    });
    const currentRequest = loadExplorePayload(
      "aborted-empty-fdv-no-stale-cache",
      currentSearch,
    );
    resolveOldRetry?.(new Response(JSON.stringify(valuedMarketPayload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(oldRequest).rejects.toMatchObject({ name: "AbortError" });
    await expect(currentRequest).resolves.toMatchObject({ page: 2 });
    await expect(loadExplorePayload(
      "aborted-empty-fdv-no-stale-cache",
      currentSearch,
    )).resolves.toMatchObject({ page: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(oldRetrySignal?.aborted).toBe(true);
  });

  it("rejects Router provenance on a custom project without a complete stamp", async () => {
    const project = customEntry(91);
    const forged = {
      ...project,
      launchCategoryProvenance: {
        schemaVersion: "programmable.explore-launch-category-provenance.v1",
        category: "custom",
        source: "canonical-launch-stamp-router",
        launchId: `0x${"11".repeat(32)}`,
        stampHash: `0x${"22".repeat(32)}`,
        routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
        transactionHash: `0x${"33".repeat(32)}`,
        blockHash: `0x${"44".repeat(32)}`,
        blockNumber: "25717612",
        transactionIndex: 1,
        logIndex: 2,
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...payload,
        tokens: [forged],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(loadExplorePayload(
      "forged-custom-project-router-source",
      new URLSearchParams(),
    )).rejects.toThrow("invalid token record");
  });

  it("parses a qualified Dexscreener market response without a browser retry", async () => {
    const dexPayload = {
      ...valuedMarketPayload,
      tokens: valuedMarketPayload.tokens.map((token) => ({
        ...token,
        valuation: {
          ...token.valuation,
          source: "dexscreener" as const,
          freshness: "provider-recent" as const,
          asOfTime: "2026-08-16T08:00:00.000Z",
        },
      })),
      dataQuality: {
        ...unavailableMarketDataQuality,
        valuation: {
          ...unavailableMarketDataQuality.valuation,
          status: "provider-recent" as const,
          available: 1,
          unavailable: 0,
          asOfTime: "2026-08-16T08:00:00.000Z",
        },
      },
      marketRead: {
        provider: "dexscreener",
        status: "complete",
        currency: "USD",
        requestedCount: 1,
        observedCount: 1,
        qualifiedCount: 1,
        unavailableCount: 0,
        oldestFetchedAt: "2026-08-16T08:00:00.000Z",
        newestFetchedAt: "2026-08-16T08:00:00.000Z",
      },
      ranking: {
        status: "complete",
        requested: "fdv",
        applied: "fdv",
        qualifiedCount: 1,
        totalCount: 1,
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(dexPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "complete",
        },
      }),
    );
    const result = await loadExplorePayload(
      "dexscreener-qualified",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.valuation).toMatchObject({
      status: "available",
      source: "dexscreener",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(exploreAppliedSortLabel("market-cap", result.ranking)).toBe(
      "Highest valuation",
    );
  });

  it("accepts an observed but unqualified Dexscreener fallback in a GMGN read", async () => {
    const gmgnPayload = {
      ...unvaluedMarketPayload,
      dataQuality: unavailableMarketDataQuality,
      marketRead: {
        provider: "gmgn",
        fallbackProvider: "dexscreener",
        status: "complete",
        currency: "USD",
        requestedCount: 1,
        observedCount: 1,
        qualifiedCount: 0,
        unavailableCount: 1,
        gmgnObservedCount: 0,
        gmgnQualifiedCount: 0,
        fallbackRequestedCount: 1,
        fallbackObservedCount: 1,
        fallbackQualifiedCount: 0,
        oldestFetchedAt: "2026-08-16T08:00:00.000Z",
        newestFetchedAt: "2026-08-16T08:00:00.000Z",
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(gmgnPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "complete",
        },
      }),
    );

    const result = await loadExplorePayload(
      "gmgn-unqualified-dex-observation",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    );

    expect(result.marketRead).toMatchObject({
      provider: "gmgn",
      observedCount: 1,
      qualifiedCount: 0,
      fallbackObservedCount: 1,
      fallbackQualifiedCount: 0,
    });
  });

  it("retains all 351 identities for a complete sparse 20-pair Dexscreener read", async () => {
    const allTokens = Array.from({ length: 351 }, (_, offset) => {
      const index = offset + 1;
      const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
      const entry = classicEntry({
        id: `1:${tokenAddress}`,
        name: `Sparse ${index}`,
        symbol: `S${index}`,
        tokenAddress,
        hookAddress: "0x2222222222222222222222222222222222222222",
        poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
        launchedAt: new Date(Date.parse("2026-08-01T00:00:00.000Z") + index)
          .toISOString(),
        totalSwapFeeBps: 100,
        liquidityPath: "meme",
      });
      return {
        ...entry,
        valuation: offset < 18
          ? {
              status: "available" as const,
              metric: "fdv" as const,
              supplyBasis: "total" as const,
              currency: "usd" as const,
              valueWad: ((351n - BigInt(offset)) * 10n ** 18n).toString(),
              freshness: "provider-recent" as const,
              source: "dexscreener" as const,
              asOfTime: "2026-08-16T08:00:00.000Z",
            }
          : { status: "unavailable" as const, reason: "source-unavailable" as const },
      };
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async (input) => {
        const url = new URL(String(input), "http://localhost");
        const page = Number(url.searchParams.get("page") ?? "1");
        const pageSize = Number(url.searchParams.get("limit") ?? "100");
        const tokens = allTokens.slice((page - 1) * pageSize, page * pageSize);
        const available = tokens.filter((token) =>
          token.valuation.status === "available"
        ).length;
        return new Response(JSON.stringify({
          status: "ready",
          tokens,
          page,
          pageSize,
          total: 351,
          totalPages: Math.ceil(351 / pageSize),
          catalog: {
            ...catalogBoundary,
            identityCount: 351,
          },
          dataQuality: {
            ...unavailableMarketDataQuality,
            valuation: {
              ...unavailableMarketDataQuality.valuation,
              status: available > 0 ? "partial" : "unavailable",
              available,
              unavailable: tokens.length - available,
            },
          },
          marketRead: {
            provider: "dexscreener",
            status: "complete",
            currency: "USD",
            requestedCount: 351,
            observedCount: 20,
            qualifiedCount: 18,
            unavailableCount: 333,
            oldestFetchedAt: "2026-08-16T08:00:00.000Z",
            newestFetchedAt: "2026-08-16T08:00:00.000Z",
          },
          ranking: sparseDexscreenerMarketCapRanking(
            351,
            18,
            `sha256:${"68".repeat(32)}`,
          ),
        }), {
          status: 200,
          headers: { "X-Programmable-Market-Read-Status": "complete" },
        });
      },
    );

    const result = await loadExploreModelDataset(
      "dexscreener-sparse-351",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );

    expect(result.tokens).toHaveLength(351);
    expect(new Set(result.tokens.map((token) => token.id)).size).toBe(351);
    expect(result.tokens.filter((token) => token.valuation.status === "available"))
      .toHaveLength(18);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each(["complete", "partial"] as const)(
    "accepts a %s Dexscreener transport read with zero observed pairs",
    async (status) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({
          ...unvaluedMarketPayload,
          dataQuality: unavailableMarketDataQuality,
          marketRead: {
            provider: "dexscreener",
            status,
            currency: "USD",
            requestedCount: 1,
            observedCount: 0,
            qualifiedCount: 0,
            unavailableCount: 1,
            oldestFetchedAt: null,
            newestFetchedAt: null,
          },
        }), {
          status: 200,
          headers: { "X-Programmable-Market-Read-Status": status },
        }),
      );
      await expect(loadExplorePayload(
        `dexscreener-zero-observed-${status}`,
        new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
      )).resolves.toMatchObject({
        tokens: [expect.objectContaining({ id: bitqueryMarketEntry.id })],
        marketRead: { provider: "dexscreener", status, observedCount: 0 },
      });
    },
  );

  it("rejects an unavailable Dexscreener marker that still claims an observed pair", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...unvaluedMarketPayload,
        dataQuality: unavailableMarketDataQuality,
        marketRead: {
          provider: "dexscreener",
          status: "unavailable",
          currency: "USD",
          requestedCount: 1,
          observedCount: 1,
          qualifiedCount: 0,
          unavailableCount: 1,
          oldestFetchedAt: "2026-08-16T08:00:00.000Z",
          newestFetchedAt: "2026-08-16T08:00:00.000Z",
        },
      }), {
        status: 200,
        headers: { "X-Programmable-Market-Read-Status": "unavailable" },
      }),
    );
    await expect(loadExplorePayload(
      "dexscreener-unavailable-observed",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).rejects.toThrow("invalid market read data");
  });

  it("shows launch order when Dexscreener has zero qualified values", async () => {
    const dexPayload = {
      ...unvaluedMarketPayload,
      dataQuality: unavailableMarketDataQuality,
      marketRead: {
        provider: "dexscreener",
        status: "unavailable",
        currency: "USD",
        requestedCount: 1,
        observedCount: 0,
        qualifiedCount: 0,
        unavailableCount: 1,
        oldestFetchedAt: null,
        newestFetchedAt: null,
      },
      ranking: {
        status: "unavailable",
        requested: "fdv",
        applied: "launch-order",
        qualifiedCount: 0,
        totalCount: 1,
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(dexPayload), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Programmable-Market-Read-Status": "unavailable",
        },
      }),
    );
    const result = await loadExplorePayload(
      "dexscreener-unavailable",
      new URLSearchParams({ sort: "market-cap", page: "1", limit: "9" }),
    );
    expect(result.tokens.map((token) => token.id)).toEqual([
      bitqueryMarketEntry.id,
    ]);
    expect(exploreAppliedSortLabel("market-cap", result.ranking)).toBe(
      "Launch order",
    );
  });

  it("labels partial FDV ordering without claiming the whole list", () => {
    expect(exploreAppliedSortLabel("market-cap-asc", {
      status: "partial",
      requested: "fdv",
      applied: "qualified-fdv-then-launch-order",
      qualifiedCount: 1,
      totalCount: 2,
    })).toBe("Available valuation");
  });

  it("rejects malformed Dexscreener counts fail closed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        ...unvaluedMarketPayload,
        dataQuality: unavailableMarketDataQuality,
        marketRead: {
          provider: "dexscreener",
          status: "complete",
          currency: "USD",
          requestedCount: 1,
          observedCount: 2,
          qualifiedCount: 2,
          unavailableCount: -1,
          oldestFetchedAt: "2026-08-16T08:00:00.000Z",
          newestFetchedAt: "2026-08-16T08:00:00.000Z",
        },
      }), { status: 200 }),
    );
    await expect(loadExplorePayload(
      "dexscreener-malformed-counts",
      new URLSearchParams({ sort: "newest", page: "1", limit: "9" }),
    )).rejects.toThrow("invalid market read data");
  });

  it("stops a stalled Explore request after twelve seconds", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    const request = loadExplorePayload(
      "stalled-content-timeout",
      new URLSearchParams({
        q: "",
        sort: "market-cap",
        page: "1",
        limit: "9",
      }),
    );
    const rejection = expect(request).rejects.toThrow(
      "Tokens took too long to respond",
    );

    await vi.advanceTimersByTimeAsync(12_000);
    await rejection;
  });
});
