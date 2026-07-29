import type { DeepV2KeeperConfig } from "./config.mjs";

export const DEEP_V2_RELEASE_VERSION: string;
export const DEEP_V2_INTERNAL_CONTRACT_RELEASE: string;
export const DEEP_V2_KEEPER_RELEASE_VERSION: string;
export const DEEP_V2_KEEPER_COMPATIBILITY_STATUS: string;

export function evaluateDeepV2KeeperReleaseGate(
  release: unknown,
  config: DeepV2KeeperConfig,
  binding: unknown,
): {
  ready: boolean;
  reasons: readonly string[];
  releaseVersion: unknown;
  sourceCommitment: unknown;
  startBlock: unknown;
};
