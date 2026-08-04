import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  compactFeedPreview,
  nextLanguageIndex,
} from "../components/developer-docs-workbench";
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
const workbench = readFileSync(
  join(root, "components/developer-docs-workbench.tsx"),
  "utf8",
);
const livePreviewRoute = readFileSync(
  join(root, "app/api/developer-docs/launch-preview/route.ts"),
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
    expect(developerPage).toContain('alternates: { canonical: "/docs/developers" }');
  });

  it("keeps search result keys unique when several terms point to one section", () => {
    expect(docsSearch).toContain('key={`${item.href}:${item.title}`}');
  });

  it("provides executable examples, a live request, and machine-readable entry points", () => {
    expect(developerPage).toContain("<DeveloperDocsWorkbench />");
    expect(developerPage).toContain("<DeveloperAgentPrompt />");
    expect(developerDocsMarkdown).toContain("## Five-minute integration");
    expect(developerDocsMarkdown).toContain("page.nextCursor");
    expect(developerDocsMarkdown).toContain("page.resumeCursor");
    expect(programmableLlmsIndex).toContain(
      "https://programmable.family/docs/developers.md",
    );
    expect(programmableLlmsIndex).toContain(
      "https://developers.programmable.family/.well-known/programmable.json",
    );
    expect(workbench).toContain(
      'fetch("/api/developer-docs/launch-preview"',
    );
    expect(livePreviewRoute).toContain(
      "https://developers.programmable.family/api/v1/launches?limit=1",
    );
  });

  it("supports keyboard navigation across language tabs", () => {
    expect(nextLanguageIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextLanguageIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextLanguageIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextLanguageIndex(1, "Home", 3)).toBe(0);
    expect(nextLanguageIndex(1, "End", 3)).toBe(2);
  });

  it("collapses the workbench and integration metadata for narrow screens", () => {
    expect(developerDocsCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.workbenchGrid\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
    expect(developerDocsCss).toMatch(
      /@media \(max-width: 620px\)[\s\S]*?\.integrationMeta\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,/,
    );
    expect(developerDocsCss).toMatch(
      /@media \(max-width: 360px\)[\s\S]*?\.integrationMeta\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
  });

  it("keeps the live preview small and masks opaque cursors", () => {
    expect(
      compactFeedPreview({
        status: "ok",
        snapshot: { blockNumber: "123", finality: "finalized" },
        items: [
          {
            launchId: "launch-1",
            category: "classic",
            chainId: 1,
            token: { address: "0xabc", name: "Example", symbol: "EX" },
            markets: [{ kind: "uniswap-v4", status: "available" }],
          },
        ],
        page: {
          hasMore: true,
          nextCursor: "secret-opaque-value",
          resumeCursor: "another-opaque-value",
        },
      }),
    ).toEqual({
      status: "ok",
      snapshot: { blockNumber: "123", finality: "finalized" },
      item: {
        launchId: "launch-1",
        category: "classic",
        chainId: 1,
        token: { address: "0xabc", name: "Example", symbol: "EX" },
        launch: undefined,
        markets: [{ kind: "uniswap-v4", status: "available" }],
      },
      page: {
        hasMore: true,
        nextCursor: "<opaque cursor>",
        resumeCursor: "<opaque cursor>",
      },
    });
  });

  it("keeps unpublished product docs visibly separate", () => {
    expect(developerPage).toContain(
      "Classic and Custom Hook product guides are not published yet.",
    );
  });
});
