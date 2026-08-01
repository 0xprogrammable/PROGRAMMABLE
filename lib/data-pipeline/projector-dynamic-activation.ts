import "server-only";

import type { CanonicalJsonValue } from "./canonical-fingerprint";
import type {
  DualRpcCandidateWindowEvidence,
  DualRpcDynamicRuntimeActivationObservation,
  ProjectorDynamicSourceTemplate,
} from "./dual-rpc";
import type { EnvioCandidate } from "./envio";
import type { HexAddress, HexBytes32 } from "./codecs";
import type { VerifiedDynamicSourceLineage } from "./projector-identities";

/**
 * Canonical database provenance for a factory deployment that may be consumed
 * by a later launch block. A raw Envio candidate is never sufficient: the
 * resolver must bind the historical parent to its canonical occurrence,
 * runtime evidence, template, provider tuple and current reorg generation.
 */
export type CanonicalDynamicSourceDeploymentEvidence = Readonly<{
  provisionalPageId: string;
  provisionalLineageId: string;
  dynamicSourceAttestationId: string;
  runtimeCodeEvidenceId: string;
  dynamicSourceTemplateId: string;
  parentOccurrenceId: string;
  parentCandidateId: string;
  parentBlockNumber: string;
  parentBlockHash: HexBytes32;
  parentBlockGlobalLogIndex: number;
  parentTransactionHash: HexBytes32;
  parentTransactionIndex: number;
  parentSourceAddress: HexAddress;
  parentContractName: string;
  parentEventName: string;
  parentPayloadHash: HexBytes32;
  parentRawLogCommitment: HexBytes32;
  canonicalStatusHistoryId: string;
  safeHeadObservationId: string;
  blockEvidenceId: string;
  reorgGeneration: string;
  envioProviderDeploymentId: string;
  rpcProviderDeploymentIds: readonly [string, string];
  providerIdentities: readonly [string, string];
  providerVendorGroups: readonly [string, string];
  providerEndpointCommitments: readonly [HexBytes32, HexBytes32];
  providerOriginCommitments: readonly [HexBytes32, HexBytes32];
}>;

/** A launch candidate paired with exactly one canonical historical parent. */
export type PendingDynamicSourceActivation = Readonly<{
  activationId: string;
  historicalParentCandidate: EnvioCandidate;
  launchCandidate: EnvioCandidate;
  sourceAddress: HexAddress;
  template: ProjectorDynamicSourceTemplate;
  canonicalDeployment: CanonicalDynamicSourceDeploymentEvidence;
  /**
   * Run-scoped lineage used to verify child logs. Its activation boundary is
   * the launch log, so the child is accepted only strictly after that log.
   */
  ephemeralLineage: VerifiedDynamicSourceLineage;
}>;

export type ProjectorDynamicSourceActivationModelEvidence = Readonly<{
  activationId: string;
  evidenceKind: string;
  payload: CanonicalJsonValue;
  evidenceCommitment: HexBytes32;
}>;

export type VerifiedDynamicSourceActivation = Readonly<{
  pending: PendingDynamicSourceActivation;
  runtimeObservation: DualRpcDynamicRuntimeActivationObservation;
  modelVerificationEvidence:
    readonly ProjectorDynamicSourceActivationModelEvidence[];
}>;

export type ResolvePendingDynamicSourceActivationsInput = Readonly<{
  candidates: readonly EnvioCandidate[];
  expectedCursorGeneration: string;
  expectedCursorBlockHash: HexBytes32;
  expectedReorgGeneration: string;
}>;

export type StageVerifiedDynamicSourceActivationsInput = Readonly<{
  candidates: readonly EnvioCandidate[];
  evidence: DualRpcCandidateWindowEvidence;
  activations: readonly VerifiedDynamicSourceActivation[];
  blockComplete: false;
}>;
