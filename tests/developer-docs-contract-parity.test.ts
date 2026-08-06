import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROGRAMMABLE_ACTIVE_API_BASE,
  PROGRAMMABLE_ACTIVE_API_VERSION,
  PROGRAMMABLE_COMPAT_API_BASE,
  PROGRAMMABLE_COMPAT_API_VERSION,
  PROGRAMMABLE_ENDPOINTS,
  PROGRAMMABLE_FEE_POLICY,
  PROGRAMMABLE_FEE_RECIPIENT,
  PROGRAMMABLE_FINALITY_STATES,
  PROGRAMMABLE_LABELS,
  PROGRAMMABLE_OPENAPI_URL,
  PROGRAMMABLE_PLATFORM_ID,
  PROGRAMMABLE_RUNTIME_HASH_SEAM,
  PROGRAMMABLE_VERIFIED_DEFINITION,
  PROGRAMMABLE_WELL_KNOWN_URL,
} from "../components/developer-docs-contract";
import {
  CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
  PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
} from "../lib/custom-launch/registry-public-manifest-v1";
import {
  agentPrompt,
  languageExamples,
} from "../components/developer-docs-workbench";
import {
  developerDocsMarkdown,
  programmableLlmsIndex,
} from "../lib/developer-docs-content";

const root = process.cwd();
const pageSource = readFileSync(
  join(root, "app/docs/developers/page.tsx"),
  "utf8",
);

