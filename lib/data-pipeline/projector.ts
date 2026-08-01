import "server-only";

import type {
  CandidateRpcProvider,
  DualRpcCandidateWindowEvidence,
  DualRpcDynamicRuntimeObservation,
  ProjectorDynamicSourceTemplate,
} from "./dual-rpc";
import {
  readDualRpcSafeHead,
  verifyDynamicRuntimeAtBlockWithDualRpc,
  verifyEnvioCandidateWindowWithDualRpc,
} from "./dual-rpc";
import type {
  EnvioCandidate,
  EnvioCandidateCursor,
} from "./envio";
import { dataPipelineError, invalidInput } from "./errors";
import type { VerifiedDynamicSourceLineage } from "./projector-identities";
import { PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE } from "./projector-runtime-limits";

/**
 * A short page is the only Envio response that can prove the frozen window is
 * exhausted. Page in bounded chunks while retaining the adapter's 32-row hard
 * ceiling for one atomic commit.
 */
const PROJECTOR_PAGE_LIMIT = 12;
const MAXIMUM_CANDIDATES_PER_COMMIT =
  PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE;
const MAXIMUM_PROVIDER_CALLS = 128;
const COVERAGE_BLOCK_SPAN = 500;
const MAXIMUM_COVERAGE_REQUESTS = 9;
const MAXIMUM_DEADLINE_MS = 75_000;

export type ProjectorCursor = EnvioCandidateCursor & {
  generation: string;
  blockHash: `0x${string}`;
  /**
   * PostgreSQL stores a genesis or verified-empty-page cursor at a block
   * boundary with NULL log/candidate coordinates. The provider adapters use
   * the equivalent uint32-max sentinel so the next window starts at the next
   * block without inventing an Envio candidate.
   */
  isBlockBoundary: boolean;
};

export type ProjectorPlan = Readonly<{
  cursor: ProjectorCursor;
  dynamicSources: readonly VerifiedDynamicSourceLineage[];
  dynamicSourceTemplates: readonly ProjectorDynamicSourceTemplate[];
  database: Readonly<{
    epochId: string;
    pointerGeneration: string;
    reorgGeneration: string;
    envioProviderDeploymentId: string;
    rpcProviderDeploymentIds: readonly [string, string];
  }>;
}>;

export type ProjectorStore = Readonly<{
  readPlan(): Promise<ProjectorPlan>;
  stageVerifiedDynamicParents(input: {
    plan: ProjectorPlan;
    snapshotBlock: string;
    candidates: readonly EnvioCandidate[];
    evidence: DualRpcCandidateWindowEvidence;
    runtimeObservations: readonly DualRpcDynamicRuntimeObservation[];
    blockComplete: false;
  }): Promise<void>;
  commitVerifiedPage(input: {
    plan: ProjectorPlan;
    snapshotBlock: string;
    candidates: readonly EnvioCandidate[];
    evidence: DualRpcCandidateWindowEvidence;
    blockComplete: true;
  }): Promise<{ generation: string }>;
}>;

type ProjectorEnvio = Readonly<{
  readProgress(input: {
    requiredBlock: string;
  }): Promise<{ progressBlock: string }>;
  readCandidatesWindow(input: {
    cursor: EnvioCandidateCursor;
    throughBlock: string;
    limit: number;
  }): Promise<EnvioCandidate[]>;
}>;

type CaptureSafeHead = typeof readDualRpcSafeHead;
type VerifyWindow = typeof verifyEnvioCandidateWindowWithDualRpc;
type VerifyDynamicRuntime = typeof verifyDynamicRuntimeAtBlockWithDualRpc;

const DYNAMIC_PARENT_BINDINGS = Object.freeze({
  ClassicV3RewardVault: Object.freeze({
    factoryContractName: "ClassicV3RewardVaultFactory",
    factoryEventName: "ClassicRewardVaultDeployed",
  }),
} as const);

function dynamicParentForReplay(
  candidates: readonly EnvioCandidate[],
  dynamicSources: readonly VerifiedDynamicSourceLineage[],
): Readonly<{
  parent: EnvioCandidate;
  childSourceAddress: `0x${string}`;
  childContractName: ProjectorDynamicSourceTemplate["contractName"];
}> | null {
  const known = new Set(dynamicSources.map(({ sourceAddress }) => sourceAddress));
  for (const child of candidates) {
    const binding =
      DYNAMIC_PARENT_BINDINGS[
        child.contractName as keyof typeof DYNAMIC_PARENT_BINDINGS
      ];
    if (!binding || known.has(child.sourceAddress)) continue;
    const parent = candidates.find((candidate) => {
      const vault = candidate.decodedPayload.vault;
      return (
        candidate.blockNumber === child.blockNumber &&
        candidate.blockGlobalLogIndex < child.blockGlobalLogIndex &&
        candidate.contractName === binding.factoryContractName &&
        candidate.eventName === binding.factoryEventName &&
        typeof vault === "string" &&
        vault.toLowerCase() === child.sourceAddress
      );
    });
    if (parent) {
      return Object.freeze({
        parent,
        childSourceAddress: child.sourceAddress,
        childContractName:
          child.contractName as ProjectorDynamicSourceTemplate["contractName"],
      });
    }
  }
  return null;
}

