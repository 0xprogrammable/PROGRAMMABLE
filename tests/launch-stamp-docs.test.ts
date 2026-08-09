import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LAUNCH_STAMP_RUNTIME_HASH_DEFINITION,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
} from "../components/launch-stamp-docs-contract";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const page = read("app/docs/launch-stamps/page.tsx");
const styles = read("components/launch-stamp-docs.module.css");
const docsData = read("components/docs-data.ts");
const docsShell = read("components/docs-shell.tsx");
const sitemap = read("app/sitemap.ts");
const markdown = read("lib/developer-docs-content.ts");

describe("Launch Stamp developer documentation", () => {
  it("publishes one explicit prelaunch Router binding without placeholders", () => {
    expect(PROGRAMMABLE_LAUNCH_STAMP_MANIFEST).toEqual({
      launchStampRouter: {
        version: "1",
        generation: "1",
        status: "prelaunch",
        address: null,
        startBlock: null,
        runtimeCodeHash: null,
        authority: null,
        abi: null,
      },
    });
    expect(LAUNCH_STAMP_RUNTIME_HASH_DEFINITION).toContain(
      "EVM Keccak-256 of the deployed runtime bytecode",
    );
    expect(page).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("uses one recognition algorithm for token and Uniswap v4 pool identity", () => {
    expect(page).toContain("token or (PoolManager, poolId)");
    expect(page).toContain(
      '"step 1  resolve input with the canonical Router → launchId"',
    );
    expect(page).toContain(
      '"step 2  read launchStamp at launchId from the same Router"',
    );
    expect(page).toContain("Not executable calldata");
    expect(page).not.toContain("functionName");
    expect(page).not.toContain("hook → launchId");
  });

  it("limits stamps to future Classic and Custom provenance", () => {
    expect(page).toContain("LaunchKindV1.CustomGraph");
    expect(page).toContain("LaunchKindV1.Classic");
    expect(page).toContain("Historical launches created before Router activation");
    expect(page).toContain(
      "Safety, tradability, liquidity, audit coverage, review status",
    );
    expect(page).toContain(
      "A Registry, indexer, Supabase project, Programmable API, or",
    );
  });

  it("adds one discoverable route to the existing Docs navigation", () => {
    expect(docsData).toContain(
      '{ href: "/docs/launch-stamps", label: "Launch stamps" }',
    );
    expect(docsData).toContain('relatedPaths: ["/docs/launch-stamps"]');
    expect(docsShell).toContain(
      "category.relatedPaths.some((path) => path === currentPath)",
    );
    expect(page).toContain('currentPath="/docs/launch-stamps"');
    expect(page).toContain(
      'alternates: { canonical: "/docs/launch-stamps" }',
    );
    expect(sitemap).toContain('"/docs/launch-stamps"');
    expect(markdown).toContain(
      "[Launch Stamp Router reference](https://programmable.market/docs/launch-stamps)",
    );
  });

  it("keeps the page semantic, keyboard-visible, and reflow-safe", () => {
    expect(page).toContain('aria-labelledby="trust-root-heading"');
    expect(page).toContain("<dl className={styles.manifest}>");
    expect(page).toContain('aria-label="Launch stamp verification flow"');
    expect(page).toContain("<ol");
    expect(page).not.toContain('role="img"');
    expect(styles).toContain("@media (max-width: 700px)");
    expect(styles).toContain("@media (max-width: 360px)");
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).toContain("var(--body-background) 92%");
    expect(styles).not.toContain("transition: all");
    expect(styles).not.toMatch(/\n\s+width:\s*\d{3,}px/);
  });
});
