import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  MarketDataIdentityV1,
  TokenMarketDataV1,
} from "../lib/market-data/market-data-v1";
import type {
  CanonicalTokenExploreEntry,
  CustomProjectExploreEntry,
} from "../lib/tokens";

const mocks = vi.hoisted(() => ({
  readPrimaryRpcExploreEntriesV1: vi.fn(),
  readBitqueryTokenMarketDataStrictV1: vi.fn(),
  readProductionCustomExploreDirectoryV1: vi.fn(),
}));

vi.mock("../lib/market-data/primary-rpc-launches.server", () => ({
  readPrimaryRpcExploreEntriesV1: mocks.readPrimaryRpcExploreEntriesV1,
  safePrimaryRpcLaunchCatalogError: vi.fn(() => ({
    name: "PrimaryRpcLaunchCatalogError",
    category: "transport",
  })),
}));

vi.mock("../lib/market-data/bitquery.server", () => ({
  BitqueryMarketDataError: class BitqueryMarketDataError extends Error {
    category: string;
    constructor(category: string) {
      super("Market data is temporarily unavailable");
      this.category = category;
    }
  },
  readBitqueryTokenMarketDataStrictV1:
    mocks.readBitqueryTokenMarketDataStrictV1,
  safeBitqueryMarketDataError: vi.fn(() => ({
    name: "BitqueryMarketDataError",
    category: "transport",
  })),
}));

vi.mock("../lib/server/custom-launch/explore-directory-v1", () => ({
  readProductionCustomExploreDirectoryV1:
    mocks.readProductionCustomExploreDirectoryV1,
}));

import { GET } from "../app/api/explore/token/route";

const TOKEN_ADDRESS =
  "0x1111111111111111111111111111111111111111" as const;
const UNKNOWN_ADDRESS =
  "0x2222222222222222222222222222222222222222" as const;
const HOOK_ADDRESS =
  "0x3333333333333333333333333333333333333333" as const;
const POOL_ID = `0x${"44".repeat(32)}` as const;
const NOW = new Date("2026-08-14T12:00:00.000Z");

const canonicalEntry = {
  exploreKind: "token",
  id: `1:${TOKEN_ADDRESS}`,
  name: "dRPC Token",
  symbol: "DRPC",
  tokenAddress: TOKEN_ADDRESS,
  hookAddress: HOOK_ADDRESS,
  poolId: POOL_ID,
  launchedAt: "2026-08-14T10:00:00.000Z",
  totalSupplyRaw: "1000000000000000000000000",
  tokenDecimals: 18,
  totalSwapFeeBps: 100,
  launchModel: "classic",
  liquidityPath: "meme",
  launchCategoryProvenance: {
    schemaVersion: "programmable.explore-launch-category-provenance.v1",
    category: "classic",
    source: "canonical-launch-read-model",
    recordId: `1:${TOKEN_ADDRESS}`,
    modelId: "classic",
    modelVersion: null,
  },
} as const satisfies CanonicalTokenExploreEntry;

const customEntry = {
  exploreKind: "custom-project",
  id: `custom:sha256:${"55".repeat(32)}`,
  name: "Custom Project",
  symbol: "CUSTOM",
  links: [],
  launchedAt: "2026-08-14T09:00:00.000Z",
  finalizedAt: "2026-08-14T09:05:00.000Z",
  chainId: "1",
  modelId: "custom-model",
  customProjectId: `sha256:${"55".repeat(32)}`,
  customLaunchId: `sha256:${"66".repeat(32)}`,
  launchingWallet: { namespace: "eip155:1", value: HOOK_ADDRESS },
  postLaunchAuthorityInventory: {},
  postLaunchAuthorityInventoryHash: `sha256:${"77".repeat(32)}`,
  tokenAddress: UNKNOWN_ADDRESS,
  tokenDecimals: 18,
  markets: [],
  launchCategoryProvenance: {},
} as unknown as CustomProjectExploreEntry;

