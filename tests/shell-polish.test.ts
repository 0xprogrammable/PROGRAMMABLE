import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("public shell polish", () => {
  it("keeps the 404 page concise and preserves both recovery actions", () => {
    const source = read("app/not-found.tsx");

    expect(source).toContain("This page isn’t available.");
    expect(source).not.toContain("404 · Page not found");
    expect(source).toContain("Explore tokens");
    expect(source).toContain("Open docs");
  });

  it("uses one aligned footer link set without duplicate social icons", () => {
    const source = read("components/site-footer.tsx");

    expect(source).toContain("<span>Programmable</span>");
    expect(source).toContain("© 2026 Programmable");
    expect(source).toContain('label: "GitHub"');
    expect(source).toContain('label: "X"');
    expect(source).not.toContain("XBrandIcon");
    expect(source).not.toContain("GitHubBrandIcon");
  });

  it("keeps route motion short, interruptible and compositor-friendly", () => {
    const source = read("components/route-transition.tsx");

    expect(source).toContain('"(prefers-reduced-motion: reduce)"');
    expect(source).toContain("routeAnimationRef.current?.cancel()");
    expect(source).toContain("translate3d(0, 3px, 0)");
    expect(source).toContain("duration: enteringDocs ? 120 : 160");
    expect(source).not.toContain("key={pathname}");
  });

  it("makes the infrequent theme change a calm, bounded crossfade", () => {
    const source = read("components/site-navigation.tsx");
    const css = read("app/globals.css");

    expect(source).toContain("activeThemeViewTransition?.skipTransition()");
    expect(css).toContain(
      "theme-soft-reveal 380ms cubic-bezier(0.2, 0, 0, 1)",
    );
    expect(css).toContain(
      "theme-soft-fade 380ms cubic-bezier(0.2, 0, 0, 1)",
    );
    expect(css).not.toContain("clip-path: circle(");
  });

  it("avoids unbounded transitions in the owned style sheets", () => {
    const css = [
      read("app/globals.css"),
      read("app/not-found.module.css"),
      read("components/site-footer.module.css"),
    ].join("\n");

    expect(css).not.toMatch(/transition(?:-property)?:\s*all\b/);
  });
});
