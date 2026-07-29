import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";

import {
  DEEP_V3_FIXED_POLICY,
  deepV3LaunchAbi,
  deepV3PresetDisclosure,
  encodeDeepV3Launch,
  validateDeepV3LaunchDraft,
} from "../lib/deep-v3";
import { quoteDeepV3InitialBuy } from "../lib/deep-v3-quote";
import { createDeepDraft, type LaunchDraft } from "../lib/launch";

const account = "0x1111111111111111111111111111111111111111";
const salt =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function draft(): LaunchDraft {
  return {
    ...createDeepDraft(),
    tokenName: "Deep Token",
    tokenSymbol: "DEEP",
    tokenDescription: "Liquidity grows with trading.",
    tokenWebsite: "https://programmable.family/",
    tokenImage: "https://programmable.family/deep.png",
    tokenX: "https://x.com/0xprogrammable",
    initialBuyEth: "0.0006",
    launchSalt: salt,
  };
}

describe("Deep V3 launch boundary", () => {
  it("binds the app to the fixed 1.00% ETH fee and safety policy", () => {
    expect(DEEP_V3_FIXED_POLICY).toEqual({
      tokenSupplyWei: 1_000_000_000n * 10n ** 18n,
      totalHookFeeBps: 100,
      growthFeeBps: 90,
      programmableFeeBps: 10,
      transferTaxBps: 0,
      minimumInitialBuyWei: 600_000_000_000_000n,
      initialTick: 204_200,
      tickSpacing: 200,
      lpFeePips: 0,
      fullRangeTickLower: -887_200,
      fullRangeTickUpper: 887_200,
      maximumInitialBuyImpactTicks: 400,
      initialSqrtPriceX96: 2_151_813_121_295_408_910_812_139_624_586_144n,
      minimumInitialBuySqrtPriceLimitX96:
        2_109_206_475_762_646_020_212_180_903_141_694n,
      initialBuySlippageBps: 100,
      twapWindowSeconds: 1_800,
      shortTwapWindowSeconds: 300,
      compoundCooldownSeconds: 300,
      minimumCompoundNativeWei: 2_000_000_000_000_000n,
      maximumCompoundNativeWei: 250_000_000_000_000_000n,
      trustedDepthCycleCapBps: 25,
      rollingExposureWindowSeconds: 1_800,
      rollingExposureRecordCapacity: 8,
      oracleObservationCardinalityTarget: 192,
    });

    expect(validateDeepV3LaunchDraft(draft(), account)).toEqual({
      fees: {
        totalHookFeeBps: 100,
        growthFeeBps: 90,
        programmableFeeBps: 10,
        transferTaxBps: 0,
      },
    });
  });

  it("quotes the protected initial buy with official v4 swap math", async () => {
    const quote = await quoteDeepV3InitialBuy(600_000_000_000_000n);

    expect(quote).toEqual({
      grossNativeAmount: 600_000_000_000_000n,
      hookFeeAmount: 6_000_000_000_000n,
      poolNativeAmount: 594_000_000_000_000n,
      quotedInitialTokenOut: 437_971_781_612_384_114_831_424n,
      minimumInitialTokenOut: 433_592_063_796_260_273_683_109n,
      initialBuySqrtPriceLimitX96:
        DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96,
    });
    expect(quote.minimumInitialTokenOut).toBeGreaterThan(1n);
  });

  it("encodes the exact protected V3 launch tuple in one transaction", async () => {
    const quote = await quoteDeepV3InitialBuy(600_000_000_000_000n);
    const deadline = 2_000_000_000n;
    const data = encodeDeepV3Launch(draft(), salt, account, {
      minimumInitialTokenOut: quote.minimumInitialTokenOut,
      initialBuySqrtPriceLimitX96:
        quote.initialBuySqrtPriceLimitX96,
      deadline,
    });
    const decoded = decodeFunctionData({ abi: deepV3LaunchAbi, data });

    expect(decoded.functionName).toBe("launch");
    if (decoded.functionName !== "launch") return;
    expect(decoded.args[0]).toEqual({
      name: "Deep Token",
      symbol: "DEEP",
      metadata: {
        description: "Liquidity grows with trading.",
        website: "https://programmable.family/",
        image: "https://programmable.family/deep.png",
        extraData: expect.stringMatching(/^0x[0-9a-f]+$/),
      },
      creatorSalt: salt,
      minimumInitialTokenOut: quote.minimumInitialTokenOut,
      initialBuySqrtPriceLimitX96:
        DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96,
      deadline,
    });
  });

  it("rejects an unsafe output floor or price limit", () => {
    expect(() =>
      encodeDeepV3Launch(draft(), salt, account, {
        minimumInitialTokenOut: 1n,
        initialBuySqrtPriceLimitX96:
          DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96,
        deadline: 2_000_000_000n,
      }),
    ).toThrow("initial buy output protection");

    expect(() =>
      encodeDeepV3Launch(draft(), salt, account, {
        minimumInitialTokenOut: 1_000_000n,
        initialBuySqrtPriceLimitX96:
          DEEP_V3_FIXED_POLICY.initialSqrtPriceX96 - 1n,
        deadline: 2_000_000_000n,
      }),
    ).toThrow("price limit");
  });

  it("describes only the V3 economics users actually receive", () => {
    expect(deepV3PresetDisclosure()).toEqual({
      swapFee: "1.00%",
      growthFee: "0.90%",
      programmableFee: "0.10%",
      summary:
        "The growth fee buys the token and adds both assets to the original permanently locked pool.",
      automation:
        "The first cycle waits for the 30-minute oracle. Automation checks on a five-minute cadence. Safety, gas economics, and transaction inclusion may defer execution.",
      rewards:
        "Deep does not pay creator rewards. The full 0.90% growth fee remains committed to locked liquidity.",
      protocolFees:
        "The 1.00% is the Deep hook fee. Any Uniswap protocol fee enabled for the pool is separate.",
      review: "This model has not received an independent external audit.",
    });
  });
});
