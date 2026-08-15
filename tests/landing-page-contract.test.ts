import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("landing page contract", () => {
  it("keeps the landing page at home and preserves Explore as its own route", () => {
    const homePage = read("app/page.tsx");
    const explorePage = read("app/explore/page.tsx");
    const navigation = read("components/site-navigation.tsx");

    expect(homePage).toContain('import { LandingPage }');
    expect(homePage).toContain("return <LandingPage />");
    expect(explorePage).toContain('import { ExploreView }');
    expect(explorePage).toContain('canonical: "/explore"');
    expect(navigation).toContain(
      '{ href: "/explore", label: "Explore" }',
    );
  });

  it("uses one black star field across routes and one exact floral landing foreground", () => {
    const landing = read("components/landing-page.tsx");
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const finalStyles = read("app/webde-final-ui.css");
    const layout = read("app/layout.tsx");
    const manifest = read("public/site.webmanifest");

    expect(backdrop).not.toContain('"use client"');
    expect(backdrop).not.toContain("<video");
    expect(backdrop).toContain("const TWINKLE_COUNT = 72");
    expect(backdrop).toContain("const LOWER_TWINKLE_COUNT = 24");
    expect(backdrop).toContain('aria-hidden="true"');
    expect(finalStyles).toMatch(
      /\.atmosphere-backdrop\s*\{[^}]*background:\s*var\(--webde-canvas\);/s,
    );
    expect(finalStyles).toMatch(
      /\.atmosphere-ground-glow,[\s\S]*?\.atmosphere-botanicals,[\s\S]*?\.atmosphere-veil\s*\{[^}]*display:\s*none;/s,
    );
    expect(layout).toContain('themeColor: "#000000"');
    expect(manifest).toContain('"background_color": "#000000"');
    expect(manifest).toContain('"theme_color": "#000000"');

    expect(landing).toContain(
      'src="/brand/atmosphere/programmable-floral-foreground-v1.avif"',
    );
    expect(landing).toContain("<h1 id=\"landing-title\">Programmable</h1>");
    expect(landing).toContain("Shape what assets can do");
    expect(landing).toContain('href="#what-is-programmable"');
    expect(landing).toContain('id="what-is-programmable"');
    expect(landing).toContain('id="what-is-a-hook"');
    expect(landing).toContain("<ExploreView />");
    expect(landing).toContain('href="/docs"');
    expect(landing).toContain(
      'href="https://docs.uniswap.org/contracts/v4/overview"',
    );
    expect(landing).not.toContain("liquid-glass-distortion");

    for (const asset of [
      "programmable-floral-foreground-v1.avif",
      "programmable-floral-hooks-v1.avif",
    ]) {
      const assetPath = join(root, "public/brand/atmosphere", asset);
      expect(existsSync(assetPath)).toBe(true);
      expect(statSync(assetPath).size).toBeLessThan(2 * 1024 * 1024);
    }
  });

  it("keeps each landing chapter full-screen, readable and motion safe", () => {
    const styles = read("components/landing-page.module.css");

    expect(styles).toMatch(
      /\.hero\s*\{[^}]*min-height:\s*calc\(100svh - 88px\);/s,
    );
    expect(styles).toMatch(/\.definition\s*\{[^}]*min-height:\s*100svh;/s);
    expect(styles).toMatch(/\.scrollCue\s*\{[^}]*min-height:\s*52px;/s);
    expect(styles).toMatch(
      /\.hero h1\s*\{[^}]*font-size:\s*clamp\(64px, 7\.2vw, 104px\);/s,
    );
    expect(styles).toContain("scroll-margin-top: 0;");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.scrollCue span:last-child\s*\{[^}]*animation:\s*none;/,
    );
  });

  it("keeps the star shimmer small and slow while reduced motion disables it", () => {
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const interfaceStyles = read("app/interface.css");
    const finalStyles = read("app/webde-final-ui.css");

    expect(backdrop).toContain("const TWINKLE_COUNT = 72");
    expect(backdrop).toContain("const LOWER_TWINKLE_COUNT = 24");
    expect(backdrop).toContain("Array.from({ length: TWINKLE_COUNT }");
    expect(backdrop).toContain("Array.from({ length: LOWER_TWINKLE_COUNT }");
    expect(backdrop).toContain("const duration = 10.8");
    expect(backdrop).toContain("const size = 0.62");
    expect(interfaceStyles).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*var\(--sparkle-animation\)/,
    );
    expect(interfaceStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*none;/,
    );
    expect(finalStyles).toMatch(
      /\.atmosphere-sparkles i\s*\{[^}]*box-shadow:\s*0 0 3px/s,
    );
    expect(finalStyles).not.toContain("cross");
  });
});
