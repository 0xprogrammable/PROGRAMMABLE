import "server-only";

import {
  readDualRpcRewardSnapshot,
  readDualRpcTokenMetadata,
  verifyEnvioCandidateBatchWithDualRpc,
  type CandidateRpcProvider,
  type DualRpcCandidateBatchEvidence,
  type DualRpcRewardSnapshot,
} from "./dual-rpc";
import type { EnvioCandidate } from "./envio";
import { dataPipelineError, invalidInput, validationError } from "./errors";
import {
  foldProjectorEvents,
  type ProjectorFoldResult,
  type ProjectorKnownPool,
} from "./projector-fold";
import type { VerifiedDynamicSourceLineage } from "./projector-identities";
import { projectorOccurrenceUuid } from "./projector-ids";
import {
  foldProjectorRewardState,
  type ProjectorRewardBaseline,
  type ProjectorRewardEvent,
  type ProjectorRewardModel,
  type ProjectorRewardSnapshot,
} from "./projector-reward-fold";
import type { ProjectorReleaseDatabaseScope } from "./postgres-projector";
import {
  PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP,
  PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE,
} from "./projector-runtime-limits";

const MAXIMUM_PROJECTION_DEADLINE_MS = 75_000;
// A 32-row page can contain 32 distinct blocks, transactions and sources.
// The verifier rejects a page before making RPC calls unless the configured
// budget covers that worst-case shape.
const PROJECTOR_PROVIDER_CALL_BUDGET = 128;
const LAUNCH_EVENTS = new Set([
  "MemeTokenLaunched",
  "MemeTokenLaunchedV2",
  "StockPairedTokenLaunched",
]);

export type ProjectionCandidateAction = "project" | "ignore";

export type StoredProjectionCandidate = Readonly<
  Pick<
    EnvioCandidate,
    | "candidateId"
    | "chainId"
    | "blockNumber"
    | "blockHash"
    | "transactionHash"
    | "transactionIndex"
    | "blockGlobalLogIndex"
    | "sourceAddress"
    | "contractName"
    | "eventName"
    | "orderedTopics"
    | "rawData"
    | "decodedPayload"
    | "payloadHash"
  >
>;

export type ReleaseProjectionCandidate = Readonly<{
  candidate: StoredProjectionCandidate;
  action: ProjectionCandidateAction;
  attemptCount: string;
}>;

export type ReleaseProjectionPlan = Readonly<{
  scope: ProjectorReleaseDatabaseScope;
  entries: readonly ReleaseProjectionCandidate[];
  dynamicSources: readonly VerifiedDynamicSourceLineage[];
  knownPools: readonly ProjectorKnownPool[];
  lease: Readonly<{
    generation: string;
    expiresAt: string;
  }>;
  checkpoint: null | Readonly<{
    generation: string;
    reorgGeneration: string;
    blockNumber: string;
    blockHash: `0x${string}`;
    blockGlobalLogIndex: number;
    candidateId: string;
  }>;
  rewardVerification: null | Readonly<{
    model: ProjectorRewardModel;
    baseline: ProjectorRewardBaseline;
  }>;
  rewardVerifications?: readonly Readonly<{
    model: ProjectorRewardModel;
    baseline: ProjectorRewardBaseline;
  }>[];
  batchKind?: "normal" | "oversized-transaction" | "reward-block";
}>;

export type VerifiedReleaseProjection = Readonly<{
  plan: ReleaseProjectionPlan;
  freshCandidates: readonly EnvioCandidate[];
  ignoredCandidateIds: readonly string[];
  evidence: DualRpcCandidateBatchEvidence;
  fold: ProjectorFoldResult;
  rewardSnapshot: ProjectorRewardSnapshot | null;
  rewardSnapshots?: readonly ProjectorRewardSnapshot[];
  rewardEvidence?: readonly DualRpcRewardSnapshot[];
}>;

export type ReleaseProjectionStore = Readonly<{
  /**
   * Owns and closes the first short database transaction. The returned plan
   * includes an acquired lease, exact release manifest classification and a
   * transaction-aligned page.
   */
  readProjectionPlan(): Promise<ReleaseProjectionPlan | null>;
  /**
   * Owns and closes the final short database transaction. Implementations
   * must re-check epoch, pointer, lease and checkpoint CAS before promotion.
   */
  commitVerifiedProjection(
    projection: VerifiedReleaseProjection,
  ): Promise<Readonly<{ checkpointGeneration: string }>>;
}>;

type ProjectionEnvio = Readonly<{
  readCandidate(candidateId: string): Promise<EnvioCandidate | null>;
}>;

