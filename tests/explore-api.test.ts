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
});
