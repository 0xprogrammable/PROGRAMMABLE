import { NextRequest } from "next/server";
import {
  getAddress,
  RpcRequestError,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  indexedEnabled: true,
  lookup: vi.fn(),
  readCatalog: vi.fn(),
  createPublicClient: vi.fn(),
  getWebsiteReadOnchainDeployment: vi.fn(),
  runtimeHashes: {
    "0x01":
      "0x9cc9723456c471d90ac838c02fa4fc47ed4b7e82c85358e71deec978c48d2dc8",
    "0x02":
      "0x3eba781023d3146ed9b502ac5b402d39cea4c34a14f64c878cb9ea62149590f1",
    "0x03":
      "0x874ec76f396807bfcbbdd88cc2fd534f10201242ad0479a05fe5d2ee937616ee",
  } as const,
}));

const account = getAddress("0x1111111111111111111111111111111111111111");
const vault = getAddress("0x2222222222222222222222222222222222222222");
const token = getAddress("0x3333333333333333333333333333333333333333");
const launcher = getAddress("0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770");
const hook = getAddress("0x35fe236ea82f7cf525c9719d7df8f49f94d720cc");
const factory = getAddress("0xf28967f9dfac3ca21384b59d6d75c8106b3eab2a");
const poolId = `0x${"44".repeat(32)}` as Hex;
const blockHash = `0x${"55".repeat(32)}` as Hex;
const launchTransactionHash = `0x${"66".repeat(32)}` as Hex;
const drpcRpcUrl =
  "https://lb.drpc.live/ethereum/drpc-classic-key";
const quickNodeRpcUrl =
  "https://classic-mainnet.ethereum-mainnet.quiknode.pro/quicknode-classic-key/";
const deployment = {
  status: "ready" as const,
  environment: "production" as const,
  releaseVersion: "classic-v2" as const,
  chainId: 1 as const,
  rpcUrl: drpcRpcUrl,
  rpcUrlSecondary: quickNodeRpcUrl,
  rpcProviderIds: {
    primary: "drpc",
    secondary: "quicknode",
  },
};

const indexedToken = {
  chainId: 1 as const,
  releaseVersion: "classic-v3" as const,
  modelVersion: "classic" as const,
  tokenAddress: token,
  creatorAddress: account,
  launchTransactionHash,
  poolId,
  rewardVaultAddress: vault,
  launchHash: `0x${"77".repeat(32)}` as Hex,
  tokenName: "Classic Token",
  tokenSymbol: "CLS",
  totalSupplyRaw: "1000000000000000000000000000",
  launchedAt: "2026-07-31T00:00:00.000Z",
  hookAddress: hook,
  quoteAssetAddress: null,
  totalSwapFeeBps: 100,
  buySwapFeeBps: 100,
  sellSwapFeeBps: 100,
  buyCreatorFeeBps: 90,
  sellCreatorFeeBps: 90,
  creatorFeeBps: null,
  launcherFeeBps: 10,
  transferTaxBps: 0,
  lpFeePips: 0,
  promotedBlockNumber: "25639608",
  promotedBlockHash: blockHash,
  verifiedAt: "2026-07-31T00:01:00.000Z",
};

const actionReward = {
  chainId: 1 as const,
  account,
  vaultAddress: vault,
  poolId,
  hookAddress: hook,
  quoteAssetAddress: null,
  claimableRaw: "110000000000000000",
  claimedRaw: "0",
  entitledRaw: "110000000000000000",
  releaseVersion: "classic-v3" as const,
  modelVersion: "classic" as const,
  promotedBlockNumber: "25639608",
  promotedBlockHash: blockHash,
  verifiedAt: "2026-07-31T00:01:00.000Z",
  token: indexedToken,
};

const launchLog = {
  removed: false,
  transactionHash: launchTransactionHash,
  args: {
    deployer: account,
    token,
    poolId,
    feeHook: hook,
    rewardVault: vault,
    positionRecipient: account,
    positionTokenId: 1n,
    buySwapFeeBps: 100,
    sellSwapFeeBps: 100,
    rewardConfigurationHash: `0x${"88".repeat(32)}` as Hex,
    launchHash: `0x${"77".repeat(32)}` as Hex,
  },
};

function codeAt(address: Address) {
  const normalized = address.toLowerCase();
  if (normalized === launcher.toLowerCase()) return "0x01" as Hex;
  if (normalized === hook.toLowerCase()) return "0x02" as Hex;
  if (normalized === factory.toLowerCase()) return "0x03" as Hex;
  if (normalized === vault.toLowerCase()) return "0x6004" as Hex;
  return "0x" as Hex;
}

