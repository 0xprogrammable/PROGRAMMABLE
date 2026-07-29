import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";

import { deepV3TokenLaunchedEvent } from "../lib/deep-v3";
import {
  parseDeepV3LaunchReceipts,
  type DeepV3LaunchReceipt,
} from "../lib/deep-v3-launch-confirmation";

const account = getAddress(
  "0x1111111111111111111111111111111111111111",
);
const launcher = getAddress(
  "0x2222222222222222222222222222222222222222",
);
const token = getAddress(
  "0x3333333333333333333333333333333333333333",
);
const hook = getAddress(
  "0x4444444444444444444444444444444444443AEC",
);
const vault = getAddress(
  "0x5555555555555555555555555555555555555555",
);
const positionRecipient = getAddress(
  "0x6666666666666666666666666666666666666666",
);
const transactionHash = `0x${"77".repeat(32)}` as Hex;
const blockHash = `0x${"88".repeat(32)}` as Hex;
const poolId = `0x${"99".repeat(32)}` as Hex;
const configurationHash = `0x${"aa".repeat(32)}` as Hex;
const launchHash = `0x${"bb".repeat(32)}` as Hex;

function receipt(
  overrides: Partial<DeepV3LaunchReceipt> = {},
): DeepV3LaunchReceipt {
  const topics = encodeEventTopics({
    abi: [deepV3TokenLaunchedEvent],
    eventName: "LiquidityGrowthFullRangeTokenLaunchedV3",
    args: {
      deployer: account,
      token,
      poolId,
    },
  }) as unknown as readonly Hex[];
  const data = encodeAbiParameters(
    parseAbiParameters(
      "address feeHook,address growthVault,address positionRecipient,uint256 positionTokenId,bytes32 vaultConfigurationHash,bytes32 launchHash",
    ),
    [
      hook,
      vault,
      positionRecipient,
      42n,
      configurationHash,
      launchHash,
    ],
  );
  const base: DeepV3LaunchReceipt = {
    status: "success" as const,
    from: account,
    to: launcher,
    blockNumber: 500n,
    blockHash,
    transactionHash,
    transactionIndex: 3,
    logs: [
      {
        address: launcher,
        topics,
        data,
        logIndex: 7,
      },
    ],
  };
  return { ...base, ...overrides };
}

describe("Deep V3 launch receipt confirmation", () => {
  it("accepts one launch event agreed by both providers", () => {
    expect(
      parseDeepV3LaunchReceipts({
        receipts: [receipt(), receipt()],
        release: {
          startBlock: 100,
          launcher,
          feeHook: hook,
        },
        account,
        transactionHash,
      }),
    ).toMatchObject({
      deepReleaseVersion: "deep-full-range-v3",
      launchModel: "deep",
      creator: account,
      tokenAddress: token,
      vaultAddress: vault,
      hookAddress: hook,
      positionRecipient,
      positionTokenId: "42",
      poolId,
      launchHash,
      vaultConfigurationHash: configurationHash,
      blockNumber: "500",
      blockHash,
      transactionHash,
      transactionIndex: 3,
      logIndex: 7,
    });
  });

  it("fails closed on provider disagreement or another creator", () => {
    expect(() =>
      parseDeepV3LaunchReceipts({
        receipts: [
          receipt(),
          receipt({ blockHash: `0x${"cc".repeat(32)}` as Hex }),
        ],
        release: {
          startBlock: 100,
          launcher,
          feeHook: hook,
        },
        account,
        transactionHash,
      }),
    ).toThrow("disagree");

    expect(() =>
      parseDeepV3LaunchReceipts({
        receipts: [receipt(), receipt()],
        release: {
          startBlock: 100,
          launcher,
          feeHook: hook,
        },
        account:
          "0x7777777777777777777777777777777777777777" as Address,
        transactionHash,
      }),
    ).toThrow("wallet");
  });
});
