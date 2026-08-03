import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("topbar and Explore hero polish", () => {
  it("keeps the sticky header on the same visual plane as the page", () => {
    const globalCss = read("app/globals.css");
    const interfaceCss = read("app/interface.css");

    for (const css of [globalCss, interfaceCss]) {
      expect(css).toMatch(
        /\.site-header\s*\{[^}]*background:\s*var\(--body-background\);[^}]*border:\s*0;[^}]*box-shadow:\s*none;/s,
      );
    }
    expect(globalCss).not.toMatch(
      /@media \(max-width:\s*800px\)[\s\S]*?\.site-header\s*\{[^}]*border-bottom:/s,
    );
  });

  it("uses whitespace instead of a plate around desktop navigation", () => {
    const interfaceCss = read("app/interface.css");

    expect(interfaceCss).toMatch(
      /\.desktop-nav\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*box-shadow:\s*none;[^}]*padding:\s*0;/s,
    );
    expect(interfaceCss).toMatch(
      /\.desktop-nav a\.active\s*\{[^}]*background:\s*var\(--accent-soft\);[^}]*box-shadow:\s*none;/s,
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
