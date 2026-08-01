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
  verifyDynamicRuntimesAtBlockWithDualRpc,
  verifyEnvioCandidateWindowWithDualRpc,
} from "./dual-rpc";
import { verifyClassicV3ActivationModel } from "./classic-v3-activation-model";
import type {
  EnvioCandidate,
  EnvioCandidateCursor,
} from "./envio";
import { DataPipelineError, dataPipelineError, invalidInput } from "./errors";
import type { VerifiedDynamicSourceLineage } from "./projector-identities";
import type {
  PendingDynamicSourceActivation,
  ResolvePendingDynamicSourceActivationsInput,
  StageVerifiedDynamicSourceActivationsInput,
} from "./projector-dynamic-activation";
import {
  buildEnvioCursorRecoveryPlan,
  findCanonicalAncestorWithDualRpc,
  type EnvioCursorRecoveryPlan,
  type ReorgGenesisAnchor,
  type ReorgHistoryAncestor,
} from "./projector-reorg";
import { PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP } from "./projector-runtime-limits";
import { manifestEventSelectors } from "./event-manifest";
import { getDataPipelineReleaseBinding } from "./release-binding.server";

/**
 * A short page is the only Envio response that can prove the frozen window is
 * exhausted. Page in bounded chunks while retaining the shared atomic-group
 * ceiling for one block-complete commit.
 */
const PROJECTOR_PAGE_LIMIT = 32;
const MAXIMUM_CANDIDATES_PER_COMMIT =
  PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP;
const MAXIMUM_PROVIDER_CALLS = 128;
const COVERAGE_BLOCK_SPAN = 500;
const MAXIMUM_COVERAGE_REQUESTS = 9;
const MAXIMUM_DEADLINE_MS = 75_000;
const MAXIMUM_JSON_RPC_BATCH_SIZE = 100;
const MAXIMUM_LOG_FILTER_ADDRESSES = 512;
const MAXIMUM_LOG_FILTER_TOPIC0 = 64;

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
  provisionalSourceAddresses: readonly `0x${string}`[];
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
  readReorgRecoveryState(input: {
    plan: ProjectorPlan;
    maximumDepth: number;
  }): Promise<Readonly<{
    ancestors: readonly ReorgHistoryAncestor[];
    genesis: ReorgGenesisAnchor;
    currentReorgGeneration: string;
  }>>;
  recoverCanonicalReorg(input: {
    plan: ProjectorPlan;
    recovery: EnvioCursorRecoveryPlan;
  }): Promise<Readonly<{
    generation: string;
    reorgGeneration: string;
    releaseCheckpointCount: number;
  }>>;
  resolvePendingDynamicSourceActivations(
    input: ResolvePendingDynamicSourceActivationsInput,
  ): Promise<readonly PendingDynamicSourceActivation[]>;
  stageVerifiedDynamicSourceActivations(
    input: StageVerifiedDynamicSourceActivationsInput,
  ): Promise<void>;
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
type VerifyDynamicRuntimes = typeof verifyDynamicRuntimesAtBlockWithDualRpc;
type FindCanonicalAncestor = typeof findCanonicalAncestorWithDualRpc;
type VerifyClassicV3Activation = typeof verifyClassicV3ActivationModel;

type DynamicParentForReplay = Readonly<{
  parent: EnvioCandidate;
  childSourceAddress: `0x${string}`;
  template: ProjectorDynamicSourceTemplate;
}>;

