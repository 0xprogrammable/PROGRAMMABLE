import { describe, expect, it } from "vitest";

import type { LauncherToken } from "../lib/tokens";
import {
  filterAndSortTokens,
  paginateExplore,
  parseExploreSort,
  visibleExploreTokens,
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

  it("filters social presence before counting and paginating", () => {
    const socialTokens = [
      {
        ...tokens[0],
        links: [{ kind: "website" as const, url: "https://example.com" }],
      },
      {
        ...tokens[1],
        links: [{ kind: "x" as const, url: "https://x.com/example" }],
      },
      {
        ...tokens[2],
        links: [
          { kind: "telegram" as const, url: "https://t.me/example" },
        ],
      },
    ];
    const model: ExploreReadModel = {
      status: "ready",
      tokens: socialTokens,
      snapshot: {
        chainId: 11_155_111,
        blockNumber: "100",
        blockHash: `0x${"44".repeat(32)}`,
        confirmations: 12,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };

    expect(
      paginateExplore(model, {
        page: 1,
        pageSize: 1,
        sort: "newest",
        socials: "yes",
      }),
    ).toMatchObject({
      total: 2,
      totalPages: 2,
      tokens: [expect.objectContaining({ tokenAddress: tokens[1].tokenAddress })],
    });
    expect(
      paginateExplore(model, {
        page: 1,
        pageSize: 9,
        sort: "newest",
        socials: "no",
      }).tokens.map((entry) => entry.tokenAddress),
    ).toEqual([tokens[0].tokenAddress]);
  });

  it("sorts by the fresher indexed market cap when it is available", () => {
    const refreshed = [
      {
        ...tokens[0],
        indexedMarketCapEthWei: "500",
      },
      {
        ...tokens[1],
        indexedMarketCapEthWei: "50",
      },
      tokens[2],
    ];

    expect(
      filterAndSortTokens(refreshed, "", "market-cap").map(
        (entry) => entry.tokenAddress,
      ),
    ).toEqual([
      tokens[0].tokenAddress,
      tokens[2].tokenAddress,
      tokens[1].tokenAddress,
    ]);
  });

  it("supports the public sort aliases and bounded pagination", () => {
    expect(parseExploreSort(null)).toBe("newest");
    expect(parseExploreSort("newest")).toBe("newest");
    expect(parseExploreSort("highest-market-cap")).toBe("market-cap");
    expect(parseExploreSort("lowest-market-cap")).toBe("market-cap-asc");
    const model: ExploreReadModel = {
      status: "ready",
      tokens,
      snapshot: {
        chainId: 11_155_111,
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

  it("uses highest market cap as the default Explore order", () => {
    const model: ExploreReadModel = {
      status: "ready",
      tokens,
      snapshot: {
        chainId: 11_155_111,
        blockNumber: "100",
        blockHash: `0x${"33".repeat(32)}`,
        confirmations: 12,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };

    expect(
      paginateExplore(model).tokens.map((entry) => entry.symbol),
    ).toEqual(["XYZ", "ABC", "ABC"]);
  });

  it("keeps a missing valuation last instead of treating it as zero", () => {
    const missing = { ...tokens[0], id: "missing", marketCapEthWei: undefined };
    expect(
      filterAndSortTokens([missing, ...tokens], "", "market-cap-asc").at(-1)
        ?.id,
    ).toBe("missing");
  });

  it("uses one validated unit for market-cap sorting and keeps incomparable values last", () => {
    const usdLow = {
      ...tokens[0],
      id: "usd-low",
      fdvUsdWad: "10",
      marketCapEthWei: "999999",
    };
    const usdHigh = {
      ...tokens[1],
      id: "usd-high",
      fdvUsdWad: "20",
      marketCapEthWei: "1",
    };
    const ethFallback = {
      ...tokens[2],
      id: "eth-fallback",
      fdvUsdWad: "not-a-wad",
      marketCapEthWei: "500",
    };
    const unknown = {
      ...tokens[0],
      id: "unknown",
      fdvUsdWad: "-1",
      marketCapEthWei: undefined,
    };

    expect(
      filterAndSortTokens(
        [ethFallback, unknown, usdLow, usdHigh],
        "",
        "market-cap",
      ).map((entry) => entry.id),
    ).toEqual(["usd-high", "usd-low", "eth-fallback", "unknown"]);
    expect(
      filterAndSortTokens(
        [ethFallback, unknown, usdLow, usdHigh],
        "",
        "market-cap-asc",
      ).map((entry) => entry.id),
    ).toEqual(["usd-low", "usd-high", "eth-fallback", "unknown"]);

    const newerEthHigh = {
      ...tokens[0],
      id: "newer-eth-high",
      launchBlockNumber: "40",
      fdvUsdWad: undefined,
      marketCapEthWei: "1000000",
    };
    const olderEthLow = {
      ...tokens[1],
      id: "older-eth-low",
      launchBlockNumber: "30",
      fdvUsdWad: undefined,
      marketCapEthWei: "1",
    };
    expect(
      filterAndSortTokens(
        [olderEthLow, usdLow, newerEthHigh, usdHigh],
        "",
        "market-cap-asc",
      ).map((entry) => entry.id),
    ).toEqual(["usd-low", "usd-high", "newer-eth-high", "older-eth-low"]);
  });

  it("keeps all Mainnet rehearsals out of Explore and shows the next launch", () => {
    const model: ExploreReadModel = {
      status: "ready",
      tokens: [
        {
          ...tokens[0],
          id: "canary",
          launchBlockNumber: "25624511",
        },
        {
          ...tokens[1],
          id: "wallet-test",
          launchBlockNumber: "25626329",
        },
        {
          ...tokens[2],
          id: "trade-test",
          launchBlockNumber: "25626489",
        },
        {
          ...tokens[0],
          id: "first-public-launch",
          launchBlockNumber: "25626490",
        },
      ],
      snapshot: {
        chainId: 1,
        blockNumber: "25626510",
        blockHash: `0x${"22".repeat(32)}`,
        confirmations: 12,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };

    const page = paginateExplore(model);
    expect(page.total).toBe(1);
    expect(page.tokens.map((entry) => entry.id)).toEqual([
      "first-public-launch",
    ]);
  });

  it("keeps evidence-bound canaries out without guessing from display metadata", () => {
    const canonicalCanary = {
      ...tokens[0],
      id: "canonical-canary",
      tokenAddress:
        "0xFA5D9694D9f8fa47b8A6c15Df4510b76cb844e2c" as const,
      launchBlockNumber: "25639700",
    };
    const similarlyNamedPublicLaunch = {
      ...tokens[1],
      id: "public-canary-name",
      name: "Community Canary",
      launchBlockNumber: "25639701",
    };
    const model: ExploreReadModel = {
      status: "ready",
      tokens: [canonicalCanary, similarlyNamedPublicLaunch],
      snapshot: {
        chainId: 1,
        blockNumber: "25639720",
        blockHash: `0x${"55".repeat(32)}`,
        confirmations: 12,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };

    expect(visibleExploreTokens(model).map(({ id }) => id)).toEqual([
      "public-canary-name",
    ]);
  });
});
