export type DeepV3KeeperV2SignerLane = Readonly<{
  id: "lane-0";
  partitionId: "partition-0";
  partitionIndex: 0;
  partitionCount: 1;
  signerAddress: `0x${string}`;
  privyWalletId: string;
}>;

export type DeepV3KeeperV2Config = Readonly<{
  releaseVersion: "deep-keeper-v3-ops-v2";
  controlPath: string;
  legacyControlPath: string;
  enabled: boolean;
  sendTransactions: boolean;
  legacyEnabled: boolean;
  legacySends: boolean;
  deploymentCommit: string | null;
  chainId: 1;
  releaseManifest: string;
  automationAddress: `0x${string}`;
  automationRuntimeHash: `0x${string}`;
  launcherAddress: `0x${string}`;
  launcherRuntimeHash: `0x${string}`;
  vaultFactoryAddress: `0x${string}`;
  vaultFactoryRuntimeHash: `0x${string}`;
  executorAddress: `0x${string}`;
  executorRuntimeHash: `0x${string}`;
  sourceCommitment: `0x${string}`;
  opsSourceCommitment: `0x${string}`;
  rpcUrls: readonly string[];
  intervalMs: 300000;
  scanPageSize: 32;
  maxScanPages: 2;
  maxCandidatesPerBatch: 4;
  maxNewSubmissionsPerTick: 1;
  maxActivePendingBatches: 8;
  maxOperatorIncidents: 8;
  maxHistoryEntries: 64;
  confirmations: 12;
  maxTransactionGas: bigint;
  maxTotalGasPerTick: bigint;
  maximumCompoundNativeWei: bigint;
  minGrowthToMaxGasRatioBps: number;
  maxFeePerGasWei: bigint;
  maxTotalDebitWeiPerTick: bigint;
  maxTotalDebitWeiPerDay: bigint;
  signerBalanceFloorWei: bigint;
  signerLanes: readonly DeepV3KeeperV2SignerLane[];
}>;

export const DEEP_V3_KEEPER_V2_RELEASE: string;
export const DEEP_V3_KEEPER_V2_CONTROL_PATH: string;
export const DEEP_V3_KEEPER_V2_LEGACY_CONTROL_PATH: string;
export const DEEP_V3_KEEPER_V2_MANIFEST_PATH: string;
export const DEEP_V3_KEEPER_V2_INTERVAL_MS: number;
export const DEEP_V3_KEEPER_V2_SCAN_PAGE_SIZE: number;
export const DEEP_V3_KEEPER_V2_MAX_SCAN_PAGES: number;
export const DEEP_V3_KEEPER_V2_MAX_CANDIDATES: number;
export const DEEP_V3_KEEPER_V2_MAX_NEW_SUBMISSIONS: number;
export const DEEP_V3_KEEPER_V2_MAX_ACTIVE_PENDING: number;
export const DEEP_V3_KEEPER_V2_MAX_OPERATOR_INCIDENTS: number;
export const DEEP_V3_KEEPER_V2_MAX_HISTORY: number;
export const DEEP_V3_KEEPER_V2_CONFIRMATIONS: number;
export const DEEP_V3_KEEPER_V2_MAX_TRANSACTION_GAS: bigint;
export const DEEP_V3_KEEPER_V2_MAX_TOTAL_GAS_PER_TICK: bigint;
export const DEEP_V3_KEEPER_V2_MAX_COMPOUND_NATIVE: bigint;
export const DEEP_V3_KEEPER_V2_ABSENT_GRACE_MS: number;
export const DEEP_V3_KEEPER_V2_SAFE_REPLAY_MS: number;
export const DEEP_V3_KEEPER_V2_REPLAY_COOLDOWN_MS: number;
export const DEEP_V3_KEEPER_V2_MAX_SIGNER_REQUEST_LIFETIME_MS: 95000;

export class DeepV3KeeperV2ConfigError extends Error {
  code: string;
}

export function parseDeepV3KeeperV2Config(
  env?: Record<string, string | undefined>,
): DeepV3KeeperV2Config;
