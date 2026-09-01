import { createServer } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const durableCacheHarness = vi.hoisted(() => ({
  entries: new Map<string, Promise<unknown>>(),
  productionAccountGate: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <Arguments extends unknown[], Value>(
    reader: (...args: Arguments) => Promise<Value>,
    keyParts: string[] = [],
  ) => (...args: Arguments): Promise<Value> => {
    const key = JSON.stringify([keyParts, args]);
    const cached = durableCacheHarness.entries.get(key);
    if (cached !== undefined) return cached as Promise<Value>;
    const pending = Promise.resolve().then(() => reader(...args)).catch(
      (error) => {
        if (durableCacheHarness.entries.get(key) === pending) {
          durableCacheHarness.entries.delete(key);
        }
        throw error;
      },
    );
    durableCacheHarness.entries.set(key, pending);
    return pending;
  },
}));

vi.mock("../lib/market-data/gmgn-account-gate.server", () => ({
  getProductionGmgnAccountGateV1:
    durableCacheHarness.productionAccountGate,
}));

import {
  normalizeGmgnSearchQueryV1,
  parseGmgnDiscoverySnapshotV1,
  parseGmgnSearchSnapshotV1,
  type GmgnDiscoverySnapshotV1,
} from "../lib/market-data/gmgn-discovery-v1";
import {
  rankCanonicalEntriesWithGmgnDiscoveryV1,
  rankCanonicalEntriesWithGmgnSearchV1,
  rankCanonicalExploreMarketCapEntriesWithGmgnV1,
} from "../lib/market-data/gmgn-canonical-ranking";
import {
  readGmgnEthereumHotSearchesV1,
  readGmgnEthereumMarketCapAuthorityRankV1,
  readGmgnEthereumSearchV1,
  readGmgnEthereumTrendingV1,
} from "../lib/market-data/gmgn-discovery.server";
import type {
  GmgnAccountGateV1,
} from "../lib/market-data/gmgn-account-gate.server";
import type { ValuedExploreEntry } from "../lib/explore-financial-data";
import type { ExploreEntry } from "../lib/tokens";

const NOW = new Date("2026-09-01T12:00:00.000Z");
const RESERVATION = Object.freeze({
  kind: "reserved" as const,
  reservedAtMs: NOW.getTime(),
  generation: 1,
  holder: "00000000-0000-4000-8000-000000000001",
});

function address(index: number): `0x${string}` {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

function providerToken(
  index: number,
  rank = index,
  overrides: Record<string, unknown> = {},
) {
  return {
    chain: "eth",
    address: address(index),
    rank,
    visiting_count: String(1_000 - rank),
    hot_level: rank,
    swaps: String(rank * 10),
    buys: rank * 6,
    sells: rank * 4,
    holder_count: String(rank * 20),
    price: "0.0000123",
    market_cap: "123000",
    liquidity: 42_000,
    volume: "9100.25",
    ...overrides,
  };
}

function rankResponse(items: readonly unknown[]) {
  return {
    code: 0,
    data: {
      code: 0,
      data: { rank: items },
      message: "success",
      reason: "",
    },
  };
}

function hotResponse(
  items: readonly unknown[],
  interval = "24h",
) {
  return {
    code: 0,
    data: [{
      chain: "eth",
      interval,
      version: "eth-hot-v1",
      tokens: items,
    }],
  };
}

function searchResponse(
  coins: readonly unknown[],
  wallets: readonly unknown[] = [],
) {
  return {
    code: 0,
    data: { coins, wallets },
  };
}

function canonicalExploreToken(index: number): ExploreEntry {
  const tokenAddress = address(index);
  return {
    id: `1:${tokenAddress}`,
    exploreKind: "token",
    name: `Token ${index}`,
    symbol: `T${index}`,
    tokenAddress,
    hookAddress: address(900),
    poolId: `0x${index.toString(16).padStart(64, "0")}`,
    launchedAt: new Date(NOW.getTime() + index * 1_000).toISOString(),
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: `1:${tokenAddress}`,
      modelId: "classic",
      modelVersion: "classic-v3",
    },
  } as ExploreEntry;
}

function valuedEntry(
  entry: ExploreEntry,
  provider: "gmgn" | "dexscreener",
  value: number | null,
): ValuedExploreEntry {
  return {
    ...entry,
    valuation: value === null
      ? { status: "unavailable", reason: "liquidity-unavailable" }
      : {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          currency: "usd",
          valueWad: String(value),
          freshness: "provider-recent",
          source: provider,
        },
  } as ValuedExploreEntry;
}

function accountGate() {
  const reserveSlot = vi.fn(async () => RESERVATION);
  const blockUntil = vi.fn(async () => ({
    blockedUntilMs: NOW.getTime() + 2_000,
    retryAfterMs: 2_000,
  }));
  const complete = vi.fn(async () => undefined);
  return {
    gate: { reserveSlot, blockUntil, complete } satisfies GmgnAccountGateV1,
    reserveSlot,
    blockUntil,
    complete,
  };
}

