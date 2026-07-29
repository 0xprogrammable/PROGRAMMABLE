import type { DeepV3KeeperConfig } from "./config.mjs";
import type { DeepV3KeeperState } from "./control.mjs";

export const DeepV3Action: Readonly<{
  None: 0;
  Compound: 1;
  GrowOracle: 2;
}>;
export const DEEP_V3_AUTOMATION_ABI: readonly unknown[];
export const DEEP_V3_LAUNCHER_ABI: readonly unknown[];
export const DEEP_V3_EXECUTOR_ABI: readonly unknown[];
export class DeepV3KeeperError extends Error {
  code: string;
}
export function deepV3ExecuteData(
  vault: `0x${string}`,
  action: 1 | 2,
): `0x${string}`;
export function deepV3KeeperSlot(nowMs: number): number;
export function runDeepV3KeeperCycle(input: {
  config: DeepV3KeeperConfig;
  state: DeepV3KeeperState;
  readers: readonly unknown[];
  wallet: unknown;
  nowMs: number;
  persistState(state: DeepV3KeeperState): Promise<boolean>;
  assertFence(): Promise<boolean>;
}): Promise<{
  outcome: string;
  state: DeepV3KeeperState;
  transactionHash: string | null;
  commonBlock: { number: bigint; hash: string } | null;
  action: 0 | 1 | 2;
}>;
