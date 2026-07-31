export const DEFAULT_DEPLOYMENT_LABEL = "development-unverified";
export const DEFAULT_SOURCE_COMMIT = "0".repeat(40);
export const DEFAULT_ARTIFACT_SHA256 = `0x${"00".repeat(32)}`;

export type DeploymentEnvironment = Readonly<{
  ENVIO_DEPLOYMENT_LABEL?: string;
  ENVIO_SOURCE_COMMIT?: string;
  ENVIO_CONFIG_SHA256?: string;
  ENVIO_SCHEMA_SHA256?: string;
  ENVIO_HANDLER_SHA256?: string;
  ENVIO_SOURCE_REGISTRY_SHA256?: string;
  ENVIO_EVENT_SET_SHA256?: string;
  ENVIO_EVENT_COUNT?: string;
}>;

const DEPLOYMENT_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^0x[0-9a-f]{64}$/;

export type DeploymentIdentity = Readonly<{
  deployment: string;
  sourceCommit: string;
  configSha256: string;
  schemaSha256: string;
  handlerSha256: string;
  sourceRegistrySha256: string;
  eventSetSha256: string;
  eventCount: number;
}>;

export const DEFAULT_DEPLOYMENT_IDENTITY: DeploymentIdentity = Object.freeze({
  deployment: DEFAULT_DEPLOYMENT_LABEL,
  sourceCommit: DEFAULT_SOURCE_COMMIT,
  configSha256: DEFAULT_ARTIFACT_SHA256,
  schemaSha256: DEFAULT_ARTIFACT_SHA256,
  handlerSha256: DEFAULT_ARTIFACT_SHA256,
  sourceRegistrySha256: DEFAULT_ARTIFACT_SHA256,
  eventSetSha256: DEFAULT_ARTIFACT_SHA256,
  eventCount: 0,
});

export function deploymentLabelFromEnvironment(
  environment: DeploymentEnvironment = process.env,
): string {
  const deploymentLabel = environment.ENVIO_DEPLOYMENT_LABEL;
  return deploymentLabel !== undefined &&
    DEPLOYMENT_LABEL_PATTERN.test(deploymentLabel)
    ? deploymentLabel
    : DEFAULT_DEPLOYMENT_LABEL;
}

export function deploymentIdentityFromEnvironment(
  environment: DeploymentEnvironment = process.env,
): DeploymentIdentity {
  const deployment = deploymentLabelFromEnvironment(environment);
  const sourceCommit = environment.ENVIO_SOURCE_COMMIT;
  const configSha256 = environment.ENVIO_CONFIG_SHA256;
  const schemaSha256 = environment.ENVIO_SCHEMA_SHA256;
  const handlerSha256 = environment.ENVIO_HANDLER_SHA256;
  const sourceRegistrySha256 = environment.ENVIO_SOURCE_REGISTRY_SHA256;
  const eventSetSha256 = environment.ENVIO_EVENT_SET_SHA256;
  const eventCount = environment.ENVIO_EVENT_COUNT;
  if (
    deployment === DEFAULT_DEPLOYMENT_LABEL ||
    sourceCommit === undefined ||
    !SOURCE_COMMIT_PATTERN.test(sourceCommit) ||
    configSha256 === undefined ||
    !SHA256_PATTERN.test(configSha256) ||
    schemaSha256 === undefined ||
    !SHA256_PATTERN.test(schemaSha256) ||
    handlerSha256 === undefined ||
    !SHA256_PATTERN.test(handlerSha256) ||
    sourceRegistrySha256 === undefined ||
    !SHA256_PATTERN.test(sourceRegistrySha256) ||
    eventSetSha256 === undefined ||
    !SHA256_PATTERN.test(eventSetSha256) ||
    eventCount === undefined ||
    !/^[1-9]\d*$/.test(eventCount) ||
    !Number.isSafeInteger(Number(eventCount)) ||
    Number(eventCount) > 10_000
  ) {
    return DEFAULT_DEPLOYMENT_IDENTITY;
  }
  return Object.freeze({
    deployment,
    sourceCommit,
    configSha256,
    schemaSha256,
    handlerSha256,
    sourceRegistrySha256,
    eventSetSha256,
    eventCount: Number(eventCount),
  });
}
