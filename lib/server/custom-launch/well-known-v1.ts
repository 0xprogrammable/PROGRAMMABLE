import "server-only";

import { resolveCustomRegistryPublicManifestV1 } from
  "./registry-manifest-v1";
import type { CustomRegistryPublicManifestV1 } from
  "../../custom-launch/registry-public-manifest-v1";

export const PROGRAMMABLE_WELL_KNOWN_PATH =
  "/.well-known/programmable.json";

type Environment = Readonly<Record<string, string | undefined>>;

export function programmableWellKnownDocumentV1(
  manifest: CustomRegistryPublicManifestV1,
) {
  return Object.freeze({
    schemaVersion: "2.0.0" as const,
    platformId: "programmable" as const,
    name: "Programmable Developer Platform",
    description:
      "Canonical discovery for Programmable Classic and Custom launches. Public V3 general-hook creation and wallet-owned lifecycle reads are live on Ethereum Mainnet.",
    apiVersion: "2" as const,
    apiBaseUrl: "https://developers.programmable.family/api/v2",
    statusUrl: "https://developers.programmable.family/api/v2/status",
    manifestUrl: "https://developers.programmable.family/api/v2/manifest",
    launchesUrl: "https://developers.programmable.family/api/v2/launches",
    tokenListUrl: "https://developers.programmable.family/api/v2/token-list",
    routerCustomIdentitySnapshotUrl:
      "https://programmable.market/api/indexers/v1/router-custom-identities",
    openApiUrl:
      "https://developers.programmable.family/openapi/programmable-v2.yaml",
    schemasBaseUrl: "https://developers.programmable.family/schemas/v2/",
    documentationUrl: "https://developers.programmable.family/",
    sourceUrl: "https://github.com/0xprogrammable/developers",
    customLaunchApi: Object.freeze({
      status: "live" as const,
      readStatus: "live" as const,
      apiVersion: "3" as const,
      apiBaseUrl: "https://api.programmable.market",
      readyzUrl: "https://api.programmable.market/readyz",
      capabilitiesUrl: "https://api.programmable.market/v3/capabilities",
      preflightUrl:
        "https://api.programmable.market/v3/custom-launches/preflight",
      finalizedMetadataUrl:
        "https://api.programmable.market/v3/finalized-custom-launches",
      openApiUrl: "https://programmable.market/openapi/custom-launch-v3.json",
      apiKeysUrl: "https://programmable.market/developers/api-keys",
      guideUrl: "https://programmable.market/docs/developers/custom-launch",
      agentIntegration: Object.freeze({
        status: "live" as const,
        schemaVersion:
          "programmable.custom-launch-agent-remediation-catalog.v1" as const,
        startUrl:
          "https://programmable.market/.well-known/programmable.json",
        remediationCatalogUrl:
          "https://programmable.market/policies/custom-launch-agent-remediation-v1.json",
        packConfigSchemaUrl:
          "https://programmable.market/schemas/custom-launch/v3/pack-config.json",
        existingProjectGuideUrl:
          "https://programmable.market/docs/developers/custom-launch#existing-project-integration",
        openApiUrl:
          "https://programmable.market/openapi/custom-launch-v3.json",
        capabilitiesUrl:
          "https://api.programmable.market/v3/capabilities",
        preflightUrl:
          "https://api.programmable.market/v3/custom-launches/preflight",
        finalizedMetadataUrl:
          "https://api.programmable.market/v3/finalized-custom-launches",
        apiKeyEnvironmentVariable: "PROGRAMMABLE_API_KEY" as const,
        apiKeyPlaceholder: "$PROGRAMMABLE_API_KEY" as const,
        apiKeyContainsPolicy: false as const,
        manualProjectAllowlist: false as const,
        automaticAdmission: true as const,
        automaticRouterSimulation: true as const,
        fundingAuthorizationPatch: Object.freeze({
          schemaVersion:
            "programmable.eip3009-authorization-patch.v2" as const,
          configKey: "fundingSignaturePatch" as const,
          authorizationEncoding:
            "eip3009-nonce-r-s-v-abi-leaves" as const,
        }),
        walletSigning: "separate-controller-action" as const,
        requiredCommandOrder: Object.freeze([
          "pack",
          "validate --remote",
          "submit",
          "status",
        ] as const),
        quickstart: Object.freeze([
          "pack",
          "validate --remote",
          "submit",
          "wallet",
          "status",
        ] as const),
        remotePreflight: Object.freeze({
          quotaConsumed: false as const,
          nonceAllocated: false as const,
          persisted: false as const,
          walletSignatureRequiredLater: true as const,
          walletBroadcastByService: false as const,
        }),
      }),
      cli: Object.freeze({
        packageName: "@programmable/launch",
        binary: "programmable-launch",
        releaseVersion: "3.3.3",
        releaseUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/tag/programmable-launch-v3.3.3",
        tarballUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.3/programmable-launch-3.3.3.tgz",
        checksumUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.3/programmable-launch-3.3.3.tgz.sha256",
        tarballSha256:
          "sha256:14968f99a05bedc4424cee143006a3ae5d27db4fafdb06ae93faec3611116209",
      }),
      compatibility: Object.freeze({
        v1: Object.freeze({
          openApiUrl:
            "https://programmable.market/openapi/custom-launch-v1.json",
          cliReleaseVersion: "1.0.1" as const,
          cliTarballUrl:
            "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz",
        }),
        v2: Object.freeze({
          openApiUrl:
            "https://programmable.market/openapi/custom-launch-v2.json",
        }),
      }),
      publicRelease: Object.freeze({
        status: "live" as const,
        apiVersion: "3" as const,
        guideUrl: "https://programmable.market/docs/developers/custom-launch",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v3.json",
        authentication: "wallet-bound-api-key" as const,
        walletBoundary: "separate-wallet-signature" as const,
        cli: Object.freeze({
          packageName: "@programmable/launch",
          binary: "programmable-launch",
          releaseVersion: "3.3.3",
          releaseUrl:
            "https://github.com/0xprogrammable/PROGRAMMABLE/releases/tag/programmable-launch-v3.3.3",
          tarballUrl:
            "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.3/programmable-launch-3.3.3.tgz",
          checksumUrl:
            "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.3/programmable-launch-3.3.3.tgz.sha256",
          tarballSha256:
            "sha256:14968f99a05bedc4424cee143006a3ae5d27db4fafdb06ae93faec3611116209",
        }),
      }),
      generalHookProfile: Object.freeze({
        status: "live" as const,
        apiVersion: "3" as const,
        profileId: "programmable.direct-native-hook-graph.v1" as const,
        profileRevision: 3 as const,
        profileVersion: "3.2.0" as const,
        compatibleProfileVersions: Object.freeze([
          "3.1.0",
          "3.0.0",
        ] as const),
        legacyProfileSemantics:
          "readable-and-byte-identical-retryable-only" as const,
        productionLaunchAuthorized: true as const,
        createPath: "/v3/custom-launches" as const,
        capabilitiesPath: "/v3/capabilities" as const,
        preflightPath: "/v3/custom-launches/preflight" as const,
        finalizedMetadataPath: "/v3/finalized-custom-launches" as const,
        openApiUrl:
          "https://programmable.market/openapi/custom-launch-v3.json",
        cliReleaseVersion: "3.3.3" as const,
        projectMetadata: Object.freeze({
          schemaVersion: "programmable.project-metadata.v1" as const,
          inputSchemaVersion:
            "programmable.project-metadata-input.v1" as const,
          requiredForProfileVersion: "3.2.0" as const,
          legacyWithoutMetadataProfileVersions: Object.freeze([
            "2.0.0",
            "3.0.0",
            "3.1.0",
          ] as const),
          requiredFields: Object.freeze([
            "token.name",
            "token.symbol",
            "presentation.description",
            "presentation.image",
            "presentation.links",
          ] as const),
          imageMayBeNull: true as const,
          maximumLinks: 32 as const,
          linkKinds: Object.freeze([
            "website",
            "documentation",
            "x",
            "telegram",
            "discord",
            "github",
            "other",
          ] as const),
          projectMetadataHashDomain:
            "programmable.project-metadata.v1" as const,
          graphBundleHashBindingDomain:
            "programmable.custom-graph-project-metadata.v1" as const,
          postDeploymentTokenReadbackRequired: true as const,
        }),
        admissionPolicy: Object.freeze({
          manualProjectAllowlist: false as const,
          hardBlockFindingRules: Object.freeze([
            Object.freeze({ code: "RUNTIME_CALLCODE" as const, targetRoles: Object.freeze(["any"] as const) }),
            Object.freeze({ code: "RUNTIME_SELFDESTRUCT" as const, targetRoles: Object.freeze(["any"] as const) }),
            Object.freeze({ code: "SOURCE_SELFDESTRUCT_SURFACE" as const, targetRoles: Object.freeze(["any"] as const) }),
            Object.freeze({ code: "V4_CALLBACK_AUTHENTICATION_MISSING" as const, targetRoles: Object.freeze(["hook"] as const) }),
            Object.freeze({ code: "V4_CALLBACK_AUTHENTICATION_INVALID" as const, targetRoles: Object.freeze(["hook"] as const) }),
            Object.freeze({ code: "V4_CALLBACK_POOL_MANAGER_MISMATCH" as const, targetRoles: Object.freeze(["hook"] as const) }),
            Object.freeze({ code: "V4_ENABLED_CALLBACK_IMPLEMENTATION_MISSING" as const, targetRoles: Object.freeze(["hook"] as const) }),
          ] as const),
          needsEvidenceFindingCodes: Object.freeze([
            "RUNTIME_CREATE",
            "RUNTIME_CREATE2",
            "SOURCE_TARGET_ANALYSIS_INCOMPLETE",
            "V4_CALLBACK_AUTHENTICATION_REVIEW_REQUIRED",
            "RUNTIME_DELEGATECALL",
            "SOURCE_PROXY_OR_UPGRADE_SURFACE",
            "SOURCE_MUTABLE_PAUSE_SURFACE",
            "SOURCE_MUTABLE_BLOCKLIST_SURFACE",
            "SOURCE_MUTABLE_TAX_OR_FEE_SURFACE",
            "SOURCE_MUTABLE_TRANSFER_RESTRICTION",
            "SOURCE_MUTABLE_ADMIN_SURFACE",
            "SOURCE_PUBLIC_MINT_SURFACE",
            "SOURCE_EXTERNAL_DEPENDENCY_SURFACE",
            "SOURCE_TRANSFER_FEE_SURFACE",
            "SOURCE_LIQUIDITY_LOCK_OR_CUSTODY_SURFACE",
          ] as const),
          returnDeltaRequiresBehaviorEvidence: true as const,
        }),
      }),
      integrationPreview: Object.freeze({
        status: "live" as const,
        apiVersion: "3" as const,
        publicAuthorization: true as const,
        createPath: "/v3/custom-launches" as const,
        capabilitiesPath: "/v3/capabilities" as const,
        preflightPath: "/v3/custom-launches/preflight" as const,
        finalizedMetadataPath: "/v3/finalized-custom-launches" as const,
        openApiUrl:
          "https://programmable.market/openapi/custom-launch-v3.json",
        profileId: "programmable.direct-native-hook-graph.v1" as const,
        profileRevision: 3 as const,
        profileVersion: "3.2.0" as const,
        compatibleProfileVersions: Object.freeze([
          "3.1.0",
          "3.0.0",
        ] as const),
        requestSchemaVersion:
          "programmable.custom-launch-create-request.v3" as const,
        minimumTargets: 3 as const,
        maximumTargets: 16 as const,
        projectOwnedToken: true as const,
        projectOwnedHook: true as const,
        hookPermissionMaskRange: Object.freeze({
          minimum: 0 as const,
          maximum: 16_383 as const,
        }),
        allFourteenHookPermissionsStructurallySupported: true as const,
        manualProjectAllowlist: false as const,
        advancedSurfacesRequireEvidence: Object.freeze([
          "proxy-or-delegatecall",
          "mint-tax-pause-or-transfer-controls",
          "liquidity-custody-or-locking",
          "return-delta-custom-accounting",
        ] as const),
        quoteCurrencies: Object.freeze([
          "native",
          "erc20",
        ] as const),
        liquidityModels: Object.freeze([
          "external-concentrated-liquidity",
          "launch-seeded-concentrated-liquidity",
          "hook-inventory-custom-accounting",
        ] as const),
        productTruthAxes: Object.freeze([
          "deployment",
          "trading",
          "platform_fee_evidence",
          "source_verification",
          "indexing",
          "featured",
        ] as const),
        platformAdmissionReceiptRequired: true as const,
        routerSimulationRequiredBeforeAuthorization: true as const,
        safetyClaim: false as const,
        feeBehaviorClaim: false as const,
        fundingAuthorization: Object.freeze({
          modes: Object.freeze([
            "none",
            "wallet-transaction-value",
            "eip-3009-receive-with-authorization",
          ] as const),
          createRequestSignatureIncluded: false as const,
          fundingIntentStage: "pre-signature" as const,
        }),
        activationBlockers: Object.freeze([] as const),
        errorCode: null,
      }),
      releaseCandidate: Object.freeze({
        status: "promoted-to-public" as const,
        publicAuthorization: true as const,
        packageName: "@programmable/launch",
        binary: "programmable-launch",
        releaseVersion: "3.3.3",
        releaseTag: "programmable-launch-v3.3.3",
        releaseUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/tag/programmable-launch-v3.3.3",
        tarballUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.3/programmable-launch-3.3.3.tgz",
        checksumUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v3.3.3/programmable-launch-3.3.3.tgz.sha256",
        tarballSha256:
          "sha256:14968f99a05bedc4424cee143006a3ae5d27db4fafdb06ae93faec3611116209",
        openApiUrl:
          "https://programmable.market/openapi/custom-launch-v3.json",
        feePolicy: Object.freeze({
          profileId: "programmable.direct-native-hook-graph.v1",
          profileRevision: 3 as const,
          productionLaunchAuthorized: true as const,
          chainId: "1" as const,
          network: "Ethereum Mainnet" as const,
          chargeTrigger: "successful-swap" as const,
          basis: "per-launch-declared-conformance-basis" as const,
          accountingModes: Object.freeze([
            "additive-platform-share",
            "inclusive-selected-total",
          ] as const),
          ratePpm: 1_000 as const,
          denominatorPpm: 1_000_000 as const,
          ratePercent: "0.10%" as const,
          rateBps: 10 as const,
          recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
          enforcement: "role-aware-static-admission-plus-router-simulation" as const,
          admissionAssurance: "launch-admission-only" as const,
          safetyClaim: false as const,
          feeBehaviorClaim: false as const,
          lpFee: "separate-from-platform-fee" as const,
          genericFeeClaiming: "not-live" as const,
          genericBuybackManagement: "not-live" as const,
        }),
      }),
      authentication: "wallet-bound-api-key" as const,
      walletAuthority: "separate-review-and-sign" as const,
      versions: Object.freeze({
        v1: Object.freeze({
          openApiUrl:
            "https://programmable.market/openapi/custom-launch-v1.json",
          reads: "live" as const,
          create: "read-only" as const,
          createHttpStatus: 409 as const,
          createErrorCode: "CUSTOM_LAUNCH_V1_READ_ONLY" as const,
          retryable: false as const,
        }),
        v2: Object.freeze({
          openApiUrl:
            "https://programmable.market/openapi/custom-launch-v2.json",
          status: "live" as const,
          createHttpStatus: 202 as const,
          replayHttpStatus: 200 as const,
          retryAfter: "honor-on-429-or-503" as const,
        }),
        v3: Object.freeze({
          openApiUrl:
            "https://programmable.market/openapi/custom-launch-v3.json",
          status: "live" as const,
          publicAuthorization: true as const,
          createHttpStatus: 202 as const,
          replayHttpStatus: 200 as const,
          capabilitiesPath: "/v3/capabilities" as const,
          preflightPath: "/v3/custom-launches/preflight" as const,
          finalizedMetadataPath: "/v3/finalized-custom-launches" as const,
          preflightQuotaConsumed: false as const,
          preflightNonceAllocated: false as const,
          preflightPersisted: false as const,
          retryAfter: "honor-on-429-or-503" as const,
        }),
      }),
      legacyIntake: Object.freeze({
        registry: "closed" as const,
        github: "closed" as const,
      }),
    }),
    chains: Object.freeze([Object.freeze({
      chainId: 1,
      caip2: "eip155:1" as const,
      name: "Ethereum Mainnet",
      explorerUrl: "https://etherscan.io",
      status: "live" as const,
    })]),
    publicCategories: Object.freeze({
      classic: Object.freeze({ discoveryStatus: "live" as const }),
      custom: Object.freeze({
        discoveryStatus: "live" as const,
        publicSubmissionStatus: "closed" as const,
        publicSubmissionStatusScope: "legacy-registry-intake" as const,
        publicApiCreateStatus: "live" as const,
        customLaunchApiStatus: "live" as const,
        registryDiscoveryStatus: manifest.status === "live"
          ? "live" as const
          : "legacy-closed" as const,
        legacyRegistrySubmissionStatus: "closed" as const,
        legacyGithubSubmissionStatus: "closed" as const,
        registryAddress: manifest.contracts.registry.address?.toLowerCase() ?? null,
        registryStartBlock: manifest.startBlock,
        registryGeneration: manifest.status === "live"
          ? "1"
          : null,
        note: manifest.status === "live"
          ? "Public V3 general-hook launch creation and lifecycle reads are live on Ethereum Mainnet. Earlier history remains readable and V1 creation is read-only. Finalized Router and approved Custom Registry identities remain discoverable. Legacy Registry and GitHub submission intake is closed."
          : "Public V3 general-hook launch creation and lifecycle reads are live on Ethereum Mainnet. Earlier history remains readable and V1 creation is read-only. Finalized Router identities remain discoverable. The legacy Registry has no live deployment, and Registry or GitHub submission intake is closed.",
      }),
    }),
    compatibility: Object.freeze({
      majorVersion: 2,
      additiveChangesOnly: true,
      unknownFields: "ignore" as const,
      unknownCapabilities: "preserve" as const,
      unknownMarketKinds: "display-as-unsupported" as const,
      deploymentAddresses: "resolve-from-manifest" as const,
    }),
    extensions: Object.freeze({
      "programmable.legacy-v1": Object.freeze({
        status: "supported" as const,
        apiBaseUrl: "https://developers.programmable.family/api/v1",
        migrationGuideUrl:
          "https://github.com/0xprogrammable/developers/blob/main/docs/migrations/v1-to-v2.md",
      }),
    }),
  });
}

const RESPONSE_HEADERS = Object.freeze({
  "access-control-allow-origin": "*",
  "cache-control": "public, max-age=60, stale-while-revalidate=300",
  "content-type": "application/json; charset=utf-8",
});

export function createProgrammableWellKnownHandlerV1(
  environment: Environment,
) {
  return function handleProgrammableWellKnownV1(request: Request): Response {
    const url = new URL(request.url);
    if (url.search !== "") {
      return Response.json(
        { error: "Unsupported query parameters" },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    return new Response(JSON.stringify(programmableWellKnownDocumentV1(
      resolveCustomRegistryPublicManifestV1(environment),
    )), { status: 200, headers: RESPONSE_HEADERS });
  };
}

export function handleProductionProgrammableWellKnownV1(
  request: Request,
): Response {
  return createProgrammableWellKnownHandlerV1(process.env)(request);
}
