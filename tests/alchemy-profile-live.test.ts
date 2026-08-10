import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createPublicClient: vi.fn(),
  getBlock: vi.fn(),
  getLogs: vi.fn(),
  http: vi.fn((url: string) => ({ url })),
  multicall: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: mocks.createPublicClient,
    http: mocks.http,
  };
});

import { HttpRequestError } from "viem";
import {
  AlchemyCreatorProfileIntegrityError,
  readAlchemyCreatorProfile,
} from "../lib/alchemy/profile.server";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const account = "0x1111111111111111111111111111111111111111" as const;
const poolId = `0x${"22".repeat(32)}` as const;
const tokenAddress = "0x3333333333333333333333333333333333333333" as const;
const hookAddress = "0x4444444444444444444444444444444444444444" as const;
const secondPoolId = `0x${"23".repeat(32)}` as const;
const secondTokenAddress =
  "0x3434343434343434343434343434343434343434" as const;

const deployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher: "0x5555555555555555555555555555555555555555",
  feeHook: hookAddress,
  launcherRuntimeCodeHash: `0x${"11".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"22".repeat(32)}`,
  deploymentBlock: 1n,
  stateView: "0x6666666666666666666666666666666666666666",
  stateViewRuntimeCodeHash: `0x${"33".repeat(32)}`,
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/redacted",
  rpcUrlSecondary: null,
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

const token = {
  id: "1:classic",
  name: "Classic",
  symbol: "CLS",
  tokenAddress,
  hookAddress,
  poolId,
  creatorAddress: account,
  positionRecipient: account,
  positionTokenId: "1",
  launchHash: `0x${"66".repeat(32)}` as const,
  launchTransactionHash: `0x${"77".repeat(32)}` as const,
  launchLogIndex: 0,
  launchBlockNumber: "90",
  launchedAt: "2026-08-04T00:00:00.000Z",
  launchModel: "classic" as const,
  totalSwapFeeBps: 100,
  creatorFeesAccruedWei: "0",
  creatorFeesGeneratedWei: "0",
  liquidityPath: "meme" as const,
} satisfies LauncherToken;

const secondToken = {
  ...token,
  id: "1:classic-second",
  name: "Classic second",
  symbol: "CLS2",
  tokenAddress: secondTokenAddress,
  poolId: secondPoolId,
  positionTokenId: "2",
  launchHash: `0x${"67".repeat(32)}` as const,
  launchTransactionHash: `0x${"78".repeat(32)}` as const,
  launchLogIndex: 1,
} satisfies LauncherToken;

function customGraphProvenance() {
  const launchId = `0x${"aa".repeat(32)}` as const;
  const stampHash = `0x${"ab".repeat(32)}` as const;
  const poolManagerAddress =
    "0x000000000004444c5dc75cB358380D2e3dE08A90" as const;
  return {
    schemaVersion: "programmable.launch-stamp-provenance.v1",
    chainId: 1,
    routerAddress: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
    routerRuntimeCodeHash:
      "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
    routerStartBlock: "25717612",
    finalityConfirmations: 64,
    kind: "custom-graph",
    launchId,
    stampHash,
    launchWallet: account,
    transactionHash: `0x${"ad".repeat(32)}`,
    blockNumber: "25717620",
    blockHash: `0x${"ae".repeat(32)}`,
    transactionIndex: 2,
    routeLogIndex: 8,
    launchLogIndex: 9,
    finalizedAtBlockNumber: "25717684",
    finalizedAtBlockHash: `0x${"af".repeat(32)}`,
    poolManagerAddress,
    poolId: `0x${"99".repeat(32)}`,
    poolKey: {
      currency0: "0x0000000000000000000000000000000000000000",
      currency1: "0x7777777777777777777777777777777777777777",
      fee: 3_000,
      tickSpacing: 60,
      hooks: "0x8888888888888888888888888888888888888888",
    },
    poolKeyHash: `0x${"b1".repeat(32)}`,
    componentSetHash: `0x${"b2".repeat(32)}`,
    routePayloadHash: `0x${"b3".repeat(32)}`,
    routeLauncherAddress:
      "0x9999999999999999999999999999999999999999",
    routeLauncherRuntimeCodeHash: `0x${"b4".repeat(32)}`,
    expectedResultHash: `0x${"b5".repeat(32)}`,
    permitDigest: `0x${"b6".repeat(32)}`,
    components: [
      {
        address: "0x7777777777777777777777777777777777777777",
        kind: "token",
        scope: "exclusive",
        runtimeCodeHash: `0x${"b7".repeat(32)}`,
        logIndex: 6,
        exclusiveProof: { launchId, stampHash },
      },
      {
        address: "0x8888888888888888888888888888888888888888",
        kind: "hook",
        scope: "exclusive",
        runtimeCodeHash: `0x${"b8".repeat(32)}`,
        logIndex: 7,
        exclusiveProof: { launchId, stampHash },
      },
    ],
    tokenProof: {
      tokenAddress: "0x7777777777777777777777777777777777777777",
      launchId,
      stampHash,
    },
    poolProof: {
      poolManagerAddress,
      poolId: `0x${"99".repeat(32)}`,
      launchId,
      stampHash,
    },
  } as const;
}

