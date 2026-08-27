import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  PROGRAMMABLE_AGENT_SETUP_LINKS_V1,
  PROGRAMMABLE_AGENT_SETUP_TEXT_V1,
} from "../lib/custom-launch/agent-setup-v1";
import { PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1 } from
  "../lib/custom-launch/registry-public-manifest-v1";
import { programmableWellKnownDocumentV1 } from
  "../lib/server/custom-launch/well-known-v1";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const catalog = JSON.parse(read(
  "public/policies/custom-launch-agent-remediation-v1.json",
));
const openApi = JSON.parse(read("public/openapi/custom-launch-v3.json"));
const websiteGuide = read("app/docs/developers/custom-launch/page.tsx");
const gitBookGuide = read("docs/public/developers/custom-launch.md");
const rawGuide = read("public/developers/custom-launch-api-v1.md");
const packagePackConfigSchema = read(
  "packages/launch/schemas/programmable-launch-pack-config-v3.json",
);
const publicPackConfigSchema = read(
  "public/schemas/custom-launch/v3/pack-config.json",
);

const catalogUrl =
  "https://programmable.market/policies/custom-launch-agent-remediation-v1.json";
const discoveryUrl =
  "https://programmable.market/.well-known/programmable.json";
const guideUrl =
  "https://programmable.market/docs/developers/custom-launch#existing-project-integration";
const packConfigSchemaUrl =
  "https://programmable.market/schemas/custom-launch/v3/pack-config.json";

