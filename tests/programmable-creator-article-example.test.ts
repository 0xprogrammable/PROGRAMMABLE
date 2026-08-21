import { describe, expect, it } from "vitest";

import {
  PROGRAMMABLE_MAIN_TOKEN_ADDRESS,
  programmableCreatorArticleExampleV1,
} from "../lib/creator-article/programmable-example-v1";

describe("Programmable Main-token creator article example", () => {
  it("is a strict factual image-rich draft bound to the exact Main token", () => {
    const draft = programmableCreatorArticleExampleV1();
    expect(draft.tokenAddress).toBe(PROGRAMMABLE_MAIN_TOKEN_ADDRESS);
    expect(draft.bannerImage).toMatchObject({ width: 1500, height: 500, size: "wide" });
    expect(draft.document.content.some((block) => block.type === "articleImage")).toBe(true);
    expect(JSON.stringify(draft)).not.toMatch(/unruggable|guaranteed|partnered/iu);
  });
});
