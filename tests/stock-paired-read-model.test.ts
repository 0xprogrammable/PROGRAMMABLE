import { getAddress, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import {
  mergeStockPairedExploreModel,
  pairStockPairedLaunches,
} from "../lib/onchain/stock-paired-read-model";
import type { ExploreReadModel } from "../lib/onchain/types";
import { STOCK_QUOTE_ASSETS } from "../lib/stock-paired";
import type { LauncherToken } from "../lib/tokens";
import {
  STOCK_TEST_ACCOUNT,
  STOCK_TEST_POOL_ID,
  STOCK_TEST_TOKEN,
  stockPairedReleaseFixture,
} from "./stock-paired-fixture";

const transactionHash = `0x${"42".repeat(32)}` as Hex;
const launchHash = `0x${"43".repeat(32)}` as Hex;
const vault = getAddress(
  "0x5555555555555555555555555555555555555555",
);
const positionRecipient = getAddress(
  "0x6666666666666666666666666666666666666666",
);

function events() {
  const coordinator =
    stockPairedReleaseFixture().addresses.ethLaunchCoordinator;
  return {
    launches: [
      {
        deployer: coordinator,
        token: STOCK_TEST_TOKEN,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        poolId: STOCK_TEST_POOL_ID,
        rewardVault: vault,
        positionRecipient,
        positionTokenId: 7n,
        launchHash,
        blockNumber: 123n,
        transactionHash,
        transactionIndex: 1,
        logIndex: 2,
      },
    ],
    ethLaunches: [
      {
        creator: STOCK_TEST_ACCOUNT,
        token: STOCK_TEST_TOKEN,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        initialBuyEthAmount: 5n * 10n ** 15n,
        initialBuyQuoteAmount: 10n ** 16n,
        initialBuyTokenAmount: 2n * 10n ** 18n,
        launchHash,
        blockNumber: 123n,
        transactionHash,
        transactionIndex: 1,
        logIndex: 3,
      },
    ],
    liquidities: [
      {
        token: STOCK_TEST_TOKEN,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        totalSupply: 1_000_000_000n * 10n ** 18n,
        tokenLiquidityAmount: 999_999_999n * 10n ** 18n,
        lockedTokenDust: 1n * 10n ** 18n,
        initialTick: 191_200,
        tickLower: -887_200,
        tickUpper: 191_200,
        lpFeePips: 0,
        launchHash,
        blockNumber: 123n,
        transactionHash,
      },
    ],
    initialBuys: [
      {
        deployer: coordinator,
        token: STOCK_TEST_TOKEN,
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        poolId: STOCK_TEST_POOL_ID,
        quoteAmount: 10n ** 16n,
        tokenAmount: 2n * 10n ** 18n,
        launchHash,
        blockNumber: 123n,
        transactionHash,
      },
    ],
    volumes: new Map(),
  } as Parameters<typeof pairStockPairedLaunches>[0];
}

function stockToken(): LauncherToken {
  return {
    id: `1:${STOCK_TEST_TOKEN.toLowerCase()}`,
    name: "Stock Pair",
    symbol: "PAIR",
    tokenAddress: STOCK_TEST_TOKEN,
    hookAddress: getAddress(
      "0x77777777777777777777777777777777777750Cc",
    ),
    poolId: STOCK_TEST_POOL_ID,
    creatorAddress: STOCK_TEST_ACCOUNT,
    positionRecipient,
    positionTokenId: "7",
    rewardVaultAddress: vault,
    quoteAssetAddress: STOCK_QUOTE_ASSETS[0].address,
    quoteAssetSymbol: STOCK_QUOTE_ASSETS[0].symbol,
    launchHash,
    launchBlockNumber: "123",
    launchTransactionHash: transactionHash,
    launchTransactionIndex: 1,
    launchLogIndex: 2,
    launchedAt: "2026-07-29T00:00:00.000Z",
    totalSwapFeeBps: 100,
    launchModel: "stock-paired",
    liquidityPath: "meme",
  };
}

function baseModel(): ExploreReadModel {
  return {
    status: "ready",
    tokens: [],
    snapshot: {
      chainId: 1,
      blockNumber: "123",
      blockHash: `0x${"44".repeat(32)}`,
      confirmations: 12,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

describe("Stock-Paired read model provenance", () => {
  it("pairs the three launch records only when provenance is exact", () => {
    expect(pairStockPairedLaunches(events())).toMatchObject([
      {
        launch: {
          token: STOCK_TEST_TOKEN,
          positionTokenId: 7n,
        },
        liquidity: {
          initialTick: 191_200,
        },
        initialBuy: {
          quoteAmount: 10n ** 16n,
        },
        ethLaunch: {
          creator: STOCK_TEST_ACCOUNT,
          initialBuyEthAmount: 5n * 10n ** 15n,
        },
      },
    ]);
  });

  it("rejects missing, mismatched and duplicate launch evidence", () => {
    const missing = events();
    missing.initialBuys = [];
    expect(() => pairStockPairedLaunches(missing)).toThrow(/Unpaired/);

    const mismatched = events();
    mismatched.liquidities[0].launchHash = `0x${"ff".repeat(32)}`;
    expect(() => pairStockPairedLaunches(mismatched)).toThrow(/Incomplete/);

    const duplicate = events();
    duplicate.launches.push({ ...duplicate.launches[0], logIndex: 9 });
    duplicate.ethLaunches.push({
      ...duplicate.ethLaunches[0],
      logIndex: 10,
    });
    duplicate.liquidities.push({ ...duplicate.liquidities[0] });
    duplicate.initialBuys.push({ ...duplicate.initialBuys[0] });
    expect(() => pairStockPairedLaunches(duplicate)).toThrow(/Duplicate/);
  });

  it("refreshes a matching Stock-Paired launch without changing token order", () => {
    const token = stockToken();
    expect(mergeStockPairedExploreModel(baseModel(), [token])).toMatchObject({
      status: "ready",
      tokens: [{ launchModel: "stock-paired", tokenAddress: STOCK_TEST_TOKEN }],
    });

    const repeated = baseModel();
    if (repeated.status !== "ready") throw new Error("bad fixture");
    const classicBefore = {
      ...token,
      id: "classic-before",
      tokenAddress: getAddress(
        "0x1111111111111111111111111111111111111111",
      ),
      launchModel: "classic" as const,
    };
    const classicAfter = {
      ...token,
      id: "classic-after",
      tokenAddress: getAddress(
        "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
      ),
      launchModel: "classic" as const,
    };
    repeated.tokens = [
      classicBefore,
      {
        ...token,
        tokenPriceQuoteWad: "1",
        fdvUsdWad: "2",
        grossVolumeQuoteRaw: "3",
      },
      classicAfter,
    ];
    const merged = mergeStockPairedExploreModel(repeated, [
      {
        ...token,
        name: "Refreshed",
        tokenPriceQuoteWad: "101",
        fdvUsdWad: "202",
        grossVolumeQuoteRaw: "303",
      },
    ]);
    expect(merged).toMatchObject({
      status: "ready",
      tokens: [
        { id: "classic-before" },
        {
          name: "Refreshed",
          tokenAddress: STOCK_TEST_TOKEN,
          tokenPriceQuoteWad: "101",
          fdvUsdWad: "202",
          grossVolumeQuoteRaw: "303",
        },
        { id: "classic-after" },
      ],
    });
  });

  it("rejects launch-model and provenance conflicts", () => {
    const token = stockToken();
    const duplicate = baseModel();
    if (duplicate.status !== "ready") throw new Error("bad fixture");
    duplicate.tokens = [{ ...token, launchModel: "classic" }];
    expect(() =>
      mergeStockPairedExploreModel(duplicate, [token]),
    ).toThrow(/Duplicate token/);

    const conflictingStockLaunch = baseModel();
    if (conflictingStockLaunch.status !== "ready") {
      throw new Error("bad fixture");
    }
    conflictingStockLaunch.tokens = [token];
    expect(() =>
      mergeStockPairedExploreModel(conflictingStockLaunch, [
        { ...token, launchHash: `0x${"ff".repeat(32)}` },
      ]),
    ).toThrow(/Duplicate token/);
  });
});
