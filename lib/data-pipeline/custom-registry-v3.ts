import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { invalidInput, validationError } from "./errors";

export const CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3 =
  "programmable.custom-registry-deployments.v3" as const;
export const CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3 =
  "programmable.custom-launch-registry-record.v3" as const;
export const CUSTOM_REGISTRY_PROJECTION_RECORD_SCHEMA_V3 =
  "programmable.custom-launch-projection-record.v3" as const;
export const CUSTOM_REGISTRY_PRODUCER_ENVELOPE_DOMAIN_V3 =
  "programmable.custom-launch-registry-envelope-digest.v3" as const;
export const CUSTOM_REGISTRY_FEED_SCHEMA_V1 =
  "programmable.custom-launch-registry-feed.v1" as const;
export const CUSTOM_REGISTRY_FEED_SOURCE_V3 =
  "programmable-custom-launch-registry-v3" as const;
export const PROGRAMMABLE_CUSTOM_LABEL = "Programmable Custom" as const;
export const PROGRAMMABLE_FEE_RECIPIENT =
  "0x4957f49620aff3adbbe8195a4f633e49cc93376c" as const;

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

const ADDRESS = /^0x[0-9a-f]{40}$/u;
const BYTES32 = /^0x[0-9a-f]{64}$/u;
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,255}$/u;
const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const MAX_RECORD_BYTES = 512 * 1024;
const MAX_COLLECTION_SIZE = 256;
const CURSOR_DOMAIN = "programmable.custom-registry-cursor.v3\0";

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
  authorizedWriters: readonly HexAddress[];
  topics: Readonly<{
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

export type CustomLaunchFeePolicyV3 =
  | Readonly<{
      kind: "native-custom";
      chargeMode: "verified-official-market-only";
      basis: string;
      currency: string;
      accrual: string;
      claim: string;
      totalBps: 10;
      partnerShareBps: 0;
      programmableShareBps: 10;
      partnerRecipient: null;
      programmableRecipient: typeof PROGRAMMABLE_FEE_RECIPIENT;
      normalCustomFeeApplied: true;
      verificationStatus: "verified";
      evidenceHashes: readonly Sha256Digest[];
    }>
  | Readonly<{
      kind: "partner-template";
      chargeMode: "template-native";
      basis: string;
      currency: string;
      accrual: string;
      claim: string;
      totalBps: 20;
      partnerShareBps: 15;
      programmableShareBps: 5;
      partnerRecipient: HexAddress;
      programmableRecipient: typeof PROGRAMMABLE_FEE_RECIPIENT;
      normalCustomFeeApplied: false;
      verificationStatus: "verified";
      evidenceHashes: readonly Sha256Digest[];
    }>;

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

export type CustomLaunchRegistryProducerRecordV3 = Readonly<{
  schemaVersion: typeof CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V3;
  platformId: "programmable";
  origin: "programmable";
  category: "custom";
  launchFamily: "custom";
  publicLabel: typeof PROGRAMMABLE_CUSTOM_LABEL;
  projectId: Sha256Digest;
  launchId: Sha256Digest;
  model: JsonValue;
  template: JsonValue;
  partner: JsonValue;
  registryOrigin: Readonly<{
    chainId: string;
    caip2: string;
    registryAddress: HexAddress;
    registryStartBlock: string;
    registryGeneration: string;
    registryLaunchIdRaw: HexBytes32;
    launchIdEncoding: "sha256-digest-raw-bytes32";
    registryApprovalBindingHashRaw: HexBytes32;
    registryEventSetHash: Sha256Digest;
    registrationTransactionHash: HexTransactionHash;
    registrationBlockHash: HexBytes32;
    registrationBlockNumber: string;
    registrationTransactionIndex: string;
    registrationLogIndex: string;
    registeredRecordHash: HexBytes32;
    registrationEvidenceHash: Sha256Digest;
  }>;
  approvalBinding: Readonly<{
    chainId: string;
    caip2: string;
    chainProfileId: string;
    approvalBindingHash: Sha256Digest;
    [key: string]: JsonValue;
  }>;
  deploymentBinding: Readonly<{
    chainId: string;
    caip2: string;
    runtimeMatch: "exact";
    contracts: readonly Readonly<{
      address: NamespacedEvmIdentityV3;
      runtimeCodeKeccak256: EvmRuntimeCodeHash;
      runtimeCodeSha256: Sha256Digest;
      [key: string]: JsonValue;
    }>[];
    [key: string]: JsonValue;
  }>;
  verifiedReview: JsonValue;
  feePolicy: JsonValue;
  launchingWallet: NamespacedEvmIdentityV3;
  postLaunchAuthorityInventory: JsonValue;
  postLaunchAuthorityInventoryHash: Sha256Digest;
  launchIdentity: NamespacedEvmIdentityV3;
  advertisesToken: boolean;
  discoverableAssets: JsonValue;
  assetIdentitySetHash: Sha256Digest;
  discoverableMarkets: JsonValue;
  marketSetHash: Sha256Digest;
  mechanisms: JsonValue;
  capabilities: JsonValue;
  finality: JsonValue;
  lifecycle: JsonValue;
  presentationVersion: JsonValue;
  presentationBindingHash: Sha256Digest | null;
  presentation: JsonValue;
  extensions: JsonValue;
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
  producerRecord: CustomLaunchRegistryProducerRecordV3 | null;
  record: Omit<
    CustomLaunchProjectionRecordV3,
    | "origin"
    | "rawProducerRecord"
    | "producerBinding"
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
  return value as HexAddress;
}

function bytes32(value: unknown, operation: string): HexBytes32 {
  if (typeof value !== "string" || !BYTES32.test(value)) return fail(operation);
  return value as HexBytes32;
}

function safeInteger(value: unknown, operation: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return fail(operation);
  return value as number;
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
          if (new Set(Object.values(topics)).size !== 9) {
            return fail("custom-registry-topic-collision");
          }
          const authorizedWriters = array(
            deployment.authorizedWriters,
            "custom-registry-authorized-writers",
          ).map((writer) =>
            address(writer, "custom-registry-authorized-writer"),
          );
          if (
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
          authorizedWriters: deployment.authorizedWriters,
          topics: deployment.topics,
        }),
      ),
    ),
  );
}