describe("GMGN Ethereum discovery schemas", () => {
  it("accepts absent or exact Ethereum envelope chains and rejects foreign ones", () => {
    const input = {
      kind: "trending" as const,
      interval: "1h" as const,
      limit: 10,
      fetchedAt: NOW,
    };
    const exactEthereum = {
      code: 0,
      chain: "eth",
      data: {
        code: 0,
        chain: "eth",
        data: { chain: "eth", rank: [providerToken(1, 1)] },
      },
    };

    expect(parseGmgnDiscoverySnapshotV1(exactEthereum, input))
      .not.toBeNull();
    expect(parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(2, 1),
    ]), input)).not.toBeNull();
    expect(parseGmgnDiscoverySnapshotV1({
      ...exactEthereum,
      chain: "sol",
    }, input)).toBeNull();
    expect(parseGmgnDiscoverySnapshotV1({
      ...exactEthereum,
      data: { ...exactEthereum.data, chain: "base" },
    }, input)).toBeNull();
    expect(parseGmgnDiscoverySnapshotV1({
      ...exactEthereum,
      data: {
        ...exactEthereum.data,
        data: { chain: "bsc", rank: [providerToken(1, 1)] },
      },
    }, input)).toBeNull();
  });

  it("handles the live rank double envelope and discards foreign rows", () => {
    const snapshot = parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(2, 2),
      providerToken(9, 1, { chain: "bsc" }),
      { chain: "eth", address: "not-an-address", rank: 3 },
      providerToken(2, 5),
      providerToken(1, 1),
    ]), {
      kind: "trending",
      interval: "1h",
      limit: 10,
      fetchedAt: NOW,
    });

    expect(snapshot).toMatchObject({
      schemaVersion: "programmable.gmgn-discovery.v1",
      source: "gmgn",
      chainId: "1",
      providerChain: "eth",
      kind: "trending",
      interval: "1h",
      requestedLimit: 10,
      providerItemCount: 5,
      discardedProviderItemCount: 2,
      duplicateProviderItemCount: 1,
      providerVersion: null,
    });
    expect(snapshot?.tokens.map((token) => token.tokenAddress)).toEqual([
      address(1),
      address(2),
    ]);
    expect(snapshot?.tokens[0]).toMatchObject({
      rank: 1,
      visitingCount: 999,
      swaps: 10,
      priceUsd: 0.0000123,
      marketCapUsd: 123_000,
      liquidityUsd: 42_000,
      volumeUsd: 9_100.25,
    });
  });

  it("selects only the exact Ethereum hot-search block", () => {
    const snapshot = parseGmgnDiscoverySnapshotV1({
      code: "0",
      data: [{
        chain: "bsc",
        interval: "5m",
        version: "foreign",
        tokens: [providerToken(91, 1, { chain: "bsc" })],
      }, {
        chain: "eth",
        interval: "5m",
        version: "eth-hot-v2",
        tokens: [providerToken(4, 2), providerToken(3, 1)],
      }],
    }, {
      kind: "hot-search",
      interval: "5m",
      limit: 20,
      fetchedAt: NOW,
    });

    expect(snapshot).toMatchObject({
      kind: "hot-search",
      providerVersion: "eth-hot-v2",
      providerItemCount: 3,
      discardedProviderItemCount: 1,
      duplicateProviderItemCount: 0,
    });
    expect(snapshot?.tokens.map((token) => token.tokenAddress)).toEqual([
      address(3),
      address(4),
    ]);
  });

  it("fails closed for an errored envelope, missing exact block, or over-limit list", () => {
    const input = {
      kind: "trending" as const,
      interval: "1h" as const,
      limit: 1,
      fetchedAt: NOW,
    };
    expect(parseGmgnDiscoverySnapshotV1({
      code: 400,
      data: { rank: [] },
    }, input)).toBeNull();
    expect(parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(1),
      providerToken(2),
    ]), input)).toBeNull();
    expect(parseGmgnDiscoverySnapshotV1({
      code: 0,
      data: [{
        chain: "bsc",
        interval: "1h",
        tokens: [],
      }],
    }, {
      ...input,
      kind: "hot-search",
    })).toBeNull();
  });
});

describe("GMGN Ethereum search schema and canonical boundary", () => {
  it("normalizes bounded user queries and strips invisible controls", () => {
    expect(normalizeGmgnSearchQueryV1("  $\u200bTo\u0000Ken  ")).toBe("token");
    expect(normalizeGmgnSearchQueryV1("$  ")).toBeNull();
    expect(normalizeGmgnSearchQueryV1("x".repeat(100))).toBe("x".repeat(100));
    expect(normalizeGmgnSearchQueryV1("x".repeat(101))).toBeNull();
  });

  it("keeps only unique exact-Ethereum coins and never wallet rows", () => {
    const snapshot = parseGmgnSearchSnapshotV1(searchResponse([
      { chain: "eth", address: address(2), symbol: "T2" },
      { chain: "bsc", address: address(90), symbol: "FOREIGN" },
      { chain: "eth", address: "invalid", symbol: "BAD" },
      { chain: "eth", address: address(2), symbol: "DUP" },
      { chain: "eth", address: address(1), symbol: "T1" },
    ], [{ chain: "eth", address: address(77), name: "wallet" }]), {
      query: "$Token",
      fetchedAt: NOW,
    });

    expect(snapshot).toMatchObject({
      schemaVersion: "programmable.gmgn-search.v1",
      source: "gmgn",
      providerChain: "eth",
      query: "token",
      orderBy: "weight",
      providerItemCount: 5,
      discardedProviderItemCount: 2,
      duplicateProviderItemCount: 1,
    });
    expect(snapshot?.tokens).toEqual([
      { chain: "eth", tokenAddress: address(2), rank: 1 },
      { chain: "eth", tokenAddress: address(1), rank: 5 },
    ]);
    expect(snapshot?.tokens).not.toContainEqual(expect.objectContaining({
      tokenAddress: address(77),
    }));
  });

  it("fails closed for wrong-chain envelopes and oversized wallet lists", () => {
    const input = { query: "token", fetchedAt: NOW };
    expect(parseGmgnSearchSnapshotV1({
      ...searchResponse([]),
      chain: "sol",
    }, input)).toBeNull();
    expect(parseGmgnSearchSnapshotV1({
      code: 0,
      data: { ...searchResponse([]).data, chain: "base" },
    }, input)).toBeNull();
    expect(parseGmgnSearchSnapshotV1(
      searchResponse([], Array.from({ length: 51 }, () => ({}))),
      input,
    )).toBeNull();
  });

  it("unions provider-matched canonical aliases with stable local matches", () => {
    const alpha = { id: "alpha" };
    const beta = { id: "beta" };
    const aliasOnly = { id: "alias-only" };
    const localTail = { id: "local-tail" };
    const canonical = [alpha, beta, aliasOnly, localTail];
    const identities = new Map([
      ["alpha", { chainId: 1, tokenAddress: address(1) }],
      ["beta", { chainId: 1, tokenAddress: address(2) }],
      ["alias-only", { chainId: 1, tokenAddress: address(3) }],
      ["local-tail", { chainId: 1, tokenAddress: address(4) }],
    ]);
    const snapshot = parseGmgnSearchSnapshotV1(searchResponse([
      { chain: "eth", address: address(3) },
      { chain: "eth", address: address(99) },
      { chain: "eth", address: address(1) },
      { chain: "eth", address: address(3) },
    ]), { query: "alias", fetchedAt: NOW });
    if (snapshot === null) throw new Error("fixture unavailable");

    const result = rankCanonicalEntriesWithGmgnSearchV1(
      canonical,
      [alpha, localTail],
      snapshot,
      "alias",
      (entry) => identities.get(entry.id) ?? null,
      NOW,
    );

    expect(result.entries).toEqual([aliasOnly, alpha, localTail]);
    result.entries.forEach((entry) => expect(canonical).toContain(entry));
    expect(result.coverage).toMatchObject({
      canonicalUniverseTokenCount: 4,
      localMatchEntryCount: 2,
      canonicalMatchEntryCount: 3,
      gmgnObservedUniqueTokenCount: 3,
      gmgnMatchedEntryCount: 2,
      gmgnMatchedUniqueTokenCount: 2,
      unobservedLocalMatchEntryCount: 1,
      providerOnlyCanonicalTokenCount: 1,
      foreignGmgnTokenCount: 1,
      duplicateGmgnTokenCount: 1,
      canonicalAddressCoverageBps: 6_666,
    });

    const zero = parseGmgnSearchSnapshotV1(searchResponse([]), {
      query: "alias",
      fetchedAt: NOW,
    });
    expect(rankCanonicalEntriesWithGmgnSearchV1(
      canonical,
      [alpha, localTail],
      zero,
      "alias",
      (entry) => identities.get(entry.id) ?? null,
      NOW,
    ).entries).toEqual([alpha, localTail]);

    expect(rankCanonicalEntriesWithGmgnSearchV1(
      canonical,
      [alpha, localTail],
      snapshot,
      "wrong-query",
      (entry) => identities.get(entry.id) ?? null,
      NOW,
    ).entries).toEqual([alpha, localTail]);
    expect(rankCanonicalEntriesWithGmgnSearchV1(
      canonical,
      [alpha, localTail],
      snapshot,
      "alias",
      (entry) => identities.get(entry.id) ?? null,
      new Date(NOW.getTime() + 5 * 60_000 + 1),
    ).entries).toEqual([alpha, localTail]);
  });
});

