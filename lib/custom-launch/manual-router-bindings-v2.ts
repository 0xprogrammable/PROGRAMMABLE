import {
  encodeAbiParameters,
  getAddress,
  isAddress,
  keccak256,
  toBytes,
} from "viem";

export const MANUAL_ROUTER_NESTED_FACTORY_PROFILE_TYPE_V2 =
  "ProgrammableNestedFactoryProfileV1(bytes32 profileIdHash,bytes32 profileVersionHash)" as const;

export const MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2 = Object.freeze({
  routeId: "nested-factory",
  routeVersion: "1.0.0",
  profileId: "exact-shards-nested-factory",
  profileVersion: "1.0.0",
  primaryEvidenceKind: "shards-nested-factory",
} as const);

type EvmAddress = `0x${string}`;
type EvmBytes32 = `0x${string}`;
type EvmSelector = `0x${string}`;
type Sha256Commitment = `sha256:${string}`;

// Intentionally null while the final Shards post-factory execution invariant
// is under audit. Activation must stay impossible until one frozen release
// replaces this placeholder together with every dependent hash.
const FROZEN_SHARDS_APPLICANT_SELECTOR_V2: EvmSelector | null = null;

export type ManualRouterProductionBindingV2 = Readonly<{
  active: boolean;
  activationAllowed: boolean;
  chainId: "0x1" | null;
  acceptanceClaimSha256: `sha256:${string}` | null;
  acceptanceSubjectSha256: `sha256:${string}`;
  canonicalArtifact: Readonly<{
    path: "outputs/shards-nested-factory-route-v1.canonical.json";
    byteLength: 1281987;
    sha256: Sha256Commitment;
    keccak256: EvmBytes32;
    integritySha256: Sha256Commitment;
    status:
      "frozen-contract-and-exact-shards-artifact-undeployed-acceptance-pending-no-permit-no-signature";
  }>;
  route: typeof MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2 & Readonly<{
    profileKey: EvmBytes32 | null;
  }>;
  router: Readonly<{
    address: EvmAddress | null;
    runtimeCodeHash: EvmBytes32 | null;
    directLaunchSelector: EvmSelector | null;
  }>;
  module: Readonly<{
    address: EvmAddress | null;
    runtimeCodeHash: EvmBytes32 | null;
  }>;
  exactPlan: Readonly<{
    launchWallet: EvmAddress | null;
    routePayloadHash: EvmBytes32 | null;
    expectedResultHash: EvmBytes32 | null;
    launchId: EvmBytes32 | null;
    stampRequestHash: EvmBytes32 | null;
    poolId: EvmBytes32 | null;
    configurationHash: EvmBytes32 | null;
    revenuePolicyHash: EvmBytes32 | null;
    reviewedPlanSha256: Sha256Commitment | null;
    routerIdentity: Sha256Commitment | null;
    factoryIdentity: Sha256Commitment | null;
    revenueAttestationSha256: Sha256Commitment | null;
    revenueVerifierArtifactSha256: Sha256Commitment | null;
    predeploymentEvidenceSha256: Sha256Commitment | null;
    gasCapReceiptSha256: Sha256Commitment | null;
  }>;
  schemaHashes: Readonly<{
    completeSignedArtifact: Sha256Commitment | null;
    browserWalletAction: Sha256Commitment | null;
    primaryEvidence: Sha256Commitment | null;
  }>;
  authorityVendor: Readonly<{
    adapterCommit: string | null;
    adapterTree: string | null;
    bundleSha256: string | null;
    manifestSha256: string | null;
    goldenSha256: string | null;
  }>;
  eventTopics: Readonly<{
    launchStamped: EvmBytes32 | null;
    routeStamped: EvmBytes32 | null;
    componentStamped: EvmBytes32 | null;
    nestedFactoryEvidence: EvmBytes32 | null;
  }>;
}>;

/**
 * This binding is intentionally inert. Contract, module, runtime, schema and
 * event identities must be copied only from one frozen, independently audited
 * release candidate. A route name alone can never activate browser execution.
 */
