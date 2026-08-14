import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import classicV2Manifest from
  "../contracts/deployments/mainnet-classic-v2.json";
import classicV3Manifest from
  "../contracts/deployments/mainnet-classic-v3.json";
import stockV1Manifest from
  "../contracts/deployments/mainnet-stock-paired-v1.json";
import stockV2Manifest from
  "../contracts/deployments/mainnet-stock-paired-v2.json";
import stockV3Manifest from
  "../contracts/deployments/mainnet-stock-paired-v3.json";
import { rpcProviderCommitment } from
  "../lib/data-pipeline/rpc-provider-commitments";
import {
  PRIMARY_RPC_LAUNCH_CATALOG_BUDGET_MS,
  PrimaryRpcLaunchCatalogError,
  readPrimaryRpcExploreEntriesV1,
  safePrimaryRpcLaunchCatalogError,
  type PrimaryRpcContractRead,
  type PrimaryRpcLaunchCatalogClient,
  type PrimaryRpcLogQuery,
} from "../lib/market-data/primary-rpc-launches.server";
import type { CanonicalTokenExploreEntry } from "../lib/tokens";

const HEAD = 25_650_000n;
const HEAD_HASH = bytes32(HEAD);
const QUOTE = address(900);
const RECIPIENT = address(901);
const CREATOR = address(902);
const VAULT = address(903);

type FixtureRelease = Readonly<{
  launcher: `0x${string}`;
  ethLaunchCoordinator: `0x${string}` | null;
  hook: `0x${string}`;
  blockNumber: bigint;
  eventName:
    | "MemeTokenLaunched"
    | "MemeTokenLaunchedV2"
    | "StockPairedTokenLaunched";
  liquidityEventName:
    | "MemeLiquidityConfigured"
    | "MemeLiquidityConfiguredV2"
    | "StockPairedLiquidityConfigured";
  model: "classic-v2" | "classic-v3" | "stock";
  token: `0x${string}`;
  poolId: `0x${string}`;
  launchHash: `0x${string}`;
  transactionHash: `0x${string}`;
}>;

const RELEASES: readonly FixtureRelease[] = [
  fixtureRelease({
    manifest: classicV2Manifest,
    launcherKey: "memeLauncher",
    startBlock: classicV2Manifest.deploymentBlock,
    eventName: "MemeTokenLaunched",
    liquidityEventName: "MemeLiquidityConfigured",
    model: "classic-v2",
    sequence: 1,
  }),
  fixtureRelease({
    manifest: classicV3Manifest,
    launcherKey: "launcher",
    startBlock:
      classicV3Manifest.sourceVerification.contracts.launcher.deploymentBlock,
    eventName: "MemeTokenLaunchedV2",
    liquidityEventName: "MemeLiquidityConfiguredV2",
    model: "classic-v3",
    sequence: 2,
  }),
  fixtureRelease({
    manifest: stockV1Manifest,
    launcherKey: "launcher",
    startBlock: stockV1Manifest.startBlock,
    eventName: "StockPairedTokenLaunched",
    liquidityEventName: "StockPairedLiquidityConfigured",
    model: "stock",
    sequence: 3,
  }),
  fixtureRelease({
    manifest: stockV2Manifest,
    launcherKey: "launcher",
    startBlock: stockV2Manifest.startBlock,
    eventName: "StockPairedTokenLaunched",
    liquidityEventName: "StockPairedLiquidityConfigured",
    model: "stock",
    sequence: 4,
  }),
  fixtureRelease({
    manifest: stockV3Manifest,
    launcherKey: "launcher",
    startBlock: stockV3Manifest.startBlock,
    eventName: "StockPairedTokenLaunched",
    liquidityEventName: "StockPairedLiquidityConfigured",
    model: "stock",
    sequence: 5,
  }),
];

