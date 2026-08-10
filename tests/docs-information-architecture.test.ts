import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const docsIndex = read("app/docs/page.tsx");
const tokensPage = read("app/docs/tokens/page.tsx");
const infrastructurePage = read("app/docs/infrastructure/page.tsx");
const docsData = read("components/docs-data.ts");
const docsShell = read("components/docs-shell.tsx");
const docsNavigation = read("components/docs-navigation.tsx");
const docsSearch = read("components/docs-search.tsx");
const docsCss = read("components/docs-experience.module.css");
const developersPage = read("app/docs/developers/page.tsx");
const sitemap = read("app/sitemap.ts");

describe("Docs information architecture", () => {
  it("uses one canonical overview instead of redirecting to a specialist guide", () => {
    expect(docsIndex).toContain('alternates: { canonical: "/docs" }');
    expect(docsIndex).toContain('title="Programmable documentation"');
    expect(docsIndex).not.toContain("redirect(");
    expect(sitemap).toContain('"/docs"');
  });

  it("separates the product, token, infrastructure and integration subjects", () => {
    for (const label of [
      "Overview",
      "Tokens and launches",
      "Infrastructure",
      "Developer integration",
    ]) {
      expect(docsData).toContain(`label: "${label}"`);
    }

    expect(docsData).toContain('href: "/docs/tokens"');
    expect(docsData).toContain('href: "/docs/infrastructure"');
    expect(sitemap).toContain('"/docs/tokens"');
    expect(sitemap).toContain('"/docs/infrastructure"');
  });

  it("keeps documentation availability separate from product status", () => {
    expect(docsShell).not.toContain('status === "available"');
    expect(docsShell).not.toContain('aria-disabled="true"');
    expect(tokensPage).toContain("Availability shown in Create");
    expect(tokensPage).toContain("Public submissions unavailable");
    expect(tokensPage).toContain("Historical");
    expect(tokensPage).toContain(
      "General public submission and self-service Custom launching are not available",
    );
  });

  it("keeps the verification scope precise", () => {
    expect(infrastructurePage).toContain(
      "Router verification applies only to stamped launches",
    );
    expect(infrastructurePage).toContain(
      "Historical launches and direct factory calls are outside",
    );
    expect(infrastructurePage).toContain(
      "It is not a safety guarantee.",
    );
  });

  it("exposes cross-page navigation on mobile as well as local contents", () => {
    expect(docsNavigation).toContain("renderMobileNavigation");
    expect(docsNavigation).toContain("{renderMobileNavigation()}");
    expect(docsNavigation).toContain("docsCategories.map");
  });

  it("lets keyboard users bypass and dismiss the documentation controls", () => {
    expect(docsShell).toContain('href="#docs-content"');
    expect(docsShell).toContain('id="docs-content"');
    expect(docsShell).toContain("tabIndex={-1}");
    expect(docsCss).toMatch(
      /\.skipDocsNavigation:focus-visible\s*\{[^}]*transform:\s*translateY\(0\);/s,
    );
    expect(docsSearch).toMatch(
      /<form[\s\S]*?onKeyDown=\{handleKeyDown\}[\s\S]*?onSubmit=\{submit\}/,
    );
    expect(docsSearch).toContain(
      "if (!(event.target instanceof HTMLInputElement)) return;",
    );
  });

  it("gives the developer reference tables row headers", () => {
    expect(developersPage.match(/role="rowheader"/g)?.length).toBe(12);
    expect(developersPage).not.toContain('<code role="cell">');
  });
});
