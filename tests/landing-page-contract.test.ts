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

  it("uses one responsive, route-specific static atmosphere image without a video", () => {
    const landing = read("components/landing-page.tsx");
    const styles = read("components/landing-page.module.css");
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const navigation = read("components/site-navigation.tsx");

    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-desktop-v1.avif",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-mobile-v1.avif",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-botanical-desktop-v2-1920.avif",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-botanical-desktop-v2.avif",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-botanical-mobile-v2-720.avif",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-botanical-mobile-v2-900.avif",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-botanical-mobile-v2.avif",
    );
    expect(backdrop).toContain(
      'media="(orientation: portrait) and (max-width: 1024px)"',
    );
    expect(backdrop).toContain("const art = isLandingPage ? landingArt : appSky");
    expect(backdrop.match(/<picture/g)).toHaveLength(1);
    expect(backdrop.match(/<img/g)).toHaveLength(1);
    expect(backdrop).toContain('type="image/avif"');
    expect(backdrop.match(/sizes="100vw"/g)).toHaveLength(2);
    expect(backdrop).toContain("1920w");
    expect(backdrop).toContain("3840w");
    expect(backdrop).toContain("720w");
    expect(backdrop).toContain("900w");
    expect(backdrop).toContain("1440w");
    expect(backdrop).toContain('fetchPriority="high"');
    expect(landing).toContain('href="/launch"');
    expect(landing).toContain('href="/explore"');
    expect(landing).toContain(
      'aria-label="Tokens that behave how you imagine"',
    );
    expect(landing).toContain(">Tokens that behave</span>");
    expect(landing).toContain(">how you imagine</span>");
    expect(styles).toContain("white-space: nowrap");
    expect(styles).toMatch(
      /\.content h1\s*\{[^}]*align-items:\s*center;[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s,
    );
    expect(styles).toMatch(
      /\.content h1 span\s*\{[^}]*margin-inline:\s*auto;[^}]*text-align:\s*center;[^}]*width:\s*max-content;/s,
    );
    expect(landing).toContain('aria-label="Programmable home"');
    expect(landing).toContain(
      'src="/brand/loop/programmable-loop-mark-header-warm-ivory-v1-1536.png"',
    );
    expect(landing).toContain("Create a token");
    expect(landing).toContain("Explore tokens");
    expect(landing).toContain("Developer docs");
    expect(landing).not.toContain("liquid-glass-distortion");
    expect(landing).toContain('aria-label="Programmable links"');
    expect(landing).toContain('aria-label="Programmable on X"');
    expect(landing).toContain('aria-label="Programmable on GitHub"');
    expect(landing).toContain('aria-label="Programmable on Dexscreener"');
    expect(landing).toContain('href="/docs/developers"');
    expect(navigation).toContain('if (pathname === "/") return null;');
    expect(landing).not.toContain("LandingBackdrop");
    expect(backdrop).not.toContain("<video");
    expect(landing).not.toContain("Built on Uniswap v4");
    expect(landing).not.toContain(
      "Choose a launch model and make it yours on Ethereum.",
    );

    for (const asset of [
      "night-sky-desktop-v1.avif",
      "night-sky-mobile-v1.avif",
    ]) {
      const assetPath = join(root, "public/brand/atmosphere", asset);
      expect(existsSync(assetPath)).toBe(true);
      expect(statSync(assetPath).size).toBeLessThan(300 * 1024);
    }

    for (const [asset, budget] of [
      ["night-sky-botanical-desktop-v2.avif", 450 * 1024],
      ["night-sky-botanical-desktop-v2-1920.avif", 180 * 1024],
      ["night-sky-botanical-mobile-v2.avif", 275 * 1024],
      ["night-sky-botanical-mobile-v2-720.avif", 60 * 1024],
      ["night-sky-botanical-mobile-v2-900.avif", 80 * 1024],
    ] as const) {
      const assetPath = join(root, "public/brand/atmosphere", asset);
      expect(existsSync(assetPath)).toBe(true);
      expect(statSync(assetPath).size).toBeLessThan(budget);
    }
  });

  it("keeps the hero full screen, readable and motion safe", () => {
    const styles = read("components/landing-page.module.css");

    expect(styles).toMatch(/\.page\s*\{[^}]*min-height:\s*100svh;/s);
    expect(styles).toMatch(/\.hero\s*\{[^}]*min-height:\s*100svh;/s);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(
      /\.primaryAction,[\s\S]*?min-width:\s*188px;/,
    );
    expect(styles).toMatch(
      /\.primaryAction:focus-visible,[\s\S]*?outline:\s*2px solid var\(--landing-ivory\);/,
    );
    expect(styles).toContain("--landing-ivory: #f8f0e9;");
    expect(styles).toMatch(
      /\.primaryAction,[\s\S]*?cursor:\s*pointer;/,
    );
    expect(styles).toMatch(
      /\.primaryAction,[\s\S]*?backdrop-filter:\s*blur\(16px\) saturate\(1\.08\);/,
    );
    expect(styles).toMatch(/border-radius:\s*18px;/);
    expect(styles).not.toContain("motionControl");
    expect(styles).not.toContain("primaryAction span");
    expect(styles).not.toContain("content-arrival");
  });

  it("keeps most stars static while independent sparkles twinkle only when motion is allowed", () => {
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const css = read("app/interface.css");

    expect(css).not.toContain(".atmosphere-botanical");
    expect(backdrop).toContain("Array.from({ length: 12 }");
    expect(css).not.toContain("@keyframes atmosphere-twinkle-primary");
    expect(css).not.toContain("@keyframes atmosphere-twinkle-secondary");
    expect(css).toContain("@keyframes atmosphere-sparkle");
    expect(css).not.toMatch(
      /\.atmosphere-stars-(?:primary|secondary)\s*\{[^}]*animation:/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*atmosphere-sparkle/,
    );
    expect(css).toContain("--sparkle-duration: 13.7s");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-stars\s*\{[^}]*animation:\s*none;/,
    );
  });
});
