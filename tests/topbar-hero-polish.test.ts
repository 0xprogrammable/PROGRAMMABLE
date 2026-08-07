import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("topbar and Explore hero polish", () => {
  it("keeps the page plane continuous behind a frameless navigation", () => {
    const interfaceCss = read("app/interface.css");

    expect(interfaceCss).toMatch(
      /\.site-header\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
    );
    expect(interfaceCss).toMatch(
      /\.header-inner\s*\{[^}]*backdrop-filter:\s*none;[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;[^}]*max-width:\s*none;[^}]*width:\s*100%;/s,
    );
    expect(interfaceCss).not.toContain(
      ".header-inner,\n  .liquid-glass-surface,\n  .mobile-nav",
    );
  });

  it("uses text and a fine underline for active desktop navigation", () => {
    const interfaceCss = read("app/interface.css");

    expect(interfaceCss).toMatch(
      /\.desktop-nav\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;[^}]*padding:\s*0;/s,
    );
    expect(interfaceCss).toMatch(
      /\.desktop-nav a\.active\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;[^}]*color:\s*var\(--navigation-glass-ink\);/s,
    );
    expect(interfaceCss).toMatch(
      /\.desktop-nav a\.active::after\s*\{[^}]*opacity:\s*1;[^}]*width:\s*18px;/s,
    );
    expect(interfaceCss).toMatch(
      /\.wordmark:focus-visible,[\s\S]*?\.mobile-nav a:focus-visible\s*\{[^}]*box-shadow:\s*0 0 0 5px rgba\(3, 8, 24, 0\.86\);[^}]*outline:\s*2px solid #fffdf9;/s,
    );
  });

  it("keeps app navigation compact and moves landing links below the hero actions", () => {
    const navigation = read("components/site-navigation.tsx");
    const landing = read("components/landing-page.tsx");
    const landingCss = read("components/landing-page.module.css");
    const interfaceCss = read("app/interface.css");

    expect(landing).toContain(
      "https://dexscreener.com/ethereum/0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0",
    );
    expect(landing).toContain(
      'src="/brand/platforms/dexscreener-mark-white.png"',
    );
    expect(landing).toContain('aria-label="Programmable on X"');
    expect(landing).toContain('aria-label="Programmable on GitHub"');
    expect(landing).toContain('aria-label="Programmable on Dexscreener"');
    expect(landing).toContain('href="/docs/developers"');
    expect(landing).toContain("Developer docs");
    expect(navigation).not.toContain("ThemeToggle");
    expect(navigation).toContain('if (pathname === "/") return null;');
    expect(navigation).toContain("<WalletButton compact />");
    expect(navigation).not.toContain("liquid-glass-surface");
    expect(navigation).not.toContain("lucide-react");
    expect(navigation).toContain('if (href === "/docs/developers")');
    expect(interfaceCss).toMatch(
      /@media \(min-width: 801px\)[\s\S]*?\.header-inner\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);[^}]*justify-content:\s*stretch;/s,
    );
    expect(interfaceCss).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.header-inner\s*\{[^}]*grid-template-columns:\s*auto minmax\(0, 1fr\);[^}]*justify-content:\s*stretch;[^}]*max-width:\s*none;[^}]*width:\s*100%;/s,
    );
    expect(interfaceCss).toMatch(
      /@media \(max-width: 800px\)[\s\S]*?\.mobile-nav\s*\{[^}]*backdrop-filter:\s*none;[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
    );
    expect(interfaceCss).toMatch(
      /@media \(min-width: 801px\) and \(max-width: 960px\)[\s\S]*?\.desktop-nav\s*\{[^}]*display:\s*none;[^}]*\}[\s\S]*?\.mobile-nav\s*\{[^}]*display:\s*grid;/s,
    );
    expect(landingCss).toMatch(
      /\.socialLink\s*\{[^}]*height:\s*44px;[^}]*width:\s*44px;/s,
    );
    expect(landingCss).toMatch(
      /\.socialLink svg,\s*\.socialLogo\s*\{[^}]*height:\s*24px;[^}]*width:\s*24px;/s,
    );
    expect(landingCss).toMatch(
      /\.docsLink\s*\{[^}]*font-size:\s*16px;/s,
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
