import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("landing page contract", () => {
  it("keeps the landing page at home and sends the header Explore link to its landing chapter", () => {
    const homePage = read("app/page.tsx");
    const explorePage = read("app/explore/page.tsx");
    const navigation = read("components/site-navigation.tsx");

    expect(homePage).toContain("import { LandingPage }");
    expect(homePage).toContain("return <LandingPage />");
    expect(explorePage).toContain("import { ExploreView }");
    expect(explorePage).toContain('canonical: "/explore"');
    expect(navigation).toContain(
      '{ href: "/explore", label: "Explore" }',
    );
    expect(navigation).toContain('href="/"');
    expect(homePage).toContain(
      'const pageDescription = "Shape what assets can do";',
    );
    expect(homePage).toContain("description: pageDescription");
    expect(homePage).toContain("openGraph:");
    expect(homePage).toContain("twitter:");
  });

  it("uses one black star field across routes and one exact floral landing foreground", () => {
    const landing = read("components/landing-page.tsx");
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const finalStyles = read("app/webde-final-ui.css");
    const layout = read("app/layout.tsx");
    const manifest = read("public/site.webmanifest");

    expect(backdrop).not.toContain('"use client"');
    expect(backdrop).not.toContain("<video");
    expect(backdrop).toContain("const TWINKLE_COUNT = 56");
    expect(backdrop).toContain("const LOWER_TWINKLE_COUNT = 20");
    expect(backdrop).not.toContain("atmosphere-botanicals");
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
    expect(landing).toContain("const HERO_TWINKLE_COUNT = 88");
    expect(landing).toContain('<h1 id="landing-title">Programmable</h1>');
    expect(landing).toContain("Shape what assets can do");
    expect(landing).toContain('id="intro"');
    expect(landing).toContain('href="#what-is-programmable"');
    expect(landing).toContain('id="what-is-programmable"');
    expect(landing).toContain('id="what-is-a-hook"');
    expect(landing).toContain('id="explore"');
    expect(landing).toContain("<ExploreView embedded />");
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

    for (const [asset, maximumBytes] of [
      ["programmable-floral-foreground-v1.avif", 1_000_000],
      ["programmable-floral-foreground-tablet-v1.avif", 550_000],
      ["programmable-floral-foreground-mobile-v1.avif", 400_000],
    ] as const) {
      expect(
        statSync(join(root, "public/brand/atmosphere", asset)).size,
      ).toBeLessThan(maximumBytes);
    }
  });

  it("keeps each landing chapter full-screen, readable and motion safe", () => {
    const landing = read("components/landing-page.tsx");
    const styles = read("components/landing-page.module.css");

    expect(styles).toMatch(
      /\.hero\s*\{[^}]*min-height:\s*calc\(100svh - 88px\);/s,
    );
    expect(styles).toMatch(/\.hero\s*\{[^}]*z-index:\s*1;/s);
    expect(styles).toMatch(/\.definition\s*\{[^}]*min-height:\s*100svh;/s);
    expect(styles).toMatch(/\.scrollCue\s*\{[^}]*min-height:\s*52px;/s);
    expect(styles).toMatch(
      /\.hero h1\s*\{[^}]*font-size:\s*clamp\(64px, 7\.2vw, 104px\);/s,
    );
    expect(styles).toContain("scroll-margin-top: 0;");
    expect(styles).toContain("object-position: center bottom;");
    expect(styles).not.toContain("mask-image:");
    expect(styles).not.toContain("translateY(27vh)");
    expect(styles).not.toContain("translateY(31vh)");
    expect(styles).toContain("align-items: baseline;");
    expect(styles).toContain(".definitionLogoFrame");
    expect(landing).toContain("new IntersectionObserver(");
    expect(landing).toContain('rootMargin: "0px 0px 48% 0px"');
    expect(landing).toContain("useLayoutEffect(() =>");
    expect(landing).toContain('if (window.location.hash === "")');
    expect(landing).toContain(
      'window.scrollTo({ behavior: "auto", left: 0, top: 0 })',
    );
    expect(landing).toContain('window.location.hash !== "#explore"');
    expect(landing).toContain('document.querySelector<HTMLElement>(".header-inner")');
    expect(landing).toContain(
      'chapter?.querySelector<HTMLElement>("[data-explore-heading]")',
    );
    expect(landing).toContain('window.scrollTo({ behavior: "auto"');
    expect(landing).toContain("data-reveal-section");
    expect(landing).not.toContain('addEventListener("wheel"');
    expect(landing).not.toContain('addEventListener("scroll"');
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.scrollCue span:last-child\s*\{[^}]*animation:\s*none;/,
    );
  });

  it("restores native document scrolling instead of trapping the landing route", () => {
    const styles = read("components/landing-page.module.css");
    const globalStyles = read("app/globals.css");
    const interfaceStyles = read("app/interface.css");

    expect(styles).toMatch(
      /:global\(body \.app-frame\):has\(\.page\)\s*\{[^}]*height:\s*auto;[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*visible;/s,
    );
    expect(styles).toMatch(
      /:global\(body \.app-frame\):has\(\.page\) > :global\(main\)\s*\{[^}]*height:\s*auto;[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*visible;/s,
    );
    expect(styles).toMatch(
      /:global\(body \.app-frame\):has\(\.page\) :global\(\.route-transition\)\s*\{[^}]*height:\s*auto;[^}]*overflow-x:\s*clip;[^}]*overflow-y:\s*visible;/s,
    );
    expect(globalStyles).toMatch(
      /html\s*\{[^}]*overflow-x:\s*clip;/s,
    );
    expect(globalStyles).toMatch(
      /body\s*\{[^}]*overflow-x:\s*clip;/s,
    );
    expect(globalStyles).toMatch(
      /\.app-frame\s*\{[^}]*overflow-x:\s*clip;/s,
    );
    expect(interfaceStyles).not.toMatch(
      /\.app-frame:has\(\.landing-page-root\)[^{]*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(interfaceStyles).not.toMatch(
      /\.app-frame:has\(\.landing-page-root\) > main\s*\{[^}]*overflow:\s*hidden;/s,
    );
    expect(interfaceStyles).not.toMatch(
      /\.app-frame:has\(\.landing-page-root\) \.route-transition\s*\{[^}]*overflow:\s*hidden;/s,
    );
  });

  it("keeps the star shimmer small and active while reduced motion disables it", () => {
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const interfaceStyles = read("app/interface.css");
    const finalStyles = read("app/webde-final-ui.css");

    expect(backdrop).toContain("const TWINKLE_COUNT = 56");
    expect(backdrop).toContain("const LOWER_TWINKLE_COUNT = 20");
    expect(backdrop).toContain("Array.from({ length: TWINKLE_COUNT }");
    expect(backdrop).toContain("Array.from({ length: LOWER_TWINKLE_COUNT }");
    expect(backdrop).toContain("const duration = 4.6");
    expect(backdrop).toContain("const size = 0.64 + sizeStep + emphasis");
    expect(interfaceStyles).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*var\(--sparkle-animation\)/,
    );
    expect(interfaceStyles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*none;/,
    );
    expect(finalStyles).toMatch(
      /\.atmosphere-sparkles i\s*\{[^}]*box-shadow:\s*0 0 2\.5px/s,
    );
    expect(finalStyles).not.toContain("cross");
  });

  it("restarts the home hero on an unmodified logo activation", () => {
    const navigation = read("components/site-navigation.tsx");

    expect(navigation).toContain("function restartHome(");
    expect(navigation).toContain('window.location.assign("/")');
    expect(navigation).toContain("onClick={restartHome}");
    expect(navigation).toContain("event.metaKey");
    expect(navigation).toContain("event.ctrlKey");
  });

  it("opens Explore as its own route from the shared topbar", () => {
    const navigation = read("components/site-navigation.tsx");

    expect(navigation).toContain('{ href: "/explore", label: "Explore" }');
    expect(navigation).not.toContain("prepareLandingExploreNavigation(");
    expect(navigation).not.toContain('window.history.pushState(null, "", "/#explore")');
  });

  it("uses fluid shared gutters instead of a desktop to mobile width jump", () => {
    const finalStyles = read("app/webde-final-ui.css");
    const landingStyles = read("components/landing-page.module.css");

    expect(finalStyles).toContain(
      "calc(100% - clamp(2rem, 5vw, 5rem))",
    );
    expect(landingStyles).toContain(
      "max(clamp(24px, 4vw, 40px), calc((100% - 1280px) / 2))",
    );
  });
});
