import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  clearCanonicalTokenSupplyCachesForTests,
  hydrateMissingCanonicalTokenSupplyBoundedV1,
  hydrateMissingCanonicalTokenSupplyV1,
} from "../lib/market-data/canonical-token-supply.server";
import type { ReadyOnchainDeployment } from "../lib/onchain/types";
import type { ExploreEntry } from "../lib/tokens";

const PCAN_ADDRESS = "0x9deeb39d2590b0cad5fc473f755c5f97dcc8f7ce" as const;
const BLOCK_HASH = `0x${"11".repeat(32)}` as const;
const NEXT_BLOCK_HASH = `0x${"22".repeat(32)}` as const;
const SUPPLY = 1_000_000n * 10n ** 18n;

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
  rpcUrl: "https://primary.example/rpc",
  rpcUrlSecondary: "https://secondary.example/rpc",
  confirmations: 12n,
  logBlockRange: 5_000n,
} satisfies ReadyOnchainDeployment;

const entry = {
  exploreKind: "token",
  id: `1:${PCAN_ADDRESS}`,
  tokenAddress: PCAN_ADDRESS,
  launchCategoryProvenance: {
    source: "canonical-launch-read-model",
  },
} as unknown as ExploreEntry;

const customEntry = {
  exploreKind: "custom-project",
  id: `custom:sha256:${"44".repeat(32)}`,
  tokenAddress: PCAN_ADDRESS,
  tokenDecimals: 18,
  chainId: "1",
  launchCategoryProvenance: {
    source: "registry.custom-launched",
  },
} as unknown as ExploreEntry;

function missingEntry(index: number): ExploreEntry {
  const tokenAddress =
    `0x${index.toString(16).padStart(40, "0")}` as `0x${string}`;
  return {
    ...entry,
    id: `1:${tokenAddress}`,
    tokenAddress,
  } as ExploreEntry;
}

function supplyClient(input: Readonly<{
  blockHash?: `0x${string}`;
  decimals?: number;
  totalSupply?: bigint;
}> = {}) {
  return {
    getBlockNumber: vi.fn(async () => 112n),
    getBlock: vi.fn(async (_input: Readonly<{ blockNumber: bigint }>) => ({
      hash: input.blockHash ?? BLOCK_HASH,
      number: 100n,
    })),
    readContract: vi.fn(async ({ functionName }: { functionName: string }) =>
      functionName === "decimals"
        ? input.decimals ?? 18
        : input.totalSupply ?? SUPPLY),
  };
}

