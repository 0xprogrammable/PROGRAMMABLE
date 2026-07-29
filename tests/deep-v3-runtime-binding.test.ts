import { describe, expect, it } from "vitest";
import { getAddress, keccak256, type Address, type Hex } from "viem";

import {
  assertDeepV3RuntimeBinding,
  requireIndependentDeepV3RpcUrls,
  type DeepV3RuntimeBindingClient,
  type DeepV3RuntimeRelease,
} from "../lib/deep-v3-runtime-binding";

const code = "0x6000" as Hex;
const runtimeHash = keccak256(code);
const blockHash = `0x${"11".repeat(32)}` as Hex;
const address = (index: number) =>
  getAddress(`0x${index.toString(16).padStart(40, "0")}`);

const release: DeepV3RuntimeRelease = {
  chainId: 1,
  startBlock: 100,
  addresses: {
    treasury: address(1),
    lockedPositionFactory: address(2),
    zapPlanner: address(3),
    growthVaultFactory: address(4),
    growthVaultImplementation: address(5),
    hookFactory: address(6),
    feeHook: address(7),
    launcher: address(8),
    positionPlanner: address(9),
    automation: address(10),
    keeperExecutor: address(11),
  },
  runtimeCodeHashes: {
    lockedPositionFactory: runtimeHash,
    zapPlanner: runtimeHash,
    growthVaultFactory: runtimeHash,
    growthVaultImplementation: runtimeHash,
    hookFactory: runtimeHash,
    feeHook: runtimeHash,
    launcher: runtimeHash,
    positionPlanner: runtimeHash,
    automation: runtimeHash,
    keeperExecutor: runtimeHash,
  },
  officialDependencies: {
    poolManager: { address: address(12), runtimeCodeHash: runtimeHash },
    positionManager: {
      address: address(13),
      runtimeCodeHash: runtimeHash,
    },
    uerc20Factory: {
      address: address(14),
      runtimeCodeHash: runtimeHash,
    },
  },
};

function readValue(contract: Address, functionName: string) {
  const { addresses, officialDependencies: official } = release;
  const key = `${contract.toLowerCase()}:${functionName}`;
  const values: Record<string, unknown> = {
    [`${addresses.launcher.toLowerCase()}:poolManager`]:
      official.poolManager.address,
    [`${addresses.launcher.toLowerCase()}:positionManager`]:
      official.positionManager.address,
    [`${addresses.launcher.toLowerCase()}:tokenFactory`]:
      official.uerc20Factory.address,
    [`${addresses.launcher.toLowerCase()}:feeHook`]: addresses.feeHook,
    [`${addresses.launcher.toLowerCase()}:growthVaultFactory`]:
      addresses.growthVaultFactory,
    [`${addresses.launcher.toLowerCase()}:positionPlanner`]:
      addresses.positionPlanner,
    [`${addresses.launcher.toLowerCase()}:automation`]:
      addresses.automation,
    [`${addresses.launcher.toLowerCase()}:positionForwarderFactory`]:
      addresses.lockedPositionFactory,
    [`${addresses.launcher.toLowerCase()}:TOKEN_SUPPLY`]:
      1_000_000_000n * 10n ** 18n,
    [`${addresses.launcher.toLowerCase()}:MIN_INITIAL_BUY_WEI`]:
      600_000_000_000_000n,
    [`${addresses.launcher.toLowerCase()}:MIN_INITIAL_BUY_SQRT_PRICE_LIMIT_X96`]:
      2_109_206_475_762_646_020_212_180_903_141_694n,
    [`${addresses.feeHook.toLowerCase()}:poolManager`]:
      official.poolManager.address,
    [`${addresses.feeHook.toLowerCase()}:positionManager`]:
      official.positionManager.address,
    [`${addresses.feeHook.toLowerCase()}:growthVaultFactory`]:
      addresses.growthVaultFactory,
    [`${addresses.feeHook.toLowerCase()}:launcherFeeRecipient`]:
      addresses.treasury,
    [`${addresses.feeHook.toLowerCase()}:TOTAL_HOOK_FEE_BPS`]: 100,
    [`${addresses.feeHook.toLowerCase()}:GROWTH_FEE_BPS`]: 90,
    [`${addresses.feeHook.toLowerCase()}:PROGRAMMABLE_FEE_BPS`]: 10,
    [`${addresses.feeHook.toLowerCase()}:TRANSFER_TAX_BPS`]: 0,
    [`${addresses.feeHook.toLowerCase()}:maxAbsTickDelta`]: 400,
    [`${addresses.hookFactory.toLowerCase()}:ALL_HOOK_MASK`]: 16_383n,
    [`${addresses.hookFactory.toLowerCase()}:REQUIRED_HOOK_FLAGS`]:
      0x3aec,
    [`${addresses.hookFactory.toLowerCase()}:isFactoryHook`]: true,
    [`${addresses.growthVaultFactory.toLowerCase()}:implementation`]:
      addresses.growthVaultImplementation,
    [`${addresses.growthVaultFactory.toLowerCase()}:planner`]:
      addresses.zapPlanner,
    [`${addresses.growthVaultImplementation.toLowerCase()}:FACTORY`]:
      addresses.growthVaultFactory,
    [`${addresses.automation.toLowerCase()}:vaultFactory`]:
      addresses.growthVaultFactory,
    [`${addresses.automation.toLowerCase()}:launcher`]:
      addresses.launcher,
    [`${addresses.automation.toLowerCase()}:OBSERVATION_CARDINALITY_TARGET`]:
      192,
    [`${addresses.keeperExecutor.toLowerCase()}:automation`]:
      addresses.automation,
    [`${addresses.keeperExecutor.toLowerCase()}:MAX_BATCH_SIZE`]: 4n,
    [`${addresses.lockedPositionFactory.toLowerCase()}:positionManager`]:
      official.positionManager.address,
  };
  if (!(key in values)) throw new Error(`Missing fixture ${key}`);
  return values[key];
}

