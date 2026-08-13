import {
  LimitExceededRpcError,
  TimeoutError,
  type Hex,
  type PublicClient,
} from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  indexedEventsFingerprint,
  indexVerifiedEvents,
  readExploreModel,
  type IndexedEvents,
} from "../lib/onchain/read-model";
import type {
  OnchainDeployment,
  ReadyOnchainDeployment,
} from "../lib/onchain/types";

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

const POOL_ID: Hex = `0x${"44".repeat(32)}`;
const LAUNCH_HASH: Hex = `0x${"55".repeat(32)}`;
const BLOCK_HASH: Hex = `0x${"66".repeat(32)}`;
const TRANSACTION_HASH: Hex = `0x${"77".repeat(32)}`;

function rpcLog(
  eventName: string,
  address: string,
  args: Record<string, unknown>,
  logIndex: number,
) {
  return {
    address,
    blockHash: BLOCK_HASH,
    blockNumber: 100n,
    data: "0x",
    eventName,
    args,
    logIndex,
    removed: false,
    topics: [],
    transactionHash: TRANSACTION_HASH,
    transactionIndex: 2,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Explore read model deployment boundary", () => {
  it("returns an honest empty result without touching RPC when undeployed", async () => {
    const config: OnchainDeployment = {
      environment: "production",
      releaseVersion: "classic-v1",
      chainId: 1,
      status: "not-deployed",
      launcher: null,
      feeHook: null,
      launcherRuntimeCodeHash: null,
      feeHookRuntimeCodeHash: null,
      deploymentBlock: null,
      stateView: "0x1111111111111111111111111111111111111111",
      stateViewRuntimeCodeHash: `0x${"11".repeat(32)}`,
      rpcUrl: "https://this-must-not-be-called.invalid",
      rpcUrlSecondary: null,
      confirmations: 12n,
      logBlockRange: 10_000n,
    };

    await expect(readExploreModel(config)).resolves.toEqual({
      status: "not-deployed",
      tokens: [],
      snapshot: null,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    });
  });
});

