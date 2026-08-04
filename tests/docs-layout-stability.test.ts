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
const docsNavigation = readFileSync(
  join(root, "components/docs-navigation.tsx"),
  "utf8",
);
const docsPage = readFileSync(join(root, "app/docs/page.tsx"), "utf8");
const interfaceCss = readFileSync(join(root, "app/interface.css"), "utf8");

describe("Docs rail layout stability", () => {
  it("keeps the desktop rail sticky beside one bounded reading column", () => {
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*--docs-content-width:\s*820px;[^}]*--docs-rail-width:\s*208px;/s,
    );
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*grid-template-columns:[^}]*var\(--docs-rail-width\)[^}]*minmax\(0,\s*var\(--docs-content-width\)\);/s,
    );
    expect(docsCss).toMatch(
      /\.sidebar\s*\{[^}]*grid-column:\s*1;[^}]*inline-size:\s*var\(--docs-rail-width\);[^}]*position:\s*sticky;[^}]*top:\s*calc\(var\(--header-height\) \+ 22px\);/s,
    );
    expect(docsCss).toMatch(
      /\.mainColumn\s*\{[^}]*grid-column:\s*2;[^}]*min-width:\s*0;/s,
    );
  });

  it("keeps the desktop tools available without pinning them on mobile", () => {
    expect(docsShell).toContain("data-docs-tools");
    expect(docsCss).toMatch(
      /\.heroTools\s*\{[^}]*position:\s*sticky;[^}]*top:\s*calc\(var\(--header-height\) \+ 12px\);/s,
    );
    expect(docsCss).toMatch(
      /@media \(max-width:\s*960px\)[\s\S]*?\.heroTools\s*\{[^}]*position:\s*static;/s,
    );
  });

  it("keeps the mobile disclosure fixed to the page inset", () => {
    expect(docsCss).toMatch(
      /@media \(max-width:\s*960px\)[\s\S]*?\.sidebar\s*\{[^}]*inline-size:\s*auto;[^}]*inset-inline:\s*24px;[^}]*position:\s*fixed;[^}]*top:\s*calc\(var\(--header-height\) \+ 8px\);/s,
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
    expect(docsShell.indexOf("data-docs-sidebar")).toBeLessThan(
      docsShell.indexOf("data-docs-tools"),
    );
    expect(docsShell.indexOf("data-docs-tools")).toBeLessThan(
      docsShell.indexOf("data-docs-hero"),
    );
  });

  it("uses one concise developer guide with a current-page chapter rail", () => {
    expect(docsPage).toContain("sections={developerSections}");
    expect(docsPage).toContain("<DocsLaunchInspector />");
    expect(docsShell).not.toContain("docsGuides");
    expect(docsShell).not.toContain("Documentation guides");
    expect(docsNavigation).toContain(
      '<p className={styles.navLabel}>On this page</p>',
    );
    expect(docsNavigation).toContain(
      "const navigationGroups = sections.length === 0 ? docsNavigation : [];",
    );
  });
});
