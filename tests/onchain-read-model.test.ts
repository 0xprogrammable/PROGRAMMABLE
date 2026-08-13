import { TimeoutError, type PublicClient } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  indexVerifiedEvents,
  readExploreModel,
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
  it("reads the five disjoint event filters concurrently within each range", async () => {
    const resolvers: Array<(logs: readonly []) => void> = [];
    const getLogs = vi.fn(
      (input: { fromBlock: bigint; toBlock: bigint }) => {
        void input;
        return new Promise<readonly []>((resolve) =>
          resolvers.push(resolve)
        );
      },
    );
    const pending = indexVerifiedEvents(
      { getLogs } as unknown as PublicClient,
      readyDeployment,
      1_000n,
    );

    await vi.waitFor(() => expect(getLogs).toHaveBeenCalledTimes(5));
    expect(
      getLogs.mock.calls.map(([input]) => [input.fromBlock, input.toBlock]),
    ).toEqual(Array.from({ length: 5 }, () => [1n, 1_000n]));
    for (const resolve of resolvers) resolve([]);

    await expect(pending).resolves.toMatchObject({
      launches: [],
      liquidities: [],
      initialBuys: [],
      creatorClaims: [],
    });
  });

  it("bisects and retries the complete range after a transport timeout", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let firstRequest = true;
    const getLogs = vi.fn(async (
      input: { fromBlock: bigint; toBlock: bigint },
    ) => {
      void input;
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
      indexVerifiedEvents(
        { getLogs } as unknown as PublicClient,
        readyDeployment,
        1_000n,
      ),
    ).resolves.toMatchObject({ launches: [], creatorClaims: [] });

    expect(getLogs).toHaveBeenCalledTimes(15);
    expect(
      getLogs.mock.calls.map(([input]) => [input.fromBlock, input.toBlock]),
    ).toEqual([
      ...Array.from({ length: 5 }, () => [1n, 1_000n]),
      ...Array.from({ length: 5 }, () => [1n, 500n]),
      ...Array.from({ length: 5 }, () => [501n, 1_000n]),
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
});
