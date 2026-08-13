import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  indexedEnabled: true,
  lookup: vi.fn(),
  readLegacy: vi.fn(),
  prepare: vi.fn(),
  createPublicClient: vi.fn(() => ({})),
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
    getOnchainDeployment: () => ({ status: "ready", chainId: 1 }),
    readExploreModel: mocks.readLegacy,
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
    vi.stubEnv(
      "ETHEREUM_RPC_URL",
      "https://eth-mainnet.g.alchemy.com/v2/alchemy-action-key",
    );
    vi.stubEnv(
      "ETHEREUM_RPC_URL_B",
      "https://action-node.ethereum-mainnet.quiknode.pro/quicknode-action-key/",
    );
    mocks.lookup.mockResolvedValue({});
    mocks.readLegacy.mockResolvedValue(registry);
    mocks.prepare
      .mockResolvedValueOnce({
        quote: { amountOut: "100" },
        transaction: { kind: "swap" },
      })
      .mockResolvedValueOnce({
        quote: { amountOut: "99" },
        transaction: { kind: "swap" },
      });
  });

  it.each([true, false])(
    "uses two independent RPC preparations with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;

      const response = await POST(request());

      expect(response.status).toBe(200);
      expect(mocks.prepare).toHaveBeenCalledTimes(2);
      expect(mocks.createPublicClient).toHaveBeenCalledTimes(2);
      expect(mocks.lookup).toHaveBeenCalledTimes(indexedEnabled ? 1 : 0);
      expect(mocks.readLegacy).toHaveBeenCalledTimes(indexedEnabled ? 0 : 1);
      await expect(response.json()).resolves.toMatchObject({
        quote: { amountOut: "99" },
      });
    },
  );

  it.each([true, false])(
    "fails closed on same-provider key aliases with indexed lookup %s",
    async (indexedEnabled) => {
      mocks.indexedEnabled = indexedEnabled;
      vi.stubEnv(
        "ETHEREUM_RPC_URL_B",
        "https://eth-mainnet.g.alchemy.com/v2/second-secret-key",
      );

      const response = await POST(request());
      const serialized = JSON.stringify(await response.json());

      expect(response.status).toBe(502);
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.createPublicClient).not.toHaveBeenCalled();
      expect(serialized).not.toContain("alchemy-action-key");
      expect(serialized).not.toContain("second-secret-key");
    },
  );
});
