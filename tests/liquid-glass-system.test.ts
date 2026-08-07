import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("Liquid Glass interface system", () => {
  it("defines the supplied distortion filter once at the app shell", () => {
    const shell = read("components/app-shell.tsx");
    const filter = read("components/liquid-glass-filter.tsx");

    expect(shell.match(/<LiquidGlassFilter \/>/g)).toHaveLength(1);
    expect(filter).toContain('id="glass-distortion"');
    expect(filter).toContain('baseFrequency="0.006 0.006"');
    expect(filter).toContain('numOctaves="2"');
    expect(filter).toContain('seed="92"');
    expect(filter).toContain('stdDeviation="2"');
    expect(filter).toContain('scale="45"');
    expect(filter).toContain('xChannelSelector="R"');
    expect(filter).toContain('yChannelSelector="G"');
  });

  it("reuses one material across the primary product surfaces", () => {
    const sources = [
      read("components/explore-view.tsx"),
      read("components/profile-view.tsx"),
      read("components/launch-entry.tsx"),
      read("components/launch-builder.tsx"),
      read("components/token-price-chart.tsx"),
      read("components/token-community-chat.tsx"),
      read("components/docs-code-preview.tsx"),
      read("components/developer-docs-workbench.tsx"),
    ];

    for (const source of sources) {
      expect(source).toContain("liquid-glass-");
    }
  });

  it("keeps global navigation frameless over the shared atmosphere", () => {
    const navigation = read("components/site-navigation.tsx");
    const css = read("app/interface.css");

    expect(navigation).not.toContain("liquid-glass-surface");
    expect(navigation).not.toContain("liquid-glass-distortion");
    expect(css).toMatch(
      /\.header-inner\s*\{[^}]*backdrop-filter:\s*none;[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
    );
    expect(css).not.toContain(
      ".header-inner,\n  .liquid-glass-surface,\n  .mobile-nav",
    );
  });

  it("keeps distortion off large reading and workspace surfaces", () => {
    const css = read("app/interface.css");
    const sources = [
      read("components/profile-view.tsx"),
      read("components/launch-entry.tsx"),
      read("components/launch-builder.tsx"),
      read("components/token-price-chart.tsx"),
      read("components/token-community-chat.tsx"),
      read("components/docs-code-preview.tsx"),
      read("components/developer-docs-workbench.tsx"),
      read("components/site-footer.tsx"),
    ];

    for (const source of sources) {
      expect(source).not.toContain("liquid-glass-distortion");
    }

    expect(css).not.toContain(".liquid-glass-surface::after,");
    expect(css).toMatch(/\.liquid-glass-distortion::after\s*\{/);
  });

  it("keeps motion explicit and preserves a solid fallback", () => {
    const css = [
      read("app/interface.css"),
      read("components/landing-page.module.css"),
      read("components/explore-experience.module.css"),
      read("components/profile-experience.module.css"),
      read("components/launch-experience.module.css"),
      read("components/token-experience.module.css"),
      read("components/docs-experience.module.css"),
      read("components/developer-docs.module.css"),
    ].join("\n");

    expect(css).not.toMatch(/transition(?:-property)?:\s*all\b/);
    expect(css).toContain('filter: url("#glass-distortion")');
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("@supports not ((-webkit-backdrop-filter: blur(1px))");
  });
});