export const MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2:
ManualRouterProductionBindingV2 =
  Object.freeze({
    active: false,
    activationAllowed: false,
    chainId: "0x1",
    acceptanceClaimSha256: null,
    acceptanceSubjectSha256:
      "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8",
    canonicalArtifact: Object.freeze({
      path: "outputs/shards-nested-factory-route-v1.canonical.json",
      byteLength: 1281987,
      sha256:
        "sha256:7385a806d831e7b89e598dca16de1c6107590659375d43d97d4d6ab30292f6d0",
      keccak256:
        "0xe058d7fc4fb69c6a0860506caca5a32f0fc6845499fbb9b2dadbc0c4cd4cf21a",
      integritySha256:
        "sha256:de0d683e7eaeae6a1bb0e08a6c0a02318a7e22fb534f1f2d7df60284b6694e91",
      status:
        "frozen-contract-and-exact-shards-artifact-undeployed-acceptance-pending-no-permit-no-signature",
    }),
    route: Object.freeze({
      ...MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2,
      profileKey:
        "0xb90e215e0e29c0dacf021e5e778847af4100433ee7d22014b73f8ca4add09d0c",
    }),
    router: Object.freeze({
      address: null,
      runtimeCodeHash: null,
      directLaunchSelector: null,
    }),
    module: Object.freeze({
      address: null,
      runtimeCodeHash: null,
    }),
    exactPlan: Object.freeze({
      launchWallet: null,
      routePayloadHash:
        "0x75403c2f52dbdf623cfcd077fab52308b3e1e0623016ec73539fac5234f21356",
      expectedResultHash:
        "0x29de1a5462fe7b07a0d58894f7ec5e2eb4e870c83153e2109647c7f4094c828b",
      launchId:
        "0xd225b22ea82ef2425660da409849a55c1c44751eedd9cd1b581a48358a0905eb",
      stampRequestHash:
        "0x276a295580bcb65ed286a2a02efba575eaee87c090f54c94e5ad8a2b78552bce",
      poolId:
        "0x075885e47ec15084de91826faafab9c2cd4fda4d24fd9e5ce3af6a4be4ad926d",
      configurationHash:
        "0xa98b7b95777267181a2b93a33632991e80a49f4a57d94150f8dfbd90421f34c1",
      revenuePolicyHash:
        "0xaa78b0bf63fca83fa9b969fbb6b2bb1ecabcbe49908a48f92403e8e51e4adab2",
      reviewedPlanSha256: null,
      routerIdentity: null,
      factoryIdentity: null,
      revenueAttestationSha256: null,
      revenueVerifierArtifactSha256: null,
      predeploymentEvidenceSha256: null,
      gasCapReceiptSha256: null,
    }),
    schemaHashes: Object.freeze({
      completeSignedArtifact: null,
      browserWalletAction: null,
      primaryEvidence: null,
    }),
    authorityVendor: Object.freeze({
      adapterCommit: "4ddfaac6a90ceaba6e9b4a8ce5bfb4b349a30f9e",
      adapterTree: "6ef200f382b1dc0697025955d57168d6a8bb9519",
      bundleSha256:
        "sha256:ff94874d02b597ba21b02c28391660118626287d39ffe26581cffc7c784e0e42",
      manifestSha256:
        "sha256:d6076c4dbba68f86505fd3b9bef6a3ea3a4df1d2f2c5beace7d435331c0d703e",
      goldenSha256:
        "sha256:a0d8cde64a0464825d4fab6582b69b6c4e4a837f976503e872d6b29d745d0836",
    }),
    eventTopics: Object.freeze({
      launchStamped: null,
      routeStamped: null,
      componentStamped: null,
      nestedFactoryEvidence: null,
    }),
  });

export type ActiveManualRouterProductionBindingV2 = Readonly<{
  active: true;
  activationAllowed: true;
  chainId: "0x1";
  acceptanceClaimSha256: `sha256:${string}`;
  acceptanceSubjectSha256: `sha256:${string}`;
  canonicalArtifact: ManualRouterProductionBindingV2["canonicalArtifact"];
  route: typeof MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2 & Readonly<{
    profileKey: EvmBytes32;
  }>;
  router: Readonly<{
    address: EvmAddress;
    runtimeCodeHash: EvmBytes32;
    directLaunchSelector: EvmSelector;
  }>;
  module: Readonly<{
    address: EvmAddress;
    runtimeCodeHash: EvmBytes32;
  }>;
  exactPlan: Readonly<{
    launchWallet: EvmAddress;
    routePayloadHash: EvmBytes32;
    expectedResultHash: EvmBytes32;
    launchId: EvmBytes32;
    stampRequestHash: EvmBytes32;
    poolId: EvmBytes32;
    configurationHash: EvmBytes32;
    revenuePolicyHash: EvmBytes32;
    reviewedPlanSha256: Sha256Commitment;
    routerIdentity: Sha256Commitment;
    factoryIdentity: Sha256Commitment;
    revenueAttestationSha256: Sha256Commitment;
    revenueVerifierArtifactSha256: Sha256Commitment;
    predeploymentEvidenceSha256: Sha256Commitment;
    gasCapReceiptSha256: Sha256Commitment;
  }>;
  schemaHashes: Readonly<{
    completeSignedArtifact: Sha256Commitment;
    browserWalletAction: Sha256Commitment;
    primaryEvidence: Sha256Commitment;
  }>;
  authorityVendor: Readonly<{
    adapterCommit: string;
    adapterTree: string;
    bundleSha256: string;
    manifestSha256: string;
    goldenSha256: string;
  }>;
  eventTopics: Readonly<{
    launchStamped: EvmBytes32;
    routeStamped: EvmBytes32;
    componentStamped: EvmBytes32;
    nestedFactoryEvidence: EvmBytes32;
  }>;
}>;

