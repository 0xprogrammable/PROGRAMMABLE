import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  agentPrompt,
  getDeveloperCopyMotion,
  languageExamples,
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
  it("uses one shareable Developers route with canonical metadata", () => {
    expect(docsIndex).toContain('redirect("/docs/developers")');
    expect(siteNavigation).toContain('href: "/docs/developers"');
    expect(developerPage).toContain('title="Integrate once. Discover every Programmable launch."');
    expect(developerPage).toContain(
      'alternates: { canonical: "/docs/developers" }',
    );
  });

  it("keeps navigation and search aligned with the rendered sections", () => {
    expect(docsSearch).toContain("key={`${item.href}:${item.title}`}");
    for (const id of [
      "paths",
      "quickstart",
      "identity",
      "providers",
      "markets",
      "verification",
      "data",
      "reference",
      "checklist",
      "agents",
    ]) {
      expect(docsData).toContain(`/docs/developers#${id}`);
    }
    expect(docsData).not.toContain("Basebit");
    expect(docsData).not.toContain("Aion");
  });

  it("provides copy-ready examples that discover the active API", () => {
    expect(developerPage).toContain("<DeveloperDocsWorkbench />");
    expect(developerPage).toContain("<DeveloperEndpointList />");
    expect(developerPage).toContain(
      "<DeveloperAgentPrompt registryManifest={registryManifest} />",
    );
    expect(languageExamples).toHaveLength(3);
    expect(languageExamples.every((example) =>
      example.code.includes(".well-known/programmable.json") ||
      example.code.includes("discovery.apiBaseUrl") ||
      example.code.includes('discovery["apiBaseUrl"]')
    )).toBe(true);
    expect(languageExamples[1]?.code).toContain(
      "launch.token?.address ?? null",
    );
    expect(developerDocsMarkdown).toContain("## Minimal terminal consumer");
    expect(programmableLlmsIndex).toContain("Active major: v2");
  });

  it("keeps Custom provenance explicitly prelaunch and address-free", () => {
    expect(developerPage).toContain("Community Custom intake is");
    expect(developerPage).toContain("CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH");
    expect(developerPage).toContain("registryManifest.contracts.registry.address");
    expect(developerDocsMarkdown).toContain(
      "Registry address is `null`, start block is `null`",
    );
    expect(developerDocsMarkdown).toContain(
      "public Custom Registry manifest",
    );
    expect(developerDocsMarkdown).toContain(
      "No Basebit, Aion or other named partner activation is implied",
    );
    expect(developerPage).not.toContain("Basebit");
    expect(developerPage).not.toContain("Aion");
    expect(developerPage).not.toContain(
      "ProgrammableCustomLaunchRegistered",
    );
    expect(workbench).not.toContain("IProgrammableCustomRegistryV1");
    expect(developerDocsMarkdown).not.toContain(
      "The Programmable Custom Registry is live",
    );
  });

  it("documents project-only and unfamiliar market states without invented features", () => {
    expect(developerPage).toContain('title: "Project only"');
    expect(developerPage).toContain('status: "token = null · markets = []"');
    expect(developerPage).toContain('title: "Unknown market kind"');
    expect(developerDocsMarkdown).toContain(
      "Never invent a pool, price, liquidity, volume, chart, quote, simulation or trade button",
    );
  });

  it("publishes current and historical Classic source identifiers", () => {
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
  });

  it("supports keyboard navigation and instant keyboard copy feedback", () => {
    expect(nextLanguageIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextLanguageIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextLanguageIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextLanguageIndex(1, "Home", 3)).toBe(0);
    expect(nextLanguageIndex(1, "End", 3)).toBe(2);
    expect(getDeveloperCopyMotion(0)).toBe("instant");
    expect(getDeveloperCopyMotion(1)).toBe("standard");
  });

  it("makes copy feedback accessible and motion optional", () => {
    expect(workbench).toContain('role="status"');
    expect(workbench).toContain('aria-live="polite"');
    expect(workbench).toContain('data-motion={motion}');
    expect(developerDocsCss).toContain(
      '@media (prefers-reduced-motion: reduce)',
    );
    expect(developerDocsCss).toContain(
      '.copyButton[data-motion="instant"]',
    );
    expect(developerDocsCss).not.toContain("transition: all");
  });

  it("recomposes technical grids and endpoint actions on narrow screens", () => {
    expect(developerDocsCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.feeGrid,[\s\S]*?\.marketCases\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
    expect(developerDocsCss).toMatch(
      /@media \(max-width: 620px\)[\s\S]*?\.endpointRow\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
    expect(developerDocsCss).toContain("overflow-wrap: anywhere");
  });

  it("keeps the agent prompt on the same identity, fee and registry contract", () => {
    expect(agentPrompt).toContain("platformId=programmable");
    expect(agentPrompt).toContain("Map category=classic to Programmable Classic");
    expect(agentPrompt).toContain("Map category=custom to Programmable Custom");
    expect(agentPrompt).toContain("Custom Registry as prelaunch");
    expect(agentPrompt).toContain("20 BPS total: 15 partner and 5 Programmable");
  });
});
