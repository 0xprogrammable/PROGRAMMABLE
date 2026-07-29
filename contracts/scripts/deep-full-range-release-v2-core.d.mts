export const DEEP_V2_MANIFEST_PATH: string;

export type DeepV2DeploymentPlan = {
  transactionCount: 2;
  startingNonce: number;
  deployer: string;
  sourceCommitment: `0x${string}`;
  feeSplitVaultFactory: string;
  feeHook: string;
  growthVaultFactory: string;
  growthVaultImplementation: string;
  launcher: string;
  automation: string;
  positionPlanner: string;
};

export function buildDeepV2DeploymentPlan(
  deployer: string,
  startingNonce: number,
  root: string,
): DeepV2DeploymentPlan;

export function computeDeepV2SourceCommitment(
  root: string,
): `0x${string}`;

export function assessDeepV2LiveManifest(
  manifest: unknown,
): Readonly<{ ready: boolean; reasons: string[] }>;
