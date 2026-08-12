import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  MarketChartV1,
  MarketDataIdentityV1,
  TokenMarketDataV1,
} from "../lib/market-data/market-data-v1";
import { customGraphToken } from "./launch-stamp-surface-fixture";

const mocks = vi.hoisted(() => ({
  getOnchainDeployment: vi.fn(),
  isTokenChartRange: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
  readBitqueryMarketChartV1: vi.fn(),
  readBitqueryTokenMarketDataV1: vi.fn(),
  hydrateMissingCanonicalTokenSupplyV1: vi.fn(),
  readDurableExploreModel: vi.fn(),
  readProductionCustomExploreDirectoryV1: vi.fn(),
  safeAlchemyError: vi.fn((error) => error),
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  safeAlchemyError: mocks.safeAlchemyError,
}));

vi.mock("../lib/market-data/bitquery.server", () => ({
  readBitqueryMarketChartV1: mocks.readBitqueryMarketChartV1,
  readBitqueryTokenMarketDataV1: mocks.readBitqueryTokenMarketDataV1,
}));

vi.mock("../lib/market-data/canonical-token-supply.server", () => ({
  hydrateMissingCanonicalTokenSupplyV1:
    mocks.hydrateMissingCanonicalTokenSupplyV1,
}));

vi.mock("../lib/onchain/chart", () => ({
  isTokenChartRange: mocks.isTokenChartRange,
}));

vi.mock("../lib/onchain/config", () => ({
  getOnchainDeployment: mocks.getOnchainDeployment,
}));

vi.mock("../lib/onchain/durable-model", () => ({
  readDurableExploreModel: mocks.readDurableExploreModel,
}));

vi.mock("../lib/server/custom-launch/explore-directory-v1", () => ({
  readProductionCustomExploreDirectoryV1:
    mocks.readProductionCustomExploreDirectoryV1,
}));

import { GET } from "../app/api/explore/token/chart/route";

const token = {
  id: "1:test",
  name: "Test",
  symbol: "TEST",
  tokenAddress: "0x1111111111111111111111111111111111111111",
  hookAddress: "0x2222222222222222222222222222222222222222",
  poolId: `0x${"33".repeat(32)}`,
  launchedAt: "2026-07-29T00:00:00.000Z",
  totalSupplyRaw: "1000000000000000000000000",
  tokenDecimals: 18,
  totalSwapFeeBps: 100,
  liquidityPath: "meme",
} as const;

const identity = {
  chainId: "1",
  tokenAddress: token.tokenAddress,
  poolId: token.poolId,
  protocol: "uniswap_v4",
} as const satisfies MarketDataIdentityV1;

const snapshot = {
  chainId: 1,
  blockNumber: "25630000",
  blockHash: `0x${"44".repeat(32)}`,
  confirmations: 12,
} as const;
const launchDiscoverySnapshot = {
  ...snapshot,
  blockNumber: "25630005",
  blockHash: `0x${"55".repeat(32)}`,
} as const;

function tokenMarketData(
  marketIdentity: MarketDataIdentityV1 = identity,
): TokenMarketDataV1 {
  return {
    schemaVersion: "programmable.market-data.v1",
    source: "bitquery",
    generatedAt: "2026-08-11T14:02:00.000Z",
    status: "current",
    primaryPoolId: marketIdentity.poolId,
    pools: [{
      identity: marketIdentity,
      source: "bitquery",
      status: "current",
      quality: "complete",
      asOfTime: "2026-08-11T14:02:00.000Z",
      latestTrade: {
        transactionHash: `0x${"66".repeat(32)}`,
        logIndex: 1,
        blockNumber: "25740002",
        time: "2026-08-11T14:02:00.000Z",
        tokenSide: "buy",
        priceUsdWad: "2000000000000000000",
        priceUsdAsOfTime: "2026-08-11T14:02:00.000Z",
        priceUsdSource: "bitquery-token-price-index-v1",
        rawPriceUsdWad: "2000000000000000000",
      },
      liquidity: {
        asOfTime: "2026-08-11T14:02:00.000Z",
        asOfBlock: "25740002",
        valueUsdWad: "20000000000000000000000",
        freshness: "current",
      },
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        valueUsdWad: "2000000000000000000000000",
        fdvUsdWad: "2000000000000000000000000",
        totalSupply: "1000000",
        asOfTime: "2026-08-11T14:02:00.000Z",
        freshness: "current",
      },
    }],
  };
}

