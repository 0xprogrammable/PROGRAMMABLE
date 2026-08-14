import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  BITQUERY_LAUNCH_CATALOG_HTTP_ENDPOINT,
  BitqueryLaunchCatalogError,
  readBitqueryExploreEntriesV1,
  safeBitqueryLaunchCatalogError,
} from "../lib/market-data/bitquery-launches.server";

const OAUTH_TOKEN = "ory_at_launch_catalog_test_123456";
const CLASSIC_V2_LAUNCHER = "0xd240d06f8586eb799f20056054e5b527405e6bad";
const CLASSIC_V2_HOOK = "0x025a386eaa79f6067d29848fd05ccc71beab20cc";
const CLASSIC_V3_LAUNCHER = "0xc3bd04aac2fb2ba58efd7eb673e544e0b80de770";
const CLASSIC_V3_HOOK = "0x35fe236ea82f7cf525c9719d7df8f49f94d720cc";
const STOCK_V1_LAUNCHER = "0x195750f33cad5ef2df857a53226b421297a1e79e";
const STOCK_V1_HOOK = "0x7773d183fe7b60d4f1885047fa42b815a62fe0cc";
const STOCK_V2_LAUNCHER = "0x5ea6be24838061ba45dbe8d82de1b267dc240daf";
const STOCK_V2_HOOK = "0x90c67c1e866f86526f0e338459cd435e1f23a0cc";
const STOCK_V3_LAUNCHER = "0x0573879f72d8ee8b0e5a4ec5e8bcdb2fcab9e51c";
const STOCK_V3_HOOK = STOCK_V2_HOOK;
const NATIVE_ETH = "0x0000000000000000000000000000000000000000";
const QUOTE = address(900);

type ReleaseFixture = Readonly<{
  model: "classic-v2" | "classic-v3" | "stock-paired-v1" |
    "stock-paired-v2" | "stock-paired-v3";
  launcher: string;
  hook: string;
  token: string;
  poolId: string;
  launchHash: string;
  transactionHash: string;
  launchBlock: number;
  liquidityBlock: number;
  launchLogIndex: number;
  liquidityLogIndex: number;
}>;

