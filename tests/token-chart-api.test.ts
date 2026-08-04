import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getAlchemyOnchainDeployment: vi.fn(),
  isTokenChartRange: vi.fn(),
  enrichTokensWithAlchemyPoolState: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
  readTokenChartSeries: vi.fn(),
  safeAlchemyError: vi.fn((error) => error),
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  getAlchemyOnchainDeployment: mocks.getAlchemyOnchainDeployment,
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  safeAlchemyError: mocks.safeAlchemyError,
}));

vi.mock("../lib/onchain/chart", () => ({
  isTokenChartRange: mocks.isTokenChartRange,
  readTokenChartSeries: mocks.readTokenChartSeries,
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
    await expect(response.json()).resolves.toMatchObject({
      address: token.tokenAddress,
      range: "1h",
      swapCount: 2,
      volumeWei: "1250000000000000000",
      volumeEth: "1.25",
      volumeUsdWad: "4375000000000000000000",
    });
    expect(response.headers.get("X-Programmable-Read-Source")).toBe(
      "rpc",
    );
    expect(response.headers.get("X-Programmable-Rpc-Provider")).toBe(
      "alchemy",
    );
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=2, stale-while-revalidate=2",
    );
  });

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
});