function bitqueryMarketData(
  identities: readonly MarketDataIdentityV1[],
): ReadonlyMap<string, TokenMarketDataV1> {
  return new Map(identities.map((identity) => [identity.tokenAddress, {
    schemaVersion: "programmable.market-data.v1",
    source: "bitquery",
    generatedAt: NOW.toISOString(),
    status: "current",
    primaryPoolId: identity.poolId,
    pools: [{
      identity,
      source: "bitquery",
      status: "current",
      quality: "complete",
      asOfTime: NOW.toISOString(),
      latestTrade: {
        transactionHash: `0x${"aa".repeat(32)}`,
        logIndex: 1,
        blockNumber: "25800000",
        time: NOW.toISOString(),
        tokenSide: "buy",
        priceUsdWad: "1000000000000000000",
        priceUsdAsOfTime: NOW.toISOString(),
        priceUsdSource: "bitquery-token-price-index-v1",
        rawPriceUsdWad: "1000000000000000000",
      },
      liquidity: {
        asOfTime: NOW.toISOString(),
        asOfBlock: "25800000",
        valueUsdWad: "100000000000000000000000",
        freshness: "current",
      },
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        valueUsdWad: "1000000000000000000000000",
        fdvUsdWad: "1000000000000000000000000",
        totalSupply: "1000000",
        asOfTime: NOW.toISOString(),
        freshness: "current",
      },
    }],
  } satisfies TokenMarketDataV1]));
}

