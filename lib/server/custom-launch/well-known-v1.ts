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
      "Canonical discovery for Programmable Classic and Custom launches. Public V2 launch creation and wallet-owned lifecycle reads are live on Ethereum Mainnet.",
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
      apiBaseUrl: "https://api.programmable.market",
      readyzUrl: "https://api.programmable.market/readyz",
      openApiUrl: "https://programmable.market/openapi/custom-launch-v1.json",
      apiKeysUrl: "https://programmable.market/developers/api-keys",
      guideUrl: "https://programmable.market/docs/developers/custom-launch",
      cli: Object.freeze({
        packageName: "@programmable/launch",
        binary: "programmable-launch",
        releaseVersion: "1.0.1",
        releaseUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/tag/programmable-launch-v1.0.1",
        tarballUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v1.0.1/programmable-launch-1.0.1.tgz",
      }),
      publicRelease: Object.freeze({
        status: "live" as const,
        apiVersion: "2" as const,
        guideUrl: "https://programmable.market/docs/developers/custom-launch",
        openApiUrl: "https://programmable.market/openapi/custom-launch-v2.json",
        authentication: "wallet-bound-api-key" as const,
        walletBoundary: "separate-wallet-signature" as const,
        cli: Object.freeze({
          packageName: "@programmable/launch",
          binary: "programmable-launch",
          releaseVersion: "2.0.0",
          releaseUrl:
            "https://github.com/0xprogrammable/PROGRAMMABLE/releases/tag/programmable-launch-v2.0.0",
          tarballUrl:
            "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.0/programmable-launch-2.0.0.tgz",
        }),
      }),
      releaseCandidate: Object.freeze({
        status: "promoted-to-public" as const,
        publicAuthorization: true as const,
        packageName: "@programmable/launch",
        binary: "programmable-launch",
        releaseVersion: "2.0.0",
        releaseTag: "programmable-launch-v2.0.0",
        releaseUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/tag/programmable-launch-v2.0.0",
        tarballUrl:
          "https://github.com/0xprogrammable/PROGRAMMABLE/releases/download/programmable-launch-v2.0.0/programmable-launch-2.0.0.tgz",
        openApiUrl:
          "https://programmable.market/openapi/custom-launch-v2.json",
        feePolicy: Object.freeze({
          profileId:
            "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
          profileRevision: 3 as const,
          launchProfileHash:
            "sha256:fd2d738117c4c69304efb49c75d402d2e8b8968832fd2e27548c3d9814c5c9ee",
          productionLaunchAuthorized: true as const,
          chainId: "1" as const,
          network: "Ethereum Mainnet" as const,
          chargeTrigger: "successful-swap" as const,
          basis: "gross-unspecified-pool-currency-amount" as const,
          assetMode: "unspecified-pool-currency-per-swap" as const,
          ratePpm: 1_000 as const,
          denominatorPpm: 1_000_000 as const,
          ratePercent: "0.10%" as const,
          rateBps: 10 as const,
          recipient: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
          enforcement: Object.freeze({
            frozenProfile: true as const,
            customModuleMayReduce: false as const,
            customModuleMayRedirect: false as const,
          }),
          lpFee: "separate-from-platform-fee" as const,
          genericFeeClaiming: "not-live" as const,
          genericBuybackManagement: "not-live" as const,
        }),
      }),
      authentication: "wallet-bound-api-key" as const,
      walletAuthority: "separate-review-and-sign" as const,
      versions: Object.freeze({
        v1: Object.freeze({
          reads: "live" as const,
          create: "read-only" as const,
          createHttpStatus: 409 as const,
          createErrorCode: "CUSTOM_LAUNCH_V1_READ_ONLY" as const,
          retryable: false as const,
        }),
        v2: Object.freeze({
          status: "live" as const,
          createHttpStatus: 202 as const,
          replayHttpStatus: 200 as const,
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
        customLaunchApiStatus: "live" as const,
        registryDiscoveryStatus: manifest.status,
        legacyRegistrySubmissionStatus: "closed" as const,
        legacyGithubSubmissionStatus: "closed" as const,
        registryAddress: manifest.contracts.registry.address?.toLowerCase() ?? null,
        registryStartBlock: manifest.startBlock,
        registryGeneration: manifest.status === "live"
          ? "1"
          : null,
        note: manifest.status === "live"
          ? "Public V2 launch creation and lifecycle reads are live on Ethereum Mainnet. V1 history reads remain live and V1 creation is read-only. Finalized Router and approved Custom Registry identities remain discoverable. Legacy Registry and GitHub submission intake is closed."
          : "Public V2 launch creation and lifecycle reads are live on Ethereum Mainnet. V1 history reads remain live and V1 creation is read-only. Finalized Router identities remain discoverable. The legacy Registry has no live deployment, and Registry or GitHub submission intake is closed.",
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
