import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enrichExplorePageWithOfficialV4Subgraph: vi.fn(),
  paginateExplore: vi.fn(),
  parseExploreSort: vi.fn(),
  readExploreModel: vi.fn(),
}));

vi.mock("../lib/onchain", () => ({
  paginateExplore: mocks.paginateExplore,
  parseExploreSort: mocks.parseExploreSort,
  readExploreModel: mocks.readExploreModel,
}));

vi.mock("../lib/onchain/uniswap-v4-subgraph", () => ({
  enrichExplorePageWithOfficialV4Subgraph:
    mocks.enrichExplorePageWithOfficialV4Subgraph,
  OFFICIAL_V4_SUBGRAPH_MAXIMUM_POOL_IDS: 24,
}));

import { GET } from "../app/api/explore/route";

describe("Explore API query boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "unused=random",
    "page=1&page=2",
    "q=token&q=other",
    "sort=newest&extra=1",
  ])(
    "rejects non-canonical query shapes before any secret-backed enrichment: %s",
    async (query) => {
      const response = await GET(
        new NextRequest(`http://localhost/api/explore?${query}`),
      );

      expect(response.status).toBe(400);
      expect(mocks.readExploreModel).not.toHaveBeenCalled();
      expect(
        mocks.enrichExplorePageWithOfficialV4Subgraph,
      ).not.toHaveBeenCalled();
    },
  );

  it("uses the ten-second shared cache window for ready Explore data", async () => {
    const model = { status: "ready", tokens: [] };
    const page = {
      status: "ready",
      tokens: [],
      page: 1,
      pageSize: 10,
      total: 0,
      totalPages: 0,
      sort: "market-cap",
      query: "",
      snapshot: {
        chainId: 1,
        blockNumber: "1",
        blockHash: `0x${"11".repeat(32)}`,
        confirmations: 12,
      },
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    };
    mocks.readExploreModel.mockResolvedValue(model);
    mocks.parseExploreSort.mockReturnValue("market-cap");
    mocks.paginateExplore.mockReturnValue(page);
    mocks.enrichExplorePageWithOfficialV4Subgraph.mockResolvedValue(page);

    const response = await GET(
      new NextRequest("http://localhost/api/explore?page=1&limit=10"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=0, s-maxage=10, stale-while-revalidate=10",
    );
  });
});
