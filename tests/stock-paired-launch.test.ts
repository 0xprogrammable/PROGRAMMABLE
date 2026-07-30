import { decodeFunctionData, getAddress, parseEther, type Hex } from "viem";
import { describe, expect, it } from "vitest";

import { createStockPairedDraft } from "../lib/launch";
import { buildPlanHash } from "../lib/launch-transaction";
import {
  deriveStockPairedCurrency0Salt,
  encodeStockPairedEthLaunch,
  isStockPairedLaunchedTokenCurrency0,
  STOCK_PAIRED_CURRENCY0_SEARCH_ATTEMPTS,
  STOCK_PAIRED_ETH_QUOTE_ASSETS,
  STOCK_PAIRED_MIN_INITIAL_BUY_ETH_WEI,
  STOCK_QUOTE_ASSETS,
  stockPairedRegistryContainsReleaseAssets,
  stockPairedEthLaunchCoordinatorAbi,
  validateStockPairedLaunchDraft,
} from "../lib/stock-paired";
import { validatePreparedStockPairedLaunchTransactionAgainstVerifiedRelease } from "../lib/stock-paired-launch-validation";
import {
  STOCK_TEST_ACCOUNT,
  stockPairedReleaseFixture,
} from "./stock-paired-fixture";

const salt = `0x${"42".repeat(32)}` as Hex;

function draft() {
  return {
    ...createStockPairedDraft(),
    tokenName: "Stock Pair Test",
    tokenSymbol: "PAIR",
    tokenDescription: "A token quoted in NVDAon.",
    tokenWebsite: "programmable.family",
    tokenImage: "https://programmable.family/token.png",
    tokenX: "https://x.com/0xprogrammable",
    stockQuoteAsset: STOCK_QUOTE_ASSETS[0].address,
    initialBuyEth: "0.01",
    initialBuyQuoteAmount: "",
    launchSalt: salt,
  };
}

