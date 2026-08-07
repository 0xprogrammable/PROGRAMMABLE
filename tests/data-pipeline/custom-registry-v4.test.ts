import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3,
  PROGRAMMABLE_CUSTOM_LABEL,
  CustomRegistryProjectorV3,
  customRegistryOnchainFeePolicyHashV1,
  parseCustomRegistryDeploymentManifestV3,
  type CustomLaunchOnchainFeePolicyV1,
  type CustomLaunchRegistryProducerRecordV3,
  type CustomRegistryEventV3,
  type HexAddress,
  type HexBytes32,
  type Sha256Digest,
} from "../../lib/data-pipeline/custom-registry-v3";
import {
  CUSTOM_REGISTRY_GEN2_ATOMIC_REGISTRAR_ABI_SHA256,
  CUSTOM_REGISTRY_GEN2_ATOMIC_REGISTRAR_CONTRACT_ID,
  CUSTOM_REGISTRY_GEN2_CONTRACT_ID,
  CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256,
  CUSTOM_REGISTRY_GEN2_EVENT_SET_HASH,
  CUSTOM_REGISTRY_GEN2_EVENT_SET_ID,
  CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN,
  CUSTOM_REGISTRY_GEN2_FEE_POLICY_VERIFIER_ABI_SHA256,
  CUSTOM_REGISTRY_GEN2_FEE_POLICY_VERIFIER_CONTRACT_ID,
  CUSTOM_REGISTRY_GEN2_INTEGRATION_ABI_VERSION,
  CUSTOM_REGISTRY_GEN2_MANIFEST_SCHEMA_V4,
  CUSTOM_REGISTRY_GEN2_PARTNER_FACTORY_REGISTRY_ABI_SHA256,
  CUSTOM_REGISTRY_GEN2_PARTNER_FACTORY_REGISTRY_CONTRACT_ID,
  CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256,
  CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT,
  CUSTOM_REGISTRY_GEN2_EVENT_BINDINGS,
  CUSTOM_REGISTRY_GEN2_TOPICS,
  CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4,
  customRegistryApprovalBindingHashV2,
  customRegistryGen2AbiEventProofV4,
  customRegistryGen2AtomicExecutionAbiProofV4,
  customRegistryGen2CompanionAbiProofV4,
  customRegistryGen2PartnerFactoryAuthorizedAbiProofV4,
  customRegistryGen2PartnerFactorySourceBoundAbiProofV4,
  customRegistryOnchainFeePolicyHashV2,
  customRegistryPartnerConfigurationHashV2,
  customRegistryProducerEnvelopeDigestV4,
  customRegistryRawProducerHashV4,
  customRegistryRegisteredRecordBindingV2,
  customRegistryReviewDeploymentBindingHashV2,
  projectCustomRegistryGen2EnvelopeV4,
  projectCustomRegistryGen2RecordV4,
  type CanonicalHeadV4,
  type CustomLaunchOnchainFeePolicyV2,
  type CustomLaunchRegistryProducerRecordV4,
  type CustomRegistryGen2EventV4,
  type CustomRegistryGen2ProjectionManifestV4,
  type CustomRegistryGen2PartnerFactoryAuthorizationV4,
  type CustomRegistryGen2AbiEventPayloadV4,
  type CustomRegistryGen2ParityProjectionV4,
  type CustomRegistryGen2TransitionCheckpointV4,
} from "../../lib/data-pipeline/custom-registry-v4";
import v3GoldenJson from "../fixtures/custom-launch-registry-record-v3-approval-8665.json";
import gen2Golden from "../fixtures/custom-launch-registry-record-v4-gen2-golden.json";
import gen2FullEnvelope from "../fixtures/custom-launch-registry-projection-envelope-v4-gen2.json";

const ZERO_BYTES32 = `0x${"0".repeat(64)}` as HexBytes32;
const REGISTRY_RUNTIME = `0x${"77".repeat(32)}` as HexBytes32;
const WRITER = `0x${"88".repeat(20)}` as HexAddress;
const APPROVER = `0x${"99".repeat(20)}` as HexAddress;
const PARTNER_FACTORY_REGISTRY = `0x${"66".repeat(20)}` as HexAddress;
const PARTNER_FACTORY_REGISTRY_RUNTIME = `0x${"66".repeat(32)}` as HexBytes32;
const FEE_POLICY_VERIFIER = `0x${"44".repeat(20)}` as HexAddress;
const FEE_POLICY_VERIFIER_RUNTIME = `0x${"44".repeat(32)}` as HexBytes32;
const ATOMIC_REGISTRAR = `0x${"33".repeat(20)}` as HexAddress;
const ATOMIC_REGISTRAR_RUNTIME = `0x${"33".repeat(32)}` as HexBytes32;
const PROVIDER_FACTORY = `0x${"22".repeat(20)}` as HexAddress;
const PROVIDER_FACTORY_RUNTIME = `0x${"22".repeat(32)}` as HexBytes32;
const sha = (seed: string): Sha256Digest =>
  `sha256:${createHash("sha256").update(seed).digest("hex")}`;
const hex = (seed: string): HexBytes32 =>
  `0x${createHash("sha256").update(seed).digest("hex")}`;
const raw = (value: Sha256Digest): HexBytes32 =>
  `0x${value.slice("sha256:".length)}`;

function releaseContracts() {
  const v3 = v3GoldenJson as unknown as CustomLaunchRegistryProducerRecordV3;
  return {
    registry: {
      address: v3.registryOrigin.registryAddress,
      runtimeCodeHash: REGISTRY_RUNTIME,
      startBlock: v3.registryOrigin.registryStartBlock,
      contractId: CUSTOM_REGISTRY_GEN2_CONTRACT_ID,
      abiSha256: CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256,
    },
    partnerFactoryRegistry: {
      address: PARTNER_FACTORY_REGISTRY,
      runtimeCodeHash: PARTNER_FACTORY_REGISTRY_RUNTIME,
      startBlock: v3.registryOrigin.registryStartBlock,
      contractId: CUSTOM_REGISTRY_GEN2_PARTNER_FACTORY_REGISTRY_CONTRACT_ID,
      abiSha256: CUSTOM_REGISTRY_GEN2_PARTNER_FACTORY_REGISTRY_ABI_SHA256,
    },
    feePolicyVerifier: {
      address: FEE_POLICY_VERIFIER,
      runtimeCodeHash: FEE_POLICY_VERIFIER_RUNTIME,
      startBlock: v3.registryOrigin.registryStartBlock,
      contractId: CUSTOM_REGISTRY_GEN2_FEE_POLICY_VERIFIER_CONTRACT_ID,
      abiSha256: CUSTOM_REGISTRY_GEN2_FEE_POLICY_VERIFIER_ABI_SHA256,
    },
    atomicRegistrar: {
      address: ATOMIC_REGISTRAR,
      runtimeCodeHash: ATOMIC_REGISTRAR_RUNTIME,
      startBlock: v3.registryOrigin.registryStartBlock,
      contractId: CUSTOM_REGISTRY_GEN2_ATOMIC_REGISTRAR_CONTRACT_ID,
      abiSha256: CUSTOM_REGISTRY_GEN2_ATOMIC_REGISTRAR_ABI_SHA256,
    },
  } as const;
}

function manifest(): CustomRegistryGen2ProjectionManifestV4 {
  return {
    schemaVersion: CUSTOM_REGISTRY_GEN2_MANIFEST_SCHEMA_V4,
    platformId: "programmable",
    category: "custom",
    chainId: "1",
    caip2: "eip155:1",
    registryGeneration: "2",
    confirmationDepth: "2",
    finalityDepth: "64",
    registryContractId: CUSTOM_REGISTRY_GEN2_CONTRACT_ID,
    contractIntegrationAbiVersion:
      CUSTOM_REGISTRY_GEN2_INTEGRATION_ABI_VERSION,
    registryReleaseSourceCommit: CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT,
    registryAbiSha256: CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256,
    registryEventSetId: CUSTOM_REGISTRY_GEN2_EVENT_SET_ID,
    registryEventSetHash: CUSTOM_REGISTRY_GEN2_EVENT_SET_HASH,
    registryEventSetBytesSha256: CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256,
    feePolicyDomain: CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN,
    topics: CUSTOM_REGISTRY_GEN2_TOPICS,
    eventBindings: CUSTOM_REGISTRY_GEN2_EVENT_BINDINGS,
    contracts: releaseContracts(),
    authorizedWriters: {
      finalizers: [WRITER],
      correctors: [WRITER],
      revokers: [WRITER],
    },
  };
}

