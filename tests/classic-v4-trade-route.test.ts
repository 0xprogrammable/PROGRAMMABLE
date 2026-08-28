import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  encodeFunctionResult,
  getAddress,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  release: null as unknown,
  poolHook: "0x0000000000000000000000000000000000000000",
  createPublicClient: vi.fn(),
  withOperationalRpcFailover: vi.fn(),
}));

vi.mock("../lib/classic-v4-release", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/classic-v4-release")>();
  return {
    ...actual,
    getConfiguredClassicV4PublicRelease: () => mocks.release,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
  };
});

vi.mock("../lib/onchain/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/onchain/config")>();
  return {
    ...actual,
    getWebsiteReadOnchainDeployment: () => ({
      status: "ready" as const,
      chainId: 1,
    }),
  };
});

vi.mock("../lib/onchain/operational-rpc-failover.server", () => ({
  withOperationalRpcFailover: mocks.withOperationalRpcFailover,
}));

import { POST } from "../app/api/trade/prepare/route";
import type { ClassicV4PublicRelease } from "../lib/classic-v4-release";
import {
  classicPermit2Abi,
  classicQuoterAbi,
  classicTokenAbi,
} from "../lib/trade/classic";
import { getPinnedOfficialTradeStack } from "../lib/trade/server";

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as Address;
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const BLOCK_HASH = `0x${"11".repeat(32)}` as Hex;
const LAUNCH_HASH = `0x${"22".repeat(32)}` as Hex;
const MOCK_RUNTIME_CODE = "0x6000" as Hex;
const MOCK_RUNTIME_CODE_HASH = keccak256(MOCK_RUNTIME_CODE);
const OWNER = getAddress("0x5555555555555555555555555555555555555555");
const TOKEN = getAddress("0x69AE118837CFe3BE671f59f3D64bCFB8bf1Dc0e9");
const CREATOR = getAddress("0x6666666666666666666666666666666666666666");
const CLASSIC_V4_LAUNCHER = getAddress(
  "0x7777777777777777777777777777777777777777",
);
const CLASSIC_V4_HOOK = getAddress(
  "0x8888888888888888888888888888888888888888",
);

function classicV4Release(
  publicAvailable = true,
): ClassicV4PublicRelease {
  const official = getPinnedOfficialTradeStack(1);
  return {
    chainId: 1,
    model: "classic",
    internalContractRelease: "classic-v4",
    releaseStatus: publicAvailable
      ? "publicly-available"
      : "indexer-activated",
    addresses: {
      launcher: CLASSIC_V4_LAUNCHER,
      feeHook: CLASSIC_V4_HOOK,
    },
    runtimeCodeHashes: {
      launcher: MOCK_RUNTIME_CODE_HASH,
      feeHook: MOCK_RUNTIME_CODE_HASH,
    },
    officialDependencies: {
      poolManager: {
        address: official.poolManager,
        runtimeCodeHash: MOCK_RUNTIME_CODE_HASH,
      },
      v4Quoter: {
        address: official.v4Quoter,
        runtimeCodeHash: MOCK_RUNTIME_CODE_HASH,
      },
      universalRouter: {
        address: official.universalRouter,
        runtimeCodeHash: MOCK_RUNTIME_CODE_HASH,
      },
      permit2: {
        address: official.permit2,
        runtimeCodeHash: MOCK_RUNTIME_CODE_HASH,
      },
    },
    verification: {
      deploymentLive: true,
      deploymentFinalized: true,
      runtimeCodeVerified: true,
      constructorBindingsVerified: true,
      sourceVerified: true,
      lifecycleVerified: true,
      indexerActivated: true,
      publicAvailable,
    },
  } as ClassicV4PublicRelease;
}

