import { describe, expect, it } from "vitest";
import { encodeFunctionData, type Address, type Hex } from "viem";

import {
  MAX_CLASSIC_LAUNCH_GAS_LIMIT,
  MIN_CLASSIC_LAUNCH_GAS_LIMIT,
  validatePreparedClassicLaunchTransaction,
  validatePreparedClassicLaunchTransactionAgainstManifest,
} from "../lib/classic-launch-validation";
import {
  isClassicProductionDeploymentReady,
  type ClassicProductionDeploymentStatus,
} from "../lib/launch-deployment";
import {
  buildPlanHash,
  encodeMemeLaunch,
  memeLaunchAbi,
} from "../lib/launch-transaction";
import {
  createEmptyDraft,
  MEME_MIN_INITIAL_BUY_WEI,
  parseInitialBuyWei,
  type LaunchDraft,
} from "../lib/launch";

const ACCOUNT = "0x2222222222222222222222222222222222222222";
const OTHER_ACCOUNT = "0x3333333333333333333333333333333333333333";
const LAUNCHER = "0xD240D06f8586eB799f20056054e5b527405E6bAd";
const OTHER_LAUNCHER =
  "0x4444444444444444444444444444444444444444";
const SALT =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const readyManifest = {
  chainId: 1,
  status: "ready",
  memeLaunchStatus: "ready",
  memeLaunch: LAUNCHER,
} satisfies ClassicProductionDeploymentStatus & {
  memeLaunch: Address;
};

function draft(): LaunchDraft {
  return {
    ...createEmptyDraft(),
    tokenName: "Programmable Flower",
    tokenSymbol: "FLOWER",
    tokenDescription: "A fixed-supply token",
    tokenWebsite: "https://programmable.family/flower",
    tokenImage: "https://programmable.family/flower.png",
    tokenX: "https://x.com/0xProgrammable",
    tokenTelegram: "https://t.me/programmable",
    totalSwapFeePercent: "1",
    launchSalt: SALT,
  };
}

function preparedLaunch(
  launchDraft = draft(),
  overrides: Partial<{
    chainId: number;
    to: Address;
    data: Hex;
    value: string;
    gasLimit: string;
  }> = {},
) {
  const initialBuyWei = parseInitialBuyWei(launchDraft.initialBuyEth);
  if (initialBuyWei === null) {
    throw new Error("Invalid test Dev Buy");
  }
  const transaction = {
    kind: "launch" as const,
    chainId: overrides.chainId ?? 1,
    to: overrides.to ?? LAUNCHER,
    data:
      overrides.data ??
      encodeMemeLaunch(launchDraft, launchDraft.launchSalt as Hex),
    value: overrides.value ?? initialBuyWei.toString(),
    gasLimit: overrides.gasLimit ?? "4000000",
  };
  const hashBase = {
    kind: transaction.kind,
    chainId: 1 as const,
    to: transaction.to,
    data: transaction.data,
    value: transaction.value,
  };
  return {
    transaction,
    planHash: buildPlanHash(ACCOUNT, hashBase),
  };
}

describe("Classic production deployment gate", () => {
  it("requires both the shared production status and Classic status", () => {
    expect(isClassicProductionDeploymentReady(readyManifest)).toBe(true);
    expect(
      isClassicProductionDeploymentReady({
        ...readyManifest,
        status: "not-deployed",
      }),
    ).toBe(false);
    expect(
      isClassicProductionDeploymentReady({
        ...readyManifest,
        memeLaunchStatus: "not-deployed",
      }),
    ).toBe(false);
  });
});

