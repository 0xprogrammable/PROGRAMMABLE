import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  readRouter: vi.fn(),
  assertProductionReadiness: vi.fn(),
  findRegistryProject: vi.fn(),
  publicEnabled: vi.fn(() => true),
  registryEnabled: vi.fn(() => true),
}));

vi.mock("../lib/alchemy/router-custom-public.server", () => ({
  readFinalizedRouterCustomIdentitySnapshotV1: async () => ({
    schemaVersion: "programmable.router-custom-identity-snapshot.v1",
    source: "canonical-launch-stamp-router",
    status: "current",
    generatedAt: "2026-08-27T00:00:00.000Z",
    asOfBlock: "25850000",
    asOfBlockHash: `0x${"a".repeat(64)}`,
    finalityConfirmations: 64,
    identityCommitment: `sha256:${"b".repeat(64)}`,
    entries: await mocks.readRouter(),
  }),
}));
vi.mock("../lib/server/custom-launch/public-readiness", () => ({
  isCustomLaunchPublicEnabled: mocks.publicEnabled,
  isCustomLaunchRegistryPublicReadEnabled: mocks.registryEnabled,
}));
vi.mock("../lib/server/projection-target/website-target", () => ({
  getProductionWebsiteProjectionTargetV1: () => ({
    assertProductionReadiness: mocks.assertProductionReadiness,
    registryCustomPublicStore: {
      findFinalizedCustomLaunchByProjectId: mocks.findRegistryProject,
    },
  }),
}));

import {
  FADE_ROUTER_TRADE_CAPABILITY_V1,
  FADE_ROUTER_TRADE_PROJECT_ID,
} from "../lib/custom-launch/router-trade-adapter-v1";
import {
  SHARD_ROUTER_TRADE_CAPABILITY_V1,
  SHARD_ROUTER_TRADE_MARKET_ID,
  SHARD_ROUTER_TRADE_PROJECT_ID,
} from "../lib/custom-launch/router-trade-adapters-v1";
import { parseCustomMarketTradeRequestV1 } from
  "../lib/custom-launch/trade-v1";
import {
  prepareCustomMarketTradeV1,
  type CustomMarketTradeRuntimeClientV1,
} from "../lib/server/custom-launch/trade-v1";
import { fadeRouterTradeEntry } from "./fade-router-trade-fixture";
import { shardRouterTradeEntry } from "./shard-router-trade-fixture";

const OWNER = "0x4000000000000000000000000000000000000000" as const;

function request(
  projectId: `sha256:${string}` = FADE_ROUTER_TRADE_PROJECT_ID,
  marketId = "fade-eth-v4",
) {
  return parseCustomMarketTradeRequestV1({
    schemaVersion: "programmable.custom-market-trade-prepare-request.v1",
    projectId,
    marketId,
    tradeCapabilityBindingHash:
      FADE_ROUTER_TRADE_CAPABILITY_V1.tradeCapabilityBindingHash,
    chainId: 1,
    owner: OWNER,
    recipient: OWNER,
    side: "quote-to-base",
    amountIn: "1000000000000000",
    slippageBps: 500,
    deadline: "2000",
  });
}

function shardRequest() {
  return parseCustomMarketTradeRequestV1({
    schemaVersion: "programmable.custom-market-trade-prepare-request.v1",
    projectId: SHARD_ROUTER_TRADE_PROJECT_ID,
    marketId: SHARD_ROUTER_TRADE_MARKET_ID,
    tradeCapabilityBindingHash:
      SHARD_ROUTER_TRADE_CAPABILITY_V1.tradeCapabilityBindingHash,
    chainId: 1,
    owner: OWNER,
    recipient: OWNER,
    side: "quote-to-base",
    amountIn: "10000000000000",
    slippageBps: 500,
    deadline: "2000",
  });
}

const unusedRuntimeClient = Object.freeze({
  getChainId: vi.fn(async () => 1),
  getBlock: vi.fn(async () => ({ number: 1n, timestamp: 1_000n })),
  getBalance: vi.fn(async () => 0n),
  getGasPrice: vi.fn(async () => 0n),
  getCode: vi.fn(async () => "0x" as const),
  readContract: vi.fn(async () => 0n),
  estimateGas: vi.fn(async () => 0n),
  call: vi.fn(async () => ({ data: "0x" as const })),
}) satisfies CustomMarketTradeRuntimeClientV1;

