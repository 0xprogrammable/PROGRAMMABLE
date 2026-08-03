import { describe, expect, it } from "vitest";

import {
  EXPLORE_PREVIEW_TOKENS,
  getExplorePreviewChart,
  getExplorePreviewProject,
} from "../components/explore-preview-data";
import { isInterfacePreviewHost } from "../components/interface-preview";

describe("Explore interface preview", () => {
  it("is available only on local browser hosts", () => {
    expect(isInterfacePreviewHost("127.0.0.1")).toBe(true);
    expect(isInterfacePreviewHost("localhost")).toBe(true);
    expect(isInterfacePreviewHost("::1")).toBe(true);
    expect(isInterfacePreviewHost("programmable.family")).toBe(false);
  });

  it("provides a complete, unique project index", () => {
    expect(EXPLORE_PREVIEW_TOKENS).toHaveLength(6);
    expect(
      new Set(EXPLORE_PREVIEW_TOKENS.map((token) => token.tokenAddress)).size,
    ).toBe(EXPLORE_PREVIEW_TOKENS.length);

    for (const token of EXPLORE_PREVIEW_TOKENS) {
      expect(token.imageUrl).toMatch(/^\/brand\/.+\.webp$/);
      expect(token.links).toHaveLength(3);
      expect(getExplorePreviewProject(token.tokenAddress)).toMatchObject({
        contributors: expect.any(Number),
        communityMembers: expect.any(Number),
      });
    }
  });

  it("builds deterministic chart data for every preview project", () => {
    for (const token of EXPLORE_PREVIEW_TOKENS) {
      const chart = getExplorePreviewChart(token.tokenAddress, "1d");
      expect(chart?.status).toBe("ready");
      expect(chart?.points).toHaveLength(9);
      expect(Number(chart?.volumeUsdWad)).toBeGreaterThan(0);
    }
  });
});
