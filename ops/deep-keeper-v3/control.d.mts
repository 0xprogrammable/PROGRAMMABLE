import type { DeepV3KeeperConfig } from "./config.mjs";

export type DeepV3StateBinding = Pick<
  DeepV3KeeperConfig,
  | "releaseManifest"
  | "chainId"
  | "automationAddress"
  | "executorAddress"
  | "sourceCommitment"
>;

export type DeepV3KeeperState = {
  schemaVersion: 1;
  releaseManifest: string;
  chainId: number;
  automationAddress: string;
  executorAddress: string;
  sourceCommitment: string;
  cursor: number;
  lastCompletedSlot: number | null;
  lastCompletedAtMs: number | null;
  lastCompletedBlockNumber: number | null;
  lastCompletedBlockHash: string | null;
  pending: null | {
    vault: string;
    action: 1 | 2;
    slot: number;
    cursor: number;
    idempotencyKey: string;
    transactionHash: string | null;
    createdAtMs: number;
    lastReplayAtMs: number | null;
    replayCount: number;
    gas: string | null;
    maxFeePerGas: string | null;
    maxPriorityFeePerGas: string | null;
  };
  operatorActionRequired: null | {
    reason:
      | "transaction-absent-after-privy-idempotency-window"
      | "unresolved-transaction-after-privy-idempotency-window"
      | "submission-intent-after-privy-idempotency-window"
      | "privy-idempotency-hash-mismatch";
    transactionHash: string | null;
    vault: string;
    action: 1 | 2;
    enteredAtMs: number;
  };
  fencingGeneration: number | null;
};

export type DeepV3KeeperControl = {
  ownerId: string;
  generation: number;
  fencingToken: string;
  acquiredAtMs: number;
  expiresAtMs: number;
  state: DeepV3KeeperState | null;
  etag: string;
};

export type DeepV3KeeperControlStore = {
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

export const DEEP_V3_KEEPER_CONTROL_PATH: string;
export const DEEP_V3_KEEPER_LEASE_DURATION_MS: number;
export function createDeepV3KeeperState(
  config: DeepV3StateBinding,
): DeepV3KeeperState;
export function validateDeepV3KeeperState(
  state: DeepV3KeeperState,
  config: DeepV3StateBinding,
): DeepV3KeeperState;
export function acquireDeepV3KeeperControl(input: {
  store: DeepV3KeeperControlStore;
  nowMs: number;
  ownerId?: string;
  durationMs?: number;
  createFencingToken?: () => string;
}): Promise<DeepV3KeeperControl | null>;
export function assertDeepV3KeeperControl(input: {
  store: DeepV3KeeperControlStore;
  control: DeepV3KeeperControl;
  nowMs: number;
}): Promise<boolean>;
export function writeDeepV3KeeperState(input: {
  store: DeepV3KeeperControlStore;
  control: DeepV3KeeperControl;
  state: DeepV3KeeperState;
  config: DeepV3StateBinding;
  nowMs: number;
}): Promise<boolean>;
export function releaseDeepV3KeeperControl(input: {
  store: DeepV3KeeperControlStore;
  control: DeepV3KeeperControl;
  nowMs: number;
}): Promise<boolean>;