describe("reviewed Router trade server boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readRouter.mockResolvedValue([]);
    mocks.findRegistryProject.mockResolvedValue(null);
    mocks.publicEnabled.mockReturnValue(true);
    mocks.registryEnabled.mockReturnValue(true);
  });

  it("rereads finalized Router state and never falls through to Registry", async () => {
    await expect(prepareCustomMarketTradeV1({
      client: unusedRuntimeClient,
      request: request(),
    })).rejects.toThrow("not an exact finalized adapter");

    expect(mocks.readRouter).toHaveBeenCalledOnce();
    expect(mocks.assertProductionReadiness).not.toHaveBeenCalled();
    expect(mocks.findRegistryProject).not.toHaveBeenCalled();
  });

  it("rejects a drifted Router entry before any quote or transaction simulation", async () => {
    mocks.readRouter.mockResolvedValue([{
      ...fadeRouterTradeEntry,
      launchStampProvenance: {
        ...fadeRouterTradeEntry.launchStampProvenance!,
        poolKey: {
          ...fadeRouterTradeEntry.launchStampProvenance!.poolKey,
          tickSpacing: 60,
        },
      },
    }]);

    await expect(prepareCustomMarketTradeV1({
      client: unusedRuntimeClient,
      request: request(),
    })).rejects.toThrow("not an exact finalized adapter");
    expect(unusedRuntimeClient.getChainId).not.toHaveBeenCalled();
    expect(unusedRuntimeClient.call).not.toHaveBeenCalled();
  });

  it("does not couple the exact Router adapter to Registry-public readiness", async () => {
    mocks.publicEnabled.mockReturnValue(false);
    mocks.registryEnabled.mockReturnValue(false);
    mocks.readRouter.mockResolvedValue([fadeRouterTradeEntry]);

    await expect(prepareCustomMarketTradeV1({
      client: unusedRuntimeClient,
      request: request(),
    })).rejects.toThrow("runtime code no longer matches");

    expect(mocks.readRouter).toHaveBeenCalledOnce();
    expect(mocks.assertProductionReadiness).not.toHaveBeenCalled();
    expect(mocks.findRegistryProject).not.toHaveBeenCalled();
  });

  it("selects SHARD by project when multiple reviewed Router entries exist", async () => {
    mocks.readRouter.mockResolvedValue([
      fadeRouterTradeEntry,
      shardRouterTradeEntry,
    ]);

    await expect(prepareCustomMarketTradeV1({
      client: unusedRuntimeClient,
      request: shardRequest(),
    })).rejects.toThrow("runtime code no longer matches");

    expect(mocks.readRouter).toHaveBeenCalledOnce();
    expect(mocks.assertProductionReadiness).not.toHaveBeenCalled();
    expect(mocks.findRegistryProject).not.toHaveBeenCalled();
  });

  it("rejects a Router request for any market id other than exact FADE", async () => {
    mocks.readRouter.mockResolvedValue([fadeRouterTradeEntry]);

    await expect(prepareCustomMarketTradeV1({
      client: unusedRuntimeClient,
      request: request(FADE_ROUTER_TRADE_PROJECT_ID, "not-fade"),
    })).rejects.toThrow("does not match the supported market capability");

    expect(unusedRuntimeClient.getChainId).not.toHaveBeenCalled();
    expect(unusedRuntimeClient.call).not.toHaveBeenCalled();
  });

  it("keeps every unknown project on the existing Registry fail-closed path", async () => {
    await expect(prepareCustomMarketTradeV1({
      client: unusedRuntimeClient,
      request: request(`sha256:${"f".repeat(64)}`),
    })).rejects.toThrow("Custom project is not finalized");

    expect(mocks.readRouter).not.toHaveBeenCalled();
    expect(mocks.assertProductionReadiness).toHaveBeenCalledOnce();
    expect(mocks.findRegistryProject).toHaveBeenCalledOnce();
  });
});