function dynamicParentsForReplay(
  candidates: readonly EnvioCandidate[],
  dynamicSources: readonly VerifiedDynamicSourceLineage[],
  provisionalSourceAddresses: readonly `0x${string}`[],
  templates: readonly ProjectorDynamicSourceTemplate[],
): readonly DynamicParentForReplay[] {
  const known = new Set([
    ...dynamicSources.map(({ sourceAddress }) => sourceAddress),
    ...provisionalSourceAddresses,
  ]);
  const selectedSources = new Set<string>();
  const selectedParents = new Set<string>();
  const matches: DynamicParentForReplay[] = [];
  let targetBlock: string | null = null;
  for (const parent of candidates) {
    const matchingTemplates = templates.filter(
      (template) =>
        template.parentFactoryAddress === parent.sourceAddress &&
        template.parentFactoryContractName === parent.contractName &&
        template.factoryEventName === parent.eventName,
    );
    if (matchingTemplates.length === 0) continue;
    if (matchingTemplates.length !== 1) {
      throw invalidInput("config", "dynamic-runtime-template");
    }
    const template = matchingTemplates[0]!;
    const deployedAddress =
      parent.decodedPayload[template.deployedAddressField];
    if (
      typeof deployedAddress !== "string" ||
      !/^0x[0-9a-f]{40}$/u.test(deployedAddress)
    ) {
      continue;
    }
    const childSourceAddress = deployedAddress as `0x${string}`;
    if (known.has(childSourceAddress)) continue;
    if (targetBlock === null) targetBlock = parent.blockNumber;
    if (parent.blockNumber !== targetBlock) break;
    if (
      selectedSources.has(childSourceAddress) ||
      selectedParents.has(parent.candidateId)
    ) {
      throw invalidInput("envio", "dynamic-parent-duplicate");
    }
    selectedSources.add(childSourceAddress);
    selectedParents.add(parent.candidateId);
    matches.push(Object.freeze({
      parent,
      childSourceAddress,
      template,
    }));
  }
  return Object.freeze(matches);
}

function cursorAtStartOfBlock(
  candidate: EnvioCandidate,
  current: EnvioCandidateCursor,
): EnvioCandidateCursor {
  if (current.blockNumber === candidate.blockNumber) return current;
  return {
    blockNumber: (BigInt(candidate.blockNumber) - 1n).toString(),
    blockGlobalLogIndex: 0xffff_ffff,
    candidateId: "",
  };
}

function dynamicSourcesWithActivationBoundaries(
  current: readonly VerifiedDynamicSourceLineage[],
  pending: readonly PendingDynamicSourceActivation[],
): readonly VerifiedDynamicSourceLineage[] {
  const byAddress = new Map(
    current.map((lineage) => [lineage.sourceAddress, lineage] as const),
  );
  for (const activation of pending) {
    byAddress.set(
      activation.ephemeralLineage.sourceAddress,
      activation.ephemeralLineage,
    );
  }
  return Object.freeze([...byAddress.values()]);
}

function timeoutError() {
  return dataPipelineError({
    dependency: "rpc",
    code: "timeout",
    retryable: true,
    countsTowardCircuit: true,
  });
}

type CoverageFilterShape = Readonly<{
  addressCount: number;
  topicCount: number;
}>;

function coverageFilterShape(input: Readonly<{
  throughBlock: bigint;
  dynamicSources: readonly VerifiedDynamicSourceLineage[];
}>): CoverageFilterShape {
  const binding = getDataPipelineReleaseBinding();
  const sourceContracts = binding.sources
    .filter(({ startBlock }) => BigInt(startBlock) <= input.throughBlock)
    .map(({ address, contractName }) => ({ address, contractName }))
    .concat(input.dynamicSources.map(({ sourceAddress, contractName }) => ({
      address: sourceAddress,
      contractName,
    })));
  const contractNames = new Set(sourceContracts.map(({ contractName }) => contractName));
  return Object.freeze({
    addressCount: new Set(sourceContracts.map(({ address }) => address)).size,
    topicCount: new Set(
      [...contractNames].flatMap((contractName) =>
        manifestEventSelectors(contractName)
      ),
    ).size,
  });
}