function validateFeePolicy(
  feeValue: unknown,
  partnerValue: CustomLaunchProjectionRecordV3["partner"],
): CustomLaunchFeePolicyV3 {
  const fee = record(feeValue, "custom-registry-fee");
  const evidenceHashes = array(
    fee.evidenceHashes,
    "custom-registry-fee-evidence",
  ).map((value) => digest(value, "custom-registry-fee-evidence-hash"));
  if (evidenceHashes.length === 0 || fee.verificationStatus !== "verified") {
    return fail("custom-registry-fee-unverified");
  }
  const programmableRecipient = address(
    fee.programmableRecipient,
    "custom-registry-programmable-recipient",
  );
  const common = {
    basis: text(fee.basis, "custom-registry-fee-basis", 512),
    currency: text(fee.currency, "custom-registry-fee-currency", 512),
    accrual: text(fee.accrual, "custom-registry-fee-accrual", 2_048),
    claim: text(fee.claim, "custom-registry-fee-claim", 2_048),
    evidenceHashes: Object.freeze(evidenceHashes),
  };
  if (programmableRecipient !== PROGRAMMABLE_FEE_RECIPIENT) {
    return fail("custom-registry-programmable-recipient");
  }
  if (partnerValue === null) {
    if (
      fee.kind !== "native-custom" ||
      fee.chargeMode !== "verified-official-market-only" ||
      fee.totalBps !== 10 ||
      fee.partnerShareBps !== 0 ||
      fee.programmableShareBps !== 10 ||
      fee.partnerRecipient !== null ||
      fee.normalCustomFeeApplied !== true
    ) {
      return fail("custom-registry-native-fee");
    }
    return Object.freeze({
      kind: "native-custom",
      chargeMode: "verified-official-market-only",
      ...common,
      totalBps: 10,
      partnerShareBps: 0,
      programmableShareBps: 10,
      partnerRecipient: null,
      programmableRecipient: PROGRAMMABLE_FEE_RECIPIENT,
      normalCustomFeeApplied: true,
      verificationStatus: "verified",
    });
  }
  if (
    fee.kind !== "partner-template" ||
    fee.chargeMode !== "template-native" ||
    fee.totalBps !== 20 ||
    fee.partnerShareBps !== 15 ||
    fee.programmableShareBps !== 5 ||
    fee.normalCustomFeeApplied !== false ||
    address(fee.partnerRecipient, "custom-registry-partner-recipient") !==
      partnerValue.recipient
  ) {
    return fail("custom-registry-partner-fee");
  }
  return Object.freeze({
    kind: "partner-template",
    chargeMode: "template-native",
    ...common,
    totalBps: 20,
    partnerShareBps: 15,
    programmableShareBps: 5,
    partnerRecipient: partnerValue.recipient,
    programmableRecipient: PROGRAMMABLE_FEE_RECIPIENT,
    normalCustomFeeApplied: false,
    verificationStatus: "verified",
  });
}

