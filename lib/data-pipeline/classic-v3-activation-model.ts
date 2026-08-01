import "server-only";

import { keccak256, toBytes } from "viem";

import {
  canonicalizeFingerprintJson,
  type CanonicalJsonValue,
} from "./canonical-fingerprint";
import type { HexAddress, HexBytes32 } from "./codecs";
import {
  readDualRpcInitialRewardSeed,
  readDualRpcRewardSnapshot,
  type CandidateRpcProvider,
  type DualRpcCandidateBatchEvidence,
  type DualRpcInitialRewardSeed,
  type DualRpcRewardSnapshot,
} from "./dual-rpc";
import type { EnvioCandidate } from "./envio";
import { validationError } from "./errors";
import { projectorOccurrenceUuid } from "./projector-ids";
import {
  foldProjectorRewardState,
  type ProjectorRewardBaseline,
  type ProjectorRewardEvent,
  type ProjectorRewardSnapshot,
} from "./projector-reward-fold";

const EVIDENCE_DOMAIN =
  "programmable:classic-v3-activation-model-evidence:v1\0";

export type ClassicV3ActivationModelEvidence = Readonly<{
  activationId: string;
  evidenceKind:
    | "classic-v3-initial-reward-seed-v1"
    | "classic-v3-launch-reward-snapshot-v1";
  payload: CanonicalJsonValue;
  evidenceCommitment: HexBytes32;
}>;

export type ClassicV3ActivationModelVerification = Readonly<{
  seed: DualRpcInitialRewardSeed;
  baseline: ProjectorRewardBaseline;
  projectedSnapshot: ProjectorRewardSnapshot;
  rewardEvidence: DualRpcRewardSnapshot;
  modelVerificationEvidence: readonly [
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
  evidence: DualRpcCandidateBatchEvidence;
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
 * Produces the two model-specific evidences required before a staged Classic
 * activation can be committed. The first reconstructs epoch one. The second
 * independently folds every post-launch vault event and proves the complete
 * touched-account state at the exact canonical launch block.
 */
export async function verifyClassicV3ActivationModel(input: Readonly<{
  activationId: string;
  parentCandidate: EnvioCandidate;
  launchCandidate: EnvioCandidate;
  sameBlockVaultEvents: readonly EnvioCandidate[];
  candidateEvidence: DualRpcCandidateBatchEvidence;
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  deadlineMs?: number;
}>): Promise<ClassicV3ActivationModelVerification> {
  const seed = await readDualRpcInitialRewardSeed({
    parentCandidate: input.parentCandidate,
    launchCandidate: input.launchCandidate,
    sameBlockVaultEvents: input.sameBlockVaultEvents,
    candidateEvidence: input.candidateEvidence,
    providers: input.providers,
    rpcPolicy: {
      hardDeadlineMs: input.deadlineMs,
      maxAttempts: 1,
      maxCallsPerProvider: 128,
    },
  });
  const baseline: ProjectorRewardBaseline = Object.freeze({
    vault: seed.vault,
    poolId: seed.poolId,
    configurationEpoch: "1",
    activeConfigurationHash: seed.initialActiveConfigurationHash,
    allocations: Object.freeze(
      seed.allocations.map(({ allocationIndex, beneficiary, shareBps }) =>
        Object.freeze({
          allocationIndex,
          beneficiary,
          payoutAddress: beneficiary,
          shareBps,
        }),
      ),
    ),
    balances: Object.freeze(
      seed.allocations.map(({ beneficiary }) =>
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
    vault: seed.vault,
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
  const rewardEvidence = await readDualRpcRewardSnapshot({
    model: "classic-v3",
    baseline,
    expected: projectedSnapshot,
    blockNumber: seed.activationBlockNumber,
    blockHash: seed.activationBlockHash,
    providers: input.providers,
    rpcPolicy: {
      hardDeadlineMs: input.deadlineMs,
      maxAttempts: 1,
      maxCallsPerProvider: 128,
    },
  });
  const configuration = seed.endConfigurationSnapshot;
  if (
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
    seed,
    baseline,
    projectedSnapshot,
    rewardEvidence,
    modelVerificationEvidence: Object.freeze([
      modelEvidence(
        input.activationId,
        "classic-v3-initial-reward-seed-v1",
        seed,
      ),
      modelEvidence(
        input.activationId,
        "classic-v3-launch-reward-snapshot-v1",
        Object.freeze({
          projectedSnapshot,
          rewardEvidence,
        }),
      ),
    ]) as readonly [
      ClassicV3ActivationModelEvidence,
      ClassicV3ActivationModelEvidence,
    ],
  });
}