describe("canonical public developer-contract facts", () => {
  it("keeps active discovery and supported v1 compatibility explicit", () => {
    expect(PROGRAMMABLE_ACTIVE_API_VERSION).toBe("2");
    expect(PROGRAMMABLE_ACTIVE_API_BASE).toBe(
      "https://developers.programmable.family/api/v2",
    );
    expect(PROGRAMMABLE_COMPAT_API_VERSION).toBe("1");
    expect(PROGRAMMABLE_COMPAT_API_BASE).toBe(
      "https://developers.programmable.family/api/v1",
    );
    expect(PROGRAMMABLE_WELL_KNOWN_URL).toBe(
      "https://developers.programmable.family/.well-known/programmable.json",
    );
    expect(PROGRAMMABLE_OPENAPI_URL).toBe(
      "https://developers.programmable.family/openapi/programmable-v2.yaml",
    );
    expect(developerDocsMarkdown).toContain(
      `Active API: v2 at ${PROGRAMMABLE_ACTIVE_API_BASE}`,
    );
    expect(developerDocsMarkdown).toContain(
      `Compatibility API: v1 at ${PROGRAMMABLE_COMPAT_API_BASE}`,
    );
  });

  it("locks the complete active endpoint inventory to one major", () => {
    expect(PROGRAMMABLE_ENDPOINTS.map((endpoint) => endpoint.path)).toEqual([
      "/.well-known/programmable.json",
      "/api/v2/status",
      "/api/v2/manifest",
      "/api/v2/launches",
      "/api/v2/launches/{launchId}",
      "/api/v2/launches/{chainId}/{tokenAddress}",
      "/api/v2/token-list",
    ]);
    for (const endpoint of PROGRAMMABLE_ENDPOINTS) {
      expect(developerDocsMarkdown).toContain(`GET ${endpoint.path}`);
    }
    expect(languageExamples[0]?.code).toContain(PROGRAMMABLE_WELL_KNOWN_URL);
    expect(languageExamples[1]?.code).toContain("discovery.apiBaseUrl");
    expect(developerDocsMarkdown).toContain(
      "including project-only and multi-asset records",
    );
  });

  it("locks the EVM runtime hash algorithm without conflating SHA-256 evidence", () => {
    expect(PROGRAMMABLE_RUNTIME_HASH_SEAM).toEqual({
      keccakAlgorithm: "keccak256(runtime bytecode)",
      keccakField: "runtimeCodeKeccak256",
      keccakFormat: "0x-prefixed bytes32",
      sha256Field: "runtimeCodeSha256",
      sha256Format: "sha256:",
    });
    expect(developerDocsMarkdown).toContain(
      "`runtimeCodeKeccak256` is the `0x-prefixed bytes32` `keccak256(runtime bytecode)`",
    );
    expect(developerDocsMarkdown).toContain(
      "Optional `runtimeCodeSha256` evidence uses the `sha256:` prefix",
    );
    expect(agentPrompt).toContain(
      "runtimeCodeKeccak256 is 0x-prefixed bytes32 keccak256(runtime bytecode)",
    );
    for (const publicSurface of [
      developerDocsMarkdown,
      agentPrompt,
      pageSource,
    ]) {
      expect(publicSurface).not.toContain("runtimeCodeHash");
    }
  });

  it("locks platform identity and exactly two public labels", () => {
    expect(PROGRAMMABLE_PLATFORM_ID).toBe("programmable");
    expect(PROGRAMMABLE_LABELS).toEqual({
      classic: "Programmable Classic",
      custom: "Programmable Custom",
    });
    expect(developerDocsMarkdown).toContain(
      "Partner, template, model, builder and origin attribution are additional facts. They never create a third public category and remain independent from market availability and fee activation.",
    );
    expect(agentPrompt).toContain("platformId=programmable");
  });

  it("locks the bounded Verified definition and lifecycle", () => {
    expect(PROGRAMMABLE_VERIFIED_DEFINITION).toBe(
      "Reviewed against the published Programmable security policy and cryptographically bound to the exact deployed contract revision.",
    );
    expect(PROGRAMMABLE_FINALITY_STATES).toEqual([
      "observed",
      "confirmed",
      "finalized",
      "orphaned",
    ]);
    expect(developerDocsMarkdown).toContain(PROGRAMMABLE_VERIFIED_DEFINITION);
    expect(programmableLlmsIndex).toContain(PROGRAMMABLE_VERIFIED_DEFINITION);
    expect(agentPrompt).toContain(PROGRAMMABLE_VERIFIED_DEFINITION);
  });

  it("locks native and active partner fee math without coupling attribution", () => {
    expect(PROGRAMMABLE_FEE_RECIPIENT).toBe(
      "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    );
    expect(PROGRAMMABLE_FEE_POLICY.nativeCustom).toEqual({
      chargeMode: "official market path only",
      programmableShareBps: 10,
      totalBps: 10,
    });
    expect(PROGRAMMABLE_FEE_POLICY.partnerTemplate).toEqual({
      applicability: "active fee-bearing partner-template market path",
      attributionIndependent: true,
      chargeMode: "template enforced",
      noQualifyingMarket: {
        partnerShareBps: 0,
        programmableShareBps: 0,
        status: "no-qualifying-market",
        totalBps: 0,
      },
      partnerShareBps: 15,
      programmableShareBps: 5,
      totalBps: 20,
    });
    expect(developerDocsMarkdown).toContain(PROGRAMMABLE_FEE_RECIPIENT);
    expect(developerDocsMarkdown).toContain(
      "a verified partner-attributed project may report `no-qualifying-market` with 0/0/0 BPS",
    );
    expect(developerDocsMarkdown).toContain(
      "Active fee-bearing partner-template target policy:** exactly 20 BPS total: 15 BPS partner plus 5 BPS Programmable",
    );
    expect(developerDocsMarkdown).toContain(
      "No additional native 10 BPS is added",
    );
    expect(agentPrompt).toContain(
      "Partner and template attribution are independent from market and fee state",
    );
    expect(agentPrompt).toContain(
      "active fee-bearing partner-template path must prove 20 BPS total: 15 partner and 5 Programmable",
    );
  });

  it("keeps Community Custom fail-closed without placeholders", () => {
    expect(PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1).toMatchObject({
      status: "prelaunch",
      publicSubmissionsEnabled: false,
      startBlock: null,
      contracts: {
        registry: { address: null, runtimeCodeKeccak256: null },
      },
    });
    expect(developerDocsMarkdown).toContain(
      "Registry address is `null`, start block is `null`",
    );
    expect(developerDocsMarkdown).toContain(
      "`publicSubmissionsEnabled` is `false`",
    );
    expect(developerDocsMarkdown).toContain(
      CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH,
    );
    expect(developerDocsMarkdown).not.toContain(
      "The Programmable Custom Registry is live",
    );
  });

  it("requires every public surface to consume the shared facts module", () => {
    for (const exportName of [
      "PROGRAMMABLE_ACTIVE_API_VERSION",
      "PROGRAMMABLE_COMPAT_API_VERSION",
      "PROGRAMMABLE_FEE_POLICY",
      "PROGRAMMABLE_FEE_RECIPIENT",
      "PROGRAMMABLE_FINALITY_STATES",
      "PROGRAMMABLE_LABELS",
      "PROGRAMMABLE_RUNTIME_HASH_SEAM",
      "PROGRAMMABLE_VERIFIED_DEFINITION",
    ]) {
      expect(pageSource).toContain(exportName);
    }
  });
});
