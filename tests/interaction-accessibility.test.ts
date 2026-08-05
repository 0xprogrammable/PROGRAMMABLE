import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getPriceHistoryEmptyMessage,
  shouldRenderPriceHistory,
} from "../components/token-price-chart";

const root = process.cwd();

function collectCssFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectCssFiles(path);
    return extname(entry.name) === ".css" ? [path] : [];
  });
}

describe("interaction accessibility", () => {
  it("makes exact chart prices available to pointer and keyboard input", () => {
    const chartCss = readFileSync(
      join(root, "components/token-price-chart.module.css"),
      "utf8",
    );
    const chartSource = readFileSync(
      join(root, "components/token-price-chart.tsx"),
      "utf8",
    );

    expect(chartCss).not.toContain("cursor: crosshair");
    expect(chartSource).toContain("onPointerMove={inspectPointer}");
    expect(chartSource).toContain("onKeyDown={inspectKeyboard}");
    expect(chartSource).toContain("tabIndex={0}");
    expect(chartSource).not.toContain("role=\"slider\"");
  });

  it("removes decorative token separators and image-edge outlines", () => {
    const tokenCss = readFileSync(
      join(root, "components/token-experience.module.css"),
      "utf8",
    );
    const exploreCss = readFileSync(
      join(root, "components/explore-experience.module.css"),
      "utf8",
    );
    const launchCss = readFileSync(
      join(root, "components/launch-experience.module.css"),
      "utf8",
    );

    expect(tokenCss).not.toContain("border-bottom:");
    expect(tokenCss).not.toContain("border-top:");
    expect(exploreCss).not.toMatch(/\.runnerArt\s*\{[^}]*outline:/s);
    expect(launchCss).not.toMatch(/\.modelArt\s*\{[^}]*outline:/s);
  });

  it("keeps the default arrow cursor policy across app controls", () => {
    const css = [
      ...collectCssFiles(join(root, "app")),
      ...collectCssFiles(join(root, "components")),
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(css).not.toMatch(/cursor:\s*(?:pointer|not-allowed)\b/);
  });

  it("keeps the interface dark-only without exposing a theme toggle", () => {
    const source = readFileSync(
      join(root, "components/site-navigation.tsx"),
      "utf8",
    );
    const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");

    expect(layout).toContain('data-theme="dark"');
    expect(layout).toContain('colorScheme: "dark"');
    expect(layout).not.toContain("themeInitializationScript");
    expect(source).not.toContain("ThemeToggle");
    expect(source).not.toContain("programmable-theme");
  });

  it("stops decorative atmosphere motion for reduced-motion users", () => {
    const source = readFileSync(
      join(root, "components/atmosphere-backdrop.tsx"),
      "utf8",
    );
    const css = readFileSync(join(root, "app/interface.css"), "utf8");

    expect(source).toContain('className="atmosphere-stars');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-botanical\s*\{[^}]*transition:\s*none;/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-stars\s*\{[^}]*animation:\s*none;/,
    );
  });

  it("exposes the wallet actions as a native, labelled disclosure", () => {
    const source = readFileSync(
      join(root, "components/wallet-provider.tsx"),
      "utf8",
    );

    expect(source).toContain('href="/profile"');
    expect(source).toContain("aria-controls={wallet ? menuId : undefined}");
    expect(source).toContain('role="group"');
    expect(source).toContain('aria-label="Wallet actions"');
    expect(source).toContain("event.relatedTarget instanceof Node");
    expect(source).toContain(
      "event.currentTarget.contains(event.relatedTarget)",
    );
  });

  it("dismisses the wallet disclosure with Escape and outside pointer input", () => {
    const source = readFileSync(
      join(root, "components/wallet-provider.tsx"),
      "utf8",
    );

    expect(source).toContain(
      'document.addEventListener("pointerdown", closeOnOutsidePress)',
    );
    expect(source).toContain('if (event.key === "Escape")');
    expect(source).toContain("menuButtonRef.current?.focus()");
  });

  it("keeps the sticky header and its wallet disclosure above page content", () => {
    const css = readFileSync(join(root, "app/interface.css"), "utf8");

    expect(css).not.toContain(".app-frame > main,\n.site-header,\n.mobile-nav");
    expect(css).toMatch(
      /\.site-header\s*\{[^}]*position:\s*sticky;[^}]*z-index:\s*50;/s,
    );
  });

  it("keeps the landing header wallet-free while retaining its market links", () => {
    const source = readFileSync(
      join(root, "components/site-navigation.tsx"),
      "utf8",
    );
    const css = readFileSync(
      join(root, "components/landing-page.module.css"),
      "utf8",
    );

    expect(source).toContain("{!isLandingPage ? <WalletButton compact /> : null}");
    expect(css).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?site-header--landing \.header-socials[\s\S]*?display:\s*flex/,
    );
  });

  it("keeps all four primary routes semantic and reflow-safe in mobile navigation", () => {
    const source = readFileSync(
      join(root, "components/site-navigation.tsx"),
      "utf8",
    );
    const styleSheets = [
      readFileSync(join(root, "app/interface.css"), "utf8"),
      readFileSync(join(root, "app/globals.css"), "utf8"),
    ];
    const mobileMediaSegments = styleSheets.flatMap((css) => {
      const segments: string[] = [];
      const query = "@media (max-width: 800px)";
      let start = css.indexOf(query);
      while (start >= 0) {
        const next = css.indexOf("\n@media ", start + query.length);
        segments.push(css.slice(start, next >= 0 ? next : css.length));
        start = css.indexOf(query, start + query.length);
      }
      return segments;
    });

    expect(source).toContain('const mobileNavItems = desktopNavItems;');
    expect(source).toContain(
      '<nav className="mobile-nav" aria-label="Primary navigation">',
    );
    expect(source).toContain(
      'aria-current={current ? "page" : undefined}',
    );
    expect(source).toContain('<Icon aria-hidden="true"');
    expect(mobileMediaSegments).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /\.mobile-nav\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
        ),
        expect.stringMatching(/\.mobile-nav a\s*\{[^}]*min-width:\s*0/),
      ]),
    );
  });

  it("fails the public Classic launch card closed when its verified release is unavailable", () => {
    const source = readFileSync(
      join(root, "components/launch-entry.tsx"),
      "utf8",
    );

    expect(source).toContain("disabled={!classicV3LaunchAvailable}");
    expect(source).toContain(
      'model === "classic-v3" && !classicV3LaunchAvailable',
    );
    expect(source).not.toContain(
      'classicV3LaunchAvailable ? "classic-v3" : "classic"',
    );
  });

  it("does not promise unsupported Stock-Paired chart history", () => {
    expect(getPriceHistoryEmptyMessage("stock-paired", false)).toBe(
      "Historical price data is not available for Stock-Paired tokens",
    );
    expect(getPriceHistoryEmptyMessage("classic", false)).toBe(
      "Price history appears after confirmed trades",
    );
  });

  it("keeps the chart surface available without price history", () => {
    expect(
      shouldRenderPriceHistory({
        loading: false,
        hasChart: false,
        range: "all",
      }),
    ).toBe(true);
    expect(
      shouldRenderPriceHistory({
        loading: false,
        hasChart: false,
        range: "1h",
      }),
    ).toBe(true);
  });
});
