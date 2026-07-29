import type { DeepV3KeeperV2Config } from "./config-v2.mjs";

export const DEEP_V3_OPS_V2_BINDING_PATH: "ops/deep-keeper-v3/reviewed-ops-v2-binding.json";
export const DEEP_V3_OPS_V2_EXECUTION_PATH: "/api/ops/deep-v3-keeper-v2";

export type DeepV3OpsV2ReviewedBinding = {
  schemaVersion: 2;
  status: "reviewed";
  manifestPath: string;
  model: "deep";
  releaseVersion: "deep-full-range-v3";
  internalContractRelease: "liquidity-growth-full-range-v3";
  keeperReleaseVersion: "deep-keeper-v3-ops-v2";
  releaseCommit: string;
  sourceCommitment: `0x${string}`;
  opsSourceCommitment: `0x${string}`;
  signerAddress: `0x${string}`;
  automationAddress: `0x${string}`;
  automationRuntimeCodeHash: `0x${string}`;
  automationFqcn: string;
  launcherAddress: `0x${string}`;
  launcherRuntimeCodeHash: `0x${string}`;
  launcherFqcn: string;
  vaultFactoryAddress: `0x${string}`;
  vaultFactoryRuntimeCodeHash: `0x${string}`;
  vaultFactoryFqcn: string;
  executorAddress: `0x${string}`;
  executorRuntimeCodeHash: `0x${string}`;
  executorFqcn: string;
};

export function validDeepV3OpsV2ReviewedBinding(
  binding: unknown,
): binding is DeepV3OpsV2ReviewedBinding;

export function evaluateDeepV3KeeperV2ReleaseGate(
  release: unknown,
  config: DeepV3KeeperV2Config,
  binding: unknown,
  currentOpsSourceCommitment: unknown,
): Readonly<{
  ready: boolean;
  reasons: readonly string[];
}>;
