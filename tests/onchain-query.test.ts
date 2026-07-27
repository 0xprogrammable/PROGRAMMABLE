import { describe, expect, it } from "vitest";

import type { LauncherToken } from "../lib/tokens";
import {
  filterAndSortTokens,
  paginateExplore,
  parseExploreSort,
} from "../lib/onchain/query";
import type { ExploreReadModel } from "../lib/onchain/types";

function token(
  name: string,
  symbol: string,
  addressSuffix: string,
  block: number,
  marketCapEthWei: string,
): LauncherToken {
  return {
    id: symbol,
    name,
    symbol,
    tokenAddress: `0x${addressSuffix.padStart(40, "0")}`,
    hookAddress: "0x1111111111111111111111111111111111111111",
    poolId: `0x${addressSuffix.padStart(64, "0")}`,
    launchBlockNumber: block.toString(),
    launchTransactionIndex: 0,
    launchLogIndex: 0,
    launchedAt: new Date(block * 1_000).toISOString(),
    marketCapEthWei,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
  };
}

const tokens = [
  token("Alpha Bloom", "ABC", "a1", 10, "200"),
  token("Second", "ABC", "b2", 12, "100"),
  token("Third", "XYZ", "c3", 11, "300"),
];

describe("Explore query", () => {
  it("searches names, cash-tag symbols, and addresses", () => {
    expect(filterAndSortTokens(tokens, "$abc", "newest")).toHaveLength(
      2,
    );
    expect(
      filterAndSortTokens(tokens, "alpha", "newest")[0]?.symbol,
    ).toBe("ABC");
    expect(
      filterAndSortTokens(tokens, tokens[2].tokenAddress, "newest")[0]
        ?.symbol,
    ).toBe("XYZ");
  });

  it("sorts deterministically by launch order and ETH market cap", () => {
    expect(
      filterAndSortTokens(tokens, "", "newest").map(
        (entry) => entry.id,
      ),
    ).toEqual(["ABC", "XYZ", "ABC"]);
    expect(
      filterAndSortTokens(tokens, "", "oldest").map(
        (entry) => entry.tokenAddress,
      ),
    ).toEqual([
      tokens[0].tokenAddress,
      tokens[2].tokenAddress,
      tokens[1].tokenAddress,
    ]);
    expect(
      filterAndSortTokens(tokens, "", "market-cap").map(
        (entry) => entry.symbol,
      ),
    ).toEqual(["XYZ", "ABC", "ABC"]);
    expect(
      filterAndSortTokens(tokens, "", "market-cap-asc").map(
        (entry) => entry.tokenAddress,
      ),
    ).toEqual([
      tokens[1].tokenAddress,
      tokens[0].tokenAddress,
      tokens[2].tokenAddress,
    ]);
  });

  it("supports the public sort aliases and bounded pagination", () => {
    expect(parseExploreSort("highest-market-cap")).toBe("market-cap");
    expect(parseExploreSort("lowest-market-cap")).toBe("market-cap-asc");
    const model: ExploreReadModel = {
      status: "ready",
      tokens,
      snapshot: {
        chainId: 1,
        blockNumber: "100",
        blockHash: `0x${"11".repeat(32)}`,
        confirmations: 12,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };
    const page = paginateExplore(model, {
      page: 2,
      pageSize: 2,
      sort: "newest",
    });

    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(2);
    expect(page.tokens).toHaveLength(1);
  });

  it("keeps a missing valuation last instead of treating it as zero", () => {
    const missing = { ...tokens[0], id: "missing", marketCapEthWei: undefined };
    expect(
      filterAndSortTokens([missing, ...tokens], "", "market-cap-asc").at(-1)
        ?.id,
    ).toBe("missing");
  });
});
