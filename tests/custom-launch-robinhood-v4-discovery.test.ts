import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from "../lib/custom-launch/registry-public-manifest-v1";
import {
  createProgrammableWellKnownHandlerV1,
  programmableWellKnownDocumentV1,
} from "../lib/server/custom-launch/well-known-v1";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("planned Robinhood Chain V4 discovery", () => {
  it("publishes one non-live chain-bound V4 contract", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    const v4 = document.customLaunchApi.versions.v4;

    expect(v4).toEqual({
      status: "planned",
      activationStage: "planned-not-deployed",
      publicAuthorization: false,
      publicWrites: false,
      chainId: 4663,
      caip2: "eip155:4663",
      network: "Robinhood Chain Mainnet",
      capabilitiesPath: "/v4/chains/4663/capabilities",
      preflightPath: "/v4/chains/4663/custom-launches/preflight",
      createPath: "/v4/chains/4663/custom-launches",
      statusPath: "/v4/chains/4663/custom-launches/{launchId}",
      finalizedMetadataPath: "/v4/chains/4663/finalized-custom-launches",
      openApiUrl: "https://programmable.market/openapi/custom-launch-v4.json",
      packConfigSchemaUrl:
        "https://programmable.market/schemas/custom-launch/v4/pack-config.json",
      admissionDescriptorUrl:
        "https://github.com/programmablehq/Launch-Policy/blob/main/policy/custom-launch-admission-v4.json",
      sourceRepository: "https://github.com/programmablehq/PROGRAMMABLE",
      launchPolicyRepository: "https://github.com/programmablehq/Launch-Policy",
      foundationSourceCommitment:
        "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
      sourceVerification: {
        requiredProvider: "sourcify-v2",
        requiredMatch: "exact",
        blockscoutAvailability: "optional-unproven-degraded",
        blockscoutExactSourceClaimAllowed: false,
        blockscoutFinalityBlocker: false,
        finalityIndependent: true,
      },
      deploymentEvidence: {
        chainDeploymentDescriptorDigest: null,
        chainDeploymentId: null,
        finalityPolicyDigest: null,
        finalizedBlock: null,
        finalizedEvidenceRef: null,
        foundationSourceCommitment: null,
        roots: {
          graphFactory: null,
          permit2: null,
          permitAuthoritySafe: null,
          poolManager: null,
          positionManager: null,
          programmableLaunchStampRouter: null,
          stateView: null,
          universalRouter: null,
          v4Quoter: null,
        },
      },
      authentication: "bearer-api-key",
      apiKeyEnvironmentVariable: "PROGRAMMABLE_API_KEY",
      apiKeyPlaceholder: "$PROGRAMMABLE_API_KEY",
      walletAuthorization: "separate-review-and-sign",
      profileSelection: "api-server-chain-binding",
      clientSelectableProfile: false,
      readinessProfile: "robinhood-launch-readiness",
      productionProfile: "robinhood-production-launch",
      decisionAuthority: "api-server",
      localOrModelApprovalAccepted: false,
      projectOwnedToken: true,
      projectOwnedHook: true,
      minimumTargets: 3,
      maximumTargets: 16,
      hookPermissionMaskRange: { minimum: 0, maximum: 16_383 },
      allFourteenHookPermissionsStructurallySupported: true,
      advertisedFundingModes: ["none", "wallet-transaction-value"],
      erc20FundingStatus: "not-advertised-until-separate-proof",
      safetyClaim: false,
      feeBehaviorClaim: false,
      genericFeeClaiming: "not-live",
      genericBuybackManagement: "not-live",
      externalIndexingGuaranteed: false,
      legacyIntake: { registry: "closed", github: "closed" },
      activationBlockers: [
        "programmable-chain-deployments",
        "server-chain-fork-simulation",
        "wallet-chain-binding",
        "finalized-router-evidence",
        "source-verification-provider-binding",
        "chain-indexing-readiness",
      ],
    });
    expect(document.chains).toContainEqual({
      chainId: 4663,
      caip2: "eip155:4663",
      name: "Robinhood Chain Mainnet",
      explorerUrl: "https://robinhoodchain.blockscout.com",
      status: "planned",
      customLaunchApiVersion: "4",
      activationStage: "planned-not-deployed",
      publicWrites: false,
      externalIndexingGuaranteed: false,
    });
    const { foundationSourceCommitment, ...withoutSourceCommitment } = v4;
    expect(foundationSourceCommitment).toBe(
      "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
    );
    expect(JSON.stringify(withoutSourceCommitment)).not.toMatch(/0x[0-9a-f]{40}/iu);
  });

  it("serializes the same planned contract through public well-known discovery", async () => {
    const response = createProgrammableWellKnownHandlerV1({})(
      new Request("https://programmable.market/.well-known/programmable.json"),
    );
    const document = await response.json();

    expect(response.status).toBe(200);
    expect(document.customLaunchApi.versions.v4).toMatchObject({
      status: "planned",
      activationStage: "planned-not-deployed",
      publicAuthorization: false,
      publicWrites: false,
      clientSelectableProfile: false,
      apiKeyPlaceholder: "$PROGRAMMABLE_API_KEY",
      feeBehaviorClaim: false,
      externalIndexingGuaranteed: false,
      foundationSourceCommitment:
        "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
      sourceVerification: {
        requiredProvider: "sourcify-v2",
        requiredMatch: "exact",
        blockscoutAvailability: "optional-unproven-degraded",
        blockscoutExactSourceClaimAllowed: false,
        blockscoutFinalityBlocker: false,
        finalityIndependent: true,
      },
      deploymentEvidence: {
        chainDeploymentDescriptorDigest: null,
        chainDeploymentId: null,
        finalityPolicyDigest: null,
        finalizedBlock: null,
        finalizedEvidenceRef: null,
        foundationSourceCommitment: null,
      },
    });
  });

  it("keeps public guides aligned with the planned and non-authorizing boundary", () => {
    const developerGuide = read("docs/public/developers/custom-launch.md");
    const rawGuide = read("public/developers/custom-launch-api-v1.md");
    const publicDocs = [
      read("README.md"),
      read("docs/public/README.md"),
      read("docs/public/creators/launch.md"),
      read("docs/public/developers/README.md"),
      developerGuide,
      read("docs/public/reference/official-links.md"),
      read("docs/public/status.md"),
      rawGuide,
    ].join("\n");

    expect(publicDocs).toMatch(/Robinhood Chain V4/iu);
    expect(publicDocs).toMatch(/planned/iu);
    expect(publicDocs).toMatch(/planned-not-deployed|not deployed/iu);
    expect(publicDocs).toContain("$PROGRAMMABLE_API_KEY");
    expect(publicDocs).toMatch(/external index/iu);
    expect(publicDocs).toMatch(/generic fee claiming/iu);
    expect(publicDocs).toMatch(/generic buyback management/iu);
    expect(publicDocs).toContain("eip155:4663");
    expect(publicDocs).toMatch(/external.contract reference/iu);
    expect(publicDocs).toMatch(/runtime hash/iu);
    expect(publicDocs).toMatch(/source-verification evidence|source evidence/iu);
    expect(publicDocs).toMatch(/declared graph role|graph role/iu);
    expect(publicDocs).toMatch(/checkpoint/iu);
    expect(publicDocs).toMatch(/arbitrary or unbound/iu);
    expect(publicDocs).toMatch(/gain no trust|do not gain trust|does not make it a trust root/iu);
    expect(publicDocs).toContain(
      "0xe87f5edc2dc839bd87a26a80cb53f14b021e603a1753d27aae3a02862058d730",
    );
    expect(publicDocs).toMatch(/Sourcify v2 exact match/iu);
    expect(publicDocs).toMatch(/Blockscout/iu);
    expect(publicDocs).toMatch(/optional,? (?:currently )?unproven and degraded|optional-unproven-degraded/iu);
    expect(publicDocs).toMatch(/cannot support an exact-source claim/iu);
    expect(publicDocs).toMatch(/block or revise finality|not a finality blocker/iu);
    expect(developerGuide).toContain("/v4/chains/4663/capabilities");
    expect(rawGuide).toContain("/v4/chains/4663/custom-launches/{launchId}");
    expect(publicDocs).toContain(
      "https://programmable.market/openapi/custom-launch-v4.json",
    );
    expect(publicDocs).toContain(
      "https://programmable.market/schemas/custom-launch/v4/pack-config.json",
    );
    expect(publicDocs).toContain(
      "https://github.com/programmablehq/PROGRAMMABLE",
    );
    expect(publicDocs).not.toContain(
      "https://github.com/0xprogrammable/PROGRAMMABLE/releases",
    );
  });
});
