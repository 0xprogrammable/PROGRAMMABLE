import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreReadModel } from "../lib/onchain/types";
import type {
  MarketDataIdentityV1,
  TokenMarketDataV1,
} from "../lib/market-data/market-data-v1";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";
import { customGraphToken } from "./launch-stamp-surface-fixture";

const mocks = vi.hoisted(() => ({
  enrichTokensWithAlchemyPoolState: vi.fn(),
  readVerifiedOperationalMarketSnapshot: vi.fn(),
  withSameBlockEthUsdQuote: vi.fn(),
  getAlchemyOnchainDeployment: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
  readProductionCustomExploreDirectoryV1: vi.fn(),
  readExploreReferenceHeadWithinRouteBudget: vi.fn(),
  getOnchainDeployment: vi.fn(),
  readDurableExploreModel: vi.fn(),
  readBitqueryTokenMarketDataV1: vi.fn(),
  hydrateMissingCanonicalTokenSupplyV1: vi.fn(),
  safeAlchemyError: vi.fn((error) => error),
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  getAlchemyOnchainDeployment: mocks.getAlchemyOnchainDeployment,
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  safeAlchemyError: mocks.safeAlchemyError,
}));

vi.mock("../lib/alchemy/live-market.server", () => ({
  enrichTokensWithAlchemyPoolState: mocks.enrichTokensWithAlchemyPoolState,
  readVerifiedOperationalMarketSnapshot:
    mocks.readVerifiedOperationalMarketSnapshot,
  withSameBlockEthUsdQuote: mocks.withSameBlockEthUsdQuote,
  withoutUnboundEthUsdQuote: (snapshot: {
    ethUsdQuote?: unknown;
    [key: string]: unknown;
  }) => {
    const withoutQuote = { ...snapshot };
    delete withoutQuote.ethUsdQuote;
    return withoutQuote;
  },
}));

vi.mock("../lib/server/custom-launch/explore-directory-v1", () => ({
  readProductionCustomExploreDirectoryV1:
    mocks.readProductionCustomExploreDirectoryV1,
}));

vi.mock("../lib/explore-reference-head.server", () => ({
  readExploreReferenceHeadWithinRouteBudget:
    mocks.readExploreReferenceHeadWithinRouteBudget,
}));

vi.mock("../lib/onchain/config", () => ({
  getOnchainDeployment: mocks.getOnchainDeployment,
}));

vi.mock("../lib/onchain/durable-model", () => ({
  readDurableExploreModel: mocks.readDurableExploreModel,
}));

vi.mock("../lib/market-data/bitquery.server", () => ({
  readBitqueryTokenMarketDataV1: mocks.readBitqueryTokenMarketDataV1,
}));

vi.mock("../lib/market-data/canonical-token-supply.server", () => ({
  hydrateMissingCanonicalTokenSupplyV1:
    mocks.hydrateMissingCanonicalTokenSupplyV1,
}));

import {
  dedupeExploreEntriesV1,
  GET,
  paginateExploreEntriesV1,
} from "../app/api/explore/route";

const HOOK_ADDRESS =
  "0x3333333333333333333333333333333333333333" as const;
const MARKET_OBSERVATION_TIME = new Date().toISOString();

function token(index: number): LauncherToken {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  return {
    id: `1:${tokenAddress}`,
    name: `Token ${index}`,
    symbol: `T${index}`,
    tokenAddress,
    hookAddress: HOOK_ADDRESS,
    poolId: `0x${index.toString(16).padStart(64, "0")}`,
    launchedAt: `2026-07-${String(index).padStart(2, "0")}T00:00:00.000Z`,
    launchBlockNumber: String(25_626_490 + index),
    launchTransactionIndex: 0,
    launchLogIndex: 0,
    indexedMarketCapUsdWad: String(BigInt(index) * 10n ** 18n),
    indexedValuationBlockNumber: "25630000",
    totalSupplyRaw: "1000000000000000000000000000",
    tokenDecimals: 18,
    activeLiquidity: "1",
    links: [{ kind: "x", url: `https://x.com/token${index}` }],
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
  };
}

