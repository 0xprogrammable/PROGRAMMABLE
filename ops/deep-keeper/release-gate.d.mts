/* eslint-disable @typescript-eslint/no-explicit-any */

export function evaluateDeepKeeperReleaseGate(
  release: unknown,
  config: any,
): {
  ready: boolean;
  reasons: string[];
  releaseVersion: string | null;
  sourceCommitment: string | null;
  startBlock: number | null;
};