describe("Stock-Paired launch preparation", () => {
  it("accepts an append-only registry containing more assets than the active release", () => {
    expect(stockPairedRegistryContainsReleaseAssets(11n, 6)).toBe(true);
    expect(stockPairedRegistryContainsReleaseAssets(6n, 6)).toBe(true);
    expect(stockPairedRegistryContainsReleaseAssets(5n, 6)).toBe(false);
    expect(stockPairedRegistryContainsReleaseAssets(11n, 0)).toBe(false);
  });

  it("derives bounded deterministic salts and identifies canonical currency0 ordering", () => {
    const first = deriveStockPairedCurrency0Salt(salt, 0);
    const second = deriveStockPairedCurrency0Salt(salt, 1);

    expect(first).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(deriveStockPairedCurrency0Salt(salt, 0)).toBe(first);
    expect(deriveStockPairedCurrency0Salt(salt, 10)).toBe(
      "0xb9b89e2d571d77231f42538fd14ae242941f6d11e1aeb6c145456a8ac827c79a",
    );
    expect(
      isStockPairedLaunchedTokenCurrency0(
        "0x1000000000000000000000000000000000000000",
        "0x2000000000000000000000000000000000000000",
      ),
    ).toBe(true);
    expect(
      isStockPairedLaunchedTokenCurrency0(
        "0x3000000000000000000000000000000000000000",
        "0x2000000000000000000000000000000000000000",
      ),
    ).toBe(false);
    expect(() =>
      deriveStockPairedCurrency0Salt(
        salt,
        STOCK_PAIRED_CURRENCY0_SEARCH_ATTEMPTS,
      ),
    ).toThrow(/identifier/);
  });

  it("keeps V1 history and prepares V3 launches from six reviewed routes", () => {
    expect(STOCK_QUOTE_ASSETS).toHaveLength(7);
    expect(new Set(STOCK_QUOTE_ASSETS.map((asset) => asset.address)).size).toBe(
      7,
    );
    expect(STOCK_PAIRED_ETH_QUOTE_ASSETS).toHaveLength(6);
    expect(
      validateStockPairedLaunchDraft(draft(), STOCK_TEST_ACCOUNT),
    ).toMatchObject({
      quoteAsset: STOCK_QUOTE_ASSETS[0],
      initialBuyEthAmount: parseEther("0.01"),
      totalSwapFeeBps: 100,
      creatorFeeBps: 90,
      programmableFeeBps: 10,
      rewards: {
        beneficiaries: [STOCK_TEST_ACCOUNT],
        sharesBps: [10_000],
      },
    });
    expect(
      validateStockPairedLaunchDraft(
        {
          ...draft(),
          stockQuoteAsset: STOCK_PAIRED_ETH_QUOTE_ASSETS[5].address,
        },
        STOCK_TEST_ACCOUNT,
      ).quoteAsset,
    ).toBe(STOCK_PAIRED_ETH_QUOTE_ASSETS[5]);
  });

  it("encodes one atomic ETH launch with canonical metadata and quote asset", () => {
    const deadline = 20_000n;
    const data = encodeStockPairedEthLaunch(draft(), salt, STOCK_TEST_ACCOUNT, {
      minimumQuoteAmountOut: 9_000n,
      minimumInitialTokenOut: 8_000n,
      deadline,
    });
    const decoded = decodeFunctionData({
      abi: stockPairedEthLaunchCoordinatorAbi,
      data,
    });
    expect(decoded.functionName).toBe("launch");
    if (decoded.functionName !== "launch") throw new Error("bad fixture");
    expect(decoded.args[0]).toMatchObject({
      minimumQuoteAmountOut: 9_000n,
      minimumInitialTokenOut: 8_000n,
      deadline,
      launch: {
        name: "Stock Pair Test",
        symbol: "PAIR",
        quoteAsset: STOCK_QUOTE_ASSETS[0].address,
        initialBuyQuoteAmount: 0n,
        creatorSalt: salt,
        metadata: {
          description: "A token quoted in NVDAon.",
          website: "https://programmable.family",
          image: "https://programmable.family/token.png",
        },
        rewardBeneficiaries: [STOCK_TEST_ACCOUNT],
        rewardSharesBps: [10_000],
      },
    });
  });

  it("accepts only the exact payable coordinator launch plan", () => {
    const release = stockPairedReleaseFixture();
    const deadline = BigInt(Math.floor(Date.now() / 1_000) + 600);
    const launch = {
      kind: "launch" as const,
      chainId: 1 as const,
      to: release.addresses.ethLaunchCoordinator,
      data: encodeStockPairedEthLaunch(draft(), salt, STOCK_TEST_ACCOUNT, {
        minimumQuoteAmountOut: 9_000n,
        minimumInitialTokenOut: 8_000n,
        deadline,
      }),
      value: parseEther("0.01").toString(),
      gasLimit: "5000000",
    };
    const launchInput = {
      transaction: launch,
      draft: draft(),
      account: STOCK_TEST_ACCOUNT,
      planHash: buildPlanHash(STOCK_TEST_ACCOUNT, launch),
    };
    expect(
      validatePreparedStockPairedLaunchTransactionAgainstVerifiedRelease(
        launchInput,
        release,
      ),
    ).toEqual(launch);

    expect(() =>
      validatePreparedStockPairedLaunchTransactionAgainstVerifiedRelease(
        {
          ...launchInput,
          transaction: {
            ...launch,
            to: getAddress("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa"),
          },
        },
        release,
      ),
    ).toThrow(/destination/);
  });

  it("rejects unsupported quote assets and ETH buys below the minimum", () => {
    expect(() =>
      validateStockPairedLaunchDraft(
        {
          ...draft(),
          stockQuoteAsset: "0x9999999999999999999999999999999999999999",
        },
        STOCK_TEST_ACCOUNT,
      ),
    ).toThrow(/supported ETH-routed quote assets/);
    expect(() =>
      validateStockPairedLaunchDraft(
        { ...draft(), initialBuyEth: "0.004999999999999999" },
        STOCK_TEST_ACCOUNT,
      ),
    ).toThrow(/at least 0.005 ETH/);
    expect(STOCK_PAIRED_MIN_INITIAL_BUY_ETH_WEI).toBe(parseEther("0.005"));
  });
});