function estimatedProviderCallsForWindow(input: Readonly<{
  candidates: readonly EnvioCandidate[];
  cursor: EnvioCandidateCursor;
  throughBlock: bigint;
  filterShape: CoverageFilterShape;
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
}>): readonly [number, number] {
  const { addressCount, topicCount } = input.filterShape;
  if (addressCount < 1 || topicCount < 1) {
    throw invalidInput("config", "coverage-filter");
  }
  const cursorBlock = BigInt(input.cursor.blockNumber);
  const effectiveFromBlock =
    input.cursor.blockGlobalLogIndex === 0xffff_ffff &&
      input.cursor.candidateId === ""
      ? cursorBlock + 1n
      : cursorBlock;
  const blockCount = input.throughBlock - effectiveFromBlock + 1n;
  if (blockCount < 1n || blockCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw invalidInput("config", "coverage-window");
  }
  const filterCount = Number(blockCount) *
    Math.ceil(addressCount / MAXIMUM_LOG_FILTER_ADDRESSES) *
    Math.ceil(topicCount / MAXIMUM_LOG_FILTER_TOPIC0);
  if (!Number.isSafeInteger(filterCount) || filterCount < 1) {
    throw invalidInput("config", "coverage-filter-budget");
  }
  const uniqueCandidateBlocks = new Set(
    input.candidates.map(({ blockNumber }) => blockNumber),
  ).size;
  const uniqueTransactions = new Set(
    input.candidates.map(({ transactionHash }) => transactionHash),
  ).size;
  const uniqueCodeRequests = new Set(
    input.candidates.map(({ blockHash, sourceAddress }) =>
      `${blockHash}:${sourceAddress}`
    ),
  ).size;
  return input.providers.map(({ client }) => {
    const blockCalls = client.getBlocks
      ? Math.ceil((uniqueCandidateBlocks + 1) / MAXIMUM_JSON_RPC_BATCH_SIZE)
      : uniqueCandidateBlocks + 1;
    const receiptCalls = client.getTransactionReceipts
      ? Math.ceil(uniqueTransactions / MAXIMUM_JSON_RPC_BATCH_SIZE)
      : uniqueTransactions;
    const codeCalls = client.getBytecodes
      ? Math.ceil(uniqueCodeRequests / MAXIMUM_JSON_RPC_BATCH_SIZE)
      : uniqueCodeRequests;
    const logCalls = client.getLogsBatch
      ? Math.ceil(filterCount / MAXIMUM_JSON_RPC_BATCH_SIZE)
      : filterCount;
    // chain/head, candidate blocks (including safe), receipts, code, exact
    // through-block header and the bounded log filters.
    return 2 + blockCalls + receiptCalls + codeCalls + 1 + logCalls;
  }) as [number, number];
}

