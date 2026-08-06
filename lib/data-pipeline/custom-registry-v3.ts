import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
} from "viem";
import Ajv from "ajv";

import { invalidInput, validationError } from "./errors";
import customLaunchRegistryRecordSchemaV3 from "../../schemas/custom-launch-registry-record-v3.schema.json";

export const CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3 =
  "programmable.custom-registry-deployments.v3" as const;
export const CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3 =
  "programmable.custom-launch-registry-record.v3" as const;
export const CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V3 =
  "programmable.custom-launch-projection-record.v3" as const;
export const CUSTOM_REGISTRY_PRODUCER_ENVELOPE_DOMAIN_V3 =
  "programmable.custom-launch-registry-envelope-digest.v3" as const;
export const CUSTOM_REGISTRY_REGISTERED_RECORD_COMMITMENT_DOMAIN_V1 =
  "programmable.custom-registered-record.v1" as const;
export const CUSTOM_REGISTRY_LAUNCH_IDENTITY_DOMAIN_V1 =
  "programmable.custom-launch-identity.v1" as const;
export const CUSTOM_REGISTRY_PUBLIC_FEE_POLICY_BINDING_DOMAIN_V3 =
  "programmable.custom-launch-public-fee-policy-binding.v3" as const;
export const CUSTOM_REGISTRY_VERIFIED_REVIEW_EVIDENCE_DOMAIN_V1 =
  "programmable.custom-launch-verified-review-evidence.v1" as const;
export const CUSTOM_REGISTRY_FINALITY_POLICY_DOMAIN_V1 =
  "programmable.custom-launch-finality-policy.v1" as const;
export const CUSTOM_REGISTRY_STRUCTURED_FIELD_DOMAINS_V1 = Object.freeze({
  approvalId: "programmable.custom-launch-registry-approval-id.v1",
  repositoryId: "programmable.custom-launch-registry-repository-id.v1",
  commitId: "programmable.custom-launch-registry-commit-id.v1",
  deploymentId: "programmable.custom-launch-registry-deployment-id.v1",
  runtimeCodeSetHash:
    "programmable.custom-launch-registry-runtime-code-set.v1",
  modelId: "programmable.custom-launch-registry-model-id.v1",
  modelVersion: "programmable.custom-launch-registry-model-version.v1",
  templateId: "programmable.custom-launch-registry-template-id.v1",
  templateVersion: "programmable.custom-launch-registry-template-version.v1",
  partnerId: "programmable.custom-launch-registry-partner-id.v1",
  builderAttributionHash:
    "programmable.custom-launch-registry-builder-attribution.v1",
  originHash: "programmable.custom-launch-registry-origin.v1",
  capabilitySetHash:
    "programmable.custom-launch-registry-capability-set.v1",
  reviewResultId:
    "programmable.custom-launch-registry-review-result-id.v1",
} as const);
export const CUSTOM_REGISTRY_FEED_SCHEMA_V1 =
  "programmable.custom-launch-registry-feed.v1" as const;
export const CUSTOM_REGISTRY_FEED_SOURCE_V3 =
  "programmable-custom-launch-registry-v3" as const;
export const PROGRAMMABLE_CUSTOM_LABEL = "Programmable Custom" as const;
export const PROGRAMMABLE_FEE_RECIPIENT =
  "0x4957f49620aff3adbbe8195a4f633e49cc93376c" as const;
export const CUSTOM_REGISTRY_ASSET_SET_SCHEMA_V2 =
  "programmable.discoverable-launch-asset-set.v2" as const;
export const CUSTOM_REGISTRY_ASSET_SET_HASH_DOMAIN_V2 =
  "programmable.discoverable-launch-asset-set-hash.v2" as const;
export const CUSTOM_REGISTRY_MARKET_SET_SCHEMA_V2 =
  "programmable.discoverable-launch-market-set.v2" as const;
export const CUSTOM_REGISTRY_MARKET_SET_HASH_DOMAIN_V2 =
  "programmable.discoverable-launch-market-set-hash.v2" as const;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BYTES32 = `0x${"0".repeat(64)}` as HexBytes32;

export type Sha256Digest = `sha256:${string}`;
export type HexAddress = `0x${string}`;
export type HexBytes32 = `0x${string}`;
/** EVM EXTCODEHASH / keccak256(runtime bytecode), never a SHA-256 digest. */
export type EvmRuntimeCodeHash = HexBytes32;
export type HexTransactionHash = `0x${string}`;
export type RegistryOperationV3 =
  | "registered"
  | "finalized"
  | "corrected"
  | "revoked";
export type RegistryRegistrationCompanionKindV3 =
  | "provenance"
  | "review"
  | "attribution"
  | "feePolicy"
  | "feeEvidence";
export type RegistryFinalityStatusV3 =
  | "observed"
  | "confirmed"
  | "finalized"
  | "orphaned";
export type CustomLaunchStatusV3 =
  | RegistryFinalityStatusV3
  | "corrected"
  | "revoked";

const ADDRESS = /^0x[0-9a-f]{40}$/iu;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const MAX_RECORD_BYTES = 512 * 1024;
const MAX_COLLECTION_SIZE = 256;
const CURSOR_DOMAIN = "programmable.custom-registry-cursor.v3\0";
const validateCustomRegistryProducerSchemaV3 = new Ajv({
  allErrors: true,
  strict: true,
}).compile(customLaunchRegistryRecordSchemaV3);

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type CustomRegistryDeploymentV3 = Readonly<{
  registryGeneration: string;
  address: HexAddress;
  runtimeCodeHash: HexBytes32;
  startBlock: string;
  status: "active" | "paused" | "retired";
  retiredAtBlock: string | null;
  authorizedApprovers: readonly HexAddress[];
  authorizedWriters: readonly HexAddress[];
  topics: Readonly<{
    approvalAuthorized: HexBytes32;
    registered: HexBytes32;
    provenance: HexBytes32;
    review: HexBytes32;
    attribution: HexBytes32;
    feePolicy: HexBytes32;
    feeEvidence: HexBytes32;
    finalized: HexBytes32;
    corrected: HexBytes32;
    revoked: HexBytes32;
  }>;
}>;

export type CustomRegistryChainManifestV3 = Readonly<{
  chainId: string;
  caip2: string;
  status: "prelaunch" | "active" | "paused" | "retired";
  publicSubmissionsEnabled: boolean;
  confirmationDepth: string;
  finalityDepth: string;
  registries: readonly CustomRegistryDeploymentV3[];
}>;

export type CustomRegistryDeploymentManifestV3 = Readonly<{
  schemaVersion: typeof CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3;
  platformId: "programmable";
  category: "custom";
  publicLabel: typeof PROGRAMMABLE_CUSTOM_LABEL;
  chains: readonly CustomRegistryChainManifestV3[];
}>;

export type CustomLaunchAssetV3 = Readonly<{
  assetId: string;
  role: string;
  kind: string;
  address: HexAddress | null;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  supply: Readonly<{
    status: "fixed" | "dynamic" | "unknown" | "not-applicable";
    totalRaw: string | null;
    observedAtBlock: string | null;
  }>;
  provenance: Readonly<{
    kind: "launch-produced" | "adopted-external" | "unknown";
    runtimeCodeHash: HexBytes32 | null;
    evidenceHash: Sha256Digest;
  }>;
  onchainMetadata: Readonly<Record<string, JsonValue>>;
  creatorMetadata: Readonly<Record<string, JsonValue>>;
}>;

export type CustomLaunchMarketV3 = Readonly<{
  marketId: string;
  kind: string;
  lifecycle: "planned" | "active" | "paused" | "retired" | "unknown";
  baseAssetId: string | null;
  quoteAssetId: string | null;
  marketContract: HexAddress | null;
  poolId: HexBytes32 | null;
  poolAddress: HexAddress | null;
  hookAddress: HexAddress | null;
  poolManagerAddress: HexAddress | null;
  tickSpacing: number | null;
  dynamicFee: boolean | null;
  support: Readonly<{
    charting: "supported" | "unsupported" | "unknown";
    quote: "supported" | "unsupported" | "unknown";
    simulation: "supported" | "unsupported" | "unknown";
    execution: "supported" | "unsupported" | "unknown";
  }>;
  adapter: Readonly<{ id: string; version: string }> | null;
  metrics: Readonly<{
    price: "available" | "unavailable" | "unknown";
    liquidity: "available" | "unavailable" | "unknown";
    volume: "available" | "unavailable" | "unknown";
    updatedAt: string | null;
  }>;
  evidenceHash: Sha256Digest;
}>;

type CustomLaunchFeePolicyCommonV3 = Readonly<{
  schemaVersion: "programmable.custom-launch-fee-policy.v3";
  programmableRecipient: NamespacedEvmIdentityV3;
  totalFeeBps: number;
  programmableShareBps: number;
  partnerShareBps: number;
  partnerRecipient: NamespacedEvmIdentityV3 | null;
  chargeMode:
    | "verified-official-market-path-only"
    | "template-native-verified-market-path"
    | "none-no-qualifying-market";
  basis: string | null;
  currency: string | null;
  accrual: string | null;
  claim: string | null;
  rounding: string | null;
  claimRights: Readonly<{
    programmable: string | null;
    partner: string | null;
    independentlyClaimable: boolean;
    crossPartyClaimingProhibited: boolean;
    evidenceHash: Sha256Digest;
  }>;
  verifiedMarketIds: readonly string[];
  normalProgrammableTenBpsApplied: boolean;
  verificationStatus: "verified" | "not_applicable";
  verificationAuthorityHash: Sha256Digest;
  verificationEvidenceHash: Sha256Digest;
  recipientControlEvidenceHash: Sha256Digest;
  claimIsolationEvidenceHash: Sha256Digest;
  verifiedAt: string;
  publicPolicyBindingHash: Sha256Digest;
}>;

export type CustomLaunchFeePolicyV3 =
  | (CustomLaunchFeePolicyCommonV3 & Readonly<{
      mode: "native";
      totalFeeBps: 10;
      programmableShareBps: 10;
      partnerShareBps: 0;
      partnerRecipient: null;
      chargeMode: "verified-official-market-path-only";
      normalProgrammableTenBpsApplied: true;
      verificationStatus: "verified";
    }>)
  | (CustomLaunchFeePolicyCommonV3 & Readonly<{
      mode: "partner-template";
      totalFeeBps: 20;
      programmableShareBps: 5;
      partnerShareBps: 15;
      partnerRecipient: NamespacedEvmIdentityV3;
      chargeMode: "template-native-verified-market-path";
      normalProgrammableTenBpsApplied: false;
      verificationStatus: "verified";
    }>)
  | (CustomLaunchFeePolicyCommonV3 & Readonly<{
      mode: "no-qualifying-market";
      totalFeeBps: 0;
      programmableShareBps: 0;
      partnerShareBps: 0;
      partnerRecipient: null;
      chargeMode: "none-no-qualifying-market";
      basis: null;
      currency: null;
      accrual: null;
      claim: null;
      rounding: null;
      normalProgrammableTenBpsApplied: false;
      verificationStatus: "not_applicable";
    }>);

export type CustomLaunchSecurityReviewV3 = Readonly<{
  status: "not-reviewed" | "reviewed" | "superseded" | "revoked";
  policyVersion: string;
  policyCommitment: Sha256Digest;
  repositoryUri: string;
  commitObjectId: string;
  sourceCommitment: Sha256Digest;
  buildCommitment: Sha256Digest;
  artifactSetHash: Sha256Digest;
  runtimeCodeHashes: readonly HexBytes32[];
  configurationCommitment: Sha256Digest;
  authorities: readonly Readonly<Record<string, JsonValue>>[];
  upgradeability: Readonly<Record<string, JsonValue>>;
  pause: Readonly<Record<string, JsonValue>>;
  custody: Readonly<Record<string, JsonValue>>;
  dependencies: readonly Readonly<Record<string, JsonValue>>[];
  findings: readonly Readonly<Record<string, JsonValue>>[];
  reviewedAt: string | null;
  reviewerType: string;
  deploymentBindingHash: Sha256Digest;
  supersededBy: Sha256Digest | null;
  revokedAt: string | null;
  revocationEvidenceHash: Sha256Digest | null;
}>;

export type NamespacedEvmIdentityV3 = Readonly<{
  namespace: "eip155-address";
  value: HexAddress;
}>;

export type CustomLaunchRegisteredRecordPreimageV1 = Readonly<{
  chainId: string;
  registryGeneration: string;
  launchId: HexBytes32;
  projectId: HexBytes32;
  approvalId: HexBytes32;
  approvalBindingHash: HexBytes32;
  repositoryId: HexBytes32;
  commitId: HexBytes32;
  sourceCommitment: HexBytes32;
  buildCommitment: HexBytes32;
  artifactSetHash: HexBytes32;
  deploymentConfigurationHash: HexBytes32;
  deploymentId: HexBytes32;
  deploymentSetHash: HexBytes32;
  runtimeCodeSetHash: HexBytes32;
  primaryContract: HexAddress;
  primaryRuntimeCodeHash: HexBytes32;
  launchWallet: HexAddress;
  modelId: HexBytes32;
  modelVersion: HexBytes32;
  templateId: HexBytes32;
  templateVersion: HexBytes32;
  partnerId: HexBytes32;
  builderAttributionHash: HexBytes32;
  originHash: HexBytes32;
  assetSetHash: HexBytes32;
  marketSetHash: HexBytes32;
  capabilitySetHash: HexBytes32;
  reviewPolicyHash: HexBytes32;
  securityReviewHash: HexBytes32;
  reviewResultId: HexBytes32;
  reviewDeploymentBindingHash: HexBytes32;
  feePolicyHash: HexBytes32;
  finalityPolicyHash: HexBytes32;
}>;

export type CustomLaunchRegisteredRecordComponentHashesV1 = Readonly<{
  scopeAndApprovalHash: HexBytes32;
  sourceAndDeploymentHash: HexBytes32;
  attributionHash: HexBytes32;
  reviewHash: HexBytes32;
  feePolicyHash: HexBytes32;
  finalityPolicyHash: HexBytes32;
}>;

export type CustomLaunchOnchainFeeLegV1 = Readonly<{
  shareBps: number;
  recipient: HexAddress;
  currency: HexAddress;
  chargeModeId: HexBytes32;
  basisId: HexBytes32;
  roundingId: HexBytes32;
  accrualId: HexBytes32;
  claimId: HexBytes32;
  claimRightId: HexBytes32;
  controlEvidenceHash: HexBytes32;
}>;

export type CustomLaunchOnchainFeePolicyV1 = Readonly<{
  kind: 0 | 1 | 2;
  partnerId: HexBytes32;
  partnerStatusId: HexBytes32;
  templateId: HexBytes32;
  templateVersion: HexBytes32;
  partnerRepositoryId: HexBytes32;
  partnerCommitId: HexBytes32;
  partnerRuntimeCodeSetHash: HexBytes32;
  totalFeeBps: number;
  nativeCustomFeeBps: number;
  partner: CustomLaunchOnchainFeeLegV1;
  programmable: CustomLaunchOnchainFeeLegV1;
  activationVersion: HexBytes32;
  activationBlock: string;
  paused: boolean;
  retired: boolean;
  publicPolicyBindingHash: HexBytes32;
  claimIsolationEvidenceHash: HexBytes32;
  accountingSafetyEvidenceHash: HexBytes32;
  verificationEvidenceHash: HexBytes32;
}>;

export type CustomLaunchProducerModelV3 = Readonly<{
  id: string;
  version: string;
}>;

export type CustomLaunchProducerTemplateV3 = Readonly<{
  id: string;
  version: string;
  partnerId: string | null;
  repositoryId: string;
  repositoryUri: string;
  commitObjectId: string;
  treeObjectId: string;
  sourceCommitment: Sha256Digest;
  buildCommitment: Sha256Digest;
  artifactSetHash: Sha256Digest;
  runtimeCodeKeccak256: readonly HexBytes32[];
  runtimeCodeSha256: readonly Sha256Digest[];
  verificationEvidenceHash: Sha256Digest;
}>;

export type CustomLaunchProducerPartnerV3 = Readonly<{
  id: string;
  name: string;
  status: "active" | "paused" | "retired";
  recipient: NamespacedEvmIdentityV3;
  chainId: string;
  templateId: string;
  templateVersion: string;
  templateBindingHash: Sha256Digest;
  recipientVerificationEvidenceHash: Sha256Digest;
  activationVersion: string;
  activationBlock: string;
}>;

export type CustomLaunchProducerApprovalBindingV3 = Readonly<{
  applicationId: string;
  projectId: Sha256Digest;
  approvalId: string;
  grantId: string;
  grantBindingHash: Sha256Digest;
  approvalBindingHash: Sha256Digest;
  decisionReceiptDigest: Sha256Digest;
  reviewAuthorityKind: "manual_review" | "autonomous_ai";
  chainId: string;
  caip2: string;
  chainProfileId: string;
  repositoryId: string;
  repositoryUri: string;
  commitObjectId: string;
  treeObjectId: string;
  sourceCommitment: Sha256Digest;
  buildCommitment: Sha256Digest;
  artifactSetHash: Sha256Digest;
  configurationCommitment: Sha256Digest;
  launchWalletBindingHash: Sha256Digest;
  chainProfileHash: Sha256Digest;
  policyVersion: string;
  policyCommitment: Sha256Digest;
  approvedAt: string;
}>;

export type CustomLaunchProducerDeployedContractV3 = Readonly<{
  address: NamespacedEvmIdentityV3;
  role: string;
  creationCodeHash: Sha256Digest;
  runtimeCodeKeccak256: HexBytes32;
  runtimeCodeSha256: Sha256Digest;
  artifactHash: Sha256Digest;
  configurationCommitment: Sha256Digest;
  runtimeVerificationEvidenceHash: Sha256Digest;
}>;

export type CustomLaunchProducerDeploymentBindingV3 = Readonly<{
  chainId: string;
  caip2: string;
  launchArtifactCommitmentHash: Sha256Digest;
  artifactManifestHash: Sha256Digest;
  artifactOutputSetHash: Sha256Digest;
  deploymentCalldataHash: Sha256Digest;
  launchWalletBindingHash: Sha256Digest;
  chainProfileHash: Sha256Digest;
  contracts: readonly CustomLaunchProducerDeployedContractV3[];
  contractSetHash: Sha256Digest;
  runtimeMatch: "exact";
  verificationEvidenceHash: Sha256Digest;
}>;

export type CustomLaunchProducerVerifiedReviewV1 = Readonly<{
  schemaVersion: "programmable.custom-launch-verified-review.v1";
  label: "Programmable Verified";
  definition: "Reviewed against the published Programmable security policy and cryptographically bound to the exact deployed contract revision.";
  status: "verified" | "superseded" | "revoked";
  policyVersion: string;
  policyCommitment: Sha256Digest;
  repositoryId: string;
  commitObjectId: string;
  sourceCommitment: Sha256Digest;
  buildCommitment: Sha256Digest;
  artifactSetHash: Sha256Digest;
  runtimeCodeKeccak256: readonly HexBytes32[];
  runtimeCodeSha256: readonly Sha256Digest[];
  configurationCommitment: Sha256Digest;
  authoritiesEvidenceHash: Sha256Digest;
  upgradeability: "immutable" | "proxy" | "modular" | "unknown";
  upgradeabilityEvidenceHash: Sha256Digest;
  pauseAuthority: "none" | "bounded" | "unbounded" | "unknown";
  pauseAuthorityEvidenceHash: Sha256Digest;
  custody: "none" | "bounded" | "unbounded" | "unknown";
  custodyEvidenceHash: Sha256Digest;
  dependencies: readonly JsonObject[];
  dependencySetHash: Sha256Digest;
  findings: readonly JsonObject[];
  findingSetHash: Sha256Digest;
  reviewerType: "programmable-internal" | "external-auditor" | "hybrid";
  reviewedAt: string;
  deploymentBindingHash: Sha256Digest;
  reviewEvidenceHash: Sha256Digest;
  supersededBy: Sha256Digest | null;
  revokedAt: string | null;
  revocationEvidenceHash: Sha256Digest | null;
}>;

export type CustomLaunchProducerAuthorityInventoryV3 = Readonly<{
  schemaVersion: "programmable.custom-launch-post-launch-authorities.v3";
  launchingWallet: NamespacedEvmIdentityV3;
  authorities: readonly JsonObject[];
  postLaunchAuthorityInventoryHash: Sha256Digest;
}>;

export type CustomLaunchProducerFinalityPolicyV1 = Readonly<{
  schemaVersion: "programmable.custom-launch-finality-policy.v1";
  confirmationDepth: number;
  canonicalitySource: "evm-blockhash";
  reorgHandling: "orphan";
  verificationAuthorityHash: Sha256Digest;
}>;

export type CustomLaunchProducerFinalityV3 = Readonly<{
  status: "observed" | "confirmed" | "finalized" | "orphaned";
  transactionHash: HexTransactionHash;
  blockHash: HexBytes32;
  blockNumber: string;
  transactionIndex: string;
  logIndex: string | null;
  onchainTimestamp: string;
  observedAt: string;
  confirmedAt: string | null;
  finalizedAt: string | null;
  orphanedAt: string | null;
  finalityEvidenceHash: Sha256Digest;
  verificationAuthorityHash: Sha256Digest;
}>;

export type CustomLaunchProducerLifecycleV3 = Readonly<{
  status: "pending" | "active" | "orphaned" | "superseded" | "revoked";
  registryGeneration: string;
  registeredAt: string;
  supersededBy: Sha256Digest | null;
  revokedAt: string | null;
  revocationEvidenceHash: Sha256Digest | null;
}>;