describe("prepared Classic launch boundary", () => {
  it("accepts the exact canonical production manifest by default", () => {
    const currentDraft = draft();
    const prepared = preparedLaunch(currentDraft);

    expect(
      validatePreparedClassicLaunchTransaction({
        ...prepared,
        draft: currentDraft,
        account: ACCOUNT,
      }),
    ).toEqual(prepared.transaction);
  });

  it("accepts the exact current draft, account, manifest target and gas range", () => {
    const currentDraft = draft();
    const prepared = preparedLaunch(currentDraft);

    expect(
      validatePreparedClassicLaunchTransactionAgainstManifest(
        {
          ...prepared,
          draft: currentDraft,
          account: ACCOUNT,
        },
        readyManifest,
      ),
    ).toEqual(prepared.transaction);
  });

  it("accepts a larger Dev Buy when the selected amount and transaction match", () => {
    const currentDraft = { ...draft(), initialBuyEth: "0.002" };
    const prepared = preparedLaunch(currentDraft);

    expect(
      validatePreparedClassicLaunchTransactionAgainstManifest(
        {
          ...prepared,
          draft: currentDraft,
          account: ACCOUNT,
        },
        readyManifest,
      ),
    ).toEqual(prepared.transaction);
  });

  it("rejects inconsistent manifests and noncanonical destinations", () => {
    const currentDraft = draft();
    const prepared = preparedLaunch(currentDraft);

    expect(() =>
      validatePreparedClassicLaunchTransactionAgainstManifest(
        {
          ...prepared,
          draft: currentDraft,
          account: ACCOUNT,
        },
        { ...readyManifest, status: "not-deployed" },
      ),
    ).toThrow("not enabled");
    expect(() =>
      validatePreparedClassicLaunchTransactionAgainstManifest(
        {
          ...prepared,
          transaction: {
            ...prepared.transaction,
            to: OTHER_LAUNCHER,
          },
          draft: currentDraft,
          account: ACCOUNT,
        },
        readyManifest,
      ),
    ).toThrow("release manifest");
  });

  it("rejects value, chain and gas outside the Classic envelope", () => {
    const currentDraft = draft();
    const cases = [
      preparedLaunch(currentDraft, { value: "0" }),
      preparedLaunch(currentDraft, {
        value: (MEME_MIN_INITIAL_BUY_WEI + 1n).toString(),
      }),
      preparedLaunch(currentDraft, { chainId: 11_155_111 }),
      preparedLaunch(currentDraft, {
        gasLimit: (MIN_CLASSIC_LAUNCH_GAS_LIMIT - 1n).toString(),
      }),
      preparedLaunch(currentDraft, {
        gasLimit: (MAX_CLASSIC_LAUNCH_GAS_LIMIT + 1n).toString(),
      }),
    ];

    for (const prepared of cases) {
      expect(() =>
        validatePreparedClassicLaunchTransactionAgainstManifest(
          {
            ...prepared,
            draft: currentDraft,
            account: ACCOUNT,
          },
          readyManifest,
        ),
      ).toThrow();
    }
  });

  it("rejects a prepared value that differs from the selected Dev Buy", () => {
    const currentDraft = { ...draft(), initialBuyEth: "0.002" };
    const prepared = preparedLaunch(currentDraft, {
      value: MEME_MIN_INITIAL_BUY_WEI.toString(),
    });

    expect(() =>
      validatePreparedClassicLaunchTransactionAgainstManifest(
        {
          ...prepared,
          draft: currentDraft,
          account: ACCOUNT,
        },
        readyManifest,
      ),
    ).toThrow("Dev Buy");
  });

  it("rejects another selector and any changed launch argument", () => {
    const currentDraft = draft();
    const wrongSelector = preparedLaunch(currentDraft, {
      data: encodeFunctionData({
        abi: memeLaunchAbi,
        functionName: "predictTokenAddress",
        args: [
          currentDraft.tokenName,
          currentDraft.tokenSymbol,
          ACCOUNT,
          SALT,
        ],
      }),
    });
    expect(() =>
      validatePreparedClassicLaunchTransactionAgainstManifest(
        {
          ...wrongSelector,
          draft: currentDraft,
          account: ACCOUNT,
        },
        readyManifest,
      ),
    ).toThrow("launch function");

    const changedDrafts = [
      { ...currentDraft, tokenName: "Different" },
      { ...currentDraft, totalSwapFeePercent: "2" },
      { ...currentDraft, tokenDescription: "Different metadata" },
      { ...currentDraft, tokenX: "https://x.com/different" },
      {
        ...currentDraft,
        launchSalt:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ];
    for (const changed of changedDrafts) {
      const changedCall = preparedLaunch(changed);
      expect(() =>
        validatePreparedClassicLaunchTransactionAgainstManifest(
          {
            ...changedCall,
            draft: currentDraft,
            account: ACCOUNT,
          },
          readyManifest,
        ),
      ).toThrow("current token setup");
    }
  });

  it("binds the plan hash to the connected account", () => {
    const currentDraft = draft();
    const prepared = preparedLaunch(currentDraft);
    const otherAccountPlanHash = buildPlanHash(OTHER_ACCOUNT, {
      kind: prepared.transaction.kind,
      chainId: 1,
      to: prepared.transaction.to,
      data: prepared.transaction.data,
      value: prepared.transaction.value,
    });

    expect(() =>
      validatePreparedClassicLaunchTransactionAgainstManifest(
        {
          ...prepared,
          planHash: otherAccountPlanHash,
          draft: currentDraft,
          account: ACCOUNT,
        },
        readyManifest,
      ),
    ).toThrow("connected wallet");
  });
});