function fitCompleteCoverageWindow(input: Readonly<{
  candidates: readonly EnvioCandidate[];
  cursor: EnvioCandidateCursor;
  desiredThroughBlock: string;
  dynamicSources: readonly VerifiedDynamicSourceLineage[];
  providers: readonly [CandidateRpcProvider, CandidateRpcProvider];
}>): Readonly<{
  candidates: readonly EnvioCandidate[];
  throughBlock: string;
}> {
  // Unit-level callers may inject the verifier and deliberately omit concrete
  // providers. Production configuration always supplies exactly two clients;
  // only that path can be budgeted from transport capabilities.
  if (input.providers.length !== 2) {
    return Object.freeze({
      candidates: Object.freeze([...input.candidates]),
      throughBlock: input.desiredThroughBlock,
    });
  }
  const cursorBlock = BigInt(input.cursor.blockNumber);
  const minimumThrough =
    input.cursor.blockGlobalLogIndex === 0xffff_ffff &&
      input.cursor.candidateId === ""
      ? cursorBlock + 1n
      : cursorBlock;
  let low = minimumThrough;
  let high = BigInt(input.desiredThroughBlock);
  let selected: bigint | null = null;
  const filterShape = coverageFilterShape({
    throughBlock: high,
    dynamicSources: input.dynamicSources,
  });
  while (low <= high) {
    const middle = low + (high - low) / 2n;
    const candidates = input.candidates.filter(
      ({ blockNumber }) => BigInt(blockNumber) <= middle,
    );
    const calls = estimatedProviderCallsForWindow({
      candidates,
      cursor: input.cursor,
      throughBlock: middle,
      filterShape,
      providers: input.providers,
    });
    if (calls.every((count) => count <= MAXIMUM_PROVIDER_CALLS)) {
      selected = middle;
      low = middle + 1n;
    } else {
      high = middle - 1n;
    }
  }
  if (selected === null) {
    throw invalidInput("rpc", "provider-call-budget");
  }
  return Object.freeze({
    candidates: Object.freeze(input.candidates.filter(
      ({ blockNumber }) => BigInt(blockNumber) <= selected!,
    )),
    throughBlock: selected.toString(),
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
  verifyDynamicRuntimes?: VerifyDynamicRuntimes;
  verifyDynamicRuntime?: VerifyDynamicRuntime;
  findCanonicalAncestor?: FindCanonicalAncestor;
  verifyClassicV3Activation?: VerifyClassicV3Activation;
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
  const verifyDynamicRuntimes =
    input.verifyDynamicRuntimes ??
    (input.verifyDynamicRuntime === undefined
      ? verifyDynamicRuntimesAtBlockWithDualRpc
      : null);
  const findCanonicalAncestor =
    input.findCanonicalAncestor ?? findCanonicalAncestorWithDualRpc;
  const verifyClassicV3Activation =
    input.verifyClassicV3Activation ?? verifyClassicV3ActivationModel;

  return withOverallDeadline(deadlineMs, async () => {
    // Each store method owns and closes its database transaction. All Envio
    // and RPC work deliberately occurs between these two calls.
    const plan = await input.store.readPlan();
    let safeHead;
    try {
      safeHead = await captureSafeHead({
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
    } catch (error) {
      if (
        !(error instanceof DataPipelineError) ||
        error.code !== "validation_failed" ||
        error.safeMetadata?.operation !== "safe-head-cursor-orphaned"
      ) {
        throw error;
      }
      const recoveryState = await input.store.readReorgRecoveryState({
        plan,
        maximumDepth: 128,
      });
      if (
        recoveryState.currentReorgGeneration !==
          plan.database.reorgGeneration
      ) {
        throw invalidInput("postgres", "reorg-generation");
      }
      const target = await findCanonicalAncestor({
        providers: input.providers,
        ancestors: recoveryState.ancestors,
        genesis: recoveryState.genesis,
        policy: {
          maximumDepth: 128,
          maxProviderCalls: MAXIMUM_PROVIDER_CALLS,
          deadlineMs: remaining(),
        },
      });
      const recovery = buildEnvioCursorRecoveryPlan({
        expectedGeneration: plan.cursor.generation,
        currentReorgGeneration: recoveryState.currentReorgGeneration,
        target,
      });
      const recovered = await input.store.recoverCanonicalReorg({
        plan,
        recovery,
      });
      return {
        status: "recovered-reorg" as const,
        candidateCount: 0,
        generation: recovered.generation,
        reorgGeneration: recovered.reorgGeneration,
        releaseCheckpointCount: recovered.releaseCheckpointCount,
        snapshotBlock: recovery.targetBlockNumber,
      };
    }
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
    // Read one sentinel beyond the atomic ceiling. An empty sentinel proves an
    // exact-size block ended; a real sentinel lets us either cut back to the
    // preceding complete block or fail closed when one block exceeds 4096.
    while (collected.length <= MAXIMUM_CANDIDATES_PER_COMMIT) {
      const capacity =
        MAXIMUM_CANDIDATES_PER_COMMIT + 1 - collected.length;
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
    if (exceededSingleBlockBudget) {
      throw dataPipelineError({
        dependency: "envio",
        code: "response_oversize",
        retryable: false,
        countsTowardCircuit: true,
      });
    }
    const provisionalParents = dynamicParentsForReplay(
      candidates,
      plan.dynamicSources,
      plan.provisionalSourceAddresses,
      plan.dynamicSourceTemplates,
    );
    if (provisionalParents.length > 0) {
      const parents = provisionalParents.map(({ parent }) => parent);
      const firstParent = parents[0]!;
      const stageCursor = cursorAtStartOfBlock(firstParent, cursor);
      const stageThrough: EnvioCandidateCursor = {
        blockNumber: firstParent.blockNumber,
        blockGlobalLogIndex: 0xffff_ffff,
        candidateId: "empty-page",
      };
      const stageEvidence = await verifyWindow({
        candidates: parents,
        cursor: stageCursor,
        through: stageThrough,
        providers: input.providers,
        dynamicSources: plan.dynamicSources,
        coverageSourceAddresses: Object.freeze([
          ...new Set(parents.map(({ sourceAddress }) => sourceAddress)),
        ]),
        maximumCandidateCount:
          PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP,
        coveragePolicy: {
          maximumBlockSpan: COVERAGE_BLOCK_SPAN,
          maximumRequests: 1,
        },
        rpcPolicy: {
          hardDeadlineMs: remaining(),
          maxCallsPerProvider: MAXIMUM_PROVIDER_CALLS,
        },
      });
      const runtimeItems = provisionalParents.map((provisionalParent) => ({
        parentCandidate: provisionalParent.parent,
        sourceAddress: provisionalParent.childSourceAddress,
        deploymentBlockNumber: provisionalParent.parent.blockNumber,
        deploymentBlockHash: provisionalParent.parent.blockHash,
        template: provisionalParent.template,
      }));
      const runtimeObservations: readonly DualRpcDynamicRuntimeObservation[] =
        verifyDynamicRuntimes
          ? await verifyDynamicRuntimes({
              items: runtimeItems,
              parentEvidence: stageEvidence,
              providers: input.providers,
              deadlineMs: remaining(),
            })
          : await Promise.all(runtimeItems.map((item) =>
              verifyDynamicRuntime({
                ...item,
                parentEvidence: stageEvidence,
                providers: input.providers,
                deadlineMs: remaining(),
              })
            ));
      await input.store.stageVerifiedDynamicParents({
        plan,
        snapshotBlock: firstParent.blockNumber,
        candidates: parents,
        evidence: stageEvidence,
        runtimeObservations,
        blockComplete: false,
      });
      return {
        status: "staged-dynamic-parent" as const,
        candidateCount: parents.length,
        snapshotBlock: firstParent.blockNumber,
      };
    }
    const fittedWindow = fitCompleteCoverageWindow({
      candidates,
      cursor,
      desiredThroughBlock: completeBlock,
      dynamicSources: plan.dynamicSources,
      providers: input.providers,
    });
    candidates = fittedWindow.candidates;
    completeBlock = fittedWindow.throughBlock;
    // The durable non-empty cursor remains candidate-backed. Do not claim a
    // trailing empty block in the same page: commit that reviewed candidate
    // block first, then let the next empty-page cycle advance the verified
    // block boundary. This preserves the database evidence shape and avoids a
    // permanent candidate-at-N / safe-head-at-N+k validation loop.
    const terminalCandidate = candidates.at(-1);
    if (
      terminalCandidate !== undefined &&
      BigInt(completeBlock) > BigInt(terminalCandidate.blockNumber)
    ) {
      completeBlock = terminalCandidate.blockNumber;
    }
    const through: EnvioCandidateCursor = {
      blockNumber: completeBlock,
      blockGlobalLogIndex: 0xffff_ffff,
      candidateId: "empty-page",
    };
    const pendingActivations =
      await input.store.resolvePendingDynamicSourceActivations({
        candidates,
        expectedCursorGeneration: plan.cursor.generation,
        expectedCursorBlockHash: plan.cursor.blockHash,
        expectedReorgGeneration: plan.database.reorgGeneration,
      });
    const evidence = await verifyWindow({
      candidates,
      cursor,
      through,
      providers: input.providers,
      dynamicSources: dynamicSourcesWithActivationBoundaries(
        plan.dynamicSources,
        pendingActivations,
      ),
      maximumCandidateCount:
        PROJECTOR_MAXIMUM_CANDIDATES_PER_ATOMIC_GROUP,
      coveragePolicy: {
        maximumBlockSpan: COVERAGE_BLOCK_SPAN,
        maximumRequests: MAXIMUM_COVERAGE_REQUESTS,
      },
      rpcPolicy: {
        hardDeadlineMs: remaining(),
        maxCallsPerProvider: MAXIMUM_PROVIDER_CALLS,
      },
    });
    const activationsByBlock = new Map<
      string,
      PendingDynamicSourceActivation[]
    >();
    for (const pending of pendingActivations) {
      const blockKey = `${pending.launchCandidate.blockNumber}:${pending.launchCandidate.blockHash}`;
      const group = activationsByBlock.get(blockKey) ?? [];
      group.push(pending);
      activationsByBlock.set(blockKey, group);
    }
    const orderedActivationGroups = [...activationsByBlock.values()].sort(
      (left, right) => {
        const leftBlock = BigInt(left[0]!.launchCandidate.blockNumber);
        const rightBlock = BigInt(right[0]!.launchCandidate.blockNumber);
        return leftBlock < rightBlock ? -1 : leftBlock > rightBlock ? 1 : 0;
      },
    );
    for (const group of orderedActivationGroups) {
      const activationBlock = group[0]!.launchCandidate.blockNumber;
      const activationCandidates = candidates.filter(
        (candidate) => BigInt(candidate.blockNumber) <= BigInt(activationBlock),
      );
      const dynamicSources = dynamicSourcesWithActivationBoundaries(
        plan.dynamicSources,
        pendingActivations.filter(
          (pending) =>
            BigInt(pending.launchCandidate.blockNumber) <=
            BigInt(activationBlock),
        ),
      );
      const activationEvidence = await verifyWindow({
        candidates: activationCandidates,
        cursor,
        through: {
          blockNumber: activationBlock,
          blockGlobalLogIndex: 0xffff_ffff,
          candidateId: "empty-page",
        },
        providers: input.providers,
        dynamicSources,
        coveragePolicy: {
          maximumBlockSpan: COVERAGE_BLOCK_SPAN,
          maximumRequests: MAXIMUM_COVERAGE_REQUESTS,
        },
        rpcPolicy: {
          hardDeadlineMs: remaining(),
          maxCallsPerProvider: MAXIMUM_PROVIDER_CALLS,
        },
      });
      const verifiedActivations = await Promise.all(
        group.map(async (pending) => {
          const verification = await verifyClassicV3Activation({
            activationId: pending.activationId,
            parentCandidate: pending.historicalParentCandidate,
            launchCandidate: pending.launchCandidate,
            sameBlockVaultEvents: activationCandidates.filter(
              (candidate) =>
                candidate.blockNumber === activationBlock &&
                candidate.sourceAddress === pending.sourceAddress &&
                candidate.contractName === "ClassicV3RewardVault",
            ),
            candidateEvidence: activationEvidence,
            sourceAddress: pending.sourceAddress,
            template: pending.template,
            canonicalDeployment: pending.canonicalDeployment,
            providers: input.providers,
            deadlineMs: remaining(),
          });
          return Object.freeze({
            pending,
            runtimeObservation: verification.runtimeObservation,
            modelVerificationEvidence:
              verification.modelVerificationEvidence,
          });
        }),
      );
      await input.store.stageVerifiedDynamicSourceActivations({
        candidates: activationCandidates,
        evidence: activationEvidence,
        activations: verifiedActivations,
        blockComplete: false,
      });
    }
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
