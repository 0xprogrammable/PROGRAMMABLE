import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getBlock: vi.fn(),
  getLogs: vi.fn(),
  multicall: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      getBlock: mocks.getBlock,
      getLogs: mocks.getLogs,
      multicall: mocks.multicall,
    })),
  };
});

import { readAlchemyCreatorProfile } from "../lib/alchemy/profile.server";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "../lib/onchain/types";

const account = "0x1111111111111111111111111111111111111111" as const;
const poolId = `0x${"22".repeat(32)}` as const;
const tokenAddress = "0x3333333333333333333333333333333333333333" as const;
const hookAddress = "0x4444444444444444444444444444444444444444" as const;

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
  launchTransactionHash: `0x${"77".repeat(32)}` as const,
  launchLogIndex: 0,
  launchBlockNumber: "90",
  launchedAt: "2026-08-04T00:00:00.000Z",
  launchModel: "classic" as const,
  totalSwapFeeBps: 100,
  liquidityPath: "meme" as const,
};

describe("Alchemy live creator profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