function client(
  overrides: Partial<DeepV3RuntimeBindingClient> = {},
): DeepV3RuntimeBindingClient {
  return {
    getChainId: async () => 1,
    getFinalizedBlock: async () => ({ number: 500n, hash: blockHash }),
    getBlock: async ({ blockNumber }) => ({
      number: blockNumber,
      hash: blockHash,
    }),
    getCode: async () => code,
    readContract: async ({ address: contract, functionName }) =>
      readValue(contract, functionName),
    ...overrides,
  };
}

describe("Deep V3 runtime binding", () => {
  it("pins all runtimes and immutable topology to one finalized snapshot", async () => {
    await expect(
      assertDeepV3RuntimeBinding({
        clients: [client(), client()],
        release,
      }),
    ).resolves.toEqual({ blockNumber: 500n, blockHash });
  });

  it("fails closed on a runtime or topology mismatch", async () => {
    const wrongRuntime = client({
      getCode: async ({ address: target }) =>
        target === release.addresses.launcher
          ? ("0x6001" as Hex)
          : code,
    });
    await expect(
      assertDeepV3RuntimeBinding({
        clients: [wrongRuntime, wrongRuntime],
        release,
      }),
    ).rejects.toThrow("launcher runtime");

    const wrongTopology = client({
      readContract: async (input) =>
        input.functionName === "automation" &&
        input.address === release.addresses.keeperExecutor
          ? address(99)
          : readValue(input.address, input.functionName),
    });
    await expect(
      assertDeepV3RuntimeBinding({
        clients: [wrongTopology, wrongTopology],
        release,
      }),
    ).rejects.toThrow("keeper automation");
  });

  it("requires independent HTTPS RPC providers", () => {
    expect(
      requireIndependentDeepV3RpcUrls(
        "https://one.example/rpc",
        "https://two.example/rpc",
      ),
    ).toEqual([
      "https://one.example/rpc",
      "https://two.example/rpc",
    ]);
    expect(() =>
      requireIndependentDeepV3RpcUrls(
        "https://same.example/a",
        "https://same.example/b",
      ),
    ).toThrow("independent");
  });
});