const RELEASES: readonly ReleaseFixture[] = [
  release("classic-v2", CLASSIC_V2_LAUNCHER, CLASSIC_V2_HOOK, 1, 1_001),
  release("classic-v3", CLASSIC_V3_LAUNCHER, CLASSIC_V3_HOOK, 2, 1_003),
  release("stock-paired-v1", STOCK_V1_LAUNCHER, STOCK_V1_HOOK, 3, 1_005),
  release("stock-paired-v2", STOCK_V2_LAUNCHER, STOCK_V2_HOOK, 4, 1_007),
  release("stock-paired-v3", STOCK_V3_LAUNCHER, STOCK_V3_HOOK, 5, 1_009),
];

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Bitquery launch catalog", () => {
  it("builds all active Classic and Stock releases from Bitquery only", async () => {
    const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(BITQUERY_LAUNCH_CATALOG_HTTP_ENDPOINT);
      expect(init?.headers).toMatchObject({
        Accept: "application/json",
        Authorization: `Bearer ${OAUTH_TOKEN}`,
        "Content-Type": "application/json",
      });
      expect(String(init?.body)).not.toContain(OAUTH_TOKEN);
      const request = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      requests.push(request);
      if (request.query.includes("ProgrammableLaunchCatalog")) {
        expect(request.query).toContain("EVM(network: eth, dataset: combined)");
        expect(request.query).toContain("TransactionStatus: { Success: true }");
        expect(request.query).toContain("SmartContract: { in: $launchers }");
        expect(request.query).toContain("Signature: { Name: { in: $eventNames } }");
        expect(request.variables.launchers).toEqual([
          CLASSIC_V2_LAUNCHER,
          CLASSIC_V3_LAUNCHER,
          STOCK_V1_LAUNCHER,
          STOCK_V2_LAUNCHER,
          STOCK_V3_LAUNCHER,
        ]);
        expect(request.variables.eventNames).toEqual([
          "MemeTokenLaunched",
          "MemeLiquidityConfigured",
          "MemeTokenLaunchedV2",
          "MemeLiquidityConfiguredV2",
          "StockPairedTokenLaunched",
          "StockPairedLiquidityConfigured",
        ]);
        return jsonResponse({
          data: {
            EVM: {
              events: RELEASES.flatMap((fixture) => [
                launchEvent(fixture),
                liquidityEvent(fixture),
              ]),
            },
          },
        });
      }
      expect(request.query).toContain("ProgrammableLaunchTokenMetadata");
      expect(request.query).toContain('ProtocolName: { is: "uniswap_v4" }');
      expect(request.query).toContain("PoolId: { in: $pools }");
      expect(request.query).toContain("transferMetadata: Transfers(");
      expect(request.query).toContain(
        "limitBy: { by: Transfer_Currency_SmartContract, count: 1 }",
      );
      expect(request.query).toContain("Fungible: true");
      expect(request.query).toContain("Token { Address Name Symbol }");
      expect(request.variables.pools).toEqual(
        RELEASES.map((fixture) => fixture.poolId).sort(),
      );
      expect(request.variables.tokenAddresses).toEqual([
        ...RELEASES.map((fixture) => fixture.token),
        QUOTE,
      ].sort());
      return jsonResponse(metadataResponse(RELEASES));
    }) as typeof fetch;

    const result = await readBitqueryExploreEntriesV1({
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-14T01:00:00.000Z"),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(2);
    expect(result).toMatchObject({
      source: "bitquery",
      generatedAt: "2026-08-14T01:00:00.000Z",
      asOfBlock: "1010",
    });
    expect(result.entries).toHaveLength(5);
    expect(result.entries.map((entry) => entry.id)).toEqual(
      [...RELEASES].reverse().map((fixture) => `1:${fixture.token}`),
    );
    for (const fixture of RELEASES) {
      const entry = result.entries.find((value) =>
        value.tokenAddress === fixture.token
      );
      expect(entry).toBeDefined();
      expect(entry).toMatchObject({
        exploreKind: "token",
        tokenAddress: fixture.token,
        hookAddress: fixture.hook,
        poolId: fixture.poolId,
        name: `Token ${fixture.token.slice(-4)}`,
        symbol: `T${fixture.token.slice(-3)}`,
        launchedAt: new Date(fixture.launchBlock * 1_000).toISOString(),
        totalSupply: "1000000",
        totalSupplyRaw: "1000000000000000000000000",
        tokenDecimals: 18,
        launchCategoryProvenance: {
          category: "classic",
          source: "canonical-launch-read-model",
        },
      });
      expect(entry).not.toHaveProperty("valuation");
      expect(entry).not.toHaveProperty("marketData");
      if (entry?.exploreKind !== "token") throw new Error("token entry expected");
      if (fixture.model.startsWith("stock-paired")) {
        expect(entry).toMatchObject({
          launchModel: "stock-paired",
          launchModelVersion: fixture.model,
          quoteAssetAddress: QUOTE,
          quoteAssetName: "USD Coin",
          quoteAssetSymbol: "USDC",
          totalSwapFeeBps: 100,
        });
        expect(entry.creatorAddress).toBeUndefined();
      } else {
        expect(entry).toMatchObject({
          launchModel: "classic",
          creatorAddress: address(700),
        });
      }
    }
    const classicV3 = result.entries.find((entry) =>
      entry.tokenAddress === RELEASES[1]!.token
    );
    expect(classicV3).toMatchObject({
      buyHookFeeBps: 100,
      sellHookFeeBps: 150,
      totalSwapFeeBps: 150,
      launchModelVersion: "classic-v3",
    });
  });

  it("returns an empty authoritative catalog without making a metadata call", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: { EVM: { events: [] } },
    })) as typeof fetch;

    await expect(readBitqueryExploreEntriesV1({
      fetchImpl,
      token: OAUTH_TOKEN,
      now: new Date("2026-08-14T01:00:00.000Z"),
    })).resolves.toEqual({
      source: "bitquery",
      generatedAt: "2026-08-14T01:00:00.000Z",
      asOfBlock: null,
      asOfBlockHash: null,
      entries: [],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("fails directly when Bitquery token metadata is incomplete", async () => {
    const fixture = RELEASES[0]!;
    const fetchImpl = sequencedFetch([
      { data: { EVM: { events: [launchEvent(fixture), liquidityEvent(fixture)] } } },
      {
        data: {
          EVM: { transferMetadata: [], poolMetadata: [] },
          Trading: { tokenMetadata: [] },
        },
      },
    ]);

    const error = await readBitqueryExploreEntriesV1({
      fetchImpl,
      token: OAUTH_TOKEN,
    }).catch((reason: unknown) => reason);
    expect(safeBitqueryLaunchCatalogError(error)).toEqual({
      name: "BitqueryLaunchCatalogError",
      category: "integrity",
    });
  });

  it("uses Bitquery transfer metadata before the first DEX trade", async () => {
    const fixture = RELEASES[0]!;
    const fetchImpl = sequencedFetch([
      { data: { EVM: { events: [launchEvent(fixture), liquidityEvent(fixture)] } } },
      {
        data: {
          EVM: {
            transferMetadata: [{
              Transfer: {
                Currency: currency(
                  fixture.token,
                  "Untraded Token",
                  "NEW",
                  18,
                ),
              },
            }],
            poolMetadata: [],
          },
          Trading: { tokenMetadata: [] },
        },
      },
    ]);

    const result = await readBitqueryExploreEntriesV1({
      fetchImpl,
      token: OAUTH_TOKEN,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      tokenAddress: fixture.token,
      name: "Untraded Token",
      symbol: "NEW",
      totalSupplyRaw: "1000000000000000000000000",
    });
  });

  it("fails directly on partial GraphQL responses", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: { EVM: { events: [] } },
      errors: [{ message: "archive shard unavailable" }],
    })) as typeof fetch;

    await expect(readBitqueryExploreEntriesV1({
      fetchImpl,
      token: OAUTH_TOKEN,
    })).rejects.toMatchObject({
      name: "BitqueryLaunchCatalogError",
      category: "response",
    });
  });

  it("fails directly when Bitquery transport or configuration is unavailable", async () => {
    await expect(readBitqueryExploreEntriesV1({ token: null })).rejects
      .toMatchObject({ category: "configuration" });

    const fetchImpl = vi.fn(async () => {
      throw new Error("network unavailable");
    }) as typeof fetch;
    await expect(readBitqueryExploreEntriesV1({
      fetchImpl,
      token: OAUTH_TOKEN,
    })).rejects.toMatchObject({ category: "transport" });
  });

  it("rejects a launch event attributed to the wrong canonical launcher", async () => {
    const fixture = RELEASES[0]!;
    const wrongSource = {
      ...launchEvent(fixture),
      Log: {
        ...launchEvent(fixture).Log,
        SmartContract: STOCK_V1_LAUNCHER,
      },
    };
    const fetchImpl = vi.fn(async () => jsonResponse({
      data: { EVM: { events: [wrongSource] } },
    })) as typeof fetch;

    await expect(readBitqueryExploreEntriesV1({
      fetchImpl,
      token: OAUTH_TOKEN,
    })).rejects.toMatchObject({ category: "integrity" });
  });

  it("exposes only safe error categories", () => {
    expect(safeBitqueryLaunchCatalogError(
      new BitqueryLaunchCatalogError("configuration"),
    )).toEqual({
      name: "BitqueryLaunchCatalogError",
      category: "configuration",
    });
    expect(safeBitqueryLaunchCatalogError(new Error("secret detail"))).toEqual({
      name: "LaunchCatalogError",
      category: "unexpected",
    });
  });
});

