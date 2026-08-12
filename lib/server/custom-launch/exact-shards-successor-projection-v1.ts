import { createHash } from "node:crypto";

import {
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

const HASH32 = /^0x[0-9a-fA-F]{64}$/u;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/u;
const TRUST_DOMAIN = /^[a-z0-9][a-z0-9.-]{0,252}[a-z0-9]$/u;
const ZERO_HASH = `0x${"00".repeat(32)}` as Hex;
const ZERO_ADDRESS = `0x${"00".repeat(20)}` as Address;
const PROJECTED_FINALIZED_RECORDS = new WeakSet<object>();
const PROJECTED_REVOCATION_RECORDS = new WeakSet<object>();

const BUILDER_ROLE_HASH =
  "0x36a60a66fdf8fc39bbaab0d3ff46b52ffc8a9b6f3dc94b5fe9836816d72890af";
const PROGRAMMABLE_ROLE_HASH =
  "0x069cb8bbaf512d6f3d7fd962d64b67ce531a420f558aa3a2301e77be3640d875";
const HOLDER_ROLE_HASH =
  "0x84edd196638e45435db849686913b0ffb528525a1edc3aece78548ed6f2577f1";
const EXACT_SHARDS_ROUTE_ID =
  "0xe82ee94c42c7b2173be0d7915d887f813837a51b40af7fe20c1d2accb6f10db8";
const PROJECT_ID_DOMAIN =
  "0x4fa0ae35da6b43ca2e5bd51635b32c072bcd2e4cfb9f65c03b1b6b6069e841b4";
const APPROVAL_ID_DOMAIN =
  "0x5e9f160793c808ca3f7bdcad892fda47ff40df23f6003434dfe04b04a4b94413";
const LAUNCH_ID_DOMAIN =
  "0x43422cb1e64441d3e905301f644720cc17c297817130fde0bbcf3318f8c97b52";
const PUBLIC_IDENTITY_BINDING_TYPEHASH =
  "0x498832eeb344297e6fe6a4ca913f12e0905a46029de4db75a154328c57427b94";

const ABI_DECLARATIONS = [
  "struct LaunchPermitV1 { uint64 githubRepositoryId; uint64 approvalGeneration; uint64 permitGeneration; uint64 notBefore; uint64 deadline; uint64 signerEpoch; uint256 nonce; uint256 chainId; bytes32 repositoryKey; address route; bytes32 routeId; address applicantWallet; bytes32 launchId; bytes32 approvalId; bytes32 technicalApprovalHash; bytes32 descriptorHash; bytes32 presentationBindingHash; bytes32 configurationHash; bytes32 walletOwnershipBindingHash; bytes32 executionPlanHash; bytes32 executionCoreHash; bytes32 executionCalldataKeccak256; bytes32 generationBindingHash; uint256 executionValue; bytes32 releaseBindingHash; bytes32 kernelExecutionEnvelopeHash; }",
  "struct ReleaseBindingV1 { uint64 authorityGeneration; uint64 releaseGeneration; address permitAuthority; bytes32 permitAuthorityRuntimeCodeHash; address launchRegistry; uint64 launchRegistryGeneration; bytes32 launchRegistryRuntimeCodeHash; bytes32 chainProfileHash; address profile; bytes32 profileId; bytes32 profileRuntimeCodeHash; bytes32 profileBindingHash; address route; bytes32 routeId; bytes32 routeRuntimeCodeHash; bytes32 executionAuthorityHash; uint8 kernelEnvelopeMode; }",
  "struct KernelExecutionEnvelopeV1 { bytes32 kernelGrantDigest; bytes32 reviewerCurrentnessDigest; bytes32 applicantWalletIntentDigest; }",
  "struct PermitEnvelopeV1 { LaunchPermitV1 permit; ReleaseBindingV1 releaseBinding; KernelExecutionEnvelopeV1 kernelEnvelope; bytes permitSignature; }",
  "struct ProgrammableRevenuePolicyV1 { bytes32 profileKey; address feeAsset; bytes32 feeBasisHash; uint16 totalFeeBps; bytes32 legsHash; }",
  "struct ProgrammableRevenueLegV1 { bytes32 roleHash; uint16 feeBps; address recipient; bytes32 recipientModeHash; }",
  "struct LaunchRegistrationV1 { uint256 chainId; uint64 registryGeneration; bytes32 launchId; bytes32 projectId; bytes32 websiteProjectIdSha256; bytes32 websiteLaunchIdSha256; bytes32 approvalId; bytes32 approvalBindingHash; uint64 githubRepositoryId; uint64 approvalGeneration; bytes32 commitId; bytes32 sourceCommitment; bytes32 buildCommitment; bytes32 artifactSetHash; bytes32 deploymentConfigurationHash; bytes32 configurationHash; bytes32 tokenNameHash; bytes32 tokenSymbolHash; bytes32 presentationBindingHash; bytes32 permissionsHash; bytes32 deploymentId; bytes32 deploymentSetHash; bytes32 runtimeCodeSetHash; address primaryContract; bytes32 primaryRuntimeCodeHash; address launchWallet; bytes32 modelId; bytes32 modelVersion; bytes32 templateId; bytes32 templateVersion; bytes32 providerId; bytes32 builderAttributionHash; bytes32 originHash; bytes32 assetSetHash; bytes32 marketSetHash; bytes32 marketPathId; bytes32 capabilitySetHash; bytes32 reviewPolicyHash; bytes32 securityReviewHash; bytes32 reviewResultId; bytes32 reviewDeploymentBindingHash; bytes32 finalityPolicyHash; bytes32 registeredRecordCommitment; ProgrammableRevenuePolicyV1 feePolicy; ProgrammableRevenueLegV1[3] orderedFeeLegs; }",
  "struct LaunchParams { int24 tickLower; int24 tickBand; int24 tickUpper; uint160 startSqrtPriceX96; address renderer; string tokenName; string tokenSymbol; string nftName; string nftSymbol; }",
  "struct ShardsExecutionV1 { LaunchRegistrationV1 registration; bytes32 tokenSalt; bytes32 hookSalt; bytes hookCreationCode; LaunchParams params; }",
] as const;

export const exactShardsRouteConsumerAbiV1 = parseAbi([
  ...ABI_DECLARATIONS,
  "function launch(PermitEnvelopeV1 authorization, ShardsExecutionV1 execution) returns (address hook, address shard, address nft)",
  "event ExactShardsAtomicLaunchCompletedV1(bytes32 indexed launchId,bytes32 indexed repositoryKey,address indexed shard,address hook,address nft)",
  "event ExactShardsLaunchMetadataBoundV1(bytes32 indexed launchId,bytes32 tokenNameHash,bytes32 tokenSymbolHash,bytes32 presentationBindingHash)",
]);

export const exactShardsRegistryConsumerAbiV1 = parseAbi([
  "event ExactShardsFeePolicyBoundV1(bytes32 indexed launchId,bytes32 indexed policyHash,bytes32 indexed feePolicyRecordHash,bytes32 claimSetHash,bytes32 verifierBindingHash,bytes32 profileKey,address feeAsset,bytes32 feeBasisHash,uint16 totalFeeBps,bytes32 legsHash)",
  "event ExactShardsFeeClaimBoundV1(bytes32 indexed launchId,uint8 indexed ordinal,bytes32 indexed roleHash,uint16 grossVolumeFeeBps,uint16 shareOfFeeBps,address initialRecipientOrAccumulator,bytes32 recipientModeHash,bytes4 claimSelector,bytes4 handoffSelector,bytes32 legHash,bytes32 storedClaimHash)",
  "event ExactShardsLaunchRegisteredV1(bytes32 indexed launchId,bytes32 indexed projectId,address indexed primaryContract,uint64 registrationSequence,bytes32 approvalId,bytes32 deploymentId,bytes32 identityHash,bytes32 registeredRecordCommitment,bytes32 feePolicyHash,bytes32 feePolicyRecordHash,uint64 observedAtBlock)",
  "event ExactShardsPublicIdentityBoundV1(bytes32 indexed launchId,bytes32 indexed websiteLaunchIdSha256,bytes32 indexed websiteProjectIdSha256,bytes32 identityMappingHash)",
  "event ExactShardsLaunchFinalizedV1(bytes32 indexed launchId,bytes32 indexed observedTransactionHash,bytes32 indexed finalityEvidenceHash,uint64 transitionSequence,uint64 observedBlockNumber,bytes32 observedBlockHash,uint32 observedTransactionIndex,uint32 observedLogIndex,uint64 confirmedHeadBlockNumber,bytes32 confirmedHeadBlockHash,bytes32 finalityPolicyHash,uint64 finalizedAtBlock,uint64 finalizedAtTimestamp)",
  "event ExactShardsLaunchRevokedV1(bytes32 indexed launchId,bytes32 indexed reasonCode,bytes32 indexed evidenceHash,uint64 transitionSequence,uint64 latestRecordRevision,bytes32 latestRecordHash,uint64 revokedAtBlock,uint64 revokedAtTimestamp)",
  "function launchState(bytes32 launchId) view returns (uint8 status,uint64 observedAtBlock,uint64 finalizedAtBlock,uint64 latestRecordRevision,bytes32 latestRecordHash,bytes32 identityHash,bytes32 feePolicyHash,bytes32 feePolicyRecordHash,bytes32 finalityEvidenceHash)",
  "function publicIdentityState(bytes32 launchId) view returns (bytes32 websiteProjectIdSha256,bytes32 websiteLaunchIdSha256,bytes32 identityMappingHash)",
  "function recordHashAtRevision(bytes32 launchId,uint64 revision) view returns (bytes32)",
]);

export const exactShardsAuthorityConsumerAbiV1 = parseAbi([
  "event LaunchPermitConsumedV1(bytes32 indexed permitKey,bytes32 indexed repositoryKey,bytes32 indexed launchId,uint64 approvalGeneration,uint64 permitGeneration,uint256 nonce,uint64 signerEpoch,address route,bytes32 routeId,address applicantWallet,uint64 consumedAtBlock)",
  "event RepositoryLineageConsumedV1(bytes32 indexed repositoryKey,bytes32 indexed launchId,bytes32 indexed routeId,bytes32 permitKey,uint64 githubRepositoryId,address route,address applicantWallet,uint256 nonce,uint64 consumedAtBlock)",
]);

export const EXACT_SHARDS_CONSUMER_ABI_SHA256_V1 = Object.freeze({
  registry: sha256Canonical(exactShardsRegistryConsumerAbiV1),
  route: sha256Canonical(exactShardsRouteConsumerAbiV1),
  permitAuthority: sha256Canonical(exactShardsAuthorityConsumerAbiV1),
});

export function deriveExactShardsCanonicalIdentitiesV1(input: Readonly<{
  websiteProjectIdSha256: Hex;
  websiteLaunchIdSha256: Hex;
  githubRepositoryId: bigint;
  approvalGeneration: bigint;
  approvalBindingHash: Hex;
  chainId: bigint;
  registry: Address;
  registryGeneration: bigint;
  primaryContract: Address;
}>) {
  const websiteProjectIdSha256 = hex32(
    input.websiteProjectIdSha256,
    "Website project ID",
  );
  const websiteLaunchIdSha256 = hex32(
    input.websiteLaunchIdSha256,
    "Website launch ID",
  );
  const githubRepositoryId = number(
    input.githubRepositoryId,
    "GitHub repository ID",
  );
  const approvalGeneration = number(
    input.approvalGeneration,
    "approval generation",
  );
  const chainId = number(input.chainId, "chain ID");
  const registryGeneration = number(
    input.registryGeneration,
    "registry generation",
  );
  if (githubRepositoryId === 0n || approvalGeneration === 0n
    || chainId === 0n || registryGeneration === 0n
    || githubRepositoryId > 0xffff_ffff_ffff_ffffn
    || approvalGeneration > 0xffff_ffff_ffff_ffffn
    || registryGeneration > 0xffff_ffff_ffff_ffffn) {
    throw new TypeError("ExactShards canonical identity numeric scope is invalid");
  }
  const approvalBindingHash = hex32(
    input.approvalBindingHash,
    "approval binding hash",
  );
  const registry = address(input.registry, "registry identity");
  const primaryContract = address(input.primaryContract, "primary contract identity");
  const repositoryKey = keccak256(encodeAbiParameters(
    [{ type: "string" }, { type: "uint256" }],
    ["programmable.github.repository.v1", githubRepositoryId],
  ));
  const projectId = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }],
    [PROJECT_ID_DOMAIN, repositoryKey],
  ));
  const approvalId = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "bytes32" }, { type: "uint64" },
      { type: "bytes32" }, { type: "uint256" }, { type: "address" },
      { type: "uint64" }, { type: "bytes32" },
    ],
    [
      APPROVAL_ID_DOMAIN,
      projectId,
      approvalGeneration,
      approvalBindingHash,
      chainId,
      registry,
      registryGeneration,
      EXACT_SHARDS_ROUTE_ID,
    ],
  ));
  const launchId = keccak256(encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [LAUNCH_ID_DOMAIN, projectId, approvalId],
  ));
  const identityMappingHash = keccak256(encodeAbiParameters(
    [
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" },
      { type: "uint64" }, { type: "uint64" }, { type: "uint256" },
      { type: "address" }, { type: "uint64" }, { type: "bytes32" },
      { type: "address" },
    ],
    [
      PUBLIC_IDENTITY_BINDING_TYPEHASH,
      websiteProjectIdSha256,
      websiteLaunchIdSha256,
      projectId,
      approvalId,
      launchId,
      githubRepositoryId,
      approvalGeneration,
      chainId,
      registry,
      registryGeneration,
      EXACT_SHARDS_ROUTE_ID,
      primaryContract,
    ],
  ));
  return Object.freeze({
    repositoryKey,
    projectId,
    approvalId,
    launchId,
    identityMappingHash,
  });
}