const customGraphToken = {
  id: "1:custom-graph",
  name: "Stamped graph",
  symbol: "GRAPH",
  tokenAddress: "0x7777777777777777777777777777777777777777",
  hookAddress: "0x8888888888888888888888888888888888888888",
  poolId: `0x${"99".repeat(32)}`,
  creatorAddress: account,
  launchBlockNumber: "25717620",
  launchTransactionHash: `0x${"ad".repeat(32)}`,
  launchLogIndex: 9,
  launchedAt: "2026-08-09T00:00:00.000Z",
  launchModel: "custom-graph",
  totalSwapFeeBps: null,
  launchStampProvenance: customGraphProvenance(),
  liquidityPath: "programmable-v4",
} satisfies LauncherToken;

function classicLiveModel(): ExploreReadModel {
  return {
    status: "ready",
    tokens: [token],
    snapshot: {
      chainId: 1,
      blockNumber: "100",
      blockHash: `0x${"99".repeat(32)}`,
      confirmations: 12,
    },
    launchDiscoverySnapshot: {
      chainId: 1,
      blockNumber: "105",
      blockHash: `0x${"aa".repeat(32)}`,
      confirmations: 0,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  };
}

describe("Alchemy live creator profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPublicClient.mockReturnValue({
      getBlock: mocks.getBlock,
      getLogs: mocks.getLogs,
      multicall: mocks.multicall,
    });
  });

  it("combines current claimable state with confirmed claim history", async () => {
    mocks.multicall.mockResolvedValue([
      {
        status: "success",
        result: [account, deployment.launcher, 100, true, 5n],
      },
    ]);
    mocks.getLogs.mockResolvedValue([
      {
        removed: false,
        blockNumber: 102n,
        transactionHash: `0x${"88".repeat(32)}`,
        transactionIndex: 1,
        logIndex: 2,
        args: {
          poolId,
          creator: account,
          recipient: account,
          caller: account,
          amount: 10n,
        },
      },
    ]);
    mocks.getBlock.mockResolvedValue({ timestamp: 1_775_000_000n });
    const model = {
      status: "ready",
      tokens: [token],
      snapshot: {
        chainId: 1,
        blockNumber: "100",
        blockHash: `0x${"99".repeat(32)}`,
        confirmations: 12,
      },
      launchDiscoverySnapshot: {
        chainId: 1,
        blockNumber: "105",
        blockHash: `0x${"aa".repeat(32)}`,
        confirmations: 0,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel;

    const profile = await readAlchemyCreatorProfile({
      account,
      deployment,
      model,
    });

    expect(profile.snapshot?.blockNumber).toBe("105");
    expect(profile.totals).toMatchObject({
      claimableWei: "5",
      claimedWei: "10",
      generatedWei: "15",
    });
    expect(profile.claims).toHaveLength(1);
    expect(profile.pools[0]).toMatchObject({
      claimableCreatorFeesWei: "5",
      generatedCreatorFeesWei: "15",
    });
    expect(mocks.multicall).toHaveBeenCalledWith(
      expect.objectContaining({
        contracts: [expect.objectContaining({ address: hookAddress })],
      }),
    );
    expect(mocks.getLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        args: { poolId: [poolId], creator: account },
      }),
    );
  });

  it("restarts the creator read on secondary after primary capacity", async () => {
    const primaryUrl = "https://primary.example/rpc-key";
    const secondaryUrl = "https://secondary.example/rpc-key";
    const capacity = new HttpRequestError({
      status: 429,
      url: primaryUrl,
    });
    const primaryClient = {
      getBlock: vi.fn().mockRejectedValue(capacity),
      getLogs: vi.fn().mockRejectedValue(capacity),
      multicall: vi.fn().mockRejectedValue(capacity),
    };
    const secondaryClient = {
      getBlock: vi.fn(),
      getLogs: vi.fn().mockResolvedValue([]),
      multicall: vi.fn().mockResolvedValue([
        {
          status: "success",
          result: [account, deployment.launcher, 100, true, 5n],
        },
      ]),
    };
    mocks.createPublicClient.mockImplementation(
      ({ transport }: { transport: { url: string } }) =>
        transport.url === primaryUrl ? primaryClient : secondaryClient,
    );
    const model = {
      status: "ready",
      tokens: [token],
      snapshot: {
        chainId: 1,
        blockNumber: "100",
        blockHash: `0x${"99".repeat(32)}`,
        confirmations: 12,
      },
      launchDiscoverySnapshot: {
        chainId: 1,
        blockNumber: "105",
        blockHash: `0x${"aa".repeat(32)}`,
        confirmations: 0,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel;

    const profile = await readAlchemyCreatorProfile({
      account,
      deployment: {
        ...deployment,
        rpcUrl: primaryUrl,
        rpcUrlSecondary: secondaryUrl,
      },
      model,
    });

    expect(profile.totals).toMatchObject({
      claimableWei: "5",
      generatedWei: "5",
    });
    expect(primaryClient.multicall).toHaveBeenCalledTimes(1);
    expect(secondaryClient.multicall).toHaveBeenCalledTimes(1);
    expect(mocks.createPublicClient.mock.calls.map(
      ([{ transport }]) => transport.url,
    )).toEqual([
      primaryUrl,
      primaryUrl,
      secondaryUrl,
      secondaryUrl,
    ]);
  });

  it("fails closed instead of re-dating cached rewards after a deterministic pool read error", async () => {
    const isolatedDeployment = {
      ...deployment,
      rpcUrl: "https://deterministic-pool-read.example",
    };
    mocks.multicall.mockRejectedValueOnce(
      new Error("pool result could not be decoded"),
    );
    mocks.getLogs.mockResolvedValue([]);

    await expect(
      readAlchemyCreatorProfile({
        account,
        deployment: isolatedDeployment,
        model: classicLiveModel(),
      }),
    ).rejects.toBeInstanceOf(AlchemyCreatorProfileIntegrityError);

    mocks.multicall.mockResolvedValueOnce([
      {
        status: "success",
        result: [account, deployment.launcher, 100, true, 9n],
      },
    ]);
    const recovered = await readAlchemyCreatorProfile({
      account,
      deployment: isolatedDeployment,
      model: classicLiveModel(),
    });

    expect(recovered.snapshot?.blockNumber).toBe("105");
    expect(recovered.totals.claimableWei).toBe("9");
    expect(mocks.multicall).toHaveBeenCalledTimes(2);
  });

  it("rejects a partial multicall result instead of keeping an unverified reward", async () => {
    mocks.multicall.mockResolvedValue([
      {
        status: "failure",
        error: new Error("pool result missing"),
      },
    ]);
    mocks.getLogs.mockResolvedValue([]);

    await expect(
      readAlchemyCreatorProfile({
        account,
        deployment: {
          ...deployment,
          rpcUrl: "https://partial-pool-read.example",
        },
        model: classicLiveModel(),
      }),
    ).rejects.toMatchObject({
      name: "AlchemyCreatorProfileIntegrityError",
      message: "Creator reward pool state could not be verified",
    });
  });

  it("does not cache or advance freshness when the confirmed claim scan fails", async () => {
    const isolatedDeployment = {
      ...deployment,
      rpcUrl: "https://deterministic-claim-log.example",
    };
    mocks.multicall.mockResolvedValue([
      {
        status: "success",
        result: [account, deployment.launcher, 100, true, 5n],
      },
    ]);
    mocks.getLogs
      .mockRejectedValueOnce(new Error("claim log response is malformed"))
      .mockResolvedValueOnce([]);

    await expect(
      readAlchemyCreatorProfile({
        account,
        deployment: isolatedDeployment,
        model: classicLiveModel(),
      }),
    ).rejects.toBeInstanceOf(AlchemyCreatorProfileIntegrityError);

    const recovered = await readAlchemyCreatorProfile({
      account,
      deployment: isolatedDeployment,
      model: classicLiveModel(),
    });

    expect(recovered.snapshot?.blockNumber).toBe("105");
    expect(recovered.totals.claimableWei).toBe("5");
    expect(mocks.getLogs).toHaveBeenCalledTimes(2);
  });

  it("rejects a reward pool whose live ownership no longer matches", async () => {
    mocks.multicall.mockResolvedValue([
      {
        status: "success",
        result: [
          "0x9999999999999999999999999999999999999999",
          deployment.launcher,
          100,
          true,
          5n,
        ],
      },
    ]);
    mocks.getLogs.mockResolvedValue([]);

    await expect(
      readAlchemyCreatorProfile({
        account,
        deployment: {
          ...deployment,
          rpcUrl: "https://pool-ownership-mismatch.example",
        },
        model: classicLiveModel(),
      }),
    ).rejects.toMatchObject({
      name: "AlchemyCreatorProfileIntegrityError",
      message: "Creator reward pool ownership does not match",
    });
  });

  it("rescans confirmed claims when a verified pool is added on a shared hook", async () => {
    const isolatedDeployment = {
      ...deployment,
      rpcUrl: "https://expanded-pool-set.example",
    };
    mocks.multicall
      .mockResolvedValueOnce([
        {
          status: "success",
          result: [account, deployment.launcher, 100, true, 5n],
        },
      ])
      .mockResolvedValueOnce([
        {
          status: "success",
          result: [account, deployment.launcher, 100, true, 5n],
        },
        {
          status: "success",
          result: [account, deployment.launcher, 100, true, 7n],
        },
      ]);
    mocks.getLogs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          removed: false,
          blockNumber: 102n,
          transactionHash: `0x${"89".repeat(32)}`,
          transactionIndex: 1,
          logIndex: 3,
          args: {
            poolId: secondPoolId,
            creator: account,
            recipient: account,
            caller: account,
            amount: 10n,
          },
        },
      ]);
    mocks.getBlock.mockResolvedValue({ timestamp: 1_775_000_000n });

    await readAlchemyCreatorProfile({
      account,
      deployment: isolatedDeployment,
      model: classicLiveModel(),
    });
    const expanded = await readAlchemyCreatorProfile({
      account,
      deployment: isolatedDeployment,
      model: {
        ...classicLiveModel(),
        tokens: [token, secondToken],
      },
    });

    expect(mocks.getLogs).toHaveBeenCalledTimes(2);
    expect(mocks.getLogs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: {
          poolId: [poolId, secondPoolId],
          creator: account,
        },
      }),
    );
    expect(expanded.claims).toEqual([
      expect.objectContaining({ poolId: secondPoolId, amountWei: "10" }),
    ]);
    expect(expanded.totals).toMatchObject({
      claimableWei: "12",
      claimedWei: "10",
      generatedWei: "22",
    });
  });

  it("ignores removed claims before attempting timestamp reads", async () => {
    mocks.multicall.mockResolvedValue([
      {
        status: "success",
        result: [account, deployment.launcher, 100, true, 5n],
      },
    ]);
    mocks.getLogs.mockResolvedValue([
      {
        removed: true,
        blockNumber: 102n,
        transactionHash: `0x${"88".repeat(32)}`,
        transactionIndex: 1,
        logIndex: 2,
        args: {
          poolId,
          creator: account,
          recipient: account,
          caller: account,
          amount: 10n,
        },
      },
    ]);

    const profile = await readAlchemyCreatorProfile({
      account,
      deployment: {
        ...deployment,
        rpcUrl: "https://removed-claim.example",
      },
      model: classicLiveModel(),
    });

    expect(profile.claims).toEqual([]);
    expect(profile.totals).toMatchObject({
      claimableWei: "5",
      claimedWei: "0",
      generatedWei: "5",
    });
    expect(mocks.getBlock).not.toHaveBeenCalled();
  });

  it("keeps a stamped CustomGraph launch visible without querying its hook or inventing rewards", async () => {
    mocks.getLogs.mockResolvedValue([]);
    const model = {
      status: "ready",
      tokens: [customGraphToken],
      snapshot: {
        chainId: 1,
        blockNumber: "100",
        blockHash: `0x${"99".repeat(32)}`,
        confirmations: 12,
      },
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    } satisfies ExploreReadModel;

    const profile = await readAlchemyCreatorProfile({
      account,
      deployment,
      model,
    });

    expect(profile.tokens.map((entry) => entry.symbol)).toEqual(["GRAPH"]);
    expect(profile.pools).toEqual([]);
    expect(profile.claims).toEqual([]);
    expect(profile.totals).toEqual({
      claimableWei: "0",
      claimableEth: "0",
      generatedWei: "0",
      generatedEth: "0",
      claimedWei: "0",
      claimedEth: "0",
    });
    expect(mocks.multicall).not.toHaveBeenCalled();
    expect(mocks.getLogs).not.toHaveBeenCalled();
  });
});
