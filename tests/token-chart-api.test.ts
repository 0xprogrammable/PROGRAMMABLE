import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPublicOnchainDeployment: vi.fn(),
  isTokenChartRange: vi.fn(),
  readExploreModel: vi.fn(),
  readTokenChartSeries: vi.fn(),
}));

vi.mock("../lib/onchain", () => ({
  getPublicOnchainDeployment: mocks.getPublicOnchainDeployment,
  readExploreModel: mocks.readExploreModel,
}));

vi.mock("../lib/onchain/chart", () => ({
  isTokenChartRange: mocks.isTokenChartRange,
  readTokenChartSeries: mocks.readTokenChartSeries,
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

describe("token chart API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTokenChartRange.mockImplementation((range) =>
      ["1h", "1d", "1w", "all"].includes(range),
    );
    mocks.getPublicOnchainDeployment.mockReturnValue({
      status: "ready",
      chainId: 1,
    });
    mocks.readExploreModel.mockResolvedValue({
      status: "ready",
      tokens: [token],
      snapshot: {
        blockNumber: "25630000",
        ethUsdQuote: { answer: "350000000000", decimals: 8 },
      },
    });
    mocks.readTokenChartSeries.mockResolvedValue({
      status: "ready",
      points: [],
      swapCount: 2,
      volumeWei: "1250000000000000000",
      volumeEth: "1.25",
      volumeUsdWad: "4375000000000000000000",
    });
  });

  it("forwards the selected range and returns its exact volume fields", async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/explore/token/chart?address=${token.tokenAddress}&range=1h`,
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.readTokenChartSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        token,
        snapshotBlock: 25_630_000n,
        range: "1h",
      }),
    );
    await expect(response.json()).resolves.toMatchObject({
      address: token.tokenAddress,
      range: "1h",
      swapCount: 2,
      volumeWei: "1250000000000000000",
      volumeEth: "1.25",
      volumeUsdWad: "4375000000000000000000",
    });
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=15, stale-while-revalidate=15",
    );
  });
});
