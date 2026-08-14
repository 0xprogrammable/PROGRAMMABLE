import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Explore UI contract", () => {
  it("streams the initial Explore response and suppresses the hydration refetch", () => {
    const page = readFileSync(join(root, "app/explore/page.tsx"), "utf8");
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );

    expect(page).toContain("<Suspense fallback={<ExploreView loadingOnly />}>");
    expect(page).toContain(
      'import { GET as readExploreResponse } from "@/app/api/explore/route"',
    );
    expect(page).toContain("await readExploreResponse(new NextRequest(");
    expect(page).toContain("return await Promise.race([guardedRead, deadline])");
    expect(page).toContain("controller.abort()");
    expect(page).not.toContain("AbortSignal.timeout(");
    expect(page).not.toContain('fetch("https://programmable.market');
    expect(page).toContain("<ExploreView initialResponse={initialResponse} />");
    expect(source).toContain(
      "if (handledRequestKey.current === requestKey)",
    );
    expect(source).toContain(
      "handledInitialExploreRequestKey(initialState, requestKey)",
    );
    expect(source).toContain("enabled: !preview && !loadingOnly");
    expect(source).toContain(
      "useState<TokenSort>(DEFAULT_EXPLORE_VIEW_SORT)",
    );
    expect(source).toContain("inert={loadingOnly ? true : undefined}");
  });

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
    expect(styles).toMatch(/\.runnerMeta\s*\{[^}]*gap:\s*4px;/s);
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
      'sizes="(max-width: 360px) 96px, (max-width: 420px) 104px, (max-width: 700px) 112px, (max-width: 768px) calc(50vw - 54px), (max-width: 900px) 330px, 313px"',
    );
    expect(styles).toMatch(
      /\.runnerMarketStatus\s*\{[^}]*color:\s*var\(--explore-ivory-muted\);/s,
    );
  });

  it("uses flat Warm Ivory milk glass without decorative distortion", () => {
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );
    const styles = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );

    expect(source).not.toContain("liquid-glass-distortion");
    expect(styles).toMatch(
      /\.runnerCard\s*\{[^}]*background:\s*rgba\(248, 240, 233, 0\.1\);/s,
    );
    expect(styles).toMatch(/\.runnerCard::before\s*\{[^}]*content:\s*none;/s);
    expect(styles).toMatch(
      /\.filterMenu\s*\{[^}]*background:\s*var\(--explore-glass-strong\);/s,
    );
    expect(styles).not.toContain("rgba(15, 18, 36, 0.84)");
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.runnerCard\s*\{[^}]*backdrop-filter:\s*none;[^}]*background:\s*rgba\(248, 240, 233, 0\.14\);/s,
    );
  });

  it("keeps one stable results status and closes the filter when focus leaves", () => {
    const source = readFileSync(
      join(root, "components/explore-view.tsx"),
      "utf8",
    );

    expect(source).toContain("const resultStatusRef");
    expect(source).toContain("ref={resultStatusRef}");
    expect(source).toContain('role="status"');
    expect(source).toContain('aria-atomic="true"');
    expect(source).toContain("onBlur={(event) => {");
    expect(source).toContain("!event.currentTarget.contains(nextTarget)");
    expect(source).toContain('event.currentTarget.removeAttribute("open")');
    expect(source).toContain(
      "resultStatusRef.current?.focus({ preventScroll: true })",
    );
    expect(source).toContain(
      'displayState.phase === "error" ? "" : resultRangeLabel(payload)',
    );
    expect(source).toContain('return "Explore unavailable"');
    expect(source).not.toContain("Loading tokens");
    expect(source).not.toContain("Updating tokens");
    expect(source).not.toContain("Page {activePage} of {pageCount}");
  });
});