function bitqueryMarketData(
  identities: readonly MarketDataIdentityV1[],
  options: Readonly<{
    freshness?: "current" | "stale";
    generatedAt?: string;
    asOfTime?: string;
  }> = {},
): ReadonlyMap<string, TokenMarketDataV1> {
  const generatedAt = options.generatedAt ?? MARKET_OBSERVATION_TIME;
  const asOfTime = options.asOfTime ?? MARKET_OBSERVATION_TIME;
  return new Map(identities.map((identity) => {
    const value = (BigInt(identity.tokenAddress) * 10n ** 18n).toString();
    const priceUsdWad = (BigInt(identity.tokenAddress) * 10n ** 9n).toString();
    return [identity.tokenAddress, {
      schemaVersion: "programmable.market-data.v1",
      source: "bitquery",
      generatedAt,
      status: options.freshness === "stale" ? "stale" : "current",
      primaryPoolId: identity.poolId,
      pools: [{
        identity,
        source: "bitquery",
        status: options.freshness === "stale" ? "stale" : "current",
        quality: "complete",
        asOfTime,
        latestTrade: {
          transactionHash: `0x${"aa".repeat(32)}`,
          logIndex: 1,
          blockNumber: "25740000",
          time: asOfTime,
          tokenSide: "buy",
          priceUsdWad,
          priceUsdAsOfTime: asOfTime,
          priceUsdSource: "bitquery-token-price-index-v1",
          rawPriceUsdWad: priceUsdWad,
        },
        liquidity: {
          asOfTime,
          asOfBlock: "25740000",
          valueUsdWad: "100000000000000000000000",
          freshness: options.freshness ?? "current",
        },
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          valueUsdWad: value,
          fdvUsdWad: value,
          totalSupply: "1000000",
          asOfTime,
          freshness: options.freshness ?? "current",
        },
      }],
    } satisfies TokenMarketDataV1];
  }));
}

const snapshot = {
  chainId: 1,
  blockNumber: "25630000",
  blockHash: `0x${"55".repeat(32)}` as const,
  confirmations: 12,
};

