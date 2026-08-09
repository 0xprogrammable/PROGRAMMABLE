import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const docsCss = readFileSync(
  join(root, "components/docs-experience.module.css"),
  "utf8",
);
const docsShell = readFileSync(join(root, "components/docs-shell.tsx"), "utf8");
const docsNavigation = readFileSync(
  join(root, "components/docs-navigation.tsx"),
  "utf8",
);
const docsPage = readFileSync(
  join(root, "app/docs/developers/page.tsx"),
  "utf8",
);
const interfaceCss = readFileSync(join(root, "app/interface.css"), "utf8");

describe("Docs rail layout stability", () => {
  it("keeps the desktop rail sticky beside one bounded reading column", () => {
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*--docs-content-width:\s*940px;[^}]*--docs-rail-width:\s*220px;/s,
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

  it("keeps search in the persistent rail and includes it in mobile offsets", () => {
    expect(docsShell).toContain("data-docs-tools");
    expect(docsShell).toContain("styles.sidebarSearch");
    expect(docsCss).toMatch(
      /\.sidebarSearch,\s*\.sidebarSearch \.search\s*\{[^}]*width:\s*100%;/s,
    );
    expect(docsCss).toMatch(
      /@media \(max-width:\s*960px\)[\s\S]*?\.sidebarSearch\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s,
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
    expect(docsPage).toContain(
      'title="Verify future Programmable launches through one Router."',
    );
    expect(docsPage).toContain('id="trust-root"');
    expect(docsPage).toContain('id="identity"');
    expect(docsPage).toContain('id="indexing"');
    expect(docsPage).not.toContain("DeveloperDocsWorkbench");
    expect(docsPage).toContain('currentPath="/docs/developers"');
    expect(docsShell).not.toContain("docsGuides");
    expect(docsShell).not.toContain("Documentation guides");
    expect(docsShell).toContain('aria-label="Documentation categories"');
    expect(docsShell).toContain("Developer reference");
    expect(docsShell).toContain("Soon");
    expect(docsNavigation).toContain(
      "<p className={styles.navLabel}>Contents</p>",
    );
    expect(docsNavigation).toContain(
      "const navigationGroups = sections.length === 0 ? docsNavigation : [];",
    );
  });
});
