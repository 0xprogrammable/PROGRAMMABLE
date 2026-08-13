import {
  LimitExceededRpcError,
  TimeoutError,
  type PublicClient,
} from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mergeClassicV3ExploreModel,
  readClassicV3Events,
  readClassicV3EventsQuorum,
  type ClassicV3Release,
} from "../lib/onchain/classic-v3-read-model";
import { PersistentRpcCacheError } from
  "../lib/onchain/persistent-rpc-cache.server";
import type {
  ExploreReadModel,
  ReadyOnchainDeployment,
} from "../lib/onchain/types";
import type { LauncherToken } from "../lib/tokens";

const token: LauncherToken = {
  id: "1:0x0000000000000000000000000000000000000001",
  name: "Classic V3",
  symbol: "CV3",
  tokenAddress: "0x0000000000000000000000000000000000000001",
  hookAddress: "0x0000000000000000000000000000000000000002",
  poolId: `0x${"11".repeat(32)}`,
  launchTransactionHash: `0x${"22".repeat(32)}`,
  launchedAt: "2026-07-30T00:00:00.000Z",
  totalSwapFeeBps: 100,
  launchModel: "classic",
  launchModelVersion: "classic-v3",
  liquidityPath: "meme",
};

const model: ExploreReadModel = {
  status: "ready",
  tokens: [],
  snapshot: {
    chainId: 1,
    blockNumber: "1",
    blockHash: `0x${"33".repeat(32)}`,
    confirmations: 12,
  },
  creatorClaims: [],
  launcherFeesAccruedWei: "5",
  launcherFeesAccruedEth: "0.000000000000000005",
};

const readyDeployment: ReadyOnchainDeployment = {
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
  rpcUrl: "https://primary.example.invalid",
  rpcUrlSecondary: "https://secondary.example.invalid",
  confirmations: 12n,
  logBlockRange: 1_000n,
};

