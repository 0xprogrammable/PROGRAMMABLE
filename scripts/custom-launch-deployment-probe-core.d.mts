export interface CustomLaunchDeploymentProbeInputV1 {
  readonly [key: string]: unknown;
}

export interface CustomLaunchDeploymentProbeResultV1 {
  readonly baseUrl: string;
  readonly status: "ready" | "disabled";
  readonly authenticatedCanary: string;
}

export function probeCustomLaunchDeployment(
  input: CustomLaunchDeploymentProbeInputV1,
): Promise<CustomLaunchDeploymentProbeResultV1>;

export function parseCustomLaunchDeploymentProbeArguments(
  arguments_: readonly string[],
  environment?: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, unknown>>;