describe("GMGN canonical discovery intersection", () => {
  it("moves only observed canonical tokens forward and keeps every fallback stable", () => {
    const alpha = { id: "alpha", metadata: { canonical: true } };
    const foreignChain = { id: "foreign-chain", metadata: { canonical: true } };
    const beta = { id: "beta", metadata: { canonical: true } };
    const unobserved = { id: "unobserved", metadata: { canonical: true } };
    const gamma = { id: "gamma", metadata: { canonical: true } };
    const canonical = [alpha, foreignChain, beta, unobserved, gamma];
    const identities = new Map([
      ["alpha", { chainId: 1, tokenAddress: address(1) }],
      ["foreign-chain", { chainId: 4663, tokenAddress: address(9) }],
      ["beta", { chainId: "1", tokenAddress: address(2) }],
      ["unobserved", { chainId: 1, tokenAddress: address(4) }],
      ["gamma", { chainId: 1, tokenAddress: address(3) }],
    ]);
    const trending = parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(3, 1),
      providerToken(1, 2),
      providerToken(88, 3),
    ]), {
      kind: "trending",
      interval: "1h",
      orderBy: "marketcap",
      direction: "desc",
      limit: 10,
      fetchedAt: NOW,
    });
    const hot = parseGmgnDiscoverySnapshotV1(hotResponse([
      providerToken(2, 1),
      providerToken(3, 2),
    ]), {
      kind: "hot-search",
      interval: "24h",
      limit: 10,
      fetchedAt: NOW,
    });
    if (trending === null || hot === null) throw new Error("fixture unavailable");

    const result = rankCanonicalEntriesWithGmgnDiscoveryV1(
      canonical,
      [trending, hot],
      (entry) => identities.get(entry.id) ?? null,
    );

    expect(result.entries).toEqual([
      gamma,
      alpha,
      beta,
      foreignChain,
      unobserved,
    ]);
    expect(result.entries[0]).toBe(gamma);
    expect(result.entries[1]).toBe(alpha);
    expect(result.entries[2]).toBe(beta);
    expect(result.entries[3]).toBe(foreignChain);
    expect(result.entries[4]).toBe(unobserved);
    expect(result.rows.map((row) => row.gmgn?.providerRank ?? null)).toEqual([
      1,
      2,
      1,
      null,
      null,
    ]);
    expect(result.coverage).toEqual({
      canonicalEntryCount: 5,
      canonicalEthereumEntryCount: 4,
      canonicalUniqueTokenCount: 4,
      gmgnSnapshotCount: 2,
      invalidGmgnSnapshotCount: 0,
      gmgnObservedUniqueTokenCount: 4,
      gmgnMatchedEntryCount: 3,
      gmgnMatchedUniqueTokenCount: 3,
      unobservedCanonicalEntryCount: 2,
      foreignGmgnTokenCount: 1,
      duplicateGmgnTokenCount: 1,
      discardedProviderItemCount: 0,
      canonicalAddressCoverageBps: 7_500,
    });
  });

  it("ignores a runtime-invalid GMGN snapshot without hiding the catalog", () => {
    const canonical = [{ id: "one" }, { id: "two" }];
    const valid = parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(1, 1),
    ]), {
      kind: "trending",
      interval: "1h",
      limit: 10,
      fetchedAt: NOW,
    });
    if (valid === null) throw new Error("fixture unavailable");
    const invalid = {
      ...valid,
      tokens: [{ ...valid.tokens[0]!, chain: "bsc" }],
    } as unknown as GmgnDiscoverySnapshotV1;
    const result = rankCanonicalEntriesWithGmgnDiscoveryV1(
      canonical,
      [invalid],
      (entry) => ({
        chainId: 1,
        tokenAddress: entry.id === "one" ? address(1) : address(2),
      }),
    );
    expect(result.entries).toEqual(canonical);
    expect(result.coverage).toMatchObject({
      invalidGmgnSnapshotCount: 1,
      gmgnMatchedEntryCount: 0,
      unobservedCanonicalEntryCount: 2,
    });
  });

  it("keeps canonical objects while Dexscreener ranks only the GMGN remainder", () => {
    const canonical = [1, 2, 3, 4].map(canonicalExploreToken);
    const snapshot = parseGmgnDiscoverySnapshotV1(rankResponse([
      providerToken(4, 1, {
        market_cap: "999999999999",
        liquidity: "9999.99",
      }),
      providerToken(3, 2),
      providerToken(1, 3),
      providerToken(90, 4),
    ]), {
      kind: "trending",
      interval: "1h",
      orderBy: "marketcap",
      direction: "desc",
      limit: 10,
      fetchedAt: NOW,
    });
    if (snapshot === null) throw new Error("fixture unavailable");
    const foreign = {
      ...valuedEntry(canonical[1]!, "dexscreener", 999),
      id: `1:${address(99)}`,
      tokenAddress: address(99),
      poolId: `0x${"63".padStart(64, "0")}`,
    } as ValuedExploreEntry;
    const sameIdForeignIdentity = {
      ...valuedEntry(canonical[1]!, "dexscreener", 2_000),
      tokenAddress: address(98),
      poolId: `0x${"62".padStart(64, "0")}`,
    } as ValuedExploreEntry;
    const fallbackEntries = [
      valuedEntry(canonical[1]!, "dexscreener", 20),
      valuedEntry(canonical[3]!, "dexscreener", 40),
      foreign,
      sameIdForeignIdentity,
      valuedEntry(canonical[1]!, "dexscreener", 1),
    ];
    const fallback = {
      gmgnHydrationLimit: 100,
      gmgnHydrationEligibleEntryCount: 0,
      gmgnRequestedEntries: [],
      gmgnEntries: [],
      dexscreenerRequestedEntries: [canonical[1]!, canonical[3]!],
      dexscreenerEntries: fallbackEntries,
    } as const;

    const result = rankCanonicalExploreMarketCapEntriesWithGmgnV1(
      canonical,
      [snapshot],
      fallback,
      "desc",
      NOW,
    );

    expect(result.entries).toEqual([
      canonical[2],
      canonical[0],
      canonical[3],
      canonical[1],
    ]);
    result.entries.forEach((entry) => {
      expect(canonical).toContain(entry);
      expect(entry).not.toHaveProperty("valuation");
    });
    expect(result).toMatchObject({
      fallbackRequestedEntryCount: 2,
      fallbackAcceptedEntryCount: 2,
      fallbackQualifiedEntryCount: 2,
      discardedFallbackEntryCount: 3,
      coverage: {
        canonicalEntryCount: 4,
        gmgnMatchedEntryCount: 2,
        foreignGmgnTokenCount: 1,
        discardedProviderItemCount: 1,
      },
    });
    const wrongDirection = rankCanonicalExploreMarketCapEntriesWithGmgnV1(
      canonical,
      [snapshot],
      fallback,
      "asc",
      NOW,
    );
    expect(wrongDirection.coverage.gmgnSnapshotCount).toBe(0);
    expect(wrongDirection.coverage.gmgnMatchedEntryCount).toBe(0);
    const stale = rankCanonicalExploreMarketCapEntriesWithGmgnV1(
      canonical,
      [snapshot],
      fallback,
      "desc",
      new Date(NOW.getTime() + 5 * 60_000 + 1),
    );
    expect(stale.coverage.gmgnSnapshotCount).toBe(0);
    expect(stale.coverage.gmgnMatchedEntryCount).toBe(0);
  });

  it("keeps GMGN token-info FDV and Dex FDV in separate ordered tiers", () => {
    const canonical = [1, 2, 3, 4, 5].map(canonicalExploreToken);
    const sameIdForeignGmgn = {
      ...valuedEntry(canonical[0]!, "gmgn", 99_999),
      tokenAddress: address(91),
      poolId: `0x${"5b".padStart(64, "0")}`,
    } as ValuedExploreEntry;
    const result = rankCanonicalExploreMarketCapEntriesWithGmgnV1(
      canonical,
      [],
      {
        gmgnHydrationLimit: 3,
        gmgnHydrationEligibleEntryCount: 5,
        gmgnRequestedEntries: canonical.slice(0, 3),
        gmgnEntries: [
          valuedEntry(canonical[0]!, "gmgn", 10),
          valuedEntry(canonical[1]!, "gmgn", 50),
          valuedEntry(canonical[2]!, "gmgn", null),
          sameIdForeignGmgn,
        ],
        dexscreenerRequestedEntries: canonical.slice(2),
        dexscreenerEntries: [
          valuedEntry(canonical[2]!, "dexscreener", 999),
          valuedEntry(canonical[3]!, "dexscreener", 100),
          valuedEntry(canonical[4]!, "dexscreener", null),
        ],
      },
      "desc",
      NOW,
    );

    expect(result.entries).toEqual([
      canonical[1],
      canonical[0],
      canonical[2],
      canonical[3],
      canonical[4],
    ]);
    expect(result.rows.map((row) => row.orderingSource)).toEqual([
      "gmgn-token-info-fdv",
      "gmgn-token-info-fdv",
      "dexscreener-fdv",
      "dexscreener-fdv",
      "canonical-launch-order",
    ]);
    expect(result).toMatchObject({
      gmgnHydrationLimit: 3,
      gmgnHydrationEligibleEntryCount: 5,
      gmgnHydrationRequestedEntryCount: 3,
      gmgnHydrationAcceptedEntryCount: 3,
      gmgnHydrationQualifiedEntryCount: 2,
      gmgnHydrationDeferredEntryCount: 2,
      discardedGmgnHydrationEntryCount: 1,
      fallbackRequestedEntryCount: 3,
      fallbackAcceptedEntryCount: 3,
      fallbackQualifiedEntryCount: 2,
      canonicalTailEntryCount: 1,
    });
  });
});

