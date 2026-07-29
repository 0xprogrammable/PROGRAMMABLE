import { describe, expect, it, vi } from "vitest";
import { stringToHex, type Address, type Hex } from "viem";

import {
  deepV3VaultBindingHash,
  DEEP_V3_OFFICIAL_DEPENDENCIES,
} from "../lib/onchain/deep-v3-read-model";
import {
  readDeepV3ProfileToken,
  type DeepV3ProfileClient,
} from "../lib/profile/deep-v3-profile.server";
import {
  DEEP_V3_TEST_ADDRESSES,
  DEEP_V3_TEST_BLOCK_HASH,
  DEEP_V3_TEST_CONFIGURATION_HASH,
  DEEP_V3_TEST_CREATOR,
  DEEP_V3_TEST_LAUNCH_HASH,
  DEEP_V3_TEST_POOL_ID,
  DEEP_V3_TEST_POSITION_RECIPIENT,
  DEEP_V3_TEST_TOKEN,
  DEEP_V3_TEST_TRANSACTION_HASH,
  DEEP_V3_TEST_VAULT,
  deepV3LiveManifestFixture,
  deepV3TestProvenance,
} from "./deep-v3-fixture";

const { runtimeAssertion } = vi.hoisted(() => ({
  runtimeAssertion: vi.fn(async () => undefined),
}));

vi.mock("server-only", () => ({}));
vi.mock("../lib/onchain/deep-v3-read-model", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("../lib/onchain/deep-v3-read-model")
    >();
  return {
    ...original,
    assertDeepV3ReleaseRuntime: runtimeAssertion,
  };
});

const SNAPSHOT_HASH = `0x${"90".repeat(32)}` as Hex;
const LAUNCH_TIMESTAMP = 1_800_000_000n;
const POOL_KEY = {
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: DEEP_V3_TEST_TOKEN,
  fee: 0,
  tickSpacing: 200,
  hooks: DEEP_V3_TEST_ADDRESSES.feeHook,
} as const;