function contractRead(functionName: string) {
  switch (functionName) {
    case "shareBpsOf":
    case "shareBpsAt":
      return 10_000n;
    case "claimable":
      return 10n ** 17n;
    case "claimedBy":
      return 0n;
    case "name":
      return "Classic Token";
    case "symbol":
      return "CLS";
    case "beneficiaryCount":
      return 1n;
    case "isFactoryVault":
      return true;
    case "feeDisclosure":
      return [100, 100, 90, 90, 10, 0, 0, vault];
    case "poolFeeConfig":
      return [vault, launcher, 100, 100, true, 10n ** 16n];
    case "feeHook":
      return hook;
    case "poolId":
      return poolId;
    case "beneficiaryAt":
      return account;
    default:
      throw new Error(`Unexpected function ${functionName}`);
  }
}

function identityClient() {
  const getLogs = vi
    .fn()
    .mockResolvedValueOnce([launchLog])
    .mockResolvedValue([]);
  return {
    getCode: vi.fn(({ address }: { address: Address }) =>
      Promise.resolve(codeAt(address)),
    ),
    getBlockNumber: vi.fn().mockResolvedValue(25_700_000n),
    getLogs,
    readContract: vi.fn(
      ({ functionName }: { functionName: string }) =>
        Promise.resolve(contractRead(functionName)),
    ),
    call: vi.fn(),
  };
}

void identityClient;

function actionClient(index: number) {
  return {
    getCode: vi.fn(({ address }: { address: Address }) =>
      Promise.resolve(codeAt(address)),
    ),
    getBlockNumber: vi.fn().mockResolvedValue(25_700_000n),
    getBlock: vi.fn().mockResolvedValue({ hash: blockHash }),
    readContract: vi.fn(
      ({ functionName }: { functionName: string }) =>
        Promise.resolve(contractRead(functionName)),
    ),
    call: vi.fn().mockResolvedValue({ data: "0x" }),
    estimateGas: vi.fn().mockResolvedValue(100_000n + BigInt(index)),
    getGasPrice: vi.fn().mockResolvedValue(2_000_000_000n + BigInt(index)),
    getBalance: vi.fn().mockResolvedValue(10n ** 18n),
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
    lookupActionReward: mocks.lookup,
  };
});

vi.mock("../lib/market-data/envio-classic-v3-catalog.server", () => ({
  readEnvioClassicV3CatalogV1: mocks.readCatalog,
}));

vi.mock("../lib/onchain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/onchain")>();
  return {
    ...actual,
    getWebsiteReadOnchainDeployment:
      mocks.getWebsiteReadOnchainDeployment,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    keccak256: vi.fn((value: keyof typeof mocks.runtimeHashes) => {
      const mocked = mocks.runtimeHashes[value];
      return mocked ?? actual.keccak256(value);
    }),
  };
});

import { POST } from "../app/api/profile/classic-v3/route";

function request() {
  return new NextRequest("http://localhost/api/profile/classic-v3", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "claim",
      account,
      vaultAddress: vault,
      chainId: 1,
    }),
  });
}

describe("Classic V3 action identity activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWebsiteReadOnchainDeployment.mockReturnValue(deployment);
    mocks.lookup.mockResolvedValue(actionReward);
    mocks.readCatalog.mockResolvedValue({
      entries: [{
        exploreKind: "token",
        launchModelVersion: "classic-v3",
        rewardVaultAddress: vault,
        poolId,
        buyHookFeeBps: 100,
        sellHookFeeBps: 100,
        lpFeePips: 0,
      }],
    });
    mocks.createPublicClient.mockImplementation(() => actionClient(0));
  });

  it.each([true, false])(
    "uses Envio identity and one RPC when indexed lookup is %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;

      const response = await POST(request());

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: "ready",
        action: "claim",
        account,
        vaultAddress: vault,
        transaction: {
          kind: "claim-classic-v3-rewards",
          chainId: 1,
          from: account,
          to: vault,
        },
      });
      expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
      expect(mocks.readCatalog).toHaveBeenCalledTimes(1);
      expect(mocks.lookup).not.toHaveBeenCalled();
    },
  );

  it("retries the complete preparation once on the fixed secondary after primary capacity failure", async () => {
    const primaryRpcError = new RpcRequestError({
      body: { method: "eth_blockNumber" },
      error: { code: 10, message: "User balance exceeded" },
      url: drpcRpcUrl,
    });
    mocks.createPublicClient
      .mockReturnValueOnce({
        getBlockNumber: vi.fn().mockRejectedValue(primaryRpcError),
      })
      .mockReturnValueOnce(actionClient(1));

    const response = await POST(request());
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(2);
    expect(mocks.readCatalog).toHaveBeenCalledTimes(1);
    expect(serialized).not.toContain("drpc-classic-key");
    expect(serialized).not.toContain("quicknode-classic-key");
  });
});
