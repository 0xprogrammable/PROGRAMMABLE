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
    status: "ready",
    generatedAt: "2026-08-11T14:02:00.000Z",
    identity: marketIdentity,
    range: "all",
    points: [
      {
        blockNumber: "25740001",
        time: "2026-08-11T14:01:00.000Z",
        priceUsd: "1.5",
        ohlcUsd: { open: "1.4", high: "1.6", low: "1.3", close: "1.5" },
        volumeUsdWad: "150000000000000000000",
        tradeCount: 3,
      },
      {
        blockNumber: "25740002",
        time: "2026-08-11T14:02:00.000Z",
        priceUsd: "2",
        ohlcUsd: { open: "1.5", high: "2.1", low: "1.5", close: "2" },
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
    asOfTime: "2026-08-11T14:02:00.000Z",
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
      expect.objectContaining({ identity, range: "1h", signal: expect.any(AbortSignal) }),
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
      expect.objectContaining({ identity: customIdentity }),
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
