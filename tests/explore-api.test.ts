import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  MarketDataIdentityV1,
  TokenMarketDataV1,
} from "../lib/market-data/market-data-v1";
import type { ExploreEntry, LauncherToken } from "../lib/tokens";

const mocks = vi.hoisted(() => {
  class TestBitqueryMarketDataError extends Error {
    override name = "BitqueryMarketDataError";

    constructor(
      readonly category:
        | "configuration"
        | "transport"
        | "response"
        | "integrity",
      readonly phase = "unspecified",
    ) {
      super("Market data is temporarily unavailable");
    }
  }
  return {
    BitqueryMarketDataError: TestBitqueryMarketDataError,
    readPrimaryRpcExploreEntriesV1: vi.fn(),
    readBitqueryTokenFdvRankingStrictV1: vi.fn(),
    readBitqueryTokenMarketDataStrictV1: vi.fn(),
    safeBitqueryMarketDataError: vi.fn((error: unknown) =>
      error instanceof TestBitqueryMarketDataError
        ? {
            name: error.name,
            category: error.category,
            phase: error.phase,
          }
        : {
            name: "MarketDataError",
            category: "unexpected",
            phase: "unspecified",
          }
    ),
  };
});

vi.mock("../lib/market-data/primary-rpc-launches.server", () => ({
  readPrimaryRpcExploreEntriesV1: mocks.readPrimaryRpcExploreEntriesV1,
  safePrimaryRpcLaunchCatalogError: vi.fn(() => ({
    name: "PrimaryRpcLaunchCatalogError",
    category: "transport",
  })),
}));

vi.mock("../lib/market-data/bitquery.server", () => ({
  BitqueryMarketDataError: mocks.BitqueryMarketDataError,
  readBitqueryTokenFdvRankingStrictV1:
    mocks.readBitqueryTokenFdvRankingStrictV1,
  readBitqueryTokenMarketDataStrictV1:
    mocks.readBitqueryTokenMarketDataStrictV1,
  safeBitqueryMarketDataError: mocks.safeBitqueryMarketDataError,
}));

import { GET } from "../app/api/explore/route";

const HOOK_ADDRESS =
  "0x3333333333333333333333333333333333333333" as const;
const NATIVE_ETH =
  "0x0000000000000000000000000000000000000000" as const;
const NOW = "2026-08-14T00:00:00.000Z";

function token(index: number): ExploreEntry {
  const tokenAddress = `0x${index.toString(16).padStart(40, "0")}` as const;
  const value = {
    id: `1:${tokenAddress}`,
    name: index === 7 ? "Focused Launch" : `Token ${index}`,
    symbol: index === 7 ? "FOCUS" : `T${index}`,
    tokenAddress,
    hookAddress: HOOK_ADDRESS,
    poolId: `0x${index.toString(16).padStart(64, "0")}` as const,
    launchedAt: new Date(Date.parse(NOW) + index * 1_000).toISOString(),
    launchBlockNumber: String(25_626_490 + index),
    launchTransactionIndex: 0,
    launchLogIndex: index,
    totalSupply: "1000000",
    totalSupplyRaw: "1000000000000000000000000",
    tokenDecimals: 18,
    totalSwapFeeBps: 100,
    liquidityPath: "meme",
    launchModel: "classic",
    launchModelVersion: "classic-v3",
    links: index % 2 === 0
      ? [{ kind: "x", url: `https://x.com/token${index}` }]
      : [],
  } satisfies LauncherToken;
  return {
    ...value,
    exploreKind: "token",
    launchCategoryProvenance: {
      schemaVersion: "programmable.explore-launch-category-provenance.v1",
      category: "classic",
      source: "canonical-launch-read-model",
      recordId: value.id,
      modelId: "classic",
      modelVersion: "classic-v3",
    },
  };
}

function marketData(
  identities: readonly MarketDataIdentityV1[],
): ReadonlyMap<string, TokenMarketDataV1> {
  return new Map(identities.map((identity) => {
    const index = Number(BigInt(identity.tokenAddress));
    const priceUsdWad = (BigInt(index) * 10n ** 12n).toString();
    return [identity.tokenAddress, {
      schemaVersion: "programmable.market-data.v1",
      source: "bitquery",
      generatedAt: NOW,
      status: "current",
      primaryPoolId: identity.poolId,
      pools: [{
        identity,
        source: "bitquery",
        status: "current",
        quality: "complete",
        asOfTime: NOW,
        latestTrade: {
          transactionHash: `0x${index.toString(16).padStart(64, "0")}`,
          logIndex: 1,
          blockNumber: "25740000",
          time: NOW,
          tokenSide: "buy",
          priceUsdWad,
          priceUsdAsOfTime: NOW,
          priceUsdSource: "bitquery-token-price-index-v1",
          rawPriceUsdWad: priceUsdWad,
          quoteAddress: NATIVE_ETH,
          quoteSymbol: "ETH",
        },
        liquidity: {
          asOfTime: NOW,
          asOfBlock: "25740000",
          valueUsdWad: "100000000000000000000000",
          freshness: "current",
        },
        valuation: {
          status: "available",
          metric: "fdv",
          supplyBasis: "total",
          valueUsdWad: (BigInt(index) * 10n ** 18n).toString(),
          fdvUsdWad: (BigInt(index) * 10n ** 18n).toString(),
          totalSupply: "1000000",
          asOfTime: NOW,
          freshness: "current",
        },
      }],
    } satisfies TokenMarketDataV1];
  }));
}