describe("Custom Launch cold-agent remediation contract", () => {
  it("publishes the exact CLI pack-config schema bytes", () => {
    expect(publicPackConfigSchema).toBe(packagePackConfigSchema);
  });

  it("is reachable from discovery and OpenAPI without a secret", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );

    expect(document.customLaunchApi.agentIntegration).toEqual({
      status: "live",
      schemaVersion:
        "programmable.custom-launch-agent-remediation-catalog.v1",
      startUrl: discoveryUrl,
      remediationCatalogUrl: catalogUrl,
      packConfigSchemaUrl,
      existingProjectGuideUrl: guideUrl,
      openApiUrl: "https://programmable.market/openapi/custom-launch-v3.json",
      capabilitiesUrl: "https://api.programmable.market/v3/capabilities",
      preflightUrl: "https://api.programmable.market/v3/custom-launches/preflight",
      finalizedMetadataUrl:
        "https://api.programmable.market/v3/finalized-custom-launches",
      apiKeyEnvironmentVariable: "PROGRAMMABLE_API_KEY",
      apiKeyPlaceholder: "$PROGRAMMABLE_API_KEY",
      apiKeyContainsPolicy: false,
      manualProjectAllowlist: false,
      automaticAdmission: true,
      automaticRouterSimulation: true,
      fundingAuthorizationPatch: {
        schemaVersion: "programmable.eip3009-authorization-patch.v2",
        configKey: "fundingSignaturePatch",
        authorizationEncoding: "eip3009-nonce-r-s-v-abi-leaves",
      },
      walletSigning: "separate-controller-action",
      requiredCommandOrder: [
        "pack",
        "validate --remote",
        "submit",
        "status --watch --until authorized",
        "status --watch --until finalized",
      ],
      quickstart: [
        "pack",
        "validate --remote",
        "submit",
        "status --watch --until authorized",
        "wallet",
        "status --watch --until finalized",
      ],
      authenticatedApiOrigin: "https://api.programmable.market",
      apiOriginOverride: false,
      preflightAndSubmitCapabilitiesFailClosedBeforeApiKey: true,
      remotePreflight: {
        quotaConsumed: false,
        nonceAllocated: false,
        persisted: false,
        walletSignatureRequiredLater: true,
        walletBroadcastByService: false,
      },
    });

    expect(openApi["x-programmable-agent-integration"]).toMatchObject({
      schemaVersion:
        "programmable.custom-launch-agent-remediation-catalog.v1",
      startUrl: discoveryUrl,
      remediationCatalogUrl: catalogUrl,
      packConfigSchemaUrl,
      guideUrl,
      capabilitiesUrl: "https://api.programmable.market/v3/capabilities",
      preflightUrl: "https://api.programmable.market/v3/custom-launches/preflight",
      apiKeyEnvironmentVariable: "PROGRAMMABLE_API_KEY",
      apiKeyPlaceholder: "$PROGRAMMABLE_API_KEY",
      apiKeyContainsPolicy: false,
      manualProjectAllowlist: false,
      automaticAdmission: true,
      requiredCommandOrder: [
        "pack",
        "validate --remote",
        "submit",
        "status --watch --until authorized",
        "status --watch --until finalized",
      ],
      quickstart: [
        "pack",
        "validate --remote",
        "submit",
        "status --watch --until authorized",
        "wallet",
        "status --watch --until finalized",
      ],
      authenticatedApiOrigin: "https://api.programmable.market",
      apiOriginOverride: false,
      preflightAndSubmitCapabilitiesFailClosedBeforeApiKey: true,
      remotePreflight: {
        quotaConsumed: false,
        nonceAllocated: false,
        persisted: false,
        walletSignatureRequiredLater: true,
        walletBroadcastByService: false,
      },
    });
  });

  it("publishes one deterministic existing-project workflow", () => {
    const document = programmableWellKnownDocumentV1(
      PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1,
    );
    expect(catalog).toMatchObject({
      schemaVersion:
        "programmable.custom-launch-agent-remediation-catalog.v1",
      catalogVersion: "1.0.0",
      status: "live",
      authoritativeSources: {
        packConfigSchemaUrl,
        cliReleaseVersion: "3.3.5",
        cliChecksumUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.5/programmable-launch-3.3.5.tgz.sha256",
        cliTarballSha256:
          "sha256:d9df0c0bb4d492d0303bc849ea74b2a337dc5aef217c954192ad5c14576039ca",
      },
      profile: {
        profileId: "programmable.direct-native-hook-graph.v1",
        profileRevision: 3,
        profileVersion: "3.2.0",
        compatibleProfileVersions: ["3.1.0", "3.0.0"],
        chainId: "1",
        productionLaunchAuthorized: true,
      },
      agentContract: {
        coldStartUrl: discoveryUrl,
        apiKeyEnvironmentVariable: "PROGRAMMABLE_API_KEY",
        apiKeyPlaceholder: "$PROGRAMMABLE_API_KEY",
        apiKeyContainsPolicy: false,
        authenticatedApiOrigin: "https://api.programmable.market",
        apiOriginOverride: false,
        preflightAndSubmitCapabilitiesFailClosedBeforeApiKey: true,
        manualProjectAllowlist: false,
        projectSpecificApprovalPath: false,
        automaticAdmission: true,
        automaticWalletSigning: false,
        automaticBroadcast: false,
        remotePreflight: {
          quotaConsumed: false,
          nonceAllocated: false,
          persisted: false,
          walletSignatureRequiredLater: true,
          walletBroadcastByService: false,
        },
      },
    });
    expect(catalog.workflow.map(({ id }: { id: string }) => id)).toEqual([
      "discover",
      "inspect-project",
      "create-pack-config",
      "pack",
      "validate",
      "submit",
      "status-before-wallet",
      "status-after-wallet",
    ]);
    expect(catalog.quickstart).toEqual([
      "pack",
      "validate --remote",
      "submit",
      "status --watch --until authorized",
      "wallet",
      "status --watch --until finalized",
    ]);
    expect(catalog.commands).toEqual([
      "programmable-launch pack --config programmable-launch.config.json --output launch.json",
      "programmable-launch validate launch.json --config programmable-launch.config.json --remote",
      "programmable-launch submit launch.json --config programmable-launch.config.json",
      "programmable-launch status REQUEST_UUID --watch --until authorized",
      "programmable-launch status REQUEST_UUID --watch --until finalized",
    ]);
    expect(catalog.authoritativeSources.cliChecksumUrl).toBe(
      document.customLaunchApi.cli.checksumUrl,
    );
    expect(catalog.authoritativeSources.cliTarballSha256).toBe(
      document.customLaunchApi.cli.tarballSha256,
    );
    expect(catalog.packConfig).toMatchObject({
      schemaVersion: "programmable.launch-pack-config.v3",
      schemaUrl: packConfigSchemaUrl,
      defaultFileName: "programmable-launch.config.json",
      sourceRevisionMustContainSubmittedBytes: true,
      derivedValuesAreCliOwned: true,
    });
    expect(catalog.productTruthAxes).toEqual([
      "deployment",
      "trading",
      "platform_fee_evidence",
      "source_verification",
      "indexing",
      "featured",
    ]);
  });

  it("makes funding, liquidity and automatic admission actionable", () => {
    expect(catalog.funding.eip3009).toMatchObject({
      fundingIntentDomain:
        "programmable.direct-native-hook-graph.funding-intent.v1",
      fundingNonceDomain:
        "programmable.direct-native-hook-graph.funding-nonce.v1",
      nonceFormula:
        "keccak256(abi.encode(keccak256(bytes(fundingNonceDomain)), fundingIntentHash))",
      fundingSignaturePatch: {
        schemaVersion: "programmable.eip3009-authorization-patch.v2",
        authorizationEncoding: "eip3009-nonce-r-s-v-abi-leaves",
        staticNestedTupleOrFixedArraySupported: true,
        dynamicParentSupported: false,
        applicantOffsetsAccepted: false,
        createRequestContainsSignature: false,
      },
    });
    expect(
      catalog.funding.eip3009.fundingSignaturePatch.requiredAuthorizationLeaves
        .map(({ solidityType }: { solidityType: string }) => solidityType),
    ).toEqual(["bytes32", "bytes32", "bytes32", "uint8"]);
    expect(
      catalog.funding.eip3009.fundingSignaturePatch.configInputFields,
    ).toEqual([
      "targetId",
      "nonceArgumentPath",
      "rArgumentPath",
      "sArgumentPath",
      "vArgumentPath",
    ]);
    expect(openApi["x-programmable-funding-boundary"]).toMatchObject({
      authorizationPatchSchemaVersion:
        "programmable.eip3009-authorization-patch.v2",
      authorizationPatchEncoding: "eip3009-nonce-r-s-v-abi-leaves",
      legacySignaturePatchSchemaVersion:
        "programmable.eip3009-signature-patch.v1",
      signatureIncludedInCreateRequest: false,
    });
    expect(openApi.info.version).toBe("3.3.5");
    const v2Patch =
      openApi.components.schemas.FundingAuthorizationPatchDescriptorV2;
    expect(v2Patch.required).toEqual([
      "schemaVersion",
      "targetId",
      "unsignedInitializerCalldataSha256",
      "initializerCalldataLengthBytes",
      "authorizationEncoding",
      "nonceArgumentPath",
      "rArgumentPath",
      "sArgumentPath",
      "vArgumentPath",
    ]);
    expect(v2Patch.properties.authorizationEncoding.const).toBe(
      "eip3009-nonce-r-s-v-abi-leaves",
    );
    expect(openApi.components.schemas.AbiArgumentPathV2).toMatchObject({
      minItems: 1,
      maxItems: 16,
      items: { type: "integer", minimum: 0, maximum: 255 },
    });
    expect(openApi.components.schemas.FundingAuthorizationPatchDescriptor.oneOf)
      .toEqual([
        { $ref: "#/components/schemas/FundingAuthorizationPatchDescriptorV2" },
        { $ref: "#/components/schemas/FundingSignaturePatchDescriptorV1" },
      ]);
    expect(JSON.stringify(openApi)).not.toContain(
      "Additional platform review is required",
    );
    expect(JSON.stringify(openApi)).not.toContain(
      "requires additional platform review",
    );

    expect(catalog.liquidity).toMatchObject({
      poolInitializationAddsLiquidity: false,
      tradingVolumeCreatesInitialLiquidity: false,
      classicLiquidityIsInjectedAutomatically: false,
    });
    expect(catalog.liquidity.models.map(({ id }: { id: string }) => id))
      .toEqual([
        "external-concentrated-liquidity",
        "launch-seeded-concentrated-liquidity",
        "hook-inventory-custom-accounting",
      ]);
    expect(catalog.automaticAdmission).toMatchObject({
      manualAllowlist: false,
      manualProjectApproval: false,
      currentProfileVersion: "3.2.0",
      legacyExactProfileVersions: ["3.1.0", "3.0.0"],
      routerSimulationBeforeAuthorization: true,
      blockingStatus: "action_required",
      warningDisposition: "continue-to-router-simulation",
    });
    expect(catalog.automaticAdmission.routerSimulationRole).toContain(
      "not a safety",
    );
    expect(catalog.automaticAdmission.hardBlockFindingRules).toEqual([
      { code: "RUNTIME_CALLCODE", targetRoles: ["any"] },
      { code: "RUNTIME_SELFDESTRUCT", targetRoles: ["any"] },
      { code: "SOURCE_SELFDESTRUCT_SURFACE", targetRoles: ["any"] },
      { code: "V4_CALLBACK_AUTHENTICATION_MISSING", targetRoles: ["hook"] },
      { code: "V4_CALLBACK_AUTHENTICATION_INVALID", targetRoles: ["hook"] },
      { code: "V4_CALLBACK_POOL_MANAGER_MISMATCH", targetRoles: ["hook"] },
      { code: "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING", targetRoles: ["hook"] },
    ]);
    expect(catalog.automaticAdmission.needsEvidenceFindingCodes)
      .toEqual(expect.arrayContaining([
        "RUNTIME_DELEGATECALL",
        "SOURCE_PROXY_OR_UPGRADE_SURFACE",
        "SOURCE_PUBLIC_MINT_SURFACE",
        "SOURCE_MUTABLE_TAX_OR_FEE_SURFACE",
        "SOURCE_MUTABLE_PAUSE_SURFACE",
        "SOURCE_LIQUIDITY_LOCK_OR_CUSTODY_SURFACE",
      ]));
  });

  it("publishes stable remediation IDs for every cold-agent boundary", () => {
    const entries = new Map(catalog.remediations.map(
      (entry: { remediationId: string }) => [entry.remediationId, entry],
    ));
    for (const id of [
      "PACK_CONFIG_V3_MISSING",
      "PACK_CONFIG_V3_INVALID",
      "SOURCE_REVISION_NOT_EXACT",
      "FUNDING_SIGNATURE_PATCH_NOT_TOP_LEVEL",
      "FUNDING_AUTHORIZATION_PATCH_PATH_INVALID",
      "LIQUIDITY_MODEL_NOT_EXACT",
      "HOOK_PERMISSION_OR_CALLBACK_MISMATCH",
      "PROFILE_INVALID",
      "PLATFORM_ADMISSION_FINDING",
      "ROUTER_SIMULATION_REVERTED",
      "ROUTER_SIMULATION_UNAVAILABLE",
      "FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED",
      "FUNDING_NONCE_CONFORMANCE_UNPROVEN",
    ]) {
      expect(entries.has(id), id).toBe(true);
    }
    expect(entries.get("FUNDING_NONCE_DERIVATION_CONFLICT_SUSPECTED"))
      .toMatchObject({ severity: "warning" });
    expect(entries.get("FUNDING_NONCE_CONFORMANCE_UNPROVEN"))
      .toMatchObject({ severity: "warning" });
    expect(catalog.runtimeRemediationPayload).toMatchObject({
      schemaVersion: "programmable.custom-launch-remediation.v1",
      additiveToExistingErrorOrFindingCode: true,
      catalogUrl,
      guideUrl,
      actionRequiredSemantics: {
        retryable: false,
        requiresNewRequest: true,
      },
    });
    expect(catalog.runtimeRemediationPayload.fields).toContain("code");
  });

  it("publishes the same public contract on every agent-facing surface", () => {
    for (const source of [websiteGuide, gitBookGuide, rawGuide]) {
      expect(source).toMatch(/existing-project-integration|Existing-project integration/);
      expect(source).toContain("custom-launch-agent-remediation-v1.json");
      expect(source).toContain("action_required");
      expect(source).toMatch(/no project allowlist|no project-specific allowlist/i);
      expect(source).toContain("FUNDING_NONCE_CONFORMANCE_UNPROVEN");
    }
    expect(PROGRAMMABLE_AGENT_SETUP_LINKS_V1).toMatchObject({
      discovery: discoveryUrl,
      remediation: catalogUrl,
      packConfigSchema: packConfigSchemaUrl,
      guide: guideUrl,
    });
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(discoveryUrl);
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(catalogUrl);
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).toContain(
      "$PROGRAMMABLE_API_KEY",
    );
    expect(PROGRAMMABLE_AGENT_SETUP_TEXT_V1).not.toContain("pm_live_");
  });
});
