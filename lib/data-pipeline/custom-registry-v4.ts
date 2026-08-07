import "server-only";

import { createHash } from "node:crypto";

import Ajv from "ajv";
import {
  encodeAbiParameters,
  keccak256,
  parseAbiParameters,
  stringToHex,
} from "viem";

import customLaunchRegistryRecordSchemaV3 from "../../schemas/custom-launch-registry-record-v3.schema.json";
import { invalidInput } from "./errors";
import {
  customRegistryRegisteredRecordCommitmentFromComponentsV1,
  customRegistryRegistrationBindingHashV1,
  type CustomLaunchOnchainFeeLegV1,
  type CustomLaunchOnchainFeePolicyV1,
  type CustomLaunchRegisteredRecordComponentHashesV1,
  type CustomLaunchRegisteredRecordPreimageV1,
  type CustomLaunchRegistryProducerRecordV3,
  type HexAddress,
  type HexBytes32,
  type Sha256Digest,
} from "./custom-registry-v3";

export const CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4 =
  "programmable.custom-launch-registry-record.v4" as const;
export const CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V4 =
  "programmable.custom-launch-projection-record.v4" as const;
export const CUSTOM_REGISTRY_PROJECTION_ENVELOPE_SCHEMA_V4 =
  "programmable.custom-launch-projection-envelope.v4" as const;
export const CUSTOM_REGISTRY_FEED_SOURCE_V4 =
  "programmable-custom-launch-registry-v4" as const;
export const CUSTOM_REGISTRY_PRODUCER_ENVELOPE_DOMAIN_V4 =
  "programmable.custom-launch-registry-envelope-digest.v4" as const;
export const CUSTOM_REGISTRY_GEN2_MANIFEST_SCHEMA_V4 =
  "programmable.custom-registry-generation-2-projection-manifest.v4" as const;
export const CUSTOM_REGISTRY_GEN2_CONTRACT_ID =
  "ProgrammableCustomRegistryV2" as const;
export const CUSTOM_REGISTRY_GEN2_PARTNER_FACTORY_REGISTRY_CONTRACT_ID =
  "ProgrammableCustomPartnerFactoryRegistryV2" as const;
export const CUSTOM_REGISTRY_GEN2_FEE_POLICY_VERIFIER_CONTRACT_ID =
  "ProgrammableCustomFeePolicyVerifierV2" as const;
export const CUSTOM_REGISTRY_GEN2_ATOMIC_REGISTRAR_CONTRACT_ID =
  "ProgrammableCustomAtomicRegistrarV2" as const;
export const CUSTOM_REGISTRY_GEN2_INTEGRATION_ABI_VERSION = 1 as const;
export const CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT =
  "e01f36a6d69136f674c203f83cca3ebdde0e0ded" as const;
export const CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256 =
  "sha256:7c5fe7d25cc874a319c3621435c31cd8f531a7abfcd7d5073fc163d10d60524f" as const;
export const CUSTOM_REGISTRY_GEN2_PARTNER_FACTORY_REGISTRY_ABI_SHA256 =
  "sha256:054b5d2740314335d202e37d405273cbb9d0922398cbc2909e7cb7cee845061e" as const;
export const CUSTOM_REGISTRY_GEN2_FEE_POLICY_VERIFIER_ABI_SHA256 =
  "sha256:0bc9bdda4a1e78e2c498568ddfa164b35c3cb5c297f563dd4771935e75304f62" as const;
export const CUSTOM_REGISTRY_GEN2_ATOMIC_REGISTRAR_ABI_SHA256 =
  "sha256:a053f14e59c3c54a0dad47e6e772ba411c7659a46eab3313a6c124260ebcff1f" as const;
export const CUSTOM_REGISTRY_GEN2_EVENT_SET_ID =
  "programmable.custom-registry-event-set.v2" as const;
export const CUSTOM_REGISTRY_GEN2_EVENT_SET_HASH =
  "sha256:bcff2958529fecaa7ef8c4c654389829bfb7dd61a3246f0d681cf7db0a42a58c" as const;
export const CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256 =
  "sha256:0c6c32e0db5eb55b8e0bd148a6206e0c0ab8605cda75338f3a556e75cd3eff1a" as const;
export const CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN =
  "programmable.custom-fee-policy.v2" as const;

export const CUSTOM_REGISTRY_GEN2_TOPICS = Object.freeze({
  approvalAuthorized:
    "0xb4fff32917416e7b84b1f40456921599cddfdcc057c9ad278706c5828b18c50b",
  partnerFactoryAuthorized:
    "0xa968119f9132089f6f4d7916a6da989971801f5f68b79eec527cb75cf38e6a02",
  partnerFactorySourceBound:
    "0xa939cc58afcf4fd66ae17957681f0bdd0f80452cde7742b88762bd115536de78",
  partnerFactoryRevoked:
    "0x704a05fde9f9d27fc692382126f225677f07d52ed9394af1b16e61fe4d2bb4ce",
  registered:
    "0x8ee074138114415a92a0797b4f1f4c6353f8bd15d8031433abf0cc42c2dc274a",
  provenance:
    "0x9593acf43b1c8e03c6742d49b67008f3c05841d3cfa43389d12f98e8b9c66cb9",
  review:
    "0xb5db50dfea0e7ff29b1ddee247a008e857b05d2b4bc2b780de5717b7f1881b63",
  attribution:
    "0x3608f2041bbe91aa3792101210bc2e29c23543fb4e0206daa2b1a99e7235c182",
  feePolicy:
    "0xb889df8572071d751e87d3e2a46c54093a55a9bc5a4697440cd29c90255dc5bf",
  feeScope:
    "0xfb69ef55bd117e822ea39d795bd1506dc489a1ce2c1ccd3ad4c781ef04598336",
  feeEvidence:
    "0xe647c474a92f722808930d32d310f47d0e3a4faf393255e0dea4b272588babb0",
  atomicExecuted:
    "0x95c51eef01e507ea45d10fa0c9939e8f78f574f9008ec761ba00c12031433098",
  finalized:
    "0xab930c1c165bba36257b8079ae38b6869f604910f6ffa40c956e31eb1b8ce38f",
  corrected:
    "0xa13c4392e0c64159cee078ced2b7157bc99993da4517b87fd0bd26b137600b78",
  revoked:
    "0x195a188d2c49d5e643afbcfd959edbf2ed1d6cd9216c5d99f3ad08c1010a9744",
} as const satisfies Readonly<Record<string, HexBytes32>>);

