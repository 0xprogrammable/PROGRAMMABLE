import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";

const mocks = vi.hoisted(() => ({
  indexedEnabled: true,
  lookup: vi.fn(),
  readLegacy: vi.fn(),
  readBitquery: vi.fn(),
  readIdentity: vi.fn(),
  prepare: vi.fn(),
  createPublicClient: vi.fn(() => ({
    getBlockNumber: vi.fn().mockResolvedValue(100n),
    getBlock: vi.fn().mockResolvedValue({ hash: `0x${"22".repeat(32)}` }),
  })),
}));

const token = "0x1111111111111111111111111111111111111111";
const registry = {
  status: "ready" as const,
  tokens: [
    {
      id: `1:${token}`,
      name: "Action Token",
      symbol: "ACT",
      tokenAddress: token,
      hookAddress: "0x2222222222222222222222222222222222222222",
      poolId: `0x${"11".repeat(32)}`,
      launchedAt: "2026-07-31T00:00:00.000Z",
      totalSwapFeeBps: 100,
      launchModel: "classic" as const,
      liquidityPath: "meme" as const,
    },
  ],
  snapshot: {
    chainId: 1,
    blockNumber: "100",
    blockHash: `0x${"22".repeat(32)}`,
    confirmations: 12,
  },
  creatorClaims: [],
  launcherFeesAccruedWei: "0",
  launcherFeesAccruedEth: "0",
};

vi.mock("../lib/data-pipeline/route-activation.server", () => ({
  indexedLaunchLookupEnabled: () => mocks.indexedEnabled,
}));

vi.mock("../lib/data-pipeline/action-lookup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/data-pipeline/action-lookup")>();
  return {
    ...actual,
    lookupActionTokenByAddress: mocks.lookup,
    actionTokenAsExploreModel: () => registry,
  };
});

vi.mock("../lib/onchain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/onchain")>();
  return {
    ...actual,
    getWebsiteReadOnchainDeployment: () => ({ status: "ready", chainId: 1 }),
    readExploreModel: mocks.readLegacy,
  };
});

vi.mock("../lib/alchemy/explore.server", () => ({
  readAlchemyExploreModel: mocks.readLegacy,
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
    readTradeActionModelFromRpc: mocks.readIdentity,
  };
});

vi.mock("../lib/trade/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/trade/server")>();
  return {
    ...actual,
    getPinnedOfficialTradeStack: vi.fn(),
    resolveTradeDeployment: vi.fn(() => ({})),
    prepareClassicTrade: mocks.prepare,
  };
});

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
  };
});

import { POST } from "../app/api/trade/prepare/route";

const body = {
  chainId: 1,
  owner: "0x5555555555555555555555555555555555555555",
  token,
  side: "buy",
  amountIn: "1000000000000000",
  slippageBps: 100,
  deadline: "2000000000",
};

function request() {
  return new NextRequest("http://localhost/api/trade/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("trade action identity activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const drpc = "https://lb.drpc.live/ethereum/drpc-action-key";
    const quicknode =
      "https://action-node.ethereum-mainnet.quiknode.pro/quicknode-action-key/";
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
    mocks.lookup.mockResolvedValue({});
    mocks.readLegacy.mockResolvedValue(registry);
    mocks.readBitquery.mockResolvedValue(registry);
    mocks.readIdentity.mockResolvedValue(registry);
    mocks.prepare.mockResolvedValue({
      quote: { amountOut: "100" },
      transaction: { kind: "swap" },
    });
  });

  it.each([true, false])(
    "uses one committed RPC preparation with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;

      const response = await POST(request());

      expect(response.status).toBe(200);
      expect(mocks.prepare).toHaveBeenCalledTimes(1);
      expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
      expect(mocks.readIdentity).toHaveBeenCalledTimes(1);
      expect(mocks.readBitquery).not.toHaveBeenCalled();
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.readLegacy).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        quote: { amountOut: "100" },
      });
    },
  );

  it.each([true, false])(
    "does not consult the configured secondary RPC with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;
      vi.stubEnv(
        "PROGRAMMABLE_WEBSITE_MAINNET_RPC_SECONDARY_URL",
        "https://second-node.ethereum-mainnet.quiknode.pro/second-secret-key/",
      );

      const response = await POST(request());
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(200);
      expect(mocks.prepare).toHaveBeenCalledTimes(1);
      expect(mocks.createPublicClient).toHaveBeenCalledTimes(1);
      expect(mocks.readIdentity).toHaveBeenCalledTimes(1);
      expect(mocks.readBitquery).not.toHaveBeenCalled();
      expect(serialized).not.toContain("drpc-action-key");
      expect(serialized).not.toContain("second-secret-key");
    },
  );

  it("rejects a primary endpoint that does not match its commitment", async () => {
    vi.stubEnv(
      "PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT",
      `0x${"00".repeat(32)}`,
    );

    const response = await POST(request());
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload).toEqual({
      error:
        "The configured RPC could not prepare the trade from the current onchain state",
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.createPublicClient).not.toHaveBeenCalled();
    expect(mocks.readIdentity).not.toHaveBeenCalled();
  });
});
