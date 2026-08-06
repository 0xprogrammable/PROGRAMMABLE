import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { nextLanguageIndex } from "../components/developer-docs-workbench";
import {
  developerDocsMarkdown,
  programmableLlmsIndex,
} from "../lib/developer-docs-content";

const root = process.cwd();
const developerPage = readFileSync(
  join(root, "app/docs/developers/page.tsx"),
  "utf8",
);
const docsIndex = readFileSync(join(root, "app/docs/page.tsx"), "utf8");
const siteNavigation = readFileSync(
  join(root, "components/site-navigation.tsx"),
  "utf8",
);
const docsSearch = readFileSync(
  join(root, "components/docs-search.tsx"),
  "utf8",
);
const docsData = readFileSync(join(root, "components/docs-data.ts"), "utf8");
const workbench = readFileSync(
  join(root, "components/developer-docs-workbench.tsx"),
  "utf8",
);
const developerDocsCss = readFileSync(
  join(root, "components/developer-docs.module.css"),
  "utf8",
);

describe("Developer documentation experience", () => {
  it("uses the shareable Developers route everywhere", () => {
    expect(docsIndex).toContain('redirect("/docs/developers")');
    expect(siteNavigation).toContain('href: "/docs/developers"');
    expect(developerPage).toContain('kicker="Docs / Developers"');
    expect(developerPage).toContain(
      'alternates: { canonical: "/docs/developers" }',
    );
  });

  it("keeps search result keys unique when several terms point to one section", () => {
    expect(docsSearch).toContain("key={`${item.href}:${item.title}`}");
    expect(docsData).toContain("approved external hook launches");
    expect(docsData).toContain("Custom Registry");
    expect(docsData).not.toContain("Basebit");
  });

  it("provides copy-ready examples and machine-readable entry points", () => {
    expect(developerPage).toContain("<DeveloperDocsWorkbench />");
    expect(developerPage).toContain("<DeveloperAgentPrompt />");
    expect(developerDocsMarkdown).toContain("## Minimal terminal consumer");
    expect(developerDocsMarkdown).toContain("page.nextCursor");
    expect(developerDocsMarkdown).toContain("page.resumeCursor");
    expect(programmableLlmsIndex).toContain(
      "https://programmable.family/docs/developers.md",
    );
    expect(programmableLlmsIndex).toContain(
      "https://developers.programmable.family/.well-known/programmable.json",
    );
    expect(workbench).toContain("Minimal terminal consumer");
    expect(workbench).toContain("Programmable Classic");
    expect(workbench).toContain("Programmable Custom");
    expect(workbench).toContain("/api/v2/launches");
    expect(workbench).not.toContain("/api/v1/launches");
    expect(workbench).not.toContain("Run request");
    expect(workbench).not.toContain("launch-preview");
  });

  it("links integrators to complete guides and a real token-detail response", () => {
    expect(developerPage).toContain("Terminal guide");
    expect(developerPage).toContain("JSON Schemas");
    expect(developerPage).toContain("docs/guides/terminals-and-scanners.md");
    expect(developerPage).toContain(
      "/api/v2/launches/1/0x56a96463ead0c0b9b4e4df9e41805bb8877074a6",
    );
    expect(developerPage).not.toContain(
      'endpoint.path.replace("/{chainId}/{tokenAddress}", "")',
    );
    expect(developerDocsMarkdown).toContain(
      "`/token` alone is not an API route",
    );
    expect(programmableLlmsIndex).toContain(
      "https://github.com/0xprogrammable/developers/tree/main/schemas/v2",
    );
  });

  it("states the public discovery and market-data boundary without implying execution", () => {
    expect(developerPage).toContain("Verification is not one safety flag");
    expect(developerPage).toContain("no universal");
    expect(developerPage).toContain("Current Custom boundary");
    expect(developerDocsMarkdown).toContain("separately verified adapter");
  });

  it("gives launch providers an atomic, explicitly prelaunch integration path", () => {
    expect(developerPage).toContain("Register partner launches once");
    expect(developerPage).toContain("Atomic Programmable adapter");
    expect(developerPage).toContain("Verified factory callback");
    expect(developerPage).toContain("The open Custom Registry is not deployed");
    expect(developerPage).toContain("docs/guides/launch-providers.md");
    expect(developerDocsMarkdown).toContain("## Launch provider integration");
    expect(developerDocsMarkdown).toContain(
      "A frontend request, API response, webhook",
    );
    expect(developerDocsMarkdown).toContain(
      "| `custom` | `Programmable Custom` |",
    );
    expect(developerDocsMarkdown).toContain(
      "Token, hook, factory and market addresses may differ on every launch",
    );
    expect(developerDocsMarkdown).toContain(
      "Historical Stock-Paired records are excluded from v2",
    );
    expect(developerPage).not.toContain("Stock Paired V3");
    expect(developerPage).not.toContain("Basebit");
    expect(developerDocsMarkdown).not.toContain(
      "The Programmable Custom Registry is live",
    );
    expect(developerPage).not.toContain("For launch providers");
    expect(developerPage).not.toContain("For terminals and scanners");
  });

  it("supports keyboard navigation across language tabs", () => {
    expect(nextLanguageIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextLanguageIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextLanguageIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextLanguageIndex(1, "Home", 3)).toBe(0);
    expect(nextLanguageIndex(1, "End", 3)).toBe(2);
  });

  it("collapses the technical layout cleanly on narrow screens", () => {
    expect(developerDocsCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.labelGrid,[\s\S]*?\.deploymentGrid\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
    expect(developerDocsCss).not.toContain(".docsActions");
  });

  it("publishes exact current and historical source identifiers", () => {
    expect(developerPage).toContain(
      "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770",
    );
    expect(developerPage).toContain(
      "0x35Fe236EA82F7cF525c9719d7df8F49F94D720CC",
    );
    expect(developerPage).toContain(
      "0x025a386eAa79f6067d29848FD05ccC71bEAb20CC",
    );
    expect(developerPage).toContain("MemeTokenLaunchedV2");
    expect(developerDocsMarkdown).toContain("Classic V2 uses fee hook");
  });

  it("keeps unpublished product docs visibly separate", () => {
    expect(developerPage).not.toContain(
      "Classic and Custom Hook product guides",
    );
    expect(developerPage).not.toContain("DeveloperDocsActions");
    expect(workbench).toContain("DeveloperDocsWorkbench");
  });
});