function release(
  model: ReleaseFixture["model"],
  launcher: string,
  hook: string,
  seed: number,
  launchBlock: number,
): ReleaseFixture {
  return {
    model,
    launcher,
    hook,
    token: address(seed),
    poolId: bytes32(seed),
    launchHash: bytes32(seed + 100),
    transactionHash: bytes32(seed + 200),
    launchBlock,
    liquidityBlock: launchBlock + 1,
    launchLogIndex: seed * 2,
    liquidityLogIndex: seed * 2 + 1,
  };
}

function launchEvent(fixture: ReleaseFixture) {
  const common = [
    abiArgument("token", fixture.token, "address"),
    abiArgument("poolId", fixture.poolId, "bytes32"),
    abiArgument("positionRecipient", address(800), "address"),
    abiArgument("positionTokenId", "42", "uint256"),
    abiArgument("launchHash", fixture.launchHash, "bytes32"),
  ];
  if (fixture.model === "classic-v2") {
    return eventRow(fixture, "MemeTokenLaunched", fixture.launchBlock,
      fixture.launchLogIndex, [
        abiArgument("creator", address(700), "address"),
        ...common,
        abiArgument("feeHook", fixture.hook, "address"),
        abiArgument("totalSwapFeeBps", "100", "uint16"),
      ]);
  }
  if (fixture.model === "classic-v3") {
    return eventRow(fixture, "MemeTokenLaunchedV2", fixture.launchBlock,
      fixture.launchLogIndex, [
        abiArgument("deployer", address(700), "address"),
        ...common,
        abiArgument("feeHook", fixture.hook, "address"),
        abiArgument("rewardVault", address(801), "address"),
        abiArgument("buySwapFeeBps", "100", "uint16"),
        abiArgument("sellSwapFeeBps", "150", "uint16"),
        abiArgument("rewardConfigurationHash", bytes32(600), "bytes32"),
      ]);
  }
  return eventRow(fixture, "StockPairedTokenLaunched", fixture.launchBlock,
    fixture.launchLogIndex, [
      abiArgument("deployer", address(850), "address"),
      ...common,
      abiArgument("quoteAsset", QUOTE, "address"),
      abiArgument("rewardVault", address(801), "address"),
    ]);
}

