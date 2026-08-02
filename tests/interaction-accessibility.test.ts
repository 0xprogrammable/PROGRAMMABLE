import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getChartPointIndex,
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
  it("keeps the default arrow cursor policy across app controls", () => {
    const css = [
      ...collectCssFiles(join(root, "app")),
      ...collectCssFiles(join(root, "components")),
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(css).not.toMatch(/cursor:\s*(?:pointer|not-allowed)\b/);
  });

  it("uses an action label without a conflicting pressed state on the theme toggle", () => {
    const source = readFileSync(
      join(root, "components/site-navigation.tsx"),
      "utf8",
    );

    expect(source).toContain('theme === "dark" ? "Switch to light mode"');
    expect(source).not.toContain('aria-pressed={theme === "dark"}');
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

  it("maps chart pointer coordinates to a bounded point index", () => {
    expect(
      getChartPointIndex({
        clientX: 100,
        left: 100,
        width: 400,
        pointCount: 5,
      }),
    ).toBe(0);
    expect(
      getChartPointIndex({
        clientX: 300,
        left: 100,
        width: 400,
        pointCount: 5,
      }),
    ).toBe(2);
    expect(
      getChartPointIndex({
        clientX: 900,
        left: 100,
        width: 400,
        pointCount: 5,
      }),
    ).toBe(4);
    expect(
      getChartPointIndex({
        clientX: 100,
        left: 100,
        width: 0,
        pointCount: 5,
      }),
    ).toBeNull();
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
