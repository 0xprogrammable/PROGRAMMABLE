import { describe, expect, it } from "vitest";
import { decodeFunctionData } from "viem";

import {
  DEEP_V2_AUTOMATION_POLICY,
  DEEP_V2_FIXED_POLICY,
  deepV2LaunchAbi,
  encodeDeepV2Launch,
  validateDeepV2LaunchDraft,
} from "../lib/deep-v2";
import { createDeepDraft, type LaunchDraft } from "../lib/launch";

const account = "0x1111111111111111111111111111111111111111";
const external = "0x2222222222222222222222222222222222222222";
const salt =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function draft(): LaunchDraft {
  return {
    ...createDeepDraft(),
    tokenName: "Deep Token",
    tokenSymbol: "DEEP",
    tokenDescription: "Liquidity grows before creator rewards begin.",
    tokenWebsite: "https://programmable.family/",
    tokenImage: "https://programmable.family/deep.png",
    tokenX: "https://x.com/0xprogrammable",
    initialBuyEth: "0.0006",
    launchSalt: salt,
  };
}

describe("Deep V2 launch boundary", () => {
  it("binds the app to the fixed reviewed V2 economics and automation policy", () => {
    expect(DEEP_V2_FIXED_POLICY).toEqual({
      tokenSupplyWei:
        1_000_000_000n * 10n ** 18n,
      tokenReserveTargetWei:
        150_000_000n * 10n ** 18n,
      growthTargetNativeWei: 50_000_000_000_000_000n,
      totalSwapFeeBps: 100,
      creatorFeeBps: 90,
      programmableFeeBps: 10,
      minimumInitialBuyWei: 600_000_000_000_000n,
      initialTick: 204_200,
      tickSpacing: 200,
      lpFeePips: 0,
      twapWindowSeconds: 1_800,
      oracleRangeHalfWidthTicks: 20_000,
      maximumSpotTwapDeviationTicks: 600,
      maximumAbsoluteTickDelta: 400,
    });
    expect(DEEP_V2_AUTOMATION_POLICY).toEqual({
      maximumBatchSize: 32,
      initialObservationCardinalityNext: 2,
      observationCardinalityStep: 16,
      observationCardinalityTarget: 192,
      minimumOracleActivationNativeWei: 2_000_000_000_000_000n,
      minimumUtilizationBps: 8_500,
      trustedDepthCapBps: 25,
      maximumCompoundNativeWei: 250_000_000_000_000_000n,
      minimumCompoundNativeWei: 2_000_000_000_000_000n,
      minimumKeeperProcessNativeWei: 2_000_000_000_000_000n,
      compoundCooldownSeconds: 300,
      rollingExposureWindowSeconds: 1_800,
      rollingExposureRecordCapacity: 8,
      stressTick: 218_000,
      fullRangeTickLower: -887_200,
      fullRangeTickUpper: 887_200,
    });
  });

  it("encodes only the immutable V2 token setup", () => {
    const decoded = decodeFunctionData({
      abi: deepV2LaunchAbi,
      data: encodeDeepV2Launch(draft(), salt, account),
    });

    expect(decoded.functionName).toBe("launch");
    if (decoded.functionName !== "launch") return;
    expect(decoded.args[0]).toEqual({
      name: "Deep Token",
      symbol: "DEEP",
      creatorSalt: salt,
      metadata: {
        description: "Liquidity grows before creator rewards begin.",
        website: "https://programmable.family/",
        image: "https://programmable.family/deep.png",
        extraData: expect.stringMatching(/^0x[0-9a-f]+$/),
      },
    });
    expect(decoded.args[0]).not.toHaveProperty("buySwapFeeBps");
    expect(decoded.args[0]).not.toHaveProperty("rewardBeneficiaries");
  });

  it("rejects V1-style fee and beneficiary customization", () => {
    expect(validateDeepV2LaunchDraft(draft(), account)).toEqual({
      fees: {
        buySwapFeeBps: 100,
        sellSwapFeeBps: 100,
        buyCreatorFeeBps: 90,
        sellCreatorFeeBps: 90,
        platformFeeBps: 10,
      },
      rewards: {
        beneficiaries: [account],
        sharesBps: [10_000],
      },
    });

    expect(() =>
      validateDeepV2LaunchDraft(
        { ...draft(), buySwapFeePercent: "2" },
        account,
      ),
    ).toThrow("fixed 1.00% buy and sell fee");
    expect(() =>
      validateDeepV2LaunchDraft(
        {
          ...draft(),
          rewardDestinationMode: "external",
          rewardExternalAddress: external,
        },
        account,
      ),
    ).toThrow("launch wallet");
  });
});
