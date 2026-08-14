import { NextRequest } from "next/server";
import {
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import { createStockPairedPoolKey } from "../lib/trade/stock-paired";
import { computeOfficialV4PoolId } from "../lib/uniswap/liquidity-launcher-sdk";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  indexedEnabled: true,
  lookup: vi.fn(),
  readLegacy: vi.fn(),
  readBitquery: vi.fn(),
  createPublicClient: vi.fn(),
  verifyClaimReceipt: vi.fn(),
  resolveTradeDeployment: vi.fn(),
  prepareConversion: vi.fn(),
  conservativeConversion: vi.fn(),
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
const poolId = computeOfficialV4PoolId(
  createStockPairedPoolKey({ token, quoteAsset: quote, hook }),
);
const blockHash = `0x${"99".repeat(32)}` as Hex;
const launchTransactionHash = `0x${"aa".repeat(32)}` as Hex;
const configurationHash = `0x${"bb".repeat(32)}` as Hex;

const release = {
  internalContractRelease: "stock-paired-v1" as const,
  startBlock: 100,
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
    getLogs: vi.fn().mockResolvedValue([]),
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
    getWebsiteChartOnchainDeployment: () => ({
      status: "ready",
      chainId: 1,
    }),
    getWebsiteReadOnchainDeployment: () => ({
      status: "ready",
      chainId: 1,
    }),
    readExploreModel: mocks.readLegacy,
  };
});

vi.mock("../lib/market-data/bitquery-explore-model.server", () => ({
  readBitqueryExploreModelV1: mocks.readBitquery,
}));

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
    getConfiguredStockPairedReleases: () => [release],
  };
});

vi.mock(
  "../lib/server/stock-paired-claim-receipt",
  async (importOriginal) => {
    const actual = await importOriginal<
      typeof import("../lib/server/stock-paired-claim-receipt")
    >();
    return {
      ...actual,
      verifyStockPairedClaimReceipt: mocks.verifyClaimReceipt,
    };
  },
);

vi.mock("../lib/trade/stock-paired", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../lib/trade/stock-paired")
  >();
  return {
    ...actual,
    resolveStockPairedTradeDeployment: mocks.resolveTradeDeployment,
    prepareStockPairedRewardConversion: mocks.prepareConversion,
    conservativeRewardConversion: mocks.conservativeConversion,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
  };
});

import { GET, POST } from "../app/api/profile/stock-paired/route";
import { StockPairedClaimReceiptError } from "../lib/server/stock-paired-claim-receipt";

function request(action: "claim" | "convert-to-eth" = "claim") {
  return new NextRequest("http://localhost/api/profile/stock-paired", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action,
      account,
      vaultAddress: vault,
      chainId: 1,
      ...(action === "convert-to-eth"
        ? {
            claimTransactionHash: `0x${"12".repeat(32)}`,
            amountIn: actionReward.claimableRaw,
            slippageBps: 100,
            deadline: "1800000000",
          }
        : {}),
    }),
  });
}

