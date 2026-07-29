import { describe, expect, it, vi } from "vitest";
import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import { DEEP_V2_MANIFEST_FIXED_POLICY } from "../lib/deep-v2";
import type { LaunchModelReleaseManifest } from "../lib/launch-model-gating";
import {
  prepareDeepV2RewardAction,
  readDeepV2RewardProfile,
  type DeepV2ProfileClient,
} from "../lib/profile/deep-v2-profile.server";
import {
  type DeepV2LaunchCandidate,
} from "../lib/profile/deep-v2-rewards";

vi.mock("server-only", () => ({}));
vi.mock("@/ops/deep-keeper-v2/reviewed-release-binding.json", () => ({
  default: {
    schemaVersion: 1,
    status: "reviewed",
    manifestPath:
      "contracts/deployments/mainnet-deep-full-range-v2.json",
    model: "deep",
    releaseVersion: "deep-full-range-v2",
    internalContractRelease: "liquidity-growth-full-range-v2",
    sourceCommitment:
      "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
    automationAddress:
      "0x5050505050505050505050505050505050505050",
    automationRuntimeCodeHash:
      "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
    automationFqcn:
      "src/LiquidityGrowthFullRangeAutomationV2.sol:LiquidityGrowthFullRangeAutomationV2",
    coordinatorAddress:
      "0x8080808080808080808080808080808080808080",
    coordinatorRuntimeCodeHash:
      "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
    coordinatorSourceCommitment:
      "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
    coordinatorFqcn:
      "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1",
  },
}));

const ACCOUNT = getAddress("0x1111111111111111111111111111111111111111");
const PAYOUT = getAddress("0x2222222222222222222222222222222222222222");
const TOKEN = getAddress("0x3333333333333333333333333333333333333333");
const VAULT = getAddress("0x4444444444444444444444444444444444444444");
const HOOK = getAddress("0x5555555555555555555555555555555555555555");
const LAUNCHER = getAddress("0x6666666666666666666666666666666666666666");
const FACTORY = getAddress("0x7777777777777777777777777777777777777777");
const UPSTREAM = getAddress("0x8888888888888888888888888888888888888888");
const ORACLE = getAddress("0x9999999999999999999999999999999999999999");
const AUTOMATION = getAddress(
  "0x5050505050505050505050505050505050505050",
);
const IMPLEMENTATION = getAddress(
  "0x4040404040404040404040404040404040404040",
);
const POOL_ID = `0x${"88".repeat(32)}` as Hex;
const LAUNCH_HASH = `0x${"99".repeat(32)}` as Hex;
const CONFIGURATION_HASH = `0x${"aa".repeat(32)}` as Hex;
const TRANSACTION_HASH = `0x${"bb".repeat(32)}` as Hex;
const LAUNCH_BLOCK_HASH = `0x${"cc".repeat(32)}` as Hex;
const SNAPSHOT_BLOCK_HASH = `0x${"dd".repeat(32)}` as Hex;
const RUNTIME_CODE = "0x6000" as Hex;
const RUNTIME_HASH = keccak256(RUNTIME_CODE);

function manifest(eligible = true): LaunchModelReleaseManifest {
  return {
    chainId: 1,
    status: "ready",
    launchModelReleases: {
      deep: {
        schemaVersion: 2,
        model: "deep",
        internalContractRelease: "liquidity-growth-full-range-v2",
        releaseVersion: "deep-full-range-v2",
        releaseCommit: "1".repeat(40),
        sourceCommitment: RUNTIME_HASH,
        releaseManifest:
          "contracts/deployments/mainnet-deep-full-range-v2.json",
        status: "deployment-source-and-lifecycle-verified",
        releaseEligible: eligible,
        sourceVerificationStatus: "verified",
        deploymentVerificationStatus: "verified",
        launcher: LAUNCHER,
        hookFactory: getAddress(
          "0x1010101010101010101010101010101010101010",
        ),
        feeHook: HOOK,
        feeSplitVaultFactory: getAddress(
          "0x2020202020202020202020202020202020202020",
        ),
        rangeSourceFactory: getAddress(
          "0x3030303030303030303030303030303030303030",
        ),
        growthVaultFactory: FACTORY,
        growthVaultImplementation: IMPLEMENTATION,
        automation: AUTOMATION,
        positionPlanner: getAddress(
          "0x6060606060606060606060606060606060606060",
        ),
        positionForwarderFactory: getAddress(
          "0x7070707070707070707070707070707070707070",
        ),
        startBlock: 100,
        deploymentBlock: 100,
        deploymentTransaction: RUNTIME_HASH,
        lifecycleEvidenceHash: RUNTIME_HASH,
        lifecycleStatus: "verified-current-release",
        lifecycleIndependentRpcCount: 2,
        lifecycleLaunchTransaction: `0x${"22".repeat(32)}`,
        lifecycleOracleTransaction: `0x${"33".repeat(32)}`,
        lifecycleFeeProcessCompoundTransaction: `0x${"44".repeat(32)}`,
        keeperReleaseVersion: "deep-keeper-v2",
        keeperCompatibilityStatus: "verified-deep-v2",
        keeperExecutor: getAddress(
          "0x8080808080808080808080808080808080808080",
        ),
        keeperExecutorRuntimeCodeHash: RUNTIME_HASH,
        keeperExecutorSourceCommitment: RUNTIME_HASH,
        keeperExecutorDeploymentTransaction: `0x${"55".repeat(32)}`,
        keeperExecutorDeploymentBlock: 101,
        keeperExecutorSourceVerificationStatus:
          "etherscan-and-sourcify-exact-match",
        fixedPolicy: { ...DEEP_V2_MANIFEST_FIXED_POLICY },
        runtimeCodeHashes: {
          launcher: RUNTIME_HASH,
          hookFactory: RUNTIME_HASH,
          feeHook: RUNTIME_HASH,
          feeSplitVaultFactory: RUNTIME_HASH,
          rangeSourceFactory: RUNTIME_HASH,
          growthVaultFactory: RUNTIME_HASH,
          growthVaultImplementation: RUNTIME_HASH,
          automation: RUNTIME_HASH,
          positionPlanner: RUNTIME_HASH,
          positionForwarderFactory: RUNTIME_HASH,
        },
      },
    },
  };
}

