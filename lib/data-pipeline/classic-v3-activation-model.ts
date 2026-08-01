import "server-only";

import { keccak256, toBytes } from "viem";

import {
  canonicalizeFingerprintJson,
  type CanonicalJsonValue,
} from "./canonical-fingerprint";
import type { HexAddress, HexBytes32 } from "./codecs";
import {
  readDualRpcInitialRewardConfiguration,
  readDualRpcRewardSnapshot,
  verifyDynamicRuntimeAtActivationWithDualRpc,
  type CandidateRpcProvider,
  type DualRpcCandidateWindowEvidence,
  type DualRpcDynamicRuntimeActivationObservation,
  type DualRpcInitialRewardConfigurationEvidence,
  type DualRpcRewardSnapshot,
  type ProjectorDynamicSourceTemplate,
} from "./dual-rpc";
import type { EnvioCandidate } from "./envio";
import { dataPipelineError, invalidInput, validationError } from "./errors";
import type { CanonicalDynamicSourceDeploymentEvidence } from "./projector-dynamic-activation";
import { projectorOccurrenceUuid } from "./projector-ids";
import {
  foldProjectorRewardState,
  type ProjectorRewardBaseline,
  type ProjectorRewardEvent,
  type ProjectorRewardSnapshot,
} from "./projector-reward-fold";
import { expectedRewardRpcCallCount } from "./projector-reward-rpc-contract";

const EVIDENCE_DOMAIN =
  "programmable:classic-v3-activation-model-evidence:v1\0";

export type ClassicV3ActivationModelEvidence = Readonly<{
  activationId: string;
  evidenceKind:
    | "classic-v3-runtime-activation-v1"
    | "classic-v3-initial-reward-configuration-v1"
    | "classic-v3-launch-reward-conservation-v1";
  payload: CanonicalJsonValue;
  evidenceCommitment: HexBytes32;
}>;

export type ClassicV3ActivationModelVerification = Readonly<{
  runtimeObservation: DualRpcDynamicRuntimeActivationObservation;
  initialConfiguration: DualRpcInitialRewardConfigurationEvidence;
  baseline: ProjectorRewardBaseline;
  projectedSnapshot: ProjectorRewardSnapshot;
  rewardEvidence: DualRpcRewardSnapshot;
  modelVerificationEvidence: readonly [
    ClassicV3ActivationModelEvidence,
    ClassicV3ActivationModelEvidence,
    ClassicV3ActivationModelEvidence,
  ];
}>;

function canonicalJsonValue(value: unknown): CanonicalJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw validationError("rpc", "activation-model-evidence-json");
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw validationError("rpc", "activation-model-evidence-json");
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      canonicalJsonValue(entry),
    ]),
  );
}

function evidenceCommitment(
  evidenceKind: ClassicV3ActivationModelEvidence["evidenceKind"],
  activationId: string,
  payload: CanonicalJsonValue,
): HexBytes32 {
  return keccak256(
    toBytes(
      `${EVIDENCE_DOMAIN}${canonicalizeFingerprintJson({
        activationId,
        evidenceKind,
        payload,
      })}`,
    ),
  );
}

function modelEvidence(
  activationId: string,
  evidenceKind: ClassicV3ActivationModelEvidence["evidenceKind"],
  value: unknown,
): ClassicV3ActivationModelEvidence {
  const payload = canonicalJsonValue(value);
  return Object.freeze({
    activationId,
    evidenceKind,
    payload,
    evidenceCommitment: evidenceCommitment(
      evidenceKind,
      activationId,
      payload,
    ),
  });
}

function deterministicRewardEvidence(
  evidence: DualRpcRewardSnapshot,
): Readonly<Record<string, unknown>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(evidence).filter(([key]) => key !== "executionTrace"),
    ),
  );
}

