import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { PROGRAMMABLE_LAUNCH_STAMP_RESOURCES } from "../components/launch-stamp-docs-contract";
import {
  developerDocsMarkdown,
  programmableLlmsFullFallback,
  programmableLlmsIndex,
} from "../lib/developer-docs-content";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const developerPage = read("app/docs/developers/page.tsx");
const docsIndex = read("app/docs/page.tsx");
const siteNavigation = read("components/site-navigation.tsx");
const docsSearch = read("components/docs-search.tsx");
const docsData = read("components/docs-data.ts");
const developerDocsCss = read("components/developer-docs.module.css");
const markdownRoute = read("app/docs/developers.md/route.ts");
const llmsRoute = read("app/llms.txt/route.ts");
const llmsFullRoute = read("app/llms-full.txt/route.ts");

describe("Developer documentation experience", () => {
  it("uses one Router-first Developers route with canonical metadata", () => {
    expect(docsIndex).toContain('redirect("/docs/developers")');
    expect(siteNavigation).toContain('href: "/docs/developers"');
    expect(developerPage).toContain(
      'title="Verify future Programmable launches through one Router."',
    );
    expect(developerPage).toContain(
      'alternates: { canonical: "/docs/developers" }',
    );
    expect(developerPage).toContain(
      "Historical launches and direct factory calls are outside this trust root.",
    );
  });

  it("keeps navigation and search aligned with every rendered section", () => {
    expect(docsSearch).toContain("key={`${item.href}:${item.title}`}");
    for (const id of [
      "trust-root",
      "identity",
      "indexing",
      "resources",
      "boundary",
      "checklist",
      "agents",
    ]) {
      expect(developerPage).toContain(`id="${id}"`);
      expect(docsData).toContain(`/docs/developers#${id}`);
    }
    expect(developerPage).toContain('heroId="paths"');
    expect(docsData).toContain("/docs/developers#paths");
    for (const staleId of [
      "quickstart",
      "providers",
      "markets",
      "verification",
      "data",
      "reference",
    ]) {
      expect(docsData).not.toContain(`/docs/developers#${staleId}`);
    }
  });

  it("puts the live manifest, frozen ABI and GitHub reference first", () => {
    expect(developerPage).toContain(
      "PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl",
    );
    expect(developerPage).toContain(
      "PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl",
    );
    expect(developerPage).toContain(
      "PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.referenceUrl",
    );
    expect(developerDocsMarkdown).toContain(
      `Live manifest: ${PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl}`,
    );
    expect(developerDocsMarkdown).toContain(
      `Frozen Router ABI: ${PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl}`,
    );
  });

  it("documents point verification without requiring an indexer or server", () => {
    expect(developerPage).toContain("Resolve one record from token or pool");
    expect(developerDocsMarkdown).toContain("launchIdByToken(address)");
    expect(developerDocsMarkdown).toContain("launchIdByPool(address,bytes32)");
    expect(developerDocsMarkdown).toContain("stampProof(address)");
    expect(developerPage).toMatch(
      /The shared\s+Classic hook is not a launch identifier\./,
    );
    expect(developerPage).toContain("Optional event discovery");
    expect(developerPage).toMatch(
      /An indexer is an\s+implementation choice, not a trust dependency\./,
    );
    expect(developerDocsMarkdown).toContain(
      "point verification requires only an Ethereum provider.",
    );
  });

  it("keeps future-only Classic and Custom scope explicit", () => {
    expect(developerPage).toContain("LaunchKindV1.{customKind?.name}");
    expect(developerPage).toContain("LaunchKindV1.{classicKind?.name}");
    expect(developerPage).toContain("This contract is future only.");
    expect(developerPage).not.toContain("MemeTokenLaunchedV2");
    expect(developerPage).not.toContain(
      "0xC3bd04aAc2fb2ba58efD7Eb673E544E0B80De770",
    );
    expect(developerPage).not.toContain("CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH");
    expect(developerPage).not.toContain("DeveloperDocsWorkbench");
  });

  it("keeps provenance separate from safety and terminal support", () => {
    expect(developerDocsMarkdown).toContain(
      "It does not establish safety, tradability, current liquidity or pool state",
    );
    expect(developerDocsMarkdown).toContain(
      "each consumer must implement this public contract",
    );
    expect(developerDocsMarkdown).toContain(
      "The public GitHub approval, permit, and wallet self-service flow is not live.",
    );
    expect(developerDocsMarkdown).toContain(
      "It does not automatically list or label a launch in GMGN, Axiom, FOMO",
    );
    expect(developerDocsMarkdown).not.toContain("unruggable");
  });

  it("keeps the Markdown and agent routes local, static and Router-first", () => {
    for (const route of [markdownRoute, llmsRoute, llmsFullRoute]) {
      expect(route).toContain('dynamic = "force-static"');
      expect(route).not.toContain("resolveCustomRegistryPublicManifestV1");
    }
    expect(markdownRoute).toContain("buildDeveloperDocsMarkdown()");
    expect(llmsRoute).toContain("buildProgrammableLlmsIndex()");
    expect(llmsFullRoute).toContain("buildProgrammableLlmsFullFallback()");
    expect(llmsFullRoute).not.toContain("fetch(");
    expect(programmableLlmsIndex).toContain("Canonical read-only provenance");
    expect(programmableLlmsFullFallback).toContain("## Finalized PCAN vector");
  });

  it("wraps long hashes and recomposes the technical layout on phones", () => {
    expect(developerDocsCss).toContain(".breakableValue");
    expect(developerDocsCss).toContain(".eventDetails");
    expect(developerDocsCss).toMatch(
      /\.eventDetails code,[\s\S]*?overflow-wrap:\s*anywhere;/,
    );
    expect(developerDocsCss).toMatch(
      /@media \(max-width: 620px\)[\s\S]*?\.fieldTable > div\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
    expect(developerDocsCss).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(developerDocsCss).not.toContain("transition: all");
  });
});
