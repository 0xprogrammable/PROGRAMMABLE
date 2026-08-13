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
  getWebsiteReadOnchainDeployment: vi.fn(),
  readDurableExploreModel: vi.fn(),
  readBitqueryTokenMarketDataV1: vi.fn(),
  currentMarketOnchainDeployment: vi.fn(),
  hydrateMissingCanonicalTokenSupplyV1: vi.fn(),
  attachBitqueryMarketDataToValuedEntries: vi.fn(),
  valueExploreEntriesWithCurrentEvidence: vi.fn(),
  valueExploreEntriesWithCurrentEvidenceSnapshot: vi.fn(),
  settleCurrentEvidenceSnapshot: vi.fn(),
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
  getWebsiteReadOnchainDeployment: mocks.getWebsiteReadOnchainDeployment,
}));

vi.mock("../lib/onchain/durable-model", () => ({
  readDurableExploreModel: mocks.readDurableExploreModel,
}));

vi.mock("../lib/market-data/bitquery.server", () => ({
  readBitqueryTokenMarketDataV1: mocks.readBitqueryTokenMarketDataV1,
}));

vi.mock("../lib/market-data/current-market-rpc.server", () => ({
  currentMarketOnchainDeployment:
    mocks.currentMarketOnchainDeployment,
}));

vi.mock("../lib/market-data/canonical-token-supply.server", () => ({
  hydrateMissingCanonicalTokenSupplyV1:
    mocks.hydrateMissingCanonicalTokenSupplyV1,
}));

vi.mock("../lib/market-data/current-valuation.server", () => ({
  CURRENT_EVIDENCE_ROUTE_DEADLINE_MS: 4_500,
  attachBitqueryMarketDataToValuedEntries:
    mocks.attachBitqueryMarketDataToValuedEntries,
  settleCurrentEvidenceSnapshot: mocks.settleCurrentEvidenceSnapshot,
  valueExploreEntriesWithCurrentEvidence:
    mocks.valueExploreEntriesWithCurrentEvidence,
  valueExploreEntriesWithCurrentEvidenceSnapshot:
    mocks.valueExploreEntriesWithCurrentEvidenceSnapshot,
}));

import {
  valuationSortValue,
  withBitqueryMarketData,
  type ValuedExploreEntry,
} from "../lib/explore-financial-data";

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
const liquiditySnapshot = {
  chainId: 1 as const,
  blockNumber: "25629999",
  blockHash: `0x${"44".repeat(32)}` as const,
};

type ValuationSnapshotBody = Readonly<{
  schemaVersion: "programmable.explore-valuation-snapshot.v1";
  chainId: 1;
  blockNumber: string;
  blockHash: string;
  liquidityBlockNumber: string;
  liquidityBlockHash: string;
  rankingCommitment: string;
  sort: "market-cap" | "market-cap-asc";
  query: string;
  socials: "yes" | "no" | null;
  pageSize: number;
}>;

function valuationReplayQuery(
  valuationSnapshot: ValuationSnapshotBody,
  input: Readonly<{ page: number; limit: number; sort?: string }>,
) {
  return new URLSearchParams({
    sort: input.sort ?? valuationSnapshot.sort,
    page: String(input.page),
    limit: String(input.limit),
    valuationBlock: valuationSnapshot.blockNumber,
    valuationBlockHash: valuationSnapshot.blockHash,
    liquidityBlock: valuationSnapshot.liquidityBlockNumber,
    liquidityBlockHash: valuationSnapshot.liquidityBlockHash,
    rankingCommitment: valuationSnapshot.rankingCommitment,
  }).toString();
}

