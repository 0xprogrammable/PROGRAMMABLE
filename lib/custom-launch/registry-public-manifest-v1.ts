export const CUSTOM_REGISTRY_PUBLIC_MANIFEST_PATH =
  "/api/custom-launch/registry/v1/manifest";

export const CUSTOM_REGISTRY_PUBLIC_READINESS_PATH =
  "/api/custom-launch/registry/v1/readiness";

export const CUSTOM_REGISTRY_CONTRACT_KEYS = [
  "registry",
  "partnerFactoryRegistry",
  "feePolicyVerifier",
  "atomicRegistrar",
] as const;

export type CustomRegistryContractKeyV1 =
  (typeof CUSTOM_REGISTRY_CONTRACT_KEYS)[number];

export type CustomRegistryContractBindingV1 = Readonly<{
  address: `0x${string}` | null;
  runtimeCodeKeccak256: `0x${string}` | null;
}>;

export type CustomRegistrySpecificationBindingV1 = Readonly<{
  identifier: string | null;
  url: string | null;
}>;

export type CustomRegistryPublicManifestV1 = Readonly<{
  schemaVersion: "programmable.custom-registry-public-manifest.v1";
  status: "prelaunch" | "live";
  chainId: "1";
  caip2: "eip155:1";
  publicSubmissionsEnabled: boolean;
  generation: string | null;
  startBlock: string | null;
  contracts: Readonly<Record<
    CustomRegistryContractKeyV1,
    CustomRegistryContractBindingV1
  >>;
  specifications: Readonly<{
    abi: CustomRegistrySpecificationBindingV1;
    eventSet: CustomRegistrySpecificationBindingV1;
    hashSpec: CustomRegistrySpecificationBindingV1;
  }>;
}>;

const NULL_CONTRACT_BINDING: CustomRegistryContractBindingV1 = Object.freeze({
  address: null,
  runtimeCodeKeccak256: null,
});

const NULL_SPECIFICATION_BINDING: CustomRegistrySpecificationBindingV1 =
  Object.freeze({ identifier: null, url: null });

export const PRELAUNCH_CUSTOM_REGISTRY_PUBLIC_MANIFEST_V1:
CustomRegistryPublicManifestV1 = Object.freeze({
  schemaVersion: "programmable.custom-registry-public-manifest.v1",
  status: "prelaunch",
  chainId: "1",
  caip2: "eip155:1",
  publicSubmissionsEnabled: false,
  generation: null,
  startBlock: null,
  contracts: Object.freeze({
    registry: NULL_CONTRACT_BINDING,
    partnerFactoryRegistry: NULL_CONTRACT_BINDING,
    feePolicyVerifier: NULL_CONTRACT_BINDING,
    atomicRegistrar: NULL_CONTRACT_BINDING,
  }),
  specifications: Object.freeze({
    abi: NULL_SPECIFICATION_BINDING,
    eventSet: NULL_SPECIFICATION_BINDING,
    hashSpec: NULL_SPECIFICATION_BINDING,
  }),
});
