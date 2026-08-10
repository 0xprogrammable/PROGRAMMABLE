import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  LAUNCH_KIND_V1,
  PROGRAMMABLE_LAUNCH_STAMP_MANIFEST,
  PROGRAMMABLE_LAUNCH_STAMP_RESOURCES,
  PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI,
} from "../components/launch-stamp-docs-contract";
import {
  developerDocsMarkdown,
  programmableLlmsIndex,
} from "../lib/developer-docs-content";

const root = process.cwd();
const overviewSource = readFileSync(
  join(root, "app/docs/developers/page.tsx"),
  "utf8",
);
const verifySource = readFileSync(
  join(root, "app/docs/developers/verify/page.tsx"),
  "utf8",
);
const indexingSource = readFileSync(
  join(root, "app/docs/developers/indexing/page.tsx"),
  "utf8",
);
const machineReadableSource = readFileSync(
  join(root, "app/docs/developers/machine-readable/page.tsx"),
  "utf8",
);
const routerReferenceSource = readFileSync(
  join(root, "app/docs/launch-stamps/page.tsx"),
  "utf8",
);
const router = PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.launchStampRouter;

describe("Router-first public developer-contract facts", () => {
  it("locks the live Ethereum trust root", () => {
    expect(PROGRAMMABLE_LAUNCH_STAMP_MANIFEST.chainId).toBe(1);
    expect(router).toMatchObject({
      status: "live",
      address: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
      startBlock: "25717612",
      endBlock: null,
      runtimeCodeHash:
        "0x40e27ecf201761d5eb66bc4f2d5c6124831ef078d7baf458ca5f41b1a8108546",
      finalityConfirmations: 64,
      abiSha256:
        "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
    });
    for (const value of [
      router.address,
      router.startBlock,
      router.runtimeCodeHash,
      router.abiSha256,
    ]) {
      expect(developerDocsMarkdown).toContain(value);
      expect(programmableLlmsIndex).toContain(value);
    }
  });

  it("locks discovery, manifest, ABI and GitHub resources", () => {
    expect(PROGRAMMABLE_LAUNCH_STAMP_RESOURCES).toEqual({
      discoveryUrl:
        "https://developers.programmable.family/.well-known/programmable.json",
      manifestUrl: "https://developers.programmable.family/api/v2/manifest",
      abiUrl:
        "https://developers.programmable.family/abis/ethereum/programmable-launch-stamp-router-v1.json",
      abiGithubUrl:
        "https://raw.githubusercontent.com/0xprogrammable/developers/main/abis/ethereum/programmable-launch-stamp-router-v1.json",
      abiSha256:
        "sha256:bb4e728e9f9c850eb01f928e8a798ac206a82e241a8d93b3b3c686635c88ed86",
      referenceUrl:
        "https://github.com/0xprogrammable/developers/blob/main/docs/reference/launch-stamp.md",
      terminalGuideUrl:
        "https://github.com/0xprogrammable/developers/blob/main/docs/guides/terminals-and-scanners.md",
      jsonRpcVerifierUrl:
        "https://github.com/0xprogrammable/developers/blob/main/examples/verify-launch-stamp.mjs",
      viemVerifierUrl:
        "https://github.com/0xprogrammable/developers/blob/main/examples/verify-launch-stamp-viem.ts",
    });
    for (const value of [
      PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.discoveryUrl,
      PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.manifestUrl,
      PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiUrl,
      PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.abiSha256,
      PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.referenceUrl,
      PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.terminalGuideUrl,
      PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.jsonRpcVerifierUrl,
      PROGRAMMABLE_LAUNCH_STAMP_RESOURCES.viemVerifierUrl,
    ]) {
      expect(developerDocsMarkdown).toContain(value);
    }
  });

  it("locks exactly two supported public launch kinds", () => {
    expect(LAUNCH_KIND_V1).toEqual([
      { value: 0, name: "Invalid", publicLabel: null },
      { value: 1, name: "CustomGraph", publicLabel: "Programmable Custom" },
      { value: 2, name: "Classic", publicLabel: "Programmable Classic" },
    ]);
    expect(developerDocsMarkdown).toContain(
      "| `1` | `CustomGraph` | Programmable Custom |",
    );
    expect(developerDocsMarkdown).toContain(
      "| `2` | `Classic` | Programmable Classic |",
    );
    expect(developerDocsMarkdown).toContain(
      "`LaunchKindV1.Invalid = 0` is never a Programmable launch classification.",
    );
  });

  it("locks token, pool and exclusive-component verification reads", () => {
    for (const read of [
      ...PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI.primaryReads,
      ...PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI.componentReads,
    ]) {
      expect(developerDocsMarkdown).toContain(read.signature);
    }
    expect(developerDocsMarkdown).toContain(
      "The shared Classic hook is not a launch identifier.",
    );
    expect(developerDocsMarkdown).toContain(
      "every runtime, binding, lookup, record, and proof read",
    );
  });

  it("publishes every canonical event signature and topic", () => {
    for (const event of Object.values(router.events)) {
      expect(developerDocsMarkdown).toContain(event.signature);
      expect(developerDocsMarkdown).toContain(event.topic0);
    }
    expect(developerDocsMarkdown).toContain(
      "Point verification does not require an indexer.",
    );
    expect(developerDocsMarkdown).toContain("last common finalized checkpoint");
    expect(developerDocsMarkdown).toContain("requireCanonical: true");
  });

  it("publishes the finalized PCAN vector", () => {
    const canary = router.canaryEvidence;
    for (const value of [
      canary.transactionHash,
      canary.launchId,
      canary.stampHash,
      canary.components.token,
      canary.components.hook,
      canary.components.initializer,
      canary.pool.poolId,
    ]) {
      expect(developerDocsMarkdown).toContain(value);
    }
    expect(developerDocsMarkdown).toContain("## Finalized PCAN vector");
  });

  it("keeps the provenance boundary exact on every machine surface", () => {
    for (const surface of [developerDocsMarkdown, programmableLlmsIndex]) {
      expect(surface).toContain("Historical");
      expect(surface).toMatch(/direct (?:factory|Classic)/i);
      expect(surface).toMatch(/not (?:establish )?safety/i);
      expect(surface).toContain("tradability");
      expect(surface).toContain("current liquidity");
      expect(surface).toContain("terminal support");
      expect(surface).toContain("self-service");
      expect(surface).not.toContain("Community Custom Registry");
      expect(surface).not.toContain("cursor traversal");
      expect(surface).not.toContain("GET /api/v2/launches");
    }
  });

  it("makes every human guide consume the shared Router contract", () => {
    for (const exportName of [
      "LAUNCH_KIND_V1",
      "PROGRAMMABLE_LAUNCH_STAMP_MANIFEST",
      "PROGRAMMABLE_LAUNCH_STAMP_RESOURCES",
    ]) {
      expect(overviewSource).toContain(exportName);
    }
    for (const source of [verifySource, indexingSource, routerReferenceSource]) {
      expect(source).toContain("PROGRAMMABLE_LAUNCH_STAMP_MANIFEST");
      expect(source).toContain("PROGRAMMABLE_LAUNCH_STAMP_ROUTER_V1_ABI");
    }
    expect(verifySource).toContain("router.runtimeCodeHash");
    expect(verifySource).toContain("router.abiSha256");
    expect(verifySource).toContain("router.finalityConfirmations");
    expect(verifySource).toContain("Return one of four results");
    expect(indexingSource).toContain("Object.values(router.events)");
    expect(indexingSource).toContain("router.finalityConfirmations");
    expect(indexingSource).toContain("requireCanonical: true");
    expect(machineReadableSource).toContain(
      "PROGRAMMABLE_LAUNCH_STAMP_RESOURCES",
    );

    for (const source of [
      overviewSource,
      verifySource,
      indexingSource,
      machineReadableSource,
      routerReferenceSource,
    ]) {
      expect(source).not.toContain("PROGRAMMABLE_ACTIVE_API_BASE");
      expect(source).not.toContain("PROGRAMMABLE_FEE_POLICY");
      expect(source).not.toContain("CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH");
    }
  });
});