export type ExactShardsContractDescriptorV1 = Readonly<{
  address: Address;
  runtimeCodeHash: Hex;
  startBlock: bigint;
  consumerAbiSha256: `sha256:${string}`;
}>;

export type BoundExactShardsSuccessorDescriptorV1 = Readonly<{
  schemaVersion: "programmable.exact-shards-successor-descriptor.v1";
  lane: "registry.exact-shards-v2";
  status: "bound";
  activationAllowed: false;
  chainId: number;
  minimumConfirmations: number;
  consumerAbis: typeof EXACT_SHARDS_CONSUMER_ABI_SHA256_V1;
  contracts: Readonly<{
    registry: ExactShardsContractDescriptorV1;
    route: ExactShardsContractDescriptorV1;
    permitAuthority: ExactShardsContractDescriptorV1;
  }>;
}>;

export type UnconfiguredExactShardsSuccessorDescriptorV1 = Readonly<{
  schemaVersion: "programmable.exact-shards-successor-descriptor.v1";
  lane: "registry.exact-shards-v2";
  status: "unconfigured";
  activationAllowed: false;
  chainId: number;
  minimumConfirmations: null;
  consumerAbis: typeof EXACT_SHARDS_CONSUMER_ABI_SHA256_V1;
  contracts: Readonly<{
    registry: null;
    route: null;
    permitAuthority: null;
  }>;
}>;

export type ExactShardsSuccessorDescriptorV1 =
  | BoundExactShardsSuccessorDescriptorV1
  | UnconfiguredExactShardsSuccessorDescriptorV1;

export function parseExactShardsSuccessorDescriptorV1(
  value: unknown,
): ExactShardsSuccessorDescriptorV1 {
  const source = object(value, "ExactShards successor descriptor");
  exactKeys(source, [
    "activationAllowed", "chainId", "consumerAbis", "contracts", "lane",
    "minimumConfirmations", "schemaVersion", "status",
  ], "ExactShards successor descriptor");
  if (source.schemaVersion !== "programmable.exact-shards-successor-descriptor.v1"
    || source.lane !== "registry.exact-shards-v2"
    || source.activationAllowed !== false
    || !positiveSafeInteger(source.chainId)) {
    throw new TypeError("ExactShards successor descriptor is invalid");
  }
  const contracts = object(source.contracts, "ExactShards successor contracts");
  exactKeys(contracts, ["permitAuthority", "registry", "route"],
    "ExactShards successor contracts");
  const consumerAbis = object(source.consumerAbis, "ExactShards consumer ABIs");
  exactKeys(consumerAbis, ["permitAuthority", "registry", "route"],
    "ExactShards consumer ABIs");
  if (digest(consumerAbis.registry, "registry consumer ABI")
      !== EXACT_SHARDS_CONSUMER_ABI_SHA256_V1.registry
    || digest(consumerAbis.route, "route consumer ABI")
      !== EXACT_SHARDS_CONSUMER_ABI_SHA256_V1.route
    || digest(consumerAbis.permitAuthority, "permit Authority consumer ABI")
      !== EXACT_SHARDS_CONSUMER_ABI_SHA256_V1.permitAuthority) {
    throw new TypeError("ExactShards consumer ABI binding is invalid");
  }
  if (source.status === "unconfigured") {
    if (source.minimumConfirmations !== null || contracts.registry !== null
      || contracts.route !== null || contracts.permitAuthority !== null) {
      throw new TypeError("unconfigured ExactShards descriptor contains deployment claims");
    }
    return Object.freeze({
      schemaVersion: source.schemaVersion,
      lane: source.lane,
      status: "unconfigured" as const,
      activationAllowed: false as const,
      chainId: source.chainId as number,
      minimumConfirmations: null,
      consumerAbis: EXACT_SHARDS_CONSUMER_ABI_SHA256_V1,
      contracts: Object.freeze({
        registry: null,
        route: null,
        permitAuthority: null,
      }),
    });
  }
  if (source.status !== "bound" || !positiveSafeInteger(source.minimumConfirmations)) {
    throw new TypeError("bound ExactShards descriptor is invalid");
  }
  const parsed = {
    registry: parseContractDescriptor(
      contracts.registry,
      EXACT_SHARDS_CONSUMER_ABI_SHA256_V1.registry,
      "registry",
    ),
    route: parseContractDescriptor(
      contracts.route,
      EXACT_SHARDS_CONSUMER_ABI_SHA256_V1.route,
      "route",
    ),
    permitAuthority: parseContractDescriptor(
      contracts.permitAuthority,
      EXACT_SHARDS_CONSUMER_ABI_SHA256_V1.permitAuthority,
      "permit Authority",
    ),
  };
  if (new Set(Object.values(parsed).map(({ address }) => address)).size !== 3) {
    throw new TypeError("ExactShards successor contract addresses are not distinct");
  }
  return Object.freeze({
    schemaVersion: source.schemaVersion,
    lane: source.lane,
    status: "bound" as const,
    activationAllowed: false as const,
    chainId: source.chainId as number,
    minimumConfirmations: source.minimumConfirmations as number,
    consumerAbis: EXACT_SHARDS_CONSUMER_ABI_SHA256_V1,
    contracts: Object.freeze(parsed),
  });
}

export type ExactShardsLogV1 = Readonly<{
  address: Address;
  topics: readonly Hex[];
  data: Hex;
  logIndex: number;
}>;

export type ExactShardsTransactionV1 = Readonly<{
  hash: Hex;
  from: Address;
  to: Address;
  input: Hex;
}>;

export type ExactShardsReceiptV1 = Readonly<{
  transactionHash: Hex;
  status: "success";
  blockNumber: bigint;
  blockHash: Hex;
  transactionIndex: number;
  logs: readonly ExactShardsLogV1[];
}>;

