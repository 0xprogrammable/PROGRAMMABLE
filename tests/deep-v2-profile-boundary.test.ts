import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  getAddress,
  type Hex,
} from "viem";

import {
  assertDeepV2LaunchCandidate,
  deepV2GrowthVaultProfileAbi,
  deepV2TokenLaunchedEvent,
  encodeDeepV2RewardAction,
  validatePreparedDeepV2RewardAction,
  type DeepV2LaunchCandidate,
  type DeepV2ProfileRelease,
} from "../lib/profile/deep-v2-rewards";

const ACCOUNT = getAddress("0x1111111111111111111111111111111111111111");
const PAYOUT = getAddress("0x2222222222222222222222222222222222222222");
const TOKEN = getAddress("0x3333333333333333333333333333333333333333");
const VAULT = getAddress("0x4444444444444444444444444444444444444444");
const HOOK = getAddress("0x5555555555555555555555555555555555555555");
const LAUNCHER = getAddress("0x6666666666666666666666666666666666666666");
const FACTORY = getAddress("0x7777777777777777777777777777777777777777");
const POOL_ID = `0x${"88".repeat(32)}` as Hex;
const LAUNCH_HASH = `0x${"99".repeat(32)}` as Hex;
const CONFIGURATION_HASH = `0x${"aa".repeat(32)}` as Hex;
const TRANSACTION_HASH = `0x${"bb".repeat(32)}` as Hex;
const BLOCK_HASH = `0x${"cc".repeat(32)}` as Hex;

const release: DeepV2ProfileRelease = {
  chainId: 1,
  releaseVersion: "deep-full-range-v2",
  launcher: LAUNCHER,
  launcherRuntimeCodeHash: BLOCK_HASH,
  feeHook: HOOK,
  feeHookRuntimeCodeHash: BLOCK_HASH,
  growthVaultFactory: FACTORY,
  growthVaultFactoryRuntimeCodeHash: BLOCK_HASH,
  growthVaultImplementation: getAddress(
    "0x9999999999999999999999999999999999999999",
  ),
  growthVaultImplementationRuntimeCodeHash: BLOCK_HASH,
  automation: getAddress("0x8888888888888888888888888888888888888888"),
  automationRuntimeCodeHash: BLOCK_HASH,
};

function candidate(
  overrides: Partial<DeepV2LaunchCandidate> = {},
): DeepV2LaunchCandidate {
  return {
    deepReleaseVersion: "deep-full-range-v2",
    launcher: LAUNCHER,
    creator: ACCOUNT,
    tokenAddress: TOKEN,
    vaultAddress: VAULT,
    hookAddress: HOOK,
    poolId: POOL_ID,
    launchHash: LAUNCH_HASH,
    vaultConfigurationHash: CONFIGURATION_HASH,
    blockNumber: 123n,
    blockHash: BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    logIndex: 4,
    ...overrides,
  };
}

describe("Deep V2 profile provenance", () => {
  it("accepts only an explicitly versioned launch from the verified V2 release", () => {
    expect(assertDeepV2LaunchCandidate(candidate(), release)).toEqual(
      candidate(),
    );

    expect(() =>
      assertDeepV2LaunchCandidate(
        candidate({
          deepReleaseVersion: "deep-full-range-v1" as "deep-full-range-v2",
        }),
        release,
      ),
    ).toThrow("V2 release");
    expect(() =>
      assertDeepV2LaunchCandidate(
        candidate({ launcher: ACCOUNT }),
        release,
      ),
    ).toThrow("launcher");
    expect(() =>
      assertDeepV2LaunchCandidate(
        candidate({ hookAddress: ACCOUNT }),
        release,
      ),
    ).toThrow("hook");
    expect(() =>
      assertDeepV2LaunchCandidate(candidate(), {
        ...release,
        automation:
          "0x0000000000000000000000000000000000000000",
      }),
    ).toThrow("automation");
  });

  it("uses the suffixed V2 launch event and one-beneficiary vault API", () => {
    expect(deepV2TokenLaunchedEvent.name).toBe(
      "LiquidityGrowthFullRangeTokenLaunchedV2",
    );
    const claim = encodeDeepV2RewardAction({ action: "claim" });
    const decodedClaim = decodeFunctionData({
      abi: deepV2GrowthVaultProfileAbi,
      data: claim,
    });
    expect(decodedClaim.functionName).toBe("claimRewards");

    const update = encodeDeepV2RewardAction({
      action: "update-payout",
      newPayoutAddress: PAYOUT,
    });
    const decodedUpdate = decodeFunctionData({
      abi: deepV2GrowthVaultProfileAbi,
      data: update,
    });
    expect(decodedUpdate).toEqual({
      functionName: "setPayoutAddress",
      args: [PAYOUT],
    });
  });
});

describe("Deep V2 prepared reward transaction boundary", () => {
  it("accepts only the exact zero-value creator claim to the canonical V2 vault", () => {
    const data = encodeDeepV2RewardAction({ action: "claim" });
    const parsed = validatePreparedDeepV2RewardAction(
      {
        status: "ready",
        action: "claim",
        account: ACCOUNT,
        vaultAddress: VAULT,
        deepReleaseVersion: "deep-full-range-v2",
        transaction: {
          kind: "claim-deep-rewards",
          chainId: 1,
          from: ACCOUNT,
          to: VAULT,
          data,
          value: "0",
          gasLimit: "120000",
        },
      },
      {
        action: "claim",
        account: ACCOUNT,
        chainId: 1,
        candidate: candidate(),
        release,
      },
    );

    expect(parsed.transaction.to).toBe(VAULT);
    expect(parsed.transaction.from).toBe(ACCOUNT);

    expect(() =>
      validatePreparedDeepV2RewardAction(
        {
          status: "ready",
          action: "claim",
          account: ACCOUNT,
          vaultAddress: VAULT,
          deepReleaseVersion: "deep-full-range-v2",
          transaction: {
            kind: "claim-deep-rewards",
            chainId: 1,
            from: ACCOUNT,
            to: FACTORY,
            data,
            value: "0",
            gasLimit: "120000",
          },
        },
        {
          action: "claim",
          account: ACCOUNT,
          chainId: 1,
          candidate: candidate(),
          release,
        },
      ),
    ).toThrow("canonical");
  });

  it("binds a payout update to the exact new address", () => {
    const expected = {
      action: "update-payout" as const,
      account: ACCOUNT,
      chainId: 1,
      candidate: candidate(),
      release,
      newPayoutAddress: PAYOUT,
    };
    const response = {
      status: "ready",
      action: "update-payout",
      account: ACCOUNT,
      vaultAddress: VAULT,
      deepReleaseVersion: "deep-full-range-v2",
      transaction: {
        kind: "update-deep-payout",
        chainId: 1,
        from: ACCOUNT,
        to: VAULT,
        data: encodeDeepV2RewardAction({
          action: "update-payout",
          newPayoutAddress: PAYOUT,
        }),
        value: "0",
        gasLimit: "90000",
      },
    };

    expect(
      validatePreparedDeepV2RewardAction(response, expected).transaction.kind,
    ).toBe("update-deep-payout");
    expect(() =>
      validatePreparedDeepV2RewardAction(response, {
        ...expected,
        newPayoutAddress: ACCOUNT,
      }),
    ).toThrow("new payout");
  });
});
