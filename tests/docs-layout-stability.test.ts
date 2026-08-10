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
  it("keeps the desktop rail sticky beside a bounded article and page outline", () => {
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*--docs-content-width:\s*800px;[^}]*--docs-main-width:\s*1024px;[^}]*--docs-rail-width:\s*232px;[^}]*--docs-toc-width:\s*184px;/s,
    );
    expect(docsCss).toMatch(
      /\.page\s*\{[^}]*grid-template-columns:[^}]*var\(--docs-rail-width\)[^}]*minmax\(0,\s*var\(--docs-main-width\)\);/s,
    );
    expect(docsCss).toMatch(
      /\.sidebar\s*\{[^}]*grid-column:\s*1;[^}]*inline-size:\s*var\(--docs-rail-width\);[^}]*position:\s*sticky;[^}]*top:\s*calc\(var\(--header-height\) \+ 22px\);/s,
    );
    expect(docsCss).toMatch(
      /\.mainColumn\s*\{[^}]*grid-column:\s*2;[^}]*min-width:\s*0;/s,
    );
    expect(docsCss).not.toMatch(
      /font-size:\s*(?:10(?:\.5)?|11(?:\.5)?|12(?:\.5)?)px/,
    );
    expect(docsCss).toMatch(
      /\.content h2\[tabindex="-1"\]:focus-visible,[\s\S]*?outline:\s*2px solid var\(--focus\);/,
    );
    expect(docsCss).toMatch(
      /:global\(\.route-transition-docs\) \[data-docs-shell\] h1\[tabindex="-1"\]:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\);/s,
    );
    expect(docsCss).not.toContain(
      '.content h2[tabindex="-1"]:focus,\n.content h3[tabindex="-1"]:focus {\n  outline: none;',
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
      /@media \(max-width:\s*1220px\)[\s\S]*?\.pageNavigation\s*\{[^}]*order:\s*-1;[^}]*position:\s*static;/s,
    );
    expect(docsCss).toMatch(
      /@media \(min-width:\s*961px\) and \(max-width:\s*1220px\)[\s\S]*?\.atmosphere-plant-left\),[\s\S]*?\.atmosphere-plant-right\)\s*\{[^}]*transform:\s*none;[\s\S]*?\.atmosphere-plant-left\)\s*\{[^}]*left:\s*0;[\s\S]*?\.atmosphere-plant-right\)\s*\{[^}]*right:\s*0;/s,
    );
    expect(docsCss).toMatch(
      /@media \(max-width:\s*960px\)[\s\S]*?\.sidebar\s*\{[^}]*inline-size:\s*auto;[^}]*inset-inline:\s*24px;[^}]*position:\s*fixed;[^}]*top:\s*calc\(var\(--header-height\) \+ 8px\);/s,
    );
    expect(docsCss).toMatch(
      /@media \(max-width:\s*960px\)[\s\S]*?\.pageNavigation\s*\{[^}]*display:\s*none;/s,
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

  it("uses one concise developer guide with stable global and local navigation", () => {
    expect(docsPage).toContain("sections={developerSections}");
    expect(docsPage).toContain(
      'title="Integrate launch verification"',
    );
    expect(docsPage).toContain('id="trust-root"');
    expect(docsPage).toContain('id="identity"');
    expect(docsPage).toContain('id="indexing"');
    expect(docsPage).not.toContain("DeveloperDocsWorkbench");
    expect(docsPage).toContain('currentPath="/docs/developers"');
    expect(docsShell).not.toContain("docsGuides");
    expect(docsShell).not.toContain("Documentation guides");
    expect(docsShell).toContain("<DocsNavigation");
    expect(docsShell).toContain("<DocsPageNavigation");
    expect(docsShell).toContain('aria-label="Breadcrumb"');
    expect(docsShell).not.toContain("Soon");
    expect(docsNavigation).toContain(
      "<p className={styles.navLabel}>On this page</p>",
    );
    expect(docsNavigation).toContain("renderGlobalNavigation");
    expect(docsNavigation).toContain("renderMobileNavigation");
    expect(docsNavigation).toContain("{renderMobileNavigation()}");
  });
});