function candidate(): DeepV2LaunchCandidate {
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
    blockHash: LAUNCH_BLOCK_HASH,
    transactionHash: TRANSACTION_HASH,
    logIndex: 4,
  };
}

function client(overrides?: {
  beneficiaryCount?: bigint;
  payoutAddress?: Address;
  claimable?: bigint;
  chainId?: number;
  automationRegistered?: boolean;
  runtimeMismatchAt?: Address;
}) {
  let calls = 0;
  const profileClient: DeepV2ProfileClient = {
    async getChainId() {
      calls += 1;
      return overrides?.chainId ?? 1;
    },
    async getBlockNumber() {
      calls += 1;
      return 200n;
    },
    async getBlock({ blockNumber }) {
      calls += 1;
      return {
        hash:
          blockNumber === 123n ? LAUNCH_BLOCK_HASH : SNAPSHOT_BLOCK_HASH,
      };
    },
    async getCode({ address }) {
      calls += 1;
      return address === overrides?.runtimeMismatchAt
        ? ("0x6001" as Hex)
        : RUNTIME_CODE;
    },
    async getLogs() {
      calls += 1;
      return [
        {
          args: {
            deployer: ACCOUNT,
            token: TOKEN,
            poolId: POOL_ID,
            feeHook: HOOK,
            growthVault: VAULT,
            oracleGuard: ORACLE,
            upstreamRewardVault: UPSTREAM,
            positionRecipient: getAddress(
              "0x1212121212121212121212121212121212121212",
            ),
            positionTokenId: 77n,
            buySwapFeeBps: 100,
            sellSwapFeeBps: 100,
            vaultConfigurationHash: CONFIGURATION_HASH,
            launchHash: LAUNCH_HASH,
          },
          blockNumber: 123n,
          blockHash: LAUNCH_BLOCK_HASH,
          transactionHash: TRANSACTION_HASH,
          logIndex: 4,
          removed: false,
        },
      ];
    },
    async readContract({ address, functionName }) {
      calls += 1;
      if (address === LAUNCHER) {
        if (functionName === "growthVaultOf") return VAULT;
        if (functionName === "launchHashOf") return LAUNCH_HASH;
      }
      if (address === FACTORY) {
        if (functionName === "isFactoryVault") return true;
        if (functionName === "configurationHashOf") {
          return CONFIGURATION_HASH;
        }
      }
      if (address === HOOK && functionName === "poolFeeConfig") {
        return [UPSTREAM, LAUNCHER, 100, 100, true, 3n] as const;
      }
      if (address === AUTOMATION && functionName === "isRegisteredVault") {
        return overrides?.automationRegistered ?? true;
      }
      if (address === VAULT) {
        const values: Record<string, unknown> = {
          initialized: true,
          feeHook: HOOK,
          oracleGuard: ORACLE,
          upstreamVault: UPSTREAM,
          poolId: POOL_ID,
          token: TOKEN,
          creator: ACCOUNT,
          configurationHash: CONFIGURATION_HASH,
          beneficiaryCount: overrides?.beneficiaryCount ?? 1n,
          beneficiaryAt: ACCOUNT,
          shareBpsOf: 10_000,
          payoutAddressOf: overrides?.payoutAddress ?? PAYOUT,
          claimedBy: 2n,
          claimable: overrides?.claimable ?? 5n,
          growthTargetNative: 50_000_000_000_000_000n,
          tokenReserveTarget:
            150_000_000n * 10n ** 18n,
          completionToleranceNative: 1_000_000_000_000n,
          minimumNativeLiquidityForCompletion:
            49_999_000_000_000_000n,
          totalCreatorFeesReceived: 12n,
          totalNativeAllocatedToGrowth: 7n,
          totalRewardFeesReceived: 7n,
          deferredRewardFees: 7n,
          totalRewardFeesClaimed: 2n,
          pendingGrowthNative: 3n,
          totalNativeAddedToLiquidity: 4n,
          totalTokenAddedToLiquidity: 6n,
          growthTargetReached: true,
          oracleReady: true,
          workState: [2, 3n, 3n, 1_000n, 2_000n, 5n] as const,
        };
        if (functionName in values) return values[functionName];
      }
      throw new Error(`Unexpected read ${address}:${functionName}`);
    },
    async call() {
      calls += 1;
      return { data: "0x" as Hex };
    },
    async estimateGas() {
      calls += 1;
      return 100_000n;
    },
    async getGasPrice() {
      calls += 1;
      return 2n;
    },
    async getBalance() {
      calls += 1;
      return 10n ** 18n;
    },
  };
  return { profileClient, calls: () => calls };
}