export const CUSTOM_REGISTRY_GEN2_EVENT_BINDINGS = Object.freeze([
  { emitterRole: "registry", id: "approvalAuthorized", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.approvalAuthorized },
  { emitterRole: "partnerFactoryRegistry", id: "partnerFactoryAuthorized", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.partnerFactoryAuthorized },
  { emitterRole: "partnerFactoryRegistry", id: "partnerFactorySourceBound", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.partnerFactorySourceBound },
  { emitterRole: "partnerFactoryRegistry", id: "partnerFactoryRevoked", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.partnerFactoryRevoked },
  { emitterRole: "registry", id: "registered", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.registered },
  { emitterRole: "registry", id: "provenance", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.provenance },
  { emitterRole: "registry", id: "review", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.review },
  { emitterRole: "registry", id: "attribution", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.attribution },
  { emitterRole: "registry", id: "feePolicy", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.feePolicy },
  { emitterRole: "registry", id: "feeScope", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.feeScope },
  { emitterRole: "registry", id: "feeEvidence", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.feeEvidence },
  { emitterRole: "atomicRegistrar", id: "atomicExecuted", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.atomicExecuted },
  { emitterRole: "registry", id: "finalized", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.finalized },
  { emitterRole: "registry", id: "corrected", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.corrected },
  { emitterRole: "registry", id: "revoked", topic0: CUSTOM_REGISTRY_GEN2_TOPICS.revoked },
] as const);

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as HexBytes32;
const APPROVAL_BINDING_DOMAIN_HASH_V1 = keccak256(
  stringToHex("programmable.custom-approval-binding.v1"),
) as HexBytes32;
const REVIEW_DEPLOYMENT_BINDING_DOMAIN_HASH_V1 = keccak256(
  stringToHex("programmable.custom-review-deployment-binding.v1"),
) as HexBytes32;
const PARTNER_CONFIGURATION_DOMAIN_HASH_V2 = keccak256(
  stringToHex("programmable.custom-partner-configuration.v2"),
) as HexBytes32;
const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const validateFrozenV3Shape = new Ajv({ allErrors: true, strict: true }).compile(
  customLaunchRegistryRecordSchemaV3,
);

export type CustomLaunchRegisteredRecordPreimageV2 = Readonly<
  Omit<CustomLaunchRegisteredRecordPreimageV1, "partnerId"> & {
    configurationHash: HexBytes32;
    permissionsHash: HexBytes32;
    providerId: HexBytes32;
    marketPathId: HexBytes32;
  }
>;

export type CustomLaunchOnchainFeePolicyV2 = Readonly<
  Omit<CustomLaunchOnchainFeePolicyV1, "partnerId"> & {
    providerId: HexBytes32;
    modelId: HexBytes32;
    modelVersion: HexBytes32;
    marketPathId: HexBytes32;
  }
>;

export type CustomRegistryGen2ContractBindingV4 = Readonly<{
  address: HexAddress;
  runtimeCodeHash: HexBytes32;
  startBlock: string;
  contractId: string;
  abiSha256: Sha256Digest;
}>;

export type CustomRegistryGen2ReleaseContractsV4 = Readonly<{
  registry: CustomRegistryGen2ContractBindingV4 &
    Readonly<{ contractId: typeof CUSTOM_REGISTRY_GEN2_CONTRACT_ID }>;
  partnerFactoryRegistry: CustomRegistryGen2ContractBindingV4 &
    Readonly<{
      contractId:
        typeof CUSTOM_REGISTRY_GEN2_PARTNER_FACTORY_REGISTRY_CONTRACT_ID;
    }>;
  feePolicyVerifier: CustomRegistryGen2ContractBindingV4 &
    Readonly<{
      contractId: typeof CUSTOM_REGISTRY_GEN2_FEE_POLICY_VERIFIER_CONTRACT_ID;
    }>;
  atomicRegistrar: CustomRegistryGen2ContractBindingV4 &
    Readonly<{
      contractId: typeof CUSTOM_REGISTRY_GEN2_ATOMIC_REGISTRAR_CONTRACT_ID;
    }>;
}>;

export type CustomRegistryGen2EvidenceEventV4 = Readonly<{
  emitterRole: "partnerFactoryRegistry" | "atomicRegistrar";
  emitterAddress: HexAddress;
  observedRuntimeCodeHash: HexBytes32;
  topic0: HexBytes32;
  transactionHash: HexBytes32;
  blockNumber: string;
  blockHash: HexBytes32;
}>;

export type CustomRegistryGen2PartnerFactoryAuthorizationV4 = Readonly<{
  chainId: string;
  registryGeneration: "2";
  configurationHash: HexBytes32;
  providerId: HexBytes32;
  modelId: HexBytes32;
  modelVersion: HexBytes32;
  templateId: HexBytes32;
  templateVersion: HexBytes32;
  modelRepositoryId: HexBytes32;
  modelSourceCommitId: HexBytes32;
  factorySourceRepositoryId: HexBytes32;
  factorySourceCommitId: HexBytes32;
  factory: HexAddress;
  factoryRuntimeCodeHash: HexBytes32;
  launchRuntimeCodeSetHash: HexBytes32;
  permissionsHash: HexBytes32;
  feePolicyHash: HexBytes32;
  validAfterBlock: string;
  expiresAtBlock: string;
  evidenceHash: HexBytes32;
  revoked: false;
  stateObservedAtBlock: string;
  stateProofHash: Sha256Digest;
  authorizedEvent: CustomRegistryGen2EvidenceEventV4 &
    Readonly<{
      emitterRole: "partnerFactoryRegistry";
      configurationHash: HexBytes32;
      providerId: HexBytes32;
      factory: HexAddress;
      modelId: HexBytes32;
      modelVersion: HexBytes32;
      templateId: HexBytes32;
      templateVersion: HexBytes32;
      validAfterBlock: string;
      expiresAtBlock: string;
      evidenceHash: HexBytes32;
    }>;
  sourceBoundEvent: CustomRegistryGen2EvidenceEventV4 &
    Readonly<{
      emitterRole: "partnerFactoryRegistry";
      configurationHash: HexBytes32;
      modelRepositoryId: HexBytes32;
      modelSourceCommitId: HexBytes32;
      factorySourceRepositoryId: HexBytes32;
      factorySourceCommitId: HexBytes32;
      factoryRuntimeCodeHash: HexBytes32;
      launchRuntimeCodeSetHash: HexBytes32;
      permissionsHash: HexBytes32;
      feePolicyHash: HexBytes32;
    }>;
}>;

export type CustomRegistryGen2AtomicExecutionProofV4 = Readonly<{
  emitterRole: "atomicRegistrar";
  emitterAddress: HexAddress;
  observedRuntimeCodeHash: HexBytes32;
  topic0: HexBytes32;
  transactionHash: HexBytes32;
  blockNumber: string;
  blockHash: HexBytes32;
  launchId: HexBytes32;
  deployed: HexAddress;
  requestHash: HexBytes32;
  registeredRecordCommitment: HexBytes32;
  registrationBindingHash: HexBytes32;
}>;

export type CustomLaunchRegistryProducerRecordV4 = Readonly<
  Omit<
    CustomLaunchRegistryProducerRecordV3,
    | "schemaVersion"
    | "registeredRecordPreimage"
    | "onchainFeePolicy"
    | "registryOrigin"
  > & {
    schemaVersion: typeof CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4;
    registeredRecordPreimage: CustomLaunchRegisteredRecordPreimageV2;
    onchainFeePolicy: CustomLaunchOnchainFeePolicyV2;
    registryOrigin: CustomLaunchRegistryProducerRecordV3["registryOrigin"] &
      Readonly<{
        registryContractId: typeof CUSTOM_REGISTRY_GEN2_CONTRACT_ID;
        contractIntegrationAbiVersion:
          typeof CUSTOM_REGISTRY_GEN2_INTEGRATION_ABI_VERSION;
        registryReleaseSourceCommit:
          typeof CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT;
        registryAbiSha256: typeof CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256;
        registryEventSetId: typeof CUSTOM_REGISTRY_GEN2_EVENT_SET_ID;
        registryEventSetBytesSha256:
          typeof CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256;
        feePolicyDomain: typeof CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN;
        releaseContracts: CustomRegistryGen2ReleaseContractsV4;
        eventBindings: typeof CUSTOM_REGISTRY_GEN2_EVENT_BINDINGS;
      }>;
    partnerFactoryAuthorization:
      CustomRegistryGen2PartnerFactoryAuthorizationV4 | null;
    atomicExecutionProof: CustomRegistryGen2AtomicExecutionProofV4 | null;
  }
