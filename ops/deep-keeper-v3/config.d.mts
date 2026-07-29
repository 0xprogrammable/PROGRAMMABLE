export type DeepV3KeeperConfig = Readonly<{
  enabled: boolean;
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
  rpcUrls: readonly [string, string];
  signerAddress: `0x${string}` | null;
  privyWalletId: string | null;
  intervalMs: 300000;
  scanLimit: 1;
  maxBatchSize: 1;
  confirmations: 12;
  maxGas: bigint;
  maxFeePerGasWei: bigint;
}>;

export const DEEP_V3_RELEASE_MANIFEST_PATH: string;
export const DEEP_V3_KEEPER_INTERVAL_MS: 300000;
export const DEEP_V3_KEEPER_SCAN_LIMIT: 1;
export const DEEP_V3_KEEPER_BATCH_SIZE: 1;
export const DEEP_V3_KEEPER_CONFIRMATIONS: 12;
export const DEEP_V3_KEEPER_MAX_GAS: bigint;
export const DEEP_V3_KEEPER_ABSENT_TRANSACTION_GRACE_MS: number;
export const DEEP_V3_KEEPER_SAFE_PRIVY_REPLAY_MS: number;
export const DEEP_V3_KEEPER_REPLAY_COOLDOWN_MS: number;

export class DeepV3KeeperConfigError extends Error {
  code: string;
}

export function parseDeepV3KeeperConfig(
  env?: Record<string, string | undefined>,
): DeepV3KeeperConfig;
