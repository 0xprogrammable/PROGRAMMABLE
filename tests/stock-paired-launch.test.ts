import {
  decodeFunctionData,
  getAddress,
  type Hex,
} from "viem";
import { describe, expect, it } from "vitest";

import { createStockPairedDraft } from "../lib/launch";
import { buildPlanHash } from "../lib/launch-transaction";
import {
  encodeStockPairedLaunch,
  encodeStockQuoteApproval,
  STOCK_PAIRED_MIN_INITIAL_BUY_RAW,
  STOCK_QUOTE_ASSETS,
  stockPairedLaunchAbi,
  validateStockPairedLaunchDraft,
} from "../lib/stock-paired";
import {
  validatePreparedStockPairedLaunchTransactionAgainstVerifiedRelease,
  validatePreparedStockQuoteApprovalTransactionAgainstVerifiedRelease,
} from "../lib/stock-paired-launch-validation";
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
    initialBuyQuoteAmount: "0.01",
    launchSalt: salt,
  };
}

describe("Stock-Paired launch preparation", () => {
  it("uses the exact seven-asset registry and immutable 1% split", () => {
    expect(STOCK_QUOTE_ASSETS).toHaveLength(7);
    expect(
      new Set(STOCK_QUOTE_ASSETS.map((asset) => asset.address)).size,
    ).toBe(7);
    expect(
      validateStockPairedLaunchDraft(draft(), STOCK_TEST_ACCOUNT),
    ).toMatchObject({
      quoteAsset: STOCK_QUOTE_ASSETS[0],
      initialBuyQuoteAmount: STOCK_PAIRED_MIN_INITIAL_BUY_RAW,
      totalSwapFeeBps: 100,
      creatorFeeBps: 90,
      programmableFeeBps: 10,
      rewards: {
        beneficiaries: [STOCK_TEST_ACCOUNT],
        sharesBps: [10_000],
      },
    });
  });

  it("encodes one atomic launch with canonical metadata and quote asset", () => {
    const data = encodeStockPairedLaunch(
      draft(),
      salt,
      STOCK_TEST_ACCOUNT,
    );
    const decoded = decodeFunctionData({
      abi: stockPairedLaunchAbi,
      data,
    });
    expect(decoded.functionName).toBe("launch");
    if (decoded.functionName !== "launch") throw new Error("bad fixture");
    expect(decoded.args[0]).toMatchObject({
      name: "Stock Pair Test",
      symbol: "PAIR",
      quoteAsset: STOCK_QUOTE_ASSETS[0].address,
      initialBuyQuoteAmount: STOCK_PAIRED_MIN_INITIAL_BUY_RAW,
      creatorSalt: salt,
      metadata: {
        description: "A token quoted in NVDAon.",
        website: "https://programmable.family",
        image: "https://programmable.family/token.png",
      },
      rewardBeneficiaries: [STOCK_TEST_ACCOUNT],
      rewardSharesBps: [10_000],
    });
  });

  it("accepts only exact approval and launch wallet plans", () => {
    const release = stockPairedReleaseFixture();
    const approval = {
      kind: "stock-quote-approval" as const,
      chainId: 1 as const,
      to: STOCK_QUOTE_ASSETS[0].address,
      data: encodeStockQuoteApproval(
        release.addresses.launcher,
        STOCK_PAIRED_MIN_INITIAL_BUY_RAW,
      ),
      value: "0",
      gasLimit: "60000",
    };
    const approvalInput = {
      transaction: approval,
      draft: draft(),
      account: STOCK_TEST_ACCOUNT,
      planHash: buildPlanHash(STOCK_TEST_ACCOUNT, approval),
    };
    expect(
      validatePreparedStockQuoteApprovalTransactionAgainstVerifiedRelease(
        approvalInput,
        release,
      ),
    ).toEqual(approval);

    const launch = {
      kind: "launch" as const,
      chainId: 1 as const,
      to: release.addresses.launcher,
      data: encodeStockPairedLaunch(
        draft(),
        salt,
        STOCK_TEST_ACCOUNT,
      ),
      value: "0",
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
      validatePreparedStockQuoteApprovalTransactionAgainstVerifiedRelease(
        {
          ...approvalInput,
          transaction: {
            ...approval,
            data: encodeStockQuoteApproval(
              release.addresses.launcher,
              STOCK_PAIRED_MIN_INITIAL_BUY_RAW + 1n,
            ),
          },
        },
        release,
      ),
    ).toThrow(/exact Initial Buy amount/);
    expect(() =>
      validatePreparedStockPairedLaunchTransactionAgainstVerifiedRelease(
        {
          ...launchInput,
          transaction: {
            ...launch,
            to: getAddress(
              "0x9999999999999999999999999999999999999999",
            ),
          },
        },
        release,
      ),
    ).toThrow(/destination/);
  });

  it("rejects unsupported quote assets and buys below 0.01", () => {
    expect(() =>
      validateStockPairedLaunchDraft(
        {
          ...draft(),
          stockQuoteAsset:
            "0x9999999999999999999999999999999999999999",
        },
        STOCK_TEST_ACCOUNT,
      ),
    ).toThrow(/supported quote assets/);
    expect(() =>
      validateStockPairedLaunchDraft(
        { ...draft(), initialBuyQuoteAmount: "0.009" },
        STOCK_TEST_ACCOUNT,
      ),
    ).toThrow(/at least 0.01/);
  });
});