function cursorImmediatelyBefore(
  candidate: EnvioCandidate,
): EnvioCandidateCursor {
  if (candidate.blockGlobalLogIndex === 0) {
    return {
      blockNumber: (BigInt(candidate.blockNumber) - 1n).toString(),
      blockGlobalLogIndex: 0xffff_ffff,
      candidateId: "",
    };
  }
  const priorLogIndex = candidate.blockGlobalLogIndex - 1;
  return {
    blockNumber: candidate.blockNumber,
    blockGlobalLogIndex: priorLogIndex,
    candidateId:
      `1:${candidate.blockHash}:${candidate.transactionHash}:${priorLogIndex}`,
  };
}

function timeoutError() {
  return dataPipelineError({
    dependency: "rpc",
    code: "timeout",
    retryable: true,
    countsTowardCircuit: true,
  });
}

async function withOverallDeadline<T>(
  deadlineMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(timeoutError()), deadlineMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runProjectorCycle(input: {
  store: ProjectorStore;
  envio: ProjectorEnvio;
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
  deadlineMs?: number;
  captureSafeHead?: CaptureSafeHead;
  verifyWindow?: VerifyWindow;
  verifyDynamicRuntime?: VerifyDynamicRuntime;
}) {
  const deadlineMs = input.deadlineMs ?? MAXIMUM_DEADLINE_MS;
  if (
    !Number.isSafeInteger(deadlineMs) ||
    deadlineMs < 10 ||
    deadlineMs > MAXIMUM_DEADLINE_MS
  ) {
    throw invalidInput("config", "projector-deadline");
  }
  const startedAt = Date.now();
  const remaining = () => {
    const value = deadlineMs - (Date.now() - startedAt);
    if (value < 10) throw timeoutError();
    return value;
  };
  const captureSafeHead = input.captureSafeHead ?? readDualRpcSafeHead;
  const verifyWindow =
    input.verifyWindow ?? verifyEnvioCandidateWindowWithDualRpc;
  const verifyDynamicRuntime =
    input.verifyDynamicRuntime ?? verifyDynamicRuntimeAtBlockWithDualRpc;

  return withOverallDeadline(deadlineMs, async () => {
    // Each store method owns and closes its database transaction. All Envio
    // and RPC work deliberately occurs between these two calls.
    const plan = await input.store.readPlan();
    const safeHead = await captureSafeHead({
      providers: input.providers,
      cursor: {
        blockNumber: plan.cursor.blockNumber,
        blockHash: plan.cursor.blockHash,
      },
      rpcPolicy: {
        hardDeadlineMs: remaining(),
        maxCallsPerProvider: MAXIMUM_PROVIDER_CALLS,
      },
    });
    const progress = await input.envio.readProgress({
      requiredBlock: safeHead.safeBlockNumber,
    });
    let snapshot =
      BigInt(progress.progressBlock) < BigInt(safeHead.safeBlockNumber)
        ? BigInt(progress.progressBlock)
        : BigInt(safeHead.safeBlockNumber);
    const cursorBlock = BigInt(plan.cursor.blockNumber);
    if (snapshot < cursorBlock) {
      return {
        status: "idle" as const,
        candidateCount: 0,
        snapshotBlock: snapshot.toString(),
      };
    }
    if (plan.cursor.isBlockBoundary && snapshot === cursorBlock) {
      return {
        status: "idle" as const,
        candidateCount: 0,
        snapshotBlock: snapshot.toString(),
      };
    }
    const maximumCoverageBlock =
      cursorBlock +
      BigInt(COVERAGE_BLOCK_SPAN * MAXIMUM_COVERAGE_REQUESTS) -
      1n;
    if (snapshot > maximumCoverageBlock) snapshot = maximumCoverageBlock;
    const providerSnapshotBlock = snapshot.toString();
    const cursor: EnvioCandidateCursor = {
      blockNumber: plan.cursor.blockNumber,
      blockGlobalLogIndex: plan.cursor.blockGlobalLogIndex,
      candidateId: plan.cursor.candidateId,
    };
    const collected: EnvioCandidate[] = [];
    let pageCursor = cursor;
    let reachedTerminalBoundary = false;
    while (collected.length < MAXIMUM_CANDIDATES_PER_COMMIT) {
      const capacity = MAXIMUM_CANDIDATES_PER_COMMIT - collected.length;
      const limit = Math.min(PROJECTOR_PAGE_LIMIT, capacity);
      const page = await input.envio.readCandidatesWindow({
        cursor: pageCursor,
        throughBlock: providerSnapshotBlock,
        limit,
      });
      collected.push(...page);
      if (page.length < limit) {
        reachedTerminalBoundary = true;
        break;
      }
      const last = page[page.length - 1]!;
      pageCursor = {
        blockNumber: last.blockNumber,
        blockGlobalLogIndex: last.blockGlobalLogIndex,
        candidateId: last.candidateId,
      };
    }

    // A returned candidate is never treated as proof that its block ended. A
    // full page is cut back to the last preceding block boundary; a terminal
    // Envio page may reach the frozen provider snapshot. Both cases are then
    // independently scanned by two RPCs before the store may persist the
    // `empty-page` boundary.
    let candidates: readonly EnvioCandidate[] = collected;
    let completeBlock = providerSnapshotBlock;
    let exceededSingleBlockBudget = false;
    if (!reachedTerminalBoundary) {
      const finalBlock = collected[collected.length - 1]!.blockNumber;
      const prefix = collected.filter(
        (item) => BigInt(item.blockNumber) < BigInt(finalBlock),
      );
      if (prefix.length === 0) {
        const predecessor = BigInt(finalBlock) - 1n;
        if (predecessor <= BigInt(cursor.blockNumber)) {
          exceededSingleBlockBudget = true;
        } else {
          candidates = [];
          completeBlock = predecessor.toString();
        }
      } else {
        candidates = prefix;
        completeBlock = prefix[prefix.length - 1]!.blockNumber;
      }
    }
    const provisionalParent = dynamicParentForReplay(
      exceededSingleBlockBudget ? collected : candidates,
      plan.dynamicSources,
    );
    if (provisionalParent) {
      const matchingTemplates = plan.dynamicSourceTemplates.filter(
        (template) =>
          template.contractName === provisionalParent.childContractName &&
          template.parentFactoryAddress ===
            provisionalParent.parent.sourceAddress &&
          template.parentFactoryContractName ===
            provisionalParent.parent.contractName &&
          template.factoryEventName === provisionalParent.parent.eventName,
      );
      if (matchingTemplates.length !== 1) {
        throw invalidInput("config", "dynamic-runtime-template");
      }
      const dynamicTemplate = matchingTemplates[0]!;
      const stageCursor = cursorImmediatelyBefore(provisionalParent.parent);
      const stageThrough: EnvioCandidateCursor = {
        blockNumber: provisionalParent.parent.blockNumber,
        blockGlobalLogIndex: provisionalParent.parent.blockGlobalLogIndex,
        candidateId: provisionalParent.parent.candidateId,
      };
      const stageEvidence = await verifyWindow({
        candidates: [provisionalParent.parent],
        cursor: stageCursor,
        through: stageThrough,
        providers: input.providers,
        dynamicSources: plan.dynamicSources,
        coveragePolicy: {
          maximumBlockSpan: COVERAGE_BLOCK_SPAN,
          maximumRequests: 1,
        },
        rpcPolicy: {
          hardDeadlineMs: remaining(),
          maxCallsPerProvider: MAXIMUM_PROVIDER_CALLS,
        },
      });
      const runtimeObservation = await verifyDynamicRuntime({
        parentCandidate: provisionalParent.parent,
        sourceAddress: provisionalParent.childSourceAddress,
        deploymentBlockNumber: provisionalParent.parent.blockNumber,
        deploymentBlockHash: provisionalParent.parent.blockHash,
        template: dynamicTemplate,
        parentEvidence: stageEvidence,
        providers: input.providers,
        deadlineMs: remaining(),
      });
      await input.store.stageVerifiedDynamicParents({
        plan,
        snapshotBlock: provisionalParent.parent.blockNumber,
        candidates: [provisionalParent.parent],
        evidence: stageEvidence,
        runtimeObservations: [runtimeObservation],
        blockComplete: false,
      });
      return {
        status: "staged-dynamic-parent" as const,
        candidateCount: 1,
        snapshotBlock: provisionalParent.parent.blockNumber,
      };
    }
    if (exceededSingleBlockBudget) {
      throw dataPipelineError({
        dependency: "envio",
        code: "response_oversize",
        retryable: true,
        countsTowardCircuit: true,
      });
    }
    const through: EnvioCandidateCursor = {
      blockNumber: completeBlock,
      blockGlobalLogIndex: 0xffff_ffff,
      candidateId: "empty-page",
    };
    const evidence = await verifyWindow({
      candidates,
      cursor,
      through,
      providers: input.providers,
      dynamicSources: plan.dynamicSources,
      coveragePolicy: {
        maximumBlockSpan: COVERAGE_BLOCK_SPAN,
        maximumRequests: MAXIMUM_COVERAGE_REQUESTS,
      },
      rpcPolicy: {
        hardDeadlineMs: remaining(),
        maxCallsPerProvider: MAXIMUM_PROVIDER_CALLS,
      },
    });
    const committed = await input.store.commitVerifiedPage({
      plan,
      snapshotBlock: completeBlock,
      candidates,
      evidence,
      blockComplete: true,
    });
    return {
      status: candidates.length === 0
        ? "committed-empty" as const
        : "committed" as const,
      candidateCount: candidates.length,
      generation: committed.generation,
      snapshotBlock: completeBlock,
    };
  });
}