const release: ClassicV3Release = {
  launcher: "0x4444444444444444444444444444444444444444",
  hook: "0x5555555555555555555555555555555555555555",
  rewardVaultFactory:
    "0x6666666666666666666666666666666666666666",
  launcherRuntimeCodeHash: `0x${"44".repeat(32)}`,
  hookRuntimeCodeHash: `0x${"55".repeat(32)}`,
  rewardVaultFactoryRuntimeCodeHash: `0x${"66".repeat(32)}`,
  startBlock: 1n,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Classic V3 event scan", () => {
  it("requires exactly two independent providers for a checkpoint", async () => {
    await expect(
      readClassicV3EventsQuorum(
        [{ getLogs: vi.fn(), getBlock: vi.fn() } as unknown as PublicClient],
        readyDeployment,
        release,
        1_000n,
        1n,
      ),
    ).rejects.toThrow("exactly two independent RPCs");
  });

  it("settles the two scalar canonical contract filters concurrently", async () => {
    const resolvers: Array<(logs: readonly []) => void> = [];
    const getLogs = vi.fn(
      (input: { address: string; strict: boolean }) => {
        void input;
        return new Promise<readonly []>((resolve) => resolvers.push(resolve));
      },
    );
    const pending = readClassicV3Events(
      { getLogs } as unknown as PublicClient,
      readyDeployment,
      release,
      1_000n,
      1n,
    );

    await vi.waitFor(() => expect(getLogs).toHaveBeenCalledTimes(2));
    expect(getLogs.mock.calls.map(([input]) => input.address)).toEqual([
      release.launcher,
      release.hook,
    ]);
    expect(getLogs.mock.calls.every(([input]) => input.strict)).toBe(true);
    for (const resolve of resolvers) resolve([]);
    await expect(pending).resolves.toEqual({
      eventProvenance: [],
      launches: [],
      volumes: new Map(),
    });
  });

  it("bisects the same complete range on an RPC result limit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let firstRequest = true;
    const getLogs = vi.fn(async () => {
      if (firstRequest) {
        firstRequest = false;
        throw new LimitExceededRpcError(new Error("too many results"));
      }
      return [];
    });

    await expect(
      readClassicV3Events(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        release,
        1_000n,
        1n,
      ),
    ).resolves.toEqual({ eventProvenance: [], launches: [], volumes: new Map() });
    expect(getLogs).toHaveBeenCalledTimes(6);
  });

  it("bisects a complete range when its durable segment exceeds the byte cap", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let firstRequest = true;
    const getLogs = vi.fn(async () => {
      if (firstRequest) {
        firstRequest = false;
        throw new PersistentRpcCacheError(
          "Persistent RPC cache log segment exceeds 4194304 bytes",
        );
      }
      return [];
    });

    await expect(
      readClassicV3Events(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        release,
        1_000n,
        1n,
      ),
    ).resolves.toEqual({ eventProvenance: [], launches: [], volumes: new Map() });
    expect(getLogs).toHaveBeenCalledTimes(6);
  });

  it("retries the same complete Classic V3 window after a transient", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let firstRequest = true;
    const getLogs = vi.fn(async () => {
      if (firstRequest) {
        firstRequest = false;
        throw new TimeoutError({
          body: { method: "eth_getLogs" },
          url: readyDeployment.rpcUrl,
        });
      }
      return [];
    });
    await expect(
      readClassicV3Events(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        release,
        1_000n,
        1n,
      ),
    ).resolves.toEqual({ eventProvenance: [], launches: [], volumes: new Map() });
    expect(getLogs).toHaveBeenCalledTimes(4);
  });

  it("fails closed on a decoded event from the wrong contract", async () => {
    const getLogs = vi.fn(async (input: { address: string }) =>
      input.address === release.launcher
        ? [
            {
              eventName: "MemeTokenLaunchedV2",
              address: release.hook,
              removed: true,
              blockNumber: null,
            },
          ]
        : [],
    );
    await expect(
      readClassicV3Events(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        release,
        1_000n,
        1n,
      ),
    ).rejects.toThrow(/non-canonical Classic V3 contract/);
  });

  it("requires both providers to agree on every raw fee-log provenance record", async () => {
    const feeLog = (transactionHash: string) => ({
      eventName: "NativeSwapFeesAccrued",
      address: release.hook,
      removed: false,
      blockNumber: 1n,
      blockHash: `0x${"77".repeat(32)}`,
      transactionHash,
      transactionIndex: 0,
      logIndex: 0,
      args: {
        poolId: `0x${"88".repeat(32)}`,
        grossNativeAmount: 100n,
        creatorFee: 10n,
        launcherFee: 1n,
      },
    });
    const client = (transactionHash: string) => ({
      async getLogs(input: { address: string }) {
        return input.address === release.hook ? [feeLog(transactionHash)] : [];
      },
      async getBlock() {
        return { number: 1_000n, hash: `0x${"99".repeat(32)}` };
      },
    }) as unknown as PublicClient;
    await expect(
      readClassicV3EventsQuorum(
        [
          client(`0x${"aa".repeat(32)}`),
          client(`0x${"bb".repeat(32)}`),
        ],
        readyDeployment,
        release,
        1_000n,
        1n,
      ),
    ).rejects.toThrow(/disagree on the Classic V3 checkpoint window/);
  });

  it("requires both providers to agree on the checkpoint boundary hash", async () => {
    const client = (hash: string) => ({
      async getLogs() {
        return [];
      },
      async getBlock() {
        return { number: 1_000n, hash };
      },
    }) as unknown as PublicClient;
    await expect(
      readClassicV3EventsQuorum(
        [
          client(`0x${"aa".repeat(32)}`),
          client(`0x${"bb".repeat(32)}`),
        ],
        readyDeployment,
        release,
        1_000n,
        1n,
      ),
    ).rejects.toThrow(/disagree on the Classic V3 checkpoint window/);
  });

  it("publishes at most 1,000 blocks in one provider-group checkpoint", async () => {
    const boundaryReads: bigint[] = [];
    const client = {
      async getLogs() {
        return [];
      },
      async getBlock(input: { blockNumber: bigint }) {
        boundaryReads.push(input.blockNumber);
        return {
          number: input.blockNumber,
          hash: `0x${input.blockNumber.toString(16).padStart(64, "0")}`,
        };
      },
    } as unknown as PublicClient;

    await expect(
      readClassicV3EventsQuorum(
        [client, client],
        { ...readyDeployment, logBlockRange: 5_000n },
        release,
        2_000n,
        1n,
      ),
    ).resolves.toEqual({ eventProvenance: [], launches: [], volumes: new Map() });
    expect(boundaryReads).toEqual([1_000n, 1_000n, 2_000n, 2_000n]);
  });
});

describe("Classic V3 Explore merge", () => {
  it("adds the release once and remains idempotent", () => {
    const merged = mergeClassicV3ExploreModel(model, {
      tokens: [token],
      launcherFeesAccrued: 7n,
    });
    expect(merged.tokens).toEqual([token]);
    expect(merged.launcherFeesAccruedWei).toBe("12");

    const repeated = mergeClassicV3ExploreModel(merged, {
      tokens: [token],
      launcherFeesAccrued: 7n,
    });
    expect(repeated.launcherFeesAccruedWei).toBe("12");
  });

  it("rejects a conflicting launch identity", () => {
    expect(() =>
      mergeClassicV3ExploreModel(
        { ...model, tokens: [token] },
        {
          tokens: [
            {
              ...token,
              launchTransactionHash: `0x${"44".repeat(32)}`,
            },
          ],
          launcherFeesAccrued: 0n,
        },
      ),
    ).toThrow("Duplicate token across launch releases");
  });
});
