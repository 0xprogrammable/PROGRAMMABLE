import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExploreReadModel } from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const mocks = vi.hoisted(() => ({
  enrichExplorePageWithOfficialV4Subgraph: vi.fn(),
  readExploreModel: vi.fn(),
}));

vi.mock("../lib/onchain", () => ({
  readExploreModel: mocks.readExploreModel,
}));

vi.mock("../lib/onchain/uniswap-v4-subgraph", () => ({
  enrichExplorePageWithOfficialV4Subgraph:
    mocks.enrichExplorePageWithOfficialV4Subgraph,
}));

import { GET } from "../app/api/explore/token/route";

const TOKEN_ADDRESS =
  "0x1111111111111111111111111111111111111111" as const;
const OTHER_TOKEN_ADDRESS =
  "0x2222222222222222222222222222222222222222" as const;
const HOOK_ADDRESS =
  "0x3333333333333333333333333333333333333333" as const;
const POOL_ID = `0x${"44".repeat(32)}` as const;

function token(
  tokenAddress: `0x${string}`,
  overrides: Partial<LauncherToken> = {},
): LauncherToken {
  return {
    id: `1:${tokenAddress}`,
    name: "Canonical",
    symbol: "CAN",
    tokenAddress,
    hookAddress: HOOK_ADDRESS,
    poolId: POOL_ID,
    launchedAt: "2026-07-29T00:00:00.000Z",
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    ...overrides,
  };
}

const snapshot = {
  chainId: 1,
  blockNumber: "25630000",
  blockHash: `0x${"55".repeat(32)}` as const,
  confirmations: 12,
};

describe("token detail official Uniswap v4 enrichment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enriches only the proven canonical token at its Explore snapshot", async () => {
    const canonical = token(TOKEN_ADDRESS);
    const model = {
      status: "ready",
      tokens: [canonical, token(OTHER_TOKEN_ADDRESS)],
      snapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel;
    const pool = {
      source: "official-uniswap-v4-subgraph",
      indexedBlockNumber: snapshot.blockNumber,
      indexedBlockHash: snapshot.blockHash,
      volumeUsdWad: "1200000000000000000000",
      tvlUsdWad: "800000000000000000000",
      transactionCount: "42",
      liquidity: "123",
      sqrtPriceX96: "79228162514264337593543950336",
      feeTierPips: "0",
    } as const;
    mocks.readExploreModel.mockResolvedValue(model);
    mocks.enrichExplorePageWithOfficialV4Subgraph.mockImplementation(
      async (page) => ({
        ...page,
        tokens: [
          {
            ...page.tokens[0],
            name: "Untrusted replacement",
            uniswapV4Pool: pool,
          },
          token(OTHER_TOKEN_ADDRESS, {
            name: "Subgraph-discovered token",
            uniswapV4Pool: pool,
          }),
        ],
      }),
    );

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      mocks.enrichExplorePageWithOfficialV4Subgraph,
    ).toHaveBeenCalledTimes(1);
    const enrichmentPage =
      mocks.enrichExplorePageWithOfficialV4Subgraph.mock.calls[0]?.[0];
    expect(enrichmentPage.tokens).toEqual([canonical]);
    expect(enrichmentPage.snapshot).toBe(snapshot);
    expect(body.token).toMatchObject({
      id: canonical.id,
      name: canonical.name,
      symbol: canonical.symbol,
      tokenAddress: canonical.tokenAddress,
      hookAddress: canonical.hookAddress,
      poolId: canonical.poolId,
      uniswapV4Pool: pool,
    });
  });

  it.each([
    `address=${TOKEN_ADDRESS}&unused=random`,
    `address=${TOKEN_ADDRESS}&address=${OTHER_TOKEN_ADDRESS}`,
  ])(
    "rejects non-canonical query shapes before reading or enriching: %s",
    async (query) => {
      const response = await GET(
        new NextRequest(`http://localhost/api/explore/token?${query}`),
      );

      expect(response.status).toBe(400);
      expect(mocks.readExploreModel).not.toHaveBeenCalled();
      expect(
        mocks.enrichExplorePageWithOfficialV4Subgraph,
      ).not.toHaveBeenCalled();
    },
  );
});
