import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  getAddress,
  type Address,
} from "viem";

const mocks = vi.hoisted(() => {
  const addresses = {
    poolManager: "0x0000000000000000000000000000000000000001",
    positionManager: "0x0000000000000000000000000000000000000002",
    tokenFactory: "0x0000000000000000000000000000000000000003",
    treasury: "0x0000000000000000000000000000000000000004",
    launcher: "0x1000000000000000000000000000000000000001",
    hookFactory: "0x1000000000000000000000000000000000000002",
    feeHook: "0x10000000000000000000000000000000000030cc",
    feeSplitVaultFactory:
      "0x1000000000000000000000000000000000000004",
    rangeSourceFactory: "0x1000000000000000000000000000000000000005",
    growthVaultFactory: "0x1000000000000000000000000000000000000006",
    growthVaultImplementation:
      "0x1000000000000000000000000000000000000007",
    automation: "0x1000000000000000000000000000000000000008",
    positionPlanner: "0x1000000000000000000000000000000000000009",
    positionForwarderFactory:
      "0x100000000000000000000000000000000000000a",
    predictedToken: "0x2000000000000000000000000000000000000001",
  };
  const runtimeCode = "0x6000";
  const runtimeHash =
    "0x07ad118d6cc8642c86c03827f276d8b791a65e5c99a3845faf186be720a1455d";
  const release = {
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
    launcher: addresses.launcher,
    hookFactory: addresses.hookFactory,
    feeHook: addresses.feeHook,
    feeSplitVaultFactory: addresses.feeSplitVaultFactory,
    rangeSourceFactory: addresses.rangeSourceFactory,
    growthVaultFactory: addresses.growthVaultFactory,
    growthVaultImplementation: addresses.growthVaultImplementation,
    automation: addresses.automation,
    positionPlanner: addresses.positionPlanner,
    positionForwarderFactory: addresses.positionForwarderFactory,
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
  };
  const client = {
    getCode: vi.fn(async ({ address }: { address: string }) =>
      address.toLowerCase() === addresses.predictedToken.toLowerCase()
        ? "0x"
        : runtimeCode,
    ),
    getBalance: vi.fn(async () => 1_000_000_000_000_000_000n),
    call: vi.fn(async () => ({ data: "0x" })),
    estimateGas: vi.fn(async () => 7_000_000n),
    getGasPrice: vi.fn(async () => 1_000_000_000n),
    readContract: vi.fn(
      async ({
        address,
        functionName,
      }: {
        address: string;
        functionName: string;
      }) => {
        const contract = address.toLowerCase();
        const isLauncher =
          contract === addresses.launcher.toLowerCase();
        const isHook = contract === addresses.feeHook.toLowerCase();
        const isGrowthFactory =
          contract === addresses.growthVaultFactory.toLowerCase();
        const isAutomation =
          contract === addresses.automation.toLowerCase();

        if (functionName === "predictTokenAddress") {
          return [addresses.predictedToken, `0x${"12".repeat(32)}`];
        }
        if (functionName === "poolManager") return addresses.poolManager;
        if (functionName === "positionManager") {
          return addresses.positionManager;
        }
        if (functionName === "tokenFactory") return addresses.tokenFactory;
        if (functionName === "feeHook") return addresses.feeHook;
        if (functionName === "feeSplitVaultFactory") {
          return addresses.feeSplitVaultFactory;
        }
        if (functionName === "rangeSourceFactory") {
          return addresses.rangeSourceFactory;
        }
        if (functionName === "growthVaultFactory") {
          return addresses.growthVaultFactory;
        }
        if (functionName === "automation") return addresses.automation;
        if (functionName === "positionPlanner") {
          return addresses.positionPlanner;
        }
        if (functionName === "positionForwarderFactory") {
          return addresses.positionForwarderFactory;
        }
        if (functionName === "launcherFeeRecipient") {
          return addresses.treasury;
        }
        if (functionName === "implementation") {
          return addresses.growthVaultImplementation;
        }
        if (functionName === "hookFactory") {
          return addresses.hookFactory;
        }
        if (functionName === "vaultFactory") {
          return addresses.growthVaultFactory;
        }
        if (functionName === "launcher" && isAutomation) {
          return addresses.launcher;
        }
        if (functionName === "FACTORY") {
          return addresses.growthVaultFactory;
        }
        if (functionName === "TOKEN_SUPPLY") {
          return 1_000_000_000n * 10n ** 18n;
        }
        if (functionName === "TOKEN_RESERVE_TARGET") {
          return 150_000_000n * 10n ** 18n;
        }
        if (functionName === "GROWTH_TARGET_NATIVE") {
          return 50_000_000_000_000_000n;
        }
        if (functionName === "MIN_INITIAL_BUY_WEI") {
          return 600_000_000_000_000n;
        }
        if (functionName === "INITIAL_TICK") return 204_200;
        if (functionName === "TICK_SPACING") return 200;
        if (functionName === "LP_FEE_PIPS") return 0;
        if (functionName === "TWAP_WINDOW") return 1_800;
        if (functionName === "MAX_SPOT_TWAP_DEVIATION_TICKS") {
          return 600;
        }
        if (functionName === "MAX_ABS_TICK_DELTA") return 400;
        if (functionName === "maxAbsTickDelta") return 400;
        if (functionName === "LAUNCHER_FEE_BPS") return 10;
        if (functionName === "MIN_TOTAL_SWAP_FEE_BPS") return 100;
        if (functionName === "MAX_TOTAL_SWAP_FEE_BPS") return 1_000;
        if (functionName === "TOTAL_SWAP_FEE_STEP_BPS") return 100;
        if (functionName === "TRANSFER_TAX_BPS") return 0;
        if (functionName === "ALL_HOOK_MASK") return 0x3fffn;
        if (functionName === "REQUIRED_HOOK_FLAGS") return 0x30ccn;
        if (functionName === "isFactoryHook") return true;
        if (functionName === "MAX_BATCH_SIZE") return 32n;
        if (functionName === "OBSERVATION_CARDINALITY_TARGET") {
          return 192;
        }
        if (functionName === "MIN_UTILIZATION_BPS") return 8_500;
        if (functionName === "TRUSTED_DEPTH_CAP_BPS") return 25;
        if (functionName === "MAX_COMPOUND_NATIVE") {
          return 250_000_000_000_000_000n;
        }
        if (functionName === "MIN_COMPOUND_NATIVE") {
          return 2_000_000_000_000_000n;
        }
        if (functionName === "COMPOUND_COOLDOWN_SECONDS") return 1_800n;
        if (functionName === "STRESS_TICK") return 218_000;

        throw new Error(
          `Unhandled ${functionName} on ${contract}; launcher=${isLauncher}, hook=${isHook}, growth=${isGrowthFactory}`,
        );
      },
    ),
  };
  return {
    addresses,
    runtimeCode,
    runtimeHash,
    release,
    client,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => mocks.client,
  };
});

