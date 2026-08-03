import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ExploreReadModel } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const mocks = vi.hoisted(() => ({
  enrichTokensWithAlchemyPrices: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  enrichTokensWithAlchemyPrices: mocks.enrichTokensWithAlchemyPrices,
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
}));

import { GET } from "../app/api/explore/route";

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

describe("Explore API Alchemy boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAlchemyExploreModel.mockResolvedValue(readyModel());
    mocks.enrichTokensWithAlchemyPrices.mockImplementation(async (tokens) => [
      ...tokens,
    ]);
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
      "rpc",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "alchemy",
    );
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "alchemy",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=5, stale-while-revalidate=15",
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
      "rpc",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "alchemy",
    );
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "alchemy",
    );
  });
});
