import type { Hex } from "viem";

export const CLASSIC_V4_DIGEST_DOMAINS: Readonly<{
  generic: string;
  preparationPlan: string;
  deploymentEvidence: string;
  sourceEvidence: string;
  releaseBinding: string;
  lifecycleAuthorization: string;
  lifecycleCanaryPlan: string;
  lifecycleEvidence: string;
  releaseManifest: string;
  canaryCreatorSalt: string;
  deploymentRpcSnapshot: string;
  lifecycleRpcSnapshot: string;
}>;

export function stableStringify(value: unknown): string;
export function digestJson(value: unknown, domain?: string): Hex;