vi.mock("@/contracts/config/app-deployments.v1.json", () => ({
  default: {
    production: {
      chainId: 1,
      status: "ready",
      launchModelReleases: { deep: mocks.release },
      runtimeCodeHashes: {},
    },
    rehearsal: {
      chainId: 11_155_111,
      status: "not-deployed",
      launchModelReleases: {},
      runtimeCodeHashes: {},
    },
  },
}));

vi.mock("@/contracts/config/deployment-inputs.v1.json", () => ({
  default: {
    platform: { treasury: mocks.addresses.treasury },
  },
}));

vi.mock("@/contracts/dependencies/ethereum-mainnet.json", () => ({
  default: {
    contracts: {
      poolManager: {
        address: mocks.addresses.poolManager,
        runtimeCodeHash: mocks.runtimeHash,
      },
      positionManager: {
        address: mocks.addresses.positionManager,
        runtimeCodeHash: mocks.runtimeHash,
      },
      uerc20Factory: {
        address: mocks.addresses.tokenFactory,
        runtimeCodeHash: mocks.runtimeHash,
      },
    },
  },
}));

vi.mock("@/contracts/dependencies/ethereum-sepolia.json", () => ({
  default: {
    contracts: {
      poolManager: {
        address: mocks.addresses.poolManager,
        runtimeCodeHash: mocks.runtimeHash,
      },
      positionManager: {
        address: mocks.addresses.positionManager,
        runtimeCodeHash: mocks.runtimeHash,
      },
      uerc20Factory: {
        address: mocks.addresses.tokenFactory,
        runtimeCodeHash: mocks.runtimeHash,
      },
    },
  },
}));

import { POST } from "../app/api/launch/preflight/route";
import { deepLaunchAbi } from "../lib/deep-v1";
import { createDeepDraft } from "../lib/launch";

const account = "0x1111111111111111111111111111111111111111";
const salt =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("Deep launch preflight", () => {
  it("prepares one exact atomic launch after release and simulation checks pass", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/launch/preflight", {
        method: "POST",
        body: JSON.stringify({
          account,
          walletChainId: "0x1",
          draft: {
            ...createDeepDraft(),
            tokenName: "Deep Token",
            tokenSymbol: "DEEP",
            tokenDescription:
              "Creator fees deepen the original locked pool first.",
            initialBuyEth: "0.0006",
            launchSalt: salt,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "ready",
      mode: "deep",
      title: "Ready for wallet review",
      predictedToken: getAddress(mocks.addresses.predictedToken),
      predictedHook: getAddress(mocks.addresses.feeHook),
      checks: [
        { id: "token", status: "pass" },
        { id: "wallet", status: "pass" },
        { id: "contracts", status: "pass" },
        { id: "simulation", status: "pass" },
      ],
      transaction: {
        kind: "launch",
        chainId: 1,
        to: getAddress(mocks.addresses.launcher),
        value: "600000000000000",
        gasLimit: "8400000",
      },
    });
    expect(body.planHash).toMatch(/^0x[0-9a-f]{64}$/);

    const decoded = decodeFunctionData({
      abi: deepLaunchAbi,
      data: body.transaction.data,
    });
    expect(decoded.functionName).toBe("launch");
    if (decoded.functionName !== "launch") return;
    expect(decoded.args[0]).toMatchObject({
      name: "Deep Token",
      symbol: "DEEP",
      buySwapFeeBps: 100,
      sellSwapFeeBps: 100,
      rewardBeneficiaries: [getAddress(account) as Address],
      rewardSharesBps: [10_000],
    });
    expect(mocks.client.call).toHaveBeenCalledOnce();
    expect(mocks.client.estimateGas).toHaveBeenCalledOnce();
  });
});
