import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class TokenChartIntegrityError extends Error {
    override name = "TokenChartIntegrityError";

    constructor(readonly reason: string) {
      super("Token chart inputs failed integrity validation");
    }
  }
  return {
    getAlchemyOnchainDeployment: vi.fn(),
    isTokenChartRange: vi.fn(),
    enrichTokensWithAlchemyPoolState: vi.fn(),
    readAlchemyExploreModel: vi.fn(),
    readTokenChartSeries: vi.fn(),
    safeAlchemyError: vi.fn((error) => error),
    TokenChartIntegrityError,
  };
});

vi.mock("../lib/alchemy/explore.server", () => ({
  getAlchemyOnchainDeployment: mocks.getAlchemyOnchainDeployment,
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  safeAlchemyError: mocks.safeAlchemyError,
}));

vi.mock("../lib/onchain/chart", () => ({
  isTokenChartRange: mocks.isTokenChartRange,
  readTokenChartSeries: mocks.readTokenChartSeries,
  TokenChartIntegrityError: mocks.TokenChartIntegrityError,
}));

vi.mock("../lib/alchemy/live-market.server", () => ({
  enrichTokensWithAlchemyPoolState: mocks.enrichTokensWithAlchemyPoolState,
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

const deployment = {
  status: "ready",
  chainId: 1,
  rpcUrl: "https://eth-mainnet.g.alchemy.com/v2/redacted",
} as const;

const snapshot = {
  chainId: 1,
  blockNumber: "25630000",
  blockHash: `0x${"44".repeat(32)}`,
  confirmations: 12,
  ethUsdQuote: { answer: "350000000000", decimals: 8 },
} as const;
const launchDiscoverySnapshot = {
  ...snapshot,
  blockNumber: "25630005",
  blockHash: `0x${"55".repeat(32)}`,
} as const;

describe("token chart Alchemy API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTokenChartRange.mockImplementation((range) =>
      ["1h", "1d", "1w", "all"].includes(range),
    );
    mocks.getAlchemyOnchainDeployment.mockReturnValue(deployment);
    mocks.enrichTokensWithAlchemyPoolState.mockResolvedValue([token]);
    mocks.readAlchemyExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [token],
      snapshot,
      launchDiscoverySnapshot,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    });
    mocks.readTokenChartSeries.mockResolvedValue({
      status: "ready",
      points: [],
      swapCount: 2,
      volumeWei: "1250000000000000000",
      volumeEth: "1.25",
      volumeUsdWad: "4375000000000000000000",
      fdvEthWei: "500000000000000000000",
      fdvEth: "500",
      fdvUsdWad: "1750000000000000000000000",
      freshness: {
        history: {
          status: "current",
          throughBlock: launchDiscoverySnapshot.blockNumber,
        },
        price: {
          status: "current",
          asOfBlock: launchDiscoverySnapshot.blockNumber,
          lagBlocks: "0",
        },
        valuation: {
          status: "current",
          metric: "fdv",
          asOfBlock: launchDiscoverySnapshot.blockNumber,
          lagBlocks: "0",
        },
      },
    });
  });

  it("forwards the selected range through Alchemy and returns exact volume fields", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token/chart?address=${token.tokenAddress}&range=1h`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.readAlchemyExploreModel).toHaveBeenCalledTimes(1);
    expect(mocks.getAlchemyOnchainDeployment).toHaveBeenCalledTimes(1);
    expect(mocks.readTokenChartSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        deployment,
        token,
        snapshotBlock: 25_630_005n,
        range: "1h",
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      address: token.tokenAddress,
      range: "1h",
      swapCount: 2,
      volumeWei: "1250000000000000000",
      volumeEth: "1.25",
      volumeUsdWad: "4375000000000000000000",
      fdvEthWei: "500000000000000000000",
      fdvEth: "500",
      fdvUsdWad: "1750000000000000000000000",
      valuationMetric: "fdv",
      dataQuality: {
        schemaVersion: "programmable.explore-chart-data-quality.v1",
        status: "current",
        asOfBlock: launchDiscoverySnapshot.blockNumber,
        blockHash: launchDiscoverySnapshot.blockHash,
        finality: "confirmed",
        history: {
          status: "current",
          throughBlock: launchDiscoverySnapshot.blockNumber,
        },
        price: {
          status: "current",
          asOfBlock: launchDiscoverySnapshot.blockNumber,
          lagBlocks: "0",
        },
        valuation: {
          status: "current",
          metric: "fdv",
          asOfBlock: launchDiscoverySnapshot.blockNumber,
          lagBlocks: "0",
        },
      },
    });
    expect(body).not.toHaveProperty("marketCapEthWei");
    expect(body).not.toHaveProperty("marketCapEth");
    expect(body).not.toHaveProperty("marketCapUsdWad");
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "rpc",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
    );
    expect(response.headers.get("X-Programmable-Valuation-Metric")).toBe(
      "fdv",
    );
  });

  it("returns partial freshness without caching an older price as current", async () => {
    mocks.readTokenChartSeries.mockResolvedValue({
      status: "partial",
      points: [{ blockNumber: "25630000", priceEth: "0.5" }],
      swapCount: 1,
      volumeWei: "1",
      volumeEth: "0.000000000000000001",
      fdvEthWei: "500000000000000000000",
      freshness: {
        history: {
          status: "current",
          throughBlock: launchDiscoverySnapshot.blockNumber,
        },
        price: {
          status: "stale",
          asOfBlock: snapshot.blockNumber,
          lagBlocks: "5",
        },
        valuation: {
          status: "stale",
          metric: "fdv",
          asOfBlock: snapshot.blockNumber,
          lagBlocks: "5",
        },
      },
    });

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Programmable-Data-Quality")).toBe(
      "partial",
    );
    expect(body).toMatchObject({
      status: "partial",
      points: [{ blockNumber: "25630000", priceEth: "0.5" }],
      dataQuality: {
        status: "partial",
        price: {
          status: "stale",
          asOfBlock: snapshot.blockNumber,
          lagBlocks: "5",
        },
      },
    });
  });

  it.each(["deployment", "model"])(
    "returns unavailable without fabricated zero series when %s is not ready",
    async (unavailable) => {
      if (unavailable === "deployment") {
        mocks.getAlchemyOnchainDeployment.mockReturnValue({
          status: "not-deployed",
        });
      } else {
        mocks.readAlchemyExploreModel.mockResolvedValue({
          status: "not-deployed",
          tokens: [],
          snapshot: null,
          creatorClaims: [],
          launcherFeesAccruedWei: "0",
          launcherFeesAccruedEth: "0",
        });
      }

      const response = await GET(
        new NextRequest(
          `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
        ),
      );
      const body = await response.json();

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(body).toMatchObject({
        status: "unavailable",
        error: "Onchain chart data is temporarily unavailable",
      });
      expect(body).not.toHaveProperty("points");
      expect(body).not.toHaveProperty("swapCount");
      expect(body).not.toHaveProperty("volumeWei");
      expect(body).not.toHaveProperty("volumeEth");
      expect(mocks.readTokenChartSeries).not.toHaveBeenCalled();
    },
  );

  it.each([
    `address=${token.tokenAddress}&unused=random`,
    `address=${token.tokenAddress}&address=0x2222222222222222222222222222222222222222`,
    `address=${token.tokenAddress}&range=1h&range=1d`,
  ])("rejects non-canonical query shapes before the Alchemy read: %s", async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/explore/token/chart?${query}`),
    );

    expect(response.status).toBe(400);
    expect(mocks.readAlchemyExploreModel).not.toHaveBeenCalled();
    expect(mocks.getAlchemyOnchainDeployment).not.toHaveBeenCalled();
  });

  it("reports read-model conflicts as integrity-unavailable without zero data", async () => {
    mocks.readTokenChartSeries.mockRejectedValue(
      new mocks.TokenChartIntegrityError("invalid-token-decimals"),
    );

    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token/chart?address=${token.tokenAddress}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBeNull();
    expect(body).toMatchObject({
      status: "unavailable",
      dataQuality: {
        schemaVersion: "programmable.explore-chart-data-quality.v1",
        status: "unavailable",
        reason: "integrity",
      },
    });
    expect(body).not.toHaveProperty("points");
    expect(body).not.toHaveProperty("volumeWei");
    expect(body).not.toHaveProperty("volumeEth");
  });
});
