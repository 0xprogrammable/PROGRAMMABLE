import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const docsCss = readFileSync(
  join(root, "components/docs-experience.module.css"),
  "utf8",
);
const docsShell = readFileSync(
  join(root, "components/docs-shell.tsx"),
  "utf8",
);
const interfaceCss = readFileSync(join(root, "app/interface.css"), "utf8");

describe("Docs rail layout stability", () => {
  it("keeps the desktop rail sticky in its own full-height grid column", () => {
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*--docs-layout-width:\s*1116px;[^}]*--docs-rail-width:\s*236px;/s,
    );
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*grid-template-columns:[^}]*var\(--docs-rail-width\)[^}]*minmax\(0,\s*var\(--docs-content-width\)\);/s,
    );
    expect(docsCss).toMatch(
      /\.sidebar\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1 \/ span 2;[^}]*inline-size:\s*var\(--docs-rail-width\);[^}]*position:\s*sticky;[^}]*top:\s*calc\(var\(--header-height\) \+ 16px\);/s,
    );
    expect(docsCss).toMatch(
      /\.layout\s*\{[^}]*grid-column:\s*2;/s,
    );
  });

  it("keeps the mobile disclosure fixed to the page inset", () => {
    expect(docsCss).toMatch(
      /@media \(max-width:\s*900px\)[\s\S]*?\.sidebar\s*\{[^}]*inline-size:\s*auto;[^}]*inset-inline:\s*24px;[^}]*position:\s*fixed;[^}]*top:\s*calc\(var\(--header-height\) \+ 8px\);/s,
    );
    expect(docsCss).toMatch(
      /@media \(max-width:\s*700px\)[\s\S]*?\.sidebar\s*\{[^}]*inset-inline:\s*14px;/s,
    );
  });

  it("does not animate the whole Docs shell during route changes", () => {
    expect(interfaceCss).toMatch(
      /\.route-transition-docs\s*\{\s*animation:\s*none;\s*\}/s,
    );
    expect(docsShell).toContain("data-docs-sidebar");
    expect(docsShell).toContain("data-docs-content");
    expect(docsShell.indexOf("data-docs-hero")).toBeLessThan(
      docsShell.indexOf("data-docs-sidebar"),
    );
  });
});
