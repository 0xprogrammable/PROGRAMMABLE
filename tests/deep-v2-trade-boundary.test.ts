import { describe, expect, it, vi } from "vitest";
import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import {
  assertDeepV2TradeRuntime,
  resolveDeepV2TradeBoundary,
  resolveManifestGatedDeepV2TradeBoundary,
  type DeepV2TradeCandidate,
  type DeepV2TradeRelease,
  type DeepV2TradeRuntimeClient,
} from "../lib/trade/deep-v2";
import { DEEP_V2_MANIFEST_FIXED_POLICY } from "../lib/deep-v2";
import type { LaunchModelReleaseManifest } from "../lib/launch-model-gating";

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
      "0x6666666666666666666666666666666666666666",
    automationRuntimeCodeHash:
      "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
    automationFqcn:
      "src/LiquidityGrowthFullRangeAutomationV2.sol:LiquidityGrowthFullRangeAutomationV2",
    coordinatorAddress:
      "0x7777777777777777777777777777777777777777",
    coordinatorRuntimeCodeHash:
      "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
    coordinatorSourceCommitment:
      "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d",
    coordinatorFqcn:
      "src/DeepKeeperExecutorV1.sol:DeepKeeperExecutorV1",
  },
}));

const TOKEN = getAddress("0x1111111111111111111111111111111111111111");
const HOOK = getAddress("0x2222222222222222222222222222222222222222");
const LAUNCHER = getAddress("0x3333333333333333333333333333333333333333");
const FACTORY = getAddress("0x4444444444444444444444444444444444444444");
const IMPLEMENTATION = getAddress(
  "0x5555555555555555555555555555555555555555",
);
const AUTOMATION = getAddress(
  "0x6666666666666666666666666666666666666666",
);
const COORDINATOR = getAddress(
  "0x7777777777777777777777777777777777777777",
);
const POOL_MANAGER = getAddress(
  "0x000000000004444c5dc75cB358380D2e3dE08A90",
);
const RUNTIME_CODE = "0x6000" as Hex;
const RUNTIME_HASH = keccak256(RUNTIME_CODE);

const release: DeepV2TradeRelease = {
  chainId: 1,
  releaseVersion: "deep-full-range-v2",
  launcher: LAUNCHER,
  launcherRuntimeCodeHash: RUNTIME_HASH,
  feeHook: HOOK,
  feeHookRuntimeCodeHash: RUNTIME_HASH,
  growthVaultFactory: FACTORY,
  growthVaultFactoryRuntimeCodeHash: RUNTIME_HASH,
  growthVaultImplementation: IMPLEMENTATION,
  growthVaultImplementationRuntimeCodeHash: RUNTIME_HASH,
  automation: AUTOMATION,
  automationRuntimeCodeHash: RUNTIME_HASH,
  poolManager: POOL_MANAGER,
  poolManagerRuntimeCodeHash: RUNTIME_HASH,
};

function candidate(
  overrides: Partial<DeepV2TradeCandidate> = {},
): DeepV2TradeCandidate {
  return {
    deepReleaseVersion: "deep-full-range-v2",
    launchModel: "deep",
    launcher: LAUNCHER,
    tokenAddress: TOKEN,
    hookAddress: HOOK,
    poolId:
      "0xba7b894ad5dd5fb168dd16ed4258b722b9ca5d0dfdd6d6806ac9c419c69bb00f",
    ...overrides,
  };
}

function eligibleManifest(): LaunchModelReleaseManifest {
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
        releaseEligible: true,
        sourceVerificationStatus: "verified",
        deploymentVerificationStatus: "verified",
        launcher: LAUNCHER,
        hookFactory: LAUNCHER,
        feeHook: HOOK,
        feeSplitVaultFactory: LAUNCHER,
        rangeSourceFactory: LAUNCHER,
        growthVaultFactory: FACTORY,
        growthVaultImplementation: IMPLEMENTATION,
        automation: AUTOMATION,
        positionPlanner: LAUNCHER,
        positionForwarderFactory: LAUNCHER,
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
        keeperExecutor: COORDINATOR,
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

describe("Deep V2 exact-pool trade boundary", () => {
  it("derives the trade release only from an eligible V2 manifest and the pinned PoolManager", () => {
    const resolved = resolveManifestGatedDeepV2TradeBoundary({
      manifest: eligibleManifest(),
      chainId: 1,
      candidate: candidate(),
      official: {
        chainId: 1,
        poolManager: POOL_MANAGER,
        poolManagerRuntimeCodeHash: RUNTIME_HASH,
      },
    });
    expect(resolved.release).toMatchObject({
      launcher: LAUNCHER,
      feeHook: HOOK,
      growthVaultFactory: FACTORY,
      poolManager: POOL_MANAGER,
    });

    const ineligible = eligibleManifest();
    if (!ineligible.launchModelReleases?.deep) {
      throw new Error("Expected Deep V2 release fixture");
    }
    ineligible.launchModelReleases.deep.releaseEligible = false;
    expect(() =>
      resolveManifestGatedDeepV2TradeBoundary({
        manifest: ineligible,
        chainId: 1,
        candidate: candidate(),
        official: {
          chainId: 1,
          poolManager: POOL_MANAGER,
          poolManagerRuntimeCodeHash: RUNTIME_HASH,
        },
      }),
    ).toThrow("eligible verified Deep V2 release");
  });

  it("resolves only the native ETH V2 pool with fee zero and tick spacing 200", () => {
    const resolved = resolveDeepV2TradeBoundary(candidate(), release);

    expect(resolved.poolKey).toEqual({
      currency0: getAddress(
        "0x0000000000000000000000000000000000000000",
      ),
      currency1: TOKEN,
      fee: 0,
      tickSpacing: 200,
      hooks: HOOK,
    });
    expect(resolved.poolId).toBe(candidate().poolId);
  });

  it("rejects ambiguous V1 records and any hook or PoolId mismatch", () => {
    expect(() =>
      resolveDeepV2TradeBoundary(
        candidate({
          deepReleaseVersion: undefined as unknown as "deep-full-range-v2",
        }),
        release,
      ),
    ).toThrow("V2 release");
    expect(() =>
      resolveDeepV2TradeBoundary(
        candidate({ hookAddress: LAUNCHER }),
        release,
      ),
    ).toThrow("hook");
    expect(() =>
      resolveDeepV2TradeBoundary(
        candidate({ poolId: `0x${"ff".repeat(32)}` as Hex }),
        release,
      ),
    ).toThrow("PoolId");
  });

  it("checks every V2 release runtime before a route can be used", async () => {
    const checked: Address[] = [];
    const client: DeepV2TradeRuntimeClient = {
      async getChainId() {
        return 1;
      },
      async getCode({ address }) {
        checked.push(address);
        return RUNTIME_CODE;
      },
    };

    await expect(
      assertDeepV2TradeRuntime(client, release, candidate()),
    ).resolves.toBeUndefined();
    expect(new Set(checked)).toEqual(
      new Set([
        LAUNCHER,
        HOOK,
        FACTORY,
        IMPLEMENTATION,
        AUTOMATION,
        POOL_MANAGER,
        TOKEN,
      ]),
    );

    const mismatched: DeepV2TradeRuntimeClient = {
      ...client,
      async getCode({ address }) {
        return address === HOOK ? ("0x6001" as Hex) : RUNTIME_CODE;
      },
    };
    await expect(
      assertDeepV2TradeRuntime(mismatched, release, candidate()),
    ).rejects.toThrow("runtime");
  });
});
