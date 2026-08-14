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
import {
  PrimaryRpcLaunchCatalogError,
  readPrimaryRpcExploreEntriesV1,
  safePrimaryRpcLaunchCatalogError,
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
    const client = mockClient({
      getLogs: async (query) => {
        queries.push(query);
        if (query.toBlock - query.fromBlock + 1n > 4_096n) {
          throw new Error("provider range limit");
        }
        return logs.filter((log) =>
          log.blockNumber >= query.fromBlock &&
          log.blockNumber <= query.toBlock
        );
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
    ).every((entry) => entry.creatorAddress === undefined)).toBe(true);
    expect(tokenEntries.filter((entry) =>
      entry.launchModel === "classic"
    ).every((entry) => entry.creatorAddress === CREATOR)).toBe(true);
    expect(queries.length).toBeGreaterThan(1);
    expect(queries.some((query) =>
      query.toBlock - query.fromBlock + 1n === 4_096n
    )).toBe(true);
    for (const query of queries) {
      expect(query.address).toHaveLength(5);
      expect(query.events).toHaveLength(6);
      expect(query.strict).toBe(true);
    }
  });

  it("maps an exhausted primary-provider range failure to a safe 503", async () => {
    const error = await readPrimaryRpcExploreEntriesV1({
      client: mockClient({
        getLogs: async () => {
          throw new Error("https://lb.drpc.live/ethereum/private-key");
        },
      }),
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(PrimaryRpcLaunchCatalogError);
    expect((error as PrimaryRpcLaunchCatalogError).category).toBe("transport");
    expect(safePrimaryRpcLaunchCatalogError(error)).toEqual({
      name: "PrimaryRpcLaunchCatalogError",
      category: "transport",
      status: 503,
    });
    expect(JSON.stringify(error)).not.toContain("private-key");
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
    deployer: CREATOR,
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
  return [
    { ...shared, eventName: release.eventName, logIndex: 5, args: launchArgs },
    {
      ...shared,
      eventName: release.liquidityEventName,
      logIndex: 6,
      args: liquidityArgs,
    },
  ];
}

function address(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function bytes32(value: bigint | number): `0x${string}` {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}