describe("GMGN discovery server adapter", () => {
  beforeEach(() => {
    durableCacheHarness.entries.clear();
    durableCacheHarness.productionAccountGate.mockReset();
    vi.stubEnv("GMGN_API_KEY", "");
    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not request GMGN without a server-side API key", async () => {
    const fetchImpl = vi.fn();
    await expect(readGmgnEthereumTrendingV1({}, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a foreign chain declared by the raw provider envelope", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    const response = rankResponse([providerToken(10, 1)]);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      ...response,
      chain: "sol",
    }), { status: 200 }));

    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 10,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
  });

  it("keeps provider bodies and credentials out of discovery diagnostics", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const providerSentinel = "SENTINEL_PROVIDER_ACCOUNT_654321";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { gate } = accountGate();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      code: providerSentinel,
      data: { data: { rank: [providerToken(10, 1)] } },
    }), { status: 200 }));

    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 10,
      orderBy: "marketcap",
      direction: "asc",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();

    const diagnostics = JSON.stringify(warn.mock.calls);
    expect(diagnostics).toContain("envelope-rejected");
    expect(diagnostics).toContain("asc");
    expect(diagnostics).not.toContain(providerSentinel);
    expect(diagnostics).not.toContain("test-server-key");
    expect(diagnostics).not.toContain(address(10));
  });

  it("uses only the official read-only rank request and weight one", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot, complete } = accountGate();
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      void _input;
      void _init;
      return new Response(JSON.stringify(
        rankResponse([providerToken(11, 1)]),
      ), { status: 200 });
    });

    const result = await readGmgnEthereumTrendingV1({
      interval: "1m",
      limit: 11,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    expect(result?.tokens[0]?.tokenAddress).toBe(address(11));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [request, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin).toBe("https://openapi.gmgn.ai");
    expect(url.pathname).toBe("/v1/market/rank");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      chain: "eth",
      interval: "1m",
      limit: "11",
      timestamp: "1788264000",
    });
    expect(url.searchParams.get("client_id")).toMatch(/^[0-9a-f-]{36}$/u);
    const headers = new Headers(init?.headers);
    expect(headers.get("X-APIKEY")).toBe("test-server-key");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("User-Agent")).toBe("programmable-market-indexer/1.0");
    expect(headers.get("X-Signature")).toBeNull();
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    expect(reserveSlot).toHaveBeenCalledWith({
      requestsPerSecond: 1,
      cost: 1,
      deadlineMs: NOW.getTime() + 5_000,
      signal: undefined,
    });
    expect(complete).toHaveBeenCalledWith(RESERVATION);
  });

  it("uses the official Ethereum search request with weight one", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot, complete } = accountGate();
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      void _input;
      void _init;
      return new Response(JSON.stringify(
        searchResponse([{ chain: "eth", address: address(31) }]),
      ), { status: 200 });
    });

    const result = await readGmgnEthereumSearchV1(" $Search Alias ", {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });

    expect(result).toMatchObject({
      query: "search alias",
      orderBy: "weight",
      tokens: [{ tokenAddress: address(31), rank: 1 }],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [request, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin).toBe("https://openapi.gmgn.ai");
    expect(url.pathname).toBe("/v1/market/search");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      query: "search alias",
      chain: "eth",
      order_by: "weight",
      timestamp: "1788264000",
    });
    expect(url.searchParams.get("client_id")).toMatch(/^[0-9a-f-]{36}$/u);
    expect(new Headers(init?.headers).get("X-APIKEY")).toBe("test-server-key");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(reserveSlot).toHaveBeenCalledWith({
      requestsPerSecond: 1,
      cost: 1,
      deadlineMs: NOW.getTime() + 5_000,
      signal: undefined,
    });
    expect(complete).toHaveBeenCalledWith(RESERVATION);
  });

  it("keeps the GMGN HTTP budget after a cold shared-gate reservation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const reservation = {
      ...RESERVATION,
      reservedAtMs: NOW.getTime() + 3_000,
    };
    const reserveSlot = vi.fn(() => new Promise<typeof reservation>((resolve) => {
      setTimeout(() => resolve(reservation), 3_000);
    }));
    const complete = vi.fn(async () => {});
    const gate = {
      reserveSlot,
      blockUntil: vi.fn(),
      complete,
    } satisfies GmgnAccountGateV1;
    let providerSignal: AbortSignal | null | undefined;
    const fetchImpl = vi.fn((
      _input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      providerSignal = init?.signal;
      return Promise.resolve(new Response(JSON.stringify(
        rankResponse([providerToken(16, 1)]),
      ), { status: 200 }));
    });

    const read = readGmgnEthereumTrendingV1({
      interval: "1m",
      limit: 96,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => new Date(),
      deadlineMs: NOW.getTime() + 8_000,
    });

    await vi.advanceTimersByTimeAsync(2_500);
    expect(fetchImpl).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    await expect(read).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(16) }],
    });
    expect(reserveSlot).toHaveBeenCalledWith({
      requestsPerSecond: 1,
      cost: 1,
      deadlineMs: NOW.getTime() + 5_000,
      signal: undefined,
    });
    expect(providerSignal?.aborted).toBe(false);
    expect(complete).toHaveBeenCalledWith(reservation);
  });

  it("requests isolated official market-cap rankings in either direction", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot } = accountGate();
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      void _input;
      void _init;
      return new Response(JSON.stringify(
        rankResponse([providerToken(22, 1)]),
      ), { status: 200 });
    });

    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 22,
      orderBy: "marketcap",
      direction: "desc",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.not.toBeNull();
    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 22,
      orderBy: "marketcap",
      direction: "asc",
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.not.toBeNull();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([request]) => {
      const params = new URL(String(request)).searchParams;
      return {
        chain: params.get("chain"),
        interval: params.get("interval"),
        limit: params.get("limit"),
        orderBy: params.get("order_by"),
        direction: params.get("direction"),
      };
    })).toEqual([{
      chain: "eth",
      interval: "1h",
      limit: "22",
      orderBy: "marketcap",
      direction: "desc",
    }, {
      chain: "eth",
      interval: "1h",
      limit: "22",
      orderBy: "marketcap",
      direction: "asc",
    }]);
    expect(reserveSlot).toHaveBeenCalledTimes(2);
    expect(reserveSlot).toHaveBeenNthCalledWith(1, expect.objectContaining({
      cost: 1,
    }));
    expect(reserveSlot).toHaveBeenNthCalledWith(2, expect.objectContaining({
      cost: 1,
    }));
  });

  it("sends the exact Ethereum hot-search body and charges weight three", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot } = accountGate();
    const fetchImpl = vi.fn(async (
      _input: RequestInfo | URL,
      _init?: RequestInit,
    ) => {
      void _input;
      void _init;
      return new Response(JSON.stringify(
        hotResponse([providerToken(12, 1)], "5m"),
      ), { status: 200 });
    });

    const result = await readGmgnEthereumHotSearchesV1({
      interval: "5m",
      limit: 12,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    expect(result?.tokens[0]?.tokenAddress).toBe(address(12));
    const [request, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(request));
    expect(url.origin).toBe("https://openapi.gmgn.ai");
    expect(url.pathname).toBe("/v1/market/hot_searches");
    expect(url.searchParams.get("chain")).toBeNull();
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      params: [{
        label: "hot-search",
        chain: "eth",
        interval: "5m",
        limit: 12,
      }],
    });
    expect(reserveSlot).toHaveBeenCalledWith({
      requestsPerSecond: 1,
      cost: 3,
      deadlineMs: NOW.getTime() + 5_000,
      signal: undefined,
    });
  });

  it("coalesces concurrent reads and serves the bounded live cache", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      rankResponse([providerToken(13, 1)]),
    ), { status: 200 }));
    const read = () => readGmgnEthereumTrendingV1({
      interval: "6h",
      limit: 13,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    const [first, second] = await Promise.all([read(), read()]);
    const third = await read();
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("shares one successful rank snapshot across fresh server isolates", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot } = accountGate();
    durableCacheHarness.productionAccountGate.mockReturnValue(gate);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      rankResponse([providerToken(41, 1)]),
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const input = { interval: "1m" as const, limit: 41 };

    const first = await readGmgnEthereumTrendingV1(input, {
      deadlineMs: Date.now() + 5_000,
    });
    expect(first).toMatchObject({
      tokens: [{ tokenAddress: address(41) }],
    });

    vi.resetModules();
    const freshAdapter = await import(
      "../lib/market-data/gmgn-discovery.server"
    );
    const second = await freshAdapter.readGmgnEthereumTrendingV1(input, {
      deadlineMs: Date.now() + 5_000,
    });

    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(reserveSlot).toHaveBeenCalledOnce();
    expect(reserveSlot).toHaveBeenCalledWith(expect.objectContaining({
      cost: 1,
      signal: undefined,
    }));
  });

  it("keeps every finite durable discovery query key isolated", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    durableCacheHarness.productionAccountGate.mockReturnValue(gate);
    const fetchImpl = vi.fn(async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/market/hot_searches") {
        const body = JSON.parse(String(init?.body)) as {
          params: Array<{ interval: string }>;
        };
        return new Response(JSON.stringify(hotResponse(
          [providerToken(53, 1)],
          body.params[0]?.interval,
        )), { status: 200 });
      }
      return new Response(JSON.stringify(
        rankResponse([providerToken(54 + fetchImpl.mock.calls.length, 1)]),
      ), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const wait = () => ({ deadlineMs: Date.now() + 5_000 });

    const reads = [
      readGmgnEthereumTrendingV1(
        { interval: "1h", limit: 20 },
        wait(),
      ),
      readGmgnEthereumTrendingV1(
        { interval: "5m", limit: 20 },
        wait(),
      ),
      readGmgnEthereumTrendingV1(
        { interval: "1h", limit: 21 },
        wait(),
      ),
      readGmgnEthereumTrendingV1(
        {
          interval: "1h",
          limit: 20,
          orderBy: "marketcap",
          direction: "desc",
        },
        wait(),
      ),
      readGmgnEthereumTrendingV1(
        {
          interval: "1h",
          limit: 20,
          orderBy: "marketcap",
          direction: "asc",
        },
        wait(),
      ),
      readGmgnEthereumHotSearchesV1(
        { interval: "1h", limit: 20 },
        wait(),
      ),
    ];

    await expect(Promise.all(reads)).resolves.not.toContain(null);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
    await expect(readGmgnEthereumTrendingV1(
      { interval: "1h", limit: 20 },
      wait(),
    )).resolves.not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("keeps arbitrary search terms out of the durable cache", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    durableCacheHarness.productionAccountGate.mockReturnValue(gate);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      searchResponse([{ chain: "eth", address: address(61) }]),
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);

    await expect(readGmgnEthereumSearchV1("arbitrary-61", {
      deadlineMs: Date.now() + 5_000,
    })).resolves.not.toBeNull();
    expect(durableCacheHarness.entries.size).toBe(0);

    vi.resetModules();
    const freshAdapter = await import(
      "../lib/market-data/gmgn-discovery.server"
    );
    await expect(freshAdapter.readGmgnEthereumSearchV1("arbitrary-61", {
      deadlineMs: Date.now() + 5_000,
    })).resolves.not.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(durableCacheHarness.entries.size).toBe(0);
  });

  it("does not persist a null provider result in the durable cache", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    durableCacheHarness.productionAccountGate.mockReturnValue(gate);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        chain: "sol",
        data: { rank: [providerToken(72, 1)] },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(
        rankResponse([providerToken(72, 1)]),
      ), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const input = { interval: "6h" as const, limit: 72 };

    await expect(readGmgnEthereumTrendingV1(input, {
      deadlineMs: Date.now() + 5_000,
    })).resolves.toBeNull();
    await expect(readGmgnEthereumTrendingV1(input, {
      deadlineMs: Date.now() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(72) }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps shared authority within its public-safe age then fails closed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    durableCacheHarness.productionAccountGate.mockReturnValue(gate);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      rankResponse([providerToken(75, 1)]),
    ), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const input = { interval: "5m" as const, limit: 75 };

    await expect(readGmgnEthereumTrendingV1(input, {
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(75) }],
    });

    await vi.advanceTimersByTimeAsync(235_000);
    await expect(readGmgnEthereumTrendingV1(input, {
      deadlineMs: Date.now() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(75) }],
    });

    await vi.advanceTimersByTimeAsync(1);
    await expect(readGmgnEthereumTrendingV1(input, {
      deadlineMs: Date.now() + 5_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("awaits a fresh rank inside the shared market-cap authority lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    durableCacheHarness.productionAccountGate.mockReturnValue(gate);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(
        rankResponse([providerToken(79, 1)]),
      ), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(
        rankResponse([providerToken(80, 1)]),
      ), { status: 200 }));
    vi.stubGlobal("fetch", fetchImpl);
    const options = {
      interval: "1h" as const,
      limit: 100 as const,
      orderBy: "marketcap" as const,
      direction: "asc" as const,
    };

    await expect(readGmgnEthereumTrendingV1(options, {
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(79) }],
    });
    expect(durableCacheHarness.entries.size).toBe(1);

    await vi.advanceTimersByTimeAsync(235_001);
    await expect(readGmgnEthereumMarketCapAuthorityRankV1(options, {
      deadlineMs: Date.now() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(80) }],
    });
    await expect(readGmgnEthereumMarketCapAuthorityRankV1(options, {
      deadlineMs: Date.now() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(80) }],
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(durableCacheHarness.entries.size).toBe(1);
  });

  it("does not start a durable fill for a caller that cannot wait", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot } = accountGate();
    durableCacheHarness.productionAccountGate.mockReturnValue(gate);
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const controller = new AbortController();
    controller.abort();

    await expect(readGmgnEthereumTrendingV1({
      interval: "1m",
      limit: 76,
    }, {
      signal: controller.signal,
      deadlineMs: Date.now() + 5_000,
    })).resolves.toBeNull();
    await expect(readGmgnEthereumTrendingV1({
      interval: "1m",
      limit: 77,
    }, {
      deadlineMs: Date.now(),
    })).resolves.toBeNull();

    expect(durableCacheHarness.entries.size).toBe(0);
    expect(reserveSlot).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds a durable wait by the caller abort without cancelling its fill", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot, complete } = accountGate();
    durableCacheHarness.productionAccountGate.mockReturnValue(gate);
    const controller = new AbortController();
    let releaseResponse!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await responseReady;
      return new Response(JSON.stringify(
        rankResponse([providerToken(73, 1)]),
      ), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const input = { interval: "24h" as const, limit: 73 };
    const aborted = readGmgnEthereumTrendingV1(input, {
      signal: controller.signal,
      deadlineMs: Date.now() + 5_000,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());

    controller.abort();
    await expect(aborted).resolves.toBeNull();
    expect(reserveSlot).toHaveBeenCalledWith(expect.objectContaining({
      signal: undefined,
    }));

    releaseResponse();
    await expect(readGmgnEthereumTrendingV1(input, {
      deadlineMs: Date.now() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(73) }],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(RESERVATION);
  });

  it("bounds a durable wait by the caller deadline without cancelling its fill", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    durableCacheHarness.productionAccountGate.mockReturnValue(gate);
    let releaseResponse!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await responseReady;
      return new Response(JSON.stringify(
        rankResponse([providerToken(74, 1)]),
      ), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchImpl);
    const input = { interval: "1m" as const, limit: 74 };
    const bounded = readGmgnEthereumTrendingV1(input, {
      deadlineMs: NOW.getTime() + 1_000,
    });
    await vi.advanceTimersByTimeAsync(999);
    let settled = false;
    void bounded.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(bounded).resolves.toBeNull();
    releaseResponse();
    await expect(readGmgnEthereumTrendingV1(input, {
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(74) }],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("accepts the official 20 RPS ceiling and rejects 21 conservatively", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot } = accountGate();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(
      rankResponse([providerToken(18, 1)]),
    ), { status: 200 }));

    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "20");
    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 18,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.not.toBeNull();

    vi.stubEnv("GMGN_MAX_REQUESTS_PER_SECOND", "21");
    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 19,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.not.toBeNull();

    expect(reserveSlot).toHaveBeenNthCalledWith(1, {
      requestsPerSecond: 20,
      cost: 1,
      deadlineMs: NOW.getTime() + 5_000,
      signal: undefined,
    });
    expect(reserveSlot).toHaveBeenNthCalledWith(2, {
      requestsPerSecond: 1,
      cost: 1,
      deadlineMs: NOW.getTime() + 5_000,
      signal: undefined,
    });
  });

  it("isolates caller aborts from shared provider work and the success cache", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate } = accountGate();
    const controller = new AbortController();
    let releaseResponse!: () => void;
    const responseReady = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const fetchImpl = vi.fn(async () => {
      await responseReady;
      return new Response(JSON.stringify(
        rankResponse([providerToken(20, 1)]),
      ), { status: 200 });
    });
    const input = { interval: "1m" as const, limit: 20 };
    const first = readGmgnEthereumTrendingV1(input, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      signal: controller.signal,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 1_000,
    });
    const second = readGmgnEthereumTrendingV1(input, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    controller.abort();
    await expect(first).resolves.toBeNull();
    releaseResponse();
    await expect(second).resolves.toMatchObject({
      kind: "trending",
      tokens: [{ tokenAddress: address(20) }],
    });

    await expect(readGmgnEthereumTrendingV1(input, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(20) }],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps a timed-out provider read pending until its exact lease is released", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    let releaseComplete!: () => void;
    const completeDeferred = new Promise<void>((resolve) => {
      releaseComplete = resolve;
    });
    const reserveSlot = vi.fn(async () => RESERVATION);
    const complete = vi.fn((_reservation: typeof RESERVATION) => {
      void _reservation;
      return completeDeferred;
    });
    const gate = {
      reserveSlot,
      blockUntil: vi.fn(),
      complete,
    } satisfies GmgnAccountGateV1;
    let providerRejected = false;
    const fetchImpl = vi.fn(() => new Promise<Response>((_resolve, reject) => {
      setTimeout(() => {
        providerRejected = true;
        reject(new DOMException("provider request timed out", "AbortError"));
      }, 2_501);
    }));

    const publicRead = readGmgnEthereumTrendingV1({
      interval: "5m",
      limit: 97,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => new Date(),
      deadlineMs: NOW.getTime() + 10_000,
    });
    let publicReadSettled = false;
    void publicRead.then(
      () => {
        publicReadSettled = true;
      },
      () => {
        publicReadSettled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(reserveSlot).toHaveResolvedWith(RESERVATION);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(providerRejected).toBe(false);
    expect(complete).not.toHaveBeenCalled();
    expect(publicReadSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(providerRejected).toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[0]).toBe(RESERVATION);
    expect(publicReadSettled).toBe(false);

    releaseComplete();
    await expect(publicRead).resolves.toBeNull();
    expect(publicReadSettled).toBe(true);
  });

  it("fails soft for invalid controls, envelopes, and oversized bodies", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const fetchImpl = vi.fn();
    await expect(readGmgnEthereumTrendingV1({
      interval: "1h",
      limit: 101,
    }, {
      fetchImpl,
      now: () => NOW,
    })).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    const invalidEnvelopeFetch = vi.fn(async () => new Response(JSON.stringify({
      code: 0,
      data: { code: 400, data: { rank: [] } },
    }), { status: 200 }));
    await expect(readGmgnEthereumTrendingV1({
      interval: "24h",
      limit: 14,
    }, {
      fetchImpl: invalidEnvelopeFetch as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();

    const cancel = vi.fn();
    const oversizedFetch = vi.fn(async () => new Response(
      new ReadableStream({ cancel }),
      {
        status: 200,
        headers: { "Content-Length": "1000001" },
      },
    ));
    await expect(readGmgnEthereumHotSearchesV1({
      interval: "1h",
      limit: 15,
    }, {
      fetchImpl: oversizedFetch as typeof fetch,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
    expect(invalidEnvelopeFetch).toHaveBeenCalledOnce();
    expect(oversizedFetch).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("bounds a stalled account gate and does not poison a later retry", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const reserveSlot = vi.fn(() => new Promise<never>(() => undefined));
    const stalledGate: GmgnAccountGateV1 = {
      reserveSlot,
      blockUntil: vi.fn(),
      complete: vi.fn(),
    };
    const fetchImpl = vi.fn();
    const input = { interval: "24h" as const, limit: 21 };
    const stalledRead = readGmgnEthereumTrendingV1(input, {
      fetchImpl,
      accountGate: stalledGate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });
    await vi.advanceTimersByTimeAsync(5_500);
    await expect(stalledRead).resolves.toBeNull();
    expect(reserveSlot).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();

    // The caller's five-second budget is independent from the detached
    // provider lifecycle. Let its bounded late-outcome cleanup finish before
    // proving that the same cache key can start a new request.
    await vi.advanceTimersByTimeAsync(2_500);

    vi.useRealTimers();
    const { gate } = accountGate();
    const retryFetch = vi.fn(async () => new Response(JSON.stringify(
      rankResponse([providerToken(21, 1)]),
    ), { status: 200 }));
    await expect(readGmgnEthereumTrendingV1(input, {
      fetchImpl: retryFetch as typeof fetch,
      accountGate: gate,
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toMatchObject({
      tokens: [{ tokenAddress: address(21) }],
    });
    expect(retryFetch).toHaveBeenCalledOnce();
  });

  it("fails a search softly when its shared gate deadline expires", async () => {
    vi.useFakeTimers();
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const reserveSlot = vi.fn(() => new Promise<never>(() => undefined));
    const fetchImpl = vi.fn();
    const stalledRead = readGmgnEthereumSearchV1("gate-timeout", {
      fetchImpl,
      accountGate: {
        reserveSlot,
        blockUntil: vi.fn(),
        complete: vi.fn(),
      },
      now: () => NOW,
      deadlineMs: NOW.getTime() + 5_000,
    });

    await vi.advanceTimersByTimeAsync(5_500);
    await expect(stalledRead).resolves.toBeNull();
    expect(reserveSlot).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects without forwarding the API key to the target", async () => {
    vi.stubEnv("GMGN_API_KEY", "redirect-secret");
    const targetKeys: Array<string | string[] | undefined> = [];
    const redirectKeys: Array<string | string[] | undefined> = [];
    const target = createServer((request, response) => {
      targetKeys.push(request.headers["x-apikey"]);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(rankResponse([providerToken(17, 1)])));
    });
    const redirector = createServer((request, response) => {
      redirectKeys.push(request.headers["x-apikey"]);
      const targetAddress = target.address();
      if (targetAddress === null || typeof targetAddress === "string") {
        response.writeHead(500).end();
        return;
      }
      response.writeHead(302, {
        Location: `http://127.0.0.1:${targetAddress.port}/target`,
      });
      response.end();
    });
    const listen = (server: typeof target) => new Promise<void>(
      (resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      },
    );
    await listen(target);
    await listen(redirector);
    try {
      const redirectAddress = redirector.address();
      if (redirectAddress === null || typeof redirectAddress === "string") {
        throw new Error("redirect fixture unavailable");
      }
      const fetchImpl = vi.fn(async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ) => fetch(
        `http://127.0.0.1:${redirectAddress.port}/rank`,
        init,
      ));
      await expect(readGmgnEthereumTrendingV1({
        interval: "5m",
        limit: 17,
      }, {
        fetchImpl: fetchImpl as typeof fetch,
        now: () => NOW,
        deadlineMs: NOW.getTime() + 5_000,
      })).resolves.toBeNull();
      expect(redirectKeys).toEqual(["redirect-secret"]);
      expect(targetKeys).toEqual([]);
    } finally {
      await Promise.all([
        new Promise<void>((resolve) => redirector.close(() => resolve())),
        new Promise<void>((resolve) => target.close(() => resolve())),
      ]);
    }
  });

  it("publishes a shared 429 cooldown and performs no same-read retry", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-server-key");
    const { gate, reserveSlot, blockUntil, complete } = accountGate();
    let clockMs = NOW.getTime();
    const fetchImpl = vi.fn(async () => {
      // A relative Retry-After starts when the response is received, even when
      // the provider spent most of this request's timeout producing the 429.
      clockMs += 2_000;
      return new Response(JSON.stringify({
        code: 429,
        error: "RATE_LIMIT_EXCEEDED",
        reset_at: Math.floor(NOW.getTime() / 1_000),
        data: {},
      }), { status: 429, headers: { "Retry-After": "1" } });
    });

    await expect(readGmgnEthereumTrendingV1({
      interval: "5m",
      limit: 16,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => new Date(clockMs),
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: RESERVATION,
      blockedUntilMs: NOW.getTime() + 3_250,
      providerSignal: "http-429",
    });
    expect(complete).not.toHaveBeenCalled();

    await expect(readGmgnEthereumHotSearchesV1({
      interval: "6h",
      limit: 16,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => new Date(clockMs),
      deadlineMs: NOW.getTime() + 5_000,
    })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(reserveSlot).toHaveBeenCalledTimes(1);
  });

  it("keeps a timed-out 429 read pending for its fresh gate outcome budget", async () => {
    vi.useFakeTimers();
    const startedAt = new Date(NOW.getTime() + 10 * 60_000);
    vi.setSystemTime(startedAt);
    vi.stubEnv("GMGN_API_KEY", "test-server-key");

    let releaseBlock!: () => void;
    const blockDeferred = new Promise<Readonly<{
      blockedUntilMs: number;
      retryAfterMs: number;
    }>>((resolve) => {
      releaseBlock = () => resolve({
        blockedUntilMs: startedAt.getTime() + 3_749,
        retryAfterMs: 1_250,
      });
    });
    const reserveSlot = vi.fn(async () => RESERVATION);
    const blockUntil = vi.fn(() => blockDeferred);
    const complete = vi.fn(async () => undefined);
    const gate = {
      reserveSlot,
      blockUntil,
      complete,
    } satisfies GmgnAccountGateV1;
    let providerResponded = false;
    const fetchImpl = vi.fn(() => new Promise<Response>((resolve) => {
      setTimeout(() => {
        providerResponded = true;
        resolve(new Response(JSON.stringify({
          code: 429,
          error: "RATE_LIMIT_EXCEEDED",
          data: {},
        }), {
          status: 429,
          headers: { "Retry-After": "1" },
        }));
      }, 2_499);
    }));

    const publicRead = readGmgnEthereumTrendingV1({
      interval: "1m",
      limit: 98,
    }, {
      fetchImpl: fetchImpl as typeof fetch,
      accountGate: gate,
      now: () => new Date(),
      deadlineMs: startedAt.getTime() + 10_000,
    });
    let publicReadSettled = false;
    void publicRead.then(
      () => {
        publicReadSettled = true;
      },
      () => {
        publicReadSettled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_499);
    expect(providerResponded).toBe(true);
    expect(blockUntil).toHaveBeenCalledOnce();
    expect(blockUntil).toHaveBeenCalledWith({
      reservation: RESERVATION,
      blockedUntilMs: startedAt.getTime() + 3_749,
      providerSignal: "http-429",
    });
    expect(publicReadSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(publicReadSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_998);
    expect(publicReadSettled).toBe(false);
    expect(complete).not.toHaveBeenCalled();

    releaseBlock();
    await expect(publicRead).resolves.toBeNull();
    expect(publicReadSettled).toBe(true);
  });
});