>;

export type CustomRegistryGen2ProjectionManifestV4 = Readonly<{
  schemaVersion: typeof CUSTOM_REGISTRY_GEN2_MANIFEST_SCHEMA_V4;
  platformId: "programmable";
  category: "custom";
  chainId: string;
  caip2: string;
  registryGeneration: "2";
  confirmationDepth: string;
  finalityDepth: string;
  registryContractId: typeof CUSTOM_REGISTRY_GEN2_CONTRACT_ID;
  contractIntegrationAbiVersion:
    typeof CUSTOM_REGISTRY_GEN2_INTEGRATION_ABI_VERSION;
  registryReleaseSourceCommit:
    typeof CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT;
  registryAbiSha256: typeof CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256;
  registryEventSetId: typeof CUSTOM_REGISTRY_GEN2_EVENT_SET_ID;
  registryEventSetHash: typeof CUSTOM_REGISTRY_GEN2_EVENT_SET_HASH;
  registryEventSetBytesSha256:
    typeof CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256;
  feePolicyDomain: typeof CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN;
  topics: typeof CUSTOM_REGISTRY_GEN2_TOPICS;
  eventBindings: typeof CUSTOM_REGISTRY_GEN2_EVENT_BINDINGS;
  contracts: CustomRegistryGen2ReleaseContractsV4;
}>;

export type CustomRegistryGen2EventV4 = Readonly<{
  operation: "registered" | "finalized" | "revoked";
  chainId: string;
  caip2: string;
  registryGeneration: "2";
  registryAddress: HexAddress;
  observedRegistryRuntimeCodeHash: HexBytes32;
  registryWriter: HexAddress;
  emitterRole: "registry";
  emitterAddress: HexAddress;
  topic0: HexBytes32;
  registrationCompanions: readonly Readonly<{
    kind:
      | "provenance"
      | "review"
      | "attribution"
      | "feePolicy"
      | "feeScope"
      | "feeEvidence";
    topic0: HexBytes32;
  }>[];
  transactionHash: HexBytes32;
  blockNumber: string;
  blockHash: HexBytes32;
  transactionIndex: number;
  logIndex: number;
  onchainTimestamp: string;
  launchId: Sha256Digest;
  projectId: Sha256Digest;
  registryLaunchIdRaw: HexBytes32;
  registryProjectIdRaw: HexBytes32;
  registeredRecordHash: HexBytes32;
  identityHash: HexBytes32;
  producerRecord: CustomLaunchRegistryProducerRecordV4;
}>;

export type CanonicalHeadV4 = Readonly<{
  chainId: string;
  blockNumber: string;
  blockHash: HexBytes32;
  observedAt: string;
  canonicalBlockHash(blockNumber: string): HexBytes32 | null;
}>;

export type CustomRegistryGen2ParityProjectionV4 = Readonly<{
  schemaVersion: typeof CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V4;
  platformId: "programmable";
  category: "custom";
  launchId: Sha256Digest;
  projectId: Sha256Digest;
  registeredRecordPreimage: CustomLaunchRegisteredRecordPreimageV2;
  registeredRecordComponentHashes: CustomLaunchRegisteredRecordComponentHashesV1;
  registeredRecordCommitment: HexBytes32;
  registrationBindingHash: HexBytes32;
  rawProducerRecord: CustomLaunchRegistryProducerRecordV4;
  producerBinding: Readonly<{
    schemaVersion: typeof CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4;
    envelopeDigest: Sha256Digest;
    rawRecordHash: Sha256Digest;
  }>;
  origin: Readonly<{
    registryGeneration: "2";
    registryAddress: HexAddress;
    registryRuntimeCodeHash: HexBytes32;
    registryStartBlock: string;
    registryContractId: typeof CUSTOM_REGISTRY_GEN2_CONTRACT_ID;
    contractIntegrationAbiVersion:
      typeof CUSTOM_REGISTRY_GEN2_INTEGRATION_ABI_VERSION;
    registryReleaseSourceCommit:
      typeof CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT;
    registryAbiSha256: typeof CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256;
    registryEventSetId: typeof CUSTOM_REGISTRY_GEN2_EVENT_SET_ID;
    registryEventSetHash: typeof CUSTOM_REGISTRY_GEN2_EVENT_SET_HASH;
    registryEventSetBytesSha256:
      typeof CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256;
    feePolicyDomain: typeof CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN;
    releaseContracts: CustomRegistryGen2ReleaseContractsV4;
    operation: CustomRegistryGen2EventV4["operation"];
    registryWriter: HexAddress;
    eventTopic0: HexBytes32;
    transactionIndex: number;
    logIndex: number;
    registrationCompanions: CustomRegistryGen2EventV4["registrationCompanions"];
    transactionHash: HexBytes32;
    blockNumber: string;
    blockHash: HexBytes32;
    onchainTimestamp: string;
  }>;
  registryFinality: Readonly<{
    status: "observed" | "confirmed" | "finalized" | "orphaned";
    canonicalHeadBlock: string;
    canonicalHeadHash: HexBytes32;
    observedAt: string;
  }>;
  lifecycle: Readonly<{
    status: "observed" | "confirmed" | "finalized" | "orphaned" | "revoked";
    registryGeneration: "2";
  }>;
  publicProjection: Readonly<{
    platformId: "programmable";
    category: "custom";
    publicLabel: "Programmable Custom";
    launchId: Sha256Digest;
    projectId: Sha256Digest;
    chainId: string;
    caip2: string;
    model: CustomLaunchRegistryProducerRecordV4["model"];
    template: CustomLaunchRegistryProducerRecordV4["template"];
    partner: CustomLaunchRegistryProducerRecordV4["partner"];
    launchingWallet: CustomLaunchRegistryProducerRecordV4["launchingWallet"];
    launchIdentity: CustomLaunchRegistryProducerRecordV4["launchIdentity"];
    advertisesToken: boolean;
    assets: CustomLaunchRegistryProducerRecordV4["discoverableAssets"];
    assetIdentitySetHash: Sha256Digest;
    markets: CustomLaunchRegistryProducerRecordV4["discoverableMarkets"];
    marketSetHash: Sha256Digest;
    mechanisms: CustomLaunchRegistryProducerRecordV4["mechanisms"];
    capabilities: CustomLaunchRegistryProducerRecordV4["capabilities"];
    feePolicy: CustomLaunchRegistryProducerRecordV4["feePolicy"];
    onchainFeePolicy: CustomLaunchOnchainFeePolicyV2;
    verifiedReview: CustomLaunchRegistryProducerRecordV4["verifiedReview"];
    postLaunchAuthorityInventory:
      CustomLaunchRegistryProducerRecordV4["postLaunchAuthorityInventory"];
    finality: CustomLaunchRegistryProducerRecordV4["finality"];
    lifecycle: CustomLaunchRegistryProducerRecordV4["lifecycle"];
    presentationVersion: string | null;
    presentationBindingHash: Sha256Digest | null;
    presentation: CustomLaunchRegistryProducerRecordV4["presentation"];
    extensions: CustomLaunchRegistryProducerRecordV4["extensions"];
  }>;
}>;