function validateProducerRecord(
  value: CustomLaunchRegistryProducerRecordV3,
  event: CustomRegistryEventV3,
): CustomLaunchRegistryProducerRecordV3 {
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
  const approvalBindingHash = digest(
    approval.approvalBindingHash,
    "custom-registry-producer-approval-binding-hash",
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
  for (const item of contracts) {
    const contract = record(item, "custom-registry-producer-contract");
    const contractAddress = record(
      contract.address,
      "custom-registry-producer-contract-address",
    );
    if (contractAddress.namespace !== "eip155-address") {
      return fail("custom-registry-producer-contract-namespace");
    }
    address(contractAddress.value, "custom-registry-producer-contract-address");
    // This is a raw EVM bytes32 code hash. Do not accept sha256-prefixed commitments.
    bytes32(
      contract.runtimeCodeKeccak256,
      "custom-registry-producer-evm-runtime-code-hash",
    );
    digest(
      contract.runtimeCodeSha256,
      "custom-registry-producer-runtime-content-sha256",
    );
  }
  for (const field of [
    "postLaunchAuthorityInventoryHash",
    "assetIdentitySetHash",
    "marketSetHash",
  ] as const) {
    digest(source[field], `custom-registry-producer-${field}`);
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
  let partner: CustomLaunchProjectionRecordV3["partner"] = null;
  if (source.partner !== null) {
    const partnerSource = record(source.partner, "custom-registry-partner");
    const status = partnerSource.status;
    if (!new Set(["active", "paused", "retired"]).has(String(status))) {
      return fail("custom-registry-partner-status");
    }
    partner = Object.freeze({
      id: safeId(partnerSource.id, "custom-registry-partner-id"),
      name: text(partnerSource.name, "custom-registry-partner-name", 256),
      status: status as "active" | "paused" | "retired",
      recipient: address(
        partnerSource.recipient,
        "custom-registry-partner-recipient",
      ),
    });
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
  validateFeePolicy(source.feePolicy, partner);

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
        event.previousOnchainRecordHash !== null ||
        event.registeredRecordHash !== event.latestOnchainRecordHash ||
        event.revocationEvidenceHash !== null ||
        !registrationEvidence)) ||
    (event.operation === "finalized" &&
      (event.record !== null ||
        event.producerRecord === null ||
        event.previousOnchainRecordHash !== null ||
        event.revocationEvidenceHash !== null ||
        !finalizedEvidence)) ||
    (event.operation === "corrected" &&
      (event.record === null ||
        event.producerRecord === null ||
        event.previousOnchainRecordHash === null ||
        event.revocationEvidenceHash !== null ||
        !mutationEvidence)) ||
    (event.operation === "revoked" &&
      (event.record !== null ||
        event.producerRecord === null ||
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
  if (event.producerRecord !== null) {
    validateProducerRecord(event.producerRecord, event);
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
      programmableVerified(sourceWithoutProjection),
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
