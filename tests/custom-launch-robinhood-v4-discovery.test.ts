import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from "../lib/custom-launch/registry-public-manifest-v1";
import { developerDocsMarkdown } from "../lib/developer-docs-content";
import { programmablePublicOpenApi } from "../lib/public-openapi";
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
      releaseReady: false,
      apiVersion: "4",
      profileVersion: "4.0.0",
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
      sourceVerificationSchemaUrl:
        "https://programmable.market/schemas/custom-launch/v4/source-verification-status.json",
      guideUrl:
        "https://programmable.market/docs/developers/custom-launch#robinhood-v4",
      admissionDescriptorUrl:
        "https://github.com/programmablehq/Launch-Policy/blob/main/policy/custom-launch-admission-v4.json",
      sourceRepository: "https://github.com/programmablehq/PROGRAMMABLE",
      launchPolicyRepository: "https://github.com/programmablehq/Launch-Policy",
      cli: {
        sourceCandidateVersion: "4.0.0",
        sourceCandidate: true,
        released: false,
        installable: false,
        liveEthereumVersion: "3.3.9",
        signsWalletTransactions: false,
        broadcastsWalletTransactions: false,
      },
      lifecycle: {
        statuses: [
          "received",
          "validating",
          "action_required",
          "authorized",
          "awaiting_wallet_signature",
          "wallet_action_required",
          "submitted",
          "sequencer_soft_confirmed",
          "ethereum_posted",
          "finalized",
          "failed",
        ],
        actionRequiredMeaning:
          "server-authored-remediation-not-wallet-action",
        walletStageStatusCommand:
          "programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until authorized",
        finalityStatusCommand:
          "programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663 --watch --until finalized",
        sourceVerificationStartsAfter: "finalized",
        sourceVerificationIndependentFromFinality: true,
        indexingTradingAndPublicationIndependent: true,
      },
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
      releaseReady: false,
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
      releaseReady: false,
      apiVersion: "4",
      profileVersion: "4.0.0",
      clientSelectableProfile: false,
      apiKeyPlaceholder: "$PROGRAMMABLE_API_KEY",
      feeBehaviorClaim: false,
      externalIndexingGuaranteed: false,
      cli: {
        sourceCandidateVersion: "4.0.0",
        released: false,
        installable: false,
        liveEthereumVersion: "3.3.9",
        signsWalletTransactions: false,
        broadcastsWalletTransactions: false,
      },
      lifecycle: {
        actionRequiredMeaning:
          "server-authored-remediation-not-wallet-action",
        sourceVerificationStartsAfter: "finalized",
        sourceVerificationIndependentFromFinality: true,
        indexingTradingAndPublicationIndependent: true,
      },
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
    const websiteGuide = read("app/docs/developers/custom-launch/page.tsx");
    const machineReadablePage = read(
      "app/docs/developers/machine-readable/page.tsx",
    );
    const publicDocs = [
      read("README.md"),
      read("docs/public/README.md"),
      read("docs/public/creators/launch.md"),
      read("docs/public/developers/README.md"),
      developerGuide,
      read("docs/public/reference/official-links.md"),
      read("docs/public/status.md"),
      rawGuide,
      read("packages/launch/README.md"),
      websiteGuide,
      machineReadablePage,
      developerDocsMarkdown,
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
    expect(publicDocs).toMatch(/Sourcify v2 provider-native `match`/iu);
    expect(publicDocs).toMatch(/protected-build\/finalized-bytecode binding/iu);
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
    expect(publicDocs).toContain("source candidate");
    expect(publicDocs).toContain("4.0.0");
    expect(publicDocs).toContain("releaseReady: false");
    expect(publicDocs).toContain(
      "programmable-launch status REQUEST_UUID --api-version 4 --chain-id 4663",
    );
    for (const status of [
      "received",
      "validating",
      "action_required",
      "authorized",
      "awaiting_wallet_signature",
      "wallet_action_required",
      "submitted",
      "sequencer_soft_confirmed",
      "ethereum_posted",
      "finalized",
      "failed",
    ]) {
      expect(publicDocs).toContain(status);
    }
    expect(publicDocs).toMatch(/action_required[\s\S]{0,260}(?:not a wallet|remediation)/iu);
    expect(publicDocs).toMatch(/source verification[\s\S]{0,180}(?:after finality|starts after|starts only after)/iu);
    expect(publicDocs).toMatch(/(?:never signs or broadcasts|never sign or broadcast)/iu);
    expect(publicDocs).not.toContain(
      "https://github.com/0xprogrammable/PROGRAMMABLE/releases",
    );

    expect(programmablePublicOpenApi["x-programmable-availability"].v4)
      .toMatchObject({
        status: "planned",
        activationStage: "planned-not-deployed",
        profileVersion: "4.0.0",
        released: false,
        installable: false,
        releaseReady: false,
        publicAuthorization: false,
        publicWrites: false,
        chainId: 4663,
        caip2: "eip155:4663",
        cliWalletAuthority: false,
        sourceVerificationStartsAfter: "finalized",
        sourceVerificationIndependentFromFinality: true,
        indexingTradingAndPublicationIndependent: true,
      });
  });
});
