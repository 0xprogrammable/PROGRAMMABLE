export const DEFAULT_DEPLOYMENT_LABEL = "development-unverified";

export type DeploymentEnvironment = Readonly<{
  ENVIO_DEPLOYMENT_LABEL?: string;
}>;

const DEPLOYMENT_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export function deploymentLabelFromEnvironment(
  environment: DeploymentEnvironment = process.env,
): string {
  const deploymentLabel = environment.ENVIO_DEPLOYMENT_LABEL;
  return deploymentLabel !== undefined &&
    DEPLOYMENT_LABEL_PATTERN.test(deploymentLabel)
    ? deploymentLabel
    : DEFAULT_DEPLOYMENT_LABEL;
}