describe("Explore verified event indexing", () => {
  it("uses two concurrent strict topic-OR queries on scalar canonical addresses per range", async () => {
    const getLogs = vi.fn(
      async (input: {
        address: string;
        events: ReadonlyArray<{ name: string }>;
        fromBlock: bigint;
        toBlock: bigint;
        strict: boolean;
      }) => {
        void input;
        return [];
      },
    );

    await expect(
      indexVerifiedEvents(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        1_000n,
      ),
    ).resolves.toMatchObject({ launches: [], creatorClaims: [] });

    expect(getLogs).toHaveBeenCalledTimes(2);
    const [[launcherInput], [feeHookInput]] = getLogs.mock.calls;
    expect(launcherInput).toMatchObject({
      address: readyDeployment.launcher,
      fromBlock: 1n,
      toBlock: 1_000n,
      strict: true,
    });
    expect(launcherInput.events.map((event) => event.name)).toEqual([
      "MemeTokenLaunched",
      "MemeLiquidityConfigured",
      "MemeCreatorInitialBuy",
    ]);
    expect(feeHookInput).toMatchObject({
      address: readyDeployment.feeHook,
      fromBlock: 1n,
      toBlock: 1_000n,
      strict: true,
    });
    expect(feeHookInput.events.map((event) => event.name)).toEqual([
      "NativeSwapFeesAccrued",
      "CreatorFeesClaimed",
    ]);
  });

  it("dispatches all five allowed events without changing their record semantics", async () => {
    const logs = [
      rpcLog(
        "NativeSwapFeesAccrued",
        readyDeployment.feeHook,
        {
          poolId: POOL_ID,
          swapSender: "0x8888888888888888888888888888888888888888",
          grossNativeAmount: 100n,
          creatorFee: 3n,
          launcherFee: 2n,
        },
        3,
      ),
      rpcLog(
        "MemeTokenLaunched",
        readyDeployment.launcher,
        {
          creator: "0x9999999999999999999999999999999999999999",
          token: "0x3333333333333333333333333333333333333333",
          poolId: POOL_ID,
          feeHook: readyDeployment.feeHook,
          positionRecipient:
            "0x4444444444444444444444444444444444444444",
          positionTokenId: 12n,
          totalSwapFeeBps: 100,
          launchHash: LAUNCH_HASH,
        },
        0,
      ),
      rpcLog(
        "CreatorFeesClaimed",
        readyDeployment.feeHook,
        {
          poolId: POOL_ID,
          creator: "0x9999999999999999999999999999999999999999",
          recipient: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          caller: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          amount: 3n,
        },
        4,
      ),
      rpcLog(
        "MemeLiquidityConfigured",
        readyDeployment.launcher,
        {
          token: "0x3333333333333333333333333333333333333333",
          totalSupply: 1_000n,
          tokenLiquidityAmount: 900n,
          lockedTokenDust: 100n,
          initialTick: 1,
          tickLower: -2,
          tickUpper: 3,
          lpFeePips: 10_000,
          launchHash: LAUNCH_HASH,
        },
        1,
      ),
      rpcLog(
        "MemeCreatorInitialBuy",
        readyDeployment.launcher,
        {
          creator: "0x9999999999999999999999999999999999999999",
          token: "0x3333333333333333333333333333333333333333",
          poolId: POOL_ID,
          nativeAmount: 20n,
          tokenAmount: 40n,
          launchHash: LAUNCH_HASH,
        },
        2,
      ),
    ];
    const getLogs = vi.fn(async (input: { address: string }) =>
      logs.filter(
        (log) =>
          log.address.toLowerCase() === input.address.toLowerCase(),
      ),
    );

    const result = await indexVerifiedEvents(
      { getLogs } as unknown as PublicClient,
      readyDeployment,
      1_000n,
    );

    expect(result.launches).toHaveLength(1);
    expect(result.liquidities).toHaveLength(1);
    expect(result.initialBuys).toHaveLength(1);
    expect(result.creatorClaims).toHaveLength(1);
    expect(result.volumes.get(POOL_ID)).toEqual({
      grossNativeAmount: 100n,
      creatorFees: 3n,
      launcherFees: 2n,
      swapCount: 1,
    });
    expect(result.launches[0]).toMatchObject({
      poolId: POOL_ID,
      logIndex: 0,
      positionTokenId: 12n,
    });
    expect(result.liquidities[0]).toMatchObject({
      logIndex: 1,
      tokenLiquidityAmount: 900n,
    });
    expect(result.initialBuys[0]).toMatchObject({
      logIndex: 2,
      nativeAmount: 20n,
    });
    expect(result.creatorClaims[0]).toMatchObject({
      logIndex: 4,
      amount: 3n,
    });
  });

  it("fails closed on decoded events outside the canonical five-topic filter", async () => {
    const getLogs = vi.fn(async (input: { address: string }) =>
      input.address === readyDeployment.launcher
        ? [
            rpcLog(
              "UnexpectedEvent",
              readyDeployment.launcher,
              {},
              0,
            ),
          ]
        : [],
    );

    await expect(
      indexVerifiedEvents(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        1_000n,
      ),
    ).rejects.toThrow(
      "RPC returned event outside the canonical Classic filter",
    );
  });

  it("fails closed when an allowed event is returned by the wrong contract", async () => {
    const getLogs = vi.fn(async (input: { address: string }) =>
      input.address === readyDeployment.launcher
        ? [
            rpcLog(
              "MemeTokenLaunched",
              readyDeployment.feeHook,
              {},
              0,
            ),
          ]
        : [],
    );

    await expect(
      indexVerifiedEvents(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        1_000n,
      ),
    ).rejects.toThrow(
      "RPC returned MemeTokenLaunched from a non-canonical contract",
    );
  });

  it("bisects and retries the same complete range after a transport timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let firstRequest = true;
    const getLogs = vi.fn(
      async (input: {
        address: string;
        fromBlock: bigint;
        toBlock: bigint;
      }) => {
        void input;
        if (firstRequest) {
          firstRequest = false;
          throw new TimeoutError({
            body: { method: "eth_getLogs" },
            url: readyDeployment.rpcUrl,
          });
        }
        return [];
      },
    );

    await expect(
      indexVerifiedEvents(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        1_000n,
      ),
    ).resolves.toMatchObject({ launches: [], creatorClaims: [] });

    expect(getLogs).toHaveBeenCalledTimes(6);
    expect(
      getLogs.mock.calls.map(([input]) => [
        input.address,
        input.fromBlock,
        input.toBlock,
      ]),
    ).toEqual([
      [readyDeployment.launcher, 1n, 1_000n],
      [readyDeployment.feeHook, 1n, 1_000n],
      [readyDeployment.launcher, 1n, 500n],
      [readyDeployment.feeHook, 1n, 500n],
      [readyDeployment.launcher, 501n, 1_000n],
      [readyDeployment.feeHook, 501n, 1_000n],
    ]);
    expect(console.warn).toHaveBeenCalledWith(
      "Explore log range reduced after RPC rejection",
      expect.objectContaining({
        fromBlock: "1",
        attemptedToBlock: "1000",
        nextRange: "500",
        errorName: "TimeoutError",
      }),
    );
  });

  it("bisects and retries the complete range after an RPC result limit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let firstRequest = true;
    const getLogs = vi.fn(async () => {
      if (firstRequest) {
        firstRequest = false;
        throw new LimitExceededRpcError(
          new Error("query returned more than 10000 results"),
        );
      }
      return [];
    });

    await expect(
      indexVerifiedEvents(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        1_000n,
      ),
    ).resolves.toMatchObject({ launches: [], creatorClaims: [] });

    expect(getLogs).toHaveBeenCalledTimes(6);
    expect(console.warn).toHaveBeenCalledWith(
      "Explore log range reduced after RPC rejection",
      expect.objectContaining({
        fromBlock: "1",
        attemptedToBlock: "1000",
        nextRange: "500",
        errorName: "LimitExceededRpcError",
      }),
    );
  });

  it("fails closed when a result limit persists at the minimum range", async () => {
    const getLogs = vi.fn(async () => {
      throw new LimitExceededRpcError(
        new Error("query returned more than 10000 results"),
      );
    });

    await expect(
      indexVerifiedEvents(
        { getLogs } as unknown as PublicClient,
        { ...readyDeployment, logBlockRange: 100n },
        100n,
      ),
    ).rejects.toBeInstanceOf(LimitExceededRpcError);
    expect(getLogs).toHaveBeenCalledTimes(2);
  });

  it("keeps provider fingerprints sensitive to duplicates and per-event order", () => {
    const firstLaunch: IndexedEvents["launches"][number] = {
      creator: "0x9999999999999999999999999999999999999999",
      token: "0x3333333333333333333333333333333333333333",
      poolId: POOL_ID,
      feeHook: readyDeployment.feeHook,
      positionRecipient:
        "0x4444444444444444444444444444444444444444",
      positionTokenId: 12n,
      totalSwapFeeBps: 100,
      launchHash: LAUNCH_HASH,
      blockNumber: 100n,
      transactionHash: TRANSACTION_HASH,
      transactionIndex: 2,
      logIndex: 0,
    };
    const secondLaunch: IndexedEvents["launches"][number] = {
      ...firstLaunch,
      token: "0x8888888888888888888888888888888888888888",
      positionTokenId: 13n,
      logIndex: 5,
    };
    const base: IndexedEvents = {
      launches: [firstLaunch, secondLaunch],
      liquidities: [],
      initialBuys: [],
      volumes: new Map(),
      creatorClaims: [],
    };
    const fingerprint = indexedEventsFingerprint(base);

    expect(
      indexedEventsFingerprint({
        ...base,
        launches: [firstLaunch, secondLaunch, firstLaunch],
      }),
    ).not.toBe(fingerprint);
    expect(
      indexedEventsFingerprint({
        ...base,
        launches: [secondLaunch, firstLaunch],
      }),
    ).not.toBe(fingerprint);
  });
});