function deterministicRuntimeEvidence(
  evidence: DualRpcDynamicRuntimeActivationObservation,
): Readonly<Record<string, unknown>> {
  const nondeterministicKeys = new Set([
    "startedAtMs",
    "completedAtMs",
    "elapsedMs",
    "hardDeadlineMs",
  ]);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(evidence).filter(
        ([key]) => !nondeterministicKeys.has(key),
      ),
    ),
  );
}

function deterministicInitialConfigurationEvidence(
  evidence: DualRpcInitialRewardConfigurationEvidence,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    ...evidence,
    endConfigurationSnapshot: deterministicRewardEvidence(
      evidence.endConfigurationSnapshot,
    ),
  });
}

function exactProviderTuple(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function rewardEventKind(
  eventName: string,
): ProjectorRewardEvent["kind"] {
  switch (eventName) {
    case "CreatorFeesCheckpointed":
      return "creator-fee-checkpoint";
    case "BeneficiaryFeesClaimed":
      return "beneficiary-claim";
    case "PayoutWalletChanged":
      return "payout-change";
    case "CtoRewardConfigurationActivated":
      return "reward-configuration-activation";
    default:
      throw validationError("rpc", "activation-reward-event-kind");
  }
}

function rewardEventValues(
  candidate: EnvioCandidate,
): Readonly<Record<string, string | readonly string[]>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(candidate.decodedPayload).map(([key, value]) => {
        if (
          typeof value === "string" ||
          (Array.isArray(value) &&
            value.every((entry) => typeof entry === "string"))
        ) {
          return [key, value] as const;
        }
        throw validationError("rpc", "activation-reward-event-values");
      }),
    ),
  );
}

function rewardEvents(input: {
  candidates: readonly EnvioCandidate[];
  evidence: DualRpcCandidateWindowEvidence;
  vault: HexAddress;
}): readonly ProjectorRewardEvent[] {
  const evidenceByCandidate = new Map(
    input.evidence.candidates.map((candidate) => [
      candidate.candidateId,
      candidate,
    ]),
  );
  return Object.freeze(
    [...input.candidates]
      .sort((left, right) => {
        if (left.transactionIndex !== right.transactionIndex) {
          return left.transactionIndex - right.transactionIndex;
        }
        return left.blockGlobalLogIndex - right.blockGlobalLogIndex;
      })
      .map((candidate) => {
        const evidence = evidenceByCandidate.get(candidate.candidateId);
        if (
          !evidence ||
          evidence.sourceAddress !== input.vault ||
          evidence.transactionHash !== candidate.transactionHash ||
          evidence.transactionIndex !== candidate.transactionIndex
        ) {
          throw validationError("rpc", "activation-reward-event-evidence");
        }
        return Object.freeze({
          occurrenceId: projectorOccurrenceUuid({
            transactionHash: candidate.transactionHash,
            receiptLogOrdinal: String(evidence.receiptLogOrdinal),
            blockHash: candidate.blockHash,
          }),
          vault: input.vault,
          blockNumber: candidate.blockNumber,
          transactionIndex: String(candidate.transactionIndex),
          blockGlobalLogIndex: String(candidate.blockGlobalLogIndex),
          kind: rewardEventKind(candidate.eventName),
          values: rewardEventValues(candidate),
        });
      }),
  );
}

/**
 * Produces all three model-specific evidences required before a staged Classic
 * activation can be committed: exact runtime/immutables, epoch-one reward
 * configuration, and independently folded full-account reward conservation at
 * the exact canonical launch block. The three results share one deadline and
 * one aggregate physical-call budget per provider.
 */
