import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("website token-index zero boundary", () => {
  it("has no environment switch that can restore the retired consumer", () => {
    expect(
      existsSync(join(process.cwd(), "lib/website-explore-index.ts")),
    ).toBe(false);

    for (const path of [
      "app/explore/page.tsx",
      "components/landing-explore-gate.tsx",
      "components/explore-index-reset-view.tsx",
      "components/explore-chain-selector.tsx",
      "app/token/[address]/page.tsx",
      "components/token-index-reset-view.tsx",
    ]) {
      const source = read(path);
      expect(source, path).not.toContain(
        "PROGRAMMABLE_WEBSITE_EXPLORE_INDEX_ENABLED",
      );
      expect(source, path).not.toContain("@/components/explore-view");
      expect(source, path).not.toContain("@/components/token-detail-view");
      expect(source, path).not.toContain("@/app/api/explore");
      expect(source, path).not.toContain("/api/explore");
      expect(source, path).not.toContain("fetch(");
      expect(source, path).not.toMatch(/gmgn|dexscreener|bitquery/iu);
    }
  });

  it("keeps Classic launch confirmation away from market-enriched endpoints", () => {
    const launchBuilder = read("components/launch-builder.tsx");

    expect(launchBuilder).toContain("/api/profile/classic-v3?account=");
    expect(launchBuilder).not.toContain("/api/explore/token?address=");
    expect(launchBuilder).not.toContain('"/api/explore?sort=newest&limit=100"');
  });
});
