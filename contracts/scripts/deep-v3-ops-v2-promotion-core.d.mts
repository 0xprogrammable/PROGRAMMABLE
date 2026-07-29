import type { DeepV3KeeperV2Config } from "../../ops/deep-keeper-v3/config-v2.mjs";

export const DEEP_V3_OPS_V2_REVIEWED_BINDING_PATH: string;

export function buildDeepV3OpsV2Promotion(input: {
  manifest: Record<string, unknown>;
  config: DeepV3KeeperV2Config;
  root: string;
}): Readonly<{
  manifest: Record<string, unknown>;
  binding: Record<string, unknown>;
  opsSourceCommitment: `0x${string}`;
}>;
