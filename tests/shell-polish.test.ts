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
    expect(source).toContain('label: "Discord"');
    expect(source).toContain('label: "X"');
    expect(source).toContain('label: "Token"');
    expect(source).not.toContain("XBrandIcon");
    expect(source).not.toContain("GitHubBrandIcon");
  });

  it("keeps route motion measured, interruptible and compositor-friendly", () => {
    const source = read("components/route-transition.tsx");
    const interfaceStyles = read("app/interface.css");

    expect(source).toContain('"(prefers-reduced-motion: reduce)"');
    expect(source).toContain("routeAnimationRef.current?.cancel()");
    expect(source).toContain("translate3d(0, 12px, 0)");
    expect(source).toContain("duration: enteringDocs ? 420 : 720");
    expect(source).not.toContain("key={pathname}");
    expect(source).toContain('heading.dataset.routeAnnouncementFocus = "true"');
    expect(interfaceStyles).toMatch(
      /h1\[data-route-announcement-focus="true"\]:focus\s*\{[^}]*outline:\s*0;/s,
    );
  });

  it("renders one shared footer after every route and keeps it below the fold", () => {
    const shell = read("components/app-shell.tsx");
    const explore = read("components/explore-view.tsx");
    const docsLayout = read("app/docs/layout.tsx");
    const finalStyles = read("app/webde-final-ui.css");

    expect(shell).toContain("<RouteTransition>{children}</RouteTransition>");
    expect(shell).toContain("<SiteFooter />");
    expect(shell.indexOf("<SiteFooter />")).toBeGreaterThan(
      shell.indexOf("<RouteTransition>{children}</RouteTransition>"),
    );
    expect(explore).not.toContain("<SiteFooter />");
    expect(docsLayout).not.toContain("<SiteFooter />");
    expect(finalStyles).toMatch(
      /\.route-transition\s*\{[^}]*min-height:\s*calc\(100svh - 88px\);/s,
    );
  });

  it("locks the public shell to the night atmosphere without a theme control", () => {
    const layout = read("app/layout.tsx");
    const navigation = read("components/site-navigation.tsx");

    expect(layout).toContain('colorScheme: "dark"');
    expect(layout).toContain('data-theme="dark"');
    expect(navigation).not.toContain("ThemeToggle");
    expect(navigation).not.toContain("activeThemeViewTransition");
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