function reseal(
  value:
    | Omit<CustomLaunchRegistryProducerRecordV4, "envelopeDigest">
    | CustomLaunchRegistryProducerRecordV4,
): CustomLaunchRegistryProducerRecordV4 {
  const {
    schemaVersion: _schemaVersion,
    envelopeDigest: _envelopeDigest,
    ...envelopePreimage
  } = value as CustomLaunchRegistryProducerRecordV4;
  void _schemaVersion;
  void _envelopeDigest;
  return {
    schemaVersion: CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4,
    ...envelopePreimage,
    envelopeDigest: customRegistryProducerEnvelopeDigestV4(envelopePreimage),
  };
}

function producer(
  finalityStatus: "observed" | "confirmed" | "finalized" = "observed",
): CustomLaunchRegistryProducerRecordV4 {
  const v3 = structuredClone(v3GoldenJson) as unknown as
    CustomLaunchRegistryProducerRecordV3;
  const v3Preimage = v3.registeredRecordPreimage;
  const v3Fee = v3.onchainFeePolicy;
  const feePolicy: CustomLaunchOnchainFeePolicyV2 = {
    ...v3Fee,
    providerId: v3Fee.partnerId,
    modelId: ZERO_BYTES32,
    modelVersion: ZERO_BYTES32,
    marketPathId: ZERO_BYTES32,
  };
  delete (feePolicy as unknown as Record<string, unknown>).partnerId;
  let registeredRecordPreimage = {
    ...v3Preimage,
    registryGeneration: "2",
    configurationHash: raw(v3.approvalBinding.configurationCommitment),
    permissionsHash: raw(v3.postLaunchAuthorityInventoryHash),
    providerId: v3Preimage.partnerId,
    marketPathId: feePolicy.marketPathId,
    feePolicyHash: customRegistryOnchainFeePolicyHashV2(feePolicy),
  };
  delete (registeredRecordPreimage as unknown as Record<string, unknown>).partnerId;
  registeredRecordPreimage = {
    ...registeredRecordPreimage,
    approvalBindingHash: customRegistryApprovalBindingHashV2(
      registeredRecordPreimage,
    ),
  };
  registeredRecordPreimage = {
    ...registeredRecordPreimage,
    reviewDeploymentBindingHash:
      customRegistryReviewDeploymentBindingHashV2(registeredRecordPreimage),
  };
  const binding = customRegistryRegisteredRecordBindingV2(
    registeredRecordPreimage,
  );
  const atomicExecutionFields = {
    launchId: v3.registryOrigin.registryLaunchIdRaw,
    deployed: registeredRecordPreimage.primaryContract,
    salt: hex("gen2-atomic-salt"),
    creationCodeHash: hex("gen2-atomic-creation-code"),
    initializationResultHash: hex("gen2-atomic-initialization-result"),
  } as const;
  const atomicExecutionAbi = customRegistryGen2AtomicExecutionAbiProofV4(
    atomicExecutionFields,
  );
  const recordWithoutEnvelope = {
    ...v3,
    schemaVersion: CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4,
    registeredRecordPreimage,
    registeredRecordComponentHashes: binding.componentHashes,
    registeredRecordCommitment: binding.registeredRecordCommitment,
    registrationBindingHash: binding.registrationBindingHash,
    registryOrigin: {
      ...v3.registryOrigin,
      registryGeneration: "2",
      registrationBindingHashRaw: binding.registrationBindingHash,
      registeredRecordHash: binding.registeredRecordCommitment,
      registryEventSetHash: CUSTOM_REGISTRY_GEN2_EVENT_SET_HASH,
      registryContractId: CUSTOM_REGISTRY_GEN2_CONTRACT_ID,
      contractIntegrationAbiVersion:
        CUSTOM_REGISTRY_GEN2_INTEGRATION_ABI_VERSION,
      registryReleaseSourceCommit: CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT,
      registryAbiSha256: CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256,
      registryEventSetId: CUSTOM_REGISTRY_GEN2_EVENT_SET_ID,
      registryEventSetBytesSha256:
        CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256,
      feePolicyDomain: CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN,
      registrationOnchainTimestamp: v3.finality.onchainTimestamp,
      releaseContracts: releaseContracts(),
      eventBindings: CUSTOM_REGISTRY_GEN2_EVENT_BINDINGS,
    },
    onchainFeePolicy: feePolicy,
    partnerFactoryAuthorization: null,
    atomicExecutionProof: {
      emitterRole: "atomicRegistrar",
      emitterAddress: ATOMIC_REGISTRAR,
      observedRuntimeCodeHash: ATOMIC_REGISTRAR_RUNTIME,
      topic0: CUSTOM_REGISTRY_GEN2_TOPICS.atomicExecuted,
      transactionHash: v3.registryOrigin.registrationTransactionHash,
      blockNumber: v3.registryOrigin.registrationBlockNumber,
      blockHash: v3.registryOrigin.registrationBlockHash,
      transactionIndex: Number(
        v3.registryOrigin.registrationTransactionIndex,
      ),
      logIndex: Number(v3.registryOrigin.registrationLogIndex) + 7,
      ...atomicExecutionFields,
      indexedTopics: atomicExecutionAbi.indexedTopics,
      data: atomicExecutionAbi.data,
    },
    lifecycle: {
      ...v3.lifecycle,
      registryGeneration: "2",
      status: "active",
      supersededBy: null,
      revokedAt: null,
      revocationEvidenceHash: null,
    },
    finality: {
      ...v3.finality,
      status: finalityStatus,
      confirmedAt: finalityStatus === "observed"
        ? null
        : v3.finality.confirmedAt,
      finalizedAt: finalityStatus === "finalized"
        ? v3.finality.finalizedAt
        : null,
      orphanedAt: null,
    },
  } as const;
  return reseal(recordWithoutEnvelope);
}

