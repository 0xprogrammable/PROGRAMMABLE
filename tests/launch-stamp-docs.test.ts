import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LAUNCH_KIND_V1,
  LAUNCH_STAMP_RUNTIME_HASH_DEFINITION,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT,
  STAMP_RECORD_V1_FIELDS,
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
  it("binds the frozen ABI artifact while keeping deployment data prelaunch", () => {
    expect(PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ARTIFACT).toEqual({
      contractName: "ProgrammableLaunchStampRouterV1",
      sourceCommit: "0a7134bbb912222639627fb9078df2f8dd3a6c38",
      sourceTree: "24ffb0c6b04af7993254560b4f03608de8f52231",
      artifactPath:
        "out/ProgrammableLaunchStampRouterV1.sol/ProgrammableLaunchStampRouterV1.json",
    });
    expect(PROGRAMMABLE_LAUNCH_STAMP_MANIFEST).toEqual({
      launchStampRouter: {
        version: "1",
        generation: "1",
        status: "prelaunch",
        address: null,
        startBlock: null,
        runtimeCodeHash: null,
        authority: null,
        abi: "frozen",
      },
    });
    expect(LAUNCH_STAMP_RUNTIME_HASH_DEFINITION).toContain(
      "EVM Keccak-256 of the deployed runtime bytecode",
    );
    expect(page).not.toMatch(/0x[a-fA-F0-9]{40}/);
  });

  it("publishes the artifact-exact terminal signatures and selectors", () => {
    expect(PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI).toEqual({
      market: {
        label: "Sole market-bearing write",
        signature:
          "launchAndStampV1((uint256,address,address,uint8,bytes32,bytes32,bytes32,bytes32,uint64,uint64,uint256),(bytes32,address,bytes32,(address,address,uint24,int24,address),bytes32,(uint8,address,bytes32,uint8,uint8)[]),bytes,bytes)",
        selector: "0xe5f6b8cd",
        returns: "bytes32 stampHash",
      },
      primaryReads: [
        {
          label: "Token to launch ID",
          signature: "launchIdByToken(address)",
          selector: "0x1dad847c",
          returns: "bytes32 launchId",
        },
        {
          label: "Market to launch ID",
          signature: "launchIdByPool(address,bytes32)",
          selector: "0x361df6f3",
          returns: "bytes32 launchId",
        },
        {
          label: "Launch ID to record",
          signature: "launchStamp(bytes32)",
          selector: "0x4c9e4764",
          returns: "StampRecordV1",
        },
      ],
      componentReads: [
        {
          label: "Exclusive-component proof",
          signature: "stampProof(address)",
          selector: "0x174b9f9d",
          returns: "(bytes32 launchId, bytes32 stampHash)",
        },
        {
          label: "Exclusive-component lookup",
          signature: "launchIdByComponent(address)",
          selector: "0x58c5e373",
          returns: "bytes32 launchId",
        },
        {
          label: "Recorded component runtime",
          signature: "componentRuntimeCodeHash(address)",
          selector: "0xc892d353",
          returns: "bytes32 runtimeCodeHash",
        },
      ],
    });
  });

  it("uses token or PoolManager and poolId as the universal recognition inputs", () => {
    expect(page).toContain("token or (PoolManager, poolId)");
    expect(page).toContain('"          ? launchIdByToken(token)"');
    expect(page).toContain(
      '"          : launchIdByPool(PoolManager, poolId)"',
    );
    expect(page).toContain('"step 2  record := launchStamp(launchId)"');
    expect(page).toContain("ABI-bound read sequence");
    expect(page).toContain("Unavailable while address is null");
  });

  it("documents stampProof as exclusive-component corroboration, never a hook route", () => {
    expect(page).toContain("stampProof(address)");
    expect(page).toContain("A Classic hook is");
    expect(page).toContain("There is no universal hook getter");
    expect(JSON.stringify(PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI)).not.toContain(
      "launchIdByHook",
    );
    expect(page).not.toContain("hook → launchId");
  });

  it("freezes StampRecordV1 tuple order and LaunchKindV1 encoding", () => {
    expect(STAMP_RECORD_V1_FIELDS).toEqual([
      ["uint8", "kind"],
      ["address", "launchWallet"],
      ["address", "token"],
      ["address", "hook"],
      ["address", "poolManager"],
      ["bytes32", "poolId"],
      ["bytes32", "poolKeyHash"],
      ["bytes32", "componentSetHash"],
      ["bytes32", "routePayloadHash"],
      ["address", "routeLauncher"],
      ["bytes32", "routeLauncherRuntimeCodeHash"],
      ["bytes32", "expectedResultHash"],
      ["bytes32", "permitDigest"],
      ["bytes32", "stampHash"],
    ]);
    expect(LAUNCH_KIND_V1).toEqual([
      { value: 0, name: "Invalid", publicLabel: null },
      { value: 1, name: "CustomGraph", publicLabel: "Programmable Custom" },
      { value: 2, name: "Classic", publicLabel: "Programmable Classic" },
    ]);
    expect(page).toContain("LaunchKindV1.CustomGraph");
    expect(page).toContain("LaunchKindV1.Classic");
  });

  it("limits stamps to future Classic and Custom provenance", () => {
    expect(page).toContain("Historical launches created before Router activation");
    expect(page).toContain(
      "Safety, tradability, liquidity, audit coverage, review status",
    );
    expect(page).toContain(
      "A Registry, indexer, Supabase project, Programmable API, or",
    );
    expect(page).toContain("The ABI and tuple layout are final");
    expect(page).toContain("The deployment is not");
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

  it("keeps the expanded reference semantic and reflow-safe", () => {
    expect(page).toContain('aria-labelledby="trust-root-heading"');
    expect(page).toContain("<dl className={styles.manifest}>");
    expect(page).toContain('aria-label="Launch stamp verification flow"');
    expect(page).toContain(
      'aria-label="StampRecordV1 fields in ABI order"',
    );
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
