import { existsSync, readFileSync } from "node:fs";
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

  it("uses separate optimized artwork for desktop and mobile", () => {
    const landing = read("components/landing-page.tsx");

    expect(landing).toContain(
      "/brand/landing/programmable-botanical-cosmos-desktop-v1.avif",
    );
    expect(landing).toContain(
      "/brand/landing/programmable-botanical-cosmos-mobile-v1.avif",
    );
    expect(landing).toContain('media="(max-width: 640px)"');
    expect(landing).toContain('href="/launch"');
    expect(landing).toContain('href="/explore"');
    expect(
      existsSync(
        join(
          root,
          "public/brand/landing/programmable-botanical-cosmos-desktop-v1.avif",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          root,
          "public/brand/landing/programmable-botanical-cosmos-mobile-v1.avif",
        ),
      ),
    ).toBe(true);
  });

  it("keeps the hero full screen, readable and motion safe", () => {
    const styles = read("components/landing-page.module.css");

    expect(styles).toMatch(/\.page\s*\{[^}]*min-height:\s*100svh;/s);
    expect(styles).toMatch(/\.hero\s*\{[^}]*min-height:\s*100svh;/s);
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toMatch(
      /\.primaryAction:focus-visible,[\s\S]*?outline:\s*3px solid #fffdf9;/,
    );
    expect(styles).not.toContain("content-arrival");
  });
});