function event(
  recordValue = producer(),
): CustomRegistryGen2EventV4 {
  const transactionIndex = Number(
    recordValue.registryOrigin.registrationTransactionIndex,
  );
  const logIndex = Number(recordValue.registryOrigin.registrationLogIndex);
  const transactionHash = recordValue.registryOrigin.registrationTransactionHash;
  const blockNumber = recordValue.registryOrigin.registrationBlockNumber;
  const blockHash = recordValue.registryOrigin.registrationBlockHash;
  const eventPayload = {
    kind: "registered",
    registrationSequence: "1",
    chainId: "1",
    registryGeneration: "2",
    approvalId: recordValue.registeredRecordPreimage.approvalId,
    deploymentId: recordValue.registeredRecordPreimage.deploymentId,
    primaryContract: recordValue.registeredRecordPreimage.primaryContract,
    launchWallet: recordValue.registeredRecordPreimage.launchWallet,
    identityHash: recordValue.registrationBindingHash,
    registeredRecordCommitment: recordValue.registeredRecordCommitment,
    observedAtBlock: blockNumber,
  } as const;
  const abiProof = customRegistryGen2AbiEventProofV4({
    registryLaunchIdRaw: recordValue.registryOrigin.registryLaunchIdRaw,
    registryProjectIdRaw: recordValue.registeredRecordPreimage.projectId,
    payload: eventPayload,
  });
  return {
    operation: "registered",
    chainId: "1",
    caip2: "eip155:1",
    registryGeneration: "2",
    registryAddress: recordValue.registryOrigin.registryAddress,
    observedRegistryRuntimeCodeHash: REGISTRY_RUNTIME,
    emitterRole: "registry",
    emitterAddress: recordValue.registryOrigin.registryAddress,
    topic0: CUSTOM_REGISTRY_GEN2_TOPICS.registered,
    indexedTopics: abiProof.indexedTopics,
    data: abiProof.data,
    registrationCompanions: ([
      "provenance",
      "review",
      "attribution",
      "feePolicy",
      "feeScope",
      "feeEvidence",
    ] as const).map((kind, position) => ({
      ...customRegistryGen2CompanionAbiProofV4(kind, recordValue),
      kind,
      emitterRole: "registry" as const,
      emitterAddress: recordValue.registryOrigin.registryAddress,
      observedRuntimeCodeHash: REGISTRY_RUNTIME,
      topic0: CUSTOM_REGISTRY_GEN2_TOPICS[kind],
      transactionHash,
      blockNumber,
      blockHash,
      transactionIndex,
      logIndex: logIndex + position + 1,
    })),
    eventPayload,
    transactionHash,
    blockNumber,
    blockHash,
    transactionIndex,
    logIndex,
    onchainTimestamp: recordValue.registryOrigin.registrationOnchainTimestamp,
    launchId: recordValue.launchId,
    projectId: recordValue.projectId,
    registryLaunchIdRaw: recordValue.registryOrigin.registryLaunchIdRaw,
    registryProjectIdRaw: recordValue.registeredRecordPreimage.projectId,
    registeredRecordHash: recordValue.registeredRecordCommitment,
    identityHash: recordValue.registrationBindingHash,
    producerRecord: recordValue,
  };
}

function head(
  eventValue: CustomRegistryGen2EventV4,
  depth: bigint,
  canonical = true,
): CanonicalHeadV4 {
  const blockNumber = String(BigInt(eventValue.blockNumber) + depth);
  return {
    chainId: eventValue.chainId,
    blockNumber,
    blockHash: hex(`head:${blockNumber}`),
    observedAt: "2026-08-07T08:00:00.000Z",
    canonicalBlockHash: (candidate) => {
      if (candidate === eventValue.blockNumber) {
        return canonical ? eventValue.blockHash : hex("reorged-block");
      }
      if (candidate === eventValue.producerRecord.registryOrigin.registrationBlockNumber) {
        return eventValue.producerRecord.registryOrigin.registrationBlockHash;
      }
      if (
        eventValue.eventPayload.kind === "finalized" &&
        candidate === eventValue.eventPayload.confirmedHeadBlockNumber
      ) {
        return eventValue.eventPayload.confirmedHeadBlockHash;
      }
      return hex(`canonical:${candidate}`);
    },
  };
}

function transitionCheckpoint(
  lastTransitionSequence: string,
): CustomRegistryGen2TransitionCheckpointV4 {
  return {
    chainId: "1",
    caip2: "eip155:1",
    registryGeneration: "2",
    registryAddress: releaseContracts().registry.address,
    lastTransitionSequence,
  };
}

function unixSeconds(instant: string): string {
  return String(Date.parse(instant) / 1_000);
}

function transitionEvent(input: Readonly<{
  operation: "finalized" | "corrected" | "revoked";
  record: CustomLaunchRegistryProducerRecordV4;
  payload: CustomRegistryGen2AbiEventPayloadV4;
  blockNumber: string;
  onchainTimestamp: string;
}>): CustomRegistryGen2EventV4 {
  const blockHash = hex(`${input.operation}:block:${input.blockNumber}`);
  const transactionHash = hex(`${input.operation}:transaction:${input.blockNumber}`);
  const abiProof = customRegistryGen2AbiEventProofV4({
    registryLaunchIdRaw: input.record.registryOrigin.registryLaunchIdRaw,
    registryProjectIdRaw: input.record.registeredRecordPreimage.projectId,
    payload: input.payload,
  });
  return {
    operation: input.operation,
    chainId: "1",
    caip2: "eip155:1",
    registryGeneration: "2",
    registryAddress: input.record.registryOrigin.registryAddress,
    observedRegistryRuntimeCodeHash: REGISTRY_RUNTIME,
    emitterRole: "registry",
    emitterAddress: input.record.registryOrigin.registryAddress,
    topic0: CUSTOM_REGISTRY_GEN2_TOPICS[input.operation],
    indexedTopics: abiProof.indexedTopics,
    data: abiProof.data,
    registrationCompanions: [],
    eventPayload: input.payload,
    transactionHash,
    blockNumber: input.blockNumber,
    blockHash,
    transactionIndex: 3,
    logIndex: 5,
    onchainTimestamp: input.onchainTimestamp,
    launchId: input.record.launchId,
    projectId: input.record.projectId,
    registryLaunchIdRaw: input.record.registryOrigin.registryLaunchIdRaw,
    registryProjectIdRaw: input.record.registeredRecordPreimage.projectId,
    registeredRecordHash: input.record.registeredRecordCommitment,
    identityHash: input.record.registrationBindingHash,
    producerRecord: input.record,
  } as CustomRegistryGen2EventV4;
}

function finalizedEvent(
  record: CustomLaunchRegistryProducerRecordV4,
  transitionSequence = "2",
): CustomRegistryGen2EventV4 {
  const finalizedAt = record.finality.finalizedAt;
  if (finalizedAt === null) throw new Error("fixture");
  const confirmedHeadBlockNumber = String(
    BigInt(record.registryOrigin.registrationBlockNumber) + 64n,
  );
  return transitionEvent({
    operation: "finalized",
    record,
    blockNumber: String(BigInt(confirmedHeadBlockNumber) + 1n),
    onchainTimestamp: finalizedAt,
    payload: {
      kind: "finalized",
      observedTransactionHash:
        record.registryOrigin.registrationTransactionHash,
      finalityEvidenceHash: raw(record.finality.finalityEvidenceHash),
      transitionSequence,
      observedBlockNumber: record.registryOrigin.registrationBlockNumber,
      observedBlockHash: record.registryOrigin.registrationBlockHash,
      observedTransactionIndex: Number(
        record.registryOrigin.registrationTransactionIndex,
      ),
      observedLogIndex: Number(record.registryOrigin.registrationLogIndex),
      confirmedHeadBlockNumber,
      confirmedHeadBlockHash: hex(`confirmed-head:${confirmedHeadBlockNumber}`),
      finalityPolicyHash: record.registeredRecordPreimage.finalityPolicyHash,
      finalizedAtBlock: String(BigInt(confirmedHeadBlockNumber) + 1n),
      finalizedAtTimestamp: unixSeconds(finalizedAt),
    },
  });
}

function correctedRecord(
  revision = "2",
): CustomLaunchRegistryProducerRecordV4 {
  const base = producer("finalized");
  return reseal({
    ...base,
    extensions: {
      ...base.extensions,
      "fixture:correctionRevision": revision,
    },
  });
}

function correctedEvent(
  record: CustomLaunchRegistryProducerRecordV4,
  previous: CustomRegistryGen2ParityProjectionV4,
  transitionSequence = "3",
  revision = "2",
): CustomRegistryGen2EventV4 {
  return transitionEvent({
    operation: "corrected",
    record,
    blockNumber: String(BigInt(previous.origin.blockNumber) + 1n),
    onchainTimestamp: "2026-08-06T10:04:00.000Z",
    payload: {
      kind: "corrected",
      revision,
      correctedRecordHash: raw(customRegistryRawProducerHashV4(record)),
      transitionSequence,
      previousRecordHash: previous.origin.latestRecordHash,
      reasonCode: hex("correction-reason"),
      evidenceHash: hex("correction-evidence"),
    },
  });
}

function revokedRecord(
  previous: CustomLaunchRegistryProducerRecordV4,
): CustomLaunchRegistryProducerRecordV4 {
  return reseal({
    ...previous,
    lifecycle: {
      ...previous.lifecycle,
      status: "revoked",
      supersededBy: null,
      revokedAt: "2026-08-06T10:05:00.000Z",
      revocationEvidenceHash: sha("revocation-evidence"),
    },
  });
}

