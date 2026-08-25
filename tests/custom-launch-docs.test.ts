import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { docsNavigation, docsSearchItems } from "../components/docs-data";
import sitemap from "../app/sitemap";
import { developerDocsMarkdown } from "../lib/developer-docs-content";
import { programmablePublicOpenApi } from "../lib/public-openapi";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

const gitBookGuide = read("docs/public/developers/custom-launch.md");
const websiteGuide = read("app/docs/developers/custom-launch/page.tsx");
const summary = read("docs/public/SUMMARY.md");
const createGuide = read("components/create-guide.tsx");
const rawGuide = read("public/developers/custom-launch-api-v1.md");
const machineReadableGuide = read(
  "app/docs/developers/machine-readable/page.tsx",
);

describe("Custom Launch API documentation", () => {
  it("publishes one canonical human guide in both documentation systems", () => {
    expect(summary).toContain(
      "[Custom Launch API](developers/custom-launch.md)",
    );
    expect(websiteGuide).toContain(
      'alternates: { canonical: "/docs/developers/custom-launch" }',
    );
    expect(websiteGuide).toContain(
      'currentPath="/docs/developers/custom-launch"',
    );
    expect(
      docsNavigation
        .find(({ label }) => label === "Developers")
        ?.items.some(({ href }) => href === "/docs/developers/custom-launch"),
    ).toBe(true);
    expect(
      docsSearchItems.some(
        ({ href }) => href === "/docs/developers/custom-launch",
      ),
    ).toBe(true);
    expect(sitemap().map(({ url }) => url)).toContain(
      "https://programmable.market/docs/developers/custom-launch",
    );
    expect(
      docsSearchItems.find(({ title }) => title === "Creator overview")
        ?.description,
    ).not.toContain("publish reusable hook logic");
  });

  it("keeps prepared artifacts separate from authorized wallet transactions", () => {
    for (const source of [gitBookGuide, websiteGuide, developerDocsMarkdown]) {
      expect(source).toContain("prepared");
      expect(source).toContain("authorized");
      expect(source).toMatch(/prepared[\s\S]{0,240}(?:no wallet transaction|walletTransaction[^\n]{0,80}(?:null|both null))/i);
      expect(source).toMatch(/authorized[\s\S]{0,240}(?:walletTransaction|wallet transaction)/i);
    }
    expect(createGuide).toContain("prepared has no wallet transaction");
    expect(createGuide).toContain("stop at authorized");
  });

  it("documents the real packager and schema boundary without invented checks", () => {
    for (const source of [gitBookGuide, websiteGuide]) {
      expect(source).toContain("/openapi/custom-launch-v1.json");
      expect(source).toContain("does not publish a universal check-ID catalog");
      expect(source).toContain("programmable-launch");
      expect(source).toMatch(/do not (?:copy test-only hashes|enter\s+derived hashes by hand)/i);
    }
    expect(createGuide).toContain("/openapi/custom-launch-v1.json");
    expect(createGuide).not.toMatch(/Hookbuilder-Skill|Hook Builder packages/);
  });

  it("keeps the raw guide and OpenAPI URLs compatible", () => {
    for (const source of [gitBookGuide, websiteGuide, developerDocsMarkdown]) {
      expect(source).toContain("/openapi/custom-launch-v1.json");
      expect(source).toContain("/developers/custom-launch-api-v1.md");
    }
  });

  it("states authentication, retry, discovery, claim and error boundaries", () => {
    for (const source of [gitBookGuide, websiteGuide]) {
      expect(source).toContain("Authorization: Bearer");
      expect(source).toContain("Idempotency-Key");
      expect(source).toContain("Retry-After");
      expect(source).toContain("Explore");
      expect(source).toContain("Profile");
      expect(source).toContain("not automatically claimable");
      expect(source).toContain("error.requestId");
      expect(source).toContain("resource-level");
    }
  });

  it("publishes the exact-source and no-broadcast cold-agent path", () => {
    for (const source of [gitBookGuide, rawGuide, developerDocsMarkdown]) {
      expect(source).toContain("programmable-launch-1.0.0.tgz");
      expect(source).toContain("verificationBundle");
      expect(source).toContain("exact_match");
      expect(source).toContain("PROGRAMMABLE_API_KEY");
      expect(source).toMatch(/without (?:signing|a wallet signature).{0,40}(?:or|and) broadcast/i);
    }
    expect(gitBookGuide).toContain("examples/no-broadcast/README.md");
    expect(gitBookGuide).toContain("deterministic-hook-permission-grind-v1");
    expect(gitBookGuide).toContain("submit ./launch.json");
    expect(gitBookGuide).toMatch(/submit[\s\S]{0,120}--config programmable-launch\.config\.json/);
  });

  it("describes request-driven reconciliation consistently", () => {
    for (const source of [rawGuide, machineReadableGuide]) {
      expect(source).toContain("bounded best-effort");
      expect(source).not.toContain("only the exact single-launch GET reconciles");
      expect(source).not.toContain("list reads do not perform per-launch chain reads");
    }
    expect(programmablePublicOpenApi["x-programmable-boundary"].actions).toContain(
      "pending history rows",
    );
  });
});
