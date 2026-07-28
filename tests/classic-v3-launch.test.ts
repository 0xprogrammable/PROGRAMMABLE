import { describe, expect, it } from "vitest";
import { decodeFunctionData, type Address } from "viem";

import appDeployments from "../contracts/config/app-deployments.v1.json";
import {
  classicV3LaunchAbi,
  encodeClassicV3Launch,
  isClassicV3DeploymentReady,
  validateClassicV3LaunchDraft,
  type ClassicV3DeploymentManifest,
} from "../lib/classic-v3";
import {
  MAX_CLASSIC_V3_LAUNCH_GAS_LIMIT,
  validatePreparedClassicV3LaunchTransactionAgainstManifest,
} from "../lib/classic-v3-launch-validation";
import { createClassicV3Draft, type LaunchDraft } from "../lib/launch";
import { buildPlanHash } from "../lib/launch-transaction";

const account = "0x1111111111111111111111111111111111111111";
const external = "0x2222222222222222222222222222222222222222";
const third = "0x3333333333333333333333333333333333333333";
const launcher = "0x4444444444444444444444444444444444444444";
const salt =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hash = `0x${"11".repeat(32)}`;

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

function readyManifest(): ClassicV3DeploymentManifest {
  return {
    chainId: 1,
    classicV3Status: "ready",
    ethCreatorFeeHookFactoryV3:
      "0x5555555555555555555555555555555555555555",
    ethCreatorFeeHookV3:
      "0x6666666666666666666666666666666666666666",
    feeSplitVaultFactoryV1:
      "0x7777777777777777777777777777777777777777",
    memeLaunchV2: launcher,
    lockedPositionFeeForwarderFactory:
      "0x8888888888888888888888888888888888888888",
    runtimeCodeHashes: {
      ethCreatorFeeHookFactoryV3: hash,
      ethCreatorFeeHookV3: hash,
      feeSplitVaultFactoryV1: hash,
      memeLaunchV2: hash,
      lockedPositionFeeForwarderFactory: hash,
    },
    deploymentBlocks: { memeLaunchV2: 123 },
  };
}

describe("Classic V3 launch configuration", () => {
  it("keeps the current release hard-gated until real deployment data exists", () => {
    expect(
      isClassicV3DeploymentReady(
        appDeployments.production as unknown as ClassicV3DeploymentManifest,
        1,
      ),
    ).toBe(false);
    expect(isClassicV3DeploymentReady(readyManifest(), 1)).toBe(true);
    expect(
      isClassicV3DeploymentReady(
        { ...readyManifest(), memeLaunchV2: null },
        1,
      ),
    ).toBe(false);
  });

  it("validates immutable directional fees and deducts exactly 10 bps", () => {
    const configuration = validateClassicV3LaunchDraft(
      {
        ...draft(),
        buySwapFeePercent: "1",
        sellSwapFeePercent: "10",
      },
      account,
    );
    expect(configuration.fees).toEqual({
      buySwapFeeBps: 100,
      sellSwapFeeBps: 1000,
      buyCreatorFeeBps: 90,
      sellCreatorFeeBps: 990,
      platformFeeBps: 10,
    });
    expect(configuration.rewards).toEqual({
      beneficiaries: [account],
      sharesBps: [10_000],
    });

    for (const value of ["0", "1.5", "11"]) {
      expect(() =>
        validateClassicV3LaunchDraft(
          { ...draft(), buySwapFeePercent: value },
          account,
        ),
      ).toThrow("whole percentage");
    }
  });

  it("supports one external beneficiary and fixed unique splits", () => {
    expect(
      validateClassicV3LaunchDraft(
        {
          ...draft(),
          rewardDestinationMode: "external",
          rewardExternalAddress: external,
        },
        account,
      ).rewards,
    ).toEqual({
      beneficiaries: [external],
      sharesBps: [10_000],
    });

    const split = validateClassicV3LaunchDraft(
      {
        ...draft(),
        rewardDestinationMode: "split",
        rewardSplits: [
          { beneficiary: external, sharePercent: "33.33" },
          { beneficiary: third, sharePercent: "66.67" },
        ],
      },
      account,
    );
    expect(split.rewards).toEqual({
      beneficiaries: [external, third],
      sharesBps: [3333, 6667],
    });
    expect(() =>
      validateClassicV3LaunchDraft(
        {
          ...draft(),
          rewardDestinationMode: "split",
          rewardSplits: [
            { beneficiary: external, sharePercent: "50" },
            { beneficiary: external, sharePercent: "50" },
          ],
        },
        account,
      ),
    ).toThrow("unique");
    expect(() =>
      validateClassicV3LaunchDraft(
        {
          ...draft(),
          rewardDestinationMode: "split",
          rewardSplits: [
            { beneficiary: external, sharePercent: "40" },
            { beneficiary: third, sharePercent: "50" },
          ],
        },
        account,
      ),
    ).toThrow("exactly 100%");
  });

  it("encodes every immutable fee and beneficiary setting", () => {
    const launchDraft = {
      ...draft(),
      buySwapFeePercent: "3",
      sellSwapFeePercent: "7",
      rewardDestinationMode: "split" as const,
      rewardSplits: [
        { beneficiary: external, sharePercent: "25" },
        { beneficiary: third, sharePercent: "75" },
      ],
    };
    const decoded = decodeFunctionData({
      abi: classicV3LaunchAbi,
      data: encodeClassicV3Launch(launchDraft, salt, account),
    });
    expect(decoded.functionName).toBe("launch");
    if (decoded.functionName !== "launch") return;
    expect(decoded.args[0]).toMatchObject({
      buySwapFeeBps: 300,
      sellSwapFeeBps: 700,
      rewardBeneficiaries: [external, third],
      rewardSharesBps: [2500, 7500],
    });
  });

  it("binds wallet review to the exact V3 calldata, account and manifest", () => {
    const launchDraft = {
      ...draft(),
      rewardDestinationMode: "external" as const,
      rewardExternalAddress: external,
    };
    const data = encodeClassicV3Launch(launchDraft, salt, account);
    const transaction = {
      kind: "launch" as const,
      chainId: 1 as const,
      to: launcher as Address,
      data,
      value: "600000000000000",
      gasLimit: "5000000",
    };
    const planHash = buildPlanHash(account, {
      kind: "launch",
      chainId: 1,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    });
    expect(
      validatePreparedClassicV3LaunchTransactionAgainstManifest(
        { transaction, draft: launchDraft, account, planHash },
        readyManifest(),
      ),
    ).toEqual(transaction);
    expect(() =>
      validatePreparedClassicV3LaunchTransactionAgainstManifest(
        {
          transaction: {
            ...transaction,
            gasLimit: (MAX_CLASSIC_V3_LAUNCH_GAS_LIMIT + 1n).toString(),
          },
          draft: launchDraft,
          account,
          planHash,
        },
        readyManifest(),
      ),
    ).toThrow("gas limit");
  });
});