function request(query = "") {
  return new NextRequest(`http://localhost/api/explore${query ? `?${query}` : ""}`);
}

async function json(response: Response) {
  return await response.json() as Record<string, unknown>;
}

describe("Explore API strict dRPC identity and Bitquery market contract", () => {
  const entries = Array.from({ length: 12 }, (_, index) => token(index + 1));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readPrimaryRpcExploreEntriesV1.mockResolvedValue({
      source: "drpc",
      entries,
      generatedAt: NOW,
      asOfBlock: "25740000",
    });
    mocks.readBitqueryTokenMarketDataStrictV1.mockImplementation(
      async (identities: readonly MarketDataIdentityV1[]) =>
        marketData(identities),
    );
    mocks.readBitqueryTokenFdvRankingStrictV1.mockImplementation(
      async (identities: readonly MarketDataIdentityV1[]) =>
        marketData(identities),
    );
  });

  it("serves dRPC launch identity with current Bitquery FDV", async () => {
    const response = await GET(request("sort=highest-market-cap&page=1&limit=5"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      page: 1,
      pageSize: 5,
      total: 12,
      totalPages: 3,
      sort: "market-cap",
      sortMetric: "fdv",
      snapshot: null,
    });
    expect(body).not.toHaveProperty("valuationSnapshot");
    expect((body.tokens as ExploreEntry[]).map((entry) => entry.id)).toEqual(
      [12, 11, 10, 9, 8].map((index) => entries[index - 1]!.id),
    );
    expect(body.tokens).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fdvUsdWad: expect.any(String),
        valuation: expect.objectContaining({ source: "bitquery" }),
      }),
    ]));
    expect(response.headers.get("x-programmable-launch-source")).toBe("drpc");
    expect(response.headers.get("x-programmable-read-source")).toBe("drpc+bitquery");
    expect(response.headers.get("x-programmable-market-source")).toBe("bitquery");
    expect(response.headers.get("x-programmable-price-source")).toBe("bitquery");
    expect(response.headers.get("x-programmable-market-read-status")).toBe(
      "current",
    );
    expect(response.headers.get("x-programmable-market-provider")).toBe(
      "bitquery",
    );
    expect([...response.headers.entries()].join(" ").toLowerCase()).not.toMatch(
      /quicknode|alchemy|stateview|chainlink|subgraph|snapshot/u,
    );
    expect(mocks.readPrimaryRpcExploreEntriesV1).toHaveBeenCalledOnce();
    expect(mocks.readBitqueryTokenFdvRankingStrictV1).toHaveBeenCalledOnce();
    expect(mocks.readBitqueryTokenFdvRankingStrictV1).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.readBitqueryTokenMarketDataStrictV1).not.toHaveBeenCalled();
  });

  it("sorts the lowest-FDV alias directly from Bitquery", async () => {
    const response = await GET(request("sort=lowest-market-cap&page=1&limit=4"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.sort).toBe("market-cap-asc");
    expect((body.tokens as ExploreEntry[]).map((entry) => entry.id)).toEqual(
      [1, 2, 3, 4].map((index) => entries[index - 1]!.id),
    );
    expect(mocks.readBitqueryTokenFdvRankingStrictV1).toHaveBeenCalledOnce();
    expect(
      mocks.readBitqueryTokenFdvRankingStrictV1.mock.calls[0]?.[0],
    ).toHaveLength(entries.length);
    expect(mocks.readBitqueryTokenMarketDataStrictV1).not.toHaveBeenCalled();
  });

  it("sorts newest launches without a valuation snapshot", async () => {
    const response = await GET(request("sort=newest&page=1&limit=3"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty("valuationSnapshot");
    expect((body.tokens as ExploreEntry[]).map((entry) => entry.id)).toEqual(
      [12, 11, 10].map((index) => entries[index - 1]!.id),
    );
    expect(mocks.readBitqueryTokenMarketDataStrictV1).toHaveBeenCalledOnce();
    expect(
      mocks.readBitqueryTokenMarketDataStrictV1.mock.calls[0]?.[0],
    ).toHaveLength(3);
    expect(mocks.readBitqueryTokenFdvRankingStrictV1).not.toHaveBeenCalled();
  });

  it("applies search, social filtering, and direct pagination", async () => {
    const focused = await GET(request("q=focus&sort=newest&page=1&limit=9"));
    const focusedBody = await json(focused);
    expect(focusedBody).toMatchObject({ total: 1, totalPages: 1 });
    expect((focusedBody.tokens as ExploreEntry[])[0]?.id).toBe(entries[6]!.id);
    expect(
      mocks.readBitqueryTokenMarketDataStrictV1.mock.calls[0]?.[0],
    ).toHaveLength(1);

    const socialPage = await GET(
      request("socials=yes&sort=oldest&page=2&limit=2"),
    );
    const socialBody = await json(socialPage);
    expect(socialBody).toMatchObject({ page: 2, pageSize: 2, total: 6, totalPages: 3 });
    expect((socialBody.tokens as ExploreEntry[]).map((entry) => entry.id)).toEqual([
      entries[5]!.id,
      entries[7]!.id,
    ]);
    expect(
      mocks.readBitqueryTokenMarketDataStrictV1.mock.calls[1]?.[0],
    ).toHaveLength(2);
  });

  it.each([
    "unknown=value",
    "valuationBlock=25740000",
    "page=0",
    "limit=abc",
    "q=a&q=b",
    "socials=maybe",
  ])("rejects unsupported query shape: %s", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.readPrimaryRpcExploreEntriesV1).not.toHaveBeenCalled();
  });

  it("returns 503 directly when the primary dRPC launch catalog fails", async () => {
    mocks.readPrimaryRpcExploreEntriesV1.mockRejectedValueOnce(
      new Error("catalog unavailable"),
    );

    const response = await GET(request("sort=newest"));
    expect(response.status).toBe(503);
    expect(await json(response)).toEqual({
      error: "Token data is temporarily unavailable",
    });
    expect(response.headers.get("x-programmable-launch-source")).toBe("drpc");
    expect(response.headers.get("x-programmable-market-source")).toBe("bitquery");
    expect(mocks.readBitqueryTokenMarketDataStrictV1).not.toHaveBeenCalled();
  });

  it("returns 503 directly when the strict Bitquery market read fails", async () => {
    mocks.readBitqueryTokenFdvRankingStrictV1.mockRejectedValueOnce(
      new Error("market unavailable"),
    );

    const response = await GET(request("sort=market-cap"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    expect(await json(response)).toEqual({
      error: "Token data is temporarily unavailable",
    });
  });

  it.each(["market-cap", "market-cap-asc"] as const)(
    "serves verified launches in launch order when %s market transport fails",
    async (sort) => {
      mocks.readBitqueryTokenFdvRankingStrictV1.mockRejectedValueOnce(
        new mocks.BitqueryMarketDataError("transport", "market-core"),
      );

      const response = await GET(request(`sort=${sort}&page=1&limit=9`));
      const body = await json(response);
      const tokens = body.tokens as Array<ExploreEntry & {
        valuation: { status: string; reason?: string };
      }>;

      expect(response.status).toBe(200);
      expect(body).toMatchObject({
        status: "ready",
        sort,
        marketRead: {
          provider: "bitquery",
          status: "unavailable",
          category: "transport",
          phase: "market-core",
        },
        ranking: {
          status: "unavailable",
          requested: "fdv",
          applied: "launch-order",
        },
        dataQuality: {
          status: "partial",
          launchIdentity: { status: "current" },
          valuation: {
            status: "unavailable",
            metric: "fdv",
            available: 0,
            unavailable: 9,
          },
        },
      });
      expect(tokens.map((entry) => entry.id)).toEqual(
        [12, 11, 10, 9, 8, 7, 6, 5, 4].map(
          (index) => entries[index - 1]!.id,
        ),
      );
      expect(tokens.every((entry) =>
        entry.valuation.status === "unavailable" &&
        entry.valuation.reason === "source-unavailable"
      )).toBe(true);
      expect(tokens.every((entry) =>
        !("fdvUsdWad" in entry) && !("marketData" in entry)
      )).toBe(true);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-programmable-data-quality")).toBe(
        "partial",
      );
      expect(response.headers.get("x-programmable-launch-source")).toBe("drpc");
      expect(response.headers.get("x-programmable-read-source")).toBe("drpc");
      expect(response.headers.get("x-programmable-market-read-status")).toBe(
        "transport-unavailable",
      );
      expect(response.headers.get("x-programmable-market-provider")).toBe(
        "bitquery",
      );
      expect(response.headers.get("x-programmable-market-source")).toBeNull();
      expect(response.headers.get("x-programmable-price-source")).toBeNull();
    },
  );

  it("serves the Newest identity page when the Bitquery price transport fails", async () => {
    mocks.readBitqueryTokenMarketDataStrictV1.mockRejectedValueOnce(
      new mocks.BitqueryMarketDataError("transport", "market-price"),
    );

    const response = await GET(request("sort=newest&page=1&limit=3"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ready",
      sort: "newest",
      marketRead: {
        provider: "bitquery",
        status: "unavailable",
        category: "transport",
        phase: "market-price",
      },
      dataQuality: {
        status: "partial",
        launchIdentity: { status: "current" },
        valuation: { status: "unavailable", available: 0, unavailable: 3 },
      },
    });
    expect(body).not.toHaveProperty("ranking");
    expect((body.tokens as ExploreEntry[]).map((entry) => entry.id)).toEqual(
      [12, 11, 10].map((index) => entries[index - 1]!.id),
    );
    expect((body.tokens as ExploreEntry[]).every((entry) =>
      !("fdvUsdWad" in entry) && !("marketData" in entry)
    )).toBe(true);
    expect(response.headers.get("x-programmable-read-source")).toBe("drpc");
    expect(response.headers.get("x-programmable-market-source")).toBeNull();
    expect(response.headers.get("x-programmable-price-source")).toBeNull();
  });

  it.each([
    ["configuration", "configuration"],
    ["response", "market-core"],
    ["integrity", "market-core"],
    ["transport", "market-liquidity"],
    ["transport", "market-stats"],
  ] as const)(
    "keeps Bitquery %s/%s failures fail-closed",
    async (category, phase) => {
      mocks.readBitqueryTokenFdvRankingStrictV1.mockRejectedValueOnce(
        new mocks.BitqueryMarketDataError(category, phase),
      );

      const response = await GET(request("sort=market-cap"));
      expect(response.status).toBe(503);
      expect(response.headers.get("x-programmable-market-read-status")).toBeNull();
      expect(await json(response)).toEqual({
        error: "Token data is temporarily unavailable",
      });
    },
  );

  it("does not degrade a transport failure without launch identities", async () => {
    mocks.readPrimaryRpcExploreEntriesV1.mockResolvedValueOnce({
      source: "drpc",
      entries: [],
      generatedAt: NOW,
      asOfBlock: "25740000",
    });
    mocks.readBitqueryTokenFdvRankingStrictV1.mockRejectedValueOnce(
      new mocks.BitqueryMarketDataError("transport", "market-core"),
    );

    const response = await GET(request("sort=market-cap"));
    expect(response.status).toBe(503);
  });

  it("does not degrade a transport failure after the request is aborted", async () => {
    mocks.readBitqueryTokenFdvRankingStrictV1.mockRejectedValueOnce(
      new mocks.BitqueryMarketDataError("transport", "market-core"),
    );
    const controller = new AbortController();
    controller.abort();
    const abortedRequest = new NextRequest(
      "http://localhost/api/explore?sort=market-cap",
      { signal: controller.signal },
    );

    const response = await GET(abortedRequest);
    expect(response.status).toBe(503);
    expect(response.headers.get("x-programmable-market-read-status")).toBeNull();
  });

  it("keeps a missing ranked market unavailable without misranking it", async () => {
    mocks.readBitqueryTokenFdvRankingStrictV1.mockImplementationOnce(
      async (identities: readonly MarketDataIdentityV1[]) =>
        marketData(identities.slice(0, 1)),
    );
    const response = await GET(request("sort=market-cap"));
    const body = await json(response);
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ total: 12, sort: "market-cap" });
    const tokens = body.tokens as Array<ExploreEntry & {
      valuation?: { status?: string };
    }>;
    expect(tokens.map((entry) => entry.id)).toEqual(
      [1, 12, 11, 10, 9, 8, 7, 6, 5].map(
        (index) => entries[index - 1]!.id,
      ),
    );
    expect(tokens[0]?.valuation?.status).toBe("available");
    expect(tokens.slice(1).every(
      (entry) => entry.valuation?.status === "unavailable",
    )).toBe(true);
    expect(response.headers.get("x-programmable-launch-source")).toBe("drpc");
    expect(response.headers.get("x-programmable-market-source")).toBe("bitquery");
  });

  it("contains no historical Bitquery launch discovery or identity fallback", () => {
    for (const relative of [
      "../app/api/explore/route.ts",
      "../app/api/explore/token/route.ts",
      "../app/api/explore/token/chart/route.ts",
    ]) {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(source).toContain("readPrimaryRpcExploreEntriesV1");
      expect(source).not.toContain("readBitqueryExploreEntriesV1");
      expect(source).not.toContain("bitquery-launches.server");
      if (!relative.endsWith("/token/route.ts")) {
        expect(source).not.toContain("readProductionCustomExploreDirectoryV1");
      }
    }
  });
});