export type ExactShardsRegistrySnapshotV1 = Readonly<{
  blockNumber: bigint;
  blockHash: Hex;
  registryRuntimeCodeHash: Hex;
  routeRuntimeCodeHash: Hex;
  permitAuthorityRuntimeCodeHash: Hex;
  primaryRuntimeCodeHash: Hex;
  hookRuntimeCodeHash: Hex;
  nftRuntimeCodeHash: Hex;
  launchState: Readonly<{
    status: 2 | 3;
    observedAtBlock: bigint;
    finalizedAtBlock: bigint;
    latestRecordRevision: bigint;
    latestRecordHash: Hex;
    identityHash: Hex;
    feePolicyHash: Hex;
    feePolicyRecordHash: Hex;
    finalityEvidenceHash: Hex;
  }>;
  publicIdentity: Readonly<{
    websiteProjectIdSha256: Hex;
    websiteLaunchIdSha256: Hex;
    identityMappingHash: Hex;
  }>;
  recordHashAtRevision1: Hex;
  recordHashAtRevision2: Hex;
}>;

export type ExactShardsAuthenticatedRpcObservationV1 = Readonly<{
  provider: Readonly<{
    providerId: string;
    trustDomain: string;
    authentication: "authenticated-server-rpc-v1";
  }>;
  chainId: number;
  launchTransaction: ExactShardsTransactionV1;
  launchReceipt: ExactShardsReceiptV1;
  finalizationReceipt: ExactShardsReceiptV1;
  snapshot: ExactShardsRegistrySnapshotV1;
}>;

export type ExactShardsPublicRecordV1 = Readonly<{
  schemaVersion: "programmable.exact-shards-public-record.v1";
  sourceLane: "registry.exact-shards-v2";
  lifecycle: Readonly<{
    state: "finalized";
    revision: "1";
    correctionSupported: false;
    refinalizationSupported: false;
  }>;
  publicIdentity: Readonly<{
    websiteProjectId: `sha256:${string}`;
    websiteLaunchId: `sha256:${string}`;
    registryProjectId: Hex;
    registryLaunchId: Hex;
    mappingHash: Hex;
  }>;
  source: Readonly<{
    githubRepositoryId: string;
    repositoryKey: Hex;
    approvalGeneration: string;
    registryGeneration: string;
    commitId: Hex;
    sourceCommitment: Hex;
    buildCommitment: Hex;
  }>;
  approval: Readonly<{
    approvalId: Hex;
    approvalBindingHash: Hex;
    permitDigest: Hex;
    permitGeneration: string;
    signerEpoch: string;
  }>;
  launch: Readonly<{
    wallet: Address;
    route: Address;
    transactionHash: Hex;
    blockNumber: string;
    blockHash: Hex;
    transactionIndex: number;
    registrationLogIndex: number;
    primaryContract: Address;
    shard: Address;
    hook: Address;
    nft: Address;
    primaryRuntimeCodeHash: Hex;
    hookRuntimeCodeHash: Hex;
    nftRuntimeCodeHash: Hex;
    tokenNameHash: Hex;
    tokenSymbolHash: Hex;
    presentationBindingHash: Hex;
    configurationHash: Hex;
    deploymentConfigurationHash: Hex;
    deploymentSetHash: Hex;
    runtimeCodeSetHash: Hex;
    registeredRecordCommitment: Hex;
  }>;
  economics: Readonly<{
    profileKey: Hex;
    feeAsset: Address;
    feeBasisHash: Hex;
    totalFeeBps: 100;
    policyHash: Hex;
    feePolicyRecordHash: Hex;
    claimSetHash: Hex;
    claims: readonly Readonly<{
      ordinal: 0 | 1 | 2;
      role: "builder" | "programmable" | "holder";
      roleHash: Hex;
      grossVolumeFeeBps: 10 | 80;
      shareOfFeeBps: 1000 | 8000;
      recipient: Address;
      recipientModeHash: Hex;
      claimSelector: Hex;
      handoffSelector: Hex;
      legHash: Hex;
      storedClaimHash: Hex;
    }>[];
  }>;
  finality: Readonly<{
    evidenceHash: Hex;
    policyHash: Hex;
    confirmedHeadBlockNumber: string;
    confirmedHeadBlockHash: Hex;
    finalizationTransactionHash: Hex;
    finalizedAtBlock: string;
    finalizedBlockHash: Hex;
    finalizedAtTimestamp: string;
    providerIds: readonly [string, string];
    trustDomains: readonly [string, string];
  }>;
  descriptor: Readonly<{
    chainId: number;
    minimumConfirmations: number;
    registry: Readonly<Omit<ExactShardsContractDescriptorV1, "startBlock"> & {
      startBlock: string;
    }>;
    route: Readonly<Omit<ExactShardsContractDescriptorV1, "startBlock"> & {
      startBlock: string;
    }>;
    permitAuthority: Readonly<Omit<ExactShardsContractDescriptorV1, "startBlock"> & {
      startBlock: string;
    }>;
    bindingSha256: `sha256:${string}`;
  }>;
  recordBindingSha256: `sha256:${string}`;
}>;