function profileClient(overrides?: {
  chainId?: number;
  pendingGrowthNative?: bigint;
  launcherVault?: Address;
  snapshotHash?: Hex;
}) {
  let calls = 0;
  const bindingHash = deepV3VaultBindingHash({
    chainId: 1,
    factory: DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
    vault: DEEP_V3_TEST_VAULT,
    hook: DEEP_V3_TEST_ADDRESSES.feeHook,
    poolId: DEEP_V3_TEST_POOL_ID,
    token: DEEP_V3_TEST_TOKEN,
  });
  const client: DeepV3ProfileClient = {
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
      if (blockNumber === 123n) {
        return {
          hash: DEEP_V3_TEST_BLOCK_HASH,
          timestamp: LAUNCH_TIMESTAMP,
        };
      }
      return {
        hash: overrides?.snapshotHash ?? SNAPSHOT_HASH,
        timestamp: LAUNCH_TIMESTAMP + 1_000n,
      };
    },
    async getCode() {
      calls += 1;
      return "0x6000";
    },
    async getLogs() {
      calls += 1;
      return [
        {
          args: {
            deployer: DEEP_V3_TEST_CREATOR,
            token: DEEP_V3_TEST_TOKEN,
            poolId: DEEP_V3_TEST_POOL_ID,
            feeHook: DEEP_V3_TEST_ADDRESSES.feeHook,
            growthVault: DEEP_V3_TEST_VAULT,
            positionRecipient: DEEP_V3_TEST_POSITION_RECIPIENT,
            positionTokenId: 77n,
            vaultConfigurationHash:
              DEEP_V3_TEST_CONFIGURATION_HASH,
            launchHash: DEEP_V3_TEST_LAUNCH_HASH,
          },
          blockNumber: 123n,
          blockHash: DEEP_V3_TEST_BLOCK_HASH,
          transactionHash: DEEP_V3_TEST_TRANSACTION_HASH,
          transactionIndex: 2,
          logIndex: 50,
          removed: false,
        },
      ];
    },
    async readContract({ address, functionName }) {
      calls += 1;
      if (address === DEEP_V3_TEST_TOKEN) {
        const values: Record<string, unknown> = {
          name: "Deep Test",
          symbol: "DEEP",
          decimals: 18,
          totalSupply: 1_000_000_000n * 10n ** 18n,
          creator: DEEP_V3_TEST_ADDRESSES.launcher,
          metadata: [
            "A test token",
            "https://example.com/",
            "https://example.com/token.png",
            stringToHex(
              JSON.stringify({
                v: 1,
                x: "https://x.com/0xprogrammable",
              }),
            ),
          ],
        };
        if (functionName in values) return values[functionName];
      }
      if (address === DEEP_V3_TEST_ADDRESSES.launcher) {
        const values: Record<string, unknown> = {
          growthVaultOf:
            overrides?.launcherVault ?? DEEP_V3_TEST_VAULT,
          launchHashOf: DEEP_V3_TEST_LAUNCH_HASH,
          poolKey: POOL_KEY,
        };
        if (functionName in values) return values[functionName];
      }
      if (address === DEEP_V3_TEST_ADDRESSES.feeHook) {
        const values: Record<string, unknown> = {
          poolManager: DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address,
          positionManager:
            DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
          growthVaultFactory:
            DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
          launcherFeeRecipient:
            "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
          TOTAL_HOOK_FEE_BPS: 100,
          GROWTH_FEE_BPS: 90,
          PROGRAMMABLE_FEE_BPS: 10,
          TRANSFER_TAX_BPS: 0,
          LP_FEE_PIPS: 0,
          TICK_SPACING: 200,
          LIFECYCLE_FINALIZED: 5,
          poolFeeConfig: [
            DEEP_V3_TEST_VAULT,
            DEEP_V3_TEST_ADDRESSES.launcher,
            5,
            20n,
          ],
          feeDisclosure: [
            100,
            90,
            10,
            0,
            0,
            DEEP_V3_TEST_VAULT,
          ],
        };
        if (functionName in values) return values[functionName];
      }
      if (address === DEEP_V3_TEST_ADDRESSES.growthVaultFactory) {
        const values: Record<string, unknown> = {
          isFactoryVault: true,
          configurationHashOf: DEEP_V3_TEST_CONFIGURATION_HASH,
          vaultBindingHash: bindingHash,
          implementation:
            DEEP_V3_TEST_ADDRESSES.growthVaultImplementation,
          planner: DEEP_V3_TEST_ADDRESSES.zapPlanner,
        };
        if (functionName in values) return values[functionName];
      }
      if (address === DEEP_V3_TEST_VAULT) {
        const values: Record<string, unknown> = {
          FACTORY: DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
          initialized: true,
          feeHook: DEEP_V3_TEST_ADDRESSES.feeHook,
          poolManager: DEEP_V3_OFFICIAL_DEPENDENCIES.poolManager.address,
          positionManager:
            DEEP_V3_OFFICIAL_DEPENDENCIES.positionManager.address,
          planner: DEEP_V3_TEST_ADDRESSES.zapPlanner,
          poolId: DEEP_V3_TEST_POOL_ID,
          token: DEEP_V3_TEST_TOKEN,
          configurationHash: DEEP_V3_TEST_CONFIGURATION_HASH,
          poolKey: POOL_KEY,
          pendingGrowthNative: overrides?.pendingGrowthNative ?? 10n,
          initialTokenDust: 1n,
          accountedTokenDust: 21n,
          totalGrowthETHReceived: 100n,
          totalNativeSwapped: 40n,
          totalTokenAcquired: 100n,
          totalNativeAdded: 50n,
          totalTokenAdded: 80n,
          totalLiquidityAdded: 30n,
          lastCompoundTimestamp: 1_000n,
          compoundNonce: 1n,
          workState: [
            0,
            20n,
            overrides?.pendingGrowthNative ?? 10n,
            1_300n,
            5n,
            "0x00000000",
          ],
          lockedLiquidity: 30n,
          trustedNativeDepth: 1_000n,
          rollingExposure: 90n,
        };
        if (functionName in values) return values[functionName];
      }
      if (address === DEEP_V3_TEST_ADDRESSES.automation) {
        const values: Record<string, unknown> = {
          vaultFactory: DEEP_V3_TEST_ADDRESSES.growthVaultFactory,
          launcher: DEEP_V3_TEST_ADDRESSES.launcher,
          isRegisteredVault: true,
        };
        if (functionName in values) return values[functionName];
      }
      if (address === DEEP_V3_OFFICIAL_DEPENDENCIES.stateView.address) {
        if (functionName === "getSlot0") {
          return [1n << 96n, 0, 0, 0] as const;
        }
        if (functionName === "getLiquidity") return 1_000n;
      }
      throw new Error(`Unexpected read ${address}:${functionName}`);
    },
  };
  return { client, calls: () => calls };
}

