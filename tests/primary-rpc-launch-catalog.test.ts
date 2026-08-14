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
  PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS,
  PrimaryRpcLaunchCatalogError,
  createPrimaryRpcLaunchCatalogCacheV1,
  readPrimaryRpcExploreEntriesV1,
  safePrimaryRpcLaunchCatalogError,
  type PrimaryRpcContractRead,
  type PrimaryRpcExploreEntriesV1,
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

describe("verified dRPC Explore catalog cache", () => {
  it("shares one verified catalog across query, sort, and page requests", async () => {
    const nowMs = 1_800_000_000_001;
    let reads = 0;
    const cache = createPrimaryRpcLaunchCatalogCacheV1(async () => {
      reads += 1;
      return catalog(reads, nowMs);
    }, () => cacheBinding(), () => nowMs);

    const queryResult = await cache.read();
    const sortResult = await cache.read();
    const pageResult = await cache.read();

    expect(reads).toBe(1);
    expect(sortResult).toBe(queryResult);
    expect(pageResult).toBe(queryResult);
    expect(pageResult).toMatchObject({
      source: "drpc",
      asOfBlock: "25650001",
      asOfBlockHash: bytes32(25_650_001),
    });
  });

  it("coalesces concurrent cold requests into one dRPC catalog refresh", async () => {
    const nowMs = 1_800_000_000_001;
    let reads = 0;
    let resolveRead!: (value: PrimaryRpcExploreEntriesV1) => void;
    const cache = createPrimaryRpcLaunchCatalogCacheV1(() => {
      reads += 1;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    }, () => cacheBinding(), () => nowMs);

    const newest = cache.read();
    const highest = cache.read();
    expect(reads).toBe(1);
    resolveRead(catalog(1, nowMs));

    await expect(Promise.all([newest, highest])).resolves.toEqual([
      catalog(1, nowMs),
      catalog(1, nowMs),
    ]);
    expect(reads).toBe(1);
  });

  it("refreshes dRPC at the exact 60-second TTL boundary", async () => {
    let nowMs = 1_800_000_000_000;
    let reads = 0;
    const cache = createPrimaryRpcLaunchCatalogCacheV1(async () => {
      reads += 1;
      return catalog(reads, nowMs);
    }, () => cacheBinding(), () => nowMs);

    const initial = await cache.read();
    nowMs += PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS - 1;
    const fresh = await cache.read();
    nowMs += 1;
    const refreshed = await cache.read();

    expect(reads).toBe(2);
    expect(fresh).toBe(initial);
    expect(refreshed).not.toBe(initial);
    expect(refreshed.asOfBlock).toBe("25650002");
  });

  it("never serves stale data or caches a failed TTL refresh", async () => {
    let nowMs = 1_800_000_000_000;
    let reads = 0;
    const cache = createPrimaryRpcLaunchCatalogCacheV1(async () => {
      reads += 1;
      if (reads === 2) {
        throw new PrimaryRpcLaunchCatalogError("transport", "head");
      }
      return catalog(reads, nowMs);
    }, () => cacheBinding(), () => nowMs);

    await expect(cache.read()).resolves.toEqual(catalog(1, nowMs));
    nowMs += PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS;
    await expect(cache.read()).rejects.toMatchObject({
      category: "transport",
      phase: "head",
    });
    await expect(cache.read()).resolves.toEqual(catalog(3, nowMs));

    expect(reads).toBe(3);
  });

  it("does not cache a refresh after its only request aborts", async () => {
    const nowMs = 1_800_000_000_001;
    let reads = 0;
    let resolveFirst!: (value: PrimaryRpcExploreEntriesV1) => void;
    const cache = createPrimaryRpcLaunchCatalogCacheV1(() => {
      reads += 1;
      if (reads === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(catalog(reads, nowMs));
    }, () => cacheBinding(), () => nowMs);
    const controller = new AbortController();
    const aborted = cache.read({ signal: controller.signal });

    controller.abort();
    resolveFirst(catalog(1, nowMs));
    await expect(aborted).rejects.toMatchObject({
      category: "transport",
      phase: "initialization",
    });
    await Promise.resolve();
    await expect(cache.read()).resolves.toEqual(catalog(2, nowMs));

    expect(reads).toBe(2);
  });

  it("keeps a shared fill alive when only one concurrent waiter aborts", async () => {
    const nowMs = 1_800_000_000_001;
    let reads = 0;
    let resolveRead!: (value: PrimaryRpcExploreEntriesV1) => void;
    const cache = createPrimaryRpcLaunchCatalogCacheV1(() => {
      reads += 1;
      return new Promise((resolve) => {
        resolveRead = resolve;
      });
    }, () => cacheBinding(), () => nowMs);
    const controller = new AbortController();

    const aborted = cache.read({ signal: controller.signal });
    const active = cache.read();
    controller.abort();
    resolveRead(catalog(1, nowMs));

    await expect(aborted).rejects.toMatchObject({
      category: "transport",
      phase: "initialization",
    });
    await expect(active).resolves.toEqual(catalog(1, nowMs));
    await expect(cache.read()).resolves.toEqual(catalog(1, nowMs));
    expect(reads).toBe(1);
  });

  it("validates the commitment binding before a hit and refreshes on rotation", async () => {
    const nowMs = 1_800_000_000_001;
    let reads = 0;
    let bindingReads = 0;
    let commitment = bytes32(700);
    const cache = createPrimaryRpcLaunchCatalogCacheV1(async () => {
      reads += 1;
      return catalog(reads, nowMs);
    }, () => {
      bindingReads += 1;
      return cacheBinding(commitment);
    }, () => nowMs);

    await cache.read();
    await cache.read();
    commitment = bytes32(701);
    const rotated = await cache.read();

    expect(bindingReads).toBe(3);
    expect(reads).toBe(2);
    expect(rotated.asOfBlock).toBe("25650002");
  });

  it("does not cache a cold refresh error and retries the exact failure", async () => {
    const nowMs = 1_800_000_000_001;
    let reads = 0;
    const cache = createPrimaryRpcLaunchCatalogCacheV1(async () => {
      reads += 1;
      if (reads < 3) {
        throw new PrimaryRpcLaunchCatalogError("transport", "logs");
      }
      return catalog(reads, nowMs);
    }, () => cacheBinding(), () => nowMs);

    await expect(cache.read()).rejects.toMatchObject({
      category: "transport",
      phase: "logs",
    });
    await expect(cache.read()).rejects.toMatchObject({
      category: "transport",
      phase: "logs",
    });
    await expect(cache.read()).resolves.toEqual(catalog(3, nowMs));
    expect(reads).toBe(3);
  });

  it.each([
    ["future", 1],
    ["60 seconds old", -PRIMARY_RPC_LAUNCH_CATALOG_CACHE_TTL_MS],
  ] as const)(
    "fails closed instead of serving a %s generatedAt",
    async (_label, generatedAtOffsetMs) => {
      const nowMs = 1_800_000_000_001;
      let reads = 0;
      const cache = createPrimaryRpcLaunchCatalogCacheV1(async () => {
        reads += 1;
        return catalog(reads, nowMs + generatedAtOffsetMs);
      }, () => cacheBinding(), () => nowMs);

      await expect(cache.read()).rejects.toMatchObject({
        category: "integrity",
        phase: "entries",
      });
      await expect(cache.read()).rejects.toMatchObject({
        category: "integrity",
        phase: "entries",
      });
      expect(reads).toBe(2);
    },
  );
});

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
  it("retries the primary dRPC head number once after a transport failure", async () => {
    let attempts = 0;
    const result = await readPrimaryRpcExploreEntriesV1({
      client: mockClient({
        getBlockNumber: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error("temporary dRPC failure");
          return HEAD;
        },
      }),
      now: new Date("2026-08-14T12:00:00.000Z"),
    });

    expect(attempts).toBe(2);
    expect(result).toMatchObject({
      source: "drpc",
      asOfBlock: HEAD.toString(),
      asOfBlockHash: HEAD_HASH,
    });
  });

  it("retries the exact primary dRPC head block once after transport failure", async () => {
    const defaults = mockClient();
    let attempts = 0;
    const requestedBlocks: bigint[] = [];
    const result = await readPrimaryRpcExploreEntriesV1({
      client: mockClient({
        getBlock: async (input) => {
          attempts += 1;
          requestedBlocks.push(input.blockNumber);
          if (attempts === 1) throw new Error("temporary dRPC failure");
          return defaults.getBlock(input);
        },
      }),
      now: new Date("2026-08-14T12:00:00.000Z"),
    });

    expect(attempts).toBe(2);
    expect(requestedBlocks).toEqual([HEAD, HEAD]);
    expect(result).toMatchObject({
      source: "drpc",
      asOfBlock: HEAD.toString(),
      asOfBlockHash: HEAD_HASH,
    });
  });

  it("bounds an exhausted primary dRPC head read to two attempts", async () => {
    let attempts = 0;
    const error = await readPrimaryRpcExploreEntriesV1({
      client: mockClient({
        getBlockNumber: async () => {
          attempts += 1;
          throw new Error("temporary dRPC failure");
        },
      }),
    }).catch((value: unknown) => value);

    expect(attempts).toBe(2);
    expect(safePrimaryRpcLaunchCatalogError(error)).toEqual({
      name: "PrimaryRpcLaunchCatalogError",
      category: "transport",
      phase: "head",
      status: 503,
    });
  });

  it.each(["configuration", "response", "integrity"] as const)(
    "does not retry a typed %s head failure",
    async (category) => {
      let attempts = 0;
      const error = await readPrimaryRpcExploreEntriesV1({
        client: mockClient({
          getBlockNumber: async () => {
            attempts += 1;
            throw new PrimaryRpcLaunchCatalogError(category);
          },
        }),
      }).catch((value: unknown) => value);

      expect(attempts).toBe(1);
      expect(safePrimaryRpcLaunchCatalogError(error)).toMatchObject({
        category,
        phase: "head",
        status: 503,
      });
    },
  );

  it("does not retry an invalid successful head response", async () => {
    let attempts = 0;
    const error = await readPrimaryRpcExploreEntriesV1({
      client: mockClient({
        getBlockNumber: async () => {
          attempts += 1;
          return 0n;
        },
      }),
    }).catch((value: unknown) => value);

    expect(attempts).toBe(1);
    expect(safePrimaryRpcLaunchCatalogError(error)).toMatchObject({
      category: "response",
      phase: "head",
      status: 503,
    });
  });

  it("does not retry the dRPC head after outer cancellation", async () => {
    const controller = new AbortController();
    let attempts = 0;
    const error = await readPrimaryRpcExploreEntriesV1({
      signal: controller.signal,
      client: mockClient({
        getBlockNumber: async () => {
          attempts += 1;
          controller.abort();
          throw new Error("temporary dRPC failure");
        },
      }),
    }).catch((value: unknown) => value);

    expect(attempts).toBe(1);
    expect(safePrimaryRpcLaunchCatalogError(error)).toMatchObject({
      category: "transport",
      phase: "head",
      status: 503,
    });
  });

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
      let attempts = 0;
      const pending = readPrimaryRpcExploreEntriesV1({
        client: mockClient({
          getBlockNumber: () => {
            attempts += 1;
            return new Promise<bigint>(() => {});
          },
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
      expect(attempts).toBe(1);
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

function catalog(
  sequence: number,
  generatedAtMs = 1_800_000_000_000 + sequence,
): PrimaryRpcExploreEntriesV1 {
  const block = 25_650_000 + sequence;
  return Object.freeze({
    source: "drpc" as const,
    generatedAt: new Date(generatedAtMs).toISOString(),
    asOfBlock: String(block),
    asOfBlockHash: bytes32(block),
    entries: Object.freeze([]),
  });
}

function cacheBinding(endpointCommitment = bytes32(700)) {
  return Object.freeze({ endpointCommitment });
}
