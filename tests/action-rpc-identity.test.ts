import {
  getAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { describe, expect, it, vi } from "vitest";

import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import {
  readCreatorClaimIdentityFromRpc,
  readTradeActionModelFromRpc,
} from "../lib/server/action-rpc-identity.server";
import { getConfiguredClassicV4PublicRelease } from
  "../lib/classic-v4-release";
import { getConfiguredStockPairedReleases } from
  "../lib/stock-paired-release";
import { computeOfficialV4PoolId } from
  "../lib/uniswap/liquidity-launcher-sdk";

vi.mock("server-only", () => ({}));

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const creator = getAddress("0x1111111111111111111111111111111111111111");
const token = getAddress("0x2222222222222222222222222222222222222222");
const hook = getAddress("0x3333333333333333333333333333333333333333");
const launcher = getAddress("0x4444444444444444444444444444444444444444");
const historicalHook = getAddress(
  "0x7777777777777777777777777777777777777777",
);
const historicalLauncher = getAddress(
  "0x8888888888888888888888888888888888888888",
);
const blockHash = `0x${"55".repeat(32)}` as Hex;
const launchHash = `0x${"66".repeat(32)}` as Hex;
const poolId = computeOfficialV4PoolId({
  currency0: ZERO,
  currency1: token,
  fee: 0,
  tickSpacing: 200,
  hooks: hook,
});

const deployment: ReadyOnchainDeployment = {
  environment: "production",
  releaseVersion: "classic-v2",
  chainId: 1,
  status: "ready",
  launcher,
  feeHook: hook,
  launcherRuntimeCodeHash: `0x${"77".repeat(32)}`,
  feeHookRuntimeCodeHash: `0x${"88".repeat(32)}`,
  deploymentBlock: 10n,
  stateView: getAddress("0x5555555555555555555555555555555555555555"),
  stateViewRuntimeCodeHash: `0x${"99".repeat(32)}`,
  rpcUrl: "https://lb.drpc.live/ethereum/test-identity-key",
  rpcUrlSecondary: null,
  confirmations: 0n,
  logBlockRange: 10_000n,
};

describe("single-RPC action identity", () => {
  it("fails closed after current launcher-state reads when a trade token is unknown", async () => {
    const readContract = vi.fn().mockResolvedValue(`0x${"00".repeat(32)}`);
    const client = { readContract } as unknown as PublicClient;
    const classicV4Release =
      getConfiguredClassicV4PublicRelease("production");

    if (!classicV4Release) {
      throw new Error("The public Classic V4 release is not configured");
    }

    await expect(
      readTradeActionModelFromRpc({
        client,
        chainId: 1,
        token,
        blockNumber: 100n,
        blockHash,
      }),
    ).rejects.toMatchObject({
      code: "unknown-token",
    });

    expect(readContract).toHaveBeenCalledTimes(
      3 + getConfiguredStockPairedReleases().length,
    );
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: classicV4Release.addresses.launcher,
        functionName: "launchHashOf",
        args: [token],
        blockNumber: 100n,
      }),
    );
    expect(
      readContract.mock.calls.every(
        ([call]) =>
          call.functionName === "launchHashOf" &&
          call.blockNumber === 100n,
      ),
    ).toBe(true);
  });

  it("derives the fee creator from the launch event instead of token deployment authority", async () => {
    const launchLog = {
        address: launcher,
        args: {
          creator,
          token,
          poolId,
          feeHook: hook,
          positionRecipient: creator,
          positionTokenId: 1n,
          totalSwapFeeBps: 100,
          launchHash,
        },
        blockNumber: 50n,
        transactionHash: `0x${"aa".repeat(32)}`,
        transactionIndex: 0,
        logIndex: 0,
        removed: false,
      };
    const getLogs = vi.fn(
      ({ fromBlock, toBlock }: {
        address: Address;
        args: { poolId: Hex };
        fromBlock: bigint;
        toBlock: bigint;
        strict: boolean;
      }) =>
        Promise.resolve(
          fromBlock <= launchLog.blockNumber &&
              launchLog.blockNumber <= toBlock
            ? [launchLog]
            : [],
        ),
    );
    const readContract = vi.fn(
      ({ functionName }: { functionName: string; blockNumber?: bigint }) => {
        if (functionName === "launchHashOf") return Promise.resolve(launchHash);
        if (functionName === "poolKey") {
          return Promise.resolve([ZERO, token, 0, 200, hook]);
        }
        if (functionName === "creator") return Promise.resolve(launcher);
        throw new Error(`Unexpected function ${functionName}`);
      },
    );
    const client = { getLogs, readContract } as unknown as PublicClient;

    await expect(
      readCreatorClaimIdentityFromRpc({
        client,
        releases: [deployment],
        poolId,
        blockNumber: 20_100n,
      }),
    ).resolves.toEqual({
      releaseVersion: "classic-v2",
      tokenAddress: token,
      hookAddress: hook,
      launcherAddress: launcher,
      launcherRuntimeCodeHash: deployment.launcherRuntimeCodeHash,
      hookRuntimeCodeHash: deployment.feeHookRuntimeCodeHash,
      poolId,
      creatorAddress: creator,
      totalSwapFeeBps: 100,
    });
    expect(getLogs).toHaveBeenCalledTimes(3);
    expect(getLogs.mock.calls.map(([call]) => [
      call.fromBlock,
      call.toBlock,
    ])).toEqual([
      [10n, 10_009n],
      [10_010n, 20_009n],
      [20_010n, 20_100n],
    ]);
    expect(getLogs.mock.calls.every(([call]) =>
      call.address === launcher &&
      call.args.poolId === poolId &&
      call.strict === true &&
      call.toBlock - call.fromBlock < 10_000n
    )).toBe(true);
    expect(
      readContract.mock.calls.every(
        ([call]) => call.blockNumber === 20_100n,
      ),
    ).toBe(true);
    expect(readContract).toHaveBeenCalledTimes(3);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: token,
        functionName: "creator",
        blockNumber: 20_100n,
      }),
    );
  });

  it("resolves a creator claim against the exact historical release that launched the pool", async () => {
    const historicalPoolId = computeOfficialV4PoolId({
      currency0: ZERO,
      currency1: token,
      fee: 0,
      tickSpacing: 200,
      hooks: historicalHook,
    });
    const historicalDeployment: ReadyOnchainDeployment = {
      ...deployment,
      releaseVersion: "classic-v1",
      launcher: historicalLauncher,
      feeHook: historicalHook,
      launcherRuntimeCodeHash: `0x${"99".repeat(32)}`,
      feeHookRuntimeCodeHash: `0x${"aa".repeat(32)}`,
      deploymentBlock: 5n,
    };
    const launchLog = {
      address: historicalLauncher,
      args: {
        creator,
        token,
        poolId: historicalPoolId,
        feeHook: historicalHook,
        positionRecipient: creator,
        positionTokenId: 1n,
        totalSwapFeeBps: 100,
        launchHash,
      },
      blockNumber: 50n,
      transactionHash: `0x${"bb".repeat(32)}`,
      transactionIndex: 0,
      logIndex: 0,
      removed: false,
    };
    const getLogs = vi.fn(
      ({ address, fromBlock, toBlock }: {
        address: Address;
        fromBlock: bigint;
        toBlock: bigint;
      }) => Promise.resolve(
        address === historicalLauncher &&
          fromBlock <= launchLog.blockNumber &&
          launchLog.blockNumber <= toBlock
          ? [launchLog]
          : [],
      ),
    );
    const readContract = vi.fn(
      ({ address, functionName }: { address: Address; functionName: string }) => {
        if (address !== historicalLauncher && address !== token) {
          throw new Error(`Unexpected release address ${address}`);
        }
        if (functionName === "launchHashOf") return Promise.resolve(launchHash);
        if (functionName === "poolKey") {
          return Promise.resolve([ZERO, token, 0, 200, historicalHook]);
        }
        if (functionName === "creator") {
          return Promise.resolve(historicalLauncher);
        }
        throw new Error(`Unexpected function ${functionName}`);
      },
    );
    const client = { getLogs, readContract } as unknown as PublicClient;

    await expect(
      readCreatorClaimIdentityFromRpc({
        client,
        releases: [historicalDeployment, deployment],
        poolId: historicalPoolId,
        blockNumber: 100n,
      }),
    ).resolves.toEqual({
      releaseVersion: "classic-v1",
      tokenAddress: token,
      hookAddress: historicalHook,
      launcherAddress: historicalLauncher,
      launcherRuntimeCodeHash:
        historicalDeployment.launcherRuntimeCodeHash,
      hookRuntimeCodeHash: historicalDeployment.feeHookRuntimeCodeHash,
      poolId: historicalPoolId,
      creatorAddress: creator,
      totalSwapFeeBps: 100,
    });
    expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({
      address: historicalLauncher,
      args: { poolId: historicalPoolId },
    }));
    expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({
      address: launcher,
      args: { poolId: historicalPoolId },
    }));
  });
});