function revokedEvent(
  record: CustomLaunchRegistryProducerRecordV4,
  previous: CustomRegistryGen2ParityProjectionV4,
  transitionSequence = "4",
): CustomRegistryGen2EventV4 {
  const revokedAt = record.lifecycle.revokedAt;
  const evidenceHash = record.lifecycle.revocationEvidenceHash;
  if (revokedAt === null || evidenceHash === null) throw new Error("fixture");
  const blockNumber = String(BigInt(previous.origin.blockNumber) + 1n);
  return transitionEvent({
    operation: "revoked",
    record,
    blockNumber,
    onchainTimestamp: revokedAt,
    payload: {
      kind: "revoked",
      reasonCode: hex("revocation-reason"),
      evidenceHash: raw(evidenceHash),
      transitionSequence,
      latestRecordRevision: previous.origin.latestRecordRevision,
      latestRecordHash: previous.origin.latestRecordHash,
      revokedAtBlock: blockNumber,
      revokedAtTimestamp: unixSeconds(revokedAt),
    },
  });
}

function withEventPayload(
  value: CustomRegistryGen2EventV4,
  payload: CustomRegistryGen2AbiEventPayloadV4,
): CustomRegistryGen2EventV4 {
  const abiProof = customRegistryGen2AbiEventProofV4({
    registryLaunchIdRaw: value.registryLaunchIdRaw,
    registryProjectIdRaw: value.registryProjectIdRaw,
    payload,
  });
  return {
    ...value,
    operation: payload.kind,
    topic0: CUSTOM_REGISTRY_GEN2_TOPICS[payload.kind],
    eventPayload: payload,
    indexedTopics: abiProof.indexedTopics,
    data: abiProof.data,
    registrationCompanions: payload.kind === "registered"
      ? value.registrationCompanions
      : [],
  } as CustomRegistryGen2EventV4;
}

function finalizedTransitionFixture() {
  const registrationEvent = event(producer("observed"));
  const registered = projectCustomRegistryGen2RecordV4({
    manifest: manifest(),
    event: registrationEvent,
    head: head(registrationEvent, 1n),
  });
  const record = producer("finalized");
  const registryEvent = finalizedEvent(record);
  const projection = projectCustomRegistryGen2RecordV4({
    manifest: manifest(),
    event: registryEvent,
    head: head(registryEvent, 1n),
    previousProjection: registered,
    transitionCheckpoint: transitionCheckpoint("1"),
  });
  return { registered, record, registryEvent, projection };
}

function correctedTransitionFixture() {
  const finalized = finalizedTransitionFixture();
  const record = correctedRecord();
  const registryEvent = correctedEvent(record, finalized.projection);
  const projection = projectCustomRegistryGen2RecordV4({
    manifest: manifest(),
    event: registryEvent,
    head: head(registryEvent, 1n),
    previousProjection: finalized.projection,
    transitionCheckpoint: transitionCheckpoint("2"),
  });
  return { finalized, record, registryEvent, projection };
}

function rebind(
  value: CustomLaunchRegistryProducerRecordV4,
  registeredRecordPreimage: CustomLaunchRegistryProducerRecordV4["registeredRecordPreimage"],
): CustomLaunchRegistryProducerRecordV4 {
  registeredRecordPreimage = {
    ...registeredRecordPreimage,
    approvalBindingHash:
      customRegistryApprovalBindingHashV2(registeredRecordPreimage),
  };
  registeredRecordPreimage = {
    ...registeredRecordPreimage,
    reviewDeploymentBindingHash:
      customRegistryReviewDeploymentBindingHashV2(registeredRecordPreimage),
  };
  const binding = customRegistryRegisteredRecordBindingV2(
    registeredRecordPreimage,
  );
  return reseal({
    ...value,
    registeredRecordPreimage,
    registeredRecordComponentHashes: binding.componentHashes,
    registeredRecordCommitment: binding.registeredRecordCommitment,
    registrationBindingHash: binding.registrationBindingHash,
    registryOrigin: {
      ...value.registryOrigin,
      registeredRecordHash: binding.registeredRecordCommitment,
      registrationBindingHashRaw: binding.registrationBindingHash,
    },
    atomicExecutionProof: value.atomicExecutionProof === null
      ? null
      : value.atomicExecutionProof,
  });
}

function recommitWithoutDerivedBindingRepair(
  value: CustomLaunchRegistryProducerRecordV4,
  registeredRecordPreimage: CustomLaunchRegistryProducerRecordV4["registeredRecordPreimage"],
): CustomLaunchRegistryProducerRecordV4 {
  const binding = customRegistryRegisteredRecordBindingV2(
    registeredRecordPreimage,
  );
  return reseal({
    ...value,
    registeredRecordPreimage,
    registeredRecordComponentHashes: binding.componentHashes,
    registeredRecordCommitment: binding.registeredRecordCommitment,
    registrationBindingHash: binding.registrationBindingHash,
    registryOrigin: {
      ...value.registryOrigin,
      registeredRecordHash: binding.registeredRecordCommitment,
      registrationBindingHashRaw: binding.registrationBindingHash,
    },
    atomicExecutionProof: value.atomicExecutionProof === null
      ? null
      : value.atomicExecutionProof,
  });
}

