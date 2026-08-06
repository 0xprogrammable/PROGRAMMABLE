import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROGRAMMABLE_ACTIVE_API_BASE,
  PROGRAMMABLE_ACTIVE_API_VERSION,
  PROGRAMMABLE_COMPAT_API_BASE,
  PROGRAMMABLE_COMPAT_API_VERSION,
  PROGRAMMABLE_CUSTOM_REGISTRY,
  PROGRAMMABLE_ENDPOINTS,
  PROGRAMMABLE_FEE_POLICY,
  PROGRAMMABLE_FEE_RECIPIENT,
  PROGRAMMABLE_FINALITY_STATES,
  PROGRAMMABLE_LABELS,
  PROGRAMMABLE_OPENAPI_URL,
  PROGRAMMABLE_PLATFORM_ID,
  PROGRAMMABLE_VERIFIED_DEFINITION,
  PROGRAMMABLE_WELL_KNOWN_URL,
} from "../components/developer-docs-contract";
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
      "/api/v2/launches/{chainId}/{tokenAddress}",
      "/api/v2/token-list",
    ]);
    for (const endpoint of PROGRAMMABLE_ENDPOINTS) {
      expect(developerDocsMarkdown).toContain(`GET ${endpoint.path}`);
    }
    expect(languageExamples[0]?.code).toContain(PROGRAMMABLE_WELL_KNOWN_URL);
    expect(languageExamples[1]?.code).toContain("discovery.apiBaseUrl");
  });

  it("locks platform identity and exactly two public labels", () => {
    expect(PROGRAMMABLE_PLATFORM_ID).toBe("programmable");
    expect(PROGRAMMABLE_LABELS).toEqual({
      classic: "Programmable Classic",
      custom: "Programmable Custom",
    });
    expect(developerDocsMarkdown).toContain(
      "Partner, template, model, builder and origin attribution are additional facts. They never create a third public category.",
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

  it("locks native and partner fee math plus the recipient", () => {
    expect(PROGRAMMABLE_FEE_RECIPIENT).toBe(
      "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
    );
    expect(PROGRAMMABLE_FEE_POLICY.nativeCustom).toEqual({
      chargeMode: "official market path only",
      programmableShareBps: 10,
      totalBps: 10,
    });
    expect(PROGRAMMABLE_FEE_POLICY.partnerTemplate).toEqual({
      chargeMode: "template enforced",
      partnerShareBps: 15,
      programmableShareBps: 5,
      totalBps: 20,
    });
    expect(developerDocsMarkdown).toContain(PROGRAMMABLE_FEE_RECIPIENT);
    expect(developerDocsMarkdown).toContain(
      "exactly 20 BPS total: 15 BPS partner plus 5 BPS Programmable",
    );
    expect(developerDocsMarkdown).toContain(
      "No additional native 10 BPS is added",
    );
  });

  it("keeps Community Custom fail-closed without placeholders", () => {
    expect(PROGRAMMABLE_CUSTOM_REGISTRY).toEqual({
      address: null,
      publicSubmissionsEnabled: false,
      startBlock: null,
      status: "prelaunch",
    });
    expect(developerDocsMarkdown).toContain(
      "Registry address and start block are `null`",
    );
    expect(developerDocsMarkdown).toContain(
      "`publicSubmissionsEnabled` is `false`",
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
      "PROGRAMMABLE_VERIFIED_DEFINITION",
    ]) {
      expect(pageSource).toContain(exportName);
    }
  });
});
