import { readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  getChartPointIndex,
  getPriceHistoryEmptyMessage,
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
    const css = [...collectCssFiles(join(root, "app")), ...collectCssFiles(join(root, "components"))]
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
    expect(
      getPriceHistoryEmptyMessage("stock-paired", false),
    ).toBe(
      "Historical price data is not available for Stock-Paired tokens",
    );
    expect(
      getPriceHistoryEmptyMessage("classic", false),
    ).toBe("Price history appears after confirmed trades");
  });
});