/** Compatibility name for code that treats V2 as the active Router binding. */
export const MANUAL_ROUTER_PRODUCTION_BINDING_V2 =
  MANUAL_ROUTER_NESTED_FACTORY_BINDING_V2;

export function deriveManualRouterNestedFactoryProfileKeyV2(
  profileId: string,
  profileVersion: string,
): EvmBytes32 {
  if (profileId.length === 0 || profileVersion.length === 0) {
    throw new TypeError("manual Router V2 profile identity is empty");
  }
  return keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [
      keccak256(toBytes(MANUAL_ROUTER_NESTED_FACTORY_PROFILE_TYPE_V2)),
      keccak256(toBytes(profileId)),
      keccak256(toBytes(profileVersion)),
    ],
  ));
}

export function getActiveManualRouterProductionBindingV2():
ActiveManualRouterProductionBindingV2 {
  const binding = MANUAL_ROUTER_PRODUCTION_BINDING_V2;
  const route = binding.route;
  const requiredHashes = [
    binding.router.runtimeCodeHash,
    binding.module.runtimeCodeHash,
    binding.eventTopics.launchStamped,
    binding.eventTopics.routeStamped,
    binding.eventTopics.componentStamped,
    binding.eventTopics.nestedFactoryEvidence,
  ];
  const vendor = binding.authorityVendor;
  const exactPlan = binding.exactPlan;
  if (
    binding.active !== true
    || binding.activationAllowed !== true
    || binding.chainId !== "0x1"
    || binding.acceptanceSubjectSha256
      !== "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8"
    || binding.canonicalArtifact.byteLength !== 1281987
    || binding.canonicalArtifact.sha256
      !== "sha256:7385a806d831e7b89e598dca16de1c6107590659375d43d97d4d6ab30292f6d0"
    || binding.canonicalArtifact.keccak256
      !== "0xe058d7fc4fb69c6a0860506caca5a32f0fc6845499fbb9b2dadbc0c4cd4cf21a"
    || !sha256(binding.acceptanceClaimSha256)
    || binding.router.address === null
    || FROZEN_SHARDS_APPLICANT_SELECTOR_V2 === null
    || binding.router.directLaunchSelector
      !== FROZEN_SHARDS_APPLICANT_SELECTOR_V2
    || binding.module.address === null
    || route.profileKey === null
    || route.routeId !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.routeId
    || route.routeVersion !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.routeVersion
    || route.profileId !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.profileId
    || route.profileVersion
      !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.profileVersion
    || route.primaryEvidenceKind
      !== MANUAL_ROUTER_SHARDS_ROUTE_IDENTITY_V2.primaryEvidenceKind
    || route.profileKey !== deriveManualRouterNestedFactoryProfileKeyV2(
      route.profileId,
      route.profileVersion,
    )
    || !validAddress(binding.router.address)
    || !validAddress(binding.module.address)
    || !validAddress(exactPlan.launchWallet)
    || requiredHashes.some((value) => !validBytes32(value))
    || !validBytes32(exactPlan.routePayloadHash)
    || !validBytes32(exactPlan.expectedResultHash)
    || !validBytes32(exactPlan.launchId)
    || !validBytes32(exactPlan.stampRequestHash)
    || !validBytes32(exactPlan.poolId)
    || !validBytes32(exactPlan.configurationHash)
    || !validBytes32(exactPlan.revenuePolicyHash)
    || !sha256(exactPlan.reviewedPlanSha256)
    || !sha256(exactPlan.routerIdentity)
    || !sha256(exactPlan.factoryIdentity)
    || !sha256(exactPlan.revenueAttestationSha256)
    || !sha256(exactPlan.revenueVerifierArtifactSha256)
    || !sha256(exactPlan.predeploymentEvidenceSha256)
    || !sha256(exactPlan.gasCapReceiptSha256)
    || !sha256(binding.schemaHashes.completeSignedArtifact)
    || !sha256(binding.schemaHashes.browserWalletAction)
    || !sha256(binding.schemaHashes.primaryEvidence)
    || !gitSha(vendor.adapterCommit)
    || !gitSha(vendor.adapterTree)
    || !sha256(vendor.bundleSha256)
    || !sha256(vendor.manifestSha256)
    || !sha256(vendor.goldenSha256)
  ) {
    throw new TypeError("manual Router V2 production binding is inactive");
  }
  return binding as ActiveManualRouterProductionBindingV2;
}

export function isManualRouterProductionBindingV2Active(): boolean {
  try {
    getActiveManualRouterProductionBindingV2();
    return true;
  } catch {
    return false;
  }
}

function validAddress(value: unknown): value is EvmAddress {
  return typeof value === "string"
    && isAddress(value, { strict: true })
    && BigInt(getAddress(value)) !== 0n;
}

function validBytes32(value: unknown): value is EvmBytes32 {
  return typeof value === "string"
    && /^0x[0-9a-f]{64}$/u.test(value)
    && BigInt(value) !== 0n;
}

function gitSha(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/u.test(value);
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}
