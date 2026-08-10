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
  acceptanceRelease: Readonly<{
    commit: string;
    tree: string;
    reviewedPlanSha256: Sha256Commitment;
    routerArtifactBindingSha256: Sha256Commitment;
    acceptanceRecordSha256: Sha256Commitment;
  }>;
  canonicalArtifact: Readonly<{
    path: "outputs/shards-nested-factory-route-v1.canonical.json";
    byteLength: 1287041;
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
    acceptanceClaimSha256:
      "sha256:02e0fba56c294bcef1d6d40dace601b96cf647f60f1b24fc16e1303f19b1aa39",
    acceptanceSubjectSha256:
      "sha256:948a920b86aa915bc2dfcdcf56b271f41a2843fc1360b734e9221c0533d960b8",
    acceptanceRelease: Object.freeze({
      commit: "e074d449aa0e60c40ddf05296823f2eb8c67dcc5",
      tree: "17075bc60f5d997190b6085ce852aac3f73ad7d8",
      reviewedPlanSha256:
        "sha256:cfe926c42918ce1ca23efe8fa7352c2b6ed7090002f62a0d6d64481883205591",
      routerArtifactBindingSha256:
        "sha256:f93920386d226d26dcf55105fcfcc2400bcb3b211974daa3e09cd12082bb6b53",
      acceptanceRecordSha256:
        "sha256:1b079965e5ef4d09eb42aaab77bd843d6c340bb1d4cba37e3165918200f97251",
    }),
    canonicalArtifact: Object.freeze({
      path: "outputs/shards-nested-factory-route-v1.canonical.json",
      byteLength: 1287041,
      sha256:
        "sha256:066475058bfd47b85b4216f95b434756d67d7e289ffb36535c121ef5d7c11bab",
      keccak256:
        "0x8c5521d6796e3e63c3e2cf82e1122c952e6465c345d8a10b3773a70aa2419fb3",
      integritySha256:
        "sha256:74028d65363189804912f2907400da11098d90579c9261e1d087b2d5a709ae6f",
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
      reviewedPlanSha256:
        "sha256:cfe926c42918ce1ca23efe8fa7352c2b6ed7090002f62a0d6d64481883205591",
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
      adapterCommit: "b180aca739e0745d16618542052e44b89e177bae",
      adapterTree: "b7a90a8f7d0e48c581bf212595a1ad5d5906153f",
      bundleSha256:
        "sha256:2857f80616cd9dd3da6128a298f935c2cdc7acc8909bfd7fad58ed82776241de",
      manifestSha256:
        "sha256:ba46a2aff95c30fe4f75e60c70da654c90787e58c1f3fdb15c408704c2d81343",
      goldenSha256:
        "sha256:befb581ce142001a5cd5b68a256c55a86dc435630139832d5438f257b77f55db",
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
  acceptanceRelease: ManualRouterProductionBindingV2["acceptanceRelease"];
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
    || !gitSha(binding.acceptanceRelease.commit)
    || !gitSha(binding.acceptanceRelease.tree)
    || binding.acceptanceRelease.reviewedPlanSha256
      !== exactPlan.reviewedPlanSha256
    || !sha256(binding.acceptanceRelease.routerArtifactBindingSha256)
    || !sha256(binding.acceptanceRelease.acceptanceRecordSha256)
    || binding.canonicalArtifact.byteLength !== 1287041
    || binding.canonicalArtifact.sha256
      !== "sha256:066475058bfd47b85b4216f95b434756d67d7e289ffb36535c121ef5d7c11bab"
    || binding.canonicalArtifact.keccak256
      !== "0x8c5521d6796e3e63c3e2cf82e1122c952e6465c345d8a10b3773a70aa2419fb3"
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
