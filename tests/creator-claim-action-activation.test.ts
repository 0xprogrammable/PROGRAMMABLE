import { NextRequest } from "next/server";
import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeOfficialV4PoolId } from "../lib/uniswap/liquidity-launcher-sdk";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  indexedEnabled: true,
  lookup: vi.fn(),
  readLegacy: vi.fn(),
  createPublicClient: vi.fn(),
}));

const creator = getAddress("0x1111111111111111111111111111111111111111");
const token = getAddress("0x2222222222222222222222222222222222222222");
const hook = getAddress("0x3333333333333333333333333333333333333333");
const launcher = getAddress("0x4444444444444444444444444444444444444444");
const hookCode = "0x6001600155" as Hex;
const launcherCode = "0x6002600255" as Hex;
const blockHash = `0x${"55".repeat(32)}` as Hex;
const poolId = computeOfficialV4PoolId({
  currency0: "0x0000000000000000000000000000000000000000",
  currency1: token,
  fee: 0,
  tickSpacing: 200,
  hooks: hook,
});

const deployment = {
  environment: "production" as const,
  releaseVersion: "classic-v2" as const,
  chainId: 1 as const,
  status: "ready" as const,
  launcher,
  feeHook: hook,
  launcherRuntimeCodeHash: keccak256(launcherCode),
  feeHookRuntimeCodeHash: keccak256(hookCode),
  deploymentBlock: 1n,
  stateView: getAddress("0x6666666666666666666666666666666666666666"),
  stateViewRuntimeCodeHash: `0x${"77".repeat(32)}` as Hex,
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/alchemy-claim-key",
  rpcUrlSecondary:
    "https://claim-node.quiknode.pro/quicknode-claim-key/",
  confirmations: 12n,
  logBlockRange: 10_000n,
};

const indexedToken = {
  chainId: 1 as const,
  releaseVersion: "classic-v2" as const,
  modelVersion: "classic" as const,
  tokenAddress: token,
  creatorAddress: creator,
  launchTransactionHash: `0x${"88".repeat(32)}` as Hex,
  poolId,
  rewardVaultAddress: null,
  launchHash: `0x${"99".repeat(32)}` as Hex,
  tokenName: "Claim Token",
  tokenSymbol: "CLM",
  totalSupplyRaw: "1000000000000000000000000000",
  launchedAt: "2026-07-31T00:00:00.000Z",
  hookAddress: hook,
  quoteAssetAddress: null,
  totalSwapFeeBps: 100,
  buySwapFeeBps: 100,
  sellSwapFeeBps: 100,
  buyCreatorFeeBps: 90,
  sellCreatorFeeBps: 90,
  creatorFeeBps: 90,
  launcherFeeBps: 10,
  transferTaxBps: 0,
  lpFeePips: 0,
  promotedBlockNumber: "100",
  promotedBlockHash: blockHash,
  verifiedAt: "2026-07-31T00:01:00.000Z",
};

const legacyModel = {
  status: "ready" as const,
  tokens: [
    {
      id: `1:${token}`,
      name: "Claim Token",
      symbol: "CLM",
      tokenAddress: token,
      hookAddress: hook,
      poolId,
      creatorAddress: creator,
      launchedAt: "2026-07-31T00:00:00.000Z",
      totalSwapFeeBps: 100,
      buyHookFeeBps: 100,
      sellHookFeeBps: 100,
      creatorFeeBps: 90,
      launcherFeeBps: 10,
      transferTaxBps: 0,
      lpFeePips: 0,
      launchModel: "classic" as const,
      liquidityPath: "meme" as const,
    },
  ],
  snapshot: {
    chainId: 1,
    blockNumber: "100",
    blockHash,
    confirmations: 12,
  },
  creatorClaims: [],
  launcherFeesAccruedWei: "0",
  launcherFeesAccruedEth: "0",
};

function rpcClient(estimatedGas: bigint, gasPrice: bigint, balance: bigint) {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(120n),
    getBlock: vi.fn().mockResolvedValue({ hash: blockHash }),
    getCode: vi.fn(({ address }: { address: Address }) =>
      Promise.resolve(
        address.toLowerCase() === hook.toLowerCase()
          ? hookCode
          : launcherCode,
      ),
    ),
    readContract: vi.fn(
      ({ functionName }: { functionName: string }) => {
        if (functionName === "poolFeeConfig") {
          return Promise.resolve([creator, launcher, 100, true, 10n ** 16n]);
        }
        if (functionName === "feeDisclosure") {
          return Promise.resolve([100, 100, 90, 10, 0, 0]);
        }
        throw new Error(`Unexpected function ${functionName}`);
      },
    ),
    call: vi.fn().mockResolvedValue({ data: "0x" }),
    estimateGas: vi.fn().mockResolvedValue(estimatedGas),
    getGasPrice: vi.fn().mockResolvedValue(gasPrice),
    getBalance: vi.fn().mockResolvedValue(balance),
  };
}