export function projectFinalizedExactShardsPublicRecordV1(input: Readonly<{
  descriptor: unknown;
  observations: readonly [
    ExactShardsAuthenticatedRpcObservationV1,
    ExactShardsAuthenticatedRpcObservationV1,
  ];
}>): ExactShardsPublicRecordV1 {
  const descriptor = requireBoundDescriptor(input.descriptor);
  const [first, second] = input.observations;
  validateObservation(descriptor, first);
  validateObservation(descriptor, second);
  if (first.provider.providerId === second.provider.providerId
    || first.provider.trustDomain === second.provider.trustDomain) {
    throw new TypeError("ExactShards RPC observations are not independent");
  }
  if (canonical(first, ["provider"]) !== canonical(second, ["provider"])) {
    throw new TypeError("ExactShards RPC observations disagree");
  }

  const decoded = decodeFunctionData({
    abi: exactShardsRouteConsumerAbiV1,
    data: first.launchTransaction.input,
  });
  if (decoded.functionName !== "launch" || decoded.args === undefined) {
    throw new TypeError("ExactShards launch calldata is invalid");
  }
  const [authorization, execution] = decoded.args as unknown as [
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  const permit = object(authorization.permit, "ExactShards permit");
  const registration = object(execution.registration, "ExactShards registration");
  const launchId = hex32(registration.launchId, "registration launch ID");
  const projectId = hex32(registration.projectId, "registration project ID");
  const launchWallet = address(registration.launchWallet, "registration launch wallet");
  const primaryContract = address(
    registration.primaryContract,
    "registration primary contract",
  );
  if (number(registration.chainId, "registration chain ID") !== BigInt(descriptor.chainId)
    || number(permit.chainId, "permit chain ID") !== BigInt(descriptor.chainId)
    || address(permit.route, "permit route") !== descriptor.contracts.route.address
    || hex32(permit.routeId, "permit route ID") !== EXACT_SHARDS_ROUTE_ID
    || address(permit.applicantWallet, "permit applicant wallet") !== launchWallet
    || hex32(permit.launchId, "permit launch ID") !== launchId
    || hex32(permit.approvalId, "permit approval ID")
      !== hex32(registration.approvalId, "registration approval ID")
    || first.launchTransaction.from !== launchWallet) {
    throw new TypeError("ExactShards calldata authority binding is invalid");
  }

  const launchEvents = decodeLaunchReceipt(descriptor, first.launchReceipt);
  const finality = decodeSingleEvent(
    first.finalizationReceipt,
    descriptor.contracts.registry.address,
    exactShardsRegistryConsumerAbiV1,
    "ExactShardsLaunchFinalizedV1",
  );
  correlateLaunch(
    descriptor,
    first,
    permit,
    registration,
    launchEvents,
    finality.args,
    finality.logIndex,
  );

  const orderedClaims = launchEvents.claims
    .slice()
    .sort((left, right) => Number(left.args.ordinal) - Number(right.args.ordinal));
  const claims = orderedClaims.map(({ args }) => {
    const ordinal = Number(args.ordinal) as 0 | 1 | 2;
    const expected = [
      [BUILDER_ROLE_HASH, 10, 1000, "builder"],
      [PROGRAMMABLE_ROLE_HASH, 10, 1000, "programmable"],
      [HOLDER_ROLE_HASH, 80, 8000, "holder"],
    ] as const;
    const terms = expected[ordinal];
    if (terms === undefined || args.roleHash !== terms[0]
      || Number(args.grossVolumeFeeBps) !== terms[1]
      || Number(args.shareOfFeeBps) !== terms[2]) {
      throw new TypeError("ExactShards fee claim is not canonical 10/10/80");
    }
    return Object.freeze({
      ordinal,
      role: terms[3],
      roleHash: hex32(args.roleHash, "claim role hash"),
      grossVolumeFeeBps: terms[1],
      shareOfFeeBps: terms[2],
      recipient: address(args.initialRecipientOrAccumulator, "claim recipient"),
      recipientModeHash: hex32(args.recipientModeHash, "claim recipient mode"),
      claimSelector: hex(args.claimSelector, 4, "claim selector"),
      handoffSelector: hex(args.handoffSelector, 4, "handoff selector"),
      legHash: hex32(args.legHash, "claim leg hash"),
      storedClaimHash: hex32(args.storedClaimHash, "stored claim hash"),
    });
  });
  if (claims[2]?.recipient
    !== address(launchEvents.completed.args.hook, "launched hook")) {
    throw new TypeError("ExactShards holder claim is not bound to the launched hook");
  }

  const providerIds = [
    first.provider.providerId,
    second.provider.providerId,
  ] as const;
  const trustDomains = [
    first.provider.trustDomain,
    second.provider.trustDomain,
  ] as const;
  const descriptorBindingSha256 = sha256Canonical(descriptor);
  const recordWithoutBinding = {
    schemaVersion: "programmable.exact-shards-public-record.v1" as const,
    sourceLane: "registry.exact-shards-v2" as const,
    lifecycle: Object.freeze({
      state: "finalized" as const,
      revision: "1" as const,
      correctionSupported: false as const,
      refinalizationSupported: false as const,
    }),
    publicIdentity: Object.freeze({
      websiteProjectId: rawSha256(
        registration.websiteProjectIdSha256,
        "Website project ID",
      ),
      websiteLaunchId: rawSha256(
        registration.websiteLaunchIdSha256,
        "Website launch ID",
      ),
      registryProjectId: projectId,
      registryLaunchId: launchId,
      mappingHash: hex32(
        launchEvents.publicIdentity.args.identityMappingHash,
        "public identity mapping",
      ),
    }),
    source: Object.freeze({
      githubRepositoryId: number(
        registration.githubRepositoryId,
        "GitHub repository ID",
      ).toString(),
      repositoryKey: hex32(permit.repositoryKey, "repository key"),
      approvalGeneration: number(
        registration.approvalGeneration,
        "approval generation",
      ).toString(),
      registryGeneration: number(
        registration.registryGeneration,
        "registry generation",
      ).toString(),
      commitId: hex32(registration.commitId, "commit ID"),
      sourceCommitment: hex32(registration.sourceCommitment, "source commitment"),
      buildCommitment: hex32(registration.buildCommitment, "build commitment"),
    }),
    approval: Object.freeze({
      approvalId: hex32(registration.approvalId, "approval ID"),
      approvalBindingHash: hex32(
        registration.approvalBindingHash,
        "approval binding",
      ),
      permitDigest: hex32(launchEvents.permit.args.permitKey, "permit digest"),
      permitGeneration: number(permit.permitGeneration, "permit generation").toString(),
      signerEpoch: number(permit.signerEpoch, "signer epoch").toString(),
    }),
    launch: Object.freeze({
      wallet: launchWallet,
      route: descriptor.contracts.route.address,
      transactionHash: first.launchTransaction.hash,
      blockNumber: first.launchReceipt.blockNumber.toString(),
      blockHash: first.launchReceipt.blockHash,
      transactionIndex: first.launchReceipt.transactionIndex,
      registrationLogIndex: launchEvents.registered.logIndex,
      primaryContract,
      shard: address(launchEvents.completed.args.shard, "launched shard"),
      hook: address(launchEvents.completed.args.hook, "launched hook"),
      nft: address(launchEvents.completed.args.nft, "launched NFT"),
      primaryRuntimeCodeHash: first.snapshot.primaryRuntimeCodeHash,
      hookRuntimeCodeHash: first.snapshot.hookRuntimeCodeHash,
      nftRuntimeCodeHash: first.snapshot.nftRuntimeCodeHash,
      tokenNameHash: hex32(registration.tokenNameHash, "token name hash"),
      tokenSymbolHash: hex32(registration.tokenSymbolHash, "token symbol hash"),
      presentationBindingHash: hex32(
        registration.presentationBindingHash,
        "presentation binding",
      ),
      configurationHash: hex32(registration.configurationHash, "configuration hash"),
      deploymentConfigurationHash: hex32(
        registration.deploymentConfigurationHash,
        "deployment configuration hash",
      ),
      deploymentSetHash: hex32(registration.deploymentSetHash, "deployment set hash"),
      runtimeCodeSetHash: hex32(registration.runtimeCodeSetHash, "runtime set hash"),
      registeredRecordCommitment: hex32(
        registration.registeredRecordCommitment,
        "registered record commitment",
      ),
    }),
    economics: Object.freeze({
      profileKey: hex32(launchEvents.policy.args.profileKey, "fee profile"),
      feeAsset: address(launchEvents.policy.args.feeAsset, "fee asset", true),
      feeBasisHash: hex32(launchEvents.policy.args.feeBasisHash, "fee basis"),
      totalFeeBps: 100 as const,
      policyHash: hex32(launchEvents.policy.args.policyHash, "fee policy hash"),
      feePolicyRecordHash: hex32(
        launchEvents.policy.args.feePolicyRecordHash,
        "fee policy record hash",
      ),
      claimSetHash: hex32(launchEvents.policy.args.claimSetHash, "claim set hash"),
      claims: Object.freeze(claims),
    }),
    finality: Object.freeze({
      evidenceHash: hex32(finality.args.finalityEvidenceHash, "finality evidence"),
      policyHash: hex32(finality.args.finalityPolicyHash, "finality policy"),
      confirmedHeadBlockNumber: number(
        finality.args.confirmedHeadBlockNumber,
        "confirmed head block",
      ).toString(),
      confirmedHeadBlockHash: hex32(
        finality.args.confirmedHeadBlockHash,
        "confirmed head hash",
      ),
      finalizationTransactionHash: first.finalizationReceipt.transactionHash,
      finalizedAtBlock: number(finality.args.finalizedAtBlock, "finalized block").toString(),
      finalizedBlockHash: first.finalizationReceipt.blockHash,
      finalizedAtTimestamp: number(
        finality.args.finalizedAtTimestamp,
        "finalized timestamp",
      ).toString(),
      providerIds,
      trustDomains,
    }),
    descriptor: Object.freeze({
      chainId: descriptor.chainId,
      minimumConfirmations: descriptor.minimumConfirmations,
      registry: publicContractDescriptor(descriptor.contracts.registry),
      route: publicContractDescriptor(descriptor.contracts.route),
      permitAuthority: publicContractDescriptor(descriptor.contracts.permitAuthority),
      bindingSha256: descriptorBindingSha256,
    }),
  };
  const recordBindingSha256 = sha256Canonical(recordWithoutBinding);
  const projected = deepFreeze({ ...recordWithoutBinding, recordBindingSha256 });
  PROJECTED_FINALIZED_RECORDS.add(projected);
  return projected;
}

export type ExactShardsRevocationRecordV1 = Readonly<{
  schemaVersion: "programmable.exact-shards-revocation-record.v1";
  sourceLane: "registry.exact-shards-v2";
  launchId: Hex;
  reasonCode: Hex;
  evidenceHash: Hex;
  latestRecordRevision: "1";
  latestRecordHash: Hex;
  blockNumber: string;
  blockHash: Hex;
  transactionHash: Hex;
  transitionSequence: string;
}>;

export function projectExactShardsRevocationV1(input: Readonly<{
  descriptor: unknown;
  launchId: Hex;
  latestRecordHash: Hex;
  observations: readonly [
    Readonly<{
      provider: ExactShardsAuthenticatedRpcObservationV1["provider"];
      chainId: number;
      receipt: ExactShardsReceiptV1;
      snapshot: ExactShardsRegistrySnapshotV1;
    }>,
    Readonly<{
      provider: ExactShardsAuthenticatedRpcObservationV1["provider"];
      chainId: number;
      receipt: ExactShardsReceiptV1;
      snapshot: ExactShardsRegistrySnapshotV1;
    }>,
  ];
}>): ExactShardsRevocationRecordV1 {
  const descriptor = requireBoundDescriptor(input.descriptor);
  const [first, second] = input.observations;
  const launchId = hex32(input.launchId, "revocation launch ID");
  const latestRecordHash = hex32(
    input.latestRecordHash,
    "revocation latest record hash",
  );
  validateProvider(first.provider);
  validateProvider(second.provider);
  validateReceipt(first.receipt);
  validateReceipt(second.receipt);
  if (first.provider.providerId === second.provider.providerId
    || first.provider.trustDomain === second.provider.trustDomain
    || canonical(first, ["provider"]) !== canonical(second, ["provider"])) {
    throw new TypeError("ExactShards revocation observations are not independent consensus");
  }
  if (first.chainId !== descriptor.chainId
    || first.receipt.blockNumber < descriptor.contracts.registry.startBlock
    || first.snapshot.blockHash === ZERO_HASH
    || first.snapshot.blockNumber < first.receipt.blockNumber
    || (first.snapshot.blockNumber === first.receipt.blockNumber
      && first.snapshot.blockHash !== first.receipt.blockHash)
    || first.snapshot.registryRuntimeCodeHash
      !== descriptor.contracts.registry.runtimeCodeHash
    || first.snapshot.routeRuntimeCodeHash
      !== descriptor.contracts.route.runtimeCodeHash
    || first.snapshot.permitAuthorityRuntimeCodeHash
      !== descriptor.contracts.permitAuthority.runtimeCodeHash
    || first.snapshot.launchState.status !== 3
    || first.snapshot.launchState.observedAtBlock
      < descriptor.contracts.registry.startBlock
    || first.snapshot.launchState.observedAtBlock
      < descriptor.contracts.route.startBlock
    || first.snapshot.launchState.observedAtBlock
      < descriptor.contracts.permitAuthority.startBlock
    || first.snapshot.launchState.finalizedAtBlock
      < first.snapshot.launchState.observedAtBlock
    || first.snapshot.launchState.finalizedAtBlock >= first.receipt.blockNumber
    || first.snapshot.launchState.latestRecordRevision !== 1n
    || first.snapshot.launchState.latestRecordHash !== latestRecordHash
    || first.snapshot.recordHashAtRevision1 !== latestRecordHash
    || first.snapshot.recordHashAtRevision2 !== ZERO_HASH
    || first.snapshot.launchState.identityHash === ZERO_HASH
    || first.snapshot.launchState.feePolicyHash === ZERO_HASH
    || first.snapshot.launchState.feePolicyRecordHash === ZERO_HASH
    || first.snapshot.launchState.finalityEvidenceHash === ZERO_HASH
    || first.snapshot.publicIdentity.websiteProjectIdSha256 === ZERO_HASH
    || first.snapshot.publicIdentity.websiteLaunchIdSha256 === ZERO_HASH
    || first.snapshot.publicIdentity.identityMappingHash === ZERO_HASH
    || first.snapshot.primaryRuntimeCodeHash === ZERO_HASH
    || first.snapshot.hookRuntimeCodeHash === ZERO_HASH
    || first.snapshot.nftRuntimeCodeHash === ZERO_HASH) {
    throw new TypeError("ExactShards revocation snapshot is invalid");
  }
  const decoded = decodeSingleEvent(
    first.receipt,
    descriptor.contracts.registry.address,
    exactShardsRegistryConsumerAbiV1,
    "ExactShardsLaunchRevokedV1",
  );
  if (decoded.args.launchId !== launchId
    || decoded.args.latestRecordRevision !== 1n
    || decoded.args.latestRecordHash !== latestRecordHash
    || decoded.args.revokedAtBlock !== first.receipt.blockNumber
    || number(decoded.args.revokedAtTimestamp, "revocation timestamp") === 0n
    || number(decoded.args.transitionSequence, "revocation transition sequence") === 0n) {
    throw new TypeError("ExactShards revocation event is invalid");
  }
  const projected = deepFreeze({
    schemaVersion: "programmable.exact-shards-revocation-record.v1" as const,
    sourceLane: "registry.exact-shards-v2" as const,
    launchId,
    reasonCode: hex32(decoded.args.reasonCode, "revocation reason"),
    evidenceHash: hex32(decoded.args.evidenceHash, "revocation evidence"),
    latestRecordRevision: "1" as const,
    latestRecordHash,
    blockNumber: first.receipt.blockNumber.toString(),
    blockHash: first.receipt.blockHash,
    transactionHash: first.receipt.transactionHash,
    transitionSequence: number(
      decoded.args.transitionSequence,
      "revocation transition sequence",
    ).toString(),
  });
  PROJECTED_REVOCATION_RECORDS.add(projected);
  return projected;
}

export type ExactShardsPublicProjectionV1 = Readonly<{
  state: "absent" | "finalized" | "revoked" | "reorged";
  record: ExactShardsPublicRecordV1 | null;
}>;

export interface ExactShardsSuccessorPublicReadStoreV1 {
  readonly sourceLane: "registry.exact-shards-v2";
  findByWebsiteProjectId(input: Readonly<{
    projectId: `sha256:${string}`;
    signal: AbortSignal;
  }>): Promise<ExactShardsPublicRecordV1 | null>;
  findPublic(input: Readonly<{
    signal: AbortSignal;
  }>): Promise<readonly ExactShardsPublicRecordV1[]>;
}

export function validateExactShardsPublicRecordV1(
  value: unknown,
  descriptorValue: unknown,
): asserts value is ExactShardsPublicRecordV1 {
  const descriptor = requireBoundDescriptor(descriptorValue);
  const record = object(value, "ExactShards public record");
  exactKeys(record, [
    "approval", "descriptor", "economics", "finality", "launch", "lifecycle",
    "publicIdentity", "recordBindingSha256", "schemaVersion", "source",
    "sourceLane",
  ], "ExactShards public record");
  const lifecycle = object(record.lifecycle, "ExactShards public lifecycle");
  exactKeys(lifecycle, [
    "correctionSupported", "refinalizationSupported", "revision", "state",
  ], "ExactShards public lifecycle");
  const identity = object(record.publicIdentity, "ExactShards public identity");
  exactKeys(identity, [
    "mappingHash", "registryLaunchId", "registryProjectId", "websiteLaunchId",
    "websiteProjectId",
  ], "ExactShards public identity");
  const recordDescriptor = object(record.descriptor, "ExactShards record descriptor");
  exactKeys(recordDescriptor, [
    "bindingSha256", "chainId", "minimumConfirmations", "permitAuthority",
    "registry", "route",
  ], "ExactShards record descriptor");
  const source = object(record.source, "ExactShards source record");
  exactKeys(source, [
    "approvalGeneration", "buildCommitment", "commitId", "githubRepositoryId",
    "registryGeneration", "repositoryKey", "sourceCommitment",
  ], "ExactShards source record");
  const approval = object(record.approval, "ExactShards approval record");
  exactKeys(approval, [
    "approvalBindingHash", "approvalId", "permitDigest", "permitGeneration",
    "signerEpoch",
  ], "ExactShards approval record");
  const launch = object(record.launch, "ExactShards launch record");
  exactKeys(launch, [
    "blockHash", "blockNumber", "configurationHash",
    "deploymentConfigurationHash", "deploymentSetHash", "hook",
    "hookRuntimeCodeHash", "nft", "nftRuntimeCodeHash", "presentationBindingHash",
    "primaryContract", "primaryRuntimeCodeHash", "registeredRecordCommitment",
    "registrationLogIndex", "route", "runtimeCodeSetHash", "shard",
    "tokenNameHash", "tokenSymbolHash", "transactionHash", "transactionIndex",
    "wallet",
  ], "ExactShards launch record");
  const economics = object(record.economics, "ExactShards economics record");
  exactKeys(economics, [
    "claimSetHash", "claims", "feeAsset", "feeBasisHash", "feePolicyRecordHash",
    "policyHash", "profileKey", "totalFeeBps",
  ], "ExactShards economics record");
  const finality = object(record.finality, "ExactShards finality record");
  exactKeys(finality, [
    "confirmedHeadBlockHash", "confirmedHeadBlockNumber", "evidenceHash",
    "finalizationTransactionHash", "finalizedAtBlock", "finalizedAtTimestamp",
    "finalizedBlockHash", "policyHash", "providerIds", "trustDomains",
  ], "ExactShards finality record");
  const websiteProjectId = digest(identity.websiteProjectId, "Website project ID");
  const websiteLaunchId = digest(identity.websiteLaunchId, "Website launch ID");
  const githubRepositoryId = positiveDecimal(source.githubRepositoryId,
    "GitHub repository ID");
  const approvalGeneration = positiveDecimal(source.approvalGeneration,
    "approval generation");
  const registryGeneration = positiveDecimal(source.registryGeneration,
    "registry generation");
  const canonicalIdentities = deriveExactShardsCanonicalIdentitiesV1({
    websiteProjectIdSha256: `0x${websiteProjectId.slice(7)}` as Hex,
    websiteLaunchIdSha256: `0x${websiteLaunchId.slice(7)}` as Hex,
    githubRepositoryId,
    approvalGeneration,
    approvalBindingHash: hex32(approval.approvalBindingHash, "approval binding"),
    chainId: BigInt(descriptor.chainId),
    registry: descriptor.contracts.registry.address,
    registryGeneration,
    primaryContract: address(launch.primaryContract, "primary contract"),
  });
  address(economics.feeAsset, "fee asset", true);
  const expectedDescriptorBinding = sha256Canonical(descriptor);
  if (record.schemaVersion !== "programmable.exact-shards-public-record.v1"
    || record.sourceLane !== "registry.exact-shards-v2"
    || lifecycle.state !== "finalized"
    || lifecycle.revision !== "1"
    || lifecycle.correctionSupported !== false
    || lifecycle.refinalizationSupported !== false
    || websiteProjectId === `sha256:${"0".repeat(64)}`
    || websiteLaunchId === `sha256:${"0".repeat(64)}`
    || hex32(identity.registryProjectId, "Registry project ID")
      !== canonicalIdentities.projectId
    || hex32(identity.registryLaunchId, "Registry launch ID")
      !== canonicalIdentities.launchId
    || hex32(identity.mappingHash, "identity mapping hash")
      !== canonicalIdentities.identityMappingHash
    || hex32(source.repositoryKey, "repository key")
      !== canonicalIdentities.repositoryKey
    || hex32(source.commitId, "commit ID") === ZERO_HASH
    || hex32(source.sourceCommitment, "source commitment") === ZERO_HASH
    || hex32(source.buildCommitment, "build commitment") === ZERO_HASH
    || hex32(approval.approvalId, "approval ID") !== canonicalIdentities.approvalId
    || hex32(approval.permitDigest, "permit digest") === ZERO_HASH
    || positiveDecimal(approval.permitGeneration, "permit generation") === 0n
    || positiveDecimal(approval.signerEpoch, "signer epoch") === 0n
    || address(launch.wallet, "launch wallet") === ZERO_ADDRESS
    || address(launch.route, "launch route") !== descriptor.contracts.route.address
    || address(launch.shard, "launched shard")
      !== address(launch.primaryContract, "primary contract")
    || address(launch.hook, "launched hook") === ZERO_ADDRESS
    || address(launch.nft, "launched NFT") === ZERO_ADDRESS
    || hex32(launch.transactionHash, "launch transaction hash") === ZERO_HASH
    || positiveDecimal(launch.blockNumber, "launch block number")
      < descriptor.contracts.route.startBlock
    || hex32(launch.blockHash, "launch block hash") === ZERO_HASH
    || !nonnegativeUint32(launch.transactionIndex)
    || !nonnegativeUint32(launch.registrationLogIndex)
    || hex32(launch.primaryRuntimeCodeHash, "primary runtime code hash") === ZERO_HASH
    || hex32(launch.hookRuntimeCodeHash, "hook runtime code hash") === ZERO_HASH
    || hex32(launch.nftRuntimeCodeHash, "NFT runtime code hash") === ZERO_HASH
    || hex32(launch.tokenNameHash, "token name hash") === ZERO_HASH
    || hex32(launch.tokenSymbolHash, "token symbol hash") === ZERO_HASH
    || hex32(launch.presentationBindingHash, "presentation binding") === ZERO_HASH
    || hex32(launch.configurationHash, "configuration hash") === ZERO_HASH
    || hex32(launch.deploymentConfigurationHash, "deployment configuration hash")
      === ZERO_HASH
    || hex32(launch.deploymentSetHash, "deployment set hash") === ZERO_HASH
    || hex32(launch.runtimeCodeSetHash, "runtime code set hash") === ZERO_HASH
    || hex32(launch.registeredRecordCommitment, "registered record commitment")
      === ZERO_HASH
    || economics.totalFeeBps !== 100
    || hex32(economics.profileKey, "fee profile") === ZERO_HASH
    || hex32(economics.feeBasisHash, "fee basis") === ZERO_HASH
    || hex32(economics.policyHash, "fee policy hash") === ZERO_HASH
    || hex32(economics.feePolicyRecordHash, "fee policy record hash") === ZERO_HASH
    || hex32(economics.claimSetHash, "fee claim set hash") === ZERO_HASH
    || !validPublicClaims(economics.claims, address(launch.hook, "launched hook"))
    || hex32(finality.evidenceHash, "finality evidence") === ZERO_HASH
    || hex32(finality.policyHash, "finality policy") === ZERO_HASH
    || positiveDecimal(finality.confirmedHeadBlockNumber, "confirmed head block")
      < positiveDecimal(launch.blockNumber, "launch block number")
        + BigInt(descriptor.minimumConfirmations)
    || hex32(finality.confirmedHeadBlockHash, "confirmed head hash") === ZERO_HASH
    || hex32(finality.finalizationTransactionHash, "finalization transaction hash")
      === ZERO_HASH
    || positiveDecimal(finality.finalizedAtBlock, "finalized block")
      < positiveDecimal(launch.blockNumber, "launch block number")
    || hex32(finality.finalizedBlockHash, "finalized block hash") === ZERO_HASH
    || positiveDecimal(finality.finalizedAtTimestamp, "finalized timestamp") === 0n
    || !validProviderConsensus(finality.providerIds, finality.trustDomains)
    || recordDescriptor.chainId !== descriptor.chainId
    || recordDescriptor.minimumConfirmations !== descriptor.minimumConfirmations
    || canonical(recordDescriptor.registry)
      !== canonical(publicContractDescriptor(descriptor.contracts.registry))
    || canonical(recordDescriptor.route)
      !== canonical(publicContractDescriptor(descriptor.contracts.route))
    || canonical(recordDescriptor.permitAuthority)
      !== canonical(publicContractDescriptor(descriptor.contracts.permitAuthority))
    || digest(recordDescriptor.bindingSha256, "record descriptor binding")
      !== expectedDescriptorBinding) {
    throw new TypeError("ExactShards public record release binding is invalid");
  }
  const suppliedRecordBinding = digest(
    record.recordBindingSha256,
    "public record binding",
  );
  const withoutBinding = Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "recordBindingSha256"),
  );
  if (suppliedRecordBinding !== sha256Canonical(withoutBinding)) {
    throw new TypeError("ExactShards public record binding is invalid");
  }
}

