import type {
  DeepV3KeeperV2SignerLane,
} from "./config-v2.mjs";

export type DeepV3KeeperV2Candidate = {
  vault: `0x${string}`;
  action: 1 | 2;
  accruedGrowthWei: string;
  growthBudgetWei: string;
  rollingCapacityWei: string;
  economicBudgetKind:
    | "compound-cycle"
    | "oracle-prerequisite";
  singleMaxGasDebitWei: string;
};

export type DeepV3KeeperV2PendingBatch = {
  id: string;
  laneId: string;
  partitionId: string;
  slot: number;
  scanBlockNumber: number;
  scanBlockHash: `0x${string}`;
  scanStartCursor: number;
  scanEndCursor: number;
  candidates: DeepV3KeeperV2Candidate[];
  idempotencyKey: string;
  referenceId: string;
  request: {
    requestHash: `0x${string}`;
    gas: string;
    maxFeePerGas: string;
    maxPriorityFeePerGas: string;
    maxGasDebitWei: string;
    growthBudgetWei: string;
    expectedNonce: string;
    signerRequestLifetimeMs: "95000";
  };
  transactionHash: `0x${string}` | null;
  transactionId: string | null;
  nonce: string | null;
  createdAtMs: number;
  lastReplayAtMs: number | null;
  replayCount: number;
  budgetDayStartMs: number;
  status: "intent" | "submitted" | "operator";
};

export type DeepV3KeeperV2HistoryEntry = {
  batchId: string;
  laneId: string;
  transactionHash: `0x${string}`;
  nonce: string;
  receiptStatus: "success" | "reverted";
  blockNumber: number;
  blockHash: `0x${string}`;
  actualGasDebitWei: string;
  confirmedAtMs: number;
  candidates: Array<{
    candidateIndex: number;
    vault: `0x${string}`;
    expectedAction: number;
    actualAction: number;
    outcome: number;
  }>;
};

export type DeepV3KeeperV2StateConfig = {
  releaseVersion: string;
  releaseManifest: string;
  chainId: number;
  automationAddress: `0x${string}`;
  executorAddress: `0x${string}`;
  sourceCommitment: `0x${string}`;
  opsSourceCommitment: `0x${string}`;
  maxActivePendingBatches: number;
  maxOperatorIncidents: number;
  maxHistoryEntries: number;
  signerLanes: readonly DeepV3KeeperV2SignerLane[];
};

export type DeepV3KeeperV2State = {
  schemaVersion: 2;
  releaseVersion: string;
  releaseManifest: string;
  chainId: number;
  automationAddress: `0x${string}`;
  executorAddress: `0x${string}`;
  sourceCommitment: `0x${string}`;
  opsSourceCommitment: `0x${string}`;
  migration: {
    sourcePath: string;
    importedCursor: number;
    importedGeneration: number;
    importedAtMs: number;
  };
  partitions: Array<{
    id: string;
    laneId: string;
    cursor: number;
    partitionIndex: number;
    partitionCount: number;
    lastScanBlockNumber: number | null;
    lastScanBlockHash: string | null;
    lastScannedAtMs: number | null;
  }>;
  lanes: Array<{
    id: string;
    partitionId: string;
    signerAddress: `0x${string}`;
    pendingBatchIds: string[];
    lastObservedConfirmedNonce: string | null;
    lastObservedPendingNonce: string | null;
    lastObservedBalanceWei: string | null;
    balanceAlert: boolean;
    blockedReason: string | null;
    lastSubmissionSlot: number | null;
  }>;
  pendingBatches: DeepV3KeeperV2PendingBatch[];
  operatorIncidents: Array<{
    id: string;
    batchId: string;
    laneId: string;
    reason: string;
    enteredAtMs: number;
  }>;
  tickBudgets: Array<{
    slot: number;
    committedGas: string;
    committedMaxDebitWei: string;
    submissionCount: number;
  }>;
  gasBudgetDays: Array<{
    dayStartMs: number;
    committedMaxDebitWei: string;
    confirmedActualDebitWei: string;
    submissionCount: number;
  }>;
  history: DeepV3KeeperV2HistoryEntry[];
  lastCycleSlot: number | null;
  lastCycleAtMs: number | null;
  lastCanonicalBlockNumber: number | null;
  lastCanonicalBlockHash: string | null;
  fencingGeneration: number | null;
};

export type DeepV3KeeperV2ControlStore = {
  read(path: string): Promise<{ value: string; etag: string } | null>;
  putIfAbsent(
    path: string,
    value: string,
  ): Promise<{ etag: string } | null>;
  putIfMatch(
    path: string,
    value: string,
    etag: string,
  ): Promise<{ etag: string } | null>;
};

export const DEEP_V3_KEEPER_V2_STATE_SCHEMA_VERSION: 2;
export const DEEP_V3_KEEPER_V2_LEASE_DURATION_MS: number;

export function createDeepV3KeeperV2State(
  config: Pick<
    DeepV3KeeperV2StateConfig,
    | "releaseVersion"
    | "releaseManifest"
    | "chainId"
    | "automationAddress"
    | "executorAddress"
    | "sourceCommitment"
    | "opsSourceCommitment"
    | "signerLanes"
  >,
  migration: {
    importedCursor: number;
    importedGeneration: number;
    importedAtMs: number;
  },
): DeepV3KeeperV2State;
export function validateDeepV3KeeperV2State(
  state: unknown,
  config: DeepV3KeeperV2StateConfig,
): DeepV3KeeperV2State;
export function inspectDeepV3LegacyControl(
  value: string | null,
  nowMs: number,
): { importedCursor: number; importedGeneration: number };
export function inspectStableDeepV3LegacyControl(
  before: { value: string; etag: string } | null,
  after: { value: string; etag: string } | null,
  nowMs: number,
): { importedCursor: number; importedGeneration: number };
export function acquireDeepV3KeeperV2Control(input: {
  store: DeepV3KeeperV2ControlStore;
  nowMs: number;
  ownerId?: string;
  durationMs?: number;
  createFencingToken?: () => string;
}): Promise<(DeepV3KeeperV2Control & { etag: string }) | null>;
export type DeepV3KeeperV2Control = {
  ownerId: string;
  generation: number;
  fencingToken: string;
  acquiredAtMs: number;
  expiresAtMs: number;
  state: DeepV3KeeperV2State | null;
  etag: string;
};
export function assertDeepV3KeeperV2Control(input: {
  store: DeepV3KeeperV2ControlStore;
  control: DeepV3KeeperV2Control;
  nowMs: number;
}): Promise<boolean>;
export function writeDeepV3KeeperV2State(input: {
  store: DeepV3KeeperV2ControlStore;
  control: DeepV3KeeperV2Control;
  state: DeepV3KeeperV2State;
  config: DeepV3KeeperV2StateConfig;
  nowMs: number;
}): Promise<boolean>;
export function releaseDeepV3KeeperV2Control(input: {
  store: DeepV3KeeperV2ControlStore;
  control: DeepV3KeeperV2Control;
  nowMs: number;
}): Promise<boolean>;