export type CustomLaunchRegistryProducerRecordV3 = Readonly<{
  schemaVersion: typeof CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3;
  platformId: "programmable";
  origin: "programmable";
  category: "custom";
  launchFamily: "custom";
  publicLabel: typeof PROGRAMMABLE_CUSTOM_LABEL;
  projectId: Sha256Digest;
  launchId: Sha256Digest;
  model: CustomLaunchProducerModelV3;
  template: CustomLaunchProducerTemplateV3 | null;
  partner: CustomLaunchProducerPartnerV3 | null;
  registeredRecordPreimage: CustomLaunchRegisteredRecordPreimageV1;
  registeredRecordComponentHashes: CustomLaunchRegisteredRecordComponentHashesV1;
  registeredRecordCommitment: HexBytes32;
  registrationBindingHash: HexBytes32;
  registryOrigin: Readonly<{
    chainId: string;
    caip2: string;
    registryAddress: HexAddress;
    registryStartBlock: string;
    registryGeneration: string;
    registryLaunchIdRaw: HexBytes32;
    launchIdEncoding: "sha256-digest-raw-bytes32";
    registryApprovalBindingHashRaw: HexBytes32;
    registrationBindingHashRaw: HexBytes32;
    registryEventSetHash: Sha256Digest;
    registrationTransactionHash: HexTransactionHash;
    registrationBlockHash: HexBytes32;
    registrationBlockNumber: string;
    registrationTransactionIndex: string;
    registrationLogIndex: string;
    registeredRecordHash: HexBytes32;
    registrationEvidenceHash: Sha256Digest;
  }>;
  approvalBinding: CustomLaunchProducerApprovalBindingV3;
  deploymentBinding: CustomLaunchProducerDeploymentBindingV3;
  verifiedReview: CustomLaunchProducerVerifiedReviewV1;
  feePolicy: CustomLaunchFeePolicyV3;
  onchainFeePolicy: CustomLaunchOnchainFeePolicyV1;
  launchingWallet: NamespacedEvmIdentityV3;
  postLaunchAuthorityInventory: CustomLaunchProducerAuthorityInventoryV3;
  postLaunchAuthorityInventoryHash: Sha256Digest;
  launchIdentity: NamespacedEvmIdentityV3;
  advertisesToken: boolean;
  discoverableAssets: readonly JsonObject[];
  assetIdentitySetHash: Sha256Digest;
  discoverableMarkets: readonly JsonObject[];
  marketSetHash: Sha256Digest;
  mechanisms: readonly Readonly<{
    id: string;
    version: string;
    status: "active" | "delayed" | "paused" | "retired" | "unknown";
    parameters: JsonValue;
    evidenceHashes: readonly Sha256Digest[];
  }>[];
  capabilities: readonly Readonly<{
    id: string;
    version: string;
    status: "supported" | "unsupported" | "unknown" | "not_applicable";
    parameters: JsonValue;
  }>[];
  finalityPolicy: CustomLaunchProducerFinalityPolicyV1;
  finality: CustomLaunchProducerFinalityV3;
  lifecycle: CustomLaunchProducerLifecycleV3;
  presentationVersion: string | null;
  presentationBindingHash: Sha256Digest | null;
  presentation: JsonObject | null;
  extensions: Readonly<Record<string, JsonValue>>;
  /** Mutable producer envelope digest; never the immutable on-chain record hash. */
  envelopeDigest: Sha256Digest;
}>;

export type CustomLaunchProjectionRecordV3 = Readonly<{
  schemaVersion: typeof CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V3;
  platformId: "programmable";
  category: "custom";
  publicLabel: typeof PROGRAMMABLE_CUSTOM_LABEL;
  launchId: Sha256Digest;
  projectId: Sha256Digest;
  chainId: string;
  caip2: string;
  model: Readonly<{ id: string; version: string | null }>;
  template: Readonly<{ id: string; version: string }> | null;
  partner: Readonly<{
    id: string;
    name: string;
    status: "active" | "paused" | "retired";
    recipient: HexAddress;
  }> | null;
  builderAttribution: Readonly<Record<string, JsonValue>>;
  origin: Readonly<{
    kind: "programmable-custom-registry-v3";
    registryLaunchIdRaw: HexBytes32;
    registryProjectIdRaw: HexBytes32;
    registryGeneration: string;
    registryAddress: HexAddress;
    registryRuntimeCodeHash: HexBytes32;
    registryWriter: HexAddress;
    operation: RegistryOperationV3;
    eventTopic0: HexBytes32;
    transactionHash: HexTransactionHash;
    blockNumber: string;
    blockHash: HexBytes32;
    transactionIndex: number;
    logIndex: number;
    onchainTimestamp: string;
    registeredRecordHash: HexBytes32;
    latestOnchainRecordHash: HexBytes32;
    previousOnchainRecordHash: HexBytes32 | null;
    eventBinding: Readonly<{
      registrationSequence: string | null;
      transitionSequence: string | null;
      recordRevision: string | null;
      primaryContract: HexAddress | null;
      approvalId: HexBytes32 | null;
      deploymentId: HexBytes32 | null;
      identityHash: HexBytes32 | null;
      observedAtBlock: string | null;
      observedTransactionHash: HexBytes32 | null;
      finalityEvidenceHash: HexBytes32 | null;
      confirmedHeadBlockNumber: string | null;
      confirmedHeadBlockHash: HexBytes32 | null;
      finalityPolicyHash: HexBytes32 | null;
      finalizedAtBlock: string | null;
      finalizedAtTimestamp: string | null;
      reasonCode: HexBytes32 | null;
      evidenceHash: HexBytes32 | null;
    }>;
  }>;
  rawProducerRecord: CustomLaunchRegistryProducerRecordV3;
  producerBinding: Readonly<{
    schemaVersion: typeof CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3;
    envelopeDigest: Sha256Digest;
    rawRecordHash: Sha256Digest;
  }>;
  approvalBinding: Readonly<{
    applicationId: string;
    projectId: Sha256Digest;
    approvalId: string;
    repositoryId: string;
    repositoryUri: string;
    commitObjectId: string;
    treeObjectId: string;
    sourceCommitment: Sha256Digest;
    buildCommitment: Sha256Digest;
    artifactSetHash: Sha256Digest;
    configurationCommitment: Sha256Digest;
    launchWalletBindingHash: Sha256Digest;
    chainProfileHash: Sha256Digest;
    decisionReceiptDigest: Sha256Digest;
  }>;
  deploymentBinding: Readonly<{
    launchArtifactCommitmentHash: Sha256Digest;
    artifactManifestHash: Sha256Digest;
    artifactOutputSetHash: Sha256Digest;
    deploymentCalldataHash: Sha256Digest;
    contracts: readonly Readonly<{
      address: HexAddress;
      runtimeCodeHash: HexBytes32;
      role: string;
    }>[];
    runtimeMatch: true;
    verificationEvidenceHash: Sha256Digest;
  }>;
  launch: Readonly<{
    creator: HexAddress | null;
    launchWallet: HexAddress;
    transactionHash: HexTransactionHash;
    blockNumber: string;
    blockHash: HexBytes32;
    transactionIndex: number;
    logIndex: number | null;
    onchainTimestamp: string;
  }>;
  assets: readonly CustomLaunchAssetV3[];
  markets: readonly CustomLaunchMarketV3[];
  capabilities: readonly Readonly<{
    id: string;
    version: string | null;
    status: "active" | "conditional" | "unsupported" | "unknown";
    parameters: Readonly<Record<string, JsonValue>>;
  }>[];
  mechanisms: readonly Readonly<{
    id: string;
    version: string | null;
    status: string;
    parameters: Readonly<Record<string, JsonValue>>;
  }>[];
  feePolicy: CustomLaunchFeePolicyV3;
  securityReview: CustomLaunchSecurityReviewV3;
  programmableVerified: boolean;
  presentation: Readonly<{
    description: string | null;
    image: string | null;
    website: string | null;
    x: string | null;
    telegram: string | null;
    discord: string | null;
    github: string | null;
    docs: string | null;
    extensions: Readonly<Record<string, JsonValue>>;
  }>;
  finality: Readonly<{
    status: "finalized";
    transactionHash: HexTransactionHash;
    blockHash: HexBytes32;
    blockNumber: string;
    transactionIndex: number;
    logIndex: number | null;
    onchainTimestamp: string;
    observedAt: string;
    confirmedAt: string;
    finalizedAt: string;
    orphanedAt: null;
    finalityEvidenceHash: Sha256Digest;
    verificationAuthorityHash: Sha256Digest;
  }>;
  registryFinality: Readonly<{
    status: RegistryFinalityStatusV3;
    observedAt: string;
    confirmedAt: string | null;
    finalizedAt: string | null;
    orphanedAt: string | null;
    canonicalHeadBlock: string;
    canonicalHeadHash: HexBytes32;
  }>;
  lifecycle: Readonly<{
    status: CustomLaunchStatusV3;
    registryGeneration: string;
    registeredAt: string;
    correctedAt: string | null;
    revokedAt: string | null;
    revocationEvidenceHash: Sha256Digest | null;
    supersedesProjectionDigest: Sha256Digest | null;
    supersededByProjectionDigest: Sha256Digest | null;
  }>;
}>;

export type CustomRegistryApprovalAuthorizationV3 = Readonly<{
  chainId: string;
  caip2: string;
  registryGeneration: string;
  registryAddress: HexAddress;
  observedRegistryRuntimeCodeHash: EvmRuntimeCodeHash;
  registryApprover: HexAddress;
  topic0: HexBytes32;
  transactionHash: HexTransactionHash;
  blockNumber: string;
  blockHash: HexBytes32;
  transactionIndex: number;
  logIndex: number;
  onchainTimestamp: string;
  approvalId: HexBytes32;
  registryLaunchIdRaw: HexBytes32;
  registryApprovalBindingHashRaw: HexBytes32;
  registrationBindingHash: HexBytes32;
  transitionSequence: string;
  validAfterBlock: string;
  expiresAtBlock: string;
  evidenceHash: HexBytes32;
}>;

export type CustomRegistryEventV3 = Readonly<{
  operation: RegistryOperationV3;
  chainId: string;
  caip2: string;
  registryGeneration: string;
  registryAddress: HexAddress;
  observedRegistryRuntimeCodeHash: HexBytes32;
  registryWriter: HexAddress;
  topic0: HexBytes32;
  registrationCompanions: readonly Readonly<{
    kind: RegistryRegistrationCompanionKindV3;
    topic0: HexBytes32;
    logIndex: number;
  }>[];
  transactionHash: HexTransactionHash;
  blockNumber: string;
  blockHash: HexBytes32;
  transactionIndex: number;
  logIndex: number;
  onchainTimestamp: string;
  /** Public SHA-256 IDs plus their exact raw bytes32 Registry encodings. */
  launchId: Sha256Digest;
  projectId: Sha256Digest;
  registryLaunchIdRaw: HexBytes32;
  registryProjectIdRaw: HexBytes32;
  /** Immutable recordHash from CustomLaunchRegisteredV1. */
  registeredRecordHash: HexBytes32;
  /** Current Registry record hash; changes only through a correction event. */
  latestOnchainRecordHash: HexBytes32;
  previousOnchainRecordHash: HexBytes32 | null;
  registrationSequence: string | null;
  transitionSequence: string | null;
  recordRevision: string | null;
  primaryContract: HexAddress | null;
  launchWallet: HexAddress | null;
  approvalId: HexBytes32 | null;
  deploymentId: HexBytes32 | null;
  identityHash: HexBytes32 | null;
  observedAtBlock: string | null;
  observedTransactionHash: HexBytes32 | null;
  finalityEvidenceHash: HexBytes32 | null;
  confirmedHeadBlockNumber: string | null;
  confirmedHeadBlockHash: HexBytes32 | null;
  finalityPolicyHash: HexBytes32 | null;
  finalizedAtBlock: string | null;
  finalizedAtTimestamp: string | null;
  reasonCode: HexBytes32 | null;
  evidenceHash: HexBytes32 | null;
  approvalAuthorization: CustomRegistryApprovalAuthorizationV3 | null;
  producerRecord: CustomLaunchRegistryProducerRecordV3 | null;
  record: Omit<
    CustomLaunchProjectionRecordV3,
    | "origin"
    | "rawProducerRecord"
    | "producerBinding"
    | "feePolicy"
    | "registryFinality"
    | "lifecycle"
    | "programmableVerified"
  > | null;
  revocationEvidenceHash: Sha256Digest | null;
}>;

export type CanonicalHeadV3 = Readonly<{
  chainId: string;
  blockNumber: string;
  blockHash: HexBytes32;
  observedAt: string;
  canonicalBlockHash(blockNumber: string): HexBytes32 | null;
}>;

export type CustomRegistryFeedItemV3 = Readonly<{
  generation: string;
  projectionKey: string;
  projectionDigest: Sha256Digest;
  record: CustomLaunchProjectionRecordV3;
}>;

export type CustomRegistryProjectionCheckpointV3 = Readonly<{
  schemaVersion: "programmable.custom-registry-projection-checkpoint.v3";
  manifestHash: Sha256Digest;
  highWaterGeneration: string;
  entries: readonly Readonly<{
    occurrenceId: string;
    eventDigest: Sha256Digest;
    event: CustomRegistryEventV3;
    item: CustomRegistryFeedItemV3;
  }>[];
}>;

export type CustomRegistryFeedPageV3 = Readonly<{
  schemaVersion: typeof CUSTOM_REGISTRY_FEED_SCHEMA_V1;
  source: Readonly<{
    sourceId: typeof CUSTOM_REGISTRY_FEED_SOURCE_V3;
    status: "ready";
    completeness: "complete";
    freshness: "current";
    checkedAt: string;
    latestAcceptedAt: string | null;
  }>;
  snapshot: Readonly<{
    highWaterGeneration: string;
    indexedAt: string;
  }>;
  items: readonly CustomRegistryFeedItemV3[];
  page: Readonly<{
    nextCursor: string | null;
    resumeCursor: string;
    hasMore: boolean;
  }>;
}>;

function fail(operation: string): never {
  throw invalidInput("config", operation);
}

function record(value: unknown, operation: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail(operation);
  }
  return value as Record<string, unknown>;
}

function array(
  value: unknown,
  operation: string,
  maximum = MAX_COLLECTION_SIZE,
): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    return fail(operation);
  }
  return value;
}

function text(value: unknown, operation: string, maximum = 4_096): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    CONTROL_OR_BIDI.test(value)
  ) {
    return fail(operation);
  }
  return value;
}

function optionalText(
  value: unknown,
  operation: string,
  maximum = 4_096,
): string | null {
  return value === null ? null : text(value, operation, maximum);
}

function safeId(value: unknown, operation: string): string {
  const parsed = text(value, operation, 256);
  if (!SAFE_ID.test(parsed)) return fail(operation);
  return parsed;
}

function decimal(value: unknown, operation: string, positive = false): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) return fail(operation);
  const parsed = BigInt(value);
  if ((positive && parsed === 0n) || parsed > 9_223_372_036_854_775_807n) {
    return fail(operation);
  }
  return parsed.toString();
}

function nullableDecimal(
  value: unknown,
  operation: string,
  positive = false,
): string | null {
  return value === null ? null : decimal(value, operation, positive);
}

function digest(value: unknown, operation: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) return fail(operation);
  return value as Sha256Digest;
}

function address(value: unknown, operation: string): HexAddress {
  if (typeof value !== "string" || !ADDRESS.test(value)) return fail(operation);
  return value.toLowerCase() as HexAddress;
}

function bytes32(value: unknown, operation: string): HexBytes32 {
  if (typeof value !== "string" || !BYTES32.test(value)) return fail(operation);
  return value as HexBytes32;
}

function safeInteger(value: unknown, operation: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail(operation);
  return value as number;
}

function uintNumber(value: unknown, bits: 8 | 16, operation: string): number {
  const parsed = safeInteger(value, operation);
  if (parsed >= 2 ** bits) return fail(operation);
  return parsed;
}

function booleanValue(value: unknown, operation: string): boolean {
  if (typeof value !== "boolean") return fail(operation);
  return value;
}

function instant(value: unknown, operation: string): string {
  const parsed = text(value, operation, 128);
  const date = new Date(parsed);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== parsed) {
    return fail(operation);
  }
  return parsed;
}

function exactHttpsUrl(value: unknown, operation: string): string {
  const parsed = text(value, operation, 2_048);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    return fail(operation);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost")
  ) {
    return fail(operation);
  }
  return url.href;
}

