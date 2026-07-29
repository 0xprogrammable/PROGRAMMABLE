export const DEEP_V3_OPS_V2_SOURCE_PATHS: readonly string[];
export const DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS: readonly string[];
export const DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES: readonly string[];
export const DEEP_V3_OPS_V2_SCRIPT_POLICY: Readonly<
  Record<string, string>
>;
export const DEEP_V3_OPS_V2_CRON_POLICY: Readonly<{
  path: string;
  schedule: string;
}>;
export const DEEP_V3_OPS_V2_FORBIDDEN_CRON_PATHS: readonly string[];

export interface DeepV3OpsV2DependencySeed {
  name: string;
  rootRange: string;
  path: string;
}

export interface DeepV3OpsV2DependencyEdge {
  kind: "dependency" | "optional" | "peer" | "optional-peer";
  name: string;
  range: string;
  path: string;
}

export interface DeepV3OpsV2DependencyNode {
  path: string;
  name: string;
  version: string;
  resolved: string;
  integrity: string;
  edges: readonly DeepV3OpsV2DependencyEdge[];
}

export interface DeepV3OpsV2DependencyProjection {
  lockfileVersion: 3;
  seeds: readonly DeepV3OpsV2DependencySeed[];
  closure: readonly DeepV3OpsV2DependencyNode[];
}

export interface DeepV3OpsV2ScriptProjection {
  name: string;
  command: string;
}

export interface DeepV3OpsV2ScheduleProjection {
  path: string;
  schedule: string;
}

export function inspectDeepV3OpsV2RuntimeDependencies(
  root: string,
): string[];
export function buildDeepV3OpsV2DependencyProjection(
  root: string,
): DeepV3OpsV2DependencyProjection;
export function buildDeepV3OpsV2ScriptProjection(
  root: string,
): DeepV3OpsV2ScriptProjection[];
export function buildDeepV3OpsV2ScheduleProjection(
  root: string,
): DeepV3OpsV2ScheduleProjection;
export function buildDeepV3OpsV2Projection(root: string): {
  dependencies: DeepV3OpsV2DependencyProjection;
  scripts: readonly DeepV3OpsV2ScriptProjection[];
  schedule: DeepV3OpsV2ScheduleProjection;
};

export function computeDeepV3OpsV2SourceCommitment(
  root: string,
): `0x${string}`;
