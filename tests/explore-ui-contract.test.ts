import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Explore UI contract", () => {
  it("keeps sort, socials and model choices in one persistent disclosure", () => {
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );

    expect(source).toContain('id="explore-sort-label"');
    expect(source).toContain('id="explore-socials-label"');
    expect(source).toContain('id="explore-model-label"');
    expect(source).toContain('{ id: "classic", label: "Classic" }');
    expect(source).toContain(
      '{ id: "custom-hook", label: "Custom" }',
    );
    expect(source).toContain(
      'Number(socialFilter !== "all") + Number(modelFilter !== "all")',
    );
    expect(source).not.toMatch(
      /onClick=\{\(\) => \{[\s\S]{0,300}filterRef\.current/s,
    );
  });

  it("keeps nine stable cards and groups links next to market cap", () => {
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(source).toContain("export const EXPLORE_TOKENS_PER_PAGE = 9");
    expect(styles).toMatch(
      /\.runnerGrid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*width:\s*100%;/s,
    );
    expect(styles).toMatch(
      /\.runnerArt\s*\{[^}]*aspect-ratio:\s*1;[^}]*width:\s*100%;/s,
    );
    expect(styles).toMatch(/\.runnerMeta\s*\{[^}]*gap:\s*2px;/s);
    expect(styles).not.toMatch(
      /\.runnerSocials\s*\{[^}]*margin-inline-start:\s*auto;/s,
    );
    expect(source).not.toContain("styles.runnerIndex");
    expect(source).not.toContain("styles.sortReadout");
    expect(source).not.toContain("styles.pageKicker");
    expect(styles).not.toContain(".runnerIndex");
    expect(styles).not.toContain(".sortReadout");
    expect(styles).not.toContain("#a83f64");
    expect(styles).toMatch(
      /\.runnerHeading h3\s*\{[^}]*line-height:\s*1\.15;/s,
    );
    expect(source).toContain(
      'sizes="(max-width: 360px) 96px, (max-width: 420px) 104px, (max-width: 700px) 112px, (max-width: 900px) 46vw, 333px"',
    );
    expect(styles).toMatch(
      /\.runnerMarketStatus\s*\{[^}]*color:\s*var\(--explore-ivory-muted\);/s,
    );
  });
});
