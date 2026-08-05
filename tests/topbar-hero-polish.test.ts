import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("topbar and Explore hero polish", () => {
  it("keeps the page plane clean and contains navigation in midnight glass", () => {
    const globalCss = read("app/globals.css");
    const interfaceCss = read("app/interface.css");

    expect(globalCss).toMatch(
      /\.site-header\s*\{[^}]*background:\s*var\(--body-background\);[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
    );
    expect(interfaceCss).toMatch(
      /\.site-header\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
    );
    expect(interfaceCss).toMatch(
      /\.header-inner\s*\{[^}]*backdrop-filter:\s*var\(--navigation-glass-backdrop\);[^}]*background:\s*var\(--navigation-glass-background\);[^}]*border:\s*1px solid var\(--navigation-glass-border\);[^}]*border-radius:\s*var\(--radius-panel\);[^}]*box-shadow:\s*var\(--navigation-glass-shadow\);/s,
    );
    expect(globalCss).not.toMatch(
      /@media \(max-width:\s*800px\)[\s\S]*?\.site-header\s*\{[^}]*border-bottom:/s,
    );
  });

  it("uses a restrained glass state for active desktop navigation", () => {
    const interfaceCss = read("app/interface.css");

    expect(interfaceCss).toMatch(
      /\.desktop-nav\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;[^}]*padding:\s*0;/s,
    );
    expect(interfaceCss).toMatch(
      /\.desktop-nav a\.active\s*\{[^}]*background:\s*var\(--navigation-glass-accent\);[^}]*box-shadow:\s*inset 0 1px 0 rgba\(255, 255, 255, 0\.055\);[^}]*color:\s*var\(--navigation-glass-ink\);/s,
    );
  });

  it("keeps one glass topbar and exposes the verified market link", () => {
    const navigation = read("components/site-navigation.tsx");
    const landingCss = read("components/landing-page.module.css");

    expect(navigation).toContain(
      "https://dexscreener.com/ethereum/0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0",
    );
    expect(navigation).toContain(
      'src="/brand/platforms/dexscreener-mark-white.png"',
    );
    expect(navigation).toContain('aria-label="Programmable on Dexscreener"');
    expect(landingCss).toMatch(
      /:global\(\.site-header--landing\)\s*\{[^}]*position:\s*fixed;[^}]*width:\s*100%;/s,
    );
    expect(landingCss).not.toContain(
      ":global(.site-header--landing .header-inner)",
    );
    expect(landingCss).not.toMatch(
      /site-header--landing \.header-socials[\s\S]*?display:\s*none/u,
    );
  });

  it("centers the Explore headline and only forces one line on wide screens", () => {
    const css = read("components/explore-experience.module.css");

    expect(css).toMatch(
      /\.pageHeading\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/s,
    );
    expect(css).toMatch(
      /@media \(min-width:\s*960px\)\s*\{\s*\.pageHeading h1\s*\{[^}]*white-space:\s*nowrap;/s,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*700px\)[\s\S]*?\.pageHeading h1\s*\{[^}]*max-width:\s*16ch;[^}]*white-space:\s*normal;/s,
    );
  });
});