export function assertProjectedFinalizedExactShardsRecordV1(
  value: ExactShardsPublicRecordV1,
): void {
  if (!PROJECTED_FINALIZED_RECORDS.has(value)) {
    throw new TypeError("ExactShards finalized record was not authenticated by the projector");
  }
}

export function assertProjectedExactShardsRevocationV1(
  value: ExactShardsRevocationRecordV1,
): void {
  if (!PROJECTED_REVOCATION_RECORDS.has(value)) {
    throw new TypeError("ExactShards revocation was not authenticated by the projector");
  }
}

export function createExactShardsSuccessorPublicReadHandlersV1(input: Readonly<{
  descriptor: unknown;
  publicationAuthorized: boolean;
  store: ExactShardsSuccessorPublicReadStoreV1;
}>) {
  const descriptor = parseExactShardsSuccessorDescriptorV1(input.descriptor);
  if (typeof input.publicationAuthorized !== "boolean"
    || input.store === null || typeof input.store !== "object"
    || input.store.sourceLane !== "registry.exact-shards-v2"
    || typeof input.store.findByWebsiteProjectId !== "function"
    || typeof input.store.findPublic !== "function") {
    throw new TypeError("ExactShards public read dependencies are invalid");
  }
  const unavailable = () => jsonResponse(503, {
    schemaVersion: "programmable.exact-shards-public-error.v1",
    code: "exact_shards_not_activated",
    message: "exact_shards_not_activated",
  });
  return Object.freeze({
    async feed(request: Request): Promise<Response> {
      if (!validReadRequest(request)) {
        return jsonResponse(400, {
          schemaVersion: "programmable.exact-shards-public-error.v1",
          code: "invalid_exact_shards_feed_request",
          message: "invalid_exact_shards_feed_request",
        });
      }
      // A bound deployment descriptor is necessary but never sufficient.
      // Publication requires a separate, explicit release authorization.
      if (descriptor.status !== "bound" || !input.publicationAuthorized) {
        return unavailable();
      }
      try {
        const records = await input.store.findPublic({ signal: request.signal });
        if (!Array.isArray(records)) {
          throw new TypeError("ExactShards public feed is invalid");
        }
        for (const record of records) {
          validateExactShardsPublicRecordV1(record, descriptor);
        }
        return jsonResponse(200, {
          schemaVersion: "programmable.exact-shards-public-feed.v1",
          records,
        });
      } catch {
        return jsonResponse(503, {
          schemaVersion: "programmable.exact-shards-public-error.v1",
          code: "exact_shards_store_unavailable",
          message: "exact_shards_store_unavailable",
        });
      }
    },
    async detail(request: Request, projectId: string): Promise<Response> {
      if (!validReadRequest(request) || !SHA256.test(projectId)) {
        return jsonResponse(400, {
          schemaVersion: "programmable.exact-shards-public-error.v1",
          code: "invalid_exact_shards_detail_request",
          message: "invalid_exact_shards_detail_request",
        });
      }
      if (descriptor.status !== "bound" || !input.publicationAuthorized) {
        return unavailable();
      }
      try {
        const record = await input.store.findByWebsiteProjectId({
          projectId: projectId as `sha256:${string}`,
          signal: request.signal,
        });
        if (record === null) {
          return jsonResponse(404, {
            schemaVersion: "programmable.exact-shards-public-error.v1",
            code: "exact_shards_not_found",
            message: "exact_shards_not_found",
          });
        }
        validateExactShardsPublicRecordV1(record, descriptor);
        if (record.publicIdentity.websiteProjectId !== projectId) {
          throw new TypeError("ExactShards public record is not current finalized revision 1");
        }
        return jsonResponse(200, {
          schemaVersion: "programmable.exact-shards-public-view.v1",
          record,
        });
      } catch {
        return jsonResponse(503, {
          schemaVersion: "programmable.exact-shards-public-error.v1",
          code: "exact_shards_store_unavailable",
          message: "exact_shards_store_unavailable",
        });
      }
    },
  });
}