export type CustomRegistryGen2ProjectionEnvelopeV4 = Readonly<{
  schemaVersion: typeof CUSTOM_REGISTRY_PROJECTION_ENVELOPE_SCHEMA_V4;
  sourceId: typeof CUSTOM_REGISTRY_FEED_SOURCE_V4;
  producerSchemaVersion: typeof CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4;
  projectionSchemaVersion: typeof CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V4;
  projectionDigest: Sha256Digest;
  rawRecordHash: Sha256Digest;
  rawRecord: CustomLaunchRegistryProducerRecordV4;
  projection: CustomRegistryGen2ParityProjectionV4;
}>;

function fail(operation: string): never {
  throw invalidInput("config", operation);
}

function object(value: unknown, operation: string): Record<string, unknown> {
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

function bytes32(value: unknown, operation: string): HexBytes32 {
  if (typeof value !== "string" || !BYTES32.test(value)) return fail(operation);
  return value as HexBytes32;
}

function address(value: unknown, operation: string): HexAddress {
  if (typeof value !== "string" || !ADDRESS.test(value)) return fail(operation);
  return value as HexAddress;
}

function digest(value: unknown, operation: string): Sha256Digest {
  if (typeof value !== "string" || !DIGEST.test(value)) return fail(operation);
  return value as Sha256Digest;
}

function decimal(value: unknown, operation: string, positive = false): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) return fail(operation);
  if (positive && BigInt(value) === 0n) return fail(operation);
  return value;
}

