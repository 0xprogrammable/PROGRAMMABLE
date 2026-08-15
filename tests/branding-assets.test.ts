import { readFileSync, statSync } from "node:fs";
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
  it("keeps product routes branded and gives Docs pages descriptive titles", () => {
    const metadataSources = [
      "app/layout.tsx",
      "app/page.tsx",
      "app/explore/page.tsx",
      "app/launch/page.tsx",
    ].map(read);

    for (const source of metadataSources) {
      expect(source).toContain('title: "Programmable"');
    }

    const combinedSources = metadataSources.join("\n");
    expect(read("app/docs/layout.tsx")).toContain(
      'title: "Documentation · Programmable"',
    );
    expect(read("app/docs/developers/page.tsx")).toContain(
      'title: "Developer integration · Programmable"',
    );
    expect(read("app/docs/models/[model]/page.tsx")).toContain(
      "title: `${metadata.title} · Programmable`",
    );
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
    const css = read("app/webde-final-ui.css");

    expect(navigation).toContain(
      'src="/brand/loop/programmable-loop-mark-header-white-v1-1536.png"',
    );
    expect(css).toMatch(
      /\.wordmark-logo\s*{[^}]*height: 40px;[^}]*width: 32px;/s,
    );
    expect(css).toMatch(
      /\.wordmark,\s*\.header-social-link\s*{[^}]*height: 48px;[^}]*width: 48px;/s,
    );
  });

  it("uses the current Warm Ivory loop mark in the Privy login modal", () => {
    const walletProvider = read("components/wallet-provider.tsx");

    expect(walletProvider).toContain(
      'logo: "/brand/loop/programmable-loop-mark-warm-ivory-v1-1536.png"',
    );
    expect(walletProvider).not.toContain('logo: "/icon-512.png"');
  });

  it("binds metadata to the cache-busted, tightly framed favicon set", () => {
    const layout = read("app/layout.tsx");

    expect(layout).toContain('url: "/favicon-warm-ivory-v1.ico"');
    expect(layout).toContain('url: "/favicon-warm-ivory-v1-16x16.png"');
    expect(layout).toContain('url: "/favicon-warm-ivory-v1-32x32.png"');
    expect(layout).toContain('url: "/favicon-warm-ivory-v1-48x48.png"');
  });

  it("keeps the Warm Ivory favicon transparent and tightly framed", async () => {
    const current = await alphaBounds("public/favicon-warm-ivory-v1-16x16.png");
    const { data, info } = await sharp(
      join(root, "public/favicon-warm-ivory-v1-48x48.png"),
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const coreColors: Array<[number, number, number]> = [];

    for (let index = 0; index < data.length; index += info.channels) {
      if (data[index + 3] < 250) continue;
      coreColors.push([data[index], data[index + 1], data[index + 2]]);
    }

    expect(current.canvasWidth).toBe(16);
    expect(current.canvasHeight).toBe(16);
    expect(current.top).toBeLessThanOrEqual(1);
    expect(current.bottom).toBeGreaterThanOrEqual(14);
    expect(coreColors.length).toBeGreaterThan(0);
    expect(coreColors).toContainEqual([248, 240, 233]);
    expect(
      coreColors.every(
        ([red, green, blue]) =>
          red >= 248 &&
          red <= 252 &&
          green >= 240 &&
          green <= 244 &&
          blue >= 233 &&
          blue <= 237,
      ),
    ).toBe(true);
  });

  it("uses the black-sky floral link preview and exact product description", async () => {
    const layout = read("app/layout.tsx");
    const path = "public/og/programmable-loop-og-1200x630.png";
    const metadata = await sharp(join(root, path)).metadata();
    const topCenter = await sharp(join(root, path))
      .extract({ left: 598, top: 10, width: 4, height: 4 })
      .removeAlpha()
      .raw()
      .toBuffer();

    expect(layout).toContain('const siteDescription = "Shape what assets can do"');
    expect(layout).not.toContain("Create tokens with a clear launch model");
    expect(layout).toContain('"/og/programmable-loop-og-1200x630.png"');
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
    expect(statSync(join(root, path)).size).toBeLessThan(1024 * 1024);
    expect([...topCenter].every((channel) => channel <= 4)).toBe(true);
  });

  it("keeps the global star field dense, round and motion-safe", () => {
    const backdrop = read("components/atmosphere-backdrop.tsx");
    const css = read("app/webde-final-ui.css");

    expect(backdrop).toContain("atmosphere-sparkles-dense");
    expect(backdrop).toContain("atmosphere-sparkles-accent");
    expect(css).toMatch(
      /\.atmosphere-backdrop\s*\{[^}]*background:\s*var\(--webde-canvas\);[^}]*pointer-events:\s*none;/s,
    );
    expect(css).toMatch(
      /\.atmosphere-sparkles i\s*\{[^}]*border-radius:\s*50%;[^}]*box-shadow:\s*0 0 3px/s,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*var\(--sparkle-animation\)/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.atmosphere-sparkles i\s*\{[^}]*animation:\s*none;[^}]*will-change:\s*auto;/,
    );
  });
});
