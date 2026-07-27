export type ClassicProductionDeploymentStatus = {
  chainId: number;
  status: string;
  memeLaunchStatus: string;
};

export function isClassicDeploymentReady(
  deployment: ClassicProductionDeploymentStatus,
  expectedChainId: number,
) {
  return (
    deployment.chainId === expectedChainId &&
    deployment.status === "ready" &&
    deployment.memeLaunchStatus === "ready"
  );
}

export function isClassicProductionDeploymentReady(
  deployment: ClassicProductionDeploymentStatus,
) {
  return isClassicDeploymentReady(deployment, 1);
}
