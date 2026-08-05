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
      '{ href: "/explore", label: "Explore", icon: Compass }',
    );
  });

  it("uses responsive static atmosphere layers without a video", () => {
    const landing = read("components/landing-page.tsx");
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const navigation = read("components/site-navigation.tsx");

    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-desktop-v1.avif",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-mobile-v1.avif",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-botanical-desktop-v1.avif",
    );
    expect(backdrop).toContain(
      "/brand/atmosphere/night-sky-botanical-mobile-v1.avif",
    );
    expect(backdrop).toContain('media="(max-width: 640px)"');
    expect(backdrop).toContain('data-landing={isLandingPage ? "true" : "false"}');
    expect(backdrop).toContain('fetchPriority="high"');
    expect(landing).toContain('href="/launch"');
    expect(landing).toContain('href="/explore"');
    expect(landing).toContain(
      "Launch tokens that behave exactly how you imagine",
    );
    expect(landing).toContain('aria-label="Programmable home"');
    expect(landing).toContain(
      'src="/brand/loop/programmable-loop-mark-header.png"',
    );
    expect(landing).toContain("Create a Token");
    expect(landing).toContain("Explore Tokens");
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
      "night-sky-botanical-desktop-v1.avif",
      "night-sky-botanical-mobile-v1.avif",
    ]) {
      const assetPath = join(root, "public/brand/atmosphere", asset);
      expect(existsSync(assetPath)).toBe(true);
      expect(statSync(assetPath).size).toBeLessThan(300 * 1024);
    }
  });

  it("keeps the hero full screen, readable and motion safe", () => {
    const styles = read("components/landing-page.module.css");

    expect(styles).toMatch(/\.page\s*\{[^}]*min-height:\s*100svh;/s);
    expect(styles).toMatch(/\.hero\s*\{[^}]*min-height:\s*100svh;/s);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(
      /\.primaryAction,[\s\S]*?width:\s*188px;/,
    );
    expect(styles).toMatch(
      /\.primaryAction:focus-visible,[\s\S]*?outline:\s*3px solid #fffdf9;/,
    );
    expect(styles).not.toContain("motionControl");
    expect(styles).not.toContain("primaryAction span");
    expect(styles).not.toContain("content-arrival");
  });

  it("fades only the static plants while the stars keep twinkling", () => {
    const css = read("app/interface.css");

    expect(css).toMatch(
      /\.atmosphere-botanical\s*\{[^}]*opacity:\s*0;[^}]*transition:\s*opacity 2200ms/s,
    );
    expect(css).toMatch(
      /\.atmosphere-backdrop\[data-landing="true"\] \.atmosphere-botanical\s*\{[^}]*opacity:\s*1;/s,
    );
    expect(css).toContain("@keyframes atmosphere-twinkle-primary");
    expect(css).toContain("@keyframes atmosphere-twinkle-secondary");
    expect(css).toContain("@keyframes atmosphere-sparkle");
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-stars\s*\{[^}]*animation:\s*none;/,
    );
  });
});