export async function verifyClassicV3ActivationModel(input: Readonly<{
  activationId: string;
  parentCandidate: EnvioCandidate;
  launchCandidate: EnvioCandidate;
  sameBlockVaultEvents: readonly EnvioCandidate[];
  candidateEvidence: DualRpcCandidateWindowEvidence;
  sourceAddress: HexAddress;
  template: ProjectorDynamicSourceTemplate;
  canonicalDeployment: CanonicalDynamicSourceDeploymentEvidence;
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  deadlineMs?: number;
}>): Promise<ClassicV3ActivationModelVerification> {
  const hardDeadlineMs = input.deadlineMs ?? 75_000;
  if (
    !Number.isSafeInteger(hardDeadlineMs) ||
    hardDeadlineMs < 10 ||
    hardDeadlineMs > 75_000
  ) {
    throw invalidInput("rpc", "activation-model-deadline");
  }
  const deadlineAt = Date.now() + hardDeadlineMs;
  const remaining = () => {
    const value = deadlineAt - Date.now();
    if (value < 10) {
      throw dataPipelineError({
        dependency: "rpc",
        code: "timeout",
        retryable: true,
        countsTowardCircuit: true,
      });
    }
    return value;
  };
  if (
    input.candidateEvidence.coveredCandidateCount !==
      input.candidateEvidence.candidates.length ||
    input.candidateEvidence.coverage.throughBlockNumber !==
      input.launchCandidate.blockNumber ||
    input.candidateEvidence.coverage.throughBlockHash !==
      input.launchCandidate.blockHash ||
    input.candidateEvidence.coverage.throughBlockGlobalLogIndex !==
      "4294967295"
  ) {
    throw validationError("rpc", "activation-model-block-coverage");
  }
  const runtimeObservation =
    await verifyDynamicRuntimeAtActivationWithDualRpc({
      parentCandidate: input.parentCandidate,
      launchCandidate: input.launchCandidate,
      sourceAddress: input.sourceAddress,
      template: input.template,
      canonicalDeployment: input.canonicalDeployment,
      activationEvidence: input.candidateEvidence,
      providers: input.providers,
      deadlineMs: remaining(),
    });
  const initialConfiguration = await readDualRpcInitialRewardConfiguration({
    parentCandidate: input.parentCandidate,
    launchCandidate: input.launchCandidate,
    sameBlockVaultEvents: input.sameBlockVaultEvents,
    candidateEvidence: input.candidateEvidence,
    canonicalDeployment: input.canonicalDeployment,
    template: input.template,
    providers: input.providers,
    rpcPolicy: {
      hardDeadlineMs: remaining(),
      maxAttempts: 1,
      maxCallsPerProvider: 128,
    },
  });
  const baseline: ProjectorRewardBaseline = Object.freeze({
    vault: initialConfiguration.vault,
    poolId: initialConfiguration.poolId,
    configurationEpoch: "1",
    activeConfigurationHash:
      initialConfiguration.initialActiveConfigurationHash,
    allocations: Object.freeze(
      initialConfiguration.allocations.map(
        ({ allocationIndex, beneficiary, shareBps }) =>
        Object.freeze({
          allocationIndex,
          beneficiary,
          payoutAddress: beneficiary,
          shareBps,
        }),
      ),
    ),
    balances: Object.freeze(
      initialConfiguration.allocations.map(({ beneficiary }) =>
        Object.freeze({
          account: beneficiary,
          payoutAddress: beneficiary,
          claimableAccrued: "0",
          claimedTotal: "0",
        }),
      ),
    ),
  });
  const events = rewardEvents({
    candidates: input.sameBlockVaultEvents,
    evidence: input.candidateEvidence,
    vault: initialConfiguration.vault,
  });
  const launchEvidence = input.candidateEvidence.candidates.find(
    ({ candidateId }) => candidateId === input.launchCandidate.candidateId,
  );
  if (!launchEvidence) {
    throw validationError("rpc", "activation-launch-evidence");
  }
  const projectedSnapshot = events.length > 0
    ? foldProjectorRewardState({
        model: "classic-v3",
        baseline,
        events,
      })
    : Object.freeze({
        ...baseline,
        totalCreatorFeesReceived: "0",
        snapshotSourceOccurrenceId: projectorOccurrenceUuid({
          transactionHash: input.launchCandidate.transactionHash,
          receiptLogOrdinal: String(launchEvidence.receiptLogOrdinal),
          blockHash: input.launchCandidate.blockHash,
        }),
      });
  const fullSnapshotCallCount = expectedRewardRpcCallCount(
    "classic-v3",
    projectedSnapshot.allocations.length,
    projectedSnapshot.balances.length,
  );
  const configurationCallCount =
    initialConfiguration.endConfigurationSnapshot.providerCallCounts[0] +
    initialConfiguration.factoryProviderCallCounts[0];
  const aggregateCallsPerProvider =
    runtimeObservation.providerCallCounts[0] +
    configurationCallCount +
    fullSnapshotCallCount;
  if (
    projectedSnapshot.balances.length > 48 ||
    aggregateCallsPerProvider > 128
  ) {
    throw validationError("rpc", "activation-model-call-budget");
  }
  const rewardEvidence = await readDualRpcRewardSnapshot({
    model: "classic-v3",
    baseline,
    expected: projectedSnapshot,
    blockNumber: initialConfiguration.activationBlockNumber,
    blockHash: initialConfiguration.activationBlockHash,
    providers: input.providers,
    rpcPolicy: {
      hardDeadlineMs: remaining(),
      maxAttempts: 1,
      maxCallsPerProvider: fullSnapshotCallCount,
    },
  });
  const configuration = initialConfiguration.endConfigurationSnapshot;
  if (
    rewardEvidence.chunks.length !== 1 ||
    rewardEvidence.providerCallCounts[0] !== fullSnapshotCallCount ||
    rewardEvidence.providerCallCounts[1] !== fullSnapshotCallCount ||
    rewardEvidence.vault !== configuration.vault ||
    rewardEvidence.poolId !== configuration.poolId ||
    rewardEvidence.blockNumber !== configuration.blockNumber ||
    rewardEvidence.blockHash !== configuration.blockHash ||
    rewardEvidence.configurationEpoch !== configuration.configurationEpoch ||
    rewardEvidence.configurationHash !== configuration.configurationHash ||
    rewardEvidence.totalCreatorFeesReceived !==
      configuration.totalCreatorFeesReceived ||
    rewardEvidence.totalCreatorFeesClaimed !==
      configuration.totalCreatorFeesClaimed ||
    JSON.stringify(rewardEvidence.allocations) !==
      JSON.stringify(configuration.allocations) ||
    !exactProviderTuple(
      rewardEvidence.providerIdentities,
      input.candidateEvidence.providerIdentities,
    ) ||
    !exactProviderTuple(
      rewardEvidence.providerVendorGroups,
      input.candidateEvidence.providerVendorGroups,
    ) ||
    !exactProviderTuple(
      rewardEvidence.providerEndpointCommitments,
      input.candidateEvidence.providerEndpointCommitments,
    ) ||
    !exactProviderTuple(
      rewardEvidence.providerOriginCommitments,
      input.candidateEvidence.providerOriginCommitments,
    )
  ) {
    throw validationError("rpc", "activation-reward-evidence-binding");
  }
  return Object.freeze({
    runtimeObservation,
    initialConfiguration,
    baseline,
    projectedSnapshot,
    rewardEvidence,
    modelVerificationEvidence: Object.freeze([
      modelEvidence(
        input.activationId,
        "classic-v3-runtime-activation-v1",
        Object.freeze({
          canonicalDeployment: input.canonicalDeployment,
          runtimeObservation:
            deterministicRuntimeEvidence(runtimeObservation),
        }),
      ),
      modelEvidence(
        input.activationId,
        "classic-v3-initial-reward-configuration-v1",
        deterministicInitialConfigurationEvidence(initialConfiguration),
      ),
      modelEvidence(
        input.activationId,
        "classic-v3-launch-reward-conservation-v1",
        Object.freeze({
          projectedSnapshot,
          rewardEvidence: deterministicRewardEvidence(rewardEvidence),
        }),
      ),
    ]) as readonly [
      ClassicV3ActivationModelEvidence,
      ClassicV3ActivationModelEvidence,
      ClassicV3ActivationModelEvidence,
    ],
  });
}