function chart(
  overrides: Partial<MarketChartV1> = {},
  marketIdentity: MarketDataIdentityV1 = identity,
): MarketChartV1 {
  return {
    schemaVersion: "programmable.market-chart.v1",
    source: "bitquery",
    readStatus: "live",
    status: "ready",
    generatedAt: "2026-08-11T14:02:00.000Z",
    identity: marketIdentity,
    range: "all",
    points: [
      {
        blockNumber: "25740001",
        time: "2026-08-11T14:01:00.000Z",
        bucketStart: "2026-08-11T14:00:00.000Z",
        bucketEnd: "2026-08-11T14:01:00.000Z",
        observedAt: "2026-08-11T14:00:59.000Z",
        valueSemantics: "period-median",
        priceUsd: "1.5",
        volumeUsdWad: "150000000000000000000",
        tradeCount: 3,
      },
      {
        blockNumber: "25740002",
        time: "2026-08-11T14:02:00.000Z",
        bucketStart: "2026-08-11T14:01:00.000Z",
        bucketEnd: "2026-08-11T14:02:00.000Z",
        observedAt: "2026-08-11T14:01:59.000Z",
        valueSemantics: "period-median",
        priceUsd: "2",
        volumeUsdWad: "250000000000000000000",
        tradeCount: 4,
      },
    ],
    swapCount: 7,
    volumeUsdWad: "400000000000000000000",
    valuation: {
      status: "available",
      metric: "fdv",
      supplyBasis: "total",
      valueUsdWad: "2000000000000000000000000",
      fdvUsdWad: "2000000000000000000000000",
      totalSupply: "1000000",
      asOfTime: "2026-08-11T14:02:00.000Z",
      freshness: "current",
    },
    asOfTime: "2026-08-11T14:01:59.000Z",
    truncated: false,
    ...overrides,
  };
}