function optionalHttpsUrl(value: unknown, operation: string): string | null {
  return value === null ? null : exactHttpsUrl(value, operation);
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw validationError("config", "custom-json");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw validationError("config", "custom-json");
  }
  const source = value as Record<string, unknown>;
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(",")}}`;
}

function sha256(domain: string, value: unknown): Sha256Digest {
  const preimage = `${domain}\0${canonicalJson(value)}`;
  return `sha256:${createHash("sha256").update(preimage).digest("hex")}`;
}

function digestRawBytes32(value: Sha256Digest): HexBytes32 {
  return `0x${value.slice("sha256:".length)}`;
}

export function customRegistryRawProducerHashV3(
  recordValue: CustomLaunchRegistryProducerRecordV3,
): Sha256Digest {
  return sha256(CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3, recordValue);
}

export function customRegistryProducerEnvelopeDigestV3(
  recordValue: Omit<
    CustomLaunchRegistryProducerRecordV3,
    "schemaVersion" | "envelopeDigest"
  >,
): Sha256Digest {
  return sha256(CUSTOM_REGISTRY_PRODUCER_ENVELOPE_DOMAIN_V3, recordValue);
}

const REGISTERED_RECORD_DOMAIN_HASH_V1 = keccak256(
  stringToHex(CUSTOM_REGISTRY_REGISTERED_RECORD_COMMITMENT_DOMAIN_V1),
) as HexBytes32;
const LAUNCH_IDENTITY_DOMAIN_HASH_V1 = keccak256(
  stringToHex(CUSTOM_REGISTRY_LAUNCH_IDENTITY_DOMAIN_V1),
) as HexBytes32;

function keccakAbi(
  parameters: string,
  values: readonly unknown[],
): HexBytes32 {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters(parameters),
      values as never,
    ),
  ) as HexBytes32;
}

/** Independent mirror of ProgrammableCustomRegistryV1's abi.encode commitment. */
export function customRegistryRegisteredRecordBindingV1(
  value: CustomLaunchRegisteredRecordPreimageV1,
): Readonly<{
  componentHashes: CustomLaunchRegisteredRecordComponentHashesV1;
  registeredRecordCommitment: HexBytes32;
  registrationBindingHash: HexBytes32;
}> {
  const scopeAndApprovalHash = keccakAbi(
    "uint256 chainId, uint64 registryGeneration, bytes32 launchId, bytes32 projectId, bytes32 approvalId, bytes32 approvalBindingHash",
    [
      BigInt(value.chainId),
      BigInt(value.registryGeneration),
      value.launchId,
      value.projectId,
      value.approvalId,
      value.approvalBindingHash,
    ],
  );
  const sourceAndDeploymentHash = keccakAbi(
    "bytes32 repositoryId, bytes32 commitId, bytes32 sourceCommitment, bytes32 buildCommitment, bytes32 artifactSetHash, bytes32 deploymentConfigurationHash, bytes32 deploymentId, bytes32 deploymentSetHash, bytes32 runtimeCodeSetHash, address primaryContract, bytes32 primaryRuntimeCodeHash, address launchWallet",
    [
      value.repositoryId,
      value.commitId,
      value.sourceCommitment,
      value.buildCommitment,
      value.artifactSetHash,
      value.deploymentConfigurationHash,
      value.deploymentId,
      value.deploymentSetHash,
      value.runtimeCodeSetHash,
      value.primaryContract,
      value.primaryRuntimeCodeHash,
      value.launchWallet,
    ],
  );
  const attributionHash = keccakAbi(
    "bytes32 modelId, bytes32 modelVersion, bytes32 templateId, bytes32 templateVersion, bytes32 partnerId, bytes32 builderAttributionHash, bytes32 originHash, bytes32 assetSetHash, bytes32 marketSetHash, bytes32 capabilitySetHash",
    [
      value.modelId,
      value.modelVersion,
      value.templateId,
      value.templateVersion,
      value.partnerId,
      value.builderAttributionHash,
      value.originHash,
      value.assetSetHash,
      value.marketSetHash,
      value.capabilitySetHash,
    ],
  );
  const reviewHash = keccakAbi(
    "bytes32 reviewPolicyHash, bytes32 securityReviewHash, bytes32 reviewResultId, bytes32 reviewDeploymentBindingHash",
    [
      value.reviewPolicyHash,
      value.securityReviewHash,
      value.reviewResultId,
      value.reviewDeploymentBindingHash,
    ],
  );
  const componentHashes = Object.freeze({
    scopeAndApprovalHash,
    sourceAndDeploymentHash,
    attributionHash,
    reviewHash,
    feePolicyHash: value.feePolicyHash,
    finalityPolicyHash: value.finalityPolicyHash,
  });
  const registeredRecordCommitment =
    customRegistryRegisteredRecordCommitmentFromComponentsV1(componentHashes);
  return Object.freeze({
    componentHashes,
    registeredRecordCommitment,
    registrationBindingHash:
      customRegistryRegistrationBindingHashV1(registeredRecordCommitment),
  });
}

export function customRegistryRegistrationBindingHashV1(
  registeredRecordCommitment: HexBytes32,
): HexBytes32 {
  return keccakAbi(
    "bytes32 identityDomain, bytes32 registeredRecordCommitment",
    [LAUNCH_IDENTITY_DOMAIN_HASH_V1, registeredRecordCommitment],
  );
}

export function customRegistryRegisteredRecordCommitmentFromComponentsV1(
  value: CustomLaunchRegisteredRecordComponentHashesV1,
): HexBytes32 {
  return keccakAbi(
    "bytes32 recordDomain, bytes32 scopeAndApprovalHash, bytes32 sourceAndDeploymentHash, bytes32 attributionHash, bytes32 reviewHash, bytes32 feePolicyHash, bytes32 finalityPolicyHash",
    [
      REGISTERED_RECORD_DOMAIN_HASH_V1,
      value.scopeAndApprovalHash,
      value.sourceAndDeploymentHash,
      value.attributionHash,
      value.reviewHash,
      value.feePolicyHash,
      value.finalityPolicyHash,
    ],
  );
}

function customRegistryFeeLegHashV1(
  value: CustomLaunchOnchainFeeLegV1,
): HexBytes32 {
  return keccakAbi(
    "uint16 shareBps, address recipient, address currency, bytes32 chargeModeId, bytes32 basisId, bytes32 roundingId, bytes32 accrualId, bytes32 claimId, bytes32 claimRightId, bytes32 controlEvidenceHash",
    [
      value.shareBps,
      value.recipient,
      value.currency,
      value.chargeModeId,
      value.basisId,
      value.roundingId,
      value.accrualId,
      value.claimId,
      value.claimRightId,
      value.controlEvidenceHash,
    ],
  );
}

/** Independent mirror of ProgrammableCustomFeePolicyVerifierLibV1._hash. */
export function customRegistryOnchainFeePolicyHashV1(
  value: CustomLaunchOnchainFeePolicyV1,
): HexBytes32 {
  const attributionHash = keccakAbi(
    "uint8 kind, bytes32 partnerId, bytes32 partnerStatusId, bytes32 templateId, bytes32 templateVersion, bytes32 partnerRepositoryId, bytes32 partnerCommitId, bytes32 partnerRuntimeCodeSetHash",
    [
      value.kind,
      value.partnerId,
      value.partnerStatusId,
      value.templateId,
      value.templateVersion,
      value.partnerRepositoryId,
      value.partnerCommitId,
      value.partnerRuntimeCodeSetHash,
    ],
  );
  const economicsHash = keccakAbi(
    "uint16 totalFeeBps, uint16 nativeCustomFeeBps, bytes32 partnerLegHash, bytes32 programmableLegHash",
    [
      value.totalFeeBps,
      value.nativeCustomFeeBps,
      customRegistryFeeLegHashV1(value.partner),
      customRegistryFeeLegHashV1(value.programmable),
    ],
  );
  const lifecycleAndEvidenceHash = keccakAbi(
    "bytes32 activationVersion, uint64 activationBlock, bool paused, bool retired, bytes32 publicPolicyBindingHash, bytes32 claimIsolationEvidenceHash, bytes32 accountingSafetyEvidenceHash, bytes32 verificationEvidenceHash",
    [
      value.activationVersion,
      BigInt(value.activationBlock),
      value.paused,
      value.retired,
      value.publicPolicyBindingHash,
      value.claimIsolationEvidenceHash,
      value.accountingSafetyEvidenceHash,
      value.verificationEvidenceHash,
    ],
  );
  return keccakAbi(
    "bytes32 feePolicyDomain, bytes32 attributionHash, bytes32 economicsHash, bytes32 lifecycleAndEvidenceHash",
    [
      keccak256(stringToHex("programmable.custom-fee-policy.v1")),
      attributionHash,
      economicsHash,
      lifecycleAndEvidenceHash,
    ],
  );
}

export function customRegistryPublicFeePolicyBindingV3(
  value: unknown,
): Sha256Digest {
  const source = record(value, "custom-registry-public-fee-policy-binding");
  const {
    publicPolicyBindingHash: _publicPolicyBindingHash,
    verifiedAt: _verifiedAt,
    ...semanticPolicy
  } = source;
  void _publicPolicyBindingHash;
  void _verifiedAt;
  return sha256(
    CUSTOM_REGISTRY_PUBLIC_FEE_POLICY_BINDING_DOMAIN_V3,
    semanticPolicy,
  );
}

export function customRegistryVerifiedReviewEvidenceHashV1(
  value: unknown,
): Sha256Digest {
  const source = record(value, "custom-registry-verified-review-evidence");
  const {
    reviewEvidenceHash: _reviewEvidenceHash,
    status: _status,
    supersededBy: _supersededBy,
    revokedAt: _revokedAt,
    revocationEvidenceHash: _revocationEvidenceHash,
    ...immutableReview
  } = source;
  void _reviewEvidenceHash;
  void _status;
  void _supersededBy;
  void _revokedAt;
  void _revocationEvidenceHash;
  return sha256(
    CUSTOM_REGISTRY_VERIFIED_REVIEW_EVIDENCE_DOMAIN_V1,
    immutableReview,
  );
}

export function customRegistryStructuredFieldV1(
  field: keyof typeof CUSTOM_REGISTRY_STRUCTURED_FIELD_DOMAINS_V1,
  publicValue: unknown,
): HexBytes32 {
  assertJsonValue(publicValue, `custom-registry-structured-${field}`);
  return digestRawBytes32(
    sha256(CUSTOM_REGISTRY_STRUCTURED_FIELD_DOMAINS_V1[field], publicValue),
  );
}

export function customRegistryFinalityPolicyHashV1(
  value: unknown,
): HexBytes32 {
  assertJsonValue(value, "custom-registry-finality-policy-hash");
  return digestRawBytes32(
    sha256(CUSTOM_REGISTRY_FINALITY_POLICY_DOMAIN_V1, value),
  );
}

function canonicalProducerSet(
  value: unknown,
  idField: "assetId" | "marketId",
  maximum: number,
): readonly JsonObject[] {
  const seen = new Set<string>();
  const items = array(value, `custom-registry-producer-${idField}-set`, maximum)
    .map((item) => {
      const parsed = record(item, `custom-registry-producer-${idField}`);
      const id = safeId(
        parsed[idField],
        `custom-registry-producer-${idField}-id`,
      );
      if (seen.has(id)) {
        return fail(`custom-registry-producer-${idField}-duplicate`);
      }
      seen.add(id);
      assertJsonValue(parsed, `custom-registry-producer-${idField}-json`);
      return parsed as JsonObject;
    });
  return Object.freeze(
    items.sort((left, right) =>
      Buffer.compare(
        Buffer.from(String(left[idField]), "utf8"),
        Buffer.from(String(right[idField]), "utf8"),
      )
    ),
  );
}

/** Mirrors createDiscoverableLaunchAssetSetV2's canonical set commitment. */
export function customRegistryAssetIdentitySetHashV2(input: Readonly<{
  advertisesToken: boolean;
  assets: unknown;
}>): Sha256Digest {
  const advertisesToken = booleanValue(
    input.advertisesToken,
    "custom-registry-producer-advertises-token",
  );
  const assets = canonicalProducerSet(input.assets, "assetId", 1_024);
  return sha256(CUSTOM_REGISTRY_ASSET_SET_HASH_DOMAIN_V2, {
    schemaVersion: CUSTOM_REGISTRY_ASSET_SET_SCHEMA_V2,
    advertisesToken,
    assets,
  });
}

/** Mirrors createDiscoverableLaunchMarketSetV2's canonical set commitment. */
export function customRegistryMarketSetHashV2(input: Readonly<{
  assetIdentitySetHash: Sha256Digest;
  markets: unknown;
}>): Sha256Digest {
  const assetIdentitySetHash = digest(
    input.assetIdentitySetHash,
    "custom-registry-producer-market-asset-set",
  );
  const markets = canonicalProducerSet(input.markets, "marketId", 256);
  return sha256(CUSTOM_REGISTRY_MARKET_SET_HASH_DOMAIN_V2, {
    schemaVersion: CUSTOM_REGISTRY_MARKET_SET_SCHEMA_V2,
    assetIdentitySetHash,
    markets,
  });
}

export function customRegistryCapabilitySetHashV1(
  capabilities: unknown,
): HexBytes32 {
  const items = array(
    capabilities,
    "custom-registry-producer-capability-set",
    1_024,
  );
  const ids = new Set<string>();
  for (const item of items) {
    const capability = record(item, "custom-registry-producer-capability");
    const id = safeId(
      capability.id,
      "custom-registry-producer-capability-id",
    );
    if (ids.has(id)) {
      return fail("custom-registry-producer-capability-duplicate");
    }
    ids.add(id);
    assertJsonValue(capability, "custom-registry-producer-capability-json");
  }
  return customRegistryStructuredFieldV1("capabilitySetHash", items);
}

export function customRegistryProjectionDigestV3(
  recordValue: CustomLaunchProjectionRecordV3,
): Sha256Digest {
  return sha256(CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V3, recordValue);
}

function assertJsonValue(
  value: unknown,
  operation: string,
  depth = 0,
): asserts value is JsonValue {
  if (depth > 12) return fail(operation);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    text(value, operation, 16_384);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return fail(operation);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_COLLECTION_SIZE) return fail(operation);
    for (const item of value) assertJsonValue(item, operation, depth + 1);
    return;
  }
  const source = record(value, operation);
  if (Object.keys(source).length > MAX_COLLECTION_SIZE) return fail(operation);
  for (const [key, item] of Object.entries(source)) {
    text(key, operation, 256);
    assertJsonValue(item, operation, depth + 1);
  }
}

export function parseCustomRegistryDeploymentManifestV3(
  value: unknown,
): CustomRegistryDeploymentManifestV3 {
  const source = record(value, "custom-registry-manifest");
  if (
    source.schemaVersion !== CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3 ||
    source.platformId !== "programmable" ||
    source.category !== "custom" ||
    source.publicLabel !== PROGRAMMABLE_CUSTOM_LABEL
  ) {
    return fail("custom-registry-manifest-identity");
  }
  const chainIds = new Set<string>();
  const deployments = new Set<string>();
  const chains = array(source.chains, "custom-registry-chains").map(
    (entry): CustomRegistryChainManifestV3 => {
      const chain = record(entry, "custom-registry-chain");
      const chainId = decimal(chain.chainId, "custom-registry-chain-id", true);
      const caip2 = text(chain.caip2, "custom-registry-caip2", 96);
      if (caip2 !== `eip155:${chainId}` || chainIds.has(chainId)) {
        return fail("custom-registry-chain-identity");
      }
      chainIds.add(chainId);
      if (!new Set(["prelaunch", "active", "paused", "retired"]).has(String(chain.status))) {
        return fail("custom-registry-chain-status");
      }
      if (typeof chain.publicSubmissionsEnabled !== "boolean") {
        return fail("custom-registry-submissions");
      }
      const confirmationDepth = decimal(
        chain.confirmationDepth,
        "custom-registry-confirmation-depth",
        true,
      );
      const finalityDepth = decimal(
        chain.finalityDepth,
        "custom-registry-finality-depth",
        true,
      );
      if (BigInt(finalityDepth) < BigInt(confirmationDepth)) {
        return fail("custom-registry-finality-order");
      }
      const registries = array(chain.registries, "custom-registry-deployments").map(
        (deploymentValue): CustomRegistryDeploymentV3 => {
          const deployment = record(
            deploymentValue,
            "custom-registry-deployment",
          );
          const registryGeneration = decimal(
            deployment.registryGeneration,
            "custom-registry-generation",
            true,
          );
          const registryAddress = address(
            deployment.address,
            "custom-registry-address",
          );
          const key = `${chainId}:${registryGeneration}:${registryAddress}`;
          if (deployments.has(key)) return fail("custom-registry-duplicate");
          deployments.add(key);
          if (!new Set(["active", "paused", "retired"]).has(String(deployment.status))) {
            return fail("custom-registry-deployment-status");
          }
          const startBlock = decimal(
            deployment.startBlock,
            "custom-registry-start-block",
            true,
          );
          const retiredAtBlock = deployment.retiredAtBlock === null
            ? null
            : decimal(
                deployment.retiredAtBlock,
                "custom-registry-retired-block",
                true,
              );
          if (
            (deployment.status === "retired") !== (retiredAtBlock !== null) ||
            (retiredAtBlock !== null && BigInt(retiredAtBlock) < BigInt(startBlock))
          ) {
            return fail("custom-registry-retirement");
          }
          const topicsSource = record(deployment.topics, "custom-registry-topics");
          const topics = Object.freeze({
            approvalAuthorized: bytes32(
              topicsSource.approvalAuthorized,
              "custom-registry-approval-authorized-topic",
            ),
            registered: bytes32(
              topicsSource.registered,
              "custom-registry-registered-topic",
            ),
            provenance: bytes32(
              topicsSource.provenance,
              "custom-registry-provenance-topic",
            ),
            review: bytes32(
              topicsSource.review,
              "custom-registry-review-topic",
            ),
            attribution: bytes32(
              topicsSource.attribution,
              "custom-registry-attribution-topic",
            ),
            feePolicy: bytes32(
              topicsSource.feePolicy,
              "custom-registry-fee-policy-topic",
            ),
            feeEvidence: bytes32(
              topicsSource.feeEvidence,
              "custom-registry-fee-evidence-topic",
            ),
            finalized: bytes32(
              topicsSource.finalized,
              "custom-registry-finalized-topic",
            ),
            corrected: bytes32(
              topicsSource.corrected,
              "custom-registry-corrected-topic",
            ),
            revoked: bytes32(
              topicsSource.revoked,
              "custom-registry-revoked-topic",
            ),
          });
          if (new Set(Object.values(topics)).size !== 10) {
            return fail("custom-registry-topic-collision");
          }
          const authorizedApprovers = array(
            deployment.authorizedApprovers,
            "custom-registry-authorized-approvers",
          ).map((approver) =>
            address(approver, "custom-registry-authorized-approver"),
          );
          const authorizedWriters = array(
            deployment.authorizedWriters,
            "custom-registry-authorized-writers",
          ).map((writer) =>
            address(writer, "custom-registry-authorized-writer"),
          );
          if (
            authorizedApprovers.length === 0 ||
            new Set(authorizedApprovers).size !== authorizedApprovers.length ||
            authorizedWriters.length === 0 ||
            new Set(authorizedWriters).size !== authorizedWriters.length
          ) {
            return fail("custom-registry-authorized-writers");
          }
          return Object.freeze({
            registryGeneration,
            address: registryAddress,
            runtimeCodeHash: bytes32(
              deployment.runtimeCodeHash,
              "custom-registry-runtime-hash",
            ),
            startBlock,
            status: deployment.status as CustomRegistryDeploymentV3["status"],
            retiredAtBlock,
            authorizedApprovers: Object.freeze(authorizedApprovers),
            authorizedWriters: Object.freeze(authorizedWriters),
            topics,
          });
        },
      );
      if (
        (chain.status === "prelaunch" && registries.length !== 0) ||
        (chain.status !== "prelaunch" && registries.length === 0) ||
        (chain.publicSubmissionsEnabled === true && chain.status !== "active")
      ) {
        return fail("custom-registry-chain-activation");
      }
      return Object.freeze({
        chainId,
        caip2,
        status: chain.status as CustomRegistryChainManifestV3["status"],
        publicSubmissionsEnabled: chain.publicSubmissionsEnabled,
        confirmationDepth,
        finalityDepth,
        registries: Object.freeze(registries),
      });
    },
  );
  return Object.freeze({
    schemaVersion: CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3,
    platformId: "programmable",
    category: "custom",
    publicLabel: PROGRAMMABLE_CUSTOM_LABEL,
    chains: Object.freeze(chains),
  });
}

export function officialCustomRegistryAllowlistV3(
  manifest: CustomRegistryDeploymentManifestV3,
): readonly Readonly<{
  chainId: string;
  caip2: string;
  registryGeneration: string;
  address: HexAddress;
  runtimeCodeHash: HexBytes32;
  startBlock: string;
  authorizedApprovers: readonly HexAddress[];
  authorizedWriters: readonly HexAddress[];
  topics: CustomRegistryDeploymentV3["topics"];
}>[] {
  return Object.freeze(
    manifest.chains.flatMap((chain) =>
      chain.registries.map((deployment) =>
        Object.freeze({
          chainId: chain.chainId,
          caip2: chain.caip2,
          registryGeneration: deployment.registryGeneration,
          address: deployment.address,
          runtimeCodeHash: deployment.runtimeCodeHash,
          startBlock: deployment.startBlock,
          authorizedApprovers: deployment.authorizedApprovers,
          authorizedWriters: deployment.authorizedWriters,
          topics: deployment.topics,
        }),
      ),
    ),
  );
}

function validateFeePolicy(
  feeValue: unknown,
  expectedPartnerRecipient: HexAddress | null,
  marketEvidence: Readonly<{
    hasDiscoverableMarkets: boolean;
    verifiedMarketIds: ReadonlySet<string>;
  }>,
): CustomLaunchFeePolicyV3 {
  const fee = record(feeValue, "custom-registry-fee");
  const programmableIdentity = record(
    fee.programmableRecipient,
    "custom-registry-programmable-recipient",
  );
  if (programmableIdentity.namespace !== "eip155-address") {
    return fail("custom-registry-programmable-recipient-namespace");
  }
  const programmableRecipient = address(
    programmableIdentity.value,
    "custom-registry-programmable-recipient",
  );
  const partnerIdentity = fee.partnerRecipient === null
    ? null
    : record(fee.partnerRecipient, "custom-registry-partner-recipient");
  const feePartnerRecipient = partnerIdentity === null
    ? null
    : partnerIdentity.namespace === "eip155-address"
      ? address(partnerIdentity.value, "custom-registry-partner-recipient")
      : fail("custom-registry-partner-recipient-namespace");
  const claimRights = record(
    fee.claimRights,
    "custom-registry-fee-claim-rights",
  );
  const verifiedMarketIds = array(
    fee.verifiedMarketIds,
    "custom-registry-fee-market-ids",
  ).map((value) => safeId(value, "custom-registry-fee-market-id"));
  if (new Set(verifiedMarketIds).size !== verifiedMarketIds.length) {
    return fail("custom-registry-fee-market-ids-duplicate");
  }
  if (
    verifiedMarketIds.some(
      (marketId) => !marketEvidence.verifiedMarketIds.has(marketId),
    )
  ) {
    return fail("custom-registry-fee-market-not-verified");
  }
  for (const field of [
    "verificationAuthorityHash",
    "verificationEvidenceHash",
    "recipientControlEvidenceHash",
    "claimIsolationEvidenceHash",
  ] as const) {
    digest(fee[field], `custom-registry-fee-${field}`);
  }
  const publicPolicyBindingHash = digest(
    fee.publicPolicyBindingHash,
    "custom-registry-fee-public-policy-binding",
  );
  if (
    publicPolicyBindingHash !== customRegistryPublicFeePolicyBindingV3(fee)
  ) {
    return fail("custom-registry-fee-public-policy-binding");
  }
  digest(claimRights.evidenceHash, "custom-registry-fee-claim-right-evidence");
  instant(fee.verifiedAt, "custom-registry-fee-verified-at");
  const optionalSemantic = (value: unknown, operation: string): string | null =>
    value === null ? null : text(value, operation, 2_048);
  const common = {
    schemaVersion: "programmable.custom-launch-fee-policy.v3" as const,
    programmableRecipient: Object.freeze({
      namespace: "eip155-address" as const,
      value: programmableRecipient,
    }),
    basis: optionalSemantic(fee.basis, "custom-registry-fee-basis"),
    currency: optionalSemantic(fee.currency, "custom-registry-fee-currency"),
    accrual: optionalSemantic(fee.accrual, "custom-registry-fee-accrual"),
    claim: optionalSemantic(fee.claim, "custom-registry-fee-claim"),
    rounding: optionalSemantic(fee.rounding, "custom-registry-fee-rounding"),
    claimRights: Object.freeze({
      programmable: optionalSemantic(
        claimRights.programmable,
        "custom-registry-programmable-claim-right",
      ),
      partner: optionalSemantic(
        claimRights.partner,
        "custom-registry-partner-claim-right",
      ),
      independentlyClaimable: booleanValue(
        claimRights.independentlyClaimable,
        "custom-registry-fee-independent-claim",
      ),
      crossPartyClaimingProhibited: booleanValue(
        claimRights.crossPartyClaimingProhibited,
        "custom-registry-fee-cross-party-claim",
      ),
      evidenceHash: digest(
        claimRights.evidenceHash,
        "custom-registry-fee-claim-right-evidence",
      ),
    }),
    verifiedMarketIds: Object.freeze(verifiedMarketIds),
    verificationAuthorityHash: digest(
      fee.verificationAuthorityHash,
      "custom-registry-fee-verification-authority",
    ),
    verificationEvidenceHash: digest(
      fee.verificationEvidenceHash,
      "custom-registry-fee-verification-evidence",
    ),
    recipientControlEvidenceHash: digest(
      fee.recipientControlEvidenceHash,
      "custom-registry-fee-recipient-control",
    ),
    claimIsolationEvidenceHash: digest(
      fee.claimIsolationEvidenceHash,
      "custom-registry-fee-claim-isolation",
    ),
    verifiedAt: instant(fee.verifiedAt, "custom-registry-fee-verified-at"),
    publicPolicyBindingHash,
  };
  if (
    fee.schemaVersion !== "programmable.custom-launch-fee-policy.v3" ||
    programmableRecipient !== PROGRAMMABLE_FEE_RECIPIENT
  ) {
    return fail("custom-registry-programmable-recipient");
  }
  if (fee.mode === "native") {
    if (
      expectedPartnerRecipient !== null ||
      feePartnerRecipient !== null ||
      fee.chargeMode !== "verified-official-market-path-only" ||
      fee.totalFeeBps !== 10 ||
      fee.partnerShareBps !== 0 ||
      fee.programmableShareBps !== 10 ||
      fee.normalProgrammableTenBpsApplied !== true ||
      fee.verificationStatus !== "verified" ||
      !marketEvidence.hasDiscoverableMarkets ||
      verifiedMarketIds.length === 0 ||
      common.basis === null ||
      common.currency === null ||
      common.accrual === null ||
      common.claim === null ||
      common.rounding === null ||
      common.claimRights.programmable === null ||
      common.claimRights.partner !== null ||
      common.claimRights.independentlyClaimable !== false ||
      common.claimRights.crossPartyClaimingProhibited !== true
    ) {
      return fail("custom-registry-native-fee");
    }
    return Object.freeze({
      mode: "native",
      chargeMode: "verified-official-market-path-only",
      ...common,
      totalFeeBps: 10,
      partnerShareBps: 0,
      programmableShareBps: 10,
      partnerRecipient: null,
      normalProgrammableTenBpsApplied: true,
      verificationStatus: "verified",
    });
  }
  if (fee.mode === "partner-template") {
    if (
      expectedPartnerRecipient === null ||
      feePartnerRecipient !== expectedPartnerRecipient ||
      fee.chargeMode !== "template-native-verified-market-path" ||
      fee.totalFeeBps !== 20 ||
      fee.partnerShareBps !== 15 ||
      fee.programmableShareBps !== 5 ||
      fee.normalProgrammableTenBpsApplied !== false ||
      fee.verificationStatus !== "verified" ||
      !marketEvidence.hasDiscoverableMarkets ||
      verifiedMarketIds.length === 0 ||
      common.basis === null ||
      common.currency === null ||
      common.accrual === null ||
      common.claim === null ||
      common.rounding === null ||
      common.claimRights.programmable === null ||
      common.claimRights.partner === null ||
      common.claimRights.independentlyClaimable !== true ||
      common.claimRights.crossPartyClaimingProhibited !== true
    ) {
      return fail("custom-registry-partner-fee");
    }
    return Object.freeze({
      mode: "partner-template",
      chargeMode: "template-native-verified-market-path",
      ...common,
      totalFeeBps: 20,
      partnerShareBps: 15,
      programmableShareBps: 5,
      partnerRecipient: Object.freeze({
        namespace: "eip155-address" as const,
        value: feePartnerRecipient,
      }),
      normalProgrammableTenBpsApplied: false,
      verificationStatus: "verified",
    });
  }
  if (
    fee.mode !== "no-qualifying-market" ||
    feePartnerRecipient !== null ||
    fee.chargeMode !== "none-no-qualifying-market" ||
    fee.totalFeeBps !== 0 ||
    fee.partnerShareBps !== 0 ||
    fee.programmableShareBps !== 0 ||
    fee.normalProgrammableTenBpsApplied !== false ||
    fee.verificationStatus !== "not_applicable" ||
    marketEvidence.hasDiscoverableMarkets ||
    verifiedMarketIds.length !== 0 ||
    common.basis !== null ||
    common.currency !== null ||
    common.accrual !== null ||
    common.claim !== null ||
    common.rounding !== null ||
    common.claimRights.programmable !== null ||
    common.claimRights.partner !== null ||
    common.claimRights.independentlyClaimable !== false ||
    common.claimRights.crossPartyClaimingProhibited !== true
  ) {
    return fail("custom-registry-no-market-fee");
  }
  return Object.freeze({
    mode: "no-qualifying-market",
    chargeMode: "none-no-qualifying-market",
    ...common,
    totalFeeBps: 0,
    partnerShareBps: 0,
    programmableShareBps: 0,
    partnerRecipient: null,
    basis: null,
    currency: null,
    accrual: null,
    claim: null,
    rounding: null,
    normalProgrammableTenBpsApplied: false,
    verificationStatus: "not_applicable",
  });
}

function validateRegisteredRecordPreimage(
  value: unknown,
  event: CustomRegistryEventV3,
): Readonly<{
  preimage: CustomLaunchRegisteredRecordPreimageV1;
  binding: ReturnType<typeof customRegistryRegisteredRecordBindingV1>;
}> {
  const source = record(value, "custom-registry-registered-record-preimage");
  const preimage = {
    chainId: decimal(source.chainId, "custom-registry-record-preimage-chain", true),
    registryGeneration: decimal(
      source.registryGeneration,
      "custom-registry-record-preimage-generation",
      true,
    ),
    launchId: bytes32(source.launchId, "custom-registry-record-preimage-launch"),
    projectId: bytes32(source.projectId, "custom-registry-record-preimage-project"),
    approvalId: bytes32(source.approvalId, "custom-registry-record-preimage-approval"),
    approvalBindingHash: bytes32(
      source.approvalBindingHash,
      "custom-registry-record-preimage-approval-binding",
    ),
    repositoryId: bytes32(source.repositoryId, "custom-registry-record-preimage-repository"),
    commitId: bytes32(source.commitId, "custom-registry-record-preimage-commit"),
    sourceCommitment: bytes32(
      source.sourceCommitment,
      "custom-registry-record-preimage-source",
    ),
    buildCommitment: bytes32(
      source.buildCommitment,
      "custom-registry-record-preimage-build",
    ),
    artifactSetHash: bytes32(
      source.artifactSetHash,
      "custom-registry-record-preimage-artifacts",
    ),
    deploymentConfigurationHash: bytes32(
      source.deploymentConfigurationHash,
      "custom-registry-record-preimage-configuration",
    ),
    deploymentId: bytes32(source.deploymentId, "custom-registry-record-preimage-deployment"),
    deploymentSetHash: bytes32(
      source.deploymentSetHash,
      "custom-registry-record-preimage-deployment-set",
    ),
    runtimeCodeSetHash: bytes32(
      source.runtimeCodeSetHash,
      "custom-registry-record-preimage-runtime-set",
    ),
    primaryContract: address(
      source.primaryContract,
      "custom-registry-record-preimage-primary-contract",
    ),
    primaryRuntimeCodeHash: bytes32(
      source.primaryRuntimeCodeHash,
      "custom-registry-record-preimage-primary-runtime",
    ),
    launchWallet: address(
      source.launchWallet,
      "custom-registry-record-preimage-launch-wallet",
    ),
    modelId: bytes32(source.modelId, "custom-registry-record-preimage-model"),
    modelVersion: bytes32(
      source.modelVersion,
      "custom-registry-record-preimage-model-version",
    ),
    templateId: bytes32(source.templateId, "custom-registry-record-preimage-template"),
    templateVersion: bytes32(
      source.templateVersion,
      "custom-registry-record-preimage-template-version",
    ),
    partnerId: bytes32(source.partnerId, "custom-registry-record-preimage-partner"),
    builderAttributionHash: bytes32(
      source.builderAttributionHash,
      "custom-registry-record-preimage-builder",
    ),
    originHash: bytes32(source.originHash, "custom-registry-record-preimage-origin"),
    assetSetHash: bytes32(source.assetSetHash, "custom-registry-record-preimage-assets"),
    marketSetHash: bytes32(source.marketSetHash, "custom-registry-record-preimage-markets"),
    capabilitySetHash: bytes32(
      source.capabilitySetHash,
      "custom-registry-record-preimage-capabilities",
    ),
    reviewPolicyHash: bytes32(
      source.reviewPolicyHash,
      "custom-registry-record-preimage-review-policy",
    ),
    securityReviewHash: bytes32(
      source.securityReviewHash,
      "custom-registry-record-preimage-security-review",
    ),
    reviewResultId: bytes32(
      source.reviewResultId,
      "custom-registry-record-preimage-review-result",
    ),
    reviewDeploymentBindingHash: bytes32(
      source.reviewDeploymentBindingHash,
      "custom-registry-record-preimage-review-deployment",
    ),
    feePolicyHash: bytes32(
      source.feePolicyHash,
      "custom-registry-record-preimage-fee-policy",
    ),
    finalityPolicyHash: bytes32(
      source.finalityPolicyHash,
      "custom-registry-record-preimage-finality-policy",
    ),
  } satisfies CustomLaunchRegisteredRecordPreimageV1;
  if (
    preimage.chainId !== event.chainId ||
    preimage.launchId !== event.registryLaunchIdRaw ||
    preimage.projectId !== event.registryProjectIdRaw ||
    (event.operation === "registered" &&
      (preimage.registryGeneration !== event.registryGeneration ||
        preimage.approvalId !== event.approvalId ||
        preimage.primaryContract !== event.primaryContract ||
        preimage.launchWallet !== event.launchWallet ||
        preimage.deploymentId !== event.deploymentId))
  ) {
    return fail("custom-registry-record-preimage-event-binding");
  }
  return Object.freeze({
    preimage: Object.freeze(preimage),
    binding: customRegistryRegisteredRecordBindingV1(preimage),
  });
}

function validateOnchainFeePolicy(
  value: unknown,
  normalizedFee: CustomLaunchFeePolicyV3,
  expectedPartnerRecipient: HexAddress | null,
): CustomLaunchOnchainFeePolicyV1 {
  const source = record(value, "custom-registry-onchain-fee-policy");
  const parseLeg = (
    legValue: unknown,
    label: string,
  ): CustomLaunchOnchainFeeLegV1 => {
    const leg = record(legValue, `custom-registry-${label}-fee-leg`);
    return Object.freeze({
      shareBps: uintNumber(leg.shareBps, 16, `custom-registry-${label}-fee-share`),
      recipient: address(leg.recipient, `custom-registry-${label}-fee-recipient`),
      currency: address(leg.currency, `custom-registry-${label}-fee-currency`),
      chargeModeId: bytes32(leg.chargeModeId, `custom-registry-${label}-fee-charge-mode`),
      basisId: bytes32(leg.basisId, `custom-registry-${label}-fee-basis`),
      roundingId: bytes32(leg.roundingId, `custom-registry-${label}-fee-rounding`),
      accrualId: bytes32(leg.accrualId, `custom-registry-${label}-fee-accrual`),
      claimId: bytes32(leg.claimId, `custom-registry-${label}-fee-claim`),
      claimRightId: bytes32(leg.claimRightId, `custom-registry-${label}-fee-claim-right`),
      controlEvidenceHash: bytes32(
        leg.controlEvidenceHash,
        `custom-registry-${label}-fee-control-evidence`,
      ),
    });
  };
  const kind = uintNumber(source.kind, 8, "custom-registry-onchain-fee-kind");
  if (kind !== 0 && kind !== 1 && kind !== 2) {
    return fail("custom-registry-onchain-fee-kind");
  }
  const policy = Object.freeze({
    kind,
    partnerId: bytes32(source.partnerId, "custom-registry-onchain-fee-partner"),
    partnerStatusId: bytes32(
      source.partnerStatusId,
      "custom-registry-onchain-fee-partner-status",
    ),
    templateId: bytes32(source.templateId, "custom-registry-onchain-fee-template"),
    templateVersion: bytes32(
      source.templateVersion,
      "custom-registry-onchain-fee-template-version",
    ),
    partnerRepositoryId: bytes32(
      source.partnerRepositoryId,
      "custom-registry-onchain-fee-partner-repository",
    ),
    partnerCommitId: bytes32(
      source.partnerCommitId,
      "custom-registry-onchain-fee-partner-commit",
    ),
    partnerRuntimeCodeSetHash: bytes32(
      source.partnerRuntimeCodeSetHash,
      "custom-registry-onchain-fee-partner-runtime",
    ),
    totalFeeBps: uintNumber(
      source.totalFeeBps,
      16,
      "custom-registry-onchain-fee-total",
    ),
    nativeCustomFeeBps: uintNumber(
      source.nativeCustomFeeBps,
      16,
      "custom-registry-onchain-native-fee",
    ),
    partner: parseLeg(source.partner, "partner"),
    programmable: parseLeg(source.programmable, "programmable"),
    activationVersion: bytes32(
      source.activationVersion,
      "custom-registry-onchain-fee-activation-version",
    ),
    activationBlock: decimal(
      source.activationBlock,
      "custom-registry-onchain-fee-activation-block",
    ),
    paused: booleanValue(source.paused, "custom-registry-onchain-fee-paused"),
    retired: booleanValue(source.retired, "custom-registry-onchain-fee-retired"),
    publicPolicyBindingHash: bytes32(
      source.publicPolicyBindingHash,
      "custom-registry-onchain-fee-public-policy-binding",
    ),
    claimIsolationEvidenceHash: bytes32(
      source.claimIsolationEvidenceHash,
      "custom-registry-onchain-fee-claim-isolation",
    ),
    accountingSafetyEvidenceHash: bytes32(
      source.accountingSafetyEvidenceHash,
      "custom-registry-onchain-fee-accounting-safety",
    ),
    verificationEvidenceHash: bytes32(
      source.verificationEvidenceHash,
      "custom-registry-onchain-fee-verification",
    ),
  }) satisfies CustomLaunchOnchainFeePolicyV1;
  const legIsZero = (leg: CustomLaunchOnchainFeeLegV1): boolean =>
    leg.shareBps === 0 &&
    leg.recipient === ZERO_ADDRESS &&
    leg.currency === ZERO_ADDRESS &&
    leg.chargeModeId === ZERO_BYTES32 &&
    leg.basisId === ZERO_BYTES32 &&
    leg.roundingId === ZERO_BYTES32 &&
    leg.accrualId === ZERO_BYTES32 &&
    leg.claimId === ZERO_BYTES32 &&
    leg.claimRightId === ZERO_BYTES32 &&
    leg.controlEvidenceHash === ZERO_BYTES32;
  const attributionIsZero =
    policy.partnerId === ZERO_BYTES32 &&
    policy.partnerStatusId === ZERO_BYTES32 &&
    policy.templateId === ZERO_BYTES32 &&
    policy.templateVersion === ZERO_BYTES32 &&
    policy.partnerRepositoryId === ZERO_BYTES32 &&
    policy.partnerCommitId === ZERO_BYTES32 &&
    policy.partnerRuntimeCodeSetHash === ZERO_BYTES32;
  const evidenceIsNonzero =
    policy.publicPolicyBindingHash !== ZERO_BYTES32 &&
    policy.claimIsolationEvidenceHash !== ZERO_BYTES32 &&
    policy.accountingSafetyEvidenceHash !== ZERO_BYTES32 &&
    policy.verificationEvidenceHash !== ZERO_BYTES32;
  if (
    policy.publicPolicyBindingHash !==
      digestRawBytes32(normalizedFee.publicPolicyBindingHash) ||
    policy.claimIsolationEvidenceHash !==
      digestRawBytes32(normalizedFee.claimIsolationEvidenceHash) ||
    policy.accountingSafetyEvidenceHash !==
      digestRawBytes32(normalizedFee.recipientControlEvidenceHash) ||
    policy.verificationEvidenceHash !==
      digestRawBytes32(normalizedFee.verificationEvidenceHash) ||
    policy.partner.shareBps + policy.programmable.shareBps !==
      policy.totalFeeBps
  ) {
    return fail("custom-registry-onchain-public-policy-evidence-binding");
  }
  if (normalizedFee.mode === "no-qualifying-market") {
    if (
      policy.kind !== 2 ||
      !attributionIsZero ||
      policy.totalFeeBps !== 0 ||
      policy.nativeCustomFeeBps !== 0 ||
      !legIsZero(policy.partner) ||
      !legIsZero(policy.programmable) ||
      policy.activationVersion !== ZERO_BYTES32 ||
      policy.activationBlock !== "0" ||
      policy.paused ||
      policy.retired ||
      !evidenceIsNonzero
    ) {
      return fail("custom-registry-onchain-no-market-fee");
    }
    return policy;
  }
  if (
    policy.paused ||
    policy.retired ||
    !evidenceIsNonzero ||
    policy.activationVersion === ZERO_BYTES32 ||
    policy.activationBlock === "0" ||
    policy.programmable.currency === ZERO_ADDRESS ||
    policy.programmable.chargeModeId === ZERO_BYTES32 ||
    policy.programmable.basisId === ZERO_BYTES32 ||
    policy.programmable.roundingId === ZERO_BYTES32 ||
    policy.programmable.accrualId === ZERO_BYTES32 ||
    policy.programmable.claimId === ZERO_BYTES32 ||
    policy.programmable.claimRightId === ZERO_BYTES32 ||
    policy.programmable.controlEvidenceHash === ZERO_BYTES32 ||
    policy.programmable.recipient !== PROGRAMMABLE_FEE_RECIPIENT
  ) {
    return fail("custom-registry-onchain-programmable-fee-leg");
  }
  if (normalizedFee.mode === "native") {
    if (
      policy.kind !== 0 ||
      !attributionIsZero ||
      policy.totalFeeBps !== 10 ||
      policy.nativeCustomFeeBps !== 10 ||
      !legIsZero(policy.partner) ||
      policy.programmable.shareBps !== 10
    ) {
      return fail("custom-registry-onchain-native-fee-policy");
    }
    return policy;
  }
  if (
    policy.kind !== 1 ||
    attributionIsZero ||
    expectedPartnerRecipient === null ||
    policy.totalFeeBps !== 20 ||
    policy.nativeCustomFeeBps !== 0 ||
    policy.partner.shareBps !== 15 ||
    policy.programmable.shareBps !== 5 ||
    policy.partner.recipient !== expectedPartnerRecipient ||
    policy.partner.recipient === policy.programmable.recipient ||
    policy.partner.currency !== policy.programmable.currency ||
    policy.partner.chargeModeId !== policy.programmable.chargeModeId ||
    policy.partner.basisId !== policy.programmable.basisId ||
    policy.partner.roundingId !== policy.programmable.roundingId ||
    policy.partner.accrualId !== policy.programmable.accrualId ||
    policy.partner.claimId === policy.programmable.claimId ||
    policy.partner.claimRightId === policy.programmable.claimRightId ||
    policy.partner.controlEvidenceHash === ZERO_BYTES32
  ) {
    return fail("custom-registry-onchain-partner-fee-policy");
  }
  return policy;
}

function validateProducerFeeBindings(
  source: Record<string, unknown>,
): Readonly<{
  feePolicy: CustomLaunchFeePolicyV3;
  onchainFeePolicy: CustomLaunchOnchainFeePolicyV1;
}> {
  let partnerRecipient: HexAddress | null = null;
  if (source.partner !== null) {
    const partner = record(source.partner, "custom-registry-producer-partner");
    const recipient = record(
      partner.recipient,
      "custom-registry-producer-partner-recipient",
    );
    if (
      partner.status !== "active" ||
      recipient.namespace !== "eip155-address"
    ) {
      return fail("custom-registry-producer-partner-fee-eligibility");
    }
    partnerRecipient = address(
      recipient.value,
      "custom-registry-producer-partner-recipient",
    );
  }
  const markets = array(
    source.discoverableMarkets,
    "custom-registry-producer-markets",
  );
  const verifiedMarketIds = new Set<string>();
  const allMarketIds = new Set<string>();
  for (const value of markets) {
    const market = record(value, "custom-registry-producer-market");
    const marketId = safeId(
      market.marketId,
      "custom-registry-producer-market-id",
    );
    if (allMarketIds.has(marketId)) {
      return fail("custom-registry-producer-market-duplicate");
    }
    allMarketIds.add(marketId);
    const verification = record(
      market.verification,
      "custom-registry-producer-market-verification",
    );
    if (market.status === "active" && verification.status === "verified") {
      verifiedMarketIds.add(marketId);
    }
  }
  const feePolicy = validateFeePolicy(source.feePolicy, partnerRecipient, {
    hasDiscoverableMarkets: markets.length > 0,
    verifiedMarketIds,
  });
  const onchainFeePolicy = validateOnchainFeePolicy(
    source.onchainFeePolicy,
    feePolicy,
    partnerRecipient,
  );
  return Object.freeze({ feePolicy, onchainFeePolicy });
}

function validateProducerReviewBindings(
  source: Record<string, unknown>,
  event: CustomRegistryEventV3,
): Readonly<{
  review: Record<string, unknown>;
  reviewEvidenceHash: Sha256Digest;
}> {
  const review = record(
    source.verifiedReview,
    "custom-registry-producer-verified-review",
  );
  const approval = record(
    source.approvalBinding,
    "custom-registry-producer-review-approval",
  );
  const deployment = record(
    source.deploymentBinding,
    "custom-registry-producer-review-deployment",
  );
  const reviewEvidenceHash = digest(
    review.reviewEvidenceHash,
    "custom-registry-producer-review-evidence",
  );
  if (
    review.schemaVersion !== "programmable.custom-launch-verified-review.v1" ||
    review.label !== "Programmable Verified" ||
    review.definition !==
      "Reviewed against the published Programmable security policy and cryptographically bound to the exact deployed contract revision." ||
    !new Set(["verified", "superseded", "revoked"]).has(String(review.status)) ||
    (event.operation === "registered" && review.status !== "verified") ||
    review.policyVersion !== approval.policyVersion ||
    review.policyCommitment !== approval.policyCommitment ||
    review.repositoryId !== approval.repositoryId ||
    review.commitObjectId !== approval.commitObjectId ||
    review.sourceCommitment !== approval.sourceCommitment ||
    review.buildCommitment !== approval.buildCommitment ||
    review.artifactSetHash !== approval.artifactSetHash ||
    review.configurationCommitment !== approval.configurationCommitment ||
    reviewEvidenceHash !== customRegistryVerifiedReviewEvidenceHashV1(review) ||
    review.deploymentBindingHash !==
      sha256("programmable.custom-launch-deployment-binding.v3", deployment)
  ) {
    return fail("custom-registry-producer-review-binding");
  }
  for (const field of [
    "authoritiesEvidenceHash",
    "upgradeabilityEvidenceHash",
    "pauseAuthorityEvidenceHash",
    "custodyEvidenceHash",
    "dependencySetHash",
    "findingSetHash",
    "deploymentBindingHash",
  ] as const) {
    digest(review[field], `custom-registry-producer-review-${field}`);
  }
  safeId(review.upgradeability, "custom-registry-producer-review-upgradeability");
  safeId(review.pauseAuthority, "custom-registry-producer-review-pause");
  safeId(review.custody, "custom-registry-producer-review-custody");
  safeId(review.reviewerType, "custom-registry-producer-review-reviewer");
  instant(review.reviewedAt, "custom-registry-producer-review-time");
  const reviewedRuntimeKeccak = array(
    review.runtimeCodeKeccak256,
    "custom-registry-producer-review-runtime-keccak",
  ).map((value) => bytes32(value, "custom-registry-producer-review-runtime-keccak"));
  const reviewedRuntimeSha = array(
    review.runtimeCodeSha256,
    "custom-registry-producer-review-runtime-sha",
  ).map((value) => digest(value, "custom-registry-producer-review-runtime-sha"));
  const contracts = array(
    deployment.contracts,
    "custom-registry-producer-review-contracts",
  );
  const deployedKeccak = contracts.map((value) =>
    bytes32(
      record(value, "custom-registry-producer-review-contract").runtimeCodeKeccak256,
      "custom-registry-producer-review-contract-keccak",
    )
  );
  const deployedSha = contracts.map((value) =>
    digest(
      record(value, "custom-registry-producer-review-contract").runtimeCodeSha256,
      "custom-registry-producer-review-contract-sha",
    )
  );
  const sorted = (values: readonly string[]) => [...values].sort();
  if (
    canonicalJson(sorted(reviewedRuntimeKeccak)) !==
      canonicalJson(sorted(deployedKeccak)) ||
    canonicalJson(sorted(reviewedRuntimeSha)) !== canonicalJson(sorted(deployedSha))
  ) {
    return fail("custom-registry-producer-review-runtime-binding");
  }
  for (const field of ["dependencies", "findings"] as const) {
    for (const item of array(
      review[field],
      `custom-registry-producer-review-${field}`,
    )) {
      assertJsonValue(item, `custom-registry-producer-review-${field}`);
    }
  }
  return Object.freeze({ review, reviewEvidenceHash });
}

function validateProducerRecord(
  value: CustomLaunchRegistryProducerRecordV3,
  event: CustomRegistryEventV3,
): CustomLaunchRegistryProducerRecordV3 {
  if (!validateCustomRegistryProducerSchemaV3(value)) {
    return fail("custom-registry-producer-schema-v3");
  }
  const source = record(value, "custom-registry-producer-record");
  const envelopeDigest = digest(
    source.envelopeDigest,
    "custom-registry-producer-envelope-digest",
  );
  const {
    schemaVersion: _schemaVersion,
    envelopeDigest: _envelopeDigest,
    ...producerPreimage
  } = source;
  void _schemaVersion;
  void _envelopeDigest;
  if (
    source.schemaVersion !== CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3 ||
    source.platformId !== "programmable" ||
    source.origin !== "programmable" ||
    source.category !== "custom" ||
    source.launchFamily !== "custom" ||
    source.publicLabel !== PROGRAMMABLE_CUSTOM_LABEL ||
    digest(source.launchId, "custom-registry-producer-launch-id") !==
      event.launchId ||
    digest(source.projectId, "custom-registry-producer-project-id") !==
      event.projectId ||
    envelopeDigest !==
      customRegistryProducerEnvelopeDigestV3(
        producerPreimage as Omit<
          CustomLaunchRegistryProducerRecordV3,
          "schemaVersion" | "envelopeDigest"
        >,
      )
  ) {
    return fail("custom-registry-producer-identity");
  }
  const registryOrigin = record(
    source.registryOrigin,
    "custom-registry-producer-origin",
  );
  const approval = record(
    source.approvalBinding,
    "custom-registry-producer-approval-binding",
  );
  const deployment = record(
    source.deploymentBinding,
    "custom-registry-producer-deployment-binding",
  );
  const { onchainFeePolicy } = validateProducerFeeBindings(source);
  const { reviewEvidenceHash } = validateProducerReviewBindings(source, event);
  const approvalBindingHash = digest(
    approval.approvalBindingHash,
    "custom-registry-producer-approval-binding-hash",
  );
  const { preimage: registeredRecordPreimage, binding: registeredRecordBinding } =
    validateRegisteredRecordPreimage(source.registeredRecordPreimage, event);
  safeId(approval.applicationId, "custom-registry-producer-application-id");
  safeId(approval.approvalId, "custom-registry-producer-approval-id");
  safeId(approval.grantId, "custom-registry-producer-grant-id");
  safeId(approval.chainProfileId, "custom-registry-producer-chain-profile-id");
  decimal(approval.repositoryId, "custom-registry-producer-repository-id", true);
  exactHttpsUrl(
    approval.repositoryUri,
    "custom-registry-producer-repository-uri",
  );
  text(approval.commitObjectId, "custom-registry-producer-commit", 64);
  text(approval.treeObjectId, "custom-registry-producer-tree", 64);
  instant(approval.approvedAt, "custom-registry-producer-approved-at");
  for (const field of [
    "grantBindingHash",
    "decisionReceiptDigest",
    "sourceCommitment",
    "buildCommitment",
    "artifactSetHash",
    "configurationCommitment",
    "launchWalletBindingHash",
    "chainProfileHash",
    "policyCommitment",
  ] as const) {
    digest(approval[field], `custom-registry-producer-approval-${field}`);
  }
  const componentHashes = record(
    source.registeredRecordComponentHashes,
    "custom-registry-registered-record-components",
  );
  const normalizedComponentHashes = Object.freeze({
    scopeAndApprovalHash: bytes32(
      componentHashes.scopeAndApprovalHash,
      "custom-registry-record-component-scope",
    ),
    sourceAndDeploymentHash: bytes32(
      componentHashes.sourceAndDeploymentHash,
      "custom-registry-record-component-deployment",
    ),
    attributionHash: bytes32(
      componentHashes.attributionHash,
      "custom-registry-record-component-attribution",
    ),
    reviewHash: bytes32(
      componentHashes.reviewHash,
      "custom-registry-record-component-review",
    ),
    feePolicyHash: bytes32(
      componentHashes.feePolicyHash,
      "custom-registry-record-component-fee",
    ),
    finalityPolicyHash: bytes32(
      componentHashes.finalityPolicyHash,
      "custom-registry-record-component-finality",
    ),
  });
  const registeredRecordCommitment = bytes32(
    source.registeredRecordCommitment,
    "custom-registry-producer-registered-record-commitment",
  );
  const registrationBindingHash = bytes32(
    source.registrationBindingHash,
    "custom-registry-producer-registration-binding",
  );
  address(
    registryOrigin.registryAddress,
    "custom-registry-producer-origin-address",
  );
  decimal(
    registryOrigin.registryStartBlock,
    "custom-registry-producer-origin-start-block",
    true,
  );
  bytes32(
    registryOrigin.registryApprovalBindingHashRaw,
    "custom-registry-producer-origin-approval-raw",
  );
  bytes32(
    registryOrigin.registrationBindingHashRaw,
    "custom-registry-producer-origin-registration-binding",
  );
  digest(
    registryOrigin.registryEventSetHash,
    "custom-registry-producer-event-set",
  );
  bytes32(
    registryOrigin.registrationTransactionHash,
    "custom-registry-producer-registration-transaction",
  );
  bytes32(
    registryOrigin.registrationBlockHash,
    "custom-registry-producer-registration-block-hash",
  );
  bytes32(
    registryOrigin.registeredRecordHash,
    "custom-registry-producer-registered-record",
  );
  digest(
    registryOrigin.registrationEvidenceHash,
    "custom-registry-producer-registration-evidence",
  );
  if (
    decimal(registryOrigin.chainId, "custom-registry-producer-origin-chain", true) !==
      event.chainId ||
    registryOrigin.caip2 !== event.caip2 ||
    (event.operation === "registered" &&
      (registryOrigin.registryAddress !== event.registryAddress ||
        registryOrigin.registryGeneration !== event.registryGeneration)) ||
    registryOrigin.registryLaunchIdRaw !== event.registryLaunchIdRaw ||
    registryOrigin.registryLaunchIdRaw !== digestRawBytes32(event.launchId) ||
    event.registryProjectIdRaw !== digestRawBytes32(event.projectId) ||
    registryOrigin.launchIdEncoding !== "sha256-digest-raw-bytes32" ||
    registryOrigin.registryApprovalBindingHashRaw !==
      digestRawBytes32(approvalBindingHash) ||
    registeredRecordPreimage.approvalBindingHash !==
      registryOrigin.registryApprovalBindingHashRaw ||
    canonicalJson(normalizedComponentHashes) !==
      canonicalJson(registeredRecordBinding.componentHashes) ||
    registeredRecordCommitment !==
      registeredRecordBinding.registeredRecordCommitment ||
    registrationBindingHash !== registeredRecordBinding.registrationBindingHash ||
    registryOrigin.registrationBindingHashRaw !== registrationBindingHash ||
    (event.operation === "registered" &&
      event.identityHash !== registrationBindingHash) ||
    (event.operation === "finalized" &&
      event.finalityPolicyHash !== registeredRecordPreimage.finalityPolicyHash) ||
    registryOrigin.registeredRecordHash !== registeredRecordCommitment ||
    (event.operation === "registered" &&
      (registryOrigin.registrationTransactionHash !== event.transactionHash ||
        registryOrigin.registrationBlockHash !== event.blockHash ||
        registryOrigin.registrationBlockNumber !== event.blockNumber ||
        registryOrigin.registrationTransactionIndex !==
          String(event.transactionIndex) ||
        registryOrigin.registrationLogIndex !== String(event.logIndex))) ||
    registryOrigin.registeredRecordHash !== event.registeredRecordHash ||
    decimal(approval.chainId, "custom-registry-producer-approval-chain", true) !==
      event.chainId ||
    approval.caip2 !== event.caip2 ||
    typeof approval.chainProfileId !== "string" ||
    decimal(deployment.chainId, "custom-registry-producer-deployment-chain", true) !==
      event.chainId ||
    deployment.caip2 !== event.caip2 ||
    deployment.runtimeMatch !== "exact"
  ) {
    return fail("custom-registry-producer-binding");
  }
  const contracts = array(
    deployment.contracts,
    "custom-registry-producer-deployment-contracts",
    MAX_COLLECTION_SIZE,
  );
  if (contracts.length < 1) return fail("custom-registry-producer-contracts");
  const runtimeByAddress = new Map<HexAddress, HexBytes32>();
  for (const item of contracts) {
    const contract = record(item, "custom-registry-producer-contract");
    const contractAddress = record(
      contract.address,
      "custom-registry-producer-contract-address",
    );
    if (contractAddress.namespace !== "eip155-address") {
      return fail("custom-registry-producer-contract-namespace");
    }
    const normalizedAddress = address(
      contractAddress.value,
      "custom-registry-producer-contract-address",
    );
    // This is a raw EVM bytes32 code hash. Do not accept sha256-prefixed commitments.
    const runtimeCodeKeccak256 = bytes32(
      contract.runtimeCodeKeccak256,
      "custom-registry-producer-evm-runtime-code-hash",
    );
    digest(
      contract.runtimeCodeSha256,
      "custom-registry-producer-runtime-content-sha256",
    );
    for (const field of [
      "creationCodeHash",
      "artifactHash",
      "configurationCommitment",
      "runtimeVerificationEvidenceHash",
    ] as const) {
      digest(
        contract[field],
        `custom-registry-producer-contract-${field}`,
      );
    }
    safeId(contract.role, "custom-registry-producer-contract-role");
    if (contract.configurationCommitment !== approval.configurationCommitment) {
      return fail("custom-registry-producer-contract-configuration");
    }
    if (runtimeByAddress.has(normalizedAddress)) {
      return fail("custom-registry-producer-contract-duplicate");
    }
    runtimeByAddress.set(normalizedAddress, runtimeCodeKeccak256);
  }
  for (const field of [
    "postLaunchAuthorityInventoryHash",
    "assetIdentitySetHash",
    "marketSetHash",
  ] as const) {
    digest(source[field], `custom-registry-producer-${field}`);
  }
  const canonicalAssetIdentitySetHash = customRegistryAssetIdentitySetHashV2({
    advertisesToken: booleanValue(
      source.advertisesToken,
      "custom-registry-producer-advertises-token",
    ),
    assets: source.discoverableAssets,
  });
  const canonicalMarketSetHash = customRegistryMarketSetHashV2({
    assetIdentitySetHash: canonicalAssetIdentitySetHash,
    markets: source.discoverableMarkets,
  });
  const canonicalCapabilitySetHash = customRegistryCapabilitySetHashV1(
    source.capabilities,
  );
  if (
    source.assetIdentitySetHash !== canonicalAssetIdentitySetHash ||
    source.marketSetHash !== canonicalMarketSetHash ||
    registeredRecordPreimage.assetSetHash !==
      digestRawBytes32(canonicalAssetIdentitySetHash) ||
    registeredRecordPreimage.marketSetHash !==
      digestRawBytes32(canonicalMarketSetHash) ||
    registeredRecordPreimage.capabilitySetHash !== canonicalCapabilitySetHash
  ) {
    return fail("custom-registry-producer-public-set-bindings");
  }
  const launchingWallet = record(
    source.launchingWallet,
    "custom-registry-producer-launching-wallet",
  );
  if (launchingWallet.namespace !== "eip155-address") {
    return fail("custom-registry-producer-launching-wallet-namespace");
  }
  address(
    launchingWallet.value,
    "custom-registry-producer-launching-wallet-value",
  );
  const launchIdentity = record(
    source.launchIdentity,
    "custom-registry-producer-launch-identity",
  );
  if (launchIdentity.namespace !== "eip155-address") {
    return fail("custom-registry-producer-launch-identity-namespace");
  }
  address(
    launchIdentity.value,
    "custom-registry-producer-launch-identity-value",
  );
  const expectedLaunchWalletBindingHash = sha256(
    "programmable.custom-launch-wallet-binding.v3",
    {
      chainId: approval.chainId,
      caip2: approval.caip2,
      chainProfileId: approval.chainProfileId,
      launchingWallet: source.launchingWallet,
    },
  );
  const expectedLaunchId = sha256("programmable.custom-launch-id.v2", {
    launchFamily: "custom",
    projectId: source.projectId,
    chainId: registryOrigin.chainId,
    launchIdentity: source.launchIdentity,
  });
  if (
    source.launchId !== expectedLaunchId ||
    approval.projectId !== source.projectId ||
    approval.launchWalletBindingHash !== expectedLaunchWalletBindingHash ||
    approval.launchWalletBindingHash !== deployment.launchWalletBindingHash ||
    approval.chainProfileHash !== deployment.chainProfileHash ||
    approval.artifactSetHash !== deployment.artifactOutputSetHash ||
    registeredRecordPreimage.launchWallet !== launchingWallet.value ||
    runtimeByAddress.get(registeredRecordPreimage.primaryContract) !==
      registeredRecordPreimage.primaryRuntimeCodeHash ||
    registeredRecordPreimage.sourceCommitment !==
      digestRawBytes32(
        digest(
          approval.sourceCommitment,
          "custom-registry-producer-approval-source",
        ),
      ) ||
    registeredRecordPreimage.buildCommitment !==
      digestRawBytes32(
        digest(
          approval.buildCommitment,
          "custom-registry-producer-approval-build",
        ),
      ) ||
    registeredRecordPreimage.artifactSetHash !==
      digestRawBytes32(
        digest(
          approval.artifactSetHash,
          "custom-registry-producer-approval-artifacts",
        ),
      ) ||
    registeredRecordPreimage.deploymentConfigurationHash !==
      digestRawBytes32(
        digest(
          approval.configurationCommitment,
          "custom-registry-producer-approval-configuration",
        ),
      ) ||
    registeredRecordPreimage.assetSetHash !==
      digestRawBytes32(
        digest(source.assetIdentitySetHash, "custom-registry-producer-assets"),
      ) ||
    registeredRecordPreimage.marketSetHash !==
      digestRawBytes32(
        digest(source.marketSetHash, "custom-registry-producer-markets"),
      ) ||
    registeredRecordPreimage.reviewPolicyHash !==
      digestRawBytes32(
        digest(
          record(source.verifiedReview, "custom-registry-producer-review").policyCommitment,
          "custom-registry-producer-review-policy",
        ),
      ) ||
    registeredRecordPreimage.securityReviewHash !==
      digestRawBytes32(reviewEvidenceHash) ||
    registeredRecordPreimage.reviewDeploymentBindingHash !==
      digestRawBytes32(
        digest(
          record(source.verifiedReview, "custom-registry-producer-review").deploymentBindingHash,
          "custom-registry-producer-review-deployment",
        ),
      ) ||
    registeredRecordPreimage.feePolicyHash !==
      customRegistryOnchainFeePolicyHashV1(onchainFeePolicy)
  ) {
    return fail("custom-registry-producer-record-preimage-cross-binding");
  }
  const authorityInventory = record(
    source.postLaunchAuthorityInventory,
    "custom-registry-producer-authority-inventory",
  );
  const authorityInventoryWallet = record(
    authorityInventory.launchingWallet,
    "custom-registry-producer-authority-inventory-wallet",
  );
  const authorityInventoryHash = digest(
    authorityInventory.postLaunchAuthorityInventoryHash,
    "custom-registry-producer-authority-inventory-hash",
  );
  const authorities = array(
    authorityInventory.authorities,
    "custom-registry-producer-authorities",
  );
  for (const authority of authorities) {
    assertJsonValue(authority, "custom-registry-producer-authority");
  }
  if (
    authorityInventory.schemaVersion !==
      "programmable.custom-launch-post-launch-authorities.v3" ||
    authorityInventoryWallet.namespace !== "eip155-address" ||
    authorityInventoryWallet.value !== launchingWallet.value ||
    authorityInventoryHash !== source.postLaunchAuthorityInventoryHash ||
    authorityInventoryHash !==
      sha256("programmable.custom-launch-post-launch-authorities.v3", {
        schemaVersion: authorityInventory.schemaVersion,
        launchingWallet: authorityInventory.launchingWallet,
        authorities,
      })
  ) {
    return fail("custom-registry-producer-authority-inventory-binding");
  }
  const model = record(source.model, "custom-registry-producer-model");
  const template = source.template === null
    ? null
    : record(source.template, "custom-registry-producer-template");
  const partner = source.partner === null
    ? null
    : record(source.partner, "custom-registry-producer-partner");
  const review = record(
    source.verifiedReview,
    "custom-registry-producer-review-preimage",
  );
  const finalityPolicy = record(
    source.finalityPolicy,
    "custom-registry-producer-finality-policy",
  );
  const finality = record(
    source.finality,
    "custom-registry-producer-finality",
  );
  const confirmationDepth = safeInteger(
    finalityPolicy.confirmationDepth,
    "custom-registry-producer-finality-confirmations",
  );
  if (
    finalityPolicy.schemaVersion !== CUSTOM_REGISTRY_FINALITY_POLICY_DOMAIN_V1 ||
    confirmationDepth < 1 ||
    confirmationDepth > 255 ||
    finalityPolicy.canonicalitySource !== "evm-blockhash" ||
    finalityPolicy.reorgHandling !== "orphan" ||
    digest(
      finalityPolicy.verificationAuthorityHash,
      "custom-registry-producer-finality-authority",
    ) !== finality.verificationAuthorityHash
  ) {
    return fail("custom-registry-producer-finality-policy-binding");
  }
  const finalityStatus = String(finality.status);
  if (
    !new Set(["observed", "confirmed", "finalized", "orphaned"]).has(
      finalityStatus,
    ) ||
    bytes32(finality.transactionHash, "custom-registry-producer-finality-transaction") !==
      registryOrigin.registrationTransactionHash ||
    bytes32(finality.blockHash, "custom-registry-producer-finality-block-hash") !==
      registryOrigin.registrationBlockHash ||
    decimal(finality.blockNumber, "custom-registry-producer-finality-block") !==
      registryOrigin.registrationBlockNumber ||
    decimal(
      finality.transactionIndex,
      "custom-registry-producer-finality-transaction-index",
    ) !== registryOrigin.registrationTransactionIndex ||
    nullableDecimal(
      finality.logIndex,
      "custom-registry-producer-finality-log-index",
    ) !== registryOrigin.registrationLogIndex ||
    instant(
      finality.onchainTimestamp,
      "custom-registry-producer-finality-onchain-time",
    ).length === 0 ||
    instant(
      finality.observedAt,
      "custom-registry-producer-finality-observed-time",
    ).length === 0
  ) {
    return fail("custom-registry-producer-finality-chain-binding");
  }
  const confirmedAt = finality.confirmedAt === null
    ? null
    : instant(
        finality.confirmedAt,
        "custom-registry-producer-finality-confirmed-time",
      );
  const finalizedAt = finality.finalizedAt === null
    ? null
    : instant(
        finality.finalizedAt,
        "custom-registry-producer-finality-finalized-time",
      );
  const orphanedAt = finality.orphanedAt === null
    ? null
    : instant(
        finality.orphanedAt,
        "custom-registry-producer-finality-orphaned-time",
      );
  digest(
    finality.finalityEvidenceHash,
    "custom-registry-producer-finality-evidence",
  );
  if (
    (finalityStatus === "observed" &&
      (confirmedAt !== null || finalizedAt !== null || orphanedAt !== null)) ||
    (finalityStatus === "confirmed" &&
      (confirmedAt === null || finalizedAt !== null || orphanedAt !== null)) ||
    (finalityStatus === "finalized" &&
      (confirmedAt === null || finalizedAt === null || orphanedAt !== null)) ||
    (finalityStatus === "orphaned" && orphanedAt === null)
  ) {
    return fail("custom-registry-producer-finality-transition");
  }
  const lifecycle = record(
    source.lifecycle,
    "custom-registry-producer-lifecycle",
  );
  const lifecycleStatus = String(lifecycle.status);
  if (
    !new Set(["pending", "active", "orphaned", "superseded", "revoked"]).has(
      lifecycleStatus,
    ) ||
    lifecycle.registryGeneration !== registryOrigin.registryGeneration ||
    instant(
      lifecycle.registeredAt,
      "custom-registry-producer-lifecycle-registered-at",
    ).length === 0 ||
    ((finalityStatus === "observed" || finalityStatus === "confirmed") &&
      lifecycleStatus !== "pending") ||
    (finalityStatus === "finalized" &&
      !new Set(["active", "superseded", "revoked"]).has(lifecycleStatus)) ||
    (finalityStatus === "orphaned" && lifecycleStatus !== "orphaned")
  ) {
    return fail("custom-registry-producer-lifecycle-binding");
  }
  const lifecycleSupersededBy = lifecycle.supersededBy === null
    ? null
    : digest(
        lifecycle.supersededBy,
        "custom-registry-producer-lifecycle-superseded",
      );
  const lifecycleRevokedAt = lifecycle.revokedAt === null
    ? null
    : instant(
        lifecycle.revokedAt,
        "custom-registry-producer-lifecycle-revoked-at",
      );
  const lifecycleRevocationEvidence = lifecycle.revocationEvidenceHash === null
    ? null
    : digest(
        lifecycle.revocationEvidenceHash,
        "custom-registry-producer-lifecycle-revocation-evidence",
      );
  if (
    ((lifecycleStatus === "pending" || lifecycleStatus === "active" ||
      lifecycleStatus === "orphaned") &&
      (lifecycleSupersededBy !== null || lifecycleRevokedAt !== null ||
        lifecycleRevocationEvidence !== null)) ||
    (lifecycleStatus === "superseded" &&
      (lifecycleSupersededBy === null || lifecycleRevokedAt !== null ||
        lifecycleRevocationEvidence !== null)) ||
    (lifecycleStatus === "revoked" &&
      (lifecycleSupersededBy !== null || lifecycleRevokedAt === null ||
        lifecycleRevocationEvidence === null))
  ) {
    return fail("custom-registry-producer-lifecycle-transition");
  }
  const contractSetHash = digest(
    deployment.contractSetHash,
    "custom-registry-producer-contract-set-hash",
  );
  if (
    contractSetHash !==
      sha256("programmable.custom-launch-deployed-contract-set.v1", contracts)
  ) {
    return fail("custom-registry-producer-contract-set-binding");
  }
  const expectedRuntimeSetHash = customRegistryStructuredFieldV1(
    "runtimeCodeSetHash",
    contracts.map((value) => {
      const contract = record(value, "custom-registry-producer-runtime-set-contract");
      return {
        address: contract.address,
        runtimeCodeKeccak256: contract.runtimeCodeKeccak256,
        runtimeCodeSha256: contract.runtimeCodeSha256,
      };
    }),
  );
  const expectedImmutableFields = Object.freeze({
    approvalId: customRegistryStructuredFieldV1(
      "approvalId",
      approval.approvalId,
    ),
    repositoryId: customRegistryStructuredFieldV1("repositoryId", {
      repositoryId: approval.repositoryId,
      repositoryUri: approval.repositoryUri,
    }),
    commitId: customRegistryStructuredFieldV1("commitId", {
      repositoryId: approval.repositoryId,
      commitObjectId: approval.commitObjectId,
      treeObjectId: approval.treeObjectId,
    }),
    deploymentId: customRegistryStructuredFieldV1("deploymentId", {
      launchArtifactCommitmentHash: deployment.launchArtifactCommitmentHash,
      artifactManifestHash: deployment.artifactManifestHash,
      deploymentCalldataHash: deployment.deploymentCalldataHash,
    }),
    deploymentSetHash: digestRawBytes32(contractSetHash),
    runtimeCodeSetHash: expectedRuntimeSetHash,
    modelId: customRegistryStructuredFieldV1("modelId", model.id),
    modelVersion: customRegistryStructuredFieldV1("modelVersion", {
      modelId: model.id,
      modelVersion: model.version,
    }),
    templateId: template === null
      ? ZERO_BYTES32
      : customRegistryStructuredFieldV1("templateId", template.id),
    templateVersion: template === null
      ? ZERO_BYTES32
      : customRegistryStructuredFieldV1("templateVersion", {
          templateId: template.id,
          templateVersion: template.version,
        }),
    partnerId: partner === null
      ? ZERO_BYTES32
      : customRegistryStructuredFieldV1("partnerId", partner.id),
    builderAttributionHash: customRegistryStructuredFieldV1(
      "builderAttributionHash",
      {
        repositoryId: approval.repositoryId,
        repositoryUri: approval.repositoryUri,
      },
    ),
    originHash: customRegistryStructuredFieldV1("originHash", {
      platformId: source.platformId,
      origin: source.origin,
      category: source.category,
      launchFamily: source.launchFamily,
    }),
    capabilitySetHash: canonicalCapabilitySetHash,
    reviewResultId: customRegistryStructuredFieldV1("reviewResultId", {
      label: review.label,
      definition: review.definition,
      reviewerType: review.reviewerType,
    }),
    finalityPolicyHash: customRegistryFinalityPolicyHashV1(finalityPolicy),
  });
  for (const [field, expected] of Object.entries(expectedImmutableFields)) {
    if (
      registeredRecordPreimage[
        field as keyof typeof expectedImmutableFields
      ] !== expected
    ) {
      return fail(`custom-registry-producer-record-preimage-${field}`);
    }
  }
  if ((source.presentation === null) !== (source.presentationBindingHash === null)) {
    return fail("custom-registry-producer-presentation-binding");
  }
  if (source.presentationBindingHash !== null) {
    digest(
      source.presentationBindingHash,
      "custom-registry-producer-presentation-binding",
    );
  }
  assertJsonValue(source, "custom-registry-producer-json");
  if (Buffer.byteLength(canonicalJson(source), "utf8") > MAX_RECORD_BYTES) {
    return fail("custom-registry-producer-oversize");
  }
  return value;
}

function validateRecordStatic(
  value: CustomRegistryEventV3["record"],
  event: CustomRegistryEventV3,
): NonNullable<CustomRegistryEventV3["record"]> {
  const source = record(value, "custom-registry-record");
  if (
    source.schemaVersion !== CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V3 ||
    source.platformId !== "programmable" ||
    source.category !== "custom" ||
    source.publicLabel !== PROGRAMMABLE_CUSTOM_LABEL ||
    digest(source.launchId, "custom-registry-launch-id") !==
      event.launchId ||
    digest(source.projectId, "custom-registry-project-id") !==
      event.projectId ||
    decimal(source.chainId, "custom-registry-record-chain", true) !== event.chainId ||
    source.caip2 !== event.caip2
  ) {
    return fail("custom-registry-record-identity");
  }
  const model = record(source.model, "custom-registry-model");
  safeId(model.id, "custom-registry-model-id");
  if (model.version !== null) safeId(model.version, "custom-registry-model-version");
  const template = source.template === null
    ? null
    : record(source.template, "custom-registry-template");
  if (template !== null) {
    safeId(template.id, "custom-registry-template-id");
    safeId(template.version, "custom-registry-template-version");
  }
  if (source.partner !== null) {
    const partnerSource = record(source.partner, "custom-registry-partner");
    const status = partnerSource.status;
    if (!new Set(["active", "paused", "retired"]).has(String(status))) {
      return fail("custom-registry-partner-status");
    }
    safeId(partnerSource.id, "custom-registry-partner-id");
    text(partnerSource.name, "custom-registry-partner-name", 256);
    address(partnerSource.recipient, "custom-registry-partner-recipient");
    if (template === null) return fail("custom-registry-partner-template");
  }
  assertJsonValue(source.builderAttribution, "custom-registry-builder");
  const approval = record(source.approvalBinding, "custom-registry-approval");
  if (
    digest(approval.projectId, "custom-registry-approval-project") !==
    event.projectId
  ) {
    return fail("custom-registry-approval-project");
  }
  safeId(approval.applicationId, "custom-registry-application-id");
  safeId(approval.approvalId, "custom-registry-approval-id");
  safeId(approval.repositoryId, "custom-registry-repository-id");
  exactHttpsUrl(approval.repositoryUri, "custom-registry-repository-uri");
  if (typeof approval.commitObjectId !== "string" || !COMMIT.test(approval.commitObjectId)) {
    return fail("custom-registry-commit");
  }
  if (typeof approval.treeObjectId !== "string" || !COMMIT.test(approval.treeObjectId)) {
    return fail("custom-registry-tree");
  }
  for (const field of [
    "sourceCommitment",
    "buildCommitment",
    "artifactSetHash",
    "configurationCommitment",
    "launchWalletBindingHash",
    "chainProfileHash",
    "decisionReceiptDigest",
  ]) {
    digest(approval[field], `custom-registry-approval-${field}`);
  }
  const deployment = record(source.deploymentBinding, "custom-registry-deployment-binding");
  for (const field of [
    "launchArtifactCommitmentHash",
    "artifactManifestHash",
    "artifactOutputSetHash",
    "deploymentCalldataHash",
    "verificationEvidenceHash",
  ]) {
    digest(deployment[field], `custom-registry-deployment-${field}`);
  }
  if (deployment.runtimeMatch !== true) return fail("custom-registry-runtime-match");
  const contractAddresses = new Set<string>();
  const runtimeHashes = new Set<string>();
  const contracts = array(
    deployment.contracts,
    "custom-registry-contracts",
  );
  if (contracts.length === 0) return fail("custom-registry-contracts-empty");
  for (const contractValue of contracts) {
    const contract = record(contractValue, "custom-registry-contract");
    const contractAddress = address(contract.address, "custom-registry-contract-address");
    const runtimeHash = bytes32(
      contract.runtimeCodeHash,
      "custom-registry-contract-runtime",
    );
    safeId(contract.role, "custom-registry-contract-role");
    if (contractAddresses.has(contractAddress)) {
      return fail("custom-registry-contract-duplicate");
    }
    contractAddresses.add(contractAddress);
    runtimeHashes.add(runtimeHash);
  }
  const launch = record(source.launch, "custom-registry-launch");
  if (launch.creator !== null) address(launch.creator, "custom-registry-creator");
  address(launch.launchWallet, "custom-registry-launch-wallet");
  bytes32(launch.transactionHash, "custom-registry-launch-transaction");
  decimal(launch.blockNumber, "custom-registry-launch-block", true);
  bytes32(launch.blockHash, "custom-registry-launch-block-hash");
  safeInteger(launch.transactionIndex, "custom-registry-launch-transaction-index");
  if (launch.logIndex !== null) safeInteger(launch.logIndex, "custom-registry-launch-log-index");
  instant(launch.onchainTimestamp, "custom-registry-launch-timestamp");
  if (
    event.operation === "registered" &&
    (event.primaryContract === null ||
      !contractAddresses.has(event.primaryContract) ||
      event.launchWallet !== launch.launchWallet)
  ) {
    return fail("custom-registry-registration-deployment-binding");
  }

  const assetIds = new Set<string>();
  for (const assetValue of array(source.assets, "custom-registry-assets")) {
    const asset = record(assetValue, "custom-registry-asset");
    const assetId = safeId(asset.assetId, "custom-registry-asset-id");
    if (assetIds.has(assetId)) return fail("custom-registry-asset-duplicate");
    assetIds.add(assetId);
    safeId(asset.role, "custom-registry-asset-role");
    safeId(asset.kind, "custom-registry-asset-kind");
    if (asset.address !== null) address(asset.address, "custom-registry-asset-address");
    optionalText(asset.name, "custom-registry-asset-name", 256);
    optionalText(asset.symbol, "custom-registry-asset-symbol", 64);
    if (
      asset.decimals !== null &&
      (typeof asset.decimals !== "number" ||
        !Number.isInteger(asset.decimals) ||
        asset.decimals < 0 ||
        asset.decimals > 255)
    ) {
      return fail("custom-registry-asset-decimals");
    }
    const supply = record(asset.supply, "custom-registry-asset-supply");
    if (!new Set(["fixed", "dynamic", "unknown", "not-applicable"]).has(String(supply.status))) {
      return fail("custom-registry-supply-status");
    }
    if (supply.totalRaw !== null) decimal(supply.totalRaw, "custom-registry-supply-total");
    if (supply.observedAtBlock !== null) {
      decimal(supply.observedAtBlock, "custom-registry-supply-block");
    }
    const provenance = record(asset.provenance, "custom-registry-asset-provenance");
    if (!new Set(["launch-produced", "adopted-external", "unknown"]).has(String(provenance.kind))) {
      return fail("custom-registry-provenance-kind");
    }
    if (provenance.runtimeCodeHash !== null) {
      bytes32(provenance.runtimeCodeHash, "custom-registry-asset-runtime");
    }
    digest(provenance.evidenceHash, "custom-registry-asset-evidence");
    assertJsonValue(asset.onchainMetadata, "custom-registry-onchain-metadata");
    assertJsonValue(asset.creatorMetadata, "custom-registry-creator-metadata");
  }

  const marketIds = new Set<string>();
  for (const marketValue of array(source.markets, "custom-registry-markets")) {
    const market = record(marketValue, "custom-registry-market");
    const marketId = safeId(market.marketId, "custom-registry-market-id");
    if (marketIds.has(marketId)) return fail("custom-registry-market-duplicate");
    marketIds.add(marketId);
    safeId(market.kind, "custom-registry-market-kind");
    if (!new Set(["planned", "active", "paused", "retired", "unknown"]).has(String(market.lifecycle))) {
      return fail("custom-registry-market-lifecycle");
    }
    for (const field of ["baseAssetId", "quoteAssetId"] as const) {
      if (market[field] !== null && !assetIds.has(safeId(market[field], `custom-registry-market-${field}`))) {
        return fail("custom-registry-market-asset-reference");
      }
    }
    for (const field of [
      "marketContract",
      "poolAddress",
      "hookAddress",
      "poolManagerAddress",
    ] as const) {
      if (market[field] !== null) address(market[field], `custom-registry-market-${field}`);
    }
    if (market.poolId !== null) bytes32(market.poolId, "custom-registry-pool-id");
    if (market.tickSpacing !== null && (!Number.isSafeInteger(market.tickSpacing) || Math.abs(market.tickSpacing as number) > 16_777_215)) {
      return fail("custom-registry-tick-spacing");
    }
    if (market.dynamicFee !== null && typeof market.dynamicFee !== "boolean") {
      return fail("custom-registry-dynamic-fee");
    }
    const support = record(market.support, "custom-registry-market-support");
    for (const field of ["charting", "quote", "simulation", "execution"]) {
      if (!new Set(["supported", "unsupported", "unknown"]).has(String(support[field]))) {
        return fail("custom-registry-market-support");
      }
    }
    if (market.adapter !== null) {
      const adapter = record(market.adapter, "custom-registry-market-adapter");
      safeId(adapter.id, "custom-registry-market-adapter-id");
      safeId(adapter.version, "custom-registry-market-adapter-version");
    }
    assertJsonValue(market.metrics, "custom-registry-market-metrics");
    digest(market.evidenceHash, "custom-registry-market-evidence");
  }
  for (const collection of [source.capabilities, source.mechanisms]) {
    for (const itemValue of array(collection, "custom-registry-extensible-items")) {
      const item = record(itemValue, "custom-registry-extensible-item");
      safeId(item.id, "custom-registry-extensible-id");
      if (item.version !== null) safeId(item.version, "custom-registry-extensible-version");
      text(item.status, "custom-registry-extensible-status", 128);
      assertJsonValue(item.parameters, "custom-registry-extensible-parameters");
    }
  }
  const review = record(source.securityReview, "custom-registry-security-review");
  if (!new Set(["not-reviewed", "reviewed", "superseded", "revoked"]).has(String(review.status))) {
    return fail("custom-registry-review-status");
  }
  safeId(review.policyVersion, "custom-registry-policy-version");
  digest(review.policyCommitment, "custom-registry-policy-commitment");
  exactHttpsUrl(review.repositoryUri, "custom-registry-review-repository");
  if (review.repositoryUri !== approval.repositoryUri || review.commitObjectId !== approval.commitObjectId) {
    return fail("custom-registry-review-revision");
  }
  for (const field of [
    "sourceCommitment",
    "buildCommitment",
    "artifactSetHash",
    "configurationCommitment",
    "deploymentBindingHash",
  ]) {
    digest(review[field], `custom-registry-review-${field}`);
  }
  if (
    review.sourceCommitment !== approval.sourceCommitment ||
    review.buildCommitment !== approval.buildCommitment ||
    review.artifactSetHash !== approval.artifactSetHash ||
    review.configurationCommitment !== approval.configurationCommitment
  ) {
    return fail("custom-registry-review-binding");
  }
  const reviewedRuntimeHashes = array(
    review.runtimeCodeHashes,
    "custom-registry-review-runtimes",
  ).map((value) => bytes32(value, "custom-registry-review-runtime"));
  if (
    reviewedRuntimeHashes.length !== runtimeHashes.size ||
    reviewedRuntimeHashes.some((value) => !runtimeHashes.has(value))
  ) {
    return fail("custom-registry-review-runtime-set");
  }
  for (const field of ["authorities", "dependencies", "findings"]) {
    const items = array(review[field], `custom-registry-review-${field}`);
    for (const item of items) assertJsonValue(item, `custom-registry-review-${field}`);
  }
  for (const field of ["upgradeability", "pause", "custody"]) {
    assertJsonValue(review[field], `custom-registry-review-${field}`);
  }
  if (review.reviewedAt !== null) instant(review.reviewedAt, "custom-registry-reviewed-at");
  safeId(review.reviewerType, "custom-registry-reviewer-type");
  if (review.supersededBy !== null) digest(review.supersededBy, "custom-registry-review-superseded");
  if (review.revokedAt !== null) instant(review.revokedAt, "custom-registry-review-revoked-at");
  if (review.revocationEvidenceHash !== null) {
    digest(review.revocationEvidenceHash, "custom-registry-review-revocation-evidence");
  }
  if (
    (review.status === "reviewed" && review.reviewedAt === null) ||
    (review.status === "superseded" && review.supersededBy === null) ||
    (review.status === "revoked" &&
      (review.revokedAt === null || review.revocationEvidenceHash === null))
  ) {
    return fail("custom-registry-review-lifecycle");
  }
  const finality = record(source.finality, "custom-registry-launch-finality");
  if (
    finality.status !== "finalized" ||
    finality.orphanedAt !== null ||
    finality.transactionHash !== launch.transactionHash ||
    finality.blockHash !== launch.blockHash ||
    finality.blockNumber !== launch.blockNumber ||
    finality.transactionIndex !== launch.transactionIndex ||
    finality.logIndex !== launch.logIndex ||
    finality.onchainTimestamp !== launch.onchainTimestamp
  ) {
    return fail("custom-registry-launch-finality-binding");
  }
  instant(finality.observedAt, "custom-registry-launch-observed-at");
  instant(finality.confirmedAt, "custom-registry-launch-confirmed-at");
  instant(finality.finalizedAt, "custom-registry-launch-finalized-at");
  digest(finality.finalityEvidenceHash, "custom-registry-finality-evidence");
  digest(finality.verificationAuthorityHash, "custom-registry-finality-authority");

  const presentation = record(source.presentation, "custom-registry-presentation");
  optionalText(presentation.description, "custom-registry-description", 4_096);
  for (const field of ["image", "website", "x", "telegram", "discord", "github", "docs"]) {
    optionalHttpsUrl(presentation[field], `custom-registry-presentation-${field}`);
  }
  assertJsonValue(presentation.extensions, "custom-registry-presentation-extensions");

  assertJsonValue(source, "custom-registry-record-json");
  if (Buffer.byteLength(canonicalJson(source), "utf8") > MAX_RECORD_BYTES) {
    return fail("custom-registry-record-oversize");
  }
  return value as NonNullable<CustomRegistryEventV3["record"]>;
}

function deploymentForEvent(
  manifest: CustomRegistryDeploymentManifestV3,
  event: CustomRegistryEventV3,
): Readonly<{
  chain: CustomRegistryChainManifestV3;
  deployment: CustomRegistryDeploymentV3;
}> {
  const chain = manifest.chains.find((item) => item.chainId === event.chainId);
  if (
    !chain ||
    chain.caip2 !== event.caip2 ||
    chain.status === "prelaunch" ||
    chain.status === "retired"
  ) {
    return fail("custom-registry-unofficial-chain");
  }
  const deployment = chain.registries.find(
    (item) =>
      item.registryGeneration === event.registryGeneration &&
      item.address === event.registryAddress,
  );
  if (
    !deployment ||
    deployment.status === "paused" ||
    event.observedRegistryRuntimeCodeHash !== deployment.runtimeCodeHash ||
    !deployment.authorizedWriters.includes(event.registryWriter) ||
    BigInt(event.blockNumber) < BigInt(deployment.startBlock) ||
    (deployment.retiredAtBlock !== null &&
      BigInt(event.blockNumber) > BigInt(deployment.retiredAtBlock)) ||
    deployment.topics[event.operation] !== event.topic0
  ) {
    return fail("custom-registry-unofficial-event");
  }
  return { chain, deployment };
}

function validateApprovalAuthorization(
  value: CustomRegistryApprovalAuthorizationV3,
  event: CustomRegistryEventV3,
  deployment: CustomRegistryDeploymentV3,
): CustomRegistryApprovalAuthorizationV3 {
  const authorization = record(
    value,
    "custom-registry-approval-authorization",
  ) as unknown as CustomRegistryApprovalAuthorizationV3;
  decimal(authorization.blockNumber, "custom-registry-approval-block", true);
  decimal(
    authorization.transitionSequence,
    "custom-registry-approval-transition-sequence",
    true,
  );
  decimal(
    authorization.validAfterBlock,
    "custom-registry-approval-valid-after",
    true,
  );
  decimal(
    authorization.expiresAtBlock,
    "custom-registry-approval-expires",
    true,
  );
  bytes32(authorization.transactionHash, "custom-registry-approval-transaction");
  bytes32(authorization.blockHash, "custom-registry-approval-block-hash");
  bytes32(authorization.approvalId, "custom-registry-approval-id");
  bytes32(authorization.registryLaunchIdRaw, "custom-registry-approval-launch-id");
  bytes32(
    authorization.registryApprovalBindingHashRaw,
    "custom-registry-approval-binding-hash",
  );
  bytes32(
    authorization.registrationBindingHash,
    "custom-registry-approval-registration-binding",
  );
  bytes32(authorization.evidenceHash, "custom-registry-approval-evidence");
  address(authorization.registryApprover, "custom-registry-approval-approver");
  address(authorization.registryAddress, "custom-registry-approval-registry");
  bytes32(
    authorization.observedRegistryRuntimeCodeHash,
    "custom-registry-approval-registry-runtime",
  );
  bytes32(authorization.topic0, "custom-registry-approval-topic");
  safeInteger(
    authorization.transactionIndex,
    "custom-registry-approval-transaction-index",
  );
  safeInteger(authorization.logIndex, "custom-registry-approval-log-index");
  instant(authorization.onchainTimestamp, "custom-registry-approval-timestamp");
  if (
    authorization.chainId !== event.chainId ||
    authorization.caip2 !== event.caip2 ||
    authorization.registryGeneration !== event.registryGeneration ||
    authorization.registryAddress !== event.registryAddress ||
    authorization.observedRegistryRuntimeCodeHash !==
      event.observedRegistryRuntimeCodeHash ||
    !deployment.authorizedApprovers.includes(authorization.registryApprover) ||
    authorization.topic0 !== deployment.topics.approvalAuthorized ||
    authorization.approvalId !== event.approvalId ||
    authorization.registryLaunchIdRaw !== event.registryLaunchIdRaw ||
    authorization.registrationBindingHash !== event.identityHash ||
    authorization.transactionHash === event.transactionHash ||
    BigInt(authorization.blockNumber) > BigInt(event.blockNumber) ||
    (authorization.blockNumber === event.blockNumber &&
      authorization.transactionIndex >= event.transactionIndex) ||
    BigInt(authorization.blockNumber) < BigInt(deployment.startBlock) ||
    BigInt(authorization.validAfterBlock) > BigInt(event.blockNumber) ||
    BigInt(authorization.expiresAtBlock) < BigInt(event.blockNumber) ||
    BigInt(authorization.validAfterBlock) >
      BigInt(authorization.expiresAtBlock) ||
    (deployment.retiredAtBlock !== null &&
      BigInt(authorization.blockNumber) > BigInt(deployment.retiredAtBlock))
  ) {
    return fail("custom-registry-approval-authorization-binding");
  }
  return authorization;
}

function validateEvent(
  manifest: CustomRegistryDeploymentManifestV3,
  value: CustomRegistryEventV3,
): Readonly<{
  event: CustomRegistryEventV3;
  chain: CustomRegistryChainManifestV3;
  deployment: CustomRegistryDeploymentV3;
}> {
  const event = record(value, "custom-registry-event") as unknown as CustomRegistryEventV3;
  if (!new Set(["registered", "finalized", "corrected", "revoked"]).has(event.operation)) {
    return fail("custom-registry-operation");
  }
  decimal(event.chainId, "custom-registry-event-chain", true);
  text(event.caip2, "custom-registry-event-caip2", 96);
  decimal(event.registryGeneration, "custom-registry-event-generation", true);
  address(event.registryAddress, "custom-registry-event-address");
  bytes32(event.observedRegistryRuntimeCodeHash, "custom-registry-event-runtime");
  address(event.registryWriter, "custom-registry-event-writer");
  bytes32(event.topic0, "custom-registry-event-topic");
  bytes32(event.transactionHash, "custom-registry-event-transaction");
  decimal(event.blockNumber, "custom-registry-event-block", true);
  bytes32(event.blockHash, "custom-registry-event-block-hash");
  safeInteger(event.transactionIndex, "custom-registry-event-transaction-index");
  safeInteger(event.logIndex, "custom-registry-event-log-index");
  instant(event.onchainTimestamp, "custom-registry-event-timestamp");
  digest(event.launchId, "custom-registry-event-launch-id");
  digest(event.projectId, "custom-registry-event-project-id");
  bytes32(event.registryLaunchIdRaw, "custom-registry-event-registry-launch-id");
  bytes32(event.registryProjectIdRaw, "custom-registry-event-registry-project-id");
  if (
    event.registryLaunchIdRaw !== digestRawBytes32(event.launchId) ||
    event.registryProjectIdRaw !== digestRawBytes32(event.projectId)
  ) {
    return fail("custom-registry-event-raw-id-binding");
  }
  bytes32(event.registeredRecordHash, "custom-registry-event-registered-record");
  bytes32(event.latestOnchainRecordHash, "custom-registry-event-latest-record");
  if (event.previousOnchainRecordHash !== null) {
    bytes32(
      event.previousOnchainRecordHash,
      "custom-registry-event-previous-record",
    );
  }
  if (event.revocationEvidenceHash !== null) {
    digest(event.revocationEvidenceHash, "custom-registry-event-revocation");
  }
  const registrationSequence = nullableDecimal(
    event.registrationSequence,
    "custom-registry-registration-sequence",
    true,
  );
  const transitionSequence = nullableDecimal(
    event.transitionSequence,
    "custom-registry-transition-sequence",
    true,
  );
  const recordRevision = nullableDecimal(
    event.recordRevision,
    "custom-registry-record-revision",
    true,
  );
  if (event.primaryContract !== null) {
    address(event.primaryContract, "custom-registry-primary-contract");
  }
  if (event.launchWallet !== null) {
    address(event.launchWallet, "custom-registry-event-launch-wallet");
  }
  for (const [field, value] of [
    ["approval-id", event.approvalId],
    ["deployment-id", event.deploymentId],
    ["identity-hash", event.identityHash],
    ["observed-transaction-hash", event.observedTransactionHash],
    ["finality-evidence-hash", event.finalityEvidenceHash],
    ["confirmed-head-hash", event.confirmedHeadBlockHash],
    ["finality-policy-hash", event.finalityPolicyHash],
    ["reason-code", event.reasonCode],
    ["evidence-hash", event.evidenceHash],
  ] as const) {
    if (value !== null) bytes32(value, `custom-registry-${field}`);
  }
  const observedAtBlock = nullableDecimal(
    event.observedAtBlock,
    "custom-registry-observed-at-block",
    true,
  );
  const confirmedHeadBlockNumber = nullableDecimal(
    event.confirmedHeadBlockNumber,
    "custom-registry-confirmed-head-block",
    true,
  );
  const finalizedAtBlock = nullableDecimal(
    event.finalizedAtBlock,
    "custom-registry-finalized-at-block",
    true,
  );
  const finalizedAtTimestamp = nullableDecimal(
    event.finalizedAtTimestamp,
    "custom-registry-finalized-at-timestamp",
    true,
  );
  const registrationEvidence =
    registrationSequence !== null &&
    transitionSequence === null &&
    recordRevision === null &&
    event.primaryContract !== null &&
    event.launchWallet !== null &&
    event.approvalId !== null &&
    event.deploymentId !== null &&
    event.identityHash !== null &&
    observedAtBlock !== null &&
    event.observedTransactionHash === null &&
    event.finalityEvidenceHash === null &&
    confirmedHeadBlockNumber === null &&
    event.confirmedHeadBlockHash === null &&
    event.finalityPolicyHash === null &&
    finalizedAtBlock === null &&
    finalizedAtTimestamp === null &&
    event.reasonCode === null &&
    event.evidenceHash === null &&
    observedAtBlock === event.blockNumber;
  const finalizedEvidence =
    registrationSequence === null &&
    transitionSequence !== null &&
    recordRevision === null &&
    event.primaryContract === null &&
    event.launchWallet === null &&
    event.approvalId === null &&
    event.deploymentId === null &&
    event.identityHash === null &&
    observedAtBlock !== null &&
    event.observedTransactionHash !== null &&
    event.finalityEvidenceHash !== null &&
    confirmedHeadBlockNumber !== null &&
    event.confirmedHeadBlockHash !== null &&
    event.finalityPolicyHash !== null &&
    finalizedAtBlock !== null &&
    finalizedAtTimestamp !== null &&
    event.reasonCode === null &&
    event.evidenceHash === null &&
    BigInt(confirmedHeadBlockNumber) >= BigInt(observedAtBlock) &&
    BigInt(finalizedAtBlock) >= BigInt(observedAtBlock) &&
    BigInt(confirmedHeadBlockNumber) >= BigInt(finalizedAtBlock) &&
    BigInt(event.blockNumber) >= BigInt(finalizedAtBlock);
  const mutationEvidence =
    registrationSequence === null &&
    transitionSequence !== null &&
    recordRevision !== null &&
    event.primaryContract === null &&
    event.launchWallet === null &&
    event.approvalId === null &&
    event.deploymentId === null &&
    event.identityHash === null &&
    observedAtBlock === null &&
    event.observedTransactionHash === null &&
    event.finalityEvidenceHash === null &&
    confirmedHeadBlockNumber === null &&
    event.confirmedHeadBlockHash === null &&
    event.finalityPolicyHash === null &&
    finalizedAtBlock === null &&
    finalizedAtTimestamp === null &&
    event.reasonCode !== null &&
    event.evidenceHash !== null;
  if (
    (event.operation === "registered" &&
      (event.record === null ||
        event.producerRecord === null ||
        event.approvalAuthorization === null ||
        event.previousOnchainRecordHash !== null ||
        event.registeredRecordHash !== event.latestOnchainRecordHash ||
        event.revocationEvidenceHash !== null ||
        !registrationEvidence)) ||
    (event.operation === "finalized" &&
      (event.record !== null ||
        event.producerRecord === null ||
        event.approvalAuthorization !== null ||
        event.previousOnchainRecordHash !== null ||
        event.revocationEvidenceHash !== null ||
        !finalizedEvidence)) ||
    (event.operation === "corrected" &&
      (event.record === null ||
        event.producerRecord === null ||
        event.approvalAuthorization !== null ||
        event.previousOnchainRecordHash === null ||
        event.revocationEvidenceHash !== null ||
        !mutationEvidence)) ||
    (event.operation === "revoked" &&
      (event.record !== null ||
        event.producerRecord === null ||
        event.approvalAuthorization !== null ||
        event.previousOnchainRecordHash === null ||
        event.previousOnchainRecordHash !== event.latestOnchainRecordHash ||
        event.revocationEvidenceHash === null ||
        !mutationEvidence))
  ) {
    return fail("custom-registry-event-shape");
  }
  const { chain, deployment } = deploymentForEvent(manifest, event);
  const companions = array(
    event.registrationCompanions,
    "custom-registry-registration-companions",
    5,
  );
  if (event.operation === "registered") {
    const expectedKinds: readonly RegistryRegistrationCompanionKindV3[] = [
      "provenance",
      "review",
      "attribution",
      "feePolicy",
      "feeEvidence",
    ];
    const seenKinds = new Set<string>();
    const seenLogIndexes = new Set<number>([event.logIndex]);
    for (const value of companions) {
      const companion = record(
        value,
        "custom-registry-registration-companion",
      );
      const kind = companion.kind as RegistryRegistrationCompanionKindV3;
      const logIndex = safeInteger(
        companion.logIndex,
        "custom-registry-registration-companion-log-index",
      );
      if (
        !expectedKinds.includes(kind) ||
        companion.topic0 !== deployment.topics[kind] ||
        seenKinds.has(kind) ||
        seenLogIndexes.has(logIndex)
      ) {
        return fail("custom-registry-registration-companion-binding");
      }
      seenKinds.add(kind);
      seenLogIndexes.add(logIndex);
    }
    if (companions.length !== expectedKinds.length) {
      return fail("custom-registry-registration-companion-set");
    }
  } else if (companions.length !== 0) {
    return fail("custom-registry-transition-companions");
  }
  const authorization = event.approvalAuthorization === null
    ? null
    : validateApprovalAuthorization(
        event.approvalAuthorization,
        event,
        deployment,
      );
  if (event.producerRecord !== null) {
    validateProducerRecord(event.producerRecord, event);
    if (
      authorization !== null &&
      authorization.registryApprovalBindingHashRaw !==
        event.producerRecord.registryOrigin.registryApprovalBindingHashRaw
    ) {
      return fail("custom-registry-producer-approval-authorization-binding");
    }
    if (
      event.operation === "registered" &&
      event.producerRecord.registryOrigin.registryStartBlock !==
      deployment.startBlock
    ) {
      return fail("custom-registry-producer-start-block");
    }
  }
  if (event.record !== null) validateRecordStatic(event.record, event);
  return Object.freeze({ event, chain, deployment });
}

function occurrenceId(event: CustomRegistryEventV3): string {
  return `${event.chainId}:${event.blockHash}:${event.transactionHash}:${event.logIndex}`;
}

function approvalRegistryKey(
  authorization: CustomRegistryApprovalAuthorizationV3,
): string {
  return `${authorization.chainId}:${authorization.registryGeneration}:${authorization.registryAddress}`;
}

function eventDigest(event: CustomRegistryEventV3): Sha256Digest {
  return sha256("programmable.custom-registry-event.v3", event);
}

function registryFinality(
  event: CustomRegistryEventV3,
  chain: CustomRegistryChainManifestV3,
  head: CanonicalHeadV3,
  previous?: CustomLaunchProjectionRecordV3["registryFinality"],
): CustomLaunchProjectionRecordV3["registryFinality"] {
  if (head.chainId !== event.chainId) return fail("custom-registry-head-chain");
  const canonical = head.canonicalBlockHash(event.blockNumber);
  if (canonical === null || canonical !== event.blockHash) {
    return Object.freeze({
      status: "orphaned",
      observedAt: previous?.observedAt ?? head.observedAt,
      confirmedAt: previous?.confirmedAt ?? null,
      finalizedAt: previous?.finalizedAt ?? null,
      orphanedAt: head.observedAt,
      canonicalHeadBlock: decimal(
        head.blockNumber,
        "custom-registry-head-block",
      ),
      canonicalHeadHash: bytes32(
        head.blockHash,
        "custom-registry-head-hash",
      ),
    });
  }
  const depth = BigInt(head.blockNumber) - BigInt(event.blockNumber) + 1n;
  if (depth <= 0n) return fail("custom-registry-head-before-event");
  const status: RegistryFinalityStatusV3 =
    depth >= BigInt(chain.finalityDepth)
      ? "finalized"
      : depth >= BigInt(chain.confirmationDepth)
        ? "confirmed"
        : "observed";
  return Object.freeze({
    status,
    observedAt: previous?.observedAt ?? head.observedAt,
    confirmedAt:
      status === "confirmed" || status === "finalized"
        ? previous?.confirmedAt ?? head.observedAt
        : null,
    finalizedAt:
      status === "finalized"
        ? previous?.finalizedAt ?? head.observedAt
        : null,
    orphanedAt: null,
    canonicalHeadBlock: head.blockNumber,
    canonicalHeadHash: head.blockHash,
  });
}

function programmableVerified(
  recordValue: NonNullable<CustomRegistryEventV3["record"]>,
): boolean {
  return (
    recordValue.securityReview.status === "reviewed" &&
    recordValue.deploymentBinding.runtimeMatch === true &&
    recordValue.securityReview.repositoryUri ===
      recordValue.approvalBinding.repositoryUri &&
    recordValue.securityReview.commitObjectId ===
      recordValue.approvalBinding.commitObjectId &&
    recordValue.securityReview.sourceCommitment ===
      recordValue.approvalBinding.sourceCommitment &&
    recordValue.securityReview.buildCommitment ===
      recordValue.approvalBinding.buildCommitment &&
    recordValue.securityReview.artifactSetHash ===
      recordValue.approvalBinding.artifactSetHash &&
    recordValue.securityReview.configurationCommitment ===
      recordValue.approvalBinding.configurationCommitment
  );
}

function normalizeProducerSecurityReview(
  producer: CustomLaunchRegistryProducerRecordV3,
): CustomLaunchSecurityReviewV3 {
  const review = record(
    producer.verifiedReview,
    "custom-registry-project-review",
  );
  const approval = record(
    producer.approvalBinding,
    "custom-registry-project-review-approval",
  );
  const inventory = record(
    producer.postLaunchAuthorityInventory,
    "custom-registry-project-authority-inventory",
  );
  const authorities = array(
    inventory.authorities,
    "custom-registry-project-authorities",
  ).map((value) => {
    const item = record(value, "custom-registry-project-authority");
    assertJsonValue(item, "custom-registry-project-authority");
    return Object.freeze(item as Readonly<Record<string, JsonValue>>);
  });
  const dependencies = array(
    review.dependencies,
    "custom-registry-project-review-dependencies",
  ).map((value) => {
    const item = record(value, "custom-registry-project-review-dependency");
    assertJsonValue(item, "custom-registry-project-review-dependency");
    return Object.freeze(item as Readonly<Record<string, JsonValue>>);
  });
  const findings = array(
    review.findings,
    "custom-registry-project-review-findings",
  ).map((value) => {
    const item = record(value, "custom-registry-project-review-finding");
    assertJsonValue(item, "custom-registry-project-review-finding");
    return Object.freeze(item as Readonly<Record<string, JsonValue>>);
  });
  return Object.freeze({
    status:
      review.status === "verified"
        ? "reviewed"
        : review.status as "superseded" | "revoked",
    policyVersion: safeId(
      review.policyVersion,
      "custom-registry-project-review-policy-version",
    ),
    policyCommitment: digest(
      review.policyCommitment,
      "custom-registry-project-review-policy",
    ),
    repositoryUri: exactHttpsUrl(
      approval.repositoryUri,
      "custom-registry-project-review-repository",
    ),
    commitObjectId: text(
      review.commitObjectId,
      "custom-registry-project-review-commit",
      64,
    ),
    sourceCommitment: digest(
      review.sourceCommitment,
      "custom-registry-project-review-source",
    ),
    buildCommitment: digest(
      review.buildCommitment,
      "custom-registry-project-review-build",
    ),
    artifactSetHash: digest(
      review.artifactSetHash,
      "custom-registry-project-review-artifacts",
    ),
    runtimeCodeHashes: Object.freeze(
      array(
        review.runtimeCodeKeccak256,
        "custom-registry-project-review-runtimes",
      ).map((value) =>
        bytes32(value, "custom-registry-project-review-runtime")
      ),
    ),
    configurationCommitment: digest(
      review.configurationCommitment,
      "custom-registry-project-review-configuration",
    ),
    authorities: Object.freeze(authorities),
    upgradeability: Object.freeze({
      kind: text(
        review.upgradeability,
        "custom-registry-project-review-upgradeability",
      ),
      evidenceHash: digest(
        review.upgradeabilityEvidenceHash,
        "custom-registry-project-review-upgradeability-evidence",
      ),
    }),
    pause: Object.freeze({
      authority: text(
        review.pauseAuthority,
        "custom-registry-project-review-pause",
      ),
      evidenceHash: digest(
        review.pauseAuthorityEvidenceHash,
        "custom-registry-project-review-pause-evidence",
      ),
    }),
    custody: Object.freeze({
      kind: text(
        review.custody,
        "custom-registry-project-review-custody",
      ),
      evidenceHash: digest(
        review.custodyEvidenceHash,
        "custom-registry-project-review-custody-evidence",
      ),
    }),
    dependencies: Object.freeze(dependencies),
    findings: Object.freeze(findings),
    reviewedAt: instant(
      review.reviewedAt,
      "custom-registry-project-review-time",
    ),
    reviewerType: safeId(
      review.reviewerType,
      "custom-registry-project-review-reviewer",
    ),
    deploymentBindingHash: digest(
      review.deploymentBindingHash,
      "custom-registry-project-review-deployment",
    ),
    supersededBy: review.supersededBy === null
      ? null
      : digest(
          review.supersededBy,
          "custom-registry-project-review-superseded",
        ),
    revokedAt: review.revokedAt === null
      ? null
      : instant(review.revokedAt, "custom-registry-project-review-revoked"),
    revocationEvidenceHash: review.revocationEvidenceHash === null
      ? null
      : digest(
          review.revocationEvidenceHash,
          "custom-registry-project-review-revocation-evidence",
        ),
  });
}

function projectRecord(
  event: CustomRegistryEventV3,
  chain: CustomRegistryChainManifestV3,
  head: CanonicalHeadV3,
  previous: CustomLaunchProjectionRecordV3 | null,
): CustomLaunchProjectionRecordV3 {
  const source = event.record ?? previous;
  if (source === null) return fail("custom-registry-missing-record");
  const rawProducerRecord = event.producerRecord ?? previous?.rawProducerRecord;
  if (rawProducerRecord === null || rawProducerRecord === undefined) {
    return fail("custom-registry-missing-producer-record");
  }
  const normalizedFeePolicy = validateProducerFeeBindings(
    record(rawProducerRecord, "custom-registry-project-producer-record"),
  ).feePolicy;
  const normalizedSecurityReview = normalizeProducerSecurityReview(
    rawProducerRecord,
  );
  const finality = registryFinality(event, chain, head);
  const registeredAt = previous?.lifecycle.registeredAt ?? event.onchainTimestamp;
  const lifecycleStatus: CustomLaunchStatusV3 =
    finality.status === "orphaned"
      ? "orphaned"
      : event.operation === "finalized"
        ? "finalized"
      : event.operation === "corrected"
        ? "corrected"
        : event.operation === "revoked"
          ? "revoked"
          : finality.status;
  const sourceWithoutProjection = source as NonNullable<CustomRegistryEventV3["record"]>;
  return Object.freeze({
    ...sourceWithoutProjection,
    feePolicy: normalizedFeePolicy,
    securityReview: normalizedSecurityReview,
    origin: Object.freeze({
      kind: "programmable-custom-registry-v3",
      registryLaunchIdRaw: event.registryLaunchIdRaw,
      registryProjectIdRaw: event.registryProjectIdRaw,
      registryGeneration: event.registryGeneration,
      registryAddress: event.registryAddress,
      registryRuntimeCodeHash: event.observedRegistryRuntimeCodeHash,
      registryWriter: event.registryWriter,
      operation: event.operation,
      eventTopic0: event.topic0,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      onchainTimestamp: event.onchainTimestamp,
      registeredRecordHash: event.registeredRecordHash,
      latestOnchainRecordHash: event.latestOnchainRecordHash,
      previousOnchainRecordHash: event.previousOnchainRecordHash,
      eventBinding: Object.freeze({
        registrationSequence: event.registrationSequence,
        transitionSequence: event.transitionSequence,
        recordRevision: event.recordRevision,
        primaryContract: event.primaryContract,
        approvalId: event.approvalId,
        deploymentId: event.deploymentId,
        identityHash: event.identityHash,
        observedAtBlock: event.observedAtBlock,
        observedTransactionHash: event.observedTransactionHash,
        finalityEvidenceHash: event.finalityEvidenceHash,
        confirmedHeadBlockNumber: event.confirmedHeadBlockNumber,
        confirmedHeadBlockHash: event.confirmedHeadBlockHash,
        finalityPolicyHash: event.finalityPolicyHash,
        finalizedAtBlock: event.finalizedAtBlock,
        finalizedAtTimestamp: event.finalizedAtTimestamp,
        reasonCode: event.reasonCode,
        evidenceHash: event.evidenceHash,
      }),
    }),
    rawProducerRecord,
    producerBinding: Object.freeze({
      schemaVersion: CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3,
      envelopeDigest: rawProducerRecord.envelopeDigest,
      rawRecordHash: customRegistryRawProducerHashV3(rawProducerRecord),
    }),
    programmableVerified:
      (event.operation === "finalized" ||
        (event.operation === "corrected" &&
          previous?.programmableVerified === true)) &&
      finality.status !== "orphaned" &&
      programmableVerified({
        ...sourceWithoutProjection,
        securityReview: normalizedSecurityReview,
      }),
    registryFinality: finality,
    lifecycle: Object.freeze({
      status: lifecycleStatus,
      registryGeneration: event.registryGeneration,
      registeredAt,
      correctedAt:
        event.operation === "corrected"
          ? event.onchainTimestamp
          : previous?.lifecycle.correctedAt ?? null,
      revokedAt:
        event.operation === "revoked" ? event.onchainTimestamp : null,
      revocationEvidenceHash: event.revocationEvidenceHash,
      supersedesProjectionDigest:
        event.operation === "corrected" || event.operation === "revoked"
          ? previous === null
            ? null
            : customRegistryProjectionDigestV3(previous)
          : null,
      supersededByProjectionDigest: null,
    }),
  });
}

type ProjectedEvent = Readonly<{
  occurrenceId: string;
  eventDigest: Sha256Digest;
  event: CustomRegistryEventV3;
  chain: CustomRegistryChainManifestV3;
  record: CustomLaunchProjectionRecordV3;
  item: CustomRegistryFeedItemV3;
}>;

export class CustomRegistryProjectorV3 {
  readonly #manifest: CustomRegistryDeploymentManifestV3;
  readonly #occurrences = new Map<string, ProjectedEvent>();
  readonly #history: ProjectedEvent[] = [];
  readonly #current = new Map<Sha256Digest, CustomLaunchProjectionRecordV3>();
  readonly #eventByLaunch = new Map<Sha256Digest, ProjectedEvent>();
  readonly #approvalById = new Map<HexBytes32, Sha256Digest>();
  readonly #approvalEvidence = new Set<HexBytes32>();
  readonly #approvalTransitionByRegistry = new Map<string, bigint>();

  constructor(manifest: CustomRegistryDeploymentManifestV3) {
    this.#manifest = parseCustomRegistryDeploymentManifestV3(manifest);
  }

  static restore(
    manifestValue: CustomRegistryDeploymentManifestV3,
    checkpointValue: CustomRegistryProjectionCheckpointV3,
  ): CustomRegistryProjectorV3 {
    const manifest = parseCustomRegistryDeploymentManifestV3(manifestValue);
    const checkpoint = record(
      checkpointValue,
      "custom-registry-checkpoint",
    );
    if (
      checkpoint.schemaVersion !==
        "programmable.custom-registry-projection-checkpoint.v3" ||
      checkpoint.manifestHash !==
        sha256(CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3, manifest)
    ) {
      return fail("custom-registry-checkpoint-binding");
    }
    const entries = array(
      checkpoint.entries,
      "custom-registry-checkpoint-entries",
      1_000_000,
    );
    if (
      decimal(
        checkpoint.highWaterGeneration,
        "custom-registry-checkpoint-watermark",
      ) !== String(entries.length)
    ) {
      return fail("custom-registry-checkpoint-watermark");
    }
    const projector = new CustomRegistryProjectorV3(manifest);
    for (let index = 0; index < entries.length; index += 1) {
      const entry = record(entries[index], "custom-registry-checkpoint-entry");
      const event = entry.event as CustomRegistryEventV3;
      const { chain } = validateEvent(manifest, event);
      const eventFingerprint = eventDigest(event);
      const item = entry.item as CustomRegistryFeedItemV3;
      if (
        entry.occurrenceId !== occurrenceId(event) ||
        entry.eventDigest !== eventFingerprint ||
        item.generation !== String(index + 1) ||
        item.projectionKey !==
          `custom:${event.caip2}:${event.launchId}` ||
        item.projectionDigest !== customRegistryProjectionDigestV3(item.record) ||
        item.record.launchId !== event.launchId ||
        item.record.projectId !== event.projectId ||
        item.record.origin.registryLaunchIdRaw !== event.registryLaunchIdRaw ||
        item.record.origin.registeredRecordHash !== event.registeredRecordHash
      ) {
        return fail("custom-registry-checkpoint-entry-binding");
      }
      const projected: ProjectedEvent = Object.freeze({
        occurrenceId: entry.occurrenceId as string,
        eventDigest: eventFingerprint,
        event,
        chain,
        record: item.record,
        item,
      });
      const existing = projector.#occurrences.get(projected.occurrenceId);
      if (existing && existing.eventDigest !== eventFingerprint) {
        return fail("custom-registry-checkpoint-occurrence-conflict");
      }
      projector.#occurrences.set(projected.occurrenceId, projected);
      projector.#history.push(projected);
      projector.#current.set(event.launchId, item.record);
      projector.#eventByLaunch.set(event.launchId, projected);
      const authorization = event.approvalAuthorization;
      if (authorization !== null) {
        const authorizationDigest = sha256(
          "programmable.custom-registry-approval-authorization.v1",
          authorization,
        );
        const priorAuthorization = projector.#approvalById.get(
          authorization.approvalId,
        );
        const registryKey = approvalRegistryKey(authorization);
        const priorTransition =
          projector.#approvalTransitionByRegistry.get(registryKey);
        const transition = BigInt(authorization.transitionSequence);
        if (
          (priorAuthorization !== undefined &&
            priorAuthorization !== authorizationDigest) ||
          (priorAuthorization === undefined &&
            (projector.#approvalEvidence.has(authorization.evidenceHash) ||
              (priorTransition !== undefined &&
                transition <= priorTransition)))
        ) {
          return fail("custom-registry-checkpoint-approval-replay");
        }
        projector.#approvalById.set(
          authorization.approvalId,
          authorizationDigest,
        );
        projector.#approvalEvidence.add(authorization.evidenceHash);
        if (priorAuthorization === undefined) {
          projector.#approvalTransitionByRegistry.set(registryKey, transition);
        }
      }
    }
    return projector;
  }

  ingest(
    eventValue: CustomRegistryEventV3,
    head: CanonicalHeadV3,
  ): Readonly<{
    kind: "inserted" | "duplicate";
    item: CustomRegistryFeedItemV3;
  }> {
    const { event, chain } = validateEvent(this.#manifest, eventValue);
    const id = occurrenceId(event);
    const fingerprint = eventDigest(event);
    const existingOccurrence = this.#occurrences.get(id);
    if (existingOccurrence) {
      if (existingOccurrence.eventDigest !== fingerprint) {
        return fail("custom-registry-occurrence-conflict");
      }
      return Object.freeze({ kind: "duplicate", item: existingOccurrence.item });
    }
    const authorization = event.approvalAuthorization;
    const priorApprovalTransition = authorization === null
      ? undefined
      : this.#approvalTransitionByRegistry.get(approvalRegistryKey(authorization));
    if (
      authorization !== null &&
      (head.canonicalBlockHash(authorization.blockNumber) !==
        authorization.blockHash ||
        this.#approvalById.has(authorization.approvalId) ||
        this.#approvalEvidence.has(authorization.evidenceHash) ||
        (priorApprovalTransition !== undefined &&
          BigInt(authorization.transitionSequence) <= priorApprovalTransition))
    ) {
      return fail("custom-registry-approval-replay-or-reorg");
    }
    const previous = this.#current.get(event.launchId) ?? null;
    const previousSequence = previous === null
      ? null
      : previous.origin.eventBinding.transitionSequence ??
        previous.origin.eventBinding.registrationSequence;
    const nextSequence =
      event.transitionSequence ?? event.registrationSequence;
    if (
      (event.operation === "registered" && previous !== null) ||
      (event.operation !== "registered" && previous === null) ||
      ((event.operation === "corrected" || event.operation === "revoked") &&
        event.previousOnchainRecordHash !==
          previous!.origin.latestOnchainRecordHash) ||
      (event.operation === "finalized" &&
        (event.previousOnchainRecordHash !== null ||
          event.latestOnchainRecordHash !==
            previous!.origin.latestOnchainRecordHash ||
          event.observedTransactionHash !== previous!.origin.transactionHash)) ||
      (previous !== null &&
        (previous.projectId !== event.projectId ||
          previous.origin.registryLaunchIdRaw !== event.registryLaunchIdRaw ||
          previous.origin.registryProjectIdRaw !== event.registryProjectIdRaw ||
          previous.origin.registeredRecordHash !== event.registeredRecordHash ||
          previous.lifecycle.status === "revoked" ||
          previous.lifecycle.status === "orphaned")) ||
      (previousSequence !== null &&
        (nextSequence === null || BigInt(nextSequence) <= BigInt(previousSequence)))
    ) {
      return fail("custom-registry-replay-binding");
    }
    const projected = projectRecord(event, chain, head, previous);
    const generation = String(this.#history.length + 1);
    const item = Object.freeze({
      generation,
      projectionKey: `custom:${event.caip2}:${event.launchId}`,
      projectionDigest: customRegistryProjectionDigestV3(projected),
      record: projected,
    });
    const accepted = Object.freeze({
      occurrenceId: id,
      eventDigest: fingerprint,
      event,
      chain,
      record: projected,
      item,
    });
    this.#occurrences.set(id, accepted);
    this.#history.push(accepted);
    this.#current.set(event.launchId, projected);
    this.#eventByLaunch.set(event.launchId, accepted);
    if (authorization !== null) {
      this.#approvalById.set(
        authorization.approvalId,
        sha256("programmable.custom-registry-approval-authorization.v1", authorization),
      );
      this.#approvalEvidence.add(authorization.evidenceHash);
      this.#approvalTransitionByRegistry.set(
        approvalRegistryKey(authorization),
        BigInt(authorization.transitionSequence),
      );
    }
    return Object.freeze({ kind: "inserted", item });
  }

  ingestBatch(
    entries: readonly Readonly<{
      event: CustomRegistryEventV3;
      head: CanonicalHeadV3;
    }>[],
  ): readonly Readonly<{
    kind: "inserted" | "duplicate";
    item: CustomRegistryFeedItemV3;
  }>[] {
    if (entries.length < 1 || entries.length > 1_000) {
      return fail("custom-registry-batch-size");
    }
    const staged = CustomRegistryProjectorV3.restore(
      this.#manifest,
      this.checkpoint(),
    );
    const results = entries.map(({ event, head }) => staged.ingest(event, head));
    this.#occurrences.clear();
    for (const [key, value] of staged.#occurrences) {
      this.#occurrences.set(key, value);
    }
    this.#history.splice(0, this.#history.length, ...staged.#history);
    this.#current.clear();
    for (const [key, value] of staged.#current) this.#current.set(key, value);
    this.#eventByLaunch.clear();
    for (const [key, value] of staged.#eventByLaunch) {
      this.#eventByLaunch.set(key, value);
    }
    this.#approvalById.clear();
    for (const [key, value] of staged.#approvalById) {
      this.#approvalById.set(key, value);
    }
    this.#approvalEvidence.clear();
    for (const value of staged.#approvalEvidence) {
      this.#approvalEvidence.add(value);
    }
    this.#approvalTransitionByRegistry.clear();
    for (const [key, value] of staged.#approvalTransitionByRegistry) {
      this.#approvalTransitionByRegistry.set(key, value);
    }
    return Object.freeze(results);
  }

  reconcileFinality(
    launchId: Sha256Digest,
    head: CanonicalHeadV3,
  ): CustomRegistryFeedItemV3 | null {
    const latest = this.#eventByLaunch.get(launchId);
    const current = this.#current.get(launchId);
    if (!latest || !current) return null;
    const nextFinality = registryFinality(
      latest.event,
      latest.chain,
      head,
      current.registryFinality,
    );
    if (canonicalJson(nextFinality) === canonicalJson(current.registryFinality)) {
      return null;
    }
    const status: CustomLaunchStatusV3 =
      nextFinality.status === "orphaned"
        ? "orphaned"
        : latest.event.operation === "finalized"
          ? "finalized"
        : latest.event.operation === "corrected"
          ? "corrected"
          : latest.event.operation === "revoked"
            ? "revoked"
            : nextFinality.status === "finalized"
              ? "confirmed"
              : nextFinality.status;
    const projected = Object.freeze({
      ...current,
      programmableVerified:
        status !== "orphaned" && status !== "revoked" && current.programmableVerified,
      registryFinality: nextFinality,
      lifecycle: Object.freeze({ ...current.lifecycle, status }),
    });
    const item = Object.freeze({
      generation: String(this.#history.length + 1),
      projectionKey: latest.item.projectionKey,
      projectionDigest: customRegistryProjectionDigestV3(projected),
      record: projected,
    });
    const transition: ProjectedEvent = Object.freeze({
      ...latest,
      record: projected,
      item,
    });
    this.#history.push(transition);
    this.#current.set(launchId, projected);
    return item;
  }

  current(launchId: Sha256Digest): CustomLaunchProjectionRecordV3 | null {
    return this.#current.get(launchId) ?? null;
  }

  get highWaterGeneration(): string {
    return String(this.#history.length);
  }

  items(): readonly CustomRegistryFeedItemV3[] {
    return Object.freeze(this.#history.map(({ item }) => item));
  }

  checkpoint(): CustomRegistryProjectionCheckpointV3 {
    return Object.freeze({
      schemaVersion: "programmable.custom-registry-projection-checkpoint.v3",
      manifestHash: sha256(
        CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3,
        this.#manifest,
      ),
      highWaterGeneration: this.highWaterGeneration,
      entries: Object.freeze(
        this.#history.map((entry) =>
          Object.freeze({
            occurrenceId: entry.occurrenceId,
            eventDigest: entry.eventDigest,
            event: entry.event,
            item: entry.item,
          }),
        ),
      ),
    });
  }
}

type CursorPayloadV3 = Readonly<{
  version: 3;
  kind: "page" | "resume";
  afterGeneration: string;
  highWaterGeneration: string;
}>;

function cursorMac(encodedPayload: string, key: Uint8Array): Uint8Array {
  return createHmac("sha256", key)
    .update(CURSOR_DOMAIN)
    .update(encodedPayload)
    .digest();
}

function encodeCursor(payload: CursorPayloadV3, key: Uint8Array): string {
  if (key.byteLength < 32) return fail("custom-registry-cursor-key");
  const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  return `v3.${encoded}.${Buffer.from(cursorMac(encoded, key)).toString("base64url")}`;
}

function decodeCursor(value: string, key: Uint8Array): CursorPayloadV3 {
  if (key.byteLength < 32 || value.length > 4_096) {
    return fail("custom-registry-cursor");
  }
  const segments = value.split(".");
  if (segments.length !== 3 || segments[0] !== "v3") {
    return fail("custom-registry-cursor");
  }
  let supplied: Uint8Array;
  let decoded: unknown;
  try {
    supplied = Buffer.from(segments[2]!, "base64url");
    decoded = JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8"));
  } catch {
    return fail("custom-registry-cursor");
  }
  const expected = cursorMac(segments[1]!, key);
  if (
    supplied.byteLength !== expected.byteLength ||
    !timingSafeEqual(supplied, expected)
  ) {
    return fail("custom-registry-cursor-signature");
  }
  const source = record(decoded, "custom-registry-cursor-payload");
  if (
    source.version !== 3 ||
    (source.kind !== "page" && source.kind !== "resume")
  ) {
    return fail("custom-registry-cursor-version");
  }
  const afterGeneration = decimal(
    source.afterGeneration,
    "custom-registry-cursor-after",
  );
  const highWaterGeneration = decimal(
    source.highWaterGeneration,
    "custom-registry-cursor-watermark",
  );
  if (BigInt(afterGeneration) > BigInt(highWaterGeneration)) {
    return fail("custom-registry-cursor-order");
  }
  return Object.freeze({
    version: 3,
    kind: source.kind,
    afterGeneration,
    highWaterGeneration,
  });
}

export function customRegistryFeedPageV3(input: Readonly<{
  items: readonly CustomRegistryFeedItemV3[];
  cursor: string | null;
  limit: number;
  cursorKey: Uint8Array;
  indexedAt: string;
}>): CustomRegistryFeedPageV3 {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
    return fail("custom-registry-page-limit");
  }
  const indexedAt = instant(input.indexedAt, "custom-registry-indexed-at");
  for (let index = 0; index < input.items.length; index += 1) {
    if (input.items[index]!.generation !== String(index + 1)) {
      return fail("custom-registry-feed-gap");
    }
  }
  const decoded = input.cursor === null
    ? null
    : decodeCursor(input.cursor, input.cursorKey);
  const currentHighWater = String(input.items.length);
  const highWater = decoded?.kind === "page"
    ? decoded.highWaterGeneration
    : currentHighWater;
  const after = decoded?.afterGeneration ?? "0";
  if (BigInt(highWater) > BigInt(currentHighWater)) {
    return fail("custom-registry-cursor-future");
  }
  const selected = input.items.slice(
    Number(BigInt(after)),
    Number(
      BigInt(after) +
        (BigInt(input.limit) < BigInt(highWater) - BigInt(after)
          ? BigInt(input.limit)
          : BigInt(highWater) - BigInt(after)),
    ),
  );
  const nextAfter = selected.at(-1)?.generation ?? after;
  const hasMore = BigInt(nextAfter) < BigInt(highWater);
  const nextCursor = hasMore
    ? encodeCursor(
        {
          version: 3,
          kind: "page",
          afterGeneration: nextAfter,
          highWaterGeneration: highWater,
        },
        input.cursorKey,
      )
    : null;
  const resumeCursor = encodeCursor(
    {
      version: 3,
      kind: "resume",
      afterGeneration: highWater,
      highWaterGeneration: highWater,
    },
    input.cursorKey,
  );
  return Object.freeze({
    schemaVersion: CUSTOM_REGISTRY_FEED_SCHEMA_V1,
    source: Object.freeze({
      sourceId: CUSTOM_REGISTRY_FEED_SOURCE_V3,
      status: "ready",
      completeness: "complete",
      freshness: "current",
      checkedAt: indexedAt,
      latestAcceptedAt:
        input.items[Number(BigInt(highWater) - 1n)]?.record.origin.onchainTimestamp ??
        null,
    }),
    snapshot: Object.freeze({ highWaterGeneration: highWater, indexedAt }),
    items: Object.freeze(selected),
    page: Object.freeze({ nextCursor, resumeCursor, hasMore }),
  });
}