function readyModel(): ExploreReadModel {
  return {
    status: "ready",
    tokens: Array.from({ length: 30 }, (_, index) => token(index + 1)),
    snapshot,
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

function orderedEntry(input: Readonly<{
  id: string;
  kind: "token" | "custom-project";
  block: string;
  transaction: number;
  log: number;
  chainId?: string;
  launchedAt?: string;
}>): ExploreEntry {
  const base = {
    exploreKind: input.kind,
    id: input.id,
    name: input.id,
    symbol: input.id,
    launchedAt: input.launchedAt ?? "2026-08-07T00:00:00.000Z",
    links: [],
  };
  if (input.kind === "token") {
    return {
      ...base,
      launchBlockNumber: input.block,
      launchTransactionIndex: input.transaction,
      launchLogIndex: input.log,
      launchCategoryProvenance: {
        schemaVersion: "programmable.explore-launch-category-provenance.v1",
        category: "classic",
        source: "canonical-launch-read-model",
        recordId: input.id,
        modelId: "classic",
        modelVersion: "classic-v3",
      },
    } as unknown as ExploreEntry;
  }
  return {
    ...base,
    chainId: input.chainId ?? "1",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "custom",
      source: "registry.custom-launched",
      blockNumber: input.block,
      transactionIndex: input.transaction,
      logIndex: input.log,
    },
  } as unknown as ExploreEntry;
}

describe("Explore API Bitquery market boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAlchemyExploreModel.mockResolvedValue(readyModel());
    mocks.readProductionCustomExploreDirectoryV1.mockResolvedValue([]);
    mocks.readExploreReferenceHeadWithinRouteBudget.mockResolvedValue({
      blockNumber: "25630005",
      blockHash: `0x${"77".repeat(32)}`,
      indexedAt: "2026-08-10T17:55:45.000Z",
      finality: "confirmed",
    });
    mocks.getOnchainDeployment.mockReturnValue({ status: "ready" });
    mocks.getAlchemyOnchainDeployment.mockReturnValue({
      status: "ready",
      rpcUrlSecondary: "https://secondary.example",
    });
    mocks.readVerifiedOperationalMarketSnapshot.mockResolvedValue(snapshot);
    mocks.withSameBlockEthUsdQuote.mockImplementation(
      async ({ snapshot: value }) => value,
    );
    mocks.enrichTokensWithAlchemyPoolState.mockImplementation(
      async ({ tokens }: { tokens: readonly LauncherToken[] }) => [...tokens],
    );
    mocks.readBitqueryTokenMarketDataV1.mockImplementation(
      async (identities: readonly MarketDataIdentityV1[]) =>
        bitqueryMarketData(identities),
    );
    mocks.hydrateMissingCanonicalTokenSupplyV1.mockImplementation(
      async (entries: readonly ExploreEntry[]) => [...entries],
    );
  });

  it("orders mixed Classic and Custom launches by canonical chain position", () => {
    const entries = [
      orderedEntry({
        id: "1:classic-log-8",
        kind: "token",
        block: "101",
        transaction: 5,
        log: 8,
      }),
      orderedEntry({
        id: "custom:older-block",
        kind: "custom-project",
        block: "100",
        transaction: 9,
        log: 9,
      }),
      orderedEntry({
        id: "custom:log-9",
        kind: "custom-project",
        block: "101",
        transaction: 5,
        log: 9,
      }),
      orderedEntry({
        id: "1:newest-block",
        kind: "token",
        block: "102",
        transaction: 0,
        log: 0,
      }),
      orderedEntry({
        id: "1:transaction-6",
        kind: "token",
        block: "101",
        transaction: 6,
        log: 0,
      }),
    ];
    const paginate = (sort: "newest" | "oldest") =>
      paginateExploreEntriesV1(entries, {
        page: 1,
        pageSize: entries.length,
        query: "",
        socials: null,
        sort,
        topThenNewest: false,
      }).tokens.map(({ id }) => id);

    const newest = [
      "1:newest-block",
      "1:transaction-6",
      "custom:log-9",
      "1:classic-log-8",
      "custom:older-block",
    ];
    expect(paginate("newest")).toEqual(newest);
    expect(paginate("oldest")).toEqual([...newest].reverse());
  });

  it("keeps mixed-chain ordering total and independent of input order", () => {
    const entries = [
      orderedEntry({
        id: "2:newer-time",
        kind: "token",
        block: "1",
        transaction: 0,
        log: 0,
        launchedAt: "2026-08-07T01:00:00.000Z",
      }),
      orderedEntry({
        id: "1:block-7",
        kind: "token",
        block: "7",
        transaction: 0,
        log: 0,
      }),
      orderedEntry({
        id: "custom:chain-1-block-6",
        kind: "custom-project",
        block: "6",
        transaction: 0,
        log: 0,
        chainId: "1",
      }),
      orderedEntry({
        id: "custom:chain-2-block-999",
        kind: "custom-project",
        block: "999",
        transaction: 0,
        log: 0,
        chainId: "2",
      }),
    ];
    const expected = [
      "2:newer-time",
      "1:block-7",
      "custom:chain-1-block-6",
      "custom:chain-2-block-999",
    ];
    const permutations = [
      entries,
      [...entries].reverse(),
      [entries[2], entries[0], entries[3], entries[1]],
      [entries[3], entries[1], entries[0], entries[2]],
    ];

    for (const candidates of permutations) {
      expect(
        paginateExploreEntriesV1(candidates, {
          page: 1,
          pageSize: candidates.length,
          query: "",
          socials: null,
          sort: "newest",
          topThenNewest: false,
        }).tokens.map(({ id }) => id),
      ).toEqual(expected);
    }
  });

  it("ranks only current USD FDV and uses newest order for stale or other currencies", () => {
    const valued = (
      entry: ExploreEntry,
      valuation: Readonly<{
        currency: "usd" | "eth" | "quote";
        valueWad: string;
        freshness: "current" | "stale" | "unknown";
      }>,
    ) => ({
      ...entry,
      valuation: {
        status: "available" as const,
        metric: "fdv" as const,
        supplyBasis: "total" as const,
        ...valuation,
      },
    });
    const entries = [
      valued(orderedEntry({
        id: "1:usd-high",
        kind: "token",
        block: "100",
        transaction: 0,
        log: 0,
      }), { currency: "usd", valueWad: "20", freshness: "current" }),
      valued(orderedEntry({
        id: "1:usd-low",
        kind: "token",
        block: "99",
        transaction: 0,
        log: 0,
      }), { currency: "usd", valueWad: "10", freshness: "current" }),
      valued(orderedEntry({
        id: "1:stale-usd",
        kind: "token",
        block: "105",
        transaction: 0,
        log: 0,
      }), { currency: "usd", valueWad: "999999", freshness: "stale" }),
      valued(orderedEntry({
        id: "1:eth",
        kind: "token",
        block: "104",
        transaction: 0,
        log: 0,
      }), { currency: "eth", valueWad: "1", freshness: "current" }),
      valued(orderedEntry({
        id: "1:quote",
        kind: "token",
        block: "103",
        transaction: 0,
        log: 0,
      }), { currency: "quote", valueWad: "500000", freshness: "current" }),
    ];
    const paginate = (sort: "market-cap" | "market-cap-asc") =>
      paginateExploreEntriesV1(entries, {
        page: 1,
        pageSize: entries.length,
        query: "",
        socials: null,
        sort,
        topThenNewest: false,
      }).tokens.map(({ id }) => id);

    expect(paginate("market-cap")).toEqual([
      "1:usd-high",
      "1:usd-low",
      "1:stale-usd",
      "1:eth",
      "1:quote",
    ]);
    expect(paginate("market-cap-asc")).toEqual([
      "1:usd-low",
      "1:usd-high",
      "1:stale-usd",
      "1:eth",
      "1:quote",
    ]);
  });

  it("deduplicates exact canonical records but fails closed on conflicts", () => {
    const entry = orderedEntry({
      id: "1:duplicate",
      kind: "token",
      block: "101",
      transaction: 0,
      log: 0,
    });

    expect(dedupeExploreEntriesV1([entry, { ...entry }])).toEqual([entry]);
    expect(() =>
      dedupeExploreEntriesV1([
        entry,
        { ...entry, name: "Conflicting name" },
      ]),
    ).toThrow("Canonical Explore sources disagree");
  });

  it.each([
    "unused=random",
    "page=1&page=2",
    "q=token&q=other",
    "sort=newest&extra=1",
    "socials=maybe",
  ])("rejects non-canonical query shapes before identity or market reads: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore?${query}`),
    );

    expect(response.status).toBe(400);
    expect(mocks.readAlchemyExploreModel).not.toHaveBeenCalled();
  });

  it("fails closed when the canonical source and durable fallback are unavailable", async () => {
    mocks.readAlchemyExploreModel.mockRejectedValue(
      new Error("canonical source unavailable"),
    );
    mocks.readDurableExploreModel.mockRejectedValue(
      new Error("durable source unavailable"),
    );
    mocks.readProductionCustomExploreDirectoryV1.mockResolvedValue([]);
    vi.resetModules();
    const { GET: coldGet } = await import("../app/api/explore/route");

    const response = await coldGet(
      new NextRequest("http://localhost/api/explore?sort=newest"),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      status: "unavailable",
      error: "Launch data is temporarily unavailable",
      retryable: true,
      dataQuality: {
        status: "partial",
        launchIdentity: {
          status: "partial",
          canonical: "unavailable",
          custom: "current",
        },
      },
    });
    expect(body).not.toHaveProperty("tokens");
    expect(body).not.toHaveProperty("launcherFeesAccruedWei");
    expect(body).not.toHaveProperty("launcherFeesAccruedEth");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Programmable-Price-Source")).toBeNull();
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "partial+registry.custom-launched",
    );
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "postgres",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBeNull();
    expect(response.headers.get("X-Programmable-Price-Source")).toBeNull();
  });

  it("keeps the top 20 by FDV first, then appends every remaining coin newest", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/explore?sort=highest-market-cap&page=1&limit=100",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      page: 1,
      pageSize: 100,
      total: 30,
      totalPages: 1,
      sort: "market-cap",
      sortMetric: "fdv",
      dataQuality: {
        schemaVersion: "programmable.explore-data-quality.v1",
        status: "complete",
        launchIdentity: {
          status: "current",
          canonical: "current",
          custom: "current",
          asOfBlock: "25630000",
          referenceBlock: "25630005",
          lagBlocks: "5",
        },
        valuation: {
          status: "current",
          metric: "fdv",
          available: 30,
          unavailable: 0,
          stale: 0,
          unknown: 0,
          asOfBlock: null,
          asOfTime: MARKET_OBSERVATION_TIME,
        },
      },
    });
    expect(body.tokens[0].valuation).toMatchObject({
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      currency: "usd",
      freshness: "current",
      source: "bitquery",
      asOfTime: MARKET_OBSERVATION_TIME,
    });
    expect(body.tokens[0].fdvUsdWad).toBe(
      body.tokens[0].valuation.valueWad,
    );
    for (const field of [
      "marketCapEth",
      "marketCapEthWei",
      "indexedMarketCapEth",
      "indexedMarketCapEthWei",
      "indexedMarketCapUsdWad",
      "marketCapQuote",
      "marketCapQuoteWad",
    ]) {
      expect(body.tokens[0]).not.toHaveProperty(field);
    }
    const symbols = body.tokens.map(
      (candidate: LauncherToken) => candidate.symbol,
    );
    expect(symbols.slice(0, 20)).toEqual(
      Array.from({ length: 20 }, (_, index) => `T${30 - index}`),
    );
    expect(symbols.slice(20)).toEqual(
      Array.from({ length: 10 }, (_, index) => `T${10 - index}`),
    );
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "operational+durable+postgres",
    );
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "operational+durable+registry.custom-launched",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBeNull();
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("X-Programmable-Data-Quality")).toBe(
      "complete",
    );
    expect(response.headers.get("X-Programmable-Market-Source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
    );
    expect(mocks.readBitqueryTokenMarketDataV1).toHaveBeenCalledTimes(1);
    expect(
      mocks.readBitqueryTokenMarketDataV1.mock.calls[0]?.[0],
    ).toHaveLength(30);
  });

  it.each([
    ["newest", [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]],
    ["oldest", [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]],
  ] as const)(
    "values only the requested identity page for %s ordering",
    async (sort, expectedIndexes) => {
      const response = await GET(
        new NextRequest(
          `http://localhost/api/explore?sort=${sort}&page=3&limit=10`,
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "ready",
        page: 3,
        pageSize: 10,
        total: 30,
        totalPages: 3,
      });
      expect(body.tokens.map((entry: LauncherToken) => entry.symbol)).toEqual(
        expectedIndexes.map((index) => `T${index}`),
      );
      expect(mocks.hydrateMissingCanonicalTokenSupplyV1).toHaveBeenCalledTimes(1);
      expect(
        mocks.hydrateMissingCanonicalTokenSupplyV1.mock.calls[0]?.[0],
      ).toHaveLength(10);
      expect(mocks.readBitqueryTokenMarketDataV1).toHaveBeenCalledTimes(1);
      expect(
        mocks.readBitqueryTokenMarketDataV1.mock.calls[0]?.[0],
      ).toHaveLength(10);
    },
  );

  it("briefly edge caches explicitly stale market data", async () => {
    mocks.readBitqueryTokenMarketDataV1.mockImplementation(
      async (identities: readonly MarketDataIdentityV1[]) =>
        bitqueryMarketData(identities, { freshness: "stale" }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/explore?sort=market-cap"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.dataQuality).toMatchObject({
      status: "stale",
      valuation: { status: "stale", stale: 30 },
    });
    expect(response.headers.get("X-Programmable-Data-Quality")).toBe("stale");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
    );
  });

  it("removes public FDV when a fresh response contains a trade older than 24 hours", async () => {
    const generatedAt = new Date().toISOString();
    const asOfTime = new Date(
      Date.now() - 24 * 60 * 60_000 - 1,
    ).toISOString();
    mocks.readBitqueryTokenMarketDataV1.mockImplementation(
      async (identities: readonly MarketDataIdentityV1[]) =>
        bitqueryMarketData(identities, {
          freshness: "stale",
          generatedAt,
          asOfTime,
        }),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/explore?sort=market-cap&limit=100"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tokens).toHaveLength(30);
    expect(body.tokens.every((entry: {
      fdvUsdWad?: string;
      valuation: { status: string; reason?: string };
      marketData?: {
        pools?: Array<{
          valuation?: { status?: string; reason?: string };
        }>;
      };
    }) => {
      const poolValuation = entry.marketData?.pools?.[0]?.valuation;
      return entry.fdvUsdWad === undefined &&
        entry.valuation.status === "unavailable" &&
        entry.valuation.reason === "price-unavailable" &&
        poolValuation?.status === "unavailable" &&
        poolValuation.reason === "price-unavailable";
    })).toBe(true);
    expect(body.dataQuality.valuation).toMatchObject({
      status: "unavailable",
      available: 0,
      unavailable: 30,
    });
  });

  it("binds current FDV to Bitquery time instead of the lagging identity snapshot", async () => {
    const staleModelSnapshot = {
      ...snapshot,
      blockNumber: "25628000",
      blockHash: `0x${"88".repeat(32)}` as const,
    };
    const operationalSnapshot = {
      ...snapshot,
      blockNumber: "25632000",
      blockHash: `0x${"99".repeat(32)}` as const,
    };
    mocks.readAlchemyExploreModel.mockResolvedValue({
      ...readyModel(),
      snapshot: staleModelSnapshot,
      launchDiscoverySnapshot: staleModelSnapshot,
    });
    mocks.readVerifiedOperationalMarketSnapshot.mockResolvedValue(
      operationalSnapshot,
    );
    mocks.readExploreReferenceHeadWithinRouteBudget.mockResolvedValue({
      blockNumber: operationalSnapshot.blockNumber,
      blockHash: operationalSnapshot.blockHash,
      indexedAt: "2026-08-10T18:00:00.000Z",
      finality: "confirmed",
    });
    mocks.enrichTokensWithAlchemyPoolState.mockImplementation(
      async ({ snapshot: readSnapshot, tokens }: {
        snapshot: typeof operationalSnapshot;
        tokens: readonly LauncherToken[];
      }) => tokens.map((candidate) => {
        const identity = { ...candidate };
        delete identity.indexedMarketCapUsdWad;
        delete identity.indexedMarketCapEthWei;
        delete identity.indexedMarketCapEth;
        delete identity.marketCapEthWei;
        delete identity.marketCapEth;
        return {
          ...identity,
          indexedValuationBlockNumber: readSnapshot.blockNumber,
          fdvUsdWad: String(BigInt(candidate.symbol.slice(1)) * 10n ** 20n),
        };
      }),
    );

    const response = await GET(
      new NextRequest(
        "http://localhost/api/explore?sort=market-cap&page=1&limit=100",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.withSameBlockEthUsdQuote).not.toHaveBeenCalled();
    expect(mocks.enrichTokensWithAlchemyPoolState).not.toHaveBeenCalled();
    expect(body.tokens[0].valuation).toMatchObject({
      status: "available",
      freshness: "current",
      source: "bitquery",
      asOfTime: MARKET_OBSERVATION_TIME,
    });
    expect(body.dataQuality).toMatchObject({
      launchIdentity: {
        asOfBlock: staleModelSnapshot.blockNumber,
        referenceBlock: operationalSnapshot.blockNumber,
      },
      valuation: {
        status: "current",
        asOfBlock: null,
        asOfTime: MARKET_OBSERVATION_TIME,
      },
    });
  });

  it("serves a finalized Router Custom Graph as a canonical Custom token", async () => {
    mocks.readAlchemyExploreModel.mockResolvedValue({
      ...readyModel(),
      tokens: [customGraphToken],
    });
    const response = await GET(
      new NextRequest("http://localhost/api/explore?sort=newest"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({
      exploreKind: "token",
      tokenAddress: customGraphToken.tokenAddress,
      launchModel: "custom-graph",
      totalSwapFeeBps: null,
      liquidityPath: "programmable-v4",
      launchCategoryProvenance: {
        category: "custom",
        source: "canonical-launch-stamp-router",
        launchId: customGraphToken.launchStampProvenance.launchId,
        stampHash: customGraphToken.launchStampProvenance.stampHash,
      },
      launchStampProvenance: customGraphToken.launchStampProvenance,
    });
  });

  it("retains canonical identities when the Custom directory is temporarily unavailable", async () => {
    mocks.readProductionCustomExploreDirectoryV1.mockRejectedValue(
      new Error("custom directory unavailable"),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/explore?sort=newest&limit=100"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(30);
    expect(body.dataQuality).toMatchObject({
      status: "stale",
      launchIdentity: {
        canonical: "current",
        custom: "last-known-good",
        status: "last-known-good",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("scopes an exact token search to the matching Bitquery market", async () => {
    const target = token(30);
    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore?q=${target.tokenAddress}&sort=market-cap`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.tokens).toHaveLength(1);
    expect(body.tokens[0]).toMatchObject({
      tokenAddress: target.tokenAddress,
      valuation: {
        status: "available",
        source: "bitquery",
      },
    });
    expect(mocks.readBitqueryTokenMarketDataV1).toHaveBeenCalledTimes(1);
    const identities = mocks.readBitqueryTokenMarketDataV1.mock.calls[0]?.[0];
    expect(identities).toHaveLength(1);
    expect(identities?.[0]).toEqual({
      chainId: "1",
      tokenAddress: target.tokenAddress,
      poolId: target.poolId,
      protocol: "uniswap_v4",
    });
  });

  it("keeps canonical launches visible with unavailable valuation when Bitquery is down", async () => {
    mocks.enrichTokensWithAlchemyPoolState.mockRejectedValue(
      new Error("provider unavailable"),
    );
    mocks.readBitqueryTokenMarketDataV1.mockResolvedValue(new Map());
    mocks.readExploreReferenceHeadWithinRouteBudget.mockResolvedValue({
      blockNumber: "25630100",
      blockHash: `0x${"88".repeat(32)}`,
      indexedAt: "2026-08-10T18:00:00.000Z",
      finality: "confirmed",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/explore?sort=market-cap&limit=100"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(30);
    expect(body.tokens).toHaveLength(30);
    expect(body.tokens.every((entry: {
      valuation: { status: string; reason?: string };
    }) => entry.valuation.status === "unavailable" &&
      entry.valuation.reason === "source-unavailable")).toBe(true);
    expect(body.dataQuality).toMatchObject({
      status: "stale",
      valuation: { status: "unavailable", unavailable: 30 },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("uses the bounded durable model as last known good when the primary read fails", async () => {
    mocks.readAlchemyExploreModel.mockRejectedValue(
      new Error("primary unavailable"),
    );
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "ready",
      envelope: { payload: { model: readyModel() } },
      ageMs: 1_000,
    });

    const response = await GET(
      new NextRequest("http://localhost/api/explore?sort=newest&limit=100"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.total).toBe(30);
    expect(body.dataQuality).toMatchObject({
      status: "stale",
      launchIdentity: {
        status: "last-known-good",
        canonical: "last-known-good",
      },
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "durable+postgres",
    );
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "durable+registry.custom-launched",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBeNull();
  });

  it.each([
    ["lowest FDV", "sort=lowest-market-cap&page=3&limit=10"],
    ["social filter", "socials=yes&page=3&limit=10"],
    ["search", "q=token&page=3&limit=10"],
  ])("keeps all matching tokens paginated for %s", async (_label, query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore?${query}`),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      page: 3,
      pageSize: 10,
      total: 30,
      totalPages: 3,
    });
    expect(body.tokens).toHaveLength(10);
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "operational+durable+postgres",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBeNull();
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "bitquery",
    );
  });
});