function liquidityEvent(fixture: ReleaseFixture) {
  const name = fixture.model === "classic-v2"
    ? "MemeLiquidityConfigured"
    : fixture.model === "classic-v3"
      ? "MemeLiquidityConfiguredV2"
      : "StockPairedLiquidityConfigured";
  return eventRow(fixture, name, fixture.liquidityBlock,
    fixture.liquidityLogIndex, [
      abiArgument("token", fixture.token, "address"),
      ...(fixture.model.startsWith("stock-paired")
        ? [abiArgument("quoteAsset", QUOTE, "address")]
        : []),
      abiArgument("totalSupply", "1000000000000000000000000", "uint256"),
      abiArgument("tokenLiquidityAmount", "900000000000000000000000", "uint256"),
      abiArgument("lockedTokenDust", "100000000000000000000000", "uint256"),
      abiArgument("initialTick", "-120", "int24"),
      abiArgument("tickLower", "-887220", "int24"),
      abiArgument("tickUpper", "887220", "int24"),
      abiArgument("lpFeePips", "0", "uint24"),
      abiArgument("launchHash", fixture.launchHash, "bytes32"),
    ]);
}

function eventRow(
  fixture: ReleaseFixture,
  name: string,
  block: number,
  logIndex: number,
  args: unknown[],
) {
  return {
    Block: {
      Number: String(block),
      Hash: bytes32(block),
      Time: new Date(block * 1_000).toISOString(),
    },
    Transaction: { Hash: fixture.transactionHash, Index: 7 },
    Log: {
      Index: logIndex,
      SmartContract: fixture.launcher,
      Signature: { Name: name, Signature: `${name}(...)` },
    },
    Arguments: args,
  };
}

function abiArgument(name: string, value: string, type: string) {
  const field = type === "address"
    ? "address"
    : type.startsWith("bytes")
      ? "hex"
      : type === "uint16" || type === "uint24" || type === "int24"
        ? "integer"
        : "bigInteger";
  return {
    Index: 0,
    Name: name,
    Type: type,
    Value: { [field]: field === "integer" ? Number(value) : value },
  };
}

function metadataResponse(releases: readonly ReleaseFixture[]) {
  return {
    data: {
      EVM: {
        transferMetadata: releases.flatMap((fixture) => [
          {
            Transfer: {
              Currency: currency(
                fixture.token,
                `Token ${fixture.token.slice(-4)}`,
                `T${fixture.token.slice(-3)}`,
                18,
              ),
            },
          },
          ...(fixture.model.startsWith("stock-paired")
            ? [{
                Transfer: {
                  Currency: currency(QUOTE, "USD Coin", "USDC", 6),
                },
              }]
            : []),
        ]),
        poolMetadata: releases.map((fixture) => ({
          Trade: {
            PoolId: fixture.poolId,
            Buy: { Currency: currency(
              fixture.token,
              `Token ${fixture.token.slice(-4)}`,
              `T${fixture.token.slice(-3)}`,
              18,
            ) },
            Sell: { Currency: fixture.model.startsWith("stock-paired")
              ? currency(QUOTE, "USD Coin", "USDC", 6)
              : currency(NATIVE_ETH, "Ether", "ETH", 18) },
          },
        })),
      },
      Trading: {
        tokenMetadata: [
          ...releases.map((fixture) => ({
            Token: {
              Address: fixture.token,
              Name: `Token ${fixture.token.slice(-4)}`,
              Symbol: `T${fixture.token.slice(-3)}`,
            },
            Supply: { TotalSupply: "1000000" },
          })),
          {
            Token: { Address: QUOTE, Name: "USD Coin", Symbol: "USDC" },
            Supply: { TotalSupply: "10000000000" },
          },
        ],
      },
    },
  };
}

function currency(addressValue: string, name: string, symbol: string, decimals: number) {
  return { SmartContract: addressValue, Name: name, Symbol: symbol, Decimals: decimals };
}

function sequencedFetch(payloads: readonly unknown[]): typeof fetch {
  let index = 0;
  return vi.fn(async () => jsonResponse(payloads[index++])) as typeof fetch;
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function address(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

function bytes32(value: number): `0x${string}` {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
