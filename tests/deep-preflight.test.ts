import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, getAddress } from "viem";

const mocks = vi.hoisted(() => {
  const address = (index: number) =>
    `0x${index.toString(16).padStart(40, "0")}`;
  const runtimeHash = `0x${"11".repeat(32)}`;
  const addresses = {
    treasury: address(1),
    lockedPositionFactory: address(2),
    zapPlanner: address(3),
    growthVaultFactory: address(4),
    growthVaultImplementation: address(5),
    hookFactory: address(6),
    feeHook: "0x0000000000000000000000000000000000003aec",
    launcher: address(8),
    positionPlanner: address(9),
    automation: address(10),
    keeperExecutor: address(11),
    poolManager: address(12),
    positionManager: address(13),
    tokenFactory: address(14),
    predictedToken: address(15),
  };
  const release = {
    schemaVersion: 3,
    chainId: 1,
    startBlock: 100,
    addresses,
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
      poolManager: {
        address: addresses.poolManager,
        runtimeCodeHash: runtimeHash,
      },
      positionManager: {
        address: addresses.positionManager,
        runtimeCodeHash: runtimeHash,
      },
      uerc20Factory: {
        address: addresses.tokenFactory,
        runtimeCodeHash: runtimeHash,
      },
    },
  };
  const client = {
    getCode: vi.fn(
      async ({ address: target }: { address: string }) =>
        target.toLowerCase() === addresses.predictedToken.toLowerCase()
          ? "0x"
          : "0x6000",
    ),
    getBalance: vi.fn(async () => 1_000_000_000_000_000_000n),
    call: vi.fn(async () => ({ data: "0x" })),
    estimateGas: vi.fn(async () => 7_000_000n),
    getGasPrice: vi.fn(async () => 1_000_000_000n),
    getChainId: vi.fn(async () => 1),
    getBlock: vi.fn(
      async ({
        blockNumber,
      }: {
        blockTag?: "latest" | "finalized";
        blockNumber?: bigint;
      }) => ({
        number: blockNumber ?? 500n,
        hash: `0x${"22".repeat(32)}`,
        timestamp: 2_000_000_000n,
      }),
    ),
    readContract: vi.fn(
      async ({ functionName }: { functionName: string }) => {
        if (functionName === "predictTokenAddress") {
          return [addresses.predictedToken, `0x${"33".repeat(32)}`];
        }
        throw new Error(`Unhandled read ${functionName}`);
      },
    ),
  };
  return {
    addresses,
    client,
    release,
    releaseReady: true as boolean,
    runtimeHash,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => mocks.client,
  };
});

vi.mock("@/lib/deep-v3-release", () => ({
  getConfiguredDeepV3Release: () =>
    mocks.releaseReady ? mocks.release : null,
  isConfiguredDeepV3ReleaseReady: () => mocks.releaseReady,
}));

vi.mock("@/lib/deep-v3-runtime-binding", () => ({
  assertDeepV3RuntimeBinding: vi.fn(async () => ({
    blockNumber: 500n,
    blockHash: `0x${"22".repeat(32)}`,
  })),
  requireIndependentDeepV3RpcUrls: (
    primary: string | undefined,
    secondary: string | undefined,
  ) => {
    if (!primary || !secondary) throw new Error("missing RPC");
    return [primary, secondary];
  },
}));

vi.mock("@/contracts/config/app-deployments.v1.json", () => ({
  default: {
    production: {
      chainId: 1,
      status: "ready",
      memeLaunchStatus: "not-deployed",
      adaptiveLaunchStatus: "not-deployed",
      runtimeCodeHashes: {},
    },
    rehearsal: {
      chainId: 11_155_111,
      status: "not-deployed",
      memeLaunchStatus: "not-deployed",
      adaptiveLaunchStatus: "not-deployed",
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
import {
  DEEP_V3_FIXED_POLICY,
  deepV3LaunchAbi,
} from "../lib/deep-v3";
import { createDeepDraft } from "../lib/launch";

const account = "0x1111111111111111111111111111111111111111";
const salt = `0x${"aa".repeat(32)}`;

function request(walletChainId: string | number = "0x1") {
  return new NextRequest("http://localhost/api/launch/preflight", {
    method: "POST",
    body: JSON.stringify({
      account,
      walletChainId,
      draft: {
        ...createDeepDraft(),
        tokenName: "Deep Token",
        tokenSymbol: "DEEP",
        tokenDescription:
          "Trading fees deepen the original locked pool.",
        initialBuyEth: "0.0006",
        launchSalt: salt,
      },
    }),
  });
}

describe("Deep V3 launch preflight", () => {
  afterEach(() => {
    mocks.releaseReady = true;
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("prepares one exact protected launch after the runtime checks pass", async () => {
    vi.stubEnv("ETHEREUM_RPC_URL", "https://rpc-a.example/project");
    vi.stubEnv("ETHEREUM_RPC_URL_B", "https://rpc-b.example/project");

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "ready",
      mode: "deep",
      title: "Ready for wallet review",
      predictedToken: mocks.addresses.predictedToken,
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
        to: mocks.addresses.launcher,
        value: "600000000000000",
        gasLimit: "8400000",
      },
    });
    expect(body.planHash).toMatch(/^0x[0-9a-f]{64}$/);

    const decoded = decodeFunctionData({
      abi: deepV3LaunchAbi,
      data: body.transaction.data,
    });
    expect(decoded.functionName).toBe("launch");
    if (decoded.functionName !== "launch") return;
    expect(decoded.args[0].minimumInitialTokenOut).toBeGreaterThan(1n);
    expect(decoded.args[0].initialBuySqrtPriceLimitX96).toBe(
      DEEP_V3_FIXED_POLICY.minimumInitialBuySqrtPriceLimitX96,
    );
    expect(decoded.args[0].deadline).toBe(2_000_001_200n);
    expect(mocks.client.call).toHaveBeenCalledTimes(1);
  });

  it("blocks the wallet before simulation when it is on another chain", async () => {
    const response = await POST(request("0xaa36a7"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "blocked",
      mode: "deep",
      checks: [
        { id: "token", status: "pass" },
        { id: "wallet", status: "blocked" },
      ],
    });
    expect(mocks.client.call).not.toHaveBeenCalled();
  });

  it("keeps preflight disabled when the terminal V3 release gate is absent", async () => {
    mocks.releaseReady = false;
    const response = await POST(request());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Deep is not enabled by a verified release manifest",
    });
  });
});
