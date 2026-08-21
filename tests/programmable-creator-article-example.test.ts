import { describe, expect, it } from "vitest";

import {
  PROGRAMMABLE_MAIN_TOKEN_ADDRESS,
  programmableCreatorArticleExampleV1,
} from "../lib/creator-article/programmable-example-v1";

describe("Programmable Main-token creator article example", () => {
  it("is a strict factual creator story bound to the exact Main token", () => {
    const draft = programmableCreatorArticleExampleV1();
    expect(draft.tokenAddress).toBe(PROGRAMMABLE_MAIN_TOKEN_ADDRESS);
    expect(draft.bannerImage).toMatchObject({ width: 1500, height: 500, size: "wide" });
    expect(draft.document.content.some((block) => block.type === "articleImage")).toBe(false);
    expect(JSON.stringify(draft)).toContain("https://programmable.market/docs");
    expect(JSON.stringify(draft)).toContain("https://dune.com/0xprogrammable6098/programmable-analytics");
    expect(JSON.stringify(draft)).not.toMatch(/unruggable|guaranteed|partnered/iu);
  });
});
