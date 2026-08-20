import { NextRequest } from "next/server";
import {
  getAddress,
  keccak256,
  RpcRequestError,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { computeOfficialV4PoolId } from "../lib/uniswap/liquidity-launcher-sdk";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  indexedEnabled: true,
  lookup: vi.fn(),
  readAlchemy: vi.fn(),
  readLegacy: vi.fn(),
  readBitquery: vi.fn(),
  readIdentity: vi.fn(),
  createPublicClient: vi.fn(),
  getWebsiteReadOnchainDeployment: vi.fn(),
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
    "https://claim-node.ethereum-mainnet.quiknode.pro/quicknode-claim-key/" as
      string | null,
  rpcProviderIds: {
    primary: "drpc",
    secondary: "quicknode",
  },
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

function unavailableRpcClient(message = "provider capacity exceeded") {
  return {
    getBlockNumber: vi.fn().mockRejectedValue(new RpcRequestError({
      body: { method: "eth_blockNumber" },
      error: { code: 10, message },
      url: deployment.rpcUrl,
    })),
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
    getWebsiteReadOnchainDeployment:
      mocks.getWebsiteReadOnchainDeployment,
    readExploreModel: mocks.readLegacy,
  };
});

vi.mock("../lib/alchemy/explore.server", () => ({
  readAlchemyExploreModel: mocks.readAlchemy,
}));

vi.mock("../lib/market-data/bitquery-explore-model.server", () => ({
  readBitqueryExploreModelV1: mocks.readBitquery,
}));

vi.mock("../lib/server/action-rpc-identity.server", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../lib/server/action-rpc-identity.server")
  >();
  return {
    ...actual,
    readCreatorClaimIdentityFromRpc: mocks.readIdentity,
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
      "https://lb.drpc.live/ethereum/drpc-claim-key";
    deployment.rpcUrlSecondary =
      "https://claim-node.ethereum-mainnet.quiknode.pro/quicknode-claim-key/";
    mocks.getWebsiteReadOnchainDeployment.mockReturnValue(deployment);
    mocks.lookup.mockResolvedValue(indexedToken);
    mocks.readAlchemy.mockResolvedValue(legacyModel);
    mocks.readLegacy.mockResolvedValue(legacyModel);
    mocks.readBitquery.mockResolvedValue(legacyModel);
    mocks.readIdentity.mockResolvedValue({
      tokenAddress: token,
      hookAddress: hook,
      poolId,
      creatorAddress: creator,
      totalSwapFeeBps: 100,
    });
    mocks.createPublicClient.mockImplementation(() =>
      rpcClient(100_000n, 2_000_000_000n, 10n ** 18n),
    );
  });

  it.each([true, false])(
    "uses one committed provider for runtime checks and simulation with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;

      const response = await POST(request());
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        status: "ready",
        claim: { account: creator, tokenAddress: token, poolId },
        gas: {
          estimatedGas: "100000",
          gasPriceWei: "2000000000",
          accountBalanceWei: "1000000000000000000",
        },
        submission: {
          status: "not-submitted",
          transactionHash: null,
          receipt: null,
        },
      });
      expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
      expect(mocks.readIdentity).toHaveBeenCalledTimes(1);
      expect(mocks.readBitquery).not.toHaveBeenCalled();
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.readAlchemy).not.toHaveBeenCalled();
      expect(mocks.readLegacy).not.toHaveBeenCalled();
    },
  );

  it("retries the complete claim preparation on the fixed secondary after primary capacity failure", async () => {
    mocks.createPublicClient.mockReset();
    mocks.createPublicClient
      .mockReturnValueOnce(
        unavailableRpcClient("monthly capacity exceeded"),
      )
      .mockReturnValueOnce(
        rpcClient(100_001n, 2_000_000_001n, 10n ** 18n),
      );

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "ready",
      gas: {
        estimatedGas: "100001",
        gasPriceWei: "2000000001",
      },
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(2);
    expect(mocks.readIdentity).toHaveBeenCalledTimes(1);
  });

  it("does not expose a private RPC identity-read failure", async () => {
    mocks.readIdentity.mockRejectedValueOnce(
      new Error("dRPC provider failed with a private detail"),
    );

    const response = await POST(request());
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(502);
    expect(JSON.parse(serialized)).toMatchObject({
      status: "blocked",
      error: {
        code: "simulation-failed",
        message:
          "The configured RPC could not prepare the creator claim from the current onchain state",
      },
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(serialized).not.toContain("dRPC provider");
    expect(serialized).not.toContain("private detail");
  });

  it("returns a retryable typed error when the configured provider is unavailable", async () => {
    mocks.createPublicClient.mockReset();
    mocks.createPublicClient
      .mockReturnValueOnce(unavailableRpcClient())
      .mockReturnValueOnce(unavailableRpcClient());

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
    "fails closed before simulation when the primary commitment is invalid with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;
      mocks.getWebsiteReadOnchainDeployment.mockImplementationOnce(() => {
        throw new Error("Website primary RPC binding is invalid");
      });

      const response = await POST(request());
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(503);
      expect(JSON.parse(serialized)).toMatchObject({
        error: { code: "rpc-unavailable" },
      });
      expect(mocks.createPublicClient).not.toHaveBeenCalled();
      expect(mocks.readIdentity).not.toHaveBeenCalled();
      expect(serialized).not.toContain("drpc-claim-key");
    },
  );
});