function providerProducer(): CustomLaunchRegistryProducerRecordV4 {
  const base = producer();
  const providerId = hex("future-provider");
  const authorizationTransactionHash = hex(
    "provider-factory-authorization-transaction",
  );
  const authorizationBlockHash = hex("provider-factory-authorization-block");
  const authorizedFields = {
    configurationHash: ZERO_BYTES32,
    providerId,
    factory: PROVIDER_FACTORY,
    modelId: base.registeredRecordPreimage.modelId,
    modelVersion: base.registeredRecordPreimage.modelVersion,
    templateId: base.registeredRecordPreimage.templateId,
    templateVersion: base.registeredRecordPreimage.templateVersion,
    validAfterBlock: "20999900",
    expiresAtBlock: "21000100",
    evidenceHash: hex("provider-factory-evidence"),
  } as const;
  const sourceBoundFields = {
    configurationHash: ZERO_BYTES32,
    modelRepositoryId: base.registeredRecordPreimage.repositoryId,
    modelSourceCommitId: base.registeredRecordPreimage.commitId,
    factorySourceRepositoryId: hex("provider-factory-repository"),
    factorySourceCommitId: hex("provider-factory-commit"),
    factoryRuntimeCodeHash: PROVIDER_FACTORY_RUNTIME,
    launchRuntimeCodeSetHash:
      base.registeredRecordPreimage.runtimeCodeSetHash,
    permissionsHash: base.registeredRecordPreimage.permissionsHash,
    feePolicyHash: base.registeredRecordPreimage.feePolicyHash,
  } as const;
  const authorizedAbi = customRegistryGen2PartnerFactoryAuthorizedAbiProofV4(
    authorizedFields,
  );
  const sourceBoundAbi = customRegistryGen2PartnerFactorySourceBoundAbiProofV4(
    sourceBoundFields,
  );
  const provisional = {
    chainId: "1",
    registryGeneration: "2",
    configurationHash: ZERO_BYTES32,
    providerId,
    modelId: base.registeredRecordPreimage.modelId,
    modelVersion: base.registeredRecordPreimage.modelVersion,
    templateId: base.registeredRecordPreimage.templateId,
    templateVersion: base.registeredRecordPreimage.templateVersion,
    modelRepositoryId: base.registeredRecordPreimage.repositoryId,
    modelSourceCommitId: base.registeredRecordPreimage.commitId,
    factorySourceRepositoryId: hex("provider-factory-repository"),
    factorySourceCommitId: hex("provider-factory-commit"),
    factory: PROVIDER_FACTORY,
    factoryRuntimeCodeHash: PROVIDER_FACTORY_RUNTIME,
    launchRuntimeCodeSetHash: base.registeredRecordPreimage.runtimeCodeSetHash,
    permissionsHash: base.registeredRecordPreimage.permissionsHash,
    feePolicyHash: base.registeredRecordPreimage.feePolicyHash,
    validAfterBlock: "20999900",
    expiresAtBlock: "21000100",
    evidenceHash: hex("provider-factory-evidence"),
    revoked: false,
    stateObservedAtBlock: "21000000",
    stateProofHash: sha("provider-factory-state-proof"),
    authorizedEvent: {
      emitterRole: "partnerFactoryRegistry",
      emitterAddress: PARTNER_FACTORY_REGISTRY,
      observedRuntimeCodeHash: PARTNER_FACTORY_REGISTRY_RUNTIME,
      topic0: CUSTOM_REGISTRY_GEN2_TOPICS.partnerFactoryAuthorized,
      indexedTopics: authorizedAbi.indexedTopics,
      data: authorizedAbi.data,
      transactionHash: authorizationTransactionHash,
      blockNumber: "20999900",
      blockHash: authorizationBlockHash,
      transactionIndex: 2,
      logIndex: 4,
      ...authorizedFields,
    },
    sourceBoundEvent: {
      emitterRole: "partnerFactoryRegistry",
      emitterAddress: PARTNER_FACTORY_REGISTRY,
      observedRuntimeCodeHash: PARTNER_FACTORY_REGISTRY_RUNTIME,
      topic0: CUSTOM_REGISTRY_GEN2_TOPICS.partnerFactorySourceBound,
      indexedTopics: sourceBoundAbi.indexedTopics,
      data: sourceBoundAbi.data,
      transactionHash: authorizationTransactionHash,
      blockNumber: "20999900",
      blockHash: authorizationBlockHash,
      transactionIndex: 2,
      logIndex: 5,
      ...sourceBoundFields,
    },
  } satisfies CustomRegistryGen2PartnerFactoryAuthorizationV4;
  const configurationHash = customRegistryPartnerConfigurationHashV2(
    provisional,
  );
  const authorization = {
    ...provisional,
    configurationHash,
    authorizedEvent: {
      ...provisional.authorizedEvent,
      configurationHash,
      ...customRegistryGen2PartnerFactoryAuthorizedAbiProofV4({
        ...authorizedFields,
        configurationHash,
      }),
    },
    sourceBoundEvent: {
      ...provisional.sourceBoundEvent,
      configurationHash,
      ...customRegistryGen2PartnerFactorySourceBoundAbiProofV4({
        ...sourceBoundFields,
        configurationHash,
      }),
    },
  } satisfies CustomRegistryGen2PartnerFactoryAuthorizationV4;
  const rebound = rebind(base, {
    ...base.registeredRecordPreimage,
    providerId,
    configurationHash,
  });
  return reseal({
    ...rebound,
    partnerFactoryAuthorization: authorization,
    atomicExecutionProof: null,
  });
}