function index(value: unknown, operation: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) return fail(operation);
  return Number(value);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return fail("custom-registry-v4-json-number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const source = object(value, "custom-registry-v4-json-object");
  return `{${Object.keys(source)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(source[key])}`)
    .join(",")}}`;
}

function sha256(domain: string, value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonicalJson(value)}`)
    .digest("hex")}`;
}

function digestRawBytes32(value: Sha256Digest): HexBytes32 {
  return `0x${value.slice("sha256:".length)}`;
}

function keccakAbi(parameters: string, values: readonly unknown[]): HexBytes32 {
  return keccak256(
    encodeAbiParameters(parseAbiParameters(parameters), values as never),
  ) as HexBytes32;
}

function addressWord(value: HexAddress): HexBytes32 {
  return `0x${"0".repeat(24)}${value.slice(2)}`;
}

function feeLegHashV2(value: CustomLaunchOnchainFeeLegV1): HexBytes32 {
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

/** Exact mirror of ProgrammableCustomFeePolicyVerifierLibV2._hash. */
export function customRegistryOnchainFeePolicyHashV2(
  value: CustomLaunchOnchainFeePolicyV2,
): HexBytes32 {
  const attributionHash = keccakAbi(
    "uint8 kind, bytes32 providerId, bytes32 partnerStatusId, bytes32 modelId, bytes32 modelVersion, bytes32 templateId, bytes32 templateVersion, bytes32 marketPathId, bytes32 partnerRepositoryId, bytes32 partnerCommitId, bytes32 partnerRuntimeCodeSetHash",
    [
      value.kind,
      value.providerId,
      value.partnerStatusId,
      value.modelId,
      value.modelVersion,
      value.templateId,
      value.templateVersion,
      value.marketPathId,
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
      feeLegHashV2(value.partner),
      feeLegHashV2(value.programmable),
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
      keccak256(stringToHex(CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN)),
      attributionHash,
      economicsHash,
      lifecycleAndEvidenceHash,
    ],
  );
}

/** Exact 37-word Generation 2 registered-record recomputation. */
export function customRegistryRegisteredRecordBindingV2(
  value: CustomLaunchRegisteredRecordPreimageV2,
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
  const sourceAndDeploymentHash = keccakAbi("bytes32[14] words", [[
    value.repositoryId,
    value.commitId,
    value.sourceCommitment,
    value.buildCommitment,
    value.artifactSetHash,
    value.deploymentConfigurationHash,
    value.configurationHash,
    value.permissionsHash,
    value.deploymentId,
    value.deploymentSetHash,
    value.runtimeCodeSetHash,
    addressWord(value.primaryContract),
    value.primaryRuntimeCodeHash,
    addressWord(value.launchWallet),
  ]]);
  const attributionHash = keccakAbi("bytes32[11] words", [[
    value.modelId,
    value.modelVersion,
    value.templateId,
    value.templateVersion,
    value.providerId,
    value.builderAttributionHash,
    value.originHash,
    value.assetSetHash,
    value.marketSetHash,
    value.marketPathId,
    value.capabilitySetHash,
  ]]);
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

/** Exact mirror of c988/Gen2 _approvalBindingHash. */
export function customRegistryApprovalBindingHashV2(
  value: CustomLaunchRegisteredRecordPreimageV2,
): HexBytes32 {
  const sourceHash = keccakAbi(
    "bytes32 repositoryId, bytes32 commitId, bytes32 sourceCommitment, bytes32 buildCommitment, bytes32 artifactSetHash, bytes32 deploymentConfigurationHash, bytes32 configurationHash, bytes32 permissionsHash",
    [
      value.repositoryId,
      value.commitId,
      value.sourceCommitment,
      value.buildCommitment,
      value.artifactSetHash,
      value.deploymentConfigurationHash,
      value.configurationHash,
      value.permissionsHash,
    ],
  );
  const deploymentExpectationHash = keccakAbi(
    "bytes32 deploymentId, bytes32 deploymentSetHash, bytes32 runtimeCodeSetHash, address primaryContract, bytes32 primaryRuntimeCodeHash",
    [
      value.deploymentId,
      value.deploymentSetHash,
      value.runtimeCodeSetHash,
      value.primaryContract,
      value.primaryRuntimeCodeHash,
    ],
  );
  const attributionHash = keccakAbi(
    "bytes32 modelId, bytes32 modelVersion, bytes32 templateId, bytes32 templateVersion, bytes32 providerId, bytes32 builderAttributionHash, bytes32 originHash, bytes32 marketPathId",
    [
      value.modelId,
      value.modelVersion,
      value.templateId,
      value.templateVersion,
      value.providerId,
      value.builderAttributionHash,
      value.originHash,
      value.marketPathId,
    ],
  );
  const scopeHash = keccakAbi(
    "uint256 chainId, uint64 registryGeneration, bytes32 launchId, bytes32 projectId, bytes32 approvalId",
    [
      BigInt(value.chainId),
      BigInt(value.registryGeneration),
      value.launchId,
      value.projectId,
      value.approvalId,
    ],
  );
  const controlHash = keccakAbi(
    "address launchWallet, bytes32 feePolicyHash, bytes32 reviewPolicyHash",
    [value.launchWallet, value.feePolicyHash, value.reviewPolicyHash],
  );
  return keccakAbi(
    "bytes32 approvalDomain, bytes32 scopeHash, bytes32 sourceHash, bytes32 deploymentExpectationHash, bytes32 attributionHash, bytes32 controlHash",
    [
      APPROVAL_BINDING_DOMAIN_HASH_V1,
      scopeHash,
      sourceHash,
      deploymentExpectationHash,
      attributionHash,
      controlHash,
    ],
  );
}

/** Exact mirror of c988/Gen2 _reviewDeploymentBindingHash. */
export function customRegistryReviewDeploymentBindingHashV2(
  value: CustomLaunchRegisteredRecordPreimageV2,
): HexBytes32 {
  return keccakAbi(
    "bytes32 reviewDomain, bytes32 approvalBindingHash, bytes32 deploymentId, bytes32 deploymentSetHash, bytes32 runtimeCodeSetHash, address primaryContract, bytes32 primaryRuntimeCodeHash, bytes32 deploymentConfigurationHash, bytes32 configurationHash, bytes32 permissionsHash, bytes32 feePolicyHash",
    [
      REVIEW_DEPLOYMENT_BINDING_DOMAIN_HASH_V1,
      value.approvalBindingHash,
      value.deploymentId,
      value.deploymentSetHash,
      value.runtimeCodeSetHash,
      value.primaryContract,
      value.primaryRuntimeCodeHash,
      value.deploymentConfigurationHash,
      value.configurationHash,
      value.permissionsHash,
      value.feePolicyHash,
    ],
  );
}

export function customRegistryPartnerConfigurationHashV2(
  value: CustomRegistryGen2PartnerFactoryAuthorizationV4,
): HexBytes32 {
  const modelHash = keccakAbi(
    "bytes32 providerId, bytes32 modelId, bytes32 modelVersion, bytes32 templateId, bytes32 templateVersion, bytes32 modelRepositoryId, bytes32 modelSourceCommitId",
    [
      value.providerId,
      value.modelId,
      value.modelVersion,
      value.templateId,
      value.templateVersion,
      value.modelRepositoryId,
      value.modelSourceCommitId,
    ],
  );
  const factoryHash = keccakAbi(
    "bytes32 factorySourceRepositoryId, bytes32 factorySourceCommitId, uint256 chainId, uint64 registryGeneration, address factory, bytes32 factoryRuntimeCodeHash, bytes32 launchRuntimeCodeSetHash",
    [
      value.factorySourceRepositoryId,
      value.factorySourceCommitId,
      BigInt(value.chainId),
      BigInt(value.registryGeneration),
      value.factory,
      value.factoryRuntimeCodeHash,
      value.launchRuntimeCodeSetHash,
    ],
  );
  return keccakAbi(
    "bytes32 configurationDomain, bytes32 modelHash, bytes32 factoryHash, bytes32 permissionsHash, bytes32 feePolicyHash",
    [
      PARTNER_CONFIGURATION_DOMAIN_HASH_V2,
      modelHash,
      factoryHash,
      value.permissionsHash,
      value.feePolicyHash,
    ],
  );
}

export function customRegistryProducerEnvelopeDigestV4(
  value: Omit<CustomLaunchRegistryProducerRecordV4, "schemaVersion" | "envelopeDigest">,
): Sha256Digest {
  return sha256(CUSTOM_REGISTRY_PRODUCER_ENVELOPE_DOMAIN_V4, value);
}

export function customRegistryRawProducerHashV4(
  value: CustomLaunchRegistryProducerRecordV4,
): Sha256Digest {
  return sha256(CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4, value);
}

export function customRegistryProjectionDigestV4(
  value: CustomRegistryGen2ParityProjectionV4,
): Sha256Digest {
  return sha256(CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V4, value);
}

function validateUnchangedV3Shape(value: CustomLaunchRegistryProducerRecordV4): void {
  const candidate = structuredClone(value) as unknown as Record<string, unknown>;
  candidate.schemaVersion = "programmable.custom-launch-registry-record.v3";
  delete candidate.partnerFactoryAuthorization;
  delete candidate.atomicExecutionProof;
  const preimage = object(
    candidate.registeredRecordPreimage,
    "custom-registry-v4-preimage-shape",
  );
  preimage.partnerId = preimage.providerId;
  delete preimage.providerId;
  delete preimage.configurationHash;
  delete preimage.permissionsHash;
  delete preimage.marketPathId;
  const feePolicy = object(
    candidate.onchainFeePolicy,
    "custom-registry-v4-fee-shape",
  );
  feePolicy.partnerId = feePolicy.providerId;
  delete feePolicy.providerId;
  delete feePolicy.modelId;
  delete feePolicy.modelVersion;
  delete feePolicy.marketPathId;
  const origin = object(candidate.registryOrigin, "custom-registry-v4-origin-shape");
  delete origin.registryContractId;
  delete origin.contractIntegrationAbiVersion;
  delete origin.registryReleaseSourceCommit;
  delete origin.registryAbiSha256;
  delete origin.registryEventSetId;
  delete origin.registryEventSetBytesSha256;
  delete origin.feePolicyDomain;
  delete origin.releaseContracts;
  delete origin.eventBindings;
  if (!validateFrozenV3Shape(candidate)) {
    return fail("custom-registry-producer-schema-v4");
  }
}

function validateManifest(
  value: CustomRegistryGen2ProjectionManifestV4,
): CustomRegistryGen2ProjectionManifestV4 {
  if (
    value.schemaVersion !== CUSTOM_REGISTRY_GEN2_MANIFEST_SCHEMA_V4 ||
    value.platformId !== "programmable" ||
    value.category !== "custom" ||
    value.registryGeneration !== "2" ||
    value.caip2 !== `eip155:${decimal(value.chainId, "custom-registry-v4-chain", true)}` ||
    value.registryContractId !== CUSTOM_REGISTRY_GEN2_CONTRACT_ID ||
    value.contractIntegrationAbiVersion !==
      CUSTOM_REGISTRY_GEN2_INTEGRATION_ABI_VERSION ||
    value.registryReleaseSourceCommit !==
      CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT ||
    value.registryAbiSha256 !== CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256 ||
    value.registryEventSetId !== CUSTOM_REGISTRY_GEN2_EVENT_SET_ID ||
    value.registryEventSetHash !== CUSTOM_REGISTRY_GEN2_EVENT_SET_HASH ||
    value.registryEventSetBytesSha256 !==
      CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256 ||
    value.feePolicyDomain !== CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN ||
    canonicalJson(value.topics) !== canonicalJson(CUSTOM_REGISTRY_GEN2_TOPICS) ||
    canonicalJson(value.eventBindings) !==
      canonicalJson(CUSTOM_REGISTRY_GEN2_EVENT_BINDINGS)
  ) {
    return fail("custom-registry-v4-manifest-binding");
  }
  const exactContracts = [
    ["registry", CUSTOM_REGISTRY_GEN2_CONTRACT_ID, CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256],
    [
      "partnerFactoryRegistry",
      CUSTOM_REGISTRY_GEN2_PARTNER_FACTORY_REGISTRY_CONTRACT_ID,
      CUSTOM_REGISTRY_GEN2_PARTNER_FACTORY_REGISTRY_ABI_SHA256,
    ],
    [
      "feePolicyVerifier",
      CUSTOM_REGISTRY_GEN2_FEE_POLICY_VERIFIER_CONTRACT_ID,
      CUSTOM_REGISTRY_GEN2_FEE_POLICY_VERIFIER_ABI_SHA256,
    ],
    [
      "atomicRegistrar",
      CUSTOM_REGISTRY_GEN2_ATOMIC_REGISTRAR_CONTRACT_ID,
      CUSTOM_REGISTRY_GEN2_ATOMIC_REGISTRAR_ABI_SHA256,
    ],
  ] as const;
  const contractAddresses = new Set<string>();
  for (const [role, contractId, abiSha256] of exactContracts) {
    const contract = value.contracts[role];
    if (
      contract.contractId !== contractId ||
      contract.abiSha256 !== abiSha256 ||
      contractAddresses.has(contract.address)
    ) {
      return fail(`custom-registry-v4-${role}-binding`);
    }
    contractAddresses.add(address(contract.address, `custom-registry-v4-${role}-address`));
    bytes32(contract.runtimeCodeHash, `custom-registry-v4-${role}-runtime`);
    decimal(contract.startBlock, `custom-registry-v4-${role}-start`);
  }
  const confirmationDepth = BigInt(
    decimal(value.confirmationDepth, "custom-registry-v4-confirmation", true),
  );
  const finalityDepth = BigInt(
    decimal(value.finalityDepth, "custom-registry-v4-finality", true),
  );
  if (
    confirmationDepth > finalityDepth ||
    (value.chainId === "1" && finalityDepth < 64n)
  ) {
    return fail("custom-registry-v4-manifest-finality");
  }
  return value;
}

function normalizeRecord(value: unknown): CustomLaunchRegistryProducerRecordV4 {
  const source = object(value, "custom-registry-v4-record");
  if (source.schemaVersion !== CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4) {
    return fail("custom-registry-v4-record-version");
  }
  const recordValue = value as CustomLaunchRegistryProducerRecordV4;
  validateUnchangedV3Shape(recordValue);
  const {
    schemaVersion: _schemaVersion,
    envelopeDigest: _envelopeDigest,
    ...envelopePreimage
  } = recordValue;
  void _schemaVersion;
  void _envelopeDigest;
  if (
    digest(recordValue.envelopeDigest, "custom-registry-v4-envelope") !==
      customRegistryProducerEnvelopeDigestV4(envelopePreimage)
  ) {
    return fail("custom-registry-v4-envelope-binding");
  }
  return recordValue;
}

function validateFeeStructure(value: CustomLaunchOnchainFeePolicyV2): void {
  const attributionZero =
    value.providerId === ZERO_BYTES32 &&
    value.partnerStatusId === ZERO_BYTES32 &&
    value.modelId === ZERO_BYTES32 &&
    value.modelVersion === ZERO_BYTES32 &&
    value.templateId === ZERO_BYTES32 &&
    value.templateVersion === ZERO_BYTES32 &&
    value.marketPathId === ZERO_BYTES32 &&
    value.partnerRepositoryId === ZERO_BYTES32 &&
    value.partnerCommitId === ZERO_BYTES32 &&
    value.partnerRuntimeCodeSetHash === ZERO_BYTES32;
  if (value.kind === 2 && !attributionZero) {
    return fail("custom-registry-v4-no-market-attribution");
  }
  if (
    value.kind !== 2 &&
    (value.modelId === ZERO_BYTES32 ||
      value.modelVersion === ZERO_BYTES32 ||
      value.templateId === ZERO_BYTES32 ||
      value.templateVersion === ZERO_BYTES32 ||
      value.marketPathId === ZERO_BYTES32)
  ) {
    return fail("custom-registry-v4-market-attribution");
  }
  if (value.partner.shareBps + value.programmable.shareBps !== value.totalFeeBps) {
    return fail("custom-registry-v4-fee-share-sum");
  }
}

function validateEvidenceEmitter(
  value: CustomRegistryGen2EvidenceEventV4,
  contract: CustomRegistryGen2ContractBindingV4,
  emitterRole: CustomRegistryGen2EvidenceEventV4["emitterRole"],
  topic0: HexBytes32,
  registrationBlock: string,
): void {
  if (
    value.emitterRole !== emitterRole ||
    value.emitterAddress !== contract.address ||
    value.observedRuntimeCodeHash !== contract.runtimeCodeHash ||
    value.topic0 !== topic0 ||
    BigInt(decimal(value.blockNumber, "custom-registry-v4-evidence-block", true)) <
      BigInt(contract.startBlock) ||
    BigInt(value.blockNumber) > BigInt(registrationBlock)
  ) {
    return fail("custom-registry-v4-evidence-emitter");
  }
  bytes32(value.transactionHash, "custom-registry-v4-evidence-transaction");
  bytes32(value.blockHash, "custom-registry-v4-evidence-block-hash");
}

function validateProviderOrAtomicProof(
  producer: CustomLaunchRegistryProducerRecordV4,
  event: CustomRegistryGen2EventV4,
  manifest: CustomRegistryGen2ProjectionManifestV4,
): void {
  const preimage = producer.registeredRecordPreimage;
  if (preimage.providerId === ZERO_BYTES32) {
    const proof = producer.atomicExecutionProof;
    const contract = manifest.contracts.atomicRegistrar;
    if (
      producer.partnerFactoryAuthorization !== null ||
      proof === null ||
      event.registryWriter !== contract.address ||
      proof.emitterRole !== "atomicRegistrar" ||
      proof.emitterAddress !== contract.address ||
      proof.observedRuntimeCodeHash !== contract.runtimeCodeHash ||
      proof.topic0 !== manifest.topics.atomicExecuted ||
      proof.transactionHash !== event.transactionHash ||
      proof.blockNumber !== event.blockNumber ||
      proof.blockHash !== event.blockHash ||
      proof.launchId !== event.registryLaunchIdRaw ||
      proof.deployed !== preimage.primaryContract ||
      proof.registeredRecordCommitment !== producer.registeredRecordCommitment ||
      proof.registrationBindingHash !== producer.registrationBindingHash
    ) {
      return fail("custom-registry-v4-atomic-proof");
    }
    bytes32(proof.requestHash, "custom-registry-v4-atomic-request");
    return;
  }
  const authorization = producer.partnerFactoryAuthorization;
  if (producer.atomicExecutionProof !== null || authorization === null) {
    return fail("custom-registry-v4-partner-factory-proof");
  }
  const partnerRegistry = manifest.contracts.partnerFactoryRegistry;
  validateEvidenceEmitter(
    authorization.authorizedEvent,
    partnerRegistry,
    "partnerFactoryRegistry",
    manifest.topics.partnerFactoryAuthorized,
    event.blockNumber,
  );
  validateEvidenceEmitter(
    authorization.sourceBoundEvent,
    partnerRegistry,
    "partnerFactoryRegistry",
    manifest.topics.partnerFactorySourceBound,
    event.blockNumber,
  );
  const authorizedEvent = authorization.authorizedEvent;
  const sourceBoundEvent = authorization.sourceBoundEvent;
  if (
    authorization.chainId !== event.chainId ||
    authorization.registryGeneration !== "2" ||
    authorization.configurationHash !== preimage.configurationHash ||
    authorization.configurationHash !==
      customRegistryPartnerConfigurationHashV2(authorization) ||
    authorization.providerId !== preimage.providerId ||
    authorization.modelId !== preimage.modelId ||
    authorization.modelVersion !== preimage.modelVersion ||
    authorization.templateId !== preimage.templateId ||
    authorization.templateVersion !== preimage.templateVersion ||
    authorization.modelRepositoryId !== preimage.repositoryId ||
    authorization.modelSourceCommitId !== preimage.commitId ||
    authorization.factory !== event.registryWriter ||
    authorization.launchRuntimeCodeSetHash !== preimage.runtimeCodeSetHash ||
    authorization.permissionsHash !== preimage.permissionsHash ||
    authorization.feePolicyHash !== preimage.feePolicyHash ||
    authorization.revoked !== false ||
    BigInt(authorization.validAfterBlock) > BigInt(event.blockNumber) ||
    BigInt(authorization.expiresAtBlock) < BigInt(event.blockNumber) ||
    BigInt(authorization.stateObservedAtBlock) < BigInt(sourceBoundEvent.blockNumber) ||
    BigInt(authorization.stateObservedAtBlock) > BigInt(event.blockNumber) ||
    authorizedEvent.configurationHash !== authorization.configurationHash ||
    authorizedEvent.providerId !== authorization.providerId ||
    authorizedEvent.factory !== authorization.factory ||
    authorizedEvent.modelId !== authorization.modelId ||
    authorizedEvent.modelVersion !== authorization.modelVersion ||
    authorizedEvent.templateId !== authorization.templateId ||
    authorizedEvent.templateVersion !== authorization.templateVersion ||
    authorizedEvent.validAfterBlock !== authorization.validAfterBlock ||
    authorizedEvent.expiresAtBlock !== authorization.expiresAtBlock ||
    authorizedEvent.evidenceHash !== authorization.evidenceHash ||
    sourceBoundEvent.configurationHash !== authorization.configurationHash ||
    sourceBoundEvent.modelRepositoryId !== authorization.modelRepositoryId ||
    sourceBoundEvent.modelSourceCommitId !== authorization.modelSourceCommitId ||
    sourceBoundEvent.factorySourceRepositoryId !==
      authorization.factorySourceRepositoryId ||
    sourceBoundEvent.factorySourceCommitId !==
      authorization.factorySourceCommitId ||
    sourceBoundEvent.factoryRuntimeCodeHash !==
      authorization.factoryRuntimeCodeHash ||
    sourceBoundEvent.launchRuntimeCodeSetHash !==
      authorization.launchRuntimeCodeSetHash ||
    sourceBoundEvent.permissionsHash !== authorization.permissionsHash ||
    sourceBoundEvent.feePolicyHash !== authorization.feePolicyHash
  ) {
    return fail("custom-registry-v4-partner-factory-binding");
  }
  bytes32(
    authorization.factoryRuntimeCodeHash,
    "custom-registry-v4-partner-factory-runtime",
  );
  digest(
    authorization.stateProofHash,
    "custom-registry-v4-partner-factory-state-proof",
  );
}

/**
 * Contract-parity adapter for Generation 2. It does not activate a deployment;
 * the passed manifest is the canonical allowlist/trust root.
 */
export function projectCustomRegistryGen2RecordV4(input: Readonly<{
  manifest: CustomRegistryGen2ProjectionManifestV4;
  event: CustomRegistryGen2EventV4;
  head: CanonicalHeadV4;
}>): CustomRegistryGen2ParityProjectionV4 {
  const manifest = validateManifest(input.manifest);
  const event = input.event;
  const producer = normalizeRecord(event.producerRecord);
  const origin = producer.registryOrigin;
  const registryContract = manifest.contracts.registry;
  const expectedTopic = manifest.topics[event.operation];
  if (
    event.registryGeneration !== "2" ||
    event.chainId !== manifest.chainId ||
    event.caip2 !== manifest.caip2 ||
    event.registryAddress !== registryContract.address ||
    event.observedRegistryRuntimeCodeHash !== registryContract.runtimeCodeHash ||
    event.emitterRole !== "registry" ||
    event.emitterAddress !== registryContract.address ||
    event.topic0 !== expectedTopic ||
    BigInt(decimal(event.blockNumber, "custom-registry-v4-event-block", true)) <
      BigInt(registryContract.startBlock) ||
    event.registryLaunchIdRaw !== digestRawBytes32(event.launchId) ||
    event.registryProjectIdRaw !== digestRawBytes32(event.projectId) ||
    input.head.chainId !== event.chainId
  ) {
    return fail("custom-registry-v4-event-binding");
  }
  bytes32(event.transactionHash, "custom-registry-v4-event-transaction");
  bytes32(event.blockHash, "custom-registry-v4-event-block-hash");
  index(event.transactionIndex, "custom-registry-v4-event-transaction-index");
  index(event.logIndex, "custom-registry-v4-event-log-index");
  bytes32(input.head.blockHash, "custom-registry-v4-head-hash");
  decimal(input.head.blockNumber, "custom-registry-v4-head-block", true);
  const expectedCompanions = [
    "provenance",
    "review",
    "attribution",
    "feePolicy",
    "feeScope",
    "feeEvidence",
  ] as const;
  if (
    (event.operation === "registered" &&
      (event.registrationCompanions.length !== expectedCompanions.length ||
        expectedCompanions.some((kind) =>
          !event.registrationCompanions.some(
            (companion) =>
              companion.kind === kind && companion.topic0 === manifest.topics[kind],
          )
        ))) ||
    (event.operation !== "registered" && event.registrationCompanions.length !== 0)
  ) {
    return fail("custom-registry-v4-event-set-binding");
  }
  if (
    origin.chainId !== manifest.chainId ||
    origin.caip2 !== manifest.caip2 ||
    origin.registryGeneration !== "2" ||
    origin.registryAddress !== registryContract.address ||
    origin.registryStartBlock !== registryContract.startBlock ||
    origin.registryContractId !== manifest.registryContractId ||
    origin.contractIntegrationAbiVersion !==
      manifest.contractIntegrationAbiVersion ||
    origin.registryReleaseSourceCommit !== manifest.registryReleaseSourceCommit ||
    origin.registryAbiSha256 !== manifest.registryAbiSha256 ||
    origin.registryEventSetId !== manifest.registryEventSetId ||
    origin.registryEventSetHash !== manifest.registryEventSetHash ||
    origin.registryEventSetBytesSha256 !==
      manifest.registryEventSetBytesSha256 ||
    origin.feePolicyDomain !== manifest.feePolicyDomain ||
    canonicalJson(origin.releaseContracts) !== canonicalJson(manifest.contracts) ||
    canonicalJson(origin.eventBindings) !== canonicalJson(manifest.eventBindings) ||
    (event.operation === "registered" &&
      (origin.registrationTransactionHash !== event.transactionHash ||
        origin.registrationBlockNumber !== event.blockNumber ||
        origin.registrationBlockHash !== event.blockHash ||
        origin.registrationTransactionIndex !== String(event.transactionIndex) ||
        origin.registrationLogIndex !== String(event.logIndex))) ||
    producer.lifecycle.registryGeneration !== "2"
  ) {
    return fail("custom-registry-v4-origin-binding");
  }
  const preimage = producer.registeredRecordPreimage;
  const feePolicy = producer.onchainFeePolicy;
  if (Object.keys(preimage).length !== 37) {
    return fail("custom-registry-v4-preimage-field-count");
  }
  for (const [field, value] of Object.entries(preimage)) {
    if (field === "chainId" || field === "registryGeneration") {
      decimal(value, `custom-registry-v4-preimage-${field}`, true);
    } else if (field === "primaryContract" || field === "launchWallet") {
      address(value, `custom-registry-v4-preimage-${field}`);
    } else {
      bytes32(value, `custom-registry-v4-preimage-${field}`);
    }
  }
  for (const [field, value] of [
    ["providerId", feePolicy.providerId],
    ["modelId", feePolicy.modelId],
    ["modelVersion", feePolicy.modelVersion],
    ["marketPathId", feePolicy.marketPathId],
  ] as const) {
    bytes32(value, `custom-registry-v4-fee-${field}`);
  }
  validateFeeStructure(feePolicy);
  const binding = customRegistryRegisteredRecordBindingV2(preimage);
  if (
    preimage.chainId !== event.chainId ||
    preimage.registryGeneration !== "2" ||
    preimage.launchId !== event.registryLaunchIdRaw ||
    preimage.projectId !== event.registryProjectIdRaw ||
    preimage.marketPathId !== feePolicy.marketPathId ||
    preimage.feePolicyHash !== customRegistryOnchainFeePolicyHashV2(feePolicy) ||
    preimage.approvalBindingHash !== customRegistryApprovalBindingHashV2(preimage) ||
    preimage.reviewDeploymentBindingHash !==
      customRegistryReviewDeploymentBindingHashV2(preimage) ||
    canonicalJson(producer.registeredRecordComponentHashes) !==
      canonicalJson(binding.componentHashes) ||
    producer.registeredRecordCommitment !== binding.registeredRecordCommitment ||
    producer.registrationBindingHash !== binding.registrationBindingHash ||
    origin.registryLaunchIdRaw !== event.registryLaunchIdRaw ||
    origin.registeredRecordHash !== binding.registeredRecordCommitment ||
    origin.registrationBindingHashRaw !== binding.registrationBindingHash ||
    event.registeredRecordHash !== binding.registeredRecordCommitment ||
    event.identityHash !== binding.registrationBindingHash
  ) {
    return fail("custom-registry-v4-record-binding");
  }
  validateProviderOrAtomicProof(producer, event, manifest);
  const canonicalEventHash = input.head.canonicalBlockHash(event.blockNumber);
  const orphaned = canonicalEventHash === null || canonicalEventHash !== event.blockHash;
  const depth = BigInt(input.head.blockNumber) - BigInt(event.blockNumber) + 1n;
  if (!orphaned && depth <= 0n) return fail("custom-registry-v4-head-before-event");
  const registryStatus = orphaned
    ? "orphaned" as const
    : depth >= BigInt(manifest.finalityDepth)
      ? "finalized" as const
      : depth >= BigInt(manifest.confirmationDepth)
        ? "confirmed" as const
        : "observed" as const;
  const lifecycleStatus = registryStatus === "orphaned"
    ? "orphaned" as const
    : event.operation === "revoked"
      ? "revoked" as const
      : event.operation === "finalized"
        ? "finalized" as const
        : registryStatus;
  return Object.freeze({
    schemaVersion: CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V4,
    platformId: "programmable",
    category: "custom",
    launchId: event.launchId,
    projectId: event.projectId,
    registeredRecordPreimage: preimage,
    registeredRecordComponentHashes: binding.componentHashes,
    registeredRecordCommitment: binding.registeredRecordCommitment,
    registrationBindingHash: binding.registrationBindingHash,
    rawProducerRecord: producer,
    producerBinding: Object.freeze({
      schemaVersion: CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4,
      envelopeDigest: producer.envelopeDigest,
      rawRecordHash: customRegistryRawProducerHashV4(producer),
    }),
    origin: Object.freeze({
      registryGeneration: "2",
      registryAddress: registryContract.address,
      registryRuntimeCodeHash: registryContract.runtimeCodeHash,
      registryStartBlock: registryContract.startBlock,
      registryContractId: manifest.registryContractId,
      contractIntegrationAbiVersion: manifest.contractIntegrationAbiVersion,
      registryReleaseSourceCommit: manifest.registryReleaseSourceCommit,
      registryAbiSha256: manifest.registryAbiSha256,
      registryEventSetId: manifest.registryEventSetId,
      registryEventSetHash: manifest.registryEventSetHash,
      registryEventSetBytesSha256: manifest.registryEventSetBytesSha256,
      feePolicyDomain: manifest.feePolicyDomain,
      releaseContracts: manifest.contracts,
      operation: event.operation,
      registryWriter: event.registryWriter,
      eventTopic0: event.topic0,
      transactionIndex: event.transactionIndex,
      logIndex: event.logIndex,
      registrationCompanions: event.registrationCompanions,
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber,
      blockHash: event.blockHash,
      onchainTimestamp: event.onchainTimestamp,
    }),
    registryFinality: Object.freeze({
      status: registryStatus,
      canonicalHeadBlock: input.head.blockNumber,
      canonicalHeadHash: input.head.blockHash,
      observedAt: input.head.observedAt,
    }),
    lifecycle: Object.freeze({
      status: lifecycleStatus,
      registryGeneration: "2",
    }),
    publicProjection: Object.freeze({
      platformId: "programmable",
      category: "custom",
      publicLabel: "Programmable Custom",
      launchId: producer.launchId,
      projectId: producer.projectId,
      chainId: origin.chainId,
      caip2: origin.caip2,
      model: producer.model,
      template: producer.template,
      partner: producer.partner,
      launchingWallet: producer.launchingWallet,
      launchIdentity: producer.launchIdentity,
      advertisesToken: producer.advertisesToken,
      assets: producer.discoverableAssets,
      assetIdentitySetHash: producer.assetIdentitySetHash,
      markets: producer.discoverableMarkets,
      marketSetHash: producer.marketSetHash,
      mechanisms: producer.mechanisms,
      capabilities: producer.capabilities,
      feePolicy: producer.feePolicy,
      onchainFeePolicy: producer.onchainFeePolicy,
      verifiedReview: producer.verifiedReview,
      postLaunchAuthorityInventory:
        producer.postLaunchAuthorityInventory,
      finality: producer.finality,
      lifecycle: producer.lifecycle,
      presentationVersion: producer.presentationVersion,
      presentationBindingHash: producer.presentationBindingHash,
      presentation: producer.presentation,
      extensions: producer.extensions,
    }),
  });
}

/** Versioned handoff envelope for additive Developer feed ingestion. */
export function projectCustomRegistryGen2EnvelopeV4(input: Readonly<{
  manifest: CustomRegistryGen2ProjectionManifestV4;
  event: CustomRegistryGen2EventV4;
  head: CanonicalHeadV4;
}>): CustomRegistryGen2ProjectionEnvelopeV4 {
  const projection = projectCustomRegistryGen2RecordV4(input);
  return Object.freeze({
    schemaVersion: CUSTOM_REGISTRY_PROJECTION_ENVELOPE_SCHEMA_V4,
    sourceId: CUSTOM_REGISTRY_FEED_SOURCE_V4,
    producerSchemaVersion: CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4,
    projectionSchemaVersion: CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V4,
    projectionDigest: customRegistryProjectionDigestV4(projection),
    rawRecordHash: customRegistryRawProducerHashV4(
      projection.rawProducerRecord,
    ),
    rawRecord: projection.rawProducerRecord,
    projection,
  });
}
