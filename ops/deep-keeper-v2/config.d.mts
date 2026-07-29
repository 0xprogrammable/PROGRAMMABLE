export const DEEP_V2_RELEASE_MANIFEST_PATH: string;
export const DEEP_V2_KEEPER_INTERVAL_MS: number;
export const DEEP_V2_KEEPER_DEFAULT_MAX_BATCH_SIZE: number;
export const DEEP_V2_KEEPER_MAX_OPERATIONAL_BATCH_SIZE: number;
export const DEEP_V2_KEEPER_DEFAULT_MAX_GAS: bigint;
export const DEEP_V2_KEEPER_EXTENDED_BATCH_MIN_GAS: bigint;
export const DEEP_V2_KEEPER_DEFAULT_VAULT_SUBSIDY_CAP_WEI: bigint;
export const DEEP_V2_KEEPER_DEFAULT_SIMULATION_ACCOUNT: string;

export class DeepV2KeeperConfigError extends Error {
  code: string;
}

export type DeepV2KeeperConfig = Readonly<{
  enabled: boolean;
  chainId: 1;
  releaseManifest: string;
  automationAddress: `0x${string}`;
  automationRuntimeHash: `0x${string}`;
  coordinatorAddress: `0x${string}`;
  coordinatorRuntimeHash: `0x${string}`;
  coordinatorSourceCommitment: `0x${string}`;
  rpcUrls: readonly [string, string];
  signerAddress: `0x${string}` | null;
  signerRpcUrl: string | null;
  privyWalletId: string | null;
  simulationAccount: `0x${string}`;
  confirmations: number;
  intervalMs: 300000;
  maxBatchSize: number;
  scanLimit: number;
  maxGas: bigint;
  maxFeePerGasWei: bigint;
  maxSignerBalanceWei: bigint;
  vaultSubsidyCapWei: bigint;
  pendingTimeoutMs: number;
  stateFile: string;
}>;

export function parseDeepV2KeeperConfig(
  env?: Record<string, string | undefined>,
): DeepV2KeeperConfig;
