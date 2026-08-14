import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  MarketDataIdentityV1,
  TokenMarketDataV1,
} from "../lib/market-data/market-data-v1";
import type { CanonicalTokenExploreEntry } from "../lib/tokens";

const mocks = vi.hoisted(() => ({
  readBitqueryExploreEntriesV1: vi.fn(),
  readBitqueryTokenMarketDataStrictV1: vi.fn(),
  readProductionCustomExploreDirectoryV1: vi.fn(),
}));

vi.mock("../lib/market-data/bitquery-launches.server", () => ({
  readBitqueryExploreEntriesV1: mocks.readBitqueryExploreEntriesV1,
}));

vi.mock("../lib/market-data/bitquery.server", () => ({
  readBitqueryTokenMarketDataStrictV1:
    mocks.readBitqueryTokenMarketDataStrictV1,
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
  name: "Bitquery Token",
  symbol: "BITQ",
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

describe("Bitquery-only token detail API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBitqueryExploreEntriesV1.mockResolvedValue({
      source: "bitquery",
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

  it("serves launch identity and current market data exclusively from Bitquery", async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.readBitqueryExploreEntriesV1).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
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
      "bitquery",
    );
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("X-Programmable-Market-Source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("X-Programmable-Price-Source")).toBe(
      "bitquery",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBeNull();
  });

  it("does not make the optional Custom Registry a Bitquery availability gate", async () => {
    mocks.readProductionCustomExploreDirectoryV1.mockRejectedValue(
      new Error("registry unavailable"),
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
    ));

    expect(response.status).toBe(200);
    expect((await response.json()).token.tokenAddress).toBe(TOKEN_ADDRESS);
  });

  it("returns a definitive 404 from the Bitquery catalog without market reads", async () => {
    mocks.readBitqueryExploreEntriesV1.mockResolvedValue({
      source: "bitquery",
      entries: [],
      generatedAt: NOW.toISOString(),
      asOfBlock: "25800000",
    });

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${UNKNOWN_ADDRESS}`,
    ));

    expect(response.status).toBe(404);
    expect(mocks.readBitqueryTokenMarketDataStrictV1).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      token: null,
      customProject: null,
      snapshot: null,
    });
  });

  it("fails directly when Bitquery fails instead of using another provider", async () => {
    mocks.readBitqueryExploreEntriesV1.mockRejectedValue(
      new Error("bitquery unavailable"),
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token?address=${TOKEN_ADDRESS}`,
    ));

    expect(response.status).toBe(503);
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

  it.each([
    `address=${TOKEN_ADDRESS}&unused=random`,
    `address=${TOKEN_ADDRESS}&address=${UNKNOWN_ADDRESS}`,
    "address=not-an-address",
  ])("rejects invalid query shape before any provider read: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore/token?${query}`),
    );

    expect(response.status).toBe(400);
    expect(mocks.readBitqueryExploreEntriesV1).not.toHaveBeenCalled();
    expect(mocks.readProductionCustomExploreDirectoryV1).not.toHaveBeenCalled();
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
      "stateview-chainlink",
      "official-uniswap-v4-subgraph",
      "fallback:",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
