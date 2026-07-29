import type { DeepV2KeeperConfig } from "./config.mjs";
import type { DeepV2KeeperLease } from "./lease.mjs";

export const DEEP_V2_BOUNDARY_STATE_SCHEMA_VERSION: number;

export class DeepV2KeeperBoundaryError extends Error {
  code: string;
}

export type DeepV2InnerKeeperState = Record<string, unknown>;

export type DeepV2BoundaryState = {
  schemaVersion: number;
  releaseManifest: string;
  chainId: number;
  automationAddress: string;
  coordinatorAddress: string;
  lastCompletedSlot: number | null;
  lastCompletedAtMs: number | null;
  fencingGeneration: number | null;
  keeperState: DeepV2InnerKeeperState;
};

export type DeepV2KeeperWallet = {
  supportsStableIdempotency?: boolean;
  writeContract(input: Record<string, unknown>): Promise<unknown>;
} | null;

export type DeepV2InnerCycleInput = {
  config: DeepV2KeeperConfig;
  state: DeepV2InnerKeeperState;
  readers: readonly unknown[];
  wallet: DeepV2KeeperWallet;
  metrics: Record<string, unknown>;
  persistPendingState(
    state: DeepV2InnerKeeperState,
  ): Promise<boolean | void>;
  nowMs: number;
};

export type DeepV2InnerCycleResult = Record<string, unknown> & {
  state: DeepV2InnerKeeperState;
  outcome: string;
  confirmedBlock: unknown;
  registryCount: unknown;
  ready: readonly unknown[];
};

export type DeepV2BoundaryCycleResult = Record<string, unknown> & {
  boundaryState: DeepV2BoundaryState;
  outcome: string;
  confirmedBlock: unknown;
  registryCount: unknown;
  ready: readonly unknown[];
};

export function createDeepV2BoundaryState(
  config: DeepV2KeeperConfig,
): DeepV2BoundaryState;
export function validateDeepV2BoundaryState(
  state: DeepV2BoundaryState,
  config: DeepV2KeeperConfig,
): DeepV2BoundaryState;
export function deepV2KeeperSlot(nowMs: number): number;
export function runDeepV2KeeperBoundary(input: {
  config: DeepV2KeeperConfig;
  boundaryState: DeepV2BoundaryState;
  lease: DeepV2KeeperLease;
  assertLease(lease: DeepV2KeeperLease): Promise<boolean>;
  persistBoundaryState(
    state: DeepV2BoundaryState,
    lease: DeepV2KeeperLease,
  ): Promise<boolean | void>;
  readers: readonly unknown[];
  wallet: DeepV2KeeperWallet;
  metrics: Record<string, unknown>;
  nowMs: number;
  runCycle?: (
    input: DeepV2InnerCycleInput,
  ) => Promise<DeepV2InnerCycleResult>;
}): Promise<DeepV2BoundaryCycleResult>;