function actionClient(release: ClassicV4PublicRelease) {
  const readContract = vi.fn(
    async ({
      address,
      functionName,
    }: {
      address: Address;
      functionName: string;
    }) => {
      if (functionName === "launchHashOf") {
        return address.toLowerCase() ===
          CLASSIC_V4_LAUNCHER.toLowerCase()
          ? LAUNCH_HASH
          : ZERO_HASH;
      }
      if (functionName === "poolKey") {
        return [ZERO_ADDRESS, TOKEN, 0, 200, mocks.poolHook] as const;
      }
      if (functionName === "name") return "Classic V4 Token";
      if (functionName === "symbol") return "CV4";
      if (functionName === "creator") return CREATOR;
      throw new Error(`Unexpected read ${address}:${functionName}`);
    },
  );

  const client = {
    getBlockNumber: vi.fn().mockResolvedValue(100n),
    getBlock: vi.fn().mockResolvedValue({
      hash: BLOCK_HASH,
      timestamp: 10_000n,
    }),
    getChainId: vi.fn().mockResolvedValue(1),
    getBalance: vi.fn().mockResolvedValue(10n ** 18n),
    getGasPrice: vi.fn().mockResolvedValue(1n),
    getCode: vi.fn().mockResolvedValue(MOCK_RUNTIME_CODE),
    estimateGas: vi.fn().mockResolvedValue(300_000n),
    readContract,
    call: vi.fn(async ({ to, data }: { to: Address; data: Hex }) => {
      if (to.toLowerCase() === TOKEN.toLowerCase()) {
        if (data.startsWith("0x70a08231")) {
          return {
            data: encodeFunctionResult({
              abi: classicTokenAbi,
              functionName: "balanceOf",
              result: 100_000n,
            }),
          };
        }
        return {
          data: encodeFunctionResult({
            abi: classicTokenAbi,
            functionName: "allowance",
            result: 100_000n,
          }),
        };
      }
      if (
        to.toLowerCase() ===
        release.officialDependencies.permit2.address.toLowerCase()
      ) {
        return {
          data: encodeFunctionResult({
            abi: classicPermit2Abi,
            functionName: "allowance",
            result: [100_000n, 50_000, 0],
          }),
        };
      }
      if (
        to.toLowerCase() ===
        release.officialDependencies.v4Quoter.address.toLowerCase()
      ) {
        return {
          data: encodeFunctionResult({
            abi: classicQuoterAbi,
            functionName: "quoteExactInputSingle",
            result: [10_000n, 222_000n],
          }),
        };
      }
      if (
        to.toLowerCase() ===
        release.officialDependencies.universalRouter.address.toLowerCase()
      ) {
        return { data: "0x" as Hex };
      }
      throw new Error(`Unexpected call target ${to}`);
    }),
  };
  return { client: client as unknown as PublicClient, readContract };
}

function request(side: "buy" | "sell") {
  return new NextRequest("http://localhost/api/trade/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chainId: 1,
      owner: OWNER,
      token: TOKEN,
      side,
      amountIn: "1000",
      slippageBps: 100,
      deadline: "10300",
    }),
  });
}

describe("Classic V4 trade route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const release = classicV4Release();
    const { client } = actionClient(release);
    mocks.release = release;
    mocks.poolHook = CLASSIC_V4_HOOK;
    mocks.createPublicClient.mockReturnValue(client);
    mocks.withOperationalRpcFailover.mockImplementation(
      async (_deployment, operation) =>
        operation({ rpcUrl: "https://rpc.example" }),
    );
  });

  it.each(["buy", "sell"] as const)(
    "prepares a manifest-bound Classic V4 %s end to end",
    async (side) => {
      const response = await POST(request(side));
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        status: "ready",
        chainId: 1,
        token: TOKEN,
        side,
        transaction: {
          kind: "swap",
          to: (mocks.release as ClassicV4PublicRelease)
            .officialDependencies.universalRouter.address,
        },
      });
    },
  );

  it("fails closed before quoting when the V4 pool hook mismatches the release", async () => {
    mocks.poolHook = getAddress(
      "0x9999999999999999999999999999999999999999",
    );

    const response = await POST(request("buy"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "The token does not match the canonical launch pool",
    });
  });

  it("rejects an indexer-activated release before any trade RPC", async () => {
    mocks.release = classicV4Release(false);

    const response = await POST(request("buy"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "The canonical Classic V4 release is not configured",
    });
  });
});
