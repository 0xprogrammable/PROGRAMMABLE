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

  it("uses one layered Night Garden atmosphere across every route without a video", () => {
    const landing = read("components/landing-page.tsx");
    const styles = read("components/landing-page.module.css");
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const interfaceStyles = read("app/interface.css");
    const layout = read("app/layout.tsx");
    const manifest = read("public/site.webmanifest");
    const navigation = read("components/site-navigation.tsx");

    expect(backdrop).not.toContain("night-sky-");
    expect(backdrop).not.toContain('"use client"');
    expect(backdrop).not.toContain("usePathname");
    expect(backdrop).not.toContain("<picture");
    expect(backdrop).not.toContain(".avif");
    expect(backdrop).toContain('import Image from "next/image"');
    expect(backdrop).toContain("const TWINKLE_COUNT = 36");
    expect(backdrop).toContain("const PLANT_SIZES");
    expect(backdrop).toContain('aria-hidden="true"');
    expect(backdrop).toContain('className="atmosphere-ground-glow"');
    expect(backdrop).toContain('className="atmosphere-botanicals"');
    expect(backdrop).toContain(
      "/brand/atmosphere/programmable-botanical-left-v2.webp",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/programmable-botanical-right-v2.webp",
    );
    expect(backdrop.match(/<Image/g)).toHaveLength(2);
    expect(backdrop.match(/width=\{1024\}/g)).toHaveLength(2);
    expect(backdrop.match(/height=\{1536\}/g)).toHaveLength(2);
    expect(backdrop.match(/sizes=\{PLANT_SIZES\}/g)).toHaveLength(2);
    expect(backdrop.match(/priority/g)).toHaveLength(2);
    expect(backdrop.match(/alt=""/g)).toHaveLength(2);
    expect(interfaceStyles).toMatch(
      /\.atmosphere-backdrop\s*\{[^}]*background:\s*#010103;/s,
    );
    expect(layout).toContain('themeColor: "#010103"');
    expect(manifest).toContain('"background_color": "#010103"');
    expect(manifest).toContain('"theme_color": "#010103"');
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
    expect(landing).toContain(
      '<nav className={styles.actions} aria-label="Get started">',
    );
    expect(landing).toMatch(/>\s*Docs\s*</);
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

    for (const [asset, budget] of [
      ["programmable-botanical-left-v2.webp", 110 * 1024],
      ["programmable-botanical-right-v2.webp", 95 * 1024],
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
    expect(styles).toContain("background: transparent;");
    expect(styles).toContain("border: 0;");
    expect(styles).toContain("min-height: 44px;");
    expect(styles).not.toContain("--button-shadow");
    expect(styles).not.toContain("backdrop-filter: blur(16px)");
    expect(styles).not.toContain(
      "background-color: rgba(248, 240, 233, 0.18)",
    );
    expect(styles).toMatch(
      /\.primaryAction:focus-visible,[\s\S]*?outline:\s*2px solid var\(--landing-ivory\);/,
    );
    expect(styles).toContain("--landing-ivory: #f8f0e9;");
    expect(styles).toMatch(
      /\.primaryAction,[\s\S]*?cursor:\s*pointer;/,
    );
    expect(styles).not.toContain("motionControl");
    expect(styles).not.toContain("primaryAction span");
    expect(styles).not.toContain("content-arrival");
  });

  it("keeps most stars static while sparkles and plants move independently when motion is allowed", () => {
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const css = read("app/interface.css");

    expect(css).toContain(".atmosphere-botanicals");
    expect(backdrop).toContain("const TWINKLE_COUNT = 36");
    expect(backdrop).toContain("Array.from({ length: TWINKLE_COUNT }");
    expect(css).not.toContain("@keyframes atmosphere-twinkle-primary");
    expect(css).not.toContain("@keyframes atmosphere-twinkle-secondary");
    expect(css).toContain("@keyframes atmosphere-sparkle");
    expect(css).not.toMatch(
      /\.atmosphere-stars-(?:primary|secondary)\s*\{[^}]*animation:/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*var\(--sparkle-animation\)/,
    );
    expect(css).toContain("--sparkle-duration: 13.7s");
    expect(css).toContain("@keyframes atmosphere-sparkle-soft");
    expect(css).toContain("@keyframes atmosphere-sparkle-double");
    expect(css).toContain(".atmosphere-sparkles i:nth-child(36)");
    expect(css).toContain(".atmosphere-sparkles i:nth-child(n + 25)");
    expect(css).toContain("@keyframes atmosphere-plant-left");
    expect(css).toContain("@keyframes atmosphere-plant-right");
    expect(css).toMatch(
      /\.atmosphere-plant-left\s*\{[^}]*animation:\s*atmosphere-plant-left 13\.6s[^}]*-7\.9s infinite;/s,
    );
    expect(css).toMatch(
      /\.atmosphere-plant-right\s*\{[^}]*animation:\s*atmosphere-plant-right 11\.9s[^}]*-3\.1s infinite;/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-plant\s*\{[^}]*animation:\s*none;/,
    );
  });
});
