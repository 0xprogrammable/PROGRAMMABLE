import type { DeepV3KeeperConfig } from "./config.mjs";

export const DEEP_V3_RELEASE_VERSION: string;
export const DEEP_V3_INTERNAL_CONTRACT_RELEASE: string;
export const DEEP_V3_KEEPER_RELEASE_VERSION: string;
export function validDeepV3ReviewedBinding(binding: unknown): boolean;
export function evaluateDeepV3KeeperReleaseGate(
  release: unknown,
  config: DeepV3KeeperConfig,
  binding: unknown,
): {
  ready: boolean;
  reasons: readonly string[];
};
