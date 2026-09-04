import { describe, expect, it } from "vitest";

import { websiteExploreIndexEnabledV1 } from
  "../lib/website-explore-index";

describe("website Explore index", () => {
  it("keeps the website coin index fail-closed by default", () => {
    expect(websiteExploreIndexEnabledV1({})).toBe(false);
  });

  it("requires an exact explicit opt-in for the later replacement", () => {
    expect(websiteExploreIndexEnabledV1({
      PROGRAMMABLE_WEBSITE_EXPLORE_INDEX_ENABLED: "TRUE",
    })).toBe(true);
    expect(websiteExploreIndexEnabledV1({
      PROGRAMMABLE_WEBSITE_EXPLORE_INDEX_ENABLED: "1",
    })).toBe(false);
  });
});