function projectionTimeout() {
  return dataPipelineError({
    dependency: "rpc",
    code: "timeout",
    retryable: true,
    countsTowardCircuit: true,
  });
}

async function withDeadline<T>(
  deadlineMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(projectionTimeout()), deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    if (!Number.isSafeInteger(value)) {
      throw validationError("envio", "projection-candidate-json");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (
    typeof value !== "object" ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw validationError("envio", "projection-candidate-json");
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function exactCandidateMatch(
  expected: StoredProjectionCandidate,
  fresh: EnvioCandidate | null,
): EnvioCandidate {
  if (
    fresh === null ||
    fresh.candidateId !== expected.candidateId ||
    fresh.chainId !== expected.chainId ||
    fresh.blockNumber !== expected.blockNumber ||
    fresh.blockHash !== expected.blockHash ||
    fresh.transactionHash !== expected.transactionHash ||
    fresh.transactionIndex !== expected.transactionIndex ||
    fresh.blockGlobalLogIndex !== expected.blockGlobalLogIndex ||
    fresh.sourceAddress !== expected.sourceAddress ||
    fresh.contractName !== expected.contractName ||
    fresh.eventName !== expected.eventName ||
    fresh.rawData !== expected.rawData ||
    fresh.payloadHash !== expected.payloadHash ||
    fresh.orderedTopics.length !== expected.orderedTopics.length ||
    fresh.orderedTopics.some(
      (topic, index) => topic !== expected.orderedTopics[index],
    ) ||
    canonicalJson(fresh.decodedPayload) !==
      canonicalJson(expected.decodedPayload)
  ) {
    throw validationError("envio", "projection-candidate-drift");
  }
  return fresh;
}

function assertPlan(plan: ReleaseProjectionPlan): void {
  const batchKind = plan.batchKind ?? "normal";
  const maximum = batchKind === "normal"
    ? PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE
    : PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP;
  if (
    !Array.isArray(plan.entries) ||
    plan.entries.length < 1 ||
    plan.entries.length > maximum ||
    !Array.isArray(plan.dynamicSources) ||
    !Array.isArray(plan.knownPools) ||
    !["normal", "oversized-transaction", "reward-block"].includes(batchKind)
  ) {
    throw invalidInput("postgres", "projection-plan");
  }
  if (
    batchKind === "oversized-transaction" &&
    new Set(plan.entries.map(({ candidate }) => candidate.transactionHash))
        .size !== 1
  ) {
    throw invalidInput("postgres", "projection-atomic-transaction");
  }
  if (
    batchKind === "reward-block" &&
    new Set(plan.entries.map(({ candidate }) => candidate.blockHash)).size !== 1
  ) {
    throw invalidInput("postgres", "projection-reward-block");
  }
  const ids = new Set<string>();
  let previous:
    | readonly [bigint, number, string]
    | undefined;
  for (const entry of plan.entries) {
    if (
      (entry.action !== "project" && entry.action !== "ignore") ||
      !/^(?:0|[1-9]\d*)$/u.test(entry.attemptCount) ||
      ids.has(entry.candidate.candidateId)
    ) {
      throw invalidInput("postgres", "projection-plan-entry");
    }
    ids.add(entry.candidate.candidateId);
    const key = [
      BigInt(entry.candidate.blockNumber),
      entry.candidate.blockGlobalLogIndex,
      entry.candidate.candidateId,
    ] as const;
    if (
      previous &&
      (key[0] < previous[0] ||
        (key[0] === previous[0] &&
          (key[1] < previous[1] ||
            (key[1] === previous[1] && key[2] <= previous[2]))))
    ) {
      throw invalidInput("postgres", "projection-plan-order");
    }
    previous = key;
  }
  // The database page must never split a transaction. Otherwise a launch can
  // be promoted without the sibling events that make it complete.
  for (let index = 1; index < plan.entries.length; index += 1) {
    const previousEntry = plan.entries[index - 1]!;
    const current = plan.entries[index]!;
    if (
      current.candidate.transactionHash ===
        previousEntry.candidate.transactionHash &&
      current.action !== previousEntry.action
    ) {
      throw invalidInput("postgres", "projection-transaction-classification");
    }
  }
}

function planRewardVerifications(
  plan: ReleaseProjectionPlan,
): readonly Readonly<{
  model: ProjectorRewardModel;
  baseline: ProjectorRewardBaseline;
}>[] {
  const plural = plan.rewardVerifications;
  if (plural !== undefined) {
    if (!Array.isArray(plural) || plan.rewardVerification !== null) {
      throw invalidInput("postgres", "reward-verification-plan");
    }
    const vaults = plural.map(({ baseline }) => baseline.vault);
    if (new Set(vaults).size !== vaults.length) {
      throw invalidInput("postgres", "reward-verification-plan");
    }
    return Object.freeze([...plural].sort((left, right) =>
      left.baseline.vault.localeCompare(right.baseline.vault)
    ));
  }
  return plan.rewardVerification === null
    ? Object.freeze([])
    : Object.freeze([plan.rewardVerification]);
}

function launchMetadataRequests(candidates: readonly EnvioCandidate[]) {
  const requests = new Map<
    string,
    Readonly<{
      token: `0x${string}`;
      blockNumber: string;
      blockHash: `0x${string}`;
    }>
  >();
  for (const candidate of candidates) {
    if (!LAUNCH_EVENTS.has(candidate.eventName)) continue;
    const token = candidate.decodedPayload.token;
    if (
      typeof token !== "string" ||
      !/^0x[0-9a-f]{40}$/u.test(token) ||
      requests.has(token)
    ) {
      throw validationError("envio", "projection-launch-token");
    }
    requests.set(
      token,
      Object.freeze({
        token: token as `0x${string}`,
        blockNumber: candidate.blockNumber,
        blockHash: candidate.blockHash,
      }),
    );
  }
  return Object.freeze([...requests.values()]);
}

const REWARD_FACT_KINDS = new Set([
  "creator-fee-checkpoint",
  "beneficiary-claim",
  "payout-change",
  "reward-configuration-activation",
]);

function projectedRewardEvents(
  fold: ProjectorFoldResult,
): readonly ProjectorRewardEvent[] {
  if (fold.facts.length !== fold.occurrences.length) {
    throw validationError("rpc", "reward-fold-pairs");
  }
  return Object.freeze(
    fold.facts.flatMap((fact, index) => {
      if (!REWARD_FACT_KINDS.has(fact.kind)) return [];
      const occurrence = fold.occurrences[index];
      if (!occurrence || fact.sourceCandidateId !== occurrence.candidateId) {
        throw validationError("rpc", "reward-fold-pairs");
      }
      const values = Object.freeze(
        Object.fromEntries(
          Object.entries(fact.values).map(([key, value]) => {
            if (
              typeof value === "string" ||
              (Array.isArray(value) &&
                value.every((entry) => typeof entry === "string"))
            ) {
              return [key, value] as const;
            }
            throw validationError("rpc", "reward-fold-values");
          }),
        ),
      );
      return [Object.freeze({
        occurrenceId: projectorOccurrenceUuid({
          transactionHash: occurrence.transactionHash,
          receiptLogOrdinal: occurrence.receiptLogOrdinal,
          blockHash: occurrence.blockHash,
        }),
        vault: occurrence.sourceAddress,
        blockNumber: occurrence.blockNumber,
        transactionIndex: occurrence.transactionIndex,
        blockGlobalLogIndex: occurrence.blockGlobalLogIndex,
        kind: fact.kind as ProjectorRewardEvent["kind"],
        values,
      })];
    }),
  );
}

/**
 * Executes one release-scoped projection cycle. Every Envio/RPC request is
 * made after `readProjectionPlan` has closed its transaction and before
 * `commitVerifiedProjection` opens the final transaction.
 */
export async function runReleaseProjectionCycle(input: {
  store: ReleaseProjectionStore;
  envio: ProjectionEnvio;
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  deadlineMs?: number;
  verifyBatch?: typeof verifyEnvioCandidateBatchWithDualRpc;
  readMetadata?: typeof readDualRpcTokenMetadata;
  readRewardSnapshot?: typeof readDualRpcRewardSnapshot;
}) {
  const deadlineMs = input.deadlineMs ?? MAXIMUM_PROJECTION_DEADLINE_MS;
  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 10 ||
    deadlineMs > MAXIMUM_PROJECTION_DEADLINE_MS
  ) {
    throw invalidInput("config", "projection-deadline");
  }
  const startedAt = Date.now();
  const verifyBatch =
    input.verifyBatch ?? verifyEnvioCandidateBatchWithDualRpc;
  const readMetadata = input.readMetadata ?? readDualRpcTokenMetadata;
  const readRewardSnapshot =
    input.readRewardSnapshot ?? readDualRpcRewardSnapshot;
  const remaining = () => {
    const value = deadlineMs - (Date.now() - startedAt);
    if (value < 10) throw projectionTimeout();
    return value;
  };
  return withDeadline(deadlineMs, async () => {
    const plan = await input.store.readProjectionPlan();
    if (plan === null) {
      return Object.freeze({ status: "idle" as const });
    }
    assertPlan(plan);
    const freshCandidates = Object.freeze(
      await Promise.all(
        plan.entries.map(async ({ candidate }) =>
          exactCandidateMatch(
            candidate,
            await input.envio.readCandidate(candidate.candidateId),
          ),
        ),
      ),
    );
    const projectedCandidates = freshCandidates.filter(
      (_candidate, index) => plan.entries[index]!.action === "project",
    );
    const evidence = await verifyBatch({
      candidates: freshCandidates,
      providers: input.providers,
      dynamicSources: plan.dynamicSources,
      // Irrelevant candidates may be dynamic sources from another release.
      // They still receive fresh dual-RPC placement evidence, while the fold
      // below separately requires exact attested lineage for projected rows.
      requireDynamicLineage: false,
      rpcPolicy: {
        hardDeadlineMs: remaining(),
        maxCallsPerProvider: PROJECTOR_PROVIDER_CALL_BUDGET,
      },
      maximumCandidateCount:
        (plan.batchKind ?? "normal") === "normal"
          ? PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE
          : PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP,
    });
    const metadata = await readMetadata({
      tokens: launchMetadataRequests(projectedCandidates),
      providers: input.providers,
      rpcPolicy: {
        hardDeadlineMs: remaining(),
        maxCallsPerProvider: PROJECTOR_PROVIDER_CALL_BUDGET,
      },
    });
    const tokenMetadata = Object.fromEntries(
      metadata.map(({ token, name, symbol }) => [token, { name, symbol }]),
    );
    const evidenceByCandidate = new Map(
      evidence.candidates.map((candidate) => [candidate.candidateId, candidate]),
    );
    const fold = foldProjectorEvents({
      events: projectedCandidates.map((candidate) => {
        const candidateEvidence = evidenceByCandidate.get(candidate.candidateId);
        if (!candidateEvidence) {
          throw validationError("rpc", "projection-evidence-coverage");
        }
        return {
          candidate,
          evidence: candidateEvidence,
          releaseContext: {
            model:
              plan.scope.releaseId.startsWith("classic-")
                ? "classic"
                : "stock-paired",
            releaseVersion: plan.scope.releaseId,
          },
        };
      }),
      tokenMetadata,
      knownPools: plan.knownPools,
    });
    const rewardEvents = projectedRewardEvents(fold);
    const verifications = planRewardVerifications(plan);
    const rewardEventsByVault = new Map<string, ProjectorRewardEvent[]>();
    for (const event of rewardEvents) {
      const current = rewardEventsByVault.get(event.vault) ?? [];
      current.push(event);
      rewardEventsByVault.set(event.vault, current);
    }
    if (verifications.length !== rewardEventsByVault.size) {
      throw validationError("rpc", "reward-verification-missing");
    }
    const target = plan.entries.at(-1)?.candidate;
    if (!target) throw validationError("rpc", "reward-target-block");
    const rewardSnapshots: ProjectorRewardSnapshot[] = [];
    const rewardEvidence: DualRpcRewardSnapshot[] = [];
    for (const verification of verifications) {
      const vaultEvents = rewardEventsByVault.get(
        verification.baseline.vault,
      );
      if (!vaultEvents || vaultEvents.length < 1) {
        throw validationError("rpc", "reward-verification-empty");
      }
      const snapshot = foldProjectorRewardState({
        model: verification.model,
        baseline: verification.baseline,
        events: vaultEvents,
      });
      const verifiedSnapshot = await readRewardSnapshot({
        model: verification.model,
        baseline: verification.baseline,
        expected: snapshot,
        blockNumber: target.blockNumber,
        blockHash: target.blockHash,
        providers: input.providers,
        rpcPolicy: {
          hardDeadlineMs: remaining(),
          maxAttempts: 1,
          maxCallsPerProvider: PROJECTOR_PROVIDER_CALL_BUDGET,
        },
      });
      rewardSnapshots.push(snapshot);
      rewardEvidence.push(verifiedSnapshot);
    }
    const verified = Object.freeze({
      plan,
      freshCandidates,
      ignoredCandidateIds: Object.freeze(
        plan.entries
          .filter(({ action }) => action === "ignore")
          .map(({ candidate }) => candidate.candidateId),
      ),
      evidence,
      fold,
      rewardSnapshot: rewardSnapshots[0] ?? null,
      rewardSnapshots: Object.freeze(rewardSnapshots),
      rewardEvidence: Object.freeze(rewardEvidence),
    });
    const committed = await input.store.commitVerifiedProjection(verified);
    return Object.freeze({
      status: "committed" as const,
      releaseId: plan.scope.releaseId,
      projectedCandidateCount: projectedCandidates.length,
      ignoredCandidateCount: verified.ignoredCandidateIds.length,
      checkpointGeneration: committed.checkpointGeneration,
      batchKind: plan.batchKind ?? "normal",
    });
  });
}
