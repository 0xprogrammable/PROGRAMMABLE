import { describe, expect, it } from "vitest";
import { decodeFunctionData, type Address } from "viem";

import {
  deepLaunchAbi,
  deepPresetDisclosure,
  encodeDeepLaunch,
  validateDeepLaunchDraft,
} from "../lib/deep-v1";
import {
  MAX_DEEP_LAUNCH_GAS_LIMIT,
  validatePreparedDeepLaunchTransactionAgainstManifest,
} from "../lib/deep-launch-validation";
import { createDeepDraft, type LaunchDraft } from "../lib/launch";
import {
  type LaunchModelReleaseManifest,
} from "../lib/launch-model-gating";
import { buildPlanHash } from "../lib/launch-transaction";

const account = "0x1111111111111111111111111111111111111111";
const external = "0x2222222222222222222222222222222222222222";
const launcher = "0x3333333333333333333333333333333333333333";
const salt =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const runtimeHash = `0x${"11".repeat(32)}`;

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
    buySwapFeePercent: "3",
    sellSwapFeePercent: "7",
    rewardDestinationMode: "external",
    rewardExternalAddress: external,
    launchSalt: salt,
  };
}

function eligibleManifest(): LaunchModelReleaseManifest {
  return {
    chainId: 1,
    status: "ready",
    launchModelReleases: {
      deep: {
        schemaVersion: 1,
        model: "deep",
        internalContractRelease: "liquidity-growth-full-range-v1",
        releaseVersion: "deep-full-range-v1",
        releaseCommit: "a".repeat(40),
        sourceCommitment: runtimeHash,
        releaseManifest:
          "contracts/deployments/mainnet-deep-full-range-v1.json",
        status: "deployment-source-and-lifecycle-verified",
        releaseEligible: true,
        sourceVerificationStatus: "verified",
        deploymentVerificationStatus: "verified",
        launcher,
        hookFactory: "0x4444444444444444444444444444444444444444",
        feeHook: "0x5555555555555555555555555555555555555555",
        feeSplitVaultFactory:
          "0x6666666666666666666666666666666666666666",
        rangeSourceFactory:
          "0x7777777777777777777777777777777777777777",
        growthVaultFactory:
          "0x8888888888888888888888888888888888888888",
        growthVaultImplementation:
          "0x9999999999999999999999999999999999999999",
        automation: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        positionPlanner:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        positionForwarderFactory:
          "0xcccccccccccccccccccccccccccccccccccccccc",
        startBlock: 123,
        deploymentBlock: 123,
        deploymentTransaction: runtimeHash,
        lifecycleEvidenceHash: runtimeHash,
        runtimeCodeHashes: {
          launcher: runtimeHash,
          hookFactory: runtimeHash,
          feeHook: runtimeHash,
          feeSplitVaultFactory: runtimeHash,
          rangeSourceFactory: runtimeHash,
          growthVaultFactory: runtimeHash,
          growthVaultImplementation: runtimeHash,
          automation: runtimeHash,
          positionPlanner: runtimeHash,
          positionForwarderFactory: runtimeHash,
        },
      },
    },
  };
}

describe("Deep launch transaction boundary", () => {
  it("uses the reviewed directional fee and immutable beneficiary rules", () => {
    const configuration = validateDeepLaunchDraft(draft(), account);
    expect(configuration.fees).toEqual({
      buySwapFeeBps: 300,
      sellSwapFeeBps: 700,
      buyCreatorFeeBps: 290,
      sellCreatorFeeBps: 690,
      platformFeeBps: 10,
    });
    expect(configuration.rewards).toEqual({
      beneficiaries: [external],
      sharesBps: [10_000],
    });
  });

  it("encodes token metadata, fees and reward ownership into one launch", () => {
    const decoded = decodeFunctionData({
      abi: deepLaunchAbi,
      data: encodeDeepLaunch(draft(), salt, account),
    });

    expect(decoded.functionName).toBe("launch");
    if (decoded.functionName !== "launch") return;
    expect(decoded.args[0]).toMatchObject({
      name: "Deep Token",
      symbol: "DEEP",
      buySwapFeeBps: 300,
      sellSwapFeeBps: 700,
      creatorSalt: salt,
      metadata: {
        description: "Liquidity grows before creator rewards begin.",
        website: "https://programmable.family/",
        image: "https://programmable.family/deep.png",
      },
      rewardBeneficiaries: [external],
      rewardSharesBps: [10_000],
    });
    expect(decoded.args[0].metadata.extraData).not.toBe("0x");
  });

  it("binds wallet review to the exact Deep calldata, value and release", () => {
    const value = draft();
    const data = encodeDeepLaunch(value, salt, account);
    const transaction = {
      kind: "launch" as const,
      chainId: 1 as const,
      to: launcher as Address,
      data,
      value: "600000000000000",
      gasLimit: "9000000",
    };
    const planHash = buildPlanHash(account, {
      kind: "launch",
      chainId: transaction.chainId,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    });

    expect(
      validatePreparedDeepLaunchTransactionAgainstManifest(
        { transaction, draft: value, account, planHash },
        eligibleManifest(),
        1,
      ),
    ).toEqual(transaction);

    expect(() =>
      validatePreparedDeepLaunchTransactionAgainstManifest(
        {
          transaction: {
            ...transaction,
            gasLimit: (MAX_DEEP_LAUNCH_GAS_LIMIT + 1n).toString(),
          },
          draft: value,
          account,
          planHash,
        },
        eligibleManifest(),
        1,
      ),
    ).toThrow("gas limit");

    expect(() =>
      validatePreparedDeepLaunchTransactionAgainstManifest(
        {
          transaction: { ...transaction, value: "600000000000001" },
          draft: value,
          account,
          planHash,
        },
        eligibleManifest(),
        1,
      ),
    ).toThrow("Dev Buy");
  });

  it("discloses the fixed growth policy without promising automation", () => {
    expect(deepPresetDisclosure()).toEqual({
      growthTarget: "0.05 ETH",
      initialPosition: "850M tokens",
      lockedReserve: "150M tokens",
      summary:
        "Creator fees deepen the original permanently locked pool before creator rewards begin.",
      reserve:
        "Unused reserve stays locked in the vault and is not active liquidity.",
      automation:
        "Automation is not guaranteed. Anyone can trigger eligible work.",
    });
  });
});