/**
 * Small deterministic fold used by the successor indexer and Website read
 * path. Finalized is the only public state. A canonical revocation is terminal;
 * orphaning its block restores the preceding finalized record, while orphaning
 * either launch/finality anchor removes publication.
 */
export class ExactShardsSuccessorProjectionLedgerV1 {
  readonly #entries = new Map<string, Array<Readonly<{
    kind: "finalized" | "revoked";
    anchorBlockHashes: readonly Hex[];
    record: ExactShardsPublicRecordV1 | ExactShardsRevocationRecordV1;
  }>>>();
  readonly #orphanedBlocks = new Set<Hex>();

  applyFinalized(record: ExactShardsPublicRecordV1): ExactShardsPublicProjectionV1 {
    assertProjectedFinalizedExactShardsRecordV1(record);
    const launchId = record.publicIdentity.registryLaunchId;
    const current = this.read(launchId);
    if (current.state === "revoked") {
      throw new TypeError("terminal ExactShards revocation cannot be refinalized");
    }
    const entries = this.#entries.get(launchId) ?? [];
    const existing = entries.find((entry) => entry.kind === "finalized"
      && (entry.record as ExactShardsPublicRecordV1).recordBindingSha256
        === record.recordBindingSha256);
    if (existing === undefined) {
      entries.push(Object.freeze({
        kind: "finalized" as const,
        anchorBlockHashes: Object.freeze([
          record.launch.blockHash,
          record.finality.finalizedBlockHash,
        ]),
        record,
      }));
      this.#entries.set(launchId, entries);
    }
    return this.read(launchId);
  }

  applyRevocation(record: ExactShardsRevocationRecordV1): ExactShardsPublicProjectionV1 {
    assertProjectedExactShardsRevocationV1(record);
    const current = this.read(record.launchId);
    if (current.state !== "finalized" || current.record === null
      || current.record.launch.registeredRecordCommitment !== record.latestRecordHash
      || record.latestRecordRevision !== "1") {
      throw new TypeError("ExactShards revocation does not terminate the current revision 1");
    }
    const entries = this.#entries.get(record.launchId) ?? [];
    entries.push(Object.freeze({
      kind: "revoked" as const,
      anchorBlockHashes: Object.freeze([record.blockHash]),
      record,
    }));
    this.#entries.set(record.launchId, entries);
    return this.read(record.launchId);
  }

  rollbackCanonicalBlock(blockHash: Hex): void {
    this.#orphanedBlocks.add(hex32(blockHash, "orphaned block hash"));
  }

  read(launchId: Hex): ExactShardsPublicProjectionV1 {
    const entries = this.#entries.get(hex32(launchId, "projection launch ID")) ?? [];
    const canonical = entries.filter(({ anchorBlockHashes }) =>
      anchorBlockHashes.every((hash) => !this.#orphanedBlocks.has(hash)));
    const latest = canonical.at(-1);
    if (latest === undefined) {
      return Object.freeze({
        state: entries.length === 0 ? "absent" as const : "reorged" as const,
        record: null,
      });
    }
    if (latest.kind === "revoked") {
      return Object.freeze({ state: "revoked" as const, record: null });
    }
    return Object.freeze({
      state: "finalized" as const,
      record: latest.record as ExactShardsPublicRecordV1,
    });
  }
}

type DecodedEvent = Readonly<{
  args: Record<string, unknown>;
  logIndex: number;
}>;

function decodeLaunchReceipt(
  descriptor: BoundExactShardsSuccessorDescriptorV1,
  receipt: ExactShardsReceiptV1,
) {
  const permit = decodeSingleEvent(
    receipt,
    descriptor.contracts.permitAuthority.address,
    exactShardsAuthorityConsumerAbiV1,
    "LaunchPermitConsumedV1",
  );
  const lineage = decodeSingleEvent(
    receipt,
    descriptor.contracts.permitAuthority.address,
    exactShardsAuthorityConsumerAbiV1,
    "RepositoryLineageConsumedV1",
  );
  const policy = decodeSingleEvent(
    receipt,
    descriptor.contracts.registry.address,
    exactShardsRegistryConsumerAbiV1,
    "ExactShardsFeePolicyBoundV1",
  );
  const claims = decodeEvents(
    receipt,
    descriptor.contracts.registry.address,
    exactShardsRegistryConsumerAbiV1,
    "ExactShardsFeeClaimBoundV1",
  );
  if (claims.length !== 3) {
    throw new TypeError("ExactShards launch receipt must bind exactly three fee claims");
  }
  const registered = decodeSingleEvent(
    receipt,
    descriptor.contracts.registry.address,
    exactShardsRegistryConsumerAbiV1,
    "ExactShardsLaunchRegisteredV1",
  );
  const publicIdentity = decodeSingleEvent(
    receipt,
    descriptor.contracts.registry.address,
    exactShardsRegistryConsumerAbiV1,
    "ExactShardsPublicIdentityBoundV1",
  );
  const completed = decodeSingleEvent(
    receipt,
    descriptor.contracts.route.address,
    exactShardsRouteConsumerAbiV1,
    "ExactShardsAtomicLaunchCompletedV1",
  );
  const metadata = decodeSingleEvent(
    receipt,
    descriptor.contracts.route.address,
    exactShardsRouteConsumerAbiV1,
    "ExactShardsLaunchMetadataBoundV1",
  );
  const order = [permit, lineage, policy, ...claims.slice().sort(
    (left, right) => Number(left.args.ordinal) - Number(right.args.ordinal),
  ), registered, publicIdentity, completed, metadata].map(({ logIndex }) => logIndex);
  if (order.some((value, index) => index > 0 && value <= order[index - 1]!)) {
    throw new TypeError("ExactShards launch receipt event order is invalid");
  }
  return { permit, lineage, policy, claims, registered, publicIdentity, completed, metadata };
}

function correlateLaunch(
  descriptor: BoundExactShardsSuccessorDescriptorV1,
  observation: ExactShardsAuthenticatedRpcObservationV1,
  permit: Record<string, unknown>,
  registration: Record<string, unknown>,
  events: ReturnType<typeof decodeLaunchReceipt>,
  finality: Record<string, unknown>,
  finalityLogIndex: number,
): void {
  const launchId = hex32(registration.launchId, "launch ID");
  const projectId = hex32(registration.projectId, "project ID");
  const approvalId = hex32(registration.approvalId, "approval ID");
  const recordHash = hex32(
    registration.registeredRecordCommitment,
    "registered record commitment",
  );
  const feePolicyHash = hex32(events.policy.args.policyHash, "fee policy hash");
  const feePolicyRecordHash = hex32(
    events.policy.args.feePolicyRecordHash,
    "fee policy record hash",
  );
  const state = observation.snapshot.launchState;
  const registrationLegs = registration.orderedFeeLegs;
  if (!Array.isArray(registrationLegs) || registrationLegs.length !== 3) {
    throw new TypeError("ExactShards registration fee legs are invalid");
  }
  const feePolicy = object(registration.feePolicy, "registration fee policy");
  const canonicalIdentities = deriveExactShardsCanonicalIdentitiesV1({
    websiteProjectIdSha256: hex32(
      registration.websiteProjectIdSha256,
      "Website project ID",
    ),
    websiteLaunchIdSha256: hex32(
      registration.websiteLaunchIdSha256,
      "Website launch ID",
    ),
    githubRepositoryId: number(
      registration.githubRepositoryId,
      "GitHub repository ID",
    ),
    approvalGeneration: number(
      registration.approvalGeneration,
      "approval generation",
    ),
    approvalBindingHash: hex32(
      registration.approvalBindingHash,
      "approval binding hash",
    ),
    chainId: number(registration.chainId, "registration chain ID"),
    registry: descriptor.contracts.registry.address,
    registryGeneration: number(
      registration.registryGeneration,
      "registry generation",
    ),
    primaryContract: address(
      registration.primaryContract,
      "registration primary contract",
    ),
  });
  const checks: readonly boolean[] = [
    projectId === canonicalIdentities.projectId,
    approvalId === canonicalIdentities.approvalId,
    launchId === canonicalIdentities.launchId,
    permit.repositoryKey === canonicalIdentities.repositoryKey,
    events.permit.args.launchId === launchId,
    events.permit.args.repositoryKey === permit.repositoryKey,
    address(events.permit.args.route, "permit event route")
      === descriptor.contracts.route.address,
    events.permit.args.routeId === EXACT_SHARDS_ROUTE_ID,
    address(events.permit.args.applicantWallet, "permit event wallet")
      === address(registration.launchWallet, "registration wallet"),
    events.lineage.args.repositoryKey === permit.repositoryKey,
    events.lineage.args.launchId === launchId,
    events.lineage.args.githubRepositoryId === registration.githubRepositoryId,
    events.registered.args.launchId === launchId,
    events.registered.args.projectId === projectId,
    address(events.registered.args.primaryContract, "registered primary contract")
      === address(registration.primaryContract, "registration primary contract"),
    events.registered.args.approvalId === approvalId,
    events.registered.args.deploymentId === registration.deploymentId,
    events.registered.args.registeredRecordCommitment === recordHash,
    events.registered.args.feePolicyHash === feePolicyHash,
    events.registered.args.feePolicyRecordHash === feePolicyRecordHash,
    events.publicIdentity.args.launchId === launchId,
    events.publicIdentity.args.websiteProjectIdSha256 === registration.websiteProjectIdSha256,
    events.publicIdentity.args.websiteLaunchIdSha256 === registration.websiteLaunchIdSha256,
    events.publicIdentity.args.identityMappingHash
      === canonicalIdentities.identityMappingHash,
    events.completed.args.launchId === launchId,
    events.completed.args.repositoryKey === permit.repositoryKey,
    address(events.completed.args.shard, "completed shard")
      === address(registration.primaryContract, "registration primary contract"),
    events.metadata.args.launchId === launchId,
    events.metadata.args.tokenNameHash === registration.tokenNameHash,
    events.metadata.args.tokenSymbolHash === registration.tokenSymbolHash,
    events.metadata.args.presentationBindingHash === registration.presentationBindingHash,
    events.policy.args.launchId === launchId,
    events.policy.args.profileKey === feePolicy.profileKey,
    address(events.policy.args.feeAsset, "policy event fee asset", true)
      === address(feePolicy.feeAsset, "registration fee asset", true),
    events.policy.args.feeBasisHash === feePolicy.feeBasisHash,
    events.policy.args.totalFeeBps === 100,
    events.policy.args.legsHash === feePolicy.legsHash,
    finality.launchId === launchId,
    finality.observedTransactionHash === observation.launchTransaction.hash,
    finality.observedBlockNumber === observation.launchReceipt.blockNumber,
    finality.observedBlockHash === observation.launchReceipt.blockHash,
    finality.observedTransactionIndex === observation.launchReceipt.transactionIndex,
    finality.observedLogIndex === events.registered.logIndex,
    finality.finalityPolicyHash === registration.finalityPolicyHash,
    finality.finalizedAtBlock === observation.finalizationReceipt.blockNumber,
    finalityLogIndex >= 0,
    state.status === 2,
    state.observedAtBlock === observation.launchReceipt.blockNumber,
    state.finalizedAtBlock === observation.finalizationReceipt.blockNumber,
    state.latestRecordRevision === 1n,
    state.latestRecordHash === recordHash,
    state.identityHash === events.registered.args.identityHash,
    state.feePolicyHash === feePolicyHash,
    state.feePolicyRecordHash === feePolicyRecordHash,
    state.finalityEvidenceHash === finality.finalityEvidenceHash,
    observation.snapshot.publicIdentity.websiteProjectIdSha256
      === registration.websiteProjectIdSha256,
    observation.snapshot.publicIdentity.websiteLaunchIdSha256
      === registration.websiteLaunchIdSha256,
    observation.snapshot.publicIdentity.identityMappingHash
      === events.publicIdentity.args.identityMappingHash,
    observation.snapshot.recordHashAtRevision1 === recordHash,
    observation.snapshot.recordHashAtRevision2 === ZERO_HASH,
    observation.snapshot.primaryRuntimeCodeHash === registration.primaryRuntimeCodeHash,
    observation.snapshot.primaryRuntimeCodeHash !== ZERO_HASH,
    observation.snapshot.hookRuntimeCodeHash !== ZERO_HASH,
    observation.snapshot.nftRuntimeCodeHash !== ZERO_HASH,
    observation.snapshot.blockNumber >= observation.finalizationReceipt.blockNumber,
    number(finality.confirmedHeadBlockNumber, "confirmed head")
      >= observation.launchReceipt.blockNumber + BigInt(descriptor.minimumConfirmations),
  ];
  if (checks.some((valid) => !valid)) {
    throw new TypeError("ExactShards receipt, calldata, events and state do not bind");
  }
  const claims = events.claims.slice().sort(
    (left, right) => Number(left.args.ordinal) - Number(right.args.ordinal),
  );
  for (const [index, claim] of claims.entries()) {
    const leg = object(registrationLegs[index], `registration fee leg ${index}`);
    if (claim.args.ordinal !== index || claim.args.roleHash !== leg.roleHash
      || claim.args.grossVolumeFeeBps !== leg.feeBps
      || claim.args.initialRecipientOrAccumulator !== leg.recipient
      || claim.args.recipientModeHash !== leg.recipientModeHash
      || claim.args.launchId !== launchId) {
      throw new TypeError("ExactShards fee claim event and calldata disagree");
    }
  }
}

function validateObservation(
  descriptor: BoundExactShardsSuccessorDescriptorV1,
  observation: ExactShardsAuthenticatedRpcObservationV1,
): void {
  validateProvider(observation.provider);
  const { launchTransaction, launchReceipt, finalizationReceipt, snapshot } = observation;
  if (observation.chainId !== descriptor.chainId
    || launchTransaction.to !== descriptor.contracts.route.address
    || launchTransaction.hash !== launchReceipt.transactionHash
    || launchReceipt.blockNumber < descriptor.contracts.registry.startBlock
    || launchReceipt.blockNumber < descriptor.contracts.route.startBlock
    || launchReceipt.blockNumber < descriptor.contracts.permitAuthority.startBlock
    || finalizationReceipt.blockNumber < launchReceipt.blockNumber
    || snapshot.blockHash === ZERO_HASH
    || (snapshot.blockNumber === finalizationReceipt.blockNumber
      && snapshot.blockHash !== finalizationReceipt.blockHash)
    || snapshot.registryRuntimeCodeHash !== descriptor.contracts.registry.runtimeCodeHash
    || snapshot.routeRuntimeCodeHash !== descriptor.contracts.route.runtimeCodeHash
    || snapshot.permitAuthorityRuntimeCodeHash
      !== descriptor.contracts.permitAuthority.runtimeCodeHash) {
    throw new TypeError("ExactShards authenticated RPC observation is invalid");
  }
  validateReceipt(launchReceipt);
  validateReceipt(finalizationReceipt);
}

function validateReceipt(receipt: ExactShardsReceiptV1): void {
  hex32(receipt.transactionHash, "receipt transaction hash");
  hex32(receipt.blockHash, "receipt block hash");
  if (receipt.status !== "success" || receipt.blockNumber <= 0n
    || !nonnegativeUint32(receipt.transactionIndex)) {
    throw new TypeError("ExactShards receipt is invalid");
  }
  let prior = -1;
  for (const log of receipt.logs) {
    address(log.address, "log address");
    if (!nonnegativeUint32(log.logIndex) || log.logIndex <= prior
      || !Array.isArray(log.topics) || log.topics.length === 0) {
      throw new TypeError("ExactShards receipt log placement is invalid");
    }
    prior = log.logIndex;
    log.topics.forEach((topic) => hex32(topic, "log topic"));
    if (typeof log.data !== "string" || !/^0x(?:[0-9a-f]{2})*$/u.test(log.data)) {
      throw new TypeError("ExactShards receipt log data is invalid");
    }
  }
}

function decodeSingleEvent(
  receipt: ExactShardsReceiptV1,
  sourceAddress: Address,
  abi: readonly unknown[],
  eventName: string,
): DecodedEvent {
  const events = decodeEvents(receipt, sourceAddress, abi, eventName);
  if (events.length !== 1) {
    throw new TypeError(`ExactShards ${eventName} count is invalid`);
  }
  return events[0]!;
}

function decodeEvents(
  receipt: ExactShardsReceiptV1,
  sourceAddress: Address,
  abi: readonly unknown[],
  eventName: string,
): DecodedEvent[] {
  const decoded: DecodedEvent[] = [];
  for (const log of receipt.logs) {
    if (log.address !== sourceAddress) continue;
    try {
      const result = decodeEventLog({
        abi: abi as never,
        eventName: eventName as never,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
        strict: true,
      }) as unknown as { eventName: string; args: Record<string, unknown> };
      if (result.eventName === eventName) {
        decoded.push(Object.freeze({ args: result.args, logIndex: log.logIndex }));
      }
    } catch {
      // Other legitimate events from the exact contract are outside this projection.
    }
  }
  return decoded;
}

function requireBoundDescriptor(value: unknown): BoundExactShardsSuccessorDescriptorV1 {
  const descriptor = parseExactShardsSuccessorDescriptorV1(value);
  if (descriptor.status !== "bound") {
    throw new TypeError("ExactShards successor deployment is not bound");
  }
  return descriptor;
}

function parseContractDescriptor(
  value: unknown,
  expectedAbi: `sha256:${string}`,
  label: string,
): ExactShardsContractDescriptorV1 {
  const source = object(value, `ExactShards ${label} descriptor`);
  exactKeys(source, ["address", "consumerAbiSha256", "runtimeCodeHash", "startBlock"],
    `ExactShards ${label} descriptor`);
  const parsed = Object.freeze({
    address: address(source.address, `${label} address`),
    runtimeCodeHash: hex32(source.runtimeCodeHash, `${label} runtime code hash`),
    startBlock: positiveBigint(source.startBlock, `${label} start block`),
    consumerAbiSha256: digest(source.consumerAbiSha256, `${label} consumer ABI`),
  });
  if (parsed.address === ZERO_ADDRESS || parsed.runtimeCodeHash === ZERO_HASH
    || parsed.consumerAbiSha256 !== expectedAbi) {
    throw new TypeError(`ExactShards ${label} deployment binding is invalid`);
  }
  return parsed;
}

function publicContractDescriptor(
  descriptor: ExactShardsContractDescriptorV1,
) {
  return Object.freeze({
    address: descriptor.address,
    runtimeCodeHash: descriptor.runtimeCodeHash,
    startBlock: descriptor.startBlock.toString(),
    consumerAbiSha256: descriptor.consumerAbiSha256,
  });
}

function validateProvider(provider: ExactShardsAuthenticatedRpcObservationV1["provider"]): void {
  if (provider.authentication !== "authenticated-server-rpc-v1"
    || !PROVIDER_ID.test(provider.providerId)
    || !TRUST_DOMAIN.test(provider.trustDomain)) {
    throw new TypeError("ExactShards RPC provider authentication is invalid");
  }
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  if (Object.keys(value).sort().join("\0") !== [...expected].sort().join("\0")) {
    throw new TypeError(`${label} fields are invalid`);
  }
}

function hex32(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !HASH32.test(value)) {
    throw new TypeError(`${label} must be a lowercase bytes32`);
  }
  return value.toLowerCase() as Hex;
}