function fixedValuationReplayQuery(
  overrides: Readonly<Record<string, string>> = {},
) {
  return new URLSearchParams({
    sort: "market-cap",
    page: "2",
    limit: "10",
    valuationBlock: snapshot.blockNumber,
    valuationBlockHash: snapshot.blockHash,
    liquidityBlock: liquiditySnapshot.blockNumber,
    liquidityBlockHash: liquiditySnapshot.blockHash,
    rankingCommitment: `sha256:${"aa".repeat(32)}`,
    ...overrides,
  }).toString();
}

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
    mocks.getWebsiteReadOnchainDeployment.mockReturnValue({ status: "ready" });
    mocks.getAlchemyOnchainDeployment.mockReturnValue({
      status: "ready",
      rpcUrlSecondary: "https://secondary.example",
    });
    mocks.currentMarketOnchainDeployment.mockReturnValue({
      status: "ready",
      rpcUrl: "https://current-primary.example",
      rpcUrlSecondary: "https://current-secondary.example",
    });
    mocks.readVerifiedOperationalMarketSnapshot.mockImplementation(
      async (_deployment, expected?: {
        blockNumber: string;
        blockHash: `0x${string}`;
      }) => expected
        ? {
            ...snapshot,
            blockNumber: expected.blockNumber,
            blockHash: expected.blockHash,
          }
        : snapshot,
    );
    mocks.settleCurrentEvidenceSnapshot.mockImplementation(
      async ({
        read,
        signal,
      }: {
        read: (signal: AbortSignal) => Promise<unknown>;
        signal?: AbortSignal;
      }) => await read(signal ?? new AbortController().signal),
    );
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
    mocks.attachBitqueryMarketDataToValuedEntries.mockImplementation(
      async ({
        entries,
        marketByToken,
        maximumValuationAgeMs,
        now,
      }: {
        entries: readonly ValuedExploreEntry[];
        marketByToken: Promise<ReadonlyMap<string, TokenMarketDataV1>>;
        maximumValuationAgeMs?: number;
        now?: Date;
      }) => {
        const markets = await marketByToken;
        return entries.map((entry) => {
          const market = entry.tokenAddress
            ? markets.get(entry.tokenAddress.toLowerCase())
            : undefined;
          if (!market) {
            return entry.valuation.status === "available" &&
                entry.valuation.source === "bitquery"
              ? {
                  ...entry,
                  valuation: {
                    status: "unavailable" as const,
                    reason: "source-unavailable" as const,
                  },
                }
              : entry;
          }
          const withMarketData = withBitqueryMarketData(entry, market, {
            maximumValuationAgeMs,
            now,
          });
          return entry.valuation.status === "available" &&
              entry.valuation.source !== "bitquery"
            ? { ...withMarketData, valuation: entry.valuation }
            : withMarketData;
        });
      },
    );
    mocks.valueExploreEntriesWithCurrentEvidence.mockImplementation(
      async ({
        entries,
        marketByToken,
        maximumValuationAgeMs,
        now,
      }: {
        entries: readonly ExploreEntry[];
        marketByToken: Promise<ReadonlyMap<string, TokenMarketDataV1>>;
        maximumValuationAgeMs?: number;
        now?: Date;
      }) => {
        const receivedMarkets = await marketByToken;
        const markets = receivedMarkets.size > 0
          ? receivedMarkets
          : bitqueryMarketData(entries.flatMap((entry) =>
              entry.exploreKind === "token"
                ? [{
                    chainId: "1" as const,
                    tokenAddress: entry.tokenAddress,
                    poolId: entry.poolId,
                    quoteAddress:
                      "0x0000000000000000000000000000000000000000" as const,
                    protocol: "uniswap_v4" as const,
                  }]
                : []
            ));
        return entries.map((entry) => {
          const market = entry.tokenAddress
            ? markets.get(entry.tokenAddress.toLowerCase())
            : undefined;
          return market
            ? withBitqueryMarketData(entry, market, {
                maximumValuationAgeMs,
                now,
              })
            : {
                ...entry,
                valuation: {
                  status: "unavailable" as const,
                  reason: "source-unavailable" as const,
                },
              };
        });
      },
    );
    mocks.valueExploreEntriesWithCurrentEvidenceSnapshot.mockImplementation(
      async (input: Parameters<
        typeof mocks.valueExploreEntriesWithCurrentEvidence
      >[0]) => ({
        entries: await mocks.valueExploreEntriesWithCurrentEvidence({
          ...input,
          requireCompleteLiquidityCoverage: true,
        }),
        liquiditySnapshot: input.liquiditySnapshot ?? liquiditySnapshot,
      }),
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

  it("keeps explicit market-cap pagination globally monotonic beyond 20 entries", () => {
    const entries = Array.from({ length: 25 }, (_, index) => ({
      ...orderedEntry({
        id: `1:global-${index}`,
        kind: "token",
        block: String(1_000 + index),
        transaction: 0,
        log: 0,
      }),
      valuation: {
        status: "available" as const,
        metric: "fdv" as const,
        supplyBasis: "total" as const,
        currency: "usd" as const,
        valueWad: String((index * 17) % 25 + 1),
        freshness: "current" as const,
        source: "stateview-chainlink" as const,
      },
    }));
    const pages = [1, 2, 3].flatMap((page) =>
      paginateExploreEntriesV1(entries, {
        page,
        pageSize: 10,
        query: "",
        socials: null,
        sort: "market-cap",
      }).tokens,
    );
    const values = pages.map((entry) => valuationSortValue(entry)!);

    expect(new Set(pages.map(({ id }) => id)).size).toBe(25);
    expect(values).toEqual([...values].sort((left, right) =>
      left === right ? 0 : left > right ? -1 : 1));
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
    "page=02",
    "page=0",
    "limit=00",
  ])("rejects non-canonical query shapes before identity or market reads: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore?${query}`),
    );

    expect(response.status).toBe(400);
    expect(mocks.readAlchemyExploreModel).not.toHaveBeenCalled();
  });

  it.each([
    `sort=market-cap&page=2&valuationBlock=${snapshot.blockNumber}`,
    `sort=market-cap&page=2&valuationBlockHash=${snapshot.blockHash}`,
    `sort=market-cap&page=2&rankingCommitment=sha256:${"aa".repeat(32)}`,
    `sort=market-cap&page=1&valuationBlock=${snapshot.blockNumber}` +
      `&valuationBlockHash=${snapshot.blockHash}` +
      `&rankingCommitment=sha256:${"aa".repeat(32)}`,
    `sort=newest&page=2&valuationBlock=${snapshot.blockNumber}` +
      `&valuationBlockHash=${snapshot.blockHash}` +
      `&rankingCommitment=sha256:${"aa".repeat(32)}`,
    fixedValuationReplayQuery({ valuationBlock: "1".repeat(79) }),
    fixedValuationReplayQuery({ liquidityBlock: "2147483648" }),
    fixedValuationReplayQuery({
      liquidityBlock: "none",
      liquidityBlockHash: liquiditySnapshot.blockHash,
    }),
  ])("rejects incomplete or inapplicable valuation snapshots: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore?${query}`),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.readAlchemyExploreModel).not.toHaveBeenCalled();
    expect(mocks.readVerifiedOperationalMarketSnapshot).not.toHaveBeenCalled();
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
    expect(mocks.currentMarketOnchainDeployment).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ready",
      }),
    );
    expect(mocks.getAlchemyOnchainDeployment).not.toHaveBeenCalled();
    expect(mocks.readVerifiedOperationalMarketSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        rpcUrl: "https://current-primary.example",
        rpcUrlSecondary: "https://current-secondary.example",
      }),
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.valueExploreEntriesWithCurrentEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment: expect.objectContaining({
          rpcUrl: "https://current-primary.example",
          rpcUrlSecondary: "https://current-secondary.example",
        }),
      }),
    );
    expect(body).toMatchObject({
      status: "ready",
      page: 1,
      pageSize: 100,
      total: 30,
      totalPages: 1,
      sort: "market-cap",
      sortMetric: "fdv",
      valuationSnapshot: {
        schemaVersion: "programmable.explore-valuation-snapshot.v1",
        chainId: 1,
        blockNumber: snapshot.blockNumber,
        blockHash: snapshot.blockHash,
        liquidityBlockNumber: liquiditySnapshot.blockNumber,
        liquidityBlockHash: liquiditySnapshot.blockHash,
        rankingCommitment: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        sort: "market-cap",
        query: "",
        socials: null,
        pageSize: 100,
      },
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
    expect(body.tokens[0]).not.toHaveProperty("fdvUsdWad");
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

  it("starts the current-evidence budget after identity reads settle", async () => {
    let resolveCanonical!: (model: ExploreReadModel) => void;
    mocks.readAlchemyExploreModel.mockReturnValueOnce(
      new Promise<ExploreReadModel>((resolve) => {
        resolveCanonical = resolve;
      }),
    );

    const responseRead = GET(
      new NextRequest("http://localhost/api/explore?sort=market-cap"),
    );
    await vi.waitFor(() => {
      expect(mocks.readAlchemyExploreModel).toHaveBeenCalledOnce();
    });
    expect(mocks.settleCurrentEvidenceSnapshot).not.toHaveBeenCalled();
    expect(
      mocks.valueExploreEntriesWithCurrentEvidenceSnapshot,
    ).not.toHaveBeenCalled();

    resolveCanonical(readyModel());
    const response = await responseRead;

    expect(response.status).toBe(200);
    expect(mocks.settleCurrentEvidenceSnapshot).toHaveBeenCalledOnce();
    expect(
      mocks.valueExploreEntriesWithCurrentEvidenceSnapshot,
    ).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: expect.any(Number),
    }));
    const timeoutMs =
      mocks.valueExploreEntriesWithCurrentEvidenceSnapshot.mock.calls[0]?.[0]
        .timeoutMs;
    expect(timeoutMs).toBeGreaterThan(0);
    expect(timeoutMs).toBeLessThanOrEqual(4_500);
  });

  it("replays later market-cap pages against the exact first-page ranking", async () => {
    const firstResponse = await GET(new NextRequest(
      "http://localhost/api/explore?sort=market-cap&page=1&limit=10",
    ));
    const firstBody = await firstResponse.json();
    const valuationSnapshot = firstBody.valuationSnapshot as
      ValuationSnapshotBody;

    const secondResponse = await GET(new NextRequest(
      `http://localhost/api/explore?${valuationReplayQuery(
        valuationSnapshot,
        { page: 2, limit: 10 },
      )}`,
    ));
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(secondBody).toMatchObject({
      page: 2,
      total: 30,
      totalPages: 3,
      valuationSnapshot,
    });
    expect(mocks.readVerifiedOperationalMarketSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rpcUrl: "https://current-primary.example",
        rpcUrlSecondary: "https://current-secondary.example",
      }),
      {
        blockNumber: valuationSnapshot.blockNumber,
        blockHash: valuationSnapshot.blockHash,
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.hydrateMissingCanonicalTokenSupplyV1).toHaveBeenLastCalledWith(
      expect.any(Array),
      {
        deployment: expect.objectContaining({
          rpcUrl: "https://current-primary.example",
          rpcUrlSecondary: "https://current-secondary.example",
        }),
        snapshot: {
          blockNumber: valuationSnapshot.blockNumber,
          blockHash: valuationSnapshot.blockHash,
        },
      },
    );
    const ids = [...firstBody.tokens, ...secondBody.tokens].map(
      (entry: { id: string }) => entry.id,
    );
    expect(new Set(ids).size).toBe(20);
  });

  it("returns and replays the explicit-none liquidity mode", async () => {
    mocks.valueExploreEntriesWithCurrentEvidenceSnapshot.mockImplementation(
      async (input: Parameters<
        typeof mocks.valueExploreEntriesWithCurrentEvidence
      >[0]) => ({
        entries: await mocks.valueExploreEntriesWithCurrentEvidence({
          ...input,
          requireCompleteLiquidityCoverage: true,
        }),
        liquiditySnapshot: input.liquiditySnapshot ?? {
          chainId: 1,
          blockNumber: "none",
          blockHash: "none",
        },
      }),
    );
    const firstResponse = await GET(new NextRequest(
      "http://localhost/api/explore?sort=market-cap&page=1&limit=10",
    ));
    const firstBody = await firstResponse.json();
    const valuationSnapshot = firstBody.valuationSnapshot as
      ValuationSnapshotBody;
    const secondResponse = await GET(new NextRequest(
      `http://localhost/api/explore?${valuationReplayQuery(
        valuationSnapshot,
        { page: 2, limit: 10 },
      )}`,
    ));
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(valuationSnapshot).toMatchObject({
      liquidityBlockNumber: "none",
      liquidityBlockHash: "none",
    });
    expect(secondBody.valuationSnapshot).toEqual(valuationSnapshot);
    expect(
      mocks.valueExploreEntriesWithCurrentEvidenceSnapshot.mock.calls[1]?.[0],
    ).toMatchObject({
      liquiditySnapshot: {
        chainId: 1,
        blockNumber: "none",
        blockHash: "none",
      },
    });
  });

  it.each([
    ["adds", (tokens: LauncherToken[]) => [...tokens, token(31)]],
    ["removes", (tokens: LauncherToken[]) => tokens.slice(0, -1)],
    ["changes", (tokens: LauncherToken[]) => tokens.map((entry, index) =>
      index === 0
        ? { ...entry, launchedAt: "2026-08-01T12:34:56.000Z" }
        : entry)],
  ] as const)("fails closed before Bitquery when identity projection %s", async (
    _label,
    mutate,
  ) => {
    const firstResponse = await GET(new NextRequest(
      "http://localhost/api/explore?sort=market-cap&page=1&limit=10",
    ));
    const firstBody = await firstResponse.json();
    const valuationSnapshot = firstBody.valuationSnapshot as
      ValuationSnapshotBody;
    const nextModel = readyModel();
    mocks.readAlchemyExploreModel.mockResolvedValue({
      ...nextModel,
      tokens: mutate([...nextModel.tokens]),
    });
    mocks.readBitqueryTokenMarketDataV1.mockClear();

    const response = await GET(new NextRequest(
      `http://localhost/api/explore?${valuationReplayQuery(
        valuationSnapshot,
        { page: 2, limit: 10 },
      )}`,
    ));

    expect(firstResponse.status).toBe(200);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.readBitqueryTokenMarketDataV1).not.toHaveBeenCalled();
  });

  it("rejects a replay page beyond the recomputed snapshot before Bitquery", async () => {
    const firstResponse = await GET(new NextRequest(
      "http://localhost/api/explore?sort=market-cap&page=1&limit=10",
    ));
    const firstBody = await firstResponse.json();
    const valuationSnapshot = firstBody.valuationSnapshot as
      ValuationSnapshotBody;
    mocks.readBitqueryTokenMarketDataV1.mockClear();

    const response = await GET(new NextRequest(
      `http://localhost/api/explore?${valuationReplayQuery(
        valuationSnapshot,
        { page: 4, limit: 10 },
      )}`,
    ));

    expect(firstResponse.status).toBe(200);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.readBitqueryTokenMarketDataV1).not.toHaveBeenCalled();
  });

  it.each([
    ["block hash", { blockHash: `0x${"66".repeat(32)}` }],
    ["block number", { blockNumber: "25629999" }],
    ["liquidity block hash", {
      liquidityBlockHash: `0x${"77".repeat(32)}`,
    }],
    ["liquidity block number", { liquidityBlockNumber: "25629998" }],
    ["ranking commitment", {
      rankingCommitment: `sha256:${"aa".repeat(32)}`,
    }],
  ] as const)("fails closed when replay %s is mutated", async (_label, mutation) => {
    const firstResponse = await GET(new NextRequest(
      "http://localhost/api/explore?sort=market-cap&page=1&limit=10",
    ));
    const firstBody = await firstResponse.json();
    const valuationSnapshot = {
      ...(firstBody.valuationSnapshot as ValuationSnapshotBody),
      ...mutation,
    };

    const response = await GET(new NextRequest(
      `http://localhost/api/explore?${valuationReplayQuery(
        valuationSnapshot,
        { page: 2, limit: 10 },
      )}`,
    ));

    expect(firstResponse.status).toBe(200);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("fails closed when an otherwise valid replay snapshot is no longer available", async () => {
    const firstResponse = await GET(new NextRequest(
      "http://localhost/api/explore?sort=market-cap&page=1&limit=10",
    ));
    const firstBody = await firstResponse.json();
    const valuationSnapshot = firstBody.valuationSnapshot as
      ValuationSnapshotBody;
    mocks.readVerifiedOperationalMarketSnapshot.mockImplementationOnce(
      async () => null,
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/explore?${valuationReplayQuery(
        valuationSnapshot,
        { page: 2, limit: 10 },
      )}`,
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps a 125-token market-cap traversal complete and duplicate-free", async () => {
    mocks.readAlchemyExploreModel.mockResolvedValue({
      ...readyModel(),
      tokens: Array.from({ length: 125 }, (_, index) => ({
        ...token(index + 1),
        launchedAt: new Date(Date.UTC(2026, 6, 1, 0, 0, index)).toISOString(),
      })),
    });
    const firstResponse = await GET(new NextRequest(
      "http://localhost/api/explore?sort=market-cap&page=1&limit=100",
    ));
    const firstBody = await firstResponse.json();
    const valuationSnapshot = firstBody.valuationSnapshot as
      ValuationSnapshotBody;
    const secondResponse = await GET(new NextRequest(
      `http://localhost/api/explore?${valuationReplayQuery(
        valuationSnapshot,
        { page: 2, limit: 100 },
      )}`,
    ));
    const secondBody = await secondResponse.json();
    const symbols = [...firstBody.tokens, ...secondBody.tokens].map(
      (entry: LauncherToken) => entry.symbol,
    );

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstBody).toMatchObject({ page: 1, total: 125, totalPages: 2 });
    expect(secondBody).toMatchObject({ page: 2, total: 125, totalPages: 2 });
    expect(symbols).toEqual(
      Array.from({ length: 125 }, (_, index) => `T${125 - index}`),
    );
    expect(new Set(symbols).size).toBe(125);
    expect(mocks.readBitqueryTokenMarketDataV1.mock.calls.map(
      ([identities]) => identities.length,
    )).toEqual([100, 25]);
  });

  it("sorts global current evidence before reading Bitquery for only the page", async () => {
    let currentInputEntries: readonly ExploreEntry[] = [];
    let resolveCurrent!: (value: ValuedExploreEntry[]) => void;
    mocks.valueExploreEntriesWithCurrentEvidence.mockImplementationOnce(
      ({
        entries,
        marketByToken,
        requireCompleteLiquidityCoverage,
      }: {
        entries: readonly ExploreEntry[];
        marketByToken: ReadonlyMap<string, TokenMarketDataV1>;
        requireCompleteLiquidityCoverage: boolean;
      }) => {
        currentInputEntries = entries;
        expect(marketByToken.size).toBe(0);
        expect(requireCompleteLiquidityCoverage).toBe(true);
        return new Promise<ValuedExploreEntry[]>((resolve) => {
          resolveCurrent = resolve;
        });
      },
    );

    const responseRead = GET(
      new NextRequest("http://localhost/api/explore?sort=market-cap"),
    );
    await vi.waitFor(() => {
      expect(mocks.valueExploreEntriesWithCurrentEvidence).toHaveBeenCalledOnce();
    });
    expect(currentInputEntries).toHaveLength(30);
    expect(mocks.readBitqueryTokenMarketDataV1).not.toHaveBeenCalled();

    resolveCurrent(currentInputEntries.map((entry) => ({
      ...entry,
      valuation: {
        status: "unavailable" as const,
        reason: "liquidity-unavailable" as const,
      },
    })));
    const response = await responseRead;

    expect(response.status).toBe(200);
    expect(mocks.readBitqueryTokenMarketDataV1).toHaveBeenCalledOnce();
    expect(
      mocks.readBitqueryTokenMarketDataV1.mock.calls[0]?.[0],
    ).toHaveLength(9);
  });

  it("fails a global current-evidence read before starting Bitquery", async () => {
    mocks.valueExploreEntriesWithCurrentEvidence.mockRejectedValueOnce(
      new Error("Current market evidence reference head is unavailable"),
    );

    const response = await GET(
      new NextRequest("http://localhost/api/explore?sort=market-cap"),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.readBitqueryTokenMarketDataV1).not.toHaveBeenCalled();
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
      valuation: { status: "stale", stale: 9 },
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
      quoteAddress: "0x0000000000000000000000000000000000000000",
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

  it("keeps all matching tokens paginated for lowest FDV with snapshot replay", async () => {
    const firstResponse = await GET(new NextRequest(
      "http://localhost/api/explore?sort=lowest-market-cap&page=1&limit=10",
    ));
    const firstBody = await firstResponse.json();
    const valuationSnapshot = firstBody.valuationSnapshot as
      ValuationSnapshotBody;
    const response = await GET(new NextRequest(
      `http://localhost/api/explore?${valuationReplayQuery(
        valuationSnapshot,
        { page: 3, limit: 10, sort: "market-cap-asc" },
      )}`,
    ));
    const body = await response.json();

    expect(firstResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      page: 3,
      pageSize: 10,
      total: 30,
      totalPages: 3,
      valuationSnapshot,
    });
    expect(body.tokens).toHaveLength(10);
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "operational+durable+postgres",
    );
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "bitquery",
    );
  });
});