describe("Deep V2 server profile boundary", () => {
  it("fails before touching RPC when the exact V2 release is not eligible", async () => {
    const first = client();
    const second = client();
    await expect(
      readDeepV2RewardProfile({
        manifest: manifest(false),
        chainId: 1,
        account: ACCOUNT,
        candidate: candidate(),
        clients: [first.profileClient, second.profileClient],
      }),
    ).rejects.toThrow("verified Deep V2 release");
    expect(first.calls() + second.calls()).toBe(0);
  });

  it("fails before touching RPC when indexer provenance names another launcher", async () => {
    const first = client();
    const second = client();
    await expect(
      readDeepV2RewardProfile({
        manifest: manifest(),
        chainId: 1,
        account: ACCOUNT,
        candidate: {
          ...candidate(),
          launcher: getAddress(
            "0x9090909090909090909090909090909090909090",
          ),
        },
        clients: [first.profileClient, second.profileClient],
      }),
    ).rejects.toThrow("verified release");
    expect(first.calls() + second.calls()).toBe(0);
  });

  it("rejects a release dependency whose runtime no longer matches the manifest", async () => {
    const first = client();
    const second = client({ runtimeMismatchAt: FACTORY });
    await expect(
      readDeepV2RewardProfile({
        manifest: manifest(),
        chainId: 1,
        account: ACCOUNT,
        candidate: candidate(),
        clients: [first.profileClient, second.profileClient],
      }),
    ).rejects.toThrow("runtime");
  });

  it("reads one canonical creator reward at a shared confirmed snapshot", async () => {
    const first = client();
    const second = client();
    const profile = await readDeepV2RewardProfile({
      manifest: manifest(),
      chainId: 1,
      account: ACCOUNT,
      candidate: candidate(),
      clients: [first.profileClient, second.profileClient],
    });

    expect(profile).toMatchObject({
      status: "ready",
      deepReleaseVersion: "deep-full-range-v2",
      chainId: 1,
      account: ACCOUNT,
      snapshot: {
        blockNumber: "188",
        blockHash: SNAPSHOT_BLOCK_HASH,
      },
      reward: {
        tokenAddress: TOKEN,
        vaultAddress: VAULT,
        payoutAddress: PAYOUT,
        shareBps: 10_000,
        claimableWei: "5",
        claimedWei: "2",
        buySwapFeeBps: 100,
        sellSwapFeeBps: 100,
        platformFeeBps: 10,
        growthTargetWei: "50000000000000000",
        automationAction: 2,
      },
    });
  });

  it("rejects a vault that exposes more than the fixed creator beneficiary", async () => {
    const first = client({ beneficiaryCount: 2n });
    const second = client({ beneficiaryCount: 2n });
    await expect(
      readDeepV2RewardProfile({
        manifest: manifest(),
        chainId: 1,
        account: ACCOUNT,
        candidate: candidate(),
        clients: [first.profileClient, second.profileClient],
      }),
    ).rejects.toThrow("one creator beneficiary");
  });

  it("rejects a factory clone that the canonical V2 automation never registered", async () => {
    const first = client({ automationRegistered: false });
    const second = client({ automationRegistered: false });
    await expect(
      readDeepV2RewardProfile({
        manifest: manifest(),
        chainId: 1,
        account: ACCOUNT,
        candidate: candidate(),
        clients: [first.profileClient, second.profileClient],
      }),
    ).rejects.toThrow("automation");
  });

  it("prepares a claim only after canonical reads and dual simulation", async () => {
    const first = client();
    const second = client();
    const prepared = await prepareDeepV2RewardAction({
      manifest: manifest(),
      chainId: 1,
      account: ACCOUNT,
      candidate: candidate(),
      action: "claim",
      clients: [first.profileClient, second.profileClient],
    });

    expect(prepared).toMatchObject({
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
        value: "0",
        gasLimit: "120000",
      },
    });
  });
});
