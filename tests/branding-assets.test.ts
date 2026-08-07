import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

async function alphaBounds(path: string, threshold = 16) {
  const { data, info } = await sharp(join(root, path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha < threshold) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  return {
    width: right - left + 1,
    height: bottom - top + 1,
    top,
    bottom,
    canvasWidth: info.width,
    canvasHeight: info.height,
  };
}

describe("Programmable branding assets", () => {
  it("keeps the browser tab branded only as Programmable on every route", () => {
    const metadataSources = [
      "app/layout.tsx",
      "app/page.tsx",
      "app/explore/page.tsx",
      "app/launch/page.tsx",
      "app/docs/layout.tsx",
      "app/docs/developers/page.tsx",
      "app/docs/models/[model]/page.tsx",
    ].map(read);

    for (const source of metadataSources) {
      expect(source).toContain('title: "Programmable"');
    }

    const combinedSources = metadataSources.join("\n");
    for (const routeSpecificTitle of [
      'title: "Programmable — Launch what you imagine"',
      'title: "Explore — Programmable"',
      'title: "Create · Programmable"',
      'default: "Docs · Programmable"',
      'template: "%s · Programmable Docs"',
      'title: "Developer integrations"',
      "title: metadata.title",
    ]) {
      expect(combinedSources).not.toContain(routeSpecificTitle);
    }
  });

  it("uses the compact, transparent loop asset without enlarging the header hit box", () => {
    const navigation = read("components/site-navigation.tsx");
    const css = read("app/interface.css");

    expect(navigation).toContain(
      'src="/brand/loop/programmable-loop-mark-header-white-v1-1536.png"',
    );
    expect(css).toMatch(
      /\.wordmark-logo\s*{[^}]*height: 30px;[^}]*width: auto;/s,
    );
    expect(css).toMatch(
      /\.wordmark,\s*\.header-social-link\s*{[^}]*height: 44px;[^}]*width: 44px;/s,
    );
  });

  it("binds metadata to the cache-busted, tightly framed favicon set", () => {
    const layout = read("app/layout.tsx");
    const generator = read("scripts/generate-programmable-favicons.mjs");

    expect(layout).toContain('url: "/favicon-pastel-v3.ico"');
    expect(layout).toContain('url: "/favicon-pastel-v3-16x16.png"');
    expect(layout).toContain('url: "/favicon-pastel-v3-32x32.png"');
    expect(layout).toContain('url: "/favicon-pastel-v3-48x48.png"');
    expect(generator).toContain(
      '"programmable-loop-mark-transparent-v1.png"',
    );
    expect(generator).toContain("const inset = size <= 32 ? 1 : 2");
  });

  it("makes the loop visibly larger inside the fixed 16px browser box", async () => {
    const previous = await alphaBounds("public/favicon-pastel-v2-16x16.png");
    const current = await alphaBounds("public/favicon-pastel-v3-16x16.png");

    expect(current.canvasWidth).toBe(16);
    expect(current.canvasHeight).toBe(16);
    expect(current.width).toBeGreaterThan(previous.width);
    expect(current.height).toBeGreaterThan(previous.height);
    expect(current.top).toBeLessThanOrEqual(1);
    expect(current.bottom).toBeGreaterThanOrEqual(14);
  });
});
