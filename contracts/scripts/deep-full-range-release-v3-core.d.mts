export type DeepV3RuntimeField =
  | "zapPlanner"
  | "growthVaultFactory"
  | "growthVaultImplementation"
  | "hookFactory"
  | "feeHook"
  | "launcher"
  | "positionPlanner"
  | "automation"
  | "keeperExecutor";

export type DeepV3TransactionField =
  | "zapPlanner"
  | "growthVaultFactory"
  | "hookFactory"
  | "feeHook"
  | "launcher"
  | "keeperExecutor";

export interface DeepV3DeploymentPlan {
  transactionCount: 6;
  startingNonce: number;
  hookSalt: `0x${string}`;
  deployer: `0x${string}`;
  treasury: `0x${string}`;
  lockedPositionFactory: `0x${string}`;
  sourceCommitment: `0x${string}`;
  zapPlanner: `0x${string}`;
  growthVaultFactory: `0x${string}`;
  growthVaultImplementation: `0x${string}`;
  hookFactory: `0x${string}`;
  feeHook: `0x${string}`;
  launcher: `0x${string}`;
  positionPlanner: `0x${string}`;
  automation: `0x${string}`;
  keeperExecutor: `0x${string}`;
}

export const DEEP_V3_MANIFEST_PATH: string;
export const DEEP_V3_SCHEMA_PATH: string;
export const DEEP_V3_LIFECYCLE_EVIDENCE_PATH: string;
export const DEEP_V3_TRANSACTION_FIELDS: readonly DeepV3TransactionField[];
export const DEEP_V3_RUNTIME_FIELDS: readonly DeepV3RuntimeField[];
export const DEEP_V3_STACK: Readonly<Record<string, `0x${string}`>>;
export const DEEP_V3_STACK_RUNTIME_HASHES: Readonly<
  Record<string, `0x${string}`>
>;
export const DEEP_V3_OFFICIAL_DEPENDENCIES: Readonly<
  Record<
    string,
    Readonly<{
      address: `0x${string}`;
      runtimeCodeHash: `0x${string}`;
      sourceRef: string;
    }>
  >
>;
export const DEEP_V3_FIXED_POLICY: Readonly<Record<string, string | number>>;
export const DEEP_V3_KEEPER_GAS_MIXTURES: readonly Readonly<{
  compoundCandidates: number;
  oracleCandidates: number;
  theoreticalGas: string;
}>[];
export const DEEP_V3_KEEPER_POLICY: Readonly<
  Record<
    string,
    | string
    | number
    | boolean
    | readonly Readonly<{
        compoundCandidates: number;
        oracleCandidates: number;
        theoreticalGas: string;
      }>[]
  >
>;
export const DEEP_V3_OPS_V2_SOURCE_PATHS: readonly string[];
export const DEEP_V3_OPS_V2_PROJECTION_INPUT_PATHS: readonly string[];
export const DEEP_V3_OPS_V2_RUNTIME_DEPENDENCIES: readonly string[];
export const DEEP_V3_ARTIFACTS: Readonly<
  Record<DeepV3RuntimeField, Readonly<{ fqcn: string; file: string }>>
>;

export function deepV3ArtifactRuntime(root: string): Record<
  DeepV3RuntimeField,
  {
    fqcn: string;
    creationBytes: number;
    creationCodeHash: `0x${string}`;
    runtimeBytes: number;
    runtimeTemplateCodeHash: `0x${string}`;
  }
>;
export function deepV3ConstructorBindings(manifest: unknown): Record<
  DeepV3RuntimeField,
  { types: string[]; values: unknown[] }
>;
export function encodeDeepV3ConstructorArguments(
  field: DeepV3RuntimeField,
  manifest: unknown,
): `0x${string}`;
export function expectedDeepV3CreationInput(
  field: DeepV3RuntimeField,
  manifest: unknown,
  root: string,
): `0x${string}`;
export function expectedDeepV3HookDeploymentInput(
  manifest: unknown,
): `0x${string}`;
export function expectedDeepV3TransactionInput(
  field: DeepV3TransactionField,
  manifest: unknown,
  root: string,
): `0x${string}`;
export function assertDeepV3ArtifactRuntimeBinding(
  field: DeepV3RuntimeField,
  runtime: `0x${string}`,
  manifest: unknown,
  root: string,
): `0x${string}`;
export function computeDeepV3SourceCommitment(root: string): `0x${string}`;
export function computeDeepV3OpsV2SourceCommitment(
  root: string,
): `0x${string}`;
export function buildDeepV3OpsV2Projection(root: string): {
  dependencies: {
    lockfileVersion: 3;
    seeds: readonly {
      name: string;
      rootRange: string;
      path: string;
    }[];
    closure: readonly {
      path: string;
      name: string;
      version: string;
      resolved: string;
      integrity: string;
      edges: readonly {
        kind: "dependency" | "optional" | "peer" | "optional-peer";
        name: string;
        range: string;
        path: string;
      }[];
    }[];
  };
  scripts: readonly { name: string; command: string }[];
  schedule: { path: string; schedule: string };
};
export function buildDeepV3DeploymentPlan(
  deployer: `0x${string}`,
  startingNonce: number,
  hookSalt: `0x${string}`,
  root: string,
): DeepV3DeploymentPlan;
export function parseDeepV3EtherscanStandardJson(
  sourceCode: string,
): {
  language: "Solidity";
  sources: Record<string, { content: string }>;
  settings: Record<string, unknown>;
};
export function assertDeepV3EtherscanStandardJsonMatches(
  sourceCode: string,
  expectedInput: unknown,
): {
  language: "Solidity";
  sources: Record<string, { content: string }>;
  settings: Record<string, unknown>;
};
export function assertDeepV3EtherscanBuildInput(
  field: DeepV3RuntimeField,
  sourceCode: string,
  expectedInput: unknown,
  root: string,
): {
  language: "Solidity";
  sources: Record<string, { content: string }>;
  settings: Record<string, unknown>;
};
export function assessDeepV3LiveManifest(
  manifest: unknown,
  root: string,
): Readonly<{ ready: boolean; reasons: string[] }>;
export function validDeepV3Hash(value: unknown): boolean;