describe("token chart Bitquery API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTokenChartRange.mockImplementation((range) =>
      ["1h", "1d", "1w", "all"].includes(range),
    );
    mocks.getOnchainDeployment.mockReturnValue({ status: "ready" });
    mocks.readAlchemyExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [token],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    });
    mocks.readProductionCustomExploreDirectoryV1.mockResolvedValue([]);
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "unavailable",
      reason: "missing",
      detail: "No durable index snapshot exists",
    });
    mocks.readBitqueryTokenMarketDataV1.mockResolvedValue(
      new Map([[token.tokenAddress, tokenMarketData()]]),
    );
    mocks.readBitqueryMarketChartV1.mockResolvedValue(chart());
    mocks.hydrateMissingCanonicalTokenSupplyV1.mockImplementation(
      async (entries) => entries,
    );
  });

  it("forwards the exact v4 identity and selected range to Bitquery", async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${token.tokenAddress}&range=1h`,
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.readBitqueryTokenMarketDataV1).toHaveBeenCalledWith(
      [identity],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.readBitqueryMarketChartV1).toHaveBeenCalledWith(
      expect.objectContaining({
        identity,
        range: "1h",
        historyStart: token.launchedAt,
        valuation: { status: "unavailable", reason: "source-unavailable" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(body).toMatchObject({
      schemaVersion: "programmable.market-chart.v1",
      source: "bitquery",
      status: "ready",
      address: token.tokenAddress,
      fdvUsdWad: "2000000000000000000000000",
      valuationMetric: "fdv",
      points: [
        { priceUsd: "1.5", tradeCount: 3 },
        { priceUsd: "2", tradeCount: 4 },
      ],
    });
    expect(response.headers.get("X-Programmable-Market-Source")).toBe("bitquery");
    expect(response.headers.get("X-Programmable-Price-Source")).toBe("bitquery");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
    );
  });

  it("briefly reuses authoritative current one-point history", async () => {
    mocks.readBitqueryMarketChartV1.mockResolvedValue(chart({
      status: "insufficient-history",
      points: [{
        blockNumber: "25740002",
        time: "2026-08-11T14:02:00.000Z",
        bucketStart: "2026-08-11T14:01:00.000Z",
        bucketEnd: "2026-08-11T14:02:00.000Z",
        observedAt: "2026-08-11T14:01:59.000Z",
        valueSemantics: "period-median",
        priceUsd: "2",
        tradeCount: 1,
      }],
      swapCount: 1,
    }));

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${token.tokenAddress}&range=1h`,
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=5",
    );
  });

  it("starts a single-pool chart without waiting for market enrichment", async () => {
    let resolveMarket: ((value: ReadonlyMap<string, TokenMarketDataV1>) => void)
      | undefined;
    mocks.readBitqueryTokenMarketDataV1.mockReturnValue(new Promise((resolve) => {
      resolveMarket = resolve;
    }));
    mocks.readBitqueryMarketChartV1.mockResolvedValue(chart({
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        valueUsdWad: "999",
        fdvUsdWad: "999",
        totalSupply: "1",
        asOfTime: "2026-08-11T14:02:00.000Z",
        freshness: "current",
      },
    }));

    const responsePromise = GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
    ));
    await vi.waitFor(() => {
      expect(mocks.readBitqueryMarketChartV1).toHaveBeenCalledTimes(1);
    });
    expect(resolveMarket).toBeTypeOf("function");
    resolveMarket?.(new Map([[token.tokenAddress, tokenMarketData()]]));
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.valuation).toMatchObject({
      status: "available",
      fdvUsdWad: "2000000000000000000000000",
    });
    expect(body.fdvUsdWad).toBe("2000000000000000000000000");
  });

  it("starts a single-pool chart without waiting for supply hydration", async () => {
    let resolveSupply: ((value: readonly typeof token[]) => void) | undefined;
    mocks.hydrateMissingCanonicalTokenSupplyV1.mockReturnValue(
      new Promise((resolve) => {
        resolveSupply = resolve;
      }),
    );

    const responsePromise = GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
    ));
    await vi.waitFor(() => {
      expect(mocks.readBitqueryMarketChartV1).toHaveBeenCalledTimes(1);
      expect(mocks.readBitqueryTokenMarketDataV1).toHaveBeenCalledTimes(1);
    });
    expect(resolveSupply).toBeTypeOf("function");
    resolveSupply?.([token]);

    expect((await responsePromise).status).toBe(200);
  });

  it("uses a verified durable identity when the primary identity source fails", async () => {
    mocks.readAlchemyExploreModel.mockRejectedValue(new Error("primary unavailable"));
    mocks.readDurableExploreModel.mockResolvedValue({
      status: "ready",
      ageMs: 60_000,
      envelope: {
        payload: {
          model: {
            status: "ready",
            tokens: [token],
            snapshot,
            launchDiscoverySnapshot,
            creatorClaims: [],
            launcherFeesAccruedWei: "0",
            launcherFeesAccruedEth: "0",
          },
        },
      },
    });

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
    ));

    expect(response.status).toBe(200);
    expect(mocks.readDurableExploreModel).toHaveBeenCalledWith(
      expect.anything(),
      Number.MAX_SAFE_INTEGER,
    );
    expect(mocks.readBitqueryMarketChartV1).toHaveBeenCalledTimes(1);
  });

  it("fails closed without fabricated points when all identity sources fail", async () => {
    const unknownAddress = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    mocks.readAlchemyExploreModel.mockRejectedValue(new Error("primary unavailable"));
    mocks.readProductionCustomExploreDirectoryV1.mockRejectedValue(
      new Error("registry unavailable"),
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${unknownAddress}`,
    ));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      schemaVersion: "programmable.market-chart-error.v1",
      source: "bitquery",
      status: "unavailable",
      reason: "identity-unavailable",
      error: "Token identity is temporarily unavailable",
      address: "0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa",
    });
    expect(body).not.toHaveProperty("identity");
    expect(body).not.toHaveProperty("points");
    expect(body).not.toHaveProperty("swapCount");
    expect(body).not.toHaveProperty("priceUsd", "0");
    expect(mocks.readBitqueryMarketChartV1).not.toHaveBeenCalled();
  });

  it("returns a calm waiting state before the first swap", async () => {
    mocks.readBitqueryMarketChartV1.mockResolvedValue(chart({
      status: "waiting-for-first-trade",
      points: [],
      swapCount: 0,
      volumeUsdWad: undefined,
      valuation: {
        status: "unavailable",
        reason: "waiting-for-first-trade",
      },
      asOfTime: undefined,
    }));

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      status: "waiting-for-first-trade",
      points: [],
      swapCount: 0,
      valuation: { reason: "waiting-for-first-trade" },
    });
    expect(body).not.toHaveProperty("fdvUsdWad");
    expect(response.headers.get("X-Programmable-Price-Source")).toBeNull();
  });

  it("returns typed unavailable and lets the client preserve its Bitquery LKG", async () => {
    mocks.readBitqueryMarketChartV1.mockResolvedValue(chart({
      status: "unavailable",
      points: [],
      swapCount: 0,
      volumeUsdWad: undefined,
      valuation: { status: "unavailable", reason: "source-unavailable" },
      asOfTime: undefined,
    }));

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
    ));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(body).toMatchObject({
      status: "unavailable",
      source: "bitquery",
      points: [],
      error: "Price history is temporarily unavailable",
    });
  });

  it("does not relabel a chart cache fallback with a current market valuation", async () => {
    mocks.readBitqueryMarketChartV1.mockResolvedValue(chart({
      readStatus: "cache-fallback",
      status: "partial",
      valuation: {
        status: "available",
        metric: "fdv",
        supplyBasis: "total",
        valueUsdWad: "1500000000000000000000000",
        fdvUsdWad: "1500000000000000000000000",
        totalSupply: "1000000",
        asOfTime: "2026-08-11T13:00:00.000Z",
        freshness: "stale",
      },
    }));

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
    ));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toMatchObject({
      readStatus: "cache-fallback",
      status: "partial",
      valuation: {
        fdvUsdWad: "1500000000000000000000000",
        freshness: "stale",
      },
      fdvUsdWad: "1500000000000000000000000",
    });
  });

  it("supports a Router-stamped Custom v4 pool", async () => {
    const customIdentity = {
      chainId: "1",
      tokenAddress: customGraphToken.tokenAddress.toLowerCase() as `0x${string}`,
      poolId: customGraphToken.poolId,
      protocol: "uniswap_v4",
    } as const satisfies MarketDataIdentityV1;
    mocks.readAlchemyExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [customGraphToken],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    });
    mocks.readBitqueryTokenMarketDataV1.mockResolvedValue(
      new Map([[customIdentity.tokenAddress, tokenMarketData(customIdentity)]]),
    );
    mocks.readBitqueryMarketChartV1.mockResolvedValue(
      chart({}, customIdentity),
    );

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${customGraphToken.tokenAddress}`,
    ));

    expect(response.status).toBe(200);
    expect(mocks.readBitqueryMarketChartV1).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: customIdentity,
        historyStart: customGraphToken.launchedAt,
      }),
    );
  });

  it.each([
    `address=${token.tokenAddress}&unused=random`,
    `address=${token.tokenAddress}&address=0x2222222222222222222222222222222222222222`,
    `address=${token.tokenAddress}&range=1h&range=1d`,
    `address=${token.tokenAddress}&range=invalid`,
  ])("rejects non-canonical query shapes before market reads: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore/token/chart?${query}`),
    );

    expect(response.status).toBe(400);
    expect(mocks.readAlchemyExploreModel).not.toHaveBeenCalled();
    expect(mocks.readBitqueryMarketChartV1).not.toHaveBeenCalled();
  });

  it("returns 404 only when both identity sources are current", async () => {
    mocks.readAlchemyExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    });

    const response = await GET(new NextRequest(
      `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
    ));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Token not found" });
    expect(mocks.readBitqueryMarketChartV1).not.toHaveBeenCalled();
  });
});
