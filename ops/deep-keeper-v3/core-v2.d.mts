export const DeepV3V2Action: Readonly<{
  None: 0;
  Compound: 1;
  GrowOracle: 2;
}>;
export const DEEP_V3_V2_AUTOMATION_ABI: readonly unknown[];
export const DEEP_V3_V2_LAUNCHER_ABI: readonly unknown[];
export const DEEP_V3_V2_EXECUTOR_ABI: readonly unknown[];
export const DEEP_V3_V2_VAULT_ABI: readonly unknown[];
export class DeepV3KeeperV2Error extends Error {
  code: string;
}
export function deepV3KeeperV2Slot(nowMs: number): number;
export function scanDeepV3KeeperV2Pages(input: {
  readers: readonly unknown[];
  automationAddress: string;
  blockNumber: bigint;
  startCursor: number;
  pageSize: number;
  maxPages: number;
  excludedVaults: Set<string>;
}): Promise<{
  registryCount: number;
  scanned: number;
  nextCursor: number;
  candidates: Array<{ vault: `0x${string}`; action: 1 | 2 }>;
}>;
export function deepV3KeeperV2TheoreticalGas(
  candidates: readonly { action: 1 | 2 }[],
): bigint;
export function packDeepV3KeeperV2Candidates(
  candidates: readonly { vault: string; action: 1 | 2 }[],
  maxGas: bigint,
): Array<{ vault: `0x${string}`; action: 1 | 2 }>;
export function deepV3KeeperV2IdempotencyKey(input: {
  sourceCommitment: `0x${string}`;
  opsSourceCommitment: `0x${string}`;
  releaseVersion: string;
  laneId: string;
  slot: number;
  blockHash: `0x${string}`;
  scanStartCursor: number;
  scanEndCursor: number;
  candidates: readonly { vault: `0x${string}`; action: 1 | 2 }[];
  requestHash: `0x${string}`;
}): string;
export function deepV3KeeperV2ExecuteData(
  candidates: readonly { vault: `0x${string}`; action: 1 | 2 }[],
): `0x${string}`;
export function deepV3KeeperV2ExecutorBatchHash(input: {
  chainId: number;
  executorAddress: `0x${string}`;
  signerAddress: `0x${string}`;
  candidates: readonly { vault: `0x${string}`; action: 1 | 2 }[];
}): `0x${string}`;
export function deepV3KeeperV2RequestHash(input: {
  executorAddress: `0x${string}`;
  candidates: readonly { vault: `0x${string}`; action: 1 | 2 }[];
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  expectedNonce: bigint;
  signerRequestLifetimeMs: number;
}): `0x${string}`;
export function passesDeepV3KeeperV2EconomicPolicy(input: {
  candidates: readonly {
    growthBudgetWei: bigint;
    singleMaxGasDebitWei: bigint;
  }[];
  batchGrowthBudgetWei: bigint;
  batchMaxGasDebitWei: bigint;
  minGrowthToMaxGasRatioBps: number;
  batchGas: bigint;
  maxTotalGasPerTick: bigint;
  committedTickGas: bigint;
  maxTotalDebitWeiPerTick: bigint;
  committedTickDebitWei: bigint;
  tickSubmissionCount: number;
  maxNewSubmissionsPerTick: number;
  maxTotalDebitWeiPerDay: bigint;
  committedTodayWei: bigint;
  signerBalanceWei: bigint;
  signerBalanceFloorWei: bigint;
}): { ready: boolean; reasons: string[] };
export function runDeepV3KeeperV2Cycle(input: {
  config: unknown;
  state: unknown;
  readers: readonly unknown[];
  wallet: unknown;
  nowMs: number;
  requestExpiryMs: number;
  persistState(state: unknown): Promise<boolean>;
  assertFence(): Promise<boolean>;
}): Promise<{
  outcome: string;
  state: unknown;
  transactionHash: string | null;
  commonBlock: {
    number: bigint;
    hash: string;
    gasLimit: bigint;
  };
  scanned: number;
  confirmedBatchIds: string[];
  submittedBatchIds: string[];
  policyReasons?: string[];
}>;
export const DEEP_V3_KEEPER_V2_TIMING: Readonly<{
  absentGraceMs: number;
  safeReplayMs: number;
  replayCooldownMs: number;
}>;