describe("Stock-Paired action identity activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const drpc = "https://lb.drpc.live/ethereum/drpc-stock-key";
    const quicknode =
      "https://stock-node.ethereum-mainnet.quiknode.pro/quicknode-stock-key/";
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER",
      "drpc",
    );
    vi.stubEnv("PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL", drpc);
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
      rpcProviderCommitment("endpoint", drpc),
    );
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_PROVIDER",
      "quicknode",
    );
    vi.stubEnv("PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL", quicknode);
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_ENDPOINT_COMMITMENT",
      rpcProviderCommitment("endpoint", quicknode),
    );
    mocks.lookup.mockResolvedValue(actionReward);
    mocks.readLegacy.mockResolvedValue(legacyModel);
    mocks.readBitquery.mockResolvedValue(legacyModel);
    mocks.verifyClaimReceipt.mockResolvedValue(
      BigInt(actionReward.claimableRaw),
    );
    const preparedConversion = {
      status: "approval-required",
      approvalState: "token-to-permit2",
      launchModel: "stock-paired",
      conversion: "quote-asset-to-eth",
      chainId: 1,
      owner: account,
      token,
      quoteAsset: quote,
      inputAsset: quote,
      poolId,
      quote: {
        amountIn: actionReward.claimableRaw,
        amountOut: "1000000000000000",
        usdAmountOut: "2000000",
        amountOutMinimum: "990000000000000",
        gasEstimate: "100000",
        slippageBps: 100,
        deadline: "1800000000",
      },
      transaction: {
        kind: "token-to-permit2",
        chainId: 1,
        from: account,
        to: quote,
        data: "0x",
        value: "0",
        gasLimit: "100000",
        amountIn: actionReward.claimableRaw,
      },
    };
    mocks.resolveTradeDeployment.mockReturnValue({
      deployment: { quoteAsset: quote, poolId },
      verifiedToken: indexedToken,
    });
    mocks.prepareConversion.mockResolvedValue(preparedConversion);
    mocks.conservativeConversion.mockReturnValue(preparedConversion);
    let clientIndex = 0;
    mocks.createPublicClient.mockImplementation(() =>
      rpcClient(clientIndex++),
    );
  });

  it.each([true, false])(
    "uses one configured RPC with Bitquery identity when indexed lookup is %s",
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
      expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
      expect(mocks.readBitquery).toHaveBeenCalledTimes(1);
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.readLegacy).not.toHaveBeenCalled();
    },
  );

  it("uses exactly one committed dRPC client for the public profile GET", async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/profile/stock-paired?account=${account}`,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      account,
      chainId: 1,
      snapshotBlock: "120",
      rewards: [],
    });
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(mocks.readBitquery).not.toHaveBeenCalled();
    expect(response.headers.get("X-Programmable-Read-Source")).toBe("rpc");
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "drpc-primary",
    );
  });

  it("returns 503 without fallback when the sole profile provider fails", async () => {
    const failedClient = rpcClient(0);
    failedClient.getBlockNumber.mockRejectedValueOnce(
      new Error("dRPC unavailable"),
    );
    mocks.createPublicClient.mockReturnValueOnce(failedClient);

    const response = await GET(new NextRequest(
      `http://localhost/api/profile/stock-paired?account=${account}`,
    ));

    expect(response.status).toBe(503);
    expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
    expect(mocks.readBitquery).not.toHaveBeenCalled();
  });

  it("returns a stable conflict before preparing a conversion for a pending claim receipt", async () => {
    mocks.indexedEnabled = true;
    mocks.verifyClaimReceipt.mockRejectedValue(
      new StockPairedClaimReceiptError(
        "The claim receipt is still pending on Ethereum",
        "pending",
      ),
    );

    const response = await POST(request("convert-to-eth"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      status: "pending",
      code: "stock-paired-claim-receipt-pending",
      error: "The claim receipt is still pending on Ethereum",
    });
  });

  it("keeps a verified terminal claim receipt eligible for conversion", async () => {
    mocks.indexedEnabled = true;

    const response = await POST(request("convert-to-eth"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.verifyClaimReceipt).toHaveBeenCalledTimes(1);
    expect(body).toMatchObject({
      action: "convert-to-eth",
      vaultAddress: vault,
      claimTransactionHash: `0x${"12".repeat(32)}`,
      claimedAmount: actionReward.claimableRaw,
    });
  });

  it.each([true, false])(
    "ignores the secondary RPC configuration with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;
      vi.stubEnv(
        "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL",
        "https://lb.drpc.live/ethereum/second-stock-secret",
      );

      const response = await POST(request());
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(200);
      expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
      expect(serialized).not.toContain("drpc-stock-key");
      expect(serialized).not.toContain("second-stock-secret");
    },
  );
});
