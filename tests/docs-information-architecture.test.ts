import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  docsCategories,
  docsNavigation as docsNavigationTree,
} from "../components/docs-data";
import sitemap from "../app/sitemap";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const docsIndex = read("app/docs/page.tsx");
const tokensPage = read("app/docs/tokens/page.tsx");
const infrastructurePage = read("app/docs/infrastructure/page.tsx");
const developerOverview = read("app/docs/developers/page.tsx");
const verifyPage = read("app/docs/developers/verify/page.tsx");
const indexingPage = read("app/docs/developers/indexing/page.tsx");
const machineReadablePage = read(
  "app/docs/developers/machine-readable/page.tsx",
);
const docsShell = read("components/docs-shell.tsx");
const docsNavigation = read("components/docs-navigation.tsx");
const docsSearch = read("components/docs-search.tsx");
const docsCss = read("components/docs-experience.module.css");

describe("Docs information architecture", () => {
  it("uses one canonical project overview instead of redirecting to a specialist guide", () => {
    expect(docsIndex).toContain('alternates: { canonical: "/docs" }');
    expect(docsIndex).toContain('title="Programmable"');
    expect(docsIndex).not.toContain("redirect(");
    expect(sitemap().map((entry) => entry.url)).toContain(
      "https://programmable.market/docs",
    );
  });

  it("keeps one global hierarchy for product, launches, infrastructure and developers", () => {
    expect(docsCategories.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/docs", label: "Documentation" },
      { href: "/docs/tokens", label: "Tokens and launches" },
      { href: "/docs/infrastructure", label: "Infrastructure" },
      { href: "/docs/developers", label: "Developers" },
    ]);

    expect(
      docsNavigationTree.map((group) => ({
        label: group.label,
        routes: group.items.map((item) => ({
          depth: item.depth ?? 0,
          href: item.href,
          label: item.label,
        })),
      })),
    ).toEqual([
      {
        label: "Documentation",
        routes: [{ depth: 0, href: "/docs", label: "Overview" }],
      },
      {
        label: "Tokens and launches",
        routes: [
          { depth: 0, href: "/docs/tokens", label: "Overview" },
          { depth: 1, href: "/docs/models/classic", label: "Classic" },
          { depth: 1, href: "/docs/models/custom", label: "Custom hooks" },
          {
            depth: 1,
            href: "/docs/models/stock-paired",
            label: "Stock-Paired",
          },
        ],
      },
      {
        label: "Infrastructure",
        routes: [
          { depth: 0, href: "/docs/infrastructure", label: "Overview" },
          {
            depth: 1,
            href: "/docs/launch-stamps",
            label: "Router and launch stamps",
          },
        ],
      },
      {
        label: "Developers",
        routes: [
          { depth: 0, href: "/docs/developers", label: "Overview" },
          {
            depth: 1,
            href: "/docs/developers/verify",
            label: "Verify a launch",
          },
          {
            depth: 1,
            href: "/docs/developers/indexing",
            label: "Index launches",
          },
          {
            depth: 1,
            href: "/docs/developers/machine-readable",
            label: "Machine-readable docs",
          },
        ],
      },
    ]);
  });

  it("publishes every human documentation route in the sitemap", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual(
      expect.arrayContaining(
        [
          "/docs",
          "/docs/tokens",
          "/docs/infrastructure",
          "/docs/developers",
          "/docs/developers/verify",
          "/docs/developers/indexing",
          "/docs/developers/machine-readable",
          "/docs/launch-stamps",
          "/docs/models/classic",
          "/docs/models/custom",
          "/docs/models/stock-paired",
        ].map((route) => `https://programmable.market${route}`),
      ),
    );
  });

  it("keeps the three developer tasks in the same shell and breadcrumb hierarchy", () => {
    for (const [source, path, title] of [
      [developerOverview, "/docs/developers", "Integrate Programmable launches"],
      [verifyPage, "/docs/developers/verify", "Verify a token or pool"],
      [indexingPage, "/docs/developers/indexing", "Index new launches"],
      [
        machineReadablePage,
        "/docs/developers/machine-readable",
        "Machine-readable docs",
      ],
    ] as const) {
      expect(source).toContain(`currentPath="${path}"`);
      expect(source).toContain(`title="${title}"`);
      expect(source).toContain("<DocsShell");
    }
    for (const source of [verifyPage, indexingPage, machineReadablePage]) {
      expect(source).toContain('parentHref="/docs/developers"');
      expect(source).toContain('parentLabel="Developer integration"');
    }
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
    expect(infrastructurePage).toContain("It is not a safety guarantee.");
  });

  it("uses the full global tree in a dismissible mobile dialog", () => {
    expect(docsNavigation).toContain("renderGlobalNavigation");
    expect(docsNavigation).toContain("renderMobileNavigation");
    expect(docsNavigation).toContain("{renderMobileNavigation()}");
    expect(docsNavigation).toContain("dialog.showModal()");
    expect(docsNavigation).toContain('id="docs-mobile-navigation"');
    expect(docsNavigation).toContain('aria-haspopup="dialog"');
    expect(docsNavigation).toContain('aria-label="Close documentation navigation"');
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
    expect(docsNavigation).toContain("mobileMenuButtonRef.current?.focus()");
  });

  it("uses native row and column headers in the indexing reference table", () => {
    expect(indexingPage).toContain('<th scope="col">Event</th>');
    expect(indexingPage).toContain('<th scope="col">Full signature</th>');
    expect(indexingPage).toContain('<th scope="col">topic0</th>');
    expect(indexingPage).toContain('<th scope="row">{event.name}</th>');
    expect(indexingPage).not.toContain('role="rowheader"');
  });
});
