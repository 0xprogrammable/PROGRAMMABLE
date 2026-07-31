import "server-only";

import type {
  CandidateRpcProvider,
  DualRpcCandidateWindowEvidence,
} from "./dual-rpc";
import {
  readDualRpcSafeHead,
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
 * Envio's adapter validates and caps candidate windows at 32 rows. Using the
 * complete safe page materially reduces initial catch-up time while the RPC
 * budget below still covers the worst case where every row is in a distinct
 * block, transaction and source.
 */
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
  database: Readonly<{
    epochId: string;
    pointerGeneration: string;
    envioProviderDeploymentId: string;
    rpcProviderDeploymentIds: readonly [string, string];
  }>;
}>;

export type ProjectorStore = Readonly<{
  readPlan(): Promise<ProjectorPlan>;
  commitVerifiedPage(input: {
    plan: ProjectorPlan;
    snapshotBlock: string;
    candidates: readonly EnvioCandidate[];
    evidence: DualRpcCandidateWindowEvidence;
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
    const snapshotBlock = snapshot.toString();
    const cursor: EnvioCandidateCursor = {
      blockNumber: plan.cursor.blockNumber,
      blockGlobalLogIndex: plan.cursor.blockGlobalLogIndex,
      candidateId: plan.cursor.candidateId,
    };
    const candidates = await input.envio.readCandidatesWindow({
      cursor,
      throughBlock: snapshotBlock,
        limit: PROJECTOR_MAXIMUM_CANDIDATES_PER_PAGE,
    });
    const last = candidates[candidates.length - 1];
    const through: EnvioCandidateCursor = last
      ? {
          blockNumber: last.blockNumber,
          blockGlobalLogIndex: last.blockGlobalLogIndex,
          candidateId: last.candidateId,
        }
      : {
          blockNumber: snapshotBlock,
          blockGlobalLogIndex: 0xffff_ffff,
          candidateId: "",
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
      snapshotBlock,
      candidates,
      evidence,
    });
    return {
      status: candidates.length === 0
        ? "committed-empty" as const
        : "committed" as const,
      candidateCount: candidates.length,
      generation: committed.generation,
      snapshotBlock,
    };
  });
}