describe("dRPC identity and Bitquery market token detail API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readPrimaryRpcExploreEntriesV1.mockResolvedValue({
      source: "drpc",
      entries: [canonicalEntry],
      generatedAt: NOW.toISOString(),
      asOfBlock: "25800000",
    });
    mocks.readProductionCustomExploreDirectoryV1.mockResolvedValue([]);
    mocks.readBitqueryTokenMarketDataStrictV1.mockImplementation(
      async (identities: readonly MarketDataIdentityV1[]) =>
        bitqueryMarketData(identities),
    );
  });

  it("serves dRPC launch identity with current Bitquery market data", async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.readPrimaryRpcExploreEntriesV1).toHaveBeenCalledWith({
      requestedTokenAddress: TOKEN_ADDRESS,
      signal: expect.any(AbortSignal),
    });
    expect(mocks.readProductionCustomExploreDirectoryV1).not.toHaveBeenCalled();
    expect(mocks.readBitqueryTokenMarketDataStrictV1).toHaveBeenCalledWith(
      [{
        chainId: "1",
        tokenAddress: TOKEN_ADDRESS,
        poolId: POOL_ID,
        quoteAddress: "0x0000000000000000000000000000000000000000",
        protocol: "uniswap_v4",
      }],
      { signal: expect.any(AbortSignal) },
    );
    expect(body).toMatchObject({
      status: "ready",
      token: {
        tokenAddress: TOKEN_ADDRESS,
        valuation: {
          status: "available",
          metric: "fdv",
          currency: "usd",
          source: "bitquery",
          valueWad: "1000000000000000000000000",
        },
      },
      customProject: null,
      snapshot: { chainId: 1 },
    });
    expect(body).not.toHaveProperty("dataQuality");
    expect(body).not.toHaveProperty("launchDiscoverySnapshot");
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "drpc",
    );
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "drpc+bitquery",
    );
    expect(response.headers.get("X-Programmable-Market-Source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBeNull();
  });

  it("returns a definitive 404 from the dRPC catalog without market reads", async () => {
    mocks.readPrimaryRpcExploreEntriesV1.mockResolvedValue({
      source: "drpc",
      entries: [],
      generatedAt: NOW.toISOString(),
      asOfBlock: "25800000",
    });

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${UNKNOWN_ADDRESS}`,
    ));

    expect(response.status).toBe(404);
    expect(mocks.readProductionCustomExploreDirectoryV1).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    );
    expect(mocks.readBitqueryTokenMarketDataStrictV1).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      token: null,
      customProject: null,
      snapshot: null,
    });
  });

  it("serves a Custom Registry project only after a successful canonical miss", async () => {
    mocks.readPrimaryRpcExploreEntriesV1.mockResolvedValue({
      source: "drpc",
      entries: [],
      generatedAt: NOW.toISOString(),
      asOfBlock: "25800000",
    });
    mocks.readProductionCustomExploreDirectoryV1.mockResolvedValue([
      customEntry,
    ]);

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${UNKNOWN_ADDRESS}`,
    ));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      token: null,
      customProject: {
        tokenAddress: UNKNOWN_ADDRESS,
        valuation: { status: "unavailable", reason: "no-market" },
      },
      snapshot: null,
    });
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "registry.custom-launched",
    );
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "drpc+registry.custom-launched",
    );
    expect(response.headers.get("X-Programmable-Market-Source")).toBeNull();
    expect(mocks.readBitqueryTokenMarketDataStrictV1).not.toHaveBeenCalled();
  });

  it("fails closed when the Custom Registry read fails after a canonical miss", async () => {
    mocks.readPrimaryRpcExploreEntriesV1.mockResolvedValue({
      source: "drpc",
      entries: [],
      generatedAt: NOW.toISOString(),
      asOfBlock: "25800000",
    });
    mocks.readProductionCustomExploreDirectoryV1.mockRejectedValue(
      new Error("registry unavailable"),
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${UNKNOWN_ADDRESS}`,
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get("X-Programmable-Launch-Source")).toBe(
      "registry.custom-launched",
    );
    expect(response.headers.get("X-Programmable-Market-Source")).toBeNull();
    expect(mocks.readBitqueryTokenMarketDataStrictV1).not.toHaveBeenCalled();
  });

  it("fails directly when primary dRPC identity fails", async () => {
    mocks.readPrimaryRpcExploreEntriesV1.mockRejectedValue(
      new Error("drpc unavailable"),
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
    ));

    expect(response.status).toBe(503);
    expect(mocks.readProductionCustomExploreDirectoryV1).not.toHaveBeenCalled();
    expect(mocks.readBitqueryTokenMarketDataStrictV1).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("fails directly when the strict Bitquery market read fails", async () => {
    mocks.readBitqueryTokenMarketDataStrictV1.mockRejectedValue(
      new Error("bitquery market unavailable"),
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
    ));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("fails when Bitquery omits the required dRPC token market", async () => {
    mocks.readBitqueryTokenMarketDataStrictV1.mockResolvedValue(new Map());
    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
    ));
    expect(response.status).toBe(503);
  });

  it.each([
    `address=${TOKEN_ADDRESS}&unused=random`,
    `address=${TOKEN_ADDRESS}&address=${UNKNOWN_ADDRESS}`,
    "address=not-an-address",
  ])("rejects invalid query shape before any provider read: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore/token?${query}`),
    );

    expect(response.status).toBe(400);
    expect(mocks.readPrimaryRpcExploreEntriesV1).not.toHaveBeenCalled();
    expect(mocks.readBitqueryTokenMarketDataStrictV1).not.toHaveBeenCalled();
  });

  it("contains no legacy public-read provider or fallback wiring", () => {
    const source = readFileSync(
      new URL("../app/api/explore/token/route.ts", import.meta.url),
      "utf8",
    );

    for (const forbidden of [
      "readAlchemyExploreModel",
      "readDurableExploreModel",
      "readVerifiedOperationalMarketSnapshot",
      "currentMarketOnchainDeployment",
      "hydrateMissingCanonicalTokenSupplyV1",
      "readExploreReferenceHeadWithinRouteBudget",
      "valueExploreEntriesWithCurrentEvidence",
      "readBitqueryExploreEntriesV1",
      "stateview-chainlink",
      "official-uniswap-v4-subgraph",
      "fallback:",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain("readPrimaryRpcExploreEntriesV1");
    expect(source).toContain("readProductionCustomExploreDirectoryV1");
  });
});