describe("Deep V3 profile read boundary", () => {
  it("fails before RPC when the live release gate is incomplete", async () => {
    runtimeAssertion.mockClear();
    const first = profileClient();
    const second = profileClient();

    await expect(
      readDeepV3ProfileToken({
        manifest: {
          ...deepV3LiveManifestFixture(),
          releaseEligible: false,
        },
        chainId: 1,
        account: DEEP_V3_TEST_CREATOR,
        candidate: deepV3TestProvenance(),
        clients: [first.client, second.client],
      }),
    ).rejects.toThrow(/verified live release/);
    expect(first.calls() + second.calls()).toBe(0);
    expect(runtimeAssertion).not.toHaveBeenCalled();
  });

  it("returns confirmed token and growth data without a reward or chart claim", async () => {
    runtimeAssertion.mockClear();
    const first = profileClient();
    const second = profileClient();

    const profile = await readDeepV3ProfileToken({
      manifest: deepV3LiveManifestFixture(),
      chainId: 1,
      account: DEEP_V3_TEST_CREATOR,
      candidate: deepV3TestProvenance(),
      clients: [first.client, second.client],
    });

    expect(profile).toMatchObject({
      status: "ready",
      chainId: 1,
      account: DEEP_V3_TEST_CREATOR,
      snapshot: {
        blockNumber: "188",
        blockHash: SNAPSHOT_HASH,
      },
      token: {
        deepReleaseVersion: "deep-full-range-v3",
        tokenAddress: DEEP_V3_TEST_TOKEN,
        tokenName: "Deep Test",
        tokenSymbol: "DEEP",
        description: "A test token",
        imageUrl: "https://example.com/token.png",
        totalHookFeeBps: 100,
        growthFeeBps: 90,
        programmableFeeBps: 10,
        pendingGrowthNativeWei: "10",
        accruedGrowthFeesWei: "20",
        totalGrowthEthReceivedWei: "100",
        totalNativeSwappedWei: "40",
        totalNativeAddedWei: "50",
        lockedLiquidity: "30",
        compoundCount: "1",
        nextEligibleTimestamp: "1300",
      },
    });
    expect(profile.token.links).toEqual([
      { kind: "website", url: "https://example.com/" },
      {
        kind: "x",
        url: "https://x.com/0xprogrammable",
      },
    ]);
    expect("claimableWei" in profile.token).toBe(false);
    expect("chart" in profile.token).toBe(false);
    expect(runtimeAssertion).toHaveBeenCalledTimes(2);
  });

  it("requires creator ownership before any RPC read", async () => {
    const first = profileClient();
    const second = profileClient();
    await expect(
      readDeepV3ProfileToken({
        manifest: deepV3LiveManifestFixture(),
        chainId: 1,
        account: DEEP_V3_TEST_ADDRESSES.deployer,
        candidate: deepV3TestProvenance(),
        clients: [first.client, second.client],
      }),
    ).rejects.toThrow(/belong/);
    expect(first.calls() + second.calls()).toBe(0);
  });

  it("rejects independent RPC disagreement and launcher-vault drift", async () => {
    const first = profileClient();
    const disagreeing = profileClient({ pendingGrowthNative: 11n });
    await expect(
      readDeepV3ProfileToken({
        manifest: deepV3LiveManifestFixture(),
        chainId: 1,
        account: DEEP_V3_TEST_CREATOR,
        candidate: deepV3TestProvenance(),
        clients: [first.client, disagreeing.client],
      }),
    ).rejects.toThrow(/disagree/);

    const wrong = profileClient({
      launcherVault: DEEP_V3_TEST_ADDRESSES.keeperExecutor,
    });
    await expect(
      readDeepV3ProfileToken({
        manifest: deepV3LiveManifestFixture(),
        chainId: 1,
        account: DEEP_V3_TEST_CREATOR,
        candidate: deepV3TestProvenance(),
        clients: [wrong.client, wrong.client],
      }),
    ).rejects.toThrow(/launcher binding/);
  });
});