function unavailableRpcClient(message = "provider capacity unavailable") {
  return {
    getBlockNumber: vi.fn().mockRejectedValue(new Error(message)),
  };
}

vi.mock("../lib/data-pipeline/route-activation.server", () => ({
  indexedLaunchLookupEnabled: () => mocks.indexedEnabled,
}));

vi.mock("../lib/data-pipeline/action-lookup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/data-pipeline/action-lookup")>();
  return {
    ...actual,
    lookupActionTokenByPoolId: mocks.lookup,
  };
});

vi.mock("../lib/onchain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/onchain")>();
  return {
    ...actual,
    getOnchainDeployment: () => deployment,
    readExploreModel: mocks.readLegacy,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
  };
});

import { POST } from "../app/api/explore/profile/claim/route";

function request() {
  return new NextRequest("http://localhost/api/explore/profile/claim", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account: creator, poolId, chainId: 1 }),
  });
}

describe("creator claim action identity activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deployment.rpcUrl =
      "https://eth-mainnet.g.alchemy.com/v2/alchemy-claim-key";
    deployment.rpcUrlSecondary =
      "https://claim-node.quiknode.pro/quicknode-claim-key/";
    mocks.lookup.mockResolvedValue(indexedToken);
    mocks.readLegacy.mockResolvedValue(legacyModel);
    const clients = [
      rpcClient(100_000n, 2_000_000_000n, 10n ** 18n),
      rpcClient(110_000n, 3_000_000_000n, 9n * 10n ** 17n),
      rpcClient(100_000n, 2_000_000_000n, 10n ** 18n),
      rpcClient(110_000n, 3_000_000_000n, 9n * 10n ** 17n),
    ];
    mocks.createPublicClient
      .mockImplementationOnce(() => clients[0])
      .mockImplementationOnce(() => clients[1])
      .mockImplementationOnce(() => clients[2])
      .mockImplementationOnce(() => clients[3]);
  });

  it.each([true, false])(
    "keeps two-provider runtime checks and simulations with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;

      const response = await POST(request());
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        status: "ready",
        claim: { account: creator, tokenAddress: token, poolId },
        gas: {
          estimatedGas: "110000",
          gasPriceWei: "3000000000",
          accountBalanceWei: "900000000000000000",
        },
      });
      expect(mocks.createPublicClient).toHaveBeenCalledTimes(4);
      expect(mocks.lookup).toHaveBeenCalledTimes(indexedEnabled ? 1 : 0);
      expect(mocks.readLegacy).toHaveBeenCalledTimes(indexedEnabled ? 0 : 1);
    },
  );

  it("uses two agreeing fixed fallback providers when both configured providers are unavailable", async () => {
    const clients = [
      unavailableRpcClient("monthly capacity exceeded"),
      unavailableRpcClient("secondary transport unavailable"),
      rpcClient(105_000n, 2_500_000_000n, 8n * 10n ** 17n),
      rpcClient(108_000n, 2_700_000_000n, 7n * 10n ** 17n),
    ];
    mocks.createPublicClient.mockReset();
    for (const client of clients) {
      mocks.createPublicClient.mockImplementationOnce(() => client);
    }

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "ready",
      claim: { account: creator, tokenAddress: token, poolId },
      gas: {
        estimatedGas: "108000",
        gasPriceWei: "2700000000",
        accountBalanceWei: "700000000000000000",
      },
    });
  });

  it("returns a retryable typed error when fewer than two providers can be verified", async () => {
    mocks.createPublicClient.mockReset();
    for (let index = 0; index < 4; index += 1) {
      mocks.createPublicClient.mockImplementationOnce(() =>
        unavailableRpcClient(),
      );
    }

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload).toMatchObject({
      status: "blocked",
      error: {
        code: "rpc-unavailable",
        message: "Creator claim reads are temporarily unavailable. Try again",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("capacity");
  });

  it.each([true, false])(
    "fails closed before simulation for same-provider aliases with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;
      deployment.rpcUrlSecondary =
        "https://eth-mainnet.g.alchemy.com/v2/second-claim-secret";

      const response = await POST(request());
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(503);
      expect(JSON.parse(serialized)).toMatchObject({
        error: { code: "rpc-unavailable" },
      });
      expect(mocks.createPublicClient).not.toHaveBeenCalled();
      expect(serialized).not.toContain("alchemy-claim-key");
      expect(serialized).not.toContain("second-claim-secret");
    },
  );
});