describe("canonical token supply hydration", () => {
  beforeEach(() => clearCanonicalTokenSupplyCachesForTests());
  afterEach(() => {
    vi.useRealTimers();
    clearCanonicalTokenSupplyCachesForTests();
  });

  it("hydrates missing supply only when both fixed readers agree", async () => {
    const primary = supplyClient();
    const secondary = supplyClient();
    const createClient = vi.fn((rpcUrl: string) =>
      rpcUrl === deployment.rpcUrl ? primary : secondary);

    const [hydrated] = await hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      createClient,
    });

    expect(hydrated).toMatchObject({
      tokenAddress: PCAN_ADDRESS,
      tokenDecimals: 18,
      totalSupplyRaw: SUPPLY.toString(),
    });
    expect(createClient).toHaveBeenCalledTimes(4);
    expect(primary.readContract).toHaveBeenCalledTimes(2);
    expect(secondary.readContract).toHaveBeenCalledTimes(2);
  });

  it("hydrates a verified Ethereum Registry Custom entry with the same quorum proof", async () => {
    const primary = supplyClient();
    const secondary = supplyClient();

    const [hydrated] = await hydrateMissingCanonicalTokenSupplyV1(
      [customEntry],
      {
        deployment,
        createClient: (rpcUrl) =>
          rpcUrl === deployment.rpcUrl ? primary : secondary,
      },
    );

    expect(hydrated).toMatchObject({
      exploreKind: "custom-project",
      tokenAddress: PCAN_ADDRESS,
      tokenDecimals: 18,
      totalSupplyRaw: SUPPLY.toString(),
    });
    expect(primary.readContract).toHaveBeenCalledTimes(2);
    expect(secondary.readContract).toHaveBeenCalledTimes(2);
  });

  it("leaves Registry Custom supply unavailable when the readers disagree", async () => {
    const primary = supplyClient();
    const secondary = supplyClient({ totalSupply: SUPPLY - 1n });

    await expect(hydrateMissingCanonicalTokenSupplyV1([customEntry], {
      deployment,
      createClient: (rpcUrl) =>
        rpcUrl === deployment.rpcUrl ? primary : secondary,
    })).resolves.toEqual([customEntry]);
  });

  it("never hydrates Registry Custom supply from one available reader", async () => {
    const primary = supplyClient();
    const unavailable = supplyClient();
    unavailable.getBlockNumber.mockRejectedValue(new Error("unavailable"));

    await expect(hydrateMissingCanonicalTokenSupplyV1([customEntry], {
      deployment,
      createClient: (rpcUrl) =>
        rpcUrl === deployment.rpcUrl ? primary : unavailable,
    })).resolves.toEqual([customEntry]);
    expect(primary.readContract).not.toHaveBeenCalled();
  });

  it("does not hydrate an interface preview or non-Ethereum Custom entry", async () => {
    const createClient = vi.fn();
    const preview = {
      ...customEntry,
      launchCategoryProvenance: { source: "interface-preview" },
    } as ExploreEntry;
    const foreign = { ...customEntry, chainId: "4663" } as ExploreEntry;

    await expect(hydrateMissingCanonicalTokenSupplyV1([preview, foreign], {
      deployment,
      createClient,
    })).resolves.toEqual([preview, foreign]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("binds replay hydration to the requested valuation block and hash", async () => {
    const primary = supplyClient();
    const secondary = supplyClient();

    const [hydrated] = await hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      snapshot: {
        blockNumber: "100",
        blockHash: BLOCK_HASH,
      },
      createClient: (rpcUrl) =>
        rpcUrl === deployment.rpcUrl ? primary : secondary,
    });

    expect(hydrated).toMatchObject({
      tokenDecimals: 18,
      totalSupplyRaw: SUPPLY.toString(),
    });
    expect(primary.getBlockNumber).not.toHaveBeenCalled();
    expect(secondary.getBlockNumber).not.toHaveBeenCalled();
    expect(primary.getBlock).toHaveBeenCalledWith({ blockNumber: 100n });
    expect(secondary.getBlock).toHaveBeenCalledWith({ blockNumber: 100n });
  });

  it("fails closed when replay readers agree on a different block hash", async () => {
    const driftedHash = `0x${"22".repeat(32)}` as const;
    const primary = supplyClient({ blockHash: driftedHash });
    const secondary = supplyClient({ blockHash: driftedHash });

    await expect(hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      snapshot: {
        blockNumber: "100",
        blockHash: BLOCK_HASH,
      },
      createClient: (rpcUrl) =>
        rpcUrl === deployment.rpcUrl ? primary : secondary,
    })).resolves.toEqual([entry]);
  });

  it("leaves identity unchanged when the two readers disagree", async () => {
    const primary = supplyClient();
    const secondary = supplyClient({ totalSupply: SUPPLY - 1n });

    await expect(hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      createClient: (rpcUrl) =>
        rpcUrl === deployment.rpcUrl ? primary : secondary,
    })).resolves.toEqual([entry]);
  });

  it("rejects a quorum value above uint256", async () => {
    const oversized = (1n << 256n) + 1n;
    const primary = supplyClient({ totalSupply: oversized });
    const secondary = supplyClient({ totalSupply: oversized });

    await expect(hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      createClient: (rpcUrl) =>
        rpcUrl === deployment.rpcUrl ? primary : secondary,
    })).resolves.toEqual([entry]);
  });

  it("accepts two matching fixed readers when one candidate is unavailable", async () => {
    const unavailable = supplyClient();
    unavailable.getBlock.mockRejectedValue(new Error("unavailable"));
    const first = supplyClient();
    const second = supplyClient();
    const [hydrated] = await hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      additionalRpcUrls: ["https://third.example/rpc"],
      createClient: (rpcUrl) => rpcUrl === deployment.rpcUrl
        ? unavailable
        : rpcUrl === deployment.rpcUrlSecondary
          ? first
          : second,
    });

    expect(hydrated).toMatchObject({
      tokenDecimals: 18,
      totalSupplyRaw: SUPPLY.toString(),
    });
  });

  it("does not read supply without two available fixed readers", async () => {
    const unavailable = supplyClient();
    unavailable.getBlockNumber.mockRejectedValue(new Error("unavailable"));
    const createClient = vi.fn((rpcUrl: string) =>
      rpcUrl === deployment.rpcUrl ? supplyClient() : unavailable);

    await expect(hydrateMissingCanonicalTokenSupplyV1([entry], {
      deployment,
      createClient,
    })).resolves.toEqual([entry]);
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it("does not re-read an already canonical supply", async () => {
    const canonicalEntry = {
      ...entry,
      tokenDecimals: 18,
      totalSupplyRaw: SUPPLY.toString(),
    } as ExploreEntry;
    const createClient = vi.fn();

    await expect(hydrateMissingCanonicalTokenSupplyV1([canonicalEntry], {
      deployment,
      createClient,
    })).resolves.toEqual([canonicalEntry]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("caps a 100-entry request at twenty supplies and two concurrent token lanes", async () => {
    let activeContractReads = 0;
    let maximumContractReads = 0;
    const client = () => ({
      getBlockNumber: vi.fn(async () => 112n),
      getBlock: vi.fn(async () => ({ hash: BLOCK_HASH, number: 100n })),
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        activeContractReads += 1;
        maximumContractReads = Math.max(
          maximumContractReads,
          activeContractReads,
        );
        await Promise.resolve();
        activeContractReads -= 1;
        return functionName === "decimals" ? 18 : SUPPLY;
      }),
    });
    const primary = client();
    const secondary = client();
    const entries = Array.from({ length: 100 }, (_, index) =>
      missingEntry(index + 1)
    );

    const hydrated = await hydrateMissingCanonicalTokenSupplyV1(entries, {
      deployment,
      createClient: (rpcUrl) =>
        rpcUrl === deployment.rpcUrl ? primary : secondary,
    });

    expect(hydrated.filter((item) => item.totalSupplyRaw !== undefined))
      .toHaveLength(20);
    expect(primary.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(secondary.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(primary.getBlock).toHaveBeenCalledTimes(1);
    expect(secondary.getBlock).toHaveBeenCalledTimes(1);
    expect(primary.readContract).toHaveBeenCalledTimes(40);
    expect(secondary.readContract).toHaveBeenCalledTimes(40);
    expect(maximumContractReads).toBeLessThanOrEqual(8);
    expect(
      primary.getBlockNumber.mock.calls.length +
        secondary.getBlockNumber.mock.calls.length +
        primary.getBlock.mock.calls.length +
        secondary.getBlock.mock.calls.length +
        primary.readContract.mock.calls.length +
        secondary.readContract.mock.calls.length,
    ).toBe(84);
  });

  it("deduplicates concurrent snapshot and token reads and serves the exact success cache", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const primary = supplyClient();
    const secondary = supplyClient();
    for (const client of [primary, secondary]) {
      client.readContract.mockImplementation(async ({ functionName }) => {
        await gate;
        return functionName === "decimals" ? 18 : SUPPLY;
      });
    }
    const createClient = vi.fn((rpcUrl: string) =>
      rpcUrl === deployment.rpcUrl ? primary : secondary);
    const dependencies = { deployment, createClient } as const;

    const first = hydrateMissingCanonicalTokenSupplyV1([customEntry], dependencies);
    const concurrent = hydrateMissingCanonicalTokenSupplyV1(
      [customEntry],
      dependencies,
    );
    await vi.waitFor(() => {
      expect(primary.readContract).toHaveBeenCalledTimes(2);
      expect(secondary.readContract).toHaveBeenCalledTimes(2);
    });
    release();
    const [firstResult, concurrentResult] = await Promise.all([
      first,
      concurrent,
    ]);
    const cachedResult = await hydrateMissingCanonicalTokenSupplyV1(
      [customEntry],
      dependencies,
    );

    expect(firstResult).toEqual(concurrentResult);
    expect(cachedResult).toEqual(firstResult);
    expect(primary.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(secondary.getBlockNumber).toHaveBeenCalledTimes(1);
    expect(primary.getBlock).toHaveBeenCalledTimes(1);
    expect(secondary.getBlock).toHaveBeenCalledTimes(1);
    expect(primary.readContract).toHaveBeenCalledTimes(2);
    expect(secondary.readContract).toHaveBeenCalledTimes(2);
  });

  it("binds success cache identity to token, provider set and exact snapshot", async () => {
    const client = supplyClient();
    client.getBlock.mockImplementation(async ({ blockNumber }) => ({
      hash: blockNumber === 100n ? BLOCK_HASH : NEXT_BLOCK_HASH,
      number: blockNumber,
    }));
    const createClient = vi.fn(() => client);
    const firstDependencies = {
      deployment,
      snapshot: { blockNumber: "100", blockHash: BLOCK_HASH },
      createClient,
    } as const;

    await hydrateMissingCanonicalTokenSupplyV1([entry], firstDependencies);
    await hydrateMissingCanonicalTokenSupplyV1([entry], firstDependencies);
    expect(createClient).toHaveBeenCalledTimes(4);

    await hydrateMissingCanonicalTokenSupplyV1(
      [missingEntry(2)],
      firstDependencies,
    );
    expect(createClient).toHaveBeenCalledTimes(6);

    const providerDrift = {
      ...deployment,
      rpcUrlSecondary: "https://replacement.example/rpc",
    } satisfies ReadyOnchainDeployment;
    await hydrateMissingCanonicalTokenSupplyV1([entry], {
      ...firstDependencies,
      deployment: providerDrift,
    });
    expect(createClient).toHaveBeenCalledTimes(10);

    await hydrateMissingCanonicalTokenSupplyV1([entry], {
      ...firstDependencies,
      snapshot: { blockNumber: "101", blockHash: NEXT_BLOCK_HASH },
    });
    expect(createClient).toHaveBeenCalledTimes(14);
    expect(client.readContract).toHaveBeenCalledTimes(16);
  });

  it("does not cache a discordant supply failure", async () => {
    const primary = supplyClient();
    const secondary = supplyClient({ totalSupply: SUPPLY - 1n });
    const dependencies = {
      deployment,
      snapshot: { blockNumber: "100", blockHash: BLOCK_HASH },
      createClient: (rpcUrl: string) =>
        rpcUrl === deployment.rpcUrl ? primary : secondary,
    } as const;

    await expect(hydrateMissingCanonicalTokenSupplyV1(
      [customEntry],
      dependencies,
    )).resolves.toEqual([customEntry]);
    secondary.readContract.mockImplementation(async ({ functionName }) =>
      functionName === "decimals" ? 18 : SUPPLY
    );

    const [retried] = await hydrateMissingCanonicalTokenSupplyV1(
      [customEntry],
      dependencies,
    );
    expect(retried).toMatchObject({
      tokenDecimals: 18,
      totalSupplyRaw: SUPPLY.toString(),
    });
    expect(primary.readContract).toHaveBeenCalledTimes(4);
    expect(secondary.readContract).toHaveBeenCalledTimes(4);
  });

  it("returns the original Registry entry at the phase deadline and ignores a late quorum", async () => {
    vi.useFakeTimers();
    try {
      let resolvePrimaryHead!: (value: bigint) => void;
      let resolveSecondaryHead!: (value: bigint) => void;
      let slow = true;
      const providerSignals: AbortSignal[] = [];
      const primary = supplyClient();
      const secondary = supplyClient();
      primary.getBlockNumber.mockImplementation(() => slow
        ? new Promise((resolve) => {
            resolvePrimaryHead = resolve;
          })
        : Promise.resolve(112n));
      secondary.getBlockNumber.mockImplementation(() => slow
        ? new Promise((resolve) => {
            resolveSecondaryHead = resolve;
          })
        : Promise.resolve(112n));
      const createClient = (
        rpcUrl: string,
        context: Readonly<{ signal: AbortSignal }>,
      ) => {
        providerSignals.push(context.signal);
        return rpcUrl === deployment.rpcUrl ? primary : secondary;
      };

      const pending = hydrateMissingCanonicalTokenSupplyBoundedV1(
        [customEntry],
        { maximumDurationMs: 25 },
        {
          deployment,
          createClient,
        },
      );
      await vi.advanceTimersByTimeAsync(25);
      const result = await pending;
      expect(result).toEqual([customEntry]);
      expect(providerSignals).toHaveLength(2);
      expect(providerSignals.every((signal) => signal.aborted)).toBe(true);

      resolvePrimaryHead(112n);
      resolveSecondaryHead(112n);
      await vi.advanceTimersByTimeAsync(0);
      expect(result).toEqual([customEntry]);
      expect(result[0]).not.toHaveProperty("totalSupplyRaw");

      slow = false;
      const [retried] = await hydrateMissingCanonicalTokenSupplyV1(
        [customEntry],
        { deployment, createClient, providerTimeoutMs: 100 },
      );
      expect(retried).toMatchObject({
        tokenDecimals: 18,
        totalSupplyRaw: SUPPLY.toString(),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start quorum reads after the request signal is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const createClient = vi.fn();

    await expect(hydrateMissingCanonicalTokenSupplyBoundedV1(
      [customEntry],
      { signal: controller.signal },
      { deployment, createClient },
    )).resolves.toEqual([customEntry]);
    expect(createClient).not.toHaveBeenCalled();
  });
});
