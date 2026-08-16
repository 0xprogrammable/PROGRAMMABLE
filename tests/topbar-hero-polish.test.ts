import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("topbar and Explore hero polish", () => {
  it("keeps the page plane continuous behind a frameless navigation", () => {
    const css = read("app/webde-final-ui.css");

    expect(css).toMatch(
      /\.site-header,[\s\S]*?\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
    );
    expect(css).toMatch(
      /\.header-inner\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;[^}]*height:\s*88px;[^}]*max-width:\s*1440px;/s,
    );
  });

  it("uses large white navigation text without an active underline", () => {
    const css = read("app/webde-final-ui.css");

    expect(css).toMatch(
      /\.desktop-nav\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;[^}]*padding:\s*0;/s,
    );
    expect(css).toMatch(
      /\.desktop-nav a,[\s\S]*?\.desktop-nav a\.active\s*\{[^}]*color:\s*var\(--webde-ink\);[^}]*font-size:\s*17px;/s,
    );
    expect(css).toMatch(
      /\.desktop-nav a::after,[\s\S]*?\.desktop-nav a\.active::after\s*\{[^}]*display:\s*none;/s,
    );
  });

  it("keeps one ordered navigation with social links and wallet access on every route", () => {
    const navigation = read("components/site-navigation.tsx");
    const landing = read("components/landing-page.tsx");
    const landingCss = read("components/landing-page.module.css");
    const navigationCss = read("components/site-navigation.module.css");

    expect(navigation).toContain(
      "https://dexscreener.com/ethereum/0xd9ca22573437a06a12d5c757b151aa1a76265c1dfdde4b76507233d7ad2b6df0",
    );
    expect(navigation).toContain(
      'src="/brand/platforms/dexscreener-mark-warm-ivory-v1.png"',
    );
    expect(navigation).toContain('aria-label="Programmable on X"');
    expect(navigation).toContain('aria-label="Programmable on GitHub"');
    expect(navigation).toContain('aria-label="Programmable on Discord"');
    expect(navigation).toContain('aria-label="Programmable on Dexscreener"');
    expect(navigation).toContain('aria-label="Programmable analytics on Dune"');
    expect(navigation).toContain(
      "https://dune.com/0xprogrammable6098/programmable-analytics",
    );
    expect(navigation.indexOf('aria-label="Programmable on Dexscreener"')).toBeLessThan(
      navigation.indexOf('aria-label="Programmable analytics on Dune"'),
    );
    expect(navigation.indexOf('aria-label="Programmable analytics on Dune"')).toBeLessThan(
      navigation.indexOf('aria-label="Programmable on Discord"'),
    );
    expect(landing).toContain('href="/docs"');
    expect(landing).toContain("Read more in our docs");
    expect(navigation).not.toContain("ThemeToggle");
    expect(navigation).not.toContain('if (pathname === "/") return null;');
    expect(navigation).toContain("<WalletButton compact />");
    expect(navigation).not.toContain("liquid-glass-surface");
    expect(navigation).not.toContain("lucide-react");
    expect(navigation).toContain('if (activePath === "/docs")');
    for (const label of ["Explore", "Create", "Profile", "Docs"]) {
      expect(navigation).toContain(`label: "${label}"`);
    }
    expect(navigationCss).toContain(
      "@media (max-width: 60rem) and (hover: none) and (pointer: coarse)",
    );
    expect(navigationCss).toContain(
      "@media (max-width: 60rem) and (hover: hover) and (pointer: fine)",
    );
    expect(navigationCss).toContain(
      "grid-template-columns: repeat(4, minmax(0, 1fr))",
    );
    expect(navigation).toContain("<HeaderSocialLinks mobile />");
    expect(navigationCss).not.toContain("@media (max-width: 60rem) {");
    expect(navigationCss).toMatch(
      /@media \(max-width: 60rem\) and \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.siteHeader\.siteHeader :global\(\.desktop-nav\)\s*\{[^}]*display:\s*flex;[\s\S]*?\.menuButton,[\s\S]*?\.mobileSheet\s*\{[^}]*display:\s*none;/s,
    );
    expect(navigationCss).toMatch(
      /@media \(max-width: 60rem\) and \(hover: none\) and \(pointer: coarse\)[\s\S]*?\.menuButton\s*\{[^}]*display:\s*inline-flex;[\s\S]*?\.mobileSocials\s*\{[^}]*display:\s*flex;/s,
    );
    expect(landingCss).toMatch(
      /\.docsLink\s*\{[^}]*font-size:\s*18px;/s,
    );
  });

  it("keeps the wallet menu mounted for a smooth accessible exit", () => {
    const wallet = read("components/wallet-provider.tsx");
    const css = read("app/webde-final-ui.css");

    expect(wallet).toContain('menuOpen ? "wallet-menu-open" : "wallet-menu-closed"');
    expect(wallet).toContain("aria-hidden={!menuOpen}");
    expect(wallet).toContain("tabIndex={menuOpen ? undefined : -1}");
    expect(css).toMatch(
      /\.wallet-menu\.wallet-menu-open\s*\{[^}]*opacity:\s*1;[^}]*transform:\s*translate3d\(0, 0, 0\) scale\(1\);/s,
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
