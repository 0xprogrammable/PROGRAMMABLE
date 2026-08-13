export const CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH_V2 =
  "/api/custom-launch/registry/v2/manifest" as const;

export const CUSTOM_REGISTRY_PUBLIC_READINESS_PATH_V2 =
  "/api/custom-launch/registry/v2/readiness" as const;

export type CustomRegistryV2DeploymentEvidence = Readonly<{
  address: `0x${string}`;
  runtimeCodeKeccak256: `0x${string}`;
  deploymentTransactionHash: `0x${string}`;
  deploymentBlock: string;
  deploymentBlockHash: `0x${string}`;
}>;

export type CustomRegistryV2ReleaseEvidence = Readonly<{
  sourceCommit: string;
  sourceTree: string;
  sourceArtifactSha256: `sha256:${string}`;
  abiArtifactSha256: `sha256:${string}`;
  eventSetSha256: `sha256:${string}`;
}>;

export type CustomRegistryV2FinalityBinding = Readonly<{
  minimumConfirmations: string;
  policyBindingHash: `0x${string}`;
}>;

type CustomRegistryPublicManifestBaseV2 = Readonly<{
  schemaVersion: "programmable.custom-registry-public-manifest.v2";
  generation: "2";
  chainId: "1";
  caip2: "eip155:1";
}>;

export type CustomRegistryPrelaunchPublicManifestV2 =
  CustomRegistryPublicManifestBaseV2 & Readonly<{
    status: "prelaunch";
    publicReadEnabled: false;
    indexingEnabled: false;
    registry: Readonly<{
      address: null;
      runtimeCodeKeccak256: null;
      deploymentTransactionHash: null;
      deploymentBlock: null;
      deploymentBlockHash: null;
    }>;
    release: Readonly<{
      sourceCommit: null;
      sourceTree: null;
      sourceArtifactSha256: null;
      abiArtifactSha256: null;
      eventSetSha256: null;
    }>;
    finality: Readonly<{
      minimumConfirmations: null;
      policyBindingHash: null;
    }>;
  }>;

export type CustomRegistryLivePublicManifestV2 =
  CustomRegistryPublicManifestBaseV2 & Readonly<{
    status: "live";
    publicReadEnabled: true;
    indexingEnabled: true;
    registry: CustomRegistryV2DeploymentEvidence;
    release: CustomRegistryV2ReleaseEvidence;
    finality: CustomRegistryV2FinalityBinding;
  }>;

export type CustomRegistryPublicManifestV2 =
  | CustomRegistryPrelaunchPublicManifestV2
  | CustomRegistryLivePublicManifestV2;

export const PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V2:
CustomRegistryPublicManifestV2 = Object.freeze({
  schemaVersion: "programmable.custom-registry-public-manifest.v2",
  status: "prelaunch",
  generation: "2",
  chainId: "1",
  caip2: "eip155:1",
  publicReadEnabled: false,
  indexingEnabled: false,
  registry: Object.freeze({
    address: null,
    runtimeCodeKeccak256: null,
    deploymentTransactionHash: null,
    deploymentBlock: null,
    deploymentBlockHash: null,
  }),
  release: Object.freeze({
    sourceCommit: null,
    sourceTree: null,
    sourceArtifactSha256: null,
    abiArtifactSha256: null,
    eventSetSha256: null,
  }),
  finality: Object.freeze({
    minimumConfirmations: null,
    policyBindingHash: null,
  }),
});
