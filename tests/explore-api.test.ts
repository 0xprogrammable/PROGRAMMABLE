import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreReadModel } from "../lib/onchain/types";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const mocks = vi.hoisted(() => ({
  enrichTokensWithAlchemyPrices: vi.fn(),
  enrichTokensWithAlchemyPoolState: vi.fn(),
  getAlchemyOnchainDeployment: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
  safeAlchemyError: vi.fn((error) => error),
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  enrichTokensWithAlchemyPrices: mocks.enrichTokensWithAlchemyPrices,
  getAlchemyOnchainDeployment: mocks.getAlchemyOnchainDeployment,
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  safeAlchemyError: mocks.safeAlchemyError,
}));

vi.mock("../lib/alchemy/live-market.server", () => ({
  enrichTokensWithAlchemyPoolState: mocks.enrichTokensWithAlchemyPoolState,
}));

import {
  GET,
  inheritExploreEthUsdQuote,
  paginateExploreEntriesV1,
} from "../app/api/explore/route";

const HOOK_ADDRESS =
  "0x3333333333333333333333333333333333333333" as const;
const POOL_ID = `0x${"44".repeat(32)}` as const;

function token(index: number): LauncherToken {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  return {
    id: `1:${tokenAddress}`,
    name: `Token ${index}`,
    symbol: `T${index}`,
    tokenAddress,
    hookAddress: HOOK_ADDRESS,
    poolId: POOL_ID,
    launchedAt: `2026-07-${String(index).padStart(2, "0")}T00:00:00.000Z`,
    launchBlockNumber: String(25_626_490 + index),
    launchTransactionIndex: 0,
    launchLogIndex: 0,
    indexedMarketCapUsdWad: String(BigInt(index) * 10n ** 18n),
    links: [{ kind: "x", url: `https://x.com/token${index}` }],
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
  };
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

describe("Explore API Alchemy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAlchemyExploreModel.mockResolvedValue(readyModel());
    mocks.getAlchemyOnchainDeployment.mockReturnValue({ status: "ready" });
    mocks.enrichTokensWithAlchemyPrices.mockImplementation(async (tokens) => [
      ...tokens,
    ]);
    mocks.enrichTokensWithAlchemyPoolState.mockImplementation(
      async ({ tokens }: { tokens: readonly LauncherToken[] }) => [...tokens],
    );
  });

  it("inherits the durable ETH/USD quote for newest live market values", () => {
    const ethUsdQuote = {
      feedAddress: "0x1111111111111111111111111111111111111111" as const,
      roundId: "12",
      answer: "350000000000",
      decimals: 8,
      updatedAt: "2026-08-04T10:00:00.000Z",
    };
    const launchSnapshot = {
      ...snapshot,
      blockNumber: "25630001",
    };

    expect(
      inheritExploreEthUsdQuote(launchSnapshot, {
        ...snapshot,
        ethUsdQuote,
      }),
    ).toEqual({
      ...launchSnapshot,
      ethUsdQuote,
    });
    expect(
      inheritExploreEthUsdQuote(
        { ...launchSnapshot, ethUsdQuote },
        snapshot,
      ),
    ).toEqual({ ...launchSnapshot, ethUsdQuote });
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

  it.each([
    "unused=random",
    "page=1&page=2",
    "q=token&q=other",
    "sort=newest&extra=1",
    "socials=maybe",
  ])("rejects non-canonical query shapes before the Alchemy read: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore?${query}`),
    );

    expect(response.status).toBe(400);
    expect(mocks.readAlchemyExploreModel).not.toHaveBeenCalled();
    expect(mocks.enrichTokensWithAlchemyPrices).not.toHaveBeenCalled();
  });

  it("keeps the top 20 by market cap first, then appends every remaining coin newest", async () => {
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
    });
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
      "blob",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "alchemy",
    );
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "alchemy",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
    );
  });

  it.each([
    ["newest", "sort=newest&page=3&limit=10"],
    ["lowest market cap", "sort=lowest-market-cap&page=3&limit=10"],
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
    expect(mocks.enrichTokensWithAlchemyPrices).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ tokenAddress: body.tokens[0].tokenAddress }),
      ]),
    );
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "blob",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "alchemy",
    );
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "alchemy",
    );
  });
});