function hex(value: unknown, bytes: number, label: string): Hex {
  if (typeof value !== "string"
    || !new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`, "u").test(value)) {
    throw new TypeError(`${label} must be lowercase fixed bytes`);
  }
  return value.toLowerCase() as Hex;
}

function address(value: unknown, label: string, zeroAllowed = false): Address {
  if (typeof value !== "string" || !ADDRESS.test(value)
    || (!zeroAllowed && value === ZERO_ADDRESS)) {
    throw new TypeError(`${label} must be a lowercase address`);
  }
  return value.toLowerCase() as Address;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new TypeError(`${label} must be a SHA-256 digest`);
  }
  return value as `sha256:${string}`;
}

function rawSha256(value: unknown, label: string): `sha256:${string}` {
  return `sha256:${hex32(value, label).slice(2)}`;
}

function number(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  throw new TypeError(`${label} must be an unsigned integer`);
}

function positiveBigint(value: unknown, label: string): bigint {
  if (typeof value === "bigint" && value > 0n) return value;
  if (typeof value === "string" && /^[1-9][0-9]*$/u.test(value)) {
    return BigInt(value);
  }
  throw new TypeError(`${label} must be a positive integer`);
}

function positiveDecimal(value: unknown, label: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new TypeError(`${label} must be a positive decimal string`);
  }
  return BigInt(value);
}

function validPublicClaims(value: unknown, launchedHook: Address): boolean {
  if (!Array.isArray(value) || value.length !== 3) return false;
  const expected = [
    [0, "builder", BUILDER_ROLE_HASH, 10, 1000],
    [1, "programmable", PROGRAMMABLE_ROLE_HASH, 10, 1000],
    [2, "holder", HOLDER_ROLE_HASH, 80, 8000],
  ] as const;
  return value.every((candidate, index) => {
    const claim = object(candidate, `ExactShards public fee claim ${index}`);
    exactKeys(claim, [
      "claimSelector", "grossVolumeFeeBps", "handoffSelector", "legHash",
      "ordinal", "recipient", "recipientModeHash", "role", "roleHash",
      "shareOfFeeBps", "storedClaimHash",
    ], `ExactShards public fee claim ${index}`);
    const terms = expected[index]!;
    const recipient = address(claim.recipient, `claim ${index} recipient`);
    return claim.ordinal === terms[0]
      && claim.role === terms[1]
      && hex32(claim.roleHash, `claim ${index} role hash`) === terms[2]
      && claim.grossVolumeFeeBps === terms[3]
      && claim.shareOfFeeBps === terms[4]
      && (index !== 2 || recipient === launchedHook)
      && hex32(claim.recipientModeHash, `claim ${index} recipient mode`) !== ZERO_HASH
      && hex(claim.claimSelector, 4, `claim ${index} selector`) !== "0x00000000"
      && hex(claim.handoffSelector, 4, `claim ${index} handoff selector`).length === 10
      && hex32(claim.legHash, `claim ${index} leg hash`) !== ZERO_HASH
      && hex32(claim.storedClaimHash, `claim ${index} stored hash`) !== ZERO_HASH;
  });
}

function validProviderConsensus(providerIds: unknown, trustDomains: unknown): boolean {
  if (!Array.isArray(providerIds) || providerIds.length !== 2
    || !Array.isArray(trustDomains) || trustDomains.length !== 2) {
    return false;
  }
  return typeof providerIds[0] === "string"
    && typeof providerIds[1] === "string"
    && typeof trustDomains[0] === "string"
    && typeof trustDomains[1] === "string"
    && PROVIDER_ID.test(providerIds[0])
    && PROVIDER_ID.test(providerIds[1])
    && TRUST_DOMAIN.test(trustDomains[0])
    && TRUST_DOMAIN.test(trustDomains[1])
    && providerIds[0] !== providerIds[1]
    && trustDomains[0] !== trustDomains[1];
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeUint32(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
    && value >= 0 && value <= 0xffff_ffff;
}

function sha256Canonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function canonical(value: unknown, omitKeys: readonly string[] = []): string {
  const omit = new Set(omitKeys);
  const normalize = (candidate: unknown): unknown => {
    if (typeof candidate === "bigint") return candidate.toString();
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate !== null && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>)
          .filter(([key]) => !omit.has(key))
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested)]),
      );
    }
    return candidate;
  };
  return JSON.stringify(normalize(value));
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}

function validReadRequest(request: Request): boolean {
  if (request.method !== "GET" || request.body !== null
    || request.headers.has("content-type")
    || request.headers.get("accept")?.trim().toLowerCase() !== "application/json") {
    return false;
  }
  const url = new URL(request.url);
  return url.username === "" && url.password === ""
    && url.search === "" && url.hash === "";
}

function jsonResponse(status: number, body: Readonly<Record<string, unknown>>): Response {
  return new Response(canonical(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
