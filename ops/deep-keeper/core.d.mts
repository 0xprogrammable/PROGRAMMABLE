/* eslint-disable @typescript-eslint/no-explicit-any */

export const DEEP_KEEPER_EXECUTOR_SOURCE_COMMITMENT: string;
export const PRIVY_IDEMPOTENCY_REPLAY_WINDOW_MS: number;
export function parseKeeperConfig(
  env?: Record<string, string | undefined>,
): any;
export function createInitialState(config: any): any;
export function validateState(state: any, config: any): any;
export function migrateKeeperState(state: any, config: any): any;
export function createMetrics(): any;
export function runKeeperCycle(input: any): Promise<any>;
export function allocateWeiByWeight(
  totalWei: bigint,
  candidates: string[],
  weightsByVault: Record<string, string | bigint>,
): Record<string, bigint>;
export function renderPrometheusMetrics(
  metrics: any,
  runtime: any,
  config: any,
): string;
