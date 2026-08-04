import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (reader: () => unknown) => reader,
}));

const mocks = vi.hoisted(() => ({
  getOnchainDeployment: vi.fn(),
  readDurableExploreModel: vi.fn(),
  advanceExploreLaunchDiscovery: vi.fn(),
  readAlchemyLaunchRegistry: vi.fn(),
  writeAlchemyLaunchRegistry: vi.fn(),
}));

vi.mock("../lib/onchain/config", () => ({
  getOnchainDeployment: mocks.getOnchainDeployment,
}));
vi.mock("../lib/onchain/durable-model", () => ({
  readDurableExploreModel: mocks.readDurableExploreModel,
}));
vi.mock("../lib/onchain/read-model", () => ({
  advanceExploreLaunchDiscovery: mocks.advanceExploreLaunchDiscovery,
}));
vi.mock("../lib/alchemy/launch-registry.server", () => ({
  readAlchemyLaunchRegistry: mocks.readAlchemyLaunchRegistry,
  writeAlchemyLaunchRegistry: mocks.writeAlchemyLaunchRegistry,
}));

import { refreshAlchemyExploreRegistry } from "../lib/alchemy/explore.server";

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x1111111111111111111111111111111111111111",
  feeHook: "0x2222222222222222222222222222222222222222",
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 1n,
  stateView: "0x3333333333333333333333333333333333333333",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/test-key-1234",
  rpcUrlSecondary: null,
  confirmations: 12n,
  logBlockRange: 5_000n,
} as const;

function token(address: `0x${string}`, blockNumber: string, logIndex: number) {
  return {
    id: `1:${address.toLowerCase()}`,
    name: `Token ${logIndex}`,
    symbol: `T${logIndex}`,
    tokenAddress: address,
    hookAddress: "0x4444444444444444444444444444444444444444",
    poolId: `0x${String(logIndex).padStart(64, "0")}`,
    launchBlockNumber: blockNumber,
    launchTransactionHash: `0x${String(logIndex + 10).padStart(64, "0")}`,
    launchLogIndex: logIndex,
    launchedAt: "2026-08-04T00:00:00.000Z",
    totalSwapFeeBps: 100,
    launchModel: "classic" as const,
    launchModelVersion: "classic-v3" as const,
    liquidityPath: "meme" as const,
  };
}

function snapshot(blockNumber: string) {
  return {
    chainId: 1,
    blockNumber,
    blockHash: `0x${BigInt(blockNumber).toString(16).padStart(64, "0")}`,
    confirmations: 12,
  } as const;
}

const baseToken = token(
  "0x5555555555555555555555555555555555555555",
  "90",
  1,
);
const newestToken = token(
  "0x6666666666666666666666666666666666666666",
  "109",
  2,
);
const baseModel = {
  status: "ready" as const,
  tokens: [baseToken],
  snapshot: snapshot("100"),
  creatorClaims: [],
  launcherFeesAccruedWei: "0",
  launcherFeesAccruedEth: "0",
};

describe("Alchemy launch overlay refresh", () => {
  beforeEach(() => {
    process.env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL = deployment.rpcUrl;
    process.env.VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getOnchainDeployment.mockReturnValue(deployment);
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "ready",
      envelope: { payload: { model: baseModel } },
    });
    mocks.readAlchemyLaunchRegistry.mockResolvedValue({
      registry: {
        generatedAt: "2026-08-04T00:00:00.000Z",
        repositoryCommit: "a".repeat(40),
        chainId: 1,
        cursor: snapshot("100"),
        tokens: [],
      },
      etag: "registry-etag",
    });
    mocks.writeAlchemyLaunchRegistry.mockResolvedValue({ etag: "next-etag" });
  });

  afterEach(() => {
    delete process.env.PROGRAMMABLE_ALCHEMY_MAINNET_RPC_URL;
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  it("keeps market-state and launch-discovery snapshots explicit", async () => {
    const confirmed = {
      ...baseModel,
      tokens: [baseToken, newestToken],
      snapshot: snapshot("110"),
    };
    const latest = { ...confirmed, snapshot: snapshot("111") };
    mocks.advanceExploreLaunchDiscovery
      .mockResolvedValueOnce(confirmed)
      .mockResolvedValueOnce(latest);

    const result = await refreshAlchemyExploreRegistry({ persist: false });

    expect(result.model.snapshot.blockNumber).toBe("100");
    expect(result.model.launchDiscoverySnapshot?.blockNumber).toBe("111");
    expect(result.model.tokens.map(({ tokenAddress }) => tokenAddress)).toEqual([
      baseToken.tokenAddress,
      newestToken.tokenAddress,
    ]);
    expect(result.model.tokens[1]).toMatchObject({
      launchDiscoverySource: "alchemy-launch-overlay",
    });
    expect(result).toMatchObject({
      baseBlockNumber: "100",
      confirmedBlockNumber: "110",
      servedBlockNumber: "111",
      persisted: false,
    });
    expect(mocks.writeAlchemyLaunchRegistry).not.toHaveBeenCalled();
  });

  it("periodically persists cursor progress even when no token launched", async () => {
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      snapshot: snapshot("164"),
    });

    const result = await refreshAlchemyExploreRegistry({
      includeLatest: false,
    });

    expect(result.registryChanged).toBe(true);
    expect(mocks.writeAlchemyLaunchRegistry).toHaveBeenCalledWith(
      deployment,
      expect.objectContaining({
        cursor: expect.objectContaining({ blockNumber: "164" }),
        tokens: [],
      }),
      "registry-etag",
    );
  });

  it("persists only confirmed overlay tokens and tags only the served copy", async () => {
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      tokens: [baseToken, newestToken],
      snapshot: snapshot("110"),
    });

    const result = await refreshAlchemyExploreRegistry({
      includeLatest: false,
    });

    const persisted = mocks.writeAlchemyLaunchRegistry.mock.calls[0]?.[1];
    expect(persisted.tokens).toHaveLength(1);
    expect(persisted.tokens[0]).not.toHaveProperty("launchDiscoverySource");
    expect(result.model.tokens[1]).toMatchObject({
      launchDiscoverySource: "alchemy-launch-overlay",
    });
  });

  it("retries an ETag conflict once but does not retry an RPC failure", async () => {
    mocks.advanceExploreLaunchDiscovery.mockResolvedValue({
      ...baseModel,
      snapshot: snapshot("164"),
    });
    const conflict = new Error("conflict");
    conflict.name = "BlobPreconditionFailedError";
    mocks.writeAlchemyLaunchRegistry
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ etag: "winner-etag" });

    await refreshAlchemyExploreRegistry({
      includeLatest: false,
      requirePersistence: true,
    });
    expect(mocks.readAlchemyLaunchRegistry).toHaveBeenCalledTimes(2);

    mocks.readDurableExploreModel.mockReset();
    mocks.readDurableExploreModel.mockRejectedValue(new Error("RPC failed"));
    await expect(
      refreshAlchemyExploreRegistry({ includeLatest: false }),
    ).rejects.toThrow("RPC failed");
    expect(mocks.readDurableExploreModel).toHaveBeenCalledTimes(1);
  });
});
