import { describe, expect, it } from "vitest";
import { decodeFunctionData, toFunctionSelector } from "viem";

import { classicV3LaunchAbi } from "../lib/classic-v3";
import {
  buildClassicV4LaunchDisclosure,
  classicV4LaunchAbi,
  encodeClassicV4Launch,
  validateClassicV4LaunchDraft,
} from "../lib/classic-v4";
import { createClassicV3Draft, type LaunchDraft } from "../lib/launch";

const account = "0x1111111111111111111111111111111111111111";
const external = "0x2222222222222222222222222222222222222222";
const third = "0x3333333333333333333333333333333333333333";
const salt =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function draft(): LaunchDraft {
  return {
    ...createClassicV3Draft(),
    tokenName: "Directional",
    tokenSymbol: "DIR",
    tokenDescription: "Immutable directional fees",
    initialBuyEth: "0.0006",
    launchSalt: salt,
  };
}

describe("Classic V4 launch configuration", () => {
  it("keeps historical V3 calldata separate from MemeLaunchV3 calldata", () => {
    const v3Launch = classicV3LaunchAbi.find(
      (item) => item.type === "function" && item.name === "launch",
    );
    const v4Launch = classicV4LaunchAbi.find(
      (item) => item.type === "function" && item.name === "launchFor",
    );

    expect(v3Launch).toBeDefined();
    expect(v4Launch).toBeDefined();
    if (!v3Launch || !v4Launch) return;
    expect(toFunctionSelector(v3Launch)).not.toBe(toFunctionSelector(v4Launch));
    if (
      v3Launch.inputs[0]?.type !== "tuple" ||
      v4Launch.inputs[1]?.type !== "tuple"
    ) {
      throw new Error("Classic launch parameters must remain ABI tuples");
    }
    expect(
      v3Launch.inputs[0].components.map((item) => item.name),
    ).not.toContain("liquidityPreset");
    expect(v4Launch.inputs[1].components.map((item) => item.name)).not.toContain(
      "liquidityPreset",
    );
  });

  it("accepts exact 0.1% steps and reserves the full minimum for Programmable", () => {
    const configuration = validateClassicV4LaunchDraft(
      {
        ...draft(),
        buySwapFeePercent: "0.1",
        sellSwapFeePercent: "10",
      },
      account,
    );

    expect(configuration.fees).toEqual({
      buySwapFeeBps: 10,
      sellSwapFeeBps: 1000,
      buyCreatorFeeBps: 0,
      sellCreatorFeeBps: 990,
      platformFeeBps: 10,
    });
    expect(configuration.liquidity).toEqual({
      preset: "standard",
      presetCode: 0,
    });
    expect(
      validateClassicV4LaunchDraft(
        { ...draft(), buySwapFeePercent: "1.5" },
        account,
      ).fees.buySwapFeeBps,
    ).toBe(150);

    for (const value of ["0", "0.01", "1.01", "10.1", "11"]) {
      expect(() =>
        validateClassicV4LaunchDraft(
          { ...draft(), buySwapFeePercent: value },
          account,
        ),
      ).toThrow("0.1% steps");
    }
  });

  it("defaults a legacy missing preset but rejects an explicit unknown preset", () => {
    const legacyDraft = draft() as Partial<LaunchDraft>;
    delete legacyDraft.classicLiquidityPreset;
    expect(
      validateClassicV4LaunchDraft(legacyDraft as LaunchDraft, account)
        .liquidity,
    ).toEqual({ preset: "standard", presetCode: 0 });

    expect(() =>
      validateClassicV4LaunchDraft(
        {
          ...draft(),
          classicLiquidityPreset: "unknown",
        } as unknown as LaunchDraft,
        account,
      ),
    ).toThrow("valid Classic liquidity depth");
  });

  it("encodes the immutable fee, reward and Deeper preset settings", () => {
    const launchDraft = {
      ...draft(),
      buySwapFeePercent: "0.1",
      sellSwapFeePercent: "7",
      classicLiquidityPreset: "deep-30" as const,
      rewardDestinationMode: "split" as const,
      rewardSplits: [
        { beneficiary: external, sharePercent: "25" },
        { beneficiary: third, sharePercent: "75" },
      ],
    };
    const decoded = decodeFunctionData({
      abi: classicV4LaunchAbi,
      data: encodeClassicV4Launch(launchDraft, salt, account),
    });

    expect(decoded.functionName).toBe("launchFor");
    if (decoded.functionName !== "launchFor") return;
    expect(decoded.args[0]).toBe(account);
    expect(decoded.args[1]).toMatchObject({
      buySwapFeeBps: 10,
      sellSwapFeeBps: 700,
      creatorSalt:
        "0x01aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rewardBeneficiaries: [external, third],
      rewardSharesBps: [2500, 7500],
    });
  });

  it("discloses the exact split and bounded liquidity before signing", () => {
    const disclosure = buildClassicV4LaunchDisclosure(
      {
        ...draft(),
        buySwapFeePercent: "0.1",
        sellSwapFeePercent: "7",
        classicLiquidityPreset: "deep-30",
        rewardDestinationMode: "split",
        rewardSplits: [
          { beneficiary: external, sharePercent: "25" },
          { beneficiary: third, sharePercent: "75" },
        ],
      },
      account,
    );

    expect(disclosure).toEqual({
      buyFee: "0.10% total · 0.00% creator · 0.10% Programmable",
      sellFee: "7.00% total · 6.90% creator · 0.10% Programmable",
      rewards: [
        { beneficiary: external, share: "25.00%" },
        { beneficiary: third, share: "75.00%" },
      ],
      liquidity:
        "Deeper · about 30% higher active liquidity at launch · bounded to about 18.9× the opening price and about 5.9 ETH net curve capacity · one position, permanently locked",
      activationBuy:
        "0.0006 ETH plus network gas · 5.895041 ETH net curve capacity remains",
      initialBuyCustody: "Available immediately",
    });
  });

  it("fails closed when an Activation Buy exceeds the Deeper range", () => {
    expect(() =>
      validateClassicV4LaunchDraft(
        {
          ...draft(),
          classicLiquidityPreset: "deep-30",
          buySwapFeePercent: "0.1",
          initialBuyEth: "5.9016",
        },
        account,
      ),
    ).toThrow("Activation Buy exceeds the Deeper curve");
  });
});
