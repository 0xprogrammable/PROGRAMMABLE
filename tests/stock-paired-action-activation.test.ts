import { NextRequest } from "next/server";
import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  indexedEnabled: true,
  lookup: vi.fn(),
  readLegacy: vi.fn(),
  createPublicClient: vi.fn(),
}));

const account = getAddress("0x1111111111111111111111111111111111111111");
const token = getAddress("0x2222222222222222222222222222222222222222");
const hook = getAddress("0x3333333333333333333333333333333333333333");
const vault = getAddress("0x4444444444444444444444444444444444444444");
const launcher = getAddress("0x5555555555555555555555555555555555555555");
const factory = getAddress("0x6666666666666666666666666666666666666666");
const quote = getAddress("0x7777777777777777777777777777777777777777");
const hookCode = "0x6001600155" as Hex;
const factoryCode = "0x6002600255" as Hex;
const vaultCode = "0x6003600355" as Hex;
const poolId = `0x${"88".repeat(32)}` as Hex;
const blockHash = `0x${"99".repeat(32)}` as Hex;
const launchTransactionHash = `0x${"aa".repeat(32)}` as Hex;
const configurationHash = `0x${"bb".repeat(32)}` as Hex;

const release = {
  internalContractRelease: "stock-paired-v1" as const,
  addresses: {
    feeHook: hook,
    feeSplitVaultFactory: factory,
    launcher,
  },
  runtimeCodeHashes: {
    feeHook: keccak256(hookCode),
    feeSplitVaultFactory: keccak256(factoryCode),
  },
};

const indexedToken = {
  chainId: 1 as const,
  releaseVersion: "stock-paired-v1" as const,
  modelVersion: "stock-paired" as const,
  tokenAddress: token,
  creatorAddress: account,
  launchTransactionHash,
  poolId,
  rewardVaultAddress: vault,
  launchHash: `0x${"cc".repeat(32)}` as Hex,
  tokenName: "Stock Token",
  tokenSymbol: "STK",
  totalSupplyRaw: "1000000000000000000000000000",
  launchedAt: "2026-07-31T00:00:00.000Z",
  hookAddress: hook,
  quoteAssetAddress: quote,
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

const actionReward = {
  chainId: 1 as const,
  account,
  vaultAddress: vault,
  poolId,
  hookAddress: hook,
  quoteAssetAddress: quote,
  claimableRaw: "1100000000000000000",
  claimedRaw: "0",
  entitledRaw: "1100000000000000000",
  releaseVersion: "stock-paired-v1" as const,
  modelVersion: "stock-paired" as const,
  promotedBlockNumber: "100",
  promotedBlockHash: blockHash,
  verifiedAt: "2026-07-31T00:01:00.000Z",
  token: indexedToken,
};

const launcherToken = {
  id: `1:${token}`,
  name: "Stock Token",
  symbol: "STK",
  tokenAddress: token,
  hookAddress: hook,
  poolId,
  creatorAddress: account,
  rewardVaultAddress: vault,
  quoteAssetAddress: quote,
  launchTransactionHash,
  launchedAt: "2026-07-31T00:00:00.000Z",
  totalSwapFeeBps: 100,
  launchModel: "stock-paired" as const,
  launchModelVersion: "stock-paired-v1" as const,
  liquidityPath: "meme" as const,
};

const legacyModel = {
  status: "ready" as const,
  tokens: [launcherToken],
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

function rpcClient(index: number) {
  return {
    getBlockNumber: vi.fn().mockResolvedValue(120n),
    getBlock: vi.fn().mockResolvedValue({ hash: blockHash }),
    getCode: vi.fn(({ address }: { address: Address }) => {
      const normalized = address.toLowerCase();
      if (normalized === hook.toLowerCase()) return Promise.resolve(hookCode);
      if (normalized === factory.toLowerCase()) {
        return Promise.resolve(factoryCode);
      }
      if (normalized === vault.toLowerCase()) return Promise.resolve(vaultCode);
      return Promise.resolve("0x" as Hex);
    }),
    readContract: vi.fn(
      ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case "isFactoryVault":
            return Promise.resolve(true);
          case "feeHook":
            return Promise.resolve(hook);
          case "poolId":
            return Promise.resolve(poolId);
          case "quoteAsset":
            return Promise.resolve(quote);
          case "configurationHash":
            return Promise.resolve(configurationHash);
          case "beneficiaryCount":
            return Promise.resolve(1n);
          case "shareBpsOf":
            return Promise.resolve(10_000n);
          case "payoutAddressOf":
          case "beneficiaryAt":
            return Promise.resolve(account);
          case "claimedBy":
            return Promise.resolve(0n);
          case "totalCreatorFeesReceived":
            return Promise.resolve(10n ** 18n);
          case "poolFeeConfig":
            return Promise.resolve([
              quote,
              token,
              vault,
              launcher,
              true,
              true,
              10n ** 17n,
            ]);
          default:
            throw new Error(`Unexpected function ${functionName}`);
        }
      },
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

vi.mock("../lib/onchain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/onchain")>();
  return {
    ...actual,
    getOnchainDeployment: () => ({ status: "ready", chainId: 1 }),
    readExploreModel: mocks.readLegacy,
  };
});

vi.mock("../lib/stock-paired", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/stock-paired")>();
  return {
    ...actual,
    getStockPairedQuoteAssetForRelease: () => ({
      address: quote,
      symbol: "USDY",
    }),
  };
});

vi.mock("../lib/stock-paired-release", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/stock-paired-release")>();
  return {
    ...actual,
    getConfiguredStockPairedReleaseByHookAndVersion: () => release,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
  };
});

import { POST } from "../app/api/profile/stock-paired/route";

function request() {
  return new NextRequest("http://localhost/api/profile/stock-paired", {
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

describe("Stock-Paired action identity activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv(
      "ETHEREUM_RPC_URL",
      "https://eth-mainnet.g.alchemy.com/v2/alchemy-stock-key",
    );
    vi.stubEnv(
      "ETHEREUM_RPC_URL_B",
      "https://stock-node.quiknode.pro/quicknode-stock-key/",
    );
    mocks.lookup.mockResolvedValue(actionReward);
    mocks.readLegacy.mockResolvedValue(legacyModel);
    let clientIndex = 0;
    mocks.createPublicClient.mockImplementation(() =>
      rpcClient(clientIndex++),
    );
  });

  it.each([true, false])(
    "uses the same multi-provider state checks and simulations with indexed lookup %s",
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
          kind: "claim-stock-paired-rewards",
          chainId: 1,
          from: account,
          to: vault,
        },
      });
      expect(mocks.createPublicClient.mock.calls.length).toBeGreaterThanOrEqual(
        2,
      );
      expect(mocks.lookup).toHaveBeenCalledTimes(indexedEnabled ? 1 : 0);
      expect(mocks.readLegacy).toHaveBeenCalledTimes(indexedEnabled ? 0 : 1);
    },
  );

  it.each([true, false])(
    "fails closed on same-provider aliases with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;
      vi.stubEnv(
        "ETHEREUM_RPC_URL_B",
        "https://eth-mainnet.g.alchemy.com/v2/second-stock-secret",
      );

      const response = await POST(request());
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(503);
      expect(mocks.createPublicClient).not.toHaveBeenCalled();
      expect(serialized).not.toContain("alchemy-stock-key");
      expect(serialized).not.toContain("second-stock-secret");
    },
  );
});