describe("Custom Registry record v4 / Generation 2 parity adapter", () => {
  it("emits the additive versioned Developer projection envelope", () => {
    const registryEvent = event();
    const envelope = projectCustomRegistryGen2EnvelopeV4({
      manifest: manifest(),
      event: registryEvent,
      head: head(registryEvent, 1n),
    });
    expect(envelope).toEqual(gen2FullEnvelope);
    expect(envelope).toMatchObject({
      schemaVersion: "programmable.custom-launch-projection-envelope.v4",
      sourceId: "programmable-custom-launch-registry-v4",
      producerSchemaVersion: "programmable.custom-launch-registry-record.v4",
      projectionSchemaVersion: "programmable.custom-launch-projection-record.v4",
      rawRecord: { schemaVersion: CUSTOM_REGISTRY_PRODUCER_RECORD_SCHEMA_V4 },
      projection: { schemaVersion: "programmable.custom-launch-projection-record.v4" },
    });
    expect(envelope.projection.publicProjection).toEqual({
      platformId: "programmable",
      category: "custom",
      publicLabel: "Programmable Custom",
      launchId: envelope.rawRecord.launchId,
      projectId: envelope.rawRecord.projectId,
      chainId: envelope.rawRecord.registryOrigin.chainId,
      caip2: envelope.rawRecord.registryOrigin.caip2,
      model: envelope.rawRecord.model,
      template: envelope.rawRecord.template,
      partner: envelope.rawRecord.partner,
      launchingWallet: envelope.rawRecord.launchingWallet,
      launchIdentity: envelope.rawRecord.launchIdentity,
      advertisesToken: envelope.rawRecord.advertisesToken,
      assets: envelope.rawRecord.discoverableAssets,
      assetIdentitySetHash: envelope.rawRecord.assetIdentitySetHash,
      markets: envelope.rawRecord.discoverableMarkets,
      marketSetHash: envelope.rawRecord.marketSetHash,
      mechanisms: envelope.rawRecord.mechanisms,
      capabilities: envelope.rawRecord.capabilities,
      feePolicy: envelope.rawRecord.feePolicy,
      onchainFeePolicy: envelope.rawRecord.onchainFeePolicy,
      verifiedReview: envelope.rawRecord.verifiedReview,
      postLaunchAuthorityInventory:
        envelope.rawRecord.postLaunchAuthorityInventory,
      finality: envelope.projection.registryFinality,
      lifecycle: envelope.projection.lifecycle,
      presentationVersion: envelope.rawRecord.presentationVersion,
      presentationBindingHash: envelope.rawRecord.presentationBindingHash,
      presentation: envelope.rawRecord.presentation,
      extensions: envelope.rawRecord.extensions,
    });
    expect({
      schemaVersion: "programmable.custom-registry-generation-2-parity-golden.v1",
      registryReleaseSourceCommit: CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT,
      registryAbiSha256: CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256,
      registryEventSetHash: CUSTOM_REGISTRY_GEN2_EVENT_SET_HASH,
      registryEventSetBytesSha256: CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256,
      feePolicyDomain: CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN,
      sourceId: envelope.sourceId,
      producerSchemaVersion: envelope.producerSchemaVersion,
      projectionSchemaVersion: envelope.projectionSchemaVersion,
      projectionEnvelopeSchemaVersion: envelope.schemaVersion,
      registeredRecordPreimageFieldCount:
        Object.keys(envelope.rawRecord.registeredRecordPreimage).length,
      producerEnvelopeDigest: envelope.rawRecord.envelopeDigest,
      feePolicyHash: envelope.rawRecord.registeredRecordPreimage.feePolicyHash,
      registeredRecordComponentHashes:
        envelope.rawRecord.registeredRecordComponentHashes,
      registeredRecordCommitment:
        envelope.rawRecord.registeredRecordCommitment,
      registrationBindingHash: envelope.rawRecord.registrationBindingHash,
      rawRecordHash: envelope.rawRecordHash,
      projectionDigest: envelope.projectionDigest,
    }).toEqual(gen2Golden);
  });

  it.each([
    ["observed", 1n, true, "observed", "active"],
    ["confirmed", 2n, true, "confirmed", "active"],
    ["finalized", 64n, true, "finalized", "active"],
    ["observed", 1n, false, "orphaned", "orphaned"],
  ] as const)(
    "projects raw %s at depth %s with canonical=%s as %s/%s",
    (rawStatus, depth, canonical, expectedFinality, expectedLifecycle) => {
      const registryEvent = event(producer(rawStatus));
      const projection = projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: registryEvent,
        head: head(registryEvent, depth, canonical),
      });
      expect(projection).toMatchObject({
        schemaVersion: "programmable.custom-launch-projection-record.v4",
        platformId: "programmable",
        category: "custom",
        origin: {
          registryGeneration: "2",
          registryContractId: CUSTOM_REGISTRY_GEN2_CONTRACT_ID,
          registryReleaseSourceCommit: CUSTOM_REGISTRY_GEN2_RELEASE_SOURCE_COMMIT,
          registryAbiSha256: CUSTOM_REGISTRY_GEN2_REGISTRY_ABI_SHA256,
          registryEventSetHash: CUSTOM_REGISTRY_GEN2_EVENT_SET_HASH,
          registryEventSetBytesSha256:
            CUSTOM_REGISTRY_GEN2_EVENT_SET_BYTES_SHA256,
          feePolicyDomain: CUSTOM_REGISTRY_GEN2_FEE_POLICY_DOMAIN,
          operation: "registered",
          authorizedWriterSetEvidence: {
            operationRole: "atomicRegistrar",
            authorizedAddresses: [ATOMIC_REGISTRAR],
            eventCaller: null,
            callerIdentityStatus: "not-emitted-by-registry-abi",
            authorizationBasis:
              "atomic-registrar-runtime-and-same-transaction-event",
          },
          eventTopic0: CUSTOM_REGISTRY_GEN2_TOPICS.registered,
          transactionIndex: registryEvent.transactionIndex,
          logIndex: registryEvent.logIndex,
        },
        registryFinality: { status: expectedFinality },
        lifecycle: { status: expectedLifecycle, registryGeneration: "2" },
        publicProjection: {
          finality: { status: expectedFinality },
          lifecycle: { status: expectedLifecycle },
        },
      });
      expect(Object.keys(projection.registeredRecordPreimage)).toHaveLength(37);
      expect(projection.origin).not.toHaveProperty("registryWriter");
    },
  );

  it("projects finalized, corrected and revoked ABI transitions without conflating lifecycle", () => {
    const finalized = finalizedTransitionFixture();
    expect(finalized.projection).toMatchObject({
      registryFinality: { status: "finalized" },
      lifecycle: { status: "active" },
      origin: {
        operation: "finalized",
        authorizedWriterSetEvidence: {
          operationRole: "finalizer",
          authorizedAddresses: [WRITER],
          eventCaller: null,
          callerIdentityStatus: "not-emitted-by-registry-abi",
          authorizationBasis: "registry-role-guard-and-manifest-allowlist",
        },
        transitionSequence: "2",
        latestRecordRevision: "1",
        latestRecordHash: finalized.registered.registeredRecordCommitment,
        eventPayload: { kind: "finalized", transitionSequence: "2" },
      },
      publicProjection: {
        finality: { status: "finalized" },
        lifecycle: { status: "active" },
      },
    });

    const corrected = correctedTransitionFixture();
    expect(corrected.projection).toMatchObject({
      registryFinality: { status: "finalized" },
      lifecycle: { status: "active" },
      origin: {
        operation: "corrected",
        transitionSequence: "3",
        latestRecordRevision: "2",
        eventPayload: { kind: "corrected", revision: "2" },
      },
      publicProjection: {
        finality: { status: "finalized" },
        lifecycle: { status: "active" },
      },
    });
    expect(corrected.projection.origin.latestRecordHash).toBe(
      raw(customRegistryRawProducerHashV4(corrected.record)),
    );

    const record = revokedRecord(corrected.record);
    const registryEvent = revokedEvent(record, corrected.projection);
    const revoked = projectCustomRegistryGen2RecordV4({
      manifest: manifest(),
      event: registryEvent,
      head: head(registryEvent, 1n),
      previousProjection: corrected.projection,
      transitionCheckpoint: transitionCheckpoint("3"),
    });
    expect(revoked).toMatchObject({
      registryFinality: { status: "finalized" },
      lifecycle: { status: "revoked" },
      origin: {
        operation: "revoked",
        transitionSequence: "4",
        latestRecordRevision: "2",
        latestRecordHash: corrected.projection.origin.latestRecordHash,
        eventPayload: { kind: "revoked", transitionSequence: "4" },
      },
      publicProjection: {
        finality: { status: "finalized" },
        lifecycle: { status: "revoked" },
      },
    });
  });

  it("rejects finalized raw evidence before canonical depth", () => {
    const registryEvent = event(producer("finalized"));
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: registryEvent,
        head: head(registryEvent, 1n),
      })
    ).toThrow();
  });

  it("requires head minus observed block to meet the full configured depth", () => {
    const atSixtyThree = event(producer("finalized"));
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: atSixtyThree,
        head: head(atSixtyThree, 63n),
      })
    ).toThrow();
    const atSixtyFour = event(producer("finalized"));
    expect(
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: atSixtyFour,
        head: head(atSixtyFour, 64n),
      }).registryFinality.status,
    ).toBe("finalized");
  });

  it.each([
    "transactionHash",
    "blockHash",
    "blockNumber",
    "transactionIndex",
    "logIndex",
    "onchainTimestamp",
  ] as const)("rejects a mismatched raw finality %s anchor", (field) => {
    const value = structuredClone(producer("observed"));
    const replacements = {
      transactionHash: hex("wrong-finality-transaction"),
      blockHash: hex("wrong-finality-block-hash"),
      blockNumber: "21000001",
      transactionIndex: "9",
      logIndex: "10",
      onchainTimestamp: "2026-08-06T09:59:00.000Z",
    } as const;
    (value.finality as unknown as Record<string, unknown>)[field] =
      replacements[field];
    const attackRecord = reseal(value);
    const attack = event(attackRecord);
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: attack,
        head: head(attack, 1n),
      })
    ).toThrow();
  });

  it("rejects contradictory and out-of-order raw finality timestamps", () => {
    const contradictory = structuredClone(producer("observed"));
    (contradictory.finality as unknown as { confirmedAt: string | null })
      .confirmedAt = "2026-08-06T10:02:00.000Z";
    const contradictoryRecord = reseal(contradictory);
    const contradictoryEvent = event(contradictoryRecord);
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: contradictoryEvent,
        head: head(contradictoryEvent, 2n),
      })
    ).toThrow();

    const outOfOrder = structuredClone(producer("confirmed"));
    (outOfOrder.finality as unknown as { confirmedAt: string | null })
      .confirmedAt = "2026-08-06T09:59:00.000Z";
    const outOfOrderRecord = reseal(outOfOrder);
    const outOfOrderEvent = event(outOfOrderRecord);
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: outOfOrderEvent,
        head: head(outOfOrderEvent, 2n),
      })
    ).toThrow();
  });

  it("rejects a wrong finalized registration anchor and forged ABI bytes", () => {
    const finalized = finalizedTransitionFixture();
    if (finalized.registryEvent.eventPayload.kind !== "finalized") {
      throw new Error("fixture");
    }
    const wrongAnchor = withEventPayload(finalized.registryEvent, {
      ...finalized.registryEvent.eventPayload,
      observedBlockHash: hex("wrong-finalized-observed-block"),
    });
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: wrongAnchor,
        head: head(wrongAnchor, 1n),
        previousProjection: finalized.registered,
        transitionCheckpoint: transitionCheckpoint("1"),
      })
    ).toThrow();

    const forgedData = {
      ...finalized.registryEvent,
      data: "0x00" as const,
    } as CustomRegistryGen2EventV4;
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: forgedData,
        head: head(forgedData, 1n),
        previousProjection: finalized.registered,
        transitionCheckpoint: transitionCheckpoint("1"),
      })
    ).toThrow();
  });

  it("rejects correction replay, revision gaps and wrong previous hashes", () => {
    const corrected = correctedTransitionFixture();
    const replay = correctedEvent(
      correctedRecord("2-replay"),
      corrected.projection,
      "4",
      "2",
    );
    const gap = correctedEvent(
      correctedRecord("4-gap"),
      corrected.finalized.projection,
      "3",
      "4",
    );
    if (gap.eventPayload.kind !== "corrected") throw new Error("fixture");
    const wrongPrevious = withEventPayload(gap, {
      ...gap.eventPayload,
      revision: "2",
      previousRecordHash: hex("wrong-previous-record"),
    });
    for (const [attack, previous, checkpoint] of [
      [replay, corrected.projection, "3"],
      [gap, corrected.finalized.projection, "2"],
      [wrongPrevious, corrected.finalized.projection, "2"],
    ] as const) {
      expect(() =>
        projectCustomRegistryGen2RecordV4({
          manifest: manifest(),
          event: attack,
          head: head(attack, 1n),
          previousProjection: previous,
          transitionCheckpoint: transitionCheckpoint(checkpoint),
        })
      ).toThrow();
    }
  });

  it("rejects replayed or gapped global transition sequences", () => {
    const finalized = finalizedTransitionFixture();
    if (finalized.registryEvent.eventPayload.kind !== "finalized") {
      throw new Error("fixture");
    }
    for (const transitionSequence of ["1", "3"] as const) {
      const attack = withEventPayload(finalized.registryEvent, {
        ...finalized.registryEvent.eventPayload,
        transitionSequence,
      });
      expect(() =>
        projectCustomRegistryGen2RecordV4({
          manifest: manifest(),
          event: attack,
          head: head(attack, 1n),
          previousProjection: finalized.registered,
          transitionCheckpoint: transitionCheckpoint("1"),
        })
      ).toThrow();
    }
  });

  it("rejects a missing or wrong-registry global transition checkpoint", () => {
    const finalized = finalizedTransitionFixture();
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: finalized.registryEvent,
        head: head(finalized.registryEvent, 1n),
        previousProjection: finalized.registered,
      })
    ).toThrow();
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: finalized.registryEvent,
        head: head(finalized.registryEvent, 1n),
        previousProjection: finalized.registered,
        transitionCheckpoint: {
          ...transitionCheckpoint("1"),
          registryAddress: PROVIDER_FACTORY,
        },
      })
    ).toThrow();
  });

  it("rejects forged companion ABI data and an out-of-order correction", () => {
    const registration = structuredClone(event());
    const firstCompanion = registration.registrationCompanions[0];
    if (firstCompanion === undefined) throw new Error("fixture");
    (firstCompanion as unknown as { data: `0x${string}` }).data = "0x00";
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: registration,
        head: head(registration, 1n),
      })
    ).toThrow();

    const corrected = correctedTransitionFixture();
    const outOfOrder = {
      ...corrected.registryEvent,
      blockNumber: corrected.finalized.projection.origin.blockNumber,
      blockHash: corrected.finalized.projection.origin.blockHash,
      transactionIndex: corrected.finalized.projection.origin.transactionIndex,
      logIndex: corrected.finalized.projection.origin.logIndex,
    } as CustomRegistryGen2EventV4;
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: outOfOrder,
        head: head(outOfOrder, 1n),
        previousProjection: corrected.finalized.projection,
        transitionCheckpoint: transitionCheckpoint("2"),
      })
    ).toThrow();
  });

  it("rejects every transition after terminal revocation", () => {
    const corrected = correctedTransitionFixture();
    const record = revokedRecord(corrected.record);
    const revocationEvent = revokedEvent(record, corrected.projection);
    const revoked = projectCustomRegistryGen2RecordV4({
      manifest: manifest(),
      event: revocationEvent,
      head: head(revocationEvent, 1n),
      previousProjection: corrected.projection,
      transitionCheckpoint: transitionCheckpoint("3"),
    });
    const postRevocation = correctedEvent(
      correctedRecord("3-post-revocation"),
      revoked,
      "5",
      "3",
    );
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: postRevocation,
        head: head(postRevocation, 1n),
        previousProjection: revoked,
        transitionCheckpoint: transitionCheckpoint("4"),
      })
    ).toThrow();
  });

  it("rejects a frozen v3 producer presented as Generation 2", () => {
    const registryEvent = event();
    const v3 = v3GoldenJson as unknown as CustomLaunchRegistryProducerRecordV4;
    const attack = { ...registryEvent, producerRecord: v3 };
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: attack,
        head: head(attack, 1n),
      })
    ).toThrow();
  });

  it("rejects Registry ABI, event-set and fee-domain substitutions", () => {
    const registryEvent = event();
    for (const substitution of [
      { registryAbiSha256: sha("wrong-abi") },
      { registryEventSetHash: sha("wrong-event-set") },
      { feePolicyDomain: "programmable.custom-fee-policy.v1" },
    ]) {
      expect(() =>
        projectCustomRegistryGen2RecordV4({
          manifest: { ...manifest(), ...substitution } as CustomRegistryGen2ProjectionManifestV4,
          event: registryEvent,
          head: head(registryEvent, 1n),
        })
      ).toThrow();
    }
  });

  it("accepts an exact active source-bound provider factory authorization", () => {
    const registryEvent = event(providerProducer());
    const projection = projectCustomRegistryGen2RecordV4({
      manifest: manifest(),
      event: registryEvent,
      head: head(registryEvent, 2n),
    });
    expect(projection.registryFinality.status).toBe("confirmed");
    expect(projection.lifecycle.status).toBe("active");
    expect(projection.rawProducerRecord.partnerFactoryAuthorization).toMatchObject({
      revoked: false,
      factory: PROVIDER_FACTORY,
      factoryRuntimeCodeHash: PROVIDER_FACTORY_RUNTIME,
    });
    expect(projection.origin.authorizedWriterSetEvidence).toEqual({
      operationRole: "providerFactory",
      authorizedAddresses: [PROVIDER_FACTORY],
      eventCaller: null,
      callerIdentityStatus: "not-emitted-by-registry-abi",
      authorizationBasis: "partner-factory-state-and-registry-runtime",
    });
  });

  it("rejects a same-topic event from a false Registry emitter", () => {
    const registryEvent = event();
    const attack = {
      ...registryEvent,
      emitterAddress: PROVIDER_FACTORY,
    } as CustomRegistryGen2EventV4;
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: attack,
        head: head(attack, 1n),
      })
    ).toThrow();
  });

  it.each([
    "registry",
    "partnerFactoryRegistry",
    "feePolicyVerifier",
    "atomicRegistrar",
  ] as const)("rejects a wrong %s runtime trust root", (role) => {
    const registryEvent = event();
    const changed = structuredClone(manifest());
    (changed.contracts[role] as unknown as { runtimeCodeHash: HexBytes32 })
      .runtimeCodeHash = hex(`wrong-runtime:${role}`);
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: changed,
        event: registryEvent,
        head: head(registryEvent, 1n),
      })
    ).toThrow();
  });

  it("rejects a false AtomicExecuted emitter", () => {
    const value = structuredClone(producer());
    if (value.atomicExecutionProof === null) throw new Error("fixture");
    (value.atomicExecutionProof as unknown as { emitterAddress: HexAddress })
      .emitterAddress = PROVIDER_FACTORY;
    const attackRecord = reseal(value);
    const attack = event(attackRecord);
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: attack,
        head: head(attack, 1n),
      })
    ).toThrow();
  });

  it.each(["indexedTopics", "data", "salt"] as const)(
    "rejects forged AtomicExecuted %s evidence",
    (field) => {
      const value = structuredClone(producer());
      if (value.atomicExecutionProof === null) throw new Error("fixture");
      if (field === "indexedTopics") {
        (value.atomicExecutionProof as unknown as {
          indexedTopics: HexBytes32[];
        }).indexedTopics[0] = hex("forged-atomic-topic");
      } else if (field === "data") {
        (value.atomicExecutionProof as unknown as { data: `0x${string}` })
          .data = "0x00";
      } else {
        (value.atomicExecutionProof as unknown as { salt: HexBytes32 }).salt =
          hex("forged-atomic-salt");
      }
      const attackRecord = reseal(value);
      const attack = event(attackRecord);
      expect(() =>
        projectCustomRegistryGen2RecordV4({
          manifest: manifest(),
          event: attack,
          head: head(attack, 1n),
        })
      ).toThrow();
    },
  );

  it.each(["authorized", "source-bound"] as const)(
    "rejects forged %s partner-factory raw ABI evidence",
    (kind) => {
      const value = structuredClone(providerProducer());
      const authorization = value.partnerFactoryAuthorization;
      if (authorization === null) throw new Error("fixture");
      const evidence = kind === "authorized"
        ? authorization.authorizedEvent
        : authorization.sourceBoundEvent;
      (evidence as unknown as { data: `0x${string}` }).data = "0x00";
      const attackRecord = reseal(value);
      const attack = event(attackRecord);
      expect(() =>
        projectCustomRegistryGen2RecordV4({
          manifest: manifest(),
          event: attack,
          head: head(attack, 1n),
        })
      ).toThrow();
    },
  );

  it.each(["missing", "revoked"] as const)(
    "rejects %s provider factory authorization",
    (mode) => {
      const canonicalRecord = providerProducer();
      const canonicalEvent = event(canonicalRecord);
      const value = structuredClone(canonicalRecord);
      if (mode === "missing") {
        (value as unknown as { partnerFactoryAuthorization: null })
          .partnerFactoryAuthorization = null;
      } else {
        if (value.partnerFactoryAuthorization === null) throw new Error("fixture");
        (value.partnerFactoryAuthorization as unknown as { revoked: boolean }).revoked =
          true;
      }
      const attackRecord = reseal(value);
      const attack = { ...canonicalEvent, producerRecord: attackRecord };
      expect(() =>
        projectCustomRegistryGen2RecordV4({
          manifest: manifest(),
          event: attack,
          head: head(attack, 1n),
        })
      ).toThrow();
    },
  );

  it.each(["approvalBindingHash", "reviewDeploymentBindingHash"] as const)(
    "rejects a fully re-committed forged %s",
    (field) => {
      const original = producer();
      const substituted = recommitWithoutDerivedBindingRepair(original, {
        ...original.registeredRecordPreimage,
        [field]: hex(`forged:${field}`),
      });
      const attack = event(substituted);
      expect(() =>
        projectCustomRegistryGen2RecordV4({
          manifest: manifest(),
          event: attack,
          head: head(attack, 1n),
        })
      ).toThrow();
    },
  );

  it.each(["configurationHash", "permissionsHash", "marketPathId"] as const)(
    "rejects a fully re-committed %s substitution",
    (field) => {
      const original = producer();
      const canonicalEvent = event(original);
      const substituted = rebind(original, {
        ...original.registeredRecordPreimage,
        [field]: hex(`substituted:${field}`),
      });
      const attack = { ...canonicalEvent, producerRecord: substituted };
      expect(() =>
        projectCustomRegistryGen2RecordV4({
          manifest: manifest(),
          event: attack,
          head: head(attack, 1n),
        })
      ).toThrow();
    },
  );

  it("rejects a fully re-committed v1 fee-domain substitution", () => {
    const original = producer();
    const feeV1 = {
      ...original.onchainFeePolicy,
      partnerId: original.onchainFeePolicy.providerId,
    } as unknown as CustomLaunchOnchainFeePolicyV1;
    delete (feeV1 as unknown as Record<string, unknown>).providerId;
    delete (feeV1 as unknown as Record<string, unknown>).modelId;
    delete (feeV1 as unknown as Record<string, unknown>).modelVersion;
    delete (feeV1 as unknown as Record<string, unknown>).marketPathId;
    const substituted = rebind(original, {
      ...original.registeredRecordPreimage,
      feePolicyHash: customRegistryOnchainFeePolicyHashV1(feeV1),
    });
    const attack = event(substituted);
    expect(() =>
      projectCustomRegistryGen2RecordV4({
        manifest: manifest(),
        event: attack,
        head: head(attack, 1n),
      })
    ).toThrow();
  });

  it("keeps the v3 projector fail-closed for generation 2", () => {
    const v3 = v3GoldenJson as unknown as CustomLaunchRegistryProducerRecordV3;
    const deploymentManifest = parseCustomRegistryDeploymentManifestV3({
      schemaVersion: CUSTOM_REGISTRY_DEPLOYMENTS_SCHEMA_V3,
      platformId: "programmable",
      category: "custom",
      publicLabel: PROGRAMMABLE_CUSTOM_LABEL,
      chains: [{
        chainId: "1",
        caip2: "eip155:1",
        status: "active",
        publicSubmissionsEnabled: false,
        confirmationDepth: "2",
        finalityDepth: "64",
        registries: [{
          registryGeneration: "2",
          address: v3.registryOrigin.registryAddress,
          runtimeCodeHash: REGISTRY_RUNTIME,
          startBlock: v3.registryOrigin.registryStartBlock,
          status: "active",
          retiredAtBlock: null,
          authorizedApprovers: [APPROVER],
          authorizedWriters: [WRITER],
          topics: {
            approvalAuthorized: CUSTOM_REGISTRY_GEN2_TOPICS.approvalAuthorized,
            registered: CUSTOM_REGISTRY_GEN2_TOPICS.registered,
            provenance: CUSTOM_REGISTRY_GEN2_TOPICS.provenance,
            review: CUSTOM_REGISTRY_GEN2_TOPICS.review,
            attribution: CUSTOM_REGISTRY_GEN2_TOPICS.attribution,
            feePolicy: CUSTOM_REGISTRY_GEN2_TOPICS.feePolicy,
            feeEvidence: CUSTOM_REGISTRY_GEN2_TOPICS.feeEvidence,
            finalized: CUSTOM_REGISTRY_GEN2_TOPICS.finalized,
            corrected: CUSTOM_REGISTRY_GEN2_TOPICS.corrected,
            revoked: CUSTOM_REGISTRY_GEN2_TOPICS.revoked,
          },
        }],
      }],
    });
    const finalization = {
      operation: "finalized",
      chainId: "1",
      caip2: "eip155:1",
      registryGeneration: "2",
      registryAddress: v3.registryOrigin.registryAddress,
      observedRegistryRuntimeCodeHash: REGISTRY_RUNTIME,
      registryWriter: WRITER,
      topic0: CUSTOM_REGISTRY_GEN2_TOPICS.finalized,
      registrationCompanions: [],
      transactionHash: hex("v3-as-gen2-finalized"),
      blockNumber: "21000064",
      blockHash: hex("v3-as-gen2-finalized-block"),
      transactionIndex: 0,
      logIndex: 0,
      onchainTimestamp: "2026-08-07T08:00:00.000Z",
      launchId: v3.launchId,
      projectId: v3.projectId,
      registryLaunchIdRaw: v3.registryOrigin.registryLaunchIdRaw,
      registryProjectIdRaw: v3.registeredRecordPreimage.projectId,
      registeredRecordHash: v3.registeredRecordCommitment,
      latestOnchainRecordHash: v3.registeredRecordCommitment,
      previousOnchainRecordHash: null,
      registrationSequence: null,
      transitionSequence: "2",
      recordRevision: null,
      primaryContract: null,
      launchWallet: null,
      approvalId: null,
      deploymentId: null,
      identityHash: null,
      observedAtBlock: "21000000",
      observedTransactionHash: v3.registryOrigin.registrationTransactionHash,
      finalityEvidenceHash: hex("v3-as-gen2-finality-evidence"),
      confirmedHeadBlockNumber: "21000063",
      confirmedHeadBlockHash: hex("v3-as-gen2-confirmed-head"),
      finalityPolicyHash: v3.registeredRecordPreimage.finalityPolicyHash,
      finalizedAtBlock: "21000063",
      finalizedAtTimestamp: "1786099200",
      reasonCode: null,
      evidenceHash: null,
      approvalAuthorization: null,
      producerRecord: v3,
      record: null,
      revocationEvidenceHash: null,
    } satisfies CustomRegistryEventV3;
    expect(() =>
      new CustomRegistryProjectorV3(deploymentManifest).ingest(finalization, {
        chainId: "1",
        blockNumber: finalization.blockNumber,
        blockHash: finalization.blockHash,
        observedAt: finalization.onchainTimestamp,
        canonicalBlockHash: (blockNumber) =>
          blockNumber === finalization.blockNumber
            ? finalization.blockHash
            : blockNumber === "21000000"
              ? v3.registryOrigin.registrationBlockHash
              : hex(`v3-as-gen2-canonical:${blockNumber}`),
      })
    ).toThrow();
  });
});