describe("single-primary dRPC launch catalog", () => {
  it("reads all five canonical releases from bounded sparse log ranges", async () => {
    const queries: PrimaryRpcLogQuery[] = [];
    const logs = RELEASES.flatMap(releaseLogs);
    let activeLogWindows = 0;
    let maximumActiveLogWindows = 0;
    const client = mockClient({
      getLogs: async (query) => {
        queries.push(query);
        activeLogWindows += 1;
        maximumActiveLogWindows = Math.max(
          maximumActiveLogWindows,
          activeLogWindows,
        );
        try {
          await Promise.resolve();
          return logs.filter((log) =>
            log.blockNumber >= query.fromBlock &&
            log.blockNumber <= query.toBlock
          ).reverse();
        } finally {
          activeLogWindows -= 1;
        }
      },
    });

    const result = await readPrimaryRpcExploreEntriesV1({
      client,
      now: new Date("2026-08-14T12:00:00.000Z"),
    });

    expect(result).toMatchObject({
      source: "drpc",
      generatedAt: "2026-08-14T12:00:00.000Z",
      asOfBlock: HEAD.toString(),
      asOfBlockHash: HEAD_HASH,
    });
    expect(result.entries).toHaveLength(5);
    const tokenEntries = result.entries.filter(
      (entry): entry is CanonicalTokenExploreEntry =>
        entry.exploreKind === "token",
    );
    expect(new Set(tokenEntries.map((entry) => entry.launchModel))).toEqual(
      new Set(["classic", "stock-paired"]),
    );
    expect(tokenEntries.filter((entry) =>
      entry.launchModel === "stock-paired"
    )).toHaveLength(3);
    expect(tokenEntries.filter((entry) =>
      entry.launchModel === "stock-paired"
    ).every((entry) => entry.creatorAddress === CREATOR)).toBe(true);
    expect(tokenEntries.every((entry) => entry.creatorAddress === CREATOR))
      .toBe(true);
    expect(queries.length).toBeGreaterThan(1);
    expect(maximumActiveLogWindows).toBeGreaterThan(1);
    expect(maximumActiveLogWindows).toBeLessThanOrEqual(6);
    expect(queries.some((query) =>
      query.toBlock - query.fromBlock + 1n === 4_096n
    )).toBe(true);
    const orderedQueries = [...queries].sort((left, right) =>
      left.fromBlock < right.fromBlock ? -1 : 1
    );
    for (let index = 1; index < orderedQueries.length; index += 1) {
      expect(orderedQueries[index]!.fromBlock).toBe(
        orderedQueries[index - 1]!.toBlock + 1n,
      );
    }
    for (const query of queries) {
      expect(query.toBlock - query.fromBlock + 1n).toBeLessThanOrEqual(4_096n);
      expect(query.address).toHaveLength(8);
      expect(query.events).toHaveLength(7);
      expect(query.strict).toBe(true);
    }
  });

  it("bounds an exhausted primary-provider window to two attempts", async () => {
    let attempts = 0;
    const oneWindowHead = BigInt(classicV2Manifest.deploymentBlock + 100);
    const error = await readPrimaryRpcExploreEntriesV1({
      client: mockClient({
        getBlockNumber: async () => oneWindowHead,
        getLogs: async () => {
          attempts += 1;
          throw new Error("https://lb.drpc.live/ethereum/private-key");
        },
      }),
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PrimaryRpcLaunchCatalogError);
    expect((error as PrimaryRpcLaunchCatalogError).category).toBe("transport");
    expect(safePrimaryRpcLaunchCatalogError(error)).toEqual({
      name: "PrimaryRpcLaunchCatalogError",
      category: "transport",
      phase: "logs",
      status: 503,
    });
    expect(JSON.stringify(error)).not.toContain("private-key");
    expect(attempts).toBe(2);
  });

  it("fails configuration closed before making a public or secondary request", async () => {
    const error = await readPrimaryRpcExploreEntriesV1({
      environment: {},
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PrimaryRpcLaunchCatalogError);
    expect((error as PrimaryRpcLaunchCatalogError).category).toBe(
      "configuration",
    );
    expect(safePrimaryRpcLaunchCatalogError(error).status).toBe(503);
  });

  it("hydrates only the requested token after the complete sparse log scan", async () => {
    const target = RELEASES[3]!;
    const logs = RELEASES.flatMap(releaseLogs);
    const queries: PrimaryRpcLogQuery[] = [];
    const blockReads: bigint[] = [];
    const contractReads: PrimaryRpcContractRead[] = [];
    const defaults = mockClient();
    const client = mockClient({
      getLogs: async (query) => {
        queries.push(query);
        return logs.filter((log) =>
          log.blockNumber >= query.fromBlock &&
          log.blockNumber <= query.toBlock
        );
      },
      getBlock: async (input) => {
        blockReads.push(input.blockNumber);
        return defaults.getBlock(input);
      },
      readContract: async (input) => {
        contractReads.push(input);
        return defaults.readContract(input);
      },
    });

    const result = await readPrimaryRpcExploreEntriesV1({
      client,
      requestedTokenAddress: target.token,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({ tokenAddress: target.token });
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.every((query) => query.address.length === 8)).toBe(true);
    expect(blockReads).toEqual([HEAD, target.blockNumber]);
    expect(contractReads).toHaveLength(7);
    expect(new Set(contractReads.map((read) => read.address))).toEqual(
      new Set([target.token, QUOTE]),
    );
    expect(contractReads.filter((read) =>
      read.functionName === "metadata"
    )).toEqual([
      expect.objectContaining({ address: target.token }),
    ]);
  });

  it("returns the same deterministic catalog when RPC pages arrive reversed", async () => {
    const logs = RELEASES.flatMap(releaseLogs);
    const read = (reverse: boolean) => readPrimaryRpcExploreEntriesV1({
      client: mockClient({
        getLogs: async (query) => {
          const page = logs.filter((log) =>
            log.blockNumber >= query.fromBlock &&
            log.blockNumber <= query.toBlock
          );
          return reverse ? page.reverse() : page;
        },
      }),
      now: new Date("2026-08-14T12:00:00.000Z"),
    });

    const [forward, reversed] = await Promise.all([read(false), read(true)]);

    expect(reversed).toEqual(forward);
  });

  it("rejects a duplicate canonical event coordinate", async () => {
    const logs = RELEASES.flatMap(releaseLogs);
    const error = await readPrimaryRpcExploreEntriesV1({
      client: mockClient({
        getLogs: async (query) => logs.concat(logs[0]!).filter((log) =>
          log.blockNumber >= query.fromBlock &&
          log.blockNumber <= query.toBlock
        ),
      }),
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PrimaryRpcLaunchCatalogError);
    expect(safePrimaryRpcLaunchCatalogError(error)).toMatchObject({
      category: "integrity",
      phase: "logs",
      status: 503,
    });
  });

  it.each(["token", "quoteAsset", "launchHash"] as const)(
    "fails closed when Stock-Paired creator identity %s mismatches",
    async (field) => {
      const target = RELEASES.find((release) => release.model === "stock")!;
      const logs = RELEASES.flatMap(releaseLogs).map((log) =>
        log.eventName === "StockPairedEthTokenLaunched" &&
          log.args.token === target.token
          ? {
              ...log,
              args: {
                ...log.args,
                [field]: field === "launchHash" ? bytes32(999) : address(999),
              },
            }
          : log
      );
      const error = await readPrimaryRpcExploreEntriesV1({
        client: mockClient({
          getLogs: async (query) => logs.filter((log) =>
            log.blockNumber >= query.fromBlock &&
            log.blockNumber <= query.toBlock
          ),
        }),
      }).catch((value: unknown) => value);

      expect(error).toBeInstanceOf(PrimaryRpcLaunchCatalogError);
      expect(safePrimaryRpcLaunchCatalogError(error)).toMatchObject({
        category: "integrity",
        phase: "logs",
        status: 503,
      });
    },
  );

  it("enforces one hard end-to-end budget even when a client ignores aborts", async () => {
    vi.useFakeTimers();
    try {
      const pending = readPrimaryRpcExploreEntriesV1({
        client: mockClient({
          getBlockNumber: () => new Promise<bigint>(() => {}),
        }),
      }).catch((value: unknown) => value);

      await vi.advanceTimersByTimeAsync(
        PRIMARY_RPC_LAUNCH_CATALOG_BUDGET_MS,
      );
      const error = await pending;

      expect(error).toBeInstanceOf(PrimaryRpcLaunchCatalogError);
      expect(safePrimaryRpcLaunchCatalogError(error)).toEqual({
        name: "PrimaryRpcLaunchCatalogError",
        category: "transport",
        phase: "head",
        status: 503,
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes cooperative cancellation into the viem HTTP fetch", async () => {
    const rpcUrl = "https://lb.drpc.live/ethereum/test-key-12345678";
    const environment = {
      PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_PROVIDER: "drpc",
      PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_URL: rpcUrl,
      PROGRAMMABLE_WEBSITE_MAINNET_RPC_PRIMARY_ENDPOINT_COMMITMENT:
        rpcProviderCommitment("endpoint", rpcUrl),
    };
    let startFetch!: (signal: AbortSignal | null) => void;
    const fetchStarted = new Promise<AbortSignal | null>((resolve) => {
      startFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal ?? null;
        startFetch(signal);
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new Error("aborted"));
          if (signal?.aborted) abort();
          else signal?.addEventListener("abort", abort, { once: true });
        });
      },
    ));
    const controller = new AbortController();
    try {
      const pending = readPrimaryRpcExploreEntriesV1({
        environment,
        signal: controller.signal,
      }).catch((value: unknown) => value);
      const fetchSignal = await fetchStarted;

      expect(fetchSignal).toBeInstanceOf(AbortSignal);
      expect(fetchSignal?.aborted).toBe(false);
      controller.abort();
      const error = await pending;

      expect(fetchSignal?.aborted).toBe(true);
      expect(safePrimaryRpcLaunchCatalogError(error)).toMatchObject({
        category: "transport",
        phase: "head",
        status: 503,
      });
    } finally {
      controller.abort();
      vi.unstubAllGlobals();
    }
  });

  it("normalizes synchronous runtime failures with a safe phase and 503", async () => {
    const error = await readPrimaryRpcExploreEntriesV1({
      client: mockClient(),
      now: new Date(Number.NaN),
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PrimaryRpcLaunchCatalogError);
    expect(safePrimaryRpcLaunchCatalogError(error)).toEqual({
      name: "PrimaryRpcLaunchCatalogError",
      category: "runtime",
      phase: "selection",
      status: 503,
    });
    expect(safePrimaryRpcLaunchCatalogError(new Error("foreign"))).toEqual({
      name: "LaunchCatalogError",
      category: "unexpected",
      phase: "external",
      status: 503,
    });
  });

  it("contains no alternate catalog or secondary-provider dependency", () => {
    const source = readFileSync(
      new URL(
        "../lib/market-data/primary-rpc-launches.server.ts",
        import.meta.url,
      ),
      "utf8",
    );

    for (const forbidden of [
      "productionMainnetRpcPair",
      "quicknode",
      "alchemy",
      "Bitquery",
      "StateView",
      "subgraph",
      "@vercel/blob",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

function mockClient(overrides: Partial<PrimaryRpcLaunchCatalogClient> = {}):
  PrimaryRpcLaunchCatalogClient {
  return {
    getBlockNumber: async () => HEAD,
    getBlock: async ({ blockNumber }) => ({
      number: blockNumber,
      hash: bytes32(blockNumber),
      timestamp: 1_800_000_000n + blockNumber - 25_600_000n,
    }),
    getLogs: async () => [],
    readContract: async ({ address: token, functionName }) => {
      if (functionName === "name") return `Token ${token.slice(-4)}`;
      if (functionName === "symbol") return `T${token.slice(-3)}`;
      if (functionName === "decimals") return 18;
      if (token === QUOTE) {
        throw new Error("quote asset does not implement metadata()");
      }
      return [
        `Description ${token.slice(-4)}`,
        "https://programmable.sh/",
        "https://programmable.sh/token.png",
        "0x",
      ];
    },
    ...overrides,
  };
}

function fixtureRelease(input: Readonly<{
  manifest: unknown;
  launcherKey: "launcher" | "memeLauncher";
  startBlock: number;
  eventName: FixtureRelease["eventName"];
  liquidityEventName: FixtureRelease["liquidityEventName"];
  model: FixtureRelease["model"];
  sequence: number;
}>): FixtureRelease {
  const manifest = input.manifest as Readonly<{
    addresses: Readonly<Record<string, string>>;
  }>;
  return {
    launcher: manifest.addresses[input.launcherKey]!.toLowerCase() as
      `0x${string}`,
    ethLaunchCoordinator: input.model === "stock"
      ? manifest.addresses.ethLaunchCoordinator!.toLowerCase() as
        `0x${string}`
      : null,
    hook: manifest.addresses.feeHook!.toLowerCase() as `0x${string}`,
    blockNumber: BigInt(input.startBlock + 10),
    eventName: input.eventName,
    liquidityEventName: input.liquidityEventName,
    model: input.model,
    token: address(100 + input.sequence),
    poolId: bytes32(200 + input.sequence),
    launchHash: bytes32(300 + input.sequence),
    transactionHash: bytes32(400 + input.sequence),
  };
}

function releaseLogs(release: FixtureRelease) {
  const shared = {
    address: release.launcher,
    blockNumber: release.blockNumber,
    blockHash: bytes32(release.blockNumber),
    transactionHash: release.transactionHash,
    transactionIndex: 1,
    removed: false,
  } as const;
  const launchArgs = {
    token: release.token,
    poolId: release.poolId,
    feeHook: release.hook,
    rewardVault: VAULT,
    positionRecipient: RECIPIENT,
    positionTokenId: 7n,
    launchHash: release.launchHash,
    creator: CREATOR,
    deployer: release.ethLaunchCoordinator ?? CREATOR,
    quoteAsset: QUOTE,
    totalSwapFeeBps: 100n,
    buySwapFeeBps: 90n,
    sellSwapFeeBps: 110n,
  };
  const liquidityArgs = {
    token: release.token,
    ...(release.model === "stock" ? { quoteAsset: QUOTE } : {}),
    totalSupply: 1_000_000n * 10n ** 18n,
    tokenLiquidityAmount: 500_000n * 10n ** 18n,
    lockedTokenDust: 1n,
    initialTick: -100,
    tickLower: -200,
    tickUpper: 200,
    lpFeePips: 3_000,
    launchHash: release.launchHash,
  };
  const launcherLogs = [
    { ...shared, eventName: release.eventName, logIndex: 5, args: launchArgs },
    {
      ...shared,
      eventName: release.liquidityEventName,
      logIndex: 6,
      args: liquidityArgs,
    },
  ];
  return release.ethLaunchCoordinator === null
    ? launcherLogs
    : [
        ...launcherLogs,
        {
          ...shared,
          address: release.ethLaunchCoordinator,
          eventName: "StockPairedEthTokenLaunched",
          logIndex: 8,
          args: {
            creator: CREATOR,
            token: release.token,
            quoteAsset: QUOTE,
            initialBuyEthAmount: 1n,
            initialBuyQuoteAmount: 2n,
            initialBuyTokenAmount: 3n,
            launchHash: release.launchHash,
          },
        },
      ];
}

function address(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function bytes32(value: bigint | number): `0x${string}` {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}
